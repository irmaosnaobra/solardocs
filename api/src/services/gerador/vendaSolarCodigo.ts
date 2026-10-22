// ─────────────────────────────────────────────────────────────────────────────
// ALOCADOR DO `#NNNN` DA VENDA SOLAR (fase 2, 22/10/2026). UM só lugar no servidor dá o número do cliente novo: o mesmo no Trello,
// na planilha de clientes do /gerador e na pasta de contratos.
//
// A PLANILHA DO EXCEL NÃO TRAVA O NÚMERO (regra do dono, 22/10/2026): ela é CONFERÊNCIA. Leitura fresca falhou: vale a cópia em
// cache (até 6 h), com `planilhaFora: true` e um aviso curto. Sem cópia nenhuma o Excel é DESCONHECIDO (nunca "vazio"): nenhum
// número morto é reaproveitado, só se adota número de cartão criado pelo /gerador (depois da fase 1), e o pedido sem `novo` (botão
// e rota do Trello, caminhos de card antigo) vira `confirmar` sem candidatos. O gancho do VENDIDO manda `novo` e numera direto.
// O quadro do Trello continua obrigatório: na transição ele tem números à frente do registro.
//
// Próximo número = o maior entre a planilha mãe (4 dígitos), os registros VIVOS (`codigo_solar:<NNNN>` de card ainda `fechou`), as
// vendas das ligações de cards `fechou` e os títulos do quadro do Trello (abertos e arquivados), mais 1. Alocar = gravar o registro
// "código -> card" e a ligação `venda_solar:<card>` com `venda` = código, as duas ASSINADAS e sem dado pessoal.
//
// Regras do dono que valem aqui:
//   - Telefone NÃO identifica cliente (família usa o mesmo número). O alocador nunca liga venda da planilha nem proposta por
//     telefone: telefone igual só vira PERGUNTA (o portão, sem `novo`) ou AVISO (com os códigos que quem pede pode ver).
//   - O alocador não lê cadastro, não compara nomes, não lê a lista de propostas e não recebe código de proposta: a `proposta` que
//     a ligação já tem é PRESERVADA. Toda ligação que ele grava leva `por: 'gerador'`; nenhuma leva `por: 'auto'`.
//   - O card que já tem cartão CONFIÁVEL no Trello com `#NNNN` no título (sem linha no Excel) ADOTA esse número, antes do portão.
//     Confiável = nasceu a partir do deploy da fase 1 (pela data do id do Trello) ou a pessoa o escolheu neste pedido.
//
// OUTRAS SÉRIES (ex.: `#E001` do eletroposto): `alocarCodigoDaSerie`, só com registro, trava e máximo dos registros da série.
//
// Travas, sempre nesta ordem: `trello:<card>` (só a rota do Trello) -> `trello_numero_solar` -> `vendasolar_vinculos`.
// Serviço: NÃO importa rota (ciclo de boot em CommonJS). Nenhum log leva nome, telefone ou título: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────
import {
  ErroHub, TRAVA_VINCULOS, POR_GERADOR, segredoDoVinculo, lerLigacao, lerTodasLigacoes, gravarLigacao, quemUsa, lerCardsPorIds,
  candidatasPorTelefone, avisoMesmoTelefone, invalidarCachesHub, ligacaoSoDoTrello,
  type Ligacao, type VendaCsvParaVinculo,
} from './vendaSolarHub';
import {
  lerRegistrosDeCodigos, inserirRegistro, apagarRegistro, numeroDoCodigo, SERIE_SOLAR,
  type RegistroCodigo, type SerieCodigo,
} from './vendaSolarRegistro';
import { comTrava, ErroCadastro } from './cadastroVendaBanco';
import { lerTodosOsCartoes, lerRegistroTrello, codigoDoTitulo, criadoEmDoCartao } from './trelloVendaSolar';
import { lerRegistroComVersao } from './gestaoClientesBanco';
import { podeVer } from './solarObras';
import type { CredenciaisTrello } from './dossieVenda';
import type { CardVendido } from './fichaEletroposto';

export const TRAVA_NUMERO_SOLAR = SERIE_SOLAR.trava;       // a MESMA chave da fase 1
const TTL_TRAVA_NUMERO_MS = 360_000;                       // maior que os 300 s da função: nunca vence com o dono vivo
const ESPERA_DA_TRAVA = { tentativas: 40, esperaMs: 250 }; // espera até ~10 s por quem está na frente
const PRAZO_ANTES_DE_INSERIR_MS = 150_000;                 // contado do começo do PEDIDO, não da trava
const LIMITE_VOLTAS = 80;      // números pulados e corridas juntos
const LIMITE_CORRIDAS = 5;     // INSERT que bateu em 23505
const MAX_CODIGOS = 5;
export const AVISO_SEM_PLANILHA = 'Número conferido sem a planilha do Excel.';
/** O texto do `confirmar` quando não há cópia nenhuma da planilha (o Excel é desconhecido). */
export const MSG_SEM_PLANILHA = 'Não consegui conferir a planilha do Excel agora. Se esta venda já tem número lá, ligue a venda certa no bloco Ligações. Senão, crie o cliente novo.';
/** 22/10/2026 11:55 em Brasília (14:55 UTC): o deploy da fase 1 (fe99bfc4). Até ali a rota achava cartão POR NOME e podia guardar o cartão de outro parente. */
export const CARTAO_CONFIAVEL_DESDE_MS = Date.UTC(2026, 9, 22, 14, 55, 0);
/** O cartão nasceu depois do corte (criado pelo /gerador, pela data dos 8 primeiros hexadecimais do id). */
const criadoPeloGerador = (id: string | null | undefined): boolean => (criadoEmDoCartao(id) ?? 0) >= CARTAO_CONFIAVEL_DESDE_MS;
/** O cartão é provadamente deste card: a pessoa o escolheu neste pedido, ou ele nasceu depois do corte. */
export const cartaoConfiavel = (id: string | null | undefined, escolhido = false): boolean => escolhido || criadoPeloGerador(id);

type Planilha = { codigos: string[]; vendas: VendaCsvParaVinculo[] };
export interface DepsAlocador {
  credenciais: CredenciaisTrello | null;
  board: string;
  /** A planilha mãe, só para CONFERIR (a leitura principal). */
  lerPlanilhaAtual: () => Promise<Planilha>;
  /** A cópia em cache (até 6 h), usada quando a leitura principal falha. */
  lerPlanilhaCopia?: () => Promise<Planilha>;
}
export interface PedidoAlocador {
  card: CardVendido;                       // já validado pela rota: solar, fechou e dono
  quem: { nome: string; socio: boolean };
  novo?: boolean;                          // criar sem o portão de telefone e do cartão (o gancho do VENDIDO e "Criar novo mesmo assim" mandam true; a rota do Trello NUNCA manda)
  inicio?: number;                         // Date.now() do começo do pedido HTTP
  cartaoTrello?: string | null;            // undefined: usa o da ligação ou do registro do envio; null: nenhum (a rota vai criar um novo); string: o cartão que a rota vai usar
  cartaoEscolhido?: boolean;               // true: `cartaoTrello` veio do `card_id` mandado pela pessoa neste pedido (vale como confiável)
  cartaoSemAssinatura?: boolean;           // true: `cartaoTrello` veio só do registro do envio (sem assinatura): nunca confiável
}
export type AcaoAlocador = 'ja_ligada' | 'criou' | 'adotou_trello';
export type MotivoErroAlocador = 'trello' | 'trello_grande' | 'lento' | 'sem_segredo' | 'sem_credencial' | 'ocupado' | 'banco' | 'sequencia';
/** Códigos das linhas do Excel com o mesmo telefone que quem pede pode ver (no máximo 5) e QUANTAS ficaram de fora por não serem visíveis. */
export interface MesmoTelefone { codigos: string[]; ocultas: number }
/** Por que a linha do Excel entra na pergunta: telefone igual, ou número do título do cartão guardado. */
export type MotivoPergunta = 'telefone' | 'cartao';
/** Nunca leva telefone. */
export interface CandidatoConfirmar { codigo: string; cliente: string; data: string; motivo: MotivoPergunta }
export type ResultadoAlocador =
  | { ok: true; acao: AcaoAlocador; codigo: string; aviso?: string; mesmoTelefone?: MesmoTelefone; planilhaFora?: true }
  | { ok: false; motivo: 'confirmar'; candidatos: CandidatoConfirmar[]; ocultas: number; semPlanilha?: true }
  | { ok: false; motivo: MotivoErroAlocador };
export type ResultadoPrevia =
  | { ok: true; acao: 'ja_ligada' | 'adotaria_trello' | 'criaria'; codigo: string; provisorio: boolean; aviso?: string; mesmoTelefone?: MesmoTelefone; planilhaFora?: boolean }
  | { ok: true; acao: 'confirmar'; candidatos: CandidatoConfirmar[]; ocultas: number; semPlanilha?: true }
  | { ok: false; motivo: MotivoErroAlocador };

const logErro = (que: string, codigo: string): void => console.error(`[venda-solar-codigo] ${que}`, codigo);

class ErroAlocador extends Error {
  constructor(public motivo: MotivoErroAlocador) { super(`alocador: ${motivo}`); }
}
const erro = (motivo: MotivoErroAlocador): { ok: false; motivo: MotivoErroAlocador } => ({ ok: false, motivo });

/** `#0065` -> 65; null se não tem EXATAMENTE 4 dígitos (`#20251`, `#12` e texto ficam de fora). */
const RE_4 = /^\s*#?(\d{4})\s*$/;
const numeroDe = (c: unknown): number | null => { const m = RE_4.exec(String(c ?? '')); return m ? Number(m[1]) : null; };
const fechou = (c: CardVendido | undefined): boolean => !!c && String(c.status ?? '').trim().toLowerCase() === 'fechou';
const instante = (s: string): number => { const t = Date.parse(s); return Number.isFinite(t) ? t : 0; };
const SERIE = SERIE_SOLAR;

// ── Leituras (nenhuma escreve) ───────────────────────────────────────────────

interface Leitura {
  /** A planilha lida (fresca ou a cópia); null = DESCONHECIDA (sem cópia nenhuma). */
  planilha: Planilha | null;
  /** A leitura principal falhou (vale a cópia, ou nada). */
  planilhaFora: boolean;
  cartoes: Array<{ id: string; name: string }>;
  registros: { validos: Map<string, RegistroCodigo>; naoAssinados: Set<string> };
  todas: Map<number, Ligacao>;
  cartaoDoRegistroTrello: string | null;
  cards: Map<number, CardVendido>;
}

async function lerPlanilha(deps: DepsAlocador): Promise<{ planilha: Planilha | null; fora: boolean }> {
  try { return { planilha: await deps.lerPlanilhaAtual(), fora: false }; } catch { /* tenta a cópia */ }
  logErro('planilha fora, conferindo pela cópia', 'planilha_fora');
  if (deps.lerPlanilhaCopia) {
    try { return { planilha: await deps.lerPlanilhaCopia(), fora: true }; } catch { /* sem cópia */ }
  }
  logErro('planilha sem cópia: Excel desconhecido', 'planilha_desconhecida');
  return { planilha: null, fora: true };
}

async function lerTudo(p: PedidoAlocador, deps: DepsAlocador, inicio: number): Promise<Leitura> {
  const cred = deps.credenciais as CredenciaisTrello;
  const [pl, trello, registros, todas, regTrello] = await Promise.all([
    lerPlanilha(deps),
    lerTodosOsCartoes(cred, deps.board),
    lerRegistrosDeCodigos(SERIE).catch((e) => { throw e instanceof ErroHub && e.codigo === 'sem_segredo' ? new ErroAlocador('sem_segredo') : new ErroAlocador('banco'); }),
    lerTodasLigacoes().catch(() => { throw new ErroAlocador('banco'); }),
    lerRegistroTrello(p.card.id).catch(() => null),
  ]);
  if (!trello.ok) throw new ErroAlocador(trello.causa === 'quadro_grande' ? 'trello_grande' : 'trello');
  const ids = [...registros.validos.values()].map((r) => r.card);
  for (const [id, l] of todas) if (l.venda) ids.push(id);
  let cards: Map<number, CardVendido>;
  try { cards = await lerCardsPorIds(ids); } catch { throw new ErroAlocador('banco'); }
  if (Date.now() - inicio > PRAZO_ANTES_DE_INSERIR_MS) throw new ErroAlocador('lento');
  return {
    planilha: pl.planilha, planilhaFora: pl.fora, cartoes: trello.dados, registros, todas,
    cartaoDoRegistroTrello: regTrello?.card_id ?? null, cards,
  };
}

// ── O que as leituras decidem (puro) ─────────────────────────────────────────

interface Decisao {
  ocupados: Set<number>;
  /** O registro DESTE card que o reparo (A6) religa, ou null. */
  reparo: RegistroCodigo | null;
  /** A7: o número do título do cartão guardado que este card adota, ou null. */
  adotar: string | null;
  /** A7: o registro DESTE card com o número a adotar (reaproveitado em vez de um INSERT). */
  registroProprio: RegistroCodigo | null;
  /** A7: por que não adotou (o texto final depende do número que sair). */
  avisoCartao: ((final: string) => string) | null;
  /** A8: o portão (só sem `novo` e sem adoção). */
  pergunta: Array<{ venda: VendaCsvParaVinculo; motivo: MotivoPergunta }>;
  /** A8: o aviso de mesmo telefone. */
  mesmoTelefone: MesmoTelefone | null;
  /** Sem cópia nenhuma da planilha: o Excel é desconhecido. */
  semPlanilha: boolean;
}

const avisoOutraVenda = (n: string) => (final: string): string =>
  `O cartão do Trello usa o número ${n}, que já é de outra venda. Este cliente ficou com ${final}. Ajuste o título do cartão no Trello.`;
const avisoCartaoAntigo = (n: string) => (final: string): string =>
  `O cartão do Trello guardado neste card tem o número ${n} e foi guardado antes do número automático, então não deu o número. Este cliente ficou com ${final}. Se o cartão é mesmo deste cliente, ajuste o título para ${final}.`;
const avisoSemNumero = (final: string): string => `O cartão do Trello não tem o número no título. Ajuste para começar com ${final}.`;

function decidir(p: PedidoAlocador, lig: Ligacao, existe: boolean, l: Leitura): Decisao {
  const card = p.card;
  const { registros, todas, cards } = l;
  const semPlanilha = !l.planilha;

  // A5: ocupados. Registros MORTOS e linhas não assinadas NÃO entram (são números a pular, não o máximo).
  const ocupados = new Set<number>();
  for (const c of l.planilha?.codigos ?? []) { const n = numeroDe(c); if (n !== null) ocupados.add(n); }
  for (const c of l.cartoes) { const t = codigoDoTitulo(c.name); if (t) ocupados.add(Number(t.slice(1))); }
  for (const r of registros.validos.values()) {
    const n = numeroDoCodigo(r.codigo, SERIE);
    if (n !== null && fechou(cards.get(r.card))) ocupados.add(n);
  }
  for (const [id, x] of todas) {
    const n = numeroDe(x.venda);
    if (n !== null && fechou(cards.get(id))) ocupados.add(n);
  }

  // A6: o registro DESTE card (o mais novo). Ligação mais nova que ele é decisão de gente: não repara.
  let meu: RegistroCodigo | null = null;
  for (const r of registros.validos.values()) if (r.card === card.id && (!meu || instante(r.em) > instante(meu.em))) meu = r;
  const reparo = meu && (!existe || ligacaoSoDoTrello(lig) || instante(lig.em) < instante(meu.em))
    && quemUsa(todas, card.id, 'venda', meu.codigo) === null ? meu : null;

  // A7: o número do cartão guardado deste card. Nunca se acha cartão por telefone nem por nome.
  // O `card_id` do registro do envio NÃO é assinado: cartão que só aparece ali nunca é confiável (só pergunta).
  const soDoRegistro = p.cartaoSemAssinatura === true
    || (p.cartaoTrello === undefined && !lig.trello_card && !!l.cartaoDoRegistroTrello);
  const idDoCartao = p.cartaoTrello !== undefined ? p.cartaoTrello : (lig.trello_card ?? l.cartaoDoRegistroTrello ?? null);
  const cartao = idDoCartao ? l.cartoes.find((c) => c.id === idDoCartao) ?? null : null;
  // Sem cópia da planilha: só adota cartão CRIADO PELO /gerador (a escolha da pessoa não basta: o Excel pode ter a linha).
  const confiavel = !soDoRegistro && (semPlanilha ? criadoPeloGerador(idDoCartao) : cartaoConfiavel(idDoCartao, p.cartaoEscolhido === true));
  let adotar: string | null = null;
  let registroProprio: RegistroCodigo | null = null;
  let avisoCartao: ((final: string) => string) | null = null;
  let linhaDoTitulo: VendaCsvParaVinculo | null = null;
  if (cartao) {
    const nTitulo = codigoDoTitulo(cartao.name);
    if (!nTitulo) avisoCartao = avisoSemNumero;
    else {
      const naPlanilha = (l.planilha?.codigos ?? []).some((c) => numeroDe(c) === Number(nTitulo.slice(1)));
      const usadaPorOutro = quemUsa(todas, card.id, 'venda', nTitulo) !== null;
      if (naPlanilha) {
        // Linha do Excel com o número do título: é "outra venda". LIVRE vira pergunta (nunca liga); usada por outro card, só aviso.
        avisoCartao = avisoOutraVenda(nTitulo);
        if (!usadaPorOutro) {
          linhaDoTitulo = l.planilha?.vendas.find((v) => numeroDe(v.codigo) === Number(nTitulo.slice(1)))
            ?? { codigo: nTitulo, cliente: '', homologacao: '', telefone: '', data: '', consultor: '' };
        }
      } else {
        const ocorrencias = l.cartoes.filter((c) => codigoDoTitulo(c.name) === nTitulo).length;
        const reg = registros.validos.get(nTitulo);
        const regDeOutro = !!reg && reg.card !== card.id;   // o registro DESTE card não conta como "outra venda"
        const deOutro = ocorrencias !== 1 || usadaPorOutro || regDeOutro || registros.naoAssinados.has(nTitulo);
        if (confiavel && !deOutro) { adotar = nTitulo; registroProprio = reg && reg.card === card.id ? reg : null; }
        else avisoCartao = deOutro ? avisoOutraVenda(nTitulo) : avisoCartaoAntigo(nTitulo);
      }
    }
  }

  // A8: portão e aviso, sobre TODAS as linhas da planilha (independente de quem pede). Nunca liga nada.
  const visivel = (v: VendaCsvParaVinculo): boolean => p.quem.socio || podeVer(p.quem.nome, v.consultor);
  const iguais = candidatasPorTelefone(card.cliente_telefone, l.planilha?.vendas ?? []).map((x) => x.venda);
  const livres = iguais.filter((v) => quemUsa(todas, card.id, 'venda', v.codigo) === null);
  const pergunta: Decisao['pergunta'] = [];
  if (linhaDoTitulo) {
    const tambemPorTelefone = livres.some((v) => v.codigo === linhaDoTitulo!.codigo);
    pergunta.push({ venda: linhaDoTitulo, motivo: tambemPorTelefone && !confiavel ? 'telefone' : 'cartao' });
  }
  for (const v of livres) if (!pergunta.some((x) => x.venda.codigo === v.codigo)) pergunta.push({ venda: v, motivo: 'telefone' });
  const mesmoTelefone: MesmoTelefone | null = iguais.length
    ? { codigos: iguais.filter(visivel).map((v) => v.codigo).slice(0, MAX_CODIGOS), ocultas: iguais.filter((v) => !visivel(v)).length }
    : null;
  return { ocupados, reparo, adotar, registroProprio, avisoCartao, pergunta, mesmoTelefone, semPlanilha };
}

/** O portão: candidatos visíveis (no máximo 5, sem telefone) e QUANTOS ficaram de fora por não serem visíveis. */
function portao(p: PedidoAlocador, d: Decisao): { candidatos: CandidatoConfirmar[]; ocultas: number; semPlanilha?: true } {
  const visivel = (v: VendaCsvParaVinculo): boolean => p.quem.socio || podeVer(p.quem.nome, v.consultor);
  const vis = d.pergunta.filter((x) => visivel(x.venda));
  return {
    candidatos: vis.slice(0, MAX_CODIGOS).map((x) => ({ codigo: x.venda.codigo, cliente: x.venda.cliente, data: x.venda.data, motivo: x.motivo })),
    ocultas: d.pergunta.length - vis.length,
    ...(d.semPlanilha ? { semPlanilha: true as const } : {}),
  };
}

/** O portão fecha? Sem `novo`: linha livre do Excel em pergunta, OU o Excel desconhecido (sem cópia). */
const portaoFecha = (p: PedidoAlocador, d: Decisao): boolean => p.novo !== true && (d.pergunta.length > 0 || d.semPlanilha);

/** O texto final do aviso (planilha fora, A7 e A8), com o número que saiu. */
function avisoFinal(d: Decisao, final: string, adotou: boolean, planilhaFora: boolean): string | undefined {
  const frases: string[] = [];
  if (planilhaFora) frases.push(AVISO_SEM_PLANILHA);
  if (!adotou && d.avisoCartao) frases.push(d.avisoCartao(final));
  if (d.mesmoTelefone) {
    const t = avisoMesmoTelefone(d.mesmoTelefone.codigos, final, d.mesmoTelefone.ocultas);
    if (t) frases.push(t);
  }
  return frases.length ? frases.join(' ') : undefined;
}

const comAviso = (aviso: string | undefined, mt: MesmoTelefone | null) => ({
  ...(aviso ? { aviso } : {}), ...(mt ? { mesmoTelefone: mt } : {}),
});

// ── Escritas (dentro da trava do número) ─────────────────────────────────────

const traduzErro = (e: unknown): MotivoErroAlocador => {
  if (e instanceof ErroAlocador) return e.motivo;
  if (e instanceof ErroCadastro && e.codigo === 'ocupado') return 'ocupado';
  if (e instanceof ErroHub && e.codigo === 'sem_segredo') return 'sem_segredo';
  return 'banco';
};

/**
 * Decisão 8: o número de uma venda desfeita volta a ficar livre só se ninguém preencheu o cliente velho e o card velho não tem
 * cartão no Trello (o da ligação e o do registro do envio, abertos ou arquivados). Dentro de `TRAVA_VINCULOS`. Qualquer erro sobe
 * (nunca vira "morto" na dúvida).
 */
async function reaproveitarMorto(morto: RegistroCodigo, agora: string, noQuadro: ReadonlySet<string>): Promise<'livre' | 'nao'> {
  return comTrava(TRAVA_VINCULOS, POR_GERADOR, async () => {
    const card = (await lerCardsPorIds([morto.card])).get(morto.card);
    if (fechou(card)) return 'nao';
    const { reg, versao } = await lerRegistroComVersao(morto.codigo);
    if (versao !== null && (Object.keys(reg.campos).length > 0 || reg.alteracoes.length > 0)) return 'nao';
    const { lig, existe } = await lerLigacao(morto.card);
    const regTrello = await lerRegistroTrello(morto.card);
    if ([lig.trello_card, regTrello.card_id].some((id) => !!id && noQuadro.has(id))) return 'nao';
    if (existe && lig.venda === morto.codigo) await gravarLigacao(morto.card, { ...lig, venda: null, por: POR_GERADOR, em: agora });
    await apagarRegistro(morto.codigo, SERIE);
    return 'livre';
  });
}

type Final = { tipo: 'ja_ligada'; codigo: string } | { tipo: 'usado' } | { tipo: 'gravou' };

/**
 * A10: a ligação final, relida dentro de `TRAVA_VINCULOS`. Preserva a `proposta` e o `trello_card` que ela já tem. A compensação só
 * apaga o registro que ESTE pedido criou (`criado`), e nunca o do número que a ligação já tem.
 */
async function ligacaoFinal(cardId: number, cod: string, agora: string, criado: boolean): Promise<Final> {
  return comTrava(TRAVA_VINCULOS, POR_GERADOR, async (): Promise<Final> => {
    const { lig } = await lerLigacao(cardId);
    if (lig.venda) { if (criado && lig.venda !== cod) await apagarRegistro(cod, SERIE); return { tipo: 'ja_ligada', codigo: lig.venda }; }
    const todas = await lerTodasLigacoes();
    if (quemUsa(todas, cardId, 'venda', cod) !== null) { if (criado) await apagarRegistro(cod, SERIE); return { tipo: 'usado' }; }
    await gravarLigacao(cardId, {
      proposta: lig.proposta, venda: cod, por: POR_GERADOR, em: agora, ...(lig.trello_card ? { trello_card: lig.trello_card } : {}),
    });
    invalidarCachesHub();
    return { tipo: 'gravou' };
  });
}

/**
 * Dá o `#NNNN` do card (ou devolve o que ele já tem). Idempotente: o segundo pedido espera na trava e cai em `ja_ligada`.
 * `confirmar` (sem `novo`): telefone igual ao de uma linha livre do Excel, número do cartão guardado que é linha livre do Excel, ou
 * o Excel desconhecido (sem cópia; `semPlanilha`).
 */
export async function alocarCodigoSolar(p: PedidoAlocador, deps: DepsAlocador): Promise<ResultadoAlocador> {
  const inicio = p.inicio ?? Date.now();
  // A1. Sem trava.
  if (!segredoDoVinculo()) return erro('sem_segredo');
  try {
    const { lig } = await lerLigacao(p.card.id);
    if (lig.venda) return { ok: true, acao: 'ja_ligada', codigo: lig.venda };
  } catch (e) { logErro('ligação', 'banco'); return erro(traduzErro(e)); }
  if (!deps.credenciais) return erro('sem_credencial');

  // A2. A trava do número (global), esperando até ~10 s por quem está na frente.
  try {
    return await comTrava(SERIE.trava, p.quem.nome, () => dentroDaTrava(p, deps, inicio), TTL_TRAVA_NUMERO_MS, ESPERA_DA_TRAVA);
  } catch (e) {
    const m = traduzErro(e);
    logErro('alocar', m);
    return erro(m);
  }
}

async function dentroDaTrava(p: PedidoAlocador, deps: DepsAlocador, inicio: number): Promise<ResultadoAlocador> {
  const card = p.card;
  // A3. Relê dentro da trava.
  const { lig, existe } = await lerLigacao(card.id);
  if (lig.venda) return { ok: true, acao: 'ja_ligada', codigo: lig.venda };
  // A4 e A5.
  const l = await lerTudo(p, deps, inicio);
  const d = decidir(p, lig, existe, l);
  const fora = l.planilhaFora ? { planilhaFora: true as const } : {};
  const agora = new Date().toISOString();   // o MESMO instante vai no registro e na ligação

  // A6. Reparo: o registro deste card existe e a ligação não o tem (a gravação final falhou num pedido anterior).
  if (d.reparo) {
    const meu = d.reparo;
    const feito = await comTrava(TRAVA_VINCULOS, POR_GERADOR, async (): Promise<Final | null> => {
      const atual = await lerLigacao(card.id);
      if (atual.lig.venda) return { tipo: 'ja_ligada', codigo: atual.lig.venda };
      if (atual.existe && !ligacaoSoDoTrello(atual.lig) && instante(atual.lig.em) >= instante(meu.em)) return null;
      if (quemUsa(await lerTodasLigacoes(), card.id, 'venda', meu.codigo) !== null) return null;
      await gravarLigacao(card.id, {
        proposta: atual.lig.proposta, venda: meu.codigo, por: POR_GERADOR, em: agora,
        ...(atual.lig.trello_card ? { trello_card: atual.lig.trello_card } : {}),
      });
      invalidarCachesHub();
      return { tipo: 'gravou' };
    });
    if (feito?.tipo === 'ja_ligada') return { ok: true, acao: 'ja_ligada', codigo: feito.codigo };
    if (feito?.tipo === 'gravou') return { ok: true, acao: 'criou', codigo: meu.codigo, ...(l.planilhaFora ? { aviso: AVISO_SEM_PLANILHA } : {}), ...fora };
  }

  // A8. Portão (a adoção do A7 vem antes dele).
  if (!d.adotar && portaoFecha(p, d)) {
    const g = portao(p, d);
    return { ok: false, motivo: 'confirmar', ...g };
  }

  // A7. Adoção do número do cartão confiável: reaproveita o registro DESTE card ou faz um INSERT só; falhou, vira número novo com
  // o aviso de "outra venda" (e o portão é revisto).
  if (d.adotar) {
    const cod = d.adotar;
    const ins = d.registroProprio ? 'ok' : await inserirRegistro({ codigo: cod, card: card.id, por: p.quem.nome, em: agora, origem: 'trello' }, SERIE);
    if (ins === 'ok') {
      const f = await ligacaoFinal(card.id, cod, agora, !d.registroProprio);
      if (f.tipo === 'ja_ligada') return { ok: true, acao: 'ja_ligada', codigo: f.codigo };
      if (f.tipo === 'gravou') return { ok: true, acao: 'adotou_trello', codigo: cod, ...comAviso(avisoFinal(d, cod, true, l.planilhaFora), d.mesmoTelefone), ...fora };
    }
    d.adotar = null;
    d.avisoCartao = avisoOutraVenda(cod);
    if (portaoFecha(p, d)) {
      const g = portao(p, d);
      return { ok: false, motivo: 'confirmar', ...g };
    }
  }

  // A9. Número novo. Sem cópia da planilha, número morto NUNCA é reaproveitado (o Excel pode tê-lo).
  const noQuadro = new Set(l.cartoes.map((c) => c.id));
  let n = Math.max(0, ...d.ocupados) + 1;
  for (let voltas = 0, corridas = 0; ;) {
    if (n > SERIE.maximo) return erro('sequencia');
    const cod = SERIE.formatar(n);
    // Linha que não é nossa (a chave pública pode forjar quantas quiser): pula sem gastar volta nem corrida.
    if (l.registros.naoAssinados.has(cod)) { n++; continue; }
    if (++voltas > LIMITE_VOLTAS) return erro('ocupado');
    const morto = l.registros.validos.get(cod);                         // aqui só pode ser MORTO
    // Só reaproveita morto com a planilha FRESCA: a cópia (até 6 h) pode não ter a linha #N que o Excel ganhou depois.
    if (morto && (l.planilhaFora || (await reaproveitarMorto(morto, agora, noQuadro)) === 'nao')) { n++; continue; }
    const ins = await inserirRegistro({ codigo: cod, card: card.id, por: p.quem.nome, em: agora, origem: 'novo' }, SERIE);
    if (ins === 'ocupado') {
      if (++corridas > LIMITE_CORRIDAS) return erro('ocupado');
      l.registros.naoAssinados.add(cod); n++; continue;
    }
    // A10.
    const f = await ligacaoFinal(card.id, cod, agora, true);
    if (f.tipo === 'ja_ligada') return { ok: true, acao: 'ja_ligada', codigo: f.codigo };
    if (f.tipo === 'usado') { n++; continue; }
    return { ok: true, acao: 'criou', codigo: cod, ...comAviso(avisoFinal(d, cod, false, l.planilhaFora), d.mesmoTelefone), ...fora };
  }
}

/**
 * Os mesmos passos SEM trava e SEM escrever nada (A1, A3 a A9). `criaria` é provisório; o reaproveitamento de um número de venda
 * desfeita conta como possível, sem checar (salvo sem cópia da planilha). Com a planilha fora, `planilhaFora: true` e número
 * provisório. O registro deste card que o reparo religaria volta como `ja_ligada` (o número já é dele).
 */
export async function previaDoCodigoSolar(p: PedidoAlocador, deps: DepsAlocador): Promise<ResultadoPrevia> {
  const inicio = p.inicio ?? Date.now();
  if (!segredoDoVinculo()) return erro('sem_segredo');
  try {
    const { lig, existe } = await lerLigacao(p.card.id);
    if (lig.venda) return { ok: true, acao: 'ja_ligada', codigo: lig.venda, provisorio: false };
    if (!deps.credenciais) return erro('sem_credencial');
    const l = await lerTudo(p, deps, inicio);
    const extra = l.planilhaFora ? { planilhaFora: true } : {};
    const d = decidir(p, lig, existe, l);
    if (d.reparo) return { ok: true, acao: 'ja_ligada', codigo: d.reparo.codigo, provisorio: false, ...extra };
    if (!d.adotar && portaoFecha(p, d)) {
      const g = portao(p, d);
      return { ok: true, acao: 'confirmar', ...g };
    }
    if (d.adotar) {
      return { ok: true, acao: 'adotaria_trello', codigo: d.adotar, provisorio: false, ...comAviso(avisoFinal(d, d.adotar, true, l.planilhaFora), d.mesmoTelefone), ...extra };
    }
    let n = Math.max(0, ...d.ocupados) + 1;
    while (n <= SERIE.maximo && (l.registros.naoAssinados.has(SERIE.formatar(n)) || (l.planilhaFora && l.registros.validos.has(SERIE.formatar(n))))) n++;
    if (n > SERIE.maximo) return erro('sequencia');
    const cod = SERIE.formatar(n);
    return { ok: true, acao: 'criaria', codigo: cod, provisorio: true, ...comAviso(avisoFinal(d, cod, false, l.planilhaFora), d.mesmoTelefone), ...extra };
  } catch (e) {
    const m = traduzErro(e);
    logErro('prévia', m);
    return erro(m);
  }
}

// ── Outras séries (ex.: `#E001`): só registro, trava e o máximo dos registros da série ──────────────────────────────────────

export type ResultadoSerie =
  | { ok: true; acao: 'ja_tinha' | 'criou'; codigo: string }
  | { ok: false; motivo: 'ocupado' | 'banco' | 'sem_segredo' | 'sequencia' };

/**
 * O próximo código de uma série que NÃO é a solar: não lê planilha nem Trello, não tem adoção, portão nem reaproveitamento, e não
 * grava `venda_solar`. O card que já tem registro na série recebe o mesmo código. Próximo = maior registro válido da série + 1
 * (registros não assinados são pulados, nunca entram no máximo). A série solar é recusada: ela usa `alocarCodigoSolar`.
 */
export async function alocarCodigoDaSerie(serie: SerieCodigo, pedido: { card: number; por: string }): Promise<ResultadoSerie> {
  // A série solar (ou qualquer uma cujo formato se confunda com o dela) usa `alocarCodigoSolar`.
  if (serie === SERIE_SOLAR || serie.prefixoChave === SERIE_SOLAR.prefixoChave || serie.trava === SERIE_SOLAR.trava
    || SERIE_SOLAR.reCodigo.test(serie.formatar(1))) throw new ErroHub('serie_solar');
  if (!segredoDoVinculo()) return { ok: false, motivo: 'sem_segredo' };
  try {
    return await comTrava(serie.trava, pedido.por, async (): Promise<ResultadoSerie> => {
      const regs = await lerRegistrosDeCodigos(serie);
      let maior = 0;
      for (const r of regs.validos.values()) {
        if (r.card === pedido.card) return { ok: true, acao: 'ja_tinha', codigo: r.codigo };
        maior = Math.max(maior, numeroDoCodigo(r.codigo, serie) ?? 0);
      }
      const em = new Date().toISOString();
      let n = maior + 1;
      for (let corridas = 0; ; n++) {
        if (n > serie.maximo) return { ok: false, motivo: 'sequencia' };
        const cod = serie.formatar(n);
        if (regs.naoAssinados.has(cod)) continue;
        if ((await inserirRegistro({ codigo: cod, card: pedido.card, por: pedido.por, em, origem: 'novo' }, serie)) === 'ok') return { ok: true, acao: 'criou', codigo: cod };
        if (++corridas > LIMITE_CORRIDAS) return { ok: false, motivo: 'ocupado' };
      }
    }, TTL_TRAVA_NUMERO_MS, ESPERA_DA_TRAVA);
  } catch (e) {
    const m = traduzErro(e);
    logErro('alocar série', m);
    return { ok: false, motivo: m === 'ocupado' || m === 'sem_segredo' ? m : 'banco' };
  }
}
