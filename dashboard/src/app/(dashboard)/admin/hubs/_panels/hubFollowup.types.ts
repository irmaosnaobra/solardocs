// Shape de /admin/hub-followup — compartilhado por FollowupPanel e ConversasPanel.
export interface HubMsg { role: string; content: string; }

export interface HubSession {
  phone: string;
  nome: string | null;
  tipo: string;
  updated_at: string | null;
  handed_off: boolean;
  opt_out: boolean;
  status: string | null;
  msgs_count: number;
  last_role: string | null;
  last_msg: string | null;
  messages: HubMsg[];
  respondeu: boolean;
  converteu: boolean | null;
}

// Funil do agente: abordados → responderam → converteram. Uma lista, porque um produto
// pode ter tipos de sessão que significam coisas diferentes (SolarDoc: abandono x plataforma).
export interface HubConversaoBloco {
  rotulo: string;
  abordados: number;
  responderam: number;
  converteram: number | null;   // null = não dá pra medir → tela mostra "—"
  taxa_pct: number | null;
  medida: string;
}

export interface HubFollowup {
  produto: string;
  tipos: string[];
  summary: { total: number; em_conversa: number; handoff: number; opt_out: number; ultimas24h: number; ultimos7d: number };
  conversao: HubConversaoBloco[] | null;
  sessions: HubSession[];
}
