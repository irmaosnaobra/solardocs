/** Tipos e formatadores da tela do Off-grid. */

export const brl = (n: number) => 'R$ ' + Math.round(n || 0).toLocaleString('pt-BR');
export const brl2 = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Real inteiro quando não há centavos, com centavos quando há. */
export const brlAuto = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? brl(n) : brl2(n));

/** Número em português: 10.24 vira "10,24". O JS interpola com ponto e o brasileiro lê dez mil. */
export const nb = (v: number, casas = 2) =>
  (isFinite(v) ? v : 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });

/** Dias viram a unidade que o cliente entende: 2,4 dias é "2 dias e 10 horas". */
export function tempoHumano(dias: number): string {
  if (!isFinite(dias) || dias <= 0) return 'menos de 1 hora';
  if (dias < 1) return `${Math.round(dias * 24)} horas`;
  const d = Math.floor(dias);
  const h = Math.round((dias - d) * 24);
  if (h === 0) return `${d} ${d === 1 ? 'dia' : 'dias'}`;
  return `${d} ${d === 1 ? 'dia' : 'dias'} e ${h}h`;
}

/**
 * O dinheiro vem do SERVIDOR (POST /offgrid/orcar). O dimensionamento roda no navegador e é aberto para todo mundo; o
 * preço da casa não desce para quem não tem acesso.
 */
export interface Orcamento {
  itens: { id: string; nome: string; qtd: number; unitario: number; total: number }[];
  custoEquipamentos: number;
  frete: number;
  freteRegiao: string;
  fretePrazo: string;
  /** Uberlândia até o destino, km, peso e R$/kg. */
  freteDetalhe?: string;
  custoFornecimento: number;
  maoDeObra: number;
  extras: number;
  margemValor: number;
  precoCliente: number;
  custoKwhArmazenado: number;
  tabelaVersao: string;
  creditoPedido: number;
}

export interface DocGerado {
  content: string;
  doc_id: string | null;
  codigo?: string | null;
  codigo_curto?: string | null;
  empresa_slug?: string | null;
}

/** Mesma lista e mesma ordem do PropostaSolarForm e do servidor (bancosLogos). */
export const BANCOS_LOGOS = [
  { id: 'sicredi', nome: 'Sicredi' },
  { id: 'santander', nome: 'Santander' },
  { id: 'bv', nome: 'BV' },
  { id: 'bb', nome: 'Banco do Brasil' },
  { id: 'caixa', nome: 'Caixa' },
  { id: 'sicoob', nome: 'Sicoob' },
  { id: 'bradesco', nome: 'Bradesco' },
  { id: 'itau', nome: 'Itaú' },
  { id: 'solfacil', nome: 'Solfácil' },
  { id: 'solagora', nome: 'SolAgora' },
  { id: '77sol', nome: '77Sol' },
  { id: 'btg', nome: 'BTG Pactual' },
] as const;
export const TODOS_BANCOS: string[] = BANCOS_LOGOS.map((b) => b.id);
