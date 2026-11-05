import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { exigeConsultor } from './geradorDossie';
import { exigeAdm } from './geradorAdm';
import { semCache } from './geradorClientesDocs';
import { corpoDe, falhouJornada, logErroJornada, MSG_PEDIDO, quem } from './geradorJornadaGuarda';
import { lerCardsPorIds, ehCardSolarVendido } from '../services/gerador/vendaSolarHub';
import { ehRecusa, lerJornadaComVersao, mudarJornada, ErroJornada } from '../services/gerador/jornadaSolarBanco';
import { lerObraComVersao } from '../services/gerador/jornadaObraBanco';
import { gravarGrupo, lerMensagens } from '../services/gerador/jornadaMensagensChave';
import { prefixosTotalDaLinha } from '../services/agents/whatsapp/lineThrottle';
import { rodarSondaDoCard } from '../services/io/jornadaMensagensTick';
import { TEL_AVISO } from '../services/io/solarEquipe';
import { GRUPOS_MSG, PREFIXO_ENV, PREFIXO_LIB, PREFIXO_POS, eventosDoCard, type GrupoMsg } from '../services/io/jornadaMensagensPuro';

// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): ligar e desligar as mensagens (um grupo por vez) e a SONDA. Só o ADM.
//
//   GET  /jornada-solar/mensagens          o estado dos cinco grupos e quantas saíram nas últimas 24 h
//   PUT  /jornada-solar/mensagens          liga ou desliga UM grupo (o cliente só liga 24 h depois da equipe: 409)
//   POST /jornada-solar/mensagens/sonda    simular | abrir | rodar | ler | desfazer (as quatro últimas só no card de teste)
//
// A sonda roda o caminho de verdade com o transporte FALSO (nenhuma chamada à Z-API); grava a trava e o carimbo de verdade, com `sonda: true`,
// e desfaz pelo próprio servidor. Nenhuma mensagem sai daqui.
// ─────────────────────────────────────────────────────────────────────────────

const TELEFONE_DA_SONDA = '34900000000';
const MSG_ORDEM = 'As mensagens do cliente ligam um dia depois das da equipe.';
const MSG_SO_SONDA = 'Só o card da sonda.';
const DIA_MS = 24 * 3600_000;

const PREFIXOS_DO_GRUPO: Record<GrupoMsg, readonly string[]> = {
  venda: [`${PREFIXO_ENV}venda:`], etapa: [`${PREFIXO_ENV}sua:`, `${PREFIXO_ENV}espera:`], fila: [`${PREFIXO_ENV}fila:`],
  liberacao: [PREFIXO_LIB], aniversario: [PREFIXO_POS],
};

type Linha = { key: string; value: Record<string, unknown> | null; updated_at: string | null };

async function linhasDe(prefixo: string, desde?: string): Promise<Linha[]> {
  let q = supabase.from('system_state').select('key, value, updated_at').like('key', `${prefixo}%`);
  if (desde) q = q.gte('updated_at', desde);
  const { data, error } = await q.limit(1000);
  if (error) throw new ErroJornada('carimbos');
  return ((data ?? []) as Linha[]).filter((l) => String(l.key).startsWith(prefixo));
}

async function corpoDoGet(): Promise<Record<string, unknown>> {
  const { m, valida } = await lerMensagens();
  const desde = new Date(Date.now() - DIA_MS).toISOString();
  const grupos: Record<string, unknown> = {};
  for (const g of GRUPOS_MSG) {
    let enviadas = 0;
    for (const p of PREFIXOS_DO_GRUPO[g]) enviadas += (await linhasDe(p, desde)).filter((l) => l.value?.enviado === true && l.value?.sonda !== true).length;
    const e = m.grupos[g];
    grupos[g] = { ligado: e.ligado, ligado_em: e.ligado_em, primeiro_ligado_em: e.primeiro_ligado_em, por: e.por, enviadas_24h: enviadas };
  }
  return { ok: true, valida, desligado_na_vercel: process.env.JORNADA_MSG_OFF === '1', grupos };
}

/** O card da sonda: existe, telefone de teste, `created_by` da sonda e nome começando por TESTE. */
const ehCardDaSonda = (c: { cliente_telefone?: unknown; created_by?: unknown; cliente_nome?: unknown } | undefined): boolean =>
  !!c && String(c.cliente_telefone ?? '').replace(/\D/g, '') === TELEFONE_DA_SONDA && c.created_by === 'sonda_jornada' && /^TESTE/.test(String(c.cliente_nome ?? ''));

export function mountJornadaMensagens(router: Router): void {
  const base = [exigeConsultor, semCache, exigeAdm];

  router.get('/jornada-solar/mensagens', ...base, async (_req: Request, res: Response) => {
    try { res.json(await corpoDoGet()); } catch (err) { falhouJornada(res, 'mensagens', err, true); }
  });

  router.put('/jornada-solar/mensagens', ...base, async (req: Request, res: Response) => {
    const b = corpoDe(req);
    if (!b || typeof b.grupo !== 'string' || !(GRUPOS_MSG as readonly string[]).includes(b.grupo) || typeof b.ligado !== 'boolean') {
      res.status(400).json({ ok: false, error: MSG_PEDIDO }); return;
    }
    try {
      await gravarGrupo(b.grupo as GrupoMsg, b.ligado, quem(req).nome, new Date());
      res.json(await corpoDoGet());
    } catch (err) {
      if (err instanceof ErroJornada && err.codigo === 'ordem') { logErroJornada('mensagens_ordem', err); res.status(409).json({ ok: false, error: MSG_ORDEM }); return; }
      falhouJornada(res, 'mensagens_ligar', err);
    }
  });

  router.post('/jornada-solar/mensagens/sonda', ...base, async (req: Request, res: Response) => {
    const b = corpoDe(req);
    const card = b && typeof b.card === 'number' && Number.isInteger(b.card) && b.card > 0 ? b.card : null;
    const acao = b && typeof b.acao === 'string' ? b.acao : '';
    if (!card || !['simular', 'abrir', 'rodar', 'ler', 'desfazer'].includes(acao)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    try {
      const info = (await lerCardsPorIds([card])).get(card);
      if (!info) { res.status(404).json({ ok: false, error: 'Venda não encontrada.' }); return; }
      const daSonda = ehCardDaSonda(info);

      if (acao === 'simular') {
        const [{ estado: js }, { estado: jo }] = await Promise.all([lerJornadaComVersao(card), lerObraComVersao(card)]);
        const zero = new Date(0).toISOString();
        const vendedor = js?.vendedor || String(info.vendedor_nome ?? '').trim().toLowerCase();
        const eventos = eventosDoCard({ card, js, jo, vendedor }, new Date(), { venda: zero, etapa: zero, fila: null, liberacao: null, aniversario: null },
          { aceitarSonda: daSonda, equipeVenda: Object.keys(TEL_AVISO) });
        const estado = js || jo ? 'gravado' : ehCardSolarVendido(info) ? 'deduzido' : 'sem_trilho';
        res.json({ ok: true, estado, eventos: eventos.map((e) => ({ tipo: e.tipo, etapa: e.etapa, em: e.em, por: e.por, para: e.para })) });
        return;
      }
      if (!daSonda) { res.status(403).json({ ok: false, error: MSG_SO_SONDA }); return; }

      if (acao === 'abrir') {
        const { estado } = await lerJornadaComVersao(card);
        if (!estado || estado.etapas[1].concluida_em) { res.status(409).json({ ok: false, error: 'A etapa 1 precisa estar aberta.' }); return; }
        const r = await mudarJornada(card, () => estado, (e) => {
          if (e.etapas[1].concluida_em) return { recusa: 'A etapa 1 precisa estar aberta.', http: 409 };
          const agora = new Date().toISOString();
          return {
            ...e,
            etapas: { ...e.etapas, 1: { ...e.etapas[1], concluida_em: agora, concluida_por: 'sonda' }, 2: { ...e.etapas[2], aberta_em: agora } },
            historico: [...e.historico, { em: agora, por: 'sonda', acao: 'concluir' as const, etapa: 1 }].slice(-50),
          };
        });
        if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
        res.json({ ok: true, etapa_atual: 2 });
        return;
      }

      const carimbos = async (): Promise<Linha[]> => (await linhasDe(PREFIXO_ENV)).filter((l) => new RegExp(`^${PREFIXO_ENV}(venda|sua|espera):${card}:`).test(l.key));
      if (acao === 'rodar') {
        const r = await rodarSondaDoCard(card);
        if (!r) { res.status(503).json({ ok: false, error: 'Não consegui ler agora.' }); return; }
        res.json({ ok: true, travadas: r.travadas, ja_travadas: r.ja_travadas, enviados: 0, transporte: 'falso' });
        return;
      }
      if (acao === 'ler') {
        const total = prefixosTotalDaLinha();
        res.json({
          ok: true,
          chaves: (await carimbos()).map((l) => ({
            key: l.key, robo: String(l.value?.robo ?? ''), sonda: l.value?.sonda === true, enviado: l.value?.enviado === true,
            em: String(l.value?.em ?? l.updated_at ?? ''), conta_na_linha: total.some((p) => l.key.startsWith(p)),
          })),
        });
        return;
      }
      // desfazer: apaga SÓ as chaves da sonda.
      const dela = (await carimbos()).filter((l) => l.value?.sonda === true).map((l) => l.key);
      if (dela.length) {
        const { error } = await supabase.from('system_state').delete().in('key', dela);
        if (error) throw new ErroJornada('desfazer');
      }
      res.json({ ok: true, apagadas: dela.length });
    } catch (err) { falhouJornada(res, 'sonda', err); }
  });
}
