import { supabase } from '../../../utils/supabase';
import { sendZAPI as sendWA, type ZapiInstance } from '../zapiClient';
import { logger } from '../../../utils/logger';

const MAX_CONTATOS = 5;

const INTERVALOS_MIN = [30, 1440, 2880, 4320, 7200];

// ─── Gera mensagem de follow-up personalizada ─────────────────────

interface SdrLead {
  phone: string;
  nome?: string;
  cidade?: string;
  estagio?: string;
  contatos?: number;
  ultimo_contato?: string;
  updated_at?: string;
  aguardando_resposta?: boolean;
  instance?: ZapiInstance;
}

async function gerarFollowup(lead: SdrLead, tentativa: number): Promise<string> {
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

  const { data: leads } = await supabase
    .from('sdr_leads')
    .select('phone, nome, cidade, contatos, ultimo_contato, updated_at, instance')
    .eq('aguardando_resposta', true)
    .not('estagio', 'in', '("perdido","fechamento","quente")')
    .lt('contatos', MAX_CONTATOS);

  if (!leads?.length) return { enviados: 0, perdidos: 0 };

  let enviados = 0;
  let perdidos = 0;

  for (const lead of leads as SdrLead[]) {
    const contatos = lead.contatos ?? 0;
    const ultimoContato = new Date((lead.ultimo_contato ?? lead.updated_at) ?? 0);
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
      // Envia pela mesma linha em que o lead foi atendido (default 'solardoc' pra leads antigos)
      const instance: ZapiInstance = lead.instance === 'io' ? 'io' : 'solardoc';
      await sendWA(lead.phone, msg, instance);

      await supabase.from('sdr_leads').update({
        contatos: proximasTentativas,
        ultimo_contato: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq('phone', lead.phone);

      enviados++;
    } catch (err) {
      logger.error('sdr-followup', `Erro ao enviar follow-up para ${lead.phone}`, err);
    }
  }

  return { enviados, perdidos };
}
