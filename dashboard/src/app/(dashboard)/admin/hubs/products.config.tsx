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
      { key: 'visao',     label: 'Visão Geral',      status: 'construir', nota: 'Pulso do dia — agrega funil + vendas Kiwify + alertas.' },
      { key: 'funil',     label: 'Funil',            status: 'pronto',    Comp: FunilLimpaproPanel },
      { key: 'membros',   label: 'Membros',          status: 'pronto',    Comp: MembrosLimpaproPanel },
      { key: 'lp',        label: 'Página de Venda',   status: 'parcial',  nota: 'limpapro_events já captura; consolidar visão visita→checkout.' },
      { key: 'followup',  label: 'Followup',         status: 'parcial',   nota: 'Bia (biaInbound / limpaproRecovery) — expor fila, toques e handoffs.' },
      { key: 'agente',    label: 'Agente',           status: 'construir', nota: 'Cérebro da Bia (leitura): persona, regras, kill-switches + métricas.' },
      { key: 'conversas', label: 'Conversas',        status: 'parcial',   nota: '/admin/conversas-limpapro já existe — generalizar no padrão.' },
      { key: 'config',    label: 'Config & Alertas', status: 'construir', nota: 'kill-switches, preço, links de checkout + saúde (LP viva? venda parada?).' },
    ],
  },
  {
    id: 'solardoc', nome: 'SolarDoc', emoji: '☀️', cor: '#B4801E',
    tabs: [
      { key: 'visao',     label: 'Visão Geral',      status: 'construir', nota: 'Pulso do dia — agrega funnel/billing/revenue.' },
      { key: 'funil',     label: 'Funil',            status: 'pronto',    Comp: FunilSolarDocPanel },
      { key: 'membros',   label: 'Membros',          status: 'pronto',    Comp: MembrosPanel },
      { key: 'lp',        label: 'Página de Venda',   status: 'parcial',  nota: 'page_visits + lp_events (bloco "LP SolarDoc" hoje no /admin).' },
      { key: 'followup',  label: 'Followup',         status: 'parcial',   nota: 'Giovanna (dunning / winback / recuperação Pix).' },
      { key: 'agente',    label: 'Agente',           status: 'construir', nota: 'Cérebro da Giovanna (leitura).' },
      { key: 'receita',   label: 'Receita/ROAS',     status: 'parcial',   nota: '/admin/revenue + /admin/meta-funnel (aba aprovada do hub SolarDoc).' },
      { key: 'conversas', label: 'Conversas',        status: 'construir', nota: 'Threads Giovanna ↔ cliente (whatsapp_sessions).' },
      { key: 'config',    label: 'Config & Alertas', status: 'construir', nota: 'kill-switches (Pix/dunning), planos, links + saúde.' },
    ],
  },
  {
    id: 'solar', nome: 'Solar', emoji: '🔆', cor: '#3E6C9E',
    tabs: [
      { key: 'visao',     label: 'Visão Geral',      status: 'construir', nota: 'Pulso do dia (Supabase Gerador).' },
      { key: 'funil',     label: 'Funil',            status: 'parcial',   nota: 'agendamentos created_by=lp_solar (Gerador) — consolidar visita→reunião→venda.' },
      { key: 'membros',   label: 'Leads',            status: 'parcial',   nota: 'agendamentos + CRM SDR (sdr_leads / Luma).' },
      { key: 'lp',        label: 'Página de Venda',   status: 'parcial',  nota: '/io/* em page_visits + site institucional /io.' },
      { key: 'followup',  label: 'Followup',         status: 'parcial',   nota: 'geradorFollowup / reagendarDigest / Luma.' },
      { key: 'agente',    label: 'Agente',           status: 'construir', nota: 'Cérebro do SDR Luma (leitura).' },
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
      { key: 'agente',    label: 'Agente',           status: 'construir', nota: 'Sem agente dedicado ainda.' },
      { key: 'config',    label: 'Config & Alertas', status: 'construir', nota: 'kill-switches + saúde quando o pipe existir.' },
    ],
  },
];
