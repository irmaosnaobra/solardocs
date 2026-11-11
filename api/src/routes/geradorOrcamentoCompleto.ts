import { Router, Request, Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { supabase } from '../utils/supabase';
import { supabaseGerador } from '../utils/supabaseGerador';
import { cspImagensStorage } from '../middleware/cspImagensStorage';
import { propostaPdfLimiter, orcamentoEventoLimiter } from '../middleware/rateLimiter';
import { gerarPdfDeHtml } from '../controllers/pdfController';
import { renovarUrlsPortfolio } from '../controllers/portfolioController';
import { clientIp, registrarEventoGerador } from '../controllers/trackingGeradorController';
import { exigeConsultor } from './geradorDossie';
import { generateFromTemplate, type Client } from '../services/templateService';
import {
  empresaParaTemplate, montarCamposOrcamento, orcamentoOficialDisponivel, fotosDeObraDoOrcamento, tipoDoDocumento, type AssinarCliente,
} from '../services/geradorPropostaCompleta';
import { pEsc } from '../services/propostaSolarBase';
import { ehRobo } from '../services/propostaLink';
import { comBotaoPdf, ehPrefetch } from './publicProposta';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// ORÇAMENTO OFICIAL DO /GERADOR: o MESMO papel do modelo 4 "Completa + Banco" da SolarDoc, com a empresa e as fotos de
// obra da conta do dono na SolarDoc. Rotas PÚBLICAS (o cliente não tem login), montadas dentro de /gerador:
//   GET /gerador/completa/:codigo         HTML da página do cliente (leva o pixel de abertura); vencida: página 410
//   GET /gerador/completa/:codigo/pdf     o PDF A4 do mesmo documento (cache no Storage + 302), SEM folha de aceite. Pedido de
//                                         CLIENTE (não robô, HEAD, prefetch nem consultor logado) registra "click_pdf" e avisa o consultor
//   POST /gerador/completa/:codigo/pdf-assinado  SÓ CONSULTOR LOGADO (exigeConsultor, Bearer). O PDF COM folha de aceite (nome e CPF/CNPJ do cliente no corpo): vai para o
//                                         Storage (pasta gerador-assinado, nome aleatório, apagado no POST seguinte ou após 1 dia) e responde { url } assinada de 10 min. O documento NUNCA é gravado na proposta
//   GET /gerador/completa/:codigo/o.gif   pixel 1x1: registra "abertura" (ou "abertura_expirada") do cliente
//   GET /gerador/completa/:codigo/w       redirect rastreado para o WhatsApp do consultor: "click_wpp_cta" (ou "click_wpp_expirado")
// O dashboard repassa /orcamento/:codigo, /orcamento/:codigo/pdf, /o.gif e /w (solardoc.app) para cá (vercel.json).
//
// A proposta vem do banco do Gerador pela MESMA RPC que o link ?p= usa (get_proposta_pub): link vencido não entrega
// número nenhum. O HTML é montado a cada abertura, então reeditar a proposta no /gerador reflete na hora.
// As fotos de obra ficam no Storage privado da SolarDoc e são assinadas aqui (nada de foto de cliente no repositório, que é público).
// Entram as 10 primeiras da galeria e 2 fixas do site da Irmãos na Obra (services/templates/fotosObraIo.ts).
//
// Rastreio: TUDO passa por registrarEventoGerador (a mesma função do POST /gerador/track): mesma gravação, mesmo aviso ao
// consultor, mesma trava de 2 h. O evento é decidido AQUI pelo estado da proposta (válida ou vencida), nunca pela URL.
// ─────────────────────────────────────────────────────────────────────────────

const RE_CODIGO = /^\d{8,12}$/;
const MSG_PDF = 'Não deu para gerar o PDF agora. Tente de novo em instantes.';
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Dono da conta da SolarDoc cuja empresa, logo, cores e fotos de obra vão no papel (Aioros Group / Irmãos na Obra).
export const EMPRESA_SOLARDOC_USER_ID_PADRAO = '95965109-7bcc-4f6a-9bb7-f7a10ad1d385';

export function userIdDaEmpresa(env: NodeJS.ProcessEnv = process.env): string {
  const v = (env.GERADOR_EMPRESA_SOLARDOC_USER_ID || '').trim();
  return RE_UUID.test(v) ? v : EMPRESA_SOLARDOC_USER_ID_PADRAO;
}

const SITE = (process.env.GERADOR_BASE_URL || 'https://solardoc.app/gerador').replace(/\/+$/, '').replace(/\/gerador$/, '');

/** Sobe 1 quando o desenho do papel mudar (template, mapeador): invalida todos os PDFs guardados de uma vez. */
export const PDF_LAYOUT_VERSAO = 3;
const BUCKET_PDF = 'documentos';
const PREFIXO_PDF = 'propostas-pdf/gerador';
// PDF ASSINADO (leva o CPF do cliente): pasta PLANA, só <codigo>-<uuid>.pdf. Cada POST apaga os do mesmo código e tudo com mais de 1 dia.
const PASTA_ASSINADO = 'propostas-pdf/gerador-assinado';
const ASSINADO_VALE_MS = 24 * 60 * 60 * 1000;
// Mesmo tempo da URL assinada do PDF público da SolarDoc (GET /p/:id/pdf).
const URL_PDF_SEGUNDOS = 600;

/** Cookie que o /gerador grava no solardoc.app quando há consultor logado: pixel e redirect não contam quem vende. */
export const COOKIE_CONSULTOR = 'gerador_consultor';

export function ehConsultorLogado(cookieHeader: unknown): boolean {
  return new RegExp(`(?:^|;\\s*)${COOKIE_CONSULTOR}=1(?:;|$)`).test(String(cookieHeader ?? ''));
}

const GIF_1X1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const MSG_INDISPONIVEL = 'Não deu para abrir o orçamento agora. Tente de novo em instantes.';

type Erro = { ok: false; status: 404 | 410 | 500 | 503; mensagem: string; vencida?: { codigo: string; dados: Record<string, unknown> } };
export type ResultadoOrcamento = { ok: true; html: string; codigo: string; cliente: string } | Erro;

/** O que as rotas leem antes de qualquer coisa pesada: a proposta e a empresa. */
export type BaseOrcamento = {
  ok: true; codigo: string; criadaEm: string | null; dados: Record<string, unknown>; userId: string; company: Record<string, unknown>;
};

export type EstadoProposta =
  | { estado: 'erro' }
  | { estado: 'ausente' }
  | { estado: 'outro' }
  | { estado: 'vencida'; codigo: string; dados: Record<string, unknown> }
  | { estado: 'valida'; codigo: string; criadaEm: string | null; dados: Record<string, unknown> };

/** A parte sem rede: proposta do Gerador + empresa + fotos já assinadas -> HTML do modelo 4. Também serve à prévia local. */
export function htmlDoOrcamento(a: {
  dados: Record<string, unknown>; codigo: string; criadaEm?: string | null; company: Record<string, unknown>; fotosObras: unknown;
  assinar?: AssinarCliente | null;
}): { html: string; cliente: string } {
  const empresa = empresaParaTemplate(a.company);
  const { fields, client } = montarCamposOrcamento(a.dados, { codigo: a.codigo, criadaEm: a.criadaEm, empresa, assinar: a.assinar });
  fields.fotos_obras = fotosDeObraDoOrcamento(a.fotosObras);
  const html = generateFromTemplate('propostaSolar', empresa as never, client as unknown as Client, fields, 4);
  return { html, cliente: client.nome };
}

/**
 * O estado da proposta pela RPC pública (a mesma do link ?p=). "outro" = existe mas não é orçamento solar que este papel
 * monte (eletroposto, ou solar antigo sem item/tab/preço: orcamentoOficialDisponivel). Nunca lança.
 */
export async function lerPropostaPub(codigo: string): Promise<EstadoProposta> {
  try {
    const { data, error } = await supabaseGerador.rpc('get_proposta_pub', { p_codigo: codigo });
    if (error) {
      logger.error('gerador-orcamento', 'RPC get_proposta_pub falhou', error);
      return { estado: 'erro' };
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row || !row.dados || typeof row.dados !== 'object') return { estado: 'ausente' };
    const dados = row.dados as Record<string, unknown>;
    const cod = String(row.codigo || codigo);
    // Vencida: a RPC só devolve nome, consultor, produto e o contato; nenhum número comercial.
    // Só proposta solar (sem `produto`, ou 'solar') tem página de vencida: eletroposto e equipamento ficam no ?p=.
    if (row.expirou === true) {
      const solar = dados.produto === undefined || dados.produto === null || dados.produto === 'solar';
      return solar ? { estado: 'vencida', codigo: cod, dados } : { estado: 'outro' };
    }
    if (!orcamentoOficialDisponivel(dados)) return { estado: 'outro' };
    return { estado: 'valida', codigo: cod, criadaEm: row.created_at ?? null, dados };
  } catch (err) {
    logger.error('gerador-orcamento', 'falha lendo a proposta', err);
    return { estado: 'erro' };
  }
}

/** A empresa da SolarDoc (nome, logo, cores, WhatsApp). null se não achar. Nunca lança. */
async function lerEmpresa(userId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.from('company').select('*').eq('user_id', userId).maybeSingle();
    if (error || !data) {
      logger.error('gerador-orcamento', 'empresa da SolarDoc não encontrada', error);
      return null;
    }
    return data as Record<string, unknown>;
  } catch (err) {
    logger.error('gerador-orcamento', 'falha lendo a empresa', err);
    return null;
  }
}

/** Lê a proposta e a empresa. Nunca lança. Vencida: erro 410 com os dados mínimos para a página de vencida. */
export async function lerBaseOrcamento(codigo: string): Promise<BaseOrcamento | Erro> {
  const p = await lerPropostaPub(codigo);
  if (p.estado === 'erro') return { ok: false, status: 503, mensagem: MSG_INDISPONIVEL };
  if (p.estado === 'ausente') {
    return { ok: false, status: 404, mensagem: 'Orçamento não encontrado. O link expirou ou foi removido. Peça ao consultor para enviar de novo.' };
  }
  if (p.estado === 'outro') return { ok: false, status: 404, mensagem: 'Orçamento não encontrado.' };
  if (p.estado === 'vencida') {
    return { ok: false, status: 410, mensagem: 'Este orçamento venceu. Chame o consultor no WhatsApp para receber um novo.', vencida: { codigo: p.codigo, dados: p.dados } };
  }
  const userId = userIdDaEmpresa();
  const company = await lerEmpresa(userId);
  if (!company) return { ok: false, status: 503, mensagem: MSG_INDISPONIVEL };
  return { ok: true, codigo: p.codigo, criadaEm: p.criadaEm, dados: p.dados, userId, company };
}

/** Monta o HTML a partir da base: assina as fotos de obra da empresa (a URL guardada nunca vale) e roda o template. Nunca lança. */
export async function montarHtmlDaBase(base: BaseOrcamento, assinar?: AssinarCliente | null): Promise<ResultadoOrcamento> {
  try {
    const galeria = await renovarUrlsPortfolio(base.userId, { fotos_obras: base.company.fotos_obras });
    const { html, cliente } = htmlDoOrcamento({
      dados: base.dados, codigo: base.codigo, criadaEm: base.criadaEm, company: base.company, fotosObras: galeria.fotos_obras, assinar,
    });
    return { ok: true, html, codigo: base.codigo, cliente };
  } catch (err) {
    logger.error('gerador-orcamento', 'falha montando o orçamento', err);
    return { ok: false, status: 500, mensagem: 'Erro ao montar o orçamento.' };
  }
}

/** Lê tudo e monta o HTML do orçamento. */
export async function montarOrcamentoCompleto(codigo: string): Promise<ResultadoOrcamento> {
  const base = await lerBaseOrcamento(codigo);
  return base.ok ? montarHtmlDaBase(base) : base;
}

/**
 * Impressão digital do que muda o papel: os dados da proposta, a empresa (logo, cores, textos) e a lista de fotos de obra
 * (os caminhos, não as URLs assinadas, que mudam a cada pedido), mais a versão do desenho. Editou a proposta, trocou a
 * logo ou subiu o PDF_LAYOUT_VERSAO: o hash muda e o PDF é refeito.
 */
export function hashDoOrcamento(base: Pick<BaseOrcamento, 'dados' | 'company'>, versao = PDF_LAYOUT_VERSAO): string {
  const empresa = empresaParaTemplate(base.company);
  const fotos = Array.isArray(base.company.fotos_obras) ? base.company.fotos_obras : [];
  return createHash('sha256').update(JSON.stringify({ v: versao, d: base.dados, e: empresa, f: fotos })).digest('hex').slice(0, 24);
}

export function caminhoDoPdf(codigo: string, hash: string, versao = PDF_LAYOUT_VERSAO): { prefixo: string; arquivo: string; caminho: string } {
  const prefixo = `${PREFIXO_PDF}/${codigo}`;
  const arquivo = `orcamento-v${versao}-${hash}.pdf`;
  return { prefixo, arquivo, caminho: `${prefixo}/${arquivo}` };
}

/**
 * Destino do botão de WhatsApp: SEMPRE montado aqui, a partir do telefone do consultor (ou da empresa) e de textos da
 * proposta. Nada que venha da query entra na URL (não é open redirect). Telefone com menos de 10 dígitos: null.
 */
export function destinoWhatsapp(a: { telefone: unknown; consultor: unknown; cliente: unknown; vencida: boolean }): string | null {
  const d = String(a.telefone ?? '').replace(/\D/g, '');
  if (d.length < 10 || d.length > 13) return null;
  const numero = d.startsWith('55') && d.length >= 12 ? d : `55${d}`;
  const consultor = String(a.consultor ?? '').trim().slice(0, 60);
  const cliente = String(a.cliente ?? '').trim().slice(0, 80);
  const texto = a.vencida
    ? `Oi${consultor ? ` ${consultor}` : ''}!${cliente ? ` Sou ${cliente}.` : ''} Minha proposta de energia solar venceu. Pode me enviar uma atualizada?`
    : `Olá ${consultor}! Quero fechar a proposta de ${cliente}.`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

function paginaAviso(titulo: string, texto: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex"/>
<title>${pEsc(titulo)}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#F4F6FA;color:#161A22;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;margin:0}h1{font-size:22px;margin:0 0 8px}p{color:#5C6470;font-size:15px;margin:0;max-width:420px;line-height:1.5}</style>
</head><body><h1>${pEsc(titulo)}</h1><p>${pEsc(texto)}</p></body></html>`;
}

/**
 * Página de proposta vencida (status 410): o que o link ?p= vencido mostra, sem nenhum número da proposta. Leva o nome da
 * empresa, um botão de WhatsApp (passa pelo redirect rastreado) e o pixel que registra "abertura_expirada".
 */
export function paginaVencida(a: { empresa: string; cliente: string; codigo: string; comWhats: boolean }): string {
  const cod = encodeURIComponent(a.codigo);
  const botao = a.comWhats
    ? `<a class="b" href="/orcamento/${cod}/w" rel="nofollow noopener">Falar agora no WhatsApp</a>`
    : '';
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex, nofollow"/>
<title>Orçamento vencido${a.empresa ? ` · ${pEsc(a.empresa)}` : ''}</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#F4F6FA;color:#161A22;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;margin:0}.k{font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#5C6470;margin-bottom:10px}h1{font-size:24px;margin:0 0 10px}p{color:#5C6470;font-size:15px;margin:0 0 22px;max-width:440px;line-height:1.5}.b{display:inline-block;background:#127A3E;color:#fff;padding:14px 28px;border-radius:999px;font-weight:800;font-size:15px;text-decoration:none}</style>
</head><body>
${a.empresa ? `<div class="k">${pEsc(a.empresa)}</div>` : ''}
<h1>${a.cliente ? `${pEsc(a.cliente)}, sua` : 'Sua'} proposta de energia solar venceu</h1>
<p>Os preços de equipamentos e a tarifa de energia mudam todo mês. Para te dar o valor certo, precisamos refazer a proposta.</p>
${botao}
<img src="/orcamento/${cod}/o.gif" width="1" height="1" alt="" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;border:0"/>
</body></html>`;
}

/** Prévia do link (WhatsApp, Telegram): título e descrição do orçamento solar, sem rastrear nada. */
function comPrevia(html: string, cliente: string): string {
  const titulo = 'Proposta de Energia Solar · Irmãos na Obra';
  const descricao = `Orçamento do seu sistema de energia solar${cliente ? ` para ${cliente}` : ''}. Economia, retorno e composição do sistema.`;
  const tags = `<meta name="robots" content="noindex, nofollow"/>`
    + `<meta property="og:type" content="website"/><meta property="og:site_name" content="Irmãos na Obra"/>`
    + `<meta property="og:title" content="${pEsc(titulo)}"/><meta property="og:description" content="${pEsc(descricao)}"/>`
    + `<meta property="og:image" content="${pEsc(`${SITE}/gerador/logo.png`)}"/><meta name="description" content="${pEsc(descricao)}"/>`;
  return html.replace('<meta charset="UTF-8"/>', `<meta charset="UTF-8"/>${tags}`);
}

/**
 * Pixel de abertura, só na página do cliente (nunca no PDF nem no /p da SolarDoc). Relativo: o cliente abre em
 * solardoc.app/orcamento/<codigo> e o rewrite leva /o.gif para a api. Fora da área impressa.
 */
export function comPixelDeAbertura(html: string, codigo: string): string {
  const img = `<img src="/orcamento/${encodeURIComponent(codigo)}/o.gif" width="1" height="1" alt="" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;border:0"/>`;
  const i = html.lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + img + html.slice(i) : html + img;
}

/**
 * O botão "Quero fechar pelo WhatsApp" do papel passa a apontar para o redirect rastreado (/orcamento/<codigo>/w), só na
 * página do cliente. No PDF PÚBLICO (GET /pdf) o link é ABSOLUTO (`base` = https://solardoc.app), porque o PDF vive fora do site e
 * o clique tem que chegar ao redirect rastreado. O PDF ASSINADO (POST pdf-assinado, o do consultor para o banco) segue com o wa.me direto.
 */
export function comRedirectDoWhatsapp(html: string, codigo: string, base = ''): string {
  return html.replace(/(<div class="cta">[\s\S]*?<a href=")https:\/\/wa\.me\/[^"]*(")/, `$1${base}/orcamento/${encodeURIComponent(codigo)}/w$2`);
}

/** "Orcamento 202600951 - Fabiano.pdf": só ASCII, sem caractere que quebre o cabeçalho. */
export function nomeDoPdfOrcamento(codigo: string, cliente: string): string {
  const limpo = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._ -]+/g, ' ').replace(/\s+/g, ' ').trim();
  const nome = limpo(cliente);
  return `${['Orcamento', limpo(codigo)].filter(Boolean).join(' ')}${nome ? ` - ${nome}` : ''}.pdf`.slice(0, 120);
}

/** Quem conta como "cliente de verdade": nem robô de prévia, nem HEAD/prefetch, nem consultor logado, nem IP acima do limite. */
function contaComoCliente(req: Request, res: Response): boolean {
  return req.method !== 'HEAD' && !ehPrefetch(req) && !ehRobo(req.headers['user-agent'])
    && !ehConsultorLogado(req.headers.cookie) && res.locals.limitado !== true;
}

async function registrar(req: Request, codigo: string, evento: string): Promise<void> {
  try {
    // `avisarPdf`: o download do PDF de cliente avisa o consultor (só a rota GET /pdf chama com click_pdf).
    await registrarEventoGerador({ codigo, evento, ip: clientIp(req), userAgent: String(req.headers['user-agent'] || ''), ...(evento === 'click_pdf' ? { avisarPdf: true } : {}) });
  } catch (err) {
    logger.error('gerador-orcamento', `registro de ${evento} falhou`, err);
  }
}

export function mountOrcamentoCompleto(router: Router): void {
  router.get('/completa/:codigo', cspImagensStorage(), async (req: Request, res: Response): Promise<void> => {
    const codigo = String(req.params.codigo || '').trim();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!RE_CODIGO.test(codigo)) {
      res.status(400).type('text/html').send(paginaAviso('Código inválido', 'Confira o link que o consultor enviou.'));
      return;
    }
    const base = await lerBaseOrcamento(codigo);
    if (!base.ok && base.vencida) {
      // Vencida: o nome da empresa e o botão de WhatsApp (consultor da proposta; sem ele, o da empresa). Nenhum número da proposta.
      const company = await lerEmpresa(userIdDaEmpresa());
      const empresa = String(company?.nome_fantasia || company?.nome || '').trim();
      const dados = base.vencida.dados;
      const comWhats = !!destinoWhatsapp({ telefone: dados.consultorWhats || company?.whatsapp, consultor: '', cliente: '', vencida: true });
      res.status(410).type('text/html; charset=utf-8')
        .send(paginaVencida({ empresa, cliente: String(dados.nome ?? '').trim().split(/\s+/)[0] || '', codigo: base.vencida.codigo, comWhats }));
      return;
    }
    if (!base.ok) {
      res.status(base.status).type('text/html').send(paginaAviso('Orçamento indisponível', base.mensagem));
      return;
    }
    const r = await montarHtmlDaBase(base);
    if (!r.ok) {
      res.status(r.status).type('text/html').send(paginaAviso('Orçamento indisponível', r.mensagem));
      return;
    }
    const pagina = comPixelDeAbertura(
      comRedirectDoWhatsapp(comBotaoPdf(comPrevia(r.html, r.cliente), r.codigo, `/orcamento/${encodeURIComponent(r.codigo)}/pdf`), r.codigo),
      r.codigo,
    );
    res.status(200).type('text/html; charset=utf-8').send(pagina);
  });

  // Pixel de abertura. O registro é AGUARDADO por inteiro, como no /track: em serverless a função congela quando a
  // resposta sai, e um envio deixado para depois morreria (a busca da cidade pelo IP leva até 2,5 s). A página do cliente
  // não espera por isto: o gif carrega à parte. Sempre devolve o gif. Só registra para proposta que existe e é solar:
  // válida = "abertura"; vencida = "abertura_expirada"; inexistente, eletroposto ou sem o que o papel precisa = nada.
  router.get('/completa/:codigo/o.gif', orcamentoEventoLimiter, async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Type', 'image/gif');
    const codigo = String(req.params.codigo || '').trim();
    if (RE_CODIGO.test(codigo) && contaComoCliente(req, res)) {
      const p = await lerPropostaPub(codigo);
      if (p.estado === 'valida') await registrar(req, codigo, 'abertura');
      else if (p.estado === 'vencida') await registrar(req, codigo, 'abertura_expirada');
    }
    res.status(200).setHeader('Content-Length', String(GIF_1X1.length));
    res.end(GIF_1X1);
  });

  // Redirect rastreado do botão de WhatsApp. O destino é montado aqui (destinoWhatsapp): nunca vem da query.
  router.get('/completa/:codigo/w', orcamentoEventoLimiter, async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const codigo = String(req.params.codigo || '').trim();
    if (!RE_CODIGO.test(codigo)) {
      res.status(400).type('text/plain').send('Código inválido.');
      return;
    }
    const p = await lerPropostaPub(codigo);
    if (p.estado === 'erro') { res.status(503).type('text/plain').send(MSG_INDISPONIVEL); return; }
    if (p.estado !== 'valida' && p.estado !== 'vencida') { res.status(404).type('text/plain').send('Orçamento não encontrado.'); return; }
    const vencida = p.estado === 'vencida';
    // O número de QUEM ATENDE (proposta); sem ele, o da empresa.
    let telefone: unknown = p.dados.consultorWhats;
    if (String(telefone ?? '').replace(/\D/g, '').length < 10) telefone = (await lerEmpresa(userIdDaEmpresa()))?.whatsapp;
    const destino = destinoWhatsapp({ telefone, consultor: p.dados.consultor, cliente: p.dados.nome, vencida });
    if (!destino) { res.status(404).type('text/plain').send('Orçamento não encontrado.'); return; }
    if (contaComoCliente(req, res)) await registrar(req, codigo, vencida ? 'click_wpp_expirado' : 'click_wpp_cta');
    res.redirect(302, destino);
  });

  // PDF: o Chromium só abre quando a proposta (ou a empresa, ou o desenho) mudou. O PDF fica no Storage por hash e a
  // resposta é um 302 para a URL assinada curta (resposta de função na Vercel passa de 4,5 MB com 12 fotos: é o mesmo
  // desenho do GET /p/:id/pdf). Se não der para guardar, devolve o PDF direto.
  router.get('/completa/:codigo/pdf', propostaPdfLimiter, orcamentoEventoLimiter, async (req: Request, res: Response): Promise<void> => {
    const codigo = String(req.params.codigo || '').trim();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!RE_CODIGO.test(codigo)) {
      res.status(400).type('text/plain').send('Código inválido.');
      return;
    }
    try {
      const base = await lerBaseOrcamento(codigo);
      if (!base.ok) {
        res.status(base.status).type('text/plain').send(base.mensagem);
        return;
      }
      // HEAD (prévia de link, verificação): responde sem abrir o Chromium e sem gravar nada.
      if (req.method === 'HEAD') {
        res.status(200).setHeader('Content-Type', 'application/pdf');
        res.end();
        return;
      }
      const cliente = String(base.dados.nome ?? '').trim();
      const nome = nomeDoPdfOrcamento(base.codigo, cliente);
      const { prefixo, arquivo, caminho } = caminhoDoPdf(base.codigo, hashDoOrcamento(base));
      const assinar = async (): Promise<string | undefined> => {
        try {
          const { data } = await supabase.storage.from(BUCKET_PDF).createSignedUrl(caminho, URL_PDF_SEGUNDOS, { download: nome });
          return data?.signedUrl || undefined;
        } catch {
          return undefined;
        }
      };

      // Cache: tenta direto a URL assinada do caminho esperado (sem listar o bucket). PDF desta versão ainda não existe: a assinatura falha.
      // Download de CLIENTE: registra "click_pdf" e avisa o consultor, uma vez por pedido servido (cache-hit, gerado agora ou
      // inline). Aguardado: serverless congela a função depois da resposta.
      const avisar = async (): Promise<void> => {
        if (contaComoCliente(req, res)) await registrar(req, base.codigo, 'click_pdf');
      };

      let url = await assinar();
      if (url) {
        await avisar();
        res.redirect(302, url);
        return;
      }

      const r = await montarHtmlDaBase(base);
      if (!r.ok) {
        res.status(r.status).type('text/plain').send(r.mensagem);
        return;
      }
      // O botão de WhatsApp dentro do PDF público passa pelo redirect rastreado (link absoluto: o PDF vive fora do site).
      const pdf = await gerarPdfDeHtml(comRedirectDoWhatsapp(r.html, base.codigo, SITE));

      let guardou = false;
      try {
        const { error } = await supabase.storage.from(BUCKET_PDF).upload(caminho, pdf, { contentType: 'application/pdf', upsert: true });
        guardou = !error;
        if (error) logger.error('gerador-orcamento', 'upload do PDF falhou; devolvendo o PDF direto', error);
      } catch (err) {
        logger.error('gerador-orcamento', 'upload do PDF falhou; devolvendo o PDF direto', err);
      }
      if (guardou) {
        // Versões antigas (proposta reeditada, layout novo) saem do bucket. Aguardado (serverless congela depois da
        // resposta) e sem derrubar a resposta se falhar. NUNCA entra o arquivo da chave que acabou de ser gravada.
        try {
          const { data: achados } = await supabase.storage.from(BUCKET_PDF).list(prefixo, { limit: 1000, search: 'orcamento-' });
          const velhos = (achados ?? [])
            .filter((a: { name?: string }) => a?.name && a.name.startsWith('orcamento-') && a.name.endsWith('.pdf') && a.name !== arquivo)
            .map((a: { name: string }) => `${prefixo}/${a.name}`)
            .filter((p: string) => p !== caminho);
          if (velhos.length) await supabase.storage.from(BUCKET_PDF).remove(velhos);
        } catch (err) {
          logger.error('gerador-orcamento', 'limpeza dos PDFs antigos falhou (a resposta segue)', err);
        }
        url = await assinar();
        if (url) {
          await avisar();
          res.redirect(302, url);
          return;
        }
      }

      // Fallback: não guardou (ou não assinou): o PDF sai direto, como na primeira versão.
      await avisar();
      res.status(200).setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${nome}"`);
      res.setHeader('Content-Length', String(pdf.length));
      res.end(pdf);
    } catch (err) {
      logger.error('gerador-orcamento', 'falha gerando o PDF do orçamento', err);
      if (!res.headersSent) res.status(500).type('text/plain').send('Não deu para gerar o PDF agora. Tente de novo em instantes.');
    }
  });

  // PDF COM folha de aceite. O nome e o CPF/CNPJ do cliente chegam SÓ aqui, no corpo, e nunca são gravados na proposta (a RLS
  // do banco do Gerador é desligada e o código é sequencial) nem escritos em log. O PDF vai para o Storage com nome aleatório
  // (gerador-assinado/<codigo>-<uuid>.pdf, pasta plana; os do mesmo código e os de mais de 1 dia saem antes) e a resposta é só a URL assinada de 10 min: um
  // PDF de 12 fotos passa do teto de 4,5 MB da resposta da Vercel, então não há fallback inline.
  router.post('/completa/:codigo/pdf-assinado', exigeConsultor, propostaPdfLimiter, async (req: Request, res: Response): Promise<void> => {
    const codigo = String(req.params.codigo || '').trim();
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!RE_CODIGO.test(codigo)) {
      res.status(400).json({ erro: 'Código inválido.' });
      return;
    }
    const corpo = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    const nome = typeof corpo.nome === 'string' ? corpo.nome.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const documento = typeof corpo.documento === 'string' ? corpo.documento.trim().slice(0, 30) : '';
    if (nome.length < 2 || nome.length > 120) {
      res.status(400).json({ erro: 'Escreva o nome completo do cliente (2 a 120 letras).' });
      return;
    }
    if (!tipoDoDocumento(documento)) {
      res.status(400).json({ erro: 'CPF ou CNPJ inválido. Confira os números.' });
      return;
    }
    try {
      const base = await lerBaseOrcamento(codigo);
      if (!base.ok) {
        res.status(base.status).json({ erro: base.mensagem });
        return;
      }
      const r = await montarHtmlDaBase(base, { nome, documento });
      if (!r.ok) {
        res.status(r.status).json({ erro: r.mensagem });
        return;
      }
      const pdf = await gerarPdfDeHtml(r.html);

      // O PDF assinado tem o CPF do cliente e NÃO pode ficar guardado: a cada POST saem (aguardado: serverless congela depois da
      // resposta) os do mesmo código e qualquer arquivo da pasta com mais de 1 dia. Falha aqui não barra a resposta.
      try {
        const bucket = supabase.storage.from(BUCKET_PDF);
        const [porIdade, porCodigo] = await Promise.all([
          bucket.list(PASTA_ASSINADO, { limit: 100, sortBy: { column: 'created_at', order: 'asc' } }),
          bucket.list(PASTA_ASSINADO, { limit: 100, search: `${base.codigo}-` }),
        ]);
        const agora = Date.now();
        const velhos = new Set<string>();
        for (const a of [...(porIdade.data ?? []), ...(porCodigo.data ?? [])] as Array<{ name?: string; created_at?: string }>) {
          if (!a?.name || !a.name.endsWith('.pdf')) continue;
          const mesmoCodigo = a.name.startsWith(`${base.codigo}-`);
          const criado = a.created_at ? Date.parse(a.created_at) : NaN;
          if (mesmoCodigo || (Number.isFinite(criado) && agora - criado > ASSINADO_VALE_MS)) velhos.add(`${PASTA_ASSINADO}/${a.name}`);
        }
        if (velhos.size) await bucket.remove([...velhos]);
      } catch {
        logger.error('gerador-orcamento', 'limpeza dos PDFs assinados antigos falhou (a resposta segue)');
      }

      const caminho = `${PASTA_ASSINADO}/${base.codigo}-${randomUUID()}.pdf`;
      let url: string | undefined;
      try {
        const { error } = await supabase.storage.from(BUCKET_PDF).upload(caminho, pdf, { contentType: 'application/pdf', upsert: false });
        if (!error) {
          const { data } = await supabase.storage.from(BUCKET_PDF).createSignedUrl(caminho, URL_PDF_SEGUNDOS, { download: nomeDoPdfOrcamento(base.codigo, nome) });
          url = data?.signedUrl || undefined;
        } else {
          logger.error('gerador-orcamento', 'upload do PDF assinado falhou');
        }
      } catch {
        logger.error('gerador-orcamento', 'upload do PDF assinado falhou');
      }
      if (!url) {
        res.status(502).json({ erro: 'Não deu para guardar o PDF assinado agora. Tente de novo em instantes.' });
        return;
      }
      res.status(200).json({ url });
    } catch {
      // Sem o erro cru no log: ele pode carregar pedaço do corpo. Só a mensagem fixa.
      logger.error('gerador-orcamento', 'falha gerando o PDF assinado do orçamento');
      if (!res.headersSent) res.status(500).json({ erro: MSG_PDF });
    }
  });
}
