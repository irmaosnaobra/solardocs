// ─────────────────────────────────────────────────────────────────────────────
// LUMA NO INSTAGRAM — a IA que conversa na DM e sai de lá com o WhatsApp.
//
// O QUE FALTAVA. O motor do IG (igEngine) é script puro: palavra-chave casa →
// resposta pronta → porteiro → link. Fora desse trilho, o lead só virava card
// no CRM se ELE digitasse o telefone espontaneamente (`telefoneDe`). Quem
// escrevia "e pra uma casa de 300 reais compensa?" caía em `responderDmFria`:
// um WhatsApp pro dono e silêncio pro lead. Aqui a conversa passa a existir.
//
// ONDE ELA ENTRA (e onde NÃO entra):
//   • entra SÓ quando nenhuma palavra-chave casou e o porteiro não está no meio
//     de um fluxo. Duas máquinas de estado no mesmo senderId brigam — o gate
//     roda até liberar, a IA assume depois. Ver igEngine.handleMessage.
//   • não entra em DM hostil (igHostil), que continua sendo assunto de gente.
//
// JANELA DE 24h: a Luma NUNCA inicia conversa — ela só responde a uma mensagem
// que acabou de chegar, e mensagem recebida é justamente o que abre a janela.
// Por isso `needs_window: false` (mesma escolha que o menu de DM fria já fazia)
// e envio imediato. Re-engajamento de quem sumiu continua sendo do lembrete de
// 1h do porteiro — a IA não tem cadência própria, de propósito.
//
// TETO DE BOLHAS = 2, e aqui pesa mais que no WhatsApp: cada bolha é um item da
// fila e consome o teto anti-ban de IG_MAX_POR_HORA (180). Parede de texto pro
// humano continua proibida; metralhadora, mais ainda.
//
// SEM CRÉDITO NA ANTHROPIC A DM NÃO PODE EMUDECER: qualquer erro devolve false
// e o chamador cai no comportamento de hoje (aviso pro dono + menu, se ligado).
// A regressão que não pode existir é o robô ficar pior do que era sem IA.
//
// Gate: IG_IA_DM_ON='true'. Nasce DESLIGADA.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { emBolhas } from '../agents/bolhas';
import { classificarHostil } from './igHostil';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/** Turnos de IA por pessoa por dia. Trava de loop: bot do outro lado, ou lead
 *  que só quer conversar, não podem virar 40 chamadas de modelo num dia.
 *  Lido em RUNTIME (como igEnv), não na importação: teto que só muda quando o
 *  processo reinicia é teto que não dá pra apertar no meio de um incidente. */
const maxTurnosDia = (): number => Number(process.env.IG_IA_MAX_TURNOS || 12);
/** Histórico que vai pro modelo. Conversa de DM é curta; 20 cobre de sobra. */
const MAX_HISTORICO = 20;

type Turno = { role: 'user' | 'assistant'; content: string };

const LUMA_IG = `Você é a "Luma", do Instagram da Irmãos na Obra (@irmaosnaobra__) — Uberlândia/MG, 8 anos no setor, +1400 sistemas instalados. Thiago e Diego são os irmãos donos, equipe própria de instalação, não terceiriza.

SUA ÚNICA MISSÃO: entender o que a pessoa quer e conseguir o WHATSAPP dela pra um consultor continuar. Você não fecha venda, não passa preço e não marca horário.

O QUE A EMPRESA FAZ:
- Energia solar (residencial e comercial): reduz a conta de luz, é investimento que se paga e dá independência da Cemig.
- Eletroposto: ponto de recarga de carro elétrico como fonte de renda pra quem tem ponto comercial próprio.

COMO VOCÊ ESCREVE:
- Instagram, não e-mail. Frase curta, direto, jeito de gente.
- NO MÁXIMO 2 bolhas, separadas por ||. Cada uma curta.
- UMA pergunta por mensagem. Nunca duas.
- Sem emoji. Sem travessão. Sem "olá, tudo bem?" formal.
- Releia o histórico antes de escrever: NUNCA pergunte de novo o que a pessoa já respondeu, nunca se reapresente.

O CAMINHO DA CONVERSA:
1. Responde o que ela perguntou, curto e útil.
2. Faz UMA pergunta que qualifica (solar: quanto vem a conta de luz por mês; eletroposto: se o ponto comercial é próprio).
3. Assim que ela responder, pede o WhatsApp: "me passa seu whats que o consultor te manda o cálculo certinho".

REGRAS DURAS:
- NUNCA invente preço, valor de kit, potência, prazo de instalação ou payback. Se perguntarem, diga que depende da conta de luz e peça o WhatsApp pra o consultor fazer a conta.
- NUNCA cite horário, dia ou agendamento. Você não tem agenda.
- NUNCA prometa desconto, condição ou financiamento específico.
- Se a pessoa já mandou o telefone, NÃO peça de novo: agradeça, diga que um consultor chama em seguida e encerre.
- Se ela só elogiou ou comentou algo sem intenção, agradeça em uma linha e pare. Não force venda.
- Se perguntarem se você é robô, seja honesta: você é o atendimento automático da Irmãos na Obra e já vai chamar alguém do time.`;

const chaveHist = (senderId: string): string => `ig_ia:${senderId}`;
const chaveTurnos = (senderId: string): string => `ig_ia_turnos:${senderId}:${new Date().toISOString().slice(0, 10)}`;

async function lerHistorico(senderId: string): Promise<Turno[]> {
  const { data } = await supabase.from('system_state').select('value').eq('key', chaveHist(senderId)).maybeSingle();
  if (!data?.value) return [];
  try {
    const t = JSON.parse(String(data.value));
    return Array.isArray(t) ? t.slice(-MAX_HISTORICO) : [];
  } catch { return []; }
}

async function salvarHistorico(senderId: string, turnos: Turno[]): Promise<void> {
  await supabase.from('system_state').upsert(
    { key: chaveHist(senderId), value: JSON.stringify(turnos.slice(-MAX_HISTORICO)), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

/** Conta o turno do dia e diz se ainda cabe. Grava ANTES de chamar o modelo:
 *  contar uma chamada que falhou é melhor que não contar a que saiu. */
async function cabeMaisUmTurno(senderId: string): Promise<boolean> {
  const chave = chaveTurnos(senderId);
  const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
  const usados = Number(data?.value || 0);
  if (usados >= maxTurnosDia()) return false;
  await supabase.from('system_state').upsert(
    { key: chave, value: String(usados + 1), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  return true;
}

export function iaDmLigada(): boolean {
  return (process.env.IG_IA_DM_ON || '').trim() === 'true' && !!process.env.ANTHROPIC_API_KEY;
}

/** Validade de uma conversa aberta. 24h é a janela do próprio Instagram: quem
 *  some por dias e volta digitando ELETROPOSTO quer o link, não a Luma. */
const CONVERSA_VALIDADE_MS = 24 * 3600 * 1000;

/**
 * A Luma está no meio de uma conversa com essa pessoa AGORA?
 *
 * Existe por causa de um sequestro: ela pergunta "quanto vem sua conta de luz?",
 * o lead responde "uns 400, quero saber do solar" — e a palavra "solar" casaria
 * a automação, jogando quem estava a duas respostas de entregar o WhatsApp de
 * volta pro "me segue que eu te mando o link". Conversa viva ganha da
 * palavra-chave: o caminho da IA é o que termina em card no CRM.
 */
export async function conversaAtiva(senderId: string): Promise<boolean> {
  if (!iaDmLigada()) return false;
  try {
    const { data } = await supabase.from('system_state').select('updated_at')
      .eq('key', chaveHist(senderId)).maybeSingle();
    if (!data?.updated_at) return false;
    return (Date.now() - new Date(data.updated_at).getTime()) < CONVERSA_VALIDADE_MS;
  } catch { return false; }
}

async function usernameDe(senderId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('ig_contacts').select('username').eq('ig_user_id', senderId).maybeSingle();
    return data?.username || null;
  } catch { return null; }
}

/**
 * Responde uma DM sem palavra-chave com a Luma.
 *
 * @param jaTemTelefone o texto trouxe um WhatsApp (o chamador já vai depositar
 *        o lead no CRM) — muda o fim da conversa de "me passa o whats" pra
 *        "um consultor te chama".
 * @param enfileirar quem sabe colocar bolha na fila do IG (fica no igEngine,
 *        que é o dono da `ig_queue`).
 * @returns true se a resposta foi enfileirada. false = não respondeu, e o
 *          chamador deve seguir com o comportamento antigo (aviso + menu).
 */
export async function responderComIa(
  senderId: string,
  texto: string,
  jaTemTelefone: boolean,
  enfileirar: (bolhas: string[]) => Promise<void>,
): Promise<boolean> {
  if (!iaDmLigada()) return false;
  if (!texto.trim()) return false;

  // Troll não fala com a Luma. handleMessage não filtra hostil (só o comentário
  // filtrava) — o corte é aqui.
  if (classificarHostil(texto).hostil) return false;

  try {
    if (!await cabeMaisUmTurno(senderId)) {
      logger.error('ig', `teto de turnos de IA batido para ${senderId}`, null);
      return false;
    }

    const historico = await lerHistorico(senderId);
    const nome = await usernameDe(senderId);
    const contexto = [
      nome ? `[a pessoa é @${nome}]` : '',
      jaTemTelefone ? '[ela ACABOU de mandar o telefone — não peça de novo]' : '',
    ].filter(Boolean).join(' ');

    const turnos: Turno[] = [...historico, { role: 'user', content: (contexto ? contexto + '\n' : '') + texto }];

    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: LUMA_IG,
      messages: turnos,
    });

    const bruto = (resp.content[0] as { text?: string })?.text || '';
    if (!bruto.trim()) return false;

    // Teto 2: no IG cada bolha é um item de fila e come o teto de 180/h.
    const bolhas = emBolhas(bruto, { maxBolhas: 2, max: 160 });
    if (!bolhas.length) return false;

    await enfileirar(bolhas);
    await salvarHistorico(senderId, [...turnos, { role: 'assistant', content: bruto }]);
    return true;
  } catch (err) {
    // Crédito zerado, modelo fora do ar, timeout: a DM NÃO fica muda — volta
    // pro caminho de sempre.
    logger.error('ig', 'Luma (IA na DM) falhou, caindo no fluxo sem IA', err);
    return false;
  }
}
