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
  /** Teto de bolhas na mensagem INTEIRA — anti-metralhadora. Default 5. */
  maxBolhas?: number;
}

// 160 é o tamanho de uma mensagem que um humano digita de verdade: duas frases
// curtas só ficam juntas se somarem menos que isso; frase normal vai sozinha.
const MAX_PADRAO = 160;
const MAX_BOLHAS_PADRAO = 5;

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
    if (atual !== undefined) {
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

  // Válvula: reagrupa TUDO (inclusive atravessando o ||) com um orçamento maior,
  // afrouxando até caber no teto. Perder frase seria pior que bolha grande — e
  // com orçamento = mensagem inteira, o pior caso é uma bolha só.
  const total = segmentos.reduce((n, s) => n + s.length + 1, 0);
  let limite = Math.max(max, Math.ceil(total / maxBolhas));
  let saida = empacotar(segmentos, limite);
  while (saida.length > maxBolhas && limite < total) {
    limite = Math.min(total, Math.ceil(limite * 1.3) + 1);
    saida = empacotar(segmentos, limite);
  }
  return saida;
}
