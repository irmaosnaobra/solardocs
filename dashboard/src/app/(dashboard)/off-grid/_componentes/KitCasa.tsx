'use client';

import { AlertTriangle, Info, CircleAlert } from 'lucide-react';
import type { ResultadoOffGrid } from '@/lib/offgrid/engine';
import { CONST } from '@/lib/offgrid/constantes';
import { lerDinheiro, lerNumero, formatarDinheiro, formatarNumero } from '@/lib/offgrid/dinheiro';
import { brl, brl2, nb, tempoHumano, type Orcamento } from './util';

const OCULTO = 'R$ •••••';

/** Resumo do projeto: placas, inversor, baterias e quanto o sistema aguenta. Vale para o kit da casa. */
export function ResumoDoKit({ r }: { r: ResultadoOffGrid }) {
  const semConsumo = r.consumoTotalDia <= 0;
  return (
    <section className="og-card">
      <div className="og2-tiles">
        <div className="og2-tile"><small>Placas solares</small><b>{r.qtdModulos}</b><span>{nb(r.kwp)} kWp</span></div>
        <div className="og2-tile"><small>Inversor</small><b>{nb(r.inversor.w / 1000, 1)}<em>kW</em></b><span>Saída {r.inversor.saida}</span></div>
        <div className="og2-tile"><small>Baterias</small><b>{r.qtdBaterias}</b><span>{nb(r.bancoNominal)} kWh · {r.tensao} V</span></div>
      </div>
      <div className="og2-aguenta">
        <b>{semConsumo ? 'Escolha os aparelhos no passo 2.' : `Aguenta ${tempoHumano(r.autonomia.essencialDias)} sem sol, com o essencial ligado`}</b>
        <span>Consumo previsto: {nb(r.consumoTotalDia)} kWh por dia</span>
      </div>
      <p className="og-hint">
        Banco de {nb(r.bancoNominal)} kWh ({r.qtdBaterias}× {nb(r.bateria.kwh)} kWh, {r.tensao} V), com{' '}
        {nb(r.bancoUtilizavel)} kWh utilizáveis. Os {nb(r.bancoReserva)} kWh que sobram ficam de reserva: o inversor corta
        antes de zerar, e é isso que faz a bateria durar {CONST.VIDA_ANOS_LIFEPO4} anos ou mais.
      </p>
      <details className="og2-det">
        <summary>Ver a autonomia em detalhe</summary>
        <div className="og-cen">
          <div><div className="og-cen-nome">Só o essencial</div><div className="og-cen-desc">{nb(r.consumoEssencialDia)} kWh por dia</div></div>
          <div className="og-cen-val">{tempoHumano(r.autonomia.essencialDias)}</div>
        </div>
        <div className="og-cen">
          <div><div className="og-cen-nome">A casa inteira</div><div className="og-cen-desc">{nb(r.consumoTotalDia)} kWh por dia</div></div>
          <div className="og-cen-val">{tempoHumano(r.autonomia.tudoDias)}</div>
        </div>
        <div className="og-cen">
          <div>
            <div className="og-cen-nome">Chovendo o dia todo</div>
            <div className="og-cen-desc">as placas ainda entregam cerca de {nb(r.autonomia.geracaoDiaFechado)} kWh por dia</div>
          </div>
          <div className="og-cen-val">{r.autonomia.chuvaInfinita ? 'não acaba' : tempoHumano(r.autonomia.chuvaDias)}</div>
        </div>
        <div className="og-cen">
          <div><div className="og-cen-nome">Banco cheio de novo em</div></div>
          <div className="og-cen-val">{r.autonomia.recargaDias > 0 ? `${tempoHumano(r.autonomia.recargaDias)} de sol` : 'no mesmo dia'}</div>
        </div>
      </details>
    </section>
  );
}

export function AvisosDoKit({ r }: { r: ResultadoOffGrid }) {
  if (r.avisos.length === 0) return null;
  return (
    <div>
      {r.avisos.map((a, i) => (
        <div key={i} className={`og-aviso og-aviso-${a.nivel}`}>
          {a.nivel === 'erro' ? <CircleAlert size={16} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
            : a.nivel === 'atencao' ? <AlertTriangle size={16} color="#B45309" style={{ flexShrink: 0, marginTop: 1 }} />
            : <Info size={16} color="#1D4ED8" style={{ flexShrink: 0, marginTop: 1 }} />}
          <div>
            <div className="og-aviso-titulo">{a.titulo}</div>
            <div className="og-aviso-texto">{a.texto}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Kit da casa: lista item a item e o preço, calculado no servidor. Sem acesso, o preço fica escondido. */
export default function KitCasa({
  r, orc, orcando, trancado, acessoConhecido, textos, setTextos, margemPct,
}: {
  r: ResultadoOffGrid;
  orc: Orcamento | null;
  orcando: boolean;
  trancado: boolean;
  acessoConhecido: boolean;
  textos: { inst: string; extras: string; margem: string };
  setTextos: (patch: Partial<{ inst: string; extras: string; margem: string }>, valores?: { maoDeObra?: number; extras?: number; margemPct?: number }) => void;
  margemPct: number;
}) {
  return (
    <>
      <section className="og-card">
        <h3 className="og2-h3">Kit item a item</h3>
        {r.itens.map((it) => {
          const preco = !trancado ? orc?.itens.find((x) => x.id === it.id) : undefined;
          return (
            <div className="og-item" key={it.id}>
              <div>
                <div className="og-item-nome">{it.nome}</div>
                <div className="og-item-meta">
                  {it.qtd}×{preco ? ` ${brl(preco.unitario)}` : ''}{it.garantia ? ` · garantia ${it.garantia} anos` : ''}
                </div>
              </div>
              <div className="og-item-val">{preco ? brl(preco.total) : ''}</div>
            </div>
          );
        })}
      </section>

      <section className="og-card">
        <h3 className="og2-h3">Preço</h3>
        {trancado ? (
          <div className="og-linha"><span>Preço ao cliente, com frete até o CEP</span><strong className="og2-oculto">{OCULTO}</strong></div>
        ) : !acessoConhecido ? (
          <p className="og-hint og2-mt0">Confirmando o seu acesso...</p>
        ) : !orc ? (
          <p className="og-hint og2-mt0">{orcando ? 'Calculando o preço...' : 'Escolha os aparelhos para ver o preço.'}</p>
        ) : (
          <>
            <div className="og-linha"><span>Kit</span><strong>{brl(orc.custoEquipamentos)}</strong></div>
            <div className="og-linha">
              <span>{orc.frete > 0 ? `Frete ${orc.freteRegiao}` : 'Frete'} · {nb(r.pesoTotal, 0)} kg</span>
              <strong>{orc.frete > 0 ? brl(orc.frete) : 'sem CEP'}</strong>
            </div>
            {orc.frete > 0
              ? <p className="og-hint og2-mt0">{orc.freteDetalhe} Valor estimado, por transportadora{orc.fretePrazo ? `, em ${orc.fretePrazo}` : ''}.</p>
              : <p className="og-hint og2-mt0 og2-hint-erro">Informe o CEP da obra no passo 1 para somar o frete. Sem ele o preço sai incompleto.</p>}
            <div className="og2-campos">
              <div>
                <label className="og-label" htmlFor="og-inst">Instalação (R$)</label>
                <input id="og-inst" className="og-input" type="text" inputMode="decimal" autoComplete="off" placeholder="0"
                  value={textos.inst}
                  onChange={(ev) => setTextos({ inst: ev.target.value }, { maoDeObra: lerDinheiro(ev.target.value) })}
                  onBlur={() => setTextos({ inst: formatarDinheiro(lerDinheiro(textos.inst)) })} />
              </div>
              <div>
                <label className="og-label" htmlFor="og-extras">Extras (R$)</label>
                <input id="og-extras" className="og-input" type="text" inputMode="decimal" autoComplete="off" placeholder="obra civil, guindaste"
                  value={textos.extras}
                  onChange={(ev) => setTextos({ extras: ev.target.value }, { extras: lerDinheiro(ev.target.value) })}
                  onBlur={() => setTextos({ extras: formatarDinheiro(lerDinheiro(textos.extras)) })} />
              </div>
              <div>
                <label className="og-label" htmlFor="og-margem">Acréscimo (%)</label>
                <input id="og-margem" className="og-input" type="text" inputMode="decimal" autoComplete="off"
                  value={textos.margem}
                  onChange={(ev) => setTextos({ margem: ev.target.value }, { margemPct: lerNumero(ev.target.value) })}
                  onBlur={() => setTextos({ margem: formatarNumero(lerNumero(textos.margem)) })} />
              </div>
            </div>
            {orc.maoDeObra > 0 && <div className="og-linha"><span>Instalação</span><strong>{brl(orc.maoDeObra)}</strong></div>}
            {orc.extras > 0 && <div className="og-linha"><span>Extras</span><strong>{brl(orc.extras)}</strong></div>}
            <div className="og-linha destaque">
              <span>Seu acréscimo ({nb(margemPct, 1)}%)<small className="og2-peq">Sobre kit, frete, instalação e extras.</small></span>
              <strong>{brl(orc.margemValor)}</strong>
            </div>
            <div className="og-linha total"><span>Total ao cliente</span><strong>{brl(orc.precoCliente)}</strong></div>
            {orc.creditoPedido > 0 && (
              <p className="og-hint">
                Você tem <strong>{brl(orc.creditoPedido)} de crédito</strong> para abater no seu primeiro pedido de kit. A gente
                abate na hora de faturar.
              </p>
            )}
            <p className="og-hint">
              Custo do kWh guardado: {brl2(orc.custoKwhArmazenado)}. Preços da tabela {orc.tabelaVersao || 'vigente'}; o pedido trava o
              valor do dia em que é enviado.
            </p>
          </>
        )}
      </section>
    </>
  );
}
