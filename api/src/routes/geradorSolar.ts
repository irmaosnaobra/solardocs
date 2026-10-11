import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { PLANILHA_CSV_URL, TRELLO_BOARD_ID } from '../services/insightsService';
import { exigeConsultor } from './geradorDossie';
import { credenciaisTrello, casarCartao, type TrelloCard } from '../services/gerador/dossieVenda';
import {
  lerPlanilha, montarObra, hojeBRT, ordenarObras, resumirObras,
  calcularPedir, marcasDe, ehSocio, podeVer, montarMapa, montarRanking, nomeNaOrigem, codigoCanonico,
  type ObraBruta, type ObraMontada, type Marcas,
} from '../services/gerador/solarObras';
import { lerPainelQuizSolar, PERIODOS_PAINEL } from '../services/io/painelQuizSolar';
import { respostaDoPainel, type PainelQuizSolar } from '../services/io/painelQuizSolarPuro';

// ─────────────────────────────────────────────────────────────────────────────
// SOLAR: pós-venda dos consultores no /gerador. Montado dentro de /gerador.
//
// A planilha é SÓ LEITURA. O que o app marca ("pedi o depoimento") mora no
// `system_state`, uma chave por venda, para nunca escrever na planilha.
//
// CACHE GUARDA DADO, NUNCA RESPOSTA. A resposta de sócio leva dinheiro e a de
// consultor não; se o cache guardasse a resposta pronta, quem pedisse primeiro
// decidiria o que o próximo enxerga. Guardamos a planilha já filtrada pela lista
// branca (sem custo, lucro, comissão) e o quadro do Trello, e cada requisição
// monta a sua resposta para o seu usuário.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 5 * 60_000;
const TTL_FALHA_TRELLO_MS = 60_000;     // quadro fora do ar não pode custar 8 s a cada abertura de tela
// A cópia antiga só serve de socorro por 6 horas: planilha velha demais engana
// mais do que ajuda (venda nova e etapa avançada não apareceriam).
const VALIDADE_COPIA_VELHA_MS = 6 * 3_600_000;
/** Mutável só para os testes encurtarem os limites. */
export const limitesSolar = { planilhaMs: 15_000, trelloMs: 8_000 };
const PREFIXO_OBRA = 'solar_obra:';
const POR_CONSULTA = 150;               // o PostgREST estoura a URL antes do teto de linhas (ver gerador.ts)
const LINK_INDICACAO = 'https://solardoc.app/io/indicacao';

// ── Planilha (cache de 5 min) ────────────────────────────────────────────────

interface CachePlanilha { obras: ObraBruta[]; ts: number }
let cachePlanilha: CachePlanilha | null = null;
let planilhaVoando: Promise<CachePlanilha> | null = null;

/** Corta a espera no relógio, e não só pelo AbortController: um fetch que ignora
 *  o sinal (ou um corpo que não termina de chegar) deixaria a rota pendurada. */
function comLimite<T>(trabalho: (sinal: AbortSignal) => Promise<T>, ms: number, rotulo: string): Promise<T> {
  const ctrl = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { ctrl.abort(); reject(new Error(`${rotulo}: tempo esgotado`)); }, ms);
    trabalho(ctrl.signal).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function baixarPlanilha(): Promise<CachePlanilha> {
  return comLimite(async (sinal) => {
    const r = await fetch(PLANILHA_CSV_URL, { signal: sinal });
    if (!r.ok) throw new Error(`planilha respondeu ${r.status}`);
    const csv = await r.text();
    const obras = lerPlanilha(csv, (falta) => {
      // Coluna renomeada na planilha some calada da tela; o log é o único aviso.
      logger.warn('gerador-solar', `colunas não encontradas na planilha: ${falta.join(', ')}`);
    });
    if (!obras.length) throw new Error('planilha sem nenhuma venda');
    return { obras, ts: Date.now() };
  }, limitesSolar.planilhaMs, 'planilha');
}

/** `fresco` ignora o cache (só sócio passa true). Se a planilha cair e houver
 *  cópia de até 6 horas, devolve a cópia marcada como não-atualizada em vez de
 *  502; mais velha que isso, é 502. */
async function planilha(fresco: boolean): Promise<{ dados: CachePlanilha; atual: boolean }> {
  if (!fresco && cachePlanilha && Date.now() - cachePlanilha.ts < TTL_MS) return { dados: cachePlanilha, atual: true };
  try {
    // Uma só ida por vez: três telas abrindo juntas viram um download.
    if (!planilhaVoando || fresco) {
      const p = baixarPlanilha();
      planilhaVoando = p;
      p.then(() => { if (planilhaVoando === p) planilhaVoando = null; }, () => { if (planilhaVoando === p) planilhaVoando = null; });
    }
    const dados = await (planilhaVoando as Promise<CachePlanilha>);
    cachePlanilha = dados;
    return { dados, atual: true };
  } catch (err: any) {
    logger.warn('gerador-solar', 'planilha falhou', String(err?.message || err));
    if (cachePlanilha && Date.now() - cachePlanilha.ts < VALIDADE_COPIA_VELHA_MS) {
      return { dados: cachePlanilha, atual: false };
    }
    throw err;
  }
}

// ── Trello (melhor esforço, cache de 5 min) ──────────────────────────────────

interface Quadro { listas: Map<string, string>; cartoes: TrelloCard[] }
let cacheTrello: { quadro: Quadro | null; ts: number } | null = null;

function baixarQuadro(): Promise<Quadro> {
  const board = String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID;
  const cred = credenciaisTrello();
  const auth = cred ? `&key=${cred.key}&token=${cred.token}` : '';
  const url = `https://trello.com/1/boards/${board}?lists=open&cards=open&fields=name` +
    `&list_fields=name&card_fields=name,idList,shortUrl${auth}`;
  return comLimite(async (sinal) => {
    const r = await fetch(url, { signal: sinal });
    // A URL carrega key e token: nunca entra em mensagem de erro nem em log.
    if (!r.ok) throw new Error(`Trello respondeu ${r.status}`);
    const q = await r.json() as { lists?: Array<{ id: string; name: string }>; cards?: TrelloCard[] };
    return { listas: new Map((q.lists || []).map((l) => [l.id, l.name])), cartoes: q.cards || [] };
  }, limitesSolar.trelloMs, 'trello');
}

/** Nunca lança: quadro fora do ar vira `null` e a rota segue sem o estágio ao vivo. */
async function quadro(fresco: boolean): Promise<Quadro | null> {
  const agora = Date.now();
  if (!fresco && cacheTrello) {
    const ttl = cacheTrello.quadro ? TTL_MS : TTL_FALHA_TRELLO_MS;
    if (agora - cacheTrello.ts < ttl) return cacheTrello.quadro;
  }
  try {
    const q = await baixarQuadro();
    cacheTrello = { quadro: q, ts: agora };
    return q;
  } catch (err: any) {
    logger.warn('gerador-solar', 'trello falhou', String(err?.name === 'AbortError' ? 'timeout' : err?.message || err));
    cacheTrello = { quadro: null, ts: agora };
    return null;
  }
}

// ── Painel do quiz (cache de 3 min por período) ──────────────────────────────
// O cache guarda o DADO COMPLETO, com o gasto da Meta; o corte do dinheiro é
// feito por requisição, depois dele (respostaDoPainel). Assim a resposta de um
// sócio nunca é servida a um consultor, qualquer que seja a ordem dos pedidos.

const TTL_PAINEL_MS = 3 * 60_000;
const TTL_PAINEL_META_FORA_MS = 30_000;   // Meta fora do ar: tenta de novo logo, mas sem martelar o banco a cada abertura
const cachePainel = new Map<string, { painel: PainelQuizSolar; ts: number }>();
const painelVoando = new Map<string, Promise<PainelQuizSolar>>();

async function painelDoPeriodo(periodo: string): Promise<PainelQuizSolar> {
  const guardado = cachePainel.get(periodo);
  if (guardado) {
    const ttl = guardado.painel.meta_ok ? TTL_PAINEL_MS : TTL_PAINEL_META_FORA_MS;
    if (Date.now() - guardado.ts < ttl) return guardado.painel;
  }
  // Uma só leitura por período de cada vez: três abas abrindo juntas viram uma.
  let voando = painelVoando.get(periodo);
  if (!voando) {
    const v: Promise<PainelQuizSolar> = lerPainelQuizSolar(periodo).then((painel) => {
      cachePainel.set(periodo, { painel, ts: Date.now() });   // falha de banco não entra no cache
      return painel;
    }).finally(() => { if (painelVoando.get(periodo) === v) painelVoando.delete(periodo); });
    painelVoando.set(periodo, v);
    voando = v;
  }
  return voando;
}

/** Para os testes: o cache em módulo faria a ordem dos testes importar. */
export function limparCachesSolar(): void {
  cachePlanilha = null; planilhaVoando = null; cacheTrello = null;
  cachePainel.clear(); painelVoando.clear();
}

/** O mesmo casador do `GET /gerador/trello` (casarCartao), aplicado ao quadro já carregado. */
function cartaoDaObra(q: Quadro | null, o: ObraBruta): { lista: string | null; url: string | null } | null {
  if (!q) return null;
  const num = o.codigo.replace(/\D/g, '');
  const nomes = [o.cliente, o.homologacao].filter((n, i, a) => n && a.indexOf(n) === i);
  for (const nome of nomes) {
    const { c } = casarCartao(q.cartoes, nome, num);
    if (c) return { lista: q.listas.get(c.idList) || null, url: c.shortUrl || c.url || null };
  }
  return null;
}

// ── Marcas (system_state) ────────────────────────────────────────────────────

const chaveObra = (codigo: string) => `${PREFIXO_OBRA}${codigo.replace(/\D/g, '')}`;

async function lerMarcas(codigos: string[]): Promise<Map<string, Marcas>> {
  const mapa = new Map<string, Marcas>();
  for (let i = 0; i < codigos.length; i += POR_CONSULTA) {
    const lote = codigos.slice(i, i + POR_CONSULTA);
    const { data, error } = await supabase.from('system_state')
      .select('key, value').in('key', lote.map(chaveObra));
    if (error) throw error;
    for (const l of (data ?? []) as Array<{ key: string; value: unknown }>) {
      mapa.set(l.key, marcasDe(l.value));
    }
  }
  return mapa;
}

// ── Quem está chamando ───────────────────────────────────────────────────────

function quem(req: Request): { nome: string; socio: boolean } {
  const nome = String((req as any).consultor?.nome || '');
  return { nome, socio: ehSocio(nome) };
}

const querFresco = (req: Request, socio: boolean) => socio && String(req.query.fresco || '') === '1';

function erroPlanilha(res: Response, err: any): void {
  logger.error('gerador-solar', 'sem planilha e sem cópia', String(err?.message || err));
  res.status(502).json({ ok: false, error: 'não consegui ler a planilha agora. Tente de novo em instantes.' });
}

// ── Rotas ────────────────────────────────────────────────────────────────────

export function mountSolar(router: Router): void {
  // ── Painel do quiz /io/solar: funil, qualidade dos leads, custo por anúncio ─
  // Os mesmos números de GET /admin/solar/quiz-funil, que exige o login de
  // administrador do SolarDoc (o Gerador não tem). Contagem e nota todo
  // consultor vê; GASTO e custo só sócio: para consultor a chave nem existe.
  router.get('/solar/painel', exigeConsultor, async (req: Request, res: Response) => {
    const { socio } = quem(req);
    const pedido = String(req.query.period || '');
    const periodo = (PERIODOS_PAINEL as readonly string[]).includes(pedido) ? pedido : '7dias';
    try {
      const painel = await painelDoPeriodo(periodo);
      // Resposta com dinheiro de sócio não pode ficar guardada em proxy nem no navegador.
      res.set('Cache-Control', 'no-store');
      res.json(respostaDoPainel(painel, socio));
    } catch (err: any) {
      logger.error('gerador-solar', 'painel do quiz falhou', String(err?.message || err));
      res.status(502).json({ ok: false, error: 'não consegui ler o painel agora. Tente de novo em instantes.' });
    }
  });

  // ── Lista de obras ────────────────────────────────────────────────────────
  router.get('/solar/obras', exigeConsultor, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const fresco = querFresco(req, socio);
    let pl: { dados: CachePlanilha; atual: boolean };
    try { pl = await planilha(fresco); } catch (err) { erroPlanilha(res, err); return; }

    const agora = new Date();
    const hoje = hojeBRT(agora);
    const visiveis = pl.dados.obras.filter((o) => podeVer(nome, o.consultor));
    const [q, marcasPorChave] = await Promise.all([
      quadro(fresco),
      lerMarcas(visiveis.map((o) => o.codigo)).then((m) => ({ m, ok: true }), (e: any) => {
        // Sem as marcas a lista continua útil; só o "já pedi" some. Avisa na fonte.
        logger.warn('gerador-solar', 'leitura de marcas falhou', String(e?.message || e));
        return { m: new Map<string, Marcas>(), ok: false };
      }),
    ]);

    const montadas = visiveis.map((b) => {
      const o = montarObra(b, hoje);
      const marcas = marcasPorChave.m.get(chaveObra(o.codigo))
        || { depoimentoPedidoEm: null, indicacaoPedidaEm: null, por: null };
      return { o, marcas, trello: cartaoDaObra(q, b) };
    });
    const ordem = ordenarObras(montadas.map((x) => x.o));
    const porCodigo = new Map(montadas.map((x) => [x.o.codigo, x]));

    const obras = ordem.map((o) => {
      const { marcas, trello } = porCodigo.get(o.codigo)!;
      const item: Record<string, unknown> = {
        codigo: o.codigo, cliente: o.cliente, consultor: o.consultor,
        telefone: o.telefone, endereco: o.endereco, cidade: o.cidade, uf: o.uf,
        concessionaria: o.concessionaria, equipe: o.equipe, engenheiro: o.engenheiro,
        sistema: o.sistema, vendaEm: o.vendaEm, etapas: o.etapas,
        etapaAtual: o.etapaAtual, paradoHaDias: o.paradoHaDias,
        trello: trello ? { lista: trello.lista, url: trello.url } : null,
        recebimento: o.recebimento,
      };
      // Dinheiro só para sócio: para consultor a chave nem existe.
      if (socio) item.valores = o.valores;
      item.depoimento = o.depoimento;
      // O texto da origem traz nome de cliente ("#0013 Cleber"), e a venda
      // indicada pode ser de outro consultor: o texto cru é só de sócio.
      item.origem = socio ? o.origem : { tipo: o.origem.tipo, indicadoPor: o.origem.indicadoPor };
      item.marcas = marcas;
      item.pedir = calcularPedir(o, marcas, agora);
      item.linkIndicacao = LINK_INDICACAO;
      return item;
    });

    res.json({
      ok: true,
      atualizadoEm: new Date(pl.dados.ts).toISOString(),
      fonte: { planilha: pl.atual, trello: !!q, marcas: marcasPorChave.ok },
      verTudo: socio,
      consultor: nome,
      resumo: resumirObras(ordem, socio),
      obras,
    });
  });

  // ── Marcar "pedi depoimento" / "pedi indicação" ───────────────────────────
  router.post('/solar/obras/marcar', exigeConsultor, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    const b = (req.body || {}) as { codigo?: unknown; tipo?: unknown; desfazer?: unknown };
    const campo = b.tipo === 'depoimento_pedido' ? 'depoimentoPedidoEm'
      : b.tipo === 'indicacao_pedida' ? 'indicacaoPedidaEm' : null;
    const codigoRaw = String(b.codigo ?? '').trim();
    if (!campo || !/^#?\d{1,6}$/.test(codigoRaw)) {
      res.status(400).json({ ok: false, error: 'pedido inválido: informe codigo e tipo (depoimento_pedido ou indicacao_pedida).' });
      return;
    }
    const codigo = codigoCanonico(codigoRaw);
    let pl: { dados: CachePlanilha; atual: boolean };
    try { pl = await planilha(false); } catch (err) { erroPlanilha(res, err); return; }
    // Venda inexistente e venda de outro consultor dão a MESMA resposta: quem
    // não pode ver não descobre que o código existe.
    const venda = pl.dados.obras.find((o) => codigoCanonico(o.codigo) === codigo);
    if (!venda || !(socio || podeVer(nome, venda.consultor))) {
      res.status(404).json({ ok: false, error: 'venda não encontrada' });
      return;
    }
    try {
      // LER, MESCLAR, GRAVAR não é atômico: duas marcas simultâneas da MESMA
      // venda (dois cliques em abas diferentes no mesmo segundo) podem perder uma
      // delas. Aceitável aqui: a marca é só um lembrete de "já pedi", quem marca é
      // uma pessoa por venda, e a perda se corrige com um novo clique. Uma RPC ou
      // um jsonb_set atômico custaria uma migration em produção sem aliviar dor.
      const chave = chaveObra(venda.codigo);
      const { data, error } = await supabase.from('system_state')
        .select('key, value').eq('key', chave).maybeSingle();
      if (error) throw error;
      const atual = (data?.value && typeof data.value === 'object' ? data.value : {}) as Record<string, unknown>;
      const novo: Record<string, unknown> = { ...atual };
      const agora = new Date().toISOString();
      if (b.desfazer === true) delete novo[campo];
      else novo[campo] = agora;
      novo.por = nome;
      const { error: erroGravar } = await supabase.from('system_state').upsert(
        { key: chave, value: novo, updated_at: agora },
        { onConflict: 'key' },
      );
      if (erroGravar) throw erroGravar;
      res.json({ ok: true, marcas: marcasDe(novo) });
    } catch (err: any) {
      logger.error('gerador-solar', 'marcar falhou', String(err?.message || err));
      res.status(500).json({ ok: false, error: 'não consegui gravar a marca agora.' });
    }
  });

  // ── Mapa de cidades atendidas ─────────────────────────────────────────────
  // Agregado e SEM dado pessoal: pode aparecer no celular na frente do cliente.
  // Por isso conta todas as vendas, não só as do consultor.
  router.get('/solar/mapa', exigeConsultor, async (req: Request, res: Response) => {
    const { socio } = quem(req);
    let pl: { dados: CachePlanilha; atual: boolean };
    try { pl = await planilha(querFresco(req, socio)); } catch (err) { erroPlanilha(res, err); return; }
    const hoje = hojeBRT(new Date());
    const { cidades, semCoordenada, semCoordenadaLista } = montarMapa(pl.dados.obras.map((b) => montarObra(b, hoje)));
    // Nenhum texto livre da planilha chega a consultor comum: para ele só a
    // contagem. O texto cru da coluna CIDADE vai só para sócio.
    res.json({ ok: true, cidades, semCoordenada, ...(socio ? { semCoordenadaLista } : {}) });
  });

  // ── Indicações: ranking da planilha + o que chegou pelo formulário ────────
  router.get('/solar/indicacoes', exigeConsultor, async (req: Request, res: Response) => {
    const { nome, socio } = quem(req);
    let obras: ObraMontada[] = [];
    let planilhaOk = true;
    try {
      const pl = await planilha(querFresco(req, socio));
      planilhaOk = pl.atual;
      const hoje = hojeBRT(new Date());
      obras = pl.dados.obras.filter((o) => podeVer(nome, o.consultor)).map((b) => montarObra(b, hoje));
    } catch (err: any) {
      planilhaOk = false;
      logger.warn('gerador-solar', 'indicacoes sem planilha', String(err?.message || err));
    }

    // Nome de quem indicou: o do cliente com esse código (se o chamador pode ver
    // a venda dele) e, na falta, o escrito na origem ("#0013 Cleber").
    const nomes = new Map<string, string>();
    for (const o of obras) {
      if (o.cliente) nomes.set(codigoCanonico(o.codigo), o.cliente);
    }
    for (const o of obras) {
      if (o.origem.tipo === 'indicacao' && o.origem.indicadoPor && !nomes.has(o.origem.indicadoPor)) {
        const n = nomeNaOrigem(o.origem.texto);
        if (n) nomes.set(o.origem.indicadoPor, n);
      }
    }
    // Consultor comum: só entra no ranking quem indicou E é cliente dele, e a
    // lista de vendas traz só as vendas dele (`obras` já vem filtrada).
    const indicadores = socio ? undefined : new Set(obras.map((o) => codigoCanonico(o.codigo)));

    // `io_indicacoes` não tem consultor: não há como separar o que é de quem.
    // Então "recebidas" é só de sócio; consultor comum recebe lista vazia.
    let recebidas: Array<Record<string, unknown>> = [];
    if (socio) try {
      // Colunas listadas uma a uma: `indicador_pix` não entra nem para sócio, e
      // o telefone do indicador só entra para sócio.
      const colunas = ['indicado_nome', 'indicado_telefone', 'indicador_nome', 'origem', 'status', 'created_at']
        .concat(socio ? ['indicador_telefone'] : []).join(', ');
      const { data, error } = await supabase.from('io_indicacoes')
        .select(colunas).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      recebidas = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => {
        const item: Record<string, unknown> = {
          indicadoNome: r.indicado_nome ?? null,
          indicadoTelefone: r.indicado_telefone ?? null,
          indicadorNome: r.indicador_nome ?? null,
          origem: r.origem ?? null,
          status: r.status ?? null,
          criadoEm: r.created_at ?? null,
        };
        if (socio) item.indicadorTelefone = r.indicador_telefone ?? null;
        return item;
      });
    } catch (err: any) {
      logger.error('gerador-solar', 'leitura de io_indicacoes falhou', String(err?.message || err));
      res.status(500).json({ ok: false, error: 'não consegui ler as indicações agora.' });
      return;
    }

    res.json({ ok: true, fonte: { planilha: planilhaOk }, ranking: montarRanking(obras, nomes, indicadores), recebidas });
  });
}
