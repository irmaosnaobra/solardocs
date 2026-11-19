'use client';

// Recortes (tabela ordenável, com gráfico de barras em dia e hora) e Respostas
// (distribuição por pergunta e a conversão de cada opção) do funil Monjour.
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import admin from '../../admin.module.css';
import s from './MonjourFunilPanel.module.css';
import { COR_BARRA, Titulo, conv, fmtInt, fmtPct, fmtUsd, useEstreito } from './monjourComum';
import type { FunilMonjour, Linha } from './hubMonjour.types';

// ── recortes ────────────────────────────────────────────────────────────────
type Recorte = keyof FunilMonjour['recortes'];
const RECORTES: { k: Recorte; label: string; coluna: string }[] = [
  { k: 'pais', label: 'País', coluna: 'País' }, { k: 'aparelho', label: 'Aparelho', coluna: 'Aparelho' },
  { k: 'sistema', label: 'Sistema', coluna: 'Sistema' }, { k: 'navegador', label: 'Navegador', coluna: 'Navegador' },
  { k: 'anuncio', label: 'Anúncio', coluna: 'Anúncio' }, { k: 'conjunto', label: 'Conjunto', coluna: 'Conjunto' },
  { k: 'dia', label: 'Dia', coluna: 'Dia' }, { k: 'hora', label: 'Hora', coluna: 'Hora' },
];
type Coluna = 'rotulo' | 'sessoes' | 'leads' | 'ofertas' | 'checkouts' | 'compras' | 'conversao' | 'receitaCentavos';
const COLUNAS: { k: Exclude<Coluna, 'rotulo'>; label: string }[] = [
  { k: 'sessoes', label: 'Visitantes' }, { k: 'leads', label: 'Leads' }, { k: 'ofertas', label: 'Oferta' },
  { k: 'checkouts', label: 'Clicaram' }, { k: 'compras', label: 'Compras' }, { k: 'conversao', label: 'Conversão' },
  { k: 'receitaCentavos', label: 'Receita' },
];

function Cab({ c, label, col, desc, trocar }: { c: Coluna; label: string; col: Coluna; desc: boolean; trocar: (c: Coluna) => void }) {
  return (
    <th aria-sort={col === c ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => trocar(c)}>
        {label}{col === c ? (desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
}

export function MonjourRecortes({ f }: { f: FunilMonjour }) {
  const [qual, setQual] = useState<Recorte>('pais');
  const [ordem, setOrdem] = useState<{ col: Coluna; desc: boolean } | null>(null);
  const estreito = useEstreito();
  const temporal = qual === 'dia' || qual === 'hora';
  const linhas = f.recortes[qual] ?? [];
  const col: Coluna = ordem?.col ?? (temporal ? 'rotulo' : 'sessoes');
  const desc = ordem ? ordem.desc : !temporal;
  const valor = (l: Linha, c: Coluna): number | string => {
    if (c === 'rotulo') return temporal ? l.chave : l.rotulo;
    if (c === 'conversao') return conv(l);
    return l[c];
  };
  const ordenadas = [...linhas].sort((a, b) => {
    const va = valor(a, col), vb = valor(b, col);
    const r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
    return desc ? -r : r;
  });
  const trocar = (c: Coluna) => setOrdem({ col: c, desc: c === col ? !desc : c !== 'rotulo' });
  const escolher = (k: Recorte) => { setQual(k); setOrdem(null); };
  const grafico = temporal ? [...linhas].sort((a, b) => a.chave.localeCompare(b.chave, 'pt-BR', { numeric: true })) : [];
  const nomeColuna = RECORTES.find((r) => r.k === qual)?.coluna ?? '';


  return (
    <section className={s.bloco} aria-labelledby="mj-recortes">
      <div className={s.blocoTopo}>
        <span id="mj-recortes">
          <Titulo dica="Os mesmos números do topo, quebrados por um corte. Cada pessoa conta no corte da primeira visita dela. Toque no nome da coluna para ordenar.">
            Recortes
          </Titulo>
        </span>
      </div>
      <div className={s.seletor} role="group" aria-label="Escolher o recorte">
        {RECORTES.map((r) => (
          <button key={r.k} type="button" aria-pressed={qual === r.k}
            className={qual === r.k ? admin.periodActive : admin.periodBtn} onClick={() => escolher(r.k)}>
            {r.label}
          </button>
        ))}
      </div>

      {temporal && grafico.length > 0 && (
        <div className={s.grafico}>
          <ResponsiveContainer width="100%" height={estreito ? 180 : 220}>
            <BarChart data={grafico} margin={{ top: 12, right: 4, left: estreito ? -18 : -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--color-border-strong)' }}
                interval={estreito && grafico.length > 8 ? 'preserveStartEnd' : 0} minTickGap={4} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false} width={40} />
              <Tooltip cursor={{ fill: 'var(--color-surface-2)' }} content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const l = payload[0].payload as Linha;
                return (
                  <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: 12, boxShadow: 'var(--sombra-card)' }}>
                    <div style={{ fontWeight: 800, marginBottom: 2 }}>{l.rotulo}</div>
                    <div>{fmtInt(l.sessoes)} visitantes · {fmtInt(l.leads)} leads</div>
                    <div>{fmtInt(l.compras)} {l.compras === 1 ? 'compra' : 'compras'} · {fmtUsd(l.receitaCentavos)}</div>
                  </div>
                );
              }} />
              <Bar dataKey="sessoes" name="Visitantes" fill={COR_BARRA} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className={s.tabelaRolagem} style={temporal ? undefined : { marginTop: 12 }}>
        <table className={s.tabela}>
          <thead>
            <tr>
              <Cab c="rotulo" label={nomeColuna} col={col} desc={desc} trocar={trocar} />
              {COLUNAS.map((c) => <Cab key={c.k} c={c.k} label={c.label} col={col} desc={desc} trocar={trocar} />)}
            </tr>
          </thead>
          <tbody>
            {ordenadas.length === 0 && (
              <tr><td colSpan={8} className={s.vazioCelula}>Nenhuma visita neste recorte.</td></tr>
            )}
            {ordenadas.map((l) => (
              <tr key={l.chave}>
                <td title={l.rotulo}>{l.rotulo}</td>
                <td>{fmtInt(l.sessoes)}</td>
                <td>{fmtInt(l.leads)}</td>
                <td>{fmtInt(l.ofertas)}</td>
                <td>{fmtInt(l.checkouts)}</td>
                <td style={l.compras ? { fontWeight: 800, color: 'var(--ink-green)' } : undefined}>{fmtInt(l.compras)}</td>
                <td>{fmtPct(l.compras, l.sessoes, 1)}</td>
                <td>{l.receitaCentavos ? fmtUsd(l.receitaCentavos) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── respostas ───────────────────────────────────────────────────────────────
export function MonjourRespostas({ f, escala }: { f: FunilMonjour; escala: number }) {
  const lista = f.respostas.filter((q) => q.opcoes.some((o) => o.sessoes > 0));
  if (lista.length === 0) return null;
  return (
    <section className={s.bloco} aria-labelledby="mj-respostas">
      <div className={s.blocoTopo}>
        <span id="mj-respostas">
          <Titulo dica="Quanto cada resposta pesa entre quem respondeu, e quantos de quem escolheu aquilo compraram. A melhor conversão de cada pergunta fica em verde. Respostas de saúde, peso e nome não são guardadas.">
            Respostas
          </Titulo>
        </span>
      </div>
      <div className={s.perguntas}>
        {lista.map((q) => {
          const maiorPct = Math.max(1e-9, ...q.opcoes.map((o) => o.pct));
          const melhor = q.opcoes.reduce<number>((m, o) => (o.compras > 0 ? Math.max(m, conv(o)) : m), 0);
          return (
            <div key={q.chave} className={s.pergunta}>
              <div className={s.perguntaTitulo}>{q.pergunta}</div>
              <div className={s.opcaoCab} aria-hidden="true"><span>Resposta</span><span>Escolheram</span><span>Conversão</span></div>
              {[...q.opcoes].sort((a, b) => b.sessoes - a.sessoes).map((o) => {
                const pctVal = o.pct * escala;
                const c = conv(o);
                return (
                  <div key={o.valor} className={s.opcao}
                    title={`${o.rotulo}: ${o.sessoes} escolheram, ${o.chegaramOferta} chegaram à oferta, ${o.compras} compraram`}>
                    <span className={s.opcaoRotulo}>{o.rotulo}</span>
                    <span className={s.opcaoBarra}>
                      <span className={s.opcaoTrilho}><span className={s.opcaoPreench} style={{ display: 'block', width: `${(o.pct / maiorPct) * 100}%` }} /></span>
                      <span className={s.opcaoPct}>{Math.round(pctVal)}% <small>{fmtInt(o.sessoes)}</small></span>
                    </span>
                    <span className={`${s.opcaoConv} ${melhor > 0 && c === melhor ? s.opcaoMelhor : ''}`}>
                      {o.sessoes ? fmtPct(o.compras, o.sessoes, 1) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
