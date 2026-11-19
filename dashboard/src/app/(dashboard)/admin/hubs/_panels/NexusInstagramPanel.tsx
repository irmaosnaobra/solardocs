'use client';

// ─────────────────────────────────────────────────────────────────────────────
// NEXUS INSTAGRAM (19/11/2026): quem entrou na lista solardoc.app/nexus/interesse,
// o link da bio do Instagram da NEXUS. Lista permanente: a pessoa marca frentes do
// Eletroposto NEXUS e itens de mobilidade elétrica, diz para quê, quanto pretende
// investir, como pretende pagar e deixa os dados. O backend só soma (nunca apaga).
// Lê GET /io/eletroposto/nexus-instagram/admin?teste=0|1 (authMiddleware + admin).
// Os rótulos abaixo são os mesmos da página: slug muda só junto com o backend.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import {
  FRENTE, MOB, OBJ, INV, REC, rot, baixarCsv, calcularResumo, filtrarLinhas, type Row,
} from './nexusInstagramDados';
import NexusInstagramLinha from './NexusInstagramLinha';
import styles from './NexusInstagramPanel.module.css';

// `agora` é a hora da resposta: os "últimos 7 dias" contam a partir dela, não do render.
interface Resposta { chave: string; itens: Row[] | null; erro: string; agora: number }

export default function NexusInstagramPanel() {
  const { user } = useDashboard();
  const admin = !!user?.is_admin;

  const [mostrarTeste, setMostrarTeste] = useState(false);
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState<Resposta>({ chave: '', itens: null, erro: '', agora: 0 });
  const [busca, setBusca] = useState('');
  const [interesse, setInteresse] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [faixa, setFaixa] = useState('');
  const [recurso, setRecurso] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);

  const chave = `${mostrarTeste ? 1 : 0}-${tick}`;
  useEffect(() => {
    if (!admin) return;
    let vivo = true;
    api.get('/io/eletroposto/nexus-instagram/admin', { params: { teste: mostrarTeste ? 1 : 0 } })
      .then(({ data }) => {
        if (!vivo) return;
        if (data?.ok === false) setRes({ chave, itens: null, erro: data.erro || 'Não deu para carregar a lista agora.', agora: Date.now() });
        else setRes({ chave, itens: Array.isArray(data?.itens) ? data.itens : [], erro: '', agora: Date.now() });
      })
      .catch(() => { if (vivo) setRes({ chave, itens: null, erro: 'Não deu para carregar a lista agora.', agora: Date.now() }); });
    return () => { vivo = false; };
  }, [admin, chave, mostrarTeste]);

  const carregando = res.chave !== chave;
  const rows = useMemo(() => res.itens ?? [], [res.itens]);
  const agora = res.agora;


  const resumo = useMemo(() => calcularResumo(rows, agora), [rows, agora]);

  const visiveis = useMemo(
    () => filtrarLinhas(rows, { busca, interesse, objetivo, faixa, recurso }),
    [rows, busca, interesse, objetivo, faixa, recurso],
  );

  const temFiltro = !!(busca || interesse || objetivo || faixa || recurso);
  function limparFiltros() {
    setBusca(''); setInteresse(''); setObjetivo(''); setFaixa(''); setRecurso('');
  }

  if (!admin) return null;

  const maxEp = Math.max(1, ...resumo.rankEp.map((x) => x.n));
  const maxMob = Math.max(1, ...resumo.rankMob.map((x) => x.n));

  return (
    <div className={styles.painel}>
      <div className={styles.topo}>
        <p className={styles.fonte}>
          Quem entrou pela lista{' '}
          <a href="https://solardoc.app/nexus/interesse" target="_blank" rel="noopener noreferrer">solardoc.app/nexus/interesse</a>
          , o link da bio do Instagram da NEXUS.
        </p>
        <div className={styles.acoes}>
          <label className={styles.troca}>
            <input type="checkbox" checked={mostrarTeste} onChange={(e) => setMostrarTeste(e.target.checked)} />
            Mostrar testes
          </label>
          <button type="button" className={styles.btn} onClick={() => setTick((t) => t + 1)} disabled={carregando}>
            {carregando ? 'Carregando…' : 'Atualizar'}
          </button>
          <button type="button" className={styles.btnForte} onClick={() => baixarCsv(visiveis)} disabled={!visiveis.length}>
            Exportar CSV{visiveis.length ? ` (${visiveis.length})` : ''}
          </button>
        </div>
      </div>

      {res.erro && <div className={styles.erro} role="alert">{res.erro}</div>}

      <div className={styles.numeros}>
        <Numero rotulo="Na lista" valor={rows.length} />
        <Numero rotulo="Últimos 7 dias" valor={resumo.ultimos} />
        <Numero rotulo="Com eletroposto" valor={resumo.comEp} destaque onClick={() => setInteresse('ep:*')} />
        <Numero rotulo="Querem revender" valor={resumo.revenda} onClick={() => setObjetivo('revenda')} />
        <Numero rotulo="Acima de R$ 100 mil" valor={resumo.acima} onClick={() => setFaixa('acima_100')} />
      </div>

      <div className={styles.rankings}>
        <section className={`${styles.rank} ${styles.rankEp}`} aria-labelledby="rk-ep">
          <h3 id="rk-ep">Eletroposto NEXUS: frentes mais pedidas</h3>
          <ol>
            {resumo.rankEp.map(({ k, n }) => (
              <li key={k}>
                <button type="button" onClick={() => setInteresse(`ep:${k}`)} aria-label={`Filtrar ${FRENTE[k]}, ${n}`}>
                  <span className={styles.rankNome}>{FRENTE[k]}</span>
                  <span className={styles.barra}><span style={{ width: `${(n / maxEp) * 100}%` }} /></span>
                  <span className={styles.rankN}>{n}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles.rank} aria-labelledby="rk-mob">
          <h3 id="rk-mob">Mobilidade elétrica: mais pedidos</h3>
          {resumo.rankMob.length === 0 ? (
            <p className={styles.vazioRank}>Ninguém marcou um item de mobilidade ainda.</p>
          ) : (
            <ol>
              {resumo.rankMob.map(({ k, n }) => (
                <li key={k}>
                  <button type="button" onClick={() => setInteresse(`mob:${k}`)} aria-label={`Filtrar ${rot(MOB, k)}, ${n}`}>
                    <span className={styles.rankNome}>{rot(MOB, k)}</span>
                    <span className={styles.barra}><span style={{ width: `${(n / maxMob) * 100}%` }} /></span>
                    <span className={styles.rankN}>{n}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {resumo.comOutro > 0 && (
            <button type="button" className={styles.linkOutro} onClick={() => setInteresse('outro:*')}>
              {resumo.comOutro} {resumo.comOutro === 1 ? 'escreveu' : 'escreveram'} algo fora da lista
            </button>
          )}
        </section>
      </div>

      <div className={styles.filtros}>
        <label className={styles.busca}>
          <span className={styles.sr}>Buscar</span>
          <input
            type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome, contato, cidade ou texto…" autoComplete="off" spellCheck={false}
          />
        </label>
        <label>
          <span className={styles.sr}>Interesse</span>
          <select value={interesse} onChange={(e) => setInteresse(e.target.value)}>
            <option value="">Todo interesse</option>
            <optgroup label="Eletroposto NEXUS">
              <option value="ep:*">Qualquer frente</option>
              {Object.entries(FRENTE).map(([k, v]) => <option key={k} value={`ep:${k}`}>{v}</option>)}
            </optgroup>
            <optgroup label="Mobilidade elétrica">
              {Object.entries(MOB).map(([k, v]) => <option key={k} value={`mob:${k}`}>{v}</option>)}
            </optgroup>
            <option value="outro:*">Escreveu outra coisa</option>
          </select>
        </label>
        <label>
          <span className={styles.sr}>Objetivo</span>
          <select value={objetivo} onChange={(e) => setObjetivo(e.target.value)}>
            <option value="">Todo objetivo</option>
            {Object.entries(OBJ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className={styles.sr}>Faixa de investimento</span>
          <select value={faixa} onChange={(e) => setFaixa(e.target.value)}>
            <option value="">Toda faixa</option>
            <option value="acima_100">Acima de R$ 100 mil</option>
            {Object.entries(INV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          <span className={styles.sr}>Recurso</span>
          <select value={recurso} onChange={(e) => setRecurso(e.target.value)}>
            <option value="">Todo recurso</option>
            {Object.entries(REC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <span className={styles.conta} aria-live="polite">
          {visiveis.length} de {rows.length}
          {temFiltro && <button type="button" onClick={limparFiltros}>Limpar</button>}
        </span>
      </div>

      <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th scope="col"><span className={styles.sr}>Abrir</span></th>
              <th scope="col">Data</th>
              <th scope="col">Nome e cidade</th>
              <th scope="col">WhatsApp e e-mail</th>
              <th scope="col">Interesses</th>
              <th scope="col">Perfil</th>
            </tr>
          </thead>
          <tbody>
            {carregando && !rows.length ? (
              <tr><td colSpan={6} className={styles.vazio}>Carregando a lista…</td></tr>
            ) : visiveis.length === 0 ? (
              <tr>
                <td colSpan={6} className={styles.vazio}>
                  {rows.length === 0 ? 'Ninguém entrou na lista ainda.' : 'Nenhum resultado com esses filtros.'}
                </td>
              </tr>
            ) : visiveis.map((r) => (
              <NexusInstagramLinha key={r.id} r={r} aberto={aberta === r.id} onAlternar={() => setAberta(aberta === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Numero({ rotulo, valor, destaque, onClick }: { rotulo: string; valor: number; destaque?: boolean; onClick?: () => void }) {
  const corpo = (
    <>
      <span className={styles.numRot}>{rotulo}</span>
      <span className={styles.numVal}>{valor.toLocaleString('pt-BR')}</span>
    </>
  );
  const cls = `${styles.numero} ${destaque ? styles.numeroEp : ''}`;
  return onClick
    ? <button type="button" className={cls} onClick={onClick} title={`Filtrar: ${rotulo}`}>{corpo}</button>
    : <div className={cls}>{corpo}</div>;
}
