'use client';

// ─────────────────────────────────────────────────────────────────────────────
// A VIEW DOS HUBS DE PRODUTO: é o conteúdo do próprio /admin (Painel SolarDoc).
// Navegação em três níveis, um sistema só (navegacao.module.css):
//   1. Produto (trilho com ícone de traço) + Estúdio e Meta Ads, que são globais;
//   2. Área do produto (pílulas, do products.config);
//   3. Seção, dentro do painel que tem sub-abas (SubAbas, sublinhado).
// Config-driven: produto ou área nova entra só no products.config.
// ─────────────────────────────────────────────────────────────────────────────
import { useId, useState } from 'react';
import styles from '../admin.module.css';
import n from './navegacao.module.css';
import Trilho from './Trilho';
import { PRODUCTS, type HubTab, type Product } from './products.config';
import { Clapperboard, Megaphone, type LucideIcon } from 'lucide-react';
import MetaAdsPanel from '../_components/MetaAdsPanel';
import EstudioPanel from '../_components/EstudioPanel';

const META = '__meta';
const ESTUDIO = '__estudio';
const STATUS_LABEL: Record<HubTab['status'], string> = { pronto: 'pronto', parcial: 'parcial', construir: 'a construir' };

const GLOBAIS: { id: string; nome: string; Icone: LucideIcon }[] = [
  { id: ESTUDIO, nome: 'Estúdio', Icone: Clapperboard },
  { id: META, nome: 'Meta Ads', Icone: Megaphone },
];

export default function ProductHubView() {
  const [prodId, setProdId] = useState<string>(PRODUCTS[0].id);
  const [tabKey, setTabKey] = useState<string>(PRODUCTS[0].tabs[0].key);
  const base = useId();

  const isMeta = prodId === META;
  const isEstudio = prodId === ESTUDIO;
  const isGlobal = isMeta || isEstudio;
  const product: Product = PRODUCTS.find((p) => p.id === prodId) ?? PRODUCTS[0];
  const tab: HubTab = product.tabs.find((t) => t.key === tabKey) ?? product.tabs[0];

  function selectProduct(id: string) {
    setProdId(id);
    if (id === META || id === ESTUDIO) return;
    const p = PRODUCTS.find((x) => x.id === id);
    if (p) setTabKey((prev) => (p.tabs.some((t) => t.key === prev) ? prev : p.tabs[0].key));
  }

  const idProduto = (id: string) => `${base}-produto-${id}`;
  const idArea = (key: string) => `${base}-area-${key}`;
  const idPainel = `${base}-painel`;
  const Comp = tab.Comp;

  function botaoProduto(id: string, nome: string, Icone: LucideIcon) {
    const sel = isGlobal ? id === prodId : id === product.id;
    return (
      <button
        key={id}
        id={idProduto(id)}
        type="button"
        role="tab"
        aria-selected={sel}
        aria-controls={idPainel}
        tabIndex={sel ? 0 : -1}
        className={n.produto}
        onClick={() => selectProduct(id)}
      >
        <Icone size={17} strokeWidth={1.75} aria-hidden="true" />
        {nome}
      </button>
    );
  }

  return (
    <>
      <nav className={n.nav} aria-label="Navegação do painel">
        <Trilho rotulo="Produtos" ativo={prodId} className={n.produtos}>
          {PRODUCTS.map((p) => botaoProduto(p.id, p.nome, p.Icone))}
          <span className={n.divisor} aria-hidden="true" />
          {GLOBAIS.map((g) => botaoProduto(g.id, g.nome, g.Icone))}
        </Trilho>

        {!isGlobal && (
          <Trilho rotulo={`Áreas de ${product.nome}`} ativo={`${product.id}:${tab.key}`}>
            {product.tabs.map((t) => {
              const sel = t.key === tab.key;
              return (
                <button
                  key={t.key}
                  id={idArea(t.key)}
                  type="button"
                  role="tab"
                  aria-selected={sel}
                  aria-controls={idPainel}
                  tabIndex={sel ? 0 : -1}
                  className={n.area}
                  onClick={() => setTabKey(t.key)}
                >
                  {t.label}
                  {t.status !== 'pronto' && (
                    <>
                      <span className={`${n.status} ${n[t.status]}`} aria-hidden="true" title={STATUS_LABEL[t.status]} />
                      <span className={n.sr}>({STATUS_LABEL[t.status]})</span>
                    </>
                  )}
                </button>
              );
            })}
          </Trilho>
        )}
      </nav>

      <div
        id={idPainel}
        role="tabpanel"
        aria-labelledby={isGlobal ? idProduto(prodId) : idArea(tab.key)}
      >
        {isEstudio ? (
          <EstudioPanel />
        ) : isMeta ? (
          <MetaAdsPanel />
        ) : Comp ? (
          <Comp />
        ) : (
          <div className={`${styles.card} ${n.vazio}`}>
            <span className={n.vazioIcone} aria-hidden="true"><product.Icone size={22} strokeWidth={1.75} /></span>
            <h2 className={n.vazioTitulo}>{product.nome}: {tab.label}</h2>
            <p className={n.vazioTexto}>
              {tab.nota ?? 'Esta área ainda não tem painel. Entra numa próxima fase.'}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
