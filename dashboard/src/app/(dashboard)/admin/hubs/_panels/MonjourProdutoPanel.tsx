'use client';

// O Monjour Natural dentro do hub "Produtos" (19/11/2026), ao lado dos outros produtos.
// Um período só para todas as sub-abas: escolheu 30 dias na Visão geral, o Funil já abre
// em 30 dias. Vendas, leads e app vêm de /admin/monjour/resumo; o funil, de /quiz-funil.
import MonjourFunilPanel from './MonjourFunilPanel';
import MonjourVisaoPanel from './MonjourVisaoPanel';
import MonjourVendasPanel from './MonjourVendasPanel';
import MonjourLeadsPanel from './MonjourLeadsPanel';
import { MonjourAnunciosPanel, MonjourAppPanel } from './MonjourAppAnuncios';
import { MonjourResumoProvider, useResumoMonjour } from './MonjourResumoContexto';
import SubAbas, { type SubAba } from './SubAbas';

function FunilNoPeriodo() {
  const { periodo, trocarPeriodo } = useResumoMonjour();
  return <MonjourFunilPanel periodo={periodo} onPeriodo={trocarPeriodo} />;
}

const ABAS: SubAba[] = [
  { key: 'visao',    label: 'Visão geral', Comp: MonjourVisaoPanel },
  { key: 'funil',    label: 'Funil',       Comp: FunilNoPeriodo },
  { key: 'vendas',   label: 'Vendas',      Comp: MonjourVendasPanel },
  { key: 'leads',    label: 'Leads',       Comp: MonjourLeadsPanel },
  { key: 'app',      label: 'App',         Comp: MonjourAppPanel },
  { key: 'anuncios', label: 'Anúncios',    Comp: MonjourAnunciosPanel },
];

export default function MonjourProdutoPanel() {
  return (
    <MonjourResumoProvider>
      <SubAbas abas={ABAS} />
    </MonjourResumoProvider>
  );
}
