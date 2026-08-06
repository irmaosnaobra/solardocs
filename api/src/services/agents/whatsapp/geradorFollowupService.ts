// ─────────────────────────────────────────────────────────────────────────────
// Follow-up do /gerador (energia solar B2C — Irmãos na Obra) pela linha 34998165040.
//
// Reengaja leads de energia que AGENDARAM uma conversa e o consultor não conseguiu
// fechar: "não atendeu" ou "agendado" cujo horário passou sem ação. NÃO é outbound
// frio — são pessoas que JÁ pediram contato (Lead Ads) e já falaram com a linha.
// Quando o lead RESPONDE, o bot NÃO vende: avisa na hora o CONSULTOR dono pra ele
// assumir, e cala (handed_off). É um "puxador" de quem esfriou, não um vendedor.
//
// ── Arquitetura (copiada da Bia, auditada adversarialmente) ──
//   1 PRODUTOR (seed diário) → marcadores em system_state (MAIN) → 1 CONSUMIDOR único.
//     • Seed: varre os alvos do gerador, semeia `gerador_followup_pending:<telKey>`
//       com ready_at escalonado (stagger), SKIP-IF-EXISTS (idempotente).
//     • Consumidor (roda no tick de /process-messages ~5min): processa marcadores
//       prontos com CLAIM atômico (DELETE…RETURNING), RE-CHECK do status atual no
//       gerador, teto anti-ban COMPARTILHADO, cap por tick, envio, semeia a sessão.
//
// ── Por que o ESTADO mora no MAIN (e não no gerador, onde os leads estão) ──
// O teto anti-ban da linha é ÚNICO (lineThrottle): conta os envios de TODOS os bots
// (Bia + este) em system_state do MAIN. Se o estado daqui fosse no gerador, o teto da
// Bia ficaria cego pros nossos envios e a linha tomaria ban. Então: leads lidos do
// gerador; estado (fila/contatado/handoff/sessão) no MAIN com prefixo próprio.
//
// ── Salvaguardas (a linha é compartilhada com atendimento HUMANO de energia) ──
//   1. ALVO = só o conjunto "Reagendar" do CRM (espelha calcularReagendarPorConsultor):
//      exclui vendido/perdido/temperatura/falando_whatsapp e quem tem agendamento FUTURO.
//      Mira só nao_atendeu + agendado-vencido (v1). NÃO toca quem está em negociação.
//   2. RE-CHECK do status no consumidor: se o lead saiu do conjunto-alvo entre o seed e
//      o envio (consultor mexeu, marcou temperatura, reagendou), o marcador é resolvido
//      sem enviar. A verdade vem do gerador no momento do envio, não do snapshot do seed.
//   3. CLAIM atômico anti-double-send + idempotência (1 toque por lead, cooldown).
//   4. TETO anti-ban compartilhado com a Bia + cap por tick.
//   5. ehLeadSolar + takeover: se o consultor/humano responder pela linha, o bot cala.
//
// Tudo no-op enquanto GERADOR_FOLLOWUP_ENABLED!='true' (merge dark seguro).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';            // MAIN: estado, sessão, teto
import { supabaseGerador } from '../../../utils/supabaseGerador'; // gerador: leads (read-only)
import { sendHuman, fmtPhone } from '../zapiClient';
import { logger } from '../../../utils/logger';
import { dentroDoTetoHorarioLinha, dentroDaJanelaDiurna, respeitaEspacamentoLinha } from './lineThrottle';

const INSTANCE = 'io' as const;

// Habilitado? Precisa das credenciais da linha IO E do flag explícito. DARK por padrão.
export function followupHabilitado(): boolean {
  const id = process.env.ZAPI_INSTANCE_ID_IO?.trim();
  const token = process.env.ZAPI_TOKEN_IO?.trim();
  return Boolean(id && token && process.env.GERADOR_FOLLOWUP_ENABLED === 'true');
}

// Cooldown: 1 toque por lead a cada 30 dias (não re-perturbar quem já foi puxado).
const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
// Stagger do seed: 6 min entre leads (cadência conservadora — base finita, sem pressa).
const SEED_STAGGER_MS = 6 * 60 * 1000;
// Anti-rajada intra-tick: no máximo N envios por execução do consumidor.
const MAX_ENVIOS_POR_TICK = 2;

// Prefixos de estado no MAIN. `:` = enviado (conta no teto via lineThrottle);
// `_pending` = fila (NÃO conta no teto). Ver lineThrottle.BOT_SENT_PREFIXES.
const SENT_PREFIX = 'gerador_followup:';
const PENDING_PREFIX = 'gerador_followup_pending:';

const STATUS_PERDIDO = new Set(['cancelado', 'sem_interesse']);
// Alvo v1: só estes status. fez_orcamento/sem_orcamento ficam de fora (agendamentos não
// tem updated_at → não dá pra distinguir "orçou ontem, negociando" de "orçou há semanas").
const STATUS_ALVO = new Set(['nao_atendeu', 'agendado']);

// ─── chave por telefone (mesma do CRM: tira 55, DDD + últimos 8, ignora 9º dígito) ──
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}
function sentKey(k: string): string { return `${SENT_PREFIX}${k}`; }
function pendingKey(k: string): string { return `${PENDING_PREFIX}${k}`; }

// ─── alvo: o lead a ser reengajado ──────────────────────────────────
interface AlvoFollowup {
  telKey: string;
  telefone: string;
  nome: string;
  consultor: string;        // vendedor_nome (FK consultores)
  cidade: string | null;
  status: string;
  quando: string;
}

type Agendamento = {
  id: number;
  vendedor_nome: string;
  quando: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  cidade: string | null;
  status: string;
  temperatura: string | null;
  created_by: string | null;
};
type Proposta = { vendido: boolean | null; dados: any };

// ─── calcula os alvos: ESPELHA a coluna "Reagendar" do CRM (calcularReagendarPorConsultor
//     em services/agenda/reagendarDigest.ts) — se mudar lá, reavaliar aqui. Diferença: aqui
//     restringimos ao subconjunto v1 (STATUS_ALVO) e exigimos telefone normalizável.
//     O digest 17h cobre o RESTO (inclusive sem fone). Este bot é a 1ª linha; alvos casam. ─
export async function calcularAlvos(): Promise<AlvoFollowup[]> {
  const agora = Date.now();
  const [{ data: ags, error: e1 }, { data: props, error: e2 }] = await Promise.all([
    supabaseGerador
      .from('agendamentos')
      .select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, cidade, status, temperatura, created_by')
      .order('quando', { ascending: false }),
    supabaseGerador.from('propostas').select('vendido, dados'),
  ]);
  if (e1) { logger.error('gerador-followup', 'falha ao listar agendamentos', e1); return []; }
  const agendamentos = (ags || []) as Agendamento[];
  const propostas = (props || []) as Proposta[];
  if (e2) logger.error('gerador-followup', 'falha ao listar propostas (segue sem cross-check de venda)', e2);

  // Resgate por venda (telefone com proposta vendida → nunca é alvo).
  const vendidos = new Set<string>();
  for (const p of propostas) {
    if (p.vendido) { const k = telKey(p?.dados?.telefoneDigitos || p?.dados?.telefone); if (k) vendidos.add(k); }
  }

  // Agrupa por telefone pra avaliar o cliente como um todo (igual ao digest).
  const porTel = new Map<string, Agendamento[]>();
  for (const ag of agendamentos) {
    // Lead de PROSPECÇÃO ATIVA (prosp_*) não entra: a copy deste bot é "você pediu
    // contato sobre energia solar" e essas fichas nascem de lista fria, marcadas pelo
    // consultor na tela /gerador/prospeccao — ninguém pediu nada.
    // (Ficha de eletroposto continua entrando aqui, como sempre entrou. É buraco
    //  ANTERIOR a esta mudança — quem ligar GERADOR_FOLLOWUP_ENABLED tem que resolver.)
    if (String(ag.created_by || '').startsWith('prosp_')) continue;
    const k = telKey(ag.cliente_telefone);
    if (!k) continue;                         // sem telefone normalizável → fora (digest cobre)
    if (!porTel.has(k)) porTel.set(k, []);
    porTel.get(k)!.push(ag);
  }

  const alvos: AlvoFollowup[] = [];
  for (const [k, lista] of porTel) {
    // Resgates (idênticos ao digest): venda, temperatura, conversa ativa, perda.
    if (vendidos.has(k)) continue;
    if (lista.some(a => a.temperatura)) continue;
    if (lista.some(a => a.status === 'falando_whatsapp')) continue;
    if (lista.some(a => STATUS_PERDIDO.has(a.status))) continue;
    // Já tem agendamento FUTURO não-perdido → já foi reagendado, não puxa.
    if (lista.some(a => !STATUS_PERDIDO.has(a.status) && new Date(a.quando).getTime() >= agora)) continue;

    // Precisa puxar? (subconjunto v1: nao_atendeu OU agendado-vencido)
    const precisa = lista.some(a =>
      a.status === 'nao_atendeu' ||
      (a.status === 'agendado' && !a.temperatura && new Date(a.quando).getTime() < agora)
    );
    if (!precisa) continue;
    // (STATUS_ALVO documenta o subconjunto; a condição acima já o aplica.)
    void STATUS_ALVO;

    // Agendamento mais recente define consultor dono + dados de exibição (igual ao digest).
    const recente = lista.reduce((m, a) => (new Date(a.quando) > new Date(m.quando) ? a : m), lista[0]);
    alvos.push({
      telKey: k,
      telefone: recente.cliente_telefone!,
      nome: recente.cliente_nome || '',
      consultor: recente.vendedor_nome || '',
      cidade: recente.cidade,
      status: recente.status,
      quando: recente.quando,
    });
  }
  return alvos;
}

// ─── idempotência / estado (MAIN) ───────────────────────────────────
async function jaContatado(k: string): Promise<boolean> {
  const { data } = await supabase
    .from('system_state').select('value').eq('key', sentKey(k)).maybeSingle();
  const v = (data?.value ?? {}) as { contacted_at?: string };
  if (!v.contacted_at) return false;
  return Date.now() - new Date(v.contacted_at).getTime() < COOLDOWN_MS;
}

async function marcarContatado(alvo: AlvoFollowup): Promise<void> {
  await supabase.from('system_state').upsert({
    key: sentKey(alvo.telKey),
    value: {
      contacted_at: new Date().toISOString(),
      status: alvo.status, consultor: alvo.consultor,
      telefone: alvo.telefone, nome: alvo.nome,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
}

// ─── backoff: já está em conversa com o bot? (sessão tipo='gerador_followup') ──
function phoneVariants(raw: string): string[] {
  const clean = raw.replace(/\D/g, '');
  const c55 = clean.startsWith('55') ? clean : `55${clean}`;
  const semDdi = c55.replace(/^55/, '');
  const add9 = c55.length === 12 ? c55.slice(0, 4) + '9' + c55.slice(4) : c55;
  const rem9 = c55.length === 13 && c55[4] === '9' ? c55.slice(0, 4) + c55.slice(5) : c55;
  return Array.from(new Set([clean, c55, semDdi, add9, rem9, add9.replace(/^55/, ''), rem9.replace(/^55/, '')]));
}

async function emConversa(telefone: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_sessions').select('messages, lead_data')
    .in('phone', phoneVariants(telefone))
    .eq('tipo', 'gerador_followup')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return false;
  const msgs = (data.messages as unknown[]) || [];
  const ld = (data.lead_data ?? {}) as { human_takeover?: boolean; handed_off?: boolean };
  return msgs.length > 0 || ld.human_takeover === true || ld.handed_off === true;
}

// Lead JÁ é da Bia (recuperação LimpaPro)? Precedência: nunca pisamos numa sessão da Bia.
async function ehLeadDaBia(telefone: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_sessions').select('id')
    .in('phone', phoneVariants(telefone)).eq('tipo', 'recuperacao').limit(1).maybeSingle();
  return Boolean(data);
}

// ─── mensagem (BURRA: reengaja, NÃO vende, NÃO cota preço) ──────────
export function montarMensagem(alvo: AlvoFollowup): string[] {
  const nome = (alvo.nome || '').trim().split(/\s+/)[0];
  const oi = nome && nome.toLowerCase() !== 'lead' ? `Oi ${nome}, tudo bem?` : 'Oi, tudo bem?';
  return [
    `${oi} Aqui é da *Irmãos na Obra* ☀️`,
    `A gente tinha combinado de te mostrar quanto dá pra economizar saindo da conta de luz, mas acabou não rolando da nossa parte. Ainda faz sentido pra você ver os números? É rapidinho e sem compromisso. 👍`,
  ];
}

// ─── elegibilidade no momento do envio ──────────────────────────────
async function porqueNaoEnviar(alvo: AlvoFollowup): Promise<string | null> {
  if (!alvo.telefone) return 'sem_telefone';
  if (await jaContatado(alvo.telKey)) return 'ja_contatado';
  if (await ehLeadDaBia(alvo.telefone)) return 'lead_da_bia';      // precedência: Bia primeiro
  if (await emConversa(alvo.telefone)) return 'em_conversa';
  return null;
}

// ─── envio: MARK → SEED sessão → SEND (ordem load-bearing, igual à Bia) ──
async function enviarParaAlvo(alvo: AlvoFollowup): Promise<void> {
  await marcarContatado(alvo);                                     // 1. MARK (blinda reentrância + conta no teto)

  const phone = fmtPhone(alvo.telefone);
  await supabase.from('whatsapp_sessions').upsert({               // 2. SEED sessão (backoff + contexto p/ inbound)
    phone, tipo: 'gerador_followup', nome: alvo.nome,
    messages: [{ role: 'assistant', content: montarMensagem(alvo).join(' ') }],
    lead_data: {
      tel_key: alvo.telKey, consultor: alvo.consultor,
      cidade: alvo.cidade, status_origem: alvo.status,
      handed_off: false, human_takeover: false,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'phone,tipo' });

  await sendHuman(alvo.telefone, montarMensagem(alvo), INSTANCE);  // 3. SEND
  logger.info('gerador-followup', `puxado ${alvo.nome} (${alvo.status}) consultor=${alvo.consultor} via ${alvo.telefone}`);
}

// ─── lê os alvos como Map por telKey (pra o consumidor re-checar a verdade atual) ──
async function lerAlvosMap(): Promise<Map<string, AlvoFollowup>> {
  const alvos = await calcularAlvos();
  return new Map(alvos.map(a => [a.telKey, a]));
}

// ═════════════════════════════════════════════════════════════════════
// SEED — semeia os alvos atuais, ready_at escalonado. SKIP-IF-EXISTS (idempotente).
// One-shot/diário: re-rodar não re-estagiona quem já está em voo nem quem já foi contatado.
// ═════════════════════════════════════════════════════════════════════
export async function seedGeradorFollowup(opts: { dry?: boolean } = {}): Promise<{
  semeados: number; pulados: number; motivo_skip: Record<string, number>;
}> {
  const motivo: Record<string, number> = {};
  const bump = (m: string) => { motivo[m] = (motivo[m] || 0) + 1; };
  if (!followupHabilitado()) return { semeados: 0, pulados: 0, motivo_skip: { desabilitado: 1 } };

  const alvos = await calcularAlvos();
  alvos.sort((a, b) => new Date(a.quando).getTime() - new Date(b.quando).getTime()); // mais antigo primeiro

  // Já tem marcador pendente? (skip-if-exists)
  const { data: pend } = await supabase
    .from('system_state').select('key').like('key', `${PENDING_PREFIX}%`);
  const jaPend = new Set((pend ?? []).map(r => r.key.slice(PENDING_PREFIX.length)));

  const novos: { key: string; value: any; updated_at: string }[] = [];
  const base = Date.now();
  let semeados = 0;

  for (const alvo of alvos) {
    if (jaPend.has(alvo.telKey))          { bump('ja_em_fila'); continue; }
    if (await jaContatado(alvo.telKey))   { bump('ja_contatado'); continue; }
    if (await ehLeadDaBia(alvo.telefone)) { bump('lead_da_bia'); continue; }

    novos.push({
      key: pendingKey(alvo.telKey),
      value: {
        ready_at: new Date(base + semeados * SEED_STAGGER_MS).toISOString(),
        seeded_at: new Date().toISOString(),
        nome: alvo.nome, consultor: alvo.consultor,
      },
      updated_at: new Date().toISOString(),
    });
    semeados++;
  }

  if (!opts.dry && novos.length) {
    await supabase.from('system_state').upsert(novos, { onConflict: 'key', ignoreDuplicates: true });
  }
  return { semeados, pulados: alvos.length - semeados, motivo_skip: motivo };
}

// ═════════════════════════════════════════════════════════════════════
// CONSUMIDOR ÚNICO — drena marcadores prontos. Roda no tick de /process-messages.
// Seguro sob concorrência via CLAIM (DELETE…RETURNING). Gates:
//   PRÉ-claim (break → marcador SOBREVIVE): cap por tick + teto horário compartilhado.
//   PÓS-claim (continue → marcador consumido): saiu do alvo / ja_contatado / em_conversa / bia.
// ═════════════════════════════════════════════════════════════════════
export async function runGeradorFollowupConsumer(opts: { dry?: boolean } = {}): Promise<{
  enviados: number; resolvidos: number; pulados: number; mantidos: number; motivo: Record<string, number>;
}> {
  const motivo: Record<string, number> = {};
  const bump = (m: string) => { motivo[m] = (motivo[m] || 0) + 1; };
  const out = { enviados: 0, resolvidos: 0, pulados: 0, mantidos: 0, motivo };
  if (!followupHabilitado()) { bump('desabilitado'); return out; }

  const { data: rows, error } = await supabase
    .from('system_state').select('key, value').like('key', `${PENDING_PREFIX}%`).limit(200);
  if (error) { logger.error('gerador-followup', 'consumer: ler markers falhou', error); bump('erro_markers'); return out; }

  const now = Date.now();
  const prontos = (rows ?? [])
    .filter(r => { const ra = (r.value as any)?.ready_at; return !ra || new Date(ra).getTime() <= now; })
    .sort((a, b) => String((a.value as any)?.ready_at ?? '').localeCompare(String((b.value as any)?.ready_at ?? '')));
  if (prontos.length === 0) return out;

  // Verdade atual do gerador. Se a leitura dos agendamentos falhar, calcularAlvos retorna []
  // (engole erro) — o que poderia resolver tudo como "saiu do alvo". Pra não deletar a fila
  // inteira num soluço do gerador, abortamos o tick com markers intactos quando vier vazio
  // E havia fila (caso patológico). Vazio legítimo (ninguém mais a puxar) também cai aqui e
  // só adia 1 tick — barato e seguro.
  const alvosMap = await lerAlvosMap();
  if (alvosMap.size === 0) { out.mantidos = prontos.length; bump('alvos_vazios_abortado'); return out; }

  let enviadosTick = 0;
  for (const r of prontos) {
    const k = r.key.slice(PENDING_PREFIX.length);

    // ── PRÉ-CLAIM (break → marcador sobrevive) ──
    if (enviadosTick >= MAX_ENVIOS_POR_TICK) { out.mantidos++; bump('cap_tick'); break; }
    // Madrugada: followup também é toque frio na mesma linha — segura pra manhã.
    if (!opts.dry && !dentroDaJanelaDiurna()) { out.mantidos++; bump('fora_da_janela_diurna'); break; }
    if (!opts.dry && !(await dentroDoTetoHorarioLinha())) { out.mantidos++; bump('teto_horario'); break; }
    // Margem de 5 min entre dois envios da linha (anti-rajada) — 1 por tick, na prática.
    if (!opts.dry && !(await respeitaEspacamentoLinha())) { out.mantidos++; bump('espacamento'); break; }

    if (opts.dry) { // simula sem claimar/enviar/deletar
      const alvo = alvosMap.get(k);
      if (!alvo) { bump('saiu_do_alvo'); continue; }
      const skip = await porqueNaoEnviar(alvo);
      if (skip) { bump(skip); continue; }
      out.enviados++; enviadosTick++; bump('enviaria'); continue;
    }

    // ── CLAIM ATÔMICO ──
    const { data: claimed } = await supabase
      .from('system_state').delete().eq('key', r.key).select('key').maybeSingle();
    if (!claimed) { bump('corrida_perdida'); continue; }

    // ── PÓS-CLAIM (continue → consumido) ──
    const alvo = alvosMap.get(k);
    if (!alvo) { out.resolvidos++; bump('saiu_do_alvo'); continue; } // consultor mexeu / reagendou / vendeu

    const skip = await porqueNaoEnviar(alvo);
    if (skip) { out.pulados++; bump(skip); continue; }

    try {
      await enviarParaAlvo(alvo);
      out.enviados++; enviadosTick++;
    } catch (err) {
      out.pulados++; bump('erro_envio');
      logger.error('gerador-followup', `consumer: envio falhou ${k} (marcador já claimado)`, err);
      // best-effort: real-time não re-tenta; o seed diário auto-cura no próximo ciclo.
    }
  }
  return out;
}

// ─── TESTE gated: manda o 1º toque pra UM número (valida o ciclo antes da base) ──
export async function enviarFollowupTeste(telefone: string, nome?: string | null): Promise<{ ok: boolean; motivo?: string }> {
  if (!followupHabilitado()) return { ok: false, motivo: 'desabilitado' };
  const k = telKey(telefone);
  if (!k) return { ok: false, motivo: 'telefone_invalido' };
  const alvo: AlvoFollowup = {
    telKey: k, telefone, nome: nome ?? 'Teste', consultor: 'Thiago',
    cidade: null, status: 'nao_atendeu', quando: new Date().toISOString(),
  };
  await enviarParaAlvo(alvo);
  return { ok: true };
}
