'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ArrowRight, Repeat, ShoppingBag } from 'lucide-react';
import { useAcessos } from '@/hooks/useAcessos';
import { PRODUTOS_DA_LOJA, estadoLiberado } from '@/lib/loja/catalogo';
import CartaoProduto from '@/components/Loja/CartaoProduto';
import lojaStyles from '@/components/Loja/Loja.module.css';
import { useComprar } from '@/components/CheckoutAdicional/useComprar';
import { CartaoPacote } from '@/components/Loja/Adicional';
import { avulsasAtivas, useAdicionais, useOfertaAdicionais } from '@/lib/loja/adicionais';
import styles from './produtos.module.css';

/**
 * A loja "Para crescer": os 4 produtos que se compram por Pix sem sair do app.
 *
 * Em cima, o que a pessoa AINDA NÃO TEM (é onde ela decide comprar); embaixo, o que já é dela. Quem tem por posse, por
 * assinatura ou pelo plano anual não vê preço nem botão de compra, vê só "Abrir". O estado vem de /produtos/acessos
 * (`useAcessos`) e muda sozinho quando o Pix cai.
 */

/** O que a assinatura entrega ALÉM das ferramentas: senão o cartão parece cobrança repetida. */
const ASSINATURA_EXTRAS = [
  'Gerador de Proposta sem limite mensal',
  'Contrato Solar, Procuração, Recibo, Proposta de Banco e mais 4 documentos',
  'Tudo com a sua logo, sua cor e seus dados',
  'Clientes e terceiros ilimitados, com histórico permanente',
  'As ferramentas marcadas como inclusas, sem comprar uma a uma',
];
/** Com a oferta mensal ligada, nenhuma ferramenta da loja vem na assinatura nova: a última linha sai. */
const ASSINATURA_EXTRAS_MENSAL = ASSINATURA_EXTRAS.slice(0, -1);

export default function LojaPage() {
  const acessosDaConta = useAcessos();
  const { tem, origem, plano, assinante, bastidor } = acessosDaConta;
  const router = useRouter();
  const { abrir, modal } = useComprar();
  const oferta = useOfertaAdicionais();
  const mensal = oferta.ligado;
  const ad = useAdicionais(mensal);
  // Espera a oferta para não piscar o preço de compra única antes do mensal.
  const carregando = acessosDaConta.carregando || oferta.carregando;

  // Lançamento restrito: quem não está na lista não abre a loja nem por URL.
  useEffect(() => {
    if (!carregando && !bastidor) router.replace('/dashboard');
  }, [carregando, bastidor, router]);

  const acessos = { tem, origem, plano, assinante };
  const liberados = carregando ? [] : PRODUTOS_DA_LOJA.filter((p) => tem(p.id));
  const faltam = carregando ? [] : PRODUTOS_DA_LOJA.filter((p) => !tem(p.id));
  // O pacote só faz sentido para quem ainda tem pelo menos duas por levar e não paga o pacote.
  const mostraPacote = mensal && !ad.carregando && faltam.length >= 2
    && !ad.ativos.some((x) => x.id === 'pacote' && !x.cancelado)
    && (ad.podeComprar.length === 0 || ad.podeComprar.includes('pacote'));

  return (
    <div className={styles.loja}>
      <div className={styles.lojaHero}>
        <h1>Para crescer</h1>
        <p>Ferramentas e cursos para o seu negócio de energia solar. Compre sem sair da plataforma, com Pix.</p>
      </div>

      {carregando && (
        <div className={lojaStyles.grade} aria-busy="true" aria-label="Carregando a loja">
          {PRODUTOS_DA_LOJA.map((p) => <div key={p.id} className={lojaStyles.esqueleto} />)}
        </div>
      )}

      {faltam.length > 0 && (
        <section className={styles.lojaSecao} aria-labelledby="loja-faltam">
          <div className={styles.lojaSecaoTopo}>
            <ShoppingBag size={16} aria-hidden="true" />
            <div>
              <h2 id="loja-faltam">O que você ainda não tem</h2>
              <span>
                {mensal
                  ? `Venda Off-Grid, Estoque em Dia, Fecha Vendas e LimpaPro: R$ ${oferta.precos.avulso} por mês cada, ou as 4 por R$ ${oferta.precos.pacoteApp} por mês. Cartão ou Pix. A Precificação segue avulsa, no cartão dela.`
                  : 'Um pagamento por Pix, sem mensalidade. O acesso libera na hora.'}
              </span>
            </div>
          </div>
          {mostraPacote && (
            <div className={styles.lojaPacote}>
              <CartaoPacote
                preco={oferta.precos.pacoteApp}
                avulso={oferta.precos.avulso}
                jaPagaAvulsas={avulsasAtivas(ad.ativos).length > 0}
                onComprar={() => abrir('pacote')}
              />
            </div>
          )}
          <div className={lojaStyles.grade}>
            {faltam.map((p) => <CartaoProduto key={p.id} produto={p} onLiberar={abrir} />)}
          </div>
        </section>
      )}

      {liberados.length > 0 && (
        <section className={styles.lojaSecao} aria-labelledby="loja-liberados">
          <div className={styles.lojaSecaoTopo}>
            <Check size={16} aria-hidden="true" />
            <div>
              <h2 id="loja-liberados">Já liberado</h2>
              <span>Está na sua conta. É só abrir.</span>
            </div>
          </div>
          <div className={lojaStyles.grade}>
            {liberados.map((p) => <CartaoProduto key={p.id} produto={p} liberado={estadoLiberado(p.id, acessos)} />)}
          </div>
        </section>
      )}

      {/* ── A plataforma inteira ── */}
      {!carregando && !assinante && (
        <div className={styles.assinatura}>
          <div>
            <div className={styles.assinaturaSelo}>
              <Repeat size={12} aria-hidden="true" /> Mensalidade, não é compra única
            </div>
            <h2>A plataforma SolarDoc inteira</h2>
            {mensal ? (
              <p>
                O que você comprou antes continua seu. As ferramentas mensais valem enquanto você paga. A assinatura do
                SolarDoc é o outro caminho: paga por mês e usa os documentos sem limite, com a sua marca.
              </p>
            ) : (
              <p>
                As compras acima são suas enquanto a sua conta existir, uma a uma. A assinatura é o outro caminho: paga por
                mês e usa <strong>tudo</strong>, inclusive o que faz o trabalho do dia inteiro, não só as
                ferramentas soltas.
              </p>
            )}
            <ul>
              {(mensal ? ASSINATURA_EXTRAS_MENSAL : ASSINATURA_EXTRAS).map((f) => (
                <li key={f}><Check size={14} aria-hidden="true" /> <span>{f}</span></li>
              ))}
            </ul>
          </div>
          <div className={styles.assinaturaCta}>
            <div className={styles.assinaturaPreco}>
              <strong>R$ 67</strong>
              <span>por mês</span>
            </div>
            <Link href="/minha-conta" className={styles.assinaturaBtn}>
              Ver a assinatura <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <p>Cancela quando quiser. O que você comprou avulso continua seu.</p>
          </div>
        </div>
      )}

      {modal}
    </div>
  );
}
