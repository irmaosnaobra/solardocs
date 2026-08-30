// ─────────────────────────────────────────────────────────────────────────────
// AÇÕES DA CARLA, o que ela DECIDE virando o que o sistema FAZ.
//
// Por que este arquivo existe. Até 29/08/2026 a Carla só sabia escrever texto:
// o handler dela reconhecia [ESTAGIO:x] e jogava fora qualquer outro colchete
// (extractEstagio). A Giovanna, a agente irmã que atende quem JÁ é cliente,
// tem o oposto, parseTagsResposta lê tags de ação e o handler as executa:
// manda imagem, gera Pix, chama humano.
//
// O preço dessa assimetria está medido. Nos 24 leads de 25 a 29/08 o cérebro da
// Carla mandava, na seção 10, "MANDAR IMAGEM, SUA ARMA MAIS FORTE" e listava
// 11 peças "pedidas pela tag". Nenhuma dessas tags existia no código. Três leads
// pediram para ver a proposta (um deles quatro vezes, e encerrou com "sem
// análise da proposta fica difícil prosseguir") e os três ouviram que não dava
// para mandar arquivo. Três pediram Pix e viraram chamado. Zero fecharam.
//
// A regra de projeto aqui é uma só: a agente é livre para AGIR e continua presa
// para AFIRMAR. Ela escolhe QUANDO mostrar e QUANDO cobrar; ela nunca digita a
// URL nem o código do Pix. O texto que vai para o cliente sai de constante, e o
// copia-e-cola sai de gerarPixCopiaECola, determinístico. Modelo escolhendo a
// hora é bom; modelo escrevendo chave de pagamento de cabeça é dinheiro do
// cliente indo para o lugar errado.
// ─────────────────────────────────────────────────────────────────────────────

import { porBarras } from '../bolhas';

/**
 * As peças que a Carla pode anexar.
 *
 * Todas saem do MESMO gerador que roda quando um assinante clica em "gerar"
 * (api/scripts/lp-docs.ts → generateFromTemplate), então o lead vê o documento
 * real, não maquete de marketing.
 *
 * Por que Cloudinary e não solardoc.app/tela/*.webp: o WhatsApp trata WEBP como
 * FIGURINHA. As 26 folhas publicadas no domínio são todas .webp, e mandar
 * qualquer uma delas direto entregaria um sticker no lugar da proposta. A
 * conversão para JPG é feita no Cloudinary (mesma hospedagem que a Giovanna já
 * usa para a imagem do curso), o que também deixa trocar a peça sem deploy.
 *
 * As legendas nunca ficam sozinhas e nunca são "olha aí": cada uma aponta o que
 * olhar. E toda peça reafirma a marca própria, que é o argumento que mais
 * apareceu na boca dos leads ("quero um sistema meu, particular").
 */
export interface PecaCarla {
  url: string;
  legenda: string;
}

const CLOUD = 'https://res.cloudinary.com/v755hoio/image/upload';

// Mesmo endereço que o handler injeta no contrato do canal. Repetido aqui porque
// este bloco também precisa citá-lo, e importar do handler criaria ciclo.
const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';

export const MIDIA_CARLA: Record<string, PecaCarla> = {
  orcamento_1pagina: {
    url: `${CLOUD}/v1788036736/solardoc/carla/proposta-1pagina.jpg`,
    legenda:
      'é essa folha aqui. repara que a economia mensal e o tempo de retorno vêm escritos, não em gráfico. o cliente bate o olho e entende. e sai com a sua logo e a sua cor, o nome SolarDoc não aparece em lugar nenhum',
  },
  doc_proposta: {
    url: `${CLOUD}/v1788036765/solardoc/carla/proposta-completa.jpg`,
    legenda:
      'essa é a proposta comercial completa, pra quando o cliente quer ver tudo detalhado. mesma coisa: sua marca, seus dados',
  },
  doc_contrato: {
    url: `${CLOUD}/v1788036762/solardoc/carla/contrato.jpg`,
    legenda:
      'o contrato sai assim, com as cláusulas já escritas pro setor solar. é o que substitui aquele Word remendado que todo mundo tem',
  },
  doc_procuracao: {
    url: `${CLOUD}/v1788036763/solardoc/carla/procuracao.jpg`,
    legenda: 'a procuração pra concessionária sai nesse formato, no padrão que elas aceitam',
  },
  doc_recibo: {
    url: `${CLOUD}/v1788036766/solardoc/carla/recibo.jpg`,
    legenda: 'o recibo de pagamento, pra você controlar o que o cliente já quitou',
  },
  doc_vistoria: {
    url: `${CLOUD}/v1788036768/solardoc/carla/vistoria.jpg`,
    legenda: 'o checklist de vistoria, pra levar na obra e não esquecer item',
  },
  doc_vendedor: {
    url: `${CLOUD}/v1788036769/solardoc/carla/vendedor.jpg`,
    legenda: 'o contrato de vendedor parceiro, pra quando você põe alguém pra vender comissionado',
  },
  doc_banco: {
    url: `${CLOUD}/v1788036771/solardoc/carla/banco.jpg`,
    legenda: 'o documento pro banco, quando o cliente vai financiar',
  },
};

/**
 * Como a resposta da Carla sai na linha.
 *
 * Mora aqui, e não solto na chamada do handler, porque é regra de produto e tem
 * teste: o Thiago pediu "bolhas curtas sempre" em 30/08/2026 e sem trava esse
 * teto sobe de novo sem ninguém ver.
 *
 * slow=true gasta de 8 a 15s de "digitando" por bolha mais 2,5 a 5,5s de
 * intervalo. No teto padrão de 5, uma resposta ocupa de 50 a 97 SEGUNDOS da tela
 * do lead. A mediana de texto dela era 128 caracteres, ou seja, curta: o que
 * pesava era o tempo, não o tamanho.
 */
export const BOLHAS_CARLA = { slow: true, max: 120, maxBolhas: 3 } as const;

/** Tags aceitas, usada pelo prompt e pelo teste, para as duas pontas não divergirem. */
export const TAGS_MIDIA = Object.keys(MIDIA_CARLA);

// Uma tag por resposta é regra de produto, não limitação técnica: a linha
// `solardoc` já foi banida uma vez por envio automático, e três imagens seguidas
// é o que um disparo em massa parece. Se o modelo emitir duas, vale a primeira.
const TAG_IMAGEM = /\[\[\s*ENVIAR_IMAGEM\s*:\s*([a-z0-9_]+)\s*\]\]/i;
const TAG_IMAGEM_G = /\[\[\s*ENVIAR_IMAGEM\s*:\s*[a-z0-9_]+\s*\]\]/gi;
const TAG_PIX = /\[\[\s*ENVIAR_PIX\s*\]\]/i;
const TAG_PIX_G = /\[\[\s*ENVIAR_PIX\s*\]\]/gi;

export interface AcoesCarla {
  /** Chave de MIDIA_CARLA, já validada. Tag desconhecida vira null (e some do texto). */
  imagem: string | null;
  /** Emitiu o pedido de Pix copia-e-cola. */
  pix: boolean;
  /** Texto sem nenhuma tag, pronto para quebrar em bolhas. */
  limpo: string;
  /** Tag de imagem que veio escrita mas não existe no catálogo, para log. */
  imagemInvalida: string | null;
}

/**
 * Lê as tags de ação e devolve o texto limpo.
 *
 * Roda DEPOIS de extractEstagio: [ESTAGIO:x] usa colchete simples e estas usam
 * duplo, então não colidem: mas a ordem importa porque extractEstagio faz
 * `replace` só do próprio padrão dele e deixa o resto passar.
 *
 * Toda tag sai do texto mesmo quando é inválida. Tag vazando para o WhatsApp do
 * lead é o pior dos dois mundos: ele vê "[[ENVIAR_IMAGEM:xpto]]" e não recebe
 * imagem nenhuma.
 */
export function parseAcoesCarla(raw: string): AcoesCarla {
  const m = raw.match(TAG_IMAGEM);
  const pedida = m?.[1]?.toLowerCase() ?? null;
  const valida = pedida && MIDIA_CARLA[pedida] ? pedida : null;

  const limpo = raw
    .replace(TAG_IMAGEM_G, '')
    .replace(TAG_PIX_G, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return {
    imagem: valida,
    pix: TAG_PIX.test(raw),
    limpo,
    imagemInvalida: pedida && !valida ? pedida : null,
  };
}

/** Só para o handler não repetir a checagem de existência. */
export function pecaDaTag(tag: string | null): PecaCarla | null {
  return tag ? MIDIA_CARLA[tag] ?? null : null;
}

/**
 * O bloco que entra no system prompt descrevendo o que ela pode fazer.
 *
 * Mora aqui, junto do catálogo, de propósito: a lista de tags que o prompt
 * anuncia e a lista que o código executa têm que ser a MESMA lista. Foi
 * exatamente a divergência entre as duas (prompt anunciando 11 peças, código
 * conhecendo zero) que fez a agente prometer o que não conseguia entregar.
 */
export function blocoDeAcoes(): string {
  const catalogo = TAGS_MIDIA.map((t) => `   [[ENVIAR_IMAGEM:${t}]]`).join('\n');
  return `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# O TAMANHO DA SUA RESPOSTA (vale acima de tudo que veio antes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bolha curta, sempre. Uma ideia por bolha, 1 ou 2 linhas, no máximo 3 bolhas na
resposta inteira, e o normal é 1 ou 2.

O motivo é físico, não estético: cada bolha sua fica de 10 a 20 segundos com o
"digitando" ligado na tela dele. Três bolhas já são quase um minuto. Cinco são
um minuto e meio de alguém parado vendo você escrever, e é assim que texto curto
vira parede.

Se não cabe em 3 bolhas curtas, você está explicando demais. Responde o que ele
perguntou e para. O que faltar, ele pergunta, e aí você tem outro turno.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# O QUE VOCÊ CONSEGUE FAZER DE VERDADE (não é figura de linguagem)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Você tem duas ações reais. Escreva a tag no fim da resposta e o sistema executa.
O lead NUNCA vê a tag.

1. MOSTRAR O DOCUMENTO. Escreva UMA destas:
${catalogo}
   A imagem sai depois das suas bolhas, com legenda própria, então NÃO escreva
   "olha o anexo" nem descreva a folha em palavras. Fale o que importa e deixe a
   peça falar.
   Quando usar: ele perguntou como é a proposta, disse que a atual é feia, pediu
   modelo/exemplo/PDF, ou está decidindo e falta ver. "Quero ver antes" se
   responde com a folha, não com a garantia.
   Quando NÃO usar: na primeira mensagem (imagem antes de diagnóstico é catálogo),
   duas na mesma resposta, ou depois de já ter mandado o link de pagamento.
   Uma imagem a cada 4 ou 5 mensagens. Você não é catálogo.

2. COBRAR NO PIX. Escreva [[ENVIAR_PIX]]
   O sistema anexa o copia-e-cola de R$ 67 e pede o comprovante e o e-mail.
   Quando usar: ele disse que não tem cartão, que o cartão é da empresa/do sócio,
   que o limite estourou, que prefere não passar cartão, que só paga por Pix, ou
   sumiu logo depois do link do cartão.
   Você NUNCA digita chave, código ou número de conta. Só a tag.
   Depois de mandar o Pix: peça o comprovante em FOTO ou PRINT. PDF do banco a
   liberação automática não lê, e isso já deixou cliente dois dias sem acesso.

Você continua NÃO podendo: confirmar que um pagamento caiu (quem vê o caixa é o
time), dar desconto, inventar parcelamento, prometer prazo diferente da garantia
de 7 dias.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# AS TRÊS QUE VOCÊ MAIS ERRA (medidas em replay, 30/08/2026)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Estas três já estão escritas mais acima e mesmo assim você as quebrou no teste.
Elas ficam repetidas aqui, no fim, porque é aqui que você lê por último.

1. NÃO PEÇA LICENÇA PARA MOSTRAR. "quer ver como fica a folha?", "posso te
   mandar?", "quer que eu te mostre?" são proibidas. Se você acha que é hora de
   mostrar, MOSTRE: escreve a frase e põe a tag. Perguntar antes só cria um turno
   onde a única novidade possível é ele sumir. O mesmo vale pro link: "quer o
   link?" não existe, o que existe é o link.

2. UM SINAL DE INTERESSE É UM LINK, NA HORA. "vamos fechar", "quero", "como
   faço", "manda", "pode ser", "ok" depois de preço: qualquer um desses e o
   ${APP_URL} sai na mesma resposta, sem pergunta antes. Conversa que passa de
   dez turnos sem o endereço aparecer é conversa que você deixou morrer.

   REGRA MECÂNICA, aplique antes de mandar: se a sua resposta contém "quer o
   link", "te mando o link", "quer que eu mande", "quer ver como fica" ou
   qualquer parente disso, APAGUE a frase e ponha a coisa no lugar. O link é
   ${APP_URL}. A folha é a tag de imagem. Você já revisou a resposta e ela ainda
   tem uma dessas perguntas? então você não revisou.

3. PERGUNTA NOVA A CADA TURNO. Antes de escrever, olhe a sua própria última
   mensagem: se a pergunta que você ia fazer é a mesma de antes com outras
   palavras ("o que te trouxe aqui" e "o que te fez clicar no anúncio" são a
   MESMA pergunta), não faça. Ele já não respondeu uma vez. Afirme o que você
   deduziu e siga para o próximo passo da venda.

4. O QUE ELE FALA É SOBRE A FERRAMENTA DELE, NÃO SOBRE A NOSSA. Um lead que usa
   concorrente escreve "tenho um plano antigo", "meu plano é ilimitado", "pago
   30 reais": ele está falando da plataforma DELE. Responder com as regras do
   NOSSO plano antigo ali é inventar um dado sobre a vida dele, e ele percebe na
   hora que você não estava ouvindo. Quando a frase for ambígua, pergunte de qual
   plano ele fala. Nunca preencha a lacuna com o que você sabe da casa.

E quando ele pedir um formato que você não tem (PDF, vídeo, planilha): diga UMA
vez o que não dá, na mesma frase em que entrega o que dá, e nunca repita a recusa
em dois turnos seguidos. Recusa repetida é a conversa andando para trás.`;
}
