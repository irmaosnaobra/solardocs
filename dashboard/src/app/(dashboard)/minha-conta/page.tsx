'use client';

import { useState } from 'react';
import { useDashboard } from '@/contexts/DashboardContext';
import api from '@/services/api';
import styles from './minha-conta.module.css';

const PLAN_LABEL: Record<string, string> = {
  free: 'Gratuito',
  pro: 'PRO',
  ilimitado: 'VIP',
};

export default function MinhaContaPage() {
  const { user, setUser, openUpgrade } = useDashboard();

  // perfil
  const [nome, setNome] = useState(user?.nome ?? '');
  const [savingNome, setSavingNome] = useState(false);
  const [nomeMsg, setNomeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // senha
  const [curPass, setCurPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [savingPass, setSavingPass] = useState(false);
  const [passMsg, setPassMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // assinatura
  const [openingPortal, setOpeningPortal] = useState(false);

  if (!user) return null;

  async function salvarNome() {
    setSavingNome(true);
    setNomeMsg(null);
    try {
      const { data } = await api.patch('/auth/profile', { nome });
      setUser(data.user);
      setNomeMsg({ ok: true, text: 'Nome atualizado!' });
    } catch (err: any) {
      setNomeMsg({ ok: false, text: err?.response?.data?.error ?? 'Erro ao salvar' });
    } finally {
      setSavingNome(false);
    }
  }

  async function salvarSenha() {
    setPassMsg(null);
    if (newPass !== confirmPass) {
      setPassMsg({ ok: false, text: 'A confirmação não bate com a nova senha' });
      return;
    }
    if (newPass.length < 6) {
      setPassMsg({ ok: false, text: 'A nova senha deve ter ao menos 6 caracteres' });
      return;
    }
    setSavingPass(true);
    try {
      const { data } = await api.patch('/auth/password', { currentPassword: curPass, newPassword: newPass });
      setPassMsg({ ok: true, text: data.message ?? 'Senha alterada!' });
      setCurPass(''); setNewPass(''); setConfirmPass('');
    } catch (err: any) {
      setPassMsg({ ok: false, text: err?.response?.data?.error ?? 'Erro ao alterar senha' });
    } finally {
      setSavingPass(false);
    }
  }

  async function gerenciarAssinatura() {
    setOpeningPortal(true);
    try {
      const { data } = await api.post('/payments/billing-portal');
      window.location.href = data.url;
    } catch {
      alert('Não foi possível abrir o portal de pagamento. Tente novamente ou fale no WhatsApp (34) 99943-7831.');
      setOpeningPortal(false);
    }
  }

  const isFree = user.plano === 'free';
  const docsUsados = user.documentos_usados ?? 0;
  const limite = user.limite_documentos ?? 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Minha conta</h1>
      <p className={styles.subtitle}>Gerencie seu perfil, senha e assinatura</p>

      {/* Perfil */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Perfil</h2>
        <label className={styles.label}>Nome</label>
        <input className={styles.input} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" />
        <label className={styles.label}>E-mail (login)</label>
        <input className={styles.input} value={user.email} disabled title="O e-mail de login não pode ser alterado por aqui" />
        <div className={styles.row}>
          <button className={styles.btnPrimary} onClick={salvarNome} disabled={savingNome || nome === user.nome}>
            {savingNome ? 'Salvando...' : 'Salvar nome'}
          </button>
          {nomeMsg && <span className={nomeMsg.ok ? styles.ok : styles.err}>{nomeMsg.text}</span>}
        </div>
      </section>

      {/* Senha */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Trocar senha</h2>
        <label className={styles.label}>Senha atual</label>
        <input className={styles.input} type="password" value={curPass} onChange={(e) => setCurPass(e.target.value)} autoComplete="current-password" />
        <label className={styles.label}>Nova senha</label>
        <input className={styles.input} type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="new-password" />
        <label className={styles.label}>Confirmar nova senha</label>
        <input className={styles.input} type="password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} autoComplete="new-password" />
        <div className={styles.row}>
          <button className={styles.btnPrimary} onClick={salvarSenha} disabled={savingPass || !curPass || !newPass}>
            {savingPass ? 'Alterando...' : 'Alterar senha'}
          </button>
          {passMsg && <span className={passMsg.ok ? styles.ok : styles.err}>{passMsg.text}</span>}
        </div>
      </section>

      {/* Plano / assinatura */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Plano e assinatura</h2>
        <div className={styles.planRow}>
          <div>
            <div className={styles.planName}>Plano {PLAN_LABEL[user.plano] ?? user.plano}</div>
            <div className={styles.planUsage}>
              {isFree
                ? `${docsUsados} de ${limite} documentos usados este mês`
                : user.plano === 'ilimitado' || limite >= 999999
                  ? 'Documentos ilimitados'
                  : `${docsUsados} de ${limite} documentos este mês`}
            </div>
          </div>
        </div>
        <div className={styles.row}>
          {isFree ? (
            <button className={styles.btnPrimary} onClick={openUpgrade}>Ver planos</button>
          ) : (
            <button className={styles.btnSecondary} onClick={gerenciarAssinatura} disabled={openingPortal}>
              {openingPortal ? 'Abrindo...' : 'Gerenciar assinatura'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
