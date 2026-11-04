// ─────────────────────────────────────────────────────────────────────────────
// RELIGAR O CARD DO QUIZ SOLAR AO NÚMERO DE QUEM ESCREVEU (03/11/2026, card 1714). O cliente digitou o número X no quiz e escreveu do
// WhatsApp Y com o botão da página, cujo texto agora leva "Código: <5 caracteres>" (quizCodigo.ts). Quando a fala de Y chega com o código
// de um card que ainda não falou com a linha, o card passa a apontar para Y, e a fila da agenda (agendaEnvio.ts) aceita o número novo.
//
// Este módulo NUNCA manda mensagem (não importa zapiClient nem solarQuizAviso) e NUNCA lança. Na dúvida, não religa. Religa só quando TUDO vale:
//   - o texto tem "Código: XXXXX" e `quizsolar_codigo:<código>` existe, tem menos de 2 h e não foi usada;
//   - o card é lp_solar, está agendado e tem menos de 2 h;
//   - o número do card nunca escreveu à linha (conversa lida COMPLETA e sem fala do lead; leitura que falha = não religa);
//   - quem escreveu não tem outro card solar aberto (motivo `outro_card`);
//   - quem escreveu é outro número que o do card (igual = `mesmo_numero`, nada é feito).
// Ao religar: INSERT de `quizsolar_religado:<cardId>` (23505 = já religado) só com HMACs (`de` e `para`, o mesmo hmacDe(chaveContato) da fila),
// troca o cliente_telefone do card (o telefone_norm é coluna GERADA do banco: o banco o recalcula, nunca se escreve nele), marca o código
// como usado e loga uma linha sem telefone.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { chaveContato } from '../agents/whatsapp/silenciar';
import { STATUS_QUE_NAO_RECEBEM } from '../agenda/solarStatus';
import { lerConversa, lerCards } from './contexto';
import { hmacDe, idChaveHmac } from './hmac';
import { PREFIXO_CODIGO, PREFIXO_RELIGADO, VALIDADE_CODIGO_MS, codigoDoTexto } from './quizCodigo';

const LOG = 'religar-quiz';

export interface ResultadoReligar {
  religou: boolean;
  cardId?: number;
  /** Por que religou ou não. Nunca leva telefone. */
  motivo: string;
}

/** A janela em que a rede da fila procura falas com código em wa_mensagens. */
export const JANELA_REDE_MS = 30 * 60_000;

const soDigitos = (s: unknown): string => String(s ?? '').replace(/\D/g, '');
const idadeMs = (iso: unknown, agora: number): number => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? agora - t : Number.NaN; };

/** O celular de quem escreveu, no formato que a rota do quiz grava no card: 55 + DDD + 9 dígitos. null = não é celular brasileiro. */
function celularDoCard(telefone: string): string | null {
  const d = soDigitos(telefone).replace(/^(?:55|0)(?=\d{10,11}$)/, '');
  return d.length === 11 && d[2] === '9' ? `55${d}` : null;
}

const nao = (motivo: string, cardId?: number): ResultadoReligar => ({ religou: false, motivo, ...(cardId ? { cardId } : {}) });

/**
 * @param chaveDeQuemEscreveu  chaveContato (DDD + 8 últimos) do número que escreveu.
 * @param telefoneDeQuemEscreveu  o número dele, em dígitos (é o que passa a valer no card; nunca vai para log nem para a chave).
 * @param textoDaFala  a fala, com "Código: XXXXX".
 */
export async function religarQuizPelaEntrada(
  chaveDeQuemEscreveu: string, telefoneDeQuemEscreveu: string, textoDaFala: string, agora: number = Date.now(),
): Promise<ResultadoReligar> {
  let cardId: number | undefined;
  try {
    const codigo = codigoDoTexto(textoDaFala);
    if (!codigo) return nao('sem_codigo');
    const telNovo = celularDoCard(telefoneDeQuemEscreveu);
    const ckNovo = chaveContato(telNovo);
    if (!telNovo || !ckNovo || ckNovo !== chaveDeQuemEscreveu) return nao('telefone_invalido');
    const hmacNovo = hmacDe(ckNovo);
    const hmacId = idChaveHmac();
    if (!hmacNovo || !hmacId) return nao('sem_segredo');

    // 1. o código
    const chaveCodigo = `${PREFIXO_CODIGO}${codigo}`;
    const { data: linhaCodigo, error: erroCodigo } = await supabase.from('system_state').select('key, value, updated_at').eq('key', chaveCodigo).maybeSingle();
    if (erroCodigo) return nao('leitura_falhou');
    const cod = linhaCodigo as { value?: { card_id?: unknown; criado_em?: unknown; usado_em?: unknown } } | null;
    if (!cod) return nao('codigo_desconhecido');
    if (cod.value?.usado_em) return nao('codigo_usado');
    const idade = idadeMs(cod.value?.criado_em, agora);
    if (!Number.isFinite(idade) || idade < 0 || idade >= VALIDADE_CODIGO_MS) return nao('codigo_vencido');
    cardId = Number(cod.value?.card_id);
    if (!Number.isInteger(cardId) || cardId <= 0) return nao('codigo_desconhecido');

    // 2. o card
    const { data: cardLido, error: erroCard } = await supabaseGerador.from('agendamentos')
      .select('id, cliente_telefone, status, created_by, created_at').eq('id', cardId).maybeSingle();
    if (erroCard) return nao('leitura_falhou', cardId);
    const card = cardLido as { cliente_telefone?: string | null; status?: string | null; created_by?: string | null; created_at?: string | null } | null;
    const idadeCard = idadeMs(card?.created_at, agora);
    if (!card || card.created_by !== 'lp_solar' || String(card.status ?? '').trim().toLowerCase() !== 'agendado'
      || !Number.isFinite(idadeCard) || idadeCard >= VALIDADE_CODIGO_MS) return nao('card_nao_serve', cardId);
    const telDoCardLido = String(card.cliente_telefone ?? '');   // copia do que foi lido: o UPDATE só vale se o card ainda tem este número
    const ckCard = chaveContato(telDoCardLido);
    if (!ckCard) return nao('card_sem_telefone', cardId);
    if (ckCard === ckNovo) {
      // Mesmo número: nada muda no card, mas o código fica gasto, para a rede da fila não reler a mesma fala por 30 min.
      try { await supabase.from('system_state').update({ value: { ...(cod.value as object), usado_em: new Date(agora).toISOString() } }).eq('key', chaveCodigo); }
      catch (err) { logger.warn(LOG, `não marquei o código do card ${cardId} como usado`, err); }
      return nao('mesmo_numero', cardId);
    }
    const hmacCard = hmacDe(ckCard);
    if (!hmacCard) return nao('sem_segredo', cardId);

    // 3. o número do card nunca escreveu à linha
    const conversa = await lerConversa(ckCard);
    if (!conversa.completa) return nao('leitura_falhou', cardId);
    if (conversa.msgs.some(m => !m.from_me)) return nao('card_ja_escreveu', cardId);

    // 4. quem escreveu não tem outro card solar aberto
    let cardsDeQuemEscreveu;
    try { cardsDeQuemEscreveu = await lerCards(ckNovo); } catch { return nao('leitura_falhou', cardId); }
    const aberto = cardsDeQuemEscreveu.some(c => Number(c.id) !== cardId
      && !String(c.created_by ?? '').toLowerCase().includes('eletroposto')
      && !['cancelado', ...STATUS_QUE_NAO_RECEBEM].includes(String(c.status ?? '').trim().toLowerCase()));
    if (aberto) return nao('outro_card', cardId);

    // 5. o marcador (só HMACs): 23505 = já religado
    const em = new Date(agora).toISOString();
    const chaveMarcador = `${PREFIXO_RELIGADO}${cardId}`;
    const { error: erroMarcador } = await supabase.from('system_state').insert({
      key: chaveMarcador, value: { card_id: cardId, de: hmacCard, para: hmacNovo, hmac_id: hmacId, em }, updated_at: em,
    });
    if (erroMarcador) return nao((erroMarcador as { code?: string }).code === '23505' ? 'ja_religado' : 'erro_gravar', cardId);

    // 6. o card passa a apontar para quem escreveu (só se ainda tem o número que lemos; o telefone_norm o banco recalcula)
    const desfazer = async (motivo: string): Promise<ResultadoReligar> => {
      try {
        const { error } = await supabase.from('system_state').delete().eq('key', chaveMarcador);
        if (error) logger.warn(LOG, `não apaguei o marcador do card ${cardId} (${motivo})`, error);
      } catch (err) {
        // O marcador sem troca é inofensivo: só vale se o card tiver o número novo.
        logger.warn(LOG, `não apaguei o marcador do card ${cardId} (${motivo})`, err);
      }
      return nao(motivo, cardId);
    };
    try {
      const { data, error } = await supabaseGerador.from('agendamentos')
        .update({ cliente_telefone: telNovo }).eq('id', cardId).eq('cliente_telefone', telDoCardLido).select('id');
      if (error) return await desfazer('erro_gravar');
      if (!Array.isArray(data) || data.length === 0) return await desfazer('card_mudou');
    } catch { return await desfazer('erro_gravar'); }

    // 7. o código gasto
    try {
      await supabase.from('system_state').update({ value: { ...(cod.value as object), usado_em: em } }).eq('key', chaveCodigo);
    } catch (err) { logger.warn(LOG, `não marquei o código do card ${cardId} como usado`, err); }

    logger.info(LOG, `card ${cardId} religado ao número de quem escreveu com o código`);
    return { religou: true, cardId, motivo: 'religado' };
  } catch (err) {
    logger.warn(LOG, 'a religação lançou, nada foi feito', err);
    return nao('erro', cardId);
  }
}

/** Uma fala recente que traz código: o telefone dela (só dígitos) e o texto. */
export interface FalaComCodigo { telefone: string; texto: string }

/** As falas do lead na linha IO dos últimos `janelaMs` que trazem "Código: XXXXX". Leitura que falha devolve []. Nunca lança. */
export async function falasComCodigoRecentes(agora: number = Date.now(), janelaMs: number = JANELA_REDE_MS): Promise<FalaComCodigo[]> {
  const inst = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
  if (!inst) return [];
  try {
    const { data, error } = await supabase.from('wa_mensagens').select('telefone, texto, momment')
      .eq('instancia', inst).eq('from_me', false).eq('is_group', false)
      .gte('momment', new Date(agora - janelaMs).toISOString())
      .ilike('texto', '%digo%')
      .order('momment', { ascending: false }).limit(20);
    if (error) return [];
    return ((data ?? []) as Array<{ telefone?: string | null; texto?: string | null }>)
      .filter(l => codigoDoTexto(l.texto) !== null && chaveContato(l.telefone) !== null)
      .map(l => ({ telefone: soDigitos(l.telefone), texto: String(l.texto) }));
  } catch { return []; }
}

/**
 * A rede da fila: religa o que as falas recentes com código pedem (a fala chegou antes de a abertura sair). Quem escreveu por LID, sem
 * telefone legível, fica de fora. Devolve quantos cards religou. Nunca lança.
 */
export async function religarFalasRecentes(agora: number = Date.now()): Promise<number> {
  let n = 0;
  try {
    for (const f of await falasComCodigoRecentes(agora)) {
      const ck = chaveContato(f.telefone);
      if (!ck) continue;
      if ((await religarQuizPelaEntrada(ck, f.telefone, f.texto, agora)).religou) n++;
    }
  } catch { /* a rede é só uma segunda chance */ }
  return n;
}
