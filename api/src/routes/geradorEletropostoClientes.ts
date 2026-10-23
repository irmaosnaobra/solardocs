import { Router, Request, Response, NextFunction } from 'express';
import { exigeConsultor } from './geradorDossie';
import { ehSocio, podeVer } from '../services/gerador/solarObras';
import { equipeAutorizada } from '../services/gerador/caixaWhatsapp';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { montarPosVenda } from '../services/agenda/posVendaEletroposto';
import {
  colunasFichaPara, gruposFichaPara, definicaoFicha, montarFicha, montarObras, montarObra, celulaFicha,
  progressoFicha, validarCampoFicha, lerEntradaObra, lerValorObra, houveConflitoObra, lerPosVenda, MODELOS_OBRA,
  type CelulaFicha, type CardVendido, type LinhaFicha,
} from '../services/gerador/fichaEletroposto';
import { totais, houveConflito, aplicarGravacao, lerRegistro, type LinhaGestao, type RegistroGestao } from '../services/gerador/gestaoClientes';
import {
  FICHA_PARA_CADASTRO, ehColunaDoCadastro, sobreporCadastro, limparAntes, lerCadastro, lerCadastros, escreverCadastro, validarCampo,
  type Cadastro,
} from '../services/gerador/cadastroVenda';
import { ErroCadastro } from '../services/gerador/cadastroVendaBanco';
import {
  lerCardsVendidos, lerCardVendido, lerFichas, lerPosVendas, lerFichaComVersao, gravarFicha,
  lerPosVendaComVersao, gravarPosVenda, ErroFicha,
} from '../services/gerador/fichaEletropostoBanco';
import {
  serieComPassada, passadaDePendentes, lerSerieSemRisco, lerSerieEstrita, garantirSerieDoCard, ESPERA_DA_ROTA,
} from '../services/gerador/eletropostoSerie';

// ─────────────────────────────────────────────────────────────────────────────
// FICHA DO CLIENTE e OBRAS do eletroposto no /gerador. Montadas dentro de /gerador.
// Todas exigem consultor logado; o papel (sócio ou consultor) vem do TOKEN, nunca
// do corpo ou da query.
//
//   GET  /clientes/eletroposto         catálogo + linhas (cortados pelo PAPEL), mesmo formato do solar
//   POST /clientes/eletroposto/campo   grava UMA célula da ficha ({codigo, coluna, valor, base_em})
//   GET  /clientes/eletroposto/series  card -> `#E` dos clientes que o papel vê (só leitura, não numera)
//   POST /clientes/eletroposto/:id/serie   dá (ou devolve) o `#E001` do card vendido; idempotente (o gancho do navegador)
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
// vem do token. `modelo` é de toda a equipe (só os 6, e a etapa que não existir no trilho novo vai para a primeira dele, a
// mesma regra do `montarPosVenda` que a Agenda usa); `valor` e `vendido_em` são só de sócio (403 para consultor).
//
// Nenhum valor de campo vai para log: só o código do erro do banco. Nenhuma rota
// pública (`/pos-venda`, `/agentes`) devolve campo da ficha: `cliente_ep:` só é lido aqui.
//
// CADASTRO = FONTE ÚNICA (cadastroVenda.ts): 13 colunas (cliente, cpf_cnpj, rg_ie, contato, email, endereco, cep, cidade,
// uf, endereco_ponto, unidade_consumidora, concessionaria, titular_conta) moram no cadastro do bucket privado
// `cadastros-venda`, não no `system_state` (a chave pública do banco principal o lê). Na LEITURA o cadastro vai por
// cima do `system_state` (enquanto não migrou, o que só existe lá continua aparecendo). Na ESCRITA dessas colunas vale o
// MESMO validador do cadastro (`validarCampo`: dígito do CPF, UF, CEP) e a gravação passa por `escreverCadastro`: sob a
// trava da venda, migra TODO o legado para o cadastro, grava a edição e só então apaga do `system_state` as 13 colunas
// (valor e `antes`). Bucket do cadastro fora do ar na leitura: a ficha sai com o que há no `system_state` e
// `cadastro_indisponivel: true` (na grade, venda por venda: um JSON torto isola só a linha dele). O formato da resposta
// não muda.
// ─────────────────────────────────────────────────────────────────────────────

const TENTATIVAS_GRAVAR = 4;
const MSG_BANCO = 'Não consegui ler os dados agora. Tente de novo em instantes.';
const MSG_GRAVAR = 'Não consegui gravar agora. Tente de novo.';
const MSG_NAO_ACHEI = 'Venda não encontrada.';
const LIMITE_DA_ROTA = 100;   // quantos pendentes a rota POST numera de uma vez para chegar ao card pedido, na ordem

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
  console.error(`[ficha-ep] ${que}`, err instanceof ErroFicha || err instanceof ErroCadastro ? err.codigo : 'interno');

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
    let series = new Map<number, string>();
    let cadastroIndisponivel = false;
    let falhasDoCadastro = new Set<number>();
    try {
      // Só os cards do papel: o registro de uma venda alheia nem é lido para o consultor.
      const todos = await lerCardsVendidos();
      cards = todos.filter((c) => dono(nome, socio, c));
      const ids = cards.map((c) => c.id);
      // A série `#E` numera os pendentes na ordem GLOBAL (por isso recebe `todos`, não os cards do papel). Nunca lança nem derruba a lista.
      const [fichas, posVendas, cads, seriesLidas] = await Promise.all([lerFichas(ids), lerPosVendas(ids), lerCadastros(ids), serieComPassada(todos)]);
      series = seriesLidas;
      cadastroIndisponivel = cads.indisponivel;
      falhasDoCadastro = cads.falhas;
      // O cadastro vai por cima do `system_state`, só para montar a resposta (nunca é gravado de volta).
      const vistas = new Map<number, RegistroGestao>(fichas);
      for (const [id, cad] of cads.mapa) vistas.set(id, sobreporCadastro(fichas.get(id) ?? lerRegistro(null), cad));
      ({ colunas, linhas } = montarFicha(cards, vistas, posVendas, nome, socio, series));
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
      ...(cadastroIndisponivel ? { cadastro_indisponivel: true } : {}),
      catalogo: { grupos: gruposFichaPara(colunas), colunas },
      linhas: linhas.map((l) => ({
        codigo: l.codigo, cliente: l.cliente, consultor: l.consultor, progresso: l.progresso, celulas: l.celulas,
        ...(l.serie ? { serie: l.serie } : {}),
        ...(falhasDoCadastro.has(Number(l.codigo)) ? { cadastro_indisponivel: true } : {}),
      })),
      totais: totais(linhas as unknown as LinhaGestao[]),
    });
  });

  // ── Série `#E`: só leitura (card -> código), cortada pelo PAPEL ────────────
  router.get('/clientes/eletroposto/series', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    try {
      const meus = new Set((await lerCardsVendidos()).filter((c) => dono(nome, socio, c)).map((c) => c.id));
      const series: Record<string, string> = {};
      for (const [id, cod] of await lerSerieEstrita()) if (meus.has(id)) series[String(id)] = cod;
      res.json({ ok: true, series });
    } catch (err) {
      // Banco fora (ou sem segredo): 503, nunca 200 com mapa vazio, senão o navegador guarda o vazio como se fosse a resposta.
      logErro('série: leitura falhou', err);
      res.status(503).json({ ok: false, error: MSG_BANCO });
    }
  });

  // ── Série `#E`: dar (ou devolver) o código do card vendido ─────────────────
  // O gancho do navegador (CRM, Agenda, Histórico) chama aqui sem esperar. A posse é revalidada no servidor (`lerCardVendido`):
  // card inexistente, alheio, de solar ou não vendido dão o MESMO 404. NÃO usa a rota pública `/pos-venda`.
  router.post('/clientes/eletroposto/:id/serie', exigeConsultor, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const idTxt = String(req.params.id ?? '');
    if (!/^\d{1,12}$/.test(idTxt) || Number(idTxt) <= 0) { res.status(400).json({ ok: false, error: 'Pedido inválido.' }); return; }
    const id = Number(idTxt);
    let card: CardVendido | null;
    try { card = await lerCardVendido(id); } catch (err) {
      logErro('série: leitura do card falhou', err);
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
      return;
    }
    if (!card || !dono(nome, socio, card)) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return; }
    try {
      // 1º a passada de pendentes, EM ORDEM: o gancho de uma venda antiga regravada não pode dar o E001 a um card mais novo antes da
      // primeira leitura da lista. O card pedido é um dos pendentes, então a passada já o numera na posição certa.
      const p = await passadaDePendentes(await lerCardsVendidos(), ESPERA_DA_ROTA, LIMITE_DA_ROTA);
      const dele = p.series.get(id);
      if (dele) { res.json({ ok: true, serie: dele, criou: p.criou.has(id) }); return; }
      if (!p.completa) {
        res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava numerando agora. Tente de novo.' });
        return;
      }
      const r = await garantirSerieDoCard(id, nome);
      if (r.ok) { res.json({ ok: true, serie: r.serie, criou: r.criou }); return; }
      if (r.motivo === 'ocupado') {
        res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava numerando agora. Tente de novo.' });
        return;
      }
      logErro(`série: ${r.motivo}`, null);
      res.status(r.motivo === 'sem_segredo' ? 503 : 500).json({ ok: false, error: MSG_GRAVAR });
    } catch (err) {
      logErro('série: gravar falhou', err);
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
    }
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
    // Coluna do cadastro: o MESMO validador do cadastro (dígito do CPF, UF, CEP...), e vai o valor normalizado.
    const mapeada = ehColunaDoCadastro(col.chave);
    let valorCad: string | null = null;   // null = limpar o campo
    if (mapeada && v.valor !== null) {
      const vc = validarCampo(FICHA_PARA_CADASTRO[col.chave], String(v.valor));
      if (!vc.ok) { res.status(400).json({ ok: false, error: vc.erro }); return; }
      valorCad = vc.valor || null;
    }

    try {
      const colunas = colunasFichaPara(socio);
      for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
        const { reg, versao } = await lerFichaComVersao(id);
        // Coluna do cadastro não grava às cegas (erro se o bucket falhar); as outras seguem com o que há no `system_state`.
        let cad: Cadastro | null = null;
        try { cad = await lerCadastro(id); } catch (e) { if (mapeada) throw e; logErro('cadastro indisponível', e); }
        const visto = sobreporCadastro(reg, cad);
        const antesCel = celulaFicha(col.chave, card, visto, null) as CelulaFicha;
        const outro = houveConflito(visto, col.chave, baseEm, nome);
        if (outro) {
          res.status(409).json({
            ok: false, conflito: true,
            error: `${outro.por} alterou esta célula agora. Valor atual: ${textoValor(antesCel.valor)}`,
            por: outro.por, em: outro.em, celula: antesCel,
          });
          return;
        }
        const novoValor = mapeada ? valorCad : v.valor;
        const mesmo = novoValor === null ? !visto.campos[col.chave] : (antesCel.origem === 'sistema' && antesCel.valor === novoValor);
        const agora = new Date().toISOString();
        let novo = reg;      // o registro CRU: é o único que vai para o `system_state`
        let cadFinal = cad;
        let avisar = false;
        if (!mesmo) {
          if (mapeada) {
            // Uma passada só, sob a trava: o cadastro é gravado e o legado limpo. Sem 409 de "tente de novo" quando o
            // cadastro já foi salvo: se só a limpeza do `system_state` falhou, a resposta é sucesso com aviso.
            const r = await escreverCadastro(id, { [FICHA_PARA_CADASTRO[col.chave]]: valorCad ?? '' }, nome, 'manual', agora);
            novo = r.reg; cadFinal = r.cad; avisar = !r.limpou;
          } else {
            novo = aplicarGravacao(reg, col, v.valor, antesCel.valor, nome, agora);
            novo = limparAntes(novo) ?? novo;
            if (!(await gravarFicha(id, novo, versao, agora))) continue;   // perdeu a corrida: lê de novo
          }
        }
        const resposta = sobreporCadastro(novo, cadFinal);
        const celulas: Record<string, CelulaFicha> = {};
        for (const c of colunas) celulas[c.chave] = celulaFicha(c.chave, card, resposta, null) as CelulaFicha;
        res.json({
          ok: true,
          celula: celulas[col.chave],
          em: agora,
          progresso: progressoFicha(colunas, celulas),
          ...(avisar ? { aviso: 'Salvo. A limpeza do registro antigo fica para a próxima gravação.' } : {}),
        });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta venda agora. Tente de novo.' });
    } catch (err) {
      logErro('gravar falhou', err);
      if (err instanceof ErroCadastro && err.codigo === 'ocupado') {
        res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta venda agora. Tente de novo.' });
        return;
      }
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
    }
  });

  // ── Obras: lista ───────────────────────────────────────────────────────────
  router.get('/obras/eletroposto', exigeConsultor, exigeEquipe, semCache, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const agora = new Date().toISOString();
    try {
      const cards = (await lerCardsVendidos()).filter((c) => dono(nome, socio, c));
      const [posVendas, series] = await Promise.all([lerPosVendas(cards.map((c) => c.id)), lerSerieSemRisco()]);
      res.json({
        ok: true,
        socio,
        consultor: nome,
        em: agora,
        modelos: MODELOS_OBRA,
        obras: montarObras(cards, posVendas, nome, socio, diaDeBrasilia(agora), series),
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

    // Valor e data da venda são dinheiro e contabilidade: só sócio. Depois da posse, para o 404 não variar com o papel.
    if (!socio && e.soSocio) {
      res.status(403).json({ ok: false, error: 'Só sócio altera valor e data da venda.', precisa: 'socio' });
      return;
    }
    const base: Record<string, unknown> = { ...e.entrada };
    if (base.valor !== undefined) {
      const v = lerValorObra(base.valor);
      if (!v.ok) { res.status(400).json({ ok: false, error: 'valor_invalido' }); return; }
      base.valor = v.valor;
    }

    const serieDoCard = (await lerSerieSemRisco()).get(e.id);
    try {
      for (let tentativa = 0; tentativa < TENTATIVAS_GRAVAR; tentativa++) {
        const { valor: bruto, versao } = await lerPosVendaComVersao(e.id);
        const atual = lerPosVenda(bruto);
        if (houveConflitoObra(atual, e.baseEm, nome)) {
          res.status(409).json({
            ok: false, conflito: true,
            error: 'Outra pessoa alterou esta obra agora. Confira e tente de novo.',
            por: atual!.por, em: atual!.em,
            obra: montarObra(card, bruto, diaDeBrasilia(new Date()), socio, serieDoCard),
          });
          return;
        }
        const agora = new Date().toISOString();
        const hoje = diaDeBrasilia(agora);
        // Venda ainda sem registro: o "vendido em" nasce do card (o mesmo dia que o dashboard usa), nunca de "hoje",
        // senão registrar uma venda antiga a empurraria para o mês corrente.
        const entrada: Record<string, unknown> = { ...base, por: nome };
        if (!atual && entrada.vendido_em === undefined) {
          const dia = card.created_at ? diaDeBrasilia(card.created_at) : '';
          if (/^\d{4}-\d{2}-\d{2}$/.test(dia) && dia >= '2024-01-01' && dia <= hoje) entrada.vendido_em = dia;
        }
        const montado = montarPosVenda(entrada, atual, agora, hoje);
        if (!montado.ok) { res.status(400).json({ ok: false, error: montado.erro }); return; }
        if (!(await gravarPosVenda(e.id, montado.registro, versao, agora))) continue;   // perdeu a corrida: lê de novo
        res.json({ ok: true, em: agora, obra: montarObra(card, montado.registro, hoje, socio, serieDoCard) });
        return;
      }
      res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando esta obra agora. Tente de novo.' });
    } catch (err) {
      logErro('obras: gravar falhou', err);
      res.status(500).json({ ok: false, error: MSG_GRAVAR });
    }
  });
}
