import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { ApiError } from '../utils/apiError';
import { generateDocumentWithAI } from '../services/aiService';
import { generateFromTemplate, propostaDiasValidade, type Client } from '../services/templateService';
import { checkLimit, incrementUsed } from '../services/planService';
import { acessoOffGrid } from '../services/offgrid/acesso';
import { injectPrint } from '../utils/printHtml';
import { examinarRevisao, ehDesenhado } from '../services/documentos/saudeDocumento';
import { logger } from '../utils/logger';
import { chaveCliente } from '../utils/chaveCliente';
import { tabelaAusente } from '../services/manutencao/armazenamento';

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
// propostaOffGrid entra aqui pelo mesmo motivo da propostaSolar: o integrador
// orça na frente do cliente, antes de existir cadastro.
const TIPOS_MODO_RAPIDO = ['vistoria', 'propostaSolar', 'propostaOffGrid'];

// Reemissão de um doc que já existe (botão "Editar proposta"). Mesmo formato do
// generate menos o tipo/cliente — esses vêm da linha salva, não do cliente HTTP.
const regenerateSchema = z.object({
  fields: z.record(z.string(), z.unknown()),
  useTemplate: z.boolean().optional().default(true),
  modeloNumero: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(1),
  cliente_nome_avulso: z.string().min(2).optional(),
  // Só vale para quem pode trocar de cliente (ilimitado e admin). Plano com limite que
  // mande um id diferente do salvo recebe 409: editar não gasta cota, então não pode
  // virar documento novo para outro cliente.
  cliente_id: z.string().uuid().optional(),
  terceiro_id: z.string().uuid().optional(),
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

// Prestação de serviço: a entidade do documento é o terceiro (CONTRATADA) e o cliente
// final entra nos campos. Fica numa função só porque o generate e o regenerate
// precisam do MESMO resultado: até 28/10/2026 o regenerate recusava esse tipo porque
// reemitir sem repetir a injeção sairia com o contrato pela metade.
// Cliente que não existe mais (apagado do cadastro) devolve os campos como vieram: o
// dados_json salvo já traz os cliente_final_* da emissão anterior.
async function injetarClienteFinal(
  userId: string | undefined,
  clienteId: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data: clienteFinal } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clienteId)
    .eq('user_id', userId)
    .single();
  if (!clienteFinal) return fields;
  return {
    ...fields,
    cliente_final_nome: clienteFinal.nome,
    cliente_final_telefone: (fields.telefone_cliente as string) || '',
    cliente_final_endereco_instalacao: (fields.endereco_instalacao as string) || clienteFinal.endereco || '',
    cliente_final_tipo_telhado: clienteFinal.tipo_telhado || '',
    cliente_final_padrao: clienteFinal.padrao || '',
  };
}

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
      // A proposta off-grid não é degrau de plano: é add-on comprado à parte.
      // Quem pagou por ela gera, seja free ou assinante — cobrar duas vezes pela
      // mesma coisa é o jeito mais rápido de virar reembolso.
      const liberadoPorAddon = body.tipo === 'propostaOffGrid'
        && (await acessoOffGrid(req.userId)).liberado;
      if (!liberadoPorAddon) {
        throw new ApiError(402, body.tipo === 'propostaOffGrid'
          ? 'A proposta off-grid faz parte do acesso ao Kit Off-Grid.'
          : 'Faça upgrade pra gerar esse tipo de documento. O plano gratuito libera só o Gerador de Proposta.');
      }
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
      body.fields = await injetarClienteFinal(req.userId, body.cliente_id, body.fields);
    }

    let content: string;
    let modeloUsado: string;

    // emitido_em só existe pra congelar a data de uma reemissão (ver regenerate).
    // Doc novo nasce hoje — e o prefill do kit/cliente pode arrastar o campo antigo.
    delete body.fields.emitido_em;

    await checkLimit(req.userId);

    // Número da proposta: o MESMO do link público (codigo_curto, YYYYNNNN por
    // integrador e ano), reservado ANTES do template pra sair impresso no cabeçalho.
    // Até 14/09/2026 o cabeçalho imprimia um código de 12 dígitos montado sobre
    // users.numero_seq, coluna que nunca foi criada. O erro era engolido e o
    // "número do integrador" saía 0001 pra todo mundo: 202600010001 estava impresso
    // em 94 propostas de 90 empresas diferentes. O codigo_curto é único por
    // integrador (índice no banco) e é o que abre o link, então um número só serve.
    let codigo: string | null = null;
    let codigoCurto: string | null = null;
    let empresaSlug: string | null = null;
    if ((body.tipo === 'propostaSolar' || body.tipo === 'propostaOffGrid') && req.userId) {
      try {
        const slugAndCurto = await ensureEmpresaSlugAndCodigoCurto(req.userId, company.id);
        empresaSlug = slugAndCurto.slug;
        codigoCurto = slugAndCurto.codigoCurto;
      } catch (err) {
        logger.error('documents', 'falha gerando slug/codigo_curto, proposta sai sem número', err);
      }
      // O template off-grid não imprime número; só a propostaSolar leva o campo.
      if (body.tipo === 'propostaSolar') {
        if (codigoCurto) {
          codigo = codigoCurto;
          body.fields = { ...body.fields, codigo };
        } else {
          // O prefill por cliente devolve o dados_json da proposta anterior, com o
          // número dela. Sem número novo o campo sai: sem número é melhor que com
          // o número de outra proposta.
          delete body.fields.codigo;
        }
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
        .upload(fileName, Buffer.from(content, 'utf-8'), {
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

    // Retry em colisao de codigo_curto. O número vem do contador do banco
    // (reservar_codigo_curto), então colisão só acontece com uma instância antiga que
    // ainda grave por MAX+1 durante o deploy. A unique parcial (user_id, codigo_curto)
    // WHERE NOT NULL bloqueia a 2ª, e o laço reserva o próximo número no contador.
    let saved: { id: string } | null = null;
    let insertErr: { code?: string; message?: string } | null = null;

    // O número impresso no cabeçalho é o próprio codigo_curto. Se ele muda no retry
    // (ou sai na blindagem), o HTML é refeito: senão a proposta sairia impressa com
    // o número que colidiu, que é o de OUTRA proposta do mesmo integrador.
    let conteudoMudou = false;
    const reimprimirNumero = (novo: string | null) => {
      if (body.tipo !== 'propostaSolar' || !codigo) return;
      codigo = novo;
      if (novo) body.fields = { ...body.fields, codigo: novo };
      else delete body.fields.codigo;
      insertPayload.dados_json = body.fields;
      if (body.useTemplate) {
        content = generateFromTemplate(body.tipo, company, entity as unknown as Client, body.fields, body.modeloNumero, tmplOut);
        insertPayload.content = content;
        conteudoMudou = true;
      }
    };

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
      // Com o contador, colisão só vem de uma instância antiga (MAX+1) durante o
      // deploy. Reserva o PRÓXIMO número no contador, que já passou desse; somar 1
      // aqui criaria um número que o contador ainda vai emitir. Se a reserva falhar,
      // sai do laço e a blindagem abaixo salva sem número.
      try {
        codigoCurto = await nextCodigoCurto(req.userId, new Date().getFullYear());
      } catch (err) {
        logger.error('documents', 'colisao em codigo_curto e a nova reserva falhou', err);
        break;
      }
      insertPayload.codigo_curto = codigoCurto;
      reimprimirNumero(codigoCurto);
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
      // Sem número salvo, sem número impresso: o último tentado pertence a outra proposta.
      reimprimirNumero(null);
      const fallback = await supabase.from('documents').insert(insertPayload).select('id').single();
      if (!fallback.error) {
        saved = fallback.data;
        insertErr = null;
      } else {
        insertErr = fallback.error;
      }
    }

    // O HTML do Storage subiu antes do insert, com o número da primeira tentativa.
    // Se o número mudou, sobe de novo por cima: o /p/ e o PDF leem o arquivo.
    if (saved && conteudoMudou && arquivo_url) {
      const { error: reenvioErr } = await supabase.storage
        .from('documentos')
        .upload(arquivo_url, Buffer.from(content, 'utf-8'), {
          contentType: 'text/html; charset=utf-8',
          upsert: true,
        });
      if (reenvioErr) {
        // Sem o reenvio, o arquivo guardado mostra o número que colidiu, e o /p/ e o PDF
        // leem o arquivo ANTES do content. Solta o arquivo: os leitores caem no content,
        // que já tem o número certo (mesma saída do regenerate).
        logger.error('documents', 'reenvio do HTML com o número novo falhou, doc passa a servir o content', reenvioErr);
        const { error: soltarErr } = await supabase.from('documents').update({ arquivo_url: null }).eq('id', saved.id);
        if (soltarErr) logger.error('documents', 'soltar arquivo_url do doc com número trocado falhou', soltarErr);
        else await supabase.storage.from('documentos').remove([arquivo_url]).catch(() => undefined);
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


// POST /documents/:id/regenerate — reemite um documento que JÁ existe com os campos
// corrigidos ("achei um erro na proposta pronta"). Mantém id, codigo e codigo_curto:
// o link /p/{slug}.{codigo} e o PDF continuam os mesmos, porque o consultor pode já
// ter mandado o link antes de ver o erro. E não consome cota do plano — corrigir um
// typo não é emitir documento novo.
export async function regenerateDocument(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const body = regenerateSchema.parse(req.body);

    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, tipo, cliente_id, terceiro_id, cliente_nome, arquivo_url, dados_json, codigo_curto, created_at')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    // Falha do banco não é "documento excluído": o front sai do modo edição em 404, e a
    // pessoa geraria um documento duplicado, gastando cota. Só ausência de linha vira 404.
    if (docErr && !ausenciaDeLinha(docErr)) {
      logger.error('documents', 'regenerate: leitura do documento falhou', docErr);
      res.status(503).json({ error: MSG_ABRIR_FALHA });
      return;
    }
    if (!doc) throw new ApiError(404, 'Documento não encontrado');

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
    const offgridLiberado = doc.tipo === 'propostaOffGrid'
      && (await acessoOffGrid(req.userId)).liberado;
    if (planUser && !planUser.is_admin && planUser.plano === 'free' && doc.tipo !== 'propostaSolar' && !offgridLiberado) {
      throw new ApiError(402, 'Faça upgrade pra editar esse tipo de documento. O plano gratuito libera só o Gerador de Proposta.');
    }

    // TRAVA DE COTA. Editar não gasta cota, então editar não pode virar documento novo
    // para outro cliente. Plano com limite (tudo que não é ilimitado nem admin, e
    // usuário que não se leu) não troca o cliente: nem o id, nem o nome do avulso.
    // Ilimitado e admin trocam, porque pra eles não existe cota a proteger.
    // No avulso compara o nome digitado. Com cadastro, compara o id e TAMBÉM o nome
    // atual da linha do cliente contra o nome salvo no documento: renomear o cliente
    // no cadastro e reeditar o documento antigo viraria documento novo sem cota (409).
    const podeTrocarCliente = !!planUser && (planUser.is_admin === true || planUser.plano === 'ilimitado');
    const clienteIdFinal = body.cliente_id ?? doc.cliente_id ?? null;
    const terceiroIdFinal = body.terceiro_id ?? doc.terceiro_id ?? null;
    const trocouId = clienteIdFinal !== (doc.cliente_id ?? null) || terceiroIdFinal !== (doc.terceiro_id ?? null);
    const ehAvulso = !clienteIdFinal && !terceiroIdFinal;
    const trocouNomeAvulso = ehAvulso
      && chaveCliente(body.cliente_nome_avulso ?? doc.cliente_nome) !== chaveCliente(doc.cliente_nome);
    if (!podeTrocarCliente && (trocouId || trocouNomeAvulso)) {
      res.status(409).json({ error: 'cliente_diferente', message: 'Para outro cliente, gere um documento novo.' });
      return;
    }

    // A entidade vem da linha salva. Só o avulso (proposta/vistoria sem cadastro)
    // aceita nome novo — é lá que mora o typo no nome do cliente.
    let entity: Record<string, unknown>;
    let entityNome: string;

    if (terceiroIdFinal) {
      const { data: terceiro } = await supabase
        .from('terceiros').select('*').eq('id', terceiroIdFinal).eq('user_id', req.userId).single();
      if (!terceiro) throw new ApiError(404, 'Terceiro não encontrado');
      entity = terceiro;
      entityNome = terceiro.nome;
    } else if (clienteIdFinal) {
      const { data: client } = await supabase
        .from('clients').select('*').eq('id', clienteIdFinal).eq('user_id', req.userId).single();
      if (!client) throw new ApiError(404, 'Cliente não encontrado');
      entity = client;
      entityNome = client.nome;
    } else {
      entityNome = (body.cliente_nome_avulso || doc.cliente_nome || '').trim();
      if (!entityNome) throw new ApiError(400, 'Informe o nome do cliente');
      entity = { nome: entityNome };
    }

    // Cliente renomeado no cadastro depois da emissão: em plano com limite a reedição não pode
    // gravar o nome novo por cima (viraria documento novo de graça). Para o nome novo, documento novo.
    if (!podeTrocarCliente && !ehAvulso && chaveCliente(doc.cliente_nome) && chaveCliente(entityNome) !== chaveCliente(doc.cliente_nome)) {
      res.status(409).json({ error: 'cliente_diferente', message: 'Este cliente mudou de nome no cadastro. Para o novo nome, gere um documento novo.' });
      return;
    }

    // O número da proposta vive no dados_json (o generate injeta antes do template).
    // Reeditar não renumera: o cabeçalho e o link precisam bater com o que já foi enviado.
    const dadosAntigos = (doc.dados_json ?? {}) as Record<string, unknown>;
    let fields: Record<string, unknown> = { ...body.fields };
    // Número e data de emissão são coisa de proposta. Os outros tipos (contrato,
    // procuração, recibo...) guardam o dados_json exatamente como o formulário mandou.
    const ehProposta = doc.tipo === 'propostaSolar' || doc.tipo === 'propostaOffGrid';
    // O número impresso é o SALVO, nunca o que vem do formulário. O estado do front
    // carrega o número de outra proposta (prefill por cliente, doc aberto do
    // histórico, rascunho), e com `!fields.codigo` reeditar imprimia esse número no
    // cabeçalho de um doc cujo link tem outro número.
    if (ehProposta) {
      delete fields.codigo;
      if (dadosAntigos.codigo) fields.codigo = dadosAntigos.codigo;
    }
    // O nome impresso é o da entidade resolvida acima, nunca o que o formulário
    // carrega em fields: senão o campo seria um jeito de contornar a trava de cota.
    if ('cliente_nome' in fields) fields.cliente_nome = entityNome;
    // Prestação de serviço: o cliente final entra nos campos, como na emissão. Em plano com
    // limite valem SÓ os cliente_final_* do dados_json salvo (nome, telefone, endereço...): nem o
    // corpo nem a linha atual do cadastro entram. Documento antigo sem eles cai na injeção normal.
    // Ilimitado e admin refazem a injeção com o corpo e o cadastro.
    if (doc.tipo === 'prestacaoServico') {
      const salvos = Object.entries(dadosAntigos).filter(([k]) => k.startsWith('cliente_final_'));
      if (!podeTrocarCliente && salvos.length > 0) {
        for (const k of Object.keys(fields)) if (k.startsWith('cliente_final_')) delete fields[k];
        for (const [k, v] of salvos) fields[k] = v;
      } else if (clienteIdFinal) {
        fields = await injetarClienteFinal(req.userId, clienteIdFinal, fields);
      }
    }
    // Proposta de banco: o CPF/CNPJ do formulário ganha do cadastro na hora de imprimir
    // (templateService). Em plano com limite vale o que estava salvo, senão trocar o CPF
    // seria um jeito de emitir a proposta de outro comprador sem gastar cota.
    if (doc.tipo === 'propostaBanco' && !podeTrocarCliente) {
      if ('cpf_cnpj' in dadosAntigos) fields.cpf_cnpj = dadosAntigos.cpf_cnpj;
      else delete fields.cpf_cnpj;
    }
    // Reedição de contrato, procuração, recibo etc. reimprime a data da emissão. O
    // created_at de documents vem 3h adiantado (conhecido), por isso o -3h. A proposta
    // segue a regra do emitido_em acima e não usa isto.
    let dataBaseReedicao: Date | undefined;
    if (!ehProposta) {
      const d = new Date(new Date(doc.created_at).getTime() - 3 * 3600000);
      if (!Number.isNaN(d.getTime())) dataBaseReedicao = d;
    }

    // Corrigir uma proposta de dias atrás não pode renovar o prazo dela sozinho: o
    // cabeçalho e a validade ficam ancorados no dia da emissão (o cliente já viu
    // aquela data). Exceção: se a validade JÁ venceu, a reedição vale como reemissão
    // e tudo volta a contar de hoje — melhor que entregar proposta nascendo vencida.
    const emitidoEm = new Date(doc.created_at);
    const venceEm = emitidoEm.getTime() + propostaDiasValidade(fields) * 86400000;
    if (ehProposta && !Number.isNaN(emitidoEm.getTime()) && venceEm > Date.now()) {
      fields.emitido_em = doc.created_at;
    } else {
      // O front devolve o dados_json inteiro, então o emitido_em antigo pode vir
      // junto — tem que sair, senão a proposta vencida congela na data velha.
      delete fields.emitido_em;
    }

    const tmplOut: { resumo?: string } = {};
    let content: string;
    let modeloUsado: string;
    if (body.useTemplate) {
      content = generateFromTemplate(doc.tipo, company, entity as unknown as Client, fields, body.modeloNumero, tmplOut, dataBaseReedicao);
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
    // Só chega aqui com id diferente quem pode trocar de cliente (ver a trava acima).
    if (trocouId) {
      updates.cliente_id = clienteIdFinal;
      updates.terceiro_id = terceiroIdFinal;
    }

    // O /p/:id e o PDF leem o Storage PRIMEIRO (arquivo_url) e só caem no content
    // como fallback. Quem tem arquivo salvo precisa do arquivo trocado, senão o link
    // público serviria a versão errada pra sempre. O antigo só sai depois que o novo
    // sobe — se o upload falhar, larga o content (já corrigido) como fonte.
    if (doc.arquivo_url) {
      const fileName = `${req.userId}/${id}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(content, 'utf-8'), {
          contentType: 'text/html; charset=utf-8',
          upsert: false,
        });
      if (uploadError) {
        logger.error('documents', 'regenerate: upload do HTML falhou — caindo pro content', uploadError);
        updates.arquivo_url = null;
      } else {
        updates.arquivo_url = fileName;
      }
    }
    // Arquivo que acabou de subir para esta edição (null se não subiu nada).
    const arquivoNovo = typeof updates.arquivo_url === 'string' ? updates.arquivo_url : null;

    // .select('id') faz o update dizer quantas linhas acertou: a linha pode ter sido
    // excluída (outra aba) entre a conferência do começo e agora, e update em zero
    // linhas não dá erro nenhum.
    const { data: atualizadas, error: updErr } = await supabase
      .from('documents').update(updates).eq('id', id).eq('user_id', req.userId).select('id');
    if (updErr) {
      logger.error('documents', 'UPDATE documents falhou', updErr);
      // A linha continua apontando para o arquivo antigo, que fica. O novo é que sobra.
      if (arquivoNovo) await removerArquivoSilencioso(arquivoNovo, 'regenerate: update falhou');
      res.status(500).json({ error: 'Falha ao atualizar o documento', detail: updErr.message });
      return;
    }
    if (!atualizadas || atualizadas.length === 0) {
      if (arquivoNovo) await removerArquivoSilencioso(arquivoNovo, 'regenerate: documento excluído no meio');
      res.status(404).json({ error: 'Esse arquivo foi excluído.' });
      return;
    }
    // O antigo só sai depois que a linha já aponta para o novo (ou para o content).
    if (doc.arquivo_url) await removerArquivoAntigo(req.userId, doc.arquivo_url, 'regenerate');

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

/** Texto visível de um HTML: sem head/title/style/script, sem tags e com as entidades comuns decodificadas. */
export function htmlParaTexto(html: string): string {
  return String(html)
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(title|style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    // tag de texto corrido não separa palavra (Jo<b>ão</b>); as demais separam
    .replace(/<\/?(?:b|i|u|em|strong|span|font|a|mark|small|sup|sub)\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)));
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
): Promise<{ slug: string; codigoCurto: string | null }> {
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

  // Número reservado no contador do banco (ver nextCodigoCurto). Antes foi COUNT+1,
  // que colidia depois que o cleanup dos docs PRO apagava propostas, e depois MAX+1,
  // que voltava a um número já emitido quando o cleanup apagava a linha do maior.
  // Falhar a numeração não leva o slug junto: sem número o link cai no UUID, mas o
  // slug da empresa continua valendo.
  let codigoCurto: string | null = null;
  try {
    codigoCurto = await nextCodigoCurto(userId, ano);
  } catch (err) {
    logger.error('documents', 'numeração da proposta falhou, proposta sai sem número', err);
  }
  return { slug, codigoCurto };
}

// Próximo codigo_curto do user no ano, RESERVADO no banco (função reservar_codigo_curto,
// ver MIGRATION_reservar_codigo_curto.sql).
// Era MAX(sufixo)+1 sobre as linhas que ainda existem, e a limpeza diária dos docs PRO
// apaga as mais velhas: quando some a linha do maior número, a sequência volta a um
// número já impresso e mandado a outro cliente, e o link antigo /p/slug.numero passa a
// abrir a proposta nova. O contador fica numa tabela própria e nunca volta; no primeiro
// uso ele parte do maior número que ainda existe.
async function nextCodigoCurto(userId: string, ano: number): Promise<string> {
  const { data, error } = await supabase.rpc('reservar_codigo_curto', { p_user_id: userId, p_ano: ano });
  // Falha NÃO é "começa do 1": em 12/09/2026 um 504 no MAX fez a numeração recomeçar
  // em 0001 pra quem estava no 0018. Sem número reservado, a proposta sai sem número.
  if (error || typeof data !== 'string' || !/^\d{8}$/.test(data)) {
    throw new Error(`reservar_codigo_curto falhou: ${error?.message ?? String(data)}`);
  }
  return data;
}

// GET /documents/:id/edit — devolve um doc salvo no formato que o formulário
// precisa pra reabrir a edição (botão "Editar" do /histórico). O content vem junto
// pro "Voltar sem alterar" mostrar a proposta como ela está hoje.
export async function getDocumentForEdit(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const { data: doc, error: docErr } = await supabase
      .from('documents')
      .select('id, tipo, cliente_id, terceiro_id, cliente_nome, dados_json, modelo_usado, content, codigo_curto, created_at')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    // Só ausência de linha é 404: o front trata 404 como "excluído". Falha do banco é 503.
    if (docErr && !ausenciaDeLinha(docErr)) {
      logger.error('documents', 'edit: leitura do documento falhou', docErr);
      res.status(503).json({ error: MSG_ABRIR_FALHA });
      return;
    }
    if (!doc) { res.status(404).json({ error: 'Documento não encontrado' }); return; }

    const { data: company } = await supabase
      .from('company').select('slug').eq('user_id', req.userId).single();
    // A tela trava o campo de cliente para plano com limite. A trava de verdade é a
    // do regenerate (409); isto só deixa a tela dizer a mesma coisa antes do clique.
    const { data: dono } = await supabase
      .from('users').select('plano, is_admin').eq('id', req.userId).single();

    const dados = (doc.dados_json ?? {}) as Record<string, unknown>;
    res.json({
      document: {
        doc_id: doc.id,
        tipo: doc.tipo,
        cliente_id: doc.cliente_id ?? null,
        terceiro_id: doc.terceiro_id ?? null,
        cliente_nome: doc.cliente_nome,
        pode_trocar_cliente: !!dono && (dono.is_admin === true || dono.plano === 'ilimitado'),
        dados_json: dados,
        // 'modelo-2' → 2. Sem isso a reedição cairia sempre no modelo padrão e
        // trocaria o layout da proposta que o cliente já tinha aberto. O 3 (Moderno
        // com capa) entrou em 24/08/2026 e precisou entrar aqui junto: preso em
        // "=== 2 ? 2 : 1", reabrir uma proposta com capa devolvia o modelo 1.
        modelo_numero: [2, 3].includes(Number(String(doc.modelo_usado || '').replace(/\D/g, '')))
          ? (Number(String(doc.modelo_usado || '').replace(/\D/g, '')) as 2 | 3)
          : 1,
        content: doc.content ?? '',
        codigo: (dados.codigo as string) ?? null,
        codigo_curto: doc.codigo_curto ?? null,
        empresa_slug: company?.slug ?? null,
        created_at: doc.created_at,
      },
    });
  } catch (err) {
    logger.error('documents', 'getDocumentForEdit falhou', err);
    res.status(500).json({ error: 'Erro ao carregar documento' });
  }
}

export async function saveDocument(req: Request, res: Response): Promise<void> {
  try {
    const body = saveSchema.parse(req.body);

    // Salvar um documento pronto é emitir documento: gasta cota como o generate. Até
    // 28/10/2026 esta rota gravava sem checar nem contar, e dava para emitir sem limite.
    await checkLimit(req.userId);

    // Upload HTML to Supabase Storage if provided
    let arquivo_url: string | null = null;
    const htmlContent = typeof req.body.html_content === 'string' ? req.body.html_content : undefined;
    if (htmlContent) {
      const fileName = `${req.userId}/${body.tipo}-${body.cliente_nome?.replace(/\s+/g, '-').toLowerCase() ?? 'doc'}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(htmlContent, 'utf-8'), { contentType: 'text/html; charset=utf-8', upsert: false });

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
    await incrementUsed(req.userId);
    res.status(201).json({ document: data });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.issues[0].message });
      return;
    }
    if (err instanceof ApiError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    logger.error('documents', 'saveDocument falhou', err);
    res.status(500).json({ error: 'Erro ao salvar documento' });
  }
}

// Este endpoint é por onde TODA revisão passa: a que o dashboard arquiva
// sozinho depois de gerar, e a que a pessoa faz no botão Editar. Desde que
// contrato, procuração e proposta de banco viraram documentos desenhados, ele
// deixou de receber texto e passou a receber a folha inteira — e por aqui uma
// revisão infeliz sobrescrevia o documento bom. Ver saudeDocumento.ts: conserta
// o que tem conserto óbvio, recusa o que destruiria a folha, e nunca grava pela
// metade.
export async function updateDocumentFile(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const htmlContent = req.body.html_content as string | undefined;
    const newContent  = req.body.content    as string | undefined;

    // Verify ownership
    const { data: doc } = await supabase
      .from('documents')
      .select('id, user_id, arquivo_url, content, tipo, cliente_nome')
      .eq('id', id)
      .eq('user_id', req.userId)
      .single();

    if (!doc) { res.status(404).json({ error: 'Documento não encontrado' }); return; }

    // A logo em base64 é o que permite desfazer a troca do {{LOGO}}: ela entra
    // na folha só pra desenhar na tela e não pode ficar gravada na coluna.
    const { data: empresa } = await supabase
      .from('company').select('logo_base64').eq('user_id', req.userId).maybeSingle();

    const exame = examinarRevisao({
      content: newContent,
      html: htmlContent,
      eraDesenhado: ehDesenhado(String(doc.content || '')),
      logoBase64: empresa?.logo_base64 ?? null,
    });

    if (exame.problemas.length > 0) {
      // Nada é escrito: o documento que está salvo continua inteiro, e o
      // dashboard mostra o motivo pra pessoa corrigir ou desfazer.
      logger.error('documents', `revisão recusada no doc ${id}: ${exame.problemas.join(' | ')}`);
      // Registro fail-silent: é por ele que a sonda descobre que alguém está
      // tentando editar e não está conseguindo (ver sondaDocumentos.ts).
      try {
        await supabase.from('feature_events').insert({
          user_id: req.userId,
          feature: 'documento',
          event_type: 'revisao_recusada',
          event_data: { doc_id: id, tipo: doc.tipo, problemas: exame.problemas },
        });
      } catch { /* aviso não pode derrubar a resposta */ }
      res.status(422).json({
        error: 'A revisão não foi salva porque quebraria o documento',
        problemas: exame.problemas,
      });
      return;
    }
    if (exame.reparos.length > 0) {
      logger.info('documents', `revisão do doc ${id} salva com reparo: ${exame.reparos.join(' | ')}`);
    }

    // TRAVA DE COTA (mesma do regenerate). Revisar o HTML não gasta cota, então em plano
    // com limite o nome do cliente salvo tem que continuar aparecendo no texto revisado:
    // senão a revisão viraria um documento novo para outra pessoa sem passar pela cota.
    // Comparação exata pela chaveCliente (acento, maiúscula e espaço não contam; letra sim).
    const { data: dono } = await supabase
      .from('users').select('plano, is_admin').eq('id', req.userId).single();
    const comLimite = !(dono && (dono.is_admin === true || dono.plano === 'ilimitado'));
    const chaveSalva = chaveCliente(doc.cliente_nome);
    // O HTML e o content são gravados (o link público lê um, o PDF lê o outro): os dois que vierem
    // precisam trazer o nome. O <head> não conta: o DocumentPreview sempre manda o <title> com o
    // nome salvo, e isso deixaria qualquer corpo passar.
    const revisados = [exame.html, exame.content].filter((t): t is string => !!t);
    if (comLimite && chaveSalva && revisados.some((t) => !chaveCliente(htmlParaTexto(t)).includes(chaveSalva))) {
      res.status(409).json({ error: 'cliente_diferente', message: 'Para outro cliente, gere um documento novo.' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (exame.content) updates.content = exame.content;

    if (exame.html) {
      // SOBE O NOVO ANTES DE APAGAR O VELHO. Na ordem inversa — como era até
      // 17/09/2026 — um upload que falhasse deixava a linha apontando pra um
      // arquivo já removido: o /p/:id e o PDF respondiam "documento não
      // disponível" pra um documento que existe e está pago. Desde 29/10/2026 o
      // velho só sai DEPOIS do update confirmado, pelo mesmo motivo.
      const fileName = `${req.userId}/${id}-${Date.now()}.html`;
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .upload(fileName, Buffer.from(exame.html, 'utf-8'), { contentType: 'text/html; charset=utf-8', upsert: false });

      if (uploadError) {
        // Sem gravar nada: coluna e arquivo têm que contar a MESMA versão.
        logger.error('documents', `upload do arquivo do doc ${id} falhou`, uploadError);
        res.status(503).json({ error: 'Não consegui arquivar o documento agora. Tente de novo em instantes.' });
        return;
      }
      updates.arquivo_url = fileName;
    }
    const arquivoNovo = typeof updates.arquivo_url === 'string' ? updates.arquivo_url : null;

    if (Object.keys(updates).length > 0) {
      const { data: atualizadas, error: updErr } = await supabase
        .from('documents').update(updates).eq('id', id).eq('user_id', req.userId).select('id');
      if (updErr) {
        logger.error('documents', `update do doc ${id} falhou`, updErr);
        // A linha continua no arquivo antigo, que fica. O que sobrou é o novo.
        if (arquivoNovo) await removerArquivoSilencioso(arquivoNovo, 'revisão: update falhou');
        res.status(503).json({ error: 'Não consegui salvar a revisão agora. Tente de novo em instantes.' });
        return;
      }
      if (!atualizadas || atualizadas.length === 0) {
        // Excluído entre a conferência e a gravação: o upload novo ficaria órfão.
        if (arquivoNovo) await removerArquivoSilencioso(arquivoNovo, 'revisão: documento excluído no meio');
        res.status(404).json({ error: 'Esse arquivo foi excluído.' });
        return;
      }
      // O antigo só sai depois que a linha já aponta para o novo.
      if (arquivoNovo && doc.arquivo_url) await removerArquivoAntigo(req.userId, doc.arquivo_url, 'revisão');
    }

    res.json({ ok: true, reparos: exame.reparos });
  } catch (err) {
    logger.error('documents', 'updateDocumentFile falhou', err);
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
    // Este endpoint É o "abrir pra imprimir": o script de impressão entra aqui, na
    // hora de servir. O arquivo guardado fica limpo, senão o /p/:id (que serve o
    // mesmo arquivo) abriria a caixa de impressão na cara do cliente.
    res.send(injectPrint(html));
  } catch (err) {
    logger.error('documents', 'renderDocumentHtml falhou', err);
    res.status(500).type('text/html').send('<h1>Erro ao buscar documento</h1>');
  }
}

// ── Meus documentos (todos os planos) ─────────────────────────────────────────
// Até 28/10/2026 free e iniciante recebiam lista vazia e o pro só via 30 dias (e um
// cron apagava o resto). Ordem do dono: todo documento fica na nuvem, editável, para
// qualquer plano. Sem corte por plano; a lista é paginada e filtrada no servidor.
const COLUNAS_LISTA = 'id, tipo, cliente_id, cliente_nome, codigo_curto, modelo_usado, arquivo_url, created_at';
const COLUNAS_LEVES = 'id, tipo, cliente_id, cliente_nome, codigo_curto, created_at';
const TIPOS_COM_LINK_PUBLICO = ['propostaSolar', 'propostaOffGrid'];
const PAGINA_BANCO = 1000; // o PostgREST corta em 1000 linhas e ignora o .limit()
const TETO_LEITURA = 20000;

type LinhaLeve = {
  id?: string; tipo?: string; cliente_id?: string | null; cliente_nome?: string | null;
  codigo_curto?: string | null; created_at?: string; [k: string]: unknown;
};

/** Lê todas as páginas de 1000 linhas de uma consulta (com teto, para não varrer o banco sem fim). */
async function lerTudo<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>,
): Promise<{ rows: T[]; error: { code?: string; message?: string } | null }> {
  const rows: T[] = [];
  for (let de = 0; de < TETO_LEITURA; de += PAGINA_BANCO) {
    const { data, error } = await pagina(de, de + PAGINA_BANCO - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGINA_BANCO) break;
  }
  return { rows, error: null };
}

function inteiroEntre(v: unknown, padrao: number, min: number, max: number): number {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}

/** Tira o que quebra a sintaxe do .or() do PostgREST (vírgula, parênteses, curingas e aspas). */
function limpaBusca(q: unknown): string {
  return String(q ?? '').replace(/[,()*%"\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function dataLimite(v: unknown, fim: boolean): string | null {
  const t = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return fim ? `${t}T23:59:59.999Z` : `${t}T00:00:00.000Z`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(t) && !Number.isNaN(new Date(t).getTime())) return t;
  return null;
}

/** Documento da pasta: pelo id do cliente, ou sem id e com o mesmo nome (pela chave). */
function pertenceAPasta(d: LinhaLeve, clienteId: string | null, chave: string | null): boolean {
  if (clienteId && d.cliente_id === clienteId) return true;
  if (chave && !d.cliente_id && chaveCliente(d.cliente_nome) === chave) return true;
  return false;
}

export async function listDocuments(req: Request, res: Response): Promise<void> {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('plano, is_admin')
      .eq('id', req.userId)
      .single();

    if (!user) { res.status(404).json({ error: 'Usuário não encontrado' }); return; }

    const tipos = String(req.query.tipo ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12);
    const q = limpaBusca(req.query.q);
    const de = dataLimite(req.query.de, false);
    const ate = dataLimite(req.query.ate, true);
    const clienteIdRaw = String(req.query.cliente_id ?? '').trim();
    const clienteId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clienteIdRaw) ? clienteIdRaw : null;
    const chave = chaveCliente(String(req.query.cliente_chave ?? '')) || null;
    const limit = inteiroEntre(req.query.limit, 50, 1, 100);
    const pageBruto = inteiroEntre(req.query.page, 1, 1, 100000);
    // `offset` (inteiro >= 0) tem precedência sobre `page`. Quem exclui documentos no meio da
    // lista pede o próximo lote por offset = quantos já tem na tela; por página, o lote pularia
    // o documento que subiu de posição. Offset inválido é ignorado e vale `page`.
    const offsetBruto = Number(req.query.offset);
    const temOffset = req.query.offset !== undefined && String(req.query.offset).trim() !== ''
      && Number.isInteger(offsetBruto) && offsetBruto >= 0 && offsetBruto <= 10_000_000;
    const inicio = temOffset ? offsetBruto : (pageBruto - 1) * limit;
    const page = temOffset ? Math.floor(inicio / limit) + 1 : pageBruto;

    // Os filtros que o banco sabe fazer sozinho.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtros = (query: any) => {
      let qy = query.eq('user_id', req.userId);
      if (tipos.length === 1) qy = qy.eq('tipo', tipos[0]);
      else if (tipos.length > 1) qy = qy.in('tipo', tipos);
      if (q) qy = qy.or(`cliente_nome.ilike.%${q}%,codigo_curto.ilike.%${q}%`);
      if (de) qy = qy.gte('created_at', de);
      if (ate) qy = qy.lte('created_at', ate);
      return qy;
    };

    let pagina: LinhaLeve[] = [];
    let total = 0;

    if (chave) {
      // Pasta por nome: o ilike do banco não casa acento ("sao jose" não acha "São
      // José"), então o banco devolve só as colunas leves e a chave é conferida aqui.
      const { rows, error } = await lerTudo<LinhaLeve>((a, b) =>
        filtros(supabase.from('documents').select(COLUNAS_LISTA)).order('created_at', { ascending: false }).order('id', { ascending: true }).range(a, b));
      if (error) throw error;
      const daPasta = rows.filter((d) => pertenceAPasta(d, clienteId, chave));
      total = daPasta.length;
      pagina = daPasta.slice(inicio, inicio + limit);
    } else {
      let qy = filtros(supabase.from('documents').select(COLUNAS_LISTA, { count: 'exact' }));
      if (clienteId) qy = qy.eq('cliente_id', clienteId);
      const { data, error, count } = await qy
        .order('created_at', { ascending: false }).order('id', { ascending: true })
        .range(inicio, inicio + limit - 1);
      if (error) throw error;
      pagina = (data ?? []) as LinhaLeve[];
      total = count ?? pagina.length;
    }

    const { data: empresa } = await supabase
      .from('company').select('slug').eq('user_id', req.userId).maybeSingle();
    const slug = (empresa as { slug?: string | null } | null)?.slug ?? null;

    // Signed URL para baixar (a tela só precisa saber se o arquivo já existe).
    const docs = await Promise.all(pagina.map(async (doc) => {
      let signed_url: string | null = null;
      const arquivo = doc.arquivo_url as string | null | undefined;
      if (arquivo) {
        const { data: signed } = await supabase.storage
          .from('documentos')
          .createSignedUrl(arquivo, 3600);
        signed_url = signed?.signedUrl ?? null;
      }
      // O /p/ só abre proposta. Sem número curto cai no UUID, que a rota também aceita.
      const linkPublico = doc.tipo && TIPOS_COM_LINK_PUBLICO.includes(doc.tipo)
        ? (slug && doc.codigo_curto ? `/p/${slug}.${doc.codigo_curto}` : `/p/${doc.id}`)
        : null;
      // O PDF sai do arquivo guardado ou, na proposta, do próprio content (a proposta
      // nasce como página completa). Contrato e afins sem arquivo ainda estão sendo
      // arquivados pelo dashboard: a tela mostra "Processando...".
      const pdfDisponivel = !!signed_url || (!!doc.tipo && TIPOS_COM_LINK_PUBLICO.includes(doc.tipo));
      const { arquivo_url: _a, ...resto } = doc;
      return { ...resto, signed_url, pdf_disponivel: pdfDisponivel, link_publico: linkPublico };
    }));

    res.json({
      documents: docs, total, page, limit, offset: inicio,
      has_more: inicio + pagina.length < total,
      plano: user.plano, historico: true,
    });
  } catch (err) {
    logger.error('documents', 'listDocuments falhou', err);
    res.status(500).json({ error: 'Erro ao listar documentos' });
  }
}

// Início do mês corrente em Brasília, em ISO. documents.created_at vem 3h adiantado
// (conhecido, não mexer): a virada do mês cai a poucas horas de diferença, tolerável
// para um indicador.
function inicioDoMes(): string {
  const agora = new Date(Date.now() - 3 * 3600000);
  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1, 3, 0, 0)).toISOString();
}

const TIPOS_PROPOSTA = ['propostaSolar', 'propostaOffGrid', 'proposta'];
const TIPOS_CONTRATO_PROCURACAO = ['contratoSolar', 'contratoPJ', 'prestacaoServico', 'procuracao'];

interface Pasta {
  chave: string;
  cliente_id: string | null;
  nome: string;
  total: number;
  tipos: Record<string, number>;
  ultimo: string | null;
}

// GET /documents/resumo — indicadores do mês e as pastas por cliente. Agrega no
// servidor (e não em cima da página de 50 da lista) para o número ser o de TODOS os
// documentos e para a tela de clientes contar sem uma chamada por cliente.
export async function resumoDocumentos(req: Request, res: Response): Promise<void> {
  try {
    const [docsR, clientesR] = await Promise.all([
      lerTudo<LinhaLeve>((a, b) =>
        supabase.from('documents').select(COLUNAS_LEVES).eq('user_id', req.userId)
          .order('created_at', { ascending: false }).order('id', { ascending: true }).range(a, b)),
      lerTudo<{ id: string; nome: string | null }>((a, b) =>
        supabase.from('clients').select('id, nome').eq('user_id', req.userId).order('id', { ascending: true }).range(a, b)),
    ]);
    if (docsR.error) throw docsR.error;
    // Cadastro que falha não derruba o resumo: as pastas saem só pelo que os documentos dizem.
    if (clientesR.error) logger.error('documents', 'resumo: ler o cadastro de clientes falhou', clientesR.error);

    const docs = docsR.rows;
    const clientes = clientesR.error ? [] : clientesR.rows;
    const nomeDoCliente = new Map(clientes.map((c) => [c.id, String(c.nome ?? '').trim()]));
    const idPorChave = new Map<string, string>();
    for (const c of clientes) {
      const k = chaveCliente(c.nome);
      if (k && !idPorChave.has(k)) idPorChave.set(k, c.id);
    }

    // A pasta é por cliente_id; documento sem id entra na pasta do cliente cadastrado
    // de mesmo nome (pela chave) ou, não havendo, numa pasta só de nome.
    const pastas = new Map<string, Pasta>();
    const abre = (k: string, nome: string, clienteId: string | null, chave: string): Pasta => {
      let p = pastas.get(k);
      if (!p) { p = { chave, cliente_id: clienteId, nome, total: 0, tipos: {}, ultimo: null }; pastas.set(k, p); }
      return p;
    };
    // docs vem do mais novo para o mais velho: o primeiro nome visto é o mais recente.
    for (const d of docs) {
      const chaveDoc = chaveCliente(d.cliente_nome);
      const id = d.cliente_id ?? (chaveDoc ? idPorChave.get(chaveDoc) ?? null : null);
      const nomeDoc = String(d.cliente_nome ?? '').trim() || 'Sem nome';
      const p = id
        ? abre('id:' + id, nomeDoCliente.get(id) || nomeDoc, id, chaveCliente(nomeDoCliente.get(id)) || chaveDoc)
        : abre('nome:' + (chaveDoc || 'sem-nome'), nomeDoc, null, chaveDoc);
      p.total += 1;
      const tipo = String(d.tipo ?? 'outro');
      p.tipos[tipo] = (p.tipos[tipo] ?? 0) + 1;
      if (d.created_at && (!p.ultimo || d.created_at > p.ultimo)) p.ultimo = d.created_at;
    }

    // Contagem de TODOS os documentos por mês (chave YYYY-MM, a mesma fatia do created_at
    // que o painel inicial sempre usou) e por tipo. O painel inicial lê daqui: a lista é paginada.
    const porMes: Record<string, number> = {};
    const porTipo: Record<string, number> = {};
    for (const d of docs) {
      const mesDoc = String(d.created_at ?? '').slice(0, 7);
      if (mesDoc) porMes[mesDoc] = (porMes[mesDoc] ?? 0) + 1;
      const t = String(d.tipo ?? 'outro');
      porTipo[t] = (porTipo[t] ?? 0) + 1;
    }

    const mes = inicioDoMes();
    const doMes = docs.filter((d) => (d.created_at ?? '') >= mes);
    const ordenadas = [...pastas.values()].sort((a, b) => (b.ultimo ?? '').localeCompare(a.ultimo ?? ''));

    res.json({
      indicadores: {
        documentos_mes: doMes.length,
        propostas_mes: doMes.filter((d) => TIPOS_PROPOSTA.includes(String(d.tipo))).length,
        contratos_procuracoes_mes: doMes.filter((d) => TIPOS_CONTRATO_PROCURACAO.includes(String(d.tipo))).length,
        clientes_com_documento: ordenadas.length,
        total: docs.length,
      },
      por_mes: porMes,
      por_tipo: porTipo,
      pastas: ordenadas,
    });
  } catch (err) {
    logger.error('documents', 'resumoDocumentos falhou', err);
    res.status(500).json({ error: 'Erro ao carregar o resumo dos documentos' });
  }
}

// GET /documents/por-cliente?cliente_id=&cliente_chave= — tudo que existe de um
// cliente: documentos, vistorias e manutenções. Cada um entra pelo id do cliente ou,
// sem id, pelo nome (chaveCliente). A tabela de manutenções pode não existir ainda
// (migration pendente): vira lista vazia, não erro.
export async function documentosPorCliente(req: Request, res: Response): Promise<void> {
  try {
    const idRaw = String(req.query.cliente_id ?? '').trim();
    const clienteId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idRaw) ? idRaw : null;
    let chave = chaveCliente(String(req.query.cliente_chave ?? '')) || null;
    let nome: string | null = null;

    if (!clienteId && !chave) { res.status(400).json({ error: 'Informe cliente_id ou cliente_chave' }); return; }

    if (clienteId) {
      const { data: cliente } = await supabase
        .from('clients').select('id, nome').eq('id', clienteId).eq('user_id', req.userId).maybeSingle();
      if (!cliente) { res.status(404).json({ error: 'Cliente não encontrado' }); return; }
      nome = String((cliente as { nome?: string }).nome ?? '');
      chave = chaveCliente(nome) || chave;
    }

    const docsR = await lerTudo<LinhaLeve>((a, b) =>
      supabase.from('documents').select(COLUNAS_LEVES).eq('user_id', req.userId)
        .order('created_at', { ascending: false }).order('id', { ascending: true }).range(a, b));
    if (docsR.error) throw docsR.error;
    const documentos = docsR.rows.filter((d) => pertenceAPasta(d, clienteId, chave));

    // Vistorias e manutenções: as do id (consulta direta) e as sem id de mesmo nome.
    async function dessaPasta(tabela: 'vistorias' | 'manutencoes', colunas: string): Promise<LinhaLeve[]> {
      const lista: LinhaLeve[] = [];
      if (clienteId) {
        const r = await lerTudo<LinhaLeve>((a, b) =>
          supabase.from(tabela).select(colunas).eq('user_id', req.userId).eq('cliente_id', clienteId)
            .order('created_at', { ascending: false }).order('id', { ascending: true }).range(a, b) as unknown as PromiseLike<{ data: LinhaLeve[] | null; error: { code?: string; message?: string } | null }>);
        if (r.error) throw r.error;
        lista.push(...r.rows);
      }
      if (chave) {
        const r = await lerTudo<LinhaLeve>((a, b) =>
          supabase.from(tabela).select(colunas).eq('user_id', req.userId).is('cliente_id', null)
            .order('created_at', { ascending: false }).order('id', { ascending: true }).range(a, b) as unknown as PromiseLike<{ data: LinhaLeve[] | null; error: { code?: string; message?: string } | null }>);
        if (r.error) throw r.error;
        lista.push(...r.rows.filter((v) => chaveCliente(v.cliente_nome) === chave));
      }
      return lista.sort((x, y) => String(y.created_at ?? '').localeCompare(String(x.created_at ?? '')));
    }

    let vistorias: LinhaLeve[] = [];
    try {
      vistorias = await dessaPasta('vistorias', 'id, codigo_curto, cliente_id, cliente_nome, status, created_at');
    } catch (err) {
      logger.error('documents', 'por-cliente: ler vistorias falhou', err);
    }

    let manutencoes: LinhaLeve[] = [];
    try {
      manutencoes = await dessaPasta('manutencoes', 'id, codigo, cliente_id, cliente_nome, status, selo, data_inspecao, created_at');
    } catch (err) {
      if (!tabelaAusente(err as { code?: string })) {
        logger.error('documents', 'por-cliente: ler manutenções falhou', err);
      }
    }

    res.json({ cliente: { id: clienteId, nome, chave }, documentos, vistorias, manutencoes });
  } catch (err) {
    logger.error('documents', 'documentosPorCliente falhou', err);
    res.status(500).json({ error: 'Erro ao carregar a pasta do cliente' });
  }
}

// ── Auto-preenchimento da proposta ────────────────────────────────────────────
// Reaproveita o histórico já salvo (documents.dados_json). Devolve:
//  - kit: campos NÃO específicos do cliente (marcas, garantias, taxas, paleta) da
//    proposta mais recente do usuário → pré-preenche todo doc novo (kit do vendedor).
//  - clientes: nomes recentes com histórico de proposta (pro seletor).
//  - cliente: a proposta mais recente de um cliente (por nome) → tudo dele volta.
const CLIENTE_ONLY = new Set<string>([
  'cliente_nome', 'codigo', 'cidade', 'uf', 'endereco', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'consumo_kwh', 'qtd_modulos', 'area_m2',
  'geracao_media_kwh', 'geracao_media', 'hsp', 'tarifa_kwh', 'investimento', 'preco_avista',
  'entrada_valor', 'entrada_modo', 'entrada_dias', 'pag_custom', 'tipo_telhado', 'iluminacao_publica',
  'bateria_capacidade_kwh', 'bateria_potencia_kw', 'bateria_ciclos', 'bateria_marca', 'bateria_garantia', 'bateria_tem',
]);
// emitido_em pertence ao doc reemitido, nunca ao próximo: prefill que o arrastasse
// faria a proposta nova nascer com a data da anterior.
// `codigo` sai sempre: é o número impresso de OUTRA proposta. No prefill por cliente
// ele entrava no formulário e podia acabar impresso de novo.
const STRIP_ALWAYS = new Set<string>(['foto_telhado_b64', 'foto_logo_b64', 'emitido_em', 'codigo']);

function limpaDados(d: Record<string, unknown>, soKit: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d || {})) {
    if (STRIP_ALWAYS.has(k)) continue;
    if (soKit && CLIENTE_ONLY.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Nome comparável: sem acento, sem diferença de maiúscula, com espaço único.
 *  "PAROQUIA DE SÃO JOSÉ" e "paroquia de sao jose" são o mesmo cliente. */
function nomeComparavel(nome: string | null | undefined): string {
  return chaveCliente(nome);
}

// Mesma lista do formulário (TIPOS_TELHADO em PropostaSolarForm.tsx). Telhado do
// cadastro fora dela ("Fibromadeira") não entra: a proposta não tem essa opção.
const TIPOS_TELHADO_PROPOSTA = ['Cerâmico', 'Fibrocimento', 'Metálico', 'Cimento', 'Laje', 'Solo', 'Carport'];

interface ClienteCadastro {
  nome: string | null;
  cidade: string | null;
  uf: string | null;
  endereco: string | null;
  cep?: string | null;
  tipo_telhado: string | null;
}

/** Cliente do cadastro (tabela clients) no formato dos campos da proposta. */
function camposDoCadastro(c: ClienteCadastro): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let cidade = String(c.cidade || '').trim();
  let uf = String(c.uf || '').trim().toUpperCase();
  // O cadastro às vezes grava a UF de novo no fim da cidade ("CAMPINA GRANDE/PB").
  const comUf = cidade.match(/^(.*?)\s*[/-]\s*([A-Za-z]{2})$/);
  if (comUf) {
    cidade = comUf[1].trim();
    if (!uf) uf = comUf[2].toUpperCase();
  }
  if (cidade) out.cidade = cidade;
  if (uf) out.uf = uf;
  const endereco = String(c.endereco || '').trim();
  if (endereco) out.endereco = endereco;
  const cep = String(c.cep || '').trim();
  if (cep) out.cep = cep;
  const telhado = TIPOS_TELHADO_PROPOSTA.find((t) => nomeComparavel(t) === nomeComparavel(c.tipo_telhado));
  if (telhado) out.tipo_telhado = telhado;
  return out;
}

export async function propostaPrefill(req: Request, res: Response): Promise<void> {
  const nome = String(req.query.cliente_nome || '').trim();
  // Duas fontes: as propostas já emitidas (tudo da última) e o CADASTRO de clientes.
  // Até 14/09/2026 só a primeira existia: cliente cadastrado que ainda não tinha
  // proposta nem aparecia no seletor, e escolher o nome não carregava nada. Eram 92
  // de 174 clientes cadastrados em 30 dias, em 29 contas.
  const [historico, cadastro] = await Promise.all([
    supabase
      .from('documents')
      .select('cliente_nome, dados_json, created_at')
      .eq('user_id', req.userId)
      .eq('tipo', 'propostaSolar')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('clients')
      .select('nome, cidade, uf, endereco, cep, tipo_telhado, created_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);
  if (historico.error) {
    logger.error('documents', 'prefill falhou', historico.error);
    res.status(500).json({ error: 'Não consegui carregar o histórico.' });
    return;
  }
  // Cadastro que falha não derruba o histórico: segue só com as propostas.
  if (cadastro.error) logger.error('documents', 'prefill: ler o cadastro de clientes falhou', cadastro.error);

  const docs = (historico.data ?? []) as { cliente_nome: string | null; dados_json: Record<string, unknown> | null; created_at: string }[];
  const clientesCadastro = (cadastro.error ? [] : (cadastro.data ?? [])) as ClienteCadastro[];

  const kit = docs.length && docs[0].dados_json ? limpaDados(docs[0].dados_json, true) : {};

  // Primeiro quem tem proposta (recarrega tudo), depois quem só está no cadastro.
  const vistos = new Set<string>();
  const clientes: string[] = [];
  for (const n of [...docs.map((d) => d.cliente_nome), ...clientesCadastro.map((c) => c.nome)]) {
    const limpo = String(n || '').trim();
    const chave = nomeComparavel(limpo);
    if (limpo && !vistos.has(chave)) { vistos.add(chave); clientes.push(limpo); }
  }

  let cliente: Record<string, unknown> | null = null;
  if (nome) {
    const chave = nomeComparavel(nome);
    const hit = docs.find((d) => nomeComparavel(d.cliente_nome) === chave);
    if (hit?.dados_json) {
      cliente = limpaDados(hit.dados_json, false);
    } else {
      // Sem proposta anterior: vem do cadastro. Objeto vazio (e não null) quando o
      // cadastro só tem o nome, pra tela saber que o cliente existe.
      const doCadastro = clientesCadastro.find((c) => nomeComparavel(c.nome) === chave);
      if (doCadastro) cliente = camposDoCadastro(doCadastro);
    }
  }

  res.json({ kit, clientes: clientes.slice(0, 250), cliente });
}

// DESLIGADA em 28/10/2026, por ordem do dono: nenhum documento de nenhum plano é
// apagado, nem a linha nem o arquivo do Storage. Esta função apagava os documentos do
// plano pro com mais de 30 dias (e a lista só mostrava 30). Agora todo documento fica
// para sempre. O nome e a rota /cron/cleanup-pro-docs continuam existindo para quem
// ainda chama (um pinger externo receberia 404 e acusaria erro); só não fazem mais nada.
export async function cleanupProDocuments(): Promise<void> {
  logger.info('documents', 'cleanup-pro-docs desligado: documentos nao sao mais apagados');
}

const MSG_ABRIR_FALHA = 'Não consegui abrir agora. Tente de novo.';

/** PGRST116 (nenhuma linha) e 22P02 (id que não é uuid) querem dizer "não existe", não "o banco falhou". */
function ausenciaDeLinha(err: { code?: string }): boolean {
  return err.code === 'PGRST116' || err.code === '22P02';
}

/**
 * Remove o arquivo ANTIGO de um documento do usuário. Só mexe no que está na pasta dele
 * (`<userId>/...`): um arquivo_url fora disso não é nosso para apagar. Falha só vai para o log.
 */
async function removerArquivoAntigo(userId: string, caminho: string, contexto: string): Promise<void> {
  if (!caminho.startsWith(`${userId}/`)) {
    logger.error('documents', `${contexto}: arquivo fora da pasta do usuário, não removi`, { caminho });
    return;
  }
  await removerArquivoSilencioso(caminho, contexto);
}

/** Remove um arquivo do bucket sem derrubar a resposta: falha vai só para o log. */
async function removerArquivoSilencioso(caminho: string, contexto: string): Promise<void> {
  try {
    const { error } = await supabase.storage.from('documentos').remove([caminho]);
    if (error) logger.error('documents', `${contexto}: não consegui remover ${caminho}`, error);
  } catch (err) {
    logger.error('documents', `${contexto}: remoção de ${caminho} falhou`, err);
  }
}

/**
 * Antes de apagar uma proposta, o contador de numeração (documentos_numeracao) tem que
 * ser pelo menos o número dela. A função reservar_codigo_curto parte de
 * greatest(ultimo, maior número que ainda existe) + 1: sem linha no contador, apagar a
 * proposta de maior número faria a próxima herdar o número dela, e o link que o cliente
 * A recebeu abriria a proposta do cliente B. Devolve false se não conseguiu garantir.
 */
async function garantirContadorNumeracao(userId: string, ano: number, num: number): Promise<boolean> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { data: atual, error } = await supabase
      .from('documentos_numeracao').select('ultimo').eq('user_id', userId).eq('ano', ano).maybeSingle();
    if (error) { logger.error('documents', 'excluir: leitura do contador falhou', error); return false; }

    if (!atual) {
      const { error: insErr } = await supabase
        .from('documentos_numeracao').insert({ user_id: userId, ano, ultimo: num });
      if (!insErr) return true;
      // Outra requisição criou a linha no meio: relê e segue pelo caminho de cima.
      if (insErr.code === '23505') continue;
      logger.error('documents', 'excluir: criação do contador falhou', insErr);
      return false;
    }

    if (Number(atual.ultimo) >= num) return true;
    const { error: updErr } = await supabase
      .from('documentos_numeracao')
      .update({ ultimo: num, atualizado_em: new Date().toISOString() })
      .eq('user_id', userId).eq('ano', ano).lt('ultimo', num);
    if (updErr) { logger.error('documents', 'excluir: ajuste do contador falhou', updErr); return false; }
    return true;
  }
  return false;
}

const MSG_EXCLUIR_FALHA = 'Não consegui excluir agora. Tente de novo.';

// Exclui um documento do próprio usuário. NÃO mexe em users.documentos_usados: a cota
// é um contador, e devolver cota ao apagar abriria a brecha do plano grátis (gera,
// apaga, gera de novo). O arquivo do bucket sai por último e uma falha ali só vai para o log.
export async function excluirDocumento(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const { data: doc, error: selErr } = await supabase
      .from('documents')
      .select('id, user_id, tipo, codigo_curto, arquivo_url')
      .eq('id', id)
      .eq('user_id', req.userId)
      .maybeSingle();
    // 22P02: o id não é um uuid. Para quem chamou é o mesmo que não existir.
    if (selErr && selErr.code !== '22P02') {
      logger.error('documents', 'excluir: leitura do documento falhou', selErr);
      res.status(500).json({ error: MSG_EXCLUIR_FALHA });
      return;
    }
    if (selErr || !doc) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
    }

    const cod = /^(\d{4})(\d{4})$/.exec(String(doc.codigo_curto ?? ''));
    if (cod) {
      const ano = Number(cod[1]);
      const num = Number(cod[2]);
      // O contador só aceita ano de 2000 a 2999 (check da tabela).
      if (ano >= 2000 && ano <= 2999 && !(await garantirContadorNumeracao(req.userId, ano, num))) {
        res.status(500).json({ error: MSG_EXCLUIR_FALHA });
        return;
      }
    }

    const { data: apagadas, error: delErr } = await supabase
      .from('documents').delete().eq('id', id).eq('user_id', req.userId).select('id');
    if (delErr) {
      if (delErr.code === '23503') {
        res.status(409).json({ error: 'Esse arquivo está ligado a outro registro e não pode ser excluído.' });
        return;
      }
      logger.error('documents', 'excluir: delete falhou', delErr);
      res.status(500).json({ error: MSG_EXCLUIR_FALHA });
      return;
    }
    if (!apagadas || apagadas.length === 0) {
      res.status(404).json({ error: 'Arquivo não encontrado.' });
      return;
    }

    if (doc.arquivo_url) await removerArquivoAntigo(req.userId, doc.arquivo_url, 'excluir');

    logger.info('documents', `documento ${doc.id} (${doc.tipo}) excluído`);
    res.json({ ok: true });
  } catch (err) {
    logger.error('documents', 'excluirDocumento falhou', err);
    res.status(500).json({ error: MSG_EXCLUIR_FALHA });
  }
}
