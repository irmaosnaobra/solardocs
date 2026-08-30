'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { LOJA } from '../config/loja.ts';

/**
 * Barra amarela com a busca, no formato que todo mundo já sabe usar.
 *
 * A busca escreve na URL (`?q=`) em vez de guardar estado: assim a vitrine lê
 * de um lugar só, o resultado é compartilhável por link e o botão voltar do
 * navegador funciona.
 */
export function Cabecalho() {
  const router = useRouter();
  const parametros = useSearchParams();
  const termo = parametros.get('q') ?? '';

  // Campo NÃO controlado, com `key` amarrada à busca da URL. Guardar o texto em
  // estado exigiria um efeito para sincronizar quando a URL muda por outro
  // caminho (voltar, filtro lateral), e efeito que chama setState é o tipo de
  // código que renderiza duas vezes e pisca.
  function buscar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    router.push(q ? `/?q=${encodeURIComponent(q)}` : '/');
  }

  return (
    <header className="bg-topo">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-6">
        <Link href="/" className="shrink-0 leading-tight">
          <span className="block text-lg font-bold tracking-tight text-texto">
            {LOJA.nomeCurto}
          </span>
          <span className="block text-[11px] text-suave">Mobilidade elétrica</span>
        </Link>

        <form onSubmit={buscar} className="relative flex-1">
          <label className="sr-only" htmlFor="busca">
            Buscar modelo, marca ou código
          </label>
          <input
            id="busca"
            key={termo}
            name="q"
            type="search"
            defaultValue={termo}
            placeholder="Buscar modelo, marca ou código"
            className="h-10 w-full rounded-sm bg-white pr-11 pl-3 text-sm text-texto shadow-sm placeholder:text-fraco focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Buscar"
            className="absolute top-0 right-0 flex h-10 w-10 items-center justify-center text-suave hover:text-texto"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </form>

        <p className="hidden shrink-0 text-xs text-suave sm:block">
          Enviamos para
          <br />
          <strong className="font-semibold text-texto">{LOJA.cidade}</strong>
        </p>
      </div>

      <nav className="bg-topo">
        <div className="mx-auto flex max-w-[1200px] gap-5 overflow-x-auto px-4 pb-2 text-xs text-suave">
          <Link href="/" className="whitespace-nowrap hover:text-texto">
            Todos os modelos
          </Link>
          <Link href="/?categoria=Bicicleta+el%C3%A9trica" className="whitespace-nowrap hover:text-texto">
            Bicicletas
          </Link>
          <Link href="/?categoria=Scooter+el%C3%A9trica" className="whitespace-nowrap hover:text-texto">
            Scooters
          </Link>
        </div>
      </nav>
    </header>
  );
}
