/**
 * PROPOSTA OFF-GRID — documento do cliente final (A4, 2 páginas).
 *
 * REGRA DURA: este template NÃO calcula nada. Todos os números chegam prontos
 * do motor em dashboard/src/lib/offgrid/engine.ts. Se recalculasse aqui com
 * constantes próprias, o PDF diria uma autonomia e a tela do integrador diria
 * outra — exatamente em cima da pergunta que o cliente mais faz.
 *
 * REGRA COMERCIAL: custo de fornecimento, frete e margem do integrador NÃO
 * existem neste arquivo. O cliente vê um preço só.
 *
 * Página 1 — o sistema e o preço.
 * Página 2 — "quanto tempo aguenta sem sol", que é a página que fecha a venda.
 */

interface Company {
  nome: string;
  cnpj: string;
  cidade?: string;
  uf?: string;
  socio_adm?: string;
}

interface Client {
  nome: string;
  cidade?: string;
  uf?: string;
  telefone?: string;
}

// ── Helpers locais (autocontidos de propósito: sem import circular) ──────────
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}
function n(v: unknown, def = 0): number {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return isFinite(x) ? x : def;
}
function brl(v: unknown): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n(v));
}
function dec(v: unknown, casas = 1): string {
  return n(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
}
/** R$/kWh com centavos — o número que compara energia com energia. */
function brl2ceil(v: unknown): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n(v));
}
function tel(s: unknown): string {
  const d = String(s ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(s ?? '');
}
function cnpjFmt(s: unknown): string {
  const d = String(s ?? '').replace(/\D/g, '');
  if (d.length !== 14) return String(s ?? '').trim();
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Dias fracionados viram linguagem de gente: 2,46 → "2 dias e 11 horas". */
function tempo(dias: number): string {
  if (!isFinite(dias) || dias <= 0) return '—';
  if (dias < 1) return `${Math.round(dias * 24)} horas`;
  const d = Math.floor(dias);
  const h = Math.round((dias - d) * 24);
  const base = `${d} ${d === 1 ? 'dia' : 'dias'}`;
  return h > 0 ? `${base} e ${h}h` : base;
}

/** Cor da empresa → par de tons com contraste garantido pra texto branco. */
function paleta(hexRaw: string): { c1: string; c2: string; c3: string } {
  const hex = String(hexRaw || '').trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(hex)) return { c1: '#0F3D2E', c2: '#166848', c3: '#ECFDF5' };
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const lum = () => {
    const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  let guard = 0;
  while (lum() > 0.18 && guard < 40) { r *= 0.9; g *= 0.9; b *= 0.9; guard++; }
  const hx = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  const mix = (a: number, t: number) => a + (255 - a) * t;
  return {
    c1: `#${hx(r)}${hx(g)}${hx(b)}`,
    c2: `#${hx(mix(r, 0.22))}${hx(mix(g, 0.22))}${hx(mix(b, 0.22))}`,
    c3: `#${hx(mix(r, 0.93))}${hx(mix(g, 0.93))}${hx(mix(b, 0.93))}`,
  };
}

interface ItemCliente { nome: string; qtd: number; garantia?: number }

// ─────────────────────────────────────────────────────────────────────────────

interface OpcaoComp {
  id: string; nome: string; entrada: number; mensal: number; total: number;
  porKwh: number; linhas: { rotulo: string; valor: number }[]; observacao: string;
}

export function propostaOffGrid(
  company: Company,
  client: Client,
  f: Record<string, unknown>,
  out?: { resumo?: string },
): string {
  const p = paleta(String((company as { cor_marca?: string }).cor_marca || ''));
  const logo = String((company as { logo_base64?: string }).logo_base64 || '').trim();
  const marca = String((company as { nome_fantasia?: string }).nome_fantasia || company.nome || '').trim();
  const whats = String((company as { whatsapp?: string }).whatsapp || '').replace(/\D/g, '');
  const vendedor = String(company.socio_adm || '').trim();

  const cidade = String(f.cidade || client.cidade || '').trim();
  const uf = String(f.uf || client.uf || '').trim().toUpperCase();
  const local = [cidade, uf].filter(Boolean).join(' · ');

  // ── Números que vieram prontos do motor ──
  const kwp = n(f.kwp);
  const qtdModulos = Math.round(n(f.qtd_modulos));
  const areaM2 = n(f.area_m2);
  const bancoKwh = n(f.banco_kwh);
  const bancoUtil = n(f.banco_utilizavel);
  const bancoReserva = n(f.banco_reserva);
  const qtdBaterias = Math.round(n(f.qtd_baterias));
  const inversorKw = n(f.inversor_kw);
  const inversorSaida = String(f.inversor_saida || '');
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
  const ciclosDia = n(f.ciclos_dia);

  const investimento = n(f.investimento);
  const prazoEntrega = String(f.prazo_entrega || '');

  const itens: ItemCliente[] = Array.isArray(f.itens_cliente) ? (f.itens_cliente as ItemCliente[]) : [];

  // Arranjo elétrico
  const arrSerie = Math.round(n(f.arranjo_serie));
  const arrParalelo = Math.round(n(f.arranjo_paralelo));
  const arrVocFrio = n(f.arranjo_voc_frio);
  const arrVmpQuente = n(f.arranjo_vmp_quente);
  const arrCorrente = n(f.arranjo_corrente);
  // Arranjo que NAO fechou na janela do MPPT nao vira ficha impressa: o
  // integrador liga por ela, e tensao errada em CC queima equipamento.
  const arrOk = f.arranjo_ok !== false;

  // Pagamento e comparativo — chegam prontos do motor.
  const parcelaCartao = String(f.parcela_cartao || '').trim();
  const parcelaFin = String(f.parcela_financiamento || '').trim();
  const compAnos = Math.round(n(f.comp_anos, 10));
  const compOpcoes: OpcaoComp[] = Array.isArray(f.comp_opcoes) ? (f.comp_opcoes as OpcaoComp[]) : [];
  const compEconomiaRede = n(f.comp_economia_rede);
  const compEconomiaDiesel = n(f.comp_economia_diesel);
  const compEquilibrio = Math.round(n(f.comp_equilibrio_m));
  const compVenceNaPorta = f.comp_vence_na_porta === true;
  const compPaybackDiesel = Math.round(n(f.comp_payback_diesel));
  const compDistancia = Math.round(n(f.comp_distancia_m));
  // Destaque é de quem ganha a conta, não da opção que estamos vendendo.
  const compVencedor = String(f.comp_vencedor || 'offgrid');
  const temComparativo = compOpcoes.length >= 2;

  // Validade vem do form (o integrador escolhe). Fica em 7 dias quando não vier —
  // mesmo padrão da proposta on-grid.
  const validadeDias = Math.max(1, Math.min(180, Math.round(n(f.validade_dias, 7))));
  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const validade = new Date(Date.now() + validadeDias * 86400000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  // Resumo pro WhatsApp: os MESMOS números do PDF, no formato que o vendedor
  // cola na conversa. O controller devolve isto como `resumo_whatsapp`.
  if (out) {
    out.resumo = [
      `*Sistema off-grid — ${client.nome}*`,
      ``,
      `Geração: ${dec(kwp, 2)} kWp (${qtdModulos} módulos)`,
      `Bateria: ${dec(bancoKwh, 2)} kWh de lítio (${dec(bancoUtil, 2)} kWh utilizáveis)`,
      `Inversor: ${dec(inversorKw, 1)} kW ${inversorSaida}`,
      ``,
      `*Aguenta ${tempo(autEss)} sem sol nenhum* com o essencial ligado`,
      `Com a casa inteira: ${tempo(autTudo)}`,
      `Chovendo o dia todo: ${chuvaInfinita ? 'o essencial se mantém' : tempo(autChuva)}`,
      ``,
      `Investimento: ${brl(investimento)}`,
      parcelaFin ? parcelaFin : '',
      parcelaCartao ? parcelaCartao : '',
      prazoEntrega ? `Entrega em ${prazoEntrega}` : '',
      `Proposta válida até ${validade}`,
    ].filter(Boolean).join('\n');
  }

  const totalPaginas = temComparativo ? 3 : 2;

  const linhaItem = (i: ItemCliente) =>
    `<div class="it"><span class="q">${i.qtd}×</span><span class="nm">${esc(i.nome)}</span>${
      i.garantia ? `<span class="gr">${i.garantia} anos de garantia</span>` : '<span class="gr"></span>'
    }</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=794, user-scalable=yes"/>
<title>Sistema Off-Grid — ${esc(client.nome)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{ --c1:${p.c1}; --c2:${p.c2}; --c3:${p.c3}; --ink:#161A22; --muted:#5C6470; --line:#E4E8F0; --row:#F5F7FA; }
@page{ size:A4; margin:0; }
*{ box-sizing:border-box; margin:0; padding:0; }
body{ font-family:'Inter',system-ui,sans-serif; color:var(--ink); background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
.pg{ width:794px; min-height:1123px; padding:38px 44px 96px; position:relative; page-break-after:always; }
.pg:last-child{ page-break-after:auto; }

/* ── Cabeçalho ── */
.top{ display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding-bottom:14px; border-bottom:3px solid var(--c1); }
.brand{ display:flex; align-items:center; gap:12px; }
.brand img{ max-height:46px; max-width:150px; object-fit:contain; }
.brand .bn{ font-size:17px; font-weight:900; letter-spacing:-0.02em; color:var(--c1); }
.brand .bc{ font-size:10px; color:var(--muted); margin-top:2px; }
.top .meta{ text-align:right; font-size:10px; color:var(--muted); line-height:1.6; }
.top .meta strong{ display:block; font-size:12px; color:var(--ink); }

/* ── Título ── */
.hero{ margin:22px 0 18px; }
.hero .kicker{ font-size:10.5px; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; color:var(--c2); }
.hero h1{ font-size:26px; font-weight:900; letter-spacing:-0.03em; line-height:1.15; margin-top:6px; }
.hero p{ font-size:12.5px; color:var(--muted); line-height:1.6; margin-top:8px; max-width:600px; }

/* ── Cliente ── */
.cli{ display:flex; gap:0; background:var(--row); border-radius:10px; overflow:hidden; margin-bottom:18px; }
.cli div{ flex:1; padding:11px 14px; border-right:1px solid #fff; }
.cli div:last-child{ border-right:none; }
.cli span{ display:block; font-size:9px; font-weight:800; letter-spacing:0.07em; text-transform:uppercase; color:var(--muted); }
.cli strong{ font-size:12.5px; font-weight:700; }

/* ── Destaques ── */
.big{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:18px; }
.big .b{ background:var(--c3); border:1px solid var(--line); border-radius:10px; padding:12px 10px; text-align:center; }
.big .b em{ display:block; font-style:normal; font-size:21px; font-weight:900; color:var(--c1); letter-spacing:-0.02em; line-height:1.1; }
.big .b span{ display:block; font-size:9.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-top:5px; }

/* ── Seções ── */
h2{ font-size:12px; font-weight:900; text-transform:uppercase; letter-spacing:0.09em; color:var(--c1); margin:0 0 10px; padding-bottom:6px; border-bottom:1px solid var(--line); }
.sec{ margin-bottom:18px; }

/* ── Itens ── */
.it{ display:grid; grid-template-columns:34px 1fr 130px; align-items:center; gap:8px; padding:7px 10px; font-size:11.5px; border-radius:6px; }
.it:nth-child(odd){ background:var(--row); }
.it .q{ font-weight:900; color:var(--c1); }
.it .nm{ font-weight:600; line-height:1.35; }
.it .gr{ font-size:9.5px; font-weight:700; color:var(--muted); text-align:right; }

/* ── Ficha técnica ── */
.tec{ display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }
.tec div{ background:var(--row); border-radius:7px; padding:9px 11px; }
.tec span{ display:block; font-size:9px; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; color:var(--muted); }
.tec strong{ font-size:12px; font-weight:800; }

/* ── Investimento ── */
.inv{ background:linear-gradient(135deg,var(--c1),var(--c2)); border-radius:12px; padding:18px 22px; color:#fff; display:flex; justify-content:space-between; align-items:center; gap:16px; }
.inv .lb{ font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; opacity:0.85; }
.inv .vl{ font-size:31px; font-weight:900; letter-spacing:-0.03em; line-height:1.1; margin-top:2px; }
.inv .sub{ font-size:10px; opacity:0.85; margin-top:5px; line-height:1.5; }
.inv .right{ text-align:right; font-size:10px; line-height:1.7; opacity:0.9; }

/* ── Página 2: autonomia ── */
.aut-hero{ background:#161A22; border-radius:12px; padding:22px 24px; color:#fff; margin-bottom:18px; }
.aut-hero .k{ font-size:10px; font-weight:800; letter-spacing:0.1em; text-transform:uppercase; color:#8A93A0; }
.aut-hero .v{ display:flex; align-items:baseline; gap:10px; margin-top:8px; }
.aut-hero .v em{ font-style:normal; font-size:42px; font-weight:900; letter-spacing:-0.03em; color:#fff; line-height:1; }
.aut-hero .v span{ font-size:13px; font-weight:700; color:#C7CDD6; }
.aut-hero p{ font-size:11.5px; color:#A8B1BD; line-height:1.6; margin-top:10px; }

.cen{ display:grid; grid-template-columns:1fr 120px; gap:10px; align-items:center; padding:12px 14px; border:1px solid var(--line); border-radius:9px; margin-bottom:7px; }
.cen h3{ font-size:12.5px; font-weight:800; }
.cen p{ font-size:10.5px; color:var(--muted); line-height:1.5; margin-top:3px; }
.cen .val{ text-align:right; font-size:16px; font-weight:900; color:var(--c1); letter-spacing:-0.02em; }

.nota{ background:var(--c3); border-left:3px solid var(--c1); border-radius:0 8px 8px 0; padding:12px 14px; font-size:11px; line-height:1.65; color:var(--ink); }
.nota strong{ font-weight:800; }

.dupla{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }

/* ── Página 3: comparativo ── */
.opc{ border:1px solid var(--line); border-radius:10px; padding:13px 15px; margin-bottom:9px; }
.opc-win{ border-color:var(--c1); border-width:2px; background:var(--c3); }
.opc-h{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
.opc-h h3{ font-size:13px; font-weight:800; line-height:1.3; }
.opc-total{ text-align:right; font-size:19px; font-weight:900; letter-spacing:-0.02em; white-space:nowrap; line-height:1.1; }
.opc-win .opc-total{ color:var(--c1); }
.opc-total em{ display:block; font-style:normal; font-size:9px; font-weight:700; color:var(--muted); letter-spacing:0; margin-top:2px; }
.opc-linhas{ margin-top:9px; }
.opc-linhas div{ display:flex; justify-content:space-between; gap:10px; font-size:10.5px; padding:2px 0; color:var(--muted); }
.opc-linhas b{ font-weight:700; color:var(--ink); }
.opc-pk{ margin-top:8px; padding-top:7px; border-top:1px solid var(--line); font-size:10.5px; color:var(--muted); }
.opc-pk strong{ color:var(--ink); font-weight:800; }
.opc-obs{ font-size:9.5px; color:var(--muted); line-height:1.5; margin-top:6px; }

/* ── Rodapé ── */
.rod{ position:absolute; left:44px; right:44px; bottom:26px; padding-top:12px; border-top:1px solid var(--line); display:flex; justify-content:space-between; align-items:flex-end; gap:14px; }
.rod .e{ font-size:9.5px; color:var(--muted); line-height:1.6; }
.rod .e strong{ display:block; font-size:11.5px; color:var(--ink); font-weight:800; }
.rod .pg-n{ font-size:9px; font-weight:800; color:var(--muted); letter-spacing:0.08em; }
</style></head>
<body>

<!-- ══════════════ PÁGINA 1 ══════════════ -->
<div class="pg">
  <div class="top">
    <div class="brand">
      ${logo ? `<img src="${esc(logo)}" alt=""/>` : ''}
      <div>
        <div class="bn">${esc(marca)}</div>
        ${company.cnpj ? `<div class="bc">CNPJ ${esc(cnpjFmt(company.cnpj))}</div>` : ''}
      </div>
    </div>
    <div class="meta">
      <strong>Proposta de sistema off-grid</strong>
      Emitida em ${hoje}<br/>Válida até ${validade}
    </div>
  </div>

  <div class="hero">
    <div class="kicker">Energia própria, sem depender da rede</div>
    <h1>Um sistema que gera, guarda e entrega energia<br/>${diasPedidos > 1 ? `por ${diasPedidos} dias seguidos sem sol` : 'mesmo quando o sol não aparece'}</h1>
    <p>
      Off-grid é diferente do sistema comum ligado na rua: aqui a energia que sobra do dia fica guardada
      em bateria pra ser usada à noite e nos dias fechados. Esta proposta mostra exatamente quanto tempo
      o seu sistema aguenta — com número, não com promessa.
    </p>
  </div>

  <div class="cli">
    <div><span>Cliente</span><strong>${esc(client.nome)}</strong></div>
    ${local ? `<div><span>Local da instalação</span><strong>${esc(local)}</strong></div>` : ''}
    <div><span>Consumo previsto</span><strong>${dec(consumoDia, 1)} kWh por dia · ${consumoMes} kWh/mês</strong></div>
  </div>

  <div class="big">
    <div class="b"><em>${dec(kwp, 2)} kWp</em><span>Geração solar</span></div>
    <div class="b"><em>${dec(bancoKwh, 2)} kWh</em><span>Bateria de lítio</span></div>
    <div class="b"><em>${dec(inversorKw, 1)} kW</em><span>Inversor ${esc(inversorSaida)}</span></div>
    <div class="b"><em>${autEss >= 1 ? Math.floor(autEss) : Math.round(autEss * 24)}</em><span>${
      autEss >= 2 ? 'dias sem sol' : autEss >= 1 ? 'dia sem sol' : 'horas sem sol'
    }</span></div>
  </div>

  <div class="sec">
    <h2>O que está incluso</h2>
    ${itens.map(linhaItem).join('')}
  </div>

  <div class="sec">
    <h2>Ficha técnica</h2>
    <div class="tec">
      <div><span>Arranjo solar</span><strong>${qtdModulos} módulos · ${dec(kwp, 2)} kWp</strong></div>
      <div><span>Área de telhado</span><strong>${dec(areaM2, 1)} m²</strong></div>
      <div><span>Banco de baterias</span><strong>${qtdBaterias}× · ${dec(bancoKwh, 2)} kWh · ${tensao}V</strong></div>
      <div><span>Energia utilizável</span><strong>${dec(bancoUtil, 2)} kWh por ciclo</strong></div>
      <div><span>Inversor</span><strong>${dec(inversorKw, 1)} kW · ${esc(inversorSaida)}</strong></div>
      <div><span>Sol na região</span><strong>${dec(hspAnual, 2)} h/dia (média)</strong></div>
      <div><span>Geração no mês pior</span><strong>${dec(geracaoDiaPior, 1)} kWh/dia</strong></div>
      <div><span>Geração média</span><strong>${geracaoMes} kWh/mês</strong></div>
      <div><span>Química da bateria</span><strong>LiFePO4 · 6.000 ciclos</strong></div>
      ${ciclosDia > 0 ? `<div><span>Uso do banco por dia</span><strong>${Math.round(ciclosDia * 100)}% de um ciclo</strong></div>` : ''}
    </div>
  </div>

  <div class="sec">
    <h2>Investimento</h2>
    <div class="inv">
      <div>
        <div class="lb">Sistema completo, instalado</div>
        <div class="vl">${brl(investimento)}</div>
        ${parcelaFin || parcelaCartao
          ? `<div class="sub"><strong>${esc(parcelaFin || parcelaCartao)}</strong>${
              parcelaFin && parcelaCartao ? ` &nbsp;·&nbsp; ou ${esc(parcelaCartao)}` : ''
            }</div>`
          : ''}
        <div class="sub">Equipamentos, estrutura, proteções, instalação e comissionamento.</div>
      </div>
      <div class="right">
        ${prazoEntrega ? `Entrega dos equipamentos<br/><strong>${esc(prazoEntrega)}</strong><br/><br/>` : ''}
        Proposta válida até<br/><strong>${validade}</strong>
      </div>
    </div>
  </div>

  <div class="rod">
    <div class="e">
      <strong>${esc(marca)}</strong>
      ${vendedor ? `${esc(vendedor)}${whats ? ' · ' : ''}` : ''}${whats ? esc(tel(whats)) : ''}
      ${company.cidade ? `<br/>${esc(company.cidade)}${company.uf ? ' — ' + esc(company.uf) : ''}` : ''}
    </div>
    <div class="pg-n">1 / ${totalPaginas}</div>
  </div>
</div>

<!-- ══════════════ PÁGINA 2 — AUTONOMIA ══════════════ -->
<div class="pg">
  <div class="top">
    <div class="brand">
      ${logo ? `<img src="${esc(logo)}" alt=""/>` : ''}
      <div><div class="bn">${esc(marca)}</div></div>
    </div>
    <div class="meta"><strong>${esc(client.nome)}</strong>Autonomia do sistema</div>
  </div>

  <div class="hero" style="margin-bottom:16px">
    <div class="kicker">A pergunta que todo mundo faz</div>
    <h1>Quanto tempo a bateria aguenta sem sol?</h1>
  </div>

  <div class="aut-hero">
    <div class="k">Com o essencial ligado</div>
    <div class="v"><em>${tempo(autEss)}</em><span>sem nenhum sol</span></div>
    <p>
      O banco tem ${dec(bancoKwh, 2)} kWh, dos quais <strong style="color:#fff">${dec(bancoUtil, 2)} kWh são utilizáveis</strong>.
      Os outros ${dec(bancoReserva, 2)} kWh ficam guardados de propósito: o inversor corta antes de zerar a
      bateria, e é isso que faz um banco de lítio durar mais de 10 anos em vez de 3.
    </p>
  </div>

  <div class="sec">
    <h2>Os três cenários, com número</h2>

    <div class="cen">
      <div>
        <h3>Só o essencial — geladeira, luz, água e internet</h3>
        <p>${dec(consumoEssDia, 1)} kWh por dia. É o que não pode faltar em casa nenhuma.</p>
      </div>
      <div class="val">${tempo(autEss)}</div>
    </div>

    ${Math.abs(autTudo - autEss) < 0.05
      // Projeto em que TUDO é essencial: repetir o mesmo número em duas linhas
      // parece erro de conta. Vira uma linha só, dizendo o porquê.
      ? `<div class="cen">
      <div>
        <h3>Neste projeto, tudo que está na lista é essencial</h3>
        <p>Não há consumo de conforto separado — os ${dec(consumoDia, 1)} kWh/dia da página 1 são os mesmos que a bateria segura sem sol.</p>
      </div>
      <div class="val">${tempo(autTudo)}</div>
    </div>`
      : `<div class="cen">
      <div>
        <h3>A casa inteira ligada, como num dia comum</h3>
        <p>${dec(consumoDia, 1)} kWh por dia, incluindo tudo que está na lista da página 1.</p>
      </div>
      <div class="val">${tempo(autTudo)}</div>
    </div>`}

    <div class="cen">
      <div>
        <h3>Chovendo o dia inteiro</h3>
        <p>
          Painel no temporal não para: ainda entrega cerca de ${dec(geracaoFechado, 1)} kWh por dia (10% a 25%
          de um dia de sol). A bateria só cobre a diferença — por isso dura bem mais que no cenário de
          escuridão total.
        </p>
      </div>
      <div class="val" ${chuvaInfinita ? 'style="font-size:12.5px;line-height:1.35"' : ''}>${
        // "não acaba" é promessa aberta num documento que vira acordo. O que dá
        // pra afirmar é que o sol de dia fechado já cobre o essencial.
        chuvaInfinita ? 'o essencial<br/>se mantém' : tempo(autChuva)
      }</div>
    </div>
  </div>

  <div class="sec">
    <h2>Depois que o sol volta</h2>
    <div class="dupla">
      <div class="tec" style="grid-template-columns:1fr">
        <div>
          <span>Banco cheio de novo em</span>
          <strong>${recarga > 0 ? tempo(recarga) + ' de sol' : 'mesmo dia'}</strong>
        </div>
      </div>
      <div class="tec" style="grid-template-columns:1fr">
        <div>
          <span>Dimensionado pelo</span>
          <strong>${criterio === 'media' ? 'sol médio do ano' : `mês de menos sol (${dec(hspPior, 2)} h/dia)`}</strong>
        </div>
      </div>
    </div>
    <div class="nota" style="margin-top:10px">
      ${criterio === 'media'
        ? `O arranjo foi calculado pelo sol médio do ano. No inverno, quando o sol cai para ${dec(hspPior, 2)} h/dia, a geração fica em torno de ${dec(geracaoDiaPior, 1)} kWh/dia — se o consumo se mantiver alto nesse período, vale conversar sobre ampliar o arranjo.`
        : `O sistema foi calculado pelo <strong>mês de menos sol do ano</strong>, não pela média. Isso significa que ele fecha a conta em junho também — o mês em que a maioria dos sistemas mal dimensionados deixa o cliente na mão.`}
      ${geracaoMes > consumoMes * 1.25 ? `Por isso a geração média do ano (${geracaoMes} kWh/mês) fica acima do consumo (${consumoMes} kWh/mês): no verão sobra de propósito, e é essa sobra que enche a bateria de volta depois dos dias fechados. Num sistema isolado não existe rede pra compensar o mês fraco — ou sobra no verão, ou falta no inverno.` : ''}
    </div>
  </div>

  <div class="sec">
    <h2>O que não entra num sistema off-grid</h2>
    <div class="nota">
      Chuveiro elétrico, torneira elétrica, forno elétrico e secadora de roupa <strong>não fazem parte
      deste projeto</strong>. Um único banho de 15 minutos no chuveiro elétrico consome cerca de 1,4 kWh —
      o equivalente a um terço de uma bateria inteira. A saída é aquecimento a gás ou solar, e isso está
      combinado nesta proposta. Sistema off-grid dimensionado com chuveiro elétrico é sistema que falha
      na primeira semana.
    </div>
  </div>

  <div class="sec">
    <h2>Normas e responsabilidade técnica</h2>
    <div class="nota">
      Instalação conforme <strong>ABNT NBR 16690</strong> (arranjos fotovoltaicos), <strong>NBR 5410</strong>
      (instalações de baixa tensão) e <strong>NBR 5419</strong> (proteção contra descargas atmosféricas),
      com equipamentos certificados pelo Inmetro. Sistema isolado <strong>não precisa de homologação na
      concessionária</strong> — não há conexão com a rede, e portanto não há prazo de parecer de acesso
      nem fila de aprovação.
    </div>
  </div>

  <div class="rod">
    <div class="e">
      <strong>${esc(marca)}</strong>
      ${vendedor ? `${esc(vendedor)}${whats ? ' · ' : ''}` : ''}${whats ? esc(tel(whats)) : ''}
      ${client.telefone ? '' : ''}
    </div>
    <div class="pg-n">2 / ${totalPaginas}</div>
  </div>
</div>

${!temComparativo ? '' : `
<!-- ══════════════ PÁGINA 3 — O QUE ISSO SUBSTITUI ══════════════ -->
<div class="pg">
  <div class="top">
    <div class="brand">
      ${logo ? `<img src="${esc(logo)}" alt=""/>` : ''}
      <div><div class="bn">${esc(marca)}</div></div>
    </div>
    <div class="meta"><strong>${esc(client.nome)}</strong>Comparativo de ${compAnos} anos</div>
  </div>

  <div class="hero" style="margin-bottom:16px">
    <div class="kicker">A conta que ninguém faz</div>
    <h1>Energia própria custa menos<br/>que continuar sem ela</h1>
    <p>
      Um sistema isolado não disputa com o telhado do vizinho ligado na rua. Ele disputa com
      ${compDistancia > 0 ? `puxar ${compDistancia} m de rede da concessionária` : 'continuar pagando conta de luz'}
      ou com queimar diesel num gerador. Abaixo, as três contas somadas em ${compAnos} anos.
    </p>
  </div>

  <div class="sec">
    ${compOpcoes.map((o) => `
    <div class="opc ${o.id === compVencedor ? 'opc-win' : ''}">
      <div class="opc-h">
        <h3>${esc(o.nome)}</h3>
        <div class="opc-total">${brl(o.total)}<em>em ${compAnos} anos</em></div>
      </div>
      <div class="opc-linhas">
        ${(o.linhas || []).map((l) => `<div><span>${esc(l.rotulo)}</span><b>${brl(l.valor)}</b></div>`).join('')}
      </div>
      <div class="opc-pk">
        Entrada de ${brl(o.entrada)} · depois ${brl(o.mensal)} por mês · <strong>${brl2ceil(o.porKwh)} por kWh</strong>
        <em style="font-style:normal;color:var(--muted)"> (tudo somado, obra inclusa, dividido pela energia dos ${compAnos} anos)</em>
      </div>
      <p class="opc-obs">${esc(o.observacao)}</p>
    </div>`).join('')}
  </div>

  <div class="sec">
    <h2>O que isso significa</h2>
    <div class="nota">
      ${
        // Cada comparação é uma FRASE INTEIRA. Emendar "a rede ganha" com "e
        // economiza tanto no diesel" troca o sujeito no meio e sai um texto que
        // não faz sentido — num documento que leva o nome do integrador.
        [
          compEconomiaRede > 0
            ? `Em ${compAnos} anos, o sistema off-grid deixa <strong>${brl(compEconomiaRede)}</strong> no bolso em relação a puxar a rede${compDistancia > 0 ? ` — ${compDistancia} m de obra mais a conta de luz todo mês` : ' e seguir pagando conta de luz'}.`
            : `Nesta situação específica, ligar na rede da concessionária ainda sai mais barato no total de ${compAnos} anos. O que o sistema próprio entrega aqui é <strong>independência</strong>: energia que não cai, não tem religação pra esperar e não sobe de tarifa.`,
          compEconomiaDiesel > 0
            ? `Contra o gerador a diesel, a diferença é de <strong>${brl(compEconomiaDiesel)}</strong> no mesmo período${compPaybackDiesel > 0 ? `, e o investimento se paga em <strong>${compPaybackDiesel} meses</strong> só de combustível economizado` : ''} — sem contar o barulho, o diesel pra buscar e a revisão pra marcar.`
            : '',
          compVenceNaPorta
            ? `Vale notar: nesta conta o sistema ganharia <strong>mesmo com o poste na porta</strong>, porque só a conta de luz do período já passa do valor do sistema inteiro.`
            : (compEconomiaRede > 0 && compEquilibrio > 0
                ? `O ponto de virada é <strong>${compEquilibrio} m</strong> de rede: acima dessa distância, o sistema próprio sai na frente.`
                : ''),
        ].filter(Boolean).join(' ')
      }
    </div>
  </div>

  ${arrSerie > 0 && arrOk ? `<div class="sec">
    <h2>Ficha de instalação</h2>
    <div class="tec">
      <div><span>Ligação dos módulos</span><strong>${arrSerie} em série × ${arrParalelo} string${arrParalelo > 1 ? 's' : ''}</strong></div>
      <div><span>Tensão na manhã fria</span><strong>${dec(arrVocFrio, 0)} V</strong></div>
      <div><span>Tensão na tarde quente</span><strong>${dec(arrVmpQuente, 0)} V</strong></div>
      <div><span>Corrente do arranjo</span><strong>${dec(arrCorrente, 1)} A</strong></div>
      <div><span>Banco</span><strong>${tensao}V · ${dec(bancoKwh, 2)} kWh</strong></div>
      <div><span>Proteções</span><strong>String box CC, DPS e aterramento</strong></div>
    </div>
    <div class="nota" style="margin-top:10px">
      As tensões são as duas pontas do ano: a manhã mais fria (quando a tensão sobe e não pode passar do
      limite do inversor) e a tarde mais quente (quando ela cai e precisa continuar na faixa de trabalho).
      O arranjo já está fechado com <strong>strings iguais</strong>, do jeito que o equipamento pede.
    </div>
  </div>` : ''}

  <div class="rod">
    <div class="e">
      <strong>${esc(marca)}</strong>
      ${vendedor ? `${esc(vendedor)}${whats ? ' · ' : ''}` : ''}${whats ? esc(tel(whats)) : ''}
    </div>
    <div class="pg-n">3 / ${totalPaginas}</div>
  </div>
</div>`}

</body></html>`;
}
