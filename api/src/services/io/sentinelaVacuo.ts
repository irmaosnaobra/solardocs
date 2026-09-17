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

/** Mesma tabela da recepção: solar é da Giovanna, eletroposto é dos dois donos,
 *  o resto é backoffice do Thiago. Duplicada aqui de propósito — a recepção não
 *  exporta, e fazer ela exportar arrastaria o módulo inteiro pra dentro do cron. */
const DESTINO: Record<string, string[]> = {
  solar:       ['giovanna'],
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
 * Dá pra cobrar AGORA? O cron mestre roda de hora em hora, 24 horas por dia, e
 * "profissional" não combina com resumo de cobrança chegando 3h da manhã no
 * celular da Giovanna. A espera continua sendo medida o tempo todo; o que espera
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
}

/**
 * Uma varredura. Roda de hora em hora; `dry` mostra o que faria sem mandar nada.
 */
export async function runSentinelaVacuo(opts: { dry?: boolean } = {}): Promise<VacuoResult> {
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
  const { data: msgs, error } = await supabase
    .from('wa_mensagens')
    .select('telefone, from_me, texto, momment, chat_name, sender_name')
    .eq('instancia', INSTANCIA_IO())
    .eq('is_group', false)
    .gte('momment', desde)
    .order('momment', { ascending: true })
    .limit(20000);
  if (error) {
    logger.error('sentinela-vacuo', 'falha lendo as conversas', error);
    return { paradas: 0, cobrancas: 0, avisados: [], motivo: 'erro_leitura' };
  }

  interface Estado { tel: string; nome: string | null; deles: string | null; nossa: string | null; texto: string | null }
  const porTel = new Map<string, Estado>();
  for (const m of (msgs || []) as Array<Record<string, unknown>>) {
    const tel = String(m.telefone || '');
    const k = chaveContato(tel);
    if (!k || NUMEROS_DA_CASA.has(k)) continue;
    const at = String(m.momment || '');
    const e = porTel.get(k) || { tel, nome: null, deles: null, nossa: null, texto: null };
    if (m.from_me) {
      e.nossa = at;
    } else {
      e.deles = at;
      e.texto = (m.texto as string) ?? null;
      e.nome = (m.chat_name as string) || (m.sender_name as string) || e.nome;
    }
    porTel.set(k, e);
  }

  // 2. Quem está esperando: a última palavra é dela, e já passou o tempo útil.
  const esperando: Array<Estado & { horas: number }> = [];
  for (const e of porTel.values()) {
    if (!e.deles) continue;
    if (e.nossa && e.nossa >= e.deles) continue;              // já respondemos depois
    const horas = horasUteisEntre(new Date(e.deles), agora);
    if (horas >= NIVEIS[0].horas) esperando.push({ ...e, horas });
  }
  if (esperando.length === 0) return { paradas: 0, cobrancas: 0, avisados: [], motivo: 'ninguem_esperando' };

  // 3. Quem pediu pra não ser incomodado não vira cobrança (a pessoa pode ter
  //    escrito "para de mandar" — responder isso com um robô é o oposto).
  const silenciado = await carregarSilenciados();

  // 4. Contexto: produto da triagem e ficha do CRM, pra saber quem cobrar.
  const [sessoesQ, leadsQ] = await Promise.all([
    supabase.from('whatsapp_sessions').select('phone, lead_data').eq('tipo', 'recepcao_io').limit(2000),
    supabase.from('sdr_leads').select('phone, nome, tipo, lead_origem').eq('instance', 'io').limit(2000),
  ]);
  const sessoes = new Map<string, string>();
  for (const s of (sessoesQ.data || []) as Array<Record<string, any>>) {
    const k = chaveContato(String(s.phone || ''));
    const p = String(s.lead_data?.produto || '');
    if (k && p) sessoes.set(k, p);
  }
  const leads = new Map<string, { tipo: string | null; lead_origem: string | null; nome: string | null }>();
  for (const l of (leadsQ.data || []) as Array<Record<string, any>>) {
    const k = chaveContato(String(l.phone || ''));
    if (k) leads.set(k, { tipo: l.tipo ?? null, lead_origem: l.lead_origem ?? null, nome: l.nome ?? null });
  }

  // 5. Nível de cobrança de cada um, pulando o que já foi cobrado.
  const marcadores = await supabase
    .from('system_state').select('key').like('key', 'vacuo_avisado:%')
    .gte('updated_at', desde).limit(5000);
  const jaCobrado = new Set<string>(((marcadores.data || []) as Array<{ key: string }>).map(r => r.key));

  const porDono = new Map<string, ConversaParada[]>();
  const paradas: ConversaParada[] = [];
  for (const e of esperando) {
    if (silenciado(e.tel)) continue;
    const k = chaveContato(e.tel) || e.tel;
    // O nível mais alto que ele já alcançou e que ainda não foi cobrado.
    const nivel = [...NIVEIS].reverse().find(n => e.horas >= n.horas && !jaCobrado.has(chaveAviso(e.tel, n.n)));
    if (!nivel) continue;
    const produto = produtoDe(e.tel, sessoes, leads);
    const donos = [...new Set([...(DESTINO[produto] || ['thiago']), ...nivel.sobe])];
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

  if (paradas.length === 0) {
    return { paradas: esperando.length, cobrancas: 0, avisados: [], motivo: 'todas_ja_cobradas', dry: dry || undefined };
  }

  if (dry) {
    return {
      paradas: paradas.length,
      cobrancas: 0,
      avisados: [...porDono.keys()],
      motivo: 'cobraria_agora',
      dry: true,
      amostra: paradas.slice(0, 10).map(p => ({ nome: p.nome, horas: Math.round(p.horasUteis * 10) / 10, produto: p.produto, nivel: p.nivel })),
    };
  }

  // 6. Um resumo por dono. Marca ANTES de mandar: falha de envio que não marcou
  //    faria a próxima rodada cobrar tudo de novo, e o robô que repete é o robô
  //    que a equipe silencia.
  let cobrancas = 0;
  const avisados: string[] = [];
  for (const [dono, itens] of porDono) {
    const alvo = CONSULTOR[dono]?.phone;
    if (!alvo) continue;
    const agoraIso = new Date().toISOString();
    await Promise.all(itens.map(i => supabase.from('system_state').upsert(
      { key: chaveAviso(i.telefone, i.nivel), value: agoraIso, updated_at: agoraIso },
      { onConflict: 'key' },
    )));
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
