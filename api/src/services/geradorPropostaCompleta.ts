// Orçamento solar do /gerador no papel do modelo 4 "Completa + Banco" da SolarDoc.
//
// Este módulo é PURO (dados do Gerador -> campos do template): sem banco, sem rede, sem relógio. A rota que lê a proposta
// e a empresa fica em routes/geradorOrcamentoCompleto.ts.
//
// REGRA: os números do /gerador mandam. O papel tem que dizer o mesmo que a tela e o texto do WhatsApp dizem ao cliente:
// preço, parcelas, validade, garantias, inversores. Por isso as parcelas vão PRONTAS (campos parcelas_*_prontas) e a
// validade vai como o instante exato (validade_ate_iso). Só o /gerador manda esses campos; a SolarDoc segue como sempre.
import { parseBRL, pmtPriceCarencia } from './propostaSolarBase';
import { cnpjValido, cpfValido, normalizarCnpj, soDigitos } from '../utils/documentoBr';
import { FOTOS_OBRA_IO } from './templates/fotosObraIo';

type Dados = Record<string, unknown>;

/**
 * A proposta do Gerador tem o que este papel precisa? Solar (não eletroposto), com o kit (item.n e tab.pot) e o preço. Proposta
 * solar antiga sem isso NÃO vira este papel: a rota devolve 404 e o /gerador usa o link antigo (?p=). O /gerador replica este
 * critério em orcOficialOk (index.html), e um teste compara os dois.
 */
export function orcamentoOficialDisponivel(dados: unknown): boolean {
  if (!ehObjeto(dados) || dados.produto === 'eletroposto') return false;
  const item = ehObjeto(dados.item) ? dados.item : null;
  const tab = ehObjeto(dados.tab) ? dados.tab : null;
  return !!item && !!tab && num(item.n) > 0 && num(tab.pot) > 0 && num(dados.precoOrcamento) > 0;
}

/** Inflação em %: zero digitado vale zero; só ausente (ou texto sem número) cai no padrão de 6%. */
function pctInflacao(v: unknown): string {
  if (v === null || v === undefined || v === '') return '6';
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 10) : '6';
}

/** O que o template lê da empresa (company da SolarDoc). Sem dados bancários: ficam desligados. */
export interface EmpresaOrcamento {
  nome: string;
  nome_fantasia?: string;
  cnpj: string;
  endereco?: string;
  socio_adm?: string;
  cor_marca?: string;
  cor_secundaria?: string;
  logo_base64?: string;
  whatsapp?: string;
  cidade?: string;
}

export interface ClienteOrcamento {
  nome: string;
  cidade: string;
  uf: string;
  tipo_telhado: string;
}

export interface CamposOrcamento {
  fields: Record<string, unknown>;
  client: ClienteOrcamento;
  company: EmpresaOrcamento;
}

// Cargo de quem assina pela empresa na folha de aceite. A company não tem coluna de cargo; este é o das propostas
// modelo 4 que o dono emite na SolarDoc ("Sócio administrador").
export const CARGO_ASSINANTE = 'Sócio administrador';

// Acréscimo do cartão por nº de parcelas: CÓPIA de TABELA_CARTAO_ATE_11_11 do dashboard/public/gerador/index.html (a tabela
// com que as propostas foram feitas até 11/11/2026; os valores NÃO mudam com a tabela nova). Só serve para proposta antiga
// que não guardou `parcelasCartao`; a nova sempre guarda e vale o que está guardado.
const TABELA_CARTAO: Record<number, number> = {
  1: 0.0539, 2: 0.0709, 3: 0.0765, 4: 0.0815, 5: 0.0869,
  6: 0.0919, 7: 0.1009, 8: 0.1069, 9: 0.1125, 10: 0.1179,
  11: 0.1239, 12: 0.1269, 13: 0.1355, 14: 0.1399, 15: 0.1469,
  16: 0.1529, 17: 0.1585, 18: 0.1649, 19: 0.1739, 20: 0.1839,
  21: 0.1928,
};
const FIN_TAXA = 0.022;
const FIN_CARENCIA_MESES = 4;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** Número como texto pt-BR com 2 casas ("21497,50"): é o formato que o parseBRL do template lê sem errar o ponto. */
function ptBR(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
}

/** "Uberlândia, MG" / "Uberlândia-MG" / "Uberlândia MG" -> cidade e UF. Sem UF, UF vazia. */
export function separarCidadeUf(bruto: unknown): { cidade: string; uf: string } {
  const s = txt(bruto);
  const m = /^(.*?)[\s,\-/]+([A-Za-z]{2})$/.exec(s);
  return m ? { cidade: m[1].trim(), uf: m[2].toUpperCase() } : { cidade: s, uf: '' };
}

/** "SAJ 6K" -> { marca: 'SAJ', potencia: '6' }; "Micro Holmilles 2,0KW" -> { marca: 'Micro Holmilles', potencia: '2,0' }. */
export function separarInversor(bruto: unknown): { marca: string; potencia: string } {
  const s = txt(bruto);
  const m = /(\d+(?:[.,]\d+)?)\s*k(?:w)?\b/i.exec(s);
  if (!m) return { marca: s, potencia: '' };
  const marca = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim();
  return { marca, potencia: m[1].replace('.', ',') };
}

/** "TCL 600W" -> "TCL"; "TCU" -> "TCU". A potência vem do campo próprio. */
export function marcaDoModulo(bruto: unknown): string {
  return txt(bruto).replace(/\s*\d+\s*w\s*$/i, '').trim();
}

/** Parcelas do cartão marcadas, no formato novo ({ ativo, parcelas: [..] }) ou no antigo ({ p10, p12, p18 }). */
function parcelasDoCartao(po: Dados): number[] {
  const c = po.cartao;
  if (!ehObjeto(c) || c.ativo !== true) return [];
  if (Array.isArray(c.parcelas)) {
    return [...new Set(c.parcelas.map((n) => Math.round(num(n))).filter((n) => n >= 1 && n <= 21))].sort((a, b) => a - b);
  }
  return ([[10, c.p10], [12, c.p12], [18, c.p18]] as const).filter(([, on]) => on === true).map(([n]) => n);
}

function valorCartao(d: Dados, n: number, base: number): number {
  const guardado = ehObjeto(d.parcelasCartao) ? num((d.parcelasCartao as Dados)[String(n)]) : 0;
  if (guardado > 0) return guardado;
  const antigo = n === 10 ? num(d.parc10x) : n === 12 ? num(d.parc12x) : n === 18 ? num(d.parc18x) : 0;
  if (antigo > 0) return antigo;
  const acresc = TABELA_CARTAO[n];
  return acresc != null && base > 0 ? (base * (1 + acresc)) / n : 0;
}

function valorFin(d: Dados, n: 36 | 48 | 60, base: number): number {
  const guardado = num(d[`fin${n}x`]);
  return guardado > 0 ? guardado : pmtPriceCarencia(base, FIN_TAXA, n, FIN_CARENCIA_MESES);
}

/** Quem assina pelo cliente na folha de aceite: o nome e o documento digitados no /gerador (CPF = pessoa física, CNPJ = jurídica). */
export interface AssinarCliente { nome: string; documento: string }

/** Tipo pelo documento: CPF válido = PF; CNPJ válido (numérico ou alfanumérico) = PJ; qualquer outra coisa = null. */
export function tipoDoDocumento(doc: unknown): 'PF' | 'PJ' | null {
  if (cpfValido(soDigitos(doc)) && !/[A-Za-z]/.test(String(doc ?? ''))) return 'PF';
  return cnpjValido(doc) ? 'PJ' : null;
}

function assinaturaDoAceite(a: AssinarCliente, empresa: EmpresaOrcamento): Record<string, unknown> | null {
  const nome = txt(a.nome);
  const tipo = tipoDoDocumento(a.documento);
  if (!nome || !tipo || !empresa.nome) return null;
  return {
    ...(empresa.cidade ? { local: empresa.cidade } : {}),
    cliente: { nome, tipo, documento: tipo === 'PJ' ? normalizarCnpj(a.documento) : soDigitos(a.documento) },
    empresa: {
      razao_social: empresa.nome,
      cnpj: empresa.cnpj,
      ...(empresa.socio_adm ? { representante: empresa.socio_adm, cargo: CARGO_ASSINANTE } : {}),
    },
  };
}

// Obras do orçamento: no máximo as 10 PRIMEIRAS da galeria da empresa (na ordem dela) e, depois, as 2 fotos fixas de telhado
// solar do site da Irmãos na Obra (sem legenda: a legenda vazia não desenha caixa). Galeria menor: as que houver + as 2.
export const MAX_OBRAS_GALERIA = 10;

export function fotosDeObraDoOrcamento(galeria: unknown): Array<{ url: string; legenda: string }> {
  const doDono = (Array.isArray(galeria) ? galeria : [])
    .filter((f): f is { url: string; legenda?: unknown } => ehObjeto(f) && typeof f.url === 'string' && f.url.trim() !== '')
    .slice(0, MAX_OBRAS_GALERIA)
    .map((f) => ({ url: f.url, legenda: txt(f.legenda) }));
  return [...doDono, ...FOTOS_OBRA_IO.map((f) => ({ ...f }))];
}

const MODOS_ENTRADA = new Set(['dias', 'contrato', 'entrega', 'montagem', 'liberacao']);

/** A empresa como o template a lê. Pega só o que o papel usa: sem dados bancários, sem e-mail pessoal. */
export function empresaParaTemplate(row: Record<string, unknown>): EmpresaOrcamento {
  return {
    nome: txt(row.nome),
    nome_fantasia: txt(row.nome_fantasia),
    cnpj: txt(row.cnpj),
    endereco: txt(row.endereco),
    socio_adm: txt(row.socio_adm),
    cor_marca: txt(row.cor_marca),
    cor_secundaria: txt(row.cor_secundaria),
    logo_base64: txt(row.logo_base64),
    whatsapp: txt(row.whatsapp),
    cidade: txt(row.cidade),
  };
}

/**
 * `dados` da proposta do Gerador (+ o código e o created_at da linha, + a empresa) -> o que o template do modelo 4 lê.
 * As fotos de obra da empresa NÃO entram aqui (precisam de URL assinada): a rota coloca `fotos_obras` depois.
 */
export function montarCamposOrcamento(
  dados: Dados,
  ctx: { codigo: string; criadaEm?: string | null; empresa: EmpresaOrcamento; assinar?: AssinarCliente | null },
): CamposOrcamento {
  const d = dados || {};
  const empresa = ctx.empresa;
  const tab = ehObjeto(d.tab) ? d.tab : {};
  const item = ehObjeto(d.item) ? d.item : {};
  const nome = txt(d.nome);
  const { cidade, uf } = separarCidadeUf(d.cidade);
  // MG é o estado da casa: só entra se a cidade veio sem UF (o /gerador sempre manda os dois).
  const ufFinal = uf || 'MG';

  const precoOrcamento = num(d.precoOrcamento);
  const precoVista = num(d.precoVista);
  const mediaGerada = num(d.mediaMensalGerada) || num(item.g);
  // Sem consumo informado (modo "por placas"), o /gerador calcula economia e retorno com a geração como consumo.
  // O papel faz a mesma conta, então o valor entra no mesmo campo.
  const consumo = num(d.consumoKwh) > 0 ? num(d.consumoKwh) : mediaGerada;

  const inv = separarInversor(tab.inv);
  const qtdInv = Math.max(1, Math.round(num(d.qtdInv)) || Math.round(num(item.invs)) || 1);
  const garInv = txt(d.garInv);

  const po = ehObjeto(d.pagOpts)
    ? d.pagOpts
    : { vista: true, cartao: { ativo: true, parcelas: [10, 12, 18] }, fin: { ativo: true, p36: false, p48: true, p60: true } };
  const cartaoN = parcelasDoCartao(po);
  const fin = ehObjeto(po.fin) ? po.fin : {};
  const finLigado = fin.ativo === true;
  const finPrazos = ([36, 48, 60] as const).filter((n) => finLigado && fin[`p${n}`] === true);
  const entrada = ehObjeto(po.entrada) ? po.entrada : {};
  const entradaValor = parseBRL(entrada.valor);
  const modoEntrada = txt(entrada.modo);

  const fields: Record<string, unknown> = {
    codigo: ctx.codigo,
    emitido_em: txt(ctx.criadaEm) || txt(d.dataEmissao),
    cidade,
    uf: ufFinal,
    tipo_telhado: txt(d.telhado),

    consumo_kwh: ptBR(consumo),
    tarifa_kwh: ptBR(num(d.tarifa) > 0 ? num(d.tarifa) : 1.09),
    taxa_minima: ptBR(num(d.taxaMin) > 0 ? num(d.taxaMin) : 95),
    inflacao_aa: pctInflacao(d.inflTarifa),
    taxa_minima_inflacao_aa: pctInflacao(d.inflTaxaMin),
    // O template trata 0 como "não preenchido" (vira 6%). Aqui o 0% que o consultor digitou vale: só o /gerador liga isto.
    inflacao_zero_vale: true,
    geracao_media_kwh: ptBR(mediaGerada),

    qtd_modulos: String(Math.round(num(item.n))),
    potencia_modulo: String(Math.round(num(tab.pot))),
    marca_modulo: marcaDoModulo(tab.mod),
    inversores: [{ qtd: String(qtdInv), marca: inv.marca, potencia: inv.potencia, garantia: garInv }],
    garantia_inversor: garInv,
    garantia_paineis: txt(d.garPaineis),
    garantia_estrutura: txt(d.garEstrutura),
    garantia_instalacao: txt(d.garInstalacao),
    garantia_instalacao_unidade: 'anos',
    prazo_instalacao_dias: txt(d.prazoInstalacao),

    investimento: ptBR(precoOrcamento),
    preco_avista: ptBR(precoVista),

    // Pagamento: o que o consultor marcou, com as parcelas PRONTAS (as do /gerador, arredondadas como ele as imprime).
    pag_vista: po.vista !== false,
    pag_cartao: cartaoN.length > 0,
    pag_fin: finPrazos.length > 0,
    parcelas_cartao_prontas: Object.fromEntries(cartaoN.map((n) => [String(n), Math.round(valorCartao(d, n, precoOrcamento))])),
    parcelas_fin_prontas: Object.fromEntries(finPrazos.map((n) => [String(n), Math.round(valorFin(d, n, precoOrcamento))])),
    pag_entrada: entrada.ativo === true && entradaValor > 0,
    entrada_valor: ptBR(entradaValor),
    entrada_modo: MODOS_ENTRADA.has(modoEntrada) ? modoEntrada : 'liberacao',
    entrada_dias: txt(entrada.dias) || '30',
    pag_custom: txt(po.custom),

    // Validade: o instante que o /gerador mostra ("sexta às 18h"), ou os dias corridos do modo "por dias".
    validade_dias: String(Math.max(1, Math.round(num(d.validadeDias)) || 7)),
    ...(txt(d.expiraEmISO) ? { validade_ate_iso: txt(d.expiraEmISO) } : {}),

    vendedor_nome: txt(d.consultor),
    vendedor_whatsapp: txt(d.consultorWhats),
    mostrar_vendedor_nome: true,
    mostrar_vendedor_contato: true,
    mostrar_cnpj: true,
    empresa_cnpj: empresa.cnpj,

    // Fio B, dados bancários e logos de banco ficam como estão: desligados, desligados e os 12 bancos fixos.
    foto_telhado_b64: txt(d.fotoTelhado),
  };
  for (const n of cartaoN) fields[`pag_cartao_${n}`] = true;
  for (const n of finPrazos) fields[`pag_fin_${n}`] = true;

  // Bateria: só com a marca (o template a exige). Sem marca a linha não sai, em vez de sair com texto inventado.
  const bat = ehObjeto(d.bateria) ? d.bateria : null;
  if (bat && txt(bat.modelo)) {
    fields.bateria_marca = txt(bat.modelo);
    fields.bateria_capacidade_kwh = txt(bat.capacidade);
    fields.bateria_qtd = txt(bat.qtd);
    fields.bateria_garantia_anos = txt(bat.garantiaAnos);
  }

  // Aceite: SÓ quando o consultor escolheu "Assinatura: Sim" e digitou nome e CPF/CNPJ do cliente (ctx.assinar). Sem isso o
  // papel sai sem folha de aceite, em todo lugar. O documento nunca é gravado na proposta: ele chega só no corpo do POST do PDF.
  const aceite = ctx.assinar ? assinaturaDoAceite(ctx.assinar, empresa) : null;
  if (aceite) fields.assinatura = aceite;

  return { fields, client: { nome, cidade, uf: ufFinal, tipo_telhado: txt(d.telhado) }, company: empresa };
}
