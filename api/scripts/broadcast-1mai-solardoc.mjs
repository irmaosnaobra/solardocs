// One-shot broadcast: mensagem do Dia do Trabalho pros usuários SolarDoc.
// Uso: node scripts/broadcast-1mai-solardoc.mjs
//
// Comportamento:
// - Pega users com whatsapp + sem opt-out
// - Personaliza com primeiro nome + sufixo rotacionado (anti-spam)
// - Dispara via Z-API instance solardoc (553499437831)
// - Cadência 9-13s aleatório (humanizado)
// - Idempotente: salva log local em broadcast-1mai-2026.log e pula quem já recebeu
//
// Reverter / pausar: Ctrl+C no terminal. Quem já recebeu fica no .log.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const LOG_PATH = path.resolve(process.cwd(), 'broadcast-1mai-2026.log');
const INSTANCE = 'solardoc';

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const Z_ID    = process.env.ZAPI_INSTANCE_ID?.trim();
const Z_TOKEN = process.env.ZAPI_TOKEN?.trim();
const Z_CLI   = (process.env.ZAPI_CLIENT_TOKEN_SOLARDOC || process.env.ZAPI_CLIENT_TOKEN)?.trim();

if (!SUPA_URL || !SUPA_KEY) { console.error('SUPABASE creds ausentes'); process.exit(1); }
if (!Z_ID || !Z_TOKEN || !Z_CLI) { console.error('Z-API creds ausentes'); process.exit(1); }

const supa = createClient(SUPA_URL, SUPA_KEY);

const SUFFIXES = [
  'Bom feriado pra você e sua equipe.',
  'Que esse 1º de Maio fortaleça ainda mais a sua jornada.',
  'Forte abraço da equipe SolarDoc.',
  'Bom feriado, parceiro.',
];

function fmtPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return null;
  return d.startsWith('55') ? d : `55${d}`;
}

function firstName(nome) {
  if (!nome) return '';
  return String(nome).trim().split(/\s+/)[0];
}

function buildMessage(nome, idx) {
  const first = firstName(nome);
  const suffix = SUFFIXES[idx % SUFFIXES.length];
  const head = first
    ? `${first}, parabéns a você que produz e é a engrenagem desse país!`
    : `Parabéns a você que produz e é a engrenagem desse país!`;
  return `${head} O empresário é mais que um trabalhador — é a locomotiva do Brasil. ${suffix}`;
}

function loadLog() {
  // Só pula quem já recebeu com SUCESSO. FAIL anterior será retentado.
  if (!fs.existsSync(LOG_PATH)) return new Set();
  return new Set(
    fs.readFileSync(LOG_PATH, 'utf8')
      .split('\n')
      .map(l => l.split('\t'))
      .filter(parts => parts[0] && parts[1] === 'OK')
      .map(parts => parts[0])
  );
}
function appendLog(phone, status, info) {
  fs.appendFileSync(LOG_PATH, `${phone}\t${status}\t${info ?? ''}\t${new Date().toISOString()}\n`);
}

async function sendZ(phone, message) {
  const res = await fetch(
    `https://api.z-api.io/instances/${Z_ID}/token/${Z_TOKEN}/send-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Client-Token': Z_CLI },
      body: JSON.stringify({ phone, message }),
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => `${res.status}`);
    throw new Error(`HTTP ${res.status} — ${txt}`);
  }
  const data = await res.json().catch(() => ({}));
  return data.messageId || data.zaapId || data.id || 'ok';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter() { return 9000 + Math.floor(Math.random() * 4000); } // 9-13s

(async () => {
  const { data: users, error } = await supa
    .from('users')
    .select('id, nome, whatsapp, whatsapp_opt_out, plano')
    .not('whatsapp', 'is', null)
    .neq('whatsapp', '');
  if (error) { console.error('Supa erro:', error); process.exit(2); }

  const eligible = (users || []).filter(u => !u.whatsapp_opt_out && fmtPhone(u.whatsapp));
  console.log(`[1mai] Total usuarios: ${users?.length ?? 0} | Elegíveis: ${eligible.length} | Instance: ${INSTANCE}`);

  const seen = loadLog();
  const todo = eligible.filter(u => !seen.has(fmtPhone(u.whatsapp)));
  console.log(`[1mai] Já enviados antes: ${eligible.length - todo.length} | A enviar agora: ${todo.length}`);

  let ok = 0, fail = 0;
  for (let i = 0; i < todo.length; i++) {
    const u = todo[i];
    const phone = fmtPhone(u.whatsapp);
    const msg = buildMessage(u.nome, i);
    try {
      const id = await sendZ(phone, msg);
      ok++;
      appendLog(phone, 'OK', id);
      console.log(`[${i+1}/${todo.length}] ✅ ${phone} (${u.nome || 'sem nome'}) — ${id}`);
    } catch (err) {
      fail++;
      appendLog(phone, 'FAIL', err.message);
      console.log(`[${i+1}/${todo.length}] ❌ ${phone} (${u.nome || 'sem nome'}) — ${err.message}`);
    }
    if (i < todo.length - 1) {
      const wait = jitter();
      await sleep(wait);
    }
  }

  console.log(`\n[1mai] FIM — ok=${ok} fail=${fail} log=${LOG_PATH}`);
})().catch(err => { console.error('Erro fatal:', err); process.exit(3); });
