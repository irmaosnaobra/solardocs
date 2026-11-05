/**
 * PROPOSTA SOLAR, MODELO 4 "COMPLETA + BANCO" — várias folhas A4 em pé, no MESMO visual do modelo
 * "1 Página" (fonte, cores, faixas, cartões e rodapé vêm de propostaSolarPartes.ts, que o
 * modelo 1 também lê). As contas e os gráficos vêm de propostaSolarCalculos.ts, o mesmo
 * módulo do modelo Moderno, então os números casam com o resumo do WhatsApp.
 *
 * Folhas: 1 Projeto · 2 Análise financeira · 3 Investimento e pagamento ·
 *         4 Quem já confia na gente (só com obras, empresas ou foto do telhado) ·
 *         5 Garantias e próximos passos (com o rodapé grande, se não houver o aceite) ·
 *         6 Aceite da proposta (só com f.assinatura; é a última e leva o rodapé grande).
 *
 * Os 8 bancos fixos vêm de ./bancosLogos (constante interna do servidor, nunca do usuário) e entram
 * direto; os logos que o usuário sobe passam por srcImagemSegura. O CPF e o CNPJ do cliente saem inteiros
 * (no link público também, igual ao PDF autenticado).
 *
 * SEGURANÇA: o PDF sai no servidor (Puppeteer). Imagem só entra se o `src` for https:// ou
 * data:image/(png|jpeg|webp);base64,. As URLs das galerias já chegam reassinadas pelo servidor
 * (renovarUrlsPortfolio); mesmo assim este template descarta o que não passar na regra.
 * Tudo que é texto do usuário passa por pEsc.
 */
import { getRef, geracaoMensal, MESES_ABREV } from '../propostaSolarData';
import { inversoresDaProposta } from '../inversoresProposta';
import {
  pBRL, pNum, pKwp, pEsc, pGarantiasInversoresDiferentes, parseBRL, parseBateria,
  propostaEmissao, propostaValidade, str,
} from '../propostaSolarBase';
import {
  FIN_PRAZOS, NUM_ANOS, anoCivil, calcularFinanceiro, lerFioB, pBRLshort, serieFioB, svgBarrasMensais, svgCurvas25,
  valorParcelaCartao, valorParcelaFin,
} from '../propostaSolarCalculos';
import {
  coresModelo1, cssRaizModelo1, CSS_MODELO1, dadosContato, cabecalhoModelo1, analiseModelo1, linhaMk,
  rodapeModelo1, type CompanyProposta,
} from './propostaSolarPartes';
import { totalKwInversores } from '../inversoresProposta';
import { BANCOS_FIXOS, bancosEscolhidos } from './bancosLogos';
import { formatarCnpj, formatarCpf, normalizarAssinatura, type Assinatura } from '../../utils/documentoBr';
import { dadosBancariosCompletos, normalizarDadosBancarios } from '../../utils/dadosBancarios';

/** O que o modelo 4 lê a mais da empresa: cidade (local do aceite) e dados bancários (folha 3). */
export type CompanyCompleta = CompanyProposta & { cidade?: string; dados_bancarios?: unknown };

interface ClienteProposta {
  nome: string;
  cidade?: string;
  uf?: string;
  endereco?: string;
  tipo_telhado?: string;
}

// ─── Imagens: allowlist de `src` ─────────────────────────────────────────────

const RE_DATA_IMG = /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
// Logo da própria empresa (vem do cadastro, nunca do formulário da proposta): aceita também gif e svg.
const RE_DATA_LOGO = /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;
const RE_HTTPS = /^https:\/\/[^\s"'<>\\]+$/;

/** Devolve o `src` se passar na regra; senão string vazia. */
export function srcImagemSegura(v: unknown, opts: { https?: boolean; logo?: boolean } = {}): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > 12_000_000) return '';
  if (opts.https && s.length <= 4000 && RE_HTTPS.test(s)) return s;
  if ((opts.logo ? RE_DATA_LOGO : RE_DATA_IMG).test(s)) return s;
  return '';
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function textoCurto(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, 80) : '';
}

export interface ItemObraT { src: string; legenda: string }
export interface ItemEmpresaT { src: string; nome: string }
export interface ItemBancoT { nome: string; src: string }

export function lerObras(v: unknown): ItemObraT[] {
  if (!Array.isArray(v)) return [];
  // Descarta o que não tem URL válida ANTES de contar o limite (lê no máximo 60 entradas).
  return v.slice(0, 60).flatMap((it): ItemObraT[] => {
    if (!ehObjeto(it)) return [];
    const src = srcImagemSegura(it.url, { https: true });
    return src ? [{ src, legenda: textoCurto(it.legenda) }] : [];
  }).slice(0, 12);
}

export function lerEmpresas(v: unknown): ItemEmpresaT[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60).flatMap((it): ItemEmpresaT[] => {
    if (!ehObjeto(it)) return [];
    const src = srcImagemSegura(it.url, { https: true });
    return src ? [{ src, nome: textoCurto(it.nome) }] : [];
  }).slice(0, 12);
}

export function lerBancos(v: unknown): ItemBancoT[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 60).flatMap((it): ItemBancoT[] => {
    if (!ehObjeto(it)) return [];
    const nome = textoCurto(it.nome);
    const src = srcImagemSegura(it.url, { https: true });
    // Sem logo e sem nome não há o que mostrar.
    return nome || src ? [{ nome, src }] : [];
  }).slice(0, 8);
}

// ─── CSS próprio do Completo (em cima do CSS do modelo 1) ────────────────────

const CSS_COMPLETO = `
/* Completo: várias folhas A4. A altura mínima fica em 1122px (A4 = 1122,5px) para a folha
   não vazar 0,5px e gerar uma página em branco entre duas folhas. */
.page{ width:794px; min-height:1122px; margin:0 auto; background:#fff; display:flex; flex-direction:column; page-break-after:always; break-after:page; }
.page:last-child{ page-break-after:auto; break-after:auto; }
@media screen{ .page{ margin-bottom:16px; box-shadow:0 2px 18px rgba(0,0,0,.08); } }
.topo{ display:flex; align-items:center; gap:12px; background:var(--c1); color:#fff; padding:10px 26px; }
.topo img{ height:26px; width:auto; max-width:96px; object-fit:contain; background:#fff; border-radius:5px; padding:2px 5px; }
.topo .tn{ font-size:12px; font-weight:900; letter-spacing:-.2px; }
.topo .tt{ margin-left:auto; font-size:10.5px; font-weight:700; letter-spacing:.7px; text-transform:uppercase; opacity:.9; text-align:right; }
.ficha .rowf.end{ font-size:11px; line-height:1.3; }
.ficha .rowf.end span:first-child{ flex-shrink:0; white-space:nowrap; }
.ficha .rowf.end span:last-child{ min-width:0; overflow-wrap:anywhere; }
.com-end .head{ grid-template-columns:.9fr 1.1fr; }
.sub{ font-size:12px; font-weight:800; letter-spacing:.8px; text-transform:uppercase; color:var(--c1); margin:14px 0 8px; padding-left:10px; border-left:4px solid var(--accent); line-height:1.2; }
.sub:first-child{ margin-top:2px; }
.finGrid.g4{ grid-template-columns:repeat(4,1fr); }
.fc .s{ font-size:10px; color:var(--muted); margin-top:2px; }
.cmp{ display:grid; grid-template-columns:1fr 26px 1fr; align-items:center; gap:8px; }
.cmp .arr{ text-align:center; font-weight:900; color:var(--muted); font-size:18px; }
.cmp .fc.antes .v{ color:#B42318; }
.cmp .fc.depois .v{ color:#127A3E; }
.cmpMsg{ margin-top:8px; font-size:12px; font-weight:700; color:#39404C; }
.gbox{ border:1px solid var(--line); border-radius:12px; padding:8px 10px 6px; }
.gbox svg{ display:block; width:100%; height:auto; max-height:262px; margin:0 auto; }
.sec.fb .gbox svg{ max-height:190px; }
.gcap{ font-size:10.5px; color:var(--muted); text-align:center; margin-top:4px; }
.leg{ display:flex; gap:18px; justify-content:center; flex-wrap:wrap; font-size:10.5px; color:#39404C; font-weight:600; margin-top:4px; }
.leg i{ display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; vertical-align:middle; }
.eco{ margin-top:8px; background:var(--c3); border-radius:10px; padding:8px 14px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
.eco .a{ font-size:10.5px; font-weight:800; letter-spacing:.6px; text-transform:uppercase; color:var(--muted); }
.eco .b{ font-size:15px; font-weight:900; color:#127A3E; }
.nota{ font-size:10px; color:var(--muted); margin-top:6px; }
.invBig{ background:linear-gradient(135deg,var(--c1),var(--c2)); color:#fff; border-radius:14px; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; gap:14px; }
.invBig .k{ font-size:10.5px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; opacity:.85; }
.invBig .v{ font-size:30px; font-weight:900; line-height:1.05; margin-top:2px; }
.invBig .s{ font-size:11px; opacity:.85; text-align:right; max-width:260px; }
.dois{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.hi{ background:var(--c3); border:1px solid var(--line); border-left:5px solid var(--accent); border-radius:12px; padding:10px 14px; }
.hi .k{ font-size:10px; font-weight:800; letter-spacing:.6px; text-transform:uppercase; color:var(--muted); }
.hi .v{ font-size:21px; font-weight:900; color:var(--c1); line-height:1.1; margin-top:2px; }
.hi .v.t{ font-size:13px; line-height:1.3; font-weight:800; overflow-wrap:anywhere; }
.hi .s{ font-size:10.5px; color:#127A3E; font-weight:700; margin-top:3px; }
.pgrid{ display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
.pt{ border:1px solid var(--line); border-radius:9px; padding:6px 10px; background:#fff; display:flex; justify-content:space-between; align-items:baseline; gap:6px; }
.pt .n{ font-size:11px; font-weight:800; color:var(--muted); }
.pt .v{ font-size:13px; font-weight:900; color:var(--c1); }
.subnote{ font-size:10px; font-weight:600; color:var(--muted); text-transform:none; letter-spacing:0; margin-left:6px; }
.bgrid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.bk{ border:1px solid var(--line); border-radius:10px; padding:8px; text-align:center; background:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:5px; min-height:62px; }
.bk .lg{ height:34px; width:100%; display:flex; align-items:center; justify-content:center; background:#fff; }
.bk img{ max-width:100%; max-height:34px; object-fit:contain; display:block; }
.bk .nm{ font-size:10.5px; font-weight:700; color:#39404C; line-height:1.2; overflow-wrap:anywhere; }
.bk.so .nm{ font-size:12px; font-weight:800; color:var(--c1); }
.bk.fx{ padding:14px 20px; min-height:78px; }
.bk.fx .lg{ height:46px; width:100%; }
.bk.fx img{ max-width:100%; max-height:46px; width:100%; height:46px; object-fit:contain; }
.r .inc.qt{ text-transform:none; letter-spacing:0; font-size:11.5px; text-align:right; }
.dpag{ margin-top:2px; }
.acGap{ height:22px; }
.ln{ fill:none; stroke:var(--c1); stroke-width:2.4; stroke-linecap:round; stroke-linejoin:round; }
.ln.ac{ fill:var(--accent); }
.bgc{ fill:var(--c3); stroke:none; }
.prazoL{ font-size:14px; font-weight:800; color:var(--ink); margin-bottom:14px; }
.cron{ display:flex; flex-direction:column; }
.cr{ display:grid; grid-template-columns:68px 1fr; gap:18px; position:relative; padding-bottom:18px; }
.cr:last-child{ padding-bottom:0; }
.cr:not(:last-child)::before{ content:''; position:absolute; left:33px; top:72px; bottom:4px; border-left:2px dashed var(--c2); opacity:.45; }
.ci{ width:68px; height:68px; border-radius:18px; background:var(--c3); display:flex; align-items:center; justify-content:center; }
.cx{ align-self:center; }
.ct{ font-size:14px; font-weight:800; color:var(--c1); display:flex; align-items:center; gap:8px; }
.ct .n{ width:22px; height:22px; border-radius:50%; background:var(--c1); color:#fff; font-size:11px; font-weight:900; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.cd{ font-size:11.5px; color:#39404C; line-height:1.5; margin-top:4px; }
.fiob{ border:1px solid var(--line); border-radius:12px; padding:10px 14px 12px; background:var(--c3); }
.fiob .ft{ font-size:11px; color:#39404C; line-height:1.45; }
.fiob .fn{ font-size:11px; font-weight:700; color:var(--ink); line-height:1.45; margin-top:6px; }
.fgrid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:8px; }
.fy{ background:#fff; border:1px solid var(--line); border-radius:10px; padding:7px 10px; }
.fy .a{ font-size:15px; font-weight:900; color:var(--c1); }
.fy .p{ font-size:11px; font-weight:800; color:var(--muted); margin-top:1px; }
.fy .c{ font-size:11px; font-weight:700; color:var(--ink); margin-top:2px; }
.acT{ font-size:14px; font-weight:700; color:#39404C; line-height:1.5; }
.acL{ font-size:13px; font-weight:600; color:var(--ink); margin-top:14px; }
.sigs{ display:grid; grid-template-columns:1fr 1fr; gap:44px; margin-top:100px; }
.sg{ text-align:center; }
.sg .ln{ border-top:1.5px solid var(--ink); margin-bottom:8px; }
.sg .nm{ font-size:13px; font-weight:900; color:var(--ink); line-height:1.3; overflow-wrap:anywhere; }
.sg .dc{ font-size:11.5px; font-weight:600; color:#39404C; margin-top:3px; }
.sg .rp{ font-size:11.5px; color:#39404C; margin-top:2px; overflow-wrap:anywhere; }
.sg .rl{ font-size:9.5px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; color:var(--muted); margin-top:8px; }
.sec.ac{ flex:1; padding-top:34px; }
.tel{ width:100%; height:var(--th,232px); object-fit:cover; border-radius:12px; display:block; }
.tel.baixa{ height:190px; }
.telcap{ font-size:10.5px; color:var(--muted); font-style:italic; margin-top:5px; text-align:center; }
.ogrid{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.ob{ border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#fff; }
.ob img{ width:100%; height:var(--oh,150px); object-fit:cover; display:block; }
.ob .cap, .em .nm{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.ob .cap{ font-size:10.5px; font-weight:600; color:#39404C; padding:5px 8px 6px; min-height:24px; line-height:1.25; overflow-wrap:anywhere; }
.egrid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
.em{ border:1px solid var(--line); border-radius:10px; padding:8px; text-align:center; background:#fff; display:flex; flex-direction:column; align-items:center; gap:5px; }
.em .lg{ height:62px; width:100%; display:flex; align-items:center; justify-content:center; background:#fff; }
.em img{ max-width:100%; max-height:62px; object-fit:contain; display:block; }
.em .nm{ font-size:10.5px; font-weight:700; color:#39404C; line-height:1.2; overflow-wrap:anywhere; }
.sec.dist{ flex:1; display:flex; flex-direction:column; gap:28px; padding-bottom:20px; }
.sec.dist .sub{ margin-top:0; }
.prazo{ display:flex; align-items:center; gap:16px; border:1px solid var(--line); border-radius:12px; padding:12px 16px; }
.prazo .n{ font-size:38px; font-weight:900; color:var(--c1); line-height:1; }
.prazo .t{ font-size:13px; font-weight:800; color:var(--ink); }
.prazo .d{ font-size:11px; color:var(--muted); margin-top:3px; line-height:1.4; }
.vpill{ display:inline-block; font-size:10.5px; font-weight:800; color:var(--accent-text); background:var(--accent); padding:5px 12px; border-radius:999px; letter-spacing:.3px; }
.cta{ background:linear-gradient(135deg,var(--c1),var(--c2)); color:#fff; border-radius:14px; padding:20px 18px; text-align:center; }
.cta .t{ font-size:19px; font-weight:900; letter-spacing:-.3px; }
.cta .s{ font-size:12px; opacity:.92; margin-top:3px; }
.cta a{ display:inline-block; margin-top:12px; background:#fff; color:var(--c1); padding:10px 26px; border-radius:999px; font-weight:800; font-size:14px; text-decoration:none; }
.cta .ph{ margin-top:8px; font-size:15px; font-weight:800; letter-spacing:.3px; }
`;

// ─── Peças do modelo 4 ───────────────────────────────────────────────────────

const MAX_BANCOS_FOLHA = 12;
// Altura útil de uma folha (px, sem a faixa do topo): 1122 - 44 = 1078; o resto é folga.
const ORCAMENTO = 1040;

// Cronograma do projeto: texto e desenhos fixos do servidor (sem dado do usuário), por isso entram sem escape.
// Os desenhos são SVG em linha, no traço da cor da marca (classe .ln, variáveis --c1 e --accent).
const svgIcone = (miolo: string) => `<svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true" focusable="false">${miolo}</svg>`;
const ETAPAS_CRONOGRAMA = [
  {
    t: 'Projeto',
    d: 'O engenheiro dimensiona o sistema pela sua conta de luz e pelo seu telhado. Depois desenha o projeto elétrico e emite a ART, o registro da responsabilidade técnica.',
    // Prancheta com a planta e um lápis.
    svg: svgIcone('<rect class="ln" x="11" y="12" width="34" height="46" rx="4"/><rect class="ln ac" x="19" y="7" width="18" height="9" rx="3"/><path class="ln" d="M18 28h20M18 35h12M18 42h20M18 49h8"/><path class="ln ac" d="M38 55l2-9 13-13 7 7-13 13z"/><path class="ln" d="M43 49l5 5"/>'),
  },
  {
    t: 'Vistoria técnica',
    d: 'A equipe vai até o local e confere o telhado, a estrutura e o padrão de entrada de energia. Se o padrão precisar de ajuste, você fica sabendo antes da instalação.',
    // Casa com lupa.
    svg: svgIcone('<path class="ln" d="M6 31L27 12l21 19"/><path class="ln" d="M12 27v26h20"/><rect class="ln" x="19" y="38" width="9" height="15"/><circle class="ln ac" cx="44" cy="42" r="12"/><path class="ln" d="M53 51l8 8"/>'),
  },
  {
    t: 'Instalação',
    d: 'A equipe fixa a estrutura, monta os módulos e o inversor e instala as proteções elétricas. Tudo segue o projeto aprovado.',
    // Módulo solar inclinado (retângulo com a grade de células) e uma chave inglesa cruzando o canto de baixo.
    svg: svgIcone('<path class="ln ac" d="M20 10L56 10L48 42L10 42Z"/><path class="ln" d="M29 10L19 42M38 10L28 42M47 10L37 42M16.5 21.5H52M13 32H50"/><g transform="translate(50 40) rotate(40)"><rect class="ln" x="-3.4" y="4" width="6.8" height="25" rx="3.4" style="fill:var(--c1)"/><circle class="ln" cx="0" cy="0" r="9.5" style="fill:var(--c1)"/><rect class="bgc" x="-3.6" y="-13" width="7.2" height="10"/></g>'),
  },
  {
    t: 'Homologação',
    d: 'A empresa envia o projeto para a concessionária e acompanha o pedido até a aprovação. Depois a concessionária troca o medidor por um bidirecional.',
    // Documento com carimbo de aprovado.
    svg: svgIcone('<path class="ln" d="M13 7h27l11 11v39H13z"/><path class="ln" d="M40 7v11h11"/><path class="ln" d="M20 26h22M20 33h22M20 40h11"/><circle class="ln ac" cx="44" cy="46" r="12"/><path class="ln" d="M38 46l4 4 8-8"/>'),
  },
  {
    t: 'Ligação',
    d: 'Com o medidor novo, o sistema é ligado e começa a gerar. A energia que sobra vira crédito na sua conta de luz.',
    // Medidor com raio.
    svg: svgIcone('<circle class="ln" cx="32" cy="32" r="25"/><rect class="ln ac" x="19" y="13" width="26" height="10" rx="2"/><path class="ln ac" d="M36 27l-10 15h8l-3 13 12-18h-8z"/>'),
  },
] as const;

function fmtNum(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** "3 módulos Canadian de 550 W": cada pedaço só entra se houver dado. Sem nenhum, vazio. */
function descModulos(qtd: number, marca: string, potW: number): string {
  if (qtd <= 0) return '';
  return [`${qtd} ${qtd === 1 ? 'módulo' : 'módulos'}`, marca, potW > 0 ? `de ${fmtNum(potW)} W` : ''].filter(Boolean).join(' ');
}

function descInversor(qtd: number, marca: string, kw: number): string {
  if (!marca && !(kw > 0)) return '';
  return [`${qtd} ${qtd === 1 ? 'inversor' : 'inversores'}`, marca, kw > 0 ? `de ${fmtNum(kw)} kW` : ''].filter(Boolean).join(' ');
}

function descEstrutura(tipo: string): string {
  const t = tipo.trim();
  if (!t) return '';
  // Solo, laje e carport não são telhado: "Estrutura para telhado Solo" soaria errado.
  return /^(solo|laje|carport)$/i.test(t) ? `Estrutura para ${t.toLowerCase()}` : `Estrutura para telhado ${t.toLowerCase()}`;
}

function linhaComp(label: string, marca: string, desc: string): string {
  if (!desc) return linhaMk(label, marca, 'Incluído');
  return `<div class="r"><span class="lab">${pEsc(label)}${marca ? ` <em class="mkq">${pEsc(marca)}</em>` : ''}</span><span class="inc qt">${pEsc(desc)}</span></div>`;
}

function dataPorExtenso(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long', year: 'numeric' });
}

/** "CPF 529.982.247-25" (PF) ou "CNPJ 11.222.333/0001-81" (PJ), inteiro. */
function docClienteHtml(c: Assinatura['cliente']): string {
  if (!c.documento) return '';
  return c.tipo === 'PJ' ? `CNPJ ${pEsc(formatarCnpj(c.documento))}` : `CPF ${pEsc(formatarCpf(c.documento))}`;
}

/** Linha do cabeçalho da folha 1: rótulo à esquerda e número à direita, inteiro. */
function docClienteCabecalho(c: Assinatura['cliente']): { rotulo: string; html: string } | undefined {
  if (!c.documento) return undefined;
  return c.tipo === 'PJ'
    ? { rotulo: 'CNPJ', html: `<span class="num">${pEsc(formatarCnpj(c.documento))}</span>` }
    : { rotulo: 'CPF', html: `<span class="num">${pEsc(formatarCpf(c.documento))}</span>` };
}

// ─── O template ──────────────────────────────────────────────────────────────

export function propostaSolarCompleta(company: CompanyCompleta, client: ClienteProposta, f: Record<string, unknown>): string {
  const cores = coresModelo1(company);
  const p = cores.p;
  const contato = dadosContato(company, f);
  const { displayNome } = contato;
  const logo = srcImagemSegura(contato.logo, { logo: true });

  // ── Inputs (mesmos do modelo 1 e do Moderno) ──
  const cidade = (str(f.cidade) === '___' ? (client.cidade || '') : String(f.cidade)).trim();
  const uf = (str(f.uf) === '___' ? (client.uf || 'SP') : String(f.uf)).trim().toUpperCase();
  const consumoKwh = parseBRL(f.consumo_kwh);
  const qtdModulos = parseInt(String(f.qtd_modulos || '0'), 10) || 0;
  const potenciaModulo = parseInt(String(f.potencia_modulo || '0'), 10) || 0;
  const marcaModulo = String(f.marca_modulo || '').trim();
  const invLista = inversoresDaProposta(f);
  const bat = parseBateria(f);
  const kwp = (qtdModulos * potenciaModulo) / 1000;
  const investimento = parseBRL(f.investimento);
  const precoAvistaInput = parseBRL(f.preco_avista);
  const precoAvista = precoAvistaInput > 0 && precoAvistaInput < investimento ? precoAvistaInput : 0;
  const taxaMinima = parseFloat(String(f.taxa_minima || '90').replace(',', '.')) || 90;
  // Iluminação pública: só entra nos valores exibidos de conta hoje/depois (a taxa existe nos dois lados).
  const cip = Math.max(0, parseFloat(String(f.iluminacao_publica || '').replace(',', '.')) || 0);
  const garPaineis = parseInt(String(f.garantia_paineis || '25'), 10) || 25;
  const garInvDiferentes = pGarantiasInversoresDiferentes(invLista);
  const garInversor = Math.min(...invLista.map((i) => i.garantiaAnos));
  const garEstrutura = parseInt(String(f.garantia_estrutura || '10'), 10) || 10;
  const garInstalacao = parseInt(String(f.garantia_instalacao || '1'), 10) || 1;
  const garInstalacaoMeses = String(f.garantia_instalacao_unidade ?? 'anos').toLowerCase() === 'meses';
  const garInstalacaoUnidade = garInstalacaoMeses ? (garInstalacao === 1 ? 'mês' : 'meses') : (garInstalacao === 1 ? 'ano' : 'anos');
  const garExtras = ([1, 2] as const).flatMap((i) => {
    const nome = String(f[`garantia_extra${i}_nome`] || '').trim();
    const anos = parseInt(String(f[`garantia_extra${i}_anos`] || '0'), 10) || 0;
    return nome && anos > 0 ? [{ nome, anos }] : [];
  });
  const prazoDias = parseInt(String(f.prazo_instalacao_dias || '45'), 10) || 45;
  const inflacaoPct = parseFloat(String(f.inflacao_aa || '6').replace(',', '.')) || 6;
  const inflacaoTaxaMinPct = parseFloat(String(f.taxa_minima_inflacao_aa || '6').replace(',', '.')) || 6;
  const tipoTelhado = (str(f.tipo_telhado) === '___' ? (client.tipo_telhado || '') : String(f.tipo_telhado)).trim();
  const enderecoCli = (str(f.endereco) === '___' ? (client.endereco || '') : String(f.endereco || client.endereco || '')).trim();
  const fotoTelhado = srcImagemSegura(str(f.foto_telhado_b64) === '___' ? '' : f.foto_telhado_b64);
  const obrasTodas = lerObras(f.fotos_obras);
  const empresas = lerEmpresas(f.empresas_atendidas);
  // Folha 3: SÓ os bancos fixos de bancos_logos (ausente = os 8, [] = nenhum). `bancos_parceiros` (o "outro banco"
  // de propostas antigas) é ignorado no modelo 4: o campo fica guardado, mas nunca sai na folha.
  const bancos: Array<ItemBancoT & { fixo?: boolean }> = bancosEscolhidos(f.bancos_logos)
    .map((id) => ({ nome: BANCOS_FIXOS[id].nome, src: BANCOS_FIXOS[id].img, fixo: true }))
    .slice(0, MAX_BANCOS_FOLHA);
  const dadosBanc = normalizarDadosBancarios(company.dados_bancarios);
  const mostraDadosBanc = f.mostrar_dados_bancarios !== false && dadosBancariosCompletos(dadosBanc);
  const assin = normalizarAssinatura(f.assinatura);
  const temAceite = !!assin && !!assin.cliente.nome && !!assin.empresa.razao_social;

  // ── Cálculos: os mesmos do Moderno ──
  const refBase = getRef(uf, cidade);
  const tarifaOverride = parseFloat(String(f.tarifa_kwh || '').replace(',', '.'));
  const ref = { ...refBase, tarifa: tarifaOverride > 0 ? tarifaOverride : refBase.tarifa };
  const geracaoMediaOverride = parseBRL(f.geracao_media_kwh);
  const hspOverride = parseFloat(String(f.hsp || '').replace(',', '.')) || 0;
  const mensal = geracaoMensal(kwp, uf, cidade, geracaoMediaOverride > 0 ? geracaoMediaOverride : undefined, hspOverride > 0 ? hspOverride : undefined);
  const geracaoAnual = mensal.reduce((a, b) => a + b, 0);
  const mediaMensalGerada = Math.round(geracaoAnual / 12);
  const autonomia = consumoKwh > 0 ? Math.min(130, Math.round((mediaMensalGerada / consumoKwh) * 100)) : 100;
  const areaInformada = parseBRL(f.area_m2);
  const areaM2 = areaInformada > 0 ? areaInformada : (qtdModulos > 0 ? Math.round(qtdModulos * 2.5 * 10) / 10 : 0);
  // Fio B (Lei 14.300): ligado, a conta COM solar de cada ano leva o custo dele e TODOS os números abaixo
  // (conta após instalação, economia, retorno, 25 anos, gráfico) saem dessa mesma conta.
  const fioBLido = lerFioB(f);
  const fioBSerie = fioBLido
    ? serieFioB({ fio: fioBLido, geracaoMediaMensal: geracaoAnual / 12, inflacao: inflacaoPct / 100, anoInicial: anoCivil(propostaEmissao(f)) })
    : null;
  const fin = calcularFinanceiro({
    consumoKwh, tarifa: ref.tarifa, taxaMinima,
    inflacao: inflacaoPct / 100, inflacaoTaxaMin: inflacaoTaxaMinPct / 100, investimento,
    ...(fioBSerie ? { fioBMensal: fioBSerie.custoMensal } : {}),
  });
  const { paybackTexto, contaHoje, economiaMensal, semSolarAcum, comSolarAcum, economia25, breakdownAnos, breakdownEconomia } = fin;
  const contaHojeExib = cip > 0 ? Math.round(consumoKwh * ref.tarifa + cip) : contaHoje;
  const contaComSolarExib = fin.contaComSolar + cip;

  // ── Formas de pagamento (a mesma leitura do form do Moderno) ──
  const vistaOn = f.pag_vista !== false;
  const cartaoOn = f.pag_cartao !== false;
  const finOn = f.pag_fin !== false;
  const entradaOn = f.pag_entrada === true;
  const cartaoAtivos = Array.from({ length: 21 }, (_, i) => i + 1).filter((n) => f[`pag_cartao_${n}`] === true);
  const finAtivos = FIN_PRAZOS.filter((n) => f[`pag_fin_${n}`] === true);
  const entradaValor = parseBRL(f.entrada_valor);
  const entradaRestante = investimento > 0 && entradaValor > 0 ? Math.max(0, investimento - entradaValor) : 0;
  const entradaModoRaw = String(f.entrada_modo || 'dias');
  const entradaDias = parseInt(String(f.entrada_dias || '30'), 10) || 30;
  const entradaPrazoLabel = entradaModoRaw === 'contrato' ? 'na assinatura do contrato'
    : entradaModoRaw === 'entrega' ? 'na entrega do material'
    : entradaModoRaw === 'montagem' ? 'na montagem do sistema'
    : entradaModoRaw === 'liberacao' ? 'na liberação do sistema'
    : `em ${entradaDias} dia${entradaDias === 1 ? '' : 's'}`;
  const pagCustom = String(f.pag_custom || '').trim();

  const parcelasCartao = cartaoOn && investimento > 0
    ? cartaoAtivos.map((n) => ({ n, v: valorParcelaCartao(f, investimento, n) })).filter((x) => x.v > 0) : [];
  const parcelasFin = finOn && investimento > 0
    ? finAtivos.map((n) => ({ n, v: valorParcelaFin(f, investimento, n) })).filter((x) => x.v > 0) : [];
  // Parcela de destaque no topo do financeiro: financiamento mais longo; senão o cartão mais longo.
  const parcelaLabel = parcelasFin.length
    ? `ou ${parcelasFin[parcelasFin.length - 1].n}× de ${brl(parcelasFin[parcelasFin.length - 1].v)}`
    : parcelasCartao.length
      ? `ou ${parcelasCartao[parcelasCartao.length - 1].n}× de ${brl(parcelasCartao[parcelasCartao.length - 1].v)}`
      : '';
  const temEntrada = entradaOn && investimento > 0 && entradaValor > 0 && entradaRestante > 0;

  // ── Formatação ──
  function brl(n: number): string { return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function n1(n: number): string { return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  const hoje = propostaEmissao(f).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const validade = propostaValidade(f);
  const marcaMod = [marcaModulo, potenciaModulo > 0 ? `${potenciaModulo}W` : ''].filter(Boolean).join(' · ');
  const cap1 = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
  const anosTxt = (n: number) => `${n} ${n === 1 ? 'ano' : 'anos'}`;

  const band = (titulo: string) => `<div class="band"><div class="tab">${pEsc(titulo)}</div><div class="bar"></div></div>`;
  const sub = (titulo: string, nota = '') => `<div class="sub">${pEsc(titulo)}${nota ? `<span class="subnote">${pEsc(nota)}</span>` : ''}</div>`;

  const temConsumo = consumoKwh > 0;
  // Sem economia (mensal ou de 25 anos) não aparece NADA de economia: nem frase, nem cartões, nem faixa, nem gráfico.
  const mostraEconomia = temConsumo && economia25 > 0 && economiaMensal > 0;

  // ═══ Folha 1: Projeto (o visual do modelo 1 inteiro, menos o rodapé grande) ═══
  const bateriaQtd = bat.qtd > 0 ? bat.qtd : 1;
  const bateriaDesc = bat.tem
    ? [`${bateriaQtd} ${bateriaQtd === 1 ? 'bateria' : 'baterias'}`, bat.marca, bat.capacidade > 0 ? `de ${fmtNum(bat.capacidade)} kWh` : ''].filter(Boolean).join(' ')
    : '';
  const bateriaLinha = bat.tem
    ? linhaComp('Bateria', [bat.potencia > 0 ? `${fmtNum(bat.potencia)} kW` : '', bat.ciclos > 0 ? `${bat.ciclos.toLocaleString('pt-BR')} ciclos` : ''].filter(Boolean).join(' · '), bateriaDesc)
    : '';
  const totalKwInv = totalKwInversores(invLista);
  const inversoresLinhas = [
    ...invLista.map((i) => linhaComp('Inversor', '', descInversor(i.qtd, i.marca, i.potenciaKw))),
    ...(invLista.length > 1 && totalKwInv > 0
      ? [linhaMk('Potência total dos inversores', '', `${totalKwInv.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kW`)]
      : []),
  ].join('\n      ');

  const folha1 = `
  ${cabecalhoModelo1({ logo, displayNome, hoje, clienteNome: client.nome, enderecoCli, validadeCurto: validade.curto, clienteDoc: assin ? docClienteCabecalho(assin.cliente) : undefined })}

  ${band('Detalhamento do Projeto')}
  <div class="sec">
    <div class="tiles">
      <div class="tile"><div class="k">Potência instalada</div><div class="v num">${pKwp(kwp)}<u>kWp</u></div></div>
      <div class="tile"><div class="k">Produção média/mês</div><div class="v num">${pNum(mediaMensalGerada)}<u>kWh</u></div></div>
      <div class="tile"><div class="k">Autonomia</div><div class="v num">${autonomia}<u>%</u></div></div>
    </div>
    <div class="rows">
      <div class="r"><span class="lab">Consumo médio mensal</span><span class="val num">${pNum(consumoKwh)} kWh</span></div>
      <div class="r"><span class="lab">Quantidade de módulos fotovoltaicos</span><span class="val num">${qtdModulos}</span></div>
      ${areaM2 > 0 ? `<div class="r"><span class="lab">Área mínima necessária</span><span class="val num">${n1(areaM2)} m²</span></div>` : ''}
      <div class="r"><span class="lab">Tarifa de energia</span><span class="val num">${brl(ref.tarifa)} /kWh</span></div>
      ${cidade ? `<div class="r"><span class="lab">Localização</span><span class="val">${pEsc(cidade)}/${pEsc(uf)}</span></div>` : ''}
      ${tipoTelhado ? `<div class="r"><span class="lab">Tipo de instalação</span><span class="val">${pEsc(tipoTelhado)}</span></div>` : ''}
    </div>
  </div>

  ${band('Composição do Sistema')}
  <div class="sec">
    <div class="rows">
      ${linhaComp('Módulos fotovoltaicos', descModulos(qtdModulos, marcaModulo, potenciaModulo) ? '' : marcaMod, descModulos(qtdModulos, marcaModulo, potenciaModulo))}
      ${inversoresLinhas}
      ${bateriaLinha}
      ${linhaComp('Estrutura e materiais elétricos', '', descEstrutura(tipoTelhado))}
      ${linhaMk('Projeto de engenharia e conexão à rede', '', 'Incluído')}
      ${linhaMk('Serviço de instalação', '', 'Incluído')}
      ${linhaMk(`Garantias (painéis ${garPaineis} anos · ${garInvDiferentes ? `inversores ${garInvDiferentes}` : `inversor ${invLista[0].garantiaAnos} anos`})`, '', 'Incluído')}
    </div>
  </div>

  ${analiseModelo1({ economia25, investimento, parcelaLabel: cap1(parcelaLabel), economiaMensal, taxaMinima: fin.contaComSolar, notaConta: fioBSerie ? (cip > 0 ? `Taxa mínima + Fio B + iluminação pública ${brl(cip)}` : 'Taxa mínima + Fio B') : undefined, cip, paybackTexto, semEconomia: !mostraEconomia, semConsumo: !temConsumo, semEconomiaMensal: temConsumo && !mostraEconomia, semRetorno: temConsumo && (!mostraEconomia || paybackTexto === '—'), capitalizar: true })}`;

  // ═══ Blocos (cada um vira parte de uma folha; as folhas leves se juntam no fim) ═══
  const parcelaLabelCap = cap1(parcelaLabel);
  const hspTxt = ref.hsp.toFixed(1).replace('.', ',');
  // À vista só aparece com desconto: sem ele repetiria o preço do projeto logo acima (precoAvista já vem 0 se for >= investimento).
  const vistaMostra = vistaOn && precoAvista > 0;
  const temPagamentos = vistaMostra || parcelasCartao.length > 0 || parcelasFin.length > 0 || temEntrada || !!pagCustom;
  const temFolha3 = temPagamentos || bancos.length > 0 || mostraDadosBanc;

  // Geração mês a mês (única parte da folha 2 que não depende do consumo).
  const geracaoHtml = `${sub('Geração estimada mês a mês', `${cidade ? `${cidade}/${uf}` : uf}`)}
    <div class="gbox">
      ${svgBarrasMensais(mensal, MESES_ABREV, p.c1, p.c2)}
      <div class="gcap">Geração média anual: <strong>${pNum(geracaoAnual)} kWh</strong> · HSP da região: <strong>${hspTxt} h/dia</strong></div>
    </div>`;

  const tileInvestimento = investimento > 0
    ? `<div class="invBig"><div><div class="k">Preço do projeto</div><div class="v num">${brl(investimento)}</div></div>${parcelaLabelCap && temPagamentos ? `<div class="s num">${pEsc(parcelaLabelCap)}</div>` : ''}</div>`
    : '';

  // Fio B (Lei 14.300): bloco da folha de economia, quando ligado. Os números da conta já descontam esse custo.
  const fioBHtml = fioBSerie
    ? `${sub('Fio B (Lei 14.300)')}
    <div class="fiob">
      <div class="ft">Quem instala a partir de 2023 paga uma parte do Fio B sobre a energia que vai para a rede. Essa parte sobe a cada ano até chegar a 100% em 2029.</div>
      <div class="fn">${pEsc(`Nesta proposta: Fio B de ${brl(fioBSerie.tarifa)} por kWh e simultaneidade de ${fmtNum(fioBSerie.simultaneidade)}%, então ${fioBSerie.pct > 0 ? `${fmtNum(fioBSerie.pct)}% da geração vai para a rede.` : 'nada vai para a rede e não há custo de Fio B.'}${mostraEconomia ? ' A economia desta proposta já desconta esse custo.' : ''}`)}</div>
      <div class="fgrid">${[0, 1, 2, 3].map((i) => `<div class="fy"><div class="a num">${fioBSerie.anoInicial + i}</div><div class="p num">${fioBSerie.percentuais[i]}%</div><div class="c num">${pEsc(`${brl(fioBSerie.custoMensal[i])} por mês`)}</div></div>`).join('')}</div>
    </div>`
    : '';

  // ═══ Folha 2: Economia e geração ═══
  const bandaF2 = band('Economia e Geração');
  const corpoF2 = temConsumo
    ? `<div class="sec${fioBSerie ? ' fb' : ''}">
    ${contaHoje > 0 ? `${sub('Conta hoje x com energia solar')}
    <div class="cmp">
      <div class="fc antes"><div class="k">Hoje você paga</div><div class="v num">${brl(contaHojeExib)}</div><div class="s">Por mês na sua conta</div></div>
      <div class="arr">→</div>
      <div class="fc depois"><div class="k">Com energia solar</div><div class="v num">${brl(contaComSolarExib)}</div><div class="s">${fioBSerie ? (cip > 0 ? pEsc(`Taxa mínima + Fio B + iluminação pública ${brl(cip)}`) : 'Taxa mínima da concessionária + Fio B') : (cip > 0 ? pEsc(`Taxa mínima da concessionária + iluminação pública ${brl(cip)}`) : 'Taxa mínima da concessionária')}</div></div>
    </div>
    ${mostraEconomia ? `<div class="cmpMsg">Economia de ${brl(economiaMensal)} todo mês${paybackTexto !== '—' ? `. Em ${pEsc(paybackTexto)} o sistema se paga sozinho` : ''}.</div>` : ''}` : ''}

    ${geracaoHtml}

    ${mostraEconomia ? `${sub('Sua economia em 25 anos')}
    <div class="gbox">
      ${svgCurvas25(semSolarAcum, comSolarAcum)}
      <div class="leg">
        <span><i style="background:#EF4444"></i>Sem energia solar (${pBRLshort(semSolarAcum[NUM_ANOS - 1])} em 25 anos)</span>
        <span><i style="background:#10B981"></i>Com energia solar (${pBRLshort(comSolarAcum[NUM_ANOS - 1])} em 25 anos)</span>
      </div>
    </div>
    <div class="eco"><span class="a">A área verde é sua economia</span><span class="b">${brl(economia25)} a mais no seu bolso</span></div>

    <div class="finGrid g4" style="margin-top:10px">
      ${breakdownAnos.map((ano, i) => `<div class="fc"><div class="k">Em ${ano} ${ano === 1 ? 'ano' : 'anos'}</div><div class="v num">${brl(breakdownEconomia[i])}</div></div>`).join('')}
    </div>
    <div class="nota">Tarifa atual ${ref.tarifa.toFixed(2).replace('.', ',')} R$/kWh · cresce ${inflacaoPct.toFixed(0).replace('.', ',')}% a.a. · taxa mínima cresce ${inflacaoTaxaMinPct.toFixed(0).replace('.', ',')}% a.a.</div>` : ''}
    ${fioBHtml}
  </div>`
    : `<div class="sec">${geracaoHtml}${fioBHtml ? `\n    ${fioBHtml}` : ''}</div>`;

  // ═══ Folha 3: Investimento e formas de pagamento ═══
  const blocoVista = vistaMostra
    ? `<div class="hi"><div class="k">${precoAvista > 0 ? 'Desconto à vista' : 'À vista'}</div><div class="v num">${brl(precoAvista > 0 ? precoAvista : investimento)}</div>${precoAvista > 0 ? `<div class="s">Economia de ${brl(investimento - precoAvista)}</div>` : ''}</div>`
    : '';
  // Entrada: o valor da entrada e o do restante, sem dizer "hoje". No M1 o texto sai "hoje · no ato do
  // contrato", que se contradiz; aqui só o Completo foi corrigido.
  const blocoEntrada = temEntrada
    ? `<div class="hi"><div class="k">Entrada + saldo</div><div class="v num">${brl(entradaValor)} + ${brl(entradaRestante)}</div><div class="s">Entrada de ${brl(entradaValor)} · Restante de ${brl(entradaRestante)} ${entradaPrazoLabel}</div></div>`
    : '';
  const dois = [blocoVista, blocoEntrada].filter(Boolean);
  const linhasDadosBanc: string[] = [];
  if (mostraDadosBanc && dadosBanc) {
    const l = (k: string, v: string, valorHtml?: string) => `<div class="r"><span class="lab">${pEsc(k)}</span><span class="val">${valorHtml ?? pEsc(v)}</span></div>`;
    if (dadosBanc.banco) linhasDadosBanc.push(l('Banco', dadosBanc.banco));
    if (dadosBanc.agencia) linhasDadosBanc.push(l('Agência', dadosBanc.agencia));
    if (dadosBanc.conta) linhasDadosBanc.push(l('Conta', `${dadosBanc.conta}${dadosBanc.tipo_conta === 'corrente' ? ' corrente' : dadosBanc.tipo_conta === 'poupanca' ? ' poupança' : ''}`));
    if (dadosBanc.titular) linhasDadosBanc.push(l('Titular', dadosBanc.titular));
    if (dadosBanc.documento) linhasDadosBanc.push(l('CPF/CNPJ do titular', dadosBanc.documento));
    if (dadosBanc.pix) linhasDadosBanc.push(l('Chave Pix', dadosBanc.pix));
  }
  const corpoF3 = `<div class="sec">
    ${tileInvestimento}
    ${dois.length ? `<div class="dois" style="margin-top:10px${dois.length === 1 ? ';grid-template-columns:1fr' : ''}">${dois.join('')}</div>` : ''}
    ${parcelasCartao.length ? `${sub('Cartão de crédito', 'Sem entrada')}
    <div class="pgrid">${parcelasCartao.map((x) => `<div class="pt"><span class="n">${x.n}× de</span><span class="v num">${pBRL(x.v)}</span></div>`).join('')}</div>` : ''}
    ${parcelasFin.length ? `${sub('Financiamento bancário', '120 dias de carência')}
    <div class="pgrid">${parcelasFin.map((x) => `<div class="pt"><span class="n">${x.n}× de</span><span class="v num">${pBRL(x.v)}</span></div>`).join('')}</div>` : ''}
    ${pagCustom ? `${sub('Condição especial')}
    <div class="hi"><div class="v t">${pEsc(pagCustom)}</div><div class="s">A combinar com o vendedor</div></div>` : ''}
    ${bancos.length ? `${sub('Bancos que financiam o seu sistema')}
    <div class="bgrid">${bancos.map((b) => `<div class="bk fx"><div class="lg"><img src="${pEsc(b.src)}" alt="${pEsc(b.nome)}"/></div></div>`).join('')}</div>` : ''}
    ${mostraDadosBanc && dadosBanc ? `${sub('Dados para pagamento')}
    <div class="rows dpag">${linhasDadosBanc.join('\n      ')}</div>` : ''}
  </div>`;
  const estF3 = 55 + (tileInvestimento ? 85 : 0) + (dois.length ? 100 : 0)
    + (parcelasCartao.length ? 36 + Math.ceil(parcelasCartao.length / 3) * 36 : 0)
    + (parcelasFin.length ? 36 + Math.ceil(parcelasFin.length / 3) * 36 : 0)
    + (pagCustom ? 120 : 0) + (bancos.length ? 36 + Math.ceil(bancos.length / 4) * 78 : 0)
    + (linhasDadosBanc.length ? 36 + linhasDadosBanc.length * 34 : 0);

  // ═══ Folha 4: Local da instalação (foto do telhado) e Quem já confia na gente (obras e empresas) ═══
  // Obras: só entram a partir de 6 fotos, e sempre em fileiras completas de 3 (6, 9 ou 12). As que sobram
  // ficam salvas na empresa e só não saem no PDF.
  const nObras = obrasTodas.length >= 6 ? Math.floor(Math.min(obrasTodas.length, 12) / 3) * 3 : 0;
  const obras = obrasTodas.slice(0, nObras);
  const temConfianca = obras.length > 0 || empresas.length > 0;
  const temFolha4 = temConfianca || !!fotoTelhado;
  const linhasObras = Math.ceil(obras.length / 3);
  const linhasEmpresas = Math.ceil(empresas.length / 4);
  // Altura das fotos (px) por combinação, da mais folgada para a mais compacta: a primeira em que tudo
  // cabe numa folha só vale; se nenhuma serve, vale a folgada e o que sobra vai para a folha seguinte.
  const COMBOS_F4: Array<{ tel: number; obra: number }> = [
    { tel: 232, obra: 150 }, { tel: 190, obra: 150 }, { tel: 190, obra: 122 }, { tel: 150, obra: 110 }, { tel: 150, obra: 96 },
  ];
  type PecaF4 = { tipo: 'telhado' | 'obras' | 'empresas'; est: number };
  const pecasF4 = (c: { tel: number; obra: number }): PecaF4[] => [
    ...(fotoTelhado ? [{ tipo: 'telhado' as const, est: 55 + c.tel + 14 }] : []),
    ...(obras.length ? [{ tipo: 'obras' as const, est: 36 + linhasObras * (c.obra + 40) + 14 }] : []),
    ...(empresas.length ? [{ tipo: 'empresas' as const, est: 36 + linhasEmpresas * 104 + 14 }] : []),
  ];
  // Empacota as peças em folhas (a faixa "Quem já confia na gente" custa 55 na primeira peça de confiança de cada folha).
  const empacotarF4 = (c: { tel: number; obra: number }): PecaF4[][] => {
    const folhasF4: PecaF4[][] = [];
    let atual: PecaF4[] = [];
    let usado = 0;
    for (const pc of pecasF4(c)) {
      const confiancaNova = pc.tipo !== 'telhado' && !atual.some((x) => x.tipo !== 'telhado');
      const custo = pc.est + (confiancaNova ? 55 : 0);
      if (atual.length && usado + custo > ORCAMENTO) { folhasF4.push(atual); atual = []; usado = 0; }
      const novaConf = pc.tipo !== 'telhado' && !atual.some((x) => x.tipo !== 'telhado');
      atual.push(pc);
      usado += pc.est + (novaConf ? 55 : 0);
    }
    if (atual.length) folhasF4.push(atual);
    return folhasF4;
  };
  // Vale a combinação que dá MENOS folhas; no empate, a de fotos mais altas (a primeira da lista).
  const comboF4 = COMBOS_F4.reduce((melhor, c) => (empacotarF4(c).length < empacotarF4(melhor).length ? c : melhor), COMBOS_F4[0]);
  const paginasF4 = temFolha4
    ? empacotarF4(comboF4).map((pecas) => {
      let html = '';
      let est = 0;
      let confiancaAberta = false;
      for (const pc of pecas) {
        if (pc.tipo === 'telhado') {
          html += `${band('Local da instalação')}
  <div class="sec"><img class="tel" style="height:${comboF4.tel}px" src="${pEsc(fotoTelhado)}" alt="Local da instalação"/></div>
  `;
        } else {
          if (!confiancaAberta) { html += `${band('Quem já confia na gente')}\n  `; confiancaAberta = true; est += 55; }
          if (pc.tipo === 'obras') {
            html += `<div class="sec">${sub('Obras realizadas')}
    <div class="ogrid" style="--oh:${comboF4.obra}px">${obras.map((o) => `<div class="ob"><img src="${pEsc(o.src)}" alt="${pEsc(o.legenda || 'Obra realizada')}"/><div class="cap">${pEsc(o.legenda)}</div></div>`).join('')}</div></div>
  `;
          } else {
            html += `<div class="sec">${sub('Empresas atendidas')}
    <div class="egrid">${empresas.map((e) => `<div class="em"><div class="lg"><img src="${pEsc(e.src)}" alt="${pEsc(e.nome || 'Empresa atendida')}"/></div>${e.nome ? `<div class="nm">${pEsc(e.nome)}</div>` : ''}</div>`).join('')}</div></div>
  `;
          }
        }
        est += pc.est;
      }
      return { html: html.trimEnd(), est };
    })
    : [];

  // ═══ Folha 5: Garantias e próximos passos (com o rodapé grande) ═══
  const vendWhats = contato.vendWhats;
  const phoneLimpo = vendWhats.replace(/^55/, '');
  const phoneBonito = phoneLimpo.length === 11
    ? `(${phoneLimpo.slice(0, 2)}) ${phoneLimpo.slice(2, 7)}-${phoneLimpo.slice(7)}`
    : phoneLimpo;
  const waLink = `https://wa.me/55${phoneLimpo}?text=${encodeURIComponent(`Olá ${contato.vendedor || ''}! Quero fechar a proposta de ${client.nome}.`)}`;
  const garantias: Array<{ k: string; v: string }> = [
    { k: 'Painéis', v: anosTxt(garPaineis) },
    { k: 'Inversor', v: garInvDiferentes ? garInvDiferentes : anosTxt(garInversor) },
    { k: 'Estrutura', v: anosTxt(garEstrutura) },
    { k: 'Instalação', v: `${garInstalacao} ${garInstalacaoUnidade}` },
    ...(bat.tem && bat.garantia > 0 ? [{ k: 'Bateria', v: anosTxt(bat.garantia) }] : []),
    ...garExtras.map((g) => ({ k: g.nome, v: anosTxt(g.anos) })),
  ];
  // Sem a folha 3, o investimento abre a folha 5, antes das garantias.
  const investF5 = !temFolha3 ? tileInvestimento : '';
  // Cronograma do projeto: linha do prazo total e 5 etapas na vertical, cada uma com um desenho (SVG em linha).
  const cronogramaMiolo = `<div class="prazoL">${pEsc(`Do contrato à ligação: até ${prazoDias} dias úteis.`)}</div>
    <div class="nota" style="margin:-8px 0 14px">O prazo pode variar conforme a aprovação do órgão regulador.</div>
    <div class="cron">${ETAPAS_CRONOGRAMA.map((e, i) => `<div class="cr"><div class="ci">${e.svg}</div><div class="cx"><div class="ct"><span class="n">${i + 1}</span>${e.t}</div><div class="cd">${e.d}</div></div></div>`).join('')}</div>`;
  const blocosF5Base = [
    investF5 ? `<div>${investF5}</div>` : '',
    `<div>${sub('Garantias inclusas')}
    <div class="finGrid g4">${garantias.map((g) => `<div class="fc"><div class="k">${pEsc(g.k)}</div><div class="v">${pEsc(g.v)}</div></div>`).join('')}</div></div>`,
  ];
  const blocosF5Fim = [
    `<div><span class="vpill">${pEsc(validade.longo.toUpperCase())}</span></div>`,
    vendWhats ? `<div class="cta"><div class="t">Quer fechar essa proposta?</div><div class="s">Me chama no WhatsApp que a gente tira do papel agora</div><a href="${pEsc(waLink)}" target="_blank" rel="noopener noreferrer">Quero fechar pelo WhatsApp</a><div class="ph num">${pEsc(phoneBonito)}</div></div>` : '',
  ];
  const estCronograma = 36 + 54 + ETAPAS_CRONOGRAMA.length * 92;
  const estF5Sem = 55 + (investF5 ? 95 + 28 : 0) + 36 + Math.ceil(garantias.length / 4) * 66 + 28 + 30 + (vendWhats ? 28 + 164 : 0) + (temAceite ? 0 : 250);
  // O cronograma fica na folha de garantias se tudo couber; senão ganha folha própria, antes dela.
  const cronogramaNaF5 = estF5Sem + 28 + estCronograma <= ORCAMENTO;
  const corpoF5 = `<div class="sec dist">
    ${[...blocosF5Base, ...(cronogramaNaF5 ? [`<div>${sub('Cronograma do projeto')}
    ${cronogramaMiolo}</div>`] : []), ...blocosF5Fim].filter(Boolean).join('\n    ')}
  </div>${temAceite ? '' : `
  ${rodapeModelo1(company, contato, 'Contato')}`}`;
  const estF5 = estF5Sem + (cronogramaNaF5 ? 28 + estCronograma : 0);
  const folhaCronograma = cronogramaNaF5 ? '' : `${band('Cronograma do projeto')}
  <div class="sec">${cronogramaMiolo}</div>`;

  // ═══ Última folha: Aceite da proposta (só com f.assinatura) e o rodapé grande ═══
  let folhaAceite = '';
  if (temAceite && assin) {
    const { empresa, cliente } = assin;
    const local = assin.local || String(company.cidade || '').trim() || cidade;
    const linhaLocal = [local, dataPorExtenso(propostaEmissao(f))].filter(Boolean).join(', ');
    const ehPJ = cliente.tipo === 'PJ';
    const sigEmpresa = `<div class="sg"><div class="ln"></div>
        <div class="nm">${pEsc(empresa.razao_social)}</div>
        ${empresa.cnpj ? `<div class="dc">CNPJ ${pEsc(formatarCnpj(empresa.cnpj))}</div>` : ''}
        ${empresa.representante ? `<div class="rp">${pEsc([empresa.representante, empresa.cargo].filter(Boolean).join(', '))}</div>` : ''}
        <div class="rl">Pela empresa</div></div>`;
    const sigCliente = `<div class="sg"><div class="ln"></div>
        <div class="nm">${pEsc(cliente.nome)}</div>
        ${cliente.documento ? `<div class="dc">${docClienteHtml(cliente)}</div>` : ''}
        ${ehPJ && cliente.representante ? `<div class="rp">${pEsc(cliente.representante)}</div>` : ''}
        <div class="rl">Pelo cliente</div></div>`;
    // Resumo do que está sendo aceito: só as linhas que têm dado.
    const lr = (k: string, v: string) => `<div class="r"><span class="lab">${pEsc(k)}</span><span class="val num">${pEsc(v)}</span></div>`;
    const codigoProp = String(f.codigo ?? '').trim();
    const descMod = descModulos(qtdModulos, marcaModulo, potenciaModulo);
    const sistema = kwp > 0 ? `${pKwp(kwp)} kWp${descMod ? ` com ${descMod}` : ''}` : '';
    const descInv = invLista.map((i) => descInversor(i.qtd, i.marca, i.potenciaKw)).filter(Boolean).join(', ');
    const ateData = new Date(propostaEmissao(f).getTime() + validade.dias * 86400000);
    const validadeTxt = Number.isNaN(ateData.getTime()) ? '' : `Até ${ateData.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
    const linhasResumo = [
      codigoProp ? lr('Proposta', codigoProp) : '',
      sistema ? lr('Sistema', sistema) : '',
      descInv ? lr('Inversor', descInv) : '',
      investimento > 0 ? lr('Preço do projeto', brl(investimento)) : '',
      vistaMostra ? lr('À vista', brl(precoAvista)) : '',
      validadeTxt ? lr('Validade', validadeTxt) : '',
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
  // Cada item leva o que a folha tem e uma estimativa de altura (px, sem a faixa do topo). A folha 2
  // sem consumo só tem o gráfico de geração: se couber junto da folha seguinte, as duas viram uma.
  const geracaoSecao = `${bandaF2}\n  ${corpoF2}`;
  const estGeracao = 38 + 17 + 36 + 290 + (fioBSerie ? 190 : 0);
  const seguintes: Array<{ html: string; est: number }> = [
    ...(temFolha3 ? [{ html: `${band('Investimento e formas de pagamento')}\n  ${corpoF3}`, est: estF3 }] : []),
    ...paginasF4,
    ...(folhaCronograma ? [{ html: folhaCronograma, est: estCronograma + 55 }] : []),
    { html: `${band('Garantias e próximos passos')}\n  ${corpoF5}`, est: estF5 },
  ];
  const conteudos: string[] = [folha1];
  if (temConsumo) {
    conteudos.push(`${bandaF2}\n  ${corpoF2}`);
  } else if (seguintes[0].est + estGeracao <= ORCAMENTO) {
    seguintes[0] = { html: `${geracaoSecao}\n  ${seguintes[0].html}`, est: seguintes[0].est + estGeracao };
  } else {
    conteudos.push(`${bandaF2}\n  ${corpoF2}`);
  }
  for (const s of seguintes) conteudos.push(s.html);
  if (folhaAceite) conteudos.push(folhaAceite);
  const total = conteudos.length;
  const topo = (n: number) => `<div class="topo">${logo ? `<img src="${pEsc(logo)}" alt="${pEsc(displayNome)}"/>` : `<span class="tn">${pEsc(displayNome || 'Sua Marca')}</span>`}<span class="tt">${pEsc(`Proposta Comercial · ${client.nome || ''} · ${n}/${total}`)}</span></div>`;
  const folhas = conteudos.map((c, i) => `<div class="page${i === 0 && enderecoCli ? ' com-end' : ''}">${i === 0 ? '' : topo(i + 1)}${c}
</div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794, user-scalable=yes"/>
<title>Proposta Solar Completa + Banco · ${pEsc(client.nome)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
${cssRaizModelo1(cores)}
${CSS_MODELO1}
${CSS_COMPLETO}</style></head><body>
${folhas}
</body></html>`;
}
