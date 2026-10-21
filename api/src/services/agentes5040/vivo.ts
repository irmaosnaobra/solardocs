// ─────────────────────────────────────────────────────────────────────────────
// A RODADA VIVA DAS AGENTES DA 5040 (Fase B, B1c-3). Roda de 2 em 2 minutos (cron próprio) e responde,
// DE VERDADE, só as conversas que têm posse viva de uma agente ligada e no escopo (agenteAtendeEste).
//
// Este arquivo NÃO importa o zapiClient. Só alcança o envio por dois lugares: vivoEnvio.ts (a fala ao lead,
// com todas as condições do chefe-antiban) e fichaEnvio.ts (a ficha ao consultor).
//
// Nesta fase só a Duda responde: helena_vivo e carla_vivo são ignorados aqui, como na porta (entrada.ts).
//
// Rodada, na ordem:
//   · nenhuma dona da rodada ligada: sai, e a única leitura foi a do interruptor (cache de 60 s);
//   · trava única ag5040_vivo_lock (validade de 300 s pelo updated_at, compare-and-set: insert, e update
//     condicional no 23505 se a trava expirou), com um TOKEN aleatório no value: quem solta casa pelo token
//     (um gatilho que reescreva updated_at não prende a trava); o dry não trava;
//   · prazo de envio de 110 s: nenhuma chamada ao modelo nem envio começa depois dele;
//   · candidatas = última fala do lead na última hora; posse viva de dona ligada e no escopo; a fala é
//     posterior à posse (ate_wa_id; sem ele, âncora em posse.desde com folga de 15 min: a porta grava desde =
//     momento da mensagem - 60 s, e o prazo de 15 min do envio mais o "qualquer from_me depois da fala tira da
//     fila" seguram fala velha); QUALQUER mensagem
//     nossa (robô antigo, humano no celular ou a própria agente) depois da fala do lead tira a conversa da
//     fila e só atualiza ate_wa_id; rajada de 45 s; prazo de 15 min; no máximo 3 conversas por rodada;
//   · por conversa: vez PRÓPRIA ag5040_vez_vivo:<waId> (o ensaio sombra usa ag5040_vez:<waId> e pula conversa
//     com posse viva; assim uma vez reservada pelo ensaio, antes da posse, não prende a rodada viva), contexto,
//     pensarTurno (trava da Fase A), RELEITURA do último id antes de qualquer saída (chegou fala nova = solta
//     a vez e tenta na próxima), e então:
//        - fala comum: enviarResposta (1 bolha, peça de link ou Pix na 2ª chamada);
//        - ação que exige ferramenta (marcar, ligar agora, suporte, passar): ficha ao consultor e, SÓ se a
//          ficha saiu, uma bolha fixa dizendo que a consultora vai falar (a de agenda para marcar/remarcar, a
//          genérica para o resto); a bolha do modelo nunca vai (ela
//          prometeria o que ninguém fez); estado passou_humano;
//        - não incomodar: estado nao_incomodar, despedida pelo enviarResposta e SÓ DEPOIS o silenciarContato
//          (silenciado antes, o enviarResposta recusaria a despedida como 'mudo'). O estado é gravado ANTES da
//          despedida de propósito (cala do lado seguro) e a despedida recusada não é tentada de novo;
//        - 10 respostas na posse, 3ª falha de IA, trava sem fala segura, bolha inválida, ou fala que passou de
//          15 min: passou_humano com ficha (sem bolha quando passou de 15 min); 'pediu_humano' (supressão do
//          telefone): ficha, SEM bolha; 'erro_linha' PARA a rodada inteira.
//   · envio ok = atualizarPosse({ate_wa_id, respostas + 1}) e gravarTurno (origem 'vivo', campo enviado).
//   · dry: faz tudo, menos reservar, enviar, atualizar a posse, gravar e mandar ficha. Respeita o interruptor
//     e o escopo (é a sonda do que a rodada viva faria), e passa dry:true ao enviarResposta, que roda todas as
//     condições e devolve 'dry' como veredito.
//
// Telefone cru nunca vai para log, chave de system_state nem relatório: relatório leva hmac8, ids e contagens.
// O número de ENVIO sai de wa_mensagens (ou do mapa de LID), nunca da chave da posse (ela perdeu o nono dígito).
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'node:crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { novoAnthropic } from '../../utils/anthropicClient';
import { chaveContato, silenciarContato } from '../agents/whatsapp/silenciar';
import { gravarMidiaCache, gravarTurno, lerMidiaCache, lerTurnos, type TurnoGravado } from './armazem';
import { lerCards, lerConversa, montarContexto } from './contexto';
import { clienteComCota, disjuntorAberto, liberarChave, reservarChave, type EstadoCota } from './cota';
import { anuncioDaMensagem } from './anuncioDoLead';
import { lerCandidatas, ultimoBlocoDoLead, type Candidata } from './ensaio';
import {
  blocoSeguro, fichaDeCampos, produtoDoCard, textoDaMensagem, type CardDaFicha,
} from './ficha';
import {
  carregarTelefonesConsultores, enviarFichaAoConsultor, erroProvaQueNaoSaiu, linhaIoEmCooldown, telefoneDoConsultor, telefoneDoDono,
} from './fichaEnvio';
import { hmacDe } from './hmac';
import type { ClienteIA } from './ia';
import type { DonaViva } from './interruptores';
import { ehMidia } from './midia';
import { agenteAtendeEste, atualizarPosse, type DadosPosse } from './posse';
import { DONAS_NA_RODADA, donasDaRodadaLigadas } from './posseLeitura';
import { falhaDeInfra, juntarDados, montarGravado, pensarTurno } from './turno';
import type { CardResumo, Persona } from './tipos';
import { enviarResposta, type ResultadoEnvio } from './vivoEnvio';
import type { DecisaoPorteiro } from './porteiro';

const LOG = 'vivo-5040';

export const CHAVE_TRAVA = 'ag5040_vivo_lock';
export const LIMITES_VIVO = Object.freeze({
  travaMs: 300_000,
  prazoEnvioMs: 110_000,
  rajadaMs: 45_000,
  prazoFalaMs: 15 * 60_000,
  buscaMs: 60 * 60_000,
  ancoraFolgaMs: 15 * 60_000,
  maxConversas: 3,
  respostasPorPessoa: Object.freeze({ duda: 10, helena: 10, carla: 20 }) as Readonly<Record<DonaViva, number>>,
  falhasDeIAAteHumano: 3,
});

/** Ações do modelo que exigem uma ferramenta que a B1c ainda não tem (B1d): viram ficha ao consultor. */
export const ACOES_COM_FERRAMENTA: readonly string[] = [
  'marcar_horario', 'remarcar_horario', 'ligar_agora', 'suporte_giovanna', 'confirmar_presenca',
  'passar_carla', 'passar_duda', 'passar_helena',
];

/**
 * As bolhas fixas depois da ficha. Não prometem horário nem ação: só dizem que a consultora vai falar.
 * Genérica: trava sem fala segura, bolha inválida, 10 respostas, 3ª falha de IA e as ações com ferramenta que não
 * são de agenda. Agenda: a IA pediu marcar ou remarcar. Cada uma cabe nos 160 caracteres e não tem travessão.
 */
export const BOLHA_PASSAGEM_GENERICA = 'Vou deixar a consultora cuidar daqui. Já mandei a nossa conversa toda pra ela, e ela te responde por aqui mesmo em breve.';
export const BOLHA_PASSAGEM_AGENDA = 'Pra acertar o horário, a consultora fala com você. Já mandei a nossa conversa pra ela, e ela te chama por aqui em breve.';
const ACOES_DE_AGENDA: readonly string[] = ['marcar_horario', 'remarcar_horario'];
const bolhaDaPassagem = (acao?: string): string => (acao && ACOES_DE_AGENDA.includes(acao) ? BOLHA_PASSAGEM_AGENDA : BOLHA_PASSAGEM_GENERICA);

const MOTIVO_LEGIVEL: Record<string, string> = {
  prazo: 'o cliente esperou mais de 15 minutos sem resposta',
  limite_respostas: 'a conversa chegou ao limite de respostas da agente',
  falha_ia: 'a agente não conseguiu responder por falha técnica',
  trava: 'a agente não achou uma resposta segura para dar',
  pediu_humano: 'o cliente pediu para falar com uma pessoa',
};

export interface OpcoesVivo {
  dry?: boolean;
  agora?: Date;
  /** Cliente da IA (testes passam um falso). Padrão: o SDK de verdade, criado só se algum modelo for chamado. */
  cliente?: ClienteIA;
}

export interface DecisaoVivo {
  hmac8: string;
  wa_id: number;
  dona: string;
  acao: string | null;
  resultado: string;
  motivo: string | null;
  n_bolhas: number;
  tamanho: number;
  /** Só no dry: as bolhas que sairiam. */
  sairia?: string[];
  ficha?: 'enviada' | 'ficharia' | 'adiada' | 'lead_ja_avisado' | 'falhou';
}

export interface RelatorioVivo {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  motivo?: string;
  ocupada?: boolean;
  conversasVistas: number;
  elegiveis: number;
  processadas: number;
  enviadas: number;
  puladas: Record<string, number>;
  parou: EstadoCota['parou'] | 'espacamento' | 'erro_linha' | null;
  chamadasIA: number;
  janelaTruncada: boolean;
  decisoes: DecisaoVivo[];
}

const vazio = (dry: boolean, extra: Partial<RelatorioVivo> = {}): RelatorioVivo => ({
  ok: true, ligado: true, dry, conversasVistas: 0, elegiveis: 0, processadas: 0, enviadas: 0, puladas: {}, parou: null,
  chamadasIA: 0, janelaTruncada: false, decisoes: [], ...extra,
});

const soma = (o: Record<string, number>, k: string): void => { o[k] = (o[k] ?? 0) + 1; };
const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'desconhecido').slice(0, 20);
const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

// ── a trava única ────────────────────────────────────────────────────────────

/**
 * Insert; no 23505, update condicional (só se a trava passou da validade): quem chega primeiro leva. A trava leva um
 * TOKEN aleatório no value: quem solta casa pelo token, não pelo updated_at (um gatilho do banco que reescreva o
 * updated_at deixaria a trava presa até expirar). A validade de 300 s segue medida pelo updated_at.
 */
async function tomarTrava(agora: Date, token: string): Promise<'tomada' | 'ocupada' | 'erro'> {
  const iso = agora.toISOString();
  const ins = await supabase.from('system_state').insert({ key: CHAVE_TRAVA, value: { em: iso, token }, updated_at: iso });
  if (!ins.error) return 'tomada';
  if (codigoDe(ins.error) !== '23505') { logger.error(LOG, `trava: insert falhou (${codigoDe(ins.error)})`); return 'erro'; }
  const corte = new Date(agora.getTime() - LIMITES_VIVO.travaMs).toISOString();
  const up = await supabase.from('system_state').update({ value: { em: iso, token }, updated_at: iso })
    .eq('key', CHAVE_TRAVA).lte('updated_at', corte).select('key');
  if (up.error) { logger.error(LOG, `trava: takeover falhou (${codigoDe(up.error)})`); return 'erro'; }
  return Array.isArray(up.data) && up.data.length > 0 ? 'tomada' : 'ocupada';
}

/** Solta só a trava que é minha (o token é o meu): trava tomada por outra rodada depois do meu prazo não cai. */
async function soltarTrava(token: string): Promise<void> {
  try { await supabase.from('system_state').delete().eq('key', CHAVE_TRAVA).eq('value->>token', token); }
  catch (err) { logger.error(LOG, 'não soltei a trava (vence sozinha em 300 s)', err); }
}

// ── leituras ─────────────────────────────────────────────────────────────────

const DONAS_DA_POSSE = ['duda', 'helena', 'carla', 'humano'];
const ESTADOS_DA_POSSE = ['viva', 'passou_humano', 'nao_incomodar', 'encerrada'];

/** As posses (tipo ag5040) destas chaves, em lotes de 100. Erro sobe. Dado ilegível fica de fora. */
async function lerPossesEmLote(chaves: readonly string[]): Promise<Map<string, DadosPosse>> {
  const mapa = new Map<string, DadosPosse>();
  for (let i = 0; i < chaves.length; i += 100) {
    const { data, error } = await supabase.from('whatsapp_sessions')
      .select('phone, lead_data').eq('tipo', 'ag5040').in('phone', chaves.slice(i, i + 100));
    if (error) throw new Error(`leitura das posses falhou (${codigoDe(error)})`);
    for (const l of (data ?? []) as Array<{ phone: string; lead_data: Record<string, unknown> | null }>) {
      const o = l.lead_data;
      if (!o || typeof o !== 'object' || !DONAS_DA_POSSE.includes(String(o.dona)) || !ESTADOS_DA_POSSE.includes(String(o.estado))) continue;
      mapa.set(l.phone, {
        ...o,
        dona: o.dona as DadosPosse['dona'],
        estado: o.estado as DadosPosse['estado'],
        desde: typeof o.desde === 'string' ? o.desde : '',
        ate_wa_id: typeof o.ate_wa_id === 'number' ? o.ate_wa_id : null,
        respostas: Number.isFinite(Number(o.respostas)) ? Number(o.respostas) : 0,
        imagens: Array.isArray(o.imagens) ? o.imagens.map(String) : [],
        links: Array.isArray(o.links) ? o.links.map(String) : [],
      });
    }
  }
  return mapa;
}

/** O número de ENVIO da conversa: o da própria fala (wa_mensagens) ou, se for LID, o do mapa. null = não dá para falar. */
async function telefoneParaEnviar(chave: string, waId: number): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('wa_mensagens').select('telefone').eq('id', waId).maybeSingle();
    if (error) return null;
    const d = soDigitos((data as { telefone?: string | null } | null)?.telefone);
    if (d && chaveContato(d) === chave) return d;
    const lid = await supabase.from('wa_lid_telefone').select('telefone').eq('chave', chave).limit(1);
    if (lid.error) return null;
    const t = soDigitos(((lid.data ?? []) as Array<{ telefone?: string | null }>)[0]?.telefone);
    return t && chaveContato(t) === chave ? t : null;
  } catch {
    return null;
  }
}

/** Falhas de IA desta fala: 1, 2 ou 3 (reserva ag5040_tent:<waId>:<n> por insert; a faxina da cota limpa em 7 dias). */
async function contarFalhaDeIA(waId: number, agora: Date): Promise<number> {
  for (let n = 1; n <= LIMITES_VIVO.falhasDeIAAteHumano; n++) {
    const r = await reservarChave(`ag5040_tent:${waId}:${n}`, {}, agora);
    if (r === 'reservada') return n;
    if (r === 'erro') return 1;
  }
  return LIMITES_VIVO.falhasDeIAAteHumano;
}

// ── a rodada ─────────────────────────────────────────────────────────────────

interface G {
  agora: Date;
  agoraEnvio: () => Date;
  dry: boolean;
  inicio: number;
  r: RelatorioVivo;
  cliente: ClienteIA;
  estado: EstadoCota;
  semModelo: boolean;
}

export async function runVivoTick(opts: OpcoesVivo = {}): Promise<RelatorioVivo> {
  const dry = opts.dry === true;
  const agora = opts.agora ?? new Date();
  const inicio = Date.now();
  let travaToken: string | null = null;
  try {
    // 1. nada ligado: sai sem ler o banco (a única leitura possível é a do interruptor, com cache)
    const donas = await donasDaRodadaLigadas();
    if (!donas.length) return vazio(dry, { ligado: false, motivo: 'nenhuma dona ligada na rodada' });
    if (!hmacDe('vivo-5040')) return vazio(dry, { ok: false, motivo: 'sem segredo de HMAC: a rodada viva não roda' });
    const inst = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
    if (!inst) return vazio(dry, { ok: false, motivo: 'sem a instância da linha IO' });

    // 2. a trava única (o dry não trava: não escreve nada)
    if (!dry) {
      const token = randomBytes(12).toString('hex');
      const t = await tomarTrava(agora, token);
      if (t === 'ocupada') return vazio(dry, { ocupada: true, motivo: 'outra rodada viva está em andamento' });
      if (t === 'erro') return vazio(dry, { ok: false, motivo: 'não consegui tomar a trava da rodada' });
      travaToken = token;
    }

    const r = vazio(dry);
    // Disjuntor aberto: ninguém chama o modelo, mas as passagens para o humano (que não usam IA) seguem.
    const semModelo = await disjuntorAberto(agora);
    if (semModelo) r.parou = 'disjuntor';

    let base: ClienteIA | null = null;
    const lazy: ClienteIA = {
      messages: { create: (body: any, o?: any) => (base ??= opts.cliente ?? (novoAnthropic() as unknown as ClienteIA)).messages.create(body, o) },
    };
    // Cota PRÓPRIA da resposta viva ('resposta', 300/dia): o ensaio sombra ('vivo', 120/dia) não gasta a dela.
    const { cliente, estado } = clienteComCota(dry ? 'dry' : 'resposta', () => new Date(), lazy, inicio + LIMITES_VIVO.prazoEnvioMs);
    const g: G = { agora, agoraEnvio: () => opts.agora ?? new Date(), dry, inicio, r, cliente, estado, semModelo };

    // 3. candidatas: a última fala do lead de cada conversa da última hora, com posse viva
    const desde = new Date(agora.getTime() - LIMITES_VIVO.buscaMs).toISOString();
    const lidas = await lerCandidatas(inst, desde, agora.toISOString());
    r.conversasVistas = lidas.candidatas.length;
    r.janelaTruncada = lidas.truncado;
    // Mais antigas primeiro: quem espera há mais tempo é atendido antes (e as vencidas vão para o humano).
    const candidatas = [...lidas.candidatas].reverse();
    const posses = candidatas.length ? await lerPossesEmLote(candidatas.map(c => c.chave)) : new Map<string, DadosPosse>();

    for (const c of candidatas) {
      if (Date.now() - inicio > LIMITES_VIVO.prazoEnvioMs) { r.parou = 'prazo'; break; }
      const posse = posses.get(c.chave);
      if (!posse || posse.estado !== 'viva') { soma(r.puladas, 'sem_posse_viva'); continue; }
      const dona = posse.dona;
      if (dona === 'humano' || !(DONAS_NA_RODADA as readonly string[]).includes(dona) || !(donas as readonly string[]).includes(dona)) {
        soma(r.puladas, 'dona_fora_da_rodada'); continue;
      }
      if (!(await agenteAtendeEste(dona as DonaViva, c.chave))) { soma(r.puladas, 'fora_do_escopo'); continue; }
      r.elegiveis++;
      const seguir = await processar(c, posse, g);
      if (seguir === 'parar') break;
    }
    if (g.estado.parou && !r.parou) r.parou = g.estado.parou;
    r.chamadasIA = g.estado.chamadas;
    return r;
  } catch (e) {
    logger.error(LOG, `a rodada falhou (${codigoDe(e)})`);
    return vazio(dry, { ok: false, motivo: 'a rodada falhou' });
  } finally {
    if (travaToken) await soltarTrava(travaToken);
  }
}

type Seguir = 'seguir' | 'parar';

async function processar(c: Candidata, posse: DadosPosse, g: G): Promise<Seguir> {
  const { r, dry, agora } = g;
  const chave = c.chave;
  const hmac = hmacDe(chave);
  if (!hmac) { soma(r.puladas, 'sem_hmac'); return 'seguir'; }
  const hmac8 = hmac.slice(0, 8);
  const dona = posse.dona as DonaViva;
  const agoraMs = agora.getTime();

  // 1. a conversa e a última fala do lead
  const conv = await lerConversa(chave);
  if (!conv.completa) { soma(r.puladas, 'conversa_incompleta'); return 'seguir'; }
  const msgs = conv.msgs;
  let iL = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i]!.autor === 'lead') { iL = i; break; }
  if (iL < 0) { soma(r.puladas, 'sem_fala_do_lead'); return 'seguir'; }
  const L = msgs[iL]!;

  // 2. a fala é posterior à posse. Sem ate_wa_id (a porta não conhece o id), a âncora é posse.desde, com folga de 15 min.
  if (posse.ate_wa_id !== null) {
    if (L.id <= posse.ate_wa_id) { soma(r.puladas, 'ja_atendida'); return 'seguir'; }
  } else {
    const desde = Date.parse(posse.desde);
    if (Number.isFinite(desde) && Date.parse(L.momment) < desde - LIMITES_VIVO.ancoraFolgaMs) { soma(r.puladas, 'fala_antes_da_posse'); return 'seguir'; }
  }

  // 3. QUALQUER mensagem nossa depois da fala do lead (robô antigo, humano no celular, a própria agente):
  // a agente não fala por cima. Só marca a fala como vista.
  if (iL < msgs.length - 1) {
    if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
    soma(r.puladas, 'ja_respondida_por_nos');
    return 'seguir';
  }

  const idade = agoraMs - Date.parse(L.momment);
  if (!Number.isFinite(idade)) { soma(r.puladas, 'momento_invalido'); return 'seguir'; }
  if (idade < LIMITES_VIVO.rajadaMs) { soma(r.puladas, 'rajada'); return 'seguir'; }
  if (r.processadas >= LIMITES_VIVO.maxConversas) { soma(r.puladas, 'limite_de_conversas'); return 'seguir'; }

  const tel = await telefoneParaEnviar(chave, L.id);
  const base = { hmac8, wa_id: L.id, dona };
  const dec = (d: Partial<DecisaoVivo> & { resultado: string }): void => {
    r.decisoes.push({ ...base, acao: null, motivo: null, n_bolhas: 0, tamanho: 0, ...d });
  };

  // 4. fala vencida, ou limite de respostas: passa ao humano sem gastar modelo (e sem depender da vez)
  if (idade > LIMITES_VIVO.prazoFalaMs) {
    r.processadas++;
    await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'prazo', bolha: false, card: null, buscarCard: true, nome: null, dec });
    return 'seguir';
  }
  if (posse.respostas >= LIMITES_VIVO.respostasPorPessoa[dona]) {
    r.processadas++;
    await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'limite_respostas', bolha: true, card: null, buscarCard: true, nome: null, dec });
    return 'seguir';
  }

  // 5. daqui para baixo é preciso falar com o lead e com o modelo
  if (!tel) { soma(r.puladas, 'sem_telefone'); return 'seguir'; }
  if (g.semModelo || g.estado.parou) { soma(r.puladas, 'ia_parada'); return 'parar'; }

  // Vez PRÓPRIA da rodada viva: a do ensaio sombra (ag5040_vez:<waId>) pode já estar reservada, por um lead que chegou
  // pelo poll antes da posse, e não pode prender esta rodada.
  const vezKey = `ag5040_vez_vivo:${L.id}`;
  if (!dry) {
    const vez = await reservarChave(vezKey, {}, agora);
    if (vez !== 'reservada') { soma(r.puladas, vez === 'ja_existe' ? 'vez_ocupada' : 'vez_nao_reservada'); return 'seguir'; }
  }
  r.processadas++;
  const soltar = async (): Promise<void> => { if (!dry) await liberarChave(vezKey); };

  try {
    // 6. contexto
    const ctx0 = await montarContexto(chave, { msgs, completa: true }, { agora: agora.toISOString() });
    if (!ctx0.completa) { await soltar(); soma(r.puladas, 'contexto_incompleto'); return 'seguir'; }
    const primeiro = msgs.find(m => m.autor === 'lead');
    const anuncio = primeiro ? await anuncioDaMensagem(primeiro.id) : { ok: true, anuncio: null };
    let turnosAntes: TurnoGravado[];
    try { turnosAntes = (await lerTurnos(hmac)).filter(t => t.wa_id < L.id); }
    catch { await soltar(); soma(r.puladas, 'armazem_falhou'); return 'seguir'; }
    const entrada = ultimoBlocoDoLead(msgs);
    const audiosAntigos = msgs.filter(m => m.autor === 'lead' && m.tipo === 'audio' && m.media_url).slice(-10).map(m => m.id);
    const idsMidia = [...new Set([...audiosAntigos, ...entrada.filter(ehMidia).map(m => m.id)])];
    const cacheMidia = await lerMidiaCache(idsMidia);
    // Horários livres: vazio de propósito na B1c. A grade de lerHorariosLivres hoje é a do eletroposto, errada para a Duda;
    // sem horários nos fatos a persona pergunta manhã ou tarde (pedir_horarios), e o marcar vira ficha.
    const ctx = { ...ctx0, anuncio: anuncio.anuncio, horariosLivres: [] as string[] };

    // 7. o modelo
    const resultado = await pensarTurno({
      persona: dona as Persona, ctx, novas: entrada,
      dadosAnteriores: juntarDados(turnosAntes.filter(t => t.falou).map(t => t.dados)),
      abertura: false, cliente: g.cliente, cacheMidia,
    });
    const pens = resultado.pensamento;
    if (g.estado.parou) {                       // crédito, chave, teto, disjuntor ou prazo: a rodada para e a vez é solta
      await soltar();
      r.parou = g.estado.parou;
      dec({ resultado: 'ia_parou', motivo: g.estado.parou });
      return 'parar';
    }
    if (falhaDeInfra(pens)) {
      await soltar();
      const n = dry ? 0 : await contarFalhaDeIA(L.id, agora);
      if (n < LIMITES_VIVO.falhasDeIAAteHumano) { soma(r.puladas, 'ia_indisponivel'); dec({ resultado: 'ia_indisponivel', motivo: dry ? 'dry' : `falha ${n}` }); return 'seguir'; }
      await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'falha_ia', bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec });
      return 'seguir';
    }
    if (!dry) for (const b of resultado.midiasNovas) await gravarMidiaCache(b);

    const decisao: DecisaoPorteiro = { dona, passo: 2, motivo: 'posse viva (rodada viva)' };
    const registrar = async (enviado: boolean, motivoSilencio?: string): Promise<void> => {
      if (dry) return;
      try {
        const turno: TurnoGravado = {
          ...montarGravado({
            origem: 'vivo', hmac, kind: 'resposta', waId: L.id, momento: L.momment, decisao, persona: dona as Persona,
            resultado, entrada, nHistorico: msgs.length, real: null, agora,
          }),
          enviado,
        };
        if (motivoSilencio) turno.motivo_silencio = motivoSilencio;
        await gravarTurno(turno);
      } catch (err) { logger.error(LOG, `não gravei o turno ${L.id} (${codigoDe(err)})`); }
    };

    // 8. fala nova depois do modelo: solta e tenta na próxima rodada
    const rele = await lerConversa(chave);
    if (!rele.completa || rele.msgs[rele.msgs.length - 1]?.id !== L.id) {
      await soltar();
      soma(r.puladas, 'fala_nova_antes_do_envio');
      dec({ resultado: 'fala_nova', motivo: 'chegou mensagem depois do modelo' });
      return 'seguir';
    }
    if (Date.now() - g.inicio > LIMITES_VIVO.prazoEnvioMs) {
      await soltar();
      r.parou = 'prazo';
      dec({ resultado: 'prazo_da_rodada' });
      return 'parar';
    }

    // 9. o modelo não achou fala segura (trava): passa ao humano
    if (!pens.falou) {
      await registrar(false);
      await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'trava', bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec, detalhe: pens.motivo });
      return 'seguir';
    }
    const saida = pens.saida;
    const base2 = { acao: saida.acao, n_bolhas: saida.bolhas.length, tamanho: saida.bolhas.reduce((n, b) => n + b.length, 0) };

    // 10. ação que exige ferramenta: ficha + bolha fixa (só se a ficha saiu)
    if (ACOES_COM_FERRAMENTA.includes(saida.acao)) {
      await registrar(false, `ferramenta:${saida.acao}`);
      await passarAoHumano(g, {
        chave, tel, L, posse, hmac, motivo: `ferramenta:${saida.acao}`, bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec,
        resumo: saida.resumo, dados: saida.dados, acao: saida.acao,
      });
      return 'seguir';
    }

    // 11. calar / sem bolha: marca a fala como vista e fica quieta
    if (saida.acao === 'calar' || !saida.bolhas.length) {
      if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
      await registrar(false, 'calar');
      dec({ resultado: 'calou', ...base2 });
      return 'seguir';
    }

    // 12. fala comum ou despedida
    const bolha = saida.bolhas[0]!;
    const segunda = saida.bolhas[1];
    const peca = saida.peca && (saida.peca.tipo === 'link' || saida.peca.tipo === 'pix') && segunda
      ? { tipo: saida.peca.tipo, texto: segunda } : undefined;
    const naoIncomodar = saida.acao === 'nao_incomodar';

    // O estado nao_incomodar é gravado ANTES da despedida: se algo falhar daqui em diante, a conversa já está calada
    // (lado seguro). Em troca, uma despedida recusada pelo envio NÃO é tentada de novo: a pessoa pediu para parar.
    if (naoIncomodar && !dry) await atualizarPosse(chave, { estado: 'nao_incomodar', ate_wa_id: L.id });
    const res: ResultadoEnvio = await enviarResposta({
      dona, telefone: tel, waIdAlvo: L.id, momentoFalaLead: L.momment, bolha, ...(peca && !naoIncomodar ? { peca } : {}), dry,
    }, g.agoraEnvio());
    // O silêncio vem DEPOIS da despedida (o enviarResposta barraria uma fala a quem já está no opt-out).
    if (naoIncomodar && !dry) await silenciarContato(tel, 'opt_out', 'agentes5040-vivo');

    if (res.ok) {
      if (!dry) {
        if (!naoIncomodar) await atualizarPosse(chave, { ate_wa_id: L.id, respostas: posse.respostas + 1 });
        await registrar(true);
      }
      r.enviadas++;
      dec({ resultado: naoIncomodar ? 'despedida_enviada' : 'enviada', ...base2 });
      return 'seguir';
    }
    const m = res.motivo;
    const extra = { ...base2, motivo: res.detalhe ? `${m}:${res.detalhe}` : m };
    switch (m) {
      case 'dry':
        dec({ resultado: naoIncomodar ? 'despedida_sairia' : 'sairia', ...extra, motivo: null, sairia: [bolha, ...(peca && !naoIncomodar ? [peca.texto] : [])] });
        return 'seguir';
      case 'ja_respondido':
        if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
        dec({ resultado: 'ja_respondido', ...extra });
        return 'seguir';
      case 'espacamento':
        await soltar();
        r.parou = 'espacamento';
        dec({ resultado: 'espacamento', ...extra });
        return 'parar';
      case 'prazo':
        // Passou de 15 min durante a conversa com o modelo: ficha ao humano, sem bolha.
        await registrar(false, 'prazo');
        await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'prazo', bolha: false, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec });
        return 'seguir';
      case 'linha_pausada': case 'teto_agentes': case 'teto_linha':
        await soltar();                         // passageiro: a próxima rodada tenta de novo, dentro dos 15 min
        soma(r.puladas, `recusa_${m}`);
        dec({ resultado: 'recusada', ...extra });
        return 'seguir';
      case 'erro_linha':
        // O carimbo fica e a vez também: repetir só devolveria ja_respondido. Passou de 15 min, a fila vira ficha.
        // A linha está com problema: PARA a rodada inteira (não segue para a próxima conversa).
        await registrar(false, 'erro_linha');
        soma(r.puladas, 'recusa_erro_linha');
        r.parou = 'erro_linha';
        dec({ resultado: 'recusada', ...extra });
        return 'parar';
      case 'pediu_humano':
        // A supressão do telefone diz que a pessoa pediu gente: a agente não fala, e a conversa passa ao humano com
        // ficha, SEM bolha (a bolha seria uma fala do robô a quem pediu para não falar com robô).
        await registrar(false, 'pediu_humano');
        await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'pediu_humano', bolha: false, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec });
        return 'seguir';
      case 'bolha_invalida':
        // Sem fala segura (a bolha do modelo não passou nas regras do envio): é a trava, passa ao humano com ficha e,
        // só se a ficha saiu, a bolha fixa.
        await registrar(false, 'bolha_invalida');
        await passarAoHumano(g, { chave, tel, L, posse, hmac, motivo: 'trava', bolha: true, card: ctx0.card, buscarCard: false, nome: ctx0.nome, dec, detalhe: `bolha_invalida:${res.detalhe ?? ''}` });
        return 'seguir';
      default:                                   // pausa_humana, bloqueado, mudo, robo_do_outro_lado
        if (!dry) await atualizarPosse(chave, { ate_wa_id: L.id });
        await registrar(false, m);
        soma(r.puladas, `recusa_${m}`);
        dec({ resultado: 'recusada', ...extra });
        return 'seguir';
    }
  } catch (err) {
    await soltar();
    logger.error(LOG, `conversa ${L.id}: erro interno (${codigoDe(err)})`);
    soma(r.puladas, 'erro_interno');
    return 'seguir';
  }
}

// ── passar ao humano: a ficha ao consultor ───────────────────────────────────

interface PedidoHumano {
  chave: string;
  tel: string | null;
  L: { id: number; momment: string };
  posse: DadosPosse;
  hmac: string;
  motivo: string;
  /** Mandar a bolha fixa depois da ficha (só sai se a ficha saiu). */
  bolha: boolean;
  card: CardResumo | null;
  /** Sem contexto montado: procura o card do telefone. */
  buscarCard: boolean;
  nome: string | null;
  dec: (d: Partial<DecisaoVivo> & { resultado: string }) => void;
  resumo?: string;
  dados?: Record<string, string>;
  acao?: string;
  detalhe?: string;
}

function textoDaFicha(p: PedidoHumano, card: CardResumo | null, destinoDono: string): string {
  const semCard = !card;
  const pseudo: CardDaFicha = card
    ? { id: card.id, vendedor_nome: card.vendedor_nome, quando: card.quando, cliente_nome: card.cliente_nome, cidade: card.cidade,
        observacao: card.observacao, created_by: card.created_by, created_at: card.created_at, status: card.status }
    : { id: 0, vendedor_nome: null, quando: null, cliente_nome: p.nome, cidade: null, observacao: null, created_by: 'lp_solar' };
  const base = p.motivo.startsWith('ferramenta:') ? `o cliente pediu algo que só a consultora faz (${p.motivo.slice('ferramenta:'.length)})` : (MOTIVO_LEGIVEL[p.motivo] ?? p.motivo);
  const extra = [
    `Conversa passada pela ${p.posse.dona === 'duda' ? 'Duda' : 'agente'}: ${base}`,
    ...(semCard ? ['Ainda sem card na agenda'] : []),
    ...(p.resumo ? [`Resumo: ${p.resumo}`] : []),
    ...Object.entries(p.dados ?? {}).slice(0, 4).map(([k, v]) => `${k}: ${v}`),
  ];
  const linhas = fichaDeCampos(pseudo, extra).linhas.filter(l => !(semCard && l.startsWith('Conversa completa:')));
  return textoDaMensagem(blocoSeguro(linhas), p.tel, destinoDono);
}

const chaveFichaDaFala = (h: string): string => `ficha_lead:${h}`;

/**
 * Ficha ao consultor dono do card (ou ao dono, com o motivo na 1ª linha) e, só se ela saiu, a bolha fixa. A
 * reserva é POR FALA (ficha_lead:<hmac(chave|vivo|waId)>): repetir a rodada nunca manda duas fichas, e a ficha do
 * card (fichaTick) segue livre para o mesmo cliente. Ficha que PROVOU não sair (cooldown, credencial) desfaz a
 * reserva e deixa a posse viva (a próxima rodada tenta); ficha incerta (5xx, timeout) vira passou_humano sem bolha.
 */
async function passarAoHumano(g: G, p: PedidoHumano): Promise<void> {
  const { r, dry, agora } = g;
  let card = p.card;
  if (p.buscarCard) { try { card = (await lerCards(p.chave))[0] ?? null; } catch { card = null; } }
  const nome = p.nome ?? card?.cliente_nome ?? null;
  const dec = (d: Partial<DecisaoVivo> & { resultado: string }): void =>
    p.dec({ acao: p.acao ?? null, motivo: p.detalhe ? `${p.motivo}:${String(p.detalhe).slice(0, 80)}` : p.motivo, ...d });
  const pedido = { ...p, nome };

  const hl = hmacDe(`${p.chave}|vivo|${p.L.id}`);
  const quem = String(card?.vendedor_nome ?? '').trim();
  let telCons: string | null = null;
  if (!dry && quem) {
    const t = await carregarTelefonesConsultores();
    telCons = telefoneDoConsultor(t.ok ? t.mapa : new Map(), quem);
  }
  const motivoDono = quem ? `Sem telefone cadastrado para o consultor ${quem.replace(/\s+/g, ' ').slice(0, 40)}.` : 'Card sem consultor dono.';
  const prefixoDono = telCons ? '' : `${motivoDono} Encaminhe esta ficha ao consultor certo.`;
  const texto = textoDaFicha(pedido, card, prefixoDono);

  if (dry) { dec({ resultado: 'passaria_ao_humano', ficha: 'ficharia', ...(p.bolha ? { sairia: [bolhaDaPassagem(p.acao)] } : {}) }); return; }

  const adiar = (): void => { soma(r.puladas, 'ficha_adiada'); dec({ resultado: 'ficha_adiada', ficha: 'adiada' }); };
  if (!hl || linhaIoEmCooldown()) { adiar(); return; }
  const chaveFicha = chaveFichaDaFala(hl);
  const reserva = await reservarChave(chaveFicha, { estado: 'reservada' }, agora);
  if (reserva === 'erro') { adiar(); return; }
  if (reserva === 'ja_existe') {
    // Já houve ficha (ou tentativa incerta) para esta fala: não manda outra, não promete nada, e a conversa sai da fila.
    await atualizarPosse(p.chave, { estado: 'passou_humano', ate_wa_id: p.L.id });
    dec({ resultado: 'passou_ao_humano', ficha: 'lead_ja_avisado' });
    return;
  }

  const destino = telCons ?? telefoneDoDono();
  try {
    await enviarFichaAoConsultor(destino, texto);
  } catch (err) {
    if (erroProvaQueNaoSaiu(err)) {
      await liberarChave(chaveFicha);
      adiar();
      return;
    }
    logger.error(LOG, `ficha da fala ${p.L.id} falhou (${codigoDe(err)}); pode ter saído`);
    await atualizarPosse(p.chave, { estado: 'passou_humano', ate_wa_id: p.L.id });
    dec({ resultado: 'passou_ao_humano', ficha: 'falhou' });
    return;
  }
  try { await supabase.from('system_state').update({ value: { estado: 'enviada' } }).eq('key', chaveFicha); } catch { /* o carimbo já existe */ }

  let patch: Partial<DadosPosse> = { estado: 'passou_humano', ate_wa_id: p.L.id };
  let enviadas = 0;
  const bolhaFixa = bolhaDaPassagem(p.acao);
  if (p.bolha && p.tel) {
    const res = await enviarResposta({
      dona: p.posse.dona as DonaViva, telefone: p.tel, waIdAlvo: p.L.id, momentoFalaLead: p.L.momment,
      bolha: bolhaFixa, dry: false,
    }, g.agoraEnvio());
    if (res.ok) { enviadas = 1; patch = { ...patch, respostas: p.posse.respostas + 1 }; }
    else dec({ resultado: 'bolha_recusada', motivo: res.motivo });
  }
  await atualizarPosse(p.chave, patch);
  r.enviadas += enviadas;
  dec({ resultado: 'passou_ao_humano', ficha: 'enviada', n_bolhas: enviadas, tamanho: enviadas ? bolhaFixa.length : 0 });
}
