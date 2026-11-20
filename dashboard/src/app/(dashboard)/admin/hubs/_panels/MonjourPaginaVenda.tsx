'use client';

// Funil compacto da página de venda (/plan/), separada do funil do quiz. Cinco
// passos vindos de paginaVenta: visitas, planes, compra, checkouts, compras.
// O campo é opcional (a api e o dashboard sobem em deploys separados): sem ele
// o cartão mostra "Sem visitas neste período.". O botão no pé abre o mapa da
// página (até onde rolaram e onde clicaram), fechado sempre que a aba carrega.
import { useState } from 'react';
import s from './MonjourFunilPanel.module.css';
import FunilCompacto, { BotaoAbrir, num, type Passo } from './MonjourFunilCompacto';
import MonjourMapaPagina from './MonjourMapaPagina';
import type { FunilMonjour } from './hubMonjour.types';

export default function MonjourPaginaVenda({ pv, className }: { pv?: FunilMonjour['paginaVenta']; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const visitas = num(pv?.visitas);
  const passos: Passo[] = [
    { chave: 'visitas', rotulo: 'Abriram a página', valor: visitas },
    { chave: 'planes', rotulo: 'Viram os planos', valor: num(pv?.planes) },
    { chave: 'compra', rotulo: 'Abriram a compra', valor: num(pv?.compra) },
    { chave: 'checkouts', rotulo: 'Foram pagar', valor: num(pv?.checkouts) },
    { chave: 'compras', rotulo: 'Compraram', valor: num(pv?.compras), compra: true },
  ];
  // Compra que chega no período sem a visita (visitou ontem, pagou hoje) também precisa aparecer: o cartão decide pelos cinco passos.
  const secoes = Array.isArray(pv?.secoes) ? (pv?.secoes ?? []) : [];
  const cliques = Array.isArray(pv?.cliques) ? (pv?.cliques ?? []) : [];
  const temDados = passos.some((p) => p.valor > 0);
  const temMapa = visitas > 0 && (secoes.length > 0 || cliques.length > 0);

  return (
    <FunilCompacto
      id="mj-pv"
      titulo="Funil da página de venda"
      className={className}
      passos={passos}
      totalRotulo="Compraram ÷ abriram a página"
      dica="Quem entrou direto na página de venda (/plan/), sem passar pelo quiz. Cada porcentagem é de quem estava no passo anterior. Foram pagar = clicaram em pagar e seguiram para a Stripe."
    >
      {temMapa ? (
        <>
          <BotaoAbrir aberto={aberto} aoAlternar={() => setAberto((a) => !a)} controla="mj-mapa" fechado="Ver o mapa da página" abertoTxt="Fechar o mapa da página" />
          <div id="mj-mapa" hidden={!aberto}>
            {aberto && <MonjourMapaPagina visitas={visitas} secoes={secoes} cliques={cliques} />}
          </div>
        </>
      ) : temDados && (
        <p className={s.cfNota}>Sem dados de rolagem ainda.</p>
      )}
    </FunilCompacto>
  );
}
