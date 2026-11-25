'use client';

// A jornada de uma sessão do quiz da Domina IA, tela por tela: a hora, o tempo em cada
// tela e a resposta dada. Lê GET /admin/dominaia/quiz-funil/sessao/:sid.
// A tela vista e a resposta dela viram um item só na linha do tempo.
import { useEffect, useState, type ReactNode } from 'react';
import { FastForward, LogOut, MousePointerClick, ShoppingBag } from 'lucide-react';
import api from '@/services/api';
import admin from '../../admin.module.css';
import g from './DominaiaJornadas.module.css';
import { fmtTempo } from './dominaiaComum';
import { fmtQuando, nomePais } from './dominaiaResumoComum';
import DominaiaLinhaTempo, { type ItemLinha } from './DominaiaLinhaTempo';
import { lerJornada, type JornadaSessao, type LinhaJornada, type SessaoQuiz } from './hubDominaiaJornadas.types';

const APARELHO: Record<string, string> = { movil: 'Celular', tablet: 'Tablet', escritorio: 'Computador' };

// ── peças da linha da tabela, usadas também no resumo da jornada ───────────
export function Local({ x }: { x: SessaoQuiz }) {
  const lugar = [x.cidade, x.regiao].filter(Boolean).join(', ');
  return (
    <span className={g.pilha}>
      <span>{x.paisNome || nomePais(x.pais)}</span>
      {lugar && <small>{lugar}</small>}
    </span>
  );
}
export function Aparelho({ x }: { x: SessaoQuiz }) {
  const sistema = [x.so, x.nav].filter(Boolean).join(' · ');
  return (
    <span className={g.pilha}>
      <span>{APARELHO[x.disp] ?? (x.disp || 'Não informado')}</span>
      {sistema && <small>{sistema}</small>}
    </span>
  );
}
export function Resultado({ x }: { x: SessaoQuiz }) {
  const principal = x.comprou
    ? <span className={`${g.selo} ${g.seloCompra}`}>Comprou</span>
    : x.clicouComprar
      ? <span className={`${g.selo} ${g.seloMarca}`}>Clicou em comprar</span>
      : <span className={g.mudo}>Não comprou</span>;
  // Foi direto à oferta: não passou pelas perguntas do meio.
  const entrada = x.atalho ? 'Atalho para a oferta' : x.volta ? 'Voltou direto para a oferta' : '';
  if (!entrada) return principal;
  return <span className={g.pilha}>{principal}<small>{entrada}</small></span>;
}

// ── a jornada ───────────────────────────────────────────────────────────────
const FIM: Record<string, { icone: ReactNode; tom: ItemLinha['tom'] }> = {
  compra: { icone: <ShoppingBag size={14} />, tom: 'compra' },
  checkout: { icone: <MousePointerClick size={14} />, tom: 'marca' },
};

export function itensDaJornada(linha: LinhaJornada[]): ItemLinha[] {
  const itens: ItemLinha[] = [];
  const temFim = linha.some((l) => l.tipo === 'fim');
  let ultimaVista = -1;
  linha.forEach((l, i) => {
    const chave = `${i}-${l.tipo}-${l.n ?? l.passo}`;
    if (l.tipo === 'respondeu') {
      // A resposta entra no item da tela vista logo antes, quando é a mesma tela.
      const alvo = itens[itens.length - 1];
      const anterior = linha.slice(0, i).reverse().find((y) => y.tipo !== 'respondeu');
      if (alvo && anterior?.tipo === 'viu' && anterior.n === l.n && l.resposta) {
        alvo.detalhe = <><span className={g.mudo}>Respondeu </span>{l.resposta}</>;
        return;
      }
      itens.push({ chave, quando: l.ts, titulo: l.rotulo, detalhe: l.resposta ?? undefined, marca: l.n ?? '·' });
      return;
    }
    if (l.tipo === 'atalho') {
      // Atalho para a oferta ou volta direto: o rótulo vem pronto da api.
      itens.push({ chave, quando: l.ts, titulo: <b>{l.rotulo}</b>, marca: <FastForward size={14} />, tom: 'marca' });
      return;
    }
    if (l.tipo === 'fim') {
      const f = FIM[l.passo ?? ''] ?? { icone: <LogOut size={14} />, tom: 'alerta' as const };
      itens.push({ chave, quando: l.ts, titulo: <b>{l.rotulo}</b>, marca: f.icone, tom: f.tom });
      return;
    }
    ultimaVista = itens.length;
    itens.push({
      chave, quando: l.ts, titulo: l.rotulo, marca: l.n ?? '·',
      lado: l.segundosNaTela !== null ? `${fmtTempo(l.segundosNaTela)} na tela` : undefined,
    });
  });
  // Sem fim registrado, a última tela vista é onde a pessoa parou.
  if (!temFim && ultimaVista >= 0) {
    const it = itens[ultimaVista];
    it.tom = 'alerta';
    it.lado = <span className={g.parouAqui}>Parou aqui</span>;
  }
  return itens;
}

export default function DominaiaSessaoJornada({ sid, nomeEtapa }: { sid: string; nomeEtapa: (n: number) => string }) {
  const [dados, setDados] = useState<JornadaSessao | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    api.get(`/admin/dominaia/quiz-funil/sessao/${encodeURIComponent(sid)}`)
      .then((r) => {
        if (!vivo) return;
        const d = lerJornada(r.data);
        if (d) { setDados(d); setErro(''); } else setErro('Resposta inesperada da api');
      })
      .catch((e) => { if (vivo) setErro(String(e?.response?.data?.error || e?.message || e)); });
    return () => { vivo = false; };
  }, [sid]);

  if (erro) return <div className={`${admin.card} ${g.aviso}`} role="alert">Não consegui ler esta sessão: {erro}. Volte para a lista e tente de novo.</div>;
  if (!dados) return <p className={g.linhaVazia} aria-live="polite">Lendo a jornada…</p>;

  const x = dados.resumo;
  return (
    <>
      <dl className={g.fatos}>
        <div><dt>Entrou</dt><dd>{fmtQuando(x.entrou)}</dd></div>
        <div><dt>Local</dt><dd><Local x={x} /></dd></div>
        <div><dt>Aparelho</dt><dd><Aparelho x={x} /></dd></div>
        <div><dt>Resultado</dt><dd><Resultado x={x} /></dd></div>
        <div><dt>Idade</dt><dd>{x.idade || '—'}</dd></div>
        <div><dt>Objetivo</dt><dd>{x.objetivo || '—'}</dd></div>
        <div><dt>Corpo</dt><dd>{x.cuerpo || '—'}</dd></div>
        <div><dt>Até a tela</dt><dd>{x.maxPasso}. {x.maxPassoRotulo || nomeEtapa(x.maxPasso)}</dd></div>
        <div className={g.fatoLargo}>
          <dt>Anúncio e conjunto</dt>
          <dd className={g.pilha}><span>{x.anuncio || 'Sem anúncio'}</span>{x.conjunto && <small>{x.conjunto}</small>}</dd>
        </div>
      </dl>
      <h3 className={g.secaoTitulo}>Tela por tela</h3>
      <DominaiaLinhaTempo
        itens={itensDaJornada(dados.linha)}
        rotulo="Jornada da sessão, tela por tela"
        segundos
        vazio="Esta sessão não tem nenhuma tela registrada."
      />
    </>
  );
}
