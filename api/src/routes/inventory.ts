import { Router } from 'express';
import {
  listInventory,
  createItem,
  updateItem,
  deleteItem,
  addMovement,
  listMovements,
} from '../controllers/inventoryController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', listInventory);
router.post('/', createItem);
router.put('/:id', updateItem);
router.delete('/:id', deleteItem);
router.post('/:id/movement', addMovement);
router.get('/:id/movements', listMovements);

export default router;
