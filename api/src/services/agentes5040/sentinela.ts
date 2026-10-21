// ─────────────────────────────────────────────────────────────────────────────
// SENTINELA DE VENCIMENTOS (avaliação PURA). Sem banco, sem rede, sem envio.
//
// Entra: as leituras do dia (o que cada ferramenta respondeu), o calendário de
// vencimentos (lista que o sócio mantém) e o instante. Sai: a lista de alertas
// e o texto único que o dono recebe, ou null quando não há o que dizer.
//
// REGRAS DE SILÊNCIO (o ponto em que isto mais facilmente erra):
//   - "Não conferido" NUNCA é alerta (Cloudinary sempre; timeout, 429 e 5xx em
//     qualquer leitura). Senão a mensagem sairia todo dia.
//   - O que a ferramenta diz de si MESMA conta: chave recusada, conta do Meta
//     fora do ar, saldo da IA zerado, linha da Z-API caída.
//   - Vencimento: domínio avisa com até 30 dias, o resto com até 7; vencido
//     avisa sempre. Dias contados em dia de Brasília, nunca em milissegundos.
//   - O bloco da Giovanna só entra em dia útil e só enquanto houver o que
//     cobrar (parados dos 24 ou ligação de ontem sem desfecho).
//
// Sem dado pessoal: ferramenta, data, final de cartão (4 dígitos) e observação
// curta do sócio. Nome e telefone de cliente nunca passam por aqui.
// ─────────────────────────────────────────────────────────────────────────────

import { diaBRT, diaDaSemanaBRT, type Instante } from './relogio';
import { ehFeriadoBR } from '../../utils/feriadosBR';

export const LIMITE_DOMINIO_DIAS = 30;
export const LIMITE_PADRAO_DIAS = 7;
export const MAX_ENTRADAS_CALENDARIO = 60;

export type EstadoLeitura = 'ok' | 'falha' | 'baixo' | 'nao_conferido';

/** O que uma ferramenta respondeu hoje. `detalhe` é texto curto, sem segredo e sem URL. */
export interface Leitura {
  ferramenta: string;
  estado: EstadoLeitura;
  detalhe: string;
}

/** Uma linha do calendário que o sócio edita. */
export interface Vencimento {
  ferramenta: string;
  vence_em: string;            // YYYY-MM-DD
  cartao_final?: string;       // 4 dígitos
  observacao?: string;
}

export type TipoAlerta = 'vencido' | 'vence' | 'falha' | 'baixo';

export interface Alerta {
  ferramenta: string;
  tipo: TipoAlerta;
  /** Dias até vencer (negativo = vencido). Só nos alertas de calendário. */
  dias?: number;
  texto: string;
}

/** O que a rodada da Giovanna levanta. A conta toda mora em sentinelaGiovanna.ts. */
export interface ResumoGiovanna {
  /** Sem foto de dia anterior: os desfechos só passam a contar a partir de amanhã. */
  semBase: boolean;
  /** Status novo -> quantos cards saíram de "agendado" para ele desde a foto anterior. */
  desfechos: Record<string, number>;
  totalDesfechos: number;
  /** Tamanho da lista congelada dos parados (era 24 no dia do congelamento). */
  paradosTotal: number;
  /** Quantos deles ainda estão "agendado". */
  paradosFaltam: number;
  /** Ligação do último dia útil que segue "agendado". */
  semDesfecho: number;
  /** A lista dos parados nasceu agora (primeira rodada). */
  paradosNovos?: boolean;
}

// ── datas ────────────────────────────────────────────────────────────────────

const ISO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Número do dia (dias desde 1970) de um YYYY-MM-DD real; null se não existir. */
function numeroDoDia(dia: string): number | null {
  const m = ISO_DIA.exec(dia);
  if (!m) return null;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(a, me - 1, d);
  const x = new Date(t);
  if (x.getUTCFullYear() !== a || x.getUTCMonth() !== me - 1 || x.getUTCDate() !== d) return null;
  return Math.round(t / 86_400_000);
}

/** Dias de calendário (Brasília) de `agora` até `venceEm`. Negativo = já passou. null = data inválida. */
export function diasAte(venceEm: string, agora: Instante): number | null {
  const alvo = numeroDoDia(String(venceEm ?? '').trim());
  const hoje = numeroDoDia(diaBRT(agora));
  if (alvo === null || hoje === null) return null;
  return alvo - hoje;
}

/** Soma `n` dias a um YYYY-MM-DD (calendário puro). */
export function somaDias(dia: string, n: number): string {
  const base = numeroDoDia(dia);
  if (base === null) return '';
  const d = new Date((base + n) * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function ehDiaUtil(dia: string): boolean {
  const n = numeroDoDia(dia);
  if (n === null) return false;
  const dow = new Date(n * 86_400_000).getUTCDay();
  return dow !== 0 && dow !== 6 && !ehFeriadoBR(dia);
}

/** O dia útil anterior a `dia` (pula fim de semana e feriado nacional). */
export function diaUtilAnterior(dia: string): string {
  let d = dia;
  for (let i = 0; i < 10; i++) {
    d = somaDias(d, -1);
    if (!d) return '';
    if (ehDiaUtil(d)) return d;
  }
  return '';
}

/** Hoje (Brasília) é dia útil? */
export function hojeEhDiaUtil(agora: Instante): boolean {
  const dow = diaDaSemanaBRT(agora);
  return dow >= 1 && dow <= 5 && !ehFeriadoBR(diaBRT(agora));
}

// ── calendário ───────────────────────────────────────────────────────────────

/** Domínio pelo nome: não há campo de tipo na lista. */
export function ehDominio(ferramenta: string): boolean {
  const f = String(ferramenta ?? '').toLowerCase();
  return /dom[ií]nio/.test(f) || /\b[a-z0-9-]+\.(app|com|br|net|org|io|dev)\b/.test(f);
}

/** Texto de gente: sem quebra de linha, sem travessão, curto. */
export function limpaTexto(t: unknown, max: number): string {
  return String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Valida e limpa uma lista vinda do banco ou do PUT. Chave desconhecida cai,
 * campo grande é cortado, cartão que não é de 4 dígitos é recusado (devolve
 * erro em vez de gravar).
 */
export function sanearCalendario(bruto: unknown): { ok: true; lista: Vencimento[] } | { ok: false; erro: string } {
  if (!Array.isArray(bruto)) return { ok: false, erro: 'A lista precisa ser um vetor.' };
  if (bruto.length > MAX_ENTRADAS_CALENDARIO) return { ok: false, erro: `No máximo ${MAX_ENTRADAS_CALENDARIO} itens.` };
  const lista: Vencimento[] = [];
  for (let i = 0; i < bruto.length; i++) {
    const x = bruto[i] as Record<string, unknown> | null;
    if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, erro: `Item ${i + 1} inválido.` };
    const ferramenta = limpaTexto(x.ferramenta, 60);
    const venceEm = String(x.vence_em ?? '').trim();
    if (!ferramenta) return { ok: false, erro: `Item ${i + 1} sem ferramenta.` };
    if (numeroDoDia(venceEm) === null) return { ok: false, erro: `Item ${i + 1} com data inválida (use AAAA-MM-DD).` };
    const item: Vencimento = { ferramenta, vence_em: venceEm };
    if (x.cartao_final !== undefined && x.cartao_final !== null && String(x.cartao_final).trim() !== '') {
      const c = String(x.cartao_final).trim();
      if (!/^\d{4}$/.test(c)) return { ok: false, erro: `Item ${i + 1}: o cartão é só o final, 4 dígitos.` };
      item.cartao_final = c;
    }
    const obs = limpaTexto(x.observacao, 120);
    if (obs) item.observacao = obs;
    lista.push(item);
  }
  return { ok: true, lista };
}

const maiuscula = (t: string): string => (t ? t[0]!.toUpperCase() + t.slice(1) : t);

// ── avaliação ────────────────────────────────────────────────────────────────

function quando(dias: number): string {
  if (dias < 0) return dias === -1 ? 'venceu ontem' : `venceu há ${-dias} dias`;
  if (dias === 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  return `vence em ${dias} dias`;
}

/**
 * Os alertas do dia. Vazio = está tudo em dia. A ordem é a que o dono lê:
 * vencido, falha, saldo baixo, vencimento próximo (do mais perto ao mais longe).
 */
export function avaliar(leituras: readonly Leitura[], calendario: readonly Vencimento[], agora: Instante): Alerta[] {
  const saida: Alerta[] = [];

  for (const v of calendario ?? []) {
    const dias = diasAte(v.vence_em, agora);
    if (dias === null) {
      saida.push({ ferramenta: v.ferramenta, tipo: 'falha', texto: `${v.ferramenta}: a data do vencimento no calendário está inválida` });
      continue;
    }
    const limite = ehDominio(v.ferramenta) ? LIMITE_DOMINIO_DIAS : LIMITE_PADRAO_DIAS;
    if (dias > limite) continue;
    const cartao = v.cartao_final ? `, cartão final ${v.cartao_final}` : '';
    const obs = v.observacao ? `. ${limpaTexto(v.observacao, 120)}` : '';
    saida.push({
      ferramenta: v.ferramenta,
      tipo: dias < 0 ? 'vencido' : 'vence',
      dias,
      texto: `${v.ferramenta} ${quando(dias)} (${v.vence_em.slice(8, 10)}/${v.vence_em.slice(5, 7)})${cartao}${obs}`,
    });
  }

  for (const l of leituras ?? []) {
    if (l.estado === 'falha') saida.push({ ferramenta: l.ferramenta, tipo: 'falha', texto: `${l.ferramenta}: ${limpaTexto(l.detalhe, 160)}` });
    else if (l.estado === 'baixo') saida.push({ ferramenta: l.ferramenta, tipo: 'baixo', texto: `${l.ferramenta}: ${limpaTexto(l.detalhe, 160)}` });
    // 'ok' e 'nao_conferido' nunca viram alerta.
  }

  const peso: Record<TipoAlerta, number> = { vencido: 0, falha: 1, baixo: 2, vence: 3 };
  return saida.sort((a, b) => peso[a.tipo] - peso[b.tipo] || (a.dias ?? 0) - (b.dias ?? 0));
}

// ── Giovanna ─────────────────────────────────────────────────────────────────

const ROTULO_STATUS: Record<string, string> = {
  vendido: 'vendido',
  cancelado: 'cancelado',
  'sem interesse': 'sem interesse',
  'nao atendeu': 'não atendeu',
  'não atendeu': 'não atendeu',
  apalavrado: 'apalavrado',
  'fez orcamento': 'fez orçamento',
  'fez orçamento': 'fez orçamento',
  proposta: 'proposta',
};

export function rotuloStatus(s: string): string {
  const k = String(s ?? '').trim().toLowerCase();
  return ROTULO_STATUS[k] ?? (limpaTexto(k, 24) || 'outro');
}

/** Diferença entre a foto de ontem e a de hoje: quem estava "agendado" e agora não está. */
export function diferencaSnapshots(
  anterior: Record<string, string> | null | undefined,
  atual: Record<string, string>,
): { semBase: boolean; desfechos: Record<string, number>; total: number } {
  if (!anterior || typeof anterior !== 'object') return { semBase: true, desfechos: {}, total: 0 };
  const desfechos: Record<string, number> = {};
  let total = 0;
  for (const [id, antes] of Object.entries(anterior)) {
    if (String(antes).toLowerCase() !== 'agendado') continue;
    const agora = atual[id];
    if (agora === undefined || String(agora).toLowerCase() === 'agendado') continue;
    const r = rotuloStatus(agora);
    desfechos[r] = (desfechos[r] ?? 0) + 1;
    total++;
  }
  return { semBase: false, desfechos, total };
}

/** Há o que cobrar da Giovanna hoje? Fila em dia = bloco calado. */
export function giovannaPedeAtencao(g: ResumoGiovanna | null | undefined): boolean {
  return !!g && (g.paradosFaltam > 0 || g.semDesfecho > 0);
}

export function blocoGiovanna(g: ResumoGiovanna): string {
  const linhas: string[] = ['Giovanna, resumo do dia:'];
  if (g.semBase) {
    linhas.push('Hoje é o primeiro dia sem foto anterior, então os desfechos começam a contar amanhã.');
  } else if (g.totalDesfechos === 0) {
    linhas.push('Desfechos desde a última foto: nenhum.');
  } else {
    const partes = Object.entries(g.desfechos).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} ${s}`);
    linhas.push(`Desfechos desde a última foto: ${g.totalDesfechos} (${partes.join(', ')}).`);
  }
  linhas.push(`Parados da lista de ${g.paradosTotal}: faltam ${g.paradosFaltam}.`);
  linhas.push(`Ligação do último dia útil sem desfecho: ${g.semDesfecho}.`);
  return linhas.join('\n');
}

// ── mensagem ─────────────────────────────────────────────────────────────────

/**
 * O texto único do dia, ou null quando não há nada a dizer. Uma bolha só:
 * nunca devolve duas mensagens.
 */
export function montarMensagem(entrada: {
  alertas: readonly Alerta[];
  giovanna?: ResumoGiovanna | null;
  agora: Instante;
}): string | null {
  const alertas = entrada.alertas ?? [];
  const comGiovanna = hojeEhDiaUtil(entrada.agora) && giovannaPedeAtencao(entrada.giovanna);
  if (!alertas.length && !comGiovanna) return null;

  const dia = diaBRT(entrada.agora);
  const cab = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  const partes: string[] = [];
  if (alertas.length) {
    const ls = alertas.slice(0, 12).map(a => maiuscula(a.texto));
    if (alertas.length > 12) ls.push(`Mais ${alertas.length - 12} itens no calendário.`);
    partes.push(`Sentinela das ferramentas, ${cab}. Pede ação:\n${ls.join('\n')}`);
  } else {
    partes.push(`Sentinela das ferramentas, ${cab}. Ferramentas em dia.`);
  }
  if (comGiovanna && entrada.giovanna) partes.push(blocoGiovanna(entrada.giovanna));
  return partes.join('\n\n');
}
