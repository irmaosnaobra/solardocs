'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Logo } from './Logo.tsx';
import { LOJA } from '../config/loja.ts';

/**
 * Cabeçalho branco e fino, com a marca à esquerda e a busca no meio.
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
    <header className="sticky top-0 z-40 border-b border-borda bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-4 py-3">
        <Link href="/" aria-label={LOJA.nome}>
          <Logo />
        </Link>

        <form onSubmit={buscar} className="relative ml-auto w-full max-w-lg">
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
            className="h-11 w-full rounded-full border border-borda-forte bg-fundo pr-11 pl-4 text-sm text-tinta placeholder:text-fraco focus:border-tinta focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Buscar"
            className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center text-suave hover:text-mata"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </form>

        <p className="hidden shrink-0 text-xs text-suave lg:block">
          Entrega calculada
          <br />
          <strong className="font-semibold text-tinta">pelo seu CEP</strong>
        </p>
      </div>
    </header>
  );
}
