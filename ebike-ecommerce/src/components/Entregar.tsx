'use client';

import { useId, useState } from 'react';

import { BASE_PATH } from '../config/basePath.mjs';
import { formatarCep } from '../config/frete.ts';
import { salvarEntrega, useEntrega } from '../lib/cepSalvo.ts';

/**
 * "Entregar em" no alto da loja.
 *
 * É o único lugar onde se pergunta de onde a pessoa é, e é UM campo: o CEP.
 * Lista de estado e cidade seria mais clique para menos informação, e ainda por
 * cima não dá coordenada, que é o que permite saber qual base está mais perto.
 *
 * Perguntar aqui, e não só no produto, é o que impede a frustração: a vitrine
 * inteira passa a mostrar de onde cada bike sai antes de a pessoa escolher.
 */
export function Entregar({ compacto = false }: { compacto?: boolean }) {
  const entrega = useEntrega();
  // O componente aparece duas vezes (uma no topo do desktop, outra na linha do
  // celular). Sem id próprio, os dois campos ficam com o MESMO id no HTML, e
  // clicar no rótulo de um foca o outro, que está escondido.
  const idCampo = useId();
  const [aberto, setAberto] = useState(false);
  const [cep, setCep] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function confirmar() {
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
      setAberto(false);
      setCep('');
    } catch {
      setErro('Não consegui consultar agora.');
    } finally {
      setCarregando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className={
          'flex min-h-11 items-center gap-1.5 text-left text-xs text-suave hover:text-tinta ' +
          (compacto ? '' : 'shrink-0')
        }
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        {entrega ? (
          <span>
            {/* Quem escolheu a cidade disse onde ESTÁ; quem deu o CEP disse
                para onde ENTREGAR. São promessas diferentes: só a segunda a
                loja consegue cumprir com valor fechado. */}
            {entrega.aproximado ? 'Você está em' : 'Entregar em'}
            <br />
            <strong className="font-semibold text-tinta">
              {entrega.cidade} — {entrega.uf}
            </strong>
          </span>
        ) : (
          <span className="font-semibold text-tinta underline underline-offset-2">
            Informe seu CEP
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <label className="sr-only" htmlFor={idCampo}>
        Seu CEP
      </label>
      <input
        id={idCampo}
        autoFocus
        inputMode="numeric"
        autoComplete="postal-code"
        value={cep}
        onChange={(e) => setCep(formatarCep(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void confirmar();
          }
          if (e.key === 'Escape') setAberto(false);
        }}
        placeholder="00000-000"
        maxLength={9}
        className="tabular h-11 w-28 rounded-lg border border-borda-forte bg-white px-2.5 text-sm text-tinta focus:border-tinta focus:outline-none"
      />
      <button
        type="button"
        onClick={() => void confirmar()}
        disabled={carregando}
        className="botao-principal h-11 px-3 text-sm disabled:opacity-60"
      >
        {carregando ? '…' : 'OK'}
      </button>
      {erro ? <span className="text-[11px] text-alerta">{erro}</span> : null}
    </div>
  );
}
