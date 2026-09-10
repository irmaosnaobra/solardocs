// ─────────────────────────────────────────────────────────────────────────────
// Fila de WhatsApp em Postgres — CONSTRUÍDA E DESLIGADA.
//
// A fila viva hoje é a tabela `wa_mensagens` no Supabase, varrida pelo tick de
// 5 min do whatsappAgentService. Ela funciona, mas tem um limite conhecido:
// retenta por 45 min e desiste. Quem caiu nessa janela nunca mais é tocado, e o
// alerta agregado do filaAlerta existe justamente porque isso acontece em lote.
//
// O pg-boss resolve isso com retry exponencial, agendamento e visibilidade de
// job — no MESMO Postgres, sem Redis novo e sem serviço novo.
//
// ── POR QUE ISTO NASCE DESLIGADO ──
// Esta fila carrega entrega de mensagem para lead real, numa linha que já foi
// bloqueada 3× (01–03/ago, 04–06/ago, 30/ago). Trocar o transporte junto com um
// lote de outras mudanças é exatamente como se derruba produção sem saber qual
// peça foi. Então: o caminho antigo continua intacto e é o que roda. Este só
// acorda com `FILA_PGBOSS=true`, e a virada é uma decisão sua, num commit só dela.
//
// O que já está pronto aqui: conexão preguiçosa, política de retry, teto de
// tentativas e o mesmo vocabulário de causa do filaAlerta.
// ─────────────────────────────────────────────────────────────────────────────

import { PgBoss } from 'pg-boss';
import { logger } from '../../../utils/logger';

export const FILA_ENVIO = 'whatsapp-envio';

export interface TarefaEnvio {
  telefone: string;
  texto: string;
  /** De qual robô veio — serve para o alerta agregado saber a origem. */
  origem?: string;
  /** Id da linha em `wa_mensagens`, para conciliar durante a transição. */
  refId?: string;
}

let boss: PgBoss | null = null;

/** A fila só existe se alguém ligou o interruptor. */
export function pgBossLigado(): boolean {
  return String(process.env.FILA_PGBOSS ?? '').toLowerCase() === 'true';
}

/**
 * Sobe o pg-boss na primeira chamada. Devolve `null` quando desligado — assim
 * quem chama não precisa de `if` espalhado, só tratar o nulo como "usa o antigo".
 */
export async function obterBoss(): Promise<PgBoss | null> {
  if (!pgBossLigado()) return null;
  if (boss) return boss;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.warn('filaPgBoss', 'FILA_PGBOSS=true mas sem DATABASE_URL — seguindo pela fila antiga');
    return null;
  }

  const b = new PgBoss({
    connectionString,
    // Schema próprio: as tabelas do pg-boss não se misturam com as nossas.
    schema: 'fila',
    // A Vercel congela a instância; pool curto evita conexão pendurada.
    max: Number(process.env.FILA_PGBOSS_POOL || 4),
  });

  b.on('error', (e: unknown) => logger.error('filaPgBoss', 'erro na fila', String((e as Error)?.message ?? e)));

  await b.start();
  boss = b;
  logger.info('filaPgBoss', 'fila em Postgres no ar (schema "fila")');
  return boss;
}

/**
 * Enfileira um envio.
 *
 * Retorna `null` quando a fila está desligada — o chamador segue pelo caminho
 * antigo. É esse retorno que permite ligar em preview sem tocar em produção.
 */
export async function enfileirarEnvio(tarefa: TarefaEnvio): Promise<string | null> {
  const b = await obterBoss();
  if (!b) return null;

  return b.send(FILA_ENVIO, tarefa, {
    // 6 tentativas com espera dobrando a partir de 30s cobre ~30 min de
    // instabilidade — sem a desistência seca dos 45 min de hoje.
    retryLimit: Number(process.env.FILA_PGBOSS_TENTATIVAS || 6),
    retryDelay: Number(process.env.FILA_PGBOSS_ESPERA_S || 30),
    retryBackoff: true,
    // Teto da espera: sem isso o backoff exponencial vira horas entre tentativas.
    retryDelayMax: Number(process.env.FILA_PGBOSS_ESPERA_MAX_S || 900),
    // Job que ficou preso volta para a fila em vez de sumir pendurado.
    expireInSeconds: Number(process.env.FILA_PGBOSS_EXPIRA_S || 3600),
  });
}

/**
 * Liga o consumidor. `entregar` é a função que realmente fala com a Z-Api —
 * injetada de fora justamente para este módulo não conhecer o transporte e
 * poder ser testado sem rede.
 */
export async function consumirEnvios(
  entregar: (t: TarefaEnvio) => Promise<void>
): Promise<boolean> {
  const b = await obterBoss();
  if (!b) return false;

  await b.work<TarefaEnvio>(
    FILA_ENVIO,
    { batchSize: Number(process.env.FILA_PGBOSS_LOTE || 1) },
    async (jobs: { data: TarefaEnvio }[]) => {
      for (const job of jobs) {
        await entregar(job.data);
      }
    }
  );
  logger.info('filaPgBoss', 'consumidor ligado em ' + FILA_ENVIO);
  return true;
}

/** Fecha a conexão. Usado no encerramento e nos testes. */
export async function pararBoss(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true });
  boss = null;
}
