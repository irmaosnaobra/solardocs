// ── A SALA DE ESPERA DO CARD (APALAVRADO) ───────────────────────────────────
//
// Ordem do Thiago, 01/10/2026: "a etiqueta APALAVRADO não substitui a atual, ela
// é acrescentada; a etiqueta mantém pra conseguirmos identificar a negociação
// correta daquele cliente".
//
// Antes disso, apalavrar gravava `status = 'apalavrado'` e isso APAGAVA a
// classificação do funil — o mesmo erro que o reciclo já evitava no caminho de
// negociação ("forçar `agendado` apagaria a classificação do funil"). Os cinco
// cards apalavrados antes desta data perderam a etiqueta pra sempre: ela não
// ficou no histórico nem em coluna nenhuma, não dá pra recuperar.
//
// Agora quem manda é a MARCA `apalavrado:<id>` no `system_state`, que já existia
// — ela é quem guarda o texto e o prazo. O status fica com a etiqueta de
// negociação, e é a marca que tira a ficha da roda.
//
// ── POR QUE ESTE ARQUIVO EXISTE, EM VEZ DE UM `import` ENTRE OS DOIS ────────
//
// A primeira versão deixou `esperaAte` dentro do `eletropostoReagendaAuto` e o
// módulo do solar importava de lá. Compilou, e quebrou quatro arquivos de teste
// que não têm nada a ver com isto: importar o módulo do eletroposto arrasta o
// grafo dele inteiro (Z-API, teto de linha, agenda, vagas), e todo teste que
// carrega o solar passou a executar aquilo no load.
//
// A regra "as duas pontas têm que concordar" continua valendo — ela é o motivo
// de a conta ser UMA. O que não pode é um produto depender do outro pra isso.
// Daí um módulo neutro, sem dependência nenhuma.

/** A chave da marca no `system_state`. É a MESMA nos dois produtos de propósito:
 *  a sala de espera é do CARD, e o card é um só. */
export const APALAVRADO_PREFIX = 'apalavrado:';

/**
 * Até quando esta ficha está na sala de espera, ou `null` se não está.
 *
 * As duas bordas são decisões, não acidentes:
 *
 * · **Data ilegível não vira silêncio eterno.** Cai no padrão de 30 dias contados
 *   de quando foi marcada, que é a mesma régua que a tela já usava ("sem carimbo
 *   ele dorme o padrão"). Silenciar pra sempre por causa de um campo mal gravado
 *   é exatamente o cemitério que o APALAVRADO foi criado pra não ser.
 *
 * · **Marca sem data NENHUMA devolve `null`**, ou seja, a ficha continua rodando.
 *   Um carimbo quebrado não pode ser a razão de um cliente desaparecer. Entre
 *   "volta pra agenda sem precisar" e "nunca mais volta", o primeiro custa um
 *   horário e o segundo custa o cliente.
 */
export function esperaAte(valor: unknown): number | null {
  const v = (valor ?? {}) as { retomar_em?: string; em?: string };
  const data = Date.parse(String(v.retomar_em ?? ''));
  if (Number.isFinite(data)) return data;
  const marcada = Date.parse(String(v.em ?? ''));
  if (Number.isFinite(marcada)) return marcada + 30 * 86400_000;
  return null;
}

// ── A ETIQUETA QUE O STATUS TERMINAL APAGA (01/10/2026) ─────────────────────
//
// Ordem do Thiago: "o sem interesse poderia muito bem preservar a etiqueta, e
// quando colocar a etiqueta de SEM INTERESSE ficariam as 2, e no CRM o lead
// ficaria na SEM INTERESSE".
//
// O status terminal TEM que continuar sendo gravado: `sem_interesse`, `fechou`,
// `cancelado`, `perdido` e `fechou_concorrente` são lidos por nove lugares como
// "não fale mais com este card" (recepção, boas-vindas, semente, pares,
// respostas, os dois reciclos, CAPI, placar). Deixar de gravar faria robô
// conversar com cliente que já disse não.
//
// Então a etiqueta de negociação é GUARDADA antes de ser sobrescrita, e o card
// mostra as duas: "ARRENDAMENTO · SEM INTERESSE". A marca é só pra TELA — nenhum
// robô lê ela pra decidir nada, e é isso que mantém a mudança barata e segura.
//
// Medido em 01/10 antes de existir: 241 cards de eletroposto e 563 de solar já
// estavam em status terminal, e a etiqueta deles não está no histórico nem em
// coluna nenhuma. Esses não voltam; a memória começa daqui pra frente.

/** A marca da etiqueta preservada: `etiqueta_card:<id>` → { etiqueta, em, por }. */
export const ETIQUETA_PREFIX = 'etiqueta_card:';

/** As etiquetas que vale guardar. É allowlist de propósito: a marca é escrita por
 *  uma rota pública do dashboard, e sem a lista ela viraria um campo de texto
 *  livre dentro do `system_state`. */
export const ETIQUETAS_DE_NEGOCIO = new Set<string>([
  'arrendamento', 'carregador', 'meio_a_meio', 'chave_na_mao',
  // 01/10/2026. Sem os dois aqui, a rota RECUSA guardar a etiqueta deles e o
  // card marcado como sem interesse perde de que negócio se tratava.
  'cotista', 'integrador',
  'em_atendimento', 'proposta_apresentada', 'fez_orcamento', 'falando_whatsapp',
]);

/** Os status que APAGAM a etiqueta ao serem gravados. */
export const STATUS_TERMINAIS = new Set<string>([
  'sem_interesse', 'fechou', 'cancelado', 'perdido', 'fechou_concorrente',
]);


// ── O MOTIVO DO NÃO (02/10/2026) ────────────────────────────────────────────
//
// Esta é a opção B das três que eu medi e que o dono escolheu ("A agora, B em
// seguida"). Ela existe por causa de um número só:
//
//   589 reuniões de SOLAR já aconteceram. 498 delas estão em SEM INTERESSE: 85%.
//   Marcadas VENDIDO: 10, ou 1,7%.
//
// Ou seja, 498 cards param todos no mesmo lugar e nenhum deles diz POR QUE. Essa
// é a única informação que o funil do solar não tem, e nenhuma etiqueta de
// estágio novo a produz: `proposta_apresentada` já existe e tem ZERO uso no solar
// em toda a história, igual a `apalavrado`. Degrau novo de funil é o que a casa já
// tentou duas vezes, e o resultado está em zero.
//
// ── POR QUE MARCA, E NÃO COLUNA ────────────────────────────────────────────
//
// `agendamentos` TEM uma coluna `motivo_descarte`, e eu não uso ela de propósito:
// ela já tem dono. Quem escreve é um TRIGGER do banco, a partir da régua da LP do
// eletroposto (valores `fluxo_baixo`, `sem_capital`, `nao_decisor`), e 446 linhas
// já estão preenchidas. Gravar o motivo do consultor ali corromperia um sinal que
// existe e é lido pelo plugcash e pelo /admin.
//
// Coluna nova exigiria migration, e aqui toda migration bate em PRODUÇÃO (é um
// projeto Supabase só, sem staging). A marca no `system_state` é o mecanismo que
// esta casa já construiu pra exatamente isto: guardar um fato pequeno sobre um
// card sem mexer no esquema. É o mesmo caminho da etiqueta preservada.
//
// ── O VOCABULÁRIO É POR PRODUTO, E É CURTO DE PROPÓSITO ────────────────────
//
// Quatro motivos por produto, sem campo livre. Sem campo livre porque o ponto de
// B é CONTAR: "outro: ..." digitado à mão vira 498 textos diferentes e nenhuma
// conta. Quem precisa dizer mais escreve na nota, que já existe.
//
// Quatro e não oito porque a lição desta casa é que menu grande não é apertado:
// são 11 botões de status hoje e dois deles têm zero uso no solar.
//
// Os slugs `sem_capital` e `nao_decisor` são de propósito os MESMOS que o trigger
// já usa em `motivo_descarte`. Colunas diferentes, mesmo vocabulário: quem for
// cruzar os dois um dia não vai ter que traduzir.
export const MOTIVO_PREFIX = 'motivo_nao:';

/** Os motivos do SOLAR. */
export const MOTIVOS_SOLAR = new Set<string>([
  // Achou caro, não cabe no bolso, não fechou a conta pra ele.
  'preco',
  // Já comprou, ou fechou com outro integrador.
  'concorrente',
  // Quem atendeu não é quem decide (cônjuge, sócio, síndico).
  'nao_decisor',
  // Não serve: consumo baixo demais, telhado/imóvel que não dá, não é o dono.
  'sem_perfil',
]);

/** Os motivos do ELETROPOSTO. O ponto é o escasso aqui, não o capital: 217
 *  interessados com dinheiro contra 17 com local. Por isso `sem_ponto` vem
 *  primeiro na lista — é o que mais mata reunião deste lado. */
export const MOTIVOS_ELETROPOSTO = new Set<string>([
  'sem_ponto',
  'sem_capital',
  'achou_caro',
  'so_curiosidade',
]);

/** A allowlist que a rota usa. É a união, porque a rota é uma e o card é um:
 *  separar em duas rotas faria a tela ter que saber de qual produto ela é antes
 *  de gravar, e ela já erra isso de outras formas. Quem escolhe o vocabulário
 *  certo é a TELA, que mostra só os quatro do produto daquele card. */
export const MOTIVOS_DO_NAO = new Set<string>([...MOTIVOS_SOLAR, ...MOTIVOS_ELETROPOSTO]);

/** O motivo só faz sentido em card que disse não. Gravar motivo num card vivo
 *  seria guardar a razão de uma recusa que não houve. */
export const STATUS_QUE_ACEITAM_MOTIVO = new Set<string>([
  'sem_interesse', 'fechou_concorrente', 'perdido', 'cancelado',
]);

/** `true` quando a ficha está em paz AGORA. */
export function naSalaDeEspera(valor: unknown, agora: number): boolean {
  const ate = esperaAte(valor);
  return ate !== null && ate > agora;
}
