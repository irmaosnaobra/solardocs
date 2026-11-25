'use client';

// Funil compacto do quiz da Domina IA. Os cinco números saem do que o funil já traz:
//  Abriram o quiz         totais.sessoes (sessões do funil do quiz, a mesma conta do cartão Visitantes)
//  Passaram da 1ª tela    etapas[n = 2].chegaram (chegaram à tela 2)
//  Chegaram à oferta      totais.ofertas
//  Foram pagar            totais.checkouts
//  Compraram              totais.compras
// O botão no pé abre e fecha o detalhe das telas, que mora no painel (largura cheia).
import FunilCompacto, { BotaoAbrir, num, type Passo } from './DominaiaFunilCompacto';
import type { FunilDominaia } from './hubDominaia.types';

export default function DominaiaQuizCompacto({ f, aberto, aoAlternar, controla, className }: {
  f: FunilDominaia; aberto: boolean; aoAlternar: () => void; controla: string; className?: string;
}) {
  const t = f.totais;
  const passos: Passo[] = [
    { chave: 'abriram', rotulo: 'Abriram o quiz', valor: num(t.sessoes) },
    { chave: 'tela2', rotulo: 'Passaram da 1ª tela', valor: num(f.etapas.find((e) => e.n === 2)?.chegaram) },
    { chave: 'oferta', rotulo: 'Chegaram à oferta', valor: num(t.ofertas) },
    { chave: 'pagar', rotulo: 'Foram pagar', valor: num(t.checkouts) },
    { chave: 'compraram', rotulo: 'Compraram', valor: num(t.compras), compra: true },
  ];
  return (
    <FunilCompacto
      id="dm-quiz"
      titulo="Funil do quiz"
      className={className}
      passos={passos}
      totalRotulo="Compraram ÷ abriram o quiz"
      dica="Quem abriu o quiz, contado por pessoa. Passaram da 1ª tela = chegaram à tela 2. Cada porcentagem é de quem estava no passo anterior. Foram pagar = clicaram em comprar na oferta. Quem foi direto à oferta pelo atalho conta na oferta sem passar pela tela 2, então essa taxa pode passar de 100%."
    >
      {passos.some((p) => p.valor > 0) && (
        <BotaoAbrir aberto={aberto} aoAlternar={aoAlternar} controla={controla} fechado="Ver cada tela do quiz" abertoTxt="Fechar telas do quiz" />
      )}
    </FunilCompacto>
  );
}
