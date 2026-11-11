import { Router, Request, Response, NextFunction } from 'express';
import { generateDocument, regenerateDocument, getDocumentForEdit, saveDocument, updateDocumentFile, listDocuments, renderDocumentHtml, propostaPrefill, resumoDocumentos, documentosPorCliente, excluirDocumento } from '../controllers/documentsController';
import { generatePdf } from '../controllers/pdfController';
import { uploadPortfolioImagem } from '../controllers/portfolioController';
import { aberturasResumo, aberturasDoDocumento } from '../controllers/aberturasController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// Aceita token via query param para download direto no celular
async function downloadAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // 1. Header já presente (fetch com Authorization)
  if (req.headers.authorization?.startsWith('Bearer ')) {
    // authMiddleware é async (checa Clerk antes do JWT) e é ele quem responde em caso de erro;
    // o await segura a promise dele dentro desta função, igual ao ramo do token na query.
    await authMiddleware(req, res, next);
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
  await authMiddleware(req, res, next);
}

router.post('/generate', authMiddleware, generateDocument);
// Reemite um doc existente com os campos corrigidos (mesmo link, mesmo número).
router.post('/:id/regenerate', authMiddleware, regenerateDocument);
router.post('/save', authMiddleware, saveDocument);
// Imagens do portfólio da proposta Completa (obras, empresas atendidas, bancos parceiros).
router.post('/portfolio-imagem', authMiddleware, uploadPortfolioImagem);
router.patch('/:id/file', authMiddleware, updateDocumentFile);
router.get('/list', authMiddleware, listDocuments);
// Aberturas do link rastreado da proposta. O resumo vem antes de qualquer rota com :id.
router.get('/aberturas', authMiddleware, aberturasResumo);
router.get('/:id/aberturas', authMiddleware, aberturasDoDocumento);
// Indicadores do mês e pastas por cliente (agregados no servidor).
router.get('/resumo', authMiddleware, resumoDocumentos);
// Documentos, vistorias e manutenções de um cliente.
router.get('/por-cliente', authMiddleware, documentosPorCliente);
// Auto-preenchimento: kit do vendedor + histórico por cliente (reusa dados_json).
router.get('/proposta-prefill', authMiddleware, propostaPrefill);
// Reabre um doc salvo no formulário (botão "Editar" do /histórico).
router.get('/:id/edit', authMiddleware, getDocumentForEdit);
// Exclui o documento (linha, contador de numeração preservado e arquivo). Não devolve cota.
router.delete('/:id', authMiddleware, excluirDocumento);
router.get('/:id/pdf', downloadAuth, generatePdf);
router.get('/:id/html', downloadAuth, renderDocumentHtml);

export default router;
