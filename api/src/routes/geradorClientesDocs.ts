import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { ehSocio, podeVer } from '../services/gerador/solarObras';
import { vendaSolarDoDono, codigosSolar, ErroVendaSolar, type VendaSolarDoDono } from './geradorClientes';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { lerProposta, assinar, normalizarNome, ARQUIVOS_SOLAR } from '../services/gerador/dossieVenda';
import { celulaDe } from '../services/gerador/gestaoClientes';
import { lerCadastro, sobreporCadastro } from '../services/gerador/cadastroVenda';
import { lerPosVenda, montarObra, celulaFicha, type CardVendido } from '../services/gerador/fichaEletroposto';
import {
  lerCardVendido, lerFichaComVersao, lerPosVendaComVersao, ErroFicha,
} from '../services/gerador/fichaEletropostoBanco';
import {
  CATALOGO, LIMITE_BYTES, LIMITES, ehLinha, codigoDeRota, itemDoCatalogo, mimeServeAoItem, normalizarMime, novoCaminho,
  lerCaminho, comArquivo, semArquivo, comVinculo, motivoSemEspaco, nomesParecidos, corpoRelatorioSolar,
  corpoRelatorioEletroposto, obraParaRelatorio, montarRelatorio, assinaturaBate, comArquivoMovido, motivoSemEspacoParaMover,
  type Linha, type RegistroDocs, type DocRel, type CorpoRelatorio,
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
//   PATCH  /clientes/:linha/:codigo/docs/:id                { rotulo?: string, slot?: string } renomeia e/ou move de item
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

interface ArqVinculado { slot: string; mime: string; url: string | null }

/**
 * Os arquivos do dossiê da proposta vinculada, lidos pelo servidor. Devolve só slot, mime e url: `nome` (o nome original)
 * e `path` ficam aqui. URL que não assinou vem null (quem chama decide); falha de leitura vira `indisponivel`.
 */
async function lerDossieVinculado(proposta: string, segundos: number): Promise<{ arquivos: ArqVinculado[]; indisponivel: boolean }> {
  try {
    const p = await lerProposta(proposta);
    if (!p) return { arquivos: [], indisponivel: false };
    const pedidos: Array<{ slot: string; mime: string; path: string }> = [];
    for (const s of ARQUIVOS_SOLAR) {
      for (const a of p.dossie.arquivos[s.key] ?? []) pedidos.push({ slot: s.key, mime: mimeDoDossie(a.tipo, a.path), path: a.path });
    }
    const urls = await Promise.all(pedidos.map(async (x) => {
      try { return await assinar(x.path, segundos); } catch { return null; }
    }));
    return { arquivos: pedidos.map((x, i) => ({ slot: x.slot, mime: x.mime, url: urls[i] })), indisponivel: false };
  } catch (err) {
    logErro('dossiê vinculado falhou', err);
    return { arquivos: [], indisponivel: true };
  }
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
        // A posse já limitou a dono ou sócio: quem chegou aqui pode remover.
        pode_remover: true,
      });
    } catch (err) {
      falhou(res, 'lista falhou', err);
    }
  });

  // ── URL de envio ───────────────────────────────────────────────────────────
  router.post('/clientes/:linha/:codigo/docs/upload-url', ...base, async (req: Request, res: Response) => {
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
    try {
      await garantirBucketDocs();
      const { reg } = await lerDocs(ctx);
      const motivo = motivoSemEspaco(reg, item);
      if (motivo) { res.status(409).json({ ok: false, motivo, error: mensagemSemEspaco(motivo) }); return; }
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
  router.post('/clientes/:linha/:codigo/docs', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res);
    if (!ctx) return;
    const b = corpoDe(req);
    const item = b ? itemDoCatalogo(ctx.linha, b.slot) : null;
    if (!b || !item) { res.status(400).json({ ok: false, error: 'Item não encontrado.' }); return; }
    // O caminho inteiro tem que ser o que o servidor gera E ser desta venda (linha e código).
    const c = lerCaminho(b.caminho);
    if (!c || c.linha !== ctx.linha || c.codigo !== ctx.codigo) { res.status(400).json({ ok: false, error: 'Caminho inválido.' }); return; }
    const caminho = b.caminho as string;
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
        const motivo = motivoSemEspaco(reg, item);
        if (motivo) {
          await removerObjeto(caminho).catch((e) => logErro('limpeza falhou', e));
          res.status(409).json({ ok: false, motivo, error: mensagemSemEspaco(motivo) });
          return;
        }
        const agora = new Date().toISOString();
        const arq = { id: crypto.randomUUID(), slot: item.chave, caminho, mime: sonda.mime, bytes: sonda.bytes, em: agora, por: ctx.nome };
        if (!(await gravarDocs(ctx.linha, ctx.codigo, comArquivo(reg, arq), versao, agora))) continue;   // perdeu a corrida: lê de novo
        let urls = new Map<string, string>();
        try { urls = await assinarVarios([caminho], SEG_URL_DOCS); } catch (e) { logErro('assinar falhou', e); }
        res.json({ ok: true, arquivo: lerNaTela(arq, urls) });
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
          if (itemNovo && itemNovo.chave !== a.slot) {
            if (!mimeServeAoItem(itemNovo, a.mime)) {
              return { status: 400 as const, corpo: { ok: false, motivo: 'formato_nao_aceito', error: itemNovo.aceita === 'imagem' ? 'Este item aceita só foto (jpg, png ou webp).' : 'Este item aceita só pdf.' } };
            }
            const motivo = motivoSemEspacoParaMover(reg, id, itemNovo);
            if (motivo) return { status: 409 as const, corpo: { ok: false, motivo, error: mensagemSemEspaco(motivo) } };
            const agora = new Date().toISOString();
            const novo = comArquivoMovido(reg, id, itemNovo.chave, ctx.nome, agora);
            if (!(await gravarDocs(ctx.linha, ctx.codigo, novo, versao, agora))) continue;   // perdeu a corrida: lê de novo
            atual = { ...a, slot: itemNovo.chave };
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
          return { status: 200 as const, arquivo: atual, rot };
        }
        return { status: 409 as const, corpo: { ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta ficha agora. Tente de novo.' } };
      });
      if (feito.status !== 200) { res.status(feito.status).json(feito.corpo); return; }
      let urls = new Map<string, string>();
      try { urls = await assinarVarios([feito.arquivo.caminho], SEG_URL_DOCS); } catch (e) { logErro('assinar falhou', e); }
      // Só mover: o rótulo que o arquivo já tinha acompanha (leitura que falha não derruba a resposta).
      const rotulos = feito.rot ?? (await rotulosOuNulo(ctx)).rot;
      res.json({ ok: true, arquivo: lerNaTela(feito.arquivo, urls, rotulos) });
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

      let corpo: CorpoRelatorio; let obra = null; let obraConcluida: boolean; let cliente = ctx.cliente;
      if (ctx.linha === 'solar') {
        const s = ctx.solar as VendaSolarDoDono;
        const c = corpoRelatorioSolar(s.cols, s.venda.celulas, s.reg);
        corpo = c;
        obraConcluida = c.liberado;   // o Solar não tem pós-venda por etapa: "sistema liberado" é o marco
      } else {
        const card = ctx.card as CardVendido;
        const id = card.id;
        const [{ reg: fichaCrua }, { valor: pvBruto }] = await Promise.all([lerFichaComVersao(id), lerPosVendaComVersao(id)]);
        // CPF, endereço e afins moram no cadastro (bucket privado): por cima da ficha. Bucket fora do ar: a ficha como está.
        const ficha = sobreporCadastro(fichaCrua, await lerCadastro(id).catch((e) => { logErro('cadastro indisponível no relatório', e); return null; }));
        corpo = corpoRelatorioEletroposto(card, ficha, lerPosVenda(pvBruto));
        const o = montarObra(card, pvBruto, diaDeBrasilia(agora), false);
        obra = obraParaRelatorio(o);
        obraConcluida = o.concluido;
        const nomeFicha = celulaFicha('cliente', card, ficha, null)?.valor;
        if (typeof nomeFicha === 'string' && nomeFicha) cliente = nomeFicha;
      }

      const documentos: DocRel[] = [];
      const presentes = new Set<string>();
      for (const item of CATALOGO[ctx.linha]) {
        for (const a of reg.arquivos.filter((x) => x.slot === item.chave)) {
          presentes.add(item.chave);
          const url = urls.get(a.caminho);
          // Só o nome dado pela IA entra (sem nome de pessoa nem número, por regra). O nome manual é texto livre e pode ter
          // nome de pessoa: no relatório, que sai para terceiros, vale o nome do item do catálogo.
          const r = rot?.rotulos[a.id];
          if (url) documentos.push({ slot: item.chave, rotulo: r && r.fonte === 'ia' ? r.rotulo : item.rotulo, mime: a.mime, url });
        }
      }
      // O que foi anexado no após-vender (dossiê da proposta vinculada) entra no lugar do item que está vazio aqui.
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
        linha: ctx.linha, codigo: ctx.linha === 'solar' ? `#${ctx.codigo.padStart(4, '0')}` : ctx.codigo,
        cliente, emitidoEm: agora, emitidoPor: ctx.nome,
        corpo, obra, obraConcluida, documentos, slotsPresentes: presentes,
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
  return ctx.linha === 'solar' ? !!ctx.solar : podeVer(ctx.nome, String(ctx.card?.vendedor_nome ?? ''));
}

function mensagemSemEspaco(motivo: 'slot_ocupado' | 'muitos_no_item' | 'muitos_na_venda'): string {
  if (motivo === 'slot_ocupado') return 'Este item já tem um arquivo. Remova o atual antes de enviar outro.';
  if (motivo === 'muitos_no_item') return `Este item já tem ${LIMITES.porItem} arquivos.`;
  return `Esta venda já tem ${LIMITES.total} arquivos.`;
}

/** venda (só dígitos) -> proposta vinculada, de todas as vendas da planilha. */
async function lerVinculosDasVendas(): Promise<Map<string, string>> {
  const codigos = (await codigosSolar()).map((c) => c.replace(/\D/g, ''));
  return lerVinculos(codigos);
}
