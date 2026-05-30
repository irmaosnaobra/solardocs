import Anthropic from '@anthropic-ai/sdk';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

// IA de conteúdo da aba "Redes" do /gerador. Duas frentes que compartilham
// o MESMO core (client Anthropic + extração de JSON):
//   1) gerarIdeiasSociais  — ideias soltas ancoradas nos top posts reais
//   2) roteirizarTema      — pega 1 tema-isca e gera roteiro no DNA viral (estúdio)
// Ambas dependem de créditos Anthropic (ANTHROPIC_API_KEY já no ambiente).

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

// ─── DNA viral decodificado de criadores reais (referência do roteirizador) ──
// Mantido aqui pra os dois fluxos usarem o mesmo "cérebro".
const DNA_VIRAL = `DNA de conteúdo viral (3 arquétipos comprovados, adapte ao tema):
- FERNANDO MIRANDA (history/bastidor + gancho de TENSÃO): abre com afirmação contra-intuitiva nos 3s ("A X não caiu porque você pensa... foi por Z"), pega QUALQUER assunto e extrai uma lição, tom de autoridade que explica o "porquê profundo". Ex p/ solar: "A conta de luz não subiu por causa da seca. Subiu por um motivo que ninguém te conta...".
- LAR.CABRAL (listicle de obra/casa): gancho NÚMERO+benefício ("7 acertos no telhado que economizam energia"), gera salvamento, CTA de escolha ("qual você faria?"). Público dono de casa/obra.
- LUCAS ARRIAL (descoberta + CTA palavra-chave): mostra algo que a pessoa não sabia + CTA "comenta SOLAR que te mando o cálculo" pra explodir comentários.
Regra de ouro do Thiago: pode partir de QUALQUER tema viral (ferramentas, construção, telhado, acidentes elétricos, empresas de sucesso, notícias, China/carro elétrico) e construir uma PONTE pro nicho de energia solar.`;

const SISTEMA_BASE = `Você é o roteirista-chefe de conteúdo viral da "Irmãos na Obra", empresa de energia solar do interior de Minas Gerais (Triângulo Mineiro — Uberaba, Araguari, Araxá, Ituiutaba). Os apresentadores são Thiago e Diego (avatares). Público: adultos 25-54, donos de casa/comércio que querem reduzir a conta de luz. Tom: próximo, direto, regional, autoridade sem jargão técnico. Responda SEMPRE em português do Brasil.`;

// Core: chama Claude e devolve o texto cru.
async function chamarClaude(sistema: string, prompt: string, maxTokens = 1500): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: sistema,
    messages: [{ role: 'user', content: prompt }],
  });
  return (response.content[0] as { text: string }).text;
}

// Core: extrai um array OU objeto JSON da resposta, mesmo cercado de texto/```.
function extrairJson<T>(raw: string, ctx: string): T | null {
  const m = raw.match(/[\[{][\s\S]*[\]}]/);
  if (!m) { logger.warn(ctx, 'resposta sem JSON', { raw: raw.slice(0, 200) }); return null; }
  try { return JSON.parse(m[0]) as T; }
  catch { logger.warn(ctx, 'JSON inválido', { raw: m[0].slice(0, 200) }); return null; }
}

// Resumo dos top posts reais (ancora os dois fluxos no que JÁ funciona).
async function topPostsResumo(rede: string): Promise<string> {
  const { data: posts } = await supabaseGerador
    .from('social_posts')
    .select('legenda, likes, comentarios, alcance, views, engajamento')
    .eq('rede', rede)
    .order('engajamento', { ascending: false })
    .limit(8);
  return (posts || [])
    .filter(p => p.legenda)
    .map((p, i) => `${i + 1}. "${String(p.legenda).slice(0, 120)}" — ${p.likes || 0} likes, ${p.comentarios || 0} coments, ${p.alcance || p.views || 0} alcance`)
    .join('\n') || '(sem histórico suficiente — use boas práticas do nicho de energia solar no interior de MG)';
}

interface Ideia { formato: string; titulo: string; gancho: string; roteiro: string; legenda: string; }

// ─── Fluxo 1: ideias soltas (botão "Gerar ideias") ──────────────────────────
export async function gerarIdeiasSociais(rede: string): Promise<Ideia[]> {
  const r = rede === 'tiktok' ? 'tiktok' : 'instagram';
  const resumo = await topPostsResumo(r);
  const prompt = `${DNA_VIRAL}

Posts que MAIS engajaram na conta real:
${resumo}

Gere 4 ideias NOVAS de ${r === 'tiktok' ? 'vídeos para TikTok' : 'Reels para Instagram'}, frescas e variadas, no DNA acima.
Responda APENAS com array JSON válido:
[{"formato":"Reel 15-30s","titulo":"...","gancho":"frase que segura nos 3s","roteiro":"o que mostrar/falar","legenda":"legenda + 1-2 hashtags"}]`;
  const raw = await chamarClaude(SISTEMA_BASE, prompt);
  const arr = extrairJson<Ideia[]>(raw, 'social-ideias');
  return Array.isArray(arr) ? arr.slice(0, 6) : [];
}

interface Fala { quem: string; texto: string; }
interface Roteiro { arquetipo: string; gancho: string; falas?: Fala[]; roteiro: string; legenda: string; cta: string; }

// Perfil dos apresentadores — guia a IA a escrever no estilo de cada um.
// Base neutra por ora; será refinada quando Thiago descrever cada um e quando
// casarmos com os avatares/vozes reais do HeyGen (via MCP).
const PERFIL_APRESENTADORES = `APRESENTADORES (os avatares que vão falar o roteiro):
- THIAGO: sócio da Irmãos na Obra, energia e autoridade. Costuma ABRIR o vídeo com o gancho forte, fala direto com o público, tom de quem entende do assunto.
- DIEGO: sócio, complementa com o dado/explicação/bastidor. Entra reforçando o que o Thiago abriu, fecha raciocínio.
Ambos são do interior de Minas (Triângulo Mineiro), falam de forma próxima e regional, sem jargão técnico. Aprenda o tom REAL deles pelos posts abaixo.`;

// Extrai o ID de um vídeo do YouTube de várias formas de URL.
function youtubeId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Transcrição real de um vídeo do YouTube via legendas (validado do IP Vercel).
// Retorna o texto falado, ou null se não houver legenda/falhar. Caminho leve:
// sem baixar vídeo nem Whisper. TikTok/IG não suportados aqui (sem legenda pública).
export async function transcreverYoutube(url: string): Promise<string | null> {
  const id = youtubeId(url);
  if (!id) return null;
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    let t;
    try { t = await YoutubeTranscript.fetchTranscript(id, { lang: 'pt-BR' } as any); }
    catch { t = await YoutubeTranscript.fetchTranscript(id); }
    const txt = t.map((x: any) => x.text).join(' ').replace(/\s+/g, ' ').trim();
    return txt.length > 20 ? txt.slice(0, 6000) : null;
  } catch (e) {
    logger.warn('social-roteiro', 'transcrição YouTube falhou', { url, e: String(e).slice(0, 120) });
    return null;
  }
}

// ─── Fluxo 2: roteirizar UM tema-isca (estúdio) ─────────────────────────────
// Recebe um tema (e opcionalmente o link do vídeo viral de origem) e devolve
// um roteiro pronto no DNA viral, com ponte pro nicho solar. Se a fonte for um
// vídeo do YouTube, transcreve o conteúdo real e usa no prompt (entende o vídeo).
export async function roteirizarTema(tema: string, fonteUrl?: string, apresentador?: string): Promise<Roteiro | null> {
  const resumo = await topPostsResumo('instagram');
  const quem = (apresentador || 'ambos').toLowerCase(); // 'thiago' | 'diego' | 'ambos'

  // tenta entender o vídeo de verdade (transcrição do YouTube)
  let transcricao: string | null = null;
  const link = fonteUrl || (/^https?:\/\//i.test(tema) ? tema : undefined);
  if (link) transcricao = await transcreverYoutube(link);

  const blocoFonte = transcricao
    ? `CONTEÚDO REAL do vídeo de origem (transcrição — use pra entender do que ele fala e fazer a ponte certa):\n"""${transcricao}"""`
    : `TEMA-ISCA a transformar em vídeo: "${tema}"${link ? `\n(vídeo de origem: ${link} — sem transcrição disponível, use o tema)` : ''}`;

  const prompt = `${DNA_VIRAL}

${PERFIL_APRESENTADORES}

O que já funciona na conta real (aprenda o jeito de escrever/falar deles):
${resumo}

${blocoFonte}

${quem === 'ambos'
  ? `Crie UM roteiro de Reel/Short curto (~30-45s) apresentado por THIAGO e DIEGO em diálogo, partindo desse conteúdo e fazendo a PONTE pro nicho de energia solar. Escolha o arquétipo (fernando | larcabral | lucas).

REGRAS DE FALA:
- Divida em FALAS marcadas com quem fala (THIAGO ou DIEGO).
- Cada fala é o texto EXATO que o avatar vai dizer (gerado no HeyGen com a voz clonada de cada um) — natural, como gente fala.
- Thiago abre o gancho; Diego entra com o contexto/dado; alternem. CTA no fim por um dos dois.
- Falas curtas e diretas, tom regional de Minas, sem jargão técnico.`
  : `Crie UM roteiro de Reel/Short curto (~30-45s) apresentado SÓ POR ${quem.toUpperCase()} (monólogo, ele falando direto pra câmera), partindo desse conteúdo e fazendo a PONTE pro nicho de energia solar. Escolha o arquétipo (fernando | larcabral | lucas).

REGRAS DE FALA:
- TODAS as falas são de ${quem.toUpperCase()} (será gerado no HeyGen com a voz clonada dele) — natural, como gente fala.
- Divida em blocos curtos de fala (cada bloco = uma cena/respiração), todos marcados com "${quem.toUpperCase()}".
- ${quem === 'thiago' ? 'Thiago: energia e autoridade, abre forte.' : 'Diego: traz o dado/explicação com clareza.'} Tom regional de Minas, sem jargão. CTA no fim.`}

Responda APENAS com objeto JSON válido:
{"arquetipo":"fernando|larcabral|lucas","gancho":"primeira frase do Thiago (3s)","falas":[{"quem":"THIAGO","texto":"..."},{"quem":"DIEGO","texto":"..."}],"roteiro":"resumo do que mostrar na tela (b-roll, cortes)","legenda":"legenda pronta + hashtags","cta":"chamada final"}`;
  const raw = await chamarClaude(SISTEMA_BASE, prompt);
  const r = extrairJson<Roteiro>(raw, 'social-roteiro');
  // anexa flag de transcrição pro front saber que "entendeu o vídeo"
  if (r) (r as any).transcrito = !!transcricao;
  return r;
}
