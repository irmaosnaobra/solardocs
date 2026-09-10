// ─────────────────────────────────────────────────────────────────────────────
// UM lugar para nascer cliente de IA.
//
// Até 10/09/2026 havia 31 `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`
// espalhados por 29 arquivos. Cada um falava direto com a Anthropic, sem plano B.
// O efeito disso está registrado: em 07, 08 e 10/08/2026 o crédito zerou e TODOS
// os robôs emudeceram no mesmo minuto — Bia, Carla, SDR, gerador, LimpaPro. Não
// havia como trocar de provedor sem editar 29 arquivos e fazer deploy.
//
// Agora todo cliente nasce aqui. Trocar de rota é variável de ambiente, não deploy.
//
// ── AS DUAS ROTAS ──
// · Sem `AI_GATEWAY_API_KEY`: fala direto com a Anthropic, exatamente como antes.
//   Nada muda. É o padrão, e é o que roda hoje.
// · Com `AI_GATEWAY_API_KEY`: fala pelo AI Gateway da Vercel, que é compatível com
//   a API da Anthropic (mesmo `messages.create`, mesmo formato). O fallback entre
//   provedores passa a ser configuração no painel do Gateway — sem tocar em código.
//
// A chave: o `@anthropic-ai/sdk` aceita `baseURL`. Por isso dá pra ganhar o Gateway
// sem reescrever as 31 chamadas para outro SDK — o que seria um diff gigante em
// cima de todos os agentes de uma vez, exatamente o tipo de commit que já derrubou
// o build aqui.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';

/** Base do AI Gateway da Vercel, no modo compatível com a Anthropic. */
const GATEWAY_BASE = (process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/v1/anthropic').trim();

export type RotaIA = 'gateway' | 'direto';

/**
 * Qual rota está valendo agora. Serve para log e para o /admin mostrar a verdade
 * em vez de a gente adivinhar qual caminho a mensagem tomou.
 */
export function rotaIA(): RotaIA {
  return process.env.AI_GATEWAY_API_KEY ? 'gateway' : 'direto';
}

/**
 * Cria um cliente Anthropic já apontado para a rota vigente.
 *
 * @param apiKeyExplicita usada só por quem já recebia a chave de fora (rotas do
 *   /admin que aceitam chave por requisição). Quando vem preenchida, força a rota
 *   DIRETA — chave de terceiro não passa pelo nosso Gateway.
 */
export function novoAnthropic(apiKeyExplicita?: string): Anthropic {
  const explicita = (apiKeyExplicita || '').trim();
  if (explicita) {
    return new Anthropic({ apiKey: explicita });
  }

  const gw = (process.env.AI_GATEWAY_API_KEY || '').trim();
  if (gw) {
    return new Anthropic({ apiKey: gw, baseURL: GATEWAY_BASE });
  }

  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Diz se um erro de IA merece uma segunda tentativa por OUTRA rota.
 *
 * Reaproveita o vocabulário que já existe em `filaAlerta.classificarFalha`:
 * crédito zerado e limite/sobrecarga são as duas doenças que a troca de rota
 * resolve. Chave recusada não é: se a chave está errada, tentar de novo com a
 * mesma chave só gasta tempo.
 */
export function vaiAdiantarTrocarDeRota(erro: unknown): boolean {
  const e = String((erro as { message?: string })?.message ?? erro ?? '').toLowerCase();
  if (e.includes('credit balance is too low') || e.includes('billing')) return true;
  if (e.includes('rate_limit') || e.includes('overloaded') || e.includes('too many requests')) return true;
  if (/\b429\b/.test(e) || /\b529\b/.test(e)) return true;
  return false;
}
