// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): as etapas 4 a 8. REGRAS PURAS: sem banco, sem rota e sem relógio.
//
// Imports permitidos: `jornadaSolar`, `jornadaDinheiro` (tipos) e `solarObras`. Nada de rota nem banco.
// Aqui moram os TIPOS do estado das etapas 4 a 8 (`jornada_obra:<card>`) e do JSON privado da obra (`<card>.obra.json`), e a
// etapa atual "completa" (1 a 9). O estado da Fase 1 (`jornada_solar:<card>`) NÃO muda de formato (D15).
// ─────────────────────────────────────────────────────────────────────────────
import { diaDeBrasilia } from '../agenda/viradaDoDia';
import { ehDiaUtil, etapaAtualDoEstado, situacaoComPrazo, somarDiasUteis, type EstadoJornada, type Situacao } from './jornadaSolar';
import type { LancamentoObra, Livro, Pendencia } from './jornadaDinheiro';

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

// ── A etapa materializada ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * O estado das etapas 4 a 8 de uma obra que ainda não tinha (venda antiga ou nascida sem a rota nova): as etapas de 4 até n-1 concluídas
 * agora por `leitura`, a n aberta agora (a 4 com `aberta4` quando a Fase 1 já a abriu). Etapa 9: as cinco concluídas.
 */
export function obraMaterializada(card: number, etapa: number, aberta4: string | null, agora: string): EstadoObra {
  const n = Math.min(Math.max(etapa, 4), 9);
  const e = (i: number): EtapaObra => {
    if (i < n) return { aberta_em: i === 4 ? (aberta4 ?? agora) : agora, concluida_em: agora, concluida_por: 'leitura' };
    if (i === n) return { aberta_em: i === 4 ? (aberta4 ?? agora) : agora, concluida_em: null, concluida_por: '' };
    return vazioEtapaObra();
  };
  return {
    v: 1, card, etapas: { 4: e(4), 5: e(5), 6: e(6), 7: e(7), 8: e(8) },
    dias_obra: [], pedido: null, esperando: null, fechada: null, reaberturas: [],
    historico: [{ em: agora, por: 'leitura', acao: 'materializada', etapa: n }],
  };
}

// ── Prazos e situação ───────────────────────────────────────────────────────────────────────────────────────────────

const ymdMais = (d: string, dias: number): string => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + dias);
  return x.toISOString().slice(0, 10);
};
/** O dia útil anterior a `d` (o próprio `d` não conta). */
const diaUtilAntes = (d: string): string => {
  let x = d;
  for (let g = 0; g < 400; g++) { x = ymdMais(x, -1); if (ehDiaUtil(x)) return x; }
  return x;
};

export interface PrazoObra { vence: string | null; rotulo: string }
const abertaEm = (n: number, js: EstadoJornada | null, jo: EstadoObra | null): string | null =>
  (jo && n >= 4 && n <= 8 ? jo.etapas[n as 4 | 5 | 6 | 7 | 8].aberta_em : null) ?? (n === 4 ? js?.etapas[4].aberta_em ?? null : null);

export function prazoDaEtapaObra(n: number, js: EstadoJornada | null, jo: EstadoObra | null): PrazoObra {
  const base = abertaEm(n, js, jo);
  const dia = base ? diaDeBrasilia(base) : null;
  const dias = jo?.dias_obra ?? [];
  if (n === 4) return dia ? { vence: somarDiasUteis(dia, 2), rotulo: 'Prazo' } : { vence: null, rotulo: '' };
  if (n === 5) return dias.length ? { vence: diaUtilAntes(dias[0].data), rotulo: 'Material na obra até' } : { vence: null, rotulo: 'Marque os dias da obra na etapa 6' };
  if (n === 6) return dias.length ? { vence: dias[dias.length - 1].data, rotulo: 'Último dia da obra' } : { vence: null, rotulo: 'Marque os dias da obra na etapa 6' };
  if (n === 7) return dia ? { vence: somarDiasUteis(dia, 1), rotulo: 'Prazo' } : { vence: null, rotulo: '' };
  if (n === 8) {
    if (jo?.pedido) return { vence: somarDiasUteis(jo.pedido.em, 7), rotulo: 'Prazo da Cemig' };
    return dia ? { vence: somarDiasUteis(dia, 1), rotulo: 'Pedir até' } : { vence: null, rotulo: '' };
  }
  return { vence: null, rotulo: '' };
}

/** Conta fechada ou etapa concluída: `sem_prazo`. Senão a mesma conta da Fase 1, com o prazo daqui e a espera do `jornada_obra`. */
export function situacaoObra(n: number, js: EstadoJornada | null, jo: EstadoObra | null, hoje: string): Situacao {
  if (n < 4 || n > 8 || jo?.fechada || jo?.etapas[n as 4 | 5 | 6 | 7 | 8].concluida_em) return { tipo: 'sem_prazo', texto: '' };
  const esp = jo?.esperando && jo.esperando.etapa === n ? jo.esperando : null;
  return situacaoComPrazo(prazoDaEtapaObra(n, js, jo).vence, esp, !!js?.cancelada, hoje);
}

// ── As pendências da obra e o material ──────────────────────────────────────────────────────────────────────────────────

const vivoLiquido = (ls: readonly LancamentoObra[], quais: (l: LancamentoObra) => boolean): number =>
  ls.filter((l) => l.apagado === false && l.obra.grupo === 'custo' && quais(l)).reduce((s, l) => s + (l.obra.estorno_de ? -l.valor_centavos : l.valor_centavos), 0);
export const somaItens = (p: ObraPrivada, compraId: string): number =>
  p.compra.itens.filter((i) => i.compra_id === compraId).reduce((s, i) => s + (i.valor_centavos ?? 0), 0);
const reaisTxt = (c: number): string => {
  const a = Math.abs(Math.round(c));
  return `R$ ${String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${String(a % 100).padStart(2, '0')}`;
};

/** O líquido pago de uma compra (os estornos subtraem). */
export const pagoDaCompra = (compraId: string, ls: readonly LancamentoObra[]): number => vivoLiquido(ls, (l) => l.obra.compra_id === compraId);

/** A compra paga: tem itens de valor e os lançamentos dela fecham a soma. */
export function compraPaga(p: ObraPrivada, compraId: string, ls: readonly LancamentoObra[]): boolean {
  const soma = somaItens(p, compraId);
  return soma > 0 && vivoLiquido(ls, (l) => l.obra.compra_id === compraId) >= soma;
}

/** O item "material com origem" (N de M): cada item da Compra (etapa 4 e o material extra da etapa 6) com fornecedor, valor, data e compra paga. */
export function materialDaCompra(p: ObraPrivada | null, ls: readonly LancamentoObra[]): { com_origem: number; total: number } {
  if (!p) return { com_origem: 0, total: 0 };
  const com = p.compra.itens.filter((i) => i.fornecedor && (i.valor_centavos ?? 0) > 0 && i.data && i.compra_id
    && p.compra.compras.some((c) => c.id === i.compra_id) && compraPaga(p, i.compra_id, ls)).length;
  return { com_origem: com, total: p.compra.itens.length };
}

/** O "a pagar" que mora no `obra.json` (SPEC 3.3): compra sem pagamento que feche, equipe e frete de carga com valor e sem comprovante. */
export function pendenciasDaObra(p: ObraPrivada | null, ls: readonly LancamentoObra[]): Pendencia[] {
  if (!p) return [];
  const out: Pendencia[] = [];
  for (const c of p.compra.compras) {
    const soma = somaItens(p, c.id);
    if (soma <= 0) continue;
    const pago = vivoLiquido(ls, (l) => l.obra.compra_id === c.id);
    if (pago < soma) out.push({ tipo: 'compra', texto: `Compra ${c.fornecedor || c.id}: falta pagar ${reaisTxt(soma - pago)}`, valor_centavos: soma - pago, etapa: 4 });
  }
  const comb = p.obra.equipe.combinado_centavos ?? 0;
  if (comb > 0) {
    const pago = vivoLiquido(ls, (l) => l.categoria === 'mao_de_obra' && l.obra.etapa === 6);
    if (pago < comb) out.push({ tipo: 'equipe', texto: `Equipe: falta pagar ${reaisTxt(comb - pago)}`, valor_centavos: comb - pago, etapa: 6 });
  }
  for (const c of p.logistica.cargas) {
    const v = c.frete.valor_centavos ?? 0;
    if (v > 0 && vivoLiquido(ls, (l) => l.categoria === 'frete' && l.obra.carga_id === c.id) <= 0) {
      out.push({ tipo: 'frete', texto: `Frete da carga ${c.nome || c.id}: ${reaisTxt(v)} sem comprovante`, valor_centavos: v, etapa: 5 });
    }
  }
  return out;
}

// ── Os itens do portão de cada etapa ──────────────────────────────────────────────────────────────────────────────────

export interface ItemObra { chave: string; bloco: 'portao'; texto: string; feito: boolean }
export interface FonteItens {
  jo: EstadoObra | null;
  privada: ObraPrivada;
  livro: Livro;
  /** slot -> ids dos arquivos anexados. */
  slots: ReadonlyMap<string, readonly string[]>;
  docsIds: ReadonlySet<string>;
}
export const SLOTS_FOTO_ENTREGA = ['ent_vista_geral', 'ent_arranjo', 'ent_inversor', 'ent_quadro', 'ent_aterramento', 'ent_padrao', 'ent_etiquetas', 'ent_local_limpo'] as const;

const mesmoConjunto = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

export function itensDaEtapaObra(n: number, f: FonteItens): ItemObra[] {
  const p = f.privada;
  const it = (chave: string, texto: string, feito: boolean): ItemObra => ({ chave, bloco: 'portao', texto, feito });
  const pend = (tipo: Pendencia['tipo']): boolean => f.livro.a_pagar.some((x) => x.tipo === tipo);
  const existe = (id: string): boolean => !!id && f.docsIds.has(id);
  const mat = f.livro.fechamento.material;
  const vivas = f.livro.linhas.filter((l) => !l.estorno_de && !l.estornada);
  if (n === 4) {
    const comItens = p.compra.compras.filter((c) => p.compra.itens.some((i) => i.compra_id === c.id));
    return [
      it('material', `Todo o material com origem, valor e data, um item por linha (${mat.com_origem} de ${mat.total})`, mat.total > 0 && mat.com_origem === mat.total),
      it('comprovante', 'Comprovante de cada compra', comItens.length > 0 && comItens.every((c) => vivas.some((l) => l.compra_id === c.id))),
    ];
  }
  if (n === 5) {
    const itens4 = p.compra.itens.filter((i) => i.etapa === 4);
    const cargas = p.logistica.cargas;
    return [
      it('cargas', 'Todas as cargas na obra', itens4.length > 0 && itens4.every((i) => cargas.some((c) => c.itens.includes(i.id) && c.chegada.destino === 'obra' && !!c.chegada.em))),
      it('conferencia', 'Conferência batendo com a compra e com a nota', cargas.length > 0 && cargas.every((c) => mesmoConjunto(c.conferencia.itens_ok, c.itens) && existe(c.conferencia.foto_id))),
      it('notas', `Nota fiscal das ${p.compra.compras.length} compras anexada`, p.compra.compras.length > 0 && p.compra.compras.every((c) => !!c.nota)),
      it('avarias', 'Avarias resolvidas', cargas.every((c) => !c.avaria.tem || c.avaria.resolvida)),
      it('frete', 'Frete com comprovante', !pend('frete')),
    ];
  }
  if (n === 6) {
    const dias = p.obra.plano;
    return [
      it('diario', `Diário dos ${dias.length} dias com fotos`, dias.length > 0 && dias.every((d) => p.obra.diario.some((x) => x.data === d.data && !!x.chegada && !!x.saida && x.fotos.some(existe)))),
      it('checklist', 'Checklist técnico completo', CHAVES_CHECKLIST.every((k) => p.obra.checklist[k] === true)),
      it('equipe', 'Equipe paga com comprovante', (p.obra.equipe.combinado_centavos ?? 0) > 0 && !pend('equipe')),
    ];
  }
  if (n === 7) {
    const fotos = SLOTS_FOTO_ENTREGA.filter((s) => (f.slots.get(s) ?? []).length > 0).length;
    const t = p.entrega.testes;
    const m = p.entrega.monitoramento;
    const tm = p.entrega.termo;
    return [
      it('fotos', `Fotos de tudo pronto (${fotos} de 8)`, fotos === 8),
      it('testes', 'Testes ok', !!t.string1_voc && !!t.string2_voc && t.isolamento_ok && !!t.gerando_kw && t.wifi_ok && t.disjuntores_ok),
      it('monitoramento', 'Monitoramento online', !!m.app && !!m.conta && !!m.serie && m.online && !!p.entrega.cofre),
      it('termo', 'Termo de entrega assinado', !!tm && !!tm.assinado_em && existe(tm.arquivo_id) && (!tm.chk.includes('pend') || !!tm.ressalva)),
    ];
  }
  if (n === 8) {
    const ps = p.liberacao.passos;
    const comArquivo = (x: PassoLiberacao | null): boolean => !!x && !!x.data && existe(x.arquivo_id);
    return [
      it('pedido', 'Pedido com protocolo e print', !!f.jo?.pedido && comArquivo(ps.pedido)),
      it('vistoria', 'Vistoria aprovada', comArquivo(ps.vistoria)),
      it('liberacao', 'Liberação com data e print', comArquivo(ps.liberada)),
      it('dinheiro', 'A receber e a pagar zerados', f.livro.fechamento.pode_fechar_sem_material),
      it('material', `Material com origem, valor e data (${mat.com_origem} de ${mat.total})`, mat.total > 0 && mat.com_origem === mat.total),
    ];
  }
  return [];
}

// ── Os itens que nascem da proposta ─────────────────────────────────────────────────────────────────────────────────────

export const LISTA_PRONTA: ReadonlyArray<{ descricao: string; unidade: 'un' | 'm' | 'par' | 'kit'; tipo: 'estrutura' | 'eletrico' }> = [
  { descricao: 'Trilho de alumínio 4,2 m', unidade: 'un', tipo: 'estrutura' },
  { descricao: 'Gancho para telha cerâmica', unidade: 'un', tipo: 'estrutura' },
  { descricao: 'Gancho para telha de fibrocimento', unidade: 'un', tipo: 'estrutura' },
  { descricao: 'Suporte para laje', unidade: 'un', tipo: 'estrutura' },
  { descricao: 'Grampos e emendas', unidade: 'kit', tipo: 'estrutura' },
  { descricao: 'Cabo solar 6 mm', unidade: 'm', tipo: 'eletrico' },
  { descricao: 'Conector MC4', unidade: 'par', tipo: 'eletrico' },
  { descricao: 'DPS CC', unidade: 'un', tipo: 'eletrico' },
  { descricao: 'DPS CA', unidade: 'un', tipo: 'eletrico' },
  { descricao: 'Disjuntor', unidade: 'un', tipo: 'eletrico' },
  { descricao: 'Eletroduto', unidade: 'm', tipo: 'eletrico' },
  { descricao: 'Caixa de proteção', unidade: 'un', tipo: 'eletrico' },
  { descricao: 'Abraçadeiras', unidade: 'kit', tipo: 'eletrico' },
  { descricao: 'Terminais', unidade: 'kit', tipo: 'eletrico' },
  { descricao: 'Placa de advertência', unidade: 'un', tipo: 'eletrico' },
];

const semAcento = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export type ItemSugerido = Omit<ItemCompra, 'id' | 'criado_por' | 'criado_em'> & { id: null };

/**
 * Os itens da primeira leitura da Compra (sem gravar nada): o kit da proposta (módulos e inversor) e a lista pronta. A estrutura sai pelo telhado
 * do relatório de vistoria: gancho de telha cerâmica, de fibrocimento ou suporte de laje; sem tipo, só trilhos e grampos. `id` é sempre null.
 */
export function itensIniciais(
  equip: { qtdPlacas: number | null; modeloPlaca: string; potPlaca: number | null; qtdInversor: number | null; inversor: string } | null,
  telhado: string,
): ItemSugerido[] {
  const base = {
    compra_id: null, fornecedor: '', valor_centavos: null, data: null, etapa: 4 as const, quantidade: null as number | null, marca: '', modelo: '',
    potencia_w: null, potencia_kw: null, garantia_fabricacao_anos: null, garantia_desempenho_anos: null, garantia_anos: null,
  };
  const out: ItemSugerido[] = [];
  if (equip?.qtdPlacas) {
    out.push({ ...base, id: null, origem: 'proposta', tipo: 'modulo', descricao: `Módulo ${equip.modeloPlaca}${equip.potPlaca ? ` ${equip.potPlaca} W` : ''}`.trim(), quantidade: equip.qtdPlacas, unidade: 'un', modelo: equip.modeloPlaca, potencia_w: equip.potPlaca });
  }
  if (equip && (equip.inversor || equip.qtdInversor)) {
    out.push({ ...base, id: null, origem: 'proposta', tipo: 'inversor', descricao: `Inversor ${equip.inversor}`.trim(), quantidade: equip.qtdInversor, unidade: 'un', modelo: equip.inversor });
  }
  const t = semAcento(telhado);
  const estrutura = t.includes('fibro') ? ['Gancho para telha de fibrocimento'] : t.includes('laje') ? ['Suporte para laje'] : (t.includes('cer') || t.includes('barro')) ? ['Gancho para telha cerâmica'] : [];
  for (const l of LISTA_PRONTA) {
    if (/^(Gancho|Suporte)/.test(l.descricao) && !estrutura.includes(l.descricao)) continue;
    out.push({ ...base, id: null, origem: 'lista', tipo: l.tipo, descricao: l.descricao, unidade: l.unidade });
  }
  return out;
}

// ── A chave de acesso da nota fiscal ────────────────────────────────────────────────────────────────────────────────────

/** 44 dígitos e o dígito verificador (módulo 11, pesos 2 a 9 da direita para a esquerda sobre os 43 primeiros). */
export function chaveNfeValida(ch: unknown): boolean {
  if (typeof ch !== 'string' || !/^\d{44}$/.test(ch)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(ch[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(ch[43]);
}
