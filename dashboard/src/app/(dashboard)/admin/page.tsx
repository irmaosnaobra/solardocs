'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Painel SolarDoc = os HUBS DE PRODUTO (não é mais um menu à parte).
// Cada produto é um hub com suas abas, config-driven em hubs/products.config.
// As antigas abas planas (Membros/Funil/LP/Receita SolarDoc+LimpaPro) viraram
// sub-abas DENTRO do produto; Meta Ads segue como aba GLOBAL. Tráfego Pago saiu
// (não é produto). Os painéis antigos continuam vivos — só passaram a ser
// reusados pelo hub (ProductHubView / products.config).
// ─────────────────────────────────────────────────────────────────────────────
import styles from './admin.module.css';
import ProductHubView from './hubs/ProductHubView';

export default function AdminPage() {
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Painel SolarDoc</h1>
        <p className={styles.subtitle}>Cada produto, um hub — funil, membros, página de venda, followup, agente e config.</p>
      </div>
      <ProductHubView />
    </div>
  );
}
