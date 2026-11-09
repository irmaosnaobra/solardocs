/* ─────────────────────────────────────────────────────────────────────────────
   ABERTURA — a 1ª DM do Instagram, montada de peças, em UM balão só.

   Funções puras (sem rede, sem Chrome, sem banco, sem relógio): o worker lê o banco
   e a hora de Brasília e passa os números. Testado por teste-abertura.mjs.

   Mensagem = "{saudação} {apresentação} {pergunta}". Sem link, sem preço.
     saudação      "Oi," / "Olá," sempre; mais uma pela hora de Brasília
                   (Bom dia 0h-11h59, Boa tarde 12h-17h59, Boa noite 18h em diante)
     apresentação  4 jeitos de dizer "aqui é da equipe do SolarDoc."
     pergunta      versão A (horas gastas com proposta) ou B (proposta antes/depois do concorrente),
                   cada uma com 4 jeitos, com e sem {empresa}/{cidade}

   CONTRATO DO OBS (o placar e o ritmo.mjs leem isto; NÃO mude o formato):
     "worker instagram v=<A|B> s=<1-5> a=<1-4> p=<1-4>"
     "worker instagram incerto v=<A|B> s=<n> a=<n> p=<n>"          (quando o envio é incerto)
     s: 1 Oi · 2 Olá · 3 Bom dia · 4 Boa tarde · 5 Boa noite
   ───────────────────────────────────────────────────────────────────────────── */

export const SAUDACOES = { 1: 'Oi,', 2: 'Olá,', 3: 'Bom dia,', 4: 'Boa tarde,', 5: 'Boa noite,' };

export const APRESENTACOES = {
  1: 'aqui é da equipe do SolarDoc.',
  2: 'sou da equipe do SolarDoc.',
  3: 'escrevo da equipe do SolarDoc.',
  4: 'aqui quem escreve é da equipe do SolarDoc.',
};

export const PERGUNTAS = {
  A: {
    1: ['Quantas horas por mês a {empresa} gasta montando proposta, tempo que podia estar virando venda?',
        'Quantas horas por mês vocês gastam montando proposta, tempo que podia estar virando venda?'],
    2: ['Você sabe quantas horas por mês a {empresa} gasta montando proposta, tempo que podia ir pra venda?',
        'Você sabe quantas horas por mês vocês gastam montando proposta, tempo que podia ir pra venda?'],
    3: ['Chutando, quantas horas por mês a {empresa} gasta com proposta, tempo que podia ir pra fechar mais cliente?',
        'Chutando, quantas horas por mês vocês gastam com proposta, tempo que podia ir pra fechar mais cliente?'],
    4: ['Queria saber: quantas horas por mês a {empresa} perde montando proposta, tempo que podia virar venda?',
        'Queria saber: quantas horas por mês vocês perdem montando proposta, tempo que podia virar venda?'],
  },
  B: {
    1: ['Aí em {cidade}, a proposta de vocês chega ao cliente antes ou depois da do concorrente?',
        'A proposta de vocês chega ao cliente antes ou depois da do concorrente?'],
    2: ['Aí em {cidade}, quando o cliente pede proposta, a de vocês chega antes ou depois da do concorrente?',
        'Quando o cliente pede proposta, a de vocês chega antes ou depois da do concorrente?'],
    3: ['Pra vocês aí em {cidade}, quem manda a proposta primeiro: vocês ou o concorrente?',
        'Quem manda a proposta primeiro pro cliente: vocês ou o concorrente?'],
    4: ['Queria saber uma coisa: aí em {cidade}, a proposta de vocês sai antes ou depois da do concorrente?',
        'Queria saber uma coisa: a proposta de vocês sai antes ou depois da do concorrente?'],
  },
};

/** A abertura de peças ("equipe do SolarDoc") só vale para a 1ª DM do Instagram do produto solardoc. Outro produto ou canal: scripts do banco, como sempre. */
export const usaAberturaNova = (canal, produtoId) => canal === 'instagram' && produtoId === 'solardoc';

/** Saudação "da hora": 3 (Bom dia), 4 (Boa tarde) ou 5 (Boa noite), pela hora cheia de Brasília. */
export const saudacaoDoPeriodo = hora => (hora < 12 ? 3 : hora < 18 ? 4 : 5);
/** As 3 saudações válidas nesta hora: 1 (Oi), 2 (Olá) e a do período. */
export const saudacoesDaHora = hora => [1, 2, saudacaoDoPeriodo(Number(hora))];

/** Texto de empresa/cidade pronto para entrar na frase: sem chaves, espaços aparados. Vazio = campo vazio. */
const limpo = v => String(v ?? '').replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim();

/** Separadores que encerram o NOME (o que vem depois é slogan/descrição do perfil). O mais cedo na frase vence. */
const SEPARADORES = [' - ', ' – ', ' — ', ' | ', '|', ' · ', ': ', ' / '];
/** Marcas, emojis e invisíveis que não entram na frase. */
const LIXO_VISUAL = /[®™©]|[\p{Extended_Pictographic}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu;
/** Sufixos jurídicos no fim do nome (LTDA, EIRELI, EPP, MEI, S/A, S.A.; ME e SA só em maiúscula, para não comer palavra). */
const SUFIXO_JURIDICO = /(?:[\s,.;-]+)(?:ltda|eireli|epp|mei|s\/a|s\.a)\.?$/i;
const SUFIXO_JURIDICO_MAIUSC = /(?:[\s,.;-]+)(?:ME|SA)\.?$/;   // sem /i: "Casa da Sa" e "Energize Me" ficam
/** O nome inteiro é só um sufixo jurídico ("Ltda", "S/A"): não é nome. */
const SO_SUFIXO = /^(?:ltda|eireli|epp|mei|me|sa|s\/a|s\.a)\.?$/i;
/** Nome que COMEÇA com termo genérico do ramo ("Energia solar em Goiânia", "Energia Solar Fotovoltaica"): não é nome de empresa. */
const COMECA_GENERICO = /^(?:energias?\s+(?:solar(?:es)?|fotovoltaic[ao]s?|renov[aá]ve(?:l|is))|solar\s+(?:fotovoltaic\w*|em|de|para)\b|(?:sistemas?|projetos?|instala[cç](?:[aã]o|[oõ]es)|usinas?|placas?|pain[ée]is|paineis)\s+(?:de\s+)?(?:energia|solar|fotovolt\w*))/i;
export const NOME_MAX_CHARS = 24;
export const NOME_MAX_PALAVRAS = 4;

const cortaNoPrimeiroSeparador = (texto, separadores) => {
  let fim = texto.length;
  for (const s of separadores) { const i = texto.indexOf(s); if (i >= 0 && i < fim) fim = i; }
  return texto.slice(0, fim);
};

/**
 * Nome curto da empresa para a frase, ou null (a mensagem usa a versão SEM nome, "vocês").
 * O nome do perfil costuma vir com slogan ("H3 Solar - Excelência em Energia Solar"): corta no primeiro separador,
 * tira ® ™ © e emojis, tira sufixo jurídico e espaços. Só LIMPA: não muda maiúsculas.
 * null quando sobra vazio, com mais de 24 caracteres ou mais de 4 palavras, ou quando começa com termo genérico.
 */
export function nomeCurto(empresa) {
  let n = limpo(empresa);
  n = cortaNoPrimeiroSeparador(' ' + n, SEPARADORES).trim();   // o espaço na frente faz "- slogan" (separador no começo) virar nome vazio
  n = n.replace(LIXO_VISUAL, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {   // "Solar Norte Ltda ME": tira um sufixo por volta
    const sem = n.replace(SUFIXO_JURIDICO, '').replace(SUFIXO_JURIDICO_MAIUSC, '').trim();
    if (sem === n) break;
    n = sem;
  }
  n = n.replace(/^[\s,.;:–—|/·-]+|[\s,.;:–—|/·-]+$/g, '').trim();
  if (!n || SO_SUFIXO.test(n) || n.length > NOME_MAX_CHARS || n.split(' ').length > NOME_MAX_PALAVRAS || COMECA_GENERICO.test(n)) return null;
  return n;
}

const UFS = 'AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO';
/** Cidade para a frase: sem "- UF", "/UF", ", Estado", "(UF)" nem UF solta no fim. null se sobra vazio ou comprido demais. */
export function nomeCidade(cidade) {
  let c = limpo(cidade);
  c = cortaNoPrimeiroSeparador(c, [' - ', ' – ', ' — ', ' | ', '|', ' / ', '/', ',', '(']);
  c = c.replace(LIXO_VISUAL, '').replace(/\s+/g, ' ').trim();
  c = c.replace(new RegExp(`\\s+(?:${UFS})$`), '').replace(/^[\s,.;:–—|/·-]+|[\s,.;:–—|/·-]+$/g, '').trim();
  if (!c || c.length > 30 || c.split(' ').length > 5) return null;
  return c;
}

/** Monta a mensagem de UMA combinação. Campo vazio usa a versão "sem". Nunca sai "{" nem "}". */
export function montarTexto({ v, s, a, p, empresa, cidade }) {
  const par = PERGUNTAS[v] && PERGUNTAS[v][p];
  if (!par || !SAUDACOES[s] || !APRESENTACOES[a]) return null;
  // Nome curto (sem slogan do perfil) ou null: null cai na versão SEM nome ("vocês").
  const campo = v === 'A' ? nomeCurto(empresa) : nomeCidade(cidade);
  const pergunta = campo
    ? par[0].replace(v === 'A' ? '{empresa}' : '{cidade}', campo)
    : par[1];
  return `${SAUDACOES[s]} ${APRESENTACOES[a]} ${pergunta}`;
}

/** "v=A s=1 a=1 p=1" */
export const sufixoDe = ({ v, s, a, p }) => `v=${v} s=${s} a=${a} p=${p}`;
/** O obs do toque (contrato acima). */
export const obsDe = (combo, incerto = false) => `worker instagram${incerto ? ' incerto' : ''} ${sufixoDe(combo)}`;
/** Lê as peças de um obs. null se o obs não é do formato novo. */
export function lerObs(obs) {
  const m = /^worker instagram(?: incerto)? v=([AB]) s=([1-5]) a=([1-4]) p=([1-4])\s*$/.exec(String(obs || ''));
  return m ? { v: m[1], s: Number(m[2]), a: Number(m[3]), p: Number(m[4]) } : null;
}
export const chaveDe = ({ v, s, a, p }) => `${v}${s}${a}${p}`;

/** Todas as combinações válidas de uma versão nesta hora (3 saudações x 4 x 4 = 48). */
export function combosDaVersao(v, hora) {
  const lista = [];
  for (const s of saudacoesDaHora(hora)) for (const a of [1, 2, 3, 4]) for (const p of [1, 2, 3, 4]) lista.push({ v, s, a, p });
  return lista;
}

/**
 * Qual versão vai AGORA: a que tem MENOS toques "worker instagram v=" no total (contagem do BANCO).
 * Empate vai a A. Contagem ilegível (null, undefined, NaN, negativa) em qualquer das duas vai a A.
 */
export function escolherVersao(contA, contB) {
  const ok = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!ok(contA) || !ok(contB)) return 'A';
  return contB < contA ? 'B' : 'A';
}

/**
 * Total de um header Content-Range ("0-0/57", "*\/0"). null quando não dá para ler ("0-0/*", "", lixo):
 * quem chama trata null como "não sei" (a versão cai para A). Aceita "*\/0" (conjunto vazio) como 0.
 */
export function totalDoContentRange(texto) {
  const m = /\/(\d+)\s*$/.exec(String(texto ?? ''));
  return m ? Number(m[1]) : null;
}

/** Chaves (v+s+a+p) das combinações que já saíram hoje, a partir dos obs do dia. */
export function chavesUsadas(obsLista) {
  const set = new Set();
  for (const o of Array.isArray(obsLista) ? obsLista : []) {
    const c = lerObs(o);
    if (c) set.add(chaveDe(c));
  }
  return set;
}

/**
 * Sorteia a abertura de agora.
 *  - versao: 'A' ou 'B' (a de menos toques no banco);
 *  - usadas: Set (ou lista) de chaves já usadas HOJE nesta conta: não repete enquanto houver combinação livre;
 *  - bloqueia(texto): a trava de alegações do worker. Combinação que a trava barra é descartada;
 *    se a versão inteira estiver barrada, tenta a outra; se as duas, devolve null (não inventa);
 *  - rnd: () => 0..1, de fora (o teste usa um gerador fixo).
 * Devolve { texto, combo: {v,s,a,p}, obs, obsIncerto, repetida } ou null.
 */
export function escolherAbertura({ empresa, cidade, hora, versao = 'A', usadas = [], bloqueia = () => false, rnd = Math.random }) {
  const jaUsadas = usadas instanceof Set ? usadas : new Set(usadas);
  const ordem = versao === 'B' ? ['B', 'A'] : ['A', 'B'];
  for (const v of ordem) {
    const vivas = combosDaVersao(v, hora)
      .map(combo => ({ combo, texto: montarTexto({ ...combo, empresa, cidade }) }))
      .filter(x => x.texto && !bloqueia(x.texto));
    if (!vivas.length) continue;
    const livres = vivas.filter(x => !jaUsadas.has(chaveDe(x.combo)));
    const pool = livres.length ? livres : vivas;
    const f = Math.min(0.999999, Math.max(0, Number(rnd())));
    const x = pool[Math.floor(f * pool.length)];
    return { texto: x.texto, combo: x.combo, obs: obsDe(x.combo), obsIncerto: obsDe(x.combo, true), repetida: !livres.length };
  }
  return null;
}
