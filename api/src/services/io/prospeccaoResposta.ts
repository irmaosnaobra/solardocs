// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO, a cabeça. Lê o que o lead respondeu e decide o que fazer.
//
// Mora no servidor, não no worker, por dois motivos: a chave da Anthropic já
// está aqui (o worker fica sem segredo nenhum na máquina do consultor), e a
// regra de o-que-pode-afirmar vive no banco: o worker não precisa conhecê-la.
//
// O que ela NÃO faz: não envia. Devolve a decisão e o texto; quem digita é o
// worker, pelo Chrome do consultor. Separar isso é o que permite o `--dry`
// existir de verdade: dá pra ver a resposta que ela daria sem mandar nada.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { novoAnthropic } from "../../utils/anthropicClient";

const LOG = 'prospeccao-resposta';
const anthropic = novoAnthropic();

// Kill-switch. Sem ele, a única forma de parar a cabeça seria tirar a chave,
// e tirar a chave derruba os outros agentes junto.
const desligado = () => (process.env.PROSPECCAO_IA_OFF || '').trim() === 'true';

// ─────────────────────────────────────────────────────────────────────────────
// O MATERIAL, a prova.
//
// O padrão da casa é: PERGUNTA, depois PROVA, depois o LINK na hora certa.
// A prova é documento de verdade gerado pelo próprio SolarDoc, pela mesmíssima
// função que roda quando o assinante clica em "Gerar". Não é maquete.
//
// Por que imagem e não só link: link pede um clique e uma decisão. A imagem
// chega aberta na conversa e responde "vocês são bons mesmo?" antes da pessoa
// precisar querer saber.
//
// NÃO entram aqui a Precificação nem o Inventário: desde 17/08 são exclusivos
// do plano anual. Usar como prova do plano mensal é vender o que o cliente não
// vai receber, e ele descobre no cadeado.
// ─────────────────────────────────────────────────────────────────────────────
const RAIZ_MATERIAL = process.env.MATERIAL_BASE || 'https://solardoc.app/dm';

export const MATERIAL = {
  proposta:   { arquivo: 'proposta.jpg',   nome: 'a proposta comercial que sai pro cliente' },
  banco:      { arquivo: 'banco.jpg',      nome: 'a proposta no formato que a financeira pede' },
  contrato:   { arquivo: 'contrato.jpg',   nome: 'o contrato de compra e venda' },
  procuracao: { arquivo: 'procuracao.jpg', nome: 'a procuração pra concessionária' },
  recibo:     { arquivo: 'recibo.jpg',     nome: 'o recibo que calcula o que já foi pago' },
  servico:    { arquivo: 'servico.jpg',    nome: 'o contrato com o instalador terceirizado' },
  vistoria:   { arquivo: 'vistoria.jpg',   nome: 'o checklist que vai pra obra' },
  vendedor:   { arquivo: 'vendedor.jpg',   nome: 'o contrato de representação do vendedor' },
} as const;
export type ChaveMaterial = keyof typeof MATERIAL;
const CHAVES = Object.keys(MATERIAL) as [ChaveMaterial, ...ChaveMaterial[]];
export const urlMaterial = (k: ChaveMaterial) => `${RAIZ_MATERIAL}/${MATERIAL[k].arquivo}`;

const Veredito = z.object({
  intencao: z.enum([
    'interessado', 'pediu_info', 'pediu_preco', 'quer_link', 'nao_e_decisor',
    'objecao', 'sem_interesse', 'parar', 'ambiguo', 'precisa_humano',
  ]),
  // O desfecho que vai pro log de toques. É o MESMO enum da tela: a cabeça não
  // inventa categoria nova, senão o funil e o disjuntor param de bater.
  resultado: z.enum(['respondeu', 'interessado', 'sem_interesse', 'nao_perturbar']),
  // Frase por frase, nunca parede de texto, que é regra da casa, e aqui ela precisa
  // estar no schema porque quem escreve é a IA, não o transporte.
  bolhas: z.array(z.string()).min(1).max(3),
  mandar_link: z.boolean(),
  // A PROVA. Escolhida pelo que a pessoa perguntou, nunca fixa: quem perguntou
  // de financiamento recebe a proposta pro banco, quem perguntou do "depois do
  // sim" recebe o contrato. Material genérico prova menos que material que
  // responde a dúvida que ela acabou de escrever.
  material: z.array(z.enum(CHAVES)).max(3),
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
// visitou, nunca QUEM, e o funil por lead não existe.
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

O QUE VOCÊ PODE AFIRMAR (nada além disto):
${pode.map(c => `  · ${c}`).join('\n') || '  (nenhuma alegação verificada, não afirme NADA sobre o produto)'}

O QUE VOCÊ NÃO PODE AFIRMAR, nem parafraseado:
${nao.map(c => `  · ${c}`).join('\n') || '  (nenhuma)'}

Se a pessoa perguntar algo que você não pode responder com o que está acima,
diga que vai confirmar e marque escalar=true. NUNCA invente número, prazo,
garantia, desconto ou resultado. Inventar aqui custa mais caro que perder a venda.

COMO ESCREVER
· TODA bolha começa com letra MAIÚSCULA. É a primeira coisa que a pessoa vê e
  minúscula no começo parece rascunho. Dentro da frase, minúscula é normal:
  "Tenho a solução pra isso, quer ver?" abre em maiúscula e segue solto.
· PROIBIDO usar travessão, o longo ou o médio. Ninguém digita isso no celular,
  o teclado do WhatsApp não tem, e é o sinal mais fácil de reconhecer texto de
  máquina no Brasil. Onde ia a pausa, use vírgula, ponto ou dois-pontos.
· WhatsApp de gente, não de robô.
· Cada bolha é uma mensagem curta. Uma ou duas linhas. No máximo três bolhas.
· Sem "Prezado", sem "estou à disposição", sem emoji, sem bullet point.
· Uma pergunta por vez, e ela vai NO FINAL da última bolha, bem clara, do tipo
  que se responde com uma palavra. Mensagem que termina em afirmação deixa a
  pessoa sem saber o que responder, e ela não responde.
· Não repita o que já foi dito na conversa.

O MATERIAL (a prova)
A primeira mensagem que ela recebeu PROMETEU material: "te envio as imagens".
Se ela respondeu qualquer coisa que não seja "não quero", CUMPRA a promessa.

Em "material" liste de 1 a 3 documentos, escolhidos pelo que ELA perguntou:
  proposta    a proposta comercial que sai pro cliente
  banco       a proposta no formato que a financeira pede
  contrato    o contrato de compra e venda
  procuracao  a procuração pra concessionária
  recibo      o recibo que calcula o que já foi pago
  servico     o contrato com o instalador terceirizado
  vistoria    o checklist que vai pra obra
  vendedor    o contrato de representação do vendedor

Regras do material:
· Falou de financiamento ou de banco? mande banco. Falou de contrato ou do
  "depois do sim"? mande contrato. Falou de homologação? mande procuracao.
· proposta entra quase sempre, porque é o documento que ela mais usa.
· Dois documentos já provam. Três é o teto, e só quando ela perguntou de várias
  coisas. Mandar oito é despejo, não é prova.
· Se ela pediu pra parar, ou claramente não quer nada, material=[] (lista vazia).
· NÃO descreva o documento em detalhe na bolha: a imagem chega junto e fala
  sozinha. Uma linha curta apresentando basta ("olha como sai a proposta").

O LINK
Só mande o link quando a pessoa demonstrar que quer ver (pediu preço, pediu pra
ver, disse que tem interesse). Se ela ainda está perguntando o que é, responda
primeiro. Link cedo demais encerra a conversa. Quando mandar_link=true, NÃO
escreva o link nas bolhas, o sistema anexa sozinho.

A ORDEM que sai na conversa é sempre: suas bolhas, depois as imagens, depois o
link. Escreva as bolhas sabendo disso: elas ANUNCIAM o que vem, não resumem.

QUANDO PARAR
Qualquer sinal de "não me manda mais", "sai daqui", "para", ou irritação clara:
resultado="nao_perturbar", uma bolha curta pedindo desculpa, mandar_link=false.
Não tente contornar. Isso é o que protege a linha.

QUANDO CHAMAR HUMANO (escalar=true)
Pergunta técnica que as alegações não cobrem, negociação de preço, reclamação,
proposta de parceria, ou qualquer coisa que você responderia chutando.

RESULTADO (o desfecho que vai pro CRM):
  respondeu      falou algo, sem sinal claro de interesse
  interessado    pediu preço, pediu pra ver, disse que quer
  sem_interesse  disse não, sem irritação
  nao_perturbar  pediu pra parar

CONVERSA (mais antiga primeiro):
${p.historico.map(h => `${h.de === 'nos' ? 'NÓS' : 'ELE'}: ${h.texto}`).join('\n')}

Responda a última mensagem dele.`;
}

export async function decidirResposta(p: PedidoResposta): Promise<Veredito | null> {
  if (desligado()) { logger.warn(LOG, 'PROSPECCAO_IA_OFF=true, nao vou decidir nada'); return null; }
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
    // Pedido de parada nunca vem com link nem com material, diga a IA o que
    // disser. Insistir com prova depois de "para" é o que bloqueia conta.
    if (v.resultado === 'nao_perturbar') { v.mandar_link = false; v.material = []; }
    // Repetido não prova duas vezes, e três é o teto mesmo que ela escolha mais.
    v.material = [...new Set(v.material || [])].slice(0, 3);

    return v;
  } catch (err: any) {
    // Crédito zerado é o erro mais provável aqui: foi o que deixou a Giovanna
    // muda três vezes em agosto. Loga com nome pra aparecer no diagnóstico.
    logger.error(LOG, 'chamada da IA falhou', { erro: String(err?.message || err), empresa: p.empresa });
    return null;
  }
}

/** O texto final que o worker digita, já com o link quando for a hora. */
export function bolhasParaEnvio(v: Veredito, contatoId?: string | null, canal?: string | null): string[] {
  return v.mandar_link ? [...v.bolhas, linkDe(contatoId, canal || 'whatsapp')] : v.bolhas;
}

export type PassoEnvio =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'imagem'; url: string; chave: ChaveMaterial };

/**
 * A conversa inteira em ordem: fala, prova, link.
 *
 * É uma LISTA e não uma string porque imagem não cabe em texto, e porque a
 * ordem É a mensagem: prova antes do link faz a pessoa clicar já convencida;
 * link antes da prova faz ela decidir sem ter visto nada.
 */
export function planoDeEnvio(v: Veredito, contatoId?: string | null, canal?: string | null): PassoEnvio[] {
  const passos: PassoEnvio[] = v.bolhas.map(t => ({ tipo: 'texto' as const, texto: t }));
  for (const k of v.material || []) passos.push({ tipo: 'imagem', url: urlMaterial(k), chave: k });
  if (v.mandar_link) passos.push({ tipo: 'texto', texto: linkDe(contatoId, canal || 'whatsapp') });
  return passos;
}
