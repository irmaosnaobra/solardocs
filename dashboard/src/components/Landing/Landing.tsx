'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLpTracking } from '@/hooks/useLpTracking';
import { useEffect } from 'react';
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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cargo, setCargo] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  function scrollToFormFrom(plano: 'grátis' | 'pro' | 'vip') {
    trackEvent('cta_click', { label: plano });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.getElementById('input-nome')?.focus(), 500);
  }

  function handleSubmit(e: React.FormEvent) {
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
    setLoading(true);
    const qs = new URLSearchParams({ mode: 'register', nome: nome.trim(), cargo });
    router.push(`/auth?${qs.toString()}`);
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
            <button onClick={() => scrollToFormFrom('grátis')} className={styles.navCta}>Começar grátis</button>
          </div>
        </div>
      </nav>

      {/* HERO — enxuto, sem vídeo, form como protagonista */}
      <section className={styles.hero}>
        <div className={styles.aurora} aria-hidden>
          <div className={`${styles.auroraBlob} ${styles.auroraBlob1}`} />
          <div className={`${styles.auroraBlob} ${styles.auroraBlob2}`} />
          <div className={`${styles.auroraBlob} ${styles.auroraBlob3}`} />
        </div>
        <div className={styles.gridPattern} aria-hidden />

        <div className={styles.heroInner}>
          <div className={styles.heroTop}>
            <span className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              Pra integrador solar com CNPJ
            </span>
            <h1 className={styles.h1}>
              Gerador de Proposta + Contratos solares <strong>com a sua marca</strong>.
            </h1>
            <p className={styles.lead}>
              Cadastra a empresa, sobe sua logo e <b>comece grátis</b>. Em minutos sai a proposta solar, o contrato,
              a procuração e a proposta bancária — pronto pra mandar no WhatsApp.
            </p>
          </div>

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
              <span className={styles.formBadge}>✓ GRÁTIS — 10 DOCUMENTOS</span>
              <div className={styles.formTitle}>Comece em 30 segundos</div>
              <div className={styles.formSub}>Diz quem você é. Sem teste vencendo. Use quando precisar.</div>

              <form onSubmit={handleSubmit}>
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

                <button type="submit" className={styles.cta} disabled={loading}>
                  <span>{loading ? 'Carregando…' : 'Continuar →'}</span>
                </button>

                {error && <div className={styles.formError}>{error}</div>}

                <div className={styles.formFoot}>
                  Próximo passo: CNPJ, email e WhatsApp pra liberar seu Gerador.
                </div>
              </form>
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

      {/* PLANS — repaginado: persona, ancoragem por dia, CTAs padronizados */}
      <section className={styles.plans}>
        <div className={styles.plansInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Planos</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            <strong>Comece grátis.</strong> Continue se valer a pena.
          </h2>
          <p className={styles.sectionSub} data-reveal>
            10 documentos sem pagar nada. Quando precisar de mais, escolhe o plano — sem trial, sem cartão antecipado.
          </p>

          <div className={styles.plansGrid}>
            <div className={styles.plan} data-reveal>
              <div className={styles.planName}>Free</div>
              <div className={styles.planPrice}>R$ 0</div>
              <div className={styles.planSub}>Pra testar o gerador sem compromisso</div>
              <ul className={styles.planList}>
                <li>10 documentos vitalícios</li>
                <li>Todos os 5 tipos de documento</li>
                <li>Gerador de Proposta com sua marca</li>
                <li>Assinatura digital com validade jurídica</li>
                <li>Suporte por WhatsApp</li>
              </ul>
              <button onClick={() => scrollToFormFrom('grátis')} className={styles.planBtn}>Comece grátis</button>
            </div>

            <div className={`${styles.plan} ${styles.planFeatured}`} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.planTag}>Mais escolhido</div>
              <div className={styles.planName}>Pro</div>
              <div className={styles.planPrice}>R$ 27<small>/mês</small></div>
              <div className={styles.planSub}>
                ≈ R$ 0,90/dia · <b>menos de R$ 0,30 por documento</b><br />
                <span style={{ opacity: 0.7 }}>Pro integrador que fecha 5–15 vendas/mês</span>
              </div>
              <ul className={styles.planList}>
                <li><b>Tudo do Free, e mais:</b></li>
                <li>90 documentos por mês</li>
                <li>Logo em alta resolução</li>
                <li>Suporte prioritário no WhatsApp</li>
                <li>Cancela quando quiser, sem multa</li>
              </ul>
              <button onClick={() => scrollToFormFrom('pro')} className={`${styles.planBtn} ${styles.planBtnPrimary}`}>
                Comece grátis
              </button>
            </div>

            <div className={styles.plan} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.planName}>VIP</div>
              <div className={styles.planPrice}>R$ 67<small>/mês</small></div>
              <div className={styles.planSub}>
                ≈ R$ 2,20/dia · documentos <b>ilimitados</b><br />
                <span style={{ opacity: 0.7 }}>Pra empresa solar consolidada e em escala</span>
              </div>
              <ul className={styles.planList}>
                <li><b>Tudo do Pro, e mais:</b></li>
                <li>Documentos ilimitados</li>
                <li>Mentoria mensal de vendas solares</li>
                <li>Suporte VIP por WhatsApp</li>
                <li>Acesso antecipado a novos documentos</li>
              </ul>
              <button onClick={() => scrollToFormFrom('vip')} className={styles.planBtn}>Quero o VIP</button>
            </div>
          </div>

          {/* TABELA COMPARATIVA — estilo Panda Video */}
          <div className={styles.compareGrid} style={{ marginTop: 56 }}>
            <div className={styles.compareCol} data-reveal>
              <div className={styles.compareTitle}>Free</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>10</span> Documentos</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Gerador de Proposta</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Sua marca / sua cor</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Assinatura digital</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Suporte prioritário</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Mentoria solar</li>
              </ul>
            </div>

            <div className={`${styles.compareCol} ${styles.compareColBest}`} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.compareTitle}>Pro</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>90</span> Documentos/mês</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Gerador de Proposta</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Sua marca / sua cor</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Assinatura digital</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Suporte prioritário</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Mentoria solar</li>
              </ul>
            </div>

            <div className={styles.compareCol} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.compareTitle}>VIP</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>∞</span> Documentos ilimitados</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Gerador de Proposta</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Sua marca / sua cor</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Assinatura digital</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Suporte VIP</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Mentoria mensal</li>
              </ul>
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
              Começar grátis →
            </button>
            <div className={styles.finalCtaFoot}>
              Pro plano pago: a partir de R$ 27/mês (≈ R$ 0,90/dia). Cancela quando quiser.
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
