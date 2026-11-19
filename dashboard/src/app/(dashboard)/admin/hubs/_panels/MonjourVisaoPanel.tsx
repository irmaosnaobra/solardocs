'use client';

// Visão geral do Monjour: os números do período (Stripe, pelo site do Monjour),
// compras e receita por dia e por país. Sem venda inventada: site fora = aviso.
import { useState } from 'react';
import admin from '../../admin.module.css';
import s from './MonjourFunilPanel.module.css';
import r from './MonjourResumo.module.css';
import { Numero, Titulo, fmtInt, fmtPct, fmtUsd } from './monjourComum';
import { GraficoDias, nomePais } from './monjourResumoComum';
import { MonjourTopo, useResumoMonjour } from './MonjourResumoContexto';

export default function MonjourVisaoPanel() {
  const { dados } = useResumoMonjour();
  const [medida, setMedida] = useState<'compras' | 'receita'>('receita');
  const v = dados?.vendas, l = dados?.leads;
  const pagamentos = v ? v.compras + v.upgrades : 0;
  const vazio = !!dados && !dados.indisponivel && pagamentos === 0 && (l?.total ?? 0) === 0;
  const totalPais = v ? v.porPais.reduce((t, p) => t + p.receitaCentavos, 0) : 0;

  return (
    <div className={s.raiz}>
      <MonjourTopo />

      {dados?.indisponivel && (
        <div className={`${s.bloco} ${s.vazio}`}>
          <strong>Sem vendas para mostrar até o site responder.</strong>
          <span>O que o app registrou está na aba App.</span>
        </div>
      )}
      {vazio && (
        <div className={`${s.bloco} ${s.vazio}`}>
          <strong>Nenhuma venda e nenhum lead neste período.</strong>
          <span>Escolha um período maior ou veja o Funil.</span>
        </div>
      )}

      {dados && v && l && !dados.indisponivel && !vazio && (
        <>
          <div className={s.numeros}>
            <Numero rotulo="Compras" valor={fmtInt(v.compras)} sub={`Básico ${fmtInt(v.comprasBasico)} · Plus ${fmtInt(v.comprasPlus)}`} compra />
            <Numero rotulo="Receita" valor={fmtUsd(v.receitaCentavos)} sub={v.upgrades ? 'Bruta, com os upgrades' : 'Bruta, em dólar'} />
            <Numero rotulo="Ticket médio" valor={pagamentos ? fmtUsd(v.ticketMedioCentavos) : '—'} sub="Por pagamento" />
            <Numero rotulo="Lead para compra" valor={fmtPct(l.compraram, l.total, 1)} sub={`${fmtInt(l.compraram)} de ${fmtInt(l.total)} leads`} />
            <Numero rotulo="Leads" valor={fmtInt(l.total)} sub="Deixaram o e-mail" />
            <Numero rotulo="Upgrades" valor={fmtInt(v.upgrades)} sub="Do Básico para o Plus" />
            <div className={`${s.numero} ${v.reembolsos ? r.numeroAtencao : ''}`}>
              <div className={s.numeroRotulo}>Reembolsos</div>
              <div className={s.numeroValor}>{fmtInt(v.reembolsos)}</div>
              <div className={s.numeroSub}>{v.reembolsos ? `${fmtUsd(v.reembolsadoCentavos)} devolvidos` : 'Nenhum no período'}</div>
            </div>
            <div className={`${s.numero} ${v.contestacoes ? r.numeroRuim : ''}`}>
              <div className={s.numeroRotulo}>Contestações</div>
              <div className={s.numeroValor}>{fmtInt(v.contestacoes)}</div>
              <div className={s.numeroSub}>{v.contestacoes ? 'Responda na Stripe' : 'Nenhuma no período'}</div>
            </div>
          </div>

          <div className={r.duasLargas}>
            <section className={s.bloco} aria-labelledby="mj-dia">
              <div className={s.blocoTopo}>
                <span id="mj-dia">
                  <Titulo dica="Compras contam só a primeira compra. A receita soma compras e upgrades, antes de reembolso.">Por dia</Titulo>
                </span>
                <div className={s.periodos} role="group" aria-label="Medida do gráfico">
                  {(['receita', 'compras'] as const).map((m) => (
                    <button key={m} type="button" aria-pressed={medida === m}
                      className={medida === m ? admin.periodActive : admin.periodBtn} onClick={() => setMedida(m)}>
                      {m === 'receita' ? 'Receita' : 'Compras'}
                    </button>
                  ))}
                </div>
              </div>
              {v.porDia.length > 1 ? (
                <GraficoDias moeda={medida === 'receita'} nome={medida === 'receita' ? 'Receita' : 'Compras'}
                  pontos={v.porDia.map((d) => ({ dia: d.dia, valor: medida === 'receita' ? d.receitaCentavos : d.compras }))} />
              ) : (
                <p className={r.nota}>O período tem um dia só. Os números de cima já são o dia.</p>
              )}
            </section>

            <section className={s.bloco} aria-labelledby="mj-pais">
              <div className={s.blocoTopo}>
                <span id="mj-pais">
                  <Titulo dica="País do endereço de cobrança informado no checkout da Stripe. A parte é a fatia da receita do período.">Por país</Titulo>
                </span>
              </div>
              {v.porPais.length === 0 ? (
                <p className={r.nota}>Nenhuma venda com país neste período.</p>
              ) : (
                <ul className={r.paises}>
                  {v.porPais.map((p) => {
                    const parte = totalPais ? p.receitaCentavos / totalPais : 0;
                    return (
                      <li key={p.pais} className={r.pais}>
                        <div className={r.paisLinha}>
                          <span className={r.paisNome}>{nomePais(p.pais)}</span>
                          <span className={r.paisValor}>{fmtUsd(p.receitaCentavos)}</span>
                        </div>
                        <div className={r.trilho} aria-hidden="true"><span style={{ width: `${Math.max(2, parte * 100)}%` }} /></div>
                        <div className={r.paisSub}>
                          {fmtInt(p.compras)} {p.compras === 1 ? 'compra' : 'compras'} · {fmtPct(p.receitaCentavos, totalPais)} da receita
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
