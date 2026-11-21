// ─────────────────────────────────────────────────────────────────────────────
// HOMOLOGAÇÃO LIDA DO TRELLO (20/11/2026), parte PURA. O engenheiro faz a homologação no cartão do Trello (checklist ENGENHARIA e os anexos de
// ART, protocolo e parecer); o /gerador só LÊ o cartão e espelha. Aqui ficam as regras sem rede e sem banco: casar item da checklist, classificar
// anexo pelo nome, conferir se a URL é do Trello, a forma do registro por obra e o contrato que a tela recebe.
//
// O REGISTRO (`system_state`, `trello_homolog:<card>`) é alcançável pela chave pública do banco principal: NÃO leva nome de arquivo, texto de
// documento, número de protocolo nem URL com token. Guarda só ids do Trello, o slot, datas e os nomes dos itens da checklist.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizarNome } from './dossieVenda';
import { itemDoCatalogo } from './docsCliente';

export type SlotHomolog = 'art' | 'protocolo' | 'parecer_acesso';
export const SLOTS_HOMOLOG: readonly SlotHomolog[] = ['art', 'protocolo', 'parecer_acesso'];
export const ehSlotHomolog = (x: unknown): x is SlotHomolog => SLOTS_HOMOLOG.includes(x as SlotHomolog);

/**
 * QUEM assina a conclusão automática da etapa 3 e, junto, O PONTO ÚNICO do aviso "É sua" (Thiago e Diego, donos da etapa 4). Veredito do chefe-antiban de
 * 20/11/2026. A conclusão SÓ GRAVA (`mudarJornada`); nada aqui envia mensagem: quem envia é o tick (`rodarEventos`), que lê o histórico.
 *
 * O robô "É sua" dispara a partir do `por` da linha `concluir` do histórico e ignora os autores de `POR_QUE_NAO_E_GENTE` (`leitura`, `sonda`, vazio):
 *   - `AUTOR_TRELLO` ('trello', ASCII; a tela é que mostra "Trello (engenharia)") AVISA;
 *   - `AUTOR_SILENCIOSO` ('leitura') conclui igual e NÃO avisa.
 * Regras de `autorDaConclusaoAutomatica`:
 *   1. Só avisa a MUDANÇA VISTA: a leitura anterior estava incompleta (`completoAntes === false`) e a de agora está completa. Primeira leitura (sem
 *      registro, `null`) que já vem completa, ou completa que continua completa, conclui em silêncio (`leitura`): é acúmulo antigo.
 *   2. Na tela (GET) a mudança vista leva `trello`.
 *   3. Na rodada das 08:00 a mudança vista leva `leitura` enquanto a fila do dia do Thiago e a do Diego ainda não saíram (a fila logo depois já leva a
 *      obra); se a de um deles já saiu, leva `trello`.
 * `concluida_por` da etapa leva sempre `AUTOR_TRELLO`.
 */
export const AUTOR_TRELLO = 'trello';
export const AUTOR_SILENCIOSO = 'leitura';
export function autorDaConclusaoAutomatica(c: { completoAntes: boolean | null; origem: 'tela' | 'fila'; filaDosDonosSaiu: boolean }): string {
  if (c.completoAntes !== false) return AUTOR_SILENCIOSO;
  if (c.origem === 'fila' && !c.filaDosDonosSaiu) return AUTOR_SILENCIOSO;
  return AUTOR_TRELLO;
}

/** Intervalo mínimo entre duas leituras do mesmo cartão (conta a TENTATIVA, com sucesso ou não). */
export const INTERVALO_SINCRONIA_MS = 10 * 60_000;
/** Quantas vezes um anexo que falhou (rede, IA fora) é tentado de novo antes de entrar no registro como ignorado. */
export const MAX_TENTATIVAS_ANEXO = 3;
/** Teto de anexos novos tratados por rodada (cada um baixa e, às vezes, lê por IA): o resto fica para a próxima. */
export const MAX_ANEXOS_POR_RODADA = 4;
const MAX_ANEXOS_NO_REGISTRO = 80;
const MAX_ITENS_CHECKLIST = 30;

// ── O que o Trello devolve ────────────────────────────────────────────────────────────────────────────────────────────

export interface ItemChecklist { nome: string; feito: boolean }
export interface AnexoTrello { id: string; nome: string; arquivo: string; url: string; mime: string; bytes: number; em: string; upload: boolean }
export interface CartaoHomolog { url: string | null; checklist: ItemChecklist[]; anexos: AnexoTrello[] }

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const limpo = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const RE_ID_TRELLO = /^[0-9a-f]{24}$/;
const RE_ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

/** O JSON de `GET /cards/{id}?attachments=true&checklists=all` virado em `CartaoHomolog`. Corpo fora do formato dá null. */
export function lerCartaoDoTrello(bruto: unknown): CartaoHomolog | null {
  const c = obj(bruto);
  if (!c) return null;
  const url = typeof c.shortUrl === 'string' && /^https:\/\/trello\.com\/c\/[A-Za-z0-9]{6,12}$/.test(c.shortUrl) ? c.shortUrl : null;
  const anexos: AnexoTrello[] = [];
  for (const a of Array.isArray(c.attachments) ? c.attachments : []) {
    const o = obj(a);
    if (!o || typeof o.id !== 'string' || !RE_ID_TRELLO.test(o.id)) continue;
    const bytes = Number(o.bytes);
    anexos.push({
      id: o.id, nome: limpo(o.name, 200), arquivo: limpo(o.fileName, 200), url: typeof o.url === 'string' ? o.url.slice(0, 600) : '',
      mime: limpo(o.mimeType, 80).toLowerCase(), bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
      em: typeof o.date === 'string' && !Number.isNaN(Date.parse(o.date)) ? new Date(o.date).toISOString() : '', upload: o.isUpload === true,
    });
  }
  return { url, checklist: espelharChecklist(c.checklists), anexos };
}

/** Os itens da checklist ENGENHARIA, na ordem do Trello (`pos`). Sem essa checklist, lista vazia. */
export function espelharChecklist(checklists: unknown): ItemChecklist[] {
  const lista = (Array.isArray(checklists) ? checklists : []).map(obj).filter((x): x is Record<string, unknown> => !!x);
  const eng = lista.find((x) => normalizarNome(String(x.name ?? '')) === 'engenharia');
  if (!eng) return [];
  const itens = (Array.isArray(eng.checkItems) ? eng.checkItems : []).map(obj).filter((x): x is Record<string, unknown> => !!x);
  itens.sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0));
  return itens.slice(0, MAX_ITENS_CHECKLIST).map((i) => ({ nome: limpo(i.name, 80), feito: i.state === 'complete' })).filter((i) => i.nome);
}

/** Item da checklist por NOME (sem acento, minúsculo): "Parecer Aprovado", "parecer aprovado!" e "Parecer de acesso aprovado" valem. */
export const ehItemParecerAprovado = (nome: string): boolean => /parecer.*aprovad/.test(normalizarNome(nome));
/** O item "parecer aprovado" está MARCADO? Item que não existe na checklist vale não. */
export const parecerAprovadoNoCartao = (checklist: readonly ItemChecklist[]): boolean => checklist.some((i) => i.feito && ehItemParecerAprovado(i.nome));

// ── Classificar o anexo pelo nome ─────────────────────────────────────────────────────────────────────────────────────

/**
 * O slot pelo NOME do anexo (e do arquivo). Devolve o slot quando UMA só categoria casa; `'outro'` quando o nome diz que não é um dos três
 * (foto, kmz, datasheet...); `null` na dúvida (nada casa ou casa mais de uma), e quem decide é a leitura por IA.
 * "Comprovante" e "boleto" de ART ficam na dúvida: o comprovante de pagamento é outro item, não a ART.
 */
export function classificarPorNome(nome: string, arquivo = ''): SlotHomolog | 'outro' | null {
  const t = normalizarNome(`${nome} ${arquivo}`);   // a extensão fica como palavra solta ("local kmz"): é pista de que não é um dos três
  if (!t) return null;
  if (/\b(datasheet|data sheet|kmz|kml|fachada|medidor|disjuntor|contrato|procuracao|conta de luz|relatorio final)\b/.test(t)) return 'outro';
  const achou: SlotHomolog[] = [];
  if (/\bparecer\b|\bparecer de acesso\b|acesso aprovado|aprovacao de acesso/.test(t)) achou.push('parecer_acesso');
  if (/\bprotocolo\b|\bprotocol\b|solicitacao de acesso/.test(t)) achou.push('protocolo');
  if ((/\bart\b|anotacao de responsabilidade tecnica/.test(t)) && !/\b(comprovante|boleto|pagamento|pago|paga)\b/.test(t)) achou.push('art');
  return achou.length === 1 ? achou[0] : null;
}

// ── A URL do anexo é do Trello? ───────────────────────────────────────────────────────────────────────────────────────

/**
 * O token do Trello só vai a um endereço do próprio Trello: https, sem usuário nem senha na URL, host `trello.com` ou subdomínio dele.
 * `trello.com.evil.com`, `eviltrello.com` e `http://` dão false.
 */
export function urlDoTrello(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    return h === 'trello.com' || h.endsWith('.trello.com');
  } catch { return false; }
}

/** O tipo REAL do arquivo pelos primeiros bytes (só os 4 que o bucket aceita), ou null. */
export function mimePelaAssinatura(b: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | null {
  const ascii = (de: number, n: number): string => Buffer.from(b.subarray(de, de + n)).toString('latin1');
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 4 && ascii(0, 4) === '%PDF') return 'application/pdf';
  return null;
}

// ── O registro por obra ───────────────────────────────────────────────────────────────────────────────────────────────

export type ResultadoAnexo = 'importado' | 'ignorado' | 'falhando';
export interface AnexoRegistrado { resultado: ResultadoAnexo; slot: SlotHomolog | null; em: string; tentativas: number }
export interface RegistroHomolog {
  v: 1;
  card_id: string | null;
  cartao_url: string | null;
  /** A última TENTATIVA (conta o intervalo de 10 min) e a última leitura que deu certo. */
  tentado_em: string | null;
  sincronizado_em: string | null;
  /** Texto curto e sem dado pessoal, ou null. */
  erro: string | null;
  checklist: ItemChecklist[];
  parecer_aprovado: boolean;
  /** O obrigatório (parecer aprovado no cartão E arquivo no item parecer) estava completo na leitura ANTERIOR? `null` = nunca foi lida. Decide o autor da conclusão. */
  completo: boolean | null;
  /** Por id do anexo no Trello. `importado` e `ignorado` nunca mais são baixados; `falhando` volta até `MAX_TENTATIVAS_ANEXO`. */
  anexos: Record<string, AnexoRegistrado>;
}
export const chaveRegistroHomolog = (card: number): string => `trello_homolog:${card}`;
export const registroHomologVazio = (): RegistroHomolog =>
  ({ v: 1, card_id: null, cartao_url: null, tentado_em: null, sincronizado_em: null, erro: null, checklist: [], parecer_aprovado: false, completo: null, anexos: {} });

export function lerRegistroHomologBruto(value: unknown): RegistroHomolog {
  const v = obj(value);
  const r = registroHomologVazio();
  if (!v) return r;
  if (typeof v.card_id === 'string' && RE_ID_TRELLO.test(v.card_id)) r.card_id = v.card_id;
  if (typeof v.cartao_url === 'string' && /^https:\/\/trello\.com\/c\/[A-Za-z0-9]{6,12}$/.test(v.cartao_url)) r.cartao_url = v.cartao_url;
  r.tentado_em = typeof v.tentado_em === 'string' && RE_ISO.test(v.tentado_em) ? v.tentado_em : null;
  r.sincronizado_em = typeof v.sincronizado_em === 'string' && RE_ISO.test(v.sincronizado_em) ? v.sincronizado_em : null;
  r.erro = typeof v.erro === 'string' && v.erro.trim() ? limpo(v.erro, 120) : null;
  r.checklist = (Array.isArray(v.checklist) ? v.checklist : []).map(obj).filter((x): x is Record<string, unknown> => !!x)
    .slice(0, MAX_ITENS_CHECKLIST).map((i) => ({ nome: limpo(i.nome, 80), feito: i.feito === true })).filter((i) => i.nome);
  r.parecer_aprovado = v.parecer_aprovado === true && parecerAprovadoNoCartao(r.checklist);
  r.completo = v.completo === true ? true : v.completo === false ? false : null;
  const an = obj(v.anexos) ?? {};
  for (const [id, x] of Object.entries(an).slice(0, MAX_ANEXOS_NO_REGISTRO)) {
    const o = obj(x);
    if (!RE_ID_TRELLO.test(id) || !o) continue;
    const resultado: ResultadoAnexo = o.resultado === 'importado' || o.resultado === 'ignorado' ? o.resultado : 'falhando';
    const tent = Number(o.tentativas);
    r.anexos[id] = {
      resultado, slot: ehSlotHomolog(o.slot) ? o.slot : null, em: typeof o.em === 'string' && RE_ISO.test(o.em) ? o.em : '',
      tentativas: Number.isInteger(tent) && tent >= 0 && tent <= 50 ? tent : 0,
    };
  }
  return r;
}

/** O anexo já foi resolvido (importado ou ignorado) ou esgotou as tentativas? Então não baixa de novo. */
export const anexoResolvido = (r: RegistroHomolog, id: string): boolean => {
  const a = r.anexos[id];
  return !!a && (a.resultado !== 'falhando' || a.tentativas >= MAX_TENTATIVAS_ANEXO);
};

/** Passou o intervalo mínimo desde a última tentativa? */
export function sincroniaDevida(r: RegistroHomolog, agoraMs: number): boolean {
  const t = r.tentado_em ? Date.parse(r.tentado_em) : NaN;
  return !Number.isFinite(t) || agoraMs - t >= INTERVALO_SINCRONIA_MS || agoraMs < t - 60_000;
}

/** A obra está no ponto de ser lida? Etapa 3 aberta e não concluída, sem cancelar, e a obra da fase 2 não fechada. */
export function elegivelParaHomolog(js: { cancelada: unknown; etapas: { 3: { aberta_em: string | null; concluida_em: string | null } } } | null, jo: { fechada?: unknown } | null): boolean {
  if (!js || js.cancelada || jo?.fechada) return false;
  return !!js.etapas[3].aberta_em && !js.etapas[3].concluida_em;
}

// ── O contrato da tela ────────────────────────────────────────────────────────────────────────────────────────────────

export interface TrelloHomologDaTela {
  cartao_url: string | null;
  sincronizado_em: string | null;
  erro: string | null;
  checklist: ItemChecklist[];
  importados: Array<{ slot: SlotHomolog; nome: string; em: string }>;
}

/** `etapas[2].trello_homolog`. Sem cartão (`temCartao` false) é null. O `nome` do importado é o rótulo do item no /gerador, nunca o nome do arquivo. */
export function homologDaTela(r: RegistroHomolog | null, temCartao: boolean, urlDaObra: string | null): TrelloHomologDaTela | null {
  if (!temCartao) return null;
  const importados = Object.values(r?.anexos ?? {})
    .filter((a): a is AnexoRegistrado & { slot: SlotHomolog } => a.resultado === 'importado' && a.slot !== null)
    .sort((a, b) => (a.em < b.em ? -1 : a.em > b.em ? 1 : 0))
    .map((a) => ({ slot: a.slot, nome: itemDoCatalogo('vendasolar', a.slot)?.rotulo ?? a.slot, em: a.em }));
  return {
    cartao_url: urlDaObra ?? r?.cartao_url ?? null, sincronizado_em: r?.sincronizado_em ?? null, erro: r?.erro ?? null,
    checklist: r?.checklist ?? [], importados,
  };
}
