'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { getToken } from '@/services/auth';
import { pixRecorrenteLigado, hrefPagarPix } from '@/components/LinkPagarPix/LinkPagarPix';
import styles from './quase-la.module.css';

interface CupomInfo {
  valido: boolean;
  codigo?: string;
  primeiroMes?: number;
  precoCheio?: number;
}

interface PixInfo {
  url: string | null;
  valor: number;
  dias: number;
}

export default function QuaseLaCliente() {
  const params = useSearchParams();
  const cupomUrl = (params.get('cupom') || '').trim().toUpperCase();
  const plano = params.get('plano') || 'vip';
  // De onde ele veio: 'conta' = já estava logado (UpgradeModal). Refazer o cartão
  // pelo checkout público criaria um Customer novo na Stripe — a origem conhecida
  // das assinaturas duplicadas. Cada um volta pela porta por onde entrou.
  const via = params.get('via') === 'conta' ? 'conta' : 'lp';

  const [cupom, setCupom] = useState<CupomInfo | null>(null);
  const [pix, setPix] = useState<PixInfo | null>(null);
  const [conferindo, setConferindo] = useState(true);
  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      api.get(`/payments/cupom/${encodeURIComponent(cupomUrl || '_')}`, { params: { plano } })
        .then(({ data }) => data as CupomInfo).catch(() => ({ valido: false } as CupomInfo)),
      // Trilho de Pix: se não estiver configurado a resposta vem com url null e o
      // botão nem aparece. Botão de pagamento que não leva a lugar nenhum é pior
      // que oferta nenhuma.
      api.get('/payments/pix-checkout')
        .then(({ data }) => data as PixInfo).catch(() => null),
    ]).then(([c, p]) => {
      if (!vivo) return;
      setCupom(c);
      setPix(p);
      setConferindo(false);
    });
    return () => { vivo = false; };
  }, [cupomUrl, plano]);

  const comCupom = !!cupom?.valido;
  const precoCheio = cupom?.precoCheio ?? null;
  const primeiroMes = comCupom ? (cupom?.primeiroMes ?? precoCheio) : precoCheio;

  // Assinatura no Pix (débito autorizado no banco) só serve pra quem TEM conta:
  // a cobrança nasce amarrada ao usuário e a tela /pix-recorrente pede login.
  // Quem veio da LP ainda não tem conta — pra ele o caminho é o Pix avulso, que
  // cria a conta no ato do pagamento. Escada, não beco.
  const recorrenteAqui = pixRecorrenteLigado && via === 'conta';

  async function voltarPraCartao() {
    setIndo(true);
    setErro(null);

    // Sessão vencida: o interceptor do api daria um redirect seco pro login e
    // levaria embora o plano e o cupom que a pessoa estava carregando. Melhor
    // mandar a gente mesmo, com o caminho de volta pra esta tela.
    if (via === 'conta' && !getToken()) {
      const volta = `/quase-la?cancelado=1&via=conta&plano=${encodeURIComponent(plano)}${comCupom ? `&cupom=${encodeURIComponent(cupom?.codigo || '')}` : ''}`;
      window.location.href = `/auth?mode=login&next=${encodeURIComponent(volta)}`;
      return;
    }

    try {
      const rota = via === 'conta' ? '/payments/create-checkout' : '/payments/public-checkout';
      const { data } = await api.post(rota, {
        plan: plano,
        ...(comCupom ? { cupom: cupom?.codigo } : {}),
      });
      if (data?.url) { window.location.href = data.url; return; }
      // O upgrade in-place responde { upgraded: true } sem URL: quem já tinha
      // assinatura viva trocou de plano na hora e não precisa de checkout.
      if (data?.upgraded) { window.location.href = '/documentos?welcome=1'; return; }
      throw new Error('sem url');
    } catch (e) {
      // O create-checkout recusa com motivo ("Você já está nesse plano", quando o
      // pagamento entrou por outro caminho no meio do trajeto). Engolir isso num
      // "tenta de novo" genérico deixaria a pessoa clicando num botão que nunca
      // vai funcionar — e ela já TEM o acesso.
      const motivo = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (motivo && /j[áa] est[áa] nesse plano/i.test(motivo)) {
        window.location.href = '/documentos?welcome=1';
        return;
      }
      setErro(motivo
        ? `${motivo}. Se precisar, chama a gente no WhatsApp (34) 99816-5040.`
        : 'Não consegui reabrir o pagamento. Tenta de novo, ou chama a gente no WhatsApp (34) 99816-5040.');
      setIndo(false);
    }
  }

  return (
    <div className={styles.tela}>
      <div className={styles.card}>
        <div className={styles.marca}>SolarDoc Pro</div>
        <h1 className={styles.titulo}>Não tem cartão? Dá pra entrar no Pix</h1>
        <p className={styles.linhaFina}>
          Seu acesso ainda não foi ativado — e cartão não é o único caminho.
        </p>

        {/* PIX PRIMEIRO (14/08/2026, decisão do Thiago). A dor que ele vê no
            atendimento é gente que QUER a plataforma e não tem cartão de crédito:
            oferecer cartão primeiro pra essa pessoa é repetir a parede em que ela
            acabou de bater. O cartão fica logo abaixo, com o desconto de adesão. */}
        {recorrenteAqui ? (
          // Trilho recorrente ligado e ele tem conta: é o substituto REAL do
          // cartão — autoriza uma vez no app do banco e nunca mais pensa nisso.
          <div className={`${styles.opcao} ${styles.destaque}`}>
            <div className={styles.opcaoTopo}>
              <span className={styles.opcaoNomeForte}>Assinatura no Pix</span>
              <span className={styles.seloPix}>Sem cartão</span>
            </div>
            <p className={styles.opcaoPreco}>
              {conferindo || primeiroMes === null ? '—' : <>R$ {primeiroMes} pra começar</>}
            </p>
            <p className={styles.opcaoNota}>
              Você paga o primeiro mês no Pix e autoriza a renovação no app do seu banco.
              Dos próximos meses em diante é automático — não precisa lembrar de nada.
            </p>
            <a className={styles.btnPix} href={`/pix-recorrente${comCupom ? `?cupom=${encodeURIComponent(cupom?.codigo || '')}` : ''}`}>
              Assinar pagando no Pix
            </a>
          </div>
        ) : pix?.url ? (
          <div className={`${styles.opcao} ${styles.destaque}`}>
            <div className={styles.opcaoTopo}>
              <span className={styles.opcaoNomeForte}>Pagar no Pix</span>
              <span className={styles.seloPix}>Sem cartão</span>
            </div>
            <p className={styles.opcaoPreco}>R$ {pix.valor} <span className={styles.periodo}>por {pix.dias} dias</span></p>
            <p className={styles.opcaoNota}>
              O QR code aparece na hora e <strong>seu acesso libera sozinho</strong> assim que o
              pagamento cai — não precisa mandar comprovante pra ninguém.
            </p>
            <a className={styles.btnPix} href={pix.url}>Pagar no Pix agora</a>
            <p className={styles.opcaoRodape}>
              Antes de vencer a gente te chama no WhatsApp com o link pra renovar em um clique.
            </p>
          </div>
        ) : (
          // TERCEIRO ESTADO — nenhum trilho automático configurado. O bloco de Pix
          // NÃO some: some o automático, não a oferta. Quem chega aqui não tem
          // cartão, e mandar ele embora é perder a venda que a tela existe pra
          // salvar. O WhatsApp é o Pix que funciona hoje (comprovante lido por IA,
          // liberação na hora) — mesmo fallback que o LinkPagarPix já usa nas
          // telas de bloqueio. Quando o link do checkout entrar, este bloco vira
          // automático sozinho, sem deploy do dashboard.
          <div className={`${styles.opcao} ${styles.destaque}`}>
            <div className={styles.opcaoTopo}>
              <span className={styles.opcaoNomeForte}>Pagar no Pix</span>
              <span className={styles.seloPix}>Sem cartão</span>
            </div>
            <p className={styles.opcaoPreco}>Chama a gente</p>
            <p className={styles.opcaoNota}>
              Dá pra entrar pagando no Pix, sem cartão nenhum. Manda uma mensagem que a gente
              te passa o código na hora e libera seu acesso assim que o pagamento cair.
            </p>
            <a className={styles.btnPix} href={hrefPagarPix()} target="_blank" rel="noopener noreferrer">
              Quero pagar no Pix
            </a>
          </div>
        )}

        {/* Cartão em segundo — mas com o desconto na cara, porque quem TEM cartão
            paga bem menos no primeiro mês e precisa ver isso pra escolher. */}
        <div className={styles.opcao}>
          <div className={styles.opcaoTopo}>
            {/* Rótulo curto: "Prefere no cartão?" quebrava em duas linhas a
                414px e encostava no selo do cupom. */}
            <span className={styles.opcaoNome}>Tem cartão?</span>
            {comCupom && <span className={styles.selo}>Cupom {cupom?.codigo}</span>}
          </div>
          <p className={styles.opcaoPreco}>
            {conferindo || primeiroMes === null
              ? '—'
              : comCupom
                ? <>R$ {primeiroMes} <span className={styles.periodo}>no primeiro mês</span> <span className={styles.riscado}>R$ {precoCheio}</span></>
                : <>R$ {precoCheio}<span className={styles.periodo}>/mês</span></>}
          </p>
          <p className={styles.opcaoNota}>
            {comCupom
              ? `Depois R$ ${precoCheio}/mês, no automático. Cancele quando quiser.`
              : 'Cobrança mensal automática. Cancele quando quiser, sem multa.'}
          </p>
          <button className={styles.btnSecundario} onClick={voltarPraCartao} disabled={indo || conferindo}>
            {indo ? 'Abrindo pagamento...' : 'Voltar pro pagamento no cartão'}
          </button>
        </div>

        {erro && <p className={styles.erro}>{erro}</p>}

        <p className={styles.rodape}>
          Deu algum problema no pagamento? Chama a gente no WhatsApp <strong>(34) 99816-5040</strong> —
          a gente resolve rapidinho.
        </p>
      </div>
    </div>
  );
}
