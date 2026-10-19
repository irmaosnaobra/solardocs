import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { aiLimiter } from '../middleware/rateLimiter';
import { MAX_BYTES_PEDIDO } from '../services/gerador/contratoIa';
import { PedidoHibrido, pedirHibrido, validarCombinacao } from '../services/gerador/contratoHibrido';

// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO HÍBRIDO do eletroposto. Montada dentro de /gerador.
//
//   POST /gerador/contrato/hibrido
//     corpo: { tipos: [A, B], modelos: { A: [clausula], B: [clausula] }, pedido?: string }
//     resposta: o PLANO (ver services/gerador/contratoHibrido.ts)
//
// Mesmos middlewares e mesmo teto de corpo do /contrato/redesenhar: só consultor logado, com o limite de IA.
// ─────────────────────────────────────────────────────────────────────────────
export function mountContratoHibrido(router: Router): void {
  router.post('/contrato/hibrido', aiLimiter, exigeConsultor, async (req: Request, res: Response) => {
    const p = PedidoHibrido.safeParse(req.body);
    if (!p.success) {
      res.status(400).json({ error: 'pedido inválido', detalhe: p.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`) });
      return;
    }
    const comb = validarCombinacao(p.data.tipos);
    if (!comb.ok) { res.status(400).json({ error: comb.motivo }); return; }
    if (JSON.stringify(p.data).length > MAX_BYTES_PEDIDO) {
      res.status(413).json({ error: 'contrato grande demais para mandar à IA' });
      return;
    }
    const r = await pedirHibrido(p.data);
    if (!r.ok) { res.status(r.status).json({ error: r.erro }); return; }
    res.json(r);
  });
}
