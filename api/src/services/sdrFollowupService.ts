import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabase';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN;

// Grupo de vendedores para alertas de lead quente
const GRUPO_VENDEDORES = process.env.GRUPO_VENDEDORES || '120363423844943015-group';

const MAX_CONTATOS = 10;

// Intervalos entre tentativas (em minutos)
const INTERVALOS_MIN = [10, 60, 240, 720, 1440, 2880, 4320, 5760, 7200, 8640];
// 10min, 1h, 4h, 12h, 1dia, 2dias, 3dias, 4dias, 5dias, 6dias

function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}

async function zapiPost(path: string, body: unknown): Promise<void> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) return;
  try {
    await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
      body: JSON.stringify(body),
    });
  } catch {}
}

async function sendWA(phone: string, message: string): Promise<void> {
  await zapiPost('send-text', { phone: fmtPhone(phone), message });
}

// ─── Gera mensagem de follow-up personalizada ─────────────────────

async function gerarFollowup(lead: any, tentativa: number): Promise<string> {
  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('messages, nome')
    .eq('phone', lead.phone)
    .eq('tipo', 'sdr')
    .single();

  const historico = (session?.messages as any[] ?? []).slice(-6);
  const nome = session?.nome || lead.nome || '';

  const prompt = `Você é SDR da Irmãos na Obra Energia Solar.
É a tentativa ${tentativa} de ${MAX_CONTATOS} de entrar em contato com ${nome || 'esse lead'} que não respondeu.
Histórico da conversa até agora: ${JSON.stringify(historico)}
Escreva UMA mensagem curta de follow-up no WhatsApp (máximo 2 frases) que seja natural, não pareça spam e mantenha o contexto da conversa.
Tentativa ${tentativa}: ${getTom(tentativa)}
Responda APENAS com o texto da mensagem, sem explicações.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  });

  return (response.content[0] as { text: string }).text.trim();
}

function getTom(tentativa: number): string {
  if (tentativa <= 2) return 'amigável e curioso, pergunta se viu a mensagem';
  if (tentativa <= 4) return 'cria curiosidade com um dado sobre economia solar';
  if (tentativa <= 6) return 'usa urgência suave, menciona que outras pessoas já instalaram';
  if (tentativa <= 8) return 'reconhece que está incomodando, oferece parar se não tiver interesse';
  return 'última tentativa, deseja sucesso e deixa porta aberta para o futuro';
}

// ─── Notifica atendente humano quando lead fica Quente ───────────

async function gerarResumoLead(phone: string, nome: string): Promise<string> {
  try {
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('messages')
      .eq('phone', phone)
      .eq('tipo', 'sdr')
      .single();

    const msgs = (session?.messages as any[] ?? []).slice(-20);
    if (!msgs.length) return 'Sem histórico de conversa disponível.';

    const historico = msgs
      .map((m: any) => `${m.role === 'user' ? '🧑 Lead' : '🤖 SDR'}: ${m.content}`)
      .join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 250,
      messages: [{
        role: 'user',
        content: `Com base nessa conversa de vendas, escreva um resumo executivo BREVE e PROFISSIONAL do lead para um vendedor humano fechar a venda. Máximo 4 linhas. Inclua: perfil de consumo, interesse demonstrado, objeções se houver e próximo passo sugerido. Seja direto e objetivo.

Conversa:
${historico}

Resumo:`
      }]
    });

    return (response.content[0] as { text: string }).text.trim();
  } catch {
    return 'Lead com alta intenção de compra identificada pela SDR.';
  }
}

export async function notificarAtendenteQuente(lead: any): Promise<void> {
  const nome = lead.nome || 'Lead sem nome';
  const cidade = lead.cidade ? `${lead.cidade}${lead.estado ? ` - ${lead.estado}` : ''}` : 'cidade não informada';
  const phone = lead.phone ? fmtPhone(lead.phone) : null;

  const resumo = await gerarResumoLead(lead.phone, nome);

  const waLink = phone ? `https://wa.me/${phone}` : null;

  const msg =
    `🔥 *OPORTUNIDADE DE VENDA — LEAD QUENTE!*\n\n` +
    `👤 *${nome}*\n` +
    `📍 ${cidade}\n\n` +
    `📋 *Resumo do lead:*\n${resumo}\n\n` +
    `👉 *Quem pegar primeiro, fecha!*\n` +
    (waLink ? `${waLink}\n` : '') +
    `⬆️ Toque no link e assuma agora. 🚀`;

  await sendWA(GRUPO_VENDEDORES, msg);
}

// ─── Cron: processa follow-ups pendentes ─────────────────────────

export async function runSdrFollowups(): Promise<{ enviados: number; perdidos: number }> {
  const now = new Date();

  // Busca leads aguardando resposta e não perdidos/fechados
  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('*')
    .eq('aguardando_resposta', true)
    .not('estagio', 'in', '("perdido","fechamento","quente")')
    .lt('contatos', MAX_CONTATOS);

  if (!leads?.length) return { enviados: 0, perdidos: 0 };

  let enviados = 0;
  let perdidos = 0;

  for (const lead of leads) {
    const contatos = lead.contatos ?? 0;
    const ultimoContato = new Date(lead.ultimo_contato || lead.updated_at);
    const minutos = (now.getTime() - ultimoContato.getTime()) / 60000;
    const intervaloNecessario = INTERVALOS_MIN[contatos] ?? 1440;

    if (minutos < intervaloNecessario) continue;

    const proximasTentativas = contatos + 1;

    if (proximasTentativas > MAX_CONTATOS) {
      // Marca como perdido após 10 tentativas
      await supabase.from('sdr_leads').update({
        estagio: 'perdido',
        aguardando_resposta: false,
        updated_at: now.toISOString(),
      }).eq('phone', lead.phone);
      perdidos++;
      continue;
    }

    try {
      const msg = await gerarFollowup(lead, proximasTentativas);
      await sendWA(lead.phone, msg);

      await supabase.from('sdr_leads').update({
        contatos: proximasTentativas,
        ultimo_contato: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq('phone', lead.phone);

      enviados++;
    } catch (err) {
      console.error(`Follow-up error ${lead.phone}:`, err);
    }
  }

  return { enviados, perdidos };
}
