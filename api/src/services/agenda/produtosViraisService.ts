import Anthropic from '@anthropic-ai/sdk';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

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

interface RoteiroAida { gancho: string; falas: { quem: string; texto: string }[]; legenda: string; cta: string; }

// roteiriza um produto no modelo AIDA pra conta de afiliados (NÃO é solar)
export async function roteirizarProdutoAida(p: Produto): Promise<RoteiroAida | null> {
  const sistema = `Você é roteirista de vídeos virais de PRODUTO pra TikTok/Reels (conta de afiliados brasileira, NÃO é energia solar). Apresentador: avatar clone (Thiago) mostrando/recomendando o produto. Tom: empolgado, direto, gente de verdade falando — zero robô. PT-BR coloquial. Use a estrutura AIDA: Atenção (gancho de 3s) → Interesse (o que é/por que viralizou) → Desejo (benefício concreto, prova social das vendas) → Ação (CTA forte). Falas curtas, números por extenso, sem colchetes dentro das falas.`;
  const prompt = `PRODUTO viral do TikTok Shop:
- Nome: ${p.titulo}
- Vendas: ${p.vendas} unidades vendidas (prova social — use!)
- Preço: ${p.preco}${p.desconto ? ` (${p.desconto} de desconto)` : ''}
- Nota: ${p.nota || '—'}
- Categoria: ${p.categoria}

Crie um roteiro AIDA curto (~25-35s) pro avatar apresentar esse produto e fazer o público querer comprar pelo seu link de afiliado.
Responda APENAS com JSON:
{"gancho":"≤12 palavras, choque/curiosidade, sem saudação","falas":[{"quem":"THIAGO","texto":"fala curta, lida literal pela voz, números por extenso, zero colchete"}],"legenda":"legenda + hashtags do nicho do produto","cta":"CTA forte de afiliado (ex: 'corre no link da bio antes que esgote')"}`;
  const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 1500, system: sistema, messages: [{ role: 'user', content: prompt }] });
  const raw = (resp.content[0] as { text: string }).text;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) { logger.warn('produtos-virais', 'roteiro sem JSON', { raw: raw.slice(0, 150) }); return null; }
  try { return JSON.parse(m[0]) as RoteiroAida; }
  catch { logger.warn('produtos-virais', 'JSON inválido'); return null; }
}

// orquestrador do cron 9h: top 3 produtos → roteiro AIDA → grava na fila (canal 'produtos')
export async function gerarProdutosVirais(): Promise<Record<string, any>> {
  // dedup: sold_count é CUMULATIVO (não "do dia"), então os bestsellers repetiriam
  // todo dia. Pulamos product_ids já na fila (qualquer status) → força rotação,
  // cumprindo o "1 produto novo por dia".
  const { data: jaVistos } = await supabaseGerador
    .from('social_studio').select('fonte_url').eq('canal', 'produtos').limit(500);
  const idsVistos = new Set((jaVistos || []).map((r: any) => String(r.fonte_url || '')));

  const candidatos = await topProdutosDoDia(12);  // pega mais pra ter de onde escolher após o dedup
  const produtos = candidatos.filter(p => !idsVistos.has(String(p.link || ''))).slice(0, 3);
  let criados = 0;
  for (const p of produtos) {
    try {
      const rot = await roteirizarProdutoAida(p);
      if (!rot) continue;
      const roteiroTxt = (rot.falas || []).map(f => `${(f.quem || 'THIAGO').toUpperCase()}: ${f.texto}`).join('\n');
      const { error } = await supabaseGerador.from('social_studio').insert({
        canal: 'produtos',
        fonte: 'tiktok_shop',
        fonte_url: p.link,
        tema: p.titulo,
        arquetipo: 'aida',
        gancho: rot.gancho,
        roteiro: roteiroTxt,
        legenda: rot.legenda,
        cta: rot.cta,
        produto_meta: { vendas: p.vendas, preco: p.preco, desconto: p.desconto, nota: p.nota, imagem: p.imagem, categoria: p.categoria },
        status: 'roteirizado',
      });
      if (!error) criados++;
    } catch (e) { logger.warn('produtos-virais', 'falha roteiro produto', e); }
  }
  logger.info('produtos-virais', `gerados ${criados} roteiros de produto`, { produtos: produtos.length });
  return { produtos_encontrados: produtos.length, roteiros_criados: criados };
}
