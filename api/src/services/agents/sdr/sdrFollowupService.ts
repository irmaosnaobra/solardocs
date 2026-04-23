import { supabase } from '../../utils/supabase';

const ZAPI_INSTANCE = process.env.ZAPI_INSTANCE_ID?.trim();
const ZAPI_TOKEN    = process.env.ZAPI_TOKEN?.trim();
const ZAPI_CLIENT   = process.env.ZAPI_CLIENT_TOKEN?.trim();

const MAX_CONTATOS = 5;

// Intervalos entre tentativas (em minutos) conforme solicitação
// 30min, 1dia (1440), 2dias (2880), 3dias (4320), 5dias (7200)
const INTERVALOS_MIN = [30, 1440, 2880, 4320, 7200];

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

  const nome = session?.nome || lead.nome || 'lá';

  const regras = [
    { t: 1, msg: `${nome}, esqueci de perguntar: você já tem uma média de quanto quer pagar na sua conta de luz ou quer zerar ela de vez? 🤔` },
    { t: 2, msg: `Oi ${nome}, tudo bem? Deixei separado aqui uma simulação de economia para a região de ${lead.cidade || 'Uberlândia'}, mas preciso confirmar seu telhado para te enviar. Consegue me falar agora?` },
    { t: 3, msg: `Passando para avisar que o engenheiro vai estar na sua região amanhã. Se conseguirmos alinhar agora, consigo incluir sua visita técnica sem custo. Vamos fechar isso?` },
    { t: 4, msg: `${nome}, vi que você ainda não conseguiu ver minha última mensagem. Tem alguma dúvida sobre o sistema ou o financiamento que eu possa te ajudar agora?` },
    { t: 5, msg: `${nome}, entendo que as coisas correm por aí. Vou encerrar seu atendimento por aqui para focar nos projetos desta semana. Se ainda quiser economizar, me avisa aqui! Abs.` },
  ];

  const match = regras.find(r => r.t === tentativa);
  if (match) return match.msg;

  // Fallback caso saia do range (não deveria)
  return `Oi ${nome}, ainda tem interesse na energia solar?`;
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
