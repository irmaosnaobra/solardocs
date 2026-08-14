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
// LP do LimpaPro: jornada real do lead (secao `raw` dos eventos 'sessao')
import LpLimpaproPanel from './_panels/LpLimpaproPanel';
// Fase 2 — Followup + Conversas (endpoint /admin/hub-followup)
import FollowupPanel from './_panels/FollowupPanel';
import ConversasPanel from './_panels/ConversasPanel';
// Fase 3 — Visão Geral / Pulso (agrega endpoints existentes)
import VisaoGeralPanel from './_panels/VisaoGeralPanel';
// Fase 4 — Config & Alertas (read-only) + Funil/Leads de Solar/Eletroposto (Gerador)
import ConfigAlertasPanel from './_panels/ConfigAlertasPanel';
import GeradorFunilPanel from './_panels/GeradorFunilPanel';
import GeradorLeadsPanel from './_panels/GeradorLeadsPanel';
// Fase 5 (resíduos) — LP de Solar/Eletroposto (page_visits via beacon novo)
import IoLpPanel from './_panels/IoLpPanel';
// Kit de Fechamento (isca R$27 → plataforma) — funil da isca até virar assinante
import KitPanel from './_panels/KitPanel';
// Banco de comentários do curso — o que vira depoimento na LP sai daqui
import ComentariosCursoPanel from './_panels/ComentariosCursoPanel';
// Nota 1: quem a LP do eletroposto recusa vai pra oferta de entrada — chegou lá?
import Nota1Panel from './_panels/Nota1Panel';

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
      { key: 'lp',        label: 'Página de Venda',   status: 'pronto',   Comp: LpLimpaproPanel },
      { key: 'followup',  label: 'Followup',         status: 'pronto',    Comp: () => <FollowupPanel produto="limpapro" /> },
      { key: 'agente',    label: 'Agente',           status: 'pronto',    Comp: () => <AgentePanel agent="bia" /> },
      { key: 'conversas', label: 'Conversas',        status: 'pronto',    Comp: () => <ConversasPanel produto="limpapro" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'pronto',    Comp: () => <ConfigAlertasPanel produto="limpapro" /> },
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
      { key: 'kit',       label: 'Kit / Isca R$27',  status: 'pronto',    Comp: KitPanel },
      { key: 'comentarios', label: 'Comentários do Curso', status: 'pronto', Comp: ComentariosCursoPanel },
      { key: 'receita',   label: 'Receita/ROAS',     status: 'pronto',    Comp: ReceitaPanel },
      { key: 'conversas', label: 'Conversas',        status: 'pronto',    Comp: () => <ConversasPanel produto="solardoc" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'pronto',    Comp: () => <ConfigAlertasPanel produto="solardoc" /> },
    ],
  },
  {
    id: 'solar', nome: 'Solar', emoji: '🔆', cor: '#3E6C9E',
    tabs: [
      { key: 'visao',     label: 'Visão Geral',      status: 'pronto',    Comp: () => <VisaoGeralPanel produto="solar" /> },
      { key: 'funil',     label: 'Funil',            status: 'pronto',    Comp: () => <GeradorFunilPanel produto="solar" /> },
      { key: 'membros',   label: 'Leads',            status: 'pronto',    Comp: () => <GeradorLeadsPanel produto="solar" /> },
      { key: 'lp',        label: 'Página de Venda',   status: 'pronto',   Comp: () => <IoLpPanel match="/io/solar" /> },
      { key: 'followup',  label: 'Followup',         status: 'pronto',    Comp: () => <FollowupPanel produto="solar" /> },
      { key: 'agente',    label: 'Agente',           status: 'pronto',    Comp: () => <AgentePanel agent="luma" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'pronto',    Comp: () => <ConfigAlertasPanel produto="solar" /> },
    ],
  },
  {
    id: 'eletroposto', nome: 'Eletroposto', emoji: '🔌', cor: '#8B857A',
    tabs: [
      { key: 'visao',     label: 'Visão Geral',      status: 'pronto',    Comp: () => <VisaoGeralPanel produto="eletroposto" /> },
      { key: 'funil',     label: 'Funil',            status: 'pronto',    Comp: () => <GeradorFunilPanel produto="eletroposto" /> },
      { key: 'membros',   label: 'Leads',            status: 'pronto',    Comp: () => <GeradorLeadsPanel produto="eletroposto" /> },
      { key: 'lp',        label: 'Página de Venda',   status: 'pronto',   Comp: () => <IoLpPanel match="/io/eletroposto" /> },
      // Fica no hub do ELETROPOSTO porque é daqui que o lead sai (a LP recusa),
      // mesmo com a oferta e os eventos morando no banco do SolarDoc.
      { key: 'nota1',     label: 'Nota 1 / Material', status: 'pronto',   Comp: Nota1Panel },
      { key: 'followup',  label: 'Followup',         status: 'construir', nota: 'Só alerta à equipe hoje.', Comp: () => <FollowupPanel produto="eletroposto" /> },
      { key: 'agente',    label: 'Agente',           status: 'parcial',   Comp: () => <AgentePanel agent="none" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'pronto',    Comp: () => <ConfigAlertasPanel produto="eletroposto" /> },
    ],
  },
];
