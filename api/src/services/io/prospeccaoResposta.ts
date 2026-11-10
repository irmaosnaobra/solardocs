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
import { createHash } from 'crypto';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { novoAnthropic } from "../../utils/anthropicClient";
import {
  aplicarRegras, ultimaNossaFoiOferta, contarOfertas, MAX_OFERTAS_CONVERSA, versaoDoUltimoToqueFrio,
  type EstadoConversa, type VersaoPergunta,
} from './prospeccaoRegras';

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
// NÃO entram aqui a Precificação nem o Estoque em Dia: desde 17/08 são exclusivos
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
    // Resposta automática de perfil comercial (saudação genérica, "retornaremos
    // em breve", horário, menu): ramo de código, nada sai e nada vira toque.
    'resposta_automatica',
    // Gente respondendo a pergunta que abriu a conversa (horas por mês, antes ou
    // depois do concorrente). É a resposta mais comum e não cabia em nenhuma das outras.
    'respondeu_pergunta',
  ]),
  // O desfecho que vai pro log de toques. É o MESMO enum da tela: a cabeça não
  // inventa categoria nova, senão o funil e o disjuntor param de bater.
  resultado: z.enum(['respondeu', 'interessado', 'sem_interesse', 'nao_perturbar']),
  // Frase por frase, nunca parede de texto, que é regra da casa, e aqui ela precisa
  // estar no schema porque quem escreve é a IA, não o transporte. No máximo 2: o
  // teto do turno é de 2 mensagens, contando imagem e link.
  bolhas: z.array(z.string()).min(1).max(2),
  // Só vale no produto que não é o SolarDoc. No SolarDoc o link é decidido em
  // código (prospeccaoRegras), pela oferta e pelo sim.
  mandar_link: z.boolean(),
  // A pessoa ACEITOU a oferta do diagnóstico na última mensagem (sim, pode,
  // manda, quero)? Só tem efeito se a nossa última fala foi a oferta.
  disse_sim: z.boolean(),
  // A PROVA. Escolhida pelo que a pessoa perguntou, nunca fixa: quem perguntou
  // de financiamento recebe a proposta pro banco, quem perguntou do "depois do
  // sim" recebe o contrato. Material genérico prova menos que material que
  // responde a dúvida que ela acabou de escrever.
  material: z.array(z.enum(CHAVES)).max(3),
  escalar: z.boolean(),
  motivo: z.string(),
});
/** O que a IA classificou, mais o que o código decidiu por cima (nao_enviar, oferta, versao, produto_id). */
export type Veredito = z.infer<typeof Veredito> & {
  /** Resposta automática de perfil: o transporte NÃO envia nada e NÃO grava toque. */
  nao_enviar?: boolean;
  /** Este turno terminou na oferta fixa do diagnóstico. */
  oferta?: boolean;
  /** Versão da pergunta fria (A/B) lida do obs do último toque; null = toque antigo. */
  versao?: VersaoPergunta | null;
  /** O produto da conversa: define qual link o transporte anexa. */
  produto_id?: string | null;
};

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
// SolarDoc: o link é o quiz de diagnóstico (/diagnostico). Outro produto mantém o
// destino antigo (a home), porque o quiz é do SolarDoc.
const linkDe = (contatoId?: string | null, canal = 'whatsapp', produtoId?: string | null) => {
  const destino = produtoId === 'solardoc' ? 'https://solardoc.app/diagnostico' : 'https://solardoc.app/';
  const base = destino + '?utm_source=prospeccao&utm_medium=' + canal + '&utm_campaign=resposta_ia';
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
  // Persona e oferta novas do SolarDoc só no SolarDoc (promptSolardoc). Outro
  // produto segue com o texto de sempre.
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
· Cada bolha é uma mensagem curta. Uma ou duas linhas. No máximo DUAS mensagens
  por turno, contando bolhas, imagens e o link: o sistema corta o que passar.
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

${BLOCO_RESPOSTA_AUTOMATICA}

QUANDO CHAMAR HUMANO (escalar=true)
Pergunta técnica que as alegações não cobrem, negociação de preço, reclamação,
proposta de parceria, ou qualquer coisa que você responderia chutando.

RESULTADO (o desfecho que vai pro CRM):
  respondeu      falou algo, sem sinal claro de interesse
  interessado    pediu preço, pediu pra ver, disse que quer
  sem_interesse  disse não, sem irritação
  nao_perturbar  pediu pra parar

disse_sim: false (este fluxo não usa).

CONVERSA (mais antiga primeiro):
${p.historico.map(h => `${h.de === 'nos' ? 'NÓS' : 'ELE'}: ${h.texto}`).join('\n')}

Responda a última mensagem dele.`;
}

// Vale para todos os produtos: quem escreve é o perfil, não uma pessoa.
const BLOCO_RESPOSTA_AUTOMATICA = `RESPOSTA AUTOMÁTICA DE PERFIL
Se a mensagem dele é a resposta automática de um perfil comercial (saudação
genérica de empresa, "retornaremos em breve", "nosso horário de atendimento é",
menu de opções numeradas, "digite 1 para"), use intencao="resposta_automatica".
Nada é enviado nessa situação. Gente que pergunta "quem é?" NÃO é resposta
automática: é "ambiguo".`;

/**
 * O prompt do SolarDoc. Persona "equipe do SolarDoc" e fatos FIXOS (nada de
 * alegações do banco: "só estes"). A IA classifica e escreve UMA bolha de
 * reconhecimento; a oferta, o link e a despedida são do código.
 */
function promptSolardoc(p: PedidoResposta, estado: EstadoConversa) {
  return `Você é da equipe do SolarDoc, falando por mensagem com um integrador solar.
A gente abordou a ${p.empresa}${p.cidade ? ` de ${p.cidade}` : ''} com uma pergunta sobre a proposta solar deles e a pessoa respondeu.

OS ÚNICOS FATOS QUE VOCÊ PODE USAR (nada além disto):
  · O que é: "O SolarDoc é um gerador de proposta solar. Ela sai com a sua marca, numa folha só, do celular, com quanto o cliente paga hoje, quanto vai pagar e em quanto tempo se paga. Também gera contrato e procuração pra concessionária."
  · Preço e grátis: "O diagnóstico é grátis. O SolarDoc é R$ 67 por mês, sem fidelidade, e não tem teste nem período grátis. Tem garantia de 7 dias: se não servir, o valor volta."

PROIBIDO: afirmar que existe "teste grátis", "7 dias grátis" ou "período grátis"; escrever qualquer número que não esteja nos fatos acima (pode repetir um número que a própria pessoa escreveu); falar de imagem, material ou anexo; inventar prazo, desconto, resultado ou função. Se perguntarem algo fora dos fatos, diga que vai confirmar e marque escalar=true.

COMO ESCREVER
· TODA bolha começa com letra MAIÚSCULA.
· PROIBIDO travessão (o longo e o médio). Use vírgula, ponto ou dois-pontos.
· WhatsApp de gente, não de robô. Sem "Prezado", sem "estou à disposição", sem emoji, sem bullet point.
· Não repita o que já foi dito na conversa.

O QUE VOCÊ ENTREGA
· "bolhas": UMA bolha só (no máximo duas, mas só a primeira costuma sair). Ela reconhece em poucas palavras o que a pessoa disse. Se ela perguntou "o que é isso?" ou "é grátis?"/preço, essa bolha responde com os fatos acima, em até três frases curtas. Essa bolha NÃO termina em pergunta e NÃO fala de link nem de diagnóstico: depois dela o sistema acrescenta sozinho a oferta ou o link. Não escreva link.
· "mandar_link": sempre false. O link é decidido pelo sistema.
· "material": sempre [].
· Mande no MÁXIMO duas mensagens por turno, sempre.

${(estado.linksEnviados ?? 0) > 0
    ? `O LINK DO DIAGNÓSTICO JÁ FOI ENVIADO nesta conversa. Não ofereça o diagnóstico de novo. "Sim", "ok", "obrigado" e parecidos NÃO são pedido de link: classifique como interessado ou respondeu_pergunta, com disse_sim=false, e responda normalmente. Use quer_link SÓ se a pessoa pedir o link de novo, de forma explícita.

`
    : ''}disse_sim
${estado.ofertaFeita
    ? 'A nossa última fala foi a OFERTA do diagnóstico grátis ("Posso te mandar o link?"). Marque disse_sim=true só se a última mensagem dele aceita claramente receber o link (sim, pode, manda, quero, bora). Qualquer dúvida, recusa ou pergunta: disse_sim=false.'
    : (estado.ofertasFeitas ?? 0) >= MAX_OFERTAS_CONVERSA
      ? 'Já oferecemos o diagnóstico grátis duas vezes e não oferecemos mais. Marque SEMPRE disse_sim=false. Use quer_link só se a pessoa pedir o link de forma explícita ("manda o link"); um "sim" a qualquer outra pergunta nossa NÃO é pedido de link.'
      : 'A nossa última fala NÃO foi a oferta do diagnóstico. Marque disse_sim=false.'}

INTENÇÃO (escolha UMA)
  respondeu_pergunta   respondeu a pergunta que abriu a conversa (horas por mês, se a proposta chega antes ou depois da do concorrente, como faz a proposta hoje)
  interessado          disse que tem interesse, quer ver, quer saber mais
  pediu_info           perguntou o que é, como funciona
  pediu_preco          perguntou preço ou se é grátis
  quer_link            pediu o link ou aceitou receber (sim à oferta)
  nao_e_decisor        diz que não é a pessoa que decide
  objecao              tem uma objeção ou dúvida de fundo
  sem_interesse        disse não, sem irritação (o sistema escreve a despedida)
  parar                pediu para parar
  ambiguo              mensagem de gente que não dá para entender ("quem é?")
  precisa_humano       pergunta que os fatos não cobrem, reclamação, parceria
  resposta_automatica  resposta automática de perfil (ver abaixo)

${BLOCO_RESPOSTA_AUTOMATICA}

QUANDO PARAR
Qualquer sinal de "não me manda mais", "sai daqui", "para", ou irritação clara: resultado="nao_perturbar", uma bolha curta pedindo desculpa.

RESULTADO (o desfecho que vai pro CRM):
  respondeu      falou algo, sem sinal claro de interesse
  interessado    demonstrou interesse, pediu preço, pediu pra ver
  sem_interesse  disse não, sem irritação
  nao_perturbar  pediu pra parar

CONVERSA (mais antiga primeiro):
${p.historico.map(h => `${h.de === 'nos' ? 'NÓS' : 'ELE'}: ${h.texto}`).join('\n')}

Responda a última mensagem dele.`;
}

/** O que o código sabe da conversa ANTES de chamar a IA: a oferta já foi feita? qual versão da pergunta fria? */
async function estadoDaConversa(p: PedidoResposta, solardoc: boolean): Promise<EstadoConversa> {
  const nossas = p.historico.filter(h => h.de === 'nos');
  const estado: EstadoConversa = {
    ofertaFeita: ultimaNossaFoiOferta(p.historico),
    ofertasFeitas: contarOfertas(p.historico),
    versao: null,
    ultimaNossa: nossas.length ? nossas[nossas.length - 1].texto : undefined,
    falasDele: p.historico.filter(h => h.de === 'lead').map(h => h.texto),
    ultimaDele: [...p.historico].reverse().find(h => h.de === 'lead')?.texto,
    // Link do quiz já enviado nesta conversa: a mensagem nossa com a URL /diagnostico.
    linksEnviados: solardoc ? p.historico.filter(h => h.de === 'nos' && /solardoc\.app\/diagnostico/i.test(h.texto)).length : 0,
  };
  if (solardoc && p.contato_id) {
    try {
      // A versão (A/B) mora no obs do toque frio do robô: "worker instagram v=A s=.. a=.. p=..".
      const { data, error } = await supabaseGerador.from('prospeccao_toques')
        .select('obs, criado_em, resultado').eq('contato_id', p.contato_id)
        .order('criado_em', { ascending: false }).limit(100);
      if (error) logger.error(LOG, 'ler toques (versao) falhou', error);
      else {
        const toques = (data ?? []) as Array<{ obs?: string | null; criado_em?: string | null; resultado?: string | null }>;
        estado.versao = versaoDoUltimoToqueFrio(toques.filter(t => t.resultado === 'enviei'));
        // O obs "· link" do toque da IA também prova que o link saiu (o histórico lido é só das últimas 20 falas).
        const porObs = toques.filter(t => /^IA\([a-z]+\):.*· link/.test(String(t.obs || ''))).length;
        estado.linksEnviados = Math.max(estado.linksEnviados ?? 0, porObs);
      }
    } catch (err) { logger.error(LOG, 'ler toques (versao) explodiu', err); }
  }
  return estado;
}

export async function decidirResposta(p: PedidoResposta): Promise<Veredito | null> {
  if (desligado()) { logger.warn(LOG, 'PROSPECCAO_IA_OFF=true, nao vou decidir nada'); return null; }
  if (!process.env.ANTHROPIC_API_KEY) { logger.error(LOG, 'sem ANTHROPIC_API_KEY'); return null; }
  if (!p.historico?.length) return null;

  // Tudo que é específico do SolarDoc (persona, fatos, oferta, link do quiz)
  // só vale com produto_id=solardoc. Os dois chamadores de hoje (Instagram e a
  // rota do worker) passam 'solardoc' fixo, mas a rota aceita qualquer produto.
  const solardoc = p.produto_id === 'solardoc';
  const estado = await estadoDaConversa(p, solardoc);

  let texto: string;
  if (solardoc) {
    texto = promptSolardoc(p, estado);
  } else {
    const { pode, nao } = await claims(p.produto_id);
    texto = prompt(p, pode, nao);
  }

  try {
    const r = await anthropic.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 2000,
      // Tarefa curta e de alto volume: `low` gasta menos e responde mais rápido,
      // e a qualidade que importa aqui (nao inventar) vem da trava de alegacoes,
      // nao da profundidade do raciocinio.
      output_config: { effort: 'low', format: zodOutputFormat(Veredito) },
      messages: [{ role: 'user', content: texto }],
    });

    const cru = r.parsed_output;
    if (!cru) { logger.error(LOG, 'resposta nao casou com o schema', { empresa: p.empresa }); return null; }

    // O que SAI no turno é decidido em código (prospeccaoRegras): resposta
    // automática não envia nada; no SolarDoc, primeiro a oferta fixa e só depois
    // do sim o link; nunca link em objeção, sem interesse, parar, ambíguo; nunca
    // imagem; no máximo 2 mensagens. Link escrito pela IA nas bolhas some lá
    // dentro: link duplicado numa bolha é cara de automação.
    const v = aplicarRegras(cru, estado, solardoc) as Veredito;
    v.produto_id = p.produto_id ?? null;
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
  if (v.nao_enviar) return [];
  return v.mandar_link ? [...v.bolhas, linkDe(contatoId, canal || 'whatsapp', v.produto_id)] : v.bolhas;
}

export type PassoEnvio =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'imagem'; url: string; chave: ChaveMaterial };

/**
 * A conversa inteira em ordem: fala, prova, link. No SolarDoc a prova (imagem) não
 * existe mais: material é sempre []. O teto é de 2 passos, já aplicado no veredito.
 *
 * É uma LISTA e não uma string porque imagem não cabe em texto, e porque a
 * ordem É a mensagem: prova antes do link faz a pessoa clicar já convencida;
 * link antes da prova faz ela decidir sem ter visto nada.
 */
export function planoDeEnvio(v: Veredito, contatoId?: string | null, canal?: string | null): PassoEnvio[] {
  if (v.nao_enviar) return [];
  const passos: PassoEnvio[] = v.bolhas.map(t => ({ tipo: 'texto' as const, texto: t }));
  for (const k of v.material || []) passos.push({ tipo: 'imagem', url: urlMaterial(k), chave: k });
  if (v.mandar_link) passos.push({ tipo: 'texto', texto: linkDe(contatoId, canal || 'whatsapp', v.produto_id) });
  return passos;
}

/**
 * Resposta automática de perfil: grava SÓ a mensagem recebida em
 * prospeccao_conversas. Não grava toque, para o contato não travar. No
 * Instagram o webhook já guarda a mensagem; esta função serve ao WhatsApp, onde
 * o histórico vem da tela. A chave `mid` é derivada do texto: o mesmo texto no
 * mesmo contato não duplica a linha.
 */
export async function gravarMensagemRecebida(contatoId: string | null | undefined, canal: string | null | undefined, texto: string) {
  if (!contatoId || !texto) return false;
  const canalOk = canal || 'whatsapp';
  const sufixo = createHash('sha1').update(`${contatoId}|${texto}`).digest('hex').slice(0, 20);
  const { error } = await supabaseGerador.from('prospeccao_conversas')
    .insert({ contato_id: contatoId, canal: canalOk, de: 'lead', texto: String(texto).slice(0, 2000), mid: `${canalOk}:${sufixo}` });
  if (error && !String(error.message || '').includes('duplicate')) {
    logger.error(LOG, 'gravar mensagem recebida falhou', error);
    return false;
  }
  return !error;
}
