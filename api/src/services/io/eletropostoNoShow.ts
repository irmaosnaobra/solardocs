// ─────────────────────────────────────────────────────────────────────────────
// O CARD FICOU VERMELHO — e o robô vai atrás dele algumas vezes.
//
// Ordem do Thiago (19/08/2026): "quando ficar vermelho, sempre o sistema tentar
// remarcar algumas vezes com ele, e tentar uma agenda nova".
//
// Até aqui o vermelho era um ponto final: a ficha virava `nao_atendeu` (pelo
// corte das 13h ou pelo lembrete de 1h), o horário voltava pra vitrine e a pessoa
// ficava lá, parada, esperando alguém lembrar dela. Ninguém lembrava — quem
// chegava depois era sempre mais barato de atender que quem sumiu.
//
// Aqui a ficha vermelha vira fila de trabalho: TRÊS convites pra remarcar, cada
// um com os próximos horários livres do MESMO consultor, espaçados em dias. A
// pessoa responde o número e a máquina que já existe (`passoDeRemarcacao`) move a
// reunião — este módulo não grava horário nenhum, ele só põe a lista na mesa.
//
// ── O ritmo, e por que é lento ──
//   1ª tentativa: 45 min depois do horário perdido — perto o bastante pra ela
//      ligar uma coisa à outra ("eu tinha reunião hoje"), longe o bastante pra
//      não cruzar com o toque de 5 min que ainda estava saindo.
//   2ª tentativa: no dia seguinte (20h de intervalo).
//   3ª tentativa: dois dias depois — e a copy DIZ que é a última.
//   Depois disso o robô cala. Três convites sem resposta é resposta.
//
// UMA pessoa por tick, das 9h às 19h, atrás do teto anti-ban da linha e como
// contato NÃO transacional (ninguém escreveu pra gente — quem puxa é o robô).
// A linha IO já foi bloqueada duas vezes por rajada; esta fila não tem pressa.
//
// ── Quem NÃO entra ──
//   · reunião anterior ao piso duro (`NOSHOW_INICIO`). Sem ele, ligar o módulo
//     mandaria oferta pra todo vermelho já existente no banco de uma vez — o
//     erro que já custou caro no solar (87 fichas antigas de uma vez);
//   · quem escreveu depois do horário perdido (`lead_resposta_at`): essa conversa
//     tem dono, e ela já passa pelo `eletropostoRespostas`;
//   · quem já tem oferta na mesa (`ep_remarcar:<id>` vivo) — inclusive a que o
//     próprio fluxo reativo pôs lá. Duas listas de horários abertas ao mesmo
//     tempo fazem o "2" da pessoa apontar pra reunião errada;
//   · ficha sem consultor ou sem telefone.
//
// ── O que ele deixa escrito ──
// Cada tentativa vira linha no `historico` da ficha. O consultor abre o card e vê
// que o robô já chamou a pessoa duas vezes — sem isso, "vermelho parado" e
// "vermelho sendo trabalhado" são a mesma tela.
//
// Kill-switch: EP_NOSHOW_OFF=1. (O EP_REMARCAR_OFF também desliga, porque toda a
// oferta passa por lá.)
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import {
  ofertarPorConta, bolhasRepescagemNoShow, EP_REMARCAR_PREFIX, type Ficha as FichaRemarcar,
} from './eletropostoRemarcar';
import { quandoPorExtenso } from './eletropostoAgenda';

const BRT_TZ = 'America/Sao_Paulo';

/** Estado da repescagem: `ep_noshow:<id>` → { n, ultimo }. */
export const EP_NOSHOW_PREFIX = 'ep_noshow:';

/** Piso duro: reunião perdida ANTES disto não é repescada nunca. É o dia em que a
 *  régua entrou no ar — o estoque velho de vermelhos não vira disparo. */
const NOSHOW_INICIO = '2026-08-19T00:00:00.000Z';

const MAX_TENTATIVAS = 3;
/** Distância mínima do horário perdido pra 1ª tentativa. O toque de 5 min sai até
 *  12 min depois da hora marcada; 45 min garante que a conversa não se atropela. */
const APOS_PERDER_MIN = 45;
/** Intervalos entre as tentativas: 1ª → 2ª no dia seguinte, 2ª → 3ª dois dias. */
const ESPERA_POR_TENTATIVA_MS = [0, 20 * 3600_000, 48 * 3600_000];
/** Reunião perdida há mais de 7 dias vira lista fria — assunto de outro robô. */
const JANELA_DIAS = 7;
/** Uma pessoa por tick. Com o tick de 5 min isso ainda é 12/h de teto teórico —
 *  quem segura de verdade é o teto anti-ban da linha, checado antes de cada envio. */
const POR_TICK = 1;
const JANELA_INICIO_H = 9;
const JANELA_FIM_H = 19;

const desligado = () => (process.env.EP_NOSHOW_OFF || '').trim() === '1';

function horaBrasilia(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: BRT_TZ, hour12: false, hour: '2-digit' }));
}

type Estado = { n: number; ultimo: string };

export type ResultadoNoShow = {
  ofertados: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; tentativa: number; perdida: string }>;
};

const zero = (motivo?: string): ResultadoNoShow => ({ ofertados: 0, erros: 0, ...(motivo ? { motivo } : {}) });

interface FichaNoShow extends FichaRemarcar {
  created_by: string | null;
  status: string | null;
  lead_resposta_at: string | null;
  historico: string | null;
}

/** Linha no card: o consultor precisa ver que o robô está trabalhando o vermelho. */
async function anotar(f: FichaNoShow, tentativa: number, ofertas: number): Promise<void> {
  const carimbo = new Date().toLocaleString('pt-BR', {
    timeZone: BRT_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·');
  const linha = `[${carimbo} · Sistema] 🔁 Repescagem ${tentativa}/${MAX_TENTATIVAS}: ofereci ${ofertas} horário(s) `
    + 'novo(s) no WhatsApp pra quem não apareceu. Se ele escolher, a reunião muda sozinha.';
  await supabaseGerador.from('agendamentos')
    .update({ historico: f.historico ? `${linha}\n\n${f.historico}` : linha })
    .eq('id', f.id)
    .then(undefined, (e: unknown) => logger.error('ep-noshow', 'anotar no histórico falhou', { id: f.id, erro: String(e) }));
}

/**
 * Um passo da fila. Roda a cada ~5 min dentro do /cron/process-messages.
 * `dry` decide igual e não envia nem grava.
 */
export async function runEletropostoNoShowTick(opts: { dry?: boolean } = {}): Promise<ResultadoNoShow> {
  if (desligado()) return zero('desligado');
  const h = horaBrasilia();
  if (h < JANELA_INICIO_H || h >= JANELA_FIM_H) return zero('fora_da_janela');

  const agora = Date.now();
  const de = new Date(Math.max(agora - JANELA_DIAS * 86400_000, new Date(NOSHOW_INICIO).getTime())).toISOString();
  const ate = new Date(agora - APOS_PERDER_MIN * 60_000).toISOString();
  if (de >= ate) return zero('piso_ainda_no_futuro');

  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, quando, vendedor_nome, created_by, status, lead_resposta_at, historico')
    .eq('status', 'nao_atendeu')
    .gte('quando', de)
    .lte('quando', ate)
    .order('quando', { ascending: false })
    .limit(200);
  if (error) {
    logger.error('ep-noshow', 'ler vermelhos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  // Produto por família (a mesma regra dos outros agentes de EP) + o básico pra
  // conseguir falar: telefone e consultor.
  const candidatos = ((data ?? []) as FichaNoShow[]).filter(f =>
    ehOrigemEletroposto(f.created_by)
    && !!f.cliente_telefone
    && !!f.vendedor_nome
    && !!f.quando
    // Escreveu DEPOIS de perder o horário? Então não sumiu — está conversando, e
    // essa conversa é do agente de respostas, que já sabe remarcar.
    && !(f.lead_resposta_at && f.lead_resposta_at > f.quando));
  if (!candidatos.length) return zero('nenhum_vermelho');

  // Estado da fila + ofertas em aberto, numa leitura só de cada.
  const ids = candidatos.map(f => f.id);
  const [{ data: estados }, { data: ofertasVivas }] = await Promise.all([
    supabase.from('system_state').select('key, value')
      .in('key', ids.map(id => `${EP_NOSHOW_PREFIX}${id}`)),
    supabase.from('system_state').select('key, updated_at')
      .in('key', ids.map(id => `${EP_REMARCAR_PREFIX}${id}`)),
  ]);
  const estadoDe = new Map<number, Estado>();
  for (const r of estados ?? []) {
    const id = Number(String(r.key).slice(EP_NOSHOW_PREFIX.length));
    const v = (r.value ?? {}) as Partial<Estado>;
    if (Number.isInteger(id) && typeof v.n === 'number' && v.ultimo) estadoDe.set(id, { n: v.n, ultimo: v.ultimo });
  }
  // Oferta na mesa é qualquer `ep_remarcar:<id>` das últimas 24h — o mesmo prazo
  // que o fluxo reativo usa pra aceitar uma escolha. Duas listas abertas fariam o
  // "2" da pessoa apontar pra reunião errada.
  const comOferta = new Set(
    (ofertasVivas ?? [])
      .filter(r => r.updated_at && agora - new Date(String(r.updated_at)).getTime() < 24 * 3600_000)
      .map(r => Number(String(r.key).slice(EP_REMARCAR_PREFIX.length))));

  const naVez = candidatos.filter(f => {
    if (comOferta.has(f.id)) return false;
    const e = estadoDe.get(f.id);
    const n = e?.n ?? 0;
    if (n >= MAX_TENTATIVAS) return false;
    const espera = ESPERA_POR_TENTATIVA_MS[n] ?? 0;
    const desde = e ? new Date(e.ultimo).getTime() : new Date(String(f.quando)).getTime();
    return agora - desde >= espera;
  });
  if (!naVez.length) return zero('ninguem_na_vez');

  // Do mais recente pro mais antigo: quem perdeu a reunião hoje ainda lembra dela.
  const alvos = naVez.slice(0, POR_TICK);
  const previa: NonNullable<ResultadoNoShow['previa']> = [];
  let ofertados = 0, erros = 0;

  for (const f of alvos) {
    const tentativa = (estadoDe.get(f.id)?.n ?? 0) + 1;
    if (opts.dry) {
      previa.push({
        id: f.id, cliente: String(f.cliente_nome || '—'), tentativa,
        perdida: quandoPorExtenso(String(f.quando)),
      });
      ofertados++;
      continue;
    }
    try {
      const r = await ofertarPorConta(
        f,
        (nome, ofertas, quem) => bolhasRepescagemNoShow(nome, ofertas, quem, String(f.quando), tentativa),
        { rodada: 1, silencioSemVaga: true },
      );
      // Só conta tentativa o que FOI PRA RUA. Teto da linha estourado, agenda sem
      // vaga ou leitura falha devolvem "nada"/"sem_vaga" — e nesses casos a pessoa
      // não recebeu nada, então gastar uma das três seria perder um convite.
      if (r.acao !== 'ofertou') continue;
      const nowIso = new Date().toISOString();
      await supabase.from('system_state').upsert(
        { key: `${EP_NOSHOW_PREFIX}${f.id}`, value: { n: tentativa, ultimo: nowIso }, updated_at: nowIso },
        { onConflict: 'key' },
      );
      await anotar(f, tentativa, r.ofertas.length);
      ofertados++;
      logger.info('ep-noshow', `repescagem ${tentativa}/${MAX_TENTATIVAS} da ficha #${f.id}`, { ofertas: r.ofertas.length });
    } catch (e) {
      logger.error('ep-noshow', 'repescagem falhou', { id: f.id, erro: String(e) });
      erros++;
    }
  }

  return { ofertados, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}
