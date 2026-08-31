'use client';

import { useCallback, useEffect, useState } from 'react';

import { BASE_PATH } from '../config/basePath.mjs';
import { ESTADOS } from '../config/estados.ts';
import { formatarCep } from '../config/frete.ts';
import { jaPulou, pularEntrega, salvarEntrega, useEntrega } from '../lib/cepSalvo.ts';

/**
 * O convite de abertura: "de onde você é?".
 *
 * Duas portas de propósito, porque são duas pessoas diferentes:
 *  - CEP: quem já decidiu comprar. Sai daqui com o frete fechado na tela.
 *  - Estado: quem está olhando. Um toque, sem digitar nada, e a vitrine já
 *    passa a dizer de qual galpão cada bike sai e a quantos quilômetros.
 *
 * A porta do estado é aproximação e a loja fala isso: distância com "≈" e
 * nenhum preço de frete prometido. Prometer valor a partir da capital seria
 * cobrar de Presidente Prudente o frete de São Paulo.
 *
 * Aparece uma vez. Quem responde não vê mais; quem fecha, também não.
 */
export function OndeVoceEsta() {
  const entrega = useEntrega();
  const [visivel, setVisivel] = useState(false);
  const [porEstado, setPorEstado] = useState(false);
  const [cep, setCep] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const dispensar = useCallback(() => {
    setVisivel(false);
    pularEntrega();
  }, []);

  // Só depois da primeira pintura: o convite não pode ser a primeira coisa que
  // a pessoa vê, antes mesmo de entender onde entrou.
  useEffect(() => {
    if (entrega || jaPulou()) return;
    const id = setTimeout(() => setVisivel(true), 700);
    return () => clearTimeout(id);
  }, [entrega]);

  useEffect(() => {
    if (!visivel) return;
    const fechar = (e: KeyboardEvent) => e.key === 'Escape' && dispensar();
    document.addEventListener('keydown', fechar);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', fechar);
      document.body.style.overflow = '';
    };
  }, [visivel, dispensar]);

  async function confirmarCep() {
    const limpo = cep.replace(/\D/g, '');
    if (limpo.length !== 8) {
      setErro('Digite os 8 números do CEP.');
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`${BASE_PATH}/api/cep?cep=${limpo}`);
      const d = (await r.json()) as {
        ok: boolean;
        erro?: string;
        cep?: string;
        cidade?: string;
        uf?: string;
        ponto?: { lat: number; lon: number } | null;
      };
      if (!d.ok || !d.ponto || !d.cidade || !d.uf) {
        setErro(d.erro ?? 'Não encontrei esse CEP.');
        return;
      }
      salvarEntrega({
        cep: d.cep ?? formatarCep(limpo),
        cidade: d.cidade,
        uf: d.uf,
        lat: d.ponto.lat,
        lon: d.ponto.lon,
      });
      setVisivel(false);
    } catch {
      setErro('Não consegui consultar agora.');
    } finally {
      setCarregando(false);
    }
  }

  if (!visivel) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onde-titulo"
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
    >
      <button
        type="button"
        aria-label="Fechar"
        onClick={dispensar}
        className="absolute inset-0 bg-tinta/50"
      />

      <div className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-2xl">
        <h2 id="onde-titulo" className="text-lg leading-tight font-black text-tinta">
          De onde você é?
        </h2>
        <p className="mt-1 text-sm text-suave">
          A gente tem bike em galpão espalhado pelo Brasil. Dizendo onde você está, a loja já mostra
          de qual sai a sua e a quantos quilômetros.
        </p>

        {!porEstado ? (
          <>
            <div className="mt-4 flex gap-2">
              <label className="sr-only" htmlFor="onde-cep">
                Seu CEP
              </label>
              <input
                id="onde-cep"
                autoFocus
                inputMode="numeric"
                autoComplete="postal-code"
                value={cep}
                onChange={(e) => setCep(formatarCep(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void confirmarCep();
                  }
                }}
                placeholder="00000-000"
                maxLength={9}
                className="tabular h-12 min-w-0 flex-1 rounded-lg border border-borda-forte bg-white px-3 text-base text-tinta focus:border-tinta focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void confirmarCep()}
                disabled={carregando}
                className="botao-principal h-12 shrink-0 px-5 disabled:opacity-60"
              >
                {carregando ? '…' : 'Ver'}
              </button>
            </div>
            {erro ? <p className="mt-1.5 text-xs text-alerta">{erro}</p> : null}
            <p className="mt-1.5 text-xs text-vantagem">
              Com o CEP o frete já sai calculado, sem esperar atendimento.
            </p>

            <button
              type="button"
              onClick={() => setPorEstado(true)}
              className="toque mt-3 w-full text-sm font-semibold text-mata underline underline-offset-2"
            >
              Não sei meu CEP — escolher pelo estado
            </button>
          </>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {ESTADOS.map((e) => (
                <button
                  key={e.uf}
                  type="button"
                  title={e.nome}
                  onClick={() => {
                    salvarEntrega({
                      cep: '',
                      cidade: e.capital,
                      uf: e.uf,
                      lat: e.lat,
                      lon: e.lon,
                      aproximado: true,
                    });
                    setVisivel(false);
                  }}
                  className="h-11 rounded-lg border border-borda bg-white text-sm font-semibold text-tinta hover:border-tinta hover:bg-fundo"
                >
                  {e.uf}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-suave">
              Pelo estado a distância é aproximada e o frete não sai fechado. Para o valor exato, é
              o CEP.
            </p>
            <button
              type="button"
              onClick={() => setPorEstado(false)}
              className="toque mt-3 w-full text-sm font-semibold text-mata underline underline-offset-2"
            >
              Voltar e digitar o CEP
            </button>
          </>
        )}

        <button
          type="button"
          onClick={dispensar}
          className="toque mt-4 w-full text-sm text-suave hover:text-tinta"
        >
          Ver a loja primeiro
        </button>
      </div>
    </div>
  );
}
