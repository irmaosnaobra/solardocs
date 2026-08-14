/**
 * TESTE DE SANDBOX DO PIX RECORRENTE (Asaas).
 *
 * Existe porque o trilho inteiro foi escrito em 08/08/2026 sem NUNCA ter falado
 * com a API real. Ligar direto em produção seria descobrir os nomes de campo no
 * cliente pagante — e o modo de falha mais caro aqui não é erro 400, é cobrança
 * em dobro na adesão.
 *
 * Rodar:  cd api && npx ts-node --transpile-only scripts/testar-asaas.ts
 * Exige:  ASAAS_API_KEY (chave de SANDBOX) no api/.env
 *
 * Ele NÃO roda com ASAAS_ENV=prod. Não é conveniência: um teste que cria
 * autorização de débito na conta de produção cobra gente de verdade.
 *
 * ⚠️ SANDBOX é o ASAAS. O BANCO continua sendo o de PRODUÇÃO (api/.env aponta
 * pro solardoc-pro), porque o teste roda o caminho de verdade e ele grava em
 * `asaas_pix_assinaturas`. Por isso a limpeza APAGA a linha no fim: um contrato
 * de mentira parado ali faz a pergunta "o Pix recorrente já está ligado?" —
 * respondida justamente contando essa tabela — passar a mentir.
 *
 * O que ele faz e responde, em ordem:
 *   1. A chave é válida e a conta está aprovada?
 *   1b. CADASTRA O WEBHOOK sozinho (cria ou atualiza) — é o passo do guia mais
 *      fácil de errar na mão: oito nomes de evento digitados num painel, e um
 *      errado significa pagamento confirmado que nunca vira acesso.
 *   2. A conta está elegível ao Pix Automático? (CNPJ ativo há ≥6 meses)
 *   3. O trilho cria o contrato de ponta a ponta — cliente, autorização e linha
 *      no banco?
 *   4. OS DOIS RISCOS CONHECIDOS:
 *      · `startDate` está mesmo um mês à frente (senão cobra 2× na adesão);
 *      · o QR imediato volta preenchido (na doc o exemplo vem nulo — se vier
 *        nulo de verdade, a tela mostra aviso em vez do código e o QR precisa
 *        ser buscado noutro endpoint).
 */

import 'dotenv/config';
import { asaasFetch, asaasBaseUrl, asaasApiKey, asaasHabilitado } from '../src/services/asaas/asaasClient';
import { criarPixRecorrente } from '../src/services/asaas/pixRecorrenteService';
import { supabase } from '../src/utils/supabase';

// CPF de teste do sandbox do Asaas. Em sandbox nenhum documento é consultado na
// Receita; em produção este script nem roda.
const CPF_TESTE = '24971563792';
const EMAIL_TESTE = 'sandbox-solardoc@teste.com';

const ok = (m: string) => console.log(`  OK   ${m}`);
const err = (m: string) => console.log(`  ERRO ${m}`);
const info = (m: string) => console.log(`       ${m}`);
const titulo = (m: string) => console.log(`\n── ${m} ${'─'.repeat(Math.max(0, 60 - m.length))}`);

async function main(): Promise<void> {
  console.log('\nTESTE DO PIX RECORRENTE — SANDBOX\n');

  // ── 0. Travas ──────────────────────────────────────────────────────────────
  if ((process.env.ASAAS_ENV || '').trim().toLowerCase() === 'prod') {
    err('ASAAS_ENV=prod. Este script só roda em sandbox — ele CRIA autorização de débito.');
    process.exit(1);
  }
  if (!asaasHabilitado()) {
    err('Sem ASAAS_API_KEY no api/.env (ou PIX_RECORRENTE_OFF=true).');
    info('Cole a chave de SANDBOX do Asaas em api/.env e rode de novo.');
    process.exit(1);
  }
  info(`endpoint: ${asaasBaseUrl()}`);
  info(`chave:    ${asaasApiKey().slice(0, 12)}… (${asaasApiKey().length} caracteres)`);

  // ── 1. A chave abre a conta? ───────────────────────────────────────────────
  titulo('1. Conta');
  let conta: Record<string, unknown>;
  try {
    conta = await asaasFetch<Record<string, unknown>>('/myAccount');
    ok(`conta acessível: ${String(conta.name ?? conta.email ?? '(sem nome)')}`);
    info(`tipo: ${String(conta.personType ?? '?')} · CNPJ/CPF: ${String(conta.cpfCnpj ?? '?')}`);
  } catch (e) {
    err(`a chave não abriu a conta: ${(e as Error).message}`);
    info('Chave errada, ou chave de produção com ASAAS_ENV=sandbox (os dois ambientes têm chaves diferentes).');
    process.exit(1);
  }

  // ── 1b. Webhook: cadastra sozinho ──────────────────────────────────────────
  // O passo mais fácil de errar do guia inteiro: oito nomes de evento digitados
  // à mão num painel. Errar um só significa pagamento confirmado que nunca vira
  // acesso — e falha silenciosa, que é a assinatura de erro deste sistema. Aqui
  // é a API que cadastra, com a lista que o nosso webhook realmente trata.
  titulo('1b. Webhook (cadastro automático)');
  const WEBHOOK_URL = (process.env.API_PUBLIC_URL || 'https://api.solardoc.app').trim() + '/payments/asaas/webhook';
  const EVENTOS = [
    'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED',
    'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED',
    'PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED',
  ];
  const authToken = (process.env.ASAAS_WEBHOOK_TOKEN || '').trim();
  if (!authToken) {
    err('sem ASAAS_WEBHOOK_TOKEN — o webhook em produção recusa tudo com 503.');
    info('Ponha o token no .env e na Vercel ANTES de cadastrar, senão o Asaas entrega pra uma porta fechada.');
  } else {
    try {
      const existentes = await asaasFetch<{ data?: Array<Record<string, unknown>> }>('/webhooks?limit=100');
      const nosso = (existentes.data ?? []).find((w) => String(w.url ?? '') === WEBHOOK_URL);
      const corpo = {
        name: 'SolarDoc — Pix recorrente',
        url: WEBHOOK_URL,
        email: 'aiorosgroup@gmail.com',
        enabled: true,
        interrupted: false,
        authToken,
        // SEQUENTIALLY: se um evento falhar, o Asaas PARA a fila em vez de seguir
        // adiante. Aqui isso é o certo — evento perdido é mês não creditado.
        sendType: 'SEQUENTIALLY',
        events: EVENTOS,
      };
      if (nosso?.id) {
        await asaasFetch(`/webhooks/${nosso.id}`, { method: 'PUT', body: corpo });
        ok(`webhook já existia e foi atualizado (${String(nosso.id)})`);
      } else {
        const criado = await asaasFetch<{ id?: string }>('/webhooks', { method: 'POST', body: corpo });
        ok(`webhook criado: ${criado?.id ?? '(sem id)'}`);
      }
      info(`destino: ${WEBHOOK_URL}`);
      info(`eventos: ${EVENTOS.length}`);
    } catch (e) {
      err(`não consegui cadastrar o webhook: ${(e as Error).message}`);
      info('Cadastre na mão no painel do Asaas (a lista de eventos está no PIX-RECORRENTE-SOLARDOC.md).');
    }
  }

  // ── 2. Elegível ao Pix Automático? ─────────────────────────────────────────
  titulo('2. Pix Automático');
  let elegivel: boolean | null = null;
  try {
    const el = await asaasFetch<Record<string, unknown>>('/pix/automatic/eligibility');
    elegivel = Boolean(el.eligible ?? el.enabled);
    console.log(`  ${elegivel ? 'OK  ' : 'ERRO'} elegibilidade: ${JSON.stringify(el)}`);
    if (!elegivel) info('Sem elegibilidade o trilho cai no modo `assinatura` (QR novo por mês, confirmação automática).');
  } catch (e) {
    info(`não consegui consultar elegibilidade (${(e as Error).message})`);
    info('Não é bloqueio: o modo `auto` tenta o automático e cai pra assinatura sozinho.');
  }

  // ── 3. Criação de ponta a ponta ────────────────────────────────────────────
  titulo('3. Criar contrato (cliente + autorização + linha no banco)');
  let contractId: string | null = null;
  try {
    const r = await criarPixRecorrente({
      userId: null,
      email: EMAIL_TESTE,
      nome: 'Teste Sandbox SolarDoc',
      cpfCnpj: CPF_TESTE,
      whatsapp: '34999990000',
      planKey: 'ilimitado',
    });
    contractId = r.contractId;
    ok(`contrato criado no modo "${r.modo}" · ${r.contractId}`);
    info(`mensalidade R$ ${r.valor} · primeiro mês R$ ${r.primeiroMes} · status ${r.status}`);

    // RISCO 2 — o QR imediato volta preenchido?
    if (r.qrPayload) {
      ok(`QR do 1º mês veio (${r.qrPayload.length} caracteres)`);
      if (r.qrImagemBase64) ok('imagem do QR veio junto');
      else info('imagem do QR veio vazia — a tela mostra o copia-e-cola, que basta pra pagar.');
    } else {
      err('QR do 1º mês veio VAZIO — o cliente não teria como pagar a adesão pela tela.');
      info('É o risco anotado na doc: buscar o QR num segundo endpoint antes de ligar.');
    }
  } catch (e) {
    err(`criação falhou: ${(e as Error).message}`);
    info('Anote a mensagem: é ela que diz qual nome de campo o Asaas não aceitou.');
    process.exit(1);
  }

  // ── 4. RISCO 1: o startDate cobra duas vezes na adesão? ────────────────────
  titulo('4. startDate da recorrência (o risco de cobrar 2× na adesão)');
  let authorizationId: string | null = null;
  try {
    const lista = await asaasFetch<{ data?: Array<Record<string, unknown>> }>(
      `/pix/automatic/authorizations?limit=10`,
    );
    const minha = (lista.data ?? []).find((a) => String(a.contractId ?? '') === contractId);
    if (minha?.id) authorizationId = String(minha.id);
    if (!minha) {
      info('não achei a autorização na listagem (pode ser modo `assinatura` — aí não existe autorização).');
    } else {
      const start = String(minha.startDate ?? '');
      const hoje = new Date();
      const umMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
      const diff = Math.round((Date.parse(start) - hoje.getTime()) / 86400000);
      info(`startDate devolvido pelo Asaas: ${start} (esperado ~${umMes.toISOString().slice(0, 10)})`);
      if (diff >= 25) ok(`a 1ª cobrança recorrente é daqui a ${diff} dias — a adesão não é cobrada duas vezes`);
      else err(`a 1ª cobrança recorrente cai em ${diff} dias. PERIGO: o cliente pagaria o QR de adesão E a recorrência no mesmo mês.`);
    }
  } catch (e) {
    info(`não consegui reler a autorização (${(e as Error).message})`);
  }

  // ── 5. Limpeza ─────────────────────────────────────────────────────────────
  // O cancelarPixRecorrente do serviço é por userId (o cliente cancelando o
  // próprio contrato) e este teste roda sem usuário — então cancela direto na
  // API, pelo mesmo endpoint que ele usa.
  titulo('5. Limpeza');
  if (authorizationId) {
    try {
      await asaasFetch(`/pix/automatic/authorizations/${authorizationId}`, { method: 'DELETE' });
      ok('autorização de teste cancelada');
    } catch (e) {
      info(`não consegui cancelar (${(e as Error).message}) — cancele no painel do Asaas.`);
    }
  } else {
    info('nada pra cancelar via API (modo assinatura, ou autorização não localizada).');
    info(`Confira no painel do sandbox e apague o contrato ${contractId}.`);
  }

  // A linha do banco É de produção. Deixá-la aqui envenena o diagnóstico de
  // "tem contrato de Pix recorrente vivo?" com um contrato que nunca existiu.
  if (contractId) {
    const { error } = await supabase.from('asaas_pix_assinaturas').delete().eq('contract_id', contractId);
    if (error) err(`a linha de teste ${contractId} FICOU no banco — apague na mão: ${error.message}`);
    else ok('linha de teste removida do banco');
  }

  console.log('\nFim. O que estiver marcado ERRO acima tem que ser resolvido ANTES de ASAAS_ENV=prod.\n');
}

main().catch((e) => {
  console.error('\nO teste morreu:', e);
  process.exit(1);
});
