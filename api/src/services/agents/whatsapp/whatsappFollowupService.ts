import { supabase } from '../../utils/supabase';

const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID?.trim();
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN?.trim();
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN?.trim();
const APP_URL       = 'https://solardocs-dashboard.vercel.app';
const FOLLOWUP_START = new Date('2026-04-17T00:00:00-03:00');

// ─── 14 mensagens: manhã e tarde por 7 dias ──────────────────────
const MESSAGES: Record<string, string> = {
  '1m': `☀️ *Bom dia!* Aqui é a assistente da Irmãos na Obra.\n\nVocê se cadastrou no SolarDoc Pro mas ainda não informou o CNPJ da sua empresa. Só falta isso pra você gerar contratos, procurações e propostas em 2 minutos!\n\n👉 ${APP_URL}/login`,

  '1t': `Boa tarde! 👋 Passando pra lembrar que seus *10 documentos gratuitos* estão esperando.\n\nSem cartão. Sem prazo. Só o CNPJ da empresa.\n\n➡️ ${APP_URL}/login`,

  '2m': `*Bom dia!* Você sabia que o contrato de instalação solar gerado aqui já sai com todas as cláusulas de garantia e prazos? ⚡\n\nNenhum Word, nenhum copy-paste. Tudo automático em 2 minutos.\n\nAtive agora: ${APP_URL}/login`,

  '2t': `Boa tarde! Integradores com 8 anos de mercado criaram essa ferramenta pra resolver um problema real: *burocracia que consome tempo de venda.* 🏆\n\nComece grátis: ${APP_URL}/login`,

  '3m': `*Bom dia!* Já são 3 dias com seus documentos gratuitos parados. 😅\n\nA proposta bancária que a gente gera já sai no formato que os bancos aceitam — sem precisar ajustar nada.\n\nCadastre o CNPJ e teste: ${APP_URL}/login`,

  '3t': `Boa tarde! Uma dúvida rápida: tem alguma coisa travando o cadastro da empresa? 🤔\n\nPosso te ajudar se precisar. Só responder aqui que a gente resolve junto.`,

  '4m': `*Bom dia!* A procuração de acesso à concessionária é o documento mais pedido pelos integradores aqui. 📋\n\nJá sai no modelo aceito pelas principais distribuidoras do Brasil. Gera em 2 minutos.\n\n${APP_URL}/login`,

  '4t': `Boa tarde! Cada dia sem o SolarDoc é um contrato feito no braço — Word, PDF, copia e cola, revisão… ⏱️\n\nSeu concorrente pode já estar usando. Não perca tempo: ${APP_URL}/login`,

  '5m': `*Bom dia!* Só um lembrete: 5 tipos de documento disponíveis no plano gratuito.\n\n📄 Contrato Solar · 🏦 Proposta Bancária · 📋 Procuração · 💼 Contrato PJ · 🤝 Prestação de Serviço\n\nAtive: ${APP_URL}/login`,

  '5t': `Boa tarde! Antes de fechar mais uma venda hoje, pensa: *quanto tempo você gasta com o contrato depois?* 🤔\n\nSolarDoc resolve isso em 2 minutos. Grátis pra testar: ${APP_URL}/login`,

  '6m': `*Bom dia!* Quase desistindo de te avisar… mas não consigo sem antes perguntar:\n\n*Tem alguma dúvida que eu possa tirar?* Responde aqui que a gente resolve na hora. 😊`,

  '6t': `Boa tarde! Uma última tentativa de te ajudar hoje: se tiver qualquer dificuldade pra cadastrar o CNPJ, me chama que resolvo junto.\n\nSeu teste gratuito continua disponível: ${APP_URL}/login`,

  '7m': `*Bom dia!* Última mensagem, prometo. 🙏\n\nSeus 10 documentos gratuitos ainda estão disponíveis. Se um dia precisar, é só acessar e cadastrar sua empresa:\n\n👉 ${APP_URL}/login\n\nSempre que precisar, estamos aqui!`,

  '7t': `Foi ótimo ter você por aqui. Se precisar de documentação solar profissional no futuro, o SolarDoc Pro estará esperando — grátis pra começar.\n\n🌞 Boas vendas! ${APP_URL}/login`,
};

// ─── mensagens para usuários inativos (com CNPJ, 3+ dias sem doc) ─
const INACTIVE_MESSAGES = [
  `Oi! Como estão as vendas? ☀️\n\nFaz alguns dias que não gera documentos por aqui. Tem algum projeto chegando que posso te ajudar?`,
  `Boa! Passando pra ver se está tudo certo com a plataforma. 😊\n\nQualquer dúvida ou dificuldade, é só chamar aqui!`,
  `Lembrete amigável: seus documentos estão prontos pra qualquer proposta ou contrato que aparecer. ⚡\n\nComo estão as vendas no setor?`,
];

function fmtPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  return d.startsWith('55') ? d : `55${d}`;
}

async function sendZAPI(phone: string, message: string): Promise<void> {
  if (!ZAPI_INSTANCE || !ZAPI_TOKEN || !ZAPI_CLIENT) return;
  await fetch(`https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_CLIENT },
    body: JSON.stringify({ phone: fmtPhone(phone), message }),
  });
}

// ─── followup sem CNPJ ────────────────────────────────────────────

export async function runWhatsappFollowup(period: 'morning' | 'evening'): Promise<{ sent: number; abandoned: number }> {
  const { data: usersWithCompany } = await supabase.from('company').select('user_id');
  const excludedSet = new Set((usersWithCompany ?? []).map((c: any) => c.user_id).filter(Boolean));

  const { data: allUsers } = await supabase
    .from('users')
    .select('id, whatsapp, followup_started_at, followup_abandoned')
    .not('whatsapp', 'is', null)
    .not('followup_started_at', 'is', null)
    .eq('followup_abandoned', false);

  const users = (allUsers ?? []).filter(u => !excludedSet.has(u.id));
  if (!users.length) return { sent: 0, abandoned: 0 };

  const now = new Date();
  const suffix = period === 'morning' ? 'm' : 't';
  let sent = 0, abandoned = 0;

  for (const user of users) {
    if (!user.whatsapp) continue;

    const baseDate = new Date((user.followup_started_at as string).replace(' ', 'T') + 'Z');
    const diffDays = Math.floor((now.getTime() - baseDate.getTime()) / 86400000) + 1;

    if (diffDays > 7) {
      // Marca como perdido
      await supabase.from('users').update({ followup_abandoned: true }).eq('id', user.id);
      abandoned++;
      continue;
    }

    const key = `${diffDays}${suffix}`;
    const msg = MESSAGES[key];
    if (!msg) continue;

    try {
      await sendZAPI(user.whatsapp, msg);
      await supabase.from('users').update({ followup_last_sent_at: now.toISOString() }).eq('id', user.id);
      sent++;
    } catch (err) {
      console.error(`WhatsApp followup error ${user.id}:`, err);
    }
  }

  return { sent, abandoned };
}

// ─── engajamento usuários inativos ────────────────────────────────

export async function runInactiveEngagement(): Promise<{ sent: number }> {
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();

  // Usuários com empresa mas sem documento nos últimos 3 dias
  const { data: companies } = await supabase.from('company').select('user_id');
  const companyUserIds = (companies ?? []).map((c: any) => c.user_id).filter(Boolean);

  if (!companyUserIds.length) return { sent: 0 };

  // Busca último documento de cada usuário
  const { data: recentDocs } = await supabase
    .from('documents')
    .select('user_id, created_at')
    .in('user_id', companyUserIds)
    .gte('created_at', threeDaysAgo);

  const activeIds = new Set((recentDocs ?? []).map((d: any) => d.user_id));

  // Usuários com empresa, com WhatsApp, mas inativos há 3+ dias
  const { data: inactiveUsers } = await supabase
    .from('users')
    .select('id, whatsapp, followup_last_sent_at')
    .in('id', companyUserIds)
    .not('whatsapp', 'is', null);

  const targets = (inactiveUsers ?? []).filter(u => {
    if (activeIds.has(u.id)) return false;
    // Não incomodar mais de 1x por 3 dias
    if (u.followup_last_sent_at) {
      const lastSent = new Date((u.followup_last_sent_at as string).replace(' ', 'T') + 'Z');
      if (Date.now() - lastSent.getTime() < 3 * 86400000) return false;
    }
    return true;
  });

  let sent = 0;
  for (const user of targets) {
    if (!user.whatsapp) continue;
    const msg = INACTIVE_MESSAGES[Math.floor(Math.random() * INACTIVE_MESSAGES.length)];
    try {
      await sendZAPI(user.whatsapp, msg);
      await supabase.from('users').update({ followup_last_sent_at: new Date().toISOString() }).eq('id', user.id);
      sent++;
    } catch (err) {
      console.error(`Inactive engagement error ${user.id}:`, err);
    }
  }
  return { sent };
}
