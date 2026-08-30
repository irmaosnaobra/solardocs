import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';

/**
 * QUEM RESPONDE UMA CAMPANHA NOSSA NÃO É LEAD DE ANÚNCIO.
 *
 * A linha IO tem um poller (`sdrIoPolling`) que trata todo inbound sem sessão como lead
 * novo e joga a Luma em cima dele, com a frase padrão do anúncio. Isso está certo pra quem
 * chega do tráfego — e errado pra quem está respondendo uma pergunta que a gente fez.
 *
 * O caso que trouxe isto (30/08/2026): a pesquisa do treinamento de ponto foi para 184
 * investidores da base. Sem desvio, quem respondesse "sim, fecharia" receberia um
 * atendimento automático sobre outro assunto — e a Luma tentaria AGENDAR REUNIÃO, que é
 * exatamente o que a régua de ponto próprio (29/08) acabou de proibir para quem não tem
 * local. A resposta da pesquisa vale mais que a venda: ela vai pra gente, não pro robô.
 *
 * A régua é conservadora de propósito: só desvia quem JÁ ESTÁ na base do eletroposto e NÃO
 * tem reunião futura marcada. Quem tem reunião continua com o agente de agendamento
 * (`eletropostoRespostas`), que sabe confirmar e remarcar; quem nunca apareceu na base
 * segue sendo lead novo de anúncio, com a Luma.
 */

export interface RespostaDeCampanha {
  telefone: string;
  nome: string;
  origem: 'reuniao' | 'ficha';
  /** O que a régua sabe dele — vai no aviso pra equipe decidir se responde na hora. */
  contexto: string;
}

/** DDD + os 8 últimos dígitos: a mesma forma canônica de `ep_tel_norm` no banco. */
function chave(tel: string | null | undefined): string | null {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 12 || d.length === 13) {
    if (!d.startsWith('55')) return null;
    const sem = d.slice(2);
    return sem.slice(0, 2) + sem.slice(-8);
  }
  if (d.length === 10 || d.length === 11) return d.slice(0, 2) + d.slice(-8);
  return null;
}

export async function respostaDeCampanhaPonto(phone: string): Promise<RespostaDeCampanha | null> {
  const alvo = chave(phone);
  if (!alvo) return null;

  try {
    const [ag, ficha] = await Promise.all([
      supabaseGerador.from('agendamentos')
        .select('cliente_nome, cliente_telefone, quando, status, tem_ponto, created_by')
        .eq('telefone_norm', alvo).order('quando', { ascending: false }).limit(5),
      supabaseGerador.from('eletroposto_nota1')
        .select('nome, telefone, tem_ponto, capital_faixa')
        .eq('telefone_norm', alvo).limit(1),
    ]);

    const fichas = (ag.data || []).filter(r => String(r.created_by || '').includes('eletroposto'));

    // Reunião futura de pé: quem fala com ele é o agente de agendamento, não este desvio.
    const agora = Date.now();
    const temFutura = fichas.some(r => r.status !== 'cancelado' && r.quando
      && new Date(r.quando as string).getTime() >= agora);
    if (temFutura) return null;

    if (fichas.length) {
      const r = fichas[0];
      const quando = r.quando
        ? new Date(r.quando as string).toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          })
        : 'sem horário';
      return {
        telefone: String(r.cliente_telefone || phone),
        nome: String(r.cliente_nome || 'sem nome'),
        origem: 'reuniao',
        contexto: `Já teve reunião de eletroposto (última: ${quando}). Ponto: ${r.tem_ponto || '—'}.`,
      };
    }

    if (ficha.data?.length) {
      const f = ficha.data[0] as Record<string, unknown>;
      return {
        telefone: String(f.telefone || phone),
        nome: String(f.nome || 'sem nome'),
        origem: 'ficha',
        contexto: `Ficha da LP que não virou reunião. Ponto: ${f.tem_ponto || '—'} · capital: ${f.capital_faixa || '—'}.`,
      };
    }

    return null;
  } catch (err) {
    // Falhou a leitura? Devolve null e o inbound segue o caminho normal — é melhor a Luma
    // atender um respondente do que ninguém atender um lead de verdade.
    logger.error('pesquisa-ponto', `falha checando ${phone}`, err);
    return null;
  }
}

/** O aviso que a equipe recebe. Curto: quem, o que ele escreveu e o que a base sabe dele. */
export function avisoDeResposta(r: RespostaDeCampanha, texto: string | null): string {
  return [
    '*RESPONDEU A PESQUISA DO PONTO*',
    `${r.nome} — wa.me/${String(r.telefone).replace(/\D/g, '')}`,
    texto ? `Disse: "${texto.slice(0, 220)}"` : 'Respondeu (sem texto legível).',
    r.contexto,
    'Robô não responde nesta conversa — a pesquisa é atendida por gente.',
  ].join('\n');
}
