// ════════════════════════════════════════════════════════════
// INTERSOLAR SOUTH AMERICA 2026 — aviso aos clientes pagantes
// ════════════════════════════════════════════════════════════
// Uma mensagem, uma vez, pra quem paga SolarDoc: estaremos na Intersolar.
//
// DATAS CONFERIDAS na fonte oficial (intersolar.net.br/dados-do-evento, lido em
// 25/08/2026): 25 a 27 de agosto de 2026, Expo Center Norte, Rua José Bernardo
// Pinto 333 — Vila Guilherme/SP, das 12h às 20h. Nada além disso é afirmado na
// mensagem: NÃO temos número de stand, NÃO está definido quais dias cada sócio
// vai. Inventar "passa no stand X" pra 69 clientes pagantes é o único erro aqui
// que o cliente vê na hora — por isso o CTA é responder no próprio número.
//
// SEM DATA RELATIVA no texto. O envio escorre por ~2 dias no teto da linha, então
// "hoje" e "amanhã" estariam errados pra maioria de quem recebe. "25 a 27 de
// agosto" lê certo em qualquer um dos três dias — inclusive no último.
//
// QUEM ENTRA: plano pro/ilimitado com billing_status=active — "cliente" é quem
// paga. Os 115 free ficam de fora (é aviso de relacionamento, não campanha de
// aquisição). Fora também: admin e quem pediu opt-out de WhatsApp.
//
// TELEFONE: users.whatsapp está vazio em 2/3 da base. Com o fallback de
// sales.phone (checkout) e company.whatsapp (o que eles publicam nos próprios
// documentos) a cobertura é 69/69. Mesma escada da pesquisaSatisfacao.
//
// ANTI-BLOQUEIO: esta campanha NÃO tem cadência própria e NÃO cria orçamento
// novo. Ela pede vez no MESMO teto da Carla (dentroDoTetoCarla + marcarEnvioCarla),
// que é o orçamento único da linha solardoc — e que já cobre o desvio pra linha IO
// quando ZAPI_SOLARDOC_VIA_IO=1. Na prática: 4/h no teto, 10–15 min sorteados entre
// um envio e o seguinte, só entre 9h e 20h BRT e nunca no domingo. Um cliente = uma
// mensagem, sem sequência, sem segundo toque.
//
// Idempotente por system_state (intersolar_sent:<user_id>) — chave, não coluna:
// migration que não sobe = campanha muda em silêncio. Essa chave é SÓ marcador de
// idempotência e por isso NÃO entra em BOT_SENT_PREFIXES: quem conta envio pro teto
// é o carla_sent: que marcarEnvioCarla grava. Contar as duas seria contar em dobro.
//
// LIGADA (o Thiago pediu o disparo em 25/08). Pra parar no meio: INTERSOLAR_OFF=1
// na Vercel, sem deploy. Prévia sem enviar: GET /cron/intersolar
// ════════════════════════════════════════════════════════════

import { supabase } from '../utils/supabase';
import { sendFrio, fmtPhone } from './agents/zapiClient';
import { dentroDaJanelaDiurna } from './agents/whatsapp/lineThrottle';
import { dentroDoTetoCarla, marcarEnvioCarla } from './agents/whatsapp/carlaThrottle';
import { logger } from '../utils/logger';

const CHAVE = (userId: string) => `intersolar_sent:${userId}`;

// Pega e-mail torto antes de qualquer coisa (a base tem "…@gmail.coms").
const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const TLD_TORTO = /\.com[a-z]$/i;

// ─── Helpers copiados da pesquisaSatisfacao de propósito ─────────────────────
// São 20 linhas. Exportar de lá acoplaria uma campanha de 2 dias a um serviço que
// está no ar e rodando — o custo de duplicar é menor que o de mexer nele agora.

/**
 * Primeiro nome só quando é NOME DE GENTE. O campo recebe razão social digitada
 * pelo próprio cliente: "American Energy Solar" viraria "Oi American," e
 * "67.010.604 RONAILSON…" viraria "Oi 67.010.604,". Sem nome de pessoa a mensagem
 * abre com "Oi," — que no WhatsApp é natural, ao contrário de um merge quebrado.
 */
function primeiroNomeDeGente(nome: string | null): string | null {
  const inteiro = (nome || '').trim();
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

export interface ClienteIntersolar {
  userId: string;
  email: string;
  nome: string | null;
  primeiroNome: string | null;
  telefone: string | null;
  /** De onde veio o número — users, sales ou company. */
  fonteTelefone: string | null;
  plano: string;
  /** Último documento gerado (ordena a fila: quem está trabalhando ouve antes). */
  ultimoDoc: string | null;
  jaEnviado: boolean;
}

/** Todo cliente pagante com telefone — a mesma lista que o envio consome. */
export async function listarClientesIntersolar(): Promise<ClienteIntersolar[]> {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, nome, whatsapp, plano, billing_status, whatsapp_opt_out, is_admin')
    .in('plano', ['pro', 'ilimitado'])
    .eq('billing_status', 'active');

  if (error) throw new Error(`intersolar: falha lendo users — ${error.message}`);

  type U = {
    id: string; email: string; nome: string | null; whatsapp: string | null; plano: string;
    whatsapp_opt_out: boolean | null; is_admin: boolean | null;
  };
  const elegiveis = ((users as U[]) || []).filter(
    (u) => !u.is_admin && !u.whatsapp_opt_out && EMAIL_OK.test(u.email || '') && !TLD_TORTO.test(u.email || ''),
  );
  if (!elegiveis.length) return [];

  const ids = elegiveis.map((u) => u.id);
  const emails = elegiveis.map((u) => (u.email || '').toLowerCase());

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

  // sales dá o telefone confirmado no checkout (melhor que o comercial) e — o que
  // salva a saudação — o NOME que a pessoa digitou pra pagar. users.nome só serve
  // pra 21 dos 68: está vazio na maioria e, quando existe, metade das vezes é
  // razão social ("Vs Solar", "American Energy Solar"). sales.nome é sempre gente
  // ("Carlos Nascimento", "Vanderlei S Silva") e leva a saudação a 48 dos 68.
  const { data: vendas } = await supabase
    .from('sales')
    .select('email, phone, nome, created_at')
    .in('email', emails)
    .order('created_at', { ascending: false });

  const telDaVenda = new Map<string, string>();
  const nomeDaVenda = new Map<string, string>();
  for (const s of (vendas as { email: string; phone: string | null; nome: string | null }[]) || []) {
    const chave = (s.email || '').toLowerCase();
    const t = telefoneValido(s.phone);
    if (t && !telDaVenda.has(chave)) telDaVenda.set(chave, t);
    // Passa pelo MESMO filtro de "isso é nome de gente?" — quem paga como PJ
    // digita a razão social no checkout, e aí a saudação genérica é a certa.
    const n = primeiroNomeDeGente(s.nome);
    if (n && !nomeDaVenda.has(chave)) nomeDaVenda.set(chave, n);
  }

  // Último documento — só pra ORDENAR. Quem está com proposta na mão hoje é quem
  // mais tem motivo pra estar na feira, então ouve primeiro. Não filtra ninguém:
  // cliente pagante que nunca gerou nada continua na lista, no fim.
  //
  // O limite de 1000 é DE PROPÓSITO e não é truncamento acidental: esses users têm
  // 1.838 documentos no total e o PostgREST corta em 1000 de qualquer jeito. Como a
  // ordem é created_at DESC, as 1000 linhas lidas são as 1000 MAIS RECENTES — então
  // todo mundo com atividade recente sai com a data certa, e quem ficou de fora sai
  // com null e cai no fim da fila, que é exatamente onde "menos ativo" pertence.
  const { data: docs } = await supabase
    .from('documents')
    .select('user_id, created_at')
    .in('user_id', ids)
    .order('created_at', { ascending: false })
    .limit(1000);

  const ultimoDoc = new Map<string, string>();
  for (const d of (docs as { user_id: string; created_at: string }[]) || []) {
    if (!ultimoDoc.has(d.user_id)) ultimoDoc.set(d.user_id, d.created_at);
  }

  // Idempotência: quem já recebeu está carimbado em system_state.
  const { data: marcas } = await supabase
    .from('system_state')
    .select('key')
    .like('key', 'intersolar_sent:%');
  const enviados = new Set(((marcas as { key: string }[]) || []).map((m) => m.key.split(':')[1]));

  return elegiveis
    .map((u) => {
      const doPerfil = telefoneValido(u.whatsapp);
      const daVenda = telDaVenda.get((u.email || '').toLowerCase()) || null;
      const daEmpresa = telDaEmpresa.get(u.id) || null;
      const telefone = doPerfil || daVenda || daEmpresa;

      return {
        userId: u.id,
        email: u.email,
        nome: (u.nome || '').trim() || nomeDaEmpresa.get(u.id) || null,
        primeiroNome: primeiroNomeDeGente(u.nome) || nomeDaVenda.get((u.email || '').toLowerCase()) || null,
        telefone,
        fonteTelefone: doPerfil ? 'users' : daVenda ? 'sales' : daEmpresa ? 'company' : null,
        plano: u.plano,
        ultimoDoc: ultimoDoc.get(u.id) || null,
        jaEnviado: enviados.has(u.id),
      } as ClienteIntersolar;
    })
    .sort((a, b) => (b.ultimoDoc || '').localeCompare(a.ultimoDoc || ''));
}

// Fecho rotacionado. Não é enfeite: 69 mensagens byte a byte idênticas saindo da
// mesma linha é a assinatura que o WhatsApp lê como robô (mesma razão do sufixo
// rotacionado do broadcast de 1º de maio). O miolo — data, endereço, convite — é
// igual pra todo mundo; só a última linha varia.
const FECHOS = [
  'Abraço, e boa feira.',
  'Abraço, e nos vemos por lá.',
  'Abraço.',
];

/**
 * Mensagem única, uma bolha só. Sem link e sem botão de propósito: o que a gente
 * quer é resposta nesse mesmo número, e link em primeiro toque é o que faz a
 * mensagem parecer disparo.
 */
export function textoIntersolar(c: ClienteIntersolar, giro = 0): string {
  const ola = c.primeiroNome ? `Oi ${c.primeiroNome}, ` : 'Oi, ';
  const fecho = FECHOS[giro % FECHOS.length];

  return `${ola}aqui é o Thiago do SolarDoc.

Estamos na Intersolar South America esse ano — 25 a 27 de agosto, no Expo Center Norte (Rua José Bernardo Pinto, 333 — Vila Guilherme, São Paulo), das 12h às 20h.

Se você também vai, me chama aqui nesse número. Marco de sentar com você nem que seja pra um café: conversar com quem usa o SolarDoc todo dia me ensina mais do que qualquer pesquisa que eu mande por aqui, e é assim que eu decido o que construir depois.

E se não der pra ir, me fala também. Eu volto de lá com o que vi de novo em módulo, inversor e linha de financiamento, e mando o resumo pra você direto.

${fecho}`;
}

export interface ResultadoIntersolar {
  enviado: string | null;
  restantes: number;
  elegiveis: number;
  semTelefone: number;
  motivo?: string;
}

/**
 * Manda UMA mensagem por chamada, se a linha permitir. Sem loop de propósito: o
 * espaçamento de 10–15 min é gate pré-claim, então o segundo envio do mesmo tick
 * seria recusado de qualquer jeito (e a função da Vercel morre em 300s antes de
 * chegar a hora do próximo). Quem faz a fila andar é a frequência do tick.
 */
export async function dispararIntersolar(): Promise<ResultadoIntersolar> {
  const todos = await listarClientesIntersolar();
  const semTelefone = todos.filter((c) => !c.telefone).length;
  const fila = todos.filter((c) => !c.jaEnviado && c.telefone);

  const base = { enviado: null, restantes: fila.length, elegiveis: todos.length, semTelefone };

  if ((process.env.INTERSOLAR_OFF || '').trim() === '1') {
    return { ...base, motivo: 'parada por INTERSOLAR_OFF=1' };
  }
  // A FEIRA ACABA SOZINHA — o convite tinha que acabar junto.
  //
  // Em 02/09/2026 esta campanha ainda estava convidando cliente pagante para uma
  // feira encerrada em 27/08: 45 pessoas já tinham recebido e ~24 seguiam na fila,
  // com o último envio às 13h19 daquele dia. A data estava escrita no comentário do
  // topo deste arquivo desde o primeiro commit, e em lugar nenhum no código.
  //
  // O convite escorre por dias de propósito (4/h no teto da Carla, janela diurna,
  // sem domingo), então "mandei tudo no mesmo dia" nunca foi verdade aqui: uma fila
  // que leva mais de uma semana para drenar OBRIGATORIAMENTE atravessa o evento.
  // Depender de alguém lembrar de pôr INTERSOLAR_OFF=1 no dia certo é depender do
  // esquecimento — e o esquecimento ganhou por seis dias.
  //
  // Convite para data que passou nao e so inutil: ele diz ao cliente que paga que
  // ninguém aqui está olhando. Fecha no fim do último dia da feira, no fuso de
  // Brasília, porque é o fuso em que a feira aconteceu.
  const ULTIMO_DIA_BRT = Date.parse('2026-08-27T23:59:59-03:00');
  if (Date.now() > ULTIMO_DIA_BRT) {
    return { ...base, motivo: 'a feira acabou em 27/08/2026 — convite encerrado' };
  }
  if (!fila.length) return { ...base, restantes: 0, motivo: 'ninguém pendente' };
  if (!dentroDaJanelaDiurna()) return { ...base, motivo: 'fora da janela diurna' };
  if (!(await dentroDoTetoCarla())) return { ...base, motivo: 'teto/espaçamento da linha' };

  // Marca ANTES de enviar, e com INSERT — não upsert. Aqui tem uma corrida que a
  // pesquisaSatisfacao (de onde este desenho veio) nunca teve, porque ela só tem um
  // chamador: esta rota tem DOIS. O master é '0 * * * *' e o workflow é '*/10', e
  // os dois batem no minuto :00 de toda hora. Nesse instante as duas invocações leem
  // o mesmo fila[0], as duas passam no gate da linha (que é pré-claim) e as duas
  // enviam — cliente pagante recebendo a mesma mensagem duas vezes.
  //
  // O upsert NÃO resolve: o segundo simplesmente sobrescreve e segue. Já o insert
  // estoura na primary key de system_state.key, então quem perde a corrida sai sem
  // enviar. A reserva vira atômica: um cliente, um envio, mesmo com N ticks juntos.
  const c = fila[0];
  const agora = new Date().toISOString();
  const { error: erroDaReserva } = await supabase.from('system_state').insert(
    { key: CHAVE(c.userId), value: { sent_at: agora, email: c.email }, updated_at: agora },
  );
  if (erroDaReserva) {
    return { ...base, motivo: `outro tick pegou ${c.email} primeiro` };
  }

  // O giro do fecho vem de quantos já saíram — determinístico e sem estado novo.
  const giro = todos.length - fila.length;

  try {
    await sendFrio(c.telefone as string, [textoIntersolar(c, giro)], 'solardoc');
    await marcarEnvioCarla(c.userId);
    logger.info('intersolar', `enviado pra ${c.email} (${c.fonteTelefone}), restam ${fila.length - 1}`);
    return { ...base, enviado: c.email, restantes: fila.length - 1 };
  } catch (err) {
    // Falhou de verdade → devolve pra fila.
    await supabase.from('system_state').delete().eq('key', CHAVE(c.userId));
    logger.error('intersolar', `falha enviando pra ${c.email}`, err);
    return { ...base, motivo: `falha no envio: ${String(err)}` };
  }
}
