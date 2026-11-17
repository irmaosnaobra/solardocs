import styles from './parceiro-nexus.module.css';

/** Origens que o portal conhece e que chegam por aqui (o resto vira `solardoc`). */
const ORIGENS = new Set(['solardoc', 'solardoc_banner']);

/**
 * Parceiro NEXUS dentro da SolarDoc: o portal estático (/nexus/app) em iframe, no modo embutido.
 *
 * `?embed=1` tira o menu lateral e as barras do portal e põe uma barra curta de abas no topo (Trilha ou Início,
 * Propostas, Loja, Histórico, Perfil). A origem é a mesma, então o login da SolarDoc vale lá dentro sem pedir de novo.
 * O iframe ocupa toda a área de conteúdo e quem rola é ele: a página não ganha uma segunda barra de rolagem.
 * `?o=` passa a origem adiante (o convite do NexusBanner manda `solardoc_banner`). O caminho leva o index.html
 * explícito porque o servidor de desenvolvimento do Next não serve a pasta sem ele (na Vercel os dois funcionam).
 * O `/nexus/app` sozinho continua no ar (o quiz do eletroposto manda para `/nexus/app?o=quiz_eletroposto#cadastro`).
 */
export default async function ParceiroNexusPage({ searchParams }: { searchParams: Promise<{ o?: string | string[] }> }) {
  const { o } = await searchParams;
  const origem = typeof o === 'string' && ORIGENS.has(o) ? o : 'solardoc';
  return (
    <div className={styles.moldura}>
      <iframe
        className={styles.quadro}
        src={`/nexus/app/index.html?embed=1&o=${origem}`}
        title="Parceiro NEXUS"
        allow="clipboard-write"
      />
    </div>
  );
}
