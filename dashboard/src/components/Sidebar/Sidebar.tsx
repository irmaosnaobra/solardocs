'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Settings, Zap, FolderOpen, FileText, Sheet, Pin,
  LayoutDashboard, Building2, Users, Handshake,
  Banknote, ScrollText, FileSignature,
  Wrench, Briefcase, ClipboardCheck, Sparkles,
  Save, Lightbulb, HardHat, GraduationCap,
  type LucideIcon,
} from 'lucide-react';
import { removeToken } from '@/services/auth';
import PlanBadge from '../PlanBadge/PlanBadge';
import Logo from '../Logo/Logo';
import ThemeToggle from '../ThemeToggle/ThemeToggle';
import styles from './Sidebar.module.css';

interface User {
  email: string;
  nome?: string | null;
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

const PLANILHA_MESTRE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSvd79xaG3qQwyko6BegyUaZmvd0B1FmtkaN9Oafm3qmU5yY86T2qA0EP_CysGf6bpRjxCccMOiqLxp/pubhtml';
const TRELLO_HOMOLOGACAO_URL = 'https://trello.com/invite/b/678a89a047242f02d443f8e0/ATTI3bb1a020220b7bd024f4812d12210e193C056740/engenheiro-guilherme';

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  external?: boolean;
  count?: number;
  requireCompany?: boolean;
  vipOnly?: boolean;
}

// ── Configuração das 5 seções ─────────────────────────────────────

const adminItems: NavItem[] = [
  { href: '/admin',                   icon: Settings,   label: 'Painel Admin' },
  { href: '/crm/solardoc',            icon: FolderOpen, label: 'CRM SolarDoc', count: 58 },
  { href: PLANILHA_MESTRE_URL,        icon: Sheet,      label: 'Planilha Mestre',     external: true },
  { href: TRELLO_HOMOLOGACAO_URL,     icon: Pin,        label: 'Homologação',         external: true },
];

const cadastroItems: NavItem[] = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/empresa',   icon: Building2,       label: 'Empresa' },
  { href: '/clientes',  icon: Users,           label: 'Clientes',  requireCompany: true },
  { href: '/terceiros', icon: Handshake,       label: 'Terceiros', requireCompany: true },
];

const docsClienteItems: NavItem[] = [
  { href: '/documentos?tipo=proposta',          icon: Sparkles,       label: 'Proposta Solar',     requireCompany: true },
  { href: '/documentos?tipo=vistoria',          icon: ClipboardCheck, label: 'Vistoria CheckList', requireCompany: true },
  { href: '/documentos?tipo=proposta-bancaria', icon: Banknote,       label: 'Proposta de Banco',  requireCompany: true },
  { href: '/documentos?tipo=contrato-solar',    icon: FileSignature,  label: 'Contrato Solar',     requireCompany: true },
  { href: '/documentos?tipo=procuracao',        icon: ScrollText,     label: 'Procuração',         requireCompany: true },
];

const docsTerceiroItems: NavItem[] = [
  { href: '/documentos?tipo=prestacao-servico', icon: Wrench,    label: 'Prestação de Serviço', requireCompany: true },
  { href: '/documentos?tipo=contrato-pj',       icon: Briefcase, label: 'Contrato Vendedor',     requireCompany: true },
];

const contaItems: NavItem[] = [
  { href: '/conta/documentos',  icon: Save,           label: 'Documentos Salvos',       vipOnly: true },
  { href: '/conta/sugestoes',   icon: Lightbulb,      label: 'Sugestões',               vipOnly: true },
  { href: '/conta/mao-de-obra', icon: HardHat,        label: 'Cadastro de Mão de Obra', vipOnly: true },
  { href: '/mentoria',          icon: GraduationCap,  label: 'Mentorias' },
];

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
    const lockedByPlan = !!item.vipOnly && !isVip && !isAdmin;

    // Bloqueado por falta de empresa → cinza, sem badge
    if (lockedByCompany) {
      return (
        <div key={item.href} className={styles.navItemLocked} title="Cadastre o CNPJ da sua empresa primeiro">
          <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
        </div>
      );
    }

    // Bloqueado por plano → clique abre o modal contextual (sem badge no menu)
    if (lockedByPlan) {
      return (
        <button key={item.href} className={styles.navItemLocked} onClick={onUpgradeClick} title="Disponível no plano VIP">
          <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
        </button>
      );
    }

    if (item.external) {
      return (
        <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"
           className={styles.navItem}>
          <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
          {item.count != null && <span className={styles.countBadge}>{item.count}</span>}
          <span className={styles.externalIcon}>↗</span>
        </a>
      );
    }

    return (
      <Link key={item.href} href={item.href}
            className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}>
        <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
        <span className={styles.navLabel}>{item.label}</span>
        {item.count != null && <span className={styles.countBadge}>{item.count}</span>}
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
        {(user.nome || user.email) && (
          <div className={styles.userGreeting}>
            <span className={styles.userHello}>Olá,</span>
            <span className={styles.userName}>{user.nome || user.email.split('@')[0]}</span>
          </div>
        )}
      </div>

      <nav className={styles.nav}>
        {/* ── Seção 1: Área Restrita (admin only) ── */}
        {isAdmin && (
          <>
            <div className={styles.navDivider}>
              <span className={`${styles.navDividerLabel} ${styles.navDividerLabelAdmin}`}>Área Restrita</span>
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
        <ThemeToggle />
      </div>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

      {sidebarContent}
    </>
  );
}
