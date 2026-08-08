// ─────────────────────────────────────────────────────────────────────────────
// GIOVANNA — recuperação de carrinho abandonado (conversacional).
// Não é blast fixo: a Giovanna se APRESENTA, puxa papo, responde as respostas do
// lead e manda o CAMINHO no momento certo.
//
// MUDANÇA 08/08/2026 (Thiago): o caminho deixou de ser Pix copia-e-cola. Agora é
// site + cupom — o lead entra em solardoc.app, assina no cartão e DIGITA o cupom
// no checkout pra pagar R$ 19 no primeiro mês. Ele mesmo se cadastra; ninguém
// libera acesso na mão e ninguém precisa conferir comprovante.
// Regra do Thiago junto com isso: mensagens CURTAS, e o link vai assim que ele
// responde — não fica esperando o momento perfeito.
//
// Lead de abandono NÃO tem conta → a conversa vive numa sessão própria
// (whatsapp_sessions tipo 'recovery', chaveada por telefone, sem user_id). O opener
// sai do cron de recuperação; as respostas caem aqui pelo inbound (número desconhecido).
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendHuman, sleep } from '../zapiClient';
import { porBarras } from '../bolhas';
import { logger } from '../../../utils/logger';
import { ofertaCupomAtiva, bolhasOferta, resumoOfertaParaPrompt, LINK_ASSINATURA, OfertaCupom } from '../../../utils/ofertaCupom';
import { gerarPixCopiaECola } from '../../../utils/pixBrCode';
import { bolhasPix, registrarPixEnviado, guardarEmailSePendente } from './pixSolicitado';
import { registrarMsgProativa } from './whatsappAgentService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Pix sob demanda = um mês do plano completo. NÃO é o cupom: o desconto de
// primeiro mês vive no cartão (é um `coupon` da Stripe na assinatura) e R$ 19 no
// Pix já significa outra coisa aqui dentro — a entrada do curso, que libera o
// Kit de Fechamento. Misturar os dois daria o curso de brinde.
const PIX_VALOR = 67;
const MAX_HISTORY = 8;               // pares de mensagens guardados na sessão
const DASHBOARD_URL = LINK_ASSINATURA;

type Msg = { role: 'user' | 'assistant'; content: string };

function firstName(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const p = nome.trim().split(' ')[0];
  return p || null;
}

// ─── SESSÃO 'recovery' (por telefone, sem conta) ─────────────────────────────

async function getRecoverySession(phoneKey: string): Promise<{ messages: Msg[]; nome: string | null; exists: boolean }> {
  const { data } = await supabase
    .from('whatsapp_sessions').select('messages, nome')
    .eq('phone', phoneKey).eq('tipo', 'recovery').maybeSingle();
  return { messages: (data?.messages as Msg[] | null) ?? [], nome: (data?.nome as string | null) ?? null, exists: !!data };
}

async function saveRecoverySession(phoneKey: string, messages: Msg[], nome: string | null): Promise<void> {
  const payload: Record<string, unknown> = {
    phone: phoneKey, tipo: 'recovery',
    messages: messages.slice(-MAX_HISTORY * 2),
    updated_at: new Date().toISOString(),
  };
  if (nome) payload.nome = nome;
  await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'phone,tipo' });
}

// ─── PERSONA ─────────────────────────────────────────────────────────────────

function giovannaSystem(nome: string | null, oferta: OfertaCupom | null): string {
  const quem = nome ? `O lead se chama ${nome} (use o primeiro nome com naturalidade, sem repetir toda hora).` : 'Você ainda não sabe o nome do lead.';
  return [
    'Você é a "Giovanna", consultora da SolarDoc (solardoc.app) — uma PESSOA de verdade, calorosa e direta, NÃO um robô. Fala como gente no WhatsApp: leve, humana, sem script.',
    '',
    'SITUAÇÃO: este lead começou a assinar o SolarDoc mas o pagamento no CARTÃO não completou (recusado ou desistiu). Você está reabrindo a conversa pra ajudar ele a entrar.',
    quem,
    '',
    resumoOfertaParaPrompt(oferta),
    '',
    'COMO CONDUZIR:',
    '- Acolhe primeiro ("foi o cartão que não passou?"). No primeiro toque, só abre a conversa.',
    `- Assim que ele responder qualquer coisa que não seja "não quero", MANDE O CAMINHO: inclua o marcador [[ENVIAR_LINK]] no fim da sua resposta. O sistema anexa o link e o passo a passo do cupom sozinho — NÃO escreva o link nem o cupom você mesma, e não invente outro desconto.`,
    '- No caminho do site ele faz tudo sozinho: você não libera acesso na mão.',
    '- SE ELE PEDIR PIX (ou disser que não tem cartão): manda sim, sem enrolar. Inclua o marcador [[ENVIAR_PIX]] — o sistema anexa o código, o valor e o pedido do comprovante + e-mail. NÃO escreva o código nem o valor você mesma, e não mande o link junto (ele já escolheu o caminho).',
    `- O Pix é R$ ${PIX_VALOR}, um mês do plano completo — o desconto de primeiro mês existe só no cartão, pelo site. Se ele perguntar, fale isso na lata, sem inventar desconto no Pix.`,
    '- Depois que ele pagar por Pix, você SEMPRE precisa de duas coisas: o *comprovante* e o *e-mail* dele. Se vier só um, peça o outro numa bolha curta. É com o e-mail que o acesso é liberado.',
    '- Se ele pedir pra parar, disser que não quer, ou claramente recusar → responda educada e curta e inclua o marcador [[ENCERRAR]].',
    '- Dúvida sobre o produto: responde com sinceridade e curto. Você acredita no que vende.',
    '',
    'ESTILO (crítico pra não parecer robô):',
    '- MENSAGENS CURTAS: 1 bolha, no máximo 2. Cada bolha com no máximo 2 linhas. Separe bolhas com ||.',
    '- Frases curtas, tom de conversa real. 0-1 emoji, natural.',
    '- Varie o jeito de falar; não repita a mesma abertura.',
    '- NADA de frases de manual ("estou à disposição", "não perca", "prezado"). NADA de markdown.',
    '- Termine puxando resposta (uma pergunta curta), a não ser que esteja encerrando.',
    '- Saída: SOMENTE o texto das bolhas (com || entre elas) + os marcadores quando couber. Sem aspas, sem prefixo, sem explicação.',
  ].join('\n');
}

// Objetivo do OPENER por toque — sequência conversacional (mesmo padrão humano em
// todos, ângulo diferente a cada um). Toques além do último repetem o tom de despedida.
const OBJETIVOS_OPENER: Record<number, string> = {
  1: 'Apresente-se ("aqui é a Giovanna, do SolarDoc") de um jeito leve, diga que viu que o pagamento no cartão não completou e pergunte se foi o cartão. UMA bolha curta. Ainda NÃO mande o link — só abra a conversa.',
  2: 'Volte com leveza e conte a novidade em uma frase: dá pra entrar pagando bem menos no primeiro mês. Ofereça mandar o caminho ([[ENVIAR_LINK]] se soar natural).',
  3: 'Contorne a hesitação típica com sinceridade (sem fidelidade, cancela quando quiser, leva 2 minutos) e mande o caminho ([[ENVIAR_LINK]]).',
  4: 'Traga UM ganho real do produto (proposta com payback na frente do cliente, contrato com a marca dele, documento em ~2min) e deixe o caminho ([[ENVIAR_LINK]]).',
  5: 'Pergunta direta e calorosa: o que travou? Mostre que quer ajudar de verdade, não só vender. Deixa o caminho disponível ([[ENVIAR_LINK]]).',
  6: 'Despedida com classe, sem pressão: você vai parar de mandar mensagem, mas deixa o caminho aqui pra quando ele quiser ([[ENVIAR_LINK]]). Porta aberta.',
};
function objetivoOpener(touch: number): string {
  return OBJETIVOS_OPENER[touch] ?? OBJETIVOS_OPENER[6];
}

async function gerarResposta(system: string, messages: Msg[], instrucaoFinal: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 220,
    system,
    messages: [...messages, { role: 'user', content: instrucaoFinal }],
  });
  const txt = (res.content.find(b => b.type === 'text') as { text?: string } | undefined)?.text ?? '';
  return txt.trim().replace(/^["']|["']$/g, '');
}

// ─── ENVIO (parseia bolhas + marcadores, manda o Pix quando pedido) ──────────

// Envia o texto da Giovanna; se tiver [[ENVIAR_LINK]], anexa o link + o passo a
// passo do cupom. Retorna o que foi enviado (pra salvar na sessão) e os marcadores.
// `forcarLink` ignora o marcador e manda o caminho de qualquer jeito — é a regra
// do Thiago pra primeira resposta do lead (ver handleRecoveryReply).
async function enviarComMarcadores(
  phone: string, raw: string, oferta: OfertaCupom | null, forcarLink = false, nome: string | null = null,
): Promise<{ enviado: string[]; encerrar: boolean; mandouLink: boolean }> {
  // ENVIAR_PIX é ancorado com `]]` logo depois do nome pra não casar dentro de
  // ENVIAR_PIX_CURSO (que existe no outro agente e vale outro valor).
  const pediuPix = /\[\[\s*ENVIAR_PIX\s*\]\]/i.test(raw);
  const pediuLink = /\[\[\s*ENVIAR_LINK\s*\]\]/i.test(raw);
  const encerrar = /\[\[\s*ENCERRAR\s*\]\]/i.test(raw);
  const limpo = raw
    .replace(/\[\[\s*ENVIAR_PIX\s*\]\]/ig, '')
    .replace(/\[\[\s*ENVIAR_LINK\s*\]\]/ig, '')
    .replace(/\[\[\s*ENCERRAR\s*\]\]/ig, '')
    .trim();

  const bolhas = porBarras(limpo);
  const enviado: string[] = [];
  if (bolhas.length) {
    await sendHuman(phone, bolhas, 'solardoc');
    enviado.push(...bolhas);
  }

  // PIX SÓ QUANDO ELE PEDE (regra do Thiago, 08/08/2026). Ganha do link: se ele
  // pediu Pix, mandar o site junto é ignorar o que ele acabou de falar.
  if (pediuPix && !encerrar) {
    await sleep(600);
    const copia = gerarPixCopiaECola({ valor: PIX_VALOR, txid: 'SOLARDOCVIP' });
    const passos = bolhasPix(copia, PIX_VALOR);
    await sendHuman(phone, passos, 'solardoc');
    enviado.push(...passos);
    // Marca que existe um Pix pendente deste telefone: é o que permite casar o
    // comprovante (e o e-mail) depois, mesmo sem checkout abandonado.
    await registrarPixEnviado(phone, PIX_VALOR, nome);
    return { enviado, encerrar, mandouLink: false };
  }

  // Quem está saindo da conversa não recebe oferta na saída.
  const mandouLink = (pediuLink || forcarLink) && !encerrar;
  if (mandouLink) {
    await sleep(600);
    const passos = bolhasOferta(oferta);
    await sendHuman(phone, passos, 'solardoc');
    enviado.push(...passos);
  }
  return { enviado, encerrar, mandouLink };
}

// Já mandamos o caminho nesta conversa? Evita repetir o link a cada resposta —
// mandar de novo em toda mensagem é o que faz parecer robô.
function jaMandouLink(messages: Msg[]): boolean {
  return messages.some(m => m.role === 'assistant' && m.content.includes(LINK_ASSINATURA));
}

// ─── OPENER (chamado pelo cron de recuperação) ───────────────────────────────

export async function enviarOpenerRecuperacao(phone: string, nome: string | null, touch: number): Promise<boolean> {
  const phoneKey = phone.replace(/\D/g, '');
  try {
    const sess = await getRecoverySession(phoneKey);
    const oferta = await ofertaCupomAtiva();
    let raw: string;
    try {
      raw = await gerarResposta(giovannaSystem(nome, oferta), sess.messages,
        `Gere a mensagem de recuperação (toque ${touch}). ${objetivoOpener(touch)}`);
    } catch (err) {
      logger.error('pix-recovery', 'falha gerando opener via IA, usando fallback', err);
      const oi = firstName(nome) ? `Oi ${firstName(nome)}! ` : 'Oi! ';
      raw = touch <= 1
        ? `${oi}Aqui é a Giovanna, do SolarDoc 😊 || Vi que seu pagamento não completou — foi o cartão?`
        : oferta
          ? `${oi}Voltei rapidinho: dá pra entrar pagando R$ ${oferta.primeiroMes} no primeiro mês. Te mando o caminho? [[ENVIAR_LINK]]`
          : `${oi}Voltei rapidinho pra te ajudar a garantir seu acesso. Te mando o caminho? [[ENVIAR_LINK]]`;
    }
    const { enviado } = await enviarComMarcadores(phone, raw, oferta);
    const novas: Msg[] = [...sess.messages, ...enviado.map(c => ({ role: 'assistant' as const, content: c }))];
    await saveRecoverySession(phoneKey, novas, nome);
    return true;
  } catch (err) {
    logger.error('pix-recovery', `opener falhou pra ${phoneKey}`, err);
    return false;
  }
}

// ─── REPLY (chamado pelo inbound de número desconhecido) ─────────────────────
// Retorna true se ATENDEU (havia sessão de recuperação). Se não há sessão, retorna
// false → o inbound segue o roteamento normal (SDR).

export async function handleRecoveryReply(
  cleanPhone: string, text: string, senderName: string | null, _instance?: unknown,
): Promise<boolean> {
  const phoneKey = cleanPhone.replace(/\D/g, '');
  const sess = await getRecoverySession(phoneKey);
  if (!sess.exists) return false; // não é um lead de recuperação → deixa o SDR tratar

  const nome = sess.nome ?? senderName ?? null;
  const historico: Msg[] = [...sess.messages, { role: 'user', content: text }];
  const oferta = await ofertaCupomAtiva();

  // Mandou o e-mail? Guarda AGORA, antes de qualquer resposta. É esse e-mail que
  // vai casar o comprovante com a conta na hora de liberar — e ele costuma vir
  // numa mensagem separada da foto.
  const emailInformado = await guardarEmailSePendente(cleanPhone, text, nome);

  // Se o comprovante já tinha chegado (antes do e-mail), este é o momento de
  // liberar. A própria função avisa o cliente e o Thiago; aqui a conversa só
  // termina, pra Giovanna não mandar uma segunda mensagem por cima da boa notícia.
  if (emailInformado) {
    try {
      const { liberarComprovantePendente } = await import('./pixComprovanteService');
      const venc = await liberarComprovantePendente(cleanPhone, emailInformado, nome);
      if (venc) {
        await saveRecoverySession(phoneKey, [...historico, {
          role: 'assistant', content: `[acesso liberado por Pix até ${venc.toLocaleDateString('pt-BR')}]`,
        }], nome);
        return true;
      }
    } catch (err) {
      logger.error('pix-recovery', `liberar comprovante pendente falhou (${cleanPhone})`, err);
    }
  }

  // REGRA DO THIAGO (08/08/2026): respondeu, recebe o caminho. Na PRIMEIRA
  // resposta o link vai junto mesmo que a IA não peça — o lead engajado não pode
  // ficar esperando a Giovanna achar o momento perfeito. Depois disso, só quando
  // ela pedir (senão vira spam do mesmo link).
  const forcarLink = !jaMandouLink(sess.messages);

  // Pediu Pix? Então o link não vai forçado por cima — ele já escolheu o caminho.
  const pedindoPix = /\bpix\b/i.test(text);

  let raw: string;
  try {
    raw = await gerarResposta(giovannaSystem(nome, oferta), historico,
      pedindoPix
        ? 'O lead está pedindo Pix. Responda CURTO (1 bolha) confirmando que já vai mandar e use [[ENVIAR_PIX]] — o sistema anexa o código, o valor e o pedido de comprovante + e-mail.'
        : emailInformado
          ? `O lead mandou o e-mail dele (${emailInformado}). Confirme que anotou, em UMA bolha curta, e diga que assim que chegar o comprovante você libera. Não repita o link.`
          : forcarLink
            ? 'Responda a última mensagem do lead como a Giovanna, CURTO (1 bolha), e já emende que vai mandar o caminho pra ele entrar — o sistema anexa o link e o cupom logo depois. Se ele estiver recusando, use [[ENCERRAR]].'
            : 'Responda a última mensagem do lead como a Giovanna (curto: 1 bolha, 2 no máximo; marcadores quando couber).');
  } catch (err) {
    logger.error('pix-recovery', 'falha gerando reply via IA, usando fallback', err);
    raw = pedindoPix ? 'Claro! Segue aqui 👇 [[ENVIAR_PIX]]' : 'Boa! Te mando o caminho aqui 👇 [[ENVIAR_LINK]]';
  }

  // Quem pediu Pix ou acabou de mandar o e-mail não recebe o link empurrado.
  const forcarLinkAgora = forcarLink && !pedindoPix && !emailInformado;
  const { enviado, encerrar } = await enviarComMarcadores(cleanPhone, raw, oferta, forcarLinkAgora, nome);
  const novas: Msg[] = [...historico, ...enviado.map(c => ({ role: 'assistant' as const, content: c }))];
  await saveRecoverySession(phoneKey, novas, nome);

  // Lead pediu pra parar → tira do cron de recuperação (para de mandar opener).
  if (encerrar) {
    await supabase.from('abandoned_checkouts')
      .update({ status: 'opted_out', updated_at: new Date().toISOString() })
      .eq('status', 'abandoned')
      .filter('phone', 'ilike', `%${phoneKey.slice(-8)}`);
    logger.info('pix-recovery', `lead encerrou a conversa (${phoneKey})`);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// DUNNING conversacional — cliente cujo pagamento no cartão falhou (trial venceu ou
// renovação). Substitui o WhatsApp scriptado do dunningService por uma conversa da
// Giovanna oferecendo reativação por Pix. Salva na sessão 'platform' (por user_id) — o
// reply é atendido pela Giovanna da plataforma, que agora conhece o contexto de billing.
// ─────────────────────────────────────────────────────────────────────────────

// Tom por dia de dunning (0 = acabou de falhar, 4 = último dia antes do cancelamento).
const DUNNING_TOM: Record<number, string> = {
  0: 'O pagamento no cartão acabou de falhar; o acesso segue ativo por 5 dias. Acolhe com leveza e pergunta se foi o cartão. UMA bolha.',
  1: 'Faz 1 dia que a cobrança falhou (faltam 4 pro cancelamento). Diz que resolve em 2 minutos e oferece mandar o caminho ([[ENVIAR_LINK]]).',
  2: 'Faz 2 dias (faltam 3). Continua acolhedora, pergunta se precisa de ajuda, deixa o caminho ([[ENVIAR_LINK]]).',
  3: 'Faz 3 dias (faltam 2 pro cancelamento). Um empurrãozinho gentil: dá pra reativar hoje ([[ENVIAR_LINK]]).',
  4: 'Último dia antes do cancelamento automático. Sem drama nem cobrança formal: seria uma pena perder o acesso, e reativar leva 2 minutos ([[ENVIAR_LINK]]).',
};

function giovannaDunningSystem(nome: string | null, oferta: OfertaCupom | null): string {
  const quem = nome ? `O cliente se chama ${nome} (use o primeiro nome com naturalidade).` : 'Você ainda não sabe o nome do cliente.';
  return [
    'Você é a "Giovanna", consultora da SolarDoc — uma PESSOA de verdade, calorosa e do lado do cliente. NUNCA soe como cobrança formal ("prezado", "regularize", "atenção"): você é humana, no WhatsApp.',
    'SITUAÇÃO: este cliente JÁ é assinante do SolarDoc, mas o pagamento no cartão falhou e o acesso está pausando. Você quer AJUDAR ele a reativar, sem estresse.',
    quem,
    resumoOfertaParaPrompt(oferta),
    `CAMINHO: ele reativa sozinho em ${DASHBOARD_URL}, assinando de novo com o cartão que funcionar. Quando ele topar / perguntar como faz / disser "pode mandar", inclua o marcador [[ENVIAR_LINK]] no fim — o sistema anexa o link e o passo a passo do cupom sozinho (NÃO escreva o link nem o cupom você mesma).`,
    'Você NÃO pede comprovante e NÃO manda Pix. É tudo no site, na mão dele.',
    'Se ele pedir pra parar / recusar → responda curto e educado com [[ENCERRAR]].',
    'ESTILO: MENSAGENS CURTAS — 1 bolha, no máximo 2, cada uma com até 2 linhas, separadas por ||. Tom humano de WhatsApp. 0-1 emoji. Sem markdown. Termine puxando resposta. Saída: só o texto das bolhas (+ marcadores quando couber).',
  ].join('\n');
}

// Envia o opener de dunning (Giovanna) e salva na sessão 'platform' do user pra o reply
// continuar coerente. Retorna true se enviou.
export async function enviarOpenerDunning(
  user: { id: string; email: string; nome: string | null; whatsapp: string | null },
  day: number,
): Promise<boolean> {
  if (!user.whatsapp) return false;
  const phone = user.whatsapp;
  try {
    const oferta = await ofertaCupomAtiva();
    let raw: string;
    try {
      raw = await gerarResposta(giovannaDunningSystem(user.nome, oferta), [],
        `Gere a mensagem de reativação (dia ${day} de 5). ${DUNNING_TOM[day] ?? DUNNING_TOM[0]}`);
    } catch (err) {
      logger.error('pix-recovery', 'falha gerando opener dunning, usando fallback', err);
      const oi = firstName(user.nome) ? `Oi ${firstName(user.nome)}! ` : 'Oi! ';
      raw = `${oi}Aqui é a Giovanna, do SolarDoc. Vi que o pagamento no cartão não passou e seu acesso tá pausando 😕 || Quer que eu te mande o caminho pra reativar? [[ENVIAR_LINK]]`;
    }
    const { enviado } = await enviarComMarcadores(phone, raw, oferta);
    if (enviado.length) {
      await registrarMsgProativa({ userId: user.id, phone, content: enviado.join('\n'), nome: user.nome });
    }
    return true;
  } catch (err) {
    logger.error('pix-recovery', `opener dunning falhou pra ${user.email}`, err);
    return false;
  }
}
