// ─────────────────────────────────────────────────────────────────────────────
// FICHA DO CLIENTE (eletroposto) e OBRAS do eletroposto no /gerador.
//
// Módulo PURO (sem rede, sem banco, sem relógio): quem chama passa os cards, os
// registros já lidos e o instante.
//
// A linha é o CARD VENDIDO de eletroposto: `agendamentos.status = 'fechou'` e
// `created_by` com a palavra "eletroposto" (a mesma regra do CRM, da Agenda e do
// dashboard: `ehOrigemEletroposto`). O dono da venda é `vendedor_nome` do card, o
// mesmo campo que o ranking credita; a ficha NÃO tem um segundo "consultor".
//
// O que mora onde (nunca em dois lugares):
//   - card da agenda ........ nome, telefone, cidade, consultor (pré-preenchimento)
//   - `pos_venda:<id>` ....... modelo, valor, vendido em, etapa, previsto, responsável
//   - `cliente_ep:<id>` ...... o resto da ficha (mesmo formato do Solar, RegistroGestao)
// Os campos do pós-venda aparecem na ficha SÓ DE LEITURA ("Edita em Obras").
//
// DINHEIRO é só de sócio: valor, forma de pagamento, entrada, financiamento e
// banco. O consultor nem recebe a coluna: as funções `*Para` só iteram o que o
// papel pode ver.
// ─────────────────────────────────────────────────────────────────────────────
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { ETAPAS_POS_VENDA, MODELOS_POS_VENDA, ROTULO_MODELO, trilhoDoModelo, type PosVenda } from '../agenda/posVendaEletroposto';
import {
  normalizarDaPlanilha, validarValor, preenchida, numeroBR,
  type Coluna, type Valor, type Validado, type Progresso, type RegistroGestao, type LinhaGestao,
} from './gestaoClientes';
import { podeVer } from './solarObras';

export const PREFIXO_FICHA_EP = 'cliente_ep:';
export const chaveFichaEp = (id: number): string => `${PREFIXO_FICHA_EP}${id}`;
export const idDaChaveFichaEp = (chave: string): number => Number(chave.slice(PREFIXO_FICHA_EP.length));

export const DICA_POS_VENDA = 'Edita em Obras';

// ── Card vendido ─────────────────────────────────────────────────────────────

export interface CardVendido {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  cidade: string | null;
  vendedor_nome: string | null;
  created_by: string | null;
  status: string | null;
  created_at: string | null;
}

/** É venda de eletroposto: card `fechou` cuja origem (`created_by`) tem a palavra "eletroposto". */
export function ehCardVendidoEp(c: Partial<CardVendido> | null | undefined): c is CardVendido {
  return !!c && Number.isInteger(c.id) && (c.id as number) > 0
    && String(c.status ?? '').trim().toLowerCase() === 'fechou'
    && ehOrigemEletroposto(c.created_by);
}

// ── Catálogo ─────────────────────────────────────────────────────────────────

export interface ColunaFicha extends Coluna {
  /** Texto curto que a tela mostra junto de uma coluna que não se edita aqui. */
  dica?: string;
}
type Fonte = 'campo' | 'card' | 'pos_venda';
interface DefFicha {
  col: ColunaFicha;
  fonte: Fonte;
  /** Fonte `card`: o texto do card que pré-preenche. */
  semente?: (c: CardVendido) => string;
  /** Fonte `pos_venda`: o valor lido do registro. */
  doPosVenda?: (p: PosVenda | null) => Valor;
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const SIM_NAO = ['Sim', 'Não'];
// Opções ESCRITAS. Lista aberta nunca deriva opção dos cards de outras pessoas: o consultor receberia dado alheio.
const OPC_CONCESSIONARIA = ['Cemig', 'Equatorial'];
const OPC_FORMA_PAGTO = ['Pix', 'Transferência', 'Boleto', 'Cartão', 'Financiamento'];

export const GRUPOS_FICHA = ['Venda', 'Cliente', 'Local do ponto', 'Negócio', 'Datas', 'Observação'] as const;

interface Opcoes {
  socio?: boolean;
  obrigatoria?: boolean;
  opcoes?: string[];
  livre?: boolean;
  fonte?: Fonte;
  semente?: (c: CardVendido) => string;
  doPosVenda?: (p: PosVenda | null) => Valor;
}
function d(chave: string, rotulo: string, tipo: Coluna['tipo'], grupo: string, o: Opcoes = {}): DefFicha {
  const fonte: Fonte = o.fonte ?? 'campo';
  const col: ColunaFicha = {
    chave, rotulo, tipo, grupo,
    quem_ve: o.socio ? 'socio' : 'todos',
    calculada: false,
    obrigatoria: !!o.obrigatoria && fonte !== 'pos_venda',
    editavel: fonte === 'campo' || (fonte === 'card' && chave !== 'consultor'),
  };
  if (tipo === 'lista') { col.opcoes = [...(o.opcoes ?? [])]; col.livre = !!o.livre; }
  if (fonte === 'pos_venda') col.dica = DICA_POS_VENDA;
  return { col, fonte, semente: o.semente, doPosVenda: o.doPosVenda };
}

const rotuloModelo = (p: PosVenda | null): Valor => (p && p.modelo ? (ROTULO_MODELO[p.modelo] ?? p.modelo) : null);

const DEFS: DefFicha[] = [
  // Venda: tudo daqui é lido de outro lugar
  d('consultor', 'Consultor', 'texto', 'Venda', { fonte: 'card', semente: (c) => String(c.vendedor_nome ?? '') }),
  d('modelo', 'Modelo da venda', 'texto', 'Venda', { fonte: 'pos_venda', doPosVenda: rotuloModelo }),
  d('valor', 'Valor da venda', 'dinheiro', 'Venda', { fonte: 'pos_venda', socio: true, doPosVenda: (p) => (p && typeof p.valor === 'number' ? p.valor : null) }),
  d('vendido_em', 'Vendido em', 'data', 'Venda', { fonte: 'pos_venda', doPosVenda: (p) => (p && p.vendido_em ? p.vendido_em : null) }),
  d('etapa', 'Etapa da obra', 'texto', 'Venda', { fonte: 'pos_venda', doPosVenda: (p) => (p && p.etapa ? (ETAPAS_POS_VENDA[p.etapa]?.rotulo ?? p.etapa) : null) }),
  d('previsto', 'Previsto para a etapa', 'data', 'Venda', { fonte: 'pos_venda', doPosVenda: (p) => (p && p.previsto ? p.previsto : null) }),
  d('responsavel', 'Responsável', 'texto', 'Venda', { fonte: 'pos_venda', doPosVenda: (p) => (p && p.responsavel ? p.responsavel : null) }),
  // Cliente
  d('cliente', 'Nome ou razão social', 'texto', 'Cliente', { obrigatoria: true, fonte: 'card', semente: (c) => String(c.cliente_nome ?? '') }),
  d('cpf_cnpj', 'CPF ou CNPJ', 'texto', 'Cliente', { obrigatoria: true }),
  d('rg_ie', 'RG ou inscrição estadual', 'texto', 'Cliente'),
  d('contato', 'Telefone', 'telefone', 'Cliente', { obrigatoria: true, fonte: 'card', semente: (c) => String(c.cliente_telefone ?? '') }),
  d('email', 'E-mail', 'texto', 'Cliente'),
  d('endereco', 'Endereço', 'texto', 'Cliente', { obrigatoria: true }),
  d('cep', 'CEP', 'texto', 'Cliente', { obrigatoria: true }),
  d('cidade', 'Cidade', 'texto', 'Cliente', { obrigatoria: true, fonte: 'card', semente: (c) => String(c.cidade ?? '') }),
  d('uf', 'UF', 'lista', 'Cliente', { obrigatoria: true, opcoes: UFS }),
  // Local do ponto
  d('endereco_ponto', 'Endereço do ponto', 'texto', 'Local do ponto', { obrigatoria: true }),
  d('unidade_consumidora', 'Unidade consumidora', 'texto', 'Local do ponto', { obrigatoria: true }),
  d('concessionaria', 'Concessionária', 'lista', 'Local do ponto', { obrigatoria: true, opcoes: OPC_CONCESSIONARIA, livre: true }),
  d('titular_conta', 'Titular da conta de luz', 'texto', 'Local do ponto'),
  d('trifasico', 'Tem rede trifásica', 'lista', 'Local do ponto', { obrigatoria: true, opcoes: SIM_NAO }),
  // Negócio
  d('equipamento', 'Equipamento', 'lista', 'Negócio', { obrigatoria: true, opcoes: [], livre: true }),
  d('qtd_carregadores', 'Qtd. de carregadores', 'inteiro', 'Negócio', { obrigatoria: true }),
  d('qtd_plugs', 'Qtd. de plugs', 'inteiro', 'Negócio'),
  d('potencia_kw', 'Potência (kW)', 'numero', 'Negócio', { obrigatoria: true }),
  d('forma_pagto', 'Forma de pagamento', 'lista', 'Negócio', { socio: true, opcoes: OPC_FORMA_PAGTO, livre: true }),
  d('entrada', 'Entrada', 'dinheiro', 'Negócio', { socio: true }),
  d('financiamento', 'Tem financiamento', 'lista', 'Negócio', { socio: true, opcoes: SIM_NAO }),
  d('banco', 'Banco do financiamento', 'texto', 'Negócio', { socio: true }),
  // Datas
  d('contrato_assinado_em', 'Contrato assinado em', 'data', 'Datas', { obrigatoria: true }),
  d('instalacao_em', 'Instalação', 'data', 'Datas'),
  d('vistoria_em', 'Vistoria', 'data', 'Datas'),
  d('homologacao_em', 'Homologação', 'data', 'Datas'),
  d('ativacao_em', 'Ativação', 'data', 'Datas'),
  // Observação (a chave `obs` é a única que guarda quebra de linha: veja `textoLimpo`)
  d('obs', 'Observação', 'texto', 'Observação'),
];
const POR_CHAVE = new Map(DEFS.map((x) => [x.col.chave, x]));

/** Colunas que o papel enxerga. Consultor nem recebe as de sócio. */
export function colunasFichaPara(socio: boolean): ColunaFicha[] {
  return DEFS.filter((x) => socio || x.col.quem_ve === 'todos')
    .map((x) => (x.col.opcoes ? { ...x.col, opcoes: [...x.col.opcoes] } : { ...x.col }));
}
export function gruposFichaPara(colunas: ColunaFicha[]): string[] {
  const presentes = new Set(colunas.map((c) => c.grupo));
  return GRUPOS_FICHA.filter((g) => presentes.has(g));
}
export function definicaoFicha(chave: string): { col: ColunaFicha; fonte: Fonte } | null {
  const x = POR_CHAVE.get(chave);
  return x ? { col: x.col, fonte: x.fonte } : null;
}

// ── Células ──────────────────────────────────────────────────────────────────

export interface CelulaFicha {
  valor: Valor;
  origem: 'sistema' | 'card' | 'pos_venda' | 'vazio';
  por?: string;
  em?: string;
  dica?: string;
}

/** Normaliza o `value` do pós-venda (pode vir torto) para o formato fixo. null = nunca registrado. */
export function lerPosVenda(value: unknown): PosVenda | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const s = (x: unknown): string => (typeof x === 'string' ? x : '');
  return {
    modelo: s(v.modelo),
    valor: typeof v.valor === 'number' && Number.isFinite(v.valor) ? v.valor : null,
    vendido_em: s(v.vendido_em),
    etapa: s(v.etapa),
    etapa_desde: s(v.etapa_desde),
    previsto: typeof v.previsto === 'string' && v.previsto ? v.previsto : null,
    responsavel: s(v.responsavel),
    obs: s(v.obs),
    por: s(v.por),
    em: s(v.em),
  };
}

function celulaDeDef(x: DefFicha, card: CardVendido, reg: RegistroGestao | undefined, pv: PosVenda | null): CelulaFicha {
  if (x.fonte === 'pos_venda') {
    return { valor: x.doPosVenda ? x.doPosVenda(pv) : null, origem: 'pos_venda', dica: DICA_POS_VENDA };
  }
  const s = x.col.editavel ? reg?.campos[x.col.chave] : undefined;
  if (s) return { valor: s.valor, origem: 'sistema', por: s.por, em: s.em };
  if (x.fonte === 'card') {
    const bruto = x.semente ? x.semente(card) : '';
    return { valor: normalizarDaPlanilha(x.col, bruto), origem: 'card' };
  }
  return { valor: null, origem: 'vazio' };
}

export function celulaFicha(chave: string, card: CardVendido, reg: RegistroGestao | undefined, pv: PosVenda | null): CelulaFicha | null {
  const x = POR_CHAVE.get(chave);
  return x ? celulaDeDef(x, card, reg, pv) : null;
}

const preenchidaF = (c: CelulaFicha | undefined): boolean => preenchida(c as never);

export function progressoFicha(colunas: ColunaFicha[], celulas: Record<string, CelulaFicha>): Progresso {
  let total = 0;
  let preenchidas = 0;
  for (const c of colunas) {
    if (!c.obrigatoria) continue;
    total++;
    if (preenchidaF(celulas[c.chave])) preenchidas++;
  }
  return { preenchidas, total, faltando: total - preenchidas };
}

export interface LinhaFicha extends Omit<LinhaGestao, 'celulas'> { celulas: Record<string, CelulaFicha> }

/** Linhas visíveis ao papel. O consultor só recebe os cards dele. */
export function montarFicha(
  cards: CardVendido[],
  fichas: Map<number, RegistroGestao>,
  posVendas: Map<number, unknown>,
  nome: string,
  socio: boolean,
): { colunas: ColunaFicha[]; linhas: LinhaFicha[] } {
  const colunas = colunasFichaPara(socio);
  const defs = colunas.map((c) => POR_CHAVE.get(c.chave) as DefFicha);
  const linhas: LinhaFicha[] = [];
  for (const card of [...cards].sort((a, b) => b.id - a.id)) {
    if (!ehCardVendidoEp(card)) continue;
    if (!(socio || podeVer(nome, String(card.vendedor_nome ?? '')))) continue;
    const reg = fichas.get(card.id);
    const pv = lerPosVenda(posVendas.get(card.id));
    const celulas: Record<string, CelulaFicha> = {};
    for (const x of defs) celulas[x.col.chave] = celulaDeDef(x, card, reg, pv);
    const cli = celulas.cliente?.valor;
    linhas.push({
      codigo: String(card.id),
      cliente: typeof cli === 'string' ? cli : String(card.cliente_nome ?? ''),
      consultor: String(card.vendedor_nome ?? ''),
      celulas,
      progresso: progressoFicha(colunas, celulas),
    });
  }
  return { colunas, linhas };
}

// ── Validação do que o usuário digita ────────────────────────────────────────

const soDigitos = (t: string): string => t.replace(/\D/g, '');

/**
 * `validarValor` do Solar cobre o tipo da coluna; estas colunas de texto têm formato próprio.
 * Vazio apaga a sobrescrita (volta o que o card trouxe). Os tipos continuam os 7 que a tela já conhece.
 */
export function validarCampoFicha(col: ColunaFicha, bruto: unknown): Validado {
  const vazio = bruto == null || (typeof bruto === 'string' && bruto.trim() === '');
  if (!vazio && typeof bruto === 'string') {
    const t = bruto.trim();
    if (col.chave === 'cpf_cnpj') {
      const dg = soDigitos(t);
      if (dg.length === 11) return validarValor(col, `${dg.slice(0, 3)}.${dg.slice(3, 6)}.${dg.slice(6, 9)}-${dg.slice(9)}`);
      if (dg.length === 14) return validarValor(col, `${dg.slice(0, 2)}.${dg.slice(2, 5)}.${dg.slice(5, 8)}/${dg.slice(8, 12)}-${dg.slice(12)}`);
      return { ok: false, erro: 'CPF com 11 dígitos ou CNPJ com 14.' };
    }
    if (col.chave === 'cep') {
      const dg = soDigitos(t);
      return dg.length === 8 ? validarValor(col, `${dg.slice(0, 5)}-${dg.slice(5)}`) : { ok: false, erro: 'CEP com 8 dígitos.' };
    }
    if (col.chave === 'email') {
      const e = t.toLowerCase();
      return e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? validarValor(col, e) : { ok: false, erro: 'E-mail inválido.' };
    }
  }
  return validarValor(col, bruto);
}

// ── Obras ────────────────────────────────────────────────────────────────────

export interface EtapaObra { chave: string; rotulo: string; dono: string; prazo_dias: number | null }
export interface ObraEp {
  id: number;
  cliente: string;
  cidade: string;
  consultor: string;
  modelo: string;
  modelo_rotulo: string;
  etapa: string;
  etapa_rotulo: string;
  etapa_desde: string | null;
  etapas: EtapaObra[];
  feitas: number;
  total: number;
  previsto: string | null;
  atrasado: boolean;
  responsavel: string;
  obs: string;
  vendido_em: string | null;
  /** Em reais. SÓ na resposta do sócio: a chave nem existe para o consultor. */
  valor?: number | null;
  em: string | null;
  falta_informar: boolean;
  concluido: boolean;
}

/**
 * Progresso no mesmo cálculo do `PosVenda.resumo` (pos-venda.js): feitas é a posição na trilha menos 1, ou todas se
 * a etapa for `concluido` num modelo definido. Sem registro, sem modelo ou com etapa fora da trilha: 0 de total (o
 * modelo vazio tem a trilha de 1 etapa) e `falta_informar`. Nunca negativo.
 */
export function progressoObra(p: PosVenda | null): { feitas: number; total: number; falta_informar: boolean; concluido: boolean } {
  const modelo = p ? p.modelo : '';
  const trilha = trilhoDoModelo(modelo);
  const total = trilha.length;
  const concluido = !!(p && modelo && p.etapa === 'concluido');
  const idx = p ? trilha.indexOf(p.etapa) : -1;
  return { feitas: concluido ? total : Math.max(0, idx), total, falta_informar: !p || !modelo, concluido };
}

export function montarObra(card: CardVendido, pvBruto: unknown, hoje: string, socio = false): ObraEp {
  const p = lerPosVenda(pvBruto);
  const modelo = p ? p.modelo : '';
  const pr = progressoObra(p);
  const previsto = p && p.previsto ? p.previsto : null;
  const etapa = p ? p.etapa : '';
  const obra: ObraEp = {
    id: card.id,
    cliente: String(card.cliente_nome ?? ''),
    cidade: String(card.cidade ?? ''),
    consultor: String(card.vendedor_nome ?? ''),
    modelo,
    modelo_rotulo: modelo ? (ROTULO_MODELO[modelo] ?? modelo) : 'Modelo a confirmar',
    etapa,
    etapa_rotulo: etapa ? (ETAPAS_POS_VENDA[etapa]?.rotulo ?? etapa) : '',
    etapa_desde: p && p.etapa_desde ? p.etapa_desde : null,
    etapas: trilhoDoModelo(modelo).map((chave) => ({
      chave,
      rotulo: ETAPAS_POS_VENDA[chave]?.rotulo ?? chave,
      dono: ETAPAS_POS_VENDA[chave]?.dono ?? 'nos',
      prazo_dias: ETAPAS_POS_VENDA[chave]?.prazo_dias ?? null,
    })),
    feitas: pr.feitas,
    total: pr.total,
    previsto,
    // Como a tela: previsto antes de hoje (em Brasília) e a obra ainda não concluída.
    atrasado: !!previsto && !pr.concluido && etapa !== 'concluido' && previsto.slice(0, 10) < hoje,
    responsavel: p ? p.responsavel : '',
    obs: p ? p.obs : '',
    vendido_em: p && p.vendido_em ? p.vendido_em : null,
    em: p && p.em ? p.em : null,
    falta_informar: pr.falta_informar,
    concluido: pr.concluido,
  };
  if (socio) obra.valor = p && typeof p.valor === 'number' ? p.valor : null;
  return obra;
}

/** Obras que o papel vê: atrasadas primeiro, depois em andamento pela data prevista, concluídas por último. */
export function montarObras(
  cards: CardVendido[], posVendas: Map<number, unknown>, nome: string, socio: boolean, hoje: string,
): ObraEp[] {
  const obras: ObraEp[] = [];
  for (const card of cards) {
    if (!ehCardVendidoEp(card)) continue;
    if (!(socio || podeVer(nome, String(card.vendedor_nome ?? '')))) continue;
    obras.push(montarObra(card, posVendas.get(card.id), hoje, socio));
  }
  const grupo = (o: ObraEp): number => (o.concluido ? 2 : o.atrasado ? 0 : 1);
  return obras.sort((a, b) =>
    grupo(a) - grupo(b)
    || (a.previsto ?? '9999-99-99').localeCompare(b.previsto ?? '9999-99-99')
    || b.id - a.id);
}

/** Os 6 modelos de venda, para a tela de Obras escolher. */
export const MODELOS_OBRA: Array<{ chave: string; rotulo: string }> =
  MODELOS_POS_VENDA.map((chave) => ({ chave, rotulo: ROTULO_MODELO[chave] }));

/**
 * Campos que a rota de Obras aceita. `por` NUNCA entra: vem do token. `modelo` é de toda a equipe (só os 6 modelos);
 * `valor` e `vendido_em` são só de sócio (a rota responde 403 ao consultor que os mandar).
 */
const CAMPOS_OBRA = ['etapa', 'previsto', 'responsavel', 'obs', 'modelo'] as const;
const CAMPOS_SO_SOCIO = ['valor', 'vendido_em'] as const;

export type EntradaObra =
  | { ok: true; id: number; baseEm: string; entrada: Record<string, unknown>; soSocio: boolean }
  | { ok: false; erro: string };

/** Valor em reais: número ou texto brasileiro ("1.234,56"), a mesma régua da Gestão. Vazio ou null limpa. */
export function lerValorObra(bruto: unknown): { ok: true; valor: number | null } | { ok: false } {
  if (bruto === null || (typeof bruto === 'string' && bruto.trim() === '')) return { ok: true, valor: null };
  if (typeof bruto !== 'number' && typeof bruto !== 'string') return { ok: false };
  const n = numeroBR(bruto);
  return n === null ? { ok: false } : { ok: true, valor: n };
}

export function lerEntradaObra(corpo: unknown): EntradaObra {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false, erro: 'corpo_invalido' };
  const b = corpo as Record<string, unknown>;
  const idTxt = typeof b.id === 'number' ? String(b.id) : typeof b.id === 'string' ? b.id.trim() : '';
  if (!/^\d{1,12}$/.test(idTxt) || Number(idTxt) <= 0) return { ok: false, erro: 'id_invalido' };
  const baseEm = typeof b.base_em === 'string' ? b.base_em : '';
  if (!baseEm || !Number.isFinite(Date.parse(baseEm)) || new Date(baseEm).toISOString() !== baseEm) {
    return { ok: false, erro: 'base_em_invalido' };
  }
  if (b.modelo !== undefined && !(typeof b.modelo === 'string' && (MODELOS_POS_VENDA as readonly string[]).includes(b.modelo))) {
    return { ok: false, erro: 'modelo_invalido' };
  }
  const entrada: Record<string, unknown> = {};
  for (const k of CAMPOS_OBRA) if (b[k] !== undefined) entrada[k] = b[k];
  let soSocio = false;
  for (const k of CAMPOS_SO_SOCIO) if (b[k] !== undefined) { entrada[k] = b[k]; soSocio = true; }
  if (!Object.keys(entrada).length) return { ok: false, erro: 'nada_a_gravar' };
  return { ok: true, id: Number(idTxt), baseEm, entrada, soSocio };
}

/**
 * O registro foi gravado por OUTRA pessoa depois da leitura de quem pede? A mesma pessoa em duas abas não conflita
 * (a regra da ficha). Nomes comparados sem caixa. Datas inválidas ou ausentes não contam como conflito.
 * A corrida real (duas gravações no mesmo instante) continua coberta pelo compare-and-swap no `updated_at`.
 */
export function houveConflitoObra(atual: PosVenda | null, baseEm: string, por: string): boolean {
  if (!atual || !atual.em) return false;
  if (atual.por.trim().toLowerCase() === por.trim().toLowerCase() && por.trim() !== '') return false;
  const a = Date.parse(atual.em);
  return Number.isFinite(a) && a > Date.parse(baseEm);
}
