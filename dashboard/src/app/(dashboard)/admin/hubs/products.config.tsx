// ─────────────────────────────────────────────────────────────────────────────
// CONFIG-DRIVEN dos Hubs de Produto (/admin/hubs).
// Cada produto declara suas abas na MESMA ordem/padrão. Aba com `Comp` renderiza um
// painel real (reuso do que já existe); sem `Comp` mostra placeholder "construir".
// Adicionar produto/aba = editar SÓ este arquivo, a tela (ProductHub) se monta sozinha.
//
// Estado de 11/11/2026: cada hub mostra só o que é usado hoje.
//   SolarDoc: duas agentes (Giovanna no suporte, Carla nas vendas pela linha 5040). A VSL, o
//             Pix automático e a Loja têm aba própria. Os comentários do curso moram na Loja.
//   Solar: só a Nilce, humana, atende. Não há robô de followup nem agente.
//   Eletroposto: sem agente (a Helena está pausada). O Ponto Certo já mostra a fila dos dois lados.
// ─────────────────────────────────────────────────────────────────────────────
import type { ComponentType } from 'react';
import FunilLimpaproPanel from '../_components/FunilLimpaproPanel';
import MembrosLimpaproPanel from '../_components/MembrosLimpaproPanel';
import FunilSolarDocPanel from '../_components/FunilSolarDocPanel';
import MembrosPanel from '../_components/MembrosPanel';
// Pix automático: quantos chegam na tela de Pix e quantos saem pagando (/admin/pix-funil)
import PixFunilPanel from '../_components/PixFunilPanel';
import AgentePanel from './_panels/AgentePanel';
import ReceitaPanel from './_panels/ReceitaPanel';
import LpVendaPanel from './_panels/LpVendaPanel';
// LP do LimpaPro: jornada real do lead (secao `raw` dos eventos 'sessao')
import LpLimpaproPanel from './_panels/LpLimpaproPanel';
// Followup + Conversas (endpoint /admin/hub-followup)
import FollowupPanel from './_panels/FollowupPanel';
import ConversasPanel from './_panels/ConversasPanel';
// Visão Geral / Pulso (agrega endpoints existentes)
import VisaoGeralPanel from './_panels/VisaoGeralPanel';
// Config & Alertas (read-only) + Funil/Leads de Solar/Eletroposto (Gerador)
import ConfigAlertasPanel from './_panels/ConfigAlertasPanel';
import GeradorFunilPanel from './_panels/GeradorFunilPanel';
import GeradorLeadsPanel from './_panels/GeradorLeadsPanel';
// LP de Solar/Eletroposto (page_visits via beacon)
import IoLpPanel from './_panels/IoLpPanel';
// Quiz: quem cai no link do quiz vê só o quiz. Em que pergunta desiste?
import QuizEletropostoPanel from './_panels/QuizEletropostoPanel';
// VSL: retenção do vídeo (a curva de quantos ainda assistem no segundo X)
import VslPanel from './_panels/VslPanel';
// Loja de produtos no Pix (Asaas) + moderação dos comentários do curso
import LojaPanel from './_panels/LojaPanel';
// Ponto Certo: o investidor recusado por falta de local, chegou no material?
import PontoCertoPanel from './_panels/PontoCertoPanel';

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
      // Quiz /diagnostico (24/10/2026): o mesmo painel do quiz solar, lendo /admin/solardoc/quiz-funil.
      { key: 'quiz',      label: 'Quiz',              status: 'pronto',   Comp: () => <QuizEletropostoPanel produto="solardoc" /> },
      // VSL /vsl: a página manda `lp: 'solardoc_vsl'` nos eventos, e o vslController mapeia isso para '/vsl'.
      { key: 'vsl',       label: 'VSL',               status: 'pronto',   Comp: () => <VslPanel lp="solardoc_vsl" /> },
      // Pix automático: quantos chegam na tela de Pix e quantos saem pagando.
      { key: 'pix',       label: 'Pix automático',    status: 'pronto',   Comp: PixFunilPanel },
      { key: 'followup',  label: 'Followup',         status: 'pronto',    Comp: () => <FollowupPanel produto="solardoc" /> },
      // As duas agentes da SolarDoc: Giovanna (suporte) e Carla (vendas pela linha 5040), uma embaixo da outra.
      { key: 'agente',    label: 'Agente',           status: 'pronto',    Comp: () => <AgentePanel agent={['giovanna', 'carla']} /> },
      // Loja "Para crescer" no Pix (Asaas, desde 10/11/2026) + moderação dos comentários do curso.
      { key: 'loja',      label: 'Loja',              status: 'pronto',   Comp: LojaPanel },
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
      // Quiz solar (07/10/2026): o mesmo painel do quiz do eletroposto, lendo /admin/solar/quiz-funil.
      { key: 'quiz',      label: 'Quiz',              status: 'pronto',   Comp: () => <QuizEletropostoPanel produto="solar" /> },
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
      { key: 'quiz',      label: 'Quiz',              status: 'pronto',   Comp: QuizEletropostoPanel },
      // Desde 01/09 o lado do CAPITAL não para na tela de cadastro recebido: é levado pra
      // /ponto-certo. Esta aba mede esse caminho ponta a ponta e é a única que enxerga a fila
      // dos dois lados (quem tem o ponto e quem tem o capital) sem recorte de período.
      { key: 'pontocerto', label: 'Ponto Certo',     status: 'pronto',   Comp: PontoCertoPanel },
      { key: 'config',    label: 'Config & Alertas', status: 'pronto',    Comp: () => <ConfigAlertasPanel produto="eletroposto" /> },
    ],
  },
];
