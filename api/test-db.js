require('dotenv').config();
const { Pool } = require('pg');

// Teste 1: pooler com username postgres.ref (novo formato)
const pool1 = new Pool({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.qdpfwncyzuztibpujlbq',
  password: 'UgbP9qc0BbjUksrc',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});

// Teste 2: pooler com username só "postgres" (formato antigo)
const pool2 = new Pool({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres',
  password: 'UgbP9qc0BbjUksrc',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 8000,
});

async function test() {
  console.log('=== Teste 1: user=postgres.ref ===');
  try {
    const r = await pool1.query('SELECT current_user');
    console.log('✅ Teste 1 OK:', r.rows[0]);
  } catch (e) {
    console.error('❌ Teste 1 falhou:', e.message);
  }

  console.log('=== Teste 2: user=postgres ===');
  try {
    const r = await pool2.query('SELECT current_user');
    console.log('✅ Teste 2 OK:', r.rows[0]);
  } catch (e) {
    console.error('❌ Teste 2 falhou:', e.message);
  }
  process.exit(0);
}

test();
