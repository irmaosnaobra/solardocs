import Anthropic from '@anthropic-ai/sdk';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

// Gera ideias de Reels/vídeos de energia solar para a Irmãos na Obra,
// ancoradas nos posts que MAIS performaram na conta real (via social_posts,
// populado pelo socialWindsorService). Usado pela aba "Redes" do /gerador.

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface Ideia {
  formato: string;
  titulo: string;
  gancho: string;
  roteiro: string;
  legenda: string;
}

export async function gerarIdeiasSociais(rede: string): Promise<Ideia[]> {
  const r = rede === 'tiktok' ? 'tiktok' : 'instagram';

  // Top posts reais pra ancorar o prompt (o que JÁ funciona nessa conta)
  const { data: posts } = await supabaseGerador
    .from('social_posts')
    .select('legenda, likes, comentarios, alcance, views, salvos, compart, engajamento')
    .eq('rede', r)
    .order('engajamento', { ascending: false })
    .limit(8);

  const topResumo = (posts || [])
    .filter(p => p.legenda)
    .map((p, i) => `${i + 1}. "${String(p.legenda).slice(0, 120)}" — ${p.likes || 0} likes, ${p.comentarios || 0} comentários, ${p.alcance || p.views || 0} de alcance`)
    .join('\n') || '(sem histórico suficiente — use boas práticas do nicho de energia solar no interior de MG)';

  const sistema = `Você é um especialista em conteúdo viral para Instagram e TikTok no nicho de ENERGIA SOLAR, atuando para a "Irmãos na Obra", uma empresa de energia solar do interior de Minas Gerais (Triângulo Mineiro — Uberaba, Araguari, Araxá, Ituiutaba e região). O público é majoritariamente adulto 25-54, donos de casa/comércio que querem reduzir a conta de luz. Tom: próximo, direto, regional, sem jargão técnico. Responda SEMPRE em português do Brasil.`;

  const prompt = `Estes são os posts que MAIS engajaram na conta real (analise o DNA do que funciona — formato, gancho, tema):
${topResumo}

Gere 4 ideias NOVAS de ${r === 'tiktok' ? 'vídeos para TikTok' : 'Reels para Instagram'} de energia solar, no mesmo DNA do que já dá certo, mas frescas e variadas (depoimento de cliente, antes/depois de conta de luz, mito x verdade, bastidor de instalação, pergunta que gera comentário).

Responda APENAS com um array JSON válido, sem texto fora do JSON, neste formato exato:
[{"formato":"Reel 15-30s","titulo":"...","gancho":"primeira frase que segura nos 3s","roteiro":"o que mostrar/falar, curto","legenda":"legenda pronta com 1-2 hashtags do nicho"}]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: sistema,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = (response.content[0] as { text: string }).text;
  // Extrai o array JSON mesmo se vier cercado de texto/```json
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) {
    logger.warn('social-ideias', 'resposta sem JSON', { raw: raw.slice(0, 200) });
    return [];
  }
  try {
    const arr = JSON.parse(m[0]) as Ideia[];
    return Array.isArray(arr) ? arr.slice(0, 6) : [];
  } catch (e) {
    logger.warn('social-ideias', 'JSON inválido', { raw: m[0].slice(0, 200) });
    return [];
  }
}
