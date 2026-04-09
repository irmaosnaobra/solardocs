'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { removeToken } from '@/services/auth';
import PlanBadge from '../PlanBadge/PlanBadge';
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

interface NavItem {
  href: string;
  icon: string;
  label: string;
}

const navItems: NavItem[] = [
  { href: '/empresa',   icon: '🏢', label: 'Empresa' },
  { href: '/clientes',  icon: '👥', label: 'Clientes' },
  { href: '/terceiros', icon: '🤝', label: 'Terceiros' },
];

const docClienteItems: NavItem[] = [
  { href: '/documentos/contrato-solar',    icon: '☀️', label: 'Contrato Solar' },
  { href: '/documentos/procuracao',        icon: '📜', label: 'Procuração' },
  { href: '/documentos/proposta-bancaria', icon: '🏦', label: 'Proposta Bancária' },
];

const docTerceiroItems: NavItem[] = [
  { href: '/documentos/prestacao-servico', icon: '🔧', label: 'Prestação de Serviço' },
  { href: '/documentos/contrato-pj',       icon: '🤝', label: 'Contrato PJ Vendas' },
];

export default function Sidebar({ user, hasCompany, onUpgradeClick }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isVip   = user.plano === 'ilimitado';
  const isAdmin = !!user.is_admin;

  function handleLogout() {
    removeToken();
    router.push('/login');
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

    return (
      <Link
        key={item.href}
        href={item.href}
        className={`${styles.navItem} ${pathname === item.href ? styles.navItemActive : ''}`}
      >
        <span className={styles.navIcon}>{item.icon}</span>
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoWrap}>
        <Link href={(isVip || isAdmin) ? '/dashboard' : '/empresa'} className={styles.logo}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="SolarDoc Pro" className={styles.logoImg} />
        </Link>
        {(isVip || isAdmin) && (
          <Link href="/dashboard" className={`${styles.dashboardLink} ${pathname === '/dashboard' ? styles.dashboardLinkActive : ''}`}>
            dashboard
          </Link>
        )}
      </div>

      <nav className={styles.nav}>
        <div className={styles.navDivider}>
          <span className={`${styles.navDividerLabel} ${styles.navDividerLabelHighlight}`}>Cadastros</span>
        </div>

        <div className={styles.navSection}>
          {navItems.map((item) => {
            const lockedByCompany = !isAdmin && !hasCompany && item.href !== '/empresa';
            return renderNavItem(item, lockedByCompany);
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
      </nav>

      <div className={styles.footer}>
        {isAdmin && (
          <div className={styles.adminBadge}>⚙️ Administrador</div>
        )}

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

        <Link
          href="/sugestoes"
          className={`${styles.suggestBtn} ${pathname === '/sugestoes' ? styles.suggestBtnActive : ''}`}
        >
          💎 Sugestões VIP
        </Link>

        <button className={styles.logoutBtn} onClick={handleLogout}>
          Sair
        </button>
      </div>
    </aside>
  );
}
