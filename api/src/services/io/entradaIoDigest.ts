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
// Dedup por dia+turno em `system_state`, então rodar o cron de novo não repete.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE } from '../../routes/ioEletroposto';

/** Horas (BRT) em que o recibo sai. */
const TURNOS = [12, 18];
const MAX_LISTADOS = 10;

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
  enviado: boolean; motivo?: string; pessoas?: number; mensagens?: number; texto?: string;
}> {
  const hora = agoraBrt().getHours();
  const turno = TURNOS.find(t => t === hora);
  if (!turno && !opts.forcar) return { enviado: false, motivo: 'fora_do_turno' };
  const chave = chaveTurno(turno ?? hora);

  if (!opts.dry && !opts.forcar) {
    const { data: ja } = await supabase.from('system_state').select('key').eq('key', chave).maybeSingle();
    if (ja) return { enviado: false, motivo: 'ja_enviado_neste_turno' };
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

  // Marca ANTES de enviar: falha de envio não pode virar loop de recibo repetido.
  await supabase.from('system_state').upsert(
    { key: chave, value: { enviado_em: new Date().toISOString(), pessoas: porTelefone.size }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );

  const envios = await Promise.allSettled(Object.values(EQUIPE).map(num => sendWhatsApp(num, texto, 'io')));
  envios.forEach((e, i) => {
    if (e.status === 'rejected') logger.error('entrada-io', `recibo falhou pra ${Object.keys(EQUIPE)[i]}`, e.reason);
  });

  return { enviado: true, pessoas: porTelefone.size, mensagens: totalMsgs, texto };
}
