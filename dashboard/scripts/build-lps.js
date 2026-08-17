/**
 * GERADOR DAS 3 LPs EXTERNAS — clone do modelo `public/kit/index.html`.
 *
 * Por que HTML solto em public/ e nao rota do Next: e' isso que o Thiago quer
 * dizer com "externa". A /kit e a limpapro.solardoc.app nao tem cabecalho do
 * app, nao tem "Ja' tenho conta", nao carregam o bundle do dashboard e nao
 * sabem que a SolarDoc existe ate' a hora de comprar. As minhas eram rota do
 * app renderizando componente do app — por isso batiam como tela de produto.
 *
 * O CSS aqui e' o CSS da /kit, copiado, nao reescrito: mesmos tokens
 * (#080d18/#0d1424/#121b2e, ambar #f7a41c), mesma fonte de sistema, mesmo
 * botao de raio 13 com gradiente, mesmas secoes alternando fundo, mesma barra
 * fixa no rodape do celular.
 *
 *   node scripts/build-lps.js         gera as 3
 *   node scripts/build-lps.js calculadora   gera uma
 */
const fs = require('fs');
const path = require('path');
const RAIZ = 'c:/Users/55349/Desktop/CLAUDE/dashboard/public';

// ══════════════════════════════════════════════════════════════════
//  O CONTEUDO. Um objeto por pagina, na ordem em que a /kit apresenta.
// ══════════════════════════════════════════════════════════════════
const PAGINAS = [
{
  pasta: 'dimensionamento',
  titulo: 'Dimensionamento Off-Grid — o orçamento do sistema isolado pronto na frente do cliente',
  descricao: 'Marque o que o cliente vai ligar, diga quantos dias sem sol ele precisa aguentar e saia com o kit dimensionado, a autonomia em número, o preço com frete até a obra e a proposta em PDF com a sua marca. R$ 97, e volta como abatimento no primeiro pedido.',
  ogTitulo: 'Dimensionamento Off-Grid — R$ 97',
  checkout: 'https://pay.kiwify.com.br/Je9pKBV',
  preco: '97',
  precoNota: 'pagamento único · acesso enquanto sua conta existir',
  ctaTexto: 'Quero a ferramenta por R$ 97 →',
  eyebrow: 'Para integrador que vende sistema isolado',
  aspas: '“E quanto tempo essa bateria aguenta sem sol?”',
  h1: ['Você tem que responder isso na hora — e ', 'chutar derruba a venda'],
  heroSub: 'A ferramenta de off-grid dimensiona o sistema inteiro e responde essa pergunta com número, em três cenários, na frente do cliente. Sem planilha e sem esperar cotação.',
  bullets: [
    'Painéis, banco de baterias, inversor e a ligação em série/paralelo',
    'A autonomia em três cenários: só o essencial, a casa inteira e dia de chuva',
    'Preço do kit com frete até a obra, calculado pelo CEP',
    'Proposta em PDF com a sua marca, o seu preço e as suas parcelas',
    'Comparativo de 10 anos contra puxar rede e contra gerador a diesel',
  ],
  ctaNota: 'Dimensionar é de graça · os R$ 97 voltam como abatimento se pedir o kit',
  telaUrl: 'solardoc.app/off-grid',
  numeros: [
    ['70', 'aparelhos no catálogo, da lâmpada à ordenhadeira'],
    ['3', 'cenários de autonomia com número'],
    ['10 anos', 'de comparativo contra rede e diesel'],
    ['R$ 97', 'uma vez, e volta no primeiro pedido'],
    ['minutos', 'do primeiro clique ao PDF pronto'],
  ],
  dorTitulo: 'A venda de off-grid não trava no preço. Trava na pergunta.',
  falas: [
    '“Quanto tempo aguenta se ficar três dias chovendo?”',
    '“E se eu ligar o chuveiro também, dá?”',
    '“O vizinho pagou menos, por que o seu é mais caro?”',
  ],
  dorTexto: 'Chutar a resposta derruba a confiança na hora. Calcular na mão leva meia hora, você fica sem responder na visita e ainda erra o mês de inverno — que é justamente o que decide o tamanho do banco de baterias.',
  recebeEyebrow: 'O que você recebe',
  recebeTitulo: 'O sistema dimensionado e a proposta, no mesmo lugar',
  mods: [
    ['01', 'O dimensionamento completo', 'Painéis, banco de baterias, inversor e controlador — com a ligação em série e paralelo já resolvida. Você marca o que o cliente vai ligar e a conta é da ferramenta.', '70 aparelhos no catálogo'],
    ['02', 'A autonomia com número', 'Três cenários prontos: só o essencial, a casa inteira e o dia de chuva. É a resposta para a pergunta que trava a venda, e ela sai enquanto o cliente está na sua frente.', 'A pergunta que decide'],
    ['03', 'O preço do kit com frete', 'Digite o CEP e veja o fornecimento fechado, com o frete de Uberlândia até a obra. Sem pedir cotação e sem sumir dois dias esperando resposta.', 'Sem cotação'],
    ['04', 'A proposta com a sua marca', 'PDF com a sua logo, as suas cores, o seu preço e as suas parcelas. Custo e margem ficam na sua tela — o cliente nunca vê o nosso nome.', 'White-label'],
    ['05', 'O comparativo de 10 anos', 'Contra puxar rede e contra gerador a diesel, com os números do ano a ano. É o argumento que ganha obra em sítio e quase ninguém tem na ponta da língua.', 'Ganha a conversa do poste'],
    ['06', 'O surto de partida na conta', 'Bomba puxa de 3 a 5 vezes a potência quando liga. A ferramenta dimensiona para o pico — inversor que desarma na primeira partida é o defeito mais caro do off-grid.', 'Não erra o inversor'],
  ],
  dentroEyebrow: 'Por dentro',
  dentroTitulo: 'É assim que ela funciona',
  pecas: [
    ['Marque o aparelho, não a potência', 'Geladeira, luz, bomba, ar-condicionado, ordenhadeira. São 70 aparelhos com a potência já preenchida e o consumo por hora calculado. Se preferir, digite direto o kWh da conta de luz.', 'tela'],
    ['A conta refaz sozinha a cada escolha', 'Mudou os dias sem sol de um para três? O banco de baterias, o preço e a autonomia mudam na mesma tela, na hora. É a escolha que mais mexe no orçamento e o cliente vê o efeito dela junto com você.', 'celular'],
  ],
  compEyebrow: 'A diferença que importa',
  compTitulo: 'Voltar com a obra ou voltar para pensar',
  compMauTitulo: 'Dimensionando no olho',
  compMau: [
    'Chuta a autonomia e perde a confiança',
    'Meia hora de conta e o inverno sai errado',
    'Pede cotação e some por dois dias',
    'Proposta em Word, sem comparativo',
    'Esquece o surto e o inversor desarma',
  ],
  compBomTitulo: 'Com o Dimensionamento Off-Grid',
  compBom: [
    'Três cenários de autonomia com número',
    'O sistema inteiro em minutos, com dia de chuva',
    'Preço com frete na hora, pelo CEP',
    'PDF com a sua marca e o comparativo junto',
    'Dimensionado para o pico de partida',
  ],
  comoEyebrow: 'Como funciona',
  comoTitulo: 'Três passos, e você sai com a proposta',
  passos: [
    ['Marque o que vai ligar', 'Abra a lista e vá marcando. Ou digite o kWh da conta, se o cliente já souber.'],
    ['Diga quantos dias sem sol', 'Um? Três? Só o essencial ou a casa inteira? A tela mostra o efeito no preço na hora.'],
    ['Leve a proposta pronta', 'Kit dimensionado, autonomia com número, preço com frete e o PDF com a sua marca.'],
  ],
  ofertaTitulo: 'Custa menos que uma visita perdida em sítio',
  ofertaLista: [
    'Dimensionamento completo, com série e paralelo resolvidos',
    'Autonomia em três cenários, com número',
    'Preço do kit com frete até a obra, pelo CEP',
    'Proposta em PDF com a sua marca e o seu preço',
    'Comparativo de 10 anos contra rede e diesel',
    'Pedido do kit direto com a gente, orçamento travado',
  ],
  faq: [
    ['Preciso entender de cálculo para usar?', 'Não. Você marca aparelho e responde duas perguntas; a conta é da ferramenta. O que ela pede é o que o cliente já te falou — o que ele quer ligar e quanto tempo precisa aguentar sem sol.'],
    ['O preço do kit é o que eu vendo?', 'Não. O que aparece é o nosso fornecimento com frete. Você põe a sua margem em cima e a proposta sai com o SEU preço. Custo e margem ficam na sua tela, nunca no PDF do cliente.'],
    ['Sou obrigado a comprar o kit de vocês?', 'Não. Dimensionar e ver a autonomia é grátis para todo mundo, e você compra o material onde quiser. Se pedir para a gente, os R$ 97 voltam como abatimento no primeiro pedido.'],
    ['Serve para sistema híbrido, com rede?', 'A ferramenta foi feita para o isolado — sítio, chácara, ponto sem rede. Num híbrido ela ajuda a dimensionar o banco, mas a conta de compensação da rede não entra.'],
    ['Como recebo o acesso?', 'Depois do pagamento você recebe um e-mail para criar a sua senha, e a ferramenta abre na hora. Se você já tem conta no SolarDoc, ela libera sozinha na sua conta.'],
  ],
  fechaTitulo: 'A próxima visita ao sítio pode terminar com a proposta assinada',
  fechaTexto: 'Dimensionar é de graça — teste antes de pagar qualquer coisa. Os R$ 97 liberam a proposta em PDF com a sua marca, o preço do kit com frete e o comparativo que ganha a conversa.',
},
{
  pasta: 'calculadora',
  titulo: 'Calculadora Solar — o preço que fecha a venda e ainda sobra margem',
  descricao: 'Kit, material CA, mão de obra, deslocamento, ART, homologação, imposto e comissão numa tela só. Arraste a margem e veja a sua sobra mudar na hora, antes de mandar o preço. R$ 67, pagamento único.',
  ogTitulo: 'Calculadora Solar — R$ 67',
  checkout: 'https://pay.kiwify.com.br/duOCDd0',
  preco: '67',
  precoNota: 'pagamento único · acesso enquanto sua conta existir',
  ctaTexto: 'Quero a calculadora por R$ 67 →',
  eyebrow: 'Para integrador solar com CNPJ',
  aspas: '“Fechei a obra e no fim das contas não sobrou quase nada.”',
  h1: ['O problema não foi o desconto. Foi ', 'o custo que ficou de fora'],
  heroSub: 'Material CA, deslocamento, ART, homologação, imposto e comissão somem quando se precifica no olho. A Calculadora Solar põe todos na conta e mostra a sua sobra antes de você mandar o preço.',
  bullets: [
    'Todo custo na conta: kit, material CA, mão de obra, deslocamento, ART e homologação',
    'Nota fiscal modelada como dedução — sobre o serviço ou sobre o total',
    'Comissão do vendedor calculada junto, não depois',
    'Arraste a margem e veja o preço e a sua sobra mudarem na hora',
    'O preço mínimo que ainda dá lucro, para você negociar sabendo o piso',
  ],
  ctaNota: 'Pagamento único · Pix ou cartão · acesso em minutos',
  telaUrl: 'solardoc.app/precificacao',
  numeros: [
    ['6', 'custos que entram além do kit'],
    ['1 tela', 'do custo ao preço final'],
    ['68', 'integradores usando hoje'],
    ['R$ 67', 'uma vez, sem mensalidade'],
    ['0', 'planilha para manter'],
  ],
  dorTitulo: 'Três coisas fazem o lucro sumir depois da obra fechada',
  falas: [
    '“Esqueci de somar as três viagens até a cidade.”',
    '“A nota fiscal veio e comeu a margem inteira.”',
    '“Dei o desconto sem saber até onde eu podia ir.”',
  ],
  dorTexto: 'Nenhuma delas aparece na hora de fechar. Todas aparecem depois, quando o dinheiro já entrou e a conta não fecha — e aí não dá mais para renegociar com o cliente.',
  recebeEyebrow: 'O que você recebe',
  recebeTitulo: 'A conta inteira, do custo ao preço final',
  mods: [
    ['01', 'O custo real da obra', 'Kit fotovoltaico, material CA, mão de obra, deslocamento, ART e homologação. Cada campo com o que ele significa escrito do lado, para não sobrar dúvida do que entra onde.', '6 custos além do kit'],
    ['02', 'O imposto no lugar certo', 'Escolha se a nota é sobre o serviço ou sobre o total, e o imposto já sai descontado. Sem isso o preço parece bom até o boleto do contador chegar.', 'NF como dedução'],
    ['03', 'A comissão antes, não depois', 'Vendedor comissionado entra na conta antes de o preço existir. Assim a margem que você vê é a que sobra de verdade, não a que sobra menos a comissão.', 'Margem de verdade'],
    ['04', 'A margem que você arrasta', 'Mexa no controle e veja o preço ao cliente e a sua sobra mudarem juntos, na hora. Dá para negociar sabendo exatamente quanto está abrindo mão.', 'Ao vivo'],
    ['05', 'O piso que ainda fecha', 'A ferramenta mostra o preço mínimo que ainda dá lucro. Quando o cliente apertar, você sabe onde parar em vez de chutar com medo de perder a obra.', 'Onde parar'],
    ['06', 'A mesma conta para o time', 'Todo mundo precifica pelo mesmo critério. Acaba a proposta que cada um fez de um jeito e ninguém sabe explicar depois.', 'Padrão da empresa'],
  ],
  dentroEyebrow: 'Por dentro',
  dentroTitulo: 'É assim que ela funciona',
  pecas: [
    ['O custo entra, o preço sai', 'Você lança os custos da obra de cima para baixo e o total vai se formando. Nada de fórmula escondida em célula: cada linha é um custo que você reconhece.', 'tela'],
    ['A sobra muda enquanto você arrasta', 'O controle de margem move o preço ao cliente e a sua sobra ao mesmo tempo. É a tela que você abre na frente do cliente quando ele pede desconto.', 'celular'],
  ],
  compEyebrow: 'A diferença que importa',
  compTitulo: 'Fechar com lucro ou descobrir que trabalhou de graça',
  compMauTitulo: 'Precificando no olho',
  compMau: [
    'Soma o kit e joga uma margem por cima',
    'Deslocamento, ART e homologação ficam de fora',
    'A nota fiscal aparece depois e come o lucro',
    'A comissão sai da sua parte, não do preço',
    'Cede desconto sem saber onde é o fundo',
  ],
  compBomTitulo: 'Com a Calculadora Solar',
  compBom: [
    'Todo custo lançado antes de o preço existir',
    'Material CA, mão de obra, deslocamento e ART juntos',
    'Imposto escolhido e já descontado',
    'Comissão na conta antes, não depois',
    'Você vê o piso e negocia até ele',
  ],
  comoEyebrow: 'Como funciona',
  comoTitulo: 'Três passos, e o preço está pronto',
  passos: [
    ['Lance os custos da obra', 'Kit, material CA, mão de obra, deslocamento, ART e homologação.'],
    ['Escolha imposto e comissão', 'NF sobre o serviço ou sobre o total, e a comissão do vendedor.'],
    ['Arraste a margem', 'O preço ao cliente e a sua sobra mudam juntos. Você fecha sabendo quanto entra.'],
  ],
  ofertaTitulo: 'Uma obra precificada errada custa mais que a ferramenta',
  ofertaLista: [
    'Todo custo na conta: kit, material CA, mão de obra, deslocamento, ART e homologação',
    'Nota fiscal modelada como dedução, sobre o serviço ou sobre o total',
    'Comissão do vendedor calculada junto',
    'Margem ao vivo, com a sua sobra na tela',
    'O preço mínimo que ainda dá lucro',
    'Abre do celular, na frente do cliente',
  ],
  faq: [
    ['É uma planilha?', 'Não. É uma tela dentro da plataforma, que abre do celular na frente do cliente. Planilha quebra quando alguém arrasta uma célula — aqui a conta é a mesma sempre.'],
    ['Serve para qualquer tamanho de obra?', 'Serve. A conta é a mesma para residencial pequeno e para usina — o que muda são os números que você lança.'],
    ['Preciso assinar o SolarDoc?', 'Não. A compra é à parte e o acesso é seu enquanto a conta existir. Ela também vem inclusa na assinatura, se um dia fizer sentido.'],
    ['Já usava de graça. Vou perder?', 'Não. Quem já usava continua usando, de graça, para sempre. A cobrança vale para quem chega agora.'],
    ['Como recebo o acesso?', 'Depois do pagamento você recebe um e-mail para criar a sua senha, e a ferramenta abre na hora. Se você já tem conta no SolarDoc, ela libera sozinha.'],
  ],
  fechaTitulo: 'O próximo orçamento pode sair sabendo quanto sobra para você',
  fechaTexto: 'Lance o custo real, arraste a margem e veja a sua sobra mudar na hora — antes de mandar o preço, não depois de fechar a obra.',
},
{
  pasta: 'inventario-empresarial',
  titulo: 'Inventário Empresarial — saiba onde está cada ferramenta e quanto vale a sua empresa',
  descricao: 'Patrimônio somando sozinho, aviso antes de faltar material na obra, histórico de entrada e saída e o PDF separado por local para a contabilidade. R$ 67, pagamento único.',
  ogTitulo: 'Inventário Empresarial — R$ 67',
  checkout: 'https://pay.kiwify.com.br/ABSMgCu',
  preco: '67',
  precoNota: 'pagamento único · acesso enquanto sua conta existir',
  ctaTexto: 'Quero o inventário por R$ 67 →',
  eyebrow: 'Para empresa de energia solar com equipe',
  aspas: '“Cadê a furadeira que estava no carro?”',
  h1: ['Se ninguém sabe responder, ', 'a empresa não sabe o que tem'],
  heroSub: 'O Inventário Empresarial põe cada ferramenta num local, com valor e estoque mínimo. O patrimônio soma sozinho e o aviso de repor chega antes de faltar no telhado.',
  bullets: [
    'Patrimônio total somando sozinho, item por item',
    'Aviso de estoque mínimo antes de faltar material na obra',
    'Entrada e saída em dois toques, com histórico de cada item',
    'Locais que você cria: escritório, depósito, veículo, obra do João',
    'PDF separado por local, com os totais, para a contabilidade',
  ],
  ctaNota: 'Pagamento único · Pix ou cartão · acesso em minutos',
  telaUrl: 'solardoc.app/inventario',
  numeros: [
    ['46', 'materiais no catálogo pronto'],
    ['14 itens', 'no inventário de exemplo, num toque'],
    ['46', 'empresas usando hoje'],
    ['R$ 67', 'uma vez, sem mensalidade'],
    ['1 botão', 'para o PDF da contabilidade'],
  ],
  dorTitulo: 'O prejuízo do inventário não aparece numa linha só',
  falas: [
    '“Chegamos no telhado e o conector MC4 tinha acabado.”',
    '“A furadeira sumiu e ninguém sabe quem levou.”',
    '“O contador pediu a relação de bens e virou um dia de trabalho.”',
  ],
  dorTexto: 'Cada um desses custa pouco sozinho e muito junto: a viagem perdida, a ferramenta reposta, o seguro feito no chute e o dia que você parou para montar a lista na mão.',
  recebeEyebrow: 'O que você recebe',
  recebeTitulo: 'Tudo o que a empresa tem, num lugar só',
  mods: [
    ['01', 'O patrimônio somando sozinho', 'Cada item com o seu valor, e o total da empresa atualizado a cada movimento. É o número que o contador pede e que a seguradora exige na apólice.', 'O número que falta'],
    ['02', 'O aviso antes de faltar', 'Diga o mínimo de cada material. Quando encostar, a linha fica vermelha e o aviso sobe no topo — antes de você descobrir com a equipe já no telhado.', 'Estoque mínimo'],
    ['03', 'Entrada e saída com histórico', 'Chegou material, saiu para obra: dois toques. Corrigir o número na mão apaga a história do item, e é assim que ninguém sabe quem levou a furadeira.', 'Movimento, não digitação'],
    ['04', 'Cada coisa no seu lugar', 'Escritório, montagem, depósito, veículos — e os que você criar. Saber onde a ferramenta está vale mais que saber que ela existe.', 'Locais que você cria'],
    ['05', 'O PDF da contabilidade', 'Um botão gera o documento separado por local, com os totais. É o que você manda para o contador ou anexa num seguro.', 'Um botão'],
    ['06', 'Começa preenchido', 'Um toque monta um inventário de exemplo com 14 itens que toda equipe solar tem, já com valor e estoque mínimo. Você ajusta em vez de começar do zero.', '14 itens de exemplo'],
  ],
  dentroEyebrow: 'Por dentro',
  dentroTitulo: 'É assim que ele funciona',
  pecas: [
    ['O catálogo já vem pronto', 'Do alicate crimpador MC4 ao painel solar, são 46 materiais com nome certo esperando você escolher o local. O que não estiver na lista, você digita.', 'tela'],
    ['No galpão, pelo celular', 'Cada material vira um cartão, sem rolar para o lado, e os botões são do tamanho do dedo. Foi refeito para ser usado em pé, no depósito, com a mão suja.', 'celular'],
  ],
  compEyebrow: 'A diferença que importa',
  compTitulo: 'Saber o que você tem ou descobrir no telhado que faltou',
  compMauTitulo: 'No caderno e na memória',
  compMau: [
    'Ninguém sabe quanto vale o que a empresa tem',
    'O material acaba e você descobre na obra',
    'Corrigem o número na mão e a história some',
    'A ferramenta sumiu e não dá para dizer quem levou',
    'O seguro é feito no chute',
  ],
  compBomTitulo: 'Com o Inventário Empresarial',
  compBom: [
    'Patrimônio somado item por item, sempre atualizado',
    'A linha fica vermelha e o aviso sobe antes de faltar',
    'Entrada e saída em dois toques, com histórico',
    'Cada ferramenta com local e responsável',
    'A apólice sai do valor real do que está lá',
  ],
  comoEyebrow: 'Como funciona',
  comoTitulo: 'Três passos, e a empresa está mapeada',
  passos: [
    ['Escolha o local e o material', 'A lista já vem pronta com o que costuma ter em cada lugar. Ou digite o que não está nela.'],
    ['Preencha valor e estoque mínimo', 'O valor alimenta o patrimônio; o mínimo dispara o aviso de repor.'],
    ['Lance movimento, não digitação', 'As setas de entrada e saída mantêm a história de cada item.'],
  ],
  ofertaTitulo: 'Uma viagem perdida por falta de material custa mais',
  ofertaLista: [
    'Patrimônio total somando sozinho',
    'Aviso de estoque mínimo antes de faltar',
    'Entrada e saída com histórico por item',
    'Locais que você cria, inclusive por obra',
    'PDF separado por local, com os totais',
    'Inventário de exemplo com 14 itens, num toque',
  ],
  faq: [
    ['Preciso cadastrar tudo de uma vez?', 'Não. Dá para começar com um botão que monta um inventário de exemplo e ir ajustando, ou cadastrar só o que importa agora. Nada trava por estar incompleto.'],
    ['Funciona no celular, no galpão?', 'Funciona. Foi refeito para isso: no telefone cada material vira um cartão, sem rolar para o lado, e os botões são do tamanho do dedo.'],
    ['Serve para controlar obra, não só empresa?', 'Serve. Você cria o local que quiser — “Obra do João”, “Almoxarifado” — e controla o material lá dentro do mesmo jeito.'],
    ['Já usava de graça. Vou perder?', 'Não. Quem já usava continua usando, de graça, para sempre. A cobrança vale para quem chega agora.'],
    ['Como recebo o acesso?', 'Depois do pagamento você recebe um e-mail para criar a sua senha, e a ferramenta abre na hora. Se você já tem conta no SolarDoc, ela libera sozinha.'],
  ],
  fechaTitulo: 'Amanhã de manhã dá para saber onde está cada ferramenta',
  fechaTexto: 'Um toque monta um inventário de exemplo com 14 itens que toda equipe solar tem. Você ajusta em vez de começar do zero — e em uma tarde a empresa inteira está mapeada.',
},
];

// ══════════════════════════════════════════════════════════════════
//  O CSS — copiado da /kit, nao reescrito.
// ══════════════════════════════════════════════════════════════════
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #080d18;
    --bg2: #0d1424;
    --surface: #121b2e;
    --line: rgba(148,163,184,.16);
    --line2: rgba(148,163,184,.26);
    --text: #f4f7fb;
    --muted: #93a3b8;
    --amber: #f7a41c;
    --amber-d: #d9860a;
    --green: #4ade80;
    --radius: 18px;
  }

  html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif;
    line-height: 1.65;
    font-size: 17px;
    overflow-x: hidden;
  }

  img { max-width: 100%; height: auto; display: block; }

  .wrap { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px; }
  .narrow { max-width: 760px; margin: 0 auto; }

  section { padding: 74px 0; }

  h1, h2, h3 { line-height: 1.16; letter-spacing: -.022em; text-wrap: balance; }
  h1 { font-size: clamp(31px, 5.6vw, 52px); font-weight: 800; }
  h2 { font-size: clamp(25px, 4vw, 36px); font-weight: 800; margin-bottom: 16px; }
  h3 { font-size: 19px; font-weight: 700; }
  p { margin-bottom: 15px; }
  strong { color: #fff; font-weight: 700; }
  .amber { color: var(--amber); }
  .muted { color: var(--muted); }

  .eyebrow {
    display: inline-block;
    font-size: 11px; font-weight: 800; letter-spacing: .2em; text-transform: uppercase;
    color: var(--amber); background: rgba(247,164,28,.1);
    border: 1px solid rgba(247,164,28,.28);
    padding: 7px 15px; border-radius: 999px; margin-bottom: 22px;
  }

  .topo {
    border-bottom: 1px solid var(--line);
    background: rgba(8,13,24,.9);
    backdrop-filter: blur(8px);
    position: sticky; top: 0; z-index: 40;
  }
  .topo .wrap { display: flex; align-items: center; justify-content: space-between; padding-top: 14px; padding-bottom: 14px; }
  .marca { font-size: 15px; font-weight: 800; letter-spacing: -.01em; }
  .marca span { color: var(--amber); }
  .topoSelo { font-size: 12.5px; color: var(--muted); }

  .hero {
    padding: 64px 0 56px;
    background:
      radial-gradient(1100px 520px at 12% -10%, rgba(247,164,28,.16), transparent 62%),
      radial-gradient(900px 480px at 92% 8%, rgba(56,110,180,.16), transparent 60%),
      var(--bg);
  }
  .heroGrid { display: grid; grid-template-columns: 1.02fr .98fr; gap: 52px; align-items: center; }
  .heroAspas {
    font-size: clamp(19px, 2.6vw, 23px); font-style: italic; color: var(--muted);
    border-left: 3px solid var(--amber); padding-left: 16px; margin-bottom: 20px;
  }
  .heroSub { color: var(--muted); font-size: clamp(16px, 1.7vw, 18.5px); margin: 20px 0 26px; max-width: 52ch; }
  ul.bullets { list-style: none; display: grid; gap: 11px; margin-bottom: 30px; }
  ul.bullets li { position: relative; padding-left: 30px; font-size: 15.5px; color: #d5deea; }
  ul.bullets li::before {
    content: ''; position: absolute; left: 0; top: 7px; width: 17px; height: 17px; border-radius: 50%;
    background: rgba(74,222,128,.16); border: 1px solid rgba(74,222,128,.5);
  }
  ul.bullets li::after {
    content: ''; position: absolute; left: 5.5px; top: 11px; width: 6px; height: 3px;
    border-left: 2px solid var(--green); border-bottom: 2px solid var(--green);
    transform: rotate(-45deg);
  }

  .cta {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    background: linear-gradient(180deg, var(--amber), var(--amber-d));
    color: #0a0f1a; font-weight: 800; font-size: 17px;
    padding: 18px 34px; border-radius: 13px; text-decoration: none;
    box-shadow: 0 10px 30px -10px rgba(247,164,28,.65);
    transition: transform .15s ease, box-shadow .15s ease;
    border: none; cursor: pointer; font-family: inherit; text-align: center;
  }
  .cta:hover { transform: translateY(-2px); box-shadow: 0 16px 34px -10px rgba(247,164,28,.75); }
  .cta:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
  .ctaNota { display: block; font-size: 13px; color: var(--muted); margin-top: 13px; }

  .janela {
    background: var(--surface); border: 1px solid var(--line2); border-radius: 14px;
    overflow: hidden; box-shadow: 0 30px 70px -30px rgba(0,0,0,.9);
  }
  .janelaBarra {
    display: flex; align-items: center; gap: 7px;
    padding: 11px 14px; background: #0e1728; border-bottom: 1px solid var(--line);
  }
  .janelaBarra i { width: 9px; height: 9px; border-radius: 50%; background: #33415c; display: block; }
  .janelaUrl { margin-left: 8px; font-size: 11.5px; color: #64768f; font-family: ui-monospace, Menlo, Consolas, monospace; }

  .heroArte { position: relative; }
  .heroCel {
    position: absolute; right: 5%; bottom: -30px; width: 27%; max-width: 158px;
    border-radius: 18px; border: 5px solid #1b2740; box-shadow: 0 26px 54px -18px rgba(0,0,0,.95);
  }

  .faixa { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); background: var(--bg2); }
  .faixaGrid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; padding: 26px 0; text-align: center; }
  .faixaGrid b { display: block; font-size: clamp(21px, 3vw, 28px); color: var(--amber); font-weight: 800; letter-spacing: -.02em; }
  .faixaGrid span { font-size: 12.5px; color: var(--muted); line-height: 1.45; display: block; margin-top: 3px; }

  .falas { display: grid; gap: 13px; margin-top: 26px; }
  .fala {
    background: var(--surface); border: 1px solid var(--line);
    border-left: 3px solid #ef6a5a; border-radius: 0 12px 12px 0; padding: 17px 21px;
    font-size: 17.5px; font-style: italic; color: #dfe6f0;
  }

  .mods { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 18px; margin-top: 34px; }
  .mod {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
    padding: 26px 24px; position: relative; overflow: hidden;
  }
  .mod::before {
    content: ''; position: absolute; inset: 0 0 auto 0; height: 3px;
    background: linear-gradient(90deg, var(--amber), transparent 70%);
  }
  .modNum { font-size: 12px; font-weight: 800; letter-spacing: .16em; color: var(--amber); display: block; margin-bottom: 9px; }
  .mod h3 { margin-bottom: 8px; }
  .mod p { color: var(--muted); font-size: 15px; margin: 0 0 12px; }
  .modTag {
    display: inline-block; font-size: 11.5px; font-weight: 700; color: #cbd5e1;
    background: rgba(148,163,184,.12); padding: 4px 11px; border-radius: 999px;
  }

  .peca { display: grid; grid-template-columns: 1fr 1fr; gap: 46px; align-items: center; margin-bottom: 64px; }
  .peca:last-child { margin-bottom: 0; }
  .peca.inverso .pecaArte { order: -1; }
  .pecaTxt h3 { font-size: 23px; margin-bottom: 12px; }
  .pecaTxt p { color: var(--muted); font-size: 16px; }
  .pecaSelo {
    display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: .15em;
    text-transform: uppercase; color: var(--amber); margin-bottom: 10px;
  }

  .comp { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 30px; }
  .compCard { border-radius: var(--radius); padding: 26px 24px; border: 1px solid var(--line); background: var(--surface); }
  .compCard.mau { opacity: .78; }
  .compCard.bom { border-color: rgba(247,164,28,.4); background: linear-gradient(180deg, rgba(247,164,28,.1), rgba(247,164,28,.02)); }
  .compCard h3 { font-size: 17px; margin-bottom: 14px; }
  .compCard ul { list-style: none; display: grid; gap: 10px; }
  .compCard li { font-size: 14.5px; color: #cbd5e1; padding-left: 26px; position: relative; }
  .compCard.mau li::before { content: '✕'; position: absolute; left: 0; color: #ef6a5a; font-weight: 700; }
  .compCard.bom li::before { content: '✓'; position: absolute; left: 0; color: var(--green); font-weight: 700; }

  .passos { display: grid; gap: 16px; margin-top: 30px; }
  .passo { display: grid; grid-template-columns: 44px 1fr; gap: 18px; align-items: start; }
  .passoN {
    width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
    background: rgba(247,164,28,.12); border: 1px solid rgba(247,164,28,.35);
    color: var(--amber); font-weight: 800; font-size: 17px;
  }
  .passo h3 { font-size: 18px; margin-bottom: 4px; }
  .passo p { color: var(--muted); font-size: 15.5px; margin: 0; }

  .oferta { background: var(--bg2); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .ofertaBox {
    background: var(--surface); border: 1px solid rgba(247,164,28,.34); border-radius: 22px;
    padding: 42px 38px; text-align: center; max-width: 760px; margin: 0 auto;
    box-shadow: 0 30px 80px -40px rgba(247,164,28,.5);
  }
  .preco { font-size: clamp(52px, 10vw, 74px); font-weight: 900; color: var(--amber); line-height: 1; letter-spacing: -.035em; margin: 8px 0 6px; }
  .preco small { font-size: .34em; font-weight: 700; letter-spacing: 0; color: var(--muted); }
  .ofertaLista { list-style: none; display: grid; gap: 11px; text-align: left; max-width: 480px; margin: 26px auto 30px; }
  .ofertaLista li { position: relative; padding-left: 28px; font-size: 15.5px; color: #d5deea; }
  .ofertaLista li::before { content: '✓'; position: absolute; left: 0; color: var(--green); font-weight: 800; }

  .garantia {
    display: flex; gap: 15px; align-items: flex-start; text-align: left;
    background: rgba(148,163,184,.07); border: 1px solid var(--line);
    border-radius: 14px; padding: 20px 22px; margin-top: 28px;
  }
  .garantia .selo { flex: none; display: grid; place-items: center; width: 26px; height: 26px; }
  .garantia p { margin: 0; font-size: 14.5px; color: var(--muted); }

  details {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: 13px; padding: 19px 23px; margin-bottom: 12px;
  }
  details[open] { border-color: var(--line2); }
  summary {
    cursor: pointer; font-weight: 700; font-size: 16.5px; list-style: none;
    display: flex; justify-content: space-between; gap: 16px; align-items: center;
  }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: '+'; color: var(--amber); font-size: 23px; font-weight: 400; flex: none; line-height: 1; }
  details[open] summary::after { content: '−'; }
  details p { color: var(--muted); font-size: 15.5px; margin: 13px 0 0; }

  footer { padding: 44px 0 66px; text-align: center; color: var(--muted); font-size: 13px; border-top: 1px solid var(--line); }
  footer a { color: var(--muted); }

  .barra {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
    background: rgba(8,13,24,.96); backdrop-filter: blur(10px);
    border-top: 1px solid var(--line2); padding: 11px 16px; display: none;
  }
  .barra .cta { width: 100%; padding: 15px 20px; font-size: 16px; }

  @media (max-width: 900px) {
    .heroGrid, .peca { grid-template-columns: 1fr; gap: 34px; }
    .peca.inverso .pecaArte { order: 0; }
    .comp { grid-template-columns: 1fr; }
    .faixaGrid { grid-template-columns: repeat(3, 1fr); gap: 18px 6px; }
    .heroCel { display: none; }
  }
  @media (max-width: 720px) {
    section { padding: 52px 0; }
    .barra { display: block; }
    body { padding-bottom: 80px; }
    .ofertaBox { padding: 32px 22px; }
    .peca .janela { overflow: hidden; }
    .peca .janela img {
      width: 152%; max-width: none;
      -webkit-mask-image: linear-gradient(90deg, #000 82%, transparent 100%);
      mask-image: linear-gradient(90deg, #000 82%, transparent 100%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
    html { scroll-behavior: auto; }
  }
`;

// ══════════════════════════════════════════════════════════════════
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const janela = (d, img, alt, prio) => `      <div class="janela">
        <div class="janelaBarra"><i></i><i></i><i></i><span class="janelaUrl">${d.telaUrl}</span></div>
        <img src="/${d.pasta}/img/${img}.webp" alt="${esc(alt)}"${prio ? ' fetchpriority="high"' : ' loading="lazy"'}>
      </div>`;

function pagina(d) {
  const cta = (marca) => `<a href="${d.checkout}" class="cta" data-cta="${marca}">${esc(d.ctaTexto)}</a>`;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow">
<title>${esc(d.titulo)}</title>
<meta name="description" content="${esc(d.descricao)}">
<link rel="icon" href="/icon-192.png">
<meta property="og:title" content="${esc(d.ogTitulo)}">
<meta property="og:description" content="${esc(d.descricao)}">
<meta property="og:image" content="https://solardoc.app/capas/${d.pasta === 'calculadora' ? 'calculadora-solar' : d.pasta === 'dimensionamento' ? 'dimensionamento-off-grid' : 'inventario-empresarial'}@2x.png">
<link rel="canonical" href="https://solardoc.app/${d.pasta}/">
<style>${CSS}</style>
</head>
<body>

<div class="topo">
  <div class="wrap">
    <span class="marca">SolarDoc <span>Pro</span></span>
    <span class="topoSelo">Acesso imediato · 7 dias de garantia</span>
  </div>
</div>

<header class="hero">
  <div class="wrap heroGrid">
    <div>
      <span class="eyebrow">${esc(d.eyebrow)}</span>
      <p class="heroAspas">${esc(d.aspas)}</p>
      <h1>${esc(d.h1[0])}<span class="amber">${esc(d.h1[1])}</span></h1>
      <p class="heroSub">${esc(d.heroSub)}</p>
      <ul class="bullets">
${d.bullets.map((b) => `        <li>${esc(b)}</li>`).join('\n')}
      </ul>
      ${cta('hero')}
      <span class="ctaNota">${esc(d.ctaNota)}</span>
    </div>

    <div class="heroArte">
${janela(d, 'tela', `Tela do ${d.ogTitulo.split(' — ')[0]} dentro da plataforma SolarDoc`, true)}
      <img class="heroCel" src="/${d.pasta}/img/celular.webp" loading="lazy" alt="A mesma tela no celular">
    </div>
  </div>
</header>

<div class="faixa">
  <div class="wrap faixaGrid">
${d.numeros.map(([v, r]) => `    <div><b>${esc(v)}</b><span>${esc(r)}</span></div>`).join('\n')}
  </div>
</div>

<section>
  <div class="wrap narrow">
    <h2>${esc(d.dorTitulo)}</h2>
    <div class="falas">
${d.falas.map((f) => `      <p class="fala">${esc(f)}</p>`).join('\n')}
    </div>
    <p class="muted" style="margin-top:26px">${esc(d.dorTexto)}</p>
  </div>
</section>

<section style="background:var(--bg2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="narrow" style="text-align:center">
      <span class="eyebrow">${esc(d.recebeEyebrow)}</span>
      <h2>${esc(d.recebeTitulo)}</h2>
    </div>
    <div class="mods">
${d.mods.map(([n, t, p2, tag]) => `      <div class="mod">
        <span class="modNum">${esc(n)}</span>
        <h3>${esc(t)}</h3>
        <p>${esc(p2)}</p>
        <span class="modTag">${esc(tag)}</span>
      </div>`).join('\n')}
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="narrow" style="text-align:center;margin-bottom:48px">
      <span class="eyebrow">${esc(d.dentroEyebrow)}</span>
      <h2>${esc(d.dentroTitulo)}</h2>
    </div>
${d.pecas.map(([t, p2, img], i) => `    <div class="peca${i % 2 ? ' inverso' : ''}">
      <div class="pecaTxt">
        <span class="pecaSelo">Por dentro</span>
        <h3>${esc(t)}</h3>
        <p>${esc(p2)}</p>
      </div>
      <div class="pecaArte">
${janela(d, img, t, false)}
      </div>
    </div>`).join('\n')}
  </div>
</section>

<section style="background:var(--bg2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)">
  <div class="wrap">
    <div class="narrow" style="text-align:center">
      <span class="eyebrow">${esc(d.compEyebrow)}</span>
      <h2>${esc(d.compTitulo)}</h2>
    </div>
    <div class="comp">
      <div class="compCard mau">
        <h3>${esc(d.compMauTitulo)}</h3>
        <ul>
${d.compMau.map((l) => `          <li>${esc(l)}</li>`).join('\n')}
        </ul>
      </div>
      <div class="compCard bom">
        <h3>${esc(d.compBomTitulo)}</h3>
        <ul>
${d.compBom.map((l) => `          <li>${esc(l)}</li>`).join('\n')}
        </ul>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap narrow">
    <span class="eyebrow">${esc(d.comoEyebrow)}</span>
    <h2>${esc(d.comoTitulo)}</h2>
    <div class="passos">
${d.passos.map(([t, p2], i) => `      <div class="passo">
        <span class="passoN">${i + 1}</span>
        <div><h3>${esc(t)}</h3><p>${esc(p2)}</p></div>
      </div>`).join('\n')}
    </div>
  </div>
</section>

<section class="oferta" id="comprar">
  <div class="wrap">
    <div class="ofertaBox">
      <span class="eyebrow">Acesso imediato</span>
      <h2 style="margin-bottom:6px">${esc(d.ofertaTitulo)}</h2>
      <div class="preco">R$ ${esc(d.preco)}<small> à vista</small></div>
      <p class="muted" style="font-size:14.5px">${esc(d.precoNota)}</p>
      <ul class="ofertaLista">
${d.ofertaLista.map((l) => `        <li>${esc(l)}</li>`).join('\n')}
      </ul>
      ${cta('oferta')}
      <span class="ctaNota">${esc(d.ctaNota)}</span>
      <div class="garantia">
        <span class="selo amber">✓</span>
        <p><strong>7 dias para pedir o dinheiro de volta.</strong> Comprou, entrou e não era o que
        você esperava? Pede o reembolso e a gente devolve, sem discussão. É o prazo de arrependimento
        que a lei te dá em compra pela internet — a gente só está lembrando que ele existe.</p>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="wrap narrow">
    <h2>Perguntas que todo mundo faz</h2>
${d.faq.map(([q, r]) => `    <details>
      <summary>${esc(q)}</summary>
      <p>${esc(r)}</p>
    </details>`).join('\n')}
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap narrow" style="text-align:center">
    <h2>${esc(d.fechaTitulo)}</h2>
    <p class="muted">${esc(d.fechaTexto)}</p>
    ${cta('final')}
    <span class="ctaNota">${esc(d.ctaNota)}</span>
  </div>
</section>

<footer>
  <div class="wrap">
    <p>SolarDoc Pro — documentos e ferramentas para integradores solares</p>
    <p>Dúvidas: <a href="https://wa.me/5534991360223">WhatsApp (34) 99136-0223</a> ·
       <a href="/privacidade/">Privacidade</a></p>
  </div>
</footer>

<div class="barra">
  ${cta('barra')}
</div>

</body>
</html>
`;
}

// ── gera ──
const so = process.argv[2];
let sharp = null;
try { sharp = require('c:/Users/55349/Desktop/CLAUDE/dashboard/node_modules/sharp'); } catch (e) { }

(async () => {
  for (const d of PAGINAS) {
    if (so && d.pasta !== so) continue;
    const dir = path.join(RAIZ, d.pasta);
    fs.mkdirSync(path.join(dir, 'img'), { recursive: true });

    // png -> webp: o peso da lander e' imagem, nao HTML
    if (sharp) {
      for (const n of ['tela', 'celular']) {
        const src = path.join(dir, 'img', n + '.png');
        if (fs.existsSync(src)) {
          await sharp(src).webp({ quality: 82 }).toFile(path.join(dir, 'img', n + '.webp'));
          fs.unlinkSync(src);
        }
      }
    }
    const html = pagina(d);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
    const imgs = fs.readdirSync(path.join(dir, 'img'))
      .map((f) => (fs.statSync(path.join(dir, 'img', f)).size / 1024).toFixed(0) + 'KB ' + f).join(' + ');
    console.log(`/${d.pasta.padEnd(23)} html ${kb}KB   ${imgs}`);
  }
})();
