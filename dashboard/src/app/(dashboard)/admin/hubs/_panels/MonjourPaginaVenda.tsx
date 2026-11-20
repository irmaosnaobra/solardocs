// Bloco "Página de venda" do painel do funil Monjour: a venda direta em /plan/,
// separada do funil do quiz. Cinco números em sequência e a taxa de passagem
// de um para o próximo. O campo paginaVenta é opcional (a api e o dashboard
// sobem em deploys separados): sem ele o bloco mostra "sem visitas".
import s from './MonjourFunilPanel.module.css';
import { Titulo, fmtInt, fmtPct } from './monjourComum';
import type { FunilMonjour } from './hubMonjour.types';

type Passo = { chave: string; rotulo: string; valor: number; compra?: boolean };

export default function MonjourPaginaVenda({ pv }: { pv?: FunilMonjour['paginaVenta'] }) {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const visitas = n(pv?.visitas);
  // Compra que chega no período sem a visita (visitou ontem, pagou hoje) também precisa aparecer.
  const temDados = visitas > 0 || n(pv?.planes) > 0 || n(pv?.compra) > 0 || n(pv?.checkouts) > 0 || n(pv?.compras) > 0;
  const passos: Passo[] = [
    { chave: 'visitas', rotulo: 'Visitas', valor: visitas },
    { chave: 'planes', rotulo: 'Viram os planos', valor: n(pv?.planes) },
    { chave: 'compra', rotulo: 'Abriram a compra', valor: n(pv?.compra) },
    { chave: 'checkouts', rotulo: 'Foram pagar', valor: n(pv?.checkouts) },
    { chave: 'compras', rotulo: 'Compraram', valor: n(pv?.compras), compra: true },
  ];

  return (
    <section className={s.bloco} aria-labelledby="mj-pv">
      <div className={s.blocoTopo}>
        <span id="mj-pv">
          <Titulo dica="Quem entrou direto na página de venda, sem passar pelo quiz. Cada porcentagem é de quem estava no passo anterior. Foram pagar = clicaram em pagar e seguiram para a Stripe.">
            Página de venda
          </Titulo>
        </span>
        <span className={s.pvNota}>Visitas a /plan/, separadas do funil do quiz.</span>
      </div>

      {temDados ? (
        <ol className={s.pvPassos}>
          {passos.map((p, i) => (
            <li key={p.chave} className={`${s.pvPasso} ${p.compra ? s.pvCompra : ''}`}>
              <span className={s.pvRotulo}>{p.rotulo}</span>
              <span className={s.pvValor}>{fmtInt(p.valor)}</span>
              <span className={s.pvTaxa}>
                {i === 0 ? 'Abriram a página'
                  : !passos[i - 1].valor ? <b>–</b>
                  : <><b>{fmtPct(p.valor, passos[i - 1].valor, 1)}</b> do passo anterior</>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={s.pvVazio}>Sem visitas na página de venda neste período.</p>
      )}
    </section>
  );
}
