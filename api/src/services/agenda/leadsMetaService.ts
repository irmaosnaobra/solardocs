import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { montarObservacaoSolar, organizarFicha, medirTemperatura } from './leadSolarFicha';

// Telefone de cada consultor do rodízio (mesmo mapa que a Luma usa pra chamar consultor).
const TEL_CONSULTOR: Record<string, string> = {
  thiago: '34991360223',
  diego: '34991360172',
  nilce: '34991516846',
};

// Puxa leads dos formulários (Lead Ads) da página "Irmãos na Obra" no Meta,
// distribui no rodízio Thiago→Diego→Nilce e cria um card na agenda pra cada lead.

const GRAPH = 'https://graph.facebook.com/v21.0';
const PAGE_ID = process.env.META_LEADS_PAGE_ID || '704395102766155';
const SU_TOKEN = process.env.META_SYSTEM_USER_TOKEN || '';

const CONSULTORES_RODIZIO = ['Thiago', 'Diego', 'Nilce'];
const HORA_INI = 8;   // agenda abre 08:00
const HORA_FIM = 20;  // fecha 20:00

// Normaliza uma hora pra dentro do expediente [HORA_INI, HORA_FIM].
function clampHora(h: number): number {
  if (h < HORA_INI) return HORA_INI;
  if (h > HORA_FIM) return HORA_FIM;
  return h;
}

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

// Extrai o FIM da faixa de horário (último número), pra decidir se a janela
// ainda está aberta hoje. "15h às 18h"→18, "08 a 10"→10, "13 a 15"→15.
// Faixa de número único / palavra-chave / vazia → fim do expediente (HORA_FIM),
// pq não há limite superior explícito do que o lead aceita.
function horaFimDaFaixa(txt: string): number {
  if (!txt) return HORA_FIM;
  const t = txt.toLowerCase();
  // todos os números do texto (em ordem) — o último é o fim da janela
  const nums = (t.match(/\d{1,2}/g) || []).map(n => parseInt(n, 10));
  if (nums.length >= 2) return clampHora(nums[nums.length - 1]);
  if (nums.length === 1) {
    // único número: "após 18" / "a partir das 13" → janela aberta até o fim
    if (t.includes('após') || t.includes('apos') || t.includes('partir')) return HORA_FIM;
    // "até as 11" → o número é o teto
    if (t.includes('até') || t.includes('ate')) return clampHora(nums[0]);
    // número solto (ex: "16") → faixa de ~1h a partir dele
    return clampHora(nums[0] + 1);
  }
  if (t.includes('manh')) return 12;
  if (t.includes('tarde')) return 18;
  if (t.includes('noite')) return HORA_FIM;
  return HORA_FIM;
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

// DDDs que são certeza de atendimento. Se o lead vier com cidade errada/abreviada
// ou fora da lista (ex: "Udi" = Uberlândia), o DDD garante o agendamento.
// 34 = Triângulo/Alto Paranaíba, 64 = Sudoeste de GO, 16 = Ribeirão Preto/Franca-SP.
const DDDS_AREA = new Set(['34', '64', '16']);

// Padroniza celular BR → 55 + DDD + 9 + 8 dígitos (13). Mantém como veio se não
// for celular reconhecível (fixo/curto). Mesma regra do front (agenda/CRM).
function normalizeTelBR(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return '55' + d;
  if (d.length === 10 && '6789'.includes(d[2])) return '55' + d.slice(0, 2) + '9' + d.slice(2);
  return (raw || '').replace(/\D/g, '');
}

// Extrai o DDD de um whatsapp brasileiro (só dígitos). Tolera com/sem 55.
// "553491949201" → "34"; "5564999413671" → "64"; "34999..." → "34"
function dddDoWhatsapp(whatsapp: string): string {
  const d = (whatsapp || '').replace(/[^\d]/g, '');
  if (d.startsWith('55') && d.length >= 4) return d.slice(2, 4);
  if (d.length >= 2) return d.slice(0, 2);
  return '';
}

// True se o lead está na área: cidade na tabela cidades_atendimento OU,
// quando a cidade vem errada/abreviada/fora da lista, DDD 34/64/16.
async function dentroDaArea(cidade: string, whatsapp: string): Promise<boolean> {
  const norm = normalizarCidade(cidade);
  if (norm) {
    const { data } = await supabaseGerador
      .from('cidades_atendimento')
      .select('id')
      .eq('cidade_normalizada', norm)
      .limit(1);
    if (data && data.length > 0) return true;
  }
  // cidade não bateu (ou veio vazia) → DDD decide
  return DDDS_AREA.has(dddDoWhatsapp(whatsapp));
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

// Slot livre pra um consultor FIXO. Respeita bloqueios/ocupação dele,
// achando outro horário livre se o pedido estiver indisponível.
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

// Data-base (dia + hora preferida) em SP a partir da faixa do lead.
//
// Regra: agenda DENTRO da janela pedida sempre que ela ainda estiver aberta hoje.
// O lead pode estar com o celular na mão — quanto antes contatar, melhor.
//   chegou 14h, faixa 15-18 → hoje, base 15h  (janela ainda não abriu)
//   chegou 16h, faixa 15-18 → hoje, base 16h  (no meio da janela → "já liga")
//   chegou 18:01, faixa 15-18 → amanhã, base 15h  (janela fechou)
// A precisão de minutos ("chegou 15:10 → marca 15:15") sai de graça do
// slotLivreConsultor, que pula slots já no passado na grade de 15min.
function dataBaseDaFaixa(faixa: string): { y: number; m: number; d: number; h: number } {
  const horaIni = horaDaFaixa(faixa);
  const horaFim = horaFimDaFaixa(faixa);
  const n = nowSP();
  // janela ainda aberta hoje? (n.h < fim da faixa) → agenda hoje
  if (n.h < horaFim) {
    // base = início da faixa, ou agora se já estamos dentro dela
    return { y: n.y, m: n.m, d: n.d, h: Math.max(horaIni, n.h) };
  }
  // janela fechou hoje → amanhã no início da faixa
  const prox = proximoDia(n.y, n.m, n.d);
  return { ...prox, h: horaIni };
}

// A ficha (ordem fixa + temperatura) vive em leadSolarFicha — ver o porquê lá.
function montarObservacao(fields: FieldItem[]): string {
  return montarObservacaoSolar(fields as any).replace(/^\[Lead Instagram\]\n?/, '');
}

/** Avisa o consultor da vez no WhatsApp, com a ficha organizada e a temperatura. */
async function avisarConsultor(consultor: string, lead: {
  nome: string; whatsapp: string; cidade: string; quando: Date; fields: FieldItem[];
}): Promise<void> {
  const numero = TEL_CONSULTOR[consultor.toLowerCase()];
  if (!numero) { logger.error('leads-meta-alerta', `sem telefone pro consultor ${consultor}`); return; }

  const t = medirTemperatura(lead.fields as any);
  const ficha = organizarFicha(lead.fields as any);
  // Sol = energia solar (o eletroposto usa ♻️): dá pra saber a linha e a
  // temperatura batendo o olho na notificação, sem abrir a mensagem.
  const SOL: Record<string, string> = { quente: '☀️☀️☀️', morno: '☀️☀️', frio: '☀️' };
  const NOME: Record<string, string> = { quente: '*LEAD QUENTE*', morno: '*Lead morno*', frio: '*Lead frio*' };
  const selo = `${SOL[t.nivel]} ${NOME[t.nivel]}`;
  const quando = lead.quando.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });

  const msg = [
    `*NOVO LEAD — ENERGIA SOLAR*`,
    selo,
    ...(t.porque.length ? [`_${t.porque.join(' · ')}_`] : []),
    ``,
    `*Contato em:* ${quando}`,
    ``,
    `*Cliente:* ${lead.nome}`,
    `*WhatsApp:* wa.me/${(lead.whatsapp || '').replace(/\D/g, '')}`,
    `*Cidade:* ${lead.cidade || '—'}`,
    ``,
    ...ficha.map(l => `*${l.rotulo}:* ${l.valor}`),
    ``,
    `_Veja no CRM: solardoc.app/gerador_`,
  ].join('\n');

  try {
    await sendWhatsApp(numero, msg, 'io');
    logger.info('leads-meta-alerta', `${consultor} avisado do lead ${lead.nome} (${t.nivel}, ${t.pontos}pts)`);
  } catch (err) {
    // Alerta é conveniência: o lead JÁ está no CRM. Falha aqui não derruba o sync.
    logger.error('leads-meta-alerta', `falha avisando ${consultor} do lead ${lead.nome}`, err);
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

  // Junta os leads de TODOS os forms num array só e ordena por chegada
  // (created_time ascendente). Crítico pro rodízio: a Graph API devolve os
  // leads de cada form em ordem decrescente (mais novo 1º) e processamos um
  // form por vez — sem reordenar, o rodízio Thiago→Diego→Nilce é atribuído
  // fora da ordem de chegada e embaralha na tela. Ordena por epoch (não string).
  const todosLeads: Array<{ lead: RawLead; formId: string }> = [];
  for (const formId of forms) {
    const leads = await fetchLeadsSince(formId, pageToken, cutoffUnix);
    for (const lead of leads) todosLeads.push({ lead, formId });
  }
  todosLeads.sort(
    (a, b) => new Date(a.lead.created_time).getTime() - new Date(b.lead.created_time).getTime(),
  );

  {
    for (const { lead, formId } of todosLeads) {
      try {
        const createdUnix = Math.floor(new Date(lead.created_time).getTime() / 1000);
        if (createdUnix > maxCreated) maxCreated = createdUnix;

        // já existe?
        const { data: existe } = await supabaseGerador
          .from('leads_meta').select('lead_id').eq('lead_id', lead.id).limit(1);
        if (existe && existe.length > 0) continue;

        const fields = lead.field_data || [];
        const nome = fieldVal(fields, 'first_name', 'full_name') || 'Lead Instagram';
        const whatsapp = normalizeTelBR(fieldVal(fields, 'whatsapp_number', 'phone_number'));
        const email = fieldVal(fields, 'email');
        const cidade = fieldVal(fields, 'city');
        const faixa = fieldContains(fields, 'horário', 'horario', 'hoario');

        const naArea = await dentroDaArea(cidade, whatsapp);
        const obs = montarObservacaoSolar(fields);

        let agendadoId: number | null = null;
        let consultor: string | null = null;

        if (naArea) {
          // Rodízio SEMPRE em ordem (Thiago→Diego→Nilce), sem pular ninguém.
          // O consultor da vez é fixo; se bloqueado/ocupado no horário pedido,
          // agenda ele em OUTRO horário livre dele (não passa pro próximo).
          consultor = CONSULTORES_RODIZIO[rodizioIdx % CONSULTORES_RODIZIO.length];
          rodizioIdx++;
          const base = dataBaseDaFaixa(faixa);
          const slot = await slotLivreConsultor(consultor, base);

          const { data: agIns, error: agErr } = await supabaseGerador
            .from('agendamentos')
            .insert({
              vendedor_nome: consultor,
              quando: slot.toISOString(),
              cliente_nome: nome,
              cliente_telefone: whatsapp,
              cidade: cidade || null,
              observacao: obs,   // ficha já vem pronta e em ordem fixa (leadSolarFicha)
              status: 'agendado',
              created_by: 'lead-meta',
            })
            .select('id')
            .single();

          agendadoId = agErr ? null : (agIns as any)?.id ?? null;
          if (agErr) { logger.error('leads-meta', 'erro criar agendamento', agErr); erros++; }
          else {
            agendados++;
            // Avisa o consultor da vez. Fire-and-forget: o lead já está no CRM,
            // um WhatsApp que falha não pode derrubar o sync dos outros leads.
            void avisarConsultor(consultor, {
              nome, whatsapp, cidade, quando: slot, fields,
            });
          }
          // confirmação no WhatsApp: enviada pelo cron processarLembretesAgenda
          // (com retry até entregar) — não inline, pra "sem falhar".
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
