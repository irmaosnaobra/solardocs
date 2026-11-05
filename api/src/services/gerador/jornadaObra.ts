// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): as etapas 4 a 8. REGRAS PURAS: sem banco, sem rota e sem relógio.
//
// Imports permitidos: `jornadaSolar`, `jornadaDinheiro` (tipos) e `solarObras`. Nada de rota nem banco.
// Aqui moram os TIPOS do estado das etapas 4 a 8 (`jornada_obra:<card>`) e do JSON privado da obra (`<card>.obra.json`), e a
// etapa atual "completa" (1 a 9). O estado da Fase 1 (`jornada_solar:<card>`) NÃO muda de formato (D15).
// ─────────────────────────────────────────────────────────────────────────────
import { etapaAtualDoEstado, type EstadoJornada } from './jornadaSolar';

// ── Equipes ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const EQUIPES_LISTA = [
  { id: 'pablo', rotulo: 'Equipe Pablo (montagem)' },
  { id: 'diego', rotulo: 'Equipe Diego' },
  { id: 'propria', rotulo: 'Equipe própria' },
  { id: 'thiago_ari', rotulo: 'Equipe Thiago e Ari' },
  { id: 'branco', rotulo: 'Equipe Branco' },
] as const;
export type EquipeId = typeof EQUIPES_LISTA[number]['id'];
export const IDS_EQUIPE: readonly string[] = EQUIPES_LISTA.map((e) => e.id);

// ── O estado das etapas 4 a 8 (system_state, `jornada_obra:<card>`, assinado) ─────────────────────────────────────────

export const ACOES_HISTORICO_OBRA = ['abrir', 'concluir', 'esperar', 'voltar', 'fechar', 'reabrir', 'cofre_revelado', 'materializada', 'pedido'] as const;
export type AcaoHistoricoObra = typeof ACOES_HISTORICO_OBRA[number];

export interface EtapaObra { aberta_em: string | null; concluida_em: string | null; concluida_por: string }
export type MotivoEsperaObra = 'cliente' | 'cemig' | 'fornecedor' | 'banco';

export interface EstadoObra {
  v: 1;
  card: number;
  etapas: { 4: EtapaObra; 5: EtapaObra; 6: EtapaObra; 7: EtapaObra; 8: EtapaObra };
  dias_obra: Array<{ data: string; equipe: string }>;
  pedido: { numero: string; em: string } | null;
  esperando: { motivo: MotivoEsperaObra; ate: string; etapa: 4 | 5 | 6 | 7 | 8; em: string; por: string } | null;
  fechada: { em: string; por: string } | null;
  reaberturas: Array<{ em: string; por: string }>;
  historico: Array<{ em: string; por: string; acao: AcaoHistoricoObra; etapa: number | null }>;
}

export const ETAPAS_OBRA = [4, 5, 6, 7, 8] as const;

export const vazioEtapaObra = (): EtapaObra => ({ aberta_em: null, concluida_em: null, concluida_por: '' });

/**
 * A etapa atual de 1 a 9 (a Fase 1 manda nas etapas 1 a 3; a Fase 2, de 4 a 8). Nesta ordem:
 *  - `js` com etapa atual da Fase 1 menor que 4: ela;
 *  - `jo` gravado: a primeira de 4 a 8 sem `concluida_em` (todas concluídas: 9);
 *  - `js` na etapa 4 e sem `jo`: 4;
 *  - sem `js` e sem `jo`: a deduzida (null no sem trilho).
 */
export function etapaAtualCompleta(js: EstadoJornada | null, jo: EstadoObra | null, deduzida: number | null): number | null {
  if (js && etapaAtualDoEstado(js) < 4) return etapaAtualDoEstado(js);
  if (jo) {
    for (const n of ETAPAS_OBRA) if (!jo.etapas[n].concluida_em) return n;
    return 9;
  }
  if (js) return 4;
  return deduzida;
}

// ── O JSON privado da obra (bucket `cadastros-venda`, `vendasolar/<card>.obra.json`) ───────────────────────────────────

export const SECOES_OBRA = ['vistoria', 'banco', 'compra', 'logistica', 'obra', 'entrega', 'liberacao', 'previsto'] as const;
export type SecaoObra = typeof SECOES_OBRA[number];

export const CAMPOS_CONTRATO = [
  'versao_garantia', 'garantia_modulos_anos', 'garantia_inversor_anos', 'garantia_instalacao_anos', 'garantia_instalacao_unidade',
  'garantia_resposta_dias', 'empresa_nome', 'empresa_cnpj', 'empresa_telefone', 'cliente_nome', 'cliente_doc', 'cliente_tipo',
  'endereco_instalacao', 'cidade', 'uf', 'kwp', 'quantidade_modulos', 'marca_modulos', 'quantidade_inversores', 'marca_inversor',
] as const;
export type CampoContrato = typeof CAMPOS_CONTRATO[number];
export type ContratoObra = { gerado_em: string; por: string; fonte: 'gerado' | 'recalculado' } & Record<CampoContrato, string>;

export interface VistoriaObra {
  data: string; quem: string; acomp: string; concl: 'ok' | 'adeq' | 'nao' | ''; adeq: string[]; obs: string;
  telhado: { tipo: string; estado: string; orient: string; incl: string; area: string; sombra: string; estr: string; acesso: string };
  entrada: { padrao: string; tensao: string; disj: string; apto: string; aterr: string; quadro: string };
  inversor: { local: string; dist: string; abrig: string; wifi: string };
  fotos: Array<{ arquivo_id: string; leg: string; txt: string }>;
}
export interface BancoObra {
  banco: string; agencia: string; conta: string; validade: string; prazo: string; origem: string; nota: string; desc: string; ger: string;
  eq_centavos: number | null; mo_centavos: number | null;
  fin: { nome: string; doc: string; rg: string; qualif: string; end: string; cep: string; tel: string; email: string } | null;
}
export const GRUPOS_PREVISTO = ['homologacao', 'material', 'frete', 'mao_de_obra', 'outros'] as const;
export type PrevistoObra = { homologacao: number; material: number; frete: number; mao_de_obra: number; outros: number; por: string; em: string };
export interface RegraCongelada { linhas: Array<{ nome: string; papel: 'venda' | 'socio'; pb: number }>; congelada_em: string }

export const TIPOS_ITEM = ['modulo', 'inversor', 'estrutura', 'eletrico', 'outro'] as const;
export const UNIDADES_ITEM = ['un', 'm', 'par', 'kit'] as const;
export const ORIGENS_ITEM = ['proposta', 'lista', 'manual', 'nota'] as const;
export interface ItemCompra {
  id: string; origem: typeof ORIGENS_ITEM[number]; tipo: typeof TIPOS_ITEM[number]; descricao: string; quantidade: number | null;
  unidade: typeof UNIDADES_ITEM[number]; marca: string; modelo: string; potencia_w: number | null; potencia_kw: number | null;
  garantia_fabricacao_anos: number | null; garantia_desempenho_anos: number | null; garantia_anos: number | null;
  compra_id: string | null; fornecedor: string; valor_centavos: number | null; data: string | null; etapa: 4 | 6; criado_por: string; criado_em: string;
}
export interface CompraObra {
  id: string; fornecedor: string; cidade: string; data: string | null; forma: string;
  nota_chega: 'com_a_carga' | 'na_retirada' | 'anexada';
  nota: { path: string; sha256: string; numero: string; chave: string; nf_id: string } | null;
}
export interface CargaObra {
  id: string; nome: string; itens: string[];
  saida: { lugar: string; em: string };
  chegada: { lugar: string; destino: 'deposito' | 'obra'; em: string };
  transporte: { empresa: string; motorista: string };
  compras: string[];
  recebido_por: { nome: string; assinatura_id: string };
  conferencia: { itens_ok: string[]; foto_id: string };
  avaria: { tem: boolean; descricao: string; foto_id: string; o_que_fazer: string; resolvida: boolean };
  frete: { valor_centavos: number | null; forma: string };
  documentos: string[];
}
export const CHAVES_CHECKLIST = ['estrutura', 'placas', 'strings', 'inversor', 'dps', 'aterramento', 'cabos', 'padrao'] as const;
export interface ObraPrivada {
  v: 1;
  versoes: Record<SecaoObra, number>;
  contrato: ContratoObra | null;
  vistoria: VistoriaObra | null;
  banco: BancoObra | null;
  previsto: PrevistoObra | null;
  regra_comissao: RegraCongelada | null;
  compra: { itens: ItemCompra[]; compras: CompraObra[] };
  logistica: { cargas: CargaObra[] };
  obra: {
    plano: Array<{ data: string; inicio: string; fim: string; equipe: string; ajudantes: number; servico: string }>;
    diario: Array<{ data: string; chegada: string; saida: string; fotos: string[]; ocorrencia: string }>;
    checklist: Record<string, boolean>;
    equipe: { combinado_centavos: number | null; descricao: string };
  };
  entrega: {
    testes: { string1_voc: string; string2_voc: string; isolamento_ok: boolean; gerando_kw: string; gerando_hora: string; wifi_ok: boolean; disjuntores_ok: boolean };
    monitoramento: { app: string; conta: string; usina: string; online: boolean; serie: string; comissionamento: string };
    cofre: { cifra: string; iv: string; tag: string; em: string; por: string } | null;
    cofre_revelado: Array<{ em: string; por: string }>;
    garantias: { registrada_em: string | null; treinado: boolean };
    termo: { assinado_em: string; nome: string; arquivo_id: string; chk: string[]; ressalva: string } | null;
    responsavel: string;
  };
  liberacao: {
    passos: { pedido: PassoLiberacao | null; vistoria: PassoLiberacao | null; medidor: PassoLiberacao | null; liberada: PassoLiberacao | null };
    exigencias: Array<{ em: string; por: string; texto: string }>;
  };
  reaberturas: Array<{ em: string; por: string; motivo: string }>;
}
export type PassoLiberacao = { data: string; arquivo_id: string };
