import Anthropic from '@anthropic-ai/sdk';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { dispararVideoProduto, temHiggsfield } from './higgsfieldService';

// MÁQUINA 2 do Estúdio: produtos virais do TikTok Shop → roteiro AIDA pra conta
// de afiliados (separada do solar). Fonte: SociaVault Shop Search por categoria
// (popular-videos da SociaVault é instável — depende do TikTok Creative Center).
// Cron 9h busca categorias, pega os mais vendidos, roteiriza, grava na fila.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';
const SOCIAVAULT = 'https://api.sociavault.com/v1/scrape';
const SV_KEY = process.env.SOCIAVAULT_API_KEY || '';

// categorias buscadas no Shop Search (Thiago: casa/cozinha, beleza, gadgets, fitness)
const CATEGORIAS = ['cozinha', 'beleza', 'gadgets', 'fitness'];

interface Produto {
  product_id: string;
  titulo: string;
  vendas: number;
  preco: string;
  desconto: string | null;
  nota: number | null;
  imagem: string | null;
  link: string | null;
  categoria: string;
}

// busca produtos de uma categoria no TikTok Shop (BR) via SociaVault
async function buscarCategoria(query: string): Promise<Produto[]> {
  if (!SV_KEY) throw new Error('SOCIAVAULT_API_KEY ausente');
  const url = `${SOCIAVAULT}/tiktok-shop/search?query=${encodeURIComponent(query)}&region=BR`;
  const r = await fetch(url, { headers: { 'X-API-Key': SV_KEY } });
  if (!r.ok) { logger.warn('produtos-virais', `SociaVault ${query} HTTP ${r.status}`); return []; }
  const j = await r.json() as any;
  const prods = j?.data?.products ? Object.values(j.data.products) : [];
  return (prods as any[]).map((p) => {
    const pi = p.product_price_info || {};
    const sym = pi.currency_symbol || 'R$';
    return {
      product_id: String(p.product_id || ''),
      titulo: p.title || '',
      vendas: Number(p.sold_info?.sold_count || 0),
      preco: pi.sale_price_format ? `${sym} ${(Number(pi.sale_price_format) / 100).toFixed(2)}` : '',
      desconto: pi.discount_format || null,
      nota: p.rate_info?.score ?? null,
      imagem: p.image?.url_list?.['0'] || null,
      link: p.seo_url?.canonical_url || null,
      categoria: query,
    } as Produto;
  }).filter(p => p.product_id && p.vendas > 0);
}

// pega os top N produtos do dia (mais vendidos entre as categorias)
export async function topProdutosDoDia(n = 3): Promise<Produto[]> {
  const todos: Produto[] = [];
  for (const cat of CATEGORIAS) {
    try { todos.push(...await buscarCategoria(cat)); }
    catch (e) { logger.warn('produtos-virais', `falha categoria ${cat}`, e); }
  }
  // ordena por mais vendido e pega o top, evitando 2 da mesma categoria seguidos
  todos.sort((a, b) => b.vendas - a.vendas);
  // dedup por product_id e devolve os n mais vendidos (sem limite rígido por
  // categoria quando n é grande — o dedup de fila no orquestrador cuida da rotação)
  const out: Produto[] = [];
  const ids = new Set<string>();
  for (const p of todos) {
    if (ids.has(p.product_id)) continue;
    ids.add(p.product_id); out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

interface RoteiroAida { gancho: string; prompt_higgsfield: string; legenda: string; cta: string; }

// roteiriza um produto pra conta de afiliados (NÃO é solar, NÃO usa avatar/clone).
// A modelagem do vídeo é feita no Higgsfield, RECRIANDO um anúncio viral do produto —
// sem rosto, sem clone. A saída é um PROMPT de geração de vídeo (ancorado na imagem do
// produto) + legenda + CTA de afiliado. A lógica AIDA mora em como moldamos gancho/legenda/cta.
export async function roteirizarProdutoAida(p: Produto): Promise<RoteiroAida | null> {
  const sistema = `Você é diretor de criativos de vídeos virais de PRODUTO pra TikTok/Reels (conta de afiliados brasileira, NÃO é energia solar). O vídeo será GERADO NO HIGGSFIELD (IA de vídeo) recriando um anúncio viral do produto — SEM pessoa, SEM rosto, SEM avatar falando: é um anúncio de produto no estilo TikTok Shop (produto em uso, close nos detalhes, antes/depois, b-roll de mão usando o produto, texto na tela). Sua saída principal é um PROMPT de geração de vídeo em INGLÊS (Higgsfield responde melhor em inglês), rico em descrição de cena, ancorado na IMAGEM do produto como referência visual. Use a lógica AIDA pra moldar o ritmo: Atenção (3s de gancho visual forte) → Interesse (o que é / por que chama atenção) → Desejo (benefício mostrado em uso, prova social das vendas como texto na tela) → Ação (frame final com CTA). O gancho, a legenda e o CTA saem em PT-BR coloquial.`;
  const prompt = `PRODUTO viral do TikTok Shop:
- Nome: ${p.titulo}
- Vendas: ${p.vendas} unidades vendidas (prova social — vire texto na tela)
- Preço: ${p.preco}${p.desconto ? ` (${p.desconto} de desconto)` : ''}
- Nota: ${p.nota || '—'}
- Categoria: ${p.categoria}
- Imagem de referência (use como âncora visual do produto): ${p.imagem || '—'}

Crie a modelagem de um anúncio viral curto (~20-30s) desse produto pra recriar no Higgsfield e fazer o público comprar pelo link de afiliado.
O "prompt_higgsfield" deve: (1) estar em inglês; (2) descrever cena a cena um anúncio de produto vertical 9:16 estilo TikTok Shop, sem pessoas faladas/avatar; (3) instruir explicitamente a usar a imagem do produto como referência ("use the provided product image as the exact visual reference for the product"); (4) funcionar tanto se o Higgsfield for image-to-video (imagem = seed) quanto text-to-video (descrição completa); (5) incluir onde entram os textos na tela (gancho, número de vendas, preço, CTA).
Responda APENAS com JSON:
{"gancho":"PT-BR, ≤12 palavras, choque/curiosidade, sem saudação — vira o texto na tela do 1º frame","prompt_higgsfield":"prompt em inglês, descrição rica de cena a cena de um anúncio de produto vertical 9:16, ancorado na imagem do produto, sem avatar/pessoa falando","legenda":"PT-BR, legenda + hashtags do nicho do produto","cta":"PT-BR, CTA forte de afiliado (ex: 'corre no link da bio antes que esgote')"}`;
  const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 1500, system: sistema, messages: [{ role: 'user', content: prompt }] });
  const raw = (resp.content[0] as { text: string }).text;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) { logger.warn('produtos-virais', 'roteiro sem JSON', { raw: raw.slice(0, 150) }); return null; }
  try { return JSON.parse(m[0]) as RoteiroAida; }
  catch { logger.warn('produtos-virais', 'JSON inválido'); return null; }
}

// orquestrador do cron: TOP 1 produto do dia → roteiro → INSERT → dispara vídeo
// automático no Higgsfield (sem aprovação). Decisão Thiago: 1 vídeo/dia (1 crédito),
// bate com "1 produto novo por dia".
export async function gerarProdutosVirais(): Promise<Record<string, any>> {
  // dedup: sold_count é CUMULATIVO (não "do dia"), então os bestsellers repetiriam
  // todo dia. Pulamos product_ids já na fila (qualquer status) → força rotação,
  // cumprindo o "1 produto novo por dia".
  const { data: jaVistos } = await supabaseGerador
    .from('social_studio').select('fonte_url').eq('canal', 'produtos').limit(500);
  const idsVistos = new Set((jaVistos || []).map((r: any) => String(r.fonte_url || '')));

  const candidatos = await topProdutosDoDia(12);  // pega mais pra ter de onde escolher após o dedup
  const produtos = candidatos.filter(p => !idsVistos.has(String(p.link || ''))).slice(0, 1); // TOP 1
  let criados = 0, videosDisparados = 0;
  for (const p of produtos) {
    try {
      const rot = await roteirizarProdutoAida(p);
      if (!rot) continue;
      // estado inicial do vídeo: 'gerando' se tem HF key (vai disparar já),
      // senão null (fica como texto até a key existir).
      const videoStatusInicial = temHiggsfield() ? 'gerando' : null;
      const { data: inserted, error } = await supabaseGerador.from('social_studio').insert({
        canal: 'produtos',
        fonte: 'tiktok_shop',
        fonte_url: p.link,
        tema: p.titulo,
        arquetipo: 'aida',
        gancho: rot.gancho,
        roteiro: rot.prompt_higgsfield,
        legenda: rot.legenda,
        cta: rot.cta,
        produto_meta: { vendas: p.vendas, preco: p.preco, desconto: p.desconto, nota: p.nota, imagem: p.imagem, categoria: p.categoria },
        video_status: videoStatusInicial,
        status: 'roteirizado',
      }).select('id').single();
      if (error || !inserted) { logger.warn('produtos-virais', 'INSERT falhou', error); continue; }
      criados++;
      // dispara o vídeo automático (image-to-video ancorado na imagem do produto).
      // Não bloqueia o resultado do cron se falhar — dispararVideoProduto é honesto.
      const d = await dispararVideoProduto({ prompt: rot.prompt_higgsfield, imagemUrl: p.imagem, rowId: inserted.id });
      if (d.ok) videosDisparados++;
    } catch (e) { logger.warn('produtos-virais', 'falha roteiro produto', e); }
  }
  logger.info('produtos-virais', `gerados ${criados} roteiros, ${videosDisparados} vídeos disparados`, { produtos: produtos.length });
  return { produtos_encontrados: produtos.length, roteiros_criados: criados, videos_disparados: videosDisparados, tem_hf_key: temHiggsfield() };
}

// re-dispara o vídeo de uma linha existente (botão "Tentar de novo" no front).
export async function redispararVideoProduto(rowId: number): Promise<{ ok: boolean; motivo?: string }> {
  const { data: rows } = await supabaseGerador.from('social_studio')
    .select('id, roteiro, produto_meta, canal').eq('id', rowId).limit(1);
  const row = rows?.[0] as any;
  if (!row || row.canal !== 'produtos') return { ok: false, motivo: 'linha_invalida' };
  return dispararVideoProduto({ prompt: row.roteiro || '', imagemUrl: row.produto_meta?.imagem || null, rowId });
}
