'use client';

// ─── Aba "Estúdio": a fábrica de vídeos com IA, ao vivo ─────────────────────
// Lê GET /admin/estudio ({ snapshot, atualizadoEm }). Em desenvolvimento, ou se a
// api devolver snapshot null, cai na fixture e mostra o selo "Dados de exemplo".
// Visual próprio e escuro, contido neste bloco: não mexe no tema do /admin.

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '@/services/api';
import type { RespostaEstudio, Snapshot } from './estudio/tipos';
import { REDES } from './estudio/tipos';
import { fixtureEstudio } from './estudio/fixture';
import { haQuanto, NOME_REDE, num } from './estudio/formato';
import { geist, geistMono } from './estudio/fontes';
import Fabrica from './estudio/Fabrica';
import Redes from './estudio/Redes';
import Placar from './estudio/Placar';
import s from './estudio/estudio.module.css';

const EM_DEV = process.env.NODE_ENV === 'development';
const RECARREGA_MS = 5 * 60000;

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro' }
  | { fase: 'ok'; snap: Snapshot; exemplo: boolean };

function useAgora(passoMs: number) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), passoMs);
    return () => window.clearInterval(id);
  }, [passoMs]);
  return agora;
}

export default function EstudioPanel() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [atualizando, setAtualizando] = useState(false);
  const agora = useAgora(30000);

  const carregar = useCallback(async (sinal?: AbortSignal) => {
    setAtualizando(true);
    try {
      const { data } = await api.get<RespostaEstudio>('/admin/estudio', { signal: sinal });
      if (data?.snapshot) setEstado({ fase: 'ok', snap: data.snapshot, exemplo: false });
      else setEstado({ fase: 'ok', snap: fixtureEstudio(), exemplo: true });
    } catch (e) {
      if (sinal?.aborted) return;
      if (EM_DEV) setEstado({ fase: 'ok', snap: fixtureEstudio(), exemplo: true });
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

  const { snap, exemplo } = estado;
  const t = snap.totais;
  const somaRedes = REDES.reduce((acc, r) => acc + (t.porRede[r]?.views ?? 0), 0);

  return (
    <div className={raiz}>
      <header className={s.topo}>
        <div className={s.grade} aria-hidden="true" />
        <div className={s.marca}>
          <h2 className={s.titulo}>Estúdio</h2>
          <p className={s.promessa}>Uma fábrica de vídeos que roda sozinha.</p>
          <p className={s.serie}>
            <span className={s.serieItem}>Série <strong>{snap.serie.nome}</strong></span>
            <span className={s.serieItem}>{snap.serie.automatico ? 'No automático' : 'Manual'}</span>
            <span className={s.serieItem}>Publica às {snap.serie.horario}</span>
          </p>
          <div className={s.atualizado}>
            <span className={s.vivo} aria-hidden="true" />
            <span>Atualizado {haQuanto(snap.atualizadoEm, agora)}</span>
            <button type="button" className={s.botaoMini} onClick={() => carregar()} disabled={atualizando} aria-label="Atualizar agora">
              <RefreshCw size={13} aria-hidden="true" className={atualizando ? s.girando : undefined} />
            </button>
            {exemplo ? <span className={s.selo}>Dados de exemplo</span> : null}
          </div>
        </div>

        <dl className={s.totais}>
          <div className={s.totalViews}>
            <dt>Views</dt>
            <dd className={s.numGrande}>{num(t.views)}</dd>
            {somaRedes > 0 ? (
              <dd className={s.divisao}>
                <span className={s.divBarra} aria-hidden="true">
                  {REDES.map((r) => (
                    <span key={r} data-rede={r} style={{ flexGrow: t.porRede[r]?.views ?? 0 }} />
                  ))}
                </span>
                <span className={s.divLegenda}>
                  {REDES.map((r) => (
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
      </header>

      <Fabrica etapas={snap.fabrica.etapas} episodios={snap.episodios} horario={snap.serie.horario} agora={agora} />
      <Redes redes={snap.redes} episodios={snap.episodios} horario={snap.serie.horario} agora={agora} />
      <Placar episodios={snap.episodios} />
    </div>
  );
}
