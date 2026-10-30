// ─────────────────────────────────────────────────────────────────────────────
// SENTINELA DO VÁCUO — ninguém que escreveu pra gente fica sem resposta.
//
// O buraco, medido em 17/09/2026 sobre `wa_mensagens` (linha IO, 553498165040):
//
//   últimos 30 dias   468 pessoas escreveram
//                     159 escreveram POR ÚLTIMO (a bola está com a gente)
//                     142 dessas há mais de 24h
//   últimos 6 dias    153 escreveram, 49 esperando resposta há +24h
//
// A recepção (Duda) resolveu o "ninguém responde nada": em 6 dias só 5 pessoas
// ficaram sem qualquer retorno, contra 117 de 171 antes dela. O que sobrou é
// outro problema: a Duda tria, entrega a ficha pro humano, e A PARTIR DALI o
// silêncio é do humano. Robô nenhum pode falar por cima dele — então a única
// coisa certa a fazer é COBRAR O HUMANO, não mandar mais mensagem pro cliente.
//
// É isso que este serviço faz. Ele não fala com cliente nenhum: manda um resumo
// pro dono do produto dizendo quem está esperando, há quanto tempo, e o link
// direto da conversa.
//
// ── Três decisões que valem o comentário ────────────────────────────────────
//
// 1. RELÓGIO ÚTIL, não relógio de parede. Mensagem que chegou 19h50 não está
//    "sem resposta há 14 horas" às 9h do dia seguinte: está há 10 minutos. Sem
//    isso toda segunda-feira começaria com uma enxurrada de sábado.
//
// 2. UM RESUMO POR DONO, não um aviso por pessoa. Na primeira rodada há dezenas
//    de conversas paradas; 49 bolhas seguidas viram silenciamento do robô no
//    mesmo dia (foi o que matou a pauta do grupo). Um recado com a lista é o que
//    se lê.
//
// 3. ESTES ENVIOS NÃO ENTRAM NO ORÇAMENTO ANTI-BAN DA LINHA. O teto existe pra
//    proteger a linha de quem NÃO nos conhece: desconhecido que recebe demais
//    denuncia, e denúncia derruba número. Aqui o destinatário é o celular da
//    própria equipe, com conversa aberta há meses. Gastar orçamento de lead com
//    recado interno seria repetir, ao contrário, o bug que fez a agenda calar
//    todos os follow-ups (ver PREFIXOS_AGENDA em lineThrottle). O freio aqui é
//    outro: um resumo por dono por rodada, e no máximo 3 cobranças por conversa.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { carregarSilenciados, chaveContato } from '../agents/whatsapp/silenciar';

/** Instância da linha IO em `wa_mensagens`. A env manda; o valor é o fallback
 *  medido no banco, pra sentinela não morrer calada num deploy sem env. */
const INSTANCIA_IO = (): string =>
  (process.env.ZAPI_INSTANCE_ID_IO || '').trim() || '3F26F6ECE67D72BB7FCA6244BF24326C';

const CONSULTOR: Record<string, { nome: string; phone: string }> = {
  thiago:   { nome: 'Thiago',   phone: '34991360223' },
  diego:    { nome: 'Diego',    phone: '34991360172' },
  nilce:    { nome: 'Nilce',    phone: '34991516846' },
  giovanna: { nome: 'Giovanna', phone: '34993396255' },
};

/** Mesma tabela da recepção: solar é da Nilce (desde 24/10/2026), eletroposto é dos dois donos,
 *  o resto é backoffice do Thiago. Duplicada aqui de propósito — a recepção não
 *  exporta, e fazer ela exportar arrastaria o módulo inteiro pra dentro do cron. */
const DESTINO: Record<string, string[]> = {
  solar:       ['nilce'],
  eletroposto: ['thiago', 'diego'],
  solardoc:    ['thiago'],
  bike:        ['thiago'],
  curso:       ['thiago'],
  cliente:     ['thiago'],
  outro:       ['thiago'],
};

const ROTULO: Record<string, string> = {
  solar: 'Solar', eletroposto: 'Eletroposto', solardoc: 'SolarDoc',
  bike: 'Bike', curso: 'Curso', cliente: 'Cliente', outro: 'Sem produto definido',
};

/** Os celulares da casa. Thiago escrevendo pra linha não é lead esperando. */
const NUMEROS_DA_CASA = new Set(
  Object.values(CONSULTOR).map(c => chaveContato(c.phone)).filter(Boolean) as string[],
);

// ── Régua de cobrança, em HORAS ÚTEIS ────────────────────────────────────────
// Três níveis e acabou. O quarto aviso não faz ninguém responder mais rápido,
// só ensina a equipe a ignorar o robô.
// `sobe` ACRESCENTA gente ao dono do produto, não troca. Trocar faria a Giovanna
// parar de ver justamente os casos dela que mais esperaram, que são os que ela
// precisa ver.
export interface Nivel { n: number; horas: number; sobe: string[] }
export const NIVEIS: Nivel[] = [
  { n: 1, horas: Number(process.env.VACUO_NIVEL1_H || 3),  sobe: [] },            // o dono do produto
  { n: 2, horas: Number(process.env.VACUO_NIVEL2_H || 8),  sobe: [] },            // o dono de novo
  { n: 3, horas: Number(process.env.VACUO_NIVEL3_H || 24), sobe: ['thiago'] },    // e agora o Thiago junto
];

const JANELA_INICIO_H = Number(process.env.VACUO_INICIO_H || 9);
const JANELA_FIM_H    = Number(process.env.VACUO_FIM_H || 20);

/** Kill-switch. VACUO_OFF=1 cala a sentinela sem deploy. */
const desligada = (): boolean => (process.env.VACUO_OFF || '').trim() === '1';

/**
 * Dá pra cobrar AGORA? A sentinela é chamada pelo /io-broadcast-tick (a cada
 * 5 min) e pelo /process-messages, 24 horas por dia, com represa de 20 min aqui
 * dentro. E "profissional" não combina com resumo de cobrança chegando 3h da
 * manhã no celular da Giovanna. A espera continua sendo medida o tempo todo; o que espera
 * o expediente é o RECADO.
 *
 * O modo seco ignora esta janela de propósito: conferir o que ela faria é uma
 * pergunta, não um envio.
 */
export function dentroDoExpediente(agora: Date = new Date()): boolean {
  const b = brt(agora);
  if (b.getUTCDay() === 0) return false;                       // domingo ninguém cobra ninguém
  const h = b.getUTCHours();
  return h >= JANELA_INICIO_H && h < JANELA_FIM_H;
}

/** Instante em horário de Brasília, como Date em UTC deslocado (o servidor roda em UTC). */
const brt = (d: Date): Date => new Date(d.getTime() - 3 * 60 * 60 * 1000);

/**
 * Horas ÚTEIS entre dois instantes: só conta 9h–20h de segunda a sábado.
 *
 * É a diferença entre "esse cliente está esperando desde ontem à noite" e "esse
 * cliente está esperando há 3 horas do meu dia de trabalho". Sem ela, toda
 * segunda-feira abriria com a fila inteira de domingo marcada como atrasada.
 *
 * Pura e exportada: é a regra que decide quem entra na cobrança, então é ela que
 * os testes prendem.
 */
export function horasUteisEntre(de: Date, ate: Date): number {
  if (!(de instanceof Date) || !(ate instanceof Date) || ate <= de) return 0;
  const PASSO_MS = 5 * 60 * 1000;                       // 5 min: erro máximo de 5 min numa régua de horas
  let uteisMs = 0;
  for (let t = de.getTime(); t < ate.getTime(); t += PASSO_MS) {
    const b = brt(new Date(t));
    const dia = b.getUTCDay();                          // 0 = domingo
    const h = b.getUTCHours();
    if (dia !== 0 && h >= JANELA_INICIO_H && h < JANELA_FIM_H) uteisMs += PASSO_MS;
  }
  return uteisMs / 3_600_000;
}

export interface ConversaParada {
  telefone: string;
  nome: string | null;
  ultimaDeles: string;
  texto: string | null;
  horasUteis: number;
  produto: string;
  nivel: number;
  donos: string[];
}

/** Marcador de cobrança já feita, por conversa e por nível. */
const chaveAviso = (tel: string, nivel: number): string => `vacuo_avisado:${chaveContato(tel) || tel}:${nivel}`;

/** Recorte legível da última mensagem da pessoa. Uma linha, sem quebrar o resumo. */
const trecho = (t: unknown, max = 90): string => {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '(mídia ou áudio)';
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/**
 * Qual produto é essa conversa, pra saber quem cobrar.
 *
 * A ordem importa: a triagem da recepção é a fonte mais confiável (a pessoa
 * acabou de dizer o que quer), depois a ficha do CRM, e por último o default de
 * backoffice. Conversa sem produto NÃO é descartada — vai pro Thiago, porque o
 * problema que este serviço resolve é justamente ninguém ficar sem dono.
 */
function produtoDe(
  tel: string,
  sessoes: Map<string, string>,
  leads: Map<string, { tipo: string | null; lead_origem: string | null; nome: string | null }>,
): string {
  const k = chaveContato(tel) || tel;
  const daTriagem = sessoes.get(k);
  if (daTriagem && DESTINO[daTriagem]) return daTriagem;
  const lead = leads.get(k);
  const cru = `${lead?.tipo || ''} ${lead?.lead_origem || ''}`.toLowerCase();
  if (/eletroposto|carregador|nexus/.test(cru)) return 'eletroposto';
  if (/solar|kwh|gerador/.test(cru)) return 'solar';
  if (/b2b|solardoc|integrador/.test(cru)) return 'solardoc';
  if (/bike/.test(cru)) return 'bike';
  return 'outro';
}

// ── Dono do card da agenda ───────────────────────────────────────────────────
// Medido em 28 e 29/10/2026: 8 leads com card de eletroposto (7 da Giovanna)
// escreveram pra linha, caíram como "Sem produto definido" e a cobrança foi só
// pro Thiago (47 resumos em 3 dias). Quem é DONO DA REUNIÃO nunca foi cobrado.
// Regra do dono: lead que tem reunião é cobrado ao consultor dono da reunião.

/** Status fechados do card. Duplicado de `temReuniaoAtiva` (recepcaoIo.ts, que
 *  não exporta e arrastaria o módulo inteiro pra dentro do cron). */
const STATUS_MORTOS = new Set(['cancelado', 'sem_interesse', 'fechou_concorrente', 'fechou']);

/** Janela do card: a mesma de `temAgendaDeEletroposto` (recepcaoIo.ts). */
const CARD_DESDE_DIAS = 10;
const CARD_ATE_DIAS = 60;
const CARD_TIMEOUT_MS = 10_000;
const CARD_LOTE = 5;

const donoDoCardDesligado = (): boolean => (process.env.VACUO_DONO_DO_CARD_OFF || '').trim() === '1';

export interface DonoDoCard { dono: string; createdBy: string }

/** "Giovânna Silva" -> "giovanna", só se for consultor conhecido. */
function chaveDoConsultor(nome: unknown): string | null {
  const primeiro = String(nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().split(/\s+/)[0] || '';
  return primeiro && Object.prototype.hasOwnProperty.call(CONSULTOR, primeiro) ? primeiro : null;
}

/**
 * Pra cada telefone parado, o consultor dono do card ATIVO dele na agenda
 * (banco do Gerador). Chave do mapa: `chaveContato` (trata o 9º dígito).
 *
 * Nunca derruba a rodada: erro ou timeout vira aviso no log (com quantos
 * telefones ficaram sem consulta) e devolve o que já tinha achado; o resto vale o
 * destino de sempre. Consulta por telefone (últimos 8 dígitos) porque o
 * PostgREST corta em 1000 linhas e puxar a tabela esconderia card calado.
 * `VACUO_DONO_DO_CARD_OFF=1` desliga só esta busca, sem deploy.
 */
export async function buscarDonosDosCards(telefones: string[]): Promise<Map<string, DonoDoCard>> {
  if (donoDoCardDesligado()) return new Map();
  const alvos = new Map<string, string>();               // chaveContato -> últimos 8 dígitos
  for (const t of telefones) {
    const k = chaveContato(t);
    const cauda = String(t).replace(/\D/g, '').slice(-8);
    if (k && cauda.length === 8) alvos.set(k, cauda);
  }
  if (alvos.size === 0) return new Map();

  const agora = Date.now();
  const desde = new Date(agora - CARD_DESDE_DIAS * 86400_000).toISOString();
  const ate = new Date(agora + CARD_ATE_DIAS * 86400_000).toISOString();

  // Qual card vale: o de `quando` FUTURO mais próximo; sem futuro, o passado mais
  // recente. (Reunião daqui a 3 dias pesa mais que a de ontem, que já aconteceu.)
  const achados = new Map<string, DonoDoCard & { futuro: boolean; dist: number }>();
  const consultados = new Set<string>();
  let abortado = false;                                  // depois do erro/timeout, nada mais escreve
  const trabalho = async (): Promise<void> => {
    const lista = [...alvos.entries()];
    for (let i = 0; i < lista.length && !abortado; i += CARD_LOTE) {
      await Promise.all(lista.slice(i, i + CARD_LOTE).map(async ([k, cauda]) => {
        const { data, error } = await supabaseGerador
          .from('agendamentos')
          .select('cliente_telefone, vendedor_nome, created_by, status, quando')
          .like('cliente_telefone', `%${cauda}`)
          .gte('quando', desde).lte('quando', ate)
          .limit(50);
        if (error) throw error;
        if (abortado) return;
        for (const r of (data ?? []) as Array<Record<string, unknown>>) {
          if (chaveContato(String(r.cliente_telefone ?? '')) !== k) continue;   // casa de verdade, não só pela cauda
          if (STATUS_MORTOS.has(String(r.status ?? ''))) continue;
          const dono = chaveDoConsultor(r.vendedor_nome);
          if (!dono) continue;                                                  // dono desconhecido: ignora o card
          const quando = Date.parse(String(r.quando ?? ''));
          if (!Number.isFinite(quando)) continue;
          const futuro = quando >= agora;
          const dist = Math.abs(quando - agora);
          const atual = achados.get(k);
          const melhor = !atual
            || (futuro && !atual.futuro)
            || (futuro === atual.futuro && dist < atual.dist);
          if (melhor) achados.set(k, { dono, createdBy: String(r.created_by ?? ''), futuro, dist });
        }
        consultados.add(k);
      }));
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      trabalho(),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), CARD_TIMEOUT_MS); }),
    ]);
  } catch (err) {
    // Erro ou timeout num lote NÃO joga fora o que já foi achado: devolve os cards
    // dos telefones consultados e deixa os demais no destino de sempre.
    abortado = true;
    logger.warn(
      'sentinela-vacuo',
      `dono do card: ${alvos.size - consultados.size} de ${alvos.size} telefone(s) ficaram sem consulta; eles seguem pelo destino do produto`,
      err,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  return new Map([...achados].map(([k, v]) => [k, { dono: v.dono, createdBy: v.createdBy }]));
}

/** Rótulo de produto e donos de uma conversa. Com card ativo, o dono da reunião
 *  vem no lugar do destino do produto; o `sobe` do nível continua somando. */
function resolverDonos(produto: string, nivel: Nivel, card?: DonoDoCard): { produto: string; donos: string[] } {
  if (!card) return { produto, donos: [...new Set([...(DESTINO[produto] || ['thiago']), ...nivel.sobe])] };
  const rotulo = produto === 'outro' && card.createdBy.toLowerCase().includes('eletroposto') ? 'eletroposto' : produto;
  return { produto: rotulo, donos: [...new Set([card.dono, ...nivel.sobe])] };
}

export function montarResumo(dono: string, itens: ConversaParada[]): string {
  const nome = CONSULTOR[dono]?.nome || dono;
  // Mais recente primeiro: é quem ainda dá pra salvar. Quem está esperando há
  // uma semana já decidiu o que ia decidir.
  const ordenados = [...itens].sort((a, b) => a.horasUteis - b.horasUteis);
  const linhas = ordenados.slice(0, 12).map(i => {
    // Acima de um dia útil a conta vira dia: "38h" não diz nada, "3 dias" dói.
    const dias = i.horasUteis / 11;                     // 11h de expediente por dia
    const h = dias >= 1 ? `${Math.floor(dias)} dia(s) de trabalho`
      : i.horasUteis >= 1 ? `${Math.floor(i.horasUteis)}h`
      : `${Math.round(i.horasUteis * 60)}min`;
    return [
      `• *${i.nome || 'Sem nome'}* (${ROTULO[i.produto] || i.produto}) esperando há ${h}`,
      `  _"${trecho(i.texto)}"_`,
      `  wa.me/${i.telefone.replace(/\D/g, '')}`,
    ].join('\n');
  });
  const sobra = itens.length - Math.min(itens.length, 12);
  return [
    `⏳ *${nome}, ${itens.length === 1 ? 'tem 1 pessoa esperando' : `tem ${itens.length} pessoas esperando`} resposta*`,
    '',
    ...linhas,
    ...(sobra > 0 ? ['', `_e mais ${sobra} conversa(s) na mesma situação._`] : []),
    '',
    '_Quem escreveu e não é respondido some, e não volta. Se já resolveu por outro canal, ignora este recado._',
  ].join('\n');
}

/**
 * Represa da varredura. A sentinela é chamada de minuto em minuto (é o único
 * ping confiável que existe — ver o comentário no /cron/io-broadcast-tick), mas
 * ela lê 7 dias de conversa: rodar isso 1.440 vezes por dia seria pagar caro por
 * uma resposta que muda de 20 em 20 minutos.
 *
 * O marcador fica no banco e não em memória porque função serverless morre e
 * renasce, e duas instâncias não compartilham variável.
 */
const CHAVE_VARREDURA = 'vacuo_ultima_varredura';
const MINUTOS_ENTRE_VARREDURAS = (): number => Number(process.env.VACUO_MINUTOS || 20);

async function varreuAgoraPouco(): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('system_state').select('value').eq('key', CHAVE_VARREDURA).maybeSingle();
    const t = data?.value ? Date.parse(String(data.value)) : NaN;
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < MINUTOS_ENTRE_VARREDURAS() * 60_000;
  } catch {
    return false;                       // fail-open: na dúvida, varre
  }
}

async function marcarVarredura(): Promise<void> {
  const agora = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: CHAVE_VARREDURA, value: agora, updated_at: agora }, { onConflict: 'key' },
  );
}

export interface VacuoResult {
  paradas: number;
  cobrancas: number;
  avisados: string[];
  motivo?: string;
  dry?: boolean;
  amostra?: Array<{ nome: string | null; horas: number; produto: string; nivel: number }>;
  /** Só no dry: conversas esperando por dono resolvido (só números, sem telefone). */
  porDono?: Record<string, number>;
}

/**
 * Uma varredura. É chamada de minuto em minuto pelo /cron/io-broadcast-tick e
 * represada em 20 minutos aqui dentro; `dry` mostra o que faria sem mandar nada.
 */
export async function runSentinelaVacuo(
  opts: { dry?: boolean; esperar?: (ms: number) => Promise<void> } = {},
): Promise<VacuoResult> {
  const dry = !!opts.dry;
  if (desligada()) return { paradas: 0, cobrancas: 0, avisados: [], motivo: 'desligada' };
  if (!dry && !dentroDoExpediente()) {
    return { paradas: 0, cobrancas: 0, avisados: [], motivo: 'fora_do_expediente' };
  }
  // Represa: a chamada é de minuto em minuto, a varredura é de 20 em 20.
  if (!dry && await varreuAgoraPouco()) {
    return { paradas: 0, cobrancas: 0, avisados: [], motivo: 'varrido_agora_pouco' };
  }
  if (!dry) await marcarVarredura();

  const agora = new Date();
  const desde = new Date(Date.now() - 7 * 86400_000).toISOString();

  // 1. A conversa crua dos últimos 7 dias. Direto de wa_mensagens: é o que de
  //    fato saiu e entrou na linha, e não o que algum robô ACHA que respondeu.
  //
  // A ORDEM É DECRESCENTE, E ISSO É A CORREÇÃO DE UM BURACO QUE ESCONDEU GENTE.
  // Até 18/09/2026 esta consulta pedia `ascending: true` com `limit(20000)`. A
  // resposta vem TRUNCADA bem antes disso, e truncada em ordem crescente
  // significa ficar só com a fatia mais VELHA da semana. Medido no dia: 5.487
  // mensagens na janela, e a sentinela enxergava até 17/09 às 17h — tudo que
  // chegou depois era invisível pra ela, todo dia, pra sempre.
  //
  // O caso que denunciou: o Cleber ofereceu um ponto comercial às 21:32 de 17/09
  // e ficou fora da conta. O robô cobrava as conversas mais velhas da semana e
  // era cego pras de hoje, que são justamente as que dá pra salvar.
  //
  // Decrescente inverte quem se perde no corte: perde-se o mais antigo, que é o
  // que já foi cobrado. E como aqui só interessa a ÚLTIMA fala de cada lado, ler
  // do mais novo pro mais velho e ficar com a PRIMEIRA ocorrência é a leitura
  // natural, não um truque.
  // Teto em env pra o teste conseguir provocar o corte com 4 mensagens em vez de
  // 20 mil. Sem isso o defeito acima não é testável, e defeito não testável é
  // defeito que volta.
  const LIMITE_MSGS = Number(process.env.VACUO_MAX_MSGS || 20000);
  const { data: msgs, error } = await supabase
    .from('wa_mensagens')
    .select('telefone, from_me, texto, momment, chat_name, sender_name')
    .eq('instancia', INSTANCIA_IO())
    .eq('is_group', false)
    .gte('momment', desde)
    .order('momment', { ascending: false })
    .limit(LIMITE_MSGS);
  if (error) {
    logger.error('sentinela-vacuo', 'falha lendo as conversas', error);
    return { paradas: 0, cobrancas: 0, avisados: [], motivo: 'erro_leitura' };
  }
  // Corte silencioso foi o que criou o buraco acima. Agora ele aparece no log.
  if ((msgs?.length || 0) >= LIMITE_MSGS) {
    logger.warn('sentinela-vacuo', `leitura no teto (${msgs?.length}): conversa antiga pode ter ficado de fora`);
  }

  interface Estado { tel: string; nome: string | null; deles: string | null; nossa: string | null; texto: string | null }
  const porTel = new Map<string, Estado>();
  for (const m of (msgs || []) as Array<Record<string, unknown>>) {
    const tel = String(m.telefone || '');
    const k = chaveContato(tel);
    if (!k || NUMEROS_DA_CASA.has(k)) continue;
    const at = String(m.momment || '');
    const e = porTel.get(k) || { tel, nome: null, deles: null, nossa: null, texto: null };
    // Vem do mais novo pro mais velho: a PRIMEIRA que aparece de cada lado é a
    // última que aconteceu. Sobrescrever aqui seria voltar no tempo.
    if (m.from_me) {
      if (!e.nossa) e.nossa = at;
    } else if (!e.deles) {
      e.deles = at;
      e.texto = (m.texto as string) ?? null;
      e.nome = (m.chat_name as string) || (m.sender_name as string) || e.nome;
    }
    porTel.set(k, e);
  }

  // 2. Contexto ANTES do filtro: produto da triagem, ficha do CRM e — o que
  //    importa aqui — a HORA DA ENTREGA da recepção. Ver o porquê logo abaixo.
  const [sessoesQ, leadsQ] = await Promise.all([
    supabase.from('whatsapp_sessions').select('phone, lead_data').eq('tipo', 'recepcao_io').limit(2000),
    supabase.from('sdr_leads').select('phone, nome, tipo, lead_origem').eq('instance', 'io').limit(2000),
  ]);
  const sessoes = new Map<string, string>();
  const entregues = new Map<string, string>();
  for (const s of (sessoesQ.data || []) as Array<Record<string, any>>) {
    const k = chaveContato(String(s.phone || ''));
    if (!k) continue;
    const p = String(s.lead_data?.produto || '');
    if (p) sessoes.set(k, p);
    const entregueEm = String(s.lead_data?.entregue_em || '');
    if (String(s.lead_data?.estado || '') === 'entregue' && entregueEm) entregues.set(k, entregueEm);
  }
  const leads = new Map<string, { tipo: string | null; lead_origem: string | null; nome: string | null }>();
  for (const l of (leadsQ.data || []) as Array<Record<string, any>>) {
    const k = chaveContato(String(l.phone || ''));
    if (k) leads.set(k, { tipo: l.tipo ?? null, lead_origem: l.lead_origem ?? null, nome: l.nome ?? null });
  }

  // 3. Quem está esperando: a última palavra é dela, e já passou o tempo útil.
  //
  // A BOLHA DE ENTREGA DA DUDA NÃO VALE COMO RESPOSTA. Quando a recepção
  // classifica e passa pro humano, ela manda "Deixa eu chamar a pessoa certa pra
  // te atender. Já já alguém responde!". Isso é `from_me`, então a regra crua
  // ("nossa mais nova que a dela") lia a conversa como ATENDIDA — bem no segundo
  // em que a espera começa.
  //
  // Medido no caso do Cléber Arantes (17/09/2026): ele mandou o endereço do ponto
  // às 21:32:23 e a bolha de entrega saiu às 21:32:23, no MESMO segundo. Ninguém
  // respondeu no dia seguinte inteiro e a sentinela não cobrou ninguém, porque
  // achava que já tinha sido respondido. Ou seja: ela era cega justamente no caso
  // que existe pra pegar, que é a recepção entregar e o humano não vir.
  //
  // A regra: se a sessão está `entregue` e a nossa última mensagem caiu dentro da
  // janela da entrega, ela é a despedida do robô, não a chegada de gente.
  const FOLGA_ENTREGA_MS = 120_000;
  const ehBolhaDeEntrega = (k: string, nossa: string): boolean => {
    const entregueEm = entregues.get(k);
    if (!entregueEm) return false;
    const d = Date.parse(nossa) - Date.parse(entregueEm);
    return Number.isFinite(d) && d >= -FOLGA_ENTREGA_MS && d <= FOLGA_ENTREGA_MS;
  };
  const esperando: Array<Estado & { horas: number }> = [];
  for (const [k, e] of porTel) {
    if (!e.deles) continue;
    const nossaVale = e.nossa && !ehBolhaDeEntrega(k, e.nossa) ? e.nossa : null;
    if (nossaVale && nossaVale >= e.deles) continue;           // gente respondeu depois
    const horas = horasUteisEntre(new Date(e.deles), agora);
    if (horas >= NIVEIS[0].horas) esperando.push({ ...e, horas });
  }
  if (esperando.length === 0) return { paradas: 0, cobrancas: 0, avisados: [], motivo: 'ninguem_esperando' };

  // 4. Quem pediu pra não ser incomodado não vira cobrança (a pessoa pode ter
  //    escrito "para de mandar" — responder isso com um robô é o oposto).
  const silenciado = await carregarSilenciados();

  // 5. Nível de cobrança de cada um, pulando o que já foi cobrado.
  //
  // ESTA LEITURA É A ÚNICA COISA QUE IMPEDE COBRAR A MESMA CONVERSA DE NOVO, e
  // por isso ela não pode falhar em silêncio. Sem olhar o `error`, uma consulta
  // que quebra devolve `data` nulo, o conjunto nasce vazio e TODA conversa
  // parada volta a parecer nunca cobrada: a mesma lista de 70 nomes cairia no
  // celular da equipe de 20 em 20 minutos, pela linha que menos pode levar
  // rajada. Fail-closed: na dúvida não cobra ninguém e tenta na próxima.
  //
  // É o mesmo defeito da sonda cega de documentos (`25604d2e`): `const { data }`
  // sem `error` faz consulta quebrada parecer dia tranquilo.
  const marcadores = await supabase
    .from('system_state').select('key').like('key', 'vacuo_avisado:%')
    .gte('updated_at', desde).limit(5000);
  if (marcadores.error) {
    logger.error('sentinela-vacuo', 'falha lendo os marcadores de cobranca', marcadores.error);
    // `paradas` é quanta conversa ESTE tick pegou pra cobrar. Aqui não pegou
    // nenhuma, então é 0 — devolver o tamanho da fila daria a mesma cara de
    // `todas_ja_cobradas`, que é o oposto do que aconteceu.
    return { paradas: 0, cobrancas: 0, avisados: [], motivo: 'erro_marcadores' };
  }
  const linhasMarcador = (marcadores.data || []) as Array<{ key: string }>;
  // Truncar aqui tem o mesmo efeito de não ler: o que ficou de fora do limite
  // parece nunca cobrado. Hoje sobram ~3 marcadores por conversa parada em 7
  // dias (algumas centenas), mas se um dia encostar no teto é melhor ver no log
  // do que descobrir pelo celular da equipe.
  if (linhasMarcador.length >= 5000) {
    logger.warn('sentinela-vacuo', 'marcadores no teto de 5000: a lista pode estar truncada');
  }
  const jaCobrado = new Set<string>(linhasMarcador.map(r => r.key));

  // Quem será cobrado agora. O dry olha TODAS as que esperam (inclusive as já
  // cobradas) pra contar o `porDono`: assim a regra do dono do card dá pra provar
  // no ar mesmo quando a rodada diria `todas_ja_cobradas`.
  const vivas = esperando.filter(e => !silenciado(e.tel));
  const aCobrar = new Map<typeof esperando[number], Nivel>();
  for (const e of vivas) {
    // O nível mais alto que ele já alcançou e que ainda não foi cobrado.
    const nivel = [...NIVEIS].reverse().find(n => e.horas >= n.horas && !jaCobrado.has(chaveAviso(e.tel, n.n)));
    if (nivel) aCobrar.set(e, nivel);
  }
  // Dono do card da agenda (banco do Gerador). Nunca aborta: erro vira mapa vazio.
  const cards = await buscarDonosDosCards((dry ? vivas : [...aCobrar.keys()]).map(e => e.tel));

  const porDono = new Map<string, ConversaParada[]>();
  const paradas: ConversaParada[] = [];
  for (const [e, nivel] of aCobrar) {
    const k = chaveContato(e.tel) || e.tel;
    const { produto, donos } = resolverDonos(produtoDe(e.tel, sessoes, leads), nivel, cards.get(k));
    const item: ConversaParada = {
      telefone: e.tel,
      nome: e.nome || leads.get(k)?.nome || null,
      ultimaDeles: e.deles as string,
      texto: e.texto,
      horasUteis: e.horas,
      produto,
      nivel: nivel.n,
      donos,
    };
    paradas.push(item);
    for (const d of donos) porDono.set(d, [...(porDono.get(d) || []), item]);
  }

  // Só números por dono (sem telefone), com o nível que cada conversa JÁ alcançou.
  const contagemPorDono = (): Record<string, number> => {
    const c: Record<string, number> = {};
    for (const e of vivas) {
      const nivel = [...NIVEIS].reverse().find(n => e.horas >= n.horas);
      if (!nivel) continue;
      const k = chaveContato(e.tel) || e.tel;
      for (const d of resolverDonos(produtoDe(e.tel, sessoes, leads), nivel, cards.get(k)).donos) c[d] = (c[d] || 0) + 1;
    }
    return c;
  };

  if (paradas.length === 0) {
    return {
      paradas: esperando.length, cobrancas: 0, avisados: [], motivo: 'todas_ja_cobradas', dry: dry || undefined,
      ...(dry ? { porDono: contagemPorDono() } : {}),
    };
  }

  if (dry) {
    return {
      paradas: paradas.length,
      cobrancas: 0,
      avisados: [...porDono.keys()],
      motivo: 'cobraria_agora',
      dry: true,
      amostra: paradas.slice(0, 10).map(p => ({ nome: p.nome, horas: Math.round(p.horasUteis * 10) / 10, produto: p.produto, nivel: p.nivel })),
      porDono: contagemPorDono(),
    };
  }

  // 6. Um resumo por dono. Marca ANTES de mandar: falha de envio que não marcou
  //    faria a próxima rodada cobrar tudo de novo, e o robô que repete é o robô
  //    que a equipe silencia.
  //
  // POR QUE ESTE ENVIO NÃO PASSA PELO REGIME ANTI-BAN DA LINHA (teto frio e
  // espaçamento de 10 a 15 min). Não é esquecimento, é medida:
  //
  //  - O destinatário é o celular da PRÓPRIA EQUIPE (no máximo 3 por varredura,
  //    conversa de mão dupla que existe todo dia). O que queima linha é toque
  //    frio em desconhecido, que bloqueia e denuncia — não recado pra dentro.
  //  - Exigir o espaçamento calaria a sentinela quase sempre: a linha produziu
  //    120 envios em 24h, ou seja um a cada ~5 min dentro da janela, e a regra
  //    pede 10 a 15 min de silêncio. Seria o mesmo buraco em que o aviso caiu
  //    (`57305d0c`): a trava certa pro robô errado, e ninguém descobre porque o
  //    sintoma é silêncio.
  //  - Também não carimba marcador em BOT_SENT_PREFIXES DE PROPÓSITO: se
  //    carimbasse, um recado interno empurraria pra frente a mensagem de um
  //    cliente. A prioridade é o contrário disso.
  //
  // O que segura o volume aqui é o marcador por conversa e por nível logo acima
  // (cada uma cobrada uma vez em cada nível) e a represa de 20 minutos lá em
  // cima — não o teto da linha.
  let cobrancas = 0;
  const avisados: string[] = [];
  const agoraIso = new Date().toISOString();

  // ESTADO PRIMEIRO, MENSAGEM DEPOIS: os marcadores de TODAS as cobranças da
  // rodada são gravados antes do primeiro envio. Com a espera entre um dono e
  // outro (abaixo), gravar dono a dono deixaria uma janela de minutos em que a
  // rodada morre (função serverless) e as conversas do dono seguinte voltam a
  // parecer nunca cobradas. Se a gravação falhar, a rodada não envia nada.
  //
  // CARIMBA TODOS OS NÍVEIS ATÉ O DELE, não só o dele. O seletor lá em cima pega
  // o nível mais ALTO que a conversa alcançou e ainda não foi cobrado. Se só o 3
  // fosse carimbado, a varredura seguinte acharia o 2 livre e cobraria A MESMA
  // conversa de novo, e vinte minutos depois o 1.
  //
  // Não é hipótese: aconteceu em 18/09/2026, no primeiro dia em que ela rodou.
  // As mesmas 19 conversas foram cobradas às 13:40, 14:00 e 14:22 — três recados
  // idênticos pro Thiago e pro Diego em 42 minutos. Toda conversa que já nasce
  // velha (e no primeiro dia eram todas) dispara os três níveis em rajada, que é
  // o oposto de uma régua que sobe com o tempo.
  //
  // Cobrou no 3 significa que o 1 e o 2 não têm mais o que dizer.
  const niveisACarimbar = (n: number): number[] => NIVEIS.filter(x => x.n <= n).map(x => x.n);
  const aEnviar = [...porDono].filter(([dono]) => !!CONSULTOR[dono]?.phone);
  const chavesACarimbar = new Set<string>();
  for (const [, itens] of aEnviar) {
    for (const i of itens) for (const n of niveisACarimbar(i.nivel)) chavesACarimbar.add(chaveAviso(i.telefone, n));
  }
  try {
    const gravacoes = await Promise.all([...chavesACarimbar].map(key =>
      supabase.from('system_state').upsert(
        { key, value: agoraIso, updated_at: agoraIso },
        { onConflict: 'key' },
      )));
    const falhou = gravacoes.find(g => g && (g as { error?: unknown }).error);
    if (falhou) throw (falhou as { error: unknown }).error;
  } catch (err) {
    logger.error('sentinela-vacuo', 'falha gravando os marcadores de cobranca: nada foi enviado', err);
    return { paradas: paradas.length, cobrancas: 0, avisados: [], motivo: 'erro_gravando_marcadores' };
  }

  // Espera entre um dono e o próximo (nada antes do primeiro): 25 s + sorteio de
  // 0 a 20 s, pra os recados não saírem colados pela mesma linha. Injetável
  // (`opts.esperar`) e zerável por env (`VACUO_ESPERA_DONOS_S`, `VACUO_SORTEIO_DONOS_S`).
  // Teto de 60 s em cada env e de 150 s somados: a função morre em 300 s, e os
  // marcadores já foram gravados, então dono que ficasse para depois perderia o nível.
  const esperar = opts.esperar ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const segundos = (v: string | undefined, padrao: number): number => {
    const n = Number(v ?? padrao);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), 60) : padrao;
  };
  const baseS = segundos(process.env.VACUO_ESPERA_DONOS_S, 25);
  const sorteioS = segundos(process.env.VACUO_SORTEIO_DONOS_S, 20);
  let esperadoMs = 0;
  let primeiro = true;
  for (const [dono, itens] of aEnviar) {
    const alvo = CONSULTOR[dono].phone;
    if (!primeiro) {
      const ms = Math.round((baseS + Math.random() * sorteioS) * 1000);
      if (ms > 0 && esperadoMs + ms <= 150_000) { await esperar(ms); esperadoMs += ms; }
    }
    primeiro = false;
    try {
      await sendWhatsApp(alvo, montarResumo(dono, itens), 'io');
      cobrancas += itens.length;
      avisados.push(dono);
      logger.info('sentinela-vacuo', `${itens.length} conversa(s) cobradas com ${dono}`);
    } catch (err) {
      logger.error('sentinela-vacuo', `falha avisando ${dono}`, err);
    }
  }

  return { paradas: paradas.length, cobrancas, avisados };
}
