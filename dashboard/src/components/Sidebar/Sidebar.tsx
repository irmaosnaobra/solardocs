'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Settings, Zap, FileText, Lock,
  LayoutDashboard, Building2, Users, User, Handshake,
  Banknote, ScrollText, FileSignature, Receipt,
  Wrench, Briefcase, ClipboardCheck, Sparkles, BarChart3, Calculator,
  Boxes, Save, GraduationCap, Smartphone, BatteryCharging,
  Send, LogOut, TrendingUp, LayoutGrid, Tags,
  type LucideIcon,
} from 'lucide-react';
import { removeToken } from '@/services/auth';
import { useAcessos } from '@/hooks/useAcessos';
import { produtoPorId } from '@/lib/produtos';
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
  /**
   * id do produto no catálogo. Quem não tem vê cadeado e o clique leva pra mini
   * LP — nunca pra um beco. Quem tem vê o item normal, sem nada em volta.
   */
  produto?: string;
}

// ── Configuração das 5 seções ─────────────────────────────────────

const baseAdminItems: NavItem[] = [
  { href: '/admin',              icon: Settings,   label: 'Painel SolarDoc' },
  // CRM SolarDoc, Funil SolarDoc e Funil LimpaPro viraram abas dentro do Painel
  // SolarDoc (/admin) — saíram daqui pra não duplicar. Rotas /crm/solardoc,
  // /admin/funil e /admin/funil-limpapro seguem vivas (acesso pela aba / URL).
  { href: '/admin/pesquisa-disparo', icon: Send,   label: 'Pesquisa/Disparo IO' },
  { href: '/admin/insights',     icon: BarChart3,  label: 'Insights IO' },
  { href: '/admin/leads-origem', icon: Tags,       label: 'Leads por Origem' },
  // Link na Bio IO e Indicações IO viraram sub-abas dentro do Funil LimpaPro
  // (Painel SolarDoc → aba Funil LimpaPro) — saíram daqui pra não duplicar.
  // Rotas /admin/links-io e /admin/indicacoes-io seguem vivas (acesso por URL).
];

// Bloco de topo, na ordem: Dashboard (locked pra free) > Gerador > Baixe o App.
// Baixe o App fica liberado pra todo mundo, inclusive free.
// Mascote e Baixe o App foram pra topbar (ícones). Sidebar só com o Gerador.
const topoItems: NavItem[] = [
  { href: '/documentos?tipo=proposta', icon: Sparkles,    label: 'Gerador de Proposta', requireCompany: true },
];

// ── FERRAMENTAS ─────────────────────────────────────────────────────────────
// O que se usa no dia de trabalho. As pagas trazem `produto`: quem não comprou
// vê cadeado e cai na mini LP em vez de bater numa tela vazia.
const ferramentasItems: NavItem[] = [
  { href: '/vistoria',     icon: ClipboardCheck, label: 'Vistoria Solar' },
  { href: '/precificacao', icon: Calculator,     label: 'Precificação',   produto: 'precificacao' },
  { href: '/inventario',   icon: Boxes,          label: 'Inventário',     produto: 'inventario' },
  // Off-grid NÃO leva `produto`: a tela é aberta de propósito (dimensionar e ver
  // a autonomia é grátis) e o cadeado dela cai só sobre o preço, lá dentro.
  { href: '/off-grid',     icon: BatteryCharging, label: 'Kit Off-Grid' },
];

// ── CURSOS ──────────────────────────────────────────────────────────────────
const cursosItems: NavItem[] = [
  { href: '/cursos/kit-fechamento', icon: GraduationCap, label: 'Kit Fecha Vendas', produto: 'curso-fechamento' },
  { href: '/lp/limpapro',           icon: Sparkles,      label: 'LimpaPro',         produto: 'curso-limpapro' },
];

// A loja: onde tudo que existe aparece junto, com o estado de cada um.
const lojaItem: NavItem = { href: '/produtos', icon: LayoutGrid, label: 'Ferramentas e cursos' };

// Empresa saiu daqui — vive no menu do avatar (topbar), pra não duplicar.
// Telas navegáveis pra free (sem paidOnly aqui), MAS o backend
// (documentsController:65) só deixa o free GERAR propostaSolar — os outros
// tipos retornam 402 "faça upgrade". O gate é no generate, não na navegação.
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
  const searchParams = useSearchParams();
  // href cheio atual (pathname + ?tipo=...) pra casar com os itens de doc,
  // que diferem só pela query (/documentos?tipo=proposta vs ?tipo=recibo).
  const currentTipo = searchParams.get('tipo');
  const router = useRouter();
  // PREÇO ÚNICO: só existem dois estados — grátis e assinante. Os slugs legados
  // ('pro', 'iniciante') são de quem assinou por 27/47/49 e continua pagando;
  // eles não veem mais botão de upgrade permanente. Se o teto de documentos do
  // contrato antigo estourar, o modal ainda abre sozinho pelo 'limit-reached'.
  const isVip = user.plano !== 'free';
  const isFree = user.plano === 'free';
  const isAdmin = !!user.is_admin;
  const [open, setOpen] = useState(false);
  // Quem decide o cadeado é o servidor (uma chamada, cacheada no módulo).
  const { carregando: acessosCarregando, tem, bastidor } = useAcessos();

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
    // Casa pathname E o ?tipo= — os itens de documento têm o mesmo /documentos
    // e diferem só pela query, então comparar só pathname nunca acendia nenhum.
    const [itemPath, itemQuery] = item.href.split('?');
    const itemTipo = itemQuery ? new URLSearchParams(itemQuery).get('tipo') : null;
    const active = pathname === itemPath && (itemTipo ? currentTipo === itemTipo : !currentTipo);
    const lockedByCompany = !isAdmin && !hasCompany && !!item.requireCompany;
    const lockedByVip = !!item.vipOnly && !isVip && !isAdmin;
    const lockedByFree = !!item.paidOnly && isFree && !isAdmin;
    const lockedByPlan = lockedByVip || lockedByFree;
    // Produto não comprado: cadeado que LEVA A ALGUM LUGAR (a mini LP). Enquanto
    // a resposta do servidor não chega, o item fica normal — piscar cadeado na
    // cara de quem pagou gera chamado no suporte na hora.
    const prod = item.produto ? produtoPorId(item.produto) : null;
    // Fora do bastidor, ferramenta que já era grátis segue SEM cadeado: pra base
    // a novidade ainda não existe.
    const lockedByProduto = !!prod && bastidor && !acessosCarregando && !isAdmin && !tem(item.produto!);

    // Bloqueado por falta de empresa → cinza, sem badge
    if (lockedByCompany) {
      return (
        <div key={item.href} className={styles.navItemLocked} title="Cadastre o CNPJ da sua empresa primeiro">
          <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
        </div>
      );
    }

    // Produto não comprado → vai pra mini LP, com cadeado no lugar do ícone.
    if (lockedByProduto && prod) {
      return (
        // O cadeado leva pra LP PUBLICA (/lp/<slug>), nao pra versao de dentro
        // do app. E' uma pagina de venda so': a mesma que o anuncio abre, a
        // mesma que o cliente ve. Duas portas pro mesmo produto davam duas
        // ofertas pra manter em dia.
        <Link key={item.href} href={`/lp/${prod.slug}`}
              className={styles.navItemLocked} title={`${prod.nome} — ver o que tem dentro`}>
          <Lock className={styles.navIcon} size={15} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
        </Link>
      );
    }

    // Bloqueado por plano → clique abre o modal contextual (sem badge no menu)
    if (lockedByPlan) {
      const title = lockedByVip ? 'Disponível para assinantes' : 'Assine para liberar';
      return (
        <button key={item.href} className={styles.navItemLocked} onClick={onUpgradeClick} title={title}>
          <item.icon className={styles.navIcon} size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
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
          <button className={styles.logo} onClick={onUpgradeClick} title="Disponível para assinantes">
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

        {/* ── Ferramentas: o que se usa no dia de trabalho ── */}
        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Ferramentas</span>
        </div>
        <div className={styles.navSection}>
          {topoItems.map(renderItem)}
          {/* Kit Off-Grid só aparece no lançamento restrito; o resto é de sempre. */}
          {ferramentasItems
            .filter((i) => bastidor || i.href !== '/off-grid')
            .map(renderItem)}
        </div>

        {/* ── Cursos ── */}
        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Cursos</span>
        </div>
        <div className={styles.navSection}>
          {cursosItems
            .filter((i) => bastidor || i.href !== '/lp/limpapro')
            .map(renderItem)}
        </div>

        {/* ── A loja: só entra no menu quando o lançamento abrir ── */}
        {bastidor && (
          <div className={styles.navSection}>
            {renderItem(lojaItem)}
          </div>
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
        {isAdmin && <div className={styles.adminBadge}>Administrador</div>}

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
            Fazer Upgrade
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
        {/* O padding (não o tamanho da logo) é o que dá alvo de dedo aos três
            controles deste header — a logo continua com os mesmos 28px. */}
        {(isVip || isAdmin) ? (
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', padding: '10px 12px' }}>
            <Logo className={styles.mobileLogoImg} />
          </Link>
        ) : (
          <button onClick={onUpgradeClick} style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: '10px 12px', cursor: 'pointer' }} title="Disponível para assinantes">
            <Logo className={styles.mobileLogoImg} />
          </button>
        )}
        {/* Voltar pra tela de atalho (launcher) — só faz sentido com empresa pronta.
            Sem empresa, um espaçador mantém o logo centralizado. */}
        {hasCompany ? (
          <Link href="/inicio" aria-label="Tela de atalho"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, marginRight: -7, color: '#fbbf24' }}>
            <LayoutGrid size={22} strokeWidth={2} />
          </Link>
        ) : (
          <span style={{ width: 37 }} />
        )}
      </div>

      {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}

      {sidebarContent}
    </>
  );
}
