// ─────────────────────────────────────────────────────────────────────────────
// SÉRIE `#E001` DOS CLIENTES DE ELETROPOSTO (fase 2, etapa 4, 22/10/2026). É o "número do cliente" do eletroposto, como o `#0065` é o
// do solar. Não existe planilha, Trello nem pasta de eletroposto: a série vive só no /gerador.
//
// Reaproveita o módulo do alocador solar: registro assinado em `system_state` (`ep_serie_cod:E001` = { codigo, card, por, em, origem,
// sig }, SEM dado pessoal), INSERT que dá 23505 em conflito e a trava `cadastro_trava:eletroposto_serie`. O caminho card -> código é a
// leitura de todos os registros da série, invertida (registro sem assinatura válida é ignorado). Não há `venda_solar` aqui.
//
// REGRAS:
//   - O id do card continua sendo a chave de tudo. O `#E` é um campo A MAIS, só de leitura.
//   - Card que sai de `fechou` MANTÉM o código: o registro nunca é apagado e o número nunca é reusado.
//   - Não depende do modelo de negócio (chave na mão, 50/50, arrendamento, cotista, integrador, carregador ou vazio).
//   - Eletroposto e solar não se misturam: quem chama revalida o card com `ehCardVendidoEp`/`lerCardVendido`, e o `casarCartao`
//     (que compara dígitos) nunca é usado com esta série.
//   - A PASSADA DE PENDENTES numera, na leitura da lista de clientes, todo card `fechou` de eletroposto que ainda não tem código.
//     Ordem GLOBAL (nunca por quem lê): `vendido_em` do pós-venda, depois `quando` da reunião, depois o id. Quem não tem data
//     válida vai depois de quem tem. Numera uma vez e nunca recalcula (o `vendido_em` é editável). No máximo 20 por passada, uma
//     tentativa de trava (a lista nunca espera), e qualquer falha só some do resultado: a lista não cai.
//
// Serviço: NÃO importa rota (ciclo de boot em CommonJS). Nenhum log leva nome, telefone ou título: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────
import { comTrava } from './cadastroVendaBanco';
import { ErroHub, segredoDoVinculo } from './vendaSolarHub';
import {
  lerRegistrosDeCodigos, inserirRegistro, numeroDoCodigo, type SerieCodigo,
} from './vendaSolarRegistro';
import { alocarCodigoDaSerie, type ResultadoSerie } from './vendaSolarCodigo';
import { lerPosVendas } from './fichaEletropostoBanco';
import { lerPosVenda, ehCardVendidoEp, type CardVendido } from './fichaEletroposto';

/** `E001`, `E002`... Depois de `E999` vem `E1000` (a leitura aceita 3 ou mais dígitos). */
export const SERIE_EP: SerieCodigo = {
  prefixoChave: 'ep_serie_cod:E',
  trava: 'eletroposto_serie',
  reCodigo: /^E(\d{3,})$/,
  formatar: (n: number) => `E${String(n).padStart(3, '0')}`,
  maximo: 99_999,
};

export const LIMITE_DA_PASSADA = 20;
const POR_DA_PASSADA = 'passada';
const TTL_TRAVA_MS = 360_000;                              // maior que os 300 s da função: nunca vence com o dono vivo
export const ESPERA_DA_ROTA = { tentativas: 40, esperaMs: 250 };  // o gancho do navegador espera ~10 s por quem está na frente
const SEM_ESPERA = { tentativas: 1, esperaMs: 0 };         // a lista nunca espera a trava
const LIMITE_CORRIDAS = 5;

const logErro = (que: string, codigo: string): void => console.error(`[eletroposto-serie] ${que}`, codigo);
const codigoDoErro = (e: unknown): string => {
  const c = (e as { codigo?: unknown; code?: unknown } | null);
  return String(c?.codigo ?? c?.code ?? 'interno');
};

// ── Leitura ──────────────────────────────────────────────────────────────────

/** card -> código (`E001`), só de registros com assinatura válida. Dois registros no mesmo card: vale o MENOR código. Lança em erro de banco. */
export async function lerSerieDosCards(): Promise<Map<number, string>> {
  const { validos } = await lerRegistrosDeCodigos(SERIE_EP);
  const porCard = new Map<number, string>();
  for (const r of validos.values()) {
    const atual = porCard.get(r.card);
    if (!atual || (numeroDoCodigo(r.codigo, SERIE_EP) ?? Infinity) < (numeroDoCodigo(atual, SERIE_EP) ?? Infinity)) porCard.set(r.card, r.codigo);
  }
  return porCard;
}

/** Leitura para quem precisa saber se o banco respondeu: sem segredo ou com o banco fora, LANÇA (a rota responde 503). */
export async function lerSerieEstrita(): Promise<Map<number, string>> {
  if (!segredoDoVinculo()) throw new ErroHub('sem_segredo');
  return lerSerieDosCards();
}

/** Como `lerSerieDosCards`, mas NUNCA lança: sem segredo ou com o banco fora, devolve vazio (a tela só fica sem o `#E`). */
export async function lerSerieSemRisco(): Promise<Map<number, string>> {
  try {
    if (!segredoDoVinculo()) return new Map();
    return await lerSerieDosCards();
  } catch (e) {
    logErro('leitura da série', codigoDoErro(e));
    return new Map();
  }
}

// ── A passada de pendentes ───────────────────────────────────────────────────

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
/** O dia AAAA-MM-DD. Aceita também com horário ("2026-10-05T12:00:00Z", "2026-10-05 12:00"): vale quando os 10 primeiros caracteres são a data. */
const diaValido = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  const dia = t.slice(0, 10);
  return RE_DIA.test(dia) && (t.length === 10 || t[10] === 'T' || t[10] === ' ') ? dia : null;
};
const instanteValido = (s: unknown): number | null => {
  if (typeof s !== 'string' || !s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

/**
 * A ordem da numeração: `vendido_em` (AAAA-MM-DD) do pós-venda, depois `quando` (a reunião), depois o id. Card sem data válida vai
 * DEPOIS de todos os que têm (string vazia ordenaria primeiro e furaria a fila). Puro: não muda a lista de entrada.
 */
export function ordenarPendentes(cards: CardVendido[], posVendas: Map<number, unknown>): CardVendido[] {
  const chave = (c: CardVendido): [string, number, number] => {
    const dia = diaValido(lerPosVenda(posVendas.get(c.id))?.vendido_em);
    return [dia ?? '9999-99-99', instanteValido(c.quando) ?? Number.MAX_SAFE_INTEGER, c.id];
  };
  return [...cards].sort((a, b) => {
    const x = chave(a);
    const y = chave(b);
    return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1] || x[2] - y[2];
  });
}

export type ResultadoLote =
  | { ok: true; codigos: Map<number, string>; criou: Set<number>; parou?: 'sequencia' | 'ocupado' }
  | { ok: false; motivo: 'ocupado' | 'banco' | 'sem_segredo' };

/**
 * Numera VÁRIOS cards na ordem dada, numa trava só (leitura e escrita dentro dela). Card que já tem código recebe o mesmo.
 * `espera` define quanto aguarda a trava. A série solar (ou qualquer uma que se confunda com ela) é recusada pelo
 * `alocarCodigoDaSerie`; aqui só a E é aceita.
 */
export async function alocarLoteDaSerie(
  cards: number[], por: string, espera: { tentativas: number; esperaMs: number } = SEM_ESPERA,
): Promise<ResultadoLote> {
  if (!segredoDoVinculo()) return { ok: false, motivo: 'sem_segredo' };
  try {
    return await comTrava(SERIE_EP.trava, por, async (): Promise<ResultadoLote> => {
      const regs = await lerRegistrosDeCodigos(SERIE_EP);
      let maior = 0;
      const donos = new Map<number, string>();
      for (const r of regs.validos.values()) {
        const n = numeroDoCodigo(r.codigo, SERIE_EP) ?? 0;
        maior = Math.max(maior, n);
        const atual = donos.get(r.card);
        if (!atual || n < (numeroDoCodigo(atual, SERIE_EP) ?? Infinity)) donos.set(r.card, r.codigo);
      }
      const codigos = new Map<number, string>();
      const criou = new Set<number>();
      const em = new Date().toISOString();
      let n = maior + 1;
      let corridas = 0;
      for (const card of cards) {
        const ja = donos.get(card);
        if (ja) { codigos.set(card, ja); continue; }
        for (; ; n++) {
          if (n > SERIE_EP.maximo) return { ok: true, codigos, criou, parou: 'sequencia' };
          const cod = SERIE_EP.formatar(n);
          if (regs.naoAssinados.has(cod)) continue;
          if ((await inserirRegistro({ codigo: cod, card, por, em, origem: 'novo' }, SERIE_EP)) === 'ok') {
            codigos.set(card, cod); criou.add(card); n++;
            break;
          }
          if (++corridas > LIMITE_CORRIDAS) return { ok: true, codigos, criou, parou: 'ocupado' };
        }
      }
      return { ok: true, codigos, criou };
    }, TTL_TRAVA_MS, espera);
  } catch (e) {
    const c = codigoDoErro(e);
    logErro('lote', c);
    return { ok: false, motivo: c === 'ocupado' ? 'ocupado' : c === 'sem_segredo' ? 'sem_segredo' : 'banco' };
  }
}

export interface ResultadoPassada {
  /** card -> código dos que já tinham mais os recém-numerados. */
  series: Map<number, string>;
  /** Os numerados NESTA passada. */
  criou: Set<number>;
  /** Não ficou pendente nenhum card ao alcance (a passada rodou inteira, ou nem havia o que numerar). */
  completa: boolean;
}

/**
 * Lê a série e numera os pendentes na ordem (no máximo `limite`, 20 por padrão). `todos` são TODOS os cards vendidos de eletroposto,
 * sem corte por papel: a ordem é global, senão o consultor que abrisse a lista primeiro numeraria os cards dele na frente dos outros.
 * `espera` é quanto aguarda a trava (a lista não espera; a rota POST espera). Nunca lança.
 */
export async function passadaDePendentes(
  todos: CardVendido[], espera: { tentativas: number; esperaMs: number } = SEM_ESPERA, limite: number = LIMITE_DA_PASSADA,
): Promise<ResultadoPassada> {
  const vazio: ResultadoPassada = { series: new Map(), criou: new Set(), completa: false };
  try {
    if (!segredoDoVinculo()) return { ...vazio, completa: true };   // sem segredo não há como numerar; quem chama trata
    const lida = await lerSerieDosCards();
    const pendentes = todos.filter((c) => ehCardVendidoEp(c) && !lida.has(c.id));
    if (!pendentes.length) return { series: lida, criou: new Set(), completa: true };
    let ordem: number[];
    try {
      const pvs = await lerPosVendas(pendentes.map((c) => c.id));
      ordem = ordenarPendentes(pendentes, pvs).slice(0, limite).map((c) => c.id);
    } catch (e) {
      logErro('pós-venda da passada', codigoDoErro(e));
      return { series: lida, criou: new Set(), completa: false };   // sem a data não se numera: numerar pelo id errado seria irreversível
    }
    const r = await alocarLoteDaSerie(ordem, POR_DA_PASSADA, espera);
    if (!r.ok) return { series: lida, criou: new Set(), completa: false };
    for (const [card, cod] of r.codigos) lida.set(card, cod);
    return { series: lida, criou: r.criou, completa: !r.parou && pendentes.length <= limite };
  } catch (e) {
    logErro('passada', codigoDoErro(e));
    return vazio;
  }
}

/** A passada da lista: devolve só o mapa card -> código. Nunca lança. */
export async function serieComPassada(todos: CardVendido[]): Promise<Map<number, string>> {
  return (await passadaDePendentes(todos)).series;
}

// ── O gancho de um card (a rota POST) ────────────────────────────────────────

export type ResultadoDoCard =
  | { ok: true; serie: string; criou: boolean }
  | { ok: false; motivo: 'ocupado' | 'banco' | 'sem_segredo' | 'sequencia' };

/** O código do card (cria se ainda não tem). O card já foi revalidado por quem chama. Idempotente. */
export async function garantirSerieDoCard(card: number, por: string): Promise<ResultadoDoCard> {
  let r: ResultadoSerie;
  try {
    r = await alocarCodigoDaSerie(SERIE_EP, { card, por });
  } catch (e) {
    if (e instanceof ErroHub) { logErro('série recusada', e.codigo); return { ok: false, motivo: 'banco' }; }
    throw e;
  }
  return r.ok ? { ok: true, serie: r.codigo, criou: r.acao === 'criou' } : { ok: false, motivo: r.motivo };
}
