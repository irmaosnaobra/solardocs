'use client';

import { useState } from 'react';

import { BASE_PATH } from '../config/basePath.mjs';
import { emReais } from '../config/loja.ts';
import { formatarCep } from '../config/frete.ts';

type Cotacao = {
  ok: boolean;
  erro?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  bairro?: string | null;
  origem?: { cidade: string; uf: string } | null;
  km?: number | null;
  pesoKg?: number | null;
  valor?: number | null;
  prazoDias?: number | null;
  gratis?: boolean;
};

/**
 * Calcular entrega pelo CEP.
 *
 * O que a loja calcula sozinha aparece sempre: de qual das bases do fornecedor
 * a bike sai mais perto do cliente, quantos quilômetros são e quanto ela pesa.
 * O VALOR só aparece quando a tabela em config/frete.ts estiver preenchida —
 * até lá, a tela diz que combina no atendimento, em vez de mostrar um número de
 * frete que ninguém autorizou.
 *
 * O CEP resolvido vira campo escondido do formulário e viaja junto na mensagem
 * do WhatsApp, que é o que poupa a primeira pergunta do vendedor.
 */
export function Frete({ slug }: { slug: string }) {
  const [cep, setCep] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [r, setR] = useState<Cotacao | null>(null);

  async function consultar() {
    const limpo = cep.replace(/\D/g, '');
    if (limpo.length !== 8) {
      setR({ ok: false, erro: 'Digite os 8 números do CEP.' });
      return;
    }
    setCarregando(true);
    try {
      const resposta = await fetch(
        `${BASE_PATH}/api/cep?cep=${limpo}&bike=${encodeURIComponent(slug)}`,
      );
      setR((await resposta.json()) as Cotacao);
    } catch {
      setR({ ok: false, erro: 'Não consegui consultar agora. Fale com a gente no WhatsApp.' });
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
            // Enter aqui consultaria o CEP e enviaria o formulário junto.
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
          <p className="font-semibold text-tinta">
            {r.cidade} — {r.uf}
            {r.bairro ? <span className="font-normal text-suave"> · {r.bairro}</span> : null}
          </p>

          {r.origem ? (
            <p className="mt-1 text-xs text-suave">
              Sai de {r.origem.cidade} — {r.origem.uf}
              {r.km ? ` · cerca de ${r.km.toLocaleString('pt-BR')} km` : ''}
              {r.pesoKg ? ` · ${r.pesoKg} kg` : ''}
            </p>
          ) : null}

          {r.gratis ? (
            <p className="mt-2 font-semibold text-vantagem">Entrega sem custo</p>
          ) : typeof r.valor === 'number' ? (
            <p className="mt-2 text-tinta">
              Entrega <strong className="tabular">{emReais(r.valor)}</strong>
              {r.prazoDias ? (
                <span className="text-suave"> · cerca de {r.prazoDias} dias</span>
              ) : null}
            </p>
          ) : (
            <p className="mt-2 text-suave">
              O valor da entrega é fechado no atendimento, junto com a forma de pagamento.
            </p>
          )}

          {/* Vai junto na mensagem do WhatsApp: o vendedor já abre a conversa
              sabendo para onde é a entrega e de qual base ela sai. */}
          <input type="hidden" name="cep" value={r.cep ?? ''} />
          <input type="hidden" name="cidade" value={`${r.cidade} - ${r.uf}`} />
          {r.origem ? (
            <input type="hidden" name="origem" value={`${r.origem.cidade} - ${r.origem.uf}`} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
