// Detecta na ÚLTIMA mensagem do lead se ele já recusou explicitamente.
// Usado pelos cron de follow-up (B2C, B2B, plataforma) pra evitar mandar
// follow-up pra quem já disse "não".
//
// Regex propositalmente conservativas — preferimos falso negativo (manda
// follow-up extra) a falso positivo (corta lead que ainda tava negociando).
// Ex: "não quero financiamento" NÃO bate com /^não quero\s*(mais)?\s*\.?$/.

export function detectarRecusaNaUltimaMsg(
  messages: Array<{ role: string; content: any }>,
): { recusou: boolean; motivo?: string } {
  const userMsgs = messages.filter(m => m.role === 'user');
  const last = userMsgs[userMsgs.length - 1];
  if (!last) return { recusou: false };
  const t = (typeof last.content === 'string' ? last.content : '').toLowerCase().trim();
  if (!t) return { recusou: false };

  if (/^n[aã]o\s+tenho\s+(interesse|mais\s+interesse)/i.test(t)) return { recusou: true, motivo: 'sem interesse' };
  if (/^n[aã]o\s+quero\s*(mais)?\s*[\.!]?\s*$/i.test(t)) return { recusou: true, motivo: 'não quer mais' };
  if (/^n[aã]o\s+quero\s+comprar/i.test(t)) return { recusou: true, motivo: 'não quer comprar' };
  if (/\bj[aá]\s+(comprei|fechei|instalei|coloquei|contratei)\b/i.test(t)) return { recusou: true, motivo: 'já fechou/instalou' };
  if (/\bj[aá]\s+tenho\s+(sistema|painel|solar|placa|fornecedor|empresa)/i.test(t)) return { recusou: true, motivo: 'já tem solução' };
  if (/(para|pare|parar)\s+de\s+me\s+(mandar|chamar|enviar|incomodar)/i.test(t)) return { recusou: true, motivo: 'pediu pra parar' };
  if (/n[aã]o\s+me\s+(chame|mande|incomode|envie|procure)\s+(mais)?/i.test(t)) return { recusou: true, motivo: 'opt-out' };
  if (/^obrigado[\s,.!]+n[aã]o\b/i.test(t) || /^n[aã]o[,.\s]+obrigado/i.test(t)) return { recusou: true, motivo: 'cordial não' };
  if (/^agora\s+n[aã]o\b/i.test(t) || /\bagora\s+n[aã]o[\s,.!]/i.test(t)) return { recusou: true, motivo: 'agora não' };
  if (/^bloqueio/i.test(t) || /\bvou\s+bloquear\b/i.test(t)) return { recusou: true, motivo: 'bloqueio' };

  return { recusou: false };
}
