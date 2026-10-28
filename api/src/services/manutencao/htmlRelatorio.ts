import {
  CHECKLIST, GRUPO_FOTO_LABEL, PERIODICIDADE_LABEL, PRIORIDADE_LABEL, SECOES, SELOS, STATUS_ATIV_LABEL,
  STATUS_ITEM_RELATORIO, TELHADO_LABEL, TIPO_SISTEMA_LABEL, ATIVIDADES,
  Dados, Selo, calcularSelo, codigoLegivel, dataCurta, dataPorExtenso, formatarNumero, montarConclusao,
  normalizarDados, pendencias, somarMeses,
} from './relatorio';

// ─────────────────────────────────────────────────────────────────────────────
// HTML do relatório de manutenção preventiva: UMA folha de estilo serve a tela
// (celular e computador), a impressão e o PDF (A4 em pé, gerado pelo puppeteer).
// Documento que vai para o cliente final: família visual dos documentos de marca
// (azul-marinho + filete), com a cor da empresa como destaque. Todo texto vindo do
// usuário passa por esc(). Sem emoji, sem fonte externa, sem script.
// ─────────────────────────────────────────────────────────────────────────────

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface EntradaRelatorio {
  linha: {
    id: string;
    codigo: string | null;
    cliente_nome: string | null;
    data_inspecao: string;
    proxima_visita: string | null;
    dados: unknown;
  };
  empresa: { nome?: string | null; nome_fantasia?: string | null; cnpj?: string | null; logo_base64?: string | null; cor_marca?: string | null };
  /** grupo -> fotos com signed URL já gerada */
  fotos: Record<string, { path: string; url: string | null }[]>;
  assinaturas: {
    tecnico?: { url: string | null; nome?: string; registro?: string };
    cliente?: { url: string | null; nome?: string };
  };
}

// ── Cores: a cor da empresa vira destaque; sem cor, a marca padrão da SolarDoc ──
const hexLimpo = (h: unknown): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? '').trim());
  return m ? '#' + m[1]!.toLowerCase() : null;
};
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lum = (r: number, g: number, b: number) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const mistura = (a: number, b: number, t: number) => a + (b - a) * t;

function paleta(corMarca: unknown): { c1: string; c2: string; c3: string; ac: string } {
  const bruto = hexLimpo(corMarca);
  if (!bruto) return { c1: '#0B2545', c2: '#2C4A73', c3: '#EEF2F8', ac: '#C9A227' };
  let [r, g, b] = rgb(bruto);
  // Escurece até dar contraste de texto branco (mesma regra dos documentos da proposta).
  for (let i = 0; i < 40 && lum(r, g, b) > 0.18; i++) { r *= 0.9; g *= 0.9; b *= 0.9; }
  const [R, G, B] = [r, g, b];
  return {
    c1: toHex(R, G, B),
    c2: toHex(mistura(R, 255, 0.22), mistura(G, 255, 0.22), mistura(B, 255, 0.22)),
    c3: toHex(mistura(R, 255, 0.93), mistura(G, 255, 0.93), mistura(B, 255, 0.93)),
    ac: bruto,
  };
}

// Só aceita logo que seja imagem em data URL; qualquer outra coisa cai no nome da empresa.
const logoSeguro = (l: unknown): string | null => {
  const s = String(l ?? '').trim();
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null;
};

const CSS = (p: { c1: string; c2: string; c3: string; ac: string }) => `
*{box-sizing:border-box}
html{font-size:15px;-webkit-text-size-adjust:100%}
body{margin:0;background:#EDF0F4;color:#1B2433;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:root{--c1:${p.c1};--c2:${p.c2};--c3:${p.c3};--ac:${p.ac};--ink:#1B2433;--mut:#55606E;--ln:#D8DEE7;--wa:#F5F7FA}
.barra{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--ln);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px}
.barra span{font-size:.8rem;color:var(--mut);letter-spacing:.04em;text-transform:uppercase;font-weight:600}
.barra a{display:inline-flex;align-items:center;min-height:44px;justify-content:center;padding:0 18px;border-radius:10px;background:var(--c1);color:#fff;text-decoration:none;font-weight:700;font-size:.9rem}
.folha{max-width:860px;margin:18px auto 40px;background:#fff;border-radius:6px;box-shadow:0 1px 3px rgba(11,37,69,.10),0 8px 28px rgba(11,37,69,.08);padding:30px 34px 26px}
.cab{display:flex;align-items:center;justify-content:space-between;gap:18px}
.marca{display:flex;align-items:center;gap:12px;min-width:0}
.marca img{height:54px;width:auto;max-width:190px;object-fit:contain;flex-shrink:0}
.emp{display:flex;flex-direction:column;min-width:0}
.emp b{font-size:1.05rem;color:var(--c1);line-height:1.2;letter-spacing:.01em;overflow-wrap:anywhere}
.emp span{font-size:.78rem;color:var(--mut)}
.ref{text-align:right;font-size:.78rem;color:var(--mut);line-height:1.5;flex-shrink:0}
.ref b{display:block;color:var(--c1);font-size:.95rem;letter-spacing:.06em}
.reg{height:3px;background:var(--c1);margin:14px 0 0}
.reg2{height:2px;background:var(--ac);width:96px;margin:0 0 20px}
.eyebrow{margin:0 0 2px;font-size:.74rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--c2)}
h1{margin:0;font-size:1.65rem;line-height:1.2;color:var(--c1);letter-spacing:-.01em}
.cli{margin:4px 0 0;font-size:1.05rem;color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.resumo{display:grid;grid-template-columns:1.6fr 1fr;gap:0;margin:20px 0 6px;border:1px solid var(--ln);border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}
.selo{padding:16px 18px;border-left:6px solid var(--sc);background:var(--sb)}
.selo .tt{margin:0 0 3px;font-size:1.25rem;font-weight:800;line-height:1.2;color:var(--st)}
.selo .fr{margin:0;font-size:.92rem;color:#2A3547}
.num{display:grid;grid-template-columns:1fr;background:var(--wa);border-left:1px solid var(--ln)}
.num div{padding:9px 16px;border-bottom:1px solid var(--ln);display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.num div:last-child{border-bottom:0}
.num span{font-size:.74rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
.num b{font-size:1.1rem;color:var(--c1);text-align:right}
.sec{margin-top:24px}
h2{margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--ln);font-size:.82rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--c1);break-after:avoid;page-break-after:avoid}
h2:before{content:"";display:inline-block;width:18px;height:3px;background:var(--ac);margin-right:9px;vertical-align:middle}
h3{margin:14px 0 8px;font-size:.92rem;color:var(--c2);break-after:avoid;page-break-after:avoid}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:10px 22px;margin:0}
.kv>div{break-inside:avoid;page-break-inside:avoid}
.kv dt{font-size:.7rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--mut)}
.kv dd{margin:1px 0 0;font-size:.98rem;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.kv .w{grid-column:1 / -1}
.kv ul{margin:2px 0 0;padding:0;list-style:none}
.kv ul li{font-weight:600;font-size:.95rem;padding:2px 0}
.kv ul li small{font-weight:400;color:var(--mut)}
.chip{display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid;font-size:.74rem;font-weight:800;letter-spacing:.03em;line-height:1.5;white-space:nowrap}
.s-conforme,.p-ok{background:#E7F5EC;color:#14532D;border-color:#8BCB9F}
.s-atencao,.p-media{background:#FEF3D3;color:#7A4B00;border-color:#E5B54C}
.s-nao_conforme,.p-alta{background:#FDE7E7;color:#8B1A1A;border-color:#E49C9C}
.s-na,.s-vazio,.a-nao_executado{background:#EEF1F5;color:#475266;border-color:#C5CCD8}
.a-concluido{background:#E7F5EC;color:#14532D;border-color:#8BCB9F}
.a-parcial{background:#FEF3D3;color:#7A4B00;border-color:#E5B54C}
.selo.sc-conforme{--sc:#2E9E5B;--sb:#F1FAF4;--st:#14532D}
.selo.sc-atencao{--sc:#D99A1B;--sb:#FFF9E8;--st:#7A4B00}
.selo.sc-nao_conforme{--sc:#C93A3A;--sb:#FFF3F3;--st:#8B1A1A}
.lista{display:flex;flex-direction:column;gap:8px}
.it{border:1px solid var(--ln);border-radius:6px;padding:9px 13px;background:#fff;break-inside:avoid;page-break-inside:avoid}
.it .hd{display:flex;align-items:center;justify-content:space-between;gap:10px}
.it .hd b{font-size:.98rem;color:var(--ink)}
.it .tx{margin:7px 0 0;font-size:.9rem;color:#2A3547;white-space:pre-line;overflow-wrap:anywhere}
.it .tx i{display:block;font-style:normal;font-size:.68rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);margin-bottom:1px}
.it.pen{border-left:5px solid var(--sc)}
.it.pen.alta{--sc:#C93A3A}
.it.pen.media{--sc:#D99A1B}
.it .pr{margin:2px 0 0;font-size:.82rem;color:var(--mut)}
.vazio{margin:0;padding:11px 14px;border:1px dashed var(--ln);border-radius:6px;color:var(--mut);background:var(--wa);font-size:.92rem}
.gera{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.gera>div:not(.barra-g){border:1px solid var(--ln);border-radius:6px;padding:9px 13px;background:var(--wa);break-inside:avoid}
.gera span{display:block;font-size:.7rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--mut)}
.gera b{font-size:1.2rem;color:var(--c1)}
.gera small{font-size:.78rem;color:var(--mut);font-weight:400;margin-left:3px}
.gera .barra-g{grid-column:1 / -1;height:8px;border-radius:4px;background:#E3E8EF;overflow:hidden}
.barra-g i{display:block;height:100%;background:var(--c1)}
.par{margin:0;font-size:.95rem;white-space:pre-line;overflow-wrap:anywhere;color:#2A3547}
.concl{margin:0;padding:13px 16px;background:var(--c3);border-left:4px solid var(--c1);border-radius:0 6px 6px 0;font-size:.95rem;line-height:1.62;white-space:pre-line;color:#1B2433;break-inside:avoid}
.prox{margin:10px 0 0;font-size:.9rem;color:var(--mut)}
.prox b{color:var(--c1)}
.assin{display:grid;grid-template-columns:1fr 1fr;gap:28px;break-inside:avoid;page-break-inside:avoid}
.ass .area{height:92px;display:flex;align-items:flex-end;justify-content:center;border-bottom:1.5px solid #8A94A3}
.ass .area img{max-height:86px;max-width:100%;object-fit:contain}
.ass .nm{margin:6px 0 0;font-weight:700;font-size:.93rem;color:var(--ink);text-align:center;min-height:1.4em}
.ass .rg{margin:0;font-size:.78rem;color:var(--mut);text-align:center;min-height:1.2em}
.ass .cap{margin:3px 0 0;font-size:.7rem;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--mut);text-align:center}
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
figure{margin:0;border:1px solid var(--ln);border-radius:6px;overflow:hidden;background:#fff;break-inside:avoid;page-break-inside:avoid}
figure img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#E9EDF2}
figure figcaption{padding:5px 10px;font-size:.78rem;color:var(--mut)}
.grp{break-inside:auto}
.rod{margin-top:30px;padding-top:11px;border-top:1px solid var(--ln);font-size:.76rem;color:var(--mut);text-align:center}
@media (max-width:640px){
  html{font-size:15px}
  .folha{margin:0;border-radius:0;box-shadow:none;padding:20px 16px 22px}
  .cab{flex-direction:column;align-items:flex-start}
  .ref{text-align:left}
  .resumo{grid-template-columns:1fr}
  .num{border-left:0;border-top:1px solid var(--ln)}
  .kv{grid-template-columns:1fr}
  .gera{grid-template-columns:1fr}
  .assin{grid-template-columns:1fr}
  .grade{grid-template-columns:1fr}
  h1{font-size:1.4rem}
}
@page{size:A4;margin:14mm 13mm 17mm}
@media print{
  html{font-size:12.4px}
  body{background:#fff}
  .barra{display:none}
  .folha{max-width:none;margin:0;box-shadow:none;border-radius:0;padding:0}
  .grade{grid-template-columns:1fr 1fr}
  figure img{aspect-ratio:4/3}
  .rod{display:none}
  a{color:inherit;text-decoration:none}
}
`;

const chipItem = (status: string | null): string => {
  if (!status || !(status in STATUS_ITEM_RELATORIO)) return `<span class="chip s-vazio">Não avaliado</span>`;
  return `<span class="chip s-${status}">${esc(STATUS_ITEM_RELATORIO[status as keyof typeof STATUS_ITEM_RELATORIO])}</span>`;
};

const texto = (rotulo: string, v: string): string =>
  v.trim() ? `<div class="tx"><i>${esc(rotulo)}</i>${esc(v.trim())}</div>` : '';

const kv = (rotulo: string, valor: string, largo = false): string =>
  valor ? `<div${largo ? ' class="w"' : ''}><dt>${esc(rotulo)}</dt><dd>${valor}</dd></div>` : '';

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
  return corpo ? `<section class="sec"><h2>${esc(SECOES.identificacao)}</h2><dl class="kv">${corpo}</dl></section>` : '';
}

function secaoInspecao(d: Dados): string {
  const itens = CHECKLIST.map((c) => {
    const i = d.itens.find((x) => x.key === c.key)!;
    return `<div class="it"><div class="hd"><b>${esc(c.label)}</b>${chipItem(i.status)}</div>${texto('O que foi visto', i.visto)}${texto('Providência', i.providencia)}</div>`;
  }).join('');
  return `<section class="sec"><h2>${esc(SECOES.inspecao)}</h2><div class="lista">${itens}</div></section>`;
}

function secaoAtividades(d: Dados): string {
  const feitas = ATIVIDADES.map((a) => ({ a, v: d.atividades.find((x) => x.key === a.key)! })).filter((x) => x.v.feita);
  if (!feitas.length) return '';
  const itens = feitas.map(({ a, v }) =>
    `<div class="it"><div class="hd"><b>${esc(a.label)}</b><span class="chip a-${esc(v.status)}">${esc(STATUS_ATIV_LABEL[v.status] ?? v.status)}</span></div>${texto('Observação', v.obs)}</div>`).join('');
  return `<section class="sec"><h2>${esc(SECOES.atividades)}</h2><div class="lista">${itens}</div></section>`;
}

function secaoPendencias(d: Dados): string {
  const lista = pendencias(d.itens);
  const corpo = lista.length
    ? `<div class="lista">${lista.map((p) => {
      const pr = PRIORIDADE_LABEL[p.prioridade];
      return `<div class="it pen ${p.prioridade}"><div class="hd"><b>${esc(p.label)}</b><span class="chip p-${p.prioridade}">${esc(pr.titulo)}</span></div><p class="pr">${esc(pr.frase)}</p>${texto('O que foi visto', p.visto)}${texto('Providência', p.providencia)}</div>`;
    }).join('')}</div>`
    : `<p class="vazio">${esc(SECOES.pendencias_vazio)}</p>`;
  return `<section class="sec"><h2>${esc(SECOES.pendencias)}</h2>${corpo}</section>`;
}

function secaoGeracao(d: Dados): string {
  const { esperada_kwh: e, medida_kwh: m } = d.geracao;
  if (e == null || m == null) return '';
  const pct = e > 0 ? Math.round((m / e) * 100) : null;
  const largura = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return `<section class="sec"><h2>${esc(SECOES.geracao)}</h2><div class="gera">
    <div><span>Esperada</span><b>${esc(formatarNumero(e))}</b><small>kWh/mês</small></div>
    <div><span>Medida</span><b>${esc(formatarNumero(m))}</b><small>kWh/mês</small></div>
    ${pct != null ? `<div><span>Medida / esperada</span><b>${pct}%</b></div><div class="barra-g"><i style="width:${largura}%"></i></div>` : ''}
  </div></section>`;
}

function secaoTexto(titulo: string, v: string): string {
  return v.trim() ? `<section class="sec"><h2>${esc(titulo)}</h2><p class="par">${esc(v.trim())}</p></section>` : '';
}

function secaoAssinaturas(e: EntradaRelatorio, d: Dados): string {
  const t = e.assinaturas.tecnico, c = e.assinaturas.cliente;
  const bloco = (rotulo: string, a: { url: string | null; nome?: string; registro?: string } | undefined, nomePadrao: string, regPadrao: string) => `
    <div class="ass"><div class="area">${a?.url ? `<img src="${esc(a.url)}" alt="${esc(rotulo)}"/>` : ''}</div>
    <p class="nm">${esc((a?.nome || '').trim() || nomePadrao)}</p><p class="rg">${esc((a?.registro || '').trim() || regPadrao)}</p><p class="cap">${esc(rotulo)}</p></div>`;
  return `<section class="sec"><h2>${esc(SECOES.assinaturas)}</h2><div class="assin">
    ${bloco(SECOES.assinatura_tecnico, t, d.responsavel.nome.trim(), d.responsavel.registro.trim())}
    ${bloco(SECOES.assinatura_cliente, c, (e.linha.cliente_nome || '').trim(), '')}
  </div></section>`;
}

function secaoFotos(e: EntradaRelatorio): string {
  const ordem = ['antes', 'depois', ...CHECKLIST.map((c) => c.key)];
  let n = 0;
  const grupos = ordem.map((g) => {
    const lista = (e.fotos[g] ?? []).filter((f) => f.url);
    if (!lista.length) return '';
    const label = GRUPO_FOTO_LABEL[g] ?? g;
    const figs = lista.map((f) => {
      n++;
      return `<figure><a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="Foto ${n}: ${esc(label)}"/></a><figcaption>Foto ${n}, ${esc(label)}</figcaption></figure>`;
    }).join('');
    return `<div class="grp"><h3>${esc(label)}</h3><div class="grade">${figs}</div></div>`;
  }).join('');
  return grupos ? `<section class="sec"><h2>${esc(SECOES.fotos)}</h2>${grupos}</section>` : '';
}

export function htmlRelatorio(e: EntradaRelatorio): string {
  const d = normalizarDados((e.linha.dados ?? {}) as Partial<Dados>);
  const pal = paleta(e.empresa.cor_marca);
  const selo: Selo = calcularSelo(d.itens);
  const proxima = e.linha.proxima_visita || somarMeses(e.linha.data_inspecao, d.periodicidade_meses);
  const nomeEmpresa = String(e.empresa.nome_fantasia || e.empresa.nome || '').trim();
  const logo = logoSeguro(e.empresa.logo_base64);
  const cliente = (e.linha.cliente_nome || '').trim();
  const cod = codigoLegivel(e.linha.codigo);
  const nPend = pendencias(d.itens).length;
  const nAtiv = d.atividades.filter((a) => a.feita).length;
  const conclusao = (d.conclusao_manual ?? '').trim() || montarConclusao(d, selo, proxima);
  const resp = [d.responsavel.nome.trim(), d.responsavel.registro.trim()].filter(Boolean).join(', ');
  const titulo = `${SECOES.titulo}${cod ? ' ' + cod : ''}${cliente ? ' · ' + cliente : ''}`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(titulo)}</title>
<style>${CSS(pal)}</style>
</head><body>
<div class="barra"><span>${esc(SECOES.titulo)}</span><a href="/m/${esc(e.linha.id)}/pdf">Baixar PDF</a></div>
<main class="folha">
  <header class="cab">
    <div class="marca">${logo ? `<img src="${logo}" alt="${esc(nomeEmpresa)}"/>` : ''}<div class="emp"><b>${esc(nomeEmpresa)}</b>${e.empresa.cnpj ? `<span>CNPJ ${esc(e.empresa.cnpj)}</span>` : ''}</div></div>
    <div class="ref">${cod ? `<b>${esc(cod)}</b>` : ''}<span>Inspeção em ${esc(dataCurta(e.linha.data_inspecao))}</span>${resp ? `<br/><span>Responsável: ${esc(resp)}</span>` : ''}</div>
  </header>
  <div class="reg"></div><div class="reg2"></div>
  <p class="eyebrow">${esc(SECOES.titulo)}</p>
  <h1>Relatório de manutenção preventiva</h1>
  ${cliente ? `<p class="cli">${esc(cliente)}</p>` : ''}

  <div class="resumo">
    <div class="selo sc-${selo}"><p class="tt">${esc(SELOS[selo].titulo)}</p><p class="fr">${esc(SELOS[selo].frase)}</p></div>
    <div class="num">
      <div><span>Atividades</span><b>${nAtiv}</b></div>
      <div><span>Pendências</span><b>${nPend}</b></div>
      <div><span>${esc(SECOES.proxima_visita)}</span><b>${esc(dataCurta(proxima))}</b></div>
    </div>
  </div>

  ${secaoIdentificacao(d, cliente)}
  ${secaoInspecao(d)}
  ${secaoAtividades(d)}
  ${secaoPendencias(d)}
  ${secaoGeracao(d)}
  ${secaoTexto(SECOES.recomendacoes, d.recomendacoes)}
  ${secaoTexto(SECOES.observacoes_proxima, d.observacoes_proxima)}
  <section class="sec"><h2>${esc(SECOES.conclusao)}</h2><p class="concl">${esc(conclusao)}</p>
    <p class="prox"><b>${esc(SECOES.proxima_visita)}:</b> ${esc(dataPorExtenso(proxima))} &nbsp;|&nbsp; <b>${esc(SECOES.periodicidade)}:</b> ${esc(PERIODICIDADE_LABEL[d.periodicidade_meses])}</p>
  </section>
  ${secaoAssinaturas(e, d)}
  ${secaoFotos(e)}
  <footer class="rod">${esc(SECOES.rodape)}</footer>
</main>
</body></html>`;
}

/** Opções do page.pdf() — as mesmas na rota e no script da amostra: A4 em pé, margem pelo @page, rodapé com a página. */
export function opcoesPdf(codigo: string | null) {
  const cod = esc(codigoLegivel(codigo));
  return {
    format: 'A4' as const,
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      `<div style="width:100%;padding:0 13mm;font-family:Arial,Helvetica,sans-serif;font-size:7.5px;color:#6B7684;display:flex;justify-content:space-between;">` +
      `<span>${esc(SECOES.rodape)}${cod ? ' ' + cod : ''}</span>` +
      `<span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
  };
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
