// ───────────────────────────────────────────────────────────────────────────
// FUNIL DO QUIZ DA LP DO ELETROPOSTO — em que pergunta a pessoa desiste.
//
// Até 22/09/2026 o quiz de /io/eletroposto só falava com o Pixel da Meta, e a
// única coisa que se sabia era a ponta: ~15% das visitas viravam reunião, ficha
// ou cadastro. Desde então a página grava em lp_events (banco do SolarDoc), na
// mesma sessão da visita:
//   quiz_passo  a primeira vez que cada pergunta aparece
//   quiz_erro   o aviso que travou o Continuar
//   quiz_fim    onde a pessoa terminou
// Todos levam o CAMINHO naquele instante e a ordem do clique (pl + seq): o
// created_at é a ordem de CHEGADA no banco, e os envios correm em paralelo.
//
// "Parou aqui" não é evento, é conta: a última pergunta vista de quem não tem
// fim. Os ids das perguntas são os mesmos do array PASSOS da página; se um passo
// mudar de nome lá, ele some daqui sem erro nenhum — por isso o teste confere a
// lista contra o HTML.
// ───────────────────────────────────────────────────────────────────────────

/** O dia em que a página começou a gravar as perguntas. Antes disso o quiz não conta. */
export const MEDINDO_DESDE = '2026-09-22';
/**
 * O começo da campanha do eletroposto na Meta ("Eletroposto - ABO — 21/07/26").
 * É onde começa o "Desde o início" do painel: visita, reunião, cadastro e gasto
 * por conjunto existem desde lá; só "onde mais para no quiz" começa em 22/09.
 */
export const CAMPANHA_DESDE = '2026-07-21';

/** O texto de cada pergunta, como a pessoa vê. */
export const PERGUNTAS: Record<string, string> = {
  'p-porta':       'O que você é?',
  'p-cap-local':   'E o local, você já tem?',
  'p-inv-valor':   'Quanto você pensa em investir?',
  'p-horario':     'Escolha o melhor horário',
  'p-nome':        'Como podemos te chamar?',
  'p-cidade':      'Qual é a sua cidade?',
  'p-i-empresa':   'Qual é a sua empresa?',
  'p-i-atuacao':   'O que você faz hoje?',
  'p-i-exp':       'Já instalou carregador?',
  'p-i-interesse': 'Como quer trabalhar com eletroposto?',
  'p-i-equipe':    'Como é a sua equipe hoje?',
  'p-perfil':      'Qual é o seu perfil?',
  'p-ponto':       'Como está o seu ponto hoje?',
  'p-vagas':       'Quantas vagas estão disponíveis?',
  'p-modelo':      'Qual modelo te interessa?',
  'p-invest':      'Como pretende investir?',
  'p-valor':       'Qual valor você pretende investir?',
  'p-decisor':     'Quem decide o investimento?',
  'p-whatsapp':    'Para onde mandamos a confirmação? (WhatsApp)',
};

/** O mesmo, curto, para o eixo do gráfico (cabe no celular). */
export const CURTAS: Record<string, string> = {
  'p-porta': 'O que você é', 'p-cap-local': 'Tem local?', 'p-inv-valor': 'Quanto investe',
  'p-horario': 'Horário', 'p-nome': 'Nome', 'p-cidade': 'Cidade',
  'p-i-empresa': 'Empresa', 'p-i-atuacao': 'O que faz hoje', 'p-i-exp': 'Já instalou?',
  'p-i-interesse': 'Como quer trabalhar', 'p-i-equipe': 'Equipe',
  'p-perfil': 'Perfil', 'p-ponto': 'Ponto e endereço', 'p-vagas': 'Vagas',
  'p-modelo': 'Modelo', 'p-invest': 'Como investe', 'p-valor': 'Quanto investe',
  'p-decisor': 'Quem decide', 'p-whatsapp': 'WhatsApp',
};

const TRILHA_AGENDA = [
  'p-horario', 'p-nome', 'p-cidade', 'p-perfil', 'p-ponto', 'p-vagas',
  'p-modelo', 'p-invest', 'p-valor', 'p-decisor', 'p-whatsapp',
];

export interface Caminho { id: string; nome: string; passos: string[] }

/**
 * Os caminhos, na ordem em que a página mostra as perguntas. Vagas, "como
 * investe" e "quanto" não aparecem para todo mundo: quem pula uma delas vai
 * direto para a seguinte, e por isso o painel lê "parou aqui", não "chegou".
 */
export const CAMINHOS: Caminho[] = [
  { id: 'inicio',               nome: 'Não escolheu uma porta',               passos: ['p-porta'] },
  { id: 'comercio',             nome: 'Dono de comércio',                     passos: ['p-porta', ...TRILHA_AGENDA] },
  { id: 'investidor',           nome: 'Investidor (não disse se tem local)',  passos: ['p-porta', 'p-cap-local'] },
  { id: 'investidor_local',     nome: 'Investidor com local',                 passos: ['p-porta', 'p-cap-local', ...TRILHA_AGENDA] },
  { id: 'investidor_sem_local', nome: 'Investidor sem local',                 passos: ['p-porta', 'p-cap-local', 'p-inv-valor', 'p-nome', 'p-cidade', 'p-whatsapp'] },
  { id: 'integrador',           nome: 'Integrador',                           passos: ['p-porta', 'p-nome', 'p-cidade', 'p-i-empresa', 'p-i-atuacao', 'p-i-exp', 'p-i-interesse', 'p-i-equipe', 'p-whatsapp'] },
];

export const DESTINOS: Record<string, string> = {
  reuniao:      'Reunião marcada',
  arrendamento: 'Arrendamento',
  investidor:   'Investidores',
  curioso:      'Curioso',
  parceiro:     'Parceiros (integrador)',
  curso:        'Curso /ponto-certo',
};

export interface EventoQuiz {
  session_id: string;
  event_type: string;
  event_data: Record<string, unknown> | null;
  created_at: string;
}
export interface VisitaQuiz {
  session_id: string | null;
  landing_url: string | null;
  utm_campaign?: string | null;
  /** Nos anúncios do eletroposto o utm_term é o ID do CONJUNTO ({{adset.id}}) e o
   *  utm_content é o do anúncio. Conferido na Meta em 22/09/2026. */
  utm_term?: string | null;
}

export interface PassoDoFunil {
  id: string;
  pergunta: string;
  curta: string;
  chegaram: number;
  pararam: number;
  erros: { msg: string; sessoes: number }[];
}
export interface CaminhoDoFunil {
  id: string;
  nome: string;
  sessoes: number;
  terminaram: number;
  destinos: Record<string, number>;
  passos: PassoDoFunil[];
}
export interface FunilQuiz {
  medindo_desde: string;
  visitas: number;
  abriram: number;
  escolheram_porta: number;
  terminaram: number;
  destinos: Record<string, number>;
  caminhos: CaminhoDoFunil[];
  campanhas: { campanha: string; visitas: number; abriram: number; terminaram: number; reunioes: number }[];
  /** O mesmo funil, resumido por conjunto de anúncios (sem o filtro de conjunto). */
  conjuntos: QuizDoConjunto[];
  /** Quando o funil de cima foi filtrado por um conjunto, qual. */
  conjunto: string | null;
}
export interface QuizDoConjunto {
  id: string;
  visitas: number;
  abriram: number;
  terminaram: number;
  pior: { passo: string; pergunta: string; pararam: number } | null;
}

/** Visita sem utm_term: orgânico, link direto ou anúncio sem o parâmetro. */
export const SEM_CONJUNTO = '(sem)';

/** A visita é da LP (quiz ou página inteira), não das páginas-filhas. */
export function ehVisitaDaLp(url: string | null): boolean {
  const u = String(url || '');
  return /\/io\/eletroposto(?:[/?#]|$)/.test(u) && !/\/io\/eletroposto\/(parceria|material)/.test(u);
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');

interface Sessao {
  caminho: string;
  ordemCaminho: number[];
  ultimoPasso: string;
  ordemPasso: number[];
  passos: Set<string>;
  fim: string;
  erros: Map<string, Set<string>>;
}

/** Ordem do clique: carregamento da página, depois o contador dentro dele. */
function ordemDe(e: EventoQuiz): number[] {
  const d = e.event_data || {};
  return [num(d.pl) || Date.parse(e.created_at) || 0, num(d.seq)];
}
const depois = (a: number[], b: number[]) => a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]);

/**
 * A conta inteira. Pura: recebe o que o banco devolveu e não lê nada.
 * Com `conjunto`, o funil de cima (ponta, caminhos, campanhas) fica só com as
 * sessões daquele conjunto; o resumo `conjuntos` continua com todos.
 */
export function montarFunil(eventos: EventoQuiz[], visitas: VisitaQuiz[], opcoes: { conjunto?: string | null } = {}): FunilQuiz {
  const sessoes = new Map<string, Sessao>();
  const pegar = (id: string): Sessao => {
    let s = sessoes.get(id);
    if (!s) {
      s = { caminho: 'inicio', ordemCaminho: [-1, -1], ultimoPasso: '', ordemPasso: [-1, -1],
            passos: new Set(), fim: '', erros: new Map() };
      sessoes.set(id, s);
    }
    return s;
  };

  for (const e of eventos) {
    if (!e.session_id) continue;
    const d = e.event_data || {};
    if (txt(d.lp) && txt(d.lp) !== 'eletroposto') continue;
    const s = pegar(e.session_id);
    const ordem = ordemDe(e);
    const caminho = txt(d.caminho);
    if (caminho && depois(ordem, s.ordemCaminho)) { s.caminho = caminho; s.ordemCaminho = ordem; }

    if (e.event_type === 'quiz_passo') {
      const passo = txt(d.passo);
      if (!passo) continue;
      s.passos.add(passo);
      if (depois(ordem, s.ordemPasso)) { s.ultimoPasso = passo; s.ordemPasso = ordem; }
    } else if (e.event_type === 'quiz_erro') {
      const passo = txt(d.passo);
      const msg = txt(d.msg);
      if (!passo || !msg) continue;
      if (!s.erros.has(passo)) s.erros.set(passo, new Set());
      s.erros.get(passo)!.add(msg);
    } else if (e.event_type === 'quiz_fim') {
      const destino = txt(d.destino);
      if (destino) s.fim = destino;
    }
  }

  // A visita de cada sessão: campanha e conjunto (a primeira linha que tiver
  // UTM ganha de uma sem). Sem visita medida a sessão fica fora do recorte por
  // conjunto, mas continua no funil quando não há filtro.
  const campanhaDa = new Map<string, string>();
  const conjuntoDa = new Map<string, string>();
  for (const v of visitas) {
    if (!v.session_id || !ehVisitaDaLp(v.landing_url)) continue;
    const id = v.session_id;
    if (!campanhaDa.has(id) || (!campanhaDa.get(id) && v.utm_campaign)) campanhaDa.set(id, v.utm_campaign || '');
    const conj = txt(v.utm_term).trim();
    if (!conjuntoDa.has(id) || (conjuntoDa.get(id) === SEM_CONJUNTO && conj)) conjuntoDa.set(id, conj || SEM_CONJUNTO);
  }

  // Só conta como "abriu" quem viu alguma pergunta. Sessão que só mandou erro
  // ou fim (página velha em cache, por exemplo) não entra no funil.
  const filtro = opcoes.conjunto || null;
  const noRecorte = (id: string) => !filtro || conjuntoDa.get(id) === filtro;
  const noQuiz = [...sessoes.entries()].filter(([id, s]) => s.passos.size > 0 && noRecorte(id));

  const destinos: Record<string, number> = {};
  for (const [, s] of noQuiz) if (s.fim) destinos[s.fim] = (destinos[s.fim] || 0) + 1;

  const caminhos: CaminhoDoFunil[] = CAMINHOS.map((c) => {
    const delas = noQuiz.filter(([, s]) => s.caminho === c.id).map(([, s]) => s);
    const dest: Record<string, number> = {};
    for (const s of delas) if (s.fim) dest[s.fim] = (dest[s.fim] || 0) + 1;
    return {
      id: c.id,
      nome: c.nome,
      sessoes: delas.length,
      terminaram: delas.filter((s) => s.fim).length,
      destinos: dest,
      passos: c.passos.map((p) => {
        const erros = new Map<string, number>();
        for (const s of delas) for (const m of s.erros.get(p) || []) erros.set(m, (erros.get(m) || 0) + 1);
        return {
          id: p,
          pergunta: PERGUNTAS[p] || p,
          curta: CURTAS[p] || p,
          chegaram: delas.filter((s) => s.passos.has(p)).length,
          pararam: delas.filter((s) => !s.fim && s.ultimoPasso === p).length,
          erros: [...erros.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([msg, n]) => ({ msg, sessoes: n })),
        };
      }),
    };
  });

  const porCampanha = new Map<string, { visitas: number; abriram: number; terminaram: number; reunioes: number }>();
  for (const [id, camp] of campanhaDa) {
    if (!noRecorte(id)) continue;
    const k = camp || '(sem campanha)';
    const linha = porCampanha.get(k) || { visitas: 0, abriram: 0, terminaram: 0, reunioes: 0 };
    linha.visitas++;
    const s = sessoes.get(id);
    if (s && s.passos.size > 0) {
      linha.abriram++;
      if (s.fim) linha.terminaram++;
      if (s.fim === 'reuniao') linha.reunioes++;
    }
    porCampanha.set(k, linha);
  }

  // Resumo por conjunto, sempre com todos: é a tabela que escolhe o filtro.
  const porConjunto = new Map<string, { visitas: number; abriram: number; terminaram: number; parados: Map<string, number> }>();
  for (const [id, conj] of conjuntoDa) {
    const l = porConjunto.get(conj) || { visitas: 0, abriram: 0, terminaram: 0, parados: new Map<string, number>() };
    l.visitas++;
    const s = sessoes.get(id);
    if (s && s.passos.size > 0) {
      l.abriram++;
      if (s.fim) l.terminaram++;
      else if (s.ultimoPasso) l.parados.set(s.ultimoPasso, (l.parados.get(s.ultimoPasso) || 0) + 1);
    }
    porConjunto.set(conj, l);
  }
  const conjuntos: QuizDoConjunto[] = [...porConjunto.entries()].map(([id, l]) => {
    const topo = [...l.parados.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      id, visitas: l.visitas, abriram: l.abriram, terminaram: l.terminaram,
      pior: topo ? { passo: topo[0], pergunta: PERGUNTAS[topo[0]] || topo[0], pararam: topo[1] } : null,
    };
  }).sort((a, b) => b.visitas - a.visitas);

  return {
    medindo_desde: MEDINDO_DESDE,
    visitas: [...campanhaDa.keys()].filter(noRecorte).length,
    abriram: noQuiz.length,
    escolheram_porta: noQuiz.filter(([, s]) => s.caminho !== 'inicio').length,
    terminaram: noQuiz.filter(([, s]) => s.fim).length,
    destinos,
    caminhos,
    campanhas: [...porCampanha.entries()]
      .map(([campanha, l]) => ({ campanha, ...l }))
      .sort((a, b) => b.visitas - a.visitas)
      .slice(0, 12),
    conjuntos,
    conjunto: filtro,
  };
}

// ── POR CONJUNTO DE ANÚNCIOS ─────────────────────────────────────────────────
// A pergunta que decide verba: qual conjunto traz reunião, e reunião que vira
// negócio. O utm_term é gravado em tudo desde julho (visita, reunião, ficha e
// cadastro), então este bloco NÃO depende da medição do quiz: resultado e gasto
// valem para qualquer período. Só a coluna "onde mais para" começa em 22/09.

/** Como o status da reunião, depois que ela aconteceu, se lê aqui. */
export const STATUS_NEGOCIO = ['fez_orcamento', 'proposta_apresentada', 'chave_na_mao', 'meio_a_meio', 'carregador'];
export const STATUS_PERDIDA = ['sem_interesse', 'nao_atendeu', 'cancelado', 'perdido', 'fechou_concorrente'];

export interface ResultadoLead {
  conjunto: string | null;
  tipo: 'reuniao' | 'investidor' | 'ponto' | 'parceiro' | 'ficha';
  status?: string | null;
}
export interface MetaConjunto { id: string; nome: string; status: string; gasto: number | null }
export interface LinhaConjunto {
  id: string;
  nome: string;
  status: string;
  gasto: number | null;
  visitas: number;
  abriram_quiz: number;
  reunioes: number;
  investidores: number;
  pontos: number;
  parceiros: number;
  fichas: number;
  custo_reuniao: number | null;
  /** gasto ÷ (reuniões + investidores + pontos). A mesma pessoa pode contar em
   *  mais de uma coluna (ponto que também teve reunião), então não é "por pessoa". */
  custo_resultado: number | null;
  negocio: number;
  arrendamento: number;
  perdidas: number;
  pior: QuizDoConjunto['pior'];
}

/**
 * Junta as três fontes por conjunto. Gasto `null` quer dizer "a Meta não
 * respondeu" e vira travessão na tela; zero é zero de verdade.
 */
export function montarConjuntos(
  quiz: QuizDoConjunto[],
  resultados: ResultadoLead[],
  meta: Map<string, MetaConjunto>,
): LinhaConjunto[] {
  const linhas = new Map<string, LinhaConjunto>();
  const pegar = (id: string): LinhaConjunto => {
    let l = linhas.get(id);
    if (!l) {
      const m = meta.get(id);
      l = {
        id, nome: m?.nome || (id === SEM_CONJUNTO ? 'Sem conjunto (orgânico ou link direto)' : id),
        status: m?.status || '', gasto: m ? m.gasto : (id === SEM_CONJUNTO ? 0 : null),
        visitas: 0, abriram_quiz: 0, reunioes: 0, investidores: 0, pontos: 0, parceiros: 0, fichas: 0,
        custo_reuniao: null, custo_resultado: null, negocio: 0, arrendamento: 0, perdidas: 0, pior: null,
      };
      linhas.set(id, l);
    }
    return l;
  };
  for (const q of quiz) {
    const l = pegar(q.id);
    l.visitas = q.visitas; l.abriram_quiz = q.abriram; l.pior = q.pior;
  }
  for (const r of resultados) {
    const l = pegar(txt(r.conjunto).trim() || SEM_CONJUNTO);
    if (r.tipo === 'reuniao') {
      l.reunioes++;
      const st = txt(r.status);
      if (STATUS_NEGOCIO.includes(st)) l.negocio++;
      else if (st === 'arrendamento') l.arrendamento++;
      else if (STATUS_PERDIDA.includes(st)) l.perdidas++;
    } else if (r.tipo === 'investidor') l.investidores++;
    else if (r.tipo === 'ponto') l.pontos++;
    else if (r.tipo === 'parceiro') l.parceiros++;
    else l.fichas++;
  }
  // conjunto que gastou e não trouxe nada também aparece: é o que mais importa ver
  for (const m of meta.values()) if ((m.gasto || 0) > 0) pegar(m.id);

  const div = (g: number | null, n: number) => (g !== null && n > 0 ? Math.round((g / n) * 100) / 100 : null);
  return [...linhas.values()]
    .map((l) => ({
      ...l,
      custo_reuniao: div(l.gasto, l.reunioes),
      custo_resultado: div(l.gasto, l.reunioes + l.investidores + l.pontos),
    }))
    .sort((a, b) => (b.gasto || 0) - (a.gasto || 0) || b.visitas - a.visitas);
}

/** Começo do período, no fuso de São Paulo quando o período é de calendário. */
export function inicioDoPeriodo(periodo: string, agora: number = Date.now()): string {
  const SP = -3 * 3600_000;
  const hojeSP = new Date(Math.floor((agora + SP) / 86400_000) * 86400_000 - SP);
  if (periodo === 'hoje') return hojeSP.toISOString();
  if (periodo === 'ontem') return new Date(hojeSP.getTime() - 86400_000).toISOString();
  if (periodo === '30dias') return new Date(agora - 30 * 86400_000).toISOString();
  if (periodo === 'maximo') return `${CAMPANHA_DESDE}T00:00:00-03:00`;
  return new Date(agora - 7 * 86400_000).toISOString();
}

/** Fim do período: só "ontem" tem fim antes de agora. */
export function fimDoPeriodo(periodo: string, agora: number = Date.now()): string | null {
  if (periodo !== 'ontem') return null;
  return inicioDoPeriodo('hoje', agora);
}
