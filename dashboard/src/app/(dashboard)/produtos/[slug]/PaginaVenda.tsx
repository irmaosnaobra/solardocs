'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown } from 'lucide-react';
import { useAcessos } from '@/hooks/useAcessos';
import { brl, estadoLiberado, type ProdutoDaLoja } from '@/lib/loja/catalogo';
import type { PaginaDeVenda } from '@/lib/loja/paginasVenda';
import VejaTambem from '@/components/Loja/VejaTambem';
import { useCheckoutPix } from '@/components/CheckoutPix/useCheckoutPix';
import s from './venda.module.css';

/**
 * A página de venda interna de um produto da loja: o que é, para quem, como funciona, o que resolve, o quadro de preço
 * e as perguntas, com o botão de compra por Pix em três pontos. No fim, "Veja também" com os outros produtos que a
 * pessoa ainda não tem. Quem já tem o produto vê o estado ("Você já tem") e o botão "Abrir", nunca o de compra.
 */
export default function PaginaVenda({ produto: p, pagina: c }: { produto: ProdutoDaLoja; pagina: PaginaDeVenda }) {
  const { carregando, tem, origem, plano, assinante, bastidor } = useAcessos();
  const router = useRouter();
  const { abrir, modal } = useCheckoutPix();

  // Lançamento restrito: sem a loja aberta para a conta, a página não existe nem por URL.
  useEffect(() => {
    if (!carregando && !bastidor) router.replace('/dashboard');
  }, [carregando, bastidor, router]);

  const liberado = carregando ? null : estadoLiberado(p.id, { tem, origem, plano, assinante });
  const Selo = c.iconeSelo;

  /** O botão de compra. Para quem já tem, o estado e o botão "Abrir". Enquanto o servidor não responde, nada de compra. */
  const acao = (grande = true) => {
    if (carregando) return <span className={s.btnEspera} aria-hidden="true" />;
    if (liberado) {
      return (
        <div className={s.jaTem}>
          <span className={s.seloOk}><Check size={14} aria-hidden="true" />{liberado.titulo}</span>
          <Link href={p.rotaAbrir} className={`${s.btn} ${grande ? s.btnGrande : ''} ${s.btnPrim}`}>{p.abrirBotao}</Link>
        </div>
      );
    }
    return (
      <button type="button" className={`${s.btn} ${grande ? s.btnGrande : ''} ${s.btnPrim}`} onClick={() => abrir(p.id)}>
        {c.botao}
      </button>
    );
  };

  return (
    <div className={s.pagina}>
      <Link href="/produtos" className={s.volta}><ArrowLeft size={16} aria-hidden="true" />Voltar para a loja</Link>

      {/* ── Herói ── */}
      <header className={s.heroi}>
        <div className={s.heroiTexto}>
          <span className={s.selo}><Selo size={14} aria-hidden="true" />{c.selo}</span>
          <h1>{c.titulo}</h1>
          <p className={s.sub}>{c.subtitulo}</p>
          <div className={s.cta}>{acao()}</div>
          {!liberado && !carregando && <p className={s.linhaPg}>{c.linhaPagamento}</p>}
          {liberado && <p className={s.linhaPg}>{liberado.texto}</p>}
        </div>
        <div className={`${s.heroiImg} ${c.hero.length > 1 ? s.heroiDupla : ''}`}>
          {c.hero.map((im) => (
            <Image key={im.src} src={im.src} alt={im.alt} width={im.largura} height={im.altura} priority
              sizes="(max-width: 900px) 100vw, 480px" />
          ))}
        </div>
      </header>

      {/* ── Para quem é ── */}
      <section className={s.secao} aria-labelledby="v-quem">
        <h2 id="v-quem">Para quem é</h2>
        <div className={s.cartoes}>
          {c.paraQuem.map((i) => (
            <div key={i.titulo} className={s.mini}>
              <i.icone size={20} aria-hidden="true" />
              <b>{i.titulo}</b>
              <p>{i.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Como funciona ── */}
      <section className={s.secao} aria-labelledby="v-como">
        <h2 id="v-como">Como funciona</h2>
        <div className={s.como}>
          <ol className={s.passos}>
            {c.como.map((x, i) => (
              <li key={x.titulo}>
                <span className={s.num}>{i + 1}</span>
                <div><b>{x.titulo}</b><p>{x.texto}</p></div>
              </li>
            ))}
          </ol>
          <div className={s.comoImg}>
            <Image src={c.comoImagem.src} alt={c.comoImagem.alt} width={c.comoImagem.largura} height={c.comoImagem.altura}
              sizes="(max-width: 900px) 100vw, 420px" />
          </div>
        </div>
      </section>

      {/* ── O que resolve ── */}
      <section className={s.secao} aria-labelledby="v-resolve">
        <h2 id="v-resolve">O que resolve</h2>
        <div className={s.cartoes}>
          {c.resolve.map((i) => (
            <div key={i.titulo} className={s.mini}>
              <i.icone size={20} aria-hidden="true" />
              <b>{i.titulo}</b>
              <p>{i.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Quadro de preço ── */}
      <section className={s.secao} aria-labelledby="v-preco">
        <h2 id="v-preco" className={s.somenteLeitor}>Preço e o que está incluso</h2>
        <div className={s.destaque}>
          <div className={s.destaqueEsq}>
            <p className={s.valor}><small>Um pagamento, sem mensalidade.</small>{brl(p.preco)}</p>
            <div className={s.cta}>{acao()}</div>
          </div>
          <div>
            <ul className={s.incl}>
              {c.quadro.map((x) => <li key={x}><Check size={16} aria-hidden="true" />{x}</li>)}
            </ul>
            <p className={s.rodapeQuadro}>{c.rodapeQuadro}</p>
          </div>
        </div>
      </section>

      {/* ── Perguntas ── */}
      <section className={s.secao} aria-labelledby="v-perguntas">
        <h2 id="v-perguntas">Perguntas</h2>
        <div className={s.faq}>
          {c.perguntas.map((q) => (
            <details key={q.p}>
              <summary>{q.p}<ChevronDown size={18} aria-hidden="true" /></summary>
              <p>{q.r}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Fechamento ── */}
      <div className={s.final}>
        <h2>{c.fechamento}</h2>
        <div className={s.cta}>{acao()}</div>
      </div>

      <VejaTambem atual={p.id} onLiberar={abrir} />
      {modal}
    </div>
  );
}
