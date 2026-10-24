// ─────────────────────────────────────────────────────────────────────────────
// QUIZ DO SOLARDOC (/diagnostico, 24/10/2026): a conta pura.
//
// A página só manda IDS (pergunta e opção). O servidor recalcula índice, pilares
// e perfil a partir deles e nunca confia no que vier calculado. O porte é do
// bloco `calc-puro` do protótipo, com os mesmos números: o exemplo do protótipo
// dá 37 de 100 e o perfil `braco` (fixado em quizSolardoc.test.ts).
//
// Nada aqui lê banco, relógio ou env.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';

export type RespostaQuiz = string | string[];
export type RespostasSd = Record<string, RespostaQuiz>;

interface Opcao { id: string; /** valor numérico da faixa (minutos, reais, propostas) */ v?: number; /** pontos do pilar */ p?: number }
interface Pergunta { id: string; kind: 'single' | 'multi'; max?: number; pilar?: string; ops: Opcao[]; cond?: (r: RespostasSd) => boolean }

/** `o(id, valor, pontos)`: faixa com valor e, às vezes, pontos. */
const o = (id: string, v?: number, p?: number): Opcao => ({ id, v, p });
/** `pt(id, pontos)`: opção que só vale pontos. */
const pt = (id: string, p: number): Opcao => ({ id, p });

/** Os 27 estados. A `uf` da página é validada contra esta lista. */
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;

/**
 * Perguntas que vão em `respostas`, na ORDEM da página. `empresa` e `cidade` são
 * campos de texto e `uf` vem no corpo: nenhum dos três entra aqui. O painel de
 * queda (CONFIG_SOLARDOC) usa a mesma ordem, e um teste confere contra o HTML.
 */
export const PERGUNTAS_SD: Pergunta[] = [
  { id: 'papel', kind: 'single', ops: [o('dono'), o('vendedor'), o('engenheiro'), o('comecando')] },
  { id: 'cnpj', kind: 'single', ops: [o('sim'), o('empregador'), o('abrindo'), o('nao')] },
  { id: 'clientes', kind: 'multi', ops: [o('casas'), o('comercio'), o('rural'), o('investidor')] },
  { id: 'propostas_mes', kind: 'single', ops: [o('ate5', 3), o('6a15', 10), o('16a30', 23), o('mais30', 40)] },
  { id: 'vendas_mes', kind: 'single', ops: [o('v0', 0), o('v1a2', 1.5), o('v3a5', 4), o('v6a10', 8), o('mais10', 12)] },
  { id: 'ticket', kind: 'single', ops: [o('ate15', 12000), o('15a30', 22000), o('30a60', 45000), o('mais60', 80000)] },
  { id: 'como_faz_hoje', kind: 'single', ops: [o('word'), o('planilha'), o('canva'), o('plataforma'), o('distribuidor'), o('whatsapp')] },
  { id: 'gasto_ferramenta', kind: 'single', ops: [o('nada', 0), o('ate67', 0), o('g68a150', 68), o('g151a300', 151), o('mais300', 301)] },
  { id: 'tempo_por_proposta', kind: 'single', pilar: 'Velocidade', ops: [o('t15', 10, 10), o('t30', 22, 7), o('t60', 45, 4), o('t120', 90, 2), o('tmais', 150, 0)] },
  { id: 'quando_monta', kind: 'single', pilar: 'Velocidade', ops: [pt('expediente', 3), pt('rua', 2), pt('sobra', 1), pt('noite', 0)] },
  { id: 'demora_envio', kind: 'single', pilar: 'Velocidade', ops: [pt('nahora', 8), pt('mesmodia', 6), pt('d1a2', 3), pt('d3', 0)] },
  { id: 'perdeu_venda', kind: 'single', ops: [o('varias'), o('algumas'), o('naosei'), o('nunca')] },
  { id: 'cliente_entende', kind: 'single', pilar: 'Clareza', ops: [pt('sozinho', 8), pt('explico', 5), pt('confuso', 1), pt('preco', 0)] },
  { id: 'erro_proposta', kind: 'single', pilar: 'Imagem', ops: [pt('caro', 0), pt('atempo', 3), pt('quase', 5), pt('nunca', 8)] },
  { id: 'papelada', kind: 'single', pilar: 'Papelada', ops: [pt('luta', 0), pt('viro', 5), pt('modelo', 12), pt('outro', 8)] },
  { id: 'meta_vendas', kind: 'single', ops: [o('mesmas'), o('dobro'), o('triplo'), o('primeiras')] },
  { id: 'tempo_livre', kind: 'single', ops: [o('visitas'), o('posvenda'), o('familia'), o('cidade_nova')] },
  { id: 'imagem', kind: 'single', ops: [o('profissional'), o('rapida'), o('clara'), o('confiavel')] },
  { id: 'fechar_primeira', kind: 'multi', max: 3, ops: [o('nahora'), o('retorno'), o('parcelas'), o('bateria'), o('contrato'), o('marca')] },
  { id: 'prioridade', kind: 'single', ops: [o('rapidez'), o('visual'), o('conta'), o('preco'), o('suporte')] },
  { id: 'frase', kind: 'single', ops: [o('muito'), o('pouco'), o('nao')] },
  { id: 'tem_marca', kind: 'single', pilar: 'Imagem', ops: [pt('sim', 9), pt('asvezes', 4), pt('nao', 0)] },
  { id: 'mostra_economia', kind: 'single', pilar: 'Clareza', ops: [pt('sim', 7), pt('so_total', 3), pt('nao', 0)] },
  { id: 'economia_25', kind: 'single', pilar: 'Clareza', ops: [pt('sim', 5), pt('nao', 0), pt('naosei', 0)] },
  { id: 'financiamento', kind: 'single', pilar: 'Clareza', ops: [pt('sim', 5), pt('aparte', 2), pt('nao', 0)] },
  { id: 'usa_conta', kind: 'single', pilar: 'Velocidade', ops: [pt('foto', 4), pt('digito', 2), pt('nao', 0)] },
  { id: 'contrato_pronto', kind: 'single', pilar: 'Papelada', ops: [pt('sim', 13), pt('depois', 5), pt('nao', 0)] },
  { id: 'modelos', kind: 'single', pilar: 'Imagem', ops: [pt('sim', 8), pt('mesmo', 3), pt('nao', 0)] },
  { id: 'followup', kind: 'single', ops: [o('rotina'), o('lembro'), o('nao')] },
  { id: 'documentos', kind: 'multi', ops: [o('proposta'), o('contrato'), o('procuracao'), o('recibo'), o('banco'), o('servico'), o('vendedor'), o('vistoria')] },
  { id: 'modelo', kind: 'single', ops: [o('direta'), o('completa'), o('ver')] },
  { id: 'logo', kind: 'single', ops: [o('sim'), o('achar'), o('nao')] },
  { id: 'decisor', kind: 'single', ops: [o('eu'), o('socio'), o('chefe')] },
  { id: 'objecao', kind: 'single', ops: [o('preco'), o('ja_uso'), o('aprender'), o('validade'), o('online'), o('nada')] },
  // Só aparece (e só vale) com CNPJ `sim` ou `empregador`.
  { id: 'pagamento', kind: 'single', cond: (r) => r.cnpj === 'sim' || r.cnpj === 'empregador', ops: [o('cartao'), o('pix')] },
  { id: 'quando_comecar', kind: 'single', ops: [o('hoje'), o('semana'), o('mes'), o('pesquisando')] },
];

const POR_ID: Record<string, Pergunta> = {};
for (const p of PERGUNTAS_SD) POR_ID[p.id] = p;

/** Ids das perguntas que vão em `respostas`, na ordem da página. */
export const IDS_PERGUNTAS_SD: string[] = PERGUNTAS_SD.map((p) => p.id);

export const PILARES: Array<[string, string[]]> = [
  ['Velocidade', ['tempo_por_proposta', 'demora_envio', 'usa_conta', 'quando_monta']],
  ['Clareza', ['cliente_entende', 'mostra_economia', 'economia_25', 'financiamento']],
  ['Imagem', ['tem_marca', 'erro_proposta', 'modelos']],
  ['Papelada', ['papelada', 'contrato_pronto']],
];

/**
 * Só deixa passar o que a página poderia ter mandado: id de pergunta conhecido,
 * id de opção da lista, uma opção nas perguntas de uma escolha e uma lista sem
 * repetição nas de várias (`fechar_primeira` no máximo 3). `pagamento` sem CNPJ
 * `sim` ou `empregador` cai fora. Texto livre nunca passa por aqui.
 */
export function limparRespostas(bruto: unknown): RespostasSd {
  const out: RespostasSd = {};
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return out;
  const b = bruto as Record<string, unknown>;
  for (const p of PERGUNTAS_SD) {
    if (!Object.prototype.hasOwnProperty.call(b, p.id)) continue;
    const v = b[p.id];
    const ids = new Set(p.ops.map((x) => x.id));
    if (p.kind === 'single') {
      if (typeof v === 'string' && ids.has(v)) out[p.id] = v;
    } else if (Array.isArray(v)) {
      const lista = [...new Set(v.filter((x): x is string => typeof x === 'string' && ids.has(x)))];
      const cortada = p.max ? lista.slice(0, p.max) : lista;
      if (cortada.length) out[p.id] = cortada;
    }
  }
  // A visibilidade de `pagamento` depende do CNPJ já limpo.
  for (const p of PERGUNTAS_SD) if (p.cond && out[p.id] !== undefined && !p.cond(out)) delete out[p.id];
  return out;
}

const opc = (id: string, r: RespostasSd): Opcao | undefined => {
  const v = r[id];
  return typeof v === 'string' ? POR_ID[id]?.ops.find((x) => x.id === v) : undefined;
};
const valor = (r: RespostasSd, id: string): number => opc(id, r)?.v ?? 0;
const pontos = (r: RespostasSd, id: string): number => opc(id, r)?.p ?? 0;

export function pilares(r: RespostasSd): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [nome, ids] of PILARES) out[nome] = ids.reduce((t, id) => t + pontos(r, id), 0);
  return out;
}

/** 0 a 100: a soma dos quatro pilares (teto 25 cada). */
export function indice(r: RespostasSd): number {
  const p = pilares(r);
  return Object.values(p).reduce((t, n) => t + n, 0);
}

/** O pilar de menos pontos; empate fica com o primeiro da lista. */
export function pilarFraco(r: RespostasSd): { nome: string; pts: number } {
  const p = pilares(r);
  let m = PILARES[0][0];
  for (const [n] of PILARES) if (p[n] < p[m]) m = n;
  return { nome: m, pts: p[m] };
}

const minutos = (r: RespostasSd) => valor(r, 'tempo_por_proposta');
const piso = (r: RespostasSd) => valor(r, 'gasto_ferramenta');

/** A ORDEM importa: o primeiro que bate ganha. `informa` pega os demais. */
export const PERFIS: Array<{ id: string; nome: string; teste: (r: RespostasSd) => boolean }> = [
  { id: 'cedo', nome: 'Ainda não é a hora', teste: (r) => r.cnpj === 'abrindo' || r.cnpj === 'nao' },
  { id: 'grande', nome: 'Operação grande', teste: (r) => r.propostas_mes === 'mais30' },
  { id: 'caro', nome: 'Pagando caro pela proposta', teste: (r) => piso(r) >= 151 || (piso(r) >= 68 && r.como_faz_hoje === 'plataforma') },
  { id: 'comecando', nome: 'Começando agora', teste: (r) => r.papel === 'comecando' || r.vendas_mes === 'v0' },
  { id: 'braco', nome: 'Proposta no braço', teste: (r) => ['word', 'planilha', 'canva', 'whatsapp'].includes(String(r.como_faz_hoje)) && minutos(r) >= 30 },
  { id: 'crescer', nome: 'Pronto para crescer', teste: (r) => indice(r) >= 75 },
  { id: 'informa', nome: 'Proposta que informa', teste: () => true },
];

export function perfil(r: RespostasSd): { id: string; nome: string } {
  const p = PERFIS.find((x) => x.teste(r)) as (typeof PERFIS)[number];
  return { id: p.id, nome: p.nome };
}

/** Item da proposta que o diagnóstico confere: `ok` é a resposta que conta como "tem". */
const ITENS: Array<{ q: string; ok: string }> = [
  { q: 'tem_marca', ok: 'sim' },
  { q: 'mostra_economia', ok: 'sim' },
  { q: 'economia_25', ok: 'sim' },
  { q: 'financiamento', ok: 'sim' },
  { q: 'usa_conta', ok: 'foto' },
  { q: 'contrato_pronto', ok: 'sim' },
  { q: 'modelos', ok: 'sim' },
  { q: 'followup', ok: 'rotina' },
];

/** Ids dos itens que faltam na proposta (resposta ausente também conta como falta), na ordem da lista. */
export function itensQueFaltam(r: RespostasSd): string[] {
  return ITENS.filter((it) => r[it.q] !== it.ok).map((it) => it.q);
}

export interface ResultadoQuiz {
  indice: number;
  perfil: string;
  perfil_nome: string;
  pilares: Record<string, number>;
  pilar_fraco: string;
  faltam: string[];
}

/** A conta inteira, sobre respostas JÁ limpas. */
export function calcular(r: RespostasSd): ResultadoQuiz {
  const pf = perfil(r);
  return {
    indice: indice(r), perfil: pf.id, perfil_nome: pf.nome,
    pilares: pilares(r), pilar_fraco: pilarFraco(r).nome, faltam: itensQueFaltam(r),
  };
}

// ── telefone, código, id do lead ─────────────────────────────────────────────

/**
 * Telefone do corpo → "55" + 10 ou 11 dígitos, ou null. Tira o 55 ou o 0 do começo
 * SÓ quando sobram 10 ou 11 dígitos (um DDD 55 de 11 dígitos, "55999999999", fica
 * como está). O DDD tem que ser de dois dígitos sem zero.
 */
export function normalizarTelefoneSd(bruto: unknown): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '').replace(/^(?:55|0)(?=\d{10,11}$)/, '');
  if (d.length !== 10 && d.length !== 11) return null;
  if (!/^[1-9][1-9]/.test(d)) return null;
  return '55' + d;
}

/** Chave do lead: DDD + 8 últimos dígitos (a mesma do CRM, tolera o 9 e o 55). */
export function chaveDoTelefone(tel55: string): string {
  const d = tel55.replace(/\D/g, '').replace(/^55/, '');
  return d.slice(0, 2) + d.slice(-8);
}

/** O lead do quiz do SolarDoc. NÃO usa o prefixo `quiz_`, que é do quiz solar e entra no painel dele. */
export const leadIdDoQuiz = (tel55: string): string => `sdquiz_${chaveDoTelefone(tel55)}`;

const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem O, I, 0 e 1
/**
 * "SD-XXXX": 4 símbolos de A-Z e 2-9 (sem 0, O, 1, I), derivados do telefone, então o
 * mesmo número volta sempre ao mesmo código. São ~1 milhão de combinações: o código é
 * para a conversa ("meu código é ..."), quem identifica o lead é sempre o telefone.
 */
export function codigoDoQuiz(tel55: string): string {
  const h = createHash('sha256').update('sdquiz:' + chaveDoTelefone(tel55), 'utf8').digest();
  let s = '';
  for (let i = 0; i < 4; i++) s += ALFABETO_CODIGO[h[i] % ALFABETO_CODIGO.length];
  return 'SD-' + s;
}
