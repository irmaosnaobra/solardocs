import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { stripPrint } from '../utils/printHtml';
import { userIdDoToken } from '../middleware/auth';
import { ehRobo, dispositivo, geo, linkVencido, dataBR, chaveAbertura } from '../services/propostaLink';
import { paginaVencida } from '../services/propostaVencida';
import { enviarPushAoUsuario } from '../services/pushUsuario';

const router = Router();

// Orçamento de tempo do rastreio. A página do cliente nunca espera mais que LIMITE_TOTAL_MS por ele:
// gravar o evento leva até LIMITE_GRAVAR_MS, e o aviso no celular fica com o que sobrar.
const LIMITE_TOTAL_MS = 1500;
const LIMITE_GRAVAR_MS = 800;
// Mesmo aparelho, mesma proposta, dentro desta janela: uma abertura só (recarregar não conta).
const JANELA_MESMA_ABERTURA_MIN = 10;
// Teto de avisos no celular por proposta em 24 h (o evento continua sendo gravado).
const TETO_AVISOS_POR_DIA = 30;

// Só as chaves do dados_json que a rota usa, pela sintaxe do PostgREST. Trazer o dados_json inteiro
// (fotos em base64, listas) deixava o documento antigo mais lento sem necessidade.
const COLUNAS_DOC = 'id, tipo, arquivo_url, content, user_id, created_at, cliente_nome, '
  + 'link_rastreado:dados_json->>link_rastreado, link_expira_em:dados_json->>link_expira_em, codigo:dados_json->>codigo, '
  + 'vendedor_nome:dados_json->>vendedor_nome, vendedor_whatsapp:dados_json->>vendedor_whatsapp, cliente_dados:dados_json->>cliente_nome';

type Dados = Record<string, unknown>;

/** Valor do formulário: vazio e o marcador '___' (campo não preenchido) viram ''. */
function campo(v: unknown): string {
  const s = String(v ?? '').trim();
  return s === '___' ? '' : s;
}

// Select de antes do rastreio (origin/main). Rede de segurança: se o select novo (alias:dados_json->>chave)
// der erro, a proposta continua abrindo como sempre, sem rastrear, em vez de virar 404 para todo mundo.
const COLUNAS_DOC_ANTIGAS = 'id, tipo, arquivo_url, content';

async function buscarDoc(
  montar: (colunas: string) => PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<Record<string, unknown> | null> {
  const nova = await montar(COLUNAS_DOC);
  if (!nova.error) return (nova.data ?? null) as Record<string, unknown> | null;
  console.error('[public-proposta] select com rastreio falhou, repetindo o select antigo:', nova.error.message);
  const antiga = await montar(COLUNAS_DOC_ANTIGAS);
  if (antiga.error) console.error('[public-proposta] select antigo também falhou:', antiga.error.message);
  return (antiga.data ?? null) as Record<string, unknown> | null;
}

function cookie(header: unknown, nome: string): string | null {
  for (const parte of String(header ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nome) {
      const v = parte.slice(i + 1).trim();
      try { return decodeURIComponent(v); } catch { return v; }
    }
  }
  return null;
}

/**
 * O dono da proposta abrindo o próprio link (cookie de login do solardoc.app). Sem cookie, falso.
 * Reconhece o login pela MESMA função do authMiddleware (Clerk, se ligado, e depois o JWT próprio).
 */
async function ehODono(req: Request, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const token = cookie(req.headers.cookie, 'solardoc_token');
  if (!token) return false;
  try { return (await userIdDoToken(token)) === userId; } catch { return false; }
}

/** Prefetch e pré-renderização do navegador não são um cliente olhando. */
function ehPrefetch(req: Request): boolean {
  const h = `${req.headers['sec-purpose'] ?? ''} ${req.headers['purpose'] ?? ''}`.toLowerCase();
  return /prefetch|prerender|preview/.test(h);
}

function comLimite<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let t: NodeJS.Timeout;
  const limite = new Promise<undefined>((ok) => { t = setTimeout(() => ok(undefined), ms); });
  return Promise.race([p, limite]).finally(() => clearTimeout(t));
}

// GET /p/:id — serve a proposta solar publicamente (sem auth).
// Aceita id em 3 formatos:
//  - {slug}.{YYYYNNNN} — novo padrão, ex: irmaosnaobra.20260001 (preferido)
//  - Código humano YYYYUUUUNNNN (12 dígitos, ex: 202600010001) — legado
//  - UUID — legado / fallback
// Pega o HTML do Storage e devolve com Content-Type correto.
// Só funciona pra proposta ('propostaSolar' e 'propostaOffGrid') — os outros
// tipos são contrato/procuração e não têm por que ficar num link público.
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = String(req.params.id || '');

    type DocRow = {
      id: string; tipo: string; arquivo_url: string | null; content: string | null;
      user_id: string | null; created_at: string | null; cliente_nome: string | null;
      link_rastreado: string | boolean | null; link_expira_em: string | null; codigo: string | null;
      vendedor_nome: string | null; vendedor_whatsapp: string | null; cliente_dados: string | null;
    };
    let doc: DocRow | null = null;

    // Formato 1: slug.codigo_curto (ex: cmoenergiasolar.20260001) — preferido
    const slugCurtoMatch = id.match(/^([a-z0-9]+)\.(\d{8})$/);
    if (slugCurtoMatch) {
      const [, slug, codigoCurto] = slugCurtoMatch;
      const { data: comp } = await supabase
        .from('company')
        .select('user_id')
        .eq('slug', slug)
        .maybeSingle();
      if (comp?.user_id) {
        doc = await buscarDoc((cols) => supabase
          .from('documents')
          .select(cols)
          .eq('user_id', comp.user_id)
          .eq('codigo_curto', codigoCurto)
          .maybeSingle()) as DocRow | null;
      }
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      // Formato 2: UUID — fallback pra docs sem codigo_curto
      doc = await buscarDoc((cols) => supabase
        .from('documents')
        .select(cols)
        .eq('id', id)
        .maybeSingle()) as DocRow | null;
    }

    if (!doc || (doc.tipo !== 'propostaSolar' && doc.tipo !== 'propostaOffGrid')) {
      res.status(404).type('text/html').send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Proposta não encontrada</title>
<style>body{font-family:-apple-system,sans-serif;background:#0F172A;color:#F1F5F9;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;margin:0}h1{font-size:24px;margin:16px 0 8px}p{color:#94A3B8;font-size:14px;margin:0}.icon{font-size:48px}</style>
</head><body>
<div class="icon">🔍</div>
<h1>Proposta não encontrada</h1>
<p>O link expirou ou foi removido. Peça pro vendedor enviar novamente.</p>
</body></html>`);
      return;
    }

    // Link rastreado: só proposta solar emitida depois do rastreio (link_rastreado no dados_json).
    // Documento antigo segue servido como sempre, sem evento e sem vencer.
    const dados: Dados = {
      link_rastreado: doc.link_rastreado === true || doc.link_rastreado === 'true',
      link_expira_em: doc.link_expira_em, codigo: doc.codigo,
      vendedor_nome: doc.vendedor_nome, vendedor_whatsapp: doc.vendedor_whatsapp, cliente_nome: doc.cliente_dados,
    };
    const rastreado = doc.tipo === 'propostaSolar' && dados.link_rastreado === true;
    const expiraEm = rastreado && typeof dados.link_expira_em === 'string' ? dados.link_expira_em : null;
    const vencido = rastreado && linkVencido(expiraEm);

    const ua = req.headers['user-agent'];
    const local = geo(req.headers);
    const dispo = dispositivo(ua);
    const cliente = String(doc.cliente_nome || campo(dados.cliente_nome) || '').trim();
    const codigo = campo(dados.codigo);
    // Quem conta como abertura de verdade: nem robô de prévia, nem o dono, nem HEAD/prefetch.
    const contaAbertura = rastreado && !!doc.user_id && req.method !== 'HEAD' && !ehPrefetch(req)
      && !ehRobo(ua) && !(await ehODono(req, doc.user_id));

    if (contaAbertura && doc.user_id) {
      await registrarAbertura({
        userId: doc.user_id, documentId: doc.id, vencido, cliente, codigo, local, dispo,
        chave: chaveAbertura(req.ip, ua, doc.id),
      });
    }

    if (vencido) {
      let empresa: Dados = {};
      if (doc.user_id) {
        try {
          const { data: comp } = await supabase
            .from('company')
            .select('nome, nome_fantasia, socio_adm, whatsapp, logo_base64, cor_marca')
            .eq('user_id', doc.user_id)
            .maybeSingle();
          empresa = (comp ?? {}) as Dados;
        } catch (err) {
          console.error('[public-proposta] empresa da página vencida:', err);
        }
      }
      const empresaNome = campo(empresa.nome_fantasia) || campo(empresa.nome) || 'Proposta';
      res.status(200).type('text/html').setHeader('Cache-Control', 'private, no-store');
      res.send(paginaVencida({
        empresaNome,
        logo: campo(empresa.logo_base64) || null,
        corMarca: campo(empresa.cor_marca) || null,
        vendedor: campo(dados.vendedor_nome) || campo(empresa.socio_adm) || '',
        telefone: campo(dados.vendedor_whatsapp) || campo(empresa.whatsapp) || null,
        codigo: codigo || null,
        vencidaEm: dataBR(expiraEm as string),
      }));
      return;
    }

    let html: string | null = null;
    if (doc.arquivo_url) {
      const { data: signed } = await supabase.storage
        .from('documentos')
        .createSignedUrl(doc.arquivo_url, 60);
      if (signed?.signedUrl) {
        const r = await fetch(signed.signedUrl);
        if (r.ok) html = await r.text();
      }
    }
    if (!html && doc.content) html = String(doc.content);

    if (!html) {
      res.status(500).type('text/plain').send('Proposta indisponível.');
      return;
    }

    // Proposta antiga subiu pro Storage com o script de impressão dentro (o arquivo
    // era compartilhado com o "abrir pra imprimir"). Sem tirar aqui, o cliente que
    // abre o link leva uma caixa de impressão e a aba tentando se fechar sozinha.
    html = stripPrint(html);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // 60s e não 300: o consultor pode reeditar a proposta depois de já ter aberto o
    // link (o que popula o cache) e mandado pro cliente. Cache curto limita a janela
    // em que o cliente ainda veria o valor errado.
    // Link rastreado: sem cache. Com cache na CDN a abertura nem chegaria à função e o
    // vencimento não valeria. Documento antigo mantém o cache curto.
    res.setHeader('Cache-Control', rastreado ? 'private, no-store' : 'public, max-age=60, s-maxage=60');
    res.send(html);
  } catch (err) {
    console.error('[public-proposta] erro:', err);
    res.status(500).type('text/plain').send('Erro ao carregar proposta.');
  }
});

interface Abertura {
  userId: string; documentId: string; vencido: boolean; cliente: string; codigo: string;
  local: ReturnType<typeof geo>; dispo: string;
  chave: string; // HMAC de IP + UA + documento. O IP puro nunca é guardado.
}

/**
 * Grava o evento. Devolve true só quando gravou uma abertura nova: false se a mesma chave
 * (aparelho + proposta) já abriu nos últimos 10 min, ou se o banco falhou.
 */
async function gravarEvento(a: Abertura): Promise<boolean> {
  try {
    const desde = new Date(Date.now() - JANELA_MESMA_ABERTURA_MIN * 60000).toISOString();
    const { data: ja, error: erroBusca } = await supabase
      .from('feature_events')
      .select('id')
      .eq('user_id', a.userId)
      .eq('feature', 'proposta_link')
      .eq('event_data->>chave', a.chave)
      .gte('created_at', desde)
      .limit(1);
    // Se a checagem falhar, grava mesmo assim: perder o alerta é pior que contar uma vez a mais.
    if (!erroBusca && ja && ja.length > 0) return false;

    const { error } = await supabase.from('feature_events').insert({
      user_id: a.userId,
      feature: 'proposta_link',
      event_type: a.vencido ? 'aberta_vencida' : 'aberta',
      event_data: {
        document_id: a.documentId, codigo: a.codigo || null, cliente: a.cliente || null,
        cidade: a.local.cidade, uf: a.local.uf, pais: a.local.pais, dispositivo: a.dispo, chave: a.chave,
      },
    });
    if (error) {
      console.error('[public-proposta] evento não gravado:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[public-proposta] evento não gravado:', err);
    return false;
  }
}

/** Grava o evento e avisa o dono no celular. Nunca lança, e gasta no máximo LIMITE_TOTAL_MS. */
async function registrarAbertura(a: Abertura): Promise<void> {
  const inicio = Date.now();
  const gravou = await comLimite(gravarEvento(a), LIMITE_GRAVAR_MS);
  if (!gravou) return; // repetida, falha ou estouro de tempo: sem aviso
  // O evento já está salvo. O aviso fica com o tempo que sobrou: celular ou serviço de push
  // lento não pode atrasar a proposta do cliente.
  try {
    await comLimite(avisarDono(a), Math.max(0, LIMITE_TOTAL_MS - (Date.now() - inicio)));
  } catch (err) {
    console.error('[public-proposta] aviso falhou:', err);
  }
}

async function avisarDono(a: Abertura): Promise<void> {
  const quem = a.cliente || 'Seu cliente';
  const url = `/historico?doc=${encodeURIComponent(a.documentId)}`;
  // Conta depois de gravar: a abertura de agora já entra nos números.
  const aberturas = () => supabase
    .from('feature_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', a.userId)
    .eq('feature', 'proposta_link')
    .eq('event_data->>document_id', a.documentId);
  let n: number | null = null;
  try {
    const ontem = new Date(Date.now() - 86400000).toISOString();
    const [total, dia] = await Promise.all([aberturas(), aberturas().gte('created_at', ontem)]);
    if (typeof dia.count === 'number' && dia.count > TETO_AVISOS_POR_DIA) return;
    n = typeof total.count === 'number' ? total.count : null;
  } catch (err) {
    console.error('[public-proposta] contagem de aberturas:', err);
  }
  if (a.vencido) {
    await enviarPushAoUsuario(a.userId, {
      title: 'Proposta vencida aberta',
      body: `${quem} abriu a proposta vencida. Bom momento para ligar.`,
      url, tag: `proposta-${a.documentId}`,
    });
    return;
  }
  const lugar = a.local.cidade ? (a.local.uf ? `${a.local.cidade}-${a.local.uf}` : a.local.cidade) : '';
  const partes = [`${quem} abriu sua proposta`, lugar, a.dispo, n ? `${n}ª vez` : ''].filter(Boolean);
  await enviarPushAoUsuario(a.userId, {
    title: 'Proposta aberta', body: partes.join(' · '), url, tag: `proposta-${a.documentId}`,
  });
}

export default router;
