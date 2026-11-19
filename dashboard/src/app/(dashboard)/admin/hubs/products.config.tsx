// ─────────────────────────────────────────────────────────────────────────────
// CONFIG-DRIVEN dos Hubs de Produto (/admin/hubs).
// Cada produto declara suas abas na MESMA ordem/padrão. Aba com `Comp` renderiza um
// painel real (reuso do que já existe); sem `Comp` mostra placeholder "construir".
// Adicionar produto/aba = editar SÓ este arquivo, a tela (ProductHub) se monta sozinha.
//
// Estado de 11/11/2026: cada hub mostra só o que é usado hoje.
//   SolarDoc: duas agentes (Giovanna no suporte, Carla nas vendas pela linha 5040). A VSL, o
//             Pix automático têm aba própria. A loja (Vendas no Pix, Kit Fecha Vendas e comentários
//             do curso) mora no hub Produtos.
//   Solar: só a Nilce, humana, atende. Não há robô de followup nem agente.
//   Eletroposto: sem agente (a Helena está pausada). O Ponto Certo já mostra a fila dos dois lados.
// ─────────────────────────────────────────────────────────────────────────────
import type { ComponentType } from 'react';
import { AtSign, EvCharger, FileText, Package, SolarPanel, type LucideIcon } from 'lucide-react';
import FunilSolarDocPanel from '../_components/FunilSolarDocPanel';
import MembrosPanel from '../_components/MembrosPanel';
// Pix automático: quantos chegam na tela de Pix e quantos saem pagando (/admin/pix-funil)
import PixFunilPanel from '../_components/PixFunilPanel';
import AgentePanel from './_panels/AgentePanel';
import ReceitaPanel from './_panels/ReceitaPanel';
import LpVendaPanel from './_panels/LpVendaPanel';
// Hub "Produtos": LimpaPro (8 sub-abas), sub-abas reutilizáveis e compras da loja
import LimpaproProdutoPanel from './_panels/LimpaproProdutoPanel';
import SubAbas from './_panels/SubAbas';
import ProdutoLojaPanel from './_panels/ProdutoLojaPanel';
// Kit Fecha Vendas: funil da isca de R$ 27 e a moderação dos comentários do curso (moram no hub Produtos)
import KitPanel from './_panels/KitPanel';
import ComentariosCursoPanel from './_panels/ComentariosCursoPanel';
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
// Vendas no Pix da loja (Asaas): cobranças geradas, pagas e valor pago, por produto
import LojaPanel from './_panels/LojaPanel';
// Ponto Certo: o investidor recusado por falta de local, chegou no material?
import PontoCertoPanel from './_panels/PontoCertoPanel';
// Trilha do Parceiro NEXUS: aptos para reunião e Mapa de demanda (iframe de /nexus/adm)
import NexusParceirosPanel from './_panels/NexusParceirosPanel';
// Monjour Natural (hub Produtos): visão geral, funil do quiz, vendas, leads, app e anúncios
import MonjourProdutoPanel from './_panels/MonjourProdutoPanel';
// NEXUS Instagram: a lista de interesse do link da bio (/nexus/interesse), com contato e CSV
import NexusInstagramPanel from './_panels/NexusInstagramPanel';
// Irmãos na Obra Instagram: a lista de interesse do link da bio (/io/interesse), quatro portas e agenda
import IoInstagramPanel from './_panels/IoInstagramPanel';

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
  /** Ícone de traço (lucide), monocromático: a cor vem da navegação. */
  Icone: LucideIcon;
  cor: string;
  tabs: HubTab[];
}

export const PRODUCTS: Product[] = [
  {
    id: 'solardoc', nome: 'SolarDoc', Icone: FileText, cor: '#B4801E',
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
      { key: 'receita',   label: 'Receita/ROAS',     status: 'pronto',    Comp: ReceitaPanel },
      { key: 'conversas', label: 'Conversas',        status: 'pronto',    Comp: () => <ConversasPanel produto="solardoc" /> },
      { key: 'config',    label: 'Config & Alertas', status: 'pronto',    Comp: () => <ConfigAlertasPanel produto="solardoc" /> },
    ],
  },
  {
    id: 'solar', nome: 'Solar', Icone: SolarPanel, cor: '#3E6C9E',
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
    id: 'eletroposto', nome: 'Eletroposto', Icone: EvCharger, cor: '#8B857A',
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
      // Trilha do Parceiro NEXUS (17/11/2026): quem concluiu o Nível 1 e está apto para reunião,
      // com nível, contato e ficha, mais o Mapa de demanda. Embute /nexus/adm/ (mesma origem).
      { key: 'parceiros-nexus', label: 'Parceiros NEXUS', status: 'pronto', Comp: NexusParceirosPanel },
      { key: 'config',    label: 'Config & Alertas', status: 'pronto',    Comp: () => <ConfigAlertasPanel produto="eletroposto" /> },
    ],
  },
  // NEXUS Instagram (19/11/2026): a lista permanente do link da bio (solardoc.app/nexus/interesse).
  // Quem quer eletroposto (as seis frentes) ou mobilidade elétrica, para quê, quanto investe e como paga.
  // O azul é o da área NEXUS dentro da SolarDoc.
  {
    id: 'nexus-instagram', nome: 'NEXUS Instagram', Icone: AtSign, cor: '#0060C7',
    tabs: [
      { key: 'lista', label: 'Lista de interesse', status: 'pronto', Comp: NexusInstagramPanel },
    ],
  },
  // Irmãos na Obra Instagram (19/11/2026): a lista do link da bio (solardoc.app/io/interesse).
  // Energia solar, eletroposto, integrador e mobilidade; solar e eletroposto viram card na agenda.
  {
    id: 'io-instagram', nome: 'Irmãos na Obra Instagram', emoji: '⌂', cor: '#B45309',
    tabs: [
      { key: 'lista', label: 'Lista de interesse', status: 'pronto', Comp: IoInstagramPanel },
    ],
  },
  // Hub dos produtos menores da loja (desde 11/11/2026): uma aba por produto. O LimpaPro
  // saiu da frente e mora aqui. O Kit Fecha Vendas (funil da isca e comentários do curso)
  // saiu do hub SolarDoc e mora só aqui.
  {
    id: 'produtos', nome: 'Produtos', Icone: Package, cor: '#6E6A86',
    tabs: [
      // Cobranças da loja no Pix (Asaas, desde 10/11/2026), lidas de produto_cobrancas: geradas, pagas e
      // valor pago por produto. As abas abaixo mostram os acessos (entitlements) de cada produto.
      { key: 'vendas-pix',   label: 'Vendas no Pix',   status: 'pronto', Comp: LojaPanel },
      { key: 'limpapro',     label: 'LimpaPro',        status: 'pronto', Comp: LimpaproProdutoPanel },
      { key: 'fecha-vendas', label: 'Kit Fecha Vendas', status: 'pronto', Comp: KitFechaVendasPanel },
      { key: 'offgrid',      label: 'Off-Grid',        status: 'pronto', Comp: () => <ProdutoLojaPanel produto="offgrid" /> },
      { key: 'precificacao', label: 'Precificação',    status: 'pronto', Comp: () => <ProdutoLojaPanel produto="precificacao" /> },
      { key: 'inventario',   label: 'Inventário',      status: 'pronto', Comp: () => <ProdutoLojaPanel produto="inventario" /> },
      // Monjour Natural (19/11/2026): app vendido na América Latina pelo quiz. Era hub próprio e veio
      // para cá. Vendas e leads da Stripe pelo site do Monjour, funil e app do lp_events da SolarDoc.
      { key: 'monjour',      label: 'Monjour Natural', status: 'pronto', Comp: MonjourProdutoPanel },
    ],
  },
];

function KitFechaVendasPanel() {
  return (
    <SubAbas
      abas={[
        { key: 'funil',       label: 'Funil',                 Comp: KitPanel },
        { key: 'comentarios', label: 'Comentários do Curso',  Comp: ComentariosCursoPanel },
      ]}
    />
  );
}
