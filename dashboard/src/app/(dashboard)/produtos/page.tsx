'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Check, Lock, Wrench, GraduationCap, ArrowRight, Repeat } from 'lucide-react';
import { PRODUTOS_LOJA } from '@/lib/produtos';
import { useAcessos } from '@/hooks/useAcessos';
import styles from './produtos.module.css';
import { useRouter } from 'next/navigation';

/**
 * A loja — e a casa de quem comprou avulso.
 *
 * Quem chega pela Kiwify sem assinar aterrissa aqui: em cima, o que ele comprou
 * (pra abrir), embaixo, o resto (pra conhecer). É de propósito que a primeira
 * coisa seja o que ele JÁ TEM — quem acabou de pagar precisa ver a compra, não
 * uma vitrine de coisas trancadas.
 */

/** O que a assinatura entrega ALÉM das ferramentas — senão o card parece cobrança repetida. */
const ASSINATURA_EXTRAS = [
  'Gerador de Proposta sem limite mensal',
  'Contrato Solar, Procuração, Recibo, Proposta de Banco e mais 4 documentos',
  'Tudo com a sua logo, sua cor e seus dados',
  'Clientes e terceiros ilimitados, com histórico permanente',
  'As ferramentas marcadas como inclusas, sem comprar uma a uma',
];

export default function LojaPage() {
  const { carregando, tem, origem, assinante, bastidor } = useAcessos();
  const router = useRouter();
  // Lançamento restrito: quem não está na lista não abre a loja nem por URL.
  useEffect(() => {
    if (!carregando && !bastidor) router.replace('/dashboard');
  }, [carregando, bastidor, router]);
  const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR');

  const meus = carregando ? [] : PRODUTOS_LOJA.filter((p) => tem(p.id));
  const faltam = carregando ? PRODUTOS_LOJA : PRODUTOS_LOJA.filter((p) => !tem(p.id));

  const grupos = [
    { tipo: 'ferramenta' as const, titulo: 'Ferramentas', icone: Wrench,
      desc: 'O que você usa no dia de trabalho — orçar, precificar, dimensionar e controlar.' },
    { tipo: 'curso' as const, titulo: 'Cursos', icone: GraduationCap,
      desc: 'O que fazer com a ferramenta na mão: vender mais e abrir serviço novo.' },
  ];

  const rodapeDoCard = (p: (typeof PRODUTOS_LOJA)[number], liberado: boolean) => {
    const via = origem[p.id];
    if (liberado) {
      return via === 'assinatura' ? 'Incluso na sua assinatura'
        : via === 'cortesia' ? 'Liberado pra você'
        : via === 'admin' ? 'Acesso de administrador'
        : 'Comprado — acesso vitalício';
    }
    return p.naAssinatura
      ? (assinante ? 'Incluso na assinatura' : 'Compra única ou pela assinatura')
      : 'Compra única';
  };

  return (
    <div className={styles.loja}>
      <div className={styles.lojaHero}>
        <h1>Ferramentas e cursos</h1>
        <p>
          Tudo que existe dentro do SolarDoc. Cada um funciona sozinho e é seu pra sempre — ou assine
          e leve o pacote inteiro.
        </p>
      </div>

      {/* ── O que já é dele ── */}
      {meus.length > 0 && (
        <div className={styles.lojaSecao}>
          <div className={styles.lojaSecaoTopo}>
            <Check size={16} />
            <div>
              <h2>Seus produtos</h2>
              <span>Liberados na sua conta. É só abrir.</span>
            </div>
          </div>
          <div className={styles.lojaGrid}>
            {meus.map((p) => (
              <Link key={p.id} href={p.abrirExterno || p.rota} className={`${styles.card} ${styles.cardMeu}`}
                style={{ ['--cor' as string]: p.cor }}
                {...(p.abrirExterno ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
                <div className={styles.cardTopo}>
                  <span className={styles.cardNome}>{p.nome}</span>
                  <span className={styles.cardOk}><Check size={12} /> seu</span>
                </div>
                <p className={styles.cardPromessa}>{p.promessa}</p>
                <div className={styles.cardAbrir}>
                  Abrir <ArrowRight size={14} />
                </div>
                <div className={styles.cardRodape}>{rodapeDoCard(p, true)}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── O que ele ainda pode pegar ── */}
      {grupos.map((g) => {
        const doGrupo = faltam.filter((p) => p.tipo === g.tipo);
        if (!doGrupo.length) return null;
        return (
          <div key={g.tipo} className={styles.lojaSecao}>
            <div className={styles.lojaSecaoTopo}>
              <g.icone size={16} />
              <div>
                <h2>{meus.length > 0 ? `Outras ${g.titulo.toLowerCase()}` : g.titulo}</h2>
                <span>{g.desc}</span>
              </div>
            </div>
            <div className={styles.lojaGrid}>
              {doGrupo.map((p) => (
                <Link key={p.id} href={`/produtos/${p.slug}`} className={styles.card}
                  style={{ ['--cor' as string]: p.cor }}>
                  <div className={styles.cardTopo}>
                    <span className={styles.cardNome}>{p.nome}</span>
                    {!carregando && <span className={styles.cardLock}><Lock size={11} /> {brl(p.preco)}</span>}
                  </div>
                  <p className={styles.cardPromessa}>{p.promessa}</p>
                  <div className={styles.cardRodape}>{rodapeDoCard(p, false)}</div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}

      {/* ── A plataforma inteira ── */}
      {!assinante && (
        <div className={styles.assinatura}>
          <div>
            <div className={styles.assinaturaSelo}>
              <Repeat size={12} /> Mensalidade — não é compra única
            </div>
            <h2>A plataforma SolarDoc inteira</h2>
            <p>
              As compras acima são suas pra sempre, uma a uma. A assinatura é o outro caminho: paga por
              mês e usa <strong>tudo</strong> — inclusive o que faz o trabalho do dia inteiro, não só as
              ferramentas soltas.
            </p>
            <ul>
              {ASSINATURA_EXTRAS.map((f) => (
                <li key={f}><Check size={14} /> <span>{f}</span></li>
              ))}
            </ul>
          </div>
          <div className={styles.assinaturaCta}>
            <div className={styles.assinaturaPreco}>
              <strong>R$ 67</strong>
              <span>por mês</span>
            </div>
            <Link href="/minha-conta" className={styles.assinaturaBtn}>
              Ver a assinatura <ArrowRight size={15} />
            </Link>
            <p>Cancela quando quiser. O que você comprou avulso continua seu.</p>
          </div>
        </div>
      )}
    </div>
  );
}
