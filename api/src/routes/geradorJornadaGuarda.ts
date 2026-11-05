import { Request, Response, NextFunction } from 'express';
import { aiLimiter } from '../middleware/rateLimiter';
import { acessoVendaSolar } from './geradorClientes';
import { type Ctx } from './geradorClientesDocs';
import { codigoDeRota } from '../services/gerador/docsCliente';
import { ErroCadastro } from '../services/gerador/cadastroVendaBanco';
import { ErroDocs } from '../services/gerador/docsClienteBanco';
import { ErroHub } from '../services/gerador/vendaSolarHub';
import { ErroJornada } from '../services/gerador/jornadaSolarBanco';
import { ehAdm, ehSocio } from '../services/gerador/solarObras';
import type { CardVendido } from '../services/gerador/fichaEletroposto';

// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): a guarda e o tratamento de erro COMUNS às rotas do dinheiro e das etapas 4 a 8.
// NÃO importa `geradorJornadaSolar.ts` e não é importado por ele (ciclo de boot em CommonJS). A guarda é a da obra: o card vendido de
// solar (`acessoVendaSolar`); inexistente e alheio dão 404 igual. Nada de valor, nome ou texto em log: só o código.
// ─────────────────────────────────────────────────────────────────────────────

export const MSG_PEDIDO = 'Pedido inválido.';
export const MSG_LER = 'Não consegui ler os dados agora. Tente de novo em instantes.';
export const MSG_GRAVAR = 'Não consegui gravar agora. Tente de novo.';
export const MSG_NAO_ACHEI = 'Venda não encontrada.';

export const logErroJornada = (que: string, err: unknown): void =>
  console.error(`[jornada-solar] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? 'interno');

/** Responde o erro de uma rota. Conflito de gravação (`ocupado`) é 409 com `tentarDeNovo`; banco e segredo, 503. */
export function falhouJornada(res: Response, que: string, err: unknown, leitura = false): void {
  logErroJornada(que, err);
  if ((err instanceof ErroJornada && err.codigo === 'ocupado') || (err instanceof ErroCadastro && err.codigo === 'ocupado')) {
    res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando agora. Tente de novo.' });
    return;
  }
  if (err instanceof ErroJornada || err instanceof ErroCadastro || err instanceof ErroHub || err instanceof ErroDocs) {
    res.status(503).json({ ok: false, error: leitura ? MSG_LER : MSG_GRAVAR });
    return;
  }
  res.status(500).json({ ok: false, error: leitura ? MSG_LER : MSG_GRAVAR });
}

export const quem = (req: Request): { nome: string; socio: boolean; adm: boolean } => {
  const nome = String((req as any).consultor?.nome || '').trim().toLowerCase();
  return { nome, socio: ehSocio(nome), adm: ehAdm(nome) };
};

export interface GuardaObra { nome: string; socio: boolean; adm: boolean; card: CardVendido; id: number; ctx: Ctx }

export async function guardaDaObra(req: Request, res: Response): Promise<GuardaObra | null> {
  const { nome, socio, adm } = quem(req);
  const id = codigoDeRota('vendasolar', req.params.card);
  if (!id) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return null; }
  try {
    const card = await acessoVendaSolar(nome, socio, Number(id));
    if (!card) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return null; }
    const ctx: Ctx = { linha: 'vendasolar', codigo: String(card.id), nome, socio, cliente: String(card.cliente_nome ?? ''), card };
    return { nome, socio, adm, card, id: Number(id), ctx };
  } catch (err) {
    falhouJornada(res, 'posse falhou', err, true);
    return null;
  }
}

/** O limite de IA só conta quando a IA vai ser chamada. Subir comprovante sem leitura não gasta os 10 por minuto. */
export function limiteSeForLer(req: Request, res: Response, next: NextFunction): void {
  if ((req.body as { ler?: unknown } | null | undefined)?.ler === true) { aiLimiter(req, res, next); return; }
  next();
}

export const corpoDe = (req: Request): Record<string, unknown> | null => {
  const b = req.body === undefined || req.body === null ? {} : req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};
