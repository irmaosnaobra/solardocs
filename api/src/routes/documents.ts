import { Router, Request, Response, NextFunction } from 'express';
import { generateDocument, saveDocument, updateDocumentFile, listDocuments } from '../controllers/documentsController';
import { generatePdf } from '../controllers/pdfController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Aceita token via query param para download direto no celular (sem await no cliente)
function downloadAuth(req: Request, res: Response, next: NextFunction): void {
  let token = req.query.token as string | undefined;
  // Fallback: Vercel routing às vezes não popula req.query — lê do req.url diretamente
  if (!token && req.url && req.url.includes('token=')) {
    const m = req.url.match(/[?&]token=([^&]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }
  if (token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${token}`;
  }
  authMiddleware(req, res, next);
}

router.post('/generate', authMiddleware, generateDocument);
router.post('/save', authMiddleware, saveDocument);
router.patch('/:id/file', authMiddleware, updateDocumentFile);
router.get('/list', authMiddleware, listDocuments);
router.get('/:id/pdf', downloadAuth, generatePdf);

export default router;
