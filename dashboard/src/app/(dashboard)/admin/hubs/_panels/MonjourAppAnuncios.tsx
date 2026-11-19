'use client';

// App e Anúncios do Monjour.
// App: o caminho de quem comprou dentro do app (lp_events), contado por pessoa.
// Anúncios: leads, compras e receita por anúncio (utm_content). Gasto e custo por venda
// só entram quando a conta de anúncios CONTA 02 der acesso ao usuário de sistema da SolarDoc.
import s from './MonjourFunilPanel.module.css';
import r from './MonjourResumo.module.css';
import { Titulo, fmtInt, fmtPct, fmtUsd } from './monjourComum';
import { anuncioDe } from './monjourResumoComum';
import { MonjourTopo, useResumoMonjour } from './MonjourResumoContexto';

// ── App ─────────────────────────────────────────────────────────────────────
export function MonjourAppPanel() {
  const { dados } = useResumoMonjour();
  if (!dados) return <div className={s.raiz}><MonjourTopo /></div>;
  const { app, vendas } = dados;
  const passos = [
    ...(dados.indisponivel ? [] : [{ k: 'compraram', rotulo: 'Compraram', valor: vendas.compras, dica: 'Primeira compra no período' }]),
    { k: 'abriram', rotulo: 'Abriram o app', valor: app.abriram, dica: 'Entraram com o link do e-mail' },
    { k: 'instalaram', rotulo: 'Instalaram', valor: app.instalaram, dica: 'Puseram o app na tela do celular' },
    { k: 'upgrade', rotulo: 'Clicaram no upgrade', valor: app.upgradeClicks, dica: 'Tocaram em passar para o Plus' },
    ...(dados.indisponivel ? [] : [{ k: 'pagaram', rotulo: 'Pagaram o upgrade', valor: vendas.upgrades, dica: 'Upgrade pago na Stripe' }]),
  ];
  const maior = Math.max(1, ...passos.map((p) => p.valor));
  const nada = passos.every((p) => p.valor === 0);

  return (
    <div className={s.raiz}>
      <MonjourTopo semAvisoDeVendas />
      {nada ? (
        <div className={`${s.bloco} ${s.vazio}`}>
          <strong>Ninguém abriu o app neste período.</strong>
          <span>O app conta a partir do primeiro acesso de quem comprou.</span>
        </div>
      ) : (
        <section className={s.bloco} aria-labelledby="mj-app-cam">
          <div className={s.blocoTopo}>
            <span id="mj-app-cam">
              <Titulo dica="Cada linha conta pessoas. A porcentagem compara com a linha de cima. Quem comprou antes do período pode abrir o app agora, por isso uma linha pode passar a de cima. Compras contam dias inteiros de São Paulo, com hoje. O app conta as últimas horas corridas do período.">
                Depois da compra
              </Titulo>
            </span>
          </div>
          <ol className={r.passos}>
            {passos.map((p, i) => {
              const antes = i > 0 ? passos[i - 1].valor : 0;
              return (
                <li key={p.k} className={r.passo}>
                  <div className={r.passoTexto}>
                    <span className={r.passoRotulo}>{p.rotulo}</span>
                    <span className={r.passoDica}>{p.dica}</span>
                  </div>
                  <div className={r.passoBarra} aria-hidden="true">
                    <span className={p.k === 'compraram' || p.k === 'pagaram' ? r.barraCompra : undefined}
                      style={{ width: `${p.valor ? Math.max(3, (p.valor / maior) * 100) : 0}%` }} />
                  </div>
                  <div className={r.passoNum}>
                    <b>{fmtInt(p.valor)}</b>
                    {i > 0 && antes > 0 && p.valor <= antes && <span>{fmtPct(p.valor, antes)}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
          {dados.indisponivel && <p className={r.nota}>Compras e upgrades pagos voltam quando o site do Monjour responder.</p>}
        </section>
      )}
    </div>
  );
}

// ── Anúncios ────────────────────────────────────────────────────────────────
type PorAnuncio = { nome: string; leads: number; leadsCompraram: number; compras: number; receita: number };

export function MonjourAnunciosPanel() {
  const { dados } = useResumoMonjour();
  const mapa = new Map<string, PorAnuncio>();
  const linha = (utm: string) => {
    const nome = anuncioDe(utm);
    const atual = mapa.get(nome) ?? { nome, leads: 0, leadsCompraram: 0, compras: 0, receita: 0 };
    mapa.set(nome, atual);
    return atual;
  };
  for (const l of dados?.leads.lista ?? []) { const a = linha(l.utmContent); a.leads += 1; if (l.comprou) a.leadsCompraram += 1; }
  for (const v of dados?.vendas.lista ?? []) {
    const a = linha(v.utmContent);
    if (v.tipo === 'compra') a.compras += 1;
    a.receita += v.valorCentavos;
  }
  const linhas = [...mapa.values()].sort((a, b) => b.receita - a.receita || b.compras - a.compras || b.leads - a.leads);

  return (
    <div className={s.raiz}>
      <MonjourTopo />

      <section className={`${s.bloco} ${r.pendente}`} aria-labelledby="mj-gasto">
        <h3 id="mj-gasto" className={s.blocoTitulo}>Gasto e custo por venda ainda não aparecem</h3>
        <p>Eles entram quando a conta de anúncios CONTA 02 der acesso ao usuário de sistema da SolarDoc.</p>
        <p>Até lá, nenhum número de gasto é estimado aqui. Abaixo estão só leads, compras e receita, que já são reais.</p>
      </section>

      {dados && linhas.length > 0 && (
        <section className={s.bloco} aria-labelledby="mj-por-anuncio">
          <div className={s.blocoTopo}>
            <span id="mj-por-anuncio">
              <Titulo dica="Anúncio é o utm_content do link. Sem anúncio = entrou direto, pelo orgânico ou é upgrade (o upgrade não guarda o anúncio). Lead para compra = leads deste anúncio que compraram. Conta a partir das listas de Vendas e Leads.">
                Por anúncio
              </Titulo>
            </span>
          </div>
          <div className={r.rolagem}>
            <table className={r.tabela}>
              <thead>
                <tr>
                  <th scope="col">Anúncio</th><th scope="col" className={r.direita}>Leads</th><th scope="col" className={r.direita}>Compras</th>
                  <th scope="col" className={r.direita}>Lead para compra</th><th scope="col" className={r.direita}>Receita</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((a) => (
                  <tr key={a.nome}>
                    <td className={r.anuncioLargo} title={a.nome}>{a.nome === 'Sem anúncio' ? <span className={r.mudo}>Sem anúncio</span> : a.nome}</td>
                    <td className={r.direita}>{fmtInt(a.leads)}</td>
                    <td className={r.direita}>{fmtInt(a.compras)}</td>
                    <td className={r.direita}>{a.leads ? fmtPct(a.leadsCompraram, a.leads, 1) : '—'}</td>
                    <td className={`${r.direita} ${r.forte}`}>{fmtUsd(a.receita)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {dados && !dados.indisponivel && linhas.length === 0 && (
        <div className={`${s.bloco} ${s.vazio}`}>
          <strong>Nenhum lead nem venda neste período.</strong>
          <span>Quando chegarem, cada anúncio aparece aqui com o que trouxe.</span>
        </div>
      )}
    </div>
  );
}
