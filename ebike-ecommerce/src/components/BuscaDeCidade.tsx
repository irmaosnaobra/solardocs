'use client';

import { useEffect, useId, useState } from 'react';

import { BASE_PATH } from '../config/basePath.mjs';

export type CidadeAchada = { nome: string; uf: string; lat: number; lon: number };

/**
 * Campo de cidade com sugestão, para quem não sabe o CEP.
 *
 * Um campo só, não estado-e-depois-cidade: dois passos é um clique a mais para
 * a mesma informação, e quem digita "uberl" já disse o estado sem saber.
 *
 * A lista dos 5.571 municípios NÃO vem para o navegador — a busca é uma
 * chamada curta a `/api/cidade`. Aceita "Uberlândia MG" e "Uberlandia/MG", e
 * ignora acento, porque ninguém digita "â" no celular com pressa.
 */
export function BuscaDeCidade({ onEscolher }: { onEscolher: (c: CidadeAchada) => void }) {
  const idCampo = useId();
  const [termo, setTermo] = useState('');
  const [achadas, setAchadas] = useState<CidadeAchada[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const limpo = termo.trim();
    // Sai sem mexer em estado: limpar a lista aqui seria render em cascata. O
    // que esconde resultado velho é a condição de desenho lá embaixo.
    if (limpo.length < 2) return;

    // Espera a pessoa parar de digitar: um pedido por letra seria oito pedidos
    // para escrever "Uberlândia", e o oitavo poderia chegar antes do sétimo.
    const corte = new AbortController();
    const id = setTimeout(() => {
      setBuscando(true);
      fetch(`${BASE_PATH}/api/cidade?q=${encodeURIComponent(limpo)}`, { signal: corte.signal })
        .then((r) => r.json())
        .then((d: { cidades?: CidadeAchada[] }) => setAchadas(d.cidades ?? []))
        .catch(() => {
          /* trocou o termo ou fechou */
        })
        .finally(() => {
          if (!corte.signal.aborted) setBuscando(false);
        });
    }, 250);

    return () => {
      clearTimeout(id);
      corte.abort();
    };
  }, [termo]);

  const curto = termo.trim().length > 0 && termo.trim().length < 2;

  return (
    <div className="mt-4">
      <label className="sr-only" htmlFor={idCampo}>
        Sua cidade
      </label>
      <input
        id={idCampo}
        autoFocus
        type="text"
        autoComplete="address-level2"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        placeholder="Digite sua cidade"
        className="h-12 w-full rounded-lg border border-borda-forte bg-white px-3 text-base text-tinta focus:border-tinta focus:outline-none"
      />

      <div className="mt-2 max-h-64 overflow-y-auto">
        {(termo.trim().length >= 2 ? achadas : []).map((c) => (
          <button
            key={`${c.nome}-${c.uf}`}
            type="button"
            onClick={() => onEscolher(c)}
            className="toque flex w-full items-center justify-between gap-3 border-b border-borda px-1 py-3 text-left text-sm text-tinta last:border-0 hover:bg-fundo"
          >
            <span className="font-medium">{c.nome}</span>
            <span className="text-xs text-suave">{c.uf}</span>
          </button>
        ))}

        {termo.trim().length >= 2 && !achadas.length && !buscando ? (
          <p className="px-1 py-3 text-sm text-suave">
            Não achei essa cidade. Confira a escrita ou use o CEP.
          </p>
        ) : null}
        {curto ? <p className="px-1 py-3 text-xs text-suave">Digite pelo menos 2 letras.</p> : null}
      </div>
    </div>
  );
}
