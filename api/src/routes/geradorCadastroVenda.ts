import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { contexto, lerDocs, semCache } from './geradorClientesDocs';
import { cadastroLeituraLimiter } from '../middleware/rateLimiter';
import { garantirBucketDocs } from '../services/gerador/docsClienteBanco';
import { ErroCadastro } from '../services/gerador/cadastroVendaBanco';
import {
  ehCampo, validarCampo, lerCadastroVisto, escreverCadastro, vistaDe, type Fonte,
} from '../services/gerador/cadastroVenda';
import { lerDocumentosDaVenda } from '../services/gerador/cadastroVendaLeitura';

// ─────────────────────────────────────────────────────────────────────────────
// CADASTRO DA VENDA do eletroposto (um por card vendido) e leitura dos documentos por IA. Montadas dentro de /gerador.
//
//   GET  /gerador/clientes/eletroposto/:codigo/cadastro        campos, o que falta e o tipo (PF ou PJ)
//   PUT  /gerador/clientes/eletroposto/:codigo/cadastro        { campos: { campo: texto }, fonte?: 'ia'|'manual' }
//        (a primeira escrita migra o legado da ficha para o cadastro; veja `escreverCadastro`)
//   POST /gerador/clientes/eletroposto/:codigo/cadastro/ler    a IA lê os documentos já anexados e SUGERE (não grava)
//
// A guarda é a MESMA dos documentos (`contexto`): consultor só vê venda dele, sócio vê todas, só card vendido; venda
// inexistente e alheia respondem IGUAL (404). O cadastro mora só no bucket privado `cadastros-venda` (nunca em
// `system_state`); falha dele derruba só estas rotas (503), nunca os documentos.
//
// Nunca se loga valor de campo: só o código do erro.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_PEDIDO = 'Pedido inválido.';

const logErro = (que: string, err: unknown): void =>
  console.error(`[cadastro-venda] ${que}`, err instanceof ErroCadastro ? err.codigo : (err as { codigo?: unknown } | null)?.codigo ?? 'interno');

const corpoDe = (req: Request): Record<string, unknown> | null => {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};

/** Só o cadastro cai (503); documentos e ficha seguem. Trava ocupada leva `ocupado: true`: vale tentar de novo já. */
const indisponivel = (res: Response, err?: unknown): void => {
  const ocupado = err instanceof ErroCadastro && err.codigo === 'ocupado';
  res.status(503).json({ ok: false, motivo: 'cadastro_indisponivel', ...(ocupado ? { ocupado: true } : {}) });
};

export function mountCadastroVenda(router: Router): void {
  const base = [exigeConsultor, semCache];

  // ── Ler ────────────────────────────────────────────────────────────────────
  router.get('/clientes/eletroposto/:codigo/cadastro', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res, 'eletroposto');
    if (!ctx) return;
    try {
      // Enquanto a primeira escrita não migrou, o legado da ficha aparece aqui (fonte 'ficha'): ficha e contrato não discordam.
      res.json({ ok: true, cadastro: vistaDe(await lerCadastroVisto(Number(ctx.codigo))) });
    } catch (err) {
      logErro('leitura falhou', err);
      indisponivel(res);
    }
  });

  // ── Gravar (quem grava é a pessoa; `fonte: 'ia'` diz que ela aceitou uma sugestão) ──
  router.put('/clientes/eletroposto/:codigo/cadastro', ...base, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res, 'eletroposto');
    if (!ctx) return;
    const b = corpoDe(req);
    const campos = b && b.campos && typeof b.campos === 'object' && !Array.isArray(b.campos) ? (b.campos as Record<string, unknown>) : null;
    const fonte = b?.fonte === undefined ? 'manual' : b.fonte;
    if (!campos || Object.keys(campos).length === 0 || (fonte !== 'manual' && fonte !== 'ia')) {
      res.status(400).json({ ok: false, error: MSG_PEDIDO });
      return;
    }
    // Valida TUDO antes de gravar qualquer coisa: com um erro, nada é gravado.
    const erros: Record<string, string> = {};
    const limpos: Record<string, string> = {};
    for (const [k, v] of Object.entries(campos)) {
      if (!ehCampo(k)) { erros[k.slice(0, 40)] = 'Campo desconhecido.'; continue; }
      const r = validarCampo(k, v);
      if (r.ok) limpos[k] = r.valor; else erros[k] = r.erro;
    }
    if (Object.keys(erros).length) { res.status(400).json({ ok: false, erros }); return; }
    try {
      const r = await escreverCadastro(Number(ctx.codigo), limpos, ctx.nome, fonte as Fonte);
      res.json({
        ok: true, cadastro: vistaDe(r.cad),
        ...(r.limpou ? {} : { aviso: 'Salvo. A limpeza do registro antigo da ficha fica para a próxima gravação.' }),
      });
    } catch (err) {
      logErro('gravar falhou', err);
      indisponivel(res, err);
    }
  });

  // ── Ler os documentos com IA (só sugere) ───────────────────────────────────
  // O limitador vem DEPOIS do login (a chave é o e-mail do consultor) e ANTES da guarda: quem chega aqui já está logado.
  router.post('/clientes/eletroposto/:codigo/cadastro/ler', exigeConsultor, cadastroLeituraLimiter, semCache, async (req: Request, res: Response) => {
    const ctx = await contexto(req, res, 'eletroposto');
    if (!ctx) return;
    try {
      await garantirBucketDocs();
      const { reg } = await lerDocs(ctx);
      const r = await lerDocumentosDaVenda(reg.arquivos);
      if (r.ok) {
        res.json({ ok: true, sugestoes: r.sugestoes, lidos: r.lidos, ignorados: r.ignorados });
      } else if (r.motivo === 'sem_documentos') {
        res.status(409).json({ ok: false, motivo: 'sem_documentos', ignorados: r.ignorados });
      } else if (r.motivo === 'armazenamento') {
        indisponivel(res);
      } else {
        res.status(502).json({ ok: false, motivo: 'ia_indisponivel' });
      }
    } catch (err) {
      logErro('leitura por IA falhou', err);
      // Metadado ou bucket fora do ar: não dá nem para saber quais documentos existem.
      res.status(503).json({ ok: false, motivo: 'cadastro_indisponivel' });
    }
  });
}
