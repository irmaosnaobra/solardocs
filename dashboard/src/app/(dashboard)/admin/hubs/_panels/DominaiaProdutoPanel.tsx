'use client';

// A Domina IA dentro do hub "Produtos" (24/11/2026), ao lado dos outros produtos.
// Um período só para todas as sub-abas: escolheu 30 dias na Visão geral, o Funil já abre
// em 30 dias. Vendas, leads e app vêm de /admin/dominaia/resumo; o funil, de /quiz-funil.
// No topo, acima das sub-abas, a faixa dos países: bandeira, hora local e vendas no período.
import DominaiaFunilPanel from './DominaiaFunilPanel';
import DominaiaVisaoPanel from './DominaiaVisaoPanel';
import DominaiaVendasPanel from './DominaiaVendasPanel';
import DominaiaLeadsPanel from './DominaiaLeadsPanel';
import { DominaiaAnunciosPanel, DominaiaAppPanel } from './DominaiaAppAnuncios';
import { DominaiaResumoProvider, useResumoDominaia } from './DominaiaResumoContexto';
import SubAbas, { type SubAba } from './SubAbas';
import DominaiaPaises from './DominaiaPaises';

function FunilNoPeriodo() {
  const { periodo, trocarPeriodo, informarVisitas } = useResumoDominaia();
  return <DominaiaFunilPanel periodo={periodo} onPeriodo={trocarPeriodo} onVisitas={informarVisitas} />;
}

const ABAS: SubAba[] = [
  { key: 'visao',    label: 'Visão geral', Comp: DominaiaVisaoPanel },
  { key: 'funil',    label: 'Funil',       Comp: FunilNoPeriodo },
  { key: 'vendas',   label: 'Vendas',      Comp: DominaiaVendasPanel },
  { key: 'leads',    label: 'Leads',       Comp: DominaiaLeadsPanel },
  { key: 'app',      label: 'App',         Comp: DominaiaAppPanel },
  { key: 'anuncios', label: 'Anúncios',    Comp: DominaiaAnunciosPanel },
];

export default function DominaiaProdutoPanel() {
  return (
    <DominaiaResumoProvider>
      <DominaiaPaises />
      <SubAbas abas={ABAS} />
    </DominaiaResumoProvider>
  );
}
