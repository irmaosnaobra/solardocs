import { Router, Request, Response, RequestHandler } from 'express';
import { leituraAtualDaPlanilha, leituraDaPlanilhaEmCache, leituraDaPlanilhaDoCache } from './geradorClientes';
import { credenciaisTrello } from '../services/gerador/dossieVenda';
import { TRELLO_BOARD_ID } from '../services/insightsService';
import { segredoDoVinculo } from '../services/gerador/vendaSolarHub';
import {
  alocarCodigoSolar, previaDoCodigoSolar, MSG_SEM_PLANILHA, type DepsAlocador, type MotivoErroAlocador,
} from '../services/gerador/vendaSolarCodigo';
import type { GuardaDoCard } from './geradorVendaSolarTrello';

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTE NA PLANILHA PELO CARD VENDIDO (fase 2, 22/10/2026). Montada dentro de /gerador, de dentro de `mountVendaSolar`, com a
// MESMA base (consultor logado, `Cache-Control: no-store`) e a MESMA guarda (`acessoVendaSolar`: card solar `fechou` e dono;
// inexistente, de eletroposto, não vendido e alheio respondem IGUAL, 404).
//
//   POST /gerador/vendas-solares/:card/cliente   { previa?: boolean, novo?: boolean }
//        Dá o `#NNNN` do cliente (o alocador único do servidor, `vendaSolarCodigo.ts`), ou devolve o que o card já tem.
//        -> 200 { ok, acao: 'criou' | 'adotou_trello' | 'ja_ligada', criou, codigo, aviso?, mesmoTelefone? }
//        -> 200 previa: { ok, previa: true, acao, codigo?, provisorio?, candidatos?, ocultas?, aviso?, mesmoTelefone? } (não escreve)
//        -> 409 { precisa: 'confirmar', candidatos: [{ codigo, cliente, data, motivo }], ocultas }   (sem `novo`)
//        `novo: true` pula o portão de telefone e do cartão: é o que o gancho do VENDIDO e "Criar novo mesmo assim" mandam.
//
// Telefone NUNCA liga nada: só pergunta (portão) ou avisa (códigos que quem pede pode ver e a contagem dos outros). Nenhum GET
// aloca. Nada de valor pessoal em log nem na resposta além do que quem pede já enxerga.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_PEDIDO = 'Pedido inválido.';
const MSG_GRAVAR = 'Não consegui gravar agora. Tente de novo.';
const MSG_CREDENCIAL = 'Trello sem credencial de escrita. Gere key e token em trello.com/power-ups/admin e configure TRELLO_KEY e TRELLO_TOKEN na Vercel.';
const MSG_CONFIRMAR = 'Esta venda pode já estar na planilha. Ligue a venda certa ou crie o cliente novo mesmo assim.';

const logErro = (que: string, codigo: string): void => console.error(`[venda-solar-cliente] ${que}`, codigo);

/**
 * As dependências do alocador: credencial e quadro do Trello, e a planilha mãe lida AGORA. `emCache` só para a PRÉVIA do cartão do
 * Trello (não escreve, número provisório): ela lê a planilha do cache, como na fase 1.
 */
export function dependenciasDoAlocador(emCache = false): DepsAlocador {
  return {
    credenciais: credenciaisTrello(),
    board: String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID,
    lerPlanilhaAtual: emCache ? leituraDaPlanilhaEmCache : leituraAtualDaPlanilha,
    ...(emCache ? {} : { lerPlanilhaCopia: leituraDaPlanilhaDoCache }),
  };
}

/** A resposta de cada erro do alocador (comum à rota do cliente). */
function responderErro(res: Response, motivo: MotivoErroAlocador): void {
  logErro('alocador', motivo);
  switch (motivo) {
    case 'ocupado':
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando agora. Tente de novo.' });
      return;
    case 'trello':
      res.status(502).json({ ok: false, error: 'Não consegui conferir o quadro do Trello agora. Nada foi criado. Tente de novo em instantes.' });
      return;
    case 'trello_grande':
      res.status(502).json({ ok: false, error: 'O quadro tem cards demais para conferir a numeração com segurança. Avise o suporte.' });
      return;
    case 'lento':
      res.status(502).json({ ok: false, error: 'O Trello está lento agora. Nada foi criado. Tente de novo em instantes.' });
      return;
    case 'sem_credencial':
      res.status(503).json({ ok: false, precisa: 'credencial', error: MSG_CREDENCIAL });
      return;
    case 'sequencia':
      res.status(500).json({ ok: false, error: 'A numeração passou de #9999. Avise o suporte.' });
      return;
    default:   // sem_segredo e banco
      res.status(503).json({ ok: false, error: MSG_GRAVAR });
  }
}

export function mountVendaSolarCliente(router: Router, base: RequestHandler[], guarda: GuardaDoCard): void {
  router.post('/vendas-solares/:card/cliente', ...base, async (req: Request, res: Response) => {
    const inicio = Date.now();
    const g = await guarda(req, res);
    if (!g) return;
    const b = req.body === undefined || req.body === null ? {} : req.body;
    if (typeof b !== 'object' || Array.isArray(b)
      || (b.previa !== undefined && typeof b.previa !== 'boolean')
      || (b.novo !== undefined && typeof b.novo !== 'boolean')) {
      res.status(400).json({ ok: false, error: MSG_PEDIDO });
      return;
    }
    const previa = b.previa === true;
    const novo = b.novo === true;
    if (!segredoDoVinculo()) { logErro('sem segredo para assinar', 'sem_segredo'); res.status(503).json({ ok: false, error: MSG_GRAVAR }); return; }
    const deps = dependenciasDoAlocador();
    if (!deps.credenciais) { res.status(503).json({ ok: false, precisa: 'credencial', error: MSG_CREDENCIAL }); return; }
    const pedido = { card: g.card, quem: { nome: g.nome, socio: g.socio }, novo, inicio };

    if (previa) {
      const r = await previaDoCodigoSolar(pedido, deps);
      if (!r.ok) { responderErro(res, r.motivo); return; }
      res.json({ ...r, previa: true });
      return;
    }
    const r = await alocarCodigoSolar(pedido, deps);
    if (r.ok) {
      res.json({
        ok: true, acao: r.acao, criou: r.acao === 'criou' || r.acao === 'adotou_trello', codigo: r.codigo,
        ...(r.aviso ? { aviso: r.aviso } : {}), ...(r.mesmoTelefone ? { mesmoTelefone: r.mesmoTelefone } : {}),
        ...(r.planilhaFora ? { planilhaFora: true } : {}),
      });
      return;
    }
    if (r.motivo === 'confirmar') {
      res.status(409).json({
        ok: false, precisa: 'confirmar', error: r.semPlanilha ? MSG_SEM_PLANILHA : MSG_CONFIRMAR, candidatos: r.candidatos, ocultas: r.ocultas,
        ...(r.semPlanilha ? { semPlanilha: true } : {}),
      });
      return;
    }
    responderErro(res, r.motivo);
  });
}
