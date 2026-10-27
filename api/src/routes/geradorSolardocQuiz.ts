import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { statusLeadsQuiz } from '../services/solardoc/statusLeadsQuiz';
import { ACOES_FOLLOWUP, FollowupErro, registrarFollowup } from '../services/solardoc/followupQuizSolardoc';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// QUIZ DO SOLARDOC NO /gerador (26/10/2026): onde está cada lead (a Carla chamou? o time foi avisado? comprou? em que pé está a ligação?).
// O GET é SÓ LEITURA. O POST /solardoc/quiz-followup (27/10/2026) é a ÚNICA escrita: registra a ligação do consultor na fila
// (chave quiz_followup:<hmac> do banco principal). Nada aqui envia mensagem.
// Devolve estado de cliente, então NÃO é público: usa o mesmo `exigeConsultor` das rotas do solar
// (token da pessoa no Authorization, validado no Supabase do Gerador; conta @irmaosnaobra.app confirmada).
// Sem nome e sem telefone na resposta: a chave de cada item é o próprio lead_id. O POST nunca aceita telefone nem hmac do cliente:
// só o lead_id, e o telefone sai do lead lido no banco.
// ─────────────────────────────────────────────────────────────────────────────

const LEAD_ID_QUIZ = /^sdquiz_\d{10,11}$/;
const ACOES_ACEITAS: readonly string[] = [...ACOES_FOLLOWUP, 'desfazer'];

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

  router.post('/solardoc/quiz-followup', exigeConsultor, async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const corpo = (req.body && typeof req.body === 'object' ? req.body : {}) as { lead_id?: unknown; acao?: unknown };
    const leadId = typeof corpo.lead_id === 'string' ? corpo.lead_id : '';
    const acao = typeof corpo.acao === 'string' ? corpo.acao : '';
    if (!LEAD_ID_QUIZ.test(leadId)) { res.status(400).json({ ok: false, erro: 'lead_id inválido' }); return; }
    if (!ACOES_ACEITAS.includes(acao)) { res.status(400).json({ ok: false, erro: 'ação inválida' }); return; }
    // Quem registrou: o nome que o exigeConsultor tirou do e-mail da sessão (nunca do corpo).
    const por = String((req as any).consultor?.nome || '').trim();
    try {
      res.json({ ok: true, followup: await registrarFollowup(leadId, acao, por) });
    } catch (err: any) {
      if (err instanceof FollowupErro) {
        const status = err.codigo === 'nao_encontrado' ? 404 : err.codigo === 'sem_telefone' ? 422 : 400;
        res.status(status).json({ ok: false, erro: err.message });
        return;
      }
      logger.error('gerador-solardoc-quiz', 'registrar a ligação do quiz falhou', String(err?.message || 'erro desconhecido').slice(0, 120));
      res.status(502).json({ ok: false, erro: 'não consegui gravar agora. Tente de novo em instantes.' });
    }
  });
}
