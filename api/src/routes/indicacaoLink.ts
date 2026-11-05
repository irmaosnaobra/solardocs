import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { supabaseGerador } from '../utils/supabaseGerador';
import { indicacaoRateLimit } from '../middleware/indicacaoRateLimit';
import { logger } from '../utils/logger';
import { estaBloqueado } from '../services/agents/whatsapp/silenciar';
import { slotLivreConsultor, dataBaseDaFaixa } from '../services/agenda/leadsMetaService';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { lerCardSolarVendido, lerLigacao, ultimos8 } from '../services/gerador/vendaSolarHub';
import { lerJornadaComVersao } from '../services/gerador/jornadaSolarBanco';
import { cardDoToken, gravarIndicacao } from '../services/gerador/indicacaoJornada';

// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 3 (05/11/2026): o LINK PÚBLICO DE INDICAÇÃO do cliente (`/io/indicacao?i=<card>-<token>`).
//
//   GET  /indicacao-link/:token    o primeiro nome de quem indicou (404 se o link não vale)
//   POST /indicacao-link           grava a indicação e cria o card do amigo
//
// Esta rota NÃO MANDA MENSAGEM e NÃO importa o `zapiClient`. Mas o card que ela cria cai na carteira da Nilce, e a agenda da Giovanna
// (`solarAgendaGiovanna`) fala com o indicado (bom dia e o "oi" de 5 minutos antes): isso é esperado e legítimo (veredito do chefe-antiban de 05/11).
// Trava contada no BANCO antes de criar o card: 3 por link em 24 h, 10 por link em 30 dias e 20 por dia no total (acima disso grava só a linha, sem
// card). Duplicado de 30 dias medido pela CAUDA do telefone. Nunca loga o corpo (telefone e nome).
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
const MAX = 200;
const TELEFONE_DA_SONDA = '34900000000';
export const TETO_LINK_24H = 3;
export const TETO_LINK_30D = 10;
export const TETO_DIA_TOTAL = 20;
const DIA_MS = 24 * 3600_000;
const CARTEIRA_DO_SOLAR = 'Nilce';

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A mesma normalização do `ioIndicacoes.ts` (o teste prova que dão a mesma saída em 8 casos). */
export function normalizarTelefoneBR(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  d = d.replace(/^0+/, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}

/** O card do indicador, se vale como origem de indicação: solar vendido, não cancelado e não o da sonda. */
async function indicadorValido(token: unknown) {
  const id = cardDoToken(token);
  if (!id) return null;
  const card = await lerCardSolarVendido(id);
  if (!card || String(card.cliente_telefone ?? '').replace(/\D/g, '') === TELEFONE_DA_SONDA) return null;
  const { estado } = await lerJornadaComVersao(id);
  return estado?.cancelada ? null : card;
}

async function contar(filtro: (q: any) => any): Promise<number> {
  const { data, error } = await filtro(supabase.from('io_indicacoes').select('id')).limit(1000);
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

router.get('/:token', indicacaoRateLimit, async (req: Request, res: Response) => {
  try {
    const card = await indicadorValido(req.params.token);
    if (!card) { res.status(404).json({ ok: false }); return; }
    const primeiro = String(card.cliente_nome ?? '').replace(/[*_~]/g, '').trim().split(/\s+/)[0] ?? '';
    res.json({ ok: true, nome: primeiro });
  } catch (err) {
    logger.error('indicacao-link', 'leitura falhou', String((err as { code?: unknown } | null)?.code ?? 'interno'));
    res.status(404).json({ ok: false });
  }
});

router.post('/', indicacaoRateLimit, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    // Honeypot: bot preenche, humano não. Finge sucesso e descarta.
    if (clean(body.website)) { res.json({ ok: true }); return; }
    const card = await indicadorValido(clean(body.i));
    if (!card) { res.status(400).json({ error: 'Este link de indicação não vale mais.' }); return; }
    const nome = clean(body.indicado_nome);
    const telRaw = clean(body.indicado_telefone);
    if (nome.length < 2 || nome.length > MAX || telRaw.length > MAX) { res.status(400).json({ error: 'Confira o nome e o WhatsApp.' }); return; }
    const tel = normalizarTelefoneBR(telRaw);
    if (tel.replace(/\D/g, '').length < 10) { res.status(400).json({ error: 'Telefone/WhatsApp inválido. Inclua o DDD.' }); return; }

    const origem = `jornada:${card.id}`;
    const agora = Date.now();
    const linha = {
      indicado_nome: nome, indicado_telefone: tel, indicado_telefone_raw: telRaw,
      indicador_nome: String(card.cliente_nome ?? '').slice(0, MAX), indicador_telefone: String(card.cliente_telefone ?? ''), indicador_telefone_raw: String(card.cliente_telefone ?? ''),
      origem, status: 'novo', created_at: new Date(agora).toISOString(),
    };
    const gravaLinha = async (): Promise<void> => {
      // Planos: pix vazio; se o banco recusar, 'a combinar'. `notificado_fechado` evita o aviso de "PIX" ao cliente no painel de indicações.
      let { error } = await supabase.from('io_indicacoes').insert({ ...linha, indicador_pix: '', notificado_fechado: true });
      if (error) ({ error } = await supabase.from('io_indicacoes').insert({ ...linha, indicador_pix: 'a combinar', notificado_fechado: true }));
      if (error) throw error;
    };

    // Bloqueado (fora do padrão): só a linha, sem card.
    if (await estaBloqueado(tel)) { await gravaLinha(); res.json({ ok: true }); return; }

    // O teto, contado no banco ANTES de criar o card.
    const desde24 = new Date(agora - DIA_MS).toISOString();
    const desde30 = new Date(agora - 30 * DIA_MS).toISOString();
    const inicioDoDia = new Date(`${diaDeBrasilia(agora)}T00:00:00-03:00`).toISOString();
    const [n24, n30, nDia] = await Promise.all([
      contar((q) => q.eq('origem', origem).gte('created_at', desde24)),
      contar((q) => q.eq('origem', origem).gte('created_at', desde30)),
      contar((q) => q.like('origem', 'jornada:%').gte('created_at', inicioDoDia)),
    ]);
    const acima = n24 >= TETO_LINK_24H || n30 >= TETO_LINK_30D || nDia >= TETO_DIA_TOTAL;

    // Duplicado de 30 dias: pela CAUDA do telefone normalizado.
    let existente: number | null = null;
    const cauda = ultimos8(tel);
    if (!acima && cauda) {
      const { data, error } = await supabaseGerador.from('agendamentos').select('id').like('cliente_telefone', `%${cauda}`).gte('created_at', desde30).order('id', { ascending: true }).limit(1);
      if (error) throw error;
      existente = Array.isArray(data) && data[0] ? Number((data[0] as { id: unknown }).id) : null;
    }

    await gravaLinha();
    if (acima) { res.json({ ok: true }); return; }

    let idNovo = existente;
    if (!idNovo) {
      const lig = await lerLigacao(card.id).catch(() => null);
      const rot = lig?.lig.venda && /^#\d{3,6}$/.test(lig.lig.venda) ? lig.lig.venda : `card ${card.id}`;
      const quando = await slotLivreConsultor(CARTEIRA_DO_SOLAR, dataBaseDaFaixa(''));
      const { data, error } = await supabaseGerador.from('agendamentos').insert({
        vendedor_nome: CARTEIRA_DO_SOLAR, quando: quando.toISOString(), cliente_nome: nome, cliente_telefone: tel, temperatura: 'quente', status: 'agendado',
        created_by: 'indicacao',
        observacao: `🎁 INDICADO\nIndicação de ${String(card.cliente_nome ?? '').replace(/[*_~]/g, '').trim()} (${rot})\n→ Atendimento personalizado`,
      }).select('id').single();
      if (error) throw error;
      idNovo = Number((data as { id: unknown } | null)?.id) || null;
    }
    if (idNovo) await gravarIndicacao(idNovo, card.id);
    res.json({ ok: true });
  } catch (err) {
    // Nunca logar o corpo: tem telefone e nome.
    logger.error('indicacao-link', 'registro falhou', String((err as { code?: unknown } | null)?.code ?? 'interno'));
    res.status(500).json({ error: 'Não consegui registrar agora. Tente de novo.' });
  }
});

export default router;
