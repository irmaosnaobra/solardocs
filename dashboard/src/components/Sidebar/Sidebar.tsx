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

interface NavItem {
  href: string;
  icon: string;
  label: string;
  vipOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: '/empresa',   icon: '🏢', label: 'Empresa' },
  { href: '/clientes',  icon: '👥', label: 'Clientes' },
  { href: '/terceiros', icon: '🤝', label: 'Terceiros' },
];

const docClienteItems: NavItem[] = [
  { href: '/documentos?tipo=contrato-solar',    icon: '☀️', label: 'Contrato Solar' },
  { href: '/documentos?tipo=procuracao',        icon: '📜', label: 'Procuração' },
  { href: '/documentos?tipo=proposta-bancaria', icon: '🏦', label: 'Proposta Bancária' },
];

const docTerceiroItems: NavItem[] = [
  { href: '/documentos?tipo=prestacao-servico', icon: '🔧', label: 'Prestação de Serviço' },
  { href: '/documentos?tipo=contrato-pj',       icon: '🤝', label: 'Contrato PJ Vendas' },
];

function useBrasiliaTime() {
  const [time, setTime] = useState('');
  useEffect(() => {
    function tick() {
      const d = new Date(Date.now() - 3 * 3600 * 1000);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      setTime(`${hh}:${mm}:${ss}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export default function Sidebar({ user, hasCompany, onUpgradeClick }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const isVip    = user.plano === 'ilimitado';
  const isAdmin  = !!user.is_admin;
  const [open, setOpen] = useState(false);

  // Fecha ao trocar de rota
  useEffect(() => { setOpen(false); }, [pathname]);

  // Trava scroll do body quando aberto
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  function handleLogout() {
    removeToken();
    router.push('/auth?mode=login');
  }

  function renderNavItem(item: NavItem, lockedByCompany: boolean) {
    if (lockedByCompany) {
      return (
        <div
          key={item.href}
          className={styles.navItemLocked}
          title="Cadastre o CNPJ da sua empresa primeiro"
        >
          <span className={styles.navIcon}>{item.icon}</span>
          <span>{item.label}</span>
          <span className={styles.lockIcon}>🔒</span>
        </div>
      );
    }

    // Item VIP — não-VIP vai direto para checkout
    if (item.vipOnly && !isVip && !isAdmin) {
      return (
        <a
          key={item.href}
          href={STRIPE_VIP}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.navItem}
        >
          <span className={styles.navIcon}>{item.icon}</span>
          <span>{item.label}</span>
          <span className={styles.vipTag}>VIP</span>
        </a>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${styles.navItem} ${pathname === item.href ? styles.navItemActive : ''}`}
      >
        <span className={styles.navIcon}>{item.icon}</span>
        <span>{item.label}</span>
        {item.vipOnly && (isVip || isAdmin) && <span className={styles.vipTag}>VIP</span>}
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
        {(isVip || isAdmin) && (
          <Link href="/dashboard" className={`${styles.dashboardLink} ${pathname === '/dashboard' ? styles.dashboardLinkActive : ''}`}>
            dashboard
          </Link>
        )}
      </div>

      <nav className={styles.nav}>
        {/* Admin — só visível para admins */}
        {isAdmin && (
          <Link
            href="/admin"
            className={`${styles.navItem} ${styles.navItemDashboard} ${pathname === '/admin' ? styles.navItemActive : ''}`}
          >
            <span className={styles.navIcon}>⚙️</span>
            <span>Painel Admin</span>
          </Link>
        )}

        {/* CRM SDR — só admins */}
        {isAdmin && (
          <Link
            href="/crm"
            className={`${styles.navItem} ${styles.navItemDashboard} ${pathname === '/crm' ? styles.navItemActive : ''}`}
          >
            <span className={styles.navIcon}>📋</span>
            <span>CRM Leads</span>
          </Link>
        )}

        {/* Dashboard — VIP e Admin */}
        {(isVip || isAdmin) ? (
          <Link
            href="/dashboard"
            className={`${styles.navItem} ${styles.navItemDashboard} ${pathname === '/dashboard' ? styles.navItemActive : ''}`}
          >
            <span className={styles.navIcon}>📊</span>
            <span>Dashboard</span>
            <span className={styles.vipTag}>VIP</span>
          </Link>
        ) : (
          <a
            href={STRIPE_VIP}
            target="_blank"
            rel="noopener noreferrer"
            className={`${styles.navItem} ${styles.navItemDashboard}`}
          >
            <span className={styles.navIcon}>📊</span>
            <span>Dashboard</span>
            <span className={styles.vipTag}>VIP</span>
          </a>
        )}

        <div className={styles.navDivider}>
          <span className={`${styles.navDividerLabel} ${styles.navDividerLabelHighlight}`}>Cadastros</span>
        </div>
        <div className={styles.navSection}>
          {navItems.map((item) => {
            const locked = !isAdmin && !hasCompany && item.href !== '/empresa';
            return renderNavItem(item, locked);
          })}
        </div>

        <div className={styles.navDivider}>
          <span className={`${styles.navDividerLabel} ${styles.navDividerLabelHighlight}`}>Docs Clientes</span>
        </div>
        <div className={styles.navSection}>
          {docClienteItems.map((item) => renderNavItem(item, !isAdmin && !hasCompany))}
        </div>

        <div className={styles.navDivider}>
          <span className={`${styles.navDividerLabel} ${styles.navDividerLabelHighlight}`}>Docs Terceiros</span>
        </div>
        <div className={styles.navSection}>
          {docTerceiroItems.map((item) => renderNavItem(item, !isAdmin && !hasCompany))}
        </div>


        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Conta</span>
        </div>
        <div className={styles.navSection}>
          {renderNavItem({ href: '/historico', icon: '🗂️', label: 'Meus Documentos', vipOnly: true }, false)}
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

      {/* Overlay ao abrir */}
      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

      {sidebarContent}
    </>
  );
}
