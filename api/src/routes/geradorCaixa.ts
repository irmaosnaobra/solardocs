import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';
import { exigeConsultor } from './geradorDossie';
import { caixaIpLimiter, caixaPessoaLimiter } from '../middleware/rateLimiter';
import {
  ErroBanco, lerPaginado, montarConversas, mensagemParaTela, contatosDasLinhas, estadoDaLinha,
  lidsDasLinhas, chaveDaLinha, variantesDaChave, chaveValida, equipeAutorizada, atendimentoDe,
  lerDias, lerLimite, lerCursor, lerHorario, idInicial,
  type LinhaWa, type MapaLid, type PausaLinha,
} from '../services/gerador/caixaWhatsapp';

// ─────────────────────────────────────────────────────────────────────────────
// CAIXA DE ENTRADA da linha 5040 dentro do /gerador. FASE 1: SÓ LEITURA.
// Montada dentro de /gerador. Nenhuma rota escreve, e nada daqui grava no banco
// (nem o logger: ele grava em `error_logs`, então os erros vão só para o console,
// com o código do erro e nada mais).
//
// Duas travas, nesta ordem: `exigeConsultor` (token do Gerador, e-mail de
// consultor confirmado) e `exigeEquipe` (lista fechada por nome, em
// CAIXA_EQUIPE). A segunda existe porque a caixa mostra conversa de cliente.
//
// Texto de mensagem e telefone nunca vão para log. Erro de banco vira 502 com
// mensagem genérica: lista vazia fingindo que não há conversa seria pior.
// ─────────────────────────────────────────────────────────────────────────────

const COLUNAS = 'id, telefone, is_group, from_me, from_api, chat_name, sender_name, tipo, texto, media_url, momment';
const MAX_PAGINAS_LISTA = 25;      // 25 mil mensagens; passou disso, `truncado: true`
const MAX_PAGINAS_PAUSAS = 20;
const LOTE_IN = 100;               // 100 ids/telefones por `in`: URL curta, bem abaixo do corte
const NOVAS_MAX = 500;
const PAUSAS_TTL_MS = 10_000;

const janelaPausaH = (): number => Number(process.env.PAUSA_HUMANA_JANELA_H || 24);

/**
 * Instância da linha IO. Sem a variável não há como separar a linha: erro (502), nunca "todas as linhas".
 * O navegador recebe a mensagem genérica; o motivo exato vai para o console do servidor, para o diagnóstico
 * não virar adivinhação.
 */
function instanciaIO(): string | null {
  const v = (process.env.ZAPI_INSTANCE_ID_IO || '').trim();
  if (!v) console.error('[caixa] ZAPI_INSTANCE_ID_IO não está definida no ambiente: sem ela a caixa não sabe qual é a linha IO e se recusa a ler mensagens (502). Defina a variável na Vercel.');
  return v || null;
}

function semCache(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

function exigeEquipe(req: Request, res: Response, next: NextFunction): void {
  const nome = String((req as any).consultor?.nome || '');
  if (!equipeAutorizada(nome, process.env.CAIXA_EQUIPE)) {
    res.status(403).json({ ok: false, error: 'Esta tela é só para a equipe.', precisa: 'equipe' });
    return;
  }
  next();
}

function falhou(res: Response, err: unknown): void {
  // Só o código. A mensagem do driver pode trazer filtro, telefone ou texto.
  const codigo = err instanceof ErroBanco ? err.codigo : 'interno';
  console.error('[caixa] leitura falhou', codigo);
  res.status(502).json({ ok: false, error: 'Não consegui ler as conversas agora. Tente de novo em instantes.' });
}

function em<T>(lista: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

// ── leituras ─────────────────────────────────────────────────────────────────

async function lerMapaLid(lids: string[]): Promise<MapaLid> {
  const mapa: MapaLid = new Map();
  for (const lote of em(lids, LOTE_IN)) {
    const { data, error } = await supabase.from('wa_lid_telefone').select('lid, telefone, chave').in('lid', lote);
    if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
    for (const r of (data ?? []) as Array<{ lid: string; telefone: string | null; chave: string | null }>) {
      const lid = String(r.lid ?? '').replace(/\D/g, '');
      const tel = String(r.telefone ?? '').replace(/\D/g, '');
      if (lid && r.chave && tel) mapa.set(lid, { chave: r.chave, telefone: tel });
    }
  }
  return mapa;
}

let cachePausas: { ts: number; mapa: Map<string, PausaLinha> } | null = null;

/** Pausas abertas (quem tem gente da equipe dentro). Cache de 10 s: `novas` roda a cada 4 s por aba. */
async function lerPausas(): Promise<Map<string, PausaLinha>> {
  if (cachePausas && Date.now() - cachePausas.ts < PAUSAS_TTL_MS) return cachePausas.mapa;
  // `lerPaginado` tira repetida por `id`; a pausa tem `chave` única e nenhum `id`, então o índice da linha serve.
  const { linhas } = await lerPaginado<PausaLinha & { id: number }>(async (de, ate) => {
    const { data, error } = await supabase.from('atendimento_pausa')
      .select('chave, pausado_em, ultima_fala_humano, ultima_fala_lead')
      .is('liberado_em', null)
      // So a linha IO (ou pausa antiga, sem linha gravada): pausa de contato de outra linha nao e desta caixa.
      .or('linha.eq.io,linha.is.null')
      .order('chave', { ascending: true })
      .range(de, ate);
    return { data: data ? (data as PausaLinha[]).map((p, i) => ({ ...p, id: de + i })) : null, error };
  }, MAX_PAGINAS_PAUSAS);
  const mapa = new Map<string, PausaLinha>();
  for (const p of linhas) if (p.chave) mapa.set(p.chave, p);
  cachePausas = { ts: Date.now(), mapa };
  return mapa;
}

/** Para os testes: o cache em módulo faria a ordem dos testes importar. */
export function limparCachesCaixa(): void { cachePausas = null; }

async function maiorId(inst: string): Promise<number> {
  const { data, error } = await supabase.from('wa_mensagens').select('id').eq('instancia', inst)
    .order('id', { ascending: false }).limit(1);
  if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
  const id = Number((data as Array<{ id: number }> | null)?.[0]?.id);
  return Number.isFinite(id) ? id : 0;
}

// ── rotas ────────────────────────────────────────────────────────────────────

export function mountCaixa(router: Router): void {
  // Limite por IP antes do login, limite por pessoa depois dele (ver middleware/rateLimiter.ts). A caixa fica fora do limitador global.
  const base = [semCache, caixaIpLimiter, exigeConsultor, caixaPessoaLimiter, exigeEquipe] as const;

  // 1) Conversas com atividade nos últimos `dias` (padrão 3, máximo 30).
  router.get('/caixa/conversas', ...base, async (req: Request, res: Response) => {
    const inst = instanciaIO();
    if (!inst) return falhou(res, new ErroBanco('sem-instancia'));
    const dias = lerDias(req.query.dias);
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
    try {
      const { linhas, truncado } = await lerPaginado<LinhaWa>(
        (de, ate) => supabase.from('wa_mensagens').select(COLUNAS)
          .eq('instancia', inst).eq('is_group', false).gte('momment', desde)
          .order('momment', { ascending: false }).order('id', { ascending: false })
          .range(de, ate) as any,
        MAX_PAGINAS_LISTA,
      );
      const [mapa, pausas, cursorBanco] = await Promise.all([
        lerMapaLid(lidsDasLinhas(linhas)),
        lerPausas(),
        linhas.length ? Promise.resolve(0) : maiorId(inst),
      ]);
      const conversas = montarConversas(linhas, mapa, pausas, Date.now(), janelaPausaH());
      const cursor = linhas.length ? Math.max(...linhas.map((l) => l.id)) : cursorBanco;
      res.json({ ok: true, dias, truncado, total_mensagens: linhas.length, cursor, conversas });
    } catch (err) { falhou(res, err); }
  });

  // 2) Mensagens de UM contato, em ordem. Junta o que veio por telefone e por LID.
  router.get('/caixa/conversa', ...base, async (req: Request, res: Response) => {
    const inst = instanciaIO();
    if (!inst) return falhou(res, new ErroBanco('sem-instancia'));
    const chave = String(Array.isArray(req.query.chave) ? req.query.chave[0] : req.query.chave ?? '').trim();
    if (!chaveValida(chave)) { res.status(400).json({ ok: false, error: 'Conversa inválida.' }); return; }
    const limite = lerLimite(req.query.limite);
    const antes = lerHorario(req.query.antes);
    const antesId = lerCursor(req.query.antes_id);
    try {
      let alvos: string[];
      if (chave.startsWith('lid:')) {
        alvos = [chave.slice(4)];
      } else {
        const { data, error } = await supabase.from('wa_lid_telefone').select('lid').eq('chave', chave).limit(50);
        if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
        const lids = ((data ?? []) as Array<{ lid: string }>).map((r) => String(r.lid ?? '').replace(/\D/g, '')).filter(Boolean);
        alvos = [...variantesDaChave(chave), ...lids];
      }
      let q = supabase.from('wa_mensagens').select(COLUNAS)
        .eq('instancia', inst).eq('is_group', false).in('telefone', alvos);
      if (antes) {
        q = antesId !== null
          ? q.or(`momment.lt.${antes},and(momment.eq.${antes},id.lt.${antesId})`)
          : q.lt('momment', antes);
      }
      const { data, error } = await q
        .order('momment', { ascending: false }).order('id', { ascending: false }).limit(limite + 1);
      if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
      const todas = (data ?? []) as LinhaWa[];
      const temMais = todas.length > limite;
      const linhas = todas.slice(0, limite);
      const mapa = await lerMapaLid(lidsDasLinhas(linhas));
      const contato = contatosDasLinhas(linhas, mapa).get(chave) ?? null;
      const pausas = await lerPausas();
      const ordenadas = [...linhas].sort((a, b) => Date.parse(a.momment) - Date.parse(b.momment) || a.id - b.id);
      res.json({
        ok: true,
        chave,
        contato,
        // Sem mensagem deste contato na linha IO, nao devolve estado de atendimento de chave nenhuma.
        atendimento: linhas.length ? atendimentoDe(pausas.get(chave), Date.now(), janelaPausaH()) : null,
        tem_mais: temMais,
        // A tabela `wa_mensagens` não guarda a mensagem citada (só texto, tipo e mídia): sem marcação de resposta.
        mensagens: ordenadas.map(mensagemParaTela),
      });
    } catch (err) { falhou(res, err); }
  });

  // 3) Tudo que chegou ou saiu depois do cursor, de todas as conversas. O cursor
  //    é um id (opaco para a tela), não um horário: `momment` é a hora do
  //    WhatsApp, e mensagem que chega atrasada ficaria antes do cursor para sempre.
  //    A busca recua `SOBREPOSICAO_IDS` e a tela tira a repetida por `id`.
  router.get('/caixa/novas', ...base, async (req: Request, res: Response) => {
    const inst = instanciaIO();
    if (!inst) return falhou(res, new ErroBanco('sem-instancia'));
    const desde = lerCursor(req.query.desde);
    try {
      if (desde === null) {
        // Sem cursor: a tela ainda não tem ponto de partida. Devolve o atual, sem mensagens.
        const cursor = await maiorId(inst);
        res.json({ ok: true, cursor, mais: false, mensagens: [], contatos: {}, atendimento: {} });
        return;
      }
      const { data, error } = await supabase.from('wa_mensagens').select(COLUNAS)
        .eq('instancia', inst).eq('is_group', false).gt('id', idInicial(desde))
        .order('id', { ascending: true }).limit(NOVAS_MAX);
      if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
      const linhas = (data ?? []) as LinhaWa[];
      const mapa = await lerMapaLid(lidsDasLinhas(linhas));
      const pausas = await lerPausas();
      const contatos = contatosDasLinhas(linhas, mapa);
      const mensagens = linhas
        .map((l) => ({ l, chave: chaveDaLinha(l, mapa) }))
        .filter((x): x is { l: LinhaWa; chave: string } => !!x.chave)
        .map((x) => ({ ...mensagemParaTela(x.l), chave: x.chave }));
      const agora = Date.now();
      const atendimento: Record<string, { desde: string }> = {};
      for (const [k, p] of pausas) { const a = atendimentoDe(p, agora, janelaPausaH()); if (a) atendimento[k] = a; }
      const cursor = linhas.length ? Math.max(desde, ...linhas.map((l) => l.id)) : desde;
      res.json({
        ok: true,
        cursor,
        mais: linhas.length >= NOVAS_MAX,
        mensagens,
        contatos: Object.fromEntries(contatos),
        atendimento,
      });
    } catch (err) { falhou(res, err); }
  });

  // 4) Estado da linha (lido do que o monitor gravou: não chama a Z-API) e quem está logado.
  router.get('/caixa/estado', ...base, async (req: Request, res: Response) => {
    try {
      const { data, error } = await supabase.from('system_state').select('value, updated_at')
        .eq('key', 'zapi_io_health').maybeSingle();
      if (error) throw new ErroBanco(String(error.code ?? 'desconhecido'));
      const linha = estadoDaLinha((data as any)?.value ?? null, (data as any)?.updated_at ?? null, Date.now());
      res.json({ ok: true, linha, usuario: { nome: String((req as any).consultor?.nome || '') } });
    } catch (err) { falhou(res, err); }
  });
}

export default mountCaixa;
