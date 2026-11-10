// A origem do card que a agente da 5040 cria no WhatsApp (10/11/2026). Função pura, sem import: fica fora do agendaSolar.ts de
// propósito (muitos testes trocam esse módulo por um falso, e uma função nova nele quebraria todos).
//
// Conversa que veio de anúncio = 'whatsapp_anuncio', com o id do anúncio (sourceId, só dígitos) em ad_id; sem anúncio = 'whatsapp'.
// O id vem de anuncioDaMensagem. O ctwaClid NUNCA passa por aqui (regra de anuncio.ts): não é gravado em banco, log nem resposta.
export function origemDoCardDaAgente(anuncioId: string | null | undefined): { origem: string; adId?: string } {
  return anuncioId ? { origem: 'whatsapp_anuncio', adId: anuncioId } : { origem: 'whatsapp' };
}
