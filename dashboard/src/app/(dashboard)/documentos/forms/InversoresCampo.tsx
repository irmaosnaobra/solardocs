'use client';

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import docStyles from '../documentos.module.css';
import styles from './InversoresCampo.module.css';

/** Uma linha de inversor, tudo como a pessoa digitou (pt-BR, "1,875"). */
export interface InversorLinha {
  qtd: string;
  marca: string;
  potencia: string;
  garantia: string;
}

interface Props {
  linhas: InversorLinha[];
  onChange: (linhas: InversorLinha[]) => void;
  marcas: string[];
  onNovaMarca: (nome: string) => void;
  kwpModulos: number;
}

const ATALHOS_KW = [3, 5, 6, 8, 10, 12, 15, 20, 30, 50];

function num(s: string): number {
  const v = parseFloat(String(s ?? '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
}

function fmt(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

/** Quantidade vazia ou não numérica conta 1, igual ao PDF (o backend faz parseInt(...) || 1). */
function qtdDe(l: InversorLinha): number {
  return parseInt(l.qtd, 10) || 1;
}

interface Opcao { tipo: 'add' | 'marca'; nome: string }

function MarcaCombobox({ id, value, onChange, marcas, onNovaMarca }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  marcas: string[];
  onNovaMarca: (nome: string) => void;
}) {
  const listId = useId();
  const raizRef = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);

  const q = value.trim().toLowerCase();
  const filtradas = marcas.filter(m => !q || m.toLowerCase().includes(q));
  const exata = marcas.some(m => m.toLowerCase() === q);
  const opcoes: Opcao[] = [
    ...(q.length > 0 && !exata ? [{ tipo: 'add' as const, nome: value.trim() }] : []),
    ...filtradas.map(nome => ({ tipo: 'marca' as const, nome })),
  ];
  const ativoOk = ativo < opcoes.length ? ativo : -1;
  const optId = (i: number) => `${listId}-opt-${i}`;

  // Clique fora fecha.
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent | TouchEvent) {
      if (raizRef.current && !raizRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', fora);
    document.addEventListener('touchstart', fora);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('touchstart', fora);
    };
  }, [aberto]);

  // Mantém a opção ativa à vista quando a lista rola.
  useEffect(() => {
    if (!aberto || ativoOk < 0) return;
    document.getElementById(optId(ativoOk))?.scrollIntoView({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, ativoOk]);

  function escolher(o: Opcao) {
    if (o.tipo === 'add') onNovaMarca(o.nome);
    onChange(o.nome);
    setAberto(false);
    setAtivo(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!aberto) { setAberto(true); setAtivo(opcoes.length ? 0 : -1); return; }
      if (opcoes.length) setAtivo(ativoOk < 0 ? 0 : (ativoOk + 1) % opcoes.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) { setAberto(true); setAtivo(opcoes.length ? opcoes.length - 1 : -1); return; }
      if (opcoes.length) setAtivo(ativoOk <= 0 ? opcoes.length - 1 : ativoOk - 1);
    } else if (e.key === 'Enter') {
      // Com a lista aberta e uma opção ativa, Enter escolhe e não envia o formulário.
      if (aberto && ativoOk >= 0 && opcoes[ativoOk]) {
        e.preventDefault();
        escolher(opcoes[ativoOk]);
      }
    } else if (e.key === 'Escape') {
      if (aberto) { e.preventDefault(); setAberto(false); setAtivo(-1); }
    } else if (e.key === 'Tab') {
      setAberto(false);
    }
  }

  return (
    <div ref={raizRef} style={{ display: 'contents' }}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={aberto}
        aria-controls={aberto ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={aberto && ativoOk >= 0 ? optId(ativoOk) : undefined}
        autoComplete="off"
        value={value}
        onChange={e => { onChange(e.target.value); setAberto(true); setAtivo(-1); }}
        onFocus={() => setAberto(true)}
        onKeyDown={onKeyDown}
        placeholder="Ex: Growatt"
        className="input-field"
        required
      />
      {aberto && (
        <div className={styles.dropdown}>
          <ul id={listId} role="listbox" aria-label="Suas marcas" className={styles.lista}>
            {opcoes.map((o, i) => {
              const classes = [
                styles.opcao,
                o.tipo === 'add' ? styles.opcaoAdd : '',
                i === ativoOk ? styles.opcaoAtiva : '',
              ].filter(Boolean).join(' ');
              const cabecalhoAntes = o.tipo === 'marca' && (i === 0 || opcoes[i - 1].tipo === 'add');
              return (
                <Fragment key={`${o.tipo}-${o.nome}`}>
                {cabecalhoAntes && <li role="presentation" className={styles.listaTitulo}>Suas marcas</li>}
                <li
                  id={optId(i)}
                  role="option"
                  aria-selected={i === ativoOk}
                  className={classes}
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setAtivo(i)}
                  onClick={() => escolher(o)}
                >
                  {o.tipo === 'add' && (
                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                  )}
                  {o.tipo === 'add' ? `Adicionar “${o.nome}” às suas marcas` : o.nome}
                </li>
                </Fragment>
              );
            })}
          </ul>
          {filtradas.length === 0 && q.length > 0 && <p className={styles.vazio}>Nenhuma marca sua com esse nome.</p>}
          <p className={styles.rodape}>Aparecem aqui as marcas das suas propostas e as que você adicionar.</p>
        </div>
      )}
    </div>
  );
}

export default function InversoresCampo({ linhas, onChange, marcas, onNovaMarca, kwpModulos }: Props) {
  const uid = useId();
  // Muda a cada remoção: remonta as linhas e o combobox aberto não passa para a linha de baixo.
  const [rodada, setRodada] = useState(0);

  function setLinha(i: number, parcial: Partial<InversorLinha>) {
    onChange(linhas.map((l, j) => (j === i ? { ...l, ...parcial } : l)));
  }

  function remover(i: number) {
    setRodada(r => r + 1);
    onChange(linhas.filter((_, j) => j !== i));
  }

  function adicionar() {
    onChange([...linhas, { qtd: '1', marca: '', potencia: '', garantia: linhas[0]?.garantia || '5' }]);
  }

  const totalKw = linhas.reduce((a, l) => a + qtdDe(l) * num(l.potencia), 0);

  return (
    <div className={styles.raiz}>
      <div className={styles.cabecalho}>
        <h3 className={styles.titulo}>Inversores</h3>
        <p className={styles.ajuda}>Uma linha para cada marca ou potência diferente.</p>
      </div>

      {linhas.map((l, i) => {
        const n = i + 1;
        const kw = num(l.potencia);
        const resumo = l.marca.trim() !== '' && kw > 0
          ? `${qtdDe(l)}× ${l.marca.trim()} ${fmt(kw)} kW`
          : 'Preencha marca e potência';
        const idQ = `${uid}-qtd-${i}`;
        const idM = `${uid}-marca-${i}`;
        const idK = `${uid}-kw-${i}`;
        return (
          <div key={`${rodada}-${i}`} className={styles.cartao}>
            <div className={styles.cartaoTopo}>
              <div className={styles.cartaoTitulo}>
                <strong className={styles.cartaoNome}>Inversor {n}</strong>
                <span className={styles.resumo}>{resumo}</span>
              </div>
              {linhas.length > 1 && (
                <button type="button" className={styles.remover} aria-label={`Remover inversor ${n}`} onClick={() => remover(i)}>
                  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                  Remover
                </button>
              )}
            </div>

            <div className={styles.grade}>
              <div className={`${styles.campo} ${styles.areaQtd}`}>
                <label htmlFor={idQ} className={docStyles.label}>Qtd</label>
                <input id={idQ} type="text" inputMode="numeric" value={l.qtd} onChange={e => setLinha(i, { qtd: e.target.value })} placeholder="Ex: 2" className="input-field" />
              </div>
              <div className={`${styles.campo} ${styles.areaMarca}`}>
                <label htmlFor={idM} className={docStyles.label}>Marca *</label>
                <MarcaCombobox id={idM} value={l.marca} onChange={v => setLinha(i, { marca: v })} marcas={marcas} onNovaMarca={onNovaMarca} />
              </div>
              <div className={`${styles.campo} ${styles.areaPot}`}>
                <label htmlFor={idK} className={docStyles.label}>Potência (kW) *</label>
                <input id={idK} type="text" inputMode="decimal" value={l.potencia} onChange={e => setLinha(i, { potencia: e.target.value })} placeholder="Ex: 1,875 ou 5" className="input-field" required />
              </div>
            </div>

            <div className={styles.atalhos}>
              <span className={styles.atalhosRotulo}>Atalhos (kW)</span>
              {ATALHOS_KW.map(k => {
                const ligado = kw === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={ligado}
                    className={`${styles.atalho} ${ligado ? styles.atalhoOn : ''}`}
                    onClick={() => setLinha(i, { potencia: String(k) })}
                  >
                    {fmt(k)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <button type="button" className={styles.adicionar} onClick={adicionar}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
        Adicionar outro inversor
      </button>

      <div className={styles.total}>
        <div className={styles.totalLinha}>
          <span className={styles.totalRotulo}>Potência total dos inversores (qtd × kW)</span>
          <strong className={styles.totalValor}>{totalKw > 0 ? `${fmt(totalKw)} kW` : 'Preencha os inversores'}</strong>
        </div>
        <div className={styles.totalLinha}>
          <span className={styles.totalRotulo}>Módulos (calculado acima)</span>
          <span className={styles.totalModulos}>{kwpModulos > 0 ? `${kwpModulos.toFixed(2).replace('.', ',')} kWp` : 'Preencha os módulos'}</span>
        </div>
      </div>
    </div>
  );
}
