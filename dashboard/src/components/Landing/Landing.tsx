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
  vipPromo: 49, // downsell: VIP com desconto oferecido no popup ao clicar no Pro
} as const;

export default function Landing() {
  const router = useRouter();
  useReveal();
  const { trackEvent } = useLpTracking();

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

  const [checkoutLoading, setCheckoutLoading] = useState<'pro' | 'vip' | 'vip_promo' | null>(null);
  const [showDownsell, setShowDownsell] = useState(false);

  // Popup de downsell (clicou no Pro → oferta do VIP com desconto): fecha no Esc
  // e trava o scroll do fundo enquanto está aberto.
  useEffect(() => {
    if (!showDownsell) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowDownsell(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [showDownsell]);

  // Fluxo LP → Stripe → Cadastro: clica no plano e vai DIRETO pro checkout
  // público do Stripe (email + cartão, 7 dias grátis). Só depois de aprovar
  // o cartão a pessoa cria a conta. Sem free.
  async function goToRegister(plano: 'pro' | 'vip' | 'vip_promo') {
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
    const qs = new URLSearchParams({ mode: 'register', plano: plano === 'vip_promo' ? 'vip' : plano });
    for (const k of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
      if (attr[k]) qs.set(k, attr[k]);
    }
    router.push(`/auth?${qs.toString()}`);
  }

  // Data de hoje em pt-BR (fuso de SP) pra barra de urgência. Calculada NO CLIENTE
  // (useEffect) pra sempre refletir o dia ATUAL de quem abre. Se computasse no
  // render, o Next executa no servidor/build e a página cacheia (SSG/ISR) →
  // a data congelava no dia do build (ex.: mostrava 05/07 no dia 06/07).
  const [hojeBR, setHojeBR] = useState('');
  useEffect(() => {
    const calcHoje = () => new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
    setHojeBR(calcHoje());
    // Vira a data à meia-noite de São Paulo mesmo com a página aberta: recomputa
    // no fuso de SP a cada 30s e só re-renderiza quando o dia efetivamente troca.
    const id = setInterval(() => setHojeBR(prev => { const d = calcHoje(); return d !== prev ? d : prev; }), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.page}>
      {/* BARRA DE URGÊNCIA — desconto exclusivo do dia (clica → rola pros planos) */}
      <button type="button" className={styles.promoBar} onClick={scrollToPlans} aria-label="Desconto exclusivo somente hoje — ver planos">
        <span className={styles.promoDot} aria-hidden="true" />
        Desconto exclusivo • Somente hoje, <u>{hojeBR}</u>
      </button>

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

          <div className={styles.heroProduct} data-reveal>
            <img
              src="/hero-produto.webp"
              width={1120}
              height={666}
              alt="Proposta solar gerada no SolarDoc, com a sua logo — no computador e no celular"
              loading="eager"
            />
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

      {/* DIFERENCIAIS — feature grid (padrão gdpro.app, com a marca SolarDoc) */}
      <section className={styles.diffs}>
        <div className={styles.diffsInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Por que SolarDoc</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            A plataforma que <strong>fecha a venda solar</strong> — não só gera papel.
          </h2>

          <div className={styles.diffsGrid} style={{ marginTop: 40 }}>
            <div className={styles.diffCard} data-reveal>
              <div className={styles.diffIcon}>🎨</div>
              <h3 className={styles.diffH}>Com a sua marca</h3>
              <p className={styles.diffP}>
                Sua logo, sua cor, seu nome em <b>todos os documentos</b>. O cliente abre o PDF e
                vê a cara da sua empresa — confia antes de você falar.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.05s' }}>
              <div className={styles.diffIcon}>⚡</div>
              <h3 className={styles.diffH}>Pronto em 2 minutos</h3>
              <p className={styles.diffP}>
                Preenche os dados do cliente e o documento sai <b>formatado e completo</b>.
                Sem Word, sem template quebrado, sem perder a tarde.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.diffIcon}>📄</div>
              <h3 className={styles.diffH}>8 documentos num lugar só</h3>
              <p className={styles.diffP}>
                Proposta, contrato, procuração, financiamento, recibo, vistoria — <b>tudo o que o
                integrador precisa</b> pra fechar, do orçamento à assinatura.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.15s' }}>
              <div className={styles.diffIcon}>🏛️</div>
              <h3 className={styles.diffH}>Aceito nas concessionárias</h3>
              <p className={styles.diffP}>
                Procurações padronizadas pra passar de primeira na <b>CEMIG, Enel, CPFL, Energisa</b>
                e nas principais do Brasil. Menos retrabalho, homologa mais rápido.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.diffIcon}>📱</div>
              <h3 className={styles.diffH}>Fecha no WhatsApp</h3>
              <p className={styles.diffP}>
                Gera e <b>manda direto pro cliente</b> no computador ou no celular. A proposta chega
                bonita, na hora, enquanto o cliente ainda está quente.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.25s' }}>
              <div className={styles.diffIcon}>🙋</div>
              <h3 className={styles.diffH}>O dono mesmo usa</h3>
              <p className={styles.diffP}>
                Sem advogado, sem secretária, sem escritório. Foi feito pra <b>quem toca a empresa
                sozinho</b> — abre, cadastra, gera e envia.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA — 3 passos (padrão gdpro.app) */}
      <section className={styles.how}>
        <div className={styles.howInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Como funciona</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Do cliente ao documento pronto em <strong>3 passos</strong>.
          </h2>

          <div className={styles.howGrid}>
            <div className={styles.howStep} data-reveal>
              <div className={styles.howNum}>1</div>
              <h3 className={styles.howH}>Configure a sua marca</h3>
              <p className={styles.howP}>
                Sobe a logo, escolhe a cor da empresa e pronto — <b>uma vez só</b>. Todo documento
                que você gerar já sai com a sua identidade.
              </p>
            </div>
            <div className={styles.howStep} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.howNum}>2</div>
              <h3 className={styles.howH}>Cadastre o cliente</h3>
              <p className={styles.howP}>
                Preenche os dados da venda — ou <b>escaneia a conta de luz</b> e a plataforma puxa o
                cliente pra você. Sem digitar tudo à mão.
              </p>
            </div>
            <div className={styles.howStep} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.howNum}>3</div>
              <h3 className={styles.howH}>Gere e envie</h3>
              <p className={styles.howP}>
                Escolhe o documento, clica em gerar e <b>manda pro WhatsApp do cliente</b> em PDF.
                Formatado, com a sua cara, na hora.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DOCS */}
      <section className={styles.docs}>
        <div className={styles.docsInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>8 documentos prontos</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Tudo o que sua empresa solar <strong>precisa pra fechar</strong>.{' '}<br />
            Nada do que não precisa.
          </h2>

          <div className={styles.docsGrid}>
            <div className={styles.docCard} data-reveal>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Proposta Solar</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.05s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Contrato de Compra e Venda Solar</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.1s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Procuração para Concessionária</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.15s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Prestação de Serviço</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.2s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Contrato Vendedor</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.25s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Proposta para Financiamento Bancário</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.3s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Recibo</span>
            </div>
            <div className={styles.docCard} data-reveal style={{ transitionDelay: '0.35s' }}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Vistoria Técnica</span>
            </div>
          </div>
        </div>
      </section>

      {/* COMPARATIVO — com/sem SolarDoc (padrão gdpro.app) */}
      <section className={styles.compare}>
        <div className={styles.compareInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Antes e depois</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            A diferença entre <strong>perder e fechar</strong> a venda.
          </h2>

          <div className={styles.compareGrid}>
            <div className={styles.compareCol} data-reveal>
              <div className={styles.compareTitle}>No Word / à mão</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Template quebra e desformata toda hora</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Procuração recusada, refaz 3 vezes</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Documento sem a cara da empresa</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Meia tarde perdida por contrato</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Cliente esfria esperando o PDF</li>
              </ul>
            </div>

            <div className={styles.compareCol} data-reveal style={{ transitionDelay: '0.08s' }}>
              <div className={styles.compareTitle}>Com advogado</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>~</span> Custa caro por documento</li>
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>~</span> Depende da agenda de outra pessoa</li>
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>~</span> Demora dias pra voltar</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Não conhece o padrão da concessionária</li>
                <li><span className={`${styles.compareIcon} ${styles.compareNo}`}>✕</span> Trava a sua venda</li>
              </ul>
            </div>

            <div className={`${styles.compareCol} ${styles.compareColBest}`} data-reveal style={{ transitionDelay: '0.16s' }}>
              <div className={styles.compareTitle}>Com SolarDoc</div>
              <ul className={styles.compareList}>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Documento pronto em 2 minutos</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Procuração aceita nas concessionárias</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Tudo com a sua logo e a sua cor</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Você mesmo faz, sem depender de ninguém</li>
                <li><span className={`${styles.compareIcon} ${styles.compareYes}`}>✓</span> Manda no WhatsApp com o cliente quente</li>
              </ul>
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
            <div className={styles.plan} data-reveal style={{ transitionDelay: '0.05s', opacity: 0.9 }}>
              <div className={styles.planName}>Pro</div>
              <div className={styles.planPrice}>R$ {PRICES.pro}<small>/mês</small></div>
              <div className={styles.planSub}>
                7 dias grátis · cancela quando quiser<br />
                <span style={{ opacity: 0.7 }}>Pra quem tá começando — 90 documentos por mês</span>
              </div>
              <ul className={styles.planList}>
                <li>Os 8 tipos de documento com a sua marca</li>
                <li>Cláusulas prontas pro setor solar</li>
                <li>Cancela quando quiser, sem multa</li>
                <li className={styles.off}>Documentos ilimitados</li>
                <li className={styles.off}>Histórico salvo pra sempre</li>
                <li className={styles.off}>Cadastro de prestadores parceiros</li>
                <li className={styles.off}>Voz no roadmap: peça novos recursos</li>
              </ul>
              <button onClick={() => { trackEvent('cta_click', { label: 'pro_downsell_open' }); setShowDownsell(true); }} className={styles.planBtn} disabled={checkoutLoading !== null}>
                Testar 7 dias grátis
              </button>
            </div>

            <div className={`${styles.plan} ${styles.planFeatured}`} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.planTag}>Mais escolhido</div>
              <div className={styles.planName}>VIP</div>
              <div className={styles.planPrice}>R$ {PRICES.vip}<small>/mês</small></div>
              <div className={styles.planSub}>
                7 dias grátis · cancela quando quiser<br />
                <span style={{ opacity: 0.7 }}>Pra empresa solar que vende todo dia — sem limite nenhum</span>
              </div>
              <ul className={styles.planList}>
                <li>Os 8 tipos de documento com a sua marca</li>
                <li>Cláusulas prontas pro setor solar</li>
                <li>Cancela quando quiser, sem multa</li>
                <li><b>Documentos ilimitados</b> — sem teto mensal</li>
                <li><b>Histórico salvo pra sempre</b></li>
                <li>Cadastro de prestadores parceiros</li>
                <li>Voz no roadmap: peça novos recursos</li>
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
                Sim. Os modelos seguem <b>cláusulas técnicas revisadas pro setor solar</b> (geração,
                garantia, inadimplência, titularidade) e saem prontos pra você assinar com o seu
                cliente — à mão ou na ferramenta de assinatura que você já usar.
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
                identidade visual. <b>Você só preenche os dados — a formatação sai pronta.</b>
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
            Sua próxima venda solar fecha com{' '}<br />
            <strong>proposta e contrato prontos em 2 minutos.</strong>
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
            <a href="https://wa.me/5534998165040" target="_blank" rel="noopener noreferrer">Suporte WhatsApp</a>
          </div>
        </div>
      </footer>

      {/* ===== POPUP DOWNSELL — clicou no Pro, oferece o VIP com desconto (R$ 49/mês) ===== */}
      {showDownsell && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="downsellTitle"
          onClick={() => setShowDownsell(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, background: 'rgba(15,23,42,0.72)', backdropFilter: 'blur(3px)',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'relative', width: '100%', maxWidth: 440,
              background: '#fff', color: '#0f172a', borderRadius: 20,
              padding: '30px 26px 26px', boxShadow: '0 24px 70px rgba(2,6,23,0.45)',
              border: '1px solid rgba(148,163,184,0.25)',
            }}
          >
            <button
              type="button" aria-label="Fechar" onClick={() => setShowDownsell(false)}
              style={{
                position: 'absolute', top: 12, right: 14, width: 32, height: 32,
                border: 'none', background: 'transparent', color: '#94a3b8',
                fontSize: 26, lineHeight: 1, cursor: 'pointer',
              }}
            >×</button>

            <div style={{
              display: 'inline-block', fontSize: 12, fontWeight: 700, letterSpacing: 0.3,
              textTransform: 'uppercase', color: '#16a34a', background: 'rgba(22,163,74,0.10)',
              padding: '5px 11px', borderRadius: 999, marginBottom: 14,
            }}>
              Espere! Oferta exclusiva pra você
            </div>

            <h3 id="downsellTitle" style={{ fontSize: 22, lineHeight: 1.25, margin: '0 0 14px', fontWeight: 800 }}>
              Leve o <span style={{ color: '#16a34a' }}>VIP</span> com tudo ilimitado
            </h3>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 17, color: '#94a3b8', textDecoration: 'line-through' }}>R$ {PRICES.vip}</span>
              <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
                <span style={{ fontSize: 20, fontWeight: 700, verticalAlign: '6px' }}>R$ </span>{PRICES.vipPromo}
                <small style={{ fontSize: 15, fontWeight: 600, color: '#64748b' }}>/mês</small>
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', marginBottom: 16 }}>
              Você economiza R$ {PRICES.vip - PRICES.vipPromo} todo mês
            </div>

            <p style={{ fontSize: 14, lineHeight: 1.6, color: '#475569', margin: '0 0 20px' }}>
              No Pro você tem <b>90 documentos por mês</b>. No VIP é <b>tudo ilimitado</b> — documentos,
              histórico salvo pra sempre e cadastro de prestadores parceiros. Os mesmos <b>7 dias grátis</b>:
              a primeira cobrança só acontece no 8º dia.
            </p>

            <button
              type="button"
              onClick={() => goToRegister('vip_promo')}
              disabled={checkoutLoading !== null}
              className={`${styles.planBtn} ${styles.planBtnPrimary}`}
              style={{ width: '100%' }}
            >
              {checkoutLoading === 'vip_promo' ? 'Abrindo checkout...' : `Quero o VIP por R$ ${PRICES.vipPromo}/mês →`}
            </button>

            <button
              type="button"
              onClick={() => goToRegister('pro')}
              disabled={checkoutLoading !== null}
              style={{
                display: 'block', width: '100%', marginTop: 12, padding: 8,
                border: 'none', background: 'transparent', color: '#94a3b8',
                fontSize: 13, cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              {checkoutLoading === 'pro' ? 'Abrindo checkout...' : `Não, seguir com o Pro (R$ ${PRICES.pro}/mês)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
