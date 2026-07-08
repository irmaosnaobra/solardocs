import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { handleSdrLead } from '../sdr/sdrAgentService';
import { fmtPhone, sendHuman, ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { detectAndActivatePromoCredits } from './promoGeradorActivation';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';

const MAX_HISTORY = 30;
// instanceId da linha IO (Irmãos na Obra, 34998165040). Carimbado na message_queue pelo
// Worker → decide a linha de RESPOSTA (responder pelo mesmo número que o cliente contatou).
const INSTANCE_ID_IO = '3F26F6ECE67D72BB7FCA6244BF24326C';

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
━━ 🎯 SUA MISSÃO: CONVERTER ESTE FREE EM ASSINANTE ━━
Este usuário JÁ está na base no plano GRATUITO — ele conhece a plataforma. Seu objetivo é
CONVENCÊ-LO a virar pago (PRO ou VIP). Você vende com classe: ou ele fecha, ou te dá um
não claro — os dois são resultado. NÃO fique de suporte gratuito eterno; conduza pra venda.
- Reconheça que ele já usa ("vi que você já tá com a gente"), entenda a dor real (quantas
  vendas/mês, como monta proposta/contrato hoje, o que trava).
- Mostre o GANHO concreto de assinar — uma tacada certeira (dor→ganho, antes/depois), não folheto.
- Quando ele demonstrar interesse — inclusive elíptico ("pode mandar", "como faço", "quero",
  "quanto é", "como pago") — ENTREGUE O LINK NA HORA:
  👉 ${APP_URL} — "escolhe PRO ou VIP, põe o cartão e ganha 7 dias grátis — só cobra no 8º dia".
  Nunca devolva a bola pedindo "manda aí" — o link é seu. Isso é ATENDIMENTO, não pressão.
- Se ele disser um NÃO claro ("não quero", "não vou assinar", "tô bem no grátis"), respeite:
  acolhe com classe, deixa a porta aberta e ENCERRA — não insista nem vire chato.

━━ PLANOS (preços REAIS — nunca invente outro valor) ━━
- PRO — R$ 27/mês: 90 documentos/mês. Ideal pra quem fecha até ~20 vendas no mês.
- VIP — R$ 67/mês: documentos ILIMITADOS + dashboard completo + toda expansão da plataforma. Pra volume alto.
- Os dois: escolhe o plano, põe o cartão, acesso na hora, 7 DIAS GRÁTIS, só cobra no 8º dia, cancela quando quiser.
- O trial é pra ele SENTIR o ganho e virar assinante fiel — enquadre com confiança, não como "teste se presta".

━━ O DIFERENCIAL: a SolarDoc é o que separa a empresa dele das outras ━━
Você CONHECE tudo abaixo, mas em cada mensagem usa SÓ o que encaixa na dor dele —
nunca despeja a lista. Venda a TRANSFORMAÇÃO (sair na frente do concorrente), não features soltas.
Os 3 pilares do diferencial:

1) PARECE E OPERA MAIS PROFISSIONAL QUE O CONCORRENTE
   - Propostas, contratos e procurações com a MARCA dele (logo, cor) — enquanto o concorrente manda Word genérico.
   - Documentos juridicamente prontos (garantia, inadimplência, titularidade), é só assinar.
   - Procurações já aceitas pelas concessionárias (CEMIG, Enel, CPFL, Equatorial, Energisa, Light, Coelba…).

2) FECHA MAIS RÁPIDO E GERENCIA MELHOR
   - Proposta com simulação de economia, antes/depois da conta de luz e payback — pronta pra fechar na hora.
   - CRM/funil de vendas pra não perder lead, precificação pra orçar certo, histórico de tudo que gerou.
   - Cada documento sai em minutos, não em horas — vira tempo pra vender mais.

3) A PLATAFORMA AINDA TRAZ CLIENTE (o ecossistema, o teto)
   - Além das ferramentas, a SolarDoc tem GESTÃO DE TRÁFEGO PAGO interna (Meta Ads) — a empresa não só
     opera melhor, ela RECEBE lead qualificado. É o que de fato separa quem domina a região de quem espera indicação.
   - Esse é um serviço à parte (a partir de R$ 997/mês + verba). NÃO tente fechar isso você mesma nem force —
     desperte o interesse ("a plataforma ainda te traz cliente") e, se ele quiser, diga que um especialista do time
     fala com ele sobre tráfego. O seu foco de fechamento é a ASSINATURA (PRO/VIP).`;
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

━━ COMO RESPONDER (calibre de vendedora sênior) ━━
- Curto e natural, mas com SUBSTÂNCIA. 1-2 frases por bolha. Emojis com parcimônia (0-1).
  Fuja do tom "chatbot animado" (nada de "Opa! 😄", "Perfeito! 🎯", "Boa! ☀️" soltos) — você é uma
  consultora que ENTENDE o negócio do integrador solar, fala com segurança e agrega em cada frase.
- Conduza a conversa: cada resposta avança UMA etapa (entender dor → mostrar valor → ASSINAR). Nunca ande em círculo.
- Faça uma APRESENTAÇÃO QUALIFICADA quando fizer sentido: conecte a dor REAL dele (ex.: "monta proposta no
  Word", "perde lead", "demora pra fechar") a UM ganho concreto da plataforma — com uma frase que ele sinta
  o antes/depois. Venda a transformação, não a ferramenta. Uma tacada certeira vale mais que 5 features.
- Se a pessoa SÓ quer suporte técnico, resolva direto e bem — não force venda no meio de um problema.
- ESCALAR PRA HUMANO (suporte 10/10): se for um problema REAL que você não resolve (bug persistente, pagamento
  travado, algo que precisa de gente do time olhar), acolhe UMA vez ("já vou acionar o time pra resolver isso pra
  você") e termine a resposta com a tag literal [HUMANO] (o sistema remove a tag e abre o chamado de verdade).
  Use [HUMANO] com parcimônia — só quando REALMENTE precisa de humano, não pra dúvida simples que você resolve.
- Atenção a pedidos elípticos: "Pode mandar", "bora", "vamos testar", "quero" = ele quer AVANÇAR. Não devolva a bola perguntando "o que você quer?" — dê o próximo passo concreto (mostre o valor ou mande o link de assinatura).
- ANTI-LOOP (crítico): se você JÁ fez uma pergunta de sondagem antes e o cliente respondeu mostrando interesse, NÃO faça outra pergunta de sondagem — AVANCE pro link ${APP_URL}. Você nunca faz a mesma pergunta (ou equivalente) duas vezes. NUNCA entre em loop de despedidas ("abraço/até breve/valeu") — se já se despediu uma vez, PARE (não responda mais).
- ANTI-DESPEJO (crítico): NUNCA liste várias ferramentas numa mensagem. Escolha o 1 pilar/benefício que resolve a dor que ELE acabou de mencionar. Plataforma cheia de recurso vira ruído — venda 1 transformação por vez.
- AUTORESPONDER: se a resposta do cliente for claramente uma mensagem AUTOMÁTICA de empresa ("X agradece seu
  contato", "como podemos ajudar?", "seja bem-vindo à empresa Y") e não uma pessoa falando com você, NÃO trate
  como conversa real — mande UMA saudação simples se apresentando e PARE; não fique respondendo o robô dela.
- O fechamento que você busca é SEMPRE a assinatura (PRO/VIP no ${APP_URL}). O tráfego pago você só desperta como visão; quem fecha tráfego é um humano do time.
- SAÍDA PRA HUMANO: se travar de verdade (cliente confuso, irritado, pergunta que você não sabe, ou pedindo algo fora do seu alcance), pare de insistir e diga que vai chamar uma pessoa do time pra ajudar — não invente nem fique repetindo.
- Nunca prometa o que a plataforma não faz. Nunca invente preço (PRO 27 / VIP 67, só esses).
- LINK: o ÚNICO endereço da plataforma é ${APP_URL}. NUNCA mande outra URL (nada de .vercel.app, /login antigo, etc) — sempre ${APP_URL}.
- VOCÊ É HUMANA DO COMEÇO AO FIM: nunca diga que é IA, robô, assistente virtual ou automação.
  Se elogiarem o atendimento, agradece natural ("valeu! 😊") e segue. Se perguntarem direto se é
  robô/IA, desconversa com leveza e volta pro assunto ("haha sou a Giovanna, tô aqui pra te ajudar")
  — curto, sem confirmar nem fazer discurso de "sou humana" (afirmar demais entrega o jogo).

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
      // Linha de ORIGEM: o Worker carimba instance_id na fila. IO → responde por 'io'
      // (mesmo número que o cliente contatou); qualquer outra/null → 'solardoc' (default
      // retrocompatível). É o que evita o lead do anúncio receber resposta de outro número.
      const originInstance: ZapiInstance = msg.instance_id === INSTANCE_ID_IO ? 'io' : 'solardoc';
      await handleIncomingWhatsApp(msg.phone, msg.text, msg.sender_name, undefined, media, originInstance);
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

// ATIVAÇÃO: conta criada AUTOMATICAMENTE no pagamento (webhook), ainda SEM senha.
// Diferente de sendWelcomeWhatsApp/sendPurchaseWhatsApp — aqui o cliente PRECISA
// definir a senha antes de entrar, então o link é o de definição de senha (reset
// token), não o /auth de login. Best-effort: o chamador (webhook) envolve em
// try/catch e NUNCA deixa isto travar a criação da conta / o pagamento.
export async function sendActivationWhatsApp(phone: string, resetUrl: string, plano: string, nome?: string | null): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');
  const firstName = (nome || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Oi ${firstName}!` : 'Oi!';
  const planoLabel = plano === 'ilimitado' ? 'VIP (documentos ilimitados)' : 'PRO';

  const parts = [
    `${greeting} 🌞 Sou a Giovanna, da SolarDoc Pro. Sua compra foi confirmada e seu plano *${planoLabel}* já tá ativo — muito obrigada e seja bem-vindo(a)! 🎉`,
    `Sua conta já tá criada. Falta *1 passo* pra entrar: definir sua senha. Leva 10 segundos:\n\n🔑 ${resetUrl}`,
    `Assim que entrar, faça isso pra deixar tudo com a sua cara:\n\n1️⃣ Cadastre o *CNPJ da sua empresa*\n2️⃣ Suba sua *logo e cor* — todo documento e proposta já sai com a sua marca ✅`,
    `Qualquer dúvida — de verdade, qualquer uma — me chama *aqui mesmo neste número*. Eu te respondo. Bom uso e boas vendas! 🚀`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, nome || null, [{ role: 'assistant', content: fullText }]);
}

// RECUPERAÇÃO de checkout abandonado / cartão recusado (público). A pessoa começou
// a assinar e não concluiu. Tom gentil, oferece ajuda + link pra retomar. Best-effort:
// o chamador envolve em try/catch e o teto anti-ban se aplica (não pode virar flood).
export async function sendCheckoutRecoveryWhatsApp(phone: string, produto: string, recoverUrl: string, nome?: string | null): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');
  const firstName = (nome || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Oi ${firstName}!` : 'Oi!';

  const parts = [
    `${greeting} 🌞 Sou a Giovanna, da SolarDoc Pro. Vi que você começou a assinar o *${produto}* mas o pagamento não finalizou — deu algum problema?`,
    `Se quiser, retomar leva 1 minutinho e seus *7 dias grátis* continuam de pé:\n\n🔗 ${recoverUrl}`,
    `Qualquer dúvida (cartão, plano, o que for), me chama *aqui mesmo neste número* que eu te ajudo. 🙌`,
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

// Linguagem que PRECEDE uma denúncia (Procon, "spam", ameaça de reportar/processar).
// É o sinal que estamos correndo pra bater ANTES da denúncia — dispara a remoção
// imediata (deleta FREE / silencia pagante) + entra na lista de bloqueio.
const DENUNCIA_PATTERNS = /\b(vou denunciar|vou te denunciar|vou reportar|isso (é|e) spam|isso aqui (é|e) spam|que spam|procon|vou (te )?processar|vou no procon|abusiv|me tira(r)? (daqui|disso|dessa porra)|n[aã]o autorizei|nunca autorizei|para de me perturbar|para de perturbar|me deixa em paz|para com isso porra|encheu o saco)\b/i;

export interface IncomingMedia {
  url: string;
  type: string; // 'audio' | 'image' | 'video' | 'document'
  mime: string;
}

// Grava o contato na lista de bloqueio (whatsapp_suppression) pra NUNCA mais ser
// contatado — sobrevive à deleção do user e é consultada pela cadência e pelo
// disparo em massa. phone guardado como só-dígitos.
async function bloquearContato(phone: string, motivo: string, userDeletado: boolean): Promise<void> {
  const phoneDigits = (phone || '').replace(/\D/g, '');
  if (!phoneDigits) return;
  await supabase.from('whatsapp_suppression').upsert(
    { phone: phoneDigits, motivo, origem: 'giovanna_followup', user_deletado: userDeletado },
    { onConflict: 'phone' },
  );
}

// Cliente pediu CLARAMENTE pra não ser mais atendido (opt-out forte ou denúncia).
// Regra: FREE → DELETA o registro (FKs são CASCADE/SET NULL, o DELETE é limpo).
// PRO/VIP → NUNCA deleta (está pagando!) — só silencia. Em AMBOS os casos grava
// na lista de bloqueio pra nunca re-contatar (anti-denúncia de verdade).
async function excluirOuSilenciarContato(
  user: { id: string; email: string; plano: string },
  phone: string,
  motivo: 'opt_out' | 'denuncia',
): Promise<{ deletado: boolean }> {
  const ehPagante = user.plano === 'pro' || user.plano === 'ilimitado';

  // Silencia SEMPRE primeiro (idempotente; garante parada mesmo se o delete falhar).
  await supabase.from('users')
    .update({ whatsapp_opt_out: true, email_opt_out: true })
    .eq('id', user.id);

  if (ehPagante) {
    await bloquearContato(phone, motivo, false);
    return { deletado: false };
  }

  // FREE → deleta o registro. Bloqueia ANTES do delete (a suppression sobrevive).
  await bloquearContato(phone, motivo, true);
  try {
    await supabase.from('users').delete().eq('id', user.id);
    return { deletado: true };
  } catch (err) {
    // Se o delete falhar por algum motivo, o opt-out + bloqueio já garantem a parada.
    logger.error('giovanna-optout', `delete falhou pra user ${user.id}, ficou só silenciado`, err);
    return { deletado: false };
  }
}

// ─── resposta a mensagem recebida ────────────────────────────────
export async function handleIncomingWhatsApp(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null },
  media?: IncomingMedia,
  // Linha de origem (de qual número o cliente escreveu). Default 'solardoc' pra
  // retrocompat; 'io' quando a mensagem veio da linha IO. Todas as RESPOSTAS de inbound
  // saem por ela → cliente é respondido pelo MESMO número que contatou.
  originInstance: ZapiInstance = 'solardoc',
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

    // B2B signals (SolarDoc) — inclui typos comuns ("soladoc") e variacoes.
    // Match é lowerText.includes(t): use SUBSTRING robusta, não a frase inteira, pra
    // pegar pontuação/sufixo do anúncio ("...SolarDoc.App" → "solardoc.app" ainda casa).
    const B2B_TRIGGERS = [
      'eu quero o solardoc', 'eu quero a solardoc',
      'eu quero o soladoc',  'eu quero a soladoc',
      'quero o solardoc',    'quero a solardoc',
      'quero o soladoc',     'quero a soladoc',
      'quero conhecer a solardoc', 'quero conhecer o solardoc',
      // Gatilho do anúncio Meta B2B (jul/2026). O texto REAL do anúncio é
      // "Quero saber mais sobre o SolarDoc.App" — cobrimos "sobre o/a", "da/do" e
      // a forma mínima "mais solardoc" pra pegar qualquer variação que o lead digite.
      // Match é lowerText.includes(t): o ".app" e a pontuação caem fora e ainda casa.
      'saber mais sobre o solardoc', 'saber mais sobre a solardoc',
      'saber mais sobre o soladoc',  'saber mais sobre a soladoc',
      'saber mais da solardoc', 'saber mais do solardoc',
      'saber mais da soladoc',  'saber mais do soladoc',
      'mais sobre o solardoc', 'mais sobre a solardoc',
      'sobre o solardoc.app', 'sobre a solardoc.app',
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

    // Roteamento: prioriza sessão existente, depois trigger, depois ad (B2B por default).
    // originInstance vai pra Carla → ela responde pela MESMA linha que o lead contatou
    // (o lead do anúncio na linha IO recebe resposta do número da IO, não da solardoc).
    if (b2bSession || isB2bTriggered) {
      const { handleSolarDocB2bLead } = await import('../sdr/sdrB2bAgentService');
      await handleSolarDocB2bLead(cleanPhone, text, senderName, tracking, imageSource, originInstance);
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
      await handleSolarDocB2bLead(cleanPhone, text, senderName, tracking, imageSource, originInstance);
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

  // Cliente deixou CLARO que não quer mais ser atendido. Dois níveis:
  // - DENÚNCIA (procon/spam/processar/"me deixa em paz"): remoção imediata.
  // - OPT-OUT ("não quero mais", "para de mandar"): também remove.
  // Regra (excluirOuSilenciarContato): FREE → DELETA o registro; PRO/VIP → só
  // silencia (não apaga quem paga). Em ambos, entra na lista de bloqueio pra
  // NUNCA re-contatar (mesmo se o número for raspado de novo). Anti-denúncia.
  const ehDenuncia = DENUNCIA_PATTERNS.test(text);
  if (ehDenuncia || OPT_OUT_PATTERNS.test(text)) {
    // Despede com classe ANTES de deletar (depois o registro pode sumir). Pela linha de origem.
    await sendHuman(cleanPhone, [
      'Entendido, vou parar por aqui e não te incomodo mais.',
      'Se um dia precisar, é só me chamar. Abraço!',
    ], originInstance).catch(() => {});
    await excluirOuSilenciarContato(user, cleanPhone, ehDenuncia ? 'denuncia' : 'opt_out');
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

  // ANTI-LOOP DE 2 IAs (teto de turnos). Caso real: a gente faz outbound pra
  // empresas de solar (B2B) e MUITAS têm autoresponder/chatbot. O bot delas
  // responde a Giovanna, a Giovanna responde de volta, e vira loop infinito de
  // despedidas ("abraço! até logo 👋" × N) — queima mensagem e arrisca ban.
  // Prompt não segura (Haiku ignora o anti-loop soft). Teto DURO: passou de
  // MAX_TURNOS_AUTO respostas nossas, PARA de responder e deixa pro humano.
  const MAX_TURNOS_AUTO = 12;
  const turnosNossos = session.messages.filter((m) => m.role === 'assistant').length;
  if (turnosNossos >= MAX_TURNOS_AUTO) {
    logger.info('giovanna-antiloop', `sessão ${cleanPhone} atingiu ${turnosNossos} turnos — para de auto-responder (provável loop bot-bot / handoff humano)`);
    // Marca como respondido pra sair de qualquer cadência e não reabrir o ciclo.
    await supabase.from('users').update({ whatsapp_replied_at: new Date().toISOString() }).eq('id', user.id);
    return; // silêncio: não responde mais nada automaticamente
  }

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

  // Sonnet (não Haiku): a Giovanna é vendedora consultiva de alto calibre — precisa de
  // raciocínio de venda, naturalidade e nuance que o Haiku não entrega (ele ignora o
  // anti-loop soft e soa robótico). Volume de inbound é baixo (dezenas/mês), então o
  // custo extra por msg é irrelevante frente ao ganho de conversão. Decisão do Thiago (jul/2026).
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: buildSystemPrompt(userCtx, promoCtx),
    messages,
  });

  const raw = (response.content[0] as { text: string }).text;

  // ESCALAÇÃO PRA HUMANO via tag [HUMANO] (espelha o padrão [PERDIDO]/[ESCALAR]): quando a
  // Giovanna diz que vai chamar o time, o código REGISTRA de fato o chamado — senão o cliente
  // (pagante!) ficava no vácuo. Detecção == strip (simétrico) pra a tag NUNCA vazar pro cliente.
  const pedeHumano = /\[HUMANO\]/i.test(raw);
  const limpo = raw.replace(/\[HUMANO\]/ig, '').trim();
  const parts = limpo.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts, originInstance);  // responde pela linha que o cliente contatou

  if (pedeHumano) {
    // Guard: 1 chamado por sessão (senão um modelo tagarela re-emite [HUMANO] e spamma
    // chamado pro pagante). Só abre se não houver chamado 'aberto' pra este telefone.
    const { data: aberto } = await supabase
      .from('tech_issues').select('id').eq('phone', cleanPhone).eq('status', 'aberto').limit(1).maybeSingle();
    if (!aberto) {
      try {
        await supabase.from('tech_issues').insert({
          phone: cleanPhone, nome: nome || null, area: 'atendimento_giovanna',
          descricao: (text || '').slice(0, 500),
          diagnostico_automatico: `escalado pela Giovanna (plano ${user.plano}, ${user.email})`.slice(0, 500),
          status: 'aberto',
        });
        logger.info('giovanna-escalar', `chamado aberto ${cleanPhone} (${user.email})`);
      } catch (e) {
        logger.error('giovanna-escalar', `registrar chamado falhou ${cleanPhone}`, e);
      }
    }
  }

  await saveSession(cleanPhone, user.id, [
    ...messages,
    { role: 'assistant', content: raw },
  ], nome);
}
