// ─────────────────────────────────────────────────────────────────────────────
// PAUSA HUMANA — entrou gente na conversa, o robô cala.
//
// O problema, medido em 23/09/2026 na linha IO, janela de 3 dias:
//   104 contatos em que um humano digitou pelo celular
//    31 deles (29,8%) receberam mensagem do robô DEPOIS
//   165 mensagens do robô por cima de conversa humana, ~55/dia
// O cliente está falando com a Giovanna, o robô entra por cima, o cliente
// estressa e some. É a queixa do Thiago, e o número bate com ela.
//
// ── Por que nenhum takeover pegava isso ──
// Quando o humano digita pelo CELULAR, a Z-API não manda telefone. Manda LID:
//
//   humano digitou →  phone: "253068247589084@lid"          (14-15 dígitos)
//   robô enviou    →  phone: "5534991360172" + chatLid: "253068247589084@lid"
//   lead escreveu  →  phone: "5534991360172" + chatLid: "253068247589084@lid"
//
// Os detectores que existiam (`/io-sent` no webhook.ts, `processIoTakeoverEvents`
// no sdrIoPolling.ts) fazem `phone.replace(/\D/g,'')` e `.eq('phone', ...)`.
// Contra um LID isso não casa NUNCA, e não dá erro: dá silêncio do lado errado,
// a mesma classe de bug que o silenciar.ts documenta pro 9º dígito. Ligar o cron
// que está comentado não teria produzido um takeover sequer.
//
// A saída: quem traz o telefone real traz o chatLid JUNTO. O mapa LID→telefone
// sai dessas linhas. Medido: 143 de 145 LIDs resolvidos (98,6%), zero ambíguo,
// com 85h de antecedência média. Os 8 que faltam viram fila de pendentes em vez
// de sumir calados (6 deles ficam resolvíveis depois).
//
// ── Por que o gate é OPT-IN, e não automático dentro do sendHuman ──
// `sendWhatsApp(num, aviso, 'io')` manda pro CONSULTOR e `sendHuman(tel, ...)`
// manda pro LEAD pelas MESMAS funções. Um gate ligado por padrão lá dentro
// obrigaria a achar e isentar todo ponto que fala com a equipe (sentinelaVacuo,
// placarGiovanna, entradaIoDigest, solarRespostas, eletropostoRespostas,
// recepcaoIo, alerta10min, cardPing...). Esquecer UM cala o aviso do consultor,
// e a equipe fica cega sem ninguém perceber. Esquecer um ponto lead-bound aqui
// só mantém o bug de hoje, que é visível. Falha visível ganha de falha calada.
//
// ── Por que tabela própria, e não whatsapp_suppression ──
// Parece o mesmo slot e não é. Supressão é opt-out PERMANENTE ("não me manda
// mais nada"). Pausa é TEMPORÁRIA. Uma resposta da Giovanna gravada como
// supressão calaria aquele contato pra sempre, em todas as trilhas.
//
// ── A pausa é por TELEFONE, logo vale pra todo produto ──
// Humano respondendo sobre eletroposto também cala o follow-up de solar pro
// mesmo número. É de propósito: o cliente enxerga UMA linha, não quatro
// produtos. Se um dia isso incomodar, o campo `linha` já está na tabela.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { chaveContato } from './silenciar';

const LOG = 'pausa-humana';

/**
 * Silêncio a partir do qual a conversa esfria e o robô pode voltar.
 *
 * 24h porque é uma linha de venda: se ninguém falou nada por um dia inteiro,
 * o follow-up volta a ser útil em vez de atropelo. Só conta como esfriada
 * quando NEM o humano NEM o lead falaram — lead escrevendo e ninguém
 * respondendo é problema da sentinela do vácuo, não convite pro robô entrar.
 */
// Lido a cada chamada, nunca no arranque: instância quente na Vercel não
// recarrega módulo, e afrouxar ou apertar esta janela não pode exigir deploy.
const janelaSilencioH = (): number => Number(process.env.PAUSA_HUMANA_JANELA_H || 24);

/** Kill-switch. Sem deploy: liga PAUSA_HUMANA_OFF=1 e o gate solta tudo. */
export function desligado(): boolean {
  return process.env.PAUSA_HUMANA_OFF === '1';
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura: quem está pausado agora
// ─────────────────────────────────────────────────────────────────────────────

export interface Pausa {
  chave: string;
  telefone: string;
  quem: string | null;
  ultimaFalaHumano: string;
  ultimaFalaLead: string | null;
}

export type Decisao =
  | { pode: true;  motivo: 'desligado' | 'sem-pausa' | 'esfriou' | 'transacional' | 'chave-invalida' }
  | { pode: false; motivo: 'humano-ativo'; desde: string; quem: string | null };

export interface OpcoesGate {
  /**
   * Confirmação/lembrete de algo que o PRÓPRIO lead marcou (reunião que ele
   * agendou, por exemplo). Passa mesmo com humano ativo: o sinal de contato é o
   * compromisso que ele próprio criou, e segurar isso faz a pessoa perder a
   * hora. Mesma fronteira que o silenciar.ts já desenha pro toque frio.
   *
   * NÃO use pra follow-up, repescagem, blast ou convite. Se a pessoa não marcou,
   * não é transacional.
   */
  transacional?: boolean;
}

/** Esfriada = nem humano nem lead falam há `janelaSilencioH()` horas. */
function esfriou(p: Pausa, agora: number): boolean {
  const ultimo = Math.max(
    Date.parse(p.ultimaFalaHumano) || 0,
    p.ultimaFalaLead ? (Date.parse(p.ultimaFalaLead) || 0) : 0,
  );
  if (!ultimo) return false;
  return agora - ultimo > janelaSilencioH() * 3600_000;
}

/**
 * Carrega o mapa de pausas ativas e devolve o predicado do gate.
 *
 * Devolve FUNÇÃO porque quem chama está num laço de disparo e não pode fazer um
 * select por contato.
 *
 * Fail-open com log, igual ao carregarSilenciados: se o banco piscar, ninguém é
 * barrado. Um atropelo a mais é ruim; a linha inteira emudecer porque o Supabase
 * tossiu é pior, e sem o log viraria mistério.
 */
export async function carregarPausas(): Promise<(phone: string, opts?: OpcoesGate) => Decisao> {
  if (desligado()) {
    return () => ({ pode: true, motivo: 'desligado' });
  }

  const porChave = new Map<string, Pausa>();
  try {
    const { data, error } = await supabase
      .from('atendimento_pausa')
      .select('chave, telefone, quem, ultima_fala_humano, ultima_fala_lead')
      .is('liberado_em', null);
    if (error) throw error;
    for (const r of (data ?? []) as Array<Record<string, string | null>>) {
      const chave = r.chave;
      if (!chave) continue;
      porChave.set(chave, {
        chave,
        telefone: r.telefone ?? '',
        quem: r.quem ?? null,
        ultimaFalaHumano: r.ultima_fala_humano ?? '',
        ultimaFalaLead: r.ultima_fala_lead ?? null,
      });
    }
    logger.info(LOG, `${porChave.size} conversas com humano dentro`);
  } catch (err) {
    logger.error(LOG, 'leitura das pausas falhou: ninguém será barrado nesta rodada', err);
  }

  const agora = Date.now();
  return (phone: string, opts?: OpcoesGate): Decisao => {
    // NUNCA lança. Um gate que estoura é engolido pelo catch de quem chama, e o
    // lead fica sem resposta nenhuma — o mesmo "silêncio do lado errado" que
    // este módulo existe pra matar, só que virado contra o cliente.
    try {
      const k = chaveContato(phone);
      if (!k) return { pode: true, motivo: 'chave-invalida' };
      const p = porChave.get(k);
      if (!p) return { pode: true, motivo: 'sem-pausa' };
      if (opts?.transacional) return { pode: true, motivo: 'transacional' };
      if (esfriou(p, agora)) return { pode: true, motivo: 'esfriou' };
      return { pode: false, motivo: 'humano-ativo', desde: p.ultimaFalaHumano, quem: p.quem };
    } catch {
      return { pode: true, motivo: 'sem-pausa' };
    }
  };
}

/**
 * Checagem de UM contato. Pra quem manda uma mensagem só e não está em laço.
 * Fail-open pelo mesmo motivo do carregarPausas.
 */
export async function podeFalarComLead(phone: string, opts?: OpcoesGate): Promise<Decisao> {
  if (desligado()) return { pode: true, motivo: 'desligado' };
  try {
    // O `chaveContato` fica DENTRO do try. Estava fora, e isso derrubou 6 testes
    // da recepção: o módulo lançava, o catch do chamador engolia e a Duda não
    // respondia o lead. Em produção seria o mesmo, sem teste pra avisar.
    const k = chaveContato(phone);
    if (!k) return { pode: true, motivo: 'chave-invalida' };
    const { data, error } = await supabase
      .from('atendimento_pausa')
      .select('chave, telefone, quem, ultima_fala_humano, ultima_fala_lead')
      .eq('chave', k)
      .is('liberado_em', null)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { pode: true, motivo: 'sem-pausa' };
    if (opts?.transacional) return { pode: true, motivo: 'transacional' };
    const p: Pausa = {
      chave: k,
      telefone: (data as any).telefone ?? '',
      quem: (data as any).quem ?? null,
      ultimaFalaHumano: (data as any).ultima_fala_humano ?? '',
      ultimaFalaLead: (data as any).ultima_fala_lead ?? null,
    };
    if (esfriou(p, Date.now())) return { pode: true, motivo: 'esfriou' };
    return { pode: false, motivo: 'humano-ativo', desde: p.ultimaFalaHumano, quem: p.quem };
  } catch (err) {
    logger.error(LOG, `checagem de ${phone} falhou: deixando passar`, err);
    return { pode: true, motivo: 'sem-pausa' };
  }
}

/**
 * Conta que o gate barrou um envio. É o placar que prova que a trava está
 * trabalhando — sem ele, "nenhum atropelo" e "a trava nunca rodou" ficam
 * iguais na hora de conferir. Nunca derruba quem chamou.
 */
export async function registrarBloqueio(phone: string, origem: string): Promise<void> {
  const k = chaveContato(phone);
  if (!k) return;
  try {
    await supabase.rpc('pausa_contar_bloqueio', { p_chave: k });
    logger.info(LOG, `envio barrado para ${k} (${origem})`);
  } catch {
    // RPC pode não existir em ambiente antigo — o log acima é o que importa.
    logger.info(LOG, `envio barrado para ${k} (${origem})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrita: marcar e liberar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca que um humano entrou na conversa. Idempotente.
 *
 * `ultima_fala_humano` só anda pra FRENTE: um webhook reentregue com carimbo
 * velho não pode encurtar a pausa de quem acabou de falar.
 */
export async function pausarContato(
  phone: string,
  quando: string,
  opts?: { origem?: string; quem?: string | null; linha?: string },
): Promise<boolean> {
  const telefone = String(phone ?? '').replace(/\D/g, '');
  const k = chaveContato(telefone);
  if (!k) return false;
  try {
    const { data: atual } = await supabase
      .from('atendimento_pausa')
      .select('ultima_fala_humano')
      .eq('chave', k)
      .maybeSingle();

    const anterior = atual ? Date.parse((atual as any).ultima_fala_humano || '') || 0 : 0;
    const novo = Date.parse(quando) || Date.now();
    if (anterior && novo <= anterior) return false;   // nada novo, não reescreve

    await supabase.from('atendimento_pausa').upsert({
      chave: k,
      telefone,
      linha: opts?.linha ?? 'io',
      origem: opts?.origem ?? 'celular',
      quem: opts?.quem ?? null,
      ultima_fala_humano: new Date(novo).toISOString(),
      // Reentrada depois de liberada volta a valer: humano falou de novo.
      liberado_em: null,
      liberado_por: null,
      motivo_liberacao: null,
      atualizado_em: new Date().toISOString(),
      ...(anterior ? {} : { pausado_em: new Date(novo).toISOString() }),
    }, { onConflict: 'chave' });
    return true;
  } catch (err) {
    logger.error(LOG, `falhou ao pausar ${telefone}`, err);
    return false;
  }
}

/** Anota que o LEAD falou. Alimenta a régua de esfriamento. */
export async function registrarFalaDoLead(phone: string, quando: string): Promise<void> {
  const telefone = String(phone ?? '').replace(/\D/g, '');
  const k = chaveContato(telefone);
  if (!k) return;
  try {
    const { data } = await supabase
      .from('atendimento_pausa')
      .select('ultima_fala_lead')
      .eq('chave', k)
      .is('liberado_em', null)
      .maybeSingle();
    if (!data) return;                       // só interessa em conversa pausada
    const anterior = Date.parse((data as any).ultima_fala_lead || '') || 0;
    const novo = Date.parse(quando) || Date.now();
    if (anterior && novo <= anterior) return;
    await supabase.from('atendimento_pausa').update({
      ultima_fala_lead: new Date(novo).toISOString(),
      atualizado_em: new Date().toISOString(),
    }).eq('chave', k);
  } catch (err) {
    logger.error(LOG, `falhou ao anotar fala do lead ${telefone}`, err);
  }
}

/**
 * Devolve a conversa pro robô. É o caminho EXPLÍCITO: o humano terminou e diz
 * que terminou (botão no CRM, comando no grupo).
 */
export async function liberarPausa(
  phone: string,
  por: string,
  motivo = 'liberado manualmente',
): Promise<boolean> {
  const k = chaveContato(phone);
  if (!k) return false;
  try {
    const { error } = await supabase.from('atendimento_pausa').update({
      liberado_em: new Date().toISOString(),
      liberado_por: por,
      motivo_liberacao: motivo,
      atualizado_em: new Date().toISOString(),
    }).eq('chave', k).is('liberado_em', null);
    if (error) throw error;
    logger.info(LOG, `${k} devolvido ao robô por ${por}`);
    return true;
  } catch (err) {
    logger.error(LOG, `falhou ao liberar ${phone}`, err);
    return false;
  }
}
