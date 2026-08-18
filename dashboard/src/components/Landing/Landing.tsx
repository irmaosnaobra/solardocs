'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLpTracking, getCheckoutAttribution } from '@/hooks/useLpTracking';
import api from '@/services/api';
import { marcarSaidaProCheckout } from '@/lib/saidaCheckout';
import { VSL } from './vsl';
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

// PLANO ANUAL (14/08/2026). R$ 564 de uma vez, o que dá R$ 47/mês.
//
// A ordem dos dois números importa e foi corrigida em 15/08: nasceu com o
// "R$ 47/mês" em destaque e o total em letra miúda, dentro do card do mensal.
// Gente clicava achando que ia pagar 47, batia num checkout de R$ 564 e desistia
// — abandono causado pela própria vitrine. Agora o preço em destaque é o COBRADO
// (564) e o equivalente por mês é a legenda embaixo; ele continua fazendo o
// mensal ser lido como caro, sem prometer um valor que a Stripe não vai cobrar.
// Os R$ 240 são conta fechada e conferível na própria página: 67×12 = 804.
const PRICE_ANUAL = 564;
const PRICE_ANUAL_MES = 47;
const PRICE_ANUAL_ECONOMIA = PRICE * 12 - PRICE_ANUAL; // 240

// As duas ferramentas que o anual entrega PRA SEMPRE (gravadas em `entitlements`
// pelo webhook). O preço é o de venda avulsa na loja — `preco: 67` das duas em
// `src/lib/produtos.ts`, e o mesmo que a Kiwify cobra por "Calculadora Solar" e
// "Inventário Empresarial". Se mudar lá, muda aqui: número de vitrine que não
// bate com a loja é promessa quebrada a um clique de distância.
const PRECO_FERRAMENTA = 67;
const FERRAMENTAS_VALOR = PRECO_FERRAMENTA * 2; // 134
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
/* DEPOIMENTOS — prova social de cliente.
   VAZIO DE PROPOSITO. A secao so' aparece quando tiver frase de cliente de
   verdade: nome, empresa e autorizacao pra publicar. Depoimento inventado e'
   publicidade enganosa e e' o ponto fraco da concorrencia (as 3 conversas da
   maletapainelsolar.netlify.app sao todas assinadas "Instalador Solar", sem
   nome e sem foto — da' pra ver que e' montado).
   Pra publicar: cola os objetos aqui. A secao monta sozinha.
   { nome: 'Alessandro Goulart', empresa: 'Força Solar', iniciais: 'AG',
     texto: 'frase exata que a pessoa mandou', quando: 'agosto de 2026' } */
const DEPOIMENTOS: { nome: string; empresa: string; iniciais: string; texto: string; quando: string }[] = [];

const TELAS = [
  { img: '/tela/doc-proposta-a4.webp',   imgMobile: '/tela/doc-proposta-a4-mobile.webp',
    titulo: 'Orçamento de 1 página',
    texto: 'Investimento, economia mensal e tempo de retorno numa folha só, pronta pro WhatsApp.' },

  { img: '/tela/doc-proposta.webp',      imgMobile: '/tela/doc-proposta-mobile.webp',
    titulo: 'Proposta comercial',
    texto: 'Economia em 25 anos, conta antes e depois e geração mês a mês — na marca da empresa.' },

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
      // ATENÇÃO ao threshold: #planos é MAIS ALTA que a tela do celular
      // (2.877px contra os 844px do iPhone). Com `threshold: 0.3` o observer
      // exigia 863px visíveis de uma vez — mais do que a tela inteira tem — e
      // no celular NUNCA disparava. A seção cresceu duas vezes (card anual em
      // 14/08, selos "só no plano anual" em 17/08) e o evento morreu em
      // silêncio: 24 sessões/dia em 13/08 viraram 2 em 18/08 sem ninguém ter
      // parado de rolar a página (a rolagem até 100% não mudou no mesmo
      // período). Agora basta a seção encostar na metade de cima da tela —
      // regra que vale pra qualquer altura que ela venha a ter.
      { threshold: 0, rootMargin: '0px 0px -45% 0px' }
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

  // VSL: `preload="none"` no player garante que quem rola a LP inteira sem
  // clicar não baixa um byte de vídeo — só a capa. Vídeo é o item mais caro da
  // página, e a maior parte do tráfego aqui é celular no 4G.
  const [vslTocando, setVslTocando] = useState(false);
  const [vslMarcos, setVslMarcos] = useState<Record<string, boolean>>({});
  const vslRef = useRef<HTMLVideoElement>(null);

  // Um evento por marco (play / metade / fim). Sem a trava, o 'timeupdate'
  // dispararia 'metade' umas 4× por segundo até o vídeo acabar.
  function vslMarco(acao: string) {
    setVslMarcos(prev => {
      if (prev[acao]) return prev;
      trackEvent('vsl', { acao });
      return { ...prev, [acao]: true };
    });
  }

  // Fluxo LP → Stripe → Cadastro: clica e vai DIRETO pro checkout público do
  // Stripe (email + cartão, cobrado na hora). Só depois de aprovar o cartão a
  // pessoa cria a conta. Sem free, sem trial.
  async function goToCheckout(label: string, plano: 'vip' | 'vip_anual' = 'vip') {
    const ehAnual = plano === 'vip_anual';
    trackEvent('cta_click', { label });
    if (typeof window !== 'undefined' && window.fbq) {
      // `value` é o que a Meta vai otimizar. No anual tem que ser 564 (o que
      // entra), não os 47 da vitrine — senão o algoritmo trata a melhor venda
      // da página como a mais barata dela.
      window.fbq('track', 'InitiateCheckout', {
        content_name: ehAnual ? 'vip_anual' : 'vip',
        value: ehAnual ? PRICE_ANUAL : PRICE,
        currency: 'BRL',
      });
    }
    setCheckoutLoading(true);
    try {
      // Atribuição: manda o session_id da LP + UTMs (de sessionStorage) junto.
      // O backend grava no metadata do Stripe → receita atribuída à campanha.
      const { data } = await api.post('/payments/public-checkout', {
        plan: plano,
        ...getCheckoutAttribution(),
      });
      if (data?.url) {
        // Guarda a saída ANTES de sair: quem volta pelo botão do navegador não
        // passa pelo cancel_url da Stripe e cairia de novo nesta LP.
        marcarSaidaProCheckout(data.cancelUrl);
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

  // ---- Carrossel das folhas. É webp e não GIF de propósito: um GIF de tela
  // cheia dá 2 a 5 MB cada e mata o carregamento no 4G — aqui cada folha tem
  // ~70 KB e o movimento vem da troca automática.
  //
  // GIRA SEM PARAR, 1,5s (07/08/2026). Antes pausava no hover e no toque — e
  // era isso que parecia bug: bastava levar o mouse até ele pra olhar, e ele
  // congelava na hora. Pausa nenhuma agora; quem quiser fixar uma folha clica
  // no pontinho, que troca o slide e o giro segue dali.
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSlide(s => (s + 1) % TELAS.length), 1500);
    return () => clearInterval(id);
  }, []);

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
            {/* A headline anterior era "Você fecha a venda solar com a sua marca.
                Não só gera papel." Ela respondia uma objeção que o leitor ainda
                não tinha feito ("papel"?) e vendia DIFERENCIAL DE PRODUTO (a
                marca) no lugar de RESULTADO.

                Quem lê isto fecha venda na hora, com o cliente na frente. O
                inimigo dele não é outro software — é o "vou pensar", que é onde
                a venda solar morre. Nomear a frase que ele ouve toda semana faz
                a headline ser dele, não nossa. A marca não sumiu: desceu pro
                sub, que é onde diferencial pertence. */}
            <h1 className={styles.h1}>
              Feche a venda <strong>antes do &ldquo;vou pensar&rdquo;</strong>.
            </h1>

            <p className={styles.lead} style={{ margin: '0 auto 26px' }}>
              Proposta e contrato com a <b>sua marca</b>, prontos em minutos — na frente do cliente
              ou no WhatsApp dele. Enquanto o concorrente promete mandar depois, você já mandou.
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
              Liberar meu acesso — R$ {PRICE}/mês →
            </button>

            <div className={styles.pricePill}>
              <b>R$ {PRICE}/mês</b>
              <span className={styles.pricePillSep} aria-hidden />
              acesso liberado na hora
            </div>

            {/* VÍDEO NA PRIMEIRA TELA — DESLIGADO em 18/08/2026 (ordem do Thiago).
                O bloco continua aqui inteiro e volta sozinho no dia em que
                `VSL.src` receber uma URL de novo: entra logo abaixo do primeiro
                CTA, com a pílula de preço ainda colada no botão (separar os dois
                quebra o par "clica / é isso que custa"). */}
            {VSL.src ? (
              <div className={styles.vslHero} id="vsl">
                <p className={styles.vslHeroLinha}>
                  Prefere trabalhar no <b>computador</b>? Veja rodando na tela grande.
                </p>

                <div
                  className={styles.vslPalco}
                  style={{ aspectRatio: VSL.proporcao, maxWidth: VSL.proporcao === '9 / 16' ? 340 : undefined }}
                >
                  {/* O <video> fica SEMPRE montado, com a capa por cima. Trocar o
                      botão pelo player no clique parece equivalente, mas o iOS só
                      deixa tocar vídeo com som quando o play() sai do próprio gesto
                      do dedo — num elemento que acabou de nascer, não sai, e o
                      visitante ficaria olhando um player parado. Com `preload="none"`
                      nada é baixado até o play, então montar cedo não custa banda. */}
                  <video
                    ref={vslRef}
                    className={styles.vslVideo}
                    src={VSL.src}
                    poster={VSL.poster || undefined}
                    controls={vslTocando}
                    playsInline
                    preload="none"
                    onPlay={() => { setVslTocando(true); vslMarco('play'); }}
                    onTimeUpdate={(e) => {
                      const v = e.currentTarget;
                      if (v.duration && v.currentTime / v.duration >= 0.5) vslMarco('metade');
                    }}
                    onEnded={() => vslMarco('fim')}
                  />
                  {!vslTocando ? (
                    <button
                      type="button"
                      className={styles.vslCapa}
                      onClick={() => {
                        setVslTocando(true);
                        vslMarco('play');
                        vslRef.current?.play().catch(() => {
                          // autoplay barrado: os controles nativos já apareceram,
                          // a pessoa dá play neles. Melhor que capa travada.
                        });
                      }}
                      aria-label="Assistir o vídeo: o orçamento pelo computador"
                    >
                      {VSL.poster ? (
                        <img src={VSL.poster} alt="" width={720} height={1280} loading="lazy" />
                      ) : null}
                      <span className={styles.vslPlay} aria-hidden>
                        <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" /></svg>
                      </span>
                      {VSL.duracao ? <span className={styles.vslDur}>{VSL.duracao}</span> : null}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* FUNCIONA EM — mesma faixa das LPs de produto. Mora FORA do bloco
                do vídeo de propósito: a pergunta "e no MEU aparelho?" continua
                existindo com ou sem VSL na página. Enquanto a faixa estava
                dentro do `VSL.src ?`, desligar o vídeo levava ela junto — e ela
                nunca foi parte do vídeo, é a resposta pra quem NÃO quer assistir. */}
            <div className={styles.rodaEmSozinha}>
                <div className={styles.rodaEm}>
                  <span className={styles.rodaEmTitulo}>Funciona em</span>
                  <ul className={styles.rodaEmLista}>
                    <li>
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M6.4 10.2h11.2v6.6a1.6 1.6 0 0 1-1.6 1.6H8a1.6 1.6 0 0 1-1.6-1.6v-6.6Z" />
                        <rect x="3.1" y="10.2" width="2.4" height="6" rx="1.2" />
                        <rect x="18.5" y="10.2" width="2.4" height="6" rx="1.2" />
                        <rect x="8.9" y="18.4" width="2.3" height="4.2" rx="1.15" />
                        <rect x="12.8" y="18.4" width="2.3" height="4.2" rx="1.15" />
                        <path d="M6.6 9.2a5.4 5.4 0 0 1 10.8 0H6.6Z" />
                        <path d="M8.2 4.1 7.1 2.3M15.8 4.1l1.1-1.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
                      </svg>
                      Android
                    </li>
                    <li>
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M16.9 12.6c0-2.4 2-3.6 2.1-3.7-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.15-2.9.88-3.65.88-.76 0-1.92-.86-3.16-.84-1.63.03-3.13.95-3.96 2.4-1.69 2.93-.43 7.27 1.21 9.65.8 1.16 1.76 2.47 3.02 2.42 1.21-.05 1.67-.78 3.14-.78 1.46 0 1.88.78 3.16.76 1.31-.02 2.14-1.19 2.94-2.36.92-1.35 1.3-2.65 1.32-2.72-.03-.01-2.54-.98-2.57-3.86Z" />
                        <path d="M14.5 5.6c.67-.81 1.12-1.94.99-3.06-.96.04-2.12.64-2.81 1.45-.62.72-1.16 1.87-1.02 2.97 1.07.08 2.17-.55 2.84-1.36Z" />
                      </svg>
                      iPhone e iPad
                    </li>
                    <li>
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M3 5.6l7.6-1.05v7.1H3V5.6Z" />
                        <path d="M11.6 4.4 21 3.1v8.55h-9.4V4.4Z" />
                        <path d="M3 12.65h7.6v7.1L3 18.7v-6.05Z" />
                        <path d="M11.6 12.65H21v8.55l-9.4-1.3v-7.25Z" />
                      </svg>
                      Windows
                    </li>
                    <li>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
                        <circle cx="12" cy="12" r="9.1" strokeWidth="1.7" />
                        <ellipse cx="12" cy="12" rx="4" ry="9.1" strokeWidth="1.5" />
                        <path d="M3.3 9.2h17.4M3.3 14.8h17.4" strokeWidth="1.5" />
                      </svg>
                      Qualquer navegador
                    </li>
                  </ul>
                  <p className={styles.rodaEmNota}>
                    Abre no navegador — <b>nada pra instalar</b>. Se quiser, dá pra fixar na tela
                    inicial do celular e usar como aplicativo.
                  </p>
                </div>
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
            Tudo o que trava a sua venda, <strong>resolvido num acesso só</strong>.
          </h2>
          {/* As duas ferramentas são produto pago na loja (R$ 67 cada) e, desde
              17/08/2026, EXCLUSIVAS DO PLANO ANUAL — o mensal não libera. Elas
              continuam nesta seção porque são parte do que a plataforma faz, mas
              com o ciclo escrito na cara: prometer no mensal o que só o anual
              entrega é a reclamação de amanhã. O gate obedece `entitlements`,
              gravado na venda do anual. */}
          <p className={styles.sectionSub} data-reveal>
            Tudo isto entra na assinatura. As <b>duas ferramentas de R$ {PRECO_FERRAMENTA}</b>{' '}
            que a loja vende à parte vêm no <b>plano anual</b> — e nele ficam suas pra sempre.
          </p>

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
            <div className={`${styles.diffCard} ${styles.diffPago}`} data-reveal style={{ transitionDelay: '0.3s' }}>
              <div className={styles.diffFita}>Só no plano anual · vale R$ {PRECO_FERRAMENTA}</div>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8"/><circle cx="8.5" cy="11" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="11" r=".6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="11" r=".6" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r=".6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15" r=".6" fill="currentColor" stroke="none"/><circle cx="8.5" cy="18.5" r=".6" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r=".6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="18.5" r=".6" fill="currentColor" stroke="none"/></svg></div>
              <h3 className={styles.diffH}>Precificação Profissional</h3>
              <p className={styles.diffP}>
                Monta o <b>preço certo da venda</b> na hora — custo do kit, imposto, ART,
                deslocamento, margem e comissão. Você arrasta a margem e vê a sua sobra
                antes de mandar o preço.
              </p>
              {/* Dizer o preço cheio AQUI, onde a ferramenta aparece pela primeira vez,
                  é o que faz os "R$ 134 inclusos" do card anual significarem algo lá
                  embaixo: preço só vira desconto depois que a pessoa sabe o preço. */}
              <div className={styles.diffValor}>
                Quem não assina compra por <b>R$ {PRECO_FERRAMENTA}</b> na loja
              </div>
            </div>
            <div className={`${styles.diffCard} ${styles.diffPago}`} data-reveal style={{ transitionDelay: '0.35s' }}>
              <div className={styles.diffFita}>Só no plano anual · vale R$ {PRECO_FERRAMENTA}</div>
              <div className={styles.diffIcon}><svg viewBox="0 0 24 24"><path d="M3 7 12 3l9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg></div>
              <h3 className={styles.diffH}>Inventário da Empresa</h3>
              <p className={styles.diffP}>
                Sabe <b>onde está cada ferramenta e quanto vale o patrimônio</b> — painel,
                inversor, EPI e material. Com aviso do que está acabando antes de faltar
                na obra.
              </p>
              <div className={styles.diffValor}>
                Quem não assina compra por <b>R$ {PRECO_FERRAMENTA}</b> na loja
              </div>
            </div>
          </div>

          {/* O fecho da seção: a soma. R$ 134 em ferramentas pagas dentro de um
              plano de R$ 564 é o argumento mais forte que a página tem — e é do
              ANUAL, não da assinatura em geral. O número é conferível na loja. */}
          <div className={styles.diffResumo} data-reveal>
            <div className={styles.diffResumoTopo}>
              <b>R$ {FERRAMENTAS_VALOR} em ferramentas</b> inclusas no plano anual
            </div>
            <p className={styles.diffResumoP}>
              A Precificação e o Inventário são produtos pagos na nossa loja, R${' '}
              {PRECO_FERRAMENTA} cada. No plano anual as duas abrem na sua conta no mesmo
              minuto e ficam <b>suas pra sempre</b>, mesmo se um dia você parar de assinar.
              No mensal, dá pra comprar cada uma à parte quando quiser.
            </p>
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
            do orçamento à entrega da obra — item por item, é isto aqui. Os dois blocos
            marcados <b>&ldquo;no plano anual&rdquo;</b> são as ferramentas que a loja vende
            à parte por R$ {PRECO_FERRAMENTA} cada.
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
                <li>A procuração que passa de primeira na concessionária</li>
                <li>O recibo que mostra quanto o cliente já pagou</li>
                <li>O contrato do vendedor parceiro, com a comissão no papel</li>
                <li>A vistoria assinada antes de a obra começar</li>
              </ul>
            </article>

            {/* Estes dois módulos são as ferramentas do ANUAL (17/08). Ficam na
                lista porque fazem parte do que a plataforma resolve — mas com a
                etiqueta do ciclo, senão a seção "o que você leva" promete no
                mensal o que só o anual entrega. */}
            <article className={`${styles.mod} ${styles.modAnual}`} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.modTag}>Dinheiro</div>
              <div className={styles.modSeloAnual}>No plano anual</div>
              <h3 className={styles.modH}>O preço certo da venda</h3>
              <p className={styles.modP}>
                Pra parar de chutar valor e descobrir a margem depois da obra.
              </p>
              <ul className={styles.modList}>
                <li>Precificação: quanto cobrar sem descobrir a margem depois</li>
                <li>Custo do kit, margem e comissão na mesma tela</li>
                <li>O preço sai pronto pra virar proposta</li>
              </ul>
            </article>

            <article className={`${styles.mod} ${styles.modAnual}`} data-reveal style={{ transitionDelay: '0.15s' }}>
              <div className={styles.modTag}>Obra</div>
              <div className={styles.modSeloAnual}>No plano anual</div>
              <h3 className={styles.modH}>A obra sob controle</h3>
              <p className={styles.modP}>
                O que você hoje resolve em planilha paralela e grupo de WhatsApp.
              </p>
              <ul className={styles.modList}>
                <li>Inventário: onde foi parar o inversor, o painel e o material</li>
                <li>Onde está cada item e quanto vale o patrimônio</li>
                <li>Aviso do que está acabando antes de faltar na obra</li>
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
            {/* Numeros conferidos no banco em 18/08/2026 e SEM a conta dos socios
                (aiorosgroup@gmail.com, 168 documentos de uso proprio) — o que esta'
                aqui e' uso de empresa cliente. Ao atualizar, rodar de novo:
                  documentos:  select count(*) from documents where user_id <> <socio>
                  empresas:    select count(*) from company where cnpj <> ''
                  ultimos 30d: idem documentos + created_at >= now() - interval '30 days' */}
            <div className={styles.stat} data-reveal>
              <div className={styles.statN}>1.671</div>
              <div className={styles.statL}>Documentos solares gerados por empresas clientes</div>
            </div>
            <div className={styles.stat} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.statN}>150</div>
              <div className={styles.statL}>Empresas solares com CNPJ cadastradas</div>
            </div>
            <div className={styles.stat} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.statN}>956</div>
              <div className={styles.statL}>Documentos gerados nos últimos 30 dias</div>
            </div>
          </div>

          {DEPOIMENTOS.length > 0 && (
            <div className={styles.depoGrid}>
              {DEPOIMENTOS.map((d, i) => (
                <article
                  key={d.nome}
                  className={styles.depoCard}
                  data-reveal
                  style={{ transitionDelay: `${0.05 * i}s` }}
                >
                  <div className={styles.depoHead}>
                    <div className={styles.depoAvatar} aria-hidden>{d.iniciais}</div>
                    <div className={styles.depoQuem}>
                      <div className={styles.depoNome}>{d.nome}</div>
                      <div className={styles.depoEmpresa}>{d.empresa} · {d.quando}</div>
                    </div>
                  </div>
                  <p className={styles.depoTexto}>{d.texto}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* OFERTA — plano único */}
      <section id="planos" className={styles.plans} style={{ scrollMarginTop: 80 }}>
        <div className={styles.plansInner}>
          <div className={styles.sectionLabelWrap}>
            <span className={styles.sectionLabel} data-reveal>A oferta</span>
          </div>
          <h2 className={styles.sectionTitle} data-reveal>
            Um acesso só. <strong>Você escolhe como pagar.</strong>
          </h2>
          <p className={styles.sectionSub} data-reveal>
            A plataforma é a mesma nos dois, completa desde o primeiro minuto. A única
            diferença é o ciclo: <b>R$ {PRICE} todo mês</b> ou <b>R$ {PRICE_ANUAL} uma vez</b>,
            valendo o ano.
          </p>

          {/* DOIS CARDS SEPARADOS, e o anual mostrando o valor que a Stripe vai
              cobrar. Antes o anual morava DENTRO do card mensal e liderava com
              "R$ 47/mês" — a pessoa clicava achando que ia pagar 47, batia num
              checkout de R$ 564 e desistia. O equivalente por mês continua na
              tela (é ele que faz o anual parecer barato), mas embaixo do preço
              cheio, nunca no lugar dele. */}
          <div className={styles.offerGrid} data-reveal>
            <div className={styles.offer}>
              <div className={styles.offerTag}>Mensal</div>

              <div className={styles.offerName}>SolarDoc Pro — mês a mês</div>
              <div className={styles.offerAnchor}>
                Software de proposta solar no mercado: <b>R$ 100 a R$ 300/mês</b>
              </div>
              <div className={styles.offerPrice}>
                <span>R$</span>{PRICE}<small>/mês</small>
              </div>
              <div className={styles.offerCobranca}>
                Cobrado <b>todo mês</b> no cartão, R$ {PRICE} por vez
              </div>
              <div className={styles.offerPerDay}>
                dá <b>R$ {PRICE_DIA} por dia</b> — menos que o combustível de uma visita
              </div>

              <button
                onClick={() => goToCheckout('oferta')}
                className={styles.offerBtn}
                disabled={checkoutLoading}
              >
                {ctaLabel}
              </button>

              <div className={styles.offerFoot}>
                Liberou o pagamento, você já cria a senha e entra.
                <br />
                Sem fidelidade — cancela sozinho em <b>Minha conta → Gerenciar assinatura</b>.
              </div>

              <ul className={styles.offerList}>
                <li><b>Documentos ilimitados</b> — sem teto no mês</li>
                <li>Os <b>8 tipos de documento</b> com a sua logo e a sua cor</li>
                <li>Proposta solar completa pronta pra enviar no WhatsApp</li>
                <li>Procurações aceitas nas principais concessionárias</li>
                {/* A precificação e o inventário SAÍRAM desta lista em 17/08: são
                    do plano anual. Bullet de mensal prometendo ferramenta de anual
                    é o cliente descobrindo por dentro, depois de pagar. */}
                <li>Cadastro de clientes e de prestadores parceiros</li>
                <li>Escaneia a conta de luz e preenche o cliente sozinho</li>
                <li><b>Histórico salvo pra sempre</b> — acha qualquer contrato depois</li>
                <li>Atualizações e recursos novos inclusos, sem pagar mais</li>
                <li>Suporte no WhatsApp e no chat de dentro da plataforma</li>
              </ul>
            </div>

            <div className={styles.anualCard}>
              <div className={styles.anualCardTag}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M20 6 9 17l-5-5"/></svg>
                Economize R$ {PRICE_ANUAL_ECONOMIA}
              </div>

              <div className={styles.anualName}>SolarDoc Pro — 12 meses</div>
              <div className={styles.anualAnchor}>
                Mesma plataforma, um pagamento só no lugar de doze
              </div>
              <div className={styles.anualPrecoCheio}>
                <span>R$</span>{PRICE_ANUAL}
              </div>
              {/* A frase que faltava. O checkout cobra 564 na hora, e é isso que
                  a pessoa precisa ter lido ANTES de clicar. */}
              <div className={styles.anualCobranca}>
                Uma <b>única cobrança de R$ {PRICE_ANUAL}</b> hoje, no cartão — não é
                parcelado nem mensal
              </div>
              <div className={styles.anualEquiv}>
                sai <b>R$ {PRICE_ANUAL_MES} por mês</b> em vez de <s>R$ {PRICE}</s> — 12 meses
                pelo preço de {Math.round(PRICE_ANUAL / PRICE)}
              </div>

              {/* AS DUAS FERRAMENTAS, com o preço que elas custam na loja. É o
                  único item do anual que não é "o mesmo acesso mais barato": são
                  duas compras que a pessoa levaria à parte por R$ 67 cada e que
                  aqui ficam dela pra sempre. Estava escondido num bullet no pé do
                  card — agora é bloco com valor na cara. */}
              <div className={styles.bonus}>
                <div className={styles.bonusTopo}>
                  <span className={styles.bonusTitulo}>
                    Leva <b>2 ferramentas pra sempre</b>
                  </span>
                  <span className={styles.bonusValor}>R$ {FERRAMENTAS_VALOR} inclusos</span>
                </div>

                <div className={styles.bonusItens}>
                  <div className={styles.bonusItem}>
                    <div className={styles.bonusNome}>Precificação Profissional</div>
                    <div className={styles.bonusTexto}>
                      O preço que fecha a venda e ainda sobra margem — com imposto, ART,
                      deslocamento e comissão na conta
                    </div>
                    <div className={styles.bonusPreco}>
                      vendida à parte por <b>R$ {PRECO_FERRAMENTA}</b>
                    </div>
                  </div>

                  <div className={styles.bonusItem}>
                    <div className={styles.bonusNome}>Inventário da Empresa</div>
                    <div className={styles.bonusTexto}>
                      Onde está cada ferramenta e quanto vale o patrimônio, com aviso do
                      que está acabando
                    </div>
                    <div className={styles.bonusPreco}>
                      vendido à parte por <b>R$ {PRECO_FERRAMENTA}</b>
                    </div>
                  </div>
                </div>

                <div className={styles.bonusNota}>
                  As duas ficam liberadas na sua conta <b>pra sempre</b> — continuam
                  funcionando mesmo se um dia você parar de assinar. <b>Só no anual:</b> no
                  plano mensal elas são compra à parte, R$ {PRECO_FERRAMENTA} cada.
                </div>
              </div>

              <button
                onClick={() => goToCheckout('oferta_anual', 'vip_anual')}
                className={styles.anualBtn}
                disabled={checkoutLoading}
              >
                {checkoutLoading ? 'Abrindo checkout...' : `Pagar R$ ${PRICE_ANUAL} pelo ano`}
              </button>

              <div className={styles.anualFoot}>
                Renova só daqui a 12 meses. A mesma garantia de 7 dias vale aqui: não
                serviu, devolvemos o valor inteiro.
              </div>

              <ul className={styles.anualList}>
                <li><b>Tudo do plano mensal</b>, exatamente igual</li>
                <li>Preço travado por 12 meses: reajuste não te pega no meio</li>
                <li>Um pagamento no ano — sem cobrança voltando todo mês no cartão</li>
              </ul>
            </div>
          </div>

          {/* Garantia de 7 dias — mesma política que a Sol (suporte) já informa
              aos clientes: devolução total sem perguntas. É o que substitui o
              risco que o trial cobria, agora que a cobrança é imediata. Fora dos
              cards porque vale pros dois igual. */}
          <div className={styles.guarantee} data-reveal>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
            <div>
              <b>Garantia de 7 dias nos dois planos.</b> Não serviu? Chama no WhatsApp
              dentro dos 7 dias que a gente devolve o valor integral, sem perguntas.
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
            Você vai continuar pedindo pro cliente esperar o PDF{' '}<br />
            <strong>ou mandar a proposta enquanto ele ainda está quente?</strong>
          </h2>
          <p className={styles.finalCtaSub} data-reveal>
            Quem espera documento compara preço. Enquanto o seu contrato não sai do Word,
            o cliente já pediu orçamento pro próximo integrador.
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
