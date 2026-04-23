import { supabase } from './supabase';

type LogLevel = 'error' | 'warn' | 'info';

interface LogEntry {
  level: LogLevel;
  context: string;
  message: string;
  detail?: unknown;
}

async function writeLog(entry: LogEntry): Promise<void> {
  try {
    await supabase.from('error_logs').insert({
      level: entry.level,
      context: entry.context,
      message: entry.message,
      detail: entry.detail ?? null,
      created_at: new Date().toISOString(),
    });
  } catch {
    // fallback silencioso — nunca deixa o logger quebrar a aplicação
  }
}

export const logger = {
  error(context: string, message: string, detail?: unknown): void {
    console.error(`[${context}] ${message}`, detail ?? '');
    writeLog({ level: 'error', context, message, detail }).catch(() => {});
  },
  warn(context: string, message: string, detail?: unknown): void {
    console.warn(`[${context}] ${message}`, detail ?? '');
    writeLog({ level: 'warn', context, message, detail }).catch(() => {});
  },
  info(context: string, message: string, detail?: unknown): void {
    console.log(`[${context}] ${message}`, detail ?? '');
  },
};
