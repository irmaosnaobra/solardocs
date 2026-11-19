'use client';

import type { ContaRede, Episodio } from './tipos';
import { dia, hora, NOME_REDE, num } from './formato';
import { IconeRede } from './Icones';
import s from './estudio.module.css';

interface Props { redes: ContaRede[]; episodios: Episodio[]; horario: string; agora: number }

/** Próxima postagem agendada naquela rede, ou null. */
function proxima(rede: ContaRede['rede'], eps: Episodio[], agora: number): string | null {
  const futuros = eps
    .filter((e) => e.redes[rede]?.status === 'agendado' && new Date(e.quando).getTime() > agora)
    .sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime());
  return futuros[0]?.quando ?? null;
}

export default function Redes({ redes, episodios, horario, agora }: Props) {
  return (
    <section className={s.redes} aria-labelledby="estudio-redes">
      <div className={s.secTopo}>
        <div>
          <h3 id="estudio-redes" className={s.secTitulo}>Redes conectadas</h3>
          <p className={s.secSub}>Cada episódio sai nas {redes.length} ao mesmo tempo, pela api oficial de cada uma.</p>
        </div>
      </div>
      <ul className={s.redesLista}>
        {redes.map((r) => {
          const quando = proxima(r.rede, episodios, agora);
          return (
            <li key={r.rede} className={s.rede} data-rede={r.rede}>
              <div className={s.redeTopo}>
                <span className={s.redeIcone}><IconeRede rede={r.rede} size={20} /></span>
                <span className={s.redeNome}>{NOME_REDE[r.rede]}</span>
                <span className={r.ligada ? s.redeLigada : s.redeDesligada}>
                  <span className={s.redeDot} aria-hidden="true" />
                  {r.ligada ? 'Ligada' : 'Desligada'}
                </span>
              </div>
              <a className={s.redeConta} href={r.url?.startsWith('https://') ? r.url : undefined} target="_blank" rel="noopener noreferrer">
                {r.conta}
                <span className={s.sr}> (abre em nova aba)</span>
              </a>
              <dl className={s.redeDados}>
                <div>
                  <dt>Seguidores</dt>
                  <dd className={s.redeSeg}>{num(r.seguidores)}</dd>
                </div>
                <div>
                  <dt>Próxima postagem</dt>
                  <dd>{quando ? `${dia(quando)} · ${hora(quando)}` : `Às ${horario}`}</dd>
                </div>
                <div>
                  <dt>Via</dt>
                  <dd>{r.via}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
