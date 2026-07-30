'use client';

// ─────────────────────────────────────────────────────────────────────────────
// KIT / ISCA (R$27) — a régua que decide se a isca escala.
// Lê /admin/kit-funil (30d). Duas taxas mandam: visita→compra (a mídia se paga?)
// e comprador→assinante (a ponte funciona?). O resto é contexto.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Pedido {
  email: string;
  nome: string | null;
  produto: string;
  itens: string[];
  bump_vip: boolean;
  valor: number;
  status: string;
  conta_criada: boolean;
  trial_vip_ate: string | null;
  utm_campaign: string | null;
  criado_em: string;
}

interface KitFunil {
  periodo: string;
  visitas: number;
  sessoes: number;
  compradores: number;
  bump_vip: number;
  contas_criadas: number;
  assinantes: number;
  pix_pendente: number;
  receita: number;
  conv_visita_compra: number | null;
  conv_comprador_assinante: number | null;
  take_rate_bump: number | null;
  bump_sem_entrega: number;
  bump_sem_entrega_emails: string[];
  segmentos: { lp: number; membro: number; direto: number };
  pedidos: Pedido[];
}

const brl = (n: number) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number | null) => (n == null ? '—' : `${n}%`);
const dia = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// A régua do plano (5,9% pra mídia empatar a R$27) é sobre CLIQUE do anúncio.
// Aqui o denominador é sessão do beacon da LP, que fica em torno de 70-85% dos
// cliques (JS bloqueado, saída antes do beacon, prefetch) — ou seja, a taxa
// medida nesta tela sai OTIMISTA. Por isso o verde só acende em 7%, que é a
// mesma coisa vista pelo outro lado. O número de cliques vem do gerenciador.
const META_CONV_SESSAO = 7;
const META_ASSINANTE = 20;

export default function KitPanel() {
  const [data, setData] = useState<KitFunil | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/kit-funil').then((r) => setData(r.data as KitFunil)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const conv = data?.conv_visita_compra ?? null;
  const convAss = data?.conv_comprador_assinante ?? null;
  const corConv = conv == null ? undefined : conv >= META_CONV_SESSAO ? '#2F7A4F' : conv >= 4 ? '#C87A1E' : '#A53B29';
  const corAss = convAss == null ? undefined : convAss >= META_ASSINANTE ? '#2F7A4F' : '#C87A1E';

  const etapas: Array<[string, number]> = [
    ['Visitas na LP', data?.sessoes ?? 0],
    ['Compraram o kit', data?.compradores ?? 0],
    ['Conta criada', data?.contas_criadas ?? 0],
    ['Levaram o bump VIP', data?.bump_vip ?? 0],
    ['Viraram assinante', data?.assinantes ?? 0],
  ];
  const maxEtapa = etapas.reduce((m, [, n]) => Math.max(m, n), 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Últimos 30 dias · LP solardoc.app/kit</span>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>{loading ? 'Atualizando…' : '↻ Atualizar'}</button>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Sessão na LP → compra</div>
          <div className={styles.cardValue} style={{ color: corConv }}>{pct(conv)}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
            verde em {META_CONV_SESSAO}% — a régua de 5,9% é sobre cliques do anúncio, e sessão
            conta menos que clique
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Comprador → assinante</div>
          <div className={styles.cardValue} style={{ color: corAss }}>{pct(convAss)}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>precisa de {META_ASSINANTE}%</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Compradores</div>
          <div className={styles.cardValue}>{(data?.compradores ?? 0).toLocaleString('pt-BR')}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Receita do kit</div>
          <div className={styles.cardValue} style={{ color: '#C87A1E' }}>{brl(data?.receita ?? 0)}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Take do bump VIP</div>
          <div className={styles.cardValue}>{pct(data?.take_rate_bump ?? null)}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Pix pendente</div>
          <div className={styles.cardValue} style={{ color: (data?.pix_pendente ?? 0) > 0 ? '#C87A1E' : undefined }}>
            {(data?.pix_pendente ?? 0).toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      {(data?.bump_sem_entrega ?? 0) > 0 && (
        <div className={styles.card} style={{ marginTop: 14, borderLeft: '3px solid #A53B29' }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: '#A53B29' }}>
            {data!.bump_sem_entrega} bump cobrado de quem já era assinante
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.75, lineHeight: 1.6 }}>
            Essas pessoas pagaram os R$19 e não receberam nada — 30 dias de VIP em cima de
            uma assinatura ativa não é entrega. Reembolse na Kiwify ou dê um mês de crédito.
            Para não repetir: mande a base própria pro checkout <strong>sem order bump</strong>.
          </div>
          <div style={{ fontSize: 12, marginTop: 8, fontFamily: 'monospace', opacity: 0.9 }}>
            {(data?.bump_sem_entrega_emails ?? []).join(' · ')}
          </div>
        </div>
      )}

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>De onde vieram os compradores</div>
        <div style={{ fontSize: 11.5, opacity: 0.6, marginBottom: 12 }}>
          Pessoas, não pedidos. Compra anterior a 29/07 aparece como “direto” — o carimbo é novo.
        </div>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
          {([
            ['Anúncio / LP', data?.segmentos?.lp ?? 0, 'chegaram pela campanha'],
            ['Base própria', data?.segmentos?.membro ?? 0, 'já tinham conta quando compraram'],
            ['Direto', data?.segmentos?.direto ?? 0, 'sem rastro de campanha'],
          ] as Array<[string, number, string]>).map(([rotulo, valor, nota]) => (
            <div key={rotulo}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{rotulo}</div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{valor.toLocaleString('pt-BR')}</div>
              <div style={{ fontSize: 11, opacity: 0.55 }}>{nota}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Do clique ao assinante</div>
        {etapas.map(([label, n]) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>{label}</span>
              <strong>{n.toLocaleString('pt-BR')}</strong>
            </div>
            <div style={{ height: 8, background: 'rgba(148,163,184,.15)', borderRadius: 999 }}>
              <div style={{
                width: maxEtapa ? `${Math.max(2, (n / maxEtapa) * 100)}%` : '2%',
                height: '100%', background: '#C87A1E', borderRadius: 999,
              }} />
            </div>
          </div>
        ))}
        {!data?.sessoes && (
          <div style={{ fontSize: 12, opacity: 0.65, marginTop: 10 }}>
            Sem visita registrada ainda — a LP começa a preencher isto assim que o tráfego chegar.
          </div>
        )}
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Pedidos recentes</div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Quando</th><th>Comprador</th><th>Produto</th><th>Status</th><th>Conta</th><th>VIP</th><th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {(data?.pedidos ?? []).map((p, i) => (
                <tr key={`${p.email}-${i}`}>
                  <td>{dia(p.criado_em)}</td>
                  <td>{p.nome || p.email}</td>
                  <td>{p.produto}</td>
                  <td style={{ color: p.status === 'paid' ? '#2F7A4F' : '#C87A1E' }}>{p.status}</td>
                  <td>{p.conta_criada ? 'criada' : '—'}</td>
                  <td>{p.bump_vip ? '30d' : '—'}</td>
                  <td>{brl(p.valor)}</td>
                </tr>
              ))}
              {!data?.pedidos?.length && (
                <tr><td colSpan={7} style={{ opacity: 0.6 }}>Nenhuma venda ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
