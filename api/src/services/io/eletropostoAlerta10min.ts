// ─────────────────────────────────────────────────────────────────────────────
// 10 MINUTOS ANTES DA REUNIÃO CONFIRMADA, O CONSULTOR LEVA UM SUSTO.
//
// Ordem do Thiago (03/09/2026): "preciso que chegue aviso 10 minutos antes da
// reunião agendada confirmada, cheia de emojis de alerta, só para confirmados,
// não podemos perder nada".
//
// ── Por que isto não é o ping que ele mandou desligar em 25/07 ──
// Aquele avisava "🔔 em 1 hora" antes de TODA reunião marcada, e morreu de
// barulho: a maioria das fichas nunca vira reunião de verdade, então o aviso
// virou ruído e parou de ser lido. A diferença aqui é uma palavra: SÓ
// CONFIRMADOS. O `presenca_confirmada_at` é apertado de propósito (regra dele,
// 04/08: "confirmaram quando confirmar mesmo") — é gente que escreveu SIM. Se
// este aviso tocar, tem alguém do outro lado esperando. O volume esperado é o
// número de reuniões que a pessoa realmente vai ter no dia, e nada além.
//
// ── Quem recebe ──
// O DONO da reunião, não os dois. Mandar pro Thiago o alerta da call do Diego é
// exatamente o barulho que matou a régua antiga. O telefone sai do cadastro de
// consultores do CRM (é onde se troca um número) e cai na lista fixa da equipe
// só quando o nome não resolve — alerta que não chega a ninguém é o único erro
// pior que alerta demais.
//
// ── Por que a janela é "até 13 minutos", e não "exatamente 10" ──
// O tick roda a cada ~5 min. Uma janela estreita em volta dos 10 minutos cairia
// entre dois ticks e o aviso simplesmente não sairia — que é justamente o "não
// podemos perder nada". Então a porta ABRE aos 13 minutos e só fecha na hora da
// reunião: o primeiro tick que passar por ela envia. Na prática sai entre 13 e 8
// minutos antes; se um tick falhar, o seguinte ainda pega — atrasado, mas vivo.
//
// ── Uma vez por reunião, e de novo se ela mudar de hora ──
// O carimbo `ep_alerta_10min:<id>` no system_state guarda O HORÁRIO avisado, não
// um "já mandei". Reunião remarcada tem horário novo, então ela ganha um alerta
// novo — e o repasse de 12h e o robô de remarcação mexem no `quando` o tempo
// todo. O carimbo é gravado só DEPOIS do envio dar certo: falha vira retry no
// tick seguinte, não buraco.
//
// ── O que ele NÃO faz ──
//   • Não fala com o lead. O lead já tem os quatro toques do eletropostoAgenda.
//   • Não olha feriado nem agenda fechada. Aquilo impede MARCAR; se existe uma
//     reunião confirmada, ela é avisada — ninguém quer descobrir a exceção no
//     dia em que perdeu a call.
//   • Não filtra por produto. A regra é uma só: presença confirmada. Card de
//     solar que alguém confirmou na mão também avisa o dono dele.
//
// Recado interno pra contato salvo: não passa pelo teto anti-ban da linha (mesma
// decisão do card e do eletropostoRespostas), mas tem teto por rodada.
//
// Kill-switch: EP_ALERTA_10MIN_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE } from '../../routes/ioEletroposto';
import { carregarConsultores, horaCurta, telefoneBonito } from './eletropostoAgenda';

/** Carimbo do que já foi avisado: `ep_alerta_10min:<id>` → { quando, em }. */
export const EP_ALERTA_10MIN_PREFIX = 'ep_alerta_10min:';

/** A porta abre aqui e só fecha na hora da reunião. Ver o cabeçalho. */
const ANTES_MAX_MS = 13 * 60 * 1000;
/** Teto por rodada. Dez reuniões confirmadas no mesmo intervalo de 13 min não
 *  existe — mas rajada de alerta interno é como esta régua morre pela 2ª vez. */
const POR_TICK = 10;

const desligado = (): boolean => (process.env.EP_ALERTA_10MIN_OFF || '').trim() === '1';

export type ResultadoAlerta10min = {
  enviados: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; dono: string; faltam_min: number }>;
};

const zero = (motivo?: string): ResultadoAlerta10min =>
  ({ enviados: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/** Telefone de quem recebe: cadastro do CRM primeiro, equipe fixa como rede. */
function telDoDono(nome: string, cadastro: Map<string, string>): string | null {
  const doCadastro = cadastro.get(nome);
  if (doCadastro) return String(doCadastro).replace(/\D/g, '');
  const fixo = EQUIPE[nome.trim().toLowerCase()];
  return fixo ? String(fixo).replace(/\D/g, '') : null;
}

/**
 * O alerta. Ele grita de propósito — foi o pedido, e o trabalho dele é furar a
 * tela de quem está no meio de outra conversa.
 *
 * O que ele NÃO faz é ser só enfeite: as linhas de baixo são o que a pessoa
 * precisa pra entrar na call sem abrir o CRM — quem é, que horas, o telefone
 * pra chamar, e o lembrete de que o link é ELA quem manda (o robô só avisou o
 * lead que ele vem; prometer link que ninguém mandou é o pior dos mundos).
 */
export function montarAlerta10min(
  f: { cliente_nome: string | null; cliente_telefone: string | null; quando: string },
  faltamMin: number,
): string {
  const cliente = (f.cliente_nome || '').trim() || 'o lead';
  const tel = telefoneBonito(f.cliente_telefone);
  return [
    `🚨🚨🚨 *REUNIÃO CONFIRMADA EM ${faltamMin} MINUTOS* 🚨🚨🚨`,
    '',
    `⏰ *${horaCurta(f.quando)}* — ${cliente} CONFIRMOU presença. Ele vai estar lá.`,
    tel ? `📱 ${tel}` : '',
    '',
    '⚠️ *VOCÊ é quem manda o link.* O robô avisou o lead que ele vem — não mandou.',
    '🔥 Não perde essa.',
  ].filter(Boolean).join('\n');
}

/**
 * Roda a cada ~5 min dentro do /cron/process-messages.
 * `dry` decide igual, sem enviar e sem carimbar.
 */
export async function runEletropostoAlerta10minTick(
  opts: { dry?: boolean; agora?: number } = {},
): Promise<ResultadoAlerta10min> {
  if (desligado()) return zero('desligado');

  const agora = opts.agora ?? Date.now();

  // Só o que está entre AGORA e a porta dos 13 min, confirmado e de pé.
  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, status, presenca_confirmada_at')
    .eq('status', 'agendado')
    .not('presenca_confirmada_at', 'is', null)
    .gte('quando', new Date(agora).toISOString())
    .lte('quando', new Date(agora + ANTES_MAX_MS).toISOString())
    .limit(100);
  if (error) {
    logger.error('ep-alerta-10min', 'ler agendamentos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  const fichas = ((data ?? []) as Array<Record<string, any>>)
    .filter(f => f.quando && f.vendedor_nome)
    .sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime())
    .slice(0, POR_TICK);
  if (!fichas.length) return zero('nenhuma_confirmada_na_janela');

  // Quem já foi avisado PARA ESTE HORÁRIO. Horário diferente = reunião
  // remarcada = alerta novo.
  const { data: carimbos } = await supabase
    .from('system_state').select('key, value')
    .in('key', fichas.map(f => `${EP_ALERTA_10MIN_PREFIX}${f.id}`));
  const avisadoPara = new Map<number, string>();
  for (const c of carimbos ?? []) {
    const id = Number(String(c.key).slice(EP_ALERTA_10MIN_PREFIX.length));
    const quando = ((c.value ?? {}) as { quando?: string }).quando;
    if (Number.isInteger(id) && quando) avisadoPara.set(id, String(quando));
  }

  const pendentes = fichas.filter(f => avisadoPara.get(f.id) !== String(f.quando));
  if (!pendentes.length) return zero('todas_ja_avisadas');

  const faltamMinDe = (f: Record<string, any>): number =>
    Math.max(0, Math.round((new Date(f.quando).getTime() - agora) / 60000));

  if (opts.dry) {
    return {
      ...zero('dry'),
      previa: pendentes.map(f => ({
        id: Number(f.id),
        cliente: String(f.cliente_nome || ''),
        dono: String(f.vendedor_nome),
        faltam_min: faltamMinDe(f),
      })),
    };
  }

  const telPorConsultor = await carregarConsultores();
  let enviados = 0;
  let erros = 0;

  for (const f of pendentes) {
    const dono = String(f.vendedor_nome);
    const texto = montarAlerta10min(f as never, faltamMinDe(f));

    // O dono primeiro. Sem telefone dele, cai pra equipe inteira: este é o aviso
    // que não pode sumir, então "não sei pra quem" vira "manda pra todos".
    const tel = telDoDono(dono, telPorConsultor);
    const destinos = tel ? [tel] : Object.values(EQUIPE);
    if (!tel) {
      logger.error('ep-alerta-10min', 'consultor sem telefone — alerta foi pra equipe toda', { id: f.id, dono });
    }

    const envios = await Promise.allSettled(destinos.map(n => sendWhatsApp(n, texto, 'io')));
    if (!envios.some(e => e.status === 'fulfilled')) {
      erros++;
      logger.error('ep-alerta-10min', 'nenhum envio deu certo — sem carimbo, tenta no próximo tick', { id: f.id, dono });
      continue;   // sem carimbo: o tick seguinte tenta de novo
    }

    const nowIso = new Date().toISOString();
    await supabase.from('system_state').upsert(
      { key: `${EP_ALERTA_10MIN_PREFIX}${f.id}`, value: { quando: String(f.quando), em: nowIso }, updated_at: nowIso },
      { onConflict: 'key' },
    ).then(undefined, (e: unknown) =>
      logger.error('ep-alerta-10min', 'carimbo falhou — risco de alerta repetido', { id: f.id, erro: String(e) }));
    enviados++;
  }

  return { enviados, erros };
}
