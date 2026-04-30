import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendMetaEvent } from '../../../utils/metaPixel';
import { sendHuman } from '../zapiClient';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';
const MAX_HISTORY = 40;

// ─── system prompt SDR B2B (Carla — SolarDoc) ──────────────────────

const CARLA_SYSTEM_PROMPT = `Voce eh "Carla", consultora comercial da SolarDoc Pro. Sua missao eh qualificar empresarios de energia solar e converter em signup gratuito (10 documentos) ou agendar demo se for empresa grande.

# CONTEXTO
- O lead clicou em um anuncio sobre SolarDoc Pro: SaaS que gera contratos, propostas bancarias, procuracoes, contratos PJ e prestacao de servico para empresas de energia solar — em 2 minutos.
- O lead eh empresario solar (dono ou socio de empresa de instalacao), NAO eh dono de casa querendo instalar painel.
- A SolarDoc nasceu dentro da Irmaos na Obra (8 anos no setor solar). Foi feita por integradores pra integradores.
- 10 documentos no plano Free sao vitalicios (nao expiram) e nao precisam de cartao.

# PERSONALIDADE
- WhatsApp: direta, curta, profissional. Sem pressao de venda.
- Tom de quem entende do setor (nao vendedora generica).
- Emojis com moderacao (1 por mensagem maximo).
- NUNCA textos longos. Maximo 2 linhas por bolha.

# REGRAS DE OURO
1. Pergunte UMA coisa por vez. Espere resposta.
2. NAO explique todo o produto antes de qualificar.
3. Se perguntar "quanto custa", responda: "Antes do valor te pergunto: voce ja tem empresa solar com CNPJ ativo? Eh pra te indicar o melhor caminho — tem opcao gratuita."
4. Use o nome assim que ele informar.

# QUALIFICACAO (ordem fixa)
1. Nome
2. Tem empresa solar com CNPJ ativo? (sim/nao)
3. Quantas vendas/projetos voces fecham por mes em media?
4. Quem gera os documentos hoje? (voce / equipe / advogado / terceiros)
5. Qual o maior gargalo? (tempo / qualidade / aprovacao banco / cliente esfria)

# CTA POR PORTE

| Vendas/mes | Fechamento |
|---|---|
| Sem CNPJ ainda | Explica que precisa de CNPJ pra usar, pede pra voltar quando abrir empresa |
| 1-4 vendas | Manda direto pro signup gratis: ${APP_URL}/auth — "10 documentos vitalicios, sem cartao" |
| 5-20 vendas | Signup gratis primeiro pra ele testar, depois sugere PRO ou VIP se gostar |
| 20+ vendas | Sugere demo de 20min com a equipe (se topar, pega email pra agendar) |

# FORMATO OBRIGATORIO
- Separe bolhas com ||
- Maximo 3 bolhas por resposta
- Cada bolha: 1-2 frases curtas

# ESTAGIO DO LEAD (OBRIGATORIO no fim)
[ESTAGIO:novo] - Sem nome ou nao confirmou se tem empresa
[ESTAGIO:frio] - Nao tem CNPJ ou descobriu que nao eh empresario solar
[ESTAGIO:morno] - Qualificou parcial, ainda sem CTA
[ESTAGIO:quente] - Qualificou completo, esperando ele clicar no link/agendar
[ESTAGIO:fechado] - Recebeu link de signup OU agendou demo
[ESTAGIO:perdido] - Recusou ou parou de responder`;

// ─── sessao ─────────────────────────────────────────────────────────

interface SdrB2bSession {
  messages: { role: 'user' | 'assistant'; content: string }[];
  nome?: string;
}

async function getSession(phone: string): Promise<SdrB2bSession> {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', phone)
    .eq('tipo', 'sdr_b2b')
    .single();
  return {
    messages: (data?.messages as any[]) || [],
    nome: data?.nome || undefined,
  };
}

async function saveSession(
  phone: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
  nome?: string | null,
): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY * 2);
  const payload: any = {
    phone,
    tipo: 'sdr_b2b',
    messages: trimmed,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── extracao de estagio ────────────────────────────────────────────

type Estagio = 'novo' | 'frio' | 'morno' | 'quente' | 'fechado' | 'perdido';

function extractEstagio(raw: string): { text: string; estagio: Estagio } {
  const match = raw.match(/\[ESTAGIO:(novo|frio|morno|quente|fechado|perdido)\]/i);
  const estagio = (match?.[1]?.toLowerCase() ?? 'novo') as Estagio;
  const text = raw.replace(/\[ESTAGIO:(novo|frio|morno|quente|fechado|perdido)\]/gi, '').trim();
  return { text, estagio };
}

// ─── CRM ────────────────────────────────────────────────────────────

async function upsertCrmLead(params: {
  phone: string;
  nome?: string | null;
  estagio: Estagio;
  ultimaMensagem: string;
  totalMensagens: number;
  tracking?: { ctwa_clid?: string | null };
}): Promise<void> {
  const { phone, nome, estagio, ultimaMensagem, totalMensagens, tracking } = params;

  const payload: any = {
    phone,
    tipo: 'b2b',
    estagio,
    ultima_mensagem: ultimaMensagem.slice(0, 300),
    total_mensagens: totalMensagens,
    aguardando_resposta: false,
    ultimo_contato: new Date().toISOString(),
    contatos: 0,
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  if (tracking?.ctwa_clid) payload.ctwa_clid = tracking.ctwa_clid;

  // Nao sobrescreve estagios protegidos
  const { data: existing } = await supabase
    .from('sdr_leads')
    .select('estagio, ctwa_clid')
    .eq('phone', phone)
    .single();

  const protegidos = ['fechado', 'perdido', 'quente'];
  if (existing?.estagio && protegidos.includes(existing.estagio)) {
    payload.estagio = existing.estagio;
  }

  // Lead novo + ctwa_clid → dispara CAPI Lead event
  if (!existing && tracking?.ctwa_clid) {
    await sendMetaEvent('Lead', {
      customData: { ctwa_clid: tracking.ctwa_clid, phone, lead_type: 'b2b_solardoc' },
    }).catch(console.error);
  }

  await supabase.from('sdr_leads').upsert(payload, { onConflict: 'phone' });
}

// ─── handler principal ──────────────────────────────────────────────

export async function handleSolarDocB2bLead(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null }
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');
  const session = await getSession(cleanPhone);
  const nome = session.nome || senderName || null;

  const messages = [
    ...session.messages,
    { role: 'user' as const, content: text.trim() },
  ];

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: CARLA_SYSTEM_PROMPT,
    messages: messages.filter(m => m.content),
  });

  const raw = (response.content[0] as { text: string }).text;
  const { text: cleanText, estagio } = extractEstagio(raw);
  const parts = cleanText.split('||').map(p => p.trim()).filter(Boolean);

  await sendHuman(cleanPhone, parts);

  const allMessages = [...messages, { role: 'assistant' as const, content: cleanText }];

  await Promise.all([
    saveSession(cleanPhone, allMessages, nome),
    upsertCrmLead({
      phone: cleanPhone,
      nome,
      estagio,
      ultimaMensagem: text,
      totalMensagens: allMessages.filter(m => m.role === 'user').length,
      tracking,
    }),
  ]);
}
