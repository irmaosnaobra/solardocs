// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): 7.8 e 7.9, os ANIVERSÁRIOS (do cliente e da usina). Frio P5. Veredito do chefe-antiban de 05/11/2026.
//
// Sai pelo `sendFrio` e pelo portão do frio com `robo` (`novaRodadaPortao`): janela da Base, linha pausada, supressão, mudo, pausa humana, teto do
// frio e espaçamento. O toque do ano sai no dia D; se D foi domingo, feriado ou sem vaga, sai o texto "atrasado" em D+1 ou D+2 e depois DESISTE.
// NUNCA retroativo. Só obra com a etapa 8 concluída por gente DEPOIS do `primeiro_ligado_em`. O nascimento vem do cadastro privado, fica só em
// memória (cache do dia) e NUNCA vai ao banco nem a log. 1 envio por rodada; trava = INSERT com chave única antes do envio (nunca upsert).
// ─────────────────────────────────────────────────────────────────────────────
import { sendFrio } from '../agents/zapiClient';
import { novaRodadaPortao } from '../recuperacaoCheckoutPortao';
import { diaBRT } from '../agentes5040/relogio';
import { linkIndicacao } from '../gerador/indicacaoJornada';
import { lerDatasDoPosVenda, primeiroNomeDaObra, type DatasPosVenda } from '../gerador/jornadaPosVendaDados';
import { POR_QUE_NAO_DISPARA, chavePos, textoAniversario, toquesDoDia } from './jornadaMensagensPuro';
import { jaTravadas, marcarTrava, nada, parou, soltarTrava, travar, type CtxMsg, type Leitura, type ResultadoMsg } from './jornadaMensagensBase';

const ROBO_ANIV = 'jornada_aniversario' as const;
const logAniv = (que: string): void => console.error(`[jornada-msg] ${que}`, 'aniversario');

export async function rodarAniversarios(c: CtxMsg, leitura: Leitura): Promise<ResultadoMsg> {
  const atual = c.ligados.aniversario;
  if (c.sonda || !atual) return nada('desligado');
  const primeiro = c.primeiros.aniversario ?? atual;
  // A etapa 8 concluída por gente DEPOIS do primeiro "ligado em": as obras antigas e as 51 da planilha nunca entram.
  const concluidas8 = new Map<number, string>();
  for (const o of leitura.obras) {
    const h = [...(o.jo?.historico ?? [])].reverse().find((x) => x.acao === 'concluir' && x.etapa === 8);
    if (h && !POR_QUE_NAO_DISPARA.has(h.por) && h.em > primeiro && !o.cancelada) concluidas8.set(o.card, h.em);
  }
  if (!concluidas8.size) return nada('sem_candidato');
  const cache = new Map<number, DatasPosVenda>();
  for (const card of concluidas8.keys()) {
    try { cache.set(card, await lerDatasDoPosVenda(card, c.agora)); } catch { logAniv('leitura_falhou'); }
  }
  const hoje = diaBRT(c.agora);
  const toques = toquesDoDia(cache, hoje, atual, primeiro, concluidas8);
  if (!toques.length) return nada('sem_toque');
  const ja = await jaTravadas(toques.map((t) => chavePos(t.card, t.toque, t.ano)));
  if (!ja) return parou('leitura_falhou');

  const portao = novaRodadaPortao(() => c.agora, { robo: ROBO_ANIV });
  for (const t of toques) {
    const chave = chavePos(t.card, t.toque, t.ano);
    if (ja.has(chave)) continue;
    const info = leitura.cards.get(t.card);
    const tel = String(info?.cliente_telefone ?? '').replace(/\D/g, '');
    if (tel.length < 10) continue;
    const v = await portao.avaliar(tel);
    if (!v.ok) { if (v.acao === 'segura') return parou(v.motivo); continue; }
    if (!(await c.vez.tomar())) return parou('vez_ocupada');
    const r = await travar(chave, { robo: ROBO_ANIV, atrasado: t.atrasado }, c.agora);
    if (r === 'ja') continue;
    if (r === 'erro') return parou('trava_falhou');
    const nome = await primeiroNomeDaObra(t.card, String(info?.cliente_nome ?? ''));
    const texto = textoAniversario({ toque: t.toque, primeiro: nome, atrasado: t.atrasado, anos: t.anos, link: linkIndicacao(t.card) });
    try {
      const saiu = await sendFrio(tel, [texto], 'io');
      if (saiu === false) { await soltarTrava(chave); return parou('calado'); }
    } catch {
      await marcarTrava(chave, { falhou: true }, c.agora);
      logAniv('envio_falhou');
      return { enviado: false, parar: true, motivo: 'envio_falhou', chave };
    }
    await marcarTrava(chave, { enviado: true }, c.agora);
    portao.travarRodada('ja_enviou_na_rodada');
    return { enviado: true, parar: true, motivo: 'enviado', chave };
  }
  return nada('sem_envio');
}
