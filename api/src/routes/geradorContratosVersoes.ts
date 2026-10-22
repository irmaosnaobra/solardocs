import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { semCache } from './geradorClientesDocs';
import { supabaseGerador } from '../utils/supabaseGerador';
import { ehOrigemEletroposto } from '../services/agenda/origemEtiqueta';
import { ehSocio, podeVer, nomeSimples } from '../services/gerador/solarObras';
import { ErroCadastro } from '../services/gerador/cadastroVendaBanco';
import { vendaSolarDoDono, vendaLigadaVale } from './geradorClientes';
import { lerLigacao } from '../services/gerador/vendaSolarHub';
import {
  ehLinhaContrato, ehUuid, listarVersoes, lerVersao, gravarVersao, apagarVersao, LIMITE_VERSAO_BYTES, LIMITE_VERSOES, type LinhaContrato,
} from '../services/gerador/contratosVersoes';

// ─────────────────────────────────────────────────────────────────────────────
// VERSÕES DOS CONTRATOS E PAPÉIS, ligadas ao card do cliente (entrega 1 de 2). Montadas dentro de /gerador:
//
//   GET    /gerador/contratos/:linha/:card/versoes        a lista (sem o html e sem o snapshot)
//   GET    /gerador/contratos/:linha/:card/versoes/:id    a versão inteira
//   POST   /gerador/contratos/:linha/:card/versoes        grava uma versão nova (nunca sobrescreve)
//   DELETE /gerador/contratos/:linha/:card/versoes/:id    apaga (só sócio)
//   GET    /gerador/contratos/cards?q=                    os cards do consultor (o sócio vê todos), para o seletor
//
// :linha é `eletroposto` ou `vendasolar` (a linha do PRÓPRIO card; `solar` é código de planilha, não card). Vale para QUALQUER
// card da agenda, vendido ou não (o Termo do Investidor é assinado antes da venda). Posse: o consultor acessa o card dele
// (`vendedor_nome`), o sócio acessa todos. Card inexistente, alheio ou de outra linha respondem IGUAL (404).
// As versões moram só no bucket privado próprio `contratos-versoes` (veja services/gerador/contratosVersoes.ts). Nunca se loga conteúdo.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_PEDIDO = 'Pedido inválido.';
const MSG_NAO_ACHEI = 'Não encontrei.';
const logErro = (que: string, err: unknown): void =>
  console.error(`[contratos-versoes] ${que}`, err instanceof ErroCadastro ? err.codigo : (err as { code?: unknown } | null)?.code ?? 'interno');

const quem = (req: Request): { nome: string; email: string; socio: boolean } => {
  const c = (req as any).consultor || {};
  const nome = String(c.nome || '');
  return { nome, email: String(c.email || ''), socio: ehSocio(nome) };
};
const corpoDe = (req: Request): Record<string, unknown> | null => {
  const b = req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};
const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const linhaDoCard = (createdBy: unknown): LinhaContrato => (ehOrigemEletroposto(createdBy as string) ? 'eletroposto' : 'vendasolar');

/** Formato (400) e depois a POSSE (404 igual). Devolve o id do card, ou null depois de responder. */
async function posse(req: Request, res: Response): Promise<{ linha: LinhaContrato; card: number; nome: string; email: string; socio: boolean } | null> {
  const { nome, email, socio } = quem(req);
  const linha = req.params.linha;
  const bruto = String(req.params.card ?? '');
  if (!ehLinhaContrato(linha) || !/^\d{1,12}$/.test(bruto) || Number(bruto) <= 0) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return null; }
  const card = Number(bruto);
  try {
    const { data, error } = await supabaseGerador.from('agendamentos').select('id, vendedor_nome, created_by').eq('id', card).maybeSingle();
    if (error) throw new ErroCadastro('posse');
    const c = data as { id?: unknown; vendedor_nome?: unknown; created_by?: unknown } | null;
    let ok = !!c && c.id === card && linhaDoCard(c.created_by) === linha;
    // Mesma regra do `acessoVendaSolar`, sem exigir card vendido: sócio, vendedor do card, ou (venda solar) o consultor da venda
    // da planilha ligada ao card. A ordem importa: sócio e vendedor passam sem tocar na planilha.
    if (ok && c && !(socio || podeVer(nome, String(c.vendedor_nome ?? '')))) {
      ok = false;
      if (linha === 'vendasolar') {
        const { lig } = await lerLigacao(card);
        // Código dado pelo alocador a ESTE card: a via do consultor da planilha nunca concede (`vendaLigadaVale`).
        ok = !!lig.venda && await vendaLigadaVale(card, lig.venda, lig.por) && !!(await vendaSolarDoDono(nome, false, lig.venda));
      }
    }
    if (!ok) {
      res.status(404).json({ ok: false, error: MSG_NAO_ACHEI });
      return null;
    }
    return { linha, card, nome, email, socio };
  } catch (err) {
    logErro('posse falhou', err);
    res.status(503).json({ ok: false, motivo: 'contratos_indisponivel', error: 'Não consegui conferir o cliente agora. Tente de novo em instantes.' });
    return null;
  }
}

function falha(res: Response, que: string, err: unknown): void {
  logErro(que, err);
  const c = err instanceof ErroCadastro ? err.codigo : '';
  if (c === 'grande') { res.status(413).json({ ok: false, motivo: 'grande', error: `Este papel passou do limite de ${String(LIMITE_VERSAO_BYTES / 1_000_000).replace('.', ',')} MB e não ficou salvo no card.` }); return; }
  if (c === 'grande_bucket') { res.status(413).json({ ok: false, motivo: 'grande_bucket', error: 'Este papel é maior do que o armazenamento aceita e não ficou salvo no card.' }); return; }
  if (c === 'limite') { res.status(409).json({ ok: false, motivo: 'limite', error: `Este cliente já tem ${LIMITE_VERSOES} versões salvas. Exclua as antigas para salvar novas.` }); return; }
  res.status(503).json({ ok: false, motivo: 'contratos_indisponivel', ...(c === 'ocupado' ? { ocupado: true } : {}), error: 'As versões salvas estão indisponíveis agora. Tente de novo em instantes.' });
}

export function mountContratosVersoes(router: Router): void {
  const base = [exigeConsultor, semCache];

  // Seletor "Cliente deste contrato": cards da agenda do consultor (o sócio vê todos), por nome. Rota literal, antes das de :linha.
  router.get('/contratos/cards', ...base, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const q = String(req.query.q ?? '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (q.length < 2) { res.json({ ok: true, cards: [] }); return; }
    try {
      // O nome do CLIENTE também é tolerante: vogal, c e letra acentuada viram curinga ("Jose" acha "José" e "José" acha "Jose"). O refino é abaixo.
      const qCuringa = q.replace(/[aeioucÀ-ſ]/gi, '_');
      let consulta = supabaseGerador.from('agendamentos').select('id, cliente_nome, cidade, vendedor_nome, created_by, status').ilike('cliente_nome', `%${qCuringa}%`);
      // Pré-filtro tolerante a acento ("jose" acha "José"): as vogais e o c viram curinga. A regra de verdade é a `podeVer` abaixo,
      // a mesma da posse (nomeSimples no lado da planilha).
      if (!socio) consulta = consulta.ilike('vendedor_nome', nome.replace(/[aeiouc]/gi, '_'));
      const { data, error } = await consulta.order('id', { ascending: false }).range(0, 399);   // o refino sem acento vem DEPOIS: buscar poucas linhas some com cliente antiga
      if (error) throw new ErroCadastro('cards');
      const cards = ((data ?? []) as Array<{ id?: unknown; cliente_nome?: unknown; cidade?: unknown; vendedor_nome?: unknown; created_by?: unknown; status?: unknown }>)
        // O filtro do banco é só um pré-filtro: a regra de verdade é a mesma da posse.
        .filter((c) => Number.isInteger(c.id) && (socio || podeVer(nome, String(c.vendedor_nome ?? ''))))
        // O curinga acima deixa passar nomes parecidos demais ("Fulano" e "Falino"): o refino compara sem acento e sem caixa.
        .filter((c) => nomeSimples(c.cliente_nome).includes(nomeSimples(q)))
        .slice(0, 30)
        .map((c) => ({ linha: linhaDoCard(c.created_by), codigo: String(c.id), nome: String(c.cliente_nome ?? ''), cidade: String(c.cidade ?? ''), status: String(c.status ?? '') }));
      res.json({ ok: true, cards });
    } catch (err) { falha(res, 'busca de cards falhou', err); }
  });

  const raiz = '/contratos/:linha/:card/versoes';

  router.get(raiz, ...base, async (req: Request, res: Response) => {
    const p = await posse(req, res); if (!p) return;
    try { res.json({ ok: true, versoes: await listarVersoes(p.linha, p.card), socio: p.socio }); } catch (err) { falha(res, 'lista falhou', err); }
  });

  router.get(`${raiz}/:id`, ...base, async (req: Request, res: Response) => {
    if (!ehUuid(req.params.id)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    const p = await posse(req, res); if (!p) return;
    try {
      const v = await lerVersao(p.linha, p.card, req.params.id);
      if (!v) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }
      res.json({ ok: true, versao: v });
    } catch (err) { falha(res, 'leitura falhou', err); }
  });

  router.post(raiz, ...base, async (req: Request, res: Response) => {
    const p = await posse(req, res); if (!p) return;
    const b = corpoDe(req);
    const tipo = txt(b?.tipo, 80).trim();
    if (!b || !tipo || typeof b.html !== 'string' || !b.html || !b.snap || typeof b.snap !== 'object' || Array.isArray(b.snap)) {
      res.status(400).json({ ok: false, error: MSG_PEDIDO }); return;
    }
    try {
      const leve = await gravarVersao(p.linha, p.card, p.nome, {
        tipo, rotulo: txt(b.rotulo, 120), modelo: txt(b.modelo, 60), num: txt(b.num, 40), data: txt(b.data, 40), autor: p.email,
        editado: b.editado === true, snap: b.snap, html: b.html, arquivo: txt(b.arquivo, 200), titulo: txt(b.titulo, 200),
        opts: b.opts && typeof b.opts === 'object' ? b.opts : null, emit: typeof b.emit === 'string' ? b.emit.slice(0, 40) : null, emitSelo: txt(b.emitSelo, 200),
      });
      res.status(201).json({ ok: true, versao: leve });
    } catch (err) { falha(res, 'gravação falhou', err); }
  });

  router.delete(`${raiz}/:id`, ...base, async (req: Request, res: Response) => {
    if (!ehUuid(req.params.id)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    const p = await posse(req, res); if (!p) return;
    if (!p.socio) { res.status(403).json({ ok: false, error: 'Só sócio exclui uma versão salva.' }); return; }
    try {
      if (!(await apagarVersao(p.linha, p.card, p.nome, req.params.id))) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }
      res.json({ ok: true });
    } catch (err) { falha(res, 'exclusão falhou', err); }
  });
}
