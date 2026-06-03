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
  const urlEmail = params.get('email');  // pré-preenche (ex: vindo do Pack Solar /obrigado). NÃO trava — não é verificado.
  const refOrigem = params.get('ref');   // 'pack-solar' etc — origem pra atribuição
  // Default agora é FREE. Stripe só se vier plano explícito.
  // IMPORTANTE: com sessionId a pessoa JÁ pagou (veio do success_url). Nesse caso
  // o plano da URL é só fallback de exibição — NÃO pode disparar novo checkout
  // (senão um pagante seria mandado pra um 2º cartão). targetPlan só vale SEM session.
  const targetPlan: 'pro' | 'vip' | null = sessionId
    ? null
    : urlPlano === 'pro' ? 'pro' : urlPlano === 'vip' ? 'vip' : null;
  // Plano vindo da URL pós-pagamento (fallback de exibição quando checkout-info falha).
  const urlPlanFromCheckout: string | null = sessionId
    ? (urlPlano === 'vip' ? 'ilimitado' : urlPlano === 'pro' ? 'pro' : null)
    : null;
  // Cadastro pós-pago: veio do success_url do Stripe (sessionId presente). A pessoa
  // JÁ passou o cartão → form mínimo (só email + senha), entra na plataforma na hora.
  // WhatsApp/CNPJ ficam pra depois (/empresa). Usamos sessionId — não planFromStripe —
  // porque o gatilho precisa valer ANTES do checkout-info responder (e mesmo se falhar).
  const isPaidCheckout = !!sessionId;

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
  // checkout-info não respondeu: mostra aviso pra usar o MESMO email do cartão.
  const [checkoutInfoFailed, setCheckoutInfoFailed] = useState(false);

  // Pré-preenche email vindo da query (ex: link do Pack Solar). Só quando NÃO
  // veio de session (session é autoritativo e trava o campo). Não trava aqui.
  useEffect(() => {
    if (sessionId) return;
    if (urlEmail && /\S+@\S+\.\S+/.test(urlEmail)) setEmail(urlEmail);
  }, [sessionId, urlEmail]);

  useEffect(() => {
    if (!sessionId) return;
    api.get(`/payments/checkout-info/${sessionId}`)
      .then(r => {
        if (r.data.email) { setEmail(r.data.email); setEmailLocked(true); }
        if (r.data.plan) setPlanFromStripe(r.data.plan);
      })
      .catch(() => {
        // checkout-info falhou (rede/sessão). NÃO engolir o erro: a pessoa veio
        // do success_url (já pagou). Usa o plano da URL como fallback pra não cair
        // na tela enganosa de "criar conta grátis". NÃO travamos o email aqui
        // (ficaria vazio e bloqueado) — o backend valida o email contra a session.
        if (urlPlanFromCheckout) setPlanFromStripe(urlPlanFromCheckout);
        setCheckoutInfoFailed(true);
      });
  }, [sessionId, urlPlanFromCheckout]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const waDigits = whatsapp.replace(/\D/g, '');

    if (isPaidCheckout) {
      // Pós-pago: só email + senha. Nome/WhatsApp/CNPJ opcionais (preenche depois).
      if (!email.trim() || !password) {
        setError('Preencha e-mail e senha.');
        return;
      }
      // Se a pessoa optou por preencher o WhatsApp, valida o que digitou.
      if (waDigits && (waDigits.length < 10 || waDigits.length > 11)) {
        setError('WhatsApp com DDD (10 ou 11 dígitos), ou deixe em branco.');
        return;
      }
    } else {
      // Fluxo free orgânico: nome + WhatsApp + CNPJ obrigatórios.
      if (!nome.trim() || !email.trim() || !password) {
        setError('Preencha nome, e-mail e senha.');
        return;
      }
      if (waDigits.length < 10 || waDigits.length > 11) {
        setError('Informe o WhatsApp com DDD (10 ou 11 dígitos).');
        return;
      }
      if (!isValidCnpj(cnpj)) {
        setError('CNPJ inválido. Confere os dígitos.');
        return;
      }
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
      const cnpjDigits = cnpj.replace(/\D/g, '');
      const { data } = await api.post('/auth/register', {
        email,
        password,
        nome: nome.trim() || undefined,
        whatsapp: waDigits || undefined,
        cnpj: cnpjDigits || undefined,
        empresa: empresa.trim() || undefined,
        fromCheckout: !!sessionId, // veio do Stripe → backend exige plano detectado
        session: sessionId || undefined, // matching autoritativo (plano vem da session, não do email)
        origem: refOrigem || undefined,  // 'pack-solar' etc — atribuição de origem
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

      // Quem já pagou → entra DIRETO na plataforma (soft-landing /documentos, banner
      // sugere cadastrar empresa sem obrigar). NÃO manda pra /empresa: re-muraria com
      // o CNPJ que acabamos de tirar do form. Gatilho é isPaidCheckout (sessionId),
      // não planFromStripe — assim funciona mesmo se o checkout-info tiver falhado.
      if (isPaidCheckout) {
        router.push('/documentos?welcome=1');
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
      if (code === 'EMAIL_DIFERENTE_DO_PAGAMENTO') {
        setError('Esse e-mail é diferente do usado no pagamento. Cadastre com o mesmo e-mail do cartão pra liberar seu plano.');
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
      {!isPaidCheckout && (
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
        {isPaidCheckout
          ? 'Pagamento aprovado — defina sua senha'
          : targetPlan
            ? `Criar conta · Plano ${targetPlan.toUpperCase()}`
            : 'Criar conta grátis'}
      </h1>
      <p className={styles.subtitle}>
        {isPaidCheckout ? (
          // Plano a exibir: do checkout-info, com fallback no plano da URL (caso a
          // chamada tenha falhado) — nunca cai no framing "grátis" pra quem pagou.
          (() => {
            const shownPlan = planFromStripe ?? urlPlanFromCheckout;
            const planTxt = shownPlan ? (PLAN_LABEL[shownPlan] ?? shownPlan) : null;
            return (
              <>Seus <strong style={{ color: '#0f172a' }}>7 dias grátis</strong>{planTxt ? <> do plano <strong style={{ color: '#0f172a' }}>{planTxt}</strong></> : null} já estão ativos. Defina sua senha pra entrar na plataforma.</>
            );
          })()
        ) : targetPlan ? (
          <>Próximo passo: passar o cartão pra liberar o plano <strong style={{ color: '#0f172a' }}>{targetPlan.toUpperCase()}</strong>. <strong style={{ color: '#0f172a' }}>7 dias grátis</strong> · nada é cobrado agora.</>
        ) : (
          <><strong style={{ color: '#0f172a' }}>10 propostas grátis</strong> pra começar — sem cartão, sem cobrança.</>
        )}
      </p>

      <form onSubmit={handleSubmit} className={styles.form} noValidate>
        {!isPaidCheckout && (
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
        )}

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
          {checkoutInfoFailed && !emailLocked && (
            <span className={styles.fieldError}>
              Use o <strong>mesmo e-mail do cartão</strong> pra liberar seu plano.
            </span>
          )}
        </div>

        {!isPaidCheckout && (
          <>
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
          </>
        )}

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
            ? <><span className={styles.spinner} /> {isPaidCheckout ? 'Entrando...' : 'Criando sua conta...'}</>
            : (isPaidCheckout
                ? 'Ativar e entrar →'
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

      {!isPaidCheckout && !targetPlan && <SocialProofPopup />}
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
