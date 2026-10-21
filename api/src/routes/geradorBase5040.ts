import { Router, Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { logger } from '../utils/logger';
import { listarBase, type ProdutoBase } from '../services/agentes5040/base';

// ─────────────────────────────────────────────────────────────────────────────
// A COLUNA "BASE" DO CRM (B4a). Montado dentro de /gerador. SÓ LEITURA: nada aqui envia mensagem.
//
//   GET /gerador/base-5040?produto=solar|eletroposto
//     200 { ok, produto, itens: [{ cardId|null, etapa, dona, nome, telefone, cidade, desde, ultima_fala_em, volta_em }], cortou? }
//
// As posses da Duda (solar) ou da Helena (eletroposto) que ainda NÃO estão com o consultor (sem card agendado do produto, ou card
// cancelado/nao_atendeu). `etapa`: chegou | em_conversa | sem_resposta | estacionado (regras em services/agentes5040/base.ts).
// `cortou: true` = a lista de posses passou do teto de páginas e veio incompleta.
//
// A resposta leva nome e telefone de lead, e o repositório é público: ao contrário de `/apalavrado`, aqui exige consultor logado
// (`exigeConsultor`, a mesma pilha do dossiê e da caixa) e a resposta nunca vai para cache. Erro vira mensagem genérica; o log leva
// só o código, nunca telefone.
// ─────────────────────────────────────────────────────────────────────────────

const LOG = 'gerador-base-5040';
const PRODUTOS: readonly ProdutoBase[] = ['solar', 'eletroposto'];

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

export function mountBase5040(router: Router): void {
  router.get('/base-5040', semCache, exigeConsultor, async (req: Request, res: Response) => {
    const produto = String(req.query.produto ?? '').trim().toLowerCase();
    if (!(PRODUTOS as readonly string[]).includes(produto)) {
      res.status(400).json({ ok: false, error: 'Produto inválido. Use solar ou eletroposto.' });
      return;
    }
    try {
      const r = await listarBase(produto as ProdutoBase);
      res.json({ ok: true, produto, itens: r.itens, ...(r.cortou ? { cortou: true } : {}) });
    } catch (err: unknown) {
      const codigo = String((err as { codigo?: string; code?: string } | null)?.codigo ?? (err as { code?: string } | null)?.code ?? 'interno').slice(0, 20);
      logger.error(LOG, 'leitura falhou', { codigo });
      res.status(500).json({ ok: false, error: 'Não consegui ler a base agora.' });
    }
  });
}
