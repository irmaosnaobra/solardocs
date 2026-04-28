import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { ApiError } from '../utils/apiError';
import { generateDocumentWithAI } from '../services/aiService';
import { generateFromTemplate, type Client } from '../services/templateService';
import { checkLimit, incrementUsed } from '../services/planService';
import { logger } from '../utils/logger';

const generateSchema = z.object({
  tipo: z.string().min(1),
  cliente_id: z.string().uuid().optional(),
  terceiro_id: z.string().uuid().optional(),
  fields: z.record(z.string(), z.unknown()),
  useTemplate: z.boolean().optional().default(false),
  modeloNumero: z.union([z.literal(1), z.literal(2)]).optional().default(1),
});

const saveSchema = z.object({
  tipo: z.string().min(1),
  cliente_id: z.string().uuid().optional(),
  terceiro_id: z.string().uuid().optional(),
  cliente_nome: z.string().optional(),
  dados_json: z.record(z.string(), z.unknown()).optional(),
  content: z.string().min(1),
  modelo_usado: z.string().optional(),
});

export async function generateDocument(req: Request, res: Response): Promise<void> {
  try {
    const body = generateSchema.parse(req.body);

    if (!body.cliente_id && !body.terceiro_id) {
      throw new ApiError(400, 'Informe cliente_id ou terceiro_id');
    }

    if (body.tipo === 'prestacaoServico' && !body.terceiro_id) {
      throw new ApiError(400, 'Prestação de Serviço requer um terceiro (CONTRATADA)');
    }

    const { data: company } = await supabase
      .from('company')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (!company) {
      throw new ApiError(400, 'Cadastre sua empresa antes de gerar documentos');
    }

    // Fetch client or terceiro and map to unified entity
    let entity: Record<string, unknown>;
    let entityNome: string;

    if (body.terceiro_id) {
      const { data: terceiro } = await supabase
        .from('terceiros')
        .select('*')
        .eq('id', body.terceiro_id)
        .eq('user_id', req.userId)
        .single();

      if (!terceiro) throw new ApiError(404, 'Terceiro não encontrado');
      entity = terceiro;
      entityNome = terceiro.nome;
    } else {
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', body.cliente_id)
        .eq('user_id', req.userId)
        .single();

      if (!client) throw new ApiError(404, 'Cliente não encontrado');
      entity = client;
      entityNome = client.nome;
    }

    // For prestacaoServico: also fetch cliente final and inject into fields
    if (body.tipo === 'prestacaoServico' && body.cliente_id) {
      const { data: clienteFinal } = await supabase
        .from('clients')
        .select('*')
        .eq('id', body.cliente_id)
        .eq('user_id', req.userId)
        .single();

      if (clienteFinal) {
        body.fields = {
          ...body.fields,
          cliente_final_nome: clienteFinal.nome,
          cliente_final_telefone: (body.fields.telefone_cliente as string) || '',
          cliente_final_endereco_instalacao: (body.fields.endereco_instalacao as string) || clienteFinal.endereco || '',
          cliente_final_tipo_telhado: clienteFinal.tipo_telhado || '',
          cliente_final_padrao: clienteFinal.padrao || '',
        };
      }
    }

    let content: string;
    let modeloUsado: string;

    await checkLimit(req.userId);

    if (body.useTemplate) {
      content = generateFromTemplate(body.tipo, company, entity as unknown as Client, body.fields, body.modeloNumero);
      modeloUsado = `modelo-${body.modeloNumero}`;
    } else {
      content = await generateDocumentWithAI(body.tipo, company, entity as unknown as Client, body.fields);
      modeloUsado = process.env.OPENAI_API_KEY ? 'gpt-4o' : 'claude-opus-4-6';
    }

    await incrementUsed(req.userId);

    // Save record immediately so it always appears in history
    const { data: saved } = await supabase
      .from('documents')
      .insert({
        user_id:     req.userId,
        tipo:        body.tipo,
        cliente_id:  body.cliente_id  || null,
        terceiro_id: body.terceiro_id || null,
        cliente_nome: entityNome,
        dados_json:  body.fields,
        content,
        modelo_usado: modeloUsado,
        arquivo_url: null,
        status: 'saved',
      })
      .select('id')
      .single();

    res.json({ content, modelo_usado: modeloUsado, tipo: body.tipo, cliente_nome: entityNome, doc_id: saved?.id ?? null });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    logger.error('documents', 'generateDocument falhou', err);
    res.status(500).json({ error: 'Erro ao gerar documento' });
  }
}

function injectPrint(html: string): string {
  const script = `<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>`;
  return html.includes('window.print') ? html : html.replace('</body>', script + '</body>');
}

export async function saveDocument(req: Request, res: Response): Promise<void> {
  try {
    const body = saveSchema.parse(req.body);

    // Upload HTML to Supabase Storage if provided
    let arquivo_url: string | null = null;
    const htmlContent = typeof req.body.html_content === 'string' ? req.body.html_content : undefined;
    if (htmlContent) {
      const fileName = `${req.userId}/${body.tipo}-${body.cliente_nome?.replace(/\s+/g, '-').toLowerCase() ?? 'doc'}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(injectPrint(htmlContent), 'utf-8'), { contentType: 'text/html; charset=utf-8', upsert: false });

      if (!uploadError) {
        arquivo_url = fileName;
      }
    }

    const { data, error } = await supabase
      .from('documents')
      .insert({
        user_id: req.userId,
        tipo: body.tipo,
        cliente_id: body.cliente_id || null,
        terceiro_id: body.terceiro_id || null,
        cliente_nome: body.cliente_nome || null,
        dados_json: body.dados_json || null,
        content: body.content,
        modelo_usado: body.modelo_usado || null,
        arquivo_url,
        status: 'saved',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ document: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    logger.error('documents', 'saveDocument falhou', err);
    res.status(500).json({ error: 'Erro ao salvar documento' });
  }
}

export async function updateDocumentFile(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const htmlContent = req.body.html_content as string | undefined;
    const newContent  = req.body.content    as string | undefined;

    // Verify ownership
    const { data: doc } = await supabase
      .from('documents')
      .select('id, user_id, arquivo_url')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!doc) { res.status(404).json({ error: 'Documento não encontrado' }); return; }

    const updates: Record<string, unknown> = {};
    if (newContent) updates.content = newContent;

    if (htmlContent) {
      // Remove old file if exists
      if (doc.arquivo_url) {
        await supabase.storage.from('documentos').remove([doc.arquivo_url]);
      }
      const fileName = `${req.userId}/${id}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(injectPrint(htmlContent), 'utf-8'), { contentType: 'text/html; charset=utf-8', upsert: false });
      if (!uploadError) updates.arquivo_url = fileName;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('documents').update(updates).eq('id', id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('updateDocumentFile error:', err);
    res.status(500).json({ error: 'Erro ao atualizar documento' });
  }
}

export async function getDocumentHtmlUrl(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data: doc } = await supabase
      .from('documents')
      .select('arquivo_url')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!doc?.arquivo_url) {
      res.status(404).json({ error: 'Documento não disponível ainda. Tente novamente em alguns segundos.' });
      return;
    }

    const { data: signed } = await supabase.storage
      .from('documentos')
      .createSignedUrl(doc.arquivo_url, 600);

    if (!signed?.signedUrl) {
      res.status(500).json({ error: 'Erro ao gerar URL do documento' });
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({ url: signed.signedUrl });
  } catch (err) {
    logger.error('documents', 'getDocumentHtmlUrl falhou', err);
    res.status(500).json({ error: 'Erro ao buscar documento' });
  }
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('plano')
      .eq('id', req.userId)
      .single();

    if (!user) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }

    // Iniciante e free: sem histórico completo
    if (user.plano === 'free' || user.plano === 'iniciante') {
      res.json({ documents: [], plano: user.plano, historico: false });
      return;
    }

    const tipo = req.query.tipo as string | undefined;
    let query = supabase
      .from('documents')
      .select('id, tipo, cliente_nome, modelo_usado, arquivo_url, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (tipo) query = query.eq('tipo', tipo);

    // PRO: últimos 30 dias
    if (user.plano === 'pro') {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', cutoff);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Gerar signed URLs para download
    const docs = await Promise.all((data ?? []).map(async (doc) => {
      let signed_url: string | null = null;
      if (doc.arquivo_url) {
        const { data: signed } = await supabase.storage
          .from('documentos')
          .createSignedUrl(doc.arquivo_url, 3600);
        signed_url = signed?.signedUrl ?? null;
      }
      return { ...doc, signed_url };
    }));

    res.json({ documents: docs, plano: user.plano, historico: true });
  } catch (err) {
    logger.error('documents', 'listDocuments falhou', err);
    res.status(500).json({ error: 'Erro ao listar documentos' });
  }
}

export async function cleanupProDocuments(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: proUsers } = await supabase.from('users').select('id').eq('plano', 'pro');
  const proIds = (proUsers ?? []).map(u => u.id);
  if (!proIds.length) return;

  const { data: oldDocs } = await supabase
    .from('documents')
    .select('id, arquivo_url, user_id')
    .lt('created_at', cutoff)
    .in('user_id', proIds);

  if (!oldDocs?.length) return;

  // Deletar arquivos do Storage
  const paths = oldDocs.filter(d => d.arquivo_url).map(d => d.arquivo_url as string);
  if (paths.length) await supabase.storage.from('documentos').remove(paths);

  // Deletar registros do banco
  const ids = oldDocs.map(d => d.id);
  await supabase.from('documents').delete().in('id', ids);

  logger.info('documents', `cleanup: ${ids.length} docs PRO removidos`);
}
