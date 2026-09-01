// ─────────────────────────────────────────────────────────────────────────────
// Central de Automação do GERADOR (Fase 1: Disparos + Sequências) — motor de envio.
//
// Modelo de segurança: a UI (Gerador, estática) só ESCREVE definições no Supabase
// do Gerador (RLS + chave publishable, que é pública). O ENVIO — a ação poderosa —
// roda SÓ aqui, no servidor, chamado pelo cron (CRON_SECRET). Então ESTE arquivo é
// o ponto de imposição. Travas NÃO-negociáveis, todas server-side:
//   1. Kill-switch: sem GERADOR_AUTOMACAO_ENABLED='true' não envia nada.
//   2. Allow-list: só manda pra número que JÁ é contato do CRM (leads_meta /
//      agendamentos). "Igual ManyChat": você fala com sua audiência, não com lista
//      fria. Corta o risco da chave pública virar canhão de spam.
//   3. Supressão obrigatória (whatsapp_suppression) — anti-denúncia.
//   4. Caps duros: máx contatos/campanha e máx campanhas iniciadas/hora.
//
// Definições vivem no Supabase do GERADOR (supabaseGerador). Supressão, throttle,
// sdr_leads e o lock de linha vivem no MAIN (supabase). Reusa os helpers de envio
// compartilhados (ioSend) e o teto anti-ban da linha (lineThrottle).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import {
  MediaType, sleep, humanizar, enviarZapiIO, carregarBloqueioProativo,
  adquirirLockBlast, liberarLockBlast,
} from './ioSend';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';

const MAX_ENVIOS_POR_TICK = 10;
const TICK_MAX_DURATION_MS = 240000;      // 4 min (buffer pro Vercel 300s)
const LOCK_DURATION_MS = 5 * 60 * 1000;
const MAX_SEQ_POR_TICK = 2;               // sequências são drip lento, poucas por tick

const MAX_CONTATOS_CAMPANHA = Number(process.env.GERADOR_MAX_CONTATOS_CAMPANHA || 2000);
const MAX_CAMPANHAS_HORA    = Number(process.env.GERADOR_MAX_CAMPANHAS_HORA || 3);

function ligado(): boolean {
  return (process.env.GERADOR_AUTOMACAO_ENABLED || '').trim() === 'true';
}

interface MensagemDef { slot: number; base: string; media_url?: string | null; media_type?: MediaType | null }
interface BroadcastRow {
  id: string; mensagens: MensagemDef[]; contatos: string[] | null; contexto_ai: string | null;
  usou_ia: boolean; cadencia_min: number; cadencia_max: number; sucesso: number; falha: number; ultimo_envio_em: string | null;
}
interface PassoDef { ordem: number; intervalo_horas: number; texto: string; media_url?: string | null; media_type?: MediaType | null }
interface InscricaoRow {
  id: string; sequencia_id: string; phone: string; nome: string | null; passo_atual: number;
  proximo_envio_em: string | null; status: string;
  sequencias?: { id: string; passos: PassoDef[]; ativo: boolean } | null;
}

/**
 * Carrega os sufixos de 10 dígitos de TODOS os contatos do CRM (leads_meta +
 * agendamentos). Pagina em blocos de 1000 (limite do PostgREST) pra não perder
 * contato. É a allow-list: quem não está aqui, não recebe.
 */
async function carregarSufixosCRM(): Promise<Set<string>> {
  const suf = new Set<string>();
  const add = (v: unknown) => {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length >= 10) suf.add(d.slice(-10));
  };
  const paginar = async (table: string, col: string) => {
    for (let page = 0; page < 50; page++) {
      const de = page * 1000;
      const { data, error } = await supabaseGerador
        .from(table).select(col).range(de, de + 999);
      if (error) { logger.error('gerador-automacao', `erro allow-list ${table}`, error); break; }
      const rows = (data ?? []) as unknown as Record<string, unknown>[];
      for (const r of rows) add(r[col]);
      if (rows.length < 1000) break;
    }
  };
  await paginar('leads_meta', 'whatsapp');
  await paginar('agendamentos', 'cliente_telefone');
  return suf;
}

const sufixo10 = (phone: string): string => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

// ── DISPAROS (broadcast) ─────────────────────────────────────────────────────
type TickResult = { processed: number; broadcast_id?: string; status?: string; reason?: string };

export async function runGeradorBroadcastTick(): Promise<TickResult> {
  if (!ligado()) return { processed: 0, reason: 'desligado' };
  if (!(await adquirirLockBlast('gerador', LOCK_DURATION_MS))) {
    return { processed: 0, reason: 'linha_ocupada_outro_motor' };
  }
  try {
    return await broadcastTickInner();
  } finally {
    await liberarLockBlast('gerador');
  }
}

async function broadcastTickInner(): Promise<TickResult> {
  const nowIso = new Date().toISOString();

  const { data: candidatos, error: candErr } = await supabaseGerador
    .from('gerador_broadcasts')
    .select('*')
    .eq('status', 'rodando')
    .or(`tick_lock_until.is.null,tick_lock_until.lt.${nowIso}`)
    .order('ultimo_envio_em', { ascending: true, nullsFirst: true })
    .limit(1);
  if (candErr) { logger.error('gerador-automacao', 'erro buscando campanhas', candErr); return { processed: 0, reason: 'erro_busca' }; }
  if (!candidatos || candidatos.length === 0) return { processed: 0, reason: 'nada_rodando' };

  const b = candidatos[0] as BroadcastRow;
  if (!Array.isArray(b.contatos) || b.contatos.length === 0) return { processed: 0, broadcast_id: b.id, reason: 'sem_contatos' };
  if (!Array.isArray(b.mensagens) || b.mensagens.length === 0) return { processed: 0, broadcast_id: b.id, reason: 'sem_mensagens' };

  // CAP contatos/campanha — fail-closed: campanha grande demais não dispara.
  if (b.contatos.length > MAX_CONTATOS_CAMPANHA) {
    await supabaseGerador.from('gerador_broadcasts').update({
      status: 'erro', finalizado_em: nowIso, tick_lock_until: null,
    }).eq('id', b.id);
    logger.error('gerador-automacao', `campanha ${b.id} excede cap de ${MAX_CONTATOS_CAMPANHA} contatos (${b.contatos.length})`);
    return { processed: 0, broadcast_id: b.id, status: 'erro', reason: 'excede_cap_contatos' };
  }

  // CAP campanhas iniciadas/hora — só barra o INÍCIO de campanha nova (não trava
  // uma já em andamento). Conta campanhas com envio na última hora.
  const naoIniciou = (b.sucesso + b.falha) === 0 && !b.ultimo_envio_em;
  if (naoIniciou) {
    const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabaseGerador
      .from('gerador_broadcasts').select('id', { count: 'exact', head: true })
      .gte('ultimo_envio_em', desde);
    if ((count || 0) >= MAX_CAMPANHAS_HORA) {
      return { processed: 0, broadcast_id: b.id, reason: 'cap_campanhas_hora' };
    }
  }

  // Lock da campanha (5 min).
  const lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
  const { error: lockErr } = await supabaseGerador.from('gerador_broadcasts').update({ tick_lock_until: lockUntil }).eq('id', b.id);
  if (lockErr) { logger.error('gerador-automacao', 'erro lock campanha', lockErr); return { processed: 0, reason: 'erro_lock' }; }

  let sucesso = b.sucesso;
  let falha = b.falha;
  let processed = 0;
  const tickStart = Date.now();

  try {
    // Envios já feitos.
    const { data: enviadosRows } = await supabaseGerador
      .from('gerador_broadcast_envios').select('phone, slot').eq('broadcast_id', b.id);
    const enviadosSet = new Set<string>((enviadosRows as { phone: string; slot: number }[] | null ?? []).map(e => `${e.phone}|${e.slot}`));

    // Travas: supressão (MAIN) + allow-list do CRM (GERADOR).
    const estaBloqueado = await carregarBloqueioProativo();
    const crm = await carregarSufixosCRM();
    const noCRM = (phone: string): boolean => { const s = sufixo10(phone); return !!s && crm.has(s); };

    // Contatos permitidos = no CRM e não bloqueados. O "total esperado" é sobre
    // ESSES (senão a campanha nunca conclui por causa de número fora do CRM).
    const contatosPermitidos = b.contatos.filter(p => noCRM(p) && !estaBloqueado(p));
    const descartados = b.contatos.length - contatosPermitidos.length;
    if (descartados > 0) {
      logger.info('gerador-automacao', `campanha ${b.id}: ${descartados} contato(s) descartado(s) (fora do CRM ou bloqueado)`);
    }

    const pendentes: Array<{ phone: string; slot: number; base: string; mediaUrl: string | null; mediaType: MediaType | null }> = [];
    for (const m of b.mensagens) {
      const mt = m.media_type === 'image' || m.media_type === 'video' || m.media_type === 'audio' ? m.media_type : null;
      const mu = mt && m.media_url ? m.media_url : null;
      for (const phone of contatosPermitidos) {
        if (!enviadosSet.has(`${phone}|${m.slot}`)) pendentes.push({ phone, slot: m.slot, base: m.base, mediaUrl: mu, mediaType: mt });
      }
    }

    const totalEsperado = b.mensagens.length * contatosPermitidos.length;

    if (pendentes.length === 0) {
      await supabaseGerador.from('gerador_broadcasts').update({
        status: 'concluido', finalizado_em: new Date().toISOString(), tick_lock_until: null, total: totalEsperado,
      }).eq('id', b.id);
      return { processed: 0, broadcast_id: b.id, status: 'concluido', reason: contatosPermitidos.length === 0 ? 'nenhum_contato_valido' : 'tudo_enviado' };
    }

    // Cadência relativa ao último envio.
    if (b.ultimo_envio_em) {
      const elapsed = Date.now() - new Date(b.ultimo_envio_em).getTime();
      const minWait = b.cadencia_min * 1000;
      if (elapsed < minWait) await sleep(Math.min(minWait - elapsed, 10000));
    }

    for (let i = 0; i < Math.min(MAX_ENVIOS_POR_TICK, pendentes.length); i++) {
      if (Date.now() - tickStart > TICK_MAX_DURATION_MS) break;
      const item = pendentes[i];

      if (i > 0) {
        const espera = Math.floor((Math.random() * (b.cadencia_max - b.cadencia_min) + b.cadencia_min) * 1000);
        await sleep(espera);
        if (Date.now() - tickStart > TICK_MAX_DURATION_MS) break;
      }

      let mensagemFinal = item.base;
      if (item.mediaType === 'audio') {
        mensagemFinal = '[áudio]';
      } else if (b.usou_ia) {
        try { mensagemFinal = await humanizar(item.base, b.contexto_ai); }
        catch (err) { logger.error('gerador-automacao', `humanize falhou ${b.id} ${item.phone}`, err); }
      }

      let envioStatus: 'ok' | 'erro' = 'erro';
      let zaapId: string | null = null;
      let messageId: string | null = null;
      let erro: string | null = null;
      try {
        const r = await enviarZapiIO(item.phone, mensagemFinal, item.mediaUrl, item.mediaType);
        if (r.ok) { envioStatus = 'ok'; zaapId = r.zaapId ?? null; messageId = r.messageId ?? null; sucesso++; }
        else { erro = r.erro ?? 'erro desconhecido'; falha++; }
      } catch (err) { erro = err instanceof Error ? err.message : String(err); falha++; }

      await supabaseGerador.from('gerador_broadcast_envios').insert({
        broadcast_id: b.id, phone: item.phone, slot: item.slot, mensagem_final: mensagemFinal,
        status: envioStatus, zaap_id: zaapId, message_id: messageId, erro,
      });

      // Silencia os agentes pra quem recebeu o disparo (mesmo flag do takeover).
      // No-op pra número frio (sem row em sdr_leads).
      if (envioStatus === 'ok') {
        try {
          await supabase.from('sdr_leads').update({
            human_takeover: true, human_takeover_at: new Date().toISOString(),
            aguardando_resposta: false, updated_at: new Date().toISOString(),
          }).eq('phone', item.phone).eq('human_takeover', false);
        } catch (err) { logger.error('gerador-automacao', `falha human_takeover ${item.phone}`, err); }
      }

      processed++;
    }

    const enviadosTotal = enviadosSet.size + processed;
    const concluido = enviadosTotal >= totalEsperado;
    const updatePayload: Record<string, unknown> = {
      sucesso, falha, total: totalEsperado, ultimo_envio_em: new Date().toISOString(), tick_lock_until: null,
    };
    if (concluido) { updatePayload.status = 'concluido'; updatePayload.finalizado_em = new Date().toISOString(); }
    await supabaseGerador.from('gerador_broadcasts').update(updatePayload).eq('id', b.id);

    return { processed, broadcast_id: b.id, status: concluido ? 'concluido' : 'rodando', reason: concluido ? 'tudo_enviado' : 'tick_ok' };
  } catch (err) {
    logger.error('gerador-automacao', `erro fatal campanha ${b.id}`, err);
    await supabaseGerador.from('gerador_broadcasts').update({ tick_lock_until: null }).eq('id', b.id);
    return { processed, broadcast_id: b.id, reason: 'erro_fatal' };
  }
}

// ── SEQUÊNCIAS (drip) ────────────────────────────────────────────────────────
type SeqResult = { enviados: number; avancados: number; concluidos: number; reason?: string; dry?: boolean };

export async function runGeradorSequenciasConsumer(opts: { dry?: boolean } = {}): Promise<SeqResult> {
  const dry = !!opts.dry;
  if (!ligado()) return { enviados: 0, avancados: 0, concluidos: 0, reason: 'desligado' };

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabaseGerador
    .from('sequencia_inscricoes')
    .select('*, sequencias(id, passos, ativo)')
    .eq('status', 'ativo')
    .lte('proximo_envio_em', nowIso)
    .order('proximo_envio_em', { ascending: true })
    .limit(20);
  if (error) { logger.error('gerador-automacao', 'erro buscando inscrições', error); return { enviados: 0, avancados: 0, concluidos: 0, reason: 'erro_busca' }; }
  if (!rows || rows.length === 0) return { enviados: 0, avancados: 0, concluidos: 0, reason: 'nada_pendente' };

  const estaBloqueado = await carregarBloqueioProativo();
  const crm = await carregarSufixosCRM();
  const noCRM = (phone: string): boolean => { const s = sufixo10(phone); return !!s && crm.has(s); };

  let enviados = 0, avancados = 0, concluidos = 0;

  for (const insc of rows as InscricaoRow[]) {
    if (enviados >= MAX_SEQ_POR_TICK) break;
    // Teto anti-ban da linha (compartilhado com Bia + followup). Se estourou,
    // segura a inscrição pro próximo tick.
    if (!(await dentroDoTetoHorarioLinha())) break;

    const seq = insc.sequencias;
    if (!seq || !Array.isArray(seq.passos) || seq.ativo === false) {
      // sequência apagada/pausada → conclui a inscrição pra não ficar presa.
      if (!dry) await supabaseGerador.from('sequencia_inscricoes').update({ status: 'concluido' }).eq('id', insc.id);
      concluidos++;
      continue;
    }

    // Fora do CRM ou bloqueado → para essa inscrição (allow-list + anti-denúncia).
    if (!noCRM(insc.phone) || estaBloqueado(insc.phone)) {
      if (!dry) await supabaseGerador.from('sequencia_inscricoes').update({ status: 'parado' }).eq('id', insc.id);
      continue;
    }

    const idx = insc.passo_atual; // 0 = nenhum enviado; próximo passo = passos[idx]
    if (idx >= seq.passos.length) {
      if (!dry) await supabaseGerador.from('sequencia_inscricoes').update({ status: 'concluido' }).eq('id', insc.id);
      concluidos++;
      continue;
    }
    const passo = seq.passos[idx];
    const mt = passo.media_type === 'image' || passo.media_type === 'video' || passo.media_type === 'audio' ? passo.media_type : null;
    const mu = mt && passo.media_url ? passo.media_url : null;

    if (dry) { enviados++; continue; }

    let ok = false;
    try {
      const r = await enviarZapiIO(insc.phone, mt === 'audio' ? '' : (passo.texto || ''), mu, mt);
      ok = r.ok;
      if (!r.ok) logger.error('gerador-automacao', `seq envio falhou ${insc.phone}: ${r.erro}`);
    } catch (err) { logger.error('gerador-automacao', `seq envio erro ${insc.phone}`, err); }

    if (!ok) continue; // mantém a inscrição no mesmo passo pro próximo tick

    // Marker no teto da linha (prefixo registrado em lineThrottle).
    await supabase.from('system_state').upsert(
      { key: `gerador_seq:${insc.phone}:${insc.sequencia_id}:${idx}`, value: '1', updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    // Silencia agentes pra quem recebeu (no-op se frio).
    try {
      await supabase.from('sdr_leads').update({
        human_takeover: true, human_takeover_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('phone', insc.phone).eq('human_takeover', false);
    } catch { /* no-op */ }

    const proxIdx = idx + 1;
    const patch: Record<string, unknown> = { passo_atual: proxIdx, ultimo_envio_em: new Date().toISOString() };
    if (proxIdx >= seq.passos.length) { patch.status = 'concluido'; concluidos++; }
    else {
      const horas = Number(seq.passos[proxIdx]?.intervalo_horas || 0);
      patch.proximo_envio_em = new Date(Date.now() + horas * 3600 * 1000).toISOString();
    }
    await supabaseGerador.from('sequencia_inscricoes').update(patch).eq('id', insc.id);

    enviados++;
    avancados++;
  }

  return { enviados, avancados, concluidos, dry };
}
