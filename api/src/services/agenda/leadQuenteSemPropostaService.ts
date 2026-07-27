// ─────────────────────────────────────────────────────────────────────────────
// ALERTA: lead QUENTE sem proposta há +48h.
//
// O lead marcado temperatura='quente' é o mais perto de fechar. Se passa de 48h
// sem NENHUMA proposta gerada, está apodrecendo por falta de um toque. Este job
// avisa o CONSULTOR DONO (1×, dedup por lead) pra mandar a proposta antes de esfriar.
//
// DARK por padrão: no-op enquanto ALERTA_LEAD_QUENTE_ENABLED != 'true'. É um toque
// ao VENDEDOR — o Thiago já desligou pings de vendedor antes ([[gerador-lembrete-vendedor-off]]),
// então fica OFF até ele optar por ligar. Uma vez por lead (marker no system_state);
// se o lead ganhar proposta depois, some da lista sozinho.
//
// Espelha reagendarDigest.ts: mesmo telKey, mesmo mapa de consultores→whatsapp,
// mesmo envio pela linha 'io', mesma opção dry pra conferência sem enviar.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { sendWhatsApp } from '../agents/zapiClient';
import { logger } from '../../utils/logger';

const INSTANCE = 'io' as const;
const CRM_BASE_URL = 'https://solardoc.app/gerador';
const HORAS_LIMITE = 48;
const STATUS_PERDIDO = new Set(['cancelado', 'sem_interesse']);

function ligado(): boolean {
  return (process.env.ALERTA_LEAD_QUENTE_ENABLED || '').trim() === 'true';
}

// Mesma chave do CRM/reagendarDigest: dígitos, tira 55, DDD + últimos 8.
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}
function primeiroNome(nome: string): string {
  return (nome || '').trim().split(/\s+/)[0] || '';
}

type Ag = {
  id: number; vendedor_nome: string; cliente_nome: string; cliente_telefone: string | null;
  cidade: string | null; status: string; temperatura: string | null; created_at: string;
};
type Prop = { vendido: boolean | null; dados: any };
type Cand = { tk: string; nome: string; cidade: string | null; consultor: string };

export async function runAlertaLeadQuenteSemProposta(opts: { dry?: boolean } = {}): Promise<{
  enviados: number; total?: number; erros?: number; reason?: string; dry?: boolean;
  preview?: Record<string, { nome: string; cidade: string | null }[]>;
}> {
  const dry = !!opts.dry;
  if (!ligado() && !dry) return { enviados: 0, reason: 'desligado' };

  const [{ data: ags, error: e1 }, { data: props, error: e2 }] = await Promise.all([
    supabaseGerador
      .from('agendamentos')
      .select('id, vendedor_nome, cliente_nome, cliente_telefone, cidade, status, temperatura, created_at'),
    supabaseGerador.from('propostas').select('vendido, dados'),
  ]);
  if (e1) { logger.error('alerta-lead-quente', 'falha ao listar agendamentos', e1); return { enviados: 0, reason: 'erro_busca' }; }
  if (e2) logger.error('alerta-lead-quente', 'falha ao listar propostas (segue com o que tem)', e2);

  // telKeys que JÁ têm proposta (qualquer) → não entram.
  const comProposta = new Set<string>();
  for (const p of (props || []) as Prop[]) {
    const k = telKey(p?.dados?.telefoneDigitos || p?.dados?.telefone);
    if (k) comProposta.add(k);
  }

  // Agrupa agendamentos por telefone (avalia o cliente como um todo).
  const porTel = new Map<string, Ag[]>();
  for (const a of (ags || []) as Ag[]) {
    const k = telKey(a.cliente_telefone);
    if (!k) continue;
    if (!porTel.has(k)) porTel.set(k, []);
    porTel.get(k)!.push(a);
  }

  const agora = Date.now();
  const candidatos: Cand[] = [];
  for (const [tk, lista] of porTel) {
    if (comProposta.has(tk)) continue;                       // já tem proposta
    if (lista.some((a) => STATUS_PERDIDO.has(a.status))) continue; // perdido
    const quentes = lista.filter((a) => a.temperatura === 'quente');
    if (!quentes.length) continue;
    const recente = quentes.reduce((m, a) => (new Date(a.created_at) > new Date(m.created_at) ? a : m), quentes[0]);
    if (agora - new Date(recente.created_at).getTime() < HORAS_LIMITE * 3600 * 1000) continue; // ainda dentro das 48h
    candidatos.push({ tk, nome: recente.cliente_nome, cidade: recente.cidade, consultor: recente.vendedor_nome || '(sem consultor)' });
  }
  if (!candidatos.length) return { enviados: 0, total: 0, reason: 'nada' };

  // Dedup: 1 alerta por lead (marker no system_state). Se já alertado, pula.
  const keys = candidatos.map((c) => `alerta_lead_quente:${c.tk}`);
  const { data: jaAlertados } = await supabase.from('system_state').select('key').in('key', keys);
  const alertadosSet = new Set((jaAlertados || []).map((r: { key: string }) => r.key));
  const novos = candidatos.filter((c) => !alertadosSet.has(`alerta_lead_quente:${c.tk}`));
  if (!novos.length) return { enviados: 0, total: candidatos.length, reason: 'todos_ja_alertados' };

  const porConsultor = new Map<string, Cand[]>();
  for (const c of novos) {
    if (!porConsultor.has(c.consultor)) porConsultor.set(c.consultor, []);
    porConsultor.get(c.consultor)!.push(c);
  }

  if (dry) {
    const preview: Record<string, { nome: string; cidade: string | null }[]> = {};
    for (const [k, v] of porConsultor) preview[k] = v.map((x) => ({ nome: x.nome, cidade: x.cidade }));
    return { enviados: 0, total: novos.length, dry: true, preview };
  }

  const { data: cons } = await supabaseGerador.from('consultores').select('nome, whatsapp');
  const wpp = new Map<string, string>();
  for (const c of (cons || []) as { nome: string; whatsapp: string | null }[]) if (c.whatsapp) wpp.set(c.nome, c.whatsapp);

  let enviados = 0, erros = 0;
  for (const [consultor, leads] of porConsultor) {
    const to = wpp.get(consultor);
    if (!to) { logger.error('alerta-lead-quente', 'consultor sem whatsapp', { consultor }); erros++; continue; }
    const linhas = leads.slice(0, 20).map((l, i) => `${i + 1}. *${primeiroNome(l.nome) || l.nome || 'Cliente'}*${l.cidade ? ` · ${l.cidade}` : ''}`);
    const extra = leads.length > 20 ? `\n…e mais ${leads.length - 20}.` : '';
    const msg =
      `🔥 *Lead quente sem proposta* — ${primeiroNome(consultor) || consultor}\n\n` +
      `Você tem *${leads.length}* lead(s) marcados como QUENTES que já passaram de 48h e seguem *sem proposta*. ` +
      `É o público mais perto de fechar:\n\n` +
      linhas.join('\n') + extra + `\n\n` +
      `Manda a proposta antes de esfriar 👇\n${CRM_BASE_URL}?crm=quentes&consultor=${encodeURIComponent(consultor)}`;
    try {
      await sendWhatsApp(to, msg, INSTANCE);
      enviados++;
      const rows = leads.map((l) => ({
        key: `alerta_lead_quente:${l.tk}`,
        value: { alerted_at: new Date().toISOString(), consultor },
        updated_at: new Date().toISOString(),
      }));
      await supabase.from('system_state').upsert(rows, { onConflict: 'key' });
    } catch (e) {
      logger.error('alerta-lead-quente', 'envio falhou', { consultor, erro: String(e) });
      erros++;
    }
  }
  return { enviados, total: novos.length, erros };
}
