'use client';

// ───────────────────────────────────────────────────────────────────────────
// O período e o resumo da Domina IA, divididos entre as sub-abas do produto.
// Uma leitura de GET /admin/dominaia/resumo serve Visão geral, Vendas, Leads,
// App e Anúncios; o Funil lê a própria rota com o mesmo período.
// ───────────────────────────────────────────────────────────────────────────
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import api from '@/services/api';
import admin from '../../admin.module.css';
import s from './DominaiaFunilPanel.module.css';
import r from './DominaiaResumo.module.css';
import { fmtData, fmtHora } from './dominaiaComum';
import { lerResumo, type ResumoDominaia } from './hubDominaiaResumo.types';

export const PERIODOS_DM = [
  { k: 'hoje', label: 'Hoje' }, { k: 'ontem', label: 'Ontem' }, { k: '7dias', label: '7 dias' },
  { k: '30dias', label: '30 dias' }, { k: 'maximo', label: 'Máximo' },
];

type Ctx = {
  periodo: string;
  trocarPeriodo: (p: string) => void;
  atualizar: () => void;
  dados: ResumoDominaia | null;
  erro: string;
  carregando: boolean;
  /** Visitantes por país (ISO) que o Funil já leu sem filtro, neste período. Null antes disso. */
  visitasPais: Record<string, number> | null;
  informarVisitas: (periodo: string, porPais: Record<string, number>) => void;
};
const Contexto = createContext<Ctx | null>(null);

export function useResumoDominaia(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error('useResumoDominaia fora do DominaiaResumoProvider');
  return c;
}

export function DominaiaResumoProvider({ children }: { children: ReactNode }) {
  const [periodo, setPeriodo] = useState('hoje');
  const [versao, setVersao] = useState(0);
  const [dados, setDados] = useState<ResumoDominaia | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [visitas, setVisitas] = useState<{ periodo: string; porPais: Record<string, number> } | null>(null);

  // O estado só muda na volta da leitura; quem clica acende o "Atualizando…".
  useEffect(() => {
    let vivo = true;
    api.get(`/admin/dominaia/resumo?period=${encodeURIComponent(periodo)}`)
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
  // O Funil já lê os visitantes por país; a faixa de países aproveita sem outra chamada.
  const informarVisitas = useCallback((p: string, porPais: Record<string, number>) => setVisitas({ periodo: p, porPais }), []);
  const visitasPais = visitas && visitas.periodo === periodo ? visitas.porPais : null;

  return (
    <Contexto.Provider value={{ periodo, trocarPeriodo, atualizar, dados, erro, carregando, visitasPais, informarVisitas }}>
      {children}
    </Contexto.Provider>
  );
}

const motivoComPonto = (m?: string) => {
  const x = (m || 'O site da Domina IA não respondeu').trim();
  return /[.!?]$/.test(x) ? x : `${x}.`;
};

/** Período, Atualizar, a linha de quando e os avisos (erro, site fora, conta cortada). */
export function DominaiaTopo({ semAvisoDeVendas }: { semAvisoDeVendas?: boolean }) {
  const { periodo, trocarPeriodo, atualizar, dados, erro, carregando } = useResumoDominaia();
  const p = dados?.periodo;
  const intervalo = p?.desde ? (p.desde === p.ate ? fmtData(p.desde) : `${fmtData(p.desde)} a ${fmtData(p.ate)}`) : '';

  return (
    <>
      <div className={s.topo}>
        <div className={s.periodos} role="group" aria-label="Período">
          {PERIODOS_DM.map((x) => (
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
