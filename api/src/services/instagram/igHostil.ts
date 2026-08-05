// ─────────────────────────────────────────────────────────────────────────────
// Filtro de comentário hostil (05/08/2026).
//
// Duas coisas erradas aconteciam antes disto:
//   1) as automações fixadas em anúncio casam com `match_tipo='qualquer'` — ou
//      seja, TODO comentário no anúncio recebia a DM de venda, inclusive
//      "isso é golpe" e xingamento. Responder "Show! O Eletroposto é uma
//      oportunidade..." pra quem xingou é o pior tipo de resposta automática;
//   2) ninguém ficava sabendo. Comentário agressivo em anúncio pago fica na
//      vitrine do post, e é a primeira coisa que o próximo lead lê.
//
// O que este módulo faz: separa hostil de dúvida. "Quanto custa?" continua
// lead; "vocês são picaretas" vira aviso pro dono e NÃO recebe DM.
//
// Puro de propósito (só texto entra) — tem teste, porque falso positivo aqui
// silencia cliente de verdade.
// ─────────────────────────────────────────────────────────────────────────────

export type TipoHostil = 'xingamento' | 'acusacao' | 'ameaca';

export interface Hostilidade {
  hostil: boolean;
  tipo?: TipoHostil;
  termo?: string;
}

const ACENTOS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
const norm = (s: string): string =>
  (s || '').toLowerCase().normalize('NFD').replace(ACENTOS, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// Xingamento explícito. Fragmentos (sem acento) que só aparecem no palavrão.
const XINGAMENTO = [
  'caralho', 'porra', 'merda', 'bosta', 'puta', 'putaria', 'pqp', 'fdp', 'vtnc',
  'vai se fuder', 'vai tomar no', 'foda se', 'desgraca', 'desgracado', 'arrombado',
  'otario', 'babaca', 'idiota', 'imbecil', 'cretino', 'escroto', 'nojento', 'nojenta',
  'palhaco', 'palhacada', 'vagabundo', 'vagabunda', 'safado', 'canalha', 'corno',
  'retardado', 'debil mental', 'burro', 'burra', 'lixo',
];

// Acusação: não é xingamento, mas também não é lead — e o dono precisa ver.
const ACUSACAO = [
  'golpe', 'golpista', 'picareta', 'picaretagem', 'estelionato', 'fraude', 'fraudador',
  'enganacao', 'enganando', 'enganou', 'roubo', 'roubaram', 'ladrao', 'ladroes', '171',
  'charlatao', 'mentiroso', 'mentirosos', 'farsa', 'propaganda enganosa',
  'nao entregam', 'nao entregaram', 'tomei calote', 'calote', 'procon', 'processar',
  'vou denunciar', 'denuncia',
];

const AMEACA = [
  'vou te pegar', 'sei onde voce mora', 'vou acabar com', 'te encontro', 'vai levar processo',
];

/**
 * Casa termo INTEIRO (evita "assassinato" virar xingamento por um pedaço),
 * aceitando o plural — "bando de picaretas" tem que casar com "picareta".
 */
function achar(texto: string, lista: string[]): string | null {
  for (const termo of lista) {
    const re = new RegExp('(^|\\s)' + termo.replace(/\s+/g, '\\s+') + 's?(\\s|$)');
    if (re.test(texto)) return termo;
  }
  return null;
}

export function classificarHostil(texto: string): Hostilidade {
  const t = norm(texto);
  if (!t) return { hostil: false };

  const x = achar(t, XINGAMENTO);
  if (x) return { hostil: true, tipo: 'xingamento', termo: x };

  const am = achar(t, AMEACA);
  if (am) return { hostil: true, tipo: 'ameaca', termo: am };

  const ac = achar(t, ACUSACAO);
  if (ac) {
    // "é golpe?" é dúvida de quem tem medo de comprar — esse é lead, e dos
    // bons. O limite de tamanho é o que separa a pergunta curta do discurso
    // que só termina em interrogação ("é golpe? não caiam nessa, eu perdi…").
    // Quem cita Procon ou processo entra mesmo perguntando: é reclamação.
    const duvida = /\?/.test(texto) && texto.trim().length <= 50
      && ac !== 'procon' && ac !== 'processar' && ac !== 'vou denunciar' && ac !== 'denuncia';
    if (duvida) return { hostil: false };
    return { hostil: true, tipo: 'acusacao', termo: ac };
  }

  return { hostil: false };
}
