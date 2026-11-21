// ─────────────────────────────────────────────────────────────────────────────
// HOMOLOGAÇÃO LIDA DO TRELLO (20/11/2026), as chamadas ao Trello: ler o cartão (só GET) e baixar um anexo. Nada é escrito no Trello.
//
// O download do anexo exige o header OAuth com key e token. O token SÓ vai para endereço do Trello (`urlDoTrello`): URL de anexo que aponta para
// outro host é recusada, e num redirecionamento para fora do Trello o header cai (a URL assinada de destino não precisa dele).
// Nada aqui põe URL, token, nome de arquivo ou conteúdo em erro ou log: o motivo é um código curto.
// ─────────────────────────────────────────────────────────────────────────────
import { trelloFetch, type CredenciaisTrello } from './dossieVenda';
import { chamar, type Res } from './trelloVendaSolar';
import { LIMITE_BYTES } from './docsCliente';
import { lerCartaoDoTrello, mimePelaAssinatura, urlDoTrello, type AnexoTrello, type CartaoHomolog } from './trelloHomologPuro';

/** `GET /cards/{id}` com anexos e checklists. Só leitura. */
export async function lerCartaoHomologacao(cred: CredenciaisTrello, cardId: string): Promise<Res<CartaoHomolog>> {
  const r = await chamar<unknown>(cred, 'GET', `/cards/${encodeURIComponent(cardId)}`, {
    attachments: 'true', attachment_fields: 'name,url,bytes,date,fileName,mimeType,isUpload', checklists: 'all', fields: 'idList,url,shortUrl',
  });
  if (!r.ok) return r;
  const c = lerCartaoDoTrello(r.dados);
  return c ? { ok: true, dados: c } : { ok: false, motivo: 'o Trello não devolveu o cartão no formato esperado' };
}

export type MotivoBaixa = 'fora_do_trello' | 'grande' | 'tipo' | 'rede';
export type ResBaixa = { ok: true; bytes: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' } | { ok: false; motivo: MotivoBaixa; definitivo: boolean };

const MAX_REDIRECIONAMENTOS = 3;
/** O tempo total para ler o corpo do anexo (o `trelloFetch` só cobre até os cabeçalhos). */
export const TEMPO_CORPO_MS = 30_000;

/**
 * Lê o corpo aos pedaços, com tempo limite e teto de memória: passou de `limite` (10 MB) ABORTA na hora, mesmo sem `content-length`, e corpo que
 * não termina no prazo é cancelado. Nunca guarda mais que `limite` + um pedaço.
 */
export async function lerCorpoLimitado(r: Response, limite = LIMITE_BYTES, ms = TEMPO_CORPO_MS): Promise<Buffer | 'grande' | 'tempo'> {
  if (!r.body) return Buffer.alloc(0);
  const leitor = r.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const relogio = new Promise<'tempo'>((ok) => { timer = setTimeout(() => ok('tempo'), ms); });
  const ler = (async (): Promise<Buffer | 'grande'> => {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) return Buffer.concat(pedacos);
      total += value.length;
      if (total > limite) return 'grande';
      pedacos.push(value);
    }
  })();
  ler.catch(() => undefined);   // se o tempo vencer antes, a leitura pendente termina sozinha ao cancelar
  try {
    const r2 = await Promise.race([ler, relogio]);
    if (r2 === 'tempo' || r2 === 'grande') await leitor.cancel().catch(() => undefined);
    return r2;
  } catch {
    await leitor.cancel().catch(() => undefined);
    return 'tempo';
  } finally {
    clearTimeout(timer);
  }
}
const cabecalhoOAuth = (c: CredenciaisTrello): string => `OAuth oauth_consumer_key="${c.key}", oauth_token="${c.token}"`;

/**
 * Baixa o anexo (já conferido: tem que ser upload e a URL tem que ser do Trello) e valida o que veio: tamanho (10 MB, o mesmo do upload),
 * assinatura do arquivo (jpeg, png, webp ou pdf) e, se o Trello declarou um tipo desses, que ele bata com a assinatura.
 * `definitivo`: erro que não muda se tentar de novo (grande, tipo, URL de fora); `rede` pode passar.
 */
export async function baixarAnexoDoTrello(cred: CredenciaisTrello, a: AnexoTrello): Promise<ResBaixa> {
  if (!a.upload || !urlDoTrello(a.url)) return { ok: false, motivo: 'fora_do_trello', definitivo: true };
  if (a.bytes > LIMITE_BYTES) return { ok: false, motivo: 'grande', definitivo: true };
  try {
    let url = a.url;
    for (let salto = 0; salto <= MAX_REDIRECIONAMENTOS; salto++) {
      const headers: Record<string, string> = urlDoTrello(url) ? { Authorization: cabecalhoOAuth(cred) } : {};
      const r = await trelloFetch(url, { method: 'GET', headers, redirect: 'manual' });
      if (r.status >= 300 && r.status < 400) {
        const destino = r.headers.get('location');
        if (!destino || salto === MAX_REDIRECIONAMENTOS) return { ok: false, motivo: 'rede', definitivo: false };
        const proximo = new URL(destino, url);
        if (proximo.protocol !== 'https:') return { ok: false, motivo: 'fora_do_trello', definitivo: true };
        url = proximo.toString();
        continue;
      }
      if (!r.ok) return { ok: false, motivo: 'rede', definitivo: r.status === 404 || r.status === 403 };
      const declarado = Number(r.headers.get('content-length'));
      if (Number.isFinite(declarado) && declarado > LIMITE_BYTES) return { ok: false, motivo: 'grande', definitivo: true };
      const corpo = await lerCorpoLimitado(r);
      if (corpo === 'grande') return { ok: false, motivo: 'grande', definitivo: true };
      if (corpo === 'tempo' || corpo.length === 0) return { ok: false, motivo: 'rede', definitivo: false };
      const bytes = corpo;
      const mime = mimePelaAssinatura(bytes);
      if (!mime) return { ok: false, motivo: 'tipo', definitivo: true };
      const dito = a.mime.split(';')[0].trim();
      if (dito && ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(dito) && dito !== mime) return { ok: false, motivo: 'tipo', definitivo: true };
      return { ok: true, bytes, mime };
    }
    return { ok: false, motivo: 'rede', definitivo: false };
  } catch {
    return { ok: false, motivo: 'rede', definitivo: false };
  }
}
