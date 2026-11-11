'use client';

// Compras de um produto menor da loja (off-grid, precificação, inventário, cursos).
// Lê /admin/produtos-loja?produto=<id>, que lê a tabela entitlements.
import { useEffect, useState } from 'react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Item {
  user_id: string;
  nome: string | null;
  email: string | null;
  origem: string;
  desde: string;
}

interface ProdutoLoja {
  produto: string;
  total: number;
  ultimos30: number;
  itens: Item[];
}

const ORIGEM: Record<string, string> = { compra: 'Compra', cortesia: 'Cortesia', admin: 'Liberado na mão' };
const dia = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

export default function ProdutoLojaPanel({ produto }: { produto: string }) {
  // O resultado guarda de qual produto veio: se não bate com o produto atual, ainda está carregando.
  const [res, setRes] = useState<{ produto: string; data: ProdutoLoja | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    api.get('/admin/produtos-loja', { params: { produto } })
      .then((r) => { if (vivo) setRes({ produto, data: r.data as ProdutoLoja }); })
      .catch(() => { if (vivo) setRes({ produto, data: null }); });
    return () => { vivo = false; };
  }, [produto]);

  if (!res || res.produto !== produto) return <p style={{ fontSize: 12, opacity: 0.7 }}>Carregando…</p>;
  const data = res.data;
  if (!data) return <p style={{ color: 'var(--color-text-muted)' }}>Não consegui carregar os dados.</p>;

  return (
    <div>
      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Acessos ativos</div>
          <div className={styles.cardValue}>{data.total}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Últimos 30 dias</div>
          <div className={styles.cardValue}>{data.ultimos30}</div>
        </div>
      </div>

      <div className={styles.tableWrap} style={{ marginTop: 16 }}>
        <table className={styles.table}>
          <thead>
            <tr><th>Data</th><th>Nome</th><th>E-mail</th><th>Origem</th></tr>
          </thead>
          <tbody>
            {data.itens.length === 0 ? (
              <tr><td colSpan={4} className={styles.empty}>Nenhuma compra ainda.</td></tr>
            ) : data.itens.map((i) => (
              <tr key={i.user_id}>
                <td>{dia(i.desde)}</td>
                <td>{i.nome || 'Sem nome'}</td>
                <td>{i.email || 'Sem e-mail'}</td>
                <td>{ORIGEM[i.origem] ?? i.origem}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
