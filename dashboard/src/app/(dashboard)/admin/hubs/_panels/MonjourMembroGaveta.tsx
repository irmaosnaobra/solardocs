'use client';

// O histórico de um membro no app Monjour: os totais por ação no topo e a linha do
// tempo de tudo o que fez, do mais novo ao mais velho. Lê GET /admin/monjour/membros/:m.
// O texto de cada linha vem pronto da api; aqui só entram o ícone e a cor da ação.
import { useEffect, useState, type ReactNode } from 'react';
import {
  BookOpen, CalendarDays, ChefHat, CircleArrowUp, CircleCheck, Coffee, Download, Gem, GlassWater,
  Heart, LayoutGrid, ListChecks, Ruler, Scale, Send, ShoppingBasket, Smartphone,
} from 'lucide-react';
import api from '@/services/api';
import admin from '../../admin.module.css';
import g from './MonjourJornadas.module.css';
import m from './MonjourMembros.module.css';
import { fmtInt } from './monjourComum';
import { fmtQuando, nomePais } from './monjourResumoComum';
import MonjourGaveta from './MonjourGaveta';
import MonjourLinhaTempo, { type TomLinha } from './MonjourLinhaTempo';
import { lerHistorico, type HistoricoMembro, type Membro } from './hubMonjourJornadas.types';
import { PlanoMembro, fmtRelativo } from './monjourMembrosComum';

const I = 14;
export const ACOES: Record<string, { rotulo: string; icone: ReactNode; tom: TomLinha }> = {
  abriu: { rotulo: 'Abriu o app', icone: <Smartphone size={I} />, tom: 'neutro' },
  aba: { rotulo: 'Trocou de aba', icone: <LayoutGrid size={I} />, tom: 'neutro' },
  dia_visto: { rotulo: 'Viu um dia do plano', icone: <CalendarDays size={I} />, tom: 'neutro' },
  infusion_hecha: { rotulo: 'Marcou infusão', icone: <Coffee size={I} />, tom: 'marca' },
  habito_hecho: { rotulo: 'Marcou hábito', icone: <CircleCheck size={I} />, tom: 'marca' },
  agua: { rotulo: 'Marcou água', icone: <GlassWater size={I} />, tom: 'marca' },
  receta_vista: { rotulo: 'Viu receita', icone: <BookOpen size={I} />, tom: 'marca' },
  receta_hecha: { rotulo: 'Fez receita', icone: <ChefHat size={I} />, tom: 'marca' },
  favorito: { rotulo: 'Favoritou receita', icone: <Heart size={I} />, tom: 'marca' },
  peso_registrado: { rotulo: 'Registrou o peso', icone: <Scale size={I} />, tom: 'compra' },
  medidas_registradas: { rotulo: 'Registrou medidas', icone: <Ruler size={I} />, tom: 'compra' },
  lista_bloque: { rotulo: 'Escolheu bloco da lista', icone: <ListChecks size={I} />, tom: 'compra' },
  lo_tengo: { rotulo: 'Marcou item da lista', icone: <ShoppingBasket size={I} />, tom: 'compra' },
  enviar_lista: { rotulo: 'Mandou a lista', icone: <Send size={I} />, tom: 'compra' },
  plus_visto: { rotulo: 'Viu o Plus', icone: <Gem size={I} />, tom: 'alerta' },
  upgrade_click: { rotulo: 'Clicou no upgrade', icone: <CircleArrowUp size={I} />, tom: 'alerta' },
  instalou: { rotulo: 'Instalou o app', icone: <Download size={I} />, tom: 'compra' },
};
const acao = (k: string) => ACOES[k] ?? { rotulo: k.replace(/_/g, ' '), icone: <CalendarDays size={I} />, tom: 'neutro' as const };

export default function MonjourMembroGaveta({ membro, aoFechar }: { membro: Membro | null; aoFechar: () => void }) {
  const sub = membro
    ? [membro.cortesia ? 'Cortesia' : membro.plano ? `Plano ${membro.plano === 'plus' ? 'Plus' : 'Básico'}` : 'Sem compra',
      membro.compradoEm ? `comprou ${fmtQuando(membro.compradoEm)}` : '', nomePais(membro.pais ?? '')].filter(Boolean).join(' · ')
    : '';
  return (
    <MonjourGaveta aberta={!!membro} aoFechar={aoFechar} titulo={membro?.email || 'Membro sem e-mail'} sub={sub} chave={membro?.m}>
      {membro && <Historico key={membro.m} membro={membro} />}
    </MonjourGaveta>
  );
}

function Historico({ membro }: { membro: Membro }) {
  const [dados, setDados] = useState<HistoricoMembro | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    api.get(`/admin/monjour/membros/${encodeURIComponent(membro.m)}`)
      .then((r) => {
        if (!vivo) return;
        const d = lerHistorico(r.data);
        if (d) { setDados(d); setErro(''); } else setErro('Resposta inesperada da api');
      })
      .catch((e) => { if (vivo) setErro(String(e?.response?.data?.error || e?.message || e)); });
    return () => { vivo = false; };
  }, [membro.m]);

  const x = dados?.membro ?? membro;
  const totais = Object.entries(dados?.totais.porAcao ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <dl className={g.fatos}>
        <div><dt>Último uso</dt><dd>{x.ultimoUso ? fmtRelativo(x.ultimoUso) : 'Nunca abriu'}</dd></div>
        <div><dt>Dias ativos</dt><dd>{fmtInt(x.diasAtivos)}</dd></div>
        <div><dt>Chegou ao dia</dt><dd>{x.diaMaximo ? `${x.diaMaximo} de 21` : '—'}</dd></div>
        <div><dt>Nota de uso</dt><dd><b>{fmtInt(x.nota)}</b> de 100</dd></div>
        <div><dt>Plano</dt><dd><PlanoMembro x={x} /></dd></div>
        <div><dt>Instalou</dt><dd>{x.instalou ? 'Sim' : 'Não'}</dd></div>
        <div className={g.fatoLargo}><dt>Situação</dt><dd>{x.parado ? <span className={m.seloParado}>Parou há 3 dias ou mais</span> : 'Usando'}</dd></div>
      </dl>

      {erro && <div className={`${admin.card} ${g.aviso}`} role="alert">Não consegui ler o histórico: {erro}. Feche e abra de novo.</div>}
      {!dados && !erro && <p className={g.linhaVazia} aria-live="polite">Lendo o histórico…</p>}
      {dados?.truncado && <p className={g.linhaVazia}>O período passou do teto de leitura. Mostrando as ações mais novas.</p>}

      {dados && (
        <>
          <h3 className={g.secaoTitulo}>O que mais fez</h3>
          {totais.length === 0 ? (
            <p className={g.linhaVazia}>Nenhuma ação registrada ainda.</p>
          ) : (
            <ul className={m.totais}>
              {totais.map(([k, n]) => {
                const a = acao(k);
                return (
                  <li key={k} className={m.total}>
                    <span className={`${g.ponto} ${m.totalIcone} ${a.tom === 'marca' ? g.pontoMarca : a.tom === 'compra' ? g.pontoCompra : a.tom === 'alerta' ? g.pontoAlerta : ''}`} aria-hidden="true">{a.icone}</span>
                    <b className={m.totalNum}>{fmtInt(n)}</b>
                    <span className={m.totalRotulo}>{a.rotulo}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className={g.secaoTitulo}>
            Linha do tempo{dados.linha.length >= 500 ? <span className={m.secaoNota}> · as 500 ações mais novas</span> : null}
          </h3>
          <MonjourLinhaTempo
            rotulo={`Histórico de ${x.email || 'membro'} no app, do mais novo ao mais velho`}
            vazio="Ainda não há uso registrado. O histórico começa no dia em que o rastreio do app foi publicado."
            itens={dados.linha.map((l, i) => {
              const a = acao(l.acao);
              return { chave: `${i}-${l.ts}`, quando: l.ts, titulo: l.texto || a.rotulo, marca: a.icone, tom: a.tom };
            })}
          />
        </>
      )}
    </>
  );
}
