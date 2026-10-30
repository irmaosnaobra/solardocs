import { esc } from '../relatorio/base';
import { juntarLista } from './avaliacao';
import type { DadosRelatorio, GrupoRelatorio, LinhaRelatorio } from './compras';

// ─────────────────────────────────────────────────────────────────────────────
// Seção "Materiais e providências" do relatório da vistoria (tela e PDF).
// Uma função só monta os dois modos: a tabela é a mesma, e a tela só ganha o link de âncora na navegação do topo
// (isso é do htmlRelatorio.ts). Sem caixa de "comprado", sem preço, sem coluna de total.
// Este arquivo é PURO: só importa esc (relatorio/base), juntarLista (avaliacao) e tipos. NÃO importa o
// htmlRelatorio.ts (ele é quem chama este aqui), para não criar import circular.
// As linhas já chegam saneadas (compras.ts). Mesmo assim todo texto passa por t(): sem emoji, travessão vira
// hífen e o resto é escapado, porque o PDF não tem fonte de emoji e os testes varrem o HTML inteiro.
// ─────────────────────────────────────────────────────────────────────────────

export type ModoCompras = 'tela' | 'pdf';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Texto vindo de gente: sem emoji, com o travessão virando hífen. O espaço sem quebra (U+00A0) da quantidade fica. */
const limpo = (s: unknown): string => String(s ?? '').replace(/[\u2013\u2014]/g, '-').replace(EMOJI, '');

/** Limpa e escapa & < > " ' (o apóstrofo vira &#39;). */
const t = (s: unknown): string => esc(limpo(s));

// Textos do relatório (seção 9.2 do plano). Nada de preço, marca de fabricante ou nome de loja.
const TEXTOS = {
  titulo: 'Materiais e providências',
  abertura: 'Esta lista reúne o que precisa ser comprado ou resolvido para a instalação.',
  aberturaNotas: 'Esta lista traz apenas anotações.',
  colunaItem: 'Item',
  colunaQuantidade: 'Quantidade',
  colunaMotivo: 'Motivo',
  prazoAlta: 'Antes de instalar',
  prazoMedia: 'Antes ou durante a instalação',
  servico: 'Serviço',
  aDefinir: 'A definir',
  origem: 'Item da vistoria:',
  nota: 'Nota:',
  anotacoes: 'Anotações',
  naLista: 'Na lista:',
  aviso: 'As quantidades e as especificações são de referência. Confirme com o projeto e com a norma da distribuidora de energia antes de comprar.',
} as const;

/** "1 item" ou "N itens". */
const contagemItens = (n: number): string => `${n} ${n === 1 ? 'item' : 'itens'}`;

const chipPrazo = (prazo: 'alta' | 'media'): string =>
  `<span class="chip p-${prazo}">${t(prazo === 'alta' ? TEXTOS.prazoAlta : TEXTOS.prazoMedia)}</span>`;

// ── Pedaços da seção ────────────────────────────────────────────────────────

/** Legenda dos prazos com a contagem. Só existe se alguma linha tem prazo; cada metade só se a contagem passa de zero. */
function legendaPrazo(p: DadosRelatorio['prazos']): string {
  if (!(p.alta + p.media > 0)) return '';
  const partes: string[] = [];
  if (p.alta > 0) partes.push(`${chipPrazo('alta')} ${contagemItens(p.alta)}`);
  if (p.media > 0) partes.push(`${chipPrazo('media')} ${contagemItens(p.media)}`);
  return `<p class="legenda-prazo">${partes.join(' ')}</p>`;
}

function linhaTabela(l: LinhaRelatorio): string {
  const esp = l.esp ? `<span class="esp">${t(l.esp)}</span>` : '';
  const nota = l.nota ? `<span class="nota">${t(TEXTOS.nota)} ${t(l.nota)}</span>` : '';
  const quantidade = l.servico
    ? `<span class="chip s-na">${t(TEXTOS.servico)}</span>`
    : (l.aDefinir ? t(TEXTOS.aDefinir) : t(l.qtdTexto));
  const origem = l.itemRotulo ? `<span class="orig">${t(TEXTOS.origem)} ${t(l.itemRotulo)}</span>` : '';
  const motivo = `${l.prazo ? chipPrazo(l.prazo) : ''}${origem}` || '&nbsp;';
  return `<tr${l.prazo ? ` class="${l.prazo}"` : ''}><td data-r="${TEXTOS.colunaItem}"><b>${t(l.nome)}</b>${esp}${nota}</td>`
    + `<td class="q" data-r="${TEXTOS.colunaQuantidade}">${quantidade}</td>`
    + `<td data-r="${TEXTOS.colunaMotivo}">${motivo}</td></tr>`;
}

function blocoGrupo(g: GrupoRelatorio): string {
  return `<div class="grupo-compras"><h3>${t(g.titulo)} <span class="n">${contagemItens(g.linhas.length)}</span></h3>`
    + `<p class="apoio">${t(g.apoio)}</p>`
    + `<table class="cmp"><thead><tr><th>${TEXTOS.colunaItem}</th><th>${TEXTOS.colunaQuantidade}</th><th>${TEXTOS.colunaMotivo}</th></tr></thead>`
    + `<tbody>${g.linhas.map(linhaTabela).join('')}</tbody></table></div>`;
}

/** Anotações livres, na ordem gravada, com o rótulo do item em negrito quando a nota está ligada a um. */
function blocoNotas(notas: DadosRelatorio['notas']): string {
  if (notas.length === 0) return '';
  const itens = notas.map((n) => `<li>${n.itemRotulo ? `<b>${t(n.itemRotulo)}:</b> ` : ''}${t(n.texto)}</li>`).join('');
  return `<div class="notas-compras"><h3>${t(TEXTOS.anotacoes)}</h3><ul>${itens}</ul></div>`;
}

/**
 * A seção inteira. Quem chama só a usa com lista visível: sem lista, a seção some (nada de "nenhuma compra").
 * Com só anotações não há grupos nem legenda de prazo.
 */
export function secaoCompras(dados: DadosRelatorio, _modo: ModoCompras = 'tela'): string {
  const grupos = dados.soNotas ? '' : dados.grupos.map(blocoGrupo).join('');
  return `<section class="sec" id="compras" aria-labelledby="h-compras">`
    + `<h2 class="sec" id="h-compras">${t(TEXTOS.titulo)}</h2>`
    + `<p class="intro">${t(dados.soNotas ? TEXTOS.aberturaNotas : TEXTOS.abertura)}</p>`
    + (dados.resumo ? `<p class="resumo-compras">${t(dados.resumo)}</p>` : '')
    + (dados.soNotas ? '' : legendaPrazo(dados.prazos))
    + grupos
    + blocoNotas(dados.notas)
    + `<p class="aviso-ref">${t(TEXTOS.aviso)}</p>`
    + `</section>`;
}

// ── "Na lista:" no cartão de pendência ──────────────────────────────────────

/**
 * Nomes dos materiais ligados a um item, em frase. Até 3 nomes: todos ("A", "A e B", "A, B e C"). Mais de 3:
 * os dois primeiros e "mais N" ("A, B e mais 2" para 4 nomes). Sem ponto final.
 */
export function fraseNaLista(nomes: readonly string[]): string {
  const lista = nomes.filter((n) => typeof n === 'string' && n.trim() !== '');
  if (lista.length === 0) return '';
  if (lista.length <= 3) return juntarLista(lista);
  return juntarLista([lista[0]!, lista[1]!, `mais ${lista.length - 2}`]);
}

/** `<p class="nalista">Na lista: A, B e mais 2.</p>`, ou '' quando o item não tem material ligado. */
export function paragrafoNaLista(nomes: readonly string[] | undefined): string {
  const frase = nomes ? fraseNaLista(nomes) : '';
  if (!frase) return '';
  return `<p class="nalista">${t(TEXTOS.naLista)} ${t(frase)}${/[.!?]$/.test(frase) ? '' : '.'}</p>`;
}

// ── CSS ─────────────────────────────────────────────────────────────────────

// Só variáveis do tema que já existem (--fg --mut --sub --ln --bd --card --sc-nao_conforme --sc-atencao).
// `.pen .nalista` (e não só `.nalista`) para vencer `.pen p`, como o `.pen .pref`. A abertura, o resumo e a
// legenda não ficam sozinhos no pé da página: seguem junto do primeiro grupo (break-after). No celular a tabela
// vira cartões: a faixa colorida passa da primeira célula para a borda do cartão, para os textos ficarem
// alinhados, e a célula do motivo vazia (sem item e sem prazo) some em vez de mostrar só o rótulo.
export const CSS_COMPRAS = `
.intro{margin:0 0 6px;max-width:74ch;break-after:avoid;page-break-after:avoid}
.resumo-compras{margin:0 0 8px;font-weight:600;break-after:avoid;page-break-after:avoid}
.legenda-prazo{margin:0 0 10px;font-size:13px;color:var(--sub);text-wrap:balance;break-after:avoid;page-break-after:avoid}
.grupo-compras{margin-top:14px}
.grupo-compras h3{margin:0 0 4px;font-size:15px;break-after:avoid;page-break-after:avoid}
.grupo-compras h3 .n{margin-left:8px;font-size:12px;font-weight:600;color:var(--mut)}
.grupo-compras .apoio{margin:0 0 6px;font-size:13px;color:var(--mut);break-after:avoid;page-break-after:avoid}
.cmp{width:100%;border-collapse:collapse;font-size:13px}
.cmp thead{display:table-header-group}
.cmp th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;text-align:left;color:var(--mut);border-bottom:1.5px solid var(--bd);padding:5px 8px}
.cmp th:nth-child(2){text-align:right}
.cmp td{padding:7px 8px;border-bottom:1px solid var(--ln);vertical-align:top;overflow-wrap:anywhere}
.cmp tr{break-inside:avoid;page-break-inside:avoid}
.cmp td:first-child{border-left:4px solid transparent}
.cmp tr.alta td:first-child{border-left-color:var(--sc-nao_conforme)}
.cmp tr.media td:first-child{border-left-color:var(--sc-atencao)}
.cmp td.q{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;width:1%}
.cmp .esp,.cmp .nota,.cmp .orig{display:block;font-size:12px;color:var(--mut)}
.cmp .nota{color:var(--sub)}
.cmp .orig{margin-top:3px}
.notas-compras{margin-top:14px;break-inside:avoid;page-break-inside:avoid}
.notas-compras ul{margin:4px 0 0;padding-left:18px}
.aviso-ref{margin:14px 0 0;font-size:12px;color:var(--mut);max-width:74ch}
.pen .nalista{margin:4px 0 0;font-size:12px;color:var(--mut)}
@media (max-width:640px){
  .cmp thead{display:none}
  .cmp,.cmp tbody,.cmp tr,.cmp td{display:block;width:100%}
  .cmp tr{border:1px solid var(--bd);border-radius:8px;margin:8px 0;padding:6px 8px}
  .cmp td{border:0;padding:3px 0}
  .cmp td:first-child{border-left:0}
  .cmp tr.alta{border-left:4px solid var(--sc-nao_conforme)}
  .cmp tr.media{border-left:4px solid var(--sc-atencao)}
  .cmp td::before{content:attr(data-r);display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
  .cmp td.q{text-align:left;width:auto}
  .cmp td[data-r="Motivo"]:not(:has(*)){display:none}
}
`;
