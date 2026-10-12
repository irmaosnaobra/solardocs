import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import { aiLimiter } from '../middleware/rateLimiter';
import { exigeConsultor } from './geradorDossie';
import { ehSocio } from '../services/gerador/solarObras';
import { chavePosVenda } from '../services/agenda/posVendaEletroposto';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import {
  FIN_PREFIX, ID_LANCAMENTO, chaveLancamento, prefixoDoCard,
  catalogoFinanceiro, montarLancamento, marcarApagado, totais, mascararTotais, visaoDoConsultor,
  possiveisDuplicados, centavosDeReais, lancamentoDe, ordenarLancamentos, semHistoricoDeSaida,
  type Lancamento, type Duplicado, type ArquivoLancamento,
} from '../services/gerador/financeiroCliente';
import { subirComprovante, assinarComprovante } from '../services/gerador/financeiroArquivos';
import { lerComprovante, type SugestaoLeitura } from '../services/gerador/financeiroLeitura';

// ─────────────────────────────────────────────────────────────────────────────
// FINANCEIRO POR CLIENTE. Montado dentro de /gerador.
//
// Um card vendido da agenda (id inteiro) tem as suas ENTRADAS e SAÍDAS de
// dinheiro, cada uma com o comprovante. Mora no `system_state` do banco
// PRINCIPAL (`fin:<cardId>:<id>`) e num bucket privado do mesmo banco.
//
// NADA é escrito em `agendamentos`: aquela tabela é legível pela chave pública
// que está no HTML, e valor de custo ali vazaria.
//
// QUEM VÊ O QUÊ é decidido AQUI, a cada requisição. Sócio vê tudo. Quem não é
// sócio vê e lança só ENTRADA, e só edita e apaga a que ele mesmo criou: saída,
// resultado e margem saem `null`, e uma saída nem aparece como "possível
// duplicado". O autor é sempre o do token;
// nome que venha no corpo é ignorado.
//
// LOG: só código de erro e id do card. Nunca base64, nome de arquivo, conteúdo
// lido nem valores.
// ─────────────────────────────────────────────────────────────────────────────

const LOG = 'gerador-financeiro';
const MAX_IDS_RESUMO = 600;
const PAGINA = 1000;

function quem(req: Request): { nome: string; socio: boolean } {
  const nome = String((req as any).consultor?.nome || '');
  return { nome, socio: ehSocio(nome) };
}

/** Resposta com dinheiro não pode ficar guardada em proxy nem no navegador.
 *  Vem ANTES do login, para o 401 e o 403 também saírem sem cache. */
function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function idDoCard(req: Request, res: Response): number | null {
  const bruto = String(req.params.cardId ?? '');
  const id = /^\d{1,15}$/.test(bruto) ? Number(bruto) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: 'id inválido' });
    return null;
  }
  return id;
}

function falhou(res: Response, onde: string, err: any, card?: number): void {
  logger.error(LOG, `${onde} falhou`, { card: card ?? null, erro: String(err?.message || err) });
  res.status(500).json({ error: 'falha' });
}

// ── Banco ────────────────────────────────────────────────────────────────────

/** Todas as linhas cujo `key` começa com o prefixo. O PostgREST corta em 1000
 *  linhas e ignora o `.limit()`: pagina por `range` até acabar, com ordem fixa
 *  para as páginas não se sobreporem. */
async function lerPorPrefixo(prefixo: string): Promise<Lancamento[]> {
  const achados: Lancamento[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase.from('system_state')
      .select('key, value')
      .like('key', `${prefixo}%`)
      .order('key', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw error;
    const parte = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const linha of parte) {
      const l = lancamentoDe(linha.value);
      // A chave manda: a linha só vale se o que está dentro dela concorda.
      if (l && linha.key === chaveLancamento(l.card_id, l.id)) achados.push(l);
    }
    if (parte.length < PAGINA) break;
  }
  return achados;
}

const lerDoCard = (cardId: number): Promise<Lancamento[]> => lerPorPrefixo(prefixoDoCard(cardId));

/** O lançamento e o `updated_at` com que ele foi lido (a trava da gravação). */
type Lido = { l: Lancamento; carimbo: string | null };

async function lerUm(cardId: number, id: string): Promise<Lido | null> {
  const { data, error } = await supabase.from('system_state')
    .select('key, value, updated_at').eq('key', chaveLancamento(cardId, id)).maybeSingle();
  if (error) throw error;
  const linha = data as { value?: unknown; updated_at?: unknown } | null;
  const l = lancamentoDe(linha?.value);
  if (!l || l.card_id !== cardId || l.id !== id) return null;
  return { l, carimbo: typeof linha?.updated_at === 'string' ? linha.updated_at : null };
}

/** Valor da venda em CENTAVOS. No `pos_venda:<id>` ele está em REAIS. */
async function valorDaVenda(cardId: number): Promise<number | null> {
  const { data, error } = await supabase.from('system_state')
    .select('key, value').eq('key', chavePosVenda(cardId)).maybeSingle();
  if (error) throw error;
  const valor = ((data as { value?: { valor?: unknown } | null } | null)?.value ?? null)?.valor;
  return typeof valor === 'number' ? centavosDeReais(valor) : null;
}

// ── Gravação com trava otimista ──────────────────────────────────────────────
// Ler, conferir e gravar não é atômico. Com upsert cego, editar e apagar ao
// mesmo tempo ressuscitava o apagado, e de duas edições juntas uma sumia sem
// rastro. Agora:
//  · criar é INSERT: se a chave já existe (23505), outra requisição chegou
//    primeiro com o mesmo `id`;
//  · editar e apagar são UPDATE que só casam se o `updated_at` ainda é o que foi
//    lido. Nenhuma linha afetada = alguém gravou no meio = 409 `mudou`.

/** Um `updated_at` novo e DISTINTO do lido, em ISO com milissegundos. Duas
 *  gravações no mesmo milissegundo teriam o mesmo carimbo e a trava não veria. */
function carimboNovo(lido: string | null): string {
  const agora = Date.now();
  const antes = lido ? Date.parse(lido) : NaN;
  return new Date(Number.isFinite(antes) && agora <= antes ? antes + 1 : agora).toISOString();
}

/** `true` se criou; `false` se a chave já existia. */
async function inserir(l: Lancamento): Promise<boolean> {
  const { error } = await supabase.from('system_state')
    .insert({ key: chaveLancamento(l.card_id, l.id), value: l, updated_at: carimboNovo(null) });
  if (!error) return true;
  if (String((error as { code?: unknown }).code ?? '') === '23505') return false;
  throw error;
}

/** `true` se gravou; `false` se a linha mudou desde a leitura (ou sumiu). */
async function atualizar(l: Lancamento, carimboLido: string | null): Promise<boolean> {
  const base = supabase.from('system_state')
    .update({ value: l, updated_at: carimboNovo(carimboLido) })
    .eq('key', chaveLancamento(l.card_id, l.id));
  const { data, error } = await (carimboLido === null ? base.is('updated_at', null) : base.eq('updated_at', carimboLido)).select('key');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

// ── Saída ────────────────────────────────────────────────────────────────────

type ArquivoComUrl = ArquivoLancamento & { url: string | null };
type LancamentoDeSaida = Omit<Lancamento, 'arquivo'> & { arquivo: ArquivoComUrl | null };

/** A `url` entra numa CÓPIA: o objeto gravado nunca leva link que vence. */
async function comUrl(l: Lancamento): Promise<LancamentoDeSaida> {
  if (!l.arquivo) return { ...l, arquivo: null };
  return { ...l, arquivo: { ...l.arquivo, url: await assinarComprovante(l.arquivo.path, 3600) } };
}

/** O lançamento como ESTA pessoa pode ver. Quem não é sócio só chega aqui com
 *  entrada, mas uma entrada pode ter sido saída um dia: o histórico desse tempo
 *  não sai. */
const paraQuemPediu = (l: Lancamento, socio: boolean): Promise<LancamentoDeSaida> =>
  comUrl(socio ? l : semHistoricoDeSaida(l));

/** Saída é assunto de sócio até quando aparece como "possível duplicado". */
const duplicadosVisiveis = (ds: Duplicado[], socio: boolean): Duplicado[] =>
  (socio ? ds : ds.filter((d) => d.tipo === 'entrada'));

/** Os totais do card AGORA e o valor da venda de agora, o mesmo número que o
 *  GET devolve, para a tela conferir uma conta com a outra. */
async function contaDoCard(cardId: number, socio: boolean) {
  const [ls, venda] = await Promise.all([lerDoCard(cardId), valorDaVenda(cardId)]);
  const t = totais(ls, venda);
  return { valor_venda_centavos: venda, totais: socio ? t : mascararTotais(t) };
}

/** O limite de IA só conta quando a IA vai ser chamada. Subir comprovante sem
 *  leitura não gasta os 10 por minuto. */
function limiteSeForLer(req: Request, res: Response, next: NextFunction): void {
  if ((req.body as { ler?: unknown } | null | undefined)?.ler === true) { aiLimiter(req, res, next); return; }
  next();
}

// ── Rotas ────────────────────────────────────────────────────────────────────

export function mountFinanceiro(router: Router): void {
  // ── Resumo de vários cards (a lista de vendidos) ──────────────────────────
  // Registrada ANTES de `/financeiro/:cardId`, senão "resumo" vira um cardId.
  router.get('/financeiro/resumo', semCache, exigeConsultor, async (req: Request, res: Response) => {
    const { socio } = quem(req);
    const partes = String(req.query.ids ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!partes.length || partes.some((p) => !/^\d{1,15}$/.test(p) || Number(p) <= 0)) {
      res.status(400).json({ error: 'ids inválidos' }); return;
    }
    const ids = new Set(partes.map(Number));   // repetido conta uma vez
    if (ids.size > MAX_IDS_RESUMO) { res.status(400).json({ error: 'ids demais' }); return; }
    try {
      // UMA varredura do prefixo `fin:`, filtrada aqui pelos ids pedidos. 600
      // consultas (uma por card) ou um `or` com 600 prefixos estourariam a URL.
      const todos = await lerPorPrefixo(FIN_PREFIX);
      const resumo: Record<string, { recebido: number; gasto: number | null; qtd: number }> = {};
      for (const l of todos) {
        if (l.apagado || !ids.has(l.card_id)) continue;
        if (!Number.isInteger(l.valor_centavos) || l.valor_centavos <= 0) continue;
        // Para quem não é sócio a saída não existe: nem no valor, nem na contagem.
        if (!socio && l.tipo !== 'entrada') continue;
        const r = (resumo[String(l.card_id)] ??= { recebido: 0, gasto: socio ? 0 : null, qtd: 0 });
        if (l.tipo === 'entrada') r.recebido += l.valor_centavos;
        else if (r.gasto !== null) r.gasto += l.valor_centavos;
        r.qtd++;
      }
      res.json({ ok: true, socio, resumo });
    } catch (err) { falhou(res, 'resumo', err); }
  });

  // ── O financeiro de um card ───────────────────────────────────────────────
  router.get('/financeiro/:cardId', semCache, exigeConsultor, async (req: Request, res: Response) => {
    const cardId = idDoCard(req, res);
    if (cardId === null) return;
    const { nome, socio } = quem(req);
    try {
      const [todos, venda] = await Promise.all([lerDoCard(cardId), valorDaVenda(cardId)]);
      // Os totais saem de TODOS os lançamentos; a máscara vem depois.
      const completos = totais(todos, venda);
      const ordenados = ordenarLancamentos(todos);
      const visao = socio ? { lancamentos: ordenados, totais: completos } : visaoDoConsultor(ordenados, completos);
      res.json({
        ok: true,
        socio,
        autor: nome,
        valor_venda_centavos: venda,
        lancamentos: await Promise.all(visao.lancamentos.map(comUrl)),
        totais: visao.totais,
        catalogo: catalogoFinanceiro(),
      });
    } catch (err) { falhou(res, 'leitura', err, cardId); }
  });

  // ── Sobe UM comprovante e, se pedirem, lê com a IA ────────────────────────
  // O login vem PRIMEIRO: pedido sem token não chega ao limitador. E o limite
  // de IA (10 por minuto por IP) só entra quando `ler` é true.
  router.post('/financeiro/:cardId/arquivo', semCache, exigeConsultor, limiteSeForLer, async (req: Request, res: Response) => {
    const cardId = idDoCard(req, res);
    if (cardId === null) return;
    const { socio } = quem(req);
    const b = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as Record<string, unknown>;
    if (typeof b.base64 !== 'string' || !b.base64 || typeof b.media_type !== 'string'
      || (b.nome !== undefined && typeof b.nome !== 'string')) {
      res.status(400).json({ error: 'corpo_invalido' }); return;
    }
    try {
      // O banco primeiro: se ele estiver fora, falha ANTES de deixar um arquivo
      // solto no bucket.
      const existentes = await lerDoCard(cardId);

      const subida = await subirComprovante(cardId, { base64: b.base64, media_type: b.media_type, nome: b.nome });
      if (!subida.ok) {
        const status = subida.erro === 'bucket_indisponivel' ? 503 : subida.erro === 'armazenamento_falhou' ? 502 : 400;
        res.status(status).json({ error: subida.erro }); return;
      }
      const { bytes, ...arquivo } = subida.arquivo;

      let leitura: 'ok' | 'nao_e_comprovante' | 'falhou' | 'pulada' = 'pulada';
      let sugestao: SugestaoLeitura | null = null;
      if (b.ler === true) {
        // Falha na leitura NÃO derruba o upload: o arquivo já está guardado e a
        // pessoa preenche à mão.
        try {
          const r = await lerComprovante({ bytes, media_type: arquivo.tipo, hojeBr: diaDeBrasilia(Date.now()) });
          if (!r.ok) leitura = 'falhou';
          else if (!r.eh_comprovante) leitura = 'nao_e_comprovante';
          else { leitura = 'ok'; sugestao = r.sugestao; }
        } catch {
          leitura = 'falhou';
        }
      }

      const duplicados: Duplicado[] = duplicadosVisiveis(
        existentes
          .filter((l) => !l.apagado && l.arquivo?.sha256 === arquivo.sha256)
          .map((l) => ({ id: l.id, tipo: l.tipo, valor_centavos: l.valor_centavos, data: l.data, categoria: l.categoria, motivo: 'mesmo_arquivo' as const })),
        socio,
      );

      res.json({
        ok: true,
        arquivo: { ...arquivo, url: await assinarComprovante(arquivo.path, 3600) },
        leitura,
        sugestao,
        duplicados,
      });
    } catch (err) { falhou(res, 'upload', err, cardId); }
  });

  // ── Cria ou edita UM lançamento ───────────────────────────────────────────
  // O `id` vem do navegador e é a chave de idempotência: o mesmo pedido duas
  // vezes (toque duplo, rede que caiu e repetiu) é UMA linha.
  router.post('/financeiro/:cardId/lancamento', semCache, exigeConsultor, async (req: Request, res: Response) => {
    const cardId = idDoCard(req, res);
    if (cardId === null) return;
    const { nome, socio } = quem(req);
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) { res.status(400).json({ error: 'corpo_invalido' }); return; }
    const id = (b as { id?: unknown }).id;
    if (typeof id !== 'string' || !ID_LANCAMENTO.test(id)) { res.status(400).json({ error: 'id_invalido' }); return; }

    try {
      // No máximo duas voltas: a segunda só acontece quando a criação perdeu a
      // corrida para outra requisição com o mesmo `id`.
      for (let volta = 0; volta < 2; volta++) {
        const lido = await lerUm(cardId, id);
        const atual = lido?.l ?? null;

        if (!socio) {
          // Quem não é sócio não toca em saída: nem cria, nem edita uma que
          // existe, nem transforma uma entrada em saída.
          const tipoPedido = (b as { tipo?: unknown }).tipo;
          const tipoFinal = tipoPedido !== undefined ? tipoPedido : atual?.tipo;
          if (atual?.tipo === 'saida' || tipoFinal === 'saida') { res.status(403).json({ error: 'so_socio' }); return; }
          // E só edita a entrada que ele mesmo criou.
          if (atual && atual.criado_por !== nome) { res.status(403).json({ error: 'so_autor' }); return; }
        }

        const agoraIso = new Date().toISOString();
        const r = montarLancamento(b, atual, { cardId, autor: nome, agoraIso, hojeBr: diaDeBrasilia(agoraIso) });
        if (!r.ok) { res.status(400).json({ error: r.erro }); return; }

        // Mesmo conteúdo de novo: devolve o que já existe, sem gravar e sem alteração.
        if (!r.criou && !r.mudou.length) {
          res.json({ ok: true, lancamento: await paraQuemPediu(r.lancamento, socio), ...(await contaDoCard(cardId, socio)) });
          return;
        }

        if (r.criou || r.mudou.some((c) => c === 'valor_centavos' || c === 'data' || c === 'arquivo')) {
          const duplicados = duplicadosVisiveis(possiveisDuplicados(r.lancamento, await lerDoCard(cardId)), socio);
          if (duplicados.length && (b as { confirmar_duplicado?: unknown }).confirmar_duplicado !== true) {
            res.status(409).json({ error: 'possivel_duplicado', duplicados }); return;
          }
        }

        if (r.criou) {
          // A chave não existia na leitura. Se agora existe, relê e trata como
          // repetição do mesmo `id`: igual devolve o que existe, diferente
          // segue como edição (com a trava).
          if (!(await inserir(r.lancamento))) continue;
        } else if (!(await atualizar(r.lancamento, lido?.carimbo ?? null))) {
          // Sem `duplicados`: é por isso que a tela distingue este 409 do outro.
          res.status(409).json({ error: 'mudou' }); return;
        }
        res.json({ ok: true, lancamento: await paraQuemPediu(r.lancamento, socio), ...(await contaDoCard(cardId, socio)) });
        return;
      }
      // Criou, perdeu a corrida duas vezes seguidas (a linha apareceu e sumiu):
      // não é caso normal, nada apaga linha. Quem pediu tenta de novo.
      res.status(409).json({ error: 'mudou' });
    } catch (err) { falhou(res, 'lançamento', err, cardId); }
  });

  // ── Apaga (marca) UM lançamento ───────────────────────────────────────────
  // A linha e o arquivo ficam: dinheiro lançado não some, sai da conta com motivo.
  router.post('/financeiro/:cardId/lancamento/:id/apagar', semCache, exigeConsultor, async (req: Request, res: Response) => {
    const cardId = idDoCard(req, res);
    if (cardId === null) return;
    const { nome, socio } = quem(req);
    const id = String(req.params.id ?? '');
    if (!ID_LANCAMENTO.test(id)) { res.status(404).json({ error: 'nao_encontrado' }); return; }
    try {
      const lido = await lerUm(cardId, id);
      if (!lido) { res.status(404).json({ error: 'nao_encontrado' }); return; }
      const atual = lido.l;
      // Sócio apaga qualquer um. Quem não é sócio, só a ENTRADA que ele mesmo criou.
      if (!socio && atual.tipo !== 'entrada') { res.status(403).json({ error: 'so_socio' }); return; }
      if (!socio && atual.criado_por !== nome) { res.status(403).json({ error: 'so_autor' }); return; }

      const agoraIso = new Date().toISOString();
      const r = marcarApagado(atual, { autor: nome, agoraIso }, (req.body as { motivo?: unknown } | null)?.motivo);
      if (!r.ok) { res.status(400).json({ error: r.erro }); return; }
      if (r.mudou && !(await atualizar(r.lancamento, lido.carimbo))) {
        res.status(409).json({ error: 'mudou' }); return;
      }
      res.json({ ok: true, lancamento: await paraQuemPediu(r.lancamento, socio), ...(await contaDoCard(cardId, socio)) });
    } catch (err) { falhou(res, 'apagar', err, cardId); }
  });
}
