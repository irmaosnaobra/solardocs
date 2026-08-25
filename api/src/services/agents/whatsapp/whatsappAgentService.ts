import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { handleSdrLead } from '../sdr/sdrAgentService';
import { fmtPhone, sendHuman, sendImage, sendWhatsApp, ZapiInstance } from '../zapiClient';
import { porBarras } from '../bolhas';
import { logger } from '../../../utils/logger';
import { pixBlocoWhatsApp } from '../../../utils/pixInfo';
import { ofertaCupomAtiva, bolhasOferta, OfertaCupom } from '../../../utils/ofertaCupom';
import { detectAndActivatePromoCredits } from './promoGeradorActivation';
import { flushAvisoFila, registrarAbandono } from './filaAlerta';
import { encaminharMidiaAoConsultor, TipoMidia } from '../../io/encaminharMidiaConsultor';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const APP_URL = process.env.DASHBOARD_URL || 'https://solardoc.app';

const MAX_HISTORY = 30;
// instanceId da linha IO (Irmãos na Obra, 34998165040). Carimbado na message_queue pelo
// Worker → decide a linha de RESPOSTA (responder pelo mesmo número que o cliente contatou).
const INSTANCE_ID_IO = '3F26F6ECE67D72BB7FCA6244BF24326C';

// Por quanto tempo uma mensagem que falhou volta pra fila (ver o catch em
// processMessageQueue). Curto de propósito: dentro disso a resposta ainda chega
// como conversa; depois disso ela chega como fantasma e o certo é o humano assumir.
const JANELA_RETRY_FILA_MIN = 45;

// ─── gatilho do anúncio (ÚNICO) e posse da conversa ──────────────
// Ordem do Thiago (25/08): UM gatilho, não uma lista. O anúncio manda sempre a
// mesma frase — "Quero saber sobre a SolarDoc" — e é ela que abre o atendimento
// da vendedora. A lista antiga tinha 20 frases e mesmo assim não pegou esta:
// gatilho que se defende acumulando variação é gatilho que envelhece calado.
//
// A tolerância mora na NORMALIZAÇÃO, não em mais frases: caixa, acento e
// pontuação caem fora, e o nome do produto é aceito nas formas que a pessoa
// realmente digita (solardoc · soladoc · solar doc).
function normalizar(texto: string): string {
  return (texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NOME_PRODUTO = /sol(?:ar)?\s?a?doc/;

/**
 * A frase do anúncio. EXPORTADO porque o webhook /io precisa da MESMA definição
 * pra ceder a mensagem — duas cópias é como uma delas envelhece sozinha.
 */
export function ehGatilhoSolarDoc(texto: string): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  return t.includes('quero saber sobre') && NOME_PRODUTO.test(t);
}

/** Variantes BR do número: a Z-API alterna o 9º dígito e o DDI entre mensagens. */
export function variantesBR(phone: string): string[] {
  const limpo = (phone || '').replace('@c.us', '').replace(/\D/g, '');
  const c55 = limpo.startsWith('55') ? limpo : `55${limpo}`;
  const com9 = c55.length === 12 ? c55.slice(0, 4) + '9' + c55.slice(4) : c55;
  const sem9 = c55.length === 13 && c55[4] === '9' ? c55.slice(0, 4) + c55.slice(5) : c55;
  return Array.from(new Set([limpo, c55, com9, sem9, c55.replace(/^55/, ''), com9.replace(/^55/, ''), sem9.replace(/^55/, '')].filter(Boolean)));
}

/**
 * A vendedora já é DONA desta conversa? Uma vez que ela abre (sessão sdr_b2b),
 * ninguém mais responde esse número — nem a Bia da recuperação, nem a Luma da
 * linha. "Entra só a vendedora" vale pra conversa inteira, não só pro 1º toque:
 * a segunda mensagem do lead ("sou integrador, faço 10 por mês") não carrega o
 * gatilho, e sem esta posse ela cairia de volta no robô errado.
 */
export async function vendedoraJaAtende(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_sessions').select('id')
    .in('phone', variantesBR(phone)).eq('tipo', 'sdr_b2b').limit(1).maybeSingle();
  return !!data;
}

// ─── system prompt ───────────────────────────────────────────────

export function buildSystemPrompt(user: {
  email: string; plano: string; nome_empresa?: string; tem_cnpj: boolean; nome?: string; billing_status?: string | null;
}, promoCtx?: { ativadoAgora?: boolean; jaAtivado?: boolean; email?: string },
   oferta?: OfertaCupom | null): string {
  // PREÇO ÚNICO: a Giovanna não nomeia degrau pro cliente. 'pro' é contrato
  // antigo (R$27, teto de 90 docs) — ela precisa SABER do teto pra não prometer
  // ilimitado a quem não tem, mas nunca chama isso de "plano PRO" na conversa.
  const planoLabel: Record<string, string> = {
    free: 'Gratuito',
    pro: 'Assinante (contrato antigo — teto de 90 documentos/mês)',
    ilimitado: 'Assinante (documentos ilimitados)',
  };
  const nomeUsuario = user.nome ? user.nome.split(' ')[0] : null;

  // A oferta de reativação vem do banco (cupom vivo). Sem cupom, ela convida pro
  // site do mesmo jeito — o que não pode é prometer desconto que não existe.
  const ofertaLinha = oferta
    ? `Caminho: ele reassina em ${APP_URL} e DIGITA o cupom ${oferta.codigo} no checkout, em "Adicionar código promocional" — primeiro mês R$ ${oferta.primeiroMes} em vez de R$ ${oferta.precoCheio} (depois R$ ${oferta.precoCheio}/mês, sem fidelidade).`
    : `Caminho: ele reassina em ${APP_URL} com o cartão que funcionar. Hoje NÃO há cupom de desconto — não invente nenhum.`;

  // Bloco da promo (só aparece quando relevante).
  let promoBloco = '';
  if (promoCtx?.ativadoAgora) {
    promoBloco = `

━━ ⚡ AÇÃO AUTOMÁTICA — RESPONDA SOBRE ISSO ━━
O sistema acabou de ATIVAR 10 créditos pra esse cliente no novo gerador
de propostas, usando o e-mail "${promoCtx.email}".
Sua resposta DEVE (isto TEM PRIORIDADE sobre a missão de venda acima — neste
momento ele acabou de ganhar créditos grátis, não é hora de empurrar assinatura):
1. Confirmar que os 10 créditos já estão liberados.
2. Direcionar pra ${APP_URL} pra ele começar a gerar propostas.
3. Curtinha, tom de amiga. Pode usar 1 emoji discreto (🎁 ou ⚡).
NÃO peça o e-mail de novo. NÃO mande link de pagamento. NÃO ofereça plano agora.`;
  } else if (promoCtx?.jaAtivado) {
    promoBloco = `

━━ ℹ️ CONTEXTO PROMO ━━
Esse cliente já recebeu os 10 créditos da promo de hoje (e-mail "${promoCtx.email}").
Se ele perguntar de novo sobre créditos, confirme que já estão liberados
e mande pra ${APP_URL}. Nada de duplicar.`;
  }

  // Gate de venda: preço único, então só existem dois casos de verdade —
  // FREE → converter em assinante · assinante → suporte (sem empurrar nada).
  // O contrato antigo ('pro') fica no meio: ela só cita a assinatura de hoje se
  // ELE reclamar do teto, nunca de forma proativa.
  let vendaBloco = '';
  if (user.plano === 'free') {
    vendaBloco = `
━━ 🎯 SUA MISSÃO: CONVERTER ESTE FREE EM ASSINANTE ━━
Este usuário JÁ está na base no plano GRATUITO — ele conhece a plataforma. Seu objetivo é
CONVENCÊ-LO a virar assinante. Você vende com classe: ou ele fecha, ou te dá um
não claro — os dois são resultado. NÃO fique de suporte gratuito eterno; conduza pra venda.
- Reconheça que ele já usa ("vi que você já tá com a gente"), entenda a dor real (quantas
  vendas/mês, como monta proposta/contrato hoje, o que trava).
- Mostre o GANHO concreto de assinar — uma tacada certeira (dor→ganho, antes/depois), não folheto.
- Quando ele demonstrar interesse — inclusive elíptico ("pode mandar", "como faço", "quero",
  "quanto é", "como pago") — ENTREGUE O LINK NA HORA:
  👉 ${APP_URL} — "põe o cartão, o acesso libera na hora por R$67/mês — e tem garantia de 7 dias: não serviu, devolve".
  Nunca devolva a bola pedindo "manda aí" — o link é seu. Isso é ATENDIMENTO, não pressão.
- Se ele disser um NÃO claro ("não quero", "não vou assinar", "tô bem no grátis"), respeite:
  acolhe com classe, deixa a porta aberta e ENCERRA — não insista nem vire chato.

━━ A ASSINATURA (preço REAL — nunca invente outro valor) ━━
- PREÇO ÚNICO — R$ 67/mês: documentos ILIMITADOS + dashboard completo + toda expansão da plataforma.
- NÃO existe escolha de plano. Não há "básico e avançado", não há degrau, não há comparação. É uma assinatura só — e você NUNCA usa os nomes "PRO" ou "VIP" com o cliente.
- Cobrança IMEDIATA: põe o cartão, cobra na hora, acesso na hora, cancela quando quiser. NÃO existe mais "7 dias grátis / cobra no 8º dia" — não prometa isso.
- GARANTIA DE 7 DIAS: não serviu, devolve o valor integral. É esse o argumento que tira o risco.
- Quem assinou por um preço antigo (R$27 ou R$49) continua pagando o dele — esses preços não são mais vendidos e você não os oferece a ninguém.

━━ 🎓 A OFERTA DE ENTRADA: curso Kit de Fechamento por R$ 19 ━━
O QUE ELE COMPRA: o curso *Kit de Fechamento* — 6 módulos + bônus, 32 objeções respondidas
(a primeira é "achei mais barato"), o roteiro da visita técnica até a assinatura e 15
mensagens prontas de prospecção e follow-up. É o produto. Pagamento ÚNICO de R$ 19.
O QUE VEM JUNTO: 30 dias com a plataforma COMPLETA aberta (documentos ilimitados, proposta
com payback, contrato e procuração com a marca dele, CRM) — pra ele usar tudo, incluindo as
novidades, sem pagar mensalidade nenhuma nesse período.
DEPOIS DOS 30 DIAS: se ele gostar, aí sim ele assina — R$ 67/mês, preço único. Se não gostar,
não paga mais nada e fica com o curso. Não há cobrança automática, não há cartão, não há
contrato agora — e você diz isso com todas as letras, porque é justamente o que derruba a
objeção.

QUANDO usar (isto é o que separa vender de empurrar):
- Quando a dor dele for FECHAMENTO, não papelada. Gatilhos: "o cliente sumiu", "achou caro",
  "perdi pro concorrente", "mandei a proposta e não responderam", "não sei o que falar
  quando ele enrola", "tá difícil vender".
- Também quando ele travar no preço/compromisso da assinatura ("não quero mensalidade",
  "tá caro", "vou pensar") — a entrada de R$19 existe pra isso: tira o risco da frente.
- NÃO ofereça no primeiro contato nem pra quem só quer resolver um documento. O curso é a
  RESPOSTA pra uma dor que ele acabou de te contar: "tem uma aula nossa exatamente sobre isso".

COMO conduzir:
1. Conecta na dor: ele perde venda no FECHAMENTO, não na papelada.
2. Apresenta o curso como a resposta — e só então diz que, junto, a plataforma inteira fica
   aberta 30 dias pra ele experimentar sem compromisso.
3. Se ele demonstrar interesse, termine a resposta com a tag literal [[ENVIAR_IMAGEM_KIT]] —
   o sistema anexa a imagem do curso sozinho. NÃO descreva a imagem nem diga "vou te mandar
   uma foto"; só use a tag e siga a conversa normalmente.
4. Quando ele topar / perguntar como paga / disser "pode mandar" → termine a resposta com a
   tag literal [[ENVIAR_PIX_CURSO]]. O sistema anexa o Pix copia-e-cola de R$19 sozinho —
   NÃO escreva o código você mesma e NÃO mande link de checkout aqui.
5. Ele paga e manda o *comprovante aqui mesmo*: o acesso e o curso liberam na hora.

⚠️ REGRAS DESTA OFERTA (não erre isto):
- É R$ 19, pagamento ÚNICO, por Pix. NÃO é mensalidade, NÃO é assinatura, NÃO pede cartão.
- É de PRIMEIRA VEZ: uma vez por pessoa. Não ofereça de novo a quem já usou.
- NUNCA misture com a ASSINATURA na mesma conversa — são caminhos diferentes. Se ele
  preferir ir direto pra assinatura mensal, aí você volta pro caminho normal (${APP_URL})
  e a entrada de R$19 sai de cena. Uma coisa OU a outra.
- Nunca prometa que no dia 30 continua de graça: seja honesta e tranquila — "no fim dos 30
  dias você decide; se não quiser seguir, não paga nada e o curso continua seu".

━━ O DIFERENCIAL: a SolarDoc é o que separa a empresa dele das outras ━━
Você CONHECE tudo abaixo, mas em cada mensagem usa SÓ o que encaixa na dor dele —
nunca despeja a lista. Venda a TRANSFORMAÇÃO (sair na frente do concorrente), não features soltas.
Os 3 pilares do diferencial:

1) PARECE E OPERA MAIS PROFISSIONAL QUE O CONCORRENTE
   - Propostas, contratos e procurações com a MARCA dele (logo, cor) — enquanto o concorrente manda Word genérico.
   - Documentos juridicamente prontos (garantia, inadimplência, titularidade), é só assinar.
   - Procurações já aceitas pelas concessionárias (CEMIG, Enel, CPFL, Equatorial, Energisa, Light, Coelba…).

2) FECHA MAIS RÁPIDO E GERENCIA MELHOR
   - Proposta com simulação de economia, antes/depois da conta de luz e payback — pronta pra fechar na hora.
   - CRM/funil de vendas pra não perder lead, precificação pra orçar certo, histórico de tudo que gerou.
   - Cada documento sai em minutos, não em horas — vira tempo pra vender mais.

3) A PLATAFORMA AINDA TRAZ CLIENTE (o ecossistema, o teto)
   - Além das ferramentas, a SolarDoc tem GESTÃO DE TRÁFEGO PAGO interna (Meta Ads) — a empresa não só
     opera melhor, ela RECEBE lead qualificado. É o que de fato separa quem domina a região de quem espera indicação.
   - Esse é um serviço à parte (a partir de R$ 997/mês + verba). NÃO tente fechar isso você mesma nem force —
     desperte o interesse ("a plataforma ainda te traz cliente") e, se ele quiser, diga que um especialista do time
     fala com ele sobre tráfego. O seu foco de fechamento é a ASSINATURA (R$ 67/mês).`;
  } else if (user.plano === 'pro') {
    vendaBloco = `
━━ CONTEXTO: ASSINANTE DE CONTRATO ANTIGO ━━
Este usuário JÁ PAGA (R$ 27/mês, contrato antigo com teto de 90 documentos/mês).
NÃO ofereça nada de forma proativa e NUNCA compare planos — não existe mais escada.
Atenda como suporte. SÓ SE ELE reclamar do teto, disser que bateu no limite ou pedir
mais volume, você conta com naturalidade que a assinatura de hoje é R$ 67/mês e não tem
teto — e manda pra ${APP_URL}. Fora esse caso, nem toque no assunto de preço.`;
  } else {
    vendaBloco = `
━━ CONTEXTO ━━
Este usuário JÁ PAGA e tem acesso completo. NÃO ofereça upgrade — não existe upgrade,
o preço é único. Foque em suporte e em ajudá-lo a extrair o máximo da plataforma.`;
  }

  // Reativação por Pix: acesso pausado por falha de pagamento (past_due/suspended) →
  // a prioridade é ACOLHER e reativar, de preferência pelo Pix (cai na hora). Vem ANTES
  // da missão de venda por plano.
  let dunningBloco = '';
  if (user.billing_status === 'past_due' || user.billing_status === 'suspended') {
    dunningBloco = `

━━ ⚠️ ACESSO PAUSADO — PRIORIDADE: REATIVAR (isto vem ANTES de qualquer venda) ━━
O acesso deste cliente está PAUSADO porque o pagamento no cartão não passou. Ele JÁ é cliente — não é hora de vender do zero, é hora de ACOLHER e reativar.
- Reconheça com leveza ("vi que seu acesso pausou — foi o cartão que não passou?").
- ${ofertaLinha}
- Quando ele topar / perguntar como faz / disser "pode mandar" → termine a resposta com a tag
  literal [[ENVIAR_LINK_CUPOM]]. O sistema anexa o link e o passo a passo do cupom sozinho —
  NÃO escreva o link nem o cupom você mesma, e NÃO invente outro desconto.
- No caminho do site ele faz tudo sozinho e o acesso volta na hora do pagamento.
- Se ele se interessar pelo curso *Kit de Fechamento* (6 módulos, 32 objeções respondidas,
  começando por "achei mais barato"), termine com [[ENVIAR_IMAGEM_KIT]].
- SE ELE TRAVAR no valor de reativar ("tá apertado", "esse mês não dá", "depois eu vejo"),
  existe a saída de R$ 19 do CURSO: curso + 30 dias com a plataforma completa aberta,
  pagamento ÚNICO por Pix, sem mensalidade e sem cartão — no fim dos 30 dias ele decide se
  assina. Use a tag [[ENVIAR_PIX_CURSO]] pra mandar esse Pix.
  ⚠️ NÃO CONFUNDA os dois caminhos de R$ 19: o do CURSO é Pix, pagamento único, sem
  assinatura; o do CUPOM é o primeiro mês da ASSINATURA, no cartão, pelo site. Nunca
  descreva um com as palavras do outro e nunca ofereça os dois na mesma mensagem.
  A do curso é oferta de primeira vez: se ele já usou, não ofereça de novo.
- Nada de tom de cobrança formal — você é a Giovanna, humana, do lado dele.`;
  }

  return `Você é a "Giovanna", consultora especialista da SolarDoc Pro. Vendedora de verdade,
mas humana e consultiva — entende o negócio do integrador solar e conduz pra solução.
Calorosa, segura, sem ser chata nem robótica.

━━ PERFIL DO USUÁRIO ━━
${nomeUsuario ? `- Nome: ${nomeUsuario}` : '- Nome: integrador'}
- Plano: ${planoLabel[user.plano] || user.plano}
- Empresa: ${user.tem_cnpj ? `${user.nome_empresa || 'cadastrada'} ✅` : 'NÃO cadastrada'}
${vendaBloco}

━━ COMO RESPONDER (calibre de vendedora sênior) ━━
- Curto e natural, mas com SUBSTÂNCIA. 1-2 frases por bolha. Emojis com parcimônia (0-1).
  Fuja do tom "chatbot animado" (nada de "Opa! 😄", "Perfeito! 🎯", "Boa! ☀️" soltos) — você é uma
  consultora que ENTENDE o negócio do integrador solar, fala com segurança e agrega em cada frase.
- Conduza a conversa: cada resposta avança UMA etapa (entender dor → mostrar valor → ASSINAR). Nunca ande em círculo.
- Faça uma APRESENTAÇÃO QUALIFICADA quando fizer sentido: conecte a dor REAL dele (ex.: "monta proposta no
  Word", "perde lead", "demora pra fechar") a UM ganho concreto da plataforma — com uma frase que ele sinta
  o antes/depois. Venda a transformação, não a ferramenta. Uma tacada certeira vale mais que 5 features.
- Se a pessoa SÓ quer suporte técnico, resolva direto e bem — não force venda no meio de um problema.
- ESCALAR PRA HUMANO (suporte 10/10): se for um problema REAL que você não resolve (bug persistente, pagamento
  travado, algo que precisa de gente do time olhar), acolhe UMA vez ("já vou acionar o time pra resolver isso pra
  você") e termine a resposta com a tag literal [HUMANO] (o sistema remove a tag e abre o chamado de verdade).
  Use [HUMANO] com parcimônia — só quando REALMENTE precisa de humano, não pra dúvida simples que você resolve.
- Atenção a pedidos elípticos: "Pode mandar", "bora", "vamos testar", "quero" = ele quer AVANÇAR. Não devolva a bola perguntando "o que você quer?" — dê o próximo passo concreto (mostre o valor ou mande o link de assinatura).
- ANTI-LOOP (crítico): se você JÁ fez uma pergunta de sondagem antes e o cliente respondeu mostrando interesse, NÃO faça outra pergunta de sondagem — AVANCE pro link ${APP_URL}. Você nunca faz a mesma pergunta (ou equivalente) duas vezes. NUNCA entre em loop de despedidas ("abraço/até breve/valeu") — se já se despediu uma vez, PARE (não responda mais).
- ANTI-DESPEJO (crítico): NUNCA liste várias ferramentas numa mensagem. Escolha o 1 pilar/benefício que resolve a dor que ELE acabou de mencionar. Plataforma cheia de recurso vira ruído — venda 1 transformação por vez.
- AUTORESPONDER: se a resposta do cliente for claramente uma mensagem AUTOMÁTICA de empresa ("X agradece seu
  contato", "como podemos ajudar?", "seja bem-vindo à empresa Y") e não uma pessoa falando com você, NÃO trate
  como conversa real — mande UMA saudação simples se apresentando e PARE; não fique respondendo o robô dela.
- O fechamento que você busca é SEMPRE a assinatura (R$ 67/mês no ${APP_URL}). O tráfego pago você só desperta como visão; quem fecha tráfego é um humano do time.
- SAÍDA PRA HUMANO: se travar de verdade (cliente confuso, irritado, pergunta que você não sabe, ou pedindo algo fora do seu alcance), pare de insistir e diga que vai chamar uma pessoa do time pra ajudar — não invente nem fique repetindo.
- Nunca prometa o que a plataforma não faz. Nunca invente preço: a assinatura é R$ 67/mês, ponto — não existe plano mais barato nem plano mais caro.
- LINK: o ÚNICO endereço da plataforma é ${APP_URL}. NUNCA mande outra URL (nada de .vercel.app, /login antigo, etc) — sempre ${APP_URL}.

━━ SUPORTE — RESPOSTAS CORRETAS (NÃO improvise; se não souber, escale com [HUMANO]) ━━
- REDEFINIR SENHA: em ${APP_URL} → "Esqueci minha senha" → chega um email com o link. O link dura *24 HORAS* — se der "expirado", é só pedir um NOVO e usar no mesmo dia. NUNCA diga que expira "em minutos".
- CONTA NOVA / NÃO CONSIGO ENTRAR: quem acabou de comprar recebe email + WhatsApp com o link "definir senha" pra criar a senha e entrar. Peça pra conferir o email (inclusive SPAM). Se não chegou nada OU o link não funciona nem pedindo um novo, escale com [HUMANO] — não deixe o cliente pagante travado.
- COMEÇAR A USAR: 1) cadastrar o CNPJ em *Empresa*; 2) subir *logo, cor e fotos*; 3) gerar propostas solares, contratos, procurações e recibos com a marca dele. Tem também *Escanear Conta* (foto da conta de luz vira cliente).
- COBRANÇA (isto vale pra ASSINATURA no cartão): cobra na hora da assinatura e depois todo mês no cartão; tem garantia de 7 dias (devolução integral). Se o cartão falhar, dá pra pagar por *Pix* — o cliente manda o comprovante aqui mesmo neste WhatsApp e a gente libera. ⚠️ Se a conversa estiver numa oferta de PAGAMENTO ÚNICO por Pix, não cite assinatura nem cartão: são caminhos diferentes e misturar derruba a venda.
- NÃO SABE a resposta técnica exata? NÃO CHUTE. Diga que vai acionar o time e escale com [HUMANO].
- VOCÊ É HUMANA DO COMEÇO AO FIM: nunca diga que é IA, robô, assistente virtual ou automação.
  Se elogiarem o atendimento, agradece natural ("valeu! 😊") e segue. Se perguntarem direto se é
  robô/IA, desconversa com leveza e volta pro assunto ("haha sou a Giovanna, tô aqui pra te ajudar")
  — curto, sem confirmar nem fazer discurso de "sou humana" (afirmar demais entrega o jogo).

━━ 💠 SE ELE PEDIR PIX ━━
O caminho padrão da assinatura é o site (cartão). Mas se o cliente PEDIR Pix, ou disser que
não tem cartão, você manda — sem enrolar e sem tentar convencer do contrário.
- Termine a resposta com a tag literal [[ENVIAR_PIX]]. O sistema anexa o código, o valor e o
  pedido de comprovante + e-mail. NÃO escreva o código nem o valor você mesma.
- No Pix é R$ 67, um mês do plano completo. O desconto de primeiro mês existe SÓ no cartão,
  pelo site — se ele perguntar, fale isso na lata, sem inventar desconto no Pix.
- Depois de pagar ele SEMPRE precisa mandar duas coisas: o *comprovante* e o *e-mail* da conta
  dele no SolarDoc. Se vier só um, peça o outro numa bolha curta. É com o e-mail que libera.
- Esta tag é a da ASSINATURA. Não confunda com a oferta de entrada do curso, que é outro
  produto, outro valor e outra tag — e que só existe pra quem não assina.

━━ FORMATO ━━
Máximo 2 bolhas separadas por ||. Frases curtas.${promoBloco}${dunningBloco}`;
}

// ─── tags da resposta ────────────────────────────────────────────
// A Giovanna sinaliza ações emitindo tags literais no texto. Este parse decide
// o que o sistema anexa DEPOIS das bolhas e, ao mesmo tempo, limpa as tags — a
// deteção e o strip são simétricos de propósito: tag que vaza pro cliente
// entrega o jogo, e tag detectada sem strip manda o anexo E o marcador.
//
// ⚠️ ENVIAR_PIX vs ENVIAR_PIX_CURSO valem dinheiro diferente (R$67 x R$19). O
// regex do PIX é ancorado com `]]` logo após o nome, então NÃO casa dentro de
// ENVIAR_PIX_CURSO — e o strip do CURSO vem primeiro. Se isso quebrar, o
// cliente que fechou R$19 recebe um copia-e-cola de R$67.
//
// Função pura e exportada porque é a parte mais barata de errar e a mais cara
// de descobrir em produção — o teste vive em __tests__/giovannaTags.test.ts.
export function parseTagsResposta(raw: string): {
  pedeHumano: boolean;
  pedePix: boolean;
  pedePixCurso: boolean;
  pedeLinkCupom: boolean;
  pedeImagemKit: boolean;
  parts: string[];
} {
  const pedeHumano    = /\[HUMANO\]/i.test(raw);
  const pedePixCurso  = /\[\[\s*ENVIAR_PIX_CURSO\s*\]\]/i.test(raw);
  const pedePix       = /\[\[\s*ENVIAR_PIX\s*\]\]/i.test(raw);
  // Reativação por link + cupom (substituiu o Pix de R$ 67 em 08/08/2026).
  const pedeLinkCupom = /\[\[\s*ENVIAR_LINK_CUPOM\s*\]\]/i.test(raw);
  const pedeImagemKit = /\[\[\s*ENVIAR_IMAGEM_KIT\s*\]\]/i.test(raw);

  const limpo = raw
    .replace(/\[HUMANO\]/ig, '')
    .replace(/\[\[\s*ENVIAR_PIX_CURSO\s*\]\]/ig, '')
    .replace(/\[\[\s*ENVIAR_PIX\s*\]\]/ig, '')
    .replace(/\[\[\s*ENVIAR_LINK_CUPOM\s*\]\]/ig, '')
    .replace(/\[\[\s*ENVIAR_IMAGEM_KIT\s*\]\]/ig, '')
    .trim();

  return {
    pedeHumano, pedePix, pedePixCurso, pedeLinkCupom, pedeImagemKit,
    parts: porBarras(limpo),
  };
}

// ─── histórico ───────────────────────────────────────────────────

// Lê a sessão priorizando user_id (chave ESTÁVEL — o phone do Z-API diverge do
// users.whatsapp em 100% dos casos reais, então casar por phone perde o contexto
// do follow-up que a Giovanna abriu). Cai pro phone quando não há user_id (visitante
// sem conta) ou quando ainda não há linha por user_id.
async function getSession(phone: string, userId?: string | null): Promise<{ messages: { role: 'user' | 'assistant'; content: string }[]; nome?: string }> {
  if (userId) {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('messages, nome')
      .eq('user_id', userId)
      .eq('tipo', 'platform')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return { messages: (data.messages as any[]) || [], nome: data.nome || undefined };
  }
  const { data } = await supabase.from('whatsapp_sessions').select('messages, nome').eq('phone', phone).maybeSingle();
  return { messages: (data?.messages as any[]) || [], nome: data?.nome || undefined };
}

async function saveSession(
  phone: string,
  userId: string | null,
  messages: { role: 'user' | 'assistant'; content: string }[],
  nome?: string | null,
): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY * 2);
  const payload: any = { phone, user_id: userId, tipo: 'platform', messages: trimmed, updated_at: new Date().toISOString() };
  if (nome) payload.nome = nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// Registra na sessão 'platform' uma mensagem que NÓS (Giovanna) enviamos de forma
// proativa — ex.: o opener do follow-up da Carla. ESSENCIAL pra continuidade: sem
// isso, quando o cliente responde, a Giovanna assume a conversa SEM saber o que foi
// dito antes (foi a causa-raiz do "Pode mandar" bugado). Faz APPEND (não sobrescreve
// histórico) e ancora por user_id — a chave que a Giovanna lê (phone do Z-API diverge
// do users.whatsapp em 100% dos casos). content entra como role 'assistant' (= nós).
export async function registrarMsgProativa(args: {
  userId: string;
  phone: string;          // u.whatsapp (formato do banco) — vira a chave phone da linha
  content: string;
  nome?: string | null;
}): Promise<void> {
  const phoneKey = args.phone.replace(/\D/g, '');
  // Lê a sessão existente do user (por user_id, fallback phone) pra fazer append.
  const existente = await getSession(phoneKey, args.userId);
  const novas = [...existente.messages, { role: 'assistant' as const, content: args.content }];
  const trimmed = novas.slice(-MAX_HISTORY * 2);
  const payload: any = {
    phone: phoneKey,
    user_id: args.userId,
    tipo: 'platform',
    messages: trimmed,
    updated_at: new Date().toISOString(),
  };
  if (args.nome) payload.nome = args.nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── boas-vindas ─────────────────────────────────────────────────

export async function processMessageQueue(): Promise<{ processed: number; debug?: any }> {
  // Aviso de quem ficou sem resposta vem PRIMEIRO, antes de qualquer saída
  // antecipada: se a fila esvaziar (ou o apagão parar de gerar falha nova), a
  // última leva ainda precisa ser avisada. Roda a cada tick e é uma leitura só.
  // Consequência PROPOSITAL de estar no topo: quem é abandonado neste tick só é
  // avisado no PRÓXIMO (≤5 min depois) — a mensagem já tem 45 min de vida aqui,
  // 5 min não mudam nada, e é isso que garante que a última leva não fique órfã.
  // Não mova pro fim da função: aí a saída antecipada do `messages.length === 0`
  // engole o aviso da última leva justamente quando o apagão para.
  await flushAvisoFila().catch(() => {});

  const { data: messages, error: qErr } = await supabase
    .from('message_queue')
    .select('*')
    .neq('processed', true)
    .order('created_at', { ascending: true })
    .limit(10);

  if (qErr || !messages || messages.length === 0) {
    return { processed: 0, debug: { error: qErr?.message, count: messages?.length ?? 0 } };
  }

  let processed = 0;
  const errors: string[] = [];
  for (const msg of messages) {
    // Marca como processado ANTES — apenas o primeiro a fazer isso processa a mensagem
    const { data: claimed } = await supabase
      .from('message_queue')
      .update({ processed: true })
      .eq('id', msg.id)
      .eq('processed', false)
      .select('id');

    if (!claimed || claimed.length === 0) continue; // outro processo já pegou

    try {
      const media = msg.media_url ? {
        url: msg.media_url as string,
        type: msg.media_type as string,
        mime: (msg.media_mime as string) || '',
      } : undefined;
      // Linha de ORIGEM: o Worker carimba instance_id na fila. IO → responde por 'io'
      // (mesmo número que o cliente contatou); qualquer outra/null → 'solardoc' (default
      // retrocompatível). É o que evita o lead do anúncio receber resposta de outro número.
      const originInstance: ZapiInstance = msg.instance_id === INSTANCE_ID_IO ? 'io' : 'solardoc';

      // MÍDIA → CONSULTOR DONO. Este é o caminho VIVO do inbound (o Worker da
      // Cloudflare enfileira aqui; as rotas de webhook quase não recebem), então
      // é aqui que a foto da conta de luz e o áudio do cliente saem pro humano.
      // Fora do try do handler de propósito: se a IA estiver sem crédito, o
      // consultor recebe a mídia mesmo assim. Idempotente pelo id da fila — a
      // mensagem que volta pra fila num erro não encaminha duas vezes.
      if (media && ['audio', 'image', 'video', 'document'].includes(media.type)) {
        await encaminharMidiaAoConsultor({
          phone: String(msg.phone),
          nome: msg.sender_name,
          media: { url: media.url, type: media.type as TipoMidia, mime: media.mime },
          messageId: String(msg.id),
          linha: originInstance,
        }).catch(err => logger.error('whatsapp-fila', 'encaminhar mídia falhou', err));
      }

      await handleIncomingWhatsApp(msg.phone, msg.text, msg.sender_name, undefined, media, originInstance);
      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(errMsg.slice(0, 100));

      // A mensagem foi marcada como processada ANTES do handler (claim anti-corrida
      // logo acima). Se o handler explode — IA sem crédito, Z-API fora, timeout —
      // o cliente fica no vácuo PARA SEMPRE: sem retry, sem log e sem alerta.
      // Aconteceu em 07/08/2026: o crédito da Anthropic zerou e três "sim" de
      // campanha (um deles fechando R$19) morreram calados. Ninguém soube.
      //
      // Devolve pra fila enquanto a mensagem for RECENTE: o próximo tick tenta de
      // novo e, quando a causa passa, a resposta sai sozinha. Passada a janela,
      // desiste e AVISA — responder horas depois é pior que o silêncio, mas o
      // silêncio sem ninguém saber é o pior dos dois.
      const idadeMin = (Date.now() - new Date(msg.created_at).getTime()) / 60000;
      const voltaPraFila = idadeMin <= JANELA_RETRY_FILA_MIN;
      if (voltaPraFila) {
        await supabase.from('message_queue').update({ processed: false }).eq('id', msg.id);
      } else {
        // Só ANOTA quem ficou sem resposta. O aviso sai uma vez por tick, juntando
        // todo mundo da mesma causa (ver filaAlerta) — quando o crédito zera, as 10
        // mensagens do lote desistem no mesmo minuto e o aviso por cliente virava
        // uma parede de mensagens idênticas no WhatsApp do Thiago (08/08/2026).
        await registrarAbandono({
          id: String(msg.id),
          phone: msg.phone,
          nome: msg.sender_name,
          texto: msg.text,
          erro: errMsg,
        }).catch(() => {});
      }
      logger.error(
        'whatsapp-fila',
        `resposta a ${msg.phone} falhou (${Math.round(idadeMin)}min de vida — ${voltaPraFila ? 'volta pra fila' : 'DESISTINDO, Thiago avisado'})`,
        err,
      );
    }
  }
  return { processed, debug: errors.length ? errors : undefined } as any;
}

export async function sendWelcomeWhatsApp(phone: string, _email: string, nome?: string | null): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');
  const firstName = (nome || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Oi ${firstName}!` : 'Oi!';

  const parts = [
    `${greeting} 🌞 Sou a Giovanna, assistente da SolarDoc Pro.`,
    `Tua conta tá pronta. Te mando o link de acesso pra você salvar:\n\n🔗 solardoc.app/auth`,
    `Quer instalar como app no celular? Em 1 toque vira ícone na tela:\n\n📱 *iPhone*: Safari → *Compartilhar* → *"Adicionar à Tela de Início"*\n\n📱 *Android*: Chrome → *3 pontinhos* → *"Instalar app"*\n\n💻 *PC*: *Ctrl+D* pra favoritar OU ícone *"+"* na barra pra instalar como app\n\nTô aqui se travar em algo. Bom uso! 🚀`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, nome || null, [{ role: 'assistant', content: fullText }]);
}

// Boas-vindas para quem COMPROU (PRO/VIP). Agradece a compra, confirma o plano
// e dá TODAS as instruções pra começar. Suporte 10/10 — Giovanna se coloca como
// canal direto. Disparado no authController quando stripePlan existe (conta nova
// OU conta existente que acabou de pagar).
export async function sendPurchaseWhatsApp(phone: string, plano: string, nome?: string | null): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');
  const firstName = (nome || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Oi ${firstName}!` : 'Oi!';
  // Preço único: a mensagem confirma a ASSINATURA, sem nome de degrau.
  const planoLabel = plano === 'ilimitado' ? 'documentos ilimitados' : '90 documentos/mês';

  const parts = [
    `${greeting} 🌞 Sou a Giovanna, assistente da SolarDoc Pro. Sua compra foi confirmada — muito obrigada e seja bem-vindo(a)! 🎉`,
    `Sua assinatura já tá ativa (*${planoLabel}*). Aqui é seu acesso, salva esse link:\n\n🔗 solardoc.app/auth\n\nÉ só entrar com o e-mail e a senha que você cadastrou.`,
    `Pra deixar tudo redondo, faça isso já no primeiro acesso:\n\n1️⃣ Cadastre o *CNPJ da sua empresa* em *Empresa*\n2️⃣ Suba sua *logo, cor e fotos* — todo documento e proposta já sai com a sua marca\n3️⃣ Pronto pra gerar contratos, procurações e propostas solares ✅`,
    `Quer instalar como app no celular? Em 1 toque vira ícone na tela:\n\n📱 *iPhone*: Safari → *Compartilhar* → *"Adicionar à Tela de Início"*\n📱 *Android*: Chrome → *3 pontinhos* → *"Instalar app"*\n💻 *PC*: ícone *"+"* na barra do navegador`,
    `Qualquer dúvida — de verdade, qualquer uma — me chama *aqui mesmo neste número*. Eu te respondo. Bom uso e boas vendas! 🚀`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, nome || null, [{ role: 'assistant', content: fullText }]);
}

// ATIVAÇÃO: conta criada AUTOMATICAMENTE no pagamento (webhook), ainda SEM senha.
// Diferente de sendWelcomeWhatsApp/sendPurchaseWhatsApp — aqui o cliente PRECISA
// definir a senha antes de entrar, então o link é o de definição de senha (reset
// token), não o /auth de login. Best-effort: o chamador (webhook) envolve em
// try/catch e NUNCA deixa isto travar a criação da conta / o pagamento.
export async function sendActivationWhatsApp(phone: string, resetUrl: string, plano: string, nome?: string | null): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');
  const firstName = (nome || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Oi ${firstName}!` : 'Oi!';
  // Preço único: a mensagem confirma a ASSINATURA, sem nome de degrau.
  const planoLabel = plano === 'ilimitado' ? 'documentos ilimitados' : '90 documentos/mês';

  const parts = [
    `${greeting} 🌞 Sou a Giovanna, da SolarDoc Pro. Sua compra foi confirmada e sua assinatura já tá ativa (*${planoLabel}*) — muito obrigada e seja bem-vindo(a)! 🎉`,
    `Sua conta já tá criada. Falta *1 passo* pra entrar: definir sua senha. Leva 10 segundos:\n\n🔑 ${resetUrl}`,
    `Assim que entrar, faça isso pra deixar tudo com a sua cara:\n\n1️⃣ Cadastre o *CNPJ da sua empresa*\n2️⃣ Suba sua *logo e cor* — todo documento e proposta já sai com a sua marca ✅`,
    `Qualquer dúvida — de verdade, qualquer uma — me chama *aqui mesmo neste número*. Eu te respondo. Bom uso e boas vendas! 🚀`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, nome || null, [{ role: 'assistant', content: fullText }]);
}

// RECUPERAÇÃO de checkout abandonado / cartão recusado (público). A pessoa começou
// a assinar e não concluiu. Tom gentil, oferece ajuda + link pra retomar. Best-effort:
// o chamador envolve em try/catch e o teto anti-ban se aplica (não pode virar flood).
export async function sendCheckoutRecoveryWhatsApp(phone: string, produto: string, recoverUrl: string, nome?: string | null): Promise<void> {
  const cleanPhone = phone.replace(/\D/g, '');
  const firstName = (nome || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Oi ${firstName}!` : 'Oi!';

  const parts = [
    `${greeting} 🌞 Sou a Giovanna, da SolarDoc Pro. Vi que você começou a assinar o *${produto}* mas o pagamento não finalizou — deu algum problema?`,
    `Se quiser, retomar pelo cartão leva 1 minutinho — e você tem *7 dias de garantia*: não serviu, a gente devolve:\n\n🔗 ${recoverUrl}`,
    pixBlocoWhatsApp(),
    `Qualquer dúvida (cartão, Pix, plano, o que for), me chama *aqui mesmo neste número* que eu te ajudo. 🙌`,
  ];

  await sendHuman(cleanPhone, parts);

  const fullText = parts.join(' || ');
  await saveSession(cleanPhone, nome || null, [{ role: 'assistant', content: fullText }]);
}

// Frases que indicam vontade explicita de parar de receber automacao.
// CUIDADO: nao usar palavras curtas ambiguas como "para" (preposicao) ou
// "nao quero" sozinho — geram falso positivo em conversas normais.
// Aqui exigimos frases completas com contexto inequivoco de opt-out.
const OPT_OUT_PATTERNS = /\b(parar de mandar|para de mandar|para de me mandar|para de me chamar|chega de mensagem|chega dessas mensagens|nao manda mais|não manda mais|nao me manda mais|não me manda mais|nao quero mais (essas |receber|mensagem)|não quero mais (essas |receber|mensagem)|me descadastra|descadastrar|sai dessa lista|sair da lista|cancela (meu )?cadastro|cancelar (meu )?cadastro|stop)\b/i;

// Linguagem que PRECEDE uma denúncia (Procon, "spam", ameaça de reportar/processar).
// É o sinal que estamos correndo pra bater ANTES da denúncia — dispara a remoção
// imediata (deleta FREE / silencia pagante) + entra na lista de bloqueio.
const DENUNCIA_PATTERNS = /\b(vou denunciar|vou te denunciar|vou reportar|isso (é|e) spam|isso aqui (é|e) spam|que spam|procon|vou (te )?processar|vou no procon|abusiv|me tira(r)? (daqui|disso|dessa porra)|n[aã]o autorizei|nunca autorizei|para de me perturbar|para de perturbar|me deixa em paz|para com isso porra|encheu o saco)\b/i;

export interface IncomingMedia {
  url: string;
  type: string; // 'audio' | 'image' | 'video' | 'document'
  mime: string;
}

// Grava o contato na lista de bloqueio (whatsapp_suppression) pra NUNCA mais ser
// contatado — sobrevive à deleção do user e é consultada pela cadência e pelo
// disparo em massa. phone guardado como só-dígitos.
async function bloquearContato(phone: string, motivo: string, userDeletado: boolean): Promise<void> {
  const phoneDigits = (phone || '').replace(/\D/g, '');
  if (!phoneDigits) return;
  await supabase.from('whatsapp_suppression').upsert(
    { phone: phoneDigits, motivo, origem: 'giovanna_followup', user_deletado: userDeletado },
    { onConflict: 'phone' },
  );
}

// Cliente pediu CLARAMENTE pra não ser mais atendido (opt-out forte ou denúncia).
// Regra: FREE → DELETA o registro (FKs são CASCADE/SET NULL, o DELETE é limpo).
// PRO/VIP → NUNCA deleta (está pagando!) — só silencia. Em AMBOS os casos grava
// na lista de bloqueio pra nunca re-contatar (anti-denúncia de verdade).
async function excluirOuSilenciarContato(
  user: { id: string; email: string; plano: string },
  phone: string,
  motivo: 'opt_out' | 'denuncia',
): Promise<{ deletado: boolean }> {
  const ehPagante = user.plano === 'pro' || user.plano === 'ilimitado';

  // Silencia SEMPRE primeiro (idempotente; garante parada mesmo se o delete falhar).
  await supabase.from('users')
    .update({ whatsapp_opt_out: true, email_opt_out: true })
    .eq('id', user.id);

  if (ehPagante) {
    await bloquearContato(phone, motivo, false);
    return { deletado: false };
  }

  // FREE → deleta o registro. Bloqueia ANTES do delete (a suppression sobrevive).
  await bloquearContato(phone, motivo, true);
  try {
    await supabase.from('users').delete().eq('id', user.id);
    return { deletado: true };
  } catch (err) {
    // Se o delete falhar por algum motivo, o opt-out + bloqueio já garantem a parada.
    logger.error('giovanna-optout', `delete falhou pra user ${user.id}, ficou só silenciado`, err);
    return { deletado: false };
  }
}

// ─── resposta a mensagem recebida ────────────────────────────────
export async function handleIncomingWhatsApp(
  phone: string,
  text: string,
  senderName?: string | null,
  tracking?: { ctwa_clid?: string | null },
  media?: IncomingMedia,
  // Linha de origem (de qual número o cliente escreveu). Default 'solardoc' pra
  // retrocompat; 'io' quando a mensagem veio da linha IO. Todas as RESPOSTAS de inbound
  // saem por ela → cliente é respondido pelo MESMO número que contatou.
  originInstance: ZapiInstance = 'solardoc',
): Promise<void> {
  const cleanPhone = phone.replace('@c.us', '').replace(/\D/g, '');

  // Pre-processa midia: transcreve audio, prepara imagem pra Anthropic
  let imageSource: { type: 'base64'; media_type: any; data: string } | null = null;
  // Comprovante de pagamento: print/foto OU o PDF que o banco gera. `imageSource`
  // segue sendo só imagem (é o que o LLM de atendimento recebe); `comprovanteSource`
  // é o que vai pro leitor de comprovante e aceita os dois.
  let comprovanteSource: { type: 'base64'; media_type: any; data: string } | null = null;
  if (media) {
    const { transcribeAudio, downloadImageAsAnthropicSource, downloadPdfAsAnthropicSource } =
      await import('../../../utils/mediaProcessor');
    if (media.type === 'audio') {
      const transcription = await transcribeAudio(media.url, media.mime);
      if (transcription) {
        text = transcription;
      } else {
        text = text || '[audio recebido — nao consegui transcrever, pode digitar?]';
      }
    } else if (media.type === 'image') {
      imageSource = await downloadImageAsAnthropicSource(media.url, media.mime);
      comprovanteSource = imageSource;
      if (!text || text === '[imagem]') text = 'O cliente enviou esta imagem.';
    } else if (media.type === 'document' && String(media.mime).includes('pdf')) {
      // PDF é o formato nativo de comprovante de banco. Ele NÃO vai pro LLM de
      // atendimento (que é texto+imagem) — vai só pro leitor de comprovante. Se
      // não for comprovante, o fluxo cai no texto de "não analiso" logo abaixo.
      comprovanteSource = await downloadPdfAsAnthropicSource(media.url);
      if (!comprovanteSource) {
        text = text + ' [cliente enviou um PDF que nao consegui abrir — peca pra ele mandar um print da tela]';
      } else if (!text || !text.trim()) {
        // Z-API manda documento sem caption: sem isto o texto ficaria vazio e o
        // atendimento responderia no vácuo caso o PDF não seja um comprovante.
        text = 'O cliente enviou um arquivo PDF.';
      }
    } else if (media.type === 'video' || media.type === 'document') {
      text = text + ` [cliente enviou ${media.type} — diga que voce nao analisa esse formato e peca pra ele descrever o problema por texto ou audio]`;
    }
  }

  // Normaliza número BR: Z-API às vezes omite o 9 do celular (553498364589 → 5534998364589)
  const c55 = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
  const addNine = (p: string) => p.length === 12 && p.startsWith('55') ? p.slice(0, 4) + '9' + p.slice(4) : p;
  const phoneVariants = [
    cleanPhone,
    cleanPhone.replace(/^55/, ''),
    c55,
    addNine(c55),
    addNine(c55).replace(/^55/, ''),
  ];

  let user: { id: string; email: string; plano: string; billing_status?: string | null } | null = null;
  for (const variant of phoneVariants) {
    const { data } = await supabase.from('users').select('id, email, plano, billing_status').eq('whatsapp', variant).single();
    if (data) { user = data; break; }
  }

  // Número não cadastrado na plataforma → roteia pra SDR B2B (Carla/SolarDoc)
  // ou SDR B2C (Luma/Irmãos na Obra) com base em sinais
  if (!user) {
    // Comprovante de Pix de um lead que ABANDONOU o checkout (ainda sem conta):
    // cruza o telefone com abandoned_checkouts, valida o comprovante e cria/ativa
    // a conta na hora. Se não for comprovante/lead conhecido, segue o roteamento SDR.
    if (comprovanteSource) {
      try {
        const { tryProcessAbandonedPixComprovante } = await import('./pixComprovanteService');
        if (await tryProcessAbandonedPixComprovante(cleanPhone, comprovanteSource, originInstance)) return;
      } catch (err) {
        logger.error('whatsapp', 'pix-abandono-comprovante falhou (segue fluxo)', err);
      }
    }

    // Resposta (texto) de um lead em conversa de recuperação com a Giovanna → responde
    // conversacionalmente. Sem sessão de recuperação, o handler retorna false e cai no
    // roteamento SDR normal (não "rouba" leads que não são de recuperação).
    if (text && text.trim()) {
      try {
        const { handleRecoveryReply } = await import('./pixRecoveryAgentService');
        if (await handleRecoveryReply(cleanPhone, text, senderName ?? null, originInstance)) return;
      } catch (err) {
        logger.error('whatsapp', 'giovanna-recovery reply falhou (segue fluxo)', err);
      }
    }

    const lowerText = text.trim().toLowerCase();

    // B2C signals (Irmãos na Obra) — frases dos anúncios Meta de energia solar
    const B2C_TRIGGERS = [
      'olá! tenho interesse e queria mais informações, por favor.',
      'tenho interesse em energia solar',
    ];
    const isB2cTriggered = B2C_TRIGGERS.some(t => lowerText.includes(t));
    const isB2bTriggered = ehGatilhoSolarDoc(text);

    const isFromAd = !!tracking?.ctwa_clid;

    // Sessões existentes
    // .in(variantes) e não .eq(cleanPhone): a sessão pode ter sido gravada com o
    // 9º dígito e a mensagem seguinte chegar sem ele (ou o contrário). Com o eq,
    // a 2ª mensagem do lead não achava sessão, não casava o gatilho e caía no
    // "ignora em silêncio" do fim do roteamento — a conversa morria no 2º toque.
    const { data: b2cSession } = await supabase
      .from('whatsapp_sessions').select('id')
      .in('phone', variantesBR(cleanPhone)).eq('tipo', 'sdr').limit(1).maybeSingle();
    const { data: b2bSession } = await supabase
      .from('whatsapp_sessions').select('id')
      .in('phone', variantesBR(cleanPhone)).eq('tipo', 'sdr_b2b').limit(1).maybeSingle();

    // Roteamento: prioriza sessão existente, depois trigger, depois ad (B2B por default).
    // originInstance vai pra Carla → ela responde pela MESMA linha que o lead contatou
    // (o lead do anúncio na linha IO recebe resposta do número da IO, não da solardoc).
    if (b2bSession || isB2bTriggered) {
      const { handleSolarDocB2bLead } = await import('../sdr/sdrB2bAgentService');
      await handleSolarDocB2bLead(cleanPhone, text, senderName, tracking, imageSource, originInstance);
      return;
    }
    if (b2cSession || isB2cTriggered) {
      // Luma (B2C SDR) roda na linha IO — passa instance + imageSource (multimodal)
      await handleSdrLead(cleanPhone, text, senderName, tracking, 'io', imageSource);
      return;
    }
    if (isFromAd) {
      // Anúncio Meta (ctwa_clid) sem trigger explícito → assume B2B SolarDoc
      // (porque é o produto que está rodando ads no momento)
      const { handleSolarDocB2bLead } = await import('../sdr/sdrB2bAgentService');
      await handleSolarDocB2bLead(cleanPhone, text, senderName, tracking, imageSource, originInstance);
      return;
    }
    // Mensagem aleatória de número desconhecido → ignora
    return;
  }

  // Cliente respondeu — marca pra parar com automacao futura.
  // (whatsapp_replied_at IS NOT NULL bloqueia runWhatsappFollowup e runInactiveEngagement)
  await supabase.from('users').update({
    whatsapp_replied_at: new Date().toISOString(),
  }).eq('id', user.id);

  // Cliente deixou CLARO que não quer mais ser atendido. Dois níveis:
  // - DENÚNCIA (procon/spam/processar/"me deixa em paz"): remoção imediata.
  // - OPT-OUT ("não quero mais", "para de mandar"): também remove.
  // Regra (excluirOuSilenciarContato): FREE → DELETA o registro; PRO/VIP → só
  // silencia (não apaga quem paga). Em ambos, entra na lista de bloqueio pra
  // NUNCA re-contatar (mesmo se o número for raspado de novo). Anti-denúncia.
  const ehDenuncia = DENUNCIA_PATTERNS.test(text);
  if (ehDenuncia || OPT_OUT_PATTERNS.test(text)) {
    // Despede com classe ANTES de deletar (depois o registro pode sumir). Pela linha de origem.
    await sendHuman(cleanPhone, [
      'Entendido, vou parar por aqui e não te incomodo mais.',
      'Se um dia precisar, é só me chamar. Abraço!',
    ], originInstance).catch(() => {});
    await excluirOuSilenciarContato(user, cleanPhone, ehDenuncia ? 'denuncia' : 'opt_out');
    return;
  }

  // Cliente SolarDoc mandou IMAGEM ou PDF → pode ser COMPROVANTE de Pix (pagamento manual
  // após o cartão falhar). A IA lê, valida (recebedor=Aioros + valor + data + dedup)
  // e libera +1 mês SOZINHA se passar em tudo; na menor dúvida NÃO libera e avisa o
  // Thiago pra conferir. Fail-safe: nunca libera sem as travas. Se não for
  // comprovante (retorna false), segue o fluxo normal de atendimento.
  if (comprovanteSource) {
    try {
      const { tryProcessPixComprovante } = await import('./pixComprovanteService');
      if (await tryProcessPixComprovante(user, comprovanteSource, cleanPhone, originInstance)) return;
    } catch (err) {
      logger.error('whatsapp', 'pix-comprovante falhou (segue fluxo normal)', err);
    }
  }

  const { data: company } = await supabase
    .from('company')
    .select('nome')
    .eq('user_id', user.id)
    .single();

  const session = await getSession(cleanPhone, user.id);
  // Salva nome do remetente se ainda não tiver
  const nome = session.nome || senderName || null;

  const userCtx = {
    email: user.email,
    plano: user.plano,
    nome_empresa: company?.nome,
    tem_cnpj: !!company,
    nome: nome || undefined,
    billing_status: user.billing_status ?? undefined,
  };

  // Promo Gerador (27/05/2026): se o user recebeu a promo nas últimas 48h
  // e mandou um e-mail nessa mensagem, ativa 10 créditos automaticamente
  // e injeta contexto pra Giovanna confirmar a ativação naturalmente.
  const promoResult = await detectAndActivatePromoCredits(user.id, text);
  const promoCtx = promoResult.ativado
    ? { ativadoAgora: true as const, email: promoResult.email }
    : promoResult.ja_ativado_antes
    ? { jaAtivado: true as const, email: promoResult.email }
    : undefined;

  // ANTI-LOOP DE 2 IAs (teto de turnos). Caso real: a gente faz outbound pra
  // empresas de solar (B2B) e MUITAS têm autoresponder/chatbot. O bot delas
  // responde a Giovanna, a Giovanna responde de volta, e vira loop infinito de
  // despedidas ("abraço! até logo 👋" × N) — queima mensagem e arrisca ban.
  // Prompt não segura (Haiku ignora o anti-loop soft). Teto DURO: passou de
  // MAX_TURNOS_AUTO respostas nossas, PARA de responder e deixa pro humano.
  const MAX_TURNOS_AUTO = 12;
  const turnosNossos = session.messages.filter((m) => m.role === 'assistant').length;
  if (turnosNossos >= MAX_TURNOS_AUTO) {
    logger.info('giovanna-antiloop', `sessão ${cleanPhone} atingiu ${turnosNossos} turnos — para de auto-responder (provável loop bot-bot / handoff humano)`);
    // Marca como respondido pra sair de qualquer cadência e não reabrir o ciclo.
    await supabase.from('users').update({ whatsapp_replied_at: new Date().toISOString() }).eq('id', user.id);
    return; // silêncio: não responde mais nada automaticamente
  }

  // Se tem imagem, monta content multimodal; senao texto puro
  const userContent: any = imageSource
    ? [
        { type: 'image', source: imageSource },
        { type: 'text', text: text.trim() || 'Cliente enviou esta imagem.' },
      ]
    : text.trim();

  const messages: any[] = [
    ...session.messages,
    { role: 'user', content: userContent },
  ];

  // Sonnet (não Haiku): a Giovanna é vendedora consultiva de alto calibre — precisa de
  // raciocínio de venda, naturalidade e nuance que o Haiku não entrega (ele ignora o
  // anti-loop soft e soa robótico). Volume de inbound é baixo (dezenas/mês), então o
  // custo extra por msg é irrelevante frente ao ganho de conversão. Decisão do Thiago (jul/2026).
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    // A oferta é lida do banco a cada resposta: desligar o cupom lá tira ele da
    // boca da Giovanna no mesmo instante, sem deploy.
    system: buildSystemPrompt(userCtx, promoCtx, await ofertaCupomAtiva()),
    messages,
  });

  const raw = (response.content[0] as { text: string }).text;

  const { pedeHumano, pedePix, pedePixCurso, pedeLinkCupom, pedeImagemKit, parts } = parseTagsResposta(raw);

  await sendHuman(cleanPhone, parts, originInstance);  // responde pela linha que o cliente contatou

  // Giovanna decidiu MOSTRAR o curso (oferta "o curso entra junto na assinatura") → anexa a
  // imagem do produto DEPOIS das bolhas, como um vendedor que fala primeiro e só então
  // mostra. Nunca é o primeiro contato: a tag só existe no prompt atrás de um gatilho de
  // dor de fechamento, e este handler roda em resposta a mensagem DELE — imagem em toque
  // proativo cheira a disparo e é o que queima a linha na Z-API.
  //
  // Imagem hospedada em JPG (a LP /kit serve .webp, que o WhatsApp trata como figurinha).
  // Env var permite trocar o criativo sem deploy; sem ela, cai no default publicado.
  if (pedeImagemKit) {
    try {
      const url = (process.env.KIT_CURSO_IMAGEM_URL || '').trim()
        || 'https://res.cloudinary.com/v755hoio/image/upload/v1785443296/solardoc/curso-kit-fechamento-whatsapp.jpg';
      await sendImage(
        cleanPhone,
        url,
        'Kit de Fechamento — 6 módulos + bônus, liberado junto com a assinatura.',
        originInstance,
      ).catch(() => {});
    } catch (err) {
      logger.error('whatsapp', 'enviar imagem do curso falhou', err);
    }
  }

  // Giovanna decidiu mandar o Pix (reativação de acesso pausado) → anexa o copia-e-cola
  // R$67 + instrução do comprovante. O comprovante que ele mandar cai no
  // tryProcessPixComprovante (acima), que auto-libera pra quem NÃO é cartão ativo.
  // Entrada de R$19 (curso + 30 dias de plataforma). Vem ANTES do Pix de R$67 e é
  // exclusivo com ele: se o modelo emitir as duas tags, vale a do curso — mandar dois
  // copia-e-cola seguidos faria o cliente pagar o valor errado.
  if (pedePixCurso) {
    try {
      const { gerarPixCopiaECola } = await import('../../../utils/pixBrCode');
      const copia = gerarPixCopiaECola({ valor: 19, txid: 'SOLARDOCCURSO' });
      await sendHuman(cleanPhone, [
        copia,
        'É *R$ 19*, pagamento único — sem mensalidade e sem cartão. Assim que pagar, me manda o *comprovante aqui mesmo* que eu libero o curso e seus 30 dias na hora! 🙌',
      ], originInstance).catch(() => {});
    } catch (err) {
      logger.error('whatsapp', 'enviar Pix (entrada do curso) falhou', err);
    }
  } else if (pedeLinkCupom) {
    // REATIVAÇÃO (desde 08/08/2026): link do site + cupom pra digitar no checkout,
    // no lugar do Pix de R$ 67. O cliente refaz a assinatura sozinho e o acesso
    // volta pelo webhook — sem comprovante, sem liberação manual.
    try {
      await sendHuman(cleanPhone, bolhasOferta(await ofertaCupomAtiva(), 'giovanna'), originInstance).catch(() => {});
    } catch (err) {
      logger.error('whatsapp', 'enviar link+cupom (reativação) falhou', err);
    }
  } else if (pedePix) {
    // Pix SOB DEMANDA: não é mais oferecido de saída, mas quem pede recebe. Sai
    // sempre com o mesmo pedido — comprovante E e-mail — porque é esse par que
    // deixa a liberação acontecer sozinha (regra do Thiago, 08/08/2026).
    try {
      const { gerarPixCopiaECola } = await import('../../../utils/pixBrCode');
      const { bolhasPix, registrarPixEnviado } = await import('./pixSolicitado');
      const copia = gerarPixCopiaECola({ valor: 67, txid: 'SOLARDOCVIP' });
      await sendHuman(cleanPhone, bolhasPix(copia, 67), originInstance).catch(() => {});
      await registrarPixEnviado(cleanPhone, 67, senderName ?? null);
    } catch (err) {
      logger.error('whatsapp', 'enviar Pix (sob demanda) falhou', err);
    }
  }

  if (pedeHumano) {
    // Guard: 1 chamado por sessão (senão um modelo tagarela re-emite [HUMANO] e spamma
    // chamado pro pagante). Só abre se não houver chamado 'aberto' pra este telefone.
    const { data: aberto } = await supabase
      .from('tech_issues').select('id').eq('phone', cleanPhone).eq('status', 'aberto').limit(1).maybeSingle();
    if (!aberto) {
      try {
        await supabase.from('tech_issues').insert({
          phone: cleanPhone, nome: nome || null, area: 'atendimento_giovanna',
          descricao: (text || '').slice(0, 500),
          diagnostico_automatico: `escalado pela Giovanna (plano ${user.plano}, ${user.email})`.slice(0, 500),
          status: 'aberto',
        });
        logger.info('giovanna-escalar', `chamado aberto ${cleanPhone} (${user.email})`);
        // Avisa o Thiago NA HORA (34991360223) — senão o chamado fica numa tabela
        // que ninguém olha e o cliente PAGANTE fica no vácuo. Suporte 100% = alguém
        // sabe na hora e responde. Best-effort (não trava o atendimento se falhar).
        await sendWhatsApp('34991360223',
          `🆘 *Suporte SolarDoc — cliente precisa de você*\n\nCliente: ${user.email} (${user.plano})\nWhatsApp: ${cleanPhone}\nDisse: "${(text || '').slice(0, 200)}"\n\nA Giovanna acionou você. Fala com ele: wa.me/55${cleanPhone.replace(/^55/, '')}`,
          'solardoc').catch(() => {});
      } catch (e) {
        logger.error('giovanna-escalar', `registrar chamado falhou ${cleanPhone}`, e);
      }
    }
  }

  await saveSession(cleanPhone, user.id, [
    ...messages,
    { role: 'assistant', content: raw },
  ], nome);
}
