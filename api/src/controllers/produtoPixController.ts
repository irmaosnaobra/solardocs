import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { ApiError } from '../utils/apiError';
import {
  criarCobrancaProduto, statusCobrancaProduto, cpfMascaradoDaPessoa, JaTemProdutoError, PagoAguardandoLiberacaoError,
} from '../services/produtos/produtoPix';

function responderErro(res: Response, err: unknown, contexto: string): void {
  if (err instanceof JaTemProdutoError) {
    res.status(409).json({ error: err.message, jaTem: true });
    return;
  }
  if (err instanceof PagoAguardandoLiberacaoError) {
    res.status(409).json({ error: err.message, pagoAguardando: true });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  logger.error('produto-pix', `${contexto}: ${(err as Error)?.message ?? 'erro'}`, err);
  res.status(500).json({ error: 'Erro inesperado. Tente de novo.' });
}

/** POST /produtos/pix { produto, cpf } ou { produto, usarCpfSalvo: true }. */
export async function criarPixProdutoHandler(req: Request, res: Response): Promise<void> {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    // Qualquer `valor` no corpo e ignorado de proposito: o preco e o do catalogo.
    const r = await criarCobrancaProduto({ userId: req.userId, produto: b.produto, cpf: b.cpf, usarCpfSalvo: b.usarCpfSalvo });
    res.json(r);
  } catch (err) {
    responderErro(res, err, 'criar');
  }
}

/** GET /produtos/pix/:cobrancaId: so o dono da cobranca le. */
export async function statusPixProdutoHandler(req: Request, res: Response): Promise<void> {
  try {
    const r = await statusCobrancaProduto(req.userId, String(req.params.cobrancaId ?? ''));
    if (!r) {
      res.status(404).json({ error: 'Cobrança não encontrada.' });
      return;
    }
    res.json(r);
  } catch (err) {
    responderErro(res, err, 'status');
  }
}

/** GET /produtos/cpf: o CPF da ultima cobranca, mascarado. */
export async function cpfPixProdutoHandler(req: Request, res: Response): Promise<void> {
  try {
    res.json({ cpf: await cpfMascaradoDaPessoa(req.userId) });
  } catch (err) {
    responderErro(res, err, 'cpf');
  }
}
