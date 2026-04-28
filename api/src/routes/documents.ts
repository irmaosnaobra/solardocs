import { Router, Request, Response, NextFunction } from 'express';
import { generateDocument, saveDocument, updateDocumentFile, listDocuments, getDocumentHtmlUrl } from '../controllers/documentsController';
import { generatePdf } from '../controllers/pdfController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Aceita token via query param para download direto no celular
function downloadAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Header já presente (fetch com Authorization)
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return authMiddleware(req, res, next);
  }

  // 2. req.query (Express parser)
  let token = req.query.token as string | undefined;

  // 3. req.url (path relativo ao router, mas inclui query string)
  if (!token) {
    const src = req.url || req.originalUrl || '';
    const m = src.match(/[?&]token=([^&\s]+)/);
    if (m) token = decodeURIComponent(m[1]);
  }

  if (token) {
    req.headers.authorization = `Bearer ${token}`;
  }
  authMiddleware(req, res, next);
}

router.post('/generate', authMiddleware, generateDocument);
router.post('/save', authMiddleware, saveDocument);
router.patch('/:id/file', authMiddleware, updateDocumentFile);
router.get('/list', authMiddleware, listDocuments);
router.get('/:id/pdf', downloadAuth, generatePdf);
router.get('/:id/html-url', authMiddleware, getDocumentHtmlUrl);

export default router;
