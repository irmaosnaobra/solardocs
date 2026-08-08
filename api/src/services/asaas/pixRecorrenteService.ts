// ─────────────────────────────────────────────────────────────────────────────
// PIX RECORRENTE do SolarDoc (Asaas) — dois trilhos, o mesmo cliente e o mesmo webhook.
//
//  1) 'automatico'  → Pix Automático (BCB). O cliente paga o 1º mês lendo um QR e,
//     no mesmo ato, AUTORIZA o débito mensal no app do banco. Dos meses seguintes
//     em diante ninguém precisa fazer nada: o banco avisa 3 dias antes e debita.
//     É o que substitui de verdade o cartão.
//
//  2) 'assinatura'  → assinatura Asaas billingType PIX. O Asaas emite uma cobrança
//     por mês e o cliente paga o QR na mão — MAS a confirmação é automática por
//     webhook (nada de ler comprovante). É a rede de segurança: funciona mesmo se
//     a conta ainda não estiver elegível ao Pix Automático ou se o banco do
//     pagador não suportar.
//
// O modo sai de ASAAS_PIX_MODO: 'auto' (tenta automático, cai pra assinatura),
// 'automatico' (só automático) ou 'assinatura' (só assinatura). Padrão: 'auto'.
//
// Elegibilidade do Pix Automático (regra do Asaas): conta PJ, aprovada, sem
// pendência cadastral e CNPJ ativo há ≥6 meses. A AIOROS LTDA abriu em
// 12/11/2025 → passa desde maio/2026.
//
// ⚠️ Nada aqui rodou contra a API real ainda (a conta Asaas não existe). Os nomes
// de campo saíram da referência oficial; o primeiro teste tem que ser no sandbox.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/apiError';
import { asaasFetch, asaasHabilitado, AsaasError } from './asaasClient';
import { buscarCupomValido, aplicarCupom } from '../cuponsService';
import { PLANOS } from '../../utils/planos';

// Preço e limite saem de utils/planos (mesma tabela que o resto do sistema usa).
export const PLANOS_PIX = PLANOS;

export type ModoPix = 'automatico' | 'assinatura';

export interface PixRecorrenteCriado {
  modo: ModoPix;
  contractId: string;
  plano: string;
  valor: number;                 // mensalidade cheia
  primeiroMes: number;           // o que ele paga agora (menor que `valor` se houver cupom)
  cupom: string | null;
  qrPayload: string | null;      // copia-e-cola do primeiro pagamento
  qrImagemBase64: string | null; // PNG em base64 (sem o prefixo data:)
  status: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Data no fuso de Brasília (UTC-3) em YYYY-MM-DD, que é o formato que o Asaas espera.
function dataBR(offsetDias = 0, offsetMeses = 0): string {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  if (offsetMeses) d.setUTCMonth(d.getUTCMonth() + offsetMeses);
  if (offsetDias) d.setUTCDate(d.getUTCDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

export function soDigitos(v: string | null | undefined): string {
  return (v || '').replace(/\D/g, '');
}

// CPF (11) ou CNPJ (14). Validação de tamanho só — o Asaas rejeita o resto e a
// mensagem dele é melhor que qualquer eco nosso.
export function docValido(cpfCnpj: string): boolean {
  const d = soDigitos(cpfCnpj);
  return d.length === 11 || d.length === 14;
}

// contractId vai pro BCB e tem teto de 35 caracteres. Formato: SD-<plano>-<base36>.
function novoContractId(plano: string): string {
  const sufixo = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return `SD-${plano === 'ilimitado' ? 'VIP' : 'PRO'}-${sufixo}`.slice(0, 35);
}

function modoConfigurado(): 'auto' | ModoPix {
  const v = (process.env.ASAAS_PIX_MODO || 'auto').trim().toLowerCase();
  return v === 'automatico' || v === 'assinatura' ? v : 'auto';
}

// ── cliente no Asaas ─────────────────────────────────────────────────────────

interface AsaasCustomer { id: string; name?: string; cpfCnpj?: string }

// Reaproveita o cliente pelo CPF/CNPJ antes de criar. Sem isto, cada tentativa de
// assinatura viraria um Customer novo no Asaas — exatamente o bug que gerou os
// chargebacks do lado da Stripe (111 assinaturas para 85 e-mails).
export async function garantirClienteAsaas(dados: {
  nome: string; email: string; cpfCnpj: string; whatsapp?: string | null; userId?: string | null;
}): Promise<string> {
  const doc = soDigitos(dados.cpfCnpj);

  const busca = await asaasFetch<{ data?: AsaasCustomer[] }>(`/customers?cpfCnpj=${doc}&limit=1`);
  const achado = busca?.data?.[0];
  if (achado?.id) return achado.id;

  const criado = await asaasFetch<AsaasCustomer>('/customers', {
    method: 'POST',
    body: {
      name: dados.nome || dados.email,
      cpfCnpj: doc,
      email: dados.email,
      mobilePhone: soDigitos(dados.whatsapp) || undefined,
      externalReference: dados.userId || undefined,
      // O aviso de cobrança quem manda somos nós (WhatsApp/e-mail da Giovanna),
      // com a nossa voz. Dois remetentes falando do mesmo boleto confunde.
      notificationDisabled: true,
    },
  });
  return criado.id;
}

// ── trilho 1: Pix Automático ─────────────────────────────────────────────────

interface AsaasAutorizacao {
  id: string;
  status: string;               // CREATED | ACTIVE | CANCELLED | REFUSED | EXPIRED
  payload?: string | null;      // copia-e-cola do QR imediato
  encodedImage?: string | null; // QR em base64
  immediateQrCode?: { conciliationIdentifier?: string; expirationDate?: string } | null;
}

async function criarAutorizacaoAutomatica(args: {
  customerId: string; plano: string; valor: number; primeiroMes: number; contractId: string; nomePlano: string;
}): Promise<AsaasAutorizacao> {
  return asaasFetch<AsaasAutorizacao>('/pix/automatic/authorizations', {
    method: 'POST',
    body: {
      customerId: args.customerId,
      frequency: 'MONTHLY',
      contractId: args.contractId,
      // O 1º mês é o QR imediato abaixo. A recorrência começa no mês seguinte —
      // senão o cliente pagaria duas vezes no mês da adesão.
      startDate: dataBR(0, 1),
      value: args.valor,
      description: `SolarDoc ${args.nomePlano} mensal`.slice(0, 35),
      // SUBSCRIPTION = o Asaas gera a cobrança de cada ciclo sozinho. Em MANUAL
      // seríamos nós a emitir cada instrução, respeitando a janela de 2 a 10 dias
      // úteis antes do vencimento — mais um cron pra quebrar.
      paymentCreationMode: 'SUBSCRIPTION',
      // Sem saldo na conta do cliente no dia, tenta de novo em até 7 dias em vez
      // de derrubar a assinatura na primeira falha.
      retryPolicy: 'ALLOW_THREE_IN_SEVEN_DAYS',
      // O QR imediato é o 1º mês e pode vir com cupom (ex.: R$ 19). O `value`
      // acima é a MENSALIDADE cheia — é dele que saem as cobranças seguintes,
      // então o desconto de adesão não se repete.
      immediateQrCode: {
        originalValue: args.primeiroMes,
        expirationSeconds: 3600,
        description: `SolarDoc ${args.nomePlano}`.slice(0, 35),
      },
    },
  });
}

// ── trilho 2: assinatura Asaas com Pix ───────────────────────────────────────

interface AsaasAssinatura { id: string; status?: string; nextDueDate?: string }
interface AsaasPagamento  { id: string; status?: string }
interface AsaasQrCode     { encodedImage?: string | null; payload?: string | null; expirationDate?: string }

async function criarAssinaturaPix(args: {
  customerId: string; valor: number; primeiroMes: number; contractId: string; nomePlano: string;
}): Promise<{ assinatura: AsaasAssinatura; qr: AsaasQrCode | null }> {
  // Com cupom, o 1º mês é uma cobrança AVULSA (o desconto não pode entrar na
  // assinatura, senão se repetiria todo mês) e a mensalidade cheia começa no mês
  // que vem. Sem cupom, a própria assinatura já cobra hoje.
  const comCupom = args.primeiroMes < args.valor;

  const assinatura = await asaasFetch<AsaasAssinatura>('/subscriptions', {
    method: 'POST',
    body: {
      customer: args.customerId,
      billingType: 'PIX',
      value: args.valor,
      nextDueDate: comCupom ? dataBR(0, 1) : dataBR(),
      cycle: 'MONTHLY',
      description: `SolarDoc ${args.nomePlano} — assinatura mensal`,
      externalReference: args.contractId,
    },
  });

  let qr: AsaasQrCode | null = null;

  if (comCupom) {
    // Cobrança de adesão. Mesmo externalReference da assinatura: é assim que o
    // webhook sabe que este pagamento pertence a este contrato.
    try {
      const adesao = await asaasFetch<AsaasPagamento>('/payments', {
        method: 'POST',
        body: {
          customer: args.customerId,
          billingType: 'PIX',
          value: args.primeiroMes,
          dueDate: dataBR(),
          description: `SolarDoc ${args.nomePlano} — 1º mês`,
          externalReference: args.contractId,
        },
      });
      if (adesao?.id) qr = await asaasFetch<AsaasQrCode>(`/payments/${adesao.id}/pixQrCode`);
    } catch (err) {
      logger.error('asaas-pix', `cobrança de adesão com cupom falhou (${args.contractId})`, err);
    }
    return { assinatura, qr };
  }

  // O QR do 1º mês está na primeira cobrança da assinatura. Ela costuma nascer
  // junto, mas não é instantânea — daí a segunda tentativa.
  for (let tentativa = 0; tentativa < 2 && !qr; tentativa++) {
    if (tentativa) await new Promise((r) => setTimeout(r, 1500));
    try {
      const pagamentos = await asaasFetch<{ data?: AsaasPagamento[] }>(`/subscriptions/${assinatura.id}/payments?limit=1`);
      const primeiro = pagamentos?.data?.[0];
      if (primeiro?.id) qr = await asaasFetch<AsaasQrCode>(`/payments/${primeiro.id}/pixQrCode`);
    } catch (err) {
      logger.error('asaas-pix', `QR da 1ª cobrança de ${assinatura.id} não veio (tentativa ${tentativa + 1})`, err);
    }
  }
  // Sem QR o cliente ainda paga: a cobrança existe no Asaas e o webhook confirma.
  // A tela mostra o aviso em vez de fingir que deu tudo certo.
  return { assinatura, qr };
}

// ── criação (entrada única) ──────────────────────────────────────────────────

export async function criarPixRecorrente(args: {
  userId: string | null;
  email: string;
  nome: string;
  cpfCnpj: string;
  whatsapp?: string | null;
  planKey: string;
  cupom?: string | null;
}): Promise<PixRecorrenteCriado> {
  if (!asaasHabilitado()) throw new ApiError(503, 'Pix recorrente ainda não está ligado');

  const info = PLANOS_PIX[args.planKey];
  if (!info) throw new ApiError(400, 'Plano inválido');
  if (!docValido(args.cpfCnpj)) throw new ApiError(400, 'CPF ou CNPJ inválido');

  // Cupom de primeiro mês (mesma tabela do cartão). Só mexe na adesão: a
  // mensalidade continua sendo `info.valor` nos dois modos.
  const aplicado = aplicarCupom(await buscarCupomValido(args.cupom, info.plano), info.valor);
  const primeiroMes = aplicado?.primeiroMes ?? info.valor;

  // Já tem contrato vivo? Devolve o mesmo em vez de abrir um segundo — dois
  // contratos ativos no mesmo CPF é cobrança em dobro com outro nome.
  if (args.userId) {
    const existente = await buscarAssinaturaAtiva(args.userId);
    if (existente) {
      return {
        modo: existente.modo as ModoPix,
        contractId: existente.contract_id,
        plano: existente.plano,
        valor: Number(existente.valor),
        // Contrato que já existe mantém o cupom da adesão dele — aplicar um novo
        // aqui daria segundo desconto a quem já entrou.
        primeiroMes: Number(existente.primeiro_mes ?? existente.valor),
        cupom: existente.cupom ?? null,
        qrPayload: existente.qr_payload ?? null,
        qrImagemBase64: null, // o QR só é entregue na criação; o copia-e-cola basta
        status: existente.status,
      };
    }
  }

  const customerId = await garantirClienteAsaas({
    nome: args.nome, email: args.email, cpfCnpj: args.cpfCnpj,
    whatsapp: args.whatsapp, userId: args.userId,
  });

  const contractId = novoContractId(info.plano);
  const modoCfg = modoConfigurado();

  let modo: ModoPix = 'assinatura';
  let authorizationId: string | null = null;
  let subscriptionId: string | null = null;
  let qrPayload: string | null = null;
  let qrImagem: string | null = null;
  let status = 'pendente';

  if (modoCfg === 'automatico' || modoCfg === 'auto') {
    try {
      const auth = await criarAutorizacaoAutomatica({
        customerId, plano: info.plano, valor: info.valor, primeiroMes, contractId, nomePlano: info.nome,
      });
      modo = 'automatico';
      authorizationId = auth.id;
      qrPayload = auth.payload ?? null;
      qrImagem = auth.encodedImage ?? null;
      status = (auth.status || 'CREATED').toLowerCase() === 'active' ? 'ativo' : 'pendente';
    } catch (err) {
      // Conta inelegível, Pix Automático não liberado, banco do pagador fora —
      // qualquer um desses cai na assinatura Pix, que sempre funciona. Só não cai
      // quando o Thiago pediu explicitamente 'automatico'.
      if (modoCfg === 'automatico') throw err;
      logger.warn('asaas-pix', `Pix Automático recusado (${(err as AsaasError)?.message}) — caindo pra assinatura Pix`, err);
    }
  }

  if (modo === 'assinatura') {
    const { assinatura, qr } = await criarAssinaturaPix({
      customerId, valor: info.valor, primeiroMes, contractId, nomePlano: info.nome,
    });
    subscriptionId = assinatura.id;
    qrPayload = qr?.payload ?? null;
    qrImagem = qr?.encodedImage ?? null;
  }

  const { error } = await supabase.from('asaas_pix_assinaturas').insert({
    user_id: args.userId,
    email: args.email.toLowerCase().trim(),
    cpf_cnpj: soDigitos(args.cpfCnpj),
    asaas_customer_id: customerId,
    modo,
    authorization_id: authorizationId,
    subscription_id: subscriptionId,
    contract_id: contractId,
    plano: info.plano,
    valor: info.valor,
    primeiro_mes: primeiroMes,
    cupom: aplicado?.cupom.codigo ?? null,
    status,
    qr_payload: qrPayload,
  });

  // Cobrança criada no Asaas e linha não gravada = cliente paga e o webhook não
  // acha a quem creditar. Grita alto: é o pior estado possível deste fluxo.
  if (error) {
    logger.error('asaas-pix', `CONTRATO ${contractId} CRIADO NO ASAAS E NÃO GRAVADO (${args.email}) — pagamento ficará órfão`, error);
  }

  return {
    modo, contractId, plano: info.plano, valor: info.valor, primeiroMes,
    cupom: aplicado?.cupom.codigo ?? null, qrPayload, qrImagemBase64: qrImagem, status,
  };
}

// ── consulta e cancelamento ──────────────────────────────────────────────────

export interface LinhaPixRecorrente {
  id: string; user_id: string | null; email: string; modo: string;
  authorization_id: string | null; subscription_id: string | null; contract_id: string;
  plano: string; valor: number; primeiro_mes: number | null; cupom: string | null;
  status: string; qr_payload: string | null;
  ultimo_pagamento_em: string | null; proximo_vencimento: string | null;
}

const COLS = 'id, user_id, email, modo, authorization_id, subscription_id, contract_id, plano, valor, primeiro_mes, cupom, status, qr_payload, ultimo_pagamento_em, proximo_vencimento';

export async function buscarAssinaturaAtiva(userId: string): Promise<LinhaPixRecorrente | null> {
  const { data } = await supabase
    .from('asaas_pix_assinaturas')
    .select(COLS)
    .eq('user_id', userId)
    .in('status', ['pendente', 'ativo', 'inadimplente'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as LinhaPixRecorrente | null) ?? null;
}

export async function cancelarPixRecorrente(userId: string): Promise<boolean> {
  const linha = await buscarAssinaturaAtiva(userId);
  if (!linha) return false;

  try {
    if (linha.modo === 'automatico' && linha.authorization_id) {
      await asaasFetch(`/pix/automatic/authorizations/${linha.authorization_id}`, { method: 'DELETE' });
    } else if (linha.subscription_id) {
      await asaasFetch(`/subscriptions/${linha.subscription_id}`, { method: 'DELETE' });
    }
  } catch (err) {
    // Marcar como cancelado sem o Asaas ter cancelado é o caminho pro cliente
    // seguir sendo debitado achando que cancelou. Falha aqui é falha de verdade.
    logger.error('asaas-pix', `cancelamento no Asaas falhou (${linha.contract_id})`, err);
    throw new ApiError(502, 'Não consegui cancelar no banco agora. Tenta de novo em instantes.');
  }

  await supabase
    .from('asaas_pix_assinaturas')
    .update({ status: 'cancelado', updated_at: new Date().toISOString() })
    .eq('id', linha.id);

  // Acesso NÃO é cortado aqui: o cliente já pagou o mês corrente e plano_expira_em
  // segura até o fim dele. É o mesmo contrato do cancelamento no cartão.
  logger.info('asaas-pix', `contrato ${linha.contract_id} cancelado a pedido do cliente (${linha.email})`);
  return true;
}
