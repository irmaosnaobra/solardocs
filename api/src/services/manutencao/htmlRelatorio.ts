import {
  ATIVIDADES, CHECKLIST, GRUPO_FOTO_LABEL, PERIODICIDADE_LABEL, PRIORIDADE_LABEL, SECOES, SELOS, STATUS_ATIV_LABEL,
  STATUS_ITEM_RELATORIO, TELHADO_LABEL, TIPO_SISTEMA_LABEL,
  Atividade, Dados, Selo, calcularSelo, codigoLegivel, contagemAtividades, dataCurta, dataPorExtenso, formatarNumero,
  juntarLista, montarConclusao, normalizarDados, pendencias, somarMeses,
} from './relatorio';
import { cortarNaPalavra, dataBR, dataHoraAs, esc as escaparHtml, urlPublica } from '../relatorio/base';
import { dividirJunto, numerarGrupos, refFotos } from '../relatorio/fotos';
import { MOSTRAR_CONTATO_EMPRESA, hashMarca, logoSeguro, paleta, telefoneFormatado, type MarcaEmpresa } from '../relatorio/marca';
import { MARGEM_PDF_MM, opcoesPdfComRodape } from '../relatorio/pdf';

// ─────────────────────────────────────────────────────────────────────────────
// HTML do relatório de manutenção preventiva: UMA folha de estilo serve a tela
// (celular e computador), a impressão e o PDF (A4 em pé, gerado pelo puppeteer).
// Uma função só monta os dois: modo 'tela' (com barra, links e âncoras) e modo 'pdf' (sem barra, sem link de foto,
// com o bloco "Versão online"). Tema claro com a marca do integrador (logo, nome, CNPJ e cor), sem emoji (o
// Chromium do servidor não tem fonte de emoji), sem fonte externa e sem script.
// Este arquivo é PURO: só importa módulos puros (relatorio, relatorio/base, fotos, marca e pdf). Nada de supabase
// nem logger aqui. Todo texto vindo do usuário passa por esc(), que também tira emoji e troca travessão por hífen.
// ─────────────────────────────────────────────────────────────────────────────

export type ModoRelatorio = 'tela' | 'pdf';

/**
 * SOBE esta versão sempre que mudar o HTML, o CSS ou um texto deste relatório: o PDF guardado no bucket leva a
 * versão no nome, então sem subir aqui o PDF antigo é reaproveitado para sempre.
 * v2: marca do integrador, pendências nomeadas na capa, inspeção compacta, atividades honestas, fotos inteiras com
 *     numeração e anexo fotográfico, assinaturas com data e rodapé com "Página X de Y".
 * v3: a linha "Versão online" sobe para a primeira folha (nunca mais sozinha numa última folha), as assinaturas ficam
 *     mais baixas e presas ao bloco anterior (nunca sozinhas antes do anexo), o grupo de até 4 fotos do anexo não parte,
 *     o selo do resumo centraliza o texto e a data da assinatura alinha mesmo com nome longo.
 * v4: no papel os cartões, as seções e o bloco de assinaturas ficam um pouco mais baixos (menos chance de a folha das
 *     assinaturas ficar quase vazia antes do anexo) e o rodapé de página não corta mais o nome da empresa nem o do
 *     cliente no meio da palavra (cabem 48 e 64 letras, com quebra de linha se faltar largura).
 */
export const VERSAO_PDF = 'v4';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

/**
 * Texto digitado por gente (observação, nome, endereço): sem emoji, porque o Chromium do servidor não tem fonte
 * de emoji e o PDF sairia com quadradinhos, e com travessão virando hífen. Quebra de linha continua como veio.
 */
const limpo = (s: unknown): string => String(s ?? '').replace(/[\u{2013}\u{2014}]/gu, '-').replace(EMOJI, '');

/** Todo texto do relatório passa por aqui: limpa e escapa & < > " ' (o apóstrofo vira &#39;). */
export const esc = (s: unknown): string => escaparHtml(limpo(s));

export interface AssinaturaPublica {
  url: string | null;
  nome?: string;
  registro?: string;
  /** Instante da assinatura (ISO). Vira "Assinado em ..." sob o nome. */
  ts?: string;
}

export interface EntradaRelatorio {
  linha: {
    id: string;
    codigo: string | null;
    cliente_nome: string | null;
    data_inspecao: string;
    proxima_visita: string | null;
    dados: unknown;
  };
  /** Marca do integrador (logo, nome, CNPJ e cor). Sem marca, o cabeçalho sai só com o título e o código. */
  marca: MarcaEmpresa | null;
  /** Quando o relatório foi concluído (ISO). Vira "Emitido em ..." no cabeçalho. */
  concluidaEm?: string | null;
  /** grupo -> fotos com signed URL já gerada */
  fotos: Record<string, { path: string; url: string | null }[]>;
  assinaturas: {
    tecnico?: AssinaturaPublica;
    cliente?: Omit<AssinaturaPublica, 'registro'>;
  };
}

// ── CSS ─────────────────────────────────────────────────────────────────────

type Paleta = ReturnType<typeof paleta>;

// Escala em rem: a tela usa base de 15 px e a impressão 13,4 px. Nenhum texto fica abaixo de .8rem, que na
// impressão dá 10,7 px (8 pt). Quebra de página: `.keep` (título do grupo e até 4 fotos) não parte;
// cartões, resumo, conclusão, assinaturas e a geração também não; h2 e h3 nunca terminam a página.

const CSS_BASE = (p: Paleta) => `
*{box-sizing:border-box}
html{font-size:15px;-webkit-text-size-adjust:100%}
:root{--c1:${p.c1};--c2:${p.c2};--c3:${p.c3};--ac:${p.ac};--ink:#1B2433;--sub:#2A3547;--mut:#55606E;--ln:#D8DEE7;--wa:#F5F7FA;--hfoto:200px}
body{margin:0;background:#EDF0F4;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
[id]{scroll-margin-top:64px}
p{text-wrap:pretty}
.barra{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--ln);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px}
.barra span{font-size:.8rem;color:var(--mut);letter-spacing:.04em;text-transform:uppercase;font-weight:600}
.barra a{display:inline-flex;align-items:center;min-height:44px;justify-content:center;padding:0 18px;border-radius:10px;background:var(--c1);color:#fff;text-decoration:none;font-weight:700;font-size:.9rem}
.folha{max-width:860px;margin:18px auto 40px;background:#fff;border-radius:6px;box-shadow:0 1px 3px rgba(11,37,69,.10),0 8px 28px rgba(11,37,69,.08);padding:30px 34px 26px}
.cab{display:flex;align-items:center;justify-content:space-between;gap:18px}
.marca{display:flex;align-items:center;gap:12px;min-width:0}
.marca img{height:54px;width:auto;max-width:190px;object-fit:contain;flex-shrink:0}
.emp{display:flex;flex-direction:column;min-width:0}
.emp b{font-size:1.05rem;color:var(--c1);line-height:1.2;letter-spacing:.01em;overflow-wrap:anywhere}
.emp span{font-size:.8rem;color:var(--mut);overflow-wrap:anywhere}
.ref{text-align:right;font-size:.8rem;color:var(--mut);line-height:1.5;max-width:46%;flex-shrink:0;font-variant-numeric:tabular-nums}
.ref b{display:block;color:var(--c1);font-size:.95rem;letter-spacing:.06em}
.ref span{display:block;overflow-wrap:anywhere}
.reg{height:3px;background:var(--c1);margin:14px 0 0}
.reg2{height:2px;background:var(--ac);width:96px;margin:0 0 20px}
.eyebrow{margin:0 0 2px;font-size:.8rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--c1)}
h1{margin:0;font-size:1.65rem;line-height:1.2;color:var(--c1);letter-spacing:-.01em;overflow-wrap:anywhere;text-wrap:balance}
.cli{margin:4px 0 0;font-size:1.05rem;color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.resumo{display:grid;grid-template-columns:1.6fr 1fr;gap:0;margin:20px 0 6px;border:1px solid var(--ln);border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}
.selo{padding:16px 18px;border-left:6px solid var(--sc);background:var(--sb);break-inside:avoid;page-break-inside:avoid}
.resumo .selo{display:flex;flex-direction:column;justify-content:center}
.selo .tt{margin:0 0 3px;font-size:1.25rem;font-weight:800;line-height:1.2;color:var(--st)}
.selo .fr{margin:0;font-size:.92rem;color:var(--sub)}
.selo.sc-conforme{--sc:#2E9E5B;--sb:#F1FAF4;--st:#14532D}
.selo.sc-atencao{--sc:#D99A1B;--sb:#FFF9E8;--st:#7A4B00}
.selo.sc-nao_conforme{--sc:#C93A3A;--sb:#FFF3F3;--st:#8B1A1A}
.num{display:grid;grid-template-columns:1fr;background:var(--wa);border-left:1px solid var(--ln);break-inside:avoid;page-break-inside:avoid}
.num div{padding:9px 16px;border-bottom:1px solid var(--ln);display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 10px}
.num div:last-child{border-bottom:0}
.num span{font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
.num b{font-size:1.1rem;color:var(--c1);text-align:right;font-variant-numeric:tabular-nums}
.destaque{margin:10px 0 0;font-size:.95rem;font-weight:600;color:var(--ink);max-width:74ch;break-inside:avoid;page-break-inside:avoid}
.sec{margin-top:24px}
h2{margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--ln);font-size:.92rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--c1);break-after:avoid;page-break-after:avoid}
h2:before{content:"";display:inline-block;width:18px;height:3px;background:var(--ac);margin-right:9px;vertical-align:middle}
h3{margin:14px 0 8px;font-size:.95rem;color:var(--c1);break-after:avoid;page-break-after:avoid}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin:0}
.kv>div{break-inside:avoid;page-break-inside:avoid}
.kv dt{font-size:.8rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--mut)}
.kv dd{margin:1px 0 0;font-size:.98rem;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.kv .w{grid-column:1 / -1}
.kv ul{margin:2px 0 0;padding:0;list-style:none}
.kv ul li{font-weight:600;font-size:.95rem;padding:2px 0}
.kv ul li small{font-weight:400;color:var(--mut);font-size:.8rem}
.chip{display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid;font-size:.8rem;font-weight:700;letter-spacing:.02em;line-height:1.5;white-space:nowrap}
.s-conforme,.p-ok{background:#E7F5EC;color:#14532D;border-color:#8BCB9F}
.s-atencao,.p-media{background:#FEF3D3;color:#7A4B00;border-color:#E5B54C}
.s-nao_conforme,.p-alta{background:#FDE7E7;color:#8B1A1A;border-color:#E49C9C}
.s-na,.s-vazio,.a-nao_executado{background:#EEF1F5;color:#475266;border-color:#C5CCD8}
.a-concluido{background:#E7F5EC;color:#14532D;border-color:#8BCB9F}
.a-parcial{background:#FEF3D3;color:#7A4B00;border-color:#E5B54C}
.lista{display:flex;flex-direction:column;gap:8px}
.it{border:1px solid var(--ln);border-radius:6px;padding:9px 13px;background:#fff;break-inside:avoid;page-break-inside:avoid}
.it .hd{display:flex;align-items:center;flex-wrap:wrap;gap:4px 10px}
.it .hd b{flex:1 1 auto;min-width:0;font-size:.98rem;color:var(--ink);overflow-wrap:anywhere}
.it .hd .chip{min-width:8.4em;text-align:center}
.it .fotos{font-size:.85rem;color:var(--mut);white-space:nowrap;font-variant-numeric:tabular-nums}
.it .fotos a,.it .pf a{color:var(--c1);font-weight:600}
.it .tx{margin:7px 0 0;font-size:.9rem;color:var(--sub);white-space:pre-line;overflow-wrap:anywhere;max-width:74ch}
.it .tx i{display:block;font-style:normal;font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-bottom:1px}
.it.pen{border-left:5px solid var(--sc)}
.it.pen.alta{--sc:#C93A3A}
.it.pen.media{--sc:#D99A1B}
.it .pr{margin:2px 0 0;font-size:.85rem;color:var(--mut)}
.it .pf{margin:6px 0 0;font-size:.85rem;color:var(--mut);font-variant-numeric:tabular-nums}
.it .det{margin:4px 0 0;font-size:.85rem;color:var(--mut)}
.vazio{margin:0;padding:11px 14px;border:1px dashed var(--ln);border-radius:6px;color:var(--mut);background:var(--wa);font-size:.92rem}
.keep{break-inside:avoid;page-break-inside:avoid}
.gera{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;break-inside:avoid;page-break-inside:avoid}
.gera>div:not(.barra-g){border:1px solid var(--ln);border-radius:6px;padding:9px 13px;background:var(--wa);break-inside:avoid;page-break-inside:avoid}
.gera span{display:block;font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut)}
.gera b{font-size:1.2rem;color:var(--c1);font-variant-numeric:tabular-nums}
.gera small{font-size:.8rem;color:var(--mut);font-weight:400;margin-left:3px}
.gera .barra-g{grid-column:1 / -1;height:8px;border-radius:4px;background:#E3E8EF;overflow:hidden}
.barra-g i{display:block;height:100%;background:var(--c1)}
.leitura{margin:8px 0 0;font-size:.92rem;color:var(--ink)}
.par{margin:0;font-size:.95rem;white-space:pre-line;overflow-wrap:anywhere;color:var(--sub);max-width:74ch}
.concl{margin:0;padding:13px 16px;background:var(--c3);border-left:4px solid var(--c1);border-radius:0 6px 6px 0;font-size:.95rem;line-height:1.62;white-space:pre-line;color:var(--ink);max-width:74ch;break-inside:avoid;page-break-inside:avoid}
.prox{margin:10px 0 0;font-size:.9rem;color:var(--mut)}
.prox b{color:var(--c1)}
.assin{display:grid;grid-template-columns:1fr 1fr;gap:28px;break-inside:avoid;page-break-inside:avoid}
.ass{display:flex;flex-direction:column}
.ass .area{flex:none;height:92px;display:flex;align-items:flex-end;justify-content:center;border-bottom:1.5px solid #8A94A3}
.ass .area img{max-height:86px;max-width:100%;object-fit:contain}
.ass .nm{margin:6px 0 0;font-weight:700;font-size:.93rem;color:var(--ink);text-align:center;min-height:1.4em;flex:1 1 auto;overflow-wrap:anywhere}
.ass .nm.sem{font-weight:400;color:var(--mut)}
.ass .rg,.ass .dt{margin:0;font-size:.8rem;color:var(--mut);text-align:center;min-height:1.5em;font-variant-numeric:tabular-nums}
.ass .cap{margin:3px 0 0;font-size:.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);text-align:center}
.grade{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}
.grade.resto{margin-top:10px}
figure{margin:0;display:inline-flex;flex-direction:column;max-width:100%;break-inside:avoid;page-break-inside:avoid}
figure img{height:var(--hfoto);width:auto;max-width:100%;object-fit:contain;background:#E9EDF2;display:block;border:1px solid var(--ln);border-radius:6px}
figure figcaption{width:0;min-width:100%;font-size:.8rem;color:var(--mut);padding:3px 2px 0;font-variant-numeric:tabular-nums}
.online{margin:6px 0 0;font-size:.8rem;color:var(--mut);overflow-wrap:anywhere}
.rod{margin-top:30px;padding-top:11px;border-top:1px solid var(--ln);font-size:.8rem;color:var(--mut);text-align:center}
@media (max-width:640px){
  :root{--hfoto:170px}
  .folha{margin:0;border-radius:0;box-shadow:none;padding:20px 16px 22px}
  .cab{flex-direction:column;align-items:flex-start}
  .ref{text-align:left;max-width:none}
  .resumo{grid-template-columns:1fr}
  .num{border-left:0;border-top:1px solid var(--ln)}
  .kv{grid-template-columns:1fr}
  .gera{grid-template-columns:1fr}
  .assin{grid-template-columns:1fr}
  h1{font-size:1.4rem}
}
`;

/** Regras de impressão e de PDF: mesma folha A4, margens pelo @page, fotos de 56 mm, escala de 13,4 px e linhas com contraste de 3 para 1. */
const CSS_IMPRESSAO = `
html{font-size:13.4px}
:root{--hfoto:56mm;--ln:#8A94A3}
html,body{background:#fff}
h2{font-size:.98rem}
.barra,.rod{display:none}
.folha{max-width:none;margin:0;box-shadow:none;border-radius:0;padding:0}
.sec{margin-top:20px}
.lista{gap:6px}
.it{padding:8px 12px}
.anexo{break-before:page;page-break-before:always}
#assinaturas{margin-top:10px;break-before:avoid;page-break-before:avoid}
#assinaturas h2{margin-bottom:6px}
.ass .area{height:48px}
.ass .area img{max-height:44px}
.ass .nm{margin-top:4px}
.ass .rg,.ass .dt{min-height:1.3em;line-height:1.3}
.ass .cap{margin-top:2px}
a{color:inherit;text-decoration:none}
`;

const CSS_PAGINA = `@page{size:A4;margin:${MARGEM_PDF_MM.topo}mm ${MARGEM_PDF_MM.lados}mm ${MARGEM_PDF_MM.base}mm}`;

// ── Pedaços do HTML ─────────────────────────────────────────────────────────

const aparar = (s: unknown): string => String(s ?? '').trim();

const chipItem = (status: string | null): string => {
  if (!status || !(status in STATUS_ITEM_RELATORIO)) return `<span class="chip s-vazio">Não avaliado</span>`;
  return `<span class="chip s-${status}">${esc(STATUS_ITEM_RELATORIO[status as keyof typeof STATUS_ITEM_RELATORIO])}</span>`;
};

const chipAtividade = (v: Atividade): string =>
  `<span class="chip a-${esc(v.status)}">${esc(STATUS_ATIV_LABEL[v.status] ?? v.status)}</span>`;

const texto = (rotulo: string, v: string): string =>
  v.trim() ? `<div class="tx"><i>${esc(rotulo)}</i>${esc(v.trim())}</div>` : '';

const kv = (rotulo: string, valor: string, largo = false): string =>
  valor ? `<div${largo ? ' class="w"' : ''}><dt>${esc(rotulo)}</dt><dd>${valor}</dd></div>` : '';

/** "Fotos 3 a 5": na tela vira link para a primeira foto citada; no PDF fica só o texto. */
function refHtml(nums: number[], pdf: boolean): string {
  const t = refFotos(nums);
  if (!t) return '';
  return pdf ? esc(t) : `<a href="#foto-${Math.min(...nums)}">${esc(t)}</a>`;
}

/** Referência das fotos da limpeza: "Antes: Fotos 1 a 3. Depois: Fotos 4 a 6.". Sem foto, ''. */
function refLimpeza(numeros: Map<string, number[]>, pdf: boolean): string {
  const antes = refHtml(numeros.get('antes') ?? [], pdf);
  const depois = refHtml(numeros.get('depois') ?? [], pdf);
  return [antes ? `Antes: ${antes}.` : '', depois ? `Depois: ${depois}.` : ''].filter(Boolean).join(' ');
}

const incompleta = (v: Atividade): boolean => v.status === 'parcial' || v.status === 'nao_executado';

function secaoIdentificacao(d: Dados, cliente: string): string {
  const s = d.sistema;
  const partes: string[] = [];
  partes.push(kv('Cliente', esc(cliente)));
  if (s.tipo) partes.push(kv('Tipo de sistema', esc(TIPO_SISTEMA_LABEL[s.tipo])));
  if (s.potencia_kwp != null && s.potencia_kwp > 0) partes.push(kv('Potência', `${esc(formatarNumero(s.potencia_kwp))} kWp`));
  if (s.qtd_modulos != null && s.qtd_modulos > 0) partes.push(kv('Módulos', esc(String(s.qtd_modulos))));
  partes.push(kv('Modelo do módulo', esc(s.modulo_modelo.trim())));
  if (s.telhado.length) partes.push(kv('Telhado', esc(s.telhado.map((t) => TELHADO_LABEL[t] ?? t).join(', '))));
  partes.push(kv('Endereço', esc(s.endereco.trim()), true));
  const inv = s.inversores.filter((i) => i.marca.trim() || i.modelo.trim() || i.serie.trim());
  if (inv.length) {
    const li = inv.map((i) => {
      const nome = [i.marca.trim(), i.modelo.trim()].filter(Boolean).join(' ') || 'Inversor';
      return `<li>${esc(nome)}${i.serie.trim() ? ` <small>série ${esc(i.serie.trim())}</small>` : ''}</li>`;
    }).join('');
    partes.push(`<div class="w"><dt>Inversores</dt><dd><ul>${li}</ul></dd></div>`);
  }
  const corpo = partes.join('');
  return corpo ? `<section class="sec" id="identificacao"><h2>${esc(SECOES.identificacao)}</h2><dl class="kv">${corpo}</dl></section>` : '';
}

/** Cada item é uma linha: nome, fotos e estado. O texto só aparece aqui quando o item NÃO tem pendência. */
function secaoInspecao(d: Dados, numeros: Map<string, number[]>, pdf: boolean): string {
  const comPendencia = new Set(pendencias(d.itens).map((p) => p.key));
  const linhas = CHECKLIST.map((c) => {
    const i = d.itens.find((x) => x.key === c.key)!;
    const ref = refHtml(numeros.get(c.key) ?? [], pdf);
    const corpo = comPendencia.has(c.key)
      ? `<p class="det">${esc(SECOES.detalhe_nas_pendencias)}</p>`
      : `${texto('O que foi visto', i.visto)}${texto('Providência', i.providencia)}`;
    return `<div class="it"><div class="hd"><b>${esc(c.label)}</b>${ref ? `<span class="fotos">${ref}</span>` : ''}${chipItem(i.status)}</div>${corpo}</div>`;
  }).join('');
  return `<section class="sec" id="inspecao"><h2>${esc(SECOES.inspecao)}</h2><div class="lista">${linhas}</div></section>`;
}

function linhaAtividade(a: { key: string; label: string }, v: Atividade, rotuloTexto: string, numeros: Map<string, number[]>, pdf: boolean): string {
  const ref = a.key === 'limpeza' ? refLimpeza(numeros, pdf) : '';
  return `<div class="it"><div class="hd"><b>${esc(a.label)}</b>${chipAtividade(v)}</div>${ref ? `<p class="pf">${ref}</p>` : ''}${texto(rotuloTexto, v.obs)}</div>`;
}

/** Atividades marcadas como feitas, com o estado de cada uma. */
function atividadesFeitas(d: Dados): { a: { key: string; label: string }; v: Atividade }[] {
  return ATIVIDADES.map((a) => ({ a, v: d.atividades.find((x) => x.key === a.key)! })).filter((x) => x.v.feita);
}

/** "Atividades realizadas" lista só as concluídas; as parciais e as não executadas vão para "O que ficou por fazer". */
function secaoAtividades(d: Dados, numeros: Map<string, number[]>, pdf: boolean): string {
  const feitas = atividadesFeitas(d).filter((x) => !incompleta(x.v));
  if (!feitas.length) return '';
  const itens = feitas.map(({ a, v }) => linhaAtividade(a, v, 'Observação', numeros, pdf)).join('');
  return `<section class="sec" id="atividades"><h2>${esc(SECOES.atividades)}</h2><div class="lista">${itens}</div></section>`;
}

function secaoPendencias(d: Dados, numeros: Map<string, number[]>, atividades: { a: { key: string; label: string }; v: Atividade }[], pdf: boolean): string {
  const lista = pendencias(d.itens);
  const cartoes = lista.length
    ? `<div class="lista">${lista.map((p) => {
      const pr = PRIORIDADE_LABEL[p.prioridade];
      const ref = refHtml(numeros.get(p.key) ?? [], pdf);
      return `<div class="it pen ${p.prioridade}"><div class="hd"><b>${esc(p.label)}</b><span class="chip p-${p.prioridade}">${esc(pr.titulo)}</span></div><p class="pr">${esc(pr.frase)}</p>${texto('O que foi visto', p.visto)}${texto('Providência', p.providencia)}${ref ? `<p class="pf">${ref}</p>` : ''}</div>`;
    }).join('')}</div>`
    : `<p class="vazio">${esc(SECOES.pendencias_vazio)}</p>`;
  const porFazer = atividades.filter((x) => incompleta(x.v));
  const blocoPorFazer = porFazer.length
    ? `<h3>${esc(SECOES.ficou_por_fazer)}</h3><div class="lista">${porFazer.map(({ a, v }) => linhaAtividade(a, v, 'Motivo', numeros, pdf)).join('')}</div>`
    : '';
  return `<section class="sec" id="pendencias"><h2>${esc(SECOES.pendencias)}</h2>${cartoes}${blocoPorFazer}</section>`;
}

/** Pendências por nome, logo abaixo do resumo: "Prioridade alta: A. Prioridade média: B e C.". Sem pendência, nada. */
function linhaDestaque(d: Dados): string {
  const lista = pendencias(d.itens);
  const nomes = (prioridade: 'alta' | 'media') => lista.filter((p) => p.prioridade === prioridade).map((p) => p.label);
  const partes = (['alta', 'media'] as const)
    .map((prioridade) => {
      const n = nomes(prioridade);
      return n.length ? `${PRIORIDADE_LABEL[prioridade].titulo}: ${juntarLista(n)}.` : '';
    })
    .filter(Boolean);
  return partes.length ? `<p class="destaque">${esc(partes.join(' '))}</p>` : '';
}

/** Os dois números, a barra e uma frase factual que compara a medida com a esperada (sem corte de alerta e sem cor de alerta). */
function secaoGeracao(d: Dados): string {
  const { esperada_kwh: e, medida_kwh: m } = d.geracao;
  if (e == null || m == null) return '';
  const pct = e > 0 ? Math.round((m / e) * 100) : null;
  const largura = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  let leitura = '';
  if (e > 0) {
    const dif = Math.round((Math.abs(m - e) / e) * 100);
    leitura = dif === 0
      ? 'A geração medida ficou igual à esperada.'
      : `A geração medida ficou ${dif}% ${m < e ? 'abaixo' : 'acima'} da esperada.`;
  }
  return `<section class="sec" id="geracao"><h2>${esc(SECOES.geracao)}</h2><div class="keep"><div class="gera">
    <div><span>Esperada</span><b>${esc(formatarNumero(e))}</b><small>kWh/mês</small></div>
    <div><span>Medida</span><b>${esc(formatarNumero(m))}</b><small>kWh/mês</small></div>
    ${pct != null ? `<div><span>Medida / esperada</span><b>${pct}%</b></div><div class="barra-g"><i style="width:${largura}%"></i></div>` : ''}
  </div>${leitura ? `<p class="leitura">${esc(leitura)}</p>` : ''}</div></section>`;
}

function secaoTexto(titulo: string, v: string): string {
  return v.trim() ? `<section class="sec"><h2>${esc(titulo)}</h2><p class="par">${esc(v.trim())}</p></section>` : '';
}

function secaoAssinaturas(e: EntradaRelatorio, d: Dados): string {
  const bloco = (rotulo: string, a: AssinaturaPublica | undefined, nomePadrao: string, registroPadrao: string) => {
    const nome = aparar(a?.nome) || nomePadrao;
    const sem = !a?.url && !nome;
    const registro = aparar(a?.registro) || registroPadrao;
    const dia = dataHoraAs(a?.ts);
    return `
    <div class="ass"><div class="area">${a?.url ? `<img src="${esc(a.url)}" alt="${esc(rotulo)}"/>` : ''}</div>
    ${sem ? `<p class="nm sem">${esc(SECOES.sem_assinatura)}</p>` : `<p class="nm">${esc(nome)}</p>`}<p class="rg">${!sem && registro ? `Registro: ${esc(registro)}` : ''}</p><p class="dt">${!sem && dia ? `Assinado em ${esc(dia)}` : ''}</p><p class="cap">${esc(rotulo)}</p></div>`;
  };
  return `<section class="sec" id="assinaturas"><h2>${esc(SECOES.assinaturas)}</h2><div class="assin">
    ${bloco(SECOES.assinatura_tecnico, e.assinaturas?.tecnico, aparar(d.responsavel.nome), aparar(d.responsavel.registro))}
    ${bloco(SECOES.assinatura_cliente, e.assinaturas?.cliente, aparar(e.linha.cliente_nome), '')}
  </div></section>`;
}

const ORDEM_FOTOS: string[] = ['antes', 'depois', ...CHECKLIST.map((c) => c.key)];

/**
 * Quantas fotos do grupo ficam presas ao título. Com 56 mm de altura, até 4 fotos ocupam no máximo duas fileiras e cabem
 * numa folha; assim o grupo comum nunca deixa o título numa folha e a última foto na seguinte (sem o título do grupo).
 */
const FOTOS_COM_O_TITULO = 4;

/** Fotos que o relatório desenha: só as que têm URL assinada. A numeração e as referências usam esta mesma lista. */
const fotosDoGrupo = (e: EntradaRelatorio, grupo: string) => (e.fotos?.[grupo] ?? []).filter((f) => f && f.url);

/** Anexo fotográfico: depois das assinaturas, em página nova no PDF. Título do grupo e as 4 primeiras fotos ficam juntos. */
function secaoAnexo(e: EntradaRelatorio, numeros: Map<string, number[]>, pdf: boolean): string {
  const grupos = ORDEM_FOTOS.map((g) => {
    const lista = fotosDoGrupo(e, g);
    if (!lista.length) return '';
    const label = GRUPO_FOTO_LABEL[g] ?? g;
    const nums = numeros.get(g) ?? [];
    const figuras = lista.map((f, idx) => {
      const n = nums[idx] ?? 0;
      const src = esc(f.url);
      const img = `<img src="${src}" alt="Foto ${n}: ${esc(label)}"/>`;
      return `<figure id="foto-${n}">${pdf ? img : `<a href="${src}" target="_blank" rel="noopener">${img}</a>`}<figcaption>Foto ${n}, ${esc(label)}</figcaption></figure>`;
    });
    const { junto, resto } = dividirJunto(figuras, FOTOS_COM_O_TITULO);
    return `<div class="grp"><div class="keep"><h3>${esc(label)}</h3><div class="grade">${junto.join('')}</div></div>${resto.length ? `<div class="grade resto">${resto.join('')}</div>` : ''}</div>`;
  }).join('');
  return grupos ? `<section class="sec anexo" id="anexo"><h2>${esc(SECOES.anexo)}</h2>${grupos}</section>` : '';
}

// ── O documento ─────────────────────────────────────────────────────────────

export function htmlRelatorio(e: EntradaRelatorio, modo: ModoRelatorio = 'tela'): string {
  const pdf = modo === 'pdf';
  const d = normalizarDados((e.linha.dados ?? {}) as Partial<Dados>);
  const selo: Selo = calcularSelo(d.itens);
  const proxima = e.linha.proxima_visita || somarMeses(e.linha.data_inspecao, d.periodicidade_meses);
  const marca = e.marca ?? null;
  const nomeMarca = aparar(marca?.nome);
  const logo = marca ? logoSeguro(marca.logo) : null;
  const cnpj = aparar(marca?.cnpj);
  const temMarca = !!(nomeMarca || logo || cnpj);
  // Sem marca nenhuma, o canto esquerdo traz o título do documento; com marca sem nome, só o logo e o CNPJ.
  const rotuloEmp = nomeMarca || (temMarca ? '' : SECOES.titulo);
  const pal: Paleta = paleta(marca?.cor);
  const cliente = aparar(e.linha.cliente_nome);
  const cod = codigoLegivel(e.linha.codigo);
  const nPend = pendencias(d.itens).length;
  const ativ = contagemAtividades(d);
  const marcadas = ativ.concluidas + ativ.parciais + ativ.naoExecutadas;
  const porFazer = ativ.parciais + ativ.naoExecutadas;
  const conclusao = aparar(d.conclusao_manual) || montarConclusao(d, selo, proxima);
  const resp = [aparar(d.responsavel.nome), aparar(d.responsavel.registro)].filter(Boolean).join(', ');
  const emitido = dataBR(e.concluidaEm);
  const url = urlPublica('m', e.linha.id);
  const titulo = `${SECOES.titulo}${cod ? ' ' + cod : ''}${cliente ? ' · ' + cliente : ''}`;
  const descricao = `Relatório de manutenção preventiva${cliente ? ' de ' + cliente : ''}${nomeMarca ? ', por ' + nomeMarca : ''}.`;

  const contato = MOSTRAR_CONTATO_EMPRESA ? marca?.contato : undefined;
  const linhasContato = contato
    ? [telefoneFormatado(contato.whatsapp) ? `WhatsApp ${telefoneFormatado(contato.whatsapp)}` : '', [aparar(contato.endereco), aparar(contato.cidade)].filter(Boolean).join(', ')].filter(Boolean)
    : [];

  // Numeração global e contínua das fotos que aparecem (antes, depois e os 9 itens), na ordem do anexo.
  const numeros = numerarGrupos(ORDEM_FOTOS, Object.fromEntries(ORDEM_FOTOS.map((g) => [g, fotosDoGrupo(e, g).length])));
  const atividades = atividadesFeitas(d);

  const cabecalho = `<header class="cab">
    <div class="marca">${logo ? `<img src="${esc(logo)}" alt="${esc(nomeMarca)}"/>` : ''}<div class="emp">${rotuloEmp ? `<b>${esc(rotuloEmp)}</b>` : ''}${cnpj ? `<span>CNPJ ${esc(cnpj)}</span>` : ''}${linhasContato.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>
    <div class="ref">${cod ? `<b>${esc(cod)}</b>` : ''}<span>Inspeção em ${esc(dataCurta(e.linha.data_inspecao))}</span>${emitido ? `<span>Emitido em ${esc(emitido)}</span>` : ''}${resp ? `<span>Responsável: ${esc(resp)}</span>` : ''}</div>
  </header>
  <div class="reg"></div><div class="reg2"></div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(titulo)}</title>
<meta property="og:title" content="${esc(titulo)}"/>
<meta property="og:description" content="${esc(descricao)}"/>
<meta property="og:type" content="article"/>
<style>${CSS_BASE(pal)}${pdf ? CSS_IMPRESSAO : `@media print{${CSS_IMPRESSAO}}`}${CSS_PAGINA}</style>
</head><body>
${pdf ? '' : `<div class="barra"><span>${esc(SECOES.titulo)}</span><a href="/m/${esc(e.linha.id)}/pdf">Baixar PDF</a></div>`}
<main class="folha">
  ${cabecalho}
  ${temMarca ? `<p class="eyebrow">${esc(SECOES.titulo)}</p>` : ''}
  <h1>Relatório de manutenção preventiva</h1>
  ${cliente ? `<p class="cli">${esc(cliente)}</p>` : ''}
  ${pdf ? `<p class="online">${esc(SECOES.versao_online)} <a href="${esc(url)}">${esc(url)}</a></p>` : ''}

  <div class="resumo">
    <div class="selo sc-${selo}"><p class="tt">${esc(SELOS[selo].titulo)}</p><p class="fr">${esc(SELOS[selo].frase)}</p></div>
    <div class="num">
      <div><span>${esc(SECOES.atividades_concluidas)}</span><b>${ativ.concluidas} de ${marcadas}</b></div>
      <div><span>Pendências</span><b>${nPend}</b></div>
      ${porFazer > 0 ? `<div><span>${esc(SECOES.ficou_por_fazer_num)}</span><b>${porFazer}</b></div>` : ''}
      <div><span>${esc(SECOES.proxima_visita)}</span><b>${esc(dataCurta(proxima))}</b></div>
    </div>
  </div>
  ${linhaDestaque(d)}

  ${secaoPendencias(d, numeros, atividades, pdf)}
  ${secaoTexto(SECOES.recomendacoes, d.recomendacoes)}
  <section class="sec" id="conclusao"><h2>${esc(SECOES.conclusao)}</h2><p class="concl">${esc(conclusao)}</p>
    <p class="prox"><b>${esc(SECOES.proxima_visita)}:</b> ${esc(dataPorExtenso(proxima))} &nbsp;|&nbsp; <b>${esc(SECOES.periodicidade)}:</b> ${esc(PERIODICIDADE_LABEL[d.periodicidade_meses])}</p>
  </section>
  ${secaoIdentificacao(d, cliente)}
  ${secaoInspecao(d, numeros, pdf)}
  ${secaoAtividades(d, numeros, pdf)}
  ${secaoGeracao(d)}
  ${secaoTexto(SECOES.observacoes_proxima, d.observacoes_proxima)}
  ${secaoAssinaturas(e, d)}
  ${secaoAnexo(e, numeros, pdf)}
  ${pdf ? '' : `<footer class="rod">${esc(SECOES.rodape)}</footer>`}
</main>
</body></html>`;
}

/**
 * Opções do page.pdf(): A4 em pé, margem pelo @page e rodapé de página com empresa, código do relatório, cliente e
 * "Página X de Y". Os textos entram crus: quem escapa é o rodapé (opcoesPdfComRodape).
 */
export function opcoesPdf(codigo: string | null, p: { marcaNome?: string | null; cliente?: string | null } = {}) {
  // Cada nome é cortado na última palavra inteira, só se passar de 48 letras (empresa) ou 64 (cliente).
  const esquerda = [cortarNaPalavra(limpo(p.marcaNome), 48), aparar(codigoLegivel(codigo)), cortarNaPalavra(limpo(p.cliente), 64)].filter(Boolean).join(' · ');
  return opcoesPdfComRodape({ esquerda });
}

/**
 * Nome do PDF guardado no bucket: versão do desenho, instante da última alteração e hash da marca. Trocar o logo, o nome
 * ou o CNPJ da empresa, mexer no relatório (updated_at) ou subir a VERSAO_PDF gera um arquivo novo, mesmo com o relatório
 * concluído e congelado. A limpeza dos antigos continua por `startsWith('relatorio-')`.
 */
export function nomeDoPdf(atualizadoEmMs: number, marca: MarcaEmpresa | null): string {
  return `relatorio-${VERSAO_PDF}-${atualizadoEmMs}-${hashMarca(marca).slice(0, 8) || '00000000'}.pdf`;
}

// ── Páginas simples (sem relatório para mostrar) ────────────────────────────
function paginaSimples(titulo: string, mensagem: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow"/>
<title>${esc(titulo)}</title>
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;background:#F5F7FA;color:#1B2433;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
.c{max-width:420px;background:#fff;border:1px solid #D8DEE7;border-top:4px solid #0B2545;border-radius:8px;padding:28px 24px}h1{margin:0 0 8px;font-size:1.25rem;color:#0B2545}p{margin:0;color:#55606E;font-size:.95rem;line-height:1.5}</style>
</head><body><div class="c"><h1>${esc(titulo)}</h1><p>${esc(mensagem)}</p></div></body></html>`;
}

export const paginaNaoConcluido = () => paginaSimples(SECOES.titulo, SECOES.nao_concluido);
export const paginaNaoEncontrado = () => paginaSimples('Relatório não encontrado', 'O link está incorreto ou o relatório foi removido. Peça à empresa para enviar de novo.');
export const paginaIndisponivel = () => paginaSimples(SECOES.titulo, 'O relatório está sendo liberado. Volte em alguns minutos.');
