/**
 * KIT INICIAL — o inventário de exemplo
 *
 * Tela de inventário vazia não ensina nada: a pessoa vê quatro caixas em branco
 * e uma lista suspensa, e não sabe o que a ferramenta faz. Isto aqui preenche
 * um inventário PLAUSÍVEL num toque, pra ela ver a coisa montada — com marca,
 * quantidade, valor e estoque mínimo preenchidos, que é justamente a parte que
 * ninguém adivinha sozinho.
 *
 * Três decisões:
 *
 * 1. SÓ O QUE TODA EQUIPE TEM. Ferramenta de montagem, consumível de obra e o
 *    básico de escritório. Veículo ficou de FORA de propósito: caminhonete não
 *    é universal e um item de R$ 90 mil inflaria o "patrimônio total" de quem
 *    não reparasse — o número na tela precisa ser confiável desde o primeiro
 *    minuto.
 * 2. VALORES DE PARTIDA, não verdades. São preços de mercado plausíveis; a
 *    pessoa ajusta. O botão diz isso e a tela repete.
 * 3. NADA AUTOMÁTICO. Ninguém acorda com 14 itens que não cadastrou. O kit só
 *    entra se a pessoa clicar, e cada linha sai com o botão de lixeira que já
 *    está ali do lado.
 * 4. UM ITEM VERMELHO, NÃO SETE. A primeira versão punha o mínimo igual à
 *    quantidade em ferramenta e EPI, e o exemplo nascia com 7 de 14 itens em
 *    alerta — quem abrisse acharia que veio quebrado. Agora só o Conector MC4
 *    entra abaixo do mínimo, pra mostrar o que o aviso é.
 */
export interface ItemKit {
  local: string;
  nome: string;
  marca: string;
  unidade: string;
  quantidade: number;
  valor_unitario: number;
  estoque_minimo: number;
}

export const KIT_INICIAL: ItemKit[] = [
  // ── Montagem: ferramenta é PATRIMÔNIO, não consumível ──
  // Mínimo 0 de propósito: ferramenta não "acaba", então não faz sentido a
  // plataforma pedir reposição de furadeira. Mínimo é pra o que se gasta.
  { local: 'Montagem', nome: 'Parafusadeira', marca: 'Makita', unidade: 'un', quantidade: 2, valor_unitario: 650, estoque_minimo: 0 },
  { local: 'Montagem', nome: 'Furadeira', marca: 'Bosch', unidade: 'un', quantidade: 1, valor_unitario: 480, estoque_minimo: 0 },
  { local: 'Montagem', nome: 'Alicate crimpador MC4', marca: 'Staubli', unidade: 'un', quantidade: 2, valor_unitario: 120, estoque_minimo: 0 },
  { local: 'Montagem', nome: 'Multímetro', marca: 'Minipa', unidade: 'un', quantidade: 1, valor_unitario: 220, estoque_minimo: 0 },
  { local: 'Montagem', nome: 'Escada', marca: '', unidade: 'un', quantidade: 1, valor_unitario: 900, estoque_minimo: 0 },
  // EPI se perde e se troca: aqui o mínimo vale, com folga.
  { local: 'Montagem', nome: 'Capacete (EPI)', marca: '', unidade: 'un', quantidade: 4, valor_unitario: 45, estoque_minimo: 2 },
  { local: 'Montagem', nome: 'Luva (EPI)', marca: '', unidade: 'par', quantidade: 4, valor_unitario: 28, estoque_minimo: 2 },
  { local: 'Montagem', nome: 'Cinto de segurança (EPI)', marca: '', unidade: 'un', quantidade: 2, valor_unitario: 380, estoque_minimo: 1 },

  // ── Depósito: o que acaba no meio da obra ──
  { local: 'Depósito', nome: 'Cabo solar 6mm', marca: 'Nexans', unidade: 'm', quantidade: 200, valor_unitario: 8.4, estoque_minimo: 100 },
  // ESTE ENTRA ABAIXO DO MÍNIMO DE PROPÓSITO. Um item vermelho ensina o que o
  // alerta é; sete itens vermelhos fazem a pessoa achar que o exemplo veio
  // quebrado. É o único que nasce pedindo reposição.
  { local: 'Depósito', nome: 'Conector MC4', marca: 'Staubli', unidade: 'par', quantidade: 12, valor_unitario: 22.9, estoque_minimo: 20 },
  { local: 'Depósito', nome: 'Abraçadeira', marca: '', unidade: 'un', quantidade: 200, valor_unitario: 0.35, estoque_minimo: 100 },
  { local: 'Depósito', nome: 'Fita isolante', marca: '3M', unidade: 'un', quantidade: 10, valor_unitario: 9.9, estoque_minimo: 5 },
  { local: 'Depósito', nome: 'Estrutura de fixação', marca: '', unidade: 'un', quantidade: 20, valor_unitario: 48, estoque_minimo: 10 },

  // ── Escritório ──
  { local: 'Escritório', nome: 'Notebook', marca: '', unidade: 'un', quantidade: 1, valor_unitario: 3500, estoque_minimo: 0 },
];

/** Passos do tutorial. Curtos de propósito: tela de trabalho não é manual. */
export const PASSOS_USO: { titulo: string; texto: string }[] = [
  {
    titulo: 'Escolha o local e o material',
    texto: 'Cada caixa é um lugar da sua operação. Abra "Adicionar material" e a lista já vem pronta com o que costuma ter ali — ou digite um item que não está na lista.',
  },
  {
    titulo: 'Preencha marca, quantidade e valor',
    texto: 'O valor é o que você pagou por unidade. O patrimônio total lá em cima soma tudo sozinho, e é esse número que serve pro contador e pro seguro.',
  },
  {
    titulo: 'Estoque mínimo é o que avisa',
    texto: 'Diga o mínimo que não pode faltar. Quando a quantidade encostar nele, a linha fica vermelha e aparece o aviso no topo — antes de você descobrir na obra.',
  },
  {
    titulo: 'Entrada e saída, não digitação',
    texto: 'As duas setas ao lado de cada item lançam movimento: chegou material, seta pra baixo; saiu pra obra, seta pra cima. Corrigir o número na mão apaga a história do item.',
  },
  {
    titulo: 'Imprimir vira documento',
    texto: 'O botão Imprimir gera um PDF com tudo separado por local e os totais — é o que você manda pra contabilidade ou anexa numa apólice.',
  },
];
