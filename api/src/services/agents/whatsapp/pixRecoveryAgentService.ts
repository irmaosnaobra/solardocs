// ─────────────────────────────────────────────────────────────────────────────
// GIOVANNA — recuperação de carrinho abandonado por PIX (conversacional).
// Não é blast fixo: a Giovanna se APRESENTA, puxa papo, responde as respostas do
// lead e manda o Pix (copia-e-cola R$67) no momento certo. Depois que o lead paga e
// manda o comprovante, o pixComprovanteService lê e libera na hora.
//
// Lead de abandono NÃO tem conta → a conversa vive numa sessão própria
// (whatsapp_sessions tipo 'recovery', chaveada por telefone, sem user_id). O opener
// sai do cron de recuperação; as respostas caem aqui pelo inbound (número desconhecido).
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../../utils/supabase';
import { sendHuman, sleep } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { gerarPixCopiaECola } from '../../../utils/pixBrCode';
import { registrarMsgProativa } from './whatsappAgentService';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PIX_VALOR = 67;                 // oferta: plano completo, ativa na hora
const MAX_HISTORY = 8;               // pares de mensagens guardados na sessão
const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

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

function giovannaSystem(nome: string | null): string {
  const quem = nome ? `O lead se chama ${nome} (use o primeiro nome com naturalidade, sem repetir toda hora).` : 'Você ainda não sabe o nome do lead.';
  return [
    'Você é a "Giovanna", consultora da SolarDoc (solardoc.app) — uma PESSOA de verdade, calorosa e direta, NÃO um robô. Fala como gente no WhatsApp: leve, humana, sem script.',
    '',
    'SITUAÇÃO: este lead começou a assinar o SolarDoc mas o pagamento no CARTÃO não completou (recusado ou desistiu). Você está reabrindo a conversa pra ajudar ele a garantir o acesso pelo PIX.',
    quem,
    '',
    'OFERTA (só quando fizer sentido na conversa): Pix de R$ 67/mês = plano COMPLETO (documentos ilimitados), e o acesso é liberado NA HORA que ele paga. Sem cartão, sem burocracia.',
    '',
    'COMO CONDUZIR:',
    '- Primeiro entenda/acolha ("foi o cartão que não passou?"). Não empurre o Pix de cara se ele ainda não engajou.',
    '- Quando o lead demonstrar que quer pagar/pergunta como faz/topa o Pix → aí sim mande o código. Pra ISSO, inclua o marcador [[ENVIAR_PIX]] no fim da sua resposta (o sistema anexa o copia-e-cola automaticamente — NÃO invente/escreva o código você mesma).',
    '- Se o lead pedir pra parar, disser que não quer, ou claramente recusar → responda educada e curta e inclua o marcador [[ENCERRAR]].',
    '- Responda dúvidas com sinceridade (o que é o plano, como paga, é seguro, etc). Você acredita no produto — vende com confiança, sem desconto, sem pressão.',
    '',
    'ESTILO (crítico pra não parecer robô):',
    '- 1 a 2 bolhas curtas. Separe bolhas com ||.',
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
  1: 'Apresente-se ("aqui é a Giovanna, do SolarDoc") de um jeito leve, diga que viu que o pagamento no cartão não completou e pergunte se foi o cartão. Ainda NÃO mande o Pix — só abra a conversa.',
  2: 'Volte com leveza, reforce UM ganho concreto (acesso completo ao SolarDoc, liberado na hora) e OFEREÇA o Pix explicitamente — se soar natural, já manda o código ([[ENVIAR_PIX]]).',
  3: 'Contorne a hesitação típica com sinceridade (sem fidelidade, cancela quando quiser, é seguro) e deixe claro que no Pix o acesso ativa na hora. Ofereça o código de novo se fizer sentido ([[ENVIAR_PIX]]).',
  4: 'Traga um ângulo de valor real do produto (proposta com payback na frente do cliente + contrato com a marca dele = fecha mais rápido; documento pronto em ~2min). Reforce que dá pra garantir pelo Pix ([[ENVIAR_PIX]]).',
  5: 'Pergunta direta e calorosa: o que travou? Mostre que quer ajudar de verdade, não só vender. Deixa o Pix disponível ([[ENVIAR_PIX]]).',
  6: 'Despedida com classe, sem pressão: você vai parar de mandar mensagem, mas deixa o Pix aqui pra quando ele quiser — é só pagar que libera na hora ([[ENVIAR_PIX]]). Porta aberta.',
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

function splitBolhas(raw: string): string[] {
  return raw.split('||').map(s => s.trim()).filter(Boolean);
}

// Envia o texto da Giovanna; se tiver [[ENVIAR_PIX]], anexa o copia-e-cola + instrução
// do comprovante. Retorna o que foi enviado (pra salvar na sessão) e os marcadores.
async function enviarComMarcadores(phone: string, raw: string): Promise<{ enviado: string[]; encerrar: boolean }> {
  const pediuPix = /\[\[\s*ENVIAR_PIX\s*\]\]/i.test(raw);
  const encerrar = /\[\[\s*ENCERRAR\s*\]\]/i.test(raw);
  const limpo = raw.replace(/\[\[\s*ENVIAR_PIX\s*\]\]/ig, '').replace(/\[\[\s*ENCERRAR\s*\]\]/ig, '').trim();

  const bolhas = splitBolhas(limpo);
  const enviado: string[] = [];
  if (bolhas.length) {
    await sendHuman(phone, bolhas, 'solardoc');
    enviado.push(...bolhas);
  }

  if (pediuPix) {
    await sleep(600);
    const copia = gerarPixCopiaECola({ valor: PIX_VALOR, txid: 'SOLARDOCVIP' });
    const instrucao = 'Assim que pagar, me manda o *comprovante aqui mesmo* que eu confirmo e libero seu acesso na hora! 🙌';
    await sendHuman(phone, [copia, instrucao], 'solardoc');
    enviado.push(copia, instrucao);
  }
  return { enviado, encerrar };
}

// ─── OPENER (chamado pelo cron de recuperação) ───────────────────────────────

export async function enviarOpenerRecuperacao(phone: string, nome: string | null, touch: number): Promise<boolean> {
  const phoneKey = phone.replace(/\D/g, '');
  try {
    const sess = await getRecoverySession(phoneKey);
    let raw: string;
    try {
      raw = await gerarResposta(giovannaSystem(nome), sess.messages,
        `Gere a mensagem de recuperação (toque ${touch}). ${objetivoOpener(touch)}`);
    } catch (err) {
      logger.error('pix-recovery', 'falha gerando opener via IA, usando fallback', err);
      const oi = firstName(nome) ? `Oi ${firstName(nome)}! ` : 'Oi! ';
      raw = touch <= 1
        ? `${oi}Aqui é a Giovanna, do SolarDoc 😊 || Vi que você começou a assinar mas o pagamento no cartão não rolou — foi o cartão? Dá pra garantir pelo Pix, se preferir.`
        : `${oi}Voltei aqui rapidinho. Dá pra garantir seu acesso completo pelo Pix (R$ 67, libera na hora). Quer que eu te mande o código? [[ENVIAR_PIX]]`;
    }
    const { enviado } = await enviarComMarcadores(phone, raw);
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

  let raw: string;
  try {
    raw = await gerarResposta(giovannaSystem(nome), historico,
      'Responda a última mensagem do lead como a Giovanna (siga as regras: 1-2 bolhas com ||, marcadores quando couber).');
  } catch (err) {
    logger.error('pix-recovery', 'falha gerando reply via IA, usando fallback', err);
    raw = 'Boa! Dá pra garantir pelo Pix (R$ 67, libera na hora). Te mando o código aqui 👇 [[ENVIAR_PIX]]';
  }

  const { enviado, encerrar } = await enviarComMarcadores(cleanPhone, raw);
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
  0: 'O pagamento no cartão acabou de falhar; o acesso segue ativo por 5 dias. Acolhe com leveza, pergunta se foi o cartão e oferece reativar/garantir na hora pelo Pix. Se soar natural, já manda o código.',
  1: 'Faz 1 dia que a cobrança falhou (faltam 4 pro cancelamento). Reforça que resolve em 1 min pelo Pix, sem estresse.',
  2: 'Faz 2 dias (faltam 3). Continua acolhedora, pergunta se precisa de ajuda, oferece o Pix.',
  3: 'Faz 3 dias (faltam 2 pro cancelamento). Um empurrãozinho gentil: garante o acesso hoje pelo Pix.',
  4: 'Último dia antes do cancelamento automático. Sem drama nem cobrança formal: seria uma pena perder o acesso, dá pra garantir agora pelo Pix em 1 min.',
};

function giovannaDunningSystem(nome: string | null): string {
  const quem = nome ? `O cliente se chama ${nome} (use o primeiro nome com naturalidade).` : 'Você ainda não sabe o nome do cliente.';
  return [
    'Você é a "Giovanna", consultora da SolarDoc — uma PESSOA de verdade, calorosa e do lado do cliente. NUNCA soe como cobrança formal ("prezado", "regularize", "atenção"): você é humana, no WhatsApp.',
    'SITUAÇÃO: este cliente JÁ é assinante do SolarDoc, mas o pagamento no cartão falhou e o acesso está pausando. Você quer AJUDAR ele a reativar, sem estresse.',
    quem,
    `CAMINHO MAIS FÁCIL: reativar na hora pelo *Pix* R$ 67 (plano completo, cai na hora). Alternativa: atualizar o cartão em ${DASHBOARD_URL}.`,
    'Quando fizer sentido oferecer o código do Pix (ele topou / perguntou como paga / disse "pode mandar"), inclua o marcador [[ENVIAR_PIX]] no fim — o sistema anexa o copia-e-cola sozinho (NÃO escreva o código você mesma).',
    'Se ele pedir pra parar / recusar → responda curto e educado com [[ENCERRAR]].',
    'ESTILO: 1-2 bolhas curtas separadas por ||. Tom humano de WhatsApp. 0-1 emoji. Sem markdown. Termine puxando resposta. Saída: só o texto das bolhas (+ marcadores quando couber).',
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
    let raw: string;
    try {
      raw = await gerarResposta(giovannaDunningSystem(user.nome), [],
        `Gere a mensagem de reativação (dia ${day} de 5). ${DUNNING_TOM[day] ?? DUNNING_TOM[0]}`);
    } catch (err) {
      logger.error('pix-recovery', 'falha gerando opener dunning, usando fallback', err);
      const oi = firstName(user.nome) ? `Oi ${firstName(user.nome)}! ` : 'Oi! ';
      raw = `${oi}Aqui é a Giovanna, do SolarDoc. Vi que o pagamento no cartão não passou e seu acesso tá pausando 😕 || Dá pra reativar na hora pelo Pix (R$ 67). Quer que eu te mande o código? [[ENVIAR_PIX]]`;
    }
    const { enviado } = await enviarComMarcadores(phone, raw);
    if (enviado.length) {
      await registrarMsgProativa({ userId: user.id, phone, content: enviado.join('\n'), nome: user.nome });
    }
    return true;
  } catch (err) {
    logger.error('pix-recovery', `opener dunning falhou pra ${user.email}`, err);
    return false;
  }
}
