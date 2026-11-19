import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { semCache } from './geradorClientesDocs';
import { falhouJornada, guardaDaObra } from './geradorJornadaGuarda';
import { aiLimiter } from '../middleware/rateLimiter';
import { lerTudoDaVenda } from '../services/gerador/cadastroLeituraAuto';
import { podeLerTudo } from '../services/gerador/leituraGravacao';
import { lerJornadaComVersao } from '../services/gerador/jornadaSolarBanco';
import { nomeSimples } from '../services/gerador/solarObras';

// ─────────────────────────────────────────────────────────────────────────────
// "LER TUDO" da obra solar (19/11/2026): POST /gerador/jornada-solar/obra/:card/ler-tudo. A IA lê de uma vez todos os documentos do card (CNH, conta
// de luz, contrato, procuração, orçamento, comprovantes) e completa o cadastro e os dados da venda (valor, pagamento, prazo e kit), SÓ no que está
// vazio. Quem pode: venda não cancelada, e o vendedor, a Giovanna ou o ADM (o mesmo `pode.ler_tudo` do GET da obra). Nada do que a IA grava conta como
// confirmado. Montada por `mountJornadaSolar` (não importa `geradorJornadaSolar.ts`: ciclo de boot em CommonJS). Nada de documento em log.
//
// Resposta: { ok: true, preenchidos: string[], ignorados: number }. `preenchidos` são os campos do cadastro (nome da chave do cadastro, como `rg_ie`)
// e as partes da venda ('valor', 'pagamento', 'prazo', 'placas', 'inversor') que a leitura gravou. `ignorados` são os arquivos que não entraram
// (não coube em 20 arquivos e 22 MB, arquivo inválido ou conteúdo de outra pessoa). Sem arquivo legível: 200 com `preenchidos: []`. Obra finalizada:
// 409 `precisa: 'finalizada'` (a guarda comum de todo POST da obra, antes de qualquer leitura). 429 na cota: 20 por hora por venda e 30 por hora por
// pessoa (as duas por hora e sob trava). 502 quando a IA não responde ou passa de 110 s.
// ─────────────────────────────────────────────────────────────────────────────

export function mountJornadaLerTudo(router: Router): void {
  router.post('/jornada-solar/obra/:card/ler-tudo', exigeConsultor, semCache, aiLimiter, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    try {
      const { estado } = await lerJornadaComVersao(g.id);
      const vendedor = nomeSimples(g.card.vendedor_nome) || estado?.vendedor || '';
      if (!podeLerTudo(g, vendedor, !!estado?.cancelada)) { res.status(403).json({ ok: false, error: 'Você não pode ler os documentos desta venda agora.' }); return; }
      const r = await lerTudoDaVenda({ card: { id: g.id, cliente_nome: g.card.cliente_nome }, nome: g.nome });
      if (r.acao === 'ok') { res.json({ ok: true, preenchidos: r.preenchidos, ignorados: r.ignorados }); return; }
      if (r.acao === 'sem_arquivo') { res.json({ ok: true, preenchidos: [], ignorados: 0 }); return; }
      if (r.acao === 'cota') { res.status(429).json({ ok: false, error: 'Já houve leituras demais desta venda na última hora. Tente de novo mais tarde.' }); return; }
      res.status(502).json({ ok: false, error: 'A leitura por IA não respondeu agora. Tente de novo.' });
    } catch (err) {
      falhouJornada(res, 'ler tudo', err);
    }
  });
}
