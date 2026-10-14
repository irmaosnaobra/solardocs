import { Router, Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { equipeAutorizada } from '../services/gerador/caixaWhatsapp';
import { CHAVES, chaveLigada, type RedeMeta } from '../services/gerador/redes/comum';
import { criarUrlDeEnvio, ErroVideo } from '../services/gerador/redes/video';
import { publicarStatus, situacaoStatus, listarStatus } from '../services/gerador/redes/statusIo';
import { publicarReel, avancarPublicacao, listarPublicacoes, situacaoReels } from '../services/gerador/redes/publicador';
import { responderComentario, situacaoResposta } from '../services/gerador/redes/respostas';
import { listarComentarios } from '../services/gerador/redes/caixa';

// ─────────────────────────────────────────────────────────────────────────────
// AUTOMAÇÃO COMO CENTRO DAS REDES, FASE 1: a parte do servidor (14/10/2026).
// Montada dentro de /gerador. Rotas:
//   POST /redes/upload-url                       URL assinada de envio do vídeo (Storage)
//   POST /redes/publicar                         { rede: instagram | facebook | status, video_url, legenda }
//   GET  /redes/publicacoes                      Reels e status recentes
//   POST /redes/publicacoes/:id/avancar          lê o contêiner (1 por minuto) e publica quando pronto
//   GET  /redes/comentarios?rede=                caixa de comentários (uma rede)
//   POST /redes/comentarios/responder            { rede, comentario_id, texto }
//   GET  /redes/limites                          o que pode agora e quando abre, por rede
//
// Duas travas, nesta ordem: `exigeConsultor` (token do Gerador, e-mail de consultor
// confirmado) e a lista fechada da equipe (REDES_EQUIPE; padrão thiago, diego, giovanna
// e nilce, a mesma da caixa da 5040). Cada chamada grava QUEM clicou.
//
// UMA rede e UM item por chamada. Lista, campo desconhecido ou valor que não é texto
// dá 400, antes de qualquer outra conferência. Cada item nasce DESLIGADO: sem a env
// dele, nada sai (403).
//
// Nada de texto de comentário, legenda ou link em log.
// ─────────────────────────────────────────────────────────────────────────────

const PADRAO_ERRO = 'Pedido inválido.';

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function exigeEquipe(req: Request, res: Response, next: NextFunction): void {
  const nome = String((req as any).consultor?.nome || '');
  if (!equipeAutorizada(nome, process.env.REDES_EQUIPE)) {
    res.status(403).json({ ok: false, error: 'Esta tela é só para a equipe.', precisa: 'equipe' });
    return;
  }
  next();
}

const quem = (req: Request): string => String((req as any).consultor?.nome || '');

/** Corpo estrito: objeto simples, só as chaves permitidas, nenhum valor lista. */
function corpoEstrito(req: Request, permitidas: readonly string[]): Record<string, unknown> | null {
  const b = req.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
    if (!permitidas.includes(k) || Array.isArray(v)) return null;
  }
  return b as Record<string, unknown>;
}

const recusar400 = (res: Response): void => { res.status(400).json({ ok: false, error: PADRAO_ERRO }); };

const REDES_META: readonly RedeMeta[] = ['instagram', 'facebook'];

export function mountRedes(router: Router): void {
  const base = [exigeConsultor, exigeEquipe, semCache];

  // ── Envio do vídeo (o navegador envia direto ao Storage) ────────────────────
  router.post('/redes/upload-url', ...base, async (req: Request, res: Response) => {
    const b = corpoEstrito(req, ['nome', 'tipo', 'tamanho']);
    if (!b) { recusar400(res); return; }
    if (!chaveLigada(CHAVES.status) && !chaveLigada(CHAVES.instagram) && !chaveLigada(CHAVES.facebook)) {
      res.status(403).json({ ok: false, error: 'A publicação nas redes está desligada.', motivo: 'chave_desligada' });
      return;
    }
    try {
      const u = await criarUrlDeEnvio(b);
      res.json({ ok: true, ...u });
    } catch (err) {
      if (err instanceof ErroVideo) { res.status(err.http).json({ ok: false, error: err.mensagem, motivo: err.motivo }); return; }
      console.error('[redes] upload-url falhou');
      res.status(502).json({ ok: false, error: 'Não consegui preparar o envio agora. Tente de novo.' });
    }
  });

  // ── Publicar: UMA rede, UM vídeo ────────────────────────────────────────────
  router.post('/redes/publicar', ...base, async (req: Request, res: Response) => {
    const b = corpoEstrito(req, ['rede', 'video_url', 'legenda']);
    if (!b || typeof b.rede !== 'string') { recusar400(res); return; }
    if (b.rede === 'status') {
      const r = await publicarStatus({ video_url: b.video_url, legenda: b.legenda ?? '', por: quem(req) });
      res.status(r.http).json(r);
      return;
    }
    if (b.rede !== 'instagram' && b.rede !== 'facebook') { recusar400(res); return; }
    const r = await publicarReel({ rede: b.rede, video_url: b.video_url, legenda: b.legenda ?? '', por: quem(req) });
    res.status(r.http).json(r);
  });

  // ── Lista de publicações ────────────────────────────────────────────────────
  router.get('/redes/publicacoes', ...base, async (_req: Request, res: Response) => {
    try {
      const [reels, status] = await Promise.all([listarPublicacoes(), listarStatus()]);
      res.json({ ok: true, reels, status });
    } catch {
      console.error('[redes] listar publicações falhou');
      res.status(502).json({ ok: false, error: 'Não consegui ler as publicações agora. Tente de novo em instantes.' });
    }
  });

  // ── Avançar: a tela chama enquanto está aberta; o cron de 5 min também ──────
  router.post('/redes/publicacoes/:id/avancar', ...base, async (req: Request, res: Response) => {
    if (req.body !== undefined && !(req.body && typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length === 0)) {
      recusar400(res);
      return;
    }
    const r = await avancarPublicacao(req.params.id);
    res.status(r.http).json(r);
  });

  // ── Caixa de comentários (uma rede por chamada) ─────────────────────────────
  router.get('/redes/comentarios', ...base, async (req: Request, res: Response) => {
    const rede = req.query.rede;
    if (typeof rede !== 'string' || !(REDES_META as readonly string[]).includes(rede)) { recusar400(res); return; }
    if (!chaveLigada(CHAVES.caixa)) {
      res.status(403).json({ ok: false, error: 'A caixa de comentários está desligada.', motivo: 'chave_desligada' });
      return;
    }
    try {
      res.json({ ok: true, ...(await listarComentarios(rede as RedeMeta)) });
    } catch {
      console.error('[redes] caixa de comentários falhou');
      res.status(502).json({ ok: false, error: 'Não consegui ler os comentários agora. Tente de novo em instantes.' });
    }
  });

  router.post('/redes/comentarios/responder', ...base, async (req: Request, res: Response) => {
    const b = corpoEstrito(req, ['rede', 'comentario_id', 'texto']);
    if (!b) { recusar400(res); return; }
    const r = await responderComentario({ rede: b.rede, comentario_id: b.comentario_id, texto: b.texto, por: quem(req) });
    res.status(r.http).json(r);
  });

  // ── Limites: o que pode agora e quando abre ─────────────────────────────────
  router.get('/redes/limites', ...base, async (_req: Request, res: Response) => {
    try {
      const [status, igPub, fbPub, igResp, fbResp] = await Promise.all([
        situacaoStatus(), situacaoReels('instagram'), situacaoReels('facebook'),
        situacaoResposta('instagram'), situacaoResposta('facebook'),
      ]);
      res.json({
        ok: true,
        status,
        instagram: { publicar: igPub, responder: igResp },
        facebook: { publicar: fbPub, responder: fbResp },
        caixa: { ligado: chaveLigada(CHAVES.caixa) },
      });
    } catch {
      console.error('[redes] limites falhou');
      res.status(502).json({ ok: false, error: 'Não consegui ler os limites agora. Tente de novo em instantes.' });
    }
  });
}
