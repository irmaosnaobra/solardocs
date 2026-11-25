// ───────────────────────────────────────────────────────────────────────────
// CATÁLOGO DO FUNIL DO QUIZ DOMINA IA (24/11/2026): telas, anúncios, países e os
// rótulos das respostas. Só dados e tipos; a conta mora em funilDominaiaPuro.ts.
// O quiz vive no site da Domina IA (fora deste repositório: lib/funil.js e
// public/assets/telas.js) e manda os eventos dominaia_* ao beacon /_t/e, que os grava
// em lp_events com session_id "dm_<sid>".
// O site não tem as telas meta e partida, página de venda direta (passo 'venta') nem datas de corte do quiz:
// nada disso existe aqui, e as chaves que o painel espera (paginaVenta, saidas) saem zeradas.
// ───────────────────────────────────────────────────────────────────────────

export const TIPOS_EVENTO_DOMINAIA = ['dominaia_passo', 'dominaia_resp', 'dominaia_fim', 'dominaia_app'] as const;

export const PERIODOS_DOMINAIA = ['hoje', 'ontem', '7dias', '30dias', 'maximo'] as const;

/** Dia (AAAA-MM-DD, São Paulo) em que a campanha ligou. Antes disso é tráfego de teste: nenhum período lê além daqui. */
export const DOMINAIA_DESDE = '2026-11-24';

/**
 * Etapa do quiz. `n` é a POSIÇÃO no catálogo (1, 2, 3...), calculada aqui: o n que o site manda
 * é só informação e nunca é lido. A etapa se reconhece pela `chave` (o passo que o site manda).
 */
export interface TelaDominaia { n: number; chave: string; rotulo: string; tipo: string }

/** A ordem do funil, a mesma de TELAS em public/assets/telas.js do site (32 telas, todas no fluxo, nenhuma condicional). */
const TELAS_BASE: Omit<TelaDominaia, 'n'>[] = [
  { chave: 'inicio', rotulo: 'Abertura', tipo: 'pergunta' },
  { chave: 'edad', rotulo: 'Idade', tipo: 'pergunta' },
  { chave: 'espejo_ia', rotulo: 'Espelho: IA', tipo: 'info' },
  { chave: 'objetivo', rotulo: 'Objetivo', tipo: 'pergunta' },
  { chave: 'horas', rotulo: 'Horas em e-mails', tipo: 'pergunta' },
  { chave: 'ocupacion', rotulo: 'Ocupação', tipo: 'pergunta' },
  { chave: 'frena', rotulo: 'O que freia', tipo: 'multipla' },
  { chave: 'espejo_horas', rotulo: 'Espelho: horas', tipo: 'info' },
  { chave: 'siente', rotulo: 'O que sente', tipo: 'pergunta' },
  { chave: 'pais', rotulo: 'País', tipo: 'pergunta' },
  { chave: 'ahorrar', rotulo: 'Ganhar tempo', tipo: 'pergunta' },
  { chave: 'pedir', rotulo: 'Saber pedir', tipo: 'pergunta' },
  { chave: 'practica', rotulo: 'Aprender praticando', tipo: 'pergunta' },
  { chave: 'espejo_prompts', rotulo: 'Espelho: prompts', tipo: 'info' },
  { chave: 'nivel', rotulo: 'Nível com IA', tipo: 'pergunta' },
  { chave: 'frecuencia', rotulo: 'Frequência de uso', tipo: 'pergunta' },
  { chave: 'cursos', rotulo: 'Cursos largados', tipo: 'pergunta' },
  { chave: 'herramientas', rotulo: 'Ferramentas', tipo: 'multipla' },
  { chave: 'tema', rotulo: 'Tema de interesse', tipo: 'pergunta' },
  { chave: 'espejo_ocupacion', rotulo: 'Espelho: ocupação', tipo: 'info' },
  { chave: 'compromiso', rotulo: 'Compromisso', tipo: 'pergunta' },
  { chave: 'tareas', rotulo: 'Tarefas', tipo: 'multipla' },
  { chave: 'resumen', rotulo: 'Resumo', tipo: 'info' },
  { chave: 'nivel_barra', rotulo: 'Barra de nível', tipo: 'info' },
  { chave: 'horario', rotulo: 'Horário', tipo: 'pergunta' },
  { chave: 'tiempo', rotulo: 'Tempo por dia', tipo: 'pergunta' },
  { chave: 'empezar', rotulo: 'Quando começa', tipo: 'pergunta' },
  { chave: 'plan', rotulo: 'Plano 28 dias', tipo: 'info' },
  { chave: 'cargando', rotulo: 'Montando o plano', tipo: 'carregando' },
  { chave: 'correo', rotulo: 'E-mail', tipo: 'email' },
  { chave: 'resultado', rotulo: 'Resultado', tipo: 'info' },
  { chave: 'oferta', rotulo: 'Oferta', tipo: 'oferta' },
];

export const TELAS_DOMINAIA: TelaDominaia[] = TELAS_BASE.map((t, i) => ({ ...t, n: i + 1 }));

/** Posição de uma tela pela chave. */
const posicaoDe = (chave: string): number => {
  const t = TELAS_DOMINAIA.find((x) => x.chave === chave);
  if (!t) throw new Error(`dominaiaCatalogo: tela ${chave} não existe`);
  return t.n;
};

/** A oferta fecha as telas; depois dela vêm o clique em comprar (destino checkout) e a compra. */
export const ETAPA_OFERTA = posicaoDe('oferta');
export const ETAPA_CHECKOUT = ETAPA_OFERTA + 1;
export const ETAPA_COMPRA = ETAPA_OFERTA + 2;
export const MEDIANA_CORTE_SEG = 30 * 60;

/** As duas etapas depois do quiz: clicou em comprar (destino checkout) e comprou. */
export const ETAPAS_DEPOIS: TelaDominaia[] = [
  { n: ETAPA_CHECKOUT, chave: 'checkout', rotulo: 'Clicou em comprar', tipo: 'checkout' },
  { n: ETAPA_COMPRA, chave: 'compra', rotulo: 'Comprou', tipo: 'compra' },
];

/**
 * Dois passos do quiz sem n: a pessoa foi direto à oferta sem passar pelas perguntas.
 * atalho_oferta: abriu com ?atalho=1 (link antigo direto para a oferta). volta_oferta: já tinha terminado o test
 * no mesmo aparelho e abriu direto na oferta. O site da Domina IA manda os dois (quiz.js). Sessão assim só conta nas telas
 * que viu de verdade (veja chegouNaEtapa).
 */
export const PASSO_ATALHO = 'atalho_oferta';
export const PASSO_VOLTA = 'volta_oferta';
export const ROTULO_ATALHO = 'Atalho para a oferta';
export const ROTULO_VOLTA = 'Voltou direto para a oferta';

export const N_POR_CHAVE: Record<string, number> = Object.fromEntries(TELAS_DOMINAIA.map((t) => [t.chave, t.n]));

// ── Anúncios (campanha 120256102213010271; utm_content = id do anúncio, utm_term = id do conjunto) ──
export interface ConjuntoDominaia { id: string; nome: string }
export const CONJUNTOS_DOMINAIA: ConjuntoDominaia[] = [
  { id: '120256102215990271', nome: 'CJ1 - El jefe' },
  { id: '120256102294610271', nome: 'CJ2 - El proveedor' },
  { id: '120256114832120271', nome: 'CJ3 - Mateo y don Beto' },
];
const [CJ1, CJ2, CJ3] = CONJUNTOS_DOMINAIA.map((c) => c.id);

export const ANUNCIOS_DOMINAIA: Record<string, { nome: string; conjunto: string }> = {
  '120256102223900271': { nome: 'A - correo del jefe', conjunto: CJ1 },
  '120256103197580271': { nome: 'A3', conjunto: CJ1 },
  '120256102299300271': { nome: 'B - correos del proveedor', conjunto: CJ2 },
  '120256103204930271': { nome: 'B2', conjunto: CJ2 },
  '120256125677150271': { nome: 'V3 - la presentación', conjunto: CJ3 },
  '120256125680060271': { nome: 'V4 - cuánto cuesta', conjunto: CJ3 },
};

/** Chave usada nos filtros e nas linhas para "sem utm_content". */
export const SEM_ANUNCIO = 'sem';
export const ROTULO_SEM_ANUNCIO = 'Sem anúncio (orgânico ou direto)';
/** Conjunto de um anúncio que não está na lista. */
export const CONJUNTO_DESCONHECIDO = 'desconhecido';

export function nomeDoAnuncio(id: string): string {
  if (!id || id === SEM_ANUNCIO) return ROTULO_SEM_ANUNCIO;
  return ANUNCIOS_DOMINAIA[id]?.nome ?? `Anúncio ${id}`;
}

/**
 * Id do conjunto: 'sem' sem utm_content; o conjunto do anúncio se ele está na lista; anúncio fora da lista cai no utm_term
 * (id do conjunto) quando ele é de um conjunto conhecido; senão 'desconhecido'.
 */
export function conjuntoDoAnuncio(id: string, term = ''): string {
  if (!id || id === SEM_ANUNCIO) return SEM_ANUNCIO;
  const doAnuncio = ANUNCIOS_DOMINAIA[id]?.conjunto;
  if (doAnuncio) return doAnuncio;
  return CONJUNTOS_DOMINAIA.some((c) => c.id === term) ? term : CONJUNTO_DESCONHECIDO;
}

export function nomeDoConjunto(id: string): string {
  if (id === SEM_ANUNCIO) return ROTULO_SEM_ANUNCIO;
  if (id === CONJUNTO_DESCONHECIDO) return 'Conjunto desconhecido';
  return CONJUNTOS_DOMINAIA.find((c) => c.id === id)?.nome ?? `Conjunto ${id}`;
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
// Só as respostas que o site manda em dominaia_resp (RESP_OK em quiz.js). Nome e e-mail nunca saem do site.
export interface PerguntaDominaia { chave: string; pergunta: string; opcoes: [string, string][] }

export const PERGUNTAS_DOMINAIA: PerguntaDominaia[] = [
  { chave: 'genero', pergunta: 'Gênero', opcoes: [['h', 'Hombre'], ['m', 'Mujer'], ['x', 'Prefiero no decirlo']] },
  { chave: 'edad', pergunta: 'Idade', opcoes: [['18', '18 a 24'], ['25', '25 a 34'], ['35', '35 a 44'], ['45', '45 o más']] },
  { chave: 'objetivo', pergunta: 'Objetivo', opcoes: [['trabajo', 'Mejorar en mi trabajo'], ['negocio', 'Hacer crecer mi negocio propio'], ['estudios', 'Estudiar y aprender mejor'], ['diario', 'Resolver cosas de mi día a día']] },
  { chave: 'horas', pergunta: 'Horas em e-mails', opcoes: [['m2', 'Menos de 2 horas'], ['2a5', 'De 2 a 5 horas'], ['5a10', 'De 5 a 10 horas'], ['m10', 'Más de 10 horas']] },
  { chave: 'ocupacion', pergunta: 'Ocupação', opcoes: [['empresa', 'Trabajo en una empresa'], ['independiente', 'Soy independiente'], ['negocio', 'Tengo mi propio negocio'], ['estudio', 'Estudio'], ['busco', 'Busco trabajo'], ['otra', 'Otra situación (hogar, jubilación u otra)']] },
  { chave: 'frena', pergunta: 'O que freia', opcoes: [['empezar', 'No sé por dónde empezar'], ['pedir', 'No sé qué pedirle'], ['error', 'Me da miedo equivocarme'], ['tiempo', 'No tengo tiempo'], ['muchas', 'Hay demasiadas herramientas'], ['resultados', 'Los resultados no me convencen'], ['nada', 'Nada me frena, solo falta ordenarme']] },
  { chave: 'siente', pergunta: 'O que sente', opcoes: [['curiosidad', 'Curiosidad'], ['ganas', 'Ganas, pero no sé por dónde empezar'], ['miedo', 'Miedo a quedarme atrás'], ['desconfianza', 'Desconfianza']] },
  { chave: 'pais', pergunta: 'País', opcoes: [['mx', 'México'], ['co', 'Colombia'], ['pe', 'Perú'], ['cl', 'Chile'], ['ec', 'Ecuador'], ['gt', 'Guatemala'], ['do', 'República Dominicana'], ['bo', 'Bolivia'], ['py', 'Paraguay'], ['hn', 'Honduras'], ['sv', 'El Salvador'], ['cr', 'Costa Rica'], ['pa', 'Panamá'], ['uy', 'Uruguay'], ['otro', 'Otro país']] },
  { chave: 'ahorrar', pergunta: 'Ganhar tempo', opcoes: [['si', 'Sí, quiero'], ['no', 'Todavía no']] },
  { chave: 'pedir', pergunta: 'Saber pedir', opcoes: [['siempre', 'Casi siempre'], ['aveces', 'A veces'], ['casinunca', 'Casi nunca'], ['nose', 'No sé']] },
  { chave: 'practica', pergunta: 'Aprender praticando', opcoes: [['si', 'Sí, prefiero practicar'], ['igual', 'Me da igual']] },
  { chave: 'nivel', pergunta: 'Nível com IA', opcoes: [['cero', 'Parto de cero'], ['basico', 'Sé lo básico'], ['defiendo', 'Me defiendo, pero quiero más'], ['bastante', 'Ya la uso bastante']] },
  { chave: 'frecuencia', pergunta: 'Frequência de uso', opcoes: [['nunca', 'Nunca'], ['probe', 'Alguna vez la probé'], ['mes', 'Algunas veces al mes'], ['semana', 'Varias veces por semana'], ['diario', 'Todos los días']] },
  { chave: 'cursos', pergunta: 'Cursos largados', opcoes: [['varios', 'Sí, varios'], ['alguno', 'Alguno'], ['termino', 'No, termino lo que empiezo']] },
  { chave: 'herramientas', pergunta: 'Ferramentas', opcoes: [['ninguna', 'Ninguna todavía'], ['chatgpt', 'ChatGPT'], ['gemini', 'Gemini'], ['claude', 'Claude'], ['copilot', 'Copilot'], ['perplexity', 'Perplexity'], ['canva', 'Canva'], ['otra', 'Otra']] },
  { chave: 'tema', pergunta: 'Tema de interesse', opcoes: [['escribir', 'Escribir y buscar información'], ['imagenes', 'Imágenes y presentaciones'], ['organizar', 'Organizar y crear plantillas'], ['todo', 'Todo, quiero verlo completo']] },
  { chave: 'compromiso', pergunta: 'Compromisso', opcoes: [['si', 'Sí, me comprometo'], ['intento', 'Lo voy a intentar']] },
  { chave: 'tareas', pergunta: 'Tarefas', opcoes: [['correos', 'Escribir correos y mensajes'], ['resumir', 'Buscar y resumir información'], ['imagenes', 'Crear imágenes'], ['presentaciones', 'Armar presentaciones'], ['semana', 'Organizar mi semana'], ['plantillas', 'Organizar y crear plantillas para tareas repetidas'], ['estudiar', 'Estudiar y hacer resúmenes'], ['proyecto', 'Preparar un proyecto propio']] },
  { chave: 'horario', pergunta: 'Horário', opcoes: [['manana', 'En la mañana'], ['mediodia', 'Al mediodía'], ['tarde', 'En la tarde'], ['noche', 'En la noche'], ['cambia', 'Cambia cada día']] },
  { chave: 'tiempo', pergunta: 'Tempo por dia', opcoes: [['menos15', 'Menos de 15 minutos'], ['15', '15 minutos'], ['15a30', 'Entre 15 y 30 minutos'], ['mas30', 'Más de 30 minutos']] },
  { chave: 'empezar', pergunta: 'Quando começa', opcoes: [['hoy', 'Hoy'], ['manana', 'Mañana'], ['semana', 'Esta semana']] },
  { chave: 'cuenta', pergunta: 'Conta no ChatGPT ou Gemini', opcoes: [['no', 'Todavía no'], ['si', 'Sí']] },
  { chave: 'hoy15', pergunta: '15 minutos hoje', opcoes: [['no', 'Hoy no'], ['si', 'Sí']] },
  { chave: 'correo', pergunta: 'Aceite de e-mails', opcoes: [['consent_si', 'Sí, quiero recibir correos'], ['consent_no', 'No quiero correos']] },
]

/** Chave da resposta a partir do passo que o site manda (a tela de gênero manda 'genero'; cuenta e hoy15 são perguntas dentro da tela cargando). */
export function chaveDaResposta(passo: unknown): string | null {
  const p = String(passo ?? '').trim().toLowerCase();
  return PERGUNTAS_DOMINAIA.some((q) => q.chave === p) ? p : null;
}

// ── App: as ações que o site emite em dominaia_app (ACOES_APP em lib/funil.js) ──
export const ACOES_APP_DOMINAIA = ['abriu', 'aba', 'dia_visto', 'leccion_vista', 'prompt_copiado', 'ejercicio_hecho', 'leccion_hecha', 'instalou'] as const;

export interface AppDominaia {
  abriram: number; instalaram: number; upgradeClicks: number;
  /** Sessões distintas por ação, todas as ações do app (0 para a que ninguém fez). */
  acoes: Record<string, number>;
}

/** Contagens do app zeradas: o formato do contrato, sem ninguém. */
export const appVazio = (): AppDominaia => ({
  abriram: 0, instalaram: 0, upgradeClicks: 0, acoes: Object.fromEntries(ACOES_APP_DOMINAIA.map((a) => [a, 0])),
});

// ── Tipos da resposta da API ────────────────────────────────────────────────
export interface LinhaDominaia {
  chave: string; rotulo: string; sessoes: number; leads: number; ofertas: number;
  checkouts: number; compras: number;
  /** Fração de 0 a 1 (compras / sessoes), até 4 casas. */
  conversao: number;
  receitaCentavos: number;
}

export interface OpcaoRespostaDominaia {
  valor: string; rotulo: string; sessoes: number;
  /** Percentual de 0 a 100 entre quem respondeu a pergunta, 1 casa. */
  pct: number;
  chegaramOferta: number; compras: number;
  /** Fração de 0 a 1 (compras / sessoes). */
  conversao: number;
}

export interface EtapaDominaia {
  n: number; chave: string; rotulo: string; tipo: string; chegaram: number;
  /** Percentuais de 0 a 100, 1 casa. pctInicio: chegaram / sessões do funil. pctSaida: sairam / chegaram. */
  pctInicio: number; sairam: number; pctSaida: number;
  medianaSegundos: number | null;
}

export interface FunilDominaia {
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
  etapas: EtapaDominaia[];
  /** Saídas especiais (tela de segurança e ponto de partida): o quiz da Domina IA não tem, sempre 0. Chave mantida para o painel. */
  saidas: { finSeguridad: number; partidaSemSaida: number };
  recortes: {
    pais: LinhaDominaia[]; aparelho: LinhaDominaia[]; sistema: LinhaDominaia[]; navegador: LinhaDominaia[];
    anuncio: LinhaDominaia[]; conjunto: LinhaDominaia[]; dia: LinhaDominaia[]; hora: LinhaDominaia[];
  };
  respostas: { chave: string; pergunta: string; opcoes: OpcaoRespostaDominaia[] }[];
  /**
   * Sessões distintas que fizeram cada ação do app. abriram e instalaram são as ações abriu e instalou; upgradeClicks fica
   * sempre em 0 (o app da Domina IA não tem upgrade). `acoes` traz TODAS as ações que o site emite, com 0 para a que ninguém fez.
   */
  app: AppDominaia;
  /**
   * A Domina IA não tem página de venda direta: o bloco existe só para o contrato do painel e vem sempre zerado
   * (contadores em 0, `secoes` e `cliques` vazios).
   */
  paginaVenta: {
    visitas: number; planes: number; compra: number; checkouts: number; compras: number;
    secoes: { codigo: string; nome: string; sessoes: number }[];
    cliques: { codigo: string; nome: string; sessoes: number; total: number }[];
  };
}

export interface EventoDominaia {
  session_id: string;
  event_type: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}

export interface FiltrosDominaia {
  pais?: string | null; disp?: string | null; anuncio?: string | null; conjunto?: string | null;
}
