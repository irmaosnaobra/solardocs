// Peças compartilhadas pelas rotas do Portal do Parceiro NEXUS (geradorNexus, geradorNexusRede, geradorNexusEquipe).

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import {
  ErroBanco, Linha, entradaDoNivel, lerCompany, lerParceiro, marcarPortalAusente, portalLigado, tabelaAusente,
} from '../services/nexus/repositorio';
import { calcularNivel, Libera, Nivel } from '../services/nexus/niveis';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DIA_MS = 24 * 60 * 60 * 1000;
const POR_PAGINA = 1000; // o PostgREST corta em 1000 linhas e ignora .limit() maior
const MAX_PAGINAS = 30;

export function responderErro(res: Response, e: unknown, rota: string): void {
  if (e instanceof ErroBanco && tabelaAusente(e.causa)) {
    marcarPortalAusente();
    res.status(503).json({ erro: 'portal_desligado' });
    return;
  }
  logger.error('nexus', `${rota} falhou`, e);
  res.status(500).json({ erro: 'erro_interno' });
}

type Manipulador = (req: Request, res: Response) => Promise<void>;
export const rota = (nome: string, fn: Manipulador) => async (req: Request, res: Response): Promise<void> => {
  try {
    await fn(req, res);
  } catch (e) {
    responderErro(res, e, nome);
  }
};

/** 503 `portal_desligado` enquanto as 6 tabelas não existem (sonda com cache de 60 s). */
export async function exigePortalLigado(_req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!(await portalLigado())) {
    res.status(503).json({ erro: 'portal_desligado' });
    return;
  }
  next();
}

/** Lança ErroBanco se a resposta do supabase veio com erro. */
export function ok<T extends { error: unknown }>(r: T, contexto: string): T {
  if (r.error) throw new ErroBanco(r.error as { code?: string; message?: string }, contexto);
  return r;
}

/** Lê todas as páginas de 1000 em 1000 (o PostgREST ignora .limit() acima disso). */
export async function lerTudo(
  contexto: string,
  pagina: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<Linha[]> {
  const todas: Linha[] = [];
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const r = ok(await pagina(i * POR_PAGINA, i * POR_PAGINA + POR_PAGINA - 1), contexto);
    const linhas = (r.data as Linha[] | null) ?? [];
    todas.push(...linhas);
    if (linhas.length < POR_PAGINA) break;
  }
  return todas;
}

export const lotes = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Parceiro + empresa + nível já calculados, para as rotas que dependem do que está liberado. Null = conta sem parceiro. */
export async function contexto(userId: string): Promise<{ parceiro: Linha; company: Linha | null; libera: Libera; nivel: Nivel } | null> {
  const [parceiro, company] = await Promise.all([lerParceiro(userId), lerCompany(userId)]);
  if (!parceiro) return null;
  const { libera, nivel } = calcularNivel(entradaDoNivel(parceiro, company));
  return { parceiro, company, libera, nivel };
}

/** Texto livre do corpo: corta no limite e devolve null se ficar vazio. */
export function textoLivre(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s === '' ? null : s;
}
