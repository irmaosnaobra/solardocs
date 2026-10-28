// Vistoria solar: tipos do contrato com a API e os textos da tela (arquivo do redator, sem mudança).
// As regras (selo, pendências, conclusão) moram no servidor; aqui só se desenha o que ele devolve.

export type StatusKey = 'conforme' | 'atencao' | 'nao_conforme' | 'na';
export type Selo = 'conforme' | 'atencao' | 'nao_conforme';
export type MapaStatus = Partial<Record<string, StatusKey>>;

/** Os 10 itens técnicos. conta_luz e documento_pessoal não têm status. */
export const ITENS_COM_STATUS = [
  'padrao', 'medidor', 'disjuntor_padrao', 'quadro_distribuicao', 'inversores',
  'telhado', 'tipo_telha', 'estrutura', 'cabeamento', 'sombreamento',
];

export const STATUS_BOTOES: { valor: StatusKey; texto: string }[] = [
  { valor: 'conforme', texto: 'Conforme' },
  { valor: 'atencao', texto: 'Atenção' },
  { valor: 'nao_conforme', texto: 'Não conforme' },
  { valor: 'na', texto: 'N/A' },
];

export const SELOS: Record<Selo, { titulo: string; frase: string }> = {
  conforme: { titulo: 'Apto para instalar', frase: 'Todos os itens avaliados estão conformes para a instalação.' },
  atencao: { titulo: 'Instalável com ajustes', frase: 'Dá para instalar, mas alguns itens pedem ajuste. Veja as pendências abaixo.' },
  nao_conforme: { titulo: 'Adequar antes de instalar', frase: 'Há itens fora do esperado que precisam ser adequados antes da instalação. Veja a prioridade de cada um.' },
};

export const TEXTOS = {
  statusTitulo: 'Status do item (opcional)',
  statusLiberando: 'Status e assinatura estão sendo liberados.',
  assinaturasTitulo: 'Assinaturas',
  tecnicoTitulo: 'Assinatura do técnico',
  tecnicoNome: 'Nome do técnico',
  tecnicoRegistro: 'Registro profissional (opcional)',
  tecnicoRegistroPlaceholder: 'Exemplo: CREA ou CFT, com o número.',
  clienteTitulo: 'Assinatura do cliente (opcional)',
  clienteNome: 'Nome do cliente',
  instrucao: 'Assine com o dedo no quadro abaixo.',
  limpar: 'Limpar',
  salvar: 'Salvar assinatura',
  avisoCliente: 'A assinatura do cliente é opcional. Você pode concluir a vistoria sem ela.',
  assinaturaSalva: 'Assinatura salva.',
  semDesenho: 'Desenhe a assinatura antes de salvar.',
  semNomeTecnico: 'Informe o nome do técnico para salvar.',
  baixarPdf: 'Baixar PDF',
  gerandoPdf: 'Gerando o PDF. Aguarde um instante.',
  reabrir: 'Reabrir vistoria',
  confirmarReabrir: 'Reabrir esta vistoria para editar? Ela volta para em andamento até você concluir de novo.',
  confirmar: 'Reabrir',
  cancelar: 'Cancelar',
  clienteSemNome: 'Vistoria avulsa',
  continuar: 'Continuar',
  abrir: 'Abrir',
};

export interface ItemLista {
  id: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  status: string;
  total: number;
  preenchidos: number;
  tem_local: boolean;
  selo?: Selo | null;
  created_at: string;
}

export interface Resumo {
  selo: Selo | null;
  pendencias: { key: string; label: string; prioridade: 'alta' | 'media' }[];
  conclusao: string | null;
  itensComFoto: number;
  totalItens: number;
}

export interface AssinaturaSalva { url?: string; nome: string; registro?: string }
export interface AssinaturasEstado { tecnico?: AssinaturaSalva; cliente?: AssinaturaSalva }

export function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ehMigracaoPendente(err: unknown): boolean {
  const r = (err as { response?: { status?: number; data?: { error?: string; erro?: string } } })?.response;
  return r?.status === 503 && (r?.data?.error === 'migracao_pendente' || r?.data?.erro === 'migracao_pendente');
}
