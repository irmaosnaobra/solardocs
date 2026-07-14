// ─── Disciplina das ordens de tráfego (lifecycle persistido) ─────────────────
// Fonte da verdade das ordens: painel E robô leem/escrevem aqui. Cada ordem é
// uma instância time-boxed: nasce 'pendente' com prazo (Escalar 24h · Pausar
// 12h), o usuário marca 'feita' (readback confirma), e ao vencer o sistema
// RECONFERE no Meta → 'perdida' (condição ainda valia = perdeu a janela) ou
// 'vencida' (número mudou/já agiu = não é culpa). Ver memória.

import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { fetchMetaEntities, gerarOrdens, fetchBudgets, type Ordem } from './metaAdsFullService';
import { computeAllSignals } from './metaSignalsService';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '';

const N = (v: string | undefined, def: number) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : def);
// Prazos (env override). Escalar 24h · Pausar 12h.
const PRAZO_ESCALAR_H = N(process.env.ORD_PRAZO_ESCALAR, 24);
const PRAZO_PAUSAR_H  = N(process.env.ORD_PRAZO_PAUSAR, 12);
// Cooldown pós-FEITA por TIPO (timing: não travar escala boa). AUMENTAR = 24h
// (piso do pixel — não dá pra confirmar antes; rocket ROAS-16x reavaliado em 1 dia,
// não 2). DUPLICAR = 48h (a cópia precisa amadurecer). PAUSAR não usa cooldown.
// 'perdida'/'vencida' NÃO entram no cooldown — re-emitem (pausar re-emite já).
const COOLDOWN_AUMENTAR_H = N(process.env.ORD_COOLDOWN_AUMENTAR, 24);
const COOLDOWN_DUPLICAR_H = N(process.env.ORD_COOLDOWN_DUPLICAR, 48);
function cooldownDoTipo(tipo: string): number {
  return tipo === 'DUPLICAR' ? COOLDOWN_DUPLICAR_H : COOLDOWN_AUMENTAR_H;
}

// Chave de dedup. CBO + ordem de orçamento → keia por CAMPANHA (uma só por
// campanha, senão aumentaria a mesma campanha 2x). ABO e PAUSAR → por conjunto.
function chaveDe(o: Ordem, onde?: 'conjunto' | 'campanha'): string {
  const p = o.tipo === 'DUPLICAR' ? 'dup' : o.tipo === 'AUMENTAR' ? 'up' : o.tipo === 'PAUSAR' ? 'pause' : 'obs';
  const ehOrcamento = o.tipo === 'DUPLICAR' || o.tipo === 'AUMENTAR';
  if (onde === 'campanha' && ehOrcamento && o.entity.campaign_id) return `${p}:camp:${o.entity.campaign_id}`;
  return `${p}:${o.entity.id}`;
}
function prazoHoras(tipo: string): number {
  return tipo === 'PAUSAR' ? PRAZO_PAUSAR_H : PRAZO_ESCALAR_H;
}

export interface OrdemRow {
  id: string; criada_em: string; chave: string; tipo: string;
  adset_id: string; adset_nome: string | null; campanha_nome: string | null;
  motivo: string; como_fazer: string; score: number | null; leitura: string | null;
  estado: string; expira_em: string;
  feita_em: string | null; feita_por: string | null;
  confirmacao: string | null; confirmacao_detalhe: string | null; confirmada_em: string | null;
  resolvida_em: string | null; resolucao_detalhe: string | null;
  snapshot: Record<string, unknown> | null;
}

// ── SYNC: gera ordens frescas (last_3d) e persiste as NOVAS como pendentes ──
// Não duplica: se já existe uma pendente pra mesma chave, mantém. Cada ordem
// carrega o snapshot dos números + os sinais do especialista.
export async function sincronizarOrdens(): Promise<{ criadas: number; jaAbertas: number }> {
  const [adsets3d, signals, budgets] = await Promise.all([
    fetchMetaEntities('adset', 'last_3d'),
    computeAllSignals(30).catch(() => new Map()),  // 30d: veredito cruzado precisa da janela longa
    fetchBudgets().catch(() => new Map()),          // ABO/CBO: dedup de orçamento por campanha
  ]);
  // Cérebro único: ordem = veredito multi-janela (não thresholds de 3d).
  // budgets → CBO vira 1 ordem por campanha (não por conjunto).
  const ordens = gerarOrdens(adsets3d, signals, budgets).filter(o => o.tipo !== 'MANTER' && o.tipo !== 'OBSERVAR');

  // Anti-duplicação: pula uma chave se (a) já tem ordem PENDENTE aberta, OU
  // (b) foi marcada FEITA há menos que o cooldown do tipo. 'perdida'/'vencida'
  // NÃO bloqueiam → re-emitem na próxima janela. Sem isto, marcar feito devolvia
  // a ordem à fila na hora (gerarOrdens recria: duplicar não baixa o ROAS do original).
  const nowMs = Date.now();
  const maxCooldownH = Math.max(COOLDOWN_AUMENTAR_H, COOLDOWN_DUPLICAR_H);
  const desde = new Date(nowMs - maxCooldownH * 3600_000).toISOString();
  // 2 queries limpas em vez de um .or() aninhado frágil (PostgREST). CHECA error:
  // se falhar e ignorássemos, bloqueadas ficaria vazio → toda ordem recria a cada
  // sync → "feito" voltaria pra fila silenciosamente (bug do R$0/timezone de novo).
  const [pendRes, feitasRes] = await Promise.all([
    supabase.from('mm_ordens').select('chave').eq('estado', 'pendente'),
    supabase.from('mm_ordens').select('chave, tipo, feita_em').eq('estado', 'feita').gte('feita_em', desde),
  ]);
  if (pendRes.error)  { logger.error('ordens', 'dedup pendentes falhou', pendRes.error); throw new Error(pendRes.error.message); }
  if (feitasRes.error){ logger.error('ordens', 'dedup feitas falhou', feitasRes.error); throw new Error(feitasRes.error.message); }

  const bloqueadas = new Set<string>();
  for (const r of (pendRes.data ?? [])) bloqueadas.add(r.chave);
  for (const r of (feitasRes.data ?? [])) {
    // feita dentro do cooldown do TIPO? AUMENTAR 24h · DUPLICAR 48h (timing:
    // não travar escala de máquina boa por 2 dias).
    const cdH = cooldownDoTipo(r.tipo);
    if (r.feita_em && new Date(r.feita_em).getTime() > nowMs - cdH * 3600_000) bloqueadas.add(r.chave);
  }

  const ondeDe = (o: Ordem) => budgets.get(o.entity.id)?.onde;
  const novas = ordens.filter(o => !bloqueadas.has(chaveDe(o, ondeDe(o))));
  if (!novas.length) return { criadas: 0, jaAbertas: bloqueadas.size };

  const rows = novas.map(o => {
    const sig = signals.get(o.entity.id) as any;
    const e = o.entity;
    return {
      chave: chaveDe(o, ondeDe(o)), tipo: o.tipo, adset_id: e.id,
      adset_nome: e.name, campanha_nome: e.campaign_name ?? null,
      motivo: o.motivo, como_fazer: o.comoFazer,
      score: sig?.score ?? null, leitura: sig?.leitura ?? null,
      estado: 'pendente',
      expira_em: new Date(nowMs + prazoHoras(o.tipo) * 3600_000).toISOString(),
      // snapshot guarda as JANELAS (30d/14d/7d/3d) + veredito → a explicação
      // persiste na ordem (escola: você vê depois por que foi decidido assim).
      snapshot: {
        spend: e.spend, roas: e.roas, purchases: e.purchases,
        janelas: sig?.janelas ?? null,
        veredito: sig?.veredito ?? null,
        concordancia: sig?.veredito?.concordancia ?? null,
      },
    };
  });
  // Insere UMA A UMA: se duas execuções (painel, cron, robô) sincronizarem ao
  // mesmo tempo, o índice único parcial (chave WHERE pendente) faz a 2ª falhar —
  // per-row degrada pra "pula essa", não "perde o lote todo".
  let criadas = 0;
  for (const row of rows) {
    const { error } = await supabase.from('mm_ordens').insert(row);
    if (!error) criadas++;
    else if (!/duplicate key|unique/i.test(error.message)) {
      logger.error('ordens', 'sincronizar insert falhou', error);
    }
  }
  return { criadas, jaAbertas: bloqueadas.size };
}

// ── EXPIRAR: pega pendentes vencidas e reconfere no Meta ──
// Reconferência: a condição da ordem AINDA vale? Sim → 'perdida' (perdeu a
// janela). Não (número mudou/já agiu) → 'vencida' (não é culpa). Requer o
// snapshot + números atuais do adset.
export async function expirarOrdens(): Promise<{ perdidas: number; vencidas: number }> {
  const nowIso = new Date().toISOString();
  const { data: vencidas } = await supabase
    .from('mm_ordens').select('*')
    .eq('estado', 'pendente').lt('expira_em', nowIso);
  if (!vencidas?.length) return { perdidas: 0, vencidas: 0 };

  // Reconfere com o MESMO cérebro que gerou a ordem: o veredito multi-janela.
  // (Antes usava thresholds de 3d — divergiria do que criou a ordem, causando
  // falso "perdida". A regra tem que ser a mesma na criação e no vencimento.)
  const signals = await computeAllSignals(30).catch(() => new Map());

  let perdidas = 0, vencidasC = 0;
  for (const o of vencidas as OrdemRow[]) {
    const v = signals.get(o.adset_id)?.veredito;
    // A condição ainda vale se o veredito ATUAL ainda pede a MESMA ação.
    const aindaVale = !!v && v.tipo === o.tipo;
    if (aindaVale) {
      await supabase.from('mm_ordens').update({
        estado: 'perdida', resolvida_em: nowIso,
        resolucao_detalhe: 'Prazo acabou e a condição ainda valia — janela perdida.',
      }).eq('id', o.id);
      perdidas++;
    } else {
      await supabase.from('mm_ordens').update({
        estado: 'vencida', resolvida_em: nowIso,
        resolucao_detalhe: v ? `Os números mudaram — agora o veredito é "${v.tipo}", não se aplica mais (ok).` : 'Conjunto sem entrega agora — ordem não se aplica mais.',
      }).eq('id', o.id);
      vencidasC++;
    }
  }
  return { perdidas, vencidas: vencidasC };
}

// ── MARCAR FEITA + confirmar no readback ──
// PAUSAR: lê effective_status (espera PAUSED) → confirmada/divergente.
// AUMENTAR: lê budget (não temos o "antes" preciso aqui) → auto_atestada c/ nota.
// DUPLICAR: não dá pra saber qual é a cópia → auto_atestada.
export async function marcarFeita(ordemId: string, quem: string): Promise<OrdemRow | null> {
  const { data: o } = await supabase.from('mm_ordens').select('*').eq('id', ordemId).maybeSingle();
  if (!o || o.estado !== 'pendente') return null;
  const ordem = o as OrdemRow;
  const nowIso = new Date().toISOString();

  let confirmacao = 'auto_atestada';
  let detalhe = 'Você marcou como feito. (Não dá pra confirmar automaticamente esse tipo.)';

  if (ordem.tipo === 'PAUSAR') {
    const status = await lerStatusAdset(ordem.adset_id);
    if (status === 'PAUSED' || status === 'ADSET_PAUSED' || status === 'CAMPAIGN_PAUSED') {
      confirmacao = 'confirmada'; detalhe = 'Confirmado no Meta: o conjunto está pausado. ✅';
    } else if (status) {
      confirmacao = 'divergente'; detalhe = `Atenção: o Meta diz que o conjunto está "${status}", não pausado. Confere lá.`;
    } else {
      detalhe = 'Marcado como feito (não consegui ler o status no Meta agora).';
    }
  } else if (ordem.tipo === 'DUPLICAR') {
    detalhe = 'Você marcou como feito. Duplicata é um conjunto novo (ID novo) — confirmação manual.';
  } else if (ordem.tipo === 'AUMENTAR') {
    detalhe = 'Você marcou como feito. Confere no Gerenciador se o orçamento subiu ~30%.';
  }

  await supabase.from('mm_ordens').update({
    estado: 'feita', feita_em: nowIso, feita_por: quem,
    confirmacao, confirmacao_detalhe: detalhe, confirmada_em: nowIso,
  }).eq('id', ordemId);

  return { ...ordem, estado: 'feita', feita_em: nowIso, feita_por: quem, confirmacao, confirmacao_detalhe: detalhe, confirmada_em: nowIso };
}

async function lerStatusAdset(adsetId: string): Promise<string | null> {
  if (!TOKEN) return null;
  try {
    const res = await fetch(`${GRAPH}/${adsetId}?fields=effective_status&access_token=${TOKEN}`);
    const j = await res.json() as { effective_status?: string };
    return j.effective_status ?? null;
  } catch { return null; }
}

// ── Ler/gravar modo manual|automático ──
export async function getModo(): Promise<'manual' | 'automatico'> {
  const { data } = await supabase.from('mm_ordens_config').select('modo').eq('id', 1).maybeSingle();
  return (data?.modo === 'automatico' ? 'automatico' : 'manual');
}
export async function setModo(modo: 'manual' | 'automatico'): Promise<void> {
  await supabase.from('mm_ordens_config').update({ modo, atualizado_em: new Date().toISOString() }).eq('id', 1);
}

// ── Listar ordens pro painel (pendentes primeiro, depois histórico recente) ──
export async function listarOrdens(limitHistorico = 40): Promise<{ pendentes: OrdemRow[]; historico: OrdemRow[]; modo: string }> {
  const [{ data: pend }, { data: hist }, modo] = await Promise.all([
    supabase.from('mm_ordens').select('*').eq('estado', 'pendente').order('expira_em', { ascending: true }),
    supabase.from('mm_ordens').select('*').neq('estado', 'pendente').order('resolvida_em', { ascending: false, nullsFirst: false }).order('criada_em', { ascending: false }).limit(limitHistorico),
    getModo(),
  ]);
  return { pendentes: (pend ?? []) as OrdemRow[], historico: (hist ?? []) as OrdemRow[], modo };
}

// ── Robô WhatsApp: pega ordens PENDENTES ainda não alertadas ──
// Fonte da verdade única: o robô lê daqui (não do gerarOrdens direto). Ordem
// feita/perdida/vencida não é pendente → nunca re-alerta. Motivo/como/leitura
// vêm da linha persistida → WhatsApp e painel dizem EXATAMENTE a mesma coisa.
export async function ordensPendentesNaoAlertadas(): Promise<OrdemRow[]> {
  const { data, error } = await supabase
    .from('mm_ordens').select('*')
    .eq('estado', 'pendente').is('alertado_em', null)
    .order('criada_em', { ascending: true });
  if (error) { logger.error('ordens', 'pendentes-nao-alertadas falhou', error); return []; }
  return (data ?? []) as OrdemRow[];
}

// Carimba as ordens como alertadas (após enviar o WhatsApp).
export async function marcarAlertadas(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await supabase.from('mm_ordens').update({ alertado_em: new Date().toISOString() }).in('id', ids);
}

// ── Tick do cron: expira vencidas + sincroniza novas. Roda de hora em hora. ──
export async function tickOrdens(): Promise<{ expiradas: { perdidas: number; vencidas: number }; sync: { criadas: number; jaAbertas: number } }> {
  const expiradas = await expirarOrdens();       // primeiro fecha as vencidas
  const sync = await sincronizarOrdens();          // depois abre as novas
  logger.info('ordens', `tick: +${sync.criadas} novas, ${expiradas.perdidas} perdidas, ${expiradas.vencidas} vencidas`);
  return { expiradas, sync };
}
