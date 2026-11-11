'use client';

// ─────────────────────────────────────────────────────────────────────────────
// LOJA (Pix, Asaas): as compras dos produtos "Para crescer" vendidos dentro do app,
// no ar desde 10/11/2026. Lê /admin/loja-pix (tabela produto_cobrancas): por produto,
// quantas cobranças foram geradas, quantas pagas e o valor pago, mais as últimas 20.
// O endpoint nunca devolve CPF, e-mail nem telefone: da pessoa só o primeiro nome.
// Embaixo fica a moderação dos comentários do curso, que antes era uma aba própria.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';
import ComentariosCursoPanel from './ComentariosCursoPanel';

interface ProdutoLoja { slug: string; nome: string; geradas: number; pagas: number; valor_pago: number }
interface UltimaLoja {
  criado_em: string; slug: string; produto: string; status: string; valor: number; primeiro_nome: string | null;
}
interface LojaPix {
  period: string; desde: string;
  total: { geradas: number; pagas: number; valor_pago: number };
  por_produto: ProdutoLoja[];
  ultimas: UltimaLoja[];
}

const PERIODS = [
  { k: '7d', label: '7 dias' }, { k: '30d', label: '30 dias' }, { k: '90d', label: '90 dias' },
];

const STATUS: Record<string, { label: string; cor: string }> = {
  pago: { label: 'Pago', cor: '#2F7A4F' },
  pendente: { label: 'Pendente', cor: '#C87A1E' },
  expirado: { label: 'Expirado', cor: '#8B857A' },
  cancelado: { label: 'Cancelado', cor: '#8B857A' },
  reembolsado: { label: 'Reembolsado', cor: '#A53B29' },
};

const brl = (n: number) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataHora = (s: string) => new Date(s).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
});

export default function LojaPanel() {
  const [period, setPeriod] = useState('30d');
  const [dados, setDados] = useState<LojaPix | null>(null);
  const [erro, setErro] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback((p: string) => {
    setLoading(true); setErro(false);
    api.get(`/admin/loja-pix?period=${p}`)
      .then((r) => setDados(r.data as LojaPix))
      .catch(() => { setDados(null); setErro(true); })
      .finally(() => setLoading(false));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Carrega os dados ao montar, o estado só muda quando a resposta chega.
  useEffect(() => { load(period); }, [load, period]);

  const vazio = !!dados && dados.total.geradas === 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Compras da loja no Pix, dentro do app</span>
        <div className={styles.periodTabs}>
          {PERIODS.map((p) => (
            <button
              key={p.k}
              className={period === p.k ? styles.periodActive : styles.periodBtn}
              onClick={() => setPeriod(p.k)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !dados && <div className={styles.loading}>Carregando a loja…</div>}
      {erro && <div className={styles.loading}>Não deu para ler a loja agora. Tente de novo em instantes.</div>}

      {dados && (
        <>
          <div className={styles.cards}>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Cobranças geradas</div>
              <div className={styles.cardValue}>{dados.total.geradas.toLocaleString('pt-BR')}</div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Pagas</div>
              <div className={styles.cardValue} style={{ color: dados.total.pagas > 0 ? '#2F7A4F' : undefined }}>
                {dados.total.pagas.toLocaleString('pt-BR')}
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.cardLabel}>Valor pago</div>
              <div className={styles.cardValue} style={{ color: '#C87A1E' }}>{brl(dados.total.valor_pago)}</div>
            </div>
          </div>

          {vazio ? (
            <div className={styles.card} style={{ marginTop: 14, textAlign: 'center', padding: '28px 18px' }}>
              <div style={{ fontWeight: 700 }}>Nenhuma compra na loja neste período.</div>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, margin: '18px 0 8px' }}>Por produto</div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>Produto</th><th>Geradas</th><th>Pagas</th><th>Valor pago</th></tr>
                  </thead>
                  <tbody>
                    {dados.por_produto.map((p) => (
                      <tr key={p.slug}>
                        <td>{p.nome}</td>
                        <td>{p.geradas.toLocaleString('pt-BR')}</td>
                        <td>{p.pagas.toLocaleString('pt-BR')}</td>
                        <td>{brl(p.valor_pago)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ fontWeight: 700, margin: '18px 0 8px' }}>Últimas cobranças</div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>Data</th><th>Produto</th><th>Quem</th><th>Status</th><th>Valor</th></tr>
                  </thead>
                  <tbody>
                    {dados.ultimas.map((u, i) => {
                      const st = STATUS[u.status] ?? { label: u.status, cor: '#8B857A' };
                      return (
                        <tr key={`${u.criado_em}-${i}`}>
                          <td>{dataHora(u.criado_em)}</td>
                          <td>{u.produto}</td>
                          <td>{u.primeiro_nome ?? 'Sem conta'}</td>
                          <td style={{ color: st.cor, fontWeight: 600 }}>{st.label}</td>
                          <td>{brl(u.valor)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <div style={{ fontWeight: 700, fontSize: 16, margin: '28px 0 10px' }}>Comentários do curso para aprovar</div>
      <ComentariosCursoPanel />
    </div>
  );
}
