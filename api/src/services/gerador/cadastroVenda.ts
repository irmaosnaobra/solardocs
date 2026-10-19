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
import { ErroCadastro, lerCadastroBruto, gravarCadastroBruto, listarIdsComPasta, comTrava } from './cadastroVendaBanco';
import { lerFichaComVersao, gravarFicha } from './fichaEletropostoBanco';

export const CAMPOS = [
  'tipo', 'nome', 'cpf_cnpj', 'rg_ie', 'orgao_emissor', 'nascimento', 'nacionalidade', 'estado_civil', 'profissao',
  'email', 'telefone', 'endereco', 'bairro', 'cidade', 'uf', 'cep',
  'rep_nome', 'rep_cpf', 'rep_rg', 'rep_estado_civil', 'rep_profissao',
  'endereco_ponto', 'unidade_consumidora', 'concessionaria', 'titular_conta',
] as const;
export type Campo = typeof CAMPOS[number];
export const ehCampo = (x: unknown): x is Campo => typeof x === 'string' && (CAMPOS as readonly string[]).includes(x);

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

/**
 * Valida e normaliza UM campo. Vazio é permitido e significa "limpar". Devolve o valor já no formato guardado
 * (CPF/CNPJ e CEP formatados, UF em maiúscula, e-mail em minúscula, telefone só dígitos).
 */
export function validarCampo(campo: Campo, valor: unknown): ResultadoCampo {
  if (typeof valor !== 'string') return { ok: false, erro: 'Valor inválido.' };
  const t = valor.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (t === '') return { ok: true, valor: '' };
  if (t.length > MAX_CAMPO) return { ok: false, erro: `Texto longo demais (máximo ${MAX_CAMPO} caracteres).` };
  switch (campo) {
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
export function faltando(c: Cadastro): Campo[] {
  const lista = tipoDoCadastro(c) === 'PJ' ? OBRIGATORIOS_PJ : OBRIGATORIOS_PF;
  return lista.filter((k) => !c.campos[k]?.valor);
}

// ── Leitura e gravação do JSON ───────────────────────────────────────────────

const FONTES: readonly string[] = ['manual', 'ia', 'ficha'];
const txt = (x: unknown): string => (typeof x === 'string' ? x : '');
const fonteDe = (x: unknown): Fonte => (FONTES.includes(String(x)) ? (x as Fonte) : 'manual');

/** Normaliza o JSON do bucket (pode vir torto): só os campos conhecidos, só texto não vazio. */
export function normalizarCadastro(raw: unknown): Cadastro {
  const c = cadastroVazio();
  const v = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const campos = (v.campos && typeof v.campos === 'object' ? v.campos : {}) as Record<string, unknown>;
  for (const [k, g] of Object.entries(campos)) {
    if (!ehCampo(k) || !g || typeof g !== 'object') continue;
    const x = g as Record<string, unknown>;
    const valor = txt(x.valor);
    if (!valor) continue;
    c.campos[k] = { valor, por: txt(x.por), em: txt(x.em), fonte: fonteDe(x.fonte) };
  }
  if (Array.isArray(v.alteracoes)) {
    for (const a of v.alteracoes) {
      if (!a || typeof a !== 'object') continue;
      const x = a as Record<string, unknown>;
      if (!ehCampo(x.campo)) continue;
      c.alteracoes.push({ campo: x.campo, por: txt(x.por), em: txt(x.em), fonte: fonteDe(x.fonte) });
    }
    c.alteracoes = c.alteracoes.slice(-MAX_TRILHA_CADASTRO);
  }
  c.em = typeof v.em === 'string' ? v.em : null;
  if (v.migrado === true) c.migrado = true;
  return c;
}

/** O cadastro de um card, SÓ o que está no bucket. Objeto ainda inexistente = vazio; bucket com problema LANÇA. */
export async function lerCadastro(id: number): Promise<Cadastro> {
  return normalizarCadastro(await lerCadastroBruto(id));
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
export async function lerCadastroVisto(id: number): Promise<Cadastro> {
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
): Promise<ResultadoEscrita> {
  const pedido: Array<[Campo, string]> = [];
  for (const [k, v] of Object.entries(mudancas)) {
    if (!ehCampo(k) || typeof v !== 'string' || v.length > MAX_CAMPO) throw new ErroCadastro('campo');
    pedido.push([k, v.trim()]);
  }
  if (!pedido.some(([k]) => k === 'tipo')) {
    const doc = pedido.find(([k, v]) => k === 'cpf_cnpj' && v);
    const t = doc ? tipoPeloDocumento(doc[1]) : null;
    if (t) pedido.push(['tipo', t]);
  }
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

/** Grava campos e devolve o cadastro novo (a API do plano). Veja `escreverCadastro`. */
export async function gravarCampos(
  id: number, mudancas: Partial<Record<string, string>>, por: string, fonte: Fonte, agora: string = new Date().toISOString(),
): Promise<Cadastro> {
  return (await escreverCadastro(id, mudancas, por, fonte, agora)).cad;
}

// ── Resposta das rotas ───────────────────────────────────────────────────────

export interface VistaCadastro {
  campos: Partial<Record<Campo, CampoGravado>>;
  /** Os mesmos campos só com o texto, para a tela preencher o formulário sem desmontar `campos`. */
  valores: Partial<Record<Campo, string>>;
  faltando: Campo[];
  tipo: Tipo;
}
export function vistaDe(c: Cadastro): VistaCadastro {
  const valores: Partial<Record<Campo, string>> = {};
  for (const k of CAMPOS) { const g = c.campos[k]; if (g) valores[k] = g.valor; }
  return { campos: c.campos, valores, faltando: faltando(c), tipo: tipoDoCadastro(c) };
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
