// ───────────────────────────────────────────────────────────────────────────
// CATÁLOGO DO FUNIL DO QUIZ MONJOUR (19/11/2026): telas, anúncios, países e os
// rótulos das respostas. Só dados e tipos; a conta mora em funilMonjourPuro.ts.
// O quiz vive no site do Monjour (fora deste repositório) e manda os eventos
// monjour_* ao beacon /_t/e, que os grava em lp_events.
// ───────────────────────────────────────────────────────────────────────────

export const TIPOS_EVENTO_MONJOUR = ['monjour_passo', 'monjour_resp', 'monjour_fim', 'monjour_app'] as const;

export const PERIODOS_MONJOUR = ['hoje', 'ontem', '7dias', '30dias', 'maximo'] as const;

/**
 * Etapa do quiz. `n` é a POSIÇÃO no catálogo (1, 2, 3...), calculada aqui: o n que o site manda
 * é só informação e nunca é lido. A etapa se reconhece pela `chave` (o passo que o Monjour manda).
 * `desde` (ISO UTC, opcional): a etapa só existe para sessões cujo primeiro evento é desta hora em diante.
 * Sessão mais antiga nunca viu a tela e não conta nela, nem em chegaram nem em saíram.
 * `ate` (ISO UTC, opcional) é o espelho: a tela saiu do quiz. Sessão cujo primeiro evento é igual ou posterior ao `ate`
 * nunca a vê e não conta nela. Nos dois casos a passagem da sessão pula para a etapa seguinte que existe para ela.
 */
export interface TelaMonjour { n: number; chave: string; rotulo: string; tipo: string; desde?: string; ate?: string }

/**
 * Quando o quiz novo (abertura e prévia do app) foi ao ar. Uma constante só, usada por toda etapa nova do
 * redesenho. AJUSTAR NA HORA DE PUBLICAR: sessões que entraram antes disso não contam nessas etapas.
 */
export const QUIZ_NOVO_DESDE = '2026-11-20T00:26:00Z';

/**
 * Quando entrou a segunda entrega do quiz: as afirmações af_ropa e af_lunes entram (`desde`) e hace e despues saem (`ate`).
 * AJUSTAR NA HORA DE PUBLICAR.
 */
export const QUIZ_BLOCO2_DESDE = '2026-11-20T02:45:00Z';

/** A ordem do funil. Etapa nova entra aqui, na posição certa (com `desde` se as sessões antigas não a viram): o resto se calcula. */
const TELAS_BASE: Omit<TelaMonjour, 'n'>[] = [
  { chave: 'inicio', rotulo: 'Abertura', tipo: 'info', desde: QUIZ_NOVO_DESDE },
  { chave: 'edad', rotulo: 'Idade', tipo: 'pergunta' },
  { chave: 'app', rotulo: 'Prévia do app', tipo: 'info', desde: QUIZ_NOVO_DESDE },
  { chave: 'objetivo', rotulo: 'Objetivo', tipo: 'pergunta' },
  { chave: 'cuerpo', rotulo: 'Corpo hoje', tipo: 'pergunta' },
  { chave: 'zona', rotulo: 'Onde acumula', tipo: 'pergunta' },
  { chave: 'hace', rotulo: 'Há quanto tempo', tipo: 'pergunta', ate: QUIZ_BLOCO2_DESDE },
  { chave: 'af_ropa', rotulo: 'Afirmação: roupa', tipo: 'afirmacao', desde: QUIZ_BLOCO2_DESDE },
  { chave: 'inyecciones', rotulo: 'Pensou em injeções', tipo: 'pergunta' },
  { chave: 'noticia', rotulo: 'Notícia', tipo: 'info' },
  { chave: 'probado', rotulo: 'O que já tentou', tipo: 'multipla' },
  { chave: 'despues', rotulo: 'O que aconteceu depois', tipo: 'pergunta', ate: QUIZ_BLOCO2_DESDE },
  { chave: 'af_lunes', rotulo: 'Afirmação: segunda-feira', tipo: 'afirmacao', desde: QUIZ_BLOCO2_DESDE },
  { chave: 'culpa', rotulo: 'Não é sua culpa', tipo: 'info' },
  { chave: 'antojo', rotulo: 'Hora do doce', tipo: 'pergunta' },
  { chave: 'desayuno', rotulo: 'Café da manhã', tipo: 'pergunta' },
  { chave: 'agua', rotulo: 'Água por dia', tipo: 'pergunta' },
  { chave: 'sueno', rotulo: 'Horas de sono', tipo: 'pergunta' },
  { chave: 'refresco', rotulo: 'Refrigerante', tipo: 'pergunta' },
  { chave: 'hinchada', rotulo: 'Barriga inchada', tipo: 'pergunta' },
  { chave: 'perfil', rotulo: 'Perfil de fome', tipo: 'info' },
  { chave: 'altura', rotulo: 'Altura', tipo: 'numero' },
  { chave: 'peso', rotulo: 'Peso', tipo: 'numero' },
  { chave: 'meta', rotulo: 'Peso meta', tipo: 'numero' },
  { chave: 'partida', rotulo: 'Ponto de partida', tipo: 'info' },
  { chave: 'evento', rotulo: 'Data especial', tipo: 'pergunta' },
  { chave: 'seguridad', rotulo: 'Segurança', tipo: 'multipla' },
  { chave: 'minutos', rotulo: 'Minutos por dia', tipo: 'pergunta' },
  { chave: 'compromiso', rotulo: 'Compromisso', tipo: 'pergunta' },
  { chave: 'nombre', rotulo: 'Nome', tipo: 'campo' },
  { chave: 'cargando', rotulo: 'Montando o plano', tipo: 'carregando' },
  { chave: 'correo', rotulo: 'E-mail', tipo: 'email' },
  { chave: 'oferta', rotulo: 'Oferta', tipo: 'oferta' },
];

export const TELAS_MONJOUR: TelaMonjour[] = TELAS_BASE.map((t, i) => ({ ...t, n: i + 1 }));

/** Posição de uma tela pela chave. */
const posicaoDe = (chave: string): number => {
  const t = TELAS_MONJOUR.find((x) => x.chave === chave);
  if (!t) throw new Error(`monjourCatalogo: tela ${chave} não existe`);
  return t.n;
};

/** A oferta fecha as telas; depois dela vêm o clique em comprar (destino checkout) e a compra. */
export const ETAPA_OFERTA = posicaoDe('oferta');
export const ETAPA_CHECKOUT = ETAPA_OFERTA + 1;
export const ETAPA_COMPRA = ETAPA_OFERTA + 2;
export const ETAPA_META = posicaoDe('meta');
export const ETAPA_PARTIDA = posicaoDe('partida');
export const MEDIANA_CORTE_SEG = 30 * 60;

/** Instante (ms) a partir do qual a etapa existe, ou null se existe desde sempre. */
export function desdeDaEtapa(n: number): number | null {
  const d = TELAS_MONJOUR[n - 1]?.desde;
  return d ? Date.parse(d) : null;
}

/** Instante (ms) em que a etapa saiu do quiz, ou null se ainda está lá. */
export function ateDaEtapa(n: number): number | null {
  const d = TELAS_MONJOUR[n - 1]?.ate;
  return d ? Date.parse(d) : null;
}

/** As duas etapas depois do quiz: clicou em comprar (destino checkout) e comprou. */
export const ETAPAS_DEPOIS: TelaMonjour[] = [
  { n: ETAPA_CHECKOUT, chave: 'checkout', rotulo: 'Clicou em comprar', tipo: 'checkout' },
  { n: ETAPA_COMPRA, chave: 'compra', rotulo: 'Comprou', tipo: 'compra' },
];

/**
 * Dois passos do quiz sem n: a pessoa foi direto à oferta sem passar pelas perguntas.
 * atalho_oferta: tocou em "¿Ya hiciste el test? Ver mi plan" na tela 1. volta_oferta: já tinha terminado o test
 * no mesmo aparelho e abriu direto na oferta. Sessão assim só conta nas telas que viu de verdade (veja chegouNaEtapa).
 */
export const PASSO_ATALHO = 'atalho_oferta';
export const PASSO_VOLTA = 'volta_oferta';
export const ROTULO_ATALHO = 'Atalho para a oferta';
export const ROTULO_VOLTA = 'Voltou direto para a oferta';

export const N_POR_CHAVE: Record<string, number> = Object.fromEntries(TELAS_MONJOUR.map((t) => [t.chave, t.n]));

// ── Anúncios (utm_content = id do anúncio; utm_campaign = monjour-abo3) ─────
export interface ConjuntoMonjour { id: string; nome: string }
export const CONJUNTOS_MONJOUR: ConjuntoMonjour[] = [
  { id: '120256011160400271', nome: 'CJ1 - Imagens' },
  { id: '120256011163980271', nome: 'CJ2 - Videos 1' },
  { id: '120256011166130271', nome: 'CJ3 - Videos 2' },
];
const [CJ1, CJ2, CJ3] = CONJUNTOS_MONJOUR.map((c) => c.id);

export const ANUNCIOS_MONJOUR: Record<string, { nome: string; conjunto: string }> = {
  '120256011166960271': { nome: 'IMG01 Dono 1 livro', conjunto: CJ1 },
  '120256011184030271': { nome: 'IMG02 Dono 2 tablet', conjunto: CJ1 },
  '120256011185610271': { nome: 'IMG03 Dono 3 celular', conjunto: CJ1 },
  '120256011187360271': { nome: 'IMG04 Dono 4 caro', conjunto: CJ1 },
  '120256011191360271': { nome: 'VID02', conjunto: CJ2 },
  '120256011193050271': { nome: 'VID03', conjunto: CJ2 },
  '120256011194920271': { nome: 'VID04 Canela y jengibre', conjunto: CJ2 },
  '120256011204950271': { nome: 'VID05', conjunto: CJ2 },
  '120256011196560271': { nome: 'VID22 De preto', conjunto: CJ3 },
  '120256011196910271': { nome: 'VID03', conjunto: CJ3 },
  '120256011197980271': { nome: 'VID44 Calça apertada', conjunto: CJ3 },
  '120256011205460271': { nome: 'VID11 jeans azul', conjunto: CJ3 },
};

/** Chave usada nos filtros e nas linhas para "sem utm_content". */
export const SEM_ANUNCIO = 'sem';
export const ROTULO_SEM_ANUNCIO = 'Sem anúncio (orgânico ou direto)';
/** Conjunto de um anúncio que não está na lista. */
export const CONJUNTO_DESCONHECIDO = 'desconhecido';

export function nomeDoAnuncio(id: string): string {
  if (!id || id === SEM_ANUNCIO) return ROTULO_SEM_ANUNCIO;
  return ANUNCIOS_MONJOUR[id]?.nome ?? `Anúncio ${id}`;
}

/** Id do conjunto do anúncio: 'sem' sem utm, 'desconhecido' com id fora da lista. */
export function conjuntoDoAnuncio(id: string): string {
  if (!id || id === SEM_ANUNCIO) return SEM_ANUNCIO;
  return ANUNCIOS_MONJOUR[id]?.conjunto ?? CONJUNTO_DESCONHECIDO;
}

export function nomeDoConjunto(id: string): string {
  if (id === SEM_ANUNCIO) return ROTULO_SEM_ANUNCIO;
  if (id === CONJUNTO_DESCONHECIDO) return 'Conjunto desconhecido';
  return CONJUNTOS_MONJOUR.find((c) => c.id === id)?.nome ?? `Conjunto ${id}`;
}

// ── Países, aparelhos, sistemas e navegadores ───────────────────────────────
export const PAISES: Record<string, string> = {
  MX: 'México', CO: 'Colômbia', AR: 'Argentina', PE: 'Peru', CL: 'Chile', EC: 'Equador',
  GT: 'Guatemala', BO: 'Bolívia', DO: 'República Dominicana', HN: 'Honduras', PY: 'Paraguai',
  SV: 'El Salvador', NI: 'Nicarágua', CR: 'Costa Rica', PA: 'Panamá', UY: 'Uruguai',
  PR: 'Porto Rico', GQ: 'Guiné Equatorial', US: 'Estados Unidos', ES: 'Espanha', BR: 'Brasil',
};
export const nomeDoPais = (codigo: string): string => PAISES[codigo] ?? codigo;

export const ROTULO_APARELHO: Record<string, string> = { movil: 'Celular', tablet: 'Tablet', escritorio: 'Computador' };
export const ROTULO_SISTEMA: Record<string, string> = {
  ios: 'iOS', android: 'Android', windows: 'Windows', mac: 'Mac', linux: 'Linux', otro: 'Outro',
};
export const ROTULO_NAVEGADOR: Record<string, string> = {
  chrome: 'Chrome', safari: 'Safari', samsung: 'Samsung Internet', firefox: 'Firefox',
  edge: 'Edge', instagram: 'Instagram', facebook: 'Facebook', otro: 'Outro',
};

// ── Respostas permitidas: pergunta no admin e opções (texto em espanhol do quiz) ──
export interface PerguntaMonjour { chave: string; pergunta: string; opcoes: [string, string][] }

export const PERGUNTAS_MONJOUR: PerguntaMonjour[] = [
  { chave: 'edad', pergunta: 'Idade', opcoes: [['25', '25-34 años'], ['35', '35-44 años'], ['45', '45-54 años'], ['55', '55 años o más'], ['18', 'Faixa antiga 18'], ['30', 'Faixa antiga 30'], ['40', 'Faixa antiga 40'], ['50', 'Faixa antiga 50']] },
  { chave: 'objetivo', pergunta: 'Objetivo', opcoes: [['peso', 'Bajar de peso'], ['barriga', 'Deshinchar la barriga'], ['ansiedad', 'Controlar la ansiedad por dulce'], ['energia', 'Tener más energía']] },
  { chave: 'cuerpo', pergunta: 'Corpo hoje', opcoes: [['delgada', 'Delgada'], ['mediana', 'Mediana'], ['curvas', 'Con curvas'], ['grande', 'Grande']] },
  { chave: 'zona', pergunta: 'Onde acumula', opcoes: [['barriga', 'La barriga'], ['caderas', 'Caderas y muslos'], ['brazos', 'Brazos y espalda'], ['todo', 'Todo por igual']] },
  { chave: 'hace', pergunta: 'Há quanto tempo', opcoes: [['menos1', 'Menos de 1 año'], ['1a3', 'De 1 a 3 años'], ['mas3', 'Más de 3 años'], ['norecuerdo', 'Ya ni recuerdo']] },
  { chave: 'inyecciones', pergunta: 'Pensou em injeções', opcoes: [['caras', 'Sí, pero son muy caras'], ['miedo', 'Sí, pero me dan miedo los efectos'], ['dejadas', 'Las usé y las dejé'], ['natural', 'No, prefiero algo natural']] },
  { chave: 'probado', pergunta: 'O que já tentou', opcoes: [['dietas', 'Dietas estrictas'], ['gimnasio', 'Gimnasio'], ['pastillas', 'Pastillas o tés "milagro"'], ['ayuno', 'Ayuno'], ['calorias', 'Contar calorías'], ['nada', 'Nada todavía']] },
  { chave: 'despues', pergunta: 'O que aconteceu depois', opcoes: [['rebote', 'Bajé y volví a subir'], ['sinresultado', 'No vi resultados'], ['hambre', 'Lo dejé porque pasaba hambre'], ['nunca', 'Nunca empecé de verdad']] },
  { chave: 'antojo', pergunta: 'Hora do doce', opcoes: [['manana', 'Por la mañana'], ['tarde', 'Por la tarde (3 a 6 pm)'], ['noche', 'Por la noche'], ['todo', 'Todo el día'], ['nunca', 'Casi nunca']] },
  { chave: 'desayuno', pergunta: 'Café da manhã', opcoes: [['pan', 'Pan y café con azúcar'], ['cafe', 'Solo café'], ['salto', 'Me lo salto'], ['fruta', 'Fruta'], ['proteina', 'Huevos o algo con proteína']] },
  { chave: 'agua', pergunta: 'Água por dia', opcoes: [['1', '1-2 vasos'], ['3', '3-4 vasos'], ['5', '5-6 vasos'], ['7', '7 o más']] },
  { chave: 'sueno', pergunta: 'Horas de sono', opcoes: [['4', 'Menos de 5 horas'], ['5', '5-6 horas'], ['7', '7-8 horas'], ['9', 'Más de 8 horas']] },
  { chave: 'refresco', pergunta: 'Refrigerante', opcoes: [['diario', 'Todos los días'], ['semana', 'Algunas veces por semana'], ['rara', 'Rara vez'], ['nunca', 'Nunca']] },
  { chave: 'hinchada', pergunta: 'Barriga inchada', opcoes: [['siempre', 'Casi siempre'], ['comer', 'Después de comer'], ['aveces', 'A veces'], ['nunca', 'Nunca']] },
  { chave: 'evento', pergunta: 'Data especial', opcoes: [['cumple', 'Cumpleaños'], ['boda', 'Boda'], ['vacaciones', 'Vacaciones'], ['fiestas', 'Fiestas de fin de año'], ['no', 'No, solo quiero empezar']] },
  { chave: 'minutos', pergunta: 'Minutos por dia', opcoes: [['5', '5 minutos'], ['10', '10 minutos'], ['15', '15 minutos']] },
  { chave: 'compromiso', pergunta: 'Compromisso', opcoes: [['si', 'Sí, me comprometo'], ['intentar', 'Quiero intentarlo']] },
  { chave: 'picar', pergunta: 'Picar entre as refeições', opcoes: [['si', 'Sí'], ['no', 'No']] },
  { chave: 'sabor', pergunta: 'Doce ou cítrico', opcoes: [['dulces', 'Dulces'], ['citricos', 'Cítricos']] },
  { chave: 'correo', pergunta: 'Aceite de e-mails', opcoes: [['consent_si', 'Sí, quiero recibir correos'], ['consent_no', 'No quiero correos']] },
  { chave: 'af_ropa', pergunta: 'Afirmação: roupa', opcoes: [['si', 'Sim'], ['no', 'Não'], ['nose', 'Não sei']] },
  { chave: 'af_lunes', pergunta: 'Afirmação: segunda-feira', opcoes: [['si', 'Sim'], ['no', 'Não'], ['nose', 'Não sei']] },
  { chave: 'oferta', pergunta: 'Plano escolhido na oferta', opcoes: [['basico', 'Básico'], ['plus', 'Plus']] },
];

/** Chave da resposta a partir do passo que o Monjour manda ("cargando_picar" vira "picar"). */
export function chaveDaResposta(passo: unknown): string | null {
  const p = String(passo ?? '').trim().toLowerCase().replace(/^cargando_/, '');
  return PERGUNTAS_MONJOUR.some((q) => q.chave === p) ? p : null;
}

// ── Tipos da resposta da API ────────────────────────────────────────────────
export interface LinhaMonjour {
  chave: string; rotulo: string; sessoes: number; leads: number; ofertas: number;
  checkouts: number; compras: number;
  /** Fração de 0 a 1 (compras / sessoes), até 4 casas. */
  conversao: number;
  receitaCentavos: number;
}

export interface OpcaoRespostaMonjour {
  valor: string; rotulo: string; sessoes: number;
  /** Percentual de 0 a 100 entre quem respondeu a pergunta, 1 casa. */
  pct: number;
  chegaramOferta: number; compras: number;
  /** Fração de 0 a 1 (compras / sessoes). */
  conversao: number;
}

export interface EtapaMonjour {
  n: number; chave: string; rotulo: string; tipo: string; chegaram: number;
  /** Percentuais de 0 a 100, 1 casa. pctInicio: chegaram / sessões do funil. pctSaida: sairam / chegaram. */
  pctInicio: number; sairam: number; pctSaida: number;
  medianaSegundos: number | null; pularam?: number;
  /** Só nas etapas com `desde` ou `ate`: a janela em que a tela existe no quiz (ISO UTC). */
  desde?: string; ate?: string;
  /** Só nessas etapas: quantas sessões do período a etapa existe para. Zero = o painel esconde o degrau. */
  aplicaveis?: number;
}

export interface FunilMonjour {
  periodo: string; desde: string; ate: string; atualizadoEm: string;
  inicioRastreio: string | null;
  truncado: boolean;
  filtros: {
    paises: { codigo: string; nome: string; sessoes: number }[];
    aparelhos: { chave: string; sessoes: number }[];
    /** `id` é o utm_content, ou 'sem' (sem anúncio). `conjunto` é o id do conjunto, 'desconhecido' ou 'sem'. */
    anuncios: { id: string; nome: string; conjunto: string; sessoes: number }[];
  };
  totais: {
    sessoes: number; leads: number; ofertas: number; checkouts: number; compras: number;
    comprasBasico: number; comprasPlus: number; upgrades: number; receitaCentavos: number;
    conversao: number; ticketMedioCentavos: number;
    /** Sessões com atalho_oferta e com volta_oferta (podem ser a mesma). Entram nas sessões e na oferta, não nas perguntas que não viram. */
    atalho: number; voltas: number;
  };
  etapas: EtapaMonjour[];
  saidas: { finSeguridad: number; partidaSemSaida: number };
  recortes: {
    pais: LinhaMonjour[]; aparelho: LinhaMonjour[]; sistema: LinhaMonjour[]; navegador: LinhaMonjour[];
    anuncio: LinhaMonjour[]; conjunto: LinhaMonjour[]; dia: LinhaMonjour[]; hora: LinhaMonjour[];
  };
  respostas: { chave: string; pergunta: string; opcoes: OpcaoRespostaMonjour[] }[];
  app: { abriram: number; instalaram: number; upgradeClicks: number };
}

export interface EventoMonjour {
  session_id: string;
  event_type: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}

export interface FiltrosMonjour {
  pais?: string | null; disp?: string | null; anuncio?: string | null; conjunto?: string | null;
}
