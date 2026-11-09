// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO, as regras que moram em CÓDIGO e não na vontade da IA.
//
// A IA lê a conversa e classifica (intenção, se a pessoa disse sim, uma bolha de
// reconhecimento). Quem decide O QUE SAI no turno é este arquivo:
//   1º a OFERTA fixa do diagnóstico, 2º o LINK só depois de um sim à oferta;
//   nunca link em objeção, sem interesse, parar, não é decisor, ambíguo ou
//   resposta automática; no máximo 2 mensagens por turno, sempre.
//
// Tudo aqui é puro (sem banco, sem IA, sem relógio), para dar para testar sem
// nenhum dos três. A única aleatoriedade é Math.random, e os testes a fixam.
// ─────────────────────────────────────────────────────────────────────────────

export type VersaoPergunta = 'A' | 'B';

/** Teto de mensagens por turno: bolhas + imagens + link. */
export const MAX_MENSAGENS_TURNO = 2;

const TEXTO_A = 'as horas por mês que vão pra proposta';
const TEXTO_A2 = 'quanto tempo por mês ela toma';
const TEXTO_B = 'a velocidade da proposta';

/** A oferta da versão A (pergunta das horas por mês). */
export const OFERTAS_A: readonly string[] = [
  `Existe um diagnóstico grátis da proposta de vocês, que mostra o Índice de Proposta e ${TEXTO_A}. Posso te mandar o link?`,
  `Tem um diagnóstico grátis, com perguntas de um toque, que mostra o seu Índice de Proposta e ${TEXTO_A}. Posso te mandar o link?`,
  `Temos um diagnóstico da proposta, grátis, que mostra o Índice de Proposta e ${TEXTO_A2}. Quer que eu te mande o link?`,
];

/** A oferta da versão B (pergunta antes ou depois do concorrente): as mesmas três, com a velocidade. */
export const OFERTAS_B: readonly string[] = OFERTAS_A.map(o => o.replace(TEXTO_A, TEXTO_B).replace(TEXTO_A2, TEXTO_B));

/** Despedida do sem_interesse. "||" separa as bolhas (no máximo 2). */
export const DESPEDIDAS: readonly string[] = [
  'Tranquilo, obrigado por responder.||Sucesso aí com as obras.',
  'Sem problema, obrigado por responder.||Sucesso nas obras aí.',
  'Entendido, obrigado pela resposta.||Sucesso aí com as obras de vocês.',
];

/** Os 6 textos fixos de oferta (toque sem versão usa a oferta da versão A). */
export const TODAS_AS_OFERTAS: readonly string[] = [...OFERTAS_A, ...OFERTAS_B];

const norm = (t: string) =>
  String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const OFERTAS_NORM = new Set(TODAS_AS_OFERTAS.map(norm));

// O trecho distintivo da oferta: fala do diagnóstico, do Índice de Proposta e termina pedindo o link.
// No WhatsApp o texto vem da TELA e traz hora, "Lida" e prévia de link na mesma linha: igualdade exata não serve.
const TRECHO_OFERTA = /diagnostico.*indice de proposta.*(?:posso te mandar o link|quer que eu te mande o link)\s*\?/;

/** Este texto é uma das ofertas fixas? Instagram (banco, texto exato) ou WhatsApp (tela, pelo trecho distintivo). */
export const ehOferta = (texto: string): boolean => {
  const n = norm(texto);
  return OFERTAS_NORM.has(n) || TRECHO_OFERTA.test(n);
};

/** Quantas vezes a oferta já saiu nesta conversa (falas nossas que são a oferta). */
export const contarOfertas = (historico: Array<{ de: string; texto: string }>): number =>
  historico.filter(h => h.de === 'nos' && ehOferta(h.texto)).length;

/** No máximo 2 ofertas por conversa. Depois disso a IA só responde, até a pessoa dizer sim (aí vai o link). */
export const MAX_OFERTAS_CONVERSA = 2;

/** A última fala NOSSA foi a oferta? (A última de 'nos', mesmo que o lead tenha escrito depois.) */
export function ultimaNossaFoiOferta(historico: Array<{ de: string; texto: string }>): boolean {
  for (let i = historico.length - 1; i >= 0; i--) {
    if (historico[i].de === 'nos') return ehOferta(historico[i].texto);
  }
  return false;
}

/** Lê a versão do obs do toque frio: "worker instagram v=A s=1 a=2 p=3" ou "worker instagram incerto v=B ...". */
export function versaoDoObs(obs: string | null | undefined): VersaoPergunta | null {
  const o = String(obs || '');
  if (!/^worker\b/i.test(o)) return null;
  const m = o.match(/\bv=([AB])\b/);
  return m ? (m[1] as VersaoPergunta) : null;
}

/** A versão do ÚLTIMO toque frio do contato (toques mais novos primeiro). Toque sem "v=" é antigo: devolve null. */
export function versaoDoUltimoToqueFrio(
  toques: Array<{ obs?: string | null; criado_em?: string | null }>,
): VersaoPergunta | null {
  const frios = toques
    .filter(t => /^worker\b/i.test(String(t.obs || '')) && /^worker\s+(instagram|whatsapp)\b/i.test(String(t.obs || '')))
    .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  return frios.length ? versaoDoObs(frios[0].obs) : null;
}

const sorteia = <T>(lista: readonly T[], evitar?: string): T => {
  const opcoes = evitar ? lista.filter(x => norm(String(x)) !== norm(evitar)) : lista;
  const base = opcoes.length ? opcoes : lista;
  return base[Math.min(base.length - 1, Math.floor(Math.random() * base.length))];
};

/** A oferta fixa da versão lida. `evitar` é a última fala nossa, para não repetir a mesma frase seguida. */
export function escolherOferta(versao: VersaoPergunta | null, evitar?: string): string {
  // Toque antigo (sem v=) recebe a oferta da versão A.
  return sorteia(versao === 'B' ? OFERTAS_B : OFERTAS_A, evitar);
}

export function escolherDespedida(): string[] {
  return sorteia(DESPEDIDAS).split('||').map(s => s.trim()).filter(Boolean).slice(0, 2);
}

// ── Veredito cru da IA → o que sai ───────────────────────────────────────────

export interface VereditoCru {
  intencao: string;
  resultado: string;
  bolhas: string[];
  mandar_link: boolean;
  material: string[];
  escalar: boolean;
  motivo: string;
  disse_sim?: boolean;
}

export interface EstadoConversa {
  /** A última fala nossa foi uma das ofertas fixas. */
  ofertaFeita: boolean;
  /** Quantas ofertas já saíram nesta conversa. */
  ofertasFeitas?: number;
  /** Versão lida do obs do último toque frio; null = toque antigo ou desconhecido. */
  versao: VersaoPergunta | null;
  /** A última fala nossa, para a oferta não repetir a mesma frase. */
  ultimaNossa?: string;
  /** O que o lead escreveu na conversa (para saber que número ele mesmo citou). */
  falasDele?: string[];
  /** A última mensagem do lead. */
  ultimaDele?: string;
  /** Quantas vezes o link do diagnóstico já saiu nesta conversa. */
  linksEnviados?: number;
}

export type Decisao<V extends VereditoCru> = V & {
  /** Resposta automática de perfil: nada sai, nada vira toque. */
  nao_enviar?: boolean;
  /** Este turno terminou na oferta fixa. */
  oferta?: boolean;
  versao?: VersaoPergunta | null;
};

const INTENCOES_OFERTA = new Set(['interessado', 'pediu_info', 'pediu_preco', 'quer_link', 'respondeu_pergunta']);
const SEM_LINK = new Set(['objecao', 'sem_interesse', 'parar', 'nao_e_decisor', 'ambiguo', 'resposta_automatica', 'precisa_humano']);

// Os únicos números que a IA pode escrever do SolarDoc: R$ 67 e a garantia de 7 dias.
const NUMEROS_PERMITIDOS = new Set(['67', '00', '7']);
const PEDIDO_DE_LINK = /\b(link|manda|mande|envia|envie|reenvia|reenvie|passa|cad[eê])\b/i;
// Toda forma de prometer teste, período ou dias grátis. O fato oficial "não tem teste nem período
// grátis" também casa aqui: quem o libera é a negação COLADA ao termo (NEGACAO_COLADA), abaixo.
const PROMETE_GRATIS = new RegExp([
  'test(?:e|ar|ando|amos|ou)\\s+gr[aá]tis',
  'test\\w*\\s+gratuit\\w*',
  'test\\w*\\s+de\\s+gra[cç]a',
  'experiment\\w*\\s+(?:de\\s+gra[cç]a|gr[aá]tis|gratuit\\w*)',
  'per[ií]odo\\s+(?:gr[aá]tis|gratuito|de\\s+teste|de\\s+experi\\w+)',
  'dias?\\s+(?:gr[aá]tis|gratuitos?|de\\s+teste|de\\s+experi\\w+)',
  'gr[aá]tis\\s+por\\s+\\d+\\s+dias',
].join('|'), 'gi');
// A negação só vale colada ao termo: "não tem teste grátis", "não existe período grátis", "sem teste grátis",
// "não tem teste nem período grátis" (no máximo 2 palavras entre a negação e o termo).
// "Não tem fidelidade e você usa 7 dias grátis" NÃO passa: a negação é de outra coisa.
const NEGACAO_COLADA = /(?:n[aã]o\s+(?:tem|temos|existe|h[aá]|oferecemos|damos)|sem)\s+(?:\S+\s+){0,2}$/i;

/** A bolha promete teste/período/dias grátis sem negar colado ao termo? */
export function prometeGratis(bolha: string): boolean {
  const b = String(bolha || '');
  for (const m of b.matchAll(PROMETE_GRATIS)) {
    const antes = b.slice(Math.max(0, (m.index ?? 0) - 50), m.index ?? 0);
    if (!NEGACAO_COLADA.test(antes)) return true;
  }
  return false;
}

/**
 * Cinto e suspensório do SolarDoc: a bolha da IA não pode prometer teste ou
 * período grátis (salvo negando colado ao termo, como no fato "não tem teste
 * nem período grátis") nem citar número que não esteja nos fatos nem na fala da
 * própria pessoa. Se violar, a bolha vira um "Entendi." neutro.
 */
export function bolhaSegura(bolha: string, falasDele: string[] = []): string {
  const b = String(bolha || '');
  if (prometeGratis(b)) return 'Entendi.';
  const dele = new Set((falasDele.join(' ').match(/\d+/g) || []));
  for (const n of b.match(/\d+/g) || []) {
    if (!NUMEROS_PERMITIDOS.has(n) && !dele.has(n)) return 'Entendi.';
  }
  return b;
}

/** Tira link e linha vazia, como a IA foi instruída a não escrever. */
const limpa = (bolhas: string[]) =>
  (bolhas || []).map(b => String(b).replace(/https?:\/\/\S+/g, '').trim()).filter(Boolean);

/**
 * Aplica as regras de código sobre o que a IA classificou. Não muta o `v` de entrada.
 * `solardoc=false` (outro produto): só valem resposta_automatica e o teto de 2 mensagens;
 * o resto do comportamento antigo (link por vontade da IA, material) fica como era.
 */
export function aplicarRegras<V extends VereditoCru>(v: V, estado: EstadoConversa, solardoc: boolean): Decisao<V> {
  const o: Decisao<V> = { ...v, bolhas: limpa(v.bolhas), material: [...(v.material || [])] };

  // Resposta automática do perfil: o ramo é de código. Nada sai e nada vira toque.
  if (o.intencao === 'resposta_automatica') {
    return { ...o, bolhas: [], material: [], mandar_link: false, escalar: false, nao_enviar: true, oferta: false };
  }

  if (!solardoc) {
    if (!o.bolhas.length) o.bolhas = ['Beleza.'];
    if (o.resultado === 'nao_perturbar') { o.mandar_link = false; o.material = []; }
    o.material = [...new Set(o.material)].slice(0, 3);
    return limitarA2(o);
  }

  // ── SolarDoc ──
  o.material = [];                                   // nada de imagem, nunca
  const falas = estado.falasDele || [];
  const reconhece = bolhaSegura(o.bolhas[0] || 'Entendi.', falas);

  if (o.resultado === 'nao_perturbar') {
    // Pediu para parar: só o pedido de desculpa da IA, sem oferta, sem link.
    return { ...o, bolhas: [reconhece], mandar_link: false, oferta: false };
  }

  if (o.intencao === 'sem_interesse') {
    return { ...o, bolhas: escolherDespedida(), mandar_link: false, oferta: false };
  }

  if (SEM_LINK.has(o.intencao)) {
    // Objeção, não é decisor, ambíguo, parar, precisa de humano: a IA responde, sem oferta e sem link.
    return limitarA2({ ...o, bolhas: o.bolhas.map(b => bolhaSegura(b, falas)), mandar_link: false, oferta: false });
  }

  // LINK JÁ ENVIADO: nada de oferta nova e nada de link por "sim" ou "obrigado". A IA responde
  // normalmente (no máximo 2 bolhas). Só reenvia se a pessoa PEDIU o link de novo (quer_link
  // explícito, e a fala dela cita o link), e no máximo uma vez a mais por conversa.
  if ((estado.linksEnviados ?? 0) > 0) {
    const pediuDeNovo = o.intencao === 'quer_link' && o.disse_sim !== true
      && PEDIDO_DE_LINK.test(estado.ultimaDele || '') && (estado.linksEnviados ?? 0) < 2;
    if (pediuDeNovo) return { ...o, bolhas: [reconhece], mandar_link: true, oferta: false, versao: estado.versao };
    return limitarA2({ ...o, bolhas: o.bolhas.map(b => bolhaSegura(b, falas)), mandar_link: false, oferta: false });
  }

  // Quem disse sim DEPOIS da oferta recebe o link: no máximo 1 bolha curta + link.
  const ofertasFeitas = estado.ofertasFeitas ?? (estado.ofertaFeita ? 1 : 0);
  if (estado.ofertaFeita && o.disse_sim === true) {
    return { ...o, bolhas: [reconhece], mandar_link: true, oferta: false, versao: estado.versao };
  }
  // Esgotadas as 2 ofertas (e a última fala nossa já é uma resposta, não a oferta), o "sim" NÃO vale:
  // uma pergunta nossa qualquer ("Quer ver como fica?") não é a oferta. O link só sai se a intenção
  // for quer_link E a última fala da pessoa pedir o link de forma explícita.
  if (ofertasFeitas >= MAX_OFERTAS_CONVERSA && !estado.ofertaFeita
      && o.intencao === 'quer_link' && PEDIDO_DE_LINK.test(estado.ultimaDele || '')) {
    return { ...o, bolhas: [reconhece], mandar_link: true, oferta: false, versao: estado.versao };
  }

  // Interesse, pedido de informação ou resposta à pergunta: reconhece + a OFERTA fixa. Sem link.
  // No máximo 2 ofertas por conversa: depois a IA só responde.
  if (INTENCOES_OFERTA.has(o.intencao) && ofertasFeitas < MAX_OFERTAS_CONVERSA) {
    const oferta = escolherOferta(estado.versao, estado.ultimaNossa);
    return { ...o, bolhas: [reconhece, oferta], mandar_link: false, oferta: true, versao: estado.versao };
  }

  // Qualquer outra coisa: a IA responde, sem link.
  return limitarA2({ ...o, bolhas: o.bolhas.map(b => bolhaSegura(b, falas)), mandar_link: false, oferta: false });
}

/** No máximo 2 mensagens no turno: bolhas + imagens + link. Sempre sobra pelo menos 1 bolha. */
export function limitarA2<V extends VereditoCru>(v: Decisao<V>): Decisao<V> {
  const link = v.mandar_link ? 1 : 0;
  const bolhas = v.bolhas.slice(0, Math.max(1, MAX_MENSAGENS_TURNO - link));
  const material = (v.material || []).slice(0, Math.max(0, MAX_MENSAGENS_TURNO - link - bolhas.length));
  return { ...v, bolhas, material };
}
