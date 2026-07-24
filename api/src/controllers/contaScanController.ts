import { Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';

// ── Escanear Conta ─────────────────────────────────────────────────
// Recebe uma foto/PDF da conta de luz, extrai os dados via Claude vision
// e devolve os campos JÁ mapeados pro cadastro de cliente. NÃO salva nada:
// o front abre o ClientModal com esses dados pré-preenchidos pra revisão.
//
// Modelo: claude-sonnet-4-6 — mesmo modelo (e mesmo formato de bloco de
// imagem) já usado em produção no agente de WhatsApp (whatsappAgentService),
// então a plumbing de visão é comprovada. Extração via tool-use forçado,
// garantindo saída estruturada sem parse frágil de JSON.

export const VISION_MODEL = 'claude-sonnet-4-6';

const scanSchema = z.object({
  file_base64: z.string().min(10, 'Arquivo vazio'),
  media_type: z.enum([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
  ]),
});

// ── Enums canônicos (byte-idênticos ao clientsController + ClientModal) ──
const PADROES = ['Monofásico', 'Bifásico', 'Trifásico'] as const;
const TELHADOS = [
  'Fibromadeira', 'Fibrometal', 'Cimento', 'Cerâmico', 'Zinco',
  'Sanduíche', 'Solo', 'Carport', 'Estrutura Metálica', 'Outro',
] as const;

const deburr = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Comprimento do prefixo comum entre duas strings */
function sharedPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

/** Casa o valor do modelo com o enum canônico (acento-insensível) ou retorna ''.
 *  Além do match exato, tolera variações de gênero/abreviação ("trifasica",
 *  "tri" → "Trifásico") via prefixo comum ≥3, sem casar valores distintos
 *  (mono/bi/tri divergem já no 1º–3º caractere). */
function toEnum<T extends string>(value: unknown, options: readonly T[]): T | '' {
  if (typeof value !== 'string' || !value.trim()) return '';
  const v = deburr(value);
  const exact = options.find((o) => deburr(o) === v);
  if (exact) return exact;
  if (v.length >= 3) {
    const partial = options.find((o) => sharedPrefix(deburr(o), v) >= 3);
    if (partial) return partial;
  }
  return '';
}

function normTipo(value: unknown): 'PF' | 'PJ' {
  return deburr(String(value ?? '')) === 'pj' ? 'PJ' : 'PF';
}

// ── Formatação de exibição (o ClientModal reaplica as máscaras no onChange,
//    então mandamos já formatado pra revisão ficar limpa) ──
function onlyDigits(s: unknown): string {
  return typeof s === 'string' ? s.replace(/\D/g, '') : '';
}

function fmtCpfCnpj(raw: unknown, tipo: 'PF' | 'PJ'): string {
  const d = onlyDigits(raw);
  if (tipo === 'PJ') {
    if (d.length !== 14) return '';
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (d.length !== 11) return '';
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function fmtCep(raw: unknown): string {
  const d = onlyDigits(raw);
  if (d.length !== 8) return '';
  return d.replace(/^(\d{5})(\d{3})$/, '$1-$2');
}

function fmtTel(raw: unknown): string {
  const d = onlyDigits(raw);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return '';
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function toUf(v: unknown): string {
  return toStr(v).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Decimal preservado (pra tarifa R$/kWh e valores em R$; toNum arredondaria)
function toDecimal(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Forma bruta que o modelo devolve via tool-use
export interface RawExtraction {
  tipo?: string;
  nome?: string;
  cpf_cnpj?: string;
  cpf_mascarado?: boolean;
  endereco?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  concessionaria?: string;
  telefone?: string;
  email?: string;
  padrao?: string;
  consumo_medio_kwh?: number | string;
  historico_kwh?: unknown;
  tarifa_kwh?: number | string;
  iluminacao_publica?: number | string;
  confianca?: string;
  observacoes?: string;
  conta_valida?: boolean;
}

export const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'registrar_dados_conta',
  description:
    'Registra os dados extraídos de uma conta de energia elétrica brasileira (fatura de luz) para cadastro de cliente.',
  input_schema: {
    type: 'object',
    properties: {
      conta_valida: {
        type: 'boolean',
        description: 'true se a imagem/PDF é realmente uma conta/fatura de energia elétrica; false caso contrário.',
      },
      tipo: { type: 'string', enum: ['PF', 'PJ'], description: 'PF se o titular é pessoa física (CPF), PJ se é empresa (CNPJ).' },
      nome: { type: 'string', description: 'Nome completo do titular (PF) ou razão social (PJ), exatamente como na conta.' },
      cpf_cnpj: { type: 'string', description: 'CPF ou CNPJ do titular, só os dígitos. Se estiver mascarado (ex: ***.456.789-**) deixe vazio.' },
      cpf_mascarado: { type: 'boolean', description: 'true se o CPF/CNPJ aparece parcialmente oculto/mascarado na conta.' },
      endereco: { type: 'string', description: 'Logradouro completo da instalação: rua, número, complemento e bairro.' },
      cep: { type: 'string', description: 'CEP da instalação, só os dígitos.' },
      cidade: { type: 'string', description: 'Cidade da instalação.' },
      uf: { type: 'string', description: 'Sigla do estado (2 letras). Ex: MG, SP.' },
      concessionaria: { type: 'string', description: 'Nome comercial curto da distribuidora. Ex: CEMIG, CPFL, Enel, Equatorial, Neoenergia, Light, Energisa.' },
      telefone: { type: 'string', description: 'Telefone do titular, se houver na conta. Só os dígitos.' },
      email: { type: 'string', description: 'E-mail do titular, se houver.' },
      padrao: { type: 'string', enum: PADROES as unknown as string[], description: 'Tipo de ligação/padrão de energia: Monofásico, Bifásico ou Trifásico. Inferir de "tipo de fornecimento", "ligação" ou tensão.' },
      consumo_medio_kwh: { type: 'number', description: 'Consumo médio mensal em kWh (média dos últimos meses do histórico, ou o consumo do mês se não houver histórico).' },
      historico_kwh: {
        type: 'array',
        items: { type: 'number' },
        description: 'Histórico de consumo em kWh dos últimos meses (mais recente primeiro), se a conta trouxer.',
      },
      tarifa_kwh: { type: 'number', description: 'Tarifa efetiva por kWh em reais (R$/kWh) que o cliente paga, com tributos se possível. Se não houver linha explícita de "tarifa", calcule: valor total cobrado da energia consumida ÷ kWh consumidos. Ex: 0.78.' },
      iluminacao_publica: { type: 'number', description: 'Valor em reais da Contribuição de Iluminação Pública (CIP/COSIP) na conta, se houver. Ex: 12.50.' },
      confianca: { type: 'string', enum: ['alta', 'media', 'baixa'], description: 'Sua confiança geral na leitura.' },
      observacoes: { type: 'string', description: 'Qualquer campo duvidoso ou ilegível que o usuário deva conferir. Curto.' },
    },
    required: ['conta_valida'],
  },
};

export const SYSTEM_PROMPT =
  'Você extrai dados de contas de energia elétrica brasileiras (faturas de luz) de distribuidoras como CEMIG, CPFL, Enel, Equatorial, Energisa, Neoenergia, Light, Cemig, Coelba, etc. ' +
  'Leia a imagem ou PDF com atenção e chame a ferramenta registrar_dados_conta com os dados do TITULAR e da INSTALAÇÃO. ' +
  'Regras: (1) Não invente dados — se um campo não está legível ou não existe, omita-o. ' +
  '(2) CPF/CNPJ: se aparecer mascarado (com asteriscos ou dígitos ocultos), deixe cpf_cnpj vazio e marque cpf_mascarado=true. ' +
  '(3) concessionaria deve ser o nome comercial curto (ex: "CEMIG", não "CEMIG DISTRIBUIÇÃO S.A."). ' +
  '(4) Se a imagem não for uma conta de energia, marque conta_valida=false.';

export async function scanConta(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ error: 'Leitura de conta indisponível no momento.' });
    return;
  }

  let body: z.infer<typeof scanSchema>;
  try {
    body = scanSchema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    res.status(400).json({ error: 'Requisição inválida' });
    return;
  }

  // Guard de tamanho: Anthropic aceita até 5MB por imagem (decodificado).
  // base64 infla ~33%, então ~7MB de string ≈ 5MB reais. Cortamos antes.
  const approxBytes = Math.floor((body.file_base64.length * 3) / 4);
  if (approxBytes > 5 * 1024 * 1024) {
    res.status(413).json({ error: 'Arquivo muito grande. Envie uma foto mais leve (até ~4MB).' });
    return;
  }

  const isPdf = body.media_type === 'application/pdf';
  const imgMime = body.media_type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  const block: Anthropic.ContentBlockParam = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.file_base64 } }
    : { type: 'image', source: { type: 'base64', media_type: imgMime, data: body.file_base64 } };

  let raw: RawExtraction;
  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: SYSTEM_PROMPT,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [
            block,
            { type: 'text', text: 'Extraia os dados desta conta de energia para cadastro do cliente.' },
          ],
        },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      res.status(422).json({ error: 'Não consegui ler os dados. Tente uma foto mais nítida e enquadrada.' });
      return;
    }
    raw = toolBlock.input as RawExtraction;
  } catch (err) {
    console.error('[scanConta] Anthropic error:', err);
    res.status(502).json({ error: 'Falha ao ler a conta. Tente novamente em instantes.' });
    return;
  }

  if (raw.conta_valida === false) {
    res.status(422).json({ error: 'Isso não parece uma conta de energia. Envie a foto ou o PDF da fatura de luz.' });
    return;
  }

  res.json(normalizeExtraction(raw));
}

// ── Normalização final: enums viram valor canônico ('' se não casar),
//    documentos/telefones formatados, UF em 2 letras maiúsculas. Isso
//    garante que o valor semeado no ClientModal ou passa na validação
//    do backend, ou fica vazio — nunca um lixo que dá 400 no save.
export function normalizeExtraction(raw: RawExtraction) {
  const tipo = normTipo(raw.tipo);
  const cpfMascarado = raw.cpf_mascarado === true;

  const cliente = {
    tipo,
    nome: toStr(raw.nome),
    cpf_cnpj: cpfMascarado ? '' : fmtCpfCnpj(raw.cpf_cnpj, tipo),
    endereco: toStr(raw.endereco),
    cep: fmtCep(raw.cep),
    cidade: toStr(raw.cidade),
    uf: toUf(raw.uf),
    concessionaria: toStr(raw.concessionaria),
    telefone: fmtTel(raw.telefone),
    email: toStr(raw.email),
    padrao: toEnum(raw.padrao, PADROES),
    tipo_telhado: '' as (typeof TELHADOS)[number] | '', // não vem na conta; usuário escolhe
  };

  const historico = Array.isArray(raw.historico_kwh)
    ? raw.historico_kwh.map(toNum).filter((n): n is number => n !== null).slice(0, 13)
    : [];

  const conf = raw.confianca;
  const detectado = {
    consumo_medio_kwh: toNum(raw.consumo_medio_kwh) ?? (historico.length ? Math.round(historico.reduce((a, b) => a + b, 0) / historico.length) : null),
    historico_kwh: historico,
    tarifa_kwh: toDecimal(raw.tarifa_kwh),
    iluminacao_publica: toDecimal(raw.iluminacao_publica),
    cpf_mascarado: cpfMascarado,
    confianca: conf === 'alta' || conf === 'media' || conf === 'baixa' ? conf : 'media',
    observacoes: toStr(raw.observacoes),
  };

  return { cliente, detectado };
}

// ── Escanear Documento (RG / CNH / CIN) ────────────────────────────────────────
// Lê um documento de identidade e devolve os campos do cadastro (nome, CPF,
// nacionalidade). Complementa a conta de luz: a fatura costuma mascarar o CPF,
// e o documento traz o CPF completo + nome confirmado. Mesma plumbing de visão.

interface RawDoc {
  doc_valido?: boolean;
  tipo_doc?: string;
  nome?: string;
  cpf?: string;
  nacionalidade?: string;
  confianca?: string;
  observacoes?: string;
}

export const DOC_EXTRACT_TOOL: Anthropic.Tool = {
  name: 'registrar_dados_documento',
  description:
    'Registra os dados extraídos de um documento de identidade brasileiro (RG, CNH ou CIN/novo RG) para cadastro de cliente.',
  input_schema: {
    type: 'object',
    properties: {
      doc_valido: { type: 'boolean', description: 'true se é um documento de identidade brasileiro (RG, CNH, CIN/novo RG, carteira funcional com foto); false caso contrário.' },
      tipo_doc: { type: 'string', enum: ['RG', 'CNH', 'CIN', 'outro'], description: 'Tipo do documento identificado.' },
      nome: { type: 'string', description: 'Nome completo do titular, exatamente como no documento.' },
      cpf: { type: 'string', description: 'CPF do titular, só os 11 dígitos. Se não houver ou estiver ilegível, omita.' },
      nacionalidade: { type: 'string', description: 'Nacionalidade se constar (ex: brasileiro/brasileira).' },
      confianca: { type: 'string', enum: ['alta', 'media', 'baixa'], description: 'Sua confiança na leitura.' },
      observacoes: { type: 'string', description: 'Campos duvidosos/ilegíveis pra conferência. Curto.' },
    },
    required: ['doc_valido'],
  },
};

export const DOC_SYSTEM_PROMPT =
  'Você extrai dados de documentos de identidade brasileiros (RG antigo, CNH, CIN/novo documento de identidade e carteiras funcionais com foto). ' +
  'Leia a imagem/PDF e chame a ferramenta registrar_dados_documento com o NOME COMPLETO e o CPF do titular. ' +
  'Regras: (1) Não invente dados — se um campo não está legível ou não existe, omita-o. ' +
  '(2) CPF: só os 11 dígitos, sem pontos/traço. ' +
  '(3) Se a imagem tiver frente e verso, use os dois. ' +
  '(4) Se não for um documento de identidade, marque doc_valido=false.';

export async function scanDocumento(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ error: 'Leitura de documento indisponível no momento.' });
    return;
  }

  let body: z.infer<typeof scanSchema>;
  try {
    body = scanSchema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    res.status(400).json({ error: 'Requisição inválida' });
    return;
  }

  const approxBytes = Math.floor((body.file_base64.length * 3) / 4);
  if (approxBytes > 5 * 1024 * 1024) {
    res.status(413).json({ error: 'Arquivo muito grande. Envie uma foto mais leve (até ~4MB).' });
    return;
  }

  const isPdf = body.media_type === 'application/pdf';
  const imgMime = body.media_type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  const block: Anthropic.ContentBlockParam = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.file_base64 } }
    : { type: 'image', source: { type: 'base64', media_type: imgMime, data: body.file_base64 } };

  let raw: RawDoc;
  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: DOC_SYSTEM_PROMPT,
      tools: [DOC_EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: DOC_EXTRACT_TOOL.name },
      messages: [
        {
          role: 'user',
          content: [block, { type: 'text', text: 'Extraia o nome e o CPF deste documento para cadastro do cliente.' }],
        },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      res.status(422).json({ error: 'Não consegui ler o documento. Tente uma foto mais nítida.' });
      return;
    }
    raw = toolBlock.input as RawDoc;
  } catch (err) {
    console.error('[scanDocumento] Anthropic error:', err);
    res.status(502).json({ error: 'Falha ao ler o documento. Tente novamente em instantes.' });
    return;
  }

  if (raw.doc_valido === false) {
    res.status(422).json({ error: 'Isso não parece um documento de identidade. Envie o RG, a CNH ou a CIN.' });
    return;
  }

  const conf = raw.confianca;
  const cliente = {
    tipo: 'PF' as const,
    nome: toStr(raw.nome),
    cpf_cnpj: fmtCpfCnpj(raw.cpf, 'PF'),
    nacionalidade: toStr(raw.nacionalidade) || 'brasileiro(a)',
  };
  const detectado = {
    tipo_doc: toStr(raw.tipo_doc),
    confianca: conf === 'alta' || conf === 'media' || conf === 'baixa' ? conf : 'media',
    observacoes: toStr(raw.observacoes),
  };
  res.json({ cliente, detectado });
}
