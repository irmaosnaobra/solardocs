// ───────────────────────────────────────────────────────────────────────────
// CATÁLOGO DO FUNIL DO QUIZ MONJOUR (19/11/2026): telas, anúncios, países e os
// rótulos das respostas. Só dados e tipos; a conta mora em funilMonjourPuro.ts.
// O quiz vive no site do Monjour (fora deste repositório) e manda os eventos
// monjour_* ao beacon /_t/e, que os grava em lp_events.
// ───────────────────────────────────────────────────────────────────────────

export const TIPOS_EVENTO_MONJOUR = ['monjour_passo', 'monjour_resp', 'monjour_fim', 'monjour_app'] as const;

export const PERIODOS_MONJOUR = ['hoje', 'ontem', '7dias', '30dias', 'maximo'] as const;

/** Tela do quiz: ordem de 1 a 30, a chave que o Monjour manda e o rótulo no admin. */
export interface TelaMonjour { n: number; chave: string; rotulo: string; tipo: string }

export const TELAS_MONJOUR: TelaMonjour[] = [
  { n: 1, chave: 'edad', rotulo: 'Idade', tipo: 'pergunta' },
  { n: 2, chave: 'objetivo', rotulo: 'Objetivo', tipo: 'pergunta' },
  { n: 3, chave: 'cuerpo', rotulo: 'Corpo hoje', tipo: 'pergunta' },
  { n: 4, chave: 'zona', rotulo: 'Onde acumula', tipo: 'pergunta' },
  { n: 5, chave: 'hace', rotulo: 'Há quanto tempo', tipo: 'pergunta' },
  { n: 6, chave: 'inyecciones', rotulo: 'Pensou em injeções', tipo: 'pergunta' },
  { n: 7, chave: 'noticia', rotulo: 'Notícia', tipo: 'info' },
  { n: 8, chave: 'probado', rotulo: 'O que já tentou', tipo: 'multipla' },
  { n: 9, chave: 'despues', rotulo: 'O que aconteceu depois', tipo: 'pergunta' },
  { n: 10, chave: 'culpa', rotulo: 'Não é sua culpa', tipo: 'info' },
  { n: 11, chave: 'antojo', rotulo: 'Hora do doce', tipo: 'pergunta' },
  { n: 12, chave: 'desayuno', rotulo: 'Café da manhã', tipo: 'pergunta' },
  { n: 13, chave: 'agua', rotulo: 'Água por dia', tipo: 'pergunta' },
  { n: 14, chave: 'sueno', rotulo: 'Horas de sono', tipo: 'pergunta' },
  { n: 15, chave: 'refresco', rotulo: 'Refrigerante', tipo: 'pergunta' },
  { n: 16, chave: 'hinchada', rotulo: 'Barriga inchada', tipo: 'pergunta' },
  { n: 17, chave: 'perfil', rotulo: 'Perfil de fome', tipo: 'info' },
  { n: 18, chave: 'altura', rotulo: 'Altura', tipo: 'numero' },
  { n: 19, chave: 'peso', rotulo: 'Peso', tipo: 'numero' },
  { n: 20, chave: 'meta', rotulo: 'Peso meta', tipo: 'numero' },
  { n: 21, chave: 'partida', rotulo: 'Ponto de partida', tipo: 'info' },
  { n: 22, chave: 'evento', rotulo: 'Data especial', tipo: 'pergunta' },
  { n: 23, chave: 'seguridad', rotulo: 'Segurança', tipo: 'multipla' },
  { n: 24, chave: 'minutos', rotulo: 'Minutos por dia', tipo: 'pergunta' },
  { n: 25, chave: 'compromiso', rotulo: 'Compromisso', tipo: 'pergunta' },
  { n: 26, chave: 'historias', rotulo: 'Histórias', tipo: 'info' },
  { n: 27, chave: 'nombre', rotulo: 'Nome', tipo: 'campo' },
  { n: 28, chave: 'cargando', rotulo: 'Montando o plano', tipo: 'carregando' },
  { n: 29, chave: 'correo', rotulo: 'E-mail', tipo: 'email' },
  { n: 30, chave: 'oferta', rotulo: 'Oferta', tipo: 'oferta' },
];

/** As duas etapas depois do quiz: clicou em comprar (destino checkout) e comprou. */
export const ETAPA_CHECKOUT = 31;
export const ETAPA_COMPRA = 32;
export const ETAPA_OFERTA = 30;
export const ETAPA_META = 20;
export const ETAPA_PARTIDA = 21;
export const MEDIANA_CORTE_SEG = 30 * 60;

export const ETAPAS_DEPOIS: TelaMonjour[] = [
  { n: ETAPA_CHECKOUT, chave: 'checkout', rotulo: 'Clicou em comprar', tipo: 'checkout' },
  { n: ETAPA_COMPRA, chave: 'compra', rotulo: 'Comprou', tipo: 'compra' },
];

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
