'use client';

// ───────────────────────────────────────────────────────────────────────────
// MEMBROS DO MONJOUR: quem comprou (ou ganhou cortesia) e o que faz no app.
// No topo, "O que mais gostam" (GET /admin/monjour/gostos, no período).
// Embaixo, a lista (GET /admin/monjour/membros): sempre todos os membros, com o
// período valendo só para o uso. Clicar num membro abre a gaveta com o histórico.
// O período é o mesmo das outras sub-abas do Monjour (MonjourResumoContexto).
// ───────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import api from '@/services/api';
import admin from '../../admin.module.css';
import s from './MonjourFunilPanel.module.css';
import r from './MonjourResumo.module.css';
import mm from './MonjourMembros.module.css';
import { fmtInt } from './monjourComum';
import { fmtQuando, nomePais } from './monjourResumoComum';
import { PERIODOS_MJ, useResumoMonjour } from './MonjourResumoContexto';
import { NotaUso, PlanoMembro, fmtRelativo } from './monjourMembrosComum';
import MonjourGostos from './MonjourGostos';
import MonjourMembroGaveta from './MonjourMembroGaveta';
import { lerGostos, lerMembros, type Gostos, type ListaMembros, type Membro } from './hubMonjourJornadas.types';

const PLANOS = [
  { k: '', label: 'Todos' }, { k: 'basico', label: 'Básico' }, { k: 'plus', label: 'Plus' },
  { k: 'cortesia', label: 'Cortesia' }, { k: 'sem_compra', label: 'Sem compra' },
];
const PAGINA = 50;

// A api filtra plano (basico, plus, cortesia, sem_compra), busca e parados sobre todos os
// membros, e o total vem já filtrado. O painel confere de novo, para a lista nunca mostrar
// o que o filtro tirou. Sem compra é quem não tem compra nem cortesia, igual à api.
const semCompra = (x: Membro) => (x.semCompra ?? !x.compradoEm) && !x.cortesia;
const passa = (x: Membro, plano: string, parados: boolean, termo: string) =>
  (!parados || x.parado)
  && (!termo || (x.email || '').toLowerCase().includes(termo) || x.m.startsWith(termo))
  && (!plano || (plano === 'cortesia' ? x.cortesia : plano === 'sem_compra' ? semCompra(x) : x.plano === plano));

export default function MonjourMembrosPanel() {
  const { periodo, trocarPeriodo } = useResumoMonjour();
  const [versao, setVersao] = useState(0);
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [plano, setPlano] = useState('');
  const [parados, setParados] = useState(false);
  const [limite, setLimite] = useState(PAGINA);
  const [lista, setLista] = useState<ListaMembros | null>(null);
  const [gostos, setGostos] = useState<Gostos | null>(null);
  const [erro, setErro] = useState({ lista: '', gostos: '' });
  const [lendo, setLendo] = useState({ lista: true, gostos: true });
  const [aberto, setAberto] = useState<Membro | null>(null);

  // A busca espera a pessoa parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => {
      const novo = busca.trim().toLowerCase();
      if (novo !== termo) { setLendo((l) => ({ ...l, lista: true })); setLimite(PAGINA); setTermo(novo); }
    }, 300);
    return () => clearTimeout(t);
  }, [busca, termo]);

  useEffect(() => {
    let vivo = true;
    api.get(`/admin/monjour/gostos?period=${encodeURIComponent(periodo)}`)
      .then((res) => { if (!vivo) return; const d = lerGostos(res.data); setGostos(d); setErro((e) => ({ ...e, gostos: d ? '' : 'Resposta inesperada da api' })); })
      .catch((e) => { if (vivo) setErro((x) => ({ ...x, gostos: String(e?.response?.data?.error || e?.message || e) })); })
      .finally(() => { if (vivo) setLendo((l) => ({ ...l, gostos: false })); });
    return () => { vivo = false; };
  }, [periodo, versao]);

  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams({ period: periodo });
    if (termo) q.set('q', termo);
    if (plano) q.set('plano', plano);
    if (parados) q.set('parados', '1');
    api.get(`/admin/monjour/membros?${q.toString()}`)
      .then((res) => { if (!vivo) return; const d = lerMembros(res.data); setLista(d); setErro((e) => ({ ...e, lista: d ? '' : 'Resposta inesperada da api' })); })
      .catch((e) => { if (vivo) setErro((x) => ({ ...x, lista: String(e?.response?.data?.error || e?.message || e) })); })
      .finally(() => { if (vivo) setLendo((l) => ({ ...l, lista: false })); });
    return () => { vivo = false; };
  }, [periodo, termo, plano, parados, versao]);

  const recarregar = (oque: 'tudo' | 'lista') => { setLendo((l) => ({ lista: true, gostos: oque === 'tudo' ? true : l.gostos })); setLimite(PAGINA); };
  const mudarPeriodo = (p: string) => { if (p !== periodo) { recarregar('tudo'); trocarPeriodo(p); } };
  const atualizar = () => { recarregar('tudo'); setVersao((v) => v + 1); };
  const mudarFiltro = <T,>(set: (v: T) => void) => (v: T) => { recarregar('lista'); set(v); };

  const linhas = (lista?.itens ?? []).filter((x) => passa(x, plano, parados, termo));
  const filtrando = Boolean(termo || plano || parados);
  const carregando = lendo.lista || lendo.gostos;

  return (
    <div className={s.raiz}>
      <div className={s.topo}>
        <div className={s.periodos} role="group" aria-label="Período do uso">
          {PERIODOS_MJ.map((x) => (
            <button key={x.k} type="button" aria-pressed={periodo === x.k}
              className={periodo === x.k ? admin.periodActive : admin.periodBtn} onClick={() => mudarPeriodo(x.k)}>
              {x.label}
            </button>
          ))}
        </div>
        <button type="button" className={`${admin.periodBtn} ${s.atualizar}`} disabled={carregando} onClick={atualizar}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      <p className={s.linhaTempo}>O período vale para o uso do app. A lista mostra todos os membros.</p>

      {erro.gostos && <div className={`${admin.card} ${s.aviso}`} role="alert">Não consegui ler o uso do app: {erro.gostos}. Tente Atualizar.</div>}
      {!erro.gostos && <MonjourGostos g={gostos} carregando={lendo.gostos} />}

      <section className={s.bloco} aria-labelledby="mj-membros">
        <div className={s.blocoTopo}>
          <h3 id="mj-membros" className={s.blocoTitulo}>Membros</h3>
          {lista && (
            <span className={r.resumoLinha} aria-live="polite">
              {fmtInt(lista.total)} {lista.total === 1 ? 'membro' : 'membros'}{filtrando ? ' no filtro' : ''}
              {lista.itens.length < lista.total ? `. A lista mostra os ${fmtInt(lista.itens.length)} mais recentes.` : ''}
            </span>
          )}
        </div>

        <div className={mm.ferramentas}>
          <label className={mm.busca} htmlFor="mj-busca-membro">
            <span>Buscar e-mail</span>
            <span className={mm.buscaCampo}>
              <Search size={16} aria-hidden="true" />
              <input id="mj-busca-membro" className="input-field" type="search" inputMode="email" name="mj-busca-membro" autoComplete="off"
                spellCheck={false} placeholder="nome@…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </span>
          </label>
          <div className={mm.filtroGrupo}>
            <span className={mm.filtroRotulo} id="mj-plano-rotulo">Plano</span>
            <div className={s.periodos} role="group" aria-labelledby="mj-plano-rotulo">
              {PLANOS.map((p) => (
                <button key={p.k} type="button" aria-pressed={plano === p.k}
                  className={plano === p.k ? admin.periodActive : admin.periodBtn} onClick={() => plano !== p.k && mudarFiltro(setPlano)(p.k)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" aria-pressed={parados} className={`${mm.parados} ${parados ? mm.paradosOn : ''}`} onClick={() => mudarFiltro(setParados)(!parados)}>
            <span className={mm.caixa} aria-hidden="true" />
            Parados há 3 dias ou mais
          </button>
        </div>

        {erro.lista && <div className={`${admin.card} ${s.aviso}`} role="alert">Não consegui ler os membros: {erro.lista}. Tente Atualizar.</div>}
        {!lista && !erro.lista && <p className={r.nota}>Lendo os membros…</p>}
        {lista?.indisponivel && (
          <div className={r.alerta} role="status">
            <strong>As compras do site não chegaram agora.</strong>
            <span>{lista.motivo ? `${lista.motivo}. ` : ''}Tente Atualizar em alguns minutos.</span>
          </div>
        )}

        {lista && lista.total === 0 && !filtrando && !lista.indisponivel && (
          <div className={s.vazio}>
            <strong>Ainda não há membros.</strong>
            <span>Quem comprar ou abrir o app com acesso aparece aqui.</span>
          </div>
        )}

        {lista && (lista.total > 0 || filtrando) && (
          <div className={`${r.rolagem} ${lendo.lista ? mm.esmaecido : ''}`}>
            <table className={`${r.tabela} ${r.cartoes} ${mm.membros}`}>
              <thead>
                <tr>
                  <th scope="col">E-mail</th><th scope="col">Plano</th><th scope="col">Compra</th><th scope="col">País</th>
                  <th scope="col">Último uso</th><th scope="col" className={r.direita}>Dias ativos</th>
                  <th scope="col" className={r.direita}>Chegou ao dia</th><th scope="col">Nota de uso</th><th scope="col">Instalou</th>
                </tr>
              </thead>
              <tbody>
                {linhas.length === 0 && <tr><td colSpan={9} className={s.vazioCelula}>Nenhum membro com esse filtro.</td></tr>}
                {linhas.slice(0, limite).map((x) => (
                  <tr key={x.m} className={mm.linha} onClick={() => setAberto(x)}>
                    <td data-rotulo="E-mail" className={mm.email}>
                      <button type="button" className={mm.abrir} title={x.email ?? undefined} onClick={(e) => { e.stopPropagation(); setAberto(x); }}>
                        {x.email || 'Sem e-mail'}
                      </button>
                    </td>
                    <td data-rotulo="Plano"><PlanoMembro x={x} /></td>
                    <td data-rotulo="Compra" className={r.nowrap}>{x.compradoEm ? fmtQuando(x.compradoEm) : <span className={r.mudo}>—</span>}</td>
                    <td data-rotulo="País" className={r.nowrap}>{nomePais(x.pais ?? '')}</td>
                    <td data-rotulo="Último uso" className={r.nowrap}>
                      {x.ultimoUso ? fmtRelativo(x.ultimoUso) : <span className={r.mudo}>Nunca abriu</span>}
                      {x.parado && <span className={mm.seloParado}>Parado</span>}
                    </td>
                    <td data-rotulo="Dias ativos" className={r.direita}>{fmtInt(x.diasAtivos)}</td>
                    <td data-rotulo="Até o dia" className={r.direita}>{x.diaMaximo ? `${x.diaMaximo} de 21` : '—'}</td>
                    <td data-rotulo="Nota de uso"><NotaUso nota={x.nota} /></td>
                    <td data-rotulo="Instalou">{x.instalou ? <span className={`${r.selo} ${r.seloBom}`}>Sim</span> : <span className={r.mudo}>Não</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {linhas.length > limite && (
          <button type="button" className={`${admin.periodBtn} ${r.mais}`} onClick={() => setLimite((n) => n + PAGINA)}>
            Mostrar mais {fmtInt(Math.min(PAGINA, linhas.length - limite))} (faltam {fmtInt(linhas.length - limite)})
          </button>
        )}
      </section>

      <MonjourMembroGaveta membro={aberto} aoFechar={() => setAberto(null)} />
    </div>
  );
}
