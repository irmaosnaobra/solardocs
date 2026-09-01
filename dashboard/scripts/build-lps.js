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
{
  // ── O PONTO CERTO ────────────────────────────────────────────────────────
  // Produto de R$297 pra quem tem capital e não tem local: os 184 investidores
  // da base do eletroposto. A régua de ponto próprio (29/08) cortou essa gente
  // da agenda dos sócios, e esta página é o destino deles — aprende o difícil,
  // acha o ponto, e volta como cliente da obra.
  //
  // CHECKOUT: enquanto o produto não existe na Kiwify, o botão abre conversa no
  // WhatsApp da linha IO com a mensagem pronta. Vender atendido por gente é
  // honesto enquanto os instrumentos estão sendo empacotados; trocar por
  // 'https://pay.kiwify.com.br/...' quando o produto estiver criado.
  pasta: 'ponto-certo',
  titulo: 'O Ponto Certo — como achar, negociar e fechar o local do seu eletroposto',
  descricao: 'Você tem o capital e não tem o lugar. Este material é a régua que a gente usa pra escolher um ponto, chegar no dono do imóvel sem levantar a lebre e fechar um contrato longo antes de gastar o primeiro real. Sete aulas e doze instrumentos, R$ 297.',
  ogTitulo: 'O Ponto Certo — R$ 297',
  checkout: 'https://pay.kiwify.com.br/BtebJFP',
  preco: '297',
  precoNota: 'pagamento único · acesso a todo o material e aos instrumentos',
  ctaTexto: 'Quero o material por R$ 297 →',
  eyebrow: 'Para quem tem o capital e ainda não tem o local',
  aspas: '“Estou inclinado a arrumar até loja. Mas ainda não consegui.”',
  h1: ['O dinheiro não é o seu problema. ', 'O ponto é.'],
  heroSub: 'Quem já montou eletroposto sabe: o negócio se ganha ou se perde no local, e o local se perde na hora em que o dono do imóvel descobre o que vai nascer ali. Este material é a régua que a gente usa — pra escolher o ponto, chegar no proprietário sem levantar a lebre e fechar um contrato que se sustenta.',
  bullets: [
    'Dez endereços na mesa e sete riscados sem você sair de casa',
    'A leitura da conta de luz e do disjuntor que diz se o ponto aguenta',
    'O que falar nos primeiros 30 segundos — e as nove frases que queimam a conversa',
    'A régua que transforma qualquer aluguel pedido em carros por dia',
    'O term sheet de 12 campos que vai para o advogado',
  ],
  ctaNota: 'Quem já tem o ponto sob controle não precisa disto — marque uma reunião com a gente',
  telaUrl: 'solardoc.app/ponto-certo',
  // Fotos reais das estações. Legenda honesta: são os equipamentos que a gente
  // instala, fotografados na fábrica — não são obra entregue, e a página não diz
  // que são. Convertidas para webp (de ~1 MB para ~630 KB no total) e todas com
  // lazy, menos a primeira.
  marca: 'Irmãos na Obra',
  favicon: true,
  heroFoto: 'estacao-branca.webp',
  logo: 'logo-io.webp',
  autoridade: {
    eyebrow: 'Quem está te ensinando',
    titulo: 'A régua deste material é a que a gente usa quando escolhe um ponto',
    texto: 'A Irmãos na Obra monta eletroposto de recarga chave na mão: projeto, equipamento, obra e a operação depois. Não somos uma escola que resolveu falar de carro elétrico — somos quem vai ao local, lê a conta de luz, protocola na distribuidora e assina o contrato. Este material é o nosso processo escrito, sem a parte que a gente cobra para fazer.',
    itens: [
      ['Chave na mão, de verdade', 'Projeto, equipamento, obra e comissionamento. Quem escreveu as aulas é quem assina a ART e responde pelo ponto depois de pronto.'],
      ['236 reuniões de projeto', 'Desde julho de 2026, conduzidas por nós dois. A régua de energia, fluxo e negociação saiu dessas conversas — inclusive dos pontos que a gente recusou.'],
      ['Os contratos existem', 'Turnkey e operação da plataforma escritos e em uso. O term sheet que você recebe é o mesmo esqueleto que a gente leva para a mesa.'],
      ['O simulador é nosso', 'Carga, carros por dia, ticket, custo de energia e payback — a ferramenta que roda a viabilidade dos nossos pontos é a mesma que está por trás das contas deste material.'],
    ],
    assinatura: 'Somos o Thiago e o Diego, irmãos, do Triângulo Mineiro. A gente não vende curso: vende eletroposto. Este material existe porque a parte que trava o cliente — achar o lugar — é justamente a que a gente não consegue fazer por ele.',
  },
  topoSelo: 'Material completo · 7 dias de garantia',
  donosTexto: 'Somos o Thiago e o Diego, irmãos, do Triângulo Mineiro. A gente monta eletroposto chave na mão — projeto, equipamento e obra. Este material é a régua que a gente usa quando escolhe um ponto, escrita do jeito que a gente explicaria para um sócio.',
  rodape: 'Irmãos na Obra — eletroposto de recarga chave na mão',
  app: {
    eyebrow: 'A tela que você abre depois de comprar',
    titulo: 'O material mora num app, e ele foi feito pro celular',
    sub: 'Você abre no telefone, no meio da rua, na frente do imóvel. As aulas avançam em telas curtas e os instrumentos ficam a um toque — a ficha se preenche ali mesmo, em pé no local.',
    telas: [
      ['app-curso.webp', 'As sete aulas, com o que você já concluiu'],
      ['app-aula.webp', 'A aula avança em telas curtas, uma ideia por vez'],
      ['app-travas.webp', 'As sete travas que matam um endereço de graça'],
      ['app-ficha.webp', 'A ficha de vistoria preenchida em pé, no local'],
      ['app-placar.webp', 'O placar fechando em A, B, C ou X'],
    ],
  },
  instrEyebrow: 'Não é PDF de curso. É o material de trabalho',
  instrTitulo: 'Os documentos que você abre e usa',
  instrSub: 'Aula ninguém aplica depois. Instrumento você abre no local, preenche em pé e leva na conversa. É por eles que se paga R$ 297.',
  instrumentos: [
    ['inst-ficha.webp', 'Ficha de vistoria', 'Sete blocos, feita para o celular. O bloco 0 se responde antes de você entrar no carro — e se travar ali, você não vai.'],
    ['inst-placar.webp', 'Placar de 30 pontos', 'Energia, fluxo, vaga, visibilidade e segurança. No fim sai uma letra: A, B, C ou X.'],
    ['inst-energia.webp', 'Cabe ou não cabe', 'A leitura da conta de luz e do disjuntor, com a corrente de cada configuração. Descarta endereço sem gastar visita.'],
    ['inst-cartao.webp', 'Cartão de bolso', 'Os primeiros 30 segundos nos três canais, o que você pede — e as nove frases que fazem o aluguel subir.'],
    ['inst-proposta.webp', 'Proposta de uma página', 'O papel que fica no balcão do dono, com o croqui anexo. E a lista do que nunca entra nele.'],
    ['inst-termsheet.webp', 'Term sheet de 12 campos', 'O que precisa estar decidido antes de o advogado escrever a primeira linha. Sete campos vêm copiados da proposta.'],
  ],
  dificuldade: {
    eyebrow: 'A conta que ninguém te mostra',
    titulo: 'Ter o dinheiro é a parte fácil. Olha o placar.',
    placar: [
      ['184', 'pessoas na nossa base com capital declarado e nenhum local'],
      ['1', 'ponto disponível, cadastrado por quem tem o imóvel'],
      ['5,4%', 'das reuniões com investidor viram proposta — contra 16,8% de quem já tem o local'],
    ],
    porques: [
      'Quem espera aparecer um ponto está esperando o que não existe: são 184 de um lado e 1 do outro.',
      'Quem sai à procura sem régua visita dez lugares, gasta o mês e não fecha nenhum — e conclui que o mercado é difícil.',
      'Quem chega no dono do imóvel dizendo para que quer o espaço vê o aluguel subir na mesma conversa. O preço deixa de ser de duas vagas paradas e passa a ser de novidade.',
      'Quem assina antes do parecer de acesso paga aluguel de um ponto que pode ser inviável — e esse dinheiro não volta.',
      'E quem erra o contrato erra por anos: 1 ponto percentual de arrendamento custa R$ 144,60 por mês num ponto de dez carros por dia. Dois pontos a mais somam R$ 3.470 no ano, todo ano, num papel que se assina uma vez.',
    ],
    veredito: 'O mercado não é difícil. O ponto é — e ele é a única coisa entre o seu dinheiro e a sua estação.',
  },
  fotosEyebrow: 'O que existe no fim desse caminho',
  fotosTitulo: 'O ponto é a parte difícil. A estação, a gente monta.',
  fotos: [
    ['linha-producao.webp', 'Linha de produção das estações de recarga rápida — o equipamento que vai para o ponto que você fechar.'],
    ['estacao-branca.webp', 'Estação DC com dois bicos: um carro carrega enquanto o outro espera.'],
    ['estacao-dc.webp', 'Painel de recarga rápida em corrente contínua, com os dois conectores no mesmo gabinete.'],
    ['estacao-cinza.webp', 'A mesma estação pronta para embarque. É o que ocupa as duas vagas que você vai negociar.'],
  ],
  numeros: [
    ['7', 'aulas, nenhuma sem uma ação no fim'],
    ['12', 'instrumentos: planilha, ficha, script e modelo'],
    ['R$ 144,60', 'o que 1 ponto de arrendamento custa por mês'],
    ['12', 'campos que fecham o acordo antes do advogado'],
    ['R$ 297', 'uma vez'],
  ],
  dorTitulo: 'Ninguém trava por falta de dinheiro. Trava na porta do dono do imóvel.',
  falas: [
    '“Estou inclinado a arrumar até loja. Mas ainda não consegui.”',
    '“Preciso entender melhor este mercado.”',
    '“Ainda estamos estudando como faremos esse negócio.”',
  ],
  dorTexto: 'São respostas reais de investidores da nossa base, desta semana. Todos têm capital declarado. Nenhum tem o local. O que separa os dois não é dinheiro nem vontade — é não saber qual endereço presta, como chegar no proprietário sem encarecer o aluguel e o que precisa estar escrito antes de assinar.',
  recebeEyebrow: 'As sete aulas',
  recebeTitulo: 'Cada uma termina com você fazendo uma coisa',
  mods: [
    ['01', 'A lista: dez endereços, sete riscados', 'Você abre o aplicativo de recarga, acha o trecho da sua cidade que não tem ponto nenhum e escreve dez endereços. Sete morrem ali mesmo, nas sete travas — e trava mata de graça, antes de qualquer visita.', 'Sem sair da cadeira'],
    ['02', 'Os primeiros 30 segundos', 'O que dizer no balcão, no WhatsApp e no telefone, palavra por palavra. O objetivo da primeira conversa não é fechar nada: é sair de lá com a foto da conta de luz e do padrão de entrada.', 'E as 9 frases proibidas'],
    ['03', 'Cabe ou não cabe: as duas fotos', 'A informação mais cara do negócio é de graça e está na conta de luz. Tipo de ligação, tensão, disjuntor e consumo — e o veredito escrito em uma linha, sem visita técnica.', 'Onde os projetos morrem'],
    ['04', 'A visita e o placar', 'Sete blocos percorridos no local, o movimento medido em vez de sentido, e uma letra escrita no fim: A, B, C ou X. Você sai de lá com nota, não com impressão.', 'Uma visita só'],
    ['05', 'Fixo, percentual ou misto', 'O dono pediu R$ 1.200? São 8,3 carros por dia. A régua converte qualquer pedido em movimento — e traz os dez itens que não se cedem em hipótese nenhuma.', 'E o “quero uma parte”'],
    ['06', 'A proposta de uma página', 'O papel que fica no balcão dele, com o croqui do pátio anexo. Uma página ele lê em pé e pergunta na hora; dez páginas ele guarda para ver com calma, e “com calma” não tem data.', 'O que quase ninguém leva'],
    ['07', 'A ordem de assinar', 'Qual papel se assina antes do parecer e qual não — e os 12 campos que vão para o advogado com as seis perguntas fechadas que ele responde.', 'Term sheet, não minuta'],
  ],
  dentroEyebrow: 'O que sustenta o preço',
  dentroTitulo: 'Aula ninguém aplica. Instrumento você abre e usa',
  compEyebrow: 'A diferença que importa',
  compTitulo: 'Procurar ponto no impulso ou com régua',
  compMauTitulo: 'Do jeito que quase todo mundo faz',
  compMau: [
    'Visita dez lugares e não fecha nenhum',
    'Diz para que é logo na primeira frase e o aluguel sobe',
    'Descobre a energia depois de assinar',
    'Assina arrendamento antes do parecer',
    'Baixa um contrato pronto da internet',
  ],
  compBomTitulo: 'Com o Ponto Certo',
  compBom: [
    'Risca sete de dez sem sair de casa',
    'Sai da primeira conversa com a foto da conta de luz',
    'Escreve o veredito de energia antes de gastar um real',
    'Papel curto agora, contrato de anos só depois do parecer',
    'Term sheet decidido e o advogado só redige',
  ],
  comoEyebrow: 'Como funciona',
  comoTitulo: 'Você não assiste. Você faz junto',
  passos: [
    ['Monte a lista', 'Dez endereços da sua cidade e sete riscados no mesmo dia, pelas sete travas.'],
    ['Vá buscar duas fotos', 'A conversa dos 30 segundos existe para isso: a conta de luz e o padrão de entrada.'],
    ['Feche com papel', 'Placar escrito, proposta de uma página no balcão do dono e os 12 campos no e-mail do advogado.'],
  ],
  ofertaTitulo: 'Custa menos que um mês de aluguel errado',
  ofertaLista: [
    'As 7 aulas, nenhuma sem uma ação no fim',
    'A lista dos 10 e as 7 travas que matam um endereço de graça',
    'O cartão de bolso: três scripts e as nove frases proibidas',
    'A planilha de energia e as quatro fotos que dispensam visita',
    'A ficha de vistoria em sete blocos e o placar de 30 pontos',
    'A régua de negociação e os dez itens inegociáveis',
    'A proposta de uma página e o term sheet de 12 campos',
  ],
  faq: [
    ['Vocês acham o ponto para mim?', 'Não. A gente te ensina a achar. Quem bate na porta é você — somos dois sócios com agenda cheia em Uberlândia, não visitamos imóvel em outra cidade e não vamos fingir que visitamos.'],
    ['Serve para a minha cidade?', 'Serve. A régua de energia, fluxo, vaga e negociação é a mesma no Brasil inteiro. O que muda de cidade para cidade é a distribuidora — e quem lê a norma dela é o projetista local.'],
    ['Preciso já ter um local em vista?', 'Não. A primeira aula começa antes disso: como descartar dez endereços sem sair de casa.'],
    ['Isso substitui advogado?', 'Não, e desconfie de quem disser que sim. Você sai com as 12 decisões fechadas para entregar ao seu advogado. Isso encurta o trabalho dele e barateia a sua conta — não elimina.'],
    ['Sou obrigado a comprar o eletroposto de vocês depois?', 'Não. A gente monta eletroposto chave na mão e obviamente gostaria de montar o seu. A régua que está aqui dentro funciona igual se você comprar de outro fornecedor.'],
    ['Eu já tenho o ponto. Serve para mim?', 'Não compre. Se o local é seu, você administra, representa o proprietário ou é inquilino com anuência, o seu próximo passo é uma reunião de projeto com a gente — não um material sobre como achar ponto.'],
  ],
  fechaTitulo: 'O ponto que você ainda não tem é a única coisa entre você e a estação',
  fechaTexto: 'Sete aulas, doze instrumentos e a régua que a gente usa quando escolhe um local. R$ 297, pagamento único. Se você já tem o ponto, fale com a gente direto — a sua conversa é outra.',
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


  /* ── APARELHOS: notebook aberto + celular encostado ──────────
     Desenhados em CSS, sem imagem: fica nitido em qualquer tela, pesa nada e
     a tela de dentro pode rolar de verdade. */
  .aparelhos { position: relative; padding-bottom: 34px; }

  .note { position: relative; width: 100%; }
  .noteTampa {
    position: relative;
    background: #0b1320;
    border: 9px solid #1b2740;
    border-bottom-width: 6px;
    border-radius: 13px 13px 5px 5px;
    overflow: hidden;
    box-shadow: 0 34px 74px -30px rgba(0,0,0,.95), inset 0 0 0 1px rgba(148,163,184,.1);
    aspect-ratio: 16 / 10.2;
  }
  .noteBarra {
    position: absolute; inset: 0 0 auto 0; z-index: 2; height: 30px;
    display: flex; align-items: center; gap: 6px;
    padding: 0 12px; background: #0e1728; border-bottom: 1px solid var(--line);
  }
  .noteBarra i { width: 8px; height: 8px; border-radius: 50%; background: #33415c; display: block; }
  .noteBarra span {
    margin-left: 8px; font-size: 10.5px; color: #64768f;
    font-family: ui-monospace, Menlo, Consolas, monospace;
  }
  /* a janela por onde se ve' a tela; o conteudo dentro e' mais alto e sobe */
  .noteVisor { position: absolute; inset: 30px 0 0 0; overflow: hidden; }
  .noteBase {
    height: 11px; margin: 0 -7%;
    background: linear-gradient(180deg, #2a3852, #131c2e);
    border-radius: 0 0 13px 13px;
    box-shadow: 0 16px 30px -14px rgba(0,0,0,.9);
  }
  .noteBase::after {
    content: ''; display: block; width: 16%; height: 3px; margin: 0 auto;
    background: #0b1320; border-radius: 0 0 4px 4px;
  }

  /* O celular encosta na QUINA de baixo e pende pra FORA. Antes ficava em
     cima do meio do notebook e escondia os valores da direita — que sao
     justamente o que a tela tem de mais importante (preco, sobra, total). */
  .fone {
    /* -4% e nao -10%: a 1000px de janela o celular passava 20px da borda e o
       overflow-x do body cortava ele ao meio. A sobra tem que caber na margem
       do .wrap (24px), e 4% da coluna da arte da' no maximo 20px em 1280. */
    position: absolute; right: -4%; bottom: -34px; z-index: 3;
    width: 22%; max-width: 130px;
    background: #0b1320;
    border: 6px solid #1b2740; border-radius: 22px;
    overflow: hidden; aspect-ratio: 9 / 17.5;
    box-shadow: 0 26px 54px -18px rgba(0,0,0,.95);
  }
  .foneEntalhe {
    position: absolute; top: 6px; left: 50%; transform: translateX(-50%); z-index: 2;
    width: 34%; height: 5px; border-radius: 99px; background: #1b2740;
  }
  .foneVisor { position: absolute; inset: 0; overflow: hidden; }

  /* ── a rolagem ──
     translateY em porcentagem do PROPRIO conteudo: assim vale pra qualquer
     altura de tela sem eu ter que saber o pixel exato. Sobe, segura em cima e
     em baixo (as pausas sao onde o olho le) e volta. */
  .rolagem { animation: rolar 26s ease-in-out infinite; }
  .fone .rolagem { animation-duration: 22s; animation-delay: -6s; }
  @keyframes rolar {
    0%, 7%    { transform: translateY(0); }
    48%, 57%  { transform: translateY(-52%); }
    93%, 100% { transform: translateY(0); }
  }

  /* ── a tela do produto reproduzida ── */
  .app { padding: 14px 15px 26px; font-size: 12.5px; line-height: 1.4; }
  /* A faixa da direita fica livre pro celular: sem isto o valor termina
     debaixo dele. Em PORCENTAGEM, nao em pixel: o celular tem 22% de largura e
     sobra 4% pra fora, entao ele cobre 18% — 22% de reserva limpa em qualquer
     tamanho de tela. Com pixel fixo, telas maiores voltavam a esconder. */
  @media (min-width: 901px) { .note .app { padding-right: 22%; } }
  .app h4 {
    font-size: 9.5px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase;
    color: var(--muted); margin: 16px 0 8px;
  }
  .app h4:first-child { margin-top: 0; }
  .aLinha {
    display: flex; justify-content: space-between; gap: 10px;
    padding: 7px 0; border-bottom: 1px solid rgba(148,163,184,.12); color: #cfd9e6;
  }
  .aLinha b { color: #fff; font-weight: 700; white-space: nowrap; }
  .aLinha.total { border-bottom: none; padding-top: 10px; font-size: 14px; }
  .aLinha.total b { color: var(--amber); }
  .aLinha.alerta b { color: #ff9d8f; }
  .aCartao {
    background: rgba(148,163,184,.07); border: 1px solid rgba(148,163,184,.16);
    border-radius: 10px; padding: 10px 12px; margin: 8px 0;
  }
  .aCartao span {
    display: block; font-size: 8.5px; font-weight: 800; letter-spacing: .1em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 3px;
  }
  .aCartao b { font-size: 16px; font-weight: 800; letter-spacing: -.02em; }
  .aCartao.bom { border-color: rgba(74,222,128,.32); background: rgba(74,222,128,.07); }
  .aCartao.bom b { color: var(--green); }
  .aDupla { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .aBarra { height: 6px; border-radius: 99px; background: rgba(148,163,184,.2); margin: 9px 0 4px; overflow: hidden; }
  .aBarra i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--amber-d), var(--amber)); }
  .aItem { display: flex; align-items: center; gap: 9px; padding: 6px 0; color: #cfd9e6; }
  .aCheck {
    flex: none; width: 15px; height: 15px; border-radius: 5px;
    background: var(--amber); position: relative;
  }
  .aCheck::after {
    content: ''; position: absolute; left: 4px; top: 2.5px; width: 4px; height: 7px;
    border-right: 2px solid #0a0f1a; border-bottom: 2px solid #0a0f1a; transform: rotate(45deg);
  }
  .aCheck.off { background: transparent; border: 1.5px solid rgba(148,163,184,.4); }
  .aCheck.off::after { display: none; }
  .aTag {
    display: inline-block; font-size: 9.5px; font-weight: 800; color: #0a0f1a;
    background: var(--amber); padding: 2px 8px; border-radius: 99px; margin-bottom: 6px;
  }
  .fone .app { padding: 11px 8px 20px; font-size: 9.5px; }
  .fone .app h4 { font-size: 7.5px; margin: 12px 0 6px; }
  .fone .aCartao b { font-size: 12px; }
  /* Empilhado: em 112px de largura "Piso que ainda da' lucro" quebrava em
     quatro linhas ao lado do valor e virava sopa de letra. */
  .fone .aLinha { padding: 5px 0; flex-direction: column; align-items: flex-start; gap: 1px; }
  .fone .aLinha b { font-size: 11px; }
  .fone .aTag { font-size: 8px; }
  .fone .aDupla { grid-template-columns: 1fr; }

  @media (max-width: 900px) { .fone { display: none; } }
  @media (prefers-reduced-motion: reduce) { .rolagem { animation: none !important; } }


  /* -- FUNCIONA EM: os sistemas ------------------------
     Responde "abre no meu aparelho?" antes de a pessoa perguntar. Silhuetas
     DESENHADAS, nao logo oficial de terceiro: marca alheia em pagina de venda
     cria problema de uso de marca sem necessidade, e uma silhueta reconhecivel
     ja' responde a pergunta. */
  .rodaEm { margin-top: 22px; }
  .rodaEmTitulo {
    display: block; font-size: 10px; font-weight: 800; letter-spacing: .18em;
    text-transform: uppercase; color: #64768f; margin-bottom: 10px;
  }
  .rodaEmLista { list-style: none; display: flex; flex-wrap: wrap; align-items: center; gap: 9px; margin: 0 0 10px; }
  .rodaEmLista li {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 7px 12px 7px 10px; border-radius: 10px;
    border: 1px solid var(--line); background: rgba(148,163,184,.06);
    font-size: 12.5px; font-weight: 600; color: #cfd9e6;
  }
  .rodaEmLista svg { flex: none; color: var(--muted); }
  .rodaEmNota { font-size: 12.5px; color: var(--muted); margin: 0; }
  .rodaEmNota b { color: var(--text); font-weight: 700; }
  @media (max-width: 420px) {
    .rodaEmLista { gap: 7px; }
    .rodaEmLista li { padding: 6px 10px 6px 8px; font-size: 11.5px; }
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

  /* Selo de compra segura — as TRES referencias tem, as minhas nao tinham.
     Numa compra de R$ 67 de quem nunca ouviu falar da gente, e' a linha que
     tira o ultimo medo antes do cartao. */
  .seguro {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    font-size: 12.5px; color: var(--muted); margin-top: 14px;
  }
  .seguro svg { flex: none; }

  /* Quem fez — a home tem, a /kit nao. Vale mais numa venda pra desconhecido
     do que qualquer adjetivo sobre a ferramenta: a pessoa esta' dando o cartao
     pra um site na internet. */
  .donos {
    display: flex; gap: 22px; align-items: center; flex-wrap: wrap;
    background: var(--surface); border: 1px solid var(--line);
    border-radius: var(--radius); padding: 28px 30px;
  }
  .donosFotos { display: flex; flex: none; }
  .donosFotos img {
    width: 74px; height: 74px; border-radius: 50%; object-fit: cover;
    border: 3px solid var(--surface); box-shadow: 0 6px 18px rgba(0,0,0,.5);
  }
  .donosFotos img + img { margin-left: -22px; }
  .donosTxt { flex: 1 1 320px; min-width: 0; }
  .donosTxt h3 { font-size: 20px; margin-bottom: 8px; }
  .donosTxt p { color: var(--muted); font-size: 15.5px; margin: 0; }

  /* Depoimentos: a secao EXISTE e fica escondida ate' haver depoimento real —
     e' o que a /kit faz. Inventar frase de cliente e' o caminho curto pro
     reembolso. */
  .depoGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 16px; }
  .depo {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: 16px; padding: 24px 22px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .depoEstrelas { display: flex; gap: 3px; color: var(--amber); }
  .depoTexto { font-size: 15.5px; line-height: 1.7; color: #dfe6f0; margin: 0; }
  .depoAutor { font-size: 13px; color: var(--muted); margin: 0; }
  .depoAutor b { color: var(--text); font-weight: 700; display: block; font-size: 14px; }


  /* ── MOCKUP ANIMADO ──────────────────────────────────
     Um ciclo de 16s por demo. Cada cena entra, fica e sai; o resto do
     movimento (barra, rolo de numeros, marca de check) roda no mesmo compasso.
     Tudo em CSS: sem GIF, sem video, sem script. */
  .demo {
    position: relative; background: var(--surface);
    padding: 20px 22px; min-height: 372px;
    font-size: 14px; line-height: 1.45; overflow: hidden;
  }
  .demoTopo {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 10.5px; font-weight: 800; letter-spacing: .13em;
    text-transform: uppercase; color: var(--muted);
    padding-bottom: 12px; margin-bottom: 14px; border-bottom: 1px solid var(--line);
  }
  .demoVivo { display: inline-flex; align-items: center; gap: 6px; color: var(--green); }
  .demoVivo i {
    width: 6px; height: 6px; border-radius: 50%; background: var(--green);
    animation: demoPisca 2s ease-in-out infinite;
  }
  @keyframes demoPisca { 0%, 100% { opacity: 1 } 50% { opacity: .25 } }

  .cena { position: absolute; left: 22px; right: 22px; top: 66px; opacity: 0; }
  /* Timing LINEAR de proposito: o ease padrao faz a opacidade demorar a sair
     do zero nas duas pontas, e a soma disso dava 0,22s de moldura vazia a cada
     virada. Linear reparte o fade por igual e a piscada some.
     (E sem crase nenhuma neste comentario: o CSS mora dentro de um template
     literal do JS, entao uma crase aqui fecha a string e quebra o gerador.) */
  .demo[data-cenas="4"] .cena { animation: cena4 16s linear infinite; }
  /* AS CENAS ESTAVAM TOCANDO FORA DE ORDEM: 4, 1, 2, 3 — comecava pela
     resposta (preco, autonomia) e so' depois mostrava as perguntas. Sentido
     invertido justamente no que a demo existe pra contar.
     A culpa era do nth-of-type: ele conta irmaos do MESMO TIPO, nao da mesma
     classe. Dentro do .demo o primeiro <div> e' o .demoTopo, entao
     nth-of-type(2) pegava a cena 1, nth-of-type(3) a cena 2... e a cena 4
     ficava sem atraso nenhum e abria o ciclo.
     A cadeia de "~" conta so' os .cena e nao se importa com quem mais e' div. */
  .demo[data-cenas="4"] .cena ~ .cena { animation-delay: 4s; }
  .demo[data-cenas="4"] .cena ~ .cena ~ .cena { animation-delay: 8s; }
  .demo[data-cenas="4"] .cena ~ .cena ~ .cena ~ .cena { animation-delay: 12s; }
  /* SEM SOBREPOSICAO E SEM BURACO.
     Tentei os dois extremos e os dois quebram:
     · encostando (saida em 25%, entrada em 25%) sobrava um piscar de 160ms
       com a moldura vazia;
     · cruzando (saida em 27%) as duas cenas ficavam meio transparentes ao
       mesmo tempo e o texto de uma aparecia POR CIMA da outra — da' pra ler
       "PRECO AO CLIENTE" atras de "Material CA". Le como defeito, nao como
       transicao.
     Entao a saida termina exatamente em 25%, quando a proxima comeca a
     entrar, e a entrada dura 1,5% (0,24s): rapido demais pro olho registrar
     como vazio, e sem nenhum quadro com as duas na tela. */
  @keyframes cena4 {
    0%          { opacity: 0; transform: translateY(10px); }
    1.5%, 23.5% { opacity: 1; transform: none; }
    25%, 100%   { opacity: 0; transform: translateY(-6px); }
  }

  /* linha de valor */
  .dLinha {
    display: flex; justify-content: space-between; gap: 12px;
    padding: 9px 0; border-bottom: 1px solid var(--line); color: #cfd9e6;
  }
  .dLinha b { color: #fff; font-weight: 700; }
  .dLinha.forte { border-bottom: none; padding-top: 13px; font-size: 15.5px; }
  .dLinha.forte b { color: var(--amber); }

  /* entra uma a uma */
  .dEntra { opacity: 0; animation: dEntra 16s infinite; }
  .dEntra:nth-of-type(1) { animation-delay: .25s; }
  .dEntra:nth-of-type(2) { animation-delay: .65s; }
  .dEntra:nth-of-type(3) { animation-delay: 1.05s; }
  .dEntra:nth-of-type(4) { animation-delay: 1.45s; }
  .dEntra:nth-of-type(5) { animation-delay: 1.85s; }
  @keyframes dEntra {
    0%     { opacity: 0; transform: translateX(-8px); }
    2%, 22% { opacity: 1; transform: none; }
    25%, 100% { opacity: 0; }
  }

  /* rolo de numeros: a coluna desliza e so' um valor aparece por vez */
  /* O rolo NAO PODE QUEBRAR LINHA. Como e' inline-block, quando nao cabia ao
     lado do "R$" ele descia pra linha seguinte e o cartao mostrava "R$" em cima
     e "30.605" embaixo, como se fosse outro campo. O nowrap fica no PAI (o <b>),
     que e' quem decide a quebra. */
  .rolo { display: inline-block; height: 1.15em; line-height: 1.15; overflow: hidden; vertical-align: bottom; }
  .dCard b, .dLinha b, .demo .amber { white-space: nowrap; }
  .rolo span { display: block; height: 1.15em; }
  .rolo.r4 span { animation: rolo4 16s steps(1) infinite; }
  @keyframes rolo4 {
    0%,   24% { transform: translateY(0); }
    25%,  49% { transform: translateY(-1.15em); }
    50%,  74% { transform: translateY(-2.3em); }
    75%, 100% { transform: translateY(-3.45em); }
  }

  /* controle de margem que anda sozinho */
  .dBarra { height: 7px; border-radius: 99px; background: rgba(148,163,184,.22); position: relative; margin: 12px 0 6px; }
  .dBarraFill {
    position: absolute; inset: 0 auto 0 0; border-radius: 99px;
    background: linear-gradient(90deg, var(--amber-d), var(--amber));
    animation: dBarra 16s cubic-bezier(.6,0,.2,1) infinite;
  }
  .dBarraPino {
    position: absolute; top: 50%; width: 15px; height: 15px; border-radius: 50%;
    background: var(--amber); border: 2px solid #10192b; transform: translate(-50%, -50%);
    animation: dPino 16s cubic-bezier(.6,0,.2,1) infinite;
  }
  /* A barra anda em DEGRAUS, no mesmo compasso do rolo de numeros (a cada 25%
     do ciclo). Ela era ease-in-out continua: dentro dos 4s de uma cena a barra
     encolhia enquanto o "34%" ficava parado do lado, e o olho pega. */
  @keyframes dBarra {
    0%,  23% { width: 26% }  25%, 48% { width: 42% }
    50%, 73% { width: 68% }  75%, 100% { width: 55% }
  }
  @keyframes dPino {
    0%,  23% { left: 26% }   25%, 48% { left: 42% }
    50%, 73% { left: 68% }   75%, 100% { left: 55% }
  }

  /* dois cartoes de resultado */
  .dCards { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
  .dCard { background: rgba(148,163,184,.08); border: 1px solid var(--line); border-radius: 11px; padding: 12px 13px; }
  /* FILHO DIRETO, nao qualquer span. Escrito sem o sinal de filho, a regra
     pegava tambem os <span> dos numeros dentro do rolo: o valor do cartao saia
     a 9,5px em CAIXA ALTA e cinza, quando devia ser 19px branco. O rotulo e' o
     span que fica direto no cartao; o valor mora dentro do <b>.
     (Sem crase neste comentario: o CSS mora num template literal do JS.) */
  .dCard > span { display: block; font-size: 9.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
  .dCard b { font-size: 19px; font-weight: 800; letter-spacing: -.02em; }
  .dCard.bom { border-color: rgba(74,222,128,.35); background: rgba(74,222,128,.08); }
  .dCard.bom b { color: var(--green); }

  /* item marcavel */
  .dItem { display: flex; align-items: center; gap: 11px; padding: 8px 0; color: #cfd9e6; }
  .dCheck {
    flex: none; width: 19px; height: 19px; border-radius: 6px;
    border: 1.5px solid var(--line2); position: relative;
  }
  .dCheck::after {
    content: ''; position: absolute; left: 5px; top: 3px; width: 5px; height: 9px;
    border-right: 2px solid #0a0f1a; border-bottom: 2px solid #0a0f1a;
    transform: rotate(45deg) scale(0); transform-origin: center;
  }
  .dEntra .dCheck { animation: dCaixa 16s infinite; }
  .dEntra .dCheck::after { animation: dTique 16s infinite; }
  @keyframes dCaixa {
    0%, 3%   { background: transparent; border-color: var(--line2); }
    6%, 22%  { background: var(--amber); border-color: var(--amber); }
    25%, 100% { background: transparent; border-color: var(--line2); }
  }
  @keyframes dTique {
    0%, 4%   { transform: rotate(45deg) scale(0); }
    7%, 22%  { transform: rotate(45deg) scale(1); }
    25%, 100% { transform: rotate(45deg) scale(0); }
  }

  /* barra de autonomia / patrimonio enchendo */
  .dTanque { height: 10px; border-radius: 99px; background: rgba(148,163,184,.18); overflow: hidden; margin: 10px 0; }
  .dTanque i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--green), #22d3ee); animation: dEnche 16s ease-out infinite; }
  @keyframes dEnche { 0% { width: 8% } 15%, 24% { width: 92% } 25%, 100% { width: 8% } }

  /* alerta de estoque minimo */
  .dAlerta {
    display: flex; align-items: center; gap: 9px; margin-top: 12px;
    background: rgba(239,106,90,.1); border: 1px solid rgba(239,106,90,.36);
    border-radius: 10px; padding: 10px 12px; font-size: 13px; color: #ffc9c1;
    animation: dAlerta 16s infinite;
  }
  .dAlerta b { color: #ff9d8f; }
  @keyframes dAlerta {
    0%, 8%   { opacity: 0; transform: translateY(6px); }
    12%, 22% { opacity: 1; transform: none; }
    25%, 100% { opacity: 0; }
  }

  .demoNota {
    position: absolute; left: 22px; right: 22px; bottom: 16px;
    font-size: 11.5px; color: #64768f; text-align: center;
  }

  @media (max-width: 720px) { .demo { min-height: 392px; } }

  /* Movimento reduzido: congela na cena 4, que e' a que tem a resposta —
     preco, autonomia ou patrimonio. Pagina parada tem que continuar
     explicando o produto. */
  @media (prefers-reduced-motion: reduce) {
    .demo .cena { animation: none !important; opacity: 0; }
    .demo .cena:last-of-type { opacity: 1; }
    .demo .dEntra, .demo .dCheck, .demo .dCheck::after,
    .demo .dBarraFill, .demo .dBarraPino, .demo .dTanque i,
    .demo .dAlerta, .demo .rolo span, .demo .demoVivo i { animation: none !important; opacity: 1; }
    .demo .dCheck { background: var(--amber); border-color: var(--amber); }
    .demo .dCheck::after { transform: rotate(45deg) scale(1); }
    .demo .dBarraFill { width: 68%; } .demo .dBarraPino { left: 68%; }
    .demo .dTanque i { width: 92%; }
    .demo .rolo span { transform: translateY(-3.45em); }
  }

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
/**
 * O MOCKUP ANIMADO de cada produto — o gesto que define a ferramenta.
 *
 * Nao e' GIF de proposito: GIF de tela de app serrilha (256 cores), pesa
 * megabytes e nao para pra quem tem "reduzir movimento" ligado. Isto sai em
 * ~4 KB dentro do HTML que ja' existe, fica nitido em qualquer densidade e
 * congela sozinho no quadro que responde (preco, autonomia, patrimonio).
 * Sem JS: anima com script bloqueado.
 *
 * Os numeros que mudam usam o "rolo": uma coluna de valores empilhados numa
 * janela de altura fixa, deslizando em steps() — como marcador de placar.
 */
const TELAS = {
  "calculadora": "\n      <div class=\"app\">\n        <h4>Custos da obra</h4>\n        <div class=\"aLinha\"><span>Kit fotovoltaico</span><b>R$ 18.400</b></div>\n        <div class=\"aLinha\"><span>Material CA</span><b>R$ 1.240</b></div>\n        <div class=\"aLinha\"><span>Mão de obra</span><b>R$ 3.200</b></div>\n        <div class=\"aLinha\"><span>Deslocamento</span><b>R$ 480</b></div>\n        <div class=\"aLinha\"><span>ART</span><b>R$ 590</b></div>\n        <div class=\"aLinha\"><span>Homologação</span><b>R$ 300</b></div>\n        <div class=\"aLinha total\"><span>Custo total</span><b>R$ 24.210</b></div>\n        <h4>Imposto e comissão</h4>\n        <div class=\"aLinha\"><span>NF sobre o serviço · 6%</span><b>R$ 552</b></div>\n        <div class=\"aLinha\"><span>Comissão do vendedor · 3%</span><b>R$ 920</b></div>\n        <h4>Margem</h4>\n        <div class=\"aLinha\" style=\"border:none\"><span>Sua margem</span><b class=\"amber\">28%</b></div>\n        <div class=\"aBarra\"><i style=\"width:58%\"></i></div>\n        <div class=\"aDupla\">\n          <div class=\"aCartao\"><span>Preço ao cliente</span><b>R$ 33.156</b></div>\n          <div class=\"aCartao bom\"><span>Sobra pra você</span><b>R$ 9.284</b></div>\n        </div>\n        <h4>Limite de negociação</h4>\n        <div class=\"aLinha\"><span>Piso que ainda dá lucro</span><b>R$ 26.259</b></div>\n        <div class=\"aLinha\"><span>Desconto máximo</span><b>20,8%</b></div>\n        <div class=\"aLinha\"><span>Preço por kWp</span><b>R$ 4.043</b></div>\n        <h4>Proposta</h4>\n        <div class=\"aLinha\"><span>Entrada 30%</span><b>R$ 9.947</b></div>\n        <div class=\"aLinha\"><span>Saldo em 12×</span><b>R$ 1.934</b></div>\n        <div class=\"aLinha total\"><span>Total ao cliente</span><b>R$ 33.156</b></div>\n      </div>",
  "dimensionamento": "\n      <div class=\"app\">\n        <h4>O que vai ligar</h4>\n        <div class=\"aItem\"><span class=\"aCheck\"></span><span>Geladeira duplex</span></div>\n        <div class=\"aItem\"><span class=\"aCheck\"></span><span>Iluminação — 9 pontos LED</span></div>\n        <div class=\"aItem\"><span class=\"aCheck\"></span><span>Bomba d'água 1/2 cv</span></div>\n        <div class=\"aItem\"><span class=\"aCheck\"></span><span>TV e internet</span></div>\n        <div class=\"aItem\"><span class=\"aCheck\"></span><span>Máquina de lavar</span></div>\n        <div class=\"aItem\"><span class=\"aCheck off\"></span><span>Chuveiro elétrico</span></div>\n        <h4>Consumo</h4>\n        <div class=\"aLinha\"><span>Por dia</span><b>8,4 kWh</b></div>\n        <div class=\"aLinha\"><span>Pico de partida</span><b>2.400 W</b></div>\n        <div class=\"aLinha\"><span>Dias sem sol</span><b class=\"amber\">2 dias</b></div>\n        <h4>Kit dimensionado</h4>\n        <div class=\"aLinha\"><span>Painéis</span><b>12 × 570 W</b></div>\n        <div class=\"aLinha\"><span>Banco de baterias</span><b>19,2 kWh</b></div>\n        <div class=\"aLinha\"><span>Inversor</span><b>5 kW · 48 V</b></div>\n        <div class=\"aLinha\"><span>Ligação</span><b>2s × 6p</b></div>\n        <div class=\"aLinha\"><span>Controlador</span><b>MPPT 100 A</b></div>\n        <h4>Autonomia</h4>\n        <div class=\"aBarra\"><i style=\"width:88%\"></i></div>\n        <div class=\"aDupla\">\n          <div class=\"aCartao\"><span>Kit com frete</span><b>R$ 44.700</b></div>\n          <div class=\"aCartao bom\"><span>Aguenta sem sol</span><b>2 dias</b></div>\n        </div>\n        <h4>Comparativo em 10 anos</h4>\n        <div class=\"aLinha\"><span>Puxar rede (1,8 km)</span><b>R$ 112.000</b></div>\n        <div class=\"aLinha\"><span>Gerador a diesel</span><b>R$ 96.400</b></div>\n        <div class=\"aLinha total\"><span>Este sistema</span><b>R$ 44.700</b></div>\n      </div>",
  "inventario-empresarial": "\n      <div class=\"app\">\n        <span class=\"aTag\">Patrimônio R$ 82.615</span>\n        <h4>Escritório</h4>\n        <div class=\"aLinha\"><span>Notebook Dell</span><b>R$ 4.200</b></div>\n        <div class=\"aLinha\"><span>Trena a laser</span><b>R$ 420</b></div>\n        <div class=\"aLinha\"><span>Multímetro</span><b>R$ 380</b></div>\n        <h4>Veículos</h4>\n        <div class=\"aLinha\"><span>Furadeira de impacto</span><b>R$ 890</b></div>\n        <div class=\"aLinha\"><span>Escada 7 degraus</span><b>R$ 640</b></div>\n        <div class=\"aLinha\"><span>Kit ferramentas manuais</span><b>R$ 1.150</b></div>\n        <h4>Depósito</h4>\n        <div class=\"aLinha\"><span>Andaime 1,5 m</span><b>R$ 1.180</b></div>\n        <div class=\"aLinha\"><span>Alicate crimpador MC4</span><b>R$ 340</b></div>\n        <div class=\"aLinha alerta\"><span>Conector MC4 · mín. 40</span><b>restam 6</b></div>\n        <div class=\"aLinha alerta\"><span>Cabo solar 6 mm · mín. 100 m</span><b>restam 22 m</b></div>\n        <h4>Repor antes da próxima obra</h4>\n        <div class=\"aCartao\"><span>2 materiais no mínimo</span><b>Conector MC4 · Cabo 6 mm</b></div>\n        <h4>Total por local</h4>\n        <div class=\"aLinha\"><span>Escritório</span><b>R$ 12.480</b></div>\n        <div class=\"aLinha\"><span>Veículos</span><b>R$ 24.900</b></div>\n        <div class=\"aLinha\"><span>Depósito</span><b>R$ 31.235</b></div>\n        <div class=\"aLinha\"><span>Montagem</span><b>R$ 14.000</b></div>\n        <div class=\"aLinha total\"><span>Patrimônio total</span><b>R$ 82.615</b></div>\n      </div>"
};

const DEMOS = {
  "calculadora": "\n      <div class=\"demoTopo\"><span>Precificação · obra de 8,2 kWp</span><span class=\"demoVivo\"><i></i>ao vivo</span></div>\n      <div class=\"cena\">\n        <div class=\"dLinha dEntra\"><span>Kit fotovoltaico</span><b>R$ 18.400</b></div>\n        <div class=\"dLinha dEntra\"><span>Material CA</span><b>R$ 1.240</b></div>\n        <div class=\"dLinha dEntra\"><span>Mão de obra</span><b>R$ 3.200</b></div>\n        <div class=\"dLinha dEntra\"><span>Deslocamento</span><b>R$ 480</b></div>\n        <div class=\"dLinha dEntra\"><span>ART e homologação</span><b>R$ 890</b></div>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dLinha\"><span>Custo dos materiais</span><b>R$ 19.640</b></div>\n        <div class=\"dLinha\"><span>Serviço e deslocamento</span><b>R$ 3.680</b></div>\n        <div class=\"dLinha\"><span>Nota fiscal sobre o serviço</span><b>R$ 552</b></div>\n        <div class=\"dLinha forte\"><span>Custo total da obra</span><b>R$ 23.872</b></div>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dLinha\" style=\"border:none\"><span>Sua margem</span><b class=\"amber\"><span class=\"rolo r4\"><span>22%</span><span>28%</span><span>34%</span><span>30%</span></span></b></div>\n        <div class=\"dBarra\"><span class=\"dBarraFill\"></span><span class=\"dBarraPino\"></span></div>\n        <p class=\"muted\" style=\"font-size:12.5px;margin:0\">Arraste e veja a sua sobra mudar junto</p>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dCards\">\n          <div class=\"dCard\"><span>Preço ao cliente</span><b><span class=\"rolo r4\"><span>R$ 30.605</span><span>R$ 33.156</span><span>R$ 36.170</span><span>R$ 34.103</span></span></b></div>\n          <div class=\"dCard bom\"><span>Sobra pra você</span><b><span class=\"rolo r4\"><span>R$ 6.733</span><span>R$ 9.284</span><span>R$ 12.298</span><span>R$ 10.231</span></span></b></div>\n        </div>\n        <div class=\"dLinha\" style=\"border:none;margin-top:12px\"><span>Piso que ainda dá lucro</span><b>R$ 26.259</b></div>\n      </div>\n      <p class=\"demoNota\">É esta tela que você abre quando o cliente pede desconto</p>",
  "dimensionamento": "\n      <div class=\"demoTopo\"><span>Off-grid · sítio sem rede</span><span class=\"demoVivo\"><i></i>ao vivo</span></div>\n      <div class=\"cena\">\n        <div class=\"dItem dEntra\"><span class=\"dCheck\"></span><span>Geladeira duplex</span></div>\n        <div class=\"dItem dEntra\"><span class=\"dCheck\"></span><span>Iluminação — 9 pontos LED</span></div>\n        <div class=\"dItem dEntra\"><span class=\"dCheck\"></span><span>Bomba d'água 1/2 cv</span></div>\n        <div class=\"dItem dEntra\"><span class=\"dCheck\"></span><span>TV e internet</span></div>\n        <div class=\"dItem dEntra\"><span class=\"dCheck\"></span><span>Máquina de lavar</span></div>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dLinha\"><span>Consumo por dia</span><b>8,4 kWh</b></div>\n        <div class=\"dLinha\"><span>Pico de partida da bomba</span><b>2.400 W</b></div>\n        <div class=\"dLinha\" style=\"border:none\"><span>Dias sem sol</span><b class=\"amber\"><span class=\"rolo r4\"><span>1 dia</span><span>2 dias</span><span>3 dias</span><span>2 dias</span></span></b></div>\n        <div class=\"dTanque\"><i></i></div>\n        <p class=\"muted\" style=\"font-size:12.5px;margin:0\">Autonomia do banco de baterias</p>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dLinha\"><span>Painéis</span><b>12 × 570 W</b></div>\n        <div class=\"dLinha\"><span>Banco de baterias</span><b><span class=\"rolo r4\"><span>14,3 kWh</span><span>19,2 kWh</span><span>28,7 kWh</span><span>19,2 kWh</span></span></b></div>\n        <div class=\"dLinha\"><span>Inversor</span><b>5 kW · 48 V</b></div>\n        <div class=\"dLinha forte\"><span>Ligação</span><b>2 séries × 6 paralelo</b></div>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dCards\">\n          <div class=\"dCard\"><span>Kit com frete até a obra</span><b><span class=\"rolo r4\"><span>R$ 38.900</span><span>R$ 44.700</span><span>R$ 56.200</span><span>R$ 44.700</span></span></b></div>\n          <div class=\"dCard bom\"><span>Aguenta sem sol</span><b><span class=\"rolo r4\"><span>1 dia</span><span>2 dias</span><span>3 dias</span><span>2 dias</span></span></b></div>\n        </div>\n        <div class=\"dLinha\" style=\"border:none;margin-top:12px\"><span>Contra puxar rede (1,8 km)</span><b class=\"amber\">R$ 112.000</b></div>\n      </div>\n      <p class=\"demoNota\">A resposta que o cliente sempre pergunta, com número</p>",
  "inventario-empresarial": "\n      <div class=\"demoTopo\"><span>Inventário · Irmãos na Obra</span><span class=\"demoVivo\"><i></i>ao vivo</span></div>\n      <div class=\"cena\">\n        <div class=\"dLinha dEntra\"><span>Furadeira de impacto <span class=\"muted\">· Veículo 1</span></span><b>R$ 890</b></div>\n        <div class=\"dLinha dEntra\"><span>Alicate crimpador MC4 <span class=\"muted\">· Montagem</span></span><b>R$ 340</b></div>\n        <div class=\"dLinha dEntra\"><span>Trena a laser <span class=\"muted\">· Escritório</span></span><b>R$ 420</b></div>\n        <div class=\"dLinha dEntra\"><span>Andaime 1,5 m <span class=\"muted\">· Depósito</span></span><b>R$ 1.180</b></div>\n        <div class=\"dLinha dEntra\"><span>Conector MC4 <span class=\"muted\">· Depósito</span></span><b>R$ 6 / un</b></div>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dLinha\" style=\"border:none\"><span>Patrimônio da empresa</span></div>\n        <div style=\"font-size:30px;font-weight:800;letter-spacing:-.03em;color:var(--amber);line-height:1.15\"><span class=\"rolo r4\"><span>R$ 48.200</span><span>R$ 61.740</span><span>R$ 74.930</span><span>R$ 82.615</span></span></div>\n        <div class=\"dTanque\"><i></i></div>\n        <p class=\"muted\" style=\"font-size:12.5px;margin:0\">Soma sozinho a cada item cadastrado</p>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dLinha\"><span>Conector MC4 · mínimo 40</span><b style=\"color:#ff9d8f\">restam 6</b></div>\n        <div class=\"dLinha\"><span>Cabo solar 6 mm · mínimo 100 m</span><b style=\"color:#ff9d8f\">restam 22 m</b></div>\n        <div class=\"dAlerta\"><span>⚠</span><span><b>2 materiais no mínimo.</b> Repor antes da obra de quinta.</span></div>\n      </div>\n      <div class=\"cena\">\n        <div class=\"dLinha\"><span>Escritório</span><b>R$ 12.480</b></div>\n        <div class=\"dLinha\"><span>Veículos</span><b>R$ 24.900</b></div>\n        <div class=\"dLinha\"><span>Depósito</span><b>R$ 31.235</b></div>\n        <div class=\"dLinha forte\"><span>Total pra contabilidade</span><b>R$ 82.615</b></div>\n      </div>\n      <p class=\"demoNota\">Um botão gera este mesmo relatório em PDF</p>"
};

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
${d.favicon ? `<link rel="icon" type="image/svg+xml" href="/${d.pasta}/img/favicon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/${d.pasta}/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/${d.pasta}/img/favicon-16.png">
<link rel="apple-touch-icon" href="/${d.pasta}/img/apple-touch-icon.png">` : '<link rel="icon" href="/icon-192.png">'}
<meta property="og:title" content="${esc(d.ogTitulo)}">
<meta property="og:description" content="${esc(d.descricao)}">
<meta property="og:image" content="https://solardoc.app/capas/${d.pasta === 'calculadora' ? 'calculadora-solar' : d.pasta === 'dimensionamento' ? 'dimensionamento-off-grid' : 'inventario-empresarial'}@2x.png">
<link rel="canonical" href="https://solardoc.app/${d.pasta}/">
<style>${CSS}
  /* ── GALERIA DE FOTOS (opcional, só nas páginas que trazem o campo fotos) ──────
     Uma foto grande e as demais em grade. No celular vira coluna: o que
     interessa é a estação ocupar a largura da tela, não caber ao lado. */
  .galeria{border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .fotos{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:34px}
  .fotos figure{margin:0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--surface)}
  .fotos figure.larga{grid-column:1 / -1}
  .fotos img{display:block;width:100%;height:auto;object-fit:cover}
  .fotos figure.larga img{max-height:420px;object-position:center 42%}
  .fotos figcaption{padding:11px 14px;font-size:13.5px;line-height:1.45;color:var(--muted)}
  @media (max-width:820px){
    .fotos{grid-template-columns:1fr;gap:12px}
    .fotos figure.larga img{max-height:none}
  }

  /* ── POR QUE QUASE NINGUÉM ENTRA (opcional: campo dificuldade) ───────────
     A seção existe pra provar, com número da casa, que o obstáculo não é
     dinheiro. O placar é o argumento inteiro: muita gente com capital, quase
     nenhum ponto. */
  .dificil{background:var(--bg2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .placar{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:26px 0 28px}
  .placar div{background:var(--surface);padding:20px 16px;text-align:center}
  .placar b{display:block;font-size:34px;line-height:1;font-weight:800;letter-spacing:-.02em;color:var(--amber)}
  .placar span{display:block;margin-top:8px;font-size:13.5px;line-height:1.4;color:var(--muted)}
  .porques{list-style:none;padding:0;margin:0 0 24px;display:grid;gap:12px}
  .porques li{padding-left:26px;position:relative;line-height:1.6}
  .porques li:before{content:"—";position:absolute;left:0;color:var(--amber);font-weight:700}
  .veredito{font-size:19px;line-height:1.5;font-weight:600;border-left:3px solid var(--amber);padding:4px 0 4px 18px;margin:0}
  @media (max-width:640px){
    .placar{grid-template-columns:1fr}
    .placar b{font-size:30px}
    .veredito{font-size:17px}
  }

  /* ── INSTRUMENTOS (opcional: campo instrumentos) ─────────────────────────
     São os documentos do produto, fotografados. Prova melhor que descrição:
     o comprador vê o que vai abrir. */
  .instr{border-top:1px solid var(--line)}
  .instrGrade{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:36px}
  .instrGrade figure{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .instrGrade img{display:block;width:100%;height:auto;border-bottom:1px solid var(--line)}
  .instrGrade figcaption{padding:14px 16px}
  .instrGrade figcaption b{display:block;font-size:15px;margin-bottom:5px}
  .instrGrade figcaption span{font-size:13.5px;line-height:1.45;color:var(--muted)}
  @media (max-width:900px){.instrGrade{grid-template-columns:repeat(2,1fr)}}
  @media (max-width:620px){.instrGrade{grid-template-columns:1fr;gap:14px}}

  /* ── QUEM ESTÁ ENSINANDO (opcional: campo autoridade) ────────────────────
     A régua do curso é a régua que a casa usa. Esta seção existe pra dizer de
     onde ela vem, com fato verificável e sem medalha inventada. */
  .quemSomos{background:var(--bg2);border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .credenciais{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin:28px 0 24px}
  .credenciais div{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .credenciais b{display:block;font-size:15px;margin-bottom:6px;color:var(--amber)}
  .credenciais span{font-size:14px;line-height:1.5;color:var(--muted)}
  .assinatura{font-size:16px;line-height:1.6;font-style:italic;border-left:3px solid var(--amber);padding-left:16px;margin:0}
  @media (max-width:640px){.credenciais{grid-template-columns:1fr}}

  /* ── A ESTEIRA DO APP (opcional: campo app) ──────────────────────────────
     As telas andam sozinhas porque são cinco e a página é vertical: numa grade
     elas virariam miniaturas. O trilho tem o conteúdo DUPLICADO e anda metade
     da largura — é o que faz o loop não ter emenda. Para no hover, no foco e
     para quem pediu menos movimento. */
  .appSec{background:var(--bg2);border-top:1px solid var(--line);border-bottom:1px solid var(--line);overflow:hidden}
  .esteira{margin-top:34px;overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent);mask-image:linear-gradient(90deg,transparent,#000 7%,#000 93%,transparent)}
  .trilho{display:flex;gap:18px;width:max-content;animation:anda 44s linear infinite}
  .esteira:hover .trilho,.esteira:focus-within .trilho{animation-play-state:paused}
  @keyframes anda{from{transform:translateX(0)}to{transform:translateX(-50%)}}
  .foneApp{margin:0;width:216px;flex:none}
  .foneApp img{display:block;width:100%;height:auto;border-radius:20px;border:1px solid #2b3446;box-shadow:0 18px 40px -20px rgba(0,0,0,.85);background:#141414}
  .foneApp figcaption{margin-top:11px;font-size:12.5px;line-height:1.4;color:var(--muted);text-align:center;padding:0 6px}
  @media (max-width:640px){
    .foneApp{width:184px}
    .trilho{animation-duration:34s;gap:14px}
  }
  @media (prefers-reduced-motion:reduce){
    .trilho{animation:none;overflow-x:auto;width:auto;padding-bottom:8px}
    .esteira{-webkit-mask-image:none;mask-image:none}
  }

  .heroFoto img{display:block;width:100%;height:auto;border-radius:18px;border:1px solid var(--line);box-shadow:0 30px 60px -30px rgba(0,0,0,.9)}
  @media (max-width:900px){.heroFoto{margin-top:26px}}
</style>
</head>
<body>

<div class="topo">
  <div class="wrap">
    <span class="marca">${d.logo ? `<img src="/${d.pasta}/img/${d.logo}" alt="" width="26" height="26" style="vertical-align:-6px;margin-right:9px;border-radius:6px">` : ''}${d.marca ? esc(d.marca) : 'SolarDoc <span>Pro</span>'}</span>
    <span class="topoSelo">${esc(d.topoSelo || 'Acesso imediato · 7 dias de garantia')}</span>
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

      <div class="rodaEm">
        <span class="rodaEmTitulo">Funciona em</span>
        <ul class="rodaEmLista">
          <li><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.4 10.2h11.2v6.6a1.6 1.6 0 0 1-1.6 1.6H8a1.6 1.6 0 0 1-1.6-1.6v-6.6Z"/><rect x="3.1" y="10.2" width="2.4" height="6" rx="1.2"/><rect x="18.5" y="10.2" width="2.4" height="6" rx="1.2"/><rect x="8.9" y="18.4" width="2.3" height="4.2" rx="1.15"/><rect x="12.8" y="18.4" width="2.3" height="4.2" rx="1.15"/><path d="M6.6 9.2a5.4 5.4 0 0 1 10.8 0H6.6Z"/><path d="M8.2 4.1 7.1 2.3M15.8 4.1l1.1-1.8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" fill="none"/><circle cx="9.6" cy="6.6" r=".72" fill="#0a0f1a"/><circle cx="14.4" cy="6.6" r=".72" fill="#0a0f1a"/></svg>Android</li>
          <li><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.9 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.15-2.9.88-3.65.88-.76 0-1.92-.86-3.16-.84-1.63.03-3.13.95-3.96 2.4-1.69 2.93-.43 7.27 1.21 9.65.8 1.16 1.76 2.47 3.02 2.42 1.21-.05 1.67-.78 3.14-.78 1.46 0 1.88.78 3.16.76 1.31-.02 2.14-1.19 2.94-2.36.92-1.35 1.3-2.65 1.32-2.72-.03-.01-2.54-.98-2.57-3.86Z"/><path d="M14.5 5.6c.67-.81 1.12-1.94.99-3.06-.96.04-2.12.64-2.81 1.45-.62.72-1.16 1.87-1.02 2.97 1.07.08 2.17-.55 2.84-1.36Z"/></svg>iPhone e iPad</li>
          <li><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.6l7.6-1.05v7.1H3V5.6Z"/><path d="M11.6 4.4 21 3.1v8.55h-9.4V4.4Z"/><path d="M3 12.65h7.6v7.1L3 18.7v-6.05Z"/><path d="M11.6 12.65H21v8.55l-9.4-1.3v-7.25Z"/></svg>Windows</li>
          <li><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9.1" fill="none" stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="4" ry="9.1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.3 9.2h17.4M3.3 14.8h17.4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>Qualquer navegador</li>
        </ul>
        <p class="rodaEmNota">
          Abre no navegador &mdash; <b>nada pra instalar</b>. Se quiser, d&aacute; pra fixar na tela
          inicial do celular e usar como aplicativo.
        </p>
      </div>
    </div>

${!TELAS[d.pasta] ? (d.heroFoto ? `
    <div class="heroArte heroFoto">
      <img src="/${d.pasta}/img/${d.heroFoto}" alt="" width="1100" height="825" fetchpriority="high" decoding="async">
    </div>` : '') : `    <div class="heroArte aparelhos">
      <div class="note">
        <div class="noteTampa">
          <div class="noteBarra"><i></i><i></i><i></i><span>${d.telaUrl}</span></div>
          <div class="noteVisor">
            <div class="rolagem">${TELAS[d.pasta]}${TELAS[d.pasta]}</div>
          </div>
        </div>
        <div class="noteBase"></div>
      </div>
      <div class="fone" role="img" aria-label="A mesma tela no celular">
        <span class="foneEntalhe"></span>
        <div class="foneVisor">
          <div class="rolagem">${TELAS[d.pasta]}${TELAS[d.pasta]}</div>
        </div>
      </div>
    </div>`}
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

${!d.app ? '' : `
<section class="appSec">
  <div class="wrap">
    <div class="narrow" style="text-align:center">
      <span class="eyebrow">${esc(d.app.eyebrow)}</span>
      <h2>${esc(d.app.titulo)}</h2>
      <p class="muted" style="margin-top:12px">${esc(d.app.sub)}</p>
    </div>
  </div>
  <div class="esteira" aria-label="Telas do aplicativo">
    <div class="trilho">
${[0, 1].map((volta) => d.app.telas.map(([arq, leg]) => `      <figure class="foneApp"${volta ? ' aria-hidden="true"' : ''}>
        <img src="/${d.pasta}/img/${arq}" alt="${volta ? '' : esc(leg)}" loading="eager" fetchpriority="low" decoding="async" width="390" height="800">
        <figcaption>${esc(leg)}</figcaption>
      </figure>`).join(String.fromCharCode(10))).join(String.fromCharCode(10))}
    </div>
  </div>
</section>`}

${!d.instrumentos ? '' : `
<section class="instr">
  <div class="wrap">
    <div class="narrow" style="text-align:center">
      <span class="eyebrow">${esc(d.instrEyebrow || 'O que você recebe')}</span>
      <h2>${esc(d.instrTitulo || '')}</h2>
      <p class="muted" style="margin-top:12px">${esc(d.instrSub || '')}</p>
    </div>
    <div class="instrGrade">
${d.instrumentos.map(([arq, tit, desc]) => `      <figure>
        <img src="/${d.pasta}/img/${arq}" alt="${esc(tit)}" loading="lazy" decoding="async">
        <figcaption><b>${esc(tit)}</b><span>${esc(desc)}</span></figcaption>
      </figure>`).join(String.fromCharCode(10))}
    </div>
  </div>
</section>`}

${!d.dificuldade ? '' : `
<section class="dificil">
  <div class="wrap narrow">
    <span class="eyebrow">${esc(d.dificuldade.eyebrow)}</span>
    <h2>${esc(d.dificuldade.titulo)}</h2>
    <div class="placar">
${d.dificuldade.placar.map(([v, r]) => `      <div><b>${esc(v)}</b><span>${esc(r)}</span></div>`).join(String.fromCharCode(10))}
    </div>
    <ul class="porques">
${d.dificuldade.porques.map((t) => `      <li>${esc(t)}</li>`).join(String.fromCharCode(10))}
    </ul>
    <p class="veredito">${esc(d.dificuldade.veredito)}</p>
  </div>
</section>`}

${!d.fotos ? '' : `
<section class="galeria">
  <div class="wrap">
    <div class="narrow" style="text-align:center">
      <span class="eyebrow">${esc(d.fotosEyebrow || 'O que nasce no fim disso')}</span>
      <h2>${esc(d.fotosTitulo || '')}</h2>
    </div>
    <div class="fotos">
${d.fotos.map(([arq, leg], i) => `      <figure${i === 0 ? ' class="larga"' : ''}>
        <img src="/${d.pasta}/img/${arq}" alt="${esc(leg)}" loading="${i === 0 ? 'eager' : 'lazy'}" decoding="async" width="1100" height="825">
        <figcaption>${esc(leg)}</figcaption>
      </figure>`).join(String.fromCharCode(10))}
    </div>
  </div>
</section>`}

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

${!d.pecas ? '' : `<section>
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
${i === 0
        ? `<div class="janela">
        <div class="janelaBarra"><i></i><i></i><i></i><span class="janelaUrl">${d.telaUrl}</span></div>
        <div class="demo" data-cenas="4" role="img" aria-label="Demonstração em funcionamento">${DEMOS[d.pasta]}
        </div>
      </div>`
        : janela(d, img, t, false)}
      </div>
    </div>`).join('\n')}
  </div>
</section>`}

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

<section id="depoimentos" style="display:none">
  <div class="wrap">
    <div class="narrow" style="text-align:center">
      <span class="eyebrow">Quem já usa</span>
      <h2>O que os integradores dizem</h2>
    </div>
    <div class="depoGrid"><!-- preenchido quando houver depoimento REAL --></div>
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap narrow">
    <div class="donos">
      <div class="donosFotos">
        <img src="/founder-thiago.webp" width="74" height="74" loading="lazy" alt="Thiago">
        <img src="/founder-diego.webp" width="74" height="74" loading="lazy" alt="Diego">
      </div>
      <div class="donosTxt">
        <h3>Quem fez</h3>
        <p>${esc(d.donosTexto || 'Somos o Thiago e o Diego, irmãos, do Triângulo Mineiro. Trabalhamos com energia solar — e o SolarDoc nasceu de um problema que era nosso: a venda esfriava esperando papel. Cada tela desta plataforma passou por uma venda nossa antes de virar produto.')}</p>
      </div>
    </div>
  </div>
</section>

${!d.autoridade ? '' : `
<section class="quemSomos">
  <div class="wrap narrow">
    <span class="eyebrow">${esc(d.autoridade.eyebrow)}</span>
    <h2>${esc(d.autoridade.titulo)}</h2>
    <p class="muted" style="margin-top:14px">${esc(d.autoridade.texto)}</p>
    <div class="credenciais">
${d.autoridade.itens.map(([t, p2]) => `      <div><b>${esc(t)}</b><span>${esc(p2)}</span></div>`).join(String.fromCharCode(10))}
    </div>
    <p class="assinatura">${esc(d.autoridade.assinatura)}</p>
  </div>
</section>`}

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
      <p class="seguro">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
        </svg>
        Compra segura pela Kiwify · Pix, cartão ou boleto
      </p>
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
    <p class="seguro">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
      </svg>
      Compra segura pela Kiwify · 7 dias de garantia
    </p>
  </div>
</section>

<footer>
  <div class="wrap">
    <p>${esc(d.rodape || 'SolarDoc Pro — documentos e ferramentas para integradores solares')}</p>
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
