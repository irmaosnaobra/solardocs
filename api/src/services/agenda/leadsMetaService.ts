import { supabaseGerador } from '../../utils/supabaseGerador';
import { sendWhatsApp } from '../agents/zapiClient';
import { logger } from '../../utils/logger';

// Puxa leads dos formulários (Lead Ads) da página "Irmãos na Obra" no Meta,
// distribui no rodízio Thiago→Diego→Nilce e cria um card na agenda pra cada lead.

const GRAPH = 'https://graph.facebook.com/v21.0';
const PAGE_ID = process.env.META_LEADS_PAGE_ID || '704395102766155';
const SU_TOKEN = process.env.META_SYSTEM_USER_TOKEN || '';

const CONSULTORES_RODIZIO = ['Thiago', 'Diego', 'Nilce'];
const HORA_INI = 8;   // agenda abre 08:00
const HORA_FIM = 20;  // fecha 20:00

// Extrai a hora preferida (início da faixa) de qualquer formato de texto:
// "08 a 10", "Manhã (09h às 11h)", "Após 18", "13 a 15" → 8, 9, 18, 13
function horaDaFaixa(txt: string): number {
  if (!txt) return HORA_INI;
  const t = txt.toLowerCase();
  // "após 18" / "apos 18" sem outro número antes
  const m = t.match(/(\d{1,2})\s*h?/);
  if (m) {
    const h = parseInt(m[1], 10);
    if (h >= HORA_INI && h < HORA_FIM) return h;
    if (h < HORA_INI) return HORA_INI;
    if (h >= HORA_FIM) return HORA_FIM - 1;
  }
  if (t.includes('manh')) return 9;
  if (t.includes('tarde')) return 14;
  if (t.includes('noite') || t.includes('após') || t.includes('apos')) return 18;
  return HORA_INI;
}

interface FieldItem { name: string; values: string[]; }
interface RawLead {
  id: string;
  created_time: string;
  field_data: FieldItem[];
}

function fieldVal(fields: FieldItem[], ...names: string[]): string {
  for (const n of names) {
    const f = fields.find(x => x.name.toLowerCase() === n.toLowerCase());
    if (f && f.values && f.values[0]) return f.values[0];
  }
  return '';
}

// Busca um campo cujo nome CONTENHA qualquer um dos termos (pra nomes longos/variáveis)
function fieldContains(fields: FieldItem[], ...terms: string[]): string {
  for (const f of fields) {
    const nm = f.name.toLowerCase();
    if (terms.some(t => nm.includes(t.toLowerCase())) && f.values && f.values[0]) return f.values[0];
  }
  return '';
}

// Normaliza cidade do lead (texto livre) pra comparar com a área de atendimento.
// "Capelinha mg", "Rio Paranaíba zona rural" → "capelinha", "rio paranaiba"
function normalizarCidade(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
    .toLowerCase()
    .replace(/\b(zona rural|zona urbana|mg|sp|go|minas gerais|sao paulo|goias)\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// True se a cidade do lead está na área de atendimento (tabela cidades_atendimento)
async function dentroDaArea(cidade: string): Promise<boolean> {
  const norm = normalizarCidade(cidade);
  if (!norm) return false;
  const { data } = await supabaseGerador
    .from('cidades_atendimento')
    .select('id')
    .eq('cidade_normalizada', norm)
    .limit(1);
  return !!(data && data.length > 0);
}

// Deriva o Page Access Token na hora (SU token é permanente; page token derivado não expira na prática)
async function getPageToken(): Promise<string> {
  const r = await fetch(`${GRAPH}/${PAGE_ID}?fields=access_token&access_token=${SU_TOKEN}`);
  const j = await r.json() as any;
  if (!j.access_token) throw new Error('Falha ao derivar page token: ' + JSON.stringify(j));
  return j.access_token as string;
}

async function listActiveForms(pageToken: string): Promise<string[]> {
  const r = await fetch(`${GRAPH}/${PAGE_ID}/leadgen_forms?fields=id,status&limit=100&access_token=${pageToken}`);
  const j = await r.json() as any;
  if (!j.data) return [];
  return j.data.filter((f: any) => f.status === 'ACTIVE').map((f: any) => f.id as string);
}

async function fetchLeadsSince(formId: string, pageToken: string, sinceUnix: number): Promise<RawLead[]> {
  const out: RawLead[] = [];
  let url = `${GRAPH}/${formId}/leads?fields=id,created_time,field_data&limit=100&filtering=[{"field":"time_created","operator":"GREATER_THAN","value":${sinceUnix}}]&access_token=${pageToken}`;
  // paginação defensiva (máx 5 páginas por run pra não estourar)
  for (let i = 0; i < 5 && url; i++) {
    const r = await fetch(url);
    const j = await r.json() as any;
    if (j.error) { logger.error('leads-meta', 'erro fetch leads', j.error); break; }
    if (Array.isArray(j.data)) out.push(...j.data);
    url = j.paging?.next || '';
  }
  return out;
}

// ===== Horário de São Paulo (-03:00) — servidor roda em UTC =====
// "Agora" em SP, decomposto em partes.
function nowSP() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value || '';
  let h = +g('hour'); if (h === 24) h = 0; // Intl pode devolver 24 à meia-noite
  return {
    y: +g('year'), m: +g('month'), d: +g('day'),
    h, min: +g('minute'),
    dow: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(g('weekday')),
  };
}

// Date a partir de Y-M-D h:min interpretado como horário de SP (-03:00)
function spDate(y: number, m: number, d: number, h: number, min: number): Date {
  const p2 = (n: number) => String(n).padStart(2, '0');
  return new Date(`${y}-${p2(m)}-${p2(d)}T${p2(h)}:${p2(min)}:00-03:00`);
}

// Dia da semana (0=dom..6=sab) de uma data Y-M-D em SP
function dowSP(y: number, m: number, d: number): number {
  const wd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', weekday: 'short' })
    .format(spDate(y, m, d, 12, 0));
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(wd);
}

// Avança um dia (lida com virada de mês/ano) usando UTC como aritmética segura
function proximoDia(y: number, m: number, d: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + 1);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

// Carrega ocupação (agendamentos + bloqueios) de um consultor, de agora em diante.
async function carregarOcupacao(consultor: string, agoraIso: string) {
  const [{ data: ags }, { data: blqs }] = await Promise.all([
    supabaseGerador.from('agendamentos')
      .select('quando').eq('vendedor_nome', consultor).neq('status', 'cancelado').gte('quando', agoraIso),
    supabaseGerador.from('agenda_bloqueios')
      .select('inicio,fim').eq('vendedor_nome', consultor).gte('fim', agoraIso),
  ]);
  const ocupados = new Set((ags || []).map((a: any) => new Date(a.quando).getTime()));
  const bloqueios = (blqs || []).map((b: any) => ({ ini: new Date(b.inicio).getTime(), fim: new Date(b.fim).getTime() }));
  return { ocupados, bloqueios };
}

function slotDisponivel(t: number, agoraMs: number, occ: { ocupados: Set<number>; bloqueios: { ini: number; fim: number }[] }): boolean {
  if (t < agoraMs) return false;
  if (occ.ocupados.has(t)) return false;
  if (occ.bloqueios.some(b => t >= b.ini && t < b.fim)) return false;
  return true;
}

// Acha slot + consultor respeitando o rodízio. Se o consultor da vez está
// bloqueado/ocupado no horário pedido, PASSA pro próximo consultor naquele
// mesmo horário. Só avança o horário quando nenhum consultor está livre.
// Retorna { slot, consultor, idxUsado } — idxUsado avança o rodízio em +1.
async function acharSlotRodizio(
  rodizioIdx: number,
  base: { y: number; m: number; d: number; h: number },
): Promise<{ slot: Date; consultor: string }> {
  const agora = new Date();
  const agoraMs = agora.getTime();
  const agoraIso = agora.toISOString();

  // ocupação de cada consultor (carrega uma vez)
  const occ: Record<string, { ocupados: Set<number>; bloqueios: { ini: number; fim: number }[] }> = {};
  for (const c of CONSULTORES_RODIZIO) occ[c] = await carregarOcupacao(c, agoraIso);

  let { y, m, d } = base;
  for (let i = 0; i < 14; i++) {
    const dow = dowSP(y, m, d);
    if (dow !== 0 && dow !== 6) {  // só seg-sex
      const horaIni = i === 0 ? Math.max(HORA_INI, base.h) : HORA_INI;
      for (let h = horaIni; h < HORA_FIM; h++) {
        for (let min = 0; min < 60; min += 15) {
          const slot = spDate(y, m, d, h, min);
          const t = slot.getTime();
          // tenta os consultores na ordem do rodízio, a partir da vez atual
          for (let off = 0; off < CONSULTORES_RODIZIO.length; off++) {
            const consultor = CONSULTORES_RODIZIO[(rodizioIdx + off) % CONSULTORES_RODIZIO.length];
            if (slotDisponivel(t, agoraMs, occ[consultor])) {
              return { slot, consultor };
            }
          }
        }
      }
    }
    ({ y, m, d } = proximoDia(y, m, d));
  }
  // fallback: consultor da vez, próximo dia útil 08:00 SP
  return { slot: spDate(base.y, base.m, base.d, HORA_INI, 0), consultor: CONSULTORES_RODIZIO[rodizioIdx % CONSULTORES_RODIZIO.length] };
}

// Slot livre pra um consultor FIXO (usado no realinhamento — não mexe no rodízio).
async function slotLivreConsultor(consultor: string, base: { y: number; m: number; d: number; h: number }): Promise<Date> {
  const agora = new Date();
  const occ = await carregarOcupacao(consultor, agora.toISOString());
  let { y, m, d } = base;
  for (let i = 0; i < 14; i++) {
    const dow = dowSP(y, m, d);
    if (dow !== 0 && dow !== 6) {
      const horaIni = i === 0 ? Math.max(HORA_INI, base.h) : HORA_INI;
      for (let h = horaIni; h < HORA_FIM; h++) {
        for (let min = 0; min < 60; min += 15) {
          const slot = spDate(y, m, d, h, min);
          if (slotDisponivel(slot.getTime(), agora.getTime(), occ)) return slot;
        }
      }
    }
    ({ y, m, d } = proximoDia(y, m, d));
  }
  return spDate(base.y, base.m, base.d, HORA_INI, 0);
}

// Data-base (dia + hora preferida) em SP a partir da faixa do lead
function dataBaseDaFaixa(faixa: string): { y: number; m: number; d: number; h: number } {
  const horaPref = horaDaFaixa(faixa);
  const n = nowSP();
  // "mesmo dia se der tempo": se a hora preferida de hoje (SP) ainda não passou, usa hoje; senão amanhã
  if (horaPref > n.h) return { y: n.y, m: n.m, d: n.d, h: horaPref };
  const prox = proximoDia(n.y, n.m, n.d);
  return { ...prox, h: horaPref };
}

function montarObservacao(fields: FieldItem[]): string {
  // monta um resumo legível do questionário, omitindo campos já mapeados
  const skip = new Set(['first_name', 'full_name', 'email', 'whatsapp_number', 'phone_number', 'city', 'inbox_url']);
  const linhas: string[] = [];
  for (const f of fields) {
    const nm = f.name.toLowerCase();
    if (skip.has(nm)) continue;
    if (nm.includes('horário') || nm.includes('horario') || nm.includes('hoario')) continue;
    if (f.values && f.values[0]) linhas.push(`${f.name}: ${f.values[0]}`);
  }
  return linhas.join(' · ');
}

// ===== Confirmação no WhatsApp (no momento do agendamento) =====
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

function formatarQuandoSP(slot: Date): { diaSemana: string; data: string; hora: string } {
  const f = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts }).formatToParts(slot);
  const wd = f({ weekday: 'long' }).find(p => p.type === 'weekday')?.value || '';
  const dp = f({ day: '2-digit', month: '2-digit' });
  const dia = dp.find(p => p.type === 'day')?.value || '';
  const mes = dp.find(p => p.type === 'month')?.value || '';
  const tp = f({ hour: '2-digit', minute: '2-digit', hour12: false });
  const hh = tp.find(p => p.type === 'hour')?.value || '';
  const mm = tp.find(p => p.type === 'minute')?.value || '';
  return { diaSemana: wd, data: `${dia}/${mes}`, hora: `${hh}h${mm}` };
}

function primeiroNomeLead(nome: string): string {
  const n = (nome || '').trim().split(/\s+/)[0] || '';
  return n && n.toLowerCase() !== 'lead' ? n : '';
}

// Mensagem aspiracional de confirmação. Não derruba o sync se o envio falhar.
async function enviarConfirmacao(telefone: string, nome: string, consultor: string, slot: Date) {
  if (!telefone) return;
  const { diaSemana, data, hora } = formatarQuandoSP(slot);
  const oi = primeiroNomeLead(nome);
  const msg =
    `Olá${oi ? ' ' + oi : ''}! 🌞\n\n` +
    `Sua avaliação gratuita de energia solar com *${consultor}*, da *Irmãos na Obra*, está *confirmada* para *${diaSemana}, ${data}, às ${hora}*.\n\n` +
    `Prepare-se para uma boa notícia: vamos te mostrar como o seu telhado pode gerar a sua própria energia — e quanto você vai *deixar de pagar todo mês* pra companhia de luz. ☀️\n\n` +
    `Esse dinheiro que hoje some na conta de energia volta pro seu bolso e vira o que *você* decidir: aquela viagem em família, a troca do carro, terminar a reforma da casa… 💸\n\n` +
    `Energia solar não é gasto — é o investimento mais inteligente que existe pra fazer o seu dinheiro render por mais de 25 anos.\n\n` +
    `Deixe o telefone à mão na ${diaSemana}. ${consultor} vai te ligar pra te mostrar tudo, sem compromisso. Até lá! 🤝\n\n` +
    `_Equipe Irmãos na Obra ☀️_`;
  try {
    await sendWhatsApp(telefone, msg, 'io');
  } catch (e) {
    logger.error('leads-meta', `falha ao enviar confirmação p/ ${telefone}`, e);
  }
}

export async function syncLeadsMeta(): Promise<{ novos: number; agendados: number; erros: number }> {
  if (!SU_TOKEN) throw new Error('META_SYSTEM_USER_TOKEN ausente');
  let novos = 0, agendados = 0, erros = 0;

  // estado: cutoff + índice rodízio
  const { data: stateRows } = await supabaseGerador
    .from('leads_meta_state').select('*').eq('id', 1).limit(1);
  const state = stateRows && stateRows[0] ? stateRows[0] : { cutoff_time: new Date().toISOString(), rodizio_idx: 0 };
  const cutoffUnix = Math.floor(new Date(state.cutoff_time).getTime() / 1000);
  let rodizioIdx = state.rodizio_idx || 0;

  const pageToken = await getPageToken();
  const forms = await listActiveForms(pageToken);

  let maxCreated = cutoffUnix;

  for (const formId of forms) {
    const leads = await fetchLeadsSince(formId, pageToken, cutoffUnix);
    for (const lead of leads) {
      try {
        const createdUnix = Math.floor(new Date(lead.created_time).getTime() / 1000);
        if (createdUnix > maxCreated) maxCreated = createdUnix;

        // já existe?
        const { data: existe } = await supabaseGerador
          .from('leads_meta').select('lead_id').eq('lead_id', lead.id).limit(1);
        if (existe && existe.length > 0) continue;

        const fields = lead.field_data || [];
        const nome = fieldVal(fields, 'first_name', 'full_name') || 'Lead Instagram';
        const whatsapp = fieldVal(fields, 'whatsapp_number', 'phone_number').replace(/[^\d]/g, '');
        const email = fieldVal(fields, 'email');
        const cidade = fieldVal(fields, 'city');
        const faixa = fieldContains(fields, 'horário', 'horario', 'hoario');

        const naArea = await dentroDaArea(cidade);
        const obs = montarObservacao(fields);

        let agendadoId: number | null = null;
        let consultor: string | null = null;

        if (naArea) {
          // dentro da área: acha slot+consultor respeitando rodízio e bloqueios
          const base = dataBaseDaFaixa(faixa);
          const escolha = await acharSlotRodizio(rodizioIdx, base);
          consultor = escolha.consultor;
          rodizioIdx++;  // avança a vez do rodízio quando agenda de fato
          const slot = escolha.slot;

          const { data: agIns, error: agErr } = await supabaseGerador
            .from('agendamentos')
            .insert({
              vendedor_nome: consultor,
              quando: slot.toISOString(),
              cliente_nome: nome,
              cliente_telefone: whatsapp,
              observacao: obs ? `[Lead Instagram] ${obs}` : '[Lead Instagram]',
              status: 'agendado',
              created_by: 'lead-meta',
            })
            .select('id')
            .single();

          agendadoId = agErr ? null : (agIns as any)?.id ?? null;
          if (agErr) { logger.error('leads-meta', 'erro criar agendamento', agErr); erros++; }
          else {
            agendados++;
            // confirmação aspiracional no WhatsApp (best-effort, não derruba o sync)
            await enviarConfirmacao(whatsapp, nome, consultor, slot);
          }
        }
        // fora da área: não agenda, não consome rodízio — só registra com fora_area=true

        // grava lead
        await supabaseGerador.from('leads_meta').insert({
          lead_id: lead.id,
          form_id: formId,
          created_time: lead.created_time,
          nome, whatsapp, email, cidade,
          field_data: fields,
          agendado_id: agendadoId,
          consultor,
          fora_area: !naArea,
        });
        novos++;
      } catch (e) {
        logger.error('leads-meta', 'erro processar lead', e);
        erros++;
      }
    }
  }

  // atualiza estado: cutoff = lead mais novo processado; rodízio persistido
  await supabaseGerador.from('leads_meta_state').update({
    cutoff_time: new Date(maxCreated * 1000).toISOString(),
    rodizio_idx: rodizioIdx,
    updated_at: new Date().toISOString(),
  }).eq('id', 1);

  logger.info('leads-meta', `sync: ${novos} novos, ${agendados} agendados, ${erros} erros`);
  return { novos, agendados, erros };
}

// One-shot: realinha agendamentos de leads antigos pro horário SP correto.
// Recalcula o slot a partir da faixa de horário salva em leads_meta.field_data.
// NÃO reenvia WhatsApp. Roda via endpoint protegido.
export async function realinharAgendamentosLeadMeta(): Promise<{ realinhados: number; erros: number }> {
  let realinhados = 0, erros = 0;
  // leads que viraram card (agendado_id não nulo)
  const { data: leads } = await supabaseGerador
    .from('leads_meta')
    .select('agendado_id, consultor, field_data')
    .not('agendado_id', 'is', null);
  if (!leads) return { realinhados: 0, erros: 0 };

  for (const lead of leads as any[]) {
    try {
      const fields = (lead.field_data || []) as FieldItem[];
      const faixa = fieldContains(fields, 'horário', 'horario', 'hoario');
      const consultor = lead.consultor || CONSULTORES_RODIZIO[0];
      const base = dataBaseDaFaixa(faixa);
      const slot = await slotLivreConsultor(consultor, base);
      const { error } = await supabaseGerador
        .from('agendamentos')
        .update({ quando: slot.toISOString() })
        .eq('id', lead.agendado_id)
        .neq('status', 'cancelado');
      if (error) { erros++; logger.error('leads-meta', 'erro realinhar', error); }
      else realinhados++;
    } catch (e) {
      erros++;
      logger.error('leads-meta', 'erro realinhar lead', e);
    }
  }
  logger.info('leads-meta', `realinhamento: ${realinhados} ok, ${erros} erros`);
  return { realinhados, erros };
}
