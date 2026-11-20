'use client';

// Funil compacto do painel Monjour: cinco passos em lista, cada um com o número,
// a taxa sobre o passo anterior e uma barra fina; no fim, a taxa de ponta a ponta.
// Serve ao quiz e à página de venda, os dois no mesmo formato. O que abre e fecha
// (as telas do quiz, o mapa da página) entra como `children`, no pé do cartão.
import { ChevronDown } from 'lucide-react';
import s from './MonjourFunilPanel.module.css';
import { Titulo, fmtInt, fmtPct } from './monjourComum';

export type Passo = { chave: string; rotulo: string; valor: number; compra?: boolean };

/** Taxa de n sobre d. Denominador zero (ou ausente) vira "–". */
export const taxa = (n: number, d: number) => (d > 0 ? fmtPct(n, d, 1) : '–');
/** Número vindo da api: só vale se for finito. */
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function BotaoAbrir({ aberto, aoAlternar, controla, fechado, abertoTxt }: {
  aberto: boolean; aoAlternar: () => void; controla: string; fechado: string; abertoTxt: string;
}) {
  return (
    <button type="button" className={s.abrir} aria-expanded={aberto} aria-controls={controla} onClick={aoAlternar}>
      <span>{aberto ? abertoTxt : fechado}</span>
      <ChevronDown size={18} aria-hidden="true" className={aberto ? `${s.abrirSeta} ${s.abrirSetaCima}` : s.abrirSeta} />
    </button>
  );
}

export default function FunilCompacto({ id, titulo, dica, passos, totalRotulo, className, children }: {
  id: string; titulo: string; dica: React.ReactNode; passos: Passo[]; totalRotulo: string; className?: string; children?: React.ReactNode;
}) {
  const primeiro = passos[0]?.valor ?? 0;
  const ultimo = passos[passos.length - 1]?.valor ?? 0;
  const temDados = passos.some((p) => p.valor > 0);
  // A barra mede cada passo contra o maior valor da lista: o funil mostra o formato mesmo se um passo passar do anterior.
  const topo = Math.max(1, ...passos.map((p) => p.valor));

  return (
    <section className={`${s.bloco} ${className ?? ''}`} aria-labelledby={id}>
      <div className={s.blocoTopo}>
        <span id={id}><Titulo dica={dica}>{titulo}</Titulo></span>
      </div>

      {temDados ? (
        <>
          <div className={`${s.cfLinha} ${s.cfCab}`} aria-hidden="true">
            <span>Passo</span><span>Pessoas</span><span>Do anterior</span>
          </div>
          <ol className={s.cfLista}>
            {passos.map((p, i) => (
              <li key={p.chave} className={`${s.cfPasso} ${p.compra ? s.cfCompra : ''}`}>
                <div className={s.cfLinha}>
                  <span className={s.cfRotulo}>{p.rotulo}</span>
                  <span className={s.cfValor}>{fmtInt(p.valor)}</span>
                  <span className={s.cfTaxa}>
                    {i === 0 ? '' : taxa(p.valor, passos[i - 1].valor)}
                    {i > 0 && <span className={s.leitor}> do passo anterior</span>}
                  </span>
                </div>
                <div className={s.cfTrilho} aria-hidden="true">
                  <div className={s.cfBarra} style={{ width: `${p.valor > 0 ? Math.max(1.5, (p.valor / topo) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
          </ol>
          <div className={s.cfTotal}>
            <span className={s.cfTotalRotulo}>Taxa total<small>{totalRotulo}</small></span>
            <b className={s.cfTotalValor}>{taxa(ultimo, primeiro)}</b>
          </div>
        </>
      ) : (
        <p className={s.cfVazio}>Sem visitas neste período.</p>
      )}

      {children}
    </section>
  );
}
