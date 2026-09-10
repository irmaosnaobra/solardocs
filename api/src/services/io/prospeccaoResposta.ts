// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO — a cabeça. Lê o que o lead respondeu e decide o que fazer.
//
// Mora no servidor, não no worker, por dois motivos: a chave da Anthropic já
// está aqui (o worker fica sem segredo nenhum na máquina do consultor), e a
// regra de o-que-pode-afirmar vive no banco — o worker não precisa conhecê-la.
//
// O que ela NÃO faz: não envia. Devolve a decisão e o texto; quem digita é o
// worker, pelo Chrome do consultor. Separar isso é o que permite o `--dry`
// existir de verdade — dá pra ver a resposta que ela daria sem mandar nada.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { novoAnthropic } from "../../utils/anthropicClient";

const LOG = 'prospeccao-resposta';
const anthropic = novoAnthropic();

// Kill-switch. Sem ele, a única forma de parar a cabeça seria tirar a chave —
// e tirar a chave derruba os outros agentes junto.
const desligado = () => (process.env.PROSPECCAO_IA_OFF || '').trim() === 'true';

const Veredito = z.object({
  intencao: z.enum([
    'interessado', 'pediu_info', 'pediu_preco', 'quer_link', 'nao_e_decisor',
    'objecao', 'sem_interesse', 'parar', 'ambiguo', 'precisa_humano',
  ]),
  // O desfecho que vai pro log de toques. É o MESMO enum da tela: a cabeça não
  // inventa categoria nova, senão o funil e o disjuntor param de bater.
  resultado: z.enum(['respondeu', 'interessado', 'sem_interesse', 'nao_perturbar']),
  // Frase por frase, nunca parede de texto — regra da casa, e aqui ela precisa
  // estar no schema porque quem escreve é a IA, não o transporte.
  bolhas: z.array(z.string()).min(1).max(3),
  mandar_link: z.boolean(),
  escalar: z.boolean(),
  motivo: z.string(),
});
export type Veredito = z.infer<typeof Veredito>;

export interface PedidoResposta {
  empresa: string;
  cidade?: string | null;
  produto_id?: string | null;
  contato_id?: string | null;
  canal?: string | null;
  /** Conversa inteira, mais antiga primeiro. */
  historico: Array<{ de: 'nos' | 'lead'; texto: string }>;
}

// O link carrega os 8 primeiros caracteres do id do contato em utm_content.
// É a ÚNICA coisa que liga o toque (banco do gerador) à visita e à venda
// (banco do solardoc-pro). Sem isso dá pra saber que alguém da prospecção
// visitou, nunca QUEM — e o funil por lead não existe.
const linkDe = (contatoId?: string | null, canal = 'whatsapp') => {
  const base = 'https://solardoc.app/?utm_source=prospeccao&utm_medium=' + canal + '&utm_campaign=resposta_ia';
  const t = contatoId ? String(contatoId).replace(/-/g, '').slice(0, 8) : '';
  return t ? base + '&utm_content=' + t : base;
};

/** As alegações que a casa consegue provar. Sem isso a IA vende o que não temos. */
async function claims(produtoId: string | null | undefined) {
  const { data, error } = await supabaseGerador
    .from('prospeccao_alegacoes').select('produto_id, texto, verificada, fonte');
  if (error) { logger.error(LOG, 'ler alegacoes falhou', error); return { pode: [], nao: [] }; }
  const doProduto = (data ?? []).filter(a => !a.produto_id || a.produto_id === produtoId);
  return {
    pode: doProduto.filter(a => a.verificada).map(a => `${a.texto}  (prova: ${a.fonte})`),
    nao:  doProduto.filter(a => !a.verificada).map(a => a.texto),
  };
}

function prompt(p: PedidoResposta, pode: string[], nao: string[]) {
  return `Você é o Thiago, da SolarDoc, falando por mensagem com um integrador solar.
A gente abordou a ${p.empresa}${p.cidade ? ` de ${p.cidade}` : ''} oferecendo o SolarDoc e a pessoa respondeu.

O QUE VOCÊ PODE AFIRMAR — nada além disto:
${pode.map(c => `  · ${c}`).join('\n') || '  (nenhuma alegação verificada — não afirme NADA sobre o produto)'}

O QUE VOCÊ NÃO PODE AFIRMAR, nem parafraseado:
${nao.map(c => `  · ${c}`).join('\n') || '  —'}

Se a pessoa perguntar algo que você não pode responder com o que está acima,
diga que vai confirmar e marque escalar=true. NUNCA invente número, prazo,
garantia, desconto ou resultado. Inventar aqui custa mais caro que perder a venda.

COMO ESCREVER
· WhatsApp de gente, não de robô. Minúscula no meio da frase é normal.
· Cada bolha é uma mensagem curta. Uma ou duas linhas. No máximo três bolhas.
· Sem "Prezado", sem "estou à disposição", sem emoji, sem bullet point.
· Uma pergunta por vez, e só se ela levar a conversa adiante.
· Não repita o que já foi dito na conversa.

O LINK
Só mande o link quando a pessoa demonstrar que quer ver (pediu preço, pediu pra
ver, disse que tem interesse). Se ela ainda está perguntando o que é, responda
primeiro. Link cedo demais encerra a conversa. Quando mandar_link=true, NÃO
escreva o link nas bolhas — o sistema anexa sozinho.

QUANDO PARAR
Qualquer sinal de "não me manda mais", "sai daqui", "para", ou irritação clara:
resultado="nao_perturbar", uma bolha curta pedindo desculpa, mandar_link=false.
Não tente contornar. Isso é o que protege a linha.

QUANDO CHAMAR HUMANO (escalar=true)
Pergunta técnica que as alegações não cobrem, negociação de preço, reclamação,
proposta de parceria, ou qualquer coisa que você responderia chutando.

RESULTADO — o desfecho que vai pro CRM:
  respondeu      falou algo, sem sinal claro de interesse
  interessado    pediu preço, pediu pra ver, disse que quer
  sem_interesse  disse não, sem irritação
  nao_perturbar  pediu pra parar

CONVERSA (mais antiga primeiro):
${p.historico.map(h => `${h.de === 'nos' ? 'NÓS' : 'ELE'}: ${h.texto}`).join('\n')}

Responda a última mensagem dele.`;
}

export async function decidirResposta(p: PedidoResposta): Promise<Veredito | null> {
  if (desligado()) { logger.warn(LOG, 'PROSPECCAO_IA_OFF=true — nao vou decidir nada'); return null; }
  if (!process.env.ANTHROPIC_API_KEY) { logger.error(LOG, 'sem ANTHROPIC_API_KEY'); return null; }
  if (!p.historico?.length) return null;

  const { pode, nao } = await claims(p.produto_id);
  try {
    const r = await anthropic.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 2000,
      // Tarefa curta e de alto volume: `low` gasta menos e responde mais rápido,
      // e a qualidade que importa aqui (nao inventar) vem da trava de alegacoes,
      // nao da profundidade do raciocinio.
      output_config: { effort: 'low', format: zodOutputFormat(Veredito) },
      messages: [{ role: 'user', content: prompt(p, pode, nao) }],
    });

    const v = r.parsed_output;
    if (!v) { logger.error(LOG, 'resposta nao casou com o schema', { empresa: p.empresa }); return null; }

    // Cinto e suspensório: a IA foi instruída a não escrever o link, mas se
    // escrever, some daqui. Link duplicado numa bolha é cara de automação.
    v.bolhas = v.bolhas.map(b => b.replace(/https?:\/\/\S+/g, '').trim()).filter(Boolean);
    if (!v.bolhas.length) v.bolhas = ['beleza'];
    // Pedido de parada nunca vem acompanhado de link, diga a IA o que disser.
    if (v.resultado === 'nao_perturbar') v.mandar_link = false;

    return v;
  } catch (err: any) {
    // Crédito zerado é o erro mais provável aqui — foi o que deixou a Giovanna
    // muda três vezes em agosto. Loga com nome pra aparecer no diagnóstico.
    logger.error(LOG, 'chamada da IA falhou', { erro: String(err?.message || err), empresa: p.empresa });
    return null;
  }
}

/** O texto final que o worker digita, já com o link quando for a hora. */
export function bolhasParaEnvio(v: Veredito, contatoId?: string | null, canal?: string | null): string[] {
  return v.mandar_link ? [...v.bolhas, linkDe(contatoId, canal || 'whatsapp')] : v.bolhas;
}
