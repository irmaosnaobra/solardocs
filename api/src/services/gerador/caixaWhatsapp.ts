import { chaveContato } from '../agents/whatsapp/silenciar';

// ─────────────────────────────────────────────────────────────────────────────
// CAIXA DE ENTRADA DA LINHA 5040 (fase 1: só leitura). Parte PURA.
//
// Aqui mora a lógica que decide o que o usuário vê: juntar telefone e LID no
// mesmo contato, tirar grupo, dizer quem escreveu (lead, robô ou gente da equipe
// no celular), contar o que ficou sem resposta, escolher o nome, ordenar e dizer
// se a leitura foi cortada. Nada daqui fala com banco nem com rede: a rota
// (routes/geradorCaixa.ts) lê as linhas e entrega para estas funções.
//
// POR QUE A CHAVE É A DO `chaveContato`. O mesmo cliente aparece como
// 5534900001234, 34900001234 e 3490001234 (sem o nono dígito), e as mensagens
// digitadas no celular chegam com LID no lugar do telefone. A chave estável
// (DDD + 8 últimos dígitos) é a mesma que a pausa humana e a supressão usam, e é
// a coluna `chave` do mapa `wa_lid_telefone`.
// ─────────────────────────────────────────────────────────────────────────────

export type Autor = 'lead' | 'robo' | 'equipe';

/** Linha de `wa_mensagens` como a rota a lê (só as colunas que a caixa usa). */
export interface LinhaWa {
  id: number;
  telefone: string;
  is_group: boolean;
  from_me: boolean;
  from_api: boolean | null;
  chat_name: string | null;
  sender_name: string | null;
  tipo: string;
  texto: string | null;
  media_url: string | null;
  momment: string;
}

/** lid (só dígitos) → contato real. Vem de `wa_lid_telefone`. */
export type MapaLid = Map<string, { chave: string; telefone: string }>;

export interface PausaLinha {
  chave: string;
  pausado_em: string | null;
  ultima_fala_humano: string | null;
  ultima_fala_lead: string | null;
}

export interface MensagemTela {
  id: number;
  momento: string;
  autor: Autor;
  tipo: string;
  texto: string | null;
  media_url: string | null;
}

export interface ConversaItem {
  chave: string;
  nome: string;
  telefone: string | null;
  wa: string | null;
  sem_telefone: boolean;
  ultima: { id: number; momento: string; autor: Autor; tipo: string; trecho: string };
  ultimo_lead: string | null;
  nao_respondidas: number;
  atendimento: { desde: string } | null;
}

export const TRECHO_MAX = 80;
/** Sobreposição do cursor de `novas`, em ids: insert que confirma fora de ordem não se perde. */
export const SOBREPOSICAO_IDS = 25;
/** Idade máxima do último estado gravado da linha antes de virar "sem leitura". */
export const ESTADO_LINHA_VALE_MS = 3 * 3600_000;

// ── telefone, LID, chave ─────────────────────────────────────────────────────

const soDigitos = (s: string | null | undefined): string => String(s ?? '').replace(/\D/g, '');

export type ClasseTelefone =
  | { tipo: 'telefone'; chave: string }
  | { tipo: 'lid'; lid: string }
  | { tipo: 'ignorar' };

/**
 * Telefone de verdade tem 10 a 13 dígitos. LID tem 14 ou 15. Acima disso é id de
 * grupo ou de canal (newsletter) e abaixo de 10 não dá para identificar ninguém:
 * ficam fora. Grupo marcado como grupo fica fora de qualquer jeito.
 */
export function classificarTelefone(telefone: string | null | undefined, isGroup: boolean): ClasseTelefone {
  if (isGroup) return { tipo: 'ignorar' };
  const d = soDigitos(telefone);
  if (!d) return { tipo: 'ignorar' };
  if (d.length > 15) return { tipo: 'ignorar' };
  if (d.length >= 14) return { tipo: 'lid', lid: d };
  const chave = chaveContato(d);
  return chave ? { tipo: 'telefone', chave } : { tipo: 'ignorar' };
}

/** Chave da conversa de uma linha, ou null se ela não entra na caixa. LID sem mapa vira conversa própria (`lid:<dígitos>`). */
export function chaveDaLinha(l: Pick<LinhaWa, 'telefone' | 'is_group'>, mapa: MapaLid): string | null {
  const c = classificarTelefone(l.telefone, l.is_group);
  if (c.tipo === 'telefone') return c.chave;
  if (c.tipo === 'lid') return mapa.get(c.lid)?.chave ?? `lid:${c.lid}`;
  return null;
}

/** LIDs que aparecem nas linhas e precisam ser resolvidos no mapa. Sem repetição. */
export function lidsDasLinhas(linhas: Array<Pick<LinhaWa, 'telefone' | 'is_group'>>): string[] {
  const s = new Set<string>();
  for (const l of linhas) {
    const c = classificarTelefone(l.telefone, l.is_group);
    if (c.tipo === 'lid') s.add(c.lid);
  }
  return [...s];
}

/** As formas em que o telefone de uma chave de 10 dígitos aparece no banco (com e sem 55, com e sem o nono dígito). */
export function variantesDaChave(chave: string): string[] {
  if (!/^\d{10}$/.test(chave)) return [];
  const ddd = chave.slice(0, 2);
  const fim = chave.slice(2);
  return [`55${ddd}9${fim}`, `55${ddd}${fim}`, `${ddd}9${fim}`, `${ddd}${fim}`];
}

export function chaveValida(chave: string): boolean {
  return /^\d{10}$/.test(chave) || /^lid:\d{14,15}$/.test(chave);
}

export function formatarTelefone(digitos: string | null | undefined): string | null {
  let d = soDigitos(digitos);
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** Número para o link wa.me: dígitos com 55 na frente. Só para chave de telefone de verdade. */
export function numeroParaWa(digitos: string | null | undefined): string | null {
  const d = soDigitos(digitos);
  if (d.length < 10 || d.length > 13) return null;
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
}

// ── autor, tipo, trecho ──────────────────────────────────────────────────────

/**
 * Quem escreveu. `from_me` com `from_api` verdadeiro é a automação. `from_me`
 * sem `from_api` verdadeiro é gente digitando no celular: o `from_api` nulo
 * (payload antigo) cai aqui, igual ao pausaHumanaTick e ao conversa_wa, que só
 * tratam como robô o que veio marcado como API.
 */
export function autorDe(l: Pick<LinhaWa, 'from_me' | 'from_api'>): Autor {
  if (!l.from_me) return 'lead';
  return l.from_api === true ? 'robo' : 'equipe';
}

/** Reação e aviso do sistema não são conversa: não contam como pergunta do lead nem como resposta nossa. */
export function contaComoConversa(tipo: string | null | undefined): boolean {
  return tipo !== 'reacao' && tipo !== 'notificacao';
}

export function trecho(texto: string | null | undefined, max = TRECHO_MAX): string {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

/** Só http e https passam: nunca `javascript:` nem `data:` indo parar em src ou href. */
export function urlSegura(u: string | null | undefined): string | null {
  const s = String(u ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : null;
}

const MSG_MAX = 8000;

export function mensagemParaTela(l: LinhaWa): MensagemTela {
  const texto = l.texto == null || l.texto === '' ? null : String(l.texto).slice(0, MSG_MAX);
  return {
    id: l.id,
    momento: new Date(l.momment).toISOString(),
    autor: autorDe(l),
    tipo: l.tipo || 'outro',
    texto,
    media_url: urlSegura(l.media_url),
  };
}

// ── nome ─────────────────────────────────────────────────────────────────────

const pareceTelefone = (s: string): boolean => /^[\d\s()+\-.]+$/.test(s);
const norm = (s: string): string => s.trim().toLowerCase();

/** Nomes que a própria linha usa nas mensagens que ela mesma manda: nunca servem de nome de contato. */
export function nomesDaLinha(linhas: Array<Pick<LinhaWa, 'from_me' | 'sender_name'>>): Set<string> {
  const s = new Set<string>();
  for (const l of linhas) if (l.from_me && l.sender_name && l.sender_name.trim()) s.add(norm(l.sender_name));
  return s;
}

/**
 * Melhor nome do contato. `linhas` em qualquer ordem. O `chat_name` vem primeiro
 * (é como o contato está salvo no aparelho). O `sender_name` só vale em mensagem
 * DO contato: nas nossas ele é o nome da linha. Nome que parece telefone fica por
 * último, e sem nada devolve vazio (a tela mostra o telefone).
 */
export function escolherNome(
  linhas: Array<Pick<LinhaWa, 'from_me' | 'chat_name' | 'sender_name' | 'momment'>>,
  daLinha: Set<string> = nomesDaLinha(linhas),
): string {
  const recentes = [...linhas].sort((a, b) => Date.parse(b.momment) - Date.parse(a.momment));
  const limpo = (s: string | null): string | null => {
    const t = (s ?? '').trim();
    return t && !daLinha.has(norm(t)) ? t : null;
  };
  const chat = recentes.map((l) => limpo(l.chat_name)).filter((x): x is string => !!x);
  const remetente = recentes.filter((l) => !l.from_me).map((l) => limpo(l.sender_name)).filter((x): x is string => !!x);
  return chat.find((n) => !pareceTelefone(n))
    ?? remetente.find((n) => !pareceTelefone(n))
    ?? chat[0]
    ?? remetente[0]
    ?? '';
}

// ── atendimento (pausa humana) ───────────────────────────────────────────────

/**
 * Há gente atendendo? A pausa só vale enquanto não esfriou: mesma régua do gate
 * do robô (`esfriou` em pausaHumana.ts): nem a equipe nem o lead falaram há mais
 * de `janelaH` horas. Sem isso a tela mostraria como "em atendimento" uma pausa
 * que o robô já ignora. A tabela não diz QUEM da equipe digitou (o celular é um
 * só), então a tela mostra "equipe", sem nome.
 */
export function atendimentoDe(p: PausaLinha | null | undefined, agora: number, janelaH: number): { desde: string } | null {
  if (!p) return null;
  const humano = Date.parse(p.ultima_fala_humano ?? '') || 0;
  const lead = Date.parse(p.ultima_fala_lead ?? '') || 0;
  const ultimo = Math.max(humano, lead);
  if (ultimo && agora - ultimo > janelaH * 3600_000) return null;
  const desde = p.pausado_em || p.ultima_fala_humano;
  const t = Date.parse(desde ?? '');
  return Number.isFinite(t) ? { desde: new Date(t).toISOString() } : null;
}

// ── conversas ────────────────────────────────────────────────────────────────

const maisRecentePrimeiro = (a: LinhaWa, b: LinhaWa): number =>
  Date.parse(b.momment) - Date.parse(a.momment) || b.id - a.id;

/**
 * Agrupa as linhas em conversas. Ordena da mais recente para a mais antiga.
 * O "não respondido" é o número de mensagens do lead (reação e aviso de sistema
 * não contam) depois da última resposta nossa, seja do robô ou da equipe.
 */
export function montarConversas(
  linhas: LinhaWa[],
  mapa: MapaLid,
  pausas: Map<string, PausaLinha>,
  agora: number,
  janelaH = 24,
): ConversaItem[] {
  const daLinha = nomesDaLinha(linhas);
  const grupos = new Map<string, LinhaWa[]>();
  for (const l of linhas) {
    const k = chaveDaLinha(l, mapa);
    if (!k) continue;
    const g = grupos.get(k);
    if (g) g.push(l); else grupos.set(k, [l]);
  }

  const itens: ConversaItem[] = [];
  for (const [chave, g] of grupos) {
    g.sort(maisRecentePrimeiro);
    const ultima = g[0];
    const ultimoLead = g.find((l) => !l.from_me);

    let naoRespondidas = 0;
    for (const l of g) {
      if (!contaComoConversa(l.tipo)) continue;
      if (l.from_me) break;
      naoRespondidas++;
    }

    const semTelefone = chave.startsWith('lid:');
    let digitos: string | null = null;
    if (!semTelefone) {
      const real = g.find((l) => classificarTelefone(l.telefone, l.is_group).tipo === 'telefone');
      if (real) digitos = soDigitos(real.telefone);
      else {
        const viaMapa = g.map((l) => mapa.get(soDigitos(l.telefone))?.telefone).find((t) => !!t);
        digitos = viaMapa ? soDigitos(viaMapa) : null;
      }
    }

    itens.push({
      chave,
      nome: escolherNome(g, daLinha),
      telefone: formatarTelefone(digitos),
      wa: numeroParaWa(digitos),
      sem_telefone: semTelefone,
      ultima: {
        id: ultima.id,
        momento: new Date(ultima.momment).toISOString(),
        autor: autorDe(ultima),
        tipo: ultima.tipo || 'outro',
        trecho: trecho(ultima.texto),
      },
      ultimo_lead: ultimoLead ? new Date(ultimoLead.momment).toISOString() : null,
      nao_respondidas: naoRespondidas,
      atendimento: atendimentoDe(pausas.get(chave), agora, janelaH),
    });
  }

  itens.sort((a, b) => Date.parse(b.ultima.momento) - Date.parse(a.ultima.momento) || (a.chave < b.chave ? -1 : 1));
  return itens;
}

/** Contato (nome e telefone) de cada chave de um lote de mensagens. Serve a `novas` e ao cabeçalho da conversa. */
export function contatosDasLinhas(linhas: LinhaWa[], mapa: MapaLid): Map<string, { nome: string; telefone: string | null; wa: string | null; sem_telefone: boolean }> {
  const out = new Map<string, { nome: string; telefone: string | null; wa: string | null; sem_telefone: boolean }>();
  for (const c of montarConversas(linhas, mapa, new Map(), 0)) {
    out.set(c.chave, { nome: c.nome, telefone: c.telefone, wa: c.wa, sem_telefone: c.sem_telefone });
  }
  return out;
}

// ── leitura paginada ─────────────────────────────────────────────────────────

/** Erro de banco com o código e nada mais: a mensagem do driver pode carregar filtro, telefone ou texto. */
export class ErroBanco extends Error {
  constructor(readonly codigo: string) {
    super('erro de banco');
    this.name = 'ErroBanco';
  }
}

export const PAGINA = 1000;

/**
 * Lê em páginas de 1.000 (o PostgREST corta ali e ignora `.limit()`), até
 * `maxPaginas`. Tira repetidas por `id`: um insert novo no meio da leitura
 * desloca o `range` e a mesma linha pode vir em duas páginas. Se parou no teto
 * com a última página cheia, `truncado` é verdadeiro: o chamador tem que dizer.
 */
export async function lerPaginado<T extends { id: number }>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { code?: string } | null }>,
  maxPaginas: number,
  tamanho = PAGINA,
): Promise<{ linhas: T[]; truncado: boolean }> {
  const vistos = new Set<number>();
  const linhas: T[] = [];
  for (let p = 0; p < maxPaginas; p++) {
    const { data, error } = await pagina(p * tamanho, p * tamanho + tamanho - 1);
    if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
    const lote = data ?? [];
    for (const l of lote) if (!vistos.has(l.id)) { vistos.add(l.id); linhas.push(l); }
    if (lote.length < tamanho) return { linhas, truncado: false };
  }
  return { linhas, truncado: true };
}

// ── estado da linha ──────────────────────────────────────────────────────────

export type EstadoLinha = 'conectada' | 'caida' | 'desconhecida';

/**
 * Lê o que o monitor da Z-API gravou (`system_state`, chave `zapi_io_health`).
 * Duas checagens seguidas com a linha fora é "caída" (a mesma régua do alerta por
 * e-mail); uma só ainda é dúvida. Leitura velha demais (o monitor não grava quando
 * a checagem é inconclusiva) vira "desconhecida", e a hora da leitura vai junto.
 */
export function estadoDaLinha(
  valor: { downStreak?: number | null; ultimaConexao?: string | null } | null | undefined,
  atualizadoEm: string | null | undefined,
  agora: number,
  vale = ESTADO_LINHA_VALE_MS,
): { estado: EstadoLinha; leitura_em: string | null; ultima_conexao: string | null } {
  const t = Date.parse(atualizadoEm ?? '');
  const leitura = Number.isFinite(t) ? new Date(t).toISOString() : null;
  const ultimaConexao = valor?.ultimaConexao && Number.isFinite(Date.parse(valor.ultimaConexao))
    ? new Date(valor.ultimaConexao).toISOString() : null;
  if (!valor || !leitura || agora - t > vale) return { estado: 'desconhecida', leitura_em: leitura, ultima_conexao: ultimaConexao };
  const streak = Number(valor.downStreak ?? 0);
  if (streak >= 2) return { estado: 'caida', leitura_em: leitura, ultima_conexao: ultimaConexao };
  if (streak === 1) return { estado: 'desconhecida', leitura_em: leitura, ultima_conexao: ultimaConexao };
  return { estado: 'conectada', leitura_em: leitura, ultima_conexao: ultimaConexao };
}

// ── pedido ───────────────────────────────────────────────────────────────────

export const EQUIPE_PADRAO = 'thiago,diego,giovanna,nilce';

/** Lista fechada da equipe, por nome. Lida a cada chamada (CAIXA_EQUIPE muda sem deploy de código). */
export function equipeAutorizada(nome: string | null | undefined, env: string | undefined): boolean {
  const lista = String(env && env.trim() ? env : EQUIPE_PADRAO).split(',').map(norm).filter(Boolean);
  const n = norm(String(nome ?? ''));
  return !!n && lista.includes(n);
}

export function lerDias(v: unknown): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  if (!Number.isFinite(n) || n < 1) return 3;
  return Math.min(30, Math.floor(n));
}

export function lerLimite(v: unknown): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  if (!Number.isFinite(n) || n < 1) return 50;
  return Math.min(200, Math.floor(n));
}

/** Cursor de `novas`: id inteiro não negativo, ou null. */
export function lerCursor(v: unknown): number | null {
  const s = String(Array.isArray(v) ? v[0] : v ?? '').trim();
  if (!/^\d{1,15}$/.test(s)) return null;
  return Number(s);
}

/** Primeiro id a buscar: o cursor menos a sobreposição. */
export function idInicial(cursor: number): number {
  return Math.max(0, cursor - SOBREPOSICAO_IDS);
}

export function lerHorario(v: unknown): string | null {
  const s = String(Array.isArray(v) ? v[0] : v ?? '').trim();
  if (!s || s.length > 40) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
