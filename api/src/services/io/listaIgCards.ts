// OS CARDS DA LISTA DE INTERESSE DO INSTAGRAM (19/11/2026). Nenhuma mensagem sai daqui: o card nasce MUDO e quem avisa a equipe
// é listaIgAviso.ts. Condições do chefe anti-ban que moram aqui:
//   1. Solar: card da Nilce (lp_solar, src=ig) com a 1ª linha `${MARCA_SAIU} · MUDO · LIGAÇÃO` e boas-vindas, bom dia e "oi" de
//      5 min carimbados (gravarCardSolar modo 'mudo'). Dentro do atendimento, o encaixe do "agora"; fora, a próxima vaga real da
//      Nilce na faixa de lead novo (o que o tick do quiz faz com quem saiu sem marcar).
//   2. Eletroposto: origem `lista_ig_eletroposto` (ehCardSemAvisoAutomatico), src=ig, CARIMBOS_DO_TICK com agora no insert,
//      gravarMarcaMuda(id, quando), fora de ORIGENS_COM_FICHA. Dono pelo rodízio Thiago/Diego; quando = a primeira vaga real
//      do dono (proximasVagas: agendaAbre + livrePara, grade das 8h às 19h30; fora dela, a abertura do próximo dia útil).
//   4. repassar_em nulo num UPDATE separado e conferido. Marca ou repasse que não confirma vira `io_lista_repasse:<id>`, e o
//      tick do resumo (listaIgAviso) refaz e confere até dar certo.
//   5. Um card por pessoa NO BANCO (situacaoDoTelefone): card agendado no futuro e fora do lote SEGURA (nada nasce, ninguém é
//      avisado); card que não está morto mas parou (vencido, não atendeu, lote, negociação) = não nasce outro, a equipe recebe
//      o aviso "voltou pela lista" com o card que já existe; sem card ou só card morto = nasce o card.
//  11. aviso_antigo:<card> sempre (o fichaTick nunca manda a ficha deste card).
//  12. Telefone bloqueado = sem card (o de teste nem chega aqui).

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { gravarCardAgora, gravarCardSolar, vagasSolar, type CardGravado } from '../agentes5040/agendaSolar';
import { marcarAvisoAntigo } from '../agentes5040/chaves';
import { DONA_SOLAR } from '../agenda/solarRota';
import { ORIGEM_LISTA_IG_EP, ehCardDoLote, ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { guardarEtiquetaDoCard, guardarTipoDoCard } from '../agenda/etiquetaCard';
import { estaBloqueado } from '../agents/whatsapp/silenciar';
import { horarioAgoraAberto } from './solarQuiz';
import { telKeySolar } from './solarTelefone';
import { gravarCardEletroposto, consultaDoRodizio, donoDaVez } from './eletropostoCard';
import { proximasVagas } from './eletropostoVagas';
import { gravarMarcaMuda } from './epMudo';
import { CARIMBOS_DO_TICK } from './agendaEmLote';
import { observacaoEletroposto, observacaoSolar, type PessoaDaLista } from './listaIgTextos';
import { PREFIXO_CARD, apagar, inserir } from './listaIgVaga';

const LOG = 'io-lista-ig';
export const TABELA_LISTA = 'io_instagram_interesse';
/** Card nestes status está morto: não segura o card novo. Qualquer outro (agendado, não atendeu, negociação...) é vivo. */
export const STATUS_MORTOS = ['cancelado', 'sem_interesse', 'perdido', 'fechou_concorrente'];
const VAGAS_LIDAS = 20;
export const PREFIXO_REPASSE = 'io_lista_repasse:';
/** Só o código e um pedaço da mensagem: o objeto de erro do Supabase pode trazer nome e telefone. */
export const resumoDoErro = (e: unknown): { code: string; message: string } => ({
  code: String((e as { code?: string } | null)?.code ?? '').slice(0, 20),
  message: String((e as { message?: string } | null)?.message ?? e ?? '').replace(/\d{6,}/g, '#').slice(0, 80),
});

export interface EntradaCard {
  listaId: string | number;
  pessoa: PessoaDaLista;
  utm: Record<string, string> | null;
}
export type ResultadoCard =
  | { status: 'ok'; card: { id: number; quando: string; dono: string } }
  | { status: 'voltou'; card: { id: number; dono: string } }
  | { status: 'pulou'; motivo: 'bloqueado' | 'card_vivo' | 'ja_tem_card' | 'ja_avisado' }
  | { status: 'erro' };

export type Situacao = { tipo: 'segura' } | { tipo: 'parado'; id: number; dono: string } | { tipo: 'livre' };

/**
 * Os cards do produto neste telefone. 'segura' = agendado no futuro, fora do lote; 'parado' = o mais recente que não está morto
 * (vencido, não atendeu, lote, negociação...); 'livre' = nenhum, ou só mortos. Leitura que falha SOBE (quem chama não cria).
 */
export async function situacaoDoTelefone(tel: string, produto: 'solar' | 'eletroposto', agora: number): Promise<Situacao> {
  const alvo = telKeySolar(tel);
  if (!alvo) return { tipo: 'livre' };
  const { data, error } = await supabaseGerador.from('agendamentos').select('id, cliente_telefone, status, created_by, quando, vendedor_nome')
    .ilike('cliente_telefone', `%${alvo.slice(-8)}`).limit(30);
  if (error) throw new Error('leitura dos cards falhou');
  const st = (c: Record<string, unknown>): string => String(c.status ?? '').trim().toLowerCase();
  const vivos = ((data ?? []) as Array<Record<string, unknown>>).filter(c => telKeySolar(c.cliente_telefone) === alvo
    && !STATUS_MORTOS.includes(st(c)) && (produto === 'eletroposto') === ehOrigemEletroposto(c.created_by));
  if (vivos.some(c => st(c) === 'agendado' && !ehCardDoLote(c.created_by) && Date.parse(String(c.quando ?? '')) > agora)) {
    return { tipo: 'segura' };
  }
  const recente = vivos.sort((a, b) => Number(b.id) - Number(a.id))[0];
  return recente ? { tipo: 'parado', id: Number(recente.id), dono: String(recente.vendedor_nome ?? '') } : { tipo: 'livre' };
}

/** Bloqueio, cards do telefone e o claim, nesta ordem. 'ok' = pode criar (o claim é desta chamada). */
async function podeCriar(e: EntradaCard, porta: 'solar' | 'eletroposto', agora: number): Promise<'ok' | ResultadoCard> {
  if (await estaBloqueado(e.pessoa.telefone)) return { status: 'pulou', motivo: 'bloqueado' };
  let sit: Situacao;
  try { sit = await situacaoDoTelefone(e.pessoa.telefone, porta, agora); } catch (err) {
    logger.error(LOG, `cards do telefone (${porta}) não lidos`, resumoDoErro(err));
    return { status: 'erro' };
  }
  if (sit.tipo === 'segura') return { status: 'pulou', motivo: 'card_vivo' };
  if (sit.tipo === 'parado') {
    // Um aviso "voltou" por linha da lista e card: o mesmo cadastro reenviado não avisa de novo.
    const v = await inserir(`io_lista_volta:${porta}:${e.listaId}:${sit.id}`, { em: new Date(agora).toISOString() }, agora);
    if (v === 'ja') return { status: 'pulou', motivo: 'ja_avisado' };
    return v === 'ok' ? { status: 'voltou', card: { id: sit.id, dono: sit.dono } } : { status: 'erro' };
  }
  const claim = await inserir(`${PREFIXO_CARD}${porta}:${e.listaId}`, { em: new Date(agora).toISOString() }, agora);
  if (claim === 'ja') return { status: 'pulou', motivo: 'ja_tem_card' };
  return claim === 'ok' ? 'ok' : { status: 'erro' };
}

async function ligarNaLista(listaId: string | number, coluna: 'card_solar_id' | 'card_eletroposto_id', id: number): Promise<void> {
  try {
    const { error } = await supabase.from(TABELA_LISTA).update({ [coluna]: id }).eq('id', listaId).is(coluna, null);
    if (error) logger.error(LOG, `${coluna} não gravado (card ${id})`, resumoDoErro(error));
  } catch (err) { logger.error(LOG, `${coluna} não gravado (card ${id})`, resumoDoErro(err)); }
}

const utmDoCard = (u: Record<string, string> | null): Record<string, string> =>
  Object.fromEntries(Object.entries(u ?? {}).map(([k, v]) => [`utm_${k}`, v]));

export async function criarCardSolar(e: EntradaCard, r: Record<string, string>, agora = Date.now()): Promise<ResultadoCard> {
  const pode = await podeCriar(e, 'solar', agora);
  if (pode !== 'ok') return pode;
  const ficha = {
    dono: DONA_SOLAR, nome: e.pessoa.nome, tel: e.pessoa.telefone, cidade: `${e.pessoa.cidade}-${e.pessoa.uf}`,
    observacao: observacaoSolar(e.pessoa, r), src: 'ig', utm: utmDoCard(e.utm), createdBy: 'lp_solar' as const,
  };
  let card: CardGravado | null = null;
  try {
    if (horarioAgoraAberto(agora)) {
      const g = await gravarCardAgora(ficha, agora, { modo: 'mudo' });
      if (g.status === 'ok') card = g.valor;
    } else {
      for (const quando of (await vagasSolar({ dono: DONA_SOLAR, caminho: 'ligacao', n: VAGAS_LIDAS, agora, faixa: 'novo' })) ?? []) {
        const g = await gravarCardSolar({ ...ficha, quando }, { modo: 'mudo' });
        if (g.status === 'ok') { card = g.card; break; }
        if (g.status === 'erro') break;
      }
    }
  } catch (err) { logger.error(LOG, 'card solar falhou', resumoDoErro(err)); }
  if (!card) { await apagar(`${PREFIXO_CARD}solar:${e.listaId}`); return { status: 'erro' }; }
  await marcarAvisoAntigo(card.id);
  await ligarNaLista(e.listaId, 'card_solar_id', card.id);
  return { status: 'ok', card: { id: card.id, quando: String(card.quando), dono: DONA_SOLAR } };
}

/** O tipo do card pelo caminho: cotista, investidor e chave na mão = cotista; arrendamento; parceiro = integrador. */
export function tipoDoCaminho(caminho: string): 'cotista' | 'arrendamento' | 'integrador' | null {
  if (caminho === 'cotista' || caminho === 'investidor' || caminho === 'chave_na_mao') return 'cotista';
  if (caminho === 'arrendamento') return 'arrendamento';
  if (caminho === 'parceiro') return 'integrador';
  return null;
}

/** Condição 4: repassar_em nulo num UPDATE só dele, lido de volta com os carimbos do tick. Duas tentativas. */
export async function zerarRepasse(id: number): Promise<boolean> {
  for (let t = 0; t < 2; t++) {
    const { error } = await supabaseGerador.from('agendamentos').update({ repassar_em: null }).eq('id', id);
    const { data, error: e2 } = await supabaseGerador.from('agendamentos')
      .select(`id, repassar_em, ${CARIMBOS_DO_TICK.join(', ')}`).eq('id', id).maybeSingle();
    const v = (data ?? null) as Record<string, unknown> | null;
    if (!error && !e2 && v && v.repassar_em == null && CARIMBOS_DO_TICK.every(c => v[c] != null)) return true;
  }
  return false;
}

export async function criarCardEletroposto(
  e: EntradaCard, caminho: string, respostas: Record<string, string>, agora = Date.now(),
): Promise<ResultadoCard> {
  const pode = await podeCriar(e, 'eletroposto', agora);
  if (pode !== 'ok') return pode;
  const claim = `${PREFIXO_CARD}eletroposto:${e.listaId}`;
  try {
    const { count } = await consultaDoRodizio([ORIGEM_LISTA_IG_EP]);
    const dono = donoDaVez(count);
    const agoraIso = new Date(agora).toISOString();
    const base: Record<string, unknown> = {
      vendedor_nome: dono, cliente_nome: e.pessoa.nome.slice(0, 120), cliente_telefone: e.pessoa.telefone,
      cidade: `${e.pessoa.cidade}-${e.pessoa.uf}`.slice(0, 120), status: 'agendado', temperatura: 'morno',
      observacao: observacaoEletroposto(e.pessoa, caminho, respostas).slice(0, 4000), created_by: ORIGEM_LISTA_IG_EP, src: 'ig',
      ...utmDoCard(e.utm), ...Object.fromEntries(CARIMBOS_DO_TICK.map(c => [c, agoraIso])),
    };
    // A primeira vaga REAL do dono (sem cair em cima de reunião, fora do almoço e só em dia que a agenda abre).
    let id: number | null = null;
    let quando = '';
    for (const iso of (await proximasVagas(dono, VAGAS_LIDAS, { agora, faixa: 'novo' })) ?? []) {
      try {
        const g = await gravarCardEletroposto({ ...base, quando: iso });
        if (g.id) { id = g.id; quando = iso; }
        break;
      } catch (err) {
        if (String((err as { code?: string })?.code) === '23505') continue;   // alguém pegou a vaga agora: a próxima
        throw err;
      }
    }
    if (!id) { await apagar(claim); return { status: 'erro' }; }
    await marcarAvisoAntigo(id);
    const tipo = tipoDoCaminho(caminho);
    if (tipo) {
      await guardarEtiquetaDoCard(id, tipo, 'lista_ig').catch(err => logger.error(LOG, `etiqueta do card ${id}`, resumoDoErro(err)));
      await guardarTipoDoCard(id, tipo, 'lista_ig');
    }
    if (!(await garantirMudo(id, quando))) {
      // Não segue como ok: a pendência fica registrada e o tick refaz até conferir (condição 4).
      logger.error(LOG, `card ${id}: marca ep_mudo ou repassar_em não conferiu, pendente`);
      await inserir(`${PREFIXO_REPASSE}${id}`, { card: id, em: agoraIso }, agora);
    }
    await ligarNaLista(e.listaId, 'card_eletroposto_id', id);
    return { status: 'ok', card: { id, quando, dono } };
  } catch (err) {
    logger.error(LOG, 'card de eletroposto falhou', resumoDoErro(err));
    await apagar(claim);
    return { status: 'erro' };
  }
}

/** A marca ep_mudo (3 tentativas) e o repassar_em nulo conferido. true = os dois confirmaram. */
export async function garantirMudo(id: number, quando: string): Promise<boolean> {
  let marcou = false;
  for (let t = 0; t < 3 && !marcou; t++) {
    try { await gravarMarcaMuda(id, quando, 'lista_ig'); marcou = true; } catch (err) { logger.error(LOG, `ep_mudo do card ${id} falhou`, resumoDoErro(err)); }
  }
  return (await zerarRepasse(id)) && marcou;
}

/** O conserto do tick: cada `io_lista_repasse:<id>` refaz a marca (com o `quando` lido agora) e o repasse; confirmou, a chave sai. */
export async function consertarRepasses(): Promise<{ consertados: number; pendentes: number }> {
  const r = { consertados: 0, pendentes: 0 };
  try {
    const { data, error } = await supabase.from('system_state').select('key, value').like('key', `${PREFIXO_REPASSE}%`).limit(10);
    if (error) return r;
    for (const l of (data ?? []) as Array<{ key: string; value?: { card?: number } | null }>) {
      const id = Number(l.value?.card);
      const lido = Number.isInteger(id) ? await supabaseGerador.from('agendamentos').select('quando').eq('id', id).maybeSingle() : null;
      const quando = String((lido?.data as { quando?: string } | null)?.quando ?? '');
      if (!lido || lido.error || !quando) { r.pendentes++; continue; }
      if (await garantirMudo(id, quando)) { await apagar(l.key); r.consertados++; } else r.pendentes++;
    }
  } catch (err) { logger.error(LOG, 'conserto do repasse falhou', resumoDoErro(err)); }
  return r;
}
