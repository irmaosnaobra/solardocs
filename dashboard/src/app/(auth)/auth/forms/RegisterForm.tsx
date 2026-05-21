'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import styles from './login.module.css';

const PLAN_LABEL: Record<string, string> = {
  iniciante: 'Iniciante',
  pro: 'PRO',
  ilimitado: 'VIP',
};

function getStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string; cls: string } {
  if (!pw) return { score: 0, label: '', cls: '' };
  let score = 0;
  if (pw.length >= 8) score++;
  if (/\d/.test(pw)) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (score <= 1) return { score: 1, label: 'fraca', cls: styles.strengthLabelWeak };
  if (score === 2) return { score: 2, label: 'média', cls: styles.strengthLabelMid };
  return { score: 3, label: 'forte', cls: styles.strengthLabelStrong };
}

function RegisterContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('session');
  const urlPlano = params.get('plano'); // 'pro' | 'vip' — vindo do landing/VSL pra checkout direto
  // Default agora é FREE (10 docs grátis, só gerador). Stripe só se vier plano explícito.
  const targetPlan: 'pro' | 'vip' | null = urlPlano === 'pro' ? 'pro' : urlPlano === 'vip' ? 'vip' : null;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [accept, setAccept] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [planFromStripe, setPlanFromStripe] = useState<string | null>(null);

  const strength = useMemo(() => getStrength(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;

  useEffect(() => {
    if (!sessionId) return;
    api.get(`/payments/checkout-info/${sessionId}`)
      .then(r => {
        if (r.data.email) setEmail(r.data.email);
        if (r.data.plan) setPlanFromStripe(r.data.plan);
      })
      .catch(() => {});
  }, [sessionId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Preencha e-mail e senha.');
      return;
    }
    if (password.length < 8) {
      setError('A senha precisa de pelo menos 8 caracteres.');
      return;
    }
    if (!/\d/.test(password)) {
      setError('A senha precisa ter pelo menos 1 número.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    if (!accept) {
      setError('É preciso aceitar os termos pra continuar.');
      return;
    }

    setLoading(true);
    try {
      const eventId = crypto.randomUUID();
      const { data } = await api.post('/auth/register', {
        email,
        password,
      }, {
        headers: { 'X-Meta-Event-Id': eventId },
      });
      setToken(data.token);
      setUser(data.user);
      const w = window as unknown as { fbq?: (...a: unknown[]) => void };
      if (w.fbq) {
        w.fbq('track', 'Lead', {}, { eventID: eventId });
        w.fbq('track', 'CompleteRegistration', {}, { eventID: eventId });
      }

      // Quem já pagou (planFromStripe via sessionId) → só ativa, vai pra /empresa.
      if (planFromStripe) {
        router.push('/empresa');
        return;
      }

      // Cadastro com plano explícito (vindo de landing/VIP/PRO direto) → Stripe checkout 7d trial.
      if (targetPlan) {
        try {
          const { data: ck } = await api.post('/payments/create-checkout', { plan: targetPlan });
          if (ck?.url) {
            window.location.href = ck.url;
            return;
          }
          console.error('[Register→Checkout] resposta sem URL:', ck);
        } catch (ckErr) {
          console.error('[Register→Checkout] falha:', ckErr);
        }
        router.push('/empresa?checkout_falhou=1');
        return;
      }

      // Fluxo padrão VSL → cadastro free, vai direto pra empresa (obrigatório antes do gerador).
      router.push('/empresa?welcome=1&plan=free');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Erro ao criar conta. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      {!planFromStripe && (
        <div className={styles.tabs} role="tablist">
          <Link href="/auth?mode=login" className={styles.tab} role="tab" aria-selected="false">
            Entrar
          </Link>
          <Link href="/auth?mode=register" className={`${styles.tab} ${styles.tabActive}`} role="tab" aria-selected="true">
            Cadastrar
          </Link>
        </div>
      )}

      <h1 className={styles.title}>
        {planFromStripe
          ? 'Complete seu cadastro'
          : targetPlan
            ? `Criar conta · Plano ${targetPlan.toUpperCase()}`
            : 'Criar conta grátis'}
      </h1>
      <p className={styles.subtitle}>
        {planFromStripe ? (
          <>Use o mesmo e-mail do pagamento pra ativar seu plano <strong style={{ color: '#0f172a' }}>{PLAN_LABEL[planFromStripe] ?? planFromStripe}</strong>.</>
        ) : targetPlan ? (
          <>Próximo passo: passar o cartão pra liberar o plano <strong style={{ color: '#0f172a' }}>{targetPlan.toUpperCase()}</strong>. <strong style={{ color: '#0f172a' }}>7 dias grátis</strong> · nada é cobrado agora.</>
        ) : (
          <><strong style={{ color: '#0f172a' }}>10 propostas grátis</strong> pra começar — sem cartão, sem cobrança. Cadastre sua empresa e já gera a primeira.</>
        )}
      </p>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-email">E-mail</label>
          <div className={styles.inputGroup}>
            <span className={styles.inputIcon} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
            </span>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className={styles.input}
              readOnly={!!planFromStripe}
              required
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-pw">Senha</label>
          <div className={styles.inputGroup}>
            <span className={styles.inputIcon} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            </span>
            <input
              id="reg-pw"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres + 1 número"
              className={styles.input}
              required
              minLength={8}
            />
            <button
              type="button"
              className={styles.inputToggle}
              onClick={() => setShowPw(s => !s)}
              aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'}
              tabIndex={-1}
            >
              {showPw ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>
          {password && (
            <>
              <div className={styles.strength} aria-hidden>
                <div className={`${styles.strengthBar} ${strength.score >= 1 ? styles.strengthBarActive : ''} ${strength.score === 3 ? styles.strengthBarStrong : ''}`} />
                <div className={`${styles.strengthBar} ${strength.score >= 2 ? styles.strengthBarActive : ''} ${strength.score === 3 ? styles.strengthBarStrong : ''}`} />
                <div className={`${styles.strengthBar} ${strength.score >= 3 ? styles.strengthBarStrong : ''}`} />
              </div>
              <span className={`${styles.strengthLabel} ${strength.cls}`}>
                Força: {strength.label}
              </span>
            </>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-confirm">Confirmar senha</label>
          <div className={styles.inputGroup}>
            <span className={styles.inputIcon} aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
            </span>
            <input
              id="reg-confirm"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repita a senha"
              className={styles.input}
              required
            />
            <button
              type="button"
              className={styles.inputToggle}
              onClick={() => setShowConfirm(s => !s)}
              aria-label={showConfirm ? 'Ocultar senha' : 'Mostrar senha'}
              tabIndex={-1}
            >
              {showConfirm ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
              )}
            </button>
          </div>
          {mismatch && <span className={styles.fieldError}>As senhas não conferem.</span>}
        </div>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={accept}
            onChange={(e) => setAccept(e.target.checked)}
            required
          />
          <span>
            Aceito os <a href="/termos" target="_blank" rel="noopener noreferrer">termos de uso</a>{' '}
            e a <a href="/privacidade" target="_blank" rel="noopener noreferrer">política de privacidade</a>.
          </span>
        </label>

        {error && <div className={styles.formError} role="alert">{error}</div>}

        <button type="submit" className={styles.submit} disabled={loading}>
          {loading
            ? <><span className={styles.spinner} /> Criando sua conta...</>
            : (planFromStripe
                ? `Ativar plano ${PLAN_LABEL[planFromStripe] ?? planFromStripe}`
                : targetPlan
                  ? `Liberar plano ${targetPlan.toUpperCase()} →`
                  : 'Criar conta grátis →')}
        </button>
      </form>

      <p className={styles.footer}>
        Já tem conta?{' '}
        <Link href="/auth?mode=login" className={styles.link}>
          Entrar
        </Link>
      </p>
    </div>
  );
}

export default function RegisterForm() {
  return (
    <Suspense>
      <RegisterContent />
    </Suspense>
  );
}
