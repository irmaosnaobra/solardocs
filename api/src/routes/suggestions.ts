import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';
import {
  listSuggestions, createSuggestion,
  listFeed, toggleVote, listComments, createComment,
  listAdminAll, changeStatus,
} from '../controllers/suggestionsController';

const router = Router();
router.use(authMiddleware);

// Próprias sugestões do user
router.get('/', listSuggestions);
router.post('/', createSuggestion);

// Fórum público (qualquer user logado)
router.get('/feed', listFeed);
router.post('/:id/vote', toggleVote);
router.get('/:id/comments', listComments);
router.post('/:id/comment', createComment);

// Admin
router.get('/admin/all', adminMiddleware, listAdminAll);
router.patch('/admin/:id/status', adminMiddleware, changeStatus);

export default router;
