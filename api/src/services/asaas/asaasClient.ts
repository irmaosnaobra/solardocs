// ─────────────────────────────────────────────────────────────────────────────
// Cliente HTTP do Asaas — camada FINA de propósito.
//
// Por que existe: o Pix recorrente do SolarDoc não pode sair pela Stripe. A conta
// da Aioros é BR (acct_1TKNGN…, country=BR) e a doc da Stripe diz, literalmente,
// "O Pix Automático não está disponível no Brasil"; conferido na conta em
// 08/08/2026, nem a capability `pix_payments` existe (pix.available=false no
// payment method configuration). Então o trilho recorrente sai por um PSP
// doméstico e o Stripe segue cuidando do cartão, intocado.
//
// Fina de propósito: nada aqui foi exercitado contra a API real (a conta Asaas
// ainda não existe). Se um nome de campo estiver errado, o conserto é de uma
// linha no chamador, não uma refatoração.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../utils/logger';

const TIMEOUT_MS = 15_000;

// Sandbox é o padrão SEGURO: sem ASAAS_ENV=prod ninguém cobra ninguém de verdade.
export function asaasBaseUrl(): string {
  const prod = (process.env.ASAAS_ENV || '').trim().toLowerCase() === 'prod';
  return prod ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
}

export function asaasApiKey(): string {
  return (process.env.ASAAS_API_KEY || '').trim();
}

// Rail inteiro fica DARK sem chave (ou com o kill-switch ligado): endpoints
// respondem "indisponível" em vez de estourar 500 no cliente.
export function asaasHabilitado(): boolean {
  if ((process.env.PIX_RECORRENTE_OFF || '').toLowerCase() === 'true') return false;
  return !!asaasApiKey();
}

export class AsaasError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
    this.name = 'AsaasError';
  }
}

// Erro do Asaas vem como { errors: [{ code, description }] } — extrai a primeira
// descrição, que é o que serve pra log e pra mensagem de tela.
function descreverErro(status: number, body: unknown): string {
  const errs = (body as { errors?: Array<{ code?: string; description?: string }> } | null)?.errors;
  const primeiro = errs?.[0];
  if (primeiro?.description) return `${primeiro.code ? primeiro.code + ': ' : ''}${primeiro.description}`;
  return `HTTP ${status}`;
}

export async function asaasFetch<T = unknown>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const key = asaasApiKey();
  if (!key) throw new AsaasError(503, 'ASAAS_API_KEY ausente — Pix recorrente está desligado');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${asaasBaseUrl()}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        // Nome do header confirmado na doc do Asaas: é `access_token`, não Bearer.
        access_token: key,
        'Content-Type': 'application/json',
        // O Asaas pede User-Agent identificável; sem ele a Cloudflare deles às
        // vezes barra a chamada.
        'User-Agent': 'SolarDoc/1.0 (solardoc.app)',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });

    const texto = await res.text();
    const json = texto ? JSON.parse(texto) : null;

    if (!res.ok) {
      const msg = descreverErro(res.status, json);
      logger.error('asaas', `${init.method ?? 'GET'} ${path} falhou — ${msg}`, json);
      throw new AsaasError(res.status, msg, json);
    }
    return json as T;
  } catch (err) {
    if (err instanceof AsaasError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new AsaasError(504, `Asaas não respondeu em ${TIMEOUT_MS / 1000}s`);
    }
    throw new AsaasError(502, `Falha de rede com o Asaas: ${(err as Error)?.message ?? 'desconhecida'}`);
  } finally {
    clearTimeout(timer);
  }
}
