// Dados que o Moderno (propostaSolar, modelos 2 e 3) recebe já calculados do templateService. O desenho não faz
// conta de dinheiro: payback, economia e parcelas chegam prontos, os mesmos que o texto do WhatsApp usa.
import type { Palette, Bateria } from '../propostaSolarBase';
import type { InversorProposta } from '../inversoresProposta';
import type { Financeiro } from '../propostaSolarCalculos';
import type { DadosContato } from './propostaSolarPartes';
import type { LogoMedidas } from './logoAjuste';

export interface Parcela { n: number; valor: number }
export interface Assinante { nome: string; doc: string; detalhe: string }

export interface DadosModerno {
  comCapa: boolean;
  palette: Palette;
  contato: DadosContato;
  /** Medidas da logo ajustada pelo servidor (logoAjuste.ts). Sem elas, a logo sai como antes. */
  logoInfo?: LogoMedidas | null;
  empresa: { endereco: string; cidade: string };
  codigo: string;
  hoje: string;
  /** "28 de novembro de 2026", ou vazio se a data não existir. */
  validadeAte: string;
  validadeDias: number;
  cliente: { nome: string; endereco: string; cidade: string; uf: string; email: string; telefone: string; doc: string };
  assinaturas: { empresa: Assinante; cliente: Assinante; local: string };
  sistema: {
    kwp: number; qtdModulos: number; marcaModulo: string; potenciaModulo: number; inversores: InversorProposta[];
    bateria: Bateria; areaM2: number; tipoTelhado: string; fotoTelhado: string;
  };
  energia: { consumoKwh: number; mensal: number[]; geracaoAnual: number; mediaMensal: number; hsp: number; economiaPercent: number; tarifa: number };
  fin: Financeiro;
  contaHojeExib: number;
  contaComSolarExib: number;
  cip: number;
  taxaMinima: number;
  inflacaoPct: number;
  inflacaoTaxaMinPct: number;
  pag: {
    investimento: number; precoAvista: number; vista: boolean; cartao: Parcela[]; fin: Parcela[];
    /** Texto da carência do financiamento. Ausente = "120 dias de carência", como sempre foi. */
    finCarencia?: string;
    entrada: { valor: number; restante: number; prazo: string } | null; custom: string;
  };
  prazoDias: number;
  gar: {
    paineis: number; inversorUnico: number; inversoresDiferentes: boolean; estrutura: number; instalacao: number; instalacaoUnidade: string;
    bateria: number; extras: { nome: string; anos: number }[];
  };
}

export interface Folha { titulo: string; paginas: { corpo: string; h: number }[] }
