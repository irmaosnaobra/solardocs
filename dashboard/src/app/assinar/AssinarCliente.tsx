'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { getCheckoutAttribution, novoIcEventId } from '@/hooks/useLpTracking';
import { pixRecorrenteLigado } from '@/components/LinkPagarPix/LinkPagarPix';
import { marcarSaidaProCheckout } from '@/lib/saidaCheckout';
import { useOfertaAdicionais } from '@/lib/loja/adicionais';
import BumpAdicionais, { valorAdicionais, type Marcados } from './BumpAdicionais';
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

/** O link do Pix recorrente, com o cupom e as ferramentas marcadas. Sem nenhum dos dois, o link de sempre. */
function linkPix(cupom: string, adicionais: Marcados): string {
  const q = new URLSearchParams();
  if (cupom) q.set('cupom', cupom);
  if (adicionais.length) q.set('adicionais', adicionais.join(','));
  const s = q.toString();
  return `/pix-recorrente${s ? `?${s}` : ''}`;
}

export default function AssinarCliente() {
  const params = useSearchParams();
  const cupomUrl = (params.get('cupom') || '').trim().toUpperCase();
  const plano = params.get('plano') || 'vip';

  const [cupom, setCupom] = useState<CupomInfo | null>(null);
  const [conferindo, setConferindo] = useState(true);
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Marcados>([]);

  // Order bump das ferramentas: só com a oferta ligada na api e no plano mensal (o anual não mistura intervalo na
  // mesma assinatura da Stripe). Falha na oferta = desligada, e a tela fica exatamente como era.
  const oferta = useOfertaAdicionais();
  const ehMensal = plano !== 'anual' && plano !== 'vip_anual';
  const comBump = oferta.ligado && ehMensal;
  const escolhidos: Marcados = comBump ? marcados : [];
  const adicionais = valorAdicionais(escolhidos, oferta);
  const temAdicional = escolhidos.length > 0;

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
  // O cupom desconta só o plano. As ferramentas entram cheias desde o primeiro mês.
  const hoje = primeiroMes === null ? null : primeiroMes + adicionais;
  const depois = precoCheio === null ? null : precoCheio + adicionais;

  async function irPraPagamento() {
    setIndo(true);
    setErro(null);
    try {
      // Mesmo id no pixel (eventID) e no servidor (ic_event_id): o Meta conta um InitiateCheckout só.
      const icEventId = novoIcEventId();
      (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq?.(
        'track', 'InitiateCheckout', { value: hoje ?? 0, currency: 'BRL', content_name: 'assinar_link' }, { eventID: icEventId },
      );
      // Esta tela é o destino dos toques (link da Giovanna, recuperação): sem
      // repassar as UTMs da URL, a venda chegava no ledger sem rastro nenhum e
      // o painel só sabia dizer "direto". Mesma função da LP — lê a URL e o que
      // ficou guardado na sessão.
      const { data } = await api.post('/payments/public-checkout', {
        plan: plano,
        ...(comCupom ? { cupom: cupom?.codigo } : {}),
        ...(temAdicional ? { adicionais: escolhidos } : {}),
        ic_event_id: icEventId,
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

        {comBump && <BumpAdicionais oferta={oferta} marcados={marcados} onMudar={setMarcados} />}

        {/* Com o bump na tela, o total e o botão grudam no pé da tela do celular: a pessoa marca as caixas sem
            perder o botão de pagar de vista. */}
        <div className={comBump ? styles.pagar : undefined}>
          {temAdicional && hoje !== null && (
            <div className={styles.total} aria-live="polite">
              {comCupom ? (
                <>
                  <p className={styles.totalLinha}>Hoje você paga <strong>R$ {hoje}.</strong></p>
                  <p className={styles.totalDetalhe}>Depois, R$ {depois} por mês.</p>
                </>
              ) : (
                <>
                  <p className={styles.totalLinha}>Hoje você paga <strong>R$ {hoje} por mês.</strong></p>
                  <p className={styles.totalDetalhe}>R$ {primeiroMes} do plano e R$ {adicionais} das ferramentas.</p>
                </>
              )}
            </div>
          )}

          <button className={styles.btn} onClick={irPraPagamento} disabled={indo || conferindo}>
            {indo ? 'Abrindo pagamento...'
              : temAdicional ? `Assinar por R$ ${hoje}`
              : comCupom ? `Assinar por R$ ${primeiroMes}` : 'Assinar agora'}
          </button>
          {temAdicional && <p className={styles.cancele}>Cancele quando quiser. Você usa até o fim do mês pago.</p>}
        </div>

        {/* O Pix recorrente só aparece quando o trilho está ligado — e ele pede
            login, porque a cobrança nasce amarrada à conta. As ferramentas marcadas vão junto na URL. */}
        {pixRecorrenteLigado && (
          <a className={styles.btnPix} href={linkPix(cupomUrl, escolhidos)}>
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
