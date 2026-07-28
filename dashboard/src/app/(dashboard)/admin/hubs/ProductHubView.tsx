'use client';

// ─────────────────────────────────────────────────────────────────────────────
// A VIEW DOS HUBS DE PRODUTO — é o conteúdo do próprio /admin (Painel SolarDoc).
// Seletor dos 4 produtos + Meta Ads (aba GLOBAL) no topo; abaixo, as sub-abas do
// produto (do products.config) → o painel real ou placeholder. Config-driven.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import styles from '../admin.module.css';
import { PRODUCTS, type HubTab, type Product } from './products.config';
import MetaAdsPanel from '../_components/MetaAdsPanel';

const META = '__meta';
const DOT: Record<HubTab['status'], string> = { pronto: '#2C9C67', parcial: '#C87A1E', construir: '#3E6C9E' };
const STATUS_LABEL: Record<HubTab['status'], string> = { pronto: 'pronto', parcial: 'parcial', construir: 'a construir' };

export default function ProductHubView() {
  const [prodId, setProdId] = useState<string>(PRODUCTS[0].id);
  const [tabKey, setTabKey] = useState<string>(PRODUCTS[0].tabs[0].key);

  const isMeta = prodId === META;
  const product: Product = PRODUCTS.find((p) => p.id === prodId) ?? PRODUCTS[0];
  const tab: HubTab = product.tabs.find((t) => t.key === tabKey) ?? product.tabs[0];

  function selectProduct(id: string) {
    setProdId(id);
    if (id === META) return;
    const p = PRODUCTS.find((x) => x.id === id);
    if (p) setTabKey((prev) => (p.tabs.some((t) => t.key === prev) ? prev : p.tabs[0].key));
  }

  const Comp = tab.Comp;

  return (
    <>
      {/* seletor de PRODUTO + Meta Ads (global) */}
      <div className={styles.tabs} role="tablist" aria-label="Produtos">
        {PRODUCTS.map((p) => {
          const active = p.id === prodId && !isMeta;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={active}
              className={active ? styles.tabActive : styles.tab}
              style={active ? { borderColor: p.cor, color: p.cor } : undefined}
              onClick={() => selectProduct(p.id)}
            >
              <span aria-hidden="true">{p.emoji}</span> {p.nome}
            </button>
          );
        })}
        <button role="tab" aria-selected={isMeta} className={isMeta ? styles.tabActive : styles.tab} onClick={() => selectProduct(META)}>
          <span aria-hidden="true">📊</span> Meta Ads
        </button>
      </div>

      {isMeta ? (
        <div style={{ marginTop: 16 }}><MetaAdsPanel /></div>
      ) : (
        <>
          {/* SUB-ABAS do produto */}
          <div className={styles.tabs} role="tablist" aria-label={`Abas de ${product.nome}`} style={{ marginTop: 4 }}>
            {product.tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={t.key === tab.key}
                className={t.key === tab.key ? styles.tabActive : styles.tab}
                onClick={() => setTabKey(t.key)}
                title={STATUS_LABEL[t.status]}
              >
                <span aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: DOT[t.status], marginRight: 7, verticalAlign: 'middle' }} />
                {t.label}
              </button>
            ))}
          </div>

          {/* CONTEÚDO da aba */}
          <div style={{ marginTop: 20 }}>
            {Comp ? (
              <Comp />
            ) : (
              <div className={styles.card} style={{ textAlign: 'center', padding: '44px 24px' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: DOT[tab.status], border: `1px solid ${DOT[tab.status]}`, borderRadius: 999, padding: '4px 12px', marginBottom: 14 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: DOT[tab.status] }} />
                  {STATUS_LABEL[tab.status]}
                </div>
                <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>
                  <span aria-hidden="true">{product.emoji}</span> {product.nome} · {tab.label}
                </h2>
                <p style={{ margin: '0 auto', color: 'var(--color-text-muted)', maxWidth: '54ch' }}>
                  {tab.nota ?? 'Aba prevista no blueprint — entra numa próxima fase.'}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
