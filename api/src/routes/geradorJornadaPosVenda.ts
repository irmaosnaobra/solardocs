import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { exigeConsultor } from './geradorDossie';
import { semCache } from './geradorClientesDocs';
import { falhouJornada, guardaDaObra, logErroJornada, type GuardaObra } from './geradorJornadaGuarda';
import { bookPodeSair } from './geradorJornadaObra';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { ddmm, donosDaEtapa } from '../services/gerador/jornadaSolar';
import { etapaAtualCompleta } from '../services/gerador/jornadaObra';
import { lerJornadaComVersao } from '../services/gerador/jornadaSolarBanco';
import { lerObraComVersao, lerTodasObras } from '../services/gerador/jornadaObraBanco';
import { lerCardsPorIds, lerLigacao } from '../services/gerador/vendaSolarHub';
import { lerMetaBook } from '../services/gerador/bookObra';
import { premioVivo } from '../services/gerador/jornadaDinheiro';
import { lerLancamentosDaObra } from '../services/gerador/jornadaDinheiroBanco';
import { linkIndicacao, lerIndicacaoDoCard, lerTodasIndicacoes } from '../services/gerador/indicacaoJornada';
import { lerMensagens, ligadosAgora } from '../services/gerador/jornadaMensagensChave';
import { lerDatasDoPosVenda, primeiroNomeDaObra } from '../services/gerador/jornadaPosVendaDados';
import { nomeSimples } from '../services/gerador/solarObras';
import {
  GRUPOS_MSG, PREFIXO_ENV, PREFIXO_LIB, PREFIXO_POS, VALE_LIBERACAO_MS, dataDoAno, diasEntre, nomeBonitoMsg, textoAniversario, textoLiberacao,
  type GrupoMsg,
} from '../services/io/jornadaMensagensPuro';

// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): a LEITURA do pós-venda (etapa 9) e dos avisos de cada etapa.
//
//   GET /jornada-solar/obra/:card/fase3     os avisos, os 3 toques, o Book em PDF, o link, as indicações e o placar
//
// Só lê. Nenhuma mensagem sai daqui. A leitura NUNCA materializa estado. Nada de nome, telefone ou data pessoal em log: só o código.
// ─────────────────────────────────────────────────────────────────────────────

type Linha = { key: string; value: Record<string, unknown> | null; updated_at: string | null };
const MSG_PARTE = 'Não consegui ler tudo agora.';

async function chavesComPrefixo(prefixo: string): Promise<Linha[]> {
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at').like('key', `${prefixo}%`).limit(200);
  if (error) throw new Error('carimbos');
  return ((data ?? []) as Linha[]).filter((l) => String(l.key).startsWith(prefixo));
}

const situacaoDaTrava = (v: Record<string, unknown> | null): 'enviado' | 'falhou' | 'pendente' =>
  v?.enviado === true ? 'enviado' : v?.falhou === true ? 'falhou' : 'pendente';

/** A próxima data MM-DD a partir de hoje (ou a de até 2 dias atrás, que ainda pode sair atrasada). */
function ocorrenciaRelevante(mmdd: string, hoje: string): { data: string; ano: number } {
  const ano = Number(hoje.slice(0, 4));
  for (const a of [ano - 1, ano]) {
    const d = dataDoAno(mmdd, a);
    const diff = diasEntre(d, hoje);
    if (diff >= 0 && diff <= 2) return { data: d, ano: a };
  }
  const esteAno = dataDoAno(mmdd, ano);
  return esteAno >= hoje ? { data: esteAno, ano } : { data: dataDoAno(mmdd, ano + 1), ano: ano + 1 };
}

export function mountJornadaPosVenda(router: Router): void {
  const base = [exigeConsultor, semCache];

  router.get('/jornada-solar/obra/:card/fase3', ...base, async (req: Request, res: Response) => {
    const g: GuardaObra | null = await guardaDaObra(req, res);
    if (!g) return;
    try {
      const agora = new Date();
      const hoje = diaDeBrasilia(agora);
      const [{ estado: js }, { estado: jo }] = await Promise.all([lerJornadaComVersao(g.id), lerObraComVersao(g.id)]);
      const etapa = etapaAtualCompleta(js, jo, null);
      const vendedor = nomeSimples(g.card.vendedor_nome) || js?.vendedor || '';
      let aviso: string | undefined;
      const parte = async <T>(f: () => Promise<T>, vazio: T): Promise<T> => {
        try { return await f(); } catch (err) { logErroJornada('fase3_parte', err); aviso = MSG_PARTE; return vazio; }
      };

      const [msgs, lig, meta, envs, lib, pos, ind, lancs] = await Promise.all([
        parte(lerMensagens, null),
        parte(() => lerLigacao(g.id), null),
        parte(() => lerMetaBook(g.id), null),
        parte(async () => [
          ...(await chavesComPrefixo(`${PREFIXO_ENV}venda:${g.id}:`)), ...(await chavesComPrefixo(`${PREFIXO_ENV}sua:${g.id}:`)),
          ...(await chavesComPrefixo(`${PREFIXO_ENV}espera:${g.id}:`)),
        ], [] as Linha[]),
        parte(() => chavesComPrefixo(`${PREFIXO_LIB}${g.id}`), [] as Linha[]),
        parte(() => chavesComPrefixo(`${PREFIXO_POS}${g.id}:`), [] as Linha[]),
        parte(() => lerIndicacaoDoCard(g.id), null),
        parte(async () => (await lerLancamentosDaObra(g.id)).lancamentos, []),
      ]);
      const ligados = msgs && msgs.valida ? ligadosAgora(msgs.m) : null;
      const grupos = Object.fromEntries(GRUPOS_MSG.map((k) => [k, !!ligados && ligados[k] !== null])) as Record<GrupoMsg, boolean>;

      // Os avisos desta obra (os 20 mais novos; os da sonda não aparecem).
      const avisos = envs.flatMap((l) => {
        const p = l.key.split(':');
        const v = l.value;
        if (!v || v.sonda === true) return [];
        const tipo = p[1];
        const n = tipo === 'venda' ? 1 : Number(p[3]);
        return [{ em: String(v.em ?? l.updated_at ?? ''), tipo, etapa: n, para: p[p.length - 1], situacao: situacaoDaTrava(v) }];
      }).sort((a, b) => (a.em < b.em ? 1 : -1)).slice(0, 20);

      // O que vem depois.
      let proximo: string | null = null;
      if (grupos.fila && etapa !== null && etapa >= 1 && etapa <= 8) {
        const esp = (js?.esperando && js.esperando.etapa === etapa ? js.esperando : null) ?? (jo?.esperando && jo.esperando.etapa === etapa ? jo.esperando : null);
        proximo = esp && hoje < esp.ate
          ? `A cobrança volta em ${ddmm(esp.ate)}.`
          : `Fila de amanhã às 08:00, para ${donosDaEtapa(etapa, vendedor).map(nomeBonitoMsg).join(' e ')}.`;
      }

      // O pós-venda (só com a etapa 9).
      const link = linkIndicacao(g.id);
      const toques: Array<Record<string, unknown>> = [];
      let book: { gerado_em: string; por: string } | null = null;
      let indicacoes: Array<Record<string, unknown>> = [];
      let geral: Record<string, number> | null = null;
      let placar = { indicacoes: 0, vendas: 0 };
      if (etapa === 9) {
        if (meta) book = { gerado_em: meta.gerado_em, por: meta.por };
        const concl8 = [...(jo?.historico ?? [])].reverse().find((h) => h.acao === 'concluir' && h.etapa === 8) ?? null;
        const concl8Gente = concl8 && concl8.por !== 'leitura' && concl8.por !== 'sonda' && concl8.por !== '' ? concl8 : null;
        const datas = await parte(() => lerDatasDoPosVenda(g.id, agora), { aniv: null, liberada: null });
        const primeiro = await primeiroNomeDaObra(g.id, String(g.card.cliente_nome ?? ''));
        const elegivelDesde = msgs?.m.grupos.aniversario.primeiro_ligado_em ?? null;
        const elegivelAniv = !!concl8Gente && !!elegivelDesde && concl8Gente.em > elegivelDesde;
        const trava = (chave: string) => pos.find((l) => l.key === chave) ?? null;
        const temTelefone = !!String(g.card.cliente_telefone ?? '').replace(/\D/g, '');

        // Toque 1 · a liberação
        const tl = lib[0] ?? null;
        const vencidaLib = !!concl8Gente && agora.getTime() - Date.parse(concl8Gente.em) > VALE_LIBERACAO_MS;
        const sitLib = tl ? (situacaoDaTrava(tl.value) === 'pendente' ? 'agendado' : situacaoDaTrava(tl.value))
          : !grupos.liberacao ? 'desligado' : !meta ? 'sem_book' : !temTelefone ? 'sem_telefone' : vencidaLib ? 'nao_saiu' : 'agendado';
        toques.push({
          n: 1, tipo: 'liberacao', data: datas.liberada ?? (concl8Gente ? diaDeBrasilia(concl8Gente.em) : hoje), situacao: sitLib,
          ...(tl && situacaoDaTrava(tl.value) === 'enviado' ? { enviado_em: String(tl.value?.em ?? tl.updated_at ?? '') } : {}),
          texto: textoLiberacao({ primeiro, link }),
        });

        // Toques 2 e 3 · os aniversários
        const montaToque = (n: number, tipo: 'aniv' | 'usina', mmdd: string | null, anos?: (ano: number) => number) => {
          let oc = mmdd ? ocorrenciaRelevante(mmdd, hoje) : null;
          // A usina só faz aniversário a partir do ano seguinte ao da liberação.
          const anoLib = Number((datas.liberada ?? '').slice(0, 4));
          if (tipo === 'usina' && mmdd && oc && oc.ano <= anoLib) oc = { data: dataDoAno(mmdd, anoLib + 1), ano: anoLib + 1 };
          const t = oc ? trava(`${PREFIXO_POS}${g.id}:${tipo}:${oc.ano}`) : null;
          const sit = t ? (situacaoDaTrava(t.value) === 'pendente' ? 'agendado' : situacaoDaTrava(t.value))
            : !grupos.aniversario ? 'desligado' : !temTelefone ? 'sem_telefone' : !mmdd ? 'sem_data' : !elegivelAniv ? 'nao_saiu' : 'agendado';
          toques.push({
            n, tipo, data: oc ? oc.data : null, situacao: sit,
            ...(t && situacaoDaTrava(t.value) === 'enviado' ? { enviado_em: String(t.value?.em ?? t.updated_at ?? '') } : {}),
            texto: textoAniversario({ toque: tipo, primeiro, atrasado: oc ? hoje > oc.data : false, anos: anos && oc ? anos(oc.ano) : 1, link }),
          });
        };
        montaToque(2, 'aniv', datas.aniv);
        montaToque(3, 'usina', datas.liberada ? datas.liberada.slice(5) : null, (ano) => Math.max(1, ano - Number((datas.liberada ?? '').slice(0, 4))));

        // As indicações deste cliente e o placar geral
        const todas = await parte(lerTodasIndicacoes, new Map<number, { indicador: number; em: string }>());
        const minhas = [...todas.entries()].filter(([, v]) => v.indicador === g.id).sort((a, b) => (a[1].em < b[1].em ? 1 : -1));
        const cards = await parte(() => lerCardsPorIds([...minhas.map(([c]) => c)]), new Map());
        const ligsNovas = await Promise.all(minhas.map(async ([c]) => [c, (await parte(() => lerLigacao(c), null))?.lig ?? null] as const));
        const jornadas = new Map(await Promise.all(minhas.map(async ([c]) => [c, (await parte(() => lerJornadaComVersao(c), null))?.estado ?? null] as const)));
        const ligPorCard = new Map(ligsNovas);
        indicacoes = minhas.map(([c, v]) => {
          const card = cards.get(c);
          const status = String(card?.status ?? '').trim().toLowerCase();
          const vendida = status === 'fechou' && !!jornadas.get(c);
          const situacao = vendida ? 'vendida' : status === 'sem_interesse' || status === 'cancelado' ? 'perdida' : 'na_agenda';
          return { em: v.em, card: c, cliente: String(card?.cliente_nome ?? ''), situacao, codigo: vendida ? (ligPorCard.get(c)?.venda ?? null) : null, vendedor: nomeSimples(card?.vendedor_nome) };
        });
        placar = { indicacoes: indicacoes.length, vendas: indicacoes.filter((x) => x.situacao === 'vendida').length };
        const mes = hoje.slice(0, 7);
        const doMes = [...todas.entries()].filter(([, v]) => diaDeBrasilia(v.em).startsWith(mes));
        const cardsMes = doMes.length ? await parte(() => lerCardsPorIds(doMes.map(([c]) => c)), new Map()) : new Map();
        const obras = await parte(lerTodasObras, new Map());
        let naRegua = 0;
        for (const o of obras.values()) {
          const c = [...o.historico].reverse().find((h) => h.acao === 'concluir' && h.etapa === 8);
          if (c && c.por !== 'leitura' && c.por !== 'sonda' && c.por !== '') naRegua++;
        }
        geral = {
          na_regua: naRegua, indicacoes_mes: doMes.length,
          vendas_mes: doMes.filter(([c]) => String(cardsMes.get(c)?.status ?? '').trim().toLowerCase() === 'fechou').length,
        };
      }

      // De onde esta obra veio (a etapa 2 da obra NOVA mostra) e o prêmio.
      let veio_de: { card: number; codigo: string | null; nome: string } | null = null;
      if (ind) {
        const [cardsInd, ligInd] = await Promise.all([
          parte(() => lerCardsPorIds([ind.indicador]), new Map()), parte(() => lerLigacao(ind.indicador), null),
        ]);
        veio_de = { card: ind.indicador, codigo: ligInd?.lig.venda ?? null, nome: String(cardsInd.get(ind.indicador)?.cliente_nome ?? '') };
      }
      const pode = {
        book: etapa === 9 || (etapa !== null && etapa >= 7) ? await parte(() => bookPodeSair(g), false) : false,
        premio: (g.adm || g.nome === 'giovanna') && veio_de !== null,
      };

      res.json({
        ok: true, grupos, avisos, proximo, toques, book, pode, link, indicacoes, placar, geral, veio_de,
        premio: { lancado: premioVivo(lancs) },
        ...(aviso ? { aviso } : {}),
      });
    } catch (err) { falhouJornada(res, 'fase3', err, true); }
  });
}
