'use client';

import LeadsGooglePanel from '../_components/LeadsGooglePanel';

// Era "Leads Google" + "Disparos IO" em abas. O disparo saiu em 07/10/2026 (0
// disparos em 30 dias); a rota fica porque a Sidebar aponta pra cá.
// /admin/leads-google segue viva (re-export).
export default function PesquisaDisparoPage() {
  return <LeadsGooglePanel />;
}
