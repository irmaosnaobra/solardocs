/* ==========================================================================
   Irmãos na Obra Energia Solar — dados editáveis do site
   Tudo que muda com o tempo fica neste arquivo. Não precisa mexer no HTML.
   ========================================================================== */

/* --------------------------------------------------------------------------
   CONTATO
   O WhatsApp é o mesmo do /io e do /io/solar. E-mail e horário abaixo estão
   marcados PENDENTE: não achei nenhum dos dois publicado em lugar nenhum do
   repositório, então são chute de layout até o Thiago confirmar.
   -------------------------------------------------------------------------- */
const CONFIG = {
  whatsapp: '5534998165040',
  whatsappVisivel: '(34) 99816-5040',
  email: 'contato@irmaosnaobra.com.br',            // PENDENTE confirmar
  endereco: 'Triângulo Mineiro (MG) e Catalão (GO)',
  horario: 'Seg a Sex: 8h às 18h · Sáb: 8h às 12h', // PENDENTE confirmar
  instagram: 'https://instagram.com/irmaosnaobra__',
  facebook: '#',   // PENDENTE
  youtube: '#'     // PENDENTE
};

/* --------------------------------------------------------------------------
   PARA QUEM VAI O LEAD DO SIMULADOR

   Quem preenche o simulador e clica no botão cai DIRETO no celular do
   consultor, com a ficha já escrita na mensagem — não passa pela linha central.

   O corte é o consumo em kWh calculado a partir da conta, não o valor em reais:
     acima de 1.000 kWh  →  50% Thiago, 50% Diego
     até 1.000 kWh       →  70% Nilce, 30% Giovanna

   Três números (Thiago, Diego, Nilce) vieram da tabela `consultores` do banco do
   /gerador. O da Giovanna NÃO: o Thiago corrigiu à mão em 04/09/2026 para
   5534998165040, que é a MESMA linha central usada nos botões soltos da página.
   No banco, a Giovanna está como 5534993396255.

   Isso tem duas consequências que valem saber:
     1. o banco e o site discordam sobre o WhatsApp da Giovanna. O do site é o
        que o Thiago mandou usar; quem for mexer no banco decide qual corrigir.
     2. o lead de conta baixa sorteado pra Giovanna cai na linha central, a
        mesma dos botões de hero/rodapé. Ou seja: 30% da conta baixa não cai num
        celular pessoal, cai na linha que a automação também usa.

   Esta lista é uma cópia — o site não consulta banco nenhum. Trocou número em
   qualquer lugar, tem que trocar aqui também.

   ATENÇÃO, DIVERGÊNCIA COM O BACKEND (falar com o Thiago):
   o roteamento que já roda no servidor (leadSolarFicha.ts) corta em 700 kWh e
   divide a conta baixa 75/25, não 70/30. Este site corta em 1.000 e divide
   70/30, que foi o que o Thiago pediu em 04/09/2026. Enquanto os dois não
   forem alinhados, um lead entre 700 e 1.000 kWh cai na Nilce/Giovanna pelo
   site e conta como time de conta alta pelo servidor.
   -------------------------------------------------------------------------- */
const KWH_CORTE = 1000;

const TIME_CONTA_ALTA = [
  { nome: 'Thiago', whatsapp: '5534991360223', peso: 50 },
  { nome: 'Diego', whatsapp: '5534991360172', peso: 50 }
];

const TIME_CONTA_BAIXA = [
  { nome: 'Nilce', whatsapp: '5534991516846', peso: 70 },
  { nome: 'Giovanna', whatsapp: '5534998165040', peso: 30 }
];

/* --------------------------------------------------------------------------
   PARÂMETROS DO SIMULADOR

   A conta nova NÃO é só o custo de disponibilidade. Depois da Lei 14.300
   sobra na fatura, todo mês:
     1. custo de disponibilidade  (30 / 50 / 100 kWh conforme a ligação)
     2. iluminação pública (COSIP) - taxa municipal, não tem como compensar
     3. Fio B sobre a energia injetada na rede - a parcela da Lei 14.300,
        que sobe de ano em ano até 2029

   Ignorar os itens 2 e 3 é o que faz simulador prometer economia de 95%, que
   não acontece na prática. Com eles, a economia fica na faixa de 78% a 85%.

   TARIFA, HSP, PERFORMANCE e POTÊNCIA DO PAINEL não são chute: são os números
   que a própria Irmãos na Obra já usa. Tarifa 1,05 / HSP 5,2 / PR 0,80 estão
   no simulador de /io/solar; o painel de 600W é o TCL que está nos kits atuais
   do /gerador (proposta.html). Se um deles mudar lá, tem que mudar aqui junto.

   COSIP e FIO B são os dois que eu NÃO tenho de fonte da casa — estão marcados
   CONFIRMAR e precisam ser lidos de uma fatura CEMIG real de Uberlândia.
   Nenhum dos dois aparece escrito na página; só entram na conta.
   -------------------------------------------------------------------------- */
const PARAMS = {
  tarifa: 1.05,          // R$/kWh cheia com impostos (mesmo número do /io/solar)
  potenciaPainel: 600,   // watts por painel (TCL 600W, kit atual do /gerador)

  // CADA PLACA GERA 75 kWh POR MÊS. É a regra que o time usa em campo, e
  // agora é ela que dimensiona o sistema — não o contrário.
  //
  // Ela não brigou com o cálculo antigo, confirmou: 600 W x 5,2 HSP x 0,80 de
  // performance x 30 dias = 74,9 kWh. Antes o número de placas saía dessa
  // conta de três fatores; agora sai do 75 direto. Muda pra melhor porque o 75
  // é o que dá pra conferir de cabeça e o que vocês falam com o cliente —
  // ninguém discute performance ratio no telhado.
  //
  // Se a placa do kit mudar de potência, este número muda junto:
  //   geracaoPorPainel ≈ potenciaPainel / 1000 x hsp x 0,80 x 30
  geracaoPorPainel: 75,  // kWh/mês por placa, no HSP da região (5,2)
  hspBase: 5.2,          // o HSP em que o 75 vale. Cidade com HSP diferente
                         // escala em cima dele, em vez de ter número próprio
  areaPainel: 2.58,      // m² por painel (2,28 x 1,13)
  folgaArea: 1.15,       // espaçamento entre fileiras
  taxaMinima: { mono: 30, bi: 50, tri: 100 }, // kWh de custo de disponibilidade

  cosip: 28.00,          // CONFIRMAR - iluminação pública CEMIG/Uberlândia, R$/mês

  // Lei 14.300: paga-se um percentual do Fio B sobre a energia injetada.
  // Cronograma da regra de transição: 2023=15% · 2024=30% · 2025=45%
  //                                   2026=60% · 2027=75% · 2028=90% · 2029+=integral
  fioB: 0.22,            // CONFIRMAR - R$/kWh do Fio B da CEMIG com impostos
  percentualFioB: 0.60,  // 60% em 2026, subir junto com o cronograma acima
  fracaoInjetada: 0.80   // parte da geração que vai pra rede em vez de ser
                         // consumida na hora. 80% é hipótese conservadora
                         // para residência (quanto maior, menor a economia)
};

/* --------------------------------------------------------------------------
   CIDADES ATENDIDAS E IRRADIAÇÃO (HSP, kWh/m²/dia)

   As cinco primeiras são as cidades onde estão as obras das fotos deste site
   (informação do Thiago). Catalão é Goiás, não Minas — por isso a região no
   site inteiro é "Triângulo Mineiro e Catalão", nunca só Triângulo.

   O HSP está 5,2 em TODAS de propósito: 5,2 é o número regional que a empresa
   já publica no /io/solar. Inventar um decimal diferente por cidade daria ar
   de precisão que eu não tenho.
   PENDENTE: HSP real por cidade, se algum dia valer a diferença.
   -------------------------------------------------------------------------- */
const CIDADES = [
  { nome: 'Uberlândia', hsp: 5.2 },
  { nome: 'Araguari', hsp: 5.2 },
  { nome: 'Catalão - GO', hsp: 5.2 },
  { nome: 'Uberaba', hsp: 5.2 },
  { nome: 'Ituiutaba', hsp: 5.2 },
  { nome: 'Monte Alegre de Minas', hsp: 5.2 },
  { nome: 'Tupaciguara', hsp: 5.2 },
  { nome: 'Indianópolis', hsp: 5.2 },
  { nome: 'Prata', hsp: 5.2 },
  { nome: 'Campina Verde', hsp: 5.2 },
  { nome: 'Capinópolis', hsp: 5.2 },
  { nome: 'Centralina', hsp: 5.2 },
  { nome: 'Canápolis', hsp: 5.2 },
  { nome: 'Araporã', hsp: 5.2 },
  { nome: 'Monte Carmelo', hsp: 5.2 },
  { nome: 'Patrocínio', hsp: 5.2 },
  { nome: 'Nova Ponte', hsp: 5.2 },
  { nome: 'Ouvidor - GO', hsp: 5.2 },
  { nome: 'Goiandira - GO', hsp: 5.2 },
  { nome: 'Cumari - GO', hsp: 5.2 },
  { nome: 'Outra cidade da região', hsp: 5.2 }
];

/* --------------------------------------------------------------------------
   AS CIDADES DAS OBRAS
   Aparecem como faixa embaixo do título da seção de obras. São as cidades das
   fotos, ditas pelo Thiago. Não sei QUAL foto é de QUAL cidade, então elas
   entram como conjunto e não como legenda de card.
   -------------------------------------------------------------------------- */
const CIDADES_DAS_OBRAS = ['Uberlândia', 'Araguari', 'Catalão', 'Uberaba', 'Ituiutaba'];

/* --------------------------------------------------------------------------
   OBRAS ENTREGUES

   ATENÇÃO, e é o ponto mais importante deste arquivo:

   Eu tenho as FOTOS das obras. Eu NÃO tenho a ficha técnica de nenhuma delas
   — nem kWp, nem bairro, nem economia mensal, nem a potência do módulo que
   está em cada telhado (dá pra ver que não é o mesmo módulo em todas: umas são
   de célula azul antiga, outras all-black).

   Então cada legenda aqui descreve o que está NO QUADRO e para. Nenhum número
   inventado. O selo diz o tipo de telhado ou o equipamento, não "9,76 kWp".

   As cidades das obras eu tenho — Uberlândia, Araguari, Catalão, Uberaba e
   Ituiutaba — mas não sei qual foto é de qual. Por isso elas aparecem como
   faixa da seção (CIDADES_DAS_OBRAS) e o campo `cidade` de cada card fica na
   região. Quando o Thiago disser qual é qual, é só trocar o campo.

   PENDENTE: pra cada obra, pedir ao Thiago — cidade certa, bairro, kWp,
   quantidade e potência dos módulos, inversor e economia mensal. Com isso na
   mão, o selo vira o kWp e a ficha vira ficha de verdade, igual ao modelo.
   -------------------------------------------------------------------------- */
const OBRAS = [
  {
    img: '/irmaosnaobra/assets/img/obra-01.webp',
    bairro: 'Telha colonial',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Residencial',
    ficha: ['duas águas aproveitadas', 'módulos rentes à telha', 'trilho alinhado na cumeeira'],
    alt: 'Telhado de telha colonial com módulos solares instalados, vista alta da cidade ao fundo'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-02.webp',
    bairro: 'Duas orientações',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Residencial',
    ficha: ['duas fileiras em águas diferentes', 'telha colonial', 'fixação sem furar a telha'],
    alt: 'Duas fileiras de módulos solares em águas diferentes de um telhado de telha colonial'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-03.webp',
    bairro: 'Módulos all-black',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'All-black',
    ficha: ['telhado de fibrocimento', 'módulos all-black', 'estrutura elevada e nivelada'],
    alt: 'Módulos solares all-black instalados sobre telhado de fibrocimento'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-04.webp',
    bairro: 'Telha de concreto',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Residencial',
    ficha: ['telha de concreto', 'cabeamento aterrado', 'fileira única no comprimento da água'],
    alt: 'Fileira de módulos solares sobre telhado de telha de concreto em rua residencial'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-05.webp',
    bairro: 'Telhado de galpão',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Comercial',
    ficha: ['fibrocimento de galpão', 'fileira longa no sentido da água', 'espaço livre pra ampliar'],
    alt: 'Módulos solares em fileira longa no telhado de fibrocimento de um galpão'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-06.webp',
    bairro: 'Módulo instalado',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Residencial',
    ficha: ['vidro limpo, sem sombra', 'inclinação acompanhando a telha', 'obra concluída'],
    alt: 'Detalhe do vidro de um módulo solar recém-instalado com o céu refletido'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-07.webp',
    bairro: 'Água única',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Residencial',
    ficha: ['telha colonial', 'módulos de célula azul', 'estrutura na inclinação do telhado'],
    alt: 'Módulos solares de célula azul instalados em telhado de telha colonial'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-08.webp',
    bairro: 'Vista da rua',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Residencial',
    ficha: ['casa térrea de esquina', 'duas águas com módulos', 'obra entregue e ligada'],
    alt: 'Casa térrea vista da rua com módulos solares instalados no telhado'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-09.webp',
    bairro: 'Inversor e proteção',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Inversor SAJ',
    ficha: ['inversor SAJ na parede', 'Clamper Front Box de proteção', 'eletroduto aparente e alinhado'],
    alt: 'Inversor SAJ e caixa de proteção Clamper Front Box instalados na parede'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-11.webp',
    bairro: 'Equipe na obra',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Zona rural',
    ficha: ['chácara, telhado de telha colonial', 'equipe montando no dia', 'foto de drone da própria obra'],
    alt: 'Vista de drone de uma chácara com a equipe instalando módulos solares no telhado'
  },
  {
    img: '/irmaosnaobra/assets/img/obra-10.webp',
    bairro: 'Quadro acabado',
    cidade: 'Triângulo Mineiro e Catalão',
    badge: 'Inversor SAJ',
    ficha: ['inversor SAJ', 'string box com DPS', 'condutores identificados por cor'],
    alt: 'Inversor SAJ com string box e eletroduto instalados em parede de área de serviço'
  }
];

/* --------------------------------------------------------------------------
   DEPOIMENTOS

   Cada um destes é a transcrição de um print de conversa que a empresa já
   publica no /io. O print vai junto, do lado, e abre em tamanho grande no
   clique: o texto é pra ler no celular, o print é a prova de que ele existe.

   O sobrenome não vai porque não está no print. A cidade também não — nenhum
   dos prints diz de onde a pessoa é, e eu não vou deduzir.
   -------------------------------------------------------------------------- */
// 20 é a contagem de DEPOIMENTOS (7 conversas + 13 comentários), não de gente:
// Márcio, Cléber, Andrigo e Huberth aparecem nas duas fontes. Por isso o texto
// diz "depoimentos", e não "clientes" — a contagem de pessoas seria uns 16.
const AVALIACAO = { nota: '20', total: 'depoimentos publicados, com nome ou @' };

const DEPOIMENTOS = [
  {
    texto: 'Estou satisfeito com a agilidade e com o comprometimento durante a instalação do kit solar. Me explicaram muito bem como funciona o sistema e está funcionando a todo vapor.',
    nome: 'Denivan',
    marca: 'Conversa no WhatsApp',
    print: '/irmaosnaobra/assets/img/depo-1.webp',
    alt: 'Print da conversa no WhatsApp com o cliente Denivan'
  },
  {
    texto: 'Fiquei muito satisfeita com o trabalho de vocês, com certeza eu indicaria sim. Nota 10 por tudo. 100% satisfeita.',
    nome: 'Sueli',
    marca: 'Conversa no WhatsApp',
    print: '/irmaosnaobra/assets/img/depo-3.webp',
    alt: 'Print da conversa no WhatsApp com a cliente Sueli'
  },
  {
    texto: 'Passando aqui pra deixar meu agradecimento a todos da equipe Irmãos na Obra pelo profissionalismo e transparência com o serviço prestado, tudo dentro do combinado. Pelo suporte e atenção antes do término do serviço e após o término.',
    nome: 'Cléber',
    marca: 'Conversa no WhatsApp',
    print: '/irmaosnaobra/assets/img/depo-6.webp',
    alt: 'Print da conversa no WhatsApp com o cliente Cléber'
  },
  {
    texto: 'Foi top meu irmão, muito rápido, tanto o processo quanto a montagem. Gostei muito viu.',
    nome: 'Andrigo',
    marca: 'Conversa no WhatsApp',
    print: '/irmaosnaobra/assets/img/depo-7.webp',
    alt: 'Print da conversa no WhatsApp com o cliente Andrigo'
  },
  {
    texto: 'Estou extremamente satisfeito com os resultados adquiridos com a instalação do meu sistema fotovoltaico. Tenho verificado uma produção de energia muito satisfatória, dentro do nosso combinado, onde até mesmo nos dias de pouca incidência do sol segue atendendo à minha demanda. Super recomendo.',
    nome: 'Márcio',
    marca: 'Conversa no WhatsApp',
    print: '/irmaosnaobra/assets/img/depo-4.webp',
    alt: 'Print da conversa no WhatsApp com o cliente Márcio'
  },
  {
    texto: 'Bom dia, Diego. Indicaria sim.',
    nome: 'Sebastião',
    marca: 'Conversa no WhatsApp',
    print: '/irmaosnaobra/assets/img/depo-2.webp',
    alt: 'Print da conversa no WhatsApp com o cliente Sebastião'
  },
  {
    destaque: true,
    texto: 'Meu nome é Huberth e tenho uma satisfação a declarar sobre a empresa Irmãos na Obra. Comprei um kit energia fotovoltaica, tive um excelente atendimento, tanto na instalação e o pós, algo que merece parabenizá-los. Até o momento, qualquer ajuda sobre o sistema eles estão sempre dispostos a ajudar. Encerro com meu muito obrigado a toda equipe, pela idoneidade de todos.',
    nome: 'Huberth',
    marca: 'Conversa no WhatsApp',
    print: '/irmaosnaobra/assets/img/depo-5.webp',
    alt: 'Print da conversa no WhatsApp com o cliente Huberth'
  }
];


/* --------------------------------------------------------------------------
   COMENTÁRIOS DO INSTAGRAM — UM PRINT POR CLIENTE

   Cada card é o recorte do comentário daquela pessoa, sozinho, tirado da
   página pública do post. Um por cliente foi pedido do Thiago: prova separada
   é mais fácil de ler e de conferir do que uma tira com vários juntos.

   O post: https://www.instagram.com/p/DYx8CyPplKy/
   A pergunta que a empresa fez lá: "Espaço para nossos clientes contar sobre a
   sua experiência e deixar sua avaliação do nosso trabalho. Indicaria nossa
   empresa?"

   O @ NÃO foi marcado em cima da imagem. Quem destaca ele é o site, no rótulo
   dourado embaixo do print — escrever por cima de um print é começar a editar
   prova, e aí ela deixa de valer como prova.

   `texto` é transcrição LIDA DO PRÓPRIO PRINT, com os erros de digitação de
   quem escreveu. Ela serve pro leitor de tela, pro buscador e pra quem está no
   celular — print não é lido por nenhum dos três.

   Fora daqui, de propósito: o comentário do @savioejakezanotto, que é pedido de
   assistência ("estou precisando de assistência ao aplicativo"), não avaliação.
   Publicar aquilo como elogio seria mentira — e, pior, é um cliente pedindo
   ajuda.

   Comentário novo no post? É rodar `node scripts/build-prints-instagram.js`,
   conferir os recortes e acrescentar a linha aqui.
   -------------------------------------------------------------------------- */
const POST_INSTAGRAM = 'https://www.instagram.com/p/DYx8CyPplKy/';

const COMENTARIOS = [
  { arroba: '_vida_com_proposito__',
    print: '/irmaosnaobra/assets/img/insta--vida-com-proposito-.webp',
    texto: '👏 São excepcionais! Serviço prestado com muita qualidade! São transparentes, honestos ao extremo!!! Recomendados sem dúvidas para você, que como nós, recebemos uma prestação de serviço maravilhosa e a economia está ativa desde o primeiro dia de funcionamento. 💯% Recomendados! Chame e faça seu orçamento, você nunca arrependerá!' },
  { arroba: 'fgadia',
    print: '/irmaosnaobra/assets/img/insta-fgadia.webp',
    texto: 'Atendimento espetacular desde a cotação até a instalação das placas. Equipe capacitada, educada e ágil no serviço. No futuro próximo ampliarei o número das placas solares e com certeza será com os @irmaosnaobra__. Recomendo demais o serviço deles. 👏 Nota 10' },
  { arroba: 'granjaoliveiracarvalho',
    print: '/irmaosnaobra/assets/img/insta-granjaoliveiracarvalho.webp',
    texto: '❤️ sempre nos atendendo com rapidez e fazendo um serviço espetacular 👏' },
  { arroba: 'evertonjosebraga',
    print: '/irmaosnaobra/assets/img/insta-evertonjosebraga.webp',
    texto: 'Estou passando aqui para agradecer os irmãos na obra pela eficiência, qualilidade e rapidez e atenção estou muito satisfeito pelo trabalho estão no caminho certo parabéns super índico 🙌' },
  { arroba: 'sthefano',
    print: '/irmaosnaobra/assets/img/insta-sthefano.webp',
    texto: 'Votei sim, super indico a turma. Projeto junto a cemig, equipamentos, instalacao e tudo mais. Tudo com preço justo e condicao de pagamento facilitada.' },
  { arroba: 'cortes_marcio',
    print: '/irmaosnaobra/assets/img/insta-cortes-marcio.webp',
    texto: 'Belíssimo trabalho executado em minha residência, recomendo "Irmãos na Obra" para quem deseja um trabalho de qualidade e muita eficiência.' },
  { arroba: 'martincleber',
    print: '/irmaosnaobra/assets/img/insta-martincleber.webp',
    texto: 'Fiquei satisfeito com o trabalho de vcs e indiquei para meu irmão e meus amigos. Obrigado pelo profissionalismo e pela assistência antes e depois da instalação.' },
  { arroba: 'hvillela73',
    print: '/irmaosnaobra/assets/img/insta-hvillela73.webp',
    texto: 'Fiquei muito satisfeito com a honestidade e o serviço prestado. E olhe que tomei muito cuidado, e visitei a empresa, pq hoje temos muitos golpistas.' },
  { arroba: 'andrigojs',
    print: '/irmaosnaobra/assets/img/insta-andrigojs.webp',
    texto: 'Estou muito satisfeito com o serviço prestado, a agilidade e rapidez q foi feito do projeto ate a instalação. Muito obg msm meninos pelo produto. Super indico.' },
  { arroba: 'mariperinstay',
    print: '/irmaosnaobra/assets/img/insta-mariperinstay.webp',
    texto: 'Gostei muito do trabalho de vcs... cumpre com o prazo.... matérias de boa qualidade... podem fazer sem medo.... profissionais os meninos' },
  { arroba: 'isa.valesca',
    print: '/irmaosnaobra/assets/img/insta-isa-valesca.webp',
    texto: 'Excelente profissional, empresa idônea, recomendo a todos' },
  { arroba: 'contarimcarlos',
    print: '/irmaosnaobra/assets/img/insta-contarimcarlos.webp',
    texto: 'eu índico foi bem rápido fiquei satisfeito' },
  { arroba: 'luizantonionakano',
    print: '/irmaosnaobra/assets/img/insta-luizantonionakano.webp',
    texto: 'Tudo correu bem da compra até o funcionamento do equipamento.' },
];
