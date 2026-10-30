// Lista de compras da vistoria: toda a lógica da tela, sem React, sem rede e sem DOM.
//
// Este arquivo é PURO. Só importa de ./comprasTipos: o catálogo entra por PARÂMETRO (nunca por import) e os
// textos da tela moram em comprasTextos.ts. O teste vistoriaComprasDashboard (na api/) lê o arquivo por texto,
// por isso ele não pode importar React, '@/' nem nada de fora desta pasta.
//
// Sete funções repetem, idênticas, as da API (api/src/services/vistoria/compras.ts): limparTexto, lerQtd,
// formatarQtd, unidadePorExtenso, frasesResumo, prazoDe e a regra de normalizarLinha (a sanitizarLinha da API).
// O teste prova que as duas pontas dão a mesma saída para o mesmo corpus. Mudou lá, muda aqui.
//
// Nenhuma função muda o que recebe: todas devolvem objetos novos. Não há preço, marca de fabricante nem nome de
// loja em lugar nenhum da lista.

import { CHAVES_ITENS, LIMITES, QUEM, UNIDADES } from './comprasTipos';
import type {
  ComprasEstado, EntradaCatalogo, EntradaSugerida, GrupoSugestao, LinhaCompra, MapaStatus, Prazo, Quem,
  TextoGerado, Unidade,
} from './comprasTipos';

// ---------------------------------------------------------------------------------------------------------
// Limpeza de texto e quantidade (idênticas às da API)
// ---------------------------------------------------------------------------------------------------------

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;
const CONTROLE = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Limpa todo texto de linha. Só aceita string (o resto vira ''). Troca travessão (U+2013 e U+2014) por hífen,
 * tira emoji e símbolos, troca caractere de controle por espaço, junta espaços e quebras de linha num espaço só,
 * apara, corta no limite e põe a primeira letra em maiúscula. Aceita `unknown` como a da API.
 */
export function limparTexto(bruto: unknown, max: number): string {
  if (typeof bruto !== 'string') return '';
  let t = bruto.replace(/[\u2013\u2014]/g, '-').replace(EMOJI, '').replace(CONTROLE, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > max) t = t.slice(0, max).trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * Quantidade: só number finito, de 0,01 a 99.999, com no máximo 2 casas. Qualquer outra coisa (texto, NaN, zero,
 * negativo, acima do teto) vira null e NÃO derruba a linha. Mesmo algoritmo da API:
 *   1. v não é number finito: null.
 *   2. v < 0.005 ou v > 100000: null (arredondaria para zero ou passaria do teto; também evita a notação
 *      exponencial de String(v), que quebraria o passo 3).
 *   3. r = Number(Math.round(Number(`${v}e2`)) + 'e-2'). Arredonda pela escrita decimal e o meio sobe;
 *      v * 100 erra em ponto flutuante (1.005 * 100 dá 100.49999999999999).
 *   4. r não finito, r < 0.01 ou r > 99999: null.
 *   5. senão r.
 */
export function lerQtd(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < 0.005 || v > 100000) return null;
  const r = Number(Math.round(Number(`${v}e2`)) + 'e-2');
  if (!Number.isFinite(r) || r < 0.01 || r > LIMITES.qtdMax) return null;
  return r;
}

const LETRAS = 'abcdefghijklmnopqrstuvwxyz';
const DATA_MAXIMA = 8.64e15;

/**
 * Id novo da linha, criado NO APARELHO no toque: o tempo em base 36 (mínimo de 2 caracteres) mais 4 letras ao
 * acaso. Sempre casa ^[a-z0-9]{6,24}$. `agora` e `aleatorio` entram por parâmetro para os testes fixarem o
 * resultado; o sorteio é limitado ao alfabeto, mesmo que `aleatorio` devolva 1 ou lixo.
 */
export function criarId(agora: number = Date.now(), aleatorio: () => number = Math.random): string {
  const tempo = Number.isFinite(agora) ? Math.min(DATA_MAXIMA, Math.max(0, Math.floor(agora))) : 0;
  let sufixo = '';
  for (let i = 0; i < 4; i++) {
    const r = aleatorio();
    const posicao = Number.isFinite(r) ? Math.floor(r * LETRAS.length) : 0;
    sufixo += LETRAS.charAt(Math.min(LETRAS.length - 1, Math.max(0, posicao)));
  }
  return tempo.toString(36).padStart(2, '0') + sufixo;
}

// ---------------------------------------------------------------------------------------------------------
// Saneamento da linha (a sanitizarLinha da API, com o nome que a tela usa)
// ---------------------------------------------------------------------------------------------------------

const RE_ID = /^[a-z0-9]{6,24}$/;
const RE_CID = /^[a-z0-9-]{1,40}$/;
const RE_TS = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function ehUnidade(v: unknown): v is Unidade {
  return typeof v === 'string' && (UNIDADES as readonly string[]).includes(v);
}
function ehQuem(v: unknown): v is Quem {
  return typeof v === 'string' && (QUEM as readonly string[]).includes(v);
}
function ehChaveItem(v: unknown): v is string {
  return typeof v === 'string' && (CHAVES_ITENS as readonly string[]).includes(v);
}

/** ISO de data ou de data e hora, até 32 caracteres. Qualquer outra coisa é omitida. */
function lerTs(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0 || t.length > 32 || !RE_TS.test(t) || Number.isNaN(Date.parse(t))) return undefined;
  return t;
}

/**
 * Normaliza UMA linha com as mesmas regras da API (a paridade é testada). Nunca lança. Devolve null quando a
 * linha não presta: id fora de ^[a-z0-9]{6,24}$, tipo desconhecido, material sem nome de 2 letras ou mais, nota
 * sem texto. Aceita `unknown` para receber direto o que veio da rede.
 *
 * Forma de saída:
 *   material: id, tipo, nome, esp (se houver), qtd (sempre presente, number ou null), un, quem, item e cid (se
 *   válidos), obs (sempre string, '' se não houver) e ts (se válido). Serviço grava qtd null.
 *   obs (nota livre): id, tipo, obs, item, cid e ts. Sem nome, esp, qtd, un nem quem.
 */
export function normalizarLinha(bruto: unknown): LinhaCompra | null {
  try {
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
    const b = bruto as Record<string, unknown>;

    const id = b.id;
    if (typeof id !== 'string' || !RE_ID.test(id)) return null;

    const item = ehChaveItem(b.item) ? b.item : undefined;
    const cid = typeof b.cid === 'string' && RE_CID.test(b.cid) ? b.cid : undefined;
    const ts = lerTs(b.ts);

    if (b.tipo === 'obs') {
      const obs = limparTexto(b.obs, LIMITES.obsNota);
      if (!obs) return null;
      return {
        id,
        tipo: 'obs',
        ...(item ? { item } : {}),
        ...(cid ? { cid } : {}),
        obs,
        ...(ts ? { ts } : {}),
      };
    }

    if (b.tipo === 'material') {
      const nome = limparTexto(b.nome, LIMITES.nome);
      if (nome.length < 2) return null;
      const esp = limparTexto(b.esp, LIMITES.esp);
      const un: Unidade = ehUnidade(b.un) ? b.un : 'un';
      const quem: Quem = ehQuem(b.quem) ? b.quem : 'a_definir';
      return {
        id,
        tipo: 'material',
        nome,
        ...(esp ? { esp } : {}),
        qtd: un === 'servico' ? null : lerQtd(b.qtd),
        un,
        quem,
        ...(item ? { item } : {}),
        ...(cid ? { cid } : {}),
        obs: limparTexto(b.obs, LIMITES.obsLinha),
        ...(ts ? { ts } : {}),
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Prazo, quantidade e resumo (idênticos aos da API)
// ---------------------------------------------------------------------------------------------------------

/** O prazo nasce do status do item ligado: não conforme é alta, atenção é média, o resto não tem prazo. */
export function prazoDe(item: string | undefined, status: MapaStatus): Prazo {
  if (!item || !status) return null;
  const s = status[item];
  if (s === 'nao_conforme') return 'alta';
  if (s === 'atencao') return 'media';
  return null;
}

/**
 * Quantidade em pt-BR sem Intl: vírgula nos decimais, ponto no milhar, sem zero sobrando. 12.5 vira "12,5",
 * 1200 vira "1.200", 3 vira "3". Pensada para valor já saneado (2 casas). Não finito dá ''.
 */
export function formatarQtd(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const [inteira, decimais] = Math.abs(n).toFixed(2).split('.');
  const resto = (decimais ?? '').replace(/0+$/, '');
  const milhar = (inteira ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sinal = n < 0 && (Number(inteira) !== 0 || resto !== '') ? '-' : '';
  return `${sinal}${milhar}${resto ? ',' + resto : ''}`;
}

const POR_EXTENSO: Record<Unidade, [string, string]> = {
  un: ['unidade', 'unidades'],
  m: ['metro', 'metros'],
  pc: ['peça', 'peças'],
  cj: ['conjunto', 'conjuntos'],
  barra: ['barra', 'barras'],
  servico: ['serviço', 'serviços'],
};

/** Singular só quando a quantidade é exatamente 1. Quantidade a definir (null) e qualquer outro número ficam no plural. */
export function unidadePorExtenso(un: Unidade, qtd: number | null): string {
  const par = ehUnidade(un) ? POR_EXTENSO[un] : POR_EXTENSO.un;
  return qtd === 1 ? par[0] : par[1];
}

/**
 * "8 materiais, 2 serviços e 3 observações." Omite o que for zero, usa o singular quando é 1 e fecha com
 * ponto. Serviço é a linha de material com unidade `servico`. Lista vazia dá ''.
 */
export function frasesResumo(linhas: LinhaCompra[]): string {
  let materiais = 0;
  let servicos = 0;
  let notas = 0;
  for (const l of Array.isArray(linhas) ? linhas : []) {
    if (!l || typeof l !== 'object') continue;
    if (l.tipo === 'obs') notas++;
    else if (l.un === 'servico') servicos++;
    else materiais++;
  }
  const partes: string[] = [];
  if (materiais) partes.push(`${materiais} ${materiais === 1 ? 'material' : 'materiais'}`);
  if (servicos) partes.push(`${servicos} ${servicos === 1 ? 'serviço' : 'serviços'}`);
  if (notas) partes.push(`${notas} ${notas === 1 ? 'observação' : 'observações'}`);
  if (partes.length === 0) return '';
  const ultima = partes[partes.length - 1];
  const texto = partes.length === 1 ? ultima : `${partes.slice(0, -1).join(', ')} e ${ultima}`;
  return `${texto}.`;
}

// ---------------------------------------------------------------------------------------------------------
// Linhas novas
// ---------------------------------------------------------------------------------------------------------

/** Nota que nasce junto com a linha de uma entrada do catálogo que avisa de amianto. */
const AMIANTO_OBS = 'Telha de fibrocimento antiga, pode ter amianto. Não furar nem cortar.';

/**
 * Linha criada por uma entrada do catálogo. Copia nome, especificação, unidade, quem providencia e cid; o item é
 * o do contexto. A quantidade nasce 1 para unidade e conjunto e "a definir" (null) para o resto (metro, barra e
 * peça pedem a quantidade na tela; serviço nunca tem). A entrada com aviso de amianto nasce com a nota pronta.
 */
export function linhaDoCatalogo(e: EntradaCatalogo, ctx: { item?: string; agora: string; id: string }): LinhaCompra {
  const bruta: LinhaCompra = {
    id: ctx.id,
    tipo: 'material',
    nome: e.nome,
    esp: e.esp,
    qtd: e.un === 'un' || e.un === 'cj' ? 1 : null,
    un: e.un,
    quem: e.quem,
    item: ctx.item,
    cid: e.cid,
    obs: e.aviso === 'amianto' ? AMIANTO_OBS : '',
    ts: ctx.agora,
  };
  return normalizarLinha(bruta) ?? bruta;
}

/** Linha de material digitada pelo técnico (sem catálogo, sem cid). O texto passa pela mesma limpeza da API. */
export function linhaLivre(
  d: { nome: string; esp?: string; qtd: number | null; un: Unidade; quem: Quem; item?: string; obs?: string },
  ctx: { agora: string; id: string },
): LinhaCompra {
  const bruta: LinhaCompra = {
    id: ctx.id,
    tipo: 'material',
    nome: d.nome,
    esp: d.esp,
    qtd: d.qtd,
    un: d.un,
    quem: d.quem,
    item: d.item,
    obs: d.obs ?? '',
    ts: ctx.agora,
  };
  return normalizarLinha(bruta) ?? bruta;
}

/** Observação livre: sem nome, sem quantidade, sem unidade. */
export function linhaNota(d: { obs: string; item?: string }, ctx: { agora: string; id: string }): LinhaCompra {
  const bruta: LinhaCompra = { id: ctx.id, tipo: 'obs', item: d.item, obs: d.obs, ts: ctx.agora };
  return normalizarLinha(bruta) ?? bruta;
}

// ---------------------------------------------------------------------------------------------------------
// Operações na lista
// ---------------------------------------------------------------------------------------------------------

function linhasDe(c: ComprasEstado): LinhaCompra[] {
  return Array.isArray(c?.linhas) ? c.linhas : [];
}

/** Sem acento, em minúsculas, para comparar e buscar. */
function semAcento(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function chaveTexto(t: string | undefined): string {
  return semAcento(t ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Duplicada quando o id já existe; quando a linha tem cid e o cid já está na lista; sem cid, quando já há
 * material com o mesmo nome (sem acento, minúsculas), a mesma unidade e o mesmo "quem providencia". Observação:
 * mesmo texto e mesmo item. A regra de nome só vale para material (observação não tem nome, e duas
 * observações diferentes nunca se comparam por nome).
 */
function ehDuplicada(linhas: LinhaCompra[], nova: LinhaCompra): boolean {
  if (linhas.some((x) => x.id === nova.id)) return true;
  if (nova.cid) return linhas.some((x) => x.cid === nova.cid);
  if (nova.tipo === 'obs') {
    const texto = chaveTexto(nova.obs);
    return linhas.some((x) => x.tipo === 'obs' && chaveTexto(x.obs) === texto && (x.item ?? '') === (nova.item ?? ''));
  }
  const nome = chaveTexto(nova.nome);
  return linhas.some((x) => x.tipo === 'material' && chaveTexto(x.nome) === nome && x.un === nova.un && x.quem === nova.quem);
}

/**
 * Põe a linha no fim da lista. 'cheia' quando já há 60 linhas; 'duplicada' conforme a regra acima (a lista não
 * muda); 'invalida' quando a linha não passa na normalização (a tela não deixa chegar aqui, mas a função não
 * confia). Só 'adicionada' devolve a lista com a linha nova, já normalizada.
 */
export function adicionarLinha(
  c: ComprasEstado,
  l: LinhaCompra,
): { estado: ComprasEstado; resultado: 'adicionada' | 'duplicada' | 'cheia' | 'invalida' } {
  const linhas = linhasDe(c);
  if (linhas.length >= LIMITES.linhas) return { estado: c, resultado: 'cheia' };
  const nova = normalizarLinha(l);
  if (!nova) return { estado: c, resultado: 'invalida' };
  if (ehDuplicada(linhas, nova)) return { estado: c, resultado: 'duplicada' };
  return { estado: { ...c, linhas: [...linhas, nova] }, resultado: 'adicionada' };
}

/** Tira a linha pelo id. Devolve também a linha e a posição, para o "Desfazer". Id que não existe não muda nada. */
export function removerLinha(
  c: ComprasEstado,
  id: string,
): { estado: ComprasEstado; removida?: { linha: LinhaCompra; indice: number } } {
  const linhas = linhasDe(c);
  const indice = linhas.findIndex((x) => x.id === id);
  if (indice < 0) return { estado: c };
  return {
    estado: { ...c, linhas: linhas.filter((_, i) => i !== indice) },
    removida: { linha: linhas[indice], indice },
  };
}

/**
 * Desfaz a remoção: devolve a linha à posição de antes (ou ao fim, se a lista encolheu). Não faz nada se o id já
 * voltou, se a linha não passa na normalização ou se a lista já está nas 60 linhas.
 */
export function restaurarLinha(c: ComprasEstado, linha: LinhaCompra, indice: number): ComprasEstado {
  const linhas = linhasDe(c);
  const nova = normalizarLinha(linha);
  if (!nova || linhas.length >= LIMITES.linhas || linhas.some((x) => x.id === nova.id)) return c;
  const posicao = Math.min(linhas.length, Math.max(0, Number.isFinite(indice) ? Math.floor(indice) : linhas.length));
  return { ...c, linhas: [...linhas.slice(0, posicao), nova, ...linhas.slice(posicao)] };
}

/**
 * Muda campos de uma linha. Junta o patch, normaliza de novo e põe o `ts` de agora. O id e o tipo nunca mudam.
 * Se o resultado não passa na normalização (nome com menos de 2 letras, por exemplo), a lista fica como estava:
 * editar errado nunca apaga a linha. Para tirar o vínculo com um item, passe `item: undefined`.
 */
export function atualizarLinha(c: ComprasEstado, id: string, patch: Partial<LinhaCompra>, agora: string): ComprasEstado {
  const linhas = linhasDe(c);
  const indice = linhas.findIndex((x) => x.id === id);
  if (indice < 0) return c;
  const atual = linhas[indice];
  const nova = normalizarLinha({ ...atual, ...patch, id: atual.id, tipo: atual.tipo, ts: agora });
  if (!nova) return c;
  return { ...c, linhas: linhas.map((x, i) => (i === indice ? nova : x)) };
}

// ---------------------------------------------------------------------------------------------------------
// Sugestões pelo status dos itens
// ---------------------------------------------------------------------------------------------------------

type Alvo = 'atencao' | 'nao_conforme';

/** Os 10 itens que têm status, na ordem do checklist (conta de luz e documento não têm). */
const ITENS_TECNICOS: string[] = CHAVES_ITENS.filter((k) => k !== 'conta_luz' && k !== 'documento_pessoal');

const ORDEM_ALTERNATIVA: Record<'telha' | 'laje', number> = { telha: 0, laje: 1 };

/** Uma entrada que o item dispara, com o peso do gatilho e a posição no catálogo (para o desempate). */
type Disparada = { sugestao: EntradaSugerida; ordem: number };
const porPeso = (a: Disparada, b: Disparada) => a.sugestao.peso - b.sugestao.peso || a.ordem - b.ordem;
const porAlternativa = (a: Disparada, b: Disparada) =>
  ORDEM_ALTERNATIVA[a.sugestao.entrada.alternativa ?? 'telha'] - ORDEM_ALTERNATIVA[b.sugestao.entrada.alternativa ?? 'telha']
  || porPeso(a, b);

/** Itens marcados Atenção ou Não conforme: os não conformes antes, cada bloco na ordem do checklist. */
function itensMarcados(status: MapaStatus | null | undefined): { item: string; alvo: Alvo }[] {
  const mapa: MapaStatus = status && typeof status === 'object' ? status : {};
  const naoConformes = ITENS_TECNICOS.filter((k) => mapa[k] === 'nao_conforme').map((item) => ({ item, alvo: 'nao_conforme' as Alvo }));
  const atencoes = ITENS_TECNICOS.filter((k) => mapa[k] === 'atencao').map((item) => ({ item, alvo: 'atencao' as Alvo }));
  return [...naoConformes, ...atencoes];
}

/** O menor peso entre os gatilhos da entrada que casam com o item e o status. Null se nenhum casa. */
function pesoNoItem(e: EntradaCatalogo, item: string, alvo: Alvo): 1 | 2 | 3 | null {
  let melhor: 1 | 2 | 3 | null = null;
  for (const g of e.gatilhos ?? []) {
    if (g.item !== item) continue;
    const casa = alvo === 'atencao' ? g.quando.includes('A') : g.quando.includes('N');
    if (casa && (melhor === null || g.peso < melhor)) melhor = g.peso;
  }
  return melhor;
}

/** Os cids que já estão na lista ou foram dispensados: não são sugestão pendente. */
function cidsBloqueados(linhas: LinhaCompra[], dispensadas: Iterable<string> | null | undefined): Set<string> {
  const out = new Set<string>(dispensadas ?? []);
  for (const l of Array.isArray(linhas) ? linhas : []) if (l && l.cid) out.add(l.cid);
  return out;
}

/**
 * O que o item dispara, no catálogo, para o status dado. Entrada `sempre` nunca é sugerida sozinha. Cada entrada
 * traz o peso do gatilho que casou. Devolve na ordem do catálogo; quem usa ordena.
 */
function disparadasPeloItem(
  catalogo: EntradaCatalogo[],
  item: string,
  alvo: Alvo,
  bloqueados: Set<string>,
  jaMostradas?: Set<string>,
): Disparada[] {
  const out: Disparada[] = [];
  catalogo.forEach((e, ordem) => {
    if (e.sempre || bloqueados.has(e.cid) || (jaMostradas && jaMostradas.has(e.cid))) return;
    const peso = pesoNoItem(e, item, alvo);
    if (peso !== null) out.push({ sugestao: { entrada: e, peso }, ordem });
  });
  return out;
}

/**
 * As sugestões pendentes, agrupadas por item marcado. Dispara só com status Atenção ou Não conforme (conforme,
 * N/A e item sem status não sugerem). Grupos: os Não conforme antes dos Atenção, cada bloco na ordem do
 * checklist. Dentro do grupo: as entradas principais por peso (1 primeiro) e depois pela ordem do catálogo, e
 * em seguida as alternativas excludentes (telha, depois laje), com a mesma ordem. A tela separa as
 * alternativas pelo campo `entrada.alternativa` e nunca as adiciona em lote.
 *
 * Cada entrada aparece UMA vez, no primeiro grupo em que se qualifica (o do status mais grave; empate, o primeiro
 * do checklist). Fica de fora a entrada `sempre`, a que já está na lista (mesmo cid) e a dispensada.
 */
export function sugerir(
  catalogo: EntradaCatalogo[],
  status: MapaStatus,
  linhas: LinhaCompra[],
  dispensadas: Iterable<string>,
): GrupoSugestao[] {
  const bloqueados = cidsBloqueados(linhas, dispensadas);
  const jaMostradas = new Set<string>();
  const grupos: GrupoSugestao[] = [];
  for (const { item, alvo } of itensMarcados(status)) {
    const disparadas = disparadasPeloItem(catalogo, item, alvo, bloqueados, jaMostradas);
    if (disparadas.length === 0) continue;
    const principais = disparadas.filter((d) => !d.sugestao.entrada.alternativa).sort(porPeso);
    const alternativas = disparadas.filter((d) => !!d.sugestao.entrada.alternativa).sort(porAlternativa);
    const entradas = [...principais, ...alternativas].map((d) => d.sugestao);
    for (const x of entradas) jaMostradas.add(x.entrada.cid);
    grupos.push({ item, status: alvo, entradas });
  }
  return grupos;
}

/**
 * Para a faixa de cada item ("Sugestões de compra: n"): quantas entradas AQUELE item dispara e ainda não estão
 * na lista nem foram dispensadas. Conta tudo o que o item dispara, inclusive o que já aparece em outro grupo e as
 * alternativas. Só tem chave para os itens marcados Atenção ou Não conforme (o valor pode ser 0).
 */
export function contagemPorItem(
  catalogo: EntradaCatalogo[],
  status: MapaStatus,
  linhas: LinhaCompra[],
  dispensadas: Iterable<string>,
): Record<string, number> {
  const bloqueados = cidsBloqueados(linhas, dispensadas);
  const out: Record<string, number> = {};
  for (const { item, alvo } of itensMarcados(status)) {
    out[item] = disparadasPeloItem(catalogo, item, alvo, bloqueados).length;
  }
  return out;
}

/**
 * As sugestões pendentes de UM item (a folha "Atenção" ou "Não conforme" daquele item), por peso e depois pela
 * ordem do catálogo. `principais` são as que "Adicionar as sugeridas" põe em lote; `alternativas` vêm em grupos
 * (telha, depois laje) que a tela mostra separados e que nunca entram em lote. Item que não está marcado
 * Atenção nem Não conforme devolve tudo vazio.
 *
 * É pendente quem não está na lista nem foi dispensado: ao tocar em "Adicionar" a entrada sai do resultado.
 * Para a linha virar contador no mesmo lugar, a folha guarda o resultado de quando abriu e olha o estado atual
 * só para saber o que já está na lista (pelo cid).
 */
export function sugestoesDoItem(
  catalogo: EntradaCatalogo[],
  item: string,
  status: MapaStatus,
  linhas: LinhaCompra[],
  dispensadas: Iterable<string>,
): { principais: EntradaSugerida[]; alternativas: { grupo: 'telha' | 'laje'; entradas: EntradaSugerida[] }[] } {
  const marcado = itensMarcados(status).find((m) => m.item === item);
  if (!marcado) return { principais: [], alternativas: [] };
  const disparadas = disparadasPeloItem(catalogo, item, marcado.alvo, cidsBloqueados(linhas, dispensadas));
  const principais = disparadas.filter((d) => !d.sugestao.entrada.alternativa).sort(porPeso).map((d) => d.sugestao);
  const alternativas = (['telha', 'laje'] as const)
    .map((grupo) => ({
      grupo,
      entradas: disparadas.filter((d) => d.sugestao.entrada.alternativa === grupo).sort(porPeso).map((d) => d.sugestao),
    }))
    .filter((g) => g.entradas.length > 0);
  return { principais, alternativas };
}

/**
 * O que "Adicionar as sugeridas" leva de uma vez: as pendentes, SEM as entradas que trazem aviso de amianto (a remoção
 * de telhado com amianto). A vistoria não sabe que o telhado é de fibrocimento só porque o tipo de telha está marcado
 * Atenção ou Não conforme; esse serviço só entra por toque direto, uma entrada por vez, depois de o técnico conferir.
 */
export function loteDeSugeridas<T extends { entrada: EntradaCatalogo }>(pendentes: readonly T[]): T[] {
  return pendentes.filter((x) => !x.entrada.aviso);
}

/**
 * O item que dispara a entrada neste momento: o do status mais grave (os Não conforme antes dos Atenção, e dentro
 * de cada bloco a ordem do checklist), o mesmo grupo em que a entrada aparece em sugerir. Serve para a linha criada
 * pela busca ou pelas categorias: o `item` só é preenchido quando algum item marcado dispara a entrada. Devolve
 * undefined se nenhum item marcado a dispara (entrada `sempre` não tem gatilho, então nunca é disparada). Não olha
 * a lista nem as dispensadas: dispensar esconde a sugestão, não desfaz o gatilho.
 */
export function itemQueDispara(entrada: EntradaCatalogo, status: MapaStatus): string | undefined {
  return itensMarcados(status).find((m) => pesoNoItem(entrada, m.item, m.alvo) !== null)?.item;
}

/**
 * Busca no catálogo inteiro (inclusive as entradas `sempre`). Ignora acento e maiúscula. Cada palavra digitada
 * tem de aparecer no nome ou na especificação; quem casa no nome vem antes de quem casa só na especificação, e
 * cada bloco segue a ordem do catálogo. Texto vazio devolve [].
 */
export function buscar(catalogo: EntradaCatalogo[], texto: string): EntradaCatalogo[] {
  const termos = semAcento(typeof texto === 'string' ? texto : '').split(/\s+/).filter((t) => t.length > 0);
  if (termos.length === 0) return [];
  const noNome: EntradaCatalogo[] = [];
  const naEspecificacao: EntradaCatalogo[] = [];
  for (const e of catalogo) {
    const nome = semAcento(e.nome);
    if (termos.every((t) => nome.includes(t))) {
      noNome.push(e);
      continue;
    }
    const tudo = `${nome} ${semAcento(e.esp)}`;
    if (termos.every((t) => tudo.includes(t))) naEspecificacao.push(e);
  }
  return [...noNome, ...naEspecificacao];
}

// ---------------------------------------------------------------------------------------------------------
// Texto para o WhatsApp
// ---------------------------------------------------------------------------------------------------------

const FORMATACAO_WHATSAPP = /[*_~`]/g;

/**
 * Texto digitado que vai para o WhatsApp: o WhatsApp formata com asterisco, sublinhado, til e crase, então eles
 * saem. Asterisco entre dígitos (4*6) vira "x". Junta espaços e mantém a primeira letra em maiúscula.
 */
function paraWhatsapp(texto: string | undefined): string {
  if (typeof texto !== 'string') return '';
  const t = texto
    .replace(/(\d)(\s*)\*(?=\s*\d)/g, '$1$2x')
    .replace(FORMATACAO_WHATSAPP, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/**
 * Só o primeiro nome do cliente. Se o nome está todo em maiúsculas, só a inicial fica maiúscula ("CARLOS" vira
 * "Carlos"). Sem nome, ou "Vistoria avulsa" (a vistoria sem cliente), devolve ''. Já sai limpo para o
 * WhatsApp: sem asterisco, sublinhado, til, crase, emoji nem travessão.
 */
export function primeiroNome(nomeCliente: string | null | undefined): string {
  if (typeof nomeCliente !== 'string') return '';
  const limpo = nomeCliente
    .replace(/[\u2013\u2014]/g, '-')
    .replace(EMOJI, '')
    .replace(CONTROLE, ' ')
    .replace(FORMATACAO_WHATSAPP, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpo || limpo.toLowerCase() === 'vistoria avulsa') return '';
  const primeira = limpo.split(' ')[0];
  const todaEmMaiuscula = primeira === primeira.toUpperCase() && primeira !== primeira.toLowerCase();
  return todaEmMaiuscula ? primeira.charAt(0) + primeira.slice(1).toLowerCase() : primeira;
}

const unDe = (l: LinhaCompra): Unidade => (ehUnidade(l.un) ? l.un : 'un');
const quemDe = (l: LinhaCompra): Quem => (ehQuem(l.quem) ? l.quem : 'a_definir');
const qtdDe = (l: LinhaCompra): number | null => (unDe(l) === 'servico' || typeof l.qtd !== 'number' ? null : l.qtd);

/** "120 metros", "1 unidade". Sem quantidade (ou serviço), ''. Espaço comum: o texto vai para o WhatsApp. */
function quantidadeTexto(l: LinhaCompra): string {
  const qtd = qtdDe(l);
  return qtd === null ? '' : `${formatarQtd(qtd)} ${unidadePorExtenso(unDe(l), qtd)}`;
}

const quantos = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

/**
 * Texto de cotação para o fornecedor. Entram os materiais que não são serviço e que não são do cliente
 * (integrador e a combinar), na ordem da lista. Ficam de fora serviços, itens do cliente e observações. A
 * especificação (`esp`) vai; a nota da linha (`obs`) não vai, ela é do relatório. Sem link, sem sobrenome, sem
 * endereço, sem telefone e sem o nome do item da vistoria.
 *
 * `fora` conta o que ficou de fora ("Fora do texto: 2 serviços e 3 itens do cliente."): primeiro os serviços, de
 * quem for, e depois os outros itens do cliente. `avisos` traz "Inclui n item(ns) a combinar." e "Falta a
 * quantidade em n item(ns)." quando for o caso. Sem material elegível, `pode` é false e `texto` é ''.
 */
export function textoFornecedor(c: ComprasEstado, ctx: { clienteNome: string | null }): TextoGerado {
  const linhas = linhasDe(c).filter((l) => l && l.tipo === 'material');
  const servicos = linhas.filter((l) => unDe(l) === 'servico').length;
  const doCliente = linhas.filter((l) => unDe(l) !== 'servico' && quemDe(l) === 'cliente').length;
  const incluidas = linhas.filter((l) => unDe(l) !== 'servico' && quemDe(l) !== 'cliente');

  const partesFora: string[] = [];
  if (servicos > 0) partesFora.push(quantos(servicos, 'serviço', 'serviços'));
  if (doCliente > 0) partesFora.push(quantos(doCliente, 'item do cliente', 'itens do cliente'));
  const fora = partesFora.length > 0 ? `Fora do texto: ${partesFora.join(' e ')}.` : '';

  if (incluidas.length === 0) return { texto: '', pode: false, fora, avisos: [] };

  const avisos: string[] = [];
  const aCombinar = incluidas.filter((l) => quemDe(l) === 'a_definir').length;
  if (aCombinar > 0) avisos.push(`Inclui ${quantos(aCombinar, 'item', 'itens')} a combinar.`);
  const semQtd = incluidas.filter((l) => qtdDe(l) === null).length;
  if (semQtd > 0) avisos.push(`Falta a quantidade em ${quantos(semQtd, 'item', 'itens')}.`);

  const nome = primeiroNome(ctx.clienteNome);
  const cabecalho = ['Olá, preciso de cotação dos materiais abaixo.'];
  if (nome) cabecalho.push(`Obra: ${nome}`);

  const corpo: string[] = [];
  incluidas.forEach((l, i) => {
    const qtd = quantidadeTexto(l) || 'quantidade a confirmar';
    corpo.push(`${i + 1}. ${paraWhatsapp(l.nome)}: ${qtd}`);
    const esp = paraWhatsapp(l.esp);
    if (esp) corpo.push(`   ${esp}`);
  });

  const texto = [
    ...cabecalho,
    '',
    ...corpo,
    '',
    `Total: ${quantos(incluidas.length, 'item', 'itens')}.`,
    'Pode passar preço, prazo e disponibilidade?',
  ].join('\n');
  return { texto, pode: true, fora, avisos };
}

const GRUPOS_PRAZO: { prazo: Prazo; titulo: string }[] = [
  { prazo: 'alta', titulo: '*Antes de instalar*' },
  { prazo: 'media', titulo: '*Antes ou durante a instalação*' },
  { prazo: null, titulo: '*Demais itens*' },
];

/**
 * Texto para o cliente com o que ele precisa providenciar. Entram as linhas do cliente, material e serviço,
 * agrupadas pelo prazo do item ligado, lido do `status` LOCAL: "Antes de instalar" (item Não conforme),
 * "Antes ou durante a instalação" (Atenção) e "Demais itens". Numeração contínua entre os grupos. Quantidade só
 * quando existe; sem especificação e sem nota. Itens "a combinar" ficam fora e o aviso conta quantos.
 *
 * Termina com o link do relatório numa linha própria, só com `incluirLink` (lista visível no relatório). Sem
 * item do cliente, `pode` é false e `texto` é ''.
 */
export function textoCliente(
  c: ComprasEstado,
  status: MapaStatus,
  ctx: { clienteNome: string | null; urlRelatorio: string; incluirLink: boolean },
): TextoGerado {
  const materiais = linhasDe(c).filter((l) => l && l.tipo === 'material');
  const doCliente = materiais.filter((l) => quemDe(l) === 'cliente');
  const aCombinar = materiais.filter((l) => quemDe(l) === 'a_definir').length;
  const avisos: string[] = [];
  if (aCombinar > 0) avisos.push(`Não inclui ${quantos(aCombinar, 'item', 'itens')} a combinar.`);

  if (doCliente.length === 0) return { texto: '', pode: false, fora: '', avisos };

  const nome = primeiroNome(ctx.clienteNome);
  const saudacao = `${nome ? `Olá, ${nome}.` : 'Olá.'} Na vistoria, vimos o que precisa ser providenciado para a instalação.`;

  const blocos: string[] = [saudacao];
  let numero = 0;
  for (const g of GRUPOS_PRAZO) {
    const doGrupo = doCliente.filter((l) => prazoDe(l.item, status) === g.prazo);
    if (doGrupo.length === 0) continue;
    const linhasDoGrupo = doGrupo.map((l) => {
      numero++;
      const qtd = quantidadeTexto(l);
      return `${numero}. ${paraWhatsapp(l.nome)}${qtd ? `: ${qtd}` : ''}`;
    });
    blocos.push([g.titulo, ...linhasDoGrupo].join('\n'));
  }
  if (ctx.incluirLink && ctx.urlRelatorio) blocos.push(['Os detalhes estão no relatório:', ctx.urlRelatorio].join('\n'));

  return { texto: blocos.join('\n\n'), pode: true, fora: '', avisos };
}
