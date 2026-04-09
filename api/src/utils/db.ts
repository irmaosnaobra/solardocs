import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// pg-connection-string tem um bug: trunca username no "." (formato Supabase pooler)
// Solução: parsear a DATABASE_URL manualmente com regex e passar parâmetros individuais
function parseDbUrl(url: string) {
  const match = url.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/);
  if (!match) throw new Error('DATABASE_URL inválida');
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: parseInt(match[4]),
    database: match[5],
  };
}

const dbConfig = parseDbUrl(process.env.DATABASE_URL!);

const pool = new Pool({
  ...dbConfig,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Database pool error:', err.message);
});

export default pool;
