'use client';

import { useMemo, useState } from 'react';

import { CardBike } from './CardBike.tsx';
import { emReais } from '../config/loja.ts';
import type { Bike } from '../types/bike.ts';

type Ordem = 'menor-preco' | 'maior-preco' | 'a-z';

const ORDENS: Array<{ id: Ordem; rotulo: string }> = [
  { id: 'menor-preco', rotulo: 'Menor preço' },
  { id: 'maior-preco', rotulo: 'Maior preço' },
  { id: 'a-z', rotulo: 'Nome de A a Z' },
];

function Pilula({
  ativo,
  children,
  onClick,
}: {
  ativo: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={
        'toque rounded-full border px-4 text-sm font-medium transition ' +
        (ativo
          ? 'border-acento bg-acento text-black'
          : 'border-borda bg-superficie text-suave hover:border-acento/50 hover:text-texto')
      }
    >
      {children}
    </button>
  );
}

export function Vitrine({
  bikes,
  marcas,
  categorias,
}: {
  bikes: Bike[];
  marcas: Array<{ marca: string; quantidade: number }>;
  categorias: Array<{ categoria: string; quantidade: number }>;
}) {
  const [marca, setMarca] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('menor-preco');

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
    <section id="catalogo" className="mx-auto max-w-6xl px-5 py-16">
      <header className="mb-8 flex flex-col gap-2">
        <p className="text-xs font-semibold tracking-[0.18em] text-acento uppercase">Catálogo</p>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {bikes.length} modelos disponíveis
        </h2>
        <p className="text-suave">
          Escolha a sua, diga como prefere pagar e fale direto com quem vende.
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-4">
        <label className="relative block">
          <span className="sr-only">Buscar por modelo, marca ou código</span>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por modelo, marca ou código"
            className="h-12 w-full rounded-xl border border-borda bg-superficie px-4 text-sm text-texto placeholder:text-suave/70 focus:border-acento focus:outline-none"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Pilula ativo={!marca && !categoria} onClick={() => { setMarca(null); setCategoria(null); }}>
            Todas ({bikes.length})
          </Pilula>
          {categorias.map((c) => (
            <Pilula
              key={c.categoria}
              ativo={categoria === c.categoria}
              onClick={() => setCategoria(categoria === c.categoria ? null : c.categoria)}
            >
              {c.categoria} ({c.quantidade})
            </Pilula>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {marcas.map((m) => (
            <Pilula
              key={m.marca}
              ativo={marca === m.marca}
              onClick={() => setMarca(marca === m.marca ? null : m.marca)}
            >
              {m.marca} ({m.quantidade})
            </Pilula>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borda pt-4">
          <p className="text-sm text-suave">
            {lista.length} {lista.length === 1 ? 'modelo' : 'modelos'}
            {lista.length ? ` · a partir de ${emReais(menor)}` : ''}
          </p>
          <label className="flex items-center gap-2 text-sm text-suave">
            Ordenar
            <select
              value={ordem}
              onChange={(e) => setOrdem(e.target.value as Ordem)}
              className="h-11 rounded-lg border border-borda bg-superficie px-3 text-sm text-texto focus:border-acento focus:outline-none"
            >
              {ORDENS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {lista.length === 0 ? (
        <p className="rounded-2xl border border-borda bg-superficie p-10 text-center text-suave">
          Nenhum modelo com esses filtros. Limpe a busca ou escolha outra marca.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {lista.map((b, i) => (
            <CardBike key={b.id} bike={b} prioridade={i < 3} />
          ))}
        </div>
      )}
    </section>
  );
}
