// Sentry precisa subir ANTES de qualquer rota ou serviço ser importado — é assim
// que ele instrumenta o express, o http e o resto. Por isso este arquivo é o
// PRIMEIRO import do app.ts e carrega o dotenv por conta própria (o app.ts não
// chegou a rodar ainda quando isto executa).
import dotenv from 'dotenv';
dotenv.config();

import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

// Sem DSN o Sentry fica desligado e nada quebra: é o estado normal em dev e
// enquanto a chave não estiver na Vercel.
export const sentryAtivo = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    // Rastreio de performance desligado por padrão — consome cota rápido.
    // Liga com SENTRY_TRACES_SAMPLE_RATE=0.1 quando quiser medir latência.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    // Não manda IP nem cabeçalho de usuário sem a gente decidir isso.
    sendDefaultPii: false,
  });
}

/**
 * Na Vercel a instância CONGELA assim que a resposta sai. O transporte do Sentry
 * é assíncrono, então sem esvaziar aqui o erro morre no meio do caminho — o
 * clássico "funciona no dev e não chega nada em produção".
 */
export async function flushSentry(ms = 2000): Promise<void> {
  if (!dsn) return;
  try {
    await Sentry.flush(ms);
  } catch {
    // Telemetria nunca pode derrubar request.
  }
}

export { Sentry };
