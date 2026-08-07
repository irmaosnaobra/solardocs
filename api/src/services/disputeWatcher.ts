// ─────────────────────────────────────────────────────────────────────────────
// VIGIA DE CONTESTAÇÃO (chargeback) — trava de segurança.
//
// Regra do Thiago (07/08/2026): TODA contestação é defendida no dia em que
// aparece. O que motivou: a disputa du_1TtSmA (R$27, crislandio69) venceu com
// submission_count 0 — ninguém viu o prazo, nada foi enviado, e era a mais
// ganhável da conta (9 propostas geradas, uso ativo até depois do chargeback).
//
// Até aqui NADA no código escutava disputa: nem webhook, nem cron. A única
// vigilância era o badge de notificação no painel da Stripe. Este monitor troca
// isso por um e-mail com o dossiê já montado — quem é, quanto, quando vence e
// QUANTO A CONTA USOU o produto, que é o que decide contestar ou aceitar.
//
// Roda no /master (1×/dia, 11:30 UTC). Avisa 1× por disputa nova e volta a
// insistir quando faltam ≤3 dias pro prazo — aí não tem mais "deixa pra depois".
// Também avisa o aviso antecipado de fraude, que chega ANTES de virar disputa:
// estornar ali custa só a venda; virando disputa custa a venda + R$55 de taxa.
// ─────────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { sendOpsAlert } from '../utils/mailer';
import { logger } from '../utils/logger';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

const STATE_KEY = 'stripe_dispute_watch';
const URGENTE_DIAS = 3; // a partir daqui, reavisa todo dia até resolver

interface WatchState {
  avisadas?: Record<string, string>; // disputeId → ISO do último aviso
  efw?: string[];                    // ids de early fraud warning já avisados
}

async function loadState(): Promise<WatchState> {
  const { data } = await supabase.from('system_state').select('value').eq('key', STATE_KEY).maybeSingle();
  return (data?.value as WatchState) ?? {};
}
async function saveState(s: WatchState): Promise<void> {
  await supabase.from('system_state').upsert(
    { key: STATE_KEY, value: s, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
}

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
const dia = (ts: number) => new Date(ts * 1000).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/**
 * O que a conta desse e-mail fez na plataforma. É a evidência que ganha disputa
 * de "não autorizei": titularidade (conta antiga, CNPJ no nome do titular) e uso
 * (documento gerado, login DEPOIS da contestação).
 */
async function dossieDoCliente(email: string | null | undefined): Promise<string> {
  if (!email) return '<p><em>Sem e-mail na cobrança — procurar pelo Customer no painel.</em></p>';

  const { data: u } = await supabase
    .from('users')
    .select('id, email, created_at, plano, documentos_usados')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();

  if (!u) {
    return `<p style="color:#b91c1c;"><strong>Não existe conta com esse e-mail no banco.</strong>
      Comprou e nunca criou conta — evidência de uso é zero. Nesse caso aceitar costuma ser mais barato que brigar.</p>`;
  }

  const [{ count: docs }, { count: eventos }, { data: empresa }] = await Promise.all([
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', u.id),
    supabase.from('feature_events').select('id', { count: 'exact', head: true }).eq('user_id', u.id),
    supabase.from('company').select('nome, cnpj, cidade').eq('user_id', u.id).maybeSingle(),
  ]);

  const { data: ultimo } = await supabase
    .from('documents').select('created_at').eq('user_id', u.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  const forte = (docs ?? 0) > 0 || !!empresa?.cnpj;

  return `<ul style="margin:0 0 4px;padding-left:18px;">
      <li>Conta criada em <strong>${new Date(u.created_at).toLocaleDateString('pt-BR')}</strong></li>
      <li><strong>${docs ?? 0}</strong> documento(s) gerado(s)${ultimo ? ` — último em ${new Date(ultimo.created_at).toLocaleDateString('pt-BR')}` : ''}</li>
      <li><strong>${eventos ?? 0}</strong> uso(s) de ferramenta registrado(s)</li>
      <li>Empresa cadastrada: ${empresa?.nome ? `<strong>${empresa.nome}</strong> — CNPJ ${empresa.cnpj || '—'} — ${empresa.cidade || '—'}` : '<em>nenhuma</em>'}</li>
    </ul>
    <p style="margin:6px 0 0;">${forte
      ? '<strong style="color:#15803d;">Tem material pra contestar.</strong> Se o CNPJ cadastrado for do próprio titular do cartão, a alegação de "não autorizei" cai sozinha.'
      : '<strong style="color:#b45309;">Evidência fraca</strong> — sem documento gerado e sem CNPJ. Aceitar pode sair mais barato que o tempo gasto.'}</p>`;
}

export async function runDisputeWatch(): Promise<{ abertas: number; avisadas: number; efw: number }> {
  if (!process.env.STRIPE_SECRET_KEY) return { abertas: 0, avisadas: 0, efw: 0 };

  const st = await loadState();
  const avisadas = { ...(st.avisadas ?? {}) };
  const efwVistos = new Set(st.efw ?? []);
  let novosAvisos = 0;
  let novosEfw = 0;

  // ── 1. Disputas esperando resposta ─────────────────────────────────────────
  // `any` como no resto do repo: os tipos nomeados do SDK não são exportados nesta versão.
  let abertas: any[] = [];
  try {
    const r = await stripe.disputes.list({ limit: 100, expand: ['data.charge'] });
    abertas = r.data.filter((d) => d.status === 'needs_response' || d.status === 'warning_needs_response');
  } catch (err) {
    logger.error('dispute-watch', 'listar disputas falhou', err);
    return { abertas: 0, avisadas: 0, efw: 0 };
  }

  const agora = Date.now();
  for (const d of abertas) {
    const dueMs = (d.evidence_details?.due_by ?? 0) * 1000;
    const diasRestantes = dueMs ? Math.floor((dueMs - agora) / 86_400_000) : 99;
    const urgente = diasRestantes <= URGENTE_DIAS;
    const jaAvisou = avisadas[d.id];
    // Aviso novo sempre; depois disso só volta a insistir na reta final (1×/dia).
    if (jaAvisou && !urgente) continue;
    if (jaAvisou && urgente && new Date(jaAvisou).toDateString() === new Date().toDateString()) continue;

    const charge = d.charge as any;
    const email = typeof charge === 'object' ? charge?.billing_details?.email : null;
    const nome = typeof charge === 'object' ? charge?.billing_details?.name : null;

    await sendOpsAlert(
      `${urgente ? '🚨 PRAZO ESTOURANDO' : '⚠️ Nova contestação'} — ${brl(d.amount)} (${nome || email || d.id})`,
      `<p>O cliente contestou uma cobrança. <strong>A regra é defender no mesmo dia.</strong></p>
       <table style="border-collapse:collapse;font-size:14px;margin:0 0 14px;">
         <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Valor</td><td><strong>${brl(d.amount)}</strong></td></tr>
         <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Cliente</td><td>${nome || '—'} &lt;${email || '—'}&gt;</td></tr>
         <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Motivo alegado</td><td>${d.reason}</td></tr>
         <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Prazo</td><td><strong style="color:${urgente ? '#b91c1c' : '#0f172a'};">${dueMs ? dia(d.evidence_details!.due_by!) : '—'}${dueMs ? ` (${diasRestantes} dia(s))` : ''}</strong></td></tr>
         <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Disputa</td><td><code>${d.id}</code></td></tr>
       </table>
       <p style="margin:0 0 4px;"><strong>O que essa conta fez na plataforma:</strong></p>
       ${await dossieDoCliente(email)}
       <p style="margin:14px 0 0;">Custa <strong>${brl(d.amount + 5500)}</strong> se perder — o valor mais a taxa de disputa, que é cobrada mesmo se você aceitar.</p>
       <p style="margin:8px 0 0;"><a href="https://dashboard.stripe.com/disputes/${d.id}">Abrir no painel da Stripe</a> · roteiro e textos prontos em <code>CONTESTACOES-STRIPE.md</code></p>
       <p style="color:#b45309;margin:10px 0 0;font-size:13px;">Ao responder pela API, mandar <code>submit=false</code> explícito pra salvar rascunho: o padrão da Stripe é <code>true</code> e submete de primeira, e a disputa aceita UMA submissão só.</p>`,
    ).catch((err) => logger.error('dispute-watch', `email da disputa ${d.id} falhou`, err));

    avisadas[d.id] = new Date().toISOString();
    novosAvisos++;
  }

  // ── 2. Aviso antecipado de fraude — chega ANTES de virar disputa ───────────
  // Estornar aqui custa só a venda. Deixar virar disputa custa venda + R$55.
  try {
    const efw = await stripe.radar.earlyFraudWarnings.list({ limit: 50, expand: ['data.charge'] });
    for (const w of efw.data) {
      if (efwVistos.has(w.id)) continue;
      const charge = w.charge as any;
      // Já virou disputa? o bloco de cima cuida.
      if (typeof charge === 'object' && charge?.disputed) { efwVistos.add(w.id); continue; }
      if (typeof charge === 'object' && charge?.refunded) { efwVistos.add(w.id); continue; }

      const email = typeof charge === 'object' ? charge?.billing_details?.email : null;
      const valor = typeof charge === 'object' ? charge?.amount ?? 0 : 0;

      await sendOpsAlert(
        `🟡 Aviso antecipado de fraude — ${brl(valor)} (${email || w.id})`,
        `<p>A bandeira sinalizou essa cobrança como fraude <strong>antes</strong> de virar contestação. É a janela barata: estornar agora custa ${brl(valor)}; virar disputa custa ${brl(valor + 5500)}.</p>
         <p><strong>O que essa conta fez na plataforma:</strong></p>
         ${await dossieDoCliente(email)}
         <p style="margin:14px 0 0;"><a href="https://dashboard.stripe.com/payments/${typeof charge === 'object' ? charge?.payment_intent : ''}">Abrir a cobrança no painel</a></p>`,
      ).catch((err) => logger.error('dispute-watch', `email do EFW ${w.id} falhou`, err));

      efwVistos.add(w.id);
      novosEfw++;
    }
  } catch (err) {
    logger.error('dispute-watch', 'listar avisos antecipados falhou', err);
  }

  // Só guarda o que ainda está aberto — senão o estado cresce pra sempre.
  const idsAbertos = new Set(abertas.map((d) => d.id));
  const limpo: Record<string, string> = {};
  for (const [id, quando] of Object.entries(avisadas)) if (idsAbertos.has(id)) limpo[id] = quando;

  await saveState({ avisadas: limpo, efw: [...efwVistos].slice(-200) });

  if (novosAvisos || novosEfw) {
    logger.info('dispute-watch', `${abertas.length} disputa(s) aberta(s) · ${novosAvisos} aviso(s) · ${novosEfw} aviso(s) antecipado(s)`);
  }
  return { abertas: abertas.length, avisadas: novosAvisos, efw: novosEfw };
}
