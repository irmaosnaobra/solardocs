// ─────────────────────────────────────────────────────────────────────────────
// MEDIDOR DOS PIXELS DO META: duas tarefas do /cron/master que só LEEM do Meta.
//
// 1) medirQualidadeSemanal: toda segunda, a partir das 12:00 UTC, pergunta à
//    Dataset Quality API a nota de correspondência de cada evento dos 3 pixels
//    (SolarDoc, Solar, Eletroposto) e grava uma linha por pixel x evento em
//    `meta_qualidade_dataset` (banco do Gerador). Purchase, Lead, Schedule ou
//    CompleteRegistration abaixo de 8 vira e-mail com as 2 chaves que mais faltam.
//
// 2) conferirMetaVsBanco: todo dia, depois das 11:00 UTC, confere se o Meta e o
//    banco contam o mesmo número de compras (SolarDoc, `sales`) e de
//    agendamentos (solar e eletroposto, `agendamentos`) nos últimos 7 dias
//    completos (dia de Brasília), por campanha. Diferença de 30% ou mais, com
//    3 ou mais eventos no maior lado, vira e-mail. O resultado da última
//    conferência fica em system_state, chave `conferencia_meta_banco`.
//
// REGRAS DAS DUAS
//  - Só GET no Meta, nunca POST (a função `getMeta` não aceita outro método).
//  - O relógio do servidor é UTC: as horas de corte são comparadas em UTC. Só a
//    janela de dias da conferência é de Brasília (-3 h), porque é o dia do Meta e do painel.
//  - MEDIDOR_META_OFF=1 desliga as duas. `dry: true` pula o horário e a trava,
//    não grava e não avisa: devolve o que faria (a leitura do Meta continua, é GET).
//  - Nunca lança: o master roda isso dentro do allSettled e uma falha aqui não pode custar outra tarefa.
//  - A trava só é gravada depois que a medição entrou: falha deixa a rodada
//    seguinte (de hora em hora) tentar de novo no mesmo dia/semana.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendOpsAlert } from '../../utils/mailer';
import { PIXEL_SOLAR, PIXEL_ELETROPOSTO, PIXEL_SOLARDOC } from '../../utils/metaCapi';
import { produtoDaCampanha, lerMapaCampanhaProduto, type ProdutoCampanha } from '../io/metaConjuntos';

const GRAPH = 'https://graph.facebook.com/v21.0';
const CAMPOS_QUALIDADE = 'web{event_name,event_match_quality,event_coverage,dedupe_key_feedback,data_freshness,acr}';
const PAGINA = 1000;
const MAX_PAGINAS_META = 10;
const DIA_MS = 24 * 3600 * 1000;

/** Abaixo disto o evento chave vira aviso. */
export const NOTA_MINIMA = 8;
export const EVENTOS_CHAVE = ['Purchase', 'Lead', 'Schedule', 'CompleteRegistration'] as const;
/** Diferença mínima entre Meta e banco (fração do maior lado) e volume mínimo para avisar. */
export const DIF_MINIMA = 0.3;
export const VOLUME_MINIMO = 3;

/** As chaves de correspondência que a tabela de aviso olha (nome da API do Meta). */
const CHAVES = ['email', 'phone', 'fn', 'ln', 'external_id', 'fbc', 'fbp', 'ip_address', 'user_agent'] as const;

export const CHAVE_CONFERENCIA = 'conferencia_meta_banco';
export const chaveSemana = (semanaIso: string) => `meta_qualidade_semana:${semanaIso}`;

const PIXELS: Array<{ id: string; produto: ProdutoCampanha }> = [
  { id: PIXEL_SOLARDOC, produto: 'solardoc' },
  { id: PIXEL_SOLAR, produto: 'solar' },
  { id: PIXEL_ELETROPOSTO, produto: 'eletroposto' },
];

// Lidos na hora da chamada, nunca no import: o teste troca o env entre um caso e outro.
const token = (): string => (process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '').trim();
const desligado = (): boolean => ['1', 'true'].includes(String(process.env.MEDIDOR_META_OFF || '').trim().toLowerCase());
const contaMeta = (): string => {
  const c = (process.env.META_MONITOR_ACCOUNT_ID || 'act_545732112868250').trim();
  return /^\d+$/.test(c) ? `act_${c}` : c;
};

// ── Tempo ────────────────────────────────────────────────────────────────────

/** Semana ISO de um instante, em UTC: "2026-W46". */
export function semanaISO(agora: number): string {
  const d0 = new Date(agora);
  const t = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3); // a quinta-feira da semana decide o ano
  const ano = t.getUTCFullYear();
  const q = new Date(Date.UTC(ano, 0, 4));
  q.setUTCDate(q.getUTCDate() - ((q.getUTCDay() + 6) % 7) + 3);
  const semana = 1 + Math.round((t.getTime() - q.getTime()) / (7 * DIA_MS));
  return `${ano}-W${String(semana).padStart(2, '0')}`;
}

const diaUTC = (agora: number): string => new Date(agora).toISOString().slice(0, 10);
/** Dia de Brasília (AAAA-MM-DD). */
const diaBRT = (agora: number): string => new Date(agora - 3 * 3600 * 1000).toISOString().slice(0, 10);
const somaDias = (dia: string, n: number): string => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

/** Os 7 dias completos que terminam ontem (Brasília). `deUtc`/`ateUtc`: o mesmo intervalo em UTC, fim exclusivo. */
export function janelaSeteDias(agora: number): { desde: string; ate: string; deUtc: string; ateUtc: string } {
  const ate = somaDias(diaBRT(agora), -1);
  const desde = somaDias(ate, -6);
  return {
    desde, ate,
    deUtc: new Date(Date.parse(`${desde}T00:00:00Z`) + 3 * 3600 * 1000).toISOString(),
    ateUtc: new Date(Date.parse(`${somaDias(ate, 1)}T00:00:00Z`) + 3 * 3600 * 1000).toISOString(),
  };
}

// ── Meta (só GET) ────────────────────────────────────────────────────────────

/** Única porta para o Meta: GET. O token vai no cabeçalho, nunca na URL nem em log. */
async function getMeta(caminho: string, params: Record<string, string>): Promise<any> {
  const r = await fetch(`${GRAPH}/${caminho}?${new URLSearchParams(params)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(20000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j?.error) throw new Error(`Meta ${r.status}: ${String(j?.error?.message || 'sem detalhe').slice(0, 200)}`);
  return j;
}

// ── 1) Qualidade semanal ─────────────────────────────────────────────────────

export interface LinhaQualidade {
  medido_em: string;
  dataset_id: string;
  produto: string;
  event_name: string | null;
  nota: number | null;
  cobertura: unknown[] | null;
  bruto: Record<string, unknown>;
}

/** PURA: a resposta da Dataset Quality API de UM pixel vira as linhas da tabela. `{}` (sem volume) vira uma linha vazia. */
export function linhasDaResposta(datasetId: string, produto: string, resposta: any, medidoEm: string): LinhaQualidade[] {
  const web: any[] = Array.isArray(resposta?.web) ? resposta.web : [];
  if (!web.length) {
    return [{ medido_em: medidoEm, dataset_id: datasetId, produto, event_name: null, nota: null, cobertura: null, bruto: {} }];
  }
  return web.map((e) => {
    const q = e?.event_match_quality;
    const nota = q && q.composite_score !== undefined && q.composite_score !== null ? Number(q.composite_score) : null;
    return {
      medido_em: medidoEm,
      dataset_id: datasetId,
      produto,
      event_name: e?.event_name != null ? String(e.event_name) : null,
      nota: nota !== null && Number.isFinite(nota) ? nota : null,
      cobertura: Array.isArray(q?.match_key_feedback) ? q.match_key_feedback : null,
      bruto: e && typeof e === 'object' ? e : {},
    };
  });
}

/** As 2 chaves de menor cobertura (chave ausente da lista conta 0%), no formato "phone 33%". */
export function chavesQueFaltam(cobertura: unknown[] | null): string[] {
  const por = new Map<string, number>();
  for (const k of (cobertura || []) as any[]) {
    if (k?.identifier) por.set(String(k.identifier), Number(k?.coverage?.percentage ?? 0));
  }
  return CHAVES.map((c) => [c, por.get(c) ?? 0] as [string, number])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([c, v]) => `${c} ${Math.round(v)}%`);
}

/** PURA: quais linhas pedem aviso (evento chave com nota abaixo de 8; sem nota não avisa). */
export function linhasAbaixoDaNota(linhas: LinhaQualidade[]): LinhaQualidade[] {
  return linhas.filter((l) => l.event_name && (EVENTOS_CHAVE as readonly string[]).includes(l.event_name) && l.nota !== null && l.nota < NOTA_MINIMA);
}

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const TD = 'style="padding:4px 8px;border-bottom:1px solid #e2e8f0;"';

function htmlQualidade(ruins: LinhaQualidade[], erros: string[]): string {
  const corpo = ruins.map((l) =>
    `<tr><td ${TD}>${esc(l.produto)}</td><td ${TD}>${esc(l.event_name)}</td><td ${TD}>${esc(l.nota)}</td><td ${TD}>${esc(chavesQueFaltam(l.cobertura).join(', '))}</td></tr>`).join('');
  return (ruins.length
    ? `<p>Evento chave com nota de correspondência abaixo de ${NOTA_MINIMA} na medição semanal do Meta:</p>
       <table style="border-collapse:collapse;font-size:14px;"><tr><th align="left" ${TD}>Pixel</th><th align="left" ${TD}>Evento</th><th align="left" ${TD}>Nota</th><th align="left" ${TD}>Chaves que mais faltam</th></tr>${corpo}</table>`
    : '')
    + (erros.length ? `<p>Pixel que o Meta não respondeu: ${esc(erros.join('; '))}</p>` : '');
}

export interface RelatorioQualidade {
  dry: boolean;
  pulado?: string;
  semana?: string;
  pixels?: Array<{ pixel: string; produto: string; eventos: number; erro?: string }>;
  linhas?: number;
  abaixoDeOito?: Array<{ produto: string; evento: string | null; nota: number | null; faltam: string[] }>;
  avisou?: boolean;
  erro?: string;
  /** Só no dry: as linhas que seriam gravadas. */
  seriaGravado?: LinhaQualidade[];
}

/** Prazo TOTAL de cada tarefa (qualidade e conferência). Estourou: termina sem gravar o que falta, e o resultado diz `prazo estourado`. */
export const PRAZO_TAREFA_MS = 60_000;
export const PRAZO_ESTOURADO = 'prazo estourado';

/**
 * Corre o corpo contra o prazo total. Ao estourar, `cancelado()` vira true (o corpo não começa mais nenhuma gravação nem aviso),
 * o resultado sai com `erro: 'prazo estourado'` e nada lança. O que o corpo ainda devolver depois do prazo é descartado.
 */
async function comPrazo<T extends { dry: boolean; erro?: string }>(
  nome: string, dry: boolean, ms: number, corpo: (cancelado: () => boolean) => Promise<T>,
): Promise<T> {
  let cancelada = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      cancelada = true;
      logger.warn(nome, `${PRAZO_ESTOURADO}: a tarefa passou de ${ms} ms e terminou sem gravar o que faltava`);
      resolve({ dry, erro: PRAZO_ESTOURADO } as T);
    }, ms);
  });
  const rodada = corpo(() => cancelada).catch((e): T => ({ dry, erro: String((e as Error)?.message || e) } as T));
  try {
    return await Promise.race([rodada, limite]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function medirQualidadeSemanal(opts: { dry?: boolean; agora?: number; prazoMs?: number } = {}): Promise<RelatorioQualidade> {
  return comPrazo('medidor-qualidade', !!opts.dry, opts.prazoMs ?? PRAZO_TAREFA_MS, (cancelado) => medirQualidade(opts, cancelado));
}

async function medirQualidade(opts: { dry?: boolean; agora?: number }, cancelado: () => boolean): Promise<RelatorioQualidade> {
  const dry = !!opts.dry;
  const agora = opts.agora ?? Date.now();
  const rel: RelatorioQualidade = { dry };
  try {
    if (desligado()) return { ...rel, pulado: 'desligado' };
    if (!token()) return { ...rel, pulado: 'sem_token' };
    const d = new Date(agora);
    if (!dry && !(d.getUTCDay() === 1 && d.getUTCHours() >= 12)) return { ...rel, pulado: 'fora_do_horario' };

    const semana = semanaISO(agora);
    rel.semana = semana;
    const chave = chaveSemana(semana);
    if (!dry) {
      const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
      if (data?.value) return { ...rel, pulado: 'semana_ja_rodou' };
    }

    const medidoEm = new Date(agora).toISOString();
    const linhas: LinhaQualidade[] = [];
    const erros: string[] = [];
    rel.pixels = [];
    for (const p of PIXELS) {
      if (cancelado()) return rel;
      try {
        const r = await getMeta('dataset_quality', { dataset_id: p.id, fields: CAMPOS_QUALIDADE });
        const l = linhasDaResposta(p.id, p.produto, r, medidoEm);
        linhas.push(...l);
        rel.pixels.push({ pixel: p.id, produto: p.produto, eventos: l.filter((x) => x.event_name).length });
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        erros.push(`${p.produto}: ${msg}`);
        rel.pixels.push({ pixel: p.id, produto: p.produto, eventos: 0, erro: msg });
        logger.warn('medidor-qualidade', `pixel ${p.produto} falhou`, msg);
      }
    }
    rel.linhas = linhas.length;
    const ruins = linhasAbaixoDaNota(linhas);
    rel.abaixoDeOito = ruins.map((l) => ({ produto: l.produto, evento: l.event_name, nota: l.nota, faltam: chavesQueFaltam(l.cobertura) }));

    if (dry) { rel.seriaGravado = linhas; rel.avisou = false; return rel; }
    // Nenhum pixel respondeu: não grava nada e não trava, a próxima rodada tenta de novo.
    if (!linhas.length) { rel.erro = erros.join('; ') || 'sem dados'; return rel; }

    // Estourou o prazo: nada é gravado (nem as linhas, nem a trava da semana: a próxima rodada mede tudo de novo).
    if (cancelado()) return rel;
    const { error } = await supabaseGerador.from('meta_qualidade_dataset').insert(linhas);
    if (error) { rel.erro = `gravar: ${error.message}`; logger.error('medidor-qualidade', 'gravar falhou', error); return rel; }
    const { error: erroTrava } = await supabase.from('system_state').upsert(
      { key: chave, value: { em: medidoEm, linhas: linhas.length, erros: erros.length }, updated_at: medidoEm }, { onConflict: 'key' });
    if (erroTrava) logger.error('medidor-qualidade', 'gravar trava da semana falhou', erroTrava);

    if ((ruins.length || erros.length) && !cancelado()) {
      try {
        await sendOpsAlert(`Pixels do Meta: ${ruins.length ? `${ruins.length} evento(s) com nota abaixo de ${NOTA_MINIMA}` : 'pixel sem resposta'}`, htmlQualidade(ruins, erros));
        rel.avisou = true;
      } catch (e) {
        logger.warn('medidor-qualidade', 'aviso por e-mail falhou', String((e as Error)?.message || e));
      }
    }
    return rel;
  } catch (e) {
    logger.error('medidor-qualidade', 'rodada falhou', e);
    return { ...rel, erro: String((e as Error)?.message || e) };
  }
}

// ── 2) Meta x banco ──────────────────────────────────────────────────────────

export interface LinhaConferencia {
  campanha_id: string;
  campanha: string;
  produto: ProdutoCampanha;
  metrica: 'compras' | 'agendamentos';
  meta: number;
  banco: number;
  difPct: number;
  alerta: boolean;
}

const norm = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const valorDe = (lista: unknown, tipos: string[]): number => {
  for (const t of tipos) {
    const a = (Array.isArray(lista) ? lista : []).find((x: any) => x?.action_type === t);
    if (a) return Number(a.value || 0);
  }
  return 0;
};

/** PURA: Meta e banco divergem o bastante para avisar? 30% do maior lado, e o maior lado com 3 ou mais. */
export function divergiu(meta: number, banco: number): boolean {
  const maior = Math.max(meta, banco);
  return maior >= VOLUME_MINIMO && Math.abs(meta - banco) / maior >= DIF_MINIMA;
}

interface CampanhaMeta { id: string; nome: string; compras: number; agendamentos: number }

/** Insights por campanha: compras de `actions` (purchase), agendamentos de `conversions` (Schedule só vem lá). */
async function insightsPorCampanha(desde: string, ate: string): Promise<CampanhaMeta[]> {
  const mapa = new Map<string, CampanhaMeta>();
  let after: string | undefined;
  for (let p = 0; p < MAX_PAGINAS_META; p++) {
    const j = await getMeta(`${contaMeta()}/insights`, {
      level: 'campaign', limit: '500',
      fields: 'campaign_id,campaign_name,actions,conversions',
      time_range: JSON.stringify({ since: desde, until: ate }),
      ...(after ? { after } : {}),
    });
    for (const l of (Array.isArray(j.data) ? j.data : [])) {
      const id = String(l.campaign_id || '');
      if (!id) continue;
      const atual = mapa.get(id) || { id, nome: String(l.campaign_name || id), compras: 0, agendamentos: 0 };
      atual.compras += valorDe(l.actions, ['purchase']);
      atual.agendamentos += valorDe(l.conversions, ['schedule_total', 'schedule_website']);
      mapa.set(id, atual);
    }
    after = j.paging?.next ? j.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  return [...mapa.values()];
}

async function lerPaginado(consulta: (de: number, ate: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<any[]> {
  const todas: any[] = [];
  for (let k = 0; k < 100; k++) {
    const { data, error } = await consulta(k * PAGINA, (k + 1) * PAGINA - 1);
    if (error) throw new Error(String(error.message || error));
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return todas;
}

/** PURA: cruza as campanhas do Meta com as contagens do banco (utm_campaign = id da campanha ou o nome dela). */
export function cruzar(
  campanhas: CampanhaMeta[],
  mapaProduto: Record<string, string>,
  vendas: Array<{ utm_campaign: string | null }>,
  agendamentos: Array<{ utm_campaign: string | null }>,
): { linhas: LinhaConferencia[]; semCampanhaNoMeta: { compras: number; agendamentos: number }; semProduto: string[] } {
  const porId = new Map(campanhas.map((c) => [c.id, c]));
  const porNome = new Map(campanhas.map((c) => [norm(c.nome), c]));
  const achar = (utm: string | null): CampanhaMeta | null => {
    const u = String(utm ?? '').trim();
    if (!u) return null;
    return porId.get(u) ?? porNome.get(norm(u)) ?? null;
  };
  const contaVendas = new Map<string, number>();
  const contaAgend = new Map<string, number>();
  const semCampanhaNoMeta = { compras: 0, agendamentos: 0 };
  for (const v of vendas) {
    if (!String(v.utm_campaign ?? '').trim()) continue;
    const c = achar(v.utm_campaign);
    if (c) contaVendas.set(c.id, (contaVendas.get(c.id) || 0) + 1); else semCampanhaNoMeta.compras++;
  }
  for (const a of agendamentos) {
    if (!String(a.utm_campaign ?? '').trim()) continue;
    const c = achar(a.utm_campaign);
    if (c) contaAgend.set(c.id, (contaAgend.get(c.id) || 0) + 1); else semCampanhaNoMeta.agendamentos++;
  }

  const linhas: LinhaConferencia[] = [];
  const semProduto: string[] = [];
  for (const c of campanhas) {
    const produto = produtoDaCampanha(c.nome, mapaProduto);
    if (!produto) { semProduto.push(c.nome); continue; }
    // SolarDoc vende (sales); solar e eletroposto agendam (agendamentos do Gerador).
    const metrica: LinhaConferencia['metrica'] = produto === 'solardoc' ? 'compras' : 'agendamentos';
    const meta = metrica === 'compras' ? c.compras : c.agendamentos;
    const banco = (metrica === 'compras' ? contaVendas : contaAgend).get(c.id) || 0;
    if (meta === 0 && banco === 0) continue;
    const maior = Math.max(meta, banco);
    linhas.push({
      campanha_id: c.id, campanha: c.nome, produto, metrica, meta, banco,
      difPct: Math.round((Math.abs(meta - banco) / maior) * 100),
      alerta: divergiu(meta, banco),
    });
  }
  return { linhas, semCampanhaNoMeta, semProduto };
}

function htmlConferencia(janela: { desde: string; ate: string }, alertas: LinhaConferencia[]): string {
  const corpo = alertas.map((l) =>
    `<tr><td ${TD}>${esc(l.campanha)}</td><td ${TD}>${esc(l.produto)}</td><td ${TD}>${esc(l.metrica)}</td><td ${TD}>${l.meta}</td><td ${TD}>${l.banco}</td><td ${TD}>${l.difPct}%</td></tr>`).join('');
  return `<p>Meta e banco contaram números diferentes de ${esc(janela.desde)} a ${esc(janela.ate)} (dias de Brasília). Diferença de ${Math.round(DIF_MINIMA * 100)}% ou mais, com ${VOLUME_MINIMO} ou mais eventos no maior lado:</p>
    <table style="border-collapse:collapse;font-size:14px;"><tr><th align="left" ${TD}>Campanha</th><th align="left" ${TD}>Produto</th><th align="left" ${TD}>Evento</th><th align="left" ${TD}>Meta</th><th align="left" ${TD}>Banco</th><th align="left" ${TD}>Dif.</th></tr>${corpo}</table>`;
}

export interface RelatorioConferencia {
  dry: boolean;
  pulado?: string;
  janela?: { desde: string; ate: string };
  linhas?: LinhaConferencia[];
  semCampanhaNoMeta?: { compras: number; agendamentos: number };
  semProduto?: string[];
  alertas?: number;
  avisou?: boolean;
  erro?: string;
}

export async function conferirMetaVsBanco(opts: { dry?: boolean; agora?: number; prazoMs?: number } = {}): Promise<RelatorioConferencia> {
  return comPrazo('medidor-conferencia', !!opts.dry, opts.prazoMs ?? PRAZO_TAREFA_MS, (cancelado) => conferir(opts, cancelado));
}

async function conferir(opts: { dry?: boolean; agora?: number }, cancelado: () => boolean): Promise<RelatorioConferencia> {
  const dry = !!opts.dry;
  const agora = opts.agora ?? Date.now();
  const rel: RelatorioConferencia = { dry };
  try {
    if (desligado()) return { ...rel, pulado: 'desligado' };
    if (!token()) return { ...rel, pulado: 'sem_token' };
    if (!dry && new Date(agora).getUTCHours() < 11) return { ...rel, pulado: 'fora_do_horario' };

    const hoje = diaUTC(agora);
    if (!dry) {
      const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_CONFERENCIA).maybeSingle();
      if ((data?.value as any)?.dia === hoje) return { ...rel, pulado: 'hoje_ja_rodou' };
    }

    const j = janelaSeteDias(agora);
    rel.janela = { desde: j.desde, ate: j.ate };
    const [campanhas, mapaProduto, vendas, agendamentos] = await Promise.all([
      insightsPorCampanha(j.desde, j.ate),
      lerMapaCampanhaProduto(),
      // Toda leitura paginada tem ORDER BY: sem ordem o range pula e repete linha entre páginas.
      lerPaginado((de, ate) => supabase.from('sales').select('id, utm_campaign, meta_skip_motivo')
        .not('card_passed_at', 'is', null).gte('card_passed_at', j.deUtc).lt('card_passed_at', j.ateUtc)
        .order('id', { ascending: true }).range(de, ate)),
      lerPaginado((de, ate) => supabaseGerador.from('agendamentos').select('id, utm_campaign')
        .not('utm_campaign', 'is', null).gte('created_at', j.deUtc).lt('created_at', j.ateUtc)
        .order('id', { ascending: true }).range(de, ate)),
    ]);
    // Teste do dono e cobrança repetida nunca viraram Purchase: contá-los aqui seria divergência falsa.
    const vendasReais = vendas.filter((v) => v.meta_skip_motivo !== 'teste' && v.meta_skip_motivo !== 'duplicada');

    const { linhas, semCampanhaNoMeta, semProduto } = cruzar(campanhas, mapaProduto, vendasReais, agendamentos);
    const alertas = linhas.filter((l) => l.alerta);
    Object.assign(rel, { linhas, semCampanhaNoMeta, semProduto, alertas: alertas.length, avisou: false });
    if (dry) return rel;
    // Estourou o prazo durante a leitura: nada é gravado, a conferência de hoje roda de novo na próxima rodada.
    if (cancelado()) return rel;

    const em = new Date(agora).toISOString();
    const { error } = await supabase.from('system_state').upsert(
      { key: CHAVE_CONFERENCIA, value: { dia: hoje, em, janela: rel.janela, linhas, semCampanhaNoMeta, semProduto, alertas: alertas.length }, updated_at: em },
      { onConflict: 'key' });
    if (error) { rel.erro = `gravar: ${error.message}`; logger.error('medidor-conferencia', 'gravar resultado falhou', error); }

    if (alertas.length && !cancelado()) {
      try {
        await sendOpsAlert(`Meta x banco: ${alertas.length} campanha(s) com contagem diferente`, htmlConferencia(rel.janela, alertas));
        rel.avisou = true;
      } catch (e) {
        logger.warn('medidor-conferencia', 'aviso por e-mail falhou', String((e as Error)?.message || e));
      }
    }
    return rel;
  } catch (e) {
    logger.error('medidor-conferencia', 'rodada falhou', e);
    return { ...rel, erro: String((e as Error)?.message || e) };
  }
}
