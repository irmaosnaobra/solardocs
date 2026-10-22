// ─────────────────────────────────────────────────────────────────────────────
// GESTÃO DE CLIENTES (solar): a Planilha Mestre vira uma GRADE editável, uma
// linha por venda e uma coluna por informação.
//
// Módulo PURO (sem rede, sem banco, sem relógio): quem chama passa o CSV, os
// registros já lidos e o instante. A planilha segue sendo a BASE; o que se
// preenche no sistema mora em `system_state` (chave `gestao_cliente:<NNNN>`) e
// vale POR CIMA dela, campo a campo.
//
// DINHEIRO. `lerPlanilha` (solarObras.ts) tem lista branca e nunca vê custo ou
// lucro. Este módulo lê a linha INTEIRA, de propósito: quem corta é o PAPEL.
// `quem_ve: 'socio'` não sai em lugar nenhum da resposta de consultor (nem no
// catálogo, nem nas células, nem em mensagem de erro): as funções `*Para`
// recebem o papel e só iteram as colunas visíveis dele.
// ─────────────────────────────────────────────────────────────────────────────
import { parseCSV } from '../insightsService';
import { chaveTexto, codigoCanonico, podeVer, parseDataBR, type ObraBruta } from './solarObras';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type TipoColuna = 'texto' | 'data' | 'dinheiro' | 'inteiro' | 'numero' | 'telefone' | 'lista';
export type QuemVe = 'todos' | 'socio';
export type Valor = string | number | null;

export interface Coluna {
  chave: string;
  rotulo: string;
  tipo: TipoColuna;
  /** Só em lista. */
  opcoes?: string[];
  /** Só em lista: aceita texto fora das opções ("Outro"). */
  livre?: boolean;
  grupo: string;
  quem_ve: QuemVe;
  calculada: boolean;
  obrigatoria: boolean;
  /** Pode ser gravada por quem pede (calculada, código e, para consultor, a coluna CONSULTOR não podem). */
  editavel: boolean;
}
/** Coluna com a posição no cabeçalho da planilha (não sai na resposta). */
export interface ColunaInterna extends Coluna { indice: number }

export interface Celula {
  valor: Valor;
  /** `gerador` (fase 2): o valor vem do card, da proposta ou do cadastro (a linha que o /gerador monta), não da planilha. */
  origem: 'planilha' | 'sistema' | 'gerador';
  por?: string;
  em?: string;
  /** Só leitura nesta linha: o valor vem da fonte (o cadastro do card) e não se grava por cima. */
  fixa?: true;
}

export interface CampoSistema { valor: Valor; por: string; em: string }
export interface Alteracao { em: string; por: string; coluna: string; antes: Valor }
export interface RegistroGestao {
  campos: Record<string, CampoSistema>;
  alteracoes: Alteracao[];
  em: string | null;
}

export interface Grade {
  cabecalho: string[];
  vendas: Array<{ codigo: string; celulas: string[] }>;
}

export const GRUPOS = [
  'Venda', 'Projeto', 'Equipamento', 'Material', 'Instalação', 'Vistoria e liberação', 'Financeiro', 'Custos da obra',
] as const;
export const GRUPO_OUTROS = 'Outros';
const ORDEM_GRUPO: Record<string, number> = Object.fromEntries(
  [...GRUPOS, GRUPO_OUTROS].map((g, i) => [g, i]),
);

export const PREFIXO_GESTAO = 'gestao_cliente:';
export const MAX_ALTERACOES = 50;
export const MAX_TEXTO = 300;

/** `#57` e `#0057` são a mesma venda e o mesmo registro. */
export function chaveGestao(codigo: string): string {
  return `${PREFIXO_GESTAO}${codigoCanonico(codigo).replace(/\D/g, '')}`;
}
export function codigoDaChave(chave: string): string {
  return codigoCanonico(chave.slice(PREFIXO_GESTAO.length));
}

// ── Catálogo curado ──────────────────────────────────────────────────────────

/** Nome de cabeçalho comparável: sem acento, maiúsculo, só letras, dígitos e %. */
export function nomeComparavel(s: unknown): string {
  return chaveTexto(s).replace(/[^A-Z0-9%]+/g, ' ').trim();
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const OPC_STATUS = ['Instalado', 'No cliente', 'Estoque', 'Comprar'];

/**
 * Listas com NOME DE GENTE. O consultor só recebe os valores das vendas dele (equipe e engenheiro de obra alheia
 * são dado de outra pessoa). As outras listas abertas (concessionária, tipo de estrutura, modelo...) são
 * genéricas: as opções escritas aqui valem para todos.
 */
export const LISTAS_DE_GENTE: ReadonlySet<string> = new Set(['consultor', 'engenheiro', 'equipe']);

// Opções escritas das listas abertas, na grafia que domina na Planilha Mestre (63 vendas, conferido em 14/10/2026):
// se a opção não casar com a célula antiga, toda célula antiga apareceria como quase duplicata no fim da lista.
// O que a planilha trouxer e não casar entra DEPOIS destas, sem duplicar (veja `mesclarOpcoes`).
const OPC_CONCESSIONARIA = ['Cemig', 'Equatorial'];
const OPC_EXCEDENTES = ['Liberado Normal', 'Tem Excedente', 'Fastrack', 'Excedente Cadastrado'];
const OPC_ESTRUTURA = ['Fibromadeira', 'Fibrometal', 'Solo', 'Mini Trilo'];
const OPC_MODELO_PLACA = ['Tsun 600W', 'Jetion 700W', 'Tsun 585W', 'Era 620W', 'Leapton 620W', 'Helius 610W', 'Gokin 610W', 'TCL 615W', 'Dmegc 625W'];
const OPC_MODELO_INVERSOR = ['Saj 3K', 'Saj 6K', 'MI - Saj 2,25K', 'MI - Solax 2000', 'MI - Deye 2,25K', 'MI - Solax 1,875K'];
const OPC_VOLTAGEM = ['Mono - 220', 'Bi - 220', 'Tri - 220'];
const OPC_FORMA_PAGTO = ['Pix', 'Cartão', 'Pix + Cartão', 'Finan 77SOL', 'Vista', 'Na montagem', 'Na entrega'];
const OPC_FORNECEDOR = ['Soollar', 'Shakitsun', '77Sol', 'Edeltec'];

interface Def {
  busca: string;
  chave: string;
  rotulo: string;
  tipo: TipoColuna;
  grupo: string;
  socio: boolean;
  calc: boolean;
  /** Fora da lista de obrigatórias (nem toda venda tem). */
  opcional: boolean;
  /** Lista aberta: as opções escritas vêm primeiro; os valores das linhas que não casam entram depois. */
  dinamica: boolean;
  opcoes?: string[];
}

/** flags: s = só sócio, c = calculada, n = não obrigatória, d = lista ABERTA (opções escritas, o que a planilha trouxer e "Outro"). */
function def(busca: string, chave: string, rotulo: string, tipo: TipoColuna, grupo: string, flags = '', opcoes?: string[]): Def {
  return {
    busca, chave, rotulo, tipo, grupo, opcoes,
    socio: flags.includes('s'), calc: flags.includes('c'), opcional: flags.includes('n'), dinamica: flags.includes('d'),
  };
}
const na = (nome: string, ocorrencia = 0): string => `${nomeComparavel(nome)}#${ocorrencia}`;

const DEFS: Def[] = [
  // Venda
  def(na('NOME CLIENTE'), 'cliente', 'Cliente', 'texto', 'Venda'),
  def(na('NOME HOMOLOGAÇÃO'), 'homologacao', 'Nome na homologação', 'texto', 'Venda'),
  def(na('CONSULTOR'), 'consultor', 'Consultor', 'lista', 'Venda', 'd'),
  // Só sócio: o texto cru da origem cita nome de cliente de OUTRA venda ("#0013 Cleber"); a rota de Obras também o esconde do consultor.
  def(na('ORIGEM DO LEAD'), 'origem', 'Origem do lead', 'texto', 'Venda', 's'),
  def(na('CADASTRO TRELLO'), 'cadastro_trello', 'Data da venda', 'data', 'Venda'),
  def(na('CONTATO'), 'contato', 'Telefone', 'telefone', 'Venda'),
  def(na('ENDEREÇO'), 'endereco', 'Endereço', 'texto', 'Venda'),
  def(na('CIDADE'), 'cidade', 'Cidade', 'texto', 'Venda'),
  def(na('UF'), 'uf', 'UF', 'lista', 'Venda', '', UFS),
  def(na('DEPOIMENTO INSTAGRAM'), 'depoimento', 'Depoimento no Instagram', 'lista', 'Venda', '', ['Sim', 'Pedido', 'Insatisfeito', 'Não faz']),
  def(na('OBS:'), 'obs', 'Observações', 'texto', 'Venda', 'n'),
  // Projeto
  def(na('ENGENHEIRO'), 'engenheiro', 'Engenheiro', 'lista', 'Projeto', 'd'),
  def(na('CONCESSIONARIA'), 'concessionaria', 'Concessionária', 'lista', 'Projeto', 'd', OPC_CONCESSIONARIA),
  def(na('DATA EMISSÃO ULTIMO PARECER DE ACESSO'), 'parecer_acesso', 'Parecer de acesso', 'data', 'Projeto'),
  def(na('PAGTO ART'), 'pagto_art', 'Pagamento da ART', 'texto', 'Projeto', 's'),
  def(na('VALOR ART'), 'valor_art', 'Valor da ART', 'dinheiro', 'Projeto', 's'),
  def(na('VALOR PAGO DO PROJETO'), 'valor_projeto', 'Valor pago do projeto', 'dinheiro', 'Projeto', 's'),
  def(na('EXCEDENTES'), 'excedentes', 'Excedentes', 'lista', 'Projeto', 'nd', OPC_EXCEDENTES),
  def(na('CONTRATO COOPERATIVA'), 'contrato_coop', 'Contrato de cooperativa', 'texto', 'Projeto', 'n'),
  def(na('TEMPO DE CONTRATO COOP'), 'tempo_contrato_coop', 'Tempo do contrato', 'texto', 'Projeto', 'n'),
  // Equipamento
  def(na('QTD PLACA'), 'qtd_placa', 'Qtd. de placas', 'inteiro', 'Equipamento'),
  def(na('MODELO PLACA'), 'modelo_placa', 'Modelo da placa', 'lista', 'Equipamento', 'd', OPC_MODELO_PLACA),
  def(na('POT PLACA'), 'pot_placa', 'Potência da placa (W)', 'numero', 'Equipamento'),
  def('STATUS@placa', 'status_placa', 'Status das placas', 'lista', 'Equipamento', '', OPC_STATUS),
  def(na('QTD INV'), 'qtd_inversor', 'Qtd. de inversores', 'inteiro', 'Equipamento'),
  def(na('MODELO E VOLTAGEM DO INVERSOR'), 'modelo_voltagem_inversor', 'Modelo e voltagem do inversor', 'lista', 'Equipamento', 'nd', OPC_VOLTAGEM),
  def(na('MODELO INVERSOR'), 'modelo_inversor', 'Modelo do inversor', 'lista', 'Equipamento', 'd', OPC_MODELO_INVERSOR),
  def('STATUS@inversor', 'status_inversor', 'Status do inversor', 'lista', 'Equipamento', '', OPC_STATUS),
  def(na('TIPO ESTRUTURA'), 'tipo_estrutura', 'Tipo de estrutura', 'lista', 'Equipamento', 'd', OPC_ESTRUTURA),
  def('STATUS@estrutura', 'status_estrutura', 'Status da estrutura', 'lista', 'Equipamento', '', OPC_STATUS),
  def(na('OUTRO EQUIP'), 'outro_equip', 'Outro equipamento', 'texto', 'Equipamento', 'n'),
  // Material
  def(na('ENTREGA DO MATERIAL'), 'entrega_material', 'Entrega do material', 'data', 'Material'),
  def(na('FORNECEDOR'), 'fornecedor', 'Fornecedor', 'lista', 'Material', 'sd', OPC_FORNECEDOR),
  def(na('VALOR KIT'), 'valor_kit', 'Valor do kit', 'dinheiro', 'Material', 's'),
  def(na('AC - CC'), 'ac_cc', 'AC - CC', 'dinheiro', 'Material', 's'),   // 39 de 39 células da planilha são "R$ 1.234,56" (conferido em 14/10/2026)
  // Instalação
  def(na('PREVISÃO DE MONTAGEM'), 'previsao_montagem', 'Previsão de montagem', 'data', 'Instalação'),
  def(na('DATA INICIO INSTALAÇÃO'), 'inicio_instalacao', 'Início da instalação', 'data', 'Instalação'),
  def(na('DATA FINAL INSTALAÇÃO'), 'fim_instalacao', 'Fim da instalação', 'data', 'Instalação'),
  def(na('EQUIPE'), 'equipe', 'Equipe', 'lista', 'Instalação', 'd'),
  def(na('PREVISÃO DE MONTAGEM', 1), 'previsao_montagem_2', 'Previsão de montagem (equipe)', 'data', 'Instalação', 'n'),
  def(na('INCIO INSTALAÇÃO'), 'inicio_instalacao_2', 'Início da instalação (equipe)', 'data', 'Instalação', 'n'),
  def(na('FIM INSTALAÇÃO'), 'fim_instalacao_2', 'Fim da instalação (equipe)', 'data', 'Instalação', 'n'),
  // Vistoria e liberação
  def(na('DATA PEDIDO DE VISTORIA'), 'pedido_vistoria', 'Pedido de vistoria', 'data', 'Vistoria e liberação'),
  def(na('LIBERAÇÃO VISTORIA'), 'liberacao_vistoria', 'Liberação da vistoria', 'data', 'Vistoria e liberação'),
  def(na('SISTEMA LIBERADO PELA CONCESSIONARIA'), 'sistema_liberado', 'Sistema liberado', 'lista', 'Vistoria e liberação', '', ['Liberado', 'Não liberado']),
  // Financeiro
  def(na('VALOR DA VENDA'), 'valor_venda', 'Valor da venda', 'dinheiro', 'Financeiro', 's'),
  def(na('FORMA DE PAGTO'), 'forma_pagto', 'Forma de pagamento', 'lista', 'Financeiro', 'sd', OPC_FORMA_PAGTO),
  def(na('RECEBIDO REAL'), 'recebido_real', 'Recebido real', 'dinheiro', 'Financeiro', 's'),
  def(na('RECEBIMENTO'), 'recebimento', 'Recebimento', 'lista', 'Financeiro', '', ['Quitado', 'Não Quitado']),
  def(na('NF'), 'nf', 'Nota fiscal', 'texto', 'Financeiro', 's'),
  def(na('COMISSÃO VENDA'), 'comissao_venda', 'Comissão da venda', 'dinheiro', 'Financeiro', 's'),
  def(na('PRÉ VENDA'), 'pre_venda', 'Pré-venda', 'dinheiro', 'Financeiro', 's'),
  def(na('FATOR X'), 'fator_x', 'Fator X', 'numero', 'Financeiro', 's'),
  def(na('TAXAS/DESCONTOS'), 'taxas_descontos', 'Taxas e descontos', 'dinheiro', 'Financeiro', 's'),
  // Custos da obra
  def(na('KM INICIAL'), 'km_inicial', 'KM inicial', 'numero', 'Custos da obra', 's'),
  def(na('KM FINAL'), 'km_final', 'KM final', 'numero', 'Custos da obra', 's'),
  def(na('KM TOTAL'), 'km_total', 'KM total', 'numero', 'Custos da obra', 'sc'),
  def(na('M.O / PEÇAS/ ALIM / HOSP/PED'), 'mao_de_obra', 'Mão de obra, peças, alimentação, hospedagem e pedágio', 'dinheiro', 'Custos da obra', 's'),
  def(na('TOTAL CUSTO'), 'total_custo', 'Total de custo', 'dinheiro', 'Custos da obra', 'sc'),
  def(na('TOTAL LUCRO'), 'total_lucro', 'Total de lucro', 'dinheiro', 'Custos da obra', 'sc'),
  def(na('% DE LUCRO'), 'pct_lucro', '% de lucro', 'numero', 'Custos da obra', 'sc'),
];
const POR_BUSCA = new Map(DEFS.map((d) => [d.busca, d]));
/** Opções ESCRITAS no catálogo, por coluna (as que valem para todo mundo). */
const OPCOES_ESCRITAS = new Map(DEFS.filter((d) => d.opcoes?.length).map((d) => [d.chave, d.opcoes as string[]]));

/** O STATUS de equipamento é o que vem logo DEPOIS da âncora (mesma regra do solarObras). */
const ANCORAS_STATUS: Array<[string, string]> = [['POT PLACA', 'placa'], ['MODELO INVERSOR', 'inversor'], ['TIPO ESTRUTURA', 'estrutura']];
const PAPEIS_STATUS = ['placa', 'inversor', 'estrutura'];

function papelDoStatus(nomes: string[], i: number, ordem: number): string | null {
  for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
    const a = ANCORAS_STATUS.find(([n]) => n === nomes[j]);
    if (a) return a[1];
  }
  return PAPEIS_STATUS[ordem] ?? null;
}

function slug(nome: string): string {
  const s = nomeComparavel(nome).toLowerCase().replace(/%/g, 'pct').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'coluna';
}

function rotuloDe(cab: string): string {
  const t = String(cab).trim().replace(/\s+/g, ' ');
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : 'Coluna';
}

function distintos(vendas: Grade['vendas'], indice: number): string[] {
  const vistos = new Map<string, string>();
  for (const v of vendas) {
    const t = String(v.celulas[indice] ?? '').trim().replace(/\s+/g, ' ');
    const k = chaveTexto(t);
    if (!t || k === 'NC' || vistos.has(k)) continue;
    vistos.set(k, t);
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')).slice(0, 200);
}

/**
 * Chave de comparação de opção: sem acento, sem caixa, só letras e dígitos ("Bi-220" casa com "Bi - 220").
 * A vírgula ou o ponto ENTRE DÍGITOS é decimal e fica ("2,25k" e "22,5k" são modelos diferentes; "1.875K" casa com "1,875K").
 */
export function chaveOpcao(s: unknown): string {
  return chaveTexto(s).replace(/(\d)\s*[.,]\s*(?=\d)/g, '$1~').replace(/[^A-Z0-9~]+/g, '');
}

/** Opções escritas primeiro, na ordem do catálogo; depois os valores da planilha que não casam, sem duplicar. */
export function mesclarOpcoes(escritas: string[], daPlanilha: string[]): string[] {
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const o of [...escritas, ...daPlanilha]) {
    const k = chaveOpcao(o);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    saida.push(o);
  }
  return saida;
}

/**
 * Catálogo a partir do CABEÇALHO que vier: coluna nova da planilha aparece sozinha
 * (grupo "Outros", só sócio) e coluna renomeada some do mapa curado sem derrubar
 * nada. A coluna 0 é sempre o código (a célula A1 da planilha está quebrada).
 * Cabeçalho vazio é ignorado. Ordem de saída: grupo e depois posição na planilha.
 */
export function montarCatalogo(cabecalho: string[], vendas: Grade['vendas'] = []): ColunaInterna[] {
  const nomes = cabecalho.map(nomeComparavel);
  const vistos = new Map<string, number>();
  const achadas: Array<{ i: number; d: Def | null }> = [];
  const usadas = new Set<string>(['codigo']);
  let ordemStatus = 0;
  nomes.forEach((n, i) => {
    if (i === 0 || !n) return;
    let d: Def | null;
    if (n === 'STATUS') {
      const papel = papelDoStatus(nomes, i, ordemStatus++);
      d = papel ? POR_BUSCA.get(`STATUS@${papel}`) ?? null : null;
    } else {
      const oc = vistos.get(n) ?? 0;
      vistos.set(n, oc + 1);
      d = POR_BUSCA.get(`${n}#${oc}`) ?? null;
    }
    // Duas colunas caindo na mesma definição (cabeçalho com nome repetido além do previsto): a segunda vira desconhecida.
    if (d && usadas.has(d.chave)) d = null;
    if (d) usadas.add(d.chave);
    achadas.push({ i, d });
  });

  const cols: ColunaInterna[] = [{
    chave: 'codigo', rotulo: 'Código', tipo: 'texto', grupo: 'Venda', quem_ve: 'todos',
    calculada: false, obrigatoria: false, editavel: false, indice: 0,
  }];
  for (const { i, d } of achadas) {
    if (d) {
      const col: ColunaInterna = {
        chave: d.chave, rotulo: d.rotulo, tipo: d.tipo, grupo: d.grupo,
        quem_ve: d.socio ? 'socio' : 'todos', calculada: d.calc,
        obrigatoria: !d.calc && !d.opcional, editavel: !d.calc, indice: i,
      };
      if (d.tipo === 'lista') {
        col.opcoes = d.dinamica ? mesclarOpcoes(d.opcoes ?? [], distintos(vendas, i)) : [...(d.opcoes ?? [])];
        col.livre = d.dinamica;
      }
      cols.push(col);
      continue;
    }
    // Desconhecida: nasce só para sócio, por segurança (pode ser custo).
    let chave = slug(cabecalho[i]);
    let n = 2;
    while (usadas.has(chave) || DEFS.some((x) => x.chave === chave)) chave = `${slug(cabecalho[i])}_${n++}`;
    usadas.add(chave);
    cols.push({
      chave, rotulo: rotuloDe(cabecalho[i]), tipo: 'texto', grupo: GRUPO_OUTROS, quem_ve: 'socio',
      calculada: false, obrigatoria: true, editavel: true, indice: i,
    });
  }
  return cols.sort((a, b) =>
    (ORDEM_GRUPO[a.grupo] ?? 99) - (ORDEM_GRUPO[b.grupo] ?? 99) || a.indice - b.indice);
}

/** As colunas que o papel pode ver, já com `editavel` do papel. Consultor nem recebe os sócios. */
export function colunasPara(cols: ColunaInterna[], socio: boolean): ColunaInterna[] {
  return cols
    .filter((c) => socio || c.quem_ve === 'todos')
    .map((c) => {
      const editavel = c.editavel && (socio || c.chave !== 'consultor');
      const copia: ColunaInterna = { ...c, editavel };
      // A lista de consultores é dado de sócio: quem não troca o consultor não precisa dela.
      if (c.chave === 'consultor' && !socio) { copia.opcoes = []; copia.livre = false; }
      // A seção Financeiro é só de sócio: o que sobra dela para o consultor (Recebimento) vai para a Venda.
      if (!socio && c.grupo === 'Financeiro') copia.grupo = 'Venda';
      return copia;
    });
}

/** O que vai para o navegador: sem o índice interno. */
export function colunaPublica(c: ColunaInterna): Coluna {
  const { indice: _i, ...resto } = c;
  void _i;
  return resto;
}

// ── Leitura da planilha inteira ──────────────────────────────────────────────

const RE_CODIGO = /^#\d+/;

/** Cabeçalho = a linha que tem NOME CLIENTE; venda = linha cuja 1ª célula casa #NNNN. */
export function lerGrade(csv: string): Grade {
  const linhas = parseCSV(csv);
  const iCab = linhas.findIndex((l) => l.some((c) => chaveTexto(c) === 'NOME CLIENTE'));
  if (iCab < 0) throw new Error('cabeçalho da planilha não encontrado');
  const cabecalho = linhas[iCab].map((c) => String(c ?? ''));
  const vendas: Grade['vendas'] = [];
  const vistos = new Set<string>();
  for (const l of linhas.slice(iCab + 1)) {
    const m = String(l[0] ?? '').trim().match(RE_CODIGO);
    if (!m) continue;
    const codigo = codigoCanonico(m[0]);
    if (vistos.has(codigo)) continue;   // código repetido: vale a primeira linha
    vistos.add(codigo);
    vendas.push({ codigo, celulas: cabecalho.map((_, i) => (i === 0 ? codigo : String(l[i] ?? '').trim())) });
  }
  return { cabecalho, vendas };
}

// ── Normalização e validação por tipo ────────────────────────────────────────

const vazioV = (v: unknown): boolean => v == null || (typeof v === 'string' && v.trim() === '');

/** "1.234,56", "R$ 1.234,56", "1234.56", "-50" e número de verdade. null = não é número. */
export function numeroBR(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let t = String(v ?? '').replace(/R\$/gi, '').replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(t)) return null;
  const neg = t.startsWith('-');
  if (neg) t = t.slice(1);
  if (!t) return null;
  if (t.includes(',')) {
    const partes = t.split(',');
    if (partes.length !== 2 || !/^\d+$/.test(partes[1])) return null;
    if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(partes[0])) return null;
    t = `${partes[0].replace(/\./g, '')}.${partes[1]}`;
  } else if (t.includes('.')) {
    if (/^0\.\d+$/.test(t)) { /* decimal com zero na frente */ }
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');   // ponto de milhar: "145.000" é 145 mil, nunca 145
    else if (!/^\d+\.\d{1,2}$/.test(t)) return null;
  } else if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function isoValido(s: string): string | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 2000 || a > 2100 || me < 1 || me > 12 || d < 1) return null;
  return d > new Date(Date.UTC(a, me, 0)).getUTCDate() ? null : s;
}
export function dataParaISO(v: unknown): string | null {
  const t = String(v ?? '').trim();
  return isoValido(t) ?? parseDataBR(t);
}
export function isoParaBR(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

const sujeira = /[\u0000-\u001F\u007F]/g;
/** A observação é o único texto com várias linhas: guarda a quebra de linha e tira o resto. */
const sujeiraSemQuebra = /[\u0000-\u0009\u000B-\u001F\u007F]/g;
const textoLimpo = (c: Coluna, t: string): string =>
  c.chave === 'obs' ? t.replace(/\r\n?/g, '\n').replace(sujeiraSemQuebra, ' ') : t.replace(sujeira, ' ');

function canonicoDaLista(c: Coluna, t: string): string | null {
  const k = chaveOpcao(t);
  return k ? ((c.opcoes ?? []).find((o) => chaveOpcao(o) === k) ?? null) : null;
}

/** Valor que veio da PLANILHA: indulgente (o que não dá para ler vira vazio ou fica como texto). */
export function normalizarDaPlanilha(c: Coluna, bruto: string): Valor {
  const t = String(bruto ?? '').trim();
  if (!t) return null;
  switch (c.tipo) {
    case 'data': return dataParaISO(t);                         // "nc" e lixo viram vazio
    case 'dinheiro': { const n = numeroBR(t); return n == null ? null : Math.round(n * 100) / 100; }
    case 'numero': { const n = numeroBR(t); return n == null ? null : Math.round(n * 10000) / 10000; }
    case 'inteiro': { const m = t.match(/\d+/); return m ? Number(m[0]) : null; }
    case 'telefone': { const d = t.replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 ? d : t; }
    case 'lista': return canonicoDaLista(c, t) ?? t;
    default: return textoLimpo(c, t);
  }
}

export type Validado = { ok: true; valor: Valor } | { ok: false; erro: string };

/** Valor que o usuário DIGITOU: rígido. Vazio é permitido e significa "apagar a sobrescrita". */
export function validarValor(c: Coluna, bruto: unknown): Validado {
  if (vazioV(bruto)) return { ok: true, valor: null };
  if (typeof bruto !== 'string' && typeof bruto !== 'number') return { ok: false, erro: 'Valor inválido.' };
  const t = String(bruto).trim();
  switch (c.tipo) {
    case 'data': {
      const iso = dataParaISO(t);
      return iso ? { ok: true, valor: iso } : { ok: false, erro: 'Data inválida. Use dd/mm/aaaa.' };
    }
    case 'dinheiro': {
      const n = numeroBR(bruto);
      if (n == null || Math.abs(n) > 1_000_000_000) return { ok: false, erro: 'Valor em reais inválido. Exemplo: 1.234,56.' };
      return { ok: true, valor: Math.round(n * 100) / 100 };
    }
    case 'numero': {
      const n = numeroBR(bruto);
      if (n == null || Math.abs(n) > 1_000_000_000) return { ok: false, erro: 'Número inválido.' };
      return { ok: true, valor: Math.round(n * 10000) / 10000 };
    }
    case 'inteiro': {
      if (typeof bruto === 'number' ? !Number.isInteger(bruto) || bruto < 0 || bruto > 999_999_999 : !/^\d{1,9}$/.test(t)) {
        return { ok: false, erro: 'Use um número inteiro.' };
      }
      return { ok: true, valor: Number(t) };
    }
    case 'telefone': {
      const d = t.replace(/\D/g, '');
      const ok = (d.length === 10 || d.length === 11) || ((d.length === 12 || d.length === 13) && d.startsWith('55'));
      return ok ? { ok: true, valor: d } : { ok: false, erro: 'Telefone com DDD, de 10 ou 11 dígitos.' };
    }
    case 'lista': {
      const o = canonicoDaLista(c, t);
      if (o) return { ok: true, valor: o };
      if (!c.livre) return { ok: false, erro: 'Escolha uma das opções da lista.' };
      const livre = t.replace(sujeira, ' ').replace(/\s+/g, ' ').trim();
      return livre.length <= MAX_TEXTO ? { ok: true, valor: livre } : { ok: false, erro: `Texto longo demais (máximo ${MAX_TEXTO} caracteres).` };
    }
    default: {
      const texto = textoLimpo(c, t);
      return texto.length <= MAX_TEXTO ? { ok: true, valor: texto } : { ok: false, erro: `Texto longo demais (máximo ${MAX_TEXTO} caracteres).` };
    }
  }
}

// ── Registro do sistema (system_state) ───────────────────────────────────────

const registroVazio = (): RegistroGestao => ({ campos: {}, alteracoes: [], em: null });

/** Normaliza o `value` do banco (pode vir torto) para o formato fixo. */
export function lerRegistro(value: unknown): RegistroGestao {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const r = registroVazio();
  const campos = (v.campos && typeof v.campos === 'object' ? v.campos : {}) as Record<string, unknown>;
  for (const [k, c] of Object.entries(campos)) {
    if (!c || typeof c !== 'object') continue;
    const x = c as Record<string, unknown>;
    const valor = x.valor;
    if (!(valor === null || typeof valor === 'string' || typeof valor === 'number')) continue;
    if (typeof x.por !== 'string' || typeof x.em !== 'string') continue;
    r.campos[k] = { valor, por: x.por, em: x.em };
  }
  if (Array.isArray(v.alteracoes)) {
    for (const a of v.alteracoes) {
      if (!a || typeof a !== 'object') continue;
      const x = a as Record<string, unknown>;
      if (typeof x.em !== 'string' || typeof x.por !== 'string' || typeof x.coluna !== 'string') continue;
      const antes = x.antes === undefined ? null : x.antes;
      if (!(antes === null || typeof antes === 'string' || typeof antes === 'number')) continue;
      r.alteracoes.push({ em: x.em, por: x.por, coluna: x.coluna, antes });
    }
  }
  r.em = typeof v.em === 'string' ? v.em : null;
  return r;
}

// ── Mescla ───────────────────────────────────────────────────────────────────

/**
 * Valor do sistema (se houver) por cima do da planilha, campo a campo. Fase 2: `regCard` é o overlay da linha do /gerador
 * (`gestao_gerador:<card>`), que fica ABAIXO da planilha e só completa o vazio (a grade e as Obras não discordam); `derivado` é o valor
 * que o /gerador monta (card, proposta, cadastro). Ordem: digitado no código > planilha preenchida > digitado no card > montado >
 * vazio. Coluna calculada nunca recebe overlay nem derivado.
 */
export function celulaDe(c: Coluna, bruto: string, reg: RegistroGestao | undefined, derivado?: string, regCard?: RegistroGestao): Celula {
  const s = !c.calculada ? reg?.campos[c.chave] : undefined;
  if (s) return { valor: s.valor, origem: 'sistema', por: s.por, em: s.em };
  const daPlanilha = normalizarDaPlanilha(c, bruto);
  if (!vazioV(daPlanilha) || c.calculada) return { valor: daPlanilha, origem: 'planilha' };
  const doCard = regCard?.campos[c.chave];
  if (doCard) return { valor: doCard.valor, origem: 'sistema', por: doCard.por, em: doCard.em };
  if (!derivado) return { valor: daPlanilha, origem: 'planilha' };
  const d = normalizarDaPlanilha(c, derivado);
  return vazioV(d) ? { valor: daPlanilha, origem: 'planilha' } : { valor: d, origem: 'gerador' };
}

// ── Linhas do /gerador (fase 2) ──────────────────────────────────────────────

/** Colunas com dado PESSOAL: na linha do alocador ou só do /gerador vêm do cadastro do card e são só leitura. */
export const COLUNAS_PESSOAIS: ReadonlySet<string> = new Set(['cliente', 'homologacao', 'contato', 'endereco', 'cidade', 'uf']);
/** `so_gerador`: o código não tem linha na planilha. `junta`: tem, e é o mesmo cliente. `conflito`: tem, e é outro cliente. */
export type ModoGerador = 'so_gerador' | 'junta' | 'conflito';
/**
 * A linha que o /gerador monta para um código ligado a um card. `valores`: chave de coluna -> texto bruto no formato da planilha (só
 * chaves com valor). Nomes e telefones usados para conferir identidade NUNCA entram aqui. `avisoTelefone`: só o texto pronto, com
 * códigos de linhas do Excel.
 */
export interface Derivada {
  codigo: string; card: number; modo: ModoGerador; doAlocador: boolean; vivo: boolean; consultor: string;
  valores: Record<string, string>; avisoTelefone?: string;
}

/**
 * A célula é só leitura? Lado Gerador de um conflito: toda coluna. Coluna pessoal em linha do alocador ou só do /gerador: em
 * QUALQUER modo. Consultor em linha só do /gerador. O resto, não (as ligações antigas sem registro seguem editáveis).
 */
export function celulaEhFixa(chave: string, d: Pick<Derivada, 'modo' | 'doAlocador'> | undefined, ladoGerador: boolean): boolean {
  if (ladoGerador) return true;
  if (COLUNAS_PESSOAIS.has(chave) && d && (d.doAlocador || d.modo === 'so_gerador')) return true;
  return chave === 'consultor' && d?.modo === 'so_gerador';
}

export const preenchida = (cel: Celula | undefined): boolean =>
  !!cel && cel.valor !== null && cel.valor !== undefined && cel.valor !== '';

export interface Progresso { preenchidas: number; total: number; faltando: number }

/** Obrigatórias preenchidas sobre obrigatórias, SÓ das colunas que o papel vê (as de `cols`). */
export function progressoDe(cols: Coluna[], celulas: Record<string, Celula>): Progresso {
  let total = 0;
  let preenchidas = 0;
  for (const c of cols) {
    if (!c.obrigatoria) continue;
    total++;
    if (preenchida(celulas[c.chave])) preenchidas++;
  }
  return { preenchidas, total, faltando: total - preenchidas };
}

export interface LinhaGestao {
  codigo: string;
  cliente: string;
  consultor: string;
  celulas: Record<string, Celula>;
  progresso: Progresso;
  /** Fase 2 (linhas do /gerador). */
  so_gerador?: true;
  card?: number;
  exibir?: string;
  conflito?: 'planilha' | 'gerador';
  venda_desfeita?: true;
  somente_leitura?: true;
  aviso_telefone?: string;
}

/** O consultor da venda: o do sistema (se um sócio trocou), o da planilha, ou (fase 2) o do card ligado. */
export function consultorEfetivo(cols: ColunaInterna[], celulasBrutas: string[], reg: RegistroGestao | undefined, derivado?: string): string {
  const s = reg?.campos.consultor;
  if (s && typeof s.valor === 'string' && s.valor) return s.valor;
  const c = cols.find((x) => x.chave === 'consultor');
  const daPlanilha = c ? String(celulasBrutas[c.indice] ?? '').trim() : '';
  return daPlanilha || String(derivado ?? '').trim();
}

/** Linhas visíveis ao papel, com as células mescladas e o progresso. */
export function montarLinhas(
  grade: Grade,
  todas: ColunaInterna[],
  registros: Map<string, RegistroGestao>,
  nome: string,
  socio: boolean,
  derivadas?: ReadonlyMap<string, Derivada>,
  overlaysDoGerador?: ReadonlyMap<number, RegistroGestao>,
  /** Códigos cujo par ficou de fora (cadastro do card não respondeu): as colunas pessoais ficam só leitura, como o POST as trata. */
  pulados?: ReadonlySet<string>,
): { colunas: ColunaInterna[]; linhas: LinhaGestao[] } {
  const colunas = colunasPara(todas, socio);
  const iCliente = todas.find((c) => c.chave === 'cliente')?.indice ?? -1;
  const linhas: LinhaGestao[] = [];
  const naPlanilha = new Set<string>();
  const conflitos: Derivada[] = [];
  const celulasDe = (bruto: (c: ColunaInterna) => string, reg: RegistroGestao | undefined, d: Derivada | undefined,
    regCard: RegistroGestao | undefined, ladoGerador: boolean): Record<string, Celula> => {
    const m: Record<string, Celula> = {};
    for (const c of colunas) {
      if (c.chave === 'codigo') continue;
      const cel = celulaDe(c, bruto(c), reg, d?.valores[c.chave], regCard);
      m[c.chave] = celulaEhFixa(c.chave, d, ladoGerador) ? { ...cel, fixa: true } : cel;
    }
    return m;
  };
  const clienteDe = (celulas: Record<string, Celula>, alternativo: string): string => {
    const cli = celulas.cliente?.valor;
    return typeof cli === 'string' ? cli : alternativo;
  };
  for (const v of grade.vendas) {
    naPlanilha.add(v.codigo);
    const reg = registros.get(v.codigo);
    const d0 = derivadas?.get(v.codigo);
    if (d0?.modo === 'conflito') conflitos.push(d0);
    // Só em `junta` a linha do /gerador completa a do CSV; em conflito nada é juntado.
    const d = d0?.modo === 'junta' ? d0 : undefined;
    const cons = consultorEfetivo(todas, v.celulas, reg, d?.consultor);
    if (!(socio || podeVer(nome, cons))) continue;
    // A linha do alocador em `junta` trava as colunas pessoais mesmo sem juntar valor (a posse é a do código).
    const dFixa = d ?? (d0 && d0.doAlocador ? d0 : undefined);
    const celulas = celulasDe((c) => v.celulas[c.indice] ?? '', reg, d, d ? overlaysDoGerador?.get(d.card) : undefined, false);
    if (dFixa && !d) for (const k of Object.keys(celulas)) if (celulaEhFixa(k, dFixa, false)) celulas[k] = { ...celulas[k], fixa: true };
    if (pulados?.has(v.codigo)) for (const k of Object.keys(celulas)) if (COLUNAS_PESSOAIS.has(k)) celulas[k] = { ...celulas[k], fixa: true };
    linhas.push({
      codigo: v.codigo,
      cliente: clienteDe(celulas, iCliente >= 0 ? String(v.celulas[iCliente] ?? '') : ''),
      consultor: cons,
      celulas,
      progresso: progressoDe(colunas, celulas),
      // S4: a linha do alocador leva o card (documentos e relatório vão por ele), só com o card vivo e para quem é dono do card. Em
      // conflito, a linha do CSV não leva o card do cliente do /gerador (a linha do lado /gerador leva o dela).
      ...(d && d.doAlocador && d.vivo && (socio || podeVer(nome, d.consultor)) ? { card: d.card } : {}),
      ...(d0?.modo === 'conflito' ? { conflito: 'planilha' as const } : {}),
    });
  }
  // Linhas só do /gerador, pela ordem do código.
  const soGerador = [...(derivadas?.values() ?? [])].filter((d) => d.modo === 'so_gerador' && !naPlanilha.has(d.codigo))
    .sort((a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0));
  for (const d of soGerador) {
    if (!(socio || podeVer(nome, d.consultor))) continue;
    const celulas = celulasDe(() => '', undefined, d, overlaysDoGerador?.get(d.card), false);
    linhas.push({
      codigo: d.codigo, cliente: clienteDe(celulas, ''), consultor: d.consultor, celulas, progresso: progressoDe(colunas, celulas),
      so_gerador: true, card: d.card,
      ...(d.vivo ? {} : { venda_desfeita: true as const }),
      ...(d.avisoTelefone ? { aviso_telefone: d.avisoTelefone } : {}),
    });
  }
  // O lado /gerador de cada conflito: chave própria, tudo só leitura e sem overlay.
  for (const d of conflitos) {
    if (!(socio || podeVer(nome, d.consultor))) continue;
    const celulas = celulasDe(() => '', undefined, d, undefined, true);
    linhas.push({
      codigo: `${d.codigo}@${d.card}`, exibir: d.codigo, cliente: clienteDe(celulas, ''), consultor: d.consultor, celulas,
      progresso: progressoDe(colunas, celulas), so_gerador: true, card: d.card, conflito: 'gerador', somente_leitura: true,
      ...(d.vivo ? {} : { venda_desfeita: true as const }),
    });
  }
  // Lista aberta (engenheiro, equipe, concessionária, estrutura, modelo...): o consultor recebe as opções ESCRITAS no
  // catálogo e os valores das vendas DELE. O catálogo em cache tem os valores de todas as vendas; entregá-los vazaria
  // equipe, engenheiro e o que mais alguém digitou em obra alheia.
  const visiveisDele = socio ? colunas : colunas.map((c) => {
    if (c.tipo !== 'lista' || !c.livre || c.chave === 'consultor') return c;
    const vistos = new Map<string, string>();
    for (const l of linhas) {
      const v = l.celulas[c.chave]?.valor;
      if (typeof v !== 'string' || !v.trim()) continue;
      const k = chaveTexto(v);
      if (!vistos.has(k)) vistos.set(k, v.trim());
    }
    const dele = [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return { ...c, opcoes: mesclarOpcoes(LISTAS_DE_GENTE.has(c.chave) ? [] : (OPCOES_ESCRITAS.get(c.chave) ?? []), dele) };
  });
  return { colunas: visiveisDele, linhas };
}

export function totais(linhas: LinhaGestao[]): { clientes: number; obrigatorias: number; preenchidas: number; faltando: number; clientes_com_pendencia: number } {
  let obrigatorias = 0;
  let preenchidas = 0;
  let comPendencia = 0;
  for (const l of linhas) {
    if (l.venda_desfeita || l.conflito === 'gerador') continue;   // venda desfeita e o lado /gerador de um conflito não contam
    obrigatorias += l.progresso.total;
    preenchidas += l.progresso.preenchidas;
    if (l.progresso.faltando > 0) comPendencia++;
  }
  return { clientes: linhas.filter((l) => !l.venda_desfeita && l.conflito !== 'gerador').length, obrigatorias, preenchidas, faltando: obrigatorias - preenchidas, clientes_com_pendencia: comPendencia };
}

// ── Conflito e gravação ──────────────────────────────────────────────────────

/**
 * Outra pessoa mexeu nesta coluna depois de `baseEm`? Olha o campo atual E a
 * trilha (a trilha pega quem APAGOU a sobrescrita, que não deixa campo).
 * A mesma pessoa em duas abas não conflita. Todos os instantes são ISO UTC.
 */
export function houveConflito(reg: RegistroGestao, chave: string, baseEm: string, por: string): { por: string; em: string } | null {
  let achado: { por: string; em: string } | null = null;
  const olha = (p: string, em: string) => {
    if (p !== por && em > baseEm && (!achado || em > achado.em)) achado = { por: p, em };
  };
  const campo = reg.campos[chave];
  if (campo) olha(campo.por, campo.em);
  for (const a of reg.alteracoes) if (a.coluna === chave) olha(a.por, a.em);
  return achado;
}

/** Registro novo com a célula gravada (ou apagada, se `valor` for null), sem mexer no original. */
export function aplicarGravacao(
  reg: RegistroGestao, c: Coluna, valor: Valor, antes: Valor, por: string, agora: string,
): RegistroGestao {
  const campos = { ...reg.campos };
  if (valor === null) delete campos[c.chave];
  else campos[c.chave] = { valor, por, em: agora };
  const alteracoes = [...reg.alteracoes, { em: agora, por, coluna: c.chave, antes }].slice(-MAX_ALTERACOES);
  return { campos, alteracoes, em: agora };
}

// ── Sobrescrita na rota de Obras ─────────────────────────────────────────────

type FormatoObra = 'texto' | 'data' | 'numero';
const MAPA_OBRA: Record<string, [keyof ObraBruta, FormatoObra]> = {
  cliente: ['cliente', 'texto'], homologacao: ['homologacao', 'texto'], consultor: ['consultor', 'texto'],
  origem: ['origem', 'texto'], valor_venda: ['valorVenda', 'numero'], recebido_real: ['recebidoReal', 'numero'],
  recebimento: ['recebimento', 'texto'], sistema_liberado: ['liberadoTxt', 'texto'], depoimento: ['depoimentoTxt', 'texto'],
  contato: ['telefone', 'texto'], endereco: ['endereco', 'texto'], cidade: ['cidade', 'texto'], uf: ['uf', 'texto'],
  entrega_material: ['entregaMaterial', 'data'], previsao_montagem: ['previsaoMontagem', 'data'],
  inicio_instalacao: ['inicioInstalacao', 'data'], fim_instalacao: ['fimInstalacao', 'data'],
  qtd_placa: ['qtdPlaca', 'texto'], modelo_placa: ['modeloPlaca', 'texto'], status_placa: ['statusPlaca', 'texto'],
  qtd_inversor: ['qtdInv', 'texto'], modelo_inversor: ['modeloInversor', 'texto'], status_inversor: ['statusInversor', 'texto'],
  tipo_estrutura: ['tipoEstrutura', 'texto'], status_estrutura: ['statusEstrutura', 'texto'],
  cadastro_trello: ['cadastroTrello', 'data'], parecer_acesso: ['parecerAcesso', 'data'],
  pedido_vistoria: ['pedidoVistoria', 'data'], liberacao_vistoria: ['liberacaoVistoria', 'data'],
  engenheiro: ['engenheiro', 'texto'], concessionaria: ['concessionaria', 'texto'], equipe: ['equipe', 'texto'],
};
/** Colunas "reserva" do cabeçalho: valem para o mesmo campo da obra, só se a principal não tem sobrescrita. */
const RESERVA_OBRA: Record<string, string> = {
  previsao_montagem_2: 'previsao_montagem', inicio_instalacao_2: 'inicio_instalacao',
  fim_instalacao_2: 'fim_instalacao',
};

/**
 * Aplica as sobrescritas do sistema sobre a linha da planilha ANTES de `montarObra`,
 * para o que se preenche na Gestão mover a etapa em Obras. Devolve uma CÓPIA: o
 * objeto do cache da planilha nunca é alterado (senão "apagar a sobrescrita"
 * não voltaria a valer a planilha). A data volta para dd/mm/aaaa porque é o único
 * formato que `parseDataBR` lê.
 */
export function aplicarSobrescritas(b: ObraBruta, reg: RegistroGestao | undefined): ObraBruta {
  if (!reg || !Object.keys(reg.campos).length) return b;
  const o: Record<string, unknown> = { ...b };
  const poe = (chave: string, destino: keyof ObraBruta, fmt: FormatoObra) => {
    const c = reg.campos[chave];
    if (!c || c.valor === null) return;
    if (fmt === 'numero') o[destino] = Number(c.valor);
    else if (fmt === 'data') o[destino] = typeof c.valor === 'string' && isoValido(c.valor) ? isoParaBR(c.valor) : String(c.valor);
    else o[destino] = String(c.valor);
  };
  for (const [chave, [destino, fmt]] of Object.entries(MAPA_OBRA)) {
    const reservaDela = Object.entries(RESERVA_OBRA).find(([, principal]) => principal === chave)?.[0];
    // Reserva primeiro, principal depois: a principal ganha quando as duas existem.
    if (reservaDela) poe(reservaDela, destino, fmt);
    poe(chave, destino, fmt);
  }
  return o as unknown as ObraBruta;
}

/** Aplica a sobrescrita de cada venda (as que não têm registro passam intactas). */
export function aplicarSobrescritasTodas(obras: ObraBruta[], registros: Map<string, RegistroGestao>): ObraBruta[] {
  return obras.map((b) => aplicarSobrescritas(b, registros.get(codigoCanonico(b.codigo))));
}
