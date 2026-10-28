'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Search, X, type LucideIcon } from 'lucide-react';
import s from './AreaTrabalho.module.css';
import { criarContadorFab } from './contadorFab';

// Peças da tela inicial de trabalho (Vistoria e Manutenção): cabeçalho em uma linha,
// faixa de indicadores que filtram, tabela com busca, agenda lateral e gaveta de criação.
// Só estrutura e tokens do app: a regra de cada tela fica na própria página.
// Uma cor forte só: o laranja fica no botão principal do cabeçalho; o resto é neutro.

/**
 * Esconde o botão flutuante do WhatsApp (global do layout) enquanto `ativo`, por contagem (ver contadorFab.ts).
 * Com `soCelular`, só abaixo de 720 px, onde ele cobre campo e botão.
 */
const contadorFab = criarContadorFab(() => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.sd-whats-fab')));

export function useEsconderWhatsFab(ativo: boolean, soCelular = false) {
  useEffect(() => {
    if (!ativo) return;
    const mq = window.matchMedia('(max-width: 719px)');
    let tenho = false;
    // Cada uso pede para esconder (+1) e devolve o pedido (-1); o botão só reaparece quando ninguém mais pede.
    const aplicar = () => {
      const quer = !soCelular || mq.matches;
      if (quer && !tenho) { contadorFab.mudar(1); tenho = true; }
      else if (!quer && tenho) { contadorFab.mudar(-1); tenho = false; }
    };
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => { mq.removeEventListener('change', aplicar); if (tenho) contadorFab.mudar(-1); };
  }, [ativo, soCelular]);
}

export function Pagina({ children }: { children: ReactNode }) {
  return <div className={s.pagina}>{children}</div>;
}

export function Cabecalho({
  titulo, apoio, botao,
}: {
  titulo: string;
  apoio: string;
  botao?: { texto: string; icone?: LucideIcon; onClick: () => void; desativado?: boolean };
}) {
  const Icone = botao?.icone;
  return (
    <header className={s.cab}>
      <div className={s.cabTxt}>
        <h1 className={s.titulo}>{titulo}</h1>
        <p className={s.apoio}>{apoio}</p>
      </div>
      {botao && (
        <button type="button" className={s.btnPrim} onClick={botao.onClick} disabled={botao.desativado}>
          {Icone && <Icone size={17} strokeWidth={2.4} aria-hidden="true" />} {botao.texto}
        </button>
      )}
    </header>
  );
}

export interface Indicador {
  id: string;
  rotulo: string;
  valor: number | string;
  alerta?: boolean;
}

/** Faixa única com divisórias finas. Cada número é um botão que filtra a tabela (tocar de novo limpa). */
export function Indicadores({
  itens, ativo, onEscolher,
}: {
  itens: Indicador[];
  ativo: string | null;
  onEscolher: (id: string | null) => void;
}) {
  return (
    <div className={s.kpis} style={{ ['--kpis' as string]: itens.length }}>
      {itens.map((i) => (
        <button
          key={i.id}
          type="button"
          className={`${s.kpi} ${ativo === i.id ? s.kpiOn : ''}`}
          aria-pressed={ativo === i.id}
          onClick={() => onEscolher(ativo === i.id ? null : i.id)}
        >
          <span className={`${s.kpiNum} ${i.alerta ? s.kpiAlerta : ''}`}>{i.valor}</span>
          <span className={s.kpiRot}>{i.rotulo}</span>
        </button>
      ))}
    </div>
  );
}

export type Tom = 'ok' | 'atencao' | 'erro' | 'neutro';

/** Texto com um ponto colorido pequeno. Sem borda, sem fundo, sem ícone. */
export function Etiqueta({ tom = 'neutro', children }: { tom?: Tom; children: ReactNode }) {
  return (
    <span className={s.tag}>
      <span className={`${s.dot} ${s['dot_' + tom]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export function Progresso({ feitos, total }: { feitos: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((feitos / total) * 100)) : 0;
  return (
    <span className={s.prog}>
      <span className={s.progBarra} aria-hidden="true"><span className={s.progFill} style={{ width: `${pct}%` }} /></span>
      <span className={s.progNum}>{feitos}/{total}</span>
    </span>
  );
}

export function DuasColunas({ principal, lateral }: { principal: ReactNode; lateral?: ReactNode }) {
  return (
    <div className={`${s.cols} ${lateral ? s.colsDuas : ''}`}>
      <div className={s.colPrincipal}>{principal}</div>
      {lateral && <aside className={s.colLateral}>{lateral}</aside>}
    </div>
  );
}

// ── Tabela com busca e filtro ───────────────────────────────────────────────

export type Filtro = 'todas' | 'andamento' | 'concluidas';
const FILTROS: { id: Filtro; texto: string }[] = [
  { id: 'todas', texto: 'Todas' },
  { id: 'andamento', texto: 'Em andamento' },
  { id: 'concluidas', texto: 'Concluídas' },
];

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export interface ColunaTabela<T> {
  titulo: string;
  render: (x: T) => ReactNode;
  /** Largura da coluna (a tabela é de layout fixo). Sem largura, a coluna fica com o que sobrar. */
  largura?: string;
}

export function PainelTabela<T>({
  itens, getId, colunas, textoBusca, situacao, onAbrir, rotuloAcao, mobile, carregando, vazio, placeholderBusca, erro,
  predicado, rotuloPredicado, onLimparPredicado,
}: {
  itens: T[];
  getId: (x: T) => string;
  colunas: ColunaTabela<T>[];
  textoBusca: (x: T) => string;
  situacao: (x: T) => 'andamento' | 'concluida';
  onAbrir: (x: T) => void;
  rotuloAcao: (x: T) => string;
  mobile: (x: T) => { titulo: ReactNode; detalhe: ReactNode; etiquetas: ReactNode };
  carregando?: boolean;
  vazio: ReactNode;
  placeholderBusca: string;
  erro?: ReactNode;
  /** Filtro vindo de um indicador clicado. */
  predicado?: ((x: T) => boolean) | null;
  rotuloPredicado?: string;
  onLimparPredicado?: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const idBusca = useId();

  const visiveis = useMemo(() => {
    const q = normalizar(busca);
    return itens.filter((x) => {
      if (filtro === 'andamento' && situacao(x) !== 'andamento') return false;
      if (filtro === 'concluidas' && situacao(x) !== 'concluida') return false;
      if (predicado && !predicado(x)) return false;
      return !q || normalizar(textoBusca(x)).includes(q);
    });
  }, [itens, busca, filtro, situacao, textoBusca, predicado]);

  const semItens = !carregando && !erro && itens.length === 0;

  return (
    <section className={s.painel}>
      <div className={s.ferr}>
        <div className={s.busca}>
          <Search size={16} aria-hidden="true" />
          <label htmlFor={idBusca} className={s.soLeitor}>{placeholderBusca}</label>
          <input id={idBusca} type="search" value={busca} placeholder={placeholderBusca} onChange={(e) => setBusca(e.target.value)} disabled={semItens} />
        </div>
        <div className={s.seg} role="group" aria-label="Filtrar por situação">
          {FILTROS.map((f) => (
            <button key={f.id} type="button" className={`${s.segBtn} ${filtro === f.id ? s.segOn : ''}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)} disabled={semItens}>
              {f.texto}
            </button>
          ))}
        </div>
      </div>

      {predicado && rotuloPredicado && (
        <div className={s.filtroAtivo}>
          <span>Mostrando: <strong>{rotuloPredicado}</strong></span>
          <button type="button" onClick={onLimparPredicado}>Limpar filtro</button>
        </div>
      )}

      {carregando && (
        <div className={s.esqueleto} role="status" aria-label="Carregando">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className={s.esqLinha}><span /><span /><span /></div>)}
        </div>
      )}

      {erro}

      {semItens && <div className={s.vazio}>{vazio}</div>}

      {!carregando && !erro && itens.length > 0 && visiveis.length === 0 && (
        <p className={s.semResultado}>Nenhum resultado para essa busca.</p>
      )}

      {!carregando && !erro && visiveis.length > 0 && (
        <>
          <div className={s.tabelaWrap}>
            <table className={s.tabela}>
              <thead>
                <tr>
                  {colunas.map((c) => <th key={c.titulo} scope="col" style={c.largura ? { width: c.largura } : undefined}>{c.titulo}</th>)}
                  <th scope="col" className={s.thAcao}><span className={s.soLeitor}>Ação</span></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((x) => (
                  <tr key={getId(x)} tabIndex={0} onClick={() => onAbrir(x)} onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(x); }}>
                    {colunas.map((c) => <td key={c.titulo}>{c.render(x)}</td>)}
                    <td className={s.tdAcao}><span className={s.acao}>{rotuloAcao(x)} <ChevronRight size={15} aria-hidden="true" /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className={s.cartoes}>
            {visiveis.map((x) => {
              const m = mobile(x);
              return (
                <li key={getId(x)}>
                  <button type="button" className={s.cartao} onClick={() => onAbrir(x)}>
                    <span className={s.cartaoTxt}>
                      <strong>{m.titulo}</strong>
                      <span className={s.cartaoDet}>{m.detalhe}</span>
                      <span className={s.cartaoTags}>{m.etiquetas}</span>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

export function EstadoVazio({
  icone: Icone, frase, botao, passos,
}: {
  icone: LucideIcon;
  frase: string;
  botao: { texto: string; icone?: LucideIcon; onClick: () => void };
  passos?: { titulo: string; texto: string }[];
}) {
  const IconeBotao = botao.icone;
  return (
    <>
      <span className={s.vazioIcone}><Icone size={22} aria-hidden="true" /></span>
      <p className={s.vazioFrase}>{frase}</p>
      <button type="button" className={s.btnPrim} onClick={botao.onClick}>
        {IconeBotao && <IconeBotao size={17} strokeWidth={2.4} aria-hidden="true" />} {botao.texto}
      </button>
      {passos && (
        <ol className={s.passos}>
          {passos.map((p, i) => (
            <li key={p.titulo} className={s.passo}>
              <span className={s.passoNum}>{i + 1}</span>
              <strong className={s.passoTit}>{p.titulo}</strong>
              <span className={s.passoTxt}>{p.texto}</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export function EstadoErroLista({ texto, onTentar }: { texto: string; onTentar: () => void }) {
  return (
    <div className={s.vazio} role="alert">
      <p className={s.vazioFrase}>{texto}</p>
      <button type="button" className={s.btnSec} onClick={onTentar}>Tentar de novo</button>
    </div>
  );
}

// ── Agenda lateral ──────────────────────────────────────────────────────────

export interface ItemAgenda {
  id: string;
  /** YYYY-MM-DD */
  data: string;
  titulo: string;
  etiqueta: string;
  tom: Tom;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function AgendaLateral({
  titulo, itens, vazio, onAbrir, carregando,
}: {
  titulo: string;
  itens: ItemAgenda[];
  vazio: string;
  onAbrir: (id: string) => void;
  carregando?: boolean;
}) {
  return (
    <section className={s.painel}>
      <h2 className={s.agendaTitulo}>{titulo}</h2>
      {carregando ? (
        <div className={s.esqueleto} role="status" aria-label="Carregando">
          {[0, 1, 2].map((i) => <div key={i} className={s.esqLinha}><span /><span /></div>)}
        </div>
      ) : itens.length === 0 ? (
        <p className={s.semResultado}>{vazio}</p>
      ) : (
        <ul className={s.agenda}>
          {itens.map((i) => {
            const [, m, d] = i.data.split('-');
            return (
              <li key={i.id}>
                <button type="button" className={s.agendaItem} onClick={() => onAbrir(i.id)}>
                  <span className={s.agendaData} aria-hidden="true"><b>{d}</b><span>{MESES[Number(m) - 1] ?? ''}</span></span>
                  <span className={s.agendaTxt}>
                    <strong>{i.titulo}</strong>
                    <Etiqueta tom={i.tom}>{i.etiqueta}</Etiqueta>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Gaveta: painel lateral no computador, folha de baixo no celular ───────────

export function Gaveta({
  aberta, titulo, onFechar, children,
}: {
  aberta: boolean;
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  const fecharRef = useRef(onFechar);
  useEffect(() => { fecharRef.current = onFechar; });
  // O botão flutuante do WhatsApp cobriria o "Iniciar vistoria" e os campos da gaveta.
  useEsconderWhatsFab(aberta);

  useEffect(() => {
    if (!aberta) return;
    const anterior = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const primeiro = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([type=file]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
      (primeiro ?? ref.current?.querySelector<HTMLElement>('button'))?.focus();
    }, 30);
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharRef.current(); };
    document.addEventListener('keydown', tecla);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', tecla);
      anterior?.focus?.();
    };
  }, [aberta]);

  if (!aberta) return null;
  return (
    <div className={s.fundo} onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className={s.gaveta} role="dialog" aria-modal="true" aria-labelledby={idTitulo} ref={ref}>
        <div className={s.gavetaTopo}>
          <h2 id={idTitulo} className={s.gavetaTitulo}>{titulo}</h2>
          <button type="button" className={s.fechar} onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className={s.gavetaCorpo}>{children}</div>
      </div>
    </div>
  );
}

export { s as estilos };
