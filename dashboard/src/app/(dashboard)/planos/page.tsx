'use client';

import styles from './planos.module.css';

const PLANOS = [
  {
    nome: 'FREE',
    preco: '0',
    descricao: 'Para começar a usar',
    recursos: [
      '3 documentos por mês',
      'Modelos prontos inclusos',
      'Cadastro ilimitado de clientes',
      'Exportação em PDF'
    ],
    cta: 'Plano Atual',
    cor: 'gray',
    destaque: false
  },
  {
    nome: 'PRO',
    preco: '27',
    descricao: 'Mais produtividade com IA',
    recursos: [
      '30 documentos por mês',
      'Geração com IA (Claude/GPT-4o)',
      'Todos os tipos de documentos',
      'Suporte prioritário'
    ],
    cta: 'Assinar PRO',
    cor: 'amber',
    destaque: true,
    link: 'https://wa.me/5534988457399?text=Quero%20assinar%20o%20plano%20PRO'
  },
  {
    nome: 'VIP',
    preco: '97',
    descricao: 'Potência máxima ilimitada',
    recursos: [
      'Documentos ILIMITADOS',
      'Geração com IA (Prioridade)',
      'Suporte via WhatsApp',
      'Acesso a novos recursos'
    ],
    cta: 'Assinar VIP',
    cor: 'orange',
    destaque: false,
    link: 'https://wa.me/5534988457399?text=Quero%20assinar%20o%20plano%20VIP'
  }
];

export default function PlanosPage() {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Planos e Preços</h1>
        <p className={styles.subtitle}>Escolha o plano ideal para a escala da sua empresa.</p>
      </div>

      <div className={styles.grid}>
        {PLANOS.map((plano) => (
          <div key={plano.nome} className={`${styles.card} ${plano.destaque ? styles.destaque : ''}`}>
            {plano.destaque && <div className={styles.badge}>Mais Popular</div>}
            <div className={styles.planoNome}>{plano.nome}</div>
            <div className={styles.precoContainer}>
              <span className={styles.moeda}>R$</span>
              <span className={styles.valor}>{plano.preco}</span>
              <span className={styles.periodo}>/mês</span>
            </div>
            <p className={styles.descricao}>{plano.descricao}</p>
            
            <ul className={styles.recursos}>
              {plano.recursos.map((rec) => (
                <li key={rec}><span>✅</span> {rec}</li>
              ))}
            </ul>

            {plano.link ? (
              <a href={plano.link} target="_blank" rel="noopener noreferrer" className={styles.ctaBtn}>
                {plano.cta}
              </a>
            ) : (
              <button className={styles.ctaBtnDisabled} disabled>
                {plano.cta}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
