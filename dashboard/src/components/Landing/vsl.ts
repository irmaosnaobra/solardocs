// VSL ABERTA da LP — "dá pra fazer o orçamento pelo COMPUTADOR?"
//
// O criativo do anúncio mostra o celular ("na palma da mão"), e quem trabalha
// sentado no escritório chega na página achando que é app de celular só. Este
// vídeo responde isso antes da pessoa desistir — aberto, sem e-mail, sem gate.
//
// COMO TROCAR O VÍDEO: muda `src` (e `poster`) aqui. É a única linha.
// Enquanto `src` estiver vazio a seção inteira não renderiza — a LP continua
// no ar exatamente como está hoje, sem buraco e sem player quebrado.
//
// ONDE O ARQUIVO MORA: Cloudinary (conta já conectada). NÃO colocar o mp4 em
// /public: a landing tem histórico de peso por asset pesado (o /io saiu de
// 2,58 MB pra 24,9 KB) e vídeo em repositório engorda todo deploy.
// O preparo do arquivo (compressão + capa) está em `scripts/vsl-preparar.mjs`.
//
// TETO A VIGIAR: o plano do Cloudinary é o Free — 25 créditos/mês, e 1 crédito
// = 1 GB entregue. Uma VSL de ~20 MB aguenta na faixa de mil exibições cheias
// por mês. Se a LP escalar e o consumo passar de ~60%, o caminho não é voltar
// pro /public: é subir o plano ou trocar por um embed do YouTube não listado
// (banda ilimitada e qualidade adaptativa no 4G, ao custo da marca deles na
// tela). Consumo atual: painel do Cloudinary → Usage.
export const VSL = {
  // URL .mp4 entregue pelo CDN. Ex.:
  // https://res.cloudinary.com/v755hoio/video/upload/f_auto,q_auto/solardoc/vsl-computador.mp4
  src: 'https://res.cloudinary.com/v755hoio/video/upload/q_auto/v1787002688/solardoc/vsl-computador.mp4',

  // Capa (primeiro quadro). Sem ela o player abre num retângulo preto.
  poster: 'https://res.cloudinary.com/v755hoio/image/upload/f_auto,q_auto/v1787002698/solardoc/vsl-computador-capa.jpg',

  // Duração escrita no selo do player. A pessoa decide clicar sabendo o preço
  // em minutos; player sem duração é clique no escuro.
  duracao: '2:38',

  // Proporção do quadro, pra moldura nascer do tamanho do vídeo em vez de
  // deixar duas tarjas pretas dos lados. Vídeo gravado da tela do computador é
  // '16 / 9'; gravado em pé no celular é '9 / 16'.
  proporcao: '9 / 16',
};
