// ── O META APRENDE QUEM SÃO OS MELHORES CLIENTES (09/10/2026) ────────────────
// Pedido do dono: "ensina ao Meta quais os melhores clientes, você tem base dos
// 2 hoje, os clientes que são mais quentes". Dois caminhos, o mesmo critério
// (clientesQuentesPuro.ts):
//
//   A. PÚBLICO COM VALOR, uma vez por dia. A lista dos mais quentes de cada
//      produto (solar e eletroposto) sobe inteira para um público personalizado
//      "com valor" no Meta. Dele o dono cria os lookalikes. O valor de cada
//      pessoa (LOOKALIKE_VALUE) é a escada de ticket: quem fechou vale o ticket
//      todo, quem só orçou vale um terço. Troca o conteúdo (usersreplace), não
//      acumula: quem esfriou ou foi corrigido sai da lista.
//
//   B. EVENTO NA HORA em que o consultor avança o card. Card que chega a um
//      status quente manda um evento para o pixel DO PRODUTO: `Purchase` quando
//      fechou, `ClienteQuente` (com valor) nos demais. O external_id é o hash do
//      telefone, o mesmo do evento do quiz, e é isso que deixa o Meta ligar o
//      avanço de hoje ao clique no anúncio da semana passada.
//
// ── Por que a LINHA DE BASE ──
// Na primeira rodada já existem ~150 cards quentes há meses. Mandá-los agora
// datava evento velho como de hoje e bagunçava a janela de aprendizado. Então,
// sem a marca `clientes_quentes_baseline` no system_state (gravada só depois de TODAS as linhas), cada card quente é gravado como
// `baseline:*` SEM chamar o Meta. O histórico já está coberto pelo público de A.
//
// ── Cuidados ──
//   • Nunca lança: roda dentro do master horário e Meta fora do ar não derruba nada.
//   • Dedup só depois que o Meta aceitou: recusa volta na próxima rodada.
//   • Teto de 40 eventos por rodada; o resto fica em `pendentes`.
//   • Público com menos de 20 pessoas não sobe (o Meta recusa e lista pequena
//     não ensina nada).
//   • Chaves de desligar: CLIENTE_QUENTE_OFF=1 (eventos) e PUBLICO_QUENTE_OFF=1 (público).
//   • ?dry=1 lê tudo e não escreve nem chama o Meta (a leitura da planilha é GET).

import { supabaseGerador } from '../../utils/supabaseGerador';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { enviarEventoMeta, normFone, type ProdutoMeta } from '../../utils/metaCapi';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { PLANILHA_CSV_URL, parseCSV } from '../insightsService';
import {
  TICKET_ELETRO, TICKET_SOLAR_PADRAO, ehTeste, pesoDoStatus, lerPlanilha, listaSolar, listaEletroposto,
  lotesPublico, previa,
  type Quente, type AgCard, type LeadMeta, type Parceria, type VendaPlanilha, type ListaQuentes,
} from './clientesQuentesPuro';

const GRAPH = 'https://graph.facebook.com/v23.0';
const CHAVE_DIA = 'clientes_quentes_publico';
const CHAVE_BASELINE = 'clientes_quentes_baseline';
/** Parada dos eventos: o master da Vercel morre em 300 s e o Meta pode estar lento. */
export const ORCAMENTO_MS = 120_000;
export const TETO_EVENTOS = 40;
export const MINIMO_PUBLICO = 20;
const PAGINA = 1000; // o PostgREST corta em 1000 linhas e ignora o .limit()

export const NOME_PUBLICO: Record<ProdutoMeta, string> = {
  solar: 'IO Solar · clientes quentes (base com valor)',
  eletroposto: 'IO Eletroposto · clientes quentes (base com valor)',
};
const DESCRICAO: Record<ProdutoMeta, string> = {
  solar: 'Clientes de energia solar que fecharam, orçaram ou têm conta alta, com valor para criar lookalike.',
  eletroposto: 'Clientes de eletroposto que fecharam, avançaram na negociação ou têm capital, com valor para criar lookalike.',
};

const token = (): string => (process.env.META_SYSTEM_USER_TOKEN || process.env.META_PIXEL_TOKEN || '').trim();
const conta = (): string => {
  const c = (process.env.META_MONITOR_ACCOUNT_ID || 'act_545732112868250').trim();
  return c.startsWith('act_') ? c : `act_${c}`;
};
const flag = (nome: string): boolean => (process.env[nome] || '').trim() === '1';

/** Dia de Brasília (UTC-3) em AAAA-MM-DD. O relógio do servidor está em UTC. */
export const diaBRT = (agora = Date.now()): string => new Date(agora - 3 * 3600 * 1000).toISOString().slice(0, 10);

export interface RelatorioPublico { pessoas: number; enviadoPor?: 'usersreplace' | 'users'; audienceId?: string; erro?: string }
export interface RelatorioQuentes {
  eventos: {
    enviados: number; baseline: number; pendentes: number;
    erros: Array<{ card?: string; erro: string }>;
    pulado?: 'desligado';
    aEnviar?: number;
  };
  publico: {
    solar?: RelatorioPublico; eletroposto?: RelatorioPublico;
    pulado?: 'hoje_ja_rodou' | 'desligado';
  };
  previa?: { solar?: ReturnType<typeof previa>; eletroposto?: ReturnType<typeof previa> };
}

// ── Leitura paginada ─────────────────────────────────────────────────────────
// Toda leitura paginada tem ORDER BY: sem ordem determinística o range pula e
// repete linhas entre páginas, e a lista sai furada sem erro nenhum.
async function lerTudo<T>(tabela: string, colunas: string, op: { like?: [string, string]; order: string[] }): Promise<{ dados: T[]; erro?: string }> {
  const dados: T[] = [];
  for (let k = 0; k < 200; k++) {
    let q: any = supabaseGerador.from(tabela).select(colunas);
    if (op.like) q = q.like(op.like[0], op.like[1]);
    for (const o of op.order) q = q.order(o, { ascending: true });
    const { data, error } = await q.range(k * PAGINA, (k + 1) * PAGINA - 1);
    if (error) return { dados, erro: String(error.message || error) };
    const lote = (data ?? []) as T[];
    dados.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return { dados };
}

/** `ok` só quando a planilha veio e trouxe vendas: lista de solar sem as vendas é lista encolhida. */
async function baixarPlanilha(): Promise<{ vendas: VendaPlanilha[]; ticket: number; ok: boolean }> {
  try {
    const res = await fetch(PLANILHA_CSV_URL, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const p = lerPlanilha(parseCSV(await res.text()));
    return { ...p, ok: p.vendas.length > 0 };
  } catch (e) {
    // Os eventos seguem com o ticket padrão; o público do solar não sobe (ver rodarPublico).
    logger.warn('clientes-quentes', 'planilha indisponível', String((e as Error)?.message || e));
    return { vendas: [], ticket: TICKET_SOLAR_PADRAO, ok: false };
  }
}

// ── B. Eventos ───────────────────────────────────────────────────────────────
interface Candidato { ag: AgCard; produto: ProdutoMeta; status: string; evento: 'Purchase' | 'ClienteQuente'; valor: number; leadId: string; fone: string }

function candidatosDeEvento(cards: AgCard[], ticketSolar: number): Candidato[] {
  const out: Candidato[] = [];
  for (const ag of [...cards].sort((a, b) => a.id - b.id)) {
    const produto: ProdutoMeta = ehOrigemEletroposto(ag.created_by) ? 'eletroposto' : 'solar';
    const peso = pesoDoStatus(produto, ag.status);
    const fone = normFone(ag.cliente_telefone);
    if (peso == null || !fone || ehTeste(ag.cliente_nome)) continue;
    const ticket = produto === 'eletroposto' ? TICKET_ELETRO : ticketSolar;
    const status = String(ag.status).trim().toLowerCase();
    const compra = status === 'fechou';
    out.push({
      ag, produto, status, fone, leadId: `ag_${ag.id}`,
      evento: compra ? 'Purchase' : 'ClienteQuente',
      valor: Math.round(compra ? ticket : peso * ticket),
    });
  }
  return out;
}

const linhaDedup = (c: Candidato, origem: string, extra: Record<string, unknown>) => ({
  lead_id: c.leadId,
  telefone_core8: c.fone.slice(-8),
  cliente_nome: c.ag.cliente_nome ?? null,
  valor: c.valor,
  origem,
  event_name: c.evento,
  ...extra,
});

async function rodarEventos(cards: AgCard[], ticketSolar: number, dry: boolean, rel: RelatorioQuentes['eventos'], inicio: number): Promise<void> {
  const cand = candidatosDeEvento(cards, ticketSolar);

  // A linha de base termina com uma MARCA no system_state, gravada só depois de
  // TODAS as linhas. Antes a regra era "tabela vazia = primeira vez", e uma
  // baseline que morresse no meio deixava a tabela cheia pela metade: a rodada
  // seguinte mandava ao Meta os cards velhos como se fossem de hoje.
  const { data: marca, error: erroMarca } = await supabase.from('system_state').select('value').eq('key', CHAVE_BASELINE).maybeSingle();
  if (erroMarca) { rel.erros.push({ erro: `ler marca da baseline: ${erroMarca.message}` }); return; }

  if (!marca?.value) {
    rel.baseline = cand.length;
    if (dry) return;
    for (let k = 0; k < cand.length; k += 200) {
      const lote = cand.slice(k, k + 200).map(c => linhaDedup(c, `baseline:${c.produto}:${c.status}`, { meta_status: 0 }));
      // upsert que ignora duplicata: baseline retomada não falha em linha que já entrou.
      const { error } = await supabaseGerador.from('capi_conversoes_enviadas')
        .upsert(lote, { onConflict: 'lead_id,event_name', ignoreDuplicates: true });
      if (error) {
        rel.erros.push({ erro: `baseline: ${error.message}` });
        logger.error('clientes-quentes', 'baseline falhou, marca não gravada', error);
        return;
      }
    }
    const { error } = await supabase.from('system_state').upsert(
      { key: CHAVE_BASELINE, value: { feito: true, em: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { rel.erros.push({ erro: `gravar marca da baseline: ${error.message}` }); return; }
    logger.info('clientes-quentes', `linha de base: ${cand.length} card(s) quentes marcados sem enviar`);
    return;
  }

  if (!cand.length) return;
  // Leitura do dedup com erro NUNCA vira "tabela vazia": aborta os eventos.
  const lido = await lerTudo<{ lead_id: string; event_name: string }>(
    'capi_conversoes_enviadas', 'lead_id, event_name', { like: ['lead_id', 'ag_%'], order: ['id'] });
  if (lido.erro) { rel.erros.push({ erro: `ler dedup: ${lido.erro}` }); return; }
  const ja = new Set(lido.dados.map(r => `${r.lead_id}|${r.event_name}`));

  const novos = cand.filter(c => !ja.has(`${c.leadId}|${c.evento}`));
  const lote = novos.slice(0, TETO_EVENTOS);
  if (dry) { rel.pendentes = novos.length - lote.length; rel.aEnviar = lote.length; return; }

  let feitos = 0;
  for (const c of lote) {
    // Orçamento de tempo: o master tem 300 s na Vercel e o Meta pode estar lento.
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    feitos++;
    const r = await enviarEventoMeta({
      produto: c.produto,
      nome: c.evento,
      origem: 'system_generated',
      eventId: `${c.evento === 'Purchase' ? 'venda' : 'quente'}_${c.leadId}`,
      pessoa: { telefone: c.ag.cliente_telefone, nome: c.ag.cliente_nome, cidade: c.ag.cidade },
      valor: c.valor,
      ...(c.evento === 'ClienteQuente' ? { dados: { status: c.status, produto: c.produto } } : {}),
    });
    if (!r.ok) { rel.erros.push({ card: c.leadId, erro: r.erro || `http_${r.status}` }); continue; }
    rel.enviados++;
    // Dedup só quando o Meta aceitou: falha volta na próxima rodada.
    const { error } = await supabaseGerador.from('capi_conversoes_enviadas').insert(
      linhaDedup(c, `quente:${c.produto}:${c.status}`, { meta_status: r.status, meta_received: r.recebidos ?? null }));
    if (error && !/duplicate|unique/i.test(error.message)) {
      // O Meta já recebeu: sem o dedup este card sai de novo na próxima rodada (o event_id
      // estável deixa o Meta deduplicar, mas o dono precisa saber).
      rel.erros.push({ card: c.leadId, erro: `dedup insert: ${error.message}` });
      logger.error('clientes-quentes', 'dedup insert falhou', error);
    }
  }
  rel.pendentes = novos.length - feitos;
  if (rel.enviados) logger.info('clientes-quentes', `${rel.enviados} evento(s) enviados ao Meta`, { pendentes: rel.pendentes });
}

// ── A. Público ───────────────────────────────────────────────────────────────
interface RespGraph { ok: boolean; status: number; json: any; erro?: string }

async function graph(metodo: 'GET' | 'POST', url: string, corpo?: unknown): Promise<RespGraph> {
  try {
    const res = await fetch(url, {
      method: metodo,
      ...(corpo !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) return { ok: false, status: res.status, json, erro: json?.error?.message || `http_${res.status}` };
    return { ok: true, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: {}, erro: (e as Error)?.message || String(e) };
  }
}

/** Acha o público pelo nome exato (seguindo a paginação) ou cria um novo com valor. */
export async function acharOuCriarPublico(produto: ProdutoMeta): Promise<{ id?: string; erro?: string }> {
  const tk = encodeURIComponent(token());
  const nome = NOME_PUBLICO[produto];
  let url: string | undefined = `${GRAPH}/${conta()}/customaudiences?fields=id,name&limit=200&access_token=${tk}`;
  for (let pg = 0; url && pg < 30; pg++) {
    const r = await graph('GET', url);
    if (!r.ok) return { erro: `listar públicos: ${r.erro}` };
    const achou = (r.json?.data ?? []).find((a: any) => a?.name === nome);
    if (achou?.id) return { id: String(achou.id) };
    url = r.json?.paging?.next || undefined;
  }
  const c = await graph('POST', `${GRAPH}/${conta()}/customaudiences?access_token=${tk}`, {
    name: nome, subtype: 'CUSTOM', description: DESCRICAO[produto],
    customer_file_source: 'USER_PROVIDED_ONLY', is_value_based: true,
  });
  if (!c.ok || !c.json?.id) return { erro: `criar público: ${c.erro || 'sem id'}` };
  return { id: String(c.json.id) };
}

/** Sobe a lista. Troca o conteúdo (usersreplace); se o Meta recusar, cai no aditivo (users). */
export async function subirLista(audienceId: string, lista: Quente[]): Promise<RelatorioPublico> {
  const tk = encodeURIComponent(token());
  const sessionId = Math.floor(Math.random() * (2 ** 52)) + 1;
  const lotes = lotesPublico(lista, sessionId);
  const base: RelatorioPublico = { pessoas: lista.length, audienceId };
  let ultimoErro = '';
  for (const via of ['usersreplace', 'users'] as const) {
    let falhou = false;
    for (const lote of lotes) {
      const r = await graph('POST', `${GRAPH}/${audienceId}/${via}?access_token=${tk}`, lote);
      if (!r.ok) { falhou = true; ultimoErro = `${via}: ${r.erro}`; break; }
    }
    if (!falhou) return { ...base, enviadoPor: via };
  }
  return { ...base, erro: ultimoErro };
}

async function sincronizarProduto(produto: ProdutoMeta, lista: ListaQuentes): Promise<RelatorioPublico> {
  const pessoas = [...lista.values()];
  if (pessoas.length < MINIMO_PUBLICO) return { pessoas: pessoas.length, erro: 'poucos' };
  if (!token()) return { pessoas: pessoas.length, erro: 'sem_token' };
  const a = await acharOuCriarPublico(produto);
  if (!a.id) return { pessoas: pessoas.length, erro: a.erro };
  return subirLista(a.id, pessoas);
}


// ── Orquestração ─────────────────────────────────────────────────────────────
async function rodarPublico(cards: AgCard[], planilha: Awaited<ReturnType<typeof baixarPlanilha>>, dry: boolean, rel: RelatorioQuentes): Promise<void> {
  const leads = await lerTudo<LeadMeta>('leads_meta', 'lead_id, nome, whatsapp, cidade, field_data', { order: ['lead_id'] });
  const par = await lerTudo<Parceria>('eletroposto_parceria', 'lado, nome, telefone, cidade, capital_faixa', { order: ['created_at', 'telefone'] });
  if (leads.erro || par.erro) {
    // Falta de uma fonte tira gente do público e o usersreplace apagaria o resto. Não sobe.
    const erro = `leitura: ${leads.erro || par.erro}`;
    rel.publico.solar = { pessoas: 0, erro }; rel.publico.eletroposto = { pessoas: 0, erro };
    logger.error('clientes-quentes', erro);
    return;
  }
  const solar = listaSolar({ cards, leads: leads.dados, vendas: planilha.vendas, ticket: planilha.ticket, ehEletro: ehOrigemEletroposto });
  const eletro = listaEletroposto({ cards, parceria: par.dados, ehEletro: ehOrigemEletroposto });
  if (dry) {
    rel.previa = { solar: previa(solar), eletroposto: previa(eletro) };
    rel.publico.solar = { pessoas: solar.size, ...(planilha.ok ? {} : { erro: 'planilha' }) };
    rel.publico.eletroposto = { pessoas: eletro.size };
    return;
  }
  // Sem a planilha a lista do solar perde as vendas (os melhores clientes) e o
  // usersreplace trocaria o público bom por um encolhido. Melhor não mexer.
  rel.publico.solar = planilha.ok ? await sincronizarProduto('solar', solar) : { pessoas: solar.size, erro: 'planilha' };
  rel.publico.eletroposto = await sincronizarProduto('eletroposto', eletro);

  // O dia só é marcado se algo subiu, ou se os dois ficaram abaixo do piso. Falha
  // de Meta, token ou listagem deixa o dia livre para a próxima rodada horária.
  const s = rel.publico.solar, e = rel.publico.eletroposto;
  const algumSubiu = !!(s.enviadoPor || e.enviadoPor);
  const ambosPoucos = s.erro === 'poucos' && e.erro === 'poucos';
  if (algumSubiu || ambosPoucos) {
    const { error } = await supabase.from('system_state').upsert(
      { key: CHAVE_DIA, value: { dia: diaBRT() }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) logger.error('clientes-quentes', 'gravar portão do dia falhou', error);
  }
}

export async function runClientesQuentes(opts: { dry?: boolean; forcarPublico?: boolean } = {}): Promise<RelatorioQuentes> {
  const inicio = Date.now();
  const dry = !!opts.dry;
  const rel: RelatorioQuentes = { eventos: { enviados: 0, baseline: 0, pendentes: 0, erros: [] }, publico: {} };
  try {
    const eventosOn = dry || !flag('CLIENTE_QUENTE_OFF');
    const publicoOn = dry || !flag('PUBLICO_QUENTE_OFF');
    if (!eventosOn) rel.eventos.pulado = 'desligado';
    if (!publicoOn) rel.publico.pulado = 'desligado';
    if (!eventosOn && !publicoOn) return rel;

    // Portão do dia: só o público é diário. Dry e forcarPublico passam por cima.
    let publicoRoda = publicoOn;
    if (publicoOn && !dry && !opts.forcarPublico) {
      const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_DIA).maybeSingle();
      if ((data?.value as any)?.dia === diaBRT()) { publicoRoda = false; rel.publico.pulado = 'hoje_ja_rodou'; }
    }
    if (!eventosOn && !publicoRoda) return rel;

    const cards = await lerTudo<AgCard>('agendamentos',
      'id, cliente_nome, cliente_telefone, cidade, status, created_by, created_at, nota, capital_faixa', { order: ['id'] });
    if (cards.erro) {
      // Lista parcial ensinaria o Meta com metade da base: melhor não fazer nada.
      rel.eventos.erros.push({ erro: `ler agendamentos: ${cards.erro}` });
      if (publicoRoda) { rel.publico.solar = { pessoas: 0, erro: 'leitura' }; rel.publico.eletroposto = { pessoas: 0, erro: 'leitura' }; }
      return rel;
    }
    const planilha = await baixarPlanilha();

    // O público vem ANTES dos eventos: é o que roda uma vez por dia e o que mais
    // importa; os eventos têm teto de tempo e ficam com o que sobrar.
    if (publicoRoda) await rodarPublico(cards.dados, planilha, dry, rel);
    if (eventosOn) await rodarEventos(cards.dados, planilha.ticket, dry, rel.eventos, inicio);
  } catch (e) {
    logger.error('clientes-quentes', 'rodada falhou', e);
    rel.eventos.erros.push({ erro: String((e as Error)?.message || e) });
  }
  return rel;
}
