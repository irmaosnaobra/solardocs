import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  meuAcesso, marcarProgresso, missoes,
  salvarAvaliacao, minhasAvaliacoes, depoimentosPublicos, marcarAppInstalado,
} from '../controllers/kitController';

const router = Router();

// PÚBLICO — fica ANTES do authMiddleware de propósito: é a landing (HTML
// estático, sem login) que lê os depoimentos já aprovados.
router.get('/depoimentos', depoimentosPublicos);

router.use(authMiddleware);

// Curso Kit de Fechamento (seção Cursos).
router.get('/meu-acesso', meuAcesso);
router.post('/progresso', marcarProgresso);
// Missões da plataforma que destravam o módulo bônus.
router.get('/missoes', missoes);
// Avaliação (5 estrelas + comentário) por módulo e do curso.
router.post('/avaliacao', salvarAvaliacao);
router.get('/avaliacoes', minhasAvaliacoes);
// Instalou o app no aparelho (PWA) — usado pra medir se o convite funciona.
router.post('/app-instalado', marcarAppInstalado);

export default router;
