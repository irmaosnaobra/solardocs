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

// PLANO ÚNICO (06/08/2026). A LP vendia Pro R$27 + VIP R$67 com 7 dias grátis e
// ainda um downsell de R$49 no popup — três preços na mesma página. Agora é um
// só: R$ 67/mês com COBRANÇA IMEDIATA (PLAN_MAP.ilimitado.trialDias = 0 na API).
// Os planos antigos continuam existindo no backend (planByPrice resolve quem já
// assinou por 27/49) — só sumiram da vitrine.
const PRICE = 67;
const PRICE_DIA = (PRICE / 30).toFixed(2).replace('.', ','); // "por dia" da oferta
const WHATSAPP = 'https://wa.me/5534998165040';

// Concessionárias da faixa de confiança (logo oficial em /public/conc).
const CONCESSIONARIAS = [
  { slug: 'cemig',      nome: 'CEMIG',      img: '/conc/cemig.svg',      altura: 26 },
  { slug: 'enel',       nome: 'Enel',       img: '/conc/enel.png',       altura: 36 },
  { slug: 'cpfl',       nome: 'CPFL',       img: '/conc/cpfl.png',       altura: 36 },
  { slug: 'equatorial', nome: 'Equatorial', img: '/conc/equatorial.png', altura: 21 },
  { slug: 'energisa',   nome: 'Energisa',   img: '/conc/energisa.png',   altura: 27 },
  { slug: 'light',      nome: 'Light',      img: '/conc/light.png',      altura: 27 },
];

// Carrossel: o RESULTADO, não o formulário — é o documento pronto que o
// integrador quer ver antes de assinar.
//
// De onde vem cada imagem (nenhuma é maquete):
//  - as propostas saem de generateFromTemplate (api/scripts/lp-docs.ts), a MESMA
//    função que o app chama quando o cliente clica em Gerar. Os números são
//    calculados pelo próprio sistema com os dados de exemplo;
//  - o contrato é a tela de preview do app renderizando esse mesmo conteúdo;
//  - precificação e inventário são as telas de verdade, com os cálculos feitos.
const TELAS = [
  { img: '/tela/doc-proposta.webp',      imgMobile: '/tela/doc-proposta-mobile.webp',
    titulo: 'Proposta comercial',
    texto: 'Economia em 25 anos, conta antes e depois e geração mês a mês — na marca da empresa.' },

  { img: '/tela/doc-proposta-a4.webp',   imgMobile: '/tela/doc-proposta-a4-mobile.webp',
    titulo: 'Orçamento de 1 página',
    texto: 'Investimento, economia mensal e tempo de retorno numa folha só, pronta pro WhatsApp.' },

  { img: '/tela/doc-contrato.webp',      imgMobile: '/tela/doc-contrato-mobile.webp',
    titulo: 'Contrato de compra e venda',
    texto: 'Partes, equipamentos, prazos e garantias já escritos. Você só confere e envia.' },

  { img: '/tela/doc-procuracao.webp',    imgMobile: '/tela/doc-procuracao-mobile.webp',
    titulo: 'Procuração pra concessionária',
    texto: 'Com UC, concessionária e os poderes certos — no padrão que passa de primeira.' },

  { img: '/tela/doc-recibo.webp',        imgMobile: '/tela/doc-recibo-mobile.webp',
    titulo: 'Recibo de pagamento',
    texto: 'Lança as parcelas e ele calcula sozinho o que o cliente já pagou e o que falta.' },

  { img: '/tela/doc-banco.webp',         imgMobile: '/tela/doc-banco-mobile.webp',
    titulo: 'Proposta pro banco financiar',
    texto: 'No formato que a financeira pede: equipamento, mão de obra e valor total separados.' },

  { img: '/tela/doc-servico.webp',       imgMobile: '/tela/doc-servico-mobile.webp',
    titulo: 'Prestação de serviço',
    texto: 'O contrato com o instalador terceirizado: escopo, prazo, valor e forma de pagamento.' },

  { img: '/tela/doc-vendedor.webp',      imgMobile: '/tela/doc-vendedor-mobile.webp',
    titulo: 'Contrato de vendedor',
    texto: 'Representação comercial autônoma: comissão, meta e adiantamento, sem vínculo.' },

  { img: '/tela/doc-vistoria.webp',      imgMobile: '/tela/doc-vistoria-mobile.webp',
    titulo: 'Checklist de vistoria',
    texto: 'A folha que vai pra obra: consumo, padrão, telhado, fotos e conclusão da visita.' },

  { img: '/tela/doc-precificacao.webp',  imgMobile: '/tela/doc-precificacao-mobile.webp',
    titulo: 'Fechamento de preço',
    texto: 'Custo do kit, mão de obra e margem entram — preço de venda e lucro saem calculados.' },

  { img: '/tela/doc-inventario.webp',    imgMobile: '/tela/doc-inventario-mobile.webp',
    titulo: 'Inventário da empresa',
    texto: 'Material, quantidade, valor unitário e o patrimônio total — pronto pra imprimir.' },
];

export default function Landing() {
  const router = useRouter();
  useReveal();
  const { trackEvent } = useLpTracking();

  // Tracking de seção: dispara 'section' { section: 'precos' } quando o bloco da oferta
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

  function scrollToPlans(label: string) {
    trackEvent('cta_click', { label });
    if (typeof window !== 'undefined' && window.fbq) {
      window.fbq('track', 'ViewContent', { content_name: 'plans_section' });
    }
    document.getElementById('planos')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // Fluxo LP → Stripe → Cadastro: clica e vai DIRETO pro checkout público do
  // Stripe (email + cartão, cobrado na hora). Só depois de aprovar o cartão a
  // pessoa cria a conta. Sem free, sem trial.
  async function goToCheckout(label: string) {
    trackEvent('cta_click', { label });
    if (typeof window !== 'undefined' && window.fbq) {
      window.fbq('track', 'InitiateCheckout', { content_name: 'vip', value: PRICE, currency: 'BRL' });
    }
    setCheckoutLoading(true);
    try {
      // Atribuição: manda o session_id da LP + UTMs (de sessionStorage) junto.
      // O backend grava no metadata do Stripe → receita atribuída à campanha.
      const { data } = await api.post('/payments/public-checkout', {
        plan: 'vip',
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
    setCheckoutLoading(false);
    const attr = getCheckoutAttribution();
    const qs = new URLSearchParams({ mode: 'register', plano: 'vip' });
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      if (attr[k]) qs.set(k, attr[k]);
    }
    router.push(`/auth?${qs.toString()}`);
  }

  const ctaLabel = checkoutLoading ? 'Abrindo checkout...' : `Assinar agora — R$ ${PRICE}/mês`;

  // ---- Carrossel das telas (prints REAIS do app, capturados com dados de
  // demonstração). É webp e não GIF de propósito: um GIF de tela cheia dá 2 a
  // 5 MB cada e mata o carregamento no 4G — aqui cada print tem ~70 KB e o
  // movimento vem da troca automática (3s, como o Thiago pediu). Pausa no
  // hover/toque e respeita quem pediu menos animação no sistema.
  const [slide, setSlide] = useState(0);
  const [pausado, setPausado] = useState(false);

  // Duas coisas travavam o giro e as duas sumiam do meu teste:
  //  1. no CELULAR, onTouchStart marcava pausado e NADA desmarcava — bastava
  //     encostar o dedo (ou rolar a página por cima do carrossel) pra ele
  //     parar de vez;
  //  2. quem tem "reduzir animação" ligado no sistema (Windows e iPhone têm
  //     isso, e muita gente liga sem saber) caía num `return` e não via
  //     troca nenhuma.
  // Agora o toque pausa só por 6s e o reduced-motion tira a transição, não o
  // giro: o carrossel roda pra todo mundo.
  useEffect(() => {
    if (pausado) return;
    const id = setInterval(() => setSlide(s => (s + 1) % TELAS.length), 3000);
    return () => clearInterval(id);
  }, [pausado]);

  // volta a girar sozinho depois de um toque
  useEffect(() => {
    if (!pausado) return;
    const id = setTimeout(() => setPausado(false), 6000);
    return () => clearTimeout(id);
  }, [pausado]);

  return (
    <div className={styles.page}>
      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.brand}>
            <span>SolarDoc<span className={styles.brandAccent}>.App</span></span>
          </div>
          <div className={styles.navRight}>
            <a href="/auth" className={styles.navLink}>Entrar</a>
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

            <p className={styles.lead} style={{ margin: '0 auto 26px' }}>
              Proposta solar e todos os contratos que o integrador precisa, prontos em minutos: seu nome,
              sua logo, sua cor e os números certos — pra fechar mais rápido no WhatsApp do cliente.
            </p>

            {/* Mockup logo abaixo da subheadline (pedido do Thiago): a pessoa
                lê a promessa e vê o produto antes de decidir clicar. */}
            <div className={styles.heroProduct} data-reveal>
              <img
                src="/hero-orcamento.webp"
                width={1400}
                height={760}
                alt="Orçamento de 1 página gerado no SolarDoc, com a sua marca — no notebook e no celular"
                loading="eager"
              />
            </div>

            <button className={styles.finalCtaBtn} onClick={() => scrollToPlans('hero')}>
              Quero acesso agora →
            </button>

            <div className={styles.pricePill}>
              <b>R$ {PRICE}/mês</b>
              <span className={styles.pricePillSep} aria-hidden />
              acesso liberado na hora
            </div>

            <div className={styles.trustRow} style={{ justifyContent: 'center', marginTop: 20 }}>
              <span className={styles.trustItem}>
                {/* uma frase por item: .trustItem é flex com gap, então texto solto
                    ao lado do <b> abre um buraco no meio da frase */}
                <span className={styles.trustCheck}>✓</span> <b>Tudo liberado, sem plano capado</b>
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Garantia de 7 dias
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Cancele quando quiser
              </span>
            </div>

            {/* Quem está por trás — prova de gente de verdade, já na dobra */}
            <div className={styles.heroFounders} data-reveal>
              <span className={styles.heroFoundersPics} aria-hidden>
                <img src="/founder-thiago.webp" width={44} height={44} alt="" loading="lazy" />
                <img src="/founder-diego.webp" width={44} height={44} alt="" loading="lazy" />
              </span>
              {/* NÃO prometer que o dono responde o suporte: quem atende no
                  WhatsApp é o time/agente, não o Thiago e o Diego. */}
              <span>
                Feito por <b>Thiago e Diego</b>, integradores solares —
                {' '}nasceu dentro da operação deles, não numa startup de software.
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
          {/* Logo de cada concessionária, baixada do site oficial dela e
              exibida em MONOCROMÁTICO (filtro no CSS, não é arquivo editado).
              O branco uniforme é de propósito: seis logos coloridas viram
              carnaval e, pior, dão ar de "somos parceiros deles" — o que a
              frase acima não diz. Marcas são de seus donos; aqui elas indicam
              compatibilidade da procuração, nada além. Cosern e Coelba saíram
              da lista: são do grupo Neoenergia e o site não entrega o arquivo
              da logo. */}
          <div className={styles.logos} data-reveal>
            {CONCESSIONARIAS.map(c => (
              <img
                key={c.slug}
                src={c.img}
                alt={c.nome}
                className={styles.logoConc}
                style={{ '--h': `${c.altura}px` } as React.CSSProperties}
                loading="lazy"
              />
            ))}
            <span className={styles.logoMais}>e outras</span>
          </div>
        </div>
      </section>

      {/* DIFERENCIAIS — feature grid */}
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
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><circle cx="13.5" cy="6.5" r="1.2"/><circle cx="17.5" cy="10.5" r="1.2"/><circle cx="8.5" cy="7.5" r="1.2"/><circle cx="6.5" cy="12.5" r="1.2"/><path d="M12 2a10 10 0 1 0 0 20 2.5 2.5 0 0 0 2-4c-.5-.7-.3-1.7.5-2h1.5A4 4 0 0 0 22 12 10 10 0 0 0 12 2z"/></svg></div>
              <h3 className={styles.diffH}>Com a sua marca</h3>
              <p className={styles.diffP}>
                Sua logo, sua cor, seu nome em <b>todos os documentos</b>. O cliente abre o PDF e
                vê a cara da sua empresa — confia antes de você falar.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.05s' }}>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 10-12h-7z"/></svg></div>
              <h3 className={styles.diffH}>Pronto em 2 minutos</h3>
              <p className={styles.diffP}>
                Preenche os dados do cliente e o documento sai <b>formatado e completo</b>.
                Sem Word, sem template quebrado, sem perder a tarde.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><path d="M8 4h7l4 4v10a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M15 4v4h4"/><path d="M5 8v11a1 1 0 0 0 1 1h9"/></svg></div>
              <h3 className={styles.diffH}>8 documentos num lugar só</h3>
              <p className={styles.diffP}>
                Proposta, contrato, procuração, financiamento, recibo, vistoria — <b>tudo o que o
                integrador precisa</b> pra fechar, do orçamento à assinatura.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.15s' }}>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><path d="M4 9h16"/><path d="M12 3 4 7v2h16V7z"/><path d="M6 9v8M10 9v8M14 9v8M18 9v8"/><path d="M3 21h18"/></svg></div>
              <h3 className={styles.diffH}>Aceito nas concessionárias</h3>
              <p className={styles.diffP}>
                Procurações padronizadas pra passar de primeira na <b>CEMIG, Enel, CPFL, Energisa</b>
                e nas principais do Brasil. Menos retrabalho, homologa mais rápido.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><path d="M21 11.5a8 8 0 0 1-11.5 7.2L4 20l1.3-5.5A8 8 0 1 1 21 11.5z"/></svg></div>
              <h3 className={styles.diffH}>Fecha no WhatsApp</h3>
              <p className={styles.diffP}>
                Gera e <b>manda direto pro cliente</b> no computador ou no celular. A proposta chega
                bonita, na hora, enquanto o cliente ainda está quente.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.25s' }}>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg></div>
              <h3 className={styles.diffH}>O dono mesmo usa</h3>
              <p className={styles.diffP}>
                Sem advogado, sem secretária, sem escritório. Foi feito pra <b>quem toca a empresa
                sozinho</b> — abre, cadastra, gera e envia.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.3s' }}>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8"/><circle cx="8.5" cy="11" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="11" r=".6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="11" r=".6" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r=".6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15" r=".6" fill="currentColor" stroke="none"/><circle cx="8.5" cy="18.5" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r=".6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="18.5" r=".6" fill="currentColor" stroke="none"/></svg></div>
              <h3 className={styles.diffH}>Calculadora de Precificação</h3>
              <p className={styles.diffP}>
                Monta o <b>preço certo da venda</b> na hora — custo do kit, margem e comissão.
                Você para de chutar o valor e protege o seu lucro em cada proposta.
              </p>
            </div>
            <div className={styles.diffCard} data-reveal style={{ transitionDelay: '0.35s' }}>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><path d="M3 7 12 3l9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg></div>
              <h3 className={styles.diffH}>Controle de Inventário</h3>
              <p className={styles.diffP}>
                Sabe <b>quanto tem de painel, inversor e material</b> em estoque a qualquer hora.
                Entra e sai automático conforme você vende — sem planilha paralela.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA — 3 passos */}
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

      {/* MÓDULOS — o acesso inteiro, item por item.
          A dinâmica veio da LP de pack de materiais que o Thiago mandou: ela
          NOMEIA os 100 arquivos em 5 módulos, e é isso que faz a oferta parecer
          grande. A nossa listava "8 documentos" e escondia metade da plataforma
          (precificação, inventário, vistoria de campo, escanear conta, terceiros,
          histórico). Aqui está tudo o que o plano de fato libera — nada do que
          não libera: o Kit de Fechamento (curso) é compra à parte e NÃO entra. */}
      <section className={styles.docs}>
        <div className={styles.docsInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>O que você leva</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            <strong>8 documentos + 8 ferramentas</strong>{' '}<br />
            no mesmo acesso.
          </h2>
          <p className={styles.sectionSub} data-reveal>
            Não é um gerador de contrato. É a papelada e a operação da venda solar inteira,
            do orçamento à entrega da obra — item por item, é isto aqui:
          </p>

          <div className={styles.mods}>
            <article className={styles.mod} data-reveal>
              <div className={styles.modTag}>Venda</div>
              <h3 className={styles.modH}>A proposta que fecha</h3>
              <p className={styles.modP}>
                O documento que o cliente abre no WhatsApp e responde &ldquo;fechado&rdquo;.
              </p>
              <ul className={styles.modList}>
                <li>Gerador de Proposta Solar com a sua marca</li>
                <li>Economia na conta e retorno do investimento</li>
                <li>Proposta de Banco pra aprovar financiamento</li>
                <li>PDF pronto pra mandar do celular ou do PC</li>
              </ul>
            </article>

            <article className={styles.mod} data-reveal style={{ transitionDelay: '0.05s' }}>
              <div className={styles.modTag}>Papelada</div>
              <h3 className={styles.modH}>A papelada toda</h3>
              <p className={styles.modP}>
                Os 8 tipos de documento, com cláusulas revisadas pro setor solar.
              </p>
              <ul className={styles.modList}>
                <li>Contrato de Compra e Venda Solar</li>
                <li>Procuração pra concessionária</li>
                <li>Recibo e Prestação de Serviço</li>
                <li>Contrato Vendedor (parceiro comissionado)</li>
                <li>Vistoria Técnica</li>
              </ul>
            </article>

            <article className={styles.mod} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.modTag}>Dinheiro</div>
              <h3 className={styles.modH}>O preço certo da venda</h3>
              <p className={styles.modP}>
                Pra parar de chutar valor e descobrir a margem depois da obra.
              </p>
              <ul className={styles.modList}>
                <li>Calculadora de Precificação</li>
                <li>Custo do kit, margem e comissão na mesma tela</li>
                <li>O preço sai pronto pra virar proposta</li>
              </ul>
            </article>

            <article className={styles.mod} data-reveal style={{ transitionDelay: '0.15s' }}>
              <div className={styles.modTag}>Obra</div>
              <h3 className={styles.modH}>A obra sob controle</h3>
              <p className={styles.modP}>
                O que você hoje resolve em planilha paralela e grupo de WhatsApp.
              </p>
              <ul className={styles.modList}>
                <li>Inventário de painel, inversor e material</li>
                <li>Vistoria Solar de campo, com foto por item</li>
                <li>Entrada e saída conforme você vende</li>
              </ul>
            </article>

            <article className={styles.mod} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.modTag}>Cadastro</div>
              <h3 className={styles.modH}>Cliente e histórico</h3>
              <p className={styles.modP}>
                Cadastrou uma vez, nunca mais digita os mesmos dados.
              </p>
              <ul className={styles.modList}>
                <li><b>Clientes:</b> cadastra uma vez, todo documento puxa</li>
                <li><b>Terceiros:</b> prestadores e vendedores parceiros</li>
                <li><b>Escanear conta de luz:</b> a foto vira o cliente</li>
                <li><b>Documentos salvos</b> pra sempre, buscáveis</li>
              </ul>
            </article>

            <article className={styles.mod} data-reveal style={{ transitionDelay: '0.25s' }}>
              <div className={styles.modTag}>Em todo documento</div>
              <h3 className={styles.modH}>A sua empresa, não a minha</h3>
              <p className={styles.modP}>
                O cliente nunca vê o nome SolarDoc em documento nenhum.
              </p>
              <ul className={styles.modList}>
                <li>Logo, cor e CNPJ em todo documento</li>
                <li>App instalável no celular, funciona na obra</li>
                <li>Recursos novos entram sem custo a mais</li>
              </ul>
            </article>
          </div>

          {/* CTA no meio da página — a pessoa acabou de ver o tamanho da coisa. */}
          <div className={styles.modsCta} data-reveal>
            <button onClick={() => goToCheckout('modulos')} className={styles.offerBtn} disabled={checkoutLoading}>
              {checkoutLoading ? 'Abrindo checkout...' : `Quero tudo isso — R$ ${PRICE}/mês`}
            </button>
            <div className={styles.modsCtaFoot}>
              Acesso na hora · garantia de 7 dias · cancele quando quiser
            </div>
          </div>
        </div>
      </section>

      {/* CARROSSEL — a plataforma por dentro (prints reais, troca sozinho) */}
      <section className={styles.telas}>
        <div className={styles.telasInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>O resultado</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            É <strong>isso que sai</strong> quando você clica em gerar.
          </h2>
          <p className={styles.sectionSub} data-reveal>
            Onze páginas em A4, do orçamento ao inventário — geradas pelo próprio sistema.
            Repare na cor: o documento sai com a marca <b>da sua empresa</b>, não com a nossa.
          </p>

          <div
            className={styles.carrossel}
            data-reveal
            onMouseEnter={() => setPausado(true)}
            onMouseLeave={() => setPausado(false)}
            onTouchStart={() => setPausado(true)}
          >
            {/* sem barra de navegador em volta: o que roda aqui é o DOCUMENTO
                pronto, não um print de tela do sistema */}
            <div className={styles.janela}>
              <div className={styles.slides}>
                {TELAS.map((t, i) => (
                  <picture key={t.img} className={`${styles.slideImg} ${i === slide ? styles.slideOn : ''}`}>
                    <source media="(max-width: 760px)" srcSet={t.imgMobile} />
                    <img
                      src={t.img}
                      alt={`${t.titulo} — tela do SolarDoc`}
                      width={1400}
                      height={880}
                      loading={i === 0 ? 'eager' : 'lazy'}
                    />
                  </picture>
                ))}
              </div>
            </div>

            <div className={styles.slideLegenda} aria-live="polite">
              <b>{TELAS[slide].titulo}</b>
              <span>{TELAS[slide].texto}</span>
            </div>

            <div className={styles.dots} role="tablist" aria-label="Telas da plataforma">
              {TELAS.map((t, i) => (
                <button
                  key={t.img}
                  type="button"
                  role="tab"
                  aria-selected={i === slide}
                  aria-label={t.titulo}
                  className={`${styles.dot} ${i === slide ? styles.dotOn : ''}`}
                  onClick={() => { setSlide(i); trackEvent('cta_click', { label: `tela_${i}` }); }}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* COMPARATIVO — com/sem SolarDoc */}
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

      {/* QUEM FEZ — foto dos dois donos */}
      <section className={styles.founders}>
        <div className={styles.foundersInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>Quem fez</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Não é software de escritório. <strong>É de quem vende solar.</strong>
          </h2>

          <div className={styles.foundersCard} data-reveal>
            <div className={styles.foundersPeople}>
              <figure className={styles.founder}>
                <img src="/founder-thiago.webp" width={128} height={128} alt="Thiago, sócio-fundador do SolarDoc" loading="lazy" />
                <figcaption>
                  <span className={styles.founderName}>Thiago</span>
                  <span className={styles.founderRole}>Sócio-fundador</span>
                </figcaption>
              </figure>
              <figure className={styles.founder}>
                <img src="/founder-diego.webp" width={128} height={128} alt="Diego, sócio-fundador do SolarDoc" loading="lazy" />
                <figcaption>
                  <span className={styles.founderName}>Diego</span>
                  <span className={styles.founderRole}>Sócio-fundador</span>
                </figcaption>
              </figure>
            </div>

            <div className={styles.foundersText}>
              <p>
                A gente é o <b>Thiago e o Diego</b>, irmãos, do Triângulo Mineiro. Trabalhamos com
                energia solar — e o SolarDoc nasceu de um problema que era nosso: <b>a venda esfriava
                esperando papel</b>. Proposta no Word, contrato remendado, procuração recusada na
                concessionária, tarde inteira perdida.
              </p>
              <p>
                Montamos a ferramenta pra usar no nosso dia a dia e depois abrimos pros outros
                integradores. Por isso ela não tem nada sobrando: <b>tem o que a gente usa pra
                fechar venda</b>.
              </p>
              <p className={styles.foundersKicker}>
                Cada tela dessa plataforma passou por uma venda nossa antes de virar produto. Se
                tem alguma coisa aqui, é porque fez falta em obra — não porque ficou bonito no
                projeto.
              </p>
              <a
                href={WHATSAPP}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.foundersWa}
                onClick={() => trackEvent('cta_click', { label: 'whatsapp_founders' })}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.17h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.4c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.83 2.41a8.19 8.19 0 0 1 2.41 5.83c0 4.54-3.7 8.25-8.24 8.25zm4.52-6.17c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.53.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.22.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.16 1.73 2.64 4.2 3.71.59.25 1.04.4 1.4.52.59.19 1.12.16 1.54.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29z"/></svg>
                Falar com a gente no WhatsApp
              </a>
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

      {/* OFERTA — plano único */}
      <section id="planos" className={styles.plans} style={{ scrollMarginTop: 80 }}>
        <div className={styles.plansInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>A oferta</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Um preço só. <strong>Tudo liberado.</strong>
          </h2>
          <p className={styles.sectionSub} data-reveal>
            Sem versão capada, sem escolher entre plano A e B, sem esperar liberação.
            Você assina e entra na plataforma completa na hora.
          </p>

          <div className={styles.offer} data-reveal>
            <div className={styles.offerTag}>Acesso imediato</div>

            <div className={styles.offerHead}>
              <div>
                <div className={styles.offerName}>SolarDoc Pro — completo</div>
                <div className={styles.offerAnchor}>
                  Software de proposta solar no mercado: <b>R$ 100 a R$ 300/mês</b>
                </div>
                <div className={styles.offerPrice}>
                  <span>R$</span>{PRICE}<small>/mês</small>
                </div>
                <div className={styles.offerPerDay}>
                  dá <b>R$ {PRICE_DIA} por dia</b> — menos que o combustível de uma visita
                </div>

                {/* Garantia de 7 dias — mesma política que a Sol (suporte) já informa
                    aos clientes: devolução total sem perguntas. É o que substitui o
                    risco que o trial cobria, agora que a cobrança é imediata. */}
                <div className={styles.guarantee}>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
                  <div>
                    <b>Garantia de 7 dias.</b> Não serviu? Chama no WhatsApp dentro dos 7 dias
                    que a gente devolve o valor integral, sem perguntas.
                  </div>
                </div>
              </div>

              <ul className={styles.offerList}>
                <li><b>Documentos ilimitados</b> — sem teto no mês</li>
                <li>Os <b>8 tipos de documento</b> com a sua logo e a sua cor</li>
                <li>Proposta solar completa pronta pra enviar no WhatsApp</li>
                <li>Procurações aceitas nas principais concessionárias</li>
                <li>Calculadora de precificação e controle de inventário</li>
                <li>Cadastro de clientes e de prestadores parceiros</li>
                <li>Escaneia a conta de luz e preenche o cliente sozinho</li>
                <li><b>Histórico salvo pra sempre</b> — acha qualquer contrato depois</li>
                <li>Atualizações e recursos novos inclusos, sem pagar mais</li>
                <li>Suporte no WhatsApp e no chat de dentro da plataforma</li>
              </ul>
            </div>

            <button
              onClick={() => goToCheckout('oferta')}
              className={styles.offerBtn}
              disabled={checkoutLoading}
            >
              {ctaLabel}
            </button>

            <div className={styles.offerFoot}>
              Cobrança na hora, no cartão. Liberou o pagamento, você já cria a senha e entra.
              <br />
              Sem fidelidade — cancela sozinho em <b>Minha conta → Gerenciar assinatura</b>.
            </div>
          </div>

          <div className={styles.offerBadges} data-reveal>
            <span className={styles.offerBadge}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Pagamento seguro pela Stripe
            </span>
            <span className={styles.offerBadge}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
              Cancela quando quiser, sem multa
            </span>
            <span className={styles.offerBadge}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21 11.5a8 8 0 0 1-11.5 7.2L4 20l1.3-5.5A8 8 0 1 1 21 11.5z"/></svg>
              Suporte no WhatsApp e no chat
            </span>
          </div>

          {/* O QUE ACONTECE DEPOIS DE PAGAR — com a cobrança imediata, a dúvida
              "paguei, e agora?" virou objeção de compra. Os 3 passos são o fluxo
              real: Stripe → /auth?session= (define senha) → empresa → documento. */}
          <div className={styles.after} data-reveal>
            <div className={styles.afterTitle}>Depois que você assina</div>
            <ol className={styles.afterSteps}>
              <li>
                <span className={styles.afterNum}>1</span>
                <div>
                  <b>Passa o cartão</b> — checkout da Stripe, cobrança na hora. Leva 1 minuto.
                </div>
              </li>
              <li>
                <span className={styles.afterNum}>2</span>
                <div>
                  <b>Cria sua senha</b> — a tela já abre pra isso. Se fechar a aba antes, o link
                  chega no seu e-mail e no seu WhatsApp: a conta é criada paga do mesmo jeito.
                </div>
              </li>
              <li>
                <span className={styles.afterNum}>3</span>
                <div>
                  <b>Sobe a logo e gera</b> — cadastra a empresa uma vez e o primeiro documento
                  sai com a sua marca em 2 minutos.
                </div>
              </li>
            </ol>
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
            Tira a dúvida. Depois assina.
          </h2>

          <div className={styles.faqList}>
            <details className={styles.faqItem} data-reveal>
              <summary>Quando eu sou cobrado e quando libera?</summary>
              <div className={styles.faqAnswer}>
                A cobrança é <b>na hora</b>: você passa o cartão no checkout da Stripe e o acesso já é
                liberado. Na sequência você define a senha e entra na plataforma. Depois disso,
                renova uma vez por mês, no mesmo dia.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>E se eu pagar e não gostar?</summary>
              <div className={styles.faqAnswer}>
                Você tem <b>7 dias de garantia</b>: se não servir pra você, devolvemos o valor
                integral, sem perguntas. É só chamar no WhatsApp dentro dos 7 dias.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Tem plano mais barato?</summary>
              <div className={styles.faqAnswer}>
                Não tem plano capado. É <b>um preço só, R$ {PRICE} por mês</b>, com tudo liberado —
                documentos ilimitados, histórico permanente e todos os recursos. A gente cortou os
                planos menores justamente pra ninguém entrar e descobrir que o que precisa está no
                plano de cima.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Posso cancelar depois?</summary>
              <div className={styles.faqAnswer}>
                Pode, a qualquer momento e sem multa: <b>Minha conta → Gerenciar assinatura</b>. Você
                mesmo cancela, sem precisar pedir pra ninguém, e não é cobrado no mês seguinte.
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

            <details className={styles.faqItem} data-reveal>
              <summary>Já assino um plano antigo. Muda alguma coisa?</summary>
              <div className={styles.faqAnswer}>
                Nada muda: sua assinatura continua valendo pelo mesmo valor de sempre. Se quiser subir
                pro acesso completo, é pelo próprio painel — e a diferença é cobrada proporcional.
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
            Um plano só, R$ {PRICE} por mês, tudo liberado — e você entra hoje mesmo.
          </p>
          <div data-reveal>
            <button className={styles.finalCtaBtn} onClick={() => goToCheckout('final')} disabled={checkoutLoading}>
              {checkoutLoading ? 'Abrindo checkout...' : 'Assinar agora →'}
            </button>
            <div className={styles.finalCtaFoot}>
              R$ {PRICE}/mês · acesso na hora · garantia de 7 dias · cancele quando quiser.
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
            <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">Suporte WhatsApp</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
