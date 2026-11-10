'use client';

import Image from 'next/image';
import { Lock, Check } from 'lucide-react';
import { brl } from './util';
import VejaTambem from '@/components/Loja/VejaTambem';

/**
 * Página de venda curta do Off-grid. Aparece no passo 3 para quem ainda não tem o acesso (no lugar do antigo cartão
 * de cadeado) e quando o servidor responde 402 ao gerar a proposta. O texto só promete o que a ferramenta faz.
 */

const FOLHAS = [
  { src: '/off-grid/folha-1.webp', alt: 'Folha 1 da proposta: projeto com placas, inversor, baterias e autonomia', legenda: 'Projeto e autonomia' },
  { src: '/off-grid/folha-3.webp', alt: 'Folha 3 da proposta: investimento e formas de pagamento', legenda: 'Investimento e pagamento' },
  { src: '/off-grid/folha-4.webp', alt: 'Folha 4 da proposta: obras realizadas', legenda: 'Obras realizadas' },
  { src: '/off-grid/folha-proprio-3.webp', alt: 'Folha 3 da proposta com o equipamento do integrador: investimento e formas de pagamento', legenda: 'Com o seu equipamento' },
];

export default function OfertaAddon({
  preco, motivo, abrir,
}: {
  preco: number;
  /** Frase do servidor quando veio de um 402 ao gerar. */
  motivo?: string;
  /** Abre o checkout Pix (CPF, QR e liberação sozinha). O modal mora na página, que não desmonta quando o acesso libera. */
  abrir: (produto: string) => void;
}) {
  return (
    <>
    <section className="og-card og-trancado og2-venda" aria-labelledby="og2-venda-t">
      <div className="og-trancado-selo"><Lock size={13} /> Acesso ao Off-grid</div>
      <h3 id="og2-venda-t">Libere o preço do kit e a proposta pronta</h3>
      {motivo && <p className="og2-venda-motivo" role="alert">{motivo}</p>}
      <p>
        Você já vê o kit e a autonomia de graça. Com o acesso, a ferramenta calcula o preço do kit com frete até o
        CEP da obra e entrega a proposta Off-grid Completa com a sua marca, pronta para mandar ao cliente.
      </p>

      <ul className="og-trancado-lista">
        <li>Preço do kit da casa com frete estimado até o CEP da obra.</li>
        <li>Opção de usar o seu próprio equipamento, com o seu custo, a sua margem e o seu preço final.</li>
        <li>Formas de pagamento da proposta: à vista, cartão, financiamento, entrada e saldo.</li>
        <li>Proposta completa, com a sua logo, a sua cor e as fotos das suas obras, em PDF e em link.</li>
        <li>Comparativo de 10 anos contra puxar rede e contra gerador a diesel.</li>
        <li>Pedido do kit direto pela ferramenta.</li>
      </ul>

      <div className="og2-folhas" aria-label="Folhas da proposta">
        {FOLHAS.map((f) => (
          <figure key={f.src}>
            <Image src={f.src} alt={f.alt} width={800} height={1130} sizes="(max-width: 620px) 45vw, 200px" />
            <figcaption>{f.legenda}</figcaption>
          </figure>
        ))}
      </div>
      <p className="og-hint">Exemplo com dados fictícios.</p>

      <div className="og-trancado-preco">
        <strong>{brl(preco)}</strong>
        <span>um pagamento, sem mensalidade</span>
      </div>
      <ul className="og-trancado-lista">
        <li>Acesso liberado na hora, enquanto sua conta existir.</li>
        <li><strong>Os {brl(preco)} voltam</strong> como desconto no primeiro kit da casa.</li>
        <li>7 dias de garantia.</li>
      </ul>
      <button type="button" className="og-btn og-btn-primary" onClick={() => abrir('offgrid')}>
        <Check size={16} /> Liberar o Off-grid por {brl(preco)}
      </button>
      <p className="og-hint og2-centro">Pague por Pix sem sair desta tela: o acesso libera sozinho.</p>
    </section>
    <VejaTambem atual="offgrid" onLiberar={abrir} />
    </>
  );
}
