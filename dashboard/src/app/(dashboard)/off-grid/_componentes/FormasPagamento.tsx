'use client';

import { useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import {
  CARTAO_PRAZOS, TAXA_CARTAO_DEFAULT, ENTRADA_MODOS, MAX_CUSTOM,
  modeloPagamento, dadosFinanciamento, aplicarDadosFinanciamento, hojeIso, type PagamentoEstado, type EntradaModo,
} from '@/lib/offgrid/pagamento';
import FinanciamentoCampos from '@/components/FinanciamentoCampos/FinanciamentoCampos';
import { CampoDinheiro } from './CampoDinheiro';
import { brl, nb } from './util';

const OCULTO = 'R$ •••••';
/** A data de hoje não muda sozinha enquanto a tela está aberta: não há o que assinar. */
const semAssinatura = () => () => {};

/**
 * Formas de pagamento da proposta. O mesmo bloco nos dois modos. As parcelas saem de lib/offgrid/pagamento.ts, a
 * mesma fonte que monta os campos enviados ao servidor, então a prévia e o PDF dão a mesma parcela.
 */
export default function FormasPagamento({
  est, setEst, preco, oculto,
}: {
  est: PagamentoEstado;
  setEst: Dispatch<SetStateAction<PagamentoEstado>>;
  preco: number;
  /** Teste grátis com o kit da casa: os valores ficam escondidos. */
  oculto: boolean;
}) {
  // Data base da 1ª parcela: hoje. Só depois de montar, porque depende do fuso do aparelho.
  const base = useSyncExternalStore(semAssinatura, hojeIso, () => '');
  const m = modeloPagamento(est, preco, base || undefined);
  const mudar = (patch: Partial<PagamentoEstado>) => setEst((p) => ({ ...p, ...patch }));
  const par = (v: number) => (oculto ? OCULTO : brl(v));

  return (
    <section className="og-card og2-pg">
      <h3 className="og2-h3">Formas de pagamento na proposta</h3>
      <p className="og-hint og2-mt0">
        Marque o que vai aparecer para o cliente.{oculto ? ' No teste grátis os valores do kit ficam escondidos.' : ''}
      </p>

      <div className="og2-pgs">
        <div className="og2-pg-bloco">
          <label className="og2-chk og2-chk-t">
            <input type="checkbox" checked={est.vista} onChange={(ev) => mudar({ vista: ev.target.checked })} />
            <span>À vista</span>
          </label>
          <div className="og2-pg-c">
            <label className="og-label" htmlFor="og-vista">Valor à vista (R$)</label>
            {oculto
              ? <input id="og-vista" className="og-input" type="text" disabled value={OCULTO} />
              : <CampoDinheiro id="og-vista" valorBase={m.vista} auto={est.vistaAuto} texto={est.vistaTexto}
                  onTexto={(t) => mudar({ vistaTexto: t, vistaAuto: false })}
                  onRetomarAuto={() => mudar({ vistaAuto: true, vistaTexto: '' })} />}
          </div>
          {!oculto && m.vistaMsg && <p className="og-hint">{m.vistaMsg}</p>}
        </div>

        <div className="og2-pg-bloco">
          <h4>Cartão de crédito <small>Marque os prazos. A parcela já vem com a taxa.</small></h4>
          <div className="og2-pz">
            {CARTAO_PRAZOS.map((n) => (
              <label key={n} className={`og2-pzb ${est.cartao[n] ? 'on' : ''}`}>
                <input type="checkbox" checked={!!est.cartao[n]}
                  onChange={(ev) => mudar({ cartao: { ...est.cartao, [n]: ev.target.checked } })} />
                <span>{n}× de <b>{par(m.cartao[n])}</b><small>taxa {nb(TAXA_CARTAO_DEFAULT[n])}%</small></span>
              </label>
            ))}
          </div>
        </div>

        <div className="og2-pg-bloco">
          <h4>Financiamento <small>Sujeito à aprovação do banco. A carência padrão é de 90 dias.</small></h4>
          {base && (
            <FinanciamentoCampos
              dados={dadosFinanciamento(est)}
              onPatch={(patch) => setEst((p) => ({ ...p, ...aplicarDadosFinanciamento(p, patch) }))}
              investimento={preco}
              baseIso={base}
              classeInput="og-input"
              oculto={oculto}
            />
          )}
          <div className="og2-pg-c">
            <label className="og-label" htmlFor="og-juros">Juros ao mês (%)</label>
            <input id="og-juros" className="og-input" type="text" inputMode="decimal" value={est.juros}
              onChange={(ev) => mudar({ juros: ev.target.value })}
              onBlur={() => { if (!est.juros.trim()) mudar({ juros: '2,2' }); }} />
          </div>
        </div>

        <div className="og2-pg-bloco">
          <label className="og2-chk og2-chk-t">
            <input type="checkbox" checked={est.entrada} onChange={(ev) => mudar({ entrada: ev.target.checked })} />
            <span>Entrada + saldo</span>
          </label>
          <div className="og2-pg-c og2-grid2">
            <div>
              <label className="og-label" htmlFor="og-entrada">Valor da entrada (R$)</label>
              {oculto
                ? <input id="og-entrada" className="og-input" type="text" disabled value={OCULTO} />
                : <CampoDinheiro id="og-entrada" valorBase={m.entrada} auto={est.entradaAuto} texto={est.entradaTexto}
                    onTexto={(t) => mudar({ entradaTexto: t, entradaAuto: false })}
                    onRetomarAuto={() => mudar({ entradaAuto: true, entradaTexto: '' })} />}
            </div>
            <div>
              <label className="og-label" htmlFor="og-entrada-modo">Quando paga o restante</label>
              <select id="og-entrada-modo" className="og-select" value={est.entradaModo}
                onChange={(ev) => mudar({ entradaModo: ev.target.value as EntradaModo })}>
                {ENTRADA_MODOS.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
              </select>
            </div>
            {est.entradaModo === 'dias' && (
              <div>
                <label className="og-label" htmlFor="og-entrada-dias">Quantos dias</label>
                <input id="og-entrada-dias" className="og-input" type="text" inputMode="numeric" value={est.entradaDias}
                  onChange={(ev) => mudar({ entradaDias: ev.target.value.replace(/\D/g, '').slice(0, 3) })} />
              </div>
            )}
          </div>
          {!oculto && m.entradaMsg && <p className="og-hint">{m.entradaMsg}</p>}
        </div>

        <div className="og2-pg-bloco">
          <h4>Outra condição <small>Texto livre, até {MAX_CUSTOM} letras.</small></h4>
          <textarea className="og-input og2-area" rows={2} maxLength={MAX_CUSTOM} value={est.custom}
            aria-label="Outra condição de pagamento" onChange={(ev) => mudar({ custom: ev.target.value })} />
        </div>
      </div>

      <div className="og2-sai" aria-live="polite">
        <b>Na proposta vai sair:</b>
        {oculto
          ? <div>Os valores aparecem depois de liberar o acesso.</div>
          : m.linhas.length
            ? m.linhas.map((l) => <div key={l}>{l}</div>)
            : <div>Nenhuma forma marcada. A proposta sai só com o preço final.</div>}
      </div>
    </section>
  );
}
