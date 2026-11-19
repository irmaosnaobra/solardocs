// Dados de exemplo da aba Estúdio. Só entram em desenvolvimento ou quando a api
// devolve snapshot null. Views do TikTok são as reais aproximadas de 19/11/2026;
// Instagram e YouTube estão na mesma ordem de grandeza, inventados.
import type { Episodio, PostRede, Rede, Snapshot, Totais } from './tipos';
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
    redes: { instagram: agendado, youtube: agendado, tiktok: agendado },
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

/** Monta a fixture na hora, com "atualizado" 4 minutos atrás. */
export function fixtureEstudio(): Snapshot {
  const atualizadoEm = new Date(Date.now() - 4 * 60000).toISOString();
  return {
    versao: 1,
    atualizadoEm,
    serie: { nome: 'Dentro da Guerra', horario: '19:00', automatico: true },
    redes: [
      { rede: 'instagram', conta: '@dentrodaguerraa', url: IG, seguidores: 1480, ligada: true, via: 'Meta Graph API' },
      { rede: 'youtube', conta: '@dentrodaguerraa', url: YT, seguidores: 312, ligada: true, via: 'YouTube Data API' },
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
