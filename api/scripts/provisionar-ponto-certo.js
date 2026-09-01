// Cadastra o Ponto Certo no PlugCash: curso, 7 aulas e a ponte com a Kiwify.
//
// A ordem NÃO é decorativa. `/plugcash/curso/:slug` filtra por status: curso em
// rascunho devolve 404, inclusive para quem já pagou — a linha em `pc_acessos`
// existe e não abre nada. Então: curso em rascunho → aulas publicadas → curso
// publicado, e só aí a página de venda e o player passam a existir.
const fs = require('fs');

const API = 'https://solardocs-api.vercel.app';
const KEY = 'ZAPI_IO_2026_BOOTSTRAP';
const CHECKOUT = 'https://pay.kiwify.com.br/BtebJFP';

// A ordem do curso é a da landing, não a do arquivo: o aluno começa pela lista
// de dez endereços (que ele faz sentado) e termina na ordem de assinar.
const ORDEM = [
  'A lista: dez endereços, sete riscados',
  'Os primeiros 30 segundos',
  'Cabe ou não cabe: as duas fotos',
  'A visita e o placar',
  'Fixo, percentual ou misto — e o "quero uma parte"',
  'A proposta de uma página',
  'A ordem de assinar',
];

const bruto = JSON.parse(fs.readFileSync(__dirname + '/ponto-certo-aulas.json', 'utf8'));
const aulas = ORDEM.map((titulo, i) => {
  const a = bruto.find((x) => x.titulo === titulo);
  if (!a) throw new Error('aula ausente no JSON: ' + titulo);
  return {
    ordem: i + 1,
    titulo: a.titulo,
    descricao: a.descricao,
    duracao_seg: a.duracao_seg,
    paginas: a.paginas,
    // Nenhuma aula é grátis. `gratuita` NÃO é um selo: em /plugcash/aula/:id ela
    // pula o gate de pc_acessos, e qualquer conta logada — free inclusive — abre
    // as 8 páginas. A aula 1 é justamente o que a landing mais vende.
    gratuita: false,
    status: 'publicado',
  };
});

const curso = {
  slug: 'ponto-certo',
  titulo: 'O Ponto Certo',
  subtitulo: 'Como achar, negociar e fechar o local do seu eletroposto — antes de gastar o primeiro real.',
  descricao: 'Você tem o capital e não tem o lugar. Este é o processo que a gente usa quando escolhe um ponto: '
    + 'descartar sete de dez endereços sem sair de casa, chegar no dono do imóvel sem levantar a lebre, '
    + 'ler a conta de luz e o disjuntor para saber se aquele local aguenta, medir o movimento em vez de senti-lo, '
    + 'converter qualquer aluguel pedido em carros por dia e fechar um contrato longo na ordem certa. '
    + 'Sete aulas, doze instrumentos, nenhuma aula sem uma ação no fim.',
  thumb_url: '/plugcash/img/ponto-certo.webp',
  preco_centavos: 29700,
  parcelas: 1,   // a landing diz "pagamento único"; 1 faz a linha de parcela sumir
  checkout_url: CHECKOUT,
  nivel_exigido: null,
  // A régua da /io/eletroposto marca 'sem_ponto' em quem declarou não ter o
  // local — é literalmente a falta que este curso resolve, e é ela que faz o
  // bloco "seu próximo passo" apontar pra cá sozinho.
  resolve_motivo: ['sem_ponto'],
  ordem: 2,
  indexavel: false,
  status: 'rascunho',
  copy: {
    dor: [
      'Você tem o dinheiro separado e trava na mesma pergunta: onde.',
      'Você já olhou lugares, mas não sabe dizer qual deles aguenta um carregador — e por isso não descarta nenhum.',
      'Você tem medo de falar com o dono do imóvel e ver o aluguel dobrar quando ele descobrir o que vai nascer ali.',
      'Você não sabe o que assinar primeiro, e assinar arrendamento antes do parecer da distribuidora é o erro que custa caro.',
      'Você baixaria um contrato pronto da internet porque não sabe quais campos são os que decidem.',
    ],
    para_quem: [
      'Quem tem capital para investir e ainda não tem o local definido.',
      'Quem tem um lugar em vista e não sabe dizer se ele presta.',
      'Quem vai negociar com o dono de um imóvel que não é seu.',
    ],
    nao_e_para: [
      'Quem já é dono, administra, representa o proprietário ou é inquilino com anuência do local — nesse caso o próximo passo é uma reunião de projeto, não este material.',
      'Quem quer que a gente ache o ponto no lugar dele. A gente ensina a régua; quem bate na porta é você.',
      'Quem procura atalho jurídico. Você sai com as decisões fechadas para o seu advogado redigir, não sem advogado.',
    ],
    entregas: [
      'Lista dos 10 endereços com as 7 travas que matam um ponto de graça, antes de qualquer visita',
      'Cartão de bolso: os primeiros 30 segundos no balcão, no WhatsApp e no telefone — e as 9 frases que fazem o aluguel subir',
      'Planilha de energia: tipo de ligação, tensão, disjuntor e consumo, com a corrente de cada configuração',
      'As 4 fotos que dispensam visita técnica, com o que precisa estar legível em cada uma',
      'Ficha de vistoria em 7 blocos, com folha de contagem de fluxo — feita para ir impressa',
      'Placar de 30 pontos que fecha a visita com uma letra: A, B, C ou X',
      'Régua de negociação que converte qualquer aluguel pedido em carros por dia',
      'Os 10 itens inegociáveis de um contrato de cessão de área',
      'Proposta de uma página para deixar no balcão do dono, com croqui do pátio anexo',
      'Term sheet de 12 campos e as 6 perguntas fechadas para o advogado',
      'A ordem de assinar: qual papel vai antes do parecer da distribuidora e qual não',
      'Modelo de contrato de cessão de área comentado, campo a campo',
    ],
    garantia: 'Sete dias. Se dentro desse prazo você achar que a página prometeu mais do que o material entregou, '
      + 'escreve pro suporte e o valor volta integral — sem formulário de retenção, sem ligação de convencimento '
      + 'e sem contraproposta. Os instrumentos que você já baixou ficam com você.',
    credito: 'O valor pago aqui vira crédito na sua conta e abate no upgrade para a Mentoria. '
      + 'O crédito vale por 12 meses a partir da compra.',
    faq: [
      { p: 'Vocês acham o ponto para mim?',
        r: 'Não. A gente te ensina a achar. Quem bate na porta é você — somos dois sócios com agenda cheia em Uberlândia, não visitamos imóvel em outra cidade e não vamos fingir que visitamos.' },
      { p: 'Serve para a minha cidade?',
        r: 'Serve. A régua de energia, fluxo, vaga e negociação é a mesma no Brasil inteiro. O que muda de cidade para cidade é a distribuidora — e quem lê a norma dela é o projetista local.' },
      { p: 'Preciso já ter um local em vista?',
        r: 'Não. A primeira aula começa antes disso: como descartar dez endereços sem sair de casa.' },
      { p: 'Isso substitui advogado?',
        r: 'Não, e desconfie de quem disser que sim. Você sai com as 12 decisões fechadas para entregar ao seu advogado. Isso encurta o trabalho dele e barateia a sua conta — não elimina.' },
      { p: 'Sou obrigado a comprar o eletroposto de vocês depois?',
        r: 'Não. A gente monta eletroposto chave na mão e obviamente gostaria de montar o seu. A régua que está aqui dentro funciona igual se você comprar de outro fornecedor.' },
      { p: 'Eu já tenho o ponto. Serve para mim?',
        r: 'Não compre. Se o local é seu, você administra, representa o proprietário ou é inquilino com anuência, o seu próximo passo é uma reunião de projeto com a gente — não um material sobre como achar ponto.' },
    ],
  },
};

const gateway = {
  gateway: 'kiwify',
  // O código do checkout, não o product_id: é o identificador que a gente
  // controla e que está escrito na landing. Ver classificarProdutoPlugcash.
  produto_id: 'BtebJFP',
  item_tipo: 'curso',
  item_slug: 'ponto-certo',
  ativo: true,
};

async function provisionar(corpo, etapa) {
  const r = await fetch(API + '/plugcash/provisionar?key=' + KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const txt = await r.text();
  console.log('[' + etapa + '] ' + r.status + ' ' + txt.slice(0, 500));
  if (!r.ok) process.exit(1);
  return JSON.parse(txt);
}

(async () => {
  const passo = process.argv[2] || 'tudo';

  if (passo === 'tudo' || passo === 'rascunho') {
    await provisionar({ curso, aulas, gateway }, 'curso em rascunho + 7 aulas + kiwify');
  }
  if (passo === 'tudo' || passo === 'publicar') {
    // Só depois de conferir que as aulas entraram. Publicar é o que faz a
    // página existir para quem comprou.
    await provisionar({ curso: { slug: 'ponto-certo', status: 'publicado' } }, 'publicar');
  }
})();
