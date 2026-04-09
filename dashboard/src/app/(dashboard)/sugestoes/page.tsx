'use client';

import { useState, useEffect } from 'react';
import api from '@/services/api';
import styles from './sugestoes.module.css';

const VIP_EMAIL = 'agenntaix@gmail.com';

export default function SugestoesPage() {
  const [plano, setPlano] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => {
      setPlano(data.user.plano);
    }).finally(() => setLoading(false));
  }, []);

  function copyEmail() {
    navigator.clipboard.writeText(VIP_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  if (loading) return <div style={{ color: 'var(--color-text-muted)', padding: 32 }}>Carregando...</div>;

  // ── NÃO-VIP ───────────────────────────────────────────────────
  if (plano !== 'ilimitado') {
    return (
      <div className={styles.page}>
        <div className={styles.lockedWrap}>
          <div className={styles.lockedIcon}>💎</div>
          <h1 className={styles.lockedTitle}>Sugestões VIP</h1>
          <p className={styles.lockedSubtitle}>
            Membros VIP podem sugerir novos tipos de documento diretamente para a nossa equipe
            e acompanhar as ideias sendo implementadas na plataforma.
          </p>
          <div className={styles.lockedBenefits}>
            <div className={styles.lockedBenefit}>✦ Sugira documentos personalizados para o seu negócio</div>
            <div className={styles.lockedBenefit}>✦ Envie arquivos e modelos como referência</div>
            <div className={styles.lockedBenefit}>✦ Sugestões aprovadas entram na plataforma para todos</div>
          </div>
          <a
            href="https://wa.me/5534988457399?text=Quero%20assinar%20o%20plano%20VIP%20do%20SolarDoc%20Pro"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.upgradeBtn}
          >
            ⚡ Assinar VIP — R$ 97/mês
          </a>
        </div>
      </div>
    );
  }

  // ── VIP ───────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>💎 Sugestões VIP</h1>
        <p className={styles.subtitle}>
          Quer um novo documento na plataforma? Envie sua ideia diretamente para a nossa equipe.
          As melhores sugestões são implementadas e ficam disponíveis para todos os usuários.
        </p>
      </div>

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>Como enviar sua sugestão</h2>

        <div className={styles.steps}>
          <div className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <div>
              <strong>Copie o e-mail abaixo</strong> e abra no seu cliente de e-mail preferido
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <div>
              <strong>Descreva o documento</strong> que você precisa — nome, finalidade, quais informações deve conter e em quais situações seria usado
            </div>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>3</span>
            <div>
              <strong>Anexe um arquivo de referência</strong> se tiver — pode ser um modelo Word, PDF, contrato existente ou qualquer material que ajude a entender o que você precisa
            </div>
          </div>
        </div>

        <div className={styles.emailBox}>
          <span className={styles.emailAddress}>{VIP_EMAIL}</span>
          <button className={`${styles.copyBtn} ${copied ? styles.copyBtnDone : ''}`} onClick={copyEmail}>
            {copied ? '✓ Copiado!' : 'Copiar'}
          </button>
        </div>

        <div className={styles.tipBox}>
          <p className={styles.tipTitle}>O que pode enviar no anexo</p>
          <ul className={styles.tipList}>
            <li>Modelo de contrato ou documento existente (Word, PDF)</li>
            <li>Foto ou imagem de um contrato impresso</li>
            <li>Rascunho com as cláusulas que você usa</li>
            <li>Qualquer referência do setor solar</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
