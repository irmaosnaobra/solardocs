'use client';

// ─── Aba "Estúdio": as fábricas de vídeo com IA, ao vivo ────────────────────
// Lê GET /admin/estudio. Versão 2 traz `fabricas[]` (uma por fábrica); sem ele, o
// `snapshot` antigo vira a fábrica única Dentro da Guerra. Em desenvolvimento, ou
// se a api não devolver nada, cai na fixture e mostra o selo "Dados de exemplo".
// Visual próprio e escuro, contido neste bloco: não mexe no tema do /admin.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '@/services/api';
import type { RespostaEstudio, Snapshot } from './estudio/tipos';
import { REDES } from './estudio/tipos';
import { fixtureFabricas } from './estudio/fixture';
import { agendados, haQuanto, idFabrica, NOME_REDE, num, ordenarFabricas, situacaoFabrica, horariosFabrica } from './estudio/formato';
import { geist, geistMono } from './estudio/fontes';
import Fabrica from './estudio/Fabrica';
import Redes from './estudio/Redes';
import Placar from './estudio/Placar';
import Cartoes from './estudio/Cartoes';
import Cabeca from './estudio/Cabeca';
import Semana from './estudio/Semana';
import Plano from './estudio/Plano';
import Dica from './estudio/Dica';
import s from './estudio/estudio.module.css';
import f from './estudio/fabricas.module.css';

const EM_DEV = process.env.NODE_ENV === 'development';
const RECARREGA_MS = 5 * 60000;

const DICA: Record<string, string> = {
  'dentro-da-guerra': 'Série com imagem e filme de arquivo e narração de IA. Sai todo dia às 19h no Instagram e no TikTok.',
  'irmaos-na-obra': 'Curiosidades de energia solar, elétrica e da história da energia, em animação 3D. Sai às 11h e às 17h, 7 dias por semana.',
  youtube: 'Vídeo longo e horizontal, com roteiro próprio. Nunca colagem dos curtos, porque o YouTube não monetiza conteúdo reaproveitado.',
};

const POR_EXTENSO = ['Nenhuma', 'Uma', 'Duas', 'Três', 'Quatro', 'Cinco'];

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro' }
  | { fase: 'ok'; fabricas: Snapshot[]; exemplo: boolean };

function useAgora(passoMs: number) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), passoMs);
    return () => window.clearInterval(id);
  }, [passoMs]);
  return agora;
}

/** Lista de fábricas da resposta: `fabricas[]`, senão o snapshot antigo como fábrica única. */
function fabricasDa(data: RespostaEstudio | undefined): Snapshot[] {
  if (data?.fabricas && data.fabricas.length > 0) return ordenarFabricas(data.fabricas);
  if (data?.snapshot) return [{ ...data.snapshot, fabricaId: data.snapshot.fabricaId ?? 'dentro-da-guerra' }];
  return [];
}

/** Bloco de totais da fábrica com episódios publicados (views, curtidas, comentários). */
function Totais({ fab }: { fab: Snapshot }) {
  const t = fab.totais;
  const somaRedes = REDES.reduce((acc, r) => acc + (t.porRede[r]?.views ?? 0), 0);
  const redes = REDES.filter((r) => (t.porRede[r]?.views ?? 0) > 0);
  return (
    <dl className={s.totais}>
      <div className={s.totalViews}>
        <dt>Views</dt>
        <dd className={s.numGrande}>{num(t.views)}</dd>
        {somaRedes > 0 ? (
          <dd className={s.divisao}>
            <span className={s.divBarra} aria-hidden="true">
              {redes.map((r) => (
                <span key={r} data-rede={r} style={{ flexGrow: t.porRede[r]?.views ?? 0 }} />
              ))}
            </span>
            <span className={s.divLegenda}>
              {redes.map((r) => (
                <span key={r} data-rede={r}>
                  <i aria-hidden="true" />
                  {NOME_REDE[r]} <b>{num(t.porRede[r]?.views ?? null)}</b>
                </span>
              ))}
            </span>
          </dd>
        ) : null}
      </div>
      <div className={s.totalMenor}>
        <dt>Curtidas</dt>
        <dd className={s.numMedio}>{num(t.curtidas)}</dd>
      </div>
      <div className={s.totalMenor}>
        <dt>Comentários</dt>
        <dd className={s.numMedio}>{num(t.comentarios)}</dd>
      </div>
    </dl>
  );
}

function SecaoFabrica({ fab, numero, destaque, agora }: { fab: Snapshot; numero: number; destaque: boolean; agora: number }) {
  const id = idFabrica(fab);
  const temProducao = fab.episodios.length > 0 || fab.fabrica.etapas.length > 0;
  return (
    <section id={`fab-${id}`} className={f.secao} data-destaque={destaque || undefined} aria-labelledby={`fab-${id}-titulo`}>
      <Cabeca
        fab={fab}
        numero={numero}
        destaque={destaque}
        dica={DICA[id] ?? 'Fábrica de vídeos do estúdio.'}
        lado={fab.episodios.some((e) => e.estado !== 'agendado') ? <Totais fab={fab} /> : null}
      />
      {fab.pauta && fab.pauta.itens.length > 0 ? <Semana pauta={fab.pauta} personagem={fab.personagem} agora={agora} /> : null}
      {fab.plano ? <Plano plano={fab.plano} /> : null}
      {temProducao ? (
        <>
          {fab.fabrica.etapas.length > 0 ? <Fabrica etapas={fab.fabrica.etapas} episodios={fab.episodios} horario={fab.serie.horario} agora={agora} /> : null}
          {fab.redes.length > 0 ? <Redes redes={fab.redes} episodios={fab.episodios} horario={fab.serie.horario} agora={agora} /> : null}
          {fab.episodios.length > 0 ? <Placar episodios={fab.episodios} /> : null}
        </>
      ) : null}
    </section>
  );
}

export default function EstudioPanel() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [atualizando, setAtualizando] = useState(false);
  const agora = useAgora(30000);

  const carregar = useCallback(async (sinal?: AbortSignal) => {
    setAtualizando(true);
    try {
      const { data } = await api.get<RespostaEstudio>('/admin/estudio', { signal: sinal });
      const lista = fabricasDa(data);
      if (lista.length > 0) setEstado({ fase: 'ok', fabricas: lista, exemplo: false });
      else setEstado({ fase: 'ok', fabricas: fixtureFabricas(), exemplo: true });
    } catch (e) {
      if (sinal?.aborted) return;
      if (EM_DEV) setEstado({ fase: 'ok', fabricas: fixtureFabricas(), exemplo: true });
      else setEstado((atual) => (atual.fase === 'ok' ? atual : { fase: 'erro' }));
      if (!EM_DEV) console.warn('[estudio] falha ao ler /admin/estudio', e);
    } finally {
      if (!sinal?.aborted) setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    carregar(ctrl.signal);
    const id = window.setInterval(() => carregar(), RECARREGA_MS);
    return () => {
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [carregar]);

  const raiz = `${s.raiz} ${geist.variable} ${geistMono.variable}`;

  if (estado.fase === 'carregando') {
    return (
      <div className={raiz} aria-busy="true">
        <p className={s.carregando} role="status">Ligando as máquinas…</p>
      </div>
    );
  }

  if (estado.fase === 'erro') {
    return (
      <div className={raiz}>
        <div className={s.erro} role="alert">
          <p>Não deu para ler o estúdio agora. A api não respondeu.</p>
          <button type="button" className={s.botao} onClick={() => carregar()} disabled={atualizando}>
            <RefreshCw size={14} aria-hidden="true" /> Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  const { fabricas, exemplo } = estado;
  const atualizadoEm = fabricas.map((x) => x.atualizadoEm).sort().at(-1) ?? new Date(agora).toISOString();
  const postsSemana = fabricas
    .filter((x) => situacaoFabrica(x) === 'no-ar')
    .reduce((acc, x) => acc + horariosFabrica(x).length * 7, 0);
  const naFila = fabricas.reduce(
    (acc, x) => acc + agendados(x.episodios, agora).length + (x.pauta?.itens.filter((i) => i.etapa === 'agendado').length ?? 0),
    0,
  );
  const views = fabricas.reduce((acc, x) => acc + (x.totais?.views ?? 0), 0);
  const destaque = fabricas.find((x) => x.pauta && x.pauta.itens.length > 0) ?? null;
  const ordemTela = destaque ? [destaque, ...fabricas.filter((x) => x !== destaque)] : fabricas;
  const noAr = fabricas.filter((x) => situacaoFabrica(x) === 'no-ar').length;

  return (
    <div className={raiz}>
      <header className={`${s.topo} ${f.topo}`}>
        <div className={s.grade} aria-hidden="true" />
        <div className={s.marca}>
          <h2 className={s.titulo}>Estúdio</h2>
          <p className={s.promessa}>
            {POR_EXTENSO[fabricas.length] ?? fabricas.length} {fabricas.length === 1 ? 'fábrica' : 'fábricas'} de vídeo. Cada uma com conta, horário e régua.
          </p>
          <div className={s.atualizado}>
            <span className={s.vivo} aria-hidden="true" />
            <span>Atualizado {haQuanto(atualizadoEm, agora)}</span>
            <button type="button" className={s.botaoMini} onClick={() => carregar()} disabled={atualizando} aria-label="Atualizar agora">
              <RefreshCw size={13} aria-hidden="true" className={atualizando ? s.girando : undefined} />
            </button>
            {exemplo ? <span className={s.selo}>Dados de exemplo</span> : null}
          </div>
        </div>
        <dl className={f.resumo}>
          <div>
            <dt>No ar</dt>
            <dd>{noAr}<small>/{fabricas.length}</small></dd>
          </div>
          <div>
            <dt>Posts por semana</dt>
            <dd>{postsSemana}</dd>
          </div>
          <div>
            <dt>
              Na fila
              <Dica lado="direita" texto="Vídeos prontos e agendados que ainda vão sair, somando as fábricas." />
            </dt>
            <dd>{naFila}</dd>
          </div>
          <div>
            <dt>Views</dt>
            <dd>{num(views)}</dd>
          </div>
        </dl>
      </header>

      <Cartoes fabricas={fabricas} agora={agora} />

      {ordemTela.map((fab) => (
        <SecaoFabrica
          key={idFabrica(fab)}
          fab={fab}
          numero={fab.ordem ?? fabricas.indexOf(fab) + 1}
          destaque={fab === destaque && fabricas.length > 1}
          agora={agora}
        />
      ))}
    </div>
  );
}
