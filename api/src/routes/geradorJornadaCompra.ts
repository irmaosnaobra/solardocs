import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { semCache } from './geradorClientesDocs';
import { aiLimiter } from '../middleware/rateLimiter';
import { corpoDe, falhouJornada, guardaDaObra, MSG_PEDIDO } from './geradorJornadaGuarda';
import { ondeEsta } from './geradorJornadaDinheiro';
import { corpoFase2, fraseNotaRepetida, lerFase2, podeSecao, prepararEscrita } from './geradorJornadaObra';
import { sincronizarPortoes } from '../services/gerador/obraSincronia';
import { comTrava } from '../services/gerador/cadastroVendaBanco';
import { lerEGravarArquivoDaCompra } from '../services/gerador/compraLeituraIo';

// ─────────────────────────────────────────────────────────────────────────────
// A COMPRA LIDA SOZINHA (19/11/2026). Montada dentro de /gerador por `mountJornadaCompra`.
//
//   POST /jornada-solar/obra/:card/compra/arquivo     { base64, media_type, nome? }   UM arquivo (foto, PDF, imagem ou XML); vários = vários pedidos
//
// Sem botão "Ler" e sem diálogo "Usar os itens": o servidor lê no envio e grava direto em `compra.itens` (só campo vazio; nota e pedido marcam
// comprado; orçamento só preenche fornecedor e valor orçado). A resposta é a mesma do GET `.../fase2` mais `leitura_compra` (o que aconteceu com ESTE arquivo).
// Valor de dinheiro só sai para quem vê o livro da obra (a mesma máscara do GET). Nada de nome, texto ou valor em log.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_FECHADA = 'A conta desta obra está fechada. Só o Thiago reabre.';

export function mountJornadaCompra(router: Router): void {
  const base = [exigeConsultor, semCache];

  router.post('/jornada-solar/obra/:card/compra/arquivo', ...base, aiLimiter, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    if (!b || typeof b.base64 !== 'string' || !b.base64 || typeof b.media_type !== 'string' || (b.nome !== undefined && typeof b.nome !== 'string')) {
      res.status(400).json({ ok: false, error: MSG_PEDIDO }); return;
    }
    try {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: 'Venda cancelada.' }); return; }
      if (f.din.fechada) { res.status(409).json({ ok: false, error: MSG_FECHADA }); return; }
      if (!podeSecao(g, f, 'compra')) { res.status(403).json({ ok: false, error: 'Você não pode mexer nesta parte agora.' }); return; }
      await prepararEscrita(g, f);
      const s = await lerEGravarArquivoDaCompra({ id: g.id, nome: g.nome }, { base64: b.base64, media_type: b.media_type, nome: b.nome });
      if (s.resultado === 'erro') {
        if (s.error === 'nota_repetida' && s.dono) {
          const onde = await ondeEsta(g, s.dono);
          res.status(s.http).json({ ok: false, error: 'nota_repetida', onde, mensagem: fraseNotaRepetida(onde) }); return;
        }
        res.status(s.http).json({ ok: false, error: s.error, mensagem: s.mensagem }); return;
      }
      // O que o arquivo mudou pode abrir a Logística: o portão é conferido na mesma hora (idempotente).
      if (s.resultado === 'lido') {
        await comTrava(`fin_conta:${g.id}`, g.nome, async () => { const f2 = await lerFase2(g); await sincronizarPortoes(g, f2, f2.privada, f.privada); });
      }
      const leitura = s.resultado === 'lido'
        ? {
          resultado: 'lido' as const, leitura: s.leitura, tipo: s.resumo.tipo, fornecedor: s.fornecedor, numero: s.numero, data: s.data,
          novos: s.resumo.novos, atualizados: s.resumo.atualizados, marcados_comprados: s.resumo.marcados_comprados, compra_id: s.resumo.compra_id, documento_id: s.resumo.documento_id,
        }
        : { resultado: s.resultado, mensagem: s.mensagem };
      res.json(await corpoFase2(g, { leitura_compra: leitura }));
    } catch (err) { if (!res.headersSent) falhouJornada(res, 'compra-arquivo', err); }
  });
}
