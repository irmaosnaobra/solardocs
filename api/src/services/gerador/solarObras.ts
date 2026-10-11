// ─────────────────────────────────────────────────────────────────────────────
// OBRAS DO SOLAR: a Planilha Mestre de vendas lida como "pós-venda".
//
// Este módulo é LÓGICA PURA (sem rede, sem banco), de propósito: a planilha
// tem coluna repetida, data digitada torta e buraco no meio, e cada uma dessas
// manhas precisa de teste que rode sem Google nem Trello.
//
// LISTA BRANCA NA LEITURA. `lerPlanilha` só copia para a memória as colunas
// abaixo. Custo, lucro, comissão, fator, valor do kit e quilometragem NUNCA
// saem do CSV: o repositório é público e a resposta vai para o celular de
// consultor, então a garantia mais forte é a coluna nem existir no objeto.
// ─────────────────────────────────────────────────────────────────────────────
import { parseCSV } from '../insightsService';
import { normFone } from '../../utils/metaCapi';
import { resolverCidade } from '../io/geoCidade';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type StatusEquip = 'instalado' | 'no_cliente' | 'estoque' | 'comprar' | null;

/** Uma venda como veio da planilha, SÓ com as colunas da lista branca. */
export interface ObraBruta {
  codigo: string;            // "#0057"
  cliente: string;
  homologacao: string;
  consultor: string;
  origem: string;
  valorVenda: number;
  recebidoReal: number;
  recebimento: string;       // texto cru: Quitado / Não Quitado / vazio
  liberadoTxt: string;       // texto cru: Liberado / Não liberado
  depoimentoTxt: string;
  telefone: string;
  endereco: string;
  cidade: string;
  uf: string;
  entregaMaterial: string;   // texto cru, vira data em montarObra
  previsaoMontagem: string;
  inicioInstalacao: string;
  fimInstalacao: string;
  qtdPlaca: string;
  modeloPlaca: string;
  statusPlaca: string;
  qtdInv: string;
  modeloInversor: string;
  statusInversor: string;
  tipoEstrutura: string;
  statusEstrutura: string;
  cadastroTrello: string;
  parecerAcesso: string;
  pedidoVistoria: string;
  liberacaoVistoria: string;
  engenheiro: string;
  concessionaria: string;
  equipe: string;
}

export type ChaveEtapa = 'venda' | 'projeto' | 'material' | 'instalacao' | 'vistoria' | 'liberado';
export const ORDEM_ETAPAS: ChaveEtapa[] = ['venda', 'projeto', 'material', 'instalacao', 'vistoria', 'liberado'];
const ROTULOS: Record<ChaveEtapa, string> = {
  venda: 'Venda', projeto: 'Projeto', material: 'Material',
  instalacao: 'Instalação', vistoria: 'Vistoria', liberado: 'Liberado',
};

export interface Etapa {
  chave: ChaveEtapa;
  rotulo: string;
  feito: boolean;
  em: string | null;
  detalhe: string | null;
  /** Etapa não feita que fica ANTES da última feita: buraco da planilha, não
   *  trabalho pendente. Só aparece (true) quando é o caso. */
  semRegistro?: true;
}

export interface OrigemObra {
  tipo: 'trafego' | 'indicacao' | 'recorrente' | 'outro';
  texto: string;
  indicadoPor: string | null;
}

export interface Marcas {
  depoimentoPedidoEm: string | null;
  indicacaoPedidaEm: string | null;
  por: string | null;
}

export interface ObraMontada {
  codigo: string;
  cliente: string;
  homologacao: string;
  consultor: string;
  telefone: string | null;
  endereco: string;
  cidade: string;
  uf: string;
  concessionaria: string;
  equipe: string;
  engenheiro: string;
  sistema: {
    placas: number | null; modeloPlaca: string;
    inversores: number | null; inversor: string; estrutura: string;
  };
  vendaEm: string | null;
  etapas: Etapa[];
  etapaAtual: ChaveEtapa | 'concluida';
  paradoHaDias: number | null;
  recebimento: 'quitado' | 'nao_quitado' | 'sem_registro';
  valores: { venda: number; recebido: number; aReceber: number };
  depoimento: 'sim' | 'pedido' | 'insatisfeito' | 'nao_faz' | null;
  origem: OrigemObra;
  /** Atalhos das etapas (instalação e liberação feitas), para o mapa e o `pedir`.
   *  Não vão na resposta: a rota monta o JSON campo a campo. */
  instalada: boolean;
  liberada: boolean;
}

// ── Texto ────────────────────────────────────────────────────────────────────

/** Maiúscula, sem acento, espaço colapsado: a chave de comparação de cabeçalho. */
export function chaveTexto(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Minúscula e sem acento: compara o nome do consultor com a coluna CONSULTOR. */
export function nomeSimples(s: unknown): string {
  return chaveTexto(s).toLowerCase();
}

// ── Colunas (nomes repetidos resolvidos por posição relativa) ────────────────

export interface Colunas {
  cliente: number; homologacao: number; consultor: number; origem: number;
  valorVenda: number; recebidoReal: number; recebimento: number; liberado: number;
  depoimento: number; telefone: number; endereco: number; cidade: number; uf: number;
  entregaMaterial: number; previsaoMontagem: number; inicioInstalacao: number; fimInstalacao: number;
  qtdPlaca: number; modeloPlaca: number; statusPlaca: number;
  qtdInv: number; modeloVoltagem: number; modeloInversor: number; statusInversor: number;
  tipoEstrutura: number; statusEstrutura: number;
  cadastroTrello: number; parecerAcesso: number; pedidoVistoria: number; liberacaoVistoria: number;
  engenheiro: number; concessionaria: number; equipe: number;
  /** Reserva: segunda ocorrência de previsão, início e fim da instalação. */
  previsaoReserva: number; inicioReserva: number; fimReserva: number;
}

/** Índice da n-ésima ocorrência (0 = primeira) do nome, ou -1. */
function ocorrencia(chaves: string[], nome: string, n = 0, aPartirDe = 0): number {
  let visto = 0;
  for (let i = aPartirDe; i < chaves.length; i++) {
    if (chaves[i] === nome) { if (visto === n) return i; visto++; }
  }
  return -1;
}

/** Como `ocorrencia`, mas casando por expressão (grafias que variam na planilha). */
function ocorrenciaRe(chaves: string[], re: RegExp, n = 0): number {
  let visto = 0;
  for (let i = 0; i < chaves.length; i++) {
    if (re.test(chaves[i])) { if (visto === n) return i; visto++; }
  }
  return -1;
}

/** "DATA INICIO INSTALACAO" e a grafia da coluna reserva, escrita sem o primeiro
 *  I ("INCIO INSTALAÇÃO"). Aceita as duas, com ou sem "DATA". */
const RE_INICIO_INSTALACAO = /^(DATA )?INI?CIO INSTALACAO$/;

/** O STATUS de equipamento é o que vem logo DEPOIS da âncora (POT PLACA etc.). */
function statusApos(chaves: string[], ancora: string): number {
  const a = ocorrencia(chaves, ancora);
  if (a < 0) return -1;
  for (let i = a + 1; i < Math.min(chaves.length, a + 4); i++) {
    if (chaves[i] === 'STATUS') return i;
  }
  return -1;
}

/**
 * Resolve os índices pelo CABEÇALHO, nunca por número fixo: a planilha ganha
 * coluna no meio de tempos em tempos. Comparação por igualdade (não `includes`),
 * senão MODELO INVERSOR colide com MODELO E VOLTAGEM DO INVERSOR.
 */
export function resolverColunas(cabecalho: string[]): Colunas {
  const k = cabecalho.map(chaveTexto);
  const um = (nome: string) => ocorrencia(k, nome);
  // Reserva da instalação: 2ª ocorrência do mesmo nome; se o texto do cabeçalho
  // repetido for outro, cai para a posição documentada (49 a 51) SE a palavra
  // bater, para nunca ler a coluna errada em silêncio.
  const reserva = (nome: string | RegExp, fixo: number, palavra: RegExp) => {
    const seg = typeof nome === 'string' ? ocorrencia(k, nome, 1) : ocorrenciaRe(k, nome, 1);
    if (seg >= 0) return seg;
    return fixo < k.length && palavra.test(k[fixo]) ? fixo : -1;
  };
  return {
    cliente: um('NOME CLIENTE'), homologacao: um('NOME HOMOLOGACAO'),
    consultor: um('CONSULTOR'), origem: um('ORIGEM DO LEAD'),
    valorVenda: um('VALOR DA VENDA'), recebidoReal: um('RECEBIDO REAL'),
    recebimento: um('RECEBIMENTO'), liberado: um('SISTEMA LIBERADO PELA CONCESSIONARIA'),
    depoimento: um('DEPOIMENTO INSTAGRAM'), telefone: um('CONTATO'),
    endereco: um('ENDERECO'), cidade: um('CIDADE'), uf: um('UF'),
    entregaMaterial: um('ENTREGA DO MATERIAL'), previsaoMontagem: um('PREVISAO DE MONTAGEM'),
    inicioInstalacao: ocorrenciaRe(k, RE_INICIO_INSTALACAO), fimInstalacao: um('DATA FINAL INSTALACAO'),
    qtdPlaca: um('QTD PLACA'), modeloPlaca: um('MODELO PLACA'), statusPlaca: statusApos(k, 'POT PLACA'),
    qtdInv: um('QTD INV'), modeloVoltagem: um('MODELO E VOLTAGEM DO INVERSOR'),
    modeloInversor: um('MODELO INVERSOR'), statusInversor: statusApos(k, 'MODELO INVERSOR'),
    tipoEstrutura: um('TIPO ESTRUTURA'), statusEstrutura: statusApos(k, 'TIPO ESTRUTURA'),
    cadastroTrello: um('CADASTRO TRELLO'),
    // O nome desta coluna é o mais comprido da planilha; aceita variação de fim.
    parecerAcesso: um('DATA EMISSAO ULTIMO PARECER DE ACESSO') >= 0 ? um('DATA EMISSAO ULTIMO PARECER DE ACESSO')
      : k.findIndex((x) => x.startsWith('DATA EMISSAO') && x.includes('PARECER')),
    pedidoVistoria: um('DATA PEDIDO DE VISTORIA'), liberacaoVistoria: um('LIBERACAO VISTORIA'),
    engenheiro: um('ENGENHEIRO'), concessionaria: um('CONCESSIONARIA'), equipe: um('EQUIPE'),
    previsaoReserva: reserva('PREVISAO DE MONTAGEM', 49, /PREVIS/),
    inicioReserva: reserva(RE_INICIO_INSTALACAO, 50, /INI?CIO/),
    fimReserva: reserva('DATA FINAL INSTALACAO', 51, /FINAL|FIM/),
  };
}

/** Nomes das colunas que não foram achadas no cabeçalho (para o log avisar). */
export function colunasFaltando(c: Colunas): string[] {
  return (Object.keys(c) as Array<keyof Colunas>).filter((n) => c[n] < 0);
}

const RE_CODIGO = /^#\d+/;

/**
 * Lê o CSV inteiro e devolve só as vendas, só com a lista branca. A célula A1
 * está quebrada ("J49" no lugar de "CODIGO"), então o cabeçalho é a linha que
 * tem NOME CLIENTE, e venda é a linha cuja 1ª célula casa #NNNN (isso deixa de
 * fora linhas de TOTAL e de rodapé).
 */
export function lerPlanilha(csv: string, aviso?: (faltando: string[]) => void): ObraBruta[] {
  const linhas = parseCSV(csv);
  const iCab = linhas.findIndex((l) => l.some((c) => chaveTexto(c) === 'NOME CLIENTE'));
  if (iCab < 0) throw new Error('cabeçalho da planilha não encontrado');
  const c = resolverColunas(linhas[iCab]);
  // Sem cliente ou consultor a lista inteira seria lixo (e a regra de quem vê
  // o quê não teria base): melhor falhar alto do que servir tudo vazio.
  if (c.cliente < 0 || c.consultor < 0) throw new Error('colunas NOME CLIENTE/CONSULTOR não encontradas');
  const falta = colunasFaltando(c);
  if (falta.length && aviso) aviso(falta);
  const obras: ObraBruta[] = [];
  for (const l of linhas.slice(iCab + 1)) {
    const cod = String(l[0] ?? '').trim().match(RE_CODIGO);
    if (!cod) continue;
    const t = (i: number) => (i >= 0 ? String(l[i] ?? '').trim() : '');
    // Reserva só entra quando a coluna principal está vazia.
    const ouReserva = (i: number, r: number) => t(i) || t(r);
    obras.push({
      codigo: cod[0],
      cliente: t(c.cliente), homologacao: t(c.homologacao),
      consultor: t(c.consultor), origem: t(c.origem),
      valorVenda: parseReais(t(c.valorVenda)), recebidoReal: parseReais(t(c.recebidoReal)),
      recebimento: t(c.recebimento), liberadoTxt: t(c.liberado), depoimentoTxt: t(c.depoimento),
      telefone: t(c.telefone), endereco: t(c.endereco), cidade: t(c.cidade), uf: t(c.uf),
      entregaMaterial: t(c.entregaMaterial),
      previsaoMontagem: ouReserva(c.previsaoMontagem, c.previsaoReserva),
      inicioInstalacao: ouReserva(c.inicioInstalacao, c.inicioReserva),
      fimInstalacao: ouReserva(c.fimInstalacao, c.fimReserva),
      qtdPlaca: t(c.qtdPlaca), modeloPlaca: t(c.modeloPlaca), statusPlaca: t(c.statusPlaca),
      qtdInv: t(c.qtdInv), modeloInversor: t(c.modeloInversor) || t(c.modeloVoltagem),
      statusInversor: t(c.statusInversor),
      tipoEstrutura: t(c.tipoEstrutura), statusEstrutura: t(c.statusEstrutura),
      cadastroTrello: t(c.cadastroTrello), parecerAcesso: t(c.parecerAcesso),
      pedidoVistoria: t(c.pedidoVistoria), liberacaoVistoria: t(c.liberacaoVistoria),
      engenheiro: t(c.engenheiro), concessionaria: t(c.concessionaria), equipe: t(c.equipe),
    });
  }
  return obras;
}

// ── Números e datas ──────────────────────────────────────────────────────────

/** "R$ 6.990,00" vira 6990. Vazio ou lixo vira 0. */
export function parseReais(s: string): number {
  const limpo = String(s || '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}

function inteiroOuNull(s: string): number | null {
  const m = String(s || '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * "dd/mm/aaaa", "d/mm/aaaa" e o erro de digitação "dd//mm/aaaa" viram AAAA-MM-DD.
 * Texto que não é data ("nc", "ok", vazio) e data impossível (31/02) viram null.
 */
export function parseDataBR(s: unknown): string | null {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/+(\d{1,2})\/+(\d{2}|\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || ano < 2000 || ano > 2100) return null;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (dia > ultimo) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Dia de hoje em Brasília (AAAA-MM-DD). O relógio do servidor é UTC, e 22h de
 *  Brasília já é "amanhã" lá: contar dias pelo UTC erra 1 à noite. */
export function hojeBRT(agora: Date): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// ── Status de equipamento ────────────────────────────────────────────────────

export function statusEquip(s: string): StatusEquip {
  const k = chaveTexto(s);
  if (k === 'INSTALADO') return 'instalado';
  if (k === 'NO CLIENTE') return 'no_cliente';
  if (k === 'ESTOQUE') return 'estoque';
  if (k === 'COMPRAR') return 'comprar';
  return null;
}

const ROTULO_STATUS: Record<Exclude<StatusEquip, null>, string> = {
  instalado: 'Instalado', no_cliente: 'No cliente', estoque: 'Estoque', comprar: 'Comprar',
};

/** "Comprar: inversor e estrutura", e junta os grupos com "; ". */
function detalheMaterial(itens: Array<[string, StatusEquip]>): string | null {
  const grupos = new Map<string, string[]>();
  for (const [nome, st] of itens) {
    if (st === 'instalado' || st === 'no_cliente') continue;
    const rot = st ? ROTULO_STATUS[st] : 'Sem status';
    grupos.set(rot, [...(grupos.get(rot) || []), nome]);
  }
  if (!grupos.size) return null;
  return [...grupos.entries()].map(([rot, nomes]) => `${rot}: ${juntar(nomes)}`).join('; ');
}

function juntar(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}

// ── Etapas ───────────────────────────────────────────────────────────────────

export function montarEtapas(o: ObraBruta): Etapa[] {
  const vendaEm = parseDataBR(o.cadastroTrello);
  const parecer = parseDataBR(o.parecerAcesso);
  const entrega = parseDataBR(o.entregaMaterial);
  const previsao = parseDataBR(o.previsaoMontagem);
  const inicio = parseDataBR(o.inicioInstalacao);
  const fim = parseDataBR(o.fimInstalacao);
  const pedidoVist = parseDataBR(o.pedidoVistoria);
  const liberVist = parseDataBR(o.liberacaoVistoria);

  // Material: vale o que está preenchido. Equipamento sem status não trava a
  // etapa (o cliente pode ter só placa e inversor), mas os três vazios não
  // provam nada, e aí só a data de entrega fecha a etapa.
  const itens: Array<[string, StatusEquip]> = [
    ['placas', statusEquip(o.statusPlaca)],
    ['inversor', statusEquip(o.statusInversor)],
    ['estrutura', statusEquip(o.statusEstrutura)],
  ];
  // Texto preenchido mas desconhecido ("sim") conta como preenchido e NÃO ok.
  const preenchido = [o.statusPlaca, o.statusInversor, o.statusEstrutura].map((x) => !!x.trim());
  const algumPreenchido = preenchido.some(Boolean);
  const todosOk = algumPreenchido && itens.every(([, st], i) =>
    !preenchido[i] || st === 'instalado' || st === 'no_cliente');
  const materialFeito = todosOk || !!entrega;
  const faltam = itens.filter(([, st], i) => preenchido[i] && st !== 'instalado' && st !== 'no_cliente');
  const detalheMat = materialFeito ? null
    : (detalheMaterial(faltam) || (algumPreenchido ? null : 'sem status dos equipamentos'));

  let detalheInst: string | null = null;
  if (!fim) {
    if (inicio) detalheInst = `iniciada em ${ddmm(inicio)}`;
    else if (previsao) detalheInst = `prevista para ${ddmm(previsao)}`;
  }

  const etapa = (chave: ChaveEtapa, feito: boolean, em: string | null, detalhe: string | null = null): Etapa =>
    ({ chave, rotulo: ROTULOS[chave], feito, em, detalhe });

  const etapas = [
    // A venda existe porque a linha existe; a data só pode faltar.
    etapa('venda', true, vendaEm),
    etapa('projeto', !!parecer, parecer),
    etapa('material', materialFeito, entrega, detalheMat),
    etapa('instalacao', !!fim, fim, detalheInst),
    etapa('vistoria', !!liberVist, liberVist, !liberVist && pedidoVist ? `pedida em ${ddmm(pedidoVist)}` : null),
    etapa('liberado', chaveTexto(o.liberadoTxt) === 'LIBERADO', null),
  ];
  // Buraco: não feita, mas há etapa feita depois dela.
  const ultima = etapas.reduce((u, e, i) => (e.feito ? i : u), -1);
  etapas.forEach((e, i) => { if (!e.feito && i < ultima) e.semRegistro = true; });
  return etapas;
}

/**
 * A etapa SEGUINTE à última feita (ou `concluida` quando a última feita é a
 * liberação). Etapa não feita antes da última feita é buraco da planilha: a obra
 * já passou dali, então ela não segura a obra (e vem marcada `semRegistro`).
 */
export function etapaAtualDe(etapas: Etapa[]): ChaveEtapa | 'concluida' {
  let ultima = -1;
  etapas.forEach((e, i) => { if (e.feito) ultima = i; });
  return ultima + 1 >= etapas.length ? 'concluida' : etapas[ultima + 1].chave;
}

/** Dias desde a data mais recente entre as etapas feitas; null se concluída ou sem data. */
export function paradoHaDias(etapas: Etapa[], hoje: string): number | null {
  if (etapaAtualDe(etapas) === 'concluida') return null;
  const datas = etapas.filter((e) => e.feito && e.em).map((e) => e.em as string).sort();
  if (!datas.length) return null;
  return Math.max(0, diasEntre(datas[datas.length - 1], hoje));
}

// ── Origem, recebimento, depoimento ──────────────────────────────────────────

export function classificarOrigem(texto: string): OrigemObra {
  const t = String(texto || '').trim();
  const k = chaveTexto(t);
  const cod = t.match(/#\d+/);
  if (k.includes('RECORRENTE')) return { tipo: 'recorrente', texto: t, indicadoPor: null };
  if (k.includes('INDICA') || /^#\d+/.test(t)) {
    return { tipo: 'indicacao', texto: t, indicadoPor: cod ? codigoCanonico(cod[0]) : null };
  }
  if (k.includes('TRAFEGO')) return { tipo: 'trafego', texto: t, indicadoPor: null };
  return { tipo: 'outro', texto: t, indicadoPor: null };
}

/** "#13" e "#0013" são a mesma venda. */
export function codigoCanonico(c: string): string {
  const n = String(c).replace(/\D/g, '');
  return n ? `#${n.padStart(4, '0')}` : String(c);
}

function recebimentoDe(s: string): ObraMontada['recebimento'] {
  const k = chaveTexto(s);
  if (k === 'QUITADO') return 'quitado';
  if (k === 'NAO QUITADO') return 'nao_quitado';
  return 'sem_registro';
}

function depoimentoDe(s: string): ObraMontada['depoimento'] {
  const k = chaveTexto(s);
  if (k === 'SIM') return 'sim';
  if (k === 'PEDIDO') return 'pedido';
  if (k === 'INSATISFEITO') return 'insatisfeito';
  if (k === 'NAO FAZ') return 'nao_faz';
  return null;
}

/** Monta a obra completa (com valores; quem decide mostrar é a rota). */
export function montarObra(o: ObraBruta, hoje: string): ObraMontada {
  const etapas = montarEtapas(o);
  const recebimento = recebimentoDe(o.recebimento);
  const feita = (c: ChaveEtapa) => !!etapas.find((e) => e.chave === c)?.feito;
  return {
    codigo: o.codigo,
    cliente: o.cliente || o.homologacao,
    homologacao: o.homologacao,
    consultor: o.consultor,
    telefone: normFone(o.telefone),
    endereco: o.endereco,
    cidade: o.cidade,
    uf: o.uf.toUpperCase(),
    concessionaria: o.concessionaria,
    equipe: o.equipe,
    engenheiro: o.engenheiro,
    sistema: {
      placas: inteiroOuNull(o.qtdPlaca), modeloPlaca: o.modeloPlaca,
      inversores: inteiroOuNull(o.qtdInv), inversor: o.modeloInversor, estrutura: o.tipoEstrutura,
    },
    vendaEm: etapas[0].em,
    etapas,
    etapaAtual: etapaAtualDe(etapas),
    paradoHaDias: paradoHaDias(etapas, hoje),
    recebimento,
    valores: {
      venda: o.valorVenda,
      recebido: o.recebidoReal,
      // Só o "Não Quitado" tem saldo: sem registro não é dívida provada.
      aReceber: recebimento === 'nao_quitado' ? Math.max(0, o.valorVenda - o.recebidoReal) : 0,
    },
    depoimento: depoimentoDe(o.depoimentoTxt),
    origem: classificarOrigem(o.origem),
    instalada: feita('instalacao'),
    liberada: feita('liberado'),
  };
}

// ── Quando pedir depoimento e indicação ──────────────────────────────────────

export const DIAS_ENTRE_PEDIDOS = { depoimento: 30, indicacao: 60 };

function recente(iso: string | null | undefined, dias: number, agora: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && agora.getTime() - t < dias * 86_400_000;
}

/** Só se pede o que o cliente já pode dar: sistema no ar (liberado + instalado).
 *  O cliente insatisfeito não recebe pedido de indicação, e o que já foi pedido
 *  pelo app esfria 30 dias (depoimento) ou 60 (indicação) antes de pedir de novo. */
export function calcularPedir(
  o: Pick<ObraMontada, 'liberada' | 'instalada' | 'depoimento'>,
  marcas: Marcas,
  agora: Date,
): { depoimento: boolean; indicacao: boolean } {
  const pronto = o.liberada && o.instalada;
  return {
    depoimento: pronto && (o.depoimento === null || o.depoimento === 'pedido')
      && !recente(marcas.depoimentoPedidoEm, DIAS_ENTRE_PEDIDOS.depoimento, agora),
    indicacao: pronto && o.depoimento !== 'insatisfeito'
      && !recente(marcas.indicacaoPedidaEm, DIAS_ENTRE_PEDIDOS.indicacao, agora),
  };
}

/** Normaliza o `value` do system_state (pode vir torto) para o formato fixo. */
export function marcasDe(value: unknown): Marcas {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
  return {
    depoimentoPedidoEm: str(v.depoimentoPedidoEm),
    indicacaoPedidaEm: str(v.indicacaoPedidaEm),
    por: str(v.por),
  };
}

// ── Quem pode ver o quê ──────────────────────────────────────────────────────

/** Sócios: SOLAR_SOCIOS (nomes separados por vírgula). Lido a cada chamada.
 *  Só minúscula e aparar: SEM tirar acento. O nome vem do e-mail da conta, e uma
 *  conta `thiagó@` não pode virar a sócia `thiago`. */
export function listaSocios(env: string | undefined = process.env.SOLAR_SOCIOS): string[] {
  const bruto = env && env.trim() ? env : 'thiago,diego';
  return bruto.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

export function ehSocio(nome: string, env?: string): boolean {
  return listaSocios(env).includes(String(nome ?? '').trim().toLowerCase());
}

/** Sócio vê tudo; consultor vê só as vendas em que a coluna CONSULTOR é ele.
 *  Acento e caixa se tiram SÓ do lado da planilha (lá se digita "José"); o nome
 *  da conta é comparado exato, pelo mesmo motivo da checagem de sócio. */
export function podeVer(nome: string, consultorDaVenda: string, env?: string): boolean {
  const meu = String(nome ?? '').trim().toLowerCase();
  return ehSocio(meu, env) || (!!meu && nomeSimples(consultorDaVenda) === meu);
}

// ── Ordem e resumo ───────────────────────────────────────────────────────────

function dataMaisRecente(o: ObraMontada): string {
  return o.etapas.filter((e) => e.feito && e.em).map((e) => e.em as string).sort().pop() || '';
}

/** Em andamento primeiro (a mais parada no topo), concluídas depois (a mais recente no topo). */
export function ordenarObras<T extends ObraMontada>(obras: T[]): T[] {
  const andamento = obras.filter((o) => o.etapaAtual !== 'concluida');
  const concluidas = obras.filter((o) => o.etapaAtual === 'concluida');
  // Sem data não dá para medir quanto está parada: vai para o fim do grupo.
  andamento.sort((a, b) => (b.paradoHaDias ?? -1) - (a.paradoHaDias ?? -1) || b.codigo.localeCompare(a.codigo));
  concluidas.sort((a, b) => dataMaisRecente(b).localeCompare(dataMaisRecente(a)) || b.codigo.localeCompare(a.codigo));
  return [...andamento, ...concluidas];
}

export function resumirObras(obras: ObraMontada[], comDinheiro: boolean) {
  const porEtapa: Record<string, number> = { projeto: 0, material: 0, instalacao: 0, vistoria: 0, liberado: 0 };
  let emAndamento = 0;
  for (const o of obras) {
    if (o.etapaAtual === 'concluida') continue;
    emAndamento++;
    porEtapa[o.etapaAtual] = (porEtapa[o.etapaAtual] || 0) + 1;
  }
  const resumo: {
    total: number; emAndamento: number; concluidas: number;
    porEtapa: Record<string, number>; naoQuitadas: number; aReceber?: number;
  } = {
    total: obras.length, emAndamento, concluidas: obras.length - emAndamento, porEtapa,
    naoQuitadas: obras.filter((o) => o.recebimento === 'nao_quitado').length,
  };
  if (comDinheiro) resumo.aReceber = obras.reduce((s, o) => s + o.valores.aReceber, 0);
  return resumo;
}

// ── Indicações (a partir da origem da planilha) ──────────────────────────────

export interface LinhaRanking { codigo: string; cliente: string; indicou: number; vendas: string[] }

/** Quem indicou quem. `nomes` resolve o código do indicador para o nome dele.
 *  `indicadoresPermitidos`, quando vem, limita o ranking a indicadores desse
 *  conjunto (consultor comum: só quem indicou e é cliente dele). */
export function montarRanking(
  obras: ObraMontada[],
  nomes: Map<string, string>,
  indicadoresPermitidos?: Set<string>,
): LinhaRanking[] {
  const por = new Map<string, string[]>();
  for (const o of obras) {
    const quem = o.origem.tipo === 'indicacao' ? o.origem.indicadoPor : null;
    if (!quem) continue;
    if (indicadoresPermitidos && !indicadoresPermitidos.has(quem)) continue;
    por.set(quem, [...(por.get(quem) || []), o.codigo]);
  }
  return [...por.entries()].map(([codigo, vendas]) => ({
    codigo,
    // O nome vem da origem escrita ("#0013 Cleber") e só na falta dela da venda
    // do indicador, que o consultor pode nem ter permissão de ver.
    cliente: nomes.get(codigo) || '',
    indicou: vendas.length,
    vendas: vendas.sort(),
  })).sort((a, b) => b.indicou - a.indicou || a.codigo.localeCompare(b.codigo));
}

/** Nome escrito na origem depois do código: "#0013 Cleber" vira "Cleber". */
export function nomeNaOrigem(texto: string): string {
  return String(texto || '').replace(/#\d+/, '').replace(/indica[cç][aã]o/i, '').replace(/^[\s:\-]+|[\s:\-]+$/g, '').trim();
}

// ── Mapa ─────────────────────────────────────────────────────────────────────

export interface PontoMapa { cidade: string; uf: string; lat: number; lng: number; instaladas: number; emAndamento: number }

/**
 * Uma linha por município, sem nenhum dado de cliente (isto pode ser mostrado
 * a um cliente em visita). Instalada = etapa instalação feita; "em andamento" é
 * o resto (ainda sem instalação), de modo que as duas colunas somam o total.
 */
export function montarMapa(obras: ObraMontada[]): {
  cidades: PontoMapa[]; semCoordenada: number; semCoordenadaLista: string[];
} {
  const pontos = new Map<number, PontoMapa>();
  const sem = new Set<string>();
  let semQtd = 0;
  for (const o of obras) {
    const cidade = o.cidade.trim();
    if (!cidade) { semQtd++; continue; }
    const r = resolverCidade(o.uf ? `${cidade}-${o.uf}` : cidade);
    if (r.status !== 'ok' || r.ibge == null || r.lat == null || r.lng == null) {
      // O texto cru da coluna CIDADE é digitação livre: só a lista (que a rota
      // entrega a sócio) leva o texto; para todos os outros vai a contagem.
      semQtd++;
      sem.add(o.uf ? `${cidade}/${o.uf}` : cidade);
      continue;
    }
    const p = pontos.get(r.ibge) || {
      cidade: r.municipio as string, uf: r.uf as string, lat: r.lat, lng: r.lng, instaladas: 0, emAndamento: 0,
    };
    if (o.instalada) p.instaladas++; else p.emAndamento++;
    pontos.set(r.ibge, p);
  }
  return {
    cidades: [...pontos.values()].sort((a, b) => b.instaladas - a.instaladas || a.cidade.localeCompare(b.cidade)),
    semCoordenada: semQtd,
    semCoordenadaLista: [...sem].sort(),
  };
}
