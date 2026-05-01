'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { removeToken } from '@/services/auth';
import PlanBadge from '../PlanBadge/PlanBadge';
import Logo from '../Logo/Logo';
import styles from './Sidebar.module.css';

interface User {
  plano: string;
  documentos_usados: number;
  limite_documentos: number;
  is_admin?: boolean;
}

interface SidebarProps {
  user: User;
  hasCompany: boolean;
  onUpgradeClick: () => void;
}

const STRIPE_VIP = 'https://buy.stripe.com/bJe7sK6el9hmgNe0KDfrW02';
const PLANILHA_MESTRE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSvd79xaG3qQwyko6BegyUaZmvd0B1FmtkaN9Oafm3qmU5yY86T2qA0EP_CysGf6bpRjxCccMOiqLxp/pubhtml';
const TRELLO_HOMOLOGACAO_URL = 'https://trello.com/invite/b/678a89a047242f02d443f8e0/ATTI3bb1a020220b7bd024f4812d12210e193C056740/engenheiro-guilherme';

type Badge = 'admin' | 'vip' | 'ment' | null;

interface NavItem {
  href: string;
  icon: string;
  label: string;
  badge?: Badge;
  external?: boolean;
  count?: number;
  requireCompany?: boolean;
}

// ── Configuração das 5 seções ─────────────────────────────────────

const adminItems: NavItem[] = [
  { href: '/admin',                   icon: '⚙️', label: 'Painel Admin' },
  { href: '/crm/solar-io',            icon: '⚡', label: 'CRM Solar', count: 749 },
  { href: '/crm/solardoc',            icon: '📁', label: 'CRM SolarDoc', count: 58 },
  { href: '/admin/gerador-propostas', icon: '📄', label: 'Gerador de Proposta' },
  { href: PLANILHA_MESTRE_URL,        icon: '📊', label: 'Planilha Mestre',     external: true },
  { href: TRELLO_HOMOLOGACAO_URL,     icon: '📌', label: 'Homologação',         external: true },
];

const cadastroItems: NavItem[] = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard', badge: 'vip' },
  { href: '/empresa',   icon: '🏢', label: 'Empresa' },
  { href: '/clientes',  icon: '👥', label: 'Cliente',  requireCompany: true },
  { href: '/terceiros', icon: '🤝', label: 'Terceiro', requireCompany: true },
];

const docsClienteItems: NavItem[] = [
  { href: '/docs/proposta-banco', icon: '🏦', label: 'Proposta de Banco', requireCompany: true },
  { href: '/docs/contrato-solar', icon: '📜', label: 'Contrato Solar',    requireCompany: true },
  { href: '/docs/procuracao',     icon: '📋', label: 'Procuração',        requireCompany: true },
];

const docsTerceiroItems: NavItem[] = [
  { href: '/docs/prestacao-servico', icon: '🛠️', label: 'Prestação de Serviço', requireCompany: true },
  { href: '/docs/contra-venda-pj',   icon: '💼', label: 'Contra Venda PJ',       requireCompany: true },
];

const contaItems: NavItem[] = [
  { href: '/conta/documentos',                     icon: '💾', label: 'Documentos Salvos',       badge: 'vip' },
  { href: '/conta/sugestoes',                      icon: '💡', label: 'Sugestão',                badge: 'vip' },
  { href: '/conta/mao-de-obra',                    icon: '🔧', label: 'Cadastro de Mão de Obra', badge: 'vip' },
  { href: '/mentoria/combo-financeiro-engenharia', icon: '⚡', label: 'COMBO Mestre + Trello',   badge: 'ment' },
  { href: '/mentoria/planilha-mestre',             icon: '📊', label: 'Planilha Mestre',         badge: 'ment' },
  { href: '/mentoria/trello-homologacao',          icon: '📌', label: 'Trello Homologação',      badge: 'ment' },
  { href: '/mentoria/trafego',                     icon: '📣', label: 'Tráfego Pago',            badge: 'ment' },
  { href: '/mentoria/gerador',                     icon: '📄', label: 'Gerador de Proposta',     badge: 'ment' },
  { href: '/mentoria/parceiro-integrador',         icon: '🎯', label: 'Parceiro Integrador',     badge: 'ment' },
];

// ── Badges ──────────────────────────────────────────────────────────

function BadgeAdmin() { return <span className={styles.badgeAdmin}>🔒 ADMIN</span>; }
function BadgeVip()   { return <span className={styles.badgeVip}>★ VIP</span>; }
function BadgeMent()  { return <span className={styles.badgeMent}>◆ MENT</span>; }

function ItemBadge({ badge }: { badge?: Badge }) {
  if (badge === 'vip') return <BadgeVip />;
  if (badge === 'ment') return <BadgeMent />;
  return null;
}

// ── Componente principal ────────────────────────────────────────────

export default function Sidebar({ user, hasCompany, onUpgradeClick }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isVip = user.plano === 'ilimitado';
  const isAdmin = !!user.is_admin;
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  function handleLogout() {
    removeToken();
    router.push('/auth?mode=login');
  }

  function renderItem(item: NavItem) {
    const active = pathname === item.href;
    const lockedByCompany = !isAdmin && !hasCompany && !!item.requireCompany;
    const vipNotAllowed = item.badge === 'vip' && !isVip && !isAdmin;

    if (lockedByCompany) {
      return (
        <div key={item.href} className={styles.navItemLocked} title="Cadastre o CNPJ da sua empresa primeiro">
          <span className={styles.navIcon}>{item.icon}</span>
          <span className={styles.navLabel}>{item.label}</span>
          <span className={styles.lockIcon}>🔒</span>
        </div>
      );
    }

    if (item.external) {
      return (
        <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"
           className={styles.navItem}>
          <span className={styles.navIcon}>{item.icon}</span>
          <span className={styles.navLabel}>{item.label}</span>
          {item.count != null && <span className={styles.countBadge}>{item.count}</span>}
          <span className={styles.externalIcon}>↗</span>
        </a>
      );
    }

    // Item VIP que o user não tem → leva pro Stripe (mantém UX existente)
    if (vipNotAllowed) {
      return (
        <a key={item.href} href={STRIPE_VIP} target="_blank" rel="noopener noreferrer"
           className={styles.navItem}>
          <span className={styles.navIcon}>{item.icon}</span>
          <span className={styles.navLabel}>{item.label}</span>
          <BadgeVip />
        </a>
      );
    }

    return (
      <Link key={item.href} href={item.href}
            className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}>
        <span className={styles.navIcon}>{item.icon}</span>
        <span className={styles.navLabel}>{item.label}</span>
        {item.count != null && <span className={styles.countBadge}>{item.count}</span>}
        <ItemBadge badge={item.badge} />
      </Link>
    );
  }

  const sidebarContent = (
    <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}>
      <div className={styles.logoWrap}>
        {(isVip || isAdmin) ? (
          <Link href="/dashboard" className={styles.logo}>
            <Logo className={styles.logoImg} />
          </Link>
        ) : (
          <button className={styles.logo} onClick={onUpgradeClick} title="Disponível no plano VIP">
            <Logo className={styles.logoImg} />
          </button>
        )}
      </div>

      <nav className={styles.nav}>
        {/* ── Seção 1: Área Restrita (admin only) ── */}
        {isAdmin && (
          <>
            <div className={styles.navDivider}>
              <span className={`${styles.navDividerLabel} ${styles.navDividerLabelAdmin}`}>Área Restrita</span>
              <BadgeAdmin />
            </div>
            <div className={styles.navSection}>
              {adminItems.map(renderItem)}
            </div>
          </>
        )}

        {/* ── Seção 2: Cadastro ── */}
        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Cadastro</span>
        </div>
        <div className={styles.navSection}>
          {cadastroItems.map(renderItem)}
        </div>

        {/* ── Seção 3: Docs Cliente ── */}
        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Docs Cliente</span>
        </div>
        <div className={styles.navSection}>
          {docsClienteItems.map(renderItem)}
        </div>

        {/* ── Seção 4: Docs Terceiro ── */}
        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Docs Terceiro</span>
        </div>
        <div className={styles.navSection}>
          {docsTerceiroItems.map(renderItem)}
        </div>

        {/* ── Seção 5: Conta ── */}
        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Conta</span>
        </div>
        <div className={styles.navSection}>
          {contaItems.map(renderItem)}
        </div>
      </nav>

      <div className={styles.footer}>
        {isAdmin && <div className={styles.adminBadge}>⚙️ Administrador</div>}

        <PlanBadge
          plano={user.plano}
          documentosUsados={user.documentos_usados}
          limiteDocumentos={user.limite_documentos}
        />

        {!isVip && !isAdmin && (
          <button className={styles.upgradeBtn} onClick={onUpgradeClick}>
            ⚡ Fazer Upgrade
          </button>
        )}

        <button className={styles.logoutBtn} onClick={handleLogout}>Sair</button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Barra superior mobile */}
      <div className={styles.mobileHeader}>
        <button className={styles.hamburger} onClick={() => setOpen(true)} aria-label="Abrir menu">
          <span /><span /><span />
        </button>
        {(isVip || isAdmin) ? (
          <Link href="/dashboard"><Logo className={styles.mobileLogoImg} /></Link>
        ) : (
          <button onClick={onUpgradeClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }} title="Disponível no plano VIP">
            <Logo className={styles.mobileLogoImg} />
          </button>
        )}
        <div style={{ width: 30 }} />
      </div>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

      {sidebarContent}
    </>
  );
}
