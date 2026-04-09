import { Router } from 'express';
import { generateDocument, saveDocument, listDocuments } from '../controllers/documentsController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.post('/generate', generateDocument);
router.post('/save', saveDocument);
router.get('/list', listDocuments);

export default router;
