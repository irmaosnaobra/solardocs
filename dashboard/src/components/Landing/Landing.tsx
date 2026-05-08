'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { setToken, setUser } from '@/services/auth';
import styles from './Landing.module.css';

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export default function Landing() {
  const router = useRouter();

  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    document.getElementById('cadastro-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => document.getElementById('input-nome')?.focus(), 400);
  }

  return (
    <div className={styles.page}>
      {/* NAV */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.brand}>
            <span className={styles.brandLogo}>S</span>
            <span>Solar<span className={styles.brandAccent}>Doc</span></span>
          </div>
          <div className={styles.navRight}>
            <a href="/auth?mode=login" className={styles.navLink}>Entrar</a>
            <button onClick={scrollToForm} className={styles.navCta}>Começar grátis</button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroInner}>
          <div>
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
                <span className={styles.trustCheck}>✓</span> <b>10 documentos grátis</b>
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Sem cartão
              </span>
              <span className={styles.trustItem}>
                <span className={styles.trustCheck}>✓</span> Cancela quando quiser
              </span>
            </div>

            <div className={styles.formCard} id="cadastro-form">
              <span className={styles.formBadge}>✓ GRÁTIS — 10 DOCUMENTOS</span>
              <div className={styles.formTitle}>Cadastre sua empresa em 30 segundos</div>
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
                  {loading ? 'Criando sua conta...' : 'Começar grátis →'}
                </button>

                {error && <div className={styles.formError}>{error}</div>}

                <div className={styles.formFoot}>
                  Próximo passo: cadastrar o <b>CNPJ</b> da sua empresa solar e gerar seu primeiro contrato.
                </div>
              </form>
            </div>
          </div>

          {/* MOCKUP DUPLO */}
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

      {/* COMO FUNCIONA */}
      <section className={styles.how}>
        <div className={styles.howInner}>
          <div className={styles.sectionLabel}>Como funciona</div>
          <h2 className={styles.sectionTitle}>
            Do <strong>aperto de mão</strong> ao contrato assinado<br />
            em 3 minutos.
          </h2>
          <p className={styles.sectionSub}>
            Você não precisa instalar nada. Não precisa de advogado. Não precisa sair do telhado.
          </p>

          <div className={styles.howGrid}>
            <div className={styles.howStep}>
              <div className={styles.howNum}>01</div>
              <div className={styles.howH}>Cadastra o cliente</div>
              <div className={styles.howP}>
                Nome, CPF/CNPJ, endereço. Em 30 segundos. <b>No celular, ali na visita.</b>
              </div>
            </div>
            <div className={styles.howStep}>
              <div className={styles.howNum}>02</div>
              <div className={styles.howH}>IA gera o documento</div>
              <div className={styles.howP}>
                Escolhe o tipo (contrato, procuração, proposta…), preenche os dados solares —
                <b> a IA monta o documento</b> com cláusulas técnicas do setor.
              </div>
            </div>
            <div className={styles.howStep}>
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
          <div className={styles.sectionLabel}>Por que SolarDoc</div>
          <h2 className={styles.sectionTitle}>
            Não é planilha. Não é Word.<br />
            <strong>É o app que formaliza sua venda solar.</strong>
          </h2>

          <div className={styles.diffsGrid}>
            <div className={styles.diffCard}>
              <div className={styles.diffIcon}>⚡</div>
              <div className={styles.diffH}>Contrato em 2 minutos</div>
              <div className={styles.diffP}>
                <b>Visita técnica + contrato assinado.</b> Mesmo dia, mesmo lugar. O cliente nem precisa
                voltar pra casa pra decidir — fecha ali, no seu celular.
              </div>
            </div>

            <div className={styles.diffCard}>
              <div className={styles.diffIcon}>🛡️</div>
              <div className={styles.diffH}>Juridicamente blindado</div>
              <div className={styles.diffP}>
                Cláusulas técnicas do <b>setor solar</b>, validadas por especialistas. Procurações que as
                concessionárias aceitam de primeira. Você não precisa de advogado.
              </div>
            </div>

            <div className={styles.diffCard}>
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

      {/* COMPARATIVO */}
      <section className={styles.compare}>
        <div className={styles.compareInner}>
          <div className={styles.sectionLabel}>Por que sair do Word</div>
          <h2 className={styles.sectionTitle}>
            <strong>Olha a diferença</strong> de quem fecha 5 vendas/mês<br />
            e de quem fecha 15.
          </h2>

          <div className={styles.compareTable}>
            <div className={`${styles.compareRow} ${styles.compareRowHead}`}>
              <div className={styles.compareCell}>Critério</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}>Word / Drive</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}>Plataforma genérica</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter} ${styles.compareLabelGold}`}>SolarDoc</div>
            </div>

            <div className={styles.compareRow}>
              <div className={`${styles.compareCell} ${styles.compareCriteria}`}>Foco em documento solar</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareNo}>✕</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareNo}>✕</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter} ${styles.compareBest}`}><span className={styles.compareYes}>✓</span></div>
            </div>

            <div className={styles.compareRow}>
              <div className={`${styles.compareCell} ${styles.compareCriteria}`}>Cláusulas da concessionária</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareNo}>✕</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareNo}>✕</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter} ${styles.compareBest}`}><span className={styles.compareYes}>✓</span></div>
            </div>

            <div className={styles.compareRow}>
              <div className={`${styles.compareCell} ${styles.compareCriteria}`}>Pronto em 2 minutos</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareNo}>✕</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}>~</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter} ${styles.compareBest}`}><span className={styles.compareYes}>✓</span></div>
            </div>

            <div className={styles.compareRow}>
              <div className={`${styles.compareCell} ${styles.compareCriteria}`}>Assinatura digital</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareNo}>✕</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareYes}>✓</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter} ${styles.compareBest}`}><span className={styles.compareYes}>✓</span></div>
            </div>

            <div className={styles.compareRow}>
              <div className={`${styles.compareCell} ${styles.compareCriteria}`}>Sua marca / sua cor</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}>~</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareNo}>✕</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter} ${styles.compareBest}`}><span className={styles.compareYes}>✓</span></div>
            </div>

            <div className={styles.compareRow}>
              <div className={`${styles.compareCell} ${styles.compareCriteria}`}>Funciona no celular</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}><span className={styles.compareNo}>✕</span></div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter}`}>~</div>
              <div className={`${styles.compareCell} ${styles.compareCellCenter} ${styles.compareBest}`}><span className={styles.compareYes}>✓</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* DOCS */}
      <section className={styles.docs}>
        <div className={styles.docsInner}>
          <div className={styles.sectionLabel}>5 documentos prontos</div>
          <h2 className={styles.sectionTitle}>
            Tudo o que sua empresa solar <strong>precisa pra fechar</strong>.<br />
            Nada do que não precisa.
          </h2>

          <div className={styles.docsList}>
            <div className={styles.docItem}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Contrato de Compra e Venda Solar</span>
            </div>
            <div className={styles.docItem}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Procuração para Concessionária</span>
            </div>
            <div className={styles.docItem}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Prestação de Serviço</span>
            </div>
            <div className={styles.docItem}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Contrato PJ</span>
            </div>
            <div className={styles.docItem}>
              <span className={styles.docCheck}>✓</span>
              <span className={styles.docName}>Proposta para Financiamento Bancário</span>
            </div>
          </div>
        </div>
      </section>

      {/* PROVA SOCIAL */}
      <section className={styles.social}>
        <div className={styles.socialInner}>
          <div className={styles.sectionLabel}>Prova de quem usa</div>
          <h2 className={styles.sectionTitle}>
            Empresas solares que <strong>pararam de perder venda</strong>.
          </h2>

          <div className={styles.statsGrid}>
            <div className={styles.stat}>
              <div className={styles.statN}>2 min</div>
              <div className={styles.statL}>Tempo médio pra gerar um contrato</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statN}>5</div>
              <div className={styles.statL}>Tipos de documento prontos</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statN}>R$ 0</div>
              <div className={styles.statL}>Pra cadastrar e gerar os 10 primeiros</div>
            </div>
          </div>

          <div className={styles.testimonial}>
            <div className={styles.testimonialQuote}>"</div>
            <div className={styles.testimonialText}>
              Em 30 dias, fechei <b>7 contratos a mais</b>. O cliente vê o PDF na hora, com a logo da
              minha empresa, e já confia. Saí do Word e não volto.
            </div>
            <div className={styles.testimonialAuthor}>
              <div className={styles.authorAvatar}>M</div>
              <div>
                <div className={styles.authorName}>Marcos R.</div>
                <div className={styles.authorRole}>Integrador solar · Uberlândia/MG</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* POSITIONING */}
      <section className={styles.posBlock}>
        <div className={styles.posBlockInner}>
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
          <div className={styles.sectionLabel}>Planos</div>
          <h2 className={styles.sectionTitle}>
            <strong>Comece grátis.</strong> Continue se valer a pena.
          </h2>
          <p className={styles.sectionSub}>
            Você usa 10 documentos sem pagar nada. Quando precisar de mais, escolhe um plano. Sem trial,
            sem cartão antecipado.
          </p>

          <div className={styles.plansGrid}>
            <div className={styles.plan}>
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

            <div className={`${styles.plan} ${styles.planFeatured}`}>
              <div className={styles.planTag}>Mais escolhido</div>
              <div className={styles.planName}>Pro</div>
              <div className={styles.planPrice}>R$ 47<small>/mês</small></div>
              <div className={styles.planSub}>90 documentos por mês</div>
              <ul className={styles.planList}>
                <li>Tudo do Free, e mais:</li>
                <li>90 documentos por mês</li>
                <li>Logo da empresa em alta resolução</li>
                <li>Suporte prioritário</li>
                <li>Sem trial — paga quando quiser</li>
              </ul>
              <button onClick={scrollToForm} className={`${styles.planBtn} ${styles.planBtnPrimary}`}>Quero o Pro</button>
            </div>

            <div className={styles.plan}>
              <div className={styles.planName}>VIP</div>
              <div className={styles.planPrice}>R$ 97<small>/mês</small></div>
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
          <div className={styles.sectionLabel}>Perguntas frequentes</div>
          <h2 className={styles.sectionTitle}>
            Tira a dúvida. Depois cadastra.
          </h2>

          <div className={styles.faqList}>
            <details className={styles.faqItem}>
              <summary>Preciso pagar pra começar?</summary>
              <div className={styles.faqAnswer}>
                Não. Você cadastra a empresa solar com CNPJ e ganha 10 documentos vitalícios sem
                cartão. Use quando precisar — não vence.
              </div>
            </details>

            <details className={styles.faqItem}>
              <summary>Os contratos têm validade jurídica?</summary>
              <div className={styles.faqAnswer}>
                Sim. Os modelos seguem cláusulas técnicas validadas pra setor solar (geração, garantia,
                inadimplência, titularidade). A assinatura digital é juridicamente válida no Brasil
                via padrão Autentique.
              </div>
            </details>

            <details className={styles.faqItem}>
              <summary>Funciona com qualquer concessionária?</summary>
              <div className={styles.faqAnswer}>
                Sim. As procurações são genéricas o suficiente pra serem aceitas em concessionárias
                como CEMIG, CPFL, Enel, Light, Energisa, Equatorial e outras.
              </div>
            </details>

            <details className={styles.faqItem}>
              <summary>Posso usar com a marca da minha empresa?</summary>
              <div className={styles.faqAnswer}>
                Sim. Você sobe a logo, define a cor da empresa e os documentos saem com a sua
                identidade visual. A IA preenche, você não precisa formatar nada.
              </div>
            </details>

            <details className={styles.faqItem}>
              <summary>Cancelo quando quiser?</summary>
              <div className={styles.faqAnswer}>
                Sim. Sem multa, sem fidelidade, sem letra miúda. Você cancela direto na sua conta e
                pronto.
              </div>
            </details>

            <details className={styles.faqItem}>
              <summary>O dono mesmo consegue usar?</summary>
              <div className={styles.faqAnswer}>
                Esse é exatamente o público pra quem foi feito. Você não precisa de funcionário,
                advogado ou escritório — abre o app, cadastra o cliente, gera o documento e manda.
                Sai perfeito.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className={styles.finalCta}>
        <div className={styles.finalCtaInner}>
          <h2 className={styles.finalCtaTitle}>
            Sua próxima venda solar fecha com<br />
            <strong>o cliente assinando no seu celular.</strong>
          </h2>
          <p className={styles.finalCtaSub}>
            10 documentos grátis pra começar. Sem cartão. Sem pegadinha.
          </p>
          <button className={styles.finalCtaBtn} onClick={scrollToForm}>
            Cadastrar minha empresa solar →
          </button>
          <div className={styles.finalCtaFoot}>
            Continuou usando? A partir de R$47/mês. Cancela quando quiser.
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
            <a href="https://wa.me/5534991360223" target="_blank" rel="noopener noreferrer">Suporte WhatsApp</a>
            <a href="/auth?mode=login">Entrar</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
