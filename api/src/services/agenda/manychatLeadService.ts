// ─────────────────────────────────────────────────────────────────────────────
// Ingestão de lead QUENTE vindo do ManyChat (Instagram DM) → Gerador (CRM).
//
// POR QUE ISSO EXISTE
// O fluxo de boas-vindas do ManyChat qualifica o seguidor e, pros produtos
// consultivos (energia solar da Irmãos na Obra e investidor de Eletroposto),
// precisa DEPOSITAR o lead no mesmo CRM/agenda que o Meta Lead Ads (leadsMeta)
// e a LP do eletroposto já usam — roteado pro consultor da vez, com aviso no
// WhatsApp.
//
// EXCEÇÃO DO ELETROPOSTO (19/08/2026): ele deixou de marcar agenda por aqui. O
// lead de Instagram vira ficha e é convidado pra LP, que é onde a régua NOTA
// 1/2/3 roda. Ver `registrarLeadIgParaLP` mais abaixo e o tick
// `eletropostoIgConvite`. O solar segue igual. O ManyChat só sabe fazer HTTP (External Request); ele NÃO escreve
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
import { proximoDaContaBaixa } from './filaContaBaixa';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import {
  normalizeTelBR,
  dentroDaArea,
  dataBaseDaFaixa,
  slotLivreConsultor,
  donoDoTelefone,
} from './leadsMetaService';
import {
  montarObservacaoSolar, organizarFicha, FieldItem,
  consumoTipico, TIME_CONTA_ALTA, KWH_CORTE_TIME,
} from './leadSolarFicha';
// Quem GRAVA a ficha de Instagram e quem MANDA o convite têm que concordar na
// mesma palavra de origem — por isso ela vem de lá, não é literal daqui.
import { ORIGEM_IG } from '../io/eletropostoIgConvite';

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

// Roteamento por tamanho de conta (regra do Thiago, 12/08/2026). Aqui o lead
// responde em REAIS ("R$ 800 a R$ 1.500"), então a unidade vai explícita: o corte
// é em kWh/mês e quem converte é o consumoTipico.
function ehContaAltaReais(valorConta: string): boolean {
  return consumoTipico(valorConta || '', 'reais') > KWH_CORTE_TIME;
}
async function consultorDoLeadSolar(valorConta: string, rodizioIdx: number): Promise<string> {
  return ehContaAltaReais(valorConta)
    ? TIME_CONTA_ALTA[rodizioIdx % TIME_CONTA_ALTA.length]
    : proximoDaContaBaixa();
}

// Sintetiza o field_data (formato do Meta) a partir da ficha do ManyChat, pra
// reusar organizarFicha/montarObservacaoSolar sem inventar dado que o lead não deu.
// ATENÇÃO: o valor_conta entra no campo "Consumo" em REAIS (é o que o lead
// respondeu) — o formulário do Meta preenche o mesmo campo em kWh. Quem roteia
// tem que dizer a unidade; nunca deduza pelo nome do campo.
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

/**
 * Lead de ELETROPOSTO que veio do Instagram: não marca agenda, mas a equipe
 * fica sabendo. O aviso precisa dizer o que NÃO aconteceu — sem isso ele seria
 * lido como a antiga "NOVA REUNIÃO" e alguém apareceria num horário que não existe.
 */
async function avisarLeadIgSemAgenda(lead: {
  nome: string; whatsapp: string; cidade: string; capital: string; perfil: string; temperatura: string;
}): Promise<void> {
  const msg = [
    `*LEAD DO INSTAGRAM — ELETROPOSTO*`,
    `_Sem reunião marcada: ele foi convidado a preencher a LP, que é onde a régua roda._`,
    ``,
    `*Cliente:* ${lead.nome}`,
    `*WhatsApp:* wa.me/${soDigitos(lead.whatsapp)}`,
    `*Cidade/Ponto:* ${lead.cidade || '—'}`,
    `*Perfil:* ${lead.perfil || '—'}`,
    `*Investimento pretendido:* ${lead.capital || '—'}`,
    ``,
    `_Se ele preencher, a reunião nasce sozinha com a nota. Pra puxar antes, é na mão pelo link acima._`,
  ].join('\n');
  const alvos = [TEL_CONSULTOR.thiago, TEL_CONSULTOR.diego];
  const envios = await Promise.allSettled(alvos.map((n) => sendWhatsApp(n, msg, 'io')));
  envios.forEach((e, i) => {
    if (e.status === 'rejected') logger.error('manychat-lead', `falha avisando lead IG #${i}`, e.reason);
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
    // Dry-run tem que mostrar o roteamento DE VERDADE (é pra isso que ele
    // existe): lê o dono do telefone e o tamanho da conta, sem gravar nada. O
    // rodízio é espiado sem avançar o contador.
    const donoTeste = naArea ? await donoDoTelefone(whatsapp) : null;
    const { data: stTeste } = await supabaseGerador
      .from('leads_meta_state').select('rodizio_idx').eq('id', 1).limit(1);
    return {
      ok: true, test: true, produto: 'solar', destino: 'GERADOR',
      na_area: naArea, temperatura,
      consultor: naArea
        ? (donoTeste || await consultorDoLeadSolar(p.valor_conta || '', (stTeste && stTeste[0]?.rodizio_idx) || 0))
        : undefined,
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
    // Cliente que JÁ tem dono fica com ele — nunca vira 2 consultores e não gasta
    // uma vez do rodízio. Só lead realmente novo gira o contador.
    const dono = await donoDoTelefone(whatsapp);
    if (dono) {
      consultor = dono;
    } else if (!ehContaAltaReais(p.valor_conta || '')) {
      // Abaixo de 700 kWh/mês (ou sem faixa respondida): é da fila da conta baixa
      // (3 Nilce, 1 Giovanna) e não gasta uma vez da fila do Thiago/Diego.
      consultor = await proximoDaContaBaixa();
    } else {
      // Conta alta: rodízio Thiago↔Diego compartilhando o contador com o cron do
      // Meta (leads_meta_state) — um lead é um lead, os dois recebem em rodízio
      // justo venha da onde vier. Read-modify-write não-atômico (mesmo
      // risco/volume do cron).
      const { data: stateRows } = await supabaseGerador
        .from('leads_meta_state').select('rodizio_idx').eq('id', 1).limit(1);
      const idx = (stateRows && stateRows[0]?.rodizio_idx) || 0;
      consultor = TIME_CONTA_ALTA[idx % TIME_CONTA_ALTA.length];
      await supabaseGerador.from('leads_meta_state')
        .update({ rodizio_idx: idx + 1, updated_at: new Date().toISOString() }).eq('id', 1);
    }

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

/**
 * ELETROPOSTO DO INSTAGRAM NÃO MARCA AGENDA — VAI PRA LP (19/08/2026).
 *
 * Ordem do Thiago: "está chegando alguns curiosos de eletroposto e frios; eles
 * têm que ser convencidos a passar pelo solardoc.app/io/eletroposto e não marcar
 * agenda direta."
 *
 * O que este caminho fazia até hoje: quem largava um telefone num comentário ou
 * numa DM abria uma REUNIÃO de verdade na agenda do Thiago ou do Diego. Os três
 * cards que existem são a prova — os três `agendado`, cidade nula, capital nulo,
 * ponto nulo, e a observação afirmando "Lead qualificado no Instagram" sobre um
 * lead de quem a gente só tinha o número. O último ocupou as 8h da manhã.
 *
 * A régua que decide quem merece reunião (NOTA 1/2/3) mora DENTRO da LP: é ela
 * que pergunta o local, o decisor, a entrada trifásica e devolve a simulação. A
 * DM não pergunta nada disso — nenhum lead de Instagram tem como provar que é
 * NOTA 2, nem o que vem do ManyChat com a faixa de capital respondida (faixa de
 * dinheiro não é ponto definido). Por isso o corte é seco e vale pros três
 * canais que caem aqui: comentário do IG, Messenger e webhook do ManyChat.
 *
 * O lead NÃO se perde: vira ficha em `eletroposto_nota1` com origem
 * `instagram_dm`, e o tick eletropostoIgConvite manda UM convite pra página
 * dentro da janela diurna (ver o arquivo dele pro porquê de não sair daqui).
 *
 * Kill-switch pra voltar ao comportamento antigo: EP_IG_AGENDA_DIRETA=1.
 */
async function registrarLeadIgParaLP(
  p: ManychatLeadPayload, nome: string, whatsapp: string, temperatura: string,
): Promise<IngestResult> {
  const cidadePonto = (p.cidade || '').trim();
  const capital = (p.capital || '').trim();
  const perfil = (p.perfil || '').trim();

  // Idempotência: a mesma pessoa comentando três vezes não vira três fichas nem
  // três convites. Chave é DDD + 8 últimos, a mesma do CRM (donoDoTelefone) —
  // e o DDD é confirmado AQUI, não no ilike: o PostgREST só sabe filtrar pelos 8
  // últimos, e sem o DDD dois clientes de estados diferentes viram o mesmo, com
  // o segundo sumindo em silêncio como "duplicado".
  const chaveTel = (raw: unknown): string | null => {
    const d = String(raw ?? '').replace(/\D/g, '').replace(/^55/, '');
    return d.length < 10 ? null : d.slice(0, 2) + d.slice(-8);
  };
  const alvo = chaveTel(whatsapp);
  const { data: jaTem } = await supabaseGerador
    .from('eletroposto_nota1').select('id, telefone')
    .eq('origem', ORIGEM_IG)
    .ilike('telefone', `%${soDigitos(whatsapp).slice(-8)}`)
    .limit(20);
  if (alvo && (jaTem ?? []).some((f: { telefone?: string }) => chaveTel(f.telefone) === alvo)) {
    return { ok: true, duplicado: true, produto: 'eletroposto', destino: 'LP', temperatura };
  }

  // A ficha guarda o que a DM realmente respondeu e NADA além. `invest`/`ponto`
  // ficam vazios de propósito: o trigger do banco deriva os slugs dos RÓTULOS da
  // LP ("Recurso próprio", "Já tenho o ponto definido"), e a DM pergunta outra
  // coisa (faixa de dinheiro). Escrever ali faria a ficha aparecer na aba
  // Investidores afirmando uma resposta que ninguém deu.
  const ficha = [
    `INSTAGRAM ELETROPOSTO — ${perfil || '—'}`,
    `Investimento pretendido: ${capital || '—'}`,
    `Cidade/ponto informado: ${cidadePonto || '—'}`,
    `Chegou por: DM/comentário do Instagram (${p.contact_id || 'sem contact_id'})`,
    `→ Sem reunião marcada: convidado a preencher a LP (é lá que a régua roda)`,
  ].join('\n');

  const { data, error } = await supabaseGerador
    .from('eletroposto_nota1')
    .insert({
      nome, telefone: whatsapp,
      cidade: cidadePonto || null,
      perfil: perfil || null,
      email: p.email || null,
      ficha,
      origem: ORIGEM_IG,
      utm_source: 'instagram',
      utm_medium: 'dm',
    })
    .select('id')
    .single();

  if (error) {
    logger.error('manychat-lead', 'erro gravando ficha de IG do eletroposto', error);
    return { ok: false, motivo: 'erro ao gravar ficha' };
  }

  // O aviso continua saindo, mudou o que ele diz. Thiago reclamou de curioso na
  // AGENDA, não de deixar de saber que o lead existe — e diferente da recusa em
  // massa da LP (onde o silêncio foi decisão de 18/08), aqui tem uma pessoa que
  // entregou o telefone na DM. O recado é interno, pra 2 contatos salvos, e diz
  // na cara que NÃO há reunião: quem quiser puxar na mão tem o número.
  await avisarLeadIgSemAgenda({ nome, whatsapp, cidade: cidadePonto, capital, perfil, temperatura });

  logger.info('manychat-lead', `eletroposto/IG: ${nome} (${temperatura}) → ficha ${data?.id}, convite da LP na fila`);
  return {
    ok: true, produto: 'eletroposto', destino: 'LP', temperatura,
    motivo: 'lead de Instagram não marca agenda direta — convidado pra LP',
  };
}

async function ingestEletroposto(p: ManychatLeadPayload, nome: string, whatsapp: string): Promise<IngestResult> {
  const cidadePonto = (p.cidade || '').trim();
  const capital = (p.capital || '').trim();
  const perfil = (p.perfil || '').trim();
  const temperatura = tempEletroposto(capital);
  const agendaDireta = (process.env.EP_IG_AGENDA_DIRETA || '').trim() === '1';

  if (p.test) {
    return {
      ok: true, test: true, produto: 'eletroposto',
      destino: agendaDireta ? 'GERADOR' : 'LP', temperatura,
      ...(agendaDireta ? {} : { motivo: 'lead de Instagram não marca agenda direta — convidado pra LP' }),
    };
  }

  if (!agendaDireta) return registrarLeadIgParaLP(p, nome, whatsapp, temperatura);

  // Idempotência: card manychat_eletroposto do mesmo telefone nas últimas 24h.
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: dup } = await supabaseGerador
    .from('agendamentos').select('id')
    .eq('cliente_telefone', whatsapp).eq('created_by', 'manychat_eletroposto')
    .gte('created_at', desde).limit(1);
  if (dup && dup.length > 0) {
    return { ok: true, duplicado: true, produto: 'eletroposto', destino: 'GERADOR' };
  }

  // Cliente que já tem dono fica com ele (nunca 2 consultores). Só cliente novo
  // entra no rodízio Thiago/Diego pela contagem de cards de eletroposto (LP + ManyChat).
  let dono = await donoDoTelefone(whatsapp);
  if (!dono) {
    const { count } = await supabaseGerador
      .from('agendamentos').select('id', { count: 'exact', head: true })
      .in('created_by', ['lp_eletroposto', 'manychat_eletroposto']);
    dono = DONOS_ELETRO[(count || 0) % DONOS_ELETRO.length];
  }

  const base = dataBaseDaFaixa('');
  // lead de ELETROPOSTO: pode cair à tarde, que é justamente o turno de eletroposto
  // do Thiago e do Diego. Só o card de solar deles é que foi pra manhã.
  const quando = await slotLivreConsultor(dono, base, 'eletroposto');

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
