// ════════════════════════════════════════════════════════════
// CARLA — BOM DIA HOOK (broadcast diário 9h)
// ════════════════════════════════════════════════════════════
// Manda uma mensagem leve de "bom dia" pra leads B2B em estágio
// novo/frio/morno que ficaram quietos. A pergunta de abertura
// "você sobe em telhado ainda?" é gancho clássico de integrador
// solar — quem é do ramo responde no instinto, quem não é fica claro.
//
// Roda dentro do master cron (09:30 BRT). NÃO conflita com a cadência
// normal do followup (sdrB2bFollowupService): aqui só pega leads que
// não foram tocados nas últimas 20h.
//
// Variação de aberturas: 6 templates rotativos pra não soar copy-paste
// em quem voltar a receber por 6 dias seguidos.
// ════════════════════════════════════════════════════════════

import { supabase } from '../../../utils/supabase';
import { sendZAPI as sendWA } from '../zapiClient';
import { logger } from '../../../utils/logger';

const ABERTURAS = [
  (n: string) => `Bom dia, ${n}! Você sobe em telhado ainda? 😄`,
  (n: string) => `Bom dia, ${n}. Tô aqui pensando em você — ainda no solar?`,
  (n: string) => `Oi ${n}, bom dia! Como tá a venda essa semana?`,
  (n: string) => `Bom dia, ${n}! Fechou contrato hoje?`,
  (n: string) => `${n}, bom dia. Tem cliente novo na agenda?`,
  (n: string) => `Bom dia, ${n}! Como tá o pipe da semana — algum cliente quente?`,
];

interface MorningLead {
  phone: string;
  nome?: string;
  ultimo_contato?: string;
  updated_at?: string;
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}

export async function runCarlaMorningBroadcast(): Promise<{ enviados: number; pulados: number }> {
  const now = new Date();
  const cutoffMs = 20 * 60 * 60 * 1000; // 20h — evita conflito com followup que pode ter rodado de manhã também
  const idxBase = dayOfYear(now); // rotaciona abertura por dia (mesma pra todos no dia, varia entre dias)

  const { data: leads, error } = await supabase
    .from('sdr_leads')
    .select('phone, nome, ultimo_contato, updated_at')
    .eq('tipo', 'b2b')
    .eq('human_takeover', false)
    .eq('aguardando_resposta', true)
    .in('estagio', ['novo', 'frio', 'morno']);

  if (error) {
    logger.error('carla-morning', 'erro buscando leads B2B', error);
    return { enviados: 0, pulados: 0 };
  }
  if (!leads?.length) return { enviados: 0, pulados: 0 };

  let enviados = 0;
  let pulados = 0;

  for (const lead of leads as MorningLead[]) {
    if (!lead.nome) { pulados++; continue; } // não manda sem nome — fica frio demais

    const ultimo = new Date((lead.ultimo_contato ?? lead.updated_at) ?? 0).getTime();
    if (now.getTime() - ultimo < cutoffMs) { pulados++; continue; }

    const primeiroNome = lead.nome.trim().split(/\s+/)[0];
    const msg = ABERTURAS[idxBase % ABERTURAS.length](primeiroNome);

    try {
      await sendWA(lead.phone, msg, 'solardoc');

      // Salva no histórico da sessão B2B
      const { data: session } = await supabase
        .from('whatsapp_sessions')
        .select('messages')
        .eq('phone', lead.phone)
        .eq('tipo', 'sdr_b2b')
        .maybeSingle();
      const oldMessages = (session?.messages as { role: string; content: string }[]) || [];
      const newMessages = [...oldMessages, { role: 'assistant', content: msg }];
      await supabase.from('whatsapp_sessions').upsert({
        phone: lead.phone,
        tipo: 'sdr_b2b',
        messages: newMessages.slice(-80),
        updated_at: now.toISOString(),
      }, { onConflict: 'phone,tipo' });

      await supabase.from('sdr_leads').update({
        ultimo_contato: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq('phone', lead.phone);

      enviados++;
    } catch (err) {
      logger.error('carla-morning', `falha enviando pra ${lead.phone}`, err);
      pulados++;
    }
  }

  logger.info('carla-morning', `broadcast bom dia: ${enviados} enviados, ${pulados} pulados de ${leads.length} candidatos`);
  return { enviados, pulados };
}
