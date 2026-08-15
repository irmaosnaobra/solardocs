'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { getCheckoutAttribution } from '@/hooks/useLpTracking';
import { pixRecorrenteLigado } from '@/components/LinkPagarPix/LinkPagarPix';
import { marcarSaidaProCheckout } from '@/lib/saidaCheckout';
import styles from './assinar.module.css';

interface CupomInfo {
  valido: boolean;
  codigo?: string;
  descricao?: string | null;
  primeiroMes?: number;
  precoCheio?: number;
}

const ITENS = [
  'Documentos ilimitados, com a sua marca',
  'Contrato solar, proposta, procuração, vistoria e mais',
  'Proposta com payback pra fechar na hora',
  'Histórico permanente e suporte no WhatsApp',
];

export default function AssinarCliente() {
  const params = useSearchParams();
  const cupomUrl = (params.get('cupom') || '').trim().toUpperCase();
  const plano = params.get('plano') || 'vip';

  const [cupom, setCupom] = useState<CupomInfo | null>(null);
  const [conferindo, setConferindo] = useState(true);
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Sempre consulta — a resposta traz o preço do plano mesmo sem cupom, então a
  // página nunca chuta valor (os preços do SolarDoc já mudaram uma vez). Cupom
  // inválido/vencido não vira erro na cara do cliente: mostra o preço cheio.
  useEffect(() => {
    let vivo = true;
    api.get(`/payments/cupom/${encodeURIComponent(cupomUrl || '_')}`, { params: { plano } })
      .then(({ data }) => { if (vivo) setCupom(data); })
      .catch(() => { if (vivo) setCupom({ valido: false }); })
      .finally(() => { if (vivo) setConferindo(false); });
    return () => { vivo = false; };
  }, [cupomUrl, plano]);

  const comCupom = !!cupom?.valido;
  const precoCheio = cupom?.precoCheio ?? null;
  const primeiroMes = comCupom ? (cupom?.primeiroMes ?? precoCheio) : precoCheio;

  async function irPraPagamento() {
    setIndo(true);
    setErro(null);
    try {
      (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq?.(
        'track', 'InitiateCheckout', { value: primeiroMes ?? 0, currency: 'BRL', content_name: 'assinar_link' },
      );
      // Esta tela é o destino dos toques (link da Giovanna, recuperação): sem
      // repassar as UTMs da URL, a venda chegava no ledger sem rastro nenhum e
      // o painel só sabia dizer "direto". Mesma função da LP — lê a URL e o que
      // ficou guardado na sessão.
      const { data } = await api.post('/payments/public-checkout', {
        plan: plano,
        ...(comCupom ? { cupom: cupom?.codigo } : {}),
        ...getCheckoutAttribution(),
      });
      if (data?.url) { marcarSaidaProCheckout(data.cancelUrl); window.location.href = data.url; return; }
      throw new Error('sem url');
    } catch {
      setErro('Não consegui abrir o pagamento. Tenta de novo, ou chama a gente no WhatsApp (34) 99816-5040.');
      setIndo(false);
    }
  }

  return (
    <div className={styles.tela}>
      <div className={styles.card}>
        <div className={styles.marca}>SolarDoc Pro</div>
        <h1 className={styles.titulo}>Seus contratos e propostas prontos em minutos</h1>
        <p className={styles.linhaFina}>Acesso completo à plataforma, no seu nome e com a sua logo.</p>

        {comCupom && <div className={styles.selo}>Cupom {cupom?.codigo} aplicado</div>}

        <div className={styles.preco}>
          <span className={styles.precoMoeda}>R$</span>
          <span className={styles.precoValor}>{conferindo || primeiroMes === null ? '—' : primeiroMes}</span>
          <span className={styles.precoPeriodo}>{comCupom ? 'no primeiro mês' : '/mês'}</span>
          {comCupom && <span className={styles.precoRiscado}>R$ {precoCheio}</span>}
        </div>
        <p className={styles.depois}>
          {comCupom
            ? `Depois R$ ${precoCheio}/mês. Cancele quando quiser, sem multa.`
            : 'Cobrança mensal. Cancele quando quiser, sem multa.'}
        </p>

        <ul className={styles.itens}>
          {ITENS.map((i) => <li key={i}>{i}</li>)}
        </ul>

        <button className={styles.btn} onClick={irPraPagamento} disabled={indo || conferindo}>
          {indo ? 'Abrindo pagamento...' : comCupom ? `Assinar por R$ ${primeiroMes}` : 'Assinar agora'}
        </button>

        {/* O Pix recorrente só aparece quando o trilho está ligado — e ele pede
            login, porque a cobrança nasce amarrada à conta. */}
        {pixRecorrenteLigado && (
          <a className={styles.btnPix} href={`/pix-recorrente${cupomUrl ? `?cupom=${encodeURIComponent(cupomUrl)}` : ''}`}>
            Prefiro pagar por Pix
          </a>
        )}

        {erro && <p className={styles.erro}>{erro}</p>}

        <p className={styles.rodape}>
          Pagamento processado pela Stripe. Você recebe o acesso por e-mail assim que o pagamento for aprovado.
        </p>
      </div>
    </div>
  );
}
