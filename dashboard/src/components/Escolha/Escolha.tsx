'use client';

import { Check } from 'lucide-react';
import styles from './Escolha.module.css';

/**
 * ESCOLHA — o card de opção padrão da plataforma.
 *
 * Nasceu no Kit Off-Grid e virou padrão porque o chip de texto que a gente usava
 * antes tinha três problemas que só aparecem com o aparelho na mão:
 *
 *   1. alvo de 26px, menor que a ponta de um dedo;
 *   2. estado ligado/desligado só na cor de fundo — de relance, não dá pra saber
 *      onde você está sem comparar tons;
 *   3. nenhum lugar pra dizer o que a escolha SIGNIFICA, que é onde mora a
 *      decisão. "Sombra leve" não diz nada; "perde 8% da geração" decide.
 *
 * Use `Escolhas` como a grade e `Escolha` como o item. Se a opção for uma
 * PRÉ-VISUALIZAÇÃO (uma cor, uma miniatura de modelo), não use isto: o controle
 * ali É a informação, e trocar por ícone + texto joga fora o que ele mostra.
 */

export function Escolhas({
  colunas = 'auto',
  children,
  className = '',
}: {
  /** 2 e 3 mantêm as colunas no celular; 5 vira 3 pra não sobrar órfão. */
  colunas?: 2 | 3 | 4 | 5 | 'auto';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.grade} ${styles['c' + colunas]} ${className}`}>
      {children}
    </div>
  );
}

export function Escolha({
  on,
  onClick,
  icone: Icone,
  titulo,
  desc,
  numero = false,
  disabled = false,
}: {
  on: boolean;
  onClick: () => void;
  /** Ícone do lucide. Cada chamada passa o seu. */
  icone?: React.ComponentType<{ size?: number; className?: string }>;
  titulo: string;
  /** A consequência da escolha, em uma linha. É o que faz decidir. */
  desc?: string;
  /** Número em destaque (dias, quantidade) em vez de rótulo de texto. */
  numero?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={`${styles.opt} ${numero ? styles.num : ''} ${on ? styles.on : ''}`}
    >
      {on && (
        <span className={styles.check}>
          <Check size={11} strokeWidth={3.5} />
        </span>
      )}
      {Icone && !numero && <Icone size={19} className={styles.icone} />}
      <strong>{titulo}</strong>
      {desc && <span>{desc}</span>}
    </button>
  );
}

/**
 * Segmented control — duas ou três abas que trocam o MODO da tela (não o valor
 * de um campo). É o formato que todo app de celular usa pra isso.
 */
export function Abas({ children }: { children: React.ReactNode }) {
  return <div className={styles.seg}>{children}</div>;
}

export function Aba({
  on, onClick, icone: Icone, children,
}: {
  on: boolean;
  onClick: () => void;
  icone?: React.ComponentType<{ size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`${styles.segBtn} ${on ? styles.segOn : ''}`}>
      {Icone && <Icone size={17} />}
      {children}
    </button>
  );
}
