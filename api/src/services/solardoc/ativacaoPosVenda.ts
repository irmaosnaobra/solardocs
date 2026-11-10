// ─────────────────────────────────────────────────────────────────────────────
// PÓS-VENDA DA SOLARDOC: quem comprou tem que se cadastrar e usar (pedido do dono, 04/11/2026).
// Aprovado pelo chefe-antiban com as condições abaixo. A Giovanna cobra, sempre em 1 bolha e sem link.
//
//   1. Boas-vindas do Pix automático (texto aqui, envio em asaas/asaasWebhookService.ts): só na adesão.
//   2a. Pagou e não criou a senha: contas pagas (cartão ou Pix automático) com password_hash nulo.
//       E-mail: reenvio do link, 1 vez por conta, 2 h ou mais depois do Pix automático (30 min no cartão, como era).
//       WhatsApp P3 transacional (robô `ativ_senha`): 2 h ou mais depois do pagamento, das 7h às 21h, 1 por tick.
//         ordem: teto transacional da linha -> claim `ativ_senha_sent:<userId>` por INSERT -> relê "ainda sem senha" -> sendFrio
//         (SEM a flag transacional: respeita a pausa humana). Sem link, 1 bolha.
//   2b. Criou a senha e não fez nenhuma proposta solar em 2 dias (robô `ativ_proposta`, frio P5): janela da Base (9h às 20h,
//       segunda a sábado, fora de feriado), teto frio com `robo`, espaçamento, claim `ativ_proposta_sent:<userId>` por INSERT
//       antes do envio, 1 por tick. Só quem pagou nos últimos 30 dias (o "1º mês"): sem esse limite o 1º tick varreria todo pagante antigo.
//   Contagem de mensagens: as boas-vindas do Pix automático são o EVENTO da compra (saem na adesão, fora desta conta). Depois delas há no
//   máximo 2 proativas por pessoa, a 2a (senha) e a 2b (1ª proposta): cada robô tem 1 claim por userId e para sempre.
//   Opt-out, supressão e mudo cortam. Conta de admin ou de teste (ehContaDeTeste) nunca recebe a 2a nem a 2b.
//   A 2a só sai com pagamento DE VERDADE: venda em `sales` com `card_passed_at` (cartão) ou contrato do Pix automático `ativo`.
//   As vendas `pix:` (Pix por comprovante) e `admin_pix:` (`/pix-liberar`) agora têm linha em `sales` e contam como pagamento aqui.
//   Conta liberada à mão, com plano pago e sem pagamento, não recebe.
//
// Este módulo NÃO liga o confiancaService nem o confiancaWhatsAppService (bloqueados pelo chefe).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendFrio } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha } from '../agents/whatsapp/lineThrottle';
import { carregarMudos, motivosDaSupressao, TOQUES_ATE_DESISTIR } from '../agents/whatsapp/silenciar';
import { horaBRT } from '../agentes5040/relogio';
import { chavesExistentes } from '../agentes5040/cota';
import { novaRodadaPortao, tomarChaveFria, soltarChaveFria } from '../recuperacaoCheckoutPortao';
import { ehContaDeTeste } from './retomadaUsuariosRegras';
import { chavesRecepSentDe } from './recepcaoNovoUsuarioTextos';

import {
  chaveAtivSenha, chaveAtivProposta, nomeParaSaudar, textoSenhaNaoCriada, textoPrimeiraProposta,
} from './ativacaoPosVendaTextos';

export * from './ativacaoPosVendaTextos';

/** Nome estável do robô no CHEFE (CLASSE_POR_ROBO). */
export const ROBO_ATIV_PROPOSTA = 'ativ_proposta';

const HORA_MS = 3600_000;
const DIA_MS = 24 * HORA_MS;

/** Pix automático: o WhatsApp e o e-mail de reenvio esperam 2 h depois do pagamento. */
export const ESPERA_SENHA_MS = 2 * HORA_MS;
/** Cartão: a carência do e-mail de reenvio continua a de sempre (30 min). */
export const ESPERA_EMAIL_CARTAO_MS = 30 * 60_000;
/** Conta paga sem senha há mais que isto sai do alcance (o e-mail vai até 6 dias; o WhatsApp, 7). */
export const IDADE_MAX_EMAIL_MS = 6 * DIA_MS;
export const IDADE_MAX_SENHA_WHATS_MS = 7 * DIA_MS;
/** Proposta: 2 dias ou mais depois do pagamento e só no 1º mês. */
export const ESPERA_PROPOSTA_MS = 2 * DIA_MS;
export const IDADE_MAX_PROPOSTA_MS = 30 * DIA_MS;
/** Janela do WhatsApp transacional da senha: das 7h às 21h (BRT). */
export const HORA_INICIO_SENHA = 7;
export const HORA_FIM_SENHA = 21;
/** Tentativas de claim por tick no 2a (quem calou por pausa humana não segura a fila). */
const TENTATIVAS_POR_TICK = 10;

/** Das 7h às 21h em Brasília, todos os dias. */
export function dentroDaJanelaDaSenha(agora: Date | number): boolean {
  const h = horaBRT(agora);
  return h >= HORA_INICIO_SENHA && h < HORA_FIM_SENHA;
}

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
export const telefoneValido = (v: unknown): string | null => {
  const d = soDigitos(v);
  return d.length >= 10 && d.length <= 13 ? d : null;
};

export const tsMs = (v: unknown): number => {
  if (!v) return 0;
  const s = String(v);
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(' ', 'T') : s.replace(' ', 'T') + 'Z';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

// ── contas pagas sem senha ───────────────────────────────────────────────────

export interface ContaPagaSemSenha {
  id: string;
  email: string;
  nome: string | null;
  whatsapp: string | null;
  plano: string | null;
  reset_token: string;
  /** Instante do pagamento (ms): a criação da conta (que nasce no pagamento) ou, no Pix automático, o último pagamento do contrato. */
  pagoEm: number;
  viaPixAuto: boolean;
  /** Contrato do Pix automático com status 'ativo' (inadimplente não prova pagamento em dia). */
  pixAtivo: boolean;
  optOut: boolean;
  /** Admin, teste ou suporte (ehContaDeTeste). */
  teste: boolean;
}

interface LinhaUsuario {
  id: string; email: string; nome: string | null; whatsapp: string | null; plano: string | null;
  created_at: string | null; reset_token: string | null; reset_token_expires: string | null; whatsapp_opt_out: boolean | null; is_admin: boolean | null;
}
const COLUNAS_USUARIO = 'id, email, nome, whatsapp, plano, created_at, reset_token, reset_token_expires, whatsapp_opt_out, is_admin';

/**
 * Conta com password_hash NULO, `reset_token` vivo e PAGA: plano que não é 'free' (cartão) OU contrato do Pix automático ativo ou inadimplente
 * (a conta do Pix pode estar com plano 'free' enquanto o crédito não fecha, e o filtro antigo `neq('plano','free')` a deixava de fora).
 * Mais velhas primeiro. null = a leitura falhou (quem chama não age).
 */
export async function contasPagasSemSenha(agora: number, idadeMaxMs: number): Promise<ContaPagaSemSenha[] | null> {
  const piso = new Date(agora - idadeMaxMs).toISOString();
  const porId = new Map<string, ContaPagaSemSenha>();

  const aceitar = (u: LinhaUsuario, viaPixAuto: boolean, ultimoPagamento: number, pixAtivo = false): void => {
    if (!u.reset_token || !u.email) return;
    const expira = tsMs(u.reset_token_expires);
    if (expira && expira <= agora) return;                       // link vencido: reenviar não adianta
    const pagoEm = Math.max(tsMs(u.created_at), ultimoPagamento);
    if (!pagoEm || pagoEm < agora - idadeMaxMs) return;
    const antes = porId.get(u.id);
    if (antes && antes.pagoEm >= pagoEm) return;
    porId.set(u.id, {
      id: u.id, email: u.email, nome: u.nome, whatsapp: u.whatsapp, plano: u.plano, reset_token: u.reset_token,
      pagoEm, viaPixAuto: viaPixAuto || !!antes?.viaPixAuto, pixAtivo: pixAtivo || !!antes?.pixAtivo, optOut: u.whatsapp_opt_out === true,
      teste: ehContaDeTeste({ is_admin: u.is_admin, email: u.email, nome: u.nome }),
    });
  };

  // 1) Plano pago (cartão e Pix já creditado).
  const { data: pagos, error: e1 } = await supabase.from('users').select(COLUNAS_USUARIO)
    .is('password_hash', null).neq('plano', 'free').not('reset_token', 'is', null).gte('created_at', piso)
    .order('created_at', { ascending: true }).limit(500);
  if (e1) { logger.error('ativacao-pos-venda', 'leitura das contas pagas falhou', e1); return null; }
  for (const u of (pagos ?? []) as LinhaUsuario[]) aceitar(u, false, 0);

  // 2) Contrato do Pix automático vivo, mesmo com o plano ainda 'free'.
  const { data: contratos, error: e2 } = await supabase.from('asaas_pix_assinaturas')
    .select('user_id, email, status, ultimo_pagamento_em')
    .in('status', ['ativo', 'inadimplente']).not('ultimo_pagamento_em', 'is', null).gte('ultimo_pagamento_em', piso).limit(500);
  if (e2) { logger.error('ativacao-pos-venda', 'leitura dos contratos do Pix automático falhou', e2); return null; }
  const pagamentoPorId = new Map<string, number>();
  const pagamentoPorEmail = new Map<string, number>();
  const ativoPorId = new Set<string>();
  const ativoPorEmail = new Set<string>();
  for (const c of (contratos ?? []) as Array<{ user_id: string | null; email: string | null; status: string | null; ultimo_pagamento_em: string | null }>) {
    const t = tsMs(c.ultimo_pagamento_em);
    if (c.status === 'ativo') { if (c.user_id) ativoPorId.add(c.user_id); else if (c.email) ativoPorEmail.add(c.email.toLowerCase().trim()); }
    if (c.user_id) pagamentoPorId.set(c.user_id, Math.max(pagamentoPorId.get(c.user_id) ?? 0, t));
    else if (c.email) pagamentoPorEmail.set(c.email.toLowerCase().trim(), Math.max(pagamentoPorEmail.get(c.email.toLowerCase().trim()) ?? 0, t));
  }
  if (pagamentoPorId.size) {
    const { data, error } = await supabase.from('users').select(COLUNAS_USUARIO)
      .in('id', [...pagamentoPorId.keys()]).is('password_hash', null).not('reset_token', 'is', null).limit(500);
    if (error) { logger.error('ativacao-pos-venda', 'leitura das contas do Pix automático falhou', error); return null; }
    for (const u of (data ?? []) as LinhaUsuario[]) aceitar(u, true, pagamentoPorId.get(u.id) ?? 0, ativoPorId.has(u.id));
  }
  if (pagamentoPorEmail.size) {
    const { data, error } = await supabase.from('users').select(COLUNAS_USUARIO)
      .in('email', [...pagamentoPorEmail.keys()]).is('password_hash', null).not('reset_token', 'is', null).limit(500);
    if (error) { logger.error('ativacao-pos-venda', 'leitura das contas do Pix automático (por e-mail) falhou', error); return null; }
    for (const u of (data ?? []) as LinhaUsuario[]) aceitar(u, true, pagamentoPorEmail.get(u.email.toLowerCase().trim()) ?? 0, ativoPorEmail.has(u.email.toLowerCase().trim()));
  }
  return [...porId.values()].sort((a, b) => a.pagoEm - b.pagoEm);
}

// ── sessão da Giovanna ───────────────────────────────────────────────────────

/** Deixa a mensagem na sessão da Giovanna: quando a pessoa responder, ela sabe o que foi dito. Nunca derruba o envio. */
export async function registrarNaSessaoDaGiovanna(userId: string, telefone: string, texto: string, nome: string | null): Promise<void> {
  try {
    const { registrarMsgProativa } = await import('../agents/whatsapp/whatsappAgentService');
    await registrarMsgProativa({ userId, phone: telefone, content: texto, nome });
  } catch (err) {
    logger.error('ativacao-pos-venda', 'não registrei a mensagem na sessão da Giovanna (ela já saiu)', err);
  }
}

export interface ResultadoTick { enviados: number; pulados: number; erros: number; motivo?: string }

// ── 2a · pagou e não criou a senha (WhatsApp, transacional P3) ───────────────

/** E-mails (minúsculos) que têm venda em `sales` com o cartão aprovado (`card_passed_at`). Erro de leitura LANÇA. */
async function emailsComVendaPaga(emails: string[]): Promise<Set<string>> {
  const achados = new Set<string>();
  const lista = [...new Set(emails.map(e => e.toLowerCase().trim()).filter(Boolean))];
  for (let i = 0; i < lista.length; i += 100) {
    const { data, error } = await supabase.from('sales').select('email').not('card_passed_at', 'is', null).in('email', lista.slice(i, i + 100));
    if (error) throw new Error('leitura das vendas falhou');
    for (const v of (data ?? []) as Array<{ email: string | null }>) if (v.email) achados.add(v.email.toLowerCase().trim());
  }
  return achados;
}

export async function enviarSenhaNaoCriada(agoraDate: Date = new Date()): Promise<ResultadoTick> {
  const r: ResultadoTick = { enviados: 0, pulados: 0, erros: 0 };
  const agora = agoraDate.getTime();
  if (!dentroDaJanelaDaSenha(agora)) return { ...r, motivo: 'fora_da_janela' };

  const contas = await contasPagasSemSenha(agora, IDADE_MAX_SENHA_WHATS_MS);
  if (!contas) return { ...r, erros: 1, motivo: 'leitura_falhou' };

  const candidatas = contas.filter(c => !c.optOut && !c.teste && !!telefoneValido(c.whatsapp) && agora - c.pagoEm >= ESPERA_SENHA_MS);
  if (!candidatas.length) return { ...r, pulados: contas.length };

  // "Seu pagamento caiu" só com pagamento de verdade: contrato do Pix automático 'ativo' ou venda em `sales` com o cartão aprovado.
  // Conta liberada à mão (plano pago, sem pagamento) não recebe.
  let comVenda: Set<string>;
  try { comVenda = await emailsComVendaPaga(candidatas.filter(c => !c.pixAtivo).map(c => c.email)); }
  catch { return { ...r, erros: 1, motivo: 'leitura_falhou' }; }
  const prontas = candidatas.filter(c => c.pixAtivo || comVenda.has(c.email.toLowerCase().trim()));
  if (!prontas.length) return { ...r, pulados: contas.length };

  let jaTomadas: Set<string>;
  try { jaTomadas = await chavesExistentes(prontas.map(c => chaveAtivSenha(c.id))); }
  catch { return { ...r, erros: 1, motivo: 'leitura_falhou' }; }

  let mudos: ((tel: string) => boolean) | null = null;
  let tentativas = 0;
  for (const c of prontas) {
    if (jaTomadas.has(chaveAtivSenha(c.id))) { r.pulados++; continue; }
    if (tentativas >= TENTATIVAS_POR_TICK) break;
    const tel = telefoneValido(c.whatsapp)!;

    // Supressão (opt-out, denúncia...) e mudo: erro de leitura segura o tick (na dúvida, não fala).
    try {
      if ((await motivosDaSupressao(tel)).length) { r.pulados++; continue; }
      if (!mudos) mudos = await carregarMudos(Math.min(3, TOQUES_ATE_DESISTIR), 60, { estrito: true });
      if (mudos(tel)) { r.pulados++; continue; }
    } catch { return { ...r, erros: r.erros + 1, motivo: 'leitura_falhou' }; }

    // O teto da linha ANTES do claim (o /master tem 2 relógios e o claim vale para sempre).
    if (!(await dentroDoTetoHorarioLinha({ transacional: true }))) return { ...r, motivo: 'teto' };

    tentativas++;
    const chave = chaveAtivSenha(c.id);
    const claim = await tomarChaveFria(chave, agoraDate);
    if (claim === 'ja') { r.pulados++; continue; }
    if (claim === 'erro') return { ...r, erros: r.erros + 1, motivo: 'claim_falhou' };

    try {
      // Relê "ainda sem senha" logo antes de enviar: quem criou a senha no meio do tick não recebe.
      const { data: atual, error } = await supabase.from('users').select('password_hash').eq('id', c.id).maybeSingle();
      if (error) { await soltarChaveFria(chave); return { ...r, erros: r.erros + 1, motivo: 'leitura_falhou' }; }
      if (!atual || (atual as { password_hash?: string | null }).password_hash) {
        await soltarChaveFria(chave);
        r.pulados++;
        continue;
      }
      const texto = textoSenhaNaoCriada(c.nome, c.email);
      // sendFrio SEM `transacional`: a pausa humana vale (alguém da equipe falando com ela).
      const saiu = await sendFrio(tel, [texto], 'solardoc');
      if (!saiu) { await soltarChaveFria(chave); r.pulados++; continue; }
      r.enviados++;
      await registrarNaSessaoDaGiovanna(c.id, tel, texto, nomeParaSaudar(c.nome));
      break;                                                     // 1 por tick
    } catch (err) {
      // Erro de envio: talvez saiu. O claim FICA (não repete) e o tick para.
      r.erros++;
      logger.error('ativacao-pos-venda', `envio da cobrança de senha falhou (${c.id})`, err);
      break;
    }
  }
  return r;
}

// ── 2b · criou a senha e não fez a 1ª proposta (WhatsApp, frio P5) ───────────

interface VendaPaga { email: string | null; card_passed_at: string | null }
interface UsuarioPagante { id: string; email: string; nome: string | null; whatsapp: string | null; whatsapp_opt_out: boolean | null; is_admin: boolean | null }

export async function fezProposta(userIds: string[]): Promise<Set<string> | null> {
  const fez = new Set<string>();
  for (let i = 0; i < userIds.length; i += 100) {
    const { data, error } = await supabase.from('documents').select('user_id').eq('tipo', 'propostaSolar').in('user_id', userIds.slice(i, i + 100));
    if (error) return null;
    for (const d of (data ?? []) as Array<{ user_id: string | null }>) if (d.user_id) fez.add(d.user_id);
  }
  return fez;
}

export async function enviarPrimeiraProposta(agoraDate: Date = new Date()): Promise<ResultadoTick> {
  const r: ResultadoTick = { enviados: 0, pulados: 0, erros: 0 };
  const agora = agoraDate.getTime();

  // Quem pagou entre 30 e 2 dias atrás (cartão e Pix automático gravam `sales.card_passed_at` no pagamento).
  const { data: vendas, error: e1 } = await supabase.from('sales').select('email, card_passed_at')
    .not('card_passed_at', 'is', null)
    .gte('card_passed_at', new Date(agora - IDADE_MAX_PROPOSTA_MS).toISOString())
    .lte('card_passed_at', new Date(agora - ESPERA_PROPOSTA_MS).toISOString())
    .order('card_passed_at', { ascending: true }).limit(300);
  if (e1) { logger.error('ativacao-pos-venda', 'leitura das vendas falhou', e1); return { ...r, erros: 1, motivo: 'leitura_falhou' }; }
  const ordemPorEmail = new Map<string, number>();
  for (const v of (vendas ?? []) as VendaPaga[]) {
    const e = String(v.email ?? '').toLowerCase().trim();
    if (e && !ordemPorEmail.has(e)) ordemPorEmail.set(e, ordemPorEmail.size);
  }
  if (!ordemPorEmail.size) return { ...r, motivo: 'sem_candidatos' };

  const { data: us, error: e2 } = await supabase.from('users').select('id, email, nome, whatsapp, whatsapp_opt_out, is_admin')
    .in('email', [...ordemPorEmail.keys()]).not('password_hash', 'is', null).neq('plano', 'free').not('whatsapp', 'is', null).limit(300);
  if (e2) { logger.error('ativacao-pos-venda', 'leitura dos pagantes falhou', e2); return { ...r, erros: 1, motivo: 'leitura_falhou' }; }
  const pagantes = ((us ?? []) as UsuarioPagante[])
    .filter(u => !u.whatsapp_opt_out && !ehContaDeTeste(u) && !!telefoneValido(u.whatsapp))
    .sort((a, b) => (ordemPorEmail.get(a.email.toLowerCase().trim()) ?? 0) - (ordemPorEmail.get(b.email.toLowerCase().trim()) ?? 0));
  if (!pagantes.length) return { ...r, motivo: 'sem_candidatos' };

  const fizeram = await fezProposta(pagantes.map(u => u.id));
  if (!fizeram) return { ...r, erros: 1, motivo: 'leitura_falhou' };
  let jaTomadas: Set<string>;
  // Quem já levou um lembrete da recepção de usuários novos (`recep_sent:<id>:r1|r2|r3`, chaves exatas) não leva este convite: a mesma pessoa
  // não recebe dois robôs falando da 1ª proposta no mesmo mês.
  let daRecepcao: Set<string>;
  try {
    jaTomadas = await chavesExistentes(pagantes.map(u => chaveAtivProposta(u.id)));
    daRecepcao = await chavesExistentes(pagantes.flatMap(u => chavesRecepSentDe(u.id)));
  }
  catch { return { ...r, erros: 1, motivo: 'leitura_falhou' }; }
  const levouRecepcao = (id: string): boolean => chavesRecepSentDe(id).some(k => daRecepcao.has(k));

  // Portão da linha (janela da Base, linha pausada, supressão, mudo, pausa humana, teto frio com `robo` e espaçamento).
  const portao = novaRodadaPortao(() => new Date(agora), { robo: ROBO_ATIV_PROPOSTA });
  for (const u of pagantes) {
    if (fizeram.has(u.id) || jaTomadas.has(chaveAtivProposta(u.id)) || levouRecepcao(u.id)) { r.pulados++; continue; }
    const tel = telefoneValido(u.whatsapp)!;
    const v = await portao.avaliar(tel);
    if (!v.ok) { r.pulados++; if (!r.motivo) r.motivo = v.motivo; continue; }

    const chave = chaveAtivProposta(u.id);
    const claim = await tomarChaveFria(chave, agoraDate);
    if (claim === 'ja') { r.pulados++; continue; }
    if (claim === 'erro') return { ...r, erros: r.erros + 1, motivo: 'claim_falhou' };

    try {
      // Relê: quem fez a proposta no meio do tick não recebe.
      const agoraFez = await fezProposta([u.id]);
      if (!agoraFez || agoraFez.has(u.id)) { await soltarChaveFria(chave); r.pulados++; continue; }
      const texto = textoPrimeiraProposta(u.nome);
      const saiu = await sendFrio(tel, [texto], 'solardoc');
      if (!saiu) { await soltarChaveFria(chave); r.pulados++; continue; }
      portao.travarRodada('ja_enviou_na_rodada');
      r.enviados++;
      await registrarNaSessaoDaGiovanna(u.id, tel, texto, nomeParaSaudar(u.nome));
      break;                                                     // 1 por tick
    } catch (err) {
      r.erros++;
      logger.error('ativacao-pos-venda', `envio do convite da 1ª proposta falhou (${u.id})`, err);
      break;
    }
  }
  return r;
}

/** Um tick do pós-venda: a cobrança da senha e o convite da 1ª proposta, no máximo 1 envio de cada. Nunca lança. */
export async function rodarAtivacaoPosVenda(agora: Date = new Date()): Promise<{ senha: ResultadoTick; proposta: ResultadoTick }> {
  // Kill-switch sem deploy: ATIVACAO_POS_VENDA_OFF=1 desliga as duas cobranças (o e-mail de reenvio e as boas-vindas seguem).
  if (process.env.ATIVACAO_POS_VENDA_OFF === '1') {
    const off: ResultadoTick = { enviados: 0, pulados: 0, erros: 0, motivo: 'desligado' };
    return { senha: off, proposta: off };
  }
  const falha: ResultadoTick = { enviados: 0, pulados: 0, erros: 1, motivo: 'excecao' };
  let senha = falha, proposta = falha;
  try { senha = await enviarSenhaNaoCriada(agora); } catch (err) { logger.error('ativacao-pos-venda', 'cobrança da senha caiu', err); }
  try { proposta = await enviarPrimeiraProposta(agora); } catch (err) { logger.error('ativacao-pos-venda', 'convite da 1ª proposta caiu', err); }
  return { senha, proposta };
}
