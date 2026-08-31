'use client';

import { useState } from 'react';

import { BASE_PATH } from '../config/basePath.mjs';
import { emReais } from '../config/loja.ts';
import { FRETE_MINIMO, formatarCep } from '../config/frete.ts';

type Cotacao = {
  ok: boolean;
  erro?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  bairro?: string | null;
  origem?: { cidade: string; uf: string } | null;
  km?: number | null;
  pesoRealKg?: number | null;
  pesoCubadoKg?: number;
  pesoTaxadoKg?: number;
  presumido?: boolean;
  fretePeso?: number;
  freteValor?: number;
  noPiso?: boolean;
  valor?: number;
  prazoDias?: number | null;
};

/**
 * Calcular entrega pelo CEP.
 *
 * Mostra o valor e, embaixo, DE ONDE ele sai: a base que despacha, os
 * quilômetros e o peso que foi cobrado. Cliente que entende a conta discute
 * menos, e vendedor que vê a conta na tela não precisa perguntar nada antes de
 * responder.
 *
 * O CEP resolvido vira campo escondido do formulário e viaja junto na mensagem
 * do WhatsApp, com o valor calculado.
 */
export function Frete({
  bases,
  pesoKg,
  volumeM3,
  categoria,
  preco,
}: {
  bases: string[];
  pesoKg: number | null;
  volumeM3: number | null;
  categoria: string;
  preco: number;
}) {
  const [cep, setCep] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [r, setR] = useState<Cotacao | null>(null);
  const [aberto, setAberto] = useState(false);

  async function consultar() {
    const limpo = cep.replace(/\D/g, '');
    if (limpo.length !== 8) {
      setR({ ok: false, erro: 'Digite os 8 números do CEP.' });
      return;
    }
    setCarregando(true);
    try {
      const busca = new URLSearchParams({
        cep: limpo,
        bases: bases.join(','),
        preco: String(preco),
        categoria,
        ...(pesoKg ? { peso: String(pesoKg) } : {}),
        ...(volumeM3 ? { m3: String(volumeM3) } : {}),
      });
      const resposta = await fetch(`${BASE_PATH}/api/cep?${busca}`);
      setR((await resposta.json()) as Cotacao);
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
          className="tabular h-11 w-32 rounded-lg border border-borda-forte bg-white px-3 text-sm text-tinta focus:border-acao focus:outline-none"
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
            <p className="tabular text-lg font-bold text-tinta">{emReais(r.valor ?? 0)}</p>
          </div>

          <p className="mt-0.5 text-xs text-suave">
            {r.origem ? `Sai de ${r.origem.cidade} — ${r.origem.uf}` : 'Origem a confirmar'}
            {r.km ? ` · ${r.km.toLocaleString('pt-BR')} km` : ''}
            {r.prazoDias ? ` · cerca de ${r.prazoDias} dias úteis` : ''}
          </p>

          <button
            type="button"
            onClick={() => setAberto((a) => !a)}
            aria-expanded={aberto}
            className="mt-2 text-xs text-acao underline underline-offset-2"
          >
            {aberto ? 'Esconder a conta' : 'Como chegamos nesse valor'}
          </button>

          {aberto ? (
            <dl className="mt-2 flex flex-col gap-1 rounded-lg bg-white p-3 text-xs text-suave">
              <div className="flex justify-between gap-4">
                <dt>
                  Peso cobrado
                  {r.presumido ? <span className="text-alerta"> (estimado)</span> : null}
                </dt>
                <dd className="tabular text-tinta">{r.pesoTaxadoKg} kg</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>
                  Balança {r.pesoRealKg ?? '—'} kg · cubagem {r.pesoCubadoKg} kg
                </dt>
                <dd>cobra-se o maior</dd>
              </div>
              <div className="mt-1 flex justify-between gap-4 border-t border-borda pt-1">
                <dt>Frete-peso{r.km ? ` (${r.km.toLocaleString('pt-BR')} km)` : ''}</dt>
                <dd className="tabular text-tinta">{emReais(r.fretePeso ?? 0)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Ad valorem (seguro da carga)</dt>
                <dd className="tabular text-tinta">{emReais(r.freteValor ?? 0)}</dd>
              </div>
              {r.noPiso ? (
                <p className="mt-1 border-t border-borda pt-1 text-tinta">
                  A soma ficou abaixo do mínimo de {emReais(FRETE_MINIMO)}, então vale o mínimo. É
                  ele que cobre coleta, despacho e entrega.
                </p>
              ) : null}
            </dl>
          ) : null}

          {/* Vai junto na mensagem do WhatsApp: o vendedor já abre a conversa
              sabendo para onde é a entrega, de qual base sai e por quanto. */}
          <input type="hidden" name="cep" value={r.cep ?? ''} />
          <input type="hidden" name="cidade" value={`${r.cidade} - ${r.uf}`} />
          <input type="hidden" name="frete" value={String(r.valor ?? '')} />
          {r.origem ? (
            <input type="hidden" name="origem" value={`${r.origem.cidade} - ${r.origem.uf}`} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
