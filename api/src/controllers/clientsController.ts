import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';

const clientSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  tipo: z.enum(['PF', 'PJ']).default('PF'),
  nacionalidade: z.string().optional(),
  cpf_cnpj: z.string().optional(),
  endereco: z.string().optional(),
  cep: z.string().optional(),
  cidade: z.string().optional(),
  uf: z.string().optional(),
  concessionaria: z.string().optional(),
  email: z.string().optional(),
  telefone: z.string().optional(),
  telefone2: z.string().optional(),
  padrao: z.enum(['Monofásico', 'Bifásico', 'Trifásico']).optional(),
  tipo_telhado: z.enum(['Fibromadeira', 'Fibrometal', 'Cimento', 'Cerâmico', 'Zinco', 'Sanduíche', 'Solo', 'Carport', 'Estrutura Metálica', 'Outro']).optional(),
});

export async function listClients(req: Request, res: Response): Promise<void> {
  try {
    const search = req.query.search as string | undefined;
    let query = supabase
      .from('clients')
      .select('*')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .order('nome', { ascending: true });

    if (search) query = query.ilike('nome', `%${search}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ clients: data });
  } catch (err) {
    console.error('ListClients error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function createClient(req: Request, res: Response): Promise<void> {
  try {
    const body = clientSchema.parse(req.body);
    const { data, error } = await supabase
      .from('clients')
      .insert({ ...body, user_id: req.userId })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ client: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('CreateClient error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function updateClient(req: Request, res: Response): Promise<void> {
  try {
    const body = clientSchema.partial().parse(req.body);
    const { id } = req.params;

    const { data, error } = await supabase
      .from('clients')
      .update(body)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Cliente não encontrado' });
      return;
    }
    res.json({ client: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('UpdateClient error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function deleteClient(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id)
      .eq('user_id', req.userId)
      .select('id');

    if (error) throw error;
    if (!data || data.length === 0) {
      res.status(404).json({ error: 'Cliente não encontrado' });
      return;
    }
    res.status(204).send();
  } catch (err: any) {
    if (err?.code === '23503') {
      res.status(409).json({ error: 'Este cliente possui documentos vinculados. Exclua os documentos primeiro.' });
      return;
    }
    console.error('DeleteClient error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// ── Arquivar documento do cliente (conta de luz / identidade) ──────────────────
// Guarda o arquivo no Storage e registra em clients.documentos, pra ficar
// arquivado junto do cliente e o app saber que já existe (evita redundância).
const docSchema = z.object({
  tipo: z.enum(['conta_luz', 'identidade']),
  base64: z.string().min(10),
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']).default('image/jpeg'),
  nome: z.string().max(255).optional(),
});

export async function addClientDocumento(req: Request, res: Response): Promise<void> {
  let body: z.infer<typeof docSchema>;
  try {
    body = docSchema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    res.status(400).json({ error: 'Requisição inválida' });
    return;
  }
  const { id } = req.params;

  // Confere que o cliente é do usuário.
  const { data: cli } = await supabase
    .from('clients').select('id').eq('id', id).eq('user_id', req.userId).maybeSingle();
  if (!cli) {
    res.status(404).json({ error: 'Cliente não encontrado' });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(body.base64, 'base64');
  } catch {
    res.status(400).json({ error: 'Arquivo inválido.' });
    return;
  }
  if (buffer.length > 9_000_000) {
    res.status(413).json({ error: 'Arquivo muito grande (máx ~9MB).' });
    return;
  }

  const isPdf = body.media_type === 'application/pdf';
  const ext = isPdf ? 'pdf' : body.media_type === 'image/png' ? 'png' : body.media_type === 'image/webp' ? 'webp' : 'jpg';
  const path = `clientes/${req.userId}/${id}/${body.tipo}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('documentos').upload(path, buffer, { contentType: body.media_type, upsert: false });
  if (upErr) {
    console.error('addClientDocumento upload error:', upErr);
    res.status(502).json({ error: 'Não consegui arquivar. Tente de novo.' });
    return;
  }

  const documento = { tipo: body.tipo, url: path, ts: new Date().toISOString(), nome: body.nome ?? null };
  const { error: rpcErr } = await supabase.rpc('client_add_documento', {
    p_id: id, p_user: req.userId, p_doc: documento,
  });
  if (rpcErr) {
    console.error('addClientDocumento rpc error:', rpcErr);
    res.status(500).json({ error: 'Arquivo subiu mas não consegui registrar.' });
    return;
  }
  res.json({ ok: true, documento });
}
