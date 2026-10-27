// ─────────────────────────────────────────────────────────────────────────────
// FILA DE LIGAÇÃO DO QUIZ DO SOLARDOC (27/10/2026).
//
// Quem terminou o quiz e saiu sem comprar entra numa fila de ligação da Giovanna, com ou sem CNPJ. NÃO sai mensagem nenhuma por aqui
// (nem pela 5040): este módulo só guarda o REGISTRO do que a pessoa do time fez e calcula quando é a próxima vez.
//
// O registro mora em `system_state` (banco PRINCIPAL), na chave `quiz_followup:<hmac do telefone>` (o MESMO hmac das chaves
// `quiz_aviso:` e `quiz_rec_sent:`; outros códigos varrem esses dois prefixos, por isso este é só dele). Valor: { v: 1, hist: [{ acao, em, por }] }.
// Os leads moram em `leads_meta` no banco do GERADOR. Os dois clientes têm o mesmo método `.from()` e nenhum tipo pega a troca:
// o teste de estrutura lê este arquivo.
//
// Cadência (dias, em BRT = UTC-3 fixo; domingo vai para a segunda):
//   lead novo: no dia em que chegou (e só depois de 15 min, para a desistência/compra se resolverem antes);
//   não atendeu 1x: +1 dia; 2x: +2 dias; 3x seguidas sem falar: 'sem_resposta' (fecha);
//   falou: 'em_conversa', volta em +2 dias; 'sem_interesse' fecha; compra fecha sempre.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { hmacDe } from '../agentes5040/hmac';
import { diaBRT } from '../agentes5040/relogio';
import { chaveDoTelefone, normalizarTelefoneSd } from './quizSolardoc';

export const PREFIXO_FOLLOWUP = 'quiz_followup:';
/** O mesmo form_id de statusLeadsQuiz.FORM_ID_QUIZ_SD (o teste confere; importar de lá faria um ciclo). */
export const FORM_ID_FOLLOWUP = 'quiz_solardoc';
export const MAX_HIST = 30;
export const ESPERA_MIN_LEAD_MS = 15 * 60_000;
const DIA_MS = 86_400_000;

export const ACOES_FOLLOWUP = ['falou', 'nao_atendeu', 'sem_interesse'] as const;
export type AcaoFollowup = (typeof ACOES_FOLLOWUP)[number];
export type AcaoPedida = AcaoFollowup | 'desfazer';
export interface EntradaFollowup { acao: AcaoFollowup; em: string; por: string }
export type EstadoFollowup = 'novo' | 'nao_atendeu' | 'em_conversa' | 'sem_interesse' | 'sem_resposta' | 'comprou';
export interface FollowupDoLead {
  estado: EstadoFollowup;
  /** Quantos 'nao_atendeu' desde o último 'falou' (todos, se nunca falou). */
  tentativas: number;
  /** 'AAAA-MM-DD' (BRT) do próximo contato; null quando fechado. */
  proximo: string | null;
  devido: boolean;
  aberto: boolean;
  ultima: EntradaFollowup | null;
}

/** Erro com motivo que a rota sabe traduzir em status. */
export class FollowupErro extends Error {
  constructor(public codigo: 'acao_invalida' | 'historico_vazio' | 'nao_encontrado' | 'sem_telefone', mensagem: string) {
    super(mensagem);
  }
}

// ── puro ─────────────────────────────────────────────────────────────────────

const ehAcao = (v: unknown): v is AcaoFollowup => typeof v === 'string' && (ACOES_FOLLOWUP as readonly string[]).includes(v);
const paraMs = (v: string | number | Date | null | undefined): number => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v ?? '')));

/** Data 'AAAA-MM-DD' no horário de Brasília (UTC-3 fixo) de um instante em ms (o relógio do projeto, agentes5040/relogio). */
export function dataBRT(ms: number): string {
  return diaBRT(ms);
}

/** Soma dias a uma data 'AAAA-MM-DD'; se cair no domingo, vai para a segunda. */
function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number) as [number, number, number];
  let t = Date.UTC(a, m - 1, d) + dias * DIA_MS;
  if (new Date(t).getUTCDay() === 0) t += DIA_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** Lê o `hist` de um valor de `system_state`, descartando o que não for entrada válida. */
export function histDoValor(valor: unknown): EntradaFollowup[] {
  const lista = valor && typeof valor === 'object' ? (valor as { hist?: unknown }).hist : null;
  if (!Array.isArray(lista)) return [];
  return lista.flatMap((e): EntradaFollowup[] => {
    const x = e as Partial<EntradaFollowup> | null;
    if (!x || !ehAcao(x.acao) || !Number.isFinite(Date.parse(String(x.em ?? '')))) return [];
    return [{ acao: x.acao, em: String(x.em), por: typeof x.por === 'string' ? x.por : '' }];
  }).slice(-MAX_HIST);
}

export function estadoDoFollowup(a: {
  hist: readonly EntradaFollowup[] | null | undefined; criadoEm: string | number | Date | null | undefined; comprou: boolean; agora: Date;
}): FollowupDoLead {
  const hist = histDoValor({ hist: a.hist });
  const ultima = hist.length ? hist[hist.length - 1]! : null;
  // Conta os 'nao_atendeu' depois do último 'falou' (todos, se nunca falou).
  const aposFalou = hist.slice(hist.map((e) => e.acao).lastIndexOf('falou') + 1);
  const tentativas = aposFalou.filter((e) => e.acao === 'nao_atendeu').length;
  const fechado = (estado: EstadoFollowup): FollowupDoLead => ({ estado, tentativas, proximo: null, devido: false, aberto: false, ultima });
  if (a.comprou) return fechado('comprou');
  if (ultima?.acao === 'sem_interesse') return fechado('sem_interesse');
  if (tentativas >= 3) return fechado('sem_resposta');

  const criadoMs = paraMs(a.criadoEm);
  let estado: EstadoFollowup;
  let proximo: string | null;
  if (!ultima) {
    estado = 'novo';
    proximo = Number.isFinite(criadoMs) ? somarDias(dataBRT(criadoMs), 0) : null;
  } else if (ultima.acao === 'nao_atendeu') {
    estado = 'nao_atendeu';
    proximo = somarDias(dataBRT(Date.parse(ultima.em)), tentativas);   // 1 tentativa: +1 dia; 2: +2 dias
  } else {
    estado = 'em_conversa';
    proximo = somarDias(dataBRT(Date.parse(ultima.em)), 2);
  }
  const agoraMs = a.agora.getTime();
  const devido = proximo !== null && dataBRT(agoraMs) >= proximo && Number.isFinite(criadoMs) && agoraMs >= criadoMs + ESPERA_MIN_LEAD_MS;
  return { estado, tentativas, proximo, devido, aberto: true, ultima };
}

/** Novo histórico depois de uma ação. `desfazer` tira a última entrada (erro se não há). Guarda as últimas 30. Não muda o original. */
export function aplicarAcao(hist: readonly EntradaFollowup[], acao: string, por: string, agora: Date): EntradaFollowup[] {
  const atual = histDoValor({ hist });
  if (acao === 'desfazer') {
    if (!atual.length) throw new FollowupErro('historico_vazio', 'não há nada para desfazer');
    return atual.slice(0, -1);
  }
  if (!ehAcao(acao)) throw new FollowupErro('acao_invalida', 'ação desconhecida');
  const nome = String(por ?? '').trim().slice(0, 60);
  return [...atual, { acao, em: agora.toISOString(), por: nome }].slice(-MAX_HIST);
}

// ── escrita ──────────────────────────────────────────────────────────────────

export interface DepsFollowup {
  /** O lead do quiz pelo lead_id, ou null. Erro LANÇA. */
  lerLead(leadId: string): Promise<{ whatsapp: string | null; created_time: string | null } | null>;
  /** O valor da chave em `system_state`, ou null se não existe. Erro LANÇA. */
  lerValor(chave: string): Promise<unknown>;
  /** Grava (upsert) o valor da chave. Erro LANÇA. */
  gravar(chave: string, valor: unknown, atualizadoEm: string): Promise<void>;
  hmac(whatsapp: string | null): string | null;
  agora(): Date;
}

/** O mesmo HMAC das chaves quiz_aviso: e quiz_rec_sent: (hmacDoLeadRec), ou null sem telefone válido ou sem segredo. */
export function hmacDoWhatsapp(whatsapp: string | null | undefined): string | null {
  const tel = normalizarTelefoneSd(whatsapp);
  return tel ? hmacDe(chaveDoTelefone(tel)) : null;
}

export function depsFollowupReais(): DepsFollowup {
  return {
    async lerLead(leadId) {
      const { data, error } = await supabaseGerador.from('leads_meta')
        .select('whatsapp, created_time').eq('form_id', FORM_ID_FOLLOWUP).eq('lead_id', leadId).maybeSingle();
      if (error) throw new Error(`ler o lead do quiz: ${error.message}`);
      return (data as { whatsapp: string | null; created_time: string | null } | null) ?? null;
    },
    async lerValor(chave) {
      const { data, error } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
      if (error) throw new Error(`ler o registro da ligação: ${error.message}`);
      return (data as { value?: unknown } | null)?.value ?? null;
    },
    async gravar(chave, valor, atualizadoEm) {
      const { error } = await supabase.from('system_state').upsert({ key: chave, value: valor, updated_at: atualizadoEm }, { onConflict: 'key' });
      if (error) throw new Error(`gravar o registro da ligação: ${error.message}`);
    },
    hmac: hmacDoWhatsapp,
    agora: () => new Date(),
  };
}

/**
 * Registra o que o consultor fez na ligação deste lead e devolve o estado novo (com `comprou` falso: quem sabe da compra é o GET).
 * Lead de teste também aceita a ação (a sonda usa). O telefone e o hmac nunca vêm do cliente: saem do lead lido aqui.
 * Duas pessoas gravando o mesmo lead no mesmo segundo: vale a última (ler e regravar; não há trava).
 */
export async function registrarFollowup(leadId: string, acao: string, por: string, deps: DepsFollowup = depsFollowupReais()): Promise<FollowupDoLead> {
  if (acao !== 'desfazer' && !ehAcao(acao)) throw new FollowupErro('acao_invalida', 'ação desconhecida');
  const lead = await deps.lerLead(leadId);
  if (!lead) throw new FollowupErro('nao_encontrado', 'lead não encontrado');
  const h = deps.hmac(lead.whatsapp);
  if (!h) throw new FollowupErro('sem_telefone', 'lead sem telefone válido');
  const chave = `${PREFIXO_FOLLOWUP}${h}`;
  const agora = deps.agora();
  const hist = aplicarAcao(histDoValor(await deps.lerValor(chave)), acao, por, agora);
  await deps.gravar(chave, { v: 1, hist }, agora.toISOString());
  return estadoDoFollowup({ hist, criadoEm: lead.created_time, comprou: false, agora });
}
