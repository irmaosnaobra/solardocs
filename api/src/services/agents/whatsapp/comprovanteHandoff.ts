// ─────────────────────────────────────────────────────────────────────────────
// COMPROVANTE REPROVADO VAI COM O CONTEXTO PARA A GIOVANNA.
//
// Antes: comprovante que o sistema não aceitava virava uma frase fixa ("recebi, já
// te libero") ou silêncio. O cliente ficava sem entender por que não liberou: Pix
// pra outra empresa, comprovante velho, valor que não é de plano, recibo de cartão.
//
// Agora o motivo vai pra Giovanna de SUPORTE (número de uma conta), que explica e
// orienta; quem não tem conta recebe uma mensagem fixa por motivo, escrita no
// pixComprovanteService. Este arquivo guarda o que o leitor viu e por que reprovou,
// e monta o bloco de instrução que entra no prompt dela. Quem LIBERA continua sendo
// só o sistema, quando chega comprovante válido: a Giovanna nunca diz que liberou.
//
// Mora em `system_state` (chave `pix_handoff:<telefone>`, só o mais novo vale).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { chaveTelefone, chaveTelefoneLegada, lerPixSolicitado } from './pixSolicitado';
import { pixCheckoutUrl } from '../../../utils/pixInfo';

export type CodigoMotivo =
  | 'ja_usado' | 'recebedor' | 'valor' | 'data' | 'entrada_repetida' | 'sem_id_pix';

export interface HandoffComprovante {
  valor: number | null;
  recebedor_nome: string | null;
  recebedor_documento: string | null;
  data: string | null;
  id_transacao: string | null;
  motivo: string;
  codigo: CodigoMotivo;
  /** O recebedor lido é a Aioros (o dinheiro, se saiu, chegou na gente). */
  recebedor_ok: boolean;
  em: string;
  instancia: string;
}

/** Por quanto tempo o handoff vale pra dar contexto às mensagens seguintes. */
export const HANDOFF_HORAS = 24;
/** Handoff "fresco": a Giovanna responde mesmo com o teto de turnos estourado. */
export const HANDOFF_FRESCO_MIN = 10;
/** A Duda e o webhook cedem só por este tempo: o bastante pra não responderem à MESMA mensagem. */
export const HANDOFF_CEDE_MIN = 5;

const chaveNova = (phone: string) => `pix_handoff:${chaveTelefone(phone)}`;
const chaveAntiga = (phone: string) => `pix_handoff:${chaveTelefoneLegada(phone)}`;

export async function guardarHandoffComprovante(phone: string, ctx: HandoffComprovante): Promise<void> {
  const { error } = await supabase
    .from('system_state').upsert({ key: chaveNova(phone), value: ctx }, { onConflict: 'key' });
  if (error) logger.error('pix-handoff', `não guardei o handoff de ${phone}`, error);
}

export async function lerHandoffComprovante(phone: string, maxHoras = HANDOFF_HORAS): Promise<HandoffComprovante | null> {
  const chaves = Array.from(new Set([chaveNova(phone), chaveAntiga(phone)]));
  for (const k of chaves) {
    const { data } = await supabase.from('system_state').select('value').eq('key', k).maybeSingle();
    const v = (data as { value?: HandoffComprovante } | null)?.value;
    if (!v?.em) continue;
    if (Date.now() - Date.parse(v.em) > maxHoras * 3_600_000) return null;
    return v;
  }
  return null;
}

/** O pagamento foi aceito (liberou ou virou crédito): o handoff de "comprovante não aceito" não vale mais. */
export async function apagarHandoffComprovante(phone: string): Promise<void> {
  try {
    const chaves = Array.from(new Set([chaveNova(phone), chaveAntiga(phone)]));
    for (const k of chaves) await supabase.from('system_state').delete().eq('key', k);
  } catch (err) {
    logger.error('pix-handoff', `não apaguei o handoff de ${phone}`, err);
  }
}

/** Nunca lança: a Duda e o webhook chamam isto em todo texto da linha. */
export async function temHandoffComprovante(phone: string, maxHoras = HANDOFF_HORAS): Promise<boolean> {
  try {
    return !!(await lerHandoffComprovante(phone, maxHoras));
  } catch {
    return false;
  }
}

const brl = (v: number | null) => (v == null ? 'não consegui ler' : `R$ ${v.toFixed(2).replace('.', ',')}`);
const doc = (d: string | null) => {
  const n = String(d ?? '').replace(/\D/g, '');
  return n ? ` (documento ${n})` : '';
};

/**
 * Bloco de instrução de sistema da Giovanna de SUPORTE (quem tem conta). Pode
 * escalar com [HUMANO].
 */
export function blocoComprovanteGiovanna(h: HandoffComprovante): string {
  const quem = h.recebedor_nome ? `"${h.recebedor_nome}"${doc(h.recebedor_documento)}` : 'um recebedor que não consegui ler';
  const linhas: string[] = [
    '━━ COMPROVANTE QUE O SISTEMA NÃO ACEITOU (vale agora, nesta conversa) ━━',
    'O cliente mandou um comprovante de pagamento e o sistema NÃO aceitou. Esta instrução vale mais que qualquer outra desta conversa sobre cartão, cupom, "pagamento que não completou" ou "não peça comprovante".',
    `O que o leitor viu: valor ${brl(h.valor)}; recebedor ${quem}; data ${h.data ?? 'não consegui ler'}; ID da transação ${h.id_transacao ?? 'não consegui ler'}.`,
    `Motivo: ${h.motivo}.`,
    '',
    'REGRAS:',
    '- Explique com calma, em poucas frases, o que aconteceu e o que ele pode fazer agora. Sem culpar ninguém.',
    '- NUNCA diga que liberou, que vai liberar, que o acesso está a caminho ou que o pagamento foi aceito. Quem libera é o sistema, e só quando chega um comprovante válido.',
  ];

  const humano = 'Escreva [HUMANO] no fim da resposta: o dinheiro chegou na Aioros e precisa de uma pessoa do time. Diga que o time vai conferir, sem prometer prazo.';

  switch (h.codigo) {
    case 'recebedor':
      linhas.push(
        `- O Pix foi para ${quem}, e não para a Aioros. Diga isso pelo nome que aparece no comprovante e explique que esse pagamento não chegou até a gente.`,
        '- O recebedor certo é Aioros Group Ltda, CNPJ 63.636.043/0001-88.',
        '- Não acuse ninguém de golpe. Só pergunte, com leveza, onde ele fez essa compra.',
        '- Se ele quiser assinar o SolarDoc, ofereça o Pix certo com [[ENVIAR_PIX]] (o sistema anexa o código e o valor sozinho). Use esse marcador UMA vez só nesta conversa; se o Pix já foi mandado, não repita.',
      );
      break;
    case 'data':
      linhas.push(
        '- O comprovante é antigo, fora da janela de dias que o sistema aceita. Peça o comprovante do pagamento deste mês.',
        '- Se ele disser que quer renovar agora, ofereça o Pix do mês com [[ENVIAR_PIX]] (uma vez só nesta conversa; se o Pix já foi mandado, não repita).',
      );
      break;
    case 'ja_usado':
      linhas.push(
        '- Esse comprovante já foi usado antes para liberar um plano. Diga isso e peça o comprovante do pagamento novo.',
        '- Se ele disser que quer renovar agora, ofereça o Pix do mês com [[ENVIAR_PIX]] (uma vez só nesta conversa; se o Pix já foi mandado, não repita).',
      );
      break;
    case 'entrada_repetida':
      linhas.push(
        '- A entrada de R$ 19 é oferta de primeira vez e este número já usou. Explique isso com jeito e diga que o plano normal é o caminho agora.',
        `- ${humano}`,
      );
      break;
    case 'valor':
    case 'sem_id_pix':
    default:
      linhas.push(
        h.codigo === 'valor'
          // Depois de 20/10/2026 qualquer valor legível vale (67 libera, menos vira parcial):
          // aqui o "valor" só reprova quando o leitor não conseguiu ler o número.
          ? (h.valor == null
            ? '- O leitor não conseguiu ler o valor do comprovante. Peça uma foto mais nítida ou o PDF da tela do banco.'
            : '- O valor não bate com nenhum plano do SolarDoc. Diga isso e peça o comprovante do Pix do plano, em foto ou PDF da tela do banco.')
          : '- O comprovante não traz o ID de um Pix (pode ser recibo de cartão, boleto ou outra coisa). Peça o comprovante do Pix, em foto ou PDF da tela do banco.',
      );
      if (h.recebedor_ok) linhas.push(`- ${humano}`);
      break;
  }

  linhas.push(
    '- Só use [[ENVIAR_PIX]] nos casos acima que o permitem (recebedor errado, data antiga, já usado); em qualquer outro o sistema remove o marcador.',
    '- Regras de escrita de sempre: frases curtas, cada mensagem começando com letra maiúscula, sem travessão e sem emoji colorido.',
    '━━ FIM DO BLOCO DO COMPROVANTE ━━',
  );
  return linhas.join('\n');
}

/**
 * O `[[ENVIAR_PIX]]` do modelo pode sair? TRAVA NO CÓDIGO (anti-ban), só vale com
 * handoff ativo; fora dele o chamador nem pergunta. Passa nos motivos "recebedor NÃO
 * parece ser a Aioros", "data fora da janela" e "já usado", e uma vez só por conversa:
 * se o histórico da sessão já tem o copia-e-cola (`000201`) ou a URL do checkout, ou se
 * o Pix pedido já foi registrado nas últimas 24h, o marcador é removido. Nos demais
 * motivos, sempre.
 */
export async function pixDoHandoffPodeSair(
  h: HandoffComprovante, messages: { role: string; content: string }[], cleanPhone: string,
): Promise<boolean> {
  // Recebedor errado, data fora da janela e já usado: quem mandou comprovante velho,
  // repetido ou de outra empresa precisa do Pix do mês. Valor ilegível, sem ID de Pix e
  // entrada repetida continuam sem Pix (ali falta entender o que ele pagou).
  if (h.codigo !== 'recebedor' && h.codigo !== 'data' && h.codigo !== 'ja_usado') return false;
  const url = (pixCheckoutUrl() || '').trim();
  if (messages.some(m => typeof m.content === 'string'
    && (m.content.includes('000201') || (url && m.content.includes(url))))) return false;
  try {
    const reg = await lerPixSolicitado(cleanPhone);
    if (reg && reg.valor > 0 && Date.now() - Date.parse(reg.em) <= 24 * 3_600_000) return false;
  } catch {
    // sem conseguir ler o registro, segue só com o histórico
  }
  return true;
}
