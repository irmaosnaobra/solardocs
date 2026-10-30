'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Settings, Lock, ChevronRight,
  Building2, User, BarChart3, Smartphone,
  Send, LogOut, TrendingUp, LayoutGrid, Tags,
  type LucideIcon,
} from 'lucide-react';
import { removeToken } from '@/services/auth';
import { useAcessos } from '@/hooks/useAcessos';
import { useNexusPortal } from '@/hooks/useNexusPortal';
import { produtoPorId } from '@/lib/produtos';
import { logMenu, type EventoMenu } from '@/utils/logMenu';
import PlanBadge from '../PlanBadge/PlanBadge';
import Logo from '../Logo/Logo';
import {
  novaPropostaItem, lerContaItem, lojaItem, nexusItem, papeladaItems, outrosDocsItems,
  hrefVendaDoProduto, organizarMenu,
} from './itensMenu';
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
   * LP, nunca pra um beco. Quem tem vê o item normal, sem nada em volta.
   */
  produto?: string;
  /** Selo ao lado do nome (ex.: "Novo"). */
  badge?: string;
  /**
   * Destino fora do Next (página estática): navegação de página inteira com <a>
   * comum, na mesma aba. <Link> tentaria resolver como rota do app.
   */
  paginaInteira?: boolean;
  /** Clique contado em feature_events (feature "menu"). Nunca atrasa a navegação. */
  evento?: EventoMenu;
}

// ── Configuração do menu ─────────────────────────────────────────
//
// Os itens da tela (botões do topo, lista principal, papelada, "Para liberar") moram em
// ./itensMenu.ts, que a tela de atalhos do celular (/inicio) também lê: os dois sempre
// mostram os mesmos itens. Aqui ficam só os itens que são exclusivos do menu lateral.

const baseAdminItems: NavItem[] = [
  { href: '/admin',              icon: Settings,   label: 'Painel SolarDoc' },
  // CRM SolarDoc, Funil SolarDoc e Funil LimpaPro viraram abas dentro do Painel
  // SolarDoc (/admin) e saíram daqui pra não duplicar. Rotas /crm/solardoc,
  // /admin/funil e /admin/funil-limpapro seguem vivas (acesso pela aba / URL).
  { href: '/admin/pesquisa-disparo', icon: Send,   label: 'Leads Google' },
  { href: '/admin/insights',     icon: BarChart3,  label: 'Insights IO' },
  { href: '/admin/leads-origem', icon: Tags,       label: 'Leads por Origem' },
  // Link na Bio IO e Indicações IO viraram sub-abas dentro do Funil LimpaPro
  // (Painel SolarDoc, aba Funil LimpaPro). Rotas /admin/links-io e
  // /admin/indicacoes-io seguem vivas (acesso por URL).
];

// Dobrados em "Outros documentos": 5 de 1 pessoa, e 8 em 90 dias. Os três itens estão em ./itensMenu.ts.
const OUTROS_TIPOS = ['proposta-bancaria', 'prestacao-servico', 'contrato-pj'];
const CHAVE_OUTROS = 'sd-menu-outros';

// Itens que no DESKTOP vivem na topbar/avatar, mas no MOBILE a topbar some,
// então precisam aparecer no drawer. Esta seção é mobile-only (CSS).
// IMPORTANTE: NADA de requireCompany aqui. Empresa é onde se cadastra a
// empresa; gatear viraria catch-22 (sem empresa não acessa Empresa).
const mobileContaItems: NavItem[] = [
  { href: '/minha-conta', icon: User,       label: 'Minha Conta' },
  { href: '/empresa',     icon: Building2,  label: 'Empresa' },
  { href: '/baixe-app',   icon: Smartphone, label: 'Baixe o App', evento: 'baixe_app' },
  { href: '/trafego',     icon: TrendingUp, label: 'Tráfego Pago', evento: 'trafego_pago' },
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
  // PREÇO ÚNICO: só existem dois estados, grátis e assinante. Os slugs legados
  // ('pro', 'iniciante') são de quem assinou por 27/47/49 e continua pagando;
  // eles não veem mais botão de upgrade permanente. Se o teto de documentos do
  // contrato antigo estourar, o modal ainda abre sozinho pelo 'limit-reached'.
  const isVip = user.plano !== 'free';
  const isFree = user.plano === 'free';
  const isAdmin = !!user.is_admin;
  const [open, setOpen] = useState(false);
  // "Outros documentos" dobrado: lembra a escolha da pessoa neste aparelho.
  // Lido na montagem, com try/catch: o localStorage pode estar bloqueado. O menu só monta no
  // navegador (depois de a conta carregar), então não há HTML do servidor para divergir.
  const [outrosAberto, setOutrosAberto] = useState(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(CHAVE_OUTROS) === '1'; } catch { return false; }
  });
  // Fechado à mão enquanto a tela atual é um dos três (a rota abre sozinha, a pessoa pode fechar).
  const [fechadoNaRota, setFechadoNaRota] = useState<string | null>(null);
  // Ao mudar de tela, o "fechei à mão" da tela anterior não vale mais (a rota volta a abrir sozinha).
  const rotaAtual = `${pathname}?${currentTipo ?? ''}`;
  const [rotaVista, setRotaVista] = useState(rotaAtual);
  if (rotaVista !== rotaAtual) {
    setRotaVista(rotaAtual);
    setFechadoNaRota(null);
  }
  // Quem decide o cadeado é o servidor (uma chamada, cacheada no módulo).
  const { carregando: carregandoServidor, tem: temServidor, bastidor: bastidorServidor, previa } = useAcessos();
  // O cache de acessos só DESENHA o menu (sem pulo na carga). Enquanto o servidor não responde, o menu usa a
  // prévia; a porta de cada ferramenta (Cadeado) continua esperando o servidor, sem olhar para o cache.
  const acessosCarregando = previa ? false : carregandoServidor;
  const bastidor = previa ? previa.bastidor : bastidorServidor;
  const tem = (produto: string) => (previa ? previa.produtos.has(produto) : temServidor(produto));
  const nexusLigado = useNexusPortal();

  useEffect(() => { setOpen(false); }, [pathname]);

  // Abre sozinho quando a tela atual é um dos três documentos que moram lá dentro.
  const rotaEmOutros = pathname === '/documentos' && !!currentTipo && OUTROS_TIPOS.includes(currentTipo);
  const mostraOutros = rotaEmOutros ? fechadoNaRota !== currentTipo : outrosAberto;

  function alternarOutros() {
    const abrir = !mostraOutros;
    setOutrosAberto(abrir);
    setFechadoNaRota(abrir ? null : currentTipo);
    try { window.localStorage.setItem(CHAVE_OUTROS, abrir ? '1' : '0'); } catch { /* sem armazenamento */ }
    if (abrir) logMenu('outros_documentos', 'menu');
  }

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

  // SEU / NÃO É SEU. Quem entra na lista e quem entra em "Para liberar" é decidido em
  // organizarMenu (./itensMenu.ts), a mesma função da /inicio: sem pulo na carga (item de
  // produto não aparece em lugar nenhum até o servidor responder), fora do lançamento restrito
  // o que é novo não aparece, e admin vê tudo direto. Kit Off-Grid e Inventário ficam SEMPRE
  // em "Para liberar": link normal para quem tem o produto, cadeado para quem não tem.
  const { principal, paraLiberar, mostrarLoja } = organizarMenu({
    bastidor, carregando: acessosCarregando, isAdmin, tem,
  });

  function ativo(item: NavItem): boolean {
    // Casa pathname E o ?tipo= (os itens de documento têm o mesmo /documentos e
    // diferem só pela query, então comparar só pathname nunca acendia nenhum).
    const [itemPath, itemQuery] = item.href.split('?');
    const itemTipo = itemQuery ? new URLSearchParams(itemQuery).get('tipo') : null;
    return pathname === itemPath && (itemTipo ? currentTipo === itemTipo : !currentTipo);
  }

  /** Os dois botões do topo. Sem empresa: cinza, sem link, com a dica. */
  function renderAcao(item: NavItem, principalBtn: boolean) {
    const base = principalBtn ? styles.acaoPrincipal : styles.acaoSecundaria;
    if (!isAdmin && !hasCompany && item.requireCompany) {
      return (
        <div key={item.href} className={`${base} ${styles.acaoDesligada}`} aria-disabled="true"
             title="Cadastre o CNPJ da sua empresa primeiro">
          <item.icon size={18} strokeWidth={principalBtn ? 2 : 1.75} aria-hidden="true" />
          <span>{item.label}</span>
        </div>
      );
    }
    return (
      <Link key={item.href} href={item.href} aria-current={ativo(item) ? 'page' : undefined}
            className={`${base} ${ativo(item) ? styles.acaoAtiva : ''}`}>
        <item.icon size={18} strokeWidth={principalBtn ? 2 : 1.75} aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    );
  }

  function renderItem(item: NavItem) {
    const active = ativo(item);
    const lockedByCompany = !isAdmin && !hasCompany && !!item.requireCompany;
    const lockedByVip = !!item.vipOnly && !isVip && !isAdmin;
    const lockedByFree = !!item.paidOnly && isFree && !isAdmin;
    const lockedByPlan = lockedByVip || lockedByFree;
    // Produto não comprado: cadeado que LEVA A ALGUM LUGAR (a mini LP). Enquanto
    // a resposta do servidor não chega, o item fica normal.
    const prod = item.produto ? produtoPorId(item.produto) : null;
    // Fora do bastidor, ferramenta que já era grátis segue SEM cadeado: pra base
    // a novidade ainda não existe.
    const lockedByProduto = !!prod && bastidor && !acessosCarregando && !isAdmin && !tem(item.produto!);
    const clique = item.evento ? () => logMenu(item.evento!, 'gaveta') : undefined;

    // Bloqueado por falta de empresa → cinza, sem badge
    if (lockedByCompany) {
      return (
        <div key={item.href} className={styles.navItemLocked} title="Cadastre o CNPJ da sua empresa primeiro">
          <item.icon className={styles.navIcon} size={18} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
        </div>
      );
    }

    // Produto não comprado → vai pra mini LP, com cadeado à direita.
    if (lockedByProduto && prod) {
      return (
        // O cadeado leva pra pagina de venda do produto. Quem decide se e' o
        // /lp/<slug> ou o /produtos/<slug>, e por que, e' hrefVendaDoProduto
        // (./itensMenu.ts): a /inicio usa a mesma regra.
        <Link key={item.href} href={hrefVendaDoProduto(prod)}
              className={styles.navItemLocked} title={`${prod.nome}: ver o que tem dentro`}>
          <item.icon className={styles.navIcon} size={18} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
          <Lock className={styles.lockRight} size={13} strokeWidth={1.75} aria-label="Bloqueado" />
        </Link>
      );
    }

    // Bloqueado por plano → clique abre o modal contextual (sem badge no menu)
    if (lockedByPlan) {
      const title = lockedByVip ? 'Disponível para assinantes' : 'Assine para liberar';
      return (
        <button key={item.href} className={styles.navItemLocked} onClick={onUpgradeClick} title={title}>
          <item.icon className={styles.navIcon} size={18} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
        </button>
      );
    }

    const badge = item.count != null ? (
      <span className={styles.countBadge}>{item.count}</span>
    ) : item.badge ? (
      <span className={styles.badgeNovo}>{item.badge}</span>
    ) : null;

    if (item.paginaInteira) {
      return (
        <a key={item.href} href={item.href} className={styles.navItem} onClick={clique}>
          <item.icon className={styles.navIcon} size={18} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
          {badge}
        </a>
      );
    }

    if (item.external) {
      return (
        <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"
           className={styles.navItem} onClick={clique}>
          <item.icon className={styles.navIcon} size={18} strokeWidth={1.75} />
          <span className={styles.navLabel}>{item.label}</span>
          {badge}
          <span className={styles.externalIcon}>↗</span>
        </a>
      );
    }

    return (
      <Link key={item.href} href={item.href} onClick={clique}
            aria-current={active ? 'page' : undefined}
            className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}>
        <item.icon className={styles.navIcon} size={18} strokeWidth={1.75} />
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

      <nav className={styles.nav} aria-label="Menu principal">
        {/* ── Área Restrita (admin only) ── */}
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

        {/* ── Bloco de ação: o que mais se faz, a um clique ── */}
        <div className={styles.acoes}>
          {renderAcao(novaPropostaItem, true)}
          {renderAcao(lerContaItem, false)}
        </div>

        {/* ── Lista principal, sem título ── */}
        <div className={`${styles.navSection} ${styles.listaPrincipal}`}>
          {principal.map(renderItem)}
          {nexusLigado && renderItem(nexusItem)}
        </div>

        {/* ── Papelada: contratos e recibos; o resto fica dobrado ── */}
        <div className={styles.navDivider}>
          <span className={styles.navDividerLabel}>Papelada</span>
        </div>
        <div className={styles.navSection}>
          {papeladaItems.map(renderItem)}
          <button
            type="button"
            className={styles.outrosBtn}
            aria-expanded={mostraOutros}
            aria-controls="sd-menu-outros"
            onClick={alternarOutros}
          >
            {/* Mesma caixa de 18 px dos ícones dos outros itens, para a seta alinhar com eles. */}
            <span className={styles.iconeBox} aria-hidden="true">
              <ChevronRight className={`${styles.outrosSeta} ${mostraOutros ? styles.outrosSetaAberta : ''}`} size={16} strokeWidth={1.75} />
            </span>
            <span className={styles.navLabel}>Outros documentos</span>
          </button>
          {/* Sempre no DOM (o aria-controls aponta para ele); fechado, fica hidden. */}
          <div id="sd-menu-outros" className={styles.subLista} hidden={!mostraOutros}>
            {outrosDocsItems.map(renderItem)}
          </div>
        </div>

        {/* ── Para liberar: Kit Off-Grid e Inventário ficam SEMPRE aqui (link normal para quem
            tem o produto ou é admin, cadeado para quem não tem), depois os outros travados. O
            título aparece sempre que o grupo tem algum item; "Ver todos os produtos" só quando
            falta algum produto (algum item do grupo está travado). ── */}
        {paraLiberar.length > 0 && (
          <>
            <div className={styles.navDivider}>
              <span className={styles.navDividerLabel}>Para liberar</span>
            </div>
            <div className={styles.navSection}>
              {paraLiberar.map(renderItem)}
              {mostrarLoja && renderItem(lojaItem)}
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
            some (display:none), então o botão precisa existir AQUI, visível só
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
            controles deste header: a logo continua com os mesmos 28px. */}
        {(isVip || isAdmin) ? (
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', padding: '10px 12px' }}>
            <Logo className={styles.mobileLogoImg} />
          </Link>
        ) : (
          <button onClick={onUpgradeClick} style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: '10px 12px', cursor: 'pointer' }} title="Disponível para assinantes">
            <Logo className={styles.mobileLogoImg} />
          </button>
        )}
        {/* Voltar pra tela de atalho (launcher), só faz sentido com empresa pronta.
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
