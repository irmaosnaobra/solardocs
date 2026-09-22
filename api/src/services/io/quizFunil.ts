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

/** O dia em que a página começou a gravar. Antes disso não há o que ler. */
export const MEDINDO_DESDE = '2026-09-22';

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
}

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

/** A conta inteira. Pura: recebe o que o banco devolveu e não lê nada. */
export function montarFunil(eventos: EventoQuiz[], visitas: VisitaQuiz[]): FunilQuiz {
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

  // Só conta como "abriu" quem viu alguma pergunta. Sessão que só mandou erro
  // ou fim (página velha em cache, por exemplo) não entra no funil.
  const noQuiz = [...sessoes.entries()].filter(([, s]) => s.passos.size > 0);

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

  // Campanha: a da visita (a primeira que tiver UTM). Sem visita medida a
  // sessão não aparece aqui, mas continua no funil de cima.
  const campanhaDa = new Map<string, string>();
  const visitasDaLp = visitas.filter((v) => v.session_id && ehVisitaDaLp(v.landing_url));
  for (const v of visitasDaLp) {
    const id = v.session_id as string;
    if (!campanhaDa.has(id) || (!campanhaDa.get(id) && v.utm_campaign)) campanhaDa.set(id, v.utm_campaign || '');
  }
  const porCampanha = new Map<string, { visitas: number; abriram: number; terminaram: number; reunioes: number }>();
  for (const [id, camp] of campanhaDa) {
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

  return {
    medindo_desde: MEDINDO_DESDE,
    visitas: campanhaDa.size,
    abriram: noQuiz.length,
    escolheram_porta: noQuiz.filter(([, s]) => s.caminho !== 'inicio').length,
    terminaram: noQuiz.filter(([, s]) => s.fim).length,
    destinos,
    caminhos,
    campanhas: [...porCampanha.entries()]
      .map(([campanha, l]) => ({ campanha, ...l }))
      .sort((a, b) => b.visitas - a.visitas)
      .slice(0, 12),
  };
}

/** Começo do período, no fuso de São Paulo quando o período é de calendário. */
export function inicioDoPeriodo(periodo: string, agora: number = Date.now()): string {
  const SP = -3 * 3600_000;
  const hojeSP = new Date(Math.floor((agora + SP) / 86400_000) * 86400_000 - SP);
  if (periodo === 'hoje') return hojeSP.toISOString();
  if (periodo === 'ontem') return new Date(hojeSP.getTime() - 86400_000).toISOString();
  if (periodo === '30dias') return new Date(agora - 30 * 86400_000).toISOString();
  if (periodo === 'maximo') return `${MEDINDO_DESDE}T00:00:00-03:00`;
  return new Date(agora - 7 * 86400_000).toISOString();
}

/** Fim do período: só "ontem" tem fim antes de agora. */
export function fimDoPeriodo(periodo: string, agora: number = Date.now()): string | null {
  if (periodo !== 'ontem') return null;
  return inicioDoPeriodo('hoje', agora);
}
