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
          <a href="/auth?mode=login" className={styles.navLink}>
            Já sou cliente — Entrar →
          </a>
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
              SolarDoc é o app que <b>fecha sua venda solar</b>. Contrato, proposta e procuração em minutos —
              com o cliente ali, na sua frente. Sem advogado. Sem Word. Sem terceirizar.
            </p>

            <div className={styles.formCard} id="cadastro-form">
              <span className={styles.formBadge}>✓ GRÁTIS — 10 DOCUMENTOS</span>
              <div className={styles.formTitle}>Cadastre sua empresa em 30 segundos</div>
              <div className={styles.formSub}>Sem cartão. Sem trial vencendo. Use quando precisar.</div>

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

          {/* MOCKUP */}
          <div className={styles.heroVisual}>
            <div className={styles.phone}>
              <div className={styles.phoneScreen}>
                <div className={styles.phoneHead}>
                  <div className={styles.phoneHeadTitle}>SolarDoc · Documentos</div>
                  <div className={styles.phoneHeadName}>Sua Empresa Solar Ltda</div>
                </div>
                <div className={styles.phoneCard}>
                  <h4>Contrato Compra e Venda</h4>
                  <p>Cliente: Marcos Silva<br />Sistema: 5,5 kWp · Hoje, 14:30</p>
                  <span className={styles.phoneStatus}>✓ Assinado pelo cliente</span>
                </div>
                <div className={styles.phoneCard}>
                  <h4>Procuração — Concessionária</h4>
                  <p>Cliente: Fazenda Sol Nascente<br />Titularidade · Aguardando</p>
                  <span className={`${styles.phoneStatus} ${styles.phoneStatusBlue}`}>
                    Enviado p/ assinatura
                  </span>
                </div>
                <div className={styles.phoneCard}>
                  <h4>Proposta para Banco</h4>
                  <p>Cliente: Padaria Real<br />R$ 38.500 · Financiamento</p>
                  <span className={styles.phoneStatus}>✓ Pronto pra envio</span>
                </div>
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
                <b>Visita técnica + contrato assinado.</b> Mesmo dia, mesmo lugar. Cliente nem precisa
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

          <div className={styles.docsCloser}>
            Gerados com <b>IA</b>, com a sua marca, no seu padrão.
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
            Continuou usando? A partir de R$27/mês. Cancela quando quiser.
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
