import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabaseGerador } from '../utils/supabaseGerador';
import { logger } from '../utils/logger';
import { TRELLO_BOARD_ID } from '../services/insightsService';
import {
  ARQUIVOS_SOLAR, CAMPOS_SOLAR, BUCKET_DOSSIE,
  lerProposta, gravarDossie, resumoDossie,
  garantirBucket, sondarBucket, saudeDossie,
  caminhoArquivo, extensaoDe, assinar,
  credenciaisTrello, anexarNoTrello, comentarNoTrello, textoFichaTecnica,
  buscarCartao, listarCartoes, criarCartao, acharLista, nomeCartaoNovo, LISTA_CARTAO_NOVO,
  type ArquivoDossie, type PropostaDossie, type Dossie,
} from '../services/gerador/dossieVenda';

// ─────────────────────────────────────────────────────────────────────────────
// Rotas do dossiê da venda. Montadas dentro de /gerador.
//
// O TETO DE TAMANHO NÃO É O DO EXPRESS. O app.ts declara
// `express.json({limit:'10mb'})`, mas a Vercel recusa corpo acima de ~4,5 MB
// ANTES do Express ver a requisição — e base64 infla o arquivo em 1/3. Por isso
// o teto aqui é 3 MB de arquivo cru (≈4 MB depois de codificado), e a página
// reduz foto pra ~1600px antes de mandar. Um teto declarado maior não faz o
// arquivo passar; só troca uma mensagem clara por um erro de plataforma.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_BYTES = 3 * 1024 * 1024;

/**
 * EXIGE CONSULTOR LOGADO. É a única parte do /gerador que exige, e o motivo é o
 * conteúdo: estas rotas devolvem signed url de CNH e de conta de luz.
 *
 * O resto do /gerador é aberto porque o código da proposta funciona como
 * segredo — mas o link público do cliente passa pelo `get_proposta_pub`, que
 * tem validade de 7 dias e para de entregar valores depois. Aqui não haveria
 * gate nenhum: código sequencial (202600551, 202600552…), para sempre, e do
 * outro lado o documento de identidade de uma pessoa. Enumerar seria trivial.
 *
 * O token é o mesmo que a página já manda pro PostgREST (`supaHeaders`), e é
 * validado no Supabase do Gerador. A chave publishable NÃO passa: ela não é
 * um usuário, e é justamente ela que qualquer um teria.
 */
export async function exigeConsultor(req: Request, res: Response, next: () => void): Promise<void> {
  const auth = String(req.headers['authorization'] || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || token.startsWith('sb_publishable_')) {
    res.status(401).json({ error: 'entre com sua conta pra ver ou anexar documentos.', precisa: 'login' });
    return;
  }
  try {
    const { data, error } = await supabaseGerador.auth.getUser(token);
    if (error || !data?.user) {
      res.status(401).json({ error: 'sessão expirada. Entre de novo.', precisa: 'login' });
      return;
    }
    // Token válido não basta: o cadastro público do Supabase do Gerador está
    // ABERTO (conferido em 07/10/2026: disable_signup=false), então qualquer um
    // cria conta com a chave publishable que está no HTML e passaria aqui. As
    // contas de consultor nascem por script, todas `<nome>@irmaosnaobra.app`
    // (emailDoConsultor no /gerador), e confirmar esse e-mail exige receber
    // mensagem no domínio. Vale para o dossiê (CNH, conta de luz) e para a IA
    // do contrato, que gasta crédito a cada chamada.
    const email = String(data.user.email || '').toLowerCase();
    const confirmado = !!(data.user.email_confirmed_at || (data.user as { confirmed_at?: string }).confirmed_at);
    if (!email.endsWith('@irmaosnaobra.app') || !confirmado) {
      res.status(403).json({ error: 'esta conta não é de consultor.', precisa: 'login' });
      return;
    }
  } catch {
    res.status(401).json({ error: 'não consegui conferir sua sessão.', precisa: 'login' });
    return;
  }
  next();
}

const TIPOS_IMAGEM = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];

/** Devolve o dossiê pronto pra tela: signed url fresca de cada arquivo e o
 *  pré-preenchimento dos 4 campos técnicos que já vieram do orçamento.
 *
 *  O pré-preenchimento NÃO é gravado: o que foi orçado é palpite, o que foi
 *  instalado é o que vale. Gravar o palpite faria o campo parecer conferido. */
async function montarResposta(p: PropostaDossie, d: Dossie) {
  const arquivos: Record<string, Array<ArquivoDossie & { signed: string | null }>> = {};
  for (const slot of ARQUIVOS_SOLAR) {
    const lista = d.arquivos[slot.key] || [];
    arquivos[slot.key] = await Promise.all(
      lista.map(async (a) => ({ ...a, signed: await assinar(a.path) })),
    );
  }
  const sugestoes: Record<string, string> = {};
  for (const c of CAMPOS_SOLAR) {
    if (!c.prefill) continue;
    const v = p[c.prefill];
    if (v != null && String(v).trim()) sugestoes[c.key] = String(v).trim();
  }
  // O e-mail costuma já estar no cadastro da proposta — pedir de novo o que a
  // pessoa já digitou é como o campo fica em branco.
  const emailDados = String((p.dados as Record<string, unknown>).email || '').trim();
  if (emailDados) sugestoes.email = emailDados;

  return {
    ok: true,
    codigo: p.codigo,
    cliente_nome: p.cliente_nome,
    vendido: p.vendido,
    slots: ARQUIVOS_SOLAR,
    campos_def: CAMPOS_SOLAR,
    campos: d.campos,
    sugestoes,
    arquivos,
    trello: d.trello,
    resumo: resumoDossie(d),
  };
}

export function mountDossie(router: Router): void {
  // ── Saúde: os três preparos de uma vez ────────────────────────────────────
  // Três booleanos, não um "falhou". São três configurações independentes e
  // cada uma quebra o fluxo num ponto diferente: sem bucket não sobe arquivo,
  // sem service key não dá pra criar o bucket nem apagar arquivo, sem
  // key/token do Trello sobe mas não anexa. Um erro genérico esconde qual das
  // três está faltando, e a pessoa mexe na errada.
  router.get('/dossie/saude', async (_req: Request, res: Response) => {
    try {
      let sonda = await sondarBucket();
      let motivo: string | undefined;
      // Só tenta criar quando SABE que não existe. Chamar createBucket no
      // indeterminado devolveria 403 e viraria um "motivo" que não é o
      // problema real — o problema real é não ter a service key.
      if (sonda === 'nao_existe') {
        const r = await garantirBucket();
        sonda = r.ok ? 'existe' : 'nao_existe';
        motivo = r.motivo;
      }
      res.json({ ok: true, ...saudeDossie(sonda), bucket_nome: BUCKET_DOSSIE, motivo: motivo ?? null });
    } catch (err: any) {
      logger.error('dossie', 'saude falhou', err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  // ── Estado do dossiê de uma proposta ──────────────────────────────────────
  router.get('/dossie/:codigo', exigeConsultor, async (req: Request, res: Response) => {
    try {
      const p = await lerProposta(String(req.params.codigo));
      if (!p) { res.status(404).json({ error: 'proposta não encontrada' }); return; }
      res.json(await montarResposta(p, p.dossie));
    } catch (err: any) {
      logger.error('dossie', 'leitura falhou', err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  // ── Sobe UM arquivo pra UM slot ───────────────────────────────────────────
  // Um arquivo por requisição, igual à vistoria: o consultor está no celular,
  // muitas vezes com sinal ruim. Se a conexão cair ele perde a foto que faltou,
  // não o dossiê inteiro.
  const uploadSchema = z.object({
    slot: z.string().min(1).max(40),
    base64: z.string().min(1),
    media_type: z.string().min(3).max(100),
    nome: z.string().max(255).optional(),
  });

  router.post('/dossie/:codigo/arquivo', exigeConsultor, async (req: Request, res: Response) => {
    const parsed = uploadSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: 'dados inválidos' }); return; }
    const { slot, base64, media_type, nome } = parsed.data;

    const def = ARQUIVOS_SOLAR.find((s) => s.key === slot);
    if (!def) { res.status(400).json({ error: 'slot desconhecido' }); return; }

    const tipo = media_type.toLowerCase().split(';')[0].trim();
    const ehPdf = tipo === 'application/pdf';
    if (!TIPOS_IMAGEM.includes(tipo) && !ehPdf) {
      res.status(400).json({ error: 'mande imagem ou PDF' }); return;
    }
    if (ehPdf && !def.aceitaPdf) {
      res.status(400).json({ error: `"${def.label}" tem que ser foto, não PDF` }); return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      res.status(400).json({ error: 'arquivo inválido' }); return;
    }
    if (!buffer.length) { res.status(400).json({ error: 'arquivo vazio' }); return; }
    if (buffer.length > MAX_BYTES) {
      res.status(413).json({ error: 'arquivo muito grande (máx 3 MB). Se for PDF, mande uma foto da página.' });
      return;
    }

    try {
      const p = await lerProposta(String(req.params.codigo));
      if (!p) { res.status(404).json({ error: 'proposta não encontrada' }); return; }

      const path = caminhoArquivo(p.codigo, slot, extensaoDe(tipo, nome || ''));
      const subir = () => supabaseGerador.storage
        .from(BUCKET_DOSSIE)
        .upload(path, buffer, { contentType: tipo, upsert: false });

      // TENTA PRIMEIRO, cria depois. A ordem inversa (garantirBucket antes de
      // toda subida) recusava o upload com 503 quando o bucket JÁ EXISTIA mas a
      // service key não estava configurada — criar bucket é uma permissão, e
      // gravar nele é outra. Exigir a primeira pra exercer a segunda travaria
      // um bucket criado à mão no painel, que é justamente a saída documentada.
      let { error: upErr } = await subir();
      if (upErr && /not found|NoSuchBucket/i.test(String(upErr.message || upErr))) {
        const b = await garantirBucket();
        if (!b.ok) { res.status(503).json({ error: b.motivo }); return; }
        ({ error: upErr } = await subir());
      }
      if (upErr) {
        logger.error('dossie', 'upload falhou', upErr);
        res.status(502).json({ error: 'não consegui salvar o arquivo: ' + String(upErr.message || upErr) });
        return;
      }

      const arq: ArquivoDossie = {
        path,
        nome: (nome || `${slot}.${extensaoDe(tipo, '')}`).slice(0, 255),
        tipo,
        bytes: buffer.length,
        em: new Date().toISOString(),
        trello_status: 'pendente',
        trello_anexo_id: null,
        trello_motivo: null,
      };
      const d = await gravarDossie(p.codigo, (dos) => {
        dos.arquivos[slot] = [...(dos.arquivos[slot] || []), arq];
        // Arquivo novo depois de um envio: o cartão está desatualizado, e dizer
        // "enviado" esconderia isso.
        if (dos.trello.status === 'enviado') dos.trello.status = 'pendente';
      });
      res.json({ ok: true, slot, arquivo: { ...arq, signed: await assinar(path) }, resumo: resumoDossie(d) });
    } catch (err: any) {
      logger.error('dossie', 'upload falhou', err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  // ── Remove UM arquivo ─────────────────────────────────────────────────────
  const removeSchema = z.object({ slot: z.string().min(1).max(40), path: z.string().min(1) });

  router.delete('/dossie/:codigo/arquivo', exigeConsultor, async (req: Request, res: Response) => {
    const parsed = removeSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: 'dados inválidos' }); return; }
    const { slot, path } = parsed.data;
    const codigo = String(req.params.codigo);
    // Só apaga caminho DESTA proposta. Sem isso, o código de uma proposta
    // apagaria o documento de outra.
    if (!path.startsWith(`${codigo}/`)) { res.status(400).json({ error: 'arquivo inválido' }); return; }

    try {
      const d = await gravarDossie(codigo, (dos) => {
        dos.arquivos[slot] = (dos.arquivos[slot] || []).filter((a) => a.path !== path);
      });
      // Best-effort: sem service key o Storage recusa o DELETE (medido: 403).
      // O registro já saiu do dossiê, que é o que a tela mostra — deixar o byte
      // órfão é bem melhor do que travar a remoção.
      supabaseGerador.storage.from(BUCKET_DOSSIE).remove([path])
        .then(({ error }) => { if (error) logger.warn('dossie', 'arquivo órfão no storage', { path, error }); })
        .catch(() => {});
      res.json({ ok: true, resumo: resumoDossie(d) });
    } catch (err: any) {
      logger.error('dossie', 'remoção falhou', err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  // ── Grava os campos de texto ──────────────────────────────────────────────
  const camposSchema = z.object({ campos: z.record(z.string(), z.string().max(300)) });

  router.put('/dossie/:codigo/campos', exigeConsultor, async (req: Request, res: Response) => {
    const parsed = camposSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: 'dados inválidos' }); return; }
    const permitidos = new Set(CAMPOS_SOLAR.map((c) => c.key));
    const limpos: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.data.campos)) {
      if (permitidos.has(k)) limpos[k] = String(v || '').trim();
    }
    try {
      const d = await gravarDossie(String(req.params.codigo), (dos) => {
        dos.campos = { ...dos.campos, ...limpos };
        if (dos.trello.status === 'enviado') dos.trello.status = 'pendente';
      });
      res.json({ ok: true, campos: d.campos, resumo: resumoDossie(d) });
    } catch (err: any) {
      logger.error('dossie', 'campos falharam', err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });

  // ── Cartões do quadro, pro consultor escolher ─────────────────────────────
  // O casamento automático recusa na dúvida (e tem que recusar mesmo). Quando
  // ele recusa, a saída não pode ser "procure o link no Trello e cole aqui":
  // essa é a hora em que o consultor desiste e volta pro WhatsApp.
  router.get('/dossie/:codigo/cartoes', exigeConsultor, async (req: Request, res: Response) => {
    try {
      const p = await lerProposta(String(req.params.codigo));
      if (!p) { res.status(404).json({ error: 'proposta não encontrada' }); return; }
      const board = String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID;
      const r = await listarCartoes(board, p.cliente_nome || '');
      res.json({ ok: true, ...r });
    } catch (err: any) {
      logger.warn('dossie', 'lista de cartões falhou', String(err?.message || err));
      res.status(502).json({ error: String(err?.message || err) });
    }
  });

  // ── Manda tudo pro cartão do Trello ───────────────────────────────────────
  // Arquivos E ficha técnica na MESMA chamada. Separado em dois endpoints, uma
  // falha parcial deixaria o cartão com as fotos e sem a ficha (ou o contrário)
  // e nada na tela diria qual dos dois faltou.
  //
  // Idempotente por arquivo: quem já tem `trello_anexo_id` não sobe de novo, e
  // a ficha é EDITADA em vez de empilhar comentário a cada clique. Reenviar
  // depois de uma falha parcial manda só o que faltou.
  router.post('/dossie/:codigo/trello', exigeConsultor, async (req: Request, res: Response) => {
    const cred = credenciaisTrello();
    if (!cred) {
      res.status(503).json({
        error: 'Trello sem credencial de escrita. Gere key e token em trello.com/power-ups/admin e configure TRELLO_KEY e TRELLO_TOKEN na Vercel.',
        precisa: 'credencial',
      });
      return;
    }

    try {
      const p = await lerProposta(String(req.params.codigo));
      if (!p) { res.status(404).json({ error: 'proposta não encontrada' }); return; }

      // O cartão pode vir escolhido pela tela (quando o consultor corrigiu o
      // casamento) ou ser procurado pelo nome, com a MESMA regra da aba de
      // situação.
      const d = p.dossie;
      const board = String(process.env.TRELLO_BOARD_ID || '').trim() || TRELLO_BOARD_ID;

      // ORDEM: cartão que o dossiê já conhece, depois o que o consultor
      // escolheu, depois procurar pelo nome, e só então CRIAR.
      //
      // O `card_id` gravado vem primeiro porque é ele que torna o reenvio
      // idempotente: sem essa checagem, cada clique em Reenviar criaria um
      // cartão novo do mesmo cliente e o quadro encheria de duplicata.
      const cardIdManual = String(req.body?.card_id || '').trim();
      let cardId = cardIdManual || d.trello.card_id || '';
      let cardNome: string | null = d.trello.card_nome;
      let criouAgora = false;

      if (!cardId) {
        const achado = await buscarCartao(board, p.cliente_nome || p.codigo, '');
        if (achado.cartao) {
          // Cliente que já estava no quadro (revenda, ou venda lançada depois do
          // cadastro). Anexa no cartão dele em vez de criar um segundo.
          cardId = achado.cartao.id;
          cardNome = achado.cartao.nome;
        } else {
          // O CAMINHO NORMAL DE UMA VENDA NOVA. Ela não tem cartão nenhum: é o
          // lançamento dos documentos que coloca o cliente no quadro.
          const lista = await acharLista(board, LISTA_CARTAO_NOVO);
          if ('motivo' in lista) {
            await gravarDossie(p.codigo, (dos) => {
              dos.trello.status = 'falhou';
              dos.trello.motivo = lista.motivo;
              dos.trello.em = new Date().toISOString();
            });
            res.status(502).json({ error: lista.motivo, precisa: 'lista' });
            return;
          }
          const nome = nomeCartaoNovo(p);
          const novo = await criarCartao(cred, lista.id, nome, textoFichaTecnica(p, d));
          if (!novo.ok) {
            // Os documentos NÃO se perdem: continuam no bucket e o dossiê guarda
            // o motivo, pra tela oferecer o reenvio.
            await gravarDossie(p.codigo, (dos) => {
              dos.trello.status = 'falhou';
              dos.trello.motivo = novo.motivo;
              dos.trello.em = new Date().toISOString();
            });
            res.status(502).json({ error: `não consegui criar o cartão: ${novo.motivo}` });
            return;
          }
          cardId = novo.id;
          cardNome = nome;
          criouAgora = true;
          d.trello.card_criado = true;
          d.trello.card_url = novo.url;
        }
      }
      let enviados = 0;
      let falhas = 0;
      const erros: string[] = [];

      for (const slot of ARQUIVOS_SOLAR) {
        for (const arq of d.arquivos[slot.key] || []) {
          if (arq.trello_status === 'enviado' && arq.trello_anexo_id) continue;
          const { data: blob, error } = await supabaseGerador.storage.from(BUCKET_DOSSIE).download(arq.path);
          if (error || !blob) {
            arq.trello_status = 'falhou';
            arq.trello_motivo = 'não consegui ler o arquivo no storage';
            falhas++; erros.push(`${slot.label}: arquivo ilegível`);
            continue;
          }
          const bytes = Buffer.from(await blob.arrayBuffer());
          // Nome do anexo = o slot, não o nome do celular. "IMG_4821.jpg" no
          // cartão não diz se é o padrão ou o medidor; quem homologa precisa
          // saber olhando a lista.
          const ext = arq.nome.split('.').pop() || 'jpg';
          const r = await anexarNoTrello(cred, cardId, `${slot.label}.${ext}`, bytes, arq.tipo);
          if (r.ok) {
            arq.trello_status = 'enviado';
            arq.trello_anexo_id = r.id;
            arq.trello_motivo = null;
            enviados++;
          } else {
            arq.trello_status = 'falhou';
            arq.trello_motivo = r.motivo;
            falhas++; erros.push(`${slot.label}: ${r.motivo}`);
          }
        }
      }

      // A ficha técnica. Cartão que acabou de nascer já veio com ela na
      // DESCRIÇÃO, então não leva comentário — comentar ali duplicaria o texto
      // no mesmo cartão. Cartão que já existia recebe COMENTÁRIO, nunca
      // descrição: sobrescrever a descrição apagaria o que a homologação
      // escreveu lá.
      if (!criouAgora) {
        const ficha = await comentarNoTrello(cred, cardId, textoFichaTecnica(p, d), d.trello.comentario_id);
        if (ficha.ok) d.trello.comentario_id = ficha.id;
        else { falhas++; erros.push(`ficha técnica: ${ficha.motivo}`); }
      }

      d.trello.card_id = cardId;
      d.trello.card_nome = cardNome ?? d.trello.card_nome;
      d.trello.status = falhas === 0 ? 'enviado' : 'falhou';
      d.trello.motivo = falhas === 0 ? null : erros.slice(0, 3).join(' · ');
      d.trello.em = new Date().toISOString();

      // Grava o resultado por cima do que estiver no banco AGORA: um upload que
      // entrou no meio do envio não pode ser apagado pelo dossiê que esta
      // requisição leu lá no começo.
      const salvo = await gravarDossie(p.codigo, (dos) => {
        for (const slot of ARQUIVOS_SOLAR) {
          const desta = new Map((d.arquivos[slot.key] || []).map((a) => [a.path, a]));
          dos.arquivos[slot.key] = (dos.arquivos[slot.key] || []).map((a) => desta.get(a.path) ?? a);
        }
        dos.trello = { ...dos.trello, ...d.trello };
      });

      res.status(falhas === 0 ? 200 : 207).json({
        ok: falhas === 0,
        enviados, falhas, erros,
        criou_cartao: criouAgora,
        cartao: { id: cardId, nome: d.trello.card_nome, url: d.trello.card_url ?? null },
        trello: salvo.trello,
        resumo: resumoDossie(salvo),
      });
    } catch (err: any) {
      logger.error('dossie', 'envio pro trello falhou', err);
      res.status(500).json({ error: String(err?.message || err) });
    }
  });
}
