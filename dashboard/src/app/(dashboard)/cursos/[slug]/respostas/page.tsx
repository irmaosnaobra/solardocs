'use client';

// Respostas rápidas: o cliente travou a venda, a pessoa digita o que ele disse e
// tem a fala pronta (e a versão de WhatsApp) em dois toques.
// Respeita o mesmo acesso do curso (GET /kit/meu-acesso, decidido pelo servidor).

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Search } from 'lucide-react';
import styles from '../../curso.module.css';
import ObjecaoCartao from '../../_componentes/ObjecaoCartao';
import { Carregando, Bloqueado, ErroCarregar } from '../../_componentes/CursoEstados';
import { useCursoAcesso } from '../../_componentes/useCursoAcesso';
import { getCurso } from '../../_conteudo/cursos.config';
import { OBJECOES, type Objecao } from '../../_conteudo/objecoes';

const SLUG_FECHA_VENDAS = 'kit-fechamento';

/** Minúsculas e sem acento: "preco" acha "preço". */
const normalizar = (s: string): string =>
  [...s.toLowerCase().normalize('NFD')].filter((c) => { const n = c.charCodeAt(0); return n < 768 || n > 879; }).join('');  // tira os acentos (U+0300 a U+036F)

type Item = { o: Objecao; grupoSlug: string; grupo: string; curto: string; busca: string };

export default function RespostasPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const curso = getCurso(slug);
  if (!curso || curso.slug !== SLUG_FECHA_VENDAS) notFound();
  return <Respostas nome={curso.nome} slug={curso.slug} />;
}

function Respostas({ nome, slug }: { nome: string; slug: string }) {
  const { estado, tentarDeNovo } = useCursoAcesso();
  const [texto, setTexto] = useState('');
  const [grupo, setGrupo] = useState<string>('todos');

  // As 32 objeções numa lista só. A busca olha a frase do cliente e o que ele quer dizer.
  const itens = useMemo<Item[]>(
    () => OBJECOES.flatMap((g) => g.itens.map((o) => ({
      o, grupoSlug: g.slug, grupo: g.titulo, curto: g.curto, busca: normalizar(`${o.gatilho} ${o.traducao}`),
    }))),
    [],
  );

  const palavras = normalizar(texto).split(/\s+/).filter(Boolean);
  const visiveis = itens.filter((i) =>
    (grupo === 'todos' || i.grupoSlug === grupo) && palavras.every((p) => i.busca.includes(p)),
  );

  if (estado === 'carregando') return <div className={styles.pagina}><Carregando /></div>;
  if (estado === 'erro') return <div className={styles.pagina}><ErroCarregar aoTentar={tentarDeNovo} /></div>;
  if (estado === 'bloqueado') return <div className={styles.pagina}><Bloqueado nome={nome} /></div>;

  const limpar = () => { setTexto(''); setGrupo('todos'); };

  return (
    <div className={styles.pagina}>
      <Link href={`/cursos/${slug}`} className={styles.voltar}>
        <ChevronLeft size={18} aria-hidden="true" /> {nome}
      </Link>

      <header className={styles.topo}>
        <h1>Respostas rápidas</h1>
        <p>Digite o que o cliente disse e abra a fala pronta.</p>
      </header>

      <div className={styles.busca}>
        <label className={styles.buscaLabel} htmlFor="busca-objecao">O que o cliente disse?</label>
        <div className={styles.buscaCampo}>
          <Search size={18} aria-hidden="true" />
          <input
            id="busca-objecao"
            className={styles.buscaInput}
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Ex.: achei mais barato"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.chips} role="group" aria-label="Filtrar por assunto">
        <button
          type="button"
          className={grupo === 'todos' ? `${styles.chip} ${styles.chipOn}` : styles.chip}
          aria-pressed={grupo === 'todos'}
          onClick={() => setGrupo('todos')}
        >
          Todas
        </button>
        {OBJECOES.map((g) => (
          <button
            key={g.slug}
            type="button"
            className={grupo === g.slug ? `${styles.chip} ${styles.chipOn}` : styles.chip}
            aria-pressed={grupo === g.slug}
            onClick={() => setGrupo(grupo === g.slug ? 'todos' : g.slug)}
          >
            {g.curto}
          </button>
        ))}
      </div>

      <p className={styles.resultadoQtd} aria-live="polite">
        {visiveis.length === 1 ? '1 resposta' : `${visiveis.length} respostas`}
      </p>

      {visiveis.length === 0 ? (
        <div className={styles.vazio}>
          <strong>Não achei essa frase</strong>
          <p>Tente uma palavra só, como &ldquo;preço&rdquo;, &ldquo;pensar&rdquo; ou &ldquo;garantia&rdquo;.</p>
          <button type="button" className={styles.btnSecundario} onClick={limpar}>Ver todas as respostas</button>
        </div>
      ) : (
        <div className={styles.listaCartoes}>
          {visiveis.map((i) => (
            <ObjecaoCartao
              key={i.o.id}
              o={i.o}
              grupo={i.curto}
              licaoHref={`/cursos/${slug}?licao=${encodeURIComponent(`objecoes:${i.grupoSlug}`)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
