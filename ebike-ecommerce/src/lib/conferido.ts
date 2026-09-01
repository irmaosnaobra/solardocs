/**
 * "Conferido em 01/09, 07h12" — a hora da última leitura do fornecedor.
 *
 * Substitui o "consultar disponibilidade", que era a coisa mais fraca da
 * vitrine: quem está decidindo gastar R$ 8 mil lê aquilo como "eles não sabem
 * se têm". Isto aqui não promete unidade nenhuma — diz exatamente o que a loja
 * sabe, e o que ela sabe é forte: o modelo estava no catálogo do fornecedor
 * hoje de manhã, porque a varredura roda às 7h e às 13h.
 *
 * DATA ABSOLUTA, nunca "hoje". A página fica em cache por até um dia; um texto
 * dizendo "hoje às 7h" viraria mentira na virada da meia-noite, sem ninguém
 * perceber. Data escrita continua verdadeira para sempre.
 *
 * Formatado no SERVIDOR e passado pronto para o componente: fuso do navegador
 * é do visitante, e a hora que interessa é a de Brasília.
 */
export function textoDeConferencia(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')}, ${p('hour')}h${p('minute')}`;
}
