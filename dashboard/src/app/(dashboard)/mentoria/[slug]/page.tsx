'use client';

import { use } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MENTORIAS, buildWhatsappUrl, fmtPreco, TEMA_CORES } from '../data';
import '../mentoria.css';

export default function MentoriaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const produto = MENTORIAS[slug];
  if (!produto) notFound();

  const cor = TEMA_CORES[produto.cor];
  const wa = buildWhatsappUrl(produto);
  const economia = produto.precoAncora ? produto.precoAncora - produto.preco : null;

  return (
    <div className="mentoria-wrap">
      <div className="mentoria-back">
        <Link href="/mentoria">← Voltar pra todas as mentorias</Link>
      </div>

      {/* ── ATTENTION (hero) ── */}
      <header className="mentoria-hero">
        <span className="mentoria-eyebrow" style={{ color: cor.text, borderColor: cor.border, background: cor.bg }}>
          {produto.attention.eyebrow}
        </span>
        <h1 className="mentoria-headline">
          {produto.emoji} {produto.attention.headline}
        </h1>
        <p className="mentoria-sub">{produto.attention.subtitulo}</p>
      </header>

      {/* ── INTEREST (SPIN — 4 cards) ── */}
      <section className="mentoria-spin" aria-label="SPIN">
        <SpinCard label="Situação"     texto={produto.spin.situacao}     cor="#94a3b8" />
        <SpinCard label="Problema"     texto={produto.spin.problema}     cor="#ef4444" />
        <SpinCard label="Implicação"   texto={produto.spin.implicacao}   cor="#f59e0b" />
        <SpinCard label="Necessidade"  texto={produto.spin.necessidade}  cor={cor.primary} />
      </section>

      {/* ── DESIRE (bullets de valor) ── */}
      <section className="mentoria-desire">
        <h2 className="mentoria-h2">O que está incluso</h2>
        <ul className="mentoria-bullets">
          {produto.bullets.map(b => (
            <li key={b}><span className="mentoria-check" style={{ color: '#1D9E75' }}>✓</span>{b}</li>
          ))}
        </ul>
      </section>

      {/* ── COMBO: value stack visual ── */}
      {produto.isCombo && produto.valueStack && (
        <section className="mentoria-stack">
          <h2 className="mentoria-h2">Quanto vale tudo separado</h2>
          <div className="mentoria-stack-list">
            {produto.valueStack.map(item => (
              <div key={item.label} className="mentoria-stack-row">
                <span>{item.label}</span>
                <span className="mentoria-stack-dots">.................................</span>
                <span className="mentoria-stack-valor">R$ {fmtPreco(item.valor)}</span>
              </div>
            ))}
            <div className="mentoria-stack-row mentoria-stack-total">
              <span><strong>TOTAL REAL</strong></span>
              <span className="mentoria-stack-dots">.................................</span>
              <span className="mentoria-stack-valor"><strong>R$ {fmtPreco(produto.totalReal!)}</strong></span>
            </div>
            <div className="mentoria-stack-row mentoria-stack-paga" style={{ color: cor.primary }}>
              <span><strong>VOCÊ PAGA APENAS</strong></span>
              <span className="mentoria-stack-dots">.................................</span>
              <span className="mentoria-stack-valor"><strong>R$ {fmtPreco(produto.preco)}</strong></span>
            </div>
            <div className="mentoria-stack-row mentoria-stack-economia">
              <span>ECONOMIA</span>
              <span className="mentoria-stack-dots">.................................</span>
              <span><strong>R$ {fmtPreco(produto.economia!)} (40% OFF)</strong></span>
            </div>
          </div>
        </section>
      )}

      {/* ── ACTION (CTA principal verde) ── */}
      <section className="mentoria-cta-block" style={{ borderColor: cor.border, background: cor.bg }}>
        <div className="mentoria-precos">
          {produto.precoAncora && produto.preco > 0 && (
            <span className="mentoria-preco-ancora">De R$ {fmtPreco(produto.precoAncora)}</span>
          )}
          <span className="mentoria-preco-final" style={{ color: cor.primary }}>
            {produto.preco > 0 ? `R$ ${fmtPreco(produto.preco)}` : (produto.precoLabel || 'A combinar')}
          </span>
          {economia != null && economia > 0 && (
            <span className="mentoria-preco-eco">economia de R$ {fmtPreco(economia)}</span>
          )}
        </div>
        {produto.parcelamento && (
          <p className="mentoria-parcelamento">{produto.parcelamento}</p>
        )}

        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="mentoria-cta"
        >
          💬 {produto.cta} → WhatsApp Thiago
        </a>

        <div className="mentoria-microcopy">
          <span>📱 (34) 99136-0223</span>
          {produto.garantiaDias > 0 && <span>· Garantia {produto.garantiaDias} dias</span>}
          <span>· 100% individual ao vivo</span>
        </div>

        {produto.vagasMes > 0 && (
          <div className="mentoria-urgencia">
            ⚠ Apenas {produto.vagasMes} {produto.vagasMes === 1 ? 'vaga' : 'vagas'} {produto.vagasMes === 1 ? 'liberada' : 'liberadas'} por mês — agendamento individual ao vivo.
          </div>
        )}
      </section>

      {/* ── Cross-sell pro COMBO (planilha + trello) ── */}
      {produto.crossSellCombo && (
        <section className="mentoria-cross">
          <div className="mentoria-cross-inner">
            <span className="mentoria-cross-emoji">💡</span>
            <div className="mentoria-cross-text">
              <strong>ESPERA — quer levar os dois?</strong>
              <p>No combo Planilha Mestre + Trello Homologação você economiza R$ 994.</p>
            </div>
            <Link href="/mentoria/combo-financeiro-engenharia" className="mentoria-cross-cta">
              Ver oferta combo →
            </Link>
          </div>
        </section>
      )}
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
