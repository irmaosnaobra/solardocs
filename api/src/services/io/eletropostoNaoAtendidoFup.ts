// ─────────────────────────────────────────────────────────────────────────────
// O CONSULTOR ESPEROU E A PESSOA NÃO VEIO — às 19h, o robô chama de volta.
//
// Ordem do dono, 22/09/2026: *"quando eu colocar não atendido, quero que a
// pessoa receba um followup mostrando a oportunidade que ela está deixando com
// eletroposto, manda que o consultor enviou msg e não foi atendido, mostra que
// estamos pronto para reagendar e dá opções da agenda e ela escolhe um número e
// remarca automático, faz isso todos os dias as 19hrs em diante."*
//
// O buraco: no-show marcado pelo consultor era ponto final. A ficha ficava
// vermelha no CRM e ninguém mais falava com aquela pessoa, sendo que ela é o
// contrário de um lead frio: ela escolheu o horário, recebeu quatro toques,
// esqueceu ou não pôde, e continua com o mesmo ponto e o mesmo interesse.
//
// ── SÓ O NÃO ATENDIDO DE GENTE ──
// A ficha marcada pelo ROBÔ (carimbo `ep_nao_atendeu_auto:<id>`) fica de fora, e
// não é detalhe: o corte das 13h marca vermelho HORAS ANTES da reunião, pra
// devolver o horário a tempo de vender. Mandar "o consultor te chamou e não
// conseguiu falar com você" pra essa pessoa é mentira escrita — ninguém chamou,
// o horário dela nem chegou a acontecer. Quem cuida dela é a régua do SIM
// (eletropostoCobraSim) e o reagendamento automático do quente.
//
// ── 19H, E O PORQUÊ ──
// É a hora em que o dia acabou e o consultor já marcou os cards. Antes disso a
// lista estaria pela metade, e o mesmo lead receberia o toque enquanto o
// consultor ainda tenta falar com ele. A janela vai até as 21h (o limite da
// linha), e a fila é lenta: 2 por rodada, com o teto anti-ban antes de cada
// envio.
//
// ── A CONVERSA NÃO É NOVA ──
// A oferta sai pelo `ofertarPorConta`, o mesmo do robô de remarcação, e grava a
// lista no mesmo estado (`ep_remarcar:<id>`). Então quando a pessoa responde
// "2", quem lê é o `passoDeRemarcacao` de sempre: ele casa a escolha, move o
// `quando`, devolve o horário velho pra agenda e avisa a equipe. Nenhum código
// novo pra isso, e é de propósito: fluxo de remarcação duplicado seria dois
// robôs oferecendo horários diferentes pra mesma pessoa.
//
// Kill-switch: EP_FUP_NAOATENDIDO_OFF=1. Prévia:
// GET /cron/eletroposto-nao-atendido?dry=1
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ofertarPorConta, bolhasNaoAtendido } from './eletropostoRemarcar';
import { EP_NAO_ATENDEU_PREFIX, EP_RESPOSTA_PREFIX } from './eletropostoAgenda';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';

/** Carimbo de follow-up enviado: `ep_fup_naoatendido:<id>`. Um por ficha, pra
 *  sempre: quem não escolheu horário depois disso quer falar com gente. */
export const EP_FUP_NAOATENDIDO_PREFIX = 'ep_fup_naoatendido:';

const BRT_TZ = 'America/Sao_Paulo';

const HORA_INICIO = Number(process.env.EP_FUP_NAOATENDIDO_HORA || 19);
const HORA_FIM = 21;
/** Reunião de até 2 dias atrás. O consultor às vezes marca o card no dia
 *  seguinte, e sem essa folga essas fichas nunca seriam chamadas de volta. Mais
 *  que isso é história velha, e aí o texto "o consultor te chamou hoje" mente. */
const JANELA_DIAS = Number(process.env.EP_FUP_NAOATENDIDO_DIAS || 2);
const POR_TICK = Number(process.env.EP_FUP_NAOATENDIDO_POR_TICK || 2);

const desligado = () => (process.env.EP_FUP_NAOATENDIDO_OFF || '').trim() === '1';

function horaBrasilia(now = new Date()): number {
  return Number(now.toLocaleString('en-US', { timeZone: BRT_TZ, hour12: false, hour: '2-digit' }));
}

interface Ficha {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  vendedor_nome: string | null;
  quando: string | null;
  created_by: string | null;
  status: string | null;
  lead_resposta_at: string | null;
}

export type ResultadoFupNaoAtendido = {
  ofertas: number;
  /** Fichas que o ROBÔ marcou de ausente e por isso ficam de fora. */
  marcadas_pelo_robo: number;
  sem_vaga: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; quando: string }>;
};

const zero = (motivo?: string): ResultadoFupNaoAtendido =>
  ({ ofertas: 0, marcadas_pelo_robo: 0, sem_vaga: 0, erros: 0, ...(motivo ? { motivo } : {}) });

export async function runEletropostoNaoAtendidoFupTick(
  opts: { dry?: boolean } = {},
): Promise<ResultadoFupNaoAtendido> {
  if (desligado()) return zero('desligado');
  const hora = horaBrasilia();
  // `dry` roda a qualquer hora: é prévia, não envia nada, e é assim que se
  // confere a lista do dia sem esperar as 19h.
  if (!opts.dry && (hora < HORA_INICIO || hora >= HORA_FIM)) return zero('fora_da_janela');

  const agora = Date.now();
  const dry = opts.dry === true;

  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, vendedor_nome, quando, created_by, status, lead_resposta_at')
    .eq('status', 'nao_atendeu')
    .gte('quando', new Date(agora - JANELA_DIAS * 24 * 3600_000).toISOString())
    .lte('quando', new Date(agora).toISOString())
    .order('quando', { ascending: false })
    .limit(200);
  if (error) {
    logger.error('ep-fup-naoatendido', 'ler agendamentos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  const fichas = ((data ?? []) as unknown as Ficha[])
    .filter(f => ehOrigemEletroposto(f.created_by))
    .filter(f => !!f.cliente_telefone && !!f.vendedor_nome && !!f.quando);
  if (!fichas.length) return zero('ninguem_nao_atendido');

  const [doRobo, jaFeito, falaram] = await Promise.all([
    supabase.from('system_state').select('key').like('key', `${EP_NAO_ATENDEU_PREFIX}%`).limit(1000),
    supabase.from('system_state').select('key').like('key', `${EP_FUP_NAOATENDIDO_PREFIX}%`).limit(1000),
    supabase.from('system_state').select('key, updated_at').like('key', `${EP_RESPOSTA_PREFIX}%`).limit(1000),
  ]);
  const marcadaPeloRobo = new Set((doRobo.data ?? [])
    .map(m => Number(String(m.key).slice(EP_NAO_ATENDEU_PREFIX.length))));
  const jaChamado = new Set((jaFeito.data ?? [])
    .map(m => Number(String(m.key).slice(EP_FUP_NAOATENDIDO_PREFIX.length))));
  const respondeuEm = new Map<number, string>((falaram.data ?? []).map(m =>
    [Number(String(m.key).slice(EP_RESPOSTA_PREFIX.length)), String(m.updated_at ?? '')]));

  let ofertas = 0, semVaga = 0, erros = 0, doRoboN = 0;
  const previa: NonNullable<ResultadoFupNaoAtendido['previa']> = [];

  for (const f of fichas) {
    if (ofertas + semVaga >= POR_TICK) break;
    if (jaChamado.has(f.id)) continue;
    if (marcadaPeloRobo.has(f.id)) { doRoboN++; continue; }
    // Escreveu DEPOIS da hora da reunião: já tem conversa em pé, e quem responde
    // é gente (o eletropostoRespostas levou o recado pra equipe).
    const falouDepois = (f.lead_resposta_at && f.lead_resposta_at > String(f.quando))
      || ((respondeuEm.get(f.id) ?? '') > String(f.quando));
    if (falouDepois) continue;

    if (dry) {
      previa.push({ id: f.id, cliente: String(f.cliente_nome || '—'), quando: String(f.quando) });
      ofertas++;
      continue;
    }

    // Reserva antes de falar: o cron do GitHub e o da Vercel chamam o mesmo tick.
    const nowIso = new Date().toISOString();
    const chave = `${EP_FUP_NAOATENDIDO_PREFIX}${f.id}`;
    const { error: eClaim } = await supabase.from('system_state')
      .insert({ key: chave, value: { claim: nowIso }, updated_at: nowIso });
    if (eClaim) continue;

    try {
      const r = await ofertarPorConta(
        { id: f.id, cliente_nome: f.cliente_nome, cliente_telefone: f.cliente_telefone,
          vendedor_nome: f.vendedor_nome, quando: f.quando },
        bolhasNaoAtendido,
        // Frio no teto da linha: reengajar quem não apareceu não pode comer a
        // reserva de quem acabou de marcar. `silencioSemVaga` porque "não tenho
        // horário" pra quem não apareceu é um contato a mais sem oferta nenhuma.
        { rodada: 1, silencioSemVaga: true, transacional: false },
      );
      if (r.acao === 'ofertou') {
        await supabase.from('system_state').upsert(
          { key: chave, value: { em: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
        ofertas++;
        logger.info('ep-fup-naoatendido', 'chamado de volta com horário na mesa', { id: f.id });
      } else {
        // Não saiu: a reserva tem que sumir, senão a ficha conta como chamada sem
        // ninguém ter recebido nada. Tenta de novo no próximo tick.
        await supabase.from('system_state').delete().eq('key', chave).then(undefined, () => {});
        if (r.acao === 'sem_vaga') semVaga++;
      }
    } catch (e) {
      await supabase.from('system_state').delete().eq('key', chave).then(undefined, () => {});
      logger.error('ep-fup-naoatendido', 'falha ao chamar de volta', { id: f.id, erro: String(e) });
      erros++;
    }
  }

  if (!dry && (ofertas || semVaga || erros)) {
    logger.info('ep-fup-naoatendido', 'follow-up do não atendido', { ofertas, sem_vaga: semVaga, erros });
  }
  return {
    ofertas, marcadas_pelo_robo: doRoboN, sem_vaga: semVaga, erros,
    ...(dry ? { motivo: 'dry', previa } : {}),
  };
}
