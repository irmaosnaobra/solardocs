import { supabase } from '../utils/supabase';

const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID;
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN;
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN;
const APP_URL       = process.env.NEXT_PUBLIC_APP_URL || 'https://solardoc.pro';
const FOLLOWUP_START = new Date('2026-04-17T00:00:00-03:00');

const messages: Record<number, string> = {
  1: `☀️ *SolarDoc Pro* — falta só 1 passo!\n\nVocê criou sua conta mas ainda não informou o CNPJ da empresa. Com ele você já pode gerar contratos, procurações e propostas bancárias em menos de 2 minutos.\n\n👉 ${APP_URL}/login\n\nSeu teste é grátis, sem cartão de crédito.`,
  2: `Oi! Quanto tempo você perde por semana com contratos manuais? ⏱️\n\nCom o *SolarDoc Pro* você gera tudo em 2 minutos — contrato solar, procuração, proposta bancária e mais.\n\nAtive agora: ${APP_URL}/login`,
  3: `O *SolarDoc Pro* foi criado por integradores solares com *8 anos de mercado*. 🏆\n\nNão é ferramenta de TI — é de quem vive o setor. Cada documento já nasce correto, completo e pronto para assinar.\n\nComece grátis: ${APP_URL}/login`,
  4: `📋 *5 documentos que você pode gerar hoje:*\n\n⚡ Contrato de Instalação Solar\n🏦 Proposta Bancária\n📄 Procuração de Acesso\n💼 Contrato PJ\n🤝 Prestação de Serviço\n\nTodos prontos em menos de 2 minutos: ${APP_URL}/login`,
  5: `Seu teste gratuito ainda está esperando! 🎁\n\n*10 documentos grátis*, sem cartão, sem prazo de expiração. Só precisa informar o CNPJ da sua empresa.\n\n👉 ${APP_URL}/login`,
  6: `Integradores que usam o *SolarDoc Pro* enviam o contrato no mesmo dia da visita técnica. 📱\n\nSem voltar ao escritório. Sem Word. Sem retrabalho.\n\nExperimente grátis: ${APP_URL}/login`,
  7: `🔔 Último aviso — seu acesso gratuito ainda está disponível.\n\nO *SolarDoc Pro* foi feito por integradores que se cansaram de perder tempo com burocracia. 8 anos de mercado numa ferramenta simples.\n\nAtive agora: ${APP_URL}/login`,
};

function fmtPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

async function sendWhatsApp(phone: string, message: string): Promise<void> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) throw new Error('Z-API não configurado');
  const res = await fetch(
    `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
      body: JSON.stringify({ phone: fmtPhone(phone), message }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Z-API error ${res.status}: ${body}`);
  }
}

export async function runWhatsappFollowup(): Promise<{ sent: number; skipped: number }> {
  const { data: usersWithCompany } = await supabase.from('company').select('user_id');
  const excludedIds = (usersWithCompany ?? []).map((c: any) => c.user_id).filter(Boolean);

  const { data: users } = await supabase
    .from('users')
    .select('id, whatsapp, followup_started_at')
    .not('id', 'in', excludedIds.length > 0 ? `(${excludedIds.join(',')})` : '(00000000-0000-0000-0000-000000000000)')
    .not('whatsapp', 'is', null)
    .not('followup_started_at', 'is', null);

  if (!users || users.length === 0) return { sent: 0, skipped: 0 };

  const now = new Date();
  let sent = 0, skipped = 0;

  for (const user of users) {
    if (!user.whatsapp) { skipped++; continue; }

    const baseDate = user.followup_started_at
      ? new Date(user.followup_started_at)
      : new Date();
    const diffDays = Math.floor((now.getTime() - baseDate.getTime()) / 86400000);
    const day = diffDays + 1;

    if (day >= 1 && day <= 7) {
      try {
        await sendWhatsApp(user.whatsapp, messages[day]);
        sent++;
      } catch (err) {
        console.error(`WhatsApp followup failed for user ${user.id} day ${day}:`, err);
      }
    }
  }

  return { sent, skipped };
}
