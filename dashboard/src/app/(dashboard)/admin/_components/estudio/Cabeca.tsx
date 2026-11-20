'use client';

import type { ReactNode } from 'react';
import type { Situacao as TSituacao, Snapshot } from './tipos';
import { contasFabrica, horariosFabrica, idFabrica, nomeFabrica, NOME_REDE, situacaoFabrica } from './formato';
import { IconeRede } from './Icones';
import Dica from './Dica';
import f from './fabricas.module.css';

const ROTULO: Record<TSituacao, string> = { 'no-ar': 'No ar', 'em-montagem': 'Em montagem', pausada: 'Pausada' };

export function Situacao({ situacao }: { situacao: TSituacao }) {
  return (
    <span className={f.situacao} data-situacao={situacao}>
      <span className={f.situacaoPonto} aria-hidden="true" />
      {ROTULO[situacao]}
    </span>
  );
}

interface Props { fab: Snapshot; numero: number; dica: string; destaque?: boolean; lado?: ReactNode }

/** Cabeça da seção de uma fábrica: número, nome, situação, contas e horários. */
export default function Cabeca({ fab, numero, dica, destaque, lado }: Props) {
  const id = idFabrica(fab);
  const contas = contasFabrica(fab);
  const horarios = horariosFabrica(fab);
  return (
    <header className={f.cabeca}>
      <div className={f.cabecaTexto}>
        <p className={f.cabecaOlho}>
          <span>Fábrica {String(numero).padStart(2, '0')}</span>
          {destaque ? <span className={f.cabecaDestaque}>Em destaque</span> : null}
          <Situacao situacao={situacaoFabrica(fab)} />
        </p>
        <h3 id={`fab-${id}-titulo`} className={f.cabecaNome}>
          {nomeFabrica(fab)}
          <Dica texto={dica} rotulo={`Como funciona a fábrica ${nomeFabrica(fab)}`} />
        </h3>
        <ul className={f.cabecaContas}>
          {contas.map((c) => (
            <li key={`${c.rede}-${c.handle}`} data-rede={c.rede}>
              <IconeRede rede={c.rede} size={15} />
              {c.url?.startsWith('https://') ? (
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.handle}
                  <span className={f.sr}> no {NOME_REDE[c.rede]} (abre em nova aba)</span>
                </a>
              ) : (
                <span>{c.handle}</span>
              )}
            </li>
          ))}
          {contas.length === 0 ? (
            <li data-rede="youtube">
              <IconeRede rede="youtube" size={15} />
              <span className={f.mudo}>Canal a definir</span>
            </li>
          ) : null}
          {horarios.map((h) => (
            <li key={h} className={f.cabecaHora}>{h}</li>
          ))}
        </ul>
      </div>
      {lado ? <div className={f.cabecaLado}>{lado}</div> : null}
    </header>
  );
}
