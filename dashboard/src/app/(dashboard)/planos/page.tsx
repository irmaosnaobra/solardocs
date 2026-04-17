'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/services/api';
import styles from './planos.module.css';

interface User {
  plano: string;
  email: string;
}

const PLANOS = [
  {
    key: 'pro',
    nome: 'PRO',
    preco: '47',
    indicado: 'Indicado para até 20 vendas/mês',
    recursos: [
      '90 documentos por mês',
      'Contrato Solar, Prestação de Serviço, Procuração, Contrato PJ e Proposta Bancária',
      'Geração com IA + 2 modelos prontos',
      'Contratos com a logomarca da sua empresa',
      'Histórico dos últimos 30 dias',
    ],
    destaque: false,
    ctaLabel: 'Assinar PRO →',
  },
  {
    key: 'ilimitado',
    nome: 'VIP',
    preco: '97',
    indicado: 'Indicado para +20 vendas/mês',
    recursos: [
      'Documentos ilimitados — sem teto mensal',
      'Todos os 5 tipos de documento',
      'Geração com IA + 2 modelos prontos',
      'Contratos com a logomarca da sua empresa',
      'Histórico completo e permanente',
      'Dashboard com gráficos e analytics de uso',
      'Clientes e terceiros ilimitados',
      'Acesso antecipado a todo novo recurso',
      'Participa das decisões da plataforma',
      'Suporte prioritário direto no WhatsApp',
    ],
    destaque: true,
    ctaLabel: 'Assinar VIP →',
  },
];

function PlanosContent() {
  const searchParams = useSearchParams();
  const sucesso   = searchParams.get('sucesso');
  const cancelado = searchParams.get('cancelado');
  const sid       = searchParams.get('sid');

  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.data.user)).catch(() => {});
  }, []);

  useEffect(() => {
    if (sucesso && typeof window !== 'undefined' && (window as any).fbq) {
      (window as any).fbq('track', 'Purchase', { currency: 'BRL' }, sid ? { eventID: sid } : undefined);
    }
  }, [sucesso, sid]);

  async function assinar(planKey: string) {
    setLoading(planKey);
    try {
      const { data } = await api.post('/payments/create-checkout', { plan: planKey });
      window.location.href = data.url;
    } catch {
      alert('Erro ao iniciar pagamento. Tente novamente.');
    } finally {
      setLoading(null);
    }
  }

  const planoAtual = user?.plano ?? 'free';

  return (
    <div className={styles.container}>
      {sucesso && (
        <div className={styles.banner} style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e', color: '#22c55e' }}>
          ✅ Pagamento confirmado! Seu plano foi ativado.
        </div>
      )}
      {cancelado && (
        <div className={styles.banner} style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', color: '#ef4444' }}>
          ❌ Pagamento cancelado. Nenhuma cobrança foi feita.
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.title}>Continue gerando documentos</h1>
        <p className={styles.subtitle}>Você usou seus 10 documentos gratuitos. Escolha um plano e continue sem parar.</p>
      </div>

      <div className={styles.grid}>
        {PLANOS.map((plano) => {
          const isAtual = planoAtual === plano.key;
          return (
            <div key={plano.nome} className={`${styles.card} ${plano.destaque ? styles.destaque : ''}`}>
              {plano.destaque && <div className={styles.badge}>Mais Popular</div>}
              <div className={styles.planoNome}>{plano.nome}</div>
              <div className={styles.precoContainer}>
                <span className={styles.moeda}>R$</span>
                <span className={styles.valor}>{plano.preco}</span>
                <span className={styles.periodo}>/mês</span>
              </div>

              <div className={styles.indicado}>{plano.indicado}</div>

              <ul className={styles.recursos}>
                {plano.recursos.map((rec) => (
                  <li key={rec}><span>✅</span> {rec}</li>
                ))}
              </ul>

              {isAtual ? (
                <button className={styles.ctaBtnDisabled} disabled>
                  Plano Atual
                </button>
              ) : (
                <button
                  className={plano.destaque ? styles.ctaBtnVip : styles.ctaBtn}
                  onClick={() => assinar(plano.key!)}
                  disabled={loading === plano.key}
                >
                  {loading === plano.key ? 'Aguarde...' : plano.ctaLabel}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PlanosPage() {
  return (
    <Suspense>
      <PlanosContent />
    </Suspense>
  );
}
