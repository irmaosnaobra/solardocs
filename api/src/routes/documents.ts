import { Router } from 'express';
import { generateDocument, saveDocument, updateDocumentFile, listDocuments } from '../controllers/documentsController';
import { generatePdf } from '../controllers/pdfController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.post('/generate', generateDocument);
router.post('/save', saveDocument);
router.patch('/:id/file', updateDocumentFile);
router.get('/list', listDocuments);
router.get('/:id/pdf', generatePdf);

export default router;
