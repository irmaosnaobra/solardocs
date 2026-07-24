import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Vistoria de energia solar — checklist de campo com VÁRIAS fotos/arquivos por item.
//
// O técnico está no telhado, muitas vezes com sinal ruim: cada foto sobe NA HORA
// que é tirada (POST /:id/foto). Se a conexão cair, ele perde só a foto que
// faltou, não a vistoria inteira. Por isso o estado é incremental no servidor.
//
// Cada item guarda um ARRAY `fotos` — dá pra tirar mais de uma foto, anexar
// arquivo (PDF/imagem do PC ou da galeria) e remover a que não ficou boa.
//
// Acesso: TODOS os planos, sempre salvo no Storage, NÃO abate cota de documentos.
// Storage: reusa o bucket `documentos` (privado), pasta vistorias/<user>/<id>/.
// O link público (/v/:id) gera signed URL fresca de cada foto a cada abertura —
// nunca guarda URL que expira; guarda só o caminho.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Itens padrão da vistoria. `key` é estável (usado no caminho do Storage e no
// item_key das requisições); `label` é o texto exibido e fica gravado no jsonb.
export const CHECKLIST_VISTORIA: { key: string; label: string; dica: string }[] = [
  { key: 'conta_luz',           label: 'Conta de luz',                       dica: 'Página com o consumo (kWh) e a titularidade' },
  { key: 'documento_pessoal',   label: 'CNH / Identidade',                   dica: 'Documento com foto do titular da conta' },
  { key: 'padrao',              label: 'Padrão de entrada',                  dica: 'A caixa do padrão de entrada de energia' },
  { key: 'medidor',             label: 'Medidor / Relógio',                  dica: 'O relógio medidor da concessionária' },
  { key: 'disjuntor_padrao',    label: 'Disjuntor do padrão',                dica: 'O disjuntor geral, no padrão de entrada' },
  { key: 'quadro_distribuicao', label: 'Quadro de distribuição',             dica: 'Quadro de disjuntores interno, aberto' },
  { key: 'inversores',          label: 'Local dos inversores / Disjuntor C.A', dica: 'Parede/área do inversor e do disjuntor CA' },
  { key: 'telhado',             label: 'Telhado',                            dica: 'Visão geral do telhado' },
  { key: 'tipo_telha',          label: 'Tipo de telha',                      dica: 'Foto aproximada de uma telha' },
  { key: 'estrutura',           label: 'Estrutura apropriada',               dica: 'Onde a estrutura dos painéis será fixada' },
  { key: 'cabeamento',          label: 'Caminho do cabeamento',              dica: 'Trajeto do telhado até o quadro' },
  { key: 'sombreamento',        label: 'Sombreamento',                       dica: 'Árvores, prédios, caixa d’água que fazem sombra' },
];

type Foto = {
  url: string;          // caminho no Storage (NUNCA a signed url)
  ts: string;
  tipo: 'image' | 'file';
  nome?: string;        // nome original do arquivo (só pra 'file')
};

type ItemVistoria = {
  key: string;
  label: string;
  dica: string;
  obs: string;
  fotos: Foto[];
};

const BUCKET = 'documentos';

function seedItens(): ItemVistoria[] {
  return CHECKLIST_VISTORIA.map((c) => ({
    key: c.key, label: c.label, dica: c.dica, obs: '', fotos: [],
  }));
}

// Confere que a vistoria existe e é do usuário logado. Devolve a linha ou null.
async function getOwned(id: string, userId: string) {
  const { data } = await supabase
    .from('vistorias')
    .select('id, user_id, cliente_id, cliente_nome, status, itens, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  return data as
    | { id: string; user_id: string; cliente_id: string | null; cliente_nome: string | null; status: string; itens: ItemVistoria[]; created_at: string }
    | null;
}

const fotosDe = (i: ItemVistoria): Foto[] => (Array.isArray(i.fotos) ? i.fotos : []);

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

  // Se veio cliente_id, confirma que é do usuário e puxa o nome real — assim a
  // vistoria fica grudada no cadastro do cliente (armazenada junto dele). Cada
  // conta (inclusive admin) só anexa cliente PRÓPRIO.
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
    .select('id, cliente_id, cliente_nome, status, itens, created_at')
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
    .select('id, cliente_id, cliente_nome, status, itens, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    logger.error('vistorias', 'falha listando', error);
    res.status(500).json({ error: 'Não consegui carregar as vistorias.' });
    return;
  }

  const lista = (data ?? []).map((v: { id: string; cliente_id: string | null; cliente_nome: string | null; status: string; itens: ItemVistoria[]; created_at: string }) => {
    const itens = Array.isArray(v.itens) ? v.itens : [];
    return {
      id: v.id,
      cliente_id: v.cliente_id,
      cliente_nome: v.cliente_nome,
      status: v.status,
      total: itens.length,
      preenchidos: itens.filter((i) => fotosDe(i).length > 0).length,
      created_at: v.created_at,
    };
  });
  res.json(lista);
});

// ── GET /vistorias/clientes — clientes prontos, AGRUPADOS por empresa ──────────
// Cada conta (inclusive admin) vê só os PRÓPRIOS clientes — 1 grupo, a empresa
// dela. Isolamento por tenant total.
router.get('/clientes', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const compQ = supabase.from('company').select('user_id, nome').eq('user_id', req.userId);
  const cliQ = supabase.from('clients').select('id, nome, user_id')
    .eq('user_id', req.userId).order('nome', { ascending: true });
  const [{ data: comps }, { data: clis, error }] = await Promise.all([compQ, cliQ.limit(5000)]);
  if (error) {
    logger.error('vistorias', 'falha carregando clientes agrupados', error);
    res.status(500).json({ error: 'Não consegui carregar os clientes.' });
    return;
  }

  const nomeEmpresa = new Map<string, string>((comps ?? []).map((c: { user_id: string; nome: string }) => [c.user_id, c.nome]));
  const grupos = new Map<string, { id: string; nome: string }[]>();
  for (const cl of (clis ?? []) as { id: string; nome: string; user_id: string }[]) {
    const emp = nomeEmpresa.get(cl.user_id) || '— Sem empresa —';
    if (!grupos.has(emp)) grupos.set(emp, []);
    grupos.get(emp)!.push({ id: cl.id, nome: cl.nome });
  }
  const out = [...grupos.entries()]
    .map(([empresa, clientes]) => ({ empresa, clientes }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'));
  res.json(out);
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

// ── POST /vistorias/:id/foto — ADICIONA uma foto/arquivo ao item ───────────────
// Aceita imagem (câmera ou galeria/PC, já comprimida no cliente) ou arquivo (PDF).
const fotoSchema = z.object({
  item_key: z.string().min(1).max(40),
  base64: z.string().min(10),
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']).default('image/jpeg'),
  nome: z.string().max(255).optional(),
});

router.post('/:id/foto', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = fotoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados da foto inválidos' });
    return;
  }
  const { item_key, base64, media_type, nome } = parsed.data;

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

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    res.status(400).json({ error: 'Arquivo inválido.' });
    return;
  }
  if (buffer.length > 9_000_000) {
    res.status(413).json({ error: 'Arquivo muito grande (máx ~9MB). Tente de novo.' });
    return;
  }

  const isPdf = media_type === 'application/pdf';
  const ext = isPdf ? 'pdf' : media_type === 'image/png' ? 'png' : media_type === 'image/webp' ? 'webp' : 'jpg';
  const path = `vistorias/${req.userId}/${v.id}/${item_key}-${Date.now()}-${Math.round(buffer.length % 100000)}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: media_type, upsert: false });
  if (upErr) {
    logger.error('vistorias', 'upload da foto falhou', upErr);
    res.status(502).json({ error: 'Não consegui salvar. Tente de novo.' });
    return;
  }

  const foto: Foto = { url: path, ts: new Date().toISOString(), tipo: isPdf ? 'file' : 'image', nome };
  // Append ATÔMICO: um único UPDATE acrescenta ao array deste item — dois uploads
  // concorrentes (mesmo item ou itens diferentes) nunca se sobrescrevem.
  const { data: rows, error: updErr } = await supabase.rpc('vistoria_add_foto', {
    p_id: v.id, p_user: req.userId, p_key: item_key, p_foto: foto,
  });
  if (updErr) {
    logger.error('vistorias', 'falha gravando foto', updErr);
    res.status(500).json({ error: 'Subiu mas não consegui registrar. Tente de novo.' });
    return;
  }
  if (rows === -1) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  res.json({ ok: true, item_key, foto: { ...foto, signed: signed?.signedUrl ?? null } });
});

// ── DELETE /vistorias/:id/foto — remove UMA foto/arquivo do item ───────────────
const removeSchema = z.object({
  item_key: z.string().min(1).max(40),
  url: z.string().min(1),
});

router.delete('/:id/foto', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = removeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados inválidos' });
    return;
  }
  const { item_key, url } = parsed.data;
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  // Segurança: só remove um caminho que pertence a ESTA vistoria (prefixo do path).
  if (!url.startsWith(`vistorias/${req.userId}/${v.id}/`)) {
    res.status(400).json({ error: 'Arquivo inválido.' });
    return;
  }

  const { error: updErr } = await supabase.rpc('vistoria_remove_foto', {
    p_id: v.id, p_user: req.userId, p_key: item_key, p_url: url,
  });
  if (updErr) {
    logger.error('vistorias', 'falha removendo foto', updErr);
    res.status(500).json({ error: 'Não consegui remover.' });
    return;
  }
  // Best-effort: apaga o arquivo do Storage.
  supabase.storage.from(BUCKET).remove([url]).catch(() => {});
  res.json({ ok: true });
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

// Troca cada caminho de foto por uma signed url temporária pra exibição.
export type FotoSigned = Foto & { signed: string | null };
export async function withSignedUrls(
  itens: ItemVistoria[],
): Promise<(Omit<ItemVistoria, 'fotos'> & { fotos: FotoSigned[] })[]> {
  return Promise.all(
    itens.map(async (i) => {
      const fotos = await Promise.all(
        fotosDe(i).map(async (f) => {
          const { data } = await supabase.storage.from(BUCKET).createSignedUrl(f.url, 3600);
          return { ...f, signed: data?.signedUrl ?? null };
        }),
      );
      return { ...i, fotos };
    }),
  );
}

export default router;
