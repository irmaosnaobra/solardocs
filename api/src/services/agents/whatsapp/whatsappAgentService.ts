import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { handleSdrLead } from '../sdr/sdrAgentService';
import { fmtPhone, sendHuman } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { detectAndActivatePromoCredits } from './promoGeradorActivation';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';

const MAX_HISTORY = 30;

// ─── system prompt ───────────────────────────────────────────────

export function buildSystemPrompt(user: {
  email: string; plano: string; nome_empresa?: string; tem_cnpj: boolean; nome?: string;
}, promoCtx?: { ativadoAgora?: boolean; jaAtivado?: boolean; email?: string }): string {
  const planoLabel: Record<string, string> = { free: 'Gratuito', pro: 'PRO', ilimitado: 'VIP' };
  const nomeUsuario = user.nome ? user.nome.split(' ')[0] : null;

  // Bloco da promo (só aparece quando relevante).
  let promoBloco = '';
  if (promoCtx?.ativadoAgora) {
    promoBloco = `

━━ ⚡ AÇÃO AUTOMÁTICA — RESPONDA SOBRE ISSO ━━
O sistema acabou de ATIVAR 10 créditos pra esse cliente no novo gerador
de propostas, usando o e-mail "${promoCtx.email}".
Sua resposta DEVE (isto TEM PRIORIDADE sobre a missão de venda acima — neste
momento ele acabou de ganhar créditos grátis, não é hora de empurrar assinatura):
1. Confirmar que os 10 créditos já estão liberados.
2. Direcionar pra ${APP_URL} pra ele começar a gerar propostas.
3. Curtinha, tom de amiga. Pode usar 1 emoji discreto (🎁 ou ⚡).
NÃO peça o e-mail de novo. NÃO mande link de pagamento. NÃO ofereça plano agora.`;
  } else if (promoCtx?.jaAtivado) {
    promoBloco = `

━━ ℹ️ CONTEXTO PROMO ━━
Esse cliente já recebeu os 10 créditos da promo de hoje (e-mail "${promoCtx.email}").
Se ele perguntar de novo sobre créditos, confirme que já estão liberados
e mande pra ${APP_URL}. Nada de duplicar.`;
  }

  // Gate de venda por plano: o que a Giovanna deve oferecer pra ESTE usuário.
  // FREE → assinar PRO/VIP · PRO → subir pra VIP · VIP → já tem tudo (só suporte).
  let vendaBloco = '';
  if (user.plano === 'free') {
    vendaBloco = `
━━ 🎯 SUA MISSÃO: LEVAR PRA ASSINATURA ━━
Este usuário está no plano GRATUITO. Seu objetivo é conduzir a conversa, com
naturalidade, até a ASSINATURA — você é consultora especialista, não tira-pedido.
- Entenda primeiro a dor dele (quantas vendas/mês faz, como monta proposta/contrato hoje).
- Mostre o GANHO DE PERFORMANCE de assinar (use os argumentos abaixo, escolha o que encaixa).
- Quando ele demonstrar interesse de comprar/assinar — inclusive de forma elíptica
  ("pode mandar", "como faço", "quero", "manda o link", "como pago") — ENTREGUE O LINK NA HORA:
  👉 ${APP_URL} — "é só escolher PRO ou VIP e testar 7 dias grátis, sem compromisso".
  Isso é ATENDIMENTO, não pressão. Nunca devolva a bola pedindo "manda aí" — o link é seu.

━━ PLANOS (preços REAIS — nunca invente outro valor) ━━
- PRO — R$ 27/mês: 90 documentos/mês. Ideal pra quem fecha até ~20 vendas no mês.
- VIP — R$ 67/mês: documentos ILIMITADOS + dashboard completo + toda expansão da plataforma. Pra volume alto.
- Os dois têm 7 dias grátis (cartão só é cobrado no 8º dia, cancela quando quiser).

━━ O QUE A PLATAFORMA ENTREGA (use pra vender o valor) ━━
- Gera contratos, procurações e PROPOSTAS SOLARES profissionais em minutos (não em horas no Word).
- Tudo sai com a MARCA da empresa dele: logo, cor e fotos no documento e na proposta.
- Proposta com simulação de economia, antes/depois da conta de luz, payback — pronta pra fechar.
- Documentos juridicamente prontos (garantia, inadimplência, titularidade) só assinar.
- Cada documento gerado economiza 30-60min — vira tempo pra vender mais.`;
  } else if (user.plano === 'pro') {
    vendaBloco = `
━━ 🎯 OPORTUNIDADE: SUBIR PRA VIP ━━
Este usuário é PRO (R$ 27/mês, 90 docs). Se ele bater no limite, gerar muito volume,
ou pedir mais, ofereça o upgrade pro VIP (R$ 67/mês) com naturalidade:
documentos ILIMITADOS + dashboard completo + toda a expansão da plataforma.
Se quiser assinar/subir, mande pra ${APP_URL}. Fora isso, atenda como suporte — sem empurrar.`;
  } else {
    vendaBloco = `
━━ CONTEXTO ━━
Este usuário já é VIP (plano máximo). NÃO ofereça upgrade. Foque em suporte
e em ajudá-lo a extrair o máximo da plataforma.`;
  }

  return `Você é a "Giovanna", consultora especialista da SolarDoc Pro. Vendedora de verdade,
mas humana e consultiva — entende o negócio do integrador solar e conduz pra solução.
Calorosa, segura, sem ser chata nem robótica.

━━ PERFIL DO USUÁRIO ━━
${nomeUsuario ? `- Nome: ${nomeUsuario}` : '- Nome: integrador'}
- Plano: ${planoLabel[user.plano] || user.plano}
- Empresa: ${user.tem_cnpj ? `${user.nome_empresa || 'cadastrada'} ✅` : 'NÃO cadastrada'}
${vendaBloco}

━━ COMO RESPONDER ━━
- Curto e natural. 1-2 frases por bolha. Emojis com parcimônia (0-1).
- Conduza a conversa: cada resposta avança UMA etapa (entender dor → mostrar valor → ASSINAR). Nunca ande em círculo.
- Se a pessoa SÓ quer suporte técnico, resolva direto e bem — não force venda no meio de um problema.
- Atenção a pedidos elípticos: "Pode mandar", "bora", "vamos testar", "quero" = ele quer AVANÇAR. Não devolva a bola perguntando "o que você quer?" — dê o próximo passo concreto (mostre o valor ou mande o link de assinatura).
- ANTI-LOOP (crítico): se você JÁ fez uma pergunta de sondagem antes e o cliente respondeu mostrando interesse, NÃO faça outra pergunta de sondagem — AVANCE pro link ${APP_URL}. Você nunca faz a mesma pergunta (ou equivalente) duas vezes.
- SAÍDA PRA HUMANO: se travar de verdade (cliente confuso, irritado, pergunta que você não sabe, ou pedindo algo fora do seu alcance), pare de insistir e diga que vai chamar uma pessoa do time pra ajudar — não invente nem fique repetindo.
- Nunca prometa o que a plataforma não faz. Nunca invente preço (PRO 27 / VIP 67, só esses).

━━ FORMATO ━━
Máximo 2 bolhas separadas por ||. Frases curtas.${promoBloco}`;
}

// ─── histórico ───────────────────────────────────────────────────

// Lê a sessão priorizando user_id (chave ESTÁVEL — o phone do Z-API diverge do
// users.whatsapp em 100% dos casos reais, então casar por phone perde o contexto
// do follow-up que a Giovanna abriu). Cai pro phone quando não há user_id (visitante
// sem conta) ou quando ainda não há linha por user_id.
async function getSession(phone: string, userId?: string | null): Promise<{ messages: { role: 'user' | 'assistant'; content: string }[]; nome?: string }> {
  if (userId) {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('messages, nome')
      .eq('user_id', userId)
      .eq('tipo', 'platform')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { messages: (data.messages as any[]) || [], nome: data.nome || undefined };
  }
  const { data } = await supabase.from('whatsapp_sessions').select('messages, nome').eq('phone', phone).maybeSingle();
  return { messages: (data?.messages as any[]) || [], nome: data?.nome || undefined };
}

async function saveSession(
  phone: string,
  userId: string | null,
  messages: { role: 'user' | 'assistant'; content: string }[],
  nome?: string | null,
): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY * 2);
  const payload: any = { phone, user_id: userId, tipo: 'platform', messages: trimmed, updated_at: new Date().toISOString() };
  if (nome) payload.nome = nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// Registra na sessão 'platform' uma mensagem que NÓS (Giovanna) enviamos de forma
// proativa — ex.: o opener do follow-up da Carla. ESSENCIAL pra continuidade: sem
// isso, quando o cliente responde, a Giovanna assume a conversa SEM saber o que foi
// dito antes (foi a causa-raiz do "Pode mandar" bugado). Faz APPEND (não sobrescreve
// histórico) e ancora por user_id — a chave que a Giovanna lê (phone do Z-API diverge
// do users.whatsapp em 100% dos casos). content entra como role 'assistant' (= nós).
export async function registrarMsgProativa(args: {
  userId: string;
  phone: string;          // u.whatsapp (formato do banco) — vira a chave phone da linha
  content: string;
  nome?: string | null;
}): Promise<void> {
  const phoneKey = args.phone.replace(/\D/g, '');
  // Lê a sessão existente do user (por user_id, fallback phone) pra fazer append.
  const existente = await getSession(phoneKey, args.userId);
  const novas = [...existente.messages, { role: 'assistant' as const, content: args.content }];
  const trimmed = novas.slice(-MAX_HISTORY * 2);
  const payload: any = {
    phone: phoneKey,
    user_id: args.userId,
    tipo: 'platform',
    messages: trimmed,
    updated_at: new Date().toISOString(),
  };
  if (args.nome) payload.nome = args.nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── boas-vindas ─────────────────────────────────────────────────

export async function processMessageQueue(): Promise<{ processed: number; debug?: any }> {
  const { data: messages, error: qErr } = await supabase
    .from('message_queue')
    .select('*')
    .neq('processed', true)
    .order('created_at', { ascending: true })
    .limit(10);

  if (qErr || !messages || messages.length === 0) {
    return { processed: 0, debug: { error: qErr?.message, count: messages?.length ?? 0 } };
  }

  let processed = 0;
  const errors: string[] = [];
  for (const msg of messages) {
    // Marca como processado ANTES — apenas o primeiro a fazer isso processa a mensagem
    const { data: claimed } = await supabase
      .from('message_queue')
      .update({ processed: true })
      .eq('id', msg.id)
      .eq('processed', false)
      .select('id');

    if (!claimed || claimed.length === 0) continue; // outro processo já pegou

    try {
      const media = msg.media_url ? {
        url: msg.media_url as string,
        type: msg.media_type as string,
        mime: (msg.media_mime as string) || '',
      } : undefined;
      await handleIncomingWhatsApp(msg.phone, msg.text, msg.sender_name, undefined, media);
      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(errMsg.slice(0, 100));
    }
  }
  return { processed, debug: errors.length ? errors : undefined } as any;
}

export async function sendWelcomeWhatsApp(phone: string, _email: string, nome?: string | null): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');
  const firstName = (nome || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Oi ${firstName}!` : 'Oi!';

  const parts = [
    `${greeting} 🌞 Sou a Giovanna, assistente da SolarDoc Pro.`,
    `Tua conta tá pronta. Te mando o link de acesso pra você salvar:\n\n🔗 solardoc.app/auth`,
    `Quer instalar como app no celular? Em 1 toque vira ícone na tela:\n\n📱 *iPhone*: Safari → *Compartilhar* → *"Adicionar à Tela de Início"*\n\n📱 *Android*: Chrome → *3 pontinhos* → *"Instalar app"*\n\n💻 *PC*: *Ctrl+D* pra favoritar OU ícone *"+"* na barra pra instalar como app\n\nTô aqui se travar em algo. Bom uso! 🚀`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, nome || null, [{ role: 'assistant', content: fullText }]);
}

// Boas-vindas para quem COMPROU (PRO/VIP). Agradece a compra, confirma o plano
// e dá TODAS as instruções pra começar. Suporte 10/10 — Giovanna se coloca como
// canal direto. Disparado no authController quando stripePlan existe (conta nova
// OU conta existente que acabou de pagar).
export async function sendPurchaseWhatsApp(phone: string, plano: string, nome?: string | null): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');
  const firstName = (nome || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Oi ${firstName}!` : 'Oi!';
  const planoLabel = plano === 'ilimitado' ? 'VIP (documentos ilimitados)' : 'PRO';

  const parts = [
    `${greeting} 🌞 Sou a Giovanna, assistente da SolarDoc Pro. Sua compra foi confirmada — muito obrigada e seja bem-vindo(a)! 🎉`,
    `Seu plano *${planoLabel}* já tá ativo. Aqui é seu acesso, salva esse link:\n\n🔗 solardoc.app/auth\n\nÉ só entrar com o e-mail e a senha que você cadastrou.`,
    `Pra deixar tudo redondo, faça isso já no primeiro acesso:\n\n1️⃣ Cadastre o *CNPJ da sua empresa* em *Empresa*\n2️⃣ Suba sua *logo, cor e fotos* — todo documento e proposta já sai com a sua marca\n3️⃣ Pronto pra gerar contratos, procurações e propostas solares ✅`,
    `Quer instalar como app no celular? Em 1 toque vira ícone na tela:\n\n📱 *iPhone*: Safari → *Compartilhar* → *"Adicionar à Tela de Início"*\n📱 *Android*: Chrome → *3 pontinhos* → *"Instalar app"*\n💻 *PC*: ícone *"+"* na barra do navegador`,
    `Qualquer dúvida — de verdade, qualquer uma — me chama *aqui mesmo neste número*. Eu te respondo. Bom uso e boas vendas! 🚀`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, nome || null, [{ role: 'assistant', content: fullText }]);
}

// Frases que indicam vontade explicita de parar de receber automacao.
// CUIDADO: nao usar palavras curtas ambiguas como "para" (preposicao) ou
// "nao quero" sozinho — geram falso positivo em conversas normais.
// Aqui exigimos frases completas com contexto inequivoco de opt-out.
const OPT_OUT_PATTERNS = /\b(parar de mandar|para de mandar|para de me mandar|para de me chamar|chega de mensagem|chega dessas mensagens|nao manda mais|não manda mais|nao me manda mais|não me manda mais|nao quero mais (essas |receber|mensagem)|não quero mais (essas |receber|mensagem)|me descadastra|descadastrar|sai dessa lista|sair da lista|cancela (meu )?cadastro|cancelar (meu )?cadastro|stop)\b/i;

export interface IncomingMedia {
  url: string;
  type: string; // 'audio' | 'image' | 'video' | 'document'
  mime: string;
}

// ─── resposta a mensagem recebida ────────────────────────────────
export async function handleIncomingWhatsApp(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null },
  media?: IncomingMedia
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');

  // Pre-processa midia: transcreve audio, prepara imagem pra Anthropic
  let imageSource: { type: 'base64'; media_type: any; data: string } | null = null;
  if (media) {
    const { transcribeAudio, downloadImageAsAnthropicSource } = await import('../../../utils/mediaProcessor');
    if (media.type === 'audio') {
      const transcription = await transcribeAudio(media.url, media.mime);
      if (transcription) {
        text = transcription;
      } else {
        text = text || '[audio recebido — nao consegui transcrever, pode digitar?]';
      }
    } else if (media.type === 'image') {
      imageSource = await downloadImageAsAnthropicSource(media.url, media.mime);
      if (!text || text === '[imagem]') text = 'O cliente enviou esta imagem.';
    } else if (media.type === 'video' || media.type === 'document') {
      text = text + ` [cliente enviou ${media.type} — diga que voce nao analisa esse formato e peca pra ele descrever o problema por texto ou audio]`;
    }
  }

  // Normaliza número BR: Z-API às vezes omite o 9 do celular (553498364589 → 5534998364589)
  const c55 = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
  const addNine = (p: string) => p.length === 12 && p.startsWith('55') ? p.slice(0, 4) + '9' + p.slice(4) : p;
  const phoneVariants = [
    cleanPhone,
    cleanPhone.replace(/^55/, ''),
    c55,
    addNine(c55),
    addNine(c55).replace(/^55/, ''),
  ];

  let user: { id: string; email: string; plano: string } | null = null;
  for (const variant of phoneVariants) {
    const { data } = await supabase.from('users').select('id, email, plano').eq('whatsapp', variant).single();
    if (data) { user = data; break; }
  }

  // Número não cadastrado na plataforma → roteia pra SDR B2B (Carla/SolarDoc)
  // ou SDR B2C (Luma/Irmãos na Obra) com base em sinais
  if (!user) {
    const lowerText = text.trim().toLowerCase();

    // B2C signals (Irmãos na Obra) — frases dos anúncios Meta de energia solar
    const B2C_TRIGGERS = [
      'olá! tenho interesse e queria mais informações, por favor.',
      'tenho interesse em energia solar',
    ];
    const isB2cTriggered = B2C_TRIGGERS.some(t => lowerText.includes(t));

    // B2B signals (SolarDoc) — inclui typos comuns ("soladoc") e variacoes
    const B2B_TRIGGERS = [
      'eu quero o solardoc', 'eu quero a solardoc',
      'eu quero o soladoc',  'eu quero a soladoc',
      'quero o solardoc',    'quero a solardoc',
      'quero o soladoc',     'quero a soladoc',
      'quero conhecer a solardoc', 'quero conhecer o solardoc',
      'sou empresario solar', 'sou empresário solar',
      'integrador solar',
    ];
    const isB2bTriggered = B2B_TRIGGERS.some(t => lowerText.includes(t));
    const isFromAd = !!tracking?.ctwa_clid;

    // Sessões existentes
    const { data: b2cSession } = await supabase
      .from('whatsapp_sessions').select('id').eq('phone', cleanPhone).eq('tipo', 'sdr').single();
    const { data: b2bSession } = await supabase
      .from('whatsapp_sessions').select('id').eq('phone', cleanPhone).eq('tipo', 'sdr_b2b').single();

    // Roteamento: prioriza sessão existente, depois trigger, depois ad (B2B por default)
    if (b2bSession || isB2bTriggered) {
      const { handleSolarDocB2bLead } = await import('../sdr/sdrB2bAgentService');
      await handleSolarDocB2bLead(cleanPhone, text, senderName, tracking, imageSource);
      return;
    }
    if (b2cSession || isB2cTriggered) {
      // Luma (B2C SDR) roda na linha IO — passa instance + imageSource (multimodal)
      await handleSdrLead(cleanPhone, text, senderName, tracking, 'io', imageSource);
      return;
    }
    if (isFromAd) {
      // Anúncio Meta (ctwa_clid) sem trigger explícito → assume B2B SolarDoc
      // (porque é o produto que está rodando ads no momento)
      const { handleSolarDocB2bLead } = await import('../sdr/sdrB2bAgentService');
      await handleSolarDocB2bLead(cleanPhone, text, senderName, tracking, imageSource);
      return;
    }
    // Mensagem aleatória de número desconhecido → ignora
    return;
  }

  // Cliente respondeu — marca pra parar com automacao futura.
  // (whatsapp_replied_at IS NOT NULL bloqueia runWhatsappFollowup e runInactiveEngagement)
  await supabase.from('users').update({
    whatsapp_replied_at: new Date().toISOString(),
  }).eq('id', user.id);

  // Detecta pedido explicito de parar com mensagens automaticas.
  // Opt-out UNIFICADO: "não quero mais" para TODOS os canais (WhatsApp + email).
  // Sem isso, a pessoa silenciava o Whats mas continuava recebendo email.
  if (OPT_OUT_PATTERNS.test(text)) {
    await supabase.from('users').update({ whatsapp_opt_out: true, email_opt_out: true }).eq('id', user.id);
    await sendHuman(cleanPhone, [
      'Anotado, parei de mandar mensagem automatica.',
      'Se um dia precisar de algo, e so me chamar aqui.',
    ]);
    return;
  }

  const { data: company } = await supabase
    .from('company')
    .select('nome')
    .eq('user_id', user.id)
    .single();

  const session = await getSession(cleanPhone, user.id);
  // Salva nome do remetente se ainda não tiver
  const nome = session.nome || senderName || null;

  const userCtx = {
    email: user.email,
    plano: user.plano,
    nome_empresa: company?.nome,
    tem_cnpj: !!company,
    nome: nome || undefined,
  };

  // Promo Gerador (27/05/2026): se o user recebeu a promo nas últimas 48h
  // e mandou um e-mail nessa mensagem, ativa 10 créditos automaticamente
  // e injeta contexto pra Giovanna confirmar a ativação naturalmente.
  const promoResult = await detectAndActivatePromoCredits(user.id, text);
  const promoCtx = promoResult.ativado
    ? { ativadoAgora: true as const, email: promoResult.email }
    : promoResult.ja_ativado_antes
    ? { jaAtivado: true as const, email: promoResult.email }
    : undefined;

  // Se tem imagem, monta content multimodal; senao texto puro
  const userContent: any = imageSource
    ? [
        { type: 'image', source: imageSource },
        { type: 'text', text: text.trim() || 'Cliente enviou esta imagem.' },
      ]
    : text.trim();

  const messages: any[] = [
    ...session.messages,
    { role: 'user', content: userContent },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 350,
    system: buildSystemPrompt(userCtx, promoCtx),
    messages,
  });

  const raw = (response.content[0] as { text: string }).text;
  const parts = raw.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  await saveSession(cleanPhone, user.id, [
    ...messages,
    { role: 'assistant', content: raw },
  ], nome);
}
