// ─────────────────────────────────────────────────────────────────────────────
// ACOMPANHAMENTO DA HELENA: o que a aba "Helena" da Central das Agentes mostra
// (/gerador/agentes/#helena). SÓ LEITURA.
//
// A lista é a MESMA fila da prévia (`lerFila`, investidorAgente.ts: nada de regra de fila duplicada)
// mais quem já tem sessão. O formato de resposta é o que o comentário no topo do bloco JS da aba
// (dashboard/public/gerador/agentes/index.html) descreve; mudar um lado exige mudar o outro.
//
// Privacidade: a lista não leva telefone. A `chave` é DDD + 8 últimos dígitos, a mesma que a Caixa usa.
// Erro de leitura da fila SOBE (lista incompleta fingiria que ninguém está na fila).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { vagasDoFrioLinha } from '../agents/whatsapp/lineThrottle';
import { INV_SESSAO_PREFIX, preparoVivo } from './investidorAgentePosse';
import {
  lerFila, lerCarimbosDeToque, lerChaveDesligar, contarAberturasHoje, contarRetomadasHoje, lerTudo,
  type SessaoInvestidor,
} from './investidorAgente';
import {
  CAMPOS_DA_FICHA, TIPOS_HELENA, inicioDoDiaBrasiliaIso, proximoPassoDaRetomada, sessaoEntraNasRetomadas, tipoDaSessao,
  type CandidatoInvestidor, type CarimbosDosToques, type TipoHelena,
} from './investidorAgentePuro';

const LOG = 'helena-acompanhamento';

/** As situações da tela. Os rótulos ficam na tela; aqui só as chaves. */
export const SITUACOES = [
  'na_fila', 'abordado', 'em_conversa', 'convidado', 'horarios_enviados', 'reuniao_marcada',
  'sem_resposta', 'sem_interesse', 'parou', 'com_consultor', 'envio_falhou',
] as const;
export type Situacao = typeof SITUACOES[number];

export const JANELA_TEXTO = 'Abre e retoma de segunda a sábado, das 9h às 19h59. Responde todos os dias, das 7h às 20h.';
/** Quanto a resposta de `acompanhamento` fica em memória (vários navegadores atualizam de 60 em 60 s). */
export const CACHE_MS = 60_000;

export interface ProximoPasso { o_que: string; quando: string | null }
export interface ItemAcompanhamento {
  chave: string;
  nome: string;
  tipo: TipoHelena;
  faixa: 'pediu_reuniao' | 'lote_13_10' | 'retorno' | null;
  cidade: string;
  valor_txt: string | null;
  consultor: string | null;
  card_id: number | null;
  situacao: Situacao;
  posicao_fila: number | null;
  ultimo_contato_em: string | null;
  proximo_passo: ProximoPasso | null;
  toques: number;
  resumo: string;
}
type Contagem = Partial<Record<Situacao, number>>;
export interface Acompanhamento {
  ok: true;
  ligada: boolean;
  janela: string;
  atualizado_em: string;
  ritmo: { frios_24h: number; teto_frios: number; aberturas_hoje: number; retomadas_hoje: number };
  placar: {
    total: Contagem;
    por_tipo: Record<string, Contagem>;
    hoje: { aberturas: number; retomadas: number; respostas: number; reunioes: number; convites: number };
  };
  itens: ItemAcompanhamento[];
}

// ── Puro ─────────────────────────────────────────────────────────────────────

/**
 * O estágio gravado na sessão vira a situação da tela. `convidado` (convite feito, esperando o sim) é a sessão em
 * conversa com `convidou_em` gravado e ainda sem horários enviados (`ofertou` ganha). Reunião marcada é `agendado`,
 * com ou sem preparo.
 * Os motivos de `sem_interesse` seguem a coluna Atendimento do /gerador (cadSituacao): pediu_parar,
 * opt_out_por_outra_trilha e fora_do_padrao são "não procure" (parou); sem_resposta é o fecho por silêncio.
 */
export function situacaoDaSessao(s: Pick<SessaoInvestidor, 'estagio' | 'motivo' | 'erro' | 'respostas' | 'convidou_em'>): Situacao {
  const ativo = s.estagio === 'chamado' || s.estagio === 'conversando' || s.estagio === 'ofertou';
  if (s.erro && ativo) return 'envio_falhou';
  switch (s.estagio) {
    case 'chamado': return 'abordado';
    // Só a resposta automática do WhatsApp (zero respostas da Helena) ainda é "sem resposta" da pessoa.
    case 'conversando':
      if (Number(s.respostas ?? 0) === 0) return 'abordado';
      return s.convidou_em ? 'convidado' : 'em_conversa';
    case 'adiado': return 'em_conversa';
    case 'ofertou': return 'horarios_enviados';
    case 'agendado': return 'reuniao_marcada';
    case 'humano': return 'com_consultor';
    case 'sem_interesse':
      if (s.motivo === 'sem_resposta') return 'sem_resposta';
      if (s.motivo === 'pediu_parar' || s.motivo === 'opt_out_por_outra_trilha' || s.motivo === 'fora_do_padrao') return 'parou';
      return 'sem_interesse';
    default: return 'em_conversa';
  }
}

const maisRecente = (...isos: Array<string | null | undefined>): string | null => {
  let melhor: string | null = null;
  let t = -Infinity;
  for (const i of isos) {
    const ms = Date.parse(String(i ?? ''));
    if (Number.isFinite(ms) && ms > t) { t = ms; melhor = new Date(ms).toISOString(); }
  }
  return melhor;
};

const faixaDaFila = (c: Pick<CandidatoInvestidor, 'retorno' | 'faixa'>): ItemAcompanhamento['faixa'] =>
  c.retorno ? 'retorno' : c.faixa === 'card_parado' ? 'pediu_reuniao' : 'lote_13_10';

const faixaDaSessao = (s: SessaoInvestidor): ItemAcompanhamento['faixa'] => {
  if (s.retorno) return 'retorno';
  if (!s.card_antigo) return null;
  return s.card_antigo.lote ? 'lote_13_10' : 'pediu_reuniao';
};

/** Quem está na fila da abertura (a mesma ordem da prévia), com a posição de 1 em diante. */
export function itemDaFila(c: CandidatoInvestidor, posicao: number): ItemAcompanhamento {
  return {
    chave: c.chave, nome: c.nome ?? '', tipo: c.tipo, faixa: faixaDaFila(c), cidade: c.cidade ?? '',
    valor_txt: c.tipo === 'investidor' && c.valorTxt ? c.valorTxt : null,
    consultor: c.card?.vendedor ? String(c.card.vendedor) : null,
    card_id: c.card?.id ?? null,
    situacao: 'na_fila', posicao_fila: posicao, ultimo_contato_em: null,
    proximo_passo: { o_que: c.retorno ? 'Abertura de retorno' : 'Abertura', quando: null },
    toques: 0, resumo: '',
  };
}

/** Quem já tem sessão. `horarioDoCard` é o horário do card da reunião marcada, se foi lido. */
export function itemDaSessao(
  chave: string, s: SessaoInvestidor, carimbos: CarimbosDosToques | undefined, horarioDoCard: string | null, agora: number = Date.now(),
): ItemAcompanhamento {
  const situacao = situacaoDaSessao(s);
  const tipo = tipoDaSessao(s.tipo);
  const ultimoToque = carimbos ? maisRecente(...Object.values(carimbos)) : null;
  let proximo: ProximoPasso | null = null;
  if (situacao === 'abordado' && sessaoEntraNasRetomadas({ ...s, telefone: s.telefone || 'x' }) && carimbos) {
    const p = proximoPassoDaRetomada(carimbos);
    if (p) proximo = p.passo === 'fecho'
      ? { o_que: 'Fechar por silêncio', quando: new Date(p.venceEm).toISOString() }
      : { o_que: `Toque ${p.passo}`, quando: new Date(p.venceEm).toISOString() };
  } else if (situacao === 'horarios_enviados') proximo = { o_que: 'Esperar a escolha do horário', quando: null };
  else if (situacao === 'reuniao_marcada') {
    // Preparo aberto: a Helena ainda faz até 2 perguntas ao cliente antes da reunião.
    proximo = preparoVivo(s.preparo, agora)
      ? { o_que: 'Preparo da reunião', quando: horarioDoCard ?? s.preparo?.reuniao_em ?? null }
      : { o_que: 'Reunião', quando: horarioDoCard ?? s.preparo?.reuniao_em ?? null };
  } else if (situacao === 'convidado') proximo = { o_que: 'Esperar o sim para o horário', quando: null };
  else if (situacao === 'em_conversa') proximo = { o_que: s.estagio === 'adiado' ? 'Adiado pela pessoa' : 'Esperar a pessoa', quando: null };
  const toques = Number.isInteger(s.toques) && Number(s.toques) >= 1 ? Number(s.toques) : (s.erro ? 0 : 1);
  return {
    chave, nome: s.nome ?? '', tipo, faixa: faixaDaSessao(s), cidade: s.cidade ?? '',
    valor_txt: tipo === 'investidor' && s.valor_txt ? s.valor_txt : null,
    consultor: s.consultor ? String(s.consultor) : null,
    card_id: s.agendamento_id ?? s.card_id ?? null,
    situacao, posicao_fila: null,
    ultimo_contato_em: maisRecente(s.atualizado_em, ultimoToque),
    proximo_passo: proximo, toques,
    resumo: typeof s.resumo === 'string' ? s.resumo.slice(0, 600) : '',
  };
}

/** Placar a partir dos itens: total e por tipo. */
export function montarPlacar(itens: readonly Pick<ItemAcompanhamento, 'tipo' | 'situacao'>[]): { total: Contagem; por_tipo: Record<string, Contagem> } {
  const total: Contagem = {};
  const por_tipo: Record<string, Contagem> = Object.fromEntries(TIPOS_HELENA.map(t => [t, {} as Contagem]));
  for (const i of itens) {
    total[i.situacao] = (total[i.situacao] ?? 0) + 1;
    const t = (por_tipo[i.tipo] ??= {});
    t[i.situacao] = (t[i.situacao] ?? 0) + 1;
  }
  return { total, por_tipo };
}

/** Respostas e reuniões de hoje, a partir do que as sessões gravaram hoje (Brasília). */
export function contarDeHoje(sessoes: Iterable<SessaoInvestidor>, inicioDoDiaIso: string): { respostas: number; reunioes: number; convites: number } {
  const ini = Date.parse(inicioDoDiaIso);
  let respostas = 0, reunioes = 0, convites = 0;
  for (const s of sessoes) {
    // O convite conta pelo próprio carimbo (`convidou_em`), mesmo que a sessão tenha andado depois.
    if (Date.parse(String(s.convidou_em ?? '')) >= ini) convites++;
    const t = Date.parse(String(s.atualizado_em ?? ''));
    if (!Number.isFinite(t) || t < ini) continue;
    if (s.estagio === 'agendado' && s.motivo !== 'card_por_outra_porta') reunioes++;
    // A pessoa respondeu e a Helena andou com a conversa hoje: qualquer estágio depois da abertura.
    if (s.estagio !== 'chamado' && Number(s.respostas ?? 0) > 0) respostas++;
  }
  return { respostas, reunioes, convites };
}

/** A ficha da pessoa: só os campos preenchidos, na ordem da ficha da Helena. */
export function fichaPreenchida(dados: unknown): Record<string, string> {
  const d = (dados && typeof dados === 'object' ? dados : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of CAMPOS_DA_FICHA) {
    const v = typeof d[k] === 'string' ? (d[k] as string).trim() : '';
    if (v) out[k] = v;
  }
  return out;
}

// ── Leituras ─────────────────────────────────────────────────────────────────

const lote = <T>(lista: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
};

/** Os horários dos cards das reuniões marcadas (id -> quando). Falha aqui não derruba a lista: a reunião fica sem horário. */
async function lerHorariosDosCards(ids: number[]): Promise<Map<number, string>> {
  const mapa = new Map<number, string>();
  try {
    for (const grupo of lote(ids, 100)) {
      const { data, error } = await supabaseGerador.from('agendamentos').select('id, quando').in('id', grupo);
      if (error) throw new Error(error.message);
      for (const l of (data ?? []) as Array<{ id: number; quando: string | null }>) if (l.quando) mapa.set(Number(l.id), new Date(l.quando).toISOString());
    }
  } catch (err) {
    logger.warn(LOG, 'ler o horário dos cards falhou: reuniões ficam sem horário', { erro: String((err as Error)?.message || err) });
  }
  return mapa;
}

const ou0 = async (f: () => Promise<number>): Promise<number> => {
  try { return await f(); } catch (err) { logger.warn(LOG, 'contagem falhou: vale 0', { erro: String((err as Error)?.message || err) }); return 0; }
};

async function montar(agora: Date): Promise<Acompanhamento> {
  const [leitura, carimbos, chave, vagas, aberturasHoje, retomadasHoje] = await Promise.all([
    lerFila(agora.getTime()),
    lerCarimbosDeToque(),
    lerChaveDesligar(),
    vagasDoFrioLinha(agora).catch(() => null),
    ou0(() => contarAberturasHoje(agora)),
    ou0(() => contarRetomadasHoje(agora)),
  ]);
  const fila = leitura.resultado.fila;
  const naFila = new Set(fila.map(c => c.chave));
  // Sessão antiga que volta como retorno aparece na fila (a abertura de retorno é o próximo passo dela).
  const sessoes = [...leitura.sessoes].filter(([k]) => !naFila.has(k));
  const idsReuniao = sessoes.filter(([, s]) => s.estagio === 'agendado' && (s.agendamento_id ?? s.card_id)).map(([, s]) => Number(s.agendamento_id ?? s.card_id));
  const horarios = idsReuniao.length ? await lerHorariosDosCards(idsReuniao) : new Map<number, string>();

  const itens: ItemAcompanhamento[] = [
    ...fila.map((c, i) => itemDaFila(c, i + 1)),
    ...sessoes.map(([k, s]) => itemDaSessao(k, s, carimbos.get(k), horarios.get(Number(s.agendamento_id ?? s.card_id)) ?? null)),
  ];
  const { total, por_tipo } = montarPlacar(itens);
  const hoje = contarDeHoje(leitura.sessoes.values(), inicioDoDiaBrasiliaIso(agora));
  return {
    ok: true,
    ligada: !chave.off,
    janela: JANELA_TEXTO,
    atualizado_em: agora.toISOString(),
    ritmo: { frios_24h: vagas?.dia.usadas ?? 0, teto_frios: vagas?.dia.teto ?? 0, aberturas_hoje: aberturasHoje, retomadas_hoje: retomadasHoje },
    placar: { total, por_tipo, hoje: { aberturas: aberturasHoje, retomadas: retomadasHoje, ...hoje } },
    itens,
  };
}

// ── Cache de 60 s (uma leitura só por minuto, por mais navegadores que atualizem) ──
let cache: { em: number; dados: Acompanhamento } | null = null;
let emVoo: Promise<Acompanhamento> | null = null;

export function limparCacheDaHelena(): void { cache = null; emVoo = null; }

export async function lerAcompanhamento(agora: Date = new Date()): Promise<Acompanhamento> {
  if (cache && agora.getTime() - cache.em < CACHE_MS && agora.getTime() >= cache.em) return cache.dados;
  if (emVoo) return emVoo;
  emVoo = montar(agora).then(d => { cache = { em: agora.getTime(), dados: d }; return d; }).finally(() => { emVoo = null; });
  return emVoo;
}

// ── A pessoa ─────────────────────────────────────────────────────────────────

export interface PessoaHelena {
  ok: true;
  chave: string;
  nome: string;
  tipo: TipoHelena;
  ficha: Record<string, string>;
  resumo_para_consultor: string;
  sessao: { estagio: string | null; situacao: Situacao; toques: number; aberta_em: string | null; ultimo_contato_em: string | null };
  card: { id: number; status: string; horario: string | null; consultor: string | null } | null;
}

/** A sessão, a ficha e o card de uma pessoa. As mensagens vêm da rota (mesma leitura da Caixa). */
export async function lerPessoa(chave: string, itemDaLista: ItemAcompanhamento | null): Promise<PessoaHelena> {
  const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', `${INV_SESSAO_PREFIX}${chave}`).maybeSingle();
  if (error) throw new Error(`sessão da Helena: ${error.message}`);
  let s = (data?.value ?? null) as SessaoInvestidor | string | null;
  if (typeof s === 'string') { try { s = JSON.parse(s) as SessaoInvestidor; } catch { s = null; } }
  const sessao = s && typeof s === 'object' ? s : null;

  let card: PessoaHelena['card'] = null;
  const cardId = Number(sessao?.agendamento_id ?? sessao?.card_id ?? itemDaLista?.card_id);
  if (Number.isInteger(cardId) && cardId > 0) {
    const { data: c, error: eCard } = await supabaseGerador.from('agendamentos')
      .select('id, status, quando, vendedor_nome').eq('id', cardId).maybeSingle();
    if (eCard) logger.warn(LOG, 'ler o card da pessoa falhou', { erro: eCard.message });
    if (c) card = { id: Number(c.id), status: String(c.status ?? ''), horario: c.quando ? new Date(c.quando).toISOString() : null, consultor: c.vendedor_nome ?? null };
  }

  const situacao = sessao ? situacaoDaSessao(sessao) : (itemDaLista?.situacao ?? 'na_fila');
  const carimbos = sessao ? (await lerCarimbosDaChave(chave)) : undefined;
  return {
    ok: true,
    chave,
    nome: sessao?.nome ?? itemDaLista?.nome ?? '',
    tipo: sessao ? tipoDaSessao(sessao.tipo) : (itemDaLista?.tipo ?? 'investidor'),
    ficha: fichaPreenchida(sessao?.dados),
    resumo_para_consultor: typeof sessao?.resumo === 'string' ? sessao.resumo : '',
    sessao: {
      estagio: sessao?.estagio ?? null,
      situacao,
      toques: sessao ? (Number.isInteger(sessao.toques) && Number(sessao.toques) >= 1 ? Number(sessao.toques) : (sessao.erro ? 0 : 1)) : 0,
      aberta_em: sessao?.aberto_em ?? null,
      ultimo_contato_em: sessao ? maisRecente(sessao.atualizado_em, carimbos ? maisRecente(...Object.values(carimbos)) : null) : null,
    },
    card,
  };
}

/** Os carimbos dos toques de UMA pessoa (as chaves `inv_agente_sent:<chave>:tN`). */
async function lerCarimbosDaChave(chave: string): Promise<CarimbosDosToques | undefined> {
  try {
    const linhas = await lerTudo<{ key: string; updated_at: string | null }>('carimbos da pessoa', (de, ate) =>
      supabase.from('system_state').select('key, updated_at').like('key', `inv_agente_sent:${chave}:t%`).order('key', { ascending: true }).range(de, ate));
    const out: CarimbosDosToques = {};
    for (const l of linhas) {
      const n = Number(/:t([1-5])$/.exec(l.key)?.[1]);
      if (n && l.updated_at) out[n as 1 | 2 | 3 | 4 | 5] = String(l.updated_at);
    }
    return out;
  } catch { return undefined; }
}
