'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Settings, Zap, Lock, Plus, ScanLine, ChevronRight,
  Building2, Users, User, Banknote, ScrollText, FileSignature, Receipt,
  Wrench, Briefcase, ClipboardCheck, Sparkles, BarChart3, Calculator,
  Boxes, GraduationCap, Smartphone, PlugZap,
  Send, LogOut, TrendingUp, LayoutGrid, Tags, FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { removeToken } from '@/services/auth';
import { useAcessos } from '@/hooks/useAcessos';
import { useNexusPortal } from '@/hooks/useNexusPortal';
import { produtoPorId } from '@/lib/produtos';
import { logMenu, type EventoMenu } from '@/utils/logMenu';
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
// Ordem decidida em 29/10/2026 pelo uso medido em 30 dias: proposta 866 documentos;
// Escanear conta 583 usos de 20 pessoas; Clientes 159 cadastros de 33 pessoas;
// Contrato 51 de 16; Procuração 36 de 10; Recibo 28 de 6; Proposta de Banco 5 de 1;
// Prestação de Serviço e Contrato Vendedor 8 em 90 dias; Terceiros 0 cadastros.
// Por isso: proposta e conta de luz viram botões no topo, o que se usa todo dia vem
// logo abaixo, e o que quase ninguém usa fica dobrado em "Outros documentos".

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

// Os dois botões do topo. Sem empresa ficam cinza e sem link (o gerador exige CNPJ).
// A conta de luz segue a mesma regra: a tela dela não checa empresa, mas o painel
// manda quem não tem CNPJ para /empresa, e ela cria cliente, que também exige empresa.
const novaPropostaItem: NavItem = { href: '/documentos?tipo=proposta', icon: Plus, label: 'Nova proposta', requireCompany: true };
const lerContaItem: NavItem = { href: '/escanear-conta', icon: ScanLine, label: 'Ler conta de luz', requireCompany: true };

// Lista principal, sem título, na ordem do uso. Item com `produto` travado sai daqui e
// vai para "Para liberar" (ver `paraLiberar` no render).
const principalItems: NavItem[] = [
  { href: '/clientes',     icon: Users,           label: 'Clientes',         requireCompany: true },
  // Todo documento gerado fica na nuvem para qualquer plano: sem cadeado e sem exigir empresa.
  { href: '/historico',    icon: FolderOpen,      label: 'Arquivos' },
  { href: '/vistoria',     icon: ClipboardCheck,  label: 'Vistoria' },
  { href: '/precificacao', icon: Calculator,      label: 'Precificação',     produto: 'precificacao' },
  // Off-grid NÃO leva `produto`: a tela é aberta de propósito (dimensionar e ver
  // a autonomia é grátis) e o cadeado dela cai só sobre o preço, lá dentro.
  { href: '/off-grid',     icon: PlugZap,         label: 'Kit Off-Grid' },
  { href: '/inventario',   icon: Boxes,           label: 'Inventário',       produto: 'inventario' },
  { href: '/manutencao',   icon: Wrench,          label: 'Manutenção' },
  { href: '/cursos/kit-fechamento', icon: GraduationCap, label: 'Kit Fecha Vendas', produto: 'curso-fechamento' },
  { href: '/lp/limpapro',           icon: Sparkles,      label: 'LimpaPro',         produto: 'curso-limpapro' },
];

// A loja fecha o grupo "Para liberar": é "ver todos os que faltam", não uma ferramenta.
const lojaItem: NavItem = { href: '/produtos', icon: LayoutGrid, label: 'Ver todos os produtos' };

// Portal do Parceiro NEXUS: página estática em /nexus/app, fora do Next. Só entra
// no menu quando o portal responde ligado (ver useNexusPortal).
const nexusItem: NavItem = {
  href: '/nexus/app?o=solardoc', icon: Zap, label: 'Parceiro NEXUS', badge: 'Novo', paginaInteira: true,
};

// Papelada: telas navegáveis pra free, MAS o backend só deixa o free GERAR propostaSolar
// (os outros tipos retornam 402 "faça upgrade"). O gate é no generate, não na navegação.
const papeladaItems: NavItem[] = [
  { href: '/documentos?tipo=contrato-solar', icon: FileSignature, label: 'Contrato Solar', requireCompany: true },
  { href: '/documentos?tipo=procuracao',     icon: ScrollText,    label: 'Procuração',     requireCompany: true },
  { href: '/documentos?tipo=recibo',         icon: Receipt,       label: 'Recibo',         requireCompany: true },
];

// Dobrados em "Outros documentos": 5 de 1 pessoa, e 8 em 90 dias.
const outrosDocsItems: NavItem[] = [
  { href: '/documentos?tipo=proposta-bancaria', icon: Banknote,  label: 'Proposta de Banco',    requireCompany: true },
  { href: '/documentos?tipo=prestacao-servico', icon: Wrench,    label: 'Prestação de Serviço', requireCompany: true },
  { href: '/documentos?tipo=contrato-pj',       icon: Briefcase, label: 'Contrato Vendedor',    requireCompany: true },
];
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

  /**
   * SEU / NÃO É SEU. `travado` responde se o item está atrás de cadeado de PRODUTO.
   * Enquanto a resposta do servidor não chega, nada é considerado travado: piscar
   * cadeado na cara de quem pagou vira chamado no suporte na hora.
   */
  const travado = (item: NavItem) =>
    !!item.produto && bastidor && !acessosCarregando && !isAdmin && !tem(item.produto);

  // Fora do lançamento restrito, o que é novo não aparece de jeito nenhum.
  const visiveis = principalItems.filter((i) =>
    bastidor || (i.href !== '/off-grid' && i.href !== '/lp/limpapro'));
  // Sem pulo na carga: enquanto o servidor não respondeu, item de produto não aparece
  // em lugar nenhum (nem na lista, nem em "Para liberar"). Admin vê tudo direto.
  const aguardandoAcessos = acessosCarregando && !isAdmin;
  const principal = visiveis.filter((i) => !i.produto || (!aguardandoAcessos && !travado(i)));
  const paraLiberar = visiveis.filter(travado);

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
        // O cadeado leva pra LP PUBLICA (/lp/<slug>), nao pra versao de dentro
        // do app. E' uma pagina de venda so': a mesma que o anuncio abre, a
        // mesma que o cliente ve. Duas portas pro mesmo produto davam duas
        // ofertas pra manter em dia.
        //
        // EXCECAO: produto com pagina propria (Kit, LimpaPro). La' o /lp/
        // redireciona pra fora, e sair do app perde o `?email=` que o
        // `checkoutCom` gruda no checkout. Sem ele, quem digita outro e-mail na
        // Kiwify vira usuario novo: paga, libera numa conta e entra na outra.
        // Quem esta' logado fica dentro, no /produtos/<slug>, que e' o MESMO
        // componente de pagina de venda, nada diverge.
        <Link key={item.href} href={prod.lpPropria ? `/produtos/${prod.slug}` : `/lp/${prod.slug}`}
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

        {/* ── Para liberar: só o que a pessoa AINDA NÃO tem. Sem item travado o grupo
            some; admin nunca trava; quem está fora do lançamento não vê nada. ── */}
        {paraLiberar.length > 0 && (
          <>
            <div className={styles.navDivider}>
              <span className={styles.navDividerLabel}>Para liberar</span>
            </div>
            <div className={styles.navSection}>
              {paraLiberar.map(renderItem)}
              {renderItem(lojaItem)}
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
