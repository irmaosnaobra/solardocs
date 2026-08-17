// ─────────────────────────────────────────────────────────────────────────────
// REPESCAGEM DO ELETROPOSTO — quem chegou enquanto a linha estava bloqueada.
//
// Entre 01/ago 17h10 e 03/ago 12h26 (BRT) a linha IO ficou bloqueada e todo envio
// falhou EM SILÊNCIO: as fichas da LP não viraram aviso pro consultor e os leads
// NOTA 1 não receberam o convite do grupo. Do lado deles, a empresa simplesmente
// não respondeu — e ninguém aqui ficou sabendo, porque o Z-API recusa com 200 no
// cron e erro só no log.
//
// Aqui a gente fala com essas pessoas UMA vez, no ritmo que o dono pediu depois do
// bloqueio: 1 PESSOA a cada 20 minutos, só entre 07h e 20h (BRT). É devagar de
// propósito — a linha acabou de voltar e o que a derrubou foi volume (57 mensagens
// em 5h). Nesse ritmo são ~3 por hora, dentro do teto de 12/h da linha inteira.
//
// Fila em `system_state` (mesmo padrão da Bia): `ep_repescagem_pending:<telefone>`
// com `ready_at`, drenada UMA por vez pelo tick de /process-messages. Claim atômico
// (DELETE…RETURNING) porque o tick é batido por dois crons.
//
// Envio que falha NÃO some: o marcador volta pra fila com +20min (até 3 tentativas).
// Essa gente já foi perdida uma vez por falha silenciosa — não pode acontecer duas.
//
// Kill-switch: EP_REPESCAGEM_OFF=1 congela a fila. O IO_BLAST_OFF não vale aqui de
// propósito: ele congela o motor de DISPARO (lista fria); esta fila é resposta a
// quem pediu contato e ficou sem, e foi pedida com ele já ligado.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendFrio } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';

const PENDING_PREFIX = 'ep_repescagem_pending:';
/** Marcador de envio efetivado. Contado no teto da linha (lineThrottle). */
export const EP_REPESCAGEM_SENT_PREFIX = 'ep_repescagem_sent:';
const ULTIMO_KEY = 'ep_repescagem_ultimo';

/** 1 pessoa a cada 20 min — pedido do dono depois do bloqueio. */
const INTERVALO_MS = 20 * 60 * 1000;
const JANELA_INICIO_H = 7;
const JANELA_FIM_H = 20;
const MAX_TENTATIVAS = 3;

/** Janela do apagão: o que entrou aqui não recebeu nada. */
const APAGAO_INICIO = '2026-08-01T20:10:00.000Z';
const APAGAO_FIM = '2026-08-03T15:30:00.000Z';

const GRUPO_LINK = process.env.IO_GRUPO_ELETROPOSTO_LINK?.trim()
  || 'https://chat.whatsapp.com/BUhE93ZvMp2DZlZDsL2g7M';

type TipoToque = 'convite' | 'consultor';

interface MarcadorRepescagem {
  tipo: TipoToque;
  nome: string;
  dono?: string | null;
  ficha_em?: string | null;   // quando a pessoa preencheu (entra na mensagem)
  ready_at: string;
  tentativas?: number;
}

const desligado = () => (process.env.EP_REPESCAGEM_OFF || '').trim() === '1';

/** Hora de Brasília — o servidor roda em UTC. */
function horaBrasilia(d = new Date()): number {
  return Number(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit' }));
}

function foraDaJanela(d = new Date()): boolean {
  const h = horaBrasilia(d);
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
}

/** Telefone só dígitos com DDI — é a chave da fila (1 pessoa = 1 marcador). */
function normalizar(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  return d.startsWith('55') ? d : `55${d}`;
}

function primeiroNome(nome: string): string {
  return String(nome || '').trim().split(/\s+/)[0] || 'tudo bem';
}

/** Dia (BRT) de uma data ISO — pra saber se a ficha é de hoje. */
function diaBrt(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function ehHoje(iso?: string | null): boolean {
  return !!iso && diaBrt(new Date(iso)) === diaBrt(new Date());
}

/** "hoje" ou "dia 02/08" — dizer "dia 03/08" pra quem preencheu hoje de manhã soa errado. */
function dataCurta(iso?: string | null): string {
  if (!iso) return 'esses dias';
  if (ehHoje(iso)) return 'hoje';
  const d = new Date(iso);
  return `dia ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })}`;
}

/** A desculpa tem que caber no relógio de quem lê: quem preencheu hoje não ficou dois dias esperando. */
function desculpaDemora(iso?: string | null): string {
  return ehHoje(iso)
    ? 'Nosso WhatsApp ficou fora do ar hoje de manhã e o seu contato ficou parado aqui. Desculpa a demora.'
    : 'Nosso WhatsApp ficou fora do ar por dois dias e o seu contato ficou parado aqui. Desculpa a demora.';
}

// ─── as duas mensagens ───────────────────────────────────────────────────────

/** NOTA 1: ainda não tem ponto definido — o próximo passo dele é o grupo, não o orçamento.
 *  Mesma copy que a LP dispara no fluxo normal (ioEletroposto usa esta função). */
export function bolhasConvite(nome: string): string[] {
  const p = primeiroNome(nome);
  return [
    `Oi ${p}! Aqui é da Irmãos na Obra — você acabou de fazer a simulação do eletroposto no nosso site.`,
    'Pelo que você respondeu, o próximo passo ainda não é o orçamento: é definir o local. É ele que decide a entrada de energia, o fluxo e, no fim, o seu retorno.',
    `Por isso já te levo pro grupo que a gente abriu pra quem está nessa fase. Entrada gratuita:\n${GRUPO_LINK}`,
    'Lá a gente publica o faturamento real de cada ponto que instala, como avaliar um local antes de fechar e o caminho do financiamento com 90 dias de carência. Quem tem local e quem tem capital também se encontram por lá.',
    'Quando o seu ponto estiver encaminhado, me chama aqui que eu marco a conversa e levo o estudo completo do seu caso.',
  ];
}

/**
 * Versão da LP EM TEMPO REAL (17/08/2026): UMA bolha, não cinco.
 *
 * Quem sai do formulário agora cai em /io/eletroposto/parceria, e o link do
 * grupo está NA TELA dele. As cinco bolhas do convite explicavam o que a página
 * já explica e entregavam de novo um link que a pessoa acabou de ver — cinco
 * mensagens da linha IO (que foi bloqueada uma vez por volume: 57 msgs em 5h)
 * pra repetir o passo anterior. O que sobra de útil é o registro: ela fica com
 * o link salvo na conversa, caso feche a aba antes de tocar no botão.
 *
 * A `bolhasConvite` de cinco continua intacta pra REPESCAGEM e para a fila de
 * frios: lá a pessoa não viu página nenhuma — a mensagem é o único contato.
 */
export function bolhaConviteDaPagina(nome: string): string[] {
  const p = primeiroNome(nome);
  return [
    `Oi ${p}! Aqui é da Irmãos na Obra. Guardo o link do grupo aqui pra você não perder:\n${GRUPO_LINK}\n\nÉ lá que quem tem o ponto e quem tem o capital se encontram. Quando seu local estiver encaminhado, me chama que eu levo o estudo do seu caso.`,
  ];
}

/** Escolhe a versão certa do convite pelo relógio: recém-preenchido ganha o convite
 *  normal; ficha de horas atrás ganha a versão que reconhece a demora. É o que
 *  garante que TODO nota 1 receba o convite sem a copy soar mentirosa. */
export function bolhasConviteParaFicha(nome: string, criadoEm?: string | null): string[] {
  const idadeMs = criadoEm ? Date.now() - new Date(criadoEm).getTime() : 0;
  return idadeMs > 2 * 60 * 60 * 1000 ? bolhasConviteAtrasado(nome, criadoEm) : bolhasConvite(nome);
}

/** Versão do convite pra quem preencheu HÁ DIAS — o "acabou de fazer" viraria mentira. */
function bolhasConviteAtrasado(nome: string, quando?: string | null): string[] {
  const p = primeiroNome(nome);
  return [
    `Oi ${p}! Aqui é da Irmãos na Obra — você fez a simulação do eletroposto no nosso site ${dataCurta(quando)}.`,
    desculpaDemora(quando),
    'Pelo que você respondeu, o próximo passo ainda não é o orçamento: é definir o local. É ele que decide a entrada de energia, o fluxo e, no fim, o seu retorno.',
    `Por isso te levo pro grupo que a gente abriu pra quem está nessa fase. Entrada gratuita:\n${GRUPO_LINK}`,
    'Lá sai o faturamento real de cada ponto que a gente instala, como avaliar um local antes de fechar e o caminho do financiamento com 90 dias de carência. Quando seu ponto estiver encaminhado, me chama aqui que eu levo o estudo do seu caso.',
  ];
}

/** NOTA 2/3: tem ponto e perfil — o toque é do consultor dono da ficha. */
function bolhasConsultor(nome: string, dono?: string | null, quando?: string | null): string[] {
  const p = primeiroNome(nome);
  const quem = dono ? `O ${dono}` : 'A gente';
  return [
    `Oi ${p}! Aqui é da Irmãos na Obra — você fez a simulação do eletroposto no nosso site ${dataCurta(quando)}.`,
    desculpaDemora(quando),
    `${quem} é quem cuida do seu caso: leva o estudo do seu ponto, o faturamento real dos carregadores que a gente já tem instalados e o financiamento com 90 dias de carência.`,
    'Ainda faz sentido pra você? Me diz um horário bom que eu já passo pra ele.',
  ];
}

// ─── seed ────────────────────────────────────────────────────────────────────

/** Próximos horários de envio, 20 em 20 min, respeitando 07h–20h (BRT). */
export function slots(qtd: number, agora = new Date()): string[] {
  const out: string[] = [];
  let t = agora.getTime();
  for (let i = 0; i < qtd; i++) {
    // Empurra pra dentro da janela: fora dela, o próximo slot é 07h do dia seguinte
    // (ou de hoje, se ainda for madrugada).
    let d = new Date(t);
    while (foraDaJanela(d)) {
      d = new Date(d.getTime() + 30 * 60 * 1000);   // caminha de 30 em 30 até abrir
    }
    out.push(d.toISOString());
    t = d.getTime() + INTERVALO_MS;
  }
  return out;
}

export async function semearRepescagem(opts: { dry?: boolean } = {}): Promise<{
  semeados: number; ja_na_fila: number; ja_falado: number; pessoas: Array<{ telefone: string; nome: string; tipo: TipoToque; ready_at: string }>;
}> {
  // 1. Fichas da LP (NOTA 2/3) — o consultor nunca foi avisado.
  const { data: fichas, error: eF } = await supabaseGerador
    .from('agendamentos')
    .select('cliente_nome, cliente_telefone, vendedor_nome, created_at')
    .eq('created_by', 'lp_eletroposto')
    .gte('created_at', APAGAO_INICIO)
    .lte('created_at', APAGAO_FIM);
  if (eF) throw new Error(`repescagem: ler agendamentos falhou — ${eF.message}`);

  // 2. NOTA 1 — o convite do grupo não saiu (convite_enviado_at continua nulo).
  const { data: nota1, error: eN } = await supabaseGerador
    .from('eletroposto_nota1')
    .select('nome, telefone, created_at')
    .is('convite_enviado_at', null)
    .gte('created_at', APAGAO_INICIO)
    .lte('created_at', APAGAO_FIM);
  if (eN) throw new Error(`repescagem: ler eletroposto_nota1 falhou — ${eN.message}`);

  // A ficha manda: quem agendou E aparece como nota 1 (preencheu duas vezes) recebe
  // o toque do consultor, não o convite do grupo.
  const porTelefone = new Map<string, MarcadorRepescagem>();
  for (const l of (nota1 ?? []) as any[]) {
    const tel = normalizar(l.telefone);
    if (!tel) continue;
    porTelefone.set(tel, { tipo: 'convite', nome: l.nome ?? '', ficha_em: l.created_at, ready_at: '' });
  }
  for (const f of (fichas ?? []) as any[]) {
    const tel = normalizar(f.cliente_telefone);
    if (!tel) continue;
    porTelefone.set(tel, { tipo: 'consultor', nome: f.cliente_nome ?? '', dono: f.vendedor_nome ?? null, ficha_em: f.created_at, ready_at: '' });
  }

  // 3. Tira quem já está na fila ou já recebeu (rodar o seed duas vezes não pode
  //    mandar duas vezes — é o mesmo erro que essa fila existe pra consertar).
  const chaves = [...porTelefone.keys()];
  const { data: existentes } = await supabase
    .from('system_state').select('key')
    .or(`key.like.${PENDING_PREFIX}%,key.like.${EP_REPESCAGEM_SENT_PREFIX}%`)
    .limit(500);
  const bloqueados = new Set(
    (existentes ?? []).map(r => String(r.key).replace(PENDING_PREFIX, '').replace(EP_REPESCAGEM_SENT_PREFIX, '')),
  );

  const novos = chaves.filter(t => !bloqueados.has(t));
  const horarios = slots(novos.length);
  const linhas = novos.map((tel, i) => {
    const m = porTelefone.get(tel)!;
    return {
      key: `${PENDING_PREFIX}${tel}`,
      value: { ...m, ready_at: horarios[i], tentativas: 0 } as MarcadorRepescagem,
      updated_at: new Date().toISOString(),
    };
  });

  if (!opts.dry && linhas.length) {
    const { error } = await supabase.from('system_state').upsert(linhas, { onConflict: 'key', ignoreDuplicates: true });
    if (error) throw new Error(`repescagem: semear falhou — ${error.message}`);
  }

  return {
    semeados: linhas.length,
    ja_na_fila: chaves.length - novos.length,
    ja_falado: 0,
    pessoas: linhas.map(l => ({
      telefone: l.key.slice(PENDING_PREFIX.length),
      nome: (l.value as MarcadorRepescagem).nome,
      tipo: (l.value as MarcadorRepescagem).tipo,
      ready_at: (l.value as MarcadorRepescagem).ready_at,
    })),
  };
}

// ─── resposta de quem foi repescado ──────────────────────────────────────────
// A mensagem do consultor termina pedindo horário — ou seja, a gente PROVOCA
// resposta. Nesta linha nenhum agente atende (handleSdrLead tem early-return pra
// 'io') e essa pessoa não vira card de lead novo, então a resposta morreria no
// aplicativo até alguém abrir. Aqui a gente só reconhece o telefone e devolve os
// dados; quem avisa a equipe é o poller da linha (sdrIoPolling), que já tem o
// contato dos donos. Um aviso por pessoa.

const RESPOSTA_PREFIX = 'ep_repescagem_resposta:';

/** DDD + últimos 8 — o Z-API às vezes entrega o inbound sem o 9º dígito. */
function chaveTel(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

export interface RespostaRepescagem { telefone: string; nome: string; tipo: TipoToque }

/** Esse telefone recebeu a repescagem e ainda não teve resposta avisada? */
export async function respostaPendenteRepescagem(phone: string): Promise<RespostaRepescagem | null> {
  const alvo = chaveTel(phone);
  if (!alvo) return null;

  const { data } = await supabase
    .from('system_state').select('key, value')
    .or(`key.like.${EP_REPESCAGEM_SENT_PREFIX}%,key.like.${RESPOSTA_PREFIX}%`)
    .limit(500);
  if (!data?.length) return null;

  const jaAvisado = data.some(r => r.key.startsWith(RESPOSTA_PREFIX) && chaveTel(r.key.slice(RESPOSTA_PREFIX.length)) === alvo);
  if (jaAvisado) return null;

  const enviado = data.find(r => r.key.startsWith(EP_REPESCAGEM_SENT_PREFIX)
    && chaveTel(r.key.slice(EP_REPESCAGEM_SENT_PREFIX.length)) === alvo);
  if (!enviado) return null;

  const v = (enviado.value ?? {}) as { nome?: string; tipo?: TipoToque };
  return {
    telefone: enviado.key.slice(EP_REPESCAGEM_SENT_PREFIX.length),
    nome: v.nome ?? 'sem nome',
    tipo: v.tipo ?? 'consultor',
  };
}

/** Marca que a equipe já foi avisada dessa resposta (1 aviso por pessoa). */
export async function marcarRespostaAvisada(telefone: string, texto?: string | null): Promise<void> {
  await supabase.from('system_state').upsert(
    {
      key: `${RESPOSTA_PREFIX}${telefone}`,
      value: { avisado_at: new Date().toISOString(), texto: (texto ?? '').slice(0, 300) },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );
}

// ─── consumidor ──────────────────────────────────────────────────────────────

type TickResult = { enviados: number; motivo?: string; restam?: number };

export async function runRepescagemTick(): Promise<TickResult> {
  if (desligado()) return { enviados: 0, motivo: 'desligado' };

  const { data: rows, error } = await supabase
    .from('system_state').select('key, value')
    .like('key', `${PENDING_PREFIX}%`)
    .limit(200);
  if (error) { logger.error('ep-repescagem', 'ler fila falhou', error); return { enviados: 0, motivo: 'erro_fila' }; }
  if (!rows?.length) return { enviados: 0, motivo: 'fila_vazia' };

  const agora = Date.now();
  const prontos = rows
    .filter(r => new Date((r.value as MarcadorRepescagem)?.ready_at ?? 0).getTime() <= agora)
    .sort((a, b) => String((a.value as MarcadorRepescagem)?.ready_at ?? '')
      .localeCompare(String((b.value as MarcadorRepescagem)?.ready_at ?? '')));
  if (!prontos.length) return { enviados: 0, motivo: 'nada_pronto', restam: rows.length };

  // ── gates PRÉ-claim: nenhum deles pode consumir marcador ──
  if (foraDaJanela()) return { enviados: 0, motivo: 'fora_da_janela', restam: rows.length };

  const { data: ult } = await supabase
    .from('system_state').select('value').eq('key', ULTIMO_KEY).maybeSingle();
  const ultimoMs = new Date(((ult?.value ?? {}) as { at?: string }).at ?? 0).getTime();
  if (agora - ultimoMs < INTERVALO_MS) return { enviados: 0, motivo: 'intervalo', restam: rows.length };

  // Teto da linha física: a Bia e o followup do gerador saem pelo mesmo número.
  if (!(await dentroDoTetoHorarioLinha())) return { enviados: 0, motivo: 'teto_linha', restam: rows.length };

  const alvo = prontos[0];
  const marcador = alvo.value as MarcadorRepescagem;
  const telefone = alvo.key.slice(PENDING_PREFIX.length);

  // ── CLAIM atômico: dois ticks concorrentes não mandam pro mesmo ──
  const { data: claimed } = await supabase
    .from('system_state').delete().eq('key', alvo.key).select('key').maybeSingle();
  if (!claimed) return { enviados: 0, motivo: 'corrida_perdida', restam: rows.length };

  // Marca o relógio ANTES do envio: se a função morrer no meio, o próximo tick
  // espera 20min em vez de emendar duas mensagens.
  await supabase.from('system_state').upsert(
    { key: ULTIMO_KEY, value: { at: new Date().toISOString(), telefone }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );

  const bolhas = marcador.tipo === 'convite'
    ? bolhasConviteAtrasado(marcador.nome, marcador.ficha_em)
    : bolhasConsultor(marcador.nome, marcador.dono, marcador.ficha_em);

  try {
    await sendFrio(telefone, bolhas, 'io');
    await supabase.from('system_state').upsert(
      {
        key: `${EP_REPESCAGEM_SENT_PREFIX}${telefone}`,
        value: { sent_at: new Date().toISOString(), tipo: marcador.tipo, nome: marcador.nome },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );
    // Fecha o registro na fonte da verdade: sem isto `eletroposto_nota1` segue dizendo
    // que essa pessoa nunca foi convidada, e o próximo seed (ou qualquer relatório que
    // leia a coluna) a trata como pendente e manda de novo.
    if (marcador.tipo === 'convite') {
      const { error: eUp } = await supabaseGerador
        .from('eletroposto_nota1')
        .update({ convite_enviado_at: new Date().toISOString() })
        .eq('telefone', telefone)
        .is('convite_enviado_at', null);
      if (eUp) logger.error('ep-repescagem', `convite enviado mas nao marcado em eletroposto_nota1 (${telefone})`, eUp);
    }

    logger.info('ep-repescagem', `${marcador.tipo} enviado pra ${marcador.nome} (${telefone})`);
    return { enviados: 1, restam: rows.length - 1 };
  } catch (err) {
    // Devolve pra fila com +20min. Sem isto, a pessoa que a gente já perdeu uma
    // vez por falha silenciosa seria perdida de novo — agora sem nem log de fila.
    const tentativas = (marcador.tentativas ?? 0) + 1;
    if (tentativas <= MAX_TENTATIVAS) {
      await supabase.from('system_state').upsert(
        {
          key: alvo.key,
          value: { ...marcador, tentativas, ready_at: new Date(Date.now() + INTERVALO_MS).toISOString() },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      );
    }
    logger.error('ep-repescagem', `envio falhou pra ${telefone} (tentativa ${tentativas}/${MAX_TENTATIVAS})`, err);
    return { enviados: 0, motivo: 'erro_envio', restam: rows.length };
  }
}
