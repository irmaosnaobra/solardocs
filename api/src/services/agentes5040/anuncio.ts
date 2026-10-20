// ───────────────────────────────────────────────────────────────────────────
// A6 · LEITURA DO ANÚNCIO DE ORIGEM (agentes da 5040)
//
// Quem clica num anúncio de "enviar mensagem" chega no WhatsApp com um bloco
// de anúncio no payload da Z-API: `externalAdReply` (sourceId, sourceUrl,
// title, ctwaClid...) e, em alguns formatos, `adContext`. O webhook já grava o
// payload inteiro em webhook_debug, e wa_mensagens.webhook_debug_id aponta
// para ele. Aqui só se LÊ: nada muda quem responde.
//
// Regras:
//  - lerAnuncioDoPayload é PURO (sem banco, sem rede).
//  - O ctwaClid pode sair daqui em memória, mas NUNCA vai para system_state,
//    log nem resposta de rota. Telefone e texto da conversa nem passam por aqui.
//  - webhook_debug.created_at vem 3h adiantado: este arquivo não filtra essa
//    coluna; chega ao payload pelo id da wa_mensagens (wa_mensagens.momment
//    está certo).
//  - Não importa nenhuma função de envio.
// ───────────────────────────────────────────────────────────────────────────

/** Cópia local de Produto (tipos.ts nasce em outro pacote). */
type ProdutoAnuncio = 'solardoc' | 'solar' | 'eletroposto';

export interface AnuncioLido {
  /** Id do anúncio na Meta (só dígitos, 10 a 20), ou null se o bloco não traz um. */
  adId: string | null;
  sourceUrl: string | null;
  titulo: string | null;
  sourceType: string | null;
  /** Fica só em memória. Nunca gravar em system_state nem devolver em rota. */
  ctwaClid: string | null;
  /** Campos do adContext que a lista branca deixa passar (só texto curto, número e booleano). */
  adContext: Record<string, string | number | boolean>;
  /** NOMES dos campos que o payload trouxe (nunca valores), para descobrir o formato real. */
  camposExternalAdReply: string[];
  camposAdContext: string[];
}

const ID_META = /^\d{10,20}$/;
const CAMPOS_ADCONTEXT_OK = [
  'sourceId', 'sourceUrl', 'sourceType', 'title', 'body', 'mediaType',
  'adId', 'ad_id', 'adsetId', 'adset_id', 'campaignId', 'campaign_id', 'adTitle', 'adName',
];

const ehObjeto = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);

const texto = (x: unknown, max = 300): string | null => {
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t ? t.slice(0, max) : null;
};

/** Nomes de campo (até 3 níveis, "a.b.c"; lista vira "a[]"). Nome estranho é descartado. */
function nomesDosCampos(o: unknown, prefixo = '', nivel = 0, saida: string[] = []): string[] {
  if (!ehObjeto(o) || nivel > 2) return saida;
  for (const [k, v] of Object.entries(o)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(k)) continue;
    const nome = prefixo ? `${prefixo}.${k}` : k;
    saida.push(nome);
    if (Array.isArray(v)) {
      saida.push(`${nome}[]`);
      const primeiro = v.find(ehObjeto);
      if (primeiro) nomesDosCampos(primeiro, `${nome}[]`, nivel + 1, saida);
    } else {
      nomesDosCampos(v, nome, nivel + 1, saida);
    }
  }
  return saida;
}

/**
 * Lê o bloco de anúncio de um payload da Z-API. Devolve null quando não há
 * bloco nenhum (ou o payload é lixo). Nunca lança.
 */
export function lerAnuncioDoPayload(p: unknown): AnuncioLido | null {
  if (!ehObjeto(p)) return null;
  const ext = ehObjeto(p.externalAdReply) ? p.externalAdReply : null;
  const ctx = ehObjeto(p.adContext) ? p.adContext : null;
  // Webhook antigo grava só o clid no topo do payload (tracking.ctwa_clid).
  const clidTopo = texto(p.ctwa_clid, 200);
  if (!ext && !ctx && !clidTopo) return null;

  const adContext: Record<string, string | number | boolean> = {};
  if (ctx) {
    for (const campo of CAMPOS_ADCONTEXT_OK) {
      const v = ctx[campo];
      if (typeof v === 'boolean') adContext[campo] = v;
      else if (typeof v === 'number' && Number.isFinite(v)) adContext[campo] = v;
      else {
        const t = texto(v);
        if (t) adContext[campo] = t;
      }
    }
  }

  const candidatos = [ext?.sourceId, ctx?.sourceId, ctx?.adId, ctx?.ad_id]
    .map((x) => texto(x, 40))
    .filter((x): x is string => !!x);
  const adId = candidatos.find((x) => ID_META.test(x)) ?? null;

  return {
    adId,
    sourceUrl: texto(ext?.sourceUrl) ?? texto(ctx?.sourceUrl),
    titulo: texto(ext?.title) ?? texto(ctx?.title),
    sourceType: texto(ext?.sourceType, 40) ?? texto(ctx?.sourceType, 40),
    ctwaClid: texto(ext?.ctwaClid, 200) ?? texto(ctx?.ctwaClid, 200) ?? clidTopo,
    adContext,
    camposExternalAdReply: nomesDosCampos(ext),
    camposAdContext: nomesDosCampos(ctx),
  };
}

async function banco() {
  // Import tardio: o arquivo continua puro para quem só usa lerAnuncioDoPayload.
  return (await import('../../utils/supabase')).supabase;
}

/**
 * Lê o anúncio de UMA mensagem pelo webhook_debug_id da wa_mensagens.
 * `ok: false` = não deu para ler (quem decide precisa tratar como "não sei");
 * `ok: true, anuncio: null` = leu e a mensagem não veio de anúncio.
 */
export async function lerAnuncioDaMensagem(webhookDebugId: string | null | undefined):
  Promise<{ ok: boolean; anuncio: AnuncioLido | null; motivo?: string }> {
  const id = String(webhookDebugId || '').trim();
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) return { ok: false, anuncio: null, motivo: 'webhook_debug_id inválido' };
  try {
    const sb = await banco();
    const { data, error } = await sb.from('webhook_debug')
      .select('externalAdReply:payload->externalAdReply, adContext:payload->adContext, ctwa_clid:payload->ctwa_clid')
      .eq('id', id).maybeSingle();
    if (error) return { ok: false, anuncio: null, motivo: String(error.message || error).slice(0, 160) };
    if (!data) return { ok: true, anuncio: null };
    return { ok: true, anuncio: lerAnuncioDoPayload(data) };
  } catch (err) {
    return { ok: false, anuncio: null, motivo: String((err as Error)?.message || err).slice(0, 160) };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// RELATÓRIO DA ROTA /cron/agentes-5040/anuncios (só leitura)
// ───────────────────────────────────────────────────────────────────────────
export interface RelatorioAnuncios {
  ok: boolean;
  dias: number;
  mensagens_recebidas: number;
  truncado: boolean;
  com_bloco: number;
  com_ad_id: number;
  ids: Array<{ id: string; mensagens: number; campanha: string | null; produto: ProdutoAnuncio | null; motivo?: string }>;
  por_produto: Record<ProdutoAnuncio | 'desconhecido', number>;
  campos_adContext?: string[];
  campos_externalAdReply?: string[];
  erro?: string;
}

const PAGINA = 1000;
const LOTE_IDS = 100;
const MAX_MENSAGENS = 60_000;
const ORCAMENTO_MS = 45_000;
const MAX_ANUNCIOS_RESOLVIDOS = 40;
/** Os passos 1 e 2 param em ORCAMENTO_MS; a Meta só é chamada enquanto o total desde o início estiver abaixo disto. */
const ORCAMENTO_TOTAL_MS = 240_000;

/**
 * Conta, nas mensagens RECEBIDAS dos últimos `dias` dias, quantas trazem bloco
 * de anúncio, quais ids aparecem e a que produto cada um pertence. Com `chaves`,
 * junta os NOMES dos campos do bloco. Nunca devolve valor, telefone ou texto.
 * Filtra e pagina no servidor (o PostgREST corta em 1000 linhas).
 */
export async function relatorioAnuncios(dias: number, opts: { chaves?: boolean; meta?: boolean; orcamentoTotalMs?: number } = {}): Promise<RelatorioAnuncios> {
  const d = Number.isFinite(dias) ? Math.min(90, Math.max(1, Math.floor(dias))) : 30;
  const vazio: RelatorioAnuncios = {
    ok: false, dias: d, mensagens_recebidas: 0, truncado: false, com_bloco: 0, com_ad_id: 0,
    ids: [], por_produto: { solardoc: 0, solar: 0, eletroposto: 0, desconhecido: 0 },
  };
  const inicio = Date.now();
  // Mesma regra da caixa: sem a instância da linha IO não há como separar a linha, e "todas as linhas" nunca é a resposta.
  const instancia = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
  if (!instancia) return { ...vazio, erro: 'sem ZAPI_INSTANCE_ID_IO' };
  try {
    const sb = await banco();
    const desde = new Date(Date.now() - d * 86_400_000).toISOString();

    // 1) mensagens recebidas com ponteiro para o payload cru, paginadas por momment/id
    const ponteiros: string[] = [];
    let recebidas = 0;
    let truncado = false;
    for (let de = 0; ; de += PAGINA) {
      if (recebidas >= MAX_MENSAGENS || Date.now() - inicio > ORCAMENTO_MS) { truncado = true; break; }
      const { data, error } = await sb.from('wa_mensagens')
        .select('id, webhook_debug_id')
        .eq('instancia', instancia).eq('from_me', false).eq('is_group', false)
        .gte('momment', desde)
        .order('momment', { ascending: false }).order('id', { ascending: false })
        .range(de, de + PAGINA - 1);
      if (error) return { ...vazio, erro: String(error.message || error).slice(0, 160) };
      const linhas = data ?? [];
      recebidas += linhas.length;
      for (const l of linhas) if (l.webhook_debug_id) ponteiros.push(String(l.webhook_debug_id));
      if (linhas.length < PAGINA) break;
    }

    // 2) payload cru, só os dois sub-objetos, em lotes por id (índice da chave primária)
    const porAnuncio = new Map<string, number>();
    const camposCtx = new Set<string>();
    const camposExt = new Set<string>();
    let comBloco = 0;
    let comAdId = 0;
    const lotes: string[][] = [];
    for (let i = 0; i < ponteiros.length; i += LOTE_IDS) lotes.push(ponteiros.slice(i, i + LOTE_IDS));
    const SIMULTANEOS = 5;
    for (let i = 0; i < lotes.length; i += SIMULTANEOS) {
      if (Date.now() - inicio > ORCAMENTO_MS) { truncado = true; break; }
      const grupo = await Promise.all(lotes.slice(i, i + SIMULTANEOS).map(async (ids) => {
        const { data, error } = await sb.from('webhook_debug')
          .select('externalAdReply:payload->externalAdReply, adContext:payload->adContext, ctwa_clid:payload->ctwa_clid')
          .in('id', ids);
        if (error) throw new Error(String(error.message || error));
        return data ?? [];
      }));
      for (const linhas of grupo) {
        for (const l of linhas) {
          const a = lerAnuncioDoPayload(l);
          if (!a) continue;
          comBloco++;
          if (a.adId) { comAdId++; porAnuncio.set(a.adId, (porAnuncio.get(a.adId) ?? 0) + 1); }
          if (opts.chaves) {
            a.camposAdContext.forEach((c) => camposCtx.add(c));
            a.camposExternalAdReply.forEach((c) => camposExt.add(c));
          }
        }
      }
    }

    // 3) id -> campanha -> produto (cache de 7 dias; só os mais frequentes)
    const { buscarOrigemDoAnuncio, produtoDaCampanha, lerMapaCampanhaProduto } = await import('../io/metaConjuntos');
    const mapa = opts.meta === false ? {} : await lerMapaCampanhaProduto();
    const ordenados = [...porAnuncio.entries()].sort((a, b) => b[1] - a[1]);
    const porProduto = { ...vazio.por_produto };
    const ids: RelatorioAnuncios['ids'] = [];
    const limite = opts.orcamentoTotalMs ?? ORCAMENTO_TOTAL_MS;
    const resolvidos = new Map<string, { campanha: string | null; produto: ProdutoAnuncio | null; motivo?: string }>();
    if (opts.meta !== false) {
      // Em grupos de 5 (cada chamada já tem timeout de 8 s); passou do orçamento, para e marca truncado.
      const alvo = ordenados.slice(0, MAX_ANUNCIOS_RESOLVIDOS);
      for (let g = 0; g < alvo.length; g += 5) {
        if (Date.now() - inicio > limite) { truncado = true; break; }
        await Promise.all(alvo.slice(g, g + 5).map(async ([id]) => {
          const o = await buscarOrigemDoAnuncio(id);
          if (o.ok) {
            const campanha = o.campanha?.nome ?? null;
            resolvidos.set(id, { campanha, produto: produtoDaCampanha(campanha, mapa) });
          } else {
            resolvidos.set(id, { campanha: null, produto: null, motivo: o.motivo });
          }
        }));
      }
    }
    for (const [id, n] of ordenados) {
      const r = resolvidos.get(id) ?? { campanha: null, produto: null };
      porProduto[r.produto ?? 'desconhecido'] += n;
      ids.push({ id, mensagens: n, campanha: r.campanha, produto: r.produto, ...(r.motivo ? { motivo: r.motivo } : {}) });
    }

    return {
      ok: true, dias: d, mensagens_recebidas: recebidas, truncado,
      com_bloco: comBloco, com_ad_id: comAdId, ids, por_produto: porProduto,
      ...(opts.chaves ? { campos_adContext: [...camposCtx].sort(), campos_externalAdReply: [...camposExt].sort() } : {}),
    };
  } catch (err) {
    return { ...vazio, erro: String((err as Error)?.message || err).slice(0, 160) };
  }
}
