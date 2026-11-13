/**
 * ADICIONAL NO PIX AUTOMÁTICO, comprado dentro do app (R$ 17 cada ou as 4 por R$ 40).
 *
 * É uma autorização SEPARADA da do plano, de propósito: o valor da autorização é fixo e a do plano nunca é tocada. O
 * contrato do adicional NÃO mora em `asaas_pix_assinaturas` (a tela do plano, o cancelamento e o webhook acham "o
 * contrato do usuário" lá, e um segundo contrato creditaria a mensalidade errada): mora em `system_state` com o
 * prefixo `adicional_*`, sem migration. O id do contrato começa com `SDAD-`.
 *
 * O webhook do Asaas passa por `tratarWebhookAdicionalPix` ANTES do trilho do plano. Só responde pelo que reconhece
 * (contrato `SDAD-`, ou ligação gravada aqui); o resto devolve null e segue o caminho de sempre.
 */

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { ApiError } from '../../utils/apiError';
import { cpfValido } from '../../utils/documento';
import { asaasFetch, asaasHabilitado, type AsaasError } from '../asaas/asaasClient';
import { criarAutorizacaoComFallback, garantirClienteAsaas, soDigitos } from '../asaas/pixRecorrenteService';
import { expiracaoParaGravar } from '../asaas/pixAutoValidade';
import { acessos, concederOuEstender } from './acessos';
import {
  ITENS_AVULSOS, PACOTE, adicionaisLigado, comFolga, ehItemValido, obsDoAdicional, produtosDoItem, somaMensal,
} from './adicionais';
import { marcarCancelando, posseDoAdicional } from './adicionaisApp';

export const PREFIXO_CONTRATO_ADICIONAL = 'SDAD-';

const kContrato = (c: string) => `adicional_pix:${c}`;
const kUsuarioItem = (u: string, i: string) => `adicional_pix_u:${u}:${i}`;
const kAuth = (a: string) => `adicional_auth:${a}`;
const kQr = (q: string) => `adicional_qr:${q}`;
const kPag = (p: string) => `adicional_pag:${p}`;
const kClaim = (p: string) => `adicional_pg:${p}`;

interface Contrato {
  user_id: string; email: string; item: string; valor: number; authorization_id: string;
  status: 'pendente' | 'ativo' | 'cancelado' | 'expirado' | 'recusado';
  qr_payload: string | null; expira_em: string | null; criado_em: string; ultimo_pagamento_em?: string | null;
}

async function ler<T = Record<string, any>>(key: string): Promise<T | null> {
  const { data } = await supabase.from('system_state').select('value').eq('key', key).maybeSingle();
  return ((data as { value?: T } | null)?.value ?? null) as T | null;
}

async function gravar(key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from('system_state').upsert({ key, value }, { onConflict: 'key' });
  if (error) logger.error('adicional-pix', `system_state: nao gravei ${key.split(':')[0]}`, error);
}

async function soSeNovo(key: string, value: unknown): Promise<'novo' | 'existia' | 'erro'> {
  const { error } = await supabase.from('system_state').insert({ key, value });
  if (!error) return 'novo';
  return (error as { code?: string }).code === '23505' ? 'existia' : 'erro';
}

export interface PixAdicionalCriado {
  id: string; modo: 'automatico'; contractId: string; plano: 'adicional'; item: string;
  valor: number; primeiroMes: number; cupom: null; status: string;
  qrPayload: string | null; qrImagemBase64: string | null; expiraEm: string | null;
}

/** CPF da pessoa: o que veio no corpo, ou o último que ela usou (Pix de produto ou do plano). */
async function cpfDaPessoa(userId: string, informado: unknown, usarSalvo: unknown): Promise<string> {
  let cpf = soDigitos(typeof informado === 'string' ? informado : '');
  if (!cpf && usarSalvo === true) {
    // Lazy: o webhook do Asaas importa este módulo em todo evento e não precisa carregar o Pix de produto.
    const { ultimoCpf } = await import('./produtoPix');
    cpf = (await ultimoCpf(userId)) ?? '';
    if (!cpf) {
      const { data } = await supabase.from('asaas_pix_assinaturas').select('cpf_cnpj').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      const d = soDigitos((data as { cpf_cnpj?: string } | null)?.cpf_cnpj);
      cpf = d.length === 11 ? d : '';
    }
  }
  if (!cpfValido(cpf)) throw new ApiError(400, 'Informe um CPF válido.');
  return cpf;
}

/** Quanto falta de validade num QR já criado, para devolver o MESMO código em vez de abrir um segundo. */
const MARGEM_REUSO_MS = 5 * 60 * 1000;

export async function criarPixAdicional(o: {
  userId: string; item: unknown; cpf?: unknown; usarCpfSalvo?: unknown;
}): Promise<PixAdicionalCriado> {
  if (!adicionaisLigado()) throw new ApiError(404, 'Adicionais indisponíveis');
  if (typeof o.item !== 'string' || !ehItemValido(o.item)) throw new ApiError(400, 'Item inválido');
  const item = o.item;
  const cpf = await cpfDaPessoa(o.userId, o.cpf, o.usarCpfSalvo);
  if (!asaasHabilitado()) throw new ApiError(503, 'Pix indisponível agora.');

  const a = await acessos(o.userId);
  if (produtosDoItem(item).every((p) => a.produtos.has(p))) throw new ApiError(409, 'Você já tem este adicional.');

  // Mesmo QR enquanto vale (clique duplo, voltar e abrir de novo): nunca dois códigos pagáveis para o mesmo item.
  const anterior = await ler<{ contract_id?: string }>(kUsuarioItem(o.userId, item));
  const ctAnterior = anterior?.contract_id ? await ler<Contrato>(kContrato(anterior.contract_id)) : null;
  if (ctAnterior?.status === 'ativo') throw new ApiError(409, 'Você já tem este adicional.');
  if (ctAnterior?.status === 'pendente' && ctAnterior.qr_payload && ctAnterior.expira_em
      && new Date(ctAnterior.expira_em).getTime() - Date.now() > MARGEM_REUSO_MS) {
    return {
      id: anterior!.contract_id as string, modo: 'automatico', contractId: anterior!.contract_id as string, plano: 'adicional', item,
      valor: ctAnterior.valor, primeiroMes: ctAnterior.valor, cupom: null, status: 'pendente',
      qrPayload: ctAnterior.qr_payload, qrImagemBase64: null, expiraEm: ctAnterior.expira_em,
    };
  }

  const { data: u } = await supabase.from('users').select('id, email, nome, whatsapp').eq('id', o.userId).maybeSingle();
  const user = u as { id: string; email: string; nome: string | null; whatsapp: string | null } | null;
  if (!user?.email) throw new ApiError(404, 'Usuário não encontrado');

  const valor = somaMensal([item], 'app');
  const customerId = await garantirClienteAsaas({
    nome: (user.nome || user.email).trim(), email: user.email, cpfCnpj: cpf, whatsapp: user.whatsapp, userId: user.id,
  });
  const contractId = `${PREFIXO_CONTRATO_ADICIONAL}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 35);

  let criada;
  try {
    criada = await criarAutorizacaoComFallback({
      customerId, plano: 'adicional', valor, primeiroMes: valor, contractId, nomePlano: 'adicional',
    });
  } catch (err) {
    logger.error('adicional-pix', `autorizacao do adicional falhou (${(err as AsaasError)?.message})`, err);
    throw new ApiError(502, 'O Pix automático não está disponível agora. Tente de novo em instantes.');
  }
  const { auth, segundos } = criada;
  const exp = expiracaoParaGravar(auth.immediateQrCode?.expirationDate, Date.now(), segundos);
  const agora = new Date().toISOString();
  const status = (auth.status || 'CREATED').toLowerCase() === 'active' ? 'ativo' : 'pendente';

  await gravar(kContrato(contractId), {
    user_id: user.id, email: user.email, item, valor, authorization_id: auth.id, status,
    qr_payload: auth.payload ?? null, expira_em: exp.expira_em, criado_em: agora,
  } satisfies Contrato);
  await gravar(kUsuarioItem(user.id, item), { contract_id: contractId, em: agora });
  await gravar(kAuth(auth.id), { contract_id: contractId, em: agora });
  const qrId = auth.immediateQrCode?.conciliationIdentifier?.trim();
  if (qrId) await gravar(kQr(qrId), { contract_id: contractId, em: agora });

  return {
    id: contractId, modo: 'automatico', contractId, plano: 'adicional', item, valor, primeiroMes: valor, cupom: null, status,
    qrPayload: auth.payload ?? null, qrImagemBase64: auth.encodedImage ?? null, expiraEm: status === 'pendente' ? exp.expira_em : null,
  };
}

/** Cancela a autorização do adicional no Asaas. O acesso segue até o fim do período pago. false = não há o que cancelar. */
export async function cancelarAdicionalPix(userId: string, item: string): Promise<boolean> {
  const ref = await ler<{ contract_id?: string }>(kUsuarioItem(userId, item));
  const posses = await posseDoAdicional(userId, item, 'pix');
  // Pix pago junto com o plano (bump): o valor da autorização do plano é fixo, não dá para tirar só o adicional.
  if (!ref?.contract_id && posses.length && posses.every((l) => !String(l.order_id ?? '').startsWith(PREFIXO_CONTRATO_ADICIONAL))) {
    throw new ApiError(409, 'Este adicional é cobrado junto com o Pix do plano. Para cancelar, fale com a gente ou cancele o Pix do plano.');
  }
  if (!ref?.contract_id) return false;
  const ct = await ler<Contrato>(kContrato(ref.contract_id));
  if (!ct || ct.user_id !== userId) return false;
  if (ct.status === 'cancelado') { await marcarCancelando(userId, item, 'pix'); return true; }
  try {
    await asaasFetch(`/pix/automatic/authorizations/${ct.authorization_id}`, { method: 'DELETE' });
  } catch (err) {
    logger.error('adicional-pix', `cancelamento no Asaas falhou (${ref.contract_id})`, err);
    throw new ApiError(502, 'Não consegui cancelar no banco agora. Tente de novo em instantes.');
  }
  await gravar(kContrato(ref.contract_id), { ...ct, status: 'cancelado' });
  await marcarCancelando(userId, item, 'pix');
  return true;
}

// ── webhook do Asaas ─────────────────────────────────────────────────────────

type Corpo = {
  payment?: { id?: string; externalReference?: string | null; pixQrCodeId?: string | null } | null;
  authorization?: { id?: string; contractId?: string; immediateQrCode?: { conciliationIdentifier?: string } | null } | null;
  paymentInstruction?: { paymentId?: string; authorization?: { id?: string } | null } | null;
};

async function contratoDoEvento(b: Corpo): Promise<string | null> {
  const ref = String(b.payment?.externalReference ?? b.authorization?.contractId ?? '');
  if (ref.startsWith(PREFIXO_CONTRATO_ADICIONAL)) return ref;
  const autId = b.authorization?.id ?? b.paymentInstruction?.authorization?.id;
  if (autId) { const s = await ler<{ contract_id?: string }>(kAuth(autId)); if (s?.contract_id) return s.contract_id; }
  if (b.payment?.pixQrCodeId) { const s = await ler<{ contract_id?: string }>(kQr(b.payment.pixQrCodeId)); if (s?.contract_id) return s.contract_id; }
  if (b.payment?.id) { const s = await ler<{ contract_id?: string }>(kPag(b.payment.id)); if (s?.contract_id) return s.contract_id; }
  return null;
}

/** Quem trocou as avulsas pelo pacote: cancela as autorizações das avulsas (o acesso delas vale até a data paga). */
async function cancelarAvulsasSubstituidas(userId: string): Promise<void> {
  for (const i of ITENS_AVULSOS) {
    try { await cancelarAdicionalPix(userId, i); } catch (err) {
      logger.error('adicional-pix', `nao cancelei a avulsa ${i} trocada pelo pacote (${userId}): cancelar na mao`, err);
    }
  }
}

async function creditar(b: Corpo, contractId: string): Promise<{ tratado: boolean; motivo: string }> {
  const pagamentoId = b.payment?.id;
  if (!pagamentoId) return { tratado: false, motivo: 'pagamento de adicional sem id' };
  if ((await soSeNovo(kClaim(pagamentoId), { contract_id: contractId, em: new Date().toISOString() })) === 'existia') {
    return { tratado: true, motivo: 'adicional ja creditado' };
  }
  const ct = await ler<Contrato>(kContrato(contractId));
  if (!ct) {
    logger.error('adicional-pix', `PAGAMENTO DE ADICIONAL SEM CONTRATO: ${contractId} pagamento ${pagamentoId}`);
    return { tratado: false, motivo: 'contrato de adicional desconhecido' };
  }
  const fim = new Date();
  fim.setMonth(fim.getMonth() + 1);
  const ate = comFolga(fim.getTime());
  try {
    for (const produto of produtosDoItem(ct.item)) {
      await concederOuEstender({ userId: ct.user_id, produto, ate, orderId: contractId, obs: obsDoAdicional('pix', ct.item) });
    }
  } catch (err) {
    // Sem a posse gravada o claim não pode ficar: a reentrega do Asaas precisa conseguir tentar de novo.
    await supabase.from('system_state').delete().eq('key', kClaim(pagamentoId));
    throw err;
  }
  const primeiro = ct.status !== 'ativo';
  await gravar(kContrato(contractId), { ...ct, status: 'ativo', ultimo_pagamento_em: new Date().toISOString() });
  if (primeiro && ct.item === PACOTE) await cancelarAvulsasSubstituidas(ct.user_id);
  logger.info('adicional-pix', `adicional ${ct.item} creditado (${contractId}) ate ${ate.toISOString().slice(0, 10)}`);
  return { tratado: true, motivo: 'adicional creditado' };
}

/**
 * null = o evento não é de adicional (segue o trilho do plano). Qualquer erro de leitura também vira null: o trilho do
 * plano cuida do que for dele, e o adicional do cliente é reconciliado pela próxima reentrega do Asaas.
 */
export async function tratarWebhookAdicionalPix(
  evento: string, b: Corpo,
): Promise<{ tratado: boolean; motivo: string } | null> {
  let contractId: string | null;
  try { contractId = await contratoDoEvento(b); } catch { return null; }
  if (!contractId) return null;

  switch (evento) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED':
      return creditar(b, contractId);

    case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED': {
      const ct = await ler<Contrato>(kContrato(contractId));
      const qrId = b.authorization?.immediateQrCode?.conciliationIdentifier?.trim();
      if (qrId) await gravar(kQr(qrId), { contract_id: contractId, em: new Date().toISOString() });
      if (ct && ct.status === 'pendente') await gravar(kContrato(contractId), { ...ct, status: 'ativo' });
      // O pagamento do 1º mês pode ter chegado ANTES e sem ligação: acha nos eventos já recebidos e credita agora.
      if (qrId) {
        const { data } = await supabase.from('asaas_webhook_events').select('payload')
          .in('event', ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']).eq('payload->payment->>pixQrCodeId', qrId)
          .order('recebido_em', { ascending: false }).limit(1).maybeSingle();
        const antigo = (data as { payload?: Corpo } | null)?.payload;
        if (antigo?.payment?.id) await creditar(antigo, contractId);
      }
      return { tratado: true, motivo: 'autorizacao de adicional ativa' };
    }

    case 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED':
    case 'PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_SCHEDULED': {
      const pagId = b.paymentInstruction?.paymentId;
      if (pagId) await gravar(kPag(pagId), { contract_id: contractId, em: new Date().toISOString() });
      return { tratado: true, motivo: 'instrucao de debito do adicional registrada' };
    }

    case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED':
    case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED':
    case 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED': {
      const status = evento.endsWith('CANCELLED') ? 'cancelado' : evento.endsWith('EXPIRED') ? 'expirado' : 'recusado';
      const ct = await ler<Contrato>(kContrato(contractId));
      if (ct) {
        await gravar(kContrato(contractId), { ...ct, status });
        if (status === 'cancelado') await marcarCancelando(ct.user_id, ct.item, 'pix');
      }
      return { tratado: true, motivo: `autorizacao de adicional ${status}` };
    }

    default:
      return { tratado: true, motivo: `evento de adicional ignorado (${evento})` };
  }
}
