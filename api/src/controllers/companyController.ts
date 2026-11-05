import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { BancoIndisponivel, lerDoBanco, responder503 } from '../utils/dbTransitorio';
import { sendMetaEvent } from '../utils/metaPixel';
import { cnpjValido } from '../utils/cnpj';
import { colunaAusente } from '../services/vistoria/extras';
import { fotosObrasComUrl, sanitizarFotosObras } from './portfolioController';
import { normalizarDadosBancarios } from '../utils/dadosBancarios';

// Duas colunas da proposta Completa + Banco. O zod só deixa passar a chave (z.unknown): a limpeza é
// feita à mão em preparar(), porque item ruim tem que ser descartado, não virar 400 do formulário inteiro.
// Coluna ausente no banco (migration não rodou): o cadastro (POST) grava o resto e segue; a edição (PUT) responde 503 sem gravar nada.
const COLUNAS_NOVAS = ['fotos_obras', 'dados_bancarios'] as const;

function separarColunasNovas(userId: string | undefined, body: Record<string, unknown>) {
  const resto: Record<string, unknown> = { ...body };
  const novas: Record<string, unknown> = {};
  for (const k of COLUNAS_NOVAS) delete resto[k];
  if ('fotos_obras' in body) novas.fotos_obras = sanitizarFotosObras(String(userId ?? ''), body.fotos_obras);
  if ('dados_bancarios' in body) novas.dados_bancarios = normalizarDadosBancarios(body.dados_bancarios);
  return { resto, novas };
}

/** Devolve a empresa com `url` assinada em cada foto de obra. Nunca lança: sem URL, o item vai sem ela. */
async function comUrlsDasFotos<T extends Record<string, unknown> | null>(userId: string | undefined, company: T): Promise<T> {
  if (!company || !Array.isArray(company.fotos_obras)) return company;
  return { ...company, fotos_obras: await fotosObrasComUrl(String(userId ?? ''), company.fotos_obras) };
}

const companySchema = z.object({
  nome: z.string().min(1, 'Razão Social obrigatória'),
  nome_fantasia: z.string().optional(), // nome de marca — usado na exibição/documentos
  cnpj: z.string().refine((v) => cnpjValido(v), 'CNPJ inválido'),
  endereco: z.string().optional(),
  cidade: z.string().optional(),
  logo_base64: z.string().optional(),
  cor_marca: z.string().optional(),      // cor principal da marca (hex)
  cor_secundaria: z.string().optional(), // 2ª cor (hex) — acento/destaque nos documentos
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
  tecnico_crt_cft: z.string().optional(),
  tecnico_nacionalidade: z.string().optional(),
  tecnico_estado_civil: z.string().optional(),
  tecnico_endereco: z.string().optional(),
  tecnico2_nome: z.string().optional(),
  tecnico2_cpf: z.string().optional(),
  tecnico2_rg: z.string().optional(),
  tecnico2_crt_cft: z.string().optional(),
  tecnico2_nacionalidade: z.string().optional(),
  tecnico2_estado_civil: z.string().optional(),
  tecnico2_endereco: z.string().optional(),
  tecnico3_nome: z.string().optional(),
  tecnico3_cpf: z.string().optional(),
  tecnico3_rg: z.string().optional(),
  tecnico3_crt_cft: z.string().optional(),
  tecnico3_nacionalidade: z.string().optional(),
  tecnico3_estado_civil: z.string().optional(),
  tecnico3_endereco: z.string().optional(),
  whatsapp: z.string().optional(),
  fotos_obras: z.unknown().optional(),     // Array<{ path, legenda? }>, até 6, só paths do próprio usuário
  dados_bancarios: z.unknown().optional(), // { banco, agencia, conta, tipo_conta, titular, documento, pix } ou null
});

export async function getCompany(req: Request, res: Response): Promise<void> {
  try {
    // O layout decide o muro de CNPJ com esta resposta. Engolir o error fazia um
    // 504 virar { company: null } com 200, e quem tem CNPJ caía na tela de
    // cadastrar empresa durante a instabilidade. limit(1) mantém a regra de
    // devolver uma company só, sem o maybeSingle quebrar se um dia houver duas.
    const data = await lerDoBanco(() => supabase
      .from('company')
      .select('*')
      .eq('user_id', req.userId)
      .limit(1)
      .maybeSingle());

    res.json({ company: await comUrlsDasFotos(req.userId, data || null) });
  } catch (err) {
    if (err instanceof BancoIndisponivel) { responder503(res, 'company', err.causa); return; }
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

    const { resto, novas } = separarColunasNovas(req.userId, body);
    let { data, error } = await supabase
      .from('company')
      .insert({ ...resto, ...novas, user_id: req.userId })
      .select()
      .single();

    // Coluna nova ausente: salva a empresa sem elas.
    if (error && Object.keys(novas).length && colunaAusente(error)) {
      ({ data, error } = await supabase
        .from('company')
        .insert({ ...resto, user_id: req.userId })
        .select()
        .single());
    }
    if (error) throw error;

    // Registra dia do followup em que o usuário converteu (se estava na sequência)
    const { data: user } = await supabase
      .from('users')
      .select('email, created_at, followup_day_recovered')
      .eq('id', req.userId)
      .single();

    if (user && !user.followup_day_recovered) {
      const diffMs = Date.now() - new Date(user.created_at).getTime();
      const day = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
      if (day >= 1 && day <= 7) {
        await supabase.from('users').update({ followup_day_recovered: day }).eq('id', req.userId);
      }
    }

    sendMetaEvent('CompleteRegistration', {
      eventId:   req.headers['x-meta-event-id'] as string | undefined,
      email:     user?.email,
      ip:        req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ company: await comUrlsDasFotos(req.userId, data) });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    const pgErr = err as { code?: string };
    if (pgErr?.code === '23505') {
      res.status(409).json({ error: 'Este CNPJ já está cadastrado em outra conta. Use o email original ou entre em contato com o suporte.' });
      return;
    }
    console.error('CreateCompany error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

export async function updateCompany(req: Request, res: Response): Promise<void> {
  try {
    const body = companySchema.partial().parse(req.body);

    // Busca empresa existente para proteger o CNPJ
    const { data: existing } = await supabase
      .from('company')
      .select('cnpj')
      .eq('user_id', req.userId)
      .single();

    // Se já há um CNPJ cadastrado, não permite alteração
    if (existing?.cnpj && body.cnpj) {
      const existingDigits = existing.cnpj.replace(/\D/g, '');
      const newDigits      = body.cnpj.replace(/\D/g, '');
      if (existingDigits !== newDigits) {
        res.status(403).json({ error: 'O CNPJ não pode ser alterado após o cadastro. Entre em contato com o suporte.' });
        return;
      }
    }

    const { resto, novas } = separarColunasNovas(req.userId, body);
    const gravar = (campos: Record<string, unknown>) => supabase
      .from('company')
      .update(campos)
      .eq('user_id', req.userId)
      .select()
      .single();
    let { data, error } = await gravar({ ...resto, ...novas });

    // Coluna nova ausente: a tela manda o formulário inteiro, então salvar só o resto daria "salvou" sem as
    // fotos e os dados bancários. O update falhou inteiro (nada foi gravado): 503, nunca 200 sem gravar.
    if (error && Object.keys(novas).length && colunaAusente(error)) {
      res.status(503).json({ error: 'Não deu para salvar agora. Tente de novo em instantes.' });
      return;
    }
    if (error) throw error;
    res.json({ company: await comUrlsDasFotos(req.userId, data) });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    console.error('UpdateCompany error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
