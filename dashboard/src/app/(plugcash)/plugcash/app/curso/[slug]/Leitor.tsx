'use client';

import { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Pagina } from '@/services/plugcash';
import styles from '../../../pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// LEITOR DA AULA ILUSTRADA
//
// O formato que não depende de câmera. Para conteúdo técnico — o padrão de
// entrada, as quatro saídas quando a carga não dá, o vaivém do protocolo — um
// esquema ensina mais que vinte minutos de alguém falando na frente da câmera.
//
// Regra da página: UMA ideia. Se precisou de três parágrafos, virou duas
// páginas. O diagrama é o centro, não um adorno ao lado do texto.
//
// O progresso é a posição na sequência: `pct` significa "onde eu parei" tanto
// aqui quanto no vídeo, e por isso não existe segundo contador. A gravação
// acontece na TROCA de página, nunca no render — senão cada re-render viraria
// uma escrita.
// ─────────────────────────────────────────────────────────────────────────────

export function Leitor({
  paginas, aulaId, onPct, ofertaFinal,
}: {
  paginas: Pagina[];
  aulaId: string;
  onPct: (pct: number) => void;
  /** Entra como ÚLTIMA página. Ao lado da página 1 a dor ainda não existe. */
  ofertaFinal?: React.ReactNode;
}) {
  const total = paginas.length + (ofertaFinal ? 1 : 0);
  const [i, setI] = useState(0);
  const [maisLonge, setMaisLonge] = useState(0);

  // Aula nova recomeça do zero. Sem isto, abrir a aula 3 depois de ler a 2 até
  // o fim mostraria a aula 3 já na última página.
  const [ultimaAula, setUltimaAula] = useState(aulaId);
  if (aulaId !== ultimaAula) { setUltimaAula(aulaId); setI(0); setMaisLonge(0); }

  const ir = useCallback((destino: number) => {
    const n = Math.max(0, Math.min(total - 1, destino));
    if (n === i) return;
    setI(n);
    setMaisLonge((m) => Math.max(m, n));
    // Escrita só aqui: uma por virada de página, não uma por render.
    onPct(Math.round(((n + 1) / total) * 100));
  }, [i, total, onPct]);

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') ir(i + 1);
      if (e.key === 'ArrowLeft') ir(i - 1);
    }
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [i, ir]);

  const naOferta = ofertaFinal && i === paginas.length;
  const p = naOferta ? null : paginas[i];

  return (
    <div className={styles.leitor}>
      <div className={styles.leitorBarra}>
        <div className={styles.leitorBarraFill} style={{ width: `${((i + 1) / total) * 100}%` }} />
      </div>

      <div className={styles.leitorPalco}>
        {naOferta ? ofertaFinal : p && (
          <>
            <p className={styles.leitorNum}>Página {i + 1} de {total}</p>
            <h2 className={styles.leitorTitulo}>{p.titulo}</h2>

            {p.svg && (
              <>
                {/* O SVG é escrito pelo admin e validado na gravação: a API
                    recusa diagrama com script ou atributo de evento. Por isso
                    aqui ele entra direto, sem sanitizar de novo. */}
                <div className={styles.leitorDiagrama}
                     dangerouslySetInnerHTML={{ __html: p.svg }} />
                {p.legenda && <p className={styles.leitorLegenda}>{p.legenda}</p>}
              </>
            )}

            {p.texto && <p className={styles.leitorTexto}>{p.texto}</p>}

            {!!p.lista?.length && (
              <ul className={styles.leitorLista}>
                {p.lista.map((item, k) => <li key={k}>{item}</li>)}
              </ul>
            )}

            {p.destaque && <p className={styles.leitorDestaque}>{p.destaque}</p>}
          </>
        )}
      </div>

      <div className={styles.leitorPe}>
        <button
          className={`${styles.btn} ${styles.btnFantasma}`}
          style={{ padding: '9px 14px', fontSize: 14 }}
          onClick={() => ir(i - 1)}
          disabled={i === 0}
        >
          <ChevronLeft size={16} strokeWidth={2} /> Anterior
        </button>

        <div className={styles.leitorPontos}>
          {Array.from({ length: total }, (_, k) => (
            <button
              key={k}
              className={`${styles.leitorPonto} ${
                k === i ? styles.leitorPontoAtivo : k <= maisLonge ? styles.leitorPontoVisto : ''}`}
              onClick={() => ir(k)}
              aria-label={`Página ${k + 1}`}
              aria-current={k === i ? 'true' : undefined}
            />
          ))}
        </div>

        <span className={styles.leitorContagem}>{i + 1} / {total}</span>

        <button
          className={`${styles.btn} ${styles.btnPrimario}`}
          style={{ padding: '9px 14px', fontSize: 14 }}
          onClick={() => ir(i + 1)}
          disabled={i === total - 1}
        >
          Próxima <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
