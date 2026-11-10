'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import api from '@/services/api';
import { formatarQuantidade, formatarValor } from '@/lib/estoque/numero';
import { faltaRepor, valorDoItem } from '@/lib/estoque/regras';
import { UNIDADES } from '../catalogo';
import type { Item, Movimento, TipoMov } from '../tipos';
import Folha from './Folha';
import CampoNumero from './CampoNumero';
import CampoTexto from './CampoTexto';

const fmtR = (n: number) => 'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const POR_VEZ = 10;

const dataHora = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const rotuloTipo = (t: string) =>
  t === 'entrada' ? 'Chegou' : t === 'saida' ? 'Saiu' : t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Movimento';

/** Detalhe do item: saldo, movimentos, dados, "Passar para" e histórico. */
export default function FolhaItem({
  item,
  onFechar,
  onSalvar,
  onMovimento,
  onRemover,
  onValorInvalido,
}: {
  item: Item;
  onFechar: () => void;
  onSalvar: (patch: Partial<Item>, avisoOk?: string) => Promise<boolean>;
  onMovimento: (tipo: TipoMov) => void;
  onRemover: () => void;
  onValorInvalido: () => void;
}) {
  const [destino, setDestino] = useState('');
  const [movs, setMovs] = useState<Movimento[] | null>(null);
  const [histErro, setHistErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [visiveis, setVisiveis] = useState(POR_VEZ);

  // Carrega de novo quando o saldo muda (Saiu, Chegou ou Ajustar acabaram de registrar um movimento).
  useEffect(() => {
    let vivo = true;
    api.get(`/inventory/${item.id}/movements`)
      .then(({ data }) => { if (vivo) { setMovs(data.movements ?? []); setHistErro(false); } })
      .catch(() => { if (vivo) setHistErro(true); });
    return () => { vivo = false; };
  }, [item.id, item.quantidade, tentativa]);

  const baixo = faltaRepor(item);
  const saldo = Number(item.quantidade) || 0;

  const passar = async () => {
    const v = destino.trim().slice(0, 60);
    if (!v || v === item.local) return;
    if (await onSalvar({ local: v }, `${item.nome} passou para ${v}.`)) setDestino('');
  };

  return (
    <Folha titulo={item.nome} subtitulo={`Em ${item.local}`} onFechar={onFechar} focarCampo={false}>
      <div className="est-saldo">
        <div>
          <span className="est-cap">Saldo</span>
          <strong>{formatarQuantidade(saldo)} <small>{item.unidade}</small></strong>
          {baixo && <span className="est-selo">Falta repor</span>}
        </div>
        <div className="est-saldo-d">
          <span className="est-cap">Valor em estoque</span>
          <strong>{fmtR(valorDoItem(item))}</strong>
        </div>
      </div>

      <div className="est-tres">
        <button type="button" className="est-btn-sec" onClick={() => onMovimento('saida')}>Saiu</button>
        <button type="button" className="est-btn-sec" onClick={() => onMovimento('entrada')}>Chegou</button>
        <button type="button" className="est-btn-sec" onClick={() => onMovimento('ajuste')}>Ajustar</button>
      </div>

      <h3 className="est-sub">Passar para</h3>
      <p className="est-dica">Mude de lugar ou diga com quem está, por exemplo &quot;Com o Diego&quot;.</p>
      <div className="est-linha-form">
        <input
          className="est-in"
          type="text"
          list="est-locais"
          aria-label="Passar para"
          placeholder="Local ou pessoa"
          maxLength={60}
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') passar(); }}
        />
        <button type="button" className="est-btn-sec" onClick={passar} disabled={!destino.trim() || destino.trim() === item.local}>
          Passar
        </button>
      </div>

      <h3 className="est-sub">Dados do item</h3>
      <div className="est-grade2">
        <div className="est-campo cheio">
          <label className="est-lbl" htmlFor="est-d-nome">Nome</label>
          <CampoTexto key={item.nome} id="est-d-nome" valor={item.nome} maxLength={120}
            onConfirmar={(v) => { if (!v) { onValorInvalido(); return false; } if (v !== item.nome) onSalvar({ nome: v }); return true; }} />
        </div>
        <div className="est-campo">
          <label className="est-lbl" htmlFor="est-d-marca">Marca</label>
          <CampoTexto key={item.marca ?? ''} id="est-d-marca" valor={item.marca ?? ''} maxLength={80} lista="est-marcas" placeholder="Sem marca"
            onConfirmar={(v) => { if (v !== (item.marca ?? '')) onSalvar({ marca: v || null }); return true; }} />
        </div>
        <div className="est-campo">
          <label className="est-lbl" htmlFor="est-d-un">Unidade</label>
          <select id="est-d-un" className="est-in" value={item.unidade} onChange={(e) => onSalvar({ unidade: e.target.value })}>
            {[...new Set([item.unidade, ...UNIDADES])].map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="est-campo">
          <label className="est-lbl" htmlFor="est-d-valor">Valor unitário (R$)</label>
          <CampoNumero id="est-d-valor" rotulo="Valor unitário" valor={Number(item.valor_unitario) || 0}
            formatar={formatarValor} placeholder="0,00"
            onConfirmar={(n) => onSalvar({ valor_unitario: n })} onInvalido={onValorInvalido} />
        </div>
        <div className="est-campo">
          <label className="est-lbl" htmlFor="est-d-min">Estoque mínimo</label>
          <CampoNumero id="est-d-min" rotulo="Estoque mínimo" valor={Number(item.estoque_minimo) || 0}
            formatar={formatarQuantidade} placeholder="0"
            onConfirmar={(n) => onSalvar({ estoque_minimo: n })} onInvalido={onValorInvalido} />
        </div>
      </div>
      <p className="est-dica">A quantidade muda só por Saiu, Chegou ou Ajustar, para o histórico ficar certo.</p>

      <h3 className="est-sub">Histórico</h3>
      {histErro ? (
        <p className="est-dica">
          Não deu para carregar o histórico.{' '}
          <button type="button" className="est-link" onClick={() => { setHistErro(false); setMovs(null); setTentativa((t) => t + 1); }}>Tentar de novo</button>
        </p>
      ) : movs == null ? (
        <p className="est-dica">Carregando o histórico...</p>
      ) : movs.length === 0 ? (
        <p className="est-dica">Ainda não tem movimento neste item.</p>
      ) : (
        <>
          <ul className="est-hist">
            {movs.slice(0, visiveis).map((m, k) => (
              <li key={m.id ?? `${m.created_at}-${k}`}>
                <span className={`est-hist-tipo ${m.tipo}`}>{rotuloTipo(m.tipo)}</span>
                <span className="est-hist-q">{formatarQuantidade(Number(m.quantidade))} {item.unidade}</span>
                <span className="est-hist-d">{dataHora(m.created_at)}</span>
                {m.observacao && <span className="est-hist-o">{m.observacao}</span>}
              </li>
            ))}
          </ul>
          {movs.length > visiveis && (
            <button type="button" className="est-btn-sec cheio" onClick={() => setVisiveis((v) => v + POR_VEZ)}>
              Ver mais ({movs.length - visiveis})
            </button>
          )}
          {movs.length >= 100 && movs.length <= visiveis && (
            <p className="est-dica">Mostrando os últimos 100 movimentos.</p>
          )}
        </>
      )}

      <button type="button" className="est-perigo" onClick={onRemover}>
        <Trash2 size={17} /> Tirar do estoque
      </button>
    </Folha>
  );
}
