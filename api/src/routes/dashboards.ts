import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { supabase } from '../utils/supabase';
import { getInsights } from '../services/insightsService';

const router = Router();

router.use(authMiddleware);

// GET /dashboards/insights — KPIs agregados da Planilha + Trello.
// Cache em memória 1h. Query ?force=1 pula cache (botão "Atualizar agora").
// Restrito a admins.
router.get('/insights', async (req: Request, res: Response): Promise<void> => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', req.userId)
      .single();

    if (!user?.is_admin) {
      res.status(403).json({ error: 'Apenas administradores' });
      return;
    }

    const force = req.query.force === '1';
    const insights = await getInsights(force);
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar insights', message: String(err) });
  }
});

export default router;
