import { Router, Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { ehSocio, podeVer } from '../services/gerador/solarObras';
import { equipeAutorizada } from '../services/gerador/caixaWhatsapp';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { montarPosVenda } from '../services/agenda/posVendaEletroposto';
import {
  colunasFichaPara, gruposFichaPara, definicaoFicha, montarFicha, montarObras, montarObra, celulaFicha,
  progressoFicha, validarCampoFicha, lerEntradaObra, houveConflitoObra, lerPosVenda,
  type CelulaFicha, type CardVendido, type LinhaFicha,
} from '../services/gerador/fichaEletroposto';
import { totais, houveConflito, aplicarGravacao, type LinhaGestao } from '../services/gerador/gestaoClientes';
import {
  lerCardsVendidos, lerCardVendido, lerFichas, lerPosVendas, lerFichaComVersao, gravarFicha,
  lerPosVendaComVersao, gravarPosVenda, ErroFicha,
} from '../services/gerador/fichaEletropostoBanco';

// ─────────────────────────────────────────────────────────────────────────────
// FICHA DO CLIENTE e OBRAS do eletroposto no /gerador. Montadas dentro de /gerador.
// Todas exigem consultor logado; o papel (sócio ou consultor) vem do TOKEN, nunca
// do corpo ou da query.
//
//   GET  /clientes/eletroposto         catálogo + linhas (cortados pelo PAPEL), mesmo formato do solar
//   POST /clientes/eletroposto/campo   grava UMA célula da ficha ({codigo, coluna, valor, base_em})
//   GET  /obras/eletroposto            as obras (card vendido + pós-venda), só equipe
//   POST /obras/eletroposto            etapa, previsto, responsável e obs ({id, ..., base_em}), só equipe
//
// A linha é o card `fechou` de eletroposto (veja `ehCardVendidoEp`) e o dono é o
// `vendedor_nome` do card. Consultor vê e grava só nos cards dele; sócio em todos.
// Card inexistente, de outra pessoa, de solar ou ainda não vendido: a MESMA resposta
// (404), senão a ordem das recusas revelaria que o id existe.
//
// As Obras gravam o MESMO `pos_venda:<id>` da Agenda, no mesmo formato. O corpo NUNCA
// vai inteiro para o `montarPosVenda`: só etapa, previsto, responsavel e obs; o `por`
// vem do token; modelo, valor e vendido_em ficam na caixa da Agenda.
//
// Nenhum valor de campo vai para log: só o código do erro do banco. Nenhuma rota
// pública (`/pos-venda`, `/agentes`) devolve campo da ficha: `cliente_ep:` só é lido aqui.
// ─────────────────────────────────────────────────────────────────────────────

const TENTATIVAS_GRAVAR = 4;
const MSG_BANCO = 'Não consegui ler os dados agora. Tente de novo em instantes.';
const MSG_GRAVAR = 'Não consegui gravar agora. Tente de novo.';
const MSG_NAO_ACHEI = 'Venda não encontrada.';

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function quem(req: Request): { nome: string; socio: boolean } {
  const nome = String((req as any).consultor?.nome || '');
  return { nome, socio: ehSocio(nome) };
}

/** Obras: lista fechada da equipe (a mesma da caixa da 5040 e das redes; OBRAS_EQUIPE troca sem deploy de código). */
function exigeEquipe(req: Request, res: Response, next: NextFunction): void {
  const nome = String((req as any).consultor?.nome || '');
  if (!equipeAutorizada(nome, process.env.OBRAS_EQUIPE)) {
    res.status(403).json({ ok: false, error: 'Esta tela é só para a equipe.', precisa: 'equipe' });
    return;
  }
  next();
}

const logErro = (que: string, err: unknown): void =>
  console.error(`[ficha-ep] ${que}`, err instanceof ErroFicha ? err.codigo : 'interno');

const textoValor = (v: unknown): string => (v === null || v === undefined ? 'vazio' : String(v));

const dono = (nome: string, socio: boolean, card: CardVendido): boolean =>
  socio || podeVer(nome, String(card.vendedor_nome ?? ''));

export function mountClientesEletroposto(router: Router): void {
  // ── Ficha: grade ───────────────────────────────────────────────────────────
  router.get('/clientes/eletroposto', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    // O instante vem ANTES da leitura: uma edição que caia entre as duas fica depois do `base_em` e gera 409, nunca sobrescrita calada.
    const agora = new Date().toISOString();
    let cards: CardVendido[];
    let linhas: LinhaFicha[];
    let colunas;
    try {
      // Só os cards do papel: o registro de uma venda alheia nem é lido para o consultor.
      cards = (await lerCardsVendidos()).filter((c) => dono(nome, socio, c));
      const ids = cards.map((c) => c.id);
      const [fichas, posVendas] = await Promise.all([lerFichas(ids), lerPosVendas(ids)]);
      ({ colunas, linhas } = montarFicha(cards, fichas, posVendas, nome, socio));
    } catch (err) {
      logErro('leitura falhou', err);
      res.status(502).json({ ok: false, error: MSG_BANCO });
      return;
    }
    res.json({
      ok: true,
      produto: 'eletroposto',
      papel: socio ? 'socio' : 'consultor',
      consultor: nome,
      em: agora,
      atualizadoEm: agora,
      fonte: { cards: true },
      catalogo: { grupos: gruposFichaPara(colunas), colunas },
      linhas: linhas.map((l) => ({
        codigo: l.codigo, cliente: l.cliente, consultor: l.consultor, progresso: l.progresso, celulas: l.celulas,
      })),
      totais: totais(linhas as unknown as LinhaGestao[]),
    });
  });

  // ── Ficha: gravar uma célula ───────────────────────────────────────────────
  router.post('/clientes/eletroposto/campo', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const b = (req.body || {}) as { codigo?: unknown; coluna?: unknown; valor?: unknown; base_em?: unknown };
    const codigoTxt = typeof b.codigo === 'number' ? String(b.codigo) : typeof b.codigo === 'string' ? b.codigo.trim() : '';
    const colunaRaw = typeof b.coluna === 'string' ? b.coluna.trim() : '';
    const baseEm = typeof b.base_em === 'string' ? b.base_em : '';
    if (!/^\d{1,12}$/.test(codigoTxt) || Number(codigoTxt) <= 0 || !colunaRaw || colunaRaw.length > 60) {
      res.status(400).json({ ok: false, error: 'Pedido inválido.' });
      return;
    }
    if (!baseEm || !Number.isFinite(Date.parse(baseEm)) || new Date(baseEm).toISOString() !== baseEm) {
      res.status(400).json({ ok: false, error: 'Pedido inválido: falta o instante da leitura (base_em).' });
      return;
    }
    if (typeof b.valor === 'string' && b.valor.length > 2000) {
      res.status(400).json({ ok: false, error: 'Valor longo demais.' });
      return;
    }
    const id = Number(codigoTxt);

    // 1º a POSSE da venda, antes de qualquer outra conferência: venda inexistente, de outro consultor, de solar ou
    // ainda não vendida respondem IGUAL (404, mesma mensagem).
    let card: CardVendido | null;
    try { card = await lerCardVendido(id); } catch (err) {
      logErro('leitura do card falhou', err);
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
      return;
    }
    if (!card || !dono(nome, socio, card)) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }

    // Coluna de sócio para consultor dá a MESMA resposta de coluna que não existe.
    const def = definicaoFicha(colunaRaw);
    if (!def || (!socio && def.col.quem_ve === 'socio')) {
      res.status(400).json({ ok: false, error: 'Coluna não encontrada.' });
      return;
    }
    if (!def.col.editavel) {
      res.status(400).json({
        ok: false,
        error: def.fonte === 'pos_venda' ? 'Esta informação se edita em Obras.' : 'Esta coluna não pode ser editada.',
      });
      return;
    }
    const col = def.col;
    const v = validarCampoFicha(col, b.valor);
    if (!v.ok) { res.status(400).json({ ok: false, error: v.erro }); return; }

    try {
      const colunas = colunasFichaPara(socio);
      for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
        const { reg, versao } = await lerFichaComVersao(id);
        const antesCel = celulaFicha(col.chave, card, reg, null) as CelulaFicha;
        const outro = houveConflito(reg, col.chave, baseEm, nome);
        if (outro) {
          res.status(409).json({
            ok: false, conflito: true,
            error: `${outro.por} alterou esta célula agora. Valor atual: ${textoValor(antesCel.valor)}`,
            por: outro.por, em: outro.em, celula: antesCel,
          });
          return;
        }
        const mesmo = v.valor === null ? !reg.campos[col.chave] : (antesCel.origem === 'sistema' && antesCel.valor === v.valor);
        const agora = new Date().toISOString();
        let novo = reg;
        if (!mesmo) {
          novo = aplicarGravacao(reg, col, v.valor, antesCel.valor, nome, agora);
          if (!(await gravarFicha(id, novo, versao, agora))) continue;   // perdeu a corrida: lê de novo
        }
        const celulas: Record<string, CelulaFicha> = {};
        for (const c of colunas) celulas[c.chave] = celulaFicha(c.chave, card, novo, null) as CelulaFicha;
        res.json({
          ok: true,
          celula: celulas[col.chave],
          em: agora,
          progresso: progressoFicha(colunas, celulas),
        });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta venda agora. Tente de novo.' });
    } catch (err) {
      logErro('gravar falhou', err);
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
    }
  });

  // ── Obras: lista ───────────────────────────────────────────────────────────
  router.get('/obras/eletroposto', exigeConsultor, exigeEquipe, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const agora = new Date().toISOString();
    try {
      const cards = (await lerCardsVendidos()).filter((c) => dono(nome, socio, c));
      const posVendas = await lerPosVendas(cards.map((c) => c.id));
      res.json({
        ok: true,
        socio,
        consultor: nome,
        em: agora,
        obras: montarObras(cards, posVendas, nome, socio, diaDeBrasilia(agora)),
      });
    } catch (err) {
      logErro('obras: leitura falhou', err);
      res.status(502).json({ ok: false, error: MSG_BANCO });
    }
  });

  // ── Obras: gravar ──────────────────────────────────────────────────────────
  router.post('/obras/eletroposto', exigeConsultor, exigeEquipe, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const e = lerEntradaObra(req.body);
    if (!e.ok) { res.status(400).json({ ok: false, error: e.erro }); return; }

    // 1º a POSSE (404 igual para card inexistente, alheio, de solar ou não vendido); só depois os campos.
    let card: CardVendido | null;
    try { card = await lerCardVendido(e.id); } catch (err) {
      logErro('obras: leitura do card falhou', err);
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
      return;
    }
    if (!card || !dono(nome, socio, card)) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }

    try {
      for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
        const { valor: bruto, versao } = await lerPosVendaComVersao(e.id);
        const atual = lerPosVenda(bruto);
        if (houveConflitoObra(atual, e.baseEm, nome)) {
          res.status(409).json({
            ok: false, conflito: true,
            error: 'Outra pessoa alterou esta obra agora. Confira e tente de novo.',
            por: atual!.por, em: atual!.em,
            obra: montarObra(card, bruto, diaDeBrasilia(new Date())),
          });
          return;
        }
        const agora = new Date().toISOString();
        const hoje = diaDeBrasilia(agora);
        // Venda ainda sem registro: o "vendido em" nasce do card (o mesmo dia que o dashboard usa), nunca de "hoje",
        // senão registrar uma venda antiga a empurraria para o mês corrente.
        const entrada: Record<string, unknown> = { ...e.entrada, por: nome };
        if (!atual) {
          const dia = card.created_at ? diaDeBrasilia(card.created_at) : '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(dia) && dia >= '2024-01-01' && dia <= hoje) entrada.vendido_em = dia;
        }
        const montado = montarPosVenda(entrada, atual, agora, hoje);
        if (!montado.ok) { res.status(400).json({ ok: false, error: montado.erro }); return; }
        if (!(await gravarPosVenda(e.id, montado.registro, versao, agora))) continue;   // perdeu a corrida: lê de novo
        res.json({ ok: true, em: agora, obra: montarObra(card, montado.registro, hoje) });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta obra agora. Tente de novo.' });
    } catch (err) {
      logErro('obras: gravar falhou', err);
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
    }
  });
}
