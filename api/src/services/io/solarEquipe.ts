// Telefones de quem recebe os avisos do solar. Moram aqui (e não em routes/ioSolar.ts) para os
// services do quiz poderem importá-los sem fechar um ciclo com a rota; o ioSolar.ts reexporta os dois.

/** A equipe do solar. Exportada porque o solarRespostas.ts precisa do número do dono (thiago) como rede. */
export const EQUIPE: Record<string, string> = {
  nilce: '34991516846',
  thiago: '34991360223',
  diego: '34991360172',
};

/** Telefone de quem recebe o aviso da ficha do quiz. A Giovanna continua listada para o card antigo dela,
 *  mas não recebe mais lead novo. As chaves são minúsculas: use TEL_AVISO['nilce'], nunca TEL_AVISO.Nilce. */
export const TEL_AVISO: Record<string, string> = { ...EQUIPE, giovanna: '34993396255' };
