// ─────────────────────────────────────────────────────────────────────────────
// TODO NOTA 1 ENTRA NO GRUPO — ENQUANTO O GRUPO FOR O DESTINO DELE.
//
// ATUALIZADO EM 07/08/2026: o destino do NOTA 1 passou a ser a página de venda
// do material (/io/eletroposto/material). Assim que essa oferta estiver vendável
// (curso publicado + link de checkout), este tick para sozinho — ver o gate
// `ofertaDeEntradaVendavel()` logo no começo de runConviteNota1Garantido().
// Até lá, tudo abaixo continua valendo como sempre valeu.
//
// Regra do dono: quem cai como NOTA 1 na LP do eletroposto tem que ser convidado
// pro grupo — sem exceção. Hoje o convite sai na hora, dentro do POST /nota1, e
// isso quebra em três lugares, sempre em silêncio:
//   • a linha cai (foi o apagão de 01–03/ago: 8 leads gravados, nenhum convidado);
//   • o teto de 40 convites/hora estoura e a ficha é gravada SEM convite;
//   • o envio dá erro e ninguém re-tenta — não existe segunda chance.
//
// Este tick fecha o buraco: a cada rodada do /process-messages ele varre quem
// ficou com `convite_enviado_at` nulo e manda. É a rede embaixo do trapézio, não
// o trapézio: o caminho normal continua sendo o envio imediato da LP.
//
// Cuidados que ele respeita (a linha já foi bloqueada uma vez):
//   • janela 07h–20h BRT — ninguém é convidado de madrugada;
//   • teto anti-ban da linha, o mesmo que a Bia e o followup consomem;
//   • 1 pessoa por rodada, com 4 min de intervalo entre uma e outra;
//   • no máximo 3 tentativas por lead — depois disso fica marcado no banco pra
//     alguém olhar, em vez de ficar tentando pra sempre;
//   • quem já está na fila da repescagem é pulado (senão receberia duas vezes).
//
// Kill-switch: EP_CONVITE_GARANTIDO_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendFrio } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { bolhasConviteParaFicha } from './eletropostoRepescagem';
import { ofertaDeEntradaVendavel } from '../plugcashService';

const ULTIMO_KEY = 'ep_convite_garantido_ultimo';
const TENTATIVA_PREFIX = 'ep_convite_tentativa:';
/** Marcador de envio efetivado — entra no teto da linha (lineThrottle). */
export const EP_CONVITE_SENT_PREFIX = 'ep_convite_sent:';

const INTERVALO_MS = 4 * 60 * 1000;
const JANELA_INICIO_H = 7;
const JANELA_FIM_H = 20;
const MAX_TENTATIVAS = 3;
/** Carência: o envio imediato da LP tem esse tempo pra dar conta sozinho. */
const CARENCIA_MS = 3 * 60 * 1000;
/** Não acorda ficha velha: nota 1 de duas semanas atrás não recebe convite hoje. */
const IDADE_MAXIMA_MS = 7 * 24 * 60 * 60 * 1000;

const desligado = () => (process.env.EP_CONVITE_GARANTIDO_OFF || '').trim() === '1';

function horaBrasilia(): number {
  return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit' }));
}
function foraDaJanela(): boolean {
  const h = horaBrasilia();
  return h < JANELA_INICIO_H || h >= JANELA_FIM_H;
}

interface Nota1 { id: number; nome: string | null; telefone: string; created_at: string }

type Resultado = { enviados: number; motivo?: string; pendentes?: number };

export async function runConviteNota1Garantido(): Promise<Resultado> {
  if (desligado()) return { enviados: 0, motivo: 'desligado' };
  if (foraDaJanela()) return { enviados: 0, motivo: 'fora_da_janela' };

  // ── A rede vira armadilha quando a oferta entra no ar ──
  // Desde 07/08/2026 o NOTA 1 é levado pra página de venda do material em vez do
  // grupo, e o POST /nota1 para de enviar o convite. Consequência direta: TODO
  // lead novo passa a ter `convite_enviado_at` nulo — que é exatamente o que esta
  // varredura procura. Sem este gate, ela mandaria o grupo de graça no WhatsApp
  // de quem acabou de ver uma oferta de R$ 197, minutos depois. A rede embaixo do
  // trapézio viraria o furo.
  //
  // A pergunta é a MESMA função que o POST /nota1 usa. Duplicar a regra aqui era
  // garantir que um dia os dois discordassem — e a discordância só apareceria na
  // conversão caindo, sem erro nenhum no log.
  if (await ofertaDeEntradaVendavel()) {
    return { enviados: 0, motivo: 'oferta_no_ar' };
  }

  const agora = Date.now();
  const { data: pendentes, error } = await supabaseGerador
    .from('eletroposto_nota1')
    .select('id, nome, telefone, created_at')
    .is('convite_enviado_at', null)
    .gte('created_at', new Date(agora - IDADE_MAXIMA_MS).toISOString())
    .lte('created_at', new Date(agora - CARENCIA_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) { logger.error('ep-convite', 'ler pendentes falhou', error); return { enviados: 0, motivo: 'erro_leitura' }; }
  if (!pendentes?.length) return { enviados: 0, motivo: 'ninguem_pendente' };

  // Intervalo entre convites (o teto da linha é o outro freio, este é o ritmo).
  const { data: ult } = await supabase
    .from('system_state').select('value').eq('key', ULTIMO_KEY).maybeSingle();
  const ultimoMs = new Date(((ult?.value ?? {}) as { at?: string }).at ?? 0).getTime();
  if (agora - ultimoMs < INTERVALO_MS) return { enviados: 0, motivo: 'intervalo', pendentes: pendentes.length };

  if (!(await dentroDoTetoHorarioLinha({ transacional: true })  /* convite prometido na ficha (nota 1) */)) return { enviados: 0, motivo: 'teto_linha', pendentes: pendentes.length };

  // Quem a repescagem já vai chamar não pode ouvir a mesma coisa duas vezes.
  const { data: marcadores } = await supabase
    .from('system_state').select('key')
    .or('key.like.ep_repescagem_pending:%,key.like.ep_repescagem_sent:%,key.like.ep_convite_tentativa:%')
    .limit(500);
  const naRepescagem = new Set<string>();
  const tentativas = new Map<string, number>();
  for (const m of marcadores ?? []) {
    const k = String(m.key);
    if (k.startsWith('ep_repescagem_')) naRepescagem.add(k.split(':')[1] ?? '');
    else if (k.startsWith(TENTATIVA_PREFIX)) tentativas.set(k.slice(TENTATIVA_PREFIX.length), 0);
  }

  const alvo = (pendentes as Nota1[]).find(l => {
    const tel = String(l.telefone || '').replace(/\D/g, '');
    if (!tel) return false;
    if (naRepescagem.has(tel)) return false;
    return true;
  });
  if (!alvo) return { enviados: 0, motivo: 'todos_ja_na_fila', pendentes: pendentes.length };

  // Contagem de tentativas por lead: 3 e para. Depois disso é problema pra humano,
  // não pra loop — número que recusa entrega não melhora na 40ª tentativa.
  const chaveTentativa = `${TENTATIVA_PREFIX}${alvo.id}`;
  const { data: tRow } = await supabase
    .from('system_state').select('value').eq('key', chaveTentativa).maybeSingle();
  const jaTentou = Number(((tRow?.value ?? {}) as { n?: number }).n ?? 0);
  if (jaTentou >= MAX_TENTATIVAS) {
    return { enviados: 0, motivo: 'tentativas_esgotadas', pendentes: pendentes.length };
  }

  // Marca o relógio e a tentativa ANTES de enviar: se a função morrer no meio, o
  // próximo tick espera o intervalo em vez de emendar dois convites.
  const nowIso = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: ULTIMO_KEY, value: { at: nowIso, lead: alvo.id }, updated_at: nowIso },
    { onConflict: 'key' },
  );
  await supabase.from('system_state').upsert(
    { key: chaveTentativa, value: { n: jaTentou + 1, ultima: nowIso }, updated_at: nowIso },
    { onConflict: 'key' },
  );

  try {
    await sendFrio(alvo.telefone, bolhasConviteParaFicha(alvo.nome ?? '', alvo.created_at), 'io');

    await supabaseGerador.from('eletroposto_nota1')
      .update({ convite_enviado_at: new Date().toISOString() })
      .eq('id', alvo.id)
      .is('convite_enviado_at', null);

    await supabase.from('system_state').upsert(
      {
        key: `${EP_CONVITE_SENT_PREFIX}${String(alvo.telefone).replace(/\D/g, '')}`,
        value: { sent_at: new Date().toISOString(), lead: alvo.id, tentativa: jaTentou + 1 },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );
    await supabase.from('system_state').delete().eq('key', chaveTentativa);

    logger.info('ep-convite', `convite garantido enviado pro nota 1 #${alvo.id} (tentativa ${jaTentou + 1})`);
    return { enviados: 1, pendentes: pendentes.length - 1 };
  } catch (err) {
    await supabaseGerador.from('eletroposto_nota1')
      .update({ convite_erro: String(err).slice(0, 400) }).eq('id', alvo.id);
    logger.error('ep-convite', `convite falhou pro nota 1 #${alvo.id} (tentativa ${jaTentou + 1}/${MAX_TENTATIVAS})`, err);
    return { enviados: 0, motivo: 'erro_envio', pendentes: pendentes.length };
  }
}
