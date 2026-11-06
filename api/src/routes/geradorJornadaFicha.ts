import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { semCache, lerDocs } from './geradorClientesDocs';
import { acessoVendaSolar } from './geradorClientes';
import { falhouJornada, guardaDaObra, logErroJornada, quem, MSG_NAO_ACHEI, MSG_PEDIDO } from './geradorJornadaGuarda';
import { lerDinheiro } from './geradorJornadaDinheiro';
import { arquivosDaPlanilha, linhaDaPlanilha, RE_CODIGO_PROPOSTA } from './geradorJornadaSolar';
import { supabaseGerador } from '../utils/supabaseGerador';
import { lerCadastroVisto } from '../services/gerador/cadastroVenda';
import { lerPrivadoJornada } from '../services/gerador/jornadaSolarBanco';
import { lerProposta } from '../services/gerador/dossieVenda';
import { dadosDaPlanilha } from '../services/gerador/jornadaFinalizada';
import { assinarVarios } from '../services/gerador/docsClienteBanco';
import { lerTodasLigacoes } from '../services/gerador/vendaSolarHub';
import { formaDoEspelho, montarFicha, ROTULO_FONTE, type EntradaFicha } from '../services/gerador/jornadaFicha';

// ─────────────────────────────────────────────────────────────────────────────
// A FICHA CONSOLIDADA DA VENDA SOLAR (06/11/2026). Só LEITURA: nada aqui grava, nada chama modelo de IA, nada lê o quadro do Trello.
//   GET /jornada-solar/obra/:card/ficha        cada campo com { valor, fonte } e as sugestões de cada formulário (só para o que está vazio)
//   GET /jornada-solar/proposta/:codigo/venda  para o modal antigo do Histórico: só valor e forma da obra (nunca a nota)
// A guarda é a da obra (`guardaDaObra`). Cada fonte é filtrada ANTES de juntar: planilha por `dadosDaPlanilha`, dinheiro do livro por `veDinheiro`.
// Nenhum log leva nome, telefone, valor ou texto.
// ─────────────────────────────────────────────────────────────────────────────

async function colunasDaVenda(codigo: string): Promise<EntradaFicha['propostaVenda']> {
  const { data, error } = await supabaseGerador.from('propostas').select('vendido, valor_vendido, forma_pagamento, obs_venda, tipo').eq('codigo', codigo).maybeSingle();
  if (error) throw new Error('propostas');
  const r = data as { vendido?: unknown; valor_vendido?: unknown; forma_pagamento?: unknown; obs_venda?: unknown; tipo?: unknown } | null;
  if (!r || String(r.tipo ?? 'solar').toLowerCase() === 'eletroposto') return null;
  const n = Number(r.valor_vendido);
  return {
    vendido: r.vendido === true, valor_vendido: Number.isFinite(n) && n > 0 ? n : null,
    forma_pagamento: typeof r.forma_pagamento === 'string' ? r.forma_pagamento : null, obs_venda: typeof r.obs_venda === 'string' ? r.obs_venda : null,
  };
}

async function rotaFicha(req: Request, res: Response): Promise<void> {
  const g = await guardaDaObra(req, res);
  if (!g) return;
  try {
    const d = await lerDinheiro(g);
    const lig = d.lig;
    const [privado, cad, docs, prop, pv, pl, arqPl] = await Promise.all([
      lerPrivadoJornada(g.id).catch((e) => { logErroJornada('ficha privado', e); return null; }),
      lerCadastroVisto(g.id, 'vendasolar'),
      lerDocs(g.ctx),
      lig.proposta ? lerProposta(lig.proposta).catch((e) => { logErroJornada('ficha proposta', e); return null; }) : Promise.resolve(null),
      lig.proposta ? colunasDaVenda(lig.proposta).catch((e) => { logErroJornada('ficha colunas', e); return null; }) : Promise.resolve(null),
      linhaDaPlanilha(lig.venda),
      arquivosDaPlanilha(g.ctx, lig.venda),
    ]);
    // A planilha: só o que a pessoa já vê na Planilha de clientes (a linha pelo `podeVer`, o dinheiro só para sócio).
    const vista = pl.achou ? dadosDaPlanilha(pl.achou.bruta, pl.achou.m, g.nome) : null;
    const veValor = !!vista && vista.campos.some((c) => c.chave === 'valor_vendido');
    const urls = vista && arqPl.length
      ? await assinarVarios(arqPl.map((a) => a.caminho), 3600).catch(() => new Map<string, string>())
      : new Map<string, string>();
    const entrada: EntradaFicha = {
      quem: { nome: g.nome, socio: g.socio, adm: g.adm, veDinheiro: d.veDinheiro },
      card: { cliente: String(g.card.cliente_nome ?? ''), telefone: String(g.card.cliente_telefone ?? ''), cidade: String(g.card.cidade ?? ''), vendedor: d.vendedor },
      lig: { proposta: lig.proposta, venda: lig.venda, trello_card: lig.trello_card ?? null },
      estado: d.js, privado, obra: d.privada, cad,
      fotos: docs.reg.arquivos.map((a) => ({ slot: a.slot, em: a.em, por: a.por })),
      proposta: prop ? {
        dados: prop.dados, qtd_placas: prop.qtd_placas, inversor: prop.inversor, qtd_inversor: prop.qtd_inversor, cliente_uf: prop.cliente_uf,
        dossie: { campos: prop.dossie.campos, trello: { card_id: prop.dossie.trello.card_id, card_url: prop.dossie.trello.card_url ?? null } },
      } : null,
      propostaVenda: pv,
      planilha: vista ? {
        campos: vista.campos.map((c) => ({ chave: c.chave, valor: c.valor })),
        valorVendaCentavos: veValor && pl.achou && pl.achou.m.valores.venda > 0 ? Math.round(pl.achou.m.valores.venda * 100) : null,
      } : null,
      entradas: d.veDinheiro
        ? d.livro.linhas.filter((l) => l.tipo === 'entrada' && !l.estornada && !l.estorno_de && !l.devolucao).map((l) => ({ forma: l.forma, valor_centavos: l.valor_centavos }))
        : null,
      // Quem não vê a linha da planilha não recebe nem a presença do arquivo (o portão da etapa 1 segue contando o slot por dentro).
      docsPlanilha: vista ? arqPl.map((a) => ({ slot: a.slot, em: a.em, url: urls.get(a.caminho) ?? null })) : [],
    };
    res.json({ ok: true, card: g.id, ficha: montarFicha(entrada) });
  } catch (err) {
    falhouJornada(res, 'ficha', err, true);
  }
}

async function rotaVendaDaProposta(req: Request, res: Response): Promise<void> {
  const { nome, socio } = quem(req);
  const codigo = String(req.params.codigo ?? '').trim();
  if (!RE_CODIGO_PROPOSTA.test(codigo)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  try {
    const ligs = await lerTodasLigacoes();
    const ids = [...ligs].filter(([, l]) => String(l.proposta ?? '') === codigo).map(([id]) => id);
    // Proposta em nenhum card, ou em dois, não escolhe obra: 404, igual a alheia.
    const card = ids.length === 1 ? await acessoVendaSolar(nome, socio, ids[0]) : null;
    if (!card) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }
    const v = (await lerPrivadoJornada(ids[0]))?.venda ?? null;
    // Só valor e forma (as duas que o PUT /venda já espelha na proposta). A nota é do JSON privado e NUNCA sai daqui.
    res.json({
      ok: true, card: ids[0],
      venda: v && v.valor_centavos > 0 ? { valor_centavos: v.valor_centavos, forma: formaDoEspelho(v.pagamento.map((x) => x.forma)), fonte: 'obra', rotulo: ROTULO_FONTE.obra } : null,
    });
  } catch (err) {
    falhouJornada(res, 'venda da proposta', err, true);
  }
}

export function mountJornadaFicha(router: Router): void {
  const base = [exigeConsultor, semCache];
  router.get('/jornada-solar/obra/:card/ficha', ...base, rotaFicha);
  router.get('/jornada-solar/proposta/:codigo/venda', ...base, rotaVendaDaProposta);
}
