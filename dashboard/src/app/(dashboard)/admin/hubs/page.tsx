'use client';

// ─────────────────────────────────────────────────────────────────────────────
// HUBS DE PRODUTO — casca config-driven (Fase 0). Rota NOVA (/admin/hubs) que
// COEXISTE com o /admin atual (não altera nada dele). Um seletor de produto no topo
// → as sub-abas daquele produto (do products.config) → o painel real (reuso) OU um
// placeholder "construir". Espelha o padrão do admin/page.tsx (client + useState +
// classes do admin.module.css) pra ficar visualmente idêntico.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import styles from '../admin.module.css';
import { PRODUCTS, type HubTab, type Product } from './products.config';

const DOT: Record<HubTab['status'], string> = { pronto: '#2C9C67', parcial: '#C87A1E', construir: '#3E6C9E' };
const STATUS_LABEL: Record<HubTab['status'], string> = { pronto: 'pronto — reuso', parcial: 'parcial', construir: 'a construir' };

export default function HubsPage() {
  const [prodId, setProdId] = useState<string>(PRODUCTS[0].id);
  const [tabKey, setTabKey] = useState<string>(PRODUCTS[0].tabs[0].key);

  const product = useMemo<Product>(() => PRODUCTS.find((p) => p.id === prodId) ?? PRODUCTS[0], [prodId]);
  const tab: HubTab = product.tabs.find((t) => t.key === tabKey) ?? product.tabs[0];

  function selectProduct(id: string) {
    const p = PRODUCTS.find((x) => x.id === id);
    if (!p) return;
    setProdId(id);
    // preserva a aba pela key se existir no novo produto, senão cai na 1ª (padrão comum)
    setTabKey((prev) => (p.tabs.some((t) => t.key === prev) ? prev : p.tabs[0].key));
  }

  const Comp = tab.Comp;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Hubs de Produto</h1>
        <p className={styles.subtitle}>
          Cada produto, um funil separado — mesmo padrão de abas. Fase 0: casca config-driven; as abas “a construir” entram nas próximas fases.
        </p>
      </div>

      {/* seletor de PRODUTO */}
      <div className={styles.tabs} role="tablist" aria-label="Produtos">
        {PRODUCTS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === prodId}
            className={p.id === prodId ? styles.tabActive : styles.tab}
            style={p.id === prodId ? { borderColor: p.cor, color: p.cor } : undefined}
            onClick={() => selectProduct(p.id)}
          >
            <span aria-hidden="true">{p.emoji}</span> {p.nome}
          </button>
        ))}
      </div>

      {/* SUB-ABAS do produto selecionado */}
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
            <span
              aria-hidden="true"
              style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: DOT[t.status], marginRight: 7, verticalAlign: 'middle' }}
            />
            {t.label}
          </button>
        ))}
      </div>

      {/* CONTEÚDO da aba: painel real (reuso) OU placeholder */}
      <div style={{ marginTop: 20 }}>
        {Comp ? (
          <Comp />
        ) : (
          <div className={styles.card} style={{ textAlign: 'center', padding: '44px 24px' }}>
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
                color: DOT[tab.status], border: `1px solid ${DOT[tab.status]}`, borderRadius: 999, padding: '4px 12px', marginBottom: 14,
              }}
            >
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
    </div>
  );
}
