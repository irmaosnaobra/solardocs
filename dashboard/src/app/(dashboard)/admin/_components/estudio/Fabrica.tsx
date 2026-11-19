'use client';

import type { CSSProperties } from 'react';
import { AudioLines, Clapperboard, FilePenLine, Image as ImageIcon, RadioTower, ScanEye, Scissors, type LucideIcon } from 'lucide-react';
import type { Episodio, Etapa, Rede } from './tipos';
import { REDES } from './tipos';
import { agendados, dia, emQuanto, hora, NOME_REDE } from './formato';
import { IconeRede } from './Icones';
import Capa from './Capa';
import s from './estudio.module.css';

const ICONE: Record<string, LucideIcon> = {
  roteiro: FilePenLine,
  voz: AudioLines,
  edicao: Scissors,
  capa: ImageIcon,
  revisao: ScanEye,
  publicacao: RadioTower,
};

// TEXTO PROVISÓRIO (redator): o que cada máquina faz, em até 3 palavras.
const FAZ: Record<string, string> = {
  roteiro: 'Pesquisa e texto',
  voz: 'Narração gerada',
  edicao: 'Cortes e legendas',
  capa: 'Arte do episódio',
  revisao: 'Checagem final',
  publicacao: 'Posta sozinha',
};

interface Props { etapas: Etapa[]; episodios: Episodio[]; horario: string; agora: number }

export default function Fabrica({ etapas, episodios, horario, agora }: Props) {
  const fila = agendados(episodios, agora);
  const prox = fila[0] ?? null;
  const ultimo = [...episodios].filter((e) => e.estado !== 'agendado').sort((a, b) => b.numero - a.numero)[0] ?? null;
  const n = etapas.length;
  const nn = prox ? String(prox.numero).padStart(2, '0') : null;

  return (
    <section className={s.fabrica} aria-labelledby="estudio-fabrica">
      <div className={s.secTopo}>
        <div>
          <h3 id="estudio-fabrica" className={s.secTitulo}>A fábrica</h3>
          <p className={s.secSub}>{n} máquinas em linha. O episódio entra como ideia e sai publicado.</p>
        </div>
        {prox ? (
          <p className={s.proxResumo}>
            <span className={s.vivo} aria-hidden="true" />
            Ep {nn} sai <strong>{emQuanto(prox.quando, agora)}</strong>
          </p>
        ) : null}
      </div>

      <div className={s.linhaWrap} style={{ '--n': n } as CSSProperties}>
        <div className={s.conduite} aria-hidden="true">
          <span className={s.conduiteAceso} />
          <span className={s.trilho}><span className={s.pulso} /></span>
          {prox ? (
            <span className={s.cargaTrilho}>
              <span className={s.carga}>
                <span className={s.cargaTxt}>EP {nn}</span>
              </span>
            </span>
          ) : null}
        </div>

        <ol className={s.linha}>
          {etapas.map((et, i) => {
            const Icone = ICONE[et.id] ?? Clapperboard;
            const ultima = i === n - 1;
            const espera = ultima && !!prox;
            const status = espera ? `${dia(prox.quando)} · ${hora(prox.quando)}` : ultima && ultimo ? `Último: ep ${String(ultimo.numero).padStart(2, '0')}` : 'Pronto';
            return (
              <li
                key={et.id}
                className={`${s.estacao} ${espera ? s.estacaoEspera : s.estacaoFeita}`}
                style={{ '--i': i } as CSSProperties}
              >
                <span className={s.maquina}>
                  <Icone size={22} strokeWidth={1.6} aria-hidden="true" />
                  <span className={s.led} aria-hidden="true" />
                </span>
                <span className={s.estTexto}>
                  <span className={s.estNome}>{et.nome}</span>
                  <span className={s.estFaz}>{FAZ[et.id] ?? ''}</span>
                  <span className={espera ? s.estStatusEspera : s.estStatus}>{status}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className={s.fila}>
        <h4 className={s.filaTitulo}>Na fila</h4>
        {fila.length === 0 ? (
          <p className={s.filaVazia}>Fila vazia. O próximo roteiro entra aqui e sai às {horario}.</p>
        ) : (
          <ul className={s.filaLista}>
            {fila.map((e) => (
              <li key={e.slug} className={s.filaItem}>
                <Capa url={e.capaUrl} numero={e.numero} titulo={e.titulo} largura={30} />
                <span className={s.filaInfo}>
                  <span className={s.filaNome}>
                    <span className={s.filaEp}>Ep {String(e.numero).padStart(2, '0')}</span> {e.titulo}
                  </span>
                  <span className={s.filaQuando}>
                    {dia(e.quando)} às {hora(e.quando)} · {emQuanto(e.quando, agora)}
                  </span>
                </span>
                <span className={s.filaRedes}>
                  {REDES.filter((r: Rede) => e.redes[r] && e.redes[r]?.status !== 'ausente').map((r) => (
                    <span key={r} className={s.filaRede} title={NOME_REDE[r]} data-rede={r}>
                      <IconeRede rede={r} size={14} />
                      <span className={s.sr}>{NOME_REDE[r]}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
