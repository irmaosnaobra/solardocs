'use client';

// Fábrica em montagem (YouTube): formato, marcos, o esqueleto de 22 min como
// linha do tempo, os canais de referência e os riscos.
import type { CSSProperties } from 'react';
import { AlertTriangle, CalendarRange, Check, MonitorPlay, Target } from 'lucide-react';
import type { Plano as TPlano } from './tipos';
import { numCurto } from './formato';
import Dica from './Dica';
import f from './fabricas.module.css';

const DURACAO_MIN = 22;

function seg(m: string): number {
  const [a, b] = m.split(':').map(Number);
  return (a || 0) * 60 + (b || 0);
}

function duracao(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export default function Plano({ plano }: { plano: TPlano }) {
  const fimSeg = Math.max(DURACAO_MIN * 60, ...plano.esqueleto.map((b) => seg(b.minuto) + 60));
  const blocos = plano.esqueleto.map((b, i) => {
    const ini = seg(b.minuto);
    const fim = i < plano.esqueleto.length - 1 ? seg(plano.esqueleto[i + 1].minuto) : fimSeg;
    return { ...b, ini, dur: Math.max(1, fim - ini) };
  });
  const feitos = plano.marcos.filter((m) => m.feito).length;
  const proximo = plano.marcos.findIndex((m) => !m.feito);
  const maxViews = Math.max(1, ...plano.referencias.map((r) => r.mediaViews));
  const fatos = [
    { Icone: MonitorPlay, rotulo: 'Formato', texto: plano.formato },
    { Icone: CalendarRange, rotulo: 'Cadência', texto: plano.cadencia },
    { Icone: Target, rotulo: 'Objetivo', texto: plano.objetivo },
  ];

  return (
    <>
      <ul className={f.planoFatos}>
        {fatos.map(({ Icone, rotulo, texto }) => (
          <li key={rotulo}>
            <span className={f.planoFatoIcone}><Icone size={18} strokeWidth={1.7} aria-hidden="true" /></span>
            <span>
              <span className={f.planoFatoRotulo}>{rotulo}</span>
              <span className={f.planoFatoTexto}>{texto}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className={f.bloco}>
        <div className={f.blocoTopo}>
          <h4 className={f.blocoTitulo}>Esqueleto de {DURACAO_MIN}{' '}min</h4>
          <Dica texto="A ordem dos blocos de todo vídeo longo. A largura de cada faixa é o tempo que o bloco ocupa." />
        </div>
        <div className={f.tempo}>
          <ol className={f.tempoBarra} aria-hidden="true">
            {blocos.map((b, i) => (
              <li key={b.minuto} style={{ flexGrow: b.dur, '--t': i / (blocos.length - 1) } as CSSProperties}>
                <span>{i + 1}</span>
              </li>
            ))}
          </ol>
          <div className={f.tempoRegua} aria-hidden="true">
            {[0, 5, 10, 15, 20].map((m) => (
              <span key={m} style={{ left: `${((m * 60) / fimSeg) * 100}%` }}>{m}:00</span>
            ))}
          </div>
          <ol className={f.tempoLista}>
            {blocos.map((b, i) => (
              <li key={b.minuto} style={{ '--t': i / (blocos.length - 1) } as CSSProperties}>
                <span className={f.tempoNum} aria-hidden="true">{i + 1}</span>
                <span className={f.tempoMin}>{b.minuto}</span>
                <span className={f.tempoBloco}>{b.bloco}</span>
                <span className={f.tempoDur}>{duracao(b.dur)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className={f.planoGrade}>
        <div className={f.bloco}>
          <div className={f.blocoTopo}>
            <h4 className={f.blocoTitulo}>Marcos</h4>
            <span className={f.blocoInfo}>{feitos} de {plano.marcos.length}</span>
            <Dica texto="Nada é publicado antes de o dono aprovar o piloto." />
          </div>
          <span className={f.marcosBarra} aria-hidden="true"><span style={{ width: `${(feitos / Math.max(1, plano.marcos.length)) * 100}%` }} /></span>
          <ol className={f.marcos}>
            {plano.marcos.map((m, i) => (
              <li key={m.titulo} data-feito={m.feito || undefined} data-proximo={i === proximo || undefined}>
                <span className={f.marcoBola} aria-hidden="true">{m.feito ? <Check size={13} strokeWidth={2.6} /> : i + 1}</span>
                <span className={f.marcoTitulo}>
                  {m.titulo}
                  <span className={f.sr}>{m.feito ? ' (feito)' : ' (por fazer)'}</span>
                </span>
                {i === proximo ? <span className={f.marcoAgora}>Próximo</span> : null}
              </li>
            ))}
          </ol>
        </div>

        <div className={f.planoColuna}>
          <div className={f.bloco}>
            <div className={f.blocoTopo}>
              <h4 className={f.blocoTitulo}>Referências</h4>
              <Dica lado="direita" texto="Canais que já fazem vídeo longo de curiosidade. Média de views por vídeo." />
            </div>
            <table className={f.refs}>
              <thead>
                <tr>
                  <th scope="col">Canal</th>
                  <th scope="col" className={f.num}>Inscritos</th>
                  <th scope="col">Média de views</th>
                </tr>
              </thead>
              <tbody>
                {plano.referencias.map((r) => (
                  <tr key={r.canal}>
                    <th scope="row">
                      <span className={f.refCanal}>{r.canal}</span>
                      <span className={f.refIdioma}>{r.idioma === 'pt-BR' ? 'PT' : r.idioma.toUpperCase()}</span>
                    </th>
                    <td className={f.num}>{numCurto(r.inscritos)}</td>
                    <td>
                      <span className={f.refViews}>
                        <span className={f.refBarra} aria-hidden="true"><span style={{ width: `${(r.mediaViews / maxViews) * 100}%` }} /></span>
                        <b>{numCurto(r.mediaViews)}</b>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={f.bloco}>
            <div className={f.blocoTopo}>
              <h4 className={f.blocoTitulo}>Riscos</h4>
            </div>
            <ul className={f.riscos}>
              {plano.riscos.map((r) => (
                <li key={r}>
                  <AlertTriangle size={16} strokeWidth={1.8} aria-hidden="true" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
