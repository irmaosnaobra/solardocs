import { Router, Request, Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  GRUPOS_FOTO, MAX_FOTOS_GRUPO, MAX_FOTOS_RELATORIO, SECOES,
  Dados, dadosPadrao, dadosSchema, dataValida, diasEntre, hojeBRT, montarResumo, normalizarDados,
  proximoCodigo, somarMeses,
} from '../services/manutencao/relatorio';
import {
  BUCKET, UUID_RE, AssinMap, FotosMap, LinhaManutencao, assinaturasDe, fotosDe, tabelaAusente, urlsAssinadas,
} from '../services/manutencao/armazenamento';

// ─────────────────────────────────────────────────────────────────────────────
// Manutenção preventiva — relatório de campo com checklist, fotos e assinaturas.
// Espelha a Vistoria (vistorias.ts): mesmo login, mesmo bucket `documentos`, signed
// URL gerada na hora. Tabela própria (`manutencoes`) porque `documents` é lida por
// robôs de follow-up e um tipo novo ali vazaria para eles.
//
// `dados` é do cliente (o PUT substitui). `fotos` e `assinaturas` são do servidor:
// o PUT nunca toca nelas. Toda escrita sobe `updated_at`, porque o PDF público é
// guardado por versão (`relatorio-<updated_at>.pdf`).
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

const COLS = 'id, user_id, cliente_id, cliente_nome, codigo, status, selo, data_inspecao, proxima_visita, dados, fotos, assinaturas, concluida_em, created_at, updated_at';
const MAX_BYTES_FOTO = 9_000_000;
const MAX_BYTES_ASSINATURA = 2_000_000;

type Falha = { code?: string; message?: string } | null | undefined;

/** Resposta de erro: `erro` (contrato) e `error` (o que o resto do app já lê). */
function falha(res: Response, status: number, mensagem: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ erro: mensagem, error: mensagem, ...extra });
}

/** Se a tabela ainda não existe responde 503 migracao_pendente e devolve true. */
function migracaoPendente(res: Response, error: Falha): boolean {
  if (!tabelaAusente(error)) return false;
  falha(res, 503, 'migracao_pendente');
  return true;
}

/** Tabela ausente vira 503; qualquer outro erro vira 500 com a mensagem dada. Devolve true se respondeu. */
function erroBanco(res: Response, error: Falha, contexto: string, mensagem: string): boolean {
  if (!error) return false;
  if (migracaoPendente(res, error)) return true;
  logger.error('manutencoes', contexto, error);
  falha(res, 500, mensagem);
  return true;
}

/** Relatório do usuário logado, ou 404 (id mal formado, de outro usuário ou inexistente). Já responde quando não acha. */
async function carregar(req: Request, res: Response): Promise<LinhaManutencao | null> {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) { falha(res, 404, 'Relatório não encontrado.'); return null; }
  const { data, error } = await supabase
    .from('manutencoes').select(COLS).eq('id', id).eq('user_id', req.userId).maybeSingle();
  if (erroBanco(res, error, 'falha lendo relatório', 'Não consegui carregar o relatório.')) return null;
  if (!data) { falha(res, 404, 'Relatório não encontrado.'); return null; }
  return data as LinhaManutencao;
}

/** Linha completa no formato do GET /:id. */
async function detalhe(l: LinhaManutencao) {
  const dados = normalizarDados((l.dados ?? {}) as Partial<Dados>);
  const { user_id: _u, ...resto } = l;
  void _u;
  return {
    ...resto,
    dados,
    fotos: fotosDe(l),
    assinaturas: assinaturasDe(l),
    ...(await urlsAssinadas(l)),
    resumo: montarResumo(dados, l.data_inspecao),
  };
}

/** Responsável padrão: 1º técnico preenchido da empresa, senão o engenheiro, senão vazio. */
async function responsavelPadrao(userId: string): Promise<{ nome: string; registro: string }> {
  const { data } = await supabase.from('company').select('*').eq('user_id', userId).limit(1).maybeSingle();
  const c = (data ?? {}) as Record<string, unknown>;
  const s = (k: string) => String(c[k] ?? '').trim();
  for (const [nome, reg] of [['tecnico_nome', 'tecnico_crt_cft'], ['tecnico2_nome', 'tecnico2_crt_cft'], ['tecnico3_nome', 'tecnico3_crt_cft']]) {
    if (s(nome!)) return { nome: s(nome!), registro: s(reg!) };
  }
  if (s('engenheiro_nome')) return { nome: s('engenheiro_nome'), registro: s('engenheiro_crea') };
  return { nome: '', registro: '' };
}

const uuidStr = z.string().regex(UUID_RE);

// ── POST /manutencoes ───────────────────────────────────────────────────────
const createSchema = z.object({
  cliente_id: uuidStr.optional().nullable(),
  cliente_nome: z.string().trim().max(255).optional().nullable(),
});

router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) { falha(res, 400, 'Dados inválidos'); return; }
  const { cliente_id, cliente_nome } = parsed.data;

  // Cliente só entra se for do próprio usuário; o nome vem do cadastro.
  let nome = cliente_nome || null;
  let clienteId: string | null = null;
  if (cliente_id) {
    const { data: cli } = await supabase.from('clients').select('id, nome').eq('id', cliente_id).eq('user_id', req.userId).maybeSingle();
    if (cli) { clienteId = cli.id; nome = cli.nome; }
  }

  const hoje = hojeBRT();
  const ano = Number(hoje.slice(0, 4));
  const dados = dadosPadrao(await responsavelPadrao(req.userId));

  // Código MP + ano + 3 dígitos: maior do usuário no ano + 1, com o índice único
  // de rede de segurança (23505 = alguém pegou o mesmo número; tenta de novo).
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const { data: usados, error: eLer } = await supabase
      .from('manutencoes').select('codigo').eq('user_id', req.userId).like('codigo', `MP${ano}%`);
    if (erroBanco(res, eLer, 'falha lendo códigos', 'Não consegui criar o relatório.')) return;

    const codigo = proximoCodigo((usados ?? []).map((r: { codigo: string | null }) => r.codigo), ano);
    const agora = new Date().toISOString();
    const { data, error } = await supabase.from('manutencoes').insert({
      id: randomUUID(),
      user_id: req.userId,
      cliente_id: clienteId,
      cliente_nome: nome,
      codigo,
      status: 'em_andamento',
      selo: null,
      data_inspecao: hoje,
      proxima_visita: somarMeses(hoje, dados.periodicidade_meses),
      dados,
      fotos: {},
      assinaturas: {},
      concluida_em: null,
      created_at: agora,
      updated_at: agora,
    }).select(COLS).single();

    if (!error && data) { res.json(await detalhe(data as LinhaManutencao)); return; }
    if (error?.code === '23505' && tentativa < 3) continue;
    erroBanco(res, error ?? { message: 'sem linha' }, 'falha criando relatório', 'Não consegui criar o relatório.');
    return;
  }
});

// ── GET /manutencoes/list ───────────────────────────────────────────────────
router.get('/list', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabase
    .from('manutencoes')
    .select('id, codigo, cliente_nome, status, selo, data_inspecao, proxima_visita, created_at')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (erroBanco(res, error, 'falha listando', 'Não consegui carregar os relatórios.')) return;
  res.json((data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id, codigo: r.codigo, cliente_nome: r.cliente_nome, status: r.status, selo: r.selo,
    data_inspecao: r.data_inspecao, proxima_visita: r.proxima_visita, created_at: r.created_at,
  })));
});

// ── GET /manutencoes/proximas ───────────────────────────────────────────────
const chaveNome = (s: string | null) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

router.get('/proximas', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await supabase
    .from('manutencoes')
    .select('id, cliente_id, cliente_nome, proxima_visita, data_inspecao, concluida_em, created_at')
    .eq('user_id', req.userId)
    .eq('status', 'concluida')
    .order('data_inspecao', { ascending: false })
    .limit(1000);
  if (erroBanco(res, error, 'falha lendo próximas', 'Não consegui carregar as próximas visitas.')) return;

  type R = { id: string; cliente_id: string | null; cliente_nome: string | null; proxima_visita: string | null; data_inspecao: string; concluida_em: string | null; created_at: string };
  // A mais recente por cliente: data da inspeção, depois a conclusão.
  const recente = (a: R, b: R) => {
    if (a.data_inspecao !== b.data_inspecao) return a.data_inspecao > b.data_inspecao ? a : b;
    return String(a.concluida_em ?? a.created_at) >= String(b.concluida_em ?? b.created_at) ? a : b;
  };
  const porCliente = new Map<string, R>();
  for (const r of (data ?? []) as R[]) {
    const chave = r.cliente_id ? `id:${r.cliente_id}` : (chaveNome(r.cliente_nome) ? `nome:${chaveNome(r.cliente_nome)}` : `rel:${r.id}`);
    const atual = porCliente.get(chave);
    porCliente.set(chave, atual ? recente(atual, r) : r);
  }
  const hoje = hojeBRT();
  const lista = [...porCliente.values()]
    .filter((r) => dataValida(r.proxima_visita))
    .sort((a, b) => String(a.proxima_visita).localeCompare(String(b.proxima_visita)))
    .map((r) => ({ id: r.id, cliente_nome: r.cliente_nome, proxima_visita: r.proxima_visita, dias: diasEntre(hoje, r.proxima_visita as string) }));
  res.json(lista);
});

// ── GET /manutencoes/:id ────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const l = await carregar(req, res);
  if (!l) return;
  res.json(await detalhe(l));
});

// ── PUT /manutencoes/:id — substitui `dados`; nunca toca fotos nem assinaturas ──
const putSchema = z.object({
  dados: dadosSchema,
  data_inspecao: z.string().optional(),
  cliente_id: uuidStr.nullable().optional(),
  cliente_nome: z.string().trim().max(255).nullable().optional(),
});

router.put('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const l = await carregar(req, res);
  if (!l) return;
  if (l.status === 'concluida') { falha(res, 409, 'Relatório concluído. Reabra para editar.'); return; }

  const parsed = putSchema.safeParse(req.body ?? {});
  if (!parsed.success) { falha(res, 400, 'Dados inválidos'); return; }
  const body = parsed.data;
  if (body.data_inspecao !== undefined && !dataValida(body.data_inspecao)) { falha(res, 400, 'Data da inspeção inválida.'); return; }

  const dados = normalizarDados(body.dados);
  const dataInspecao = body.data_inspecao ?? l.data_inspecao;
  const proxima = somarMeses(dataInspecao, dados.periodicidade_meses);

  const upd: Record<string, unknown> = {
    dados,
    data_inspecao: dataInspecao,
    proxima_visita: proxima,
    updated_at: new Date().toISOString(),
  };
  if (body.cliente_id !== undefined) {
    if (body.cliente_id === null) {
      upd.cliente_id = null;
      if (body.cliente_nome !== undefined) upd.cliente_nome = body.cliente_nome || null;
    } else {
      const { data: cli } = await supabase.from('clients').select('id, nome').eq('id', body.cliente_id).eq('user_id', req.userId).maybeSingle();
      if (cli) {
        upd.cliente_id = cli.id;
        upd.cliente_nome = cli.nome;
      } else {
        // Cliente apagado (ou de outro usuário): solta o vínculo e guarda o nome enviado.
        upd.cliente_id = null;
        if (body.cliente_nome !== undefined) upd.cliente_nome = body.cliente_nome || null;
      }
    }
  } else if (body.cliente_nome !== undefined) {
    upd.cliente_nome = body.cliente_nome || null;
  }

  const { error } = await supabase.from('manutencoes').update(upd).eq('id', l.id).eq('user_id', req.userId).eq('status', 'em_andamento');
  if (erroBanco(res, error, 'falha salvando', 'Não consegui salvar.')) return;
  res.json({ ok: true, resumo: montarResumo(dados, dataInspecao), updated_at: upd.updated_at });
});

// ── Fotos ───────────────────────────────────────────────────────────────────
const fotoSchema = z.object({
  grupo: z.string().min(1).max(40),
  base64: z.string().min(10),
  media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
});

/** Aceita base64 puro ou data URL. */
function lerBase64(bruto: string): Buffer | null {
  const limpo = bruto.replace(/^data:[^;]+;base64,/, '');
  const b = Buffer.from(limpo, 'base64');
  return b.length > 0 ? b : null;
}

router.post('/:id/foto', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = fotoSchema.safeParse(req.body ?? {});
  if (!parsed.success) { falha(res, 400, 'Dados da foto inválidos'); return; }
  const { grupo, base64, media_type } = parsed.data;
  if (!GRUPOS_FOTO.includes(grupo)) { falha(res, 400, 'Grupo de foto desconhecido.'); return; }

  const l = await carregar(req, res);
  if (!l) return;
  if (l.status === 'concluida') { falha(res, 409, 'Relatório concluído. Reabra para editar.'); return; }

  const buffer = lerBase64(base64);
  if (!buffer) { falha(res, 400, 'Arquivo inválido.'); return; }
  if (buffer.length > MAX_BYTES_FOTO) { falha(res, 413, 'Arquivo muito grande (máx ~9MB). Tente de novo.'); return; }

  const atuais = fotosDe(l);
  const total = Object.values(atuais).reduce((n, lista) => n + lista.length, 0);
  if ((atuais[grupo]?.length ?? 0) >= MAX_FOTOS_GRUPO) { falha(res, 422, `Limite de ${MAX_FOTOS_GRUPO} fotos neste grupo.`); return; }
  if (total >= MAX_FOTOS_RELATORIO) { falha(res, 422, `Limite de ${MAX_FOTOS_RELATORIO} fotos no relatório.`); return; }

  const ext = media_type === 'image/png' ? 'png' : media_type === 'image/webp' ? 'webp' : 'jpg';
  const path = `manutencoes/${req.userId}/${l.id}/${grupo}-${Date.now()}-${randomBytes(3).toString('hex')}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: media_type, upsert: false });
  if (upErr) {
    logger.error('manutencoes', 'upload da foto falhou', upErr);
    falha(res, 502, 'Não consegui salvar. Tente de novo.');
    return;
  }

  // Lê de novo logo antes de gravar: a tela sobe uma foto por vez, mas assim uma foto
  // que chegou no meio tempo não é sobrescrita.
  const { data: fresco, error: eLer } = await supabase.from('manutencoes').select('fotos, status').eq('id', l.id).eq('user_id', req.userId).maybeSingle();
  if (fresco && (fresco as { status?: string }).status === 'concluida') {
    supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    falha(res, 409, 'Relatório concluído. Reabra para editar.');
    return;
  }
  const fotos: FotosMap = fresco ? fotosDe(fresco) : atuais;
  fotos[grupo] = [...(fotos[grupo] ?? []), { path, ts: new Date().toISOString() }];
  // O filtro de status fecha a janela entre a releitura e o update: se concluíram agora, 0 linhas.
  const { data: gravadas, error: updErr } = eLer ? { data: null, error: eLer } : await supabase.from('manutencoes')
    .update({ fotos, updated_at: new Date().toISOString() }).eq('id', l.id).eq('user_id', req.userId).eq('status', 'em_andamento').select('id');
  if (updErr) {
    supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    if (erroBanco(res, updErr, 'falha gravando foto', 'Subiu mas não consegui registrar. Tente de novo.')) return;
  } else if (!Array.isArray(gravadas) || gravadas.length === 0) {
    supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    falha(res, 409, 'Relatório concluído. Reabra para editar.');
    return;
  }

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  res.json({ path, url: signed?.signedUrl ?? null });
});

const delFotoSchema = z.object({ path: z.string().min(1).max(500) });

router.delete('/:id/foto', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = delFotoSchema.safeParse(req.body ?? {});
  if (!parsed.success) { falha(res, 400, 'Dados inválidos'); return; }
  const { path } = parsed.data;

  const l = await carregar(req, res);
  if (!l) return;
  if (l.status === 'concluida') { falha(res, 409, 'Relatório concluído. Reabra para editar.'); return; }
  // Só apaga arquivo que é foto DESTE relatório (prefixo e presença na lista).
  if (!path.startsWith(`manutencoes/${req.userId}/${l.id}/`) || path.includes('..')) { falha(res, 400, 'Arquivo inválido.'); return; }

  // Lê de novo logo antes de gravar, como o POST: não apaga foto que subiu em paralelo.
  const { data: fresco, error: eLer } = await supabase.from('manutencoes').select('fotos, status').eq('id', l.id).eq('user_id', req.userId).maybeSingle();
  if (erroBanco(res, eLer, 'falha lendo fotos', 'Não consegui remover.')) return;
  if (fresco && (fresco as { status?: string }).status === 'concluida') { falha(res, 409, 'Relatório concluído. Reabra para editar.'); return; }
  const fotos: FotosMap = fresco ? fotosDe(fresco) : fotosDe(l);
  const grupo = Object.keys(fotos).find((g) => fotos[g]!.some((f) => f.path === path));
  if (!grupo) { falha(res, 404, 'Foto não encontrada.'); return; }
  fotos[grupo] = fotos[grupo]!.filter((f) => f.path !== path);
  if (fotos[grupo]!.length === 0) delete fotos[grupo];

  const { error } = await supabase.from('manutencoes')
    .update({ fotos, updated_at: new Date().toISOString() }).eq('id', l.id).eq('user_id', req.userId);
  if (erroBanco(res, error, 'falha removendo foto', 'Não consegui remover.')) return;
  supabase.storage.from(BUCKET).remove([path]).catch(() => {});
  res.json({ ok: true });
});

// ── Assinaturas ─────────────────────────────────────────────────────────────
const assinSchema = z.object({
  quem: z.enum(['tecnico', 'cliente']),
  base64: z.string().min(10),
  nome: z.string().trim().max(120).default(''),
  registro: z.string().trim().max(60).optional(),
});

router.post('/:id/assinatura', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = assinSchema.safeParse(req.body ?? {});
  if (!parsed.success) { falha(res, 400, 'Dados da assinatura inválidos'); return; }
  const { quem, base64, nome, registro } = parsed.data;

  const l = await carregar(req, res);
  if (!l) return;
  if (l.status === 'concluida') { falha(res, 409, 'Relatório concluído. Reabra para editar.'); return; }

  const buffer = lerBase64(base64);
  if (!buffer) { falha(res, 400, 'Arquivo inválido.'); return; }
  if (buffer.length > MAX_BYTES_ASSINATURA) { falha(res, 413, 'Assinatura muito grande.'); return; }

  const path = `manutencoes/${req.userId}/${l.id}/assinatura-${quem}-${Date.now()}.png`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'image/png', upsert: false });
  if (upErr) {
    logger.error('manutencoes', 'upload da assinatura falhou', upErr);
    falha(res, 502, 'Não consegui salvar. Tente de novo.');
    return;
  }

  const antiga = assinaturasDe(l)[quem]?.path;
  const assinaturas: AssinMap = { ...assinaturasDe(l) };
  assinaturas[quem] = { path, nome, ...(quem === 'tecnico' ? { registro: registro ?? '' } : {}), ts: new Date().toISOString() };
  const { error } = await supabase.from('manutencoes')
    .update({ assinaturas, updated_at: new Date().toISOString() }).eq('id', l.id).eq('user_id', req.userId);
  if (error) {
    supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    erroBanco(res, error, 'falha gravando assinatura', 'Subiu mas não consegui registrar. Tente de novo.');
    return;
  }
  if (antiga) supabase.storage.from(BUCKET).remove([antiga]).catch(() => {});

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  res.json({ ok: true, quem, path, url: signed?.signedUrl ?? null, nome, registro: assinaturas[quem]?.registro });
});

router.delete('/:id/assinatura', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const parsed = z.object({ quem: z.enum(['tecnico', 'cliente']) }).safeParse(req.body ?? {});
  if (!parsed.success) { falha(res, 400, 'Dados inválidos'); return; }
  const { quem } = parsed.data;

  const l = await carregar(req, res);
  if (!l) return;
  if (l.status === 'concluida') { falha(res, 409, 'Relatório concluído. Reabra para editar.'); return; }

  const assinaturas: AssinMap = { ...assinaturasDe(l) };
  const antiga = assinaturas[quem]?.path;
  delete assinaturas[quem];
  const { error } = await supabase.from('manutencoes')
    .update({ assinaturas, updated_at: new Date().toISOString() }).eq('id', l.id).eq('user_id', req.userId);
  if (erroBanco(res, error, 'falha removendo assinatura', 'Não consegui remover.')) return;
  if (antiga) supabase.storage.from(BUCKET).remove([antiga]).catch(() => {});
  res.json({ ok: true });
});

// ── Concluir e reabrir ──────────────────────────────────────────────────────
router.post('/:id/concluir', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const l = await carregar(req, res);
  if (!l) return;
  if (l.status === 'concluida') { res.json(await detalhe(l)); return; }

  const dados = normalizarDados((l.dados ?? {}) as Partial<Dados>);
  const resumo = montarResumo(dados, l.data_inspecao);
  if (resumo.faltam_status > 0) {
    falha(res, 422, SECOES.aviso_sem_status, { faltam_status: resumo.faltam_status });
    return;
  }
  if (!dados.atividades.some((a) => a.feita)) {
    falha(res, 422, 'Marque ao menos uma atividade realizada para continuar.', { faltam_status: 0, sem_atividade: true });
    return;
  }

  const agora = new Date().toISOString();
  const { data, error } = await supabase.from('manutencoes').update({
    status: 'concluida',
    selo: resumo.selo,
    proxima_visita: resumo.proxima_visita,
    concluida_em: agora,
    updated_at: agora,
  }).eq('id', l.id).eq('user_id', req.userId).select(COLS);
  if (erroBanco(res, error, 'falha concluindo', 'Não consegui concluir o relatório.')) return;
  const nova = (Array.isArray(data) ? data[0] : data) as LinhaManutencao | undefined;
  res.json(await detalhe(nova ?? { ...l, status: 'concluida', selo: resumo.selo, proxima_visita: resumo.proxima_visita, concluida_em: agora, updated_at: agora }));
});

router.post('/:id/reabrir', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const l = await carregar(req, res);
  if (!l) return;
  const agora = new Date().toISOString();
  const { data, error } = await supabase.from('manutencoes').update({
    status: 'em_andamento', selo: null, concluida_em: null, updated_at: agora,
  }).eq('id', l.id).eq('user_id', req.userId).select(COLS);
  if (erroBanco(res, error, 'falha reabrindo', 'Não consegui reabrir o relatório.')) return;
  const nova = (Array.isArray(data) ? data[0] : data) as LinhaManutencao | undefined;
  res.json(await detalhe(nova ?? { ...l, status: 'em_andamento', selo: null, concluida_em: null, updated_at: agora }));
});

// ── DELETE /manutencoes/:id — apaga a linha e tudo do prefixo no bucket ─────
router.delete('/:id', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const l = await carregar(req, res);
  if (!l) return;
  const { error } = await supabase.from('manutencoes').delete().eq('id', l.id).eq('user_id', req.userId);
  if (erroBanco(res, error, 'falha apagando', 'Não consegui apagar o relatório.')) return;

  // Best-effort: fotos, assinaturas e versões do PDF. A listagem padrão corta em 100.
  try {
    const prefixo = `manutencoes/${req.userId}/${l.id}`;
    const { data: arquivos } = await supabase.storage.from(BUCKET).list(prefixo, { limit: 1000 });
    const caminhos = (arquivos ?? []).filter((a: { name?: string }) => a?.name).map((a: { name: string }) => `${prefixo}/${a.name}`);
    if (caminhos.length) await supabase.storage.from(BUCKET).remove(caminhos);
  } catch (e) {
    logger.warn('manutencoes', 'limpeza do bucket falhou', e);
  }
  res.json({ ok: true });
});

export default router;
