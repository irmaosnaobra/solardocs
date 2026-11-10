/**
 * PROPOSTA OFF-GRID, MODELO 2 "OFF-GRID COMPLETA": várias folhas A4 em pé, no MESMO visual da proposta solar
 * "Completa + Banco" (cabeçalho, faixas, cartões, fotos, bancos, cronograma e aceite vêm de
 * propostaSolarPartes.ts e propostaSolarCompleta.ts; aqui só mora o que é do sistema isolado).
 *
 * REGRA DURA (a mesma do modelo 1): este template NÃO calcula nada do sistema. Autonomia, banco, kWp, preço,
 * parcelas e comparativo chegam prontos do motor do front (dashboard/src/lib/offgrid). Custo de fornecimento,
 * frete e margem do integrador não existem aqui: o cliente vê um preço só.
 *
 * Folhas: 1 Projeto · 2 Autonomia e consumo · 3 Investimento e pagamento ·
 *         4 Obras realizadas (só com 6 fotos ou mais, em 6, 9 ou 12) ·
 *         5 Comparativo, garantias e cronograma (o cronograma ganha folha própria se não couber) ·
 *         6 Aceite da proposta (só com assinatura VÁLIDA; leva o rodapé grande, senão ele fica na folha 5).
 *
 * Campos lidos além dos do modelo 1: endereco, fotos_obras (já mescladas e reassinadas pelo servidor),
 * bancos_logos (ausente = os 12), mostrar_dados_bancarios (só true liga), assinatura, aparelhos
 * (lista opcional: [{ nome, qtd, w, horas, essencial }]), codigo, garantia_instalacao(_unidade), garantia_estrutura.
 *
 * Modo do equipamento: `modo_equipamento` 'casa' (padrão) ou 'proprio'. No 'proprio' o integrador lista os itens dele
 * (`itens_cliente`) e nenhum texto cita o catálogo da casa; garantia só aparece para item que veio com `garantia`.
 * `kit_atende_placas` (boolean, só no próprio): `false` corta a promessa de que a geração cobre o mês de menos sol.
 *
 * Formas de pagamento da folha 3 (os MESMOS campos da proposta solar): preco_avista, pag_vista, pag_cartao, pag_cartao_N
 * + taxa_cartao_N, pag_fin, pag_fin_N + taxa_fin_N, pag_entrada, entrada_valor, entrada_modo, entrada_dias, pag_custom.
 * Chegou qualquer `pag_*` (ou `preco_avista`): as parcelas saem dos helpers solares e `parcela_cartao` e
 * `parcela_financiamento` são IGNORADOS em todo o documento. Nenhum chegou: o texto pronto de sempre.
 *
 * SEGURANÇA: o PDF sai no servidor (Puppeteer). Imagem só entra se passar em srcImagemSegura. Texto do
 * usuário passa por pEsc.
 */
import { pEsc, pKwp, pBRL, parseBRL, propostaEmissao, propostaValidade } from '../propostaSolarBase';
import { valorParcelaCartao, valorParcelaFin, FIN_PRAZOS, FIN_CARENCIA_MESES } from '../propostaSolarCalculos';
import {
  coresModelo1, cssRaizModelo1, CSS_MODELO1, dadosContato, cabecalhoModelo1, rodapeModelo1,
} from './propostaSolarPartes';
import {
  CSS_COMPLETO, ETAPAS_CRONOGRAMA, srcImagemSegura, lerObras, lerEmpresas,
  dataPorExtenso, docClienteCabecalho, docClienteHtml, svgIcone, type CompanyCompleta,
} from './propostaSolarCompleta';
import { BANCOS_FIXOS, bancosEscolhidos } from './bancosLogos';
import { formatarCnpj, normalizarAssinatura, validarAssinatura } from '../../utils/documentoBr';
import { dadosBancariosCompletos, normalizarDadosBancarios } from '../../utils/dadosBancarios';

export interface ClienteOffGrid {
  nome: string;
  cidade?: string;
  uf?: string;
  endereco?: string;
}

interface ItemCliente { nome: string; qtd: number; garantia?: number }
interface Aparelho { nome: string; qtd: number; w: number; horas: number; essencial: boolean }
interface OpcaoComp {
  id: string; nome: string; entrada: number; mensal: number; total: number;
  porKwh: number; linhas: { rotulo: string; valor: number }[]; observacao: string;
}

// ─── Utilidades locais ───────────────────────────────────────────────────────

function n(v: unknown, def = 0): number {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return isFinite(x) ? x : def;
}
function ehObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
const dec = (v: unknown, casas = 1): string => n(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
const brl = (v: unknown): string => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const brl2 = (v: unknown): string => n(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const cap1 = (t: string): string => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const anosTxt = (v: number): string => `${v} ${v === 1 ? 'ano' : 'anos'}`;

/** Dias fracionados viram linguagem de gente: 2,13 vira "2 dias e 3 horas". Nunca devolve travessão. */
export function tempoOffGrid(dias: number): string {
  if (!isFinite(dias) || dias <= 0) return 'menos de 1 hora';
  if (dias < 1) {
    const h = Math.round(dias * 24);
    return h <= 0 ? 'menos de 1 hora' : `${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  let d = Math.floor(dias);
  let h = Math.round((dias - d) * 24);
  if (h >= 24) { d += 1; h = 0; }
  const base = `${d} ${d === 1 ? 'dia' : 'dias'}`;
  return h > 0 ? `${base} e ${h} ${h === 1 ? 'hora' : 'horas'}` : base;
}

/** Texto técnico do catálogo vira linguagem do cliente: nada de "string" nem de sigla de tensão. */
function limpar(t: string): string {
  return cap1(t
    .replace(/string\s*box(\s+CC)?/gi, 'caixa de proteção CC')
    .replace(/\bstrings?\b/gi, 'conjunto de placas')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim());
}

// Limites de sanidade: acima disso o número é lixo (ou ataque) e é descartado, nunca impresso.
const MAX_VALOR = 10_000_000;
const MAX_UNIDADES = 9999;
const MAX_GARANTIA_ANOS = 99;
const MAX_ITENS = 20;
const MAX_CUSTOM = 500;

/** Valor em reais: número ou texto brasileiro ("78.900,50"). Negativo, zero, NaN ou acima de R$ 10 milhões vira 0. */
function moeda(v: unknown): number {
  let x: number;
  if (typeof v === 'number') x = v;
  else {
    const s = String(v ?? '').replace(/[R$\s]/g, '');
    x = s.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(s) ? parseBRL(s) : parseFloat(s);
  }
  return isFinite(x) && x > 0 && x <= MAX_VALOR ? x : 0;
}

/** Real inteiro quando não há centavos; com centavos quando há. */
const brlAuto = (v: number): string => (Math.abs(v - Math.round(v)) < 0.005 ? brl(v) : brl2(v));

function lerItens(v: unknown): ItemCliente[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 200).flatMap((it): ItemCliente[] => {
    if (!ehObjeto(it)) return [];
    const nome = limpar(String(it.nome ?? '').slice(0, 120));
    const qtd = Math.round(n(it.qtd));
    if (!nome || qtd <= 0 || qtd > MAX_UNIDADES) return [];
    const garantia = Math.round(n(it.garantia));
    return [{ nome, qtd, ...(garantia > 0 && garantia <= MAX_GARANTIA_ANOS ? { garantia } : {}) }];
  }).slice(0, MAX_ITENS);
}

/** Cópia de `f` em que taxa de cartão e de financiamento fora de (0, 100] some, e o helper solar cai na taxa padrão. */
function comTaxasSeguras(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...f };
  for (const k of Object.keys(out)) {
    if (!/^taxa_(cartao|fin)_\d+$/.test(k)) continue;
    const t = parseFloat(String(out[k] ?? '').replace(',', '.'));
    if (!(t > 0 && t <= 100)) delete out[k];
  }
  return out;
}

function lerAparelhos(v: unknown): Aparelho[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 40).flatMap((it): Aparelho[] => {
    if (!ehObjeto(it)) return [];
    const nome = limpar(String(it.nome ?? '').slice(0, 80));
    const qtd = Math.max(1, Math.round(n(it.qtd, 1)));
    if (!nome) return [];
    return [{ nome, qtd, w: Math.round(n(it.w)), horas: n(it.horas), essencial: it.essencial === true }];
  });
}

// ─── CSS próprio (prefixo og, em cima do CSS do modelo 1 e do Completo) ──────

const CSS_OFFGRID = `
.page .ogTiles{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:10px; }
.ogTiles .tile .s{ font-size:10.5px; font-weight:700; color:#39404C; margin-top:4px; line-height:1.25; }
.ogAut{ background:linear-gradient(135deg,var(--c1),var(--c2)); color:#fff; border-radius:14px; padding:12px 18px; display:flex; justify-content:space-between; align-items:center; gap:14px; margin-bottom:10px; }
.ogAut .k{ font-size:10.5px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; opacity:.85; }
.ogAut .v{ font-size:26px; font-weight:900; line-height:1.05; margin-top:2px; }
.ogAut .s{ font-size:11px; opacity:.9; text-align:right; max-width:270px; line-height:1.35; }
.ogRows .r{ padding:6px 14px; }
.ogRows.cp .r{ padding:5px 14px; font-size:11.5px; }
.ogRows.cp.dn .r{ padding:3px 14px; font-size:11px; }
.ogRows .r .lab{ min-width:0; overflow-wrap:anywhere; }
.ogRows .r .inc.qt{ flex:none; white-space:nowrap; }
.ogBig{ background:linear-gradient(135deg,var(--c1),var(--c2)); color:#fff; border-radius:14px; padding:14px 20px; margin-bottom:6px; }
.ogBig .k{ font-size:10.5px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; opacity:.85; }
.ogBig .v{ font-size:32px; font-weight:900; line-height:1.05; margin-top:3px; }
.ogBig .s{ font-size:11px; opacity:.9; margin-top:6px; line-height:1.45; }
.dois .hi .v.num{ overflow-wrap:anywhere; }
.ogCen{ display:grid; grid-template-columns:1fr auto; align-items:center; gap:14px; border:1px solid var(--line); border-left:5px solid var(--accent); border-radius:12px; padding:7px 14px; margin-bottom:6px; }
.ogCen .t{ font-size:12.5px; font-weight:800; color:var(--ink); }
.ogCen .d{ font-size:10.5px; color:var(--muted); line-height:1.4; margin-top:2px; }
.ogCen .v{ font-size:17px; font-weight:900; color:var(--c1); text-align:right; line-height:1.15; }
.ogTxt{ font-size:10.5px; line-height:1.5; color:#39404C; background:var(--c3); border-left:4px solid var(--c1); border-radius:0 10px 10px 0; padding:7px 12px; }
.ogApar{ display:grid; grid-template-columns:1fr 1fr; gap:4px 10px; }
.ogApar .ap{ display:flex; justify-content:space-between; align-items:center; gap:8px; border:1px solid var(--line); border-radius:8px; padding:4px 9px; font-size:10.5px; background:#fff; }
.ogApar .ap .nm{ font-weight:700; color:#39404C; line-height:1.2; }
.ogApar .ap .qt{ font-weight:800; color:var(--c1); white-space:nowrap; font-size:10px; }
.ogApar .ap.es{ border-left:4px solid var(--accent); }
.ogLeg{ font-size:9.5px; color:var(--muted); margin-top:4px; }
.ogCmp{ display:grid; gap:8px; }
.ogCmp .oc{ border:1px solid var(--line); border-radius:12px; padding:9px 12px; background:#fff; }
.ogCmp .oc.w{ border:2px solid var(--c1); background:var(--c3); }
.ogCmp .oc .nm{ font-size:11px; font-weight:800; color:var(--ink); line-height:1.25; min-height:27px; }
.ogCmp .oc .tt{ font-size:20px; font-weight:900; color:var(--c1); line-height:1.1; margin-top:3px; }
.ogCmp .oc .ta{ font-size:9.5px; font-weight:700; color:var(--muted); }
.ogCmp .oc .ln2{ display:flex; justify-content:space-between; gap:6px; font-size:10px; color:var(--muted); padding-top:3px; }
.ogCmp .oc .ln2 b{ color:var(--ink); font-weight:800; }
.ogCmp .oc .pk{ margin-top:5px; padding-top:4px; border-top:1px solid var(--line); font-size:10px; color:var(--muted); }
.ogCmp .oc .pk b{ color:var(--ink); }
.ogCron .cr{ grid-template-columns:56px 1fr; gap:14px; padding-bottom:9px; }
.ogCron .cr:not(:last-child)::before{ left:27px; top:58px; bottom:2px; }
.ogCron .ci{ width:56px; height:56px; border-radius:15px; }
.ogCron .ci svg{ width:44px; height:44px; }
.ogCron .cd{ font-size:11px; line-height:1.4; margin-top:2px; }
.ogCron .ct{ font-size:13px; }
.ogGar{ display:grid; gap:8px; }
.sec.dist.og{ gap:16px; }
.ogCta{ padding:14px 18px; }
`;

// ─── Cronograma do sistema isolado: 5 etapas, sem homologação ────────────────

const SVG_CAIXA = svgIcone('<path class="ln ac" d="M8 22l24-12 24 12v26L32 60 8 48z"/><path class="ln" d="M8 22l24 12 24-12M32 34v26"/><path class="ln" d="M20 16l24 12"/>');
const SVG_LIGACAO = svgIcone('<rect class="ln ac" x="6" y="19" width="44" height="28" rx="5"/><path class="ln" d="M50 28h6v10h-6"/><path class="ln" d="M31 23l-9 13h8l-3 10 12-15h-8z" style="fill:var(--c1)"/>');

const ETAPAS_OFFGRID = [
  {
    t: 'Visita técnica',
    d: 'A equipe vai ao local e confere onde ficam as placas, as baterias e o inversor. Também confirma a lista de aparelhos que o sistema vai ligar.',
    svg: ETAPAS_CRONOGRAMA[1].svg,
  },
  {
    t: 'Projeto e dimensionamento',
    d: 'O engenheiro fecha o tamanho do banco, das placas e do inversor pelo seu consumo e pelo sol da região. Depois emite a ART, o registro da responsabilidade técnica.',
    svg: ETAPAS_CRONOGRAMA[0].svg,
  },
  {
    t: 'Entrega do kit',
    d: 'Os equipamentos saem do fornecedor e chegam ao local no prazo combinado. Você confere a lista antes de a instalação começar.',
    svg: SVG_CAIXA,
  },
  {
    t: 'Instalação',
    d: 'A equipe fixa a estrutura, monta as placas e instala o banco de baterias, o inversor e as proteções elétricas, seguindo o projeto.',
    svg: ETAPAS_CRONOGRAMA[2].svg,
  },
  {
    t: 'Ligação e treinamento',
    d: 'O sistema é ligado e testado com carga. A equipe mostra como acompanhar a bateria e quais aparelhos ligar ao mesmo tempo.',
    svg: SVG_LIGACAO,
  },
] as const;

// Altura útil de uma folha sem o topo (px): 1122 menos o topo de 46, com 6 de folga.
const LIMITE_FOLHA = 1070;
// Folha 1 não tem topo: 1122 menos 6 de folga. BASE_FOLHA1 = o que a folha 1 já tem sem a composição
// (medido 623 no pior caso de texto, mais 32 de folga para endereço longo).
const LIMITE_FOLHA1 = 1116;
const BASE_FOLHA1 = 655;

// ─── O template ──────────────────────────────────────────────────────────────

export function propostaOffGridCompleta(company: CompanyCompleta, client: ClienteOffGrid, f: Record<string, unknown>): string {
  const cores = coresModelo1(company);
  const contato = dadosContato(company, f);
  const { displayNome } = contato;
  const logo = srcImagemSegura(contato.logo, { logo: true });

  // ── Entradas: todas prontas do motor do front ──
  const cidade = String(f.cidade || client.cidade || '').trim();
  const uf = String(f.uf || client.uf || '').trim().toUpperCase();
  const local = [cidade, uf].filter(Boolean).join('/');
  const enderecoRaw = String(f.endereco || client.endereco || '').trim();
  const enderecoCli = enderecoRaw && local
    ? (cidade && enderecoRaw.toLowerCase().includes(cidade.toLowerCase()) ? enderecoRaw : `${enderecoRaw}, ${local}`)
    : (enderecoRaw || local);

  const kwp = n(f.kwp);
  const qtdModulos = Math.round(n(f.qtd_modulos));
  const areaM2 = n(f.area_m2);
  const bancoKwh = n(f.banco_kwh);
  const bancoUtil = n(f.banco_utilizavel);
  const bancoReserva = n(f.banco_reserva);
  const qtdBaterias = Math.round(n(f.qtd_baterias));
  const inversorKw = n(f.inversor_kw);
  const inversorSaida = String(f.inversor_saida || '').trim();
  const tensao = Math.round(n(f.tensao));
  const consumoDia = n(f.consumo_dia);
  const consumoEssDia = n(f.consumo_essencial_dia);
  const consumoMes = Math.round(n(f.consumo_mes));
  const diasPedidos = Math.round(n(f.dias_pedidos, 1));
  const autEss = n(f.aut_essencial_dias);
  const autTudo = n(f.aut_tudo_dias);
  const autChuva = n(f.aut_chuva_dias);
  const chuvaInfinita = f.aut_chuva_infinita === true;
  const recarga = n(f.aut_recarga_dias);
  const geracaoFechado = n(f.geracao_dia_fechado);
  const hspPior = n(f.hsp_pior);
  const hspAnual = n(f.hsp_anual);
  const criterio = String(f.criterio_hsp || 'pior');
  const geracaoDiaPior = n(f.geracao_dia_pior);
  const geracaoMes = Math.round(n(f.geracao_mes_media));
  const arrSerie = Math.round(n(f.arranjo_serie));
  const arrParalelo = Math.round(n(f.arranjo_paralelo));
  const arrOk = f.arranjo_ok !== false;
  const proprio = f.modo_equipamento === 'proprio';
  const entregaDo = proprio ? 'dos equipamentos' : 'do kit';
  const investimento = moeda(f.investimento);
  const prazoEntrega = String(f.prazo_entrega || '').trim().slice(0, 120);
  const parcelaCartao = String(f.parcela_cartao || '').trim();
  const parcelaFin = String(f.parcela_financiamento || '').trim();
  const itens = lerItens(f.itens_cliente);
  const aparelhos = lerAparelhos(f.aparelhos);

  // ── Formas de pagamento: a mesma leitura do form da proposta solar ──
  // Chegou qualquer `pag_*` (ou `preco_avista`): modo novo, parcelas pelos helpers solares, e os textos prontos
  // `parcela_cartao` e `parcela_financiamento` ficam de fora do documento inteiro (nunca duas parcelas diferentes).
  const pagNovo = Object.keys(f).some((k) => k.startsWith('pag_') && f[k] !== undefined) || (f.preco_avista !== undefined && f.preco_avista !== null && f.preco_avista !== '');
  const fPag = comTaxasSeguras(f);
  const precoAvistaInput = moeda(f.preco_avista);
  const precoAvista = precoAvistaInput > 0 && precoAvistaInput < investimento ? precoAvistaInput : 0;
  const vistaOn = f.pag_vista !== false;
  const cartaoOn = f.pag_cartao !== false;
  const finOn = f.pag_fin !== false;
  const entradaOn = f.pag_entrada === true;
  const cartaoAtivos = Array.from({ length: 21 }, (_, i) => i + 1).filter((k) => f[`pag_cartao_${k}`] === true);
  const finAtivos = FIN_PRAZOS.filter((k) => f[`pag_fin_${k}`] === true);
  const entradaValor = moeda(f.entrada_valor);
  const entradaRestante = investimento > 0 && entradaValor > 0 ? Math.max(0, investimento - entradaValor) : 0;
  const entradaModoRaw = String(f.entrada_modo || 'dias');
  const entradaDiasRaw = parseInt(String(f.entrada_dias || '30'), 10);
  const entradaDias = entradaDiasRaw > 0 && entradaDiasRaw <= 365 ? entradaDiasRaw : 30;
  const entradaPrazoLabel = entradaModoRaw === 'contrato' ? 'na assinatura do contrato'
    : entradaModoRaw === 'entrega' ? 'na entrega do material'
    : entradaModoRaw === 'montagem' ? 'na montagem do sistema'
    : entradaModoRaw === 'liberacao' ? 'na liberação do sistema'
    : `em ${entradaDias} dia${entradaDias === 1 ? '' : 's'}`;
  // Texto livre: passa por pEsc na saída. Acima do limite corta na última palavra inteira e termina em reticências.
  const customBruto = pagNovo ? String(f.pag_custom || '').replace(/\s+/g, ' ').trim() : '';
  const pagCustom = customBruto.length > MAX_CUSTOM ? `${customBruto.slice(0, MAX_CUSTOM).replace(/\s+\S*$/, '')}…` : customBruto;
  const parcelasCartao = pagNovo && cartaoOn && investimento > 0
    ? cartaoAtivos.map((k) => ({ n: k, v: valorParcelaCartao(fPag, investimento, k) })).filter((x) => isFinite(x.v) && x.v > 0) : [];
  const parcelasFin = pagNovo && finOn && investimento > 0
    ? finAtivos.map((k) => ({ n: k, v: valorParcelaFin(fPag, investimento, k) })).filter((x) => isFinite(x.v) && x.v > 0) : [];
  // Parcela de destaque (folha 1): financiamento mais longo; senão o cartão mais longo.
  const parcelaDestaque = parcelasFin.length
    ? `ou ${parcelasFin[parcelasFin.length - 1].n}× de ${pBRL(parcelasFin[parcelasFin.length - 1].v)}`
    : parcelasCartao.length
      ? `ou ${parcelasCartao[parcelasCartao.length - 1].n}× de ${pBRL(parcelasCartao[parcelasCartao.length - 1].v)}`
      : '';
  const vistaMostra = pagNovo && vistaOn && precoAvista > 0;
  const temEntrada = pagNovo && entradaOn && investimento > 0 && entradaValor > 0 && entradaRestante > 0;
  const temPagamentos = vistaMostra || parcelasCartao.length > 0 || parcelasFin.length > 0 || temEntrada || !!pagCustom;

  const compAnos = Math.round(n(f.comp_anos, 10));
  const compOpcoes: OpcaoComp[] = (Array.isArray(f.comp_opcoes) ? f.comp_opcoes : []).filter(ehObjeto).slice(0, 3).map((o) => ({
    id: String(o.id ?? ''), nome: limpar(String(o.nome ?? '').slice(0, 90)), entrada: n(o.entrada), mensal: n(o.mensal), total: n(o.total),
    porKwh: n(o.porKwh),
    linhas: Array.isArray(o.linhas) ? o.linhas.filter(ehObjeto).slice(0, 3).map((l) => ({ rotulo: limpar(String(l.rotulo ?? '').slice(0, 60)), valor: n(l.valor) })) : [],
    observacao: String(o.observacao ?? ''),
  }));
  const temComparativo = compOpcoes.length >= 2;
  const compEconomiaRede = n(f.comp_economia_rede);
  const compEconomiaDiesel = n(f.comp_economia_diesel);
  const compEquilibrio = Math.round(n(f.comp_equilibrio_m));
  const compVenceNaPorta = f.comp_vence_na_porta === true;
  const compPaybackDiesel = Math.round(n(f.comp_payback_diesel));
  const compDistancia = Math.round(n(f.comp_distancia_m));
  const compVencedor = String(f.comp_vencedor || 'offgrid');

  // Fotos: as da proposta e as da empresa já vêm mescladas pelo servidor. Aqui só sem repetir, de 6 em diante, em 6, 9 ou 12.
  const vistasFoto = new Set<string>();
  const fotosSemRepetir = (Array.isArray(f.fotos_obras) ? f.fotos_obras : []).filter((it) => {
    const u = ehObjeto(it) && typeof it.url === 'string' ? it.url : '';
    if (!u || vistasFoto.has(u)) return false;
    vistasFoto.add(u);
    return true;
  });
  const obrasTodas = lerObras(fotosSemRepetir);
  const nObras = obrasTodas.length >= 6 ? Math.floor(Math.min(obrasTodas.length, 12) / 3) * 3 : 0;
  const obras = obrasTodas.slice(0, nObras);
  const empresas = lerEmpresas(f.empresas_atendidas);

  const bancos = bancosEscolhidos(f.bancos_logos).map((id) => ({ nome: BANCOS_FIXOS[id].nome, src: BANCOS_FIXOS[id].img }));
  const dadosBanc = normalizarDadosBancarios(company.dados_bancarios);
  const mostraDadosBanc = f.mostrar_dados_bancarios === true && dadosBancariosCompletos(dadosBanc);

  // Aceite: só com assinatura VÁLIDA (CPF ou CNPJ com dígito certo). Ninguém barrou antes, então a conferência é aqui.
  const assinNorm = validarAssinatura(f.assinatura) === null ? normalizarAssinatura(f.assinatura) : null;
  const assin = assinNorm && assinNorm.cliente.nome && assinNorm.empresa.razao_social ? assinNorm : null;

  const hoje = propostaEmissao(f).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const validade = propostaValidade(f);
  const band = (t: string) => `<div class="band"><div class="tab">${pEsc(t)}</div><div class="bar"></div></div>`;
  const sub = (t: string, nota = '') => `<div class="sub">${pEsc(t)}${nota ? `<span class="subnote">${pEsc(nota)}</span>` : ''}</div>`;

  const autTxt = tempoOffGrid(autEss);
  const autHeroHtml = `<div class="ogAut"><div><div class="k">Com o essencial ligado</div><div class="v num">Aguenta ${pEsc(autTxt)} sem sol</div></div><div class="s">${diasPedidos > 1 ? `Projeto feito para ${diasPedidos} dias seguidos sem sol.` : 'O banco guarda a energia do dia para a noite e para os dias fechados.'}</div></div>`;

  // ═══ Folha 1: Projeto ═══
  const linhaItem = (i: ItemCliente) => `<div class="r"><span class="lab">${pEsc(i.nome)}</span><span class="inc qt">${i.qtd}×${i.garantia ? ` · ${pEsc(anosTxt(i.garantia))} de garantia` : ''}</span></div>`;
  // Texto ao lado do preço: no modo novo sai da MESMA parcela da folha 3; no antigo, os textos prontos.
  const ladoTile = pagNovo
    ? (parcelaDestaque && temPagamentos ? pEsc(cap1(parcelaDestaque)) : '')
    : (parcelaFin || parcelaCartao ? `${pEsc(cap1(parcelaFin || parcelaCartao))}${parcelaFin && parcelaCartao ? `<br/>${pEsc(cap1(parcelaCartao))}` : ''}` : '');
  const tileInvestimento = investimento > 0
    ? `<div class="invBig"><div><div class="k">Preço do sistema instalado</div><div class="v num">${pEsc(brl(investimento))}</div></div>${ladoTile ? `<div class="s num">${ladoTile}</div>` : ''}</div>`
    : '';
  const notaEntrega = prazoEntrega ? `<div class="nota" style="margin-top:6px">Entrega ${entregaDo} em ${pEsc(prazoEntrega)}.</div>` : '';

  // Tiles: na casa, os três de sempre. No equipamento próprio, só os que têm número (sem "híbrido" nem "lítio" por suposição).
  const tilePlacas = `<div class="tile"><div class="k">Placas solares</div><div class="v num">${pEsc(pKwp(kwp))}<u>kWp</u></div><div class="s">${qtdModulos} ${qtdModulos === 1 ? 'placa' : 'placas'}</div></div>`;
  const tileInversor = proprio
    ? `<div class="tile"><div class="k">Inversor</div><div class="v num">${pEsc(dec(inversorKw, 1))}<u>kW</u></div><div class="s">${inversorSaida ? `Saída ${pEsc(inversorSaida)}` : 'Alimenta os seus aparelhos'}</div></div>`
    : `<div class="tile"><div class="k">Inversor híbrido</div><div class="v num">${pEsc(dec(inversorKw, 1))}<u>kW</u></div><div class="s">${inversorSaida ? `Saída ${pEsc(inversorSaida)}` : 'Liga a casa e carrega o banco'}</div></div>`;
  const tileBanco = `<div class="tile"><div class="k">Banco de baterias</div><div class="v num">${pEsc(dec(bancoKwh, 2))}<u>kWh</u></div><div class="s">${qtdBaterias} ${qtdBaterias === 1 ? 'bateria' : 'baterias'}${proprio ? '' : ' de lítio'}${tensao > 0 ? ` · ${tensao} V` : ''}</div></div>`;
  const tilesLista = proprio
    ? [kwp > 0 ? tilePlacas : '', inversorKw > 0 ? tileInversor : '', bancoKwh > 0 ? tileBanco : ''].filter(Boolean)
    : [tilePlacas, tileInversor, tileBanco];
  const tilesHtml = tilesLista.length
    ? `<div class="ogTiles"${tilesLista.length < 3 ? ` style="grid-template-columns:repeat(${tilesLista.length},1fr)"` : ''}>
      ${tilesLista.join('\n      ')}
    </div>
    `
    : '';

  // Composição: TODO item aceito (até 20) aparece. Cabendo na folha 1, fica nela; senão a lista inteira ganha
  // uma folha própria logo depois. Alturas em px, medidas no navegador.
  const denso = itens.length > 14;
  // Linha de 11,5 px: 1 linha mede 25, cada linha a mais soma 16; o texto da garantia come largura do nome (conta com folga).
  const alturaItens = itens.reduce((a, i) => a + (denso ? 7 : 10) + (denso ? 15.5 : 16.2) * Math.ceil(i.nome.length / (i.garantia ? 80 : 100)), 0);
  const temComposicao = !proprio || itens.length > 0;
  const alturaComposicao = temComposicao ? 52 + alturaItens + (proprio ? 0 : 29) : 0;
  const linhaProjeto = '<div class="r"><span class="lab">Projeto, instalação e comissionamento</span><span class="inc">Incluído</span></div>';
  const compHtml = temComposicao
    ? `${band('Composição do sistema')}
  <div class="sec">
    <div class="rows ogRows cp${denso ? ' dn' : ''}">
      ${[...itens.map(linhaItem), ...(proprio ? [] : [linhaProjeto])].join('\n      ')}
    </div>
  </div>`
    : '';
  const composicaoNaF1 = alturaComposicao > 0 && BASE_FOLHA1 + alturaComposicao <= LIMITE_FOLHA1;

  const folha1 = `
  ${cabecalhoModelo1({ logo, displayNome, hoje, clienteNome: client.nome, enderecoCli, validadeCurto: validade.curto, clienteDoc: assin ? docClienteCabecalho(assin.cliente) : undefined, subtitulo: 'SISTEMA OFF-GRID', tituloFicha: 'Proposta Off-grid' })}

  ${band('Seu sistema off-grid')}
  <div class="sec">
    ${tilesHtml}${autHeroHtml}
    <div class="rows ogRows">
      <div class="r"><span class="lab">Consumo previsto</span><span class="val num">${pEsc(dec(consumoDia, 1))} kWh por dia · ${consumoMes} kWh por mês</span></div>
      ${areaM2 > 0 ? `<div class="r"><span class="lab">Área necessária para as placas</span><span class="val num">${pEsc(dec(areaM2, 1))} m²</span></div>` : ''}
      ${arrSerie > 0 && arrParalelo > 0 && arrOk ? `<div class="r"><span class="lab">Ligação das placas</span><span class="val">${arrSerie} em série, ${arrParalelo} ${arrParalelo === 1 ? 'conjunto' : 'conjuntos'} de placas</span></div>` : ''}
    </div>
  </div>

  ${composicaoNaF1 ? `${compHtml}

  ` : ''}${band('Resumo do investimento')}
  <div class="sec">
    ${tileInvestimento}
    ${notaEntrega}
  </div>`;
  const folhaComposicao = temComposicao && !composicaoNaF1 ? compHtml : '';

  // ═══ Folha 2: Autonomia e consumo ═══
  const tudoIgual = Math.abs(autTudo - autEss) < 0.05;
  const cenarios = `
    <div class="ogCen"><div><div class="t">Só o essencial: geladeira, luz, água e internet</div><div class="d">${pEsc(dec(consumoEssDia, 1))} kWh por dia. É o que não pode faltar em casa nenhuma.</div></div><div class="v num">${pEsc(tempoOffGrid(autEss))}</div></div>
    ${tudoIgual
      ? `<div class="ogCen"><div><div class="t">Neste projeto, tudo que está na lista é essencial</div><div class="d">Os ${pEsc(dec(consumoDia, 1))} kWh por dia são os mesmos que a bateria segura sem sol.</div></div><div class="v num">${pEsc(tempoOffGrid(autTudo))}</div></div>`
      : `<div class="ogCen"><div><div class="t">A casa inteira ligada, como num dia comum</div><div class="d">${pEsc(dec(consumoDia, 1))} kWh por dia, com tudo que está na lista.</div></div><div class="v num">${pEsc(tempoOffGrid(autTudo))}</div></div>`}
    <div class="ogCen"><div><div class="t">Chovendo o dia inteiro</div><div class="d">Com o céu fechado, as placas ainda geram cerca de ${pEsc(dec(geracaoFechado, 1))} kWh por dia. A bateria cobre só a diferença.</div></div><div class="v num">${chuvaInfinita ? 'O essencial<br/>se mantém' : pEsc(tempoOffGrid(autChuva))}</div></div>`;

  const aparelhosOrd = [...aparelhos].sort((a, b) => Number(b.essencial) - Number(a.essencial)).slice(0, 16);
  const blocoLiga = aparelhosOrd.length
    ? `${sub('O que o sistema liga', `${aparelhos.length} ${aparelhos.length === 1 ? 'aparelho' : 'aparelhos'}`)}
    <div class="ogApar">${aparelhosOrd.map((a) => `<div class="ap${a.essencial ? ' es' : ''}"><span class="nm">${pEsc(a.nome)}</span><span class="qt num">${a.qtd}× · ${pEsc(dec(a.w, 0))} W${a.horas > 0 ? ` · ${pEsc(dec(a.horas, 1))} h/dia` : ''}</span></div>`).join('')}</div>
    <div class="ogLeg">A barra colorida marca o que é essencial. Consumo total: ${pEsc(dec(consumoDia, 1))} kWh por dia, ${consumoMes} kWh por mês.</div>`
    : `${sub('O que o sistema liga')}
    <div class="finGrid"><div class="fc"><div class="k">Consumo por dia</div><div class="v num">${pEsc(dec(consumoDia, 1))} kWh</div></div><div class="fc"><div class="k">Consumo por mês</div><div class="v num">${consumoMes} kWh</div></div><div class="fc"><div class="k">Essencial por dia</div><div class="v num">${pEsc(dec(consumoEssDia, 1))} kWh</div></div></div>`;

  // `kit_atende_placas === false` (modo próprio, placas do integrador não cobrem o mês de menos sol): a proposta não
  // promete que a geração fecha a conta no pior mês. Ausente vale true, então o modo kit não muda.
  const placasAtendem = f.kit_atende_placas !== false;
  const dimTxt = !placasAtendem
    ? `Neste sistema, no mês de menos sol do ano, com ${dec(hspPior, 2)} h por dia, a geração fica em torno de ${dec(geracaoDiaPior, 1)} kWh por dia.`
    : criterio === 'media'
    ?`O sistema foi calculado pelo sol médio do ano (${dec(hspAnual, 2)} h por dia). No mês de menos sol, com ${dec(hspPior, 2)} h por dia, a geração fica em torno de ${dec(geracaoDiaPior, 1)} kWh por dia.`
    : `O sistema foi calculado pelo mês de menos sol do ano (${dec(hspPior, 2)} h por dia), e não pela média. Ele fecha a conta em junho também.${geracaoMes > consumoMes * 1.25 ? ` No verão sobra energia de propósito: a geração média é de ${geracaoMes} kWh por mês, e é essa sobra que enche a bateria depois dos dias fechados.` : ''}`;

  const folha2 = `${band('Autonomia e consumo')}
  <div class="sec">
    <div class="ogBig"><div class="k">Com o essencial ligado</div><div class="v num">Aguenta ${pEsc(autTxt)} sem sol</div><div class="s">O banco tem ${pEsc(dec(bancoKwh, 2))} kWh, dos quais ${pEsc(dec(bancoUtil, 2))} kWh são utilizáveis. Os outros ${pEsc(dec(bancoReserva, 2))} kWh ficam de reserva de propósito: o inversor corta antes de zerar a bateria, e é isso que ${proprio ? 'protege a vida útil do banco' : 'faz o banco de lítio durar mais de 10 anos'}.</div></div>
    ${sub('Os três cenários')}
    ${cenarios}
    <div class="dois" style="margin-top:8px">
      <div class="hi"><div class="k">Banco cheio de novo em</div><div class="v t">${recarga > 0 ? `${pEsc(tempoOffGrid(recarga))} de sol` : 'No mesmo dia'}</div></div>
      <div class="hi"><div class="k">Calculado pelo</div><div class="v t">${criterio === 'media' ? 'Sol médio do ano' : `Mês de menos sol (${pEsc(dec(hspPior, 2))} h por dia)`}</div></div>
    </div>
    <div class="ogTxt" style="margin-top:8px">${pEsc(dimTxt)}</div>
    ${blocoLiga}
    ${sub('O que não entra num sistema off-grid')}
    <div class="ogTxt">Chuveiro elétrico, torneira elétrica, forno elétrico e secadora de roupa não fazem parte deste projeto. Um banho de 15 minutos no chuveiro elétrico consome cerca de 1,4 kWh${proprio ? ' do banco' : ', um terço de uma bateria inteira'}. A saída é aquecimento a gás ou solar, e isso está combinado nesta proposta.</div>
    ${sub('Normas e responsabilidade técnica')}
    <div class="ogTxt">Instalação conforme ABNT NBR 16690 (arranjos fotovoltaicos), NBR 5410 (baixa tensão) e NBR 5419 (descargas atmosféricas)${proprio ? '' : ', com equipamentos certificados pelo Inmetro'}. Sistema isolado não precisa de homologação na concessionária, porque não há conexão com a rede.</div>
  </div>`;

  // ═══ Folha 3: Investimento e pagamento ═══
  const blocoCartao = parcelaCartao ? `<div class="hi"><div class="k">Cartão de crédito</div><div class="v t">${pEsc(cap1(parcelaCartao))}</div><div class="s">Sem entrada</div></div>` : '';
  const blocoFin = parcelaFin ? `<div class="hi"><div class="k">Financiamento bancário</div><div class="v t">${pEsc(cap1(parcelaFin))}</div><div class="s">Sujeito à aprovação do banco</div></div>` : '';
  const doisPag = [blocoCartao, blocoFin].filter(Boolean);
  const linhasDadosBanc: string[] = [];
  if (mostraDadosBanc && dadosBanc) {
    const l = (k: string, v: string) => `<div class="r"><span class="lab">${pEsc(k)}</span><span class="val">${pEsc(v)}</span></div>`;
    if (dadosBanc.banco) linhasDadosBanc.push(l('Banco', dadosBanc.banco));
    if (dadosBanc.agencia) linhasDadosBanc.push(l('Agência', dadosBanc.agencia));
    if (dadosBanc.conta) linhasDadosBanc.push(l('Conta', `${dadosBanc.conta}${dadosBanc.tipo_conta === 'corrente' ? ' corrente' : dadosBanc.tipo_conta === 'poupanca' ? ' poupança' : ''}`));
    if (dadosBanc.titular) linhasDadosBanc.push(l('Titular', dadosBanc.titular));
    if (dadosBanc.documento) linhasDadosBanc.push(l('CPF/CNPJ do titular', dadosBanc.documento));
    if (dadosBanc.pix) linhasDadosBanc.push(l('Chave Pix', dadosBanc.pix));
  }
  // Modo novo: à vista e entrada em cartões, parcelas em grade (cartão e financiamento) e texto livre. Mesma exibição da Completa solar.
  const blocoVista = vistaMostra
    ? `<div class="hi"><div class="k">Desconto à vista</div><div class="v num">${pEsc(brlAuto(precoAvista))}</div><div class="s">Economia de ${pEsc(brlAuto(investimento - precoAvista))}</div></div>`
    : '';
  const blocoEntrada = temEntrada
    ? `<div class="hi"><div class="k">Entrada + saldo</div><div class="v num">${pEsc(brlAuto(entradaValor))} + ${pEsc(brlAuto(entradaRestante))}</div><div class="s">Entrada de ${pEsc(brlAuto(entradaValor))} · Restante de ${pEsc(brlAuto(entradaRestante))} ${pEsc(entradaPrazoLabel)}</div></div>`
    : '';
  const doisPagNovo = [blocoVista, blocoEntrada].filter(Boolean);
  const doisFinal = pagNovo ? doisPagNovo : doisPag;
  const gradeParcelas = (lista: Array<{ n: number; v: number }>) => `<div class="pgrid">${lista.map((x) => `<div class="pt"><span class="n">${x.n}× de</span><span class="v num">${pEsc(pBRL(x.v))}</span></div>`).join('')}</div>`;
  const parcelasHtml = [
    parcelasCartao.length ? `${sub('Cartão de crédito', 'Sem entrada')}\n    ${gradeParcelas(parcelasCartao)}` : '',
    parcelasFin.length ? `${sub('Financiamento bancário', `${FIN_CARENCIA_MESES * 30} dias de carência, sujeito à aprovação do banco`)}\n    ${gradeParcelas(parcelasFin)}` : '',
    pagCustom ? `${sub('Condição especial')}\n    <div class="hi"><div class="v t">${pEsc(pagCustom)}</div><div class="s">A combinar com o vendedor</div></div>` : '',
  ].filter(Boolean).join('\n    ');
  const blocoPagA = `${tileInvestimento}
    ${doisFinal.length ? `<div class="dois" style="margin-top:10px${doisFinal.length === 1 ? ';grid-template-columns:1fr' : ''}">${doisFinal.join('')}</div>` : ''}
    ${parcelasHtml}
    ${prazoEntrega ? `<div class="nota" style="margin-top:8px">Entrega ${entregaDo} em ${pEsc(prazoEntrega)}.</div>` : ''}`;
  const blocoPagB = `${bancos.length ? `${sub('Bancos que financiam o seu sistema')}
    <div class="bgrid">${bancos.map((b) => `<div class="bk fx"><div class="lg"><img src="${pEsc(b.src)}" alt="${pEsc(b.nome)}"/></div></div>`).join('')}</div>` : ''}
    ${linhasDadosBanc.length ? `${sub('Dados para pagamento')}
    <div class="rows dpag">${linhasDadosBanc.join('\n      ')}</div>` : ''}`;
  // Alturas em px (medidas no navegador). Se a folha 3 estoura, bancos e dados bancários vão para uma folha a mais.
  const estPagA = 55 + (tileInvestimento ? 85 : 0) + (doisFinal.length ? 100 : 0)
    + (parcelasCartao.length ? 36 + Math.ceil(parcelasCartao.length / 3) * 36 : 0)
    + (parcelasFin.length ? 36 + Math.ceil(parcelasFin.length / 3) * 36 : 0)
    + (pagCustom ? 36 + 60 + Math.ceil(pagCustom.length / 70) * 18 : 0)
    + (prazoEntrega ? 30 : 0);
  const estPagB = (bancos.length ? 36 + Math.ceil(bancos.length / 4) * 78 : 0) + (linhasDadosBanc.length ? 36 + linhasDadosBanc.length * 34 : 0);
  const temBlocoB = bancos.length > 0 || linhasDadosBanc.length > 0;
  const pagBemFolhaPropria = temBlocoB && (tileInvestimento !== '' || doisFinal.length > 0 || temPagamentos) && estPagA + estPagB > LIMITE_FOLHA;
  const temFolha3 = investimento > 0 || doisFinal.length > 0 || temPagamentos || temBlocoB;
  const folha3 = `${band('Investimento e formas de pagamento')}
  <div class="sec">
    ${blocoPagA}${pagBemFolhaPropria ? '' : `
    ${blocoPagB}`}
  </div>`;
  const tituloFolhaBancos = bancos.length && linhasDadosBanc.length ? 'Bancos e dados para pagamento' : bancos.length ? 'Bancos que financiam' : 'Dados para pagamento';
  const folhaBancos = pagBemFolhaPropria ? `${band(tituloFolhaBancos)}
  <div class="sec">
    ${blocoPagB}
  </div>` : '';

  // ═══ Folha 4: Obras realizadas (6, 9 ou 12 fotos) ═══
  const obraH = empresas.length ? (obras.length > 9 ? 130 : 150) : (obras.length > 9 ? 175 : obras.length > 6 ? 200 : 250);
  const folha4 = obras.length
    ? `${band('Obras realizadas')}
  <div class="sec">${sub('Quem já confia na gente')}
    <div class="ogrid" style="--oh:${obraH}px">${obras.map((o) => `<div class="ob"><img src="${pEsc(o.src)}" alt="${pEsc(o.legenda || 'Obra realizada')}"/><div class="cap">${pEsc(o.legenda)}</div></div>`).join('')}</div>
    ${empresas.length ? `${sub('Empresas atendidas')}
    <div class="egrid">${empresas.map((e) => `<div class="em"><div class="lg"><img src="${pEsc(e.src)}" alt="${pEsc(e.nome || 'Empresa atendida')}"/></div>${e.nome ? `<div class="nm">${pEsc(e.nome)}</div>` : ''}</div>`).join('')}</div>` : ''}
  </div>`
    : '';

  // ═══ Folha 5: comparativo, garantias, cronograma, validade e WhatsApp ═══
  const achaGar = (re: RegExp) => itens.find((i) => re.test(i.nome) && (i.garantia ?? 0) > 0)?.garantia ?? 0;
  const garInstMeses = String(f.garantia_instalacao_unidade ?? 'anos').toLowerCase() === 'meses';
  // Casa: garantia da instalação de sempre (mínimo 1). Próprio: só se o integrador preencheu, senão nenhum número.
  const garInstBruta = parseInt(String(f.garantia_instalacao ?? (proprio ? '0' : '1')), 10) || 0;
  const garInstLimite = garInstMeses ? 240 : MAX_GARANTIA_ANOS;
  const garInstalacao = garInstBruta > 0 && garInstBruta <= garInstLimite ? garInstBruta : (proprio ? 0 : 1);
  const garInstUn = garInstMeses ? (garInstalacao === 1 ? 'mês' : 'meses') : (garInstalacao === 1 ? 'ano' : 'anos');
  const garPlacas = achaGar(/m[óo]dulo|painel|placa/i);
  const garInversor = achaGar(/inversor/i);
  const garBateria = proprio ? achaGar(/bateria/i) : (achaGar(/bateria/i) || Math.round(n(f.bateria_garantia)));
  const garEstrutura = proprio ? achaGar(/estrutura/i) : Math.round(n(f.garantia_estrutura));
  const garantias: Array<{ k: string; v: string }> = [
    ...(garPlacas ? [{ k: 'Placas', v: anosTxt(garPlacas) }] : []),
    ...(garInversor ? [{ k: 'Inversor', v: anosTxt(garInversor) }] : []),
    ...(garBateria > 0 ? [{ k: 'Baterias', v: anosTxt(garBateria) }] : []),
    ...(garEstrutura > 0 ? [{ k: 'Estrutura', v: anosTxt(garEstrutura) }] : []),
    ...(garInstalacao > 0 ? [{ k: 'Instalação', v: `${garInstalacao} ${garInstUn}` }] : []),
  ].slice(0, 5);

  const comparativoHtml = !temComparativo ? '' : (() => {
    const frases = [
      compEconomiaRede > 0
        ? `Em ${compAnos} anos, o sistema off-grid deixa ${brl(compEconomiaRede)} no bolso em relação a puxar a rede${compDistancia > 0 ? `, com ${compDistancia} m de obra mais a conta de luz todo mês` : ' e seguir pagando conta de luz'}.`
        : `Nesta situação, ligar na rede da concessionária ainda sai mais barato no total de ${compAnos} anos. O que o sistema próprio entrega aqui é independência: energia que não cai e não sobe de tarifa.`,
      compEconomiaDiesel > 0
        ? `Contra o gerador a diesel, a diferença é de ${brl(compEconomiaDiesel)} no mesmo período${compPaybackDiesel > 0 ? `, e o investimento se paga em ${compPaybackDiesel} meses só de combustível economizado` : ''}.`
        : '',
      compVenceNaPorta
        ? 'Nesta conta o sistema ganharia mesmo com o poste na porta.'
        : (compEconomiaRede > 0 && compEquilibrio > 0 ? `O ponto de virada é ${compEquilibrio} m de rede: acima dessa distância, o sistema próprio sai na frente.` : ''),
    ].filter(Boolean).join(' ');
    return `<div>${sub('Rede, diesel ou off-grid', `${compAnos} anos`)}
    <div class="ogCmp" style="grid-template-columns:repeat(${compOpcoes.length},1fr)">${compOpcoes.map((o) => `<div class="oc${o.id === compVencedor ? ' w' : ''}"><div class="nm">${pEsc(cap1(o.nome))}</div><div class="tt num">${pEsc(brl(o.total))}</div><div class="ta">Em ${compAnos} anos</div>${o.linhas.map((l) => `<div class="ln2"><span>${pEsc(cap1(l.rotulo))}</span><b class="num">${pEsc(brl(l.valor))}</b></div>`).join('')}<div class="pk">Investimento inicial de <b class="num">${pEsc(brl(o.entrada))}</b>, depois <b class="num">${pEsc(brl(o.mensal))}</b> por mês. <b class="num">${pEsc(brl2(o.porKwh))}</b> por kWh.</div></div>`).join('')}</div>
    <div class="ogTxt" style="margin-top:8px">${pEsc(frases)}</div></div>`;
  })();

  const vendWhats = contato.vendWhats;
  const phoneLimpo = vendWhats.replace(/^55/, '');
  const phoneBonito = phoneLimpo.length === 11 ? `(${phoneLimpo.slice(0, 2)}) ${phoneLimpo.slice(2, 7)}-${phoneLimpo.slice(7)}` : phoneLimpo;
  const waLink = `https://wa.me/55${phoneLimpo}?text=${encodeURIComponent(`Olá ${contato.vendedor || ''}! Quero fechar a proposta de ${client.nome}.`)}`;

  const temAceite = !!assin;
  const prazoLinha = prazoEntrega ? `Entrega ${entregaDo} em ${prazoEntrega}.` : 'O prazo de cada etapa é combinado com você na visita técnica.';
  const cronogramaMiolo = `<div class="prazoL">${pEsc(prazoLinha)}</div>
    <div class="nota" style="margin:-8px 0 10px">Sistema isolado não precisa de homologação na concessionária, então não há fila de aprovação.</div>
    <div class="cron ogCron">${ETAPAS_OFFGRID.map((e, i) => `<div class="cr"><div class="ci">${e.svg}</div><div class="cx"><div class="ct"><span class="n">${i + 1}</span>${proprio && e.t === 'Entrega do kit' ? 'Entrega dos equipamentos' : e.t}</div><div class="cd">${e.d}</div></div></div>`).join('')}</div>`;
  // Alturas medidas no navegador (px): comparativo 266, garantias 79, cronograma 392, validade 24, WhatsApp 145, rodapé grande 241;
  // aqui entram com folga. 66 = faixa mais respiro da folha; 16 = espaço entre blocos. Se não couber, o cronograma ganha folha própria.
  const blocosFixos = [...(garantias.length ? [79] : []), 24, ...(vendWhats ? [145] : []), ...(temComparativo ? [285] : [])];
  const estSemCron = 66 + blocosFixos.reduce((a, b) => a + b, 0) + 16 * blocosFixos.length + (temAceite ? 0 : 250);
  const cronogramaNaF5 = estSemCron + 400 <= LIMITE_FOLHA;
  const blocosF5 = [
    comparativoHtml,
    garantias.length ? `<div>${sub('Garantias inclusas')}
    <div class="ogGar" style="grid-template-columns:repeat(${garantias.length},1fr)">${garantias.map((g) => `<div class="fc"><div class="k">${pEsc(g.k)}</div><div class="v">${pEsc(g.v)}</div></div>`).join('')}</div></div>` : '',
    ...(cronogramaNaF5 ? [`<div>${sub('Cronograma do projeto')}
    ${cronogramaMiolo}</div>`] : []),
    `<div><span class="vpill">${pEsc(validade.longo.toUpperCase())}</span></div>`,
    vendWhats ? `<div class="cta ogCta"><div class="t">Quer fechar essa proposta?</div><div class="s">Me chama no WhatsApp que a gente tira do papel agora</div><a href="${pEsc(waLink)}" target="_blank" rel="noopener noreferrer">Quero fechar pelo WhatsApp</a><div class="ph num">${pEsc(phoneBonito)}</div></div>` : '',
  ].filter(Boolean);
  const folha5 = `${band(temComparativo ? 'Comparativo, garantias e prazos' : 'Garantias e próximos passos')}
  <div class="sec dist og">
    ${blocosF5.join('\n    ')}
  </div>${temAceite ? '' : `
  ${rodapeModelo1(company, contato, 'Contato')}`}`;
  const folhaCronograma = cronogramaNaF5 ? '' : `${band('Cronograma do projeto')}
  <div class="sec">${cronogramaMiolo}</div>`;

  // ═══ Folha 6: Aceite da proposta ═══
  let folhaAceite = '';
  if (assin) {
    const { empresa, cliente } = assin;
    const localAceite = assin.local || String(company.cidade || '').trim() || cidade;
    const linhaLocal = [localAceite, dataPorExtenso(propostaEmissao(f))].filter(Boolean).join(', ');
    const sigEmpresa = `<div class="sg"><div class="ln"></div>
        <div class="nm">${pEsc(empresa.razao_social)}</div>
        ${empresa.cnpj ? `<div class="dc">CNPJ ${pEsc(formatarCnpj(empresa.cnpj))}</div>` : ''}
        ${empresa.representante ? `<div class="rp">${pEsc([empresa.representante, empresa.cargo].filter(Boolean).join(', '))}</div>` : ''}
        <div class="rl">Pela empresa</div></div>`;
    const sigCliente = `<div class="sg"><div class="ln"></div>
        <div class="nm">${pEsc(cliente.nome)}</div>
        ${cliente.documento ? `<div class="dc">${docClienteHtml(cliente)}</div>` : ''}
        ${cliente.tipo === 'PJ' && cliente.representante ? `<div class="rp">${pEsc(cliente.representante)}</div>` : ''}
        <div class="rl">Pelo cliente</div></div>`;
    const lr = (k: string, v: string) => `<div class="r"><span class="lab">${pEsc(k)}</span><span class="val num">${pEsc(v)}</span></div>`;
    const codigoProp = String(f.codigo ?? '').trim();
    const ateData = new Date(propostaEmissao(f).getTime() + validade.dias * 86400000);
    const linhasResumo = [
      codigoProp ? lr('Proposta', codigoProp) : '',
      kwp > 0 ? lr('Placas solares', `${pKwp(kwp)} kWp${qtdModulos > 0 ? ` em ${qtdModulos} ${qtdModulos === 1 ? 'placa' : 'placas'}` : ''}`) : '',
      bancoKwh > 0 ? lr('Banco de baterias', `${dec(bancoKwh, 2)} kWh${qtdBaterias > 0 ? ` em ${qtdBaterias} ${qtdBaterias === 1 ? 'bateria' : 'baterias'}` : ''}`) : '',
      inversorKw > 0 ? lr(proprio ? 'Inversor' : 'Inversor híbrido', `${dec(inversorKw, 1)} kW${inversorSaida ? `, saída ${inversorSaida}` : ''}`) : '',
      autEss > 0 ? lr('Autonomia com o essencial', `${tempoOffGrid(autEss)} sem sol`) : '',
      investimento > 0 ? lr('Preço do sistema instalado', brl(investimento)) : '',
      Number.isNaN(ateData.getTime()) ? '' : lr('Validade', `Até ${ateData.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`),
    ].filter(Boolean);
    folhaAceite = `${band('Aceite da proposta')}
  <div class="sec ac">
    ${linhasResumo.length ? `${sub('Resumo do que está sendo aceito')}
    <div class="rows">${linhasResumo.join('\n      ')}</div>
    <div class="acGap"></div>` : ''}
    <div class="acT">As duas partes confirmam os equipamentos, os valores e as condições desta proposta.</div>
    ${linhaLocal ? `<div class="acL">${pEsc(linhaLocal)}.</div>` : ''}
    <div class="sigs">
      ${sigEmpresa}
      ${sigCliente}
    </div>
  </div>
  ${rodapeModelo1(company, contato, 'Contato')}`;
  }

  // ── Montagem ──
  const conteudos: string[] = [folha1];
  if (folhaComposicao) conteudos.push(folhaComposicao);
  conteudos.push(folha2);
  if (temFolha3) conteudos.push(folha3);
  if (folhaBancos) conteudos.push(folhaBancos);
  if (folha4) conteudos.push(folha4);
  if (folhaCronograma) conteudos.push(folhaCronograma);
  conteudos.push(folha5);
  if (folhaAceite) conteudos.push(folhaAceite);
  const total = conteudos.length;
  const topo = (k: number) => `<div class="topo">${logo ? `<img src="${pEsc(logo)}" alt="${pEsc(displayNome)}"/>` : `<span class="tn">${pEsc(displayNome || 'Sua Marca')}</span>`}<span class="tt">${pEsc(`Proposta Off-grid · ${client.nome || ''} · ${k}/${total}`)}</span></div>`;
  const folhas = conteudos.map((c, i) => `<div class="page${i === 0 && enderecoCli ? ' com-end' : ''}">${i === 0 ? '' : topo(i + 1)}${c}
</div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794, user-scalable=yes"/>
<title>Proposta Off-grid Completa · ${pEsc(client.nome)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
${cssRaizModelo1(cores)}
${CSS_MODELO1}
${CSS_COMPLETO}
${CSS_OFFGRID}</style></head><body>
${folhas}
</body></html>`;
}
