'use client';

// Peças do resumo Domina IA (Visão geral, Vendas, Leads, App, Anúncios): país pelo
// nome, data curta, o gráfico por dia e o selo de situação da venda.
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import r from './DominaiaResumo.module.css';
import { COR_BARRA, fmtInt, fmtUsd, useEstreito } from './dominaiaComum';
import type { VendaDominaia } from './hubDominaiaResumo.types';

const TZ = 'America/Sao_Paulo';
let nomes: Intl.DisplayNames | null = null;
export function nomePais(codigo: string): string {
  if (!codigo || codigo === 'desconhecido') return 'Não informado';
  try {
    nomes ??= new Intl.DisplayNames(['pt-BR'], { type: 'region' });
    return nomes.of(codigo.toUpperCase()) ?? codigo;
  } catch { return codigo; }
}

/** 19/11 14:32, no horário de Brasília. */
export function fmtQuando(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || '—';
  return d.toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}
const diaCurto = (dia: string) => (/^\d{4}-\d{2}-\d{2}$/.test(dia) ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : dia);

export function anuncioDe(utm: string): string { return utm.trim() || 'Sem anúncio'; }

const usdInteiro = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// ── gráfico por dia ─────────────────────────────────────────────────────────
type Ponto = { dia: string; valor: number };
export function GraficoDias({ pontos, moeda, nome }: { pontos: Ponto[]; moeda?: boolean; nome: string }) {
  const estreito = useEstreito();
  const dados = pontos.map((p) => ({ ...p, rotulo: diaCurto(p.dia) }));
  const fmt = (v: number) => (moeda ? fmtUsd(v) : fmtInt(v));
  const total = pontos.reduce((t, p) => t + p.valor, 0);
  return (
    <figure className={r.figura}>
      <ResponsiveContainer width="100%" height={estreito ? 180 : 220}>
        <BarChart data={dados} margin={{ top: 12, right: 4, left: estreito ? -14 : -4, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="rotulo" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false}
            axisLine={{ stroke: 'var(--color-border-strong)' }} interval={estreito && dados.length > 8 ? 'preserveStartEnd' : 0} minTickGap={4} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickLine={false} axisLine={false}
            width={moeda ? 64 : 40} tickFormatter={(v: number) => (moeda ? usdInteiro(v) : fmtInt(v))} />
          <Tooltip cursor={{ fill: 'var(--color-surface-2)' }} content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as Ponto & { rotulo: string };
            return <div className={r.dica}><b>{p.rotulo}</b><span>{nome}: {fmt(p.valor)}</span></div>;
          }} />
          <Bar dataKey="valor" fill={COR_BARRA} radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <figcaption className={r.legenda}>{nome} por dia. Total no período: {fmt(total)}.</figcaption>
    </figure>
  );
}

// ── selos ───────────────────────────────────────────────────────────────────
export function Situacao({ v }: { v: VendaDominaia }) {
  if (v.contestada) return <span className={`${r.selo} ${r.seloRuim}`}>Contestada</span>;
  if (v.reembolsada) return <span className={`${r.selo} ${r.seloAtencao}`}>Reembolsada</span>;
  return <span className={`${r.selo} ${r.seloBom}`}>Paga</span>;
}
export const nomePlano = (p: string) => (p === 'basico' ? 'Básico' : p || '—');
export const nomeTipo = (t: string) => (t === 'compra' ? 'Compra' : t || '—');

/** Campo de busca com rótulo visível, para as tabelas de Vendas e Leads. */
export function Busca({ valor, mudar, id }: { valor: string; mudar: (v: string) => void; id: string }) {
  return (
    <label className={r.busca} htmlFor={id}>
      <span>Buscar e-mail</span>
      <input id={id} className="input-field" type="search" inputMode="email" name={id} value={valor} autoComplete="off" spellCheck={false}
        placeholder="nome@…" onChange={(e) => mudar(e.target.value)} />
    </label>
  );
}
