import {
  EXPLICA, ITENS_COM_STATUS, MapaStatus, PRIORIDADE_LABEL, ROTULO_CHEIO, SECOES, SELOS, SELO_PARCIAL, STATUS_RELATORIO,
  StatusVistoria, cobertura, frasePlacar, juntarLista, proximosPassos, resumo, sanitizarStatus,
} from './avaliacao';
import { codigoVistoria, cortar, dataBR, dataHoraAs, esc as escaparHtml, horaBR, urlPublica } from '../relatorio/base';
import { dividirJunto, numerarGrupos, refFotos } from '../relatorio/fotos';
import { MOSTRAR_CONTATO_EMPRESA, logoSeguro, paleta, telefoneFormatado, type MarcaEmpresa } from '../relatorio/marca';
import { opcoesPdfComRodape } from '../relatorio/pdf';
import type { DadosCliente } from './clienteRelatorio';

// ─────────────────────────────────────────────────────────────────────────────
// HTML do relatório público da vistoria solar (/v/:id) e do PDF (/v/:id/pdf).
// Uma função só monta os dois: modo 'tela' (celular e computador, com barra, links e navegação) e modo 'pdf'
// (A4, sem barra, sem lazy-load, sem link de foto). Tema claro único, com a marca do integrador. Sem emoji
// (o Chromium do servidor não tem fonte de emoji), sem fonte externa e sem script.
// Este arquivo é PURO: só importa módulos puros (avaliacao, relatorio/base, fotos, marca, pdf) e o TIPO
// DadosCliente. Nada de supabase nem logger aqui. Todo texto vindo do usuário passa por esc(), que também tira
// emoji e troca travessão por hífen no que gente digitou.
// ─────────────────────────────────────────────────────────────────────────────

export type ModoRelatorio = 'tela' | 'pdf';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

/**
 * Texto digitado por gente (observação, nome, endereço): sem emoji, porque o Chromium do servidor não tem fonte
 * de emoji e o PDF sairia com quadradinhos, e com travessão virando hífen. Quebra de linha continua como veio.
 */
const limpo = (s: unknown): string => String(s ?? '').replace(/[\u{2013}\u{2014}]/gu, '-').replace(EMOJI, '');

/** Todo texto do relatório passa por aqui: limpa e escapa & < > " ' (o apóstrofo vira &#39;). Exportado por compatibilidade. */
export const esc = (s: unknown): string => escaparHtml(limpo(s));

export interface FotoAssinada {
  url: string;
  tipo: 'image' | 'file';
  nome?: string;
  /** Instante do envio (ISO). Vira a data e a hora na legenda da foto. */
  ts?: string;
  signed: string | null;
}

export interface ItemAssinado {
  key: string;
  label: string;
  obs?: string;
  fotos: FotoAssinada[];
}

export interface LocalizacaoPublica {
  lat: number | null;
  lng: number | null;
  link: string | null;
  texto: string | null;
}

export interface AssinaturaPublica {
  url: string | null;
  nome?: string;
  registro?: string;
  /** Instante da assinatura (ISO). Vira "Assinado em ..." sob o nome. */
  ts?: string;
}

export interface EntradaVistoria {
  id: string;
  cliente_nome: string | null;
  status: string;
  created_at: string;
  localizacao?: LocalizacaoPublica | null;
  itens: ItemAssinado[];
  status_itens?: unknown;
  assinaturas?: {
    tecnico?: AssinaturaPublica;
    cliente?: Omit<AssinaturaPublica, 'registro'>;
  };
  /** Marca do integrador (logo, nome, CNPJ e cor). Sem marca, o cabeçalho sai só com o título e o código. */
  marca?: MarcaEmpresa | null;
  /** Endereço e concessionária do cadastro do cliente. */
  cliente?: DadosCliente | null;
}

// ── CSS ─────────────────────────────────────────────────────────────────────

type Paleta = { c1: string; c2: string; c3: string; ac: string };

// Quebra de página: `.keep` (título, explicação, observação e a primeira fileira de fotos) não parte. O
// `break-after: avoid` de título, explicação e observação vale SÓ quando há irmão depois dele: no último filho
// o navegador propaga o "evitar" para fora do `.keep` e do item, e o título da seção seguinte ("Documentos do
// titular") ficava sozinho no pé da página, com o item partido na folha seguinte (medido no render de 29/10).

const CSS_BASE = (p: Paleta) => `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
:root{--c1:${p.c1};--c2:${p.c2};--c3:${p.c3};--ac:${p.ac};--bg:#EDF0F4;--fg:#1B2433;--mut:#55606E;--sub:#2A3547;--ln:#D8DEE7;--bd:#C5CCD8;--card:#F5F7FA;
--ok-bg:#E7F5EC;--ok-fg:#14532D;--ok-bd:#8BCB9F;--at-bg:#FEF3D3;--at-fg:#7A4B00;--at-bd:#E5B54C;--nc-bg:#FDE7E7;--nc-fg:#8B1A1A;--nc-bd:#E49C9C;--na-bg:#EEF1F5;--na-fg:#475266;--na-bd:#C5CCD8;
--sc-conforme:#2E9E5B;--sb-conforme:#F1FAF4;--st-conforme:#14532D;--sc-atencao:#D99A1B;--sb-atencao:#FFF9E8;--st-atencao:#7A4B00;--sc-nao_conforme:#C93A3A;--sb-nao_conforme:#FFF3F3;--st-nao_conforme:#8B1A1A;--hfoto:220px}
body{margin:0;background:var(--bg);color:var(--fg);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
[id]{scroll-margin-top:64px}
p{text-wrap:pretty}
.barra{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--ln);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px}
.barra span{font-size:12px;color:var(--mut);letter-spacing:.04em;text-transform:uppercase;font-weight:600}
.barra a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:10px;background:var(--c1);color:#fff;text-decoration:none;font-weight:700;font-size:14px}
.folha{max-width:860px;margin:18px auto 40px;background:#fff;border-radius:6px;box-shadow:0 1px 3px rgba(11,37,69,.10),0 8px 28px rgba(11,37,69,.08);padding:30px 34px 26px}
.cab{display:flex;align-items:center;justify-content:space-between;gap:18px}
.marca{display:flex;align-items:center;gap:12px;min-width:0}
.marca img{height:54px;width:auto;max-width:190px;object-fit:contain;flex-shrink:0}
.emp{display:flex;flex-direction:column;min-width:0}
.emp b{font-size:16px;color:var(--c1);line-height:1.2;overflow-wrap:anywhere}
.emp span{font-size:12px;color:var(--mut);overflow-wrap:anywhere}
.ref{text-align:right;font-size:12px;color:var(--mut);line-height:1.5;max-width:46%;font-variant-numeric:tabular-nums}
.ref b{display:block;color:var(--c1);font-size:15px;letter-spacing:.06em}
.ref span{display:block;overflow-wrap:anywhere}
.reg{height:3px;background:var(--c1);margin:14px 0 0}
.reg2{height:2px;background:var(--ac);width:96px;margin:0 0 20px}
.eyebrow{margin:0 0 2px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--c1)}
h1{margin:0;font-size:22px;line-height:1.2;color:var(--c1);letter-spacing:-.01em;overflow-wrap:anywhere;text-wrap:balance}
.meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px;font-size:13px;color:var(--sub);font-variant-numeric:tabular-nums}
.acoes{display:flex;flex-wrap:wrap;align-items:center;gap:0 20px;margin-top:8px}
.lnk{display:inline-flex;align-items:center;min-height:44px;font-size:14px;font-weight:600;color:var(--c1);text-decoration:underline;text-underline-offset:3px}
.nav{display:flex;flex-wrap:wrap;align-items:center;gap:0 14px;font-size:13px;color:var(--mut)}
.nav a{display:inline-flex;align-items:center;min-height:44px;color:var(--c1);font-weight:600;text-decoration:none}
.nav a:hover{text-decoration:underline}
h2.sec{margin:26px 0 10px;padding-bottom:6px;border-bottom:1.5px solid var(--c1);font-size:14px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c1);break-after:avoid;page-break-after:avoid}
h3{break-after:avoid;page-break-after:avoid}
.apoio{margin:0 0 8px;font-size:13px;color:var(--mut);max-width:74ch;break-after:avoid;page-break-after:avoid}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin:0}
.kv>div{break-inside:avoid;page-break-inside:avoid}
.kv dt{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--mut)}
.kv dd{margin:1px 0 0;font-size:14px;font-weight:600;color:var(--fg);overflow-wrap:anywhere}
.kv dd a{color:var(--c1)}
.kv .w{grid-column:1 / -1}
.kv .url{display:block;font-weight:400;font-size:12px;color:var(--mut)}
.andamento{margin:18px 0 0;padding:11px 14px;border:1px solid #BCD0E8;border-left:5px solid #2E6DB4;border-radius:6px;background:#EEF4FB;color:#1F3A5F;font-size:14px;break-inside:avoid;page-break-inside:avoid}
.chip{display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid;font-size:12px;font-weight:600;line-height:1.5;white-space:nowrap}
.s-conforme,.p-ok{background:var(--ok-bg);color:var(--ok-fg);border-color:var(--ok-bd)}
.s-atencao,.p-media{background:var(--at-bg);color:var(--at-fg);border-color:var(--at-bd)}
.s-nao_conforme,.p-alta{background:var(--nc-bg);color:var(--nc-fg);border-color:var(--nc-bd)}
.s-na{background:var(--na-bg);color:var(--na-fg);border-color:var(--na-bd)}
.selo{padding:16px 18px;border-radius:10px;border-left:6px solid var(--sc);background:var(--sb);break-inside:avoid;page-break-inside:avoid}
.selo .tt{margin:0 0 3px;font-size:20px;font-weight:800;line-height:1.25;color:var(--st)}
.selo .fr{margin:0;font-size:14px;color:var(--sub)}
.selo.sc-conforme{--sc:var(--sc-conforme);--sb:var(--sb-conforme);--st:var(--st-conforme)}
.selo.sc-atencao{--sc:var(--sc-atencao);--sb:var(--sb-atencao);--st:var(--st-atencao)}
.selo.sc-nao_conforme{--sc:var(--sc-nao_conforme);--sb:var(--sb-nao_conforme);--st:var(--st-nao_conforme)}
.selo.sc-parcial{--sc:#8A94A3;--sb:#F3F5F8;--st:#2A3547}
.placar{margin:10px 0 0;font-size:14px;color:var(--sub);font-variant-numeric:tabular-nums}
.faltam{margin:4px 0 0;font-size:13px;color:var(--mut)}
.pen{margin-top:10px;padding:10px 14px;border:1px solid var(--bd);border-left:5px solid var(--pc);border-radius:8px;background:var(--card);break-inside:avoid;page-break-inside:avoid}
.pen.alta{--pc:var(--sc-nao_conforme)}
.pen.media{--pc:var(--sc-atencao)}
.pen .hd{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.pen .hd b{font-size:15px}
.pen p{margin:4px 0 0;font-size:13px;color:var(--mut)}
.pen .pobs{color:var(--sub);white-space:pre-line;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pen .pref{font-size:12px;font-variant-numeric:tabular-nums}
.pen .pref a{color:var(--c1);font-weight:600}
.vazio{margin:0;padding:11px 14px;border:1px dashed var(--bd);border-radius:8px;color:var(--mut);background:var(--card);font-size:14px}
.concl{margin:0;padding:13px 16px;background:var(--c3);border-left:4px solid var(--c1);border-radius:0 8px 8px 0;font-size:15px;line-height:1.62;max-width:74ch;text-wrap:pretty;break-inside:avoid;page-break-inside:avoid}
.passos{margin:0;padding-left:22px;font-size:14px;max-width:74ch}
.passos li{margin:4px 0;padding-left:2px}
.item{margin-top:20px;padding-top:16px;border-top:1px solid var(--ln)}
h2.sec+.item,.apoio+.item{margin-top:0;padding-top:0;border-top:0}
.keep{break-inside:avoid;page-break-inside:avoid}
.itemHead{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}
.itemHead strong{flex:1 1 auto;min-width:0;font-size:15px;overflow-wrap:anywhere}
.itemHead .chip{min-width:8.4em;text-align:center}
.cnt{min-width:7em;text-align:right;font-size:12px;color:var(--mut);font-variant-numeric:tabular-nums}
.expl{margin:3px 0 0;font-size:12.5px;color:var(--mut);max-width:74ch;text-wrap:pretty}
.obs{margin:6px 0 0;font-size:13.5px;color:var(--sub);white-space:pre-line;overflow-wrap:anywhere;max-width:74ch;text-wrap:pretty}
.docaviso{margin:6px 0 0;font-size:13px;color:var(--mut);max-width:74ch}
.item .itemHead:not(:last-child),.item .expl:not(:last-child),.item .obs:not(:last-child){break-after:avoid;page-break-after:avoid}
.mid{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
.ph{margin:0;display:inline-flex;flex-direction:column;max-width:100%;break-inside:avoid;page-break-inside:avoid}
.ph img{display:block;height:var(--hfoto);width:auto;max-width:100%;object-fit:contain;background:#EEF1F5;border:1px solid var(--bd);border-radius:6px}
.ph figcaption{width:0;min-width:100%;font-size:11.5px;color:var(--mut);padding:3px 2px 0;font-variant-numeric:tabular-nums}
.file{flex:1 1 100%;display:block;padding:8px 12px;text-align:left;font-size:13px;font-weight:600;color:var(--fg);text-decoration:none;border:1px solid var(--bd);border-radius:6px;background:var(--card);overflow-wrap:anywhere;break-inside:avoid;page-break-inside:avoid}
.docs{--hfoto:150px}
.faltando{margin-top:22px;padding:10px 14px;background:var(--na-bg);border:1px solid var(--na-bd);border-radius:8px;font-size:13px;color:var(--na-fg);break-inside:avoid;page-break-inside:avoid}
.empty{margin-top:24px;padding:24px;text-align:center;color:var(--mut);background:var(--card);border-radius:10px}
.assin{display:grid;grid-template-columns:1fr 1fr;gap:24px;break-inside:avoid;page-break-inside:avoid}
.ass .area{height:96px;display:flex;align-items:flex-end;justify-content:center;border-bottom:1.5px solid #8A94A3;background:#fff}
.ass .area img{max-height:90px;max-width:100%;object-fit:contain}
.ass .nm{margin:6px 0 0;font-weight:700;font-size:14px;text-align:center;min-height:1.4em;overflow-wrap:anywhere}
.ass .rg,.ass .dt{margin:0;font-size:12px;color:var(--mut);text-align:center;min-height:1.2em;font-variant-numeric:tabular-nums}
.ass .cap{margin:3px 0 0;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);text-align:center}
.online{margin:22px 0 0;padding-top:10px;border-top:1px solid var(--ln);font-size:12px;color:var(--mut);overflow-wrap:anywhere}
.rod{margin-top:28px;padding-top:11px;border-top:1px solid var(--ln);font-size:12px;color:var(--mut);text-align:center}
@media (max-width:640px){
  :root{--hfoto:190px}
  .folha{margin:0;border-radius:0;box-shadow:none;padding:20px 16px 22px}
  .cab{flex-direction:column;align-items:flex-start}
  .ref{text-align:left;max-width:none}
  .kv{grid-template-columns:1fr}
  .assin{grid-template-columns:1fr}
  h1{font-size:20px}
}
`;

/** Regras de impressão e de PDF: mesma folha A4, margens pelo @page, fotos de 60 mm, linhas com contraste de 3 para 1. */
const CSS_IMPRESSAO = `
:root{--hfoto:60mm;--bd:#8A94A3;--ln:#8A94A3}
html,body{background:#fff}
.barra,.acoes,.rod{display:none}
.folha{max-width:none;margin:0;padding:0;border-radius:0;box-shadow:none}
.docs{--hfoto:42mm}
a{color:inherit;text-decoration:none}
`;

const CSS_PAGINA = '@page{size:A4;margin:14mm 16mm 18mm}';

// ── Pedaços do HTML ─────────────────────────────────────────────────────────

const aparar = (s: unknown): string => String(s ?? '').trim();

const chip = (s: StatusVistoria): string => `<span class="chip s-${s}">${esc(STATUS_RELATORIO[s])}</span>`;

/** "27/10/2026 14:12", ou '' se o instante não for válido (sem data e hora, sem esse trecho). */
function quando(ts: unknown): string {
  const t = typeof ts === 'string' ? ts : undefined;
  const hora = horaBR(t);
  return hora ? `${dataBR(t)} ${hora}` : '';
}

/** Data da vistoria: a do menor `ts` entre as fotos (imagem) dos itens técnicos; sem foto válida, a criação. */
function dataDaVistoria(itens: ItemAssinado[], criada: string): string {
  let menor: number | null = null;
  for (const i of itens) {
    if (!ITENS_COM_STATUS.includes(i.key)) continue;
    for (const f of i.fotos) {
      if (f.tipo === 'file' || !horaBR(f.ts)) continue;
      const t = new Date(f.ts as string).getTime();
      if (!Number.isNaN(t) && (menor === null || t < menor)) menor = t;
    }
  }
  return dataBR(menor === null ? criada : new Date(menor));
}

const contarImagens = (i: ItemAssinado): number => i.fotos.filter((f) => f.tipo !== 'file').length;
const contarArquivos = (i: ItemAssinado): number => i.fotos.filter((f) => f.tipo === 'file').length;

/** "2 fotos, 1 arquivo", "1 foto" ou "3 arquivos". Sem mídia: ''. */
function contagem(i: ItemAssinado): string {
  const fotos = contarImagens(i);
  const arquivos = contarArquivos(i);
  const partes: string[] = [];
  if (fotos) partes.push(`${fotos} ${fotos === 1 ? 'foto' : 'fotos'}`);
  if (arquivos) partes.push(`${arquivos} ${arquivos === 1 ? 'arquivo' : 'arquivos'}`);
  return partes.join(', ');
}

function legendaDe(rotulo: 'Foto' | 'Documento', n: number | undefined, label: string, ts: unknown): string {
  const q = quando(ts);
  return `<b>${rotulo}${n === undefined ? '' : ' ' + n}</b> · ${esc(label)}${q ? ` · ${esc(q)}` : ''}`;
}

/**
 * Mídias do item prontas para o HTML, na ordem gravada. `nums` são os números das imagens do item (a numeração
 * é global, feita em fotos.ts); foto sem URL assinada não aparece mas continua contando, para a numeração
 * não escorregar. Arquivo anexado sai como linha fina. No PDF não há link: a URL assinada vale 1 hora.
 */
function midiasDe(i: ItemAssinado, nums: number[], rotulo: 'Foto' | 'Documento', pdf: boolean): string[] {
  const out: string[] = [];
  let imagem = 0;
  for (const f of i.fotos) {
    if (f.tipo === 'file') {
      if (!f.signed) continue;
      const nome = esc(f.nome || 'arquivo');
      out.push(pdf
        ? `<div class="file">Arquivo anexado: ${nome}</div>`
        : `<a class="file" href="${esc(f.signed)}" target="_blank" rel="noopener">Arquivo anexado: ${nome}</a>`);
      continue;
    }
    const n = nums[imagem++];
    if (!f.signed) continue;
    const src = esc(f.signed);
    const img = pdf
      ? `<img src="${src}" alt="${esc(i.label)}"/>`
      : `<a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${esc(i.label)}" loading="lazy"/></a>`;
    out.push(`<figure class="ph">${img}<figcaption>${legendaDe(rotulo, n, i.label, f.ts)}</figcaption></figure>`);
  }
  return out;
}

/** Item técnico no "Registro por item": título, estado, contagem, explicação, observação e mídias. */
function blocoItem(i: ItemAssinado, st: StatusVistoria | undefined, nums: number[], pdf: boolean): string {
  const { junto, resto } = dividirJunto(midiasDe(i, nums, 'Foto', pdf), 3);
  const expl = EXPLICA[i.key];
  const obs = aparar(i.obs);
  return `
  <section class="item" id="i-${esc(i.key)}"><div class="keep"><div class="itemHead"><strong>${esc(i.label)}</strong>${st ? ' ' + chip(st) : ''} <span class="cnt">${esc(contagem(i))}</span></div>${expl ? `<p class="expl">${esc(expl)}</p>` : ''}${obs ? `<p class="obs">${esc(obs)}</p>` : ''}${junto.length ? `<div class="mid">${junto.join('')}</div>` : ''}</div>${resto.length ? `<div class="mid resto">${resto.join('')}</div>` : ''}</section>`;
}

/**
 * Item de "Documentos do titular". A conta de luz mantém as imagens. O documento pessoal (CNH ou identidade)
 * NUNCA mostra imagem, nome de arquivo nem link: só título, explicação, observação e o aviso de que foi recebido.
 */
function blocoDocumento(i: ItemAssinado, nums: number[], pdf: boolean): string {
  const semImagem = i.key === 'documento_pessoal';
  const { junto, resto } = dividirJunto(semImagem ? [] : midiasDe(i, nums, 'Documento', pdf), 3);
  const expl = EXPLICA[i.key];
  const obs = aparar(i.obs);
  const cnt = semImagem ? '' : contagem(i);
  const aviso = semImagem && i.fotos.length > 0 ? `<p class="docaviso">${esc(SECOES.documento_sem_imagem)}</p>` : '';
  return `
  <section class="item" id="i-${esc(i.key)}"><div class="keep"><div class="itemHead"><strong>${esc(i.label)}</strong>${cnt ? ` <span class="cnt">${esc(cnt)}</span>` : ''}</div>${expl ? `<p class="expl">${esc(expl)}</p>` : ''}${obs ? `<p class="obs">${esc(obs)}</p>` : ''}${aviso}${junto.length ? `<div class="mid">${junto.join('')}</div>` : ''}</div>${resto.length ? `<div class="mid resto">${resto.join('')}</div>` : ''}</section>`;
}

const kv = (rotulo: string, valor: string, largo = false): string =>
  valor ? `<div${largo ? ' class="w"' : ''}><dt>${esc(rotulo)}</dt><dd>${valor}</dd></div>` : '';

interface LocalMarcado { texto: string; coords: string; href: string }

/** Ponto da vistoria: texto do técnico, coordenadas e o endereço do mapa. Só aceita link http(s). */
function localDe(loc: LocalizacaoPublica | null | undefined): LocalMarcado | null {
  if (!loc) return null;
  const temCoords = typeof loc.lat === 'number' && typeof loc.lng === 'number' && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
  const coords = temCoords ? `${(loc.lat as number).toFixed(5)}, ${(loc.lng as number).toFixed(5)}` : '';
  const colado = aparar(loc.link);
  const href = temCoords ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : (/^https?:\/\//i.test(colado) ? colado : '');
  const texto = aparar(loc.texto);
  if (!texto && !coords && !href) return null;
  return { texto, coords, href };
}

function secaoIdentificacao(e: EntradaVistoria, local: LocalMarcado | null, pdf: boolean): string {
  const linhas: string[] = [];
  const c = e.cliente;
  if (c) {
    const cidadeUf = c.cidade && c.uf ? `${c.cidade}/${c.uf}` : (c.cidade || c.uf);
    const endereco = [c.endereco, cidadeUf, c.cep ? `CEP ${c.cep}` : ''].filter(Boolean).join(', ');
    linhas.push(kv('Endereço do cadastro', esc(endereco), true));
    linhas.push(kv('Concessionária', esc(c.concessionaria)));
  }
  if (local) {
    const nome = [local.texto, local.coords ? (local.texto ? `(${local.coords})` : local.coords) : ''].filter(Boolean).join(' ');
    const mapa = local.href
      ? (pdf
        ? `<span class="url">${esc(local.href)}</span>`
        : `<span class="url"><a href="${esc(local.href)}" target="_blank" rel="noopener noreferrer">Abrir no mapa</a></span>`)
      : '';
    linhas.push(kv('Local marcado', `${esc(nome)}${mapa}`, true));
  }
  const corpo = linhas.join('');
  return corpo ? `<section class="sec" id="identificacao"><h2 class="sec">${esc(SECOES.identificacao)}</h2><dl class="kv">${corpo}</dl></section>` : '';
}

function secaoAssinaturas(e: EntradaVistoria): string {
  const t = e.assinaturas?.tecnico;
  const c = e.assinaturas?.cliente;
  if (!t && !c) return '';
  const bloco = (rotulo: string, a: AssinaturaPublica | undefined, comRegistro: boolean) => {
    if (!a) return '';
    const registro = comRegistro ? aparar(a.registro) : '';
    const dia = dataHoraAs(typeof a.ts === 'string' ? a.ts : undefined);
    return `<div class="ass"><div class="area">${a.url ? `<img src="${esc(a.url)}" alt="${esc(rotulo)}"/>` : ''}</div>
      <p class="nm">${esc(aparar(a.nome))}</p><p class="rg">${registro ? `Registro: ${esc(registro)}` : ''}</p><p class="dt">${dia ? `Assinado em ${esc(dia)}` : ''}</p><p class="cap">${esc(rotulo)}</p></div>`;
  };
  return `<section id="assinaturas"><h2 class="sec">${esc(SECOES.assinaturas)}</h2><div class="assin">${bloco(SECOES.assinatura_tecnico, t, true)}${bloco(SECOES.assinatura_cliente, c, false)}</div></section>`;
}

// ── O documento ─────────────────────────────────────────────────────────────

export function htmlVistoria(e: EntradaVistoria, modo: ModoRelatorio = 'tela'): string {
  const pdf = modo === 'pdf';
  const status: MapaStatus = sanitizarStatus(e.status_itens);
  const itens = e.itens;
  const r = resumo(itens, status);
  const cob = cobertura(status);
  const concluida = e.status === 'concluida';
  const statusDe = (key: string): StatusVistoria | undefined => (ITENS_COM_STATUS.includes(key) ? status[key] : undefined);
  const rotuloDe = (key: string): string => itens.find((i) => i.key === key)?.label || ROTULO_CHEIO[key] || key;

  // Documentos do titular ficam em seção própria; os demais são os itens técnicos, na ordem do checklist.
  const ehDocumento = (i: ItemAssinado): boolean => i.key === 'conta_luz' || i.key === 'documento_pessoal';
  const ordemTecnica = (i: ItemAssinado): number => {
    const p = ITENS_COM_STATUS.indexOf(i.key);
    return p < 0 ? ITENS_COM_STATUS.length : p;
  };
  const tecnicos = itens.filter((i) => !ehDocumento(i)).sort((a, b) => ordemTecnica(a) - ordemTecnica(b));
  const documentos = ['conta_luz', 'documento_pessoal'].map((k) => itens.find((i) => i.key === k)).filter((i): i is ItemAssinado => !!i);

  // Numeração global e contínua das imagens (fotos) e própria dos documentos (só a conta de luz mostra imagem).
  const numeros = numerarGrupos(tecnicos.map((i) => i.key), Object.fromEntries(tecnicos.map((i) => [i.key, contarImagens(i)])));
  const numerosDoc = numerarGrupos(['conta_luz'], Object.fromEntries(documentos.map((i) => [i.key, i.key === 'conta_luz' ? contarImagens(i) : 0])));

  const temRegistro = (i: ItemAssinado): boolean => i.fotos.length > 0 || !!statusDe(i.key) || !!aparar(i.obs);
  const visiveis = tecnicos.filter(temRegistro);
  const docsVisiveis = documentos.filter((i) => i.fotos.length > 0 || !!aparar(i.obs));
  const faltando = itens.filter((i) => !temRegistro(i)).map((i) => esc(i.label));

  const cliente = aparar(e.cliente_nome);
  const titulo = `Vistoria${cliente ? ': ' + cliente : ''}`;
  const marca = e.marca ?? null;
  const nomeMarca = aparar(marca?.nome);
  const logo = marca ? logoSeguro(marca.logo) : null;
  const cnpj = aparar(marca?.cnpj);
  const temMarca = !!(nomeMarca || logo || cnpj);
  // Sem marca nenhuma, o canto esquerdo traz o título do documento; com marca sem nome, só o logo e o CNPJ.
  const rotuloEmp = nomeMarca || (temMarca ? '' : SECOES.titulo);
  const pal: Paleta = paleta(marca?.cor);
  const codigo = codigoVistoria(e.id);
  const data = dataDaVistoria(itens, e.created_at);
  const url = urlPublica('v', e.id);
  const local = localDe(e.localizacao);
  const tecnico = e.assinaturas?.tecnico;
  const responsavel = tecnico && aparar(tecnico.nome)
    ? [aparar(tecnico.nome), aparar(tecnico.registro)].filter(Boolean).join(', ')
    : '';
  const contato = MOSTRAR_CONTATO_EMPRESA ? marca?.contato : undefined;
  const linhasContato = contato
    ? [telefoneFormatado(contato.whatsapp) ? `WhatsApp ${telefoneFormatado(contato.whatsapp)}` : '', [aparar(contato.endereco), aparar(contato.cidade)].filter(Boolean).join(', ')].filter(Boolean)
    : [];

  // ── Cabeçalho ──
  const cabecalho = `<header class="cab">
    <div class="marca">${logo ? `<img src="${esc(logo)}" alt="${esc(nomeMarca)}"/>` : ''}<div class="emp">${rotuloEmp ? `<b>${esc(rotuloEmp)}</b>` : ''}${cnpj ? `<span>CNPJ ${esc(cnpj)}</span>` : ''}${linhasContato.map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>
    <div class="ref"><b>${esc(codigo)}</b>${responsavel ? `<span>${esc(SECOES.responsavel)} ${esc(responsavel)}</span>` : ''}</div>
  </header>
  <div class="reg"></div><div class="reg2"></div>`;

  // ── Ações e navegação (só na tela) ──
  const nArquivos = itens.filter((i) => i.key !== 'documento_pessoal').reduce((n, i) => n + i.fotos.length, 0);
  const temPendencias = !!r.selo;
  const ancoras = [
    temPendencias ? `<a href="#pendencias">Pendências</a>` : '',
    visiveis.length ? `<a href="#registro">Fotos</a>` : '',
    tecnico || e.assinaturas?.cliente ? `<a href="#assinaturas">Assinaturas</a>` : '',
  ].filter(Boolean);
  const acoes = pdf ? '' : `
  <div class="acoes">
    ${nArquivos > 0 ? `<a class="lnk" href="/v/${esc(e.id)}/fotos.zip" download>${esc(SECOES.baixar_arquivos)} (${nArquivos})</a>` : ''}
    ${local?.href ? `<a class="lnk" href="${esc(local.href)}" target="_blank" rel="noopener noreferrer">Abrir no mapa</a>` : ''}
    ${ancoras.length > 0 ? `<nav class="nav" aria-label="Seções do relatório"><span>${esc(SECOES.ir_para)}</span>${ancoras.join('')}</nav>` : ''}
  </div>`;

  // ── Resultado, pendências, conclusão e próximos passos ──
  let resultado = '';
  if (r.selo) {
    const parcial = r.selo === 'conforme' && cob.avaliados < cob.total;
    const s = parcial ? SELO_PARCIAL : SELOS[r.selo];
    const placar = frasePlacar(status);
    const faltam = cob.faltam.map((k) => rotuloDe(k));
    const pend = r.pendencias.length
      ? r.pendencias.map((p) => {
        const pr = PRIORIDADE_LABEL[p.prioridade];
        const item = itens.find((i) => i.key === p.key);
        const obs = aparar(item?.obs);
        const nums = numeros.get(p.key) ?? [];
        const ref = refFotos(nums);
        const refHtml = ref ? `<p class="pref">${pdf ? esc(ref) : `<a href="#i-${esc(p.key)}">${esc(ref)}</a>`}</p>` : '';
        return `<div class="pen ${p.prioridade}"><div class="hd"><b>${esc(p.label)}</b><span class="chip p-${p.prioridade}">${esc(pr.titulo)}</span></div><p>${esc(pr.frase)}</p>${obs ? `<p class="pobs">${esc(obs)}</p>` : ''}${refHtml}</div>`;
      }).join('')
      : `<p class="vazio">${esc(SECOES.pendencias_vazio)}</p>`;
    const passos: readonly string[] = concluida ? proximosPassos(r.selo, cob) : [];
    resultado = `
  <h2 class="sec">${esc(SECOES.selo)}</h2>
  <div class="selo sc-${parcial ? 'parcial' : r.selo}"><p class="tt">${esc(s.titulo)}</p><p class="fr">${esc(s.frase)}</p></div>
  ${placar ? `<p class="placar">${esc(placar)}</p>` : ''}
  ${faltam.length ? `<p class="faltam">${esc(SECOES.faltam_avaliar)} ${esc(juntarLista(faltam))}.</p>` : ''}
  <h2 class="sec" id="pendencias">${esc(SECOES.pendencias)}</h2>
  ${pend}
  <h2 class="sec">${esc(SECOES.conclusao)}</h2>
  <p class="concl">${esc(r.conclusao)}</p>
  ${passos.length ? `<h2 class="sec">${esc(SECOES.proximos_passos)}</h2><ol class="passos">${passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}`;
  }

  // ── Registro por item, itens sem registro e documentos do titular ──
  const registro = visiveis.length
    ? `<section id="registro"><h2 class="sec">${esc(SECOES.registro)}</h2>${visiveis.map((i) => blocoItem(i, statusDe(i.key), numeros.get(i.key) ?? [], pdf)).join('')}</section>`
    : '';
  const vazio = !visiveis.length && !docsVisiveis.length ? `<div class="empty">${esc(SECOES.sem_nada)}</div>` : '';
  const blocoFaltando = faltando.length ? `<div class="faltando"><strong>${esc(SECOES.sem_registro)}</strong> ${faltando.join(' · ')}</div>` : '';
  const blocoDocs = docsVisiveis.length
    ? `<section class="docs" id="documentos"><h2 class="sec">${esc(SECOES.documentos)}</h2><p class="apoio">${esc(SECOES.documentos_apoio)}</p>${docsVisiveis.map((i) => blocoDocumento(i, numerosDoc.get(i.key) ?? [], pdf)).join('')}</section>`
    : '';

  const dataMeta = data ? `<span>Data: ${esc(data)}</span>` : '';
  const descricao = `Relatório de vistoria de energia solar${cliente ? ' de ' + cliente : ''}${nomeMarca ? ', por ' + nomeMarca : ''}.`;

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
${pdf ? '' : `<div class="barra"><span>${esc(SECOES.titulo)}</span><a href="/v/${esc(e.id)}/pdf">${esc(SECOES.baixar_pdf)}</a></div>`}
<main class="folha">
  ${cabecalho}
  ${temMarca ? `<p class="eyebrow">${esc(SECOES.titulo)}</p>` : ''}
  <h1>${cliente ? esc(cliente) : 'Vistoria técnica'}</h1>
  <div class="meta">${dataMeta}<span>Fotos em ${r.itensComFoto} de ${itens.length} itens</span><span>${concluida ? 'Concluída' : 'Em andamento'}</span></div>
  ${acoes}
  ${secaoIdentificacao(e, local, pdf)}
  ${concluida ? '' : `<div class="andamento" role="status">${esc(SECOES.andamento)}</div>`}
  ${resultado}
  ${registro}
  ${vazio}
  ${blocoFaltando}
  ${blocoDocs}
  ${secaoAssinaturas(e)}
  ${pdf
    ? `<p class="online">${esc(SECOES.versao_online)} <a href="${esc(url)}">${esc(url)}</a></p>`
    : `<footer class="rod">Relatório gerado pela SolarDoc${data ? ` • ${esc(data)}` : ''}</footer>`}
</main>
</body></html>`;
}

/**
 * Opções do page.pdf(): A4 em pé, margem pelo @page e rodapé de página com empresa, código, cliente e
 * "Página X de Y". Os textos entram crus: quem escapa é o rodapé (opcoesPdfComRodape).
 */
export function opcoesPdf(p: { marcaNome?: string | null; codigo: string; cliente?: string | null }) {
  const esquerda = [cortar(limpo(p.marcaNome), 28), aparar(p.codigo), cortar(limpo(p.cliente), 36)].filter(Boolean).join(' · ');
  return opcoesPdfComRodape({ esquerda });
}

function paginaSimples(status: string, titulo: string, mensagem: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow"/>
<title>${esc(titulo)}</title>
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;background:#F5F7FA;color:#1B2433;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
.c{max-width:420px;background:#fff;border:1px solid #D8DEE7;border-top:4px solid #0B2545;border-radius:8px;padding:28px 24px}h1{margin:0 0 8px;font-size:20px;color:#0B2545}p{margin:0;color:#55606E;font-size:15px;line-height:1.5}</style>
</head><body data-status="${esc(status)}"><div class="c"><h1>${esc(titulo)}</h1><p>${esc(mensagem)}</p></div></body></html>`;
}

export const paginaNaoEncontrada = () =>
  paginaSimples('404', 'Vistoria não encontrada', 'O link expirou ou foi removido. Peça pro técnico enviar novamente.');
export const paginaErroPdf = () => paginaSimples('500', 'Vistoria', SECOES.erro_pdf);
