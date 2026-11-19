'use client';

// ───────────────────────────────────────────────────────────────────────────
// O período e o resumo do Monjour, divididos entre as sub-abas do produto.
// Uma leitura de GET /admin/monjour/resumo serve Visão geral, Vendas, Leads,
// App e Anúncios; o Funil lê a própria rota com o mesmo período.
// ───────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import api from '@/services/api';
import admin from '../../admin.module.css';
import s from './MonjourFunilPanel.module.css';
import r from './MonjourResumo.module.css';
import { fmtData, fmtHora } from './monjourComum';
import { lerResumo, type ResumoMonjour } from './hubMonjourResumo.types';

export const PERIODOS_MJ = [
  { k: 'hoje', label: 'Hoje' }, { k: 'ontem', label: 'Ontem' }, { k: '7dias', label: '7 dias' },
  { k: '30dias', label: '30 dias' }, { k: 'maximo', label: 'Máximo' },
];

type Ctx = {
  periodo: string;
  trocarPeriodo: (p: string) => void;
  atualizar: () => void;
  dados: ResumoMonjour | null;
  erro: string;
  carregando: boolean;
};
const Contexto = createContext<Ctx | null>(null);

export function useResumoMonjour(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error('useResumoMonjour fora do MonjourResumoProvider');
  return c;
}

export function MonjourResumoProvider({ children }: { children: ReactNode }) {
  const [periodo, setPeriodo] = useState('7dias');
  const [versao, setVersao] = useState(0);
  const [dados, setDados] = useState<ResumoMonjour | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  // O estado só muda na volta da leitura; quem clica acende o "Atualizando…".
  useEffect(() => {
    let vivo = true;
    api.get(`/admin/monjour/resumo?period=${encodeURIComponent(periodo)}`)
      .then((res) => {
        if (!vivo) return;
        const d = lerResumo(res.data);
        if (d) { setDados(d); setErro(''); } else setErro('Resposta inesperada da api');
      })
      .catch((e) => { if (vivo) setErro(String(e?.response?.data?.error || e?.message || e)); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [periodo, versao]);

  const trocarPeriodo = (p: string) => { if (p !== periodo) { setCarregando(true); setPeriodo(p); } };
  const atualizar = () => { setCarregando(true); setVersao((v) => v + 1); };

  return (
    <Contexto.Provider value={{ periodo, trocarPeriodo, atualizar, dados, erro, carregando }}>
      {children}
    </Contexto.Provider>
  );
}

const motivoComPonto = (m?: string) => {
  const x = (m || 'O site do Monjour não respondeu').trim();
  return /[.!?]$/.test(x) ? x : `${x}.`;
};

/** Período, Atualizar, a linha de quando e os avisos (erro, site fora, conta cortada). */
export function MonjourTopo({ semAvisoDeVendas }: { semAvisoDeVendas?: boolean }) {
  const { periodo, trocarPeriodo, atualizar, dados, erro, carregando } = useResumoMonjour();
  const p = dados?.periodo;
  const intervalo = p?.desde ? (p.desde === p.ate ? fmtData(p.desde) : `${fmtData(p.desde)} a ${fmtData(p.ate)}`) : '';

  return (
    <>
      <div className={s.topo}>
        <div className={s.periodos} role="group" aria-label="Período">
          {PERIODOS_MJ.map((x) => (
            <button key={x.k} type="button" aria-pressed={periodo === x.k}
              className={periodo === x.k ? admin.periodActive : admin.periodBtn} onClick={() => trocarPeriodo(x.k)}>
              {x.label}
            </button>
          ))}
        </div>
        <button type="button" className={`${admin.periodBtn} ${s.atualizar}`} disabled={carregando} onClick={atualizar}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      <div className={s.linhaTempo} aria-live="polite">
        {intervalo && <span>{intervalo}</span>}
        {dados?.atualizadoEm && <span>Atualizado às {fmtHora(dados.atualizadoEm)}</span>}
      </div>

      {erro && <div className={`${admin.card} ${s.aviso}`} role="alert">Não consegui ler o resumo: {erro}. Tente Atualizar.</div>}
      {!dados && !erro && <div className={`${admin.card} ${s.aviso} ${r.mudo}`}>Carregando o resumo…</div>}
      {dados?.indisponivel && !semAvisoDeVendas && (
        <div className={r.alerta} role="status">
          <strong>Vendas e leads não chegaram agora.</strong>
          <span>{motivoComPonto(dados.motivo)} Os números do app e do funil continuam valendo.</span>
        </div>
      )}
      {dados?.truncado && (
        <div className={r.alerta} role="status">
          <strong>O período passou de 3.000 itens na Stripe e a conta parou aí.</strong>
          <span>Escolha um período menor para ver tudo.</span>
        </div>
      )}
    </>
  );
}
