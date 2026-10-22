// Gatilho do anúncio do SolarDoc (ÚNICO). Módulo puro, sem envio nem banco: a Carla antiga (whatsappAgentService),
// o webhook /io, o poll da recepção e a porta das agentes da 5040 (agentes5040/porteiro.ts) usam ESTA definição.
// Duas cópias é como uma delas envelhece sozinha.
//
// Ordem do Thiago (25/08): UM gatilho, não uma lista. O anúncio manda sempre a
// mesma frase — "Quero saber sobre a SolarDoc" — e é ela que abre o atendimento
// da vendedora. A lista antiga tinha 20 frases e mesmo assim não pegou esta:
// gatilho que se defende acumulando variação é gatilho que envelhece calado.
//
// A tolerância mora na NORMALIZAÇÃO, não em mais frases: caixa, acento e
// pontuação caem fora, e o nome do produto é aceito nas formas que a pessoa
// realmente digita (solardoc · soladoc · solar doc).
function normalizar(texto: string): string {
  return (texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOME_PRODUTO = /sol(?:ar)?\s?a?doc/;

// O gatilho é UM: "pediu informação sobre o SolarDoc". O que varia é a forma de
// pedir, e casar a frase exata do anúncio já provou ser frágil duas vezes —
// primeiro deixando passar a frase nova, depois (25/08, ao apertar demais)
// deixando passar a frase ANTIGA do anúncio, "Quero saber MAIS sobre o
// SolarDoc.App", que é a do único lead real que já existiu.
//
// O log de 2 meses tem 4 pessoas que escreveram do jeito delas e não receberam
// resposta nenhuma: "gostaria de mais informações sobre o app solardoc",
// "Gostaria de saber sobre o SolarDoc", "Sobre o Solardoc". Nenhuma tinha conta,
// nenhuma virou lead. Continuam sendo uma regra só — a intenção, não a frase.
const PEDIDO_DE_INFO = [
  'saber',        // quero saber · quero saber mais · gostaria de saber
  'conhecer',
  'informacao', 'informacoes',
  'sobre o ', 'sobre a ',   // "Sobre o Solardoc" sozinho já é pedido
];

/**
 * Alguém pedindo informação sobre o SolarDoc. EXPORTADO porque o webhook /io
 * precisa da MESMA definição pra ceder a mensagem — duas cópias é como uma delas
 * envelhece sozinha.
 *
 * Só roda para número SEM conta na plataforma (o roteador procura em `users`
 * antes), então "dúvida sobre o solardoc" aqui é lead, não cliente. Quem já é
 * cliente escreve "estou usando o SolarDoc Pro e preciso de ajuda" — sem pedido
 * de informação, não casa, e segue pro suporte como sempre.
 */
export function ehGatilhoSolarDoc(texto: string): boolean {
  const t = normalizar(texto);
  if (!t || !NOME_PRODUTO.test(t)) return false;
  return PEDIDO_DE_INFO.some((p) => t.includes(p));
}
