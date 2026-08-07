// ─────────────────────────────────────────────────────────────────────────────
// SEMENTE — nutrição de quem pediu orçamento de solar e não fechou.
//
// Ideia do dono: "mais um mês e ainda sem energia solar". Não é perseguir venda:
// é continuar existindo na cabeça de quem já quis, e puxar essa pessoa pro
// Instagram — lá ela vê obra real toda semana sem a gente precisar mandar nada.
// Quem acompanha volta sozinho quando a conta de luz aperta.
//
// ── O que faz isto ser nutrição e não spam (é a linha inteira em risco) ──
//   1. CADÊNCIA LONGA: 1 toque a cada 30 dias, no máximo 4 toques. Depois disso
//      a pessoa nunca mais é procurada por este canal. Sem ciclo infinito.
//   2. ÂNGULO NOVO A CADA TOQUE: quatro textos diferentes, nenhum repetindo o
//      anterior. Mensagem igual todo mês é o que faz virar denúncia.
//   3. SAÍDA EM TODA MENSAGEM: "responde PARAR que eu paro" — e o PARAR funciona
//      de verdade (blastRespostas joga na supressão, que este serviço respeita).
//   4. PÚBLICO CONSERVADOR por padrão: quem fez orçamento, cancelou ou fechou com
//      concorrente. Quem disse "sem interesse" fica FORA até o dono ligar na mão
//      (SEMENTE_STATUS) — mandar mensal pra quem já disse não é o caminho curto
//      pro bloqueio.
//   5. RITMO: janela 09h–19h, 1 pessoa a cada 15 min, dentro do teto da linha que
//      a Bia e o resto dividem. ~3/h, não mais.
//   6. NUNCA em quem está em conversa: agendamento futuro, em atendimento,
//      falando no WhatsApp ou já fechou saem do público sozinhos.
//
// Texto FIXO, sem IA: nutrição precisa ser previsível e barata, e o texto não
// pode inventar preço nem prazo. O que muda é o ângulo, não a promessa.
//
// Opt-in explícito: SEMENTE_ON=true. Sem isso o tick é no-op — disparo em massa
// não começa só porque um deploy subiu.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendFrio } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { carregarSupressao } from './ioSend';

export const SEMENTE_PREFIX = 'semente:';
const ULTIMO_KEY = 'semente_ultimo';

const MAX_TOQUES = 4;
const INTERVALO_TOQUES_MS = 30 * 24 * 60 * 60 * 1000;  // 30 dias entre toques
const JANELA_INICIO_H = 9;
const JANELA_FIM_H = 19;
const IDADE_MINIMA_MS = 30 * 24 * 60 * 60 * 1000;      // ficha precisa ter 30 dias
const IDADE_MAXIMA_MS = 365 * 24 * 60 * 60 * 1000;     // e no máximo 1 ano

const IG = '@irmaosnaobra__';

/** Status que contam como "não fechou". `sem_interesse` fica de fora por padrão. */
const ALVO_PADRAO = ['fez_orcamento', 'cancelado', 'fechou_concorrente', 'perdido', 'sem_orcamento'];
/** Status que significam conversa viva ou venda: nunca recebem semente. */
const NUNCA = new Set(['fechou', 'em_atendimento', 'falando_whatsapp', 'agendado', 'proposta_apresentada']);

const ligada = () => (process.env.SEMENTE_ON || '').trim().toLowerCase() === 'true';
const statusAlvo = (): string[] => {
  const cru = (process.env.SEMENTE_STATUS || '').trim();
  return cru ? cru.split(',').map(s => s.trim()).filter(Boolean) : ALVO_PADRAO;
};
const intervaloEnviosMs = (): number => {
  const n = Number((process.env.SEMENTE_INTERVALO_MIN || '').trim());
  return Number.isFinite(n) && n >= 5 ? n * 60_000 : 15 * 60_000;
};

function horaBrasilia(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit' }));
}
function foraDaJanela(): boolean {
  const h = horaBrasilia();
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
}

/** DDD + últimos 8 — mesma chave do CRM e da supressão (ignora 9º dígito e DDI). */
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}
function primeiroNome(nome: string | null | undefined): string {
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p.length >= 2 && p.length <= 20 ? p : 'tudo bem';
}

// ─── as quatro mensagens ─────────────────────────────────────────────────────
// Cada uma abre um ângulo diferente e TODAS terminam com o Instagram e a saída.
// A ordem importa: começa reconhecendo o tempo, passa pela conta de luz, mostra
// que dá pra começar sem dinheiro na mão, e se despede sem cobrar nada.

export function bolhasSemente(toque: number, nome: string | null | undefined): string[] {
  const p = primeiroNome(nome);
  const ig = `Se quiser acompanhar o que a gente instala toda semana, o Instagram é ${IG} — obra de verdade, número de verdade.`;
  const saida = 'Se preferir que eu não te procure mais, é só responder PARAR que eu paro na hora.';

  const corpo: Record<number, string[]> = {
    1: [
      `Oi ${p}! Aqui é da Irmãos na Obra — a gente conversou sobre energia solar aí atrás.`,
      'Passou mais um mês e a conta de luz continuou chegando igual. Se ainda estiver no seu radar, seguimos aqui pra resolver — sem pressa e sem pressão.',
    ],
    2: [
      `Oi ${p}, de novo da Irmãos na Obra.`,
      'A conta de luz subiu outra vez. Quem instalou o sistema no ano passado paga a mesma coisa desde então — é isso que a solar trava: o valor, não só o consumo.',
    ],
    3: [
      `Oi ${p}! Só uma coisa que muita gente não sabe:`,
      'dá pra começar sem tirar dinheiro do bolso — tem financiamento com carência, a primeira parcela cai depois que o sistema já está gerando. Se quiser, eu simulo pro seu consumo.',
    ],
    4: [
      `Oi ${p}, essa é a última vez que eu te chamo por aqui.`,
      'Não quero incomodar quem não está nesse momento. A porta fica aberta: quando fizer sentido, é só me chamar que eu retomo do ponto onde a gente parou.',
    ],
  };

  return [...(corpo[toque] ?? corpo[1]), ig, saida];
}

// ─── estado por pessoa ───────────────────────────────────────────────────────

interface EstadoSemente { n: number; ultimo: string; nome?: string | null }

async function lerEstados(): Promise<Map<string, EstadoSemente>> {
  const { data } = await supabase
    .from('system_state').select('key, value').like('key', `${SEMENTE_PREFIX}%`).limit(2000);
  const m = new Map<string, EstadoSemente>();
  for (const r of data ?? []) {
    m.set(String(r.key).slice(SEMENTE_PREFIX.length), (r.value ?? {}) as EstadoSemente);
  }
  return m;
}

export interface CandidatoSemente {
  telefone: string; chave: string; nome: string | null; status: string;
  ficha_em: string; proximo_toque: number;
}

/** Quem está elegível AGORA (ordenado por quem espera há mais tempo). */
export async function publicoSemente(): Promise<CandidatoSemente[]> {
  const agora = Date.now();
  const { data: fichas, error } = await supabaseGerador
    .from('agendamentos')
    .select('cliente_nome, cliente_telefone, status, quando, created_at, created_by')
    .gte('created_at', new Date(agora - IDADE_MAXIMA_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(3000);
  if (error) throw new Error(`semente: ler agendamentos falhou — ${error.message}`);

  // Uma pessoa = um telefone. Vale a ficha MAIS RECENTE: quem era "sem interesse"
  // e voltou a agendar não pode receber nutrição no meio da negociação.
  const maisRecente = new Map<string, any>();
  const temFuturo = new Set<string>();
  for (const f of fichas ?? []) {
    const k = telKey(f.cliente_telefone);
    if (!k) continue;
    if (!maisRecente.has(k)) maisRecente.set(k, f);
    if (f.quando && new Date(f.quando).getTime() > agora) temFuturo.add(k);
  }

  const alvo = new Set(statusAlvo());
  const estados = await lerEstados();
  const estaBloqueado = await carregarSupressao();

  const out: CandidatoSemente[] = [];
  for (const [chave, f] of maisRecente) {
    const status = String(f.status || '');
    if (!alvo.has(status) || NUNCA.has(status)) continue;
    if (temFuturo.has(chave)) continue;                       // tem conversa marcada
    // Lead de ELETROPOSTO não pode ouvir "a gente conversou sobre energia solar":
    // é outro produto e outra conversa. Esses têm o convite do grupo, não a semente.
    //
    // E lead de PROSPECÇÃO ATIVA (prosp_*) também fica de fora — dos DOIS produtos.
    // Aqui a lista é de EXCLUSÃO (entra todo mundo que não foi barrado), então cada
    // origem nova de agendamento cai na semente por padrão. A semente diz "a gente
    // conversou sobre energia solar": quem foi prospectado é EMPRESA (posto de
    // combustível, integrador) e nunca pediu contato — a frase é falsa nos dois casos.
    const cb = String(f.created_by || '');
    if (cb.includes('eletroposto') || cb.startsWith('prosp_')) continue;

    const idade = agora - new Date(f.created_at).getTime();
    if (idade < IDADE_MINIMA_MS || idade > IDADE_MAXIMA_MS) continue;

    const tel = String(f.cliente_telefone || '').replace(/\D/g, '');
    if (!tel || estaBloqueado(tel)) continue;                 // pediu pra parar

    const e = estados.get(chave);
    const n = e?.n ?? 0;
    if (n >= MAX_TOQUES) continue;
    if (e?.ultimo && agora - new Date(e.ultimo).getTime() < INTERVALO_TOQUES_MS) continue;

    out.push({
      telefone: tel, chave, nome: f.cliente_nome ?? null, status,
      ficha_em: f.created_at, proximo_toque: n + 1,
    });
  }

  // Quem está esperando há mais tempo vai primeiro.
  return out.sort((a, b) => new Date(a.ficha_em).getTime() - new Date(b.ficha_em).getTime());
}

type Resultado = { enviados: number; motivo?: string; publico?: number; previa?: string[] };

export async function runSementeTick(opts: { dry?: boolean } = {}): Promise<Resultado> {
  if (!ligada() && !opts.dry) return { enviados: 0, motivo: 'desligada (SEMENTE_ON!=true)' };

  const publico = await publicoSemente();
  if (opts.dry) {
    const primeiro = publico[0];
    return {
      enviados: 0, motivo: 'dry', publico: publico.length,
      previa: primeiro ? bolhasSemente(primeiro.proximo_toque, primeiro.nome) : [],
    };
  }
  if (!publico.length) return { enviados: 0, motivo: 'ninguem_elegivel' };
  if (foraDaJanela()) return { enviados: 0, motivo: 'fora_da_janela', publico: publico.length };

  const agora = Date.now();
  const { data: ult } = await supabase
    .from('system_state').select('value').eq('key', ULTIMO_KEY).maybeSingle();
  const ultimoMs = new Date(((ult?.value ?? {}) as { at?: string }).at ?? 0).getTime();
  if (agora - ultimoMs < intervaloEnviosMs()) return { enviados: 0, motivo: 'intervalo', publico: publico.length };

  if (!(await dentroDoTetoHorarioLinha())) return { enviados: 0, motivo: 'teto_linha', publico: publico.length };

  const alvo = publico[0];
  const nowIso = new Date().toISOString();

  // Marca ANTES de enviar: se a função morrer no meio, a pessoa perde um toque —
  // preferível a receber dois. Nutrição repetida é o que vira denúncia.
  await supabase.from('system_state').upsert(
    { key: `${SEMENTE_PREFIX}${alvo.chave}`,
      value: { n: alvo.proximo_toque, ultimo: nowIso, nome: alvo.nome } as EstadoSemente,
      updated_at: nowIso },
    { onConflict: 'key' },
  );
  await supabase.from('system_state').upsert(
    { key: ULTIMO_KEY, value: { at: nowIso, chave: alvo.chave }, updated_at: nowIso },
    { onConflict: 'key' },
  );

  try {
    await sendFrio(alvo.telefone, bolhasSemente(alvo.proximo_toque, alvo.nome), 'io');
    logger.info('semente', `toque ${alvo.proximo_toque}/${MAX_TOQUES} enviado (${alvo.status}, ficha de ${alvo.ficha_em.slice(0, 10)})`);
    return { enviados: 1, publico: publico.length - 1 };
  } catch (err) {
    logger.error('semente', `envio falhou pro toque ${alvo.proximo_toque}`, err);
    return { enviados: 0, motivo: 'erro_envio', publico: publico.length };
  }
}
