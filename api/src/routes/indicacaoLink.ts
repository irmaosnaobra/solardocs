import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { supabaseGerador } from '../utils/supabaseGerador';
import { indicacaoRateLimit } from '../middleware/indicacaoRateLimit';
import { logger } from '../utils/logger';
import { estaBloqueado } from '../services/agents/whatsapp/silenciar';
import { slotLivreConsultor, dataBaseDaFaixa } from '../services/agenda/leadsMetaService';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { reservarChave, liberarChave } from '../services/agentes5040/cota';
import { lerCardSolarVendido, lerLigacao } from '../services/gerador/vendaSolarHub';
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
// Vaga reservada por INSERT em chave única antes de criar o card: 3 por link por dia, 10 por link em 30 dias e 20 por dia no total (acima disso grava só a
// linha, sem card). Duplicado de 30 dias: telefone normalizado inteiro (tolera só o 9º dígito); o card que já existe nunca é ligado ao dono do link. Nunca loga o corpo (telefone e nome).
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();
const MAX = 200;
const TELEFONE_DA_SONDA = '34900000000';
export const TETO_LINK_DIA = 3;
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

/** As formas do mesmo telefone: o normalizado inteiro (55 + DDD + número) e a variante com ou sem o 9º dígito. Telefone de outro DDD nunca casa. */
export function chavesDoTelefone(norm: string): string[] {
  const d = norm.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') return [d, d.slice(0, 4) + d.slice(5)];
  if (d.length === 12 && d.startsWith('55')) return [d, d.slice(0, 4) + '9' + d.slice(4)];
  return d.length >= 10 ? [d] : [];
}

/** Tenta as vagas 1..max de um prefixo, por INSERT em chave única; devolve a chave ganha ou null. Erro de banco = sem vaga (fecha). */
async function tomarVaga(prefixo: string, max: number, agora: Date): Promise<string | null> {
  for (let n = 1; n <= max; n++) {
    const chave = `${prefixo}:${n}`;
    const r = await reservarChave(chave, {}, agora);
    if (r === 'reservada') return chave;
    if (r === 'erro') return null;
  }
  return null;
}

/** As três vagas (por link e dia, por link em 30 dias, global do dia) ou nenhuma: se uma falta, solta as que pegou. */
async function reservarVagas(card: number, agoraMs: number): Promise<boolean> {
  const agora = new Date(agoraMs);
  const dia = diaDeBrasilia(agoraMs);
  const janela = Math.floor(agoraMs / (30 * DIA_MS));
  const ganhas: string[] = [];
  for (const [prefixo, max] of [[`indic_vaga:${card}:${dia}`, TETO_LINK_DIA], [`indic_vaga_30:${card}:${janela}`, TETO_LINK_30D], [`indic_vaga_dia:${dia}`, TETO_DIA_TOTAL]] as const) {
    const g = await tomarVaga(prefixo, max, agora);
    if (!g) { await Promise.all(ganhas.map((k) => liberarChave(k))); return false; }
    ganhas.push(g);
  }
  return true;
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

    // Duplicado de 30 dias: o telefone normalizado INTEIRO, com DDD, tolerando só o 9º dígito. Acha um card que já existe: grava SÓ a linha. Esse card NUNCA
    // é ligado a quem tem o link (nada de `veio_de` nem de prêmio por um lead que já era nosso) e não gasta vaga.
    const desde30 = new Date(agora - 30 * DIA_MS).toISOString();
    const chaves = chavesDoTelefone(tel);
    const final4 = tel.replace(/\D/g, '').slice(-4);
    if (chaves.length && final4.length === 4) {
      const { data, error } = await supabaseGerador.from('agendamentos').select('id, cliente_telefone').like('cliente_telefone', `%${final4}`).gte('created_at', desde30).limit(500);
      if (error) throw error;
      const repetido = ((data ?? []) as Array<{ cliente_telefone?: unknown }>).some((c) => chavesDoTelefone(normalizarTelefoneBR(String(c.cliente_telefone ?? ''))).some((k) => chaves.includes(k)));
      if (repetido) { await gravaLinha(); res.json({ ok: true }); return; }
    }

    // O teto: a vaga é reservada por INSERT em chave única ANTES de criar o card (o mesmo padrão da `jornada_vez:`), então requisições em paralelo
    // não passam do teto. 3 por link por dia, 10 por link por janela de 30 dias, 20 por dia no total. Sem vaga: só a linha, sem card.
    const vagas = await reservarVagas(card.id, agora);
    await gravaLinha();
    if (!vagas) { res.json({ ok: true }); return; }

    const lig = await lerLigacao(card.id).catch(() => null);
    const rot = lig?.lig.venda && /^#\d{3,6}$/.test(lig.lig.venda) ? lig.lig.venda : `card ${card.id}`;
    const quando = await slotLivreConsultor(CARTEIRA_DO_SOLAR, dataBaseDaFaixa(''));
    const { data, error } = await supabaseGerador.from('agendamentos').insert({
      vendedor_nome: CARTEIRA_DO_SOLAR, quando: quando.toISOString(), cliente_nome: nome, cliente_telefone: tel, temperatura: 'quente', status: 'agendado',
      created_by: 'indicacao',
      observacao: `🎁 INDICADO\nIndicação de ${String(card.cliente_nome ?? '').replace(/[*_~]/g, '').trim()} (${rot})\n→ Atendimento personalizado`,
    }).select('id').single();
    if (error) throw error;
    const idNovo = Number((data as { id: unknown } | null)?.id) || null;
    if (idNovo) await gravarIndicacao(idNovo, card.id);
    res.json({ ok: true });
  } catch (err) {
    // Nunca logar o corpo: tem telefone e nome.
    logger.error('indicacao-link', 'registro falhou', String((err as { code?: unknown } | null)?.code ?? 'interno'));
    res.status(500).json({ error: 'Não consegui registrar agora. Tente de novo.' });
  }
});

export default router;
