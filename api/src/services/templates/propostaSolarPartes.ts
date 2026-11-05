// Partes do visual do modelo "1 Página" que o modelo Completo reaproveita: paleta, CSS base,
// cabeçalho, linhas da composição e rodapé (cards Vendedor e Empresa).
//
// Saíram do templateService.ts sem mudar um byte do HTML do modelo 1: o Completo é o MESMO
// visual em várias folhas, então os dois leem daqui e nunca divergem. Mexeu aqui? Rode os
// testes `proposta*` (o modelo 1 tem trechos fixos conferidos).
import {
  derivePalette, pEsc, pTel, pCnpj, pFlagOn, qrSvg, str, type Palette,
} from '../propostaSolarBase';
import type { InversorProposta } from '../inversoresProposta';
import { totalKwInversores } from '../inversoresProposta';

export interface CompanyProposta {
  nome: string;
  cnpj: string;
  nome_fantasia?: string;
  endereco?: string;
  socio_adm?: string;
  cor_marca?: string;
  cor_secundaria?: string;
  logo_base64?: string;
  whatsapp?: string;
  email?: string;
}

export interface Cores {
  p: Palette;
  accent: string;
  accentText: string;
}

/** Cores do modelo 1: principal = cor_marca (derivePalette); acento = cor_secundaria (fallback âmbar). */
export function coresModelo1(company: CompanyProposta): Cores {
  const p: Palette = derivePalette(String(company.cor_marca || ''), 'Empresa');
  const secRaw = String(company.cor_secundaria || '').trim();
  const accent = /^#?[0-9a-fA-F]{6}$/.test(secRaw) ? (secRaw.startsWith('#') ? secRaw : '#' + secRaw) : '#F7B500';
  const accentLum = (() => { const m = /^#([0-9a-fA-F]{6})$/.exec(accent); if (!m) return 1; const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; })();
  const accentText = accentLum < 0.5 ? '#ffffff' : p.c1;
  return { p, accent, accentText };
}

export function cssRaizModelo1(c: Cores): string {
  return `:root{ --c1:${c.p.c1}; --c2:${c.p.c2}; --c3:${c.p.c3}; --accent:${c.accent}; --accent-text:${c.accentText}; --ink:#161A22; --muted:#5C6470; --row:#F2F4F8; --line:#E4E8F0; }`;
}

/** CSS base do modelo 1 (tudo depois do :root, até o rodapé). */
export const CSS_MODELO1 = `@page{ size:A4; margin:0; }
*,*::before,*::after{ box-sizing:border-box; margin:0; padding:0; }
html,body{ font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif; color:var(--ink); background:#EEF1F5; -webkit-font-smoothing:antialiased; }
.num{ font-variant-numeric:tabular-nums; }
.page{ width:794px; min-height:1123px; margin:0 auto; background:#fff; display:flex; flex-direction:column; }
/* Cabeçalho */
.head{ display:grid; grid-template-columns:1fr 1fr; }
.brand{ padding:20px 24px; display:flex; flex-direction:row; align-items:center; gap:16px; }
.brand img{ width:110px; height:110px; object-fit:contain; flex-shrink:0; }
.brand .mk{ font-size:27px; font-weight:900; letter-spacing:-.6px; color:var(--c1); line-height:1.02; }
.brand .mk small{ display:block; font-size:9.5px; font-weight:700; letter-spacing:3px; color:var(--muted); margin-top:6px; }
.ficha{ background:var(--c1); color:#fff; padding:20px 24px; display:flex; flex-direction:column; gap:8px; }
.ficha .t{ font-size:12px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; opacity:.85; }
.ficha .rowf{ display:flex; justify-content:space-between; gap:12px; font-size:12px; border-bottom:1px solid rgba(255,255,255,.16); padding-bottom:6px; }
.ficha .rowf span:first-child{ opacity:.7; font-weight:600; }
.ficha .valid{ margin-top:2px; font-size:10.5px; font-weight:800; color:var(--accent-text); background:var(--accent); align-self:flex-start; padding:4px 10px; border-radius:999px; letter-spacing:.3px; }
/* Faixa de seção — barra amarela com o título na cor da marca (estilo da referência) */
.band{ display:flex; align-items:center; background:var(--accent); margin-top:2px; }
.band .tab{ color:var(--accent-text); font-size:12.5px; font-weight:800; letter-spacing:1.3px; text-transform:uppercase; padding:9px 20px; }
.band .bar{ flex:1; }
.sec{ padding:13px 26px 4px; }
.tiles{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:12px; }
.tile{ border:1px solid var(--line); border-bottom:3px solid var(--c1); border-radius:12px; padding:11px 13px; }
.tile .k{ font-size:10px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:var(--muted); }
.tile .v{ font-size:22px; font-weight:900; color:var(--c1); line-height:1.1; margin-top:3px; }
.tile .v u{ font-size:12px; font-weight:700; color:var(--muted); text-decoration:none; margin-left:2px; }
.rows{ display:flex; flex-direction:column; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.r{ display:flex; justify-content:space-between; gap:16px; padding:8px 14px; font-size:12px; align-items:center; }
.r:nth-child(odd){ background:var(--row); }
.r .lab{ color:#39404C; font-weight:600; }
.r .val{ font-weight:800; }
.r .inc{ color:#127A3E; font-weight:800; font-size:10.5px; letter-spacing:.4px; text-transform:uppercase; }
.mkq{ display:inline-block; font-style:normal; font-size:10px; font-weight:800; letter-spacing:.3px; color:var(--c1); background:var(--c3); padding:1px 7px; border-radius:6px; margin-left:8px; vertical-align:middle; }
/* Financeiro */
.fin{ padding:13px 26px 6px; }
.hero{ display:grid; grid-template-columns:1.25fr 1fr; gap:12px; margin-bottom:11px; }
.heroL{ background:linear-gradient(135deg,var(--c1),var(--c2)); color:#fff; border-radius:14px; padding:16px 18px; }
.heroL .k{ font-size:10.5px; font-weight:700; letter-spacing:.8px; text-transform:uppercase; opacity:.85; }
.heroL .v{ font-size:32px; font-weight:900; line-height:1.05; margin-top:3px; }
.heroL .s{ font-size:11px; opacity:.8; margin-top:3px; }
.heroR{ background:var(--accent); border-radius:14px; padding:16px 18px; display:flex; flex-direction:column; justify-content:center; }
.heroR .k{ font-size:10.5px; font-weight:800; letter-spacing:.8px; text-transform:uppercase; color:var(--accent-text); opacity:.8; }
.heroR .v{ font-size:27px; font-weight:900; line-height:1.05; margin-top:2px; color:var(--accent-text); }
.heroR .s{ font-size:11.5px; font-weight:800; margin-top:3px; color:var(--accent-text); opacity:.9; }
.finGrid{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.fc{ border:1px solid var(--line); border-radius:12px; padding:10px 13px; }
.fc .k{ font-size:10px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:var(--muted); }
.fc .v{ font-size:17px; font-weight:900; color:var(--c1); margin-top:3px; }
/* Rodapé */
.foot{ margin-top:auto; background:var(--c1); color:#fff; padding:16px 26px 20px; }
.foot .pg{ font-size:11px; font-weight:800; letter-spacing:1.3px; text-transform:uppercase; opacity:.85; margin-bottom:11px; }
.cols{ display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.card{ background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.14); border-radius:12px; padding:12px 15px; }
.card h4{ margin:0 0 8px; font-size:10.5px; font-weight:800; letter-spacing:1px; text-transform:uppercase; opacity:.9; }
.card .l{ display:flex; justify-content:space-between; gap:10px; font-size:11.5px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,.10); }
.card .l:last-child{ border-bottom:none; }
.card .l span:first-child{ opacity:.65; font-weight:600; }
.card .l span:last-child{ font-weight:700; text-align:right; }
.qr{ display:flex; align-items:center; gap:9px; margin-top:10px; }
.qrbox{ width:54px; height:54px; background:#fff; border-radius:6px; padding:3px; flex-shrink:0; }
.qrbox svg{ width:100%; height:100%; display:block; }
.qr span{ font-size:9.5px; line-height:1.3; opacity:.7; }`;

/** Dados de contato do rodapé: o que o consultor editou no form vence o cadastro da empresa. */
export interface DadosContato {
  mostraVendNome: boolean;
  vendedor: string;
  vendWhats: string;
  vendEmail: string;
  cnpjDoc: string;
  logo: string;
  displayNome: string;
}

export function dadosContato(company: CompanyProposta, f: Record<string, unknown>): DadosContato {
  // Rodapé: nome do vendedor, contato e CNPJ vêm fixos do cadastro, mas o form
  // manda o que o consultor editou — e cada linha tem um desmarcar próprio.
  const mostraVendNome = pFlagOn(f.mostrar_vendedor_nome);
  const mostraVendTel = pFlagOn(f.mostrar_vendedor_contato);
  const vendedorForm = str(f.vendedor_nome) === '___' ? '' : String(f.vendedor_nome).trim();
  const vendedor = mostraVendNome ? (vendedorForm || String(company.socio_adm || company.nome || '').trim()) : '';
  const vendWhats = mostraVendTel
    ? ((str(f.vendedor_whatsapp) === '___' ? '' : String(f.vendedor_whatsapp)).replace(/\D/g, '') || String(company.whatsapp || '').replace(/\D/g, ''))
    : '';
  const vendEmail = String(f.vendedor_email || '').trim() || String(company.email || '').trim();
  const cnpjForm = str(f.empresa_cnpj) === '___' ? '' : String(f.empresa_cnpj).trim();
  const cnpjDoc = pFlagOn(f.mostrar_cnpj) ? (cnpjForm || String(company.cnpj || '').trim()) : '';
  const logo = String(company.logo_base64 || '').trim();
  // Nome exibido = nome fantasia (marca) se houver; senão a razão social.
  const displayNome = String(company.nome_fantasia || company.nome || '').trim();
  return { mostraVendNome, vendedor, vendWhats, vendEmail, cnpjDoc, logo, displayNome };
}

export function cabecalhoModelo1(a: { logo: string; displayNome: string; hoje: string; clienteNome: string; enderecoCli: string; validadeCurto: string }): string {
  return `<div class="head">
    <div class="brand">
      ${a.logo ? `<img src="${a.logo}" alt="${pEsc(a.displayNome)}"/>` : ''}
      <div class="mk">${pEsc(a.displayNome || 'Sua Marca')}<small>ENERGIA SOLAR</small></div>
    </div>
    <div class="ficha">
      <div class="t">Proposta Comercial</div>
      <div class="rowf"><span>Data</span><span class="num">${a.hoje}</span></div>
      <div class="rowf"><span>Cliente</span><span>${pEsc(a.clienteNome || '—')}</span></div>
      ${a.enderecoCli ? `<div class="rowf end"><span>Endereço</span><span>${pEsc(a.enderecoCli)}</span></div>` : ''}
      <div class="valid">${pEsc(a.validadeCurto.toUpperCase())}</div>
    </div>
  </div>`;
}

export function linhaMk(label: string, marca: string, right: string): string {
  return `<div class="r"><span class="lab">${pEsc(label)}${marca ? ` <em class="mkq">${pEsc(marca)}</em>` : ''}</span><span class="inc">${pEsc(right)}</span></div>`;
}

export function marcaInversor(i: InversorProposta): string {
  return [i.marca, i.potenciaTxt ? `${i.potenciaTxt} kW` : ''].filter(Boolean).join(' · ');
}

/** Uma linha por inversor. Com mais de um, entra também a potência total (soma de qtd x kW). */
export function linhasInversoresHtml(invLista: InversorProposta[]): string {
  const totalKwInv = totalKwInversores(invLista);
  return [
    ...invLista.map((i) => linhaMk('Inversor', marcaInversor(i), `Incluído · ${i.qtd} un`)),
    ...(invLista.length > 1 && totalKwInv > 0
      ? [linhaMk('Potência total dos inversores', '', `${totalKwInv.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} kW`)]
      : []),
  ].join('\n      ');
}

/** Rodapé grande: card Vendedor (com QR do WhatsApp) e card Empresa. */
export function rodapeModelo1(company: CompanyProposta, d: DadosContato, titulo: string): string {
  // Desmarcar nome E contato tira o card inteiro — um card só com o título
  // "Vendedor" e nada dentro parece documento quebrado. Aí a Empresa ocupa a
  // largura toda em vez de deixar meio rodapé vazio.
  const cardVendedor = (d.mostraVendNome || d.vendWhats || d.vendEmail)
    ? `<div class="card">
        <h4>Vendedor</h4>
        ${d.mostraVendNome ? `<div class="l"><span>Nome</span><span>${pEsc(d.vendedor || '—')}</span></div>` : ''}
        ${d.vendEmail ? `<div class="l"><span>E-mail</span><span>${pEsc(d.vendEmail)}</span></div>` : ''}
        ${d.vendWhats ? `<div class="l"><span>Contato</span><span class="num">${pEsc(pTel(d.vendWhats))}</span></div>` : ''}
        ${d.vendWhats ? `<div class="qr"><div class="qrbox">${qrSvg('https://wa.me/' + (d.vendWhats.startsWith('55') ? d.vendWhats : '55' + d.vendWhats))}</div><span>Aponte a câmera<br/>e fale no WhatsApp</span></div>` : ''}
      </div>`
    : '';
  return `<div class="foot">
    <div class="pg">${titulo}</div>
    <div class="cols"${cardVendedor ? '' : ' style="grid-template-columns:1fr"'}>
      ${cardVendedor}
      <div class="card">
        <h4>Empresa</h4>
        <div class="l"><span>Nome</span><span>${pEsc(d.displayNome || '—')}</span></div>
        ${d.cnpjDoc ? `<div class="l"><span>CNPJ</span><span class="num">${pEsc(pCnpj(d.cnpjDoc))}</span></div>` : ''}
        ${company.endereco ? `<div class="l"><span>Endereço</span><span>${pEsc(company.endereco)}</span></div>` : ''}
        ${company.whatsapp ? `<div class="l"><span>Contato</span><span class="num">${pEsc(pTel(String(company.whatsapp)))}</span></div>` : ''}
        ${company.email ? `<div class="l"><span>E-mail</span><span>${pEsc(String(company.email))}</span></div>` : ''}
      </div>
    </div>
  </div>`;
}

function brlP(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export interface AnaliseModelo1 {
  economia25: number;
  investimento: number;
  parcelaLabel: string;
  economiaMensal: number;
  taxaMinima: number;
  cip: number;
  paybackTexto: string;
  /** Só o Completo usa: sem consumo não há economia nem retorno para mostrar. */
  semEconomia?: boolean;
  semConsumo?: boolean;
  /** Só o Completo: frases começam com maiúscula. O modelo 1 segue como sempre foi. */
  capitalizar?: boolean;
}

/** Faixa "Análise Financeira" do modelo 1: destaque (economia em 25 anos e investimento) + grade de 3 cartões. */
export function analiseModelo1(a: AnaliseModelo1): string {
  const brl = brlP;
  return `<div class="band"><div class="tab">Análise Financeira</div><div class="bar"></div></div>
  <div class="fin">
    <div class="hero"${a.semEconomia ? ' style="grid-template-columns:1fr"' : ''}>
      ${a.semEconomia ? '' : `<div class="heroL"><div class="k">Economia em 25 anos</div><div class="v num">${brl(a.economia25)}</div><div class="s">${a.capitalizar ? 'Com o' : 'com o'} sistema quitado gerando energia própria</div></div>
      `}<div class="heroR"><div class="k">Investimento</div><div class="v num">${brl(a.investimento)}</div>${a.parcelaLabel ? `<div class="s num">${pEsc(a.parcelaLabel)}</div>` : ''}</div>
    </div>
    <div class="finGrid"${a.semConsumo ? ' style="grid-template-columns:1fr"' : ''}>
      ${a.semConsumo ? '' : `<div class="fc"><div class="k">Economia mensal</div><div class="v num">${brl(a.economiaMensal)}</div></div>
      `}<div class="fc"><div class="k">Conta após instalação</div><div class="v num">${brl(a.taxaMinima + a.cip)}</div>${a.cip > 0 ? `<div style="font-size:10px;color:var(--muted);margin-top:2px">${pEsc(`Taxa mínima + iluminação pública ${brl(a.cip)}`)}</div>` : ''}</div>
      ${a.semConsumo ? '' : `<div class="fc"><div class="k">Tempo de retorno</div><div class="v num">${a.paybackTexto}</div></div>`}
    </div>
  </div>`;
}
