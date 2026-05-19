'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

type Billing = 'monthly' | 'annual';

// Preços base mensais (R$). Anual = mensal × 12 × 0,7 (30% off).
const PRICES = {
  pro: { monthly: 27, annual: 226.8 },
  vip: { monthly: 67, annual: 562.8 },
} as const;

function fmtBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Landing() {
  const router = useRouter();
  useReveal();
  const { trackEvent } = useLpTracking();

  const [billing, setBilling] = useState<Billing>('annual');

  function goToRegister(plano: 'pro' | 'vip' | 'grátis', billingOverride?: Billing) {
    const b = billingOverride ?? billing;
    trackEvent('cta_click', { label: plano, billing: b });
    if (typeof window !== 'undefined' && window.fbq) {
      window.fbq('track', 'Lead', { content_name: 'cta_register', plano, billing: b });
    }
    const qs = new URLSearchParams({ mode: 'register' });
    if (plano !== 'grátis') {
      qs.set('plano', plano);
      qs.set('billing', b);
    }
    router.push(`/auth?${qs.toString()}`);
  }

  // Helpers de preço por plano
  function priceLabel(plan: 'pro' | 'vip') {
    if (billing === 'monthly') {
      return { big: `R$ ${PRICES[plan].monthly}`, small: '/mês', sub: 'Cobrado após 7 dias grátis' };
    }
    const annual = PRICES[plan].annual;
    const monthlyEquiv = annual / 12;
    const saved = PRICES[plan].monthly * 12 - annual;
    return {
      big: `R$ ${fmtBRL(monthlyEquiv)}`,
      small: '/mês',
      sub: `Cobrado anualmente — R$ ${fmtBRL(annual)}/ano após 7 dias grátis. Economia de R$ ${fmtBRL(saved)} vs mensal.`,
    };
  }

  const proPrice = priceLabel('pro');
  const vipPrice = priceLabel('vip');

  return (
    <div className={styles.page}>
      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.brand}>
            <span>SolarDoc<span className={styles.brandAccent}>.App</span></span>
          </div>
          <div className={styles.navRight}>
            <a href="/auth?mode=login" className={styles.navLink}>Entrar</a>
            <button onClick={() => goToRegister('grátis')} className={styles.navCta}>Começar 7 dias grátis</button>
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
              Gerador de Proposta + Contratos solares <strong>com a sua marca</strong>.
            </h1>
            <p className={styles.lead} style={{ margin: '0 auto 32px' }}>
              Cadastra a empresa, sobe sua logo e <b>use 7 dias grátis</b>. Em minutos sai a proposta solar, o contrato,
              a procuração e a proposta bancária — pronto pra mandar no WhatsApp.
            </p>

            <button className={styles.finalCtaBtn} onClick={() => goToRegister('vip', 'annual')}>
              Começar 7 dias grátis →
            </button>

            <div className={styles.trustRow} style={{ justifyContent: 'center', marginTop: 24 }}>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> <b>7 dias grátis</b>
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Cancela antes e não paga
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Sem multa
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

      {/* PLANS — 2 planos com toggle Mensal/Anual */}
      <section className={styles.plans}>
        <div className={styles.plansInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Planos</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            <strong>7 dias grátis</strong> em qualquer plano. Cancela antes e não paga.
          </h2>
          <p className={styles.sectionSub} data-reveal>
            Passe o cartão pra começar, use sem limite por 7 dias. Se gostou, mantém. Se não, cancela e nada é cobrado.
          </p>

          {/* TOGGLE Mensal | Anual */}
          <div data-reveal style={{ display: 'flex', justifyContent: 'center', marginTop: 32 }}>
            <div
              role="tablist"
              aria-label="Periodicidade de cobrança"
              style={{
                display: 'inline-flex',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 999,
                padding: 4,
                gap: 4,
                backdropFilter: 'blur(8px)',
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={billing === 'monthly'}
                onClick={() => setBilling('monthly')}
                style={{
                  border: 0,
                  background: billing === 'monthly' ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : 'transparent',
                  color: billing === 'monthly' ? '#0f172a' : '#cbd5e1',
                  fontWeight: 800,
                  fontSize: 14,
                  padding: '10px 22px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  transition: 'background 0.2s, color 0.2s',
                  fontFamily: 'inherit',
                }}
              >
                Mensal
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={billing === 'annual'}
                onClick={() => setBilling('annual')}
                style={{
                  border: 0,
                  background: billing === 'annual' ? 'linear-gradient(135deg, #fbbf24, #f59e0b)' : 'transparent',
                  color: billing === 'annual' ? '#0f172a' : '#cbd5e1',
                  fontWeight: 800,
                  fontSize: 14,
                  padding: '10px 22px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  transition: 'background 0.2s, color 0.2s',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontFamily: 'inherit',
                }}
              >
                Anual
                <span
                  style={{
                    background: billing === 'annual' ? '#0f172a' : 'rgba(52, 211, 153, 0.18)',
                    color: billing === 'annual' ? '#fbbf24' : '#34d399',
                    fontSize: 10,
                    fontWeight: 900,
                    padding: '3px 7px',
                    borderRadius: 6,
                    letterSpacing: '0.04em',
                  }}
                >
                  −30%
                </span>
              </button>
            </div>
          </div>

          {/* CARDS — 2 colunas (auto-fit), VIP destacado */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 22,
              marginTop: 40,
              maxWidth: 780,
              marginLeft: 'auto',
              marginRight: 'auto',
              alignItems: 'stretch',
            }}
          >
            <div className={styles.plan} data-reveal>
              <div className={styles.planName}>Pro</div>
              <div className={styles.planPrice}>{proPrice.big}<small>{proPrice.small}</small></div>
              <div className={styles.planSub}>
                {proPrice.sub}<br />
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
              <button onClick={() => goToRegister('pro')} className={styles.planBtn}>
                Começar 7 dias grátis
              </button>
            </div>

            <div className={`${styles.plan} ${styles.planFeatured}`} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.planTag}>Mais escolhido</div>
              <div className={styles.planName}>VIP</div>
              <div className={styles.planPrice}>{vipPrice.big}<small>{vipPrice.small}</small></div>
              <div className={styles.planSub}>
                {vipPrice.sub}<br />
                <span style={{ opacity: 0.7 }}>Pra empresa solar consolidada — documentos ilimitados</span>
              </div>
              <ul className={styles.planList}>
                <li><b>Tudo do Pro, e mais:</b></li>
                <li>Documentos <b>ilimitados</b></li>
                <li>Mentoria mensal de vendas solares</li>
                <li>Suporte VIP por WhatsApp</li>
                <li>Acesso antecipado a novos documentos</li>
                <li>Logo em alta resolução</li>
              </ul>
              <button onClick={() => goToRegister('vip')} className={`${styles.planBtn} ${styles.planBtnPrimary}`}>
                Começar 7 dias grátis
              </button>
            </div>
          </div>

          <p data-reveal style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#94a3b8' }}>
            Cobrança automática só depois dos 7 dias. Você pode cancelar a qualquer momento na sua conta.
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
              <summary>Por que preciso passar o cartão pra começar?</summary>
              <div className={styles.faqAnswer}>
                Pra liberar acesso completo imediato durante os 7 dias. <b>Nada é cobrado nesse período</b> —
                a primeira fatura só sai no 8º dia, e só se você não cancelar antes.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Como cancelo durante o trial?</summary>
              <div className={styles.faqAnswer}>
                Direto na sua conta, dentro do app, em 1 clique. <b>Sem multa, sem ligação, sem letra miúda.</b>
                Se cancelar antes do 7º dia, não é cobrado nenhum valor.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Qual a diferença entre Mensal e Anual?</summary>
              <div className={styles.faqAnswer}>
                Mesmo produto, mesma funcionalidade. <b>No anual você economiza 30%</b> —
                pagando antecipado o ano todo de uma vez. No mensal, cobra todo mês.
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
            7 dias grátis. Cancela antes e não paga. Sem pegadinha.
          </p>
          <div data-reveal>
            <button className={styles.finalCtaBtn} onClick={() => goToRegister('vip', 'annual')}>
              Começar 7 dias grátis →
            </button>
            <div className={styles.finalCtaFoot}>
              Depois do trial: Pro R$ 27/mês ou VIP R$ 67/mês · 30% off no anual · cancela quando quiser.
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
