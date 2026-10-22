import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { ehSocio, podeVer } from '../services/gerador/solarObras';
import {
  vendaSolarDoDono, codigosSolar, acessoVendaSolar, ErroVendaSolar, equipamentoDoCardParaRelatorio, type VendaSolarDoDono,
} from './geradorClientes';
import { lerLigacao } from '../services/gerador/vendaSolarHub';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { lerProposta, assinar, normalizarNome, ARQUIVOS_SOLAR } from '../services/gerador/dossieVenda';
import { celulaDe } from '../services/gerador/gestaoClientes';
import { lerCadastro, sobreporCadastro } from '../services/gerador/cadastroVenda';
import { celulaFicha, type CardVendido } from '../services/gerador/fichaEletroposto';
import {
  lerCardVendido, lerFichaComVersao, ErroFicha,
} from '../services/gerador/fichaEletropostoBanco';
import { docsEnvioLimiter, docsEnvioIpLimiter } from '../middleware/rateLimiter';
import {
  CATALOGO, SLOTS_FORA_DO_RELATORIO, LIMITE_BYTES, LIMITES, ehLinha, codigoDeRota, itemDoCatalogo, mimeServeAoItem, normalizarMime, novoCaminho,
  lerCaminho, comArquivo, semArquivo, comVinculo, motivoSemEspaco, nomesParecidos, dadosSolarPlanilha, dadosVendaSolar, dadosEletroposto,
  equipamentoDaPlanilha, montarRelatorio, assinaturaBate, comArquivoMovido, motivoSemEspacoParaMover, TIPOS_FORA_DA_HOMOLOGACAO,
  limiteDoItem, SLOT_DO_DOSSIE_NA_VENDASOLAR, comArquivosTrocados, type ArquivoDoc, type Linha, type RegistroDocs, type DocBruto, type DadosHomologacao, type ItemDoc,
} from '../services/gerador/docsCliente';
import {
  ErroDocs, garantirBucketDocs, lerPrimeirosBytes, assinarEnvio, sondarObjeto, removerObjeto, assinarVarios, lerDocsComVersao, gravarDocs,
  lerVinculos, lerPropostaResumo, listarPropostasVendidas,
} from '../services/gerador/docsClienteBanco';
import { ErroCadastro, comTrava } from '../services/gerador/cadastroVendaBanco';
import { lerRotulos, gravarRotulos, rotuloManual, travaDaVenda, type Rotulos } from '../services/gerador/docsRotulos';

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENTOS e RELATÓRIO DE ENGENHARIA da ficha de clientes do /gerador (14/10/2026).
// Montadas dentro de /gerador. Todas exigem consultor logado (`exigeConsultor`) e respondem `Cache-Control: no-store`.
//
//   GET    /clientes/:linha/:codigo/docs                    itens, arquivos (URL de 5 min), vínculo (Solar), pode_remover
//   POST   /clientes/:linha/:codigo/docs/upload-url         { slot, mime, bytes } -> URL assinada de envio e caminho
//   POST   /clientes/:linha/:codigo/docs                    { slot, caminho } registra o que foi enviado
//   DELETE /clientes/:linha/:codigo/docs/:id                remove o arquivo e o metadado
//   PATCH  /clientes/:linha/:codigo/docs/:id                { rotulo?: string, slot?: string, trocar?: true } renomeia e/ou move de item;
//          `trocar` com o destino de 1 arquivo só ocupado troca os dois de lugar numa gravação só (resposta traz `trocado`)
//   POST   .../docs/upload-url e .../docs                   aceitam `substitui: <id>` ("Trocar arquivo"): o novo toma o lugar do antigo
//          do mesmo item numa gravação só e o objeto antigo só é apagado depois dela
//          (o rótulo mora no bucket privado `cadastros-venda`, nunca no `system_state`; veja services/gerador/docsRotulos.ts)
//   GET    /clientes/solar/:codigo/sugestoes-proposta       propostas vendidas de nome parecido
//   POST   /clientes/solar/:codigo/vincular-proposta        { proposta }
//   GET    /clientes/:linha/:codigo/relatorio               relatório de engenharia (sem dinheiro, URL de 15 min)
//
// :linha é `solar` ou `eletroposto`. O código aceita `0057`, `57` e `#0057` (o `#` chega como %23) no Solar e o id do
// card no Eletroposto; a chave e o caminho guardam só dígitos.
//
// POSSE é a mesma da ficha da linha e é conferida ANTES de qualquer outra recusa (item, tipo, tamanho): venda
// inexistente e venda alheia respondem IGUAL (404, mesma mensagem), senão a ordem das recusas revelaria o código.
// O dono do Solar é o consultor EFETIVO (um sócio pode ter trocado); o do Eletroposto é `vendedor_nome` do card.
//
// O navegador NUNCA vai à rota `/gerador/dossie` (ela deixa qualquer consultor ler qualquer proposta). O dossiê da
// proposta vinculada é lido AQUI, depois da posse da venda. Quem pode vincular: o sócio escolhe qualquer proposta
// vendida; o consultor só as que têm o nome DELE em `consultor_nome` (o nome do cliente é editável por ele, então não
// vale como permissão; senão ligaria a CNH de um cliente alheio). As sugestões são as vendidas, do papel, de nome parecido.
//
// Nenhum caminho, nome de arquivo ou texto de erro do Storage vai para log: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_NAO_ACHEI = 'Venda não encontrada.';
const MSG_PEDIDO = 'Pedido inválido.';
const MSG_SUBSTITUI = 'O arquivo a trocar não está neste item. Atualize a lista.';
/**
 * Apaga do bucket o objeto do arquivo que acabou de ser trocado: 2 tentativas com uma espera curta. Se as duas falharem não há fila de
 * limpeza no projeto: o log leva só a venda e o id do arquivo (nunca o caminho nem dado pessoal) para o objeto não ficar órfão calado.
 * O registro já não aponta para ele e o caminho já está em `apagados`, então ninguém consegue abri-lo ou registrá-lo de novo.
 */
async function apagarAntigo(ctx: Ctx, antigo: ArquivoDoc): Promise<void> {
  for (let t = 0; t < 2; t++) {
    try { await removerObjeto(antigo.caminho); return; } catch (e) {
      if (t === 0) await new Promise((r) => setTimeout(r, 300));
      else console.error(`[ficha-docs] objeto antigo ficou no bucket e precisa de limpeza (venda ${ctx.linha}:${ctx.codigo}, arquivo ${antigo.id})`, e instanceof ErroDocs ? e.codigo : 'interno');
    }
  }
}
/** O nome que a PESSOA deu ao arquivo antigo passa para o novo; o nome da IA e o tipo lido eram do conteúdo antigo e saem. Falha só vai para o log. */
async function levarRotulo(ctx: Ctx, antigoId: string, novoId: string, agora: string): Promise<void> {
  try {
    await comTrava(travaDaVenda(ctx.linha, ctx.codigo), ctx.nome, async () => {
      const rot = await lerRotulos(ctx.linha, ctx.codigo);
      const r = rot.rotulos[antigoId];
      if (!r && !(antigoId in rot.tipos)) return;
      if (r && r.fonte === 'manual') rot.rotulos[novoId] = { ...r, em: agora };
      delete rot.rotulos[antigoId]; delete rot.tipos[antigoId];
      await gravarRotulos(ctx.linha, ctx.codigo, rot, agora);
    });
  } catch (e) { logErro('levar o nome do arquivo trocado falhou', e); }
}
/** `substitui` do corpo: '' = não pediu; o id (36 caracteres) quando pediu; null = veio em formato inválido. */
const substituiDe = (b: Record<string, unknown>): string | null => {
  if (b.substitui === undefined) return '';
  return typeof b.substitui === 'string' && /^[0-9a-f-]{36}$/.test(b.substitui) ? b.substitui : null;
};
const MSG_LER = 'Não consegui ler os dados agora. Tente de novo em instantes.';
const MSG_GRAVAR = 'Não consegui gravar agora. Tente de novo.';
const TENTATIVAS = 4;
const SEG_URL_DOCS = 300;        // 5 min
const SEG_URL_RELATORIO = 900;   // 15 min

export function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

const quem = (req: Request): { nome: string; socio: boolean } => {
  const nome = String((req as any).consultor?.nome || '');
  return { nome, socio: ehSocio(nome) };
};

const logErro = (que: string, err: unknown): void =>
  console.error(`[ficha-docs] ${que}`, err instanceof ErroDocs ? err.codigo : err instanceof ErroFicha ? err.codigo : (err as { codigo?: unknown } | null)?.codigo ?? 'interno');

export interface Ctx {
  linha: Linha;
  /** Só dígitos: o que vai na chave e no caminho. */
  codigo: string;
  nome: string;
  socio: boolean;
  cliente: string;
  solar?: VendaSolarDoDono;
  card?: CardVendido;
}

/** O pedido falhou por erro de leitura/gravação: responde e devolve true. */
function falhou(res: Response, que: string, err: unknown): void {
  logErro(que, err);
  if (err instanceof ErroDocs) { res.status(err.http).json({ ok: false, error: err.mensagem }); return; }
  if (err instanceof ErroVendaSolar) { res.status(err.http).json({ ok: false, error: MSG_LER }); return; }
  res.status(500).json({ ok: false, error: MSG_LER });
}

/**
 * Formato da linha e do código (400), depois a POSSE (404 igual para inexistente e alheia). Devolve null depois de
 * responder. Nada além disto é conferido antes da posse.
 */
export async function contexto(req: Request, res: Response, linhaFixa?: Linha): Promise<Ctx | null> {
  const { nome, socio } = quem(req);
  const linha = linhaFixa ?? req.params.linha;
  if (!ehLinha(linha)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return null; }
  const codigo = codigoDeRota(linha, req.params.codigo);
  if (!codigo) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return null; }
  try {
    if (linha === 'solar') {
      const s = await vendaSolarDoDono(nome, socio, `#${codigo.padStart(4, '0')}`);
      if (!s) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return null; }
      const col = s.cols.find((c) => c.chave === 'cliente');
      const v = col ? celulaDe(col, s.venda.celulas[col.indice] ?? '', s.reg).valor : '';
      return { linha, codigo, nome, socio, cliente: typeof v === 'string' ? v : '', solar: s };
    }
    if (linha === 'vendasolar') {
      // Venda solar pelo card: o card existe, é SOLAR e está `fechou`; vê quem é o vendedor do card, o consultor da venda da
      // planilha ligada a ele, ou sócio. Inexistente, de eletroposto, não vendido e alheio respondem IGUAL (404).
      const c = await acessoVendaSolar(nome, socio, Number(codigo));
      if (!c) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return null; }
      return { linha, codigo, nome, socio, cliente: String(c.cliente_nome ?? ''), card: c };
    }
    const card = await lerCardVendido(Number(codigo));
    if (!card || !(socio || podeVer(nome, String(card.vendedor_nome ?? '')))) {
      res.status(404).json({ ok: false, error: MSG_NAO_ACHEI });
      return null;
    }
    return { linha, codigo, nome, socio, cliente: String(card.cliente_nome ?? ''), card };
  } catch (err) {
    falhou(res, 'posse falhou', err);
    return null;
  }
}

/** Corpo precisa ser objeto simples; chave a mais é ignorada (nunca gravada). */
const corpoDe = (req: Request): Record<string, unknown> | null => {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};

/** `rot`: os rótulos da venda (null = não há ou não foram lidos). `rotulo` e `rotulo_fonte` só saem quando há rótulo. */
const lerNaTela = (a: { id: string; slot: string; mime: string; bytes: number; em: string; por: string; caminho: string }, urls: Map<string, string>, rot?: Rotulos | null) => {
  const r = rot?.rotulos[a.id];
  return {
    id: a.id, slot: a.slot, mime: a.mime, bytes: a.bytes, em: a.em, por: a.por, url: urls.get(a.caminho) ?? null,
    ...(r ? { rotulo: r.rotulo, rotulo_fonte: r.fonte } : {}),
  };
};

/** Lê os rótulos sem nunca derrubar quem chama: falha vira null (e só o código do erro vai para o log). */
async function rotulosOuNulo(ctx: Ctx): Promise<{ rot: Rotulos | null; indisponivel: boolean }> {
  try { return { rot: await lerRotulos(ctx.linha, ctx.codigo), indisponivel: false }; } catch (err) {
    logErro('rótulos indisponíveis', err);
    return { rot: null, indisponivel: true };
  }
}

const mimeDoDossie = (tipo: unknown, path: string): string => {
  const t = normalizarMime(tipo);
  if (t) return t;
  const ext = /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase();
  return ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
};

/** `path` e `tamanho` ficam no servidor (a leitura por IA baixa o arquivo); a resposta das rotas leva só slot, mime e url. */
interface ArqVinculado { slot: string; mime: string; url: string | null; path: string; bytes: number; em: string }

/**
 * Os arquivos do dossiê da proposta vinculada, lidos pelo servidor. A resposta das rotas leva só slot, mime e url: `nome` (o
 * nome original) fica aqui. URL que não assinou vem null (quem chama decide); falha de leitura vira `indisponivel`.
 * `soDaProposta` (venda solar pelo card): os caminhos vêm de `propostas.dados`, que é editável, então só vale o que começa pelo
 * código da PROPOSTA (`<codigo>/...`); senão um caminho injetado faria o servidor assinar (ou baixar) o arquivo de outra venda.
 * A linha `solar` (já em produção) NÃO usa a trava: o comportamento dela não mudou.
 */
async function lerDossieVinculado(
  proposta: string, segundos: number, comUrl = true, soDaProposta = false,
): Promise<{ arquivos: ArqVinculado[]; indisponivel: boolean }> {
  try {
    const p = await lerProposta(proposta);
    if (!p) return { arquivos: [], indisponivel: false };
    const pedidos: Array<{ slot: string; mime: string; path: string; bytes: number; em: string }> = [];
    for (const s of ARQUIVOS_SOLAR) {
      for (const a of p.dossie.arquivos[s.key] ?? []) {
        if (soDaProposta && (typeof a.path !== 'string' || !a.path.startsWith(`${proposta}/`) || a.path.includes('..'))) {
          console.error('[ficha-docs] caminho do dossiê fora da proposta', 'caminho_fora');
          continue;
        }
        pedidos.push({ slot: s.key, mime: mimeDoDossie(a.tipo, a.path), path: a.path, bytes: Number(a.bytes) || 0, em: String(a.em ?? '') });
      }
    }
    const urls = await Promise.all(pedidos.map(async (x) => {
      if (!comUrl) return null;
      try { return await assinar(x.path, segundos); } catch { return null; }
    }));
    return { arquivos: pedidos.map((x, i) => ({ ...x, url: urls[i] })), indisponivel: false };
  } catch (err) {
    logErro('dossiê vinculado falhou', err);
    return { arquivos: [], indisponivel: true };
  }
}

/**
 * A proposta ligada ao card (venda solar pelo card), conferida de novo na LEITURA: o vínculo mora no `system_state`, que a chave
 * pública do banco principal alcança, e um vínculo injetado serviria o dossiê (CNH, conta de luz) de outra proposta. Vale só se a
 * proposta existe, está vendida e é do papel (sócio, ou o nome DELE em `consultor_nome`). null = nada ligado ou não vale.
 */
export async function propostaLigadaAoCard(ctx: Ctx): Promise<string | null> {
  const { lig } = await lerLigacao(Number(ctx.codigo));
  if (!lig.proposta) return null;
  const p = await lerPropostaResumo(lig.proposta);
  if (p && p.vendido && propostaDoPapel(ctx, p.consultor_nome)) return lig.proposta;
  console.error('[ficha-docs] vínculo fora do papel', 'vinculo_fora');
  return null;
}

/** O slot do dossiê no catálogo da `vendasolar`, ou null (slot que o catálogo não tem). */
const slotDaVendaSolar = (slotDoDossie: string): string | null => SLOT_DO_DOSSIE_NA_VENDASOLAR[slotDoDossie] ?? null;

/**
 * Os arquivos do dossiê da proposta ligada ao card, já nos itens da `vendasolar` (`documento` vira `documento_titular`).
 * Só leitura: o dossiê não migra. `jpg` vira `jpeg`. null = nada ligado (ou o vínculo não vale).
 */
export async function dossieDaVendaSolar(ctx: Ctx, segundos: number, comUrl = true) {
  const proposta = await propostaLigadaAoCard(ctx);
  if (!proposta) return null;
  const d = await lerDossieVinculado(proposta, segundos, comUrl, true);
  const arquivos = d.arquivos.flatMap((a) => {
    const slot = slotDaVendaSolar(a.slot);
    return slot ? [{ ...a, slot, mime: a.mime === 'image/jpg' ? 'image/jpeg' : a.mime }] : [];
  });
  return { proposta, arquivos, indisponivel: d.indisponivel };
}

/**
 * O vínculo, conferido de novo na LEITURA. O vínculo mora no `system_state`, acessível pela chave do banco principal: um
 * vínculo injetado serviria o dossiê (CNH, conta de luz) de outra proposta. Quem não é sócio só enxerga o vínculo cuja
 * proposta é dele (`propostaDoPapel`, a mesma regra do vincular); os outros são ignorados, com log só do código.
 */
async function vinculoDaLeitura(ctx: Ctx, reg: RegistroDocs): Promise<string | null> {
  if (!reg.vinculo) return null;
  if (ctx.socio) return reg.vinculo.proposta;
  const p = await lerPropostaResumo(reg.vinculo.proposta);
  if (p && propostaDoPapel(ctx, p.consultor_nome)) return reg.vinculo.proposta;
  console.error('[ficha-docs] vínculo fora do papel', 'vinculo_fora');
  return null;
}

async function blocoVinculo(ctx: Ctx, reg: RegistroDocs, segundos: number) {
  const proposta = await vinculoDaLeitura(ctx, reg);
  if (!proposta) return null;
  const d = await lerDossieVinculado(proposta, segundos);
  return {
    proposta,
    arquivos: d.arquivos.filter((a) => a.url).map((a) => ({ slot: a.slot, mime: a.mime, url: a.url as string })),
    ...(d.indisponivel ? { indisponivel: true } : {}),
  };
}

/**
 * O campo `dossie` do GET dos documentos da `vendasolar`: `{ proposta, arquivos: [{ slot, url, mime, de: 'dossie' }] }`, ou null
 * quando não há proposta ligada. Falha de leitura NUNCA derruba a lista: vira `dossie: null` e `dossie_indisponivel: true`.
 */
async function blocoDossieVendaSolar(ctx: Ctx): Promise<Record<string, unknown>> {
  try {
    const d = await dossieDaVendaSolar(ctx, SEG_URL_DOCS);
    if (!d) return { dossie: null };
    return {
      dossie: {
        proposta: d.proposta,
        arquivos: d.arquivos.filter((a) => a.url).map((a) => ({ slot: a.slot, url: a.url as string, mime: a.mime, de: 'dossie' })),
        ...(d.indisponivel ? { indisponivel: true } : {}),
      },
    };
  } catch (err) {
    logErro('dossiê da venda solar falhou', err);
    return { dossie: null, dossie_indisponivel: true };
  }
}

/**
 * Lê o registro da venda e descarta o arquivo cujo caminho não é da MESMA linha e do MESMO código da chave. O
 * `system_state` é acessível pela chave do banco principal: sem isto, um caminho injetado numa venda faria a API assinar
 * (ou apagar) o objeto de outra. O descarte vale para a resposta e para a próxima gravação, que o limpa do registro.
 */
export async function lerDocs(ctx: Ctx): Promise<{ reg: RegistroDocs; versao: string | null }> {
  const l = await lerDocsComVersao(ctx.linha, ctx.codigo);
  const validos = l.reg.arquivos.filter((a) => {
    const c = lerCaminho(a.caminho);
    return !!c && c.linha === ctx.linha && c.codigo === ctx.codigo;
  });
  if (validos.length !== l.reg.arquivos.length) console.error('[ficha-docs] caminho fora da venda', 'caminho_fora');
  return { reg: { ...l.reg, arquivos: validos }, versao: l.versao };
}

export function mountClientesDocs(router: Router): void {
  const base = [exigeConsultor, semCache];
  // Só os dois POSTs de anexo (o global não os conta): teto por IP ANTES do login, depois o login, depois o teto por pessoa.
  const envio = [docsEnvioIpLimiter, exigeConsultor, semCache, docsEnvioLimiter];

  // ── Lista ──────────────────────────────────────────────────────────────────
  router.get('/clientes/:linha/:codigo/docs', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    try {
      await garantirBucketDocs();
      const [{ reg }, { rot, indisponivel }] = await Promise.all([lerDocs(ctx), rotulosOuNulo(ctx)]);
      const urls = await assinarVarios(reg.arquivos.map((a) => a.caminho), SEG_URL_DOCS);
      res.json({
        ok: true,
        slots: CATALOGO[ctx.linha],
        limite_bytes: LIMITE_BYTES,
        arquivos: reg.arquivos.map((a) => lerNaTela(a, urls, rot)),
        ...(indisponivel ? { rotulos_indisponivel: true } : {}),
        vinculo: ctx.linha === 'solar' ? await blocoVinculo(ctx, reg, SEG_URL_DOCS) : null,
        // Venda solar pelo card: o dossiê da proposta ligada, só leitura, já nos itens da `vendasolar`.
        ...(ctx.linha === 'vendasolar' ? await blocoDossieVendaSolar(ctx) : {}),
        // A posse já limitou a dono ou sócio: quem chegou aqui pode remover.
        pode_remover: true,
      });
    } catch (err) {
      falhou(res, 'lista falhou', err);
    }
  });

  // ── URL de envio ───────────────────────────────────────────────────────────
  router.post('/clientes/:linha/:codigo/docs/upload-url', ...envio, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    const b = corpoDe(req);
    const item = b ? itemDoCatalogo(ctx.linha, b.slot) : null;
    if (!b || !item) { res.status(400).json({ ok: false, error: 'Item não encontrado.' }); return; }
    const mime = normalizarMime(b.mime);
    if (!mimeServeAoItem(item, mime)) {
      res.status(400).json({ ok: false, error: item.aceita === 'imagem' ? 'Este item aceita só foto (jpg, png ou webp).' : 'Envie jpg, png, webp ou pdf.' });
      return;
    }
    const bytes = b.bytes;
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) { res.status(400).json({ ok: false, error: 'Diga o tamanho do arquivo.' }); return; }
    if (bytes > LIMITE_BYTES) { res.status(400).json({ ok: false, error: 'O arquivo passa de 10 MB.' }); return; }
    const subId = substituiDe(b);
    if (subId === null) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    if (subId && !podeRemover(ctx)) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }
    try {
      await garantirBucketDocs();
      const { reg } = await lerDocs(ctx);
      // "Trocar arquivo": o novo toma o lugar do `substitui`, que tem que estar neste mesmo item. O antigo não conta no espaço.
      if (subId && reg.arquivos.find((x) => x.id === subId)?.slot !== item.chave) { res.status(400).json({ ok: false, error: MSG_SUBSTITUI }); return; }
      const motivo = subId ? motivoSemEspacoParaMover(reg, subId, item) : motivoSemEspaco(reg, item);
      if (motivo) { res.status(409).json({ ok: false, motivo, error: mensagemSemEspaco(motivo, item) }); return; }
      const caminho = novoCaminho(ctx.linha, ctx.codigo, mime);
      const env = await assinarEnvio(caminho);
      // cache-control curto: depois de um DELETE, a cópia em cache do Storage some em 1 min (o padrão é 1 hora),
      // então a URL assinada que alguém já tinha deixa de abrir o documento removido quase na hora.
      res.json({ ok: true, upload_url: env.upload_url, metodo: 'PUT', cabecalhos: { 'content-type': mime, 'cache-control': 'max-age=60' }, token: env.token, caminho });
    } catch (err) {
      falhou(res, 'url de envio falhou', err);
    }
  });

  // ── Registrar o que foi enviado ────────────────────────────────────────────
  router.post('/clientes/:linha/:codigo/docs', ...envio, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    const b = corpoDe(req);
    const item = b ? itemDoCatalogo(ctx.linha, b.slot) : null;
    if (!b || !item) { res.status(400).json({ ok: false, error: 'Item não encontrado.' }); return; }
    // O caminho inteiro tem que ser o que o servidor gera E ser desta venda (linha e código).
    const c = lerCaminho(b.caminho);
    if (!c || c.linha !== ctx.linha || c.codigo !== ctx.codigo) { res.status(400).json({ ok: false, error: 'Caminho inválido.' }); return; }
    const caminho = b.caminho as string;
    const subId = substituiDe(b);
    if (subId === null) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    if (subId && !podeRemover(ctx)) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }
    try {
      await garantirBucketDocs();
      // Caminho já apagado nunca volta: o token de envio vale 2 h e o mesmo caminho poderia ser reenviado depois do DELETE.
      if ((await lerDocs(ctx)).reg.apagados.includes(caminho)) {
        await removerObjeto(caminho).catch((e) => logErro('limpeza falhou', e));
        res.status(400).json({ ok: false, error: 'Este arquivo foi removido. Envie de novo.' });
        return;
      }
      const sonda = await sondarObjeto(caminho);
      if (!sonda.existe) { res.status(400).json({ ok: false, error: 'Não achei o arquivo enviado. Envie de novo.' }); return; }
      // Tamanho e tipo vêm do Storage, nunca do corpo. A extensão do caminho também tem que bater com o tipo guardado.
      if (sonda.bytes <= 0 || sonda.bytes > LIMITE_BYTES || sonda.mime !== c.mime || !mimeServeAoItem(item, sonda.mime)) {
        await removerObjeto(caminho).catch((e) => logErro('limpeza falhou', e));
        res.status(400).json({ ok: false, error: sonda.bytes > LIMITE_BYTES ? 'O arquivo passa de 10 MB.' : 'Tipo de arquivo não aceito neste item.' });
        return;
      }
      // O tipo que o Storage guarda é o que o navegador declarou: a assinatura do arquivo tem que bater com ele.
      let primeiros: Uint8Array;
      try { primeiros = await lerPrimeirosBytes(caminho); } catch (e) {
        // Sem conseguir conferir o tipo, o objeto não pode ficar solto no bucket: tenta remover antes do 502.
        await removerObjeto(caminho).catch((e2) => logErro('limpeza falhou', e2));
        throw e;
      }
      if (!assinaturaBate(sonda.mime, primeiros)) {
        await removerObjeto(caminho).catch((e) => logErro('limpeza falhou', e));
        res.status(400).json({ ok: false, error: 'O arquivo não é do tipo informado.' });
        return;
      }
      for (let t = 0; t < TENTATIVAS; t++) {
        const { reg, versao } = await lerDocs(ctx);
        if (reg.apagados.includes(caminho)) {
          await removerObjeto(caminho).catch((e) => logErro('limpeza falhou', e));
          res.status(400).json({ ok: false, error: 'Este arquivo foi removido. Envie de novo.' });
          return;
        }
        if (reg.arquivos.some((a) => a.caminho === caminho)) {
          res.status(409).json({ ok: false, error: 'Este arquivo já foi registrado.' });
          return;
        }
        const antigo = subId ? reg.arquivos.find((x) => x.id === subId) : undefined;
        if (subId && (!antigo || antigo.slot !== item.chave)) {
          await removerObjeto(caminho).catch((e) => logErro('limpeza falhou', e));
          res.status(400).json({ ok: false, error: MSG_SUBSTITUI });
          return;
        }
        const motivo = subId ? motivoSemEspacoParaMover(reg, subId, item) : motivoSemEspaco(reg, item);
        if (motivo) {
          await removerObjeto(caminho).catch((e) => logErro('limpeza falhou', e));
          res.status(409).json({ ok: false, motivo, error: mensagemSemEspaco(motivo, item) });
          return;
        }
        const agora = new Date().toISOString();
        const arq = { id: crypto.randomUUID(), slot: item.chave, caminho, mime: sonda.mime, bytes: sonda.bytes, em: agora, por: ctx.nome };
        // Troca: UMA gravação põe o novo e tira o antigo do registro. O objeto antigo só é apagado depois dela; se a gravação falhar,
        // o antigo continua como estava (o novo fica solto no bucket e a pessoa tenta de novo).
        const novoReg = antigo ? comArquivo(semArquivo(reg, antigo.id, ctx.nome, agora), arq) : comArquivo(reg, arq);
        if (!(await gravarDocs(ctx.linha, ctx.codigo, novoReg, versao, agora))) continue;   // perdeu a corrida: lê de novo
        if (antigo) {
          await apagarAntigo(ctx, antigo);
          await levarRotulo(ctx, antigo.id, arq.id, agora);
        }
        let urls = new Map<string, string>();
        try { urls = await assinarVarios([caminho], SEG_URL_DOCS); } catch (e) { logErro('assinar falhou', e); }
        res.json({ ok: true, arquivo: lerNaTela(arq, urls), ...(antigo ? { substituiu: antigo.id } : {}) });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta ficha agora. Tente de novo.' });
    } catch (err) {
      if (err instanceof ErroDocs) { falhou(res, 'registrar falhou', err); return; }
      logErro('registrar falhou', err);
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
    }
  });

  // ── Remover ────────────────────────────────────────────────────────────────
  router.delete('/clientes/:linha/:codigo/docs/:id', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    // Só o dono da venda ou o sócio. A posse já filtrou para isso; a conferência fica explícita para não depender da ordem.
    if (!podeRemover(ctx)) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }
    try {
      await garantirBucketDocs();
      for (let t = 0; t < TENTATIVAS; t++) {
        const { reg, versao } = await lerDocs(ctx);
        const a = reg.arquivos.find((x) => x.id === id);
        if (!a) { res.status(404).json({ ok: false, error: 'Arquivo não encontrado.' }); return; }
        await removerObjeto(a.caminho);   // 1º o objeto: se falhar, o metadado fica e a pessoa tenta de novo
        const agora = new Date().toISOString();
        if (!(await gravarDocs(ctx.linha, ctx.codigo, semArquivo(reg, id, ctx.nome, agora), versao, agora))) continue;
        res.json({ ok: true });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta ficha agora. Tente de novo.' });
    } catch (err) {
      falhou(res, 'remover falhou', err);
    }
  });

  // ── Renomear e/ou mover ────────────────────────────────────────────────────
  // Ordem das recusas: formato da linha/código, posse (404 igual), id, `podeRemover`, corpo, item, formato, espaço.
  router.patch('/clientes/:linha/:codigo/docs/:id', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/.test(id)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    if (!podeRemover(ctx)) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }
    const b = corpoDe(req);
    const querRotulo = !!b && b.rotulo !== undefined;
    const querSlot = !!b && b.slot !== undefined;
    if (!b || (!querRotulo && !querSlot)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    let rotuloNovo = '';
    if (querRotulo) {
      const r = rotuloManual(b.rotulo);
      if (!r.ok) { res.status(400).json({ ok: false, error: r.erro }); return; }
      rotuloNovo = r.valor;
    }
    const itemNovo = querSlot ? itemDoCatalogo(ctx.linha, b.slot) : null;
    if (querSlot && !itemNovo) { res.status(400).json({ ok: false, error: 'Item não encontrado.' }); return; }
    try {
      await garantirBucketDocs();
      const feito = await comTrava(travaDaVenda(ctx.linha, ctx.codigo), ctx.nome, async () => {
        // Rótulos lidos ANTES de mexer no item: se o bucket deles estiver fora do ar, nada muda pela metade.
        const rot: Rotulos | null = querRotulo ? await lerRotulos(ctx.linha, ctx.codigo) : null;
        for (let t = 0; t < TENTATIVAS; t++) {
          const { reg, versao } = await lerDocs(ctx);
          const a = reg.arquivos.find((x) => x.id === id);
          if (!a) return { status: 404 as const, corpo: { ok: false, error: 'Arquivo não encontrado.' } };
          let atual = a;
          let trocado: ArquivoDoc | null = null;
          if (itemNovo && itemNovo.chave !== a.slot) {
            if (!mimeServeAoItem(itemNovo, a.mime)) {
              return { status: 400 as const, corpo: { ok: false, motivo: 'formato_nao_aceito', error: itemNovo.aceita === 'imagem' ? 'Este item aceita só foto (jpg, png ou webp).' : 'Este item aceita só pdf.' } };
            }
            const motivo = motivoSemEspacoParaMover(reg, id, itemNovo);
            // `trocar: true` só vale com o destino de UM arquivo só já ocupado: o arquivo de lá vai para o item de origem, nos dois
            // sentidos numa gravação só. Destino com espaço (ou que aceita vários) é um move comum; destino cheio de vários não troca.
            if (motivo === 'slot_ocupado' && b.trocar === true) {
              const ocupante = reg.arquivos.find((x) => x.slot === itemNovo.chave && x.id !== id);
              const itemOrigem = itemDoCatalogo(ctx.linha, a.slot);
              if (!ocupante || !itemOrigem || !mimeServeAoItem(itemOrigem, ocupante.mime)) {
                return { status: 400 as const, corpo: { ok: false, motivo: 'troca_nao_cabe', error: 'O arquivo que está lá não pode ir para o item de origem (tipo de arquivo diferente).' } };
              }
              const agora = new Date().toISOString();
              if (!(await gravarDocs(ctx.linha, ctx.codigo, comArquivosTrocados(reg, id, ocupante.id, ctx.nome, agora), versao, agora))) continue;
              atual = { ...a, slot: itemNovo.chave };
              trocado = { ...ocupante, slot: a.slot };
            } else {
              if (motivo) {
                const error = motivo === 'slot_ocupado' ? 'Este item já tem um arquivo. Troque os dois de lugar ou remova o atual antes de mover.' : mensagemSemEspaco(motivo, itemNovo);
                return { status: 409 as const, corpo: { ok: false, motivo, error } };
              }
              const agora = new Date().toISOString();
              const novo = comArquivoMovido(reg, id, itemNovo.chave, ctx.nome, agora);
              if (!(await gravarDocs(ctx.linha, ctx.codigo, novo, versao, agora))) continue;   // perdeu a corrida: lê de novo
              atual = { ...a, slot: itemNovo.chave };
            }
          }
          if (rot) {
            const agora = new Date().toISOString();
            if (rotuloNovo) rot.rotulos[id] = { rotulo: rotuloNovo, fonte: 'manual', por: ctx.nome, em: agora };
            else delete rot.rotulos[id];
            try { await gravarRotulos(ctx.linha, ctx.codigo, rot, agora); } catch (e) {
              logErro('gravar rótulo falhou', e);
              return {
                status: 503 as const,
                corpo: { ok: false, motivo: 'rotulos_indisponivel', movido: atual.slot !== a.slot, error: atual.slot !== a.slot ? 'O arquivo foi movido, mas não consegui salvar o nome. Tente renomear de novo.' : MSG_GRAVAR },
              };
            }
          }
          return { status: 200 as const, arquivo: atual, trocado, rot };
        }
        return { status: 409 as const, corpo: { ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta ficha agora. Tente de novo.' } };
      });
      if (feito.status !== 200) { res.status(feito.status).json(feito.corpo); return; }
      let urls = new Map<string, string>();
      try { urls = await assinarVarios([feito.arquivo.caminho, ...(feito.trocado ? [feito.trocado.caminho] : [])], SEG_URL_DOCS); } catch (e) { logErro('assinar falhou', e); }
      // Só mover: o rótulo que o arquivo já tinha acompanha (leitura que falha não derruba a resposta).
      const rotulos = feito.rot ?? (await rotulosOuNulo(ctx)).rot;
      res.json({
        ok: true, arquivo: lerNaTela(feito.arquivo, urls, rotulos),
        ...(feito.trocado ? { trocado: lerNaTela(feito.trocado, urls, rotulos) } : {}),
      });
    } catch (err) {
      if (err instanceof ErroCadastro) {
        logErro('renomear falhou', err);
        if (err.codigo === 'ocupado') {
          res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta ficha agora. Tente de novo.' });
        } else {
          res.status(503).json({ ok: false, motivo: 'rotulos_indisponivel', error: MSG_GRAVAR });
        }
        return;
      }
      falhou(res, 'renomear falhou', err);
    }
  });

  // ── Solar: sugestões de proposta ───────────────────────────────────────────
  router.get('/clientes/solar/:codigo/sugestoes-proposta', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res, 'solar');
    if (!ctx) return;
    try {
      const alvo = normalizarNome(ctx.cliente);
      const [props, vinculos] = await Promise.all([listarPropostasVendidas(), lerVinculosDasVendas()]);
      const deOutra = new Set([...vinculos].filter(([venda]) => venda !== ctx.codigo).map(([, p]) => p));
      const sugestoes = props
        .filter((p) => p.vendido && !deOutra.has(p.codigo) && propostaDoPapel(ctx, p.consultor_nome) && nomesParecidos(alvo, normalizarNome(p.cliente_nome)))
        .slice(0, 20)
        .map((p) => ({ codigo: p.codigo, cliente: p.cliente_nome, cidade: p.cliente_cidade, data: p.created_at.slice(0, 10) }));
      res.json({ ok: true, sugestoes });
    } catch (err) {
      falhou(res, 'sugestões falhou', err);
    }
  });

  // ── Solar: vincular proposta ───────────────────────────────────────────────
  router.post('/clientes/solar/:codigo/vincular-proposta', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res, 'solar');
    if (!ctx) return;
    const b = corpoDe(req);
    const proposta = b && typeof b.proposta === 'string' ? b.proposta.trim() : '';
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(proposta)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    try {
      const p = await lerPropostaResumo(proposta);
      // Consultor: só proposta DELE (`consultor_nome`). O nome do cliente não serve de permissão: a coluna `cliente` é
      // editável pelo dono, e quem renomeasse o cliente ligaria a proposta de outro consultor. Fora disso a resposta é a
      // de "não existe". Proposta sem consultor: só sócio.
      if (!p || !propostaDoPapel(ctx, p.consultor_nome)) {
        res.status(404).json({ ok: false, error: 'Proposta não encontrada.' });
        return;
      }
      if (!p.vendido) { res.status(409).json({ ok: false, error: 'Só uma proposta vendida pode ser vinculada.' }); return; }
      // Uma proposta só vale para UMA venda. (Duas vendas vinculando a mesma proposta no mesmo instante ainda passam:
      // a conferência e a gravação são de chaves diferentes e não há transação entre elas.)
      for (const [venda, prop] of await lerVinculosDasVendas()) {
        if (prop === p.codigo && venda !== ctx.codigo) {
          res.status(409).json({ ok: false, error: 'Esta proposta já está vinculada a outra venda.' });
          return;
        }
      }
      for (let t = 0; t < TENTATIVAS; t++) {
        const { reg, versao } = await lerDocs(ctx);
        let novo = reg;
        if (reg.vinculo?.proposta !== p.codigo) {
          const agora = new Date().toISOString();
          novo = comVinculo(reg, p.codigo, ctx.nome, agora);
          if (!(await gravarDocs('solar', ctx.codigo, novo, versao, agora))) continue;
        }
        res.json({ ok: true, vinculo: await blocoVinculo(ctx, novo, SEG_URL_DOCS) });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta ficha agora. Tente de novo.' });
    } catch (err) {
      falhou(res, 'vincular falhou', err);
    }
  });

  // ── Relatório de engenharia ────────────────────────────────────────────────
  router.get('/clientes/:linha/:codigo/relatorio', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    try {
      const agora = new Date().toISOString();
      await garantirBucketDocs();
      const [{ reg }, { rot }] = await Promise.all([lerDocs(ctx), rotulosOuNulo(ctx)]);
      const urls = await assinarVarios(reg.arquivos.map((a) => a.caminho), SEG_URL_RELATORIO);
      const rotulo = (slot: string): string => CATALOGO[ctx.linha].find((x) => x.chave === slot)?.rotulo ?? slot;

      let dados: DadosHomologacao; let cliente = ctx.cliente;
      // O cabeçalho da venda solar leva o `#NNNN` ligado (fase 2); sem venda ligada, o id do card como antes.
      let codigoDoRelatorio = ctx.linha === 'solar' ? `#${ctx.codigo.padStart(4, '0')}` : ctx.codigo;
      if (ctx.linha === 'solar') {
        const s = ctx.solar as VendaSolarDoDono;
        dados = dadosSolarPlanilha(equipamentoDaPlanilha(s.cols, s.venda.celulas, s.reg));
      } else if (ctx.linha === 'vendasolar') {
        // O cadastro do card vale para quem passou na posse do card. O equipamento vem de `equipamentoDoCardParaRelatorio`: código de
        // gente, a linha da planilha SÓ para quem a enxerga; código do alocador (fase 2), a linha que o /gerador monta (em conflito,
        // nada da linha do Excel de outro cliente). Falha de leitura: o relatório sai sem equipamento.
        const id = Number(ctx.codigo);
        const cad = await lerCadastro(id, 'vendasolar').catch((e) => { logErro('cadastro indisponível no relatório', e); return null; });
        const { lig } = await lerLigacao(id);
        codigoDoRelatorio = lig.venda ?? ctx.codigo;
        const equip = ctx.card ? await equipamentoDoCardParaRelatorio(ctx.nome, ctx.socio, ctx.card as CardVendido, lig) : null;
        dados = dadosVendaSolar(cad, equip, ctx.cliente);
      } else {
        const card = ctx.card as CardVendido;
        const id = card.id;
        const { reg: fichaCrua } = await lerFichaComVersao(id);
        // CPF, endereço e afins moram no cadastro (bucket privado): por cima da ficha. Bucket fora do ar: a ficha como está.
        const cad = await lerCadastro(id).catch((e) => { logErro('cadastro indisponível no relatório', e); return null; });
        const ficha = sobreporCadastro(fichaCrua, cad);
        dados = dadosEletroposto(card, ficha, cad?.campos.tipo?.valor ?? '');
        const nomeFicha = celulaFicha('cliente', card, ficha, null)?.valor;
        if (typeof nomeFicha === 'string' && nomeFicha) cliente = nomeFicha;
      }

      const documentos: DocBruto[] = [];
      const presentes = new Set<string>();
      for (const item of CATALOGO[ctx.linha]) {
        if (SLOTS_FORA_DO_RELATORIO.has(item.chave)) continue;   // dado pessoal de terceiro: não serve à engenharia
        for (const a of reg.arquivos.filter((x) => x.slot === item.chave)) {
          // Também pelo CONTEÚDO: o tipo que a IA deu ao arquivo (guardado com os rótulos) não pode ser de documento pessoal de
          // terceiro, mesmo que ele esteja em `outros` ou em outro item.
          if (TIPOS_FORA_DA_HOMOLOGACAO.has(rot?.tipos[a.id] ?? '')) continue;
          presentes.add(item.chave);
          const url = urls.get(a.caminho);
          // Só o nome dado pela IA entra (sem nome de pessoa nem número, por regra). O nome manual é texto livre e pode ter
          // nome de pessoa: no relatório, que sai para terceiros, vale o nome do item do catálogo.
          const r = rot?.rotulos[a.id];
          if (url) documentos.push({ slot: item.chave, rotulo: r && r.fonte === 'ia' ? r.rotulo : item.rotulo, mime: a.mime, url });
        }
      }
      // O que foi anexado no após-vender (dossiê da proposta vinculada) entra no lugar do item que está vazio aqui.
      if (ctx.linha === 'vendasolar') {
        // Venda solar pelo card: o dossiê da proposta ligada, já nos itens da `vendasolar`.
        const dv = await dossieDaVendaSolar(ctx, SEG_URL_RELATORIO);
        if (dv) {
          const proprios = new Set(presentes);
          for (const a of dv.arquivos) {
            if (proprios.has(a.slot) || SLOTS_FORA_DO_RELATORIO.has(a.slot)) continue;
            presentes.add(a.slot);
            if (a.url) documentos.push({ slot: a.slot, rotulo: rotulo(a.slot), mime: a.mime, url: a.url });
          }
        }
      }
      const propostaVinculada = ctx.linha === 'solar' ? await vinculoDaLeitura(ctx, reg) : null;
      if (propostaVinculada) {
        const d = await lerDossieVinculado(propostaVinculada, SEG_URL_RELATORIO);
        const proprios = new Set(presentes);
        for (const a of d.arquivos) {
          if (proprios.has(a.slot)) continue;
          presentes.add(a.slot);
          if (a.url) documentos.push({ slot: a.slot, rotulo: rotulo(a.slot), mime: a.mime, url: a.url });
        }
      }
      res.json(montarRelatorio({
        linha: ctx.linha, codigo: codigoDoRelatorio,
        cliente, emitidoEm: agora, dados, documentos,
      }));
    } catch (err) {
      falhou(res, 'relatório falhou', err);
    }
  });
}

/** Sócio liga qualquer proposta; consultor, só as com o nome DELE em `consultor_nome` (vazio = só sócio). */
function propostaDoPapel(ctx: Ctx, consultorDaProposta: string): boolean {
  return ctx.socio || (!!consultorDaProposta.trim() && podeVer(ctx.nome, consultorDaProposta));
}

/** Quem chega às rotas de documentos já passou na posse (dono ou sócio): a regra de remover é a mesma. */
function podeRemover(ctx: Ctx): boolean {
  if (ctx.socio) return true;
  // Venda solar pelo card: a posse já aceitou o vendedor do card, o consultor da venda ligada ou o sócio.
  if (ctx.linha === 'vendasolar') return !!ctx.card;
  return ctx.linha === 'solar' ? !!ctx.solar : podeVer(ctx.nome, String(ctx.card?.vendedor_nome ?? ''));
}

function mensagemSemEspaco(motivo: 'slot_ocupado' | 'muitos_no_item' | 'muitos_na_venda', item: ItemDoc): string {
  if (motivo === 'slot_ocupado') return 'Este item já tem um arquivo. Remova o atual antes de enviar outro.';
  if (motivo === 'muitos_no_item') return `Este item já tem ${limiteDoItem(item)} arquivos.`;
  return `Esta venda já tem ${LIMITES.total} arquivos.`;
}

/** venda (só dígitos) -> proposta vinculada, de todas as vendas da planilha. */
async function lerVinculosDasVendas(): Promise<Map<string, string>> {
  const codigos = (await codigosSolar()).map((c) => c.replace(/\D/g, ''));
  return lerVinculos(codigos);
}
