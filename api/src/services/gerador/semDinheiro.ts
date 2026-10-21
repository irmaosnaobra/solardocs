// Texto livre que sai para a engenharia nunca leva dinheiro: R$, reais, pix, números com centavos e as palavras de preço.
export const TEXTO_COM_DINHEIRO = /r\$|\breais\b|\bpix\b|\d+,\d{2}\b|\b(valor|pre[cç]o|sinal|parcelas?|entrada|desconto|consultor)\b/i;
export const temDinheiro = (t: string): boolean => TEXTO_COM_DINHEIRO.test(t);
/** Regra estreita, para nome, endereço e titular (aceita "Km 12,50", "Rua da Entrada", "Av. Consultor Fulano"): só R$, reais e pix. */
export const TEXTO_COM_DINHEIRO_ESTREITO = /r\$|\breais\b|\bpix\b/i;
export const semDinheiroEstreito = (t: string): string => (TEXTO_COM_DINHEIRO_ESTREITO.test(t) ? '' : t);
/** O texto, ou '' se tiver cara de dinheiro (regra larga: materiais e especificações em texto livre). */
export const semDinheiro = (t: string): string => (temDinheiro(t) ? '' : t);
