// Shapes de /admin/hub-config e /admin/hub-gerador.
export interface HubConfig {
  produto: string;
  readonly: boolean;
  flags: { label: string; ativo: boolean; detalhe: string }[];
  saude: { item: string; ok: boolean; detalhe: string }[];
}

export interface HubGeradorLead {
  nome: string | null; telefone: string | null; cidade: string | null;
  status: string | null; temperatura: string | null; quando: string | null;
  consultor: string | null; created_at: string | null;
}
export interface HubGerador {
  produto: string;
  total: number;
  por_status: Record<string, number>;
  com_temperatura: number;
  leads: HubGeradorLead[];
}
