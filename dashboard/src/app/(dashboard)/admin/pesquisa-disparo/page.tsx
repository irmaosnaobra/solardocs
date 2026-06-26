'use client';

import { useState } from 'react';
import LeadsGooglePanel from '../_components/LeadsGooglePanel';
import DisparosPanel from '../_components/DisparosPanel';

// Agrupa "Leads Google" (pesquisa) e "Disparos IO" numa página só com abas.
// As rotas /admin/leads-google e /admin/disparos seguem vivas (re-export).
export default function PesquisaDisparoPage() {
  const [tab, setTab] = useState<'leads' | 'disparos'>('leads');

  const tabBtn = (active: boolean): React.CSSProperties => ({
    padding: '9px 18px',
    borderRadius: 10,
    border: active ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
    background: active ? 'var(--color-accent-soft)' : 'var(--color-surface)',
    color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'inherit',
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <button style={tabBtn(tab === 'leads')} onClick={() => setTab('leads')}>🔎 Leads Google</button>
        <button style={tabBtn(tab === 'disparos')} onClick={() => setTab('disparos')}>📤 Disparos IO</button>
      </div>

      {tab === 'leads' && <LeadsGooglePanel />}
      {tab === 'disparos' && <DisparosPanel />}
    </div>
  );
}
