// ─────────────────────────────────────────────────────────────────────────────
// ENSAIO AO VIVO (modo sombra). Para cada mensagem real de LEAD NOVO na linha 5040, o porteiro
// escolhe a dona e a agente escreve o que responderia. NADA é enviado: este arquivo (e tudo que ele
// importa, provado por agentes5040Isolamento.test.ts) não alcança zapiClient nem função de envio.
//
// Regras duras:
//  · nunca grava `ia_falha:*` (erro de crédito abre o disjuntor próprio, ver cota.ts);
//  · nenhuma escrita em whatsapp_sessions, agendamentos, atendimento_pausa, sdr_leads, message_queue;
//  · system_state só com marcas sem dado pessoal (ag5040_lock:, ag5040_vez:<id>, ag5040_ia:, disjuntor);
//  · a conversa e os rascunhos moram só no bucket privado (armazem.ts);
//  · wa_mensagens.momment está certo (webhook_debug.created_at é que vem 3h adiantado: não é usado);
//  · desligado (interruptor 'ensaio') = nenhuma leitura. `dry` ignora só o interruptor: ele usa o modelo
//    (é a sonda de cache), respeita disjuntor e teto, e não grava nem reserva a vez.
//
// Lead novo = primeira mensagem da conversa há até 30 dias (conversa lida inteira), OU card, cadastro
// ou leads_meta de até 14 dias.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { novoAnthropic } from '../../utils/anthropicClient';
import {
  ErroBanco, PAGINA, chaveDaLinha, contaComoConversa, lidsDasLinhas, lerPaginado,
  type LinhaWa, type MapaLid,
} from '../gerador/caixaWhatsapp';
import { anuncioDaMensagem } from './anuncioDoLead';
import { gravarMidiaCache, gravarTurno, lerMidiaCache, lerTurnos, type TurnoGravado } from './armazem';
import { carregarListasDeBarragem, lerConversa, lerFatosPorteiro, lerHorariosLivres, montarContexto } from './contexto';
import {
  chavesExistentes, registrarTentativa, clienteComCota, disjuntorAberto, faxinar, liberarChave, reservarChave,
  type EstadoCota,
} from './cota';
import { hmacDe } from './hmac';
import { ehMidia } from './midia';
import { ligado } from './interruptores';
import type { ClienteIA } from './ia';
import { decidirDona } from './porteiro';
import {
  donaAtualDe, falhaDeInfra, juntarDados, montarGravado, pensarTurno, respostaReal,
} from './turno';
import type { ContextoLead, MsgConversa, Persona } from './tipos';

import type { DecisaoPorteiro } from './porteiro';

export const MOTIVO_ANUNCIO: DecisaoPorteiro = { dona: null, passo: 'falha', motivo: 'leitura do anúncio de origem falhou: ninguém responde' };
export const JANELA_MIN = 20;
export const MARGEM_S = 30;
export const MAX_CONVERSAS_COM_MODELO = 3;
export const MAX_DECISOES_POR_RODADA = 15;
export const PRAZO_RODADA_MS = 150_000;
/** Teto da rodada inteira (a função da Vercel morre aos 300 s): nenhuma chamada ao modelo sai depois disto. */
export const PRAZO_TOTAL_MS = 240_000;
const NOVO_PRIMEIRA_MSG_DIAS = 30;
const NOVO_CADASTRO_DIAS = 14;
const MAX_PAGINAS_ENTRADA = 5;
const BALDE_MS = 5 * 60_000;
const DIA_MS = 86_400_000;

export interface OpcoesEnsaio {
  /** Não grava, não reserva a vez e ignora o interruptor. Ainda usa o modelo (sonda de cache) e respeita teto e disjuntor. */
  dry?: boolean;
  /** Uma conversa só. */
  uma?: boolean;
  agora?: Date;
  /** Cliente da IA (testes passam um falso). Padrão: o SDK de verdade. */
  cliente?: ClienteIA;
}

export interface TurnoResumo {
  hmac8: string;
  wa_id: number;
  passo: number | 'falha';
  dona: string | null;
  persona: Persona | null;
  falou: boolean;
  /** Só tamanhos: o TEXTO da agente e do lead fica no bucket privado, nunca na resposta da rota. */
  n_bolhas: number;
  tamanho: number;
  acao: string | null;
  motivo: string | null;
  modelo: string | null;
  uso: TurnoGravado['uso'];
  gravado: 'gravado' | 'ja_existia' | 'nao_gravou';
}

export interface RelatorioEnsaio {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  motivo?: string;
  ocupada?: boolean;
  janela?: { desde: string; ate: string };
  candidatas: number;
  puladas: Record<string, number>;
  decididas: number;
  comModelo: number;
  chamadasIA: number;
  parou: EstadoCota['parou'] | 'prazo' | null;
  /** A leitura das mensagens da janela bateu no teto de páginas: só as mais recentes entraram. */
  janelaTruncada: boolean;
  turnos: TurnoResumo[];
}

const vazio = (dry: boolean, extra: Partial<RelatorioEnsaio> = {}): RelatorioEnsaio => ({
  ok: true, ligado: true, dry, candidatas: 0, puladas: {}, decididas: 0, comModelo: 0, chamadasIA: 0, parou: null, janelaTruncada: false, turnos: [], ...extra,
});

// ── entrada: mensagens recentes do lead, agrupadas por contato ───────────────

interface LinhaEntrada { id: number; telefone: string; is_group: boolean; tipo: string; momment: string }

async function lerMapaLid(lids: string[]): Promise<MapaLid> {
  const mapa: MapaLid = new Map();
  for (let i = 0; i < lids.length; i += 100) {
    const { data, error } = await supabase.from('wa_lid_telefone').select('lid, telefone, chave').in('lid', lids.slice(i, i + 100));
    if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
    for (const r of (data ?? []) as Array<{ lid: string; telefone: string | null; chave: string | null }>) {
      const lid = String(r.lid ?? '').replace(/\D/g, '');
      const tel = String(r.telefone ?? '').replace(/\D/g, '');
      if (lid && r.chave && tel) mapa.set(lid, { chave: r.chave, telefone: tel });
    }
  }
  return mapa;
}

export interface Candidata { chave: string; waId: number; momento: string }

/**
 * As conversas com mensagem do lead na janela, a última de cada uma, MAIS RECENTES PRIMEIRO. A leitura é
 * decrescente: se bater no teto de páginas (`truncado`), o que fica de fora é o mais antigo.
 */
export async function lerCandidatas(inst: string, desdeIso: string, ateIso: string): Promise<{ candidatas: Candidata[]; truncado: boolean }> {
  const { linhas, truncado } = await lerPaginado<LinhaEntrada>((de, ate) =>
    supabase.from('wa_mensagens').select('id, telefone, is_group, tipo, momment')
      .eq('instancia', inst).eq('is_group', false).eq('from_me', false)
      .gte('momment', desdeIso).lte('momment', ateIso)
      .order('momment', { ascending: false }).order('id', { ascending: false }).range(de, ate) as any,
    MAX_PAGINAS_ENTRADA, PAGINA);
  const doLead = linhas.filter(l => contaComoConversa(l.tipo));
  const mapa = await lerMapaLid(lidsDasLinhas(doLead as Array<Pick<LinhaWa, 'telefone' | 'is_group'>>));
  const ultima = new Map<string, Candidata>();
  for (const l of doLead) {
    const chave = chaveDaLinha(l, mapa);
    if (!chave) continue;
    const atual = ultima.get(chave);
    if (!atual || Date.parse(l.momment) > Date.parse(atual.momento) || (l.momment === atual.momento && l.id > atual.waId)) {
      ultima.set(chave, { chave, waId: l.id, momento: l.momment });
    }
  }
  const candidatas = [...ultima.values()].sort((a, b) => Date.parse(b.momento) - Date.parse(a.momento) || b.waId - a.waId);
  return { candidatas, truncado };
}

// ── lead novo ────────────────────────────────────────────────────────────────

const dentro = (iso: string | null | undefined, agoraMs: number, dias: number): boolean => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) && agoraMs - t <= dias * DIA_MS && agoraMs >= t;
};

/** A primeira mensagem há ≤30 dias (só vale com a conversa lida inteira) ou card/cadastro/leads_meta de ≤14 dias. */
export function ehLeadNovo(msgs: readonly MsgConversa[], ctx: Pick<ContextoLead, 'completa' | 'card' | 'leadsMeta' | 'cadastros'>, agoraMs: number): boolean {
  if (ctx.completa && msgs.length && dentro(msgs[0]!.momment, agoraMs, NOVO_PRIMEIRA_MSG_DIAS)) return true;
  if (dentro(ctx.card?.created_at, agoraMs, NOVO_CADASTRO_DIAS)) return true;
  if (dentro(ctx.leadsMeta?.created_time, agoraMs, NOVO_CADASTRO_DIAS)) return true;
  return ctx.cadastros.some(c => dentro(c.created_at, agoraMs, NOVO_CADASTRO_DIAS));
}

// ── a rodada ─────────────────────────────────────────────────────────────────

const soma = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };

/**
 * Uma rodada do ensaio. Nunca lança: erro vira { ok:false, motivo }. Pensada para rodar a cada 5 minutos.
 */
export async function runEnsaioTick(opts: OpcoesEnsaio = {}): Promise<RelatorioEnsaio> {
  const dry = opts.dry === true;
  const agora = opts.agora ?? new Date();
  const inicio = Date.now();
  try {
    // Desligado: nenhuma leitura (nem o banco do ensaio). O dry é a sonda e passa por cima.
    if (!dry && !(await ligado('ensaio'))) return vazio(dry, { ligado: false, motivo: 'interruptor ensaio desligado' });
    if (!hmacDe('ensaio')) return vazio(dry, { ok: false, motivo: 'sem segredo de HMAC: o ensaio não roda' });
    const inst = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
    if (!inst) return vazio(dry, { ok: false, motivo: 'sem a instância da linha IO' });
    if (await disjuntorAberto(agora)) return vazio(dry, { parou: 'disjuntor', motivo: 'disjuntor aberto' });

    if (!dry) {
      const balde = Math.floor(agora.getTime() / BALDE_MS);
      const trava = await reservarChave(`ag5040_lock:${balde}`, {}, agora);
      if (trava === 'ja_existe') return vazio(dry, { ocupada: true, motivo: 'outra rodada já pegou este intervalo' });
      if (trava === 'erro') return vazio(dry, { ok: false, motivo: 'não consegui reservar a rodada' });
    }

    const desde = new Date(agora.getTime() - JANELA_MIN * 60_000).toISOString();
    const ate = new Date(agora.getTime() - MARGEM_S * 1000).toISOString();
    const lidas = await lerCandidatas(inst, desde, ate);
    // Dentro da janela de 20 min a mais antiga é a que vai sair primeiro dela: ninguém passa fome.
    const candidatas = [...lidas.candidatas].reverse();
    const r = vazio(dry, { janela: { desde, ate }, candidatas: candidatas.length, janelaTruncada: lidas.truncado });
    if (!candidatas.length) { if (!dry) await faxinar(agora); return r; }

    // Quem já foi ensaiado nesta mensagem não gasta leitura nem modelo.
    const jaFeitas = dry ? new Set<string>() : await chavesExistentes(candidatas.map(c => `ag5040_vez:${c.waId}`));
    const listas = await carregarListasDeBarragem();
    const base: ClienteIA = opts.cliente ?? (novoAnthropic() as unknown as ClienteIA);
    const { cliente, estado } = clienteComCota(dry ? 'dry' : 'vivo', () => new Date(), base, inicio + PRAZO_TOTAL_MS);
    // O dry é a sonda e ignora o interruptor: nunca passa de UMA conversa com modelo (quem quer mais liga a chave).
    const maxModelo = opts.uma || dry ? 1 : MAX_CONVERSAS_COM_MODELO;

    for (const c of candidatas) {
      if (Date.now() - inicio > PRAZO_RODADA_MS) { r.parou = 'prazo'; break; }
      if (estado.parou) { r.parou = estado.parou; break; }
      if (r.comModelo >= maxModelo || r.decididas >= MAX_DECISOES_POR_RODADA) break;
      if (jaFeitas.has(`ag5040_vez:${c.waId}`)) { soma(r.puladas, 'ja_ensaiada'); continue; }
      await processarCandidata(c, { agora, dry, listas, cliente, estado, r, maxModelo });
    }
    if (estado.parou && !r.parou) r.parou = estado.parou;
    r.chamadasIA = estado.chamadas;
    if (!dry) await faxinar(agora);
    return r;
  } catch (e) {
    console.error('[agentes5040] ensaio falhou', String((e as { code?: string })?.code ?? 'interno'));
    return vazio(dry, { ok: false, motivo: 'a rodada falhou' });
  }
}

interface Rodada {
  agora: Date; dry: boolean; listas: Awaited<ReturnType<typeof carregarListasDeBarragem>>;
  cliente: ClienteIA; estado: EstadoCota; r: RelatorioEnsaio; maxModelo: number;
}

async function processarCandidata(c: Candidata, g: Rodada): Promise<void> {
  const { agora, dry, r } = g;
  const hmac = hmacDe(c.chave);
  if (!hmac) { soma(r.puladas, 'sem_hmac'); return; }
  const agoraMs = agora.getTime();
  const vezKey = `ag5040_vez:${c.waId}`;

  // 1. a conversa, cortada na mensagem-alvo (o que veio depois só serve para mostrar a resposta de verdade)
  const conv = await lerConversa(c.chave);
  if (!conv.completa) { soma(r.puladas, 'conversa_incompleta'); return; }
  const alvo = conv.msgs.find(m => m.id === c.waId);
  if (!alvo || alvo.autor !== 'lead') { soma(r.puladas, 'alvo_nao_e_do_lead'); return; }
  const hist = conv.msgs.filter(m => m.id <= c.waId);
  const depois = conv.msgs.filter(m => m.id > c.waId);
  const entrada = ultimoBlocoDoLead(hist);

  // 2. lead novo
  const agoraIso = agora.toISOString();
  const ctx0 = await montarContexto(c.chave, { msgs: hist, completa: true }, { agora: agoraIso });
  if (!ctx0.completa) { soma(r.puladas, 'contexto_incompleto'); return; }
  if (!ehLeadNovo(hist, ctx0, agoraMs)) { soma(r.puladas, 'nao_e_lead_novo'); return; }

  // 3. anúncio (a primeira mensagem do lead) e o histórico do ensaio desta conversa
  const primeiroDoLead = hist.find(m => m.autor === 'lead');
  const anuncio = primeiroDoLead ? await anuncioDaMensagem(primeiroDoLead.id) : { ok: true, anuncio: null };
  let turnosAntes: TurnoGravado[];
  try { turnosAntes = (await lerTurnos(hmac)).filter(t => t.wa_id < c.waId); }
  catch { soma(r.puladas, 'armazem_falhou'); return; }

  // 4. porteiro (sem a leitura do anúncio, ninguém chuta)
  const fatosLidos = await lerFatosPorteiro(c.chave, hist, anuncio.anuncio, {
    donaAtual: donaAtualDe(turnosAntes), agora: agoraMs, listas: g.listas, completa: true,
  });
  // Sem saber se há anúncio, ninguém chuta. O motivo diz que foi o anúncio (e não a leitura do porteiro) para o painel mostrar a causa.
  const decisao = anuncio.ok ? decidirDona(fatosLidos) : MOTIVO_ANUNCIO;
  const persona: Persona | null = decisao.dona === 'carla' || decisao.dona === 'duda' || decisao.dona === 'helena' ? decisao.dona : null;
  if (persona && r.comModelo >= g.maxModelo) { soma(r.puladas, 'limite_de_conversas'); return; }

  // 5. reserva da vez (o dry não reserva: dá para repetir)
  if (!dry) {
    const vez = await reservarChave(vezKey, {}, agora);
    if (vez !== 'reservada') { soma(r.puladas, vez === 'ja_existe' ? 'ja_ensaiada' : 'vez_nao_reservada'); return; }
  }
  r.decididas++;

  // 6. a agente
  let resultado: Awaited<ReturnType<typeof pensarTurno>> | null = null;
  if (persona) {
    r.comModelo++;
    const audiosAntigos = hist.filter(m => m.autor === 'lead' && m.tipo === 'audio' && m.media_url).slice(-10).map(m => m.id);
    const idsMidia = [...new Set([...audiosAntigos, ...entrada.filter(ehMidia).map(m => m.id)])];
    const cacheMidia = await lerMidiaCache(idsMidia);
    const horariosLivres = await lerHorariosLivres(persona, ctx0.card, ctx0.leadsMeta, ctx0.cadastros, agoraIso);
    const ctx: ContextoLead = { ...ctx0, anuncio: anuncio.anuncio, horariosLivres };
    resultado = await pensarTurno({
      persona, ctx, novas: entrada,
      dadosAnteriores: juntarDados(turnosAntes.filter(t => t.falou).map(t => t.dados)),
      abertura: false, cliente: g.cliente, cacheMidia,
    });
    // Crédito, chave, teto, disjuntor, prazo: não vira "a agente calou". A vez é solta (a próxima rodada tenta).
    // Falha avulsa (400, timeout, limite de taxa): até 2 tentativas por mensagem; na segunda o turno é gravado
    // como falhou, com o motivo, para a mesma mensagem não gastar chamada para sempre.
    const parou = g.estado.parou !== null;
    const avulsa = !parou && falhaDeInfra(resultado.pensamento);
    if (parou || (avulsa && (dry || (await registrarTentativa(c.waId, agora)) === 1))) {
      if (!dry) await liberarChave(vezKey);
      r.decididas--;
      soma(r.puladas, 'ia_indisponivel');
      return;
    }
    if (!dry) for (const b of resultado.midiasNovas) await gravarMidiaCache(b);
  }

  // 7. o registro
  const turno = montarGravado({
    origem: 'vivo', hmac, kind: 'resposta', waId: c.waId, momento: alvo.momment, decisao, persona,
    resultado, entrada, nHistorico: hist.length, real: depois.length ? respostaReal(depois) : null, agora,
  });
  let gravado: TurnoResumo['gravado'] = 'nao_gravou';
  if (!dry) {
    try { gravado = await gravarTurno(turno); }
    catch { await liberarChave(vezKey); r.decididas--; soma(r.puladas, 'armazem_falhou'); return; }
  }
  r.turnos.push({
    hmac8: hmac.slice(0, 8), wa_id: c.waId, passo: decisao.passo, dona: decisao.dona, persona,
    falou: turno.falou, n_bolhas: turno.bolhas.length, tamanho: turno.bolhas.reduce((n, b) => n + b.length, 0), acao: turno.acao, motivo: turno.motivo_silencio,
    modelo: turno.modelo, uso: turno.uso, gravado,
  });
}

/** O último bloco de mensagens do lead (as que ainda não tiveram resposta), na ordem. */
export function ultimoBlocoDoLead(hist: readonly MsgConversa[]): MsgConversa[] {
  const out: MsgConversa[] = [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const m = hist[i]!;
    if (m.autor !== 'lead') break;
    out.unshift(m);
  }
  return out;
}
