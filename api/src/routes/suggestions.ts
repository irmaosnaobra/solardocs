import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { listSuggestions, createSuggestion } from '../controllers/suggestionsController';

const router = Router();

router.use(authMiddleware);
router.get('/', listSuggestions);
router.post('/', createSuggestion);

export default router;
