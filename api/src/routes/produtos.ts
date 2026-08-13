import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { acessos } from '../services/produtos/acessos';
import { PRODUTOS } from '../services/produtos/catalogo';
import { supabase } from '../utils/supabase';
import { noBastidor } from '../services/produtos/bastidor';

const router = Router();
router.use(authMiddleware);

/**
 * GET /produtos/acessos — o que esta pessoa pode usar.
 *
 * Uma chamada só, no carregamento do app. A tela não decide nada sozinha: se
 * este endpoint não responder, o cadeado aparece — errar pro lado de trancar é
 * recuperável (a pessoa recarrega), errar pro lado de abrir entrega produto de
 * graça e não tem volta.
 */
router.get('/acessos', async (req: Request, res: Response): Promise<void> => {
  try {
    const a = await acessos(req.userId);
  // O e-mail vai junto pra tela pré-preencher o checkout da Kiwify. Compra feita
  // com e-mail diferente do da conta cria um usuário SEPARADO — a pessoa paga,
  // o acesso é liberado, e ela não vê nada na conta em que estava logada.
    const { data: u } = await supabase.from('users').select('email').eq('id', req.userId).single();
    res.json({
    email: u?.email ?? null,
    // Loja em lançamento restrito: quem está fora não vê os itens novos no menu
    // nem cadeado nas ferramentas que já eram grátis.
    bastidor: noBastidor(u?.email),
    plano: a.plano,
    assinante: a.assinante,
    is_admin: a.isAdmin,
    produtos: Array.from(a.produtos),
    origem: a.origem,
    catalogo: PRODUTOS.map((p) => ({
      id: p.id, nome: p.nome, tipo: p.tipo, preco: p.preco,
      na_assinatura: p.naAssinatura, rota: p.rota,
    })),
    });
  } catch (err) {
    // Responde um payload SEGURO em vez de 500: sem produtos e fora do bastidor,
    // que é exatamente o estado "nada mudou" — a plataforma segue como sempre foi
    // pra quem já usa, em vez de a tela travar num erro.
    console.error('[produtos/acessos] falhou:', err);
    res.json({
      email: null, plano: 'free', assinante: false, is_admin: false,
      bastidor: false, produtos: [], origem: {}, catalogo: [],
    });
  }
});

export default router;
