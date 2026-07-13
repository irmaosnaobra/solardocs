'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';
import s from './MetaAdsPanel.module.css';

// ─── Aba "Meta Ads" — painel de comando 100% dos dados + ordens de ação ──────
// Só leitura: mostra tudo (campanhas/conjuntos/anúncios com ROAS, compras, CTR,
// CPC do próprio Meta) + "ordens de comando" (o que fazer) com botão que leva
// pro Gerenciador. Escada de faturamento acumulado 10k→1M. Ver backend
// /admin/meta-ads (metaAdsController). Futuro: botão vira execução automática.

type Period = 'hoje' | 'ontem' | '3d' | '7dias' | '14dias' | '30dias' | 'mes' | 'maximo';
type Level = 'campaign' | 'adset' | 'ad';
type OrdemTipo = 'DUPLICAR' | 'AUMENTAR' | 'PAUSAR' | 'OBSERVAR' | 'MANTER';

interface MetaEntity {
  level: Level; id: string; name: string;
  campaign_name?: string; adset_name?: string;
  status: string; is_lead: boolean;
  spend: number; impressions: number; clicks: number;
  ctr: number; cpc: number; cpm: number;
  purchases: number; purchase_value: number; roas: number; cpa: number; frequency: number;
}
interface Ordem { tipo: OrdemTipo; entity: MetaEntity; motivo: string; comoFazer: string; prioridade: number; }
interface Totais { spend: number; impressions: number; clicks: number; purchases: number; purchase_value: number; ctr: number; cpc: number; cpa: number; roas: number; }
interface Escada {
  degraus: { valor: number; atingido: boolean }[];
  alvo: number; anterior: number; falta: number; progresso: number; total: number;
}
interface MetaAdsData {
  available: boolean; reason?: string;
  periodo: string; atualizadoEm: string; conta: string;
  totais: Totais;
  campaigns: MetaEntity[]; adsets: MetaEntity[]; ads: MetaEntity[];
  ordens: Ordem[]; resumoOrdens: Record<string, number>;
  faturamento: { total: number; solardoc: number; limpapro: number; vendas: number };
  escada: Escada;
}

const PERIODS: { key: Period; label: string }[] = [
  { key: 'hoje', label: 'Hoje' }, { key: 'ontem', label: 'Ontem' },
  { key: '3d', label: '3 dias' }, { key: '7dias', label: '7 dias' },
  { key: '14dias', label: '14 dias' }, { key: '30dias', label: '30 dias' },
  { key: 'mes', label: 'Este mês' }, { key: 'maximo', label: 'Máximo' },
];

const ORDEM_META: Record<OrdemTipo, { emoji: string; cor: string; titulo: string }> = {
  DUPLICAR: { emoji: '🟢', cor: s.ordDuplicar, titulo: 'Duplicar' },
  AUMENTAR: { emoji: '🔼', cor: s.ordAumentar, titulo: 'Aumentar 30%' },
  PAUSAR:   { emoji: '🔴', cor: s.ordPausar,   titulo: 'Pausar' },
  OBSERVAR: { emoji: '👀', cor: s.ordObservar, titulo: 'Observar' },
  MANTER:   { emoji: '⚪', cor: s.ordManter,   titulo: 'Manter' },
};

const fmtBRL = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtBRLk = (n: number) => n >= 1000 ? 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: n >= 100000 ? 0 : 1 }) + 'k' : fmtBRL(n);
const roasClass = (r: number) => r >= 2.5 ? s.roasBom : r >= 1.5 ? s.roasMed : r > 0 ? s.roasRuim : s.roasZero;

function gerenciadorLink(conta: string, level: Level, id: string): string {
  const edge = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  const param = level === 'campaign' ? 'selected_campaign_ids' : level === 'adset' ? 'selected_adset_ids' : 'selected_ad_ids';
  return `https://adsmanager.facebook.com/adsmanager/manage/${edge}?act=${conta}&${param}=${id}`;
}

export default function MetaAdsPanel() {
  const [data, setData] = useState<MetaAdsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [period, setPeriod] = useState<Period>('hoje');
  const [level, setLevel] = useState<Level>('adset');

  const load = useCallback(async (p: Period) => {
    setLoading(true); setErro('');
    try {
      const { data } = await api.get<MetaAdsData>('/admin/meta-ads', { params: { period: p } });
      if (!data.available) { setErro(data.reason || 'Meta Ads indisponível.'); setData(null); }
      else setData(data);
    } catch {
      setErro('Erro ao carregar dados do Meta. Tente de novo.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(period); }, [load, period]);

  const linhas: MetaEntity[] = data ? (level === 'campaign' ? data.campaigns : level === 'adset' ? data.adsets : data.ads) : [];

  return (
    <div className={s.wrap}>
      {/* ── Cabeçalho + explicação ── */}
      <div className={s.head}>
        <div>
          <h2 className={s.title}>Meta Ads — Central de Comando</h2>
          <p className={s.sub}>Todos os dados da conta + o que fazer agora. Você decide e toca no botão — nada é mexido sozinho.</p>
        </div>
        <button className={s.refresh} onClick={() => load(period)} disabled={loading}>{loading ? '...' : '↻ Atualizar'}</button>
      </div>

      {/* ── Escada de faturamento (sempre visível — é a jornada até 1M) ── */}
      {data && (
        <div className={s.escadaCard}>
          <div className={s.escadaTop}>
            <div>
              <div className={s.escadaLabel}>Faturamento acumulado (SolarDoc + LimpaPro)</div>
              <div className={s.escadaTotal}>{fmtBRL(data.faturamento.total)}</div>
              <div className={s.escadaBreak}>
                SolarDoc {fmtBRL(data.faturamento.solardoc)} · LimpaPro {fmtBRL(data.faturamento.limpapro)} · {data.faturamento.vendas} vendas
              </div>
            </div>
            <div className={s.escadaAlvo}>
              <div className={s.escadaAlvoLabel}>Próximo degrau</div>
              <div className={s.escadaAlvoVal}>{fmtBRLk(data.escada.alvo)}</div>
              <div className={s.escadaFalta}>faltam {fmtBRL(data.escada.falta)}</div>
            </div>
          </div>
          <div className={s.escadaBarWrap}>
            <div className={s.escadaBar} style={{ width: `${data.escada.progresso}%` }} />
          </div>
          <div className={s.escadaDegraus}>
            {data.escada.degraus.map(d => (
              <div key={d.valor} className={`${s.degrau} ${d.atingido ? s.degrauOk : ''} ${d.valor === data.escada.alvo ? s.degrauAlvo : ''}`}>
                {d.atingido ? '✅' : d.valor === data.escada.alvo ? '🎯' : '⬜'} {fmtBRLk(d.valor)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Seletor de período ── */}
      <div className={s.periodRow}>
        {PERIODS.map(p => (
          <button key={p.key} className={`${s.periodBtn} ${period === p.key ? s.periodActive : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
      </div>

      {loading && <div className={s.loading}>Puxando dados do Meta…</div>}
      {erro && !loading && <div className={s.erro}>⚠️ {erro}</div>}

      {data && !loading && (
        <>
          {/* ── Totais do período ── */}
          <div className={s.kpis}>
            <div className={s.kpi}><div className={s.kpiLabel}>Investido</div><div className={s.kpiVal}>{fmtBRL(data.totais.spend)}</div></div>
            <div className={s.kpi}><div className={s.kpiLabel}>Compras (Meta)</div><div className={s.kpiVal}>{data.totais.purchases}</div></div>
            <div className={s.kpi}><div className={s.kpiLabel}>Receita atribuída</div><div className={s.kpiVal}>{fmtBRL(data.totais.purchase_value)}</div></div>
            <div className={s.kpi}><div className={s.kpiLabel}>ROAS</div><div className={`${s.kpiVal} ${roasClass(data.totais.roas)}`}>{data.totais.roas.toFixed(1)}x</div></div>
            <div className={s.kpi}><div className={s.kpiLabel}>Custo/compra</div><div className={s.kpiVal}>{data.totais.cpa > 0 ? fmtBRL(data.totais.cpa) : '—'}</div></div>
            <div className={s.kpi}><div className={s.kpiLabel}>CTR</div><div className={s.kpiVal}>{data.totais.ctr.toFixed(2)}%</div></div>
            <div className={s.kpi}><div className={s.kpiLabel}>CPC</div><div className={s.kpiVal}>{fmtBRL(data.totais.cpc)}</div></div>
          </div>

          {/* ── Ordens de comando ── */}
          <div className={s.blocoTitulo}>
            🎯 Ordens de comando <span className={s.blocoSub}>o que fazer agora (últimos 3 dias) — clique pra ir ao Gerenciador</span>
          </div>
          {data.ordens.length === 0 && <div className={s.vazio}>Nenhuma ação urgente. Deixa rodar. 👍</div>}
          <div className={s.ordens}>
            {data.ordens.filter(o => o.tipo !== 'MANTER').map((o, i) => {
              const m = ORDEM_META[o.tipo];
              return (
                <div key={o.entity.id + i} className={`${s.ordem} ${m.cor}`}>
                  <div className={s.ordemHead}>
                    <span className={s.ordemTipo}>{m.emoji} {m.titulo}</span>
                    <span className={s.ordemNome}>{o.entity.name}</span>
                  </div>
                  <div className={s.ordemCampanha}>{o.entity.campaign_name}</div>
                  <div className={s.ordemMotivo}>{o.motivo}</div>
                  <div className={s.ordemComo}>💡 {o.comoFazer}</div>
                  <a className={s.ordemBtn} href={gerenciadorLink(data.conta, 'adset', o.entity.id)} target="_blank" rel="noreferrer">Abrir no Gerenciador →</a>
                </div>
              );
            })}
          </div>

          {/* ── Tabela detalhada (nível selecionável) ── */}
          <div className={s.blocoTitulo}>
            📊 Todos os dados
            <div className={s.levelTabs}>
              <button className={`${s.levelBtn} ${level === 'campaign' ? s.levelActive : ''}`} onClick={() => setLevel('campaign')}>Campanhas</button>
              <button className={`${s.levelBtn} ${level === 'adset' ? s.levelActive : ''}`} onClick={() => setLevel('adset')}>Conjuntos</button>
              <button className={`${s.levelBtn} ${level === 'ad' ? s.levelActive : ''}`} onClick={() => setLevel('ad')}>Anúncios</button>
            </div>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.tLeft}>Nome</th>
                  <th>Status</th><th>Investido</th><th>Compras</th><th>Receita</th>
                  <th>ROAS</th><th>CPA</th><th>CTR</th><th>CPC</th><th>Impr.</th><th></th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(e => (
                  <tr key={e.id} className={e.is_lead ? s.rowLead : ''}>
                    <td className={s.tLeft}>
                      <div className={s.nomeCell}>{e.name}{e.is_lead && <span className={s.leadTag}>LEAD</span>}</div>
                      {level !== 'campaign' && <div className={s.nomeSub}>{e.campaign_name}</div>}
                    </td>
                    <td><span className={`${s.status} ${e.status === 'ACTIVE' ? s.stAtivo : s.stPausado}`}>{e.status === 'ACTIVE' ? 'Ativo' : e.status ? 'Pausado' : '—'}</span></td>
                    <td>{fmtBRL(e.spend)}</td>
                    <td>{e.is_lead ? <span className={s.mutedCell}>lead</span> : e.purchases}</td>
                    <td>{e.is_lead ? '—' : fmtBRL(e.purchase_value)}</td>
                    <td className={e.is_lead ? '' : roasClass(e.roas)}>{e.is_lead ? '—' : e.roas > 0 ? e.roas.toFixed(1) + 'x' : '0'}</td>
                    <td>{e.is_lead ? '—' : e.cpa > 0 ? fmtBRL(e.cpa) : '—'}</td>
                    <td>{e.ctr.toFixed(1)}%</td>
                    <td>{fmtBRL(e.cpc)}</td>
                    <td>{e.impressions.toLocaleString('pt-BR')}</td>
                    <td><a className={s.linkGer} href={gerenciadorLink(data.conta, level, e.id)} target="_blank" rel="noreferrer">↗</a></td>
                  </tr>
                ))}
                {linhas.length === 0 && <tr><td colSpan={11} className={s.vazio}>Sem dados nesse período.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className={s.rodape}>
            Conta {data.conta} · atualizado {new Date(data.atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })} ·
            Forms 1/2 são campanhas de <b>lead</b> (não venda) — 0 compra é normal nelas. ROAS/compras vêm do próprio Meta.
          </div>
        </>
      )}
    </div>
  );
}
