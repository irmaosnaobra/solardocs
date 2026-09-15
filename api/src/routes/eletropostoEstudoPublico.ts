// ─────────────────────────────────────────────────────────────────────────────
// ESTUDO DO LOCAL, a página que o consultor abre antes da reunião.
//
//   GET /io/eletroposto/estudo/:token              a página (HTML, sem script)
//   GET /io/eletroposto/estudo/:token/satelite.jpg  foto de satélite, por proxy
//   GET /io/eletroposto/estudo/:token/rua.jpg       foto da rua, por proxy
//
// Link canônico: https://solardoc.app/_api/io/eletroposto/estudo/<token> (o rewrite
// /_api do dashboard já existe). O token tem 64 hex e é a única chave: quem tem o
// link vê o estudo. Token torto e token que não existe dão a MESMA 404.
//
// ── Por que as fotos passam por aqui ──
// A URL do Google leva a chave. Aqui a chave fica no servidor, a imagem sai com
// cache privado de um dia e só enquanto a reunião não passou de 7 dias.
//
// Kill-switch das fotos: EP_ESTUDO_IMG_OFF=1 (a página fica só com os links).
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { estudoImgLimiter, estudoPaginaLimiter } from '../middleware/rateLimiter';
import { bancoConfigurado, lerPorToken, type LinhaEstudoBanco } from '../services/io/eletropostoEstudoBanco';
import { imagemRua, imagemSatelite } from '../services/io/eletropostoEstudoFontes';
import { estudoDesligado } from '../services/io/eletropostoEstudoGarantir';
import { TOKEN_RE } from '../services/io/eletropostoEstudoPuro';
import {
  imagensPermitidas, pagina404, paginaPreparando, renderEstudo, type LinhaEstudo,
} from '../services/io/eletropostoEstudoPagina';

const router = Router();

// Sobrescreve a CSP global do helmet: a página não tem script, só estilo inline e
// imagens do próprio domínio.
export const CSP_ESTUDO = "default-src 'none'; img-src 'self' https://solardoc.app data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const imagensDesligadas = () => (process.env.EP_ESTUDO_IMG_OFF || '').trim() === '1';

function cabecalhosDaPagina(res: Response, cache: string): void {
  res.setHeader('Content-Security-Policy', CSP_ESTUDO);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
}

function naoEncontrado(res: Response): void {
  cabecalhosDaPagina(res, 'no-store');
  res.status(404).send(pagina404());
}

async function carregar(token: string) {
  if (!TOKEN_RE.test(token) || estudoDesligado() || !bancoConfigurado()) return null;
  return lerPorToken(token);
}

/** Só o que a página usa. A linha do banco não sai inteira daqui. */
function paraPagina(e: LinhaEstudoBanco): LinhaEstudo {
  return {
    token: e.token,
    status: e.status,
    dados: e.dados || {},
    fontes: e.fontes || {},
    custo_usd: Number(e.custo_usd) || 0,
    created_at: e.created_at,
    pronto_em: e.pronto_em,
    coords_apagadas_em: e.coords_apagadas_em,
  };
}

router.get('/:token', estudoPaginaLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const achado = await carregar(String(req.params.token));
    if (!achado) { naoEncontrado(res); return; }

    const linha = paraPagina(achado.estudo);
    if (linha.status === 'pendente' || linha.status === 'processando') {
      cabecalhosDaPagina(res, 'no-store');
      res.status(200).send(paginaPreparando(achado.reuniao));
      return;
    }
    cabecalhosDaPagina(res, 'private, max-age=60');
    res.status(200).send(renderEstudo(linha, achado.reuniao, { agoraMs: Date.now(), imagensLigadas: !imagensDesligadas() }));
  } catch (e) {
    logger.error('ep-estudo', 'página do estudo falhou', String((e as Error)?.message || e).slice(0, 200));
    cabecalhosDaPagina(res, 'no-store');
    res.status(503).send(paginaPreparando(null));
  }
});

async function imagem(req: Request, res: Response, tipo: 'satelite' | 'rua'): Promise<void> {
  // Qualquer falha é 404 sem corpo: nunca repassa erro do Google.
  const falha = () => { res.setHeader('Cache-Control', 'no-store'); res.status(404).end(); };
  try {
    if (imagensDesligadas()) { falha(); return; }
    const achado = await carregar(String(req.params.token));
    if (!achado) { falha(); return; }

    const linha = paraPagina(achado.estudo);
    const pode = imagensPermitidas(linha, achado.reuniao, Date.now(), true);
    const { local, rua } = linha.dados;

    let r: Awaited<ReturnType<typeof imagemRua>> | null = null;
    if (tipo === 'satelite' && pode.satelite && local?.lat != null && local?.lng != null) {
      r = await imagemSatelite({ lat: local.lat, lng: local.lng });
    } else if (tipo === 'rua' && pode.rua && rua?.pano_id) {
      r = await imagemRua(rua.pano_id, rua.heading);
    }
    if (!r || !r.ok || !r.dado) { falha(); return; }

    res.setHeader('Content-Type', r.dado.tipo);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.status(200).send(r.dado.corpo);
  } catch (e) {
    logger.error('ep-estudo', `imagem ${tipo} falhou`, String((e as Error)?.message || e).slice(0, 200));
    falha();
  }
}

router.get('/:token/satelite.jpg', estudoImgLimiter, (req, res) => imagem(req, res, 'satelite'));
router.get('/:token/rua.jpg', estudoImgLimiter, (req, res) => imagem(req, res, 'rua'));

export default router;
