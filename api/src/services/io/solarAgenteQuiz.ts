// ─────────────────────────────────────────────────────────────────────────────
// A AGENTE DO QUIZ SOLAR: A CONVERSA (08/10/2026)
//
// Ordem do Thiago: "uma agente tem que atender de imediato essas pessoas
// indicando quem irá atender; essa agente tem que entender contexto e conversar
// se necessário". A primeira mensagem sai pelo solarBoasVindas.ts (na hora em
// que o lead marca, ou como curioso, ou quando não marca). Este arquivo é o que
// vem DEPOIS: a pessoa responde, a Duda lê a conversa inteira e responde se
// precisar.
//
// O que ela sabe antes de abrir a boca (regra de 23/09, "robô lê o contexto
// antes de falar"):
//   1. tem humano na conversa? (podeFalarComLead: quem digitou no celular da
//      linha cala a agente por 24h)
//   2. tem horário marcado, com quem, quando, e se já confirmou?
//   3. o que NÓS dissemos por último (o histórico do 5040 entra no pedido)?
//   4. a pessoa desarmou (cancelou, quer trocar, não quer mais)?
// Sem conseguir ler isso, ela não fala.
//
// O que ela pode fazer: tirar dúvida geral de energia solar, explicar a visita
// ou o atendimento, confirmar presença (grava `presenca_confirmada_at`). O que
// ela NUNCA faz: dar preço, parcela, economia em reais, prazo ou marca. Pedido de
// trocar horário, de falar com gente, reclamação ou "não quero mais" vira recado
// no celular de quem atende, e a partir daí ela fica quieta naquela conversa.
//
// Travas: só responde mensagem de até 15 min (é reativa, não puxa assunto),
// espera 30 s para juntar mensagens seguidas, no máximo 8 respostas por pessoa,
// 3 conversas por rodada, e reivindica a vez antes de chamar a IA (dois ticks
// nunca respondem a mesma mensagem). A recepção da linha (recepcaoIo.ts) deixa
// estas conversas com ela: dois robôs na mesma conversa é o erro que esta linha
// já pagou.
//
// Kill-switch: SOLAR_AGENTE_OFF=1. Prévia sem enviar: GET /cron/solar-agente?dry=1
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { novoAnthropic } from '../../utils/anthropicClient';
import { sendHuman, sendWhatsApp } from '../agents/zapiClient';
import { podeFalarComLead, registrarBloqueio } from '../agents/whatsapp/pausaHumana';
import { estaBloqueado } from '../agents/whatsapp/silenciar';
import { pareceRoboDeles } from '../agents/whatsapp/roboDoOutroLado';
import { INSTANCE_ID_IO } from './solarRespostas';
import { quandoPorExtenso, telefoneBonito } from './eletropostoAgenda';
import { caminhoDaFicha, type Caminho } from '../agenda/solarRota';

export const desligado = () => (process.env.SOLAR_AGENTE_OFF || '').trim() === '1';

/** Modelo da conversa. O padrão é o Opus 5; se ele não responder (rota, crédito,
 *  parâmetro recusado), a mesma pergunta vai para o Sonnet 4.6, o modelo que a
 *  recepção da linha já usa todo dia. */
const MODELO = (process.env.SOLAR_AGENTE_MODELO || 'claude-opus-5').trim();
const MODELO_RESERVA = 'claude-sonnet-4-6';

export const SOLAR_AGENTE_PREFIX = 'solar_agente:';
const SOLAR_AGENTE_VEZ = 'solar_agente_vez:';
/** Tipo da sessão em `whatsapp_sessions`: é a posse da conversa que a recepção respeita. */
export const TIPO_SESSAO_QUIZ = 'solar_quiz';

const JANELA_REATIVA_MS = 15 * 60_000;
const ESPERA_MS = 30_000;
const LEADS_DIAS = 14;
const MAX_RESPOSTAS = 8;
const POR_TICK = 3;

export type Acao = 'nada' | 'confirmou' | 'remarcar' | 'humano' | 'sem_interesse';
const ACOES: readonly Acao[] = ['nada', 'confirmou', 'remarcar', 'humano', 'sem_interesse'];

/** DDD + 8 últimos. A mesma chave do CRM e do quiz (lead_id = quiz_<chave>). */
export function telKey(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/@.*$/, '').replace(/\D/g, '');
  while (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

// ── O contexto ──────────────────────────────────────────────────────────────
export interface ContextoLead {
  nome: string | null;
  cidade: string | null;
  caminho: Caminho | 'nao_marcou';
  /** Quem atende (dono da ficha, ou o dono pela conta no curioso). */
  quem: string | null;
  quandoIso: string | null;
  confirmou: boolean;
  status: string | null;
  respostas: string[];   // "Rótulo: valor", do quiz
}

const ROTULO_CAMINHO: Record<ContextoLead['caminho'], string> = {
  vistoria: 'visita técnica presencial no endereço',
  video: 'atendimento online por chamada de vídeo no WhatsApp',
  ligacao: 'ligação',
  curioso: 'sem horário: ficou na lista de contatos para a equipe chamar depois',
  nao_marcou: 'respondeu o simulador mas não escolheu horário',
};

/** O que vai para a IA no lugar do "sistema": quem é ela, o que pode e o que não pode. */
export function montarSistema(ctx: ContextoLead): string {
  const quando = ctx.quandoIso ? quandoPorExtenso(ctx.quandoIso) : null;
  const fatos = [
    `Nome do cliente: ${ctx.nome || 'não informado'}`,
    `Cidade: ${ctx.cidade || 'não informada'}`,
    `Situação: ${ROTULO_CAMINHO[ctx.caminho]}`,
    ctx.quem ? `Quem atende o cliente: ${ctx.quem}` : '',
    quando ? `Horário marcado: ${quando}` : '',
    ctx.quandoIso ? `Já confirmou presença: ${ctx.confirmou ? 'sim' : 'ainda não'}` : '',
    ctx.status ? `Status do card na agenda: ${ctx.status}` : '',
    ...(ctx.respostas.length ? ['Respostas do cliente no simulador:', ...ctx.respostas.map(r => `  ${r}`)] : []),
  ].filter(Boolean).join('\n');

  return [
    'Você é a Duda, do pré-atendimento de energia solar da Irmãos na Obra, empresa de Uberlândia (MG) que projeta e instala energia solar na região.',
    'Você conversa pelo WhatsApp com quem respondeu o simulador do nosso site. A primeira mensagem já foi enviada por você e está no histórico: não se apresente de novo.',
    '',
    'O QUE VOCÊ SABE DESTE CLIENTE:',
    fatos,
    '',
    'COMO RESPONDER:',
    '- Responda só ao que a pessoa escreveu, em uma ou duas mensagens curtas. Separe as mensagens com ||.',
    '- Frases curtas, uma ideia por frase, português do Brasil natural, começando com letra maiúscula. Sem emoji. Nunca use travessão.',
    '- Não repita o que já foi dito no histórico.',
    '- Você pode explicar como funciona a energia solar, o crédito de energia na conta, o que acontece na visita (um técnico olha o telhado, o padrão de entrada e a sombra, e leva uns 40 minutos) e como é o atendimento online (chamada de vídeo pelo WhatsApp, com o estudo na tela).',
    `- NUNCA informe preço, valor de parcela, economia em reais, prazo de instalação, marca ou modelo de equipamento, nem condição de pagamento. Diga que ${ctx.quem || 'quem atende'} traz o estudo com os números certos do caso dela.`,
    '- Não marque nem troque horário. Não prometa nada que não esteja nos fatos acima.',
    '',
    'AÇÕES (escolha uma):',
    '- "confirmou": a pessoa confirmou presença no horário marcado (sim, confirmo, pode ser, estarei lá). Responda confirmando em uma frase.',
    `- "remarcar": quer trocar o dia ou o horário, ou cancelar. Diga que vai pedir para ${ctx.quem || 'quem atende'} chamar para acertar.`,
    '- "sem_interesse": disse que não quer mais. Agradeça em uma frase, sem insistir.',
    `- "humano": pediu para falar com uma pessoa, reclamou, quer fechar agora, quer horário (se não tem), ou a conversa saiu do que você sabe. Diga que ${ctx.quem || 'a nossa equipe'} vai falar com ela por aqui.`,
    '- "nada": qualquer outra coisa. Se a mensagem for só ok, obrigado ou um emoji, deixe "resposta" vazia.',
    '',
    'Devolva só o JSON: {"resposta": "texto || texto opcional", "acao": "nada|confirmou|remarcar|humano|sem_interesse", "resumo": "uma frase para o consultor sobre o que o cliente quer"}',
  ].join('\n');
}

export interface MsgConversa { from_me: boolean; texto: string | null; tipo: string | null; momment: string }

/** A conversa no 5040, mais antiga primeiro, e as mensagens novas que pedem resposta. */
export function montarPedido(historico: MsgConversa[], novas: MsgConversa[]): string {
  const linha = (m: MsgConversa) => {
    const quem = m.from_me ? 'Nós' : 'Cliente';
    const conteudo = (m.texto || '').trim() || (m.tipo && m.tipo !== 'texto' ? `[${m.tipo}]` : '');
    return conteudo ? `${quem}: ${conteudo.slice(0, 1200)}` : '';
  };
  const conversa = historico.map(linha).filter(Boolean).join('\n');
  const ultimas = novas.map(linha).filter(Boolean).join('\n');
  return `Conversa até agora no WhatsApp (mais antiga primeiro):\n${conversa || '(vazia)'}\n\nMensagens novas do cliente, que você vai responder:\n${ultimas}`;
}

export interface Saida { resposta: string; acao: Acao; resumo: string }

/** Lê a saída da IA. O formato vem forçado, mas a reserva (sem formato forçado)
 *  pode embrulhar o JSON em texto: pega do primeiro { ao último }. */
export function lerSaida(texto: string): Saida | null {
  const ini = texto.indexOf('{'), fim = texto.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    const j = JSON.parse(texto.slice(ini, fim + 1)) as Record<string, unknown>;
    const acao = ACOES.includes(j.acao as Acao) ? (j.acao as Acao) : 'nada';
    return { resposta: String(j.resposta ?? '').trim(), acao, resumo: String(j.resumo ?? '').trim().slice(0, 300) };
  } catch {
    return null;
  }
}

/** Até duas bolhas, sem travessão (regra de 30/08: travessão é marca de robô). */
export function bolhasDe(resposta: string): string[] {
  return resposta.split('||')
    .map(b => b.replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 2)
    .map(b => b.slice(0, 700));
}

const SCHEMA_SAIDA = {
  type: 'object',
  properties: {
    resposta: { type: 'string' },
    acao: { type: 'string', enum: [...ACOES] },
    resumo: { type: 'string' },
  },
  required: ['resposta', 'acao', 'resumo'],
  additionalProperties: false,
} as const;

/** Uma pergunta à IA. `stop_reason` "refusal" e qualquer falha viram null: na
 *  dúvida a agente cala e o consultor, que recebe o recado, assume. */
async function perguntar(sistema: string, pedido: string): Promise<Saida | null> {
  const cliente = novoAnthropic();
  const textoDe = (r: Anthropic.Message) => r.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  try {
    const r = await cliente.messages.create({
      model: MODELO,
      max_tokens: 4000,
      system: sistema,
      // Esforço baixo: é conversa de WhatsApp, a pessoa está esperando.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_SAIDA } },
      messages: [{ role: 'user', content: pedido }],
    });
    if (r.stop_reason === 'refusal') return null;
    return lerSaida(textoDe(r));
  } catch (err) {
    logger.warn('solar-agente', `${MODELO} falhou, tentando a reserva`, { erro: String((err as Error)?.message || err).slice(0, 300) });
  }
  try {
    const r = await cliente.messages.create({
      model: MODELO_RESERVA,
      max_tokens: 1500,
      system: sistema,
      messages: [{ role: 'user', content: pedido }],
    });
    if (r.stop_reason === 'refusal') return null;
    return lerSaida(textoDe(r));
  } catch (err) {
    logger.error('solar-agente', 'a IA não respondeu', err);
    return null;
  }
}

// ── Posse da conversa (a recepção pergunta isto antes de falar) ──────────────
/** Este telefone é de um lead do quiz solar dos últimos 14 dias? Se for, a
 *  conversa é da agente do quiz, e a recepção não fala por cima. Falha de leitura
 *  responde false (a recepção segue como era antes de existir a agente), e a
 *  agente desligada também: senão a conversa ficaria sem ninguém. */
export async function quizSolarAtende(phone: string): Promise<boolean> {
  if (desligado()) return false;
  const k = telKey(phone);
  if (!k) return false;
  try {
    const { data, error } = await supabaseGerador.from('leads_meta')
      .select('lead_id').eq('lead_id', `quiz_${k}`)
      .gte('created_time', new Date(Date.now() - LEADS_DIAS * 86_400_000).toISOString())
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  } catch (err) {
    logger.error('solar-agente', 'conferir posse do quiz falhou', err);
    return false;
  }
}

// ── A rodada ────────────────────────────────────────────────────────────────
interface Marcador { ate?: string; respostas?: number; humano?: boolean }

export type ResultadoAgente = {
  respondidas: number;
  passadas: number;   // recados de "passei para você"
  erros: number;
  motivo?: string;
  previa?: Array<{ lead: string; novas: string[]; saida: Saida | null }>;
};

const zero = (motivo?: string): ResultadoAgente => ({ respondidas: 0, passadas: 0, erros: 0, ...(motivo ? { motivo } : {}) });

async function telefonesDosConsultores(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const { data } = await supabaseGerador.from('consultores').select('nome, whatsapp').limit(100);
  for (const c of data ?? []) if (c?.nome && c?.whatsapp) mapa.set(String(c.nome), String(c.whatsapp));
  return mapa;
}

function respostasDoLead(campos: unknown): string[] {
  const lista = Array.isArray(campos) ? campos as Array<{ name?: string; values?: string[] }> : [];
  const fora = new Set(['Origem', 'Caminho', 'Pontos', 'Qualifica', 'Sem horário', 'Raio']);
  return lista.filter(c => c?.name && !fora.has(c.name) && c.values?.[0]).map(c => `${c.name}: ${c.values![0]}`);
}

export async function runSolarAgenteQuizTick(opts: { dry?: boolean } = {}): Promise<ResultadoAgente> {
  if (!opts.dry && desligado()) return zero('desligado');
  const agora = Date.now();

  // 1) Os leads do quiz dos últimos 14 dias.
  const { data: leads, error: eLeads } = await supabaseGerador.from('leads_meta')
    .select('lead_id, nome, whatsapp, cidade, field_data, agendado_id, consultor')
    .eq('form_id', 'quiz_solar')
    .gte('created_time', new Date(agora - LEADS_DIAS * 86_400_000).toISOString())
    .limit(500);
  if (eLeads) { logger.error('solar-agente', 'ler leads do quiz falhou', eLeads); return { ...zero('erro_leads'), erros: 1 }; }
  const porChave = new Map<string, Record<string, any>>();
  for (const l of leads ?? []) { const k = telKey(l.whatsapp); if (k) porChave.set(k, l); }
  if (!porChave.size) return zero('sem_leads');

  // 2) O que chegou na linha nos últimos 15 min (menos os 30 s de espera).
  const { data: entrada, error: eEntrada } = await supabase.from('wa_mensagens')
    .select('telefone, texto, tipo, momment, from_me')
    .eq('from_me', false).eq('is_group', false).eq('instancia', INSTANCE_ID_IO)
    .gte('momment', new Date(agora - JANELA_REATIVA_MS).toISOString())
    .lte('momment', new Date(agora - ESPERA_MS).toISOString())
    .order('momment', { ascending: true })
    .limit(500);
  if (eEntrada) { logger.error('solar-agente', 'ler a linha falhou', eEntrada); return { ...zero('erro_linha'), erros: 1 }; }
  const novasPorChave = new Map<string, MsgConversa[]>();
  for (const m of entrada ?? []) {
    const k = telKey(m.telefone);
    if (!k || !porChave.has(k)) continue;
    if (!novasPorChave.has(k)) novasPorChave.set(k, []);
    novasPorChave.get(k)!.push(m as MsgConversa);
  }
  if (!novasPorChave.size) return zero('ninguem_escreveu');

  // 3) Até onde cada conversa já foi lida.
  const ids = [...novasPorChave.keys()].map(k => String(porChave.get(k)!.lead_id));
  const { data: estados, error: eEstados } = await supabase.from('system_state')
    .select('key, value').in('key', ids.map(id => `${SOLAR_AGENTE_PREFIX}${id}`));
  if (eEstados) { logger.error('solar-agente', 'ler marcadores falhou', eEstados); return { ...zero('erro_marcadores'), erros: 1 }; }
  const marcador = new Map<string, Marcador>();
  for (const e of estados ?? []) marcador.set(String(e.key).slice(SOLAR_AGENTE_PREFIX.length), (e.value ?? {}) as Marcador);

  const consultores = await telefonesDosConsultores();
  const res: ResultadoAgente = zero();
  const previa: NonNullable<ResultadoAgente['previa']> = [];
  let feitas = 0;

  for (const [k, msgsTodas] of novasPorChave) {
    if (feitas >= POR_TICK) break;
    const lead = porChave.get(k)!;
    const id = String(lead.lead_id);
    const mk = marcador.get(id) ?? {};
    const novas = msgsTodas.filter(m => !mk.ate || m.momment > mk.ate);
    if (!novas.length) continue;
    const ultima = novas[novas.length - 1].momment;
    const tel = String(lead.whatsapp || '').replace(/\D/g, '');
    const gravarMarcador = async (m: Marcador) => {
      if (opts.dry) return;
      const em = new Date().toISOString();
      await supabase.from('system_state').upsert({ key: `${SOLAR_AGENTE_PREFIX}${id}`, value: m, updated_at: em }, { onConflict: 'key' });
    };

    // Já passou para gente, ou já respondeu demais: só anda o marcador.
    if (mk.humano || (mk.respostas ?? 0) >= MAX_RESPOSTAS) { await gravarMarcador({ ...mk, ate: ultima }); continue; }
    if (await estaBloqueado(tel)) { await gravarMarcador({ ...mk, ate: ultima }); continue; }
    if (!(await podeFalarComLead(tel)).pode) {
      // Humano entrou na conversa: a agente cala (a pausa humana volta sozinha em 24h de silêncio).
      if (!opts.dry) await registrarBloqueio(tel, 'solar-agente');
      await gravarMarcador({ ...mk, ate: ultima });
      continue;
    }
    if (novas.some(m => pareceRoboDeles(String(m.texto || '')).nivel === 'certeza')) { await gravarMarcador({ ...mk, ate: ultima, humano: true }); continue; }

    // Reivindica a vez antes de gastar IA: chave única por lead e última mensagem.
    if (!opts.dry) {
      const { error: eVez } = await supabase.from('system_state')
        .insert({ key: `${SOLAR_AGENTE_VEZ}${id}:${ultima}`, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() });
      if (eVez) continue;
    }
    feitas++;

    // 4) O contexto: a ficha (se marcou), as respostas e a conversa.
    let ficha: Record<string, any> | null = null;
    if (lead.agendado_id) {
      const { data: f } = await supabaseGerador.from('agendamentos')
        .select('id, quando, vendedor_nome, status, observacao, presenca_confirmada_at')
        .eq('id', lead.agendado_id).maybeSingle();
      ficha = f ?? null;
    }
    const campos = Array.isArray(lead.field_data) ? lead.field_data : [];
    const caminhoLead = String(campos.find((c: any) => c?.name === 'Caminho')?.values?.[0] || '');
    const caminho: ContextoLead['caminho'] = ficha
      ? (caminhoDaFicha(ficha.observacao) ?? 'ligacao')
      : (caminhoLead === 'curioso' ? 'curioso' : 'nao_marcou');
    const ctx: ContextoLead = {
      nome: lead.nome ?? null,
      cidade: lead.cidade ?? null,
      caminho,
      quem: (ficha?.vendedor_nome as string) || (lead.consultor as string) || null,
      quandoIso: ficha?.quando ?? null,
      confirmou: !!ficha?.presenca_confirmada_at,
      status: ficha?.status ?? null,
      respostas: respostasDoLead(campos),
    };
    const { data: hist } = await supabase.from('wa_mensagens')
      .select('from_me, texto, tipo, momment')
      .eq('instancia', INSTANCE_ID_IO).eq('is_group', false)
      .like('telefone', `%${k.slice(-8)}%`)
      .lt('momment', novas[0].momment)
      .order('momment', { ascending: false })
      .limit(20);
    const historico = ((hist ?? []) as MsgConversa[]).reverse();

    const saida = await perguntar(montarSistema(ctx), montarPedido(historico, novas));
    if (opts.dry) { previa.push({ lead: id, novas: novas.map(m => String(m.texto || m.tipo || '')), saida }); continue; }
    if (!saida) { res.erros++; await gravarMarcador({ ...mk, ate: ultima }); continue; }

    // 5) Fala (se tem o que falar), depois age.
    const bolhas = bolhasDe(saida.resposta);
    let respondeu = false;
    if (bolhas.length) {
      try {
        await sendHuman(tel, bolhas, 'io', { maxBolhas: 2 });
        respondeu = true;
        res.respondidas++;
      } catch (e) {
        res.erros++;
        logger.error('solar-agente', 'falha ao responder', { lead: id, erro: String(e) });
      }
    }
    if (ficha) {
      const patch: Record<string, string> = { lead_resposta_at: new Date().toISOString() };
      if (saida.acao === 'confirmou' && !ficha.presenca_confirmada_at) patch.presenca_confirmada_at = new Date().toISOString();
      await supabaseGerador.from('agendamentos').update(patch).eq('id', ficha.id);
    }
    const passa = saida.acao === 'remarcar' || saida.acao === 'humano' || saida.acao === 'sem_interesse';
    if (passa) {
      const telQuem = ctx.quem ? consultores.get(ctx.quem) : null;
      const titulo = { remarcar: 'QUER TROCAR O HORÁRIO', humano: 'QUER FALAR COM VOCÊ', sem_interesse: 'DISSE QUE NÃO QUER MAIS' }[saida.acao as 'remarcar' | 'humano' | 'sem_interesse'];
      const recado = [
        `🤖☀️ *A DUDA PASSOU PARA VOCÊ: ${titulo}*`,
        `*Cliente:* ${ctx.nome || 'sem nome'}${ctx.cidade ? ` (${ctx.cidade})` : ''}`,
        `*WhatsApp:* wa.me/${tel}`,
        ctx.quandoIso ? `*Horário:* ${quandoPorExtenso(ctx.quandoIso)}` : `*Situação:* ${ROTULO_CAMINHO[ctx.caminho]}`,
        saida.resumo ? `*O que ele quer:* ${saida.resumo}` : '',
        `*Escreveu:* ${novas.map(m => (m.texto || `[${m.tipo}]`)).join(' / ').slice(0, 600)}`,
        '',
        '_A Duda parou de responder nesta conversa. A partir daqui é com você._',
      ].filter(Boolean).join('\n');
      if (telQuem) {
        try { await sendWhatsApp(telQuem, recado, 'io'); res.passadas++; }
        catch (e) { logger.error('solar-agente', 'recado ao consultor falhou', { lead: id, erro: String(e) }); }
      } else {
        logger.warn('solar-agente', 'lead sem consultor com WhatsApp para receber o recado', { lead: id, quem: ctx.quem, contato: telefoneBonito(tel) });
      }
    }
    await gravarMarcador({ ate: ultima, respostas: (mk.respostas ?? 0) + (respondeu ? 1 : 0), humano: passa || mk.humano });

    // Posse da conversa e histórico para quem olhar depois.
    const mensagens = [
      ...novas.map(m => ({ role: 'user', content: String(m.texto || `[${m.tipo}]`) })),
      ...(respondeu ? [{ role: 'assistant', content: bolhas.join('\n') }] : []),
    ];
    const { data: sess } = await supabase.from('whatsapp_sessions').select('messages').eq('phone', tel).eq('tipo', TIPO_SESSAO_QUIZ).maybeSingle();
    await supabase.from('whatsapp_sessions').upsert({
      phone: tel, tipo: TIPO_SESSAO_QUIZ, nome: ctx.nome,
      messages: [...((sess?.messages as unknown[]) ?? []), ...mensagens].slice(-40),
      lead_data: { lead_id: id, caminho, acao: saida.acao, humano: passa || !!mk.humano },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'phone,tipo' });
  }

  if (opts.dry) return { ...res, motivo: 'dry', previa };
  if (res.respondidas || res.passadas) logger.info('solar-agente', `${res.respondidas} resposta(s), ${res.passadas} passada(s) para o consultor`);
  return res;
}
