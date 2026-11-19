'use client';

// ─────────────────────────────────────────────────────────────────────────────
// NEXUS INSTAGRAM (19/11/2026): quem entrou na lista solardoc.app/nexus/interesse,
// o link da bio do Instagram da NEXUS. Lista permanente com duas portas:
// Eletroposto (um caminho e as três perguntas dele) e Mobilidade elétrica (itens,
// para quê, quanto investir e como pagar). O backend só soma (nunca apaga) e
// verifica se o número tem WhatsApp (whatsapp_ok: true, false ou null).
// Lê GET /io/eletroposto/nexus-instagram/admin?teste=0|1 (authMiddleware + admin).
// Os rótulos ficam em nexusInstagramRotulos.ts: slug muda só junto com o backend.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import { baixarCsv, calcularResumo, filtrarLinhas, rot, FILTROS_VAZIOS, type Filtros, type Row } from './nexusInstagramDados';
import { CAMINHO, MOB, OBJ, INV, INV_ATUAIS, REC, type Whats } from './nexusInstagramRotulos';
import NexusInstagramLinha from './NexusInstagramLinha';
import styles from './NexusInstagramPanel.module.css';

// `agora` é a hora da resposta: os "últimos 7 dias" contam a partir dela, não do render.
const PILULA: Record<Whats, [string, string]> = {
  ok: ['confirmado', 'confirmados'], sem: ['sem WhatsApp', 'sem WhatsApp'], nv: ['não verificado', 'não verificados'],
};

interface Resposta { chave: string; itens: Row[] | null; erro: string; agora: number }

export default function NexusInstagramPanel() {
  const { user } = useDashboard();
  const admin = !!user?.is_admin;

  const [mostrarTeste, setMostrarTeste] = useState(false);
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState<Resposta>({ chave: '', itens: null, erro: '', agora: 0 });
  const [f, setF] = useState<Filtros>(FILTROS_VAZIOS);
  const [aberta, setAberta] = useState<string | null>(null);
  const muda = (campo: keyof Filtros, valor: string) => setF((x) => ({ ...x, [campo]: valor }));

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
  const visiveis = useMemo(() => filtrarLinhas(rows, f), [rows, f]);
  const temFiltro = Object.values(f).some(Boolean);

  if (!admin) return null;

  const maxEp = Math.max(1, ...resumo.rankEp.map((x) => x.n));
  const maxMob = Math.max(1, ...resumo.rankMob.map((x) => x.n));
  const cw = resumo.contaWhats;

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
        <Numero rotulo="Com eletroposto" valor={resumo.comEp} destaque onClick={() => muda('caminho', '*')} />
        <Numero rotulo="Querem revender" valor={resumo.revenda} onClick={() => muda('objetivo', 'revenda')} />
        <Numero rotulo="Acima de R$ 100 mil" valor={resumo.acima} onClick={() => muda('faixa', 'acima_100')} />
      </div>

      <div className={styles.whatsLinha} role="group" aria-label="Situação do WhatsApp">
        <span className={styles.whatsRot}>WhatsApp</span>
        {(['ok', 'sem', 'nv'] as Whats[]).map((w) => (
          <button
            key={w} type="button" aria-pressed={f.whats === w}
            className={`${styles.whatsBtn} ${styles[`whats_${w}`]} ${f.whats === w ? styles.whatsOn : ''}`}
            onClick={() => muda('whats', f.whats === w ? '' : w)}
          >
            <b>{cw[w]}</b> {PILULA[w][cw[w] === 1 ? 0 : 1]}
          </button>
        ))}
      </div>

      <div className={styles.rankings}>
        <section className={`${styles.rank} ${styles.rankEp}`} aria-labelledby="rk-ep">
          <h3 id="rk-ep">Eletroposto NEXUS: pessoas por caminho</h3>
          <ol>
            {resumo.rankEp.map(({ k, n }) => (
              <li key={k}>
                <button type="button" onClick={() => muda('caminho', k)} aria-label={`Filtrar ${CAMINHO[k]}, ${n}`}>
                  <span className={styles.rankNome}>{CAMINHO[k]}</span>
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
                  <button type="button" onClick={() => muda('item', `mob:${k}`)} aria-label={`Filtrar ${rot(MOB, k)}, ${n}`}>
                    <span className={styles.rankNome}>{rot(MOB, k)}</span>
                    <span className={styles.barra}><span style={{ width: `${(n / maxMob) * 100}%` }} /></span>
                    <span className={styles.rankN}>{n}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {resumo.comOutro > 0 && (
            <button type="button" className={styles.linkOutro} onClick={() => muda('item', 'outro:*')}>
              {resumo.comOutro} {resumo.comOutro === 1 ? 'escreveu' : 'escreveram'} algo fora da lista
            </button>
          )}
        </section>
      </div>

      <div className={styles.filtros}>
        <label className={styles.busca}>
          <span className={styles.sr}>Buscar</span>
          <input
            type="search" value={f.busca} onChange={(e) => muda('busca', e.target.value)}
            placeholder="Buscar nome, contato, cidade, empresa…" autoComplete="off" spellCheck={false}
          />
        </label>
        <Escolha rotulo="Caminho do eletroposto" valor={f.caminho} onChange={(v) => muda('caminho', v)} vazio="Todo caminho"
          opcoes={[['*', 'Qualquer caminho'], ...Object.entries(CAMINHO)]} />
        <Escolha rotulo="Mobilidade" valor={f.item} onChange={(v) => muda('item', v)} vazio="Toda mobilidade"
          opcoes={[['mob:*', 'Qualquer item'], ...Object.entries(MOB).map(([k, v]): [string, string] => [`mob:${k}`, v]), ['outro:*', 'Escreveu outra coisa']]} />
        <Escolha rotulo="Objetivo" valor={f.objetivo} onChange={(v) => muda('objetivo', v)} vazio="Todo objetivo" opcoes={Object.entries(OBJ)} />
        <Escolha rotulo="Faixa de investimento" valor={f.faixa} onChange={(v) => muda('faixa', v)} vazio="Toda faixa"
          opcoes={[['acima_100', 'Acima de R$ 100 mil'], ...INV_ATUAIS.map((k): [string, string] => [k, INV[k]])]} />
        <Escolha rotulo="Recurso" valor={f.recurso} onChange={(v) => muda('recurso', v)} vazio="Todo recurso" opcoes={Object.entries(REC)} />
        <span className={styles.conta} aria-live="polite">
          {visiveis.length} de {rows.length}
          {temFiltro && <button type="button" onClick={() => setF(FILTROS_VAZIOS)}>Limpar</button>}
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
              <th scope="col">Perfil e respostas</th>
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

function Escolha({ rotulo, valor, onChange, vazio, opcoes }: {
  rotulo: string; valor: string; onChange: (v: string) => void; vazio: string; opcoes: [string, string][];
}) {
  return (
    <label className={styles.escolha}>
      <span className={styles.sr}>{rotulo}</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">{vazio}</option>
        {opcoes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
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
