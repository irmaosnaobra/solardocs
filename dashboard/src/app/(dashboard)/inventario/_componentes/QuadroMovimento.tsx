'use client';

import { useState } from 'react';
import api from '@/services/api';
import { lerQuantidade, formatarQuantidade } from '@/lib/estoque/numero';
import { msgErro, type Item, type TipoMov } from '../tipos';
import Folha from './Folha';

const ROTULO: Record<TipoMov, string> = { saida: 'Saiu', entrada: 'Chegou', ajuste: 'Ajustar' };

/**
 * Quadro de "Saiu", "Chegou" e "Ajustar". Tudo vira movimento no histórico do item.
 * Ajuste: a pessoa diz a quantidade certa; o quadro lança entrada ou saída pela diferença,
 * com a observação "Ajuste de contagem: era X, ficou Y" (a RPC só conhece entrada e saída).
 */
export default function QuadroMovimento({
  item,
  tipoInicial,
  onFechar,
  onFeito,
}: {
  item: Item;
  tipoInicial: TipoMov;
  onFechar: () => void;
  onFeito: (atualizado: Item) => void;
}) {
  const [tipo, setTipo] = useState<TipoMov>(tipoInicial);
  const [qtd, setQtd] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const saldo = Number(item.quantidade) || 0;
  const un = item.unidade;
  const lido = lerQuantidade(qtd);
  const ehAjuste = tipo === 'ajuste';
  // No ajuste o campo é o saldo certo (pode ser 0); nos outros é a quantidade que mexeu (maior que 0).
  const valido = lido != null && (ehAjuste ? true : lido > 0);
  const diferenca = ehAjuste && lido != null ? Math.round((lido - saldo) * 1000) / 1000 : 0;

  const enviar = async () => {
    if (enviando) return;
    if (!valido || lido == null) {
      setErro(ehAjuste ? 'Digite a quantidade certa, por exemplo 12.' : 'Digite a quantidade, por exemplo 2 ou 1,5.');
      return;
    }
    let tipoReal: 'entrada' | 'saida';
    let quantidade: number;
    let observacao = obs.trim();
    if (ehAjuste) {
      if (diferenca === 0) { setErro('Essa já é a quantidade do estoque.'); return; }
      tipoReal = diferenca > 0 ? 'entrada' : 'saida';
      quantidade = Math.abs(diferenca);
      const base = `Ajuste de contagem: era ${formatarQuantidade(saldo)}, ficou ${formatarQuantidade(lido)}`;
      observacao = (observacao ? `${base}. ${observacao}` : base).slice(0, 200);
    } else {
      if (tipo === 'saida' && lido > saldo) {
        setErro(`Só tem ${formatarQuantidade(saldo)} ${un} no estoque.`);
        return;
      }
      tipoReal = tipo;
      quantidade = lido;
    }
    setEnviando(true);
    setErro('');
    try {
      const { data } = await api.post(`/inventory/${item.id}/movement`, {
        tipo: tipoReal,
        quantidade,
        observacao: observacao || undefined,
      });
      onFeito(data.item);
    } catch (e) {
      setErro(msgErro(e, 'Não deu para registrar. Confira a internet e tente de novo.'));
      setEnviando(false);
    }
  };

  return (
    <Folha titulo={ROTULO[tipo]} subtitulo={`${item.nome}, saldo ${formatarQuantidade(saldo)} ${un}`} onFechar={onFechar}>
      <div className="est-seg" role="group" aria-label="Tipo de movimento">
        {(['saida', 'entrada', 'ajuste'] as TipoMov[]).map((t) => (
          <button
            key={t}
            type="button"
            className={tipo === t ? 'on' : ''}
            aria-pressed={tipo === t}
            onClick={() => { setTipo(t); setErro(''); }}
          >
            {ROTULO[t]}
          </button>
        ))}
      </div>

      <label className="est-lbl" htmlFor="est-mov-qtd">
        {ehAjuste ? `Quantidade certa agora (${un})` : `Quantidade (${un})`}
      </label>
      <input
        id="est-mov-qtd"
        className="est-in"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={ehAjuste ? formatarQuantidade(saldo) : '0'}
        value={qtd}
        onChange={(e) => { setQtd(e.target.value); setErro(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') enviar(); }}
      />
      {ehAjuste && lido != null && diferenca !== 0 && (
        <p className="est-dica">
          Vai lançar {diferenca > 0 ? 'uma entrada' : 'uma saída'} de {formatarQuantidade(Math.abs(diferenca))} {un}.
        </p>
      )}

      <label className="est-lbl" htmlFor="est-mov-obs">Observação (opcional)</label>
      <input
        id="est-mov-obs"
        className="est-in"
        type="text"
        maxLength={150}
        placeholder={tipo === 'saida' ? 'Ex.: obra do João' : tipo === 'entrada' ? 'Ex.: compra no fornecedor' : 'Ex.: contagem de sexta'}
        value={obs}
        onChange={(e) => setObs(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') enviar(); }}
      />

      {erro && <p className="est-erro-linha" role="alert">{erro}</p>}

      <button type="button" className="est-btn" onClick={enviar} disabled={enviando}>
        {enviando ? 'Salvando...' : ehAjuste ? 'Ajustar o estoque' : tipo === 'saida' ? 'Registrar saída' : 'Registrar chegada'}
      </button>
    </Folha>
  );
}
