import { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { supabase } from '../utils/supabase';
import { waitUntil } from '../utils/waitUntil';
import { verificarWhatsapp } from '../services/nexus/verificaWhatsapp';
import { criarCardEletroposto, criarCardSolar, TABELA_LISTA, type EntradaCard } from '../services/io/listaIgCards';
import { avisarLeadDaLista } from '../services/io/listaIgAviso';
import { avisoEletroposto, avisoNilce, avisoVoltou, linhasDoEletroposto, linhasDoSolar } from '../services/io/listaIgTextos';
import type { PessoaLista } from '../services/io/listaIgVaga';
import { argumentosDaGravacao, lerContato, lerPorta, type Contato, type PortaLida } from './ioInteresseValidar';

// Lista de interesse da Irmãos na Obra (solardoc.app/io/interesse, link da bio do @irmaosnaobra__), 19/11/2026.
// POST /io/solar/lista-interesse (público, 10/min por IP, honeypot) e GET /io/solar/lista-interesse/admin (auth + admin).
// Banco: PRINCIPAL do SolarDoc, tabela io_instagram_interesse, escrita pela io_instagram_gravar (só a service role).
// Depois de gravar, por porta: solar = card MUDO da Nilce + aviso a ela; eletroposto = card mudo (rodízio Thiago/Diego) + aviso
// aos dois, um depois do outro; integrador e mobilidade = só a lista. Telefone de teste: só a lista. A resposta sai logo depois
// de gravar na lista; card e avisos rodam inteiros em waitUntil. Regras do chefe anti-ban em services/io/listaIg*.ts.
// Log sem dado pessoal.

const ERRO_SALVAR = 'Não deu para salvar agora. Tente de novo em instantes.';
const PAGINA = 1000;
const TETO_ADMIN = 5000;
const LOG = '[io-interesse]';

export const ioInteresseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { ok: false, erro: 'Muitas tentativas. Espere um minuto e tente de novo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** O dono do card solar da lista (23/11/2026): a divisão por conta de luz aponta um dos quatro; fora deles, a Nilce. */
const donoDoCardSolar = (d: string): PessoaLista => {
  const n = String(d ?? '').trim().toLowerCase();
  return n === 'giovanna' || n === 'thiago' || n === 'diego' ? n : 'nilce';
};

interface Gravado { id?: string | number; posicao?: number; card_solar_id?: number | null; card_eletroposto_id?: number | null }

/** Card e aviso da porta (solar ou eletroposto). Nunca lança. */
export async function depoisDeGravar(p: PortaLida, c: Contato, g: Gravado, agora = Date.now()): Promise<void> {
  try {
    if (c.teste || g.id === undefined || g.id === null) return;
    const e: EntradaCard = { listaId: g.id, pessoa: c, utm: c.utm };
    if (p.porta === 'solar' && p.solar && !g.card_solar_id) {
      const r = await criarCardSolar(e, p.solar, agora);
      if (r.status === 'voltou') {
        await avisarLeadDaLista({ porta: 'solar', cardId: r.card.id, listaId: g.id, dono: donoDoCardSolar(r.card.dono), voltou: true, texto: avisoVoltou(c, 'solar', linhasDoSolar(p.solar), r.card) });
        return;
      }
      if (r.status !== 'ok') { if (r.status === 'erro') console.error(LOG, 'card solar não nasceu'); return; }
      await avisarLeadDaLista({ porta: 'solar', cardId: r.card.id, listaId: g.id, dono: donoDoCardSolar(r.card.dono), texto: avisoNilce(c, p.solar, r.card) });
    }
    if (p.porta === 'eletroposto' && p.caminho && p.respostas && !g.card_eletroposto_id) {
      const r = await criarCardEletroposto(e, p.caminho, p.respostas, agora);
      const dono: PessoaLista = r.status !== 'pulou' && r.status !== 'erro' && r.card.dono.trim().toLowerCase() === 'diego' ? 'diego' : 'thiago';
      if (r.status === 'voltou') {
        await avisarLeadDaLista({
          porta: 'eletroposto', cardId: r.card.id, listaId: g.id, dono, voltou: true,
          texto: avisoVoltou(c, 'eletroposto', linhasDoEletroposto(p.caminho, p.respostas), r.card),
        });
        return;
      }
      if (r.status !== 'ok') { if (r.status === 'erro') console.error(LOG, 'card de eletroposto não nasceu'); return; }
      await avisarLeadDaLista({
        porta: 'eletroposto', cardId: r.card.id, listaId: g.id, dono, texto: avisoEletroposto(c, p.caminho, p.respostas, r.card),
      });
    }
  } catch (err: any) {
    console.error(LOG, 'depois de gravar falhou', err?.code, err?.message);
  }
}

export async function cadastrarInteresseIo(req: Request, res: Response): Promise<void> {
  const b = (req.body || {}) as Record<string, unknown>;

  // Honeypot: robô preenche, gente não vê. A mesma cara de um cadastro novo, sem gravar nada.
  if (typeof b.site === 'string' ? b.site.trim() !== '' : Boolean(b.site)) {
    let posicao = 1;
    try {
      const { count, error } = await supabase.from(TABELA_LISTA).select('id', { count: 'exact', head: true }).eq('teste', false);
      if (!error && typeof count === 'number') posicao = count + 1;
    } catch { /* resposta igual mesmo se a contagem falhar */ }
    res.json({ ok: true, posicao, novo: true });
    return;
  }

  const porta = lerPorta(b);
  if ('frase' in porta) { res.status(400).json({ ok: false, erro: porta.frase }); return; }
  const contato = lerContato(b);
  if ('frase' in contato) { res.status(400).json({ ok: false, erro: contato.frase }); return; }

  const { whatsappOk, aviso } = contato.teste
    ? { whatsappOk: null, aviso: undefined }
    : await verificarWhatsapp(contato.telefone, { tabela: TABELA_LISTA });

  let gravado: Gravado;
  try {
    const { data, error } = await supabase.rpc('io_instagram_gravar', argumentosDaGravacao(porta, contato, whatsappOk));
    if (error) throw error;
    gravado = (data || {}) as Gravado;
  } catch (err: any) {
    console.error(LOG, err?.code, err?.message);
    res.status(500).json({ ok: false, erro: ERRO_SALVAR });
    return;
  }

  if (!contato.teste && (porta.porta === 'solar' || porta.porta === 'eletroposto')) {
    // Card e avisos inteiros depois da resposta (a Vercel mantém a função viva até a promessa terminar).
    waitUntil(depoisDeGravar(porta, contato, gravado));
  }
  // Sempre novo:true: a resposta pública não revela se o telefone já estava na lista.
  res.json({ ok: true, posicao: Number(gravado.posicao) || 1, novo: true, ...(aviso ? { aviso } : {}) });
}

// Leitura do /admin (hub Irmãos na Obra Instagram). O roteador põe authMiddleware e adminMiddleware antes.
export async function listarInteresseIoAdmin(req: Request, res: Response): Promise<void> {
  try {
    const comTeste = String(req.query?.teste ?? '') === '1';
    const itens: unknown[] = [];
    for (let ini = 0; itens.length < TETO_ADMIN; ini += PAGINA) {
      let q = supabase.from(TABELA_LISTA).select('*')
        .order('criado_em', { ascending: false }).order('id', { ascending: false }).range(ini, ini + PAGINA - 1);
      if (!comTeste) q = q.eq('teste', false);
      const { data, error } = await q;
      if (error) throw error;
      const pagina = data ?? [];
      itens.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    res.json({ ok: true, itens });
  } catch (err: any) {
    console.error(LOG, err?.code, err?.message);
    res.status(500).json({ ok: false, erro: 'Não deu para carregar a lista agora.' });
  }
}
