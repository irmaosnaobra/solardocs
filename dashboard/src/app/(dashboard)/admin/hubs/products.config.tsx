// ─────────────────────────────────────────────────────────────────────────────
// CONFIG-DRIVEN dos Hubs de Produto (/admin/hubs) — Fase 0.
// Cada produto declara suas abas na MESMA ordem/padrão. Aba com `Comp` renderiza um
// painel real (reuso do que já existe); sem `Comp` mostra placeholder "construir".
// Adicionar produto/aba = editar SÓ este arquivo — a tela (ProductHub) se monta sozinha.
// Alinhado ao mapa aprovado 26/jul (memória admin-solardoc-hubs-produto).
// ─────────────────────────────────────────────────────────────────────────────
import type { ComponentType } from 'react';
import FunilLimpaproPanel from '../_components/FunilLimpaproPanel';
import MembrosLimpaproPanel from '../_components/MembrosLimpaproPanel';
import FunilSolarDocPanel from '../_components/FunilSolarDocPanel';
import MembrosPanel from '../_components/MembrosPanel';
// Fase 1 — painéis próprios do hub (reuso de endpoints existentes)
import AgentePanel from './_panels/AgentePanel';
import ReceitaPanel from './_panels/ReceitaPanel';
import LpVendaPanel from './_panels/LpVendaPanel';
// Fase 2 — Followup + Conversas (endpoint /admin/hub-followup)
import FollowupPanel from './_panels/FollowupPanel';
import ConversasPanel from './_panels/ConversasPanel';
// Fase 3 — Visão Geral / Pulso (agrega endpoints existentes)
import VisaoGeralPanel from './_panels/VisaoGeralPanel';

export type TabStatus = 'pronto' | 'parcial' | 'construir';

export interface HubTab {
  key: string;
  label: string;
  status: TabStatus;
  Comp?: ComponentType;   // painel real quando existe; senão placeholder
  nota?: string;          // o que falta / fonte de dado
}

export interface Product {
  id: string;
  nome: string;
  emoji: string;
  cor: string;
  tabs: HubTab[];
}

export const PRODUCTS: Product[] = [
  {
    id: 'limpapro', nome: 'LimpaPro', emoji: '🧴', cor: '#2C9C67',
    tabs: [
      { key: 'visao',     label: 'Visão Geral',      status: 'pronto',    Comp: () => <VisaoGeralPanel produto="limpapro" /> },
      { key: 'funil',     label: 'Funil',            status: 'pronto',    Comp: FunilLimpaproPanel },
      { key: 'membros',   label: 'Membros',          status: 'pronto',    Comp: MembrosLimpaproPanel },
      { key: 'lp',        label: 'Página de Venda',   status: 'parcial',  nota: 'limpapro_events já captura; consolidar visão visita→checkout.' },
      { key: 'followup',  label: 'Followup',         status: 'pronto',    Comp: () => <FollowupPanel produto="limpapro" /> },
      { key: 'agente',    label: 'Agente',           status: 'pronto',    Comp: () => <AgentePanel agent="bia" /> },
      { key: 'conversas', label: 'Conversas',        status: 'pronto',    Comp: () => <ConversasPanel produto="limpapro" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'construir', nota: 'kill-switches, preço, links de checkout + saúde (LP viva? venda parada?).' },
    ],
  },
  {
    id: 'solardoc', nome: 'SolarDoc', emoji: '☀️', cor: '#B4801E',
    tabs: [
      { key: 'visao',     label: 'Visão Geral',      status: 'pronto',    Comp: () => <VisaoGeralPanel produto="solardoc" /> },
      { key: 'funil',     label: 'Funil',            status: 'pronto',    Comp: FunilSolarDocPanel },
      { key: 'membros',   label: 'Membros',          status: 'pronto',    Comp: MembrosPanel },
      { key: 'lp',        label: 'Página de Venda',   status: 'pronto',   Comp: LpVendaPanel },
      { key: 'followup',  label: 'Followup',         status: 'pronto',    Comp: () => <FollowupPanel produto="solardoc" /> },
      { key: 'agente',    label: 'Agente',           status: 'pronto',    Comp: () => <AgentePanel agent="giovanna" /> },
      { key: 'receita',   label: 'Receita/ROAS',     status: 'pronto',    Comp: ReceitaPanel },
      { key: 'conversas', label: 'Conversas',        status: 'pronto',    Comp: () => <ConversasPanel produto="solardoc" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'construir', nota: 'kill-switches (Pix/dunning), planos, links + saúde.' },
    ],
  },
  {
    id: 'solar', nome: 'Solar', emoji: '🔆', cor: '#3E6C9E',
    tabs: [
      { key: 'visao',     label: 'Visão Geral',      status: 'parcial',   Comp: () => <VisaoGeralPanel produto="solar" /> },
      { key: 'funil',     label: 'Funil',            status: 'parcial',   nota: 'agendamentos created_by=lp_solar (Gerador) — consolidar visita→reunião→venda.' },
      { key: 'membros',   label: 'Leads',            status: 'parcial',   nota: 'agendamentos + CRM SDR (sdr_leads / Luma).' },
      { key: 'lp',        label: 'Página de Venda',   status: 'parcial',  nota: '/io/* em page_visits + site institucional /io.' },
      { key: 'followup',  label: 'Followup',         status: 'pronto',    Comp: () => <FollowupPanel produto="solar" /> },
      { key: 'agente',    label: 'Agente',           status: 'pronto',    Comp: () => <AgentePanel agent="luma" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'construir', nota: 'Extras do hub: Leads por Origem, Link na Bio, Indicações + saúde.' },
    ],
  },
  {
    id: 'eletroposto', nome: 'Eletroposto', emoji: '🔌', cor: '#8B857A',
    tabs: [
      { key: 'visao',     label: 'Visão Geral',      status: 'construir', nota: 'Greenfield — sobe quando houver funil.' },
      { key: 'funil',     label: 'Funil',            status: 'construir', nota: 'Sem funil ainda — construir.' },
      { key: 'membros',   label: 'Leads',            status: 'parcial',   nota: 'agendamentos created_by=lp_eletroposto (sem segmentação própria).' },
      { key: 'lp',        label: 'Página de Venda',   status: 'construir', nota: 'Hoje só Meta Pixel — construir beacon → page_visits.' },
      { key: 'followup',  label: 'Followup',         status: 'construir', nota: 'Só alerta à equipe hoje.' },
      { key: 'agente',    label: 'Agente',           status: 'parcial',   Comp: () => <AgentePanel agent="none" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'construir', nota: 'kill-switches + saúde quando o pipe existir.' },
    ],
  },
];
