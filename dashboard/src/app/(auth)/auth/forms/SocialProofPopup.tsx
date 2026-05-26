'use client';

import { useEffect, useMemo, useState } from 'react';
import api from '@/services/api';
import styles from './socialProof.module.css';

type Lead = {
  numero: number;
  nome: string;
  empresa: string;
  cidade: string;
};

const POOL: Omit<Lead, 'numero'>[] = [
  { nome: 'Marcos',   empresa: 'SolMais Soluções de Energia',  cidade: 'Uberaba, MG' },
  { nome: 'Juliana',  empresa: 'EcoSol Energia Renovável',     cidade: 'Goiânia, GO' },
  { nome: 'Rafael',   empresa: 'Helios Solar Engenharia',      cidade: 'Belo Horizonte, MG' },
  { nome: 'Camila',   empresa: 'Sunrise Energia',              cidade: 'Florianópolis, SC' },
  { nome: 'André',    empresa: 'TopSol Engenharia',            cidade: 'Ribeirão Preto, SP' },
  { nome: 'Patrícia', empresa: 'NovaLuz Solar',                cidade: 'Curitiba, PR' },
  { nome: 'Bruno',    empresa: 'Voltz Energia Solar',          cidade: 'Recife, PE' },
  { nome: 'Fernanda', empresa: 'GreenPower Soluções',          cidade: 'Campinas, SP' },
  { nome: 'Diego',    empresa: 'SolarTech Brasil',             cidade: 'Manaus, AM' },
  { nome: 'Larissa',  empresa: 'EnerSol Engenharia',           cidade: 'Salvador, BA' },
  { nome: 'Thiago',   empresa: 'Sol Pleno Energia',            cidade: 'Brasília, DF' },
  { nome: 'Vinícius', empresa: 'Astra Solar',                  cidade: 'Porto Alegre, RS' },
  { nome: 'Mariana',  empresa: 'Lumus Energia Renovável',      cidade: 'Fortaleza, CE' },
  { nome: 'Eduardo',  empresa: 'Photon Solar',                 cidade: 'São José dos Campos, SP' },
  { nome: 'Renata',   empresa: 'BR Solar Engenharia',          cidade: 'Maringá, PR' },
];

// Criativo prometeu "50 vagas grátis". Lógica:
// - Puxa contador REAL do backend (cadastros últimos 30d).
// - Mapeia esse número pra faixa 45-49 (escassez visível, sem nunca cravar 50).
// - Se real >= 45, começa do real (capado em 49).
// - Se real < 45, começa em 45-47 (parece orgânico).
// - Nomes/empresas continuam fictícios (questão LGPD).
const MIN_NUMBER = 45;
const MAX_NUMBER = 49;
const TOTAL_VAGAS = 50;

function deriveStart(real: number): number {
  if (real >= MAX_NUMBER) return MAX_NUMBER;
  if (real >= MIN_NUMBER) return real;
  return MIN_NUMBER + Math.floor(Math.random() * 3);
}

export default function SocialProofPopup() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const [counter, setCounter] = useState<number | null>(null);

  // Embaralha o pool uma vez por sessão pra ordem variar entre acessos.
  const leads: Lead[] = useMemo(() => {
    const shuffled = [...POOL].sort(() => Math.random() - 0.5);
    return shuffled.map((p, i) => ({ ...p, numero: MIN_NUMBER + i }));
  }, []);

  // Busca contador real uma vez na montagem.
  useEffect(() => {
    let cancelled = false;
    api.get<{ count: number }>('/auth/recent-signups')
      .then(r => {
        if (cancelled) return;
        setCounter(deriveStart(r.data?.count ?? 0));
      })
      .catch(() => {
        // Fallback: assume faixa orgânica se a API falhar.
        if (cancelled) return;
        setCounter(deriveStart(0));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (counter === null) return;
    // Primeiro popup 6s depois do contador chegar — dá tempo do usuário começar a preencher.
    const first = setTimeout(() => {
      setVisible(true);
    }, 6000);
    return () => clearTimeout(first);
  }, [counter]);

  useEffect(() => {
    if (!visible) return;

    // Cada popup fica visível ~7s, depois some por 9s e o próximo aparece.
    const hide = setTimeout(() => {
      setVisible(false);
    }, 7000);

    const next = setTimeout(() => {
      setIdx(i => (i + 1) % leads.length);
      setCounter(c => {
        if (c === null) return c;
        // Mantém na faixa quente 47-49. Quando atinge 49, ocasionalmente
        // recua 1-2 (alguém "desistiu") pra justificar continuar aparecendo
        // novo cadastro sem nunca cravar 50.
        if (c >= MAX_NUMBER) return MAX_NUMBER - 1 - Math.floor(Math.random() * 2);
        return c + 1;
      });
      setVisible(true);
    }, 16000);

    return () => {
      clearTimeout(hide);
      clearTimeout(next);
    };
  }, [visible, idx, leads.length]);

  if (counter === null) return null;

  const current = leads[idx];
  const restantes = Math.max(TOTAL_VAGAS - counter, 1);

  return (
    <div
      className={`${styles.popup} ${visible ? styles.popupVisible : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className={styles.iconWrap} aria-hidden>
        <span className={styles.pulse} />
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5"/>
        </svg>
      </div>
      <div className={styles.content}>
        <div className={styles.line1}>
          <strong>Cadastro #{counter}</strong>
          <span className={styles.dot} aria-hidden>·</span>
          <span className={styles.fresh}>agora há pouco</span>
        </div>
        <div className={styles.line2}>
          {current.nome} — <strong>{current.empresa}</strong>
        </div>
        <div className={styles.line3}>
          {current.cidade} · restam <strong>{restantes} vagas grátis</strong>
        </div>
      </div>
    </div>
  );
}
