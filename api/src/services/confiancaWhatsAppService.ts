// ─────────────────────────────────────────────────────────────────────────────
// CADÊNCIA DE CONFIANÇA — braço de WhatsApp. Três toques, três imagens.
//
// FORMATO: cada toque é UMA imagem com legenda curta. Não é enfeite — é a regra
// anti-ban do projeto escrita de outro jeito. O `sendFrio` existe porque "3 a 5
// mensagens seguidas de um número desconhecido é o gesto que faz a pessoa
// bloquear e denunciar"; uma imagem com legenda é UMA mensagem no fio, e carrega
// mais do que um textão carregaria. Menos texto e mais prova, sem gastar mais
// linha.
//
// ⚠️ O QUE FAZ ESTA CADÊNCIA SER SEGURA NÃO É O TETO, É A AUDIÊNCIA. Ela fala
// SÓ com quem JÁ PAGOU (20 pessoas hoje). Cliente que assinou semana passada
// recebendo uma imagem da empresa que ele contratou não é disparo frio — é
// pós-venda. Se um dia isso for apontado pros 50 contatos frios que já levaram
// de 3 a 5 toques da Giovanna sem responder, a conta de ban muda inteira e o
// teto sozinho não segura. A audiência é a trava principal.
//
// CARDS, NÃO PRINTS. A imagem é um card com a fala que JÁ está publicada na
// página de vendas (mesma autorização). Print de conversa mostra nome, número e
// foto de um cliente numa conversa privada — licença diferente da frase, que
// ninguém pediu. Gerador dos cards: api/scripts/gerar-cards-depoimento.js
//
// TETO: `sendImage` NÃO passa pelo `sendHuman`, então não carimba nada sozinho —
// um envio por aqui seria invisível pra TODA régua da linha (teto/hora, teto/dia
// e a margem de 5 min), e ainda estragaria o espaçamento do próximo agente a
// enviar. Por isso este serviço chama `dentroDoTetoCarla()` antes e
// `marcarEnvioCarla()` depois, de propósito: divide o MESMO orçamento da linha
// solardoc com a Giovanna em vez de abrir um segundo teto paralelo — que é
// exatamente o bug que o cabeçalho do lineThrottle manda não repetir.
//
// DESLIGADA POR PADRÃO: exige CONFIANCA_WA_ENABLED=true.
// Prévia sem enviar: GET /cron/confianca-whatsapp?seco=1
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../utils/supabase';
import { sendImage } from './agents/zapiClient';
import { dentroDoTetoCarla, marcarEnvioCarla, dentroDaJanelaDeEnvio } from './agents/whatsapp/carlaThrottle';
import { registrarMsgProativa } from './agents/whatsapp/whatsappAgentService';
import { ancorasPorEmail } from './confiancaService';
import { logger } from '../utils/logger';

const DIA_MS = 24 * 60 * 60 * 1000;

/** Gap mínimo entre um toque nosso e outro, em qualquer canal. */
const GAP_CANAL_MS = 23 * 60 * 60 * 1000;

const APP_URL = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

/**
 * Os três toques. Dias 5, 12 e 25 — escolhidos NO MEIO dos dias do e-mail
 * (1/3/7/14/30) pra não caírem no mesmo dia. Isso sozinho não basta (quem entra
 * no meio da cadência de e-mail bagunça o calendário), então há também a trava
 * por `confianca_last_sent_at` lá embaixo — dia diferente é conveniência, a
 * trava é o que garante.
 *
 * As imagens moram em dashboard/public/depoimentos/ e são servidas pelo próprio
 * domínio. O matcher do proxy exclui `.png`, então estático não leva 307 pro
 * login — se levasse, a Z-API buscaria um HTML de redirect no lugar da imagem.
 */
const TOQUES: Array<{ dia: number; card: string; legenda: (nome: string) => string }> = [
  {
    dia: 5,
    card: 'card-alessandro-forca-solar.png',
    legenda: (nome) => `${nome}, tudo certo por aí? Deixo aqui o que outro integrador falou da ferramenta 👇`,
  },
  {
    dia: 12,
    card: 'card-lucas-rsc-solar.png',
    legenda: (nome) => `${nome}, esse é o Lucas — ele usa direto do celular. Se ainda não instalou na tela inicial, vale.`,
  },
  {
    dia: 25,
    card: 'card-antonio-exxel-solar.png',
    legenda: (nome) => `${nome}, esse é o último que te mando por aqui. Precisando de qualquer coisa é só me chamar neste número.`,
  },
];

/** URL do card do toque. Env sobrepõe (trocar criativo sem deploy). */
function urlDoCard(toque: number): string {
  const daEnv = (process.env[`CONFIANCA_WA_CARD_${toque}`] || '').trim();
  return daEnv || `${APP_URL}/depoimentos/${TOQUES[toque - 1].card}`;
}

export interface PrevistoWa {
  userId: string;
  phone: string;
  nome: string | null;
  toque: number;
  diasDeCasa: number;
  card: string;
  legenda: string;
}

export interface ResultadoWa {
  enviados: number;
  previstos: number;
  semAncora: number;
  seco: boolean;
  fila?: PrevistoWa[];
  motivo?: string;
}

function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome || '').trim();
  return limpo ? limpo.split(/\s+/)[0] : 'Oi';
}

function msDe(v: unknown): number {
  if (!v) return 0;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? 0 : t;
}

export async function runConfiancaWhatsApp(opts: { seco?: boolean } = {}): Promise<ResultadoWa> {
  const seco = opts.seco === true;

  if (!seco && (process.env.CONFIANCA_WA_ENABLED || '').trim().toLowerCase() !== 'true') {
    return { enviados: 0, previstos: 0, semAncora: 0, seco, motivo: 'CONFIANCA_WA_ENABLED != true' };
  }

  // Janela diurna. Vale também no seco: a prévia tem que mostrar o que sairia
  // AGORA, e de madrugada não sai nada.
  const agoraDate = new Date();
  if (!seco && !dentroDaJanelaDeEnvio(agoraDate)) {
    return { enviados: 0, previstos: 0, semAncora: 0, seco, motivo: 'fora da janela diurna' };
  }

  const agora = agoraDate.getTime();

  const { data: candidatos } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp, plano, whatsapp_opt_out, whatsapp_replied_at, confianca_wa_count, confianca_wa_last_at, confianca_last_sent_at')
    .neq('plano', 'free')
    .not('whatsapp', 'is', null)
    .lt('confianca_wa_count', TOQUES.length);

  if (!candidatos?.length) return { enviados: 0, previstos: 0, semAncora: 0, seco };

  const ancoras = await ancorasPorEmail();

  let semAncora = 0;
  const fila: PrevistoWa[] = [];

  for (const u of candidatos as Array<Record<string, any>>) {
    const phone = (u.whatsapp || '').trim();
    if (!phone) continue;
    if (u.whatsapp_opt_out === true) continue;
    // Respondeu = conversa viva. Quem assume dali é gente, não a cadência.
    if (u.whatsapp_replied_at) continue;

    const email = (u.email || '').trim().toLowerCase();
    const ancora = email ? ancoras.get(email) : undefined;
    if (!ancora) { semAncora++; continue; }

    const count: number = u.confianca_wa_count ?? 0;
    const diasDeCasa = Math.floor((agora - ancora) / DIA_MS);

    // Mesma regra do braço de e-mail: ENTRA pelo toque do tempo de casa, SEGUE
    // de um em um. Quem já passou dos 25 dias recebe só o último e encerra.
    const jaVencidos = TOQUES.filter(t => diasDeCasa >= t.dia).length;
    const proximo = count === 0 ? jaVencidos : count + 1;
    if (proximo < 1 || proximo > TOQUES.length) continue;
    if (diasDeCasa < TOQUES[proximo - 1].dia) continue;

    // TRAVA DE CANAL CRUZADO. O mesmo cliente está na cadência de e-mail; levar
    // e-mail e WhatsApp no mesmo dia é o dobro de presença que a gente pediu.
    if (agora - msDe(u.confianca_last_sent_at) < GAP_CANAL_MS) continue;
    if (agora - msDe(u.confianca_wa_last_at) < GAP_CANAL_MS) continue;

    const nome = primeiroNome(u.nome);
    fila.push({
      userId: u.id, phone, nome: u.nome ?? null, toque: proximo, diasDeCasa,
      card: urlDoCard(proximo),
      legenda: TOQUES[proximo - 1].legenda(nome),
    });
  }

  if (seco) return { enviados: 0, previstos: fila.length, semAncora, seco: true, fila };

  let enviados = 0;
  for (const alvo of fila) {
    // Orçamento da linha solardoc, dividido com a Giovanna. Estourou → para de
    // varrer (break, não continue): o resto fica pro próximo ciclo do master.
    if (!(await dentroDoTetoCarla())) {
      logger.info('confianca-wa', 'teto da linha atingido — segurando pro próximo ciclo');
      break;
    }

    try {
      await sendImage(alvo.phone, alvo.card, alvo.legenda, 'solardoc');
      // SEM isto o envio é invisível pra régua da linha (ver cabeçalho).
      await marcarEnvioCarla(alvo.userId);
      // Guarda o toque na sessão: se ele responder, a Giovanna lê o contexto e
      // continua a MESMA conversa em vez de atender do zero.
      await registrarMsgProativa({
        userId: alvo.userId, phone: alvo.phone, content: alvo.legenda, nome: alvo.nome,
      }).catch(() => {});

      await supabase.from('users').update({
        confianca_wa_count: alvo.toque,
        confianca_wa_last_at: new Date().toISOString(),
      }).eq('id', alvo.userId);

      enviados++;
    } catch (err) {
      logger.error('confianca-wa', `falha no toque ${alvo.toque} de ${alvo.phone}`, err);
    }
  }

  if (enviados > 0) logger.info('confianca-wa', `${enviados} card(s) enviados (fila: ${fila.length})`);
  return { enviados, previstos: fila.length, semAncora, seco: false };
}
