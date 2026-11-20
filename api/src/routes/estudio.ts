import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { adminMiddleware } from '../middleware/adminAuth';

// Aba "Estúdio" do /admin (19/11/2026): o publicador local da série "Dentro da Guerra"
// coleta métricas das redes e envia um resumo (snapshot). A api só guarda e entrega.
// Dois routers: o POST de máquina (/estudio) e o GET do painel (/admin/estudio, guard de admin).

const CHAVE = 'estudio_snapshot';
const LIMITE_BYTES = 1024 * 1024;

// Várias fábricas de vídeo (v2). Lista fechada, na ordem padrão da tela. A key de `dentro-da-guerra` é a de sempre
// (sem migração); as outras ganham `estudio_snapshot:<id>`. Uma fábrica nunca sobrescreve a outra.
const FABRICAS = ['dentro-da-guerra', 'irmaos-na-obra', 'youtube'] as const;
type FabricaId = typeof FABRICAS[number];
const FABRICA_PADRAO: FabricaId = 'dentro-da-guerra';
const chaveDaFabrica = (id: FabricaId): string => (id === FABRICA_PADRAO ? CHAVE : `${CHAVE}:${id}`);

const REDES = ['instagram', 'tiktok', 'youtube'];
const SITUACOES = ['no-ar', 'em-montagem', 'pausada'];
const STATUS_REDE = ['em-producao', 'agendado', 'publicado', 'falhou'];
const MAX_ITENS = 60; // programação e pauta.itens
const MAX_LISTA = 30; // contas, horários, plano.*, pauta.etapas
const MAX_TEXTO = 300;
const MAX_TEXTO_LONGO = 2000;
const MAX_URL = 500;

type Obj = Record<string, unknown>;
const ehObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const txt = (v: unknown, max = MAX_TEXTO): boolean => typeof v === 'string' && v.length <= max;
const txtOpc = (v: unknown, max = MAX_TEXTO): boolean => v === undefined || txt(v, max);
const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const numOpc = (v: unknown): boolean => v === undefined || num(v);
const lista = (v: unknown, max: number): v is unknown[] => Array.isArray(v) && v.length <= max;
const urlHttps = (v: unknown): boolean => {
  if (typeof v !== 'string' || v.length > MAX_URL) return false;
  try { return new URL(v).protocol === 'https:'; } catch { return false; }
};
const urlOpc = (v: unknown): boolean => v === undefined || urlHttps(v);
const dataIso = (v: unknown): boolean => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** Valida os campos opcionais da v2. Os obrigatórios de hoje ficam no contratoOk do handler. */
function opcionaisOk(c: Obj): boolean {
  if (c.fabricaNome !== undefined && !(txt(c.fabricaNome) && c.fabricaNome !== '')) return false;
  if (!numOpc(c.ordem)) return false;
  if (c.situacao !== undefined && !SITUACOES.includes(c.situacao as string)) return false;

  if (c.contas !== undefined) {
    if (!lista(c.contas, MAX_LISTA)) return false;
    for (const x of c.contas) {
      if (!ehObj(x) || !REDES.includes(x.rede as string) || !txt(x.handle, 100) || !urlOpc(x.url) || !numOpc(x.seguidores)) return false;
    }
  }
  if (c.horarios !== undefined) {
    if (!lista(c.horarios, MAX_LISTA) || !c.horarios.every(h => typeof h === 'string' && /^\d{2}:\d{2}$/.test(h))) return false;
  }
  if (c.programacao !== undefined) {
    if (!lista(c.programacao, MAX_ITENS)) return false;
    for (const p of c.programacao) {
      if (!ehObj(p) || !dataIso(p.quando) || !txt(p.slug, 120) || !txt(p.titulo) || !urlOpc(p.capaUrl) || !txtOpc(p.linha, 40) || !urlOpc(p.link)) return false;
      if (!ehObj(p.redes)) return false;
      for (const [rede, st] of Object.entries(p.redes)) {
        if (!REDES.includes(rede) || !STATUS_REDE.includes(st as string)) return false;
      }
    }
  }
  if (c.pauta !== undefined) {
    const pa = c.pauta;
    if (!ehObj(pa) || !txt(pa.semana, 10) || !lista(pa.etapas, MAX_LISTA) || !pa.etapas.every(e => txt(e, 40)) || !lista(pa.itens, MAX_ITENS)) return false;
    for (const i of pa.itens) {
      if (!ehObj(i) || !txt(i.dia, 40) || !txt(i.hora, 10) || !txt(i.slug, 120) || !txt(i.tema) || !txt(i.linha, 40) || !txt(i.etapa, 40) || !numOpc(i.nota)) return false;
    }
  }
  if (c.personagem !== undefined) {
    const pe = c.personagem;
    if (!ehObj(pe) || !txtOpc(pe.nome, 100) || !urlOpc(pe.imagemUrl) || !txtOpc(pe.descricao, MAX_TEXTO_LONGO)) return false;
  }
  if (c.plano !== undefined) {
    const pl = c.plano;
    if (!ehObj(pl) || !txt(pl.formato) || !txt(pl.cadencia) || !txt(pl.objetivo, MAX_TEXTO_LONGO)) return false;
    if (!lista(pl.esqueleto, MAX_LISTA) || !pl.esqueleto.every(e => ehObj(e) && txt(e.minuto, 40) && txt(e.bloco))) return false;
    if (!lista(pl.marcos, MAX_LISTA) || !pl.marcos.every(m => ehObj(m) && txt(m.titulo) && typeof m.feito === 'boolean')) return false;
    if (!lista(pl.referencias, MAX_LISTA) || !pl.referencias.every(r => ehObj(r) && txt(r.canal, 100) && txt(r.idioma, 40) && num(r.inscritos) && num(r.mediaViews))) return false;
    if (!lista(pl.riscos, MAX_LISTA) || !pl.riscos.every(r => txt(r, MAX_TEXTO))) return false;
  }
  return true;
}

// Impressão digital (SHA-256) da credencial que só existe no PC do publicador de vídeos (19/11/2026).
// Não é segredo: não dá para chegar ao valor original a partir dela, como uma chave pública.
// Para trocar, gere outra no .env do estúdio e ponha a nova impressão aqui (ou na env abaixo).
const DIGITAL_PUBLICADOR = 'a09f5415e4f91831dfa21329738c6e2ec7aec1f6926c43e26cc6625e79bd3aa6';

/** Hash SHA-256 esperado: ESTUDIO_SYNC_TOKEN (valor), senão ESTUDIO_SYNC_TOKEN_SHA256 (64 hex), senão a embutida. */
function hashEsperado(): Buffer {
  const s = (process.env.ESTUDIO_SYNC_TOKEN || '').trim();
  if (s) return crypto.createHash('sha256').update(s).digest();
  const h = (process.env.ESTUDIO_SYNC_TOKEN_SHA256 || '').trim().toLowerCase();
  return Buffer.from(/^[0-9a-f]{64}$/.test(h) ? h : DIGITAL_PUBLICADOR, 'hex');
}

function tokenConfere(recebido: string, esperado: Buffer): boolean {
  const a = crypto.createHash('sha256').update(recebido).digest();
  return crypto.timingSafeEqual(a, esperado); // hash dos dois: mesmo tamanho, sem vazar o comprimento
}

/** Router do publicador: POST /estudio/snapshot. */
export const estudioMaquinaRouter = Router();

estudioMaquinaRouter.post('/snapshot', async (req: Request, res: Response): Promise<void> => {
  const esperado = hashEsperado();

  const cab = String(req.headers.authorization || '');
  const recebido = cab.startsWith('Bearer ') ? cab.slice(7).trim() : '';
  if (!recebido || !tokenConfere(recebido, esperado)) { res.status(401).json({ error: 'nao_autorizado' }); return; }

  const declarado = Number(req.headers['content-length'] || 0);
  if (declarado > LIMITE_BYTES) { res.status(413).json({ error: 'snapshot_grande_demais' }); return; }

  const corpo = req.body as {
    versao?: unknown; episodios?: unknown; redes?: unknown; fabricaId?: unknown;
    serie?: { nome?: unknown }; fabrica?: { etapas?: unknown }; totais?: { porRede?: unknown };
  } | undefined;
  // O painel lê serie, fabrica.etapas e totais.porRede direto: snapshot sem eles quebraria a aba até o próximo envio.
  const contratoOk = !!corpo && typeof corpo === 'object' && corpo.versao === 1
    && Array.isArray(corpo.episodios) && Array.isArray(corpo.redes)
    && typeof corpo.serie?.nome === 'string' && Array.isArray(corpo.fabrica?.etapas)
    && !!corpo.totais?.porRede && typeof corpo.totais.porRede === 'object';
  if (!contratoOk) {
    res.status(400).json({ error: 'snapshot_invalido' });
    return;
  }
  // Sem fabricaId é a fábrica de sempre; valor fora da lista fechada é recusado (nunca vira key livre).
  const fabricaId = corpo.fabricaId === undefined ? FABRICA_PADRAO : (FABRICAS as readonly unknown[]).includes(corpo.fabricaId) ? corpo.fabricaId as FabricaId : null;
  if (!fabricaId || !opcionaisOk(corpo as Obj)) {
    res.status(400).json({ error: 'snapshot_invalido' });
    return;
  }
  if (Buffer.byteLength(JSON.stringify(corpo)) > LIMITE_BYTES) { res.status(413).json({ error: 'snapshot_grande_demais' }); return; }

  try {
    const { error } = await supabase.from('system_state').upsert(
      { key: chaveDaFabrica(fabricaId), value: corpo, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[estudio] gravar snapshot falhou:', String((err as Error)?.message || err).slice(0, 120));
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

/** Router do painel: GET /admin/estudio. Monta ANTES de `app.use('/admin', ...)`. */
export const estudioAdminRouter = Router();
estudioAdminRouter.use(authMiddleware);
estudioAdminRouter.use(adminMiddleware);

estudioAdminRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { data, error } = await supabase.from('system_state').select('key, value, updated_at').in('key', FABRICAS.map(chaveDaFabrica));
    if (error) throw error;
    const linhas = (data ?? []) as { key: string; value: unknown; updated_at: string | null }[];
    const itens = FABRICAS.map((id, pos) => {
      const l = linhas.find(x => x.key === chaveDaFabrica(id));
      const snap: Obj | null = l && ehObj(l.value) ? { ...l.value, fabricaId: id, atualizadoEm: l.updated_at } : null;
      return snap ? { pos, id, snap } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
    // Ordem: `ordem` do snapshot; sem ela, a posição padrão da lista (empate também cai nela).
    const fabricas = itens
      .sort((a, b) => ((a.snap.ordem as number | undefined) ?? a.pos + 1) - ((b.snap.ordem as number | undefined) ?? b.pos + 1) || a.pos - b.pos)
      .map(x => x.snap);
    // Campos de hoje, compatíveis: o snapshot da dentro-da-guerra, intacto.
    const principal = linhas.find(x => x.key === CHAVE);
    res.json({ snapshot: principal?.value ?? null, atualizadoEm: principal?.updated_at ?? null, fabricas });
  } catch (err) {
    console.error('[estudio] ler snapshot falhou:', String((err as Error)?.message || err).slice(0, 120));
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
