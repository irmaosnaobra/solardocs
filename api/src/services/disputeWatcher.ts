// ─────────────────────────────────────────────────────────────────────────────
// VIGIA DE CONTESTAÇÃO (chargeback) + DEFESA AUTOMÁTICA.
//
// Regra do Thiago (07/08/2026): TODA contestação é defendida. O que motivou: a
// disputa du_1TtSmA (R$27, crislandio69) venceu com submission_count 0 — ninguém
// viu o prazo, nada foi enviado, e era a mais ganhável da conta (9 propostas
// geradas, uso ativo até depois do chargeback). A conta chegou a 11 perdidas em 11.
//
// Até 27/10/2026 este monitor só mandava e-mail. Agora, passadas 48h da abertura
// (ou com o prazo curto), ele ENVIA a defesa sozinho: `disputeDefesa.ts` decide e
// monta o texto (funções puras); aqui fica só o I/O (banco, Stripe, e-mail).
//
// A Stripe aceita UMA submissão por disputa. Por isso:
//   - `submit: true` é explícito e só existe no ramo `enviar`;
//   - o que manda é o submission_count da Stripe, não o nosso estado;
//   - duplicada (cobrança em dobro), rascunho salvo à mão e conta sem uso NUNCA
//     são defendidos: o dono recebe e-mail dizendo por quê.
// Freio de emergência: DISPUTA_AUTO_OFF=1 na Vercel (o aviso por e-mail continua).
//
// Roda no /master, que dispara de hora em hora (GitHub Actions) e também pelo cron
// da Vercel, então duas rodadas podem coincidir: o envio usa idempotencyKey com o
// dia. Avisa 1× por disputa nova e volta a insistir (1×/dia) quando faltam ≤3 dias
// pro prazo. Também avisa o aviso antecipado de
// fraude, que chega ANTES de virar disputa: estornar ali custa só a venda;
// virando disputa custa a venda + R$55 de taxa.
// ─────────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { sendOpsAlert } from '../utils/mailer';
import { logger } from '../utils/logger';
import {
  CtxDefesa, CobrancaResumo, AssinaturaResumo, DecisaoDefesa,
  autoOffLigado, dataDaDefesa, decidirDefesa, diaBR, isoDiaBR, docMs, mascararPrevia, montarEvidencia,
} from './disputeDefesa';

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());

const STATE_KEY = 'stripe_dispute_watch';
const URGENTE_DIAS = 3; // a partir daqui, reavisa todo dia até resolver

interface AutoRegistro { acao: string; quando: string }
interface WatchState {
  avisadas?: Record<string, string>;   // disputeId → ISO do último aviso
  auto?: Record<string, AutoRegistro>; // disputeId → o que a defesa automática fez
  efw?: string[];                      // ids de early fraud warning já avisados
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
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── dados da conta (banco) ───────────────────────────────────────────────────

interface DadosConta {
  conta: CtxDefesa['conta'];
  empresa: CtxDefesa['empresa'];
  docs: CtxDefesa['docs'];
  eventos: CtxDefesa['eventos'];
}

/** O que a conta desse e-mail fez na plataforma. Só busca; quem desenha é `htmlDossie`. */
async function buscarDadosConta(email: string): Promise<DadosConta> {
  const vazio: DadosConta = {
    conta: null, empresa: null,
    docs: { total: 0, primeiro: null, rows: [] },
    eventos: { total: 0, ultimo: null },
  };
  const { data: u, error: eUser } = await supabase
    .from('users')
    .select('id, email, created_at, plano, documentos_usados')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (eUser) throw new Error(`banco: users falhou (${eUser.message})`);
  if (!u) return vazio;

  const [rDocs, rEventos, rEmpresa, rRows, rPrimeiro, rUltimoEvento] = await Promise.all([
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', u.id),
    supabase.from('feature_events').select('id', { count: 'exact', head: true }).eq('user_id', u.id),
    supabase.from('company').select('nome, cnpj, cidade').eq('user_id', u.id).limit(1).maybeSingle(),
    supabase.from('documents').select('created_at, tipo').eq('user_id', u.id)
      .order('created_at', { ascending: false }).limit(1000),
    supabase.from('documents').select('created_at').eq('user_id', u.id)
      .order('created_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('feature_events').select('created_at').eq('user_id', u.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  // A defesa é uma submissão só: contagem que falha NÃO pode virar "0 documentos".
  // Qualquer erro aqui lança e a rodada cai no caminho FALHOU, nunca no `enviar`.
  const falhas: Array<[string, any]> = [
    ['documents (contagem)', rDocs.error], ['feature_events (contagem)', rEventos.error],
    ['company', rEmpresa.error], ['documents (lista)', rRows.error],
    ['documents (primeiro)', rPrimeiro.error], ['feature_events (último)', rUltimoEvento.error],
  ];
  for (const [tabela, erro] of falhas) if (erro) throw new Error(`banco: ${tabela} falhou (${erro.message})`);

  return {
    conta: { id: u.id, email: u.email, created_at: u.created_at, plano: u.plano },
    empresa: rEmpresa.data ?? null,
    docs: { total: rDocs.count ?? 0, primeiro: rPrimeiro.data?.created_at ?? null, rows: (rRows.data ?? []) as any[] },
    eventos: { total: rEventos.count ?? 0, ultimo: rUltimoEvento.data?.created_at ?? null },
  };
}

/**
 * Evidência que ganha disputa de "não autorizei": titularidade (conta antiga,
 * CNPJ no nome do titular) e uso (documento gerado, login DEPOIS da contestação).
 */
function htmlDossie(dados: DadosConta): string {
  const { conta: u, empresa, docs, eventos } = dados;
  if (!u) {
    return `<p style="color:#b91c1c;"><strong>Não existe conta com esse e-mail no banco.</strong>
      Comprou e nunca criou conta — evidência de uso é zero. Nesse caso aceitar costuma ser mais barato que brigar.</p>`;
  }
  const ultimo = docs.rows[0]?.created_at ?? null;
  const forte = docs.total > 0 || !!empresa?.cnpj;

  return `<ul style="margin:0 0 4px;padding-left:18px;">
      <li>Conta criada em <strong>${new Date(u.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</strong></li>
      <li><strong>${docs.total}</strong> documento(s) gerado(s)${ultimo ? ` — último em ${diaBR(docMs(ultimo))}` : ''}</li>
      <li><strong>${eventos.total}</strong> uso(s) de ferramenta registrado(s)</li>
      <li>Empresa cadastrada: ${empresa?.nome ? `<strong>${esc(empresa.nome)}</strong> — CNPJ ${esc(empresa.cnpj || '—')} — ${esc(empresa.cidade || '—')}` : '<em>nenhuma</em>'}</li>
    </ul>
    <p style="margin:6px 0 0;">${forte
      ? '<strong style="color:#15803d;">Tem material pra contestar.</strong> Se o CNPJ cadastrado for do próprio titular do cartão, a alegação de "não autorizei" cai sozinha.'
      : '<strong style="color:#b45309;">Evidência fraca</strong> — sem documento gerado e sem CNPJ. Aceitar pode sair mais barato que o tempo gasto.'}</p>`;
}

async function dossieDoCliente(email: string | null | undefined): Promise<string> {
  if (!email) return '<p><em>Sem e-mail na cobrança — procurar pelo Customer no painel.</em></p>';
  return htmlDossie(await buscarDadosConta(email));
}

// ── dados da Stripe (mesmo e-mail) ───────────────────────────────────────────

const idDe = (x: any): string | null => (typeof x === 'string' ? x : x?.id ?? null);

/**
 * Cobranças e assinaturas de TODOS os Customers com o mesmo e-mail. Cobrança em
 * dobro aqui nasce de um 2º Customer com o mesmo e-mail, então olhar só o
 * Customer da cobrança contestada não acha a duplicata.
 */
async function buscarNaStripe(email: string | null, charge: any): Promise<{
  cobrancas: CobrancaResumo[]; ativas: number; assinatura: AssinaturaResumo | null;
}> {
  const clientes = new Set<string>();
  const doCharge = idDe(charge?.customer);
  if (doCharge) clientes.add(doCharge);
  if (email) {
    const seguro = email.toLowerCase().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const r = await stripe.customers.search({ query: `email:'${seguro}'`, limit: 100 });
    // A busca da Stripe ignora maiúscula (conferido em 27/10/2026: a busca por e-mail na Stripe ignora maiúscula); mesmo assim confere igualdade em minúsculas.
    for (const c of r.data) if (String(c.email ?? '').toLowerCase().trim() === email.toLowerCase().trim()) clientes.add(c.id);
  }

  const cobrancas: CobrancaResumo[] = [];
  const subs: any[] = [];
  for (const id of [...clientes].slice(0, 25)) {
    const [cs, ss] = await Promise.all([
      stripe.charges.list({ customer: id, limit: 100 }),
      stripe.subscriptions.list({ customer: id, status: 'all', limit: 100 }),
    ]);
    for (const c of cs.data as any[]) {
      cobrancas.push({
        id: c.id, amount: c.amount, created: c.created,
        email: (c.billing_details?.email ?? null) ? String(c.billing_details.email).toLowerCase() : null,
        customer: idDe(c.customer), status: c.status,
        refunded: !!c.refunded, amount_refunded: c.amount_refunded ?? 0, disputed: !!c.disputed,
      });
    }
    for (const s of ss.data as any[]) subs.push(s);
  }

  const ativas = subs.filter((s) => s.status === 'active').length;
  // A assinatura da cobrança: a mais nova, do Customer da cobrança, criada até o dia dela.
  const candidatas = subs
    .filter((s) => idDe(s.customer) === doCharge && s.created <= (charge?.created ?? Infinity))
    .sort((a, b) => b.created - a.created);
  const s0 = candidatas[0];
  const assinatura: AssinaturaResumo | null = s0
    ? {
        id: s0.id, status: s0.status, created: s0.created,
        canceled_at: s0.canceled_at ?? null, cancel_at: s0.cancel_at ?? null,
        cancel_at_period_end: !!s0.cancel_at_period_end, trial_end: s0.trial_end ?? null,
        intervalo: s0.items?.data?.[0]?.price?.recurring?.interval ?? s0.items?.data?.[0]?.plan?.interval ?? null,
      }
    : null;
  return { cobrancas, ativas, assinatura };
}

/** Junta banco + Stripe no `ctx` que `decidirDefesa` e `montarEvidencia` consomem. */
async function montarContexto(email: string | null, charge: any): Promise<{ ctx: CtxDefesa; dados: DadosConta | null }> {
  const dados = email ? await buscarDadosConta(email) : null;
  const st = await buscarNaStripe(email, charge);
  return {
    dados,
    ctx: {
      conta: dados?.conta ?? null,
      empresa: dados?.empresa ?? null,
      docs: dados?.docs ?? { total: 0, primeiro: null, rows: [] },
      eventos: dados?.eventos ?? { total: 0, ultimo: null },
      cobrancasEmail: st.cobrancas,
      assinaturasAtivasEmail: st.ativas,
      assinaturaDaCobranca: st.assinatura,
      autoOff: autoOffLigado(process.env.DISPUTA_AUTO_OFF),
    },
  };
}

/**
 * Prévia SEM ENVIAR: decisão + evidência de qualquer disputa (aberta ou fechada).
 * Só lê. Este arquivo tem um único `disputes.update`, dentro de `runDisputeWatch`,
 * e esta função não chama nem chega nele.
 */
export async function preverDefesa(disputeId: string): Promise<{ decisao: DecisaoDefesa; evidencia: Record<string, string> }> {
  const d: any = await stripe.disputes.retrieve(disputeId, { expand: ['charge'] });
  const charge = typeof d.charge === 'object' ? d.charge : null;
  const email = charge?.billing_details?.email ? String(charge.billing_details.email).toLowerCase().trim() : null;
  const { ctx } = await montarContexto(email, charge);
  // O CRON_SECRET está num repositório público: a prévia sai SEM dado pessoal.
  // A evidência que vai para a Stripe (em runDisputeWatch) não passa por aqui.
  return mascararPrevia({ decisao: decidirDefesa(d, ctx, Date.now()), evidencia: montarEvidencia(d, charge, ctx) }, d, charge, ctx);
}

// ── textos dos e-mails ───────────────────────────────────────────────────────

const NOTA_MANUAL = `<p style="color:#b45309;margin:10px 0 0;font-size:13px;">Ao responder pela API, mandar <code>submit=false</code> explícito pra salvar rascunho: o padrão da Stripe é <code>true</code> e submete de primeira, e a disputa aceita UMA submissão só.</p>`;

function blocoDecisao(d: any, dec: DecisaoDefesa | null): string {
  const caixa = (cor: string, html: string) => `<p style="margin:10px 0 0;padding:8px 10px;border-left:3px solid ${cor};background:#f8fafc;">${html}</p>`;
  if (!dec) return caixa('#b45309', 'Não consegui reunir os dados para decidir a defesa automática; veja o e-mail de falha. Responda pelo painel da Stripe.') + NOTA_MANUAL;
  switch (dec.acao) {
    case 'esperar':
      return caixa('#15803d', `<strong>A defesa sai sozinha em ${dataDaDefesa(d)}</strong> (48h depois da abertura). Para impedir, ligue <code>DISPUTA_AUTO_OFF=1</code> na Vercel ou responda pelo painel da Stripe antes.`);
    case 'enviar':
      return caixa('#15803d', `<strong>A defesa automática está sendo enviada agora</strong> (${esc(dec.motivo)}). Você recebe outro e-mail com o texto enviado. Para impedir as próximas, ligue <code>DISPUTA_AUTO_OFF=1</code> na Vercel.`);
    case 'desligado':
      return caixa('#b45309', 'A defesa automática está <strong>desligada</strong> (<code>DISPUTA_AUTO_OFF</code>). Responda pelo painel da Stripe.') + NOTA_MANUAL;
    case 'ja_enviada':
      return caixa('#15803d', 'A Stripe já registra uma defesa enviada para esta disputa. Ela aceita uma só; nada a fazer.');
    case 'avisar_duplicada':
      return caixa('#b91c1c', `<strong>NÃO será defendida automaticamente:</strong> ${esc(dec.motivo)}. Cobrança em dobro não se defende. O certo é <strong>aceitar a disputa</strong> e, se ainda houver cobrança excedente viva, <strong>estornar e cancelar a assinatura a mais</strong>.`);
    case 'avisar_rascunho':
      return caixa('#b45309', `<strong>NÃO será defendida automaticamente:</strong> ${esc(dec.motivo)}. Termine e envie pelo painel da Stripe antes do prazo.`) + NOTA_MANUAL;
    case 'avisar_sem_uso':
      return caixa('#b45309', `<strong>NÃO será defendida automaticamente:</strong> ${esc(dec.motivo)}. Sem uso para provar, aceitar costuma sair mais barato que brigar. Se quiser defender, responda pelo painel.`) + NOTA_MANUAL;
    default:
      return '';
  }
}

function emailDefendida(d: any, valor: string, email: string, evidencia: Record<string, string>): { assunto: string; corpo: string } {
  const campos = Object.entries(evidencia)
    .map(([k, v]) => `<p style="margin:12px 0 2px;"><strong><code>${k}</code></strong></p>
      <div style="white-space:pre-wrap;font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;padding:8px 10px;">${esc(v)}</div>`)
    .join('');
  return {
    assunto: `Contestação defendida automaticamente · ${valor} (${email || d.id})`,
    corpo: `<p>A defesa foi enviada à Stripe (<code>submit: true</code>). A Stripe aceita uma submissão só, então este é o texto final.</p>
      <p>Disputa <code>${d.id}</code> · <a href="https://dashboard.stripe.com/disputes/${d.id}">abrir no painel da Stripe</a></p>
      <p style="margin:12px 0 0;"><strong>Texto inteiro de cada campo enviado:</strong></p>${campos}`,
  };
}

export async function runDisputeWatch(): Promise<{ abertas: number; avisadas: number; efw: number; defendidas: number }> {
  if (!process.env.STRIPE_SECRET_KEY) return { abertas: 0, avisadas: 0, efw: 0, defendidas: 0 };

  const st = await loadState();
  const avisadas = { ...(st.avisadas ?? {}) };
  const auto: Record<string, AutoRegistro> = { ...(st.auto ?? {}) };
  const efwVistos = new Set(st.efw ?? []);
  let novosAvisos = 0;
  let novosEfw = 0;
  let defendidas = 0;

  // ── 1. Disputas esperando resposta ─────────────────────────────────────────
  // `any` como no resto do repo: os tipos nomeados do SDK não são exportados nesta versão.
  let abertas: any[] = [];
  try {
    const r = await stripe.disputes.list({ limit: 100, expand: ['data.charge'] });
    abertas = r.data.filter((d) => d.status === 'needs_response' || d.status === 'warning_needs_response');
  } catch (err) {
    logger.error('dispute-watch', 'listar disputas falhou', err);
    return { abertas: 0, avisadas: 0, efw: 0, defendidas: 0 };
  }

  const agora = Date.now();
  for (const d of abertas) {
    try {
      const dueMs = (d.evidence_details?.due_by ?? 0) * 1000;
      const diasRestantes = dueMs ? Math.floor((dueMs - agora) / 86_400_000) : 99;
      const urgente = diasRestantes <= URGENTE_DIAS;
      const jaAvisou = avisadas[d.id];
      // Aviso de abertura: novo sempre; depois disso só volta na reta final (1×/dia).
      // A DECISÃO da defesa roda em toda rodada: um `esperar` de ontem vira `enviar` hoje.
      const mandaAbertura = !(jaAvisou && !urgente)
        && !(jaAvisou && urgente && new Date(jaAvisou).toDateString() === new Date().toDateString());

      const charge = d.charge as any;
      const objCharge = typeof charge === 'object' ? charge : null;
      const email: string | null = objCharge?.billing_details?.email ? String(objCharge.billing_details.email).toLowerCase().trim() : null;
      const nome = objCharge?.billing_details?.name;
      const valor = brl(d.amount);

      // ── decisão ──
      let ctx: CtxDefesa | null = null;
      let dados: DadosConta | null = null;
      let dec: DecisaoDefesa | null = null;
      let erroCtx = '';
      try {
        ({ ctx, dados } = await montarContexto(email, objCharge));
        dec = decidirDefesa(d, ctx, agora);
      } catch (err: any) {
        erroCtx = String(err?.message || err);
        logger.error('dispute-watch', `reunir dados da disputa ${d.id} falhou`, err);
      }

      // ── e-mail de abertura / lembrete ──
      if (mandaAbertura) {
        let dossie: string;
        try { dossie = dados ? htmlDossie(dados) : await dossieDoCliente(email); }
        catch { dossie = '<p><em>Não consegui montar o dossiê agora.</em></p>'; }
        let aberturaSaiu = true;
        await sendOpsAlert(
          `${urgente ? '🚨 PRAZO ESTOURANDO' : '⚠️ Nova contestação'} — ${valor} (${nome || email || d.id})`,
          `<p>O cliente contestou uma cobrança.</p>
           <table style="border-collapse:collapse;font-size:14px;margin:0 0 14px;">
             <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Valor</td><td><strong>${valor}</strong></td></tr>
             <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Cliente</td><td>${esc(nome || '—')} &lt;${esc(email || '—')}&gt;</td></tr>
             <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Motivo alegado</td><td>${esc(d.reason)}</td></tr>
             <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Prazo</td><td><strong style="color:${urgente ? '#b91c1c' : '#0f172a'};">${dueMs ? dia(d.evidence_details!.due_by!) : '—'}${dueMs ? ` (${diasRestantes} dia(s))` : ''}</strong></td></tr>
             <tr><td style="padding:3px 12px 3px 0;color:#64748b;">Disputa</td><td><code>${d.id}</code></td></tr>
           </table>
           <p style="margin:0 0 4px;"><strong>O que essa conta fez na plataforma:</strong></p>
           ${dossie}
           <p style="margin:14px 0 0;">Custa <strong>${brl(d.amount + 5500)}</strong> se perder — o valor mais a taxa de disputa, que é cobrada mesmo se você aceitar.</p>
           <p style="margin:8px 0 0;"><a href="https://dashboard.stripe.com/disputes/${d.id}">Abrir no painel da Stripe</a> · roteiro em <code>CONTESTACOES-STRIPE.md</code></p>
           ${blocoDecisao(d, dec)}`,
        ).catch((err) => { aberturaSaiu = false; logger.error('dispute-watch', `email da disputa ${d.id} falhou`, err); });

        avisadas[d.id] = new Date().toISOString();
        novosAvisos++;
        // O e-mail de abertura já trouxe o motivo de NÃO defender: não repete em e-mail à parte.
        // Só marca como "já avisei" se o e-mail saiu de fato.
        if (aberturaSaiu && dec && dec.acao.startsWith('avisar_')) auto[d.id] = { acao: dec.acao, quando: new Date().toISOString() };
      }

      // ── ação ──
      if (dec && dec.acao.startsWith('avisar_') && auto[d.id]?.acao !== dec.acao) {
        let saiu = true;
        await sendOpsAlert(
          `Contestação NÃO defendida automaticamente · ${valor} (${email || d.id})`,
          `<p>Disputa <code>${d.id}</code> · <a href="https://dashboard.stripe.com/disputes/${d.id}">abrir no painel</a></p>${blocoDecisao(d, dec)}`,
        ).catch((err) => { saiu = false; logger.error('dispute-watch', `email de não-defesa da disputa ${d.id} falhou`, err); });
        if (saiu) auto[d.id] = { acao: dec.acao, quando: new Date().toISOString() };
      }

      if (dec?.acao === 'enviar' && ctx) {
        let evidencia: Record<string, string> = {};
        try {
          evidencia = montarEvidencia(d, objCharge, ctx);
          // `submit: true` EXPLÍCITO: a Stripe aceita uma submissão só. É o único
          // disputes.update do arquivo e só roda neste ramo.
          // idempotencyKey com o DIA: rodadas simultâneas ou repetidas no mesmo dia não
          // submetem duas vezes; uma falha pode ser tentada de novo no dia seguinte.
          await stripe.disputes.update(
            d.id,
            { evidence: evidencia as any, submit: true },
            { idempotencyKey: `defesa-${d.id}-${isoDiaBR(Date.now())}` },
          );
          auto[d.id] = { acao: 'enviada', quando: new Date().toISOString() };
          defendidas++;
          const m = emailDefendida(d, valor, email || '', evidencia);
          await sendOpsAlert(m.assunto, m.corpo)
            .catch((err) => logger.error('dispute-watch', `email de defesa da disputa ${d.id} falhou`, err));
          logger.info('dispute-watch', `disputa ${d.id} defendida automaticamente (${valor})`);
        } catch (err: any) {
          logger.error('dispute-watch', `defesa automática da disputa ${d.id} falhou`, err);
          const jaFalhouHoje = auto[d.id]?.acao === 'falhou' && isoDiaBR(Date.parse(auto[d.id]!.quando)) === isoDiaBR(Date.now());
          if (!jaFalhouHoje) {
            await sendOpsAlert(
              `Defesa automática FALHOU · ${valor} (${email || d.id})`,
              `<p>Não consegui enviar a defesa da disputa <code>${d.id}</code>. Na próxima rodada tento de novo, a não ser que o prazo vença antes.</p>
               <p style="margin:8px 0;"><strong>Erro:</strong> <code>${esc(err?.message || err)}</code></p>
               <p style="margin:8px 0 0;"><a href="https://dashboard.stripe.com/disputes/${d.id}">Responder pelo painel da Stripe</a>, se o prazo estiver curto.</p>`,
            ).catch((e2) => logger.error('dispute-watch', `email de falha da disputa ${d.id} falhou`, e2));
          }
          auto[d.id] = { acao: 'falhou', quando: new Date().toISOString() };
        }
      } else if (!dec && erroCtx) {
        const jaFalhouHoje = auto[d.id]?.acao === 'falhou' && isoDiaBR(Date.parse(auto[d.id]!.quando)) === isoDiaBR(Date.now());
        if (!jaFalhouHoje) {
          await sendOpsAlert(
            `Defesa automática FALHOU · ${valor} (${email || d.id})`,
            `<p>Não consegui reunir os dados da disputa <code>${d.id}</code> para montar a defesa. Na próxima rodada tento de novo.</p>
             <p style="margin:8px 0;"><strong>Erro:</strong> <code>${esc(erroCtx)}</code></p>
             <p style="margin:8px 0 0;"><a href="https://dashboard.stripe.com/disputes/${d.id}">Responder pelo painel da Stripe</a>, se o prazo estiver curto.</p>`,
          ).catch((e2) => logger.error('dispute-watch', `email de falha da disputa ${d.id} falhou`, e2));
        }
        auto[d.id] = { acao: 'falhou', quando: new Date().toISOString() };
      }
    } catch (err) {
      logger.error('dispute-watch', `tratar disputa ${d?.id} falhou`, err);
    }
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
  const autoLimpo: Record<string, AutoRegistro> = {};
  for (const [id, reg] of Object.entries(auto)) if (idsAbertos.has(id)) autoLimpo[id] = reg;

  await saveState({ avisadas: limpo, auto: autoLimpo, efw: [...efwVistos].slice(-200) });

  if (novosAvisos || novosEfw || defendidas) {
    logger.info('dispute-watch', `${abertas.length} disputa(s) aberta(s) · ${novosAvisos} aviso(s) · ${defendidas} defendida(s) · ${novosEfw} aviso(s) antecipado(s)`);
  }
  return { abertas: abertas.length, avisadas: novosAvisos, efw: novosEfw, defendidas };
}
