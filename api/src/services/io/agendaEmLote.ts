// ─────────────────────────────────────────────────────────────────────────────
// AGENDA EM LOTE DO ELETROPOSTO (13/10/2026) — cards criados sem nenhuma mensagem.
//
// Ordem do dono: "adiciona todos os investidores na minha agenda e na do Diego,
// de hora em hora e meia hora, das 8 às 19:30, começando pelos maiores. Caem como
// agendado e cotista." E escolheu: NENHUMA mensagem automática; ele e o Diego
// chamam cada um no horário.
//
// São centenas de investidores frios que NUNCA marcaram reunião. O erro que não
// pode acontecer é um card nascer e o robô da agenda mandar "confirme sua reunião"
// para quem não marcou nada: foi essa rajada, vinda de outra rota, que já derrubou
// o chip da linha 5040.
//
// COMO O CARD NASCE MUDO, em três camadas independentes:
//   1. `created_by = 'cadastro_eletroposto'`: os robôs pulam esta origem em CÓDIGO,
//      em qualquer status (`ehCardSemAvisoAutomatico`). Esta é a trava de verdade.
//   2. Os carimbos que o tick da agenda olha já nascem preenchidos (confirmação, 1h
//      e 5 min), então mesmo uma versão velha do tick, sem a trava, não confirma.
//   3. A marca `ep_mudo:<id>` com o `quando` do card, a mesma que
//      `POST /gerador/mudo` grava: o tick e a régua do SIM já a respeitam.
//
// Não grava `presenca_confirmada_at` nem `lead_resposta_at`: são sinais POSITIVOS
// ("ele confirmou", "ele escreveu") e preenchê-los seria mentir no card (o lembrete
// diário, por exemplo, exige um dos dois para sair).
//
// O que NÃO está aqui, de propósito: evento do Meta, `/alerta`, qualquer envio.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { gravarCardEletroposto, DONOS_EP } from './eletropostoCard';
import { gravarMarcaMuda } from './epMudo';
import { EP_MUDO_PREFIX } from './eletropostoReagendaAuto';
import { guardarEtiquetaDoCard, guardarTipoDoCard } from '../agenda/etiquetaCard';
import { ETIQUETA_PREFIX, TIPO_CARD_PREFIX } from '../agenda/salaDeEspera';
import { ORIGEM_CADASTRO_EP } from '../agenda/origemEtiqueta';
import { agendaFechadaNoIso } from '../agenda/agendaFechada';
import { chaveContato, carregarBloqueados, carregarSilenciados } from '../agents/whatsapp/silenciar';

export const MAX_ITENS_LOTE = 60;
export const TIPOS_DO_LOTE = ['cotista', 'arrendamento', 'integrador'] as const;
export type TipoDoLote = typeof TIPOS_DO_LOTE[number];

/** As colunas de carimbo que o tick da agenda lê para decidir um toque. Nascem
 *  preenchidas com a hora da criação. `presenca_confirmada_at` e `lead_resposta_at`
 *  ficam de fora de propósito (ver o cabeçalho). */
export const CARIMBOS_DO_TICK = ['confirmacao_at', 'lembrete_1h_at', 'lembrete_5min_at'] as const;

/** Quantas tentativas a marca `ep_mudo` ganha antes de o lote parar. */
export const TENTATIVAS_DA_MARCA = 3;
/** Erros genéricos de gravação seguidos que também param o lote (banco ruim). */
const ERROS_SEGUIDOS_MAX = 3;

export interface ItemDoLote {
  chave?: unknown;
  nome?: unknown;
  telefone?: unknown;
  cidade?: unknown;
  valor?: unknown;
  consultor?: unknown;
  quando?: unknown;
  origem?: unknown;
  id_cadastro?: unknown;
  helena?: unknown;
  /** Opcional. Texto de uma linha (até 60) da 1ª linha da observação; sem ele, "Investidor". */
  perfil?: unknown;
  /** Opcional. Até 14 linhas (200 caracteres cada) logo depois da 1ª linha da observação. */
  linhas?: unknown;
}

export type ResultadoDoItem =
  | 'criado' | 'conferido' | 'previa' | 'invalido' | 'ja_tem_card' | 'bloqueado'
  | 'horario_ocupado' | 'erro' | 'parou_o_lote' | 'nao_processado';

export interface SaidaDoItem {
  chave: string;
  resultado: ResultadoDoItem;
  id: number | null;
  motivo: string | null;
  /** Só quando o item foi gravado e algo ficou torto (ex.: etiqueta não gravada). */
  aviso?: string;
}

export interface SaidaDoLote {
  ok: boolean;
  dry: boolean;
  tipo: string | null;
  itens: SaidaDoItem[];
  totais: Record<string, number>;
  /** O lote parou antes do fim (marca não gravou, repasse não anulou, banco ruim). */
  parou: boolean;
  motivo_da_parada: string | null;
  erro?: string;
}

// ── Brasília, explícito: o relógio do servidor é UTC ─────────────────────────
const FMT_BRT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Sao_Paulo', hourCycle: 'h23',
  weekday: 'short', hour: '2-digit', minute: '2-digit',
});
function partesBrasilia(ms: number): { dia: string; hora: number; minuto: number } {
  const p = Object.fromEntries(FMT_BRT.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { dia: String(p.weekday), hora: Number(p.hour), minuto: Number(p.minute) };
}

const RE_ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Horário válido da agenda em lote, ou o motivo de não ser. Hora, minuto e dia da
 *  semana são os de BRASÍLIA. */
export function validarQuando(quando: unknown, agora: number): { ok: true; iso: string } | { ok: false; motivo: string } {
  if (typeof quando !== 'string' || !RE_ISO_COM_FUSO.test(quando.trim())) {
    return { ok: false, motivo: 'quando_nao_e_iso_com_fuso' };
  }
  const ms = new Date(quando.trim()).getTime();
  if (!Number.isFinite(ms)) return { ok: false, motivo: 'quando_invalido' };
  if (ms <= agora) return { ok: false, motivo: 'quando_no_passado' };
  if (ms % 60_000 !== 0) return { ok: false, motivo: 'quando_com_segundos' };
  const { dia, hora, minuto } = partesBrasilia(ms);
  if (dia === 'Sat' || dia === 'Sun') return { ok: false, motivo: 'fim_de_semana' };
  if (minuto !== 0 && minuto !== 30) return { ok: false, motivo: 'minuto_fora_da_grade' };
  const m = hora * 60 + minuto;
  if (m < 8 * 60 || m > 19 * 60 + 30) return { ok: false, motivo: 'fora_das_8_as_19_30' };
  const iso = new Date(ms).toISOString();
  if (agendaFechadaNoIso(iso)) return { ok: false, motivo: 'agenda_fechada_neste_dia' };
  return { ok: true, iso };
}

/** Telefone com 55 na frente, 12 ou 13 dígitos. 10 ou 11 dígitos (DDD + número)
 *  ganham o 55. Qualquer outra coisa é inválida. */
export function normalizarTelefone(v: unknown): string | null {
  const bruto = String(v ?? '').trim();
  if (!bruto || !/^[\d\s()+.-]+$/.test(bruto)) return null;
  let d = bruto.replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) return null;
  return d;
}

/** Nome com 3 letras ou mais; senão "Investidor". */
export function nomeDoCard(v: unknown): string {
  const nome = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const letras = (nome.match(/\p{L}/gu) ?? []).length;
  return letras >= 3 ? nome : 'Investidor';
}

const umaLinha = (v: unknown, max = 120): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** O trigger do banco acha `NOTA <1|2|3> ·` em QUALQUER ponto da observação, sem
 *  âncora (`MIGRATION_ep_perfil_ponto_medio.sql`), e copia para colunas que alimentam
 *  o público do Meta. Texto que casa isto não entra no card do lote. */
export function temNotaDoTrigger(texto: string): boolean {
  return /NOTA\s*[123]\s*[·—-]/i.test(texto);
}

/** `umaLinha`, mas texto com a marca de NOTA do trigger vira vazio. */
const linhaSemNota = (v: unknown, max = 120): string => {
  const l = umaLinha(v, max);
  return temNotaDoTrigger(l) ? '' : l;
};

function valorLegivel(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `R$ ${v.toLocaleString('pt-BR')}`;
  return linhaSemNota(v) || 'não informado';
}

export const MAX_LINHAS_EXTRAS = 14;
export const MAX_CHARS_LINHA_EXTRA = 200;

/** `valor` veio? Número finito ou texto não vazio. */
function temValor(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  return linhaSemNota(v) !== '';
}

/** As `linhas` do item: só texto ou número, uma linha cada (sem quebra nem espaço
 *  duplo), até 200 caracteres. Vazia sai. Linha com a marca de NOTA do trigger
 *  (`temNotaDoTrigger`, em qualquer ponto da linha) também sai: o card do lote não
 *  pode levar nota. No máximo 14, na ordem. */
export function linhasExtras(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const saida: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' && !(typeof x === 'number' && Number.isFinite(x))) continue;
    const l = umaLinha(x, MAX_CHARS_LINHA_EXTRA);
    if (!l || temNotaDoTrigger(l)) continue;
    saida.push(l);
    if (saida.length >= MAX_LINHAS_EXTRAS) break;
  }
  return saida;
}

/** dd/mm/aaaa em Brasília (o relógio do servidor é UTC). */
function dataDeBrasilia(ms: number): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
}

/** A observação do card. A 1ª linha é o CONTRATO do trigger `eletroposto_estruturar`
 *  (`LP ELETROPOSTO · <perfil>`; o separador é o ponto médio). Sem linha de NOTA,
 *  de Ponto ou de "Como pretende investir": rótulos que o trigger lê não entram
 *  aqui, para o card não ganhar nota, ponto nem faixa de capital inventados. */
export function observacaoDoCard(
  it: { valor?: unknown; cidade?: unknown; origem?: unknown; id_cadastro?: unknown; helena?: unknown; perfil?: unknown; linhas?: unknown },
  agora: number = Date.now(),
): string {
  // Perfil que não é texto (objeto, lista, número) ou que carrega NOTA cai no padrão.
  const perfil = (typeof it.perfil === 'string' ? linhaSemNota(it.perfil, 60) : '') || 'Investidor';
  const extras = linhasExtras(it.linhas);
  const linhas = [`LP ELETROPOSTO · ${perfil}`, ...extras];
  // Sem `valor` e com `linhas` válidas, as linhas ocupam o lugar da pergunta do valor.
  if (!(extras.length > 0 && !temValor(it.valor))) linhas.push(`Quanto pretende investir: ${valorLegivel(it.valor)}`);
  const cidade = linhaSemNota(it.cidade, 80);
  if (cidade) linhas.push(`Cidade: ${cidade}`);
  linhas.push(`Origem: cadastro ${linhaSemNota(it.origem, 40) || 'lote'}:${linhaSemNota(it.id_cadastro, 40) || 's/n'}`);
  const helena = linhaSemNota(it.helena, 300);
  if (helena) linhas.push(`Situação com a agente: ${helena}`);
  linhas.push(`Agenda em lote de ${dataDeBrasilia(agora)}: sem mensagem automática, o consultor chama no horário.`);
  return linhas.join('\n');
}

// ── Leitura paginada (a tabela passa de 1.000 linhas e o PostgREST corta) ────
const PAGINA = 1000;
async function lerPaginado<T>(nome: string, montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>, maxPaginas = 200): Promise<T[]> {
  const todas: T[] = [];
  for (let p = 0; p < maxPaginas; p++) {
    const { data, error } = await montar(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new Error(`ler ${nome} falhou: ${error.message ?? 'erro'}`);
    const lote = data ?? [];
    todas.push(...lote);
    if (lote.length < PAGINA) return todas;
  }
  throw new Error(`ler ${nome}: passou de ${maxPaginas} páginas`);
}

/** Um card que já existe para a chave: o id e se ele é desta origem. */
export interface CardDaChave { id: number | null; doLote: boolean }

/** TODAS as chaves (DDD + 8) que já têm card, em qualquer status, com o id e a
 *  origem de cada card (a segunda rodada precisa saber qual é do lote). */
export async function chavesComCard(): Promise<Map<string, CardDaChave[]>> {
  const linhas = await lerPaginado<{ id?: number | null; cliente_telefone: string | null; created_by?: string | null }>(
    'os cards da agenda', (de, ate) =>
      supabaseGerador.from('agendamentos').select('id, cliente_telefone, created_by')
        .not('cliente_telefone', 'is', null).order('id', { ascending: true }).range(de, ate));
  const mapa = new Map<string, CardDaChave[]>();
  for (const l of linhas) {
    const k = chaveContato(l.cliente_telefone);
    if (!k) continue;
    const lista = mapa.get(k) ?? [];
    lista.push({ id: typeof l.id === 'number' ? l.id : null, doLote: l.created_by === ORIGEM_CADASTRO_EP });
    mapa.set(k, lista);
  }
  return mapa;
}

/**
 * SEGUNDA RODADA: refaz, de forma idempotente, os passos de DEPOIS do insert de um
 * card do lote que nasceu e falhou no meio (a marca, a etiqueta, o repasse). Não
 * muda `quando`, consultor nem status. Os carimbos do tick não são regravados: se
 * o consultor já mexeu no card, zerá-los ou preenchê-los de novo seria desfazer o
 * que ele fez.
 */
export async function consertarCardDoLote(
  id: number, tipo: string,
): Promise<{ ok: true; aviso?: string } | { ok: false; motivo: string; aviso: string }> {
  const falha = (motivo: string) => ({
    ok: false as const, motivo,
    aviso: `O card #${id} existe e é do lote. ${motivo}: confira antes de seguir.`,
  });
  const { data: card, error } = await supabaseGerador.from('agendamentos')
    .select('id, quando, status, repassar_em').eq('id', id).maybeSingle();
  const c = (card ?? null) as { quando?: string | null; status?: string | null; repassar_em?: string | null } | null;
  if (error || !c || !c.quando) return falha('leitura_do_card_falhou');

  // A marca de silêncio, com o `quando` ATUAL do card (upsert: refazer não machuca).
  let marcou = false;
  for (let t = 1; t <= TENTATIVAS_DA_MARCA && !marcou; t++) {
    try { await gravarMarcaMuda(id, c.quando, 'lote'); marcou = true; }
    catch (e) { logger.error('agenda-lote', `conserto: marca ep_mudo falhou (${t}/${TENTATIVAS_DA_MARCA})`, { id, erro: String((e as Error)?.message ?? e) }); }
  }
  if (!marcou) return falha('marca_ep_mudo_nao_gravou_em_3_tentativas');

  let aviso: string | undefined;
  // Etiqueta e tipo só se faltarem. A etiqueta, só com o card ainda `agendado`:
  // depois que o consultor mexe, a agenda limpa a etiqueta guardada de propósito.
  const chaveEtiqueta = `${ETIQUETA_PREFIX}${id}`;
  const chaveTipo = `${TIPO_CARD_PREFIX}${id}`;
  const { data: marcas, error: eMarcas } = await supabase.from('system_state')
    .select('key').in('key', [chaveEtiqueta, chaveTipo]);
  const tem = new Set(((marcas ?? []) as Array<{ key: string }>).map(m => m.key));
  if (eMarcas) {
    aviso = 'nao_deu_para_ver_a_etiqueta';
  } else if (c.status === 'agendado' && !tem.has(chaveEtiqueta)) {
    try { await guardarEtiquetaDoCard(id, tipo, 'lote'); }
    catch (e) { aviso = `etiqueta_nao_gravada: ${String((e as Error)?.message ?? e).slice(0, 120)}`; }
  }
  if (!tem.has(chaveTipo)) {
    // `ignoreDuplicates` dentro: o tipo nasce uma vez e fica.
    if (!(await guardarTipoDoCard(id, tipo, 'lote'))) aviso = [aviso, 'tipo_nao_gravado'].filter(Boolean).join('; ');
  }

  // O repasse de 12h só interessa enquanto o card está `agendado`.
  if (c.status === 'agendado') {
    const { error: eRep } = await supabaseGerador.from('agendamentos').update({ repassar_em: null }).eq('id', id);
    const { data: volta, error: eVolta } = await supabaseGerador.from('agendamentos')
      .select('id, repassar_em').eq('id', id).maybeSingle();
    const v = (volta ?? null) as { repassar_em?: string | null } | null;
    if (eRep) return falha('update_do_repasse_falhou');
    if (eVolta || !v) return falha('leitura_de_volta_falhou');
    if (v.repassar_em != null) return falha('repassar_em_ficou_preenchido');
  }
  return aviso ? { ok: true, aviso } : { ok: true };
}

/** Depois de 14/10/2026 em Brasília a rota de escrita se fecha sozinha: o segredo
 *  de cron deste repo público consta como exposto, e uma rota que cria centenas de
 *  cards não pode ficar aberta para sempre. O GET de conferência continua. */
export const LOTE_ABERTO_ATE = '2026-10-15T03:00:00Z';
export function loteEncerrado(agora: number = Date.now()): boolean {
  return agora >= Date.parse(LOTE_ABERTO_ATE);
}

// ── O lote ────────────────────────────────────────────────────────────────────
export async function agendarEmLote(
  itens: ItemDoLote[], opts: { dry?: boolean; tipo?: unknown } = {},
): Promise<SaidaDoLote> {
  const dry = opts.dry === true;
  const tipo = typeof opts.tipo === 'string' ? opts.tipo : null;
  const base = (erro: string): SaidaDoLote => ({
    ok: false, dry, tipo, itens: [], totais: {}, parou: false, motivo_da_parada: null, erro,
  });
  if (!tipo || !(TIPOS_DO_LOTE as readonly string[]).includes(tipo)) return base('tipo_invalido');
  if (!Array.isArray(itens) || itens.length === 0) return base('sem_itens');
  if (itens.length > MAX_ITENS_LOTE) return base(`maximo_${MAX_ITENS_LOTE}_itens_por_chamada`);

  // Antes de qualquer item: quem já tem card e quem não pode receber. Leitura que
  // falha derruba o lote INTEIRO, sem gravar nada (modo estrito).
  let comCard: Map<string, CardDaChave[]>;
  let bloqueado: (p: string) => boolean;
  let silenciado: (p: string) => boolean;
  try {
    [comCard, bloqueado, silenciado] = await Promise.all([
      chavesComCard(),
      carregarBloqueados({ estrito: true }),
      carregarSilenciados({ estrito: true }),
    ]);
  } catch (e) {
    logger.error('agenda-lote', 'leitura prévia falhou: nada foi gravado', e);
    return base(`leitura_previa_falhou: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  }

  const agora = Date.now();
  const agoraIso = new Date(agora).toISOString();
  const saida: SaidaDoItem[] = [];
  let parou = false;
  let motivoDaParada: string | null = null;
  let errosSeguidos = 0;
  /** Chaves que ganharam card NESTA chamada (ou ganhariam, no dry). */
  const criadosAgora = new Set<string>();

  const empurrar = (chave: string, resultado: ResultadoDoItem, id: number | null, motivo: string | null, aviso?: string) => {
    saida.push({ chave, resultado, id, motivo, ...(aviso ? { aviso } : {}) });
  };

  for (let i = 0; i < itens.length; i++) {
    const it = (itens[i] ?? {}) as ItemDoLote;
    const chave = umaLinha(it.chave, 80) || `item_${i}`;

    if (parou) { empurrar(chave, 'nao_processado', null, 'lote_parado'); continue; }

    // 1) O telefone primeiro: é por ele que se acha o card que já existe.
    const tel = normalizarTelefone(it.telefone);
    if (!tel) { empurrar(chave, 'invalido', null, 'telefone_invalido'); continue; }
    const k = chaveContato(tel);
    if (!k) { empurrar(chave, 'invalido', null, 'telefone_sem_chave'); continue; }

    // 2) Não duplicar. Card que já existe: se é DESTE lote e nasceu nesta chamada,
    // é duplicado dentro do próprio lote; se é do lote de uma chamada ANTERIOR, a
    // rodada CONFERE e conserta o que faltou depois do insert (sem mudar `quando`,
    // consultor nem status); de qualquer outra origem, `ja_tem_card`, sem tocar.
    // Vem ANTES da validação do horário: o horário do item de ontem já passou, e
    // isso não pode impedir o conserto do card.
    if (criadosAgora.has(k)) { empurrar(chave, 'ja_tem_card', null, 'a_chave_ja_tem_card'); continue; }
    const existentes = comCard.get(k);
    if (existentes?.length) {
      const doLote = existentes.find(c => c.doLote && c.id !== null);
      if (!doLote) { empurrar(chave, 'ja_tem_card', null, 'a_chave_ja_tem_card'); continue; }
      if (dry) { empurrar(chave, 'conferido', doLote.id, null); continue; }
      const r = await consertarCardDoLote(doLote.id!, tipo);
      if (r.ok) { empurrar(chave, 'conferido', doLote.id, null, r.aviso); continue; }
      empurrar(chave, 'parou_o_lote', doLote.id, r.motivo, r.aviso);
      parou = true; motivoDaParada = r.motivo;
      continue;
    }

    // 3) Validar. Item inválido não grava.
    const consultor = String(it.consultor ?? '');
    if (!DONOS_EP.includes(consultor)) { empurrar(chave, 'invalido', null, 'consultor_fora_de_Thiago_e_Diego'); continue; }
    const q = validarQuando(it.quando, agora);
    if (!q.ok) { empurrar(chave, 'invalido', null, q.motivo); continue; }

    // Não chamar quem pediu para parar.
    if (bloqueado(tel) || silenciado(tel)) { empurrar(chave, 'bloqueado', null, 'bloqueado_ou_pediu_para_parar'); continue; }

    const ficha: Record<string, unknown> = {
      vendedor_nome: consultor,
      quando: q.iso,
      cliente_nome: nomeDoCard(it.nome),
      cliente_telefone: tel,
      cidade: linhaSemNota(it.cidade, 80) || null,
      status: 'agendado',
      temperatura: 'morno',
      created_by: ORIGEM_CADASTRO_EP,
      ...Object.fromEntries(CARIMBOS_DO_TICK.map(c => [c, agoraIso])),
      observacao: observacaoDoCard(it, agora),
    };

    if (dry) {
      criadosAgora.add(k);                  // dois iguais no mesmo lote: o 2º já é duplicado
      empurrar(chave, 'previa', null, null);
      continue;
    }

    // 3) Gravar o card.
    let id: number | null = null;
    try {
      const r = await gravarCardEletroposto(ficha);
      if (r.bloqueado) { empurrar(chave, 'bloqueado', null, 'bloqueado_no_gravador'); continue; }
      id = r.id;
    } catch (e) {
      if (String((e as { code?: string })?.code) === '23505') {
        errosSeguidos = 0;
        empurrar(chave, 'horario_ocupado', null, 'consultor_ja_tem_card_neste_horario');
        continue;
      }
      errosSeguidos++;
      logger.error('agenda-lote', 'gravar o card falhou', { chave, erro: String((e as Error)?.message ?? e) });
      empurrar(chave, 'erro', null, `gravar_falhou: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      if (errosSeguidos >= ERROS_SEGUIDOS_MAX) { parou = true; motivoDaParada = `${ERROS_SEGUIDOS_MAX}_erros_de_gravacao_seguidos`; }
      continue;
    }
    errosSeguidos = 0;
    criadosAgora.add(k);
    if (id === null) {
      empurrar(chave, 'erro', null, 'insert_sem_id');
      parou = true; motivoDaParada = 'insert_sem_id';
      continue;
    }

    // 4) Logo depois do insert, nesta ordem.
    // 4a) A marca de silêncio, com o `quando` lido DE VOLTA do card gravado.
    let quandoGravado = q.iso;
    const lido = await supabaseGerador.from('agendamentos').select('quando').eq('id', id).maybeSingle();
    const qLido = (lido?.data as { quando?: string } | null)?.quando;
    if (!lido?.error && qLido && Number.isFinite(new Date(qLido).getTime())) quandoGravado = qLido;

    let marcou = false;
    for (let t = 1; t <= TENTATIVAS_DA_MARCA && !marcou; t++) {
      try { await gravarMarcaMuda(id, quandoGravado, 'lote'); marcou = true; }
      catch (e) { logger.error('agenda-lote', `marca ep_mudo falhou (${t}/${TENTATIVAS_DA_MARCA})`, { id, erro: String((e as Error)?.message ?? e) }); }
    }
    if (!marcou) {
      empurrar(chave, 'parou_o_lote', id, 'marca_ep_mudo_nao_gravou_em_3_tentativas',
        `O card #${id} FOI criado. A trava em código o protege, mas a marca ep_mudo não gravou: confira antes de seguir.`);
      parou = true; motivoDaParada = 'marca_ep_mudo_nao_gravou';
      continue;
    }

    // 4b) Etiqueta e tipo. Etiqueta que falha não para o lote: é pílula de tela.
    let aviso: string | undefined;
    try { await guardarEtiquetaDoCard(id, tipo, 'lote'); }
    catch (e) { aviso = `etiqueta_nao_gravada: ${String((e as Error)?.message ?? e).slice(0, 120)}`; }
    const tipoOk = await guardarTipoDoCard(id, tipo, 'lote');
    if (!tipoOk) aviso = [aviso, 'tipo_nao_gravado'].filter(Boolean).join('; ');

    // 4c) O repasse de 12h mora no banco: o trigger o arma a partir do `quando`.
    // UPDATE separado, SÓ com `repassar_em: null` (no mesmo UPDATE do `quando` não gruda).
    const { error: eRep } = await supabaseGerador.from('agendamentos').update({ repassar_em: null }).eq('id', id);

    // 4d) Ler de volta e CONFERIR.
    const { data: volta, error: eVolta } = await supabaseGerador.from('agendamentos')
      .select(`id, repassar_em, ${CARIMBOS_DO_TICK.join(', ')}`).eq('id', id).maybeSingle();
    const v = (volta ?? null) as Record<string, unknown> | null;
    const carimbosOk = !!v && CARIMBOS_DO_TICK.every(c => v[c] != null);
    if (eRep || eVolta || !v || v.repassar_em != null || !carimbosOk) {
      const porque = eRep ? 'update_do_repasse_falhou'
        : (eVolta || !v) ? 'leitura_de_volta_falhou'
          : v.repassar_em != null ? 'repassar_em_ficou_preenchido'
            : 'carimbos_do_tick_nao_gravaram';
      empurrar(chave, 'parou_o_lote', id, porque,
        `O card #${id} FOI criado e a marca ep_mudo está gravada. ${porque}: o repasse de 12h pode mover este card. Confira antes de seguir.`);
      parou = true; motivoDaParada = porque;
      continue;
    }

    empurrar(chave, 'criado', id, null, aviso);
  }

  const totais: Record<string, number> = { itens: saida.length };
  for (const s of saida) totais[s.resultado] = (totais[s.resultado] ?? 0) + 1;
  if (!dry) logger.info('agenda-lote', 'lote processado', { ...totais, parou, motivoDaParada });
  return { ok: true, dry, tipo, itens: saida, totais, parou, motivo_da_parada: motivoDaParada };
}

// ── A conferência (só leitura) ────────────────────────────────────────────────
interface CardDoLote {
  id: number; quando: string | null; status: string | null; vendedor_nome: string | null;
  repassar_em: string | null; lead_resposta_at: string | null; cliente_telefone: string | null; created_at: string | null;
}

const CHUNK = 150;
async function chavesPresentes(prefixo: string, ids: number[]): Promise<Map<number, unknown>> {
  const mapa = new Map<number, unknown>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const fatia = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase.from('system_state').select('key, value').in('key', fatia.map(id => `${prefixo}${id}`));
    if (error) throw new Error(`ler ${prefixo} falhou: ${error.message}`);
    for (const r of data ?? []) {
      const id = Number(String((r as { key: string }).key).slice(prefixo.length));
      if (Number.isInteger(id)) mapa.set(id, (r as { value: unknown }).value);
    }
  }
  return mapa;
}

const diaBrt = (iso: string): string => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);

export async function conferirLote(): Promise<Record<string, unknown>> {
  const cards = await lerPaginado<CardDoLote>('os cards do lote', (de, ate) =>
    supabaseGerador.from('agendamentos')
      .select('id, quando, status, vendedor_nome, repassar_em, lead_resposta_at, cliente_telefone, created_at')
      .eq('created_by', ORIGEM_CADASTRO_EP).order('id', { ascending: true }).range(de, ate));

  const porConsultor: Record<string, number> = {};
  const porDia: Record<string, number> = {};
  const porStatus: Record<string, number> = {};
  for (const c of cards) {
    const who = String(c.vendedor_nome ?? '—');
    porConsultor[who] = (porConsultor[who] ?? 0) + 1;
    if (c.quando) { const d = diaBrt(c.quando); porDia[d] = (porDia[d] ?? 0) + 1; }
    const st = String(c.status ?? '—');
    porStatus[st] = (porStatus[st] ?? 0) + 1;
  }

  const ids = cards.map(c => c.id);
  const [mudas, etiquetas] = await Promise.all([chavesPresentes(EP_MUDO_PREFIX, ids), chavesPresentes(ETIQUETA_PREFIX, ids)]);
  let mudaCasando = 0;
  for (const c of cards) {
    const v = mudas.get(c.id) as { quando?: string } | undefined;
    if (v?.quando && c.quando && new Date(v.quando).getTime() === new Date(c.quando).getTime()) mudaCasando++;
  }

  // Mensagens NOSSAS (from_me) aos telefones deles, depois da criação do card.
  // A comparação é pela chave DDD + 8. Telefone de 14+ dígitos é LID (a pessoa
  // digitando pelo celular da linha) e não dá para cruzar sem o mapa: é contado.
  const criadoEm = new Map<string, number>();
  for (const c of cards) {
    const k = chaveContato(c.cliente_telefone);
    if (k) criadoEm.set(k, c.created_at ? Date.parse(c.created_at) : 0);
  }
  const desde = cards.map(c => c.created_at).filter(Boolean).sort()[0] ?? null;
  let nossas = 0, lidsIgnorados = 0, lidas = 0, truncado = false, erroMsgs: string | null = null;
  const amostra: Array<{ telefone_final: string; momment: string }> = [];
  if (desde) {
    try {
      const MAX_PAG = 40;
      for (let p = 0; p < MAX_PAG; p++) {
        const { data, error } = await supabase.from('wa_mensagens')
          .select('id, telefone, momment')
          .eq('from_me', true).eq('is_group', false).gte('momment', desde)
          .order('id', { ascending: true }).range(p * PAGINA, p * PAGINA + PAGINA - 1);
        if (error) throw new Error(error.message);
        const lote = (data ?? []) as Array<{ telefone: string | null; momment: string | null }>;
        lidas += lote.length;
        for (const m of lote) {
          const d = String(m.telefone ?? '').replace(/\D/g, '');
          if (d.length > 13) { lidsIgnorados++; continue; }
          const k = chaveContato(d);
          const criado = k ? criadoEm.get(k) : undefined;
          if (criado === undefined || !m.momment) continue;
          if (Date.parse(m.momment) > criado) {
            nossas++;
            if (amostra.length < 10) amostra.push({ telefone_final: d.slice(-4), momment: m.momment });
          }
        }
        if (lote.length < PAGINA) break;
        if (p === MAX_PAG - 1) truncado = true;
      }
    } catch (e) { erroMsgs = String((e as Error)?.message ?? e).slice(0, 200); }
  }

  return {
    ok: true,
    origem: ORIGEM_CADASTRO_EP,
    total: cards.length,
    por_consultor: porConsultor,
    por_dia_brt: porDia,
    por_status: porStatus,
    agendados: porStatus['agendado'] ?? 0,
    com_marca_ep_mudo_casando: mudaCasando,
    com_etiqueta_card: etiquetas.size,
    com_repassar_em_nulo: cards.filter(c => c.repassar_em == null).length,
    com_lead_resposta_at: cards.filter(c => c.lead_resposta_at != null).length,
    mensagens_nossas_depois_da_criacao: {
      quantidade: nossas,
      esperado: 0,
      mensagens_nossas_lidas: lidas,
      leitura_truncada: truncado,
      lids_sem_cruzar: lidsIgnorados,
      erro_de_leitura: erroMsgs,
      amostra,
    },
  };
}
