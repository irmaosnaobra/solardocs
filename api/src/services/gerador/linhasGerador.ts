// ─────────────────────────────────────────────────────────────────────────────
// LINHAS DO /GERADOR NA PLANILHA DE CLIENTES (fase 2, 22/10/2026). Para cada código ligado a um card (`venda_solar:<card>` com
// `venda`), a linha que o /gerador monta a partir do CARD, da PROPOSTA ligada e do CADASTRO (bucket). Calculada na LEITURA: nada
// pessoal vai para `system_state`.
//
// Formatos: as regras com que o dono preenche o Excel (a skill "contratos-fechados"). NOME CLIENTE é o primeiro nome de quem
// negociou (o mesmo que vai entre parênteses no título do cartão do Trello), NOME HOMOLOGAÇÃO é o titular da conta de luz, o
// endereço é o DA INSTALAÇÃO, "Tsun 600W", "Bi - 220", "SAJ 6K", "nc", "Guilherme", concessionária pela regra da etiqueta do
// Trello (e pela UF da instalação), CADASTRO TRELLO pela data do cartão do Trello ligado. Colunas internas ficam vazias.
//
// Mesmo código no CSV e no /gerador: `junta` só quando é o MESMO cliente (`mesmoClienteEstrito`: nome que confere e, além dele,
// telefone forte ou mesmo consultor); senão `conflito`, e nada é juntado. Telefone sozinho nunca junta.
//
// Serviço: não importa rota. As leituras pesadas ficam 60 s no cache do hub (dado, nunca resposta por papel); a classificação e o
// filtro de visibilidade rodam a cada pedido. Nenhum log leva valor: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────
import { supabaseGerador } from '../../utils/supabaseGerador';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import { diaDeBrasilia } from '../agenda/viradaDoDia';
import { podeVer } from './solarObras';
import {
  ErroHub, comCacheHub, lerTodasLigacoes, lerCardsPorIds, compararTelefones, mesmoClienteEstrito, avisoMesmoTelefone, propostaDoPapel,
  mesmoConsultor, POR_GERADOR,
} from './vendaSolarHub';
import { cartaoConfiavel } from './vendaSolarCodigo';
import { lerRegistrosDeCodigos, type RegistroCodigo } from './vendaSolarRegistro';
import { lerCadastros, nomeDaHomologacao, type Cadastro } from './cadastroVenda';
import { cidadeUfDoEndereco, criadoEmDoCartao, equipamentoDaProposta, temBeneficiaria } from './trelloVendaSolar';
import type { CardVendido } from './fichaEletroposto';
import type { Derivada, ModoGerador } from './gestaoClientes';

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const LOTE = 150;
const MAX_AVISO = 5;
/** Valores fixos das regras do dono. */
export const ENGENHEIRO_PADRAO = 'Guilherme';
export const NAO_CONSTA = 'nc';

const limpa = (t: unknown, max = 200): string => String(t ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const campo = (cad: Cadastro | null | undefined, k: string): string =>
  limpa((cad?.campos as Record<string, { valor?: string } | undefined> | undefined)?.[k]?.valor);
const digitos = (t: unknown): string => String(t ?? '').replace(/\D/g, '');

// ── Peças puras ──────────────────────────────────────────────────────────────

/** "Uberlândia mg" -> { cidade: 'Uberlândia', uf: 'MG' }; sem UF válida, só a cidade. */
export function cidadeUfDoCard(texto: unknown): { cidade: string; uf: string } {
  const t = limpa(texto, 120);
  const m = /^(.+?)\s+([A-Za-z]{2})$/.exec(t);
  if (m && UFS.has(m[2].toUpperCase())) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
  return { cidade: t, uf: '' };
}

/** O primeiro nome de quem negociou, como foi escrito e sem parênteses (o mesmo do título do cartão do Trello). */
export function nomeCurto(nome: unknown): string {
  return limpa(nome, 120).split(' ')[0]?.replace(/[()]/g, '').trim() ?? '';
}

/** Os nomes e telefones do lado /gerador, SÓ para conferir identidade no servidor (nunca saem na resposta). */
export function identidadeDoGerador(card: Pick<CardVendido, 'cliente_nome' | 'cliente_telefone' | 'vendedor_nome'>, cad: Cadastro | null | undefined) {
  return {
    nomes: [limpa(card.cliente_nome), campo(cad, 'nome'), campo(cad, 'tuc_nome'), cad ? limpa(nomeDaHomologacao(cad)) : ''].filter(Boolean),
    telefones: [String(card.cliente_telefone ?? ''), campo(cad, 'telefone'), campo(cad, 'tuc_telefone')].filter((t) => digitos(t).length >= 8),
    vendedor: limpa(card.vendedor_nome),
  };
}

/** Número com vírgula decimal, até 3 casas e sem zeros à toa ("7,3", "6", "1,875"). */
const comVirgula = (n: number): string => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** "Tsun 600W": a marca (primeira palavra) e a potência do módulo em W. */
/** Tira do começo o que não é marca: quantidade ("2 x", "2x"), "Módulo", "Micro", "Microinversor", "Inversor". */
export const semPrefixo = (s: unknown): string => {
  let t = limpa(s, 120);
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^\d+\s*x\s*/i, '')
      .replace(/^(?:m[oó]dulos?|micro\s*-?\s*inversor(?:es)?|microinversor(?:es)?|micro|inversor(?:es)?)\b\s*-?\s*/i, '').trim();
  }
  return t;
};

export function modeloDaPlaca(marcaOuModelo: string, pot: number | null): string {
  const marca = semPrefixo(marcaOuModelo).split(' ')[0] ?? '';
  if (!marca) return '';
  return pot ? `${marca} ${pot}W` : marca;
}

/**
 * O inversor é de STRING? A MESMA regra do /gerador (o `isString` da proposta): SAJ que não seja o de 2,25K, ou Sungrow. O resto
 * (Deye 2,25K, SOLAX 1,875K, SAJ 2,25K) é micro inversor, como a proposta grava, sem a palavra "micro".
 */
export const inversorDeString = (texto: string): boolean => {
  // Em MAIÚSCULAS: o dossiê é digitado à mão ("Saj 6K", "SAJ 2,25k").
  const t = texto.toUpperCase();
  // "2,25K", "2.25K" (a forma da chave de linha do /gerador) e "2,25 K" são o micro da SAJ.
  return (t.includes('SAJ') && !/(^|[^\d.,])2[.,]\s*25\s*K/.test(t)) || t.includes('SUNGROW');
};

/** "SAJ 6K", "SAJ 7,3K", "MI - Deye 2,25K", "MI - SOLAX 1,875K": a marca, a potência em K com vírgula, e "MI - " no micro inversor. */
export function modeloDoInversor(texto: string): string {
  const t = limpa(texto, 120);
  if (!t) return '';
  const semMi = semPrefixo(t.replace(/^\s*mi\s*-\s*/i, '')).replace(/micro\s*-?\s*inversor(es)?|micro/ig, ' ').replace(/\s+/g, ' ').trim();
  const marca = semMi.split(' ')[0] ?? '';
  const k = /(\d+(?:[.,]\d+)?)\s*k(?:w)?\b/i.exec(semMi);
  // Sem K: o W escrito, ou um número de 3 a 5 dígitos sem unidade ("Solax 2000"), lido como W.
  const w = k ? null : /(\d{3,6})\s*w\b/i.exec(semMi) ?? /\b(\d{3,5})\b/.exec(semMi);
  const potK = k ? Number(k[1].replace(',', '.')) : w ? Number(w[1]) / 1000 : null;
  // Micro: escrito, ou pela regra do /gerador (não é de string) SÓ até 3K ("Auxsol 6K" e "Solis 75K" são de string).
  const micro = /micro/i.test(t) || /^\s*mi\s*-/i.test(t) || (!inversorDeString(t) && potK !== null && potK <= 3);
  const prefixo = micro ? 'MI - ' : '';
  return potK && marca ? `${prefixo}${marca} ${comVirgula(potK)}K` : `${prefixo}${semMi}`;
}

/** "Mono - 220", "Bi - 220", pelo fornecimento do cadastro ou pela fase da proposta ("Monofásica", "Bifásica"). Trifásico: vazio. */
export function voltagemDoInversor(fornecimento: string): string {
  const f = limpa(fornecimento).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^mono/.test(f)) return 'Mono - 220';
  if (/^bi/.test(f)) return 'Bi - 220';
  return '';
}

/** A forma de pagamento da tela de venda (`vista`, `financiamento`...) no rótulo da planilha. */
const FORMAS_DA_VENDA: Readonly<Record<string, string>> = {
  vista: 'Vista', financiamento: 'Financiamento', cartao: 'Cartão', boleto: 'Boleto', misto: 'Misto', outros: 'Outros',
};
export const formaDePagamento = (bruto: unknown): string => {
  const t = limpa(bruto, 80);
  return FORMAS_DA_VENDA[t.toLowerCase()] ?? t;
};

/** O telefone em dígitos, sem o 55 do país (o Excel usa 11 dígitos). */
const telefoneSemPais = (t: unknown): string => {
  const d = digitos(t);
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d;
};

/** A mesma regra da etiqueta do cartão do Trello (pelo texto da concessionária); sem ela, pela UF da instalação (MG Cemig, GO Equatorial). */
export function concessionariaDaVenda(texto: string, uf: string): string {
  const t = limpa(texto).toLowerCase();
  if (/\bcemig\b/.test(t)) return 'Cemig';
  if (/\bequatorial\b/.test(t)) return 'Equatorial';
  if (uf === 'MG') return 'Cemig';
  if (uf === 'GO') return 'Equatorial';
  return limpa(texto, 80);
}

/** O que a linha precisa da proposta ligada (vendida e do papel de quem pede). */
export interface PropostaDaLinha {
  codigo: string; vendido: boolean; valor_vendido: number | null; forma_pagamento: string | null;
  cliente_cidade: string | null; cliente_uf: string | null; qtd_placas: number | null; inversor: string | null; qtd_inversor: number | null;
  consultor_nome: string | null; tab: unknown; item: unknown; qtdInvDados: unknown; fase: string | null;
  /** Só os 4 campos de equipamento do dossiê (nunca o dossiê inteiro: ele pode ter CPF, RG e e-mail). */
  dQtdPlaca?: unknown; dMarcaPlaca?: unknown; dQtdInversor?: unknown; dMarcaInversor?: unknown;
}

/**
 * Os valores da linha (texto bruto no formato da planilha), só das colunas que a fonte preenche. Dinheiro com 2 casas e ponto
 * ("145000.00"), inteiro como `String(n)`, data `AAAA-MM-DD`. Pura.
 */
export function montarDerivada(e: {
  card: CardVendido; cad: Cadastro | null; proposta: PropostaDaLinha | null;
  /** O cartão do Trello ligado, SÓ quando confiável (criado depois da fase 1, escolhido, ou adotado pelo alocador). */
  trelloCard: string | null; socio: boolean;
}): Record<string, string> {
  const { card, cad, proposta: p } = e;
  const v: Record<string, string> = {};
  const poe = (k: string, x: unknown): void => { const t = limpa(x, 300); if (t) v[k] = t; };

  poe('cliente', nomeCurto(card.cliente_nome));
  poe('homologacao', (cad ? nomeDaHomologacao(cad) : '') || campo(cad, 'nome'));
  poe('consultor', card.vendedor_nome);
  const criado = criadoEmDoCartao(e.trelloCard);
  if (criado) v.cadastro_trello = diaDeBrasilia(criado);
  const tel = telefoneSemPais(campo(cad, 'telefone') || card.cliente_telefone);
  if (tel.length >= 8) v.contato = tel;

  // Endereço, cidade e UF: SÓ da instalação (nunca o endereço pessoal do comprador).
  const ponto = campo(cad, 'endereco_ponto');
  poe('endereco', ponto);
  // Cidade e UF da MESMA fonte: o fim do endereço do ponto; sem ele, a PROPOSTA (onde o sistema vai ser instalado), nunca o card.
  const doPonto = cidadeUfDoEndereco(ponto);
  const ufPonto = campo(cad, 'uf_ponto').toUpperCase();
  let cidade = '';
  let uf = '';
  if (doPonto) { cidade = doPonto.cidade; uf = doPonto.uf; } else {
    const ufProposta = limpa(p?.cliente_uf).toUpperCase();
    uf = UFS.has(ufPonto) ? ufPonto : UFS.has(ufProposta) ? ufProposta : '';
    // UF do ponto que discorda da UF da proposta: a cidade da proposta não é a da instalação.
    // Proposta sem UF conta como discordante quando há `uf_ponto` (a cidade dela pode ser de outro estado).
    cidade = UFS.has(ufPonto) && ufPonto !== ufProposta ? '' : limpa(p?.cliente_cidade);
  }
  poe('cidade', cidade);
  poe('uf', uf);
  poe('concessionaria', concessionariaDaVenda(campo(cad, 'concessionaria'), uf));

  // Equipamento: o dossiê da proposta (o que foi conferido no contrato) antes das colunas da proposta.
  const dc: Record<string, unknown> = {
    qtd_placa: p?.dQtdPlaca, marca_placa: p?.dMarcaPlaca, qtd_inversor: p?.dQtdInversor, marca_inversor: p?.dMarcaInversor,
  };
  const eq = p ? equipamentoDaProposta({
    qtd_placas: p.qtd_placas, inversor: p.inversor, qtd_inversor: p.qtd_inversor,
    dados: { tab: p.tab, item: p.item, qtdInv: p.qtdInvDados },
  }) : null;
  // Só inteiro puro ("18"); qualquer outra coisa ("18 placas", "1.5") cai na proposta.
  const inteiro = (x: unknown): number | null => {
    const t = String(x ?? '').trim();
    return /^\d{1,4}$/.test(t) && Number(t) > 0 ? Number(t) : null;
  };
  // Vale o contrato: quantidade do dossiê preenchida e ilegível ("14,0", "2x7") deixa a coluna vazia; dossiê vazio cai na proposta.
  const doDossie = (x: unknown, daProposta: number | null): number | null => (String(x ?? '').trim() ? inteiro(x) : daProposta);
  const qtdPlaca = doDossie(dc.qtd_placa, eq?.qtdPlacas ?? null);
  if (qtdPlaca) v.qtd_placa = String(qtdPlaca);
  // "Conforme pasta": o W escrito na marca do dossiê ("Tsun 610W", "610 Wp") vem antes da potência da proposta; a da proposta só vale
  // quando o dossiê fala da MESMA marca (senão seria a potência de outro módulo).
  const marcaDossie = semPrefixo(dc.marca_placa);
  const wDoDossie = /(\d{3,4})\s*wp?\b/i.exec(marcaDossie);
  const primeira = (s: string): string => (s.split(' ')[0] ?? '').toLowerCase();
  const mesmaMarca = !!marcaDossie && !!eq?.modeloPlaca && primeira(marcaDossie) === primeira(eq.modeloPlaca);
  const pot = wDoDossie ? Number(wDoDossie[1]) : !marcaDossie || mesmaMarca ? eq?.potPlaca ?? null : null;
  poe('modelo_placa', modeloDaPlaca(marcaDossie || eq?.modeloPlaca || '', pot));
  if (pot) v.pot_placa = String(pot);
  const qtdInv = doDossie(dc.qtd_inversor, eq?.qtdInversor ?? null);
  if (qtdInv) v.qtd_inversor = String(qtdInv);
  poe('modelo_inversor', modeloDoInversor(limpa(dc.marca_inversor) || eq?.inversor || ''));
  poe('modelo_voltagem_inversor', voltagemDoInversor(campo(cad, 'uc_fornecimento') || limpa(p?.fase)));

  if (cad && temBeneficiaria(cad)) v.excedentes = 'Tem Excedente';
  v.engenheiro = ENGENHEIRO_PADRAO;
  v.contrato_coop = NAO_CONSTA;
  v.tempo_contrato_coop = NAO_CONSTA;

  // Dinheiro só para sócio (as colunas já são de sócio; aqui nem chegam a ser montadas para consultor).
  if (e.socio && p) {
    const valor = Number(p.valor_vendido);
    if (Number.isFinite(valor) && valor > 0) v.valor_venda = valor.toFixed(2);
    poe('forma_pagto', formaDePagamento(p.forma_pagamento));
  }
  return v;
}

// ── Leituras ─────────────────────────────────────────────────────────────────

/** Um código ligado a um card. `registro`: o registro do alocador daquele código SE é deste card; `registroInvalido`: há linha sem assinatura válida. */
export interface ParGerador {
  codigo: string; card: number; proposta: string | null; por: string; trelloCard: string | null;
  registro: RegistroCodigo | null; registroInvalido: boolean;
}

/** As ligações assinadas com venda (as antigas e as do alocador). Não varre card nem proposta que não esteja ligada. Cache de 60 s. */
export function paresDoGerador(): Promise<ParGerador[]> {
  return comCacheHub('gerador_pares', async () => {
    const [todas, regs] = await Promise.all([lerTodasLigacoes(), lerRegistrosDeCodigos()]);
    const pares: ParGerador[] = [];
    for (const [card, l] of todas) {
      if (!l.venda) continue;
      const r = regs.validos.get(l.venda);
      pares.push({
        codigo: l.venda, card, proposta: l.proposta, por: l.por, trelloCard: l.trello_card ?? null,
        registro: r && r.card === card ? r : null, registroInvalido: regs.naoAssinados.has(l.venda),
      });
    }
    return pares;
  });
}

const chaveDe = (xs: Array<string | number>): string => [...new Set(xs)].map(String).sort().join(',');

/**
 * O cadastro reduzido ao que a linha usa (`montarDerivada` e `identidadeDoGerador`) ANTES de entrar no cache: nada de CPF, RG nem
 * e-mail. As beneficiárias viram só um marcador de que existem.
 */
const CAMPOS_DA_LINHA = ['nome', 'tuc_nome', 'homologacao_mesmo', 'telefone', 'tuc_telefone', 'endereco_ponto', 'uf_ponto', 'concessionaria', 'uc_fornecimento'];
function reduzirCadastro(cad: Cadastro): Cadastro {
  const campos: Record<string, unknown> = {};
  const de = cad.campos as Record<string, unknown>;
  for (const k of CAMPOS_DA_LINHA) if (de[k]) campos[k] = de[k];
  if (temBeneficiaria(cad)) campos.benef_1_uc = { valor: '1', por: '', em: '', fonte: 'manual' };
  return { v: 1, campos: campos as Cadastro['campos'], alteracoes: [], em: null };
}

/** Os cards SEM cache: card transferido não pode continuar aparecendo para a dona antiga (é uma consulta só). */
const cardsDe = (ids: number[]): Promise<Map<number, CardVendido>> => lerCardsPorIds(ids);

/**
 * Os cadastros dos cards. Sucesso completo fica no cache de 60 s; falha de UM card (ou um JSON torto) devolve o mapa PARCIAL, sem
 * cache, e diz quais falharam (`falhou`). Bucket fora do ar: nenhum lido e todos em `falhou`.
 */
async function cadastrosDe(ids: number[]): Promise<{ mapa: Map<number, Cadastro>; ok: boolean; falhou: Set<number> }> {
  if (!ids.length) return { mapa: new Map(), ok: true, falhou: new Set() };
  const chave = `gerador_cads:${chaveDe(ids)}`;
  try {
    const mapa = await comCacheHub(chave, async () => {
      const r = await lerCadastros(ids, 'vendasolar');
      const reduzido = new Map([...r.mapa].map(([id, c]) => [id, reduzirCadastro(c)] as const));
      if (r.indisponivel || r.falhas.size) throw Object.assign(new ErroHub('cadastro'), { parcial: { ...r, mapa: reduzido } });   // falha não entra no cache
      return reduzido;
    });
    return { mapa, ok: true, falhou: new Set() };
  } catch (err) {
    console.error('[linhas-gerador] cadastro indisponível', 'cadastro');
    const r = (err as { parcial?: { mapa: Map<number, Cadastro>; falhas: Set<number>; indisponivel: boolean } }).parcial;
    if (!r || r.indisponivel) return { mapa: new Map(), ok: false, falhou: new Set(ids) };
    return { mapa: r.mapa, ok: false, falhou: r.falhas };
  }
}

const COLUNAS_PROPOSTA = 'codigo, vendido, valor_vendido, forma_pagamento, cliente_cidade, cliente_uf, qtd_placas, inversor, qtd_inversor, '
  + 'consultor_nome, fase, tab:dados->tab, item:dados->item, qtdInvDados:dados->>qtdInv, '
  + 'dQtdPlaca:dados->dossie->campos->>qtd_placa, dMarcaPlaca:dados->dossie->campos->>marca_placa, '
  + 'dQtdInversor:dados->dossie->campos->>qtd_inversor, dMarcaInversor:dados->dossie->campos->>marca_inversor';

async function propostasDe(codigos: string[]): Promise<Map<string, PropostaDaLinha>> {
  if (!codigos.length) return new Map();
  return comCacheHub(`gerador_props:${chaveDe(codigos)}`, async () => {
    const mapa = new Map<string, PropostaDaLinha>();
    const unicos = [...new Set(codigos)];
    for (let i = 0; i < unicos.length; i += LOTE) {
      const { data, error } = await supabaseGerador.from('propostas').select(COLUNAS_PROPOSTA).in('codigo', unicos.slice(i, i + LOTE));
      if (error) throw new ErroHub(String((error as { code?: unknown }).code ?? 'propostas'));
      for (const p of (data ?? []) as unknown as PropostaDaLinha[]) if (p && p.codigo) mapa.set(p.codigo, p);
    }
    return mapa;
  });
}

/** O resumo de cada linha do CSV que a classificação precisa (com o overlay já aplicado). Nunca sai na resposta. */
export interface ResumoCsv {
  visivel: boolean; cliente: string; homologacao: string; telefone: string; consultor: string;
  /** Todas as colunas pessoais e o equipamento vazios (só então a linha pode juntar sem conferir nome). */
  vazia?: boolean;
}
export interface ContextoDerivacao { nome: string; socio: boolean; csv: ReadonlyMap<string, ResumoCsv> }

/**
 * Classifica e monta as linhas dos pares (chave = código). O filtro de visibilidade vem ANTES de ler dado pessoal: o cadastro e a
 * proposta só são lidos para o que quem pede pode ver. Cadastro fora do ar: a linha sai só com card e proposta, `cadastroOk: false`.
 * Falha de card ou proposta lança (a rota cai para `fonte.gerador: false`).
 */
export async function derivarPares(pares: readonly ParGerador[], ctx: ContextoDerivacao): Promise<{ derivadas: Map<string, Derivada>; cadastroOk: boolean; pulados: Set<string> }> {
  const derivadas = new Map<string, Derivada>();
  const pulados = new Set<string>();
  if (!pares.length) return { derivadas, cadastroOk: true, pulados };
  const cards = await cardsDe(pares.map((p) => p.card));
  const vivos = pares.filter((p) => { const c = cards.get(p.card); return !!c && !ehOrigemEletroposto(c.created_by); });
  // Visibilidade ANTES de ler pessoal.
  const visiveis = vivos.filter((p) => {
    const c = cards.get(p.card)!;
    return ctx.socio || podeVer(ctx.nome, String(c.vendedor_nome ?? '')) || !!ctx.csv.get(p.codigo)?.visivel;
  });
  const [cads, props] = await Promise.all([
    cadastrosDe(visiveis.map((p) => p.card)),
    propostasDe(visiveis.map((p) => p.proposta).filter((x): x is string => !!x)),
  ]);
  for (const par of visiveis) {
    const card = cards.get(par.card)!;
    const cad = cads.mapa.get(par.card) ?? null;
    const p0 = par.proposta ? props.get(par.proposta) ?? null : null;
    const proposta = p0 && p0.vendido && propostaDoPapel(ctx.nome, ctx.socio, String(p0.consultor_nome ?? '')) ? p0 : null;
    // Ligação `por: 'gerador'` é do alocador mesmo sem o registro (a chave pública pode apagar `codigo_solar:*`).
    const doAlocador = !!par.registro || par.registroInvalido || par.por === POR_GERADOR;
    const linhaCsv = ctx.csv.get(par.codigo);
    const id = identidadeDoGerador(card, cad);
    let modo: ModoGerador;
    if (!linhaCsv) modo = 'so_gerador';
    else if (!doAlocador && par.por !== 'auto') modo = 'junta';   // ligação feita por gente: confia
    else if (linhaCsv.vazia === true) {
      // Linha vazia do Excel: só junta se o consultor dela está vazio ou é o do card; senão daria os dados do card a outra pessoa.
      modo = !linhaCsv.consultor || mesmoConsultor(linhaCsv.consultor, card.vendedor_nome) ? 'junta' : 'conflito';
    } else if (cads.falhou.has(par.card)) {
      // Precisa conferir o nome e o cadastro deste card não respondeu: a linha do CSV sai como está, sem lado /gerador e sem card.
      pulados.add(par.codigo);
      continue;
    } else modo = mesmoClienteEstrito({ nomes: [linhaCsv.cliente, linhaCsv.homologacao], telefone: linhaCsv.telefone, consultor: linhaCsv.consultor }, id)
      ? 'junta' : 'conflito';
    // Quem só enxerga o par pelo CSV (não é sócio nem vendedor do card) não recebe nada do lado /gerador fora de `junta`.
    const dono = ctx.socio || podeVer(ctx.nome, String(card.vendedor_nome ?? ''));
    const valores = !dono && modo !== 'junta'
      ? {}
      : montarDerivada({
        card, cad, proposta, socio: ctx.socio,
        // CADASTRO TRELLO só do cartão confiável (nascido depois da fase 1) ou do número adotado do Trello pelo alocador.
        trelloCard: par.trelloCard && (cartaoConfiavel(par.trelloCard) || par.registro?.origem === 'trello') ? par.trelloCard : null,
      });
    let avisoTelefone: string | undefined;
    if (modo === 'so_gerador') {
      const codigos = [...ctx.csv.entries()]
        .filter(([, r]) => r.visivel && id.telefones.some((t) => compararTelefones(t, r.telefone) !== null))
        .map(([c]) => c).sort().slice(0, MAX_AVISO);
      const t = avisoMesmoTelefone(codigos, par.codigo);
      if (t) avisoTelefone = t;
    }
    derivadas.set(par.codigo, {
      codigo: par.codigo, card: par.card, modo, doAlocador, vivo: String(card.status ?? '').trim().toLowerCase() === 'fechou',
      consultor: limpa(card.vendedor_nome), valores, ...(avisoTelefone ? { avisoTelefone } : {}),
    });
  }
  return { derivadas, cadastroOk: cads.ok, pulados };
}

/**
 * Um só código (POST /campo e relatório), classificado pela mesma regra. null = o código não está ligado a card visível.
 * `pulado` = o par existe, mas ficou de fora (era preciso conferir o nome e o cadastro do card não respondeu).
 */
export async function derivadaDe(codigo: string, ctx: ContextoDerivacao): Promise<Derivada | null | 'pulado'> {
  const par = (await paresDoGerador()).find((p) => p.codigo === codigo);
  if (!par) return null;
  const r = await derivarPares([par], ctx);
  if (r.pulados.has(codigo)) return 'pulado';
  return r.derivadas.get(codigo) ?? null;
}

/** As colunas que a linha do /gerador pode preencher (o POST /campo só procura a derivada nessas). */
export const CHAVES_DERIVADAS: ReadonlySet<string> = new Set([
  'cliente', 'homologacao', 'consultor', 'cadastro_trello', 'contato', 'endereco', 'cidade', 'uf', 'concessionaria',
  'qtd_placa', 'modelo_placa', 'pot_placa', 'qtd_inversor', 'modelo_inversor', 'modelo_voltagem_inversor',
  'excedentes', 'engenheiro', 'contrato_coop', 'tempo_contrato_coop', 'valor_venda', 'forma_pagto',
]);
