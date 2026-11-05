// ─────────────────────────────────────────────────────────────────────────────
// O CÓDIGO NOVO DO PIX AUTOMÁTICO (05/11/2026). Dois usos, as mesmas regras:
//   B. a recuperação (recuperacaoCarla.ts): o código venceu, então antes do texto o robô cria a autorização nova com o CPF e o e-mail do contrato antigo;
//   E. a resposta na conversa (Carla pelo vivo, Giovanna pelo pixRecoveryAgentService): o marcador de Pix automático vira o código da pessoa.
//
// Este arquivo NÃO envia mensagem nenhuma (o envio é sempre do zapiClient, pelos caminhos que já existem). Só cria/lê contrato e decide qual código vai.
// Regras que valem aqui:
//   - todo Pix é o AUTOMÁTICO, com CPF, cobrando na conta da pessoa (`exigirAutomatico: true`); nunca Pix direto nem manual;
//   - estado primeiro, mensagem depois: antes de criar, confere que a pessoa não pagou nenhum contrato do mesmo CPF ou e-mail;
//   - nunca dois QRs vivos: só cria depois do vencimento real (mais a folga); o `criarPixRecorrente` ainda devolve o contrato vivo se achar um;
//   - CPF nunca vai para log.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { crc16 } from '../../utils/pixBrCode';
import { criarPixRecorrente, soDigitos } from '../asaas/pixRecorrenteService';
import { chavePixAutoAtrib, chavePixAutoConv, chavePixAutoExp, type AtribuicaoPixAuto } from '../asaas/pixAutoChaves';
import { FOLGA_VENCIMENTO_MS, ehCodigoPix, pagamentoValeDesde, restanteDoCodigoMs, validadeDoCodigoMs } from '../asaas/pixAutoValidade';
import { PREFIXO_PAGTO, PREFIXO_PAGTO_EMAIL, PREFIXO_PAGTO_EMAIL2 } from './recuperacaoCarlaRegras';
import { hmacDoPagamento } from './marcaPagamentoQuiz';
import { situacaoDaConta, type SituacaoDaConta } from '../../utils/clientePagante';

const LOG = 'pix-auto-codigo';

/** O contrato que deu origem ao código novo: tudo que o `criarPixRecorrente` precisa para repetir o Pix com a mesma pessoa. */
export interface ContratoBase {
  contract_id: string; user_id: string | null; email: string; cpf_cnpj: string; plano: string; cupom: string | null;
  status: string; created_at: string | null; qr_payload: string | null; modo?: string | null;
  ultimo_pagamento_em: string | null; ultimo_pagamento_id: string | null;
  /** A validade real gravada em `pix_auto_exp`; null = contrato antigo. */
  expira_em: string | null;
}

export interface CodigoGerado { contractId: string; qrPayload: string; expiraEm: string }

/**
 * Falha do código novo que NÃO se resolve tentando de novo: 4xx do Asaas (CPF recusado, cliente inválido), `mesmo_contrato`, contrato que já não é pendente. A
 * recuperação conta essas falhas por pessoa e pula na 2ª. 5xx e timeout NÃO são permanentes (adiam a rodada e tentam depois).
 */
export class CodigoNovoPermanente extends Error {
  readonly permanente = true;
  constructor(motivo: string) { super(motivo); this.name = 'CodigoNovoPermanente'; }
}
/** O erro é permanente? (a marca `permanente` atravessa o import dinâmico.) */
export const erroEhPermanente = (e: unknown): boolean => (e as { permanente?: unknown } | null)?.permanente === true;
/** 4xx do Asaas é permanente, menos 408 e 429 (passageiros). */
const status4xxPermanente = (st: number): boolean => st >= 400 && st < 500 && st !== 408 && st !== 429;

const COLUNAS = 'contract_id, user_id, email, cpf_cnpj, plano, cupom, status, created_at, qr_payload, modo, ultimo_pagamento_em, ultimo_pagamento_id';

/** Lê o contrato inteiro (com a validade). null = não existe; lança se a leitura falhar. */
export async function lerContratoBase(contractId: string): Promise<ContratoBase | null> {
  const { data, error } = await supabase.from('asaas_pix_assinaturas').select(COLUNAS).eq('contract_id', contractId).maybeSingle();
  if (error) throw new Error('leitura_do_contrato');
  if (!data) return null;
  const { data: exp, error: eExp } = await supabase.from('system_state').select('value').eq('key', chavePixAutoExp(contractId)).maybeSingle();
  if (eExp) throw new Error('leitura_da_validade');
  const v = (exp as { value?: { expira_em?: unknown } } | null)?.value?.expira_em;
  return { ...(data as Omit<ContratoBase, 'expira_em'>), expira_em: typeof v === 'string' && v ? v : null };
}

export { pagamentoValeDesde };

/** O contrato foi pago, contando desde a criação dele mesmo (sem data de criação legível, qualquer pagamento conta). */
export const contratoFoiPago = (c: Pick<ContratoBase, 'status' | 'ultimo_pagamento_em' | 'ultimo_pagamento_id' | 'created_at'>): boolean =>
  pagamentoValeDesde(c, Date.parse(String(c.created_at ?? '')) || 0);

/**
 * A pessoa pagou ALGUM contrato do mesmo CPF ou e-mail DEPOIS de `desdeIso` (a criação do contrato recuperado)? Consulta própria: o `buscarAssinaturaAtivaSemConta`
 * devolve só a linha mais nova (a pendente morta) e esconderia uma paga mais antiga. Erro LANÇA (quem chama não cria nem envia).
 */
export async function pagouCpfOuEmail(cpf: string, email: string, desdeIso?: string | null): Promise<boolean> {
  const doc = soDigitos(cpf);
  const alvo = String(email ?? '').toLowerCase().trim();
  const filtros: string[] = [];
  if (doc) filtros.push(`cpf_cnpj.eq.${doc}`);
  if (alvo) filtros.push(`email.eq.${alvo}`);
  if (!filtros.length) return false;
  const { data, error } = await supabase.from('asaas_pix_assinaturas')
    .select('status, ultimo_pagamento_em, ultimo_pagamento_id').or(filtros.join(',')).limit(100);
  if (error) throw new Error('leitura_dos_pagamentos');
  const desdeMs = Date.parse(String(desdeIso ?? '')) || 0;
  return ((data ?? []) as Array<Pick<ContratoBase, 'status' | 'ultimo_pagamento_em' | 'ultimo_pagamento_id'>>).some(l => pagamentoValeDesde(l, desdeMs));
}

async function lerAtribuicao(contractId: string): Promise<AtribuicaoPixAuto | null> {
  const { data } = await supabase.from('system_state').select('value').eq('key', chavePixAutoAtrib(contractId)).maybeSingle();
  const v = (data as { value?: unknown } | null)?.value;
  return v && typeof v === 'object' ? (v as AtribuicaoPixAuto) : null;
}

/**
 * Cria a autorização NOVA do Pix automático com o CPF e o e-mail do contrato antigo. LANÇA se não deu para ter um código novo e vivo: o chamador desfaz o claim e
 * a posse, não envia nada e NÃO conta erro de linha. Confere o retorno: o contrato tem que ser OUTRO, pendente, com copia e cola de verdade e validade no futuro.
 */
export async function gerarCodigoNovo(a: { antigo: ContratoBase; nome: string | null; tel: string; agoraMs?: number }): Promise<CodigoGerado> {
  const agoraMs = a.agoraMs ?? Date.now();
  const atrAntiga = await lerAtribuicao(a.antigo.contract_id);
  // `rota: 'publica'` é a trava do webhook (não cancela o cartão de quem só digitou o e-mail de um cliente); `whatsapp` é o telefone que a recuperação lê no contrato.
  const atribuicao: AtribuicaoPixAuto = { ...(atrAntiga ?? {}), rota: atrAntiga?.rota ?? 'publica', whatsapp: atrAntiga?.whatsapp ?? a.tel };
  let criado: Awaited<ReturnType<typeof criarPixRecorrente>>;
  try {
    criado = await criarPixRecorrente({
      userId: a.antigo.user_id, email: a.antigo.email, nome: a.nome ?? '', cpfCnpj: a.antigo.cpf_cnpj, whatsapp: a.tel,
      planKey: a.antigo.plano, cupom: a.antigo.cupom, atribuicao, exigirAutomatico: true,
    });
  } catch (err) {
    const st = Number((err as { asaasStatus?: unknown } | null)?.asaasStatus);
    if (Number.isFinite(st) && status4xxPermanente(st)) throw new CodigoNovoPermanente(`asaas_${st}`);
    throw err;
  }
  if (criado.contractId === a.antigo.contract_id) throw new CodigoNovoPermanente('mesmo_contrato');
  if (criado.status !== 'pendente') throw new CodigoNovoPermanente(`status_${criado.status}`);
  if (!ehCodigoPix(criado.qrPayload)) throw new CodigoNovoPermanente('sem_codigo');
  const exp = Date.parse(String(criado.expiraEm ?? ''));
  if (!Number.isFinite(exp) || exp <= agoraMs) throw new CodigoNovoPermanente('sem_validade');
  return { contractId: criado.contractId, qrPayload: criado.qrPayload, expiraEm: new Date(exp).toISOString() };
}

/**
 * Aponta a marca `quiz_pagto:<hmac>` para o contrato novo SEM mexer em `em` nem em `updated_at` (mexer reabriria a janela de 120 h e a espera de 5 min). Copia para o
 * contrato novo os claims de e-mail do antigo, se existirem (o e-mail é por contrato e não olha o carimbo do WhatsApp). Melhor esforço: devolve false se a marca não mudou.
 */
export async function moverMarcaDePagamento(hmac: string, antigo: string, novo: string): Promise<boolean> {
  try {
    const chave = `${PREFIXO_PAGTO}${hmac}`;
    const { data } = await supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
    const valor = (data as { value?: Record<string, unknown> } | null)?.value;
    if (!valor) return false;
    let moveu = valor.contratoId === novo;
    if (!moveu) {
      const { error } = await supabase.from('system_state').update({ value: { ...valor, contratoId: novo } }).eq('key', chave);
      if (error) { logger.error(LOG, 'a marca do pagamento não apontou para o contrato novo'); return false; }
      moveu = true;
    }
    for (const prefixo of [PREFIXO_PAGTO_EMAIL, PREFIXO_PAGTO_EMAIL2]) {
      try {
        const { data: ant } = await supabase.from('system_state').select('value, updated_at').eq('key', `${prefixo}${antigo}`).maybeSingle();
        if (!ant) continue;
        const a = ant as { value?: unknown; updated_at?: string };
        await supabase.from('system_state').insert({ key: `${prefixo}${novo}`, value: a.value ?? {}, updated_at: a.updated_at ?? new Date().toISOString() });
      } catch { /* 23505 ou falha: o e-mail é só rede de segurança */ }
    }
    return moveu;
  } catch { return false; }
}

// ── CPF e e-mail em texto livre ──────────────────────────────────────────────

/** Dígitos verificadores do CPF (rejeita 11 dígitos iguais). */
export function cpfValido(bruto: string): boolean {
  const d = soDigitos(bruto);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number): number => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** O primeiro CPF VÁLIDO no texto da pessoa (com ou sem pontos), só dígitos. CNPJ e número de telefone não passam. null = não achou. */
export function extrairCpf(texto: string | null | undefined): string | null {
  const t = String(texto ?? '');
  for (const m of t.matchAll(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g)) {
    if (cpfValido(m[0])) return soDigitos(m[0]);
  }
  return null;
}

export function extrairEmail(texto: string | null | undefined): string | null {
  const m = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(String(texto ?? ''));
  return m ? m[0].toLowerCase() : null;
}

// ── a resposta na conversa (E) ───────────────────────────────────────────────

export type ResultadoPixConversa =
  | { tipo: 'codigo'; codigo: string; validadeMs: number; novo: boolean }
  | { tipo: 'pedir_cpf' }
  /** Sem e-mail para criar (ou o Asaas não deu): o chamador cai no link `?pagar=pix`, que continua sendo o Pix automático. */
  | { tipo: 'link' }
  | { tipo: 'ja_pagou' }
  /** O código ainda vale, mas faltam menos de 30 min: NÃO cria outro (seria um segundo QR vivo). `ateMs` = até quando vale (a mensagem diz a hora). */
  | { tipo: 'aguardar'; ateMs: number };

/** Um código novo por conversa a cada 24 h. */
export const JANELA_CODIGO_NOVO_MS = 24 * 3_600_000;
/** Na conversa o código vivo é reenviado se faltam 30 min ou mais (a pessoa está ali e paga em minutos). A recuperação, que fala sozinha, exige 2 h. */
export const CONVERSA_VIVO_MIN_RESTANTE_MS = 30 * 60_000;

export interface IdentidadePix { email: string; nome: string | null; userId: string | null }

export interface DepsPixConversa {
  agora(): Date;
  /** A marca `quiz_pagto:<hmac>`: contrato, nome e e-mail. 'erro' = não deu para ler. */
  marca(hmac: string): Promise<{ contratoId: string; nome: string | null; email: string | null } | null | 'erro'>;
  contrato(contractId: string): Promise<ContratoBase | null>;
  pagouCpfOuEmail(cpf: string, email: string, desdeIso?: string | null): Promise<boolean>;
  /**
   * Como está a conta dessa pessoa: `vigente` (plano != free e plano_expira_em no futuro: já liberada, cobrar de novo seria cobrança dobrada), `tolerancia` (vencido, mas ainda
   * cliente pela régua do /publico: sem "já liberada" e sem código, o link decide), `prospect`. 'erro' = não deu para conferir.
   */
  contaPagante(email: string, userId: string | null): Promise<SituacaoDaConta | 'erro'>;
  /** A reserva do código novo da conversa. */
  conversa(hmac: string): Promise<{ contractId: string; em: string } | null | 'erro'>;
  reservarConversa(hmac: string, valor: { contractId: string; em: string }, trocar: boolean): Promise<'ok' | 'ja' | 'erro'>;
  atualizarConversa(hmac: string, contractId: string): Promise<void>;
  apagarConversa(hmac: string): Promise<void>;
  gerarNovo(a: { antigo: ContratoBase; nome: string | null; tel: string }): Promise<CodigoGerado>;
  /** Sem contrato anterior: cria com o CPF que a pessoa mandou e o e-mail achado. */
  criarComCpf(a: { cpf: string; identidade: IdentidadePix; tel: string }): Promise<CodigoGerado>;
  identidade(tel: string): Promise<IdentidadePix | null>;
  moverMarca(hmac: string, antigo: string, novo: string): Promise<boolean>;
}

export interface PedidoPixConversa {
  tel: string;
  nome?: string | null;
  /** O que a pessoa escreveu agora (o CPF vem daqui). */
  textoDoLead?: string | null;
  /** Rodada seca (ensaio): nada é criado nem reservado. */
  dry?: boolean;
}

/** BR Code sintático para a rodada seca: nunca é enviado. */
export function codigoDeEnsaio(): string {
  const corpo = '000201DRY6304';
  return corpo + crc16(corpo);
}

/**
 * O que mandar quando a pessoa pede Pix na conversa (o marcador de Pix automático). Acha o contrato pelo telefone (a marca `quiz_pagto:` é por hmac do telefone; o
 * Código do wa.me é derivado do mesmo telefone, então os dois dão no mesmo contrato). Nunca lança: qualquer falha vira 'link' (o link do Pix automático segue valendo).
 */
export async function resolverPixConversa(p: PedidoPixConversa, d: DepsPixConversa = depsPixConversaReais()): Promise<ResultadoPixConversa> {
  try {
    const hmac = hmacDoPagamento(p.tel);
    if (!hmac) return { tipo: 'link' };
    const agora = d.agora();
    const agoraMs = agora.getTime();

    // 1. já gerei um código novo nesta conversa nas últimas 24 h? Pedido repetido reenvia o MESMO código, se ainda vale (30 min ou mais sobrando).
    const conv = await d.conversa(hmac);
    if (conv === 'erro') return { tipo: 'link' };
    if (conv && agoraMs - Date.parse(conv.em) < JANELA_CODIGO_NOVO_MS) {
      const c = await d.contrato(conv.contractId);
      if (!c) return { tipo: 'link' };
      if (contratoFoiPago(c)) return { tipo: 'ja_pagou' };
      const pag = await d.contaPagante(c.email, c.user_id);
      if (pag === 'erro' || pag === 'tolerancia') return { tipo: 'link' };
      if (pag === 'vigente') return { tipo: 'ja_pagou' };
      const rest = restanteDoCodigoMs({ created_at: c.created_at, expira_em: c.expira_em }, agoraMs);
      if (c.status === 'pendente' && ehCodigoPix(c.qr_payload) && rest !== null && rest >= CONVERSA_VIVO_MIN_RESTANTE_MS) {
        return { tipo: 'codigo', codigo: c.qr_payload, validadeMs: agoraMs + rest, novo: false };
      }
      // Ainda vale, mas por pouco: a mensagem diz até que horas. Venceu dentro das 24 h: sem código novo; o link do Pix automático segue valendo.
      if (c.status === 'pendente' && ehCodigoPix(c.qr_payload) && rest !== null && rest > 0) return { tipo: 'aguardar', ateMs: agoraMs + rest };
      return { tipo: 'link' };
    }

    // 2. o contrato da pessoa, pela marca.
    const marca = await d.marca(hmac);
    if (marca === 'erro') return { tipo: 'link' };
    const antigo = marca ? await d.contrato(marca.contratoId) : null;

    if (antigo) {
      if (contratoFoiPago(antigo) || await d.pagouCpfOuEmail(antigo.cpf_cnpj, antigo.email, antigo.created_at)) return { tipo: 'ja_pagou' };
      // Já paga no cartão (conta com plano vigente): cobrar de novo seria cobrança dobrada. Não cria e não reenvia código.
      const pag = await d.contaPagante(antigo.email, antigo.user_id);
      if (pag === 'erro' || pag === 'tolerancia') return { tipo: 'link' };
      if (pag === 'vigente') return { tipo: 'ja_pagou' };
      const rest = restanteDoCodigoMs({ created_at: antigo.created_at, expira_em: antigo.expira_em }, agoraMs);
      if (antigo.status === 'pendente' && ehCodigoPix(antigo.qr_payload) && rest !== null) {
        if (rest >= CONVERSA_VIVO_MIN_RESTANTE_MS) return { tipo: 'codigo', codigo: antigo.qr_payload, validadeMs: agoraMs + rest, novo: false };
        // Código vivo com menos de 30 min: não cria outro (dois QRs vivos); a mensagem diz até que horas vale.
        if (rest > 0) return { tipo: 'aguardar', ateMs: agoraMs + rest };
        // Venceu há menos de 5 min (dentro da folga): nem código velho, nem novo ainda. O link do Pix automático segue valendo.
        if (rest > -FOLGA_VENCIMENTO_MS) return { tipo: 'link' };
      }
      if (antigo.status !== 'pendente' && antigo.status !== 'expirado') return { tipo: 'link' };
      if (p.dry) return { tipo: 'codigo', codigo: codigoDeEnsaio(), validadeMs: agoraMs + 86_400_000, novo: true };
      const reserva = await d.reservarConversa(hmac, { contractId: antigo.contract_id, em: agora.toISOString() }, !!conv);
      if (reserva !== 'ok') return { tipo: 'link' };
      try {
        const novo = await d.gerarNovo({ antigo, nome: p.nome ?? marca?.nome ?? null, tel: p.tel });
        await d.atualizarConversa(hmac, novo.contractId);
        await d.moverMarca(hmac, antigo.contract_id, novo.contractId);
        return { tipo: 'codigo', codigo: novo.qrPayload, validadeMs: Date.parse(novo.expiraEm), novo: true };
      } catch (err) {
        await d.apagarConversa(hmac);
        logger.error(LOG, `código novo da conversa não saiu (${String((err as Error)?.message ?? err).slice(0, 40)})`);
        return { tipo: 'link' };
      }
    }

    // 3. sem contrato: precisa do CPF (que a pessoa manda em resposta) e de um e-mail.
    const cpf = extrairCpf(p.textoDoLead);
    if (!cpf) return { tipo: 'pedir_cpf' };
    const identidade = await d.identidade(p.tel);
    const email = identidade?.email ?? extrairEmail(p.textoDoLead);
    if (!email) return { tipo: 'link' };
    if (await d.pagouCpfOuEmail(cpf, email, null)) return { tipo: 'ja_pagou' };
    const pagante = await d.contaPagante(email, identidade?.userId ?? null);
    if (pagante === 'erro' || pagante === 'tolerancia') return { tipo: 'link' };
    if (pagante === 'vigente') return { tipo: 'ja_pagou' };
    if (p.dry) return { tipo: 'codigo', codigo: codigoDeEnsaio(), validadeMs: agoraMs + 86_400_000, novo: true };
    const reserva = await d.reservarConversa(hmac, { contractId: 'sem_contrato', em: agora.toISOString() }, !!conv);
    if (reserva !== 'ok') return { tipo: 'link' };
    try {
      const novo = await d.criarComCpf({ cpf, identidade: { email, nome: identidade?.nome ?? p.nome ?? null, userId: identidade?.userId ?? null }, tel: p.tel });
      await d.atualizarConversa(hmac, novo.contractId);
      return { tipo: 'codigo', codigo: novo.qrPayload, validadeMs: Date.parse(novo.expiraEm), novo: true };
    } catch (err) {
      await d.apagarConversa(hmac);
      logger.error(LOG, `código novo (sem contrato) não saiu (${String((err as Error)?.message ?? err).slice(0, 40)})`);
      return { tipo: 'link' };
    }
  } catch (err) {
    logger.error(LOG, `resolver o Pix da conversa falhou (${String((err as Error)?.message ?? err).slice(0, 40)})`);
    return { tipo: 'link' };
  }
}

export function depsPixConversaReais(): DepsPixConversa {
  return {
    agora: () => new Date(),
    async marca(hmac) {
      try {
        const { data, error } = await supabase.from('system_state').select('value').eq('key', `${PREFIXO_PAGTO}${hmac}`).maybeSingle();
        if (error) return 'erro';
        const v = (data as { value?: Record<string, unknown> } | null)?.value;
        if (!v || typeof v.contratoId !== 'string') return null;
        return { contratoId: v.contratoId, nome: typeof v.nome === 'string' ? v.nome : null, email: typeof v.email === 'string' ? v.email : null };
      } catch { return 'erro'; }
    },
    contrato: lerContratoBase,
    pagouCpfOuEmail,
    async conversa(hmac) {
      try {
        const { data, error } = await supabase.from('system_state').select('value').eq('key', chavePixAutoConv(hmac)).maybeSingle();
        if (error) return 'erro';
        const v = (data as { value?: { contractId?: unknown; em?: unknown } } | null)?.value;
        return v && typeof v.contractId === 'string' && typeof v.em === 'string' ? { contractId: v.contractId, em: v.em } : null;
      } catch { return 'erro'; }
    },
    async reservarConversa(hmac, valor, trocar) {
      try {
        // Reserva só por insert (duas respostas ao mesmo tempo criam UM código). Reserva velha (mais de 24 h) sai antes.
        if (trocar) await supabase.from('system_state').delete().eq('key', chavePixAutoConv(hmac));
        const { error } = await supabase.from('system_state').insert({ key: chavePixAutoConv(hmac), value: valor, updated_at: valor.em });
        if (!error) return 'ok';
        return (error as { code?: string }).code === '23505' ? 'ja' : 'erro';
      } catch { return 'erro'; }
    },
    async atualizarConversa(hmac, contractId) {
      try { await supabase.from('system_state').update({ value: { contractId, em: new Date().toISOString() } }).eq('key', chavePixAutoConv(hmac)); } catch { /* a reserva já vale */ }
    },
    async apagarConversa(hmac) {
      try { await supabase.from('system_state').delete().eq('key', chavePixAutoConv(hmac)); } catch { /* sobra uma reserva: no máximo 24 h sem código novo */ }
    },
    gerarNovo: (a) => gerarCodigoNovo(a),
    async criarComCpf(a) {
      const criado = await criarPixRecorrente({
        userId: a.identidade.userId, email: a.identidade.email, nome: a.identidade.nome ?? '', cpfCnpj: a.cpf, whatsapp: a.tel, planKey: 'ilimitado',
        atribuicao: { rota: 'publica', origem: 'conversa_pix', whatsapp: a.tel, ...(a.identidade.nome ? { nome: a.identidade.nome } : {}) }, exigirAutomatico: true,
      });
      const exp = Date.parse(String(criado.expiraEm ?? ''));
      if (criado.status !== 'pendente' || !ehCodigoPix(criado.qrPayload) || !Number.isFinite(exp) || exp <= Date.now()) throw new Error('sem_codigo');
      return { contractId: criado.contractId, qrPayload: criado.qrPayload, expiraEm: new Date(exp).toISOString() };
    },
    identidade: identidadePorTelefone,
    async contaPagante(email, userId) {
      try {
        let q = supabase.from('users').select('plano, plano_expira_em');
        q = userId ? q.eq('id', userId) : q.eq('email', String(email ?? '').toLowerCase().trim());
        const { data, error } = await q.limit(5);
        if (error) return 'erro';
        const sit = ((data ?? []) as Array<{ plano?: string | null; plano_expira_em?: string | null }>).map(u => situacaoDaConta(u));
        return sit.includes('vigente') ? 'vigente' : sit.includes('tolerancia') ? 'tolerancia' : 'prospect';
      } catch { return 'erro'; }
    },
    moverMarca: moverMarcaDePagamento,
  };
}

/** A validade em ms de um contrato (data real, ou criação + 60 min). Reexporta para quem só quer o número. */
export { validadeDoCodigoMs };

/** Chave do telefone: DDD + 8 últimos dígitos (tira o 55 e ignora o 9º dígito), a mesma do CRM e do admin. */
export function chaveTelefoneDdd8(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

/**
 * Quem é a pessoa deste telefone? Casa pela chave DDD + 8 dígitos (NÃO pelos 8 últimos soltos) em abandoned_checkouts e em users, e só vale se der
 * EXATAMENTE uma pessoa (um e-mail). Zero ou mais de uma: null, e quem chama pede o CPF ou cai no link. Nunca chuta.
 */
export async function identidadePorTelefone(tel: string): Promise<IdentidadePix | null> {
  try {
    const chave = chaveTelefoneDdd8(tel);
    if (!chave) return null;
    const fim = chave.slice(2);
    const candidatos = new Map<string, { email: string; nome: string | null; userId: string | null }>();
    const { data: ab, error: eAb } = await supabase.from('abandoned_checkouts').select('email, nome, phone').filter('phone', 'ilike', `%${fim}`).limit(50);
    if (eAb) return null;
    for (const l of (ab ?? []) as Array<{ email?: string | null; nome?: string | null; phone?: string | null }>) {
      if (chaveTelefoneDdd8(l.phone) !== chave || !l.email) continue;
      const e = l.email.toLowerCase().trim();
      if (!candidatos.has(e)) candidatos.set(e, { email: e, nome: l.nome ?? null, userId: null });
    }
    const { data: us, error: eUs } = await supabase.from('users').select('id, email, nome, whatsapp').filter('whatsapp', 'ilike', `%${fim}`).limit(50);
    if (eUs) return null;
    for (const u of (us ?? []) as Array<{ id?: string; email?: string | null; nome?: string | null; whatsapp?: string | null }>) {
      if (chaveTelefoneDdd8(u.whatsapp) !== chave || !u.email) continue;
      const e = u.email.toLowerCase().trim();
      candidatos.set(e, { email: e, nome: u.nome ?? candidatos.get(e)?.nome ?? null, userId: u.id ?? null });
    }
    if (candidatos.size !== 1) return null;
    const unica = [...candidatos.values()][0]!;
    if (!unica.userId) {
      const { data: u } = await supabase.from('users').select('id').eq('email', unica.email).maybeSingle();
      unica.userId = (u as { id?: string } | null)?.id ?? null;
    }
    return unica;
  } catch { return null; }
}
