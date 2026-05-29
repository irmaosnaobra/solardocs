import { supabaseGerador } from '../../utils/supabaseGerador';
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

// Próximo slot livre pro consultor a partir de (dia, horaPreferida)
async function acharSlot(consultor: string, base: Date): Promise<Date> {
  // tenta a hora preferida; se ocupada, avança de 15min até HORA_FIM; senão próximo dia útil 08:00
  const tentativa = new Date(base);
  for (let dia = 0; dia < 7; dia++) {
    const d = new Date(tentativa);
    d.setDate(d.getDate() + dia);
    // pula fim de semana
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;

    let horaIni = dia === 0 ? d.getHours() : HORA_INI;
    let minIni = dia === 0 ? d.getMinutes() : 0;
    if (horaIni < HORA_INI) { horaIni = HORA_INI; minIni = 0; }

    for (let h = horaIni; h < HORA_FIM; h++) {
      for (let m = (h === horaIni ? minIni : 0); m < 60; m += 15) {
        const slot = new Date(d);
        slot.setHours(h, m, 0, 0);
        if (slot < new Date()) continue; // não agenda no passado
        const iso = slot.toISOString();
        const { data } = await supabaseGerador
          .from('agendamentos')
          .select('id')
          .eq('vendedor_nome', consultor)
          .eq('quando', iso)
          .neq('status', 'cancelado')
          .limit(1);
        if (!data || data.length === 0) return slot;
      }
    }
  }
  // fallback: agora + 1h
  const fb = new Date();
  fb.setHours(fb.getHours() + 1, 0, 0, 0);
  return fb;
}

// Calcula a data-base (dia + hora preferida) a partir da faixa do lead
function dataBaseDaFaixa(faixa: string): Date {
  const horaPref = horaDaFaixa(faixa);
  const agora = new Date();
  const hoje = new Date(agora);
  hoje.setHours(horaPref, 0, 0, 0);
  // "mesmo dia se der tempo": se a hora preferida de hoje ainda não passou, usa hoje; senão amanhã
  if (hoje > agora) return hoje;
  const amanha = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(horaPref, 0, 0, 0);
  return amanha;
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
          // dentro da área: rodízio + agendamento automático
          consultor = CONSULTORES_RODIZIO[rodizioIdx % CONSULTORES_RODIZIO.length];
          rodizioIdx++;  // só avança a vez do rodízio quando agenda de fato

          const base = dataBaseDaFaixa(faixa);
          const slot = await acharSlot(consultor, base);

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
          else agendados++;
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
