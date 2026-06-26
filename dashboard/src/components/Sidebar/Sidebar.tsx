'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Settings, Zap, FolderOpen, FileText,
  LayoutDashboard, Building2, Users, User, Handshake,
  Banknote, ScrollText, FileSignature, Receipt,
  Wrench, Briefcase, ClipboardCheck, Sparkles, BarChart3, Calculator,
  Save, GraduationCap, Smartphone,
  Send, MapPin, LogOut, TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { removeToken } from '@/services/auth';
import PlanBadge from '../PlanBadge/PlanBadge';
import Logo from '../Logo/Logo';
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
  companyNome?: string | null;
  onUpgradeClick: () => void;
}

interface NavItem {
  href: string;
  icon: LucideIcon;
  label: string;
  external?: boolean;
  count?: number;
  requireCompany?: boolean;
  vipOnly?: boolean;
  paidOnly?: boolean; // free vê locked → clique abre upgrade modal
}

// ── Configuração das 5 seções ─────────────────────────────────────

const baseAdminItems: NavItem[] = [
  { href: '/admin',              icon: Settings,   label: 'Painel SolarDoc' },
  { href: '/crm/solardoc',       icon: FolderOpen, label: 'CRM SolarDoc' },
  // Funil SolarDoc e Funil LimpaPro viraram abas dentro do Painel SolarDoc (/admin) —
  // saíram daqui pra não duplicar. Rotas /admin/funil e /admin/funil-limpapro seguem vivas.
  { href: '/admin/leads-google', icon: MapPin,     label: 'Leads Google' },
  { href: '/admin/insights',     icon: BarChart3,  label: 'Insights IO' },
  { href: '/admin/disparos',     icon: Send,       label: 'Disparos IO' },
  // Link na Bio IO e Indicações IO viraram sub-abas dentro do Funil LimpaPro
  // (Painel SolarDoc → aba Funil LimpaPro) — saíram daqui pra não duplicar.
  // Rotas /admin/links-io e /admin/indicacoes-io seguem vivas (acesso por URL).
];

// Bloco de topo, na ordem: Dashboard (locked pra free) > Gerador > Baixe o App.
// Baixe o App fica liberado pra todo mundo, inclusive free.
// Mascote e Baixe o App foram pra topbar (ícones). Sidebar só com o Gerador.
const topoItems: NavItem[] = [
  { href: '/documentos?tipo=proposta', icon: Sparkles,    label: 'Gerador de Proposta', requireCompany: true },
  // Precificação: ferramenta grátis (isca de retenção) — sem requireCompany, free também vê.
  { href: '/precificacao',             icon: Calculator,  label: 'Precificação' },
];

// Empresa saiu daqui — vive no menu do avatar (topbar), pra não duplicar.
// Tudo liberado pra free (sem paidOnly); o limite é nos 10 docs/mês, não nas telas.
const cadastroItems: NavItem[] = [
  { href: '/clientes',  icon: Users,     label: 'Clientes',  requireCompany: true },
  { href: '/terceiros', icon: Handshake, label: 'Terceiros', requireCompany: true },
];

const docsClienteItems: NavItem[] = [
  { href: '/documentos?tipo=proposta-bancaria', icon: Banknote,       label: 'Proposta de Banco',  requireCompany: true },
  { href: '/documentos?tipo=contrato-solar',    icon: FileSignature,  label: 'Contrato Solar',     requireCompany: true },
  { href: '/documentos?tipo=procuracao',        icon: ScrollText,     label: 'Procuração',         requireCompany: true },
  { href: '/documentos?tipo=recibo',            icon: Receipt,        label: 'Recibo',             requireCompany: true },
];

const docsTerceiroItems: NavItem[] = [
  { href: '/documentos?tipo=prestacao-servico', icon: Wrench,    label: 'Prestação de Serviço', requireCompany: true },
  { href: '/documentos?tipo=contrato-pj',       icon: Briefcase, label: 'Contrato Vendedor',     requireCompany: true },
];

// Documentos Salvos vive no avatar (topbar); Mentorias removido. Seção Conta vazia.
const contaItems: NavItem[] = [];

// ── Itens que no DESKTOP vivem na topbar/avatar, mas no MOBILE a topbar some,
//    então precisam aparecer no drawer. Esta seção é mobile-only (CSS).
//    IMPORTANTE: NADA de requireCompany aqui — Empresa é onde se cadastra a
//    empresa; gatear viraria catch-22 (sem empresa não acessa Empresa).
const mobileContaItems: NavItem[] = [
  { href: '/minha-conta',       icon: User,       label: 'Minha Conta' },
  { href: '/empresa',           icon: Building2,  label: 'Empresa' },
  { href: '/conta/documentos',  icon: Save,       label: 'Documentos Salvos' },
  { href: '/baixe-app',         icon: Smartphone, label: 'Baixe o App' },
  { href: '/trafego', icon: TrendingUp, label: 'Tráfego Pago' },
];

// ── Componente principal ────────────────────────────────────────────

export default function Sidebar({ user, hasCompany, companyNome, onUpgradeClick }: SidebarProps) {
  // Saudação: nome do responsável → senão nome da empresa → senão prefixo do email.
  // (Regra: todo cliente mostra responsável ou empresa, nunca lixo/email cru.)
  const greetingName =
    (user.nome && user.nome.trim()) ||
    (companyNome && companyNome.trim()) ||
    user.email.split('@')[0];
  const pathname = usePathname();
  const router = useRouter();
  const isVip = user.plano === 'ilimitado';
  const isFree = user.plano === 'free';
  const isAdmin = !!user.is_admin;
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [pathname]);

  const adminItems: NavItem[] = baseAdminItems;

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    // marca o body enquanto o drawer está aberto → CSS esconde o ChatWidget
    // (z-index 99999) que senão fica por cima do menu no mobile.
    document.body.classList.toggle('sd-drawer-open', open);
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('sd-drawer-open');
    };
  }, [open]);

  function handleLogout() {
    removeToken();
    router.push('/auth?mode=login');
  }

  function renderItem(item: NavItem) {
    const active = pathname === item.href;
    const lockedByCompany = !isAdmin && !hasCompany && !!item.requireCompany;
    const lockedByVip = !!item.vipOnly && !isVip && !isAdmin;
    const lockedByFree = !!item.paidOnly && isFree && !isAdmin;
    const lockedByPlan = lockedByVip || lockedByFree;

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
      const title = lockedByVip ? 'Disponível no plano VIP' : 'Faça upgrade para liberar';
      return (
        <button key={item.href} className={styles.navItemLocked} onClick={onUpgradeClick} title={title}>
          <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11 }}>🔒</span>
        </button>
      );
    }

    const badge = item.count != null ? (
      <span className={styles.countBadge}>{item.count}</span>
    ) : null;

    if (item.external) {
      return (
        <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"
           className={styles.navItem}>
          <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
          {badge}
          <span className={styles.externalIcon}>↗</span>
        </a>
      );
    }

    return (
      <Link key={item.href} href={item.href}
            className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}>
        <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
        <span className={styles.navLabel}>{item.label}</span>
        {badge}
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
        {greetingName && (
          <div className={styles.userGreeting}>
            <span className={styles.userHello}>Olá,</span>
            <span className={styles.userName}>{greetingName}</span>
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

        {/* ── Menu: Dashboard, Gerador (destaque), Baixe o App ── */}
        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Menu</span>
        </div>
        <div className={styles.navSection}>
          {topoItems.map(renderItem)}
        </div>

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

        {/* ── Seção 5: Conta (só renderiza se houver itens) ── */}
        {contaItems.length > 0 && (
          <>
            <div className={styles.navDivider}>
              <span className={styles.navDividerLabel}>Conta</span>
            </div>
            <div className={styles.navSection}>
              {contaItems.map(renderItem)}
            </div>
          </>
        )}

        {/* ── Conta (MOBILE ONLY): no desktop estes itens vivem na topbar/avatar.
              No mobile a topbar some, então aparecem aqui. CSS esconde no desktop. ── */}
        <div className={styles.mobileOnlySection}>
          <div className={styles.navDivider}>
            <span className={styles.navDividerLabel}>Conta</span>
          </div>
          <div className={styles.navSection}>
            {mobileContaItems.map(renderItem)}
          </div>
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
          <button
            className={styles.upgradeBtn}
            onClick={onUpgradeClick}
            style={isFree ? {
              background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
              color: '#0f172a',
              fontWeight: 900,
              boxShadow: '0 4px 18px rgba(245,158,11,0.45)',
              animation: 'sd-upgrade-pulse 2.6s ease-in-out infinite',
            } : undefined}
          >
            ⚡ Fazer Upgrade
          </button>
        )}
        {isFree && !isAdmin && (
          <style>{`@keyframes sd-upgrade-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}`}</style>
        )}
        {/* "Sair" no desktop vive no menu do avatar (topbar). No mobile a topbar
            some (display:none), então o botão precisa existir AQUI — visível só
            no mobile pra não duplicar no desktop. */}
        <button className={styles.logoutBtnMobile} onClick={handleLogout}>
          <LogOut size={15} strokeWidth={1.75} /> Sair
        </button>
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
      </div>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

      {sidebarContent}
    </>
  );
}
