/**
 * AS DEFINIÇÕES DO MENU, NUM LUGAR SÓ.
 *
 * O menu lateral (Sidebar) e a tela de atalhos do celular (/inicio) mostram os mesmos itens, com
 * os mesmos nomes e as mesmas condições. Quando cada um tinha a sua lista, os dois divergiam (o
 * /inicio seguiu com "Cadastro Terceiro" depois de o menu tirar). Agora os dois leem daqui.
 *
 * Aqui mora DADO e uma função pura (`organizarMenu`). Como cada tela desenha é problema dela: o
 * menu lateral não pega a cor do integrador, o /inicio pega.
 *
 * Ordem decidida em 29/10/2026 pelo uso medido em 30 dias: proposta 866 documentos; Escanear
 * conta 583 usos de 20 pessoas; Clientes 159 cadastros de 33 pessoas; Contrato 51 de 16;
 * Procuração 36 de 10; Recibo 28 de 6; Proposta de Banco 5 de 1; Prestação de Serviço e Contrato
 * Vendedor 8 em 90 dias; Terceiros 0 cadastros. Por isso: proposta e conta de luz viram botões no
 * topo, o que se usa todo dia vem logo abaixo, e o que quase ninguém usa fica dobrado.
 */

import {
  Plus, ScanLine, Users, FolderOpen, ClipboardCheck, Calculator, PlugZap, Boxes, Wrench,
  GraduationCap, Sparkles, LayoutGrid, Zap, FileSignature, ScrollText, Receipt, Banknote, Briefcase,
  type LucideIcon,
} from 'lucide-react';
import type { ProdutoLoja } from '@/lib/produtos';

/**
 * Onde o item mora:
 * - `acao`: os dois botões do topo.
 * - `principal`: a lista sem título, na ordem do uso. Item com `produto` que a pessoa ainda não tem
 *   sai daqui e vai para "Para liberar". Item `fixoNoLiberar` também sai daqui, mas só com a loja
 *   aberta (ver `organizarMenu`).
 * - `papelada`: contratos e recibos.
 * - `outros`: os documentos que quase ninguém usa, dobrados.
 * - `loja`: "Ver todos os produtos", que fecha o grupo "Para liberar".
 */
export type GrupoMenu = 'acao' | 'principal' | 'papelada' | 'outros' | 'loja';

export interface ItemMenu {
  id: string;
  href: string;
  icon: LucideIcon;
  label: string;
  grupo: GrupoMenu;
  /** Sem empresa cadastrada (CNPJ), o item fica cinza e sem link. Admin passa. */
  requireCompany?: boolean;
  /**
   * id do produto no catálogo (`produtoPorId`, o mesmo que `/produtos/acessos` devolve em
   * `produtos`). Quem não tem vê cadeado e o clique leva para onde o produto vende
   * (`hrefVendaDoProduto`), nunca para um beco. Quem tem vê o item normal, sem nada em volta.
   */
  produto?: string;
  /** Só aparece para quem está no lançamento restrito (`bastidor`); para a base, a novidade não existe. */
  soBastidor?: boolean;
  /**
   * Com a loja aberta para a conta (`bastidor`), o item fica SEMPRE em "Para liberar", na ordem de
   * `ORDEM_PARA_LIBERAR` e misturado com os outros travados: link normal para quem tem o produto (ou
   * é admin), cadeado para quem não tem. Com a loja fechada (inclusive quando `/produtos/acessos`
   * falha) ele fica na lista principal, onde estava, sem cadeado, e "Para liberar" some se esvaziar.
   * Só faz sentido junto de `produto`.
   */
  fixoNoLiberar?: boolean;
  /** Selo ao lado do nome (ex.: "Novo"). */
  badge?: string;
  /**
   * Destino fora do Next (página estática): navegação de página inteira com <a> comum, na mesma
   * aba. <Link> tentaria resolver como rota do app.
   */
  paginaInteira?: boolean;
}

export const ITENS_MENU: ItemMenu[] = [
  // Os dois botões do topo. Sem empresa ficam cinza e sem link (o gerador exige CNPJ). A conta de
  // luz segue a mesma regra: a tela dela não checa empresa, mas o painel manda quem não tem CNPJ
  // para /empresa, e ela cria cliente, que também exige empresa.
  { id: 'nova-proposta', grupo: 'acao', href: '/documentos?tipo=proposta', icon: Plus, label: 'Nova proposta', requireCompany: true },
  { id: 'ler-conta', grupo: 'acao', href: '/escanear-conta', icon: ScanLine, label: 'Ler conta de luz', requireCompany: true },

  // Lista principal, sem título, na ordem do uso. Item com `produto` travado sai daqui e vai para
  // "Para liberar" (ver `organizarMenu`).
  { id: 'clientes', grupo: 'principal', href: '/clientes', icon: Users, label: 'Clientes', requireCompany: true },
  // Todo documento gerado fica na nuvem para qualquer plano: sem cadeado e sem exigir empresa.
  { id: 'arquivos', grupo: 'principal', href: '/historico', icon: FolderOpen, label: 'Arquivos' },
  { id: 'vistoria', grupo: 'principal', href: '/vistoria', icon: ClipboardCheck, label: 'Vistoria' },
  { id: 'precificacao', grupo: 'principal', href: '/precificacao', icon: Calculator, label: 'Precificação', produto: 'precificacao' },
  // Kit Off-Grid, Inventário, Kit Fecha Vendas e LimpaPro: com a loja aberta ficam SEMPRE em "Para
  // liberar", na ordem de `ORDEM_PARA_LIBERAR` (não é a desta lista: aqui a Precificação vem antes
  // do Off-Grid, lá vem depois do Inventário). Com a loja fechada o Inventário e o Kit Fecha Vendas
  // ficam aqui, nas posições que tinham na lista de 29/10, e o Kit Off-Grid e o LimpaPro somem
  // (`soBastidor`). O Off-Grid leva `produto` só para ganhar o cadeado: quem não tem cai em
  // /off-grid, a própria ferramenta (ver `hrefVendaDoProduto`).
  { id: 'off-grid', grupo: 'principal', href: '/off-grid', icon: PlugZap, label: 'Kit Off-Grid', produto: 'offgrid', soBastidor: true, fixoNoLiberar: true },
  { id: 'inventario', grupo: 'principal', href: '/inventario', icon: Boxes, label: 'Inventário', produto: 'inventario', fixoNoLiberar: true },
  { id: 'manutencao', grupo: 'principal', href: '/manutencao', icon: Wrench, label: 'Manutenção' },
  // Também fixos em "Para liberar" (ver o bloco acima).
  { id: 'kit-fecha-vendas', grupo: 'principal', href: '/cursos/kit-fechamento', icon: GraduationCap, label: 'Kit Fecha Vendas', produto: 'curso-fechamento', fixoNoLiberar: true },
  { id: 'limpapro', grupo: 'principal', href: '/lp/limpapro', icon: Sparkles, label: 'LimpaPro', produto: 'curso-limpapro', soBastidor: true, fixoNoLiberar: true },

  // A loja fecha o grupo "Para liberar": é "ver todos os que faltam", não uma ferramenta.
  { id: 'loja', grupo: 'loja', href: '/produtos', icon: LayoutGrid, label: 'Ver todos os produtos' },

  // Papelada: telas navegáveis pra free, MAS o backend só deixa o free GERAR propostaSolar (os
  // outros tipos retornam 402 "faça upgrade"). O gate é no generate, não na navegação.
  { id: 'contrato-solar', grupo: 'papelada', href: '/documentos?tipo=contrato-solar', icon: FileSignature, label: 'Contrato Solar', requireCompany: true },
  { id: 'procuracao', grupo: 'papelada', href: '/documentos?tipo=procuracao', icon: ScrollText, label: 'Procuração', requireCompany: true },
  { id: 'recibo', grupo: 'papelada', href: '/documentos?tipo=recibo', icon: Receipt, label: 'Recibo', requireCompany: true },

  // Dobrados: 5 de 1 pessoa, e 8 em 90 dias.
  { id: 'proposta-bancaria', grupo: 'outros', href: '/documentos?tipo=proposta-bancaria', icon: Banknote, label: 'Proposta de Banco', requireCompany: true },
  { id: 'prestacao-servico', grupo: 'outros', href: '/documentos?tipo=prestacao-servico', icon: Wrench, label: 'Prestação de Serviço', requireCompany: true },
  { id: 'contrato-pj', grupo: 'outros', href: '/documentos?tipo=contrato-pj', icon: Briefcase, label: 'Contrato Vendedor', requireCompany: true },
];

const doGrupo = (g: GrupoMenu) => ITENS_MENU.filter((i) => i.grupo === g);

export const novaPropostaItem = ITENS_MENU.find((i) => i.id === 'nova-proposta') as ItemMenu;
export const lerContaItem = ITENS_MENU.find((i) => i.id === 'ler-conta') as ItemMenu;
export const principalItems = doGrupo('principal');
export const lojaItem = ITENS_MENU.find((i) => i.id === 'loja') as ItemMenu;
export const papeladaItems = doGrupo('papelada');
export const outrosDocsItems = doGrupo('outros');

// Portal do Parceiro NEXUS: página estática em /nexus/app, fora do Next. Fica FORA de ITENS_MENU
// porque só entra quando o portal responde ligado (ver useNexusPortal); vem depois da lista principal.
export const nexusItem: ItemMenu = {
  id: 'nexus', grupo: 'principal', href: '/nexus/app?o=solardoc', icon: Zap, label: 'Parceiro NEXUS', badge: 'Novo', paginaInteira: true,
};

/**
 * Para onde o cadeado de um produto leva. Sempre para onde ele vende, nunca para um beco.
 *
 * 1. Ferramenta aberta de propósito (`experimentar`, hoje só o Kit Off-Grid): a própria ferramenta.
 *    Dimensionar e ver a autonomia é de graça lá dentro, o preço fica trancado e o botão "Liberar
 *    meu acesso" monta o checkout com o `?email=` da conta. A página de venda estática dele
 *    (/dimensionamento) tem os links da Kiwify sem o `?email=`: quem paga lá com outro e-mail cria
 *    uma conta duplicada.
 * 2. Produto com página de venda própria (`lpPropria`): `/produtos/<slug>`. Hoje essa rota só
 *    repassa para `/lp/<slug>`, que repassa para a página de venda estática do produto, fora do
 *    app (/calculadora e /inventario-empresarial). Os botões de compra delas também são links
 *    fixos para a Kiwify, sem o `?email=`; isso já era assim para esses produtos e não muda aqui.
 *    No servidor de desenvolvimento essas páginas dão 404, porque o dev do Next não serve o índice
 *    do diretório. No ar, conferido em 30/10/2026, terminam em 200.
 * 3. Sem página própria: a página de venda pública, `/lp/<slug>`, a mesma que o anúncio abre.
 */
export function hrefVendaDoProduto(prod: Pick<ProdutoLoja, 'slug' | 'lpPropria' | 'experimentar'>): string {
  if (prod.experimentar) return prod.experimentar.rota;
  return prod.lpPropria ? `/produtos/${prod.slug}` : `/lp/${prod.slug}`;
}

export interface EntradaMenu {
  /**
   * Loja aberta para a conta. Aberta (o padrão em produção): o Off-Grid, o LimpaPro e os cadeados
   * existem e Off-Grid, Inventário, Kit Fecha Vendas e LimpaPro ficam sempre em "Para liberar".
   * Fechada (inclusive quando `/produtos/acessos` falha): sem cadeado, sem Off-Grid e sem LimpaPro, e
   * o Inventário e o Kit Fecha Vendas voltam para a lista principal.
   */
  bastidor: boolean;
  /** O servidor ainda não respondeu (e não há prévia no cache). */
  carregando: boolean;
  isAdmin: boolean;
  tem: (produto: string) => boolean;
}

export interface MenuOrganizado {
  /** A lista principal, sem título: o que a pessoa já pode usar. */
  principal: ItemMenu[];
  /** O grupo "Para liberar", numa ordem só (`ORDEM_PARA_LIBERAR`): os fixos (só com a loja aberta) e os outros travados, misturados. Vazio, o grupo some. */
  paraLiberar: ItemMenu[];
  /** "Ver todos os produtos" só aparece quando falta algum produto (algum item do grupo está travado). */
  mostrarLoja: boolean;
  /** O item está atrás de cadeado de produto agora (a /inicio pinta o cadeado a partir disto). */
  travado: (item: ItemMenu) => boolean;
}

/**
 * A ordem dentro de "Para liberar", uma só para os fixos e para os outros travados: Kit Off-Grid,
 * Inventário, Precificação (só quando travada), Kit Fecha Vendas e LimpaPro. Não é a ordem da lista
 * principal: em ITENS_MENU a Precificação vem antes do Off-Grid e do Inventário, e é lá que ela
 * fica quando a pessoa já tem o produto ou a loja está fechada. Item que entrar no grupo sem estar
 * aqui vai para o fim, na ordem de ITENS_MENU. "Ver todos os produtos" fica depois de todos.
 */
const ORDEM_PARA_LIBERAR: readonly string[] = ['off-grid', 'inventario', 'precificacao', 'kit-fecha-vendas', 'limpapro'];

/**
 * Quem entra na lista principal e quem entra em "Para liberar". O menu lateral e a /inicio usam esta
 * função, então os dois sempre concordam.
 *
 * SEU / NÃO É SEU: `travado` responde se o item está atrás de cadeado de PRODUTO. Enquanto a
 * resposta do servidor não chega, nada é considerado travado (piscar cadeado na cara de quem pagou
 * vira chamado no suporte na hora) e item com `produto` não aparece em lugar nenhum, nem na lista
 * nem em "Para liberar". Admin nunca tem cadeado: vê os itens de produto na lista e os
 * `fixoNoLiberar` em "Para liberar", e estes ele espera como os outros (ver `espera`). Fora do
 * lançamento restrito, o que é novo não aparece e a ferramenta que já era grátis segue sem cadeado.
 *
 * ORDEM DE "PARA LIBERAR": uma só, a de `ORDEM_PARA_LIBERAR`, para os fixos (com ou sem cadeado) e
 * para os outros travados. "Ver todos os produtos" vem depois de todos, e só quando algum item do
 * grupo está travado (`mostrarLoja`).
 *
 * LOJA FECHADA (`bastidor` falso, inclusive quando o servidor falha): nenhum item é `fixoNoLiberar`
 * nem travado, então o Inventário e o Kit Fecha Vendas voltam para a lista principal, nas posições
 * de sempre, sem cadeado, o Kit Off-Grid e o LimpaPro somem (`soBastidor`) e "Para liberar" some se
 * não sobrar item.
 *
 * QUEM É ADMIN: `isAdmin` chega pronto, e cada tela decide de onde ele vem. A /inicio soma as duas
 * fontes, o `is_admin` do /auth/me e o do /produtos/acessos (se uma das duas chamadas falhar, a outra
 * ainda livra o admin do cadeado). O menu lateral usa só o /auth/me (o `user` que o layout passa à
 * Sidebar): o `useAcessos` dele fornece `tem`, `bastidor` e `carregando`, nunca o admin.
 */
export function organizarMenu({ bastidor, carregando, isAdmin, tem }: EntradaMenu): MenuOrganizado {
  const travado = (item: ItemMenu) => !!item.produto && bastidor && !carregando && !isAdmin && !tem(item.produto);
  const aguardandoAcessos = carregando && !isAdmin;
  const visivel = (item: ItemMenu) => bastidor || !item.soBastidor;
  // Com a loja aberta, os fixos saem da lista principal e ficam em "Para liberar".
  const fixo = (item: ItemMenu) => bastidor && !!item.fixoNoLiberar;
  // Quem ainda não pode ser desenhado. Os fixos esperam o servidor MESMO para o admin: ele não tem
  // cadeado, mas o Kit Off-Grid e o LimpaPro só existem para quem está no `bastidor`, e o Inventário
  // e o Kit Fecha Vendas só sabem se ficam na lista ou em "Para liberar" depois da resposta. Desenhar
  // já um deles o faria pular de lugar (ou um que chega depois entraria acima e empurraria os outros
  // uma linha para baixo). Esperando, tudo aparece de uma vez.
  const espera = (item: ItemMenu) => (!!item.produto && aguardandoAcessos) || (!!item.fixoNoLiberar && carregando);
  // O lugar do item em "Para liberar". Quem não está em ORDEM_PARA_LIBERAR vai para o fim.
  const posicao = (item: ItemMenu) => {
    const i = ORDEM_PARA_LIBERAR.indexOf(item.id);
    return i < 0 ? ORDEM_PARA_LIBERAR.length : i;
  };

  const daLista = principalItems.filter(visivel);
  const principal = daLista.filter((i) => !fixo(i) && !espera(i) && !travado(i));
  // Os fixos que já podem ser desenhados e os outros travados, numa ordem só. O sort é estável: o que
  // empata (fora de ORDEM_PARA_LIBERAR) fica na ordem de ITENS_MENU.
  const paraLiberar = daLista
    .filter((i) => (fixo(i) ? !espera(i) : travado(i)))
    .sort((a, b) => posicao(a) - posicao(b));
  return { principal, paraLiberar, mostrarLoja: paraLiberar.some(travado), travado };
}
