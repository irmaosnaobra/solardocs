import { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { supabase } from '../utils/supabase';
import { cidadeParaGravar } from '../services/io/cidadeCanonica';

// Cadastro de intenção da NEXUS (link da bio do Instagram): a pessoa diz o que
// quer, quanto pretende investir e deixa o contato. SÓ GRAVA: nenhuma mensagem de
// WhatsApp (lead ou equipe), nenhum card de agenda, nenhum evento no Meta.
// Banco: PRINCIPAL do SolarDoc, tabela nexus_instagram_interesse, escrita pela
// função nexus_instagram_gravar (upsert atômico, só a service role executa).
// Leitura no /admin: listarInteressesAdmin.

export const ELETROPOSTO_VALIDOS = [
  'cotista', 'investidor', 'arrendamento', 'chave_na_mao', 'parceiro', 'so_carregador',
] as const;
export const MOBILIDADE_VALIDOS = [
  'carro_compacto', 'carro_suv', 'carro_sedan', 'picape', 'van', 'caminhao', 'moto', 'scooter',
  'bike', 'patinete', 'triciclo', 'quadriciclo', 'golfe', 'wallbox', 'carregador_rapido', 'bateria', 'solar',
] as const;
const OBJETIVOS = new Set(['proprio', 'frota', 'revenda', 'investir']);
const INVESTIMENTOS = new Set(['ate_10', '10_50', '50_100', '100_250', '250_500', '500_mais', 'naosei']);
const RECURSOS = new Set(['proprio', 'financiamento', 'os_dois', 'naosei']);
const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE',
  'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);
const UTM_CHAVES = ['source', 'medium', 'campaign', 'content', 'term'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ERRO_SALVAR = 'Não deu para salvar agora. Tente de novo em instantes.';
const TABELA = 'nexus_instagram_interesse';
// Linha de teste = telefone fictício desta faixa (ex.: 5534900000000). O corpo não decide: ninguém
// de fora consegue marcar o próprio cadastro como teste para sumir da lista do /admin.
const RE_TELEFONE_TESTE = /^5534900000\d{2,3}$/;
const PAGINA = 1000;
const TETO_ADMIN = 5000;

// Cadastro público da bio: 10 por minuto por IP (o `trust proxy` do app.ts dá o IP real).
export const nexusInteresseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, erro: 'Muitas tentativas. Espere um minuto e tente de novo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');
// Só string passa: objeto, número ou array no corpo viram vazio e caem na validação (400), nunca em 500.
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const txt = (v: unknown, max: number): string | null => str(v).trim().slice(0, max) || null;

function erro(res: Response, frase: string): void {
  res.status(400).json({ ok: false, erro: frase });
}

function lista(v: unknown, validos: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.slice(0, 30).map((i) => str(i)).filter((i) => validos.includes(i)))];
}

function utmDe(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of UTM_CHAVES) {
    const s = txt(o[k], 200);
    if (s) out[k] = s;
  }
  return Object.keys(out).length ? out : null;
}

// Cidade e UF vão separadas para o banco. A UF digitada vale: o texto passa pelo
// canônico como "Cidade-UF" e só aceita o resultado se a UF dele for a mesma.
function cidadeEUf(cidadeBruta: string, uf: string, telefone: string): { cidade: string; uf: string } {
  const canonico = cidadeParaGravar(`${cidadeBruta}-${uf}`, telefone);
  const m = canonico ? /^(.+)-([A-Z]{2})$/.exec(canonico) : null;
  if (m && m[2] === uf) return { cidade: m[1].slice(0, 80), uf };
  return { cidade: cidadeBruta, uf };
}

export async function cadastrarInteresse(req: Request, res: Response): Promise<void> {
  const b = (req.body || {}) as Record<string, unknown>;

  // Honeypot: robô preenche, gente não vê. Responde como se tivesse dado certo.
  const armadilha = typeof b.site === 'string' ? b.site.trim() !== '' : Boolean(b.site);
  if (armadilha) {
    // Mesma cara de um cadastro novo (contagem atual + 1), sem gravar nada.
    let posicao = 1;
    try {
      const { count, error } = await supabase
        .from(TABELA).select('id', { count: 'exact', head: true }).eq('teste', false);
      if (!error && typeof count === 'number') posicao = count + 1;
    } catch { /* resposta igual mesmo se a contagem falhar */ }
    res.json({ ok: true, posicao, novo: true });
    return;
  }

  const eletroposto = lista(b.eletroposto, ELETROPOSTO_VALIDOS);
  const mobilidade = lista(b.mobilidade, MOBILIDADE_VALIDOS);
  const outro = txt(b.outro, 300);
  if (eletroposto.length === 0 && mobilidade.length === 0 && !outro) {
    return erro(res, 'Marque pelo menos uma opção ou escreva o que procura.');
  }

  const objetivo = str(b.objetivo).trim();
  if (!OBJETIVOS.has(objetivo)) return erro(res, 'Diga qual é o seu objetivo.');

  const investimento = str(b.investimento).trim();
  if (!INVESTIMENTOS.has(investimento)) return erro(res, 'Escolha a faixa de investimento.');

  const recurso = str(b.recurso).trim();
  if (!RECURSOS.has(recurso)) return erro(res, 'Diga como pretende pagar.');

  const nome = str(b.nome).trim();
  if (nome.length < 2 || nome.length > 80) return erro(res, 'Informe seu nome, de 2 a 80 letras.');

  const telefone = soDigitos(str(b.telefone));
  if (telefone.length < 12 || telefone.length > 13 || !telefone.startsWith('55')) {
    return erro(res, 'Confira o WhatsApp, com DDD.');
  }

  const email = str(b.email).trim().toLowerCase();
  if (email.length > 120 || !EMAIL_RE.test(email)) return erro(res, 'Confira o e-mail.');

  const cidadeBruta = txt(b.cidade, 80);
  if (!cidadeBruta) return erro(res, 'Informe a cidade.');

  const ufBruta = str(b.uf).trim().toUpperCase();
  if (!UFS.has(ufBruta)) return erro(res, 'Escolha o estado.');

  const cep = soDigitos(str(b.cep));
  if (cep !== '' && cep.length !== 8) return erro(res, 'Confira o CEP.');

  const endereco = txt(b.endereco, 160);
  const bairro = txt(b.bairro, 80);
  const origem = txt(b.origem, 60);
  const utm = utmDe(b.utm);
  const teste = RE_TELEFONE_TESTE.test(telefone);
  const { cidade, uf } = cidadeEUf(cidadeBruta, ufBruta, telefone);

  try {
    const { data, error } = await supabase.rpc('nexus_instagram_gravar', {
      p_nome: nome,
      p_telefone: telefone,
      p_email: email,
      p_cep: cep || null,
      p_endereco: endereco,
      p_bairro: bairro,
      p_cidade: cidade,
      p_uf: uf,
      p_eletroposto: eletroposto,
      p_mobilidade: mobilidade,
      p_outro: outro,
      p_objetivo: objetivo,
      p_investimento: investimento,
      p_recurso: recurso,
      p_origem: origem,
      p_utm: utm,
      p_teste: teste,
    });
    if (error) throw error;
    const r = (data || {}) as { posicao?: number };
    // Sempre novo:true: a resposta pública não revela se o telefone já estava na lista.
    res.json({ ok: true, posicao: Number(r.posicao) || 1, novo: true });
  } catch (err: any) {
    console.error('[nexus-interesse]', err?.code, err?.message);
    res.status(500).json({ ok: false, erro: ERRO_SALVAR });
  }
}

// Leitura do /admin (hub NEXUS Instagram). O roteador põe authMiddleware e adminMiddleware antes.
export async function listarInteressesAdmin(req: Request, res: Response): Promise<void> {
  try {
    const comTeste = String(req.query?.teste ?? '') === '1';
    const itens: unknown[] = [];
    // Páginas de 1000 (teto do PostgREST) até vir página curta ou chegar a 5000 linhas.
    // Desempate por id para a paginação não repetir nem pular linha de mesmo criado_em.
    for (let ini = 0; itens.length < TETO_ADMIN; ini += PAGINA) {
      let q = supabase
        .from(TABELA)
        .select('*')
        .order('criado_em', { ascending: false })
        .order('id', { ascending: false })
        .range(ini, ini + PAGINA - 1);
      if (!comTeste) q = q.eq('teste', false);
      const { data, error } = await q;
      if (error) throw error;
      const pagina = data ?? [];
      itens.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    res.json({ ok: true, itens });
  } catch (err: any) {
    console.error('[nexus-interesse]', err?.code, err?.message);
    res.status(500).json({ ok: false, erro: 'Não deu para carregar a lista agora.' });
  }
}
