import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { ApiError } from '../utils/apiError';
import { generateDocumentWithAI } from '../services/aiService';
import { generateFromTemplate, type Client } from '../services/templateService';
import { checkLimit, incrementUsed } from '../services/planService';
import { logger } from '../utils/logger';

const generateSchema = z.object({
  tipo: z.string().min(1),
  cliente_id: z.string().uuid().optional(),
  terceiro_id: z.string().uuid().optional(),
  // Modo avulso: nome do cliente sem cadastro completo (vistoria + propostaSolar)
  cliente_nome_avulso: z.string().min(2).optional(),
  fields: z.record(z.string(), z.unknown()),
  useTemplate: z.boolean().optional().default(false),
  modeloNumero: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(1),
});

// Tipos que aceitam modo rapido (so nome do cliente, sem cadastro)
const TIPOS_MODO_RAPIDO = ['vistoria', 'propostaSolar'];

// Reemissão de um doc que já existe (botão "Editar proposta"). Mesmo formato do
// generate menos o tipo/cliente — esses vêm da linha salva, não do cliente HTTP.
const regenerateSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  useTemplate: z.boolean().optional().default(true),
  modeloNumero: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(1),
  cliente_nome_avulso: z.string().min(2).optional(),
});

const saveSchema = z.object({
  tipo: z.string().min(1),
  cliente_id: z.string().uuid().optional(),
  terceiro_id: z.string().uuid().optional(),
  cliente_nome: z.string().optional(),
  dados_json: z.record(z.string(), z.unknown()).optional(),
  content: z.string().min(1),
  modelo_usado: z.string().optional(),
});

export async function generateDocument(req: Request, res: Response): Promise<void> {
  try {
    const body = generateSchema.parse(req.body);

    const aceitaAvulso = TIPOS_MODO_RAPIDO.includes(body.tipo);
    const usandoAvulso = aceitaAvulso && !!body.cliente_nome_avulso && !body.cliente_id && !body.terceiro_id;

    if (!body.cliente_id && !body.terceiro_id && !usandoAvulso) {
      throw new ApiError(400, aceitaAvulso
        ? 'Informe cliente_id, terceiro_id ou cliente_nome_avulso'
        : 'Informe cliente_id ou terceiro_id');
    }

    if (body.tipo === 'prestacaoServico' && !body.terceiro_id) {
      throw new ApiError(400, 'Prestação de Serviço requer um terceiro (CONTRATADA)');
    }

    const { data: company } = await supabase
      .from('company')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (!company || !company.cnpj) {
      throw new ApiError(400, 'Cadastre sua empresa (CNPJ obrigatório) antes de gerar documentos');
    }

    // Free plan só libera o Gerador de Proposta — resto exige upgrade.
    // Sidebar já tranca visualmente, mas o endpoint precisa garantir.
    const { data: planUser } = await supabase
      .from('users').select('plano, is_admin').eq('id', req.userId).single();
    if (planUser && !planUser.is_admin && planUser.plano === 'free' && body.tipo !== 'propostaSolar') {
      throw new ApiError(402, 'Faça upgrade pra gerar esse tipo de documento. O plano gratuito libera só o Gerador de Proposta.');
    }

    // Fetch client or terceiro and map to unified entity
    let entity: Record<string, unknown>;
    let entityNome: string;

    if (usandoAvulso) {
      // Cliente avulso: só nome, resto vazio. Template lida com campos faltantes.
      entityNome = (body.cliente_nome_avulso || '').trim();
      entity = { nome: entityNome };
    } else if (body.terceiro_id) {
      const { data: terceiro } = await supabase
        .from('terceiros')
        .select('*')
        .eq('id', body.terceiro_id)
        .eq('user_id', req.userId)
        .single();

      if (!terceiro) throw new ApiError(404, 'Terceiro não encontrado');
      entity = terceiro;
      entityNome = terceiro.nome;
    } else {
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('id', body.cliente_id)
        .eq('user_id', req.userId)
        .single();

      if (!client) throw new ApiError(404, 'Cliente não encontrado');
      entity = client;
      entityNome = client.nome;
    }

    // For prestacaoServico: also fetch cliente final and inject into fields
    if (body.tipo === 'prestacaoServico' && body.cliente_id) {
      const { data: clienteFinal } = await supabase
        .from('clients')
        .select('*')
        .eq('id', body.cliente_id)
        .eq('user_id', req.userId)
        .single();

      if (clienteFinal) {
        body.fields = {
          ...body.fields,
          cliente_final_nome: clienteFinal.nome,
          cliente_final_telefone: (body.fields.telefone_cliente as string) || '',
          cliente_final_endereco_instalacao: (body.fields.endereco_instalacao as string) || clienteFinal.endereco || '',
          cliente_final_tipo_telhado: clienteFinal.tipo_telhado || '',
          cliente_final_padrao: clienteFinal.padrao || '',
        };
      }
    }

    let content: string;
    let modeloUsado: string;

    await checkLimit(req.userId);

    // Pra propostaSolar, gera o código ANTES do template pra injetar no HTML
    // (assim o cabeçalho do PDF mostra "Proposta 202600010001")
    let codigo: string | null = null;
    let codigoCurto: string | null = null;
    let empresaSlug: string | null = null;
    if (body.tipo === 'propostaSolar' && req.userId) {
      try {
        codigo = await generateCodigoProposta(req.userId);
        body.fields = { ...body.fields, codigo };
      } catch (err) {
        logger.error('documents', 'falha gerando codigo proposta — segue sem codigo', err);
      }
      try {
        const slugAndCurto = await ensureEmpresaSlugAndCodigoCurto(req.userId, company.id);
        empresaSlug = slugAndCurto.slug;
        codigoCurto = slugAndCurto.codigoCurto;
      } catch (err) {
        logger.error('documents', 'falha gerando slug/codigo_curto — segue só com codigo legacy', err);
      }
    }

    const tmplOut: { resumo?: string } = {};
    if (body.useTemplate) {
      content = generateFromTemplate(body.tipo, company, entity as unknown as Client, body.fields, body.modeloNumero, tmplOut);
      modeloUsado = `modelo-${body.modeloNumero}`;
    } else {
      content = await generateDocumentWithAI(body.tipo, company, entity as unknown as Client, body.fields);
      modeloUsado = process.env.OPENAI_API_KEY ? 'gpt-4o' : 'claude-opus-4-6';
    }

    await incrementUsed(req.userId);

    // VIPs e admins têm o HTML subido pra Storage automaticamente —
    // garante que o doc fica acessível pra sempre via /historico.
    const { data: userPlan } = await supabase
      .from('users').select('plano, is_admin').eq('id', req.userId).single();
    const isVip = userPlan?.is_admin || userPlan?.plano === 'ilimitado';

    let arquivo_url: string | null = null;
    if (isVip) {
      const safeName = entityNome.replace(/\s+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '');
      const fileName = `${req.userId}/${body.tipo}-${safeName || 'doc'}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(injectPrint(content), 'utf-8'), {
          contentType: 'text/html; charset=utf-8',
          upsert: false,
        });
      if (!uploadError) {
        arquivo_url = fileName;
      } else {
        logger.error('documents', 'Storage upload falhou', uploadError);
      }
    }

    // Save record immediately so it always appears in history
    // (codigo já foi gerado antes do template, se for propostaSolar)
    const insertPayload: Record<string, unknown> = {
      user_id:     req.userId,
      tipo:        body.tipo,
      cliente_id:  body.cliente_id  || null,
      terceiro_id: body.terceiro_id || null,
      cliente_nome: entityNome,
      dados_json:  body.fields,
      content,
      modelo_usado: modeloUsado,
      arquivo_url,
      status: 'saved',
    };
    if (codigoCurto) insertPayload.codigo_curto = codigoCurto;

    // Retry em colisao de codigo_curto: se 2 propostas geram simultaneamente, ambas leem o
    // mesmo MAX e tentam o mesmo número. Unique parcial (user_id, codigo_curto) WHERE NOT NULL
    // bloqueia a 2ª — aí incrementa o sufixo em +1 e tenta de novo até achar livre.
    let saved: { id: string } | null = null;
    let insertErr: { code?: string; message?: string } | null = null;
    for (let attempt = 1; attempt <= 12; attempt++) {
      const result = await supabase.from('documents').insert(insertPayload).select('id').single();
      if (!result.error) {
        saved = result.data;
        insertErr = null;
        break;
      }
      insertErr = result.error;
      const isCodigoRace = insertPayload.codigo_curto
        && result.error.code === '23505'
        && /codigo_curto/i.test(result.error.message || '');
      if (!isCodigoRace) break;
      // Incrementa o sufixo em +1 (determinístico) em vez de recalcular pelo mesmo
      // caminho — recalcular devolveria o MESMO codigo_curto e o retry nunca convergiria.
      const cc = String(insertPayload.codigo_curto);
      codigoCurto = `${cc.slice(0, 4)}${String(Number(cc.slice(-4)) + 1).padStart(4, '0')}`;
      insertPayload.codigo_curto = codigoCurto;
      logger.warn('documents', `colisao em codigo_curto, retry ${attempt} com ${codigoCurto}`);
    }

    // BLINDAGEM: emitir o documento NUNCA pode falhar por causa da numeração (cosmética).
    // Se depois de todas as tentativas ainda colidiu, ou se o insert falhou por qualquer
    // outra causa ligada ao codigo_curto, salva SEM numero (codigo_curto = null). A unique
    // é parcial (WHERE codigo_curto IS NOT NULL), então linhas null nunca colidem. O doc
    // fica 100% acessível por id/UUID (PDF, histórico, link público /p/:UUID) — só perde o
    // link curto bonito daquele doc, que é recuperável reeditando depois.
    if (!saved && insertPayload.codigo_curto) {
      logger.error('documents', 'codigo_curto insistiu em colidir — salvando sem numero (blindagem)', insertErr);
      delete insertPayload.codigo_curto;
      codigoCurto = null;
      const fallback = await supabase.from('documents').insert(insertPayload).select('id').single();
      if (!fallback.error) {
        saved = fallback.data;
        insertErr = null;
      } else {
        insertErr = fallback.error;
      }
    }

    if (insertErr || !saved) {
      logger.error('documents', 'INSERT documents falhou', insertErr);
      res.status(500).json({ error: 'Falha ao salvar documento', detail: insertErr?.message });
      return;
    }

    res.json({ content, modelo_usado: modeloUsado, tipo: body.tipo, cliente_nome: entityNome, doc_id: saved?.id ?? null, codigo, codigo_curto: codigoCurto, empresa_slug: empresaSlug, resumo_whatsapp: tmplOut.resumo ?? null });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    logger.error('documents', 'generateDocument falhou', err);
    res.status(500).json({ error: 'Erro ao gerar documento' });
  }
}

function injectPrint(html: string): string {
  const script = `<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>`;
  return html.includes('window.print') ? html : html.replace('</body>', script + '</body>');
}

// POST /documents/:id/regenerate — reemite um documento que JÁ existe com os campos
// corrigidos ("achei um erro na proposta pronta"). Mantém id, codigo e codigo_curto:
// o link /p/{slug}.{codigo} e o PDF continuam os mesmos, porque o consultor pode já
// ter mandado o link antes de ver o erro. E não consome cota do plano — corrigir um
// typo não é emitir documento novo.
export async function regenerateDocument(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const body = regenerateSchema.parse(req.body);

    const { data: doc } = await supabase
      .from('documents')
      .select('id, tipo, cliente_id, terceiro_id, cliente_nome, arquivo_url, dados_json, codigo_curto')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!doc) throw new ApiError(404, 'Documento não encontrado');

    // prestacaoServico injeta dados do cliente final na geração (ver generateDocument).
    // Reemitir sem repetir essa injeção sairia com o contrato pela metade, então fica
    // de fora até alguém precisar — os outros tipos são função pura dos fields.
    if (doc.tipo === 'prestacaoServico') {
      throw new ApiError(400, 'Esse tipo de documento ainda não pode ser reeditado. Gere um novo.');
    }

    const { data: company } = await supabase
      .from('company')
      .select('*')
      .eq('user_id', req.userId)
      .single();

    if (!company || !company.cnpj) {
      throw new ApiError(400, 'Cadastre sua empresa (CNPJ obrigatório) antes de gerar documentos');
    }

    // Mesmo portão do generate: free só mexe em proposta.
    const { data: planUser } = await supabase
      .from('users').select('plano, is_admin').eq('id', req.userId).single();
    if (planUser && !planUser.is_admin && planUser.plano === 'free' && doc.tipo !== 'propostaSolar') {
      throw new ApiError(402, 'Faça upgrade pra editar esse tipo de documento. O plano gratuito libera só o Gerador de Proposta.');
    }

    // A entidade vem da linha salva. Só o avulso (proposta/vistoria sem cadastro)
    // aceita nome novo — é lá que mora o typo no nome do cliente.
    let entity: Record<string, unknown>;
    let entityNome: string;

    if (doc.terceiro_id) {
      const { data: terceiro } = await supabase
        .from('terceiros').select('*').eq('id', doc.terceiro_id).eq('user_id', req.userId).single();
      if (!terceiro) throw new ApiError(404, 'Terceiro não encontrado');
      entity = terceiro;
      entityNome = terceiro.nome;
    } else if (doc.cliente_id) {
      const { data: client } = await supabase
        .from('clients').select('*').eq('id', doc.cliente_id).eq('user_id', req.userId).single();
      if (!client) throw new ApiError(404, 'Cliente não encontrado');
      entity = client;
      entityNome = client.nome;
    } else {
      entityNome = (body.cliente_nome_avulso || doc.cliente_nome || '').trim();
      if (!entityNome) throw new ApiError(400, 'Informe o nome do cliente');
      entity = { nome: entityNome };
    }

    // O número da proposta vive no dados_json (o generate injeta antes do template).
    // Reeditar não renumera: o cabeçalho e o link precisam bater com o que já foi enviado.
    const dadosAntigos = (doc.dados_json ?? {}) as Record<string, unknown>;
    const fields: Record<string, unknown> = { ...body.fields };
    if (dadosAntigos.codigo && !fields.codigo) fields.codigo = dadosAntigos.codigo;

    const tmplOut: { resumo?: string } = {};
    let content: string;
    let modeloUsado: string;
    if (body.useTemplate) {
      content = generateFromTemplate(doc.tipo, company, entity as unknown as Client, fields, body.modeloNumero, tmplOut);
      modeloUsado = `modelo-${body.modeloNumero}`;
    } else {
      content = await generateDocumentWithAI(doc.tipo, company, entity as unknown as Client, fields);
      modeloUsado = process.env.OPENAI_API_KEY ? 'gpt-4o' : 'claude-opus-4-6';
    }

    const updates: Record<string, unknown> = {
      content,
      dados_json: fields,
      cliente_nome: entityNome,
      modelo_usado: modeloUsado,
    };

    // O /p/:id e o PDF leem o Storage PRIMEIRO (arquivo_url) e só caem no content
    // como fallback. Quem tem arquivo salvo precisa do arquivo trocado, senão o link
    // público serviria a versão errada pra sempre. O antigo só sai depois que o novo
    // sobe — se o upload falhar, larga o content (já corrigido) como fonte.
    if (doc.arquivo_url) {
      const fileName = `${req.userId}/${id}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(injectPrint(content), 'utf-8'), {
          contentType: 'text/html; charset=utf-8',
          upsert: false,
        });
      if (uploadError) {
        logger.error('documents', 'regenerate: upload do HTML falhou — caindo pro content', uploadError);
        updates.arquivo_url = null;
      } else {
        updates.arquivo_url = fileName;
      }
      await supabase.storage.from('documentos').remove([doc.arquivo_url]);
    }

    const { error: updErr } = await supabase
      .from('documents').update(updates).eq('id', id).eq('user_id', req.userId);
    if (updErr) {
      logger.error('documents', 'UPDATE documents falhou', updErr);
      res.status(500).json({ error: 'Falha ao atualizar o documento', detail: updErr.message });
      return;
    }

    res.json({
      content,
      modelo_usado: modeloUsado,
      tipo: doc.tipo,
      cliente_nome: entityNome,
      doc_id: doc.id,
      codigo: (dadosAntigos.codigo as string) ?? null,
      codigo_curto: doc.codigo_curto ?? null,
      empresa_slug: company.slug ?? null,
      resumo_whatsapp: tmplOut.resumo ?? null,
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    logger.error('documents', 'regenerateDocument falhou', err);
    res.status(500).json({ error: 'Erro ao atualizar documento' });
  }
}

// Atribui numero_seq ao user se ainda não tem (lazy, no 1º código gerado)
async function ensureUserNumeroSeq(userId: string): Promise<number> {
  const { data: u } = await supabase
    .from('users')
    .select('numero_seq')
    .eq('id', userId)
    .single();
  if (u?.numero_seq && Number(u.numero_seq) > 0) return Number(u.numero_seq);

  // Pega o maior numero_seq atual e incrementa. Pra ambiente single-tenant
  // (1 deploy, 1 banco) é seguro. Em multi-tenant com escala, usar SEQUENCE.
  const { data: max } = await supabase
    .from('users')
    .select('numero_seq')
    .not('numero_seq', 'is', null)
    .order('numero_seq', { ascending: false })
    .limit(1)
    .maybeSingle();

  const next = (Number(max?.numero_seq) || 0) + 1;
  await supabase.from('users').update({ numero_seq: next }).eq('id', userId);
  return next;
}

// Gera código YYYYUUUUNNNN
async function generateCodigoProposta(userId: string): Promise<string> {
  const numeroSeq = await ensureUserNumeroSeq(userId);
  const ano = new Date().getFullYear();
  const inicioAno = `${ano}-01-01`;

  // Conta propostaSolar do user no ano corrente
  const { count } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('tipo', 'propostaSolar')
    .gte('created_at', inicioAno);

  const propostaNum = (count || 0) + 1;
  const pad4 = (n: number) => String(n).padStart(4, '0');
  return `${ano}${pad4(numeroSeq)}${pad4(propostaNum)}`;
}

// Deriva slug do nome da empresa: lowercase + sem acentos + alnum.
// Ex: "Irmãos na Obra" → "irmaosnaobra"
function slugifyEmpresa(nome: string): string {
  return String(nome || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 30);
}

// Garante que a empresa tenha slug + gera codigo_curto YYYYNNNN escopo empresa-ano.
// Slug atribuído lazy (1ª proposta gerada). Colisão = sufixo numérico.
async function ensureEmpresaSlugAndCodigoCurto(
  userId: string,
  companyId: string,
): Promise<{ slug: string; codigoCurto: string }> {
  const { data: comp } = await supabase
    .from('company')
    .select('id, nome, slug')
    .eq('id', companyId)
    .single();

  if (!comp) throw new Error('company não encontrada');

  let slug = comp.slug as string | null;
  if (!slug) {
    const base = slugifyEmpresa(comp.nome) || 'empresa';
    // Tenta base, base2, base3... até achar livre
    slug = base;
    for (let n = 2; n <= 50; n++) {
      const { data: dup } = await supabase
        .from('company')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (!dup) break;
      slug = `${base}${n}`;
    }
    await supabase.from('company').update({ slug }).eq('id', companyId);
  }

  const ano = new Date().getFullYear();

  // Sequência derivada de MAX(sufixo)+1, NÃO de COUNT+1.
  // COUNT+1 desincroniza pra sempre se qualquer proposta for apagada (ex: cleanup
  // cron de docs PRO >30d): o count encolhe mas os codigo_curto já usados não voltam,
  // então "próximo" cai numa faixa já ocupada e colide no unique (user_id, codigo_curto)
  // — era exatamente o "Falha ao salvar documento". MAX+1 sempre aponta pra um livre.
  const codigoCurto = await nextCodigoCurto(userId, ano);
  return { slug, codigoCurto };
}

// Próximo codigo_curto livre do user no ano: MAX(sufixo)+1.
// codigo_curto é text de largura fixa (YYYY + 4 dígitos), então order desc lexical
// == numérico pro mesmo prefixo de ano. Ano novo (0 linhas) → seq 1.
async function nextCodigoCurto(userId: string, ano: number): Promise<string> {
  const prefixo = String(ano);
  const { data: maxRow } = await supabase
    .from('documents')
    .select('codigo_curto')
    .eq('user_id', userId)
    .like('codigo_curto', `${prefixo}%`)
    .order('codigo_curto', { ascending: false })
    .limit(1)
    .maybeSingle();

  const atual = maxRow?.codigo_curto ? Number(String(maxRow.codigo_curto).slice(-4)) : 0;
  const seq = (Number.isFinite(atual) ? atual : 0) + 1;
  return `${prefixo}${String(seq).padStart(4, '0')}`;
}

export async function saveDocument(req: Request, res: Response): Promise<void> {
  try {
    const body = saveSchema.parse(req.body);

    // Upload HTML to Supabase Storage if provided
    let arquivo_url: string | null = null;
    const htmlContent = typeof req.body.html_content === 'string' ? req.body.html_content : undefined;
    if (htmlContent) {
      const fileName = `${req.userId}/${body.tipo}-${body.cliente_nome?.replace(/\s+/g, '-').toLowerCase() ?? 'doc'}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(injectPrint(htmlContent), 'utf-8'), { contentType: 'text/html; charset=utf-8', upsert: false });

      if (!uploadError) {
        arquivo_url = fileName;
      }
    }

    const { data, error } = await supabase
      .from('documents')
      .insert({
        user_id: req.userId,
        tipo: body.tipo,
        cliente_id: body.cliente_id || null,
        terceiro_id: body.terceiro_id || null,
        cliente_nome: body.cliente_nome || null,
        dados_json: body.dados_json || null,
        content: body.content,
        modelo_usado: body.modelo_usado || null,
        arquivo_url,
        status: 'saved',
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ document: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    logger.error('documents', 'saveDocument falhou', err);
    res.status(500).json({ error: 'Erro ao salvar documento' });
  }
}

export async function updateDocumentFile(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const htmlContent = req.body.html_content as string | undefined;
    const newContent  = req.body.content    as string | undefined;

    // Verify ownership
    const { data: doc } = await supabase
      .from('documents')
      .select('id, user_id, arquivo_url')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!doc) { res.status(404).json({ error: 'Documento não encontrado' }); return; }

    const updates: Record<string, unknown> = {};
    if (newContent) updates.content = newContent;

    if (htmlContent) {
      // Remove old file if exists
      if (doc.arquivo_url) {
        await supabase.storage.from('documentos').remove([doc.arquivo_url]);
      }
      const fileName = `${req.userId}/${id}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(injectPrint(htmlContent), 'utf-8'), { contentType: 'text/html; charset=utf-8', upsert: false });
      if (!uploadError) updates.arquivo_url = fileName;
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('documents').update(updates).eq('id', id);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('updateDocumentFile error:', err);
    res.status(500).json({ error: 'Erro ao atualizar documento' });
  }
}

export async function renderDocumentHtml(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { data: doc } = await supabase
      .from('documents')
      .select('arquivo_url')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!doc?.arquivo_url) {
      res.status(404).type('text/html').send('<h1>Documento não disponível</h1><p>Tente novamente em alguns segundos.</p>');
      return;
    }

    const { data: signed } = await supabase.storage
      .from('documentos')
      .createSignedUrl(doc.arquivo_url, 60);

    if (!signed?.signedUrl) {
      res.status(500).type('text/html').send('<h1>Erro ao gerar URL do documento</h1>');
      return;
    }

    // Buscamos o HTML do Storage e devolvemos com Content-Type correto.
    // Storage do Supabase às vezes serve com text/plain — iOS então mostra
    // o código fonte em vez de renderizar.
    const storageRes = await fetch(signed.signedUrl);
    const html = await storageRes.text();

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(html);
  } catch (err) {
    logger.error('documents', 'renderDocumentHtml falhou', err);
    res.status(500).type('text/html').send('<h1>Erro ao buscar documento</h1>');
  }
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('plano, is_admin')
      .eq('id', req.userId)
      .single();

    if (!user) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }

    const isVip = user.is_admin || user.plano === 'ilimitado';

    // Iniciante e free (não-admin): sem histórico completo
    if (!isVip && (user.plano === 'free' || user.plano === 'iniciante')) {
      res.json({ documents: [], plano: user.plano, historico: false });
      return;
    }

    const tipo = req.query.tipo as string | undefined;
    let query = supabase
      .from('documents')
      .select('id, tipo, cliente_nome, modelo_usado, arquivo_url, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false });

    if (tipo) query = query.eq('tipo', tipo);

    // PRO: últimos 30 dias (VIP e admin: tudo, sem cleanup)
    if (!isVip && user.plano === 'pro') {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', cutoff);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Gerar signed URLs para download
    const docs = await Promise.all((data ?? []).map(async (doc) => {
      let signed_url: string | null = null;
      if (doc.arquivo_url) {
        const { data: signed } = await supabase.storage
          .from('documentos')
          .createSignedUrl(doc.arquivo_url, 3600);
        signed_url = signed?.signedUrl ?? null;
      }
      return { ...doc, signed_url };
    }));

    res.json({ documents: docs, plano: user.plano, historico: true });
  } catch (err) {
    logger.error('documents', 'listDocuments falhou', err);
    res.status(500).json({ error: 'Erro ao listar documentos' });
  }
}

// ── Auto-preenchimento da proposta ────────────────────────────────────────────
// Reaproveita o histórico já salvo (documents.dados_json). Devolve:
//  - kit: campos NÃO específicos do cliente (marcas, garantias, taxas, paleta) da
//    proposta mais recente do usuário → pré-preenche todo doc novo (kit do vendedor).
//  - clientes: nomes recentes com histórico de proposta (pro seletor).
//  - cliente: a proposta mais recente de um cliente (por nome) → tudo dele volta.
const CLIENTE_ONLY = new Set<string>([
  'cliente_nome', 'codigo', 'cidade', 'uf', 'endereco', 'consumo_kwh', 'qtd_modulos',
  'geracao_media_kwh', 'geracao_media', 'hsp', 'tarifa_kwh', 'investimento', 'preco_avista',
  'entrada_valor', 'entrada_modo', 'entrada_dias', 'pag_custom', 'tipo_telhado',
  'bateria_capacidade_kwh', 'bateria_potencia_kw', 'bateria_ciclos', 'bateria_marca', 'bateria_garantia', 'bateria_tem',
]);
const STRIP_ALWAYS = new Set<string>(['foto_telhado_b64', 'foto_logo_b64']);

function limpaDados(d: Record<string, unknown>, soKit: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (STRIP_ALWAYS.has(k)) continue;
    if (soKit && CLIENTE_ONLY.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function propostaPrefill(req: Request, res: Response): Promise<void> {
  const nome = String(req.query.cliente_nome || '').trim();
  const { data, error } = await supabase
    .from('documents')
    .select('cliente_nome, dados_json, created_at')
    .eq('user_id', req.userId)
    .eq('tipo', 'propostaSolar')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    logger.error('documents', 'prefill falhou', error);
    res.status(500).json({ error: 'Não consegui carregar o histórico.' });
    return;
  }
  const docs = (data ?? []) as { cliente_nome: string | null; dados_json: Record<string, unknown> | null; created_at: string }[];

  const kit = docs.length && docs[0].dados_json ? limpaDados(docs[0].dados_json, true) : {};

  const vistos = new Set<string>();
  const clientes: string[] = [];
  for (const d of docs) {
    const n = (d.cliente_nome || '').trim();
    if (n && !vistos.has(n.toLowerCase())) { vistos.add(n.toLowerCase()); clientes.push(n); }
  }

  let cliente: Record<string, unknown> | null = null;
  if (nome) {
    const hit = docs.find((d) => (d.cliente_nome || '').trim().toLowerCase() === nome.toLowerCase());
    if (hit?.dados_json) cliente = limpaDados(hit.dados_json, false);
  }

  res.json({ kit, clientes: clientes.slice(0, 50), cliente });
}

export async function cleanupProDocuments(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: proUsers } = await supabase.from('users').select('id').eq('plano', 'pro');
  const proIds = (proUsers ?? []).map(u => u.id);
  if (!proIds.length) return;

  const { data: oldDocs } = await supabase
    .from('documents')
    .select('id, arquivo_url, user_id')
    .lt('created_at', cutoff)
    .in('user_id', proIds);

  if (!oldDocs?.length) return;

  // Deletar arquivos do Storage
  const paths = oldDocs.filter(d => d.arquivo_url).map(d => d.arquivo_url as string);
  if (paths.length) await supabase.storage.from('documentos').remove(paths);

  // Deletar registros do banco
  const ids = oldDocs.map(d => d.id);
  await supabase.from('documents').delete().in('id', ids);

  logger.info('documents', `cleanup: ${ids.length} docs PRO removidos`);
}
