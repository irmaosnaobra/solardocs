import Link from 'next/link';
import styles from './pc.module.css';

// O símbolo: raio branco atravessado por uma haste vertical — energia e cifrão na
// mesma leitura, dentro do token verde. Mesmo desenho de plugcash/brand/*.svg,
// inline pra não custar um request e pra herdar a cor do texto no lockup.
export function Marca({ escuro = false, href = '/plugcash' }: { escuro?: boolean; href?: string }) {
  return (
    <Link href={href} className={styles.logo} aria-label="PlugCash">
      <svg className={styles.logoMark} viewBox="0 0 80 80" aria-hidden="true">
        <rect width="80" height="80" rx="21" fill="#00C853" />
        <rect x="38.5" y="11" width="3.6" height="58" rx="1.8" fill="#FFF" />
        <path d="M45 19 L27 51 L39 51 L36 69 L55 39 L42 39 Z" fill="#FFF" />
      </svg>
      {/* O texto é fonte da página, não vetor: o lockup fica idêntico em qualquer
          ambiente sem depender de fonte instalada. Sobre fundo escuro, "Plug"
          vira branco e "Cash" continua verde — regra da marca. */}
      <span>
        <span style={{ color: escuro ? '#fff' : '#0A0A0A' }}>Plug</span>
        <span className={styles.logoCash}>Cash</span>
      </span>
    </Link>
  );
}

export function Cadeado() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

// Faixa de pré-visualização. Fica no topo, ocupa a largura toda e diz o que está
// vendo — sem ela, dá pra confundir rascunho com o que o cliente vê, e alguém
// aprova uma página achando que já está no ar.
export function FaixaPreview() {
  return (
    <div style={{
      background: '#141414', color: '#fff', padding: '10px 20px', textAlign: 'center',
      fontSize: 13.5, lineHeight: 1.5, borderBottom: '2px solid #00C853',
    }}>
      <strong style={{ color: '#00C853' }}>PRÉ-VISUALIZAÇÃO</strong>
      {' · '}você está vendo conteúdo em rascunho porque é admin. O cliente ainda não vê nada disto.
    </div>
  );
}

export function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00C853"
         strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
