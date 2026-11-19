'use client';

// ─────────────────────────────────────────────────────────────────────────────
// NEXUS INSTAGRAM (19/11/2026): quem entrou na lista solardoc.app/nexus/interesse,
// o link da bio do Instagram da NEXUS. Lista permanente: a pessoa marca frentes do
// Eletroposto NEXUS e itens de mobilidade elétrica, diz para quê, quanto pretende
// investir, como pretende pagar e deixa os dados. O backend só soma (nunca apaga).
// Lê GET /io/eletroposto/nexus-instagram/admin?teste=0|1 (authMiddleware + admin).
// Os rótulos abaixo são os mesmos da página: slug muda só junto com o backend.
// ─────────────────────────────────────────────────────────────────────────────
import { Fragment, useEffect, useMemo, useState } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from './NexusInstagramPanel.module.css';

interface Row {
  id: string;
  criado_em: string;
  atualizado_em: string | null;
  nome: string;
  telefone: string;
  email: string | null;
  cep: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  eletroposto: string[] | null;
  mobilidade: string[] | null;
  outro: string | null;
  objetivo: string | null;
  investimento: string | null;
  recurso: string | null;
  origem: string | null;
  utm: Record<string, string> | null;
  teste: boolean;
}

const FRENTE: Record<string, string> = {
  cotista: 'Cotista', investidor: 'Investidor', arrendamento: 'Arrendamento',
  chave_na_mao: 'Chave na mão', parceiro: 'Parceiro instalador', so_carregador: 'Só o carregador',
};
const MOB: Record<string, string> = {
  carro_compacto: 'Carro compacto', carro_suv: 'SUV', carro_sedan: 'Sedã', picape: 'Picape',
  van: 'Van e utilitário', caminhao: 'Caminhão leve', moto: 'Moto', scooter: 'Scooter',
  bike: 'Bike elétrica', patinete: 'Patinete', triciclo: 'Triciclo e cargo', quadriciclo: 'Quadriciclo e UTV',
  golfe: 'Carrinho de golfe', wallbox: 'Carregador para casa', carregador_rapido: 'Carregador rápido',
  bateria: 'Baterias', solar: 'Energia solar',
};
const OBJ: Record<string, string> = {
  proprio: 'Para uso próprio', frota: 'Empresa ou frota', revenda: 'Revenda', investir: 'Investir',
};
const INV: Record<string, string> = {
  ate_10: 'Até R$ 10 mil', '10_50': 'R$ 10 a 50 mil', '50_100': 'R$ 50 a 100 mil', '100_250': 'R$ 100 a 250 mil',
  '250_500': 'R$ 250 a 500 mil', '500_mais': 'Acima de R$ 500 mil', naosei: 'Não sabe',
};
const REC: Record<string, string> = {
  proprio: 'Recurso próprio', financiamento: 'Financiamento', os_dois: 'Os dois', naosei: 'Não sabe',
};
const ACIMA_100 = new Set(['100_250', '250_500', '500_mais']);
const UTM_CHAVES = ['source', 'medium', 'campaign', 'content', 'term'] as const;

const rot = (mapa: Record<string, string>, k: string | null | undefined) => (k ? mapa[k] ?? k : '');
const lista = (v: string[] | null | undefined) => (Array.isArray(v) ? v : []);

function fmtData(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}
function fmtTel(t: string): string {
  const d = (t || '').replace(/\D/g, '');
  const n = d.startsWith('55') ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return t;
}
function fmtCep(c: string | null): string {
  const d = (c || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
function waLink(phone: string): string {
  return `https://wa.me/${(phone || '').replace(/\D/g, '')}`;
}
function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// CSV para o Excel brasileiro: ; como separador, BOM para o UTF-8 abrir certo.
// Célula que começa com = + - @ ganha ' na frente (não vira fórmula no Excel).
function celula(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function baixarCsv(rows: Row[]) {
  const cab = ['Data', 'Nome', 'WhatsApp', 'E-mail', 'CEP', 'Endereço', 'Bairro', 'Cidade', 'UF',
    'Eletroposto', 'Mobilidade', 'Outro', 'Objetivo', 'Faixa', 'Recurso', 'Origem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'Atualizado em', 'Teste'];
  const linhas = rows.map((r) => [
    fmtData(r.criado_em), r.nome, r.telefone, r.email, fmtCep(r.cep), r.endereco, r.bairro, r.cidade, r.uf,
    lista(r.eletroposto).map((k) => rot(FRENTE, k)).join(', '),
    lista(r.mobilidade).map((k) => rot(MOB, k)).join(', '),
    r.outro, rot(OBJ, r.objetivo), rot(INV, r.investimento), rot(REC, r.recurso), r.origem,
    ...UTM_CHAVES.map((k) => r.utm?.[k] ?? ''),
    fmtData(r.atualizado_em), r.teste ? 'sim' : '',
  ].map(celula).join(';'));
  const csv = '\uFEFF' + [cab.join(';'), ...linhas].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `nexus-instagram-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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

  const resumo = useMemo(() => {
    const seteDias = agora - 7 * 86400e3;
    const contaEp: Record<string, number> = {};
    const contaMob: Record<string, number> = {};
    let ultimos = 0, comEp = 0, revenda = 0, acima = 0, comOutro = 0;
    for (const r of rows) {
      if (new Date(r.criado_em).getTime() >= seteDias) ultimos++;
      const ep = lista(r.eletroposto);
      if (ep.length) comEp++;
      if (r.objetivo === 'revenda') revenda++;
      if (r.investimento && ACIMA_100.has(r.investimento)) acima++;
      if (r.outro && r.outro.trim()) comOutro++;
      ep.forEach((k) => { contaEp[k] = (contaEp[k] ?? 0) + 1; });
      lista(r.mobilidade).forEach((k) => { contaMob[k] = (contaMob[k] ?? 0) + 1; });
    }
    const rankEp = Object.keys(FRENTE).map((k) => ({ k, n: contaEp[k] ?? 0 })).sort((a, b) => b.n - a.n);
    const rankMob = Object.entries(contaMob).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 8);
    return { ultimos, comEp, revenda, acima, comOutro, rankEp, rankMob };
  }, [rows, agora]);

  const visiveis = useMemo(() => {
    const q = semAcento(busca.trim());
    return rows.filter((r) => {
      if (q) {
        const alvo = semAcento([r.nome, r.telefone, fmtTel(r.telefone), r.email, r.cidade, r.uf, r.outro].filter(Boolean).join(' '));
        if (!alvo.includes(q)) return false;
      }
      if (interesse) {
        const [tipo, k] = interesse.split(':');
        if (tipo === 'ep' && k === '*' && !lista(r.eletroposto).length) return false;
        if (tipo === 'ep' && k !== '*' && !lista(r.eletroposto).includes(k)) return false;
        if (tipo === 'mob' && !lista(r.mobilidade).includes(k)) return false;
        if (tipo === 'outro' && !(r.outro && r.outro.trim())) return false;
      }
      if (objetivo && r.objetivo !== objetivo) return false;
      if (faixa === 'acima_100' ? !(r.investimento && ACIMA_100.has(r.investimento)) : faixa && r.investimento !== faixa) return false;
      if (recurso && r.recurso !== recurso) return false;
      return true;
    });
  }, [rows, busca, interesse, objetivo, faixa, recurso]);

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
            ) : visiveis.map((r) => {
              const aberto = aberta === r.id;
              const ep = lista(r.eletroposto);
              const mob = lista(r.mobilidade);
              return (
                <Fragment key={r.id}>
                  <tr className={aberto ? styles.linhaAberta : undefined}>
                    <td className={styles.colAbrir}>
                      <button
                        type="button" className={styles.abrir} aria-expanded={aberto} aria-controls={`det-${r.id}`}
                        aria-label={`${aberto ? 'Fechar' : 'Abrir'} detalhes de ${r.nome}`}
                        onClick={() => setAberta(aberto ? null : r.id)}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
                      </button>
                    </td>
                    <td className={styles.data}>
                      {fmtData(r.criado_em)}
                      {r.teste && <span className={styles.tagTeste}>Teste</span>}
                    </td>
                    <td className={styles.nome}>
                      <strong>{r.nome}</strong>
                      <span className={styles.sob}>{[r.cidade, r.uf].filter(Boolean).join('-')}</span>
                    </td>
                    <td className={styles.contato}>
                      <a className={styles.wa} href={waLink(r.telefone)} target="_blank" rel="noopener noreferrer" title="Abrir a conversa no WhatsApp">
                        {fmtTel(r.telefone)}
                      </a>
                      {r.email
                        ? <a className={styles.email} href={`mailto:${r.email}`} title={r.email}>{r.email}</a>
                        : <span className={`${styles.sob} ${styles.mudo}`}>Sem e-mail</span>}
                    </td>
                    <td>
                      <div className={styles.chips}>
                        {ep.map((k) => <span key={`e-${k}`} className={styles.chipEp}>{rot(FRENTE, k)}</span>)}
                        {mob.map((k) => <span key={`m-${k}`} className={styles.chip}>{rot(MOB, k)}</span>)}
                      </div>
                      {r.outro && <p className={styles.outro} title={r.outro}>Escreveu: “{r.outro}”</p>}
                    </td>
                    <td className={styles.perfil}>
                      <strong>{rot(OBJ, r.objetivo)}</strong>
                      <span className={styles.faixa}>{rot(INV, r.investimento)}</span>
                      <span className={styles.sob}>{rot(REC, r.recurso)}</span>
                    </td>
                  </tr>
                  {aberto && (
                    <tr className={styles.detalhe} id={`det-${r.id}`}>
                      <td colSpan={6}>
                        <dl className={styles.grade}>
                          <div><dt>Endereço</dt><dd>{r.endereco || 'Não informado'}</dd></div>
                          <div><dt>Bairro</dt><dd>{r.bairro || 'Não informado'}</dd></div>
                          <div><dt>CEP</dt><dd>{fmtCep(r.cep) || 'Não informado'}</dd></div>
                          <div><dt>Cidade</dt><dd>{[r.cidade, r.uf].filter(Boolean).join('-') || 'Não informado'}</dd></div>
                          <div><dt>Origem</dt><dd>{r.origem || 'Não informado'}</dd></div>
                          <div><dt>Atualizado em</dt><dd>{fmtData(r.atualizado_em) || fmtData(r.criado_em)}</dd></div>
                          {UTM_CHAVES.map((k) => (
                            <div key={k}><dt>utm_{k}</dt><dd>{r.utm?.[k] || '-'}</dd></div>
                          ))}
                          {r.outro && <div className={styles.largo}><dt>O que escreveu</dt><dd>{r.outro}</dd></div>}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
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
