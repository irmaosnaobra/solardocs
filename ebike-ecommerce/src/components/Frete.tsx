'use client';

import { useCallback, useEffect, useState } from 'react';

import { BASE_PATH } from '../config/basePath.mjs';
import { emReais } from '../config/loja.ts';
import { FRETE_MINIMO, PERTO_KM, REAIS_POR_KM, formatarCep } from '../config/frete.ts';
import { useEntrega } from '../lib/cepSalvo.ts';

type Cotacao = {
  ok: boolean;
  erro?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  bairro?: string | null;
  origem?: { cidade: string; uf: string } | null;
  km?: number | null;
  kmIdaEVolta?: number | null;
  rodagem?: number;
  pesoRealKg?: number | null;
  pesoCubadoKg?: number;
  pesoTaxadoKg?: number;
  presumido?: boolean;
  foraDoRaio?: boolean;
  outraBase?: boolean;
  valor?: number | null;
  prazoDias?: number | null;
};

/**
 * Calcular entrega pelo CEP.
 *
 * Mostra o valor e, embaixo, a conta inteira: o mínimo, os quilômetros de ida e
 * volta e quanto custou a rodagem. Cliente que entende a conta discute menos, e
 * vendedor que vê a conta na tela não precisa perguntar nada antes de responder.
 *
 * O CEP resolvido vira campo escondido do formulário e viaja junto na mensagem
 * do WhatsApp, com o valor calculado.
 */
export function Frete({
  bases,
  pesoKg,
  volumeM3,
  categoria,
}: {
  bases: string[];
  pesoKg: number | null;
  volumeM3: number | null;
  categoria: string;
}) {
  const entrega = useEntrega();
  // O campo deriva do CEP já informado no alto da loja. Escrever nele dentro do
  // efeito seria um render a mais e um estado que pode discordar da fonte.
  const [digitado, setDigitado] = useState<string | null>(null);
  const cep = digitado ?? (entrega ? formatarCep(entrega.cep) : '');
  const setCep = setDigitado;
  const [carregando, setCarregando] = useState(false);
  const [r, setR] = useState<Cotacao | null>(null);
  const [aberto, setAberto] = useState(false);

  /**
   * Só busca e devolve. Não mexe em estado — é isso que deixa o efeito abaixo
   * apenas ligar a loja ao serviço, em vez de disparar render em cascata.
   */
  const buscarCotacao = useCallback(
    async (limpo: string, sinal?: AbortSignal): Promise<Cotacao> => {
      const busca = new URLSearchParams({
        cep: limpo,
        bases: bases.join(','),
        categoria,
        ...(pesoKg ? { peso: String(pesoKg) } : {}),
        ...(volumeM3 ? { m3: String(volumeM3) } : {}),
      });
      const resposta = await fetch(`${BASE_PATH}/api/cep?${busca}`, { signal: sinal });
      return (await resposta.json()) as Cotacao;
    },
    [bases, categoria, pesoKg, volumeM3],
  );

  // Quem já disse onde está não digita de novo aqui: a entrega desta bike
  // aparece calculada assim que a página abre.
  useEffect(() => {
    if (!entrega) return;
    const limpo = entrega.cep.replace(/\D/g, '');
    if (limpo.length !== 8) return;

    const corte = new AbortController();
    buscarCotacao(limpo, corte.signal)
      .then((c) => {
        if (!corte.signal.aborted) setR(c);
      })
      .catch(() => {
        /* trocou de CEP ou saiu da página */
      });
    return () => corte.abort();
  }, [entrega, buscarCotacao]);

  async function consultar() {
    const limpo = cep.replace(/\D/g, '');
    if (limpo.length !== 8) {
      setR({ ok: false, erro: 'Digite os 8 números do CEP.' });
      return;
    }
    setCarregando(true);
    try {
      setR(await buscarCotacao(limpo));
    } catch {
      setR({ ok: false, erro: 'Não consegui calcular agora. Fale com a gente no WhatsApp.' });
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="rounded-xl border border-borda bg-fundo/60 p-3">
      <p className="mb-2 text-sm font-semibold text-tinta">Calcular entrega</p>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="cep">
          Seu CEP
        </label>
        <input
          id="cep"
          inputMode="numeric"
          autoComplete="postal-code"
          value={cep}
          onChange={(e) => setCep(formatarCep(e.target.value))}
          onKeyDown={(e) => {
            // Enter aqui calcularia o frete e enviaria o formulário junto.
            if (e.key === 'Enter') {
              e.preventDefault();
              void consultar();
            }
          }}
          placeholder="00000-000"
          maxLength={9}
          className="tabular h-11 w-32 rounded-lg border border-borda-forte bg-white px-3 text-sm text-tinta focus:border-tinta focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void consultar()}
          disabled={carregando}
          className="botao-contorno h-11 px-4 text-sm disabled:opacity-60"
        >
          {carregando ? 'Calculando…' : 'Calcular'}
        </button>
      </div>

      {r && !r.ok ? <p className="mt-2 text-sm text-alerta">{r.erro}</p> : null}

      {r?.ok ? (
        <div className="mt-3 border-t border-borda pt-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold text-tinta">
              {r.cidade} — {r.uf}
            </p>
            {typeof r.valor === 'number' ? (
              <p className="tabular text-lg font-bold text-tinta">{emReais(r.valor)}</p>
            ) : null}
          </div>

          <p className="mt-0.5 text-xs text-suave">
            Sai de {r.origem ? `${r.origem.cidade} — ${r.origem.uf}` : 'Uberlândia'}
            {r.km ? ` · ${r.km.toLocaleString('pt-BR')} km` : ''}
            {r.prazoDias ? ` · cerca de ${r.prazoDias} dias úteis` : ''}
          </p>

          {/* Sem valor na tela, a pessoa merece saber POR QUE. Cidade e
              quilometragem sozinhas, sem preço e sem motivo, é a forma mais
              rápida de perder alguém que estava decidido. */}
          {r.outraBase && (r.km ?? Infinity) <= PERTO_KM ? (
            <p className="mt-1.5 rounded-lg bg-vantagem-clara p-2 text-xs text-tinta">
              <strong className="font-semibold">
                Boa notícia: essa bike já está a {r.km} km de você.
              </strong>{' '}
              Ela sai da unidade de {r.origem?.cidade}, não de Uberlândia — e é essa proximidade que
              deixa o frete nesse valor.
            </p>
          ) : r.foraDoRaio ? (
            <p className="mt-1.5 rounded-lg bg-fundo p-2 text-xs text-tinta">
              Fica longe para a nossa entrega própria. O valor sai no atendimento, junto com a
              melhor transportadora para o seu endereço.
            </p>
          ) : null}

          {typeof r.valor === 'number' ? (
            <>
              <button
                type="button"
                onClick={() => setAberto((a) => !a)}
                aria-expanded={aberto}
                className="mt-2 text-xs text-mata underline underline-offset-2"
              >
                {aberto ? 'Esconder a conta' : 'Como chegamos nesse valor'}
              </button>

              {aberto ? (
                <dl className="mt-2 flex flex-col gap-1 rounded-lg bg-white p-3 text-xs text-suave">
                  <div className="flex justify-between gap-4">
                    <dt>Mínimo (coleta, embalagem e entrega)</dt>
                    <dd className="tabular text-tinta">{emReais(FRETE_MINIMO)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt>
                      Rodagem: {r.kmIdaEVolta?.toLocaleString('pt-BR')} km de ida e volta ×{' '}
                      {emReais(REAIS_POR_KM)}
                    </dt>
                    <dd className="tabular text-tinta">{emReais(r.rodagem ?? 0)}</dd>
                  </div>
                  <div className="mt-1 flex justify-between gap-4 border-t border-borda pt-1 font-semibold">
                    <dt className="text-tinta">Total</dt>
                    <dd className="tabular text-tinta">{emReais(r.valor)}</dd>
                  </div>
                  <p className="mt-1 border-t border-borda pt-1">
                    A entrega é dedicada: o veículo leva a sua bike e volta vazio, por isso a conta
                    é sobre ida e volta.
                    {r.pesoTaxadoKg ? (
                      <>
                        {' '}
                        Peso da carga: {r.pesoTaxadoKg} kg
                        {r.presumido ? ' (estimado)' : ''}.
                      </>
                    ) : null}
                  </p>
                </dl>
              ) : null}
            </>
          ) : null}

          {/* Vai junto na mensagem do WhatsApp: o vendedor já abre a conversa
              sabendo para onde é a entrega e por quanto. */}
          <input type="hidden" name="cep" value={r.cep ?? ''} />
          <input type="hidden" name="cidade" value={`${r.cidade} - ${r.uf}`} />
          {r.origem ? (
            <input
              type="hidden"
              name="origem"
              value={`${r.origem.cidade} - ${r.origem.uf}${r.km ? ` (${r.km} km)` : ''}`}
            />
          ) : null}
          {typeof r.valor === 'number' ? (
            <input type="hidden" name="frete" value={String(r.valor)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
