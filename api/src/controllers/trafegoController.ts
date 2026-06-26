import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sendMeetingConfirmedEmail } from '../utils/mailer';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';

// ── Agendamento de reunião de tráfego pago (request-approve) ──────────────────
// Cliente PROPÕE um horário (pending) → admin confirma (cola Meet link) →
// dispara email + WhatsApp. Janela: 13h–19h início (BRT), seg–sex, próx. 7 dias.

const BRT_OFFSET = '-03:00';

// Formata um timestamptz pra exibição em português/BRT. Ex: "seg, 30/jun às 14h".
function fmtBRT(slotAtIso: string): string {
  const d = new Date(slotAtIso);
  const data = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit',
  }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return `${data} às ${hora} (horário de Brasília)`;
}

// Valida que o slot proposto cai na janela permitida (seg–sex, 13h–19h BRT, próx 7 dias).
function slotValido(slotAtIso: string): { ok: boolean; motivo?: string } {
  const d = new Date(slotAtIso);
  if (isNaN(d.getTime())) return { ok: false, motivo: 'data_invalida' };
  const agora = Date.now();
  if (d.getTime() < agora) return { ok: false, motivo: 'no_passado' };
  if (d.getTime() > agora + 8 * 24 * 60 * 60 * 1000) return { ok: false, motivo: 'fora_da_janela_7d' };
  // Dia da semana e hora em BRT
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(d);
  const wd = partes.find(p => p.type === 'weekday')?.value;
  const hh = parseInt(partes.find(p => p.type === 'hour')?.value || '0', 10);
  if (wd === 'Sat' || wd === 'Sun') return { ok: false, motivo: 'fim_de_semana' };
  if (hh < 13 || hh > 19) return { ok: false, motivo: 'fora_do_horario' };
  return { ok: true };
}

// POST /trafego/agendar  (autenticado) — cliente cria a reunião pending.
export async function agendarReuniao(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).userId as string | undefined;
    const { slot_at, nome, whatsapp, empresa, regiao } = req.body as {
      slot_at?: string; nome?: string; whatsapp?: string; empresa?: string; regiao?: string;
    };
    if (!slot_at) { res.status(400).json({ error: 'slot_at obrigatório' }); return; }

    const v = slotValido(slot_at);
    if (!v.ok) { res.status(400).json({ error: 'horário_invalido', motivo: v.motivo }); return; }

    // Puxa email do user (fonte da verdade pro contato) se autenticado.
    let email: string | null = null;
    if (userId) {
      const { data: u } = await supabase.from('users').select('email, nome, whatsapp').eq('id', userId).maybeSingle();
      email = u?.email ?? null;
    }

    // Anti-spam leve: 1 pedido pending por user já basta (não enche a fila).
    if (userId) {
      const { data: existente } = await supabase
        .from('trafego_reunioes').select('id').eq('user_id', userId).eq('status', 'pending').limit(1);
      if (existente && existente.length > 0) {
        res.status(409).json({ error: 'ja_tem_pedido_pendente' }); return;
      }
    }

    const { data, error } = await supabase.from('trafego_reunioes').insert({
      user_id: userId ?? null,
      nome: nome ?? null,
      email,
      whatsapp: whatsapp ?? null,
      empresa: empresa ?? null,
      regiao: regiao ?? null,
      slot_at,
      status: 'pending',
    }).select('id').single();
    if (error) throw error;

    res.json({ ok: true, id: data.id });
  } catch (err) {
    logger.error('trafego', 'agendarReuniao falhou', err);
    res.status(500).json({ error: 'erro_interno' });
  }
}

// GET /trafego/admin/reunioes  (admin) — lista pendentes + confirmadas.
export async function listarReunioes(_req: Request, res: Response): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('trafego_reunioes')
      .select('*')
      .order('status', { ascending: true })   // confirmed/declined/pending alfabético; reordenamos no front
      .order('slot_at', { ascending: true });
    if (error) throw error;
    res.json({ reunioes: data ?? [] });
  } catch (err) {
    logger.error('trafego', 'listarReunioes falhou', err);
    res.status(500).json({ error: 'erro_interno' });
  }
}

// POST /trafego/admin/confirmar  (admin) — { id, meet_link } → confirma + notifica.
// Retorna o resultado dos 2 envios pro painel mostrar (não fire-and-forget).
export async function confirmarReuniao(req: Request, res: Response): Promise<void> {
  try {
    const { id, meet_link } = req.body as { id?: string; meet_link?: string };
    if (!id) { res.status(400).json({ error: 'id obrigatório' }); return; }
    if (!meet_link || !/^https?:\/\//.test(meet_link)) { res.status(400).json({ error: 'meet_link inválido (cole o link completo)' }); return; }

    const { data: r, error } = await supabase
      .from('trafego_reunioes').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!r) { res.status(404).json({ error: 'reuniao_nao_encontrada' }); return; }

    const quando = fmtBRT(r.slot_at);

    // 1) Email
    let emailOk = false;
    if (r.email) {
      emailOk = await sendMeetingConfirmedEmail({ to: r.email, nome: r.nome, quando, meetLink: meet_link });
    }

    // 2) WhatsApp (instância 'solardoc' — transacional, mesma do pós-compra)
    let wppOk = false;
    if (r.whatsapp) {
      const msg = `Olá${r.nome ? ' ' + String(r.nome).split(/\s+/)[0] : ''}! 📅 Sua reunião sobre *tráfego pago* tá confirmada:\n\n*${quando}*\n\n🔗 Link da call (Google Meet):\n${meet_link}\n\nSalva esse link. Até lá! 🚀`;
      try {
        await sendWhatsApp(String(r.whatsapp).replace(/\D/g, ''), msg, 'solardoc');
        wppOk = true;
      } catch (e) {
        logger.error('trafego', 'confirmarReuniao: whatsapp falhou', e);
      }
    }

    // 3) Marca confirmado + grava resultado dos envios
    await supabase.from('trafego_reunioes').update({
      status: 'confirmed',
      meet_link,
      confirmed_at: new Date().toISOString(),
      notify_email_ok: emailOk,
      notify_wpp_ok: wppOk,
    }).eq('id', id);

    res.json({ ok: true, email_ok: emailOk, wpp_ok: wppOk, tinha_email: !!r.email, tinha_whatsapp: !!r.whatsapp });
  } catch (err) {
    logger.error('trafego', 'confirmarReuniao falhou', err);
    res.status(500).json({ error: 'erro_interno' });
  }
}

// POST /trafego/admin/recusar  (admin) — { id } → declined.
export async function recusarReuniao(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.body as { id?: string };
    if (!id) { res.status(400).json({ error: 'id obrigatório' }); return; }
    await supabase.from('trafego_reunioes').update({ status: 'declined' }).eq('id', id);
    res.json({ ok: true });
  } catch (err) {
    logger.error('trafego', 'recusarReuniao falhou', err);
    res.status(500).json({ error: 'erro_interno' });
  }
}

// Marcador não-usado pra silenciar lint do offset (documenta a convenção BRT).
void BRT_OFFSET;
