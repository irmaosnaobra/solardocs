'use client';

// Mapa da página de venda (/plan/): até onde as pessoas rolaram e onde clicaram.
// É um mapa de calor em lista. A barra de cada seção mede as sessões que a viram
// sobre as visitas; a cor vai da jamaica forte (todos viram) ao tom claro (poucos viram),
// só com os tokens do painel.
import s from './MonjourFunilPanel.module.css';
import { Titulo, fmtInt } from './monjourComum';
import { taxa } from './MonjourFunilCompacto';
import type { FunilMonjour } from './hubMonjour.types';

type Pv = NonNullable<FunilMonjour['paginaVenta']>;

export default function MonjourMapaPagina({ visitas, secoes, cliques }: {
  visitas: number; secoes: NonNullable<Pv['secoes']>; cliques: NonNullable<Pv['cliques']>;
}) {
  return (
    <div className={s.mapa}>
      {secoes.length > 0 && (
        <section aria-labelledby="mj-mapa-rolagem">
          <span id="mj-mapa-rolagem">
            <Titulo dica="Quantas sessões chegaram a ver cada parte da página, na ordem em que ela aparece. A porcentagem é sobre quem abriu a página.">
              Até onde rolaram
            </Titulo>
          </span>
          <ol className={s.mapaLista}>
            {secoes.map((x) => {
              const pct = Math.min(100, Math.max(0, (x.sessoes / visitas) * 100));
              return (
                <li key={x.codigo} className={s.mapaLinha}>
                  <span className={s.mapaNome}>{x.nome}</span>
                  <span className={s.mapaTrilho} aria-hidden="true">
                    <span
                      className={s.mapaBarra}
                      style={{ width: `${x.sessoes > 0 ? Math.max(2, pct) : 0}%`, background: `color-mix(in srgb, var(--mj) ${Math.round(pct)}%, var(--mj-meio))` }}
                    />
                  </span>
                  <span className={s.mapaNum}><b>{fmtInt(x.sessoes)}</b> <small>{taxa(x.sessoes, visitas)}</small></span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {cliques.length > 0 && (
        <section aria-labelledby="mj-mapa-cliques" className={s.mapaCliques}>
          <span id="mj-mapa-cliques">
            <Titulo dica="Os elementos da página em que alguém clicou. Sessões = quantas pessoas clicaram, com a porcentagem de quem abriu a página. Cliques = quantas vezes, somando todos.">
              Onde clicaram
            </Titulo>
          </span>
          <div className={`${s.mapaCl} ${s.mapaClCab}`} aria-hidden="true">
            <span>Elemento</span><span>Sessões</span><span>Cliques</span>
          </div>
          <ul className={s.mapaLista}>
            {cliques.map((x) => (
              <li key={x.codigo} className={s.mapaCl}>
                <span className={s.mapaNome}>{x.nome}</span>
                <span className={s.mapaNum}><b>{fmtInt(x.sessoes)}</b> <small>{taxa(x.sessoes, visitas)}</small></span>
                <span className={s.mapaNum}>{fmtInt(x.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
