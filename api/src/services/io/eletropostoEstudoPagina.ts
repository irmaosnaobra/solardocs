// ESTUDO DO LOCAL, a página que o consultor abre antes da reunião.
//
// Recebe a linha de eletroposto_estudos e a reunião e devolve o HTML inteiro, pronto
// para a rota mandar com a CSP dela: estilo inline, nenhum <script>, nenhuma fonte,
// folha ou imagem de fora. A única imagem que entra é a do próprio estudo, servida
// por solardoc.app (satélite e rua), e só enquanto imagensPermitidas() deixa.
//
// Regras que valem para a página inteira:
// - Todo dado passa por esc(). O esc() também troca travessão por ponto médio, então
//   a ficha no formato antigo (travessão até 13/09) sai limpa sem cuidado extra.
// - Do cliente sai só o primeiro nome. Telefone, sobrenome e UTM nunca entram.
// - Sem coordenada no HTML quando o estudo está arquivado (coords_apagadas_em):
//   os links do Maps saem do place_id e do endereço formatado.
// - A pré-nota sai como "N de 100", nunca com barra. A única barra de nota é a da
//   NOTA da LP ("NOTA 3 · 11/11"), que é o que o card já mostra.
// - Número em pt-BR escrito à mão ("R$ 145.000", "7,4", "1,4 km"). O Intl de moeda
//   põe espaço inquebrável e centavos.

import {
  BASE_ESTUDO_URL, CATEGORIAS_ENTORNO, VERSAO_PESOS,
  mapsBuscaTexto, mapsDoLugar, mapsUrls, primeiroNome, quandoPorExtenso, rotuloSituacao,
  statusLegivel, textoDeBusca,
  type Confianca, type DadosEstudo, type EnderecoDigitado, type ItemLugar, type Sinal,
} from './eletropostoEstudoPuro';
import type { CenarioConta, ContaReferencia } from '../../utils/computeEletro';

export type StatusEstudo = 'pendente' | 'processando' | 'pronto' | 'parcial' | 'sem_endereco' | 'descartado' | 'erro';

export interface LinhaEstudo {
  token: string;
  status: StatusEstudo;
  dados: DadosEstudo;
  fontes: Record<string, string>;
  custo_usd: number;
  created_at: string;
  pronto_em: string | null;
  coords_apagadas_em: string | null;
}

export interface ReuniaoEstudo {
  quando: string | null;
  status: string;
  vendedor_nome: string | null;
  cliente_nome: string | null;
  cidade: string | null;
  observacao: string | null;
}

const DIA_MS = 86_400_000;
const JANELA_IMAGENS_MS = 7 * DIA_MS;

const COR = {
  neon: '#39FF14', azul: '#0085FF', cream: '#E5E7EB', mut: '#8CA0B8', ambar: '#FFB020',
  trilho: 'rgba(229,231,235,.16)', grade: 'rgba(229,231,235,.14)',
};

// ── texto e número ─────────────────────────────────────────────────────────

/** Escapa & < > " ' e troca travessão (U+2014) e meia-risca (U+2013) por ponto médio. */
export function esc(s: unknown): string {
  if (s == null) return '';
  if (typeof s === 'number' && !Number.isFinite(s)) return '';
  return String(s)
    .replace(/\s*[–—]\s*/g, ' · ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const temNumero = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** 3017 → "3.017"; 7.44 com 1 casa → "7,4". */
function numero(n: number, casas = 0): string {
  const fixo = Math.abs(n).toFixed(casas);
  const [inteiro, dec] = fixo.split('.');
  const negativo = n < 0 && Number(fixo) !== 0;
  return `${negativo ? '-' : ''}${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${dec ? `,${dec}` : ''}`;
}

/** Como numero(), sem zero sobrando no fim: 10,00 → "10"; 0,10 → "0,1". */
function numeroEnxuto(n: number, casas = 2): string {
  const s = numero(n, casas);
  return s.includes(',') ? s.replace(/,?0+$/, '') : s;
}

function reais(n: number, casas = 0): string {
  const negativo = n < 0 && Number(Math.abs(n).toFixed(casas)) !== 0;
  return `${negativo ? '-' : ''}R$ ${numero(Math.abs(n), casas)}`;
}

function distancia(m: number): string {
  const r = Math.round(m);
  if (r < 1000) return `${numero(r)} m`;
  return `${numeroEnxuto(r / 1000, 1)} km`;
}

const pct = (x: number): string => `${numeroEnxuto(x * 100, 2)}%`;

function capitalizar(s: unknown): string {
  const t = String(s ?? '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

const plural = (n: number, um: string, varios: string): string => `${numero(n)} ${n === 1 ? um : varios}`;

const contagemAtencao = (n: number): string =>
  n === 0 ? 'Sem ponto de atenção' : `${numero(n)} ${n === 1 ? 'ponto' : 'pontos'} de atenção`;

function quando(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return 'sem horário';
  return quandoPorExtenso(iso);
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2023-05" → "maio de 2023". Sem mês, só o ano. */
function mesAno(data: string | null | undefined): string {
  const m = String(data ?? '').match(/^(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return '';
  const mes = m[2] ? MESES[Number(m[2]) - 1] : undefined;
  return mes ? `${mes} de ${m[1]}` : m[1];
}

const corta = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Slug do IBGE Cidades: minúsculas, sem acento, sem apóstrofo, espaço vira hífen. */
function slugIbge(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/['’`]/g, '').trim().replace(/\s+/g, '-');
}

/** Coordenada de SVG com 1 casa. Nunca "-0". */
const c = (n: number): string => String(Math.round(n * 10) / 10 || 0);

// ── imagens ────────────────────────────────────────────────────────────────

/**
 * As fotos só aparecem com a chave ligada, estudo não arquivado, pino com lat/lng e
 * até 7 dias depois da reunião. Reunião sem horário (ou horário que não se lê) não
 * tem prazo.
 */
export function imagensPermitidas(
  l: LinhaEstudo, r: ReuniaoEstudo, agoraMs: number, ligadas: boolean,
): { satelite: boolean; rua: boolean } {
  const nao = { satelite: false, rua: false };
  if (!ligadas || !l || l.coords_apagadas_em != null) return nao;
  const d: DadosEstudo = l.dados || {};
  const loc = d.local;
  if (!loc || !temNumero(loc.lat) || !temNumero(loc.lng)) return nao;
  const t = r?.quando ? Date.parse(r.quando) : NaN;
  if (!Number.isNaN(t) && !(agoraMs < t + JANELA_IMAGENS_MS)) return nao;
  return {
    satelite: d.imagens?.satelite_ok === true,
    rua: d.imagens?.rua_ok === true && !!d.rua,
  };
}

// ── fontes ─────────────────────────────────────────────────────────────────

type GrupoFonte = 'ia' | 'entorno' | 'recarga' | 'rua' | 'satelite' | 'ibge' | 'senatran' | 'historico' | 'local';

/**
 * As chaves de l.fontes são as do tick (eletropostoEstudo.ts): searchText, historico,
 * nearby_entorno, nearby_recarga, svMeta, staticmap, ibgePop, ibgePib, ia. O
 * reconhecimento é pelo pedaço do nome, para sobreviver a chave nova. Chave que não
 * casa aparece na lista de fontes com o próprio nome.
 */
const FONTES: Array<{ grupo: GrupoFonte; re: RegExp; nome: string; rotulo: string }> = [
  { grupo: 'ia', re: /(^|[_-])ia($|[_-])|anthropic|claude|openai|gemini|llm/i, nome: 'IA', rotulo: 'IA, roteiro da reunião' },
  { grupo: 'entorno', re: /entorno/i, nome: 'Google Maps', rotulo: 'Google Maps, entorno em 1 km' },
  { grupo: 'recarga', re: /recarga|carregador|charging/i, nome: 'Google Maps', rotulo: 'Google Maps, carregadores em 5 km' },
  { grupo: 'rua', re: /^sv|street|pano|(^|[_-])rua($|[_-])/i, nome: 'Google Maps', rotulo: 'Google Maps, vista da rua' },
  { grupo: 'satelite', re: /satelite|satellite|static/i, nome: 'Google Maps', rotulo: 'Google Maps, satélite' },
  { grupo: 'ibge', re: /ibge.?pop|populacao/i, nome: 'IBGE', rotulo: 'IBGE, população' },
  { grupo: 'ibge', re: /ibge.?pib|pib/i, nome: 'IBGE', rotulo: 'IBGE, PIB per capita' },
  { grupo: 'ibge', re: /ibge/i, nome: 'IBGE', rotulo: 'IBGE' },
  { grupo: 'senatran', re: /senatran|renavam|frota/i, nome: 'SENATRAN', rotulo: 'SENATRAN/RENAVAM, frota' },
  { grupo: 'historico', re: /historico/i, nome: 'Agenda', rotulo: 'Agenda, visitas anteriores no endereço' },
  { grupo: 'local', re: /geo|texto|text|places|endereco|local|find/i, nome: 'Google Maps', rotulo: 'Google Maps, endereço' },
];

/** Status que não são falha de verdade. Na hora de explicar um bloco, perdem para os outros. */
const STATUS_LEVE = new Set(['ok', 'zero_resultados', 'reaproveitado']);

const grupoDaFonte = (chave: string) => FONTES.find(f => f.re.test(chave)) || null;

/** Status legível. Texto livre de erro nunca vai para a página: pode trazer URL ou chave. */
function statusFonteLegivel(v: unknown): string {
  const s = String(v ?? '').trim();
  if (s === 'ok') return 'respondeu';
  if (s === 'zero_resultados') return 'sem resultado';
  if (s === 'timeout') return 'não respondeu a tempo';
  if (s === 'pulado') return 'não consultado';
  if (s === 'sem_chave') return 'sem chave configurada';
  if (s === 'rede') return 'falha de rede';
  if (s === 'reaproveitado') return 'reaproveitado de estudo recente';
  const cod = s.match(/^erro:\s*(\d{3})\b/i);
  if (cod) return `erro ${cod[1]}`;
  if (/^erro/i.test(s)) return 'erro';
  if (/^[a-z_]{1,40}$/i.test(s)) return s.replace(/_/g, ' ');
  return s ? 'status não reconhecido' : 'sem registro';
}

function fraseFalha(nome: string, v: unknown): string {
  const s = String(v ?? '').trim();
  const cod = s.match(/^erro:\s*(\d{3})\b/i);
  if (cod) return `${nome} respondeu erro ${cod[1]}`;
  if (/^erro/i.test(s)) return `${nome} respondeu com erro`;
  if (s === 'timeout') return `${nome} não respondeu a tempo`;
  if (s === 'sem_chave') return `${nome} sem chave configurada`;
  if (s === 'rede') return `${nome} não respondeu por falha de rede`;
  if (s === 'pulado') return `${nome} não foi consultado`;
  if (s === 'zero_resultados') return `${nome} não trouxe resultado`;
  if (s === 'ok') return `${nome} respondeu sem o dado`;
  return `${nome}, ${statusFonteLegivel(s)}`;
}

/** " (Google Maps respondeu erro 403)" ou "" quando a fonte não foi registrada. */
function motivo(fontes: Record<string, string> | null | undefined, grupos: GrupoFonte[]): string {
  const f = fontes || {};
  const chaves = Object.keys(f).filter(k => {
    const g = grupoDaFonte(k);
    return !!g && grupos.includes(g.grupo);
  });
  if (!chaves.length) return '';
  const pior = chaves.find(k => !STATUS_LEVE.has(f[k])) ?? chaves.find(k => f[k] !== 'ok') ?? chaves[0];
  return ` (${fraseFalha(grupoDaFonte(pior)?.nome || 'A fonte', f[pior])})`;
}

function rotuloFonte(chave: string): string {
  const g = grupoDaFonte(chave);
  if (g) return g.rotulo;
  const limpo = chave.replace(/[_-]+/g, ' ').replace(/[^\p{L}\d ]/gu, '').trim();
  return capitalizar(corta(limpo, 40)) || 'Fonte';
}

// ── SVG ────────────────────────────────────────────────────────────────────

/** Meio círculo. O valor vai escrito dentro ("80 de 100"); a faixa, embaixo. */
export function svgMedidor(valor: number | null, max: number, rotulo: string, faixa: string): string {
  const ok = temNumero(valor) && temNumero(max) && max > 0;
  const fr = ok ? Math.min(1, Math.max(0, (valor as number) / max)) : 0;
  const cx = 100, cy = 100, raio = 80;
  const pt = (x: number): string => {
    const a = Math.PI * (1 - x);
    return `${c(cx + raio * Math.cos(a))} ${c(cy - raio * Math.sin(a))}`;
  };
  const arco = (ate: number) => `M ${pt(0)} A ${raio} ${raio} 0 0 1 ${pt(ate)}`;
  const casas = temNumero(max) && max <= 10 ? 1 : 0;
  const txtValor = ok ? `${numero(valor as number, casas)} de ${numeroEnxuto(max, 1)}` : 'Sem dado';
  const txtFaixa = capitalizar(faixa) || (ok ? '' : 'Sem dado suficiente');
  const aria = `${rotulo}: ${ok ? txtValor : 'sem dado'}${txtFaixa ? `. ${txtFaixa}` : ''}`;

  return `<svg class="medidor" viewBox="0 0 200 156" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">`
    + `<path class="sv-trilho" d="${arco(1)}" fill="none" stroke="${COR.trilho}" stroke-width="14" stroke-linecap="round"/>`
    + (fr > 0 ? `<path class="sv-neon" d="${arco(Math.min(fr, 0.9999))}" fill="none" stroke="${COR.neon}" stroke-width="14" stroke-linecap="round"/>` : '')
    + `<text class="sv-texto" x="100" y="92" text-anchor="middle" font-size="${ok ? 24 : 20}" font-weight="800" fill="${COR.cream}">${esc(txtValor)}</text>`
    + `<text class="sv-texto" x="100" y="130" text-anchor="middle" font-size="15" font-weight="700" fill="${COR.cream}">${esc(rotulo)}</text>`
    + (txtFaixa ? `<text class="sv-mut" x="100" y="149" text-anchor="middle" font-size="13" fill="${COR.mut}">${esc(txtFaixa)}</text>` : '')
    + '</svg>';
}

/** Barras deitadas, com o número escrito na ponta de cada uma. */
export function svgBarras(itens: Array<{ rotulo: string; valor: number }>, titulo: string): string {
  const lista = (itens || []).filter(i => i && temNumero(i.valor));
  const W = 360, TOPO = 30, LINHA = 30, LAB = 140, X0 = 148, LARG = 160;
  const maxV = Math.max(0, ...lista.map(i => i.valor));
  const h = TOPO + Math.max(1, lista.length) * LINHA + 8;

  const linhas = lista.length
    ? lista.map((it, i) => {
      const y = TOPO + i * LINHA;
      const w = maxV > 0 && it.valor > 0 ? Math.max(3, (it.valor / maxV) * LARG) : 0;
      return `<text class="sv-texto" x="${LAB}" y="${y + 19}" text-anchor="end" font-size="13" fill="${COR.cream}">${esc(corta(String(it.rotulo ?? ''), 21))}</text>`
        + `<rect class="sv-azul" x="${X0}" y="${y + 6}" width="${c(w)}" height="18" rx="4" fill="${COR.azul}"/>`
        + `<text class="sv-texto" x="${c(X0 + w + 6)}" y="${y + 19}" font-size="13" font-weight="700" fill="${COR.cream}">${esc(numeroEnxuto(it.valor, 1))}</text>`;
    }).join('')
    : `<text class="sv-mut" x="0" y="${TOPO + 19}" font-size="13" fill="${COR.mut}">Sem dado para mostrar.</text>`;

  const aria = lista.length
    ? `${titulo}. ${lista.map(i => `${i.rotulo}: ${numeroEnxuto(i.valor, 1)}`).join('. ')}.`
    : `${titulo}. Sem dado.`;

  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">`
    + `<text class="sv-texto" x="0" y="18" font-size="14" font-weight="700" fill="${COR.cream}">${esc(titulo)}</text>`
    + linhas + '</svg>';
}

function numeroCurto(v: number): string {
  const a = Math.abs(v);
  return numeroEnxuto(v, a >= 100 ? 0 : a >= 1 ? 1 : 2);
}

/** Barras lado a lado para comparar (município, UF, Brasil). Sem dado vira texto. */
export function svgBarrasComparadas(
  itens: Array<{ rotulo: string; valor: number | null }>, titulo: string, unidade: string,
): string {
  const lista = (itens || []).filter(Boolean);
  const W = 360, TOPO = 30, LINHA = 32, LAB = 118, X0 = 126, LARG = 124;
  const valores = lista.map(i => i.valor).filter(temNumero);
  const maxV = Math.max(0, ...valores);
  const h = TOPO + Math.max(1, lista.length) * LINHA + 8;
  const un = unidade ? ` ${unidade}` : '';

  const linhas = lista.length
    ? lista.map((it, i) => {
      const y = TOPO + i * LINHA;
      const rot = `<text class="sv-texto" x="${LAB}" y="${y + 20}" text-anchor="end" font-size="13" fill="${COR.cream}">${esc(corta(String(it.rotulo ?? ''), 17))}</text>`;
      if (!temNumero(it.valor)) {
        return rot + `<text class="sv-mut" x="${X0}" y="${y + 20}" font-size="13" fill="${COR.mut}">Sem dado</text>`;
      }
      const w = maxV > 0 && it.valor > 0 ? Math.max(3, (it.valor / maxV) * LARG) : 0;
      const cor = i === 0 ? COR.neon : COR.azul;
      return rot
        + `<rect class="${i === 0 ? 'sv-neon-f' : 'sv-azul'}" x="${X0}" y="${y + 7}" width="${c(w)}" height="18" rx="4" fill="${cor}"/>`
        + `<text class="sv-texto" x="${c(X0 + w + 6)}" y="${y + 20}" font-size="13" font-weight="700" fill="${COR.cream}">${esc(numeroCurto(it.valor) + un)}</text>`;
    }).join('')
    : `<text class="sv-mut" x="0" y="${TOPO + 20}" font-size="13" fill="${COR.mut}">Sem dado para mostrar.</text>`;

  const aria = `${titulo}. ${lista.map(i => `${i.rotulo}: ${temNumero(i.valor) ? numeroCurto(i.valor) + un : 'sem dado'}`).join('. ')}.`;

  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">`
    + `<text class="sv-texto" x="0" y="18" font-size="14" font-weight="700" fill="${COR.cream}">${esc(titulo)}</text>`
    + linhas + '</svg>';
}

/** 1.234.567 → "1,2 mi"; 145.000 → "145 mil"; sem "R$" (o título diz). */
function compacto(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${numeroEnxuto(v / 1_000_000, 1)} mi`;
  if (a >= 1000) return `${numero(Math.round(v / 1000))} mil`;
  return numero(Math.round(v));
}

function passoBonito(bruto: number): number {
  if (!(bruto > 0)) return 1;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const m = bruto / pot;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pot;
}

/**
 * Caixa acumulado em 10 anos, três linhas. O ano 0 é o investimento (-invest) e os
 * anos 1 a 10 são o `fluxo` do cenário, que já vem acumulado.
 */
export function svgFluxo10Anos(conta: ContaReferencia): string {
  const W = 360, H = 240, X0 = 56, X1 = 262, Y0 = 30, Y1 = 196;
  const invest = temNumero(conta?.invest) ? conta.invest : 0;
  const series: Array<{ nome: string; cen: CenarioConta | undefined; cor: string; classe: string; traco: string }> = [
    { nome: 'Teto', cen: conta?.teto, cor: COR.neon, classe: 'sv-neon', traco: '' },
    { nome: 'Base', cen: conta?.base, cor: COR.azul, classe: 'sv-azul-l', traco: '' },
    { nome: 'Piso', cen: conta?.piso, cor: COR.ambar, classe: 'sv-ambar', traco: '6 4' },
  ];
  const pontos = series.map(s => [-invest, ...((s.cen?.fluxo || []).filter(temNumero))]);
  const n = Math.max(2, ...pontos.map(p => p.length));
  const todos = pontos.flat();
  if (!todos.length || pontos.every(p => p.length < 2)) {
    return `<svg viewBox="0 0 ${W} 60" role="img" aria-label="Caixa acumulado em 10 anos. Sem dado." xmlns="http://www.w3.org/2000/svg">`
      + `<text class="sv-mut" x="0" y="34" font-size="13" fill="${COR.mut}">Sem dado para o caixa acumulado.</text></svg>`;
  }
  let min = Math.min(0, ...todos);
  let max = Math.max(0, ...todos);
  if (max === min) max = min + 1;
  const passo = passoBonito((max - min) / 5);
  min = Math.floor(min / passo) * passo;
  max = Math.ceil(max / passo) * passo;

  const xDe = (i: number) => X0 + ((X1 - X0) * i) / (n - 1);
  const yDe = (v: number) => Y0 + ((max - v) / (max - min)) * (Y1 - Y0);

  const grade: string[] = [];
  for (let v = min; v <= max + passo / 2; v += passo) {
    const y = yDe(v);
    const zero = Math.abs(v) < passo / 2;
    grade.push(
      `<line class="${zero ? 'sv-zero' : 'sv-grade'}" x1="${X0}" y1="${c(y)}" x2="${X1}" y2="${c(y)}" stroke="${zero ? COR.cream : COR.grade}" stroke-width="${zero ? 1.2 : 1}"${zero ? ' stroke-dasharray="4 3"' : ''}/>`
      + `<text class="sv-mut" x="${X0 - 6}" y="${c(y + 4)}" text-anchor="end" font-size="11" fill="${COR.mut}">${esc(zero ? '0' : compacto(v))}</text>`,
    );
  }

  const eixoX: string[] = [];
  for (let i = 0; i < n; i += 2) {
    eixoX.push(`<text class="sv-mut" x="${c(xDe(i))}" y="${Y1 + 16}" text-anchor="middle" font-size="11" fill="${COR.mut}">${i}</text>`);
  }

  const linhas = series.map((s, k) => {
    const p = pontos[k];
    if (p.length < 2) return '';
    const pts = p.map((v, i) => `${c(xDe(i))},${c(yDe(v))}`).join(' ');
    return `<polyline class="${s.classe}" points="${pts}" fill="none" stroke="${s.cor}" stroke-width="2.5" stroke-linejoin="round"${s.traco ? ` stroke-dasharray="${s.traco}"` : ''}/>`;
  }).join('');

  // Rótulo na ponta de cada linha, empurrado para não encavalar.
  const pontas = series
    .map((s, k) => ({ s, p: pontos[k] }))
    .filter(x => x.p.length >= 2)
    .map(x => ({ nome: x.s.nome, v: x.p[x.p.length - 1], y: yDe(x.p[x.p.length - 1]) + 4 }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < pontas.length; i++) {
    if (pontas[i].y - pontas[i - 1].y < 15) pontas[i].y = pontas[i - 1].y + 15;
  }
  const excesso = pontas.length ? pontas[pontas.length - 1].y - (H - 30) : 0;
  if (excesso > 0) for (const p of pontas) p.y -= excesso;
  const rotulos = pontas.map(p =>
    `<text class="sv-texto" x="${X1 + 6}" y="${c(p.y)}" font-size="12" font-weight="700" fill="${COR.cream}">${esc(`${p.nome} ${compacto(p.v)}`)}</text>`,
  ).join('');

  const aria = `Caixa acumulado em 10 anos, em reais. Ano 0 começa em ${reais(-invest)}. `
    + series.map((s, k) => {
      const p = pontos[k];
      return p.length >= 2 ? `${s.nome}: ${reais(p[p.length - 1])} no ano ${p.length - 1}.` : `${s.nome}: sem dado.`;
    }).join(' ');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}" xmlns="http://www.w3.org/2000/svg">`
    + `<text class="sv-texto" x="0" y="16" font-size="14" font-weight="700" fill="${COR.cream}">Caixa acumulado em R$</text>`
    + grade.join('') + eixoX.join('') + linhas + rotulos
    + `<text class="sv-mut" x="${c((X0 + X1) / 2)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="${COR.mut}">Anos depois da instalação</text>`
    + '</svg>';
}

// ── casca da página ────────────────────────────────────────────────────────

const CSS = `
:root{--neon:#39FF14;--azul:#0085FF;--dk:#06210C;--deep:#081422;--cream:#E5E7EB;--mut:#8CA0B8;--line:rgba(229,231,235,.11);--card:rgba(16,35,58,.72);--card-alto:#16304C;--ambar:#FFB020;color-scheme:dark}
*{box-sizing:border-box}
html{background:#081422;-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh;background:linear-gradient(180deg,#0B1A2B 0%,#0E2137 40%,#081422 100%);color:var(--cream);font:16px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere;word-break:normal}
main{max-width:720px;margin:0 auto;padding:20px 16px 40px}
.topo{margin:4px 0 18px}
.marca{margin:0;color:var(--mut);font-size:13px;font-weight:700;letter-spacing:.04em}
h1{font-size:32px;line-height:1.15;margin:6px 0 4px}
h2{font-size:20px;line-height:1.3;margin:0 0 12px}
h3{font-size:15px;line-height:1.35;margin:18px 0 6px;color:var(--mut)}
p{margin:0 0 10px}
.meta{color:var(--cream);font-size:15px}
.meta span{display:inline-block}
.selos{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 4px}
.selo{display:inline-flex;align-items:center;min-height:30px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:800;letter-spacing:.02em;line-height:1.25}
.selo-nota{background:var(--card-alto);color:var(--cream);border:1px solid var(--line)}
.selo-pronto{background:var(--neon);color:var(--dk)}
.selo-confirmar{background:var(--ambar);color:#221600}
.medidores{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
.medidores .card{margin:0;padding:12px 8px}
.medidor{display:block;width:100%;height:auto;max-width:240px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 16px;margin:0 0 14px}
.resumo{font-size:17px}
ul,ol{padding-left:22px;margin:0 0 10px}
li{margin:5px 0}
.atencao li::marker{color:var(--ambar)}
.aviso{border-left:4px solid var(--ambar);background:rgba(255,176,32,.09);padding:10px 12px;border-radius:10px}
.destaque{font-size:17px;font-weight:700;border-left:4px solid var(--neon);background:var(--card-alto);padding:12px 14px;border-radius:10px}
.pequeno{font-size:13px;color:var(--mut)}
.pares{margin:0 0 12px}
.pares dt,.respostas dt{color:var(--mut);font-size:13px;margin-top:10px}
.pares dd,.respostas dd{margin:2px 0 0}
.respostas{margin:0}
a{color:var(--cream);text-decoration-color:var(--azul);text-underline-offset:3px}
.botoes{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 4px}
.botao{display:inline-flex;align-items:center;justify-content:center;flex:1 1 150px;min-height:48px;padding:10px 16px;border-radius:12px;border:2px solid var(--neon);color:var(--cream);font-weight:700;text-align:center;text-decoration:none;line-height:1.25}
.botao.principal{background:var(--neon);color:var(--dk)}
figure{margin:14px 0 0}
figure img{display:block;max-width:100%;height:auto;border-radius:12px;background:var(--card-alto)}
figcaption{font-size:13px;color:var(--mut);margin-top:6px}
.grafico{margin:12px 0}
.grafico svg{display:block;width:100%;height:auto;max-width:520px;margin:0 auto}
.lugares{list-style:none;padding:0;margin:8px 0 12px}
.lugares li{padding:9px 0;margin:0;border-bottom:1px solid var(--line)}
.lugares li:last-child{border-bottom:0}
.lugares a{font-weight:600}
.dados{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 12px}
.dado{background:var(--card-alto);border-radius:12px;padding:12px}
.dado strong{display:block;font-size:20px;line-height:1.25;margin:2px 0}
.dado .rot,.dado .fonte{display:block;font-size:12px;color:var(--mut)}
.tabela{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 0 12px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left;white-space:normal}
thead th{color:var(--mut);font-weight:700}
.rodape{margin-top:18px;text-align:center}
@media (max-width:360px){h1{font-size:28px}.dados{grid-template-columns:minmax(0,1fr)}}
@media print{
html,body{background:#fff!important;color:#000!important}
main{max-width:none;padding:0}
.card,.dado,.destaque,.aviso,.selo-nota{background:#fff!important;color:#000!important;border-color:#999!important}
.card{break-inside:avoid}
.botoes{display:none!important}
.selo{background:#fff!important;color:#000!important;border:1px solid #000}
.marca,.meta,.pequeno,h3,.pares dt,.respostas dt,.dado .rot,.dado .fonte,figcaption,thead th{color:#333!important}
a{color:#000}
svg .sv-texto{fill:#000}
svg .sv-mut{fill:#333}
svg .sv-trilho{stroke:#ddd}
svg .sv-grade{stroke:#ddd}
svg .sv-zero{stroke:#000}
svg .sv-neon{stroke:#1B7A00}
svg .sv-neon-f{fill:#1B7A00}
svg .sv-azul{fill:#005BB5}
svg .sv-azul-l{stroke:#005BB5}
svg .sv-ambar{stroke:#B36B00}
}
`;

function documento(corpo: string, cabecaExtra = ''): string {
  return '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<meta name="robots" content="noindex, nofollow">\n'
    + '<meta name="referrer" content="no-referrer">\n'
    + cabecaExtra
    + '<title>Estudo do local · NEXUS</title>\n'
    + `<style>${CSS}</style>\n</head>\n<body>\n<main>\n${corpo}\n</main>\n</body>\n</html>\n`;
}

const MARCA = '<p class="marca">NEXUS Eletropostos · Estudo do local</p>';

const secao = (id: string, titulo: string, corpo: string): string =>
  `<section class="card" aria-labelledby="s-${id}"><h2 id="s-${id}">${esc(titulo)}</h2>${corpo}</section>\n`;

const aviso = (texto: string): string => `<p class="aviso">${esc(texto)}</p>`;

const linkExterno = (href: string, texto: string, classe = ''): string =>
  `<a${classe ? ` class="${classe}"` : ''} href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(texto)}</a>`;

function botoes(lista: Array<[string, string, boolean?]>): string {
  if (!lista.length) return '';
  return `<div class="botoes">${lista.map(([href, texto, principal]) => linkExterno(href, texto, principal ? 'botao principal' : 'botao')).join('')}</div>`;
}

const rodape = (): string =>
  '<footer class="rodape pequeno"><p>NEXUS Eletropostos · Irmãos na Obra. Página de uso interno do consultor.</p></footer>';

// ── pedaços do estudo ──────────────────────────────────────────────────────

const sinaisAtencao = (d: DadosEstudo): Sinal[] => (d.sinais || []).filter(s => s && s.lado === 'atencao');

const resposta = (d: DadosEstudo, rotulo: string): string =>
  (d.ficha?.respostas || []).find(x => x.rotulo === rotulo)?.texto || '';

function textoEndereco(e: EnderecoDigitado): string {
  const primeira = [e.rua, e.numero].filter(Boolean).join(', ');
  return [primeira, e.bairro, e.cidade, e.cep ? `CEP ${e.cep}` : ''].filter(Boolean).join(' · ');
}

const CONFIANCA: Record<Confianca, { texto: string; classe: string }> = {
  alta: { texto: 'Endereço conferido no Google', classe: 'selo-pronto' },
  media: { texto: 'Rua encontrada, número não conferido', classe: 'selo-confirmar' },
  baixa: { texto: 'Endereço aproximado, conferir com o cliente', classe: 'selo-confirmar' },
  nao_encontrado: { texto: 'Endereço não encontrado no Google', classe: 'selo-confirmar' },
};

function cabecalho(l: LinhaEstudo, r: ReuniaoEstudo | null | undefined, d: DadosEstudo, comMedidores: boolean): string {
  const nome = primeiroNome(r?.cliente_nome) || 'Cliente sem nome';
  const cidade = d.municipio?.nome ? `${d.municipio.nome}-${d.municipio.uf}` : (r?.cidade || '');
  const meta = [
    cidade,
    `Reunião ${quando(r?.quando)}`,
    r?.vendedor_nome ? `Consultor ${r.vendedor_nome}` : '',
    r?.status && r.status !== 'agendado' ? `Na agenda: ${statusLegivel(r.status)}` : '',
  ].filter(Boolean);

  const selos: string[] = [];
  const f = d.ficha;
  if (f?.nota != null) {
    selos.push(`<span class="selo selo-nota">NOTA ${esc(f.nota)}${temNumero(f.pts) ? ` · ${esc(f.pts)}/11` : ''}</span>`);
  }
  const atencao = sinaisAtencao(d);
  if (d.situacao) {
    const classe = d.situacao === 'pronto' ? 'selo-pronto' : 'selo-confirmar';
    selos.push(`<span class="selo ${classe}">${esc(rotuloSituacao(d.situacao))} · ${esc(contagemAtencao(atencao.length))}</span>`);
  } else if (d.sinais) {
    selos.push(`<span class="selo selo-nota">${esc(contagemAtencao(atencao.length))}</span>`);
  }
  if (l.coords_apagadas_em != null) selos.push('<span class="selo selo-nota">Arquivado</span>');

  let medidores = '';
  if (comMedidores) {
    const pn = d.pre_nota;
    const ix = d.indice;
    medidores = '<div class="medidores">'
      + `<div class="card">${svgMedidor(pn && temNumero(pn.valor) ? pn.valor : null, 100, 'Pré-nota', pn?.faixa || 'sem dado suficiente')}</div>`
      + `<div class="card">${svgMedidor(ix && temNumero(ix.valor) ? ix.valor : null, 10, 'Mercado', ix?.faixa || 'sem dado suficiente')}</div>`
      + '</div>';
  }

  return `<header class="topo">${MARCA}<h1>${esc(nome)}</h1>`
    + `<p class="meta">${meta.map(p => `<span>${esc(p)}</span>`).join(' · ')}</p>`
    + (selos.length ? `<div class="selos">${selos.join('')}</div>` : '')
    + medidores + '</header>\n';
}

function secao30s(d: DadosEstudo): string {
  const resumo = d.ia?.resumo || '';
  const at = sinaisAtencao(d).slice(0, 3);
  if (!resumo && !at.length) return '';
  return secao('resumo', 'Em 30 segundos',
    (resumo ? `<p class="resumo">${esc(resumo)}</p>` : '')
    + (at.length ? `<h3>Pontos de atenção</h3><ul class="atencao">${at.map(s => `<li>${esc(s.texto)}</li>`).join('')}</ul>` : ''));
}

function botoesDoLocal(l: LinhaEstudo, d: DadosEstudo): string {
  const loc = d.local || null;
  const e = d.endereco_digitado || null;
  const arquivado = l.coords_apagadas_em != null;
  const digitado = e ? textoDeBusca(e, d.municipio ? { municipio: d.municipio.nome, uf: d.municipio.uf } : null) : '';

  if (loc && !arquivado && temNumero(loc.lat) && temNumero(loc.lng)) {
    const u = mapsUrls(loc.lat, loc.lng, loc.place_id, temNumero(d.rua?.heading) ? d.rua?.heading : null);
    return botoes([
      [u.abrir, 'Abrir no Google Maps', true],
      [u.satelite, 'Ver satélite'],
      [u.rua, 'Ver a rua'],
      [u.rota, 'Traçar rota'],
    ]);
  }
  if (arquivado && loc?.place_id) {
    const texto = loc.formatado || digitado || 'Local do estudo';
    return botoes([
      [mapsDoLugar(loc.place_id, texto), 'Abrir no Google Maps', true],
      [`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(texto)}&destination_place_id=${encodeURIComponent(loc.place_id)}`, 'Traçar rota'],
    ]);
  }
  const busca = arquivado ? (loc?.formatado || digitado) : (digitado || loc?.formatado || '');
  return busca ? botoes([[mapsBuscaTexto(busca), 'Buscar o endereço no Google Maps', true]]) : '';
}

function imagens(l: LinhaEstudo, d: DadosEstudo, perm: { satelite: boolean; rua: boolean }): string {
  const base = `${BASE_ESTUDO_URL}${encodeURIComponent(l.token)}`;
  let html = '';
  if (perm.satelite) {
    html += `<figure><img src="${esc(base)}/satelite.jpg" width="640" height="400" alt="Vista de satélite do local" loading="lazy" decoding="async">`
      + '<figcaption>Vista de satélite. Dados do Google Maps.</figcaption></figure>';
  }
  if (perm.rua) {
    const quandoFoto = mesAno(d.rua?.data);
    html += `<figure><img src="${esc(base)}/rua.jpg" width="640" height="400" alt="Vista da rua em frente ao local" loading="lazy" decoding="async">`
      + `<figcaption>${esc(quandoFoto ? `Imagem de ${quandoFoto}` : 'Data da imagem não informada pelo Google')}. Dados do Google Maps.</figcaption></figure>`;
  }
  return html;
}

function secaoLocal(l: LinhaEstudo, d: DadosEstudo, perm: { satelite: boolean; rua: boolean }, parcial: boolean): string {
  const e = d.endereco_digitado || null;
  const loc = d.local || null;
  const falhaLocal = `Endereço não conferido agora${motivo(l.fontes, ['local'])}.`;
  if (!e && !loc) return parcial ? secao('local', 'O local', aviso(falhaLocal)) : '';

  const pares: string[] = [];
  if (e) {
    pares.push(`<dt>Endereço digitado</dt><dd>${esc(textoEndereco(e))}</dd>`);
    if (e.compl) pares.push(`<dt>Referência</dt><dd>${esc(e.compl)}</dd>`);
  }
  if (loc?.formatado) pares.push(`<dt>Endereço no Google</dt><dd>${esc(loc.formatado)}</dd>`);

  let corpo = pares.length ? `<dl class="pares">${pares.join('')}</dl>` : '';
  const conf = d.confianca ? CONFIANCA[d.confianca] : null;
  if (conf) corpo += `<p><span class="selo ${conf.classe}">${esc(conf.texto)}</span></p>`;
  else if (parcial && !loc) corpo += aviso(falhaLocal);

  const fato = (d.sinais || []).find(s => s && s.lado === 'fato');
  if (fato) corpo += `<p>${esc(fato.texto)}</p>`;

  const vagas = resposta(d, 'Vagas');
  if (vagas) corpo += `<p>Vagas declaradas: <strong>${esc(vagas)}</strong></p>`;

  const favor = (d.sinais || []).filter(s => s && s.lado === 'favor');
  if (favor.length) corpo += `<h3>A favor</h3><ul>${favor.map(s => `<li>${esc(s.texto)}</li>`).join('')}</ul>`;

  if (l.coords_apagadas_em != null) {
    corpo += '<p class="pequeno">Estudo arquivado. As imagens e as coordenadas do local foram apagadas.</p>';
  }

  corpo += imagens(l, d, perm);
  corpo += botoesDoLocal(l, d);
  return secao('local', 'O local', corpo);
}

function itemLugar(i: ItemLugar): string {
  const nome = i.nome || 'Sem nome no Google';
  const titulo = i.place_id ? linkExterno(mapsDoLugar(i.place_id, nome), nome) : esc(nome);
  const extra = [i.rotulo, temNumero(i.dist_m) ? distancia(i.dist_m) : ''].filter(Boolean);
  return `<li>${titulo}${extra.length ? ` <span class="pequeno">· ${extra.map(esc).join(' · ')}</span>` : ''}</li>`;
}

function secaoEntorno(l: LinhaEstudo, d: DadosEstudo, parcial: boolean): string {
  const en = d.entorno;
  if (!en) {
    return parcial ? secao('entorno', 'Entorno em 1 km', aviso(`Entorno não consultado agora${motivo(l.fontes, ['entorno'])}.`)) : '';
  }
  const raio = temNumero(en.raio_m) && en.raio_m > 0 ? en.raio_m : 1000;
  const ate = temNumero(en.ate_m) ? en.ate_m : raio;
  const n = temNumero(en.n) ? en.n : (en.lista || []).length;

  const itens = Object.entries(en.por_tipo || {})
    .filter(([, v]) => temNumero(v) && v > 0)
    .map(([k, v]) => ({ rotulo: CATEGORIAS_ENTORNO.find(x => x.chave === k)?.rotulo || capitalizar(k.replace(/_/g, ' ')), valor: v }))
    .sort((a, b) => b.valor - a.valor);

  let corpo = !n
    ? `<p>O Google não lista estabelecimentos dos tipos que atraem recarga em até ${esc(distancia(raio))}.</p>`
    : en.cheio
      ? `<p><strong>20 ou mais em até ${esc(distancia(ate))}</strong>. O Google devolve no máximo 20 por consulta.</p>`
      : `<p><strong>${esc(plural(n, 'estabelecimento', 'estabelecimentos'))} em até ${esc(distancia(ate))}</strong>, dos tipos que atraem recarga.</p>`;

  if (itens.length) corpo += `<div class="grafico">${svgBarras(itens, 'Estabelecimentos por tipo')}</div>`;

  const lista = (en.lista || []).slice(0, 10);
  if (lista.length) corpo += `<h3>Os mais perto</h3><ul class="lugares">${lista.map(itemLugar).join('')}</ul>`;

  if (d.ia?.leitura_do_entorno) corpo += `<p>${esc(d.ia.leitura_do_entorno)}</p>`;
  corpo += '<p class="pequeno">Dados do Google Maps.</p>';
  return secao('entorno', `Entorno em ${distancia(raio)}`, corpo);
}

/**
 * Dois caminhos para ver carregador sem depender da Places API: a busca do Google
 * Maps pelo endereço, que abre no app do consultor, e o PlugShare, que é comunidade
 * e mostra carregador que não está cadastrado no Google.
 */
function botoesDeCarregadores(d: DadosEstudo, arquivado = false): string {
  const e = d.endereco_digitado;
  const m = d.municipio;
  const cidade = m?.nome ? `${m.nome}${m.uf ? `-${m.uf}` : ''}` : (e?.cidade || '');
  const alvo = [e?.rua, e?.numero, e?.bairro, cidade].filter(Boolean).join(', ');
  const lista: Array<[string, string, boolean?]> = [];

  if (alvo) {
    lista.push([
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`carregador de carro elétrico perto de ${alvo}`)}`,
      'Carregadores no Google Maps', true,
    ]);
  }
  // Estudo arquivado perdeu as coordenadas de propósito: o link vai sem ponto.
  const lat = arquivado ? null : (temNumero(d.local?.lat) ? d.local?.lat : (temNumero(m?.lat) ? m?.lat : null));
  const lng = arquivado ? null : (temNumero(d.local?.lng) ? d.local?.lng : (temNumero(m?.lng) ? m?.lng : null));
  lista.push([
    lat != null && lng != null
      ? `https://www.plugshare.com/?latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}&zoom=13`
      : 'https://www.plugshare.com/',
    'Ver no PlugShare',
  ]);
  if (cidade) {
    lista.push([
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`carregador de carro elétrico ${cidade}`)}`,
      'Carregadores na cidade',
    ]);
  }
  return botoes(lista);
}

function secaoRecarga(l: LinhaEstudo, d: DadosEstudo, parcial: boolean): string {
  const rc = d.recarga;
  if (!rc) {
    return parcial
      ? secao('recarga', 'Recarga em 5 km',
          aviso(`Carregadores não consultados agora${motivo(l.fontes, ['recarga'])}.`)
          + botoesDeCarregadores(d, !!l.coords_apagadas_em)
          + '<p class="pequeno">O PlugShare é mantido pela comunidade e mostra carregador que não está cadastrado no Google.</p>')
      : '';
  }
  const raio = temNumero(rc.raio_m) && rc.raio_m > 0 ? rc.raio_m : 5000;
  const n = temNumero(rc.n) ? rc.n : (rc.lista || []).length;
  let corpo: string;
  if (!n) {
    corpo = `<p><strong>Nenhum carregador cadastrado em ${esc(distancia(raio))}.</strong></p>`;
  } else {
    const quantos = rc.cheio ? '20 ou mais carregadores cadastrados' : plural(n, 'carregador cadastrado', 'carregadores cadastrados');
    const perto = temNumero(rc.mais_perto_m) ? `, o mais perto a ${distancia(rc.mais_perto_m)}` : '';
    corpo = `<p><strong>${esc(quantos)}</strong>${esc(perto)}.</p>`;
    const lista = (rc.lista || []).slice(0, 10);
    if (lista.length) corpo += `<ul class="lugares">${lista.map(itemLugar).join('')}</ul>`;
  }
  corpo += botoesDeCarregadores(d, !!l.coords_apagadas_em);
  corpo += '<p class="pequeno">Dados do Google Maps. O PlugShare é mantido pela comunidade e costuma ter carregador que não está no Google.</p>';
  return secao('recarga', `Recarga em ${distancia(raio)}`, corpo);
}

function secaoMercado(l: LinhaEstudo, d: DadosEstudo, parcial: boolean): string {
  const m = d.municipio;
  if (!m) {
    return parcial ? secao('mercado', 'Mercado do município', aviso(`Mercado do município não consultado agora${motivo(l.fontes, ['ibge', 'senatran'])}.`)) : '';
  }
  const semDado = 'Sem dado';
  const ref = m.ref ? `SENATRAN/RENAVAM, ${m.ref}` : 'SENATRAN/RENAVAM';
  const cartao = (rot: string, valor: string, fonte: string) =>
    `<div class="dado"><span class="rot">${esc(rot)}</span><strong>${esc(valor)}</strong><span class="fonte">${esc(fonte)}</span></div>`;

  let corpo = m.nome ? `<p>${esc(m.nome)}${m.uf ? `-${esc(m.uf)}` : ''}</p>` : '';
  corpo += '<div class="dados">'
    + cartao('População 2026', temNumero(m.pop_2026) ? numero(m.pop_2026) : semDado, 'IBGE')
    + cartao('PIB per capita 2023', temNumero(m.pib_pc_2023) ? reais(m.pib_pc_2023) : semDado, 'IBGE')
    + cartao('Frota total', temNumero(m.frota) ? numero(m.frota) : semDado, ref)
    + cartao('Veículos plug-in', temNumero(m.plugin) ? numero(m.plugin) : semDado, ref)
    + '</div>';

  if ([m.por_mil, m.uf_por_mil, m.br_por_mil].some(temNumero)) {
    corpo += `<div class="grafico">${svgBarrasComparadas([
      { rotulo: m.nome || 'Município', valor: temNumero(m.por_mil) ? m.por_mil : null },
      { rotulo: m.uf || 'UF', valor: temNumero(m.uf_por_mil) ? m.uf_por_mil : null },
      { rotulo: 'Brasil', valor: temNumero(m.br_por_mil) ? m.br_por_mil : null },
    ], 'Plug-in por mil veículos', 'por mil')}</div>`;
  }

  const links: Array<[string, string, boolean?]> = [];
  if (m.nome && m.uf) {
    links.push([`https://cidades.ibge.gov.br/brasil/${encodeURIComponent(m.uf.toLowerCase())}/${encodeURIComponent(slugIbge(m.nome))}/panorama`, 'IBGE Cidades']);
  }
  links.push(['https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos-2026', 'Frota no SENATRAN']);
  corpo += botoes(links);
  return secao('mercado', 'Mercado do município', corpo);
}

function payback(p: number | null | undefined): string {
  if (!temNumero(p)) return 'Não paga em 10 anos';
  const t = numero(p, 1);
  return `${t} ${t === '1,0' ? 'ano' : 'anos'}`;
}

function secaoConta(d: DadosEstudo, parcial: boolean): string {
  const k = d.conta;
  if (!k) return parcial ? secao('conta', 'Conta de referência', aviso('Conta de referência não calculada agora.')) : '';

  const cenarios: Array<[string, CenarioConta | undefined]> = [['Piso', k.piso], ['Base', k.base], ['Teto', k.teto]];
  const linha = (rot: string, fn: (x: CenarioConta) => string) =>
    `<tr><th scope="row">${esc(rot)}</th>${cenarios.map(([, x]) => `<td>${esc(x ? fn(x) : 'Sem dado')}</td>`).join('')}</tr>`;

  let corpo = `<p>Configuração de referência: ${esc(numero(k.kw))} kW, investimento de ${esc(reais(k.invest))}.</p>`;
  const declarado = resposta(d, 'Quanto pretende investir');
  if (declarado) corpo += `<p>O cliente disse que pretende investir: <strong>${esc(declarado)}</strong></p>`;

  corpo += '<div class="tabela"><table>'
    + `<thead><tr><th scope="col">Cenário</th>${cenarios.map(([n]) => `<th scope="col">${n}</th>`).join('')}</tr></thead><tbody>`
    + linha('Recargas por dia', x => (temNumero(x.carros) ? numero(x.carros) : 'Sem dado'))
    + linha('Faturamento por mês', x => (temNumero(x.fatMes) ? reais(x.fatMes) : 'Sem dado'))
    + linha('Lucro por mês', x => (temNumero(x.lucroMes) ? reais(x.lucroMes) : 'Sem dado'))
    + linha('Payback', x => payback(x.payback))
    + '</tbody></table></div>';

  corpo += `<div class="grafico">${svgFluxo10Anos(k)}</div>`;

  if (temNumero(k.teto_fisico)) {
    const frase = temNumero(k.recargas_36m)
      ? `Para pagar em 36 meses, este ponto precisa de ${plural(k.recargas_36m, 'recarga', 'recargas')} por dia (o carregador aguenta até ${numero(k.teto_fisico)} por dia).`
      : `Nem no limite do carregador (${plural(k.teto_fisico, 'recarga', 'recargas')} por dia) este ponto paga em 36 meses.`;
    corpo += `<p class="destaque">${esc(frase)}</p>`;
  }

  const p = k.premissas;
  if (p) {
    const itens: string[] = [];
    if (temNumero(p.precoKwh)) itens.push(`Preço do kWh: ${reais(p.precoKwh, 2)}`);
    if (temNumero(p.custoKwh)) itens.push(`Custo do kWh: ${reais(p.custoKwh, 2)}`);
    if (temNumero(p.ativacao)) itens.push(`Ativação: ${reais(p.ativacao, 2)} por recarga`);
    if (temNumero(p.gateway)) itens.push(`Gateway: ${pct(p.gateway)}`);
    if (temNumero(p.imposto)) itens.push(`Imposto: ${pct(p.imposto)}`);
    if (temNumero(p.manut)) itens.push(`Manutenção: ${pct(p.manut)}`);
    if (temNumero(p.arrend) && p.arrend > 0) itens.push(`Arrendamento: ${pct(p.arrend)}`);
    if (temNumero(p.fixos)) itens.push(`${reais(p.fixos)} fixos por mês`);
    itens.push('Seguro de 1% do investimento por ano');
    if (temNumero(p.ocupIni) && temNumero(p.mesesRampa)) {
      itens.push(`Ocupação começa em ${pct(p.ocupIni)} e chega a 100% em ${numero(p.mesesRampa)} meses`);
    }
    if (temNumero(k.carga)) itens.push(`Carga por recarga: ${numeroEnxuto(k.carga, 1)} kWh`);
    corpo += `<h3>Premissas</h3><ul>${itens.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  }

  corpo += '<p class="pequeno">Estimativa com as premissas do simulador da página NEXUS. Não é promessa de retorno. A proposta sai do Simulador.</p>';
  return secao('conta', 'Conta de referência', corpo);
}

function secaoRoteiro(l: LinhaEstudo, d: DadosEstudo, parcial: boolean): string {
  const ia = d.ia;
  const extras = sinaisAtencao(d).slice(3);
  const maisAtencao = extras.length
    ? `<h3>Mais pontos de atenção</h3><ul class="atencao">${extras.map(s => `<li>${esc(s.texto)}</li>`).join('')}</ul>`
    : '';
  if (!ia) {
    if (!parcial && !maisAtencao) return '';
    return secao('roteiro', 'Roteiro da reunião',
      (parcial ? aviso(`Roteiro não escrito agora${motivo(l.fontes, ['ia'])}.`) : '') + maisAtencao);
  }

  let corpo = '';
  const perguntas = (ia.perguntas || []).filter(Boolean);
  if (perguntas.length) corpo += `<h3>Perguntas</h3><ol>${perguntas.map(q => `<li>${esc(q)}</li>`).join('')}</ol>`;
  const cuidados = (ia.cuidados || []).filter(Boolean);
  if (cuidados.length) corpo += `<h3>Cuidados</h3><ul>${cuidados.map(q => `<li>${esc(q)}</li>`).join('')}</ul>`;
  corpo += maisAtencao;
  if (ia.modelo_sugerido) corpo += `<p class="destaque">Modelo NEXUS sugerido: ${esc(ia.modelo_sugerido)}</p>`;
  if (ia.porque_modelo) corpo += `<p>${esc(ia.porque_modelo)}</p>`;
  corpo += `<p class="pequeno">${ia.origem === 'ia'
    ? 'Texto escrito por IA a partir dos dados acima. Números, notas e situação são calculados pelo sistema.'
    : 'Texto padrão do sistema. A IA não respondeu a tempo.'}</p>`;
  return secao('roteiro', 'Roteiro da reunião', corpo);
}

function secaoRespostas(d: DadosEstudo): string {
  const f = d.ficha;
  if (!f) return secao('respostas', 'O que o cliente respondeu', '<p>A ficha não trouxe respostas.</p>');
  let corpo = f.perfil_texto ? `<p>Perfil: <strong>${esc(f.perfil_texto)}</strong></p>` : '';
  if (f.para_investidor) corpo += '<p>Ponto disponível para investidor.</p>';
  const respostas = (f.respostas || []).filter(x => x && x.texto);
  corpo += respostas.length
    ? `<dl class="respostas">${respostas.map(x => `<dt>${esc(x.rotulo)}</dt><dd>${esc(x.texto)}</dd>`).join('')}</dl>`
    : '<p>A ficha não trouxe respostas.</p>';
  return secao('respostas', 'O que o cliente respondeu', corpo);
}

function secaoMetodo(l: LinhaEstudo, d: DadosEstudo): string {
  let corpo = '<h3>Pré-nota</h3>';
  const pn = d.pre_nota;
  if (pn) {
    corpo += '<ul>'
      + `<li>Ponto e controle: ${esc(pn.p)} de 35. Ponto definido com controle do local (dono, administra, representa ou inquilino) vale 35. Local em negociação vale 20. O resto vale 0.</li>`
      + `<li>Perfil: ${esc(pn.q)} de 25. Comércio nomeado ou Outro vale 25. Investidor vale 10.</li>`
      + `<li>Capital: ${esc(pn.c)} de 15. Só pesa para Investidor: recurso próprio 15, financiamento pré-aprovado 12, financiamento pelo CNPJ ou banco ainda não consultado 6, não sabe como pagar 0, modelo 01 sem forma de pagamento 5. Os outros perfis ficam com 15.</li>`
      + '</ul>'
      + `<p>Pré-nota = (P + Q + C) ÷ 75 × 100 = (${esc(pn.p)} + ${esc(pn.q)} + ${esc(pn.c)}) ÷ 75 × 100 = ${esc(pn.valor)} de 100.</p>`;
  } else {
    corpo += '<p>Sem pré-nota neste estudo.</p>';
  }
  corpo += '<p class="pequeno">Faixas: 80 ou mais é prioridade alta, de 60 a 79 é atenção, abaixo de 60 é confirmar antes. A pré-nota informa o consultor e não muda a agenda.</p>';

  corpo += '<h3>Índice de mercado</h3>';
  const comp = d.indice?.componentes;
  const val = (x: number | null | undefined) => (temNumero(x) ? `${numeroEnxuto(x, 1)} de 10` : 'sem dado');
  corpo += '<ul>'
    + `<li>A · Adoção: ${esc(val(comp?.a))}. Plug-in por veículo no município, comparado ao Brasil.</li>`
    + `<li>B · Tamanho: ${esc(val(comp?.b))}. Quantidade de plug-in no município, em escala logarítmica.</li>`
    + `<li>C · Polos a 1 km: ${esc(val(comp?.c))}. Estabelecimentos que atraem recarga, 20 ou mais valem 10.</li>`
    + `<li>D · Espaço para recarga: ${esc(val(comp?.d))}. Plug-in do município por carregador em 5 km, só com 50 plug-in ou mais.</li>`
    + '</ul>';
  corpo += `<p>${d.indice && temNumero(d.indice.valor)
    ? `Índice = média dos componentes com dado = ${esc(numeroEnxuto(d.indice.valor, 1))} de 10.`
    : 'Sem índice: menos de 2 componentes com dado.'}</p>`;
  corpo += '<p class="pequeno">Faixas: 7 ou mais é mercado forte, de 4 a 6,9 é mercado em formação, abaixo de 4 é mercado pequeno hoje. Com endereço aproximado ou não encontrado, fica a confirmar.</p>';

  corpo += '<h3>Fontes</h3>';
  const fontes = Object.entries(l.fontes || {});
  corpo += fontes.length
    ? `<ul>${fontes.map(([k, v]) => `<li>${esc(rotuloFonte(k))}: ${esc(statusFonteLegivel(v))}</li>`).join('')}</ul>`
    : '<p>Nenhuma fonte registrada.</p>';

  const custo = temNumero(l.custo_usd) ? l.custo_usd : 0;
  corpo += `<p>Custo estimado: US$ ${esc(numero(custo, 2))}</p>`;
  corpo += `<p>Versão dos pesos: ${esc(VERSAO_PESOS)}</p>`;
  if (l.pronto_em && !Number.isNaN(Date.parse(l.pronto_em))) corpo += `<p>Estudo pronto ${esc(quando(l.pronto_em))}.</p>`;
  corpo += '<p class="pequeno">Dados do Google Maps · IBGE · SENATRAN/RENAVAM</p>';
  return secao('metodo', 'Como calculamos e fontes', corpo);
}

// ── páginas ────────────────────────────────────────────────────────────────

export function paginaPreparando(r?: ReuniaoEstudo | null): string {
  let topo = MARCA;
  if (r) {
    const nome = primeiroNome(r.cliente_nome);
    if (nome) topo += `<h1>${esc(nome)}</h1>`;
    const meta = [r.cidade || '', `Reunião ${quando(r.quando)}`, r.vendedor_nome ? `Consultor ${r.vendedor_nome}` : ''].filter(Boolean);
    topo += `<p class="meta">${meta.map(esc).join(' · ')}</p>`;
  }
  const corpo = `<header class="topo">${topo}</header>\n`
    + '<section class="card"><p class="destaque">Estudo em preparação. Fica pronto em até 15 minutos.</p>'
    + '<p class="pequeno">Esta página se atualiza sozinha a cada 30 segundos.</p></section>\n'
    + rodape();
  return documento(corpo, '<meta http-equiv="refresh" content="30">\n');
}

export function pagina404(): string {
  const corpo = `<header class="topo">${MARCA}<h1>Estudo não encontrado</h1></header>\n`
    + '<section class="card"><p>Confira o link que chegou no card da agenda.</p></section>\n'
    + rodape();
  return documento(corpo);
}

function paginaDescartada(): string {
  const corpo = `<header class="topo">${MARCA}</header>\n`
    + '<section class="card"><p class="destaque">Esta reunião não está mais na agenda.</p></section>\n'
    + rodape();
  return documento(corpo);
}

function paginaSemEndereco(l: LinhaEstudo, r: ReuniaoEstudo, d: DadosEstudo): string {
  const corpo = cabecalho(l, r, d, !!d.pre_nota)
    + '<section class="card"><p class="destaque">A ficha não trouxe endereço do local, então não há estudo do terreno.</p></section>\n'
    + secaoRespostas(d)
    + rodape();
  return documento(corpo);
}

function paginaErro(l: LinhaEstudo, r: ReuniaoEstudo, d: DadosEstudo): string {
  const e = d.endereco_digitado || null;
  let local = '';
  const links = botoesDoLocal(l, d);
  if (e || links) {
    local = secao('local', 'O local',
      (e ? `<dl class="pares"><dt>Endereço digitado</dt><dd>${esc(textoEndereco(e))}</dd>${e.compl ? `<dt>Referência</dt><dd>${esc(e.compl)}</dd>` : ''}</dl>` : '')
      + links);
  }
  const corpo = cabecalho(l, r, d, !!d.pre_nota)
    + '<section class="card"><p class="aviso">O estudo não conseguiu terminar. Os dados abaixo são os da ficha.</p></section>\n'
    + local
    + secaoRespostas(d)
    + rodape();
  return documento(corpo);
}

function paginaCompleta(l: LinhaEstudo, r: ReuniaoEstudo, opts: { agoraMs: number; imagensLigadas: boolean }, parcial: boolean): string {
  const d: DadosEstudo = l.dados || {};
  const perm = imagensPermitidas(l, r, opts.agoraMs, opts.imagensLigadas);
  const corpo = [
    cabecalho(l, r, d, true),
    parcial ? '<p class="aviso">Estudo parcial. Algumas fontes não responderam, e cada bloco afetado diz qual.</p>\n' : '',
    secao30s(d),
    secaoLocal(l, d, perm, parcial),
    secaoEntorno(l, d, parcial),
    secaoRecarga(l, d, parcial),
    secaoMercado(l, d, parcial),
    secaoConta(d, parcial),
    secaoRoteiro(l, d, parcial),
    secaoRespostas(d),
    secaoMetodo(l, d),
    rodape(),
  ].join('');
  return documento(corpo);
}

export function renderEstudo(l: LinhaEstudo, r: ReuniaoEstudo, opts: { agoraMs: number; imagensLigadas: boolean }): string {
  if (!l) return pagina404();
  const linha: LinhaEstudo = { ...l, dados: l.dados || {}, fontes: l.fontes || {} };
  const d = linha.dados;
  switch (linha.status) {
    case 'pendente':
    case 'processando':
      return paginaPreparando(r);
    case 'descartado':
      return paginaDescartada();
    case 'sem_endereco':
      return paginaSemEndereco(linha, r, d);
    case 'pronto':
      return paginaCompleta(linha, r, opts, false);
    case 'parcial':
      return paginaCompleta(linha, r, opts, true);
    case 'erro':
    default:
      return paginaErro(linha, r, d);
  }
}
