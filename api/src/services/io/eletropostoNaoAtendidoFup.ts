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
// ── A ESCADA (ordem do dono, 22/09/2026) ──
// *"Ele passa por um follow up bem agressivo no início. Depois ele cai na nossa
// lista. Ele é um cliente que confirmou, mas no momento que fez a ligação para
// ele, ele não atendeu. Se ele chegou na agenda, ele é importante, então temos
// que inventar de tudo. E se ele não continuar, não reagendar, não aceitar, ele
// cai para curioso."*
//
//   19h do dia      · 1º toque: o que aconteceu, o que ele deixa na mesa, 3 horários
//   +20h (manhã)    · 2º toque: a insistência explicada, 3 horários novos
//   +68h (D+3)      · 3º e último, e a mensagem diz que é o último
//   +24h do 3º      · sem reagendar, a ficha vai pra aba de Cadastros (Curioso)
//
// A ficha da lista NÃO nasce no primeiro toque: ela é o fim da linha, e criá-la
// antes sujaria a lista com gente que está voltando pra agenda. É o que o dono
// disse com todas as letras: "se ele não continuar, não reagendar, não aceitar,
// ele cai para curioso".
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
import {
  ofertarPorConta, bolhasNaoAtendido, bolhasNaoAtendido2, bolhasNaoAtendido3,
} from './eletropostoRemarcar';
import { EP_NAO_ATENDEU_PREFIX, EP_RESPOSTA_PREFIX } from './eletropostoAgenda';
import { criarFichaCurioso, type FichaDaAgenda } from './eletropostoCobraSim';
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
/** Horas depois do 1º toque para o 2º e o 3º, e para a queda na lista. As duas
 *  primeiras caem de manhã (o 1º sai entre 19h e 21h), que é quando a linha está
 *  vazia e a pessoa está resolvendo o dia. */
const R2_APOS_H = Number(process.env.EP_FUP_NAOATENDIDO_R2_H || 20);
const R3_APOS_H = Number(process.env.EP_FUP_NAOATENDIDO_R3_H || 68);
const LISTA_APOS_H = Number(process.env.EP_FUP_NAOATENDIDO_LISTA_H || 92);
/** Do 2º toque em diante a janela é diurna: o 1º é que tem hora marcada. */
const DIA_INICIO_H = 9;
const DIA_FIM_H = 19;

const desligado = () => (process.env.EP_FUP_NAOATENDIDO_OFF || '').trim() === '1';

function horaBrasilia(now = new Date()): number {
  return Number(now.toLocaleString('en-US', { timeZone: BRT_TZ, hour12: false, hour: '2-digit' }));
}

/** Os mesmos campos que a régua do SIM usa pra montar a ficha da lista: quem não
 *  compareceu vira entrada no Curioso pelo MESMO caminho, com a mesma regra de
 *  destino. Uma implementação só de "vira ficha", em `eletropostoCobraSim`. */
type Ficha = FichaDaAgenda & { lead_resposta_at: string | null };

export type PassoNaoAtendido = 'r1' | 'r2' | 'r3' | 'lista' | null;

/**
 * Qual passo vale AGORA, em função pura.
 *
 * O relógio é o 1º TOQUE, não a hora da reunião: o consultor marca o card quando
 * pode (às vezes no dia seguinte), e contar da reunião faria a escada inteira
 * sair atrasada e amontoada.
 */
export function passoDoNaoAtendido(e: {
  horasDesdeR1: number | null;
  r2Enviado: boolean;
  r3Enviado: boolean;
  naListaJa: boolean;
}): PassoNaoAtendido {
  if (e.horasDesdeR1 === null) return 'r1';
  if (e.naListaJa) return null;
  if (e.r3Enviado) return e.horasDesdeR1 >= LISTA_APOS_H ? 'lista' : null;
  if (e.r2Enviado) return e.horasDesdeR1 >= R3_APOS_H ? 'r3' : null;
  return e.horasDesdeR1 >= R2_APOS_H ? 'r2' : null;
}

export type ResultadoFupNaoAtendido = {
  ofertas: number;
  /** Fichas que caíram na aba de Cadastros por não terem voltado. */
  viraram_lista: number;
  /** Fichas que o ROBÔ marcou de ausente e por isso ficam de fora. */
  marcadas_pelo_robo: number;
  sem_vaga: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; quando: string; passo: PassoNaoAtendido }>;
};

const zero = (motivo?: string): ResultadoFupNaoAtendido =>
  ({ ofertas: 0, viraram_lista: 0, marcadas_pelo_robo: 0, sem_vaga: 0, erros: 0, ...(motivo ? { motivo } : {}) });

export async function runEletropostoNaoAtendidoFupTick(
  opts: { dry?: boolean } = {},
): Promise<ResultadoFupNaoAtendido> {
  if (desligado()) return zero('desligado');
  const hora = horaBrasilia();
  // Duas janelas: o 1º toque é das 19h às 21h (o dia acabou e os cards estão
  // marcados) e os toques 2 e 3 são diurnos, porque caem no dia seguinte e em
  // D+3. Fora das duas, só a queda na lista continua valendo: ela não manda
  // mensagem nenhuma, e segurar uma ficha fora da janela seria adiar por nada.
  const naJanelaDoPrimeiro = hora >= HORA_INICIO && hora < HORA_FIM;
  const naJanelaDiurna = hora >= DIA_INICIO_H && hora < DIA_FIM_H;
  if (!opts.dry && !naJanelaDoPrimeiro && !naJanelaDiurna) return zero('fora_da_janela');

  const agora = Date.now();
  const dry = opts.dry === true;

  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, vendedor_nome, quando, created_by, status, lead_resposta_at, '
      + 'historico, lembrete_1h_at, cidade, observacao, ponto_relacao, capital_faixa, tem_ponto, perfil_slug, '
      + 'decisor_tipo, rota_tipo, utm_source, utm_medium, utm_campaign, utm_content, utm_term')
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
    supabase.from('system_state').select('key, updated_at').like('key', `${EP_FUP_NAOATENDIDO_PREFIX}%`).limit(2000),
    supabase.from('system_state').select('key, updated_at').like('key', `${EP_RESPOSTA_PREFIX}%`).limit(1000),
  ]);
  const marcadaPeloRobo = new Set((doRobo.data ?? [])
    .map(m => Number(String(m.key).slice(EP_NAO_ATENDEU_PREFIX.length))));
  // `ep_fup_naoatendido:<id>:<passo>`: uma chave por degrau, porque a reserva
  // antes do envio é um `insert` numa primary key. Uma chave só com valor
  // crescendo não seria atômica entre dois ticks simultâneos.
  const feitos = new Set((jaFeito.data ?? [])
    .map(m => String(m.key).slice(EP_FUP_NAOATENDIDO_PREFIX.length)));
  const quandoR1 = new Map<number, string>();
  for (const m of jaFeito.data ?? []) {
    const resto = String(m.key).slice(EP_FUP_NAOATENDIDO_PREFIX.length);
    const [id, passo] = resto.split(':');
    if (passo === 'r1') quandoR1.set(Number(id), String(m.updated_at ?? ''));
  }
  const respondeuEm = new Map<number, string>((falaram.data ?? []).map(m =>
    [Number(String(m.key).slice(EP_RESPOSTA_PREFIX.length)), String(m.updated_at ?? '')]));

  let ofertas = 0, viraramLista = 0, semVaga = 0, erros = 0, doRoboN = 0;
  const previa: NonNullable<ResultadoFupNaoAtendido['previa']> = [];

  const COPY = { r1: bolhasNaoAtendido, r2: bolhasNaoAtendido2, r3: bolhasNaoAtendido3 };

  for (const f of fichas) {
    if (ofertas + semVaga >= POR_TICK) break;
    if (marcadaPeloRobo.has(f.id)) { doRoboN++; continue; }
    // Escreveu DEPOIS da hora da reunião: já tem conversa em pé, e quem responde
    // é gente (o eletropostoRespostas levou o recado pra equipe).
    const falouDepois = (f.lead_resposta_at && f.lead_resposta_at > String(f.quando))
      || ((respondeuEm.get(f.id) ?? '') > String(f.quando));
    if (falouDepois) continue;

    const emR1 = quandoR1.get(f.id);
    const passo = passoDoNaoAtendido({
      horasDesdeR1: emR1 ? (agora - Date.parse(emR1)) / 3600_000 : null,
      r2Enviado: feitos.has(`${f.id}:r2`),
      r3Enviado: feitos.has(`${f.id}:r3`),
      naListaJa: feitos.has(`${f.id}:lista`),
    });
    if (passo === null) continue;
    // O 1º toque tem hora marcada (19h); os outros são diurnos. Queda na lista
    // não manda mensagem, então roda em qualquer uma das duas janelas.
    if (!dry && passo === 'r1' && !naJanelaDoPrimeiro) continue;
    if (!dry && (passo === 'r2' || passo === 'r3') && !naJanelaDiurna) continue;

    if (dry) {
      previa.push({ id: f.id, cliente: String(f.cliente_nome || '—'), quando: String(f.quando), passo });
      if (passo === 'lista') viraramLista++; else ofertas++;
      continue;
    }

    // Reserva antes de agir: o cron do GitHub e o da Vercel chamam o mesmo tick.
    const nowIso = new Date().toISOString();
    const chave = `${EP_FUP_NAOATENDIDO_PREFIX}${f.id}:${passo}`;
    const { error: eClaim } = await supabase.from('system_state')
      .insert({ key: chave, value: { claim: nowIso }, updated_at: nowIso });
    if (eClaim) continue;

    // ── FIM DA LINHA: a ficha vira lista ──────────────────────────────────
    // "Se ele não continuar, não reagendar, não aceitar, ele cai para curioso"
    // (o dono, 22/09/2026). Só AQUI, depois dos três toques: criar a ficha no
    // primeiro toque sujaria a lista com gente que está voltando pra agenda.
    // Medido no mesmo dia: dos 30 não atendidos dos últimos 30 dias, TRINTA não
    // estavam em lista nenhuma — existiam só como card vermelho, e passada a
    // recuperação ninguém mais tinha por onde pegá-los.
    if (passo === 'lista') {
      const r = await criarFichaCurioso(f, false, 'confirmou, não atendeu a ligação e não voltou depois de 3 chamados');
      if (r === 'erro') {
        await supabase.from('system_state').delete().eq('key', chave).then(undefined, () => {});
        erros++;
      } else {
        viraramLista++;
        logger.info('ep-fup-naoatendido', 'não voltou: virou ficha na lista', { id: f.id, resultado: r });
      }
      continue;
    }

    try {
      const r = await ofertarPorConta(
        { id: f.id, cliente_nome: f.cliente_nome, cliente_telefone: f.cliente_telefone,
          vendedor_nome: f.vendedor_nome, quando: f.quando },
        COPY[passo],
        // Frio no teto da linha: reengajar quem não apareceu não pode comer a
        // reserva de quem acabou de marcar. `silencioSemVaga` porque "não tenho
        // horário" pra quem não apareceu é um contato a mais sem oferta nenhuma.
        // A rodada da oferta acompanha o degrau, então o robô de remarcação
        // continua parando depois de 2 listas sem escolha.
        { rodada: passo === 'r1' ? 1 : 2, silencioSemVaga: true, transacional: false },
      );
      if (r.acao === 'ofertou') {
        await supabase.from('system_state').upsert(
          { key: chave, value: { em: new Date().toISOString(), passo }, updated_at: new Date().toISOString() },
          { onConflict: 'key' },
        );
        ofertas++;
        logger.info('ep-fup-naoatendido', `chamado de volta (${passo}) com horário na mesa`, { id: f.id });
      } else {
        // Não saiu: a reserva tem que sumir, senão o degrau conta como dado sem
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

  if (!dry && (ofertas || viraramLista || semVaga || erros)) {
    logger.info('ep-fup-naoatendido', 'follow-up do não atendido', {
      ofertas, viraram_lista: viraramLista, sem_vaga: semVaga, erros,
    });
  }
  return {
    ofertas, viraram_lista: viraramLista, marcadas_pelo_robo: doRoboN, sem_vaga: semVaga, erros,
    ...(dry ? { motivo: 'dry', previa } : {}),
  };
}
