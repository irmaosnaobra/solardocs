import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { supabaseGerador } from '../utils/supabaseGerador';
import { logger } from '../utils/logger';
import { exigeConsultor } from './geradorDossie';
import { planilha, comLimite, painelDoPeriodo } from './geradorSolar';
import { lerTudo } from '../services/io/painelQuizSolar';
import { ehSocio } from '../services/gerador/solarObras';
import { chavePosVenda, POS_VENDA_PREFIX } from '../services/agenda/posVendaEletroposto';
import { ehOrigemEletroposto } from '../services/agenda/origemEtiqueta';
import {
  chaveDoPeriodo, montarDashboard, montarNegocio, resumirTrafego,
  type DashboardBruto, type CardBruto, type PropostaBruta, type LeadQuizBruto, type TrafegoResumo,
} from '../services/gerador/dashboardPuro';

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD do /gerador (tela inicial). Montado dentro de /gerador.
//
// Duas rotas, para a primeira abrir rápido:
//   GET /dashboard          só banco (agenda, funil, time, pendências)
//   GET /dashboard/negocio  Planilha Mestre, pós-venda e painel do quiz
//
// CACHE GUARDA DADO BRUTO, NUNCA RESPOSTA. O corte por usuário (consultor comum
// só vê o que é dele e nunca recebe dinheiro) é feito a cada requisição, depois
// do cache, sem mutar o que está guardado. Assim a resposta de um sócio nunca é
// servida a um consultor, qualquer que seja a ordem dos pedidos.
// O papel vem do TOKEN (`req.consultor`), nunca de parâmetro ou corpo.
// ─────────────────────────────────────────────────────────────────────────────

const TTL_MS = 90_000;
const POR_CONSULTA = 100;   // 100 ids de pós-venda = URL curta, bem abaixo do corte de 1000 linhas

/** Mutável só para os testes encurtarem o limite. */
export const limitesDashboard = { painelMs: 6_000 };

// ── Banco (cache de 90 s do dado bruto) ──────────────────────────────────────

interface Foto extends DashboardBruto { ts: number }
let cacheFoto: Foto | null = null;
let fotoVoando: Promise<Foto> | null = null;

/** Lê em páginas (o PostgREST corta em 1000 linhas e ignora `.limit()`), sempre
 *  com ordem estável. `agendamentos` mora no banco do GERADOR, como `propostas`
 *  e `leads_meta`. Sem telefone: a tela nunca mostra, então nem sai do banco. */
async function lerFoto(): Promise<Foto> {
  const agora = Date.now();
  // Janela de 90 dias em Brasília, com folga de um dia: o corte fino é no JS.
  const desde90 = new Date(agora - 91 * 86_400_000).toISOString();
  const desde8 = new Date(agora - 8 * 86_400_000).toISOString();
  const [cards, propostas, leads] = await Promise.all([
    lerTudo<CardBruto>((de, ate) => supabaseGerador.from('agendamentos')
      .select('id, quando, status, vendedor_nome, cliente_nome, cidade, created_at, created_by')
      .order('id', { ascending: true }).range(de, ate)),
    lerTudo<PropostaBruta>((de, ate) => supabaseGerador.from('propostas')
      .select('codigo, consultor_nome, created_at').gte('created_at', desde90)
      .order('created_at', { ascending: true }).order('codigo', { ascending: true }).range(de, ate)),
    // No LIKE o "_" é curinga: o filtro de verdade é o startsWith no módulo puro.
    lerTudo<LeadQuizBruto>((de, ate) => supabaseGerador.from('leads_meta')
      .select('lead_id, created_time, field_data, agendado_id, consultor')
      .like('lead_id', 'quiz_%').gte('created_time', desde8)
      .order('created_time', { ascending: true }).order('lead_id', { ascending: true }).range(de, ate)),
  ]);
  return { cards, propostas, leads, ts: Date.now() };
}

async function foto(): Promise<Foto> {
  if (cacheFoto && Date.now() - cacheFoto.ts < TTL_MS) return cacheFoto;
  // Uma só leitura por vez: três telas abrindo juntas viram uma.
  let voando = fotoVoando;
  if (!voando) {
    const p: Promise<Foto> = lerFoto().then((f) => { cacheFoto = f; return f; })   // falha de banco não entra no cache
      .finally(() => { if (fotoVoando === p) fotoVoando = null; });
    fotoVoando = p;
    voando = p;
  }
  return voando;
}

// ── Pós-venda do eletroposto (cache de 90 s) ─────────────────────────────────

let cachePosVenda: { chave: string; registros: Map<number, unknown>; ts: number } | null = null;

async function registrosDePosVenda(ids: number[]): Promise<Map<number, unknown>> {
  const chave = ids.join(',');
  if (cachePosVenda && cachePosVenda.chave === chave && Date.now() - cachePosVenda.ts < TTL_MS) return cachePosVenda.registros;
  const registros = new Map<number, unknown>();
  for (let i = 0; i < ids.length; i += POR_CONSULTA) {
    const { data, error } = await supabase.from('system_state')
      .select('key, value').in('key', ids.slice(i, i + POR_CONSULTA).map(chavePosVenda));
    if (error) throw error;
    for (const l of (data ?? []) as Array<{ key: string; value: unknown }>) {
      if (!String(l.key).startsWith(POS_VENDA_PREFIX)) continue;
      const id = Number(String(l.key).slice(POS_VENDA_PREFIX.length));
      if (Number.isInteger(id)) registros.set(id, l.value);
    }
  }
  cachePosVenda = { chave, registros, ts: Date.now() };
  return registros;
}

/** Para os testes: o cache em módulo faria a ordem dos testes importar. */
export function limparCachesDashboard(): void {
  cacheFoto = null; fotoVoando = null; cachePosVenda = null;
}

function quem(req: Request): { nome: string; socio: boolean } {
  const nome = String((req as any).consultor?.nome || '');
  return { nome, socio: ehSocio(nome) };
}

// ── Rotas ────────────────────────────────────────────────────────────────────

export function mountDashboard(router: Router): void {
  router.get('/dashboard', exigeConsultor, async (req: Request, res: Response) => {
    const q = quem(req);
    const chave = chaveDoPeriodo(req.query.periodo);
    try {
      const f = await foto();
      // Resposta de sócio e de consultor diferem: não pode ficar em proxy nem no navegador.
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, geradoEm: new Date(f.ts).toISOString(), ...montarDashboard(f, q, chave, new Date()) });
    } catch (err: any) {
      logger.error('gerador-dashboard', 'leitura do dashboard falhou', String(err?.message || err));
      res.status(502).json({ ok: false, error: 'não consegui ler o dashboard agora. Tente de novo em instantes.' });
    }
  });

  router.get('/dashboard/negocio', exigeConsultor, async (req: Request, res: Response) => {
    const q = quem(req);
    const chave = chaveDoPeriodo(req.query.periodo);
    let f: Foto;
    try { f = await foto(); } catch (err: any) {
      logger.error('gerador-dashboard', 'leitura do negócio falhou', String(err?.message || err));
      res.status(502).json({ ok: false, error: 'não consegui ler o negócio agora. Tente de novo em instantes.' });
      return;
    }
    const idsFechados = f.cards.filter((c) => String(c.status ?? '').trim().toLowerCase() === 'fechou' && ehOrigemEletroposto(c.created_by))
      .map((c) => c.id).sort((a, b) => a - b);

    // Cada fonte falha sozinha: o resto da tela não cai por causa dela.
    const [registros, pl, trafego] = await Promise.all([
      registrosDePosVenda(idsFechados).then((m) => ({ m, ok: true }), (e: any) => {
        // Sem os registros as vendas ainda contam, só sem valor e com a data do card.
        logger.warn('gerador-dashboard', 'pós-venda falhou', String(e?.message || e));
        return { m: new Map<number, unknown>(), ok: false };
      }),
      planilha(false).then((p) => p.dados.obras, (e: any) => {
        logger.warn('gerador-dashboard', 'planilha fora', String(e?.message || e));
        return null;
      }),
      // Gasto da Meta é dinheiro da casa: consultor comum nem dispara a chamada.
      q.socio
        // `.catch` depois do `.then`: painel malformado também cai aqui, não derruba a rota.
        ? comLimite(() => painelDoPeriodo('30dias'), limitesDashboard.painelMs, 'painel').then(resumirTrafego).catch((e: any): TrafegoResumo => {
          logger.warn('gerador-dashboard', 'painel fora', String(e?.message || e));
          return { rotulo: 'Últimos 30 dias', meta_ok: false };
        })
        : Promise.resolve(null),
    ]);

    try {
      const corpo = montarNegocio({
        planilha: pl, cards: f.cards, registros: registros.m, posVendaOk: registros.ok,
        trafego, quem: q, chave, agora: new Date(),
      });
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, geradoEm: new Date(f.ts).toISOString(), ...corpo });
    } catch (err: any) {
      logger.error('gerador-dashboard', 'conta do negócio falhou', String(err?.message || err));
      res.status(502).json({ ok: false, error: 'não consegui montar o negócio agora. Tente de novo em instantes.' });
    }
  });
}

