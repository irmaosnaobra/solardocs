'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import {
  MAX_ITENS, ROTULO_SPEC, itemVazio, totalDoItem, precoSugerido,
  type ItemProprio, type Conferencia,
} from '@/lib/offgrid/meuEquipamento';
import { lerDinheiro, lerNumero, formatarDinheiro, formatarNumero } from '@/lib/offgrid/dinheiro';
import { CampoDinheiro } from './CampoDinheiro';
import { brl, nb } from './util';

/**
 * Passo 3, modo "Meu equipamento": o integrador lança os itens dele. O preço digitado aqui é dele e só aparece nesta
 * tela. Na proposta as linhas saem sem preço.
 */
export default function MeuEquipamento({
  itens, efetivos, setItens, conf, custo, preco, pfAuto, pfTexto, setPf,
}: {
  itens: ItemProprio[];
  /** Os mesmos itens, com quantidade e especificação sugeridas preenchidas onde a pessoa não digitou. */
  efetivos: ItemProprio[];
  setItens: Dispatch<SetStateAction<ItemProprio[]>>;
  conf: Conferencia | null;
  custo: number;
  preco: number;
  pfAuto: boolean;
  pfTexto: string;
  setPf: (v: { auto: boolean; texto: string }) => void;
}) {
  const mudar = (id: string, patch: Partial<ItemProprio>) =>
    setItens((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const remover = (id: string) => setItens((prev) => prev.filter((i) => i.id !== id || i.tec));
  const efetivo = (id: string) => efetivos.find((i) => i.id === id);

  const linha = (it: ItemProprio) => {
    const ef = efetivo(it.id) ?? it;
    const tec = !!it.tec;
    return (
      <div className="og2-it" key={it.id}>
        <div className="og2-it-main">
          <label className="og2-it-nome">
            <span>Descrição</span>
            <input className="og-input" type="text" maxLength={120} autoComplete="off" aria-label="Descrição do item"
              value={it.nome} placeholder={tec ? '' : 'Ex.: Quadro de proteção'}
              onChange={(ev) => mudar(it.id, { nome: ev.target.value })} />
          </label>
          <label>
            <span>Qtd</span>
            <input className="og-input" type="text" inputMode="numeric" autoComplete="off" aria-label="Quantidade"
              value={ef.qtd}
              onChange={(ev) => mudar(it.id, { qtd: ev.target.value, qtdAuto: false })}
              onBlur={() => {
                if (tec && !it.qtd.trim()) { mudar(it.id, { qtdAuto: true, qtd: '' }); return; }
                const q = Math.round(lerNumero(ef.qtd));
                mudar(it.id, { qtd: q > 0 ? String(q) : '' });
              }} />
          </label>
          <label>
            <span>Valor unit. (R$)</span>
            <input className="og-input" type="text" inputMode="decimal" autoComplete="off" aria-label="Valor unitário em reais"
              value={it.un} placeholder="0"
              onChange={(ev) => mudar(it.id, { un: ev.target.value })}
              onBlur={() => { const v = lerDinheiro(it.un); mudar(it.id, { un: formatarDinheiro(v) }); }} />
          </label>
          <div className="og2-it-tot">
            <span>Total</span>
            <output>{brl(totalDoItem(ef))}</output>
          </div>
          {tec
            ? <span className="og2-rm-v" aria-hidden="true" />
            : <button type="button" className="og2-rm" aria-label={`Remover ${it.nome || 'item'}`} onClick={() => remover(it.id)}><X size={16} /></button>}
        </div>
        {it.tec && (
          <div className="og2-it-spec">
            <label>
              <span>{ROTULO_SPEC[it.tec]}</span>
              <input className="og-input" type="text" inputMode="decimal" autoComplete="off" aria-label={ROTULO_SPEC[it.tec]}
                value={ef.spec ?? ''}
                onChange={(ev) => mudar(it.id, { spec: ev.target.value, specAuto: false })}
                onBlur={() => {
                  if (!(it.spec ?? '').trim()) { mudar(it.id, { specAuto: true, spec: '' }); return; }
                  mudar(it.id, { spec: formatarNumero(lerNumero(it.spec)) });
                }} />
            </label>
            <label>
              <span>Garantia (anos), opcional</span>
              <input className="og-input" type="text" inputMode="numeric" autoComplete="off"
                aria-label="Garantia em anos, opcional" value={it.gar ?? ''} placeholder="Se quiser informar"
                onChange={(ev) => mudar(it.id, { gar: ev.target.value.replace(/\D/g, '').slice(0, 2) })} />
            </label>
          </div>
        )}
      </div>
    );
  };

  const cabecalho = (
    <div className="og2-it-cab" aria-hidden="true">
      <span>Descrição</span><span>Qtd</span><span>Valor unit. (R$)</span><span className="og2-dir">Total</span><span />
    </div>
  );

  const margem = preco - custo;
  const pct = custo > 0 ? Math.round((margem / custo) * 1000) / 10 : 0;
  const abaixo = custo > 0 && preco > 0 && preco < custo;
  const qtdItens = itens.length;

  return (
    <div className="og2-proprio">
      <section className="og-card">
        <h3 className="og2-h3">Seus equipamentos</h3>
        <p className="og-hint og2-mt0">
          Preencha o que você vai instalar. Na proposta as linhas saem sem preço, e o cliente vê só o preço final.
        </p>
        {cabecalho}
        {itens.filter((i) => i.tec).map(linha)}

        {conf && (
          <div className="og2-conf" role="status">
            <div className={`og2-conf-t ${conf.tudo ? 'ok' : 'falta'}`}>
              {conf.tudo ? 'Este kit atende a casa.' : 'Este kit não atende tudo. Dá para gerar a proposta mesmo assim.'}
            </div>
            {conf.linhas.map((l) => (
              <div key={l.titulo} className={`og2-cf ${l.ok ? 'ok' : 'falta'}`}>
                {l.ok ? <Check size={15} /> : <X size={15} />}
                <span><b>{l.titulo}:</b> {l.texto}</span>
              </div>
            ))}
            <div className="og2-conf-n">{conf.nota}</div>
          </div>
        )}
      </section>

      <section className="og-card">
        <h3 className="og2-h3">Demais itens</h3>
        {cabecalho}
        {itens.filter((i) => !i.tec).map(linha)}
        <div className="og2-add-it">
          <button type="button" className="og-btn og-btn-ghost og2-btn-sm" disabled={qtdItens >= MAX_ITENS}
            onClick={() => setItens((prev) => (prev.length >= MAX_ITENS ? prev : [...prev, itemVazio()]))}>
            Adicionar item
          </button>
          <span className="og-hint">{qtdItens >= MAX_ITENS ? `Limite de ${MAX_ITENS} itens.` : `${qtdItens} de ${MAX_ITENS} itens.`}</span>
        </div>
      </section>

      <section className="og-card">
        <h3 className="og2-h3">Seu preço</h3>
        <div className="og-linha"><span>Seu custo</span><strong>{brl(custo)}</strong></div>
        <div className="og2-pf">
          <label htmlFor="og-pf">
            Preço final para o cliente
            <small>Começa em custo mais 30%. Você pode mudar.</small>
          </label>
          <CampoDinheiro id="og-pf" rotulo="Preço final para o cliente em reais" valorBase={precoSugerido(custo)}
            auto={pfAuto} texto={pfTexto}
            onTexto={(t) => setPf({ auto: false, texto: t })}
            onRetomarAuto={() => setPf({ auto: true, texto: '' })} />
        </div>
        <div className="og-linha total og2-marg">
          <span>Sua margem</span>
          <strong>{margem < 0 ? '-' : ''}{brl(Math.abs(margem))} ({pct < 0 ? '-' : ''}{nb(Math.abs(pct), 1)}% sobre o custo)</strong>
        </div>
        {abaixo && (
          <p className="og2-aviso-ruim" role="alert">
            <AlertTriangle size={15} /> O preço final está abaixo do seu custo. Você teria prejuízo.
          </p>
        )}
      </section>
    </div>
  );
}
