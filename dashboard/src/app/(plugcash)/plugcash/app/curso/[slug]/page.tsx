'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { isAuthenticated } from '@/services/auth';
import { plugcashApi, duracao, type Curso, type Aula } from '@/services/plugcash';
import { Marca, Check } from '../../../Marca';
import styles from '../../../pc.module.css';

function Pendente() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B"
         strokeWidth="2.2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

// Player do curso. A grade fica sempre visível; a aula só carrega o vídeo depois
// que a API confirma o acesso (é ela quem guarda `video_url` — nenhuma URL de
// vídeo trafega no catálogo).
export default function Player() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [curso, setCurso] = useState<Curso | null>(null);
  const [aula, setAula] = useState<Aula | null>(null);
  const [semAcesso, setSemAcesso] = useState(false);
  // Última faixa de 10% já reportada. `timeupdate` dispara ~4×/s: sem esta trava
  // o player mandaria um POST por disparo durante o segundo inteiro em que a
  // porcentagem fica parada em 30, 40, 50…
  const faixaEnviada = useRef(-1);

  // `video_url` só existe na resposta desta chamada — o catálogo nunca carrega
  // URL de vídeo. Erro aqui é acesso negado, não falha de rede.
  const abrir = useCallback(async (id: string) => {
    setSemAcesso(false);
    try {
      const { data } = await plugcashApi.aula(id);
      setAula(data.aula);
    } catch {
      setSemAcesso(true);
      setAula(null);
    }
  }, []);

  const carregar = useCallback(async () => {
    const { data } = await plugcashApi.me();
    const c = data.catalogo.find((x) => x.slug === slug) || null;
    setCurso(c);
    // Curso travado não tem player: manda pra página de venda dele.
    if (c && !c.liberado) { router.replace(`/plugcash/curso/${slug}`); return; }
    const primeira = c?.aulas.find((a) => !a.progresso?.concluida) || c?.aulas[0];
    if (primeira) abrir(primeira.id);
  }, [slug, router, abrir]);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace(`/plugcash/entrar?proximo=/plugcash/app/curso/${slug}`); return; }
    carregar();
  }, [router, slug, carregar]);

  if (!curso) return <div className={styles.pc} />;

  return (
    <div className={styles.pc}>
      <div className={styles.wrap}>
        <header className={styles.topo}>
          <Marca />
          <Link href="/plugcash/app" className={`${styles.btn} ${styles.btnFantasma}`}>Meu painel</Link>
        </header>

        <section className={styles.secao}>
          <h1 className={styles.secaoTitulo}>{curso.titulo}</h1>
          <p className={styles.secaoSub}>{curso.progresso_pct || 0}% concluído</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 24 }}>
            <div>
              {semAcesso && <div className={styles.aviso}>Esta aula ainda não está liberada pra você.</div>}
              {aula?.video_url ? (
                <video
                  key={aula.id}
                  src={aula.video_url}
                  controls
                  playsInline
                  style={{ width: '100%', borderRadius: 20, background: '#000' }}
                  onLoadedMetadata={() => { faixaEnviada.current = -1; }}
                  onTimeUpdate={(e) => {
                    const v = e.currentTarget;
                    if (!v.duration) return;
                    const pct = Math.round((v.currentTime / v.duration) * 100);
                    const faixa = Math.floor(pct / 10);
                    if (faixa <= faixaEnviada.current) return;
                    faixaEnviada.current = faixa;
                    plugcashApi.progresso(aula.id, pct).catch(() => {});
                  }}
                />
              ) : (
                !semAcesso && (
                  <div className={styles.vazio}>
                    Esta aula ainda não tem vídeo publicado.
                  </div>
                )
              )}
              {aula && (
                <>
                  <h2 className={styles.secaoTitulo} style={{ fontSize: 19, marginTop: 18 }}>{aula.titulo}</h2>
                  {aula.descricao && <p className={styles.secaoSub}>{aula.descricao}</p>}
                  {aula.material_url && (
                    <a href={aula.material_url} className={`${styles.btn} ${styles.btnFantasma}`} download>
                      Baixar o material
                    </a>
                  )}
                </>
              )}
            </div>

            <aside className={styles.card} style={{ padding: 16, alignSelf: 'start' }}>
              <ul className={styles.aulas}>
                {curso.aulas.map((a) => (
                  <li key={a.id}>
                    <button
                      className={styles.aula}
                      style={{
                        width: '100%', textAlign: 'left', background: 'none', border: 0,
                        font: 'inherit', cursor: 'pointer', padding: '8px 0',
                        color: a.id === aula?.id ? '#009B40' : undefined,
                        fontWeight: a.id === aula?.id ? 700 : 400,
                      }}
                      onClick={() => abrir(a.id)}
                    >
                      {/* Aqui dentro o curso já é dele: aula não assistida é um
                          círculo vazio, nunca cadeado — cadeado diria "travada". */}
                      {a.progresso?.concluida ? <Check /> : <Pendente />}
                      <span>{a.titulo}</span>
                      <span className={styles.aulaDuracao}>{duracao(a.duracao_seg)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}
