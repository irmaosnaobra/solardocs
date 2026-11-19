'use client';

// ─────────────────────────────────────────────────────────────────────────────
// IRMÃOS NA OBRA INSTAGRAM (19/11/2026): quem entrou na lista solardoc.app/io/interesse,
// o link da bio do Instagram da Irmãos na Obra. Quatro portas: Energia solar e
// Eletroposto viram card na agenda (Nilce no solar; rodízio Thiago e Diego no
// eletroposto); Integrador e Mobilidade elétrica ficam só na lista. O backend só
// soma (nunca apaga) e verifica se o número tem WhatsApp (whatsapp_ok).
// Lê GET /io/solar/lista-interesse/admin?teste=0|1 (authMiddleware + admin).
// Os rótulos ficam em ioInstagramRotulos.ts: slug muda só junto com o backend.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import { baixarCsv, calcularResumo, filtrarLinhas, FILTROS_VAZIOS, type Contagem, type Filtros, type Row } from './ioInstagramDados';
import { CAMINHO, CONTA, MOB, PORTA, PORTAS, type Whats } from './ioInstagramRotulos';
import IoInstagramLinha from './IoInstagramLinha';
import styles from './IoInstagramPanel.module.css';

const PILULA: Record<Whats, [string, string]> = {
  ok: ['confirmado', 'confirmados'], sem: ['sem WhatsApp', 'sem WhatsApp'], nv: ['não verificado', 'não verificados'],
};

// `agora` é a hora da resposta: os "últimos 7 dias" contam a partir dela, não do render.
interface Resposta { chave: string; itens: Row[] | null; erro: string; agora: number }

export default function IoInstagramPanel() {
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
    api.get('/io/solar/lista-interesse/admin', { params: { teste: mostrarTeste ? 1 : 0 } })
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

  const cw = resumo.contaWhats;

  return (
    <div className={styles.painel}>
      <div className={styles.topo}>
        <p className={styles.fonte}>
          Quem entrou pela lista{' '}
          <a href="https://solardoc.app/io/interesse" target="_blank" rel="noopener noreferrer">solardoc.app/io/interesse</a>
          , o link da bio do Instagram da Irmãos na Obra.
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
        <Numero rotulo="Na lista" valor={rows.length} sub={`${resumo.ultimos} nos últimos 7 dias`} />
        {PORTAS.map((p) => (
          <Numero
            key={p} rotulo={PORTA[p]} valor={resumo.porPorta[p]} ativo={f.porta === p}
            destaque={p === 'solar'} onClick={() => muda('porta', f.porta === p ? '' : p)}
          />
        ))}
      </div>

      <div className={styles.pilulas}>
        <div className={styles.grupoPil} role="group" aria-label="Situação do WhatsApp">
          <span className={styles.pilRot}>WhatsApp</span>
          {(['ok', 'sem', 'nv'] as Whats[]).map((w) => (
            <button
              key={w} type="button" aria-pressed={f.whats === w}
              className={`${styles.pil} ${styles[`whats_${w}`]} ${f.whats === w ? styles.pilOn : ''}`}
              onClick={() => muda('whats', f.whats === w ? '' : w)}
            >
              <b>{cw[w]}</b> {PILULA[w][cw[w] === 1 ? 0 : 1]}
            </button>
          ))}
        </div>
        <div className={styles.grupoPil} role="group" aria-label="Card na agenda">
          <span className={styles.pilRot}>Agenda</span>
          <button
            type="button" aria-pressed={f.agenda === 'com'} className={`${styles.pil} ${styles.pilCard} ${f.agenda === 'com' ? styles.pilOn : ''}`}
            onClick={() => muda('agenda', f.agenda === 'com' ? '' : 'com')}
          >
            <b>{resumo.comCard}</b> com card
          </button>
        </div>
      </div>

      <div className={styles.rankings}>
        <Rank titulo="Energia solar: conta de luz" itens={resumo.rankLuz} nomes={CONTA} forte
          vazio="Ninguém entrou pela porta solar ainda." onEscolher={(k) => muda('conta', k)} />
        <Rank titulo="Eletroposto: pessoas por caminho" itens={resumo.rankEp} nomes={CAMINHO}
          vazio="Ninguém entrou pela porta do eletroposto ainda." onEscolher={(k) => muda('caminho', k)} />
        <Rank titulo="Mobilidade elétrica: mais pedidos" itens={resumo.rankMob} nomes={MOB}
          vazio="Ninguém marcou um item de mobilidade ainda." onEscolher={(k) => muda('item', k)}
          extra={resumo.comOutro > 0 && (
            <button type="button" className={styles.linkOutro} onClick={() => muda('item', 'outro')}>
              {resumo.comOutro} {resumo.comOutro === 1 ? 'escreveu' : 'escreveram'} algo fora da lista
            </button>
          )} />
      </div>

      <div className={styles.filtros}>
        <label className={styles.busca}>
          <span className={styles.sr}>Buscar</span>
          <input
            type="search" value={f.busca} onChange={(e) => muda('busca', e.target.value)}
            placeholder="Buscar nome, contato, cidade, empresa…" autoComplete="off" spellCheck={false}
          />
        </label>
        <Escolha rotulo="Porta" valor={f.porta} onChange={(v) => muda('porta', v)} vazio="Toda porta"
          opcoes={PORTAS.map((p): [string, string] => [p, PORTA[p]])} />
        <Escolha rotulo="Conta de luz" valor={f.conta} onChange={(v) => muda('conta', v)} vazio="Toda conta" opcoes={Object.entries(CONTA)} />
        <Escolha rotulo="Caminho do eletroposto" valor={f.caminho} onChange={(v) => muda('caminho', v)} vazio="Todo caminho" opcoes={Object.entries(CAMINHO)} />
        <Escolha rotulo="Mobilidade" valor={f.item} onChange={(v) => muda('item', v)} vazio="Toda mobilidade"
          opcoes={[...Object.entries(MOB), ['outro', 'Escreveu outra coisa']]} />
        <Escolha rotulo="Agenda" valor={f.agenda} onChange={(v) => muda('agenda', v)} vazio="Com e sem card"
          opcoes={[['com', 'Com card na agenda'], ['sem', 'Solar ou eletroposto sem card']]} />
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
              <th scope="col">Porta e respostas</th>
              <th scope="col">Agenda</th>
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
              <IoInstagramLinha key={r.id} r={r} aberto={aberta === r.id} onAlternar={() => setAberta(aberta === r.id ? null : r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Rank({ titulo, itens, nomes, vazio, onEscolher, forte, extra }: {
  titulo: string; itens: Contagem[]; nomes: Record<string, string>; vazio: string;
  onEscolher: (k: string) => void; forte?: boolean; extra?: ReactNode;
}) {
  const max = Math.max(1, ...itens.map((x) => x.n));
  const algum = itens.some((x) => x.n > 0);
  return (
    <section className={`${styles.rank} ${forte ? styles.rankForte : ''}`} aria-label={titulo}>
      <h3>{titulo}</h3>
      {!algum ? <p className={styles.vazioRank}>{vazio}</p> : (
        <ol>
          {itens.map(({ k, n }) => (
            <li key={k}>
              <button type="button" onClick={() => onEscolher(k)} aria-label={`Filtrar ${nomes[k] ?? k}, ${n}`}>
                <span className={styles.rankNome}>{nomes[k] ?? k}</span>
                <span className={styles.barra}><span style={{ width: `${(n / max) * 100}%` }} /></span>
                <span className={styles.rankN}>{n}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {extra}
    </section>
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

function Numero({ rotulo, valor, sub, destaque, ativo, onClick }: {
  rotulo: string; valor: number; sub?: string; destaque?: boolean; ativo?: boolean; onClick?: () => void;
}) {
  const corpo = (
    <>
      <span className={styles.numRot}>{rotulo}</span>
      <span className={styles.numVal}>{valor.toLocaleString('pt-BR')}</span>
      {sub && <span className={styles.numSub}>{sub}</span>}
    </>
  );
  const cls = `${styles.numero} ${destaque ? styles.numeroForte : ''} ${ativo ? styles.numeroOn : ''}`;
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={!!ativo} title={`Filtrar: ${rotulo}`}>{corpo}</button>
    : <div className={cls}>{corpo}</div>;
}
