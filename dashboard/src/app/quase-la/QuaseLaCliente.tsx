'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/services/api';
import { getToken } from '@/services/auth';
import { marcarSaidaProCheckout } from '@/lib/saidaCheckout';
import styles from './quase-la.module.css';

// Marca do Pix (Banco Central). Inline em SVG de propósito: e' o simbolo que faz
// a pessoa reconhecer o meio de pagamento antes de ler qualquer palavra, e um
// arquivo externo numa tela de pagamento e' mais uma requisicao que pode falhar
// no 4G da obra — justo na tela que existe pra salvar a venda.
function LogoPix({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" role="img" aria-label="Pix" focusable="false">
      <path
        fill="currentColor"
        d="M242.4 292.5C247.8 287.1 257.1 287.1 262.5 292.5L339.5 369.5C353.7 383.7 372.6 391.5 392.6 391.5H407.7L310.6 488.6C280.3 518.9 231.1 518.9 200.8 488.6L103.4 391.2H112.6C132.6 391.2 151.5 383.4 165.7 369.2L242.4 292.5zM262.5 218.9C256.9 224.3 247.9 224.5 242.4 218.9L165.7 142.2C151.5 128 132.6 120.2 112.6 120.2H103.4L200.8 22.8C231.1-7.6 280.3-7.6 310.6 22.8L407.7 119.9H392.6C372.6 119.9 353.7 127.7 339.5 141.9L262.5 218.9zM112.6 142.7C126.4 142.7 139.1 148.3 149.7 158.1L226.4 234.8C233.6 242 243 245.6 252.5 245.6C261.9 245.6 271.3 242 278.5 234.8L355.5 157.8C365.3 148 378.9 142.4 392.7 142.4H430.3L488.6 200.7C518.9 231 518.9 280.2 488.6 310.5L430.3 368.8H392.6C378.8 368.8 365.2 363.2 355.4 353.4L278.4 276.4C264.4 262.4 240.4 262.4 226.3 276.5L149.6 353.2C139.8 363 126.2 368.6 112.4 368.6H80.7L22.8 310.6C-7.6 280.3-7.6 231.1 22.8 200.8L80.7 142.9H112.6z"
      />
    </svg>
  );
}

export default function QuaseLaCliente() {
  const params = useSearchParams();
  // O cupom continua VIAJANDO pro checkout (quem tinha desconto não pode perder
  // ao voltar), mas some da tela: preço de cartão ao lado do Pix rouba a decisão
  // que esta página existe pra fazer. Quem valida o código é o backend.
  const cupomUrl = (params.get('cupom') || '').trim().toUpperCase();
  const plano = params.get('plano') || 'vip';
  // De onde ele veio: 'conta' = já estava logado (UpgradeModal). Refazer o cartão
  // pelo checkout público criaria um Customer novo na Stripe — a origem conhecida
  // das assinaturas duplicadas. Cada um volta pela porta por onde entrou.
  const via = params.get('via') === 'conta' ? 'conta' : 'lp';

  const [indo, setIndo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Todo Pix é o automático do Asaas, que abre num modal da LP (/?pagar=pix), com as
  // UTMs que esta página já tem. (As UTMs guardadas na sessão a LP lê sozinha.)
  const qsPix = new URLSearchParams();
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = params.get(k);
    if (v) qsPix.set(k, v);
  }
  qsPix.set('pagar', 'pix');
  // Quem já tem conta (via=conta) vai pela tela logada, que amarra a cobrança ao usuário.
  const hrefPix = via === 'conta'
    ? `/pix-recorrente${cupomUrl ? `?cupom=${encodeURIComponent(cupomUrl)}` : ''}`
    : `/?${qsPix.toString()}`;

  async function voltarPraCartao() {
    setIndo(true);
    setErro(null);

    // Sessão vencida: o interceptor do api daria um redirect seco pro login e
    // levaria embora o plano e o cupom que a pessoa estava carregando. Melhor
    // mandar a gente mesmo, com o caminho de volta pra esta tela.
    if (via === 'conta' && !getToken()) {
      const volta = `/quase-la?cancelado=1&via=conta&plano=${encodeURIComponent(plano)}${cupomUrl ? `&cupom=${encodeURIComponent(cupomUrl)}` : ''}`;
      window.location.href = `/auth?mode=login&next=${encodeURIComponent(volta)}`;
      return;
    }

    try {
      const rota = via === 'conta' ? '/payments/create-checkout' : '/payments/public-checkout';
      const { data } = await api.post(rota, {
        plan: plano,
        ...(cupomUrl ? { cupom: cupomUrl } : {}),
      });
      if (data?.url) { marcarSaidaProCheckout(data.cancelUrl); window.location.href = data.url; return; }
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

        {/* PIX, e só ele em destaque. A dor que o Thiago vê no atendimento é gente
            que QUER a plataforma e não tem cartão de crédito: oferecer cartão do
            lado, com preço, rouba a decisão de quem esta tela existe pra salvar. */}
        <div className={styles.blocoPix}>
          <div className={styles.pixTopo}>
            <LogoPix className={styles.pixLogo} />
            <span className={styles.pixNome}>Pix</span>
            <span className={styles.seloPix}>Sem cartão</span>
          </div>

          <p className={styles.pixChamada}>Assine pagando no Pix</p>
          <p className={styles.pixNota}>
            Você autoriza o Pix automático uma vez no app do seu banco, e a mensalidade é debitada
            sozinha. Seu acesso libera assim que o pagamento cair.
          </p>
          <Link className={styles.btnPix} href={hrefPix}>
            <LogoPix className={styles.btnPixLogo} />
            Pagar no Pix automático
          </Link>
        </div>

        {erro && <p className={styles.erro}>{erro}</p>}

        {/* Cartão vira saída discreta: sem caixa, sem preço, sem cupom. Quem quer
            cartão já sabe o que quer e acha um link; quem não tem cartão não
            precisa ver mais uma vez a parede em que acabou de bater. */}
        <button className={styles.voltarCartao} onClick={voltarPraCartao} disabled={indo}>
          {indo ? 'Abrindo pagamento...' : 'Prefiro voltar e pagar no cartão'}
        </button>

        <p className={styles.rodape}>
          Deu algum problema no pagamento? Chama a gente no WhatsApp <strong>(34) 99816-5040</strong> —
          a gente resolve rapidinho.
        </p>
      </div>
    </div>
  );
}
