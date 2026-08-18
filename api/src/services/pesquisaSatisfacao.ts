// ════════════════════════════════════════════════════════════
// PESQUISA COM OS 10 MAIS CONTÍNUOS — WhatsApp, ago/2026
// ════════════════════════════════════════════════════════════
// Três perguntas por WhatsApp pra quem usa o SolarDoc quase todo dia útil: o
// que mais ajuda, com o que comparou, e o que quase fez largar. A resposta cai
// na linha e é lida por gente — não tem formulário, porque /sugestoes já existe
// dentro do app há meses e está com ZERO linha: pesquisa passiva não é lida.
//
// QUEM ENTRA — ordem do Thiago (18/08): os mais ATUANTES, medidos por
// continuidade e não por volume. A régua é dia útil trabalhado: dias distintos
// com documento ÷ dias úteis disponíveis desde que a pessoa entrou (teto de 30
// dias). Quem fez 300 documentos em 3 dias e sumiu não é uso contínuo; quem faz
// 5 por dia, todo dia, é.
//
// Os pisos existem por dois motivos opostos: >= 5 dias ativos derruba quem entrou
// anteontem e marcaria 100% com 2 dias de amostra; usou nos últimos 3 dias
// derruba quem foi contínuo e parou (leoimplant, 36% e 11 dias sumido — esse é
// caso de winback, não de pesquisa).
//
// TELEFONE: `users.whatsapp` está vazio na maioria — o número vem então de
// `sales.phone` (checkout) ou `company.whatsapp` (o que eles publicam nos
// próprios documentos). Com as três fontes a cobertura é 10/10.
//
// ANTI-BLOQUEIO — a linha solardoc já foi derrubada por rajada, então esta
// campanha NÃO tem cadência própria: ela pede vez no MESMO orçamento da Carla
// (dentroDoTetoCarla + marcarEnvioCarla), que é o teto único da linha física.
// Na prática: 4/h no máximo, com 10–15 min de intervalo sorteado entre um envio
// e o seguinte, só entre 9h e 20h e nunca no domingo. Cada chamada manda UMA
// mensagem e vai embora — os 10 escorrem em um dia útil, que é exatamente o
// ritmo que não chama atenção. Uma pessoa = uma mensagem, sem sequência.
//
// Idempotente por users.pesquisa_sent_at. LIGADA (autorizada em 18/08); para
// parar no meio: PESQUISA_WHATSAPP_OFF=1 na Vercel, sem deploy.
// ════════════════════════════════════════════════════════════

import { supabase } from '../utils/supabase';
import { sendFrio, fmtPhone } from './agents/zapiClient';
import { dentroDaJanelaDiurna } from './agents/whatsapp/lineThrottle';
import { dentroDoTetoCarla, marcarEnvioCarla } from './agents/whatsapp/carlaThrottle';
import { logger } from '../utils/logger';

const TOP_N = 10;           // quantos convidados no total (ordem do Thiago, 18/08)
const JANELA_DIAS = 30;     // janela de medição do uso
const MIN_DIAS_ATIVOS = 5;  // piso de amostra
const MAX_DIAS_SUMIDO = 3;  // continuidade vale no presente, não no passado

// Pega e-mail torto antes de qualquer coisa (a base tem "…@gmail.coms").
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const TLD_TORTO = /\.com[a-z]$/i;

const DIA_MS = 24 * 60 * 60 * 1000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ehDiaUtil = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;

/** Dias úteis entre duas datas (inclusive), na régua de datas puras. */
function diasUteisEntre(inicio: Date, fim: Date): number {
  let n = 0;
  for (let t = inicio.getTime(); t <= fim.getTime(); t += DIA_MS) {
    if (ehDiaUtil(new Date(t))) n++;
  }
  return n;
}

/**
 * Primeiro nome só quando é NOME DE GENTE, e só de users.nome. O fallback de
 * company é razão social: "67.010.604 RONAILSON KLESLEY…" viraria "Oi 67.010.604,"
 * e "American Energy Solar" viraria "Oi American,". Sem nome de pessoa a mensagem
 * abre com "Oi," — que no WhatsApp é natural, ao contrário de um merge quebrado.
 */
function primeiroNomeDeGente(nome: string | null): string | null {
  const inteiro = (nome || '').trim();
  // users.nome também recebe razão social digitada pelo próprio cliente:
  // "American Energy Solar" está lá e viraria "Oi American,".
  if (/\b(solar|energ|eletric|elétric|engenharia|solu[çc]|ltda|eireli|epp|cia|com[ée]rcio|import|servi[çc]|tecnologia|me)\b/i.test(inteiro)) return null;
  const tok = inteiro.split(/\s+/)[0] || '';
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.-]{1,}$/.test(tok)) return null;
  return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
}

/** Celular brasileiro plausível: 55 + DDD + 8/9 dígitos. */
function telefoneValido(bruto: string | null | undefined): string | null {
  const d = (bruto || '').replace(/\D/g, '');
  if (d.length < 10) return null;
  const cheio = fmtPhone(d);
  return cheio.length === 12 || cheio.length === 13 ? cheio : null;
}

export interface ClientePesquisa {
  userId: string;
  email: string;
  /** Nome exibível — pode ser razão social (só pro preview/relatório). */
  nome: string | null;
  /** Primeiro nome de pessoa, ou null. É o que a saudação usa. */
  primeiroNome: string | null;
  telefone: string | null;
  /** De onde veio o número — users, sales ou company. */
  fonteTelefone: string | null;
  /** Documentos na janela de 30 dias. */
  docs: number;
  /** Dias distintos com documento na janela. */
  diasAtivos: number;
  /** Dias ÚTEIS com documento ÷ dias úteis disponíveis, em %. A régua do ranking. */
  pctDiasUteis: number;
  ultimoDoc: string;
  jaEnviado: boolean;
}

/** Os 10 mais contínuos — mesma lista que o envio usa, exposta pro preview. */
export async function listarMelhoresClientes(): Promise<ClientePesquisa[]> {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp, plano, billing_status, email_opt_out, whatsapp_opt_out, is_admin, pesquisa_sent_at, created_at')
    .in('plano', ['pro', 'ilimitado'])
    .eq('billing_status', 'active');

  if (error) throw new Error(`pesquisa: falha lendo users — ${error.message}`);

  type U = {
    id: string; email: string; nome: string | null; whatsapp: string | null; created_at: string;
    email_opt_out: boolean | null; whatsapp_opt_out: boolean | null;
    is_admin: boolean | null; pesquisa_sent_at: string | null;
  };
  const elegiveis = ((users as U[]) || []).filter(
    (u) => !u.is_admin && !u.whatsapp_opt_out && EMAIL_OK.test(u.email || '') && !TLD_TORTO.test(u.email || ''),
  );
  if (!elegiveis.length) return [];

  const ids = elegiveis.map((u) => u.id);
  const inicioJanela = new Date(Date.now() - (JANELA_DIAS - 1) * DIA_MS);

  const { data: docs, error: docsErr } = await supabase
    .from('documents')
    .select('user_id, created_at')
    .in('user_id', ids)
    .gte('created_at', ymd(inicioJanela));

  if (docsErr) throw new Error(`pesquisa: falha lendo documents — ${docsErr.message}`);

  // company dá as duas coisas que faltam em users: o nome (vazio em metade da
  // base) e o telefone comercial — o mesmo que eles imprimem nos documentos.
  const { data: empresas } = await supabase
    .from('company')
    .select('user_id, nome, nome_fantasia, whatsapp')
    .in('user_id', ids);

  const nomeDaEmpresa = new Map<string, string>();
  const telDaEmpresa = new Map<string, string>();
  for (const c of (empresas as { user_id: string; nome: string | null; nome_fantasia: string | null; whatsapp: string | null }[]) || []) {
    const n = (c.nome_fantasia || c.nome || '').trim();
    if (n && !nomeDaEmpresa.has(c.user_id)) nomeDaEmpresa.set(c.user_id, n);
    const t = telefoneValido(c.whatsapp);
    if (t && !telDaEmpresa.has(c.user_id)) telDaEmpresa.set(c.user_id, t);
  }

  // sales.phone é o telefone confirmado no checkout — melhor que o comercial.
  const { data: vendas } = await supabase
    .from('sales')
    .select('email, phone, created_at')
    .in('email', elegiveis.map((u) => u.email))
    .order('created_at', { ascending: false });

  const telDaVenda = new Map<string, string>();
  for (const s of (vendas as { email: string; phone: string | null }[]) || []) {
    const chave = (s.email || '').toLowerCase();
    const t = telefoneValido(s.phone);
    if (t && !telDaVenda.has(chave)) telDaVenda.set(chave, t);
  }

  const agg = new Map<string, { n: number; dias: Set<string>; diasUteis: Set<string>; ultimo: string }>();
  for (const d of (docs as { user_id: string; created_at: string }[]) || []) {
    const cur = agg.get(d.user_id) || { n: 0, dias: new Set<string>(), diasUteis: new Set<string>(), ultimo: '' };
    const dia = d.created_at.slice(0, 10);
    cur.n++;
    cur.dias.add(dia);
    if (ehDiaUtil(new Date(`${dia}T12:00:00Z`))) cur.diasUteis.add(dia);
    if (d.created_at > cur.ultimo) cur.ultimo = d.created_at;
    agg.set(d.user_id, cur);
  }

  const hoje = new Date(`${ymd(new Date())}T12:00:00Z`);
  const corteSumido = ymd(new Date(Date.now() - MAX_DIAS_SUMIDO * DIA_MS));

  return elegiveis
    .map((u) => {
      const a = agg.get(u.id);
      if (!a) return null;

      // Denominador honesto: quem entrou há 10 dias é medido contra 10 dias,
      // não contra 30 — senão cliente novo e assíduo nunca aparece.
      const entrou = new Date(`${u.created_at.slice(0, 10)}T12:00:00Z`);
      const inicio = entrou > inicioJanela ? entrou : new Date(`${ymd(inicioJanela)}T12:00:00Z`);
      const uteisPossiveis = diasUteisEntre(inicio, hoje);
      const pct = uteisPossiveis > 0 ? Math.round((100 * a.diasUteis.size) / uteisPossiveis) : 0;

      const doPerfil = telefoneValido(u.whatsapp);
      const daVenda = telDaVenda.get((u.email || '').toLowerCase()) || null;
      const daEmpresa = telDaEmpresa.get(u.id) || null;
      const telefone = doPerfil || daVenda || daEmpresa;
      const fonte = doPerfil ? 'users' : daVenda ? 'sales' : daEmpresa ? 'company' : null;

      return {
        userId: u.id,
        email: u.email,
        nome: (u.nome || '').trim() || nomeDaEmpresa.get(u.id) || null,
        primeiroNome: primeiroNomeDeGente(u.nome),
        telefone,
        fonteTelefone: fonte,
        docs: a.n,
        diasAtivos: a.dias.size,
        pctDiasUteis: pct,
        ultimoDoc: a.ultimo,
        jaEnviado: !!u.pesquisa_sent_at,
      } as ClientePesquisa;
    })
    .filter((c): c is ClientePesquisa =>
      !!c && c.diasAtivos >= MIN_DIAS_ATIVOS && c.ultimoDoc.slice(0, 10) >= corteSumido)
    .sort((a, b) => b.pctDiasUteis - a.pctDiasUteis || b.diasAtivos - a.diasAtivos || b.docs - a.docs)
    .slice(0, TOP_N);
}

/**
 * Mensagem única — WhatsApp não é e-mail: uma bolha, sem link, sem botão, e um
 * convite explícito pra responder em áudio (é o que faz integrador responder).
 */
export function textoPesquisa(c: ClientePesquisa): string {
  const ola = c.primeiroNome ? `Oi ${c.primeiroNome}, ` : 'Oi, ';
  const uso = `${c.docs} ${c.docs === 1 ? 'documento' : 'documentos'} em ${c.diasAtivos} dias diferentes`;

  return `${ola}aqui é o Thiago do SolarDoc.

Você é um dos que mais usam a plataforma — ${uso} só nesse último mês. Queria muito te ouvir sobre 3 coisas:

1) O que o SolarDoc mais te ajuda no dia a dia?
2) Antes dele, você fazia isso como? Planilha, Word, outra plataforma?
3) O que ainda falta ou te irrita aqui dentro?

Pode responder por áudio, do jeito que for mais fácil. A 3 é a que mais me interessa — pode ser sincero.

E se a sua resposta ficar boa, posso publicar ela na página do SolarDoc com seu nome e o da sua empresa? É só me falar.`;
}

export interface ResultadoPesquisa {
  enviado: string | null;
  restantes: number;
  elegiveis: number;
  semTelefone: number;
  motivo?: string;
}

/**
 * Manda UMA mensagem por chamada, se a linha permitir. Sem loop de propósito: o
 * espaçamento de 10–15 min é gate pré-claim, então o segundo envio do mesmo tick
 * seria recusado de qualquer jeito. Chamar de hora em hora esvazia a fila.
 */
export async function dispararPesquisaSatisfacao(): Promise<ResultadoPesquisa> {
  const todos = await listarMelhoresClientes();
  const semTelefone = todos.filter((c) => !c.telefone).length;
  const fila = todos.filter((c) => !c.jaEnviado && c.telefone);

  const base = { enviado: null, restantes: fila.length, elegiveis: todos.length, semTelefone };

  if (process.env.PESQUISA_WHATSAPP_OFF === '1') {
    return { ...base, motivo: 'parada por PESQUISA_WHATSAPP_OFF=1' };
  }
  if (!fila.length) return { ...base, restantes: 0, motivo: 'ninguém pendente' };
  if (!dentroDaJanelaDiurna()) return { ...base, motivo: 'fora da janela diurna' };
  if (!(await dentroDoTetoCarla())) return { ...base, motivo: 'teto/espaçamento da linha' };

  // Marca ANTES de enviar. O master cron pode ser disparado por mais de um
  // caminho (GitHub Actions, chamada manual) e dois ticks simultâneos leriam o
  // mesmo fila[0]: o gate da linha é pré-claim e não segura corrida. Marcado
  // antes, o pior caso é alguém ficar sem mensagem; marcado depois, o pior caso
  // é o cliente receber duas — que é justamente o que não pode acontecer aqui.
  const c = fila[0];
  const carimbo = new Date().toISOString();
  await supabase.from('users').update({ pesquisa_sent_at: carimbo }).eq('id', c.userId);

  try {
    await sendFrio(c.telefone as string, [textoPesquisa(c)], 'solardoc');
    await marcarEnvioCarla(c.userId);
    logger.info('pesquisa-satisfacao', `enviado pra ${c.email} (${c.fonteTelefone}), restam ${fila.length - 1}`);
    return { ...base, enviado: c.email, restantes: fila.length - 1 };
  } catch (err) {
    // Falhou de verdade → devolve pra fila (só se ninguém mais mexeu no carimbo).
    await supabase.from('users').update({ pesquisa_sent_at: null })
      .eq('id', c.userId).eq('pesquisa_sent_at', carimbo);
    logger.error('pesquisa-satisfacao', `falha enviando pra ${c.email}`, err);
    return { ...base, motivo: `falha no envio: ${String(err)}` };
  }
}
