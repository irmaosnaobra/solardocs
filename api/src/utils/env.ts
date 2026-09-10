// ─────────────────────────────────────────────────────────────────────────────
// O que a API precisa para não degradar em silêncio.
//
// São 207 variáveis de ambiente no `api/src`. Declarar as 207 aqui seria teatro:
// a maioria é interruptor de funcionalidade, e a ausência dela é justamente o
// desligado. O que dói é outra coisa — a variável CRÍTICA que falta e o código
// contorna com um fallback, deixando o sistema de pé mas mentindo.
//
// O padrão está escrito no nosso próprio MIGRATION_fechar_leitura_publica.sql:
// "com a chave publishable como fallback (assim um deploy sem a var não derruba
// nada)". Não derruba — e é esse o problema. A API segue como `anon`, ninguém vê,
// e o buraco de RLS continua aberto por semanas.
//
// Aqui as críticas são declaradas e conferidas no boot.
//
// ── COMO ISSO NÃO VIRA UM TIRO NO PÉ ──
// Por padrão o boot AVISA e segue. Só com `ENV_STRICT=true` ele derruba o processo.
// A ordem segura é: ligar o estrito em preview, ver passar, e só então em produção.
// Validação que derruba a API no primeiro deploy é validação que alguém arranca
// no dia seguinte.
// ─────────────────────────────────────────────────────────────────────────────

import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/** Descrição do que quebra quando cada uma falta — vai no aviso do boot. */
const O_QUE_QUEBRA: Record<string, string> = {
  DATABASE_URL: 'nada lê nem escreve no banco',
  JWT_SECRET: 'ninguém consegue logar no /gerador',
  ANTHROPIC_API_KEY: 'todos os robôs emudecem (07, 08 e 10/08/2026 foi isso)',
  SUPABASE_URL: 'fichas, agenda e propostas param',
  SUPABASE_SERVICE_KEY: 'a API cai para o papel anônimo e a RLS deixa de proteger',
  SUPABASE_GERADOR_SERVICE_KEY: 'o gerador segue como anon — o furo do MIGRATION continua aberto',
  STRIPE_SECRET_KEY: 'nenhum checkout é criado',
  ZAPI_INSTANCE_ID_IO: 'a linha do WhatsApp não envia',
  ZAPI_TOKEN_IO: 'a linha do WhatsApp não envia',
  ZAPI_CLIENT_TOKEN: 'a linha do WhatsApp não envia',
  DASHBOARD_URL: 'todo link que sai para o cliente aponta para o lugar errado',
  CRON_SECRET: 'os crons respondem 401 e Bia/SDR/dunning param',
  SENTRY_DSN: 'erro em produção só aparece quando um cliente reclama',
  AI_GATEWAY_API_KEY: 'sem rota alternativa de IA — crédito zerado volta a emudecer tudo',
};

/**
 * As críticas. Todas OPCIONAIS no schema de propósito: quem decide se a ausência
 * derruba é o `ENV_STRICT`, não o tipo. Assim o mesmo schema serve para conferir
 * sem quebrar e para exigir quando você quiser exigir.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url().optional(),
    JWT_SECRET: z.string().min(16).optional(),
    ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),
    OPENAI_API_KEY: z.string().optional(),
    AI_GATEWAY_API_KEY: z.string().optional(),
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_KEY: z.string().optional(),
    SUPABASE_GERADOR_SERVICE_KEY: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
    ZAPI_INSTANCE_ID_IO: z.string().optional(),
    ZAPI_TOKEN_IO: z.string().optional(),
    ZAPI_CLIENT_TOKEN: z.string().optional(),
    DASHBOARD_URL: z.string().url().optional(),
    CRON_SECRET: z.string().min(16).optional(),
    SENTRY_DSN: z.string().optional(),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // A validação de FORMATO nunca derruba sozinha — quem derruba é o relatório
  // abaixo, e só sob ENV_STRICT. Um `sk_` digitado errado vira aviso, não apagão.
  //
  // O aviso precisa DIZER QUAL variável: `String(erro)` num array de issues do zod
  // imprime "[object Object]" e não serve para nada às 2 da manhã.
  onValidationError: (issues) => {
    const lista = Array.isArray(issues) ? issues : [issues];
    for (const i of lista) {
      const nome = (i as { path?: unknown[] })?.path?.join('.') || '(sem nome)';
      const motivo = (i as { message?: string })?.message || String(i);
      console.warn(`[env] formato suspeito em ${nome}: ${motivo}`);
    }
    return undefined as never;
  },
});

/** As que, faltando, deixam o sistema de pé mentindo. */
const CRITICAS = [
  'DATABASE_URL', 'JWT_SECRET', 'ANTHROPIC_API_KEY', 'SUPABASE_URL',
  'STRIPE_SECRET_KEY', 'ZAPI_INSTANCE_ID_IO', 'ZAPI_TOKEN_IO', 'DASHBOARD_URL',
] as const;

/** As que não faltam para funcionar, mas cuja ausência é uma dívida conhecida. */
const DIVIDAS = [
  'SUPABASE_GERADOR_SERVICE_KEY', 'AI_GATEWAY_API_KEY', 'SENTRY_DSN', 'CRON_SECRET',
] as const;

export interface RelatorioEnv {
  faltando: string[];
  dividas: string[];
  ok: boolean;
}

/**
 * Confere e devolve o relatório. Não imprime nada — quem imprime é `verificarEnv`,
 * para que o teste possa chamar isto sem sujar a saída.
 */
export function conferirEnv(fonte: NodeJS.ProcessEnv = process.env): RelatorioEnv {
  const vazia = (k: string) => !String(fonte[k] ?? '').trim();
  const faltando = CRITICAS.filter(vazia);
  const dividas = DIVIDAS.filter(vazia);
  return { faltando, dividas, ok: faltando.length === 0 };
}

/**
 * Chamar uma vez no boot. Avisa sempre; derruba só com `ENV_STRICT=true`.
 */
export function verificarEnv(fonte: NodeJS.ProcessEnv = process.env): RelatorioEnv {
  const r = conferirEnv(fonte);

  for (const k of r.faltando) {
    console.error(`[env] FALTA ${k} — ${O_QUE_QUEBRA[k] ?? 'consequência não mapeada'}`);
  }
  for (const k of r.dividas) {
    console.warn(`[env] sem ${k} — ${O_QUE_QUEBRA[k] ?? 'consequência não mapeada'}`);
  }
  if (r.ok && !r.dividas.length) {
    console.log('[env] todas as variáveis críticas presentes.');
  }

  if (!r.ok && String(fonte.ENV_STRICT ?? '').toLowerCase() === 'true') {
    throw new Error(
      `[env] ENV_STRICT ligado e faltam ${r.faltando.length} variáveis críticas: ${r.faltando.join(', ')}`
    );
  }
  return r;
}
