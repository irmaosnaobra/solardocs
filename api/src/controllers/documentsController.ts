import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { ApiError } from '../utils/apiError';
import { generateDocumentWithAI } from '../services/aiService';
import { generateFromTemplate } from '../services/templateService';
import { checkLimit, incrementUsed } from '../services/planService';

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

    if (body.useTemplate) {
      content = generateFromTemplate(body.tipo, company, entity, body.fields, body.modeloNumero);
      modeloUsado = `modelo-${body.modeloNumero}`;
    } else {
      await checkLimit(req.userId);
      content = await generateDocumentWithAI(body.tipo, company, entity, body.fields);
      await incrementUsed(req.userId);
      modeloUsado = process.env.OPENAI_API_KEY ? 'gpt-4o' : 'claude-opus-4-6';
    }

    res.json({ content, modelo_usado: modeloUsado, tipo: body.tipo, cliente_nome: entityNome });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    console.error('generateDocument error:', err);
    res.status(500).json({ error: 'Erro ao gerar documento' });
  }
}

export async function saveDocument(req: Request, res: Response): Promise<void> {
  try {
    const body = saveSchema.parse(req.body);

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
    console.error('saveDocument error:', err);
    res.status(500).json({ error: 'Erro ao salvar documento' });
  }
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  try {
    const tipo = req.query.tipo as string | undefined;
    let query = supabase.from('documents').select('*').eq('user_id', req.userId).order('created_at', { ascending: false });

    if (tipo) query = query.eq('tipo', tipo);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ documents: data });
  } catch (err) {
    console.error('listDocuments error:', err);
    res.status(500).json({ error: 'Erro ao listar documentos' });
  }
}
