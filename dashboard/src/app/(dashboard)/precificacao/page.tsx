'use client';

import { useState, useMemo } from 'react';
import './precificacao.css';

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

const CUSTOS: CampoCusto[] = [
  { key: 'equip', label: 'Equipamento / Kit', hint: 'painéis, inversor, estrutura' },
  { key: 'ca',    label: 'Material C.A',       hint: 'material elétrico' },
  { key: 'mao',   label: 'Mão de obra / Instalação' },
  { key: 'art',   label: 'Homologação / ART',  hint: 'projeto, engenharia, concessionária' },
  { key: 'desl',  label: 'Deslocamento / Logística', hint: 'combustível, frete' },
];

export default function PrecificacaoPage() {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [margem, setMargem] = useState('30');
  const [comissao, setComissao] = useState('0');
  const [imposto, setImposto] = useState('6');

  const set = (key: string, v: string) =>
    setValores((prev) => ({ ...prev, [key]: v }));

  const r = useMemo(() => {
    const linhas = CUSTOS.map((c) => ({ ...c, valor: num(valores[c.key]) }));
    const custo = linhas.reduce((s, l) => s + l.valor, 0);
    const margemPct = num(margem);
    const comissaoPct = num(comissao);
    const impostoPct = num(imposto);

    // Margem, comissão e imposto incidem sobre a RECEITA → todos no mesmo denominador.
    // (Imposto = Simples Nacional sobre o faturamento.) Custos fixos ficam no numerador.
    // Preço = Custo / (1 − margem% − comissão% − imposto%)
    const denom = 1 - (margemPct + comissaoPct + impostoPct) / 100;
    const impossivel = denom <= 0;

    const preco = !impossivel && custo > 0 ? custo / denom : 0;
    const lucro = preco * (margemPct / 100);
    const valComissao = preco * (comissaoPct / 100);
    const valImposto = preco * (impostoPct / 100);

    return { linhas, custo, margemPct, comissaoPct, impostoPct, denom, impossivel, preco, lucro, valComissao, valImposto };
  }, [valores, margem, comissao, imposto]);

  return (
    <div className="prec-wrap">
      <header className="prec-hero">
        <h1>Calculadora de Precificação</h1>
        <p>Descubra o preço de venda certo do seu projeto solar</p>
      </header>

      <div className="prec-grid">
        {/* ── ENTRADAS ── */}
        <div className="prec-col">
          <section className="prec-card">
            <div className="prec-card-title">Custos do projeto</div>
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
              <label>
                Impostos <span className="hint">(Simples Nacional sobre a venda)</span>
              </label>
              <div className="prec-inp pct">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="6"
                  value={imposto}
                  onChange={(e) => setImposto(e.target.value)}
                />
                <span className="suf">%</span>
              </div>
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
                ⚠️ Margem + comissão + impostos somam{' '}
                {(r.margemPct + r.comissaoPct + r.impostoPct).toFixed(0)}% (≥100%). É impossível
                precificar — reduza um deles.
              </div>
            ) : (
              <div className="prec-kpis">
                <div className="kpi">
                  <div className="k">Lucro líquido</div>
                  <div className="v grn">{fmt(r.lucro)}</div>
                </div>
                <div className="kpi">
                  <div className="k">Comissão</div>
                  <div className="v info">{fmt(r.valComissao)}</div>
                </div>
                <div className="kpi">
                  <div className="k">Impostos</div>
                  <div className="v">{fmt(r.valImposto)}</div>
                </div>
              </div>
            )}

            <p className="prec-foot">
              Margem, comissão e impostos incidem <b>sobre o preço de venda</b> (padrão do mercado).
              <br />
              Preço&nbsp;=&nbsp;Custo&nbsp;÷&nbsp;(1&nbsp;−&nbsp;margem%&nbsp;−&nbsp;comissão%&nbsp;−&nbsp;impostos%)
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
