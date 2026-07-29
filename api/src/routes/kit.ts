import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { meuAcesso, marcarProgresso, missoes } from '../controllers/kitController';

const router = Router();
router.use(authMiddleware);

// Curso Kit de Fechamento (seção Cursos).
router.get('/meu-acesso', meuAcesso);
router.post('/progresso', marcarProgresso);
// Missões da plataforma que destravam o módulo bônus.
router.get('/missoes', missoes);

export default router;
