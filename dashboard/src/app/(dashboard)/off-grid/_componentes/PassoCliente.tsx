'use client';

import { UFS } from '@/lib/offgrid/catalogo';
import InfoHint from '@/components/InfoHint/InfoHint';
import { maskCpf, maskCnpj, soDigitos } from '@/utils/documento';
import { nb } from './util';

/** CPF enquanto tem até 11 números; vira CNPJ quando passa disso ou tem letra (CNPJ alfanumérico). */
export function maskCpfOuCnpj(raw: string): string {
  const letras = /[A-Za-z]/.test(raw);
  return letras || soDigitos(raw).length > 11 ? maskCnpj(raw) : maskCpf(raw);
}

export interface DadosCliente {
  nome: string;
  doc: string;
  tel: string;
  cep: string;
  endereco: string;
}

export default function PassoCliente({
  d, mudar, cidade, setCidade, uf, setUf, cepInfo, buscandoCep, cepErro, hsp,
}: {
  d: DadosCliente;
  mudar: (patch: Partial<DadosCliente>) => void;
  cidade: string;
  setCidade: (v: string) => void;
  uf: string;
  setUf: (v: string) => void;
  cepInfo: { cidade: string; uf: string } | null;
  buscandoCep: boolean;
  cepErro: boolean;
  hsp: { anual: number; pior: number; porCidade: boolean };
}) {
  const cepCompleto = d.cep.replace(/\D/g, '').length === 8;
  return (
    <div className="og-card">
      <h2 className="og2-h2">Cliente e CEP da obra</h2>
      <div className="og2-grid2">
        <div className="og2-full">
          <label className="og-label" htmlFor="og-nome">Nome do cliente</label>
          <input id="og-nome" className="og-input" type="text" autoComplete="off" value={d.nome}
            placeholder="Ex.: José Horácio Lima" onChange={(ev) => mudar({ nome: ev.target.value })} />
        </div>
        <div>
          <label className="og-label" htmlFor="og-doc">CPF ou CNPJ (opcional)</label>
          <input id="og-doc" className="og-input" type="text" inputMode="text" autoComplete="off" maxLength={18}
            value={d.doc} onChange={(ev) => mudar({ doc: maskCpfOuCnpj(ev.target.value) })} />
        </div>
        <div>
          <label className="og-label" htmlFor="og-tel">Telefone (opcional)</label>
          <input id="og-tel" className="og-input" type="text" inputMode="tel" autoComplete="off" value={d.tel}
            onChange={(ev) => mudar({ tel: ev.target.value })} />
        </div>
        <div className="og2-full">
          <label className="og-label" htmlFor="og-cep">CEP da obra (obrigatório)</label>
          <input id="og-cep" className={`og-input ${cepErro ? 'og2-erro' : ''}`} type="text" inputMode="numeric"
            autoComplete="off" maxLength={9} value={d.cep} placeholder="38400-000"
            aria-describedby="og-cep-h" aria-invalid={cepErro}
            onChange={(ev) => {
              const dig = ev.target.value.replace(/\D/g, '').slice(0, 8);
              mudar({ cep: dig.length > 5 ? `${dig.slice(0, 5)}-${dig.slice(5)}` : dig });
            }} />
          <p id="og-cep-h" className={`og-hint ${cepErro ? 'og2-hint-erro' : ''}`}>
            {cepErro ? 'Digite o CEP da obra, com 8 números. Sem ele não dá para calcular o frete.'
              : cepCompleto && buscandoCep ? 'Buscando o CEP...'
              : cepCompleto && cepInfo ? `Obra em ${cepInfo.cidade}/${cepInfo.uf}. O frete sai pelo CEP.`
              : cepCompleto ? 'CEP não encontrado. Preencha a cidade e o estado abaixo.'
              : 'O frete sai pelo CEP.'}
          </p>
        </div>
        <div>
          <label className="og-label" htmlFor="og-cidade">Cidade</label>
          <input id="og-cidade" className="og-input" type="text" autoComplete="off" value={cidade}
            placeholder="Ex.: Uberlândia" onChange={(ev) => setCidade(ev.target.value)} />
        </div>
        <div>
          <label className="og-label" htmlFor="og-uf">Estado</label>
          <select id="og-uf" className="og-select" value={uf} onChange={(ev) => setUf(ev.target.value)}>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="og2-full">
          <label className="og-label" htmlFor="og-end">Endereço (opcional)</label>
          <input id="og-end" className="og-input" type="text" autoComplete="off" value={d.endereco}
            placeholder="Rua, número, bairro" onChange={(ev) => mudar({ endereco: ev.target.value })} />
        </div>
      </div>
      <p className="og-hint">
        Sol em {hsp.porCidade ? cidade : uf}: <strong>{nb(hsp.anual)} h/dia</strong> na média e{' '}
        <strong>{nb(hsp.pior)} h/dia</strong> no mês de menos sol
        <InfoHint>
          {hsp.porCidade ? 'Medição da própria cidade.' : 'Média do estado. Digite a cidade para afinar o número.'}{' '}
          Off-grid não tem rede para compensar o inverno, por isso é o mês de menos sol que manda no tamanho das placas.
        </InfoHint>
      </p>
    </div>
  );
}
