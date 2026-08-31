'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { CardBike } from './CardBike.tsx';
import { PERTO_KM } from '../config/frete.ts';
import { emReais } from '../config/loja.ts';
import { useEntrega } from '../lib/cepSalvo.ts';
import { escolherOrigem } from '../lib/origem.ts';
import { aindaVaiChegar } from '../lib/previsao.ts';
import type { Cartao } from '../types/bike.ts';

/** Base do fornecedor, só o que a vitrine precisa para medir distância. */
export type BaseNaVitrine = {
  slug: string;
  cidade: string;
  uf: string;
  lat: number | null;
  lon: number | null;
};

type Ordem = 'menor-preco' | 'maior-preco' | 'a-z';

const ORDENS: Array<{ id: Ordem; rotulo: string }> = [
  { id: 'menor-preco', rotulo: 'Menor preço' },
  { id: 'maior-preco', rotulo: 'Maior preço' },
  { id: 'a-z', rotulo: 'Nome de A a Z' },
];

const FILTROS = ['perto', 'categoria', 'marca', 'cor', 'estoque'] as const;
type Filtro = (typeof FILTROS)[number];

const TITULO: Record<Filtro, string> = {
  perto: 'Entrega',
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
  if (aindaVaiChegar(b.previsao)) return 'Sob encomenda';
  if (typeof b.estoque === 'number' && b.estoque > 0) return 'Em estoque';
  return 'A consultar';
}

function valorDe(b: Cartao, f: Filtro, origens: Map<string, Origem>): string | null {
  if (f === 'perto') {
    const o = origens.get(b.id);
    if (!o) return null;
    return o.km <= PERTO_KM ? 'Sai de perto de você' : 'Vem de outro estado';
  }
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
        className="flex min-h-11 w-full items-center justify-between text-sm font-semibold text-tinta"
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
        <ul className="mt-2 flex flex-col text-sm">
          {itens.map((i) => (
            <li key={i.rotulo}>
              {/* min-h-11: no celular a linha do filtro é alvo de dedo, não de mouse. */}
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-suave">
                <input
                  type="checkbox"
                  checked={ativo === i.rotulo}
                  onChange={() => aoEscolher(ativo === i.rotulo ? null : i.rotulo)}
                  className="size-4 shrink-0 accent-[var(--color-mata)]"
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

export type Origem = { cidade: string; uf: string; km: number; aproximado?: boolean };

export function Vitrine({ bikes, bases }: { bikes: Cartao[]; bases: BaseNaVitrine[] }) {
  const router = useRouter();
  const parametros = useSearchParams();
  const [gaveta, setGaveta] = useState(false);
  const entrega = useEntrega();

  /**
   * De qual base cada bike sai, e a quantos quilômetros. É conta de navegador:
   * com o ponto do cliente e o das 22 bases, medir os 29 modelos custa nada.
   * Buscar isso no servidor seriam 29 pedidos para montar uma listagem.
   */
  const origens = useMemo(() => {
    const m = new Map<string, Origem>();
    if (!entrega) return m;
    for (const bike of bikes) {
      const escolha = escolherOrigem(bases, bike.bases, entrega);
      if (!escolha) continue;
      m.set(bike.id, {
        cidade: escolha.base.cidade,
        uf: escolha.base.uf,
        km: escolha.km,
        aproximado: entrega.aproximado,
      });
    }
    return m;
  }, [bikes, bases, entrega]);

  /**
   * A unidade mais perto de quem está comprando, olhando TODAS as bases.
   *
   * É diferente da origem do card: aquela é a mais perto QUE TEM o modelo. Esta
   * é a casa da pessoa — a que atende a cidade dela — e é a resposta para
   * "qual é a minha unidade?", que é a primeira coisa que se quer saber depois
   * de dizer onde mora.
   */
  const suaUnidade = useMemo(() => {
    if (!entrega) return null;
    return escolherOrigem(bases, [], entrega);
  }, [bases, entrega]);

  const busca = parametros.get('q') ?? '';
  const ordem = (parametros.get('ordem') as Ordem | null) ?? 'menor-preco';
  const escolhido = Object.fromEntries(FILTROS.map((f) => [f, parametros.get(f)])) as Record<
    Filtro,
    string | null
  >;

  // Com a gaveta aberta, a lista atrás não pode rolar junto.
  useEffect(() => {
    if (!gaveta) return;
    const fechar = (e: KeyboardEvent) => e.key === 'Escape' && setGaveta(false);
    document.addEventListener('keydown', fechar);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', fechar);
      document.body.style.overflow = '';
    };
  }, [gaveta]);

  function trocar(chave: string, valor: string | null) {
    const p = new URLSearchParams(parametros.toString());
    if (valor) p.set(chave, valor);
    else p.delete(chave);
    const qs = p.toString();
    router.push(qs ? `/?${qs}` : '/', { scroll: false });
  }

  function limparTudo() {
    router.push('/', { scroll: false });
    setGaveta(false);
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
        if (escolhido[f] && valorDe(b, f, origens) !== escolhido[f]) return false;
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
      FILTROS.map((f) => [
        f,
        contar(bikes.filter((b) => casa(b, f)).map((b) => valorDe(b, f, origens))),
      ]),
    ) as Record<Filtro, Array<{ rotulo: string; quantidade: number }>>;

    return { lista: ordenadas, facetas };
  }, [bikes, busca, ordem, escolhido, origens]);

  const aplicados = FILTROS.filter((f) => escolhido[f]);
  const quantosFiltros = aplicados.length + (busca ? 1 : 0);
  const menor = lista.length ? Math.min(...lista.map((b) => b.preco)) : 0;

  const painel = (
    <>
      {quantosFiltros ? (
        <div className="border-b border-borda p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-tinta">Filtros aplicados</p>
            <button
              type="button"
              onClick={limparTudo}
              className="min-h-11 text-xs text-mata underline underline-offset-2"
            >
              Limpar todos
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {busca ? (
              <button type="button" onClick={() => trocar('q', null)} className="chip min-h-9">
                {busca}
                <span aria-hidden="true">✕</span>
                <span className="sr-only">remover busca</span>
              </button>
            ) : null}
            {aplicados.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => trocar(f, null)}
                className="chip min-h-9"
              >
                {escolhido[f]}
                <span aria-hidden="true">✕</span>
                <span className="sr-only">remover filtro {TITULO[f]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {FILTROS.map((f) => (
        <Secao
          key={f}
          titulo={TITULO[f]}
          itens={facetas[f]}
          ativo={escolhido[f]}
          aoEscolher={(v) => trocar(f, v)}
        />
      ))}
    </>
  );

  return (
    <div className="mx-auto flex max-w-[1240px] gap-5 px-4 py-5 lg:py-6">
      {/* No desktop o filtro é coluna fixa. No celular ele vira gaveta: uma
          coluna de filtros empurraria a vitrine para baixo da dobra. */}
      <aside className="cartao hidden h-fit w-[260px] shrink-0 lg:sticky lg:top-24 lg:block">
        {painel}
      </aside>

      <main className="min-w-0 flex-1">
        {/* Antes da lista: qual é a unidade dela. Dizer só no card, modelo a
            modelo, deixava a pergunta "de onde vocês atendem aqui?" sem
            resposta direta. */}
        {suaUnidade ? (
          <p className="mb-3 rounded-lg bg-fundo px-3 py-2 text-xs text-suave">
            Sua unidade mais próxima:{' '}
            <strong className="font-semibold text-tinta">
              {suaUnidade.base.cidade} — {suaUnidade.base.uf}
            </strong>
            {' · '}
            {entrega?.aproximado ? '≈ ' : ''}
            {suaUnidade.km.toLocaleString('pt-BR')} km de {entrega?.cidade}
          </p>
        ) : null}

        <div className="mb-4 flex items-center justify-between gap-2">
          <p className="text-sm text-suave">
            <strong className="font-semibold text-tinta">{lista.length}</strong>{' '}
            {lista.length === 1 ? 'modelo' : 'modelos'}
            {lista.length ? (
              <span className="hidden sm:inline">
                {' · a partir de '}
                <strong className="tabular font-semibold text-tinta">{emReais(menor)}</strong>
              </span>
            ) : null}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGaveta(true)}
              className="botao-contorno flex min-h-11 items-center gap-2 px-3 text-sm lg:hidden"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 6h16M7 12h10M10 18h4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              Filtrar
              {quantosFiltros ? (
                <span className="rounded-full bg-neon px-1.5 text-[11px] font-bold text-tinta">
                  {quantosFiltros}
                </span>
              ) : null}
            </button>

            <label className="flex items-center gap-2 text-sm text-suave">
              <span className="hidden sm:inline">Ordenar por</span>
              <select
                value={ordem}
                onChange={(e) => trocar('ordem', e.target.value)}
                aria-label="Ordenar por"
                className="h-11 rounded-lg border border-borda-forte bg-white px-2 text-sm font-medium text-tinta focus:border-tinta focus:outline-none"
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
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
            {lista.map((b, i) => (
              <CardBike key={b.id} bike={b} prioridade={i < 4} origem={origens.get(b.id)} />
            ))}
          </div>
        )}
      </main>

      {gaveta ? (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Filtros"
        >
          <button
            type="button"
            aria-label="Fechar filtros"
            onClick={() => setGaveta(false)}
            className="absolute inset-0 bg-tinta/45"
          />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-[340px] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-borda px-4 py-3">
              <p className="text-base font-bold text-tinta">Filtrar</p>
              <button
                type="button"
                onClick={() => setGaveta(false)}
                aria-label="Fechar"
                className="toque -mr-2 size-11 text-2xl text-suave"
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{painel}</div>

            <div className="border-t border-borda p-3">
              <button
                type="button"
                onClick={() => setGaveta(false)}
                className="botao-principal toque w-full text-base"
              >
                Ver {lista.length} {lista.length === 1 ? 'modelo' : 'modelos'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
