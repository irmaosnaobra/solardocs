// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 1 (05/11/2026): as regras PURAS (sem banco e sem relógio). Quem lê e grava o estado é o
// `jornadaSolarBanco.ts`; as rotas estão em `routes/geradorJornadaSolar.ts` e `routes/geradorJornadaNumero.ts`.
//
// NÃO importa rota (ciclo de boot em CommonJS). Importa só `solarObras`, `cadastroVenda` (tipos), `docsCliente`, `trelloVendaSolar`,
// `feriadosBR` e `viradaDoDia`. Nada daqui escreve em log.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { ehAdm, ehSocio, nomeSimples, podeVer } from './solarObras';
import type { Cadastro } from './cadastroVenda';
import { nomeComparavel } from './docsCliente';
import { titularDaVenda } from './trelloVendaSolar';
import { ehFeriadoBR } from '../../utils/feriadosBR';
import { diaDeBrasilia } from '../agenda/viradaDoDia';

// ── Tipos do estado (o contrato do `system_state`, veja `jornadaSolarBanco.ts`) ──────────────────────────────────

export type MotivoEspera = 'cliente' | 'cemig' | 'fornecedor' | 'banco';
export const MOTIVOS_ESPERA: readonly MotivoEspera[] = ['cliente', 'cemig', 'fornecedor', 'banco'];
export const ROTULO_ESPERA: Record<MotivoEspera, string> = { cliente: 'Cliente', cemig: 'Cemig', fornecedor: 'Fornecedor', banco: 'Banco' };

export type FalhaNumero = 'trello' | 'trello_grande' | 'lento' | 'ocupado' | 'sem_credencial' | 'sem_segredo' | 'banco' | 'sequencia' | 'confirmar';
export const FALHAS_NUMERO: readonly FalhaNumero[] = ['trello', 'trello_grande', 'lento', 'ocupado', 'sem_credencial', 'sem_segredo', 'banco', 'sequencia', 'confirmar'];

export const ACOES_HISTORICO = [
  'vendido', 'materializada', 'concluir', 'esperar', 'voltar', 'cancelar', 'descancelar', 'papel_contrato', 'papel_procuracao', 'papel_recibo',
  'excedente', 'rateio', 'protocolo', 'engenheiro', 'trello', 'numero', 'numero_falhou',
] as const;
export type AcaoHistorico = typeof ACOES_HISTORICO[number];

export type TipoPapel = 'contrato' | 'procuracao' | 'recibo';
export const TIPOS_PAPEL: readonly TipoPapel[] = ['contrato', 'procuracao', 'recibo'];

export interface PapelGerado { gerado_em: string; por: string }
export interface EtapaBase { aberta_em: string | null; concluida_em: string | null; concluida_por: string }
export interface Etapa1 extends EtapaBase { excedente: 'sim' | 'nao' | null }
export interface Etapa2 extends EtapaBase { papeis: Record<TipoPapel, PapelGerado | null> }
export interface Etapa3 extends EtapaBase {
  rateio: { conferido_em: string; por: string; marca: string } | null;
  protocolo: { numero: string; em: string } | null;
  engenheiro: 'pago' | 'a_pagar' | null;
  trello: { url: string; criado_em: string; por: string } | null;
}
export interface EstadoJornada {
  v: 1;
  card: number;
  origem: 'vendido' | 'leitura';
  vendido_em: string | null;
  vendido_por: string;
  vendedor: string;
  etapas: { 1: Etapa1; 2: Etapa2; 3: Etapa3; 4: { aberta_em: string | null } };
  esperando: { motivo: MotivoEspera; ate: string; etapa: 1 | 2 | 3; em: string; por: string } | null;
  cancelada: { em: string; por: string; etapa: number; com_numero: boolean } | null;
  numero: { tentado_em: string | null; falha: FalhaNumero | null; nasceu_em: string | null };
  historico: Array<{ em: string; por: string; acao: AcaoHistorico; etapa: number | null }>;
}

/** O JSON privado (bucket `cadastros-venda`): dinheiro e texto livre. Nunca no `system_state`. */
export const FORMAS_PAGAMENTO = ['pix', 'ted', 'boleto', 'cartao', 'financiamento', 'dinheiro'] as const;
export type FormaPagamento = typeof FORMAS_PAGAMENTO[number];
export interface PrivadoJornada {
  v: 1;
  venda: {
    valor_centavos: number;
    pagamento: Array<{ forma: FormaPagamento; valor_centavos: number; obs: string }>;
    desconto_centavos: number | null;
    prazo_prometido: string;
    nota: string;
    kit_confirmado: boolean;
    combinado_por: string;
    combinado_em: string;
    editado: Array<{ em: string; por: string; campos: string[] }>;
  } | null;
  cancelamento: { motivo: string; em: string; por: string } | null;
  descancelamentos: Array<{ motivo: string; em: string; por: string }>;
}

// ── Etapas e donos ───────────────────────────────────────────────────────────────────────────────────────────────

export const NOMES_ETAPA = ['', 'Venda', 'Contrato e pagamento', 'Homologação', 'Compra', 'Logística', 'Obra', 'Entrega da obra', 'Pedido de vistoria e liberação', 'Pós-venda'];
export const CURTOS_ETAPA = ['', 'Venda', 'Contrato', 'Homologação', 'Compra', 'Logística', 'Obra', 'Entrega', 'Liberação', 'Pós-venda'];
/** Donos fixos (SPEC 2). 'vendedor' = quem vendeu (o `vendedor` do estado, senão o `vendedor_nome` do card). */
export const DONOS_ETAPA: Record<number, readonly string[] | 'vendedor'> = {
  1: 'vendedor', 2: ['giovanna'], 3: ['thiago'], 4: ['thiago', 'diego'], 5: ['diego'], 6: ['diego'], 7: ['diego'], 8: ['thiago'], 9: 'vendedor',
};
/** Quem conclui a etapa 4 é o Thiago (SPEC 2). */
export const CONCLUI_ETAPA: Record<number, readonly string[] | 'vendedor'> = { ...DONOS_ETAPA, 4: ['thiago'] };
/** Donos de etapa em TODAS as obras: veem todas (SPEC 15, 18.1 item 1). */
export const DONOS_FIXOS: ReadonlySet<string> = new Set(['giovanna', 'thiago', 'diego']);
export const ETAPAS_DA_FASE_1 = [1, 2, 3] as const;

const minusc = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export function donosDaEtapa(n: number, vendedor: string): string[] {
  const d = DONOS_ETAPA[n];
  if (d === undefined) return [];
  if (d === 'vendedor') { const v = nomeSimples(vendedor); return v ? [v] : []; }
  return [...d];
}

/** As duas primeiras letras em maiúscula ("NI", "GI", "TH", "DI"). */
export function iniciais(nome: string): string {
  return nomeSimples(nome).replace(/[^a-z]/g, '').slice(0, 2).toUpperCase();
}

/** Quem enxerga esta obra. Recebe o vendedor do CARD (ou da planilha), nunca de um campo do estado que o usuário escreve. */
export function veObra(nome: string, vendedor: string): boolean {
  const n = minusc(nome);
  return ehAdm(n) || ehSocio(n) || DONOS_FIXOS.has(n) || podeVer(n, vendedor);
}

export function podeConcluir(nome: string, n: number, vendedor: string): boolean {
  const meu = minusc(nome);
  const c = CONCLUI_ETAPA[n];
  if (c === undefined) return false;
  const lista = c === 'vendedor' ? (nomeSimples(vendedor) ? [nomeSimples(vendedor)] : []) : [...c];
  if (lista.length === 0) return ehAdm(meu);
  return lista.includes(meu);
}

// ── Dias úteis e prazos ────────────────────────────────────────────────────────────────────────────────────────

const ymdMais = (ymd: string, dias: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
export const ehDiaUtil = (ymd: string): boolean => {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5 && !ehFeriadoBR(ymd);
};
export function somarDiasUteis(dia: string, n: number): string {
  let d = dia;
  let falta = n;
  for (let guarda = 0; falta > 0 && guarda < 4000; guarda++) {
    d = ymdMais(d, 1);
    if (ehDiaUtil(d)) falta--;
  }
  return d;
}
/** Quantos dias úteis `d` com `de < d <= ate`. */
export function diasUteisDepois(de: string, ate: string): number {
  let n = 0;
  let d = de;
  for (let guarda = 0; d < ate && guarda < 4000; guarda++) {
    d = ymdMais(d, 1);
    if (d <= ate && ehDiaUtil(d)) n++;
  }
  return n;
}
export const ddmm = (ymd: string): string => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

export function prazoDaEtapa(n: number, e: EstadoJornada | null): { vence: string | null; rotulo: string } {
  if (!e) return { vence: null, rotulo: '' };
  if (n === 1) {
    const base = e.vendido_em ?? e.etapas[1].aberta_em;
    return base ? { vence: somarDiasUteis(diaDeBrasilia(base), 2), rotulo: 'Prazo' } : { vence: null, rotulo: '' };
  }
  if (n === 2) {
    const base = e.etapas[2].aberta_em;
    return base ? { vence: somarDiasUteis(diaDeBrasilia(base), 3), rotulo: 'Prazo' } : { vence: null, rotulo: '' };
  }
  if (n === 3) {
    const p = e.etapas[3].protocolo;
    if (p) return { vence: somarDiasUteis(p.em, 15), rotulo: 'Prazo da Cemig' };
    const base = e.etapas[3].aberta_em;
    return base ? { vence: somarDiasUteis(diaDeBrasilia(base), 2), rotulo: 'Protocolar até' } : { vence: null, rotulo: '' };
  }
  return { vence: null, rotulo: '' };
}

export type TipoSituacao = 'esperando' | 'sem_prazo' | 'no_prazo' | 'vence_hoje' | 'atrasada' | 'travada';
export interface Situacao { tipo: TipoSituacao; texto: string; vence?: string; dias?: number }

export function situacao(n: number, e: EstadoJornada | null, hoje: string): Situacao {
  if (!e || e.cancelada) return { tipo: 'sem_prazo', texto: '' };
  const esp = e.esperando && e.esperando.etapa === n ? e.esperando : null;
  if (esp && hoje < esp.ate) return { tipo: 'esperando', texto: `Esperando até ${ddmm(esp.ate)} · ${ROTULO_ESPERA[esp.motivo]}` };
  const { vence } = prazoDaEtapa(n, e);
  if (!vence) return { tipo: 'sem_prazo', texto: 'Sem prazo' };
  const alvo = esp && esp.ate > vence ? esp.ate : vence;
  if (hoje < alvo) return { tipo: 'no_prazo', texto: `No prazo · vence ${ddmm(alvo)}`, vence: alvo };
  if (hoje === alvo) return { tipo: 'vence_hoje', texto: 'Vence hoje', vence: alvo };
  const atraso = Math.max(1, diasUteisDepois(alvo, hoje));
  const dias = `${atraso} ${atraso === 1 ? 'dia' : 'dias'}`;
  return atraso >= 3
    ? { tipo: 'travada', texto: `Atrasada ${dias} · Travada`, vence: alvo, dias: atraso }
    : { tipo: 'atrasada', texto: `Atrasada ${dias}`, vence: alvo, dias: atraso };
}

// ── Rateio ────────────────────────────────────────────────────────────────────────────────────────────────────────

const valorDe = (cad: Cadastro, k: string): string => String((cad.campos as Record<string, { valor?: string } | undefined>)[k]?.valor ?? '').trim();
const numeroBR = (s: string): number | null => {
  const t = String(s ?? '').trim().replace('%', '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

export interface LinhaRateio { papel: 'geradora' | 'beneficiaria'; uc: string; titular: string; endereco: string; pct: number | null }

export function rateioDoCadastro(cad: Cadastro): LinhaRateio[] {
  const linhas: LinhaRateio[] = [{
    papel: 'geradora', uc: valorDe(cad, 'unidade_consumidora'), titular: valorDe(cad, 'titular_conta') || titularDaVenda(cad),
    endereco: valorDe(cad, 'endereco_ponto'), pct: numeroBR(valorDe(cad, 'geradora_pct')),
  }];
  for (let i = 1; i <= 5; i++) {
    const uc = valorDe(cad, `benef_${i}_uc`);
    if (!uc) continue;
    linhas.push({ papel: 'beneficiaria', uc, titular: valorDe(cad, `benef_${i}_titular`), endereco: valorDe(cad, `benef_${i}_endereco`), pct: numeroBR(valorDe(cad, `benef_${i}_pct`)) });
  }
  return linhas;
}
export function totalDoRateio(linhas: readonly { pct: number | null }[]): number {
  return Math.round(linhas.reduce((a, l) => a + (l.pct ?? 0), 0) * 100) / 100;
}
/** Os 16 primeiros hex do sha256 do que o rateio tem de relevante: se mudar depois da conferência, a conferência vale zero. */
export function marcaDoRateio(cad: Cadastro): string {
  const dados: string[] = [valorDe(cad, 'geradora_pct')];
  for (let i = 1; i <= 5; i++) {
    const uc = valorDe(cad, `benef_${i}_uc`);
    if (uc) dados.push(uc, valorDe(cad, `benef_${i}_pct`));
  }
  return crypto.createHash('sha256').update(JSON.stringify(dados)).digest('hex').slice(0, 16);
}

// ── O que cada etapa pede para concluir ────────────────────────────────────────────────────────────────────────────

export interface ItemEtapa { chave: string; bloco: 'venda' | 'fotos' | 'documentos' | 'portao'; texto: string; feito: boolean }
export interface EntradaItens {
  lig: { proposta: string | null; venda: string | null; trello_card?: string | null };
  /** Slots com arquivo no card MAIS os do dossiê da proposta ligada. */
  slots: ReadonlySet<string>;
  cad: Cadastro;
  privado: PrivadoJornada | null;
  estado: EstadoJornada | null;
}

export function valorPagamentoFecha(v: PrivadoJornada['venda']): boolean {
  if (!v || !(v.valor_centavos > 0) || v.pagamento.length < 1) return false;
  return v.pagamento.reduce((a, p) => a + p.valor_centavos, 0) === v.valor_centavos;
}

/** O excedente 'sim' fecha? Devolve o texto do que falta, ou null quando está tudo certo. */
function faltaDoExcedente(f: EntradaItens): string | null {
  const ex = f.estado?.etapas[1].excedente ?? null;
  if (ex === 'nao') return null;
  if (ex === null) return 'Diga se tem excedente para outras contas';
  const geradora = valorDe(f.cad, 'titular_conta') || titularDaVenda(f.cad);
  const bens = rateioDoCadastro(f.cad).filter((l) => l.papel === 'beneficiaria');
  if (bens.length === 0) return 'Cadastre ao menos uma conta que recebe o excedente';
  const alvo = nomeComparavel(geradora);
  if (bens.some((b) => !b.titular || nomeComparavel(b.titular) !== alvo)) return `Todas as contas do excedente no nome de ${geradora}`;
  return null;
}

export function itensDaEtapa(n: number, f: EntradaItens): ItemEtapa[] {
  const tem = (s: string): boolean => f.slots.has(s);
  if (n === 1) {
    const v = f.privado?.venda ?? null;
    const falta = faltaDoExcedente(f);
    return [
      { chave: 'proposta', bloco: 'venda', texto: 'Proposta aceita ligada', feito: !!f.lig.proposta },
      { chave: 'kit', bloco: 'venda', texto: 'Kit confirmado', feito: v?.kit_confirmado === true },
      { chave: 'valor', bloco: 'venda', texto: 'Valor e forma de pagamento', feito: valorPagamentoFecha(v) },
      { chave: 'prazo', bloco: 'venda', texto: 'Prazo prometido ao cliente', feito: !!v && v.prazo_prometido.trim().length > 0 },
      { chave: 'fachada', bloco: 'fotos', texto: 'Foto da fachada', feito: tem('fachada') },
      { chave: 'padrao', bloco: 'fotos', texto: 'Foto do padrão de entrada', feito: tem('padrao') },
      { chave: 'disjuntor', bloco: 'fotos', texto: 'Foto do disjuntor', feito: tem('disjuntor') },
      { chave: 'medidor', bloco: 'fotos', texto: 'Foto do medidor', feito: tem('medidor') },
      { chave: 'conta_luz', bloco: 'documentos', texto: 'Conta de luz', feito: tem('conta_luz') },
      { chave: 'documento', bloco: 'documentos', texto: 'CNH ou documento com foto', feito: tem('documento_titular') || tem('documento_titular_uc') },
      { chave: 'email', bloco: 'documentos', texto: 'E-mail do cliente', feito: !!valorDe(f.cad, 'email') },
      { chave: 'excedente', bloco: 'documentos', texto: falta ?? 'Excedente para outras contas', feito: falta === null },
    ];
  }
  if (n === 2) {
    return [
      { chave: 'contrato_assinado', bloco: 'portao', texto: 'Contrato assinado anexado', feito: tem('contrato_assinado') },
      { chave: 'procuracao', bloco: 'portao', texto: 'Procuração assinada anexada', feito: tem('procuracao') },
    ];
  }
  if (n === 3) {
    const itens: ItemEtapa[] = [];
    if (f.estado?.etapas[1].excedente === 'sim') {
      const r = f.estado.etapas[3].rateio;
      itens.push({ chave: 'rateio', bloco: 'portao', texto: 'Rateio do excedente conferido', feito: !!r && r.marca === marcaDoRateio(f.cad) });
    }
    itens.push(
      { chave: 'trello', bloco: 'portao', texto: 'Cartão do Trello criado', feito: !!f.estado?.etapas[3].trello || !!f.lig.trello_card },
      { chave: 'art', bloco: 'portao', texto: 'ART com documento e comprovante', feito: tem('art') && tem('art_comprovante') },
      { chave: 'protocolo', bloco: 'portao', texto: 'Protocolo com número e print', feito: !!f.estado?.etapas[3].protocolo?.numero && tem('protocolo') },
      { chave: 'parecer', bloco: 'portao', texto: 'Parecer de acesso aprovado anexado', feito: tem('parecer_acesso') },
    );
    return itens;
  }
  return [];
}

// ── Comissões (só cálculo e exibição, SPEC 3.4) ───────────────────────────────────────────────────────────────────────

export interface LinhaComissao { nome: string; papel: 'venda' | 'socio'; pb: number; valor_centavos: number; onde: 'custo' | 'retirada' }

export function comissoesDaVenda(vendedor: string, valorCentavos: number): { linhas: LinhaComissao[]; aviso: string | null } {
  const v = nomeSimples(vendedor);
  const valor = Number.isFinite(valorCentavos) && valorCentavos > 0 ? Math.round(valorCentavos) : 0;
  const mk = (nome: string, papel: 'venda' | 'socio', pb: number, onde: 'custo' | 'retirada'): LinhaComissao =>
    ({ nome, papel, pb, valor_centavos: Math.round(valor * pb / 10000), onde });
  let aviso: string | null = null;
  let linhas: LinhaComissao[];
  if (v === 'nilce') linhas = [mk('nilce', 'venda', 500, 'custo'), mk('thiago', 'socio', 200, 'retirada'), mk('diego', 'socio', 200, 'retirada')];
  else if (v === 'diego') linhas = [mk('diego', 'venda', 500, 'custo'), mk('diego', 'socio', 200, 'retirada'), mk('thiago', 'socio', 200, 'retirada')];
  else if (v === 'thiago') linhas = [mk('thiago', 'venda', 500, 'custo'), mk('thiago', 'socio', 200, 'retirada'), mk('diego', 'socio', 200, 'retirada')];
  else if (v === 'giovanna') linhas = [mk('giovanna', 'venda', 300, 'custo'), mk('thiago', 'socio', 200, 'retirada'), mk('diego', 'socio', 200, 'retirada')];
  else {
    linhas = [mk(v || 'vendedor', 'venda', 500, 'custo'), mk('thiago', 'socio', 200, 'retirada'), mk('diego', 'socio', 200, 'retirada')];
    aviso = 'Regra padrão. Confirme com o Thiago.';
  }
  return { linhas, aviso };
}

// ── A venda antiga, sem estado (SPEC 3.6) ──────────────────────────────────────────────────────────────────────────

export type TrilhoVenda = 'jornada' | 'deduzida' | 'sem_trilho' | 'planilha';
export interface Deducao { trilho: 'deduzida' | 'sem_trilho'; etapa: number | null; posvenda: boolean }

export function deduzirEtapa(a: {
  temNumero: boolean; slots: ReadonlySet<string>; planilha?: string; planilhaFora?: boolean;
}): Deducao {
  const tem = (s: string): boolean => a.slots.has(s);
  const doisPapeis = tem('contrato_assinado') && tem('procuracao');
  const pl = a.planilha;
  if (pl === 'concluida') return { trilho: 'deduzida', etapa: 9, posvenda: true };
  if (pl === 'vistoria' || pl === 'liberado') return { trilho: 'deduzida', etapa: 8, posvenda: false };
  if (pl === 'instalacao') return { trilho: 'deduzida', etapa: 6, posvenda: false };
  if (pl === 'material') return { trilho: 'deduzida', etapa: 4, posvenda: false };
  if (pl === 'projeto') return { trilho: 'deduzida', etapa: 3, posvenda: false };
  if (a.temNumero) {
    if (a.planilhaFora) return { trilho: 'sem_trilho', etapa: null, posvenda: false };
    return doisPapeis ? { trilho: 'deduzida', etapa: 3, posvenda: false } : { trilho: 'sem_trilho', etapa: null, posvenda: false };
  }
  const fotos = tem('fachada') && tem('padrao') && tem('disjuntor') && tem('medidor') && tem('conta_luz') && (tem('documento_titular') || tem('documento_titular_uc'));
  return { trilho: 'deduzida', etapa: doisPapeis || fotos ? 2 : 1, posvenda: false };
}

const vazioEtapa = (): EtapaBase => ({ aberta_em: null, concluida_em: null, concluida_por: '' });

/** O estado de uma obra que ainda não tinha (venda antiga ou nascida sem a rota nova): etapas anteriores concluídas agora. */
export function estadoMaterializado(card: number, vendedor: string, etapa: number, agora: string): EstadoJornada {
  const n = Math.min(Math.max(etapa, 1), 4);
  const fecha = (e: EtapaBase, i: number): EtapaBase => (i < n ? { aberta_em: agora, concluida_em: agora, concluida_por: 'leitura' } : i === n ? { ...e, aberta_em: agora } : e);
  const e1 = fecha(vazioEtapa(), 1);
  const e2 = fecha(vazioEtapa(), 2);
  const e3 = fecha(vazioEtapa(), 3);
  return {
    v: 1, card, origem: 'leitura', vendido_em: null, vendido_por: '', vendedor: nomeSimples(vendedor),
    etapas: {
      1: { ...e1, excedente: null },
      2: { ...e2, papeis: { contrato: null, procuracao: null, recibo: null } },
      3: { ...e3, rateio: null, protocolo: null, engenheiro: null, trello: null },
      4: { aberta_em: n >= 4 ? agora : null },
    },
    esperando: null, cancelada: null,
    numero: { tentado_em: null, falha: null, nasceu_em: null },
    historico: [{ em: agora, por: 'leitura', acao: 'materializada', etapa: n }],
  };
}

/** A etapa atual do estado: a primeira não concluída de 1 a 3, ou 4 (aberta) quando as três estão concluídas. */
export function etapaAtualDoEstado(e: EstadoJornada): number {
  if (!e.etapas[1].concluida_em) return 1;
  if (!e.etapas[2].concluida_em) return 2;
  if (!e.etapas[3].concluida_em) return 3;
  return 4;
}
