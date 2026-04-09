import { Router } from 'express';
import { getCompany, createCompany, updateCompany } from '../controllers/companyController';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', getCompany);
router.post('/', createCompany);
router.put('/', updateCompany);

export default router;
