'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import api from '@/services/api';
import './precificacao.css';

// Analytics de uso (NÃO abate crédito). Fail-silent: nunca trava a UX.
function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'precificacao', event_type }).catch(() => {});
}

const fmt = (n: number) =>
  'R$ ' + (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Parse tolerante a vírgula; vazio/negativo/NaN => 0
const num = (v: string) => {
  const n = parseFloat((v || '').replace(',', '.'));
  return isFinite(n) && n > 0 ? n : 0;
};

interface CampoCusto {
  key: string;
  label: string;
  hint?: string;
}

// Custos genéricos (sem derivação). Kit e Material C.A saem deste loop porque
// o C.A é sugerido como 10% do kit (ver handlers abaixo).
const CUSTOS: CampoCusto[] = [
  { key: 'mao',     label: 'Mão de obra / Instalação' },
  { key: 'desl',    label: 'Deslocamento / Logística', hint: 'combustível, frete' },
  { key: 'homolog', label: 'Homologação', hint: 'projeto, concessionária' },
  { key: 'art',     label: 'ART', hint: 'engenharia / responsabilidade técnica' },
];

// Material C.A sugerido = 10% do kit (mesmo padrão da calculadora do /gerador).
const CA_PCT = 0.1;
// NF padrão = 6% (Simples). Modelada como dedução sobre a venda, igual ao /gerador.
// A % é editável (campo nfPct) — 6% é só o ponto de partida.
const NF_PCT_PADRAO = '6';

type NfModo = 'nenhuma' | 'serv' | 'total';

export default function PrecificacaoPage() {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [kit, setKit] = useState('');
  const [ca, setCa] = useState('');
  const caTocado = useRef(false);
  const [margem, setMargem] = useState('30');
  const [comissao, setComissao] = useState('0');
  const [nf, setNf] = useState<NfModo>('nenhuma');
  const [nfPctInput, setNfPctInput] = useState(NF_PCT_PADRAO);

  const set = (key: string, v: string) =>
    setValores((prev) => ({ ...prev, [key]: v }));

  // Kit muda → se o consultor ainda não tocou no C.A, sugere 10% do kit.
  const onKitChange = (v: string) => {
    setKit(v);
    if (!caTocado.current) {
      const k = num(v);
      setCa(k > 0 ? (k * CA_PCT).toFixed(2) : '');
    }
  };
  // Consultor digitou no C.A → respeita o valor dele. Esvaziar volta ao auto.
  const onCaChange = (v: string) => {
    setCa(v);
    caTocado.current = v.trim() !== '';
  };

  // ── Analytics de uso (beta / futuro order-bump). Não abate crédito. ──
  // 'open': uma vez ao abrir. 'calc': uma vez quando o cliente realmente
  // chega a um preço válido (preencheu custo). Ambos disparam 1x por visita.
  const openLogged = useRef(false);
  const calcLogged = useRef(false);

  useEffect(() => {
    if (openLogged.current) return;
    openLogged.current = true;
    logUso('open');
  }, []);

  const r = useMemo(() => {
    const vKit = num(kit);
    const vCa = num(ca);
    // Detalhamento na ordem de exibição: Kit, C.A, depois os campos genéricos.
    const linhas = [
      { key: 'kit', label: 'Kit', valor: vKit },
      { key: 'ca',  label: 'Material C.A', valor: vCa },
      ...CUSTOS.map((c) => ({ key: c.key, label: c.label, valor: num(valores[c.key]) })),
    ];
    const custo = linhas.reduce((s, l) => s + l.valor, 0);
    const margemPct = num(margem);
    const comissaoPct = num(comissao);
    const nfAliquota = num(nfPctInput); // % da NF (editável); 0 se campo vazio
    const nfPct = nf === 'nenhuma' ? 0 : nfAliquota;

    // Margem, comissão E NF incidem sobre a RECEITA → mesmo denominador.
    // (A NF de 6% É o imposto Simples; só incide quando há nota emitida.)
    // A NF de serviço isenta o kit, então devolve nf%·kit ao numerador.
    // Preço = (Custo − [serv? nf%·kit : 0]) / (1 − margem% − comissão% − nf%)
    const denom = 1 - (margemPct + comissaoPct + nfPct) / 100;
    const impossivel = denom <= 0;

    const numerador = custo - (nf === 'serv' ? (nfPct / 100) * vKit : 0);
    const preco = !impossivel && custo > 0 ? numerador / denom : 0;
    const lucro = preco * (margemPct / 100);
    const valComissao = preco * (comissaoPct / 100);
    // Base da NF: serviço = preço − kit (parte de serviço); total = preço inteiro.
    const nfBase = nf === 'serv' ? Math.max(0, preco - vKit) : preco;
    const valNf = nf === 'nenhuma' ? 0 : (nfBase * nfPct) / 100;

    return { linhas, custo, margemPct, comissaoPct, nfPct, denom, impossivel, preco, lucro, valComissao, valNf };
  }, [valores, kit, ca, margem, comissao, nf, nfPctInput]);

  // Registra 'calc' uma única vez, quando o cliente chega a um preço válido.
  useEffect(() => {
    if (calcLogged.current) return;
    if (r.preco > 0 && !r.impossivel) {
      calcLogged.current = true;
      logUso('calc');
    }
  }, [r.preco, r.impossivel]);

  return (
    <div className="prec-wrap">
      <header className="prec-hero">
        <span className="prec-beta">
          ⚡ Beta · uso de teste — esta ferramenta pode ser encerrada a qualquer momento
        </span>
        <h1>Calculadora de Precificação</h1>
        <p>Descubra o preço de venda certo do seu projeto solar</p>
      </header>

      <div className="prec-grid">
        {/* ── ENTRADAS ── */}
        <div className="prec-col">
          <section className="prec-card">
            <div className="prec-card-title">Custos do projeto</div>

            <div className="prec-field">
              <label>
                Valor do kit <span className="hint">(painéis, inversor, estrutura)</span>
              </label>
              <div className="prec-inp">
                <span className="pre">R$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={kit}
                  onChange={(e) => onKitChange(e.target.value)}
                />
              </div>
            </div>

            <div className="prec-field">
              <label>
                Material C.A <span className="hint">(padrão: 10% do kit — editável)</span>
              </label>
              <div className="prec-inp">
                <span className="pre">R$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={ca}
                  onChange={(e) => onCaChange(e.target.value)}
                />
              </div>
            </div>

            {CUSTOS.map((c) => (
              <div className="prec-field" key={c.key}>
                <label>
                  {c.label}
                  {c.hint && <span className="hint"> ({c.hint})</span>}
                </label>
                <div className="prec-inp">
                  <span className="pre">R$</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={valores[c.key] ?? ''}
                    onChange={(e) => set(c.key, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </section>

          <section className="prec-card">
            <div className="prec-card-title">Lucro e comissão</div>
            <div className="prec-field">
              <label>
                Margem de lucro alvo <span className="hint">(sobre o preço de venda)</span>
              </label>
              <div className="prec-inp pct">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="30"
                  value={margem}
                  onChange={(e) => setMargem(e.target.value)}
                />
                <span className="suf">%</span>
              </div>
            </div>
            <div className="prec-field">
              <label>
                Comissão do vendedor <span className="hint">(sobre o preço de venda)</span>
              </label>
              <div className="prec-inp pct">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={comissao}
                  onChange={(e) => setComissao(e.target.value)}
                />
                <span className="suf">%</span>
              </div>
            </div>
            <div className="prec-field">
              <label>Nota fiscal</label>
              <div className="prec-nf-opts">
                <label className="prec-nf-opt">
                  <input
                    type="radio"
                    name="prec-nf"
                    checked={nf === 'nenhuma'}
                    onChange={() => setNf('nenhuma')}
                  />
                  Sem NF
                </label>
                <label className="prec-nf-opt">
                  <input
                    type="radio"
                    name="prec-nf"
                    checked={nf === 'serv'}
                    onChange={() => setNf('serv')}
                  />
                  NF de serviço <span className="hint">(% sobre total − kit)</span>
                </label>
                <label className="prec-nf-opt">
                  <input
                    type="radio"
                    name="prec-nf"
                    checked={nf === 'total'}
                    onChange={() => setNf('total')}
                  />
                  NF total <span className="hint">(% sobre o total)</span>
                </label>
              </div>

              {nf !== 'nenhuma' && (
                <div className="prec-nf-pct">
                  <label>
                    Alíquota da NF <span className="hint">(editável — padrão 6%)</span>
                  </label>
                  <div className="prec-inp pct">
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="6"
                      value={nfPctInput}
                      onChange={(e) => setNfPctInput(e.target.value)}
                    />
                    <span className="suf">%</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── RESULTADO ── */}
        <div className="prec-col">
          <section className="prec-card">
            <div className="prec-card-title">Resultado</div>

            <div className="prec-breakdown">
              {r.linhas.map((l) => (
                <div className="brow" key={l.key}>
                  <span className="lbl">{l.label}</span>
                  <span className="val">{fmt(l.valor)}</span>
                </div>
              ))}
              <div className="brow total">
                <span className="lbl">Custo direto</span>
                <span className="val">{fmt(r.custo)}</span>
              </div>
              {r.nfPct > 0 && !r.impossivel && r.preco > 0 && (
                <div className="brow">
                  <span className="lbl">
                    {(nf === 'serv' ? 'NF de serviço' : 'NF total')}{' '}
                    ({r.nfPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%)
                  </span>
                  <span className="val">{fmt(r.valNf)}</span>
                </div>
              )}
            </div>

            <div className="prec-price">
              <div className="cap">Preço de venda sugerido</div>
              <div className="big">{r.impossivel ? '—' : fmt(r.preco)}</div>
              <div className="small">
                {r.custo <= 0
                  ? 'Defina os custos acima'
                  : r.impossivel
                  ? 'Reveja os percentuais'
                  : `Margem real de ${r.margemPct.toFixed(0)}% garantida`}
              </div>
            </div>

            {r.impossivel ? (
              <div className="prec-warn">
                ⚠️ Margem + comissão{r.nfPct > 0 ? ' + NF' : ''} somam{' '}
                {(r.margemPct + r.comissaoPct + r.nfPct).toFixed(0)}% (≥100%). É
                impossível precificar — reduza um deles.
              </div>
            ) : (
              <div className={`prec-kpis${r.nfPct > 0 ? '' : ' duas'}`}>
                <div className="kpi">
                  <div className="k">Lucro líquido</div>
                  <div className="v grn">{fmt(r.lucro)}</div>
                </div>
                <div className="kpi">
                  <div className="k">Comissão</div>
                  <div className="v info">{fmt(r.valComissao)}</div>
                </div>
                {r.nfPct > 0 && (
                  <div className="kpi">
                    <div className="k">Nota fiscal</div>
                    <div className="v">{fmt(r.valNf)}</div>
                  </div>
                )}
              </div>
            )}

            <p className="prec-foot">
              Margem, comissão{' '}
              {r.nfPct > 0 ? 'e nota fiscal incidem' : 'incidem'} <b>sobre o preço de venda</b>{' '}
              (padrão do mercado).
              <br />
              Preço&nbsp;=&nbsp;Custo&nbsp;÷&nbsp;(1&nbsp;−&nbsp;margem%&nbsp;−&nbsp;comissão%
              {r.nfPct > 0 ? ' − NF%' : ''})
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
