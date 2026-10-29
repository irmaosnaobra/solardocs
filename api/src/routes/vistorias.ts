import { Router, Request, Response } from 'express';
import JSZip from 'jszip';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import { calcularSelo, resumo, sanitizarStatus } from '../services/vistoria/avaliacao';
import { LIMITES, sanitizarLinhas } from '../services/vistoria/compras';
import {
  AssinMap, BUCKET as BUCKET_DOC, ComprasLidas, Extras, colunaAusente, lerCompras, lerExtras, urlsDasAssinaturas,
} from '../services/vistoria/extras';

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

// LOCALIZAÇÃO DA VISTORIA — pedido do Gedalih (24/08/2026), e o caso dele manda no
// desenho: *"o cliente me mandou a localização, aí não sei o que aconteceu no celular,
// acabei perdendo. É na roça."* Ou seja, o caminho principal NÃO é o GPS do aparelho —
// ele não está no telhado quando a mensagem chega. É COLAR o que o cliente mandou.
//
// Por isso o campo aceita qualquer coisa: par de coordenadas, link do Google Maps, link
// curto do maps.app.goo.gl. O que dá pra ler vira lat/lng; o que não dá é guardado como
// link mesmo, que continua abrindo no celular de quem clicar. Nada é rejeitado — jogar
// fora a localização do cliente é exatamente o problema que ele relatou.
export interface Localizacao {
  lat: number | null;
  lng: number | null;
  link: string | null;   // o que a pessoa colou, quando não é coordenada pura
  texto: string | null;  // apelido do ponto ("portão de trás", "fundos do sítio")
  origem: 'gps' | 'colado';
  em: string;
}

// Acha um par lat,lng dentro de qualquer texto — inclusive no meio de uma URL do Maps
// (`/@-22.1,-45.6,17z` e `?q=-22.1,-45.6` caem os dois aqui).
export function lerCoordenadas(bruto: string): { lat: number; lng: number } | null {
  const m = bruto.match(/(-?\d{1,3}[.,]\d{4,})\s*[,;]\s*(-?\d{1,3}[.,]\d{4,})/);
  if (!m) return null;
  const lat = parseFloat(m[1].replace(',', '.'));
  const lng = parseFloat(m[2].replace(',', '.'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// Confere que a vistoria existe e é do usuário logado. Devolve a linha ou null.
async function getOwned(id: string, userId: string) {
  const { data } = await supabase
    .from('vistorias')
    .select('id, user_id, cliente_id, cliente_nome, status, itens, localizacao, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  return data as
    | { id: string; user_id: string; cliente_id: string | null; cliente_nome: string | null; status: string; itens: ItemVistoria[]; localizacao: Localizacao | null; created_at: string }
    | null;
}

/** Lê as colunas novas; se o banco falhar por outro motivo que não coluna ausente, responde 500 e devolve null. */
async function extrasOu500(res: Response, id: string): Promise<Extras | null> {
  try {
    return await lerExtras(id);
  } catch (err) {
    logger.error('vistorias', 'falha lendo status e assinaturas', err);
    res.status(500).json({ error: 'Não consegui carregar os dados da vistoria. Tente de novo.' });
    return null;
  }
}

/**
 * Lê a lista de compras (coluna própria, flag própria). Só "coluna não existe" vira disponivel=false; outro erro
 * de banco responde 500 e devolve null, para a escrita nunca gravar por cima do que não conseguiu ler.
 * Roda sempre por último entre as leituras em `vistorias` (no GET /:id, depois de getOwned e de extrasOu500; no
 * PUT /:id/compras, depois de getOwned) e só nessas duas rotas: o teste de rotas conta cada leitura.
 */
async function comprasOu500(res: Response, id: string): Promise<ComprasLidas | null> {
  try {
    return await lerCompras(id);
  } catch (err) {
    logger.error('vistorias', 'falha lendo compras', err);
    res.status(500).json({ error: 'Não consegui carregar a lista de compras. Tente de novo.' });
    return null;
  }
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
    .select('id, cliente_id, cliente_nome, status, itens, localizacao, created_at')
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
    .select('id, cliente_id, cliente_nome, status, itens, localizacao, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    logger.error('vistorias', 'falha listando', error);
    res.status(500).json({ error: 'Não consegui carregar as vistorias.' });
    return;
  }

  // Selo de cada vistoria: leitura tolerante das colunas novas (sem a migration, todos null).
  const seloPorId = new Map<string, string | null>();
  try {
    const { data: sts, error: stErr } = await supabase
      .from('vistorias')
      .select('id, status_itens')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (!stErr) {
      for (const r of (sts ?? []) as { id: string; status_itens: unknown }[]) seloPorId.set(r.id, calcularSelo(r.status_itens));
    }
  } catch { /* sem selo */ }

  const lista = (data ?? []).map((v: { id: string; cliente_id: string | null; cliente_nome: string | null; status: string; itens: ItemVistoria[]; localizacao: Localizacao | null; created_at: string }) => {
    const itens = Array.isArray(v.itens) ? v.itens : [];
    return {
      id: v.id,
      cliente_id: v.cliente_id,
      cliente_nome: v.cliente_nome,
      status: v.status,
      total: itens.length,
      preenchidos: itens.filter((i) => fotosDe(i).length > 0).length,
      tem_local: !!v.localizacao,
      selo: seloPorId.get(v.id) ?? null,
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
  const cliQ = supabase.from('clients').select('id, nome, user_id, documentos')
    .eq('user_id', req.userId).order('nome', { ascending: true });
  const [{ data: comps }, { data: clis, error }] = await Promise.all([compQ, cliQ.limit(5000)]);
  if (error) {
    logger.error('vistorias', 'falha carregando clientes agrupados', error);
    res.status(500).json({ error: 'Não consegui carregar os clientes.' });
    return;
  }

  const nomeEmpresa = new Map<string, string>((comps ?? []).map((c: { user_id: string; nome: string }) => [c.user_id, c.nome]));
  const grupos = new Map<string, { id: string; nome: string; docs: string[] }[]>();
  for (const cl of (clis ?? []) as { id: string; nome: string; user_id: string; documentos: { tipo: string }[] | null }[]) {
    const emp = nomeEmpresa.get(cl.user_id) || 'Sem empresa';
    if (!grupos.has(emp)) grupos.set(emp, []);
    // docs = tipos distintos já arquivados (conta_luz / identidade)
    const docs = [...new Set((Array.isArray(cl.documentos) ? cl.documentos : []).map((d) => d.tipo))];
    grupos.get(emp)!.push({ id: cl.id, nome: cl.nome, docs });
  }
  const out = [...grupos.entries()]
    .map(([empresa, clientes]) => ({ empresa, clientes }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR'));
  res.json(out);
});

// ── GET /vistorias/:id — detalhe (com signed urls pra revisar no dashboard) ─────
// Acrescenta status_itens, assinaturas e o resumo (selo, pendências, conclusão). As colunas
// novas vêm de lerExtras: sem a migration, voltam vazias e extras_disponiveis=false.
// A lista de compras vem de lerCompras (3ª leitura, flag própria): sem a coluna, compras_disponivel=false
// e a lista sai vazia, sem afetar status e assinaturas.
router.get('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  const itens = await withSignedUrls(Array.isArray(v.itens) ? v.itens : []);
  const extras = await extrasOu500(res, v.id);
  if (!extras) return;
  const lida = await comprasOu500(res, v.id);
  if (!lida) return;
  res.json({
    ...v,
    itens,
    status_itens: extras.status_itens,
    assinaturas: extras.assinaturas,
    assinaturas_url: await urlsDasAssinaturas(extras.assinaturas),
    resumo: resumo(itens, extras.status_itens),
    extras_disponiveis: extras.disponivel,
    compras: { publica: lida.compras.publica, linhas: lida.compras.linhas },
    compras_disponivel: lida.disponivel,
  });
});

// ── GET /vistorias/:id/fotos.zip: TODOS os arquivos da vistoria, só para o dono ─
// O ZIP público (/v/:id/fotos.zip) abre sem login para quem tem o link, por isso o documento pessoal (CNH ou
// identidade) não deve sair nele (decisão de 29/10/2026). Este leva tudo, inclusive o documento: quem baixa está
// logado e é o dono da vistoria. O dashboard baixa com o token, por blob. O corpo inclui a CNH do cliente, então
// nada fica em cache.
router.get('/:id/fotos.zip', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  try {
    const conteudo = await montarZipDaVistoria(v.itens);
    if (!conteudo) {
      res.status(404).json({ error: 'Esta vistoria ainda não tem fotos.' });
      return;
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="vistoria-${slugify(v.cliente_nome || 'solar')}.zip"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(conteudo);
  } catch (err) {
    logger.error('vistorias', 'falha gerando o ZIP das fotos', err);
    res.status(500).json({ error: 'Não consegui gerar o ZIP. Tente de novo.' });
  }
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

// ── PUT /vistorias/:id/localizacao — guarda (ou apaga) o ponto da vistoria ─────
// `colado` é o caminho principal: o que o cliente mandou no WhatsApp. `lat`/`lng`
// diretos são o botão "usar minha localização", que só serve pra quem já está no
// local. Mandar tudo vazio APAGA — precisa dar pra corrigir um ponto errado.
const localSchema = z.object({
  colado: z.string().max(2000).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  texto: z.string().max(120).optional(),
});

router.put('/:id/localizacao', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = localSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Localização inválida.' });
    return;
  }
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }

  const { colado, lat, lng, texto } = parsed.data;
  const bruto = (colado ?? '').trim();
  let local: Localizacao | null = null;

  if (typeof lat === 'number' && typeof lng === 'number') {
    local = { lat, lng, link: null, texto: texto?.trim() || null, origem: 'gps', em: new Date().toISOString() };
  } else if (bruto) {
    const coord = lerCoordenadas(bruto);
    const ehLink = /^https?:\/\//i.test(bruto);
    local = {
      lat: coord?.lat ?? null,
      lng: coord?.lng ?? null,
      // guarda o link mesmo quando as coordenadas saíram dele: link curto do
      // maps.app.goo.gl não tem coordenada nenhuma e continua sendo o que abre.
      link: ehLink ? bruto : null,
      texto: texto?.trim() || (coord || ehLink ? null : bruto),
      origem: 'colado',
      em: new Date().toISOString(),
    };
    // Nem coordenada, nem link, nem texto: não há o que guardar.
    if (!local.lat && !local.link && !local.texto) local = null;
  }

  const { error } = await supabase
    .from('vistorias')
    .update({ localizacao: local, updated_at: new Date().toISOString() })
    .eq('id', v.id)
    .eq('user_id', req.userId);

  if (error) {
    logger.error('vistorias', 'falha salvando localizacao', error);
    res.status(500).json({ error: 'Não consegui salvar a localização.' });
    return;
  }
  res.json({ ok: true, localizacao: local });
});

// ── PUT /vistorias/:id/status — grava o status dos itens técnicos ───────────────
// O corpo traz o mapa COMPLETO vindo da tela. Chave fora dos 10 itens técnicos e valor
// fora dos 4 status são descartados. Não passa pela RPC vistoria_patch_item (o corpo dela
// não está versionado e pode sobrescrever `obs`): grava na coluna própria.
const statusSchema = z.object({ status_itens: z.record(z.string(), z.unknown()) });

router.put('/:id/status', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = statusSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados inválidos' });
    return;
  }
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  if (v.status === 'concluida') {
    res.status(409).json({ error: 'Vistoria concluída. Reabra para editar.' });
    return;
  }
  const extras = await extrasOu500(res, v.id);
  if (!extras) return;
  if (!extras.disponivel) {
    res.status(503).json({ error: 'migracao_pendente' });
    return;
  }
  const status_itens = sanitizarStatus(parsed.data.status_itens);
  const { error } = await supabase
    .from('vistorias')
    .update({ status_itens, updated_at: new Date().toISOString() })
    .eq('id', v.id)
    .eq('user_id', req.userId);
  if (error) {
    if (colunaAusente(error)) {
      res.status(503).json({ error: 'migracao_pendente' });
      return;
    }
    logger.error('vistorias', 'falha gravando status', error);
    res.status(500).json({ error: 'Não consegui salvar o status.' });
    return;
  }
  const itens = Array.isArray(v.itens) ? v.itens : [];
  res.json({ ok: true, status_itens, resumo: resumo(itens, status_itens) });
});

// ── PUT /vistorias/:id/compras: grava a lista de compras INTEIRA ────────────────
// Modelada no PUT /:id/status: o corpo traz a lista completa vinda da tela, o último a gravar vence e
// vistoria concluída é 409. Não passa pelas RPCs (vistoria_patch_item e companhia): grava na coluna própria.
// Cada linha é saneada aqui (nome, quantidade, unidade, quem providencia); lista acima do limite é 400,
// nunca corta calado. Idempotente: repetir o mesmo corpo dá o mesmo resultado, então o reenvio é seguro.
const comprasSchema = z.object({ publica: z.boolean().optional(), linhas: z.array(z.unknown()).max(200) });

router.put('/:id/compras', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = comprasSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados inválidos' });
    return;
  }
  if (JSON.stringify(parsed.data.linhas).length > LIMITES.json) {
    res.status(413).json({ error: 'Lista grande demais.' });
    return;
  }
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  if (v.status === 'concluida') {
    res.status(409).json({ error: 'Vistoria concluída. Reabra para editar.' });
    return;
  }
  const lida = await comprasOu500(res, v.id);
  if (!lida) return;
  if (!lida.disponivel) {
    res.status(503).json({ error: 'migracao_pendente' });
    return;
  }
  const { linhas, descartadas } = sanitizarLinhas(parsed.data.linhas);
  if (linhas.length > LIMITES.linhas) {
    res.status(400).json({ error: `A lista aceita até ${LIMITES.linhas} itens.` });
    return;
  }
  const publica = parsed.data.publica ?? lida.compras.publica;
  const compras = { v: 1 as const, publica, linhas };
  const { error } = await supabase
    .from('vistorias')
    .update({ compras, updated_at: new Date().toISOString() })
    .eq('id', v.id)
    .eq('user_id', req.userId);
  if (error) {
    if (colunaAusente(error)) {
      res.status(503).json({ error: 'migracao_pendente' });
      return;
    }
    logger.error('vistorias', 'falha gravando a lista de compras', error);
    res.status(500).json({ error: 'Não consegui salvar a lista de compras.' });
    return;
  }
  res.json({ ok: true, compras, descartadas });
});

// ── Assinaturas (técnico e cliente) ─────────────────────────────────────────────
const MAX_BYTES_ASSINATURA = 500_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

const assinSchema = z.object({
  papel: z.enum(['tecnico', 'cliente']),
  nome: z.string().trim().max(120).default(''),
  registro: z.string().trim().max(60).optional(),
  png: z.string().min(30),
});

router.post('/:id/assinatura', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = assinSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Dados da assinatura inválidos' });
    return;
  }
  const { papel, nome, registro, png } = parsed.data;
  if (papel === 'tecnico' && !nome) {
    res.status(400).json({ error: 'Informe o nome do técnico.' });
    return;
  }
  const m = PNG_DATA_URL.exec(png);
  const buffer = m ? Buffer.from(m[1], 'base64') : null;
  if (!buffer || buffer.length < 8 || !buffer.subarray(0, 4).equals(PNG_MAGIC)) {
    res.status(400).json({ error: 'Assinatura inválida.' });
    return;
  }
  if (buffer.length > MAX_BYTES_ASSINATURA) {
    res.status(413).json({ error: 'Assinatura muito grande.' });
    return;
  }

  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  if (v.status === 'concluida') {
    res.status(409).json({ error: 'Vistoria concluída. Reabra para editar.' });
    return;
  }
  const inicial = await extrasOu500(res, v.id);
  if (!inicial) return;
  if (!inicial.disponivel) {
    res.status(503).json({ error: 'migracao_pendente' });
    return;
  }

  const path = `vistorias/${req.userId}/${v.id}/assinatura-${papel}-${Date.now()}.png`;
  const { error: upErr } = await supabase.storage.from(BUCKET_DOC).upload(path, buffer, { contentType: 'image/png', upsert: false });
  if (upErr) {
    logger.error('vistorias', 'upload da assinatura falhou', upErr);
    res.status(502).json({ error: 'Não consegui salvar. Tente de novo.' });
    return;
  }

  // Relê logo antes de gravar: duas assinaturas quase juntas (técnico e cliente) não se sobrescrevem.
  let fresco: Extras;
  try {
    fresco = await lerExtras(v.id);
  } catch (err) {
    // Sem saber o que já está gravado, gravar por cima poderia apagar a outra assinatura.
    supabase.storage.from(BUCKET_DOC).remove([path]).catch(() => {});
    logger.error('vistorias', 'falha relendo assinaturas', err);
    res.status(500).json({ error: 'Não consegui salvar. Tente de novo.' });
    return;
  }
  if (!fresco.disponivel) {
    supabase.storage.from(BUCKET_DOC).remove([path]).catch(() => {});
    res.status(503).json({ error: 'migracao_pendente' });
    return;
  }
  const assinaturas: AssinMap = { ...fresco.assinaturas };
  const antiga = assinaturas[papel]?.path;
  assinaturas[papel] = { path, nome, ...(papel === 'tecnico' ? { registro: registro ?? '' } : {}), ts: new Date().toISOString() };
  const { error } = await supabase
    .from('vistorias')
    .update({ assinaturas, updated_at: new Date().toISOString() })
    .eq('id', v.id)
    .eq('user_id', req.userId);
  if (error) {
    supabase.storage.from(BUCKET_DOC).remove([path]).catch(() => {});
    if (colunaAusente(error)) {
      res.status(503).json({ error: 'migracao_pendente' });
      return;
    }
    logger.error('vistorias', 'falha gravando assinatura', error);
    res.status(500).json({ error: 'Subiu mas não consegui registrar. Tente de novo.' });
    return;
  }

  // Corrida entre as duas assinaturas: se outra requisição gravou no meio, uma das duas pode ter
  // sumido. Relê e, se faltar a nossa ou a do outro papel que já existia, junta e grava uma vez.
  try {
    const outro = papel === 'tecnico' ? 'cliente' : 'tecnico';
    const depois = await lerExtras(v.id);
    const junto: AssinMap = { ...depois.assinaturas };
    let mudou = false;
    if (junto[papel]?.path !== path) { junto[papel] = assinaturas[papel]; mudou = true; }
    if (fresco.assinaturas[outro] && !junto[outro]) { junto[outro] = fresco.assinaturas[outro]; mudou = true; }
    if (mudou) {
      const { error: regravar } = await supabase.from('vistorias')
        .update({ assinaturas: junto, updated_at: new Date().toISOString() })
        .eq('id', v.id).eq('user_id', req.userId);
      if (regravar) logger.error('vistorias', 'falha regravando assinaturas juntas', regravar);
    }
  } catch (err) {
    logger.error('vistorias', 'falha conferindo assinaturas depois de gravar', err);
  }

  if (antiga) supabase.storage.from(BUCKET_DOC).remove([antiga]).catch(() => {});

  const { data: signed } = await supabase.storage.from(BUCKET_DOC).createSignedUrl(path, 3600);
  res.json({ ok: true, papel, path, url: signed?.signedUrl ?? null, nome, registro: assinaturas[papel]?.registro });
});

router.delete('/:id/assinatura', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const papel = z.enum(['tecnico', 'cliente']).safeParse(req.query.papel);
  if (!papel.success) {
    res.status(400).json({ error: 'Dados inválidos' });
    return;
  }
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  if (v.status === 'concluida') {
    res.status(409).json({ error: 'Vistoria concluída. Reabra para editar.' });
    return;
  }
  const extras = await extrasOu500(res, v.id);
  if (!extras) return;
  if (!extras.disponivel) {
    res.status(503).json({ error: 'migracao_pendente' });
    return;
  }
  const assinaturas: AssinMap = { ...extras.assinaturas };
  const antiga = assinaturas[papel.data]?.path;
  delete assinaturas[papel.data];
  const { error } = await supabase
    .from('vistorias')
    .update({ assinaturas, updated_at: new Date().toISOString() })
    .eq('id', v.id)
    .eq('user_id', req.userId);
  if (error) {
    if (colunaAusente(error)) {
      res.status(503).json({ error: 'migracao_pendente' });
      return;
    }
    logger.error('vistorias', 'falha removendo assinatura', error);
    res.status(500).json({ error: 'Não consegui remover.' });
    return;
  }
  if (antiga) supabase.storage.from(BUCKET_DOC).remove([antiga]).catch(() => {});
  res.json({ ok: true });
});

// ── POST /vistorias/:id/reabrir — volta uma vistoria concluída para em andamento ─
router.post('/:id/reabrir', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const v = await getOwned(String(req.params.id), req.userId);
  if (!v) {
    res.status(404).json({ error: 'Vistoria não encontrada.' });
    return;
  }
  if (v.status !== 'concluida') {
    res.status(409).json({ error: 'A vistoria não está concluída.' });
    return;
  }
  const { error } = await supabase
    .from('vistorias')
    .update({ status: 'em_andamento', updated_at: new Date().toISOString() })
    .eq('id', v.id)
    .eq('user_id', req.userId);
  if (error) {
    logger.error('vistorias', 'falha reabrindo', error);
    res.status(500).json({ error: 'Não consegui reabrir a vistoria.' });
    return;
  }
  res.json({ ok: true, id: v.id, status: 'em_andamento' });
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
  // A vistoria já está concluída: se a leitura do status falhar, a resposta só vem sem selo.
  let statusItens: Extras['status_itens'] = {};
  try { statusItens = (await lerExtras(v.id)).status_itens; } catch (err) { logger.error('vistorias', 'falha lendo status ao concluir', err); }
  res.json({ ok: true, id: v.id, resumo: resumo(Array.isArray(v.itens) ? v.itens : [], statusItens) });
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

/** Nome de arquivo seguro: sem acento, minúsculo, só a-z0-9 e hífen. */
export function slugify(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

/**
 * Montador do ZIP de fotos e arquivos da vistoria: a mesma montagem do ZIP público (/v/:id/fotos.zip), numa função
 * só. A rota autenticada (GET /vistorias/:id/fotos.zip) chama com tudo; o ZIP público, que ainda tem a cópia inline
 * em publicVistoria.ts, passa a chamar esta função pulando o documento (`pularItens: ['documento_pessoal']`).
 * Cada arquivo é baixado do Storage e entra com nome organizado: `01-conta-de-luz-1.jpg`, `02-cnh-identidade-1.jpg`...
 * A numeração é a POSIÇÃO do item no checklist, então pular um item (por chave) não renumera os outros. O ZIP sai
 * sempre na ordem do checklist. Arquivo que não baixa fica de fora, sem derrubar o ZIP. Devolve null quando nenhum
 * arquivo entrou (quem chama responde 404).
 */
export async function montarZipDaVistoria(
  itens: unknown,
  opcoes: { pularItens?: readonly string[] } = {},
): Promise<Buffer | null> {
  type ArquivoZip = { url?: unknown };
  type ItemZip = { key?: unknown; label?: unknown; fotos?: unknown };
  const pular = new Set(opcoes.pularItens ?? []);
  const lista = (Array.isArray(itens) ? itens : []) as ItemZip[];

  // Baixa tudo em paralelo; o Promise.all mantém a ordem, então o ZIP sai sempre na ordem do checklist.
  const baixados = await Promise.all(
    lista.flatMap((item, i) => {
      if (typeof item?.key === 'string' && pular.has(item.key)) return [];
      const arquivos = (Array.isArray(item?.fotos) ? item.fotos : []) as ArquivoZip[];
      const ordem = String(i + 1).padStart(2, '0');
      const base = slugify(typeof item?.label === 'string' ? item.label : '');
      return arquivos.map(async (f, j) => {
        if (typeof f?.url !== 'string') return null;
        const { data: blob, error } = await supabase.storage.from(BUCKET).download(f.url);
        if (error || !blob) return null;
        const buf = Buffer.from(await blob.arrayBuffer());
        const ext = (f.url.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        return { nome: `${ordem}-${base}-${j + 1}.${ext}`, buf };
      });
    }),
  );

  const zip = new JSZip();
  let adicionados = 0;
  for (const b of baixados) {
    if (!b) continue;
    zip.file(b.nome, b.buf);
    adicionados++;
  }
  if (adicionados === 0) return null;
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

export default router;
