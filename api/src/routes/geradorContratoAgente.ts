import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { exigeConsultor } from './geradorDossie';
import { listaParaFront } from '../services/gerador/contratoAgenteCampos';
import { MAX_BYTES_AGENTE, PedidoAgente, PedidoConflitos, checarConflitos, pedirAgente } from '../services/gerador/contratoAgente';

// ─────────────────────────────────────────────────────────────────────────────
// AGENTE DO CONTRATO. Montada dentro de /gerador (ver services/gerador/contratoAgente.ts).
//
//   GET  /gerador/contrato/agente/campos   a lista branca de campos que o agente pode mudar
//   POST /gerador/contrato/agente          a conversa: devolve resposta e ações
//   POST /gerador/contrato/conflitos       a checagem de conflito, sem IA
//
// Só consultor logado. O limite da IA é por PESSOA (o e-mail do consultor já validado, depois do `exigeConsultor`),
// nunca por IP: o escritório inteiro sai por um IP só. 30 pedidos a cada 5 minutos.
// ─────────────────────────────────────────────────────────────────────────────
export const agenteContratoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => 'contrato-agente:' + String((req as unknown as { consultor?: { email?: string } }).consultor?.email || 'sem-consultor'),
  message: { error: 'Muitos pedidos ao agente de contrato em pouco tempo. Aguarde alguns minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const detalhe = (e: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
  e.issues.slice(0, 3).map(i => `${i.path.map(String).join('.')}: ${i.message}`);

export function mountContratoAgente(router: Router): void {
  router.get('/contrato/agente/campos', exigeConsultor, (_req: Request, res: Response) => {
    res.json({ ok: true, campos: listaParaFront() });
  });

  router.post('/contrato/agente', exigeConsultor, agenteContratoLimiter, async (req: Request, res: Response) => {
    const p = PedidoAgente.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: 'Pedido inválido.', detalhe: detalhe(p.error) }); return; }
    // O teto de tamanho é desta rota: o app.ts aceita 10 MB para todas.
    if (JSON.stringify(p.data).length > MAX_BYTES_AGENTE) { res.status(413).json({ error: 'Contrato grande demais para mandar à IA.' }); return; }
    const r = await pedirAgente(p.data);
    if (!r.ok) { res.status(r.status).json({ error: r.erro }); return; }
    res.json(r);
  });

  router.post('/contrato/conflitos', exigeConsultor, (req: Request, res: Response) => {
    const p = PedidoConflitos.safeParse(req.body);
    if (!p.success) { res.status(400).json({ error: 'Pedido inválido.', detalhe: detalhe(p.error) }); return; }
    if (JSON.stringify(p.data).length > MAX_BYTES_AGENTE) { res.status(413).json({ error: 'Contrato grande demais.' }); return; }
    const r = checarConflitos(p.data);
    if (!r.ok) { res.status(r.status).json({ error: r.erro }); return; }
    res.json({ ok: true, conflitos: r.conflitos, bloqueado: r.bloqueado });
  });
}
