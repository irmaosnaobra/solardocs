// ─────────────────────────────────────────────────────────────────────────────
// Ingestão de lead QUENTE vindo do ManyChat (Instagram DM) → Gerador (CRM).
//
// POR QUE ISSO EXISTE
// O fluxo de boas-vindas do ManyChat qualifica o seguidor e, pros produtos
// consultivos (energia solar da Irmãos na Obra e investidor de Eletroposto),
// precisa DEPOSITAR o lead no mesmo CRM/agenda que o Meta Lead Ads (leadsMeta)
// e a LP do eletroposto já usam — roteado pro consultor da vez, com aviso no
// WhatsApp. O ManyChat só sabe fazer HTTP (External Request); ele NÃO escreve
// no Supabase direto (como a LP faz). Então ESTE endpoint recebe a ficha no
// corpo e escreve o card ele mesmo.
//
// SEGURANÇA
// Como confiamos no corpo (não há card pré-escrito pra reler, como no
// /io/eletroposto/alerta), a rota exige um secret (ver routes/gerador.ts).
// Aqui dentro ainda há defesa: idempotência (não duplica card), normalização
// de telefone e dry-run (test:true) que calcula o roteamento sem gravar nem
// disparar WhatsApp — pra validar em produção sem sujar o CRM nem gastar a
// cota da linha (risco de ban da Z-API).
//
// REUSO
// Rodízio, área de atendimento e busca de slot livre são os MESMOS do
// leadsMetaService (exportados de lá) — uma fonte de verdade pra agenda.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import {
  normalizeTelBR,
  dentroDaArea,
  dataBaseDaFaixa,
  slotLivreConsultor,
  CONSULTORES_RODIZIO,
} from './leadsMetaService';
import { montarObservacaoSolar, organizarFicha, FieldItem } from './leadSolarFicha';

// Telefone de cada consultor (mesmo mapa da Luma / leadsMeta / ioEletroposto).
const TEL_CONSULTOR: Record<string, string> = {
  thiago: '34991360223',
  diego: '34991360172',
  nilce: '34991516846',
};

// Time do eletroposto = Thiago/Diego (igual à LP /io/eletroposto).
const DONOS_ELETRO = ['Thiago', 'Diego'];

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');

export interface ManychatLeadPayload {
  produto?: string;          // 'solar' | 'eletroposto'
  nome?: string;
  whatsapp?: string;
  cidade?: string;           // solar: cidade/UF · eletroposto: cidade/ponto
  valor_conta?: string;      // solar
  tipo_telhado?: string;     // solar
  faixa_horario?: string;    // solar (opcional — melhor horário de contato)
  capital?: string;          // eletroposto
  perfil?: string;           // eletroposto
  email?: string;
  contact_id?: string;       // id do assinante ManyChat → idempotência
  test?: boolean;            // dry-run: calcula e retorna, sem gravar nem avisar
}

export interface IngestResult {
  ok: boolean;
  produto?: string;
  destino?: string;
  consultor?: string;
  quando?: string | null;
  temperatura?: string;
  na_area?: boolean;
  duplicado?: boolean;
  test?: boolean;
  motivo?: string;
}

// "R$ 800" → 800 · "R$ 1.500" → 1500 · "mais de R$ 1.500" → 1500
function valorContaNum(v: string): number {
  const nums = (String(v || '').match(/\d[\d.]*/g) || []).map((n) => Number(n.replace(/\./g, '')));
  return nums.length ? Math.max(...nums) : 0;
}

// Um lead que passou pela qualificação da DM e deixou o WhatsApp já é no mínimo
// morno. Conta >= R$800 (o gatilho SOLAR_quente do blueprint) sobe pra quente.
function tempSolar(valorConta: string): 'quente' | 'morno' {
  return valorContaNum(valorConta) >= 800 ? 'quente' : 'morno';
}

// Capital manda no eletroposto (é ele que compra). Mesma lógica de faixa da LP.
function tempEletroposto(capital: string): 'quente' | 'morno' | 'frio' {
  const c = (capital || '').toLowerCase();
  if (!c || /avali|n[aã]o sei/.test(c)) return 'frio';
  if (/300|500|acima/.test(c)) return 'quente';   // 150-300, 300-500, acima de 500
  return 'morno';                                  // até 150 mil
}

// Sintetiza o field_data (formato do Meta) a partir da ficha do ManyChat, pra
// reusar organizarFicha/montarObservacaoSolar sem inventar dado que o lead não deu.
function buildSolarFieldData(p: ManychatLeadPayload, whatsapp: string): FieldItem[] {
  const f: FieldItem[] = [];
  f.push({ name: 'first_name', values: [p.nome || 'Lead Instagram'] });
  f.push({ name: 'whatsapp_number', values: [whatsapp] });
  if (p.cidade) f.push({ name: 'city', values: [p.cidade] });
  if (p.valor_conta) f.push({ name: 'Consumo', values: [p.valor_conta] });
  if (p.tipo_telhado) f.push({ name: 'Telhado', values: [p.tipo_telhado] });
  if (p.faixa_horario) f.push({ name: 'horário', values: [p.faixa_horario] });
  return f;
}

/** Aviso do lead de SOLAR pro consultor da vez (temperatura vem calculada aqui). */
async function avisarSolar(
  consultor: string,
  lead: { nome: string; whatsapp: string; cidade: string; quando: Date; fields: FieldItem[] },
  temperatura: string,
): Promise<void> {
  const numero = TEL_CONSULTOR[consultor.toLowerCase()];
  if (!numero) { logger.error('manychat-lead', `sem telefone pro consultor ${consultor}`); return; }
  const ficha = organizarFicha(lead.fields);
  const SOL: Record<string, string> = { quente: '☀️☀️☀️', morno: '☀️☀️', frio: '☀️' };
  const NOME: Record<string, string> = { quente: '*LEAD QUENTE*', morno: '*Lead morno*', frio: '*Lead frio*' };
  const selo = `${SOL[temperatura] || '☀️'} ${NOME[temperatura] || '*Lead*'}`;
  const quando = lead.quando.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const msg = [
    `*NOVO LEAD — ENERGIA SOLAR* (Instagram/DM)`,
    selo,
    ``,
    `*Contato em:* ${quando}`,
    ``,
    `*Cliente:* ${lead.nome}`,
    `*WhatsApp:* wa.me/${soDigitos(lead.whatsapp)}`,
    `*Cidade:* ${lead.cidade || '—'}`,
    ``,
    ...ficha.map((l) => `*${l.rotulo}:* ${l.valor}`),
    ``,
    `_Veja no CRM: solardoc.app/gerador_`,
  ].join('\n');
  try { await sendWhatsApp(numero, msg, 'io'); }
  catch (err) { logger.error('manychat-lead', `falha avisando ${consultor}`, err); }
}

/** Aviso do lead de ELETROPOSTO pro time (Thiago + Diego), igual à LP. */
async function avisarEletroposto(lead: {
  nome: string; whatsapp: string; cidade: string; capital: string; perfil: string;
  quando: Date; temperatura: string; dono: string;
}): Promise<void> {
  const REC: Record<string, string> = { quente: '♻️♻️♻️', morno: '♻️♻️', frio: '♻️' };
  const NOME: Record<string, string> = { quente: '*LEAD QUENTE*', morno: '*Lead morno*', frio: '*Lead frio*' };
  const selo = `${REC[lead.temperatura] || '♻️'} ${NOME[lead.temperatura] || '*Lead*'}`;
  const quando = lead.quando.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const msg = [
    `*NOVO LEAD — ELETROPOSTO* (Instagram/DM)`,
    selo,
    ``,
    `*Contato em:* ${quando}`,
    `*Com:* ${lead.dono}`,
    ``,
    `*Cliente:* ${lead.nome}`,
    `*WhatsApp:* wa.me/${soDigitos(lead.whatsapp)}`,
    `*Cidade/Ponto:* ${lead.cidade || '—'}`,
    `*Perfil:* ${lead.perfil || '—'}`,
    `*Investimento pretendido:* ${lead.capital || '—'}`,
    ``,
    `_Veja no CRM: solardoc.app/gerador_`,
  ].join('\n');
  const alvos = [TEL_CONSULTOR.thiago, TEL_CONSULTOR.diego];
  const envios = await Promise.allSettled(alvos.map((n) => sendWhatsApp(n, msg, 'io')));
  envios.forEach((e, i) => {
    if (e.status === 'rejected') logger.error('manychat-lead', `falha avisando eletroposto #${i}`, e.reason);
  });
}

/** Lead fora da área de atendimento: não agenda, mas avisa o Thiago pra não perder. */
async function avisarForaArea(produto: string, nome: string, whatsapp: string, cidade: string): Promise<void> {
  const msg = [
    `*LEAD FORA DE ÁREA — ${produto.toUpperCase()}* (Instagram/DM)`,
    `_Chegou pela DM mas a cidade/DDD está fora da área de atendimento — trate manual._`,
    ``,
    `*Cliente:* ${nome}`,
    `*WhatsApp:* wa.me/${soDigitos(whatsapp)}`,
    `*Cidade informada:* ${cidade || '—'}`,
  ].join('\n');
  try { await sendWhatsApp(TEL_CONSULTOR.thiago, msg, 'io'); }
  catch (err) { logger.error('manychat-lead', 'falha avisando fora de área', err); }
}

async function ingestSolar(p: ManychatLeadPayload, nome: string, whatsapp: string): Promise<IngestResult> {
  const cidade = (p.cidade || '').trim();
  const fields = buildSolarFieldData({ ...p, nome }, whatsapp);
  const temperatura = tempSolar(p.valor_conta || '');
  const naArea = await dentroDaArea(cidade, whatsapp);
  const leadId = `mc_${soDigitos(p.contact_id || '') || soDigitos(whatsapp)}`;

  if (p.test) {
    return {
      ok: true, test: true, produto: 'solar', destino: 'GERADOR',
      na_area: naArea, temperatura,
      consultor: naArea ? CONSULTORES_RODIZIO[0] : undefined,
      motivo: naArea ? undefined : 'fora de área (não agenda, avisa manual)',
    };
  }

  // Idempotência: mesmo lead_id não vira card duas vezes (ManyChat pode reenviar).
  const { data: existe } = await supabaseGerador
    .from('leads_meta').select('lead_id').eq('lead_id', leadId).limit(1);
  if (existe && existe.length > 0) {
    return { ok: true, duplicado: true, produto: 'solar', destino: 'GERADOR' };
  }

  let agendadoId: number | null = null;
  let consultor: string | null = null;
  let quando: Date | null = null;

  if (naArea) {
    // Rodízio: compartilha o contador com o cron do Meta (leads_meta_state) —
    // um lead é um lead, os consultores recebem em rodízio justo, venha da
    // onde vier. Read-modify-write não-atômico (mesmo risco/volume do cron).
    const { data: stateRows } = await supabaseGerador
      .from('leads_meta_state').select('rodizio_idx').eq('id', 1).limit(1);
    const idx = (stateRows && stateRows[0]?.rodizio_idx) || 0;
    consultor = CONSULTORES_RODIZIO[idx % CONSULTORES_RODIZIO.length];
    await supabaseGerador.from('leads_meta_state')
      .update({ rodizio_idx: idx + 1, updated_at: new Date().toISOString() }).eq('id', 1);

    const base = dataBaseDaFaixa(p.faixa_horario || '');
    quando = await slotLivreConsultor(consultor, base);
    const obs = montarObservacaoSolar(fields);

    const { data: agIns, error: agErr } = await supabaseGerador
      .from('agendamentos')
      .insert({
        vendedor_nome: consultor,
        quando: quando.toISOString(),
        cliente_nome: nome,
        cliente_telefone: whatsapp,
        cidade: cidade || null,
        temperatura,
        observacao: obs,
        status: 'agendado',
        created_by: 'manychat',
      })
      .select('id')
      .single();

    if (agErr) { logger.error('manychat-lead', 'erro criar agendamento solar', agErr); }
    else {
      agendadoId = (agIns as any)?.id ?? null;
      // AWAIT (não fire-and-forget): serverless congela o processo após a resposta,
      // então um void aqui derrubaria o aviso do consultor. avisarSolar já engole
      // o próprio erro, então awaitar não trava o fluxo se o WhatsApp falhar.
      await avisarSolar(consultor, { nome, whatsapp, cidade, quando, fields }, temperatura);
    }
  } else {
    await avisarForaArea('solar', nome, whatsapp, cidade);
  }

  await supabaseGerador.from('leads_meta').insert({
    lead_id: leadId,
    form_id: 'manychat',
    created_time: new Date().toISOString(),
    nome, whatsapp, email: p.email || '', cidade,
    field_data: fields,
    agendado_id: agendadoId,
    consultor,
    fora_area: !naArea,
  });

  logger.info('manychat-lead', `solar: ${nome} (${temperatura}) ${naArea ? `→ ${consultor}` : 'FORA DE ÁREA'}`);
  return {
    ok: true, produto: 'solar', destino: 'GERADOR', na_area: naArea,
    consultor: consultor || undefined, quando: quando ? quando.toISOString() : null, temperatura,
  };
}

async function ingestEletroposto(p: ManychatLeadPayload, nome: string, whatsapp: string): Promise<IngestResult> {
  const cidadePonto = (p.cidade || '').trim();
  const capital = (p.capital || '').trim();
  const perfil = (p.perfil || '').trim();
  const temperatura = tempEletroposto(capital);

  if (p.test) {
    return { ok: true, test: true, produto: 'eletroposto', destino: 'GERADOR', temperatura };
  }

  // Idempotência: card manychat_eletroposto do mesmo telefone nas últimas 24h.
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: dup } = await supabaseGerador
    .from('agendamentos').select('id')
    .eq('cliente_telefone', whatsapp).eq('created_by', 'manychat_eletroposto')
    .gte('created_at', desde).limit(1);
  if (dup && dup.length > 0) {
    return { ok: true, duplicado: true, produto: 'eletroposto', destino: 'GERADOR' };
  }

  // Rodízio Thiago/Diego pela contagem de cards de eletroposto (LP + ManyChat).
  const { count } = await supabaseGerador
    .from('agendamentos').select('id', { count: 'exact', head: true })
    .in('created_by', ['lp_eletroposto', 'manychat_eletroposto']);
  const dono = DONOS_ELETRO[(count || 0) % DONOS_ELETRO.length];

  const base = dataBaseDaFaixa('');
  const quando = await slotLivreConsultor(dono, base);

  const obs = [
    `INSTAGRAM ELETROPOSTO — ${perfil || '—'}`,
    `Investimento pretendido: ${capital || '—'}`,
    `PONTO: ${cidadePonto || '—'}`,
    `Simulou: via DM (ManyChat)`,
    `→ Lead qualificado no Instagram`,
  ].join('\n');

  const { data: agIns, error: agErr } = await supabaseGerador
    .from('agendamentos')
    .insert({
      vendedor_nome: dono,
      quando: quando.toISOString(),
      cliente_nome: nome,
      cliente_telefone: whatsapp,
      cidade: cidadePonto || null,
      temperatura,
      observacao: obs,
      status: 'agendado',
      created_by: 'manychat_eletroposto',
    })
    .select('id')
    .single();

  if (agErr) { logger.error('manychat-lead', 'erro criar agendamento eletroposto', agErr); return { ok: false, motivo: 'erro ao gravar' }; }

  // AWAIT: serverless congela após a resposta; avisarEletroposto engole erros.
  await avisarEletroposto({ nome, whatsapp, cidade: cidadePonto, capital, perfil, quando, temperatura, dono });

  logger.info('manychat-lead', `eletroposto: ${nome} (${temperatura}) → ${dono}`);
  return { ok: true, produto: 'eletroposto', destino: 'GERADOR', consultor: dono, quando: quando.toISOString(), temperatura };
}

/** Ponto único de entrada do webhook. Roteia por produto. */
export async function ingestManychatLead(p: ManychatLeadPayload): Promise<IngestResult> {
  const produto = (p.produto || '').toLowerCase().trim();
  const nome = (p.nome || '').trim() || 'Lead Instagram';
  const whatsapp = normalizeTelBR(p.whatsapp || '');

  if (soDigitos(whatsapp).length < 12) {
    return { ok: false, motivo: 'whatsapp inválido (precisa DDD + número)' };
  }
  if (produto === 'solar') return ingestSolar(p, nome, whatsapp);
  if (produto === 'eletroposto') return ingestEletroposto(p, nome, whatsapp);
  return { ok: false, motivo: 'produto desconhecido (use "solar" ou "eletroposto")' };
}
