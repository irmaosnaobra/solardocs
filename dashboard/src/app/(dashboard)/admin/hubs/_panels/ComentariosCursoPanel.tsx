'use client';

// ─────────────────────────────────────────────────────────────────────────────
// BANCO DE COMENTÁRIOS DO CURSO — tudo que os alunos avaliaram fica aqui.
// Aprovar é o ÚNICO botão que escreve: ele publica (ou tira) o depoimento da
// página de venda. Só aparece lá o que estiver aprovado E autorizado pelo aluno.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { Star, Check, EyeOff } from 'lucide-react';
import api from '@/services/api';
import styles from '../../admin.module.css';

interface Avaliacao {
  id: string;
  curso_slug: string;
  modulo_slug: string;
  estrelas: number;
  comentario: string | null;
  nome_exibicao: string | null;
  empresa: string | null;
  cidade: string | null;
  autoriza_publicar: boolean;
  aprovado: boolean;
  criado_em: string;
  autor: { email: string; nome: string | null } | null;
}

interface Dados {
  total: number;
  media: number | null;
  com_comentario: number;
  autorizados: number;
  aprovados: number;
  avaliacoes: Avaliacao[];
}

type Filtro = 'todos' | 'publicaveis' | 'no-ar';

const dia = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export default function ComentariosCursoPanel() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('publicaveis');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/kit-avaliacoes')
      .then((r) => setDados(r.data as Dados))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function alternar(a: Avaliacao) {
    setSalvando(a.id);
    try {
      await api.patch(`/admin/kit-avaliacoes/${a.id}`, { aprovado: !a.aprovado });
      setDados((d) => d && {
        ...d,
        aprovados: d.aprovados + (a.aprovado ? -1 : 1),
        avaliacoes: d.avaliacoes.map((x) => (x.id === a.id ? { ...x, aprovado: !x.aprovado } : x)),
      });
    } catch {
      // silencioso: o botão volta ao estado real no próximo Atualizar
    } finally {
      setSalvando(null);
    }
  }

  const lista = (dados?.avaliacoes ?? []).filter((a) => {
    if (filtro === 'publicaveis') return !!(a.comentario ?? '').trim() && a.autoriza_publicar;
    if (filtro === 'no-ar') return a.aprovado;
    return true;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['publicaveis', 'Prontos pra usar'], ['todos', 'Todos'], ['no-ar', 'No ar']] as [Filtro, string][]).map(([k, label]) => (
            <button
              key={k}
              className={filtro === k ? styles.periodActive : styles.periodBtn}
              onClick={() => setFiltro(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className={styles.periodBtn} disabled={loading} onClick={load}>
          {loading ? 'Atualizando…' : '↻ Atualizar'}
        </button>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Avaliações</div>
          <div className={styles.cardValue}>{dados?.total ?? 0}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Nota média</div>
          <div className={styles.cardValue} style={{ color: '#C87A1E' }}>
            {dados?.media != null ? dados.media.toFixed(1).replace('.', ',') : '—'}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Com comentário</div>
          <div className={styles.cardValue}>{dados?.com_comentario ?? 0}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Autorizaram publicar</div>
          <div className={styles.cardValue}>{dados?.autorizados ?? 0}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>Na página de venda</div>
          <div className={styles.cardValue} style={{ color: '#2F7A4F' }}>{dados?.aprovados ?? 0}</div>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Comentários</div>
        <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 14 }}>
          Aprovar publica o depoimento na página de venda. Só aparecem lá os que têm comentário
          <strong> e </strong> autorização do aluno.
        </div>

        {lista.map((a) => (
          <article
            key={a.id}
            style={{
              borderTop: '1px solid rgba(148,163,184,.18)',
              padding: '14px 0',
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  size={14}
                  strokeWidth={2}
                  fill={n <= a.estrelas ? '#C87A1E' : 'none'}
                  color={n <= a.estrelas ? '#C87A1E' : 'rgba(148,163,184,.5)'}
                />
              ))}
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 3 }}>
                {a.modulo_slug ? `módulo ${a.modulo_slug}` : 'curso completo'} · {dia(a.criado_em)}
                {' · '}
                {a.nome_exibicao || a.autor?.nome || a.autor?.email || 'sem nome'}
                {a.empresa ? ` · ${a.empresa}` : ''}
                {a.cidade ? ` · ${a.cidade}` : ''}
              </div>
              {a.comentario
                ? <div style={{ fontSize: 14, lineHeight: 1.6 }}>&ldquo;{a.comentario}&rdquo;</div>
                : <div style={{ fontSize: 13, opacity: 0.5 }}>só a nota, sem comentário</div>}
              {!a.autoriza_publicar && (
                <div style={{ fontSize: 11.5, opacity: 0.6, marginTop: 5 }}>
                  o aluno não autorizou publicar — uso interno
                </div>
              )}
            </div>

            <button
              className={styles.periodBtn}
              disabled={salvando === a.id || !a.autoriza_publicar || !(a.comentario ?? '').trim()}
              onClick={() => alternar(a)}
              style={a.aprovado ? { color: '#2F7A4F', borderColor: '#2F7A4F' } : undefined}
              title={
                !a.autoriza_publicar ? 'Sem autorização do aluno'
                  : !(a.comentario ?? '').trim() ? 'Sem comentário para publicar'
                    : a.aprovado ? 'Tirar da página de venda' : 'Publicar na página de venda'
              }
            >
              {a.aprovado
                ? <><EyeOff size={13} /> Tirar do ar</>
                : <><Check size={13} /> Publicar</>}
            </button>
          </article>
        ))}

        {!lista.length && (
          <div style={{ fontSize: 13, opacity: 0.6, paddingTop: 10 }}>
            {dados?.total
              ? 'Nenhum comentário neste filtro.'
              : 'Nenhuma avaliação ainda — elas aparecem aqui conforme os alunos concluem os módulos.'}
          </div>
        )}
      </div>
    </div>
  );
}
