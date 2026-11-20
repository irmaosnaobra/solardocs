import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { semCache } from './geradorClientesDocs';
import { corpoDe, falhouJornada, guardaDaObra, type GuardaObra } from './geradorJornadaGuarda';
import {
  contratoDe, equipPropostaDe, lerFase2, prepararEscrita, vCad, type Fase2,
} from './geradorJornadaObra';
import { finalDoComissionamento } from './geradorJornadaObraEtapas';
import { comTrava } from '../services/gerador/cadastroVendaBanco';
import { podeConcluir } from '../services/gerador/jornadaSolar';
import { ehRecusa } from '../services/gerador/jornadaSolarBanco';
import { mudarObra, obraVazia } from '../services/gerador/jornadaObraBanco';
import { aplicarPortoes } from '../services/gerador/obraPortoes';
import { concluirComissionamento } from '../services/gerador/comissionamento';
import { equipamentoFinal } from '../services/gerador/equipamentoFinal';
import { colunasDaPlanilha, listaParaCopiar } from '../services/gerador/planilhaContratos';
import { enviarParaPlanilha, type ResultadoPlanilha } from '../services/gerador/planilhaEnvio';
import { podeVerValorDaObra } from '../services/gerador/jornadaDinheiro';

// ─────────────────────────────────────────────────────────────────────────────
// O COMISSIONAMENTO (19/11/2026): as etapas 7 e 8 numa aba só, com o botão final. Montada dentro de /gerador por `mountJornadaComissionamento`.
//
//   POST /jornada-solar/obra/:card/comissionamento/concluir   "Concluir e preencher a planilha": conclui a 7 e a 8, fecha a conta e tenta a planilha
//   POST /jornada-solar/obra/:card/planilha                   tenta a planilha de novo (obra já concluída), sem mexer em mais nada
//
// Quem pode: quem hoje conclui a etapa 8 (`podeConcluir`). Portão: tudo obrigatório das etapas 7 e 8 que ainda não estavam concluídas, mais o
// fechamento (todo material comprado, a receber e a pagar zerados, comprovantes pela regra do livro, avarias resolvidas). A planilha NUNCA desfaz a
// conclusão: falhou, a resposta traz o status e a lista "Coluna: valor" para colar à mão. Valor e forma de pagamento só vão à lista de quem vê o valor da venda.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_FECHADA = 'A conta desta obra está fechada. Só o Thiago reabre.';

/** A planilha desta obra: tenta o Apps Script e monta a lista para a tela (sem dinheiro para quem não vê o valor da venda). Nunca lança. */
export async function planilhaDaObra(g: GuardaObra, f: Fase2): Promise<{ resultado: ResultadoPlanilha; colunas: Array<{ coluna: string; rotulo: string; texto: string }>; aviso: string }> {
  const venda = f.vendaPrivada?.venda ?? null;
  const v = vCad(f);
  const c = contratoDe(f);
  const colunas = colunasDaPlanilha({
    codigo: f.din.lig.venda ?? null,
    titularConta: v('titular_conta'), telefone: String(g.card.cliente_telefone ?? ''),
    endereco: c.endereco_instalacao, cidade: c.cidade, uf: c.uf, concessionaria: v('concessionaria'),
    valorCentavos: venda && venda.valor_centavos > 0 ? venda.valor_centavos : null, formasDePagamento: (venda?.pagamento ?? []).map((x) => x.forma),
    equip: equipamentoFinal(f.privada.compra.itens, equipPropostaDe(f), f.privada.compra.documentos, f.privada.entrega.monitoramento.serie), excedente: f.js?.etapas[1].excedente === 'sim',
    liberadaEm: f.privada.liberacao.passos.liberada?.data ?? null,
  });
  const resultado = await enviarParaPlanilha(f.din.lig.venda ?? null, colunas);
  const veValor = podeVerValorDaObra(g, f.din.ajustes, !!f.vend && g.nome === f.vend);
  const aviso = resultado.status === 'nao_ligada' ? 'Planilha automática ainda não ligada.'
    : resultado.status === 'falhou' ? 'Não consegui preencher a planilha agora. Tente de novo ou cole à mão.'
      : resultado.status === 'nada_a_gravar' ? 'A linha da planilha já estava preenchida.' : '';
  return { resultado, colunas: listaParaCopiar(colunas, veValor), aviso };
}

export function mountJornadaComissionamento(router: Router): void {
  const base = [exigeConsultor, semCache];

  // ── O botão final ───────────────────────────────────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/comissionamento/concluir', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    if (corpoDe(req) === null) { res.status(400).json({ ok: false, error: 'Pedido inválido.' }); return; }
    // O "tudo em zero" é calculado DENTRO da trava da conta: nenhum lançamento entra entre a conferência e o fechamento.
    const feito: { f?: Fase2; fechada?: { em: string; por: string } | null } = {};
    const corpo = async (): Promise<void> => {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: 'Venda cancelada.' }); return; }
      if (f.din.fechada) { res.status(409).json({ ok: false, error: MSG_FECHADA }); return; }
      const fin = finalDoComissionamento(g, f);
      if (!fin.aberta) { res.status(409).json({ ok: false, error: 'Esta obra ainda não está no Comissionamento.' }); return; }
      if (!podeConcluir(g.nome, 8, f.vend)) { res.status(403).json({ ok: false, error: 'Só o dono conclui a etapa.' }); return; }
      if (fin.falta.length) {
        res.status(409).json({
          ok: false, precisa: 'itens', falta: fin.falta.map((i) => ({ chave: i.chave, texto: i.texto, grupo: i.grupo })),
          error: `Falta ${fin.falta.length} ${fin.falta.length === 1 ? 'item' : 'itens'}: ${fin.falta.map((i) => i.texto).join(', ')}.`,
        }); return;
      }
      await prepararEscrita(g, f);
      const agora = new Date().toISOString();
      const r = await mudarObra(g.id, () => obraVazia(g.id), (e0) => {
        const e = aplicarPortoes(e0, { privada: f.privada, docsIds: f.docsIds, slots: f.slotsMap }, agora, 'leitura');
        return concluirComissionamento(e, g.nome, agora);
      });
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
      feito.fechada = r.fechada;
      feito.f = f;
    };
    try {
      await comTrava(`fin_conta:${g.id}`, g.nome, corpo);
      if (res.headersSent || !feito.f) return;
      // A conta já está fechada e a obra concluída: a planilha vem DEPOIS e a falha dela só vira status.
      let planilha: Awaited<ReturnType<typeof planilhaDaObra>>;
      try { planilha = await planilhaDaObra(g, feito.f); }
      catch { planilha = { resultado: { status: 'falhou', linha: null, gravadas: [], puladas: [], motivo: 'interno' }, colunas: [], aviso: 'Não consegui preencher a planilha agora. Tente de novo ou cole à mão.' }; }
      res.json({ ok: true, etapa_atual: 9, fechada: feito.fechada ?? null, planilha: { ...planilha.resultado, colunas: planilha.colunas, aviso: planilha.aviso } });
    } catch (err) { if (!res.headersSent) falhouJornada(res, 'comissionamento-concluir', err); }
  });

  // ── Tenta a planilha de novo ──────────────────────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/planilha', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    try {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: 'Venda cancelada.' }); return; }
      if (!f.jo?.etapas[8].concluida_em) { res.status(409).json({ ok: false, error: 'A obra ainda não foi concluída.' }); return; }
      if (!podeConcluir(g.nome, 8, f.vend)) { res.status(403).json({ ok: false, error: 'Só o dono conclui a etapa.' }); return; }
      const p = await planilhaDaObra(g, f);
      res.json({ ok: true, planilha: { ...p.resultado, colunas: p.colunas, aviso: p.aviso } });
    } catch (err) { if (!res.headersSent) falhouJornada(res, 'planilha', err); }
  });
}
