import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const VALID_STATUS = ['novo','em_contato','frio','morno','quente','followup','vendido','perdido'] as const;
type IoStatus = typeof VALID_STATUS[number];

// POST público — chamado pelo simulador /io/simular ao concluir
export async function createIoLead(req: Request, res: Response): Promise<void> {
  try {
    const b = req.body as Record<string, any>;

    if (!b.nome || !b.whatsapp) {
      res.status(400).json({ error: 'nome e whatsapp são obrigatórios' });
      return;
    }

    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const user_agent = (req.headers['user-agent'] as string) || null;

    const payload = {
      nome: String(b.nome).trim().slice(0, 200),
      whatsapp: String(b.whatsapp).replace(/\D/g, '').slice(0, 20),
      cidade: b.cidade ? String(b.cidade).slice(0, 100) : null,
      estado: b.estado ? String(b.estado).slice(0, 4) : null,
      tipo: b.tipo || null,
      telhado: b.telhado || null,
      padrao: b.padrao || null,
      pagamento: b.pagamento || null,
      consumo_rs: b.consumo_rs ? Number(b.consumo_rs) : null,
      comercial_kwp:   b.comercial?.kwp   ?? null,
      comercial_preco: b.comercial?.preco ?? null,
      comercial_inv:   b.comercial?.inv   ?? null,
      premium_kwp:     b.premium?.kwp     ?? null,
      premium_preco:   b.premium?.preco   ?? null,
      premium_inv:     b.premium?.inv     ?? null,
      plano_escolhido: b.plano_escolhido || null,
      cliente_grande:  Boolean(b.cliente_grande),
      placas_estimadas: b.placas_estimadas ? Number(b.placas_estimadas) : null,
      utm_source:   b.utm_source   || null,
      utm_campaign: b.utm_campaign || null,
      utm_content:  b.utm_content  || null,
      session_id:   b.session_id   || null,
      ip,
      user_agent,
    };

    const { data, error } = await supabase
      .from('io_leads')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      console.error('createIoLead error:', error);
      res.status(500).json({ error: 'Erro ao salvar lead' });
      return;
    }

    // Cora dispara welcome instantâneo se for horário comercial.
    // Fire-and-forget — não bloqueia a resposta pro cliente.
    // Pula pra cliente_grande: o lead já foi redirecionado ao WhatsApp manualmente
    // e vai mandar a primeira mensagem ele mesmo; welcome automatizado da Cora atropelaria.
    if (data?.id && !payload.cliente_grande) {
      import('../services/agents/io/ioCrmAgent')
        .then(({ sendWelcomeIfBusinessHours }) => sendWelcomeIfBusinessHours(data.id))
        .catch(err => console.error('cora welcome dispatch failed:', err));
    }

    res.json({ ok: true, id: data?.id });
  } catch (err) {
    console.error('createIoLead exception:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}

// GET autenticado — lista leads, com filtros opcionais
export async function listIoLeads(req: Request, res: Response): Promise<void> {
  try {
    const status = req.query.status as string | undefined;
    const since  = req.query.since as string | undefined;
    const limit  = Math.min(parseInt((req.query.limit as string) || '500', 10), 1000);

    let q = supabase
      .from('io_leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status && (VALID_STATUS as readonly string[]).includes(status)) {
      q = q.eq('status', status);
    }
    if (since) {
      q = q.gte('created_at', since);
    }

    const { data, error } = await q;
    if (error) {
      console.error('listIoLeads error:', error);
      res.status(500).json({ error: 'Erro ao listar' });
      return;
    }
    res.json({ leads: data || [] });
  } catch (err) {
    console.error('listIoLeads exception:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}

// PATCH autenticado — atualiza status, plano escolhido, notas
export async function updateIoLead(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const b = req.body as Record<string, any>;
    const userId = (req as any).user?.id as string | undefined;

    if (!id) { res.status(400).json({ error: 'id obrigatório' }); return; }

    const patch: Record<string, any> = {};
    if (b.status && (VALID_STATUS as readonly string[]).includes(b.status)) {
      patch.status = b.status;
      patch.last_contact_at = new Date().toISOString();
    }
    if (b.notes !== undefined)           patch.notes = String(b.notes).slice(0, 5000);
    if (b.plano_escolhido !== undefined) patch.plano_escolhido = b.plano_escolhido;
    if (b.assigned_to !== undefined)     patch.assigned_to = b.assigned_to;

    if (!Object.keys(patch).length) {
      res.status(400).json({ error: 'Nada pra atualizar' });
      return;
    }

    // Lê status atual pro histórico
    let fromStatus: string | null = null;
    if (patch.status) {
      const { data: cur } = await supabase.from('io_leads').select('status').eq('id', id).single();
      fromStatus = cur?.status || null;
    }

    const { error } = await supabase
      .from('io_leads')
      .update(patch)
      .eq('id', id);

    if (error) {
      console.error('updateIoLead error:', error);
      res.status(500).json({ error: 'Erro ao atualizar' });
      return;
    }

    if (patch.status && fromStatus !== patch.status) {
      await supabase.from('io_lead_history').insert({
        lead_id: id,
        changed_by: userId || null,
        from_status: fromStatus,
        to_status: patch.status,
        note: b.note || null,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('updateIoLead exception:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}

// GET autenticado — histórico de um lead
export async function getIoLeadHistory(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('io_lead_history')
      .select('*')
      .eq('lead_id', id)
      .order('created_at', { ascending: false });
    if (error) { res.status(500).json({ error: 'Erro ao buscar histórico' }); return; }
    res.json({ history: data || [] });
  } catch (err) {
    console.error('getIoLeadHistory exception:', err);
    res.status(500).json({ error: 'Erro interno' });
  }
}
