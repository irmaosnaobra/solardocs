'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import { useLpTracking } from '@/hooks/useLpTracking';
import styles from './Landing.module.css';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

function useReveal() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const els = document.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!els.length) return;

    if (!('IntersectionObserver' in window)) {
      els.forEach(el => el.setAttribute('data-visible', 'true'));
      return;
    }

    const obs = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).setAttribute('data-visible', 'true');
            obs.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 }
    );
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);
}

export default function Landing() {
  const router = useRouter();
  useReveal();
  const { trackEvent } = useLpTracking();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [cargo, setCargo] = useState('');
  const [cnpj, setCnpj] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  // ===== Hero VSL (Vimeo) =====
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type VimeoPlayerLike = any;
  const vslIframeRef = useRef<HTMLIFrameElement>(null);
  const vslPlayerRef = useRef<VimeoPlayerLike>(null);
  const vslDurRef = useRef(0);
  const vslSpeeds = [1, 1.5, 2];
  const [vslShowUnmute, setVslShowUnmute] = useState(true);
  const [vslSpeedIdx, setVslSpeedIdx] = useState(0);
  const [vslProgress, setVslProgress] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const w = window as unknown as { Vimeo?: { Player: new (el: HTMLIFrameElement) => VimeoPlayerLike } };

    const ensureVimeo = () =>
      new Promise<void>((resolve) => {
        if (w.Vimeo) return resolve();
        const existing = document.querySelector<HTMLScriptElement>('script[data-vimeo-player]');
        if (existing) {
          existing.addEventListener('load', () => resolve(), { once: true });
          return;
        }
        const s = document.createElement('script');
        s.src = 'https://player.vimeo.com/api/player.js';
        s.async = true;
        s.dataset.vimeoPlayer = 'true';
        s.onload = () => resolve();
        document.head.appendChild(s);
      });

    ensureVimeo().then(() => {
      if (cancelled || !vslIframeRef.current || !w.Vimeo) return;
      const player: VimeoPlayerLike = new w.Vimeo.Player(vslIframeRef.current);
      vslPlayerRef.current = player;

      player.ready().then(() => {
        player.getDuration().then((d: number) => { vslDurRef.current = d || 0; });
        player.setVolume(0.6);
        player.setMuted(false)
          .then(() => player.play())
          .then(() => setVslShowUnmute(false))
          .catch(() => {
            player.setMuted(true);
            player.play().catch(() => {});
          });

        interval = setInterval(() => {
          player.getCurrentTime().then((cur: number) => {
            const dur = vslDurRef.current;
            if (dur > 0) setVslProgress((cur / dur) * 100);
          }).catch(() => {});
        }, 500);
      });
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  function vslUnmute() {
    const p = vslPlayerRef.current;
    if (!p) return;
    p.setMuted(false)
      .then(() => p.setVolume(0.6))
      .then(() => p.play())
      .catch(() => {});
    setVslShowUnmute(false);
  }

  function vslTogglePlay() {
    const p = vslPlayerRef.current;
    if (!p) return;
    p.getPaused().then((paused: boolean) => (paused ? p.play() : p.pause())).catch(() => {});
  }

  function vslSeek(e: React.MouseEvent<HTMLDivElement>) {
    const p = vslPlayerRef.current;
    const dur = vslDurRef.current;
    if (!p || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    p.setCurrentTime(Math.max(0, Math.min(dur, pct * dur)));
  }

  function vslCycleSpeed() {
    const next = (vslSpeedIdx + 1) % vslSpeeds.length;
    setVslSpeedIdx(next);
    const p = vslPlayerRef.current;
    if (p) p.setPlaybackRate(vslSpeeds[next]).catch(() => {});
  }

  function scrollToFormFrom(plano: 'grátis' | 'pro' | 'vip') {
    trackEvent('cta_click', { label: plano });
    router.push('/auth?mode=register');
  }

  function formatCNPJ(value: string): string {
    const v = value.replace(/\D/g, '').slice(0, 14);
    return v
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }

  function isValidCNPJ(value: string): boolean {
    const c = value.replace(/\D/g, '');
    if (c.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(c)) return false;
    const calcDigit = (slice: string, weights: number[]) => {
      const sum = slice.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
      const rest = sum % 11;
      return rest < 2 ? 0 : 11 - rest;
    };
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [6, ...w1];
    if (calcDigit(c.slice(0, 12), w1) !== Number(c[12])) return false;
    if (calcDigit(c.slice(0, 13), w2) !== Number(c[13])) return false;
    return true;
  }

  function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!nome.trim() || nome.trim().length < 2) {
      setError('Coloca seu nome pra continuar.');
      return;
    }
    if (!cargo) {
      setError('Escolhe seu cargo na empresa.');
      return;
    }
    if (typeof window !== 'undefined' && window.fbq) {
      window.fbq('track', 'Lead', { content_name: 'hero_step1', cargo });
    }
    trackEvent('hero_step1_submit', { cargo });
    setStep(2);
    setTimeout(() => document.getElementById('input-email')?.focus(), 50);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Preencha email e senha.');
      return;
    }
    if (password.length < 6) {
      setError('A senha precisa de pelo menos 6 caracteres.');
      return;
    }
    if (!isValidCNPJ(cnpj)) {
      setError('CNPJ inválido — confere os números.');
      return;
    }
    if (!whatsapp.trim() || whatsapp.replace(/\D/g, '').length < 10) {
      setError('WhatsApp obrigatório (com DDD).');
      return;
    }

    setLoading(true);
    try {
      const eventId = crypto.randomUUID();
      const { data } = await api.post(
        '/auth/register',
        {
          email,
          password,
          nome,
          cargo,
          cnpj: cnpj.replace(/\D/g, ''),
          whatsapp,
        },
        { headers: { 'X-Meta-Event-Id': eventId } }
      );
      setToken(data.token);
      setUser(data.user);
      if (typeof window !== 'undefined' && window.fbq) {
        window.fbq('track', 'CompleteRegistration', {}, { eventID: eventId });
      }
      router.push('/dashboard');
    } catch (err: unknown) {
      const ex = err as { response?: { data?: { error?: string } } };
      setError(ex.response?.data?.error || 'Erro ao criar conta. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }


  return (
    <div className={styles.page}>
      <a href="#cadastro" className={styles.skipLink}>Pular para o cadastro</a>

      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.brand}>
            <span>SolarDoc<span className={styles.brandAccent}>.App</span></span>
          </div>
          <div className={styles.navRight}>
            <a href="/auth?mode=login" className={styles.navLink}>Entrar</a>
            <button onClick={() => scrollToFormFrom('grátis')} className={styles.navCta}>Quero o Gerador com a minha Marca</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className={styles.hero}>
        <div className={styles.aurora} aria-hidden>
          <div className={`${styles.auroraBlob} ${styles.auroraBlob1}`} />
          <div className={`${styles.auroraBlob} ${styles.auroraBlob2}`} />
          <div className={`${styles.auroraBlob} ${styles.auroraBlob3}`} />
        </div>
        <div className={styles.gridPattern} aria-hidden />

        <div className={styles.heroInner}>
          {/* TOP: eyebrow + h1 + lead */}
          <div className={styles.heroTop}>
            <span className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              Pra integrador solar com CNPJ
            </span>
            <h1 className={styles.h1}>
              O documento que vem depois do <strong>aperto de mão.</strong>
            </h1>
            <p className={styles.lead}>
              SolarDoc é o app que <b>fecha a sua venda solar</b>. Contrato, proposta e procuração em
              minutos — com o cliente ali, na sua frente. Sem advogado. Sem Word. Sem terceiros.
            </p>
          </div>

          {/* MEDIA: VSL Vimeo 9:16 */}
          <div className={styles.heroMedia}>
            <div className={styles.vslFrame}>
              <iframe
                ref={vslIframeRef}
                className={styles.vslIframe}
                src="https://player.vimeo.com/video/1192117573?background=1&autoplay=1&muted=1&loop=1&controls=0&playsinline=1&dnt=1"
                allow="autoplay; fullscreen; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                title="SolarDoc Pro - demo"
              />
              <div className={styles.vslOverlay} onClick={vslTogglePlay} />
              {vslShowUnmute && (
                <button type="button" className={styles.vslUnmute} onClick={vslUnmute}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                  Ativar som
                </button>
              )}
              <div className={styles.vslControls}>
                <div className={styles.vslProgress} onClick={vslSeek}>
                  <div className={styles.vslProgressFill} style={{ width: `${vslProgress}%` }} />
                </div>
                <button type="button" className={styles.vslSpeed} onClick={vslCycleSpeed}>
                  {vslSpeeds[vslSpeedIdx]}×
                </button>
              </div>
            </div>
          </div>

          {/* BOTTOM: trust + form */}
          <div className={styles.heroBottom}>
            <div className={styles.trustRow}>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> <b>10 docs grátis</b>
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Sem cartão
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Cancela quando quiser
              </span>
            </div>

            <div className={styles.formCard} ref={formRef} id="cadastro">
              <span className={styles.formBadge}>
                {step === 1 ? '✓ GRÁTIS — 10 DOCUMENTOS' : 'ETAPA 2 DE 2 · QUASE LÁ'}
              </span>
              <div className={styles.formTitle}>
                {step === 1
                  ? 'Comece em 30 segundos'
                  : `Falta pouco${nome ? `, ${nome.split(' ')[0]}` : ''} — agora os dados da empresa`}
              </div>
              <div className={styles.formSub}>
                {step === 1
                  ? 'Diz quem você é. Sem teste vencendo. Use quando precisar.'
                  : 'CNPJ válido + WhatsApp pro suporte. Email e senha pro acesso.'}
              </div>

              {step === 1 ? (
                <form onSubmit={handleStep1}>
                  <div className={styles.formGrid}>
                    <input
                      id="input-nome"
                      type="text"
                      autoComplete="name"
                      placeholder="Seu nome"
                      value={nome}
                      onChange={e => setNome(e.target.value)}
                      required
                    />
                    <select
                      className={styles.formSelect}
                      value={cargo}
                      onChange={e => setCargo(e.target.value)}
                      required
                    >
                      <option value="">Seu cargo na empresa</option>
                      <option value="socio">Sócio / Dono</option>
                      <option value="gestor">Gestor / Diretor</option>
                      <option value="vendedor">Vendedor / Comercial</option>
                      <option value="engenheiro">Engenheiro / Projetista</option>
                      <option value="tecnico">Técnico / Instalador</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>

                  <button type="submit" className={styles.cta}>
                    <span>Continuar →</span>
                  </button>

                  {error && <div className={styles.formError}>{error}</div>}

                  <div className={styles.formFoot}>
                    Próximo passo: CNPJ, email e WhatsApp pra liberar seu Gerador.
                  </div>
                </form>
              ) : (
                <form onSubmit={handleSubmit}>
                  <div className={styles.formGrid}>
                    <input
                      id="input-email"
                      type="email"
                      autoComplete="email"
                      placeholder="Email da empresa"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Senha (mínimo 6 caracteres)"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                    <div className={styles.row2}>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="CNPJ"
                        value={cnpj}
                        onChange={e => setCnpj(formatCNPJ(e.target.value))}
                        maxLength={18}
                        required
                      />
                      <input
                        type="tel"
                        autoComplete="tel"
                        placeholder="WhatsApp"
                        value={whatsapp}
                        onChange={e => setWhatsapp(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <button type="submit" className={styles.cta} disabled={loading}>
                    <span>{loading ? 'Criando sua conta...' : 'Criar conta e gerar meu primeiro contrato'}</span>
                  </button>

                  <button
                    type="button"
                    className={styles.formBack}
                    onClick={() => { setError(''); setStep(1); }}
                  >
                    ← voltar
                  </button>

                  {error && (
                    <div className={styles.formError}>
                      {error}
                      {error.toLowerCase().includes('cadastrado') && (
                        <a href={`/auth?mode=login${email ? `&email=${encodeURIComponent(email)}` : ''}`} className={styles.formErrorLink}>
                          Entrar com essa conta →
                        </a>
                      )}
                    </div>
                  )}

                  <div className={styles.formFoot}>
                    Pronto. Próximo passo: gerar seu primeiro contrato.
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP — concessionárias */}
      <section className={styles.trustStrip}>
        <div className={styles.trustStripInner}>
          <div className={styles.trustStripLabel} data-reveal>
            Procurações <b>aceitas nas principais concessionárias do Brasil</b>
          </div>
          <div className={styles.trustStripList} data-reveal>
            <span className={styles.trustChip}><span className={styles.trustChipDot} /> CEMIG</span>
            <span className={styles.trustChip}><span className={styles.trustChipDot} /> Enel</span>
            <span className={styles.trustChip}><span className={styles.trustChipDot} /> CPFL</span>
            <span className={styles.trustChip}><span className={styles.trustChipDot} /> Equatorial</span>
            <span className={styles.trustChip}><span className={styles.trustChipDot} /> Energisa</span>
            <span className={styles.trustChip}><span className={styles.trustChipDot} /> Light</span>
            <span className={styles.trustChip}><span className={styles.trustChipDot} /> Cosern</span>
            <span className={styles.trustChip}><span className={styles.trustChipDot} /> Coelba</span>
          </div>
        </div>
      </section>

      {/* GERADOR DE PROPOSTA — pain hook (logo após trust strip) */}
      <section className={styles.diffs}>
        <div className={styles.diffsInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Novidade · Gerador de Proposta Personalizado</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Cansado de pagar <strong>caro</strong> em gerador de proposta?<br />
            Tenha o seu — <strong>moderno, com a sua cara</strong>.
          </h2>
          <p className={styles.sectionSub} data-reveal>
            Os geradores especializados cobram <b>R$ 100 a R$ 300 por mês</b> pra te entregar um modelo
            engessado, igual ao do concorrente. Aqui você tem o <b>seu</b> gerador — sua marca, suas cores,
            sua identidade — já incluso no plano.
          </p>

          <div className={styles.diffsGrid} style={{ marginTop: 40 }}>
            <div className={styles.diffCard} data-reveal>
              <div className={styles.diffIcon}>💸</div>
              <div className={styles.diffH}>Sem mensalidade absurda</div>
              <div className={styles.diffP}>
                Pare de pagar <b>centenas de reais por mês</b> só pra ter "uma proposta bonita". No SolarDoc,
                o gerador de proposta vem incluso a partir de <b>R$ 27/mês</b> — o resto fica como bônus.
              </div>
            </div>

            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.diffIcon}>🎨</div>
              <div className={styles.diffH}>Com a sua cara, não a dos outros</div>
              <div className={styles.diffP}>
                Logo, cor da empresa, foto do seu portfólio. O cliente recebe uma proposta <b>com a sua
                identidade visual</b> — não um template genérico que metade do mercado já mandou pra ele.
              </div>
            </div>

            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.diffIcon}>⚡</div>
              <div className={styles.diffH}>Moderno e gerado em segundos</div>
              <div className={styles.diffP}>
                Você preenche kWp, consumo e valor — a IA monta uma proposta <b>visual e moderna</b>, pronta
                pro WhatsApp do cliente. Sem PowerPoint. Sem ficar mexendo em PDF na unha.
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: 40 }} data-reveal>
            <button onClick={() => scrollToFormFrom('grátis')} className={styles.cta} style={{ maxWidth: 360 }}>
              <span>Quero o Gerador com a minha Marca →</span>
            </button>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section className={styles.how}>
        <div className={styles.howInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Como funciona</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Do <strong>aperto de mão</strong> ao contrato assinado<br />
            em 3 minutos.
          </h2>
          <p className={styles.sectionSub} data-reveal>
            Você não precisa instalar nada. Não precisa de advogado. Não precisa sair do telhado.
          </p>

          <div className={styles.howGrid}>
            <div className={styles.howStep} data-reveal>
              <div className={styles.howNum}>01</div>
              <div className={styles.howH}>Cadastra o cliente</div>
              <div className={styles.howP}>
                Nome, CPF/CNPJ, endereço. Em 30 segundos. <b>No celular, ali na visita.</b>
              </div>
            </div>
            <div className={styles.howStep} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.howNum}>02</div>
              <div className={styles.howH}>IA gera o documento</div>
              <div className={styles.howP}>
                Escolhe o tipo (contrato, procuração, proposta…), preenche os dados solares —
                <b> a IA monta o documento</b> com cláusulas técnicas do setor.
              </div>
            </div>
            <div className={styles.howStep} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.howNum}>03</div>
              <div className={styles.howH}>Manda pra assinar</div>
              <div className={styles.howP}>
                WhatsApp ou email. Cliente assina pelo celular dele. <b>Você fecha a venda na hora.</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DIFERENCIAIS */}
      <section className={styles.diffs}>
        <div className={styles.diffsInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Por que SolarDoc</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Não é planilha. Não é Word.<br />
            <strong>É o app que formaliza sua venda solar.</strong>
          </h2>

          <div className={styles.diffsGrid} style={{ marginTop: 40 }}>
            <div className={styles.diffCard} data-reveal>
              <div className={styles.diffIcon}>⚡</div>
              <div className={styles.diffH}>Contrato em 2 minutos</div>
              <div className={styles.diffP}>
                <b>Visita técnica + contrato assinado.</b> Mesmo dia, mesmo lugar. O cliente nem precisa
                voltar pra casa pra decidir — fecha ali, no seu celular.
              </div>
            </div>

            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.diffIcon}>🛡️</div>
              <div className={styles.diffH}>Juridicamente blindado</div>
              <div className={styles.diffP}>
                Cláusulas técnicas do <b>setor solar</b>, validadas por especialistas. Procurações que as
                concessionárias aceitam de primeira. Você não precisa de advogado.
              </div>
            </div>

            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.diffIcon}>📱</div>
              <div className={styles.diffH}>Você no comando</div>
              <div className={styles.diffP}>
                <b>O dono pode operar.</b> Cadastra o cliente, gera o documento, manda no WhatsApp, o cliente assina.
                Não depende de escritório, não depende de terceiro. Sai perfeito.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARATIVO em cards */}
      <section className={styles.compare}>
        <div className={styles.compareInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Por que sair do Word</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Quem fecha 5 vendas/mês usa Word.<br />
            <strong>Quem fecha 15 usa SolarDoc.</strong>
          </h2>

          <div className={styles.compareGrid}>
            <div className={styles.compareCol} data-reveal>
              <div className={styles.compareTitle}>Word / Drive</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Sem foco em documento solar</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Sem cláusulas da concessionária</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> 2 dias por documento</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Sem assinatura digital</li>
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>~</span> Sua marca fica torta</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Não funciona no celular</li>
              </ul>
            </div>

            <div className={styles.compareCol} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.compareTitle}>Plataforma genérica</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Foca em tudo, não em solar</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Você adapta os modelos</li>
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>~</span> Tempo médio</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Tem assinatura digital</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Marca limitada</li>
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>~</span> Funciona razoavelmente no celular</li>
              </ul>
            </div>

            <div className={`${styles.compareCol} ${styles.compareColBest}`} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.compareTitle}>SolarDoc</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> 100% focado em documento solar</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Cláusulas validadas das concessionárias</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Documento pronto em 2 minutos</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Assinatura digital com validade jurídica</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Sua marca, sua cor, seu padrão</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Feito pro celular do integrador</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* DOCS */}
      <section className={styles.docs}>
        <div className={styles.docsInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>5 documentos prontos</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Tudo o que sua empresa solar <strong>precisa pra fechar</strong>.<br />
            Nada do que não precisa.
          </h2>

          <div className={styles.docsGrid}>
            <div className={styles.docCard} data-reveal>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Contrato de Compra e Venda Solar</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.05s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Procuração para Concessionária</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.1s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Prestação de Serviço</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.15s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Contrato Vendedor</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.2s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Proposta para Financiamento Bancário</span>
            </div>
          </div>
        </div>
      </section>

      {/* PROVA SOCIAL */}
      <section className={styles.social}>
        <div className={styles.socialInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Prova de quem usa</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Empresas solares que <strong>pararam de perder venda</strong>.
          </h2>

          <div className={styles.statsGrid}>
            <div className={styles.stat} data-reveal>
              <div className={styles.statN}>2 min</div>
              <div className={styles.statL}>Tempo médio pra gerar um contrato</div>
            </div>
            <div className={styles.stat} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.statN}>5</div>
              <div className={styles.statL}>Tipos de documento prontos</div>
            </div>
            <div className={styles.stat} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.statN}>R$ 0</div>
              <div className={styles.statL}>Pra gerar os 10 primeiros</div>
            </div>
          </div>

          <div className={styles.testimonialsGrid}>
            <article className={styles.igPost} data-reveal>
              <header className={styles.igHeader}>
                <div className={`${styles.igAvatar} ${styles.igAvatarA}`}>
                  <span><span>M</span></span>
                </div>
                <div className={styles.igMeta}>
                  <div className={styles.igName}>marcos.solar.uberlandia</div>
                  <div className={styles.igTime}>2d · Uberlândia/MG</div>
                </div>
                <span className={styles.igDots} aria-hidden>•••</span>
              </header>
              <div className={styles.igBody}>
                gente, só pra contar — fechei <b>7 contratos a mais em 30 dias</b> 🤝 o cliente vê
                o PDF na hora com a logo da minha empresa e já confia. saí do Word e não volto mais 😎
              </div>
              <div className={styles.igActions}>
                <button className={`${styles.igAction} ${styles.igHeart}`} aria-label="curtir">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
                <button className={styles.igAction} aria-label="comentar">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button className={styles.igAction} aria-label="compartilhar">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
              <div className={styles.igLikes}>147 curtidas</div>
            </article>

            <article className={styles.igPost} data-reveal style={{ transitionDelay: '0.1s' }}>
              <header className={styles.igHeader}>
                <div className={`${styles.igAvatar} ${styles.igAvatarB}`}>
                  <span><span>C</span></span>
                </div>
                <div className={styles.igMeta}>
                  <div className={styles.igName}>carla.eng.solar</div>
                  <div className={styles.igTime}>5d · Belo Horizonte/MG</div>
                </div>
                <span className={styles.igDots} aria-hidden>•••</span>
              </header>
              <div className={styles.igBody}>
                amooo demais 🥹 a procuração da CEMIG foi <b>aprovada de primeira</b>! antes
                eu refazia 3 vezes, perdia uma semana toda. pra mim já se pagou o ano só nisso ✨
              </div>
              <div className={styles.igActions}>
                <button className={`${styles.igAction} ${styles.igHeart}`} aria-label="curtir">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
                <button className={styles.igAction} aria-label="comentar">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button className={styles.igAction} aria-label="compartilhar">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
              <div className={styles.igLikes}>89 curtidas</div>
            </article>

            <article className={styles.igPost} data-reveal style={{ transitionDelay: '0.2s' }}>
              <header className={styles.igHeader}>
                <div className={`${styles.igAvatar} ${styles.igAvatarC}`}>
                  <span><span>R</span></span>
                </div>
                <div className={styles.igMeta}>
                  <div className={styles.igName}>roberto.solar.recife</div>
                  <div className={styles.igTime}>1sem · Recife/PE</div>
                </div>
                <span className={styles.igDots} aria-hidden>•••</span>
              </header>
              <div className={styles.igBody}>
                rapaz, eu mesmo faço tudo aqui — sem secretária, sem advogado. <b>contrato sai em 2 minutos</b>
                com a cara da minha empresa e o cliente assina ali no celular. quero ver alguém perder venda
                desse jeito 🚀
              </div>
              <div className={styles.igActions}>
                <button className={`${styles.igAction} ${styles.igHeart}`} aria-label="curtir">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
                <button className={styles.igAction} aria-label="comentar">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </button>
                <button className={styles.igAction} aria-label="compartilhar">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
              <div className={styles.igLikes}>212 curtidas</div>
            </article>
          </div>
        </div>
      </section>

      {/* POSITIONING */}
      <section className={styles.posBlock}>
        <div className={styles.posBlockInner} data-reveal>
          <div className={styles.posCross}>
            <s>Word</s> &nbsp;·&nbsp; <s>Drive</s> &nbsp;·&nbsp; <s>Plataforma cheia de função que você nem usa</s>
          </div>
          <div className={styles.posMain}>
            SolarDoc é <strong>o documento que fecha a venda</strong>.<br />
            E só.
          </div>
        </div>
      </section>

      {/* PLANS */}
      <section className={styles.plans}>
        <div className={styles.plansInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Planos</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            <strong>Comece grátis.</strong> Continue se valer a pena.
          </h2>
          <p className={styles.sectionSub} data-reveal>
            10 documentos sem pagar nada. Quando precisar de mais, escolhe o plano. Sem trial, sem
            cartão antecipado.
          </p>

          <div className={styles.plansGrid}>
            <div className={styles.plan} data-reveal>
              <div className={styles.planName}>Free</div>
              <div className={styles.planPrice}>R$ 0</div>
              <div className={styles.planSub}>10 documentos vitalícios</div>
              <ul className={styles.planList}>
                <li>10 documentos pra usar quando quiser</li>
                <li>Todos os 5 tipos de documento</li>
                <li>Sua marca / sua cor</li>
                <li>Assinatura digital</li>
                <li>Suporte por WhatsApp</li>
              </ul>
              <button onClick={() => scrollToFormFrom('grátis')} className={styles.planBtn}>Quero o Gerador com a minha Marca</button>
            </div>

            <div className={`${styles.plan} ${styles.planFeatured}`} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.planTag}>Mais escolhido</div>
              <div className={styles.planName}>Pro</div>
              <div className={styles.planPrice}>R$ 27<small>/mês</small></div>
              <div className={styles.planSub}>90 documentos por mês</div>
              <ul className={styles.planList}>
                <li>Tudo do Free, e mais:</li>
                <li>90 documentos por mês</li>
                <li>Logo em alta resolução</li>
                <li>Suporte prioritário</li>
                <li>Paga quando quiser, sem teste vencendo</li>
              </ul>
              <button onClick={() => scrollToFormFrom('pro')} className={`${styles.planBtn} ${styles.planBtnPrimary}`}>
                Quero o Gerador com a minha Marca
              </button>
            </div>

            <div className={styles.plan} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.planName}>VIP</div>
              <div className={styles.planPrice}>R$ 67<small>/mês</small></div>
              <div className={styles.planSub}>Documentos ilimitados</div>
              <ul className={styles.planList}>
                <li>Tudo do Pro, e mais:</li>
                <li>Documentos ilimitados</li>
                <li>Mentoria mensal de vendas solares</li>
                <li>Suporte VIP por WhatsApp</li>
                <li>Acesso a novos documentos primeiro</li>
              </ul>
              <button onClick={() => scrollToFormFrom('vip')} className={styles.planBtn}>Quero o Gerador com a minha Marca</button>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.faq}>
        <div className={styles.faqInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Perguntas frequentes</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Tira a dúvida. Depois cadastra.
          </h2>

          <div className={styles.faqList}>
            <details className={styles.faqItem} data-reveal>
              <summary>Preciso pagar pra começar?</summary>
              <div className={styles.faqAnswer}>
                Não. Você cadastra a empresa solar com CNPJ e ganha <b>10 documentos vitalícios</b> sem
                cartão. Use quando precisar — não vence.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Os contratos têm validade jurídica?</summary>
              <div className={styles.faqAnswer}>
                Sim. Os modelos seguem cláusulas técnicas validadas pro setor solar (geração, garantia,
                inadimplência, titularidade). A <b>assinatura digital tem validade jurídica</b> no
                Brasil através do padrão Autentique.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Funciona com qualquer concessionária?</summary>
              <div className={styles.faqAnswer}>
                Sim. As procurações são padronizadas pra serem aceitas pelas principais concessionárias —
                como <b>CEMIG, CPFL, Enel, Light, Energisa, Equatorial</b> e outras.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Posso usar com a marca da minha empresa?</summary>
              <div className={styles.faqAnswer}>
                Sim. Você sobe a logo, define a cor da empresa e os documentos saem com a sua
                identidade visual. <b>A IA preenche, você não precisa formatar nada.</b>
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Cancelo quando quiser?</summary>
              <div className={styles.faqAnswer}>
                Sim. <b>Sem multa, sem fidelidade, sem letra miúda.</b> Você cancela direto na sua conta
                e pronto.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>O dono mesmo consegue usar?</summary>
              <div className={styles.faqAnswer}>
                Esse é exatamente o público pra quem foi feito. Você não precisa de funcionário,
                advogado ou escritório — abre o app, cadastra o cliente, gera o documento e manda.
                <b> Sai perfeito.</b>
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className={styles.finalCta}>
        <div className={styles.finalCtaInner}>
          <h2 className={styles.finalCtaTitle} data-reveal>
            Sua próxima venda solar fecha com<br />
            <strong>o cliente assinando no seu celular.</strong>
          </h2>
          <p className={styles.finalCtaSub} data-reveal>
            10 documentos grátis pra começar. Sem cartão. Sem pegadinha.
          </p>
          <div data-reveal>
            <button className={styles.finalCtaBtn} onClick={() => scrollToFormFrom('grátis')}>
              Quero o Gerador com a minha Marca →
            </button>
            <div className={styles.finalCtaFoot}>
              Continuar usando depois? A partir de R$ 27/mês. Cancela quando quiser.
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <strong>SolarDoc Pro</strong> · Documentação solar com IA · {new Date().getFullYear()}
          </div>
          <div className={styles.footerLinks}>
            <a href="https://wa.me/5534999437831" target="_blank" rel="noopener noreferrer">Suporte WhatsApp</a>
            <a href="/auth?mode=login">Entrar</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
