// ─────────────────────────────────────────────────────────────────────────────
// O AVISO DE IA (decisão do dono, 22/10/2026). PURO: sem banco, sem rede.
// Cada agente (Duda, Helena, Carla) avisa que é atendimento com IA na PRIMEIRA mensagem dela para aquele lead.
// Depois a conversa segue normal. Nunca nega ser IA (regra à parte, em personas/comum.ts).
// A posse guarda lead_data.apresentada = true quando uma bolha nossa com o aviso SAIU para o lead.
// ─────────────────────────────────────────────────────────────────────────────

import type { Persona } from './tipos';

export const NOME_DA_AGENTE: Readonly<Record<Persona, string>> = { duda: 'Duda', helena: 'Helena', carla: 'Carla' };

/** A frase padrão de apresentação. Texto final do redator. */
export const fraseDeApresentacao = (persona: Persona): string =>
  `Aqui é a ${NOME_DA_AGENTE[persona]}, do atendimento com IA da Irmãos na Obra.`;

/**
 * A bolha traz o aviso? "atendimento com IA" (ou o "IA" em maiúscula, como palavra) JUNTO do nome da agente.
 * Confere o texto cru: o "IA" em maiúscula é o que separa o aviso do verbo "ia".
 */
export function temAvisoDeIA(bolha: string | null | undefined, persona: Persona): boolean {
  const t = String(bolha ?? '');
  if (!new RegExp(String.raw`\b${NOME_DA_AGENTE[persona]}\b`, 'i').test(t)) return false;
  return /atendimento com IA\b/i.test(t) || /\bIA\b/.test(t);
}

/** O que a trava diz quando a primeira mensagem sai sem o aviso (volta ao modelo na reescrita). */
export const motivoSemAviso = (persona: Persona): string =>
  `esta é a sua PRIMEIRA mensagem a este cliente: a bolha tem que COMEÇAR com "${fraseDeApresentacao(persona)}" e só depois responder o que ele disse, tudo em até 160 caracteres`;

/** O aviso do sistema que acompanha o pedido enquanto a agente ainda não se apresentou. */
export const avisoDeApresentacao = (persona: Persona): string =>
  `AVISO DO SISTEMA: esta é a sua PRIMEIRA mensagem a este cliente. A bolha tem que COMEÇAR com "${fraseDeApresentacao(persona)}" `
  + 'e depois responder o que ele disse, tudo em até 160 caracteres no total (o resto fica para a próxima fala). Pode abrir com "Oi, Nome!" antes da frase. '
  + 'Vale também para a despedida, para a passagem ao humano e para qualquer ação com bolha. Sem a frase, a fala é barrada e não sai.';

/**
 * Bolha do SISTEMA (texto fixo) para quem ainda não foi apresentado: ganha a frase na frente se couber nos 160; senão null.
 * Bolha que já traz o aviso, ou lead já apresentado, passa sem mudar.
 */
export function comAvisoSeFaltar(bolha: string, persona: Persona, apresentada: boolean, teto = 160): string | null {
  if (apresentada || temAvisoDeIA(bolha, persona)) return bolha;
  const t = `${fraseDeApresentacao(persona)} ${bolha}`;
  return t.length <= teto ? t : null;
}
