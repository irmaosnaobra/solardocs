'use client';

// O desenho do funil Monjour: uma faixa por etapa, em trapézio centralizado.
// O topo tem a largura de quem chegou nesta etapa e a base a de quem chegou na
// próxima, e as faixas emendam num funil só. A maior queda (em pessoas) fica
// pintada cheia, com aviso no topo e botão que rola até ela.
import { Fragment, useMemo, useRef } from 'react';
import s from './MonjourFunilPanel.module.css';
import { TIPO, fmtInt, fmtPct, fmtTempo } from './monjourComum';
import type { EtapaMonjour } from './hubMonjour.types';

export default function MonjourFunilDesenho({ etapas, total }: { etapas: EtapaMonjour[]; total: number }) {
  const rolagem = useRef<HTMLDivElement>(null);
  const ordem = useMemo(() => [...etapas].sort((a, b) => a.n - b.n), [etapas]);
  const topo = Math.max(1, total, ...ordem.map((e) => e.chegaram));
  // A maior queda é em pessoas: é onde o quiz perde mais gente de verdade. A
  // última etapa (Comprou) não tem "depois", então não entra.
  const queda = ordem.slice(0, -1).reduce<EtapaMonjour | null>((m, e) => (e.sairam > (m?.sairam ?? 0) ? e : m), null);
  const largura = (n: number) => (n <= 0 ? 0 : Math.max(1.5, (n / topo) * 100));
  const maxSaida = Math.max(0.0001, ...ordem.map((e) => (e.chegaram ? e.sairam / e.chegaram : 0)));

  const irParaQueda = () => {
    const box = rolagem.current;
    const alvo = box?.querySelector<HTMLElement>(`[data-n="${queda?.n}"]`);
    if (!box || !alvo) return;
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: Math.max(0, alvo.offsetTop - box.clientHeight / 2 + alvo.clientHeight / 2), behavior: suave ? 'smooth' : 'auto' });
    alvo.focus({ preventScroll: true });
  };

  return (
    <>
      {queda && (
        <div className={s.queda} role="status">
          <span className={s.quedaSelo}>Maior queda</span>
          <span>
            <b>{queda.n}. {queda.rotulo}</b>: {fmtInt(queda.sairam)} {queda.sairam === 1 ? 'pessoa saiu' : 'pessoas saíram'} ali,
            {' '}{fmtPct(queda.sairam, queda.chegaram)} de quem chegou.
          </span>
          <button type="button" className={s.quedaBotao} onClick={irParaQueda}>Ver no funil</button>
        </div>
      )}
      <div className={s.funilRolagem} ref={rolagem}>
        <div className={s.funilCab} aria-hidden="true">
          <span>Etapa</span><span style={{ textAlign: 'center' }}>Do início</span>
          <span>Chegaram</span><span>Saíram ali</span><span>Tempo</span>
        </div>
        <ol className={s.funilLista} aria-label="Funil do quiz, etapa por etapa">
          {ordem.map((e, i) => {
            const prox = ordem[i + 1];
            const topoW = largura(e.chegaram);
            const baseW = prox ? largura(prox.chegaram) : topoW;
            const pos = e.n > 30;
            const ehQueda = queda?.n === e.n;
            const pctTxt = fmtPct(e.chegaram, topo, 1);
            const cabeDentro = topoW >= 16;
            const fracSaida = e.chegaram ? e.sairam / e.chegaram : 0;
            const extra = e.pularam ? `${fmtInt(e.pularam)} pularam` : '';
            const resumo = `${e.n}. ${e.rotulo}: chegaram ${e.chegaram} (${pctTxt} do início), saíram ali ${e.sairam}`
              + `${e.chegaram ? ` (${fmtPct(e.sairam, e.chegaram)})` : ''}, tempo mediano ${fmtTempo(e.medianaSegundos)}`
              + (extra ? `, ${extra}` : '') + (ehQueda ? '. Maior queda do funil' : '');
            return (
              <Fragment key={e.n}>
                {e.n === 31 && <li className={s.divisor} aria-hidden="true">Depois do quiz</li>}
                <li
                  className={`${s.etapa} ${ehQueda ? s.etapaQueda : ''}`}
                  data-n={e.n}
                  tabIndex={-1}
                  aria-label={resumo}
                  title={resumo}
                >
                  <div className={s.etapaNome}>
                    <span className={s.etapaN}>{e.n}</span>
                    <span className={s.etapaRotulo}>{e.rotulo}</span>
                    {TIPO[e.tipo] && <span className={s.etapaTipo}>{TIPO[e.tipo]}</span>}
                    {extra && <span className={s.etapaExtra}>{extra}</span>}
                  </div>
                  <div className={s.faixaTrilho} aria-hidden="true">
                    <div
                      className={`${s.faixa} ${pos ? s.faixaPos : ''}`}
                      style={{ clipPath: `polygon(${50 - topoW / 2}% 0, ${50 + topoW / 2}% 0, ${50 + baseW / 2}% 100%, ${50 - baseW / 2}% 100%)` }}
                    />
                    <span
                      className={`${s.faixaRotulo} ${cabeDentro ? '' : s.faixaRotuloFora}`}
                      style={{ left: cabeDentro ? '50%' : `calc(${50 + Math.max(topoW, baseW) / 2}% + 6px)` }}
                    >
                      {pctTxt}
                    </span>
                  </div>
                  <div className={`${s.num} ${s.numForte} ${s.numChegaram}`}>{fmtInt(e.chegaram)}</div>
                  <div className={s.saida}>
                    <div className={s.saidaTrilho}>
                      <div className={s.saidaBarra} style={{ width: `${(fracSaida / maxSaida) * 100}%` }} />
                    </div>
                    <div className={s.saidaNum}>
                      {prox ? (
                        <>
                          <span className={s.soCelular}>saíram </span>{fmtInt(e.sairam)}
                          {e.chegaram > 0 && <small>{fmtPct(e.sairam, e.chegaram)}</small>}
                        </>
                      ) : <span className={s.numFraco}>fim</span>}
                    </div>
                  </div>
                  <div className={`${s.num} ${s.numFraco} ${s.numTempo}`}>
                    <span className={s.soCelular}>tempo </span>{fmtTempo(e.medianaSegundos)}
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </div>
    </>
  );
}
