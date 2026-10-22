// As tabelas do banco do Gerador que guardam a cidade em texto livre.
// Arquivo sem imports de propósito: o script de limpeza (scripts/normalizar-cidades.mjs)
// carrega isto do dist/ sem puxar logger nem Supabase da API.

export interface TabelaDeCidade {
  nome: string;
  /** Coluna única, usada para paginar e para atualizar. */
  chave: string;
  telefone: string;
  /** Coluna de data de criação. */
  criada: string;
}

/** `leads_meta` não tem `id` nem `created_at`: a chave é `lead_id` e o relógio é `created_time`. */
export const TABELAS_DE_CIDADE: readonly TabelaDeCidade[] = [
  { nome: 'agendamentos',         chave: 'id',      telefone: 'cliente_telefone', criada: 'created_at' },
  { nome: 'eletroposto_nota1',    chave: 'id',      telefone: 'telefone',         criada: 'created_at' },
  { nome: 'eletroposto_parceria', chave: 'id',      telefone: 'telefone',         criada: 'created_at' },
  { nome: 'leads_meta',           chave: 'lead_id', telefone: 'whatsapp',         criada: 'created_time' },
];

