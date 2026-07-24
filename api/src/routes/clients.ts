import { Router } from 'express';
import { listClients, createClient, updateClient, deleteClient } from '../controllers/clientsController';
import { scanConta, scanDocumento } from '../controllers/contaScanController';
import { authMiddleware } from '../middleware/auth';
import { aiLimiter } from '../middleware/rateLimiter';

const router = Router();

router.use(authMiddleware);

router.get('/', listClients);
router.post('/', createClient);
// Escanear Conta: OCR da conta de luz via IA. Rate-limit de IA (10/min por IP).
// Não salva nada — devolve os campos pra revisão no ClientModal.
router.post('/scan', aiLimiter, scanConta);
// Escanear Documento: OCR de RG/CNH/CIN via IA — devolve nome + CPF pro cadastro.
router.post('/scan-documento', aiLimiter, scanDocumento);
router.put('/:id', updateClient);
router.delete('/:id', deleteClient);

export default router;
