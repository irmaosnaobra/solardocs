// Raio-X da Trilha do Parceiro NEXUS: chaves fixas, validação (front e api usam as MESMAS chaves), nota e faltas.
// Função pura: sem banco, sem relógio. A conferência de cliente_id (pertence ao usuário?) é do repositório.

import { UFS } from './procura';

export const OPCOES = Object.freeze({
  anos_solar: ['0-1', '1-3', '3-5', '5+'],
  usinas: ['0-20', '20-100', '100-500', '500+'],
  equipe: ['1-2', '3-5', '6-15', '16+'],
  capacidades: ['eletrica_bt', 'eletrica_mt', 'engenharia_art', 'obra_civil', 'homologacao'],
  ja_montou_eletroposto: ['nunca', '1-2', '3+'],
  conhece_mercado: ['nada', 'pouco', 'bem'],
  papel: ['revenda', 'montagem', 'ambos'],
  quando: ['agora', '3m', '6m', 'sem_pressa'],
  dificuldades: ['cliente', 'preco', 'financiamento', 'tecnica', 'homologacao', 'tempo', 'outra'],
  tipo_local: ['posto', 'hotel', 'shopping', 'condominio', 'empresa_frota', 'restaurante', 'estacionamento', 'outro'],
  fase: ['ideia', 'conversando', 'quente'],
} as const);

export const CHAVES_RAIO_X = [
  'anos_solar', 'usinas', 'equipe', 'raio_km', 'capacidades', 'ja_montou_eletroposto', 'conhece_mercado', 'papel', 'quando',
  'dificuldades', 'clientes_em_vista', 'demanda_12m', 'simulacao',
] as const;

/** Pesos da nota (soma 100). Sem nenhum cliente em vista o máximo é 80. */
export const PESOS = Object.freeze({
  empresa: 10, experiencia: 15, capacidades: 10, mercado: 15, dificuldades: 5, carteira_1: 15, carteira_2: 20, demanda: 10, simulacao: 15,
});
export const NOTA_MINIMA = 80;
export const MAX_DIFICULDADES = 3;
export const MAX_CLIENTES_EM_VISTA = 10;

export interface ClienteEmVista {
  cliente_id?: string;
  nome: string;
  cidade: string;
  uf: string;
  tipo_local: string;
  fase: string;
}

export type Respostas = Record<string, unknown>;
export type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string; campo?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const noConjunto = (lista: readonly string[], v: unknown): v is string => typeof v === 'string' && lista.includes(v);
const numeroEntre = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s === '' ? null : s;
};

function listaDe(lista: readonly string[], v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const vistos = new Set<string>();
  for (const x of v) {
    if (!noConjunto(lista, x)) return null;
    vistos.add(x);
  }
  return [...vistos];
}

function clientesDe(v: unknown): ClienteEmVista[] | null {
  if (!Array.isArray(v) || v.length > MAX_CLIENTES_EM_VISTA) return null;
  const out: ClienteEmVista[] = [];
  for (const x of v) {
    if (!ehObjeto(x)) return null;
    const nome = texto(x.nome, 120);
    const cidade = texto(x.cidade, 80);
    const uf = typeof x.uf === 'string' ? x.uf.trim().toUpperCase() : '';
    if (!nome || !cidade || !UFS.includes(uf)) return null;
    if (!noConjunto(OPCOES.tipo_local, x.tipo_local) || !noConjunto(OPCOES.fase, x.fase)) return null;
    const c: ClienteEmVista = { nome, cidade, uf, tipo_local: x.tipo_local, fase: x.fase };
    if (x.cliente_id !== undefined && x.cliente_id !== null) {
      if (typeof x.cliente_id !== 'string' || !UUID.test(x.cliente_id)) return null;
      c.cliente_id = x.cliente_id.toLowerCase();
    }
    out.push(c);
  }
  return out;
}

function simulacaoDe(v: unknown): Record<string, unknown> | null {
  if (!ehObjeto(v)) return null;
  const permitidas = ['tipo_local', 'modelo', 'kwh_mes', 'preco_kwh', 'resultado'];
  if (Object.keys(v).some((k) => !permitidas.includes(k))) return null;
  const kwh = numeroEntre(v.kwh_mes, 0, 10_000_000);
  const preco = v.preco_kwh === undefined ? 0 : numeroEntre(v.preco_kwh, 0, 100);
  const modelo = texto(v.modelo, 60);
  if (kwh === null || preco === null || !modelo || !noConjunto(OPCOES.tipo_local, v.tipo_local)) return null;
  let resultado: Record<string, unknown> = {};
  if (v.resultado !== undefined) {
    if (!ehObjeto(v.resultado) || JSON.stringify(v.resultado).length > 4000) return null;
    resultado = v.resultado;
  }
  return { tipo_local: v.tipo_local, modelo, kwh_mes: kwh, preco_kwh: preco, resultado };
}

/** Valida UM valor de UMA chave. */
function valorDe(chave: string, v: unknown): unknown | null {
  switch (chave) {
    case 'anos_solar': case 'usinas': case 'equipe': case 'ja_montou_eletroposto': case 'conhece_mercado': case 'papel': case 'quando':
      return noConjunto(OPCOES[chave], v) ? v : null;
    case 'raio_km': return numeroEntre(v, 10, 500) !== null && Number.isInteger(v) ? v : null;
    case 'demanda_12m': return numeroEntre(v, 0, 200) !== null && Number.isInteger(v) ? v : null;
    case 'capacidades': return listaDe(OPCOES.capacidades, v, OPCOES.capacidades.length);
    case 'dificuldades': return listaDe(OPCOES.dificuldades, v, MAX_DIFICULDADES);
    case 'clientes_em_vista': return clientesDe(v);
    case 'simulacao': return simulacaoDe(v);
    default: return null;
  }
}

/**
 * Valida as respostas (parciais). Chave fora da lista é recusada, e valor fora do permitido também: nada é "limpo em silêncio".
 * Devolve só o que veio, já normalizado.
 */
export function validarRespostas(corpo: unknown): Resultado<Respostas> {
  if (!ehObjeto(corpo)) return { ok: false, erro: 'respostas_invalidas' };
  const out: Respostas = {};
  for (const [chave, bruto] of Object.entries(corpo)) {
    if (!(CHAVES_RAIO_X as readonly string[]).includes(chave)) return { ok: false, erro: 'chave_desconhecida', campo: chave };
    const v = valorDe(chave, bruto);
    if (v === null) return { ok: false, erro: 'valor_invalido', campo: chave };
    out[chave] = v;
  }
  return { ok: true, valor: out };
}

/** Os cliente_id citados nas respostas (para o repositório conferir se são do próprio usuário). */
export function idsDeClientes(r: Respostas): string[] {
  const lista = Array.isArray(r.clientes_em_vista) ? (r.clientes_em_vista as ClienteEmVista[]) : [];
  return [...new Set(lista.map((c) => c.cliente_id).filter((x): x is string => !!x))];
}

export interface EmpresaDoSolarDoc {
  cnpj: string | null;
  cidade: string | null;
  uf: string | null;
  tem_logo: boolean;
}

export interface Falta {
  item: string;
  pontos: number;
  texto: string;
}

const preenchido = (v: unknown): boolean => v !== undefined && v !== null && v !== '';
const tamanho = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Nota de 0 a 100 e o que falta. `faltas[].pontos` é quanto ainda dá para ganhar com aquele item. */
export function calcularNota(r: Respostas, e: EmpresaDoSolarDoc): { nota: number; passou: boolean; faltas: Falta[] } {
  let nota = 0;
  const faltas: Falta[] = [];
  const grupo = (item: string, pontos: number, completo: boolean, textoFalta: string): void => {
    if (completo) nota += pontos; else faltas.push({ item, pontos, texto: textoFalta });
  };

  const semEmpresa = [!e.cnpj && 'CNPJ', !(e.cidade && e.uf) && 'cidade e UF', !e.tem_logo && 'logo'].filter(Boolean);
  grupo('empresa', PESOS.empresa, semEmpresa.length === 0, `Completar no cadastro: ${semEmpresa.join(', ')}`);

  const semExp = ['anos_solar', 'usinas', 'equipe', 'raio_km'].filter((k) => !preenchido(r[k]));
  grupo('experiencia', PESOS.experiencia, semExp.length === 0, 'Responder anos no solar, usinas, equipe e raio de atendimento');
  grupo('capacidades', PESOS.capacidades, tamanho(r.capacidades) >= 1, 'Marcar ao menos uma capacidade');
  const semMercado = ['ja_montou_eletroposto', 'conhece_mercado', 'papel', 'quando'].filter((k) => !preenchido(r[k]));
  grupo('mercado', PESOS.mercado, semMercado.length === 0, 'Responder sobre o mercado de eletroposto');
  grupo('dificuldades', PESOS.dificuldades, tamanho(r.dificuldades) >= 1, 'Marcar ao menos uma dificuldade');

  const clientes = tamanho(r.clientes_em_vista);
  if (clientes >= 2) nota += PESOS.carteira_2;
  else {
    nota += clientes === 1 ? PESOS.carteira_1 : 0;
    faltas.push({
      item: 'carteira',
      pontos: PESOS.carteira_2 - (clientes === 1 ? PESOS.carteira_1 : 0),
      texto: clientes === 1 ? 'Adicionar mais um cliente em vista' : 'Adicionar ao menos um cliente em vista',
    });
  }

  grupo('demanda', PESOS.demanda, Number(r.demanda_12m) > 0, 'Estimar a demanda de carregadores em 12 meses');
  const sim = ehObjeto(r.simulacao) ? r.simulacao : null;
  grupo('simulacao', PESOS.simulacao, !!sim && Number(sim.kwh_mes) > 0, 'Fazer a simulação com o consumo mensal');

  return { nota, passou: nota >= NOTA_MINIMA, faltas };
}
