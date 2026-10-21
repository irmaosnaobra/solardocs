// ─────────────────────────────────────────────────────────────────────────────
// CONTEXTO DO LEAD. SÓ LEITURA: este arquivo não faz insert, update, upsert, delete nem rpc de
// escrita, e não chama o logger: seus erros vão para o console com o CÓDIGO e nada mais; nunca
// telefone, nome ou texto.
// ÚNICA ESCRITA ALCANÇÁVEL daqui: os horários livres (lerHorariosLivres) chamam
// eletropostoVagas.proximasVagas (Helena) ou agendaSolarVagas.vagasSolar (Duda; só leitura), que usam o logger do projeto, e o logger grava em error_logs
// quando a leitura da agenda FALHA. Nenhuma tabela do cliente, da conversa ou da agenda é escrita.
// O logger já estava no percurso (silenciar.ts e pausaHumana.ts o importam).
//
// Regras que moram aqui:
//  · conversa lida por telefone E por LID (wa_lid_telefone), paginada, da mais nova
//    para a mais velha. Corte, falha ou instância IO sem env = completa=false (a
//    agente não fala: "se não sabe o que já foi dito, não fala");
//  · o porteiro lê em MODO ESTRITO: qualquer erro vira leituraOk=false e ninguém
//    responde. A pausa humana é lida direto de atendimento_pausa porque
//    podeFalarComLead deixa passar quando a leitura falha (pausaHumana.ts:224-227);
//  · chave do contato = DDD + 8 últimos (silenciar.chaveContato). LID sem mapa não
//    resolve telefone: fica `lid:<dígitos>` e o porteiro cala.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import {
  ErroBanco, PAGINA, autorDe, contaComoConversa, chaveValida, lerPaginado, variantesDaChave,
  type LinhaWa,
} from '../gerador/caixaWhatsapp';
import {
  carregarBloqueados, carregarMudos, carregarSilenciados, chaveContato,
} from '../agents/whatsapp/silenciar';
import { desligado as pausaDesligada } from '../agents/whatsapp/pausaHumana';
import { proximasVagas } from '../io/eletropostoVagas';
import { vagasSolar } from './agendaSolarVagas';
import { INV_SESSAO_PREFIX, sessaoSeguraOutrosRobos } from '../io/investidorAgentePosse';
import { quandoPorExtenso } from './personas/comum';
import type {
  AnuncioOrigem, CadastroEletroposto, CardResumo, ContextoLead, FatosPorteiro, LeadMetaResumo, MsgConversa, Persona,
} from './tipos';

const COLUNAS = 'id, telefone, is_group, from_me, from_api, chat_name, sender_name, tipo, texto, media_url, momment';
const MAX_PAGINAS = 5;               // 5 mil mensagens de um contato; passou disso, completa=false
const MAX_LIDS = 50;
const JANELA_RECENTE_DIAS = 60;      // "card ou cadastro recente"
const MIN_TOQUES_MUDO = 3;           // o mesmo padrão de silenciar.TOQUES_ATE_DESISTIR

const instanciaIO = (): string | null => (process.env.ZAPI_INSTANCE_ID_IO || '').trim() || null;
const janelaPausaH = (): number => Number(process.env.PAUSA_HUMANA_JANELA_H || 24);
const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

function codigoDoErro(e: unknown): string {
  if (e instanceof ErroBanco) return e.codigo;
  const c = (e as { code?: string } | null)?.code;
  return c ? String(c).slice(0, 20) : 'interno';
}

// ── conversa ─────────────────────────────────────────────────────────────────

export interface ConversaLida { msgs: MsgConversa[]; completa: boolean }

function paraMsg(l: LinhaWa): MsgConversa {
  return {
    id: l.id, from_me: !!l.from_me, from_api: l.from_api ?? null, autor: autorDe(l),
    texto: l.texto ?? null, tipo: l.tipo, media_url: l.media_url ?? null, momment: l.momment,
  };
}

/**
 * A conversa de UM contato na linha IO, mais antiga primeiro. `ate` (ISO) corta no replay.
 * Nunca lança: falha vira { msgs: [], completa: false }.
 */
export async function lerConversa(chave: string, opts: { ate?: string } = {}): Promise<ConversaLida> {
  const inst = instanciaIO();
  if (!inst || !chaveValida(chave)) return { msgs: [], completa: false };
  try {
    let alvos: string[];
    if (chave.startsWith('lid:')) {
      alvos = [chave.slice(4)];
    } else {
      const { data, error } = await supabase.from('wa_lid_telefone').select('lid').eq('chave', chave).limit(MAX_LIDS);
      if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
      const lids = ((data ?? []) as Array<{ lid: string }>).map(r => soDigitos(r.lid)).filter(Boolean);
      if (lids.length >= MAX_LIDS) return { msgs: [], completa: false };   // lista de LIDs cortada
      alvos = [...variantesDaChave(chave), ...lids];
    }
    const { linhas, truncado } = await lerPaginado<LinhaWa>((de, ate) => {
      let q = supabase.from('wa_mensagens').select(COLUNAS)
        .eq('instancia', inst).eq('is_group', false).in('telefone', alvos);
      if (opts.ate) q = q.lte('momment', opts.ate);
      return q.order('momment', { ascending: false }).order('id', { ascending: false }).range(de, ate) as any;
    }, MAX_PAGINAS, PAGINA);
    const msgs = linhas.filter(l => contaComoConversa(l.tipo)).map(paraMsg)
      .sort((a, b) => Date.parse(a.momment) - Date.parse(b.momment) || a.id - b.id);
    return { msgs, completa: !truncado };
  } catch (e) {
    console.error('[agentes5040] leitura da conversa falhou', codigoDoErro(e));
    return { msgs: [], completa: false };
  }
}

// ── cadastros, card, leads_meta, cliente ─────────────────────────────────────

const mesmoContato = (tel: unknown, chave: string): boolean => chaveContato(String(tel ?? '')) === chave;

/** Os últimos 8 dígitos da chave (parte que o ilike usa; DDD é conferido depois em código). */
const caudaDaChave = (chave: string): string => chave.slice(-8);

/** Todos os cards deste telefone (até 20), do mais novo ao mais velho. O replay escolhe o da época. */
export async function lerCards(chave: string): Promise<CardResumo[]> {
  const { data, error } = await supabaseGerador.from('agendamentos')
    .select('id, status, quando, vendedor_nome, cliente_nome, cliente_telefone, cidade, observacao, created_by, created_at')
    .ilike('cliente_telefone', `%${caudaDaChave(chave)}`)
    .order('created_at', { ascending: false }).limit(20);
  if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
  return ((data ?? []) as Array<CardResumo & { cliente_telefone: string | null }>)
    .filter(r => mesmoContato(r.cliente_telefone, chave))
    .map(({ cliente_telefone: _t, ...card }) => card);
}

/**
 * O card do SOLAR é o mais novo DO SOLAR da lista (do mais novo ao mais velho) que NÃO está cancelado: não o mais novo de
 * qualquer produto (a agenda da Duda é só do solar), e um cancelado mais novo não esconde o agendado mais velho.
 */
export const cardSolarDaLista = (cards: ReadonlyArray<CardResumo>): CardResumo | null =>
  cards.find(c => !String(c.created_by ?? '').toLowerCase().includes('eletroposto')
    && String(c.status ?? '').trim().toLowerCase() !== 'cancelado') ?? null;

async function lerCard(chave: string): Promise<CardResumo | null> {
  return (await lerCards(chave))[0] ?? null;
}

async function lerLeadsMeta(chave: string): Promise<LeadMetaResumo | null> {
  const { data, error } = await supabaseGerador.from('leads_meta')
    .select('lead_id, form_id, nome, cidade, created_time, whatsapp')
    .ilike('whatsapp', `%${caudaDaChave(chave)}`)
    .order('created_time', { ascending: false }).limit(20);
  if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
  const achado = ((data ?? []) as Array<LeadMetaResumo & { whatsapp: string | null }>)
    .find(r => mesmoContato(r.whatsapp, chave));
  if (!achado) return null;
  const { whatsapp: _w, ...lead } = achado;
  return lead;
}

async function lerCadastros(chave: string): Promise<CadastroEletroposto[]> {
  const cauda = `%${caudaDaChave(chave)}`;
  const [n1, par] = await Promise.all([
    supabaseGerador.from('eletroposto_nota1').select('id, nome, telefone, cidade, created_at')
      .ilike('telefone', cauda).order('created_at', { ascending: false }).limit(20),
    supabaseGerador.from('eletroposto_parceria').select('id, nome, telefone, cidade, lado, status, created_at')
      .ilike('telefone', cauda).order('created_at', { ascending: false }).limit(20),
  ]);
  if (n1.error) throw new ErroBanco(String(n1.error.code ?? 'desconhecido'));
  if (par.error) throw new ErroBanco(String(par.error.code ?? 'desconhecido'));
  const fora: CadastroEletroposto[] = [];
  for (const r of (n1.data ?? []) as Array<Record<string, any>>) {
    if (mesmoContato(r.telefone, chave)) fora.push({ origem: 'nota1', id: r.id, nome: r.nome ?? null, cidade: r.cidade ?? null, created_at: r.created_at ?? null });
  }
  for (const r of (par.data ?? []) as Array<Record<string, any>>) {
    if (mesmoContato(r.telefone, chave)) {
      fora.push({ origem: 'parceria', id: r.id, nome: r.nome ?? null, cidade: r.cidade ?? null, created_at: r.created_at ?? null, lado: r.lado ?? null, status: r.status ?? null });
    }
  }
  return fora;
}

/** Já é cliente do SolarDoc? users.whatsapp, pelas variantes do número. Erro SOBE. */
async function lerEhCliente(chave: string): Promise<boolean> {
  const variantes = variantesDaChave(chave);
  if (!variantes.length) return false;
  const { data, error } = await supabase.from('users').select('id').in('whatsapp', variantes).limit(1);
  if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
  return (data ?? []).length > 0;
}

const recente = (iso: string | null | undefined, agoraMs: number): boolean => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) && agoraMs - t <= JANELA_RECENTE_DIAS * 86_400_000;
};

/**
 * created_by do card, ou form_id do cadastro, mais recente, na linguagem do porteiro
 * (produtoDaOrigem). Card vence cadastro; lead do Meta vira 'lead-meta' (ou 'quiz' se o id é de quiz).
 */
function origemDe(card: CardResumo | null, lead: LeadMetaResumo | null, cadastros: CadastroEletroposto[], agoraMs: number): string | null {
  if (card?.created_by && recente(card.created_at, agoraMs)) return card.created_by;
  if (lead && recente(lead.created_time, agoraMs)) return String(lead.lead_id ?? '').startsWith('quiz_') ? 'quiz' : 'lead-meta';
  const cad = cadastros.find(c => recente(c.created_at, agoraMs));
  if (cad) return cad.origem === 'nota1' ? 'lp_eletroposto' : 'cadastro_eletroposto';
  return null;
}

// ── horários livres ──────────────────────────────────────────────────────────
// Só leitura da agenda (eletropostoVagas.proximasVagas: agendamentos + fichas do solar). O dono vem do
// card; sem card, a Helena cai pela cidade (Araguari = Thiago, Uberlândia = Diego). A Duda sem dono no
// card fica sem horário (o consumo decide Nilce ou Giovanna, e isso a conversa ainda não respondeu).

const DONOS_HORARIO: Record<'duda' | 'helena', readonly string[]> = { duda: ['Nilce', 'Giovanna'], helena: ['Thiago', 'Diego'] };
const semAcentoMin = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function donoDoHorario(
  persona: 'duda' | 'helena', card: CardResumo | null, lead: LeadMetaResumo | null, cadastros: CadastroEletroposto[],
): string | null {
  const nome = semAcentoMin(card?.vendedor_nome).trim().split(/\s+/)[0] ?? '';
  const achado = DONOS_HORARIO[persona].find(d => semAcentoMin(d) === nome);
  if (achado) return achado;
  if (persona !== 'helena') return null;
  const cidade = semAcentoMin(card?.cidade || lead?.cidade || cadastros.find(c => c.cidade)?.cidade);
  if (cidade.includes('araguari')) return 'Thiago';
  if (cidade.includes('uberlandia')) return 'Diego';
  return null;
}

/** Até 4 horários livres do dono, por extenso. Falha de leitura ou sem dono = lista vazia (a persona pede manhã ou tarde). */
export async function lerHorariosLivres(
  persona: Persona, card: CardResumo | null, lead: LeadMetaResumo | null, cadastros: CadastroEletroposto[], agora: string,
): Promise<string[]> {
  if (persona !== 'duda' && persona !== 'helena') return [];
  try {
    const dono = donoDoHorario(persona, card, lead, cadastros);
    if (!dono) return [];
    // A Duda marca ligação do SOLAR: grade e ocupação do solar (agendaSolarVagas), nunca a do eletroposto.
    // Lead sem card = cliente novo (:00/:30); quem já tem card (inclusive nao_atendeu) remarca nos :15/:45.
    const vagas = persona === 'duda'
      ? await vagasSolar({ dono, caminho: 'ligacao', n: 4, agora: Date.parse(agora), faixa: card ? 'remarcacao' : 'novo' })
      : await proximasVagas(dono, 4, { agora: Date.parse(agora) });
    return (vagas ?? []).map(iso => quandoPorExtenso(iso, agora)).filter(Boolean);
  } catch (e) {
    console.error('[agentes5040] leitura dos horários falhou', codigoDoErro(e));
    return [];
  }
}

// ── barragens e pausa (modo estrito) ─────────────────────────────────────────

export interface ListasDeBarragem {
  silenciado: (phone: string) => boolean;
  bloqueado: (phone: string) => boolean;
  mudo: (phone: string) => boolean;
}

/** Carrega uma vez as três listas, em modo estrito (erro sobe). Quem varre várias conversas chama uma só vez. */
export async function carregarListasDeBarragem(): Promise<ListasDeBarragem> {
  const [silenciado, bloqueado, mudo] = await Promise.all([
    carregarSilenciados({ estrito: true }),
    carregarBloqueados({ estrito: true }),
    carregarMudos(MIN_TOQUES_MUDO, 60, { estrito: true }),
  ]);
  return { silenciado, bloqueado, mudo };
}

/** Humano ativo? Lê atendimento_pausa DIRETO (erro sobe) e aplica a mesma janela de esfriamento. */
async function humanoAtivo(chave: string, agoraMs: number): Promise<boolean> {
  if (pausaDesligada()) return false;
  const { data, error } = await supabase.from('atendimento_pausa')
    .select('chave, ultima_fala_humano, ultima_fala_lead')
    .eq('chave', chave).is('liberado_em', null).maybeSingle();
  if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
  if (!data) return false;
  const r = data as { ultima_fala_humano: string | null; ultima_fala_lead: string | null };
  const ultimo = Math.max(Date.parse(r.ultima_fala_humano ?? '') || 0, Date.parse(r.ultima_fala_lead ?? '') || 0);
  if (!ultimo) return true;
  return agoraMs - ultimo <= janelaPausaH() * 3600_000;
}

/**
 * Outro robô ANTIGO já está nesta conversa? (virada da Fase B: as agentes novas só assumem conversa nova)
 *   · whatsapp_sessions sdr_b2b (Carla antiga) ou solar_quiz (Duda do quiz): a sessão existir E ter
 *     updated_at nos últimos 7 dias (as sessões não expiram; sem janela, lead de meses atrás nunca
 *     chegaria à agente nova);
 *   · recepcao_io com estado 'triando' (a Duda da triagem, a mesma régua de recepcaoJaAtende);
 *   · recuperacao (a Bia), só com a recuperação habilitada, como ehLeadRecuperacao;
 *   · inv_agente:<chave> (Helena de investidores) que segura os outros robôs (sessaoSeguraOutrosRobos).
 * A sessão do próprio robô novo (tipo 'ag5040') não entra aqui. Erro SOBE (modo estrito).
 * Os tipos ficam escritos aqui de propósito: importar as constantes puxaria zapiClient e o SDK da
 * Anthropic para o caminho do ensaio.
 */
const TIPOS_QUE_BASTA_EXISTIR = ['sdr_b2b', 'solar_quiz'] as const;
// Essas duas sessões nunca expiram sozinhas: só contam como "conversa aberta" se tiveram toque
// (whatsapp_sessions.updated_at, regravado a cada mensagem) nos últimos 7 dias. Sem data legível
// = conta (na dúvida ninguém chuta).
const JANELA_SESSAO_ANTIGA_DIAS = 7;
const sessaoAntigaViva = (updatedAt: unknown, agoraMs: number): boolean => {
  const t = Date.parse(String(updatedAt ?? ''));
  if (!Number.isFinite(t)) return true;
  return agoraMs - t <= JANELA_SESSAO_ANTIGA_DIAS * 86_400_000;
};
const recuperacaoHabilitada = (): boolean => process.env.RECUP_ENABLED === 'true' && !!instanciaIO();

async function lerOutroRoboAtivo(chave: string, agoraMs: number): Promise<boolean> {
  const [sessoes, inv] = await Promise.all([
    supabase.from('whatsapp_sessions').select('phone, tipo, lead_data, updated_at')
      .in('phone', variantesDaChave(chave))
      .in('tipo', ['sdr_b2b', 'solar_quiz', 'recepcao_io', 'recuperacao']),
    supabase.from('system_state').select('value').eq('key', `${INV_SESSAO_PREFIX}${chave}`).maybeSingle(),
  ]);
  if (sessoes.error) throw new ErroBanco(String(sessoes.error.code ?? 'desconhecido'));
  if (inv.error) throw new ErroBanco(String(inv.error.code ?? 'desconhecido'));
  const doContato = ((sessoes.data ?? []) as Array<{ phone: string; tipo: string; lead_data: unknown; updated_at?: string | null }>)
    .filter(r => mesmoContato(r.phone, chave));
  for (const r of doContato) {
    if ((TIPOS_QUE_BASTA_EXISTIR as readonly string[]).includes(r.tipo) && sessaoAntigaViva(r.updated_at, agoraMs)) return true;
    if (r.tipo === 'recepcao_io' && ((r.lead_data ?? {}) as { estado?: unknown }).estado === 'triando') return true;
    if (r.tipo === 'recuperacao' && recuperacaoHabilitada()) return true;
  }
  return inv.data ? sessaoSeguraOutrosRobos((inv.data as { value?: unknown }).value, agoraMs) : false;
}

const FATOS_VAZIOS: FatosPorteiro = {
  leituraOk: false, humanoNaConversa: false, naoIncomodar: false, bloqueado: false, mudo: false,
  donaAtual: null, ehClienteSolarDoc: false, anuncio: null, primeiroTextoDoLead: null, origemCadastro: null,
  outroRoboAtivo: false,
};

/**
 * Os fatos do porteiro, em MODO ESTRITO. Qualquer erro de leitura devolve leituraOk=false
 * (ninguém responde). Chave `lid:` (sem telefone resolvido) também: sem o telefone não há
 * como conferir pausa, opt-out nem cliente.
 *
 * `opts.listas`: listas já carregadas (varredura de várias conversas). `opts.agora`: instante de referência.
 */
export async function lerFatosPorteiro(
  chave: string,
  msgs: readonly MsgConversa[],
  anuncio: AnuncioOrigem | null,
  opts: { donaAtual?: Persona | null; agora?: Date | number; listas?: ListasDeBarragem; completa?: boolean } = {},
): Promise<FatosPorteiro> {
  try {
    // Só decide com a conversa lida inteira: qualquer outro valor (undefined incluso) = ninguém responde.
    if (opts.completa !== true) return { ...FATOS_VAZIOS };
    if (!/^\d{10}$/.test(chave)) return { ...FATOS_VAZIOS };      // lid: sem telefone resolvido
    const agoraMs = opts.agora instanceof Date ? opts.agora.getTime() : (opts.agora ?? Date.now());
    const listas = opts.listas ?? await carregarListasDeBarragem();
    const [pausaAtiva, card, lead, cadastros, cliente, outroRobo] = await Promise.all([
      humanoAtivo(chave, agoraMs), lerCard(chave), lerLeadsMeta(chave), lerCadastros(chave), lerEhCliente(chave),
      lerOutroRoboAtivo(chave, agoraMs),
    ]);
    const janela = janelaPausaH() * 3600_000;
    // Fala recente da equipe SEMPRE conta como humano, mesmo com PAUSA_HUMANA_OFF=1 (o desligador é da tabela de pausas).
    const equipeRecente = msgs.some(m =>
      m.autor === 'equipe' && agoraMs - Date.parse(m.momment) <= janela && Date.parse(m.momment) <= agoraMs);
    const primeiro = msgs.find(m => m.autor === 'lead' && String(m.texto ?? '').trim());
    return {
      leituraOk: true,
      humanoNaConversa: pausaAtiva || equipeRecente,
      naoIncomodar: listas.silenciado(chave),
      bloqueado: listas.bloqueado(chave),
      mudo: listas.mudo(chave),
      donaAtual: opts.donaAtual ?? null,
      ehClienteSolarDoc: cliente,
      anuncio,
      primeiroTextoDoLead: primeiro ? String(primeiro.texto) : null,
      origemCadastro: origemDe(card, lead, cadastros, agoraMs),
      outroRoboAtivo: outroRobo,
    };
  } catch (e) {
    console.error('[agentes5040] leitura dos fatos do porteiro falhou', codigoDoErro(e));
    return { ...FATOS_VAZIOS };
  }
}

/**
 * O contexto que a persona vê. Qualquer leitura que falhe derruba `completa` (a agente não fala).
 * `opts.qualificado` (Helena) vem de quem chama; desconhecido = false e o valor fica bloqueado.
 */
export async function montarContexto(
  chave: string,
  conversa: ConversaLida,
  opts: { agora?: string; anuncio?: AnuncioOrigem | null; qualificado?: boolean } = {},
): Promise<ContextoLead> {
  const agora = opts.agora ?? new Date().toISOString();
  let completa = conversa.completa;
  let card: CardResumo | null = null;
  let cardSolar: CardResumo | null = null;
  let leadsMeta: LeadMetaResumo | null = null;
  let cadastros: CadastroEletroposto[] = [];
  let cliente = false;
  if (!/^\d{10}$/.test(chave)) {
    completa = false;
  } else {
    try {
      let cards: CardResumo[];
      [cards, leadsMeta, cadastros, cliente] = await Promise.all([
        lerCards(chave), lerLeadsMeta(chave), lerCadastros(chave), lerEhCliente(chave),
      ]);
      card = cards[0] ?? null;
      cardSolar = cardSolarDaLista(cards);
    } catch (e) {
      console.error('[agentes5040] leitura do contexto falhou', codigoDoErro(e));
      completa = false;
    }
  }
  const nome = card?.cliente_nome || leadsMeta?.nome || cadastros.find(c => c.nome)?.nome || null;
  return {
    chave, nome, msgs: conversa.msgs, completa, card, cardSolar, leadsMeta, cadastros,
    ehClienteSolarDoc: cliente, anuncio: opts.anuncio ?? null, qualificado: !!opts.qualificado, agora,
  };
}
