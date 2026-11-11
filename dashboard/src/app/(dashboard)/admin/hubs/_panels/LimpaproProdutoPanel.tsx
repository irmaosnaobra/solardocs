'use client';

// O LimpaPro dentro do hub "Produtos": as mesmas 8 abas que ele tinha como hub próprio,
// com os mesmos painéis e as mesmas props. `produto="limpapro"` e `agent="bia"` são
// chaves da API, não mude.
import FunilLimpaproPanel from '../../_components/FunilLimpaproPanel';
import MembrosLimpaproPanel from '../../_components/MembrosLimpaproPanel';
import VisaoGeralPanel from './VisaoGeralPanel';
import LpLimpaproPanel from './LpLimpaproPanel';
import FollowupPanel from './FollowupPanel';
import AgentePanel from './AgentePanel';
import ConversasPanel from './ConversasPanel';
import ConfigAlertasPanel from './ConfigAlertasPanel';
import SubAbas, { type SubAba } from './SubAbas';

const ABAS: SubAba[] = [
  { key: 'visao',     label: 'Visão Geral',      Comp: () => <VisaoGeralPanel produto="limpapro" /> },
  { key: 'funil',     label: 'Funil',            Comp: FunilLimpaproPanel },
  { key: 'membros',   label: 'Membros',          Comp: MembrosLimpaproPanel },
  { key: 'lp',        label: 'Página de Venda',  Comp: LpLimpaproPanel },
  { key: 'followup',  label: 'Followup',         Comp: () => <FollowupPanel produto="limpapro" /> },
  { key: 'agente',    label: 'Agente',           Comp: () => <AgentePanel agent="bia" /> },
  { key: 'conversas', label: 'Conversas',        Comp: () => <ConversasPanel produto="limpapro" /> },
  { key: 'config',    label: 'Config & Alertas', Comp: () => <ConfigAlertasPanel produto="limpapro" /> },
];

export default function LimpaproProdutoPanel() {
  return <SubAbas abas={ABAS} />;
}
