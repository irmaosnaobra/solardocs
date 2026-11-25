'use client';

// Leads da Domina IA: quem deixou o e-mail no quiz, quantos por dia e quem comprou.
// Vem do resumo da api, que devolve no máximo 500.
import { useState } from 'react';
import admin from '../../admin.module.css';
import s from './DominaiaFunilPanel.module.css';
import r from './DominaiaResumo.module.css';
import { Numero, Titulo, fmtInt, fmtPct } from './dominaiaComum';
import { Busca, GraficoDias, anuncioDe, fmtQuando } from './dominaiaResumoComum';
import { DominaiaTopo, useResumoDominaia } from './DominaiaResumoContexto';

const FILTROS = [
  { k: 'todos', label: 'Todos' }, { k: 'comprou', label: 'Compraram' }, { k: 'nao', label: 'Ainda não compraram' },
];

const PAGINA = 50;

export default function DominaiaLeadsPanel() {
  const { dados } = useResumoDominaia();
  const [filtro, setFiltro] = useState('todos');
  const [busca, setBusca] = useState('');
  const [limite, setLimite] = useState(PAGINA);
  const l = dados?.leads;
  const todos = l?.lista ?? [];
  const termo = busca.trim().toLowerCase();
  const linhas = todos.filter((x) => (filtro === 'todos' || (filtro === 'comprou') === x.comprou) && (!termo || x.email.includes(termo)));
  const aceitaram = todos.filter((x) => x.consent).length;

  return (
    <div className={s.raiz}>
      <DominaiaTopo />

      {dados && l && !dados.indisponivel && l.total === 0 && (
        <div className={`${s.bloco} ${s.vazio}`}>
          <strong>Nenhum lead neste período.</strong>
          <span>Lead é quem deixa o e-mail no fim do quiz.</span>
        </div>
      )}

      {dados && l && l.total > 0 && (
        <>
          <div className={s.numeros}>
            <Numero rotulo="Leads" valor={fmtInt(l.total)} sub="Deixaram o e-mail" />
            <Numero rotulo="Compraram" valor={fmtInt(l.compraram)} sub="Entre esses leads" compra />
            <Numero rotulo="Lead para compra" valor={fmtPct(l.compraram, l.total, 1)} sub="Conversão" />
            <Numero rotulo="Aceitaram e-mails" valor={fmtPct(aceitaram, todos.length)}
              sub={`${fmtInt(aceitaram)} de ${fmtInt(todos.length)}${todos.length < l.total ? ' da lista' : ''}`} />
          </div>

          <section className={s.bloco} aria-labelledby="dm-leads-dia">
            <div className={s.blocoTopo}>
              <span id="dm-leads-dia">
                <Titulo dica="Dia em que o e-mail chegou, no horário de Brasília.">Leads por dia</Titulo>
              </span>
            </div>
            {l.porDia.length > 1 ? (
              <GraficoDias nome="Leads" pontos={l.porDia.map((d) => ({ dia: d.dia, valor: d.leads }))} />
            ) : (
              <p className={r.nota}>O período tem um dia só: {fmtInt(l.total)} {l.total === 1 ? 'lead' : 'leads'}.</p>
            )}
          </section>

          <section className={s.bloco} aria-labelledby="dm-leads">
            <div className={s.blocoTopo}>
              <h3 id="dm-leads" className={s.blocoTitulo}>Lista de leads</h3>
              <span className={r.resumoLinha}>{fmtInt(linhas.length)} {linhas.length === 1 ? 'lead' : 'leads'}</span>
            </div>
            <div className={r.ferramentas}>
              <div className={s.periodos} role="group" aria-label="Filtrar leads">
                {FILTROS.map((f) => (
                  <button key={f.k} type="button" aria-pressed={filtro === f.k}
                    className={filtro === f.k ? admin.periodActive : admin.periodBtn} onClick={() => setFiltro(f.k)}>
                    {f.label}
                  </button>
                ))}
              </div>
              <Busca id="dm-busca-lead" valor={busca} mudar={setBusca} />
            </div>
            <div className={r.rolagem}>
              <table className={`${r.tabela} ${r.cartoes} ${r.leads}`}>
                <thead>
                  <tr>
                    <th scope="col">Data</th><th scope="col">E-mail</th><th scope="col">Comprou</th>
                    <th scope="col">Aceitou e-mails</th><th scope="col">Anúncio</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.length === 0 && (
                    <tr><td colSpan={5} className={s.vazioCelula}>Nenhum lead com esse filtro.</td></tr>
                  )}
                  {linhas.slice(0, limite).map((x, i) => (
                    <tr key={`${x.quando}-${x.email}-${i}`}>
                      <td data-rotulo="Data" className={r.nowrap}>{fmtQuando(x.quando)}</td>
                      <td data-rotulo="E-mail" className={r.email} title={x.email}>{x.email}</td>
                      <td data-rotulo="Comprou">{x.comprou ? <span className={`${r.selo} ${r.seloBom}`}>Comprou</span> : <span className={r.mudo}>Não comprou</span>}</td>
                      <td data-rotulo="Aceitou e-mails">{x.consent ? 'Sim' : <span className={r.mudo}>Não</span>}</td>
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
            {todos.length < l.total && (
              <p className={r.nota}>Mostrando os {fmtInt(todos.length)} leads mais novos de {fmtInt(l.total)}.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
