'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/services/auth';
import {
  plugcashApi, money, MOTIVO_LABEL,
  type Curso, type Aula, type Servico, type GatewayProduto, type Elegivel,
} from '@/services/plugcash';
import { Marca } from '../Marca';
import styles from '../pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Admin do PlugCash.
//
// Existe pra que preço, link de checkout, capacidade de entrega e publicação NÃO
// vivam no código. Mudar um preço não pode custar um deploy, e link de checkout
// hardcoded é o tipo de coisa que continua apontando pro produto errado meses
// depois de a oferta mudar.
//
// A aba "Gateway" é a menos óbvia e a mais crítica: é ela que diz ao webhook a
// que curso corresponde cada produto da Kiwify. Sem esse mapeamento a venda
// entra, o dinheiro cai, e o comprador não recebe nada.
// ─────────────────────────────────────────────────────────────────────────────

const MOTIVOS = ['sem_ponto', 'sem_capital', 'nao_decisor', 'fluxo_baixo'];
const ABAS = ['Cursos', 'Serviços', 'Gateway', 'Reagendar', 'Métricas'] as const;
type Aba = (typeof ABAS)[number];

export default function PlugcashAdmin() {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>('Cursos');
  const [negado, setNegado] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/plugcash/entrar?proximo=/plugcash/admin'); }
  }, [router]);

  return (
    <div className={styles.pc}>
      <div className={styles.wrap}>
        <header className={styles.topo}>
          <Marca />
          <span className={styles.nivel}>Admin</span>
        </header>

        {negado ? (
          <div className={styles.secao}>
            <div className={styles.aviso}>Acesso restrito a administradores.</div>
          </div>
        ) : (
          <>
            <div className={styles.topoAcoes} style={{ padding: '18px 0', flexWrap: 'wrap' }}>
              {ABAS.map((a) => (
                <button
                  key={a}
                  className={`${styles.btn} ${aba === a ? styles.btnPrimario : styles.btnFantasma}`}
                  style={{ padding: '9px 16px', fontSize: 14 }}
                  onClick={() => setAba(a)}
                >
                  {a}
                </button>
              ))}
            </div>

            {aba === 'Cursos'    && <AbaCursos onNegado={() => setNegado(true)} />}
            {aba === 'Serviços'  && <AbaServicos />}
            {aba === 'Gateway'   && <AbaGateway />}
            {aba === 'Reagendar' && <AbaReagendar />}
            {aba === 'Métricas'  && <AbaMetricas />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Cursos ──────────────────────────────────────────────────────────────────
function AbaCursos({ onNegado }: { onNegado: () => void }) {
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [pagina, setPagina] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { data } = await plugcashApi.adminCursos();
      setCursos(data.cursos);
    } catch (e: unknown) {
      const st = (e as { response?: { status?: number } }).response?.status;
      if (st === 403) onNegado();
      else setErro('Falha ao carregar os cursos.');
    }
  }, [onNegado]);

  useEffect(() => { carregar(); }, [carregar]);

  async function salvar(curso: Curso, patch: Partial<Curso>) {
    setSalvando(curso.id); setErro('');
    try {
      await plugcashApi.adminSalvarCurso({ id: curso.id, ...patch });
      await carregar();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setErro(msg === 'curso sem aula publicada nao pode ir ao ar'
        ? `"${curso.titulo}" não pode ser publicado: nenhuma aula publicada ainda. Curso no ar sem aula gravada gera reembolso.`
        : 'Não consegui salvar. Tente de novo.');
    }
    setSalvando(null);
  }

  return (
    <section className={styles.secao} style={{ paddingTop: 0 }}>
      <h1 className={styles.secaoTitulo}>Cursos</h1>
      <p className={styles.secaoSub}>
        Preço e link de checkout moram aqui, nunca no código. Curso em rascunho não
        aparece pra ninguém.
      </p>

      {erro && <div className={styles.aviso} style={{ marginBottom: 16 }}>{erro}</div>}

      <div className={styles.card} style={{ padding: 0, overflowX: 'auto' }}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Curso</th>
              <th style={{ width: 120 }}>Preço</th>
              <th style={{ minWidth: 220 }}>Link de checkout</th>
              <th style={{ width: 150 }}>Resolve</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 90 }}>Aulas</th>
              <th style={{ width: 90 }}>Venda</th>
            </tr>
          </thead>
          <tbody>
            {cursos.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.titulo}</strong>
                  <div style={{ fontSize: 12, color: '#6b6b6b' }}>/{c.slug}</div>
                </td>
                <td>
                  <CampoPreco valor={c.preco_centavos} travado={salvando === c.id}
                              onSalvar={(v) => salvar(c, { preco_centavos: v })} />
                </td>
                <td>
                  <CampoTexto valor={c.checkout_url || ''} placeholder="cole o link do gateway"
                              travado={salvando === c.id}
                              onSalvar={(v) => salvar(c, { checkout_url: v || null })} />
                </td>
                <td>
                  <select value={c.resolve_motivo?.[0] || ''} disabled={salvando === c.id}
                          onChange={(e) => salvar(c, { resolve_motivo: e.target.value ? [e.target.value] : [] })}>
                    <option value="">—</option>
                    {MOTIVOS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </td>
                <td>
                  <button
                    className={`${styles.selo} ${c.status === 'publicado' ? styles.seloPublicado : styles.seloRascunho}`}
                    style={{ border: 0, cursor: 'pointer' }}
                    disabled={salvando === c.id}
                    onClick={() => salvar(c, { status: c.status === 'publicado' ? 'rascunho' : 'publicado' })}
                  >
                    {c.status === 'publicado' ? 'publicado' : 'rascunho'}
                  </button>
                </td>
                <td>
                  <button className={`${styles.btn} ${styles.btnFantasma}`}
                          style={{ padding: '6px 12px', fontSize: 13 }}
                          onClick={() => setAberto(aberto === c.id ? null : c.id)}>
                    {c.aulas?.length || 0}
                  </button>
                </td>
                <td>
                  <button className={`${styles.btn} ${styles.btnFantasma}`}
                          style={{ padding: '6px 12px', fontSize: 13 }}
                          onClick={() => setPagina(pagina === c.id ? null : c.id)}>
                    Página
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {aberto && <Aulas curso={cursos.find((c) => c.id === aberto)!} aoMudar={carregar} />}
      {pagina && <PaginaDeVenda curso={cursos.find((c) => c.id === pagina)!} aoMudar={carregar} />}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor da página de venda.
//
// Existe por um motivo prático: sem ele, o link do order bump, a URL do vídeo de
// vendas e a thumbnail só dariam pra mudar por SQL — ou seja, o lançamento
// dependeria de alguém com acesso ao banco. Os quatro campos de cima são os que
// travam a publicação; o JSON embaixo abre o resto (dor, entregas, para quem,
// não é para, FAQ, garantia) sem precisar de uma tela por campo.
// ─────────────────────────────────────────────────────────────────────────────
function PaginaDeVenda({ curso, aoMudar }: { curso: Curso; aoMudar: () => void }) {
  const [json, setJson] = useState(() => JSON.stringify(curso.copy || {}, null, 2));
  const [erro, setErro] = useState('');
  const [salvo, setSalvo] = useState(false);

  // Trocou de curso? recarrega o editor. Comparado por id durante o render, não
  // por efeito: efeito aqui apagaria o que a pessoa acabou de digitar num
  // re-render qualquer da lista.
  const [ultimoId, setUltimoId] = useState(curso.id);
  if (curso.id !== ultimoId) {
    setUltimoId(curso.id);
    setJson(JSON.stringify(curso.copy || {}, null, 2));
    setSalvo(false);
  }

  // Campo do copy que tem input próprio. Editar aqui reescreve só a chave, o
  // resto do JSON fica intacto.
  async function campoCopy(chave: string, valor: string) {
    const novo = { ...(curso.copy || {}), [chave]: valor || undefined };
    if (!valor) delete (novo as Record<string, unknown>)[chave];
    await plugcashApi.adminSalvarCurso({ id: curso.id, copy: novo as Curso['copy'] }).catch(() => {});
    aoMudar();
  }

  async function salvarJson() {
    setErro(''); setSalvo(false);
    let parsed: unknown;
    try { parsed = JSON.parse(json); }
    catch { setErro('JSON inválido — confira vírgula e aspas. Nada foi salvo.'); return; }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setErro('O conteúdo tem que ser um objeto { }. Nada foi salvo.'); return;
    }
    try {
      await plugcashApi.adminSalvarCurso({ id: curso.id, copy: parsed as Curso['copy'] });
      setSalvo(true);
      aoMudar();
    } catch { setErro('Não consegui salvar. Tente de novo.'); }
  }

  return (
    <div className={styles.card} style={{ marginTop: 18 }}>
      <h2 className={styles.secaoTitulo} style={{ fontSize: 18 }}>Página de venda de {curso.titulo}</h2>
      <p className={styles.secaoSub}>
        É o que a pessoa vê quando clica no cadeado. Veja como ficou em{' '}
        <a href={`/plugcash/curso/${curso.slug}`} target="_blank" rel="noopener"
           style={{ color: '#009B40', fontWeight: 700 }}>/plugcash/curso/{curso.slug}</a>
        {curso.status !== 'publicado' && ' (só abre depois de publicar o curso)'}.
      </p>

      <div style={{ display: 'grid', gap: 14, marginBottom: 18 }}>
        <Campo rotulo="Subtítulo — a linha embaixo do título"
               valor={curso.subtitulo || ''}
               onSalvar={(v) => plugcashApi.adminSalvarCurso({ id: curso.id, subtitulo: v || null })
                                  .then(aoMudar).catch(() => {})} />
        <Campo rotulo="Thumbnail (URL da imagem do card)"
               valor={curso.thumb_url || ''}
               onSalvar={(v) => plugcashApi.adminSalvarCurso({ id: curso.id, thumb_url: v || null })
                                  .then(aoMudar).catch(() => {})} />
        <Campo rotulo="Vídeo de vendas (URL) — sem isto, o espaço fica vazio em vez de mostrar player quebrado"
               valor={curso.copy?.video_url || ''}
               onSalvar={(v) => campoCopy('video_url', v)} />
        {curso.slug === 'fundamentos' && (
          <>
            <Campo rotulo="Checkout COM o order bump (link da Kiwify com a planilha de R$ 47)"
                   valor={curso.copy?.checkout_bump_url || ''}
                   onSalvar={(v) => campoCopy('checkout_bump_url', v)} />
            <Campo rotulo="Texto do order bump — UMA linha ao lado do checkbox, nunca um parágrafo"
                   valor={curso.copy?.bump_texto || ''}
                   onSalvar={(v) => campoCopy('bump_texto', v)} />
          </>
        )}
      </div>

      <p className={styles.secaoSub} style={{ marginBottom: 6 }}>
        O resto da página (dor, entregas, para quem é, para quem não é, FAQ, garantia):
      </p>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
        style={{ width: '100%', minHeight: 320, fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
                 fontSize: 12.5, lineHeight: 1.55, padding: 12, borderRadius: 12,
                 border: '1px solid #D9D9D9', background: '#fff', color: '#0A0A0A' }}
      />
      {erro && <div className={styles.aviso} style={{ marginTop: 10 }}>{erro}</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
        <button className={`${styles.btn} ${styles.btnPrimario}`} onClick={salvarJson}>
          Salvar a página
        </button>
        <button className={`${styles.btn} ${styles.btnFantasma}`}
                onClick={() => { setJson(JSON.stringify(curso.copy || {}, null, 2)); setErro(''); setSalvo(false); }}>
          Desfazer
        </button>
        {salvo && <span style={{ color: '#009B40', fontWeight: 700, fontSize: 14 }}>Salvo.</span>}
      </div>
    </div>
  );
}

// Campo de texto que salva ao sair (mesma mecânica da tabela, com rótulo).
function Campo({ rotulo, valor, onSalvar }: {
  rotulo: string; valor: string; onSalvar: (v: string) => void;
}) {
  const [txt, setTxt] = useState(valor);
  const [ultimo, setUltimo] = useState(valor);
  if (valor !== ultimo) { setUltimo(valor); setTxt(valor); }
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 5 }}>{rotulo}</span>
      <input className={styles.campoInput} value={txt}
             onChange={(e) => setTxt(e.target.value)}
             onBlur={() => { if (txt.trim() !== valor) onSalvar(txt.trim()); }} />
    </label>
  );
}

// ── Serviços ────────────────────────────────────────────────────────────────
function AbaServicos() {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await plugcashApi.adminServicos();
    setServicos(data.servicos);
  }, []);
  useEffect(() => { carregar().catch(() => {}); }, [carregar]);

  async function salvar(s: Servico, patch: Partial<Servico>) {
    setSalvando(s.id);
    await plugcashApi.adminSalvarServico({ id: s.id, ...patch }).catch(() => {});
    await carregar().catch(() => {});
    setSalvando(null);
  }

  return (
    <section className={styles.secao} style={{ paddingTop: 0 }}>
      <h1 className={styles.secaoTitulo}>Serviços da esteira</h1>
      <p className={styles.secaoSub}>
        A capacidade mensal é o número de entregas que a engenharia aguenta sem atrasar
        quem já contratou. Atingido o teto, o item vira lista de espera sozinho.
      </p>

      <div className={styles.card} style={{ padding: 0, overflowX: 'auto' }}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th style={{ minWidth: 210 }}>Serviço</th>
              <th style={{ width: 120 }}>Preço</th>
              <th style={{ minWidth: 200 }}>Link de checkout</th>
              <th style={{ width: 130 }}>Capacidade/mês</th>
              <th style={{ width: 100 }}>Usado</th>
              <th style={{ width: 110 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {servicos.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.titulo}</strong>
                  <div style={{ fontSize: 12, color: '#6b6b6b' }}>/{s.slug}</div>
                </td>
                <td>
                  <CampoPreco valor={s.preco_centavos} travado={salvando === s.id}
                              onSalvar={(v) => salvar(s, { preco_centavos: v })} />
                </td>
                <td>
                  <CampoTexto valor={s.checkout_url || ''} placeholder="link do gateway"
                              travado={salvando === s.id}
                              onSalvar={(v) => salvar(s, { checkout_url: v || null })} />
                </td>
                <td>
                  <CampoNumero valor={s.capacidade_mensal} travado={salvando === s.id}
                               onSalvar={(v) => salvar(s, { capacidade_mensal: v })} />
                </td>
                <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {s.capacidade_usada ?? 0}
                  {s.capacidade_mensal ? ` / ${s.capacidade_mensal}` : ''}
                </td>
                <td>
                  <button
                    className={`${styles.selo} ${s.status === 'publicado' ? styles.seloPublicado : styles.seloRascunho}`}
                    style={{ border: 0, cursor: 'pointer' }}
                    disabled={salvando === s.id}
                    onClick={() => salvar(s, { status: s.status === 'publicado' ? 'rascunho' : 'publicado' })}
                  >
                    {s.status === 'publicado' ? 'publicado' : 'rascunho'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {servicos.length === 0 && (
        <div className={styles.vazio} style={{ marginTop: 16 }}>Nenhum serviço cadastrado.</div>
      )}
    </section>
  );
}

// ── Gateway ─────────────────────────────────────────────────────────────────
function AbaGateway() {
  const [produtos, setProdutos] = useState<GatewayProduto[]>([]);
  const [novo, setNovo] = useState({ produto_nome: '', produto_id: '', item_tipo: 'curso', item_slug: '', concede_nivel: '' });

  const carregar = useCallback(async () => {
    const { data } = await plugcashApi.adminGateway();
    setProdutos(data.produtos);
  }, []);
  useEffect(() => { carregar().catch(() => {}); }, [carregar]);

  async function adicionar() {
    if (!novo.item_slug.trim() || (!novo.produto_nome.trim() && !novo.produto_id.trim())) return;
    await plugcashApi.adminSalvarGateway({
      gateway: 'kiwify',
      produto_nome: novo.produto_nome.trim() || null,
      produto_id: novo.produto_id.trim() || null,
      item_tipo: novo.item_tipo,
      item_slug: novo.item_slug.trim(),
      concede_nivel: novo.concede_nivel || null,
    }).catch(() => {});
    setNovo({ produto_nome: '', produto_id: '', item_tipo: 'curso', item_slug: '', concede_nivel: '' });
    carregar().catch(() => {});
  }

  return (
    <section className={styles.secao} style={{ paddingTop: 0 }}>
      <h1 className={styles.secaoTitulo}>Produtos do gateway</h1>
      <p className={styles.secaoSub}>
        De que curso é cada produto da Kiwify. Sem este mapeamento a venda entra, o
        dinheiro cai e o comprador não recebe nada — o webhook não sabe o que liberar.
      </p>

      <div className={styles.aviso} style={{ marginBottom: 16 }}>
        O <strong>ID do produto</strong> é mais seguro que o nome: renomear o produto na
        Kiwify não quebra o mapeamento. Cadastre o nome só quando não tiver o ID à mão.
      </div>

      <div className={styles.card} style={{ padding: 0, overflowX: 'auto' }}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Produto na Kiwify</th><th style={{ width: 170 }}>ID</th>
              <th style={{ width: 110 }}>Tipo</th><th style={{ width: 150 }}>Item</th>
              <th style={{ width: 120 }}>Concede nível</th><th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {produtos.map((p) => (
              <tr key={p.id}>
                <td>{p.produto_nome || '—'}</td>
                <td style={{ fontSize: 12, color: '#6b6b6b' }}>{p.produto_id || '—'}</td>
                <td>{p.item_tipo}</td>
                <td>{p.item_slug}</td>
                <td>{p.concede_nivel || '—'}</td>
                <td>
                  <button className={`${styles.btn} ${styles.btnFantasma}`}
                          style={{ padding: '5px 10px', fontSize: 13 }}
                          onClick={async () => { await plugcashApi.adminRemoverGateway(p.id); carregar().catch(() => {}); }}>
                    Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr 1.2fr 1fr auto', gap: 10, marginTop: 14 }}>
        <input className={styles.campoInput} placeholder="Nome exato na Kiwify"
               value={novo.produto_nome} onChange={(e) => setNovo({ ...novo, produto_nome: e.target.value })} />
        <input className={styles.campoInput} placeholder="ID do produto"
               value={novo.produto_id} onChange={(e) => setNovo({ ...novo, produto_id: e.target.value })} />
        <select className={styles.campoInput} value={novo.item_tipo}
                onChange={(e) => setNovo({ ...novo, item_tipo: e.target.value })}>
          <option value="curso">curso</option>
          <option value="servico">serviço</option>
          <option value="bump">bump</option>
          <option value="nivel">nível</option>
        </select>
        <input className={styles.campoInput} placeholder="slug do item"
               value={novo.item_slug} onChange={(e) => setNovo({ ...novo, item_slug: e.target.value })} />
        <select className={styles.campoInput} value={novo.concede_nivel}
                onChange={(e) => setNovo({ ...novo, concede_nivel: e.target.value })}>
          <option value="">sem nível</option>
          <option value="integrador">integrador</option>
          <option value="investidor">investidor</option>
          <option value="projeto">projeto</option>
        </select>
        <button className={`${styles.btn} ${styles.btnPrimario}`} onClick={adicionar}>Adicionar</button>
      </div>
    </section>
  );
}

// ── Reagendar ───────────────────────────────────────────────────────────────
function AbaReagendar() {
  const [elegiveis, setElegiveis] = useState<Elegivel[]>([]);
  useEffect(() => {
    plugcashApi.adminReagendar().then(({ data }) => setElegiveis(data.elegiveis)).catch(() => {});
  }, []);

  return (
    <section className={styles.secao} style={{ paddingTop: 0 }}>
      <h1 className={styles.secaoTitulo}>Prontos para voltar à agenda</h1>
      <p className={styles.secaoSub}>
        Quem declarou que resolveu o que travava o projeto. É o ciclo que transforma
        lead de R$ 197 em cliente de R$ 160 mil — cada linha aqui é uma reunião que
        vale a pena abrir.
      </p>

      {elegiveis.length === 0 ? (
        <div className={styles.vazio}>Ninguém sinalizou ainda.</div>
      ) : (
        <div className={styles.card} style={{ padding: 0, overflowX: 'auto' }}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Pessoa</th><th style={{ width: 150 }}>Cidade</th>
                <th>Travava</th><th>Resolveu</th>
                <th style={{ width: 110 }}>Quando</th><th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {elegiveis.map((e) => (
                <tr key={e.user_id}>
                  <td>
                    <strong>{e.usuario?.nome || e.usuario?.email || '—'}</strong>
                    <div style={{ fontSize: 12, color: '#6b6b6b' }}>{e.usuario?.email}</div>
                  </td>
                  <td>{e.cidade || '—'}</td>
                  <td style={{ fontSize: 13 }}>
                    {(e.motivo_descarte || []).map((m) => MOTIVO_LABEL[m] || m).join('; ') || '—'}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    {(e.resolveu_o_que || []).map((m) => MOTIVO_LABEL[m] || m).join('; ') || '—'}
                  </td>
                  <td>{new Date(e.resolveu_em).toLocaleDateString('pt-BR')}</td>
                  <td>
                    {(e.telefone || e.usuario?.whatsapp) && (
                      <a className={`${styles.btn} ${styles.btnPrimario}`}
                         style={{ padding: '6px 12px', fontSize: 13 }}
                         href={`https://wa.me/55${(e.telefone || e.usuario?.whatsapp || '').replace(/\D/g, '').slice(-11)}`}>
                        WhatsApp
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Métricas ────────────────────────────────────────────────────────────────
type Metricas = {
  membros: number;
  por_nivel: Record<string, number>;
  por_motivo: Record<string, number>;
  por_curso: Record<string, { vendas: number; receita: number }>;
  elegiveis_reagendar: number;
};

function AbaMetricas() {
  const [m, setM] = useState<Metricas | null>(null);
  useEffect(() => {
    plugcashApi.adminMetricas().then(({ data }) => setM(data as Metricas)).catch(() => {});
  }, []);

  if (!m) return <section className={styles.secao} />;

  const receita = Object.values(m.por_curso).reduce((s, c) => s + c.receita, 0);

  return (
    <section className={styles.secao} style={{ paddingTop: 0 }}>
      <h1 className={styles.secaoTitulo}>Métricas</h1>
      <p className={styles.secaoSub}>Só o que já é medível. Métrica sem dado aparece como “—”, nunca como zero.</p>

      <div className={styles.grade} style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
        <Tile rotulo="Membros" valor={String(m.membros)} />
        <Tile rotulo="Receita aprovada" valor={receita ? money(receita) : '—'} />
        <Tile rotulo="Prontos p/ reagendar" valor={String(m.elegiveis_reagendar)} />
        <Tile rotulo="Integradores" valor={String(m.por_nivel.integrador || 0)} />
      </div>

      <h2 className={styles.secaoTitulo} style={{ fontSize: 18, marginTop: 32 }}>Vendas por item</h2>
      {Object.keys(m.por_curso).length === 0 ? (
        <div className={styles.vazio}>Nenhuma venda aprovada ainda.</div>
      ) : (
        <div className={styles.card} style={{ padding: 0, overflowX: 'auto' }}>
          <table className={styles.tabela}>
            <thead><tr><th>Item</th><th>Vendas</th><th>Receita</th></tr></thead>
            <tbody>
              {Object.entries(m.por_curso).map(([slug, v]) => (
                <tr key={slug}>
                  <td>{slug}</td><td>{v.vendas}</td><td>{money(v.receita)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className={styles.secaoTitulo} style={{ fontSize: 18, marginTop: 32 }}>
        O que travou os membros
      </h2>
      <p className={styles.secaoSub}>
        É esta distribuição que diz qual curso e qual serviço priorizar.
      </p>
      {Object.keys(m.por_motivo).length === 0 ? (
        <div className={styles.vazio}>Nenhum membro com qualificação da régua ainda.</div>
      ) : (
        <div className={styles.card} style={{ padding: 0, overflowX: 'auto' }}>
          <table className={styles.tabela}>
            <thead><tr><th>Bloqueio</th><th>Membros</th></tr></thead>
            <tbody>
              {Object.entries(m.por_motivo)
                .sort((a, b) => b[1] - a[1])
                .map(([mo, n]) => (
                  <tr key={mo}><td>{MOTIVO_LABEL[mo] || mo}</td><td>{n}</td></tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Tile({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className={styles.card}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: '#6b6b6b' }}>{rotulo}</p>
      <p style={{ margin: '8px 0 0', fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{valor}</p>
    </div>
  );
}

// ── Campos ──────────────────────────────────────────────────────────────────
// Preço em reais na tela, centavos no banco. A conversão acontece só aqui: em
// nenhum outro ponto do app um número de preço é calculado.
function CampoPreco({ valor, onSalvar, travado }: {
  valor: number; onSalvar: (centavos: number) => void; travado: boolean;
}) {
  const [txt, setTxt] = useState((valor / 100).toFixed(2));
  // Ajuste de estado durante o render — o padrão que o React documenta para
  // "prop mudou, sincroniza o campo". Dentro de um efeito isso custa uma
  // renderização extra a cada salvamento e é o que o lint reclama.
  const [ultimo, setUltimo] = useState(valor);
  if (valor !== ultimo) { setUltimo(valor); setTxt((valor / 100).toFixed(2)); }
  return (
    <input value={txt} disabled={travado}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        const n = Math.round(parseFloat(txt.replace(',', '.')) * 100);
        if (Number.isFinite(n) && n !== valor) onSalvar(n);
        else setTxt((valor / 100).toFixed(2));
      }} />
  );
}

function CampoNumero({ valor, onSalvar, travado }: {
  valor: number | null; onSalvar: (v: number | null) => void; travado: boolean;
}) {
  const [txt, setTxt] = useState(valor == null ? '' : String(valor));
  const [ultimo, setUltimo] = useState(valor);
  if (valor !== ultimo) { setUltimo(valor); setTxt(valor == null ? '' : String(valor)); }
  return (
    <input value={txt} disabled={travado} placeholder="sem teto"
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        const t = txt.trim();
        const n = t === '' ? null : Math.max(0, Math.round(Number(t)));
        if (n !== valor && (n === null || Number.isFinite(n))) onSalvar(n);
        else setTxt(valor == null ? '' : String(valor));
      }} />
  );
}

function CampoTexto({ valor, placeholder, onSalvar, travado }: {
  valor: string; placeholder?: string; onSalvar: (v: string) => void; travado: boolean;
}) {
  const [txt, setTxt] = useState(valor);
  const [ultimo, setUltimo] = useState(valor);
  if (valor !== ultimo) { setUltimo(valor); setTxt(valor); }
  return (
    <input value={txt} placeholder={placeholder} disabled={travado}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { if (txt !== valor) onSalvar(txt.trim()); }} />
  );
}

function Aulas({ curso, aoMudar }: { curso: Curso; aoMudar: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [minutos, setMinutos] = useState('');
  const [video, setVideo] = useState('');

  async function adicionar() {
    if (titulo.trim().length < 3) return;
    await plugcashApi.adminSalvarAula({
      curso_id: curso.id,
      titulo: titulo.trim(),
      ordem: (curso.aulas?.length || 0) + 1,
      duracao_seg: minutos ? Math.round(parseFloat(minutos) * 60) : null,
      video_url: video.trim() || null,
      // Nasce em rascunho: a aula só conta pra publicar o curso depois que o
      // vídeo estiver de fato no ar.
      status: 'rascunho',
    } as Partial<Aula>);
    setTitulo(''); setMinutos(''); setVideo('');
    aoMudar();
  }

  return (
    <div className={styles.card} style={{ marginTop: 18 }}>
      <h2 className={styles.secaoTitulo} style={{ fontSize: 18 }}>Aulas de {curso.titulo}</h2>
      <p className={styles.secaoSub}>
        Título e duração são públicos (aparecem no card travado e na página de venda).
        O vídeo só sai pra quem tem acesso.
      </p>

      <table className={styles.tabela}>
        <tbody>
          {(curso.aulas || []).map((a) => (
            <tr key={a.id}>
              <td style={{ width: 40, color: '#6b6b6b' }}>{a.ordem}</td>
              <td>{a.titulo}</td>
              <td style={{ width: 90 }}>{a.duracao_seg ? `${Math.round(a.duracao_seg / 60)} min` : '—'}</td>
              <td style={{ width: 120 }}>
                <button
                  className={`${styles.selo} ${a.status === 'publicado' ? styles.seloPublicado : styles.seloRascunho}`}
                  style={{ border: 0, cursor: 'pointer' }}
                  title={a.video_url ? '' : 'sem vídeo cadastrado'}
                  onClick={async () => {
                    await plugcashApi.adminSalvarAula({
                      id: a.id, status: a.status === 'publicado' ? 'rascunho' : 'publicado',
                    });
                    aoMudar();
                  }}
                >
                  {a.status === 'publicado' ? 'publicada' : 'rascunho'}
                </button>
              </td>
              <td style={{ width: 60 }}>
                <button className={`${styles.btn} ${styles.btnFantasma}`}
                        style={{ padding: '5px 10px', fontSize: 13 }}
                        onClick={async () => { await plugcashApi.adminRemoverAula(a.id); aoMudar(); }}>
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 90px 2fr auto', gap: 10, marginTop: 14 }}>
        <input className={styles.campoInput} placeholder="Título da aula"
               value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <input className={styles.campoInput} placeholder="min"
               value={minutos} onChange={(e) => setMinutos(e.target.value)} />
        <input className={styles.campoInput} placeholder="URL do vídeo"
               value={video} onChange={(e) => setVideo(e.target.value)} />
        <button className={`${styles.btn} ${styles.btnPrimario}`} onClick={adicionar}>Adicionar</button>
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
