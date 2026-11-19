'use client';

// O Monjour Natural dentro do hub "Produtos" (19/11/2026), ao lado dos outros produtos.
// Um período só para todas as sub-abas: escolheu 30 dias na Visão geral, o Funil já abre
// em 30 dias. Vendas, leads e app vêm de /admin/monjour/resumo; o funil, de /quiz-funil.
// No topo, acima das sub-abas, a faixa dos países: bandeira, hora local e vendas no período.
// Membros (19/11/2026): quem comprou, o que faz no app e o que mais gostam.
import MonjourFunilPanel from './MonjourFunilPanel';
import MonjourVisaoPanel from './MonjourVisaoPanel';
import MonjourVendasPanel from './MonjourVendasPanel';
import MonjourLeadsPanel from './MonjourLeadsPanel';
import MonjourMembrosPanel from './MonjourMembrosPanel';
import { MonjourAnunciosPanel, MonjourAppPanel } from './MonjourAppAnuncios';
import { MonjourResumoProvider, useResumoMonjour } from './MonjourResumoContexto';
import SubAbas, { type SubAba } from './SubAbas';
import MonjourPaises from './MonjourPaises';

function FunilNoPeriodo() {
  const { periodo, trocarPeriodo, informarVisitas } = useResumoMonjour();
  return <MonjourFunilPanel periodo={periodo} onPeriodo={trocarPeriodo} onVisitas={informarVisitas} />;
}

const ABAS: SubAba[] = [
  { key: 'visao',    label: 'Visão geral', Comp: MonjourVisaoPanel },
  { key: 'funil',    label: 'Funil',       Comp: FunilNoPeriodo },
  { key: 'vendas',   label: 'Vendas',      Comp: MonjourVendasPanel },
  { key: 'leads',    label: 'Leads',       Comp: MonjourLeadsPanel },
  { key: 'membros',  label: 'Membros',     Comp: MonjourMembrosPanel },
  { key: 'app',      label: 'App',         Comp: MonjourAppPanel },
  { key: 'anuncios', label: 'Anúncios',    Comp: MonjourAnunciosPanel },
];

export default function MonjourProdutoPanel() {
  return (
    <MonjourResumoProvider>
      <MonjourPaises />
      <SubAbas abas={ABAS} />
    </MonjourResumoProvider>
  );
}
