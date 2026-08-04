import { Router, Request, Response, NextFunction } from 'express';
import { generateDocument, regenerateDocument, getDocumentForEdit, saveDocument, updateDocumentFile, listDocuments, renderDocumentHtml, propostaPrefill } from '../controllers/documentsController';
import { generatePdf } from '../controllers/pdfController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Aceita token via query param para download direto no celular
function downloadAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Header já presente (fetch com Authorization)
  if (req.headers.authorization?.startsWith('Bearer ')) {
    // authMiddleware virou async (checa Clerk antes do JWT); quem responde é ele,
    // aqui só paramos. O void deixa explícito que a promise é dele, não nossa.
    void authMiddleware(req, res, next);
    return;
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
// Reemite um doc existente com os campos corrigidos (mesmo link, mesmo número).
router.post('/:id/regenerate', authMiddleware, regenerateDocument);
router.post('/save', authMiddleware, saveDocument);
router.patch('/:id/file', authMiddleware, updateDocumentFile);
router.get('/list', authMiddleware, listDocuments);
// Auto-preenchimento: kit do vendedor + histórico por cliente (reusa dados_json).
router.get('/proposta-prefill', authMiddleware, propostaPrefill);
// Reabre um doc salvo no formulário (botão "Editar" do /histórico).
router.get('/:id/edit', authMiddleware, getDocumentForEdit);
router.get('/:id/pdf', downloadAuth, generatePdf);
router.get('/:id/html', downloadAuth, renderDocumentHtml);

export default router;
