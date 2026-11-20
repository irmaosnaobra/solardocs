// Dados de exemplo da aba Estúdio. Só entram em desenvolvimento ou quando a api
// não devolve nada. Fábrica 1: views do TikTok são as reais aproximadas de 19/11/2026;
// Instagram e YouTube estão na mesma ordem de grandeza, inventados.
// Fábricas 2 e 3: pauta.json (semana de 20/11) e plano.json do estudio-video, de 19/11.
import type { Episodio, ItemPauta, PostRede, Rede, Snapshot, Totais } from './tipos';
import { REDES } from './tipos';

const IG = 'https://www.instagram.com/dentrodaguerraa/';
const YT = 'https://www.youtube.com/@dentrodaguerraa';
const TT = 'https://www.tiktok.com/@dentrodaguerraa';
const LINK: Record<Rede, string> = { instagram: IG, youtube: YT, tiktok: TT };

type Trio = [number | null, number | null, number | null];

function pub(rede: Rede, [views, curtidas, comentarios]: Trio): PostRede {
  return { status: 'publicado', link: LINK[rede], views, curtidas, comentarios };
}
const agendado: PostRede = { status: 'agendado', link: null, views: null, curtidas: null, comentarios: null };
const ausente: PostRede = { status: 'ausente', link: null, views: null, curtidas: null, comentarios: null };

function ep(numero: number, slug: string, titulo: string, dia: string, ig: Trio, yt: Trio, tt: Trio | null): Episodio {
  return {
    slug,
    numero,
    titulo,
    quando: `${dia}T22:00:00.000Z`,
    estado: tt ? 'publicado' : 'parcial',
    capaUrl: null,
    redes: { instagram: pub('instagram', ig), youtube: pub('youtube', yt), tiktok: tt ? pub('tiktok', tt) : ausente },
  };
}

const episodios: Episodio[] = [
  ep(1, 'guerra-ep01-hayha', 'O atirador que ninguém via', '2026-11-14', [1840, 96, 7], [1320, 41, 3], null),
  ep(2, 'guerra-ep02-navajo', 'A língua que os japoneses não quebraram', '2026-11-15', [2210, 134, 12], [980, 37, 5], [212, 18, 2]),
  ep(3, 'guerra-ep03-feb', 'A cobra vai fumar', '2026-11-16', [3050, 211, 19], [1460, 58, 9], [295, 24, 4]),
  ep(4, 'guerra-ep04-cher-ami', 'Cher Ami', '2026-11-17', [1690, 102, 6], [740, 29, null], [175, 11, 1]),
  ep(5, 'guerra-ep05-wald', 'Os aviões que voltaram', '2026-11-18', [4120, 287, 31], [2380, 93, 14], [411, 36, 5]),
  {
    slug: 'guerra-ep06-tregua',
    numero: 6,
    titulo: 'Trégua de Natal',
    quando: '2026-11-21T22:00:00.000Z',
    estado: 'agendado',
    capaUrl: null,
    redes: { instagram: agendado, tiktok: agendado },
  },
];

function somar(eps: Episodio[]): Totais {
  const porRede: Totais['porRede'] = {};
  const t: Totais = { views: 0, curtidas: 0, comentarios: 0, porRede };
  for (const r of REDES) {
    const acc = { views: 0, curtidas: 0, comentarios: 0 };
    for (const e of eps) {
      const p = e.redes[r];
      acc.views += p?.views ?? 0;
      acc.curtidas += p?.curtidas ?? 0;
      acc.comentarios += p?.comentarios ?? 0;
    }
    porRede[r] = acc;
    t.views += acc.views;
    t.curtidas += acc.curtidas;
    t.comentarios += acc.comentarios;
  }
  return t;
}

const vazio: Totais = { views: 0, curtidas: 0, comentarios: 0, porRede: {} };

/** Fábrica 1 (Dentro da Guerra), com "atualizado" 4 minutos atrás. */
export function fixtureEstudio(): Snapshot {
  const atualizadoEm = new Date(Date.now() - 4 * 60000).toISOString();
  return {
    versao: 2,
    fabricaId: 'dentro-da-guerra',
    fabricaNome: 'Dentro da Guerra',
    ordem: 1,
    situacao: 'no-ar',
    contas: [
      { rede: 'instagram', handle: '@dentrodaguerraa', url: IG, seguidores: 1480 },
      { rede: 'tiktok', handle: '@dentrodaguerraa', url: TT },
    ],
    horarios: ['19:00'],
    atualizadoEm,
    serie: { nome: 'Dentro da Guerra', horario: '19:00', automatico: true },
    redes: [
      { rede: 'instagram', conta: '@dentrodaguerraa', url: IG, seguidores: 1480, ligada: true, via: 'Meta Graph API' },
      { rede: 'tiktok', conta: '@dentrodaguerraa', url: TT, seguidores: null, ligada: true, via: 'Zernio' },
    ],
    fabrica: {
      etapas: [
        { id: 'roteiro', nome: 'Roteiro' },
        { id: 'voz', nome: 'Voz de IA' },
        { id: 'edicao', nome: 'Edição' },
        { id: 'capa', nome: 'Capa' },
        { id: 'revisao', nome: 'Revisão' },
        { id: 'publicacao', nome: 'Publicação' },
      ],
    },
    episodios,
    totais: somar(episodios),
  };
}

// ── Fábrica 2: Irmãos na Obra ──────────────────────────────────────────────
const IO_IG = 'https://www.instagram.com/irmaosnaobra__/';
const IO_TT = 'https://www.tiktok.com/@irmaosnaobra__';

type Linha = [string, string, string, string, string, string, number?];
const PAUTA: Linha[] = [
  ['2026-11-20', '11:00', 'eletroposto-peca-por-peca', 'Eletroposto peça por peça', 'eletroposto', 'agendado', 8.9],
  ['2026-11-20', '17:00', 'solar-peca-por-peca', 'Solar peça por peça: o que tem no seu telhado', 'solar', 'visual'],
  ['2026-11-21', '11:00', 'energia-ate-a-tomada', 'Da usina até a sua tomada', 'energia', 'voz'],
  ['2026-11-21', '17:00', 'guerra-das-correntes', 'A guerra das correntes: Edison x Tesla', 'historia', 'voz'],
  ['2026-11-22', '11:00', 'passarinho-no-fio', 'Por que o passarinho no fio não leva choque', 'energia', 'fatos'],
  ['2026-11-22', '17:00', 'primeiro-painel-solar', 'O 1º painel solar num telhado, em 1884', 'historia', 'fatos'],
  ['2026-11-23', '11:00', 'chuveiro-eletrico', 'Chuveiro elétrico: o vilão da conta', 'energia', 'fatos'],
  ['2026-11-23', '17:00', 'solar-no-apagao', 'Por que o solar desliga no apagão', 'solar', 'fatos'],
  ['2026-11-24', '11:00', 'itaipu-peca-por-peca', 'Itaipu peça por peça', 'historia', 'fatos'],
  ['2026-11-24', '17:00', 'bandeira-vermelha', 'Bandeira vermelha: por que a conta sobe sem chuva', 'energia', 'fatos'],
  ['2026-11-25', '11:00', 'apagao-de-2001', 'O apagão de 2001', 'historia', 'fatos'],
  ['2026-11-25', '17:00', 'sobra-do-painel', 'Para onde vai a energia que sobra do seu painel', 'solar', 'fatos'],
  ['2026-11-26', '11:00', 'energia-do-raio', 'Quanta energia tem um raio', 'energia', 'fatos'],
  ['2026-11-26', '17:00', '127-ou-220', '127 V ou 220 V: por que o Brasil tem os dois', 'energia', 'fatos'],
];
const itens: ItemPauta[] = PAUTA.map(([dia, hora, slug, tema, linha, etapa, nota]) => ({
  dia, hora, slug, tema, linha, etapa, ...(nota != null ? { nota } : {}),
}));

function fixtureIrmaos(atualizadoEm: string): Snapshot {
  return {
    versao: 2,
    fabricaId: 'irmaos-na-obra',
    fabricaNome: 'Irmãos na Obra',
    ordem: 2,
    situacao: 'no-ar',
    contas: [
      { rede: 'instagram', handle: '@irmaosnaobra__', url: IO_IG },
      { rede: 'tiktok', handle: '@irmaosnaobra__', url: IO_TT },
    ],
    horarios: ['11:00', '17:00'],
    programacao: itens
      .filter((i) => i.etapa === 'agendado')
      .map((i) => ({
        quando: `${i.dia}T${i.hora}:00-03:00`,
        slug: i.slug,
        titulo: i.tema,
        linha: i.linha,
        redes: { instagram: 'agendado' as const, tiktok: 'agendado' as const },
      })),
    pauta: { semana: '2026-11-20', etapas: ['fatos', 'roteiro', 'voz', 'visual', 'avaliacao', 'agendado', 'publicado'], itens },
    personagem: { nome: 'O instalador', imagemUrl: '/admin/estudio/protagonista.png', descricao: 'Protagonista fixo da série. O mesmo em todo vídeo.' },
    atualizadoEm,
    serie: { nome: 'Curiosidades de energia', horario: '11:00', automatico: true },
    redes: [],
    fabrica: { etapas: [] },
    episodios: [],
    totais: vazio,
  };
}

// ── Fábrica 3: YouTube, em montagem ────────────────────────────────────────
function fixtureYoutube(atualizadoEm: string): Snapshot {
  return {
    versao: 2,
    fabricaId: 'youtube',
    fabricaNome: 'YouTube: curiosidades longas',
    ordem: 3,
    situacao: 'em-montagem',
    contas: [],
    horarios: [],
    plano: {
      formato: 'Animação 3D de curiosidades, horizontal (16:9), de 20 a 25 minutos',
      cadencia: '1 vídeo longo por semana, mais 3 a 5 cortes de até 3 min em Short apontando para ele',
      objetivo: 'Atrair cliente de solar e eletroposto e chegar à monetização',
      esqueleto: [
        { minuto: '0:00', bloco: 'Gancho com número em 3 s' },
        { minuto: '0:40', bloco: 'O mapa do vídeo' },
        { minuto: '1:30', bloco: 'O básico' },
        { minuto: '4:00', bloco: 'A crença errada' },
        { minuto: '8:00', bloco: 'Por dentro: a cena nunca vista' },
        { minuto: '12:00', bloco: 'Escala e história' },
        { minuto: '16:00', bloco: 'Lenda x comprovado' },
        { minuto: '19:30', bloco: 'O pagamento' },
        { minuto: '21:00', bloco: 'Fecho com uma chamada só' },
      ],
      marcos: [
        { titulo: 'Fábrica criada e formato decidido (horizontal, 20+ min)', feito: true },
        { titulo: 'Pesquisa de canais de referência e regras de monetização', feito: true },
        { titulo: 'Canal definido pelo dono', feito: false },
        { titulo: 'Kit 3D renderizando em 16:9', feito: false },
        { titulo: 'Roteiro do piloto (22 min) com fatos comprovados', feito: false },
        { titulo: 'Voz do piloto (depende do plano de voz)', feito: false },
        { titulo: 'Piloto renderizado e avaliado com nota 9+', feito: false },
        { titulo: 'Piloto no ar e 4 semanas de teste', feito: false },
      ],
      referencias: [
        { canal: 'Desvende & Descubra', idioma: 'pt-BR', inscritos: 275000, mediaViews: 233000 },
        { canal: 'The Engineering Mindset', idioma: 'en', inscritos: 4500000, mediaViews: 402000 },
        { canal: 'The B1M', idioma: 'en', inscritos: 4090000, mediaViews: 1060000 },
      ],
      riscos: [
        'A partir de 01/02/2027 canal novo precisa de 1.000 inscritos e 8.000 horas para monetizar',
        'Formato repetido com voz de IA é o perfil que a política de conteúdo inautêntico vigia',
        'Um vídeo de 22 min gasta cerca de 24 mil caracteres de voz',
      ],
    },
    atualizadoEm,
    serie: { nome: 'Curiosidades longas', horario: '', automatico: false },
    redes: [],
    fabrica: { etapas: [] },
    episodios: [],
    totais: vazio,
  };
}

/** As 3 fábricas de exemplo, em ordem. */
export function fixtureFabricas(): Snapshot[] {
  const f1 = fixtureEstudio();
  return [f1, fixtureIrmaos(f1.atualizadoEm), fixtureYoutube(f1.atualizadoEm)];
}
