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
        .select('cliente_nome, cliente_telefone, quando, status, tem_ponto, created_by, vendedor_nome')
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
      // O que decide o que dizer pra ele é o que ACONTECEU com a última reunião:
      // "cancelado" quase sempre é a régua do SIM (não confirmou e perdeu o
      // horário), e essa pessoa quer remarcar, não responder pesquisa.
      const dono = r.vendedor_nome ? ` com ${r.vendedor_nome}` : '';
      const desfecho = r.status === 'cancelado'
        ? ' — CANCELADA (não confirmou e perdeu o horário)'
        : r.status && r.status !== 'agendado' ? ` — ${String(r.status).replace(/_/g, ' ')}` : '';
      return {
        telefone: String(r.cliente_telefone || phone),
        nome: String(r.cliente_nome || 'sem nome'),
        origem: 'reuniao',
        contexto: `Última reunião: ${quando}${dono}${desfecho}. Ponto: ${r.tem_ponto || '—'}.`,
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

/**
 * O LEAD ESCREVEU, OU FOI SÓ A NOSSA MENSAGEM? (22/09/2026)
 *
 * O /chats da Z-API não devolve o texto do que NÓS mandamos, então "sem texto" é
 * o estado normal do eco do nosso próprio envio. Texto na última mensagem, ou um
 * recebimento registrado pela recepção, são as duas provas de que foi ele.
 * Pura: quem lê o banco é o chamador.
 */
export function pareceMensagemDoLead(texto: string | null | undefined, inboundRecebido: boolean): boolean {
  return String(texto || '').trim().length > 0 || inboundRecebido;
}

/** O aviso que a equipe recebe. Curto: quem, o que ele escreveu e o que a base sabe dele. */
export function avisoDeResposta(r: RespostaDeCampanha, texto: string | null): string {
  return [
    '*ESCREVEU NA LINHA — JÁ ESTÁ NA BASE*',
    `${r.nome} — wa.me/${String(r.telefone).replace(/\D/g, '')}`,
    texto ? `Disse: "${texto.slice(0, 220)}"` : 'Mandou áudio, foto ou figurinha (sem texto).',
    r.contexto,
    'Robô não responde nesta conversa — a pesquisa é atendida por gente.',
  ].join('\n');
}
