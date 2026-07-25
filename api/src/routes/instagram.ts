// ─────────────────────────────────────────────────────────────────────────────
// Rotas do Instagram nativo: webhook (comentários/mensagens), OAuth (Login do
// Instagram) e endpoints do painel (status/posts). Montado em /instagram no app.ts.
// O corpo do webhook chega como Buffer (express.raw) pra validar o HMAC no corpo cru.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  igEnv, verifyHmac, authorizeUrl, exchangeCode, exchangeLongToken, getMe,
  saveIgConfig, subscribeApps, getIgConfig, getMedia,
} from '../services/instagram/igClient';
import { handleComment, handleMessage, drainIgQueue } from '../services/instagram/igEngine';

const router = Router();

// Handshake de verificação do webhook (GET).
router.get('/webhook', (req: Request, res: Response): void => {
  const { verifyToken } = igEnv();
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
    res.status(200).send(String(challenge || ''));
  } else {
    res.sendStatus(403);
  }
});

// Recebe eventos (POST). Valida HMAC, enfileira, responde 200 rápido.
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyHmac(raw, req.headers['x-hub-signature-256'] as string | undefined)) {
    res.sendStatus(403); return;
  }
  let body: any;
  try { body = JSON.parse(raw.toString('utf8')); } catch { res.sendStatus(400); return; }

  // Responde já; mas enfileira ANTES de encerrar (serverless congela após a resposta).
  try {
    const cfg = await getIgConfig();
    const ownIgId = cfg?.ig_user_id || '';
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'comments' && change.value) await handleComment(change.value);
      }
      for (const msg of entry.messaging || []) {
        await handleMessage(msg, ownIgId);
      }
    }
  } catch (err) {
    logger.error('ig', 'webhook processamento falhou', err);
  }
  res.sendStatus(200);
});

// Inicia o login: manda pro authorize do Instagram.
router.get('/oauth/start', (_req: Request, res: Response): void => {
  const { appId, redirectUri } = igEnv();
  if (!appId || !redirectUri) { res.status(503).send('Instagram não configurado (falta IG_APP_ID / IG_REDIRECT_URI).'); return; }
  res.redirect(authorizeUrl());
});

// Callback do OAuth: troca code → token longo, salva, assina webhooks.
router.get('/oauth/callback', async (req: Request, res: Response): Promise<void> => {
  const code = String(req.query.code || '');
  if (!code) { res.status(400).send('Sem code.'); return; }
  try {
    const { token: shortToken } = await exchangeCode(code);
    const { token, expiresIn } = await exchangeLongToken(shortToken);
    const me = await getMe(token);
    await saveIgConfig({
      ig_user_id: me.user_id, username: me.username, name: me.name,
      profile_picture_url: me.profile_picture_url, access_token: token,
      token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    });
    await subscribeApps(me.user_id, token);
    const dash = (process.env.DASHBOARD_URL || 'https://solardoc.app').replace(/\/$/, '');
    res.redirect(`${dash}/gerador?ig=conectado`);
  } catch (err: any) {
    logger.error('ig', 'oauth callback falhou', err);
    res.status(500).send('Falha ao conectar o Instagram: ' + String(err?.message || err));
  }
});

// Status pro painel — SEM o token (só dados públicos).
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  const { enabled, appId } = igEnv();
  const cfg = await getIgConfig();
  res.json({
    configurado: !!appId,
    ligado: enabled,
    conectado: !!(cfg?.access_token && cfg?.ig_user_id),
    username: cfg?.username || null,
    profile_picture_url: cfg?.profile_picture_url || null,
    token_expires_at: cfg?.token_expires_at || null,
  });
});

// Posts recentes pro seletor visual (usa o token no servidor).
router.get('/media', async (_req: Request, res: Response): Promise<void> => {
  const cfg = await getIgConfig();
  if (!cfg?.access_token || !cfg.ig_user_id) { res.json({ data: [] }); return; }
  try { res.json({ data: await getMedia(cfg.ig_user_id, cfg.access_token) }); }
  catch (err: any) { res.status(500).json({ error: String(err?.message || err) }); }
});

// Drenagem manual (opcional; a fila também é drenada pelo cron).
router.post('/drain', async (_req: Request, res: Response): Promise<void> => {
  try { res.json({ ok: true, ...(await drainIgQueue()) }); }
  catch (err: any) { res.status(500).json({ error: String(err?.message || err) }); }
});

// Callback de desautorização (Meta chama quando o usuário remove o app). Exigido
// pelas configurações de login da empresa antes do App Review. Responde 200.
router.post('/deauth', (_req: Request, res: Response): void => {
  logger.info('ig', 'deauthorize recebido');
  res.sendStatus(200);
});
router.get('/deauth', (_req: Request, res: Response): void => { res.sendStatus(200); });

// Callback de exclusão de dados (spec da Meta): responde JSON com URL de status +
// código de confirmação. A página pública de instruções é /exclusao-de-dados.
router.post('/data-deletion', (_req: Request, res: Response): void => {
  const code = 'del_' + Date.now().toString(36);
  res.json({ url: 'https://solardoc.app/exclusao-de-dados', confirmation_code: code });
});
router.get('/data-deletion', (_req: Request, res: Response): void => {
  res.redirect('https://solardoc.app/exclusao-de-dados');
});

export default router;
