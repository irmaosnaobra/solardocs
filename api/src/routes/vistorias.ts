import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Vistoria de energia solar — checklist de campo com foto por item.
//
// O técnico está no telhado, muitas vezes com sinal ruim: cada foto sobe NA HORA
// que é tirada (POST /:id/foto). Se a conexão cair, ele perde só a foto que
// faltou, não a vistoria inteira. Por isso o estado é incremental no servidor.
//
// Acesso: TODOS os planos, foto sempre salva no Storage, NÃO abate cota de
// documentos (é ferramenta de campo, não geração de doc).
//
// Storage: reusa o bucket `documentos` (privado), pasta vistorias/<user>/<id>/.
// O link público (/v/:id) gera signed URL fresca de cada foto a cada abertura —
// nunca guarda URL que expira; guarda só o caminho.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Itens padrão da vistoria. `key` é estável (usado no caminho do Storage e no
// item_key das requisições); `label` é o texto exibido e fica gravado no jsonb.
export const CHECKLIST_VISTORIA: { key: string; label: string; dica: string }[] = [
  { key: 'conta_luz',      label: 'Conta de luz',                dica: 'Página com o consumo (kWh) e a titularidade' },
  { key: 'padrao_medidor', label: 'Padrão de entrada / relógio', dica: 'O medidor (relógio) e a caixa do padrão' },
  { key: 'disjuntor',      label: 'Disjuntor geral / quadro',    dica: 'Quadro de distribuição aberto, com o disjuntor geral' },
  { key: 'telhado_geral',  label: 'Telhado — visão geral',       dica: 'O telhado inteiro, de onde dá pra ver a área' },
  { key: 'tipo_telha',     label: 'Tipo de telha (de perto)',    dica: 'Foto aproximada de uma telha' },
  { key: 'estrutura',      label: 'Estrutura / vão dos painéis', dica: 'Onde os painéis vão ficar' },
  { key: 'inversores',     label: 'Local dos inversores',        dica: 'Parede/área onde o inversor será instalado' },
  { key: 'cabeamento',     label: 'Caminho do cabeamento',       dica: 'Trajeto do telhado até o quadro' },
  { key: 'sombreamento',   label: 'Sombreamento',                dica: 'Árvores, prédios, caixa d’água que fazem sombra' },
  { key: 'fachada',        label: 'Fachada / número da casa',    dica: 'Frente do imóvel com o número' },
];

type ItemVistoria = {
  key: string;
  label: string;
  dica: string;
  foto_url: string | null; // caminho no Storage (NUNCA a signed url)
  obs: string;
  ts: string | null;
};

const BUCKET = 'documentos';

function seedItens(): ItemVistoria[] {
  return CHECKLIST_VISTORIA.map((c) => ({
    key: c.key, label: c.label, dica: c.dica, foto_url: null, obs: '', ts: null,
  }));
}

// Confere que a vistoria existe e é do usuário logado. Devolve a linha ou null.
async function getOwned(id: string, userId: string) {
  const { data } = await supabase
    .from('vistorias')
    .select('id, user_id, cliente_nome, status, itens, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  return data as
    | { id: string; user_id: string; cliente_nome: string | null; status: string; itens: ItemVistoria[]; created_at: string }
    | null;
}

// ── POST /vistorias — cria a vistoria (opcionalmente grudada num cliente) ──────
const createSchema = z.object({
  cliente_id: z.string().uuid().optional().nullable(),
  cliente_nome: z.string().trim().max(255).optional().nullable(),
});

router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados inválidos' });
    return;
  }
  const { cliente_id, cliente_nome } = parsed.data;

  // Se veio cliente_id, confirma que é do usuário e puxa o nome real.
  let nome = cliente_nome || null;
  let clienteId: string | null = null;
  if (cliente_id) {
    const { data: cli } = await supabase
      .from('clients')
      .select('id, nome')
      .eq('id', cliente_id)
      .eq('user_id', req.userId)
      .maybeSingle();
    if (cli) {
      clienteId = cli.id;
      nome = cli.nome;
    }
  }

  const { data, error } = await supabase
    .from('vistorias')
    .insert({
      user_id: req.userId,
      cliente_id: clienteId,
      cliente_nome: nome,
      status: 'em_andamento',
      itens: seedItens(),
    })
    .select('id, cliente_nome, status, itens, created_at')
    .single();

  if (error || !data) {
    logger.error('vistorias', 'falha criando vistoria', error);
    res.status(500).json({ error: 'Não consegui criar a vistoria.' });
    return;
  }

  res.json(data);
});

// ── GET /vistorias/list — lista as vistorias do usuário ────────────────────────
router.get('/list', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabase
    .from('vistorias')
    .select('id, cliente_nome, status, itens, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    logger.error('vistorias', 'falha listando', error);
    res.status(500).json({ error: 'Não consegui carregar as vistorias.' });
    return;
  }

  const lista = (data ?? []).map((v: { id: string; cliente_nome: string | null; status: string; itens: ItemVistoria[]; created_at: string }) => {
    const itens = Array.isArray(v.itens) ? v.itens : [];
    return {
      id: v.id,
      cliente_nome: v.cliente_nome,
      status: v.status,
      total: itens.length,
      preenchidos: itens.filter((i) => i.foto_url).length,
      created_at: v.created_at,
    };
  });
  res.json(lista);
});

// ── GET /vistorias/:id — detalhe (com signed urls pra revisar no dashboard) ─────
router.get('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  const itens = await withSignedUrls(Array.isArray(v.itens) ? v.itens : []);
  res.json({ ...v, itens });
});

// ── POST /vistorias/:id/foto — sobe a foto de UM item ──────────────────────────
// Frontend manda a imagem já comprimida (jpeg base64). Guardamos só o caminho.
const fotoSchema = z.object({
  item_key: z.string().min(1).max(40),
  base64: z.string().min(10),
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
});

router.post('/:id/foto', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = fotoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados da foto inválidos' });
    return;
  }
  const { item_key, base64, media_type } = parsed.data;

  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  const itens = Array.isArray(v.itens) ? v.itens : [];
  const idx = itens.findIndex((i) => i.key === item_key);
  if (idx === -1) {
    res.status(400).json({ error: 'Item desconhecido.' });
    return;
  }

  // Decodifica e sobe pro Storage.
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    res.status(400).json({ error: 'Imagem inválida.' });
    return;
  }
  if (buffer.length > 8_000_000) {
    res.status(413).json({ error: 'Foto muito grande. Tente novamente.' });
    return;
  }
  const ext = media_type === 'image/png' ? 'png' : media_type === 'image/webp' ? 'webp' : 'jpg';
  const path = `vistorias/${req.userId}/${v.id}/${item_key}-${Date.now()}.${ext}`;
  const anterior = itens[idx].foto_url;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: media_type, upsert: false });
  if (upErr) {
    logger.error('vistorias', 'upload da foto falhou', upErr);
    res.status(502).json({ error: 'Não consegui salvar a foto. Tente de novo.' });
    return;
  }

  // Update ATÔMICO via função Postgres: um único UPDATE mescla só este item, então
  // dois uploads concorrentes (itens diferentes) nunca se sobrescrevem.
  const { error: updErr } = await supabase.rpc('vistoria_patch_item', {
    p_id: v.id,
    p_user: req.userId,
    p_key: item_key,
    p_patch: { foto_url: path, ts: new Date().toISOString() },
  });
  if (updErr) {
    logger.error('vistorias', 'falha gravando item', updErr);
    res.status(500).json({ error: 'Foto subiu mas não consegui registrar. Tente de novo.' });
    return;
  }

  // Best-effort: apaga a foto antiga que acabou de ser substituída.
  if (anterior && anterior !== path) {
    supabase.storage.from(BUCKET).remove([anterior]).catch(() => {});
  }

  res.json({ ok: true, item_key, foto_url: path });
});

// ── PATCH /vistorias/:id/item — atualiza a observação de um item ───────────────
const obsSchema = z.object({
  item_key: z.string().min(1).max(40),
  obs: z.string().max(1000),
});

router.patch('/:id/item', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = obsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados inválidos' });
    return;
  }
  const { item_key, obs } = parsed.data;
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  const itens = Array.isArray(v.itens) ? v.itens : [];
  if (!itens.some((i) => i.key === item_key)) {
    res.status(400).json({ error: 'Item desconhecido.' });
    return;
  }
  const { error } = await supabase.rpc('vistoria_patch_item', {
    p_id: v.id, p_user: req.userId, p_key: item_key, p_patch: { obs },
  });
  if (error) {
    res.status(500).json({ error: 'Não consegui salvar a observação.' });
    return;
  }
  res.json({ ok: true });
});

// ── POST /vistorias/:id/concluir — fecha a vistoria e devolve o id do relatório ─
router.post('/:id/concluir', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  const { error } = await supabase
    .from('vistorias')
    .update({ status: 'concluida', updated_at: new Date().toISOString() })
    .eq('id', v.id)
    .eq('user_id', req.userId);
  if (error) {
    res.status(500).json({ error: 'Não consegui concluir a vistoria.' });
    return;
  }
  res.json({ ok: true, id: v.id });
});

// Troca cada foto_url (caminho) por uma signed url temporária pra exibição.
export async function withSignedUrls(itens: ItemVistoria[]): Promise<(ItemVistoria & { foto_signed?: string | null })[]> {
  return Promise.all(
    itens.map(async (i) => {
      if (!i.foto_url) return { ...i, foto_signed: null };
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(i.foto_url, 3600);
      return { ...i, foto_signed: data?.signedUrl ?? null };
    }),
  );
}

export default router;
