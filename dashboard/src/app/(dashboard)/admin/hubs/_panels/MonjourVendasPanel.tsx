'use client';

// Vendas do Monjour: cada pagamento do período (compra ou upgrade), mais novo primeiro.
// O e-mail aparece inteiro porque o painel é interno. A api devolve no máximo 500.
import { useState } from 'react';
import admin from '../../admin.module.css';
import s from './MonjourFunilPanel.module.css';
import r from './MonjourResumo.module.css';
import { fmtInt, fmtUsd } from './monjourComum';
import { Busca, Situacao, anuncioDe, fmtQuando, nomePais, nomePlano, nomeTipo } from './monjourResumoComum';
import { MonjourTopo, useResumoMonjour } from './MonjourResumoContexto';
import type { VendaMonjour } from './hubMonjourResumo.types';
import MonjourCheckoutsSecao from './MonjourCheckoutsSecao';

const FILTROS: { k: string; label: string; ok: (v: VendaMonjour) => boolean }[] = [
  { k: 'todas', label: 'Todas', ok: () => true },
  { k: 'compra', label: 'Compras', ok: (v) => v.tipo === 'compra' },
  { k: 'upgrade', label: 'Upgrades', ok: (v) => v.tipo === 'upgrade' },
  { k: 'problema', label: 'Reembolso ou contestação', ok: (v) => v.reembolsada || v.contestada },
];

const PAGINA = 50;

export default function MonjourVendasPanel() {
  const { dados } = useResumoMonjour();
  const [filtro, setFiltro] = useState('todas');
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(PAGINA);
  const v = dados?.vendas;
  const todas = v?.lista ?? [];
  const pagamentos = v ? v.compras + v.upgrades : 0;
  const ok = FILTROS.find((f) => f.k === filtro)?.ok ?? (() => true);
  const termo = busca.trim().toLowerCase();
  const linhas = todas.filter((x) => ok(x) && (!termo || x.email.includes(termo)));
  const somaLinhas = linhas.reduce((t, x) => t + x.valorCentavos, 0);

  return (
    <div className={s.raiz}>
      <MonjourTopo />

      {dados && !dados.indisponivel && todas.length === 0 && (
        <div className={`${s.bloco} ${s.vazio}`}>
          <strong>Nenhuma venda neste período.</strong>
          <span>Quando alguém pagar, a venda aparece aqui com o e-mail e o anúncio.</span>
        </div>
      )}

      {dados && !dados.indisponivel && <MonjourCheckoutsSecao checkouts={dados.checkouts} />}

      {dados && todas.length > 0 && (
        <section className={s.bloco} aria-labelledby="mj-vendas">
          <div className={s.blocoTopo}>
            <h3 id="mj-vendas" className={s.blocoTitulo}>Vendas</h3>
            <span className={r.resumoLinha}>
              {fmtInt(linhas.length)} {linhas.length === 1 ? 'pagamento' : 'pagamentos'} · {fmtUsd(somaLinhas)}
            </span>
          </div>
          <div className={r.ferramentas}>
            <div className={s.periodos} role="group" aria-label="Filtrar vendas">
              {FILTROS.map((f) => (
                <button key={f.k} type="button" aria-pressed={filtro === f.k}
                  className={filtro === f.k ? admin.periodActive : admin.periodBtn} onClick={() => setFiltro(f.k)}>
                  {f.label}
                </button>
              ))}
            </div>
            <Busca id="mj-busca-venda" valor={busca} mudar={setBusca} />
          </div>

          <div className={r.rolagem}>
            <table className={`${r.tabela} ${r.cartoes} ${r.vendas}`}>
              <thead>
                <tr>
                  <th scope="col">Data</th><th scope="col">E-mail</th><th scope="col">Plano</th><th scope="col">Tipo</th>
                  <th scope="col" className={r.direita}>Valor</th><th scope="col">País</th><th scope="col">Situação</th><th scope="col">Anúncio</th>
                </tr>
              </thead>
              <tbody>
                {linhas.length === 0 && (
                  <tr><td colSpan={8} className={s.vazioCelula}>Nenhuma venda com esse filtro.</td></tr>
                )}
                {linhas.slice(0, limite).map((x, i) => (
                  <tr key={`${x.quando}-${x.email}-${i}`}>
                    <td data-rotulo="Data" className={r.nowrap}>{fmtQuando(x.quando)}</td>
                    <td data-rotulo="E-mail" className={r.email} title={x.email}>{x.email || '—'}</td>
                    <td data-rotulo="Plano">{x.plano === 'plus' ? <span className={`${r.selo} ${r.seloPlus}`}>Plus</span> : nomePlano(x.plano)}</td>
                    <td data-rotulo="Tipo">{nomeTipo(x.tipo)}</td>
                    <td data-rotulo="Valor" className={`${r.direita} ${r.forte}`}>{fmtUsd(x.valorCentavos)}</td>
                    <td data-rotulo="País" className={r.nowrap}>{nomePais(x.pais)}</td>
                    <td data-rotulo="Situação"><Situacao v={x} /></td>
                    <td data-rotulo="Anúncio" className={r.anuncio} title={anuncioDe(x.utmContent)}>
                      {x.utmContent ? x.utmContent : <span className={r.mudo}>Sem anúncio</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {linhas.length > limite && (
            <button type="button" className={`${admin.periodBtn} ${r.mais}`} onClick={() => setLimite((n) => n + PAGINA)}>
              Mostrar mais {fmtInt(Math.min(PAGINA, linhas.length - limite))} (faltam {fmtInt(linhas.length - limite)})
            </button>
          )}
          {todas.length < pagamentos && (
            <p className={r.nota}>Mostrando os {fmtInt(todas.length)} pagamentos mais novos de {fmtInt(pagamentos)}.</p>
          )}
        </section>
      )}
    </div>
  );
}
