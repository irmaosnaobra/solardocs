import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { statusLeadsQuiz } from '../services/solardoc/statusLeadsQuiz';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ DO SOLARDOC NO /gerador (26/10/2026): onde está cada lead (a Carla chamou? o time foi avisado? comprou?).
// SÓ LEITURA. Devolve estado de cliente, então NÃO é pública: usa o mesmo `exigeConsultor` das rotas do solar
// (token da pessoa no Authorization, validado no Supabase do Gerador; conta @irmaosnaobra.app confirmada).
// Sem nome e sem telefone na resposta: a chave de cada item é o próprio lead_id.
// ─────────────────────────────────────────────────────────────────────────────

export function mountSolardocQuizStatus(router: Router): void {
  router.get('/solardoc/quiz-status', exigeConsultor, async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.json(await statusLeadsQuiz({ dias: req.query.dias }));
    } catch (err: any) {
      // O log não leva lead_id nem telefone: só a mensagem do erro.
      logger.error('gerador-solardoc-quiz', 'status dos leads do quiz falhou', String(err?.message || 'erro desconhecido').slice(0, 120));
      res.status(502).json({ ok: false, error: 'não consegui ler os leads do quiz agora. Tente de novo em instantes.' });
    }
  });
}
