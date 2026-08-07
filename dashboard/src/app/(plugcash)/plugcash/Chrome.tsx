'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid, GraduationCap, Wrench, UserRound, Settings2, LogOut, ExternalLink, Library,
} from 'lucide-react';
import { removeToken } from '@/services/auth';
import { FaixaPreview } from './Marca';
import styles from './pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// CHROME DA APLICAÇÃO — o mesmo esqueleto do solardoc.app.
//
// A primeira versão destas telas era uma coluna centralizada de 1080px com um
// cabeçalho simples. Ao lado do SolarDoc — topbar escura fixa, sidebar de 240px,
// canvas de 1520px — aquilo parecia um site institucional, não um produto. Os
// dois vivem no MESMO login: trocar de esqueleto no meio do caminho faz o
// usuário achar que entrou em outro sistema.
//
// O que muda entre os dois é a marca, não a estrutura: chrome escuro idêntico
// (#1B2129), acento verde no lugar do laranja.
//
// Só as telas LOGADAS usam isto. Página de venda continua sem sidebar — vitrine
// com menu lateral é erro de gênero, e o documento de marca manda hero e página
// de venda em fundo preto, sem chrome.
// ─────────────────────────────────────────────────────────────────────────────

type ItemNav = {
  href: string;
  label: string;
  icone: typeof LayoutGrid;
  /** true = casa só o caminho exato (senão /app marcaria em /app/servicos) */
  exato?: boolean;
};

const NAV: Array<{ secao?: string; itens: ItemNav[] }> = [
  {
    itens: [
      { href: '/plugcash/app', label: 'Meu painel', icone: LayoutGrid, exato: true },
      { href: '/plugcash/app/catalogo', label: 'A trilha', icone: Library },
      { href: '/plugcash/app/servicos', label: 'Serviços', icone: Wrench },
      { href: '/plugcash/app/conta', label: 'Minha conta', icone: UserRound },
    ],
  },
];

const NAV_ADMIN: Array<{ secao?: string; itens: ItemNav[] }> = [
  { secao: 'Interno', itens: [{ href: '/plugcash/admin', label: 'Administração', icone: Settings2 }] },
];

export function Chrome({
  children, titulo, subtitulo, acoes, nivel, preview, admin,
}: {
  children: React.ReactNode;
  titulo: string;
  subtitulo?: string;
  acoes?: React.ReactNode;
  nivel?: string;
  preview?: boolean;
  /** mostra a seção interna no menu; quem não é admin não vê o item */
  admin?: boolean;
}) {
  const pathname = usePathname();
  const q = preview ? '?preview=1' : '';

  const ativo = (item: ItemNav) =>
    item.exato ? pathname === item.href : pathname.startsWith(item.href);

  const grupos = admin ? [...NAV, ...NAV_ADMIN] : NAV;

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.topbarMarca}>
          <Link href={`/plugcash/app${q}`} className={styles.logo} aria-label="PlugCash">
            <svg className={styles.logoMark} viewBox="0 0 80 80" aria-hidden="true"
                 style={{ width: 26, height: 26 }}>
              <rect width="80" height="80" rx="21" fill="#00C853" />
              <rect x="38.5" y="11" width="3.6" height="58" rx="1.8" fill="#FFF" />
              <path d="M45 19 L27 51 L39 51 L36 69 L55 39 L42 39 Z" fill="#FFF" />
            </svg>
            <span style={{ fontSize: 19 }}>
              <span style={{ color: '#fff' }}>Plug</span>
              <span className={styles.logoCash}>Cash</span>
            </span>
          </Link>
        </div>

        <div className={styles.topbarSpacer} />

        <div className={styles.topbarAcoes}>
          {nivel && <span className={styles.chip}>{nivel}</span>}
          {/* O PlugCash e o SolarDoc são a mesma conta. Quem trabalha nos dois
              precisa atravessar sem passar por login de novo. */}
          <Link href="/inicio" className={styles.iconBtn} title="Ir para o SolarDoc">
            SolarDoc <ExternalLink size={13} strokeWidth={2} style={{ marginLeft: 5 }} />
          </Link>
          <button
            className={styles.iconBtn}
            onClick={() => { removeToken(); window.location.href = '/plugcash/entrar'; }}
            title="Sair"
          >
            <LogOut size={16} strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <aside className={styles.sidebar}>
        {grupos.map((g, gi) => (
          <div key={gi}>
            {g.secao && <div className={styles.navSecao}>{g.secao}</div>}
            {g.itens.map((item) => {
              const Icone = item.icone;
              return (
                <Link
                  key={item.href}
                  href={`${item.href}${q}`}
                  className={`${styles.navItem} ${ativo(item) ? styles.navItemAtivo : ''}`}
                >
                  <span className={styles.navIcone}><Icone size={17} strokeWidth={1.8} /></span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}

        <div className={styles.navRodape}>
          <GraduationCap size={15} strokeWidth={1.8} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Irmãos na Obra<br />Mobilidade Elétrica
        </div>
      </aside>

      {/* Navegação do celular. A sidebar some abaixo de 900px e até aqui nada
          entrava no lugar — dava pra abrir uma aula e não ter como voltar. */}
      <nav className={styles.tabbar} aria-label="Navegação">
        {NAV[0].itens.map((item) => {
          const Icone = item.icone;
          return (
            <Link
              key={item.href}
              href={`${item.href}${q}`}
              className={`${styles.tabItem} ${ativo(item) ? styles.tabItemAtivo : ''}`}
              aria-current={ativo(item) ? 'page' : undefined}
            >
              <Icone size={19} strokeWidth={1.9} />
              <span>{item.label.replace('Minha ', '').replace('Meu ', '')}</span>
            </Link>
          );
        })}
      </nav>

      <main className={styles.appMain}>
        {preview && <FaixaPreview />}
        <div className={styles.appContent}>
          <div className={styles.pageTopo}>
            <div>
              <h1 className={styles.pageTitulo}>{titulo}</h1>
              {subtitulo && <p className={styles.pageSub}>{subtitulo}</p>}
            </div>
            {acoes && <div className={styles.topoAcoes}>{acoes}</div>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
