import Anthropic from '@anthropic-ai/sdk';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { rodarBateria, montaFeedback, ResultadoBateria } from './roteiroBateria';

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

// ─── SYSTEM do roteirista de máxima qualidade (projetado via workflow) ───────
// Regras de texto humano + HeyGen-safe + ponte solar âncora. Verificadas depois
// por bateria de código (warnings v1) + crítico LLM.
const SISTEMA_ROTEIRISTA = `Você é o ROTEIRISTA-CHEFE de conteúdo viral da "Irmãos na Obra", empresa de energia solar do interior de Minas Gerais (Triângulo Mineiro — Uberaba, Araguari, Araxá, Ituiutaba). Os apresentadores são THIAGO e DIEGO, que aparecem como avatares e falam com a VOZ CLONADA deles no HeyGen. O público é adulto, 25-54 anos, dono de casa ou de comércio, querendo baixar a conta de luz. NÃO é engenheiro. Responda SEMPRE em português do Brasil falado, do jeito do interior de Minas.

SUA MISSÃO: receber a transcrição (ou descrição) de um vídeo viral de QUALQUER tema e escrever um roteiro ORIGINAL em cima do que esse vídeo fala, fazendo uma PONTE natural pro nicho de energia solar — na mesma minutagem, com texto que soa 100% gente falando, zero robô.

COMO PENSAR (faça internamente, NÃO mostre): 1) ache a LIÇÃO/PRINCÍPIO do vídeo-fonte (ex: "China baratear carro" → "escala derruba preço") — é isso que vira a ponte, não o assunto literal; 2) escolha 1 arquétipo; 3) rascunhe, releia contra as regras, corrija, só então emita o JSON.

ARQUÉTIPOS (escolha 1): "fernando" = história/bastidor + gancho de TENSÃO contra-intuitiva nos 3s, autoridade que explica o porquê profundo; "larcabral" = listicle NÚMERO+benefício, gera salvamento, CTA de escolha; "lucas" = DESCOBERTA + CTA palavra-chave ("comenta SOLAR que te mando o cálculo").

APRESENTADORES: THIAGO abre com o gancho forte, energia e autoridade; DIEGO complementa com dado/explicação, fecha o raciocínio. Ambos do Triângulo Mineiro, próximos e regionais, SEM jargão.

REGRAS DURAS — TEXTO HUMANO (o sistema verifica):
1. FRASE CURTA, UMA IDEIA: ~12 palavras/fala, no máx 1 subordinada. Humano fala em rajadas curtas.
2. ORALIDADE: use "tá","cê/ocê","pra","né","tipo assim","ó","aí","daí". Pelo menos 1 marca a cada 2 falas.
3. INÍCIO QUEBRADO: não comece TODA fala com sujeito+verbo. "Olha...", "É o seguinte:", "Pera.", "Sabe o que mais?".
4. REPETIÇÃO ENFÁTICA, ao menos 1: "É barato. É barato mesmo." / "Todo mês. TODO mês."
5. PERGUNTA RETÓRICA + AUTORRESPOSTA, ao menos 1: "Sabe quanto dá no ano? Quase um décimo terceiro."
6. NÚMERO POR EXTENSO/APROXIMADO: "uns oitocentos reais", "metade da conta". NUNCA "R$ 800,00", "50%", "1.200".
7. CONECTIVO DE FALA: "aí","então","só que","daí". NUNCA "portanto","dessa forma","sendo assim","ademais".
8. 1-2 AUTOCORREÇÕES FALADAS no total: "a conta vem... ó, vem ALTA". Máx 2.
9. VARIE O TAMANHO DAS FALAS (uma de 3 palavras, outra de 11). Simetria = robô.
10. MINEIRÊS É TEMPERO, não personagem: regional presente, mas não "uai sô trem demais" em toda frase.
11. SEM JARGÃO: nada de "kWp","inversor on-grid","compensação de energia","TUSD". Traduza pra "a conta cai".

REGRA CRÍTICA DO HEYGEN: o campo "falas[].texto" é LIDO LITERALMENTE pela voz clonada. NUNCA coloque [pausa], [respira], [corte], [0-3s] ou qualquer colchete dentro de "texto" — a voz leria "colchete pausa" em voz alta. TODA direção/b-roll/marca de tempo mora SÓ no campo "roteiro". Dentro de "texto" só pontuação TTS-safe: vírgula, reticências..., ponto, travessão —, ? e !.

GANCHO (0-3s): máx 12 palavras. SEM saudação ("oi","olá","fala galera","pessoal","e aí"), SEM "hoje vim falar"/"vou mostrar", SEM o nome da empresa. Tem que criar TENSÃO/CURIOSIDADE e fazer sentido como primeira coisa ouvida.

PONTE SOLAR: entra SÓ depois de ~60-70% do tempo, NUNCA no gancho. OBRIGATÓRIO citar um elemento ESPECÍFICO da transcrição-fonte (marca, número, nome, situação) — ponte por ANALOGIA DE PRINCÍPIO, não mudança de assunto. Regionalize quando couber. UMA ponte só, com força, e vai pro CTA — não martele "solar solar solar". TESTE: se a ponte e o fechamento serviriam colados em QUALQUER outro vídeo sem trocar palavra, está GENÉRICA — refaça amarrando no conteúdo específico.

Emita SEMPRE e SÓ um objeto JSON válido no formato pedido. Sem texto antes ou depois.`;

// pesos canônicos dos blocos (proporcionais à duração medida)
const BLOCOS_PESO: Array<[string, number]> = [
  ['gancho', 0.09], ['contexto', 0.22], ['desenvolvimento', 0.38], ['ponte_solar', 0.23], ['cta', 0.08],
];
const WPS_FALLBACK = 2.2; // palavras/seg de Reel PT-BR COM pausas/respiração (calibrado: 2.7 era alto, IA escrevia mais enxuto)

// extrai 2-3 entidades da transcrição pra forçar âncora na ponte
function extrairEntidades(texto: string): string[] {
  if (!texto) return [];
  const caps = (texto.match(/(?<![.!?]\s)(?<!^)\b[A-ZÀ-Ý][a-zà-ý]{2,}\b/g) || []);
  const nums = (texto.match(/\b\d{2,}\b/g) || []);
  const uniq = Array.from(new Set([...caps, ...nums]));
  return uniq.slice(0, 3);
}

// Extrai o ID de um vídeo do YouTube de várias formas de URL.
function youtubeId(url: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Transcrição real de um vídeo do YouTube via legendas (validado do IP Vercel).
// Retorna {texto, duracaoSeg} — a duração vem do offset+duration do último
// segmento (a lib dá em ms), usada pra ancorar a minutagem do roteiro.
// Null se não houver legenda. Caminho leve: sem baixar vídeo nem Whisper.
// TikTok/IG não suportados aqui (sem legenda pública).
export async function transcreverYoutube(url: string): Promise<{ texto: string; duracaoSeg: number } | null> {
  const id = youtubeId(url);
  if (!id) return null;
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    let t;
    try { t = await YoutubeTranscript.fetchTranscript(id, { lang: 'pt-BR' } as any); }
    catch { t = await YoutubeTranscript.fetchTranscript(id); }
    if (!t || !t.length) return null;
    const txt = t.map((x: any) => x.text).join(' ').replace(/\s+/g, ' ').trim();
    const ultimo: any = t[t.length - 1];
    const duracaoSeg = Math.round(((ultimo.offset || 0) + (ultimo.duration || 0)) / 1000);
    return txt.length > 20 ? { texto: txt.slice(0, 6000), duracaoSeg } : null;
  } catch (e) {
    logger.warn('social-roteiro', 'transcrição YouTube falhou', { url, e: String(e).slice(0, 120) });
    return null;
  }
}

// Transcreve um vídeo enviado pelo usuário (URL do Supabase Storage) via Whisper
// e roteiriza em cima. Usado quando o link do YouTube não transcreve em prod.
// Retorna o roteiro, ou {erro} se o Whisper falhar (sem saldo / >25MB / formato).
export async function roteirizarUpload(videoUrl: string, apresentador?: string): Promise<Roteiro | { erro: string } | null> {
  const { transcribeAudio } = await import('../../utils/mediaProcessor');
  // mime por extensão do arquivo (Whisper detecta formato pelo nome/mime)
  const ext = (videoUrl.split('?')[0].split('.').pop() || 'mp4').toLowerCase();
  const mime = ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
  let txt: string | null = null;
  try {
    txt = await transcribeAudio(videoUrl, mime);
  } catch (e) {
    logger.warn('social-roteiro', 'whisper upload falhou', { e: String(e).slice(0, 120) });
  }
  if (!txt || txt.trim().length < 20) {
    // Whisper nulo: sem saldo OpenAI, vídeo >25MB, ou formato. Degrada honesto.
    return { erro: 'transcricao_upload_falhou' };
  }
  const r = await roteirizarTema(txt.slice(0, 200), undefined, apresentador, txt);
  return r as any;
}

// ─── Fluxo 2: roteirizar UM tema-isca (estúdio) ─────────────────────────────
// Recebe um tema (e opcionalmente o link do vídeo viral de origem) e devolve
// um roteiro pronto no DNA viral, com ponte pro nicho solar. Se a fonte for um
// vídeo do YouTube, transcreve o conteúdo real e usa no prompt (entende o vídeo).
export async function roteirizarTema(tema: string, fonteUrl?: string, apresentador?: string, transcricaoPronta?: string): Promise<Roteiro | { erro: string; ehYoutube?: boolean } | null> {
  const resumo = await topPostsResumo('instagram');
  const quem = (apresentador || 'ambos').toLowerCase(); // 'thiago' | 'diego' | 'ambos'

  // entende o vídeo de verdade (transcrição + duração real do YouTube)
  let transcricao: string | null = null;
  let duracaoSeg = 35;
  let minutagemConfianca: 'alta' | 'baixa' = 'baixa';
  let fonteDuracao = 'estimado';
  const link = fonteUrl || (/^https?:\/\//i.test(tema) ? tema : undefined);
  if (transcricaoPronta && transcricaoPronta.trim().length > 20) {
    // veio do UPLOAD já transcrito (Whisper) — usa direto, estima duração pela fala
    transcricao = transcricaoPronta.slice(0, 6000);
    const pal = transcricao.trim().split(/\s+/).length;
    duracaoSeg = Math.min(60, Math.max(8, Math.round(pal / WPS_FALLBACK)));
    fonteDuracao = 'upload_whisper';
  } else if (link) {
    const tr = await transcreverYoutube(link);
    if (tr) {
      transcricao = tr.texto;
      // Reel/Short vive em 20-60s. Vídeo-fonte longo (ex: 4min) NÃO vira Reel de 4min —
      // capamos o alvo em 60s (a transcrição inteira ainda alimenta o contexto).
      const real = Math.max(8, tr.duracaoSeg || 35);
      duracaoSeg = Math.min(60, real);
      fonteDuracao = real > 60 ? 'youtube_capado_60s' : 'youtube_transcript';
      minutagemConfianca = 'baixa'; // alvo capado = estimativa por taxa, não contagem bruta
    } else {
      // veio um LINK mas não conseguimos transcrever (sem legenda OU YouTube
      // bloqueou o IP da Vercel). NÃO roteirizar com a URL crua como tema —
      // isso gera lixo. Degrada honesto: pede descrição ao usuário.
      const ehYoutube = !!youtubeId(link);
      return { erro: 'transcricao_indisponivel', ehYoutube } as any;
    }
  }

  // palavras-alvo (âncora de minutagem): como a duração é sempre capada a ≤60s
  // pra virar Reel, usamos a taxa de locução (2.7 w/s) sobre a duração-alvo.
  const palavrasAlvo = Math.round(duracaoSeg * WPS_FALLBACK);

  // orçamento por bloco proporcional à duração
  let acc = 0;
  const orcamento = BLOCOS_PESO.map(([nome, peso]) => {
    const ini = Math.round(duracaoSeg * acc); acc += peso;
    const fim = Math.round(duracaoSeg * acc);
    return { nome, faixa: `${ini}-${fim}s`, palavras: Math.round(palavrasAlvo * peso) };
  });
  const orcamentoTxt = orcamento.map(b => `[${b.faixa}] ${b.nome}: ~${b.palavras} palavras`).join('\n');
  const entidades = extrairEntidades(transcricao || tema);

  const blocoFonte = transcricao
    ? `CONTEÚDO REAL do vídeo (transcrição — entenda do que ele fala e ache a LIÇÃO pra fazer a ponte):\n"""${transcricao}"""`
    : `TEMA/DESCRIÇÃO do vídeo (sem transcrição — TikTok/IG ou texto livre):\n"${tema}"`;

  const instrApres = quem === 'ambos'
    ? 'Diálogo entre THIAGO e DIEGO alternando. Thiago abre o gancho, Diego traz o dado, fecham juntos.'
    : `Monólogo: TODAS as falas são de ${quem.toUpperCase()}. ${quem === 'thiago' ? 'Energia e autoridade, abre forte.' : 'Clareza no dado/explicação.'}`;

  const prompt = `${DNA_VIRAL}

APRESENTADOR(ES): ${quem.toUpperCase()}
${instrApres}

═══ O QUE JÁ FUNCIONA NA CONTA (aprenda o tom real) ═══
${resumo}

═══ VÍDEO-FONTE ═══
${blocoFonte}

═══ MINUTAGEM (obedeça aos NÚMEROS, o sistema conta e reprova fora de ±12%) ═══
Duração-alvo: ${duracaoSeg}s. Total de palavras faladas: ~${palavrasAlvo}.
Orçamento por bloco (some as falas de cada bloco perto destes números):
${orcamentoTxt}
As marcas de tempo [0-3s]... vão SÓ no campo "roteiro", NUNCA dentro das falas.

═══ ÂNCORA DA PONTE (obrigatória) ═══
Elementos citados no vídeo-fonte: ${entidades.length ? entidades.join(', ') : '(use o tema específico)'}
A ponte pro solar TEM que reaproveitar pelo menos UM desses por analogia de princípio. Diga qual em "ancora_reusada".

Responda APENAS com objeto JSON válido:
{"arquetipo":"fernando|larcabral|lucas","gancho":"≤12 palavras, sem saudação/nome da empresa","falas":[{"quem":"THIAGO","texto":"texto lido literal pela voz — só pontuação, zero colchete, números por extenso"}],"roteiro":"direção/b-roll/cortes COM as marcas [0-3s]... e [pausa] etc — tudo que NÃO é falado","legenda":"legenda + 1-2 hashtags","cta":"CTA palavra-chave (ex: comenta SOLAR que te mando o cálculo)","ancora_reusada":"qual entidade do vídeo a ponte reusou"}`;

  // ── Loop GERAR → BATERIA → REGENERAR (teto 1 regen) ──
  let r: Roteiro | null = null;
  let bateria: ResultadoBateria | null = null;
  let tentativas = 0;
  let feedback = '';
  for (let i = 0; i < 2; i++) {
    tentativas++;
    const p = feedback ? `${prompt}\n\n═══ CORREÇÃO OBRIGATÓRIA ═══\n${feedback}` : prompt;
    const raw = await chamarClaude(SISTEMA_ROTEIRISTA, p, 3000);
    const cand = extrairJson<Roteiro>(raw, 'social-roteiro');
    if (!cand) continue;
    r = cand;
    bateria = rodarBateria(cand.falas || [], cand.gancho || '', palavrasAlvo);
    if (bateria.passou) break;          // sem hard-fail → entrega
    feedback = montaFeedback(bateria.hardFails, palavrasAlvo);  // regenera 1x
  }
  if (!r) return null;

  (r as any).transcrito = !!transcricao;
  // devolve a transcrição (recortada) pra o front exibir — o usuário quer VER
  // do que o vídeo fala antes/junto do roteiro. Null se não houve transcrição.
  (r as any).transcricao = transcricao ? transcricao.slice(0, 2000) : null;
  (r as any).ancora_reusada = (r as any).ancora_reusada || null;
  (r as any).minutagem = {
    duracao_alvo_s: duracaoSeg, palavras_alvo: palavrasAlvo,
    palavras_geradas: (r.falas || []).reduce((s, f) => s + (f.texto || '').trim().split(/\s+/).length, 0),
    fonte_duracao: fonteDuracao, minutagem_confianca: minutagemConfianca,
  };
  (r as any).qa = {
    tentativas,
    gates_passed: bateria?.passou ?? false,
    warnings: (bateria?.warnings || []).map(w => w.regra),
    relatorio: bateria?.relatorio || '',
  };
  // se ainda reprovou após o teto, marca pra revisão humana (nunca shippa silencioso)
  (r as any).precisa_revisao_humana = !(bateria?.passou ?? false);
  (r as any).gates_falhados = (bateria?.hardFails || []).map(h => h.regra);
  return r;
}
