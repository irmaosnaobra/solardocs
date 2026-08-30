'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';

import { CardBike } from './CardBike.tsx';
import { emReais } from '../config/loja.ts';
import type { Cartao } from '../types/bike.ts';

type Ordem = 'menor-preco' | 'maior-preco' | 'a-z';

const ORDENS: Array<{ id: Ordem; rotulo: string }> = [
  { id: 'menor-preco', rotulo: 'Menor preço' },
  { id: 'maior-preco', rotulo: 'Maior preço' },
  { id: 'a-z', rotulo: 'Nome de A a Z' },
];

/**
 * Filtro em coluna, do jeito de vitrine de marketplace: cada filtro é um link
 * que troca a URL. Sem estado escondido, então voltar no navegador desfaz o
 * filtro e o resultado pode ser mandado por link para o cliente.
 */
function Faceta({
  titulo,
  itens,
  ativo,
  aoEscolher,
}: {
  titulo: string;
  itens: Array<{ rotulo: string; quantidade: number }>;
  ativo: string | null;
  aoEscolher: (valor: string | null) => void;
}) {
  return (
    <section className="border-b border-borda px-4 py-4 last:border-b-0">
      <h3 className="mb-2 text-sm font-semibold text-texto">{titulo}</h3>
      <ul className="flex flex-col gap-1.5 text-sm">
        {ativo ? (
          <li>
            <button
              type="button"
              onClick={() => aoEscolher(null)}
              className="text-left text-acao hover:underline"
            >
              Limpar {titulo.toLowerCase()}
            </button>
          </li>
        ) : null}
        {itens.map((i) => (
          <li key={i.rotulo}>
            <button
              type="button"
              onClick={() => aoEscolher(i.rotulo)}
              className={
                'text-left hover:text-acao ' +
                (ativo === i.rotulo ? 'font-semibold text-texto' : 'text-suave')
              }
            >
              {i.rotulo} <span className="text-fraco">({i.quantidade})</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Vitrine({
  bikes,
  marcas,
  categorias,
}: {
  bikes: Cartao[];
  marcas: Array<{ marca: string; quantidade: number }>;
  categorias: Array<{ categoria: string; quantidade: number }>;
}) {
  const router = useRouter();
  const parametros = useSearchParams();

  const busca = parametros.get('q') ?? '';
  const marca = parametros.get('marca');
  const categoria = parametros.get('categoria');
  const ordem = (parametros.get('ordem') as Ordem | null) ?? 'menor-preco';

  function trocar(chave: string, valor: string | null) {
    const p = new URLSearchParams(parametros.toString());
    if (valor) p.set(chave, valor);
    else p.delete(chave);
    const qs = p.toString();
    router.push(qs ? `/?${qs}` : '/', { scroll: false });
  }

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtradas = bikes.filter((b) => {
      if (marca && b.marca !== marca) return false;
      if (categoria && b.categoria !== categoria) return false;
      if (!termo) return true;
      return [b.titulo, b.marca, b.codigo, b.linha ?? '', b.cor ?? '']
        .join(' ')
        .toLowerCase()
        .includes(termo);
    });
    const ordenadas = [...filtradas];
    if (ordem === 'menor-preco') ordenadas.sort((a, b) => a.preco - b.preco);
    if (ordem === 'maior-preco') ordenadas.sort((a, b) => b.preco - a.preco);
    if (ordem === 'a-z') ordenadas.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));
    return ordenadas;
  }, [bikes, marca, categoria, busca, ordem]);

  const menor = lista.length ? Math.min(...lista.map((b) => b.preco)) : 0;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-5 lg:flex-row">
      <aside className="cartao h-fit w-full shrink-0 lg:w-[240px]">
        <Faceta
          titulo="Categoria"
          ativo={categoria}
          itens={categorias.map((c) => ({ rotulo: c.categoria, quantidade: c.quantidade }))}
          aoEscolher={(v) => trocar('categoria', v)}
        />
        <Faceta
          titulo="Marca"
          ativo={marca}
          itens={marcas.map((m) => ({ rotulo: m.marca, quantidade: m.quantidade }))}
          aoEscolher={(v) => trocar('marca', v)}
        />
      </aside>

      <main className="min-w-0 flex-1">
        <div className="cartao mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-sm text-suave">
            <strong className="font-semibold text-texto">{lista.length}</strong>{' '}
            {lista.length === 1 ? 'resultado' : 'resultados'}
            {busca ? ` para “${busca}”` : ''}
            {lista.length ? ` · a partir de ${emReais(menor)}` : ''}
          </p>
          <label className="flex items-center gap-2 text-sm text-suave">
            Ordenar por
            <select
              value={ordem}
              onChange={(e) => trocar('ordem', e.target.value)}
              className="h-9 rounded-sm border border-borda-forte bg-white px-2 text-sm text-acao focus:outline-none"
            >
              {ORDENS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>

        {lista.length === 0 ? (
          <p className="cartao p-10 text-center text-sm text-suave">
            Nenhum modelo com esses filtros. Limpe a busca ou escolha outra marca.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {lista.map((b, i) => (
              <CardBike key={b.id} bike={b} prioridade={i < 4} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
