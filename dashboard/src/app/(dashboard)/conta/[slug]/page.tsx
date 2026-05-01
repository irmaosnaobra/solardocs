'use client';

import { use } from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { useDashboard } from '@/contexts/DashboardContext';
import { FEATURES_VIP, STRIPE_VIP } from '../data';
import '../../mentoria/mentoria.css';

export default function ContaFeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const feature = FEATURES_VIP[slug];
  if (!feature) notFound();

  const { user } = useDashboard();
  const router = useRouter();
  const isVip = user?.plano === 'ilimitado' || (user as any)?.is_admin;

  const corPrimary = '#6E56CF'; // VIP roxo
  const corBg = 'rgba(110,86,207,0.10)';
  const corBorder = 'rgba(110,86,207,0.45)';

  function handleCtaVip() {
    if (feature.status === 'ativo' && feature.acessoUrl) {
      router.push(feature.acessoUrl);
      return;
    }
    alert('Recurso em desenvolvimento — você será notificado quando estiver disponível.');
  }

  return (
    <div className="mentoria-wrap">
      <div className="mentoria-back">
        <Link href="/dashboard">← Voltar pro dashboard</Link>
      </div>

      {/* ── ATTENTION ── */}
      <header className="mentoria-hero">
        <span
          className="mentoria-eyebrow"
          style={{ color: corPrimary, borderColor: corBorder, background: corBg }}
        >
          {feature.attention.eyebrow}
        </span>
        <h1 className="mentoria-headline">
          {feature.emoji} {feature.attention.headline}
        </h1>
        <p className="mentoria-sub">{feature.attention.subtitulo}</p>
      </header>

      {/* ── INTEREST (SPIN — 4 cards) ── */}
      <section className="mentoria-spin" aria-label="SPIN">
        <SpinCard label="Situação"    texto={feature.spin.situacao}    cor="#94a3b8" />
        <SpinCard label="Problema"    texto={feature.spin.problema}    cor="#ef4444" />
        <SpinCard label="Implicação"  texto={feature.spin.implicacao}  cor="#f59e0b" />
        <SpinCard label="Necessidade" texto={feature.spin.necessidade} cor={corPrimary} />
      </section>

      {/* ── DESIRE ── */}
      <section className="mentoria-desire">
        <h2 className="mentoria-h2">O que você desbloqueia</h2>
        <ul className="mentoria-bullets">
          {feature.bullets.map(b => (
            <li key={b}><span className="mentoria-check" style={{ color: '#1D9E75' }}>✓</span>{b}</li>
          ))}
        </ul>
      </section>

      {/* ── ACTION ── */}
      <section className="mentoria-cta-block" style={{ borderColor: corBorder, background: corBg }}>
        {isVip ? (
          <>
            <div className="mentoria-precos">
              <span className="mentoria-preco-final" style={{ color: corPrimary }}>
                ★ VIP ATIVO
              </span>
              <span className="mentoria-preco-eco">Você tem acesso completo</span>
            </div>

            <button
              onClick={handleCtaVip}
              className="mentoria-cta"
              style={{ background: 'linear-gradient(135deg, #6E56CF, #8b6fdc)', boxShadow: '0 6px 20px rgba(110,86,207,0.3)', border: 'none', cursor: 'pointer' }}
            >
              ⚡ {feature.ctaVip} →
            </button>

            {feature.status === 'em_breve' && (
              <div className="mentoria-urgencia" style={{ color: '#f59e0b', background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)' }}>
                🚧 Recurso em desenvolvimento — disponível em breve. Você será notificado.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="mentoria-precos">
              <span className="mentoria-preco-ancora">Plano Free</span>
              <span className="mentoria-preco-final" style={{ color: corPrimary }}>R$ 97/mês</span>
              <span className="mentoria-preco-eco">VIP — todos os recursos</span>
            </div>
            <p className="mentoria-parcelamento">Cancele quando quiser · Sem fidelidade</p>

            <a
              href={STRIPE_VIP}
              target="_blank"
              rel="noopener noreferrer"
              className="mentoria-cta"
              style={{ background: 'linear-gradient(135deg, #6E56CF, #8b6fdc)', boxShadow: '0 6px 20px rgba(110,86,207,0.3)' }}
            >
              ★ {feature.ctaFree}
            </a>

            <div className="mentoria-microcopy">
              <span>★ Documentos ilimitados</span>
              <span>· 💾 Tudo na nuvem</span>
              <span>· 💡 Voto no roadmap</span>
              <span>· 🔧 Rede de prestadores</span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function SpinCard({ label, texto, cor }: { label: string; texto: string; cor: string }) {
  return (
    <div className="mentoria-spin-card" style={{ borderTopColor: cor }}>
      <div className="mentoria-spin-label" style={{ color: cor }}>{label}</div>
      <p className="mentoria-spin-texto">{texto}</p>
    </div>
  );
}
