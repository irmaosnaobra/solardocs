import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { semCache } from './geradorClientesDocs';
import { acessoVendaSolar, vendaSolarDoDono, vendasDaPlanilha, ErroVendaSolar } from './geradorClientes';
import { ehSocio, podeVer } from '../services/gerador/solarObras';
import { normalizarNome } from '../services/gerador/dossieVenda';
import { codigoDeRota, nomesParecidos } from '../services/gerador/docsCliente';
import { ErroCadastro, comTrava } from '../services/gerador/cadastroVendaBanco';
import { mountVendaSolarTrello } from './geradorVendaSolarTrello';
import { mountVendaSolarCliente } from './geradorVendaSolarCliente';
import { lerRegistroDoCodigo } from '../services/gerador/vendaSolarRegistro';
import { ErroDocs, lerPropostaResumo } from '../services/gerador/docsClienteBanco';
import {
  ErroHub, TRAVA_VINCULOS, lerLigacao, lerTodasLigacoes, gravarLigacao, quemUsa, listarVendidasParaVinculo, compararTelefones, mesmoConsultor,
  comCacheHub, invalidarCachesHub, segredoDoVinculo, propostaDoPapel, type ForcaTelefone,
  type CandidatoProposta, type CandidatoVenda, type Ligacao,
} from '../services/gerador/vendaSolarHub';

// ─────────────────────────────────────────────────────────────────────────────
// HUB DA VENDA SOLAR (20/10/2026): o CARD VENDIDO liga a proposta (de onde vem o dossiê de homologação) e a venda da planilha
// mãe (`#NNNN`). Montadas dentro de /gerador. Exigem consultor logado e respondem `Cache-Control: no-store`.
//
//   GET  /gerador/vendas-solares/:card/vinculos
//        -> { ok, proposta, venda, por, em, sugestoes: { propostas: [{ codigo, cliente, cidade, kwp, data, motivo }],
//                                                         vendas:    [{ codigo, cliente, data, motivo }] } }
//        `motivo` é 'telefone' (últimos 8 dígitos iguais ao do card) ou 'nome' (nome parecido; só sugestão).
//        REGRA DO DONO (22/10/2026): telefone NÃO identifica cliente (família usa o mesmo número). Este GET NUNCA grava: nem venda nem
//        proposta. Quando há UM candidato por telefone, com DDD dos dois lados e do mesmo consultor, ele volta com `sugerida: true` e
//        o consultor confirma no POST. Ligações `por: 'auto'` já gravadas antes disso ficam como estão.
//   POST /gerador/vendas-solares/:card/vinculos   { proposta?: string | null, venda?: string | null, soSeVazia?: true }
//        liga (texto) ou desliga (null) cada uma; a chave ausente não mexe. -> { ok, proposta, venda, por, em }
//        `soSeVazia: true` (a confirmação de venda pela proposta): dentro da trava, se o card JÁ tem aquilo que se quer ligar, não grava e
//        responde 409. O botão manual "Ligar" não manda e segue como sempre.
//
// A guarda é a da linha `vendasolar` (`acessoVendaSolar`): card solar `fechou`; vê quem é o vendedor do card, o consultor da venda
// ligada ou sócio. Inexistente, de eletroposto, não vendido e alheio respondem IGUAL (404).
// Uma proposta só pode estar ligada a UM card, e uma venda também (conferido dentro da trava). A trava é UMA para todos os cards:
// a regra é entre cards, e uma trava por card não serializa dois cards disputando a mesma proposta.
// Quem liga uma PROPOSTA: o consultor dela (o nome dele em `consultor_nome`) ou sócio, e ela tem que estar vendida. Quem liga
// uma VENDA: quem a enxerga na planilha (o consultor efetivo dela, ou sócio). Assim ninguém dá acesso à venda de outro consultor.
//
//   POST /gerador/vendas-solares/:card/trello   monta ou atualiza o cartão do Trello (veja `geradorVendaSolarTrello.ts`)
//   POST /gerador/vendas-solares/:card/cliente  dá o `#NNNN` do cliente pelo alocador único do servidor (veja `geradorVendaSolarCliente.ts`)
//
// `venda_origem` no GET (fase 2): 'gerador' quando a venda ligada é um código que o alocador deu a ESTE card (registro assinado
// `codigo_solar:<NNNN>`), 'planilha' quando é uma venda ligada por gente; ausente sem venda. Falha ao ler o registro só tira o campo.
//
// A ligação mora em `system_state` (`venda_solar:<card>`) SEM dado pessoal. Nenhum nome, telefone ou código vai para log.
// Além de proposta e venda, ela guarda `trello_card` (o id do cartão do Trello), dentro da assinatura. Uma ligação criada só para
// guardar o cartão (`por: 'trello'`, nada ligado) é só isso: não liga proposta nem venda.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_NAO_ACHEI = 'Venda não encontrada.';
const MSG_PEDIDO = 'Pedido inválido.';
const MSG_LER = 'Não consegui ler os dados agora. Tente de novo em instantes.';
const MSG_GRAVAR = 'Não consegui gravar agora. Tente de novo.';
const MAX_SUGESTOES = 10;
const RE_PROPOSTA = /^[A-Za-z0-9._-]{1,40}$/;

const logErro = (que: string, err: unknown): void =>
  console.error(`[venda-solar] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? 'interno');

const corpoDe = (req: Request): Record<string, unknown> | null => {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};

function falhou(res: Response, que: string, err: unknown): void {
  logErro(que, err);
  if (err instanceof ErroVendaSolar) { res.status(err.http).json({ ok: false, error: MSG_LER }); return; }
  if (err instanceof ErroDocs) { res.status(err.http).json({ ok: false, error: err.mensagem }); return; }
  res.status(500).json({ ok: false, error: MSG_LER });
}

/** Formato do card na rota (só dígitos, id do card) e a POSSE. Devolve null depois de responder. */
async function guarda(req: Request, res: Response) {
  const nome = String((req as any).consultor?.nome || '');
  const socio = ehSocio(nome);
  const id = codigoDeRota('vendasolar', req.params.card);
  if (!id) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return null; }
  try {
    const card = await acessoVendaSolar(nome, socio, Number(id));
    if (!card) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return null; }
    return { nome, socio, card, id: Number(id) };
  } catch (err) {
    falhou(res, 'posse falhou', err);
    return null;
  }
}

const corpoLigacao = (lig: Ligacao) => ({ proposta: lig.proposta, venda: lig.venda, por: lig.por, em: lig.em });

/** Os candidatos do card, já filtrados pelo PAPEL (só o que o pedinte pode ligar) e pelo que não é de OUTRO card. */
async function candidatos(
  q: { nome: string; socio: boolean; id: number; clienteNome: string; telefone: string; vendedor: string },
  lig: Ligacao, todas: ReadonlyMap<number, Ligacao>,
) {
  const alvoNome = normalizarNome(q.clienteNome);

  // Propostas vendidas (lista guardada 60 s): telefone primeiro; nome só como sugestão.
  const livres = (codigo: string): boolean => quemUsa(todas, q.id, 'proposta', codigo) === null && codigo !== lig.proposta;
  const vendidas = (await comCacheHub('propostas_vendidas', listarVendidasParaVinculo))
    .filter((p) => propostaDoPapel(q.nome, q.socio, p.consultor) && livres(p.codigo));
  const propostas: CandidatoProposta[] = [];
  const porTel = vendidas
    .map((p) => ({ p, forca: melhorForca(q.telefone, p.telefones) }))
    .filter((x) => x.forca !== null);
  for (const { p } of porTel) propostas.push({ codigo: p.codigo, cliente: p.cliente, cidade: p.cidade, kwp: p.kwp, data: p.data, motivo: 'telefone' });
  // Só MARCA como sugerida (nunca liga): UM candidato por telefone, com DDD dos dois lados, e do MESMO consultor do card.
  if (porTel.length === 1 && porTel[0].forca === 'forte' && mesmoConsultor(porTel[0].p.consultor, q.vendedor)) propostas[0].sugerida = true;
  if (!lig.proposta && alvoNome) {
    const jaTem = new Set(propostas.map((p) => p.codigo));
    for (const p of vendidas) {
      if (propostas.length >= MAX_SUGESTOES * 2) break;
      if (jaTem.has(p.codigo) || !nomesParecidos(alvoNome, normalizarNome(p.cliente))) continue;
      propostas.push({ codigo: p.codigo, cliente: p.cliente, cidade: p.cidade, kwp: p.kwp, data: p.data, motivo: 'nome' });
    }
  }

  // Vendas da planilha (lista guardada 60 s): só as que o pedinte enxerga (consultor efetivo ou sócio).
  const vendas: CandidatoVenda[] = [];
  let vendasIndisponivel = false;
  try {
    let fortes = 0;
    let comTelefone = 0;
    let ultimaForte: { c: CandidatoVenda; consultor: string } | null = null;
    for (const v of await comCacheHub('planilha', vendasDaPlanilha)) {
      if (v.codigo === lig.venda || quemUsa(todas, q.id, 'venda', v.codigo) !== null) continue;
      if (!(q.socio || podeVer(q.nome, v.consultor))) continue;
      const forca = compararTelefones(q.telefone, v.telefone);
      const porNome = forca === null && !lig.venda && !!alvoNome && nomesParecidos(alvoNome, normalizarNome(v.cliente));
      if (forca === null && !porNome) continue;
      const c: CandidatoVenda = { codigo: v.codigo, cliente: v.cliente, data: v.data, motivo: forca ? 'telefone' : 'nome' };
      vendas.push(c);
      if (forca) { comTelefone++; if (forca === 'forte') { fortes++; ultimaForte = { c, consultor: v.consultor }; } }
    }
    if (comTelefone === 1 && fortes === 1 && ultimaForte && mesmoConsultor(ultimaForte.consultor, q.vendedor)) ultimaForte.c.sugerida = true;
  } catch (err) {
    logErro('planilha indisponível para as sugestões', err);
    vendasIndisponivel = true;
  }
  const ordem = (m: string): number => (m === 'telefone' ? 0 : 1);
  propostas.sort((a, b) => ordem(a.motivo) - ordem(b.motivo));
  vendas.sort((a, b) => ordem(a.motivo) - ordem(b.motivo));
  return {
    propostas: propostas.slice(0, MAX_SUGESTOES * 2), vendas: vendas.slice(0, MAX_SUGESTOES * 2), vendasIndisponivel,
  };
}

/** A melhor semelhança entre o telefone do card e os da proposta ('forte' vence 'fraca'); null se nenhum casa. */
function melhorForca(telefoneDoCard: string, telefones: string[]): ForcaTelefone {
  let melhor: ForcaTelefone = null;
  for (const t of telefones) {
    const f = compararTelefones(telefoneDoCard, t);
    if (f === 'forte') return 'forte';
    if (f === 'fraca') melhor = 'fraca';
  }
  return melhor;
}

export function mountVendaSolar(router: Router): void {
  const base = [exigeConsultor, semCache];

  // ── Ler (nunca grava: telefone só sugere) ──────────────────────────────────
  router.get('/vendas-solares/:card/vinculos', ...base, async (req: Request, res: Response) => {
    const g = await guarda(req, res);
    if (!g) return;
    try {
      const [lido, todas] = await Promise.all([lerLigacao(g.id), lerTodasLigacoes()]);
      const q = {
        nome: g.nome, socio: g.socio, id: g.id, clienteNome: String(g.card.cliente_nome ?? ''), telefone: String(g.card.cliente_telefone ?? ''),
        vendedor: String(g.card.vendedor_nome ?? ''),
      };
      const { lig } = lido;
      const c = await candidatos(q, lig, todas);
      // De onde veio o número ligado (só leitura; falha tira o campo, não derruba o GET).
      let vendaOrigem: 'gerador' | 'planilha' | null = null;
      if (lig.venda) {
        try {
          const reg = await lerRegistroDoCodigo(lig.venda);
          vendaOrigem = reg && reg.card === g.id ? 'gerador' : 'planilha';
        } catch (err) { logErro('registro do código indisponível', err); }
      }
      // Regra do dono (22/10/2026): telefone não identifica cliente. Aqui NADA é gravado; quem liga é o consultor, pelo POST.
      res.json({
        ok: true, ...corpoLigacao(lig),
        ...(vendaOrigem ? { venda_origem: vendaOrigem } : {}),
        sugestoes: { propostas: c.propostas, vendas: c.vendas },
        ...(c.vendasIndisponivel ? { vendas_indisponivel: true } : {}),
      });
    } catch (err) {
      falhou(res, 'ler vínculos falhou', err);
    }
  });

  // ── Ligar e desligar ───────────────────────────────────────────────────────
  router.post('/vendas-solares/:card/vinculos', ...base, async (req: Request, res: Response) => {
    const g = await guarda(req, res);
    if (!g) return;
    const b = corpoDe(req);
    const querProposta = !!b && Object.prototype.hasOwnProperty.call(b, 'proposta');
    const querVenda = !!b && Object.prototype.hasOwnProperty.call(b, 'venda');
    const soSeVazia = !!b && b.soSeVazia === true;
    if (!b || (!querProposta && !querVenda)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    // Sem segredo para assinar a ligação, nada é gravado.
    if (!segredoDoVinculo()) { logErro('sem segredo para assinar a ligação', { codigo: 'sem_segredo' }); res.status(503).json({ ok: false, error: MSG_GRAVAR }); return; }
    let proposta: string | null = null;
    let venda: string | null = null;
    if (querProposta && b.proposta !== null) {
      const t = typeof b.proposta === 'string' ? b.proposta.trim() : '';
      if (!RE_PROPOSTA.test(t)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
      proposta = t;
    }
    if (querVenda && b.venda !== null) {
      const d = codigoDeRota('solar', b.venda);
      if (!d) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
      venda = `#${d}`;
    }
    try {
      if (proposta) {
        const p = await lerPropostaResumo(proposta);
        // Consultor: só proposta DELE. O nome do cliente não serve de permissão (é editável): ligaria a CNH de um cliente alheio.
        if (!p || !propostaDoPapel(g.nome, g.socio, p.consultor_nome)) { res.status(404).json({ ok: false, error: 'Proposta não encontrada.' }); return; }
        if (!p.vendido) { res.status(409).json({ ok: false, error: 'Só uma proposta vendida pode ser ligada.' }); return; }
      }
      // O número que o alocador deu a ESTE card (registro assinado com `card` igual) pode ser religado mesmo antes de entrar no
      // Excel: desligar por engano não pode obrigar a gastar outro número. O de outro card segue a regra de sempre.
      // O registro só é lido quando a planilha não deu a venda: registro fora do ar não derruba todo Ligar.
      if (venda && !(await vendaSolarDoDono(g.nome, g.socio, venda)) && (await lerRegistroDoCodigo(venda))?.card !== g.id) {
        res.status(404).json({ ok: false, error: 'Venda da planilha não encontrada.' });
        return;
      }
      const saida = await comTrava(TRAVA_VINCULOS, g.nome, async () => {
        const [{ lig }, todas] = await Promise.all([lerLigacao(g.id), lerTodasLigacoes()]);
        if (soSeVazia && ((proposta && lig.proposta) || (venda && lig.venda))) {
          return { status: 409 as const, corpo: { ok: false, error: 'Este card já tem ligação. Nada foi trocado.' } };
        }
        if (proposta && quemUsa(todas, g.id, 'proposta', proposta) !== null) {
          return { status: 409 as const, corpo: { ok: false, error: 'Esta proposta já está ligada a outra venda.' } };
        }
        if (venda && quemUsa(todas, g.id, 'venda', venda) !== null) {
          return { status: 409 as const, corpo: { ok: false, error: 'Esta venda da planilha já está ligada a outro card.' } };
        }
        const novo: Ligacao = {
          proposta: querProposta ? proposta : lig.proposta,
          venda: querVenda ? venda : lig.venda,
          por: g.nome, em: new Date().toISOString(),
          // O cartão do Trello já ligado segue junto: religar a proposta não pode esquecê-lo.
          ...(lig.trello_card ? { trello_card: lig.trello_card } : {}),
        };
        await gravarLigacao(g.id, novo);
        invalidarCachesHub();
        return { status: 200 as const, corpo: { ok: true, ...corpoLigacao(novo) } };
      });
      res.status(saida.status).json(saida.corpo);
    } catch (err) {
      if (err instanceof ErroCadastro && err.codigo === 'ocupado') {
        res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando agora. Tente de novo.' });
        return;
      }
      if (err instanceof ErroCadastro || err instanceof ErroHub) { logErro('ligar falhou', err); res.status(503).json({ ok: false, error: MSG_GRAVAR }); return; }
      falhou(res, 'ligar falhou', err);
    }
  });

  // ── Cartão do Trello (21/10/2026): a rota mora em outro arquivo, com a MESMA guarda ────────────────────────────────────────
  mountVendaSolarTrello(router, base, guarda);
  // ── Cliente na planilha (fase 2): o `#NNNN` pelo alocador, com a MESMA base e a MESMA guarda ──────────────────────────────
  mountVendaSolarCliente(router, base, guarda);
}
