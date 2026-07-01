// ─────────────────────────────────────────────────────────────────────────────
// Bia — inbound conversacional da recuperação de checkout LimpaPro (linha 'recuperacao').
//
// Quando o cliente RESPONDE, a Bia conversa com IA (Claude Sonnet) como uma VENDEDORA
// CONSULTIVA: entende a trava, contorna a objeção, cria urgência honesta e CONDUZ AO
// FECHAMENTO — não é uma tiradora-de-dúvidas passiva. Ela tem UMA alavanca de fechamento
// real: o cupom LIMPA30 (30% OFF), que pode oferecer 1 VEZ quando a pessoa hesita ou
// sinaliza intenção. Mantém histórico em whatsapp_sessions (tipo='recuperacao'), o que
// também faz o backoff do outbound (emConversa()=true).
//
// Persistência é DENTRO da conversa ativa (seguro/desejado), não re-ping a frio. Só para
// de vender com recusa EXPLÍCITA → tag [PERDIDO] (status='perdido', Bia cala). "Vou pensar"/
// "depois" NÃO é perdido — acolhe e mantém a porta aberta (foi onde perdemos Lucimary/Gilberto).
//
// Via PRIMÁRIA: webhook /webhook/recup (tem o texto direto). Poll é fallback se o
// webhook Multi Device da Z-API falhar (bug conhecido — ver sdrIoPolling).
//
// Guard-rails duros: NUNCA inventa preço/link. Usa SÓ o cupom LIMPA30 (nunca inventa outro
// desconto/parcelamento/brinde). Reembolso/problema no pagamento/reclamação séria → tag
// [ESCALAR] → human_takeover. Tudo no-op enquanto recuperacaoHabilitada()=false.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendHuman, fmtPhone } from '../zapiClient';
import { tryClaimMessage } from '../sdr/sdrAgentService';
import { logger } from '../../../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// Recuperação sai pela MESMA linha IO (decisão Thiago). Roteamento seguro: a Bia só
// fala com quem ELA abordou (tem sessão tipo='recuperacao'); o resto da linha é humano.
const INSTANCE = 'io' as const;
const MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY = 30;

function recuperacaoHabilitada(): boolean {
  return process.env.RECUP_ENABLED === 'true' && Boolean(process.env.ZAPI_INSTANCE_ID_IO?.trim());
}

// Roteamento: este telefone é um lead de recuperação que a Bia abordou? (tem sessão
// tipo='recuperacao'). Usado pelo webhook /io pra decidir Bia vs. atendimento humano.
// Variantes BR do telefone — a Z-API/Worker às vezes grava SEM o 9º dígito do celular
// (ex.: opener salvo como 5534991360223, mas o inbound chega como 553491360223). Sem isso
// o match de sessão falha e a Bia não responde. Inclui com/sem 9 e com/sem 55.
export function phoneVariants(raw: string): string[] {
  const clean = raw.replace(/\D/g, '');
  const c55 = clean.startsWith('55') ? clean : `55${clean}`;
  const semDdi = c55.replace(/^55/, '');
  // adiciona/remove o 9 após o DDD (posição 4 no formato 55+DD)
  const add9 = c55.length === 12 ? c55.slice(0, 4) + '9' + c55.slice(4) : c55;
  const rem9 = c55.length === 13 && c55[4] === '9' ? c55.slice(0, 4) + c55.slice(5) : c55;
  return Array.from(new Set([clean, c55, semDdi, add9, rem9, add9.replace(/^55/, ''), rem9.replace(/^55/, '')]));
}

export async function ehLeadRecuperacao(rawPhone: string): Promise<boolean> {
  if (!recuperacaoHabilitada()) return false;
  const { data } = await supabase.from('whatsapp_sessions')
    .select('id').in('phone', phoneVariants(rawPhone)).eq('tipo', 'recuperacao').limit(1).maybeSingle();
  return Boolean(data);
}

// Opt-out DURO → PERDIDO na hora (antes de chamar a IA). Só recusa EXPLÍCITA: "vou pensar"/
// "depois"/"esse mês não dá" NÃO casam de propósito (mantêm o lead quente). Os radicais
// descadastr/cancela usam \w* no fim pra pegar as conjugações ("descadastra", "descadastro",
// "cancela", "cancelar") — sem isso, o \b logo após o radical falhava em "me descadastra".
const OPT_OUT = /\b(parar de mandar|para de mandar|chega de mensagem|n[ãa]o (me )?manda mais|n[ãa]o quero mais|me descadastr\w*|descadastr\w*|sair da lista|cancela\w* (meu )?cadastro|stop)\b/i;

interface BiaLeadData {
  email?: string; produto?: string | null; status?: 'pix_gerado' | 'abandonou' | 'perdido' | null;
  valor_centavos?: number | null; link?: string | null; pix_code?: string | null; human_takeover?: boolean;
  // Fechamento: cupom LIMPA30 é oferta ÚNICA por conversa (não vira leilão de desconto).
  cupom_oferecido?: boolean;
  // Marcado quando o cliente recusou explicitamente ([PERDIDO]) — Bia para de vender.
  perdido_em?: string;
}
interface BiaSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome: string | null;
  lead_data: BiaLeadData;
}

// ─── system prompt da Bia ───────────────────────────────────────────
// Exportado pra teste de regressão comportamental (replay dos casos reais Lucimary/Gilberto/Eduardo).
export function buildBiaSystemPrompt(ctx: {
  nome?: string | null; produto?: string | null; status?: 'pix_gerado' | 'abandonou' | 'perdido' | null;
  valorCentavos?: number | null; link?: string | null; pixCode?: string | null;
  cupomJaOferecido?: boolean;
}): string {
  const nome = ctx.nome ? ctx.nome.trim().split(/\s+/)[0] : null;
  const produto = ctx.produto || 'Limpa Solar Pro';
  const valor = ctx.valorCentavos
    ? `R$ ${(ctx.valorCentavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null;
  const link = ctx.link || process.env.RECUP_CHECKOUT_URL || null;
  // Alavanca de fechamento: cupom LIMPA30 (30% OFF). Gate IGUAL ao outbound (cupomHabilitado):
  // RECUP_CUPOM_ENABLED='true' + URL setada. Assim, se o Thiago desligar o cupom (margem etc),
  // a Bia inbound PARA de oferecer junto com o toque frio — não fica dando 30% por conta própria.
  const cupomUrl = process.env.RECUP_CUPOM_URL?.trim() || null;
  const cupomLigado = process.env.RECUP_CUPOM_ENABLED === 'true' && Boolean(cupomUrl);
  const cupomDisponivel = cupomLigado && !ctx.cupomJaOferecido;

  return `Você é a "Bia", vendedora consultiva do Limpa Solar Pro pelo WhatsApp. A pessoa
entrou no checkout e NÃO finalizou. Seu trabalho é FECHAR essa venda: entender a trava,
resolver, e conduzir a pessoa até concluir a compra. Você é gente boa, humana e simpática —
mas é VENDEDORA: não larga a bola, conduz. Nunca robótica, nunca agressiva, nunca chata.

━━ CONTEXTO DESTE CLIENTE ━━
${nome ? `- Nome: ${nome}` : '- Nome: desconhecido (não invente)'}
- Produto: ${produto}${valor ? ` — valor ${valor}` : ' — valor NÃO informado (você NÃO sabe o preço; não invente)'}
- Situação: ${ctx.status === 'pix_gerado' ? 'gerou o Pix e não pagou' : ctx.status === 'abandonou' ? 'abandonou o checkout' : 'entrou no checkout'}
${link ? `- ÚNICO LINK OFICIAL (use SEMPRE este, nunca outro): ${link}` : '- LINK: indisponível (NÃO invente nenhum link)'}
${cupomUrl ? `- LINK COM CUPOM 30% OFF (sua alavanca de fechamento): ${cupomUrl}` : ''}
${ctx.pixCode ? '- PIX copia-e-cola disponível (use exatamente como está)' : ''}

━━ O QUE É O PRODUTO (pra tirar dúvida com segurança) ━━
- Curso em VIDEOAULAS de limpeza profissional de placas solares. Acessa no celular ou
  computador, no seu tempo, sem prazo pra terminar. Acesso liberado na hora do pagamento.
- Se perguntarem algo que você NÃO sabe de fato, não invente: diga que confirma e siga.

━━ COMO VENDER (conduza sempre pro próximo passo) ━━
1. Entenda a trava real. Faça UMA pergunta curta se não estiver claro ("o que te segurou?").
2. Resolva a objeção com calma e uma frase de valor (ex.: "é no seu tempo, acesso na hora").
3. FECHE: proponha o próximo passo concreto e mande o LINK OFICIAL. Ex.: "consegue finalizar
   agora que eu te acompanho?" — sempre terminando com um convite pra concluir, não no ar.
4. Sinal de intenção ("quero", "vou adquirir", "como faço") → NÃO adie. Mande o link e diga
   que é rápido. NUNCA responda "quando quiser me chama" a quem demonstrou que quer comprar.
${cupomDisponivel ? `
━━ SUA ALAVANCA DE FECHAMENTO — CUPOM 30% OFF (use com inteligência) ━━
- Você PODE oferecer o cupom de 30% OFF, mas UMA ÚNICA VEZ nesta conversa. Guarde pro momento
  certo: quando a pessoa hesita ("vou pensar", "tá caro", "depois"), fica na dúvida, ou você
  já contornou a objeção e ela ainda não fechou. É seu empurrãozinho final.
- Ao oferecer: mande o LINK COM CUPOM acima (o desconto já vem aplicado) e enquadre como algo
  especial e por tempo limitado ("consegui um desconto pra fechar hoje"). Honesto, sem mentir.
- Depois de oferecer o cupom, NÃO ofereça de novo nem invente desconto maior. É essa oferta.` : `
━━ DESCONTO ━━
- Você NÃO tem cupom disponível agora. Se pedirem desconto, diga que vai verificar com o time
  e siga vendendo pelo valor cheio. NUNCA invente cupom, desconto, brinde ou parcelamento.`}

━━ REGRAS DURAS — NUNCA ━━
- NUNCA invente preço, link, código pix ou política. Use SÓ o que está no CONTEXTO.
- NUNCA prometa outro desconto além do cupom acima, nem reembolso, brinde ou parcelamento especial.
- Se já comprou ("já paguei"/"comprei"): agradeça, diga que confere o acesso — NÃO mande link, NÃO cobre.

━━ QUANDO PARAR (2 tags — o sistema remove a tag antes de enviar) ━━
- RECUSA EXPLÍCITA ("não quero mais", "para de me mandar", "me tira daí", "não tenho interesse"):
  acolha com uma frase respeitosa e termine com a tag literal [PERDIDO]. Bia para de vender.
  ATENÇÃO: "vou pensar", "depois", "esse mês não dá", "mês que vem", "agora não" NÃO são recusa —
  NÃO use [PERDIDO] neles. Acolha, deixe a porta aberta ("fico por aqui quando decidir 😊") e,
  se ainda não ofereceu, esse é um bom momento pro cupom.
- PRECISA DE HUMANO (reembolso, problema no pagamento que você não resolve, reclamação séria):
  responda UMA vez acolhendo que vai passar pro time, e termine com a tag literal [ESCALAR].

━━ COMO ESCREVER ━━
- WhatsApp: curto, humano, no máximo 2 bolhas separadas por ||. 1-2 frases por bolha.
  No máximo 1 emoji. UMA resposta por mensagem do cliente. Nome só se souber. Sempre puxando
  pro fechamento, mas leve — conversa de gente, não script de robô.`;
}

// ─── sessão ─────────────────────────────────────────────────────────
// Busca por VARIANTES (o inbound pode chegar com formato de phone diferente do salvo)
// e retorna o phone CANÔNICO (o que está no banco) — pra salvar de volta na MESMA linha,
// não criar uma sessão duplicada com outro formato.
async function loadSession(rawPhone: string): Promise<BiaSession & { phoneCanonico: string }> {
  const { data } = await supabase.from('whatsapp_sessions')
    .select('phone, messages, nome, lead_data').in('phone', phoneVariants(rawPhone)).eq('tipo', 'recuperacao')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  return {
    phoneCanonico: (data?.phone as string) ?? fmtPhone(rawPhone),
    messages: (data?.messages as BiaSession['messages']) || [],
    nome: data?.nome ?? null,
    lead_data: (data?.lead_data as BiaLeadData) ?? {},
  };
}
async function saveSession(phone: string, msgs: BiaSession['messages'], nome: string | null, ld: BiaLeadData): Promise<void> {
  await supabase.from('whatsapp_sessions').upsert({
    phone, tipo: 'recuperacao', nome, messages: msgs.slice(-MAX_HISTORY * 2), lead_data: ld,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });
}

// ─── takeover: humano digitou do celular da recuperação → Bia cala ──
export async function marcarTakeoverBia(rawPhone: string): Promise<void> {
  const s = await loadSession(rawPhone);
  await saveSession(s.phoneCanonico, s.messages, s.nome, { ...s.lead_data, human_takeover: true });
  logger.info('bia-inbound', `human takeover ${s.phoneCanonico} — Bia silenciada`);
}

// ─── handler principal — chamado pelo webhook /io quando ehLeadRecuperacao()=true ──
export async function handleBiaInbound(rawPhone: string, text: string, senderName?: string | null): Promise<void> {
  if (!recuperacaoHabilitada()) return;
  const clean = (text || '').trim();
  if (!clean) return;

  const session = await loadSession(rawPhone);
  const phone = session.phoneCanonico;     // chave da sessão (salvar aqui pra não duplicar)
  const nome = session.nome ?? senderName ?? null;

  // Estados de PARADA: humano assumiu OU lead marcado perdido → registra e cala.
  if (session.lead_data.human_takeover === true || session.lead_data.status === 'perdido') {
    await saveSession(phone, [...session.messages, { role: 'user', content: clean }], nome, session.lead_data);
    return;
  }
  // Opt-out explícito (regex dura) → PERDIDO na hora, sem chamar a IA. Acolhe e para de vender.
  if (OPT_OUT.test(clean)) {
    await sendHuman(rawPhone, ['Sem problema, parei por aqui.', 'Se precisar é só me chamar neste número.'], INSTANCE);
    await saveSession(phone, [...session.messages, { role: 'user', content: clean }], nome,
      { ...session.lead_data, status: 'perdido', perdido_em: new Date().toISOString() });
    logger.info('bia-inbound', `opt-out → perdido ${phone}`);
    return;
  }

  const messages = [...session.messages, { role: 'user' as const, content: clean }];
  let raw: string;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 350,
      system: buildBiaSystemPrompt({
        nome, produto: session.lead_data.produto, status: session.lead_data.status,
        valorCentavos: session.lead_data.valor_centavos, link: session.lead_data.link, pixCode: session.lead_data.pix_code,
        cupomJaOferecido: session.lead_data.cupom_oferecido === true,
      }),
      messages,
    });
    const block = resp.content.find(b => b.type === 'text') as { text: string } | undefined;
    raw = block?.text ?? '';
  } catch (err) { logger.error('bia-inbound', `claude falhou ${phone}`, err); return; }
  if (!raw.trim()) return;

  // Tags de controle (removidas antes de enviar): [ESCALAR] → humano · [PERDIDO] → para de vender.
  const escalar = /\[ESCALAR\]/i.test(raw);
  const perdido = /\[PERDIDO\]/i.test(raw);
  const parts = raw.replace(/\[ESCALAR\]/ig, '').replace(/\[PERDIDO\]/ig, '').trim()
    .split('||').map(p => p.trim()).filter(Boolean).slice(0, 2);
  if (parts.length) await sendHuman(phone, parts, INSTANCE);

  // Rate-limit do cupom: se a Bia mandou o link com cupom nesta resposta, trava a próxima oferta.
  const cupomUrl = process.env.RECUP_CUPOM_URL?.trim();
  const ofereceuCupomAgora = Boolean(cupomUrl && raw.includes(cupomUrl))
    || /\bLIMPA30\b/i.test(raw) || (/30\s*%/.test(raw) && /(desconto|off|cupom)/i.test(raw));

  const novoLeadData: BiaLeadData = { ...session.lead_data };
  if (escalar) novoLeadData.human_takeover = true;
  if (perdido) { novoLeadData.status = 'perdido'; novoLeadData.perdido_em = new Date().toISOString(); }
  if (ofereceuCupomAgora) novoLeadData.cupom_oferecido = true;

  await saveSession(phone, [...messages, { role: 'assistant', content: raw }], nome, novoLeadData);
  if (escalar) logger.info('bia-inbound', `escalado pra humano: ${phone} (${session.lead_data.email ?? 's/ email'})`);
  if (perdido) logger.info('bia-inbound', `lead marcado PERDIDO: ${phone} (${session.lead_data.email ?? 's/ email'})`);
  if (ofereceuCupomAgora) logger.info('bia-inbound', `cupom LIMPA30 ofertado: ${phone}`);
}

// ─── INBOUND VIA webhook_debug (a via REAL da linha IO) ──────────────
// A linha IO manda os ReceivedCallback pra um Cloudflare Worker (receivedCallbackUrl
// = zapi-webhook.aiorosgroup.workers.dev), que grava tudo em webhook_debug. Os endpoints
// de leitura direta da Z-API (chat-messages) dão 400 em Multi Device — então a Bia lê o
// inbound DAQUI (webhook_debug), sem repontar nada e sem tocar no tráfego de energia.
//
// ROTEAMENTO SEGURO: só processa quem tem sessão tipo='recuperacao' (ehLeadRecuperacao).
// Cliente de energia (576/semana) nunca casa → nunca é tocado pela Bia.
// fromMe=false → resposta do cliente → Bia responde. fromMe=true & !fromApi → humano
// digitou → takeover (Bia cala). Dedup por messageId (tryClaimMessage).
const INSTANCE_ID_IO = '3F26F6ECE67D72BB7FCA6244BF24326C';

export async function pollBiaRecuperacao(): Promise<{ processed: number; skipped: number; errors: number }> {
  if (!recuperacaoHabilitada()) return { processed: 0, skipped: 0, errors: 0 };

  // Janela: 6 min (cobre o tick ~5min do /process-messages com folga).
  const desde = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('webhook_debug')
    .select('payload, created_at')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) { logger.error('bia-poll', 'ler webhook_debug falhou', error); return { processed: 0, skipped: 0, errors: 1 }; }

  let processed = 0, skipped = 0, errors = 0;
  for (const r of rows ?? []) {
    const p = (r.payload ?? {}) as Record<string, any>;
    // Só ReceivedCallback da instância IO.
    if (p.type !== 'ReceivedCallback' || p.instanceId !== INSTANCE_ID_IO) { skipped++; continue; }
    if (p.isGroup === true || p.isGroup === 'true') { skipped++; continue; }

    const phone = String(p.phone || p.senderPhone || '').replace(/\D/g, '');
    if (!phone) { skipped++; continue; }

    // ROTEAMENTO: só leads que a Bia abordou. Energia nunca casa → pula.
    if (!(await ehLeadRecuperacao(phone))) { skipped++; continue; }

    const fromMe = p.fromMe === true || p.fromMe === 'true';
    const fromApi = p.fromApi === true || p.fromApi === 'true';

    if (fromMe) {
      // Humano digitou do celular da linha (não a Bia via API) → silencia a Bia.
      if (!fromApi) {
        try { await marcarTakeoverBia(phone); processed++; } catch (err) { errors++; logger.error('bia-poll', `takeover ${phone}`, err); }
      } else skipped++;
      continue;
    }

    const texto = p.text?.message ?? (typeof p.text === 'string' ? p.text : '') ?? p.message ?? p.body ?? '';
    if (!String(texto).trim()) { skipped++; continue; }

    // Dedup por messageId — não reprocessa o mesmo evento em ticks sobrepostos.
    const messageId = p.messageId || p.zaapId || p.id || null;
    if (messageId) {
      const claimed = await tryClaimMessage(`bia:${messageId}`, phone, 'poll');
      if (!claimed) { skipped++; continue; }
    }

    try {
      await handleBiaInbound(phone, String(texto), p.senderName || p.pushname || null);
      processed++;
    } catch (err) {
      logger.error('bia-poll', `handleBiaInbound ${phone} falhou`, err);
      errors++;
    }
  }
  return { processed, skipped, errors };
}
