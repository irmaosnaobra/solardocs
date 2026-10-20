// ─────────────────────────────────────────────────────────────────────────────
// CADASTRO DA VENDA do eletroposto: UM cadastro por card vendido (a chave é o id do card), fonte única do cliente para a
// ficha e para os contratos.
//
// Mora SÓ no bucket privado (`cadastroVendaBanco.ts`), nunca no `system_state` (a chave pública do banco principal lê
// aquela tabela). A IA só SUGERE (`cadastroVendaLeitura.ts`): quem grava é a pessoa.
//
// Formato do JSON (bucket `cadastros-venda`, `eletroposto/<id>.json`): { v: 1, campos: { [campo]: { valor, por, em, fonte } }, alteracoes: [{ campo, por, em, fonte }], em }.
// A trilha (últimas 50) guarda QUEM mexeu em QUE campo e QUANDO, nunca o valor.
//
// Nunca se loga valor de campo: só contagens, nomes de campo e de slot.
// ─────────────────────────────────────────────────────────────────────────────
import type { RegistroGestao } from './gestaoClientes';
import { ErroCadastro, lerCadastroBruto, gravarCadastroBruto, listarIdsComPasta, comTrava, type LinhaCadastro } from './cadastroVendaBanco';
import { lerFichaComVersao, gravarFicha } from './fichaEletropostoBanco';

// O cadastro tem PAPÉIS (19/10/2026): o comprador (campos sem prefixo, mais o representante `rep_*` e o ponto), o cedente do
// arrendamento (`ced_*`), o avalista (`aval_*`) e o imóvel (`imovel_*`). É o mesmo JSON: o papel só vive no prefixo.
export const CAMPOS_COMPRADOR = [
  'tipo', 'nome', 'cpf_cnpj', 'rg_ie', 'orgao_emissor', 'nascimento', 'nacionalidade', 'estado_civil', 'profissao',
  'email', 'telefone', 'endereco', 'bairro', 'cidade', 'uf', 'cep',
  'rep_nome', 'rep_cpf', 'rep_rg', 'rep_estado_civil', 'rep_profissao',
  'endereco_ponto', 'unidade_consumidora', 'concessionaria', 'titular_conta',
] as const;
export const CAMPOS_CEDENTE = [
  'ced_nome', 'ced_cpf_cnpj', 'ced_rg_ie', 'ced_orgao_emissor', 'ced_nacionalidade', 'ced_estado_civil', 'ced_profissao',
  'ced_endereco', 'ced_bairro', 'ced_cidade', 'ced_uf', 'ced_cep', 'ced_email', 'ced_telefone', 'ced_qualidade',
] as const;
export const CAMPOS_AVALISTA = [
  'aval_nome', 'aval_cpf_cnpj', 'aval_rg_ie', 'aval_orgao_emissor', 'aval_nascimento', 'aval_nacionalidade', 'aval_estado_civil',
  'aval_profissao', 'aval_endereco', 'aval_bairro', 'aval_cidade', 'aval_uf', 'aval_cep', 'aval_email', 'aval_telefone',
] as const;
export const CAMPOS_IMOVEL = ['imovel_matricula', 'imovel_cartorio', 'imovel_iptu'] as const;
/** Os campos do eletroposto (o cadastro do card vendido de eletroposto). NÃO inclui os da venda solar. */
export const CAMPOS = [...CAMPOS_COMPRADOR, ...CAMPOS_CEDENTE, ...CAMPOS_AVALISTA, ...CAMPOS_IMOVEL] as const;

// ── Venda SOLAR pelo card (`vendasolar`, 20/10/2026) ─────────────────────────
// O mesmo cadastro, com outros papéis: o comprador (e o representante `rep_*`), o titular da conta de luz da unidade geradora
// (`tuc_*`, quando não é o comprador), o avalista, o imóvel e as unidades BENEFICIÁRIAS (as que recebem o excedente), em
// 5 vagas fixas `benef_1_*` a `benef_5_*`. A unidade geradora (onde vão as placas) reaproveita `unidade_consumidora`,
// `concessionaria`, `titular_conta` e `endereco_ponto` e ganha `uc_classe` e `consumo_medio_kwh`. Não há cedente.
export const CAMPOS_TITULAR_UC = [
  'tuc_nome', 'tuc_cpf_cnpj', 'tuc_rg_ie', 'tuc_orgao_emissor', 'tuc_nacionalidade', 'tuc_estado_civil', 'tuc_profissao',
  'tuc_endereco', 'tuc_bairro', 'tuc_cidade', 'tuc_uf', 'tuc_cep', 'tuc_email', 'tuc_telefone', 'tuc_relacao',
] as const;
// Quem é quem na venda solar (20/10/2026): o NEGOCIADOR é o nome do card (`agendamentos.cliente_nome`), com quem a equipe falou, e
// nunca é alterado pelo cadastro. Três papéis têm documento: o CONTRATANTE (os campos sem prefixo), o TITULAR DA HOMOLOGAÇÃO
// (`tuc_*`: a conta de luz e a usina ficam no nome dele, e ele assina a procuração) e o TITULAR DO FINANCIAMENTO (`fin_*`).
// `homologacao_mesmo` e `financiamento_mesmo` dizem se o papel é o próprio contratante ou outra pessoa: com `contratante` os campos
// do papel ficam vazios e os documentos usam os do contratante. Vazio = ainda não decidido.
export const CAMPOS_TITULAR_FINANCIAMENTO = [
  'fin_nome', 'fin_cpf_cnpj', 'fin_rg_ie', 'fin_orgao_emissor', 'fin_nascimento', 'fin_nacionalidade', 'fin_estado_civil', 'fin_profissao',
  'fin_endereco', 'fin_bairro', 'fin_cidade', 'fin_uf', 'fin_cep', 'fin_email', 'fin_telefone',
] as const;
export const CAMPOS_DECISAO_PAPEIS = ['homologacao_mesmo', 'financiamento_mesmo'] as const;
export const OPCOES_PAPEL_MESMO = ['contratante', 'outra_pessoa'] as const;
export const CAMPOS_UC_SOLAR = ['uc_classe', 'consumo_medio_kwh'] as const;
export const MAX_BENEFICIARIAS = 5;
export const CAMPOS_BENEFICIARIAS = [
  'benef_1_uc', 'benef_1_titular', 'benef_1_endereco', 'benef_1_pct',
  'benef_2_uc', 'benef_2_titular', 'benef_2_endereco', 'benef_2_pct',
  'benef_3_uc', 'benef_3_titular', 'benef_3_endereco', 'benef_3_pct',
  'benef_4_uc', 'benef_4_titular', 'benef_4_endereco', 'benef_4_pct',
  'benef_5_uc', 'benef_5_titular', 'benef_5_endereco', 'benef_5_pct',
] as const;
// Rateio (20/10/2026): a modalidade, o percentual que fica na própria geradora e o CPF/CNPJ de cada beneficiária (para conferir
// a titularidade no autoconsumo remoto). Quem preenche é a pessoa: a leitura por IA não pede nenhum destes.
export const CAMPOS_RATEIO = ['rateio_modalidade', 'geradora_pct'] as const;
export const CAMPOS_DOC_BENEFICIARIAS = ['benef_1_doc', 'benef_2_doc', 'benef_3_doc', 'benef_4_doc', 'benef_5_doc'] as const;
/** Modalidade do rateio (`rateio_modalidade`): Lei 14.300/2022 e REN ANEEL 1.000. */
export const MODALIDADES_RATEIO = ['autoconsumo_local', 'autoconsumo_remoto', 'geracao_compartilhada', 'multiplas_ucs'] as const;
/** Os campos da venda solar pelo card. NÃO inclui `ced_*`. */
export const CAMPOS_VENDASOLAR = [
  ...CAMPOS_COMPRADOR, ...CAMPOS_UC_SOLAR, ...CAMPOS_TITULAR_UC, ...CAMPOS_TITULAR_FINANCIAMENTO, ...CAMPOS_DECISAO_PAPEIS,
  ...CAMPOS_AVALISTA, ...CAMPOS_IMOVEL, ...CAMPOS_BENEFICIARIAS, ...CAMPOS_RATEIO, ...CAMPOS_DOC_BENEFICIARIAS,
] as const;
const CAMPOS_TODOS = [
  ...CAMPOS, ...CAMPOS_UC_SOLAR, ...CAMPOS_TITULAR_UC, ...CAMPOS_TITULAR_FINANCIAMENTO, ...CAMPOS_DECISAO_PAPEIS,
  ...CAMPOS_BENEFICIARIAS, ...CAMPOS_RATEIO, ...CAMPOS_DOC_BENEFICIARIAS,
] as const;
/** Qualquer campo de qualquer cadastro. Quem decide se um campo vale é a LINHA (`ehCampo(x, linha)`). */
export type Campo = typeof CAMPOS_TODOS[number];
/** Papel do cedente em relação ao ponto (`ced_qualidade`). Guardado sem acento e em minúscula. */
export const QUALIDADES_CEDENTE = ['proprietario', 'possuidor', 'inquilino', 'representante', 'condominio'] as const;
/** Quem é o titular da conta de luz em relação ao comprador (`tuc_relacao`). Guardado sem acento e em minúscula. */
export const RELACOES_TITULAR_UC = ['conjuge', 'pai_mae', 'filho', 'empresa', 'outro'] as const;
/** Classe de consumo da unidade geradora (`uc_classe`). */
export const CLASSES_UC = ['residencial', 'comercial', 'rural', 'industrial', 'poder_publico'] as const;
export type LinhaDoCadastro = LinhaCadastro;
const SETS_DE_CAMPOS: Record<LinhaCadastro, ReadonlySet<string>> = {
  eletroposto: new Set<string>(CAMPOS),
  vendasolar: new Set<string>(CAMPOS_VENDASOLAR),
};
export const camposDaLinha = (linha: LinhaCadastro): readonly Campo[] => (linha === 'vendasolar' ? CAMPOS_VENDASOLAR : CAMPOS);
/** O campo existe NESTA linha? Sem a linha, vale a do eletroposto (o que sempre valeu). */
export const ehCampo = (x: unknown, linha: LinhaCadastro = 'eletroposto'): x is Campo => typeof x === 'string' && SETS_DE_CAMPOS[linha].has(x);

export type Fonte = 'manual' | 'ia' | 'ficha';
export type Tipo = 'PF' | 'PJ';
export interface CampoGravado { valor: string; por: string; em: string; fonte: Fonte }
export interface TrilhaCadastro { campo: Campo; por: string; em: string; fonte: Fonte }
export interface Cadastro {
  v: 1;
  campos: Partial<Record<Campo, CampoGravado>>;
  alteracoes: TrilhaCadastro[];
  em: string | null;
  /** true depois da primeira escrita: o legado do `system_state` já entrou aqui e deixa de valer. */
  migrado?: boolean;
}

export const MAX_CAMPO = 200;
export const MAX_TRILHA_CADASTRO = 50;
export const cadastroVazio = (): Cadastro => ({ v: 1, campos: {}, alteracoes: [], em: null });

// ── Validação ────────────────────────────────────────────────────────────────

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const soDigitos = (t: string): string => t.replace(/\D/g, '');

function cpfConfere(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const dv = (soma * 10) % 11 % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

function cnpjConfere(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const n of [12, 13]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * pesos[pesos.length - n + i];
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

const fmtCpf = (d: string): string => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
const fmtCnpj = (d: string): string => `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;

function dataReal(t: string): boolean {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) return false;
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, mes - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== d) return false;
  return a >= 1900 && dt.getTime() <= Date.now();
}

export type ResultadoCampo = { ok: true; valor: string } | { ok: false; erro: string };

/** Opção de lista como chave guardada: sem acento, minúscula, espaço, barra e hífen viram `_` ("Pai/Mãe" vira `pai_mae`). */
const chaveDeOpcao = (t: string): string =>
  t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s/\-]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Número digitado: "350", "350,5", "1.234" (ponto de milhar), "1.234,5", "350.5", com "kWh" ou "%" no fim. null = não é número.
 * Ponto só é milhar quando é grupo de 3 dígitos (`1.500` vale 1500); `350.5` é decimal.
 */
function numeroBR(texto: string, comMilhar = true): number | null {
  let s = texto.replace(/\s+/g, '').replace(/(kwh|%)$/i, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (comMilhar && /^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** Como o número é guardado: texto com ponto decimal e até 2 casas, sem zeros à direita ("350", "350.5", "33.33"). */
const numeroGuardado = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Valida e normaliza UM campo. Vazio é permitido e significa "limpar". Devolve o valor já no formato guardado
 * (CPF/CNPJ e CEP formatados, UF em maiúscula, e-mail em minúscula, telefone só dígitos).
 */
export function validarCampo(campo: Campo, valor: unknown): ResultadoCampo {
  if (typeof valor !== 'string') return { ok: false, erro: 'Valor inválido.' };
  const t = valor.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '') return { ok: true, valor: '' };
  if (t.length > MAX_CAMPO) return { ok: false, erro: `Texto longo demais (máximo ${MAX_CAMPO} caracteres).` };
  // Percentual de uma unidade beneficiária (`benef_N_pct`): de 0 a 100. Guardado como número com ponto decimal, até 2 casas.
  // `geradora_pct` é o percentual que fica na própria unidade geradora, com a mesma regra.
  if (/^benef_[1-5]_pct$/.test(campo) || campo === 'geradora_pct') {
    const n = numeroBR(t, false);   // percentual nunca passa de 100: o ponto é sempre decimal ("33.333" vale 33,33)
    return n !== null && n >= 0 && n <= 100 ? { ok: true, valor: numeroGuardado(n) } : { ok: false, erro: 'Percentual de 0 a 100.' };
  }
  if (campo === 'rateio_modalidade') {
    const m = chaveDeOpcao(t);
    return (MODALIDADES_RATEIO as readonly string[]).includes(m)
      ? { ok: true, valor: m }
      : { ok: false, erro: 'Escolha: autoconsumo local, autoconsumo remoto, geração compartilhada ou múltiplas unidades.' };
  }
  if ((CAMPOS_DECISAO_PAPEIS as readonly string[]).includes(campo)) {
    const o = chaveDeOpcao(t);
    return (OPCOES_PAPEL_MESMO as readonly string[]).includes(o)
      ? { ok: true, valor: o }
      : { ok: false, erro: 'Escolha: o contratante ou outra pessoa.' };
  }
  // Os campos do cedente, do avalista, do titular da UC e do titular do financiamento seguem a regra do campo igual do comprador
  // (`ced_cep` valida como `cep`). O documento da beneficiária (`benef_N_doc`) valida como o CPF/CNPJ do comprador, com dígito.
  switch (/^benef_[1-5]_doc$/.test(campo) ? 'cpf_cnpj' : campo.replace(/^(ced|aval|tuc|fin)_/, '')) {
    case 'consumo_medio_kwh': {
      const n = numeroBR(t);
      return n !== null && n > 0 && n <= 1_000_000 ? { ok: true, valor: numeroGuardado(n) } : { ok: false, erro: 'Consumo médio em kWh, maior que zero.' };
    }
    case 'uc_classe': {
      const c = chaveDeOpcao(t);
      return (CLASSES_UC as readonly string[]).includes(c)
        ? { ok: true, valor: c }
        : { ok: false, erro: 'Escolha: residencial, comercial, rural, industrial ou poder público.' };
    }
    case 'relacao': {
      const c = chaveDeOpcao(t);
      return (RELACOES_TITULAR_UC as readonly string[]).includes(c)
        ? { ok: true, valor: c }
        : { ok: false, erro: 'Escolha: cônjuge, pai ou mãe, filho, empresa ou outro.' };
    }
    case 'qualidade': {
      const q = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      return (QUALIDADES_CEDENTE as readonly string[]).includes(q)
        ? { ok: true, valor: q }
        : { ok: false, erro: 'Escolha: proprietário, possuidor, inquilino, representante ou condomínio.' };
    }
    case 'tipo': {
      const u = t.toUpperCase();
      return u === 'PF' || u === 'PJ' ? { ok: true, valor: u } : { ok: false, erro: 'Tipo deve ser PF ou PJ.' };
    }
    case 'cpf_cnpj': {
      const d = soDigitos(t);
      if (d.length === 11) return cpfConfere(d) ? { ok: true, valor: fmtCpf(d) } : { ok: false, erro: 'Dígito do CPF não confere.' };
      if (d.length === 14) return cnpjConfere(d) ? { ok: true, valor: fmtCnpj(d) } : { ok: false, erro: 'Dígito do CNPJ não confere.' };
      return { ok: false, erro: 'CPF com 11 dígitos ou CNPJ com 14.' };
    }
    case 'rep_cpf': {
      const d = soDigitos(t);
      if (d.length !== 11) return { ok: false, erro: 'CPF com 11 dígitos.' };
      return cpfConfere(d) ? { ok: true, valor: fmtCpf(d) } : { ok: false, erro: 'Dígito do CPF não confere.' };
    }
    case 'cep': {
      const d = soDigitos(t);
      return d.length === 8 ? { ok: true, valor: `${d.slice(0, 5)}-${d.slice(5)}` } : { ok: false, erro: 'CEP com 8 dígitos.' };
    }
    case 'uf': {
      const u = t.toUpperCase();
      return UFS.includes(u) ? { ok: true, valor: u } : { ok: false, erro: 'UF inválida.' };
    }
    case 'email': {
      const e = t.toLowerCase();
      return e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? { ok: true, valor: e } : { ok: false, erro: 'E-mail inválido.' };
    }
    case 'nascimento':
      return dataReal(t) ? { ok: true, valor: t } : { ok: false, erro: 'Data inválida. Use dd/mm/aaaa.' };
    case 'telefone': {
      const d = soDigitos(t);
      return d.length >= 10 && d.length <= 13 ? { ok: true, valor: d } : { ok: false, erro: 'Telefone com DDD, de 10 a 13 dígitos.' };
    }
    default:
      return { ok: true, valor: t };
  }
}

/** PF ou PJ pelo tamanho do CPF/CNPJ; null quando não dá para saber. */
export function tipoPeloDocumento(cpfCnpj: string | undefined): Tipo | null {
  const n = soDigitos(cpfCnpj ?? '').length;
  return n === 14 ? 'PJ' : n === 11 ? 'PF' : null;
}

// ── O que falta ──────────────────────────────────────────────────────────────

const OBRIGATORIOS_COMUNS: Campo[] = [
  'email', 'telefone', 'endereco', 'bairro', 'cidade', 'uf', 'cep',
  'endereco_ponto', 'unidade_consumidora', 'concessionaria',
];
const OBRIGATORIOS_PF: Campo[] = ['nome', 'cpf_cnpj', 'rg_ie', 'nacionalidade', 'estado_civil', 'profissao', ...OBRIGATORIOS_COMUNS];
const OBRIGATORIOS_PJ: Campo[] = ['nome', 'cpf_cnpj', 'rg_ie', 'rep_nome', 'rep_cpf', 'rep_estado_civil', 'rep_profissao', ...OBRIGATORIOS_COMUNS];

/** Tipo guardado; sem ele, o do CPF/CNPJ; sem nada, PF. */
export function tipoDoCadastro(c: Cadastro): Tipo {
  const g = c.campos.tipo?.valor;
  if (g === 'PF' || g === 'PJ') return g;
  return tipoPeloDocumento(c.campos.cpf_cnpj?.valor) ?? 'PF';
}

/** Campos obrigatórios ainda vazios, na ordem em que a tela os pede. Na PJ, `rg_ie` é a inscrição estadual (aceita "isento"). */
export function faltando(c: Cadastro, linha: LinhaCadastro = 'eletroposto'): Campo[] {
  const lista = tipoDoCadastro(c) === 'PJ' ? OBRIGATORIOS_PJ : OBRIGATORIOS_PF;
  const proprios = lista.filter((k) => !c.campos[k]?.valor);
  if (linha === 'vendasolar') {
    const f = faltandoPorPapelSolar(c);
    return [...proprios, ...f.titular_uc, ...f.financiamento, ...f.avalista, ...f.imovel, ...f.beneficiarias];
  }
  return [...proprios, ...faltandoDosPapeis(c)];
}

// Cedente, avalista e imóvel só entram na conta se alguém já começou a preencher: venda sem cedente (compra, ou o comprador é o
// dono do ponto) nunca fica "incompleta" por causa deles. Quando a pessoa existe, o que falta é o que um contrato precisa dela.
// Pessoa física (CPF com 11 dígitos, ou ainda sem documento) leva também RG, nacionalidade, estado civil e profissão; empresa
// (CNPJ com 14 dígitos) e condomínio não têm esses campos.
const OBRIGATORIOS_CEDENTE_BASE: Campo[] = ['ced_nome', 'ced_cpf_cnpj', 'ced_endereco', 'ced_bairro', 'ced_cidade', 'ced_uf', 'ced_cep', 'ced_qualidade'];
const OBRIGATORIOS_CEDENTE_PF: Campo[] = ['ced_rg_ie', 'ced_nacionalidade', 'ced_estado_civil', 'ced_profissao'];
const OBRIGATORIOS_AVALISTA_BASE: Campo[] = ['aval_nome', 'aval_cpf_cnpj', 'aval_endereco', 'aval_bairro', 'aval_cidade', 'aval_uf', 'aval_cep'];
const OBRIGATORIOS_AVALISTA_PF: Campo[] = ['aval_rg_ie', 'aval_estado_civil', 'aval_profissao'];
const OBRIGATORIOS_IMOVEL: Campo[] = ['imovel_matricula'];

const temAlgum = (c: Cadastro, campos: readonly Campo[]): boolean => campos.some((k) => !!c.campos[k]?.valor);

export interface FaltandoPorPapel { cedente: Campo[]; avalista: Campo[]; imovel: Campo[] }

/** O que falta de cada papel EXTRA. Papel sem nenhum campo preenchido devolve lista vazia. */
export function faltandoPorPapel(c: Cadastro): FaltandoPorPapel {
  const sem = (lista: Campo[]): Campo[] => lista.filter((k) => !c.campos[k]?.valor);
  const ehPj = (campo: Campo): boolean => tipoPeloDocumento(c.campos[campo]?.valor) === 'PJ';
  return {
    cedente: temAlgum(c, CAMPOS_CEDENTE) ? sem([...OBRIGATORIOS_CEDENTE_BASE, ...(ehPj('ced_cpf_cnpj') ? [] : OBRIGATORIOS_CEDENTE_PF)]) : [],
    avalista: temAlgum(c, CAMPOS_AVALISTA) ? sem([...OBRIGATORIOS_AVALISTA_BASE, ...(ehPj('aval_cpf_cnpj') ? [] : OBRIGATORIOS_AVALISTA_PF)]) : [],
    imovel: temAlgum(c, CAMPOS_IMOVEL) ? sem(OBRIGATORIOS_IMOVEL) : [],
  };
}

// Venda solar: o comprador e a unidade geradora (`endereco_ponto`, `unidade_consumidora`, `concessionaria`, os mesmos obrigatórios
// do eletroposto) sempre contam. Titular da homologação (`tuc_*`) e titular do financiamento (`fin_*`) só entram na conta quando
// `homologacao_mesmo` / `financiamento_mesmo` é `outra_pessoa`; avalista, imóvel e cada beneficiária, se alguém já começou
// a preencher aquela pessoa/vaga. O que o titular da homologação precisa: documento, endereço e a relação com o comprador; PF leva RG,
// estado civil e profissão. Beneficiária: a UC, o titular e o percentual (o percentual não vem da conta de luz).
const OBRIGATORIOS_TITULAR_UC_BASE: Campo[] = ['tuc_nome', 'tuc_cpf_cnpj', 'tuc_endereco', 'tuc_bairro', 'tuc_cidade', 'tuc_uf', 'tuc_cep', 'tuc_relacao'];
const OBRIGATORIOS_TITULAR_UC_PF: Campo[] = ['tuc_rg_ie', 'tuc_estado_civil', 'tuc_profissao'];

const OBRIGATORIOS_FINANCIAMENTO_BASE: Campo[] = ['fin_nome', 'fin_cpf_cnpj', 'fin_endereco', 'fin_bairro', 'fin_cidade', 'fin_uf', 'fin_cep'];
const OBRIGATORIOS_FINANCIAMENTO_PF: Campo[] = ['fin_rg_ie', 'fin_estado_civil', 'fin_profissao'];

export interface FaltandoPorPapelSolar { titular_uc: Campo[]; financiamento: Campo[]; avalista: Campo[]; imovel: Campo[]; beneficiarias: Campo[] }

/** O papel (titular da homologação ou do financiamento) é OUTRA pessoa? Só então os campos dele contam. Vazio (não decidido) e `contratante` = nada falta. */
const ehOutraPessoa = (c: Cadastro, decisao: 'homologacao_mesmo' | 'financiamento_mesmo'): boolean => c.campos[decisao]?.valor === 'outra_pessoa';

/**
 * O nome que vai na homologação: o do titular da homologação (`tuc_nome`) quando é outra pessoa, o do contratante quando
 * `homologacao_mesmo = contratante`. Sem decisão, o `tuc_nome` se houver. '' = não há nome para a homologação.
 */
export function nomeDaHomologacao(c: Cadastro): string {
  if (c.campos.homologacao_mesmo?.valor === 'contratante') return c.campos.nome?.valor ?? '';
  return c.campos.tuc_nome?.valor ?? '';
}

/** Campos de uma vaga de beneficiária (1 a 5), na ordem em que a tela os pede. */
export const camposDaBeneficiaria = (n: number): Campo[] =>
  (['uc', 'titular', 'endereco', 'pct', 'doc'] as const).map((s) => `benef_${n}_${s}` as Campo);

export function faltandoPorPapelSolar(c: Cadastro): FaltandoPorPapelSolar {
  const sem = (lista: Campo[]): Campo[] => lista.filter((k) => !c.campos[k]?.valor);
  const ehPj = (campo: Campo): boolean => tipoPeloDocumento(c.campos[campo]?.valor) === 'PJ';
  const beneficiarias: Campo[] = [];
  for (let n = 1; n <= MAX_BENEFICIARIAS; n++) {
    if (temAlgum(c, camposDaBeneficiaria(n))) beneficiarias.push(...sem([`benef_${n}_uc`, `benef_${n}_titular`, `benef_${n}_pct`] as Campo[]));
  }
  return {
    titular_uc: ehOutraPessoa(c, 'homologacao_mesmo') ? sem([...OBRIGATORIOS_TITULAR_UC_BASE, ...(ehPj('tuc_cpf_cnpj') ? [] : OBRIGATORIOS_TITULAR_UC_PF)]) : [],
    financiamento: ehOutraPessoa(c, 'financiamento_mesmo')
      ? sem([...OBRIGATORIOS_FINANCIAMENTO_BASE, ...(ehPj('fin_cpf_cnpj') ? [] : OBRIGATORIOS_FINANCIAMENTO_PF)]) : [],
    avalista: temAlgum(c, CAMPOS_AVALISTA) ? sem([...OBRIGATORIOS_AVALISTA_BASE, ...(ehPj('aval_cpf_cnpj') ? [] : OBRIGATORIOS_AVALISTA_PF)]) : [],
    imovel: temAlgum(c, CAMPOS_IMOVEL) ? sem(OBRIGATORIOS_IMOVEL) : [],
    beneficiarias,
  };
}

function faltandoDosPapeis(c: Cadastro): Campo[] {
  const f = faltandoPorPapel(c);
  return [...f.cedente, ...f.avalista, ...f.imovel];
}

// ── Leitura e gravação do JSON ───────────────────────────────────────────────

const FONTES: readonly string[] = ['manual', 'ia', 'ficha'];
const txt = (x: unknown): string => (typeof x === 'string' ? x : '');
const fonteDe = (x: unknown): Fonte => (FONTES.includes(String(x)) ? (x as Fonte) : 'manual');

/** Normaliza o JSON do bucket (pode vir torto): só os campos conhecidos, só texto não vazio. */
export function normalizarCadastro(raw: unknown, linha: LinhaCadastro = 'eletroposto'): Cadastro {
  const c = cadastroVazio();
  const v = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const campos = (v.campos && typeof v.campos === 'object' ? v.campos : {}) as Record<string, unknown>;
  for (const [k, g] of Object.entries(campos)) {
    if (!ehCampo(k, linha) || !g || typeof g !== 'object') continue;
    const x = g as Record<string, unknown>;
    const valor = txt(x.valor);
    if (!valor) continue;
    c.campos[k] = { valor, por: txt(x.por), em: txt(x.em), fonte: fonteDe(x.fonte) };
  }
  if (Array.isArray(v.alteracoes)) {
    for (const a of v.alteracoes) {
      if (!a || typeof a !== 'object') continue;
      const x = a as Record<string, unknown>;
      if (!ehCampo(x.campo, linha)) continue;
      c.alteracoes.push({ campo: x.campo, por: txt(x.por), em: txt(x.em), fonte: fonteDe(x.fonte) });
    }
    c.alteracoes = c.alteracoes.slice(-MAX_TRILHA_CADASTRO);
  }
  c.em = typeof v.em === 'string' ? v.em : null;
  if (v.migrado === true) c.migrado = true;
  return c;
}

/** O cadastro de um card, SÓ o que está no bucket. Objeto ainda inexistente = vazio; bucket com problema LANÇA. */
export async function lerCadastro(id: number, linha: LinhaCadastro = 'eletroposto'): Promise<Cadastro> {
  return normalizarCadastro(await lerCadastroBruto(id, linha), linha);
}

// ── Legado: valores que a ficha guardou no `system_state` antes do cadastro ──

/** Coluna da ficha -> campo do cadastro. As outras colunas continuam no `system_state`. */
export const FICHA_PARA_CADASTRO: Readonly<Record<string, Campo>> = {
  cliente: 'nome', cpf_cnpj: 'cpf_cnpj', rg_ie: 'rg_ie', contato: 'telefone', email: 'email', endereco: 'endereco',
  cep: 'cep', cidade: 'cidade', uf: 'uf', endereco_ponto: 'endereco_ponto', unidade_consumidora: 'unidade_consumidora',
  concessionaria: 'concessionaria', titular_conta: 'titular_conta',
};
const CADASTRO_PARA_FICHA: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FICHA_PARA_CADASTRO).map(([f, c]) => [c, f]),
);
export const ehColunaDoCadastro = (chave: string): boolean => Object.prototype.hasOwnProperty.call(FICHA_PARA_CADASTRO, chave);

/** Tem valor de coluna do cadastro (ou `antes` dela) guardado na ficha do `system_state`? */
export function temLegado(reg: RegistroGestao): boolean {
  return Object.keys(FICHA_PARA_CADASTRO).some((col) => reg.campos[col] !== undefined)
    || reg.alteracoes.some((a) => ehColunaDoCadastro(a.coluna) && a.antes !== null);
}

/**
 * Cadastro com o legado (valor que só existe no `system_state`) completando o que falta, com fonte 'ficha'. Só leitura:
 * serve ao GET enquanto a primeira escrita não migrou, para a ficha e o contrato nunca discordarem. Cadastro já migrado
 * (`migrado: true`) é a verdade e o legado é ignorado.
 */
export function mesclarLegado(cad: Cadastro, reg: RegistroGestao): Cadastro {
  if (cad.migrado) return cad;
  const campos = { ...cad.campos };
  const trilha = [...cad.alteracoes];
  for (const [coluna, campo] of Object.entries(FICHA_PARA_CADASTRO)) {
    const s = reg.campos[coluna];
    if (campos[campo] || !s || s.valor === null || s.valor === undefined) continue;
    const valor = String(s.valor).replace(/\s+/g, ' ').trim().slice(0, MAX_CAMPO);
    if (!valor) continue;
    campos[campo] = { valor, por: s.por, em: s.em, fonte: 'ficha' };
    trilha.push({ campo, por: s.por, em: s.em, fonte: 'ficha' });
  }
  const t = campos.cpf_cnpj && !campos.tipo ? tipoPeloDocumento(campos.cpf_cnpj.valor) : null;
  if (t && campos.cpf_cnpj) campos.tipo = { valor: t, por: campos.cpf_cnpj.por, em: campos.cpf_cnpj.em, fonte: 'ficha' };
  return { ...cad, campos, alteracoes: trilha.slice(-MAX_TRILHA_CADASTRO) };
}

/** O cadastro como a tela deve ver: o bucket mais o legado ainda não migrado. Lança se o bucket ou a ficha falharem. */
export async function lerCadastroVisto(id: number, linha: LinhaCadastro = 'eletroposto'): Promise<Cadastro> {
  // A venda solar pelo card nasceu já com o cadastro no bucket: não há legado da ficha para mesclar.
  if (linha === 'vendasolar') return lerCadastro(id, linha);
  const cad = await lerCadastro(id);
  if (cad.migrado) return cad;
  return mesclarLegado(cad, (await lerFichaComVersao(id)).reg);
}

/**
 * O registro CRU da ficha sem o `antes` guardado das colunas do cadastro (o valor antigo era CPF, endereço...). null = nada
 * a mudar. NÃO mexe nos valores: serve às gravações de colunas que não são do cadastro.
 */
export function limparAntes(reg: RegistroGestao): RegistroGestao | null {
  let mudou = false;
  const alteracoes = reg.alteracoes.map((a) => {
    if (!ehColunaDoCadastro(a.coluna) || a.antes === null) return a;
    mudou = true;
    return { ...a, antes: null };
  });
  return mudou ? { ...reg, alteracoes } : null;
}

/**
 * O registro CRU da ficha sem os valores das colunas do cadastro e sem o `antes` delas. SÓ depois de o cadastro ter sido
 * gravado com sucesso (os valores já estão lá). null = nada a mudar.
 */
export function limparMigrados(reg: RegistroGestao): RegistroGestao | null {
  let mudou = false;
  const campos = { ...reg.campos };
  for (const col of Object.keys(FICHA_PARA_CADASTRO)) if (campos[col] !== undefined) { delete campos[col]; mudou = true; }
  const alteracoes = reg.alteracoes.map((a) => {
    if (!ehColunaDoCadastro(a.coluna) || a.antes === null) return a;
    mudou = true;
    return { ...a, antes: null };
  });
  return mudou ? { ...reg, campos, alteracoes } : null;
}

// ── Escrita ──────────────────────────────────────────────────────────────────

export interface ResultadoEscrita {
  cad: Cadastro;
  /** A ficha CRU como ficou no `system_state` (sem as colunas do cadastro quando a limpeza deu certo). */
  reg: RegistroGestao;
  /** false: o cadastro foi gravado, mas o `system_state` não deixou limpar o legado (a leitura já ignora o legado). */
  limpou: boolean;
  /** Venda solar: o cadastro como estava ANTES desta escrita (o nome que a planilha recebeu da última vez sai daqui). */
  antes?: Cadastro;
}

const TENTATIVAS_LIMPEZA = 4;

/**
 * A ÚNICA porta de escrita do cadastro (PUT do cadastro, PUT da ficha e migração), sempre sob a trava da venda:
 *   1. lê o cadastro mais recente e a ficha do `system_state`;
 *   2. as colunas que só existem no legado entram no cadastro com fonte 'ficha' (migração completa);
 *   3. aplica a edição pedida por cima (valor '' limpa, inclusive o que era legado);
 *   4. grava o cadastro COM `migrado: true`;
 *   5. só depois do sucesso, apaga do `system_state` as colunas do cadastro (valor e `antes`).
 * Quem chama já validou o formato (`validarCampo`); aqui só se recusa campo desconhecido e valor que não é texto.
 */
export async function escreverCadastro(
  id: number, mudancas: Partial<Record<string, string>>, por: string, fonte: Fonte, agora: string = new Date().toISOString(),
  linha: LinhaCadastro = 'eletroposto',
): Promise<ResultadoEscrita> {
  const pedido: Array<[Campo, string]> = [];
  for (const [k, v] of Object.entries(mudancas)) {
    if (!ehCampo(k, linha) || typeof v !== 'string' || v.length > MAX_CAMPO) throw new ErroCadastro('campo');
    pedido.push([k, v.trim()]);
  }
  if (!pedido.some(([k]) => k === 'tipo')) {
    const doc = pedido.find(([k, v]) => k === 'cpf_cnpj' && v);
    const t = doc ? tipoPeloDocumento(doc[1]) : null;
    if (t) pedido.push(['tipo', t]);
  }
  if (linha === 'vendasolar') return escreverCadastroSolar(id, pedido, por, fonte, agora);
  return comTrava(id, por, async () => {
    const noBucket = await lerCadastro(id);
    const ficha = await lerFichaComVersao(id);
    const base = mesclarLegado(noBucket, ficha.reg);
    const campos = { ...base.campos };
    const trilha = [...base.alteracoes];
    let mudou = !noBucket.migrado || base !== noBucket;
    for (const [k, v] of pedido) {
      if (v === '') {
        if (!campos[k]) continue;
        delete campos[k];
      } else {
        if (campos[k]?.valor === v) continue;
        campos[k] = { valor: v, por, em: agora, fonte };
      }
      trilha.push({ campo: k, por, em: agora, fonte });
      mudou = true;
    }
    const novo: Cadastro = { v: 1, campos, alteracoes: trilha.slice(-MAX_TRILHA_CADASTRO), em: mudou ? agora : base.em, migrado: true };
    if (mudou) await gravarCadastroBruto(id, novo);

    // Cadastro gravado. Agora o legado sai do `system_state`; se ele não deixar, o dado já está salvo e a leitura ignora o legado.
    let reg = ficha.reg;
    let versao = ficha.versao;
    for (let t = 0; t < TENTATIVAS_LIMPEZA; t++) {
      const limpo = limparMigrados(reg);
      if (!limpo) return { cad: novo, reg, limpou: true };
      if (await gravarFicha(id, limpo, versao, agora)) return { cad: novo, reg: limpo, limpou: true };
      ({ reg, versao } = await lerFichaComVersao(id));   // perdeu a corrida: lê de novo
    }
    return { cad: novo, reg, limpou: false };
  });
}

/**
 * Escrita do cadastro da venda SOLAR pelo card: ler, aplicar e gravar, sob a trava da venda (`vendasolar:<id>`, a mesma dos
 * rótulos). Não há ficha nem legado: só o bucket. Sempre `migrado: true`. `limpou` é sempre true (não há o que limpar).
 */
async function escreverCadastroSolar(
  id: number, pedido: Array<[Campo, string]>, por: string, fonte: Fonte, agora: string,
): Promise<ResultadoEscrita> {
  const doc = pedido.find(([k, v]) => k === 'cpf_cnpj' && v);
  const t = !pedido.some(([k]) => k === 'tipo') && doc ? tipoPeloDocumento(doc[1]) : null;
  let todos: Array<[Campo, string]> = t ? [...pedido, ['tipo', t]] : pedido;
  // "Mesmo que o contratante" esvazia o papel: os campos dele saem (e vão para a trilha), e o que veio junto no mesmo pedido para
  // eles perde. Assim nenhum leitor (tela, documentos, contrato) enxerga um titular velho depois da troca.
  for (const [decisao, campos] of [['homologacao_mesmo', CAMPOS_TITULAR_UC], ['financiamento_mesmo', CAMPOS_TITULAR_FINANCIAMENTO]] as const) {
    if (todos.some(([k, v]) => k === decisao && v === 'contratante')) {
      todos = [...todos.filter(([k]) => !(campos as readonly string[]).includes(k)), ...campos.map((k): [Campo, string] => [k, ''])];
    }
  }
  return comTrava(`vendasolar:${id}`, por, async () => {
    const base = await lerCadastro(id, 'vendasolar');
    // Papel já gravado como "contratante": valor novo para os campos dele é ignorado, a não ser que o MESMO pedido mude a decisão
    // para outra coisa (`outra_pessoa`, ou vazio). Limpar (valor vazio) continua valendo.
    const ignorados = new Set<string>();
    for (const [decisao, campos] of [['homologacao_mesmo', CAMPOS_TITULAR_UC], ['financiamento_mesmo', CAMPOS_TITULAR_FINANCIAMENTO]] as const) {
      const pedida = todos.find(([k]) => k === decisao);
      if ((pedida ? pedida[1] : base.campos[decisao]?.valor) === 'contratante') for (const k of campos) ignorados.add(k);
    }
    const aplicar = todos.filter(([k, v]) => v === '' || !ignorados.has(k));
    const campos = { ...base.campos };
    const trilha = [...base.alteracoes];
    let mudou = !base.migrado;
    for (const [k, v] of aplicar) {
      if (v === '') {
        if (!campos[k]) continue;
        delete campos[k];
      } else {
        if (campos[k]?.valor === v) continue;
        campos[k] = { valor: v, por, em: agora, fonte };
      }
      trilha.push({ campo: k, por, em: agora, fonte });
      mudou = true;
    }
    const novo: Cadastro = { v: 1, campos, alteracoes: trilha.slice(-MAX_TRILHA_CADASTRO), em: mudou ? agora : base.em, migrado: true };
    if (mudou) await gravarCadastroBruto(id, novo, 'vendasolar');
    return { cad: novo, reg: { campos: {}, alteracoes: [], em: null }, limpou: true, antes: base };
  });
}

/** Grava campos e devolve o cadastro novo (a API do plano). Veja `escreverCadastro`. */
export async function gravarCampos(
  id: number, mudancas: Partial<Record<string, string>>, por: string, fonte: Fonte, agora: string = new Date().toISOString(),
  linha: LinhaCadastro = 'eletroposto',
): Promise<Cadastro> {
  return (await escreverCadastro(id, mudancas, por, fonte, agora, linha)).cad;
}

// ── Resposta das rotas ───────────────────────────────────────────────────────

export interface VistaCadastro {
  campos: Partial<Record<Campo, CampoGravado>>;
  /** Os mesmos campos só com o texto, para a tela preencher o formulário sem desmontar `campos`. */
  valores: Partial<Record<Campo, string>>;
  faltando: Campo[];
  tipo: Tipo;
}
export function vistaDe(c: Cadastro, linha: LinhaCadastro = 'eletroposto'): VistaCadastro {
  const valores: Partial<Record<Campo, string>> = {};
  for (const k of camposDaLinha(linha)) { const g = c.campos[k]; if (g) valores[k] = g.valor; }
  return { campos: c.campos, valores, faltando: faltando(c, linha), tipo: tipoDoCadastro(c) };
}

// ── A ficha lê do cadastro (fonte única) ─────────────────────────────────────

/**
 * Registro da ficha COM o cadastro por cima, SÓ para ler e montar a resposta. Nunca grave este objeto no
 * `system_state`: ele levaria CPF e endereço para lá. Cadastro ainda não migrado: o que só existe no `system_state`
 * continua aparecendo. Cadastro migrado: as colunas do cadastro vêm só dele (legado que sobrou numa limpeza que falhou é
 * ignorado). A trilha do cadastro entra como alteração da coluna, para o conflito de gravação enxergar quem mexeu.
 */
export function sobreporCadastro(reg: RegistroGestao, cad: Cadastro | null): RegistroGestao {
  if (!cad) return reg;
  const campos = { ...reg.campos };
  if (cad.migrado) for (const coluna of Object.keys(FICHA_PARA_CADASTRO)) delete campos[coluna];
  for (const [coluna, campo] of Object.entries(FICHA_PARA_CADASTRO)) {
    const g = cad.campos[campo];
    if (g && g.valor) campos[coluna] = { valor: g.valor, por: g.por, em: g.em };
  }
  const alteracoes = [...reg.alteracoes];
  for (const a of cad.alteracoes) {
    const coluna = CADASTRO_PARA_FICHA[a.campo];
    if (coluna) alteracoes.push({ em: a.em, por: a.por, coluna, antes: null });
  }
  return { campos, alteracoes, em: cad.em && (!reg.em || cad.em > reg.em) ? cad.em : reg.em };
}

/**
 * Cadastros das vendas pedidas, para a grade. Só baixa o de quem tem cadastro no bucket. Falha por venda (JSON torto, erro
 * de leitura) isola SÓ aquela venda (`falhas`); falha geral (listar, bucket) devolve `indisponivel`. Nos dois casos a
 * ficha cai nos valores do `system_state` em vez de derrubar a grade.
 */
export async function lerCadastros(ids: number[]): Promise<{
  mapa: Map<number, Cadastro>; falhas: Set<number>; indisponivel: boolean;
}> {
  const mapa = new Map<number, Cadastro>();
  const falhas = new Set<number>();
  try {
    const existentes = await listarIdsComPasta();
    const alvo = ids.filter((i) => existentes.has(i));
    let proximo = 0;
    const trabalhador = async (): Promise<void> => {
      while (proximo < alvo.length) {
        const id = alvo[proximo++];
        try { mapa.set(id, await lerCadastro(id)); } catch (err) {
          falhas.add(id);
          console.error('[cadastro-venda] leitura de uma venda falhou', err instanceof ErroCadastro ? err.codigo : 'interno');
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, alvo.length) }, trabalhador));
    return { mapa, falhas, indisponivel: false };
  } catch (err) {
    console.error('[cadastro-venda] leitura da grade falhou', err instanceof ErroCadastro ? err.codigo : 'interno');
    return { mapa: new Map(), falhas: new Set(), indisponivel: true };
  }
}
