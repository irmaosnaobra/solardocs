// Lista de compras da vistoria: todos os textos da tela do técnico (seção 9.1 do plano).
//
// SEM imports. O que está entre chaves é substituído por quem desenha: {n} número, {nome} nome do material,
// {texto} o que o técnico digitou, {Item} e {Status} os rótulos do item e do status, {lista} nomes de itens.
//
// Chave com sufixo Plural é a forma para n diferente de 1. A chave sem sufixo traz o singular, com uma
// exceção que vem do plano: vazioComSugestoes é o plural e vazioComSugestao é o singular.
//
// Regras de escrita: frase curta, maiúscula no começo, sem travessão e sem emoji. As frases que o
// comprasPuro.ts escreve sozinho (amiantoObs, fora, incluiCombinar, naoIncluiCombinar e faltaQtdN) estão aqui
// também, e o teste vistoriaComprasDashboard prova que as duas pontas dizem a mesma coisa.

export const TEXTOS_COMPRAS = {
  // Seção
  titulo: 'Lista de compras',
  apoioPublica: 'Anote o que precisa comprar ou providenciar. Quem abrir o link ou o PDF vê esta lista. Ela não traz preços.',
  apoioPrivada: 'Anote o que precisa comprar ou providenciar. Esta lista fica só aqui no app.',
  interruptor: 'Mostrar no relatório do cliente',
  pilula: 'Compras {n}',
  pilulaAria: 'Ir para a lista de compras. {n} linhas.',

  // Estado da gravação
  salvo: 'Salvo.',
  salvando: 'Salvando.',
  semRede: 'Sem conexão. A lista segue nesta tela e será enviada quando a conexão voltar.',
  semRedeAviso: 'Não feche esta tela antes de aparecer Salvo.',
  redeVoltou: 'Conexão de volta. Enviando.',
  erroSalvar: 'Não consegui salvar a lista. Ela segue nesta tela. Tente de novo em instantes.',
  erroConcluir: 'Antes de concluir: a lista de compras não foi enviada. Ela segue nesta tela. Conclua quando a conexão voltar.',
  conflito: 'Esta vistoria foi concluída em outro aparelho. Reabra para editar a lista.',
  liberando: 'A lista de compras está sendo liberada.',

  // Lista vazia e sugestões
  vazioTitulo: 'Nada na lista ainda.',
  vazioDica: 'Marque Atenção ou Não conforme nos itens acima e as sugestões aparecem aqui.',
  vazioComSugestoes: 'Há {n} sugestões pelos itens marcados.',
  vazioComSugestao: 'Há 1 sugestão pelos itens marcados.',
  sugeridosTitulo: 'Sugeridos pelos itens marcados',
  verTodas: 'Ver todas ({n})',
  dispensar: 'Dispensar',
  dispensarAria: 'Dispensar a sugestão {nome}',

  // Lista e botões
  naLista: 'Na lista ({n})',
  resumoLista: '{m} materiais, {s} serviços e {o} observações.',
  btnAdicionar: 'Adicionar material',
  btnObservacao: 'Anotar observação',
  btnWhatsapp: 'Copiar para o WhatsApp',
  dicaSemMaterial: 'Adicione um material para gerar o texto.',
  limite: 'A lista chegou a 60 linhas. Apague alguma para continuar.',

  // Faixa por item
  faixaSo: 'Sugestões de compra: {n}',
  faixaAmbas: 'Na lista: {a}. Sugestões: {n}',
  faixaLista: 'Na lista: {a}',

  // Folha
  folhaGeral: 'Adicionar à lista',
  folhaItem: '{Item}: {Status}',
  buscarBotao: 'Buscar material',
  buscarPlaceholder: 'Buscar material. Exemplo: haste, cabo, eletroduto',
  buscarAria: 'Buscar material',
  recentes: 'Usados por último',
  categorias: 'Por categoria',
  comuns: 'Comuns em toda instalação',
  nadaEncontrado: 'Nada encontrado para “{texto}”.',
  adicionarLivre: 'Adicionar “{texto}” como material',
  adicionar: 'Adicionar',
  adicionarSugeridas: 'Adicionar as sugeridas ({n})',
  escolhaTelha: 'Escolha a que combina com o telhado',
  seForLaje: 'Se for laje',
  mostrarMais: 'Mostrar mais {n}',
  obsProntas: 'Observações prontas',
  pronto: 'Pronto',
  prontoN: 'Pronto, {n} na lista',
  motivo: '{Item} · {Status}',

  // Linha da lista
  diminuirAria: 'Diminuir a quantidade de {nome}',
  aumentarAria: 'Aumentar a quantidade de {nome}',
  numeroAria: 'Quantidade de {nome}: {n}. Toque para digitar.',
  apagarAria: 'Apagar {nome}',
  editarAria: 'Editar {nome}',
  faltaQtd: 'Falta a quantidade',
  informarQtd: 'Informar quantidade',

  // Formulários
  formLivre: 'Material fora da lista',
  editarLinha: 'Editar linha',
  anotar: 'Anotar observação',
  rotNome: 'Nome do material',
  rotEsp: 'Especificação (vai para o fornecedor)',
  rotQtd: 'Quantidade',
  rotUn: 'Unidade',
  rotQuem: 'Quem providencia',
  rotNota: 'Nota (aparece só no relatório)',
  rotItem: 'Sobre qual item? (opcional)',
  phNome: 'Exemplo: haste de aterramento',
  phEsp: 'Exemplo: aço cobreado, modelo aprovado pela distribuidora',
  phNota: 'Exemplo: do telhado até o inversor',
  phObs: 'Escreva ou use o microfone do teclado.',
  btnAddLista: 'Adicionar à lista',
  salvar: 'Salvar',
  apagarLinha: 'Apagar linha',
  cancelar: 'Cancelar',
  contador: '{n} de {max}',

  // Avisos curtos
  adicionado: 'Adicionado à lista.',
  lote: '{n} sugestões adicionadas.',
  loteUma: '1 sugestão adicionada.',
  notaAdd: 'Observação adicionada.',
  apagada: 'Linha apagada.',
  desfazer: 'Desfazer',
  jaEsta: 'Já está na lista.',
  jaEstava: 'Já estava na lista.',
  nomeVazio: 'Digite o nome do material.',
  qtdInvalida: 'Informe uma quantidade maior que zero.',
  amiantoAviso: 'Telha de fibrocimento antiga pode ter amianto. Não fure nem corte sem confirmar a idade da telha.',
  amiantoObs: 'Telha de fibrocimento antiga, pode ter amianto. Não furar nem cortar.',

  // Copiar para o WhatsApp
  abaForn: 'Para o fornecedor',
  abaCli: 'Para o cliente',
  copiarTexto: 'Copiar texto',
  abrirZap: 'Abrir no WhatsApp',
  copiou: 'Texto copiado.',
  naoCopiou: 'Não consegui copiar. Toque no texto, selecione e copie.',
  listaLonga: 'A lista é longa. Use Copiar e cole no WhatsApp.',
  notaPrivacidade: 'O texto leva só o primeiro nome do cliente. Não leva endereço nem documentos.',
  notaLink: 'Mande este texto, não o link do relatório, para o fornecedor. O link mostra os documentos do cliente.',
  fora: 'Fora do texto: {x}.',
  incluiCombinar: 'Inclui {n} item a combinar.',
  incluiCombinarPlural: 'Inclui {n} itens a combinar.',
  naoIncluiCombinar: 'Não inclui {n} item a combinar.',
  naoIncluiCombinarPlural: 'Não inclui {n} itens a combinar.',
  faltaQtdN: 'Falta a quantidade em {n} item.',
  faltaQtdNPlural: 'Falta a quantidade em {n} itens.',
  semItemCliente: 'Não há item do cliente nesta lista.',

  // Painel final e aviso antes de concluir
  painelResumo: 'Lista de compras: {resumo}',
  painelPrivada: 'Esta lista não aparece no relatório.',
  avisoSemStatus: 'Faltam itens sem status: {lista}. Você pode concluir assim mesmo.',
} as const;
