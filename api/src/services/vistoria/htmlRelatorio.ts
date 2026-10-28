import {
  MapaStatus, PRIORIDADE_LABEL, SECOES, SELOS, STATUS_RELATORIO, ITENS_COM_STATUS,
  StatusVistoria, resumo, sanitizarStatus,
} from './avaliacao';

// ─────────────────────────────────────────────────────────────────────────────
// HTML do relatório público da vistoria solar (/v/:id) e do PDF (/v/:id/pdf).
// Uma função só monta os dois: modo 'tela' (escuro, com botões e links) e modo 'pdf'
// (claro, A4, sem botão, sem lazy-load, sem emoji, porque o Chromium do servidor não
// tem fonte de emoji). Todo texto vindo do usuário passa por esc().
// ─────────────────────────────────────────────────────────────────────────────

export type ModoRelatorio = 'tela' | 'pdf';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface FotoAssinada {
  url: string;
  tipo: 'image' | 'file';
  nome?: string;
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

export interface EntradaVistoria {
  id: string;
  cliente_nome: string | null;
  status: string;
  created_at: string;
  localizacao?: LocalizacaoPublica | null;
  itens: ItemAssinado[];
  status_itens?: unknown;
  assinaturas?: {
    tecnico?: { url: string | null; nome?: string; registro?: string };
    cliente?: { url: string | null; nome?: string };
  };
}

const TEMA_ESCURO = `
:root{--bg:#0F172A;--fg:#F1F5F9;--mut:#94A3B8;--sub:#CBD5E1;--ln:#1E293B;--bd:#334155;--card:#1E293B;--hdr:linear-gradient(135deg,#1E293B,#0F172A);--eye:#FBBF24;
--ok-bg:#14532D;--ok-fg:#DCFCE7;--ok-bd:#166534;--at-bg:#78350F;--at-fg:#FEF3C7;--at-bd:#92400E;--nc-bg:#7F1D1D;--nc-fg:#FEE2E2;--nc-bd:#991B1B;--na-bg:#334155;--na-fg:#E2E8F0;--na-bd:#475569;
--sc-conforme:#34D399;--sb-conforme:#052E1B;--st-conforme:#A7F3D0;--sc-atencao:#FBBF24;--sb-atencao:#2D2107;--st-atencao:#FDE68A;--sc-nao_conforme:#F87171;--sb-nao_conforme:#2D0F0F;--st-nao_conforme:#FECACA;
--falta-bg:#3F1D1D;--falta-bd:#7F1D1D;--falta-fg:#FCA5A5}`;

const TEMA_CLARO = `
:root{--bg:#FFFFFF;--fg:#1B2433;--mut:#55606E;--sub:#2A3547;--ln:#D8DEE7;--bd:#C5CCD8;--card:#F5F7FA;--hdr:#FFFFFF;--eye:#7A4B00;
--ok-bg:#E7F5EC;--ok-fg:#14532D;--ok-bd:#8BCB9F;--at-bg:#FEF3D3;--at-fg:#7A4B00;--at-bd:#E5B54C;--nc-bg:#FDE7E7;--nc-fg:#8B1A1A;--nc-bd:#E49C9C;--na-bg:#EEF1F5;--na-fg:#475266;--na-bd:#C5CCD8;
--sc-conforme:#2E9E5B;--sb-conforme:#F1FAF4;--st-conforme:#14532D;--sc-atencao:#D99A1B;--sb-atencao:#FFF9E8;--st-atencao:#7A4B00;--sc-nao_conforme:#C93A3A;--sb-nao_conforme:#FFF3F3;--st-nao_conforme:#8B1A1A;
--falta-bg:#FDE7E7;--falta-bd:#E49C9C;--falta-fg:#8B1A1A}`;

const CSS_BASE = `
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:0 0 48px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
header{padding:28px 20px 20px;background:var(--hdr);border-bottom:1px solid var(--ln)}
header .eyebrow{color:var(--eye);font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin:0 0 6px}
header h1{font-size:22px;margin:0 0 4px;line-height:1.2}
.wrap{max-width:880px;margin:0 auto;padding:0 16px}
.meta{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:13px;color:var(--sub)}
h2.sec{margin:28px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--ln);font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);break-after:avoid;page-break-after:avoid}
.item{margin-top:22px;padding-top:18px;border-top:1px solid var(--ln)}
.itemHead{display:flex;align-items:center;flex-wrap:wrap;gap:10px;break-after:avoid;page-break-after:avoid}
.itemHead strong{font-size:16px}
.cnt{font-size:12px;color:var(--mut)}
.obs{font-size:13px;color:var(--sub);margin:6px 0 0;overflow-wrap:anywhere}
.mid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:12px}
.ph{display:block;border-radius:12px;overflow:hidden;border:1px solid var(--bd);break-inside:avoid;page-break-inside:avoid}
.ph img,.phimg img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block}
.phimg{border-radius:12px;overflow:hidden;border:1px solid var(--bd);break-inside:avoid;page-break-inside:avoid}
.file{display:flex;align-items:center;justify-content:center;padding:18px;border-radius:12px;border:1px solid var(--bd);background:var(--card);color:var(--fg);text-decoration:none;font-size:14px;font-weight:600;text-align:center;overflow-wrap:anywhere;break-inside:avoid;page-break-inside:avoid}
.faltando{margin-top:24px;padding:12px 14px;background:var(--falta-bg);border:1px solid var(--falta-bd);border-radius:12px;font-size:13px;color:var(--falta-fg)}
footer{text-align:center;color:var(--mut);font-size:12px;margin-top:28px}
.empty{margin-top:24px;padding:24px;text-align:center;color:var(--mut);background:var(--card);border-radius:14px}
.acoes{display:flex;flex-wrap:wrap;align-items:center;gap:6px 20px;margin-top:16px}
.dlBtn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:10px 20px;border-radius:10px;background:#F59E0B;color:#0f172a;font-family:inherit;font-weight:800;font-size:14px;text-decoration:none}
.lnk{display:inline-flex;align-items:center;min-height:44px;font-family:inherit;font-size:14px;font-weight:600;color:var(--fg);text-decoration:underline;text-underline-offset:3px}
.chip{display:inline-block;font-family:inherit;padding:2px 10px;border-radius:999px;border:1px solid;font-size:12px;font-weight:600;line-height:1.5;white-space:nowrap}
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
.pen{margin-top:10px;padding:10px 14px;border:1px solid var(--bd);border-left:5px solid var(--pc);border-radius:8px;background:var(--card);break-inside:avoid;page-break-inside:avoid}
.pen.alta{--pc:var(--sc-nao_conforme)}
.pen.media{--pc:var(--sc-atencao)}
.pen .hd{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.pen .hd b{font-size:15px;font-family:inherit}
.pen p{margin:4px 0 0;font-size:13px;color:var(--mut)}
.vazio{margin:0;padding:11px 14px;border:1px dashed var(--bd);border-radius:8px;color:var(--mut);background:var(--card);font-size:14px}
.concl{margin:0;padding:13px 16px;background:var(--card);border-left:4px solid var(--bd);border-radius:0 8px 8px 0;font-size:15px;line-height:1.62;break-inside:avoid;page-break-inside:avoid}
.assin{display:grid;grid-template-columns:1fr 1fr;gap:24px;break-inside:avoid;page-break-inside:avoid}
.ass .area{height:96px;display:flex;align-items:flex-end;justify-content:center;border-bottom:1.5px solid var(--mut);background:#fff;border-radius:6px 6px 0 0}
.ass .area img{max-height:90px;max-width:100%;object-fit:contain}
.ass .nm{margin:6px 0 0;font-weight:700;font-size:14px;text-align:center}
.ass .rg{margin:0;font-size:12px;color:var(--mut);text-align:center}
.ass .cap{margin:3px 0 0;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);text-align:center}
@media (max-width:640px){.assin{grid-template-columns:1fr}}
`;

const CSS_PDF = `
@page{size:A4;margin:14mm 13mm 17mm}
html{font-size:13px}
body{padding:0}
header{padding:0 0 14px;border-bottom:3px solid #0B2545}
.wrap{max-width:none;padding:0}
.mid{grid-template-columns:1fr 1fr}
.item{break-inside:auto}
footer{margin-top:18px}
`;

const chip = (s: StatusVistoria): string => `<span class="chip s-${s}">${esc(STATUS_RELATORIO[s])}</span>`;

function secaoSelo(r: ReturnType<typeof resumo>): string {
  if (!r.selo) return '';
  const s = SELOS[r.selo];
  const pend = r.pendencias.length
    ? r.pendencias.map((p) => {
      const pr = PRIORIDADE_LABEL[p.prioridade];
      return `<div class="pen ${p.prioridade}"><div class="hd"><b>${esc(p.label)}</b><span class="chip p-${p.prioridade}">${esc(pr.titulo)}</span></div><p>${esc(pr.frase)}</p></div>`;
    }).join('')
    : `<p class="vazio">${esc(SECOES.pendencias_vazio)}</p>`;
  return `
  <h2 class="sec">${esc(SECOES.selo)}</h2>
  <div class="selo sc-${r.selo}"><p class="tt">${esc(s.titulo)}</p><p class="fr">${esc(s.frase)}</p></div>
  <h2 class="sec">${esc(SECOES.pendencias)}</h2>
  ${pend}
  <h2 class="sec">${esc(SECOES.conclusao)}</h2>
  <p class="concl">${esc(r.conclusao)}</p>`;
}

function secaoAssinaturas(e: EntradaVistoria): string {
  const t = e.assinaturas?.tecnico;
  const c = e.assinaturas?.cliente;
  if (!t && !c) return '';
  const bloco = (rotulo: string, a: { url: string | null; nome?: string; registro?: string } | undefined, comRegistro: boolean) => {
    if (!a) return '';
    const reg = comRegistro && (a.registro || '').trim() ? `<p class="rg">Registro: ${esc((a.registro || '').trim())}</p>` : '';
    return `<div class="ass"><div class="area">${a.url ? `<img src="${esc(a.url)}" alt="${esc(rotulo)}"/>` : ''}</div>
      <p class="nm">${esc((a.nome || '').trim())}</p>${reg}<p class="cap">${esc(rotulo)}</p></div>`;
  };
  return `<h2 class="sec">${esc(SECOES.assinaturas)}</h2><div class="assin">${bloco(SECOES.assinatura_tecnico, t, true)}${bloco(SECOES.assinatura_cliente, c, false)}</div>`;
}

export function htmlVistoria(e: EntradaVistoria, modo: ModoRelatorio = 'tela'): string {
  const pdf = modo === 'pdf';
  const status: MapaStatus = sanitizarStatus(e.status_itens);
  const itens = e.itens;
  const r = resumo(itens, status);
  const statusDe = (key: string): StatusVistoria | undefined => (ITENS_COM_STATUS.includes(key) ? status[key] : undefined);

  // Mostra o item que tem foto ou status. Sem nenhum dos dois, entra em "Sem registro".
  const visiveis = itens.filter((i) => i.fotos.length > 0 || statusDe(i.key));
  const faltando = itens.filter((i) => i.fotos.length === 0 && !statusDe(i.key)).map((i) => esc(i.label));
  const totalFotos = itens.reduce((n, i) => n + i.fotos.length, 0);

  const data = new Date(e.created_at).toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const blocos = visiveis.map((i) => {
    const midias = i.fotos.map((f) => {
      if (!f.signed) return '';
      if (f.tipo === 'file') {
        const nome = esc(f.nome || 'arquivo');
        return pdf
          ? `<div class="file">Arquivo anexado: ${nome}</div>`
          : `<a class="file" href="${esc(f.signed)}" target="_blank" rel="noopener">Arquivo anexado: ${nome}</a>`;
      }
      return pdf
        ? `<div class="phimg"><img src="${esc(f.signed)}" alt="${esc(i.label)}"/></div>`
        : `<a class="ph" href="${esc(f.signed)}" target="_blank" rel="noopener"><img src="${esc(f.signed)}" alt="${esc(i.label)}" loading="lazy"/></a>`;
    }).join('');
    const st = statusDe(i.key);
    return `
      <section class="item">
        <div class="itemHead">
          <strong>${esc(i.label)}</strong>
          ${st ? chip(st) : ''}
          ${i.fotos.length ? `<span class="cnt">${i.fotos.length} ${i.fotos.length === 1 ? 'foto' : 'fotos'}</span>` : ''}
        </div>
        ${i.obs ? `<p class="obs">${esc(i.obs)}</p>` : ''}
        ${midias ? `<div class="mid">${midias}</div>` : ''}
      </section>`;
  }).join('');

  const blocoFaltando = faltando.length
    ? `<div class="faltando"><strong>Sem registro:</strong> ${faltando.join(' · ')}</div>`
    : '';

  // Localização: botão de mapa quando há coordenada; senão o link cru que foi colado.
  // No PDF vira só texto (não há onde clicar).
  const loc = e.localizacao;
  const hrefLocal = loc
    ? (loc.lat != null && loc.lng != null ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : (loc.link || ''))
    : '';
  const textoLocal = loc?.texto
    ? loc.texto
    : (loc?.lat != null && loc?.lng != null ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : '');
  const linkLocal = pdf
    ? (textoLocal ? `<div class="meta"><span>Local: ${esc(textoLocal)}</span></div>` : '')
    : hrefLocal
      ? `<a class="lnk" href="${esc(hrefLocal)}" target="_blank" rel="noopener noreferrer">${textoLocal ? 'Local: ' + esc(textoLocal) : 'Abrir no mapa'}</a>`
      : (textoLocal ? `<div class="meta"><span>Local: ${esc(textoLocal)}</span></div>` : '');

  const cliente = (e.cliente_nome || '').trim();
  const titulo = `Vistoria${cliente ? ': ' + cliente : ''}`;

  // Um botão principal (PDF) e o resto como links na mesma linha.
  const botoes = pdf ? '' : `
  <div class="acoes">
    <a class="dlBtn" href="/v/${esc(e.id)}/pdf">${esc(SECOES.baixar_pdf)}</a>
    ${totalFotos > 0 ? `<a class="lnk" href="/v/${esc(e.id)}/fotos.zip" download>Baixar todas as fotos (${totalFotos})</a>` : ''}
    ${hrefLocal ? linkLocal : ''}
  </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(titulo)}</title>
<style>${pdf ? TEMA_CLARO : TEMA_ESCURO}${CSS_BASE}${pdf ? CSS_PDF : ''}</style>
</head><body>
<header><div class="wrap">
  <p class="eyebrow">Vistoria de Energia Solar</p>
  <h1>${cliente ? esc(cliente) : 'Vistoria técnica'}</h1>
  <div class="meta"><span>Data: ${data}</span><span>${r.itensComFoto} de ${itens.length} itens</span><span>${e.status === 'concluida' ? 'Concluída' : 'Em andamento'}</span></div>
  ${botoes}
  ${pdf || !hrefLocal ? linkLocal : ''}
</div></header>
<main class="wrap">
  ${secaoSelo(r)}
  ${visiveis.length ? blocos : `<div class="empty">Nenhum registro ainda.</div>`}
  ${blocoFaltando}
  ${secaoAssinaturas(e)}
  <footer>Relatório gerado pela SolarDoc • ${data}</footer>
</main>
</body></html>`;
}

/** Opções do page.pdf(): A4 em pé, margem pelo @page, rodapé com a página. */
export function opcoesPdf() {
  return {
    format: 'A4' as const,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      `<div style="width:100%;padding:0 13mm;font-family:Arial,Helvetica,sans-serif;font-size:7.5px;color:#6B7684;display:flex;justify-content:space-between;">` +
      `<span>Relatório de vistoria gerado pela SolarDoc.</span>` +
      `<span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
  };
}

function paginaSimples(status: string, titulo: string, mensagem: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow"/>
<title>${esc(titulo)}</title>
<style>body{font-family:-apple-system,sans-serif;background:#0F172A;color:#F1F5F9;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;margin:0}h1{font-size:24px;margin:16px 0 8px}p{color:#94A3B8;font-size:14px;margin:0}</style>
</head><body data-status="${esc(status)}">
<h1>${esc(titulo)}</h1>
<p>${esc(mensagem)}</p>
</body></html>`;
}

export const paginaNaoEncontrada = () =>
  paginaSimples('404', 'Vistoria não encontrada', 'O link expirou ou foi removido. Peça pro técnico enviar novamente.');
export const paginaErroPdf = () => paginaSimples('500', 'Vistoria', SECOES.erro_pdf);
