// ─────────────────────────────────────────────────────────────────────────────
// RESUMO DO DIA — sai às 23:55, no WhatsApp do dono.
//
// ── O QUE ESTA MENSAGEM NÃO PODE PROMETER ───────────────────────────────────
// O pedido foi "a origem dos novos seguidores do dia". Nenhuma API do Instagram
// entrega isso: a Graph devolve o TOTAL de seguidores (`followers_count`) e o
// alcance, e nunca quem seguiu nem por onde. Não existe UTM em botão de seguir.
//
// Então a mensagem separa duas coisas que são fáceis de confundir, e diz qual é
// qual em voz alta:
//
//   SALDO DO DIA      total de hoje menos o total de ontem. É um saldo, não uma
//                     contagem: quem seguiu e quem deixou de seguir se anulam
//                     dentro dele. Guardamos o total de cada dia na tabela
//                     ig_seguidores_dia justamente porque a API não dá o delta.
//
//   O QUE EMPURRAMOS  quantos cliques NOSSOS foram para o perfil, e de qual
//                     lugar de qual página. Isso é medido de verdade (lp_events)
//                     e é a única "origem" que existe honestamente aqui. Não é a
//                     origem do seguidor; é o esforço que a gente fez.
//
// Ligar uma coisa na outra é trabalho de quem lê: se o saldo sobe nos dias em
// que a tela de recusa empurrou mais, a tela está funcionando.
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { getIgConfig, getInsights } from './igClient';
import { logger } from '../../utils/logger';

const FUSO = 'America/Sao_Paulo';

/** O dia de hoje em Brasília, no formato YYYY-MM-DD. */
function hojeBR(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(agora);
}

/** Início do dia de Brasília em ISO, para comparar com colunas timestamptz. */
function inicioDoDiaISO(dia: string): string {
  // BRT é UTC-3 o ano inteiro desde 2019 (não há mais horário de verão).
  return `${dia}T03:00:00.000Z`;
}

function fimDoDiaISO(dia: string): string {
  const d = new Date(`${dia}T03:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

const num = (n: number) => n.toLocaleString('pt-BR');

/** "+7", "-2", "0" — com sinal, porque saldo sem sinal não diz nada. */
function comSinal(n: number): string {
  return n > 0 ? `+${num(n)}` : num(n);
}

export interface ResumoDoDia {
  dia: string;
  texto: string;
  seguidores: { total: number | null; saldo: number | null; alcance: number | null };
  empurroes: Array<{ lugar: string; n: number }>;
  agendamentos: number;
  nota1: number;
}

/**
 * Lê o Instagram, grava o total de hoje e devolve o saldo contra ontem.
 * Se o token estiver fora do ar, devolve nulos: o resto do resumo continua
 * saindo. Relatório que não sai por causa de uma parte é relatório que ninguém
 * confia.
 */
async function lerInstagram(dia: string) {
  const vazio = { total: null as number | null, saldo: null as number | null, alcance: null as number | null };
  try {
    const cfg = await getIgConfig();
    if (!cfg?.access_token || !cfg?.ig_user_id) return vazio;

    const ins = await getInsights(cfg.ig_user_id, cfg.access_token);
    const total = Number(ins?.profile?.followers_count);
    if (!Number.isFinite(total)) return vazio;

    const alcance = Number(ins?.alcance?.data?.[0]?.total_value?.value);
    const alcanceOk = Number.isFinite(alcance) ? alcance : null;

    // o total de ONTEM, que é o que transforma um número num saldo
    const ontem = new Date(`${dia}T12:00:00Z`);
    ontem.setUTCDate(ontem.getUTCDate() - 1);
    const diaOntem = ontem.toISOString().slice(0, 10);

    const { data: linhaOntem } = await supabase
      .from('ig_seguidores_dia').select('total').eq('dia', diaOntem).maybeSingle();

    // grava o de hoje ANTES de devolver: se a mensagem falhar depois, o número
    // do dia não se perde e o saldo de amanhã continua certo
    await supabase.from('ig_seguidores_dia')
      .upsert({ dia, total, alcance_dia: alcanceOk }, { onConflict: 'dia' });

    const saldo = linhaOntem?.total != null ? total - Number(linhaOntem.total) : null;
    return { total, saldo, alcance: alcanceOk };
  } catch (err) {
    logger.error('resumo-dia', 'instagram falhou', err);
    return vazio;
  }
}

/** Cliques NOSSOS que foram para o perfil, por lugar de onde saíram. */
async function lerEmpurroes(dia: string) {
  try {
    const { data } = await supabase
      .from('lp_events')
      .select('event_data')
      .eq('event_type', 'cta_click')
      .gte('created_at', inicioDoDiaISO(dia))
      .lt('created_at', fimDoDiaISO(dia));

    const conta = new Map<string, number>();
    for (const linha of data ?? []) {
      const d = (linha as { event_data?: Record<string, unknown> }).event_data ?? {};
      if (d.label !== 'instagram') continue;
      const lugar = String(d.source ?? 'sem lugar');
      conta.set(lugar, (conta.get(lugar) ?? 0) + 1);
    }
    return [...conta.entries()].map(([lugar, n]) => ({ lugar, n })).sort((a, b) => b.n - a.n);
  } catch (err) {
    logger.error('resumo-dia', 'empurroes falharam', err);
    return [];
  }
}

/** O funil do eletroposto mora no banco do GERADOR, não no do SolarDoc. */
async function lerFunil(dia: string) {
  const de = inicioDoDiaISO(dia), ate = fimDoDiaISO(dia);
  let agendamentos = 0, nota1 = 0;
  try {
    const { count } = await supabaseGerador
      .from('agendamentos').select('id', { count: 'exact', head: true })
      .gte('created_at', de).lt('created_at', ate);
    agendamentos = count ?? 0;
  } catch (err) { logger.error('resumo-dia', 'agendamentos falharam', err); }
  try {
    const { count } = await supabaseGerador
      .from('eletroposto_nota1').select('id', { count: 'exact', head: true })
      .gte('created_at', de).lt('created_at', ate);
    nota1 = count ?? 0;
  } catch (err) { logger.error('resumo-dia', 'nota1 falhou', err); }
  return { agendamentos, nota1 };
}

/** Visitas do dia por página, das duas landings que empurram pro perfil. */
async function lerVisitas(dia: string) {
  try {
    const { data } = await supabase
      .from('page_visits').select('landing_url')
      .gte('created_at', inicioDoDiaISO(dia)).lt('created_at', fimDoDiaISO(dia));
    const conta = new Map<string, number>();
    for (const l of data ?? []) {
      const url = String((l as { landing_url?: string }).landing_url ?? '');
      let caminho = '(sem url)';
      try { caminho = new URL(url).pathname.replace(/\/$/, '') || '/'; } catch { /* url torta */ }
      conta.set(caminho, (conta.get(caminho) ?? 0) + 1);
    }
    return [...conta.entries()].map(([caminho, n]) => ({ caminho, n }))
      .sort((a, b) => b.n - a.n).slice(0, 6);
  } catch (err) {
    logger.error('resumo-dia', 'visitas falharam', err);
    return [];
  }
}

export async function montarResumoDoDia(agora = new Date()): Promise<ResumoDoDia> {
  const dia = hojeBR(agora);
  const [ig, empurroes, funil, visitas] = await Promise.all([
    lerInstagram(dia), lerEmpurroes(dia), lerFunil(dia), lerVisitas(dia),
  ]);

  const dataBR = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO, weekday: 'short', day: '2-digit', month: '2-digit',
  }).format(agora);

  const L: string[] = [];
  L.push(`*RESUMO DO DIA* · ${dataBR}`);
  L.push('');

  // ── Instagram ──
  L.push('*INSTAGRAM* @irmaosnaobra__');
  if (ig.total == null) {
    L.push('Não consegui ler o perfil hoje. Pode ser token vencido: confira em /admin.');
  } else {
    L.push(ig.saldo == null
      ? `${num(ig.total)} seguidores. Primeiro dia medindo, então ainda não há saldo pra comparar.`
      : `${num(ig.total)} seguidores (${comSinal(ig.saldo)} hoje)`);
    if (ig.alcance != null) L.push(`Alcance do dia: ${num(ig.alcance)}`);
  }
  L.push('');

  // ── o que NÓS empurramos ──
  const totalEmpurrao = empurroes.reduce((s, e) => s + e.n, 0);
  L.push('*DE ONDE MANDAMOS GENTE PRO PERFIL*');
  if (!totalEmpurrao) {
    L.push('Nenhum clique nosso hoje.');
  } else {
    for (const e of empurroes) L.push(`  ${e.lugar}: ${num(e.n)}`);
    L.push(`  total: ${num(totalEmpurrao)}`);
  }
  L.push('_O Instagram não diz de onde vem seguidor, nenhuma API diz._');
  L.push('_Isto é o que a gente empurrou, medido no clique._');
  L.push('');

  // ── funil ──
  L.push('*ELETROPOSTO*');
  L.push(`Reuniões marcadas: ${num(funil.agendamentos)}`);
  L.push(`NOTA 1 (sem o ponto): ${num(funil.nota1)}`);
  L.push('');

  // ── páginas ──
  if (visitas.length) {
    L.push('*VISITAS*');
    for (const v of visitas) L.push(`  ${v.caminho}: ${num(v.n)}`);
  }

  return {
    dia,
    texto: L.join('\n'),
    seguidores: ig,
    empurroes,
    agendamentos: funil.agendamentos,
    nota1: funil.nota1,
  };
}
