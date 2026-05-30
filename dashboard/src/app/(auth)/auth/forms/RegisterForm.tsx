'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import styles from './login.module.css';
import SocialProofPopup from './SocialProofPopup';

const PLAN_LABEL: Record<string, string> = {
  iniciante: 'Iniciante',
  pro: 'PRO',
  ilimitado: 'VIP',
};

// Máscara (XX) XXXXX-XXXX. WhatsApp BR sempre 11 dígitos (DDD + 9 dígitos).
function maskWhatsapp(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// Máscara XX.XXX.XXX/XXXX-XX. CNPJ sempre 14 dígitos.
function maskCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Valida dígitos verificadores do CNPJ.
function isValidCnpj(cnpjMasked: string): boolean {
  const cnpj = cnpjMasked.replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const calc = (slice: string, weights: number[]) => {
    const sum = slice.split('').reduce((acc, n, i) => acc + Number(n) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(cnpj.slice(0, 12), w1) === Number(cnpj[12])
      && calc(cnpj.slice(0, 13), w2) === Number(cnpj[13]);
}

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
  // Default agora é FREE. Stripe só se vier plano explícito.
  const targetPlan: 'pro' | 'vip' | null = urlPlano === 'pro' ? 'pro' : urlPlano === 'vip' ? 'vip' : null;

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [empresa, setEmpresa] = useState('');
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

  // Email travado quando veio do Stripe (não deixa pagar como A e cadastrar como B).
  const [emailLocked, setEmailLocked] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    api.get(`/payments/checkout-info/${sessionId}`)
      .then(r => {
        if (r.data.email) { setEmail(r.data.email); setEmailLocked(true); }
        if (r.data.plan) setPlanFromStripe(r.data.plan);
      })
      .catch(() => {});
  }, [sessionId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!nome.trim() || !email.trim() || !password) {
      setError('Preencha nome, e-mail e senha.');
      return;
    }
    const waDigits = whatsapp.replace(/\D/g, '');
    if (waDigits.length < 10 || waDigits.length > 11) {
      setError('Informe o WhatsApp com DDD (10 ou 11 dígitos).');
      return;
    }
    if (!isValidCnpj(cnpj)) {
      setError('CNPJ inválido. Confere os dígitos.');
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
        nome: nome.trim(),
        whatsapp: waDigits,
        cnpj: cnpj.replace(/\D/g, ''),
        empresa: empresa.trim() || undefined,
        fromCheckout: !!sessionId, // veio do Stripe → backend exige plano detectado
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

      // Cadastro com plano explícito → Stripe checkout 7d trial.
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

      // Cadastro free com CNPJ já preenchido — backend criou a company,
      // pode ir direto pro gerador.
      router.push('/documentos?tipo=proposta&welcome=1');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; planoAtivado?: string } } };
      const code = e.response?.data?.error;
      // Pós-Stripe com email que já tinha conta: o backend ativou o plano na
      // conta existente. Manda fazer login (não recria, não reseta senha).
      if (code === 'JA_TEM_CONTA_PLANO_ATIVADO') {
        const plano = e.response?.data?.planoAtivado;
        router.push(`/auth?mode=login&plano_ativado=${plano ?? '1'}`);
        return;
      }
      if (code === 'Email já cadastrado') {
        setError('Esse email já tem conta. Faça login pra continuar.');
        setLoading(false);
        return;
      }
      if (code === 'PAGAMENTO_NAO_DETECTADO') {
        setError('Não localizamos seu pagamento. Use o mesmo e-mail do cartão, ou fale com o suporte no WhatsApp (34) 99943-7831.');
        setLoading(false);
        return;
      }
      setError(code || 'Erro ao criar conta. Tenta de novo.');
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
          <><strong style={{ color: '#0f172a' }}>10 propostas grátis</strong> pra começar — sem cartão, sem cobrança.</>
        )}
      </p>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-nome">Nome completo</label>
          <input
            id="reg-nome"
            type="text"
            autoComplete="name"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Seu nome"
            className={styles.input}
            required
          />
        </div>

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
              readOnly={!!planFromStripe || emailLocked}
              required
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-whatsapp">WhatsApp</label>
          <input
            id="reg-whatsapp"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(maskWhatsapp(e.target.value))}
            placeholder="(00) 00000-0000"
            className={styles.input}
            maxLength={15}
            required
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-empresa">Nome da empresa</label>
          <input
            id="reg-empresa"
            type="text"
            autoComplete="organization"
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            placeholder="Sua Empresa Solar Ltda (opcional)"
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-cnpj">CNPJ</label>
          <input
            id="reg-cnpj"
            type="text"
            inputMode="numeric"
            value={cnpj}
            onChange={(e) => setCnpj(maskCnpj(e.target.value))}
            placeholder="00.000.000/0000-00"
            className={styles.input}
            maxLength={18}
            required
          />
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

      {!planFromStripe && !targetPlan && <SocialProofPopup />}
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
