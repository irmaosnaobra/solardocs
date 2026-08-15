'use client';

import Link from 'next/link';
import { ArrowLeft, Check, ExternalLink, Lock } from 'lucide-react';
import { checkoutCom, type ProdutoLoja } from '@/lib/produtos';
import {
  MockupPrecificacao, MockupOffGrid, MockupInventario, MockupCurso,
} from './_mockups';
import { DemoOffGrid } from './_demo';
import styles from './produtos.module.css';

/**
 * O CORPO DA PÁGINA DE VENDA — um só, servido em dois lugares.
 *
 * Dentro do app (`/produtos/[slug]`), pra quem já tem conta e clicou no cadeado.
 * E como LP pública (`/lp/[slug]`), pra quem chega de anúncio sem conta nenhuma.
 *
 * Ter dois arquivos com a mesma oferta é o jeito garantido de um mudar e o outro
 * não: o preço sobe num, a promessa muda no outro, e ninguém percebe até um
 * cliente reclamar. É a mesma página nas duas portas.
 */
export function LpConteudo({
  p, liberado, carregando, email, assinante, previa = false, slug, dentroDoApp = true,
}: {
  p: ProdutoLoja;
  liberado: boolean;
  carregando: boolean;
  email: string | null;
  assinante: boolean;
  previa?: boolean;
  slug: string;
  /** No app aparece o "voltar" pra loja; na LP pública, não. */
  dentroDoApp?: boolean;
}) {
  const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR');

  // O endereço que aparece na barra da janela do herói. Produto que mora fora
  // (LimpaPro) mostra o domínio DELE — escrever solardoc.app/produtos/limpapro
  // ali seria mentir sobre onde a pessoa vai usar o que comprou.
  const endereco = p.abrirExterno
    ? p.abrirExterno.replace(/^https?:\/\//, '')
    : 'solardoc.app' + p.rota;

  // O off-grid mostra a DEMONSTRAÇÃO animada — o caminho inteiro, do aparelho
  // marcado até o preço. Os outros seguem no mockup parado enquanto a animação
  // deles não existe; melhor um mockup honesto do que uma animação genérica.
  const mockup =
    p.mockup === 'offgrid' ? <DemoOffGrid />
    : p.mockup === 'precificacao' ? <MockupPrecificacao />
    : p.mockup === 'inventario' ? <MockupInventario />
    : <MockupCurso cor={p.cor} licoes={p.licoes} />;

  return (
    <div className={styles.lp} style={{ ['--cor' as string]: p.cor }}>
      {dentroDoApp && (
        <Link href="/produtos" className={styles.voltar}>
          <ArrowLeft size={15} /> Todas as ferramentas e cursos
        </Link>
      )}

      {previa && (
        <div className={styles.previaAviso}>
          <strong>Prévia da oferta.</strong> É isto que quem <em>não</em> tem a ferramenta vê.
          Você já tem acesso —{' '}
          <Link href={`/lp/${slug}`}>ver como fica pra você</Link>.
        </div>
      )}

      {/* ══ HERÓI, no padrão da home ══
          Centralizado, headline grande com o remate em âmbar, o mockup embaixo
          e o botão. A versão anterior era duas colunas com título de 30px:
          lia como tela de app, não como página de venda. A home usa 68px porque
          quem chega de anúncio decide nos dois primeiros segundos — e o que ele
          lê primeiro tem que ser a promessa, não o nome do produto. */}
      {!dentroDoApp && (
        <div className={styles.heroi}>
          <span className={styles.heroiSelo}>
            <i /> {p.tipo === 'curso' ? 'Curso' : 'Ferramenta'} pra integrador solar
          </span>
          <h1 className={styles.heroiTitulo}>
            {p.headline.antes} <strong>{p.headline.destaque}</strong>
          </h1>
          <p className={styles.heroiSub}>{p.subHeadline}</p>

          {/* A moldura de navegador é o que separa "print do produto" de "mais
              um card da página". A home resolve isso com uma foto de laptop; a
              ferramenta aqui é a tela de verdade, então ela ganha a janela. */}
          <div className={styles.heroiMock}>
            <div className={styles.heroiJanela}>
              <div className={styles.heroiJanelaTopo} aria-hidden>
                <i /><i /><i />
                <span>{endereco}</span>
              </div>
              <div className={styles.heroiJanelaTela}>{mockup}</div>
            </div>
          </div>

          {!liberado && !carregando && (
            <>
              <div className={styles.heroiAcao}>
                <a className={styles.heroiCta} href={checkoutCom(p, email)} target="_blank" rel="noopener noreferrer">
                  Quero {p.tipo === 'curso' ? 'o curso' : 'a ferramenta'} <span>&rarr;</span>
                </a>
                <span className={styles.heroiPreco}>
                  <strong>{brl(p.preco)}</strong> · uma vez
                </span>
              </div>
              <div className={styles.heroiSelos}>
                <span><Check size={14} /> Acesso enquanto sua conta existir</span>
                <span><Check size={14} /> Sem mensalidade</span>
                <span><Check size={14} /> Usa no computador e no celular</span>
              </div>
            </>
          )}

          <div className={styles.heroiQuem}>
            <span className={styles.heroiQuemFotos} aria-hidden>
              <img src="/founder-thiago.webp" width={44} height={44} alt="" loading="lazy" />
              <img src="/founder-diego.webp" width={44} height={44} alt="" loading="lazy" />
            </span>
            <span>
              Feito por <b>Thiago e Diego</b>, integradores solares — nasceu dentro da operação
              deles, não numa startup de software.
            </span>
          </div>
        </div>
      )}

      <div className={dentroDoApp ? styles.lpGrid : `${styles.lpGrid} ${styles.lpGridSolo}`}>
        {/* ── Coluna do texto ── */}
        <div>
          {dentroDoApp && (
            <>
              <div className={styles.lpSelo}>
                {p.tipo === 'curso' ? 'Curso' : 'Ferramenta'}
                {p.naAssinatura && ' · incluso na assinatura'}
              </div>
              <h1 className={styles.lpTitulo}>{p.nome}</h1>
              <p className={styles.lpPromessa}>{p.promessa}</p>
            </>
          )}

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
              {/* Três públicos, três verdades diferentes:
                  · sem conta (veio do anúncio) — a conta NASCE da compra, então
                    o que ele recebe é o e-mail pra criar a senha. Mandar "atualize
                    esta página" faria a pessoa ficar recarregando à toa;
                  · com conta, produto que mora FORA (LimpaPro) — o acesso é na
                    área de membros de lá;
                  · com conta, ferramenta daqui — libera sozinho, é só recarregar. */}
              <p className={styles.lpDepois}>
                {!email
                  ? 'Depois de pagar você recebe um e-mail pra criar sua senha — a conta nasce da compra.'
                  : p.abrirExterno
                    ? 'Depois de pagar, o acesso chega no seu e-mail com o link da área do aluno.'
                    : 'Depois de pagar, atualize esta página — o acesso entra sozinho.'}
              </p>
            </div>
          )}
        </div>

        {/* ── Coluna do mockup ── só dentro do app: na LP pública o mockup já
             abre o herói, e repetir a mesma tela duas vezes na mesma dobra faz
             a página parecer curta de conteúdo. */}
        {dentroDoApp && (
          <div className={styles.lpMock}>
            {mockup}
            {!liberado && (
              <div className={styles.lpMockNota}>
                <Lock size={12} /> Prévia da tela real
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ Daqui pra baixo é PÁGINA DE VENDA, e só aparece pra quem ainda não
             tem. Quem já comprou não precisa ser convencido de novo — pra ele a
             página acaba no botão de abrir. ══ */}
      {!liberado && (
        <>
          {p.numeros && p.numeros.length > 0 && (
            <div className={styles.lpNumeros}>
              {p.numeros.map((n) => (
                <div key={n.rotulo}>
                  <strong>{n.valor}</strong>
                  <span>{n.rotulo}</span>
                </div>
              ))}
            </div>
          )}

          {/* COMO FUNCIONA — antes do "quanto custa".
              A home da SolarDoc abre com "do cliente ao documento em 3 passos"
              pelo mesmo motivo: quem nao entendeu COMO usa nao chega no preco. */}
          {p.comoFunciona && p.comoFunciona.length > 0 && (
            <section className={styles.lpBenefs}>
              <h2 className={styles.lpH2Grande}>Como funciona</h2>
              <div className={styles.lpComo}>
                {p.comoFunciona.map((c, i) => (
                  <div key={c.titulo} className={styles.lpComoItem}>
                    <span className={styles.lpComoN}>{i + 1}</span>
                    <strong>{c.titulo}</strong>
                    <p>{c.texto}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {p.beneficios && p.beneficios.length > 0 && (
            <section className={styles.lpBenefs}>
              <h2 className={styles.lpH2Grande}>O que muda no seu dia</h2>
              <div className={styles.lpBenefGrid}>
                {p.beneficios.map((b, i) => (
                  <div key={b.titulo} className={styles.lpBenef}>
                    <span className={styles.lpBenefN}>{String(i + 1).padStart(2, '0')}</span>
                    <strong>{b.titulo}</strong>
                    <p>{b.texto}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AS OBJEÇÕES, RESPONDIDAS.
              Dúvida que não é respondida aqui vira mensagem no WhatsApp — e
              dúvida que vira mensagem quase nunca vira compra. */}
          {p.faq && p.faq.length > 0 && (
            <section className={styles.lpBenefs}>
              <h2 className={styles.lpH2Grande}>Perguntas que todo mundo faz</h2>
              <div className={styles.lpFaq}>
                {p.faq.map((f) => (
                  <details key={f.p}>
                    <summary>{f.p}</summary>
                    <p>{f.r}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {/* QUEM FEZ. Vale mais numa venda pra quem nunca ouviu falar da gente
              do que qualquer adjetivo sobre a ferramenta: a pessoa esta' dando
              o cartao pra um desconhecido na internet. */}
          <section className={styles.lpQuem}>
            <div className={styles.lpQuemFotos}>
              <img src="/founder-thiago.webp" alt="Thiago" width={64} height={64} />
              <img src="/founder-diego.webp" alt="Diego" width={64} height={64} />
            </div>
            <div>
              <strong>Quem fez</strong>
              <p>
                Somos o Thiago e o Diego, irmãos, do Triângulo Mineiro. Trabalhamos com energia
                solar — e o SolarDoc nasceu de um problema que era nosso: a venda esfriava
                esperando papel. Cada tela desta plataforma passou por uma venda nossa antes de
                virar produto.
              </p>
            </div>
          </section>

          {/* Fechamento: quem rolou até aqui não pode ter que subir de volta
              pra achar o botão. */}
          <div className={styles.lpFechar}>
            <div>
              <strong>{p.nome}</strong>
              <span>{brl(p.preco)} uma vez · acesso enquanto sua conta existir</span>
            </div>
            <a className={styles.lpBtn} href={checkoutCom(p, email)} target="_blank" rel="noopener noreferrer">
              Comprar {p.tipo === 'curso' ? 'o curso' : 'a ferramenta'} <ExternalLink size={15} />
            </a>
          </div>
        </>
      )}
    </div>
  );
}
