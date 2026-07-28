import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { meuAcesso, marcarProgresso } from '../controllers/kitController';

const router = Router();
router.use(authMiddleware);

// Kit de Fechamento do Integrador (aba "Meus Materiais").
router.get('/meu-acesso', meuAcesso);
router.post('/progresso', marcarProgresso);

export default router;
