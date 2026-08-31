'use client';

import { useState } from 'react';

import { BASE_PATH } from '../config/basePath.mjs';
import { emReais } from '../config/loja.ts';
import { formatarCep } from '../config/frete.ts';

type Resposta = {
  ok: boolean;
  erro?: string;
  cep?: string;
  cidade?: string;
  uf?: string;
  bairro?: string | null;
  rotulo?: string;
  valor?: number | null;
  prazo?: string | null;
};

/**
 * Calcular frete pelo CEP.
 *
 * O que a loja sabe de verdade é PARA ONDE vai: o CEP é resolvido em cidade e
 * UF reais. O VALOR só aparece se estiver preenchido em config/frete.ts; sem
 * isso a tela diz que combina no atendimento, em vez de mostrar um número de
 * frete que ninguém autorizou.
 *
 * O CEP resolvido vira campo escondido do formulário e viaja junto na mensagem
 * do WhatsApp, que é o que poupa a primeira pergunta do vendedor.
 */
export function Frete() {
  const [cep, setCep] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [r, setR] = useState<Resposta | null>(null);

  async function consultar() {
    const limpo = cep.replace(/\D/g, '');
    if (limpo.length !== 8) {
      setR({ ok: false, erro: 'Digite os 8 números do CEP.' });
      return;
    }
    setCarregando(true);
    try {
      const resposta = await fetch(`${BASE_PATH}/api/cep?cep=${limpo}`);
      setR((await resposta.json()) as Resposta);
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
          {carregando ? 'Consultando…' : 'Calcular'}
        </button>
      </div>

      {r && !r.ok ? <p className="mt-2 text-sm text-alerta">{r.erro}</p> : null}

      {r?.ok ? (
        <div className="mt-3 border-t border-borda pt-3 text-sm">
          <p className="font-semibold text-tinta">
            {r.cidade} — {r.uf}
            {r.bairro ? <span className="font-normal text-suave"> · {r.bairro}</span> : null}
          </p>
          {typeof r.valor === 'number' ? (
            <p className="mt-1 text-tinta">
              Entrega{' '}
              <strong className={r.valor === 0 ? 'text-vantagem' : ''}>
                {r.valor === 0 ? 'sem custo' : emReais(r.valor)}
              </strong>
              {r.prazo ? <span className="text-suave"> · {r.prazo}</span> : null}
            </p>
          ) : (
            <p className="mt-1 text-suave">
              {/* A cidade em vez do rótulo da zona: "entregamos em Demais
                  estados" é a frase que denuncia sistema falando com gente. */}
              Entregamos aí. O valor da entrega é combinado no atendimento, junto com a forma de
              pagamento.
            </p>
          )}

          {/* Vai junto na mensagem do WhatsApp: o vendedor já abre a conversa
              sabendo para onde é a entrega. */}
          <input type="hidden" name="cep" value={r.cep ?? ''} />
          <input type="hidden" name="cidade" value={`${r.cidade} - ${r.uf}`} />
        </div>
      ) : null}
    </div>
  );
}
