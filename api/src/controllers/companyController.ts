import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';

const companySchema = z.object({
  nome: z.string().min(1, 'Razão Social obrigatória'),
  cnpj: z.string().refine((v) => {
    const c = v.replace(/\D/g, '');
    if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
    const calc = (base: string, w: number[]) => {
      const s = w.reduce((a, x, i) => a + parseInt(base[i]) * x, 0);
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(c, [5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(c[12]) &&
           calc(c, [6,5,4,3,2,9,8,7,6,5,4,3,2]) === parseInt(c[13]);
  }, 'CNPJ inválido'),
  endereco: z.string().optional(),
  logo_base64: z.string().optional(),
  socio_adm: z.string().optional(),
  engenheiro_nome: z.string().optional(),
  engenheiro_cpf: z.string().optional(),
  engenheiro_crea: z.string().optional(),
  engenheiro_rg: z.string().optional(),
  engenheiro_nacionalidade: z.string().optional(),
  engenheiro_estado_civil: z.string().optional(),
  engenheiro_profissao: z.string().optional(),
  engenheiro_endereco: z.string().optional(),
  tecnico_nome: z.string().optional(),
  tecnico_cpf: z.string().optional(),
  tecnico_rg: z.string().optional(),
  tecnico_nacionalidade: z.string().optional(),
  tecnico_estado_civil: z.string().optional(),
  tecnico_endereco: z.string().optional(),
});

export async function getCompany(req: Request, res: Response): Promise<void> {
  try {
    const { data } = await supabase
      .from('company')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    res.json({ company: data || null });
  } catch (err) {
    console.error('GetCompany error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function createCompany(req: Request, res: Response): Promise<void> {
  try {
    const body = companySchema.parse(req.body);

    const { data: existing } = await supabase
      .from('company')
      .select('id')
      .eq('user_id', req.userId)
      .single();

    if (existing) {
      res.status(409).json({ error: 'Empresa já cadastrada para este usuário' });
      return;
    }

    const { data, error } = await supabase
      .from('company')
      .insert({ ...body, user_id: req.userId })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ company: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('CreateCompany error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function updateCompany(req: Request, res: Response): Promise<void> {
  try {
    const body = companySchema.partial().parse(req.body);

    const { data, error } = await supabase
      .from('company')
      .update(body)
      .eq('user_id', req.userId)
      .select()
      .single();

    if (error) throw error;
    res.json({ company: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('UpdateCompany error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
