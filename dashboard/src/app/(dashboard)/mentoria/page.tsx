'use client';

import Link from 'next/link';
import { MENTORIAS, fmtPreco, TEMA_CORES, WHATSAPP_THIAGO } from './data';
import './mentoria.css';

// Ordem de exibição (esquerda → direita): combo primeiro, depois individuais, parceiro por último
const ORDEM = [
  'combo-financeiro-engenharia',
  'planilha-mestre',
  'trello-homologacao',
  'gerador',
  'trafego',
  'parceiro-integrador',
];

export default function MentoriaIndexPage() {
  const produtos = ORDEM.map(s => MENTORIAS[s]).filter(Boolean);

  return (
    <div className="mentoria-wrap">
      <header className="mentoria-hero mentoria-hero-index">
        <span className="mentoria-eyebrow" style={{ color: '#FAC775', borderColor: 'rgba(250,199,117,0.45)', background: 'rgba(250,199,117,0.10)' }}>
          ◆ MENTORIA SOLARDOC
        </span>
        <h1 className="mentoria-headline">
          As ferramentas que <span className="mentoria-destaque">construíram</span> uma operação solar real
        </h1>
        <p className="mentoria-sub">
          Não é curso. É o que eu uso todos os dias na minha empresa — agora disponível pra você aplicar na sua.
        </p>
      </header>

      <section className="mentoria-grid">
        {produtos.map(p => {
          const cor = TEMA_CORES[p.cor];
          const featured = p.isCombo;
          return (
            <Link
              key={p.slug}
              href={`/mentoria/${p.slug}`}
              className={`mentoria-card ${featured ? 'mentoria-card-featured' : ''} ${p.exclusivo ? 'mentoria-card-exclusive' : ''}`}
              style={{ ['--card-color' as any]: cor.primary }}
              data-pitch={p.attention.subtitulo}
            >
              <span className="mentoria-card-tag" style={{ background: cor.bg, color: cor.text, border: `1px solid ${cor.border}` }}>
                {p.tag}
              </span>
              <div className="mentoria-card-icon" style={{ background: cor.bg, color: cor.text }}>
                {p.emoji}
              </div>
              <div className="mentoria-card-nome">{p.nome}</div>
              <div className="mentoria-card-preco" style={{ color: cor.text }}>
                {p.preco > 0 ? `R$ ${fmtPreco(p.preco)}` : (p.precoLabel || 'A combinar')}
              </div>
            </Link>
          );
        })}
      </section>

      <section className="mentoria-contato">
        <p>Falar com Thiago direto:</p>
        <a
          href={`https://wa.me/${WHATSAPP_THIAGO}?text=${encodeURIComponent('Olá Thiago! Tenho interesse nas mentorias da SolarDoc e queria conversar.')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mentoria-contato-btn"
        >
          📱 (34) 99136-0223 — WhatsApp Thiago
        </a>
      </section>
    </div>
  );
}
