'use client';

import { useState } from 'react';

import {
  CONSULTORES,
  FORMAS_DE_PAGAMENTO,
  emReais,
  linkWhatsApp,
  type Consultor,
  type FormaDePagamento,
} from '../config/loja.ts';
import type { Bike } from '../types/bike.ts';

const CHAVE_RODIZIO = 'rodizio-consultor';

/**
 * Rodízio simples entre os consultores: cada lead cai em um. O contador fica no
 * navegador de quem visita, então quem volta não cai sempre na mesma pessoa e,
 * no agregado, os atendimentos se dividem.
 */
function proximoConsultor(): Consultor {
  let n = 0;
  try {
    n = Number(localStorage.getItem(CHAVE_RODIZIO) ?? '0') || 0;
    localStorage.setItem(CHAVE_RODIZIO, String(n + 1));
  } catch {
    // Navegador sem armazenamento (aba anônima, bloqueio): sorteia.
    n = Math.floor(Math.random() * CONSULTORES.length);
  }
  return CONSULTORES[n % CONSULTORES.length];
}

export function Fechamento({ bike }: { bike: Bike }) {
  const [pagamento, setPagamento] = useState<FormaDePagamento | null>(null);
  const [consultor, setConsultor] = useState<Consultor | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [url, setUrl] = useState<string | undefined>(undefined);

  // `localStorage` e `location` não existem no servidor, então o consultor e o
  // link da página só são resolvidos quando a pessoa escolhe o pagamento, que
  // é um clique, já no navegador. Assim não há efeito nem risco de hidratação.
  function escolherPagamento(f: FormaDePagamento) {
    setPagamento(f);
    if (!consultor) setConsultor(proximoConsultor());
    setUrl(window.location.href);
  }

  const escolhido = consultor ?? CONSULTORES[0];
  const pronto = pagamento !== null && consultor !== null;

  const link = linkWhatsApp({
    consultor: escolhido,
    titulo: bike.titulo,
    codigo: bike.codigo,
    preco: bike.preco,
    pagamento,
    url,
  });

  return (
    <section className="rounded-2xl border border-borda bg-superficie p-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-suave">à vista</p>
          <p className="text-3xl font-bold tracking-tight">{emReais(bike.preco)}</p>
        </div>
        <p className="text-right text-xs text-suave">
          Código {bike.codigo}
          <br />
          {bike.marca}
        </p>
      </div>

      <fieldset className="mb-5">
        <legend className="mb-3 text-sm font-semibold">Como você prefere pagar?</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FORMAS_DE_PAGAMENTO.map((f) => {
            const ativo = pagamento?.id === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => escolherPagamento(f)}
                aria-pressed={ativo}
                className={
                  'flex min-h-14 flex-col justify-center rounded-xl border px-4 py-2 text-left transition ' +
                  (ativo
                    ? 'border-acento bg-acento/10'
                    : 'border-borda bg-superficie-alta hover:border-acento/50')
                }
              >
                <span className="text-sm font-semibold">{f.rotulo}</span>
                <span className="text-xs text-suave">{f.detalhe}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <a
        href={pronto ? link : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!pronto}
        onClick={(e) => {
          if (!pronto) e.preventDefault();
        }}
        className={
          'toque w-full rounded-xl px-6 text-base font-semibold transition ' +
          (pronto
            ? 'bg-acento text-black hover:bg-acento-escuro'
            : 'cursor-not-allowed bg-superficie-alta text-suave')
        }
      >
        {pronto ? `Falar com ${escolhido.nome} no WhatsApp` : 'Escolha a forma de pagamento'}
      </a>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-suave">
        <p>Você fala direto com o vendedor. Sem cadastro, sem formulário.</p>
        {trocando ? (
          <span className="flex gap-2">
            {CONSULTORES.map((c) => (
              <button
                key={c.apelido}
                type="button"
                onClick={() => {
                  setConsultor(c);
                  setTrocando(false);
                }}
                className="underline underline-offset-4 hover:text-texto"
              >
                {c.nome}
              </button>
            ))}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setTrocando(true)}
            className="underline underline-offset-4 hover:text-texto"
          >
            Falar com outro consultor
          </button>
        )}
      </div>
    </section>
  );
}
