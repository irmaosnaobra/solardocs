// ─────────────────────────────────────────────────────────────────────────────
// RESUMO SEMANAL DO SOLAR POR VENDEDOR (23/11/2026). Robô `solar_relatorio_semanal` (chefe/classes.ts, aviso_interno_p2).
// Toda SEXTA, das 16h às 17h59 de Brasília, cada um dos quatro (Diego, Thiago, Nilce e Giovanna) recebe, em privado, pela linha 5040, a mesma
// mensagem com o resultado da semana do solar por vendedor: leads agendados, orçamentos e contratos. Só equipe: nada vai a cliente (por isso o boletim leva emojis e negrito, pedido do dono; a regra de "sem emoji" segue valendo para cliente).
// Período: de sexta a quinta. Na sexta D conta de D-7 00:00 até D-1 23:59 (Brasília), então a semana nunca repete lead da anterior.
// Condições do chefe anti-ban:
//  · UMA bolha por pessoa (sendWhatsApp, instância 'io'), UM envio por rodada do /process-messages (pg_cron */2): os quatro chegam em ~8 min;
//  · janela por Intl com America/Sao_Paulo, nunca pela hora do servidor;
//  · chave por pessoa `solar_relatorio_semanal:<sexta>:<pessoa>` em system_state (banco PRINCIPAL, o mesmo que o lineThrottle lê), reservada por
//    INSERT ANTES do envio. O prefixo está em PREFIXOS_RESPOSTA_AGENTES: a chave vale como carimbo da linha;
//  · duas rodadas juntas (pg_cron e Actions) nunca mandam duas vezes: a chave decide, e um envio com menos de 90 s barra o seguinte;
//  · a rodada PARA no 1º erro. Cooldown/credencial (provou que nada saiu) solta a chave; 5xx e timeout MANTÊM, a mensagem pode ter chegado;
//  · telefone só da tabela `consultores` (carregarTelefonesConsultores + telefoneDoConsultor). Sem telefone, a pessoa é pulada, sem reservar;
//  · SOLAR_RELATORIO_OFF=1 desliga.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp, linhaEmCooldown } from '../agents/zapiClient';
import { reservarChave, liberarChave } from '../agentes5040/cota';
import { carregarTelefonesConsultores, telefoneDoConsultor, erroProvaQueNaoSaiu } from '../agentes5040/fichaEnvio';
import { ehCardSaiu, ehCardDaDuda, MARCA_ORIGEM_DUDA } from '../agenda/solarRota';

export const PREFIXO_RELATORIO = 'solar_relatorio_semanal:';

/** A ordem da mensagem e da fila de envio. */
export const PESSOAS_RELATORIO = ['Diego', 'Thiago', 'Nilce', 'Giovanna'] as const;
export type PessoaRelatorio = typeof PESSOAS_RELATORIO[number];

/** Origens que caem em `agendamentos` como ENERGIA SOLAR (a mesma lista do solarBoasVindas.SOLAR_ORIGENS; `indicacao` fica fora). */
const ORIGENS_SOLAR = ['lp_solar', 'lead-meta', 'leads-meta', 'manychat'];
/** "Desses": quem chegou ao orçamento ou além. Quem fechou (ou fechou com o concorrente) também passou por ele. */
const STATUS_ORCAMENTO = ['fez_orcamento', 'proposta_apresentada', 'apalavrado', 'fechou', 'fechou_concorrente'];
const STATUS_CONTRATO = ['fechou'];

/** Intervalo mínimo entre dois envios do resumo (a rodada do pg_cron é de 2 em 2 min; 90 s dá folga para o atraso). */
export const INTERVALO_MIN_MS = 90_000;
export const HORA_INICIO = 16;
export const HORA_FIM = 18;

const PAGINA = 1000;
const MAX_PAGINAS = 20;

export const desligado = (): boolean => (process.env.SOLAR_RELATORIO_OFF || '').trim() === '1';

const chaveNome = (s: unknown): string => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// ── relógio de Brasília ──────────────────────────────────────────────────────

const dataBRT = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** Sexta, 16:00 até 17:59 em America/Sao_Paulo. O relógio do servidor é UTC: dia e hora saem do Intl com fuso explícito. */
export function naJanelaDaSexta(agoraMs: number): boolean {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(agoraMs));
  const dia = p.find(x => x.type === 'weekday')?.value;
  const hora = Number(p.find(x => x.type === 'hour')?.value);
  return dia === 'Fri' && hora >= HORA_INICIO && hora < HORA_FIM;
}

const somaDias = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};

/** A sexta da semana de `agoraMs` (a de hoje, se hoje é sexta; senão a mais recente). Na janela de envio é sempre o dia de hoje. */
export function sextaDeReferencia(agoraMs: number): string {
  const hoje = dataBRT(agoraMs);
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay();      // 0 = domingo ... 5 = sexta
  return somaDias(hoje, -((dow + 2) % 7));
}

export interface PeriodoRelatorio {
  sexta: string;
  /** Primeiro dia (sexta anterior) e último dia (quinta), AAAA-MM-DD. */
  de: string; ate: string;
  /** Intervalo em UTC: [iniIso, fimIso). Brasília é UTC-3 o ano todo. */
  iniIso: string; fimIso: string;
  /** dd/mm para o título. */
  rotuloDe: string; rotuloAte: string;
}

const ddmm = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function periodoDaSemana(sexta: string): PeriodoRelatorio {
  const de = somaDias(sexta, -7);
  const ate = somaDias(sexta, -1);
  return {
    sexta, de, ate,
    iniIso: new Date(`${de}T00:00:00-03:00`).toISOString(),
    fimIso: new Date(`${sexta}T00:00:00-03:00`).toISOString(),
    rotuloDe: ddmm(de), rotuloAte: ddmm(ate),
  };
}

// ── a conta ──────────────────────────────────────────────────────────────────

export interface CardRelatorio {
  vendedor_nome: string | null;
  status: string | null;
  created_by: string | null;
  observacao: string | null;
  created_at?: string | null;
}

export interface ContagemPessoa { leads: number; orcamentos: number; contratos: number }

/**
 * O card é um lead agendado do SOLAR que conta? Origem solar (created_by) OU card criado pela Duda no WhatsApp (linha de origem na observação);
 * fora cancelado, SAIU SEM MARCAR, teste (`lp_solar_teste` e qualquer created_by com "teste") e eletroposto.
 */
export function cardContaNoRelatorio(c: CardRelatorio): boolean {
  const por = String(c.created_by ?? '').trim();
  if (String(c.status ?? '') === 'cancelado') return false;
  if (/teste/i.test(por) || /eletroposto/i.test(por)) return false;
  if (ehCardSaiu(c.observacao)) return false;
  return ORIGENS_SOLAR.includes(por) || ehCardDaDuda(c.observacao);
}

/** Contagem por vendedor, na ordem fixa. Quem não aparece vem com zero; card de outro vendedor (ou sem vendedor) não conta. */
export function contarPorVendedor(cards: readonly CardRelatorio[]): Record<PessoaRelatorio, ContagemPessoa> {
  const r = {} as Record<PessoaRelatorio, ContagemPessoa>;
  for (const p of PESSOAS_RELATORIO) r[p] = { leads: 0, orcamentos: 0, contratos: 0 };
  for (const c of cards) {
    if (!cardContaNoRelatorio(c)) continue;
    const pessoa = PESSOAS_RELATORIO.find(p => chaveNome(p) === chaveNome(c.vendedor_nome));
    if (!pessoa) continue;
    const st = String(c.status ?? '');
    r[pessoa].leads++;
    if (STATUS_ORCAMENTO.includes(st)) r[pessoa].orcamentos++;
    if (STATUS_CONTRATO.includes(st)) r[pessoa].contratos++;
  }
  return r;
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

const SEPARADOR = '━━━━━━━━━━━━━━';

/**
 * Quem leva o destaque: mais contratos; no empate, mais orçamentos; se ainda empatar, o primeiro da ordem (Diego, Thiago, Nilce, Giovanna).
 * Todo mundo com zero contrato e zero orçamento: sem destaque (null).
 */
export function destaqueDaSemana(contagem: Record<PessoaRelatorio, ContagemPessoa>): { pessoa: PessoaRelatorio; texto: string } | null {
  let melhor: PessoaRelatorio | null = null;
  for (const p of PESSOAS_RELATORIO) {
    if (!melhor) { melhor = p; continue; }
    const a = contagem[p], b = contagem[melhor];
    if (a.contratos > b.contratos || (a.contratos === b.contratos && a.orcamentos > b.orcamentos)) melhor = p;
  }
  if (!melhor) return null;
  const c = contagem[melhor];
  if (c.contratos > 0) return { pessoa: melhor, texto: plural(c.contratos, 'contrato fechado', 'contratos fechados') };
  if (c.orcamentos > 0) return { pessoa: melhor, texto: plural(c.orcamentos, 'orçamento', 'orçamentos') };
  return null;
}

/**
 * O boletim, em 1 bolha, com negrito do WhatsApp entre asteriscos. Os emojis são DESTE aviso interno (pedido do dono em 23/11/2026): a regra de
 * "sem emoji" continua valendo para texto de cliente. Sem travessão (o separador é a linha de ━ e o · entre os números do time).
 * A ordem é Diego, Thiago, Nilce e Giovanna.
 */
export function montarTextoRelatorio(p: Pick<PeriodoRelatorio, 'rotuloDe' | 'rotuloAte'>, contagem: Record<PessoaRelatorio, ContagemPessoa>): string {
  const linhas: string[] = ['📊 *BOLETIM SOLAR DA SEMANA* ☀️', `📅 De ${p.rotuloDe} a ${p.rotuloAte}`, ''];
  const d = destaqueDaSemana(contagem);
  if (d) linhas.push(`🏆 *Destaque: ${d.pessoa}*, ${d.texto}`, '');
  linhas.push(SEPARADOR);
  PESSOAS_RELATORIO.forEach((nome, i) => {
    const c = contagem[nome];
    if (i > 0) linhas.push('');
    linhas.push(
      `🔹 *${nome.toUpperCase()}*`,
      `📥 ${plural(c.leads, 'lead agendado', 'leads agendados')}`,
      `📝 ${plural(c.orcamentos, 'orçamento', 'orçamentos')}`,
      `✅ ${plural(c.contratos, 'contrato fechado', 'contratos fechados')}`,
    );
  });
  const soma = (k: keyof ContagemPessoa): number => PESSOAS_RELATORIO.reduce((s, n) => s + contagem[n][k], 0);
  linhas.push(
    SEPARADOR,
    `📈 *Time:* ${plural(soma('leads'), 'lead', 'leads')} · ${plural(soma('orcamentos'), 'orçamento', 'orçamentos')} · ${plural(soma('contratos'), 'contrato', 'contratos')}`,
    'Bora pra cima! 💪',
  );
  return linhas.join('\n');
}

// ── leitura (banco do Gerador) ───────────────────────────────────────────────

const COLUNAS = 'id, vendedor_nome, status, created_by, observacao, created_at';

type Linha = CardRelatorio & { id: number | string };

/** Lê paginado, andando pelo que VOLTOU (o teto de linhas do PostgREST fatia calado). Erro de leitura sobe. */
async function lerPaginado(periodo: PeriodoRelatorio, filtrar: (q: any) => any): Promise<Linha[]> {
  const out: Linha[] = [];
  for (let pagina = 0, de = 0; pagina < MAX_PAGINAS; pagina++) {
    const base = supabaseGerador.from('agendamentos').select(COLUNAS)
      .gte('created_at', periodo.iniIso).lt('created_at', periodo.fimIso).order('id', { ascending: true });
    const { data, error } = await filtrar(base).range(de, de + PAGINA - 1);
    if (error) throw new Error(`leitura dos cards falhou: ${String(error.message ?? error.code ?? error)}`);
    const lote = (data ?? []) as Linha[];
    if (!lote.length) break;
    out.push(...lote);
    de += lote.length;
  }
  return out;
}

/** Os cards solares criados no período: por origem (created_by) e os da Duda (linha de origem na observação), sem repetir. */
export async function lerCardsDoPeriodo(periodo: PeriodoRelatorio): Promise<Linha[]> {
  const porOrigem = await lerPaginado(periodo, q => q.in('created_by', ORIGENS_SOLAR));
  const daDuda = await lerPaginado(periodo, q => q.ilike('observacao', `%${MARCA_ORIGEM_DUDA}%`));
  const vistos = new Set<string>();
  const todos: Linha[] = [];
  for (const c of [...porOrigem, ...daDuda]) {
    const k = String(c.id);
    if (vistos.has(k)) continue;
    vistos.add(k);
    todos.push(c);
  }
  return todos;
}

// ── o tick ───────────────────────────────────────────────────────────────────

export interface ResultadoRelatorio {
  motivo: string;
  enviados: number;
  pessoa?: string;
  periodo?: { de: string; ate: string };
  contagem?: Record<PessoaRelatorio, ContagemPessoa>;
  /** Só na prévia (dry). Leva nome próprio e números, nenhum telefone. */
  texto?: string;
  erro?: string;
}

const chaveDaPessoa = (sexta: string, pessoa: PessoaRelatorio): string => `${PREFIXO_RELATORIO}${sexta}:${chaveNome(pessoa)}`;

/**
 * UMA rodada. Manda no máximo UMA mensagem, para a primeira pessoa (na ordem) que ainda não recebeu nesta sexta, e para.
 * `dry` monta e devolve o texto em qualquer dia e hora, sem ler nem gravar chave e sem enviar.
 */
export async function runSolarRelatorioSemanalTick(opts: { dry?: boolean; agora?: number } = {}): Promise<ResultadoRelatorio> {
  if (desligado()) return { motivo: 'desligado', enviados: 0 };
  const agora = opts.agora ?? Date.now();
  const periodo = periodoDaSemana(sextaDeReferencia(agora));
  const resumoPeriodo = { de: periodo.de, ate: periodo.ate };

  if (opts.dry) {
    try {
      const contagem = contarPorVendedor(await lerCardsDoPeriodo(periodo));
      return { motivo: 'dry', enviados: 0, periodo: resumoPeriodo, contagem, texto: montarTextoRelatorio(periodo, contagem) };
    } catch (e) {
      logger.error('solar-relatorio', 'prévia falhou', String((e as Error)?.message ?? e).slice(0, 160));
      return { motivo: 'erro_leitura', enviados: 0, periodo: resumoPeriodo };
    }
  }

  if (!naJanelaDaSexta(agora)) return { motivo: 'fora_da_janela', enviados: 0 };

  // 1) Quem já recebeu nesta sexta (e quando saiu o último envio).
  const { data: achadas, error: erroChaves } = await supabase.from('system_state')
    .select('key, value').like('key', `${PREFIXO_RELATORIO}${periodo.sexta}:%`);
  if (erroChaves) { logger.error('solar-relatorio', 'ler as chaves da semana falhou'); return { motivo: 'erro_leitura', enviados: 0 }; }
  const chaves = (achadas ?? []) as Array<{ key: string; value?: { em?: string } | null }>;
  const jaTem = new Set(chaves.map(c => c.key));
  const pendentes = PESSOAS_RELATORIO.filter(p => !jaTem.has(chaveDaPessoa(periodo.sexta, p)));
  if (!pendentes.length) return { motivo: 'todos_enviados', enviados: 0 };

  // 2) Um de cada vez: o envio anterior tem que ter pelo menos INTERVALO_MIN_MS (cobre o pg_cron e o Actions juntos).
  const recente = chaves.some(c => {
    const em = Date.parse(String(c.value?.em ?? ''));
    return Number.isFinite(em) && agora - em < INTERVALO_MIN_MS;
  });
  if (recente) return { motivo: 'espacando', enviados: 0 };

  // 3) A primeira pendente COM telefone (da tabela consultores). Sem telefone, pula, sem reservar nada.
  const tels = await carregarTelefonesConsultores();
  if (!tels.ok) { logger.error('solar-relatorio', 'telefones dos consultores indisponíveis', tels.codigo); return { motivo: 'erro_telefones', enviados: 0 }; }
  let pessoa: PessoaRelatorio | null = null;
  let telefone = '';
  for (const p of pendentes) {
    const t = String(telefoneDoConsultor(tels.mapa, p) ?? '').replace(/\D/g, '');
    if (t.length >= 10 && t.length <= 13) { pessoa = p; telefone = t; break; }
    logger.error('solar-relatorio', `sem telefone para ${p}: pulada nesta rodada`);
  }
  if (!pessoa) return { motivo: 'sem_telefone', enviados: 0 };

  // 4) Linha em cooldown: não reserva, não envia. A próxima rodada tenta de novo.
  if (linhaEmCooldown('io')) return { motivo: 'cooldown', enviados: 0, pessoa };

  // 5) O texto (lê o banco do Gerador). Erro de leitura: nada reservado.
  let contagem: Record<PessoaRelatorio, ContagemPessoa>;
  try {
    contagem = contarPorVendedor(await lerCardsDoPeriodo(periodo));
  } catch (e) {
    logger.error('solar-relatorio', 'leitura dos cards falhou', String((e as Error)?.message ?? e).slice(0, 160));
    return { motivo: 'erro_leitura', enviados: 0 };
  }
  const texto = montarTextoRelatorio(periodo, contagem);

  // 6) Reserva por INSERT ANTES do envio: quem não pegou a chave não envia.
  const chave = chaveDaPessoa(periodo.sexta, pessoa);
  const reserva = await reservarChave(chave, { pessoa: chaveNome(pessoa), sexta: periodo.sexta }, new Date(agora));
  if (reserva === 'ja_existe') return { motivo: 'ja_reservada', enviados: 0, pessoa };
  if (reserva === 'erro') { logger.error('solar-relatorio', `reserva da chave falhou para ${pessoa}`); return { motivo: 'erro_reserva', enviados: 0, pessoa }; }

  // 7) Envio: 1 bolha, linha io. A rodada para aqui, com sucesso ou com erro.
  try {
    await sendWhatsApp(telefone, texto, 'io');
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 160);
    if (erroProvaQueNaoSaiu(e)) {
      await liberarChave(chave);          // nada saiu: a próxima rodada tenta de novo
      logger.error('solar-relatorio', `resumo de ${pessoa} não saiu (linha em cooldown ou sem credencial); chave solta`, msg);
      return { motivo: 'cooldown', enviados: 0, pessoa, erro: msg };
    }
    // 5xx ou timeout: a mensagem pode ter chegado. A chave FICA (melhor perder um resumo que mandar dois).
    logger.error('solar-relatorio', `envio para ${pessoa} falhou (pode ter saído); chave mantida`, msg);
    return { motivo: 'erro_envio', enviados: 0, pessoa, erro: msg };
  }

  logger.info('solar-relatorio', `resumo enviado para ${pessoa}`, { sexta: periodo.sexta });
  return { motivo: 'enviado', enviados: 1, pessoa, periodo: resumoPeriodo };
}

// ── sonda ────────────────────────────────────────────────────────────────────

/**
 * Prova a trava sem enviar nada: grava `solar_relatorio_semanal:sonda:<ts>:x`, tenta gravar de novo (tem que voltar "já existe"), lê, apaga e
 * confere que sumiu. Escreve, lê e desfaz.
 */
export async function sondarTravaDoRelatorio(agora: number = Date.now()): Promise<{
  ok: boolean; enviou: false; gravou: string; segunda: string; leu: boolean; apagou: boolean;
}> {
  const chave = `${PREFIXO_RELATORIO}sonda:${agora}:x`;
  let gravou = 'erro', segunda = 'erro', leu = false, apagou = false;
  try {
    gravou = await reservarChave(chave, { sonda: true }, new Date(agora));
    segunda = await reservarChave(chave, { sonda: true }, new Date(agora));
    const { data } = await supabase.from('system_state').select('key').eq('key', chave).maybeSingle();
    leu = !!data;
  } finally {
    await liberarChave(chave);
    const { data } = await supabase.from('system_state').select('key').eq('key', chave).maybeSingle();
    apagou = !data;
  }
  return { ok: gravou === 'reservada' && segunda === 'ja_existe' && leu && apagou, enviou: false, gravou, segunda, leu, apagou };
}
