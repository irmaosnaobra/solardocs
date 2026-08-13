'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { ArrowLeft, Check, ExternalLink, Lock } from 'lucide-react';
import { produtoPorSlug, checkoutCom } from '@/lib/produtos';
import { useAcessos } from '@/hooks/useAcessos';
import {
  MockupPrecificacao, MockupOffGrid, MockupInventario, MockupCurso,
} from '../_mockups';
import styles from '../produtos.module.css';

/**
 * Mini LP de um produto — a página que o cadeado abre.
 *
 * Ordem proposital: mockup primeiro, texto depois. Integrador não lê promessa,
 * ele mexe. Quem já tem o produto não vê oferta nenhuma: vê o botão de abrir.
 */
export default function ProdutoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const p = produtoPorSlug(slug);
  const { carregando, tem, assinante, email, bastidor } = useAcessos();
  const router = useRouter();
  useEffect(() => {
    if (!carregando && !bastidor) router.replace('/dashboard');
  }, [carregando, bastidor, router]);

  if (!p) return notFound();

  const liberado = tem(p.id);
  const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR');

  const mockup =
    p.mockup === 'precificacao' ? <MockupPrecificacao />
    : p.mockup === 'offgrid' ? <MockupOffGrid />
    : p.mockup === 'inventario' ? <MockupInventario />
    : <MockupCurso cor={p.cor} />;

  return (
    <div className={styles.lp} style={{ ['--cor' as string]: p.cor }}>
      <Link href="/produtos" className={styles.voltar}>
        <ArrowLeft size={15} /> Todas as ferramentas e cursos
      </Link>

      <div className={styles.lpGrid}>
        {/* ── Coluna do texto ── */}
        <div>
          <div className={styles.lpSelo}>
            {p.tipo === 'curso' ? 'Curso' : 'Ferramenta'}
            {p.naAssinatura && ' · incluso na assinatura'}
          </div>
          <h1 className={styles.lpTitulo}>{p.nome}</h1>
          <p className={styles.lpPromessa}>{p.promessa}</p>

          <div className={styles.lpDor}>{p.dorTexto}</div>

          <h2 className={styles.lpH2}>O que você leva</h2>
          <ul className={styles.lpLista}>
            {p.entrega.map((item) => (
              <li key={item}><Check size={15} /> <span>{item}</span></li>
            ))}
          </ul>

          {/* ── Oferta ── */}
          {carregando ? (
            <div className={styles.lpCaixa}><div className={styles.lpSpinner} /></div>
          ) : liberado ? (
            <div className={styles.lpCaixa}>
              <div className={styles.lpJaTem}><Check size={16} /> Você já tem acesso</div>
              {p.abrirExterno ? (
                <a className={styles.lpBtn} href={p.abrirExterno} target="_blank" rel="noopener noreferrer">
                  Abrir {p.nome} <ExternalLink size={15} />
                </a>
              ) : (
                <Link href={p.rota} className={styles.lpBtn}>
                  Abrir {p.nome}
                </Link>
              )}
            </div>
          ) : (
            <div className={styles.lpCaixa}>
              <div className={styles.lpPreco}>
                <strong>{brl(p.preco)}</strong>
                <span>uma vez · acesso enquanto sua conta existir</span>
              </div>
              <a className={styles.lpBtn} href={checkoutCom(p, email)} target="_blank" rel="noopener noreferrer">
                Comprar {p.tipo === 'curso' ? 'o curso' : 'a ferramenta'} <ExternalLink size={15} />
              </a>
              {p.experimentar && (
                <Link href={p.experimentar.rota} className={styles.lpBtnGhost}>
                  {p.experimentar.texto}
                </Link>
              )}
              {p.naAssinatura && !assinante && (
                <p className={styles.lpAssinatura}>
                  Também vem junto com a <Link href="/minha-conta">assinatura do SolarDoc</Link>, com
                  todas as outras ferramentas inclusas.
                </p>
              )}
              <p className={styles.lpDepois}>
                Depois de pagar, atualize esta página — o acesso entra sozinho.
              </p>
            </div>
          )}
        </div>

        {/* ── Coluna do mockup ── */}
        <div className={styles.lpMock}>
          {mockup}
          {!liberado && (
            <div className={styles.lpMockNota}>
              <Lock size={12} /> Prévia da tela real
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
