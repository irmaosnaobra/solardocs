import express, { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { supabaseGerador } from '../utils/supabaseGerador';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { fichaSubstituiAviso } from '../services/agentes5040/chaves';
import { gravarCardSolar, gravarCardAgora, cancelarCardsSaiuSemMarcar } from '../services/agentes5040/agendaSolar';
import { logger } from '../utils/logger';
import { cidadeParaGravar } from '../services/io/cidadeCanonica';
import { agendaFechadaNoIso, ehSocio, MOTIVO_FECHADA } from '../services/agenda/agendaFechada';
import { proximoDaContaBaixa } from '../services/agenda/filaContaBaixa';
import { FILA_CONTA_ALTA } from '../services/agenda/leadSolarFicha';
import { estaBloqueado } from '../services/agents/whatsapp/silenciar';
import { FILTRO_NAO_OCUPA } from '../services/agenda/salaDeEspera';
import { ehOrigemEletroposto } from '../services/agenda/origemEtiqueta';
import { ocupacoesSolar } from '../services/agenda/solarOcupacao';
import { lerPaginado } from '../utils/lerPaginado';
import { enviarQuizMeta, navegadorDe, eventIdDe, idDoTelefone } from '../utils/capiQuiz';
import { DONA_SOLAR, PONTOS_CURIOSO, MARCA_QUIZ, decidirCaminho, pontuar, acharCidadeRaio, kwhDaFaixa } from '../services/agenda/solarRota';
import {
  limparRespostas, limparRespostasExtra, limparEndereco, decidirEMontar, montarObservacao, camposDoLead, blocoDaFicha, cabe,
  msDe, DIAS_VARRIDOS, ROTULO_CAMINHO, avisoDaEquipe, calcularDiagnostico, horarioAgoraAberto, quandoDoAgora,
  type Ocupacao, type Respostas, type RespostasExtra, type FichaDoAviso, type Diagnostico,
} from '../services/io/solarQuiz';
import { EQUIPE, TEL_AVISO } from '../services/io/solarEquipe';
import {
  avisarAgora, camposDeRecuperacao, gravarSaida, marcarFalei, nomeDoToken, reivindicar, lerChave, apagarChave,
} from '../services/io/solarQuizAviso';
import { motivoDescarteSolar, cidadeUfDoDescarte, CHAVE_DESCARTADO, type MotivoDescarte } from '../services/io/solarDescarte';
import { soDigitosSolar, telKeySolar, donoDoTelefone } from '../services/io/solarTelefone';
import { quizCardLimiter } from '../middleware/rateLimiter';
import { paginaFalei, TEXTOS_FALEI, horaBonita, type DadosDaFicha, type OndeSaiu } from '../services/io/solarQuizTextos';

// ─────────────────────────────────────────────────────────────────────────────
// Alerta de lead novo da LP de Energia Solar (/io/solar) no WhatsApp da equipe.
//
// Mesma blindagem da LP do eletroposto (ver ioEletroposto.ts): a página é HTML
// público, então este endpoint NÃO confia no corpo — recebe só o id e LÊ a ficha
// do banco. Só ficha created_by='lp_solar', criada nos últimos 10 min, e
// idempotente por id. Sem isso, um curl em loop viraria spam na linha da equipe.
//
// Diferença pro eletroposto: a vistoria é PRESENCIAL, então o endereço vai em
// destaque — é pra lá que o técnico se desloca.
// ─────────────────────────────────────────────────────────────────────────────

const router = Router();

// Exportada porque o solarRespostas.ts precisa do número do dono (thiago) como
// rede: quando a ficha não tem consultor com WhatsApp cadastrado, a resposta do
// cliente ainda tem que cair na mão de alguém. Os números moram em solarEquipe.ts
// (24/10/2026), para os services do quiz não importarem esta rota.
export { EQUIPE, TEL_AVISO };

const JANELA_MS = 10 * 60 * 1000;
const jaAvisado = new Set<number>();

const soDigitos = (s: string) => (s || '').replace(/\D/g, '');

function montarMensagem(a: any): string {
  const quando = a.quando
    ? new Date(a.quando).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit',
        month: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : 'sem horário';

  // A observação já vem estruturada da LP: tipo, conta, imóvel, telhado, etc.
  const obs: string[] = String(a.observacao || '').split('\n').filter(Boolean);
  const tipo = (obs[0] || '').replace('LP SOLAR — ', '') || '—';
  const linha = (rot: string) => obs.find(l => l.startsWith(rot))?.replace(rot, '').trim() || '—';

  // Sol = energia solar (o eletroposto usa ♻️): dá pra saber a linha e a
  // temperatura batendo o olho na notificação, sem abrir a mensagem.
  const temp = String(a.temperatura || '').toLowerCase();
  const SOL: Record<string, string> = { quente: '☀️☀️☀️', morno: '☀️☀️', frio: '☀️' };
  const NOME: Record<string, string> = { quente: '*LEAD QUENTE*', morno: '*Lead morno*', frio: '*Lead frio*' };
  const selo = `${SOL[temp] || '☀️'} ${NOME[temp] || '*Lead*'}`;

  return [
    `*NOVA VISTORIA — ENERGIA SOLAR*`,
    `${selo}`,
    ``,
    `*Quando:* ${quando}`,
    `*Com:* ${a.vendedor_nome || '—'}`,
    ``,
    `*Cliente:* ${a.cliente_nome || '—'}`,
    `*WhatsApp:* wa.me/${soDigitos(a.cliente_telefone)}`,
    `*Endereço:* ${linha('Endereço:')}`,
    `*Cidade:* ${a.cidade || '—'}`,
    ``,
    `*Tipo:* ${tipo}`,
    `*Conta de luz:* ${linha('Conta de luz:')}`,
    `*Imóvel:* ${linha('Imóvel:')}`,
    `*Telhado:* ${linha('Telhado:')}`,
    `*Padrão:* ${linha('Padrão:')}`,
    `*Urgência:* ${linha('Urgência:')}`,
    `*Pagamento:* ${linha('Pagamento:')}`,
    `*Decisor:* ${linha('Decisor:')}`,
    `*Simulou:* ${linha('Simulou:')}`,
    ``,
    `_Veja no CRM: solardoc.app/gerador_`,
  ].join('\n');
}

router.post('/alerta', async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'id invalido' }); return; }
  if (jaAvisado.has(id)) { res.json({ ok: true, ja_avisado: true }); return; }

  try {
    const { data, error } = await supabaseGerador
      .from('agendamentos')
      .select('id,vendedor_nome,quando,cliente_nome,cliente_telefone,cidade,temperatura,observacao,created_at,created_by,status')
      .eq('id', id)
      .eq('created_by', 'lp_solar')   // só ficha da LP solar
      .single();

    if (error || !data) { res.status(404).json({ error: 'nao encontrado' }); return; }

    const idade = Date.now() - new Date(data.created_at).getTime();
    if (idade > JANELA_MS) { res.status(410).json({ error: 'fora da janela' }); return; }

    // Com o interruptor `ficha` ligado o consultor dono do card recebe a ficha (tarefa ficha_5040) no lugar deste
    // aviso à equipe inteira: um aviso só por lead. Cancelado não tem ficha, então segue o aviso de sempre.
    if (await fichaSubstituiAviso(data)) { res.json({ ok: true, enviados: 0, substituido_pela_ficha: true }); return; }

    jaAvisado.add(id);   // marca ANTES de enviar: falha de envio não vira loop de retry
    const msg = montarMensagem(data);

    const envios = await Promise.allSettled(
      Object.values(EQUIPE).map(num => sendWhatsApp(num, msg, 'io')),
    );
    const ok = envios.filter(e => e.status === 'fulfilled').length;
    envios.forEach((e, i) => {
      if (e.status === 'rejected') {
        logger.error('io-solar-alerta', `falhou pra ${Object.keys(EQUIPE)[i]}`, e.reason);
      }
    });

    logger.info('io-solar-alerta', `lead #${id} (${data.temperatura}) avisado a ${ok}/${envios.length}`);
    res.json({ ok: true, enviados: ok });
  } catch (err) {
    logger.error('io-solar-alerta', `erro no lead #${id}`, err);
    res.status(500).json({ error: 'falha' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// A AGENDA DA LP DO SOLAR, SEM CHAVE DE BANCO NO NAVEGADOR
//
// Mesma correção feita na LP do eletroposto em 18/08/2026, pelo mesmo motivo: a
// chave publishable ficava no código-fonte de uma página pública, e as tabelas
// estão com RLS desligada. Conferido com curl de fora: a chave lia as fichas
// inteiras de `eletroposto_nota1` e era aceita num DELETE.
//
// Três rotas, e cada uma devolve só o que a página precisa:
//   GET  /agenda    horários ocupados (timestamp + de quem), sem nome de cliente
//   GET  /cliente   de quem é este telefone
//   POST /agendar   grava a vistoria
//
// A que mais vazava: a página baixava `cliente_telefone` e `quando` de TODO
// mundo cujos 8 últimos dígitos batessem com o número digitado.
// ═══════════════════════════════════════════════════════════════════════════

/** Quem aparece na agenda desta LP, de quem a página precisa ler a ocupação.
 *  Desde 23/09/2026 a Nilce está nos DOIS lados do corte, então os três nomes
 *  aqui cobrem o funil inteiro. A Giovanna não entra: ela não recebe mais lead
 *  novo e nunca teve grade própria nesta página. */
const DONOS_SOLAR = ['Nilce', 'Thiago', 'Diego'];
/** Conta baixa: quem PODE atender. De QUEM É A VEZ não mora aqui: desde
 *  15/09/2026 a página pergunta ao `proximoDaContaBaixa()`
 *  (services/agenda/filaContaBaixa.ts), a mesma pergunta que o Meta e o ManyChat
 *  fazem. Eram duas filas copiadas, e mudar a proporção numa só dava dois
 *  rodízios discordando. Hoje a resposta é sempre 'Nilce'; a Giovanna fica na
 *  lista porque ainda tem ficha e a página precisa aceitá-la como dono válido. */
const TIME_BAIXA = ['Nilce', 'Giovanna'];

router.get('/agenda', async (req: Request, res: Response): Promise<void> => {
  const de = String(req.query.de || '').slice(0, 30);
  const ate = String(req.query.ate || '').slice(0, 30);
  if (!de || !ate) { res.status(400).json({ error: 'de/ate obrigatorios' }); return; }
  try {
    const [ocupadosLidos, altaQ, proximoBaixa] = await Promise.all([
      // Paginado (21/10/2026): era `.limit(500)`, que o PostgREST corta em 1000 e
      // que cortava calado a partir da 501ª linha. Erro em qualquer página lança
      // e cai no catch, que devolve `ocupados: null` (a página abre a grade e a gravação revalida).
      lerPaginado<Record<string, unknown>>('io-solar agenda', (p0, p1) => supabaseGerador.from('agendamentos')
        .select('quando, vendedor_nome, created_by')
        .gte('quando', de).lte('quando', ate)
        .in('vendedor_nome', DONOS_SOLAR)
        .not('status', 'in', FILTRO_NAO_OCUPA)
        // Ordem estável (quando + id): sem ela a paginação pula ou repete linha.
        .order('quando', { ascending: true }).order('id', { ascending: true })
        .range(p0, p1)),
      // A vez da conta alta agora sai do MESMO contador que o cron do Meta e o
      // ManyChat giram (`leads_meta_state.rodizio_idx`), e não mais de uma
      // contagem própria de fichas `lp_solar`. Duas razões, e a segunda é a que
      // obriga: (1) três portas com contadores separados dão três rodízios
      // discordando, o mesmo furo que a conta baixa já tinha fechado em 15/09;
      // (2) desde 23/09 a Nilce está na fila de cima, e contar ficha por dono
      // não distingue uma ficha grande dela de uma pequena, o contador próprio
      // passaria a ser girado pelo lead pequeno e a proporção 50/25/25 viraria
      // uma função do volume da conta baixa.
      //
      // LEITURA PURA, de propósito: quem incrementa são as duas portas com
      // volume. Esta página tem 1 agendamento na história inteira (jul/2026);
      // gravar daqui pediria refazer o consumo no servidor pra saber se a ficha
      // é alta, e não paga o risco.
      supabaseGerador.from('leads_meta_state')
        .select('rodizio_idx').eq('id', 1).limit(1),
      // A vez da conta baixa sai do mesmo lugar que a do Meta e a do ManyChat: o
      // lead entra por três portas, e três rodízios separados discordariam. Este
      // não lança; se o banco falhar, ele mesmo responde 'Nilce'.
      proximoDaContaBaixa(),
    ]);

    const ocupados = ocupadosLidos
      .filter(a => a.quando)
      .map(a => ({
        ts: new Date(String(a.quando)).getTime(),
        dono: String(a.vendedor_nome),
        // A duração depende de QUEM atende: a página sabe a regra (durSolarDe),
        // o servidor só diz se aquele compromisso é desta LP ou de outra origem.
        solar: a.created_by === 'lp_solar',
      }));

    res.set('Cache-Control', 'no-store');
    const idxAlta = Number(altaQ.data?.[0]?.rodizio_idx ?? 0) || 0;
    res.json({
      ocupados,
      proximoAlta: FILA_CONTA_ALTA[idxAlta % FILA_CONTA_ALTA.length],
      proximoBaixa,
    });
  } catch (err) {
    logger.error('io-solar-agenda', 'falha lendo a agenda', err);
    // `null` diz "não consegui ler" — diferente de "não tem nada marcado".
    // 'Nilce' é a mesma reserva do proximoDaContaBaixa quando o banco falha.
    res.json({ ocupados: null, proximoAlta: FILA_CONTA_ALTA[0], proximoBaixa: 'Nilce' });
  }
});

router.get('/cliente', async (req: Request, res: Response): Promise<void> => {
  const alvo = telKeySolar(req.query.tel);
  if (!alvo) { res.json({ dono: null }); return; }
  try {
    const { data } = await supabaseGerador.from('agendamentos')
      .select('vendedor_nome, cliente_telefone, quando')
      .neq('status', 'cancelado')
      .ilike('cliente_telefone', `%${alvo.slice(-8)}`)
      .order('quando', { ascending: false }).limit(20);

    // O ilike casa pelos 8 últimos; o telKey confere o DDD junto, senão dois
    // números de estados diferentes viram o mesmo cliente.
    const dono = ((data || []) as Array<Record<string, unknown>>)
      .filter(a => telKeySolar(a.cliente_telefone) === alvo)
      .map(a => String(a.vendedor_nome || '')).find(Boolean) || null;

    res.set('Cache-Control', 'no-store');
    res.json({ dono });
  } catch (err) {
    logger.error('io-solar-cliente', 'falha lendo o historico', err);
    res.json({ dono: null });
  }
});

router.post('/agendar', async (req: Request, res: Response): Promise<void> => {
  const b = req.body || {};
  const nome = String(b.cliente_nome || '').trim().slice(0, 120);
  const tel = soDigitosSolar(b.cliente_telefone);
  const quando = String(b.quando || '');
  const dono = String(b.vendedor_nome || '');
  const PERMITIDOS = [...DONOS_SOLAR, ...TIME_BAIXA];

  if (nome.length < 3) { res.status(400).json({ error: 'nome invalido' }); return; }
  if (tel.length < 12 || tel.length > 13 || !tel.startsWith('55')) {
    res.status(400).json({ error: 'telefone invalido' }); return;
  }
  if (!PERMITIDOS.includes(dono)) { res.status(400).json({ error: 'consultor invalido' }); return; }
  if (!quando || Number.isNaN(new Date(quando).getTime())) {
    res.status(400).json({ error: 'horario invalido' }); return;
  }
  // AGENDA FECHADA (dias em que os sócios estão fora) — só pros SÓCIOS, que são quem
  // está na feira. A Nilce e a Giovanna continuam recebendo ligação normalmente
  // nesses três dias, e por isso o corte é por nome e não pela data sozinha.
  if (ehSocio(dono) && agendaFechadaNoIso(quando)) {
    res.status(409).json({ error: 'dia fechado', motivo: MOTIVO_FECHADA }); return;
  }

  // FORA DO PADRAO (02/10/2026): ficha NOVA nao nasce pra telefone bloqueado.
  //
  // Responde `ok` pra quem preencheu, de proposito. A pessoa do outro lado nao
  // precisa saber que foi bloqueada, e um erro na tela dela viraria ligacao pro
  // suporte. O rastro fica no log, que e onde quem bloqueou vai procurar.
  if (await estaBloqueado(tel)) {
    logger.info('io-solar-agendar', `${tel} esta FORA DO PADRAO: ficha nao criada`);
    res.json({ ok: true, id: null });
    return;
  }
  try {
    const { data, error } = await supabaseGerador.from('agendamentos').insert({
      vendedor_nome: dono,
      quando,
      cliente_nome: nome,
      cliente_telefone: tel,
      cidade: cidadeParaGravar(String(b.cidade || '').trim().slice(0, 200), tel),
      status: 'agendado',
      temperatura: b.temperatura === 'quente' ? 'quente' : 'morno',
      observacao: String(b.observacao || '').slice(0, 4000),
      created_by: 'lp_solar',
    }).select('id').single();
    if (error) throw error;
    res.json({ ok: true, id: data?.id ?? null });
  } catch (err) {
    logger.error('io-solar-agendar', `falha gravando ${tel}`, err);
    res.status(500).json({ ok: false, error: 'nao consegui gravar' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// O QUIZ SOLAR (07/10/2026)
//
// A página pergunta, o servidor decide. Duas rotas:
//   POST /quiz           no passo do WhatsApp: grava o rascunho em `leads_meta`
//                        (quem desiste antes do horário não some) e devolve o
//                        caminho e a vitrine prontos.
//   POST /quiz/agendar   no último passo: refaz a mesma conta com a agenda
//                        lida na hora e grava a ficha.
//
// A vitrine sai daqui, não do navegador: a página só desenha. É a diferença
// para o eletroposto, onde a vitrine e a gravação são duas contas que já
// discordaram três vezes.
//
// As respostas vão para `leads_meta`, a mesma tabela do formulário do Meta e do
// ManyChat, com `lead_id` = quiz_<DDD+8> e `form_id` = quiz_solar. Assim a tela
// Leads do Gerador já enxerga o quiz e não precisou de migração no banco.
// ═══════════════════════════════════════════════════════════════════════════

// TEL_AVISO (solarEquipe.ts): o telefone de quem recebe o aviso da ficha do quiz. Traz a Nilce, o
// Thiago e o Diego; a Giovanna continua listada para o card antigo dela, mas não recebe lead novo.
const FORM_QUIZ = 'quiz_solar';

/** Tudo que ocupa a agenda destas pessoas nos próximos dias, já em bloco.
 *  `null` = não deu para ler, e aí a vitrine não abre (melhor que vender por
 *  cima de alguém). */
async function lerOcupacoes(pessoas: string[]): Promise<Ocupacao[] | null> {
  const agora = Date.now();
  const de = new Date(agora).toISOString();
  const ate = new Date(agora + (DIAS_VARRIDOS + 1) * 86_400_000).toISOString();
  const [outras, solar, blqQ] = await Promise.all([
    // Paginado (21/10/2026): era `.limit(2000)`, e o PostgREST corta em 1000.
    // Erro em qualquer página vira null, como o `outrasQ.error` de antes.
    lerPaginado<Record<string, unknown>>('io-solar ocupacoes', (p0, p1) => supabaseGerador.from('agendamentos')
      .select('quando, vendedor_nome, created_by, status')
      .gte('quando', new Date(agora - 2 * 3_600_000).toISOString()).lte('quando', ate)
      .in('vendedor_nome', pessoas)
      .neq('created_by', 'lp_solar')
      .not('status', 'in', FILTRO_NAO_OCUPA)
      .order('quando', { ascending: true }).order('id', { ascending: true })
      .range(p0, p1)).catch(err => { logger.error('io-solar-ocupacoes', 'falha lendo as fichas', err); return null; }),
    ocupacoesSolar(de, ate, pessoas),
    supabaseGerador.from('agenda_bloqueios')
      .select('inicio, fim, vendedor_nome').in('vendedor_nome', pessoas).gte('fim', de).limit(500),
  ]);
  if (!outras || solar === null) return null;
  const out: Ocupacao[] = [];
  for (const a of outras) {
    // Vermelho do eletroposto devolve o horário, como na vitrine de lá.
    if (a.status === 'nao_atendeu' && ehOrigemEletroposto(a.created_by)) continue;
    const b = blocoDaFicha(a as never);
    if (b && a.vendedor_nome) out.push({ dono: String(a.vendedor_nome), ...b });
  }
  for (const s of solar) out.push({ dono: s.dono, ini: s.ini, fim: s.fim });
  for (const b of (blqQ.data || []) as Array<Record<string, unknown>>) {
    const ini = new Date(String(b.inicio)).getTime(), fim = new Date(String(b.fim)).getTime();
    if (!Number.isNaN(ini) && !Number.isNaN(fim) && b.vendedor_nome) out.push({ dono: String(b.vendedor_nome), ini, fim });
  }
  return out;
}

/** Rascunho do lead em `leads_meta`. Falha aqui não segura o quiz. */
async function gravarLead(leadId: string, campos: Record<string, unknown>): Promise<boolean> {
  try {
    const { data } = await supabaseGerador.from('leads_meta').select('lead_id').eq('lead_id', leadId).limit(1);
    const { error } = data?.length
      ? await supabaseGerador.from('leads_meta').update(campos).eq('lead_id', leadId)
      : await supabaseGerador.from('leads_meta').insert({ lead_id: leadId, created_time: new Date().toISOString(), ...campos });
    if (error) throw error;
    return true;
  } catch (err) {
    logger.error('io-solar-quiz', `rascunho do lead ${leadId} falhou`, err);
    return false;
  }
}

/** Celular com DDD → '55' + 11 dígitos (o 9 depois do DDD é obrigatório; fixo não passa). Tira o 55 ou o 0 da frente só
 *  se sobrarem 10 ou 11 dígitos, para não comer o começo de um número que só parece ter prefixo. */
export function normalizarCelular(raw: unknown): string | null {
  const d = soDigitosSolar(raw).replace(/^(?:55|0)(?=\d{10,11}$)/, '');
  return d.length === 11 && d[2] === '9' ? `55${d}` : null;
}

function lerEntrada(b: Record<string, unknown>): { nome: string; tel: string; alvo: string | null; resp: Respostas; extra: RespostasExtra; erro?: string } {
  const nome = String(b.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const tel = normalizarCelular(b.tel) ?? '';
  const resp = limparRespostas(b.respostas);
  const extra = limparRespostasExtra(b.respostas);
  const alvo = telKeySolar(tel);
  if (nome.length < 3) return { nome, tel, alvo, resp, extra, erro: 'nome invalido' };
  if (!tel || !alvo) return { nome, tel, alvo, resp, extra, erro: 'telefone invalido' };
  if (!resp.conta) return { nome, tel, alvo, resp, extra, erro: 'conta invalida' };
  return { nome, tel, alvo, resp, extra };
}

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const utmDe = (b: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of UTM) { const v = String(b[k] ?? '').trim().slice(0, 200); if (v) out[k] = v; }
  return out;
};
/** As UTMs do anúncio também no lead (08/10/2026): curioso e quem não marcou não
 *  têm ficha na agenda, e sem isto a planilha do Leads Solar não sabe de que
 *  campanha, conjunto e anúncio eles vieram. */
const camposComUtm = (campos: Array<{ name: string; values: string[] }>, b: Record<string, unknown>) =>
  [...campos, ...Object.entries(utmDe(b)).map(([name, v]) => ({ name, values: [v] }))];

// ── Modo teste para a sonda (24/10/2026) ────────────────────────────────────
// Com o header `x-cron-secret` igual a CRON_SECRET e `teste: true` no corpo, as rotas do quiz gravam com
// created_by 'lp_solar_teste', NÃO mandam nenhuma mensagem e NÃO disparam a API de Conversões. O rascunho vai para
// outro form_id e outro lead_id (qteste_...), que nenhum tick de envio lê. Para desfazer:
// POST /quiz/teste/:id/cancelar, que só põe status 'cancelado' (o CRON_SECRET está exposto no repositório público e
// ainda não foi girado: por isso nada de DELETE).
const FORM_QUIZ_TESTE = 'quiz_solar_teste';
const leadDoQuiz = (alvo: string, teste: boolean): string => `${teste ? 'qteste' : 'quiz'}_${alvo}`;

function segredoConfere(req: Request): boolean {
  const segredo = String(process.env.CRON_SECRET || '').trim();
  const dado = String(req.headers['x-cron-secret'] || '').trim();
  if (!segredo || !dado || segredo.length !== dado.length) return false;
  return timingSafeEqual(Buffer.from(segredo), Buffer.from(dado));
}
/** true = teste autorizado; false = não é teste; null = pediu teste sem direito (já respondeu 401: pare). */
function modoTeste(req: Request, b: Record<string, unknown>, res: Response): boolean | null {
  if (b.teste !== true) return false;
  if (!segredoConfere(req)) { res.status(401).json({ ok: false, error: 'nao autorizado' }); return null; }
  return true;
}

/** Os campos do rascunho: as respostas, as novas, o diagnóstico, as UTMs e o que o abandono precisa para remontar a ficha. */
function camposDoRascunho(e: ReturnType<typeof lerEntrada>, dec: Parameters<typeof camposDoLead>[1], semHorario: boolean, diag: Diagnostico | null, b: Record<string, unknown>) {
  return camposComUtm([
    ...camposDoLead(e.resp, dec, { semHorario, respostas: e.extra, diag }),
    ...camposDeRecuperacao(e.resp, e.extra, Date.now()),
  ], b);
}

const cidadeGravada = (e: ReturnType<typeof lerEntrada>, dec: { cidade: { nome: string; uf: string } | null }): string | null =>
  dec.cidade ? `${dec.cidade.nome}-${dec.cidade.uf}` : cidadeParaGravar(e.resp.cidade, e.tel);

/** DESCARTE (27/10/2026): nota abaixo de 70 ou cidade fora das 114 da região. Recalculado no servidor a partir das respostas, em
 *  toda rota que cria algo: o que a página diz não vale. Cidade que não resolveu NUNCA descarta (ver solarDescarte.ts). */
function descarteDoLead(e: ReturnType<typeof lerEntrada>): { motivo: MotivoDescarte; pontos: number; cidadeUf: string | null } | null {
  const pontos = pontuar(e.resp).pontos;
  const motivo = motivoDescarteSolar({ pontos, cidade: e.resp.cidade, telefone: e.tel });
  return motivo ? { motivo, pontos, cidadeUf: cidadeUfDoDescarte(e.resp.cidade, e.tel) } : null;
}
/** O teste da sonda tem a chave dele: um teste nunca pode calar o "saiu" de um lead de verdade. */
const chaveDescartado = (alvo: string, teste: boolean): string => `${CHAVE_DESCARTADO}${teste ? 'teste_' : ''}${alvo}`;

router.post('/quiz', async (req: Request, res: Response): Promise<void> => {
  const b = (req.body || {}) as Record<string, unknown>;
  const e = lerEntrada(b);
  if (e.erro) { res.status(400).json({ ok: false, error: e.erro }); return; }
  const teste = modoTeste(req, b, res);
  if (teste === null) return;
  res.set('Cache-Control', 'no-store');
  const agoraMs = Date.now();
  const diag = calcularDiagnostico(e.resp, e.extra);
  // Descartado: nada é criado, nada é enviado, nada vai ao Meta, e o cliente NÃO fica sabendo de ligação nenhuma. Fica só uma marca em
  // system_state (para a conta do funil e para o /quiz/saiu calar). Antes do bloqueio de telefone e da agenda: não gasta leitura à toa.
  const dry = String(req.query.dry || '') === '1';
  const descarte = descarteDoLead(e);
  if (descarte) {
    if (!dry) {
      await reivindicar(chaveDescartado(e.alvo!, teste), {
        motivo: descarte.motivo, pontos: descarte.pontos, cidade: descarte.cidadeUf ?? (e.resp.cidade || null),
        src: String(b.src || '').trim().toLowerCase().slice(0, 20) || null,
        ...utmDe(b), em: new Date(agoraMs).toISOString(),
      });   // melhor esforço: reivindicar engole o erro (devolve 'erro'); repetição do mesmo telefone mantém a 1ª marca
    }
    const raio = acharCidadeRaio(e.resp.cidade);
    res.json({
      ok: true, caminho: 'descartado', descartado: true, motivo: descarte.motivo, qualifica: null, semHorario: true,
      kwh: kwhDaFaixa(e.resp.conta), cidade: raio ? { nome: raio.nome, uf: raio.uf } : null, cidade_uf: descarte.cidadeUf,
      dono: DONA_SOLAR, jaMarcado: null, dias: [], diagnostico: diag, horario_agora: false, curioso: false,
    });
    return;
  }
  // Quem passou limpa a marca de um descarte anterior (refez o quiz com outra resposta): senão o "saiu" dele ficaria calado para sempre.
  if (!dry) await apagarChave(chaveDescartado(e.alvo!, teste));
  // Telefone FORA DO PADRÃO não ganha ficha nem vitrine, e não fica sabendo
  // (mesma regra do /agendar). A página mostra o "a gente te chama".
  if (await estaBloqueado(e.tel)) {
    res.json({ ok: true, caminho: 'ligacao', dias: [], semVitrine: true, dono: DONA_SOLAR, curioso: false, horario_agora: false, diagnostico: diag });
    return;
  }
  try {
    const quem = await donoDoTelefone(e.alvo!);
    // Só a Nilce atende solar: a agenda lida é a dela (e a vitrine tem a grade própria do quiz).
    const ocupacoes = await lerOcupacoes([DONA_SOLAR]);
    if (!ocupacoes) { res.status(503).json({ ok: false, error: 'agenda indisponivel' }); return; }
    const { dec, dias, semHorario } = decidirEMontar(e.resp, quem.dono, ocupacoes, agoraMs, e.alvo, { grade: 'quiz' });
    const leadId = leadDoQuiz(e.alvo!, teste);
    // ?dry=1 confere caminho e vitrine no ar sem gravar o rascunho (sonda pós-deploy).
    const gravou = String(req.query.dry || '') !== '1' && await gravarLead(leadId, {
      form_id: teste ? FORM_QUIZ_TESTE : FORM_QUIZ, form_name: 'Quiz Solar', nome: e.nome, whatsapp: e.tel,
      cidade: cidadeGravada(e, dec),
      // Curioso não tem "agora", mas escolhe horário com a Nilce, que é a dona de todo o solar.
      field_data: camposDoRascunho(e, dec, semHorario, diag, b), consultor: DONA_SOLAR, fora_area: false,
    });
    // LeadQuente: nota alta que não é curioso. Só depois de o rascunho gravar, e
    // nunca no ?dry=1 nem no teste. O eventId fixo por telefone faz o Meta descartar o reenvio de
    // quem refaz o quiz. Não existe gêmeo no navegador, então o id nasce aqui.
    if (!teste && gravou && dec.pontos >= 80 && dec.caminho !== 'curioso') {
      await enviarQuizMeta({
        produto: 'solar', nome: 'LeadQuente', origem: 'website', eventId: `leadquente_${idDoTelefone(e.tel)}`,
        pessoa: { telefone: e.tel, nome: e.nome, cidade: dec.cidade?.nome ?? e.resp.cidade, uf: dec.cidade?.uf },
        navegador: navegadorDe(req, b), urlDaPagina: 'https://solardoc.app/io/solar',
        dados: { nota: dec.pontos, caminho: dec.caminho },
      }, 'io-solar-quiz');
    }
    res.json({
      ok: true, lead_id: leadId, caminho: dec.caminho, motivo: dec.motivo, qualifica: dec.qualifica, semHorario,
      kwh: dec.kwh, cidade: dec.cidade ? { nome: dec.cidade.nome, uf: dec.cidade.uf } : null,
      // 24/10/2026: quem atende é sempre a Nilce (antes era o dono anterior do telefone; a página antiga só lê jaMarcado.dono).
      dono: DONA_SOLAR, jaMarcado: quem.jaMarcado, dias,
      diagnostico: diag, horario_agora: horarioAgoraAberto(agoraMs), curioso: dec.caminho === 'curioso',
    });
  } catch (err) {
    logger.error('io-solar-quiz', 'falha montando o caminho', err);
    res.status(503).json({ ok: false, error: 'agenda indisponivel' });
  }
});

// O aviso que vai para o celular de quem atende mora em solarQuiz.ts
// (avisoDaEquipe), ao lado da ficha que ele lê.

// ═══════════════════════════════════════════════════════════════════════════
// O ATENDIMENTO DIRETO, "AGORA" (24/10/2026)
//
// O cliente clica "falar com um especialista agora": nasce um card da Nilce no horário REAL da ligação (o próximo
// múltiplo de 5 min com pelo menos 5 min de folga; o minuto ocupado empurra +5 min, porque o índice único
// (vendedor, quando) recusa o repetido e a agenda nunca bloqueia). A confirmação que o cliente recebe ("te liga às X")
// bate com o "em até 5 minutos" da tela. Dispara o Schedule pela API de Conversões com o MESMO event_id do navegador
// e avisa a Nilce (solarQuizAviso.avisarAgora). Fora do horário ou para curioso: 409, e a página abre a vitrine.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/quiz/agora', quizCardLimiter, async (req: Request, res: Response): Promise<void> => {
  const b = (req.body || {}) as Record<string, unknown>;
  const e = lerEntrada(b);
  if (e.erro) { res.status(400).json({ ok: false, error: e.erro }); return; }
  const teste = modoTeste(req, b, res);
  if (teste === null) return;
  res.set('Cache-Control', 'no-store');
  // Descartado (nota < 70 ou fora da região): 409 ANTES de qualquer escrita. Nada de card, CAPI, aviso nem cancelarCardsSaiuSemMarcar.
  const descarte = descarteDoLead(e);
  if (descarte) { res.status(409).json({ ok: false, error: 'descartado', motivo: descarte.motivo }); return; }
  const agoraMs = Date.now();
  if (!horarioAgoraAberto(agoraMs)) { res.status(409).json({ ok: false, error: 'fora_do_horario' }); return; }
  const dec = decidirCaminho(e.resp, null, e.alvo);
  if (dec.caminho === 'curioso') { res.status(409).json({ ok: false, error: 'curioso' }); return; }
  if (await estaBloqueado(e.tel)) {
    // Mesma regra do /agendar: quem está FORA DO PADRÃO não ganha ficha e não fica sabendo.
    logger.info('io-solar-quiz', `${e.tel} esta FORA DO PADRAO: ficha nao criada`);
    res.json({ ok: true, id: null, quando: new Date(quandoDoAgora(agoraMs)).toISOString(), dono: DONA_SOLAR });
    return;
  }
  // 27/10/2026: o cliente que tinha saído sem marcar e agora clicou "agora". O card SAIU SEM MARCAR dele (criado pelo tick) não conta como
  // "ja marcado" (donoDoTelefone o ignora), e o card novo nasce pelo caminho de sempre: aviso T1, Schedule. SÓ depois que o card novo nasceu
  // e o lead ficou ligado a ele, o SAIU é cancelado (abaixo). Se o card novo não nasce (409, 503, erro), o SAIU fica como está.
  try {
    const quem = await donoDoTelefone(e.alvo!);
    if (quem.jaMarcado) {
      if (quem.agoraRecente) { res.json({ ok: true, id: quem.agoraRecente.id, quando: quem.agoraRecente.quando, dono: DONA_SOLAR, repetido: true }); return; }
      res.status(409).json({ ok: false, error: 'ja marcado', jaMarcado: quem.jaMarcado });
      return;
    }
    const diag = calcularDiagnostico(e.resp, e.extra);
    const observacao = montarObservacao(e.resp, dec, null, false, { respostas: e.extra, diag, agora: true });
    const src = String(b.src || '').trim().toLowerCase();
    // O encaixe mora em agendaSolar.ts (27/10/2026), o mesmo laço do tick do "saiu sem marcar".
    const resultado = await gravarCardAgora({
      dono: DONA_SOLAR, nome: e.nome, tel: e.tel, cidade: cidadeGravada(e, dec), observacao,
      src: /^[a-z0-9_-]{1,20}$/.test(src) ? src : null, utm: utmDe(b), createdBy: teste ? 'lp_solar_teste' : 'lp_solar',
    }, agoraMs);
    if (resultado.status === 'erro') throw resultado.erro;
    // 'sem_horario': 24 minutos ocupados seguidos.
    const card = resultado.status === 'ok' ? resultado.valor : null;
    const quandoMs = resultado.status === 'ok' ? resultado.quandoMs : 0;
    if (!card) { res.status(503).json({ ok: false, error: 'sem horario' }); return; }
    const quando = new Date(quandoMs).toISOString();
    const leadId = leadDoQuiz(e.alvo!, teste);
    await gravarLead(leadId, {
      form_id: teste ? FORM_QUIZ_TESTE : FORM_QUIZ, form_name: 'Quiz Solar', nome: e.nome, whatsapp: e.tel, cidade: cidadeGravada(e, dec),
      agendado_id: card.id, consultor: DONA_SOLAR, fora_area: false, field_data: camposDoRascunho(e, dec, false, diag, b),
    });
    // Antes de qualquer resposta (a Vercel corta o que roda depois dela): o card SAIU SEM MARCAR deste telefone sai da agenda. A sonda não mexe em card real.
    if (!teste) await cancelarCardsSaiuSemMarcar(e.alvo!, card.id);

    if (!teste) {
      // Schedule pelo pixel (a página) E pela API de Conversões, com o MESMO event_id. Sem event_id o Meta não junta os dois,
      // então sem id não manda (página velha em cache).
      const eventId = eventIdDe(b.event_id);
      const capi = eventId ? enviarQuizMeta({
        produto: 'solar', nome: 'Schedule', origem: 'website', eventId,
        pessoa: { telefone: e.tel, nome: e.nome, cidade: dec.cidade?.nome ?? e.resp.cidade, uf: dec.cidade?.uf },
        navegador: navegadorDe(req, b), urlDaPagina: 'https://solardoc.app/io/solar',
      }, 'io-solar-quiz') : Promise.resolve();
      const utm = utmDe(b);
      const ficha: DadosDaFicha = {
        nome: e.nome, tel: e.tel, nota: dec.pontos, cidadeUf: cidadeGravada(e, dec) ?? '', resp: e.resp, extra: e.extra, diag, kwh: dec.kwh,
        utmSource: utm.utm_source ?? null, utmCampaign: utm.utm_campaign ?? null,
      };
      // Esperado (a Vercel corta o que roda depois da resposta), com teto de 4 s como o aviso do /agendar.
      const aviso = Promise.race([
        avisarAgora({ cardId: card.id, lead: leadId, ficha, quandoMs }).catch(err => { logger.error('io-solar-quiz', 'aviso do agora falhou', err); }),
        new Promise(resolve => setTimeout(resolve, 4000)),
      ]);
      await Promise.all([capi, aviso]);
    }
    res.json({ ok: true, id: card.id, quando, dono: DONA_SOLAR, ...(teste ? { teste: true } : {}) });
  } catch (err) {
    logger.error('io-solar-quiz', `falha gravando o agora de ${e.tel}`, err);
    res.status(500).json({ ok: false, error: 'nao consegui gravar' });
  }
});

router.post('/quiz/agendar', quizCardLimiter, async (req: Request, res: Response): Promise<void> => {
  const b = (req.body || {}) as Record<string, unknown>;
  const e = lerEntrada(b);
  if (e.erro) { res.status(400).json({ ok: false, error: e.erro }); return; }
  const teste = modoTeste(req, b, res);
  if (teste === null) return;
  // Descartado (nota < 70 ou fora da região): 409 ANTES de qualquer escrita, inclusive antes do bloqueio de telefone (que responde 200).
  const descarte = descarteDoLead(e);
  if (descarte) { res.status(409).json({ ok: false, error: 'descartado', motivo: descarte.motivo }); return; }
  const ymd = String(b.ymd || '');
  const h = String(b.h || '');
  const dono = String(b.dono || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(h)) { res.status(400).json({ ok: false, error: 'horario invalido' }); return; }
  if (await estaBloqueado(e.tel)) {
    logger.info('io-solar-quiz', `${e.tel} esta FORA DO PADRAO: ficha nao criada`);
    res.json({ ok: true, id: null });
    return;
  }
  // 27/10/2026: o cliente que tinha saído sem marcar e agora escolheu horário. O card SAIU SEM MARCAR dele (criado pelo tick) não conta como
  // "ja marcado" (donoDoTelefone o ignora), e o card novo nasce pelo caminho de sempre: confirmação normal, Schedule, aviso à consultora.
  // SÓ depois que o card novo nasceu e o lead ficou ligado a ele, o SAIU (futuro ou passado, de qualquer dono) é cancelado (abaixo).
  // Se o card novo não nasce (409, 503, erro), nada é cancelado e o SAIU fica como está, com o agendado_id antigo.
  try {
    const quem = await donoDoTelefone(e.alvo!);
    // Já tem horário de solar marcado: não nasce a segunda ficha. A página avisa
    // no passo do horário; isto aqui é para a página velha ou o clique duplo.
    if (quem.jaMarcado) { res.status(409).json({ ok: false, error: 'ja marcado', jaMarcado: quem.jaMarcado }); return; }
    const ocupacoes = await lerOcupacoes([DONA_SOLAR]);
    if (!ocupacoes) { res.status(503).json({ ok: false, error: 'agenda indisponivel' }); return; }
    const agora = Date.now();
    const { dec: dec0, dias, semHorario } = decidirEMontar(e.resp, quem.dono, ocupacoes, agora, e.alvo, { grade: 'quiz' });
    // O curioso também escolhe horário (24/10/2026): o card dele é uma ligação da Nilce, e a ficha diz que a nota é de curioso.
    const dec = dec0.caminho === 'curioso'
      ? { ...dec0, caminho: 'ligacao' as const, candidatos: [DONA_SOLAR],
        motivo: `Curioso (${dec0.pontos} pontos, abaixo de ${PONTOS_CURIOSO}) que escolheu horário: ligação da ${DONA_SOLAR}.` }
      : dec0;
    // A mesma pergunta da vitrine (a grade nova do quiz), com a agenda lida agora: quem escolheu um
    // horário que outra pessoa tomou no meio do caminho recebe a vitrine nova.
    if (!dec.candidatos.includes(dono) || !cabe(dec.caminho, ymd, h, dono, dec, ocupacoes, agora, { grade: 'quiz' })) {
      res.status(409).json({ ok: false, error: 'horario tomado', caminho: dec.caminho, dias });
      return;
    }
    const diag = calcularDiagnostico(e.resp, e.extra);
    const endereco = dec.caminho === 'vistoria' ? limparEndereco(b.endereco) : null;
    const quando = new Date(msDe(ymd, h)).toISOString();
    const src = String(b.src || '').trim().toLowerCase();
    // O insert do card mora em agendaSolar.ts (21/10/2026), compartilhado com a agente; sem opções ele grava
    // exatamente o que esta rota gravava aqui.
    const gravado = await gravarCardSolar({
      dono,
      quando,
      nome: e.nome,
      tel: e.tel,
      cidade: cidadeGravada(e, dec),
      observacao: montarObservacao(e.resp, dec, endereco, semHorario, { respostas: e.extra, diag }),
      src: /^[a-z0-9_-]{1,20}$/.test(src) ? src : null,
      utm: utmDe(b),
      ...(teste ? { createdBy: 'lp_solar_teste' as const } : {}),
    });
    // 'horario_tomado' = o índice (vendedor, quando) recusou: alguém marcou no mesmo instante.
    if (gravado.status === 'horario_tomado') { res.status(409).json({ ok: false, error: 'horario tomado', caminho: dec.caminho, dias }); return; }
    if (gravado.status === 'erro') throw gravado.erro;
    const data = gravado.card;
    const leadId = leadDoQuiz(e.alvo!, teste);
    await gravarLead(leadId, { agendado_id: data.id, consultor: dono, field_data: camposDoRascunho(e, dec, semHorario, diag, b) });
    // Antes de qualquer resposta (a Vercel corta o que roda depois dela): o card SAIU SEM MARCAR deste telefone sai da agenda. A sonda não mexe em card real.
    if (!teste) await cancelarCardsSaiuSemMarcar(e.alvo!, data.id);

    if (teste) {
      // A sonda: nenhuma mensagem e nenhum Schedule.
      res.json({ ok: true, id: data.id, caminho: dec.caminho, dono, quando, rotulo: ROTULO_CAMINHO[dec.caminho], teste: true });
      return;
    }

    // Schedule pela API de Conversões, o gêmeo do que a página dispara no navegador.
    // SÓ com o event_id que a página mandou: sem ele o Meta não junta os dois e a
    // campanha, que otimiza em Schedule, contaria a marcação em dobro (página velha
    // em cache). Corre junto com o aviso do WhatsApp, e cada um tem o seu teto.
    const eventId = eventIdDe(b.event_id);
    const capi = eventId ? enviarQuizMeta({
      produto: 'solar', nome: 'Schedule', origem: 'website', eventId,
      pessoa: { telefone: e.tel, nome: e.nome, cidade: dec.cidade?.nome ?? e.resp.cidade, uf: dec.cidade?.uf },
      navegador: navegadorDe(req, b), urlDaPagina: 'https://solardoc.app/io/solar',
    }, 'io-solar-quiz') : Promise.resolve();

    // Aviso no celular de QUEM ATENDE, com tudo (ordem de 08/10/2026: "cada um,
    // além de receber na agenda, recebe no celular com todos os detalhes").
    // Esperado (a Vercel corta o que roda depois da resposta), teto de 4 s.
    // Com o interruptor `ficha` ligado o aviso ao dono sai pela ficha (tarefa ficha_5040) e a lista de alvos fica vazia.
    // O card acabou de nascer como 'agendado' e created_by 'lp_solar'. O CAPI (acima) segue como sempre.
    const alvos = (await fichaSubstituiAviso({ id: data.id, created_by: 'lp_solar', status: 'agendado' }))
      ? []
      : [TEL_AVISO[dono.toLowerCase()]].filter(Boolean);
    const msg = avisoDaEquipe(data as FichaDoAviso);
    await Promise.race([
      Promise.allSettled(alvos.map(n => sendWhatsApp(n, msg, 'io'))).then(r => r.forEach((x, i) => {
        if (x.status === 'rejected') logger.error('io-solar-quiz', `aviso falhou pra ${alvos[i]}`, x.reason);
      })),
      new Promise(resolve => setTimeout(resolve, 4000)),
    ]);
    await capi;
    res.json({ ok: true, id: data.id, caminho: dec.caminho, dono, quando, rotulo: ROTULO_CAMINHO[dec.caminho] });
  } catch (err) {
    logger.error('io-solar-quiz', `falha gravando ${e.tel}`, err);
    res.status(500).json({ ok: false, error: 'nao consegui gravar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// A SAÍDA DO QUIZ (24/10/2026)
//
// A página chama isto por navigator.sendBeacon no pagehide / visibilitychange, só depois de ter um WhatsApp válido e
// sem horário marcado. SÓ grava uma marca (`solar_saiu:<lead>`): não envia nada, não cria card, não dispara Schedule.
// Quem avisa a equipe é o tick (solarQuizAviso), de 5 a 10 min depois, se o cliente não voltar.
//
// O sendBeacon com string manda `text/plain`, que o parser JSON do Express ignora: a página manda um Blob
// application/json E esta rota também lê corpo em texto e faz o parse (as duas coisas, para não depender de uma só).
// ═══════════════════════════════════════════════════════════════════════════
router.post('/quiz/saiu', express.text({ type: '*/*', limit: '20kb' }), async (req: Request, res: Response): Promise<void> => {
  let b: Record<string, unknown> = {};
  try {
    const bruto: unknown = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (bruto && typeof bruto === 'object') b = bruto as Record<string, unknown>;
  } catch { b = {}; }
  const teste = modoTeste(req, b, res);
  if (teste === null) return;
  res.set('Cache-Control', 'no-store');
  const tel = normalizarCelular(b.tel);
  const alvo = tel ? telKeySolar(tel) : null;
  if (!tel || !alvo) { res.status(400).json({ ok: false, error: 'telefone invalido' }); return; }
  // A página manda 'whatsapp', 'resultado', 'horarios', 'fim' ou o id de um passo: 'whatsapp' é a tela do WhatsApp, 'horarios' é a escolha
  // do horário, e todo o resto é a tela do diagnóstico.
  // Lead descartado não ganha marca de saída (o rascunho dele pode existir de uma tentativa anterior que passou). Leitura que falha = segue como sempre.
  const marca = await lerChave(chaveDescartado(alvo, teste));
  if (marca && marca !== 'erro') { res.json({ ok: true, marcou: false, descartado: true }); return; }
  const onde: OndeSaiu = b.onde === 'whatsapp' ? 'whatsapp' : b.onde === 'horarios' ? 'horarios' : 'diagnostico';
  const gravou = await gravarSaida(leadDoQuiz(alvo, teste), onde);
  res.json({ ok: true, marcou: gravou });
});

// ═══════════════════════════════════════════════════════════════════════════
// DESFAZER O TESTE (24/10/2026). Só põe status 'cancelado', e SÓ em card 'lp_solar_teste' com menos de 1 hora.
// Nada de DELETE: o CRON_SECRET está exposto no repositório público e ainda não foi girado.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/quiz/teste/:id/cancelar', async (req: Request, res: Response): Promise<void> => {
  if (!segredoConfere(req)) { res.status(401).json({ ok: false, error: 'nao autorizado' }); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ ok: false, error: 'id invalido' }); return; }
  try {
    const { data, error } = await supabaseGerador.from('agendamentos')
      .update({ status: 'cancelado' })
      .eq('id', id).eq('created_by', 'lp_solar_teste')
      .gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
      .select('id');
    if (error) throw error;
    if (!data?.length) { res.status(404).json({ ok: false, error: 'nao e um card de teste recente' }); return; }
    res.json({ ok: true, cancelado: id });
  } catch (err) {
    logger.error('io-solar-quiz', `cancelar o teste ${id} falhou`, err);
    res.status(500).json({ ok: false, error: 'nao consegui cancelar' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// "FALEI COM O CLIENTE" (24/10/2026)
//
// O link do aviso (https://api.solardoc.app/io/solar/falei/<codigo>) abre uma PÁGINA com um botão. O GET nunca marca:
// a prévia de link do WhatsApp abriria o endereço sozinha. Só o POST do botão marca o lead como atendido.
// ═══════════════════════════════════════════════════════════════════════════
function paginaSemCache(res: Response): void {
  res.set({
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  });
}

router.get('/falei/:codigo', async (req: Request, res: Response): Promise<void> => {
  paginaSemCache(res);
  const codigo = String(req.params.codigo || '');
  const nome = await nomeDoToken(codigo);
  if (!nome) { res.status(404).send(paginaFalei({ titulo: TEXTOS_FALEI.invalido, frase: '' })); return; }
  res.send(paginaFalei({ titulo: TEXTOS_FALEI.titulo(nome), frase: TEXTOS_FALEI.frase, acao: `/io/solar/falei/${encodeURIComponent(codigo)}` }));
});

router.post('/falei/:codigo', async (req: Request, res: Response): Promise<void> => {
  paginaSemCache(res);
  const codigo = String(req.params.codigo || '');
  const r = await marcarFalei(codigo);
  if (r.estado === 'invalido') { res.status(404).send(paginaFalei({ titulo: TEXTOS_FALEI.invalido, frase: '' })); return; }
  if (r.estado === 'erro') {
    const nome = (await nomeDoToken(codigo)) || 'o cliente';
    res.status(500).send(paginaFalei({ titulo: TEXTOS_FALEI.erro, frase: TEXTOS_FALEI.titulo(nome), acao: `/io/solar/falei/${encodeURIComponent(codigo)}` }));
    return;
  }
  const hora = horaBonita(r.em);
  res.send(paginaFalei({ titulo: r.estado === 'marcado' ? TEXTOS_FALEI.marcado(r.nome, hora) : TEXTOS_FALEI.jaEstava(hora), frase: '' }));
});

export default router;
