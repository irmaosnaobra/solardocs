'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/services/auth';
import { plugcashApi, type Curso, type Aula } from '@/services/plugcash';
import { Marca } from '../Marca';
import styles from '../pc.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Admin do PlugCash.
//
// É aqui que preço, link de checkout, ordem e publicação são definidos. Existe
// justamente pra que nenhuma dessas coisas viva no código: mudar um preço não
// pode custar um deploy, e um link de checkout hardcoded é o tipo de coisa que
// continua apontando pro produto errado meses depois.
//
// A regra de publicação é do servidor, não daqui: curso sem aula publicada é
// recusado pela API. O front só explica por que o botão falhou.
// ─────────────────────────────────────────────────────────────────────────────

const MOTIVOS = ['sem_ponto', 'sem_capital', 'nao_decisor', 'fluxo_baixo'];

export default function PlugcashAdmin() {
  const router = useRouter();
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const { data } = await plugcashApi.adminCursos();
      setCursos(data.cursos);
    } catch (e: unknown) {
      const st = (e as { response?: { status?: number } }).response?.status;
      setErro(st === 403 ? 'Acesso restrito a administradores.' : 'Falha ao carregar os cursos.');
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/plugcash/entrar?proximo=/plugcash/admin'); return; }
    carregar();
  }, [router, carregar]);

  async function salvar(curso: Curso, patch: Partial<Curso>) {
    setSalvando(curso.id);
    setErro('');
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

  if (erro && !cursos.length) {
    return (
      <div className={styles.pc}><div className={styles.wrap}>
        <header className={styles.topo}><Marca /></header>
        <div className={styles.secao}><div className={styles.aviso}>{erro}</div></div>
      </div></div>
    );
  }

  return (
    <div className={styles.pc}>
      <div className={styles.wrap}>
        <header className={styles.topo}>
          <Marca />
          <span className={styles.nivel}>Admin</span>
        </header>

        <section className={styles.secao}>
          <h1 className={styles.secaoTitulo}>Cursos</h1>
          <p className={styles.secaoSub}>
            Preço e link de checkout moram aqui — nunca no código. Curso em rascunho não
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
                      <CampoPreco
                        valor={c.preco_centavos}
                        onSalvar={(v) => salvar(c, { preco_centavos: v })}
                        travado={salvando === c.id}
                      />
                    </td>
                    <td>
                      <CampoTexto
                        valor={c.checkout_url || ''}
                        placeholder="cole o link do gateway"
                        onSalvar={(v) => salvar(c, { checkout_url: v || null })}
                        travado={salvando === c.id}
                      />
                    </td>
                    <td>
                      <select
                        value={c.resolve_motivo?.[0] || ''}
                        disabled={salvando === c.id}
                        onChange={(e) => salvar(c, { resolve_motivo: e.target.value ? [e.target.value] : [] })}
                      >
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
                      <button
                        className={`${styles.btn} ${styles.btnFantasma}`}
                        style={{ padding: '6px 12px', fontSize: 13 }}
                        onClick={() => setAberto(aberto === c.id ? null : c.id)}
                      >
                        {c.aulas?.length || 0}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {aberto && (
            <Aulas
              curso={cursos.find((c) => c.id === aberto)!}
              aoMudar={carregar}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// Preço em reais na tela, centavos no banco. A conversão acontece só aqui: em
// nenhum outro ponto do app um número de preço é calculado.
function CampoPreco({ valor, onSalvar, travado }: {
  valor: number; onSalvar: (centavos: number) => void; travado: boolean;
}) {
  const [txt, setTxt] = useState((valor / 100).toFixed(2));
  useEffect(() => { setTxt((valor / 100).toFixed(2)); }, [valor]);
  return (
    <input
      value={txt}
      disabled={travado}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        const n = Math.round(parseFloat(txt.replace(',', '.')) * 100);
        if (Number.isFinite(n) && n !== valor) onSalvar(n);
        else setTxt((valor / 100).toFixed(2));
      }}
    />
  );
}

function CampoTexto({ valor, placeholder, onSalvar, travado }: {
  valor: string; placeholder?: string; onSalvar: (v: string) => void; travado: boolean;
}) {
  const [txt, setTxt] = useState(valor);
  useEffect(() => { setTxt(valor); }, [valor]);
  return (
    <input
      value={txt}
      placeholder={placeholder}
      disabled={travado}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { if (txt !== valor) onSalvar(txt.trim()); }}
    />
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
        Título e duração são públicos (aparecem no card travado). O vídeo só sai pra quem tem acesso.
      </p>

      <table className={styles.tabela}>
        <tbody>
          {(curso.aulas || []).map((a) => (
            <tr key={a.id}>
              <td style={{ width: 40, color: '#6b6b6b' }}>{a.ordem}</td>
              <td>{a.titulo}</td>
              <td style={{ width: 90 }}>{a.duracao_seg ? `${Math.round(a.duracao_seg / 60)} min` : '—'}</td>
              <td style={{ width: 110 }}>
                <button
                  className={`${styles.selo} ${a.status === 'publicado' ? styles.seloPublicado : styles.seloRascunho}`}
                  style={{ border: 0, cursor: 'pointer' }}
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
                <button
                  className={`${styles.btn} ${styles.btnFantasma}`}
                  style={{ padding: '5px 10px', fontSize: 13 }}
                  onClick={async () => { await plugcashApi.adminRemoverAula(a.id); aoMudar(); }}
                >
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
