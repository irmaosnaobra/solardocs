'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
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

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!nome.trim() || !email.trim() || !password) {
      setError('Preencha nome, email e senha pra começar.');
      return;
    }
    if (password.length < 6) {
      setError('A senha precisa de pelo menos 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      const eventId = crypto.randomUUID();
      const { data } = await api.post(
        '/auth/register',
        { email, password, nome, whatsapp: whatsapp || undefined },
        { headers: { 'X-Meta-Event-Id': eventId } }
      );
      setToken(data.token);
      setUser(data.user);
      if (typeof window !== 'undefined' && window.fbq) {
        window.fbq('track', 'Lead', {}, { eventID: eventId });
        window.fbq('track', 'CompleteRegistration', {}, { eventID: eventId });
      }
      router.push('/empresa');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Erro ao criar conta. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }

  function scrollToForm() {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.getElementById('input-nome')?.focus(), 500);
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
            <button onClick={scrollToForm} className={styles.navCta}>Começar grátis</button>
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
          <div className={styles.heroLeft}>
            <span className={styles.eyebrow}>
              <span className={styles.eyebrowDot} />
              Pra integrador solar com CNPJ
            </span>
            <h1 className={styles.h1}>
              O documento que vem<br />
              depois do <strong>aperto de mão.</strong>
            </h1>
            <p className={styles.lead}>
              SolarDoc é o app que <b>fecha sua venda solar</b>. Contrato, proposta e procuração em
              minutos — com o cliente ali, na sua frente. Sem advogado. Sem Word. Sem terceirizar.
            </p>

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
              <div className={styles.formTitle}>Cadastre sua empresa em 30s</div>
              <div className={styles.formSub}>Sem trial vencendo. Use quando precisar.</div>

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
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="Email da empresa"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                  />
                  <div className={styles.row2}>
                    <input
                      type="tel"
                      autoComplete="tel"
                      placeholder="WhatsApp"
                      value={whatsapp}
                      onChange={e => setWhatsapp(e.target.value)}
                    />
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="Senha (6+)"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <button type="submit" className={styles.cta} disabled={loading}>
                  <span>{loading ? 'Criando sua conta...' : 'Começar grátis →'}</span>
                </button>

                {error && <div className={styles.formError}>{error}</div>}

                <div className={styles.formFoot}>
                  Próximo passo: cadastrar o <b>CNPJ</b> da sua empresa solar e gerar seu primeiro contrato.
                </div>
              </form>
            </div>
          </div>

          {/* MOCKUP */}
          <div className={styles.heroVisual}>
            <div className={styles.phoneStack}>
              <div className={`${styles.phone} ${styles.phoneBack}`}>
                <div className={styles.phoneScreen}>
                  <div className={styles.phoneHead}>
                    <div className={styles.phoneHeadTitle}>SolarDoc · Clientes</div>
                    <div className={styles.phoneHeadName}>Sua Empresa Solar</div>
                  </div>
                  <div className={styles.phoneCard}>
                    <h4>Padaria Real</h4>
                    <p>Centro · 8 kWp</p>
                    <span className={styles.phoneStatus}>✓ Contrato OK</span>
                  </div>
                  <div className={styles.phoneCard}>
                    <h4>Faz. Sol Nascente</h4>
                    <p>Rural · 32 kWp</p>
                    <span className={`${styles.phoneStatus} ${styles.phoneStatusBlue}`}>Em análise</span>
                  </div>
                </div>
              </div>
              <div className={`${styles.phone} ${styles.phoneFront}`}>
                <div className={styles.phoneScreen}>
                  <div className={styles.phoneHead}>
                    <div className={styles.phoneHeadTitle}>SolarDoc · Documentos</div>
                    <div className={styles.phoneHeadName}>Sua Empresa Solar</div>
                  </div>
                  <div className={styles.phoneCard}>
                    <h4>Contrato Compra e Venda</h4>
                    <p>Marcos Silva · 5,5 kWp · Hoje</p>
                    <span className={styles.phoneStatus}>✓ Assinado pelo cliente</span>
                  </div>
                  <div className={styles.phoneCard}>
                    <h4>Procuração — Concessionária</h4>
                    <p>Faz. Sol Nascente · Aguardando</p>
                    <span className={`${styles.phoneStatus} ${styles.phoneStatusBlue}`}>Enviado</span>
                  </div>
                  <div className={styles.phoneCard}>
                    <h4>Proposta para Banco</h4>
                    <p>Padaria Real · R$ 38.500</p>
                    <span className={styles.phoneStatus}>✓ Pronto pra envio</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST STRIP — concessionárias */}
      <section className={styles.trustStrip}>
        <div className={styles.trustStripInner}>
          <div className={styles.trustStripLabel} data-reveal>
            Procurações <b>aceitas em todas as concessionárias do Brasil</b>
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
                <b>O dono pode operar.</b> Cadastra cliente, gera o doc, manda no WhatsApp, cliente assina.
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
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>~</span> Marca da empresa quebra</li>
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
                <li><span className={`${styles.compareIcon} ${styles.compareMid}`}>~</span> Funciona ok no celular</li>
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
              <span className={styles.docName}>Contrato PJ</span>
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
            <div className={styles.testimonial} data-reveal>
              <div className={styles.testimonialText}>
                Em 30 dias, fechei <b>7 contratos a mais</b>. O cliente vê o PDF na hora, com a logo da
                minha empresa, e já confia. Saí do Word e não volto.
              </div>
              <div className={styles.testimonialAuthor}>
                <div className={styles.authorAvatar}>M</div>
                <div>
                  <div className={styles.authorName}>Marcos R.</div>
                  <div className={styles.authorRole}>Integrador · Uberlândia/MG</div>
                </div>
              </div>
            </div>

            <div className={styles.testimonial} data-reveal style={{ transitionDelay: '0.1s' }}>
              <div className={styles.testimonialText}>
                A procuração da CEMIG foi <b>aprovada na primeira</b>. Antes, eu refazia 3 vezes. Pra mim
                já pagou o ano todo só nisso.
              </div>
              <div className={styles.testimonialAuthor}>
                <div className={styles.authorAvatar}>C</div>
                <div>
                  <div className={styles.authorName}>Carla F.</div>
                  <div className={styles.authorRole}>Engenheira · Belo Horizonte/MG</div>
                </div>
              </div>
            </div>

            <div className={styles.testimonial} data-reveal style={{ transitionDelay: '0.2s' }}>
              <div className={styles.testimonialText}>
                Eu mesmo faço tudo, sem secretária, sem advogado. <b>Em 2 minutos sai o contrato</b> com a
                cara da minha empresa. O cliente assina ali no celular.
              </div>
              <div className={styles.testimonialAuthor}>
                <div className={styles.authorAvatar}>R</div>
                <div>
                  <div className={styles.authorName}>Roberto B.</div>
                  <div className={styles.authorRole}>Sócio · Recife/PE</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* POSITIONING */}
      <section className={styles.posBlock}>
        <div className={styles.posBlockInner} data-reveal>
          <div className={styles.posCross}>
            <s>Word</s> &nbsp;·&nbsp; <s>Drive</s> &nbsp;·&nbsp; <s>Plataforma cheia de feature que você nem usa</s>
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
              <button onClick={scrollToForm} className={styles.planBtn}>Começar grátis</button>
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
                <li>Sem trial — paga quando quiser</li>
              </ul>
              <button onClick={scrollToForm} className={`${styles.planBtn} ${styles.planBtnPrimary}`}>
                Quero o Pro
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
              <button onClick={scrollToForm} className={styles.planBtn}>Começar grátis</button>
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
                Sim. Os modelos seguem cláusulas técnicas validadas pra setor solar (geração, garantia,
                inadimplência, titularidade). A <b>assinatura digital é juridicamente válida</b> no
                Brasil via padrão Autentique.
              </div>
            </details>

            <details className={styles.faqItem} data-reveal>
              <summary>Funciona com qualquer concessionária?</summary>
              <div className={styles.faqAnswer}>
                Sim. As procurações são genéricas o suficiente pra serem aceitas em concessionárias
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
            <button className={styles.finalCtaBtn} onClick={scrollToForm}>
              Cadastrar minha empresa solar →
            </button>
            <div className={styles.finalCtaFoot}>
              Continuou usando? A partir de R$ 27/mês. Cancela quando quiser.
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
