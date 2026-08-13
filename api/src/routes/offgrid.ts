import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { criarPedidoOffGrid, listarPedidosOffGrid, orcarOffGrid } from '../controllers/offgridController';

const router = Router();
router.use(authMiddleware);

// Preço do kit — 402 pra quem não tem o add-on.
router.post('/orcar', orcarOffGrid);

// Pedido de kit off-grid pro fornecedor (nós).
router.post('/pedido', criarPedidoOffGrid);
router.get('/pedidos', listarPedidosOffGrid);

export default router;
