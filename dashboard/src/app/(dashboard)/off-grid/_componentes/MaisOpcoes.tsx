'use client';

import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, Check, Wallet } from 'lucide-react';
import type { ResultadoComparativo } from '@/lib/offgrid/comparativo';
import { lerDinheiro, formatarDinheiro } from '@/lib/offgrid/dinheiro';
import { Escolha, Escolhas } from '@/components/Escolha/Escolha';
import InfoHint from '@/components/InfoHint/InfoHint';
import { maskCnpj } from '@/utils/documento';
import { BANCOS_LOGOS, brl } from './util';

export interface OpcoesProposta {
  validadeDias: number;
  incluirComparativo: boolean;
  distancia: string;
  precoMetro: string;
  tarifa: string;
  transformador: boolean;
  dadosBancarios: boolean;
  bancos: string[];
  aceite: boolean;
  emp: { razao_social: string; cnpj: string; representante: string; cargo: string };
  local: string;
}

/**
 * "Mais opções da proposta": recolhido de propósito. Validade, comparativo com rede e diesel, bancos, dados
 * bancários e a folha de aceite. As fotos das obras entram sozinhas, as da tela Empresa.
 */
export default function MaisOpcoes({
  o, setO, cmp, onTocouComparativo, erroAceite, clienteNome, clienteDoc, precoOffGrid,
}: {
  o: OpcoesProposta;
  setO: Dispatch<SetStateAction<OpcoesProposta>>;
  cmp: ResultadoComparativo;
  onTocouComparativo: () => void;
  erroAceite: string | null;
  clienteNome: string;
  clienteDoc: string;
  precoOffGrid: number;
}) {
  const mudar = (patch: Partial<OpcoesProposta>) => setO((p) => ({ ...p, ...patch }));
  const mudarEmp = (patch: Partial<OpcoesProposta['emp']>) => setO((p) => ({ ...p, emp: { ...p.emp, ...patch } }));
  const alternarBanco = (id: string) =>
    setO((p) => ({
      ...p,
      bancos: BANCOS_LOGOS.map((b) => b.id as string).filter((x) => (x === id ? !p.bancos.includes(x) : p.bancos.includes(x))),
    }));
  const economia = Math.max(cmp.economiaContraRede, cmp.economiaContraDiesel);

  return (
    <details className="og-card og2-mais">
      <summary>
        <span>Mais opções da proposta</span>
        <small>validade, comparativo, bancos, dados bancários e aceite</small>
        <ChevronDown size={16} className="og2-mais-chev" />
      </summary>

      <div className="og2-mais-corpo">
        <div className="og2-grid2">
          <div>
            <label className="og-label" htmlFor="og-validade">Validade da proposta</label>
            <select id="og-validade" className="og-select" value={String(o.validadeDias)}
              onChange={(ev) => mudar({ validadeDias: parseInt(ev.target.value, 10) })}>
              <option value="7">7 dias</option>
              <option value="15">15 dias</option>
              <option value="30">30 dias</option>
            </select>
          </div>
        </div>

        <h4 className="og2-h4">Comparativo com rede e diesel</h4>
        <label className="og-check">
          <input type="checkbox" checked={o.incluirComparativo}
            onChange={(ev) => { onTocouComparativo(); mudar({ incluirComparativo: ev.target.checked }); }} />
          <span>
            Incluir o comparativo de {cmp.anos} anos
            <em>
              {precoOffGrid <= 0 ? ' O comparativo usa o preço final. Preencha o preço primeiro.'
                : cmp.vencedor === 'offgrid'
                  ? ` Nesta conta o off-grid sai ${brl(economia)} mais barato em ${cmp.anos} anos.`
                  : ' Atenção: nesta conta a rede sai na frente, e a página vai dizer isso.'}
            </em>
          </span>
        </label>
        <div className="og2-grid3">
          <div>
            <label className="og-label" htmlFor="og-dist">Distância até o poste (m)</label>
            <input id="og-dist" className="og-input" type="text" inputMode="decimal" autoComplete="off" placeholder="0 = já tem rede"
              value={o.distancia} onChange={(ev) => mudar({ distancia: ev.target.value })}
              onBlur={() => mudar({ distancia: formatarDinheiro(lerDinheiro(o.distancia)) })} />
          </div>
          <div>
            <label className="og-label" htmlFor="og-metro">
              R$ por metro de rede
              <InfoHint>
                Orçamentos reais de extensão rural ficaram entre R$ 118 e R$ 367 o metro. A diferença é o transformador e o
                terreno. O número oficial só a concessionária dá, e a proposta diz que este é uma estimativa.
              </InfoHint>
            </label>
            <input id="og-metro" className="og-input" type="text" inputMode="decimal" autoComplete="off"
              value={o.precoMetro} onChange={(ev) => mudar({ precoMetro: ev.target.value })}
              onBlur={() => mudar({ precoMetro: formatarDinheiro(lerDinheiro(o.precoMetro)) })} />
          </div>
          <div>
            <label className="og-label" htmlFor="og-tarifa">Tarifa da região (R$/kWh)</label>
            <input id="og-tarifa" className="og-input" type="text" inputMode="decimal" autoComplete="off"
              value={o.tarifa} onChange={(ev) => mudar({ tarifa: ev.target.value })} />
          </div>
        </div>
        <Escolhas colunas={2}>
          <Escolha on={!o.transformador} icone={Check} onClick={() => mudar({ transformador: false })}
            titulo="Sem transformador" desc="o ramal existente atende" />
          <Escolha on={o.transformador} icone={Wallet} onClick={() => mudar({ transformador: true })}
            titulo="Com transformador" desc="soma na obra da rede" />
        </Escolhas>

        <h4 className="og2-h4">Bancos e dados bancários</h4>
        <label className="og-check">
          <input type="checkbox" checked={o.dadosBancarios} onChange={(ev) => mudar({ dadosBancarios: ev.target.checked })} />
          <span>Mostrar dados bancários<em>Sai só se os dados estiverem completos no cadastro da sua empresa.</em></span>
        </label>
        <p className="og-label og2-mt" id="og-bancos-t">Bancos que aparecem ({o.bancos.length})</p>
        <div className="og2-bancos" role="group" aria-labelledby="og-bancos-t">
          {BANCOS_LOGOS.map((b) => (
            <button key={b.id} type="button" aria-pressed={o.bancos.includes(b.id)} onClick={() => alternarBanco(b.id)}>{b.nome}</button>
          ))}
        </div>

        <h4 className="og2-h4">Folha de aceite</h4>
        <label className="og-check">
          <input type="checkbox" checked={o.aceite} onChange={(ev) => mudar({ aceite: ev.target.checked })} />
          <span>Incluir a folha de aceite com as duas assinaturas<em>Desligada, a proposta sai sem essa folha.</em></span>
        </label>
        {o.aceite && (
          <div className="og2-aceite">
            <p className="og-hint og2-mt0">
              Pelo cliente: <strong>{clienteNome.trim() || 'sem nome (passo 1)'}</strong>
              {clienteDoc.trim() ? `, ${clienteDoc}` : ', sem CPF ou CNPJ (passo 1)'}.
            </p>
            <div className="og2-grid2">
              <div>
                <label className="og-label" htmlFor="og-ass-razao">Razão social da sua empresa</label>
                <input id="og-ass-razao" className="og-input" type="text" autoComplete="off" value={o.emp.razao_social}
                  onChange={(ev) => mudarEmp({ razao_social: ev.target.value })} />
              </div>
              <div>
                <label className="og-label" htmlFor="og-ass-cnpj">CNPJ</label>
                <input id="og-ass-cnpj" className="og-input" type="text" autoComplete="off" maxLength={18} placeholder="00.000.000/0000-00"
                  value={o.emp.cnpj} onChange={(ev) => mudarEmp({ cnpj: maskCnpj(ev.target.value) })} />
              </div>
              <div>
                <label className="og-label" htmlFor="og-ass-rep">Quem assina</label>
                <input id="og-ass-rep" className="og-input" type="text" autoComplete="off" value={o.emp.representante}
                  onChange={(ev) => mudarEmp({ representante: ev.target.value })} />
              </div>
              <div>
                <label className="og-label" htmlFor="og-ass-cargo">Cargo</label>
                <input id="og-ass-cargo" className="og-input" type="text" autoComplete="off" value={o.emp.cargo}
                  onChange={(ev) => mudarEmp({ cargo: ev.target.value })} />
              </div>
              <div className="og2-full">
                <label className="og-label" htmlFor="og-ass-local">Cidade da assinatura</label>
                <input id="og-ass-local" className="og-input" type="text" autoComplete="off" placeholder="Ex.: Uberlândia/MG"
                  value={o.local} onChange={(ev) => mudar({ local: ev.target.value })} />
              </div>
            </div>
            {erroAceite && <p className="og2-hint-erro og-hint" role="alert">{erroAceite}</p>}
          </div>
        )}

        <p className="og-hint">As fotos das suas obras, as da tela Empresa, entram sozinhas. A folha de obras sai com 6 fotos ou mais.</p>
      </div>
    </details>
  );
}
