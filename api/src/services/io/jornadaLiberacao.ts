// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): 7.7, a LIBERAÇÃO da usina ao cliente. Veredito do chefe-antiban de 05/11/2026.
//
// UMA mensagem só: o Book em PDF pelo `sendDocument`, com o texto na legenda. Transacional P3. Janela das 9h às 20h de segunda a sábado
// (`dentroDaJanelaDaBaseLinha`, a da Base da linha, ESCRITA aqui no código; a padrão do P3 é das 7h às 21h e não vale). Antes do envio: teto
// transacional da linha, espaçamento, supressão, mudo e `podeFalarComLead`. Só sai com a etapa 8 concluída por GENTE depois do "ligado em" e
// há no máximo 7 dias, a liberação da Cemig no máximo 10 dias antes da conclusão, o PDF do Book salvo e o telefone do card. 1 envio por rodada;
// a trava é um INSERT com chave única antes do envio (nunca upsert); o envio para no primeiro erro de linha. Nenhum dado pessoal em log.
// ─────────────────────────────────────────────────────────────────────────────
import { sendDocument } from '../agents/zapiClient';
import { dentroDaJanelaDaBaseLinha, dentroDoTetoHorarioLinha, respeitaEspacamentoLinha } from '../agents/whatsapp/lineThrottle';
import { carregarMudos, motivosDaSupressao, TOQUES_ATE_DESISTIR } from '../agents/whatsapp/silenciar';
import { podeFalarComLead } from '../agents/whatsapp/pausaHumana';
import { diaBRT } from '../agentes5040/relogio';
import { lerObraPrivada } from '../gerador/jornadaObraBanco';
import { lerMetaBook, urlAssinadaDoBook } from '../gerador/bookObra';
import { linkIndicacao } from '../gerador/indicacaoJornada';
import { primeiroNomeDaObra } from '../gerador/jornadaPosVendaDados';
import { POR_QUE_NAO_DISPARA, VALE_LIBERACAO_MS, chaveLiberacao, textoLiberacao } from './jornadaMensagensPuro';
import { jaTravadas, linhaLivre, marcarTrava, nada, parou, soltarTrava, travar, type CtxMsg, type Leitura, type ResultadoMsg } from './jornadaMensagensBase';

const ROBO_LIB = 'jornada_liberacao' as const;
const ymdMenosDias = (ymd: string, dias: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
};
const logLib = (que: string): void => console.error(`[jornada-msg] ${que}`, 'liberacao');

export async function rodarLiberacao(c: CtxMsg, leitura: Leitura): Promise<ResultadoMsg> {
  const desde = c.ligados.liberacao;
  if (c.sonda || !desde) return nada('desligado');
  // Os candidatos: etapa 8 concluída por gente depois do "ligado em", há no máximo 7 dias.
  const cands = leitura.obras.flatMap((o) => {
    const h = [...(o.jo?.historico ?? [])].reverse().find((x) => x.acao === 'concluir' && x.etapa === 8);
    if (!h || POR_QUE_NAO_DISPARA.has(h.por) || !(h.em > desde) || c.agora.getTime() - Date.parse(h.em) > VALE_LIBERACAO_MS || o.cancelada) return [];
    return [{ o, em: h.em }];
  }).sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0));
  if (!cands.length) return nada('sem_candidato');

  // 1. A janela da Base da linha, das 9h às 20h de segunda a sábado.
  if (!dentroDaJanelaDaBaseLinha(c.agora)) return parou('fora_da_janela');
  const ja = await jaTravadas(cands.map((x) => chaveLiberacao(x.o.card)));
  if (!ja) return parou('leitura_falhou');

  for (const { o, em } of cands) {
    const chave = chaveLiberacao(o.card);
    if (ja.has(chave)) continue;
    try {
      // 2. A liberação da Cemig: no máximo 10 dias antes da conclusão (obra antiga arrumada hoje não manda a de meses atrás).
      const priv = await lerObraPrivada(o.card);
      const lib = priv?.liberacao?.passos?.liberada?.data ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lib) || lib < ymdMenosDias(diaBRT(em), 10)) continue;
      // 3. O PDF do Book salvo.
      if (!(await lerMetaBook(o.card))) continue;
      // 4. O telefone do card.
      const tel = String(leitura.cards.get(o.card)?.cliente_telefone ?? '').replace(/\D/g, '');
      if (tel.length < 10) continue;
      // 5. Supressão e mudo.
      if ((await motivosDaSupressao(tel)).length) continue;
      const mudos = await carregarMudos(Math.min(3, TOQUES_ATE_DESISTIR), 60, { estrito: true });
      if (mudos(tel)) continue;
      // 6. Gente da equipe falando com ela: volta na próxima rodada (nada foi travado).
      if (!(await podeFalarComLead(tel)).pode) continue;
      // 7. A linha.
      if (!(await linhaLivre(c.agora)) || !(await dentroDoTetoHorarioLinha({ transacional: true })) || !(await respeitaEspacamentoLinha())) return parou('linha_ocupada');
      // 8. A vez da rodada.
      if (!(await c.vez.tomar())) return parou('vez_ocupada');
      // 9. A trava (INSERT com chave única), antes do envio.
      const t = await travar(chave, { robo: ROBO_LIB, evento_em: em }, c.agora);
      if (t === 'ja') continue;
      if (t === 'erro') return parou('trava_falhou');
      // 10. A URL assinada de 1 h.
      const url = await urlAssinadaDoBook(o.card, 3600);
      if (!url) { await soltarTrava(chave); return parou('sem_url'); }
      // 11. O envio, em uma mensagem só.
      const primeiro = await primeiroNomeDaObra(o.card, o.cliente);
      const legenda = textoLiberacao({ primeiro, link: linkIndicacao(o.card) });
      try {
        await sendDocument(tel, url, `Book da obra ${o.codigo ?? ''}`.trim() + '.pdf', legenda, 'io');
      } catch {
        await marcarTrava(chave, { falhou: true }, c.agora);
        logLib('envio_falhou');
        return { enviado: false, parar: true, motivo: 'envio_falhou', chave };
      }
      await marcarTrava(chave, { enviado: true }, c.agora);
      return { enviado: true, parar: true, motivo: 'enviado', chave };
    } catch { logLib('leitura_falhou'); return parou('leitura_falhou'); }
  }
  return nada('sem_envio');
}
