// Paginação do Moderno sem JS (o PDF roda com JS desligado): cada folha variável é uma lista de blocos com altura
// ESTIMADA em px. O empacotador enche a folha até a altura útil e manda o resto para uma folha seguinte limpa, com o
// mesmo título e "continuação". As estimativas foram medidas no Chromium (A4, 794 px) e levam folga; o script de
// medição fica fora do repositório (Temp/designer/proposta/medir.js) e o teste confere a soma.
import { pEsc } from '../propostaSolarBase';

export interface Bloco { html: string; h: number }
export interface Pagina { corpo: string; h: number }

/** 1122 da folha menos cabeçalho (64), rodapé (46) e respiros do miolo (34 + 26). */
export const ALTURA_UTIL = 1122 - 64 - 46 - 34 - 26;
/** Título da folha (h2) com uma linha de apoio de até duas linhas. */
export const ALTURA_TITULO = 92;

/** Linhas que um texto ocupa numa largura com `porLinha` caracteres. Nunca menos que 1. */
export function linhasTexto(texto: string, porLinha: number): number {
  return Math.max(1, Math.ceil(texto.trim().length / porLinha));
}

/**
 * Enche folhas com os blocos, na ordem. Bloco que não cabe vai para a folha seguinte. Um bloco maior que a folha
 * inteira fica sozinho numa folha (não há como dividir sem JS); quem monta o bloco garante que isso não acontece.
 */
export function empacotar(titulo: string, lead: string, blocos: Bloco[]): Pagina[] {
  const cab = (cont: boolean) => `<h2>${pEsc(titulo)}</h2>\n  <p class="lead">${cont ? 'Continuação da folha anterior.' : lead}</p>`;
  const paginas: Pagina[] = [];
  let atual: Bloco[] = [];
  let h = ALTURA_TITULO;
  for (const b of blocos.filter((x) => x.html)) {
    if (atual.length && h + b.h > ALTURA_UTIL) {
      paginas.push({ corpo: `${cab(paginas.length > 0)}\n  ${atual.map((x) => x.html).join('\n  ')}`, h });
      atual = [];
      h = ALTURA_TITULO;
    }
    atual.push(b);
    h += b.h;
  }
  if (atual.length) paginas.push({ corpo: `${cab(paginas.length > 0)}\n  ${atual.map((x) => x.html).join('\n  ')}`, h });
  return paginas;
}

// Imagem que vem do usuário só entra se for uma imagem de verdade. Qualquer outra coisa (aspas, javascript:,
// atributo extra) não renderiza: um `src` cru no HTML guardado viraria script no link público /p/:id.
const DATA_FOTO = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/;
const DATA_LOGO = /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const HTTPS = /^https:\/\/[^\s"'<>`]+$/;

/** Foto do telhado: só data:image png, jpeg ou webp em base64. Devolve o valor (escape na hora de imprimir) ou ''. */
export function fotoSegura(v: string): string {
  const s = String(v || '').trim();
  return DATA_FOTO.test(s) ? s : '';
}

/** Logo da empresa: data:image (inclui SVG, que dentro de <img> não roda script) ou https. O valor, ou ''. */
export function logoSegura(v: string): string {
  const s = String(v || '').trim();
  return DATA_LOGO.test(s) || HTTPS.test(s) ? s : '';
}
