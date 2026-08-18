// ─────────────────────────────────────────────────────────────────────────────
// A CIDADE COMO ELA CHEGA — separar nome de UF em texto digitado por gente.
//
// O campo `cidade` da LP é texto livre, e o que chega não se parece com o que se
// imagina. Levantamento sobre as 58 strings que existem hoje na base:
//
//   NENHUMA tem vírgula. Um `texto.split(',')` não falha às vezes — ele devolve
//   "Araguari-MG" inteiro, com a UF grudada, em 57 de 57 casos.
//
//   São 8 formatos vivos: "Araguari-MG" · "Petrolina PE" · "Rio Claro sp" ·
//   "Manaus - AM" · "Caruaru- pe" · "Londrina/PR" · "Itapipoca/ceara" ·
//   "Irecê Bahia" · "Divinopolis Minas gerais" (estado em DUAS palavras) ·
//   "Osasco" (sem UF nenhuma, 13 casos) · "Porto seguro e Eunapolis/ BA".
//
// A REGRA QUE MANDA AQUI: na dúvida, devolver null. Uma UF errada manda o lead
// pro outro lado do país e ninguém percebe; uma UF nula só deixa de sugerir.
//
// Não reaproveita a normalizeCidade() de dashboard/public/gerador/solar-data.js:
// aquela apaga hífen e barra SEM pôr espaço ("Maceio-AL" vira "maceioal") e
// silenciosamente destrói o casamento com "Maceio". Ela foi escrita pra bater em
// tabela de HSP, onde a chave já vem só com o nome.
// ─────────────────────────────────────────────────────────────────────────────

/** Nome do estado por extenso → sigla. Espelha o NOME_UF de offgrid/frete.ts. */
const UF_POR_NOME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amazonas: 'AM', amapa: 'AP', bahia: 'BA',
  ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO',
  maranhao: 'MA', 'minas gerais': 'MG', 'mato grosso do sul': 'MS', 'mato grosso': 'MT',
  para: 'PA', paraiba: 'PB', pernambuco: 'PE', piaui: 'PI', parana: 'PR',
  'rio de janeiro': 'RJ', 'rio grande do norte': 'RN', rondonia: 'RO', roraima: 'RR',
  'rio grande do sul': 'RS', 'santa catarina': 'SC', sergipe: 'SE', 'sao paulo': 'SP',
  tocantins: 'TO',
};

const SIGLAS = new Set(Object.values(UF_POR_NOME));

/** Tira acento e caixa. NÃO mexe em pontuação — ela carrega a UF nesta etapa. */
export function semAcento(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Chave de comparação de NOME de município. Roda DEPOIS da separação, nunca
 * antes — antes, a pontuação ainda carrega a UF.
 *
 * Derruba TUDO que não é letra ou número, espaço inclusive, sem pôr nada no
 * lugar. É o que faz "Santa Bárbara d'Oeste" casar com "Santa Barbara dOeste" e
 * "Xique-Xique" casar com "Xique Xique" na mesma regra: a pontuação que separa
 * palavra e a que gruda palavra são a mesma sujeira, e tratar uma como espaço
 * quebraria a outra.
 */
export function chaveMunicipio(s: string): string {
  return semAcento(s).replace(/[^a-z0-9]+/g, '');
}

/**
 * Preposições que denunciam nome de cidade cortado no meio.
 * "São Domingos do Maranhão" tem o nome do estado NO PRÓPRIO NOME: cortar deixa
 * "São Domingos do", que não é lugar nenhum. E o estado embutido nem sempre é o
 * estado certo — "Conceição do Pará" fica em MINAS, não no Pará.
 */
const PREPOSICOES = new Set(['do', 'da', 'de', 'dos', 'das', 'd', 'no', 'na']);

/**
 * Os municípios do Brasil que têm " e " no nome. São TRÊS, conferidos contra a
 * tabela do IBGE — a lista é fechada e não muda sem município novo nascer.
 * Sem esta exceção eles cairiam na regra de "duas cidades" e nunca resolveriam.
 */
const NOME_COM_E = new Set(['abreu e lima', 'pontes e lacerda', 'passa e fica']);

export interface CidadeParseada {
  /** Nome do município, ou null quando o texto não permite decidir. */
  cidade: string | null;
  /** Sigla de 2 letras, ou null quando o texto não a carrega. */
  uf: string | null;
  /** Mais de um topônimo na mesma string ("Porto seguro e Eunapolis/ BA"). */
  duasCidades: boolean;
}

/**
 * Tenta ler uma UF no FIM do texto e devolve o que sobrou.
 *
 * Duas portas, e a diferença entre elas é o que segura "Ji-Paraná":
 *   · SIGLA de 2 letras — aceita depois de espaço, hífen ou barra
 *   · NOME por extenso  — aceita depois de espaço ou barra, NUNCA de hífen colado
 *
 * Sem essa distinção, "Ji-Paraná" (que fica em RO) viraria cidade "Ji" no estado
 * "PR", do outro lado do país. Mesma armadilha em "Xique-Xique" e "Mogi-Guaçu".
 */
function extrairUf(texto: string): { resto: string; uf: string | null } {
  const limpo = texto.replace(/\s+/g, ' ').trim();

  // ── barra: o lado direito é sempre candidato a UF ──
  const barra = limpo.lastIndexOf('/');
  if (barra > 0) {
    const dir = semAcento(limpo.slice(barra + 1));
    const esq = limpo.slice(0, barra).trim();
    if (dir.length === 2 && SIGLAS.has(dir.toUpperCase())) return { resto: esq, uf: dir.toUpperCase() };
    if (UF_POR_NOME[dir]) return { resto: esq, uf: UF_POR_NOME[dir] };
  }

  // ── nome do estado por extenso, nas últimas 1 a 4 palavras ──
  // ("Mato Grosso do Sul" tem 4; "Divinopolis Minas gerais" tem 2 no fim)
  const palavras = limpo.split(' ');
  for (let n = Math.min(4, palavras.length); n >= 1; n--) {
    const cauda = semAcento(palavras.slice(-n).join(' ')).replace(/^[-–—\s]+/, '');
    const uf = UF_POR_NOME[cauda];
    if (!uf) continue;
    const resto = palavras.slice(0, -n).join(' ').replace(/[-–—\s]+$/, '').trim();
    // "São Paulo" e "Rio de Janeiro" são cidade E estado com o mesmo nome:
    // tirar o estado esvazia a cidade. Nesse caso o texto inteiro é a cidade —
    // e a UF continua valendo, porque ela é a mesma.
    if (!resto) return { resto: limpo, uf };
    // O nome por extenso NÃO pode ter vindo colado num hífen ("Ji-Paraná").
    // Se o caractere logo antes da cauda é hífen sem espaço, não é UF.
    const antes = limpo.slice(0, limpo.length - palavras.slice(-n).join(' ').length);
    if (/[-–—]$/.test(antes)) continue;
    // Sobrou preposição no fim: o estado é parte do NOME da cidade, não um
    // sufixo. Devolve a string inteira e ABRE MÃO da UF — "Conceição do Pará"
    // fica em Minas, e herdar o "Pará" mandaria o lead a 2 mil km daqui.
    // Nome inteiro sem UF ainda resolve: o resolvedor casa por nome único.
    if (PREPOSICOES.has(semAcento(resto.split(' ').pop() || ''))) return { resto: limpo, uf: null };
    return { resto, uf };
  }

  // ── sigla de 2 letras no fim, depois de espaço ou hífen ──
  const sig = limpo.match(/^(.*?)[\s\-–—]+([A-Za-z]{2})$/);
  if (sig) {
    const uf = sig[2].toUpperCase();
    if (SIGLAS.has(uf)) return { resto: sig[1].replace(/[-–—\s]+$/, '').trim(), uf };
  }

  return { resto: limpo, uf: null };
}

/**
 * "Araguari-MG" → { cidade: 'Araguari', uf: 'MG' }
 * "Osasco"      → { cidade: 'Osasco',   uf: null }
 * "Porto seguro e Eunapolis/ BA" → { cidade: null, uf: 'BA', duasCidades: true }
 *
 * Devolver `cidade: null` é resposta legítima: quando há dois topônimos, escolher
 * o primeiro seria chute com cara de certeza.
 */
export function normalizarCidade(texto: string | null | undefined): CidadeParseada {
  const cru = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!cru) return { cidade: null, uf: null, duasCidades: false };

  // Vírgula, quando existe, separa cidade de UF ("Barueri,SP") — é raro no campo
  // `cidade`, mas é o formato de qualquer autocomplete que venha a existir.
  const semVirgula = cru.replace(/,/g, ' ');
  const { resto, uf } = extrairUf(semVirgula);

  // Dois topônimos: " e " no meio do que sobrou. A UF sobrevive; a cidade não.
  //
  // MAS existem municípios com " e " no PRÓPRIO nome — Abreu e Lima/PE,
  // Pontes e Lacerda/MT, Passa e Fica/RN. Tratar esses três como "duas cidades"
  // faria eles nunca resolverem, e o morador de Abreu e Lima jamais apareceria
  // num match. A lista é fechada e pequena: a checagem cabe aqui.
  const duasCidades = / e /i.test(resto) && !NOME_COM_E.has(semAcento(resto));
  if (duasCidades) return { cidade: null, uf, duasCidades: true };

  const cidade = resto.trim();
  return { cidade: cidade || null, uf, duasCidades: false };
}
