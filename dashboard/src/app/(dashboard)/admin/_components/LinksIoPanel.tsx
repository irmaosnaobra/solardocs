'use client';

import { useEffect, useState, useCallback } from 'react';
import api from '@/services/api';
import { useDashboard } from '@/contexts/DashboardContext';
import styles from '../links-io/page.module.css';

interface IoLink {
  id: string;
  section: string | null;
  label: string;
  url: string;
  icon: string;
  sort_order: number;
  active: boolean;
  featured: boolean;
  clicks: number;
}

type Draft = Omit<IoLink, 'id' | 'clicks'> & { id?: string; clicks?: number };

const EMPTY: Draft = {
  section: '',
  label: '',
  url: '',
  icon: '',
  sort_order: 999,
  active: true,
  featured: false,
};

const PUBLIC_URL = 'https://solardoc.app/io/links';

export default function LinksIoPanel() {
  const { user } = useDashboard();

  const [links, setLinks] = useState<IoLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/io-links/admin');
      setLinks(data.links || []);
    } catch {
      setError('Não consegui carregar os links.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.is_admin) load();
  }, [load, user]);

  function startNew() {
    const nextOrder = links.length ? Math.max(...links.map(l => l.sort_order)) + 10 : 10;
    setEditing({ ...EMPTY, sort_order: nextOrder });
    setError('');
  }

  function startEdit(l: IoLink) {
    setEditing({ ...l, section: l.section || '' });
    setError('');
  }

  async function save() {
    if (!editing) return;
    if (!editing.label.trim() || !editing.url.trim()) {
      setError('Preencha o texto do botão e o link.');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      section: editing.section?.trim() || null,
      label: editing.label.trim(),
      url: editing.url.trim(),
      icon: editing.icon?.trim() || '',
      sort_order: Number(editing.sort_order) || 999,
      active: editing.active,
      featured: editing.featured,
    };
    try {
      if (editing.id) await api.put(`/io-links/admin/${editing.id}`, payload);
      else await api.post('/io-links/admin', payload);
      setEditing(null);
      await load();
    } catch {
      setError('Erro ao salvar. Tente de novo.');
    } finally {
      setSaving(false);
    }
  }

  async function patch(l: IoLink, fields: Partial<IoLink>) {
    // Otimista: atualiza na hora, reverte se falhar.
    setLinks(prev => prev.map(x => (x.id === l.id ? { ...x, ...fields } : x)));
    try {
      await api.put(`/io-links/admin/${l.id}`, fields);
    } catch {
      await load();
    }
  }

  async function remove(l: IoLink) {
    if (!confirm(`Excluir o botão "${l.label}"?`)) return;
    setLinks(prev => prev.filter(x => x.id !== l.id));
    try {
      await api.delete(`/io-links/admin/${l.id}`);
    } catch {
      await load();
    }
  }

  // Reordena trocando o sort_order com o vizinho.
  async function move(l: IoLink, dir: -1 | 1) {
    const sorted = [...links].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex(x => x.id === l.id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    const a = l.sort_order;
    const b = swap.sort_order;
    setLinks(prev =>
      prev.map(x => (x.id === l.id ? { ...x, sort_order: b } : x.id === swap.id ? { ...x, sort_order: a } : x)),
    );
    try {
      await Promise.all([
        api.put(`/io-links/admin/${l.id}`, { sort_order: b }),
        api.put(`/io-links/admin/${swap.id}`, { sort_order: a }),
      ]);
    } catch {
      await load();
    }
  }

  if (!user || !user.is_admin) return null;

  const sorted = [...links].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Link na Bio — Irmãos na Obra</h1>
          <p className={styles.subtitle}>
            Edite os botões que aparecem em{' '}
            <a href={PUBLIC_URL} target="_blank" rel="noopener" className={styles.publicLink}>
              solardoc.app/io/links
            </a>
            . As mudanças aparecem na hora.
          </p>
        </div>
        <div className={styles.headerActions}>
          <a href={PUBLIC_URL} target="_blank" rel="noopener" className={styles.btnGhost}>
            Ver página
          </a>
          <button className={styles.btnPrimary} onClick={startNew}>
            + Novo botão
          </button>
        </div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.empty}>Carregando…</div>
      ) : sorted.length === 0 ? (
        <div className={styles.empty}>Nenhum botão ainda. Clique em “Novo botão”.</div>
      ) : (
        <ul className={styles.list}>
          {sorted.map((l, i) => (
            <li key={l.id} className={`${styles.row} ${!l.active ? styles.rowInactive : ''}`}>
              <div className={styles.reorder}>
                <button className={styles.arrow} onClick={() => move(l, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                <button className={styles.arrow} onClick={() => move(l, 1)} disabled={i === sorted.length - 1} aria-label="Descer">▼</button>
              </div>

              <div className={styles.rowMain}>
                <div className={styles.rowTop}>
                  {l.icon && <span className={styles.rowIcon}>{l.icon}</span>}
                  <span className={styles.rowLabel}>{l.label}</span>
                  {l.featured && <span className={styles.badgeFeatured}>destaque</span>}
                  {l.section && <span className={styles.badgeSection}>{l.section}</span>}
                </div>
                <a href={l.url} target="_blank" rel="noopener" className={styles.rowUrl}>{l.url}</a>
                <span className={styles.rowClicks}>{l.clicks} clique{l.clicks === 1 ? '' : 's'}</span>
              </div>

              <div className={styles.rowActions}>
                <label className={styles.toggle} title="Ativo na página pública">
                  <input type="checkbox" checked={l.active} onChange={e => patch(l, { active: e.target.checked })} />
                  <span>{l.active ? 'Visível' : 'Oculto'}</span>
                </label>
                <button className={styles.btnSmall} onClick={() => startEdit(l)}>Editar</button>
                <button className={`${styles.btnSmall} ${styles.btnDanger}`} onClick={() => remove(l)}>Excluir</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className={styles.modalBackdrop} onClick={() => !saving && setEditing(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>{editing.id ? 'Editar botão' : 'Novo botão'}</h2>

            <label className={styles.field}>
              <span>Texto do botão *</span>
              <input
                value={editing.label}
                onChange={e => setEditing({ ...editing, label: e.target.value })}
                placeholder="Ex: Falar com Especialista"
                autoFocus
              />
            </label>

            <label className={styles.field}>
              <span>Link (URL) *</span>
              <input
                value={editing.url}
                onChange={e => setEditing({ ...editing, url: e.target.value })}
                placeholder="https://wa.me/55349... ou https://solardoc.app/io/oferta"
              />
            </label>

            <div className={styles.fieldRow}>
              <label className={styles.field}>
                <span>Emoji</span>
                <input
                  value={editing.icon}
                  onChange={e => setEditing({ ...editing, icon: e.target.value })}
                  placeholder="opcional"
                  maxLength={4}
                />
              </label>
              <label className={styles.field}>
                <span>Seção (grupo)</span>
                <input
                  value={editing.section || ''}
                  onChange={e => setEditing({ ...editing, section: e.target.value })}
                  placeholder="Ex: Para Clientes (opcional)"
                />
              </label>
            </div>

            <div className={styles.checkRow}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={editing.featured}
                  onChange={e => setEditing({ ...editing, featured: e.target.checked })}
                />
                <span>Botão de destaque (amarelo)</span>
              </label>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={editing.active}
                  onChange={e => setEditing({ ...editing, active: e.target.checked })}
                />
                <span>Visível na página</span>
              </label>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.btnGhost} onClick={() => setEditing(null)} disabled={saving}>Cancelar</button>
              <button className={styles.btnPrimary} onClick={save} disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
