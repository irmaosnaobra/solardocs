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
}

export interface HubFollowup {
  produto: string;
  tipos: string[];
  summary: { total: number; em_conversa: number; handoff: number; opt_out: number; ultimas24h: number; ultimos7d: number };
  sessions: HubSession[];
}
