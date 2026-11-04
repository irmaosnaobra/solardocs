import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { CAMPOS_ENDERECO, montarEndereco, temParteDeEndereco } from '../services/enderecoCliente';

const clientSchema = z.object({
  nome: z.string().min(1, 'Nome obrigatório'),
  tipo: z.enum(['PF', 'PJ']).default('PF'),
  nacionalidade: z.string().optional(),
  cpf_cnpj: z.string().optional(),
  endereco: z.string().optional(),
  logradouro: z.string().optional(),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  bairro: z.string().optional(),
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

// ── Endereço em partes ─────────────────────────────────────────────────────────
// As colunas logradouro/numero/complemento/bairro vêm da MIGRATION_clients_endereco_partes.sql.
// Enquanto ela não rodar, o banco recusa a gravação (PGRST204 ou 42703 citando a coluna).
// Nesse caso grava de novo SEM as 4 partes: o `endereco` (linha completa, que o PDF e os
// contratos leem) vai do mesmo jeito, então nada para de funcionar antes da migration.
type ErroBanco = { code?: string; message?: string } | null | undefined;

function colunaDeEnderecoAusente(error: ErroBanco): boolean {
  if (!error) return false;
  if (error.code !== 'PGRST204' && error.code !== '42703') return false;
  const msg = error.message || '';
  return CAMPOS_ENDERECO.some((c) => msg.includes(c));
}

function semPartesDeEndereco<T extends Record<string, unknown>>(body: T): Omit<T, (typeof CAMPOS_ENDERECO)[number]> {
  const copia: Record<string, unknown> = { ...body };
  for (const c of CAMPOS_ENDERECO) delete copia[c];
  return copia as Omit<T, (typeof CAMPOS_ENDERECO)[number]>;
}

// O servidor é a fonte da linha completa: veio alguma parte, `endereco` é remontado.
function comEnderecoMontado<T extends Record<string, unknown>>(body: T): T {
  if (!temParteDeEndereco(body)) return body;
  return { ...body, endereco: montarEndereco(body) };
}

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
    const body = comEnderecoMontado(clientSchema.parse(req.body));
    let { data, error } = await supabase
      .from('clients')
      .insert({ ...body, user_id: req.userId })
      .select()
      .single();

    if (colunaDeEnderecoAusente(error)) {
      ({ data, error } = await supabase
        .from('clients')
        .insert({ ...semPartesDeEndereco(body), user_id: req.userId })
        .select()
        .single());
    }

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
    let body = clientSchema.partial().parse(req.body);
    const { id } = req.params;

    // Mandou só algumas das partes: completa com o que o cliente já tem, senão a linha
    // montada perderia as outras (ex.: mandar só o bairro apagaria a rua do `endereco`).
    if (temParteDeEndereco(body) && !CAMPOS_ENDERECO.every((c) => body[c] !== undefined)) {
      const { data: atual } = await supabase
        .from('clients').select('*').eq('id', id).eq('user_id', req.userId).maybeSingle();
      if (atual) {
        // Cliente antigo (ou migration ainda não rodou): sem nenhuma parte no banco, a linha
        // inteira vale como logradouro, a mesma regra do modal (partesIniciais).
        const atualTemParte = CAMPOS_ENDERECO.some((c) => atual[c]);
        const base: Record<string, unknown> = atualTemParte ? atual : { logradouro: atual.endereco };
        const partes: Record<string, unknown> = {};
        for (const c of CAMPOS_ENDERECO) partes[c] = body[c] !== undefined ? body[c] : base[c];
        body = { ...body, ...partes };
      }
    }
    body = comEnderecoMontado(body);

    let { data, error } = await supabase
      .from('clients')
      .update(body)
      .eq('id', id)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (colunaDeEnderecoAusente(error)) {
      ({ data, error } = await supabase
        .from('clients')
        .update(semPartesDeEndereco(body))
        .eq('id', id)
        .eq('user_id', req.userId)
        .select()
        .single());
    }

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
