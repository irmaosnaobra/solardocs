// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): as regras PURAS das mensagens (sem banco, sem relógio e sem envio).
//
// O que dispara (eventos gravados por gente), a fila das 08:00 com a escalada, o "Falta", o dinheiro pendente e o placar, os toques de
// aniversário, as janelas e todos os TEXTOS. Quem lê o banco é `jornadaMensagensBase.ts`; quem envia são os três arquivos
// `jornadaAvisoEquipe.ts`, `jornadaLiberacao.ts` e `jornadaAniversario.ts`.
//
// NENHUM nome de robô mora aqui (a `chefeGuarda` lê o `robo` pelo arquivo de envio). Nada aqui lê `new Date()` sozinho nem escreve em log.
// ─────────────────────────────────────────────────────────────────────────────
import {
  CURTOS_ETAPA, NOMES_ETAPA, POR_QUE_NAO_E_GENTE, ddmm, donosDaEtapa, prazoDaEtapa, situacao, type EstadoJornada,
} from '../gerador/jornadaSolar';
import { etapaAtualCompleta, prazoDaEtapaObra, situacaoObra, type EstadoObra } from '../gerador/jornadaObra';
import { reaisBR, veRetiradaDosSocios } from '../gerador/jornadaDinheiro';
import { ehAdm } from '../gerador/solarObras';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import { diaBRT, diaDaSemanaBRT, horaBRT } from '../agentes5040/relogio';

export const GRUPOS_MSG = ['venda', 'etapa', 'fila', 'liberacao', 'aniversario'] as const;
export type GrupoMsg = typeof GRUPOS_MSG[number];
export const GRUPOS_EQUIPE: readonly GrupoMsg[] = ['venda', 'etapa', 'fila'];
export const GRUPOS_CLIENTE: readonly GrupoMsg[] = ['liberacao', 'aniversario'];
export const PREFIXO_ENV = 'jornada_env:';
export const PREFIXO_LIB = 'jornada_lib_sent:';
export const PREFIXO_POS = 'jornada_pos_sent:';
export const PREFIXO_VEZ = 'jornada_vez:';
export const PESSOAS_FILA = ['thiago', 'diego', 'giovanna', 'nilce'] as const;
export const POR_QUE_NAO_DISPARA: ReadonlySet<string> = POR_QUE_NAO_E_GENTE;
export const VALE_EQUIPE_MS = 24 * 3600_000;
export const VALE_LIBERACAO_MS = 7 * 24 * 3600_000;
export const LIMITE_POR_PESSOA_HORA = 12;
export const TETO_FILA_LINHAS = 25;

// ── Pequenos ajudantes ───────────────────────────────────────────────────────────────────────────────────────────────

export const nomeBonitoMsg = (n: string): string => (n ? n.charAt(0).toUpperCase() + n.slice(1) : n);
/** O nome do card como entra numa mensagem: sem `*`, `_` e `~` (que o WhatsApp lê como formatação). */
export const nomeLimpo = (n: unknown): string => String(n ?? '').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim();
/** "Uberlândia - MG" vira "Uberlândia-MG". */
export const cidadeLimpa = (c: unknown): string => nomeLimpo(c).replace(/\s*-\s*/g, '-');
/** `#NNNN Nome` com número e só `Nome` sem. Nunca o `*` da venda sem número. */
export const rotulo = (codigo: string | null | undefined, nome: unknown): string => {
  const n = nomeLimpo(nome);
  return codigo && /^#\d{3,6}$/.test(codigo) ? `${codigo} ${n}` : n;
};
const ymdMais = (ymd: string, dias: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
export const diasEntre = (de: string, ate: string): number =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
const bissexto = (ano: number): boolean => (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
/** O MM-DD deste ano; o 29/02 vira 28/02 no ano que não é bissexto. */
export const dataDoAno = (mmdd: string, ano: number): string => {
  const [m, d] = mmdd.split('-');
  return m === '02' && d === '29' && !bissexto(ano) ? `${ano}-02-28` : `${ano}-${m}-${d}`;
};

// ── Janelas ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A fila das 08:00: segunda a sábado, fora de feriado nacional, de 08:00 a 08:30 de Brasília (11:00 a 11:30 UTC; o cron roda de 3 em 3 minutos). */
export function naJanelaDaFila(agora: Date): boolean {
  const dow = diaDaSemanaBRT(agora);
  if (dow < 1 || dow > 6 || ehFeriadoBR(diaBRT(agora))) return false;
  return horaBRT(agora) === 8 && agora.getUTCMinutes() <= 30;
}

/** `AAAAMMDDHHmm` (UTC) do minuto par para baixo: a vez de uma rodada. */
export function minutoDaVez(agora: Date): string {
  const i = agora.toISOString();
  const min = Math.floor(agora.getUTCMinutes() / 2) * 2;
  return `${i.slice(0, 4)}${i.slice(5, 7)}${i.slice(8, 10)}${i.slice(11, 13)}${String(min).padStart(2, '0')}`;
}

// ── Chaves de trava e carimbo (2.2): nenhum telefone, nome, texto ou data pessoal ─────────────────────────────────────────────────

export const chaveVenda = (card: number, pessoa: string): string => `${PREFIXO_ENV}venda:${card}:${pessoa}`;
export const chaveSua = (card: number, n: number, pessoa: string): string => `${PREFIXO_ENV}sua:${card}:${n}:${pessoa}`;
export const chaveEspera = (card: number, n: number, ate: string, pessoa: string): string => `${PREFIXO_ENV}espera:${card}:${n}:${ate}:${pessoa}`;
export const chaveFila = (dia: string, pessoa: string): string => `${PREFIXO_ENV}fila:${dia}:${pessoa}`;
export const chaveLiberacao = (card: number): string => `${PREFIXO_LIB}${card}`;
export const chavePos = (card: number, toque: 'aniv' | 'usina', ano: number): string => `${PREFIXO_POS}${card}:${toque}:${ano}`;

// ── Os eventos que disparam (só o gravado por gente, depois do "ligado em") ───────────────────────────────────────────────────────

export interface EntradaCard { card: number; js: EstadoJornada | null; jo: EstadoObra | null; vendedor: string }
export interface EventoMsg {
  grupo: 'venda' | 'etapa'; tipo: 'venda' | 'sua' | 'espera'; etapa: number; em: string; por: string; para: string[]; chaves: string[];
}
const semRepetir = (l: string[]): string[] => [...new Set(l)];

/**
 * Os eventos de UM card. A venda deduzida (sem `js` e sem `jo` assinados) NUNCA dispara. `ligados` traz o `ligado_em` de cada grupo
 * LIGADO (null = desligado). `aceitarSonda` só é passado pela rota da sonda, no card da sonda. `equipeVenda` (os telefones da equipe
 * vêm de fora, nunca do arquivo): quem recebe o aviso de venda.
 */
export function eventosDoCard(
  entrada: EntradaCard, agora: Date, ligados: Record<GrupoMsg, string | null>,
  opts: { aceitarSonda?: boolean; equipeVenda?: readonly string[] } = {},
): EventoMsg[] {
  const { card, js, jo, vendedor } = entrada;
  if (!js && !jo) return [];
  if (js?.cancelada) return [];
  const gente = (por: string): boolean => !POR_QUE_NAO_DISPARA.has(por) || (opts.aceitarSonda === true && por === 'sonda');
  const vale = (grupo: 'venda' | 'etapa', em: string, por: string, acao: string): boolean => {
    const desde = ligados[grupo];
    if (!desde || !gente(por) || acao === 'materializada') return false;
    const t = Date.parse(em);
    return Number.isFinite(t) && em > desde && agora.getTime() - t <= VALE_EQUIPE_MS && agora.getTime() - t >= -60_000;
  };
  const etapaAgora = etapaAtualCompleta(js, jo, null);
  const saida: EventoMsg[] = [];

  for (const h of js?.historico ?? []) {
    if ((h.acao as string) === 'venda_completa' && js?.origem === 'vendido' && vale('venda', h.em, h.por, h.acao)) {
      const para = semRepetir([...(opts.equipeVenda ?? [])]);
      saida.push({ grupo: 'venda', tipo: 'venda', etapa: 1, em: h.em, por: h.por, para, chaves: para.map((p) => chaveVenda(card, p)) });
    }
  }
  const candidatos: Array<{ h: { em: string; por: string; acao: string; etapa: number | null }; origem: 'js' | 'jo' }> = [
    ...(js?.historico ?? []).map((h) => ({ h, origem: 'js' as const })),
    ...(jo?.historico ?? []).map((h) => ({ h, origem: 'jo' as const })),
  ];
  for (const { h, origem } of candidatos) {
    const k = h.etapa;
    if (k === null || !Number.isInteger(k)) continue;
    // A Fase 1 manda nas etapas 1 a 3; a Fase 2, nas 4 a 8.
    if ((origem === 'js') !== (k >= 1 && k <= 3)) continue;
    if (h.acao === 'concluir' && k >= 1 && k <= 7) {
      const n = k + 1;
      if (!vale('etapa', h.em, h.por, h.acao) || etapaAgora !== n) continue;
      const para = semRepetir(donosDaEtapa(n, vendedor).filter((p) => p !== h.por));
      saida.push({ grupo: 'etapa', tipo: 'sua', etapa: n, em: h.em, por: h.por, para, chaves: para.map((p) => chaveSua(card, n, p)) });
    } else if (h.acao === 'esperar' && k >= 1 && k <= 8) {
      const esp = origem === 'js' ? js?.esperando : jo?.esperando;
      if (!esp || esp.em !== h.em || esp.etapa !== k || !vale('etapa', h.em, h.por, h.acao)) continue;
      const para = semRepetir([...donosDaEtapa(k, vendedor), 'thiago'].filter((p) => p !== h.por));
      saida.push({ grupo: 'etapa', tipo: 'espera', etapa: k, em: h.em, por: h.por, para, chaves: para.map((p) => chaveEspera(card, k, esp.ate, p)) });
    }
  }
  return saida.sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0));
}

// ── A fila das 08:00 ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface ObraFila {
  card: number; codigo: string | null; cliente: string; cidade: string; vendedor: string;
  js: EstadoJornada | null; jo: EstadoObra | null; cancelada: boolean;
}
export interface ItemFila {
  tipo: 'atrasada' | 'vence_hoje' | 'no_prazo' | 'sem_prazo'; card: number; rotulo: string; etapaCurta: string; dias?: number; vence?: string;
}

function situacaoDaObra(o: ObraFila, n: number, hoje: string) {
  return n <= 3 ? situacao(n, o.js, hoje) : situacaoObra(n, o.js, o.jo, hoje);
}
function etapaDaObra(o: ObraFila): number | null {
  if ((!o.js && !o.jo) || o.cancelada || o.js?.cancelada) return null;
  const n = etapaAtualCompleta(o.js, o.jo, null);
  return n !== null && n >= 1 && n <= 8 ? n : null;
}

/** A fila de UMA pessoa: o que está na etapa dela, só de obra com estado gravado e assinado. A espera não entra. */
export function filaDaPessoa(pessoa: string, obras: readonly ObraFila[], hoje: string): { itens: ItemFila[] } {
  const itens: ItemFila[] = [];
  for (const o of obras) {
    const n = etapaDaObra(o);
    if (n === null || !donosDaEtapa(n, o.vendedor).includes(pessoa)) continue;
    const s = situacaoDaObra(o, n, hoje);
    if (s.tipo === 'esperando') continue;
    const base = { card: o.card, rotulo: rotulo(o.codigo, o.cliente), etapaCurta: CURTOS_ETAPA[n] };
    if (s.tipo === 'atrasada' || s.tipo === 'travada') itens.push({ ...base, tipo: 'atrasada', dias: s.dias ?? 1, vence: s.vence });
    else if (s.tipo === 'vence_hoje') itens.push({ ...base, tipo: 'vence_hoje', vence: s.vence });
    else if (s.tipo === 'no_prazo') itens.push({ ...base, tipo: 'no_prazo', vence: s.vence });
    else itens.push({ ...base, tipo: 'sem_prazo' });
  }
  const ordem = { atrasada: 0, vence_hoje: 1, no_prazo: 2, sem_prazo: 3 } as const;
  itens.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]
    || (a.tipo === 'atrasada' ? (b.dias ?? 0) - (a.dias ?? 0) : a.tipo === 'no_prazo' ? String(a.vence).localeCompare(String(b.vence)) : 0)
    || a.card - b.card);
  return { itens };
}

export interface ItemEscalada { card: number; rotulo: string; etapa: number; etapaCurta: string; dono: string; dias: number; falta?: string[] }

/** A escalada: a etapa atual está com outra gente, atrasada ou travada há 2 dias úteis ou mais. Mais dias primeiro. */
export function paradosComAEquipe(obras: readonly ObraFila[], hoje: string): ItemEscalada[] {
  const saida: ItemEscalada[] = [];
  for (const o of obras) {
    const n = etapaDaObra(o);
    if (n === null) continue;
    const donos = donosDaEtapa(n, o.vendedor);
    if (donos.includes('thiago')) continue;
    const s = situacaoDaObra(o, n, hoje);
    if ((s.tipo !== 'atrasada' && s.tipo !== 'travada') || (s.dias ?? 0) < 2) continue;
    saida.push({
      card: o.card, rotulo: rotulo(o.codigo, o.cliente), etapa: n, etapaCurta: CURTOS_ETAPA[n],
      dono: donos.map(nomeBonitoMsg).join(' e '), dias: s.dias ?? 2,
    });
  }
  return saida.sort((a, b) => b.dias - a.dias || a.card - b.card);
}

export interface LinhaPlacar { pessoa: string; noPrazo: number; atrasadas: number }
const ORDEM_PLACAR = ['nilce', 'giovanna', 'thiago', 'diego'] as const;

/**
 * O placar da semana ANTERIOR (segunda 00:00 a domingo 23:59 de Brasília) a partir da `segunda` de hoje: cada `concluir` da semana por
 * gente da equipe conta no prazo (dia da conclusão até o `vence` da etapa, ou sem `vence`) ou atrasado; mais as etapas abertas hoje
 * atrasadas ou travadas, de cada dono. A espera não entra: é a simplificação escrita.
 */
export function placarDaSemana(obras: readonly ObraFila[], segunda: string, hoje: string = segunda): LinhaPlacar[] {
  const ini = ymdMais(segunda, -7);
  const fim = ymdMais(segunda, -1);
  const soma = new Map<string, { noPrazo: number; atrasadas: number }>();
  const conta = (p: string) => { let x = soma.get(p); if (!x) { x = { noPrazo: 0, atrasadas: 0 }; soma.set(p, x); } return x; };
  for (const o of obras) {
    if (!o.js && !o.jo) continue;
    const todos: Array<{ em: string; por: string; acao: string; etapa: number | null; de: 'js' | 'jo' }> = [
      ...(o.js?.historico ?? []).map((h) => ({ ...h, de: 'js' as const })), ...(o.jo?.historico ?? []).map((h) => ({ ...h, de: 'jo' as const })),
    ];
    for (const h of todos) {
      const k = h.etapa;
      if (h.acao !== 'concluir' || k === null || (h.de === 'js') !== (k >= 1 && k <= 3) || k < 1 || k > 8) continue;
      if (!(PESSOAS_FILA as readonly string[]).includes(h.por)) continue;
      const dia = diaBRT(h.em);
      if (!dia || dia < ini || dia > fim) continue;
      const vence = k <= 3 ? prazoDaEtapa(k, o.js).vence : prazoDaEtapaObra(k, o.js, o.jo).vence;
      if (!vence || dia <= vence) conta(h.por).noPrazo++; else conta(h.por).atrasadas++;
    }
    const n = etapaDaObra(o);
    if (n !== null) {
      const s = situacaoDaObra(o, n, hoje);
      if (s.tipo === 'atrasada' || s.tipo === 'travada') for (const d of donosDaEtapa(n, o.vendedor)) if ((PESSOAS_FILA as readonly string[]).includes(d)) conta(d).atrasadas++;
    }
  }
  return ORDEM_PLACAR.filter((p) => soma.has(p)).map((p) => ({ pessoa: p, ...soma.get(p)! })).filter((x) => x.noPrazo + x.atrasadas > 0);
}

// ── O dinheiro pendente (cobrado de quem resolve) ─────────────────────────────────────────────────────────────────────────────

export interface DinheiroObra {
  card: number; rotulo: string;
  /** Comissão ainda por pagar nesta obra (a de quem vendeu e a do sócio, que é retirada). */
  comissoes: Array<{ valor_centavos: number; papel: 'venda' | 'socio' }>;
  a_receber_centavos: number;
  /** Lançamentos que a IA não conferiu e o Thiago ainda não marcou; os da retirada à parte. */
  nao_conferidas: number;
  nao_conferidas_retirada: number;
  /** Saídas lançadas sem comprovante e ainda pendentes (nem anexadas, nem liberadas pelo ADM), com quem lançou. */
  sem_comprovante?: Array<{ criado_por: string; valor_centavos: number; retirada: boolean }>;
}

/** As linhas do livro que ainda esperam comprovante, com quem lançou (a fila cobra de quem LANÇOU). */
export function semComprovanteDoLivro(linhas: ReadonlyArray<{ sem_comprovante: boolean; criado_por: string; valor_centavos: number; grupo: string }>): NonNullable<DinheiroObra['sem_comprovante']> {
  return linhas.filter((l) => l.sem_comprovante).map((l) => ({ criado_por: l.criado_por, valor_centavos: l.valor_centavos, retirada: l.grupo === 'retirada' }));
}

/**
 * O bloco "Falta comprovante" de UMA pessoa: as obras onde ELA lançou saída sem comprovante, com a obra e o valor. Uma linha por obra.
 * A retirada dos sócios só entra para quem pode vê-la. Quem não lançou nada não ganha o bloco.
 */
export function linhasSemComprovante(pessoa: string, obras: readonly DinheiroObra[]): string[][] {
  const ver = veRetiradaDosSocios(pessoa, ehAdm(pessoa));
  const saida: string[][] = [];
  for (const o of obras) {
    const meus = (o.sem_comprovante ?? []).filter((x) => x.criado_por === pessoa && (!x.retirada || ver));
    if (!meus.length) continue;
    const total = meus.reduce((s, x) => s + x.valor_centavos, 0);
    saida.push([`Falta comprovante: ${o.rotulo} · ${meus.length > 1 ? `${meus.length} lançamentos, ` : ''}${reaisBR(total)}`]);
  }
  return saida;
}

/**
 * As linhas de dinheiro de UMA pessoa. A Giovanna cobra comissão e recebimento; o Thiago cobra o que não foi conferido. A retirada dos
 * sócios só aparece para quem pode vê-la (o ADM e a Giovanna). Os outros não recebem bloco de dinheiro.
 */
export function linhasDeDinheiro(pessoa: string, obras: readonly DinheiroObra[]): string[][] {
  const ver = veRetiradaDosSocios(pessoa, ehAdm(pessoa));
  const saida: string[][] = [];
  const comissao: string[][] = []; const receber: string[][] = []; const conferir: string[][] = [];
  for (const o of obras) {
    if (pessoa === 'giovanna') {
      const valor = o.comissoes.filter((c) => c.papel === 'venda' || ver).reduce((s, c) => s + c.valor_centavos, 0);
      if (valor > 0) comissao.push([`Comissão a pagar: ${o.rotulo} · ${reaisBR(valor)}`]);
      if (o.a_receber_centavos > 0) receber.push([`A receber: ${o.rotulo} · ${reaisBR(o.a_receber_centavos)}`]);
    } else if (pessoa === 'thiago') {
      const n = o.nao_conferidas + (ver ? o.nao_conferidas_retirada : 0);
      if (n > 0) conferir.push([`Para conferir: ${o.rotulo} · ${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`]);
    }
  }
  saida.push(...comissao, ...receber, ...conferir);
  return saida;
}

// ── Os toques de aniversário ─────────────────────────────────────────────────────────────────────────────────────────────

export type CacheNascimento = Map<number, { aniv: string | null; liberada: string | null }>;
export interface ToqueDoDia { card: number; toque: 'aniv' | 'usina'; ano: number; atrasado: boolean; anos?: number }

/**
 * Os toques que valem HOJE (D, D+1 ou D+2): nunca retroativo (D igual ou depois do `ligado_em` ATUAL do grupo e depois da conclusão da
 * etapa 8) e só de obra concluída por gente DEPOIS do `primeiro_ligado_em`. `aniv` vem do MM-DD do nascimento; `usina`, da data da liberação.
 */
export function toquesDoDia(
  cache: CacheNascimento, hoje: string, ligadoEmAtual: string, primeiroLigadoEm: string, concluidas8: ReadonlyMap<number, string>,
): ToqueDoDia[] {
  const saida: ToqueDoDia[] = [];
  const piso = diaBRT(ligadoEmAtual);
  const anoHoje = Number(hoje.slice(0, 4));
  for (const [card, c8] of concluidas8) {
    if (!(c8 > primeiroLigadoEm)) continue;
    const dc8 = diaBRT(c8);
    const dados = cache.get(card);
    if (!dados || !dc8) continue;
    const vale = (d: string): boolean => {
      const diff = diasEntre(d, hoje);
      return diff >= 0 && diff <= 2 && d >= piso && d > dc8;
    };
    if (dados.aniv && /^\d{2}-\d{2}$/.test(dados.aniv)) {
      for (const ano of [anoHoje, anoHoje - 1]) {
        const d = dataDoAno(dados.aniv, ano);
        if (vale(d)) { saida.push({ card, toque: 'aniv', ano, atrasado: hoje > d }); break; }
      }
    }
    if (dados.liberada && /^\d{4}-\d{2}-\d{2}$/.test(dados.liberada)) {
      const anoLib = Number(dados.liberada.slice(0, 4));
      for (const ano of [anoHoje, anoHoje - 1]) {
        const anos = ano - anoLib;
        if (anos < 1) continue;
        const d = dataDoAno(dados.liberada.slice(5), ano);
        if (vale(d)) { saida.push({ card, toque: 'usina', ano, atrasado: hoje > d, anos }); break; }
      }
    }
  }
  return saida.sort((a, b) => a.card - b.card || (a.toque < b.toque ? -1 : 1));
}

// ── Os textos ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const PRAZO_TEXTO: Record<number, (d: string | null) => string> = {
  2: (d) => (d ? `3 dias úteis, até ${ddmm(d)}.` : '3 dias úteis.'),
  3: (d) => (d ? `protocolar em 2 dias úteis, até ${ddmm(d)}.` : 'protocolar em 2 dias úteis.'),
  4: (d) => (d ? `2 dias úteis, até ${ddmm(d)}.` : '2 dias úteis.'),
  5: (d) => (d ? `material na obra até ${ddmm(d)}.` : 'marque os dias da obra na etapa 6.'),
  6: (d) => (d ? `último dia da obra, ${ddmm(d)}.` : 'marque os dias da obra.'),
  7: (d) => (d ? `1 dia útil, até ${ddmm(d)}.` : '1 dia útil.'),
  8: (d) => (d ? `pedir a vistoria em 1 dia útil, até ${ddmm(d)}.` : 'pedir a vistoria em 1 dia útil.'),
};
const PARA_CONCLUIR: Record<number, string> = {
  2: 'contrato e procuração assinados e anexados.',
  3: 'cartão do Trello, ART, protocolo com print e parecer de acesso.',
  4: 'cada item comprado com comprovante.',
  5: 'cargas na obra e conferidas, com nota e frete pago.',
  6: 'diário de cada dia com fotos, checklist e equipe paga.',
  7: 'fotos, testes, monitoramento e termo de entrega assinado.',
  8: 'pedido, vistoria e liberação com print, e a conta zerada.',
};
const MOTIVO_TEXTO: Record<string, string> = {
  cliente: 'o cliente pediu para esperar.', cemig: 'esperando a Cemig.', fornecedor: 'esperando o fornecedor.', banco: 'esperando o banco.',
};
const LINHA_LINK = (link: string | null): string[] =>
  (link ? [`Conhece alguém que quer pagar menos na conta de luz? Mande este link para ele: ${link}`] : []);

const kwpTexto = (kwp: number): string => kwp.toFixed(2).replace('.', ',');

/** 7.1 · o aviso de venda (a única mensagem com emoji em várias linhas e exclamação, por exceção do dono). */
export function textoVenda(a: { nome: string; cidade: string; kwp: number | null; placas: number | null; vendedor: string }): string {
  const partes = [cidadeLimpa(a.cidade), a.kwp ? `${kwpTexto(a.kwp)} kWp` : '', a.placas ? `${a.placas} ${a.placas === 1 ? 'placa' : 'placas'}` : ''].filter(Boolean);
  const linhas = [
    '🎉🎉🎉 VENDEU! ☀️☀️☀️',
    `*${nomeLimpo(a.nome)}* 🏠`,
    ...(partes.length ? [`${partes.join(' · ')} ⚡`] : []),
    `Quem vendeu: *${nomeBonitoMsg(a.vendedor)}* 🏆👏`,
    'Agora é a vistoria. Bora, time! 🚀',
  ];
  return linhas.join('\n');
}

/** 7.2 · "É sua". `vence` é o prazo da etapa que abriu. */
export function textoSua(a: { n: number; codigo: string | null; nome: string; cidade: string; vence: string | null }): string {
  const nome = nomeLimpo(a.nome); const cidade = cidadeLimpa(a.cidade);
  const numero = a.codigo && /^#\d{3,6}$/.test(a.codigo) ? a.codigo : null;
  const prazo = (PRAZO_TEXTO[a.n] ?? (() => ''))(a.vence);
  return [
    numero ? `📌 É sua: ${NOMES_ETAPA[a.n]} da obra ${numero}` : `📌 É sua: ${NOMES_ETAPA[a.n]} de ${nome}`,
    numero ? [nome, cidade].filter(Boolean).join(' · ') : cidade,
    `*Prazo:* ${prazo}`,
    `*Para concluir:* ${PARA_CONCLUIR[a.n] ?? ''}`,
  ].filter((l, i) => i !== 1 || l).join('\n');
}

/** 7.5 · "Esperando". */
export function textoEspera(a: { codigo: string | null; nome: string; n: number; ate: string; marcou: string; motivo: string }): string {
  return [
    `⏸️ ${rotulo(a.codigo, a.nome)} em espera até ${ddmm(a.ate)}`,
    `*Etapa:* ${CURTOS_ETAPA[a.n]} · *Marcou:* ${nomeBonitoMsg(a.marcou)}`,
    `*Motivo:* ${MOTIVO_TEXTO[a.motivo] ?? 'esperando.'}`,
    `*A cobrança volta em ${ddmm(a.ate)}.*`,
  ].join('\n');
}

function linhaDoItem(i: ItemFila, hoje: string): string {
  if (i.tipo === 'atrasada') {
    const d = i.dias ?? 1;
    return `*Atrasada:* ${i.rotulo} · ${i.etapaCurta} · ${d} ${d === 1 ? 'dia' : 'dias'}${d >= 3 ? ' · Travada' : ''}`;
  }
  if (i.tipo === 'vence_hoje') return `*Vence hoje:* ${i.rotulo} · ${i.etapaCurta}`;
  if (i.tipo === 'no_prazo') {
    const amanha = !!i.vence && diasEntre(hoje, i.vence) === 1;
    return `*No prazo:* ${i.rotulo} · ${i.etapaCurta} · ${amanha ? 'amanhã' : ddmm(i.vence ?? hoje)}`;
  }
  return `*Sem prazo:* ${i.rotulo} · ${i.etapaCurta}`;
}

function linhasDaEscalada(x: ItemEscalada): string[] {
  const l = [`${x.rotulo} · ${x.etapaCurta} · ${x.dono} · ${x.dias} ${x.dias === 1 ? 'dia' : 'dias'}${x.dias >= 3 ? ' · Travada' : ''}`];
  const falta = (x.falta ?? []).filter(Boolean);
  if (falta.length) l.push(`Falta: ${falta.slice(0, 3).join('; ')}${falta.length > 3 ? ` e mais ${falta.length - 3}` : ''}`);
  return l;
}

/** Corta uma lista de blocos de linhas no que ainda cabe no teto; devolve as linhas e quantos blocos ficaram de fora. */
function caber(blocos: readonly (readonly string[])[], restante: number): { linhas: string[]; fora: number; usou: number } {
  const linhas: string[] = []; let fora = 0; let usou = 0;
  for (const b of blocos) {
    if (usou + b.length <= restante) { linhas.push(...b); usou += b.length; } else fora++;
  }
  return { linhas, fora, usou };
}

/**
 * 7.3 · a fila de UMA pessoa. O Thiago leva a escalada (e, na segunda, o placar); a Giovanna e o Thiago levam o dinheiro pendente.
 * Tudo vai como BLOCOS dentro da mesma mensagem, nunca uma mensagem por obra. Sem nada em nenhum bloco: null (não há mensagem).
 * Os blocos dividem o teto de 25 linhas; o que não coube vira "E mais N na lista de Clientes.".
 */
export function textoFila(a: {
  pessoa: string; itens: readonly ItemFila[]; hoje: string;
  escalada?: readonly ItemEscalada[]; placar?: readonly LinhaPlacar[] | null; dinheiro?: readonly string[][]; semComprovante?: readonly string[][];
}): string | null {
  const escalada = a.escalada ?? []; const dinheiro = a.dinheiro ?? []; const placar = a.placar ?? []; const semComprovante = a.semComprovante ?? [];
  if (!a.itens.length && !escalada.length && !dinheiro.length && !placar.length && !semComprovante.length) return null;
  const linhas: string[] = [`☀️ Sua fila hoje, ${nomeBonitoMsg(a.pessoa)}`];
  let restante = TETO_FILA_LINHAS;
  if (a.itens.length) {
    const c = caber(a.itens.map((i) => [linhaDoItem(i, a.hoje)]), restante);
    restante -= c.usou;
    linhas.push(...c.linhas);
    if (c.fora) linhas.push(`E mais ${c.fora} na lista de Clientes.`);
  } else linhas.push('Nada seu na fila hoje.');
  if (escalada.length) {
    const c = caber(escalada.map(linhasDaEscalada), restante);
    restante -= c.usou;
    linhas.push('', '*Parado com a equipe:*', ...c.linhas);
    if (c.fora) linhas.push(`E mais ${c.fora} na lista de Clientes.`);
  }
  if (dinheiro.length) {
    const c = caber(dinheiro, restante);
    linhas.push('', '*Dinheiro para resolver:*', ...c.linhas);
    if (c.fora) linhas.push(`E mais ${c.fora} na lista de Clientes.`);
  }
  if (semComprovante.length) {
    const c = caber(semComprovante, restante);
    restante -= c.usou;
    linhas.push('', '*Falta comprovante:*', ...c.linhas);
    if (c.fora) linhas.push(`E mais ${c.fora} na lista de Clientes.`);
  }
  if (placar.length) {
    linhas.push('', '*Placar da semana (no prazo x atrasadas):*', placar.map((p) => `${nomeBonitoMsg(p.pessoa)} ${p.noPrazo} x ${p.atrasadas}`).join(' · '));
  }
  return linhas.join('\n');
}

/** 7.7 · a legenda do PDF do Book. */
export function textoLiberacao(a: { primeiro: string; link: string | null }): string {
  return [
    `☀️ ${nomeLimpo(a.primeiro)}, a sua usina foi liberada pela Cemig.`,
    'Obrigado por confiar na Irmãos na Obra.',
    'O Book da obra vai em PDF, com o termo de garantia.',
    ...LINHA_LINK(a.link),
  ].join('\n');
}

/** 7.8 e 7.9 · os aniversários. */
export function textoAniversario(a: { toque: 'aniv' | 'usina'; primeiro: string; atrasado: boolean; anos?: number; link: string | null }): string {
  const p = nomeLimpo(a.primeiro);
  if (a.toque === 'aniv') {
    return [
      a.atrasado ? `🎂 Feliz aniversário atrasado, ${p}.` : `🎂 Feliz aniversário, ${p}.`,
      'A equipe da Irmãos na Obra deseja um ótimo ano para você.',
      ...LINHA_LINK(a.link),
    ].join('\n');
  }
  const n = a.anos ?? 1;
  const anos = `${n} ${n === 1 ? 'ano' : 'anos'}`;
  return [
    a.atrasado ? `☀️ ${p}, esta semana a sua usina fez ${anos}.` : `☀️ ${p}, hoje a sua usina faz ${anos}.`,
    'Parabéns pela escolha.',
    ...LINHA_LINK(a.link),
  ].join('\n');
}
