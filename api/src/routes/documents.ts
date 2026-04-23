import { Router, Request, Response, NextFunction } from 'express';
import { generateDocument, saveDocument, updateDocumentFile, listDocuments } from '../controllers/documentsController';
import { generatePdf } from '../controllers/pdfController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Aceita token via query param para download direto no celular (sem await no cliente)
function downloadAuth(req: Request, res: Response, next: NextFunction): void {
  const tokenFromQuery = req.query.token as string | undefined;
  if (tokenFromQuery && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${tokenFromQuery}`;
  }
  authMiddleware(req, res, next);
}

router.post('/generate', authMiddleware, generateDocument);
router.post('/save', authMiddleware, saveDocument);
router.patch('/:id/file', authMiddleware, updateDocumentFile);
router.get('/list', authMiddleware, listDocuments);
router.get('/:id/pdf', downloadAuth, generatePdf);

export default router;
