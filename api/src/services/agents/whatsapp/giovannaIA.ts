// ─────────────────────────────────────────────────────────────────────────────
// A GIOVANNA NUNCA NEGA SER IA (03/11/2026, regra do dono de 20/10). PURO: sem banco, sem env, sem relógio.
//
// O prompt manda ela dizer "Sou a IA do SolarDoc, sim." quando perguntarem. Prompt não segura sozinho: esta é a trava mecânica, aplicada ao
// texto da resposta ANTES de separar as bolhas, de enviar e de gravar a sessão. Toda frase que NEGA ser IA ou AFIRMA ser gente é trocada pela
// frase certa, uma vez só na resposta (as outras ocorrências somem, para a frase não se repetir).
// ─────────────────────────────────────────────────────────────────────────────

export const FRASE_IA_GIOVANNA = 'Sou a IA do SolarDoc, sim.';

// "Não sou (uma) IA/robô/bot/inteligência artificial..." e "sou (uma) pessoa/humana/humano/gente (de verdade)...", até o fim da frase (ponto,
// exclamação, interrogação, quebra de linha ou o separador de bolhas ||). A borda depois da palavra é uma busca à frente por letra ou número:
// o \b do JavaScript não enxerga "ô" como letra, e "robô," nunca fecharia.
const NEGA_IA = new RegExp(
  String.raw`\bn[aã]o sou (?:uma |um )?(?:ia|rob[oô]|bot|intelig[eê]ncia artificial)(?![\p{L}\p{N}])[^.!?\n|\[]*[.!?]?`
  + '|'
  + String.raw`\bsou (?:uma |um )?(?:(?:humana|humano)(?![\p{L}\p{N}])|(?:pessoa|gente)(?: de verdade)?(?=\s*(?:[.!?,;\n|\[]|$)))[^.!?\n|\[]*[.!?]?`,
  'giu',
);

/** Troca a negação de ser IA pela FRASE_IA_GIOVANNA (a 1ª ocorrência; as seguintes saem). Texto sem negação volta igual. */
export function semNegarIA(raw: string): string {
  let jaTrocou = false;
  const texto = String(raw ?? '');
  const novo = texto.replace(NEGA_IA, () => {
    if (jaTrocou) return '';
    jaTrocou = true;
    return FRASE_IA_GIOVANNA;
  });
  return jaTrocou ? novo.replace(/[ \t]{2,}/g, ' ').trim() : texto;
}
