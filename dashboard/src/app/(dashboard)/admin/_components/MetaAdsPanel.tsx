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
  signals?: Signals | null;
}
// Sinais de "especialista" (do histórico diário) — ver metaSignalsService.
interface JanelaMetrica { n_dias: number; roas: number; purchases: number; spend: number; suficiente: boolean; }
interface Signals {
  dias_rodando: number;
  trajetoria: 'subindo' | 'caindo' | 'estavel' | 'novo';
  roas_recente: number; roas_anterior: number;
  fadiga: boolean; frequencia: number;
  melhor_roas: number; melhor_dia: string | null;
  score: number; leitura: string;
  janelas?: { hoje: JanelaMetrica; ontem: JanelaMetrica; d3: JanelaMetrica; d7: JanelaMetrica; d14: JanelaMetrica; d30: JanelaMetrica };
  veredito?: { tipo: string; concordancia: 'alta' | 'media' | 'baixa'; frase: string };
}
interface Ordem { tipo: OrdemTipo; entity: MetaEntity; motivo: string; comoFazer: string; prioridade: number; signals?: Signals | null; }
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

// ── Disciplina das ordens (fila de execução persistida) ──
interface OrdemRow {
  id: string; criada_em: string; chave: string; tipo: OrdemTipo;
  adset_id: string; adset_nome: string | null; campanha_nome: string | null;
  motivo: string; como_fazer: string; score: number | null; leitura: string | null;
  estado: 'pendente' | 'feita' | 'perdida' | 'vencida' | 'cancelada';
  expira_em: string; feita_em: string | null; feita_por: string | null;
  confirmacao: string | null; confirmacao_detalhe: string | null;
  resolucao_detalhe: string | null;
  snapshot: { janelas?: Signals['janelas']; veredito?: Signals['veredito']; concordancia?: string } | null;
}
interface OrdensData { pendentes: OrdemRow[]; historico: OrdemRow[]; modo: string; }

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
// Horário-limite como relógio ("faça até 23h07"), em BRT.
const horaLimite = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
// Uma janela: "16.8x" ou "—" se dados insuficientes.
const janelaTxt = (m?: JanelaMetrica) => (m && m.suficiente ? m.roas.toFixed(1) + 'x' : '—');
const trajArrow = (t: Signals['trajetoria']) =>
  t === 'subindo' ? <span title="ROAS subindo" style={{ color: '#16a34a' }}>↑</span>
  : t === 'caindo' ? <span title="ROAS caindo" style={{ color: '#dc2626' }}>↓</span>
  : t === 'novo' ? <span title="Ainda coletando" style={{ color: '#94a3b8' }}>🌱</span>
  : <span title="Estável" style={{ color: '#94a3b8' }}>→</span>;

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
  // Fila de execução (ordens persistidas)
  const [ordens, setOrdens] = useState<OrdensData | null>(null);
  const [acting, setActing] = useState<string | null>(null);

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

  const loadOrdens = useCallback(async () => {
    try {
      const { data } = await api.get<OrdensData>('/admin/ordens');
      setOrdens(data);
    } catch { /* fila é opcional — não quebra a aba */ }
  }, []);

  useEffect(() => { load(period); }, [load, period]);
  useEffect(() => { loadOrdens(); }, [loadOrdens]);

  async function marcarFeita(id: string) {
    setActing(id);
    try {
      await api.post(`/admin/ordens/${id}/feita`);
      await loadOrdens();
    } catch { /* silencioso */ } finally { setActing(null); }
  }
  async function trocarModo(modo: 'manual' | 'automatico') {
    if (modo === 'automatico' && !confirm('LIGAR AUTOMÁTICO?\n\nNo automático o sistema poderá executar ações no Meta sozinho (quando essa parte estiver ligada). Por enquanto ele fica pronto mas ainda não age sozinho — você continua no controle. Confirmar?')) return;
    try { await api.post('/admin/ordens/modo', { modo }); await loadOrdens(); } catch { /* */ }
  }

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

          {/* ── Ordens de comando (FALLBACK): só se a fila persistida não carregou.
                 A "Fila de execução" abaixo é a superfície principal (com prazo +
                 marcar feito). Estes cards stateless só aparecem se /admin/ordens
                 falhar, pra a aba nunca ficar sem as recomendações. ── */}
          {!ordens && (
            <>
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
                      {o.signals && (
                        <div className={s.ordemEspecialista}>
                          <span className={s.espScore} title="Nota de saúde 0-100">{o.signals.score}</span>
                          🧠 {o.signals.leitura} <span className={s.espDias}>· {o.signals.dias_rodando}d rodando</span>
                        </div>
                      )}
                      <div className={s.ordemComo}>💡 {o.comoFazer}</div>
                      <a className={s.ordemBtn} href={gerenciadorLink(data.conta, 'adset', o.entity.id)} target="_blank" rel="noreferrer">Abrir no Gerenciador →</a>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ── Fila de execução (ordens com prazo, marcar feito, manual/auto) ── */}
          {ordens && (
            <>
              <div className={s.blocoTitulo}>
                ✅ Fila de execução
                <span className={s.blocoSub}>marque o que fez · passou do prazo = perdeu a janela</span>
                <div className={s.modoSwitch}>
                  <button className={`${s.modoBtn} ${ordens.modo === 'manual' ? s.modoAtivo : ''}`} onClick={() => trocarModo('manual')}>👤 Manual</button>
                  <button className={`${s.modoBtn} ${ordens.modo === 'automatico' ? s.modoAtivoAuto : ''}`} onClick={() => trocarModo('automatico')}>🤖 Automático</button>
                </div>
              </div>

              {ordens.pendentes.length === 0 && <div className={s.vazio}>Nenhuma ordem na fila agora. 👍</div>}
              <div className={s.fila}>
                {ordens.pendentes.map(o => {
                  const m = ORDEM_META[o.tipo];
                  const restaMs = new Date(o.expira_em).getTime() - Date.now();
                  const restaH = Math.max(0, restaMs / 3600000);
                  const urgente = restaH < 4;
                  return (
                    <div key={o.id} className={`${s.filaItem} ${m.cor}`}>
                      <div className={s.filaTopo}>
                        <span className={s.ordemTipo}>{m.emoji} {m.titulo}</span>
                        <span className={s.ordemNome}>{o.adset_nome}</span>
                        {o.snapshot?.concordancia && (
                          <span className={`${s.concTag} ${o.snapshot.concordancia === 'alta' ? s.concAlta : o.snapshot.concordancia === 'media' ? s.concMedia : s.concBaixa}`}>
                            {o.snapshot.concordancia === 'alta' ? 'janelas concordam' : o.snapshot.concordancia === 'media' ? 'confirma nos próximos dias' : 'sinal fraco'}
                          </span>
                        )}
                        <span className={`${s.prazo} ${urgente ? s.prazoUrgente : ''}`} title="Passou do horário = não executado, some da fila">
                          ⏰ faça até {horaLimite(o.expira_em)}
                        </span>
                      </div>
                      {/* Avaliação multi-janela — a base da decisão (30d→hoje) */}
                      {o.snapshot?.janelas && (
                        <div className={s.janelas}>
                          {([['30d','d30'],['14d','d14'],['7d','d7'],['3d','d3'],['ontem','ontem'],['hoje','hoje']] as const).map(([lbl, k]) => {
                            const j = o.snapshot!.janelas![k as keyof NonNullable<Signals['janelas']>];
                            const decisora = k === 'd3' || k === 'd7';
                            return (
                              <span key={lbl} className={`${s.janelaCol} ${decisora ? s.janelaDecisora : ''}`} title={decisora ? 'janela que DECIDE' : k === 'hoje' || k === 'ontem' ? 'só contexto (pixel atrasa 1 dia)' : 'confirma tendência'}>
                                <span className={s.janelaLbl}>{lbl}</span>
                                <span className={s.janelaVal}>{janelaTxt(j)}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {/* O PORQUÊ (escola dinâmica) — explicação do cruzamento */}
                      <div className={s.filaPorque}>🧠 {o.motivo}</div>
                      <div className={s.ordemComo}>💡 {o.como_fazer}</div>
                      <div className={s.filaAcoes}>
                        <a className={s.ordemBtn} href={gerenciadorLink(data.conta, 'adset', o.adset_id)} target="_blank" rel="noreferrer">Abrir no Gerenciador →</a>
                        <button className={s.btnFeito} disabled={acting === o.id} onClick={() => marcarFeita(o.id)}>
                          {acting === o.id ? '...' : '✓ Marcar feito'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Histórico recente: feitas / perdidas / vencidas */}
              {ordens.historico.length > 0 && (
                <details className={s.histWrap}>
                  <summary className={s.histResumo}>Histórico ({ordens.historico.length}) — feitas, perdidas e vencidas</summary>
                  <div className={s.histLista}>
                    {ordens.historico.map(o => (
                      <div key={o.id} className={s.histItem}>
                        <span className={`${s.histEstado} ${o.estado === 'feita' ? s.hFeita : o.estado === 'perdida' ? s.hPerdida : s.hVencida}`}>
                          {o.estado === 'feita' ? '✅ Feita' : o.estado === 'perdida' ? '⌛ Perdida' : '➖ Venceu'}
                        </span>
                        <span className={s.histNome}>{ORDEM_META[o.tipo]?.emoji} {o.adset_nome}</span>
                        <span className={s.histDet}>{o.confirmacao_detalhe || o.resolucao_detalhe}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

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
                  <th>Status</th>{level === 'adset' && <th>Especialista</th>}<th>Investido</th><th>Compras</th><th>Receita</th>
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
                    {level === 'adset' && (
                      <td>
                        {e.signals ? (
                          <span className={s.espCell} title={e.signals.leitura}>
                            <span className={`${s.espScoreMini} ${e.signals.score >= 80 ? s.espBom : e.signals.score >= 50 ? s.espMed : s.espRuim}`}>{e.signals.score}</span>
                            {trajArrow(e.signals.trajetoria)}
                            {e.signals.fadiga && <span title="Fadiga de criativo">😴</span>}
                          </span>
                        ) : <span className={s.mutedCell}>—</span>}
                      </td>
                    )}
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
                {linhas.length === 0 && <tr><td colSpan={level === 'adset' ? 12 : 11} className={s.vazio}>Sem dados nesse período.</td></tr>}
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
