'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { CardBike } from './CardBike.tsx';
import { emReais } from '../config/loja.ts';
import type { Cartao } from '../types/bike.ts';

type Ordem = 'menor-preco' | 'maior-preco' | 'a-z';

const ORDENS: Array<{ id: Ordem; rotulo: string }> = [
  { id: 'menor-preco', rotulo: 'Menor preço' },
  { id: 'maior-preco', rotulo: 'Maior preço' },
  { id: 'a-z', rotulo: 'Nome de A a Z' },
];

const FILTROS = ['categoria', 'marca', 'cor', 'estoque'] as const;
type Filtro = (typeof FILTROS)[number];

const TITULO: Record<Filtro, string> = {
  categoria: 'Categoria',
  marca: 'Marca',
  cor: 'Cor',
  estoque: 'Disponibilidade',
};

function contar(valores: Array<string | null>): Array<{ rotulo: string; quantidade: number }> {
  const conta = new Map<string, number>();
  for (const v of valores) {
    if (!v) continue;
    conta.set(v, (conta.get(v) ?? 0) + 1);
  }
  return [...conta]
    .map(([rotulo, quantidade]) => ({ rotulo, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

function disponibilidadeDe(b: Cartao): string {
  if (b.previsao) return 'Sob encomenda';
  if (typeof b.estoque === 'number' && b.estoque > 0) return 'Em estoque';
  return 'A consultar';
}

function valorDe(b: Cartao, f: Filtro): string | null {
  if (f === 'categoria') return b.categoria;
  if (f === 'marca') return b.marca;
  if (f === 'cor') return b.cor;
  return disponibilidadeDe(b);
}

function Secao({
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
  const [aberta, setAberta] = useState(true);
  if (!itens.length) return null;

  return (
    <section className="border-b border-borda px-4 py-4 last:border-b-0">
      <button
        type="button"
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        className="flex w-full items-center justify-between text-sm font-semibold text-tinta"
      >
        {titulo}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={aberta ? 'rotate-180 transition' : 'transition'}
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {aberta ? (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {itens.map((i) => (
            <li key={i.rotulo}>
              <label className="flex cursor-pointer items-center gap-2 text-suave hover:text-mata">
                <input
                  type="checkbox"
                  checked={ativo === i.rotulo}
                  onChange={() => aoEscolher(ativo === i.rotulo ? null : i.rotulo)}
                  className="size-4 accent-[var(--color-mata)]"
                />
                <span className={ativo === i.rotulo ? 'font-semibold text-tinta' : ''}>
                  {i.rotulo}
                </span>
                <span className="text-fraco">({i.quantidade})</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function Vitrine({ bikes }: { bikes: Cartao[] }) {
  const router = useRouter();
  const parametros = useSearchParams();

  const busca = parametros.get('q') ?? '';
  const ordem = (parametros.get('ordem') as Ordem | null) ?? 'menor-preco';
  const escolhido = Object.fromEntries(FILTROS.map((f) => [f, parametros.get(f)])) as Record<
    Filtro,
    string | null
  >;

  function trocar(chave: string, valor: string | null) {
    const p = new URLSearchParams(parametros.toString());
    if (valor) p.set(chave, valor);
    else p.delete(chave);
    const qs = p.toString();
    router.push(qs ? `/?${qs}` : '/', { scroll: false });
  }

  function limparTudo() {
    router.push('/', { scroll: false });
  }

  /**
   * Cada faceta conta em cima do resultado dos OUTROS filtros, não do total.
   * Assim o número ao lado de "Konnan" é quantas Konnan restam depois da cor já
   * escolhida, e nunca se clica numa opção que devolve lista vazia.
   */
  const { lista, facetas } = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const casa = (b: Cartao, ignorar?: Filtro) => {
      for (const f of FILTROS) {
        if (f === ignorar) continue;
        if (escolhido[f] && valorDe(b, f) !== escolhido[f]) return false;
      }
      if (!termo) return true;
      return [b.titulo, b.marca, b.codigo, b.linha ?? '', b.cor ?? '']
        .join(' ')
        .toLowerCase()
        .includes(termo);
    };

    const ordenadas = bikes.filter((b) => casa(b));
    if (ordem === 'menor-preco') ordenadas.sort((a, b) => a.preco - b.preco);
    if (ordem === 'maior-preco') ordenadas.sort((a, b) => b.preco - a.preco);
    if (ordem === 'a-z') ordenadas.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));

    const facetas = Object.fromEntries(
      FILTROS.map((f) => [f, contar(bikes.filter((b) => casa(b, f)).map((b) => valorDe(b, f)))]),
    ) as Record<Filtro, Array<{ rotulo: string; quantidade: number }>>;

    return { lista: ordenadas, facetas };
  }, [bikes, busca, ordem, escolhido]);

  const aplicados = FILTROS.filter((f) => escolhido[f]);
  const menor = lista.length ? Math.min(...lista.map((b) => b.preco)) : 0;

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 px-4 py-6 lg:flex-row">
      <aside className="h-fit w-full shrink-0 lg:sticky lg:top-20 lg:w-[260px]">
        {aplicados.length || busca ? (
          <div className="cartao mb-4 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-tinta">
                Filtros aplicados
                <span className="ml-2 rounded-full bg-neon px-1.5 py-0.5 text-[11px] font-bold text-tinta">
                  {aplicados.length + (busca ? 1 : 0)}
                </span>
              </p>
              <button
                type="button"
                onClick={limparTudo}
                className="text-xs text-mata underline underline-offset-2"
              >
                Limpar todos
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {busca ? (
                <button type="button" onClick={() => trocar('q', null)} className="chip">
                  {busca}
                  <span aria-hidden="true">✕</span>
                  <span className="sr-only">remover busca</span>
                </button>
              ) : null}
              {aplicados.map((f) => (
                <button key={f} type="button" onClick={() => trocar(f, null)} className="chip">
                  {escolhido[f]}
                  <span aria-hidden="true">✕</span>
                  <span className="sr-only">remover filtro {TITULO[f]}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="cartao">
          {FILTROS.map((f) => (
            <Secao
              key={f}
              titulo={TITULO[f]}
              itens={facetas[f]}
              ativo={escolhido[f]}
              aoEscolher={(v) => trocar(f, v)}
            />
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-suave">
            <strong className="font-semibold text-tinta">{lista.length}</strong>{' '}
            {lista.length === 1 ? 'modelo' : 'modelos'}
            {lista.length ? (
              <>
                {' · a partir de '}
                <strong className="tabular font-semibold text-tinta">{emReais(menor)}</strong>
              </>
            ) : null}
          </p>
          <label className="flex items-center gap-2 text-sm text-suave">
            Ordenar por
            <select
              value={ordem}
              onChange={(e) => trocar('ordem', e.target.value)}
              className="h-10 rounded-lg border border-borda-forte bg-white px-3 text-sm font-medium text-tinta focus:border-tinta focus:outline-none"
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
          <div className="cartao p-10 text-center">
            <p className="text-sm text-suave">Nenhum modelo com esses filtros.</p>
            <button
              type="button"
              onClick={limparTudo}
              className="botao-contorno toque mt-4 px-5 text-sm"
            >
              Limpar filtros
            </button>
          </div>
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
