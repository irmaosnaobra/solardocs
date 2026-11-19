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
import { titularDaVenda, type EquipamentoProposta } from './trelloVendaSolar';
import type { BancoObra, VistoriaObra } from './jornadaObra';
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
  'excedente', 'rateio', 'protocolo', 'engenheiro', 'trello', 'numero', 'numero_falhou', 'venda_completa', 'trazida', 'trello_auto_parou', 'trello_auto_arquivado',
] as const;
export type AcaoHistorico = typeof ACOES_HISTORICO[number];

export type TipoPapel = 'contrato' | 'procuracao' | 'recibo';
export const TIPOS_PAPEL: readonly TipoPapel[] = ['contrato', 'procuracao', 'recibo'];

export interface PapelGerado { gerado_em: string; por: string }
export interface EtapaBase { aberta_em: string | null; concluida_em: string | null; concluida_por: string }
/** Confirmação de um dado da etapa 1: `marca` é o hash do valor no momento (mudou o valor, a confirmação deixa de valer). */
export interface Confirmacao { em: string; por: string; marca: string }
export interface Etapa1 extends EtapaBase {
  excedente: 'sim' | 'nao' | null;
  /** Precisa de proposta de banco ou financiamento? Só existe depois de respondido. */
  financiamento?: 'sim' | 'nao';
  /** Placas e inversor escritos à mão quando a proposta ligada não traz marca ou quantidade (3 a 120 caracteres). A confirmação vale sobre este texto. */
  kit_texto?: { placas?: string; inversor?: string };
  confirmados?: Record<string, Confirmacao>;
  /** Pedidos ao cliente ticados à mão (o arquivo do slot também vale, sem tique). */
  pedidos?: Record<string, { em: string; por: string }>;
}
export interface Etapa2 extends EtapaBase { papeis: Record<TipoPapel, PapelGerado | null> }
export interface Etapa3 extends EtapaBase {
  rateio: { conferido_em: string; por: string; marca: string } | null;
  protocolo: { numero: string; em: string } | null;
  engenheiro: 'pago' | 'a_pagar' | null;
  /** `completado_em`: o Trello automático já completou este cartão (anexos, checklist e ficha) com as 3 fases fechadas; uma vez só. */
  trello: { url: string; criado_em: string; por: string; completado_em?: string } | null;
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
  /** "Trazer para a jornada" (venda finalizada que o ADM reabriu): o motivo de cada vez. */
  trazidas: Array<{ motivo: string; em: string; por: string }>;
}

// ── Etapas e donos ───────────────────────────────────────────────────────────────────────────────────────────────

export const NOMES_ETAPA = ['', 'Venda', 'Assinaturas e vistoria', 'Homologação', 'Compra', 'Logística', 'Obra', 'Entrega da obra', 'Pedido de vistoria e liberação', 'Pós-venda'];
export const CURTOS_ETAPA = ['', 'Venda', 'Assinaturas', 'Homologação', 'Compra', 'Logística', 'Obra', 'Entrega', 'Liberação', 'Pós-venda'];
/** Donos fixos (SPEC 2). 'vendedor' = quem vendeu (o `vendedor` do estado, senão o `vendedor_nome` do card). */
export const DONOS_ETAPA: Record<number, readonly string[] | 'vendedor'> = {
  1: 'vendedor', 2: ['giovanna'], 3: ['thiago'], 4: ['thiago', 'diego'], 5: ['diego'], 6: ['diego'], 7: ['diego'], 8: ['thiago'], 9: 'vendedor',
};
/** Quem conclui a etapa 4 é o Thiago (SPEC 2). */
export const CONCLUI_ETAPA: Record<number, readonly string[] | 'vendedor'> = { ...DONOS_ETAPA, 4: ['thiago'] };
/** Donos de etapa em TODAS as obras: veem todas (SPEC 15, 18.1 item 1). */
export const DONOS_FIXOS: ReadonlySet<string> = new Set(['giovanna', 'thiago', 'diego']);
export const ETAPAS_DA_FASE_1 = [1, 2, 3] as const;

/** Quem NÃO é gente no histórico: a leitura (materialização), a sonda e o vazio. Os robôs e o corte da Jornada usam a mesma lista. */
export const POR_QUE_NAO_E_GENTE: ReadonlySet<string> = new Set(['leitura', 'sonda', '']);

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

/**
 * O miolo da situação: o prazo (`vence`), a espera da etapa, a obra cancelada e o dia de hoje. Extraído do `situacao` na Fase 2 da Jornada
 * (06/11/2026) para as etapas 4 a 8 usarem a MESMA conta, com o prazo e a espera que moram em outro estado.
 */
export function situacaoComPrazo(
  vence: string | null, esp: { motivo: MotivoEspera; ate: string } | null, cancelada: boolean, hoje: string,
): Situacao {
  if (cancelada) return { tipo: 'sem_prazo', texto: '' };
  if (esp && hoje < esp.ate) return { tipo: 'esperando', texto: `Esperando até ${ddmm(esp.ate)} · ${ROTULO_ESPERA[esp.motivo]}` };
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

export function situacao(n: number, e: EstadoJornada | null, hoje: string): Situacao {
  if (!e || e.cancelada) return { tipo: 'sem_prazo', texto: '' };
  const esp = e.esperando && e.esperando.etapa === n ? e.esperando : null;
  return situacaoComPrazo(prazoDaEtapa(n, e).vence, esp, false, hoje);
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

export interface ItemEtapa { chave: string; bloco: 'cliente' | 'venda' | 'papeis' | 'pedidos' | 'excedente' | 'vistoria' | 'anexos' | 'fotos' | 'documentos' | 'portao' | 'equipamento' | 'pendentes'; texto: string; feito: boolean }
export interface EntradaItens {
  /** O kit da proposta ligada (placas e inversor, para confirmar) e a obra privada (vistoria e proposta de banco). Sem eles os itens que dependem ficam por fazer. */
  equip?: EquipamentoProposta | null;
  obra?: { vistoria: VistoriaObra | null; banco: BancoObra | null } | null;
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

/**
 * O bloco Venda da etapa 1 está completo? É o mesmo `every` do bloco `venda` de `itensDaEtapa(1)` (proposta ligada, valor e forma de
 * pagamento que fecham, prazo prometido). O kit NÃO conta: ele é confirmado na Fase 3 (etapa 3). O aviso de venda nasce na primeira vez
 * em que isto vira verdadeiro.
 */
export function blocoVendaCompleto(lig: { proposta: string | null }, privado: PrivadoJornada | null): boolean {
  return !!lig.proposta && valorPagamentoFecha(privado?.venda ?? null) && !!privado?.venda?.prazo_prometido.trim();
}

export const MSG_EXCEDENTE_OUTRO_CPF = 'Conta do excedente em outro CPF. Peça ao cliente para passar para o mesmo CPF.';
const soDigitos = (s: string): string => s.replace(/\D/g, '');

/**
 * Conferência de CPF/CNPJ do excedente: compara SÓ DÍGITOS o documento de cada beneficiária (`benef_n_doc`) com o de quem fica com a usina
 * (o titular da homologação `tuc_cpf_cnpj`, se a homologação é de outra pessoa; senão o contratante `cpf_cnpj`). `ok: null` = sem documento dos
 * dois lados em nenhuma beneficiária (cai na regra de nome); `false` = alguma diverge; `true` = todas as que têm documento batem.
 */
export function excedenteCpf(cad: Cadastro, tem: boolean): { ok: boolean | null; texto: string | null } {
  if (!tem) return { ok: null, texto: null };
  const dono = soDigitos(valorDe(cad, valorDe(cad, 'homologacao_mesmo') === 'outra_pessoa' ? 'tuc_cpf_cnpj' : 'cpf_cnpj'));
  if (!dono) return { ok: null, texto: null };
  let comparou = false;
  for (let i = 1; i <= 5; i++) {
    if (!valorDe(cad, `benef_${i}_uc`)) continue;
    const doc = soDigitos(valorDe(cad, `benef_${i}_doc`));
    if (!doc) continue;
    comparou = true;
    if (doc !== dono) return { ok: false, texto: MSG_EXCEDENTE_OUTRO_CPF };
  }
  return comparou ? { ok: true, texto: null } : { ok: null, texto: null };
}

/** O excedente 'sim' fecha? Devolve o texto do que falta, ou null quando está tudo certo. */
function faltaDoExcedente(f: EntradaItens): string | null {
  const ex = f.estado?.etapas[1].excedente ?? null;
  if (ex === 'nao') return null;
  if (ex === null) return 'Diga se tem excedente para outras contas';
  const geradora = valorDe(f.cad, 'titular_conta') || titularDaVenda(f.cad);
  const bens = rateioDoCadastro(f.cad).filter((l) => l.papel === 'beneficiaria');
  if (bens.length === 0) return 'Cadastre ao menos uma conta que recebe o excedente';
  const cpf = excedenteCpf(f.cad, true);
  if (cpf.ok === false) return cpf.texto;
  const alvo = nomeComparavel(geradora);
  // Beneficiária com CPF conferido (igual) não precisa bater o nome; sem CPF, a regra de nome de sempre.
  const donoDigitos = soDigitos(valorDe(f.cad, valorDe(f.cad, 'homologacao_mesmo') === 'outra_pessoa' ? 'tuc_cpf_cnpj' : 'cpf_cnpj'));
  const idx = (uc: string): number => [1, 2, 3, 4, 5].find((i) => valorDe(f.cad, `benef_${i}_uc`) === uc) ?? 0;
  const foraDoNome = bens.filter((b) => {
    const doc = soDigitos(valorDe(f.cad, `benef_${idx(b.uc)}_doc`));
    if (doc && donoDigitos && doc === donoDigitos) return false;
    return !b.titular || nomeComparavel(b.titular) !== alvo;
  });
  if (foraDoNome.length) return `Todas as contas do excedente no nome de ${geradora}`;
  return null;
}

// ── Confirmação, pedidos, vistoria ──────────────────────────────────────────────────────────────────────────────

/** Os itens da etapa 1 que a pessoa CONFIRMA (valor presente e conferido com o cliente). A confirmação vale só enquanto o valor não muda. */
export const CHAVES_CONFIRMAR = ['nome', 'telefone', 'endereco', 'endereco_usina', 'email', 'placas', 'inversor', 'valor', 'pagamento'] as const;
export type ChaveConfirmar = typeof CHAVES_CONFIRMAR[number];
export const ehChaveConfirmar = (x: unknown): x is ChaveConfirmar => CHAVES_CONFIRMAR.includes(x as ChaveConfirmar);

/** Pedido ao cliente, ticado à mão (estado e PATCH continuam; deixou de ser item da etapa 1: os documentos e fotos fecham pelo arquivo). */
export const CHAVES_PEDIDO = ['pedido_cnh', 'pedido_conta_luz', 'pedido_fachada', 'pedido_padrao', 'pedido_disjuntor', 'pedido_medidor'] as const;
export type ChavePedido = typeof CHAVES_PEDIDO[number];
export const ehChavePedido = (x: unknown): x is ChavePedido => CHAVES_PEDIDO.includes(x as ChavePedido);
export const TEXTO_KIT_MIN = 3;
export const TEXTO_KIT_MAX = 120;
/** A proposta ligada traz o dado completo (placas: quantidade e marca; inversor: quantidade e marca)? */
export function kitCompleto(chave: 'placas' | 'inversor', e: EquipamentoProposta | null | undefined): boolean {
  if (!e) return false;
  return chave === 'placas' ? !!(e.qtdPlacas && e.modeloPlaca) : !!(e.qtdInversor && e.inversor);
}

/** O valor atual do item de confirmação, em texto estável ('' = falta o dado). Serve só para a marca: nunca vai para log. */
export function valorConfirmavel(chave: ChaveConfirmar, f: EntradaItens): string {
  const v = f.privado?.venda ?? null;
  switch (chave) {
    case 'nome': return valorDe(f.cad, 'nome');
    case 'telefone': return valorDe(f.cad, 'telefone');
    case 'email': return valorDe(f.cad, 'email');
    case 'endereco_usina': return valorDe(f.cad, 'endereco_ponto');
    case 'endereco': {
      const p = ['endereco', 'bairro', 'cidade', 'uf', 'cep'].map((k) => valorDe(f.cad, k));
      return p[0] && p[2] && p[3] ? p.join('|') : '';
    }
    case 'placas': case 'inversor': {
      // Com dado na proposta vale o da proposta; sem ele, o texto que a pessoa escreveu (a confirmação é sobre esse texto).
      if (kitCompleto(chave, f.equip)) {
        const e = f.equip!;
        return chave === 'placas' ? `${e.qtdPlacas}|${e.modeloPlaca}|${e.potPlaca ?? ''}` : `${e.qtdInversor}|${e.inversor}`;
      }
      const t = f.estado?.etapas[1].kit_texto?.[chave]?.trim() ?? '';
      return t.length >= TEXTO_KIT_MIN && t.length <= TEXTO_KIT_MAX ? `texto|${t}` : '';
    }
    case 'valor': return v && v.valor_centavos > 0 ? String(v.valor_centavos) : '';
    case 'pagamento': return valorPagamentoFecha(v) ? JSON.stringify(v!.pagamento) : '';
  }
}
export const marcaDoValor = (chave: string, valor: string): string => crypto.createHash('sha256').update(`${chave}|${valor}`).digest('hex').slice(0, 16);

/** A confirmação existe E bate com o valor de agora (mudou o valor = volta a pedir). */
export function confirmacaoValida(chave: ChaveConfirmar, f: EntradaItens): boolean {
  const c = f.estado?.etapas[1].confirmados?.[chave];
  const v = valorConfirmavel(chave, f);
  return !!c && !!v && c.marca === marcaDoValor(chave, v);
}
/** Só as confirmações que ainda valem, para a tela. */
export function confirmadosValidos(f: EntradaItens): Record<string, { em: string; por: string }> {
  const r: Record<string, { em: string; por: string }> = {};
  for (const k of CHAVES_CONFIRMAR) if (confirmacaoValida(k, f)) { const c = f.estado!.etapas[1].confirmados![k]; r[k] = { em: c.em, por: c.por }; }
  return r;
}

/** Os campos de texto, data e escolha da vistoria (jornadaObra.ts, `VistoriaObra`): data, quem, acomp, concl, obs, telhado, entrada e inversor. Fotos e adequações NÃO contam. */
const CAMPOS_VISTORIA = {
  raiz: ['data', 'quem', 'acomp', 'concl', 'obs'],
  telhado: ['tipo', 'estado', 'orient', 'incl', 'area', 'sombra', 'estr', 'acesso'],
  entrada: ['padrao', 'tensao', 'disj', 'apto', 'aterr', 'quadro'],
  inversor: ['local', 'dist', 'abrig', 'wifi'],
} as const;
export function vistoriaPct(v: VistoriaObra | null): number {
  const cheio = (x: unknown): boolean => typeof x === 'string' && x.trim().length > 0;
  const total = CAMPOS_VISTORIA.raiz.length + CAMPOS_VISTORIA.telhado.length + CAMPOS_VISTORIA.entrada.length + CAMPOS_VISTORIA.inversor.length;
  if (!v) return 0;
  let feitos = CAMPOS_VISTORIA.raiz.filter((k) => cheio(v[k])).length;
  for (const g of ['telhado', 'entrada', 'inversor'] as const) feitos += CAMPOS_VISTORIA[g].filter((k) => cheio((v[g] as Record<string, unknown> | undefined)?.[k])).length;
  return Math.floor((feitos * 100) / total);
}
/** A proposta de banco está preenchida? O PDF dela é montado no navegador (não há registro de geração): vale o que a tela exige, banco, agência e conta. */
export const bancoPreenchido = (b: BancoObra | null | undefined): boolean => !!b && !!b.banco.trim() && !!b.agencia.trim() && !!b.conta.trim();

export function itensDaEtapa(n: number, f: EntradaItens): ItemEtapa[] {
  const tem = (s: string): boolean => f.slots.has(s);
  if (n === 1) {
    // Fase 1 (Venda): cliente, venda, papéis gerados, documentos e fotos do cliente e excedente. Os dados "confirmados" só fecham com a marca em dia.
    const e1 = f.estado?.etapas[1];
    const papeis = f.estado?.etapas[2].papeis ?? null;
    const conf = (k: ChaveConfirmar): boolean => !!valorConfirmavel(k, f) && confirmacaoValida(k, f);
    const v = f.privado?.venda ?? null;
    const falta = faltaDoExcedente(f);
    const fin = e1?.financiamento ?? null;
    const itens: ItemEtapa[] = [
      { chave: 'nome', bloco: 'cliente', texto: 'Nome completo', feito: conf('nome') },
      { chave: 'telefone', bloco: 'cliente', texto: 'Telefone de contato', feito: conf('telefone') },
      { chave: 'endereco', bloco: 'cliente', texto: 'Endereço completo', feito: conf('endereco') },
      { chave: 'endereco_usina', bloco: 'cliente', texto: 'Endereço da usina', feito: conf('endereco_usina') },
      { chave: 'email', bloco: 'cliente', texto: 'E-mail do cliente', feito: conf('email') },
      { chave: 'proposta', bloco: 'venda', texto: 'Proposta aceita ligada', feito: !!f.lig.proposta },
      { chave: 'prazo', bloco: 'venda', texto: 'Prazo prometido ao cliente', feito: !!v && v.prazo_prometido.trim().length > 0 },
      { chave: 'placas', bloco: 'venda', texto: 'Placas: quantidade e marca', feito: conf('placas') },
      { chave: 'inversor', bloco: 'venda', texto: 'Inversor: quantidade e marca', feito: conf('inversor') },
      { chave: 'valor', bloco: 'venda', texto: 'Valor vendido', feito: conf('valor') },
      { chave: 'pagamento', bloco: 'venda', texto: 'Forma de pagamento', feito: conf('pagamento') },
      { chave: 'financiamento', bloco: 'venda', texto: 'Precisa de proposta de banco ou financiamento?', feito: fin !== null },
    ];
    if (fin === 'sim') itens.push({ chave: 'proposta_banco', bloco: 'venda', texto: 'Proposta de banco preenchida', feito: bancoPreenchido(f.obra?.banco) });
    itens.push(
      { chave: 'papel_contrato', bloco: 'papeis', texto: 'Contrato gerado', feito: !!papeis?.contrato },
      { chave: 'papel_procuracao', bloco: 'papeis', texto: 'Procuração gerada', feito: !!papeis?.procuracao },
    );
    // Primeiro se pede a lista de documentos ao cliente, depois se anexa: cada item fecha quando o ARQUIVO existe (o tique de pedido continua
    // gravado em `etapas[1].pedidos`, mas não é mais item).
    itens.push(
      { chave: 'documento', bloco: 'documentos', texto: 'CNH ou identidade', feito: tem('documento_titular') || tem('documento_titular_uc') },
      { chave: 'conta_luz', bloco: 'documentos', texto: 'Conta de luz', feito: tem('conta_luz') },
      { chave: 'fachada', bloco: 'fotos', texto: 'Foto da fachada', feito: tem('fachada') },
      { chave: 'padrao', bloco: 'fotos', texto: 'Foto do padrão de entrada', feito: tem('padrao') },
      { chave: 'disjuntor', bloco: 'fotos', texto: 'Foto do disjuntor', feito: tem('disjuntor') },
      { chave: 'medidor', bloco: 'fotos', texto: 'Foto do medidor', feito: tem('medidor') },
    );
    itens.push({ chave: 'excedente', bloco: 'excedente', texto: falta ?? 'Excedente para outras contas', feito: falta === null });
    if (e1?.excedente === 'sim') itens.push({ chave: 'conta_excedente', bloco: 'excedente', texto: 'Conta de luz do excedente', feito: tem('conta_luz_beneficiaria') });
    return itens;
  }
  if (n === 2) {
    // Fase 2 (Assinaturas e vistoria): o contrato e a procuração assinados (o par que dá o número da obra) e o relatório de vistoria 80% preenchido.
    const itens: ItemEtapa[] = [
      { chave: 'contrato_assinado', bloco: 'anexos', texto: 'Contrato assinado anexado', feito: tem('contrato_assinado') },
      { chave: 'procuracao', bloco: 'anexos', texto: 'Procuração assinada anexada', feito: tem('procuracao') },
      { chave: 'vistoria', bloco: 'vistoria', texto: 'Relatório de vistoria 80% preenchido', feito: vistoriaPct(f.obra?.vistoria ?? null) >= 80 },
    ];
    // Obra que fechou a etapa 1 pela regra antiga (CNH, conta de luz e fotos eram desta etapa): o que ficou sem arquivo volta como pendência
    // da etapa 1. Item já feito não aparece, e quem nunca teve pendência não vê bloco nenhum.
    const herdados: Array<[string, string, boolean]> = [
      ['documento', 'CNH ou identidade', tem('documento_titular') || tem('documento_titular_uc')],
      ['conta_luz', 'Conta de luz', tem('conta_luz')],
      ['fachada', 'Foto da fachada', tem('fachada')],
      ['padrao', 'Foto do padrão de entrada', tem('padrao')],
      ['disjuntor', 'Foto do disjuntor', tem('disjuntor')],
      ['medidor', 'Foto do medidor', tem('medidor')],
    ];
    for (const [chave, texto, feito] of herdados) if (!feito) itens.push({ chave, bloco: 'pendentes', texto: `${texto} (pendente da etapa 1)`, feito: false });
    return itens;
  }
  if (n === 3) {
    // Fase 3 (Homologação): primeiro o equipamento (ele libera o cartão do Trello sozinho), depois o que já existia.
    const itens: ItemEtapa[] = [
      { chave: 'datasheet_modulo', bloco: 'equipamento', texto: 'Datasheet da placa', feito: tem('datasheet_modulo') },
      { chave: 'datasheet_inversor', bloco: 'equipamento', texto: 'Datasheet do inversor', feito: tem('datasheet_inversor') },
      { chave: 'kmz', bloco: 'equipamento', texto: 'KMZ do local', feito: tem('kmz') },
    ];
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

export const MSG_TRELLO_AUTO_PAROU = 'Confira os cartões parecidos no botão do Trello';
export const MSG_TRELLO_AUTO_ARQUIVADO = 'O cartão guardado não está aberto no Trello. Confira no botão do Trello.';

/**
 * Trello automático: o cartão nasce sozinho quando as fases 1 e 2 fecharam e o bloco `equipamento` da etapa 3 está todo feito
 * (e a obra já tem número e não foi cancelada). `falta` diz o que ainda impede, em texto de tela; vazio quando `pronto`.
 * `pronto` não olha se o cartão já existe (isso está em `etapas[3].trello`).
 */
export function estadoTrelloAuto(f: EntradaItens, temNumero: boolean, opcoes: { ignorarParada?: boolean } = {}): { pronto: boolean; falta: string[] } {
  const falta: string[] = [];
  if (f.estado?.cancelada) falta.push('Obra cancelada');
  // Só age com a Homologação (etapa 3) em andamento: obra que já passou dela não é tocada, nem para completar o cartão.
  if (f.estado?.etapas[3].concluida_em) falta.push('Homologação já concluída');
  if (!f.estado?.etapas[1].concluida_em) falta.push('Etapa Venda concluída');
  if (!f.estado?.etapas[2].concluida_em) falta.push('Etapa Assinaturas e vistoria concluída');
  for (const i of itensDaEtapa(3, f)) if (i.bloco === 'equipamento' && !i.feito) falta.push(i.texto);
  if (!temNumero) falta.push('Número da venda');
  // O automático parou porque o quadro tem cartões parecidos: a pessoa confere e usa o botão (só vale enquanto não há cartão).
  if (!opcoes.ignorarParada && f.estado?.historico.some((x) => x.acao === 'trello_auto_parou') && !f.estado.etapas[3].trello && !f.lig.trello_card) {
    falta.push(MSG_TRELLO_AUTO_PAROU);
  }
  // O cartão guardado sumiu do quadro (arquivado ou apagado): o automático parou e a pessoa confere pelo botão.
  if (!opcoes.ignorarParada && f.estado?.historico.some((x) => x.acao === 'trello_auto_arquivado') && !f.estado.etapas[3].trello?.completado_em) {
    falta.push(MSG_TRELLO_AUTO_ARQUIVADO);
  }
  return { pronto: falta.length === 0, falta };
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
  // Sem número, pelo que dá para ler dos arquivos: o par assinado (contrato + procuração) OU as fotos e documentos da vistoria já colocam a
  // venda na etapa 2, e é ao concluí-la que o número nasce. A etapa 3 só existe depois dele (ramo `temNumero` acima).
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
