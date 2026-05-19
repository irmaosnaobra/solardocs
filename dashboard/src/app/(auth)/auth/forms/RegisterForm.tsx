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

function maskWhatsapp(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Validação de CNPJ por dígitos verificadores
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
  if (score === 0) return { score: 0, label: 'fraca', cls: styles.strengthLabelWeak };
  if (score === 1) return { score: 1, label: 'fraca', cls: styles.strengthLabelWeak };
  if (score === 2) return { score: 2, label: 'média', cls: styles.strengthLabelMid };
  return { score: 3, label: 'forte', cls: styles.strengthLabelStrong };
}

function RegisterContent() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get('session');
  const urlNome = params.get('nome');
  const urlCargo = params.get('cargo');
  const urlPlano = params.get('plano'); // 'pro' | 'vip' — vindo do landing

  const [nome, setNome] = useState(urlNome ?? '');
  const [cargo] = useState(urlCargo ?? '');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [accept, setAccept] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [planFromStripe, setPlanFromStripe] = useState<string | null>(null);

  const strength = useMemo(() => getStrength(password), [password]);

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

    if (!nome.trim() || !email.trim() || !password) {
      setError('Preencha nome, e-mail e senha.');
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
    if (cnpj && !isValidCnpj(cnpj)) {
      setError('CNPJ inválido. Confere os dígitos.');
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
        nome,
        cargo: cargo || undefined,
        whatsapp: whatsapp.replace(/\D/g, '') || undefined,
        cnpj: cnpj.replace(/\D/g, '') || undefined,
        empresa: empresa.trim() || undefined,
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

      // Veio do landing com plano escolhido → cria checkout com trial 7d e redireciona pro Stripe
      if (urlPlano === 'pro' || urlPlano === 'vip') {
        try {
          const { data: ck } = await api.post('/payments/checkout', { plan: urlPlano });
          if (ck?.url) {
            window.location.href = ck.url;
            return;
          }
          console.error('[Register→Checkout] resposta sem URL:', ck);
        } catch (ckErr) {
          console.error('[Register→Checkout] falha:', ckErr);
        }
        // Falhou checkout: conta criada com sucesso, leva pro app com flag
        router.push('/documentos?tipo=proposta&checkout_falhou=1');
        return;
      }

      router.push('/documentos?tipo=proposta');
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
        {planFromStripe ? 'Complete seu cadastro' : urlPlano ? 'Criar conta · 7 dias grátis' : 'Criar conta grátis'}
      </h1>
      <p className={styles.subtitle}>
        {planFromStripe ? (
          <>Use o mesmo e-mail do pagamento pra ativar seu plano <strong style={{ color: '#0f172a' }}>{PLAN_LABEL[planFromStripe] ?? planFromStripe}</strong>.</>
        ) : urlPlano === 'pro' || urlPlano === 'vip' ? (
          <>Próximo passo: passar o cartão pra liberar o plano <strong style={{ color: '#0f172a' }}>{urlPlano.toUpperCase()}</strong>. Nada é cobrado nos 7 primeiros dias.</>
        ) : (
          'Você ganha 10 documentos vitalícios. Sem cartão de crédito.'
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
            placeholder="Sua Empresa Solar Ltda"
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="reg-cnpj">CNPJ <span style={{ fontWeight: 400, color: '#64748b' }}>(opcional, pode preencher depois)</span></label>
          <input
            id="reg-cnpj"
            type="text"
            inputMode="numeric"
            value={cnpj}
            onChange={(e) => setCnpj(maskCnpj(e.target.value))}
            placeholder="00.000.000/0000-00"
            className={styles.input}
            maxLength={18}
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
                ? 'Ativar meu plano'
                : (urlPlano === 'pro' || urlPlano === 'vip'
                    ? 'Continuar pro cartão →'
                    : 'Criar conta grátis'))}
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
