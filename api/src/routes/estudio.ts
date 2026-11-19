import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';

// Aba "Estúdio" do /admin (19/11/2026): o publicador local da série "Dentro da Guerra"
// coleta métricas das redes e envia um resumo (snapshot). A api só guarda e entrega.
// Dois routers: o POST de máquina (/estudio) e o GET do painel (/admin/estudio, guard de admin).

const CHAVE = 'estudio_snapshot';
const LIMITE_BYTES = 1024 * 1024;

/** Segredo da máquina: ESTUDIO_SYNC_TOKEN; sem ele, cai para o CRON_SECRET. Vazio = nenhum definido. */
function segredoEsperado(): string {
  return (process.env.ESTUDIO_SYNC_TOKEN || '').trim() || (process.env.CRON_SECRET || '').trim();
}

function tokenConfere(recebido: string, esperado: string): boolean {
  const a = crypto.createHash('sha256').update(recebido).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b); // hash dos dois: mesmo tamanho, sem vazar o comprimento
}

/** Router do publicador: POST /estudio/snapshot. */
export const estudioMaquinaRouter = Router();

estudioMaquinaRouter.post('/snapshot', async (req: Request, res: Response): Promise<void> => {
  const esperado = segredoEsperado();
  if (!esperado) { res.status(503).json({ error: 'estudio_sem_token' }); return; }

  const cab = String(req.headers.authorization || '');
  const recebido = cab.startsWith('Bearer ') ? cab.slice(7).trim() : '';
  if (!recebido || !tokenConfere(recebido, esperado)) { res.status(401).json({ error: 'nao_autorizado' }); return; }

  const declarado = Number(req.headers['content-length'] || 0);
  if (declarado > LIMITE_BYTES) { res.status(413).json({ error: 'snapshot_grande_demais' }); return; }

  const corpo = req.body as {
    versao?: unknown; episodios?: unknown; redes?: unknown;
    serie?: { nome?: unknown }; fabrica?: { etapas?: unknown }; totais?: { porRede?: unknown };
  } | undefined;
  // O painel lê serie, fabrica.etapas e totais.porRede direto: snapshot sem eles quebraria a aba até o próximo envio.
  const contratoOk = !!corpo && typeof corpo === 'object' && corpo.versao === 1
    && Array.isArray(corpo.episodios) && Array.isArray(corpo.redes)
    && typeof corpo.serie?.nome === 'string' && Array.isArray(corpo.fabrica?.etapas)
    && !!corpo.totais?.porRede && typeof corpo.totais.porRede === 'object';
  if (!contratoOk) {
    res.status(400).json({ error: 'snapshot_invalido' });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(corpo)) > LIMITE_BYTES) { res.status(413).json({ error: 'snapshot_grande_demais' }); return; }

  try {
    const { error } = await supabase.from('system_state').upsert(
      { key: CHAVE, value: corpo, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[estudio] gravar snapshot falhou:', String((err as Error)?.message || err).slice(0, 120));
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/** Router do painel: GET /admin/estudio. Monta ANTES de `app.use('/admin', ...)`. */
export const estudioAdminRouter = Router();
estudioAdminRouter.use(authMiddleware);
estudioAdminRouter.use(adminMiddleware);

estudioAdminRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.from('system_state').select('value, updated_at').eq('key', CHAVE).maybeSingle();
    if (error) throw error;
    res.json({ snapshot: data?.value ?? null, atualizadoEm: data?.updated_at ?? null });
  } catch (err) {
    console.error('[estudio] ler snapshot falhou:', String((err as Error)?.message || err).slice(0, 120));
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
