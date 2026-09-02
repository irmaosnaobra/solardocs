// ─────────────────────────────────────────────────────────────────────────────
// "PERCEBEU QUE É ROBÔ, CORTA" — ordem do Thiago (25/08/2026)
//
// Nossos clientes são integradores de solar, e MUITOS rodam atendente de IA no
// próprio número comercial. Quando a gente manda qualquer coisa pra lá, quem
// responde é o robô deles — e a Giovanna responde de volta. Duas IAs se
// cumprimentando, uma a cada minuto, numa linha que já foi bloqueada três vezes.
//
// O caso que motivou isto (25/08, um aviso de campanha pra Luz Energy), 12
// mensagens em 13 minutos:
//   << Ana Clara: "Desculpe, mas não posso ajudar com esse tipo de mensagem..."
//   >> Giovanna:  "Sem problemas! Se precisar de algo do SolarDoc, é só chamar."
//   << Ana Clara: "Claro, estou aqui para ajudar!..."
//   >> Giovanna:  "Parece que estou falando com um sistema automático de vocês"
//   << Ana Clara: "Olá, tudo bem? Sou a Ana Clara da Luz Energy, qual seu nome?"
//   >> Giovanna:  "Oi, Ana Clara! Sou a Giovanna, da SolarDoc Pro."
//   ...
// Repare na quarta linha: a Giovanna PERCEBEU e mandou mais três mensagens
// depois. O teto que já existia (MAX_TURNOS_AUTO = 12) é blunt demais pra isso —
// só corta depois de 12 respostas nossas, ou seja, depois do estrago.
//
// ── DOIS NÍVEIS, porque errar pros dois lados custa coisas diferentes ────────
// Deixar de responder um robô é de graça. Emudecer um cliente pagante que só
// escreveu formal é caro — ele fica sem suporte e não sabe por quê. Então:
//
//   CERTEZA  → cala 12h. Só frase que ser humano não escreve sobre si mesmo:
//              "sou o assistente virtual", "não estamos disponíveis no momento",
//              "não posso ajudar com esse tipo de mensagem".
//   SUSPEITA → pula ESTA resposta e pronto, sem calar nada. É o robô que nos
//              trata como lead de solar. Um cliente nosso pode escrever algo
//              parecido falando do cliente DELE, então aqui não se mete a besta.
//
// Os dois param o pinga-pinga; só o primeiro persiste. Testado contra as
// mensagens reais da base em roboDoOutroLado.test.ts — zero falso positivo.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';

/** Silêncio dura 12h, não pra sempre: tem gente de carne e osso nesse número. */
const SILENCIO_MS = 12 * 60 * 60 * 1000;
const CHAVE = (phone: string) => `robo_outro_lado:${phone.replace(/\D/g, '')}`;

const norm = (t: string) =>
  (t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// ── CERTEZA ──────────────────────────────────────────────────────────────────
// Robô que se APRESENTA como robô, recado de ausência, ou recusa de LLM.
// Nenhuma dessas é coisa que gente digita sobre si mesma numa conversa.
const CERTEZA: Array<[RegExp, string]> = [
  [/\bsou (o|a|um|uma) (assistente|atendente)\b/,                  'se apresenta como assistente'],
  [/\b(assistente|atendente) (virtual|automatic[oa]|digital)\b/,   'diz ser assistente virtual'],
  [/\batendimento automatic[oa]\b/,                                'diz ser atendimento automático'],
  [/\b(mensagem|resposta) automatica\b/,                           'diz ser mensagem automática'],
  [/\bsou (um|uma) (bot|robo|ia)\b/,                               'se apresenta como bot'],
  [/\bintelig[e]ncia artificial\b/,                                'se apresenta como IA'],
  // Recados de ausência — autoresponder puro. Os dois primeiros saíram da base.
  [/\bnao estamos disponiveis no momento\b/,                       'recado de ausência'],
  [/\bresponderemos assim que (for )?possivel\b/,                  'recado de ausência'],
  [/\bencaminhei sua mensagem para (a |nossa )?equipe\b/,          'autoresponder de triagem'],
  [/\balguem (falara|entrara em contato) com voce em breve\b/,     'autoresponder de triagem'],
  // Recusa de modelo de linguagem. Foi a 1a mensagem do caso da Luz Energy.
  [/\bnao posso (te )?ajudar com (esse|este) tipo de (mensagem|solicitacao|pedido)\b/, 'recusa de LLM'],
  [/\bcomo (um|uma) (modelo|assistente) de linguagem\b/,           'recusa de LLM'],
];

// ── SUSPEITA ─────────────────────────────────────────────────────────────────
// Robô de captação tratando a gente como lead DELE. Cliente nosso sabe quem
// somos — nós é que vendemos pra ele. Mas ele PODE escrever frase parecida
// falando do cliente dele ("meu cliente tem interesse em energia solar"), então
// aqui a consequência é só pular a resposta, nunca calar.
//
// Repare no que ficou de FORA de propósito: "tenho interesse nos eletropostos" e
// "interesse em energia solar" soltos. Os dois estão na base, escritos por gente.
const SUSPEITA: Array<[RegExp, string]> = [
  [/\b(vi|notei|percebi) que voce (demonstrou|tem|teve) interesse\b/,                  'nos trata como lead'],
  [/\bestou a disposicao para tirar duvidas ou fazer um orcamento\b/,                  'pitch de captação'],
  [/\bcaso voce ou alguem que conheca tenha interesse\b/,                              'pitch de captação'],
  [/\bcomo posso (te )?ajudar hoje\?/,                                                 'abertura de bot'],
  // O vão é 80 e não 40 porque o bot enfia o nome do produto no meio: "manda sua
  // pergunta sobre a Maquininha Smart ou sobre os pagamentos que te ajudo rapidinho".
  [/\bmanda (sua|a sua) (pergunta|duvida) .{0,80}que te (ajudo|explico) rapidinho\b/,  'bot de atendimento'],
];

export type Veredito =
  | { nivel: 'nenhum' }
  | { nivel: 'certeza'; sinal: string }
  | { nivel: 'suspeita'; sinal: string };

/** A mensagem QUE CHEGOU tem cara de atendente automático — e com que confiança? */
export function pareceRoboDeles(texto: string): Veredito {
  const t = norm(texto);
  if (!t.trim()) return { nivel: 'nenhum' };
  for (const [r, sinal] of CERTEZA) if (r.test(t)) return { nivel: 'certeza', sinal };
  for (const [r, sinal] of SUSPEITA) if (r.test(t)) return { nivel: 'suspeita', sinal };
  return { nivel: 'nenhum' };
}

/**
 * A resposta QUE A GIOVANNA ACABOU DE ESCREVER já concluiu que é robô?
 * Se sim, aquela é a última — é literalmente "percebeu que é robô, corta".
 * Frente robusta: não depende da redação do bot alheio, só da nossa.
 */
export function nossaRespostaJaDesconfiou(texto: string): boolean {
  const t = norm(texto);
  return /\b(sistema|atendimento|assistente|robo|bot) automatic/.test(t)
    || /\bfalando com (um|uma) (sistema|robo|bot|maquina|assistente)/.test(t)
    || /\bparece (que )?(e |ser )?(um|uma) (robo|bot|sistema automatic)/.test(t);
}

/** Marca o número como "tem robô atendendo" — silêncio por 12h. */
export async function marcarRoboDoOutroLado(phone: string, sinal: string): Promise<void> {
  const agora = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: CHAVE(phone), value: { sinal, desde: agora }, updated_at: agora },
    { onConflict: 'key' },
  );
  logger.info('robo-outro-lado', `${phone} silenciado por 12h — ${sinal}`);
}

/** Ainda estamos dentro das 12h de silêncio pra esse número? */
export async function temRoboAtendendo(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_state').select('updated_at').eq('key', CHAVE(phone)).maybeSingle();
  if (!data?.updated_at) return false;
  return Date.now() - Date.parse(data.updated_at) < SILENCIO_MS;
}
