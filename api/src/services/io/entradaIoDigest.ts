// ─────────────────────────────────────────────────────────────────────────────
// ENTRADA DO 5040 — quem escreveu hoje e ninguém respondeu por robô.
//
// A linha IO recebe ~370 mensagens por semana e NENHUM agente responde nela
// (decisão do dono: atendimento humano). Na prática, quem não abre o WhatsApp
// não sabe que chegou gente — foi assim que 8 leads do eletroposto ficaram dois
// dias parados durante o apagão.
//
// Isto não é um robô que responde: é um RECIBO. Duas vezes por dia (12h e 18h
// BRT) o Thiago e o Diego recebem a lista de quem escreveu, separando quem já
// está no CRM de quem é gente nova. Duas mensagens por dia na linha, pra dois
// contatos salvos — não é o tipo de tráfego que queima número.
//
// Dedup por dia+turno+destinatário em `system_state` (chefe-antiban, 05/11/2026): o claim é um INSERT (`reservarChave`) ANTES do envio, então
// duas rodadas juntas (Vercel + GitHub Actions) nunca mandam duas vezes. Cada rodada manda para UM destinatário só (o primeiro da EQUIPE sem
// chave); o segundo sai na rodada seguinte (de hora em hora), nunca colado no primeiro. O turno vale por até TURNO_ATRASO_H horas depois da hora.
// A chave antiga `entrada_io_digest:<dia>:<turno>` (sem destinatário) conta como "os dois já atendidos".
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE } from '../../routes/ioEletroposto';
import { reservarChave } from '../agentes5040/cota';

/** Horas (BRT) em que o recibo sai. */
const TURNOS = [12, 18];
const MAX_LISTADOS = 10;
/** O turno ainda vale até N horas depois da hora cheia: dá para o 2º destinatário sair na rodada seguinte e não vira recibo da noite. */
const TURNO_ATRASO_H = 2;
/** Intervalo mínimo entre o recibo de um destinatário e o do próximo (cobre a rodada do GitHub Actions 3 min depois da Vercel). */
const INTERVALO_MIN_ENTRE_DESTINATARIOS_MS = 30 * 60 * 1000;

function agoraBrt(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

/** Início do dia de Brasília em ISO/UTC — o corte é o dia de quem lê, não o do servidor. */
function inicioDoDiaBrtIso(): string {
  const br = agoraBrt();
  return new Date(Date.now() - (br.getHours() * 3600_000 + br.getMinutes() * 60_000 + br.getSeconds() * 1000)).toISOString();
}

function chaveTurno(turno: number): string {
  const br = agoraBrt();
  const dia = `${br.getFullYear()}-${String(br.getMonth() + 1).padStart(2, '0')}-${String(br.getDate()).padStart(2, '0')}`;
  return `entrada_io_digest:${dia}:${turno}`;
}

function ultimos(tel: string): string {
  const d = tel.replace(/\D/g, '');
  return d.length > 4 ? `…${d.slice(-4)}` : d;
}

export async function runEntradaIoDigest(opts: { dry?: boolean; forcar?: boolean } = {}): Promise<{
  enviado: boolean; motivo?: string; pessoas?: number; mensagens?: number; texto?: string; destinatario?: string;
}> {
  const hora = agoraBrt().getHours();
  // O maior turno que já começou e ainda não passou de TURNO_ATRASO_H horas (12h, 13h e 14h são o turno 12; 18h, 19h e 20h, o 18).
  const turno = [...TURNOS].reverse().find(t => hora >= t && hora <= t + TURNO_ATRASO_H) ?? (opts.forcar ? hora : undefined);
  if (turno === undefined) return { enviado: false, motivo: 'fora_do_turno' };
  const chave = chaveTurno(turno);
  const destinatarios = Object.entries(EQUIPE);
  let pendente: string | null = null;

  if (!opts.dry && !opts.forcar) {
    const { data: ja, error: erroChaves } = await supabase.from('system_state')
      .select('key, value').or(`key.eq.${chave},key.like.${chave}:%`);
    if (erroChaves) { logger.error('entrada-io', 'ler chaves do turno falhou', erroChaves); return { enviado: false, motivo: 'erro_leitura' }; }
    const achadas = (ja ?? []) as Array<{ key: string; value?: { em?: string } | null }>;
    if (achadas.some(r => r.key === chave)) return { enviado: false, motivo: 'ja_enviado_neste_turno' };   // chave antiga: os dois já atendidos
    pendente = destinatarios.map(([nome]) => nome).find(nome => !achadas.some(r => r.key === `${chave}:${nome}`)) ?? null;
    if (!pendente) return { enviado: false, motivo: 'ja_enviado_neste_turno' };
    const recente = achadas.some(r => {
      const em = Date.parse(String(r.value?.em ?? ''));
      return Number.isFinite(em) && Date.now() - em < INTERVALO_MIN_ENTRE_DESTINATARIOS_MS;
    });
    if (recente) return { enviado: false, motivo: 'espacando_destinatarios' };
  }

  // Inbound de hoje (o dedup do poller é o registro mais fiel do que chegou).
  const { data: msgs, error } = await supabase
    .from('sdr_message_dedup').select('phone, processed_at')
    .gte('processed_at', inicioDoDiaBrtIso())
    .limit(2000);
  if (error) { logger.error('entrada-io', 'ler inbound falhou', error); return { enviado: false, motivo: 'erro_leitura' }; }

  const porTelefone = new Map<string, number>();
  for (const m of msgs ?? []) {
    const tel = String(m.phone || '').replace(/\D/g, '');
    if (!tel) continue;
    porTelefone.set(tel, (porTelefone.get(tel) ?? 0) + 1);
  }
  if (porTelefone.size === 0) return { enviado: false, motivo: 'ninguem_escreveu' };

  // Quem já é lead conhecido não precisa de apresentação — o que interessa é o novo.
  const telefones = [...porTelefone.keys()];
  const { data: leads } = await supabase
    .from('sdr_leads').select('phone').in('phone', telefones).limit(2000);
  const conhecidos = new Set((leads ?? []).map(l => String(l.phone).replace(/\D/g, '')));

  const novos = telefones.filter(t => !conhecidos.has(t))
    .sort((a, b) => (porTelefone.get(b) ?? 0) - (porTelefone.get(a) ?? 0));
  const totalMsgs = [...porTelefone.values()].reduce((a, b) => a + b, 0);

  const linhas = [
    `📥 *ENTRADA DO 5040* — hoje até ${String(agoraBrt().getHours()).padStart(2, '0')}h`,
    `${porTelefone.size} pessoa(s) escreveram · ${totalMsgs} mensagens`,
    '',
  ];
  if (novos.length) {
    linhas.push(`*Ninguém do CRM* (${novos.length}):`);
    for (const tel of novos.slice(0, MAX_LISTADOS)) {
      linhas.push(`• wa.me/${tel} (${porTelefone.get(tel)} msg) ${ultimos(tel)}`);
    }
    if (novos.length > MAX_LISTADOS) linhas.push(`• +${novos.length - MAX_LISTADOS} outros`);
  } else {
    linhas.push('Todos que escreveram já estão no CRM.');
  }
  linhas.push('');
  linhas.push(`Já no CRM: ${porTelefone.size - novos.length}`);
  linhas.push('Nessa linha ninguém responde por robô — quem atende é a gente.');
  const texto = linhas.join('\n');

  if (opts.dry) return { enviado: false, motivo: 'dry', pessoas: porTelefone.size, mensagens: totalMsgs, texto };

  // Claim por INSERT ANTES de enviar, uma chave por destinatário: quem não pegou o claim não envia. Falha de envio não vira recibo repetido
  // (a chave fica). `forcar` (chamada manual) manda para a equipe toda, sem claim, como antes.
  if (opts.forcar) {
    const envios = await Promise.allSettled(destinatarios.map(([, num]) => sendWhatsApp(num, texto, 'io')));
    envios.forEach((e, i) => {
      if (e.status === 'rejected') logger.error('entrada-io', `recibo falhou pra ${destinatarios[i]![0]}`, e.reason);
    });
    // Grava a chave antiga do turno (sem destinatário = os dois já atendidos): as rodadas seguintes do turno não reenviam.
    await reservarChave(chave, { forcado: true, pessoas: porTelefone.size }, new Date());
    return { enviado: true, pessoas: porTelefone.size, mensagens: totalMsgs, texto };
  }
  const nome = pendente as string;
  const claim = await reservarChave(`${chave}:${nome}`, { pessoas: porTelefone.size }, new Date());
  if (claim === 'ja_existe') return { enviado: false, motivo: 'ja_enviado_neste_turno' };
  if (claim === 'erro') { logger.error('entrada-io', `claim do recibo falhou pra ${nome}`); return { enviado: false, motivo: 'erro_claim' }; }
  try {
    await sendWhatsApp(EQUIPE[nome]!, texto, 'io');
  } catch (e) {
    logger.error('entrada-io', `recibo falhou pra ${nome}`, e);
  }

  return { enviado: true, destinatario: nome, pessoas: porTelefone.size, mensagens: totalMsgs, texto };
}
