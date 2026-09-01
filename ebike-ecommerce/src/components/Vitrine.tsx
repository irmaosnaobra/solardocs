'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { CardBike } from './CardBike.tsx';
import { RAIO_MAXIMO_KM } from '../config/frete.ts';
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

/**
 * UM corte, não dois. Antes a faceta dizia "perto" a 150 km e o card avisava
 * "cotado no atendimento" a 300 km — dois números para a mesma ideia, e a
 * contagem da faceta contradizia o aviso do card. Agora os dois usam o raio da
 * entrega própria, que é o único corte com consequência real: dentro dele sai
 * preço de frete na tela; fora, não sai.
 */
export function temFreteFechado(o: Origem | undefined): boolean {
  return !!o && o.km <= RAIO_MAXIMO_KM;
}

function valorDe(b: Cartao, f: Filtro, origens: Map<string, Origem>): string | null {
  if (f === 'perto') {
    const o = origens.get(b.id);
    if (!o) return null;
    return temFreteFechado(o) ? 'Com frete fechado' : 'Frete cotado no atendimento';
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

export function Vitrine({
  bikes,
  bases,
  conferidoEm,
}: {
  bikes: Cartao[];
  bases: BaseNaVitrine[];
  conferidoEm?: string | null;
}) {
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
   * A unidade mais perto de quem está comprando, contando só as que TÊM BIKE.
   *
   * O "têm bike" não é detalhe: das 22 unidades, 8 estão com zero. Em Recife a
   * mais perto no mapa é Cabo de Santo Agostinho, a 40 km — e sem uma bike
   * dentro. A tela anunciava 40 km e logo abaixo os 46 modelos apareciam com
   * "frete cotado no atendimento", o que lê como defeito. A resposta honesta
   * para Recife é Betim, a 2.160 km, e ela explica os avisos em vez de
   * contradizê-los.
   */
  const suaUnidade = useMemo(() => {
    if (!entrega) return null;
    const comBike = new Set(bikes.flatMap((b) => b.bases));
    return escolherOrigem(
      bases.filter((b) => comBike.has(b.slug)),
      [],
      entrega,
    );
  }, [bases, bikes, entrega]);

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
  /**
   * A vitrine abre mostrando SÓ o que sai com frete fechado para a pessoa.
   *
   * Pedido do Thiago, e a razão é boa: não adianta alguém se apaixonar por uma
   * bike que vem de mil quilômetros e descobrir o frete depois. Aqui o modelo
   * distante nem aparece.
   *
   * Duas travas para isso não virar loja vazia:
   *  - quando NADA cabe no raio (Recife: zero dos 46), mostra tudo e explica.
   *    Vitrine vazia é pior que frete caro — é a loja parecendo quebrada.
   *  - "ver os outros" está sempre na tela. Esconder é padrão, não prisão.
   */
  const semLocal = !entrega;
  const cabemNoFrete = useMemo(
    () => (semLocal ? bikes : bikes.filter((b) => temFreteFechado(origens.get(b.id)))),
    [bikes, origens, semLocal],
  );
  const verTodos = parametros.get('todos') === '1';
  const escondidos = bikes.length - cabemNoFrete.length;
  // Nenhum cabe? Não dá para esconder tudo.
  const filtrando = !semLocal && !verTodos && cabemNoFrete.length > 0;
  const universo = filtrando ? cabemNoFrete : bikes;

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

    const ordenadas = universo.filter((b) => casa(b));
    if (ordem === 'menor-preco') ordenadas.sort((a, b) => a.preco - b.preco);
    if (ordem === 'maior-preco') ordenadas.sort((a, b) => b.preco - a.preco);
    if (ordem === 'a-z') ordenadas.sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt-BR'));

    const facetas = Object.fromEntries(
      FILTROS.map((f) => [
        f,
        contar(universo.filter((b) => casa(b, f)).map((b) => valorDe(b, f, origens))),
      ]),
    ) as Record<Filtro, Array<{ rotulo: string; quantidade: number }>>;

    return { lista: ordenadas, facetas };
  }, [universo, busca, ordem, escolhido, origens]);

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
        {/* O que a loja está escondendo, e como ver. Esconder sem dizer seria
            a pessoa achando que o catálogo é pequeno. */}
        {!semLocal && escondidos > 0 ? (
          <p className="mb-3 rounded-lg bg-fundo px-3 py-2 text-xs text-suave">
            {filtrando ? (
              <>
                Mostrando os modelos que chegam em {entrega?.cidade}{' '}
                <strong className="font-semibold text-tinta">com o frete já fechado</strong>. Outros{' '}
                {escondidos} vêm de longe e o frete sai no atendimento.{' '}
                <button
                  type="button"
                  onClick={() => trocar('todos', '1')}
                  className="font-semibold text-mata underline underline-offset-2"
                >
                  Ver todos os {bikes.length}
                </button>
              </>
            ) : cabemNoFrete.length === 0 ? (
              <>
                Nenhum modelo sai com frete fechado para {entrega?.cidade} — a unidade com estoque
                mais próxima está longe. Você vê o catálogo inteiro, e o frete a gente cota na
                conversa.
              </>
            ) : (
              <>
                Mostrando os {bikes.length} modelos do Brasil, inclusive os que vêm de longe.{' '}
                <button
                  type="button"
                  onClick={() => trocar('todos', null)}
                  className="font-semibold text-mata underline underline-offset-2"
                >
                  Só os com frete fechado
                </button>
              </>
            )}
          </p>
        ) : null}

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
              <CardBike
                key={b.id}
                bike={b}
                prioridade={i < 4}
                origem={origens.get(b.id)}
                conferidoEm={conferidoEm}
              />
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
