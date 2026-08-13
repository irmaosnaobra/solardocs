'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar/Sidebar';
import TopBar from '@/components/TopBar/TopBar';
import UpgradeModal from '@/components/UpgradeModal/UpgradeModal';
import InstallBanner from '@/components/InstallBanner/InstallBanner';
import WhatsAppFab from '@/components/WhatsAppFab/WhatsAppFab';
import LinkPagarPix, { pixRecorrenteLigado } from '@/components/LinkPagarPix/LinkPagarPix';
import { DashboardProvider, useDashboard } from '@/contexts/DashboardContext';
import { isAuthenticated, removeToken } from '@/services/auth';
import api from '@/services/api';
import styles from './dashboard.module.css';

// PREÇO ÚNICO — a mesma oferta do UpgradeModal, aqui em tela cheia (é a tela de
// quem esgotou os 10 docs grátis). Antes eram dois cards comparando PRO × VIP.
const OFERTA = {
  key: 'ilimitado',
  amount: '67',
  chamada: 'Tudo liberado, sem teto mensal',
  features: [
    'Documentos ilimitados — sem teto mensal',
    'Os 8 tipos: Proposta, Contrato Solar, Procuração, Recibo, Vistoria, Prestação de Serviço, Contrato Vendedor e Proposta Bancária',
    'Modelos prontos pro setor solar',
    'Contratos com a logomarca da sua empresa',
    'Histórico completo e permanente',
    'Dashboard com gráficos e analytics de uso',
    'Clientes e terceiros ilimitados',
    'Acesso antecipado a todo novo recurso',
    'Participa das decisões da plataforma',
    'Suporte prioritário direto no WhatsApp',
  ],
};

function BillingSuspendedPage({ email }: { email: string }) {
  const [loading, setLoading] = useState(false);

  async function abrirPortal() {
    setLoading(true);
    try {
      const { data } = await api.post('/payments/billing-portal');
      window.location.href = data.url;
    } catch {
      alert('Falha ao abrir portal de pagamento. Tente novamente em instantes ou entre em contato pelo WhatsApp (34) 99816-5040.');
      setLoading(false);
    }
  }

  function sair() {
    removeToken();
    window.location.href = '/auth?mode=login';
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg, #0b1120)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{
        maxWidth: 520,
        width: '100%',
        background: 'linear-gradient(145deg, #1a1200 0%, #2d1f00 50%, #1a1200 100%)',
        border: '1.5px solid rgba(251,191,36,0.4)',
        borderRadius: 22,
        padding: '40px 36px',
        textAlign: 'center',
        boxShadow: '0 4px 28px rgba(251,191,36,0.15)',
      }}>
        
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 12px', lineHeight: 1.3 }}>
          Sua conta está temporariamente suspensa
        </h1>
        <p style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 8px' }}>
          A cobrança da sua assinatura não foi processada e os 7 dias de tolerância encerraram.
        </p>
        <p style={{ color: '#cbd5e1', fontSize: '0.95rem', lineHeight: 1.6, margin: '0 0 28px' }}>
          A reativação é <strong style={{ color: '#fbbf24' }}>imediata</strong> assim que você atualizar a forma de pagamento. Todo o seu histórico está preservado.
        </p>

        <button
          onClick={abrirPortal}
          disabled={loading}
          style={{
            width: '100%',
            padding: '16px',
            borderRadius: 12,
            background: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
            color: '#0f172a',
            fontWeight: 900,
            fontSize: '1rem',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
            boxShadow: '0 4px 18px rgba(245,158,11,0.45)',
            marginBottom: 12,
          }}
        >
          {loading ? 'Aguarde...' : 'Atualizar forma de pagamento'}
        </button>

        {/* Conta suspensa é, quase sempre, cartão que não passa mais. Mandar essa
            pessoa só pro portal da Stripe é pedir de novo o que já falhou. */}
        <LinkPagarPix
          texto={pixRecorrenteLigado ? 'Sem cartão? Reative pagando por Pix' : 'Sem cartão? Reative por Pix no WhatsApp'}
          style={{
            display: 'block', textAlign: 'center', marginBottom: 12,
            color: '#cbd5e1', fontSize: '0.9rem', fontWeight: 600,
            textDecoration: 'underline', textUnderlineOffset: 3,
          }}
        />

        <button
          onClick={sair}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: 12,
            background: 'transparent',
            color: '#94a3b8',
            fontWeight: 600,
            fontSize: '0.9rem',
            border: '1px solid #334155',
            cursor: 'pointer',
          }}
        >
          Sair da conta
        </button>

        <p style={{ color: '#64748b', fontSize: '0.78rem', margin: '24px 0 0' }}>
          {email}
        </p>
        <p style={{ color: '#475569', fontSize: '0.75rem', margin: '12px 0 0', lineHeight: 1.6 }}>
          Precisa de ajuda? WhatsApp <strong style={{ color: '#94a3b8' }}>(34) 99816-5040</strong>
        </p>
      </div>
    </div>
  );
}

function UpgradePage({ email }: { email: string }) {
  const [loading, setLoading] = useState<string | null>(null);

  async function assinar(planKey: string) {
    setLoading(planKey);
    try {
      const { data } = await api.post('/payments/create-checkout', { plan: planKey });
      if (data.upgraded) {
        alert('Plano atualizado! A diferença foi cobrada no seu cartão. Recarregando...');
        window.location.reload();
        return;
      }
      window.location.href = data.url;
    } catch {
      alert('Erro ao iniciar pagamento. Tente novamente.');
      setLoading(null);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg, #0b1120)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>

        <h1 style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--color-text)', margin: '0 0 8px' }}>
          Seus 10 documentos gratuitos acabaram
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '1rem', margin: 0 }}>
          Uma assinatura só, tudo incluso — continue gerando documentos profissionais agora
        </p>
        <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 6 }}>{email}</p>
      </div>

      {/* Um card só: a largura acompanha a oferta única (nos 860px do
          comparativo antigo o card sozinho esticava e quebrava o layout). */}
      <div style={{ width: '100%', maxWidth: 460 }}>
        <div style={{
          background: 'linear-gradient(145deg, #1a1200 0%, #2d1f00 45%, #1a1200 100%)',
          border: '1.5px solid rgba(251,191,36,0.45)',
          borderRadius: 22,
          padding: '32px 28px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          position: 'relative',
          boxShadow: '0 4px 28px rgba(251,191,36,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 3 }}>
            <span style={{ fontSize: '1.3rem', fontWeight: 600, color: '#e2e8f0' }}>R$</span>
            <span style={{ fontSize: '3.4rem', fontWeight: 900, letterSpacing: -2, color: '#fff', lineHeight: 1 }}>{OFERTA.amount}</span>
            <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>/mês</span>
          </div>

          <div style={{
            fontSize: '0.83rem', fontWeight: 700, textAlign: 'center', padding: '8px 12px',
            borderRadius: 8, marginBottom: 4,
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.1)',
            border: '1px solid rgba(251,191,36,0.3)',
          }}>{OFERTA.chamada}</div>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            {OFERTA.features.map((f) => (
              <li key={f} style={{ fontSize: '0.88rem', color: '#cbd5e1', paddingLeft: 18, position: 'relative', lineHeight: 1.4 }}>
                <span style={{ position: 'absolute', left: 0, color: 'var(--color-text-muted)', fontWeight: 700 }}>✓</span>
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={() => assinar(OFERTA.key)}
            disabled={loading === OFERTA.key}
            style={{
              marginTop: 8,
              padding: '14px',
              borderRadius: 12,
              fontWeight: 900,
              fontSize: '0.97rem',
              cursor: loading === OFERTA.key ? 'not-allowed' : 'pointer',
              opacity: loading === OFERTA.key ? 0.6 : 1,
              width: '100%',
              letterSpacing: '0.3px',
              transition: 'all 0.2s',
              background: 'linear-gradient(135deg,#f59e0b,#fbbf24)',
              color: '#0f172a',
              border: 'none',
              boxShadow: '0 4px 18px rgba(245,158,11,0.45)',
            }}
          >
            {loading === OFERTA.key ? 'Aguarde...' : 'Assinar agora →'}
          </button>

          <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#94a3b8', margin: '10px 0 0' }}>
            Cancele quando quiser · sem fidelidade
          </p>
        </div>
      </div>

      {/* Esta é a tela de quem esgotou o free — o momento exato em que a pessoa
          decide pagar. Quem não tem cartão precisa de um caminho aqui, não de um
          "fale conosco". */}
      <LinkPagarPix
        style={{
          color: '#cbd5e1', fontSize: '0.92rem', fontWeight: 600, marginTop: 26,
          textDecoration: 'underline', textUnderlineOffset: 3,
        }}
      />

      <p style={{ color: '#475569', fontSize: '0.78rem', marginTop: 16 }}>
        Já assinou?{' '}
        <a href="/auth?mode=login" style={{ color: '#63b3ed', textDecoration: 'underline' }}>
          Entre novamente com o e-mail da compra
        </a>
      </p>
    </div>
  );
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setUser, showUpgrade, setShowUpgrade } = useDashboard();
  const [hasCompany, setHasCompany] = useState(false);
  const [companyLoaded, setCompanyLoaded] = useState(false);
  const [companyLogo, setCompanyLogo] = useState<string | null>(null);
  const [companyNome, setCompanyNome] = useState<string | null>(null);

  // forceHasCompany: admin navega livre mesmo sem CNPJ; não rebaixar hasCompany
  // por causa da resposta da empresa (mas ainda pegamos logo e nome pra UI).
  const fetchCompany = useCallback((forceHasCompany = false) => {
    api.get('/company').then(({ data }) => {
      setHasCompany(forceHasCompany || !!data.company?.cnpj);
      setCompanyLogo(data.company?.logo_base64 || null);
      setCompanyNome(data.company?.nome || null);
    }).catch(() => {}).finally(() => setCompanyLoaded(true));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push('/auth?mode=login');
      return;
    }
    api.get('/auth/me').then(({ data }) => {
      setUser(data.user);
      // Admin sempre navega livre (não precisa de CNPJ), mas ainda buscamos a
      // empresa pra ter o nome dela na saudação (senão companyNome fica null e
      // a saudação cairia no prefixo do email). Re-força hasCompany=true depois.
      if (data.user?.is_admin) {
        fetchCompany(true); // força hasCompany=true, mas pega nome/logo da empresa
        return;
      }
      fetchCompany();
    }).catch(() => router.push('/auth?mode=login'));

    const handler = () => fetchCompany();
    window.addEventListener('company-saved', handler);
    return () => window.removeEventListener('company-saved', handler);
  }, [router, fetchCompany, setUser]);

  useEffect(() => {
    const handler = () => setShowUpgrade(true);
    window.addEventListener('limit-reached', handler);
    return () => window.removeEventListener('limit-reached', handler);
  }, [setShowUpgrade]);

  if (!user || !companyLoaded) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-bg)',
      }}>
        <div style={{
          width: 32,
          height: 32,
          border: '2.5px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'sd-spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes sd-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Free user: empresa (CNPJ) continua obrigatória pra ativar o gerador.
  // Mas a navegação é LIVRE — free acessa todas as telas/tipos de documento.
  // O limite do plano free é só no volume (10 docs/mês), não nas features.
  const isFree = user.plano === 'free';
  const isAdminUser = !!user.is_admin;
  // Comprador do kit (Kiwify) fica FORA deste muro. Ele pagou por um curso, não
  // pelo gerador: cair numa tela de CNPJ logo depois de criar a senha é o jeito
  // mais rápido de perder alguém que acabou de comprar. Ele navega livre e recebe
  // o convite pra cadastrar a empresa como banner (logo abaixo), não como portão
  // — o CNPJ volta a ser obrigatório na hora de gerar documento, onde faz sentido.
  // Comprador AVULSO em geral (kit, curso ou qualquer ferramenta) fica fora dos
  // portões abaixo. Ele pagou por uma coisa específica; esbarrar no paywall de
  // OUTRO produto minutos depois de pagar é o caminho mais curto pro reembolso.
  // O campo vem do /auth/me (uma fonte só, sem segunda chamada async aqui).
  const compradorKit = !!user.tem_kit || !!user.tem_produto_avulso;
  // A tela de pagamento por Pix fica FORA de todos os portões abaixo (CNPJ,
  // suspensão, free esgotado). Bloquear quem está tentando pagar é o único erro
  // caro aqui — as três telas que seguem levam pra cá.
  const naTelaPix = pathname === '/pix-recorrente';
  // A LOJA e as mini LPs seguem a mesma lógica da tela de Pix: são onde a pessoa
  // COMPRA. Interceptar quem está indo pagar é o único erro caro aqui — e eram
  // justamente os travados (free sem CNPJ, free sem documento, suspenso) que
  // nunca chegavam na página de compra da ferramenta avulsa.
  const naLoja = pathname === '/produtos' || pathname.startsWith('/produtos/');
  const deixaPassar = naTelaPix || naLoja;
  if (isFree && !isAdminUser && !compradorKit && !deixaPassar) {
    if (!hasCompany && pathname !== '/empresa') {
      router.replace('/empresa?welcome=1&plan=free');
      return null;
    }
  }

  // Conta suspensa (D7 do dunning sem pagamento) → tela cheia bloqueando tudo
  // exceto atualização de cartão via Stripe billing portal. Stripe Smart Retries
  // continua tentando em paralelo; se o pagamento cair, o webhook reabre.
  if (user.billing_status === 'suspended') {
    // Exceção pra tela de pagar por Pix — e SEM o resto do app em volta. A pessoa
    // suspensa precisa poder pagar; não precisa voltar a navegar no produto.
    if (deixaPassar) return <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '32px 20px' }}>{children}</div>;
    return <BillingSuspendedPage email={user.email} />;
  }

  const docsRestantes = isFree ? Math.max(0, user.limite_documentos - (user.documentos_usados ?? 0)) : null;
  // Quem comprou uma FERRAMENTA avulsa não cai na tela de "acabaram seus
  // documentos": o teto é do gerador, e ele não comprou o gerador.
  //
  // Repare que aqui é `tem_produto_avulso`, NÃO `compradorKit`. O comprador da
  // isca de R$27 continua vendo essa tela quando esgota os documentos — ele é
  // exatamente quem o funil quer converter em assinante, e tirá-lo daí apagaria
  // uma alavanca que já está funcionando hoje.
  const limitReached = isFree && docsRestantes === 0 && !user.tem_produto_avulso;

  // Créditos esgotados → tela cheia de upgrade (sem sidebar, sem distrações)
  if (limitReached) {
    // Mesma exceção da suspensão: a tela de pagar por Pix abre sozinha.
    if (deixaPassar) return <div style={{ minHeight: '100vh', background: 'var(--color-bg)', padding: '32px 20px' }}>{children}</div>;
    return <UpgradePage email={user.email} />;
  }

  return (
    <div className={styles.layout}>
      <Sidebar user={user} hasCompany={hasCompany} companyNome={companyNome} onUpgradeClick={() => setShowUpgrade(true)} />
      <main className={styles.main}>
        <TopBar userEmail={user.email} companyLogo={companyLogo} />
        <div className={styles.content}>
          {/* Comprador do kit sem empresa: convite, não portão. É o que substitui
              o redirect pra /empresa — ele precisa da empresa cadastrada pros
              modelos saírem com a marca dele, mas descobre isso navegando. */}
          {compradorKit && !hasCompany && pathname !== '/empresa' && (
            <div style={{
              background: 'rgba(247,164,28,0.08)',
              border: '1px solid rgba(247,164,28,0.3)',
              borderRadius: 10,
              padding: '10px 16px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}>
              <span style={{ fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>
                Cadastre sua empresa para os <strong>contratos e procurações do kit</strong> saírem com seu CNPJ e sua logo.
              </span>
              <button
                onClick={() => router.push('/empresa?from=kit')}
                style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', textDecoration: 'underline', whiteSpace: 'nowrap', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                Cadastrar agora →
              </button>
            </div>
          )}
          {isFree && docsRestantes !== null && docsRestantes > 0 && (
            <div style={{
              background: docsRestantes <= 2 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${docsRestantes <= 2 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
              borderRadius: 10,
              padding: '10px 16px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}>
              <span style={{ fontSize: 13, color: docsRestantes <= 2 ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>
                {docsRestantes <= 2
                  ? <>Conta grátis — <strong>{docsRestantes} documento{docsRestantes !== 1 ? 's' : ''}</strong> restante{docsRestantes !== 1 ? 's' : ''} de 10.</>
                  : <>Na conta grátis você só gera <strong>propostas</strong>. Assinando, destrava <strong>contratos, procurações e recibos</strong>.</>}
              </span>
              <button
                onClick={() => setShowUpgrade(true)}
                style={{ fontSize: 12, fontWeight: 700, color: docsRestantes <= 2 ? '#ef4444' : '#f59e0b', textDecoration: 'underline', whiteSpace: 'nowrap', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                {docsRestantes <= 2 ? 'Ver assinatura →' : 'Quero destravar →'}
              </button>
            </div>
          )}
          {children}
        </div>
      </main>
      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} plano={user.plano} />}
      <WhatsAppFab />
      {/* Convite pra instalar o app: aparece no primeiro acesso (?welcome=1) ou na
          3a visita. É dentro do (dashboard) porque só faz sentido pra quem entrou. */}
      <InstallBanner />
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardProvider>
      <Suspense fallback={null}>
        <DashboardLayoutContent>{children}</DashboardLayoutContent>
      </Suspense>
    </DashboardProvider>
  );
}
