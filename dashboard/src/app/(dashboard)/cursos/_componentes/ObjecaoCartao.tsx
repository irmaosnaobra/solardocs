'use client';

// Uma objeção recolhida: mostra só a frase do cliente. Ao tocar, abre o que ele
// quer dizer, a "Fala pronta" e o "No WhatsApp", cada um com "Copiar".
// Serve a lição e as Respostas rápidas (mesmo cartão, mesmo comportamento).

import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronDown } from 'lucide-react';
import styles from '../curso.module.css';
import Destaque from './Destaque';
import type { Objecao } from '../_conteudo/objecoes';

export default function ObjecaoCartao({
  o, grupo, licaoHref, comErro,
}: {
  o: Objecao;
  /** Nome do grupo, mostrado nas Respostas rápidas. */
  grupo?: string;
  /** Leva à lição completa do grupo. */
  licaoHref?: string;
  /** Na lição, mostra também o erro comum. */
  comErro?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const painel = useId();

  return (
    <article className={styles.objCartao}>
      <button
        type="button"
        className={styles.objTopo}
        aria-expanded={aberto}
        aria-controls={painel}
        onClick={() => setAberto((v) => !v)}
      >
        <span className={styles.objFrase}>&ldquo;{o.gatilho}&rdquo;</span>
        <ChevronDown size={20} className={aberto ? `${styles.seta} ${styles.setaAberta}` : styles.seta} aria-hidden="true" />
      </button>

      {aberto && (
        <div id={painel} className={styles.objCorpo}>
          {grupo && <span className={styles.objGrupo}>{grupo}</span>}
          <div className={styles.linha}>
            <span className={styles.rotulo}>O que ele quer dizer</span>
            <p className={styles.texto}>{o.traducao}</p>
          </div>
          {comErro && (
            <div className={styles.linha}>
              <span className={styles.rotuloErro}>Erro comum</span>
              <p className={styles.texto}>{o.erro}</p>
            </div>
          )}
          <Destaque rotulo="Fala pronta" texto={o.script} copiar />
          <Destaque rotulo="No WhatsApp" texto={o.whatsapp} tom="zap" copiar zap />
          {licaoHref && (
            <Link href={licaoHref} className={styles.objLicao}>
              Ver a lição completa <ArrowRight size={15} />
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
