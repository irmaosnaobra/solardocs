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
 *   sai daqui e vai para "Para liberar".
 * - `liberar`: SEMPRE em "Para liberar". Quem tem o produto (ou é admin) vê o link normal; quem não
 *   tem vê o cadeado e cai onde o produto vende (ver `hrefVendaDoProduto`).
 * - `papelada`: contratos e recibos.
 * - `outros`: os documentos que quase ninguém usa, dobrados.
 * - `loja`: "Ver todos os produtos", que fecha o grupo "Para liberar".
 */
export type GrupoMenu = 'acao' | 'principal' | 'liberar' | 'papelada' | 'outros' | 'loja';

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
  { id: 'manutencao', grupo: 'principal', href: '/manutencao', icon: Wrench, label: 'Manutenção' },
  { id: 'kit-fecha-vendas', grupo: 'principal', href: '/cursos/kit-fechamento', icon: GraduationCap, label: 'Kit Fecha Vendas', produto: 'curso-fechamento' },
  { id: 'limpapro', grupo: 'principal', href: '/lp/limpapro', icon: Sparkles, label: 'LimpaPro', produto: 'curso-limpapro', soBastidor: true },

  // Sempre em "Para liberar", nesta ordem, antes dos outros travados. O Off-Grid leva `produto`
  // desde 30/10/2026 só para ganhar o cadeado. Quem não tem o produto cai na página de venda dele,
  // igual aos outros travados (ver `hrefVendaDoProduto`).
  { id: 'off-grid', grupo: 'liberar', href: '/off-grid', icon: PlugZap, label: 'Kit Off-Grid', produto: 'offgrid', soBastidor: true },
  { id: 'inventario', grupo: 'liberar', href: '/inventario', icon: Boxes, label: 'Inventário', produto: 'inventario' },

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
export const sempreParaLiberarItems = doGrupo('liberar');
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
 * 1. Produto com página de venda própria (`lpPropria`): `/produtos/<slug>`. Hoje essa rota só
 *    repassa para `/lp/<slug>`, que repassa para a página de venda estática do produto, fora do
 *    app (/dimensionamento, /calculadora e /inventario-empresarial). Nelas os botões de compra são
 *    links fixos para a Kiwify, sem o `?email=` que o `checkoutCom` gruda: quem digita outro
 *    e-mail lá vira usuário novo, paga numa conta e entra na outra. Isso já era assim para esses
 *    produtos e vale para o Off-Grid também. No servidor de desenvolvimento essas páginas dão 404,
 *    porque o dev do Next não serve o índice do diretório. No ar, conferido em 30/10/2026, as
 *    três terminam em 200.
 * 2. Sem página própria: a página de venda pública, `/lp/<slug>`, a mesma que o anúncio abre.
 */
export function hrefVendaDoProduto(prod: Pick<ProdutoLoja, 'slug' | 'lpPropria'>): string {
  return prod.lpPropria ? `/produtos/${prod.slug}` : `/lp/${prod.slug}`;
}

export interface EntradaMenu {
  /** Lançamento restrito: só quem está dentro vê o Off-Grid, o LimpaPro e os cadeados. */
  bastidor: boolean;
  /** O servidor ainda não respondeu (e não há prévia no cache). */
  carregando: boolean;
  isAdmin: boolean;
  tem: (produto: string) => boolean;
}

export interface MenuOrganizado {
  /** A lista principal, sem título: o que a pessoa já pode usar. */
  principal: ItemMenu[];
  /** O grupo "Para liberar", na ordem: os dois fixos, depois os outros travados. */
  paraLiberar: ItemMenu[];
  /** "Ver todos os produtos" só aparece quando falta algum produto (algum item do grupo está travado). */
  mostrarLoja: boolean;
  /** O item está atrás de cadeado de produto agora (a /inicio pinta o cadeado a partir disto). */
  travado: (item: ItemMenu) => boolean;
}

/**
 * Quem entra na lista principal e quem entra em "Para liberar". O menu lateral e a /inicio usam esta
 * função, então os dois sempre concordam.
 *
 * SEU / NÃO É SEU: `travado` responde se o item está atrás de cadeado de PRODUTO. Enquanto a
 * resposta do servidor não chega, nada é considerado travado (piscar cadeado na cara de quem pagou
 * vira chamado no suporte na hora) e item com `produto` não aparece em lugar nenhum, nem na lista
 * nem em "Para liberar". Admin vê tudo direto na lista, sem cadeado; em "Para liberar" ele espera
 * como os outros (ver `fixos`). Fora do lançamento restrito, o que é novo não aparece e a
 * ferramenta que já era grátis segue sem cadeado.
 */
export function organizarMenu({ bastidor, carregando, isAdmin, tem }: EntradaMenu): MenuOrganizado {
  const travado = (item: ItemMenu) => !!item.produto && bastidor && !carregando && !isAdmin && !tem(item.produto);
  const aguardandoAcessos = carregando && !isAdmin;
  const visivel = (item: ItemMenu) => bastidor || !item.soBastidor;

  const daLista = principalItems.filter(visivel);
  const principal = daLista.filter((i) => !i.produto || (!aguardandoAcessos && !travado(i)));
  // Os dois fixos esperam o servidor MESMO para o admin. Ele não tem cadeado, mas o Kit Off-Grid só
  // existe para quem está no `bastidor`, e isso só se sabe depois da resposta: desenhar já o
  // Inventário faria o Kit entrar acima dele e empurrá-lo uma linha para baixo quando ela chegasse.
  // Esperando, o grupo aparece inteiro de uma vez.
  const fixos = sempreParaLiberarItems.filter((i) => visivel(i) && (!i.produto || !carregando));
  const paraLiberar = [...fixos, ...daLista.filter(travado)];
  return { principal, paraLiberar, mostrarLoja: paraLiberar.some(travado), travado };
}
