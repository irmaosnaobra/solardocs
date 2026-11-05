// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): o BOOK da obra em PDF, gerado no servidor.
//
// `bookHtml` é uma função PURA: a mesma composição que o `baixarBook` do `jornada-obra.js` fazia no navegador (o mesmo `<style>`, o `<h1>`,
// as fotos, os testes, o monitoramento, o atendimento e o termo de garantia depois de uma quebra de página). Todo texto passa por
// `escHtml`; o `termo_html` já vem limpo pelo `limparHtmlPapel`; URL de foto que não começa com `https://` é descartada.
//
// O fim do arquivo (separado por um comentário) lê e assina o registro do PDF no bucket privado `cadastros-venda`, para o robô da
// liberação (7.7) não importar rota. O registro NÃO entra no `obra.json` (o normalizador da Fase 2 não muda).
// ─────────────────────────────────────────────────────────────────────────────
import { assinarArquivoBruto, lerJsonBruto } from './cadastroVendaBanco';

export const TETO_BOOK_BYTES = 8 * 1024 * 1024;
export const caminhoBookPdf = (card: number): string => `vendasolar/${card}.book.pdf`;
export const caminhoBookJson = (card: number): string => `vendasolar/${card}.book.json`;

const escHtml = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ddmmaaaa = (ymd: string): string => (/^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}` : '');

export interface EntradaBook {
  titulo: string; cliente: string; cidade: string; fotos: readonly string[];
  testes: Record<string, unknown>;
  monitoramento: { app?: string; conta?: string; usina?: string; serie?: string; comissionamento?: string };
  contatos: { whatsapp?: string };
  termo_html: string; aviso_garantias?: string;
  larguraFoto: '31%' | '15%';
}

const tabela = (linhas: Array<[string, string]>): string =>
  `<table>${linhas.filter((x) => x[1]).map((x) => `<tr><td>${escHtml(x[0])}</td><td>${escHtml(x[1])}</td></tr>`).join('')}</table>`;

export function bookHtml(b: EntradaBook): string {
  const t = b.testes ?? {};
  const m = b.monitoramento ?? {};
  const fotos = b.fotos.filter((u) => typeof u === 'string' && u.startsWith('https://'));
  const s = (k: string): string => String(t[k] ?? '');
  const estilo = `<style>@page{size:A4;margin:14mm}body{font:13px/1.5 Georgia,serif;color:#111}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px;border-bottom:1px solid #111}.g{display:flex;flex-wrap:wrap;gap:6px}.g img{width:${b.larguraFoto};height:auto}td{padding:2px 10px 2px 0}</style>`;
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' + estilo + '</head><body>'
    + `<h1>${escHtml(b.titulo || 'Book da obra')}</h1><p>${escHtml(b.cliente)}${b.cidade ? ' · ' + escHtml(b.cidade) : ''}</p>`
    + (fotos.length ? `<h2>Fotos da obra</h2><div class="g">${fotos.map((u) => `<img src="${escHtml(u)}" alt="">`).join('')}</div>` : '')
    + (b.aviso_garantias ? `<p>${escHtml(b.aviso_garantias)}</p>` : '')
    + '<h2>Testes</h2>'
    + tabela([
      ['String 1, Voc', s('string1_voc') ? `${s('string1_voc')} V` : ''],
      ['String 2, Voc', s('string2_voc') ? `${s('string2_voc')} V` : ''],
      ['Isolamento', t.isolamento_ok ? 'ok' : ''],
      ['Inversor gerando', s('gerando_kw') ? `${s('gerando_kw')} kW${s('gerando_hora') ? ` às ${s('gerando_hora')}` : ''}` : ''],
      ['Wi-Fi do inversor', t.wifi_ok ? 'conectado' : ''],
      ['Disjuntores', t.disjuntores_ok ? 'identificados' : ''],
    ])
    + '<h2>Monitoramento</h2>'
    + tabela([
      ['Aplicativo', String(m.app ?? '')], ['Conta', String(m.conta ?? '')], ['Usina', String(m.usina ?? '')], ['Número de série', String(m.serie ?? '')],
      ['Comissionamento', m.comissionamento ? ddmmaaaa(String(m.comissionamento)) : ''],
    ])
    + (b.contatos?.whatsapp ? `<p>Atendimento: ${escHtml(b.contatos.whatsapp)}</p>` : '')
    + `<div style="page-break-before:always">${String(b.termo_html ?? '')}</div>`
    + '</body></html>';
}

// ── Daqui para baixo NÃO é puro: lê o registro e assina o PDF do bucket (o robô 7.7 usa, sem importar rota) ─────────────────────────────

export interface MetaBook { v: 1; gerado_em: string; por: string; tamanho: number; sha256: string; fotos: number }

/** O registro do Book (`vendasolar/<card>.book.json`), ou null se não existe ou não vale. Erro de leitura sobe. */
export async function lerMetaBook(card: number): Promise<MetaBook | null> {
  const v = await lerJsonBruto(caminhoBookJson(card));
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null;
  if (!o || o.v !== 1 || typeof o.gerado_em !== 'string' || typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha256)) return null;
  return {
    v: 1, gerado_em: o.gerado_em, por: typeof o.por === 'string' ? o.por : '',
    tamanho: typeof o.tamanho === 'number' ? o.tamanho : 0, sha256: o.sha256, fotos: typeof o.fotos === 'number' ? o.fotos : 0,
  };
}

/** A URL assinada do PDF do Book (bucket `cadastros-venda`), ou null. */
export const urlAssinadaDoBook = (card: number, segundos: number): Promise<string | null> => assinarArquivoBruto(caminhoBookPdf(card), segundos);
