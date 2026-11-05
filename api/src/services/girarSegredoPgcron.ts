// TEMPORÁRIO (troca de segredos de 03/11): troca, dentro do SQL, o valor velho do CRON_SECRET pelo novo no
// cron.job (e no Vault, se estiver lá). Os valores só trafegam como parâmetro de query; o comando dos jobs
// nunca chega ao JS e nada do que sai daqui (resultado, erro) carrega velho ou novo. Remover com a rota.

export interface ClientPg {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  release(): void;
}
export interface PoolPg {
  connect(): Promise<ClientPg>;
}

export interface JobCasado {
  jobid: number;
  jobname: string | null;
  schedule: string;
  active: boolean;
  url: string | null;
}

export interface ResultadoGiro {
  aplicado: boolean;
  papel: string;
  banco: string;
  visiveis: number;
  casaram: JobCasado[];
  vault: number | null;
  vaultCodigo?: string | null;
  restantesComVelho: number;
  comNovo: number;
}

const TAMANHO_MINIMO = 32;

function validar(velho: unknown, novo: unknown): asserts velho is string {
  if (typeof velho !== 'string' || typeof novo !== 'string' || !velho || !novo) {
    throw new Error('segredo velho e novo são obrigatórios');
  }
  if (velho === novo) throw new Error('segredo velho e novo são iguais');
  if (velho.length < TAMANHO_MINIMO || novo.length < TAMANHO_MINIMO) {
    throw new Error('segredo curto demais para trocar');
  }
}

const SQL_CASAM = String.raw`select jobid, jobname, schedule, active, substring(command from 'https?://[^''"\s?]+') as url from cron.job where position($1 in command) > 0 order by jobid`;
const SQL_CONTA_CRON = 'select count(*)::int as n from cron.job where position($1 in command) > 0';

export async function girarSegredoPgcron(
  pool: PoolPg,
  { velho, novo, aplicar }: { velho: string; novo: string; aplicar: boolean },
): Promise<ResultadoGiro> {
  validar(velho, novo);
  const client = await pool.connect();
  try {
    await client.query('begin');

    const quem = (await client.query('select current_user as papel, current_database() as banco')).rows[0] ?? {};
    const visiveis = Number((await client.query('select count(*)::int as visiveis from cron.job')).rows[0]?.visiveis ?? 0);
    const casaram: JobCasado[] = (await client.query(SQL_CASAM, [velho])).rows.map((r: any) => ({
      jobid: Number(r.jobid),
      jobname: r.jobname ?? null,
      schedule: String(r.schedule),
      active: Boolean(r.active),
      url: r.url ?? null,
    }));

    let vault: number | null = null;
    let vaultCodigo: string | null | undefined;
    await client.query('savepoint v');
    try {
      vault = Number((await client.query('select count(*)::int as n from vault.decrypted_secrets where decrypted_secret = $1', [velho])).rows[0]?.n ?? 0);
      await client.query('release savepoint v');
    } catch (e: any) {
      await client.query('rollback to savepoint v');
      vault = null;
      vaultCodigo = e?.code ?? null;
    }

    if (aplicar) {
      for (const j of casaram) {
        await client.query(
          'select cron.alter_job($1::bigint, command := (select replace(command, $2, $3) from cron.job where jobid = $1))',
          [j.jobid, velho, novo],
        );
      }
      if (vault !== null && vault > 0) {
        await client.query('savepoint v2');
        try {
          await client.query('select vault.update_secret(id, $2) from vault.decrypted_secrets where decrypted_secret = $1', [velho, novo]);
          await client.query('release savepoint v2');
        } catch (e: any) {
          await client.query('rollback to savepoint v2');
          vault = null;
          vaultCodigo = e?.code ?? null;
        }
      }
    }

    const restantesComVelho = Number((await client.query(SQL_CONTA_CRON, [velho])).rows[0]?.n ?? 0);
    if (aplicar && restantesComVelho > 0) throw new Error('sobrou job com o valor velho');
    const comNovo = Number((await client.query(SQL_CONTA_CRON, [novo])).rows[0]?.n ?? 0);

    await client.query(aplicar ? 'commit' : 'rollback');

    const r: ResultadoGiro = {
      aplicado: aplicar,
      papel: String(quem.papel ?? ''),
      banco: String(quem.banco ?? ''),
      visiveis,
      casaram,
      vault,
      restantesComVelho,
      comNovo,
    };
    if (vaultCodigo !== undefined) r.vaultCodigo = vaultCodigo;
    return r;
  } catch (e) {
    try { await client.query('rollback'); } catch { /* conexão já caiu: nada a desfazer */ }
    throw e;
  } finally {
    client.release();
  }
}
