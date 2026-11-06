// ─────────────────────────────────────────────────────────────────────────────
// A FICHA CONSOLIDADA DA VENDA SOLAR (06/11/2026). PURO: sem banco, sem relógio, sem rota (ciclo de boot em CommonJS).
// Quem lê as fontes é `routes/geradorJornadaFicha.ts`. A primeira fonte com valor vence:
//   1. o que foi gravado na jornada: a obra (JSON privado, estado), os formulários da obra (`obra.json`) e o cadastro gravado por gente
//      (o cadastro é o lugar da jornada para a identidade: é dele que saem contrato, procuração e recibo);
//   2. o que a pessoa aceitou da leitura por IA (o campo do cadastro com `fonte: 'ia'`; a ficha nunca chama o modelo);
//   3. a proposta ligada e o dossiê dela; 4. o card; 5. os documentos do card; 6. a planilha, pelo código.
// O nome e o telefone do card são do NEGOCIADOR: nunca entram como contratante, titular da homologação nem do financiamento.
// A ficha não grava nada. Quem grava é o Salvar de cada formulário, no lugar de sempre.
// ─────────────────────────────────────────────────────────────────────────────
import { validarCampo, type Cadastro, type Campo } from './cadastroVenda';
import { POR_QUE_NAO_E_GENTE, type EstadoJornada, type FormaPagamento, type PrivadoJornada } from './jornadaSolar';
import type { ObraPrivada } from './jornadaObra';
import { equipamentoDaProposta, ROTULO_LIGACAO } from './trelloVendaSolar';
import { diaDeBrasilia } from '../agenda/viradaDoDia';

export type FonteFicha =
  | 'obra' | 'cadastro' | 'ia' | 'banco' | 'vistoria' | 'compra' | 'contrato' | 'proposta' | 'dossie' | 'card' | 'fotos' | 'planilha' | 'combinado';

/** O texto da marca "Veio de: <rótulo>". */
export const ROTULO_FONTE: Readonly<Record<FonteFicha, string>> = {
  obra: 'obra', cadastro: 'cadastro', ia: 'leitura da IA', banco: 'proposta de banco', vistoria: 'relatório de vistoria', compra: 'compra',
  contrato: 'contrato gerado', proposta: 'proposta', dossie: 'dossiê da proposta', card: 'card', fotos: 'fotos da vistoria', planilha: 'planilha',
  combinado: 'combinado da venda',
};

export type ValorFicha = string | number;
export interface CampoFicha { valor: ValorFicha; fonte: FonteFicha; rotulo: string; alt?: { valor: ValorFicha; fonte: FonteFicha; rotulo: string } }
export type CamposFicha = Record<string, CampoFicha>;
type Candidato = readonly [FonteFicha, ValorFicha | null | undefined];

const comparavel = (s: unknown): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const semValor = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' ? !v.trim() : typeof v === 'number' ? !(Number.isFinite(v) && v > 0) : true);
const mesmo = (a: ValorFicha, b: ValorFicha): boolean => (typeof a === 'number' && typeof b === 'number' ? a === b : comparavel(a) === comparavel(b));

/** A primeira fonte com valor vence. `alt` é a primeira fonte de baixo que diz OUTRA coisa (a pessoa já vê as duas: o filtro veio antes). */
export function escolher(cands: readonly Candidato[]): CampoFicha | null {
  const cheios: Array<[FonteFicha, ValorFicha]> = [];
  for (const [f, v] of cands) if (!semValor(v)) cheios.push([f, typeof v === 'string' ? v.trim() : (v as number)]);
  if (!cheios.length) return null;
  const [fonte, valor] = cheios[0];
  const out: CampoFicha = { valor, fonte, rotulo: ROTULO_FONTE[fonte] };
  const outra = cheios.slice(1).find(([, v]) => !mesmo(v, valor));
  if (outra) out.alt = { valor: outra[1], fonte: outra[0], rotulo: ROTULO_FONTE[outra[0]] };
  return out;
}

// ── O vocabulário da forma de pagamento (um lugar só) ───────────────────────
/** Venda (etapa 1) -> livro do dinheiro. A única palavra que muda é TED. */
export const FORMA_VENDA_PARA_LIVRO: Readonly<Record<FormaPagamento, string>> = {
  pix: 'pix', ted: 'transferencia', boleto: 'boleto', cartao: 'cartao', financiamento: 'financiamento', dinheiro: 'dinheiro',
};
/** Venda (etapa 1) -> `propostas.forma_pagamento` (o modal antigo do Histórico). Movida da rotaVenda SEM mudar nada. */
export const formaDoEspelho = (formas: readonly FormaPagamento[]): string => {
  if (formas.includes('financiamento')) return 'financiamento';
  if (formas.every((f) => f === 'cartao')) return 'cartao';
  if (formas.every((f) => f === 'boleto')) return 'boleto';
  if (formas.every((f) => f === 'pix' || f === 'ted' || f === 'dinheiro')) return 'vista';
  return 'misto';
};
/** Modal antigo e coluna da planilha -> venda: só o texto que diz UMA forma. "vista", "misto" e "outros" ficam de fora (Pix, TED ou dinheiro?). */
export function formaDaVendaPorTexto(t: unknown): FormaPagamento | null {
  const s = comparavel(t);
  if (s === 'financiamento') return 'financiamento';
  if (s === 'cartao' || s === 'cartaodecredito') return 'cartao';
  if (s === 'boleto') return 'boleto';
  return null;
}
/** "Monofásica" da proposta -> `uc_fornecimento` do cadastro. */
export function ligacaoDoTexto(t: unknown): 'monofasico' | 'bifasico' | 'trifasico' | null {
  const s = comparavel(t);
  if (s.startsWith('mono')) return 'monofasico';
  if (s.startsWith('bi')) return 'bifasico';
  if (s.startsWith('tri')) return 'trifasico';
  return null;
}

// ── A entrada (a rota monta, JÁ filtrada por quem vê) ──────────────────────
export interface EntradaFicha {
  quem: { nome: string; socio: boolean; adm: boolean; veDinheiro: boolean };
  card: { cliente: string; telefone: string; cidade: string; vendedor: string };
  lig: { proposta: string | null; venda: string | null; trello_card?: string | null };
  estado: EstadoJornada | null;
  privado: PrivadoJornada | null;
  obra: ObraPrivada | null;
  cad: Cadastro;
  /** Os arquivos do card (só `slot`, `em` e `por`). */
  fotos: ReadonlyArray<{ slot: string; em: string; por: string }>;
  proposta: {
    dados: Record<string, unknown>; qtd_placas: number | null; inversor: string | null; qtd_inversor: number | null; cliente_uf: string | null;
    dossie: { campos: Record<string, string>; trello: { card_id: string | null; card_url?: string | null } };
  } | null;
  /** As colunas da venda na proposta ligada (o modal antigo grava aqui). */
  propostaVenda: { vendido: boolean; valor_vendido: number | null; forma_pagamento: string | null; obs_venda: string | null } | null;
  /** A linha da planilha deste código já passada por `dadosDaPlanilha` (null = a pessoa não vê a linha). Dinheiro só para quem vê. */
  planilha: { campos: ReadonlyArray<{ chave: string; valor: string }>; valorVendaCentavos: number | null } | null;
  /** As entradas do livro (null = a pessoa não vê o dinheiro). */
  entradas: ReadonlyArray<{ forma: string; valor_centavos: number }> | null;
  /** Arquivos da Planilha (linha `solar`, pelo #NNNN), com o slot da venda solar. `url` só para quem vê a linha. */
  docsPlanilha: ReadonlyArray<{ slot: string; em: string; url: string | null }>;
}

const num = (x: unknown): number | null => {
  const n = typeof x === 'number' ? x : Number(String(x ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const nomeBonito = (n: string): string => (n ? n.charAt(0).toUpperCase() + n.slice(1) : '');
type CampoCad = { valor?: string; fonte?: string } | undefined;
const doCadastro = (cad: Cadastro, k: string): CampoCad => (cad.campos as Record<string, CampoCad>)[k];
/** Valor do cadastro gravado por GENTE (manual, contrato, ficha). */
export const deGente = (cad: Cadastro, k: string): string => { const c = doCadastro(cad, k); return c && c.fonte !== 'ia' ? String(c.valor ?? '').trim() : ''; };
/** Valor que a pessoa aceitou da leitura por IA. */
export const daIa = (cad: Cadastro, k: string): string => { const c = doCadastro(cad, k); return c && c.fonte === 'ia' ? String(c.valor ?? '').trim() : ''; };
const doCad = (cad: Cadastro, k: string): Candidato[] => [['cadastro', deGente(cad, k)], ['ia', daIa(cad, k)]];
/** O valor como o PUT do cadastro o aceita, ou ''. */
const valido = (k: Campo, x: unknown): string => {
  if (typeof x !== 'string' || !x.trim()) return '';
  const r = validarCampo(k, x);
  return r.ok ? r.valor : '';
};
export const decisao = (cad: Cadastro, k: 'homologacao_mesmo' | 'financiamento_mesmo'): '' | 'contratante' | 'outra_pessoa' => {
  const v = deGente(cad, k) || daIa(cad, k);
  return v === 'contratante' || v === 'outra_pessoa' ? v : '';
};

const PESSOA = ['nome', 'cpf_cnpj', 'rg_ie', 'orgao_emissor', 'nascimento', 'nacionalidade', 'estado_civil', 'profissao',
  'endereco', 'bairro', 'cidade', 'uf', 'cep', 'telefone'] as const;
const FIN_NO_BANCO: Readonly<Record<string, 'nome' | 'doc' | 'rg' | 'end' | 'cep' | 'tel' | 'email'>> = {
  nome: 'nome', cpf_cnpj: 'doc', rg_ie: 'rg', endereco: 'end', cep: 'cep', telefone: 'tel', email: 'email',
};
const FOTOS_DA_VISTORIA = ['fachada', 'padrao', 'disjuntor', 'medidor'];

export function camposDaFicha(e: EntradaFicha): CamposFicha {
  const out: CamposFicha = {};
  const poe = (k: string, cands: readonly Candidato[]): void => { const c = escolher(cands); if (c) out[k] = c; };
  const v = e.privado?.venda ?? null;
  const pv = e.propostaVenda && e.propostaVenda.vendido ? e.propostaVenda : null;
  const pl = (k: string): string => e.planilha?.campos.find((c) => c.chave === k)?.valor ?? '';
  const dados = (e.proposta?.dados ?? {}) as Record<string, unknown>;
  const dos = e.proposta?.dossie.campos ?? {};
  const equip = e.proposta
    ? equipamentoDaProposta({ qtd_placas: e.proposta.qtd_placas, inversor: e.proposta.inversor, qtd_inversor: e.proposta.qtd_inversor, dados })
    : null;
  const ob = e.obra;
  const ct = ob?.contrato ?? null;
  const itens = ob?.compra.itens ?? [];
  const mods = itens.filter((i) => i.tipo === 'modulo');
  const invs = itens.filter((i) => i.tipo === 'inversor');
  const soma = (l: typeof itens): number => l.reduce((s, i) => s + (i.quantidade ?? 0), 0);
  const marcaModelo = (i: (typeof itens)[number] | undefined): string => (i ? [i.marca, i.modelo].filter(Boolean).join(' ') : '');

  // Venda
  poe('venda.valor_centavos', [
    ['obra', v?.valor_centavos], ['proposta', pv && pv.valor_vendido ? Math.round(pv.valor_vendido * 100) : null], ['planilha', e.planilha?.valorVendaCentavos ?? null],
  ]);
  poe('venda.forma', v
    ? [['obra', v.pagamento.length === 1 ? v.pagamento[0].forma : '']]
    : [['proposta', pv ? formaDaVendaPorTexto(pv.forma_pagamento) ?? '' : ''], ['planilha', formaDaVendaPorTexto(pl('forma_pagamento')) ?? '']]);
  poe('venda.nota', [['obra', v?.nota], ['proposta', pv?.obs_venda ?? '']]);
  const prazoProp = num(dados.prazoInstalacao);
  poe('venda.prazo_prometido', [['obra', v?.prazo_prometido], ['proposta', prazoProp ? `Instalação em até ${Math.round(prazoProp)} dias` : '']]);

  // Sistema
  const kwpProp = num(dados.kwp) ?? (equip?.qtdPlacas && equip.potPlaca ? Math.round(equip.qtdPlacas * equip.potPlaca) / 1000 : null);
  poe('sistema.kwp', [['contrato', ct ? num(ct.kwp) : null], ['proposta', kwpProp], ['planilha', num(pl('kwp').replace(/[^\d,]/g, ''))]]);
  poe('sistema.modulos_qtd', [
    ['compra', soma(mods)], ['contrato', ct ? num(ct.quantidade_modulos.replace(/\D/g, '')) : null], ['proposta', equip?.qtdPlacas ?? null],
    ['dossie', num(dos.qtd_placa)], ['planilha', num(pl('placas').split(' ')[0])],
  ]);
  poe('sistema.modulo_modelo', [['compra', marcaModelo(mods[0])], ['contrato', ct?.marca_modulos ?? ''], ['proposta', equip?.modeloPlaca ?? ''], ['dossie', dos.marca_placa ?? '']]);
  poe('sistema.modulo_w', [['compra', mods[0]?.potencia_w ?? null], ['proposta', equip?.potPlaca ?? null]]);
  poe('sistema.inversores_qtd', [
    ['compra', soma(invs)], ['contrato', ct ? num(ct.quantidade_inversores.replace(/\D/g, '')) : null], ['proposta', equip?.qtdInversor ?? null], ['dossie', num(dos.qtd_inversor)],
  ]);
  poe('sistema.inversor_modelo', [['compra', marcaModelo(invs[0])], ['contrato', ct?.marca_inversor ?? ''], ['proposta', equip?.inversor ?? ''], ['dossie', dos.marca_inversor ?? '']]);
  const ger = num(dados.mediaMensalGerada);
  poe('sistema.geracao_kwh', [['banco', ob?.banco?.ger ?? ''], ['proposta', ger ? String(Math.round(ger)) : '']]);
  poe('sistema.telhado', [['vistoria', ob?.vistoria?.telhado.tipo ?? ''], ['proposta', typeof dados.telhado === 'string' ? dados.telhado : '']]);
  poe('sistema.ligacao', [...doCad(e.cad, 'uc_fornecimento'), ['proposta', ligacaoDoTexto(dados.fase) ?? '']]);
  const consumo = num(dados.consumoKwh);
  poe('sistema.consumo_kwh', [...doCad(e.cad, 'consumo_medio_kwh'), ['proposta', consumo ? String(Math.round(consumo)) : '']]);
  poe('sistema.disjuntor_a', [['cadastro', deGente(e.cad, 'disjuntor_a')], ['vistoria', ob?.vistoria?.entrada.disj ?? ''], ['ia', daIa(e.cad, 'disjuntor_a')]]);
  const kwp = out['sistema.kwp']; const qm = out['sistema.modulos_qtd']; const mm = out['sistema.modulo_modelo'];
  const qi = out['sistema.inversores_qtd']; const mi = out['sistema.inversor_modelo'];
  const partes = [
    kwp ? `Sistema fotovoltaico de ${String(kwp.valor).replace('.', ',')} kWp` : 'Sistema fotovoltaico',
    qm && mm ? `${qm.valor} módulos ${mm.valor}` : '',
    qi && mi ? `${qi.valor} ${Number(qi.valor) === 1 ? 'inversor' : 'inversores'} ${mi.valor}` : '',
  ].filter(Boolean);
  const desc = (qm && mm) || (qi && mi) ? partes.join(', ') : '';
  poe('sistema.descricao', [['banco', ob?.banco?.desc ?? ''], [mm?.fonte ?? mi?.fonte ?? 'proposta', desc]]);

  // Pessoas. O card NUNCA entra aqui (é o negociador).
  for (const k of PESSOA) poe(`contratante.${k}`, doCad(e.cad, k));
  const emailOk = (x: unknown): string => valido('email' as Campo, x);
  poe('contratante.email', [...doCad(e.cad, 'email'), ['dossie', emailOk(dos.email)], ['proposta', emailOk(dados.email)]]);
  const fin = decisao(e.cad, 'financiamento_mesmo');
  const bf = ob?.banco?.fin ?? null;
  for (const k of [...PESSOA, 'email'] as const) {
    if (fin === 'contratante') { const c = out[`contratante.${k}`]; if (c) out[`financiamento.${k}`] = c; }
    else if (fin === 'outra_pessoa') {
      const kb = FIN_NO_BANCO[k];
      poe(`financiamento.${k}`, [...doCad(e.cad, `fin_${k}`), ['banco', kb && bf ? bf[kb] : '']]);
    }
  }
  const tuc = decisao(e.cad, 'homologacao_mesmo');
  if (tuc === 'contratante') { if (out['contratante.nome']) out['homologacao.nome'] = out['contratante.nome']; }
  else if (tuc === 'outra_pessoa') poe('homologacao.nome', [...doCad(e.cad, 'tuc_nome'), ['planilha', pl('nome_homologacao')]]);

  // Unidade geradora
  poe('uc.numero', doCad(e.cad, 'unidade_consumidora'));
  poe('uc.concessionaria', [...doCad(e.cad, 'concessionaria'), ['planilha', pl('concessionaria')]]);
  poe('uc.endereco_ponto', [...doCad(e.cad, 'endereco_ponto'), ['planilha', pl('endereco')]]);
  const ufCard = /(?:^|[\s\-/])([A-Za-z]{2})\s*$/.exec(e.card.cidade)?.[1] ?? '';
  poe('uc.uf_ponto', [...doCad(e.cad, 'uf_ponto'), ['proposta', valido('uf_ponto' as Campo, String(e.proposta?.cliente_uf ?? '').toUpperCase())], ['card', valido('uf_ponto' as Campo, ufCard.toUpperCase())]]);

  // Vistoria: a primeira das 4 fotos da vistoria no card dá a data e quem anexou.
  const primeira = e.fotos
    .filter((f) => FOTOS_DA_VISTORIA.includes(f.slot) && !!f.em)
    .sort((a, b) => a.em.localeCompare(b.em))[0] ?? null;
  const porFoto = primeira && !POR_QUE_NAO_E_GENTE.has(String(primeira.por ?? '').trim().toLowerCase()) ? nomeBonito(String(primeira.por).trim().toLowerCase()) : '';
  poe('vistoria.data', [['vistoria', ob?.vistoria?.data ?? ''], ['fotos', primeira ? diaDeBrasilia(primeira.em) : '']]);
  poe('vistoria.quem', [['vistoria', ob?.vistoria?.quem ?? ''], ['fotos', porFoto]]);
  // Quem acompanhou: o negociador do card (com quem a equipe esteve). Não é campo de identidade: nunca vai para contratante nem titular.
  poe('vistoria.acomp', [['vistoria', ob?.vistoria?.acomp ?? ''], ['card', e.card.cliente]]);
  return out;
}

/** O próximo recebimento: anda o combinado na ordem e desconta o que já entrou na MESMA forma (no vocabulário do livro). */
export function proximoRecebimento(
  pagamento: ReadonlyArray<{ forma: FormaPagamento; valor_centavos: number }>,
  entradas: ReadonlyArray<{ forma: string; valor_centavos: number }>,
): { forma: string; valor_centavos: number; categoria: 'entrada' | 'parcela' | 'financiamento' } | null {
  const sobra = new Map<string, number>();
  for (const l of entradas) sobra.set(l.forma, (sobra.get(l.forma) ?? 0) + Math.max(0, Math.round(Number(l.valor_centavos) || 0)));
  const nenhuma = entradas.length === 0;
  for (const p of pagamento) {
    const forma = FORMA_VENDA_PARA_LIVRO[p.forma];
    const ja = sobra.get(forma) ?? 0;
    const usa = Math.min(ja, p.valor_centavos);
    sobra.set(forma, ja - usa);
    const falta = p.valor_centavos - usa;
    if (falta > 0) return { forma, valor_centavos: falta, categoria: p.forma === 'financiamento' ? 'financiamento' : nenhuma ? 'entrada' : 'parcela' };
  }
  return null;
}

export interface SugestoesFicha { venda: CamposFicha; banco: CamposFicha; vistoria: CamposFicha; cadastro: CamposFicha; recebimento: CamposFicha }
const so = (c: CamposFicha, k: string, fontes?: readonly FonteFicha[]): CampoFicha | undefined => {
  const x = c[k];
  return x && (!fontes || fontes.includes(x.fonte)) ? x : undefined;
};
const limpo = (o: Record<string, CampoFicha | undefined>): CamposFicha => {
  const r: CamposFicha = {};
  for (const [k, v] of Object.entries(o)) if (v) r[k] = { valor: v.valor, fonte: v.fonte, rotulo: v.rotulo };
  return r;
};
const vazioTxt = (x: unknown): boolean => !String(x ?? '').trim();
const DE_PESSOA: readonly FonteFicha[] = ['cadastro', 'ia'];

/** As sugestões de cada formulário: SÓ para o que o lugar daquele formulário ainda não tem (nunca sobrescreve). */
export function sugestoesDaFicha(e: EntradaFicha, c: CamposFicha): SugestoesFicha {
  // 1. formVenda (etapa 1): só sem venda gravada na obra.
  const venda: CamposFicha = e.privado?.venda ? {} : limpo({
    valor_centavos: so(c, 'venda.valor_centavos'), forma: so(c, 'venda.forma'), nota: so(c, 'venda.nota'), prazo_prometido: so(c, 'venda.prazo_prometido'),
  });
  // 2. Proposta de banco (etapa 2). Nunca sugere de volta o que veio do próprio formulário.
  const bk = e.obra?.banco ?? null; const bf = bk?.fin ?? null;
  const banco: Record<string, CampoFicha | undefined> = {};
  if (vazioTxt(bk?.desc)) banco.desc = so(c, 'sistema.descricao', ['compra', 'contrato', 'proposta', 'dossie']);
  if (vazioTxt(bk?.ger)) banco.ger = so(c, 'sistema.geracao_kwh', ['proposta']);
  if (vazioTxt(bk?.prazo)) banco.prazo = so(c, 'venda.prazo_prometido', ['obra', 'proposta']);
  for (const [k, kb] of [['nome', 'nome'], ['cpf_cnpj', 'doc'], ['rg_ie', 'rg'], ['cep', 'cep'], ['telefone', 'tel'], ['email', 'email']] as const) {
    if (vazioTxt(bf?.[kb])) banco[`fin.${kb}`] = so(c, `financiamento.${k}`, DE_PESSOA);
  }
  if (vazioTxt(bf?.qualif)) for (const k of ['nacionalidade', 'estado_civil', 'profissao', 'orgao_emissor']) banco[`fin.qualif.${k}`] = so(c, `financiamento.${k}`, DE_PESSOA);
  if (vazioTxt(bf?.end)) for (const k of ['endereco', 'bairro', 'cidade', 'uf']) banco[`fin.end.${k}`] = so(c, `financiamento.${k}`, DE_PESSOA);
  // 3. Relatório de vistoria (etapa 1).
  const vs = e.obra?.vistoria ?? null;
  const vistoria: Record<string, CampoFicha | undefined> = {};
  if (vazioTxt(vs?.data)) vistoria.data = so(c, 'vistoria.data', ['fotos']);
  if (vazioTxt(vs?.quem)) vistoria.quem = so(c, 'vistoria.quem', ['fotos']);
  if (vazioTxt(vs?.acomp)) vistoria.acomp = so(c, 'vistoria.acomp', ['card']);
  if (vazioTxt(vs?.telhado.tipo)) vistoria['telhado.tipo'] = so(c, 'sistema.telhado', ['proposta']);
  if (vazioTxt(vs?.entrada.padrao)) {
    const l = so(c, 'sistema.ligacao');
    if (l) vistoria['entrada.padrao'] = { valor: ROTULO_LIGACAO[String(l.valor)] ?? String(l.valor), fonte: l.fonte, rotulo: l.rotulo };
  }
  if (vazioTxt(vs?.entrada.disj)) vistoria['entrada.disj'] = so(c, 'sistema.disjuntor_a', DE_PESSOA);
  // 4. O cadastro (quadro "Documentos e cadastro"): só campo vazio, e só valor que o PUT aceita.
  const cadastro: Record<string, CampoFicha | undefined> = {};
  const pede = (k: Campo, chave: string, fontes: readonly FonteFicha[]): void => {
    if (deGente(e.cad, k) || daIa(e.cad, k)) return;
    const x = so(c, chave, fontes);
    if (!x) return;
    const val = valido(k, String(x.valor));
    if (val) cadastro[k] = { valor: val, fonte: x.fonte, rotulo: x.rotulo };
  };
  pede('uc_fornecimento' as Campo, 'sistema.ligacao', ['proposta']);
  pede('consumo_medio_kwh' as Campo, 'sistema.consumo_kwh', ['proposta']);
  pede('disjuntor_a' as Campo, 'sistema.disjuntor_a', ['vistoria']);
  pede('uf_ponto' as Campo, 'uc.uf_ponto', ['card', 'proposta']);
  pede('endereco_ponto' as Campo, 'uc.endereco_ponto', ['planilha']);
  pede('concessionaria' as Campo, 'uc.concessionaria', ['planilha']);
  if (decisao(e.cad, 'financiamento_mesmo') === 'outra_pessoa') {
    for (const k of ['nome', 'cpf_cnpj', 'rg_ie', 'endereco', 'cep', 'telefone', 'email'] as const) pede(`fin_${k}` as Campo, `financiamento.${k}`, ['banco']);
  }
  if (decisao(e.cad, 'homologacao_mesmo') === 'outra_pessoa') pede('tuc_nome' as Campo, 'homologacao.nome', ['planilha']);
  // 5. Lançar recebimento (etapa 2): só para quem vê o dinheiro.
  const recebimento: Record<string, CampoFicha | undefined> = {};
  const pg = e.privado?.venda?.pagamento ?? [];
  if (e.quem.veDinheiro && e.entradas && pg.length) {
    const r = proximoRecebimento(pg, e.entradas);
    if (r) {
      const f = (valor: ValorFicha): CampoFicha => ({ valor, fonte: 'combinado', rotulo: ROTULO_FONTE.combinado });
      recebimento.forma = f(r.forma); recebimento.valor_centavos = f(r.valor_centavos); recebimento.categoria = f(r.categoria);
    }
  }
  return { venda, banco: limpo(banco), vistoria: limpo(vistoria), cadastro: limpo(cadastro), recebimento: limpo(recebimento) };
}

const urlDoTrello = (u: unknown): string => (typeof u === 'string' && /^https:\/\/(www\.)?trello\.com\//.test(u.trim()) ? u.trim() : '');
/** O link do Trello: o da obra, senão o do dossiê da proposta. ID sozinho não vira link. A busca por nome não entra. */
export function trelloDaFicha(
  estado: EstadoJornada | null, dossieTrello: { card_url?: string | null } | null, trelloCard: string | null | undefined,
): { url: string | null; fonte: 'obra' | 'dossie' | null; rotulo: string; tem_cartao: boolean } {
  const daObra = String(estado?.etapas[3].trello?.url ?? '').trim();
  if (daObra) return { url: daObra, fonte: 'obra', rotulo: ROTULO_FONTE.obra, tem_cartao: !!trelloCard };
  const doDossie = urlDoTrello(dossieTrello?.card_url);
  if (doDossie) return { url: doDossie, fonte: 'dossie', rotulo: ROTULO_FONTE.dossie, tem_cartao: !!trelloCard };
  return { url: null, fonte: null, rotulo: '', tem_cartao: !!trelloCard };
}

export interface Ficha {
  v: 1;
  campos: CamposFicha;
  sugestoes: SugestoesFicha;
  trello: ReturnType<typeof trelloDaFicha>;
  documentos_fora: Array<{ slot: string; em: string; url: string | null; fonte: 'planilha'; rotulo: string }>;
}

export function montarFicha(e: EntradaFicha): Ficha {
  const campos = camposDaFicha(e);
  return {
    v: 1, campos, sugestoes: sugestoesDaFicha(e, campos),
    trello: trelloDaFicha(e.estado, e.proposta?.dossie.trello ?? null, e.lig.trello_card),
    documentos_fora: e.docsPlanilha.map((d) => ({ slot: d.slot, em: d.em, url: d.url, fonte: 'planilha' as const, rotulo: ROTULO_FONTE.planilha })),
  };
}
