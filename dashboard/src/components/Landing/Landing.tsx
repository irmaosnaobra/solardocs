'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLpTracking, getCheckoutAttribution } from '@/hooks/useLpTracking';
import api from '@/services/api';
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

// Preços mensais (R$).
const PRICES = {
  pro: 27,
  vip: 67,
} as const;

// Segundo em que liberamos o scroll da LP (mantém usuário focado no vídeo).
const UNLOCK_AT_SECONDS = 153; // 02:33

export default function Landing() {
  const router = useRouter();
  useReveal();
  const { trackEvent } = useLpTracking();
  const [scrollLocked, setScrollLocked] = useState(true);

  // Trava o scroll da LP até o vídeo Panda passar de 02:10. Player Panda emite
  // postMessage com { message: 'panda_timeupdate', currentTime } — escutamos isso
  // e liberamos overflow do body assim que o tempo cruza o threshold.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const prevOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    function unlock() {
      document.body.style.overflow = prevOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      setScrollLocked(false);
    }

    function onMessage(ev: MessageEvent) {
      const data = ev.data as { message?: string; currentTime?: number } | null;
      if (!data || typeof data !== 'object') return;
      if (data.message !== 'panda_timeupdate') return;
      if (typeof data.currentTime !== 'number') return;

      if (data.currentTime >= UNLOCK_AT_SECONDS) {
        unlock();
        window.removeEventListener('message', onMessage);
      }
    }

    window.addEventListener('message', onMessage);

    return () => {
      window.removeEventListener('message', onMessage);
      document.body.style.overflow = prevOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, []);

  // Tracking de seção: dispara 'section' { section: 'precos' } quando o bloco de planos
  // entra na viewport. Usado pelo /admin (LP SolarDoc) pra calcular "Viu Seção Preços".
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = document.getElementById('planos');
    if (!el || !('IntersectionObserver' in window)) return;
    let sent = false;
    const obs = new IntersectionObserver(
      (entries) => {
        if (sent) return;
        if (entries.some(e => e.isIntersecting)) {
          sent = true;
          trackEvent('section', { section: 'precos' });
          obs.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [trackEvent]);

  function scrollToPlans() {
    trackEvent('cta_click', { label: 'grátis' });
    if (typeof window !== 'undefined' && window.fbq) {
      window.fbq('track', 'ViewContent', { content_name: 'plans_section' });
    }
    document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const [checkoutLoading, setCheckoutLoading] = useState<'pro' | 'vip' | null>(null);

  // Fluxo LP → Stripe → Cadastro: clica no plano e vai DIRETO pro checkout
  // público do Stripe (email + cartão, 7 dias grátis). Só depois de aprovar
  // o cartão a pessoa cria a conta. Sem free.
  async function goToRegister(plano: 'pro' | 'vip') {
    trackEvent('cta_click', { label: plano });
    if (typeof window !== 'undefined' && window.fbq) {
      window.fbq('track', 'InitiateCheckout', { content_name: plano });
    }
    setCheckoutLoading(plano);
    try {
      // Atribuição: manda o session_id da LP + UTMs (de sessionStorage) junto.
      // O backend grava no metadata do Stripe → receita atribuída à campanha.
      const { data } = await api.post('/payments/public-checkout', {
        plan: plano,
        ...getCheckoutAttribution(),
      });
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      console.error('[LP→Checkout] resposta sem URL:', data);
    } catch (err) {
      console.error('[LP→Checkout] falha:', err);
    }
    // Fallback: se o checkout falhar, cai no cadastro com o plano (fluxo antigo).
    // Preserva os UTMs na URL pra atribuição não evaporar se o público falhar.
    setCheckoutLoading(null);
    const attr = getCheckoutAttribution();
    const qs = new URLSearchParams({ mode: 'register', plano });
    for (const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
      if (attr[k]) qs.set(k, attr[k]);
    }
    router.push(`/auth?${qs.toString()}`);
  }

  return (
    <div className={styles.page}>
      {/* Backdrop preto enquanto travado — cobre tudo atrás do vídeo fixo */}
      {scrollLocked && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9998,
            background: '#000',
          }}
          aria-hidden
        />
      )}

      {/*
        Wrapper do vídeo — FORA do hero. Tem que ser sibling direto de .page
        porque .heroTop tem `animation: fadeUp` com transform, e qualquer
        ancestor com transform vira containing block, prendendo o
        position:fixed dentro do hero (gera tela preta atrás do backdrop).
        Estrutura DOM idêntica entre estados — só estilos inline mudam,
        então o <iframe> nunca remonta e o vídeo continua tocando.
      */}
      <div
        style={{
          position: scrollLocked ? 'fixed' : 'relative',
          inset: scrollLocked ? 0 : undefined,
          zIndex: scrollLocked ? 9999 : undefined,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: scrollLocked ? 'clamp(8px, 3vw, 32px)' : '24px 16px',
          margin: 0,
          width: '100%',
        }}
      >
        <div
          className={scrollLocked ? 'video-locked' : 'video-unlocked'}
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: scrollLocked
              ? 'min(1280px, calc((100vh - 64px) * 16 / 9))'
              : 880,
            aspectRatio: '16 / 9',
            borderRadius: scrollLocked ? 12 : 16,
            overflow: 'hidden',
            background: '#000',
            boxShadow: scrollLocked
              ? '0 40px 100px rgba(251,191,36,0.18)'
              : '0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(251,191,36,0.25)',
          }}
        >
          <iframe
            id="panda-b16175a4-f30e-401f-acf6-4aa78891477e"
            src="https://player-vz-380ec774-9b3.tv.pandavideo.com.br/embed/?v=b16175a4-f30e-401f-acf6-4aa78891477e"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            allow="accelerometer;gyroscope;autoplay;encrypted-media;picture-in-picture"
            allowFullScreen
            title="SolarDoc — apresentação"
          />
        </div>
      </div>

      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media (max-width: 768px) {
              .video-locked {
                aspect-ratio: auto !important;
                width: 100% !important;
                max-width: 100% !important;
                height: 70vh !important;
              }
            }
          `,
        }}
      />

      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.brand}>
            <span>SolarDoc<span className={styles.brandAccent}>.App</span></span>
          </div>
          <div className={styles.navRight}>
            <button onClick={scrollToPlans} className={styles.navCta}>Testar 7 dias grátis</button>
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
          <div className={styles.heroTop} style={{ textAlign: 'center' }}>
            <span className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              Pra integrador solar com CNPJ
            </span>
            <h1 className={styles.h1}>
              O melhor Gerador de Proposta do Brasil — <strong>com a sua marca</strong>.
            </h1>

            <p className={styles.lead} style={{ margin: '0 auto 32px' }}>
              Proposta solar e todos os contratos que o integrador precisa, prontos em minutos: seu nome,
              sua logo, sua cor e os números certos — pra fechar mais rápido no WhatsApp do cliente.
            </p>

            <button className={styles.finalCtaBtn} onClick={scrollToPlans}>
              Testar 7 dias grátis →
            </button>

            <div className={styles.trustRow} style={{ justifyContent: 'center', marginTop: 24 }}>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> <b>7 dias grátis</b>
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Cancele quando quiser
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Sem fidelidade
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP */}
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
              <div className={styles.statN}>+200</div>
              <div className={styles.statL}>Documentos solares já gerados na plataforma</div>
            </div>
            <div className={styles.stat} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.statN}>60+</div>
              <div className={styles.statL}>Empresas solares ativas com CNPJ cadastrado</div>
            </div>
            <div className={styles.stat} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.statN}>2 min</div>
              <div className={styles.statL}>Pra gerar um contrato pronto do zero</div>
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

      {/* PLANS — PRO + VIP (7 dias grátis) */}
      <section id="planos" className={styles.plans} style={{ scrollMarginTop: 80 }}>
        <div className={styles.plansInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Planos</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Escolha seu plano. <strong>7 dias grátis nos dois.</strong>
          </h2>
          <p className={styles.sectionSub} data-reveal>
            Teste a plataforma completa por 7 dias. Só é cobrado se continuar — cancele quando quiser, sem fidelidade.
          </p>

          {/* CARDS — 3 colunas (auto-fit) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 22,
              marginTop: 40,
              maxWidth: 760,
              marginLeft: 'auto',
              marginRight: 'auto',
              alignItems: 'stretch',
            }}
          >
            <div className={styles.plan} data-reveal style={{ transitionDelay: '0.05s' }}>
              <div className={styles.planName}>Pro</div>
              <div className={styles.planPrice}>R$ {PRICES.pro}<small>/mês</small></div>
              <div className={styles.planSub}>
                7 dias grátis · cancela quando quiser<br />
                <span style={{ opacity: 0.7 }}>Pro integrador que fecha 5–15 vendas/mês</span>
              </div>
              <ul className={styles.planList}>
                <li>90 documentos por mês</li>
                <li>Gerador de Proposta com sua marca</li>
                <li>Todos os 5 tipos de documento</li>
                <li>Assinatura digital com validade jurídica</li>
                <li>Suporte prioritário no WhatsApp</li>
                <li>Cancela quando quiser, sem multa</li>
              </ul>
              <button onClick={() => goToRegister('pro')} className={styles.planBtn} disabled={checkoutLoading !== null}>
                {checkoutLoading === 'pro' ? 'Abrindo checkout...' : 'Testar 7 dias grátis'}
              </button>
            </div>

            <div className={`${styles.plan} ${styles.planFeatured}`} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.planTag}>Mais escolhido</div>
              <div className={styles.planName}>VIP</div>
              <div className={styles.planPrice}>R$ {PRICES.vip}<small>/mês</small></div>
              <div className={styles.planSub}>
                7 dias grátis · cancela quando quiser<br />
                <span style={{ opacity: 0.7 }}>Pra empresa solar consolidada — documentos ilimitados</span>
              </div>
              <ul className={styles.planList}>
                <li><b>Tudo do Pro, e mais:</b></li>
                <li>Documentos <b>ilimitados</b></li>
                <li>Mentoria mensal de vendas solares</li>
                <li>Suporte VIP por WhatsApp</li>
                <li>Acesso antecipado a novos documentos</li>
              </ul>
              <button onClick={() => goToRegister('vip')} className={`${styles.planBtn} ${styles.planBtnPrimary}`} disabled={checkoutLoading !== null}>
                {checkoutLoading === 'vip' ? 'Abrindo checkout...' : 'Testar 7 dias grátis'}
              </button>
            </div>
          </div>

          <p data-reveal style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#94a3b8' }}>
            Os 7 dias grátis valem pros dois planos. A primeira cobrança só acontece no 8º dia — cancelou antes? Não paga nada.
          </p>
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
              <summary>Como funcionam os 7 dias grátis?</summary>
              <div className={styles.faqAnswer}>
                Você escolhe Pro ou VIP, cadastra o cartão e usa a plataforma completa por 7 dias sem pagar nada.
                A <b>primeira cobrança só acontece no 8º dia</b>. Cancelou antes? Não é cobrado. Sem letra miúda.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Qual a diferença entre Pro e VIP?</summary>
              <div className={styles.faqAnswer}>
                O <b>Pro (R$ {PRICES.pro}/mês)</b> dá 90 documentos por mês — ideal pra quem fecha de 5 a 15 vendas.
                O <b>VIP (R$ {PRICES.vip}/mês)</b> é ilimitado, com mentoria e suporte prioritário, pra empresa com volume alto.
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
            Teste o melhor gerador de proposta do Brasil por 7 dias grátis.
          </p>
          <div data-reveal>
            <button className={styles.finalCtaBtn} onClick={scrollToPlans}>
              Testar 7 dias grátis →
            </button>
            <div className={styles.finalCtaFoot}>
              Pro R$ {PRICES.pro}/mês ou VIP R$ {PRICES.vip}/mês · cancele quando quiser, sem fidelidade.
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
          </div>
        </div>
      </footer>
    </div>
  );
}
