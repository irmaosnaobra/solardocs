'use client';

import { Heart, MessageCircle, Trophy } from 'lucide-react';
import type { Episodio, PostRede, Rede } from './tipos';
import { REDES } from './tipos';
import { dia, hora, NOME_REDE, num, totalEpisodio } from './formato';
import { IconeRede } from './Icones';
import Capa from './Capa';
import p from './placar.module.css';

const ROTULO: Record<Exclude<PostRede['status'], 'publicado'>, string> = {
  agendado: 'Agendado',
  pendente: 'Pendente',
  erro: 'Erro ao postar',
  ausente: 'Não postado',
};

function Reacoes({ curtidas, comentarios }: { curtidas: number | null; comentarios: number | null }) {
  return (
    <span className={p.reacoes}>
      <span title="Curtidas"><Heart size={12} strokeWidth={2} aria-hidden="true" /> {num(curtidas)}<span className={p.sr}> curtidas</span></span>
      <span title="Comentários"><MessageCircle size={12} strokeWidth={2} aria-hidden="true" /> {num(comentarios)}<span className={p.sr}> comentários</span></span>
    </span>
  );
}

function Celula({ post, rede }: { post: PostRede | undefined; rede: Rede }) {
  if (!post || post.status !== 'publicado') {
    const st = post?.status ?? 'ausente';
    return <span className={`${p.status} ${st === 'erro' ? p.statusErro : ''}`}>{ROTULO[st as keyof typeof ROTULO]}</span>;
  }
  const views = <span className={p.views}>{num(post.views)}</span>;
  return (
    <span className={p.celula}>
      {post.link && post.link.startsWith('https://') ? (
        <a className={p.link} href={post.link} target="_blank" rel="noopener noreferrer">
          {views}
          <span className={p.sr}> views no {NOME_REDE[rede]}, ver o post</span>
        </a>
      ) : (
        <span>{views}<span className={p.sr}> views no {NOME_REDE[rede]}</span></span>
      )}
      <Reacoes curtidas={post.curtidas} comentarios={post.comentarios} />
    </span>
  );
}

interface Props { episodios: Episodio[] }

export default function Placar({ episodios }: Props) {
  const lista = [...episodios].sort((a, b) => b.numero - a.numero);
  const totais = new Map(lista.map((e) => [e.slug, totalEpisodio(e)]));
  const maxViews = Math.max(0, ...lista.map((e) => totais.get(e.slug)?.views ?? 0));
  const campeao = maxViews > 0 ? lista.find((e) => totais.get(e.slug)?.views === maxViews)?.slug : undefined;

  if (lista.length === 0) {
    return (
      <section className={p.placar} aria-labelledby="estudio-placar">
        <h3 id="estudio-placar" className={p.titulo}>Placar por vídeo</h3>
        <p className={p.vazio}>Nenhum episódio ainda. O primeiro aparece aqui assim que sair da fábrica.</p>
      </section>
    );
  }

  return (
    <section className={p.placar} aria-labelledby="estudio-placar">
      <div className={p.topo}>
        <h3 id="estudio-placar" className={p.titulo}>Placar por vídeo</h3>
        <p className={p.sub}>Toque no número para abrir o post.</p>
      </div>

      {/* Computador: tabela */}
      <table className={p.tabela}>
        <thead>
          <tr>
            <th scope="col">Episódio</th>
            {REDES.map((r) => (
              <th key={r} scope="col" className={p.thRede} data-rede={r}>
                <IconeRede rede={r} size={14} /> {NOME_REDE[r]}
              </th>
            ))}
            <th scope="col" className={p.thTotal}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((e) => {
            const t = totais.get(e.slug)!;
            const top = e.slug === campeao;
            const pct = maxViews > 0 && t.views ? Math.max(3, (t.views / maxViews) * 100) : 0;
            return (
              <tr key={e.slug} className={top ? p.linhaTop : undefined}>
                <th scope="row" className={p.epCel}>
                  <Capa url={e.capaUrl} numero={e.numero} titulo={e.titulo} largura={40} />
                  <span className={p.epInfo}>
                    <span className={p.epTitulo}>{e.titulo}</span>
                    <span className={p.epData}>
                      Ep {String(e.numero).padStart(2, '0')} · {dia(e.quando)} · {hora(e.quando)}
                    </span>
                    {top ? <span className={p.selo}><Trophy size={12} strokeWidth={2} aria-hidden="true" /> Campeão de views</span> : null}
                  </span>
                </th>
                {REDES.map((r) => (
                  <td key={r}><Celula post={e.redes[r]} rede={r} /></td>
                ))}
                <td className={p.totalCel}>
                  {t.views == null ? (
                    <span className={p.status}>{e.estado === 'agendado' ? 'Na fila' : 'Sem dados'}</span>
                  ) : (
                    <>
                      <span className={p.totalViews}>{num(t.views)}</span>
                      <span className={p.barra} aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                      <Reacoes curtidas={t.curtidas} comentarios={t.comentarios} />
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Celular: cartões */}
      <ul className={p.cartoes}>
        {lista.map((e) => {
          const t = totais.get(e.slug)!;
          const top = e.slug === campeao;
          return (
            <li key={e.slug} className={`${p.cartao} ${top ? p.cartaoTop : ''}`}>
              <div className={p.cartaoTopo}>
                <Capa url={e.capaUrl} numero={e.numero} titulo={e.titulo} largura={48} />
                <span className={p.epInfo}>
                  <span className={p.epTitulo}>{e.titulo}</span>
                  <span className={p.epData}>
                    Ep {String(e.numero).padStart(2, '0')} · {dia(e.quando)} · {hora(e.quando)}
                  </span>
                  {top ? <span className={p.selo}><Trophy size={12} strokeWidth={2} aria-hidden="true" /> Campeão de views</span> : null}
                </span>
              </div>
              <dl className={p.cartaoRedes}>
                {REDES.map((r) => (
                  <div key={r} className={p.cartaoRede}>
                    <dt data-rede={r}><IconeRede rede={r} size={14} /> {NOME_REDE[r]}</dt>
                    <dd><Celula post={e.redes[r]} rede={r} /></dd>
                  </div>
                ))}
                <div className={`${p.cartaoRede} ${p.cartaoTotal}`}>
                  <dt>Total</dt>
                  <dd>
                    {t.views == null ? (
                      <span className={p.status}>{e.estado === 'agendado' ? 'Na fila' : 'Sem dados'}</span>
                    ) : (
                      <span className={p.celula}>
                        <span className={p.views}>{num(t.views)}</span>
                        <Reacoes curtidas={t.curtidas} comentarios={t.comentarios} />
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
