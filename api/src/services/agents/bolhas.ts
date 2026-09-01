// ─────────────────────────────────────────────────────────────────────────────
// BOLHAS — ninguém manda parede de texto pra um humano no WhatsApp.
//
// Toda IA de mensagem daqui (Giovanna, Carla, Bia, SDR) já pede no prompt
// "máximo 2 bolhas separadas por ||". Prompt não é garantia: o modelo às vezes
// devolve um parágrafo único, e alguns fluxos mandavam a resposta CRUA pro lead
// (o cliente recebia o "||" literal no meio da frase). A regra passa a valer no
// TRANSPORTE — o que sai da linha já sai fatiado, o prompt vira só a intenção.
//
// Duas garantias que seguram o resto do sistema:
//
// 1. NUNCA truncar. Só se corta em fronteira real (|| do autor, linha em branco,
//    quebra de linha, fim de frase). Segmento sem fronteira sai inteiro, mesmo
//    passando do teto — é o que mantém o copia-e-cola do Pix (EMV, ~140 chars com
//    espaço no nome do titular) e URLs longas intactos: um Pix cortado é um
//    pagamento que falha em silêncio.
//
// 2. TETO DE BOLHAS. Fatiar sem teto transforma um template de boas-vindas em 12
//    mensagens seguidas — isso é flood, queima a linha e some no serverless (o
//    authController já viu "só a 1ª chegava"). Estourou o teto, junta de volta:
//    bolha um pouco maior é melhor que metralhadora.
//
// Fatiar é responsabilidade de UM lugar só — o `sendHuman`. Quem precisa das
// partes ANTES de enviar (pra salvar sessão, pra limitar resposta) usa
// `porBarras`, que só respeita a fronteira do autor e não corta por tamanho.
// Aplicar `emBolhas` duas vezes desfaz o teto (a válvula devolve bolha > max e a
// 2ª passada refatiaria) — por isso a divisão de papéis.
// ─────────────────────────────────────────────────────────────────────────────

export interface OpcoesBolhas {
  /** Teto de caracteres por bolha (fronteira, não tesoura). Default 160. */
  max?: number;
  /** Teto de bolhas na mensagem INTEIRA, anti-metralhadora. Default 2. */
  maxBolhas?: number;
}

// 160 é o tamanho de uma mensagem que um humano digita de verdade: duas frases
// curtas só ficam juntas se somarem menos que isso; frase normal vai sozinha.
const MAX_PADRAO = 160;

// DOIS, nao cinco. O WhatsApp conta BOLHA; o resto do sistema contava toque, e a
// diferenca entre as duas unidades e o que derrubou a linha tres vezes.
//
// Medido em 30 dias na linha IO: 1.471 toques de robo para 538 pessoas sairam
// como 5.564 mensagens, 3,78 bolhas por toque (5,22 na confirmacao de reuniao).
// Com teto 2, os MESMOS toques, para as MESMAS pessoas, com as MESMAS palavras,
// sairiam em 2.570: corte de 53,8% no contador sem perder um contato sequer.
// A razao saida/entrada, que e o sinal que o WhatsApp le, cai de 3,28 para 1,81.
//
// O modulo nunca trunca: o que passa do teto e JUNTADO de volta. Entao baixar
// para 2 nao corta texto, junta bolha. Bolha um pouco maior e melhor que
// metralhadora, e o comentario do topo do arquivo ja dizia isso.
const MAX_BOLHAS_PADRAO = 2;

// Abreviações comuns em pt-BR: o ponto delas NÃO termina frase.
const ABREVS = /^(sr|sra|srta|dr|dra|prof|profa|eng|arq|ltda|etc|ex|obs|av|r|nº|no|cia|pág|pag|fl|art|min|máx|max|aprox|séc|tel)$/i;

/** Bloco que não pode ser tocado: Pix copia-e-cola (EMV) ou token único (URL/código). */
function intocavel(s: string): boolean {
  return s.startsWith('000201') || !/\s/.test(s);
}

/**
 * Corta em fim de frase. Só corta quando há pontuação + espaço, o que já protege
 * "br.gov.bcb.pix" e "67.00" (ponto sem espaço depois). Ignora abreviação ("Sr.")
 * e numeração ("1. Cadastre o CNPJ") pra não orfanar o marcador.
 */
function frases(texto: string): string[] {
  const out: string[] = [];
  const re = /([.!?…]+)(["')\]]*)\s+/g;
  let inicio = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const anterior = texto.slice(inicio, m.index);
    const ultima = (/([\wÀ-ÿ]+)$/.exec(anterior) ?? [])[1] ?? '';
    if (ABREVS.test(ultima) || /^\d+$/.test(ultima)) continue;
    const trecho = texto.slice(inicio, m.index + m[0].length).trim();
    if (trecho) out.push(trecho);
    inicio = m.index + m[0].length;
  }
  const resto = texto.slice(inicio).trim();
  if (resto) out.push(resto);
  return out;
}

/**
 * Quebra um bloco nos átomos menores permitidos, do mais fraco pro mais forte:
 * parágrafo → linha → frase. Bloco que já cabe fica inteiro — template curto com
 * linha em branco (ex.: "te mando o link:\n\nsolardoc.app") continua UMA bolha.
 */
function fatiar(bloco: string, max: number): string[] {
  if (intocavel(bloco) || bloco.length <= max) return [bloco];

  const out: string[] = [];
  for (const paragrafo of bloco.split(/\n{2,}/)) {
    const p = paragrafo.trim();
    if (!p) continue;
    if (intocavel(p) || p.length <= max) { out.push(p); continue; }

    for (const linha of p.split('\n')) {
      const l = linha.trim();
      if (!l) continue;
      if (intocavel(l) || l.length <= max) { out.push(l); continue; }
      out.push(...frases(l));
    }
  }
  return out.length ? out : [bloco];
}

/** Espaço entre frases corridas; quebra de linha quando é lista/item/emoji. */
function separador(a: string, b: string): string {
  if (a.includes('\n')) return '\n';
  const prosa = /[.!?…]["')\]]*$/.test(a) && /^[A-Za-zÀ-ÿ("']/.test(b);
  return prosa ? ' ' : '\n';
}

/** Junta átomos vizinhos enquanto couber no limite (não reordena, não corta). */
function empacotar(segmentos: string[], limite: number): string[] {
  const out: string[] = [];
  for (const seg of segmentos) {
    const atual = out[out.length - 1];
    // Bloco intocável (Pix copia-e-cola, URL, token) nunca é fundido com vizinho,
    // nem quando o orçamento permitiria. Ele PODE ser cortado? não, `fatiar` já
    // protege. O que faltava era a outra ponta: ao baixar o teto de bolhas para 2
    // a válvula passou a GRUDAR o código do Pix numa frase, e código de pagamento
    // no meio de texto é um copia-e-cola que o cliente não consegue copiar. O
    // teste "o código continua uma bolha só" pegou isso antes de ir pro ar.
    //
    // Consequência aceita: uma resposta com Pix sai em 3 bolhas mesmo com teto 2.
    // O teto protege a reputação do número; o Pix é a receita entrando. Quando os
    // dois brigam, ganha o Pix, e é raro o bastante pra não mover o contador.
    if (atual !== undefined && !intocavel(seg) && !intocavel(atual)) {
      const sep = separador(atual, seg);
      if (atual.length + sep.length + seg.length <= limite) {
        out[out.length - 1] = atual + sep + seg;
        continue;
      }
    }
    out.push(seg);
  }
  return out;
}

/**
 * Fronteira do AUTOR (`||`) e nada mais. Pra quem precisa das partes antes do
 * envio — salvar sessão, limitar a resposta a N bolhas. Não corta por tamanho:
 * isso é do `sendHuman`, uma vez só.
 */
export function porBarras(bruto: string | null | undefined): string[] {
  return String(bruto ?? '').split('||').map(s => s.trim()).filter(Boolean);
}

/**
 * Texto cru da IA (ou de um template) → bolhas de WhatsApp, frase a frase.
 * O `||` do autor é fronteira dura; dentro do bloco corta por tamanho. Se o
 * total estourar o teto de bolhas, junta de volta (inclusive atravessando o
 * `||`) — flood é pior que bolha grande, e texto nunca se perde.
 */
export function emBolhas(bruto: string | null | undefined, opts: OpcoesBolhas = {}): string[] {
  const max = opts.max ?? MAX_PADRAO;
  const maxBolhas = opts.maxBolhas ?? MAX_BOLHAS_PADRAO;

  const texto = String(bruto ?? '').replace(/\r\n/g, '\n').trim();
  if (!texto) return [];

  const blocos = porBarras(texto);
  const segmentos = blocos.flatMap(b => fatiar(b, max));
  const bolhas = blocos.flatMap(b => empacotar(fatiar(b, max), max));
  if (bolhas.length <= maxBolhas) return bolhas;

  // Válvula: junta o MÍNIMO necessário pra caber no teto.
  //
  // A versão anterior reagrupava tudo com um orçamento único (total/maxBolhas) e
  // por isso cortava demais: pedindo 4 ela devolvia 3, e a confirmação de reunião
  // ia de 5 bolhas de ~140 caracteres para 3 de ~280, afundando o pedido de *SIM*
  // que é a única alavanca contra o no-show. Reduzir mais do que o pedido não é
  // conservador, é destruir fronteira que o autor escreveu de propósito.
  //
  // Agora funde de par em par, sempre o par adjacente de menor soma, até bater o
  // teto. As fronteiras que sobrevivem são as que mais separam ideia grande, e o
  // resultado tem EXATAMENTE maxBolhas bolhas (ou menos, se algum par não puder
  // ser fundido).
  const saida = bolhas.slice();
  while (saida.length > maxBolhas) {
    let alvo = -1;
    let menor = Infinity;
    for (let i = 0; i < saida.length - 1; i++) {
      // Bloco intocável (Pix, URL, token) nunca entra numa fusão.
      if (intocavel(saida[i]!) || intocavel(saida[i + 1]!)) continue;
      const soma = saida[i]!.length + saida[i + 1]!.length;
      if (soma < menor) { menor = soma; alvo = i; }
    }
    if (alvo < 0) break;   // só sobraram intocáveis: o teto cede, o código não.
    const a = saida[alvo]!;
    const b = saida[alvo + 1]!;
    saida.splice(alvo, 2, a + separador(a, b) + b);
  }
  return saida;
}
