// Catálogo pré-pronto do Inventário. É o que dá o "mínimo de trabalho": o
// consultor escolhe o Local, abre a seta e já vê a lista de materiais típicos
// daquele perfil — com a unidade padrão preenchida. Tudo editável; dá pra criar
// locais e itens fora da lista ("Outro").

export interface MaterialSugerido {
  nome: string;
  unidade: string;
}

export interface LocalCatalogo {
  local: string;
  icone: string;
  materiais: MaterialSugerido[];
}

export const CATALOGO: LocalCatalogo[] = [
  {
    local: 'Escritório',
    icone: '',
    materiais: [
      { nome: 'Mesa', unidade: 'un' },
      { nome: 'Cadeira', unidade: 'un' },
      { nome: 'Ar-condicionado', unidade: 'un' },
      { nome: 'Computador', unidade: 'un' },
      { nome: 'Notebook', unidade: 'un' },
      { nome: 'Monitor', unidade: 'un' },
      { nome: 'Impressora', unidade: 'un' },
      { nome: 'Roteador', unidade: 'un' },
      { nome: 'Nobreak', unidade: 'un' },
      { nome: 'Armário', unidade: 'un' },
      { nome: 'Bebedouro', unidade: 'un' },
      { nome: 'Telefone', unidade: 'un' },
    ],
  },
  {
    local: 'Montagem',
    icone: '',
    materiais: [
      { nome: 'Parafusadeira', unidade: 'un' },
      { nome: 'Furadeira', unidade: 'un' },
      { nome: 'Martelo', unidade: 'un' },
      { nome: 'Lixadeira', unidade: 'un' },
      { nome: 'Esmerilhadeira', unidade: 'un' },
      { nome: 'Alicate', unidade: 'un' },
      { nome: 'Alicate crimpador MC4', unidade: 'un' },
      { nome: 'Jogo de chaves', unidade: 'jogo' },
      { nome: 'Chave inglesa', unidade: 'un' },
      { nome: 'Multímetro', unidade: 'un' },
      { nome: 'Escada', unidade: 'un' },
      { nome: 'Trena', unidade: 'un' },
      { nome: 'Nível a laser', unidade: 'un' },
      { nome: 'Capacete (EPI)', unidade: 'un' },
      { nome: 'Luva (EPI)', unidade: 'par' },
      { nome: 'Cinto de segurança (EPI)', unidade: 'un' },
    ],
  },
  {
    local: 'Depósito',
    icone: '',
    materiais: [
      { nome: 'Cabo solar 6mm', unidade: 'm' },
      { nome: 'Cabo CA', unidade: 'm' },
      { nome: 'Conector MC4', unidade: 'par' },
      { nome: 'Parafuso', unidade: 'un' },
      { nome: 'Disjuntor', unidade: 'un' },
      { nome: 'String box', unidade: 'un' },
      { nome: 'DPS', unidade: 'un' },
      { nome: 'Eletroduto', unidade: 'm' },
      { nome: 'Abraçadeira', unidade: 'un' },
      { nome: 'Fita isolante', unidade: 'un' },
      { nome: 'Terminal', unidade: 'un' },
      { nome: 'Estrutura de fixação', unidade: 'un' },
      { nome: 'Painel solar', unidade: 'un' },
      { nome: 'Inversor', unidade: 'un' },
    ],
  },
  {
    local: 'Veículos / Frota',
    icone: '',
    materiais: [
      { nome: 'Caminhonete', unidade: 'un' },
      { nome: 'Van', unidade: 'un' },
      { nome: 'Moto', unidade: 'un' },
      { nome: 'Carrinho de carga', unidade: 'un' },
    ],
  },
];

// Unidades de medida oferecidas na seta.
export const UNIDADES = ['un', 'm', 'par', 'jogo', 'kg', 'rolo', 'cx', 'L'];

// Marcas comuns (solar + ferramentas) pré-carregadas na seta de marca.
export const MARCAS_COMUNS = [
  'Canadian Solar', 'Trina Solar', 'JA Solar', 'BYD', 'Growatt', 'Deye',
  'Sungrow', 'Fronius', 'WEG', 'Intelbras',
  'DeWalt', 'Bosch', 'Makita', 'Vonder', 'Tramontina', 'Stanley',
];

// Ícone default pra locais criados fora do catálogo.
export const ICONE_LOCAL_CUSTOM = '';
