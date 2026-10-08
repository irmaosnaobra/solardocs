import { Router, Request, Response } from 'express';
import { supabaseGerador } from '../utils/supabaseGerador';
import { sendWhatsApp } from '../services/agents/zapiClient';
import { logger } from '../utils/logger';
import { agendaFechadaNoIso, ehSocio, MOTIVO_FECHADA } from '../services/agenda/agendaFechada';
import { proximoDaContaBaixa } from '../services/agenda/filaContaBaixa';
import { FILA_CONTA_ALTA } from '../services/agenda/leadSolarFicha';
import { estaBloqueado } from '../services/agents/whatsapp/silenciar';
import { FILTRO_NAO_OCUPA } from '../services/agenda/salaDeEspera';
import { ehOrigemEletroposto } from '../services/agenda/origemEtiqueta';
import { ocupacoesSolar } from '../services/agenda/solarOcupacao';
import { SOCIOS_VISITA, DONAS_LIGACAO, MARCA_QUIZ, caminhoDaFicha, type Socio } from '../services/agenda/solarRota';
import {
  limparRespostas, limparEndereco, decidirEMontar, montarObservacao, camposDoLead, blocoDaFicha, cabe,
  msDe, DIAS_VARRIDOS, ROTULO_CAMINHO, type Ocupacao, type Respostas,
} from '../services/io/solarQuiz';

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
// cliente ainda tem que cair na mão de alguém.
export const EQUIPE: Record<string, string> = {
  nilce: '34991516846',
  thiago: '34991360223',
  diego: '34991360172',
};

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
      .select('id,vendedor_nome,quando,cliente_nome,cliente_telefone,cidade,temperatura,observacao,created_at,created_by')
      .eq('id', id)
      .eq('created_by', 'lp_solar')   // só ficha da LP solar
      .single();

    if (error || !data) { res.status(404).json({ error: 'nao encontrado' }); return; }

    const idade = Date.now() - new Date(data.created_at).getTime();
    if (idade > JANELA_MS) { res.status(410).json({ error: 'fora da janela' }); return; }

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

const soDigitosSolar = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** DDD + 8 últimos. A MESMA chave do CRM — tolera o 9 e o 55. */
function telKeySolar(raw: unknown): string | null {
  const d = soDigitosSolar(raw).replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

router.get('/agenda', async (req: Request, res: Response): Promise<void> => {
  const de = String(req.query.de || '').slice(0, 30);
  const ate = String(req.query.ate || '').slice(0, 30);
  if (!de || !ate) { res.status(400).json({ error: 'de/ate obrigatorios' }); return; }
  try {
    const [ocupadosQ, altaQ, proximoBaixa] = await Promise.all([
      supabaseGerador.from('agendamentos')
        .select('quando, vendedor_nome, created_by')
        .gte('quando', de).lte('quando', ate)
        .in('vendedor_nome', DONOS_SOLAR)
        .not('status', 'in', FILTRO_NAO_OCUPA)
        .limit(500),
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

    const ocupados = ((ocupadosQ.data || []) as Array<Record<string, unknown>>)
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
      cidade: String(b.cidade || '').trim().slice(0, 200) || null,
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

/** Telefone de quem recebe o aviso da ficha do quiz. A Giovanna entra aqui (e
 *  não no EQUIPE, que o alerta antigo manda para todos de uma vez). */
const TEL_AVISO: Record<string, string> = { ...EQUIPE, giovanna: '34993396255' };
const DONOS_QUIZ = [...SOCIOS_VISITA, ...DONAS_LIGACAO] as string[];
const FORM_QUIZ = 'quiz_solar';

/** De quem é este telefone, e se ele já tem horário de solar marcado. */
async function donoDoTelefone(alvo: string): Promise<{ dono: string | null; jaMarcado: { quando: string; dono: string } | null }> {
  const { data, error } = await supabaseGerador.from('agendamentos')
    .select('vendedor_nome, cliente_telefone, quando, status, created_by')
    .neq('status', 'cancelado')
    .ilike('cliente_telefone', `%${alvo.slice(-8)}`)
    .order('quando', { ascending: false }).limit(20);
  if (error) throw error;
  const meus = ((data || []) as Array<Record<string, unknown>>).filter(a => telKeySolar(a.cliente_telefone) === alvo);
  const nome = meus.map(a => String(a.vendedor_nome || '')).find(Boolean) || null;
  const agora = Date.now();
  // "Já marcado" é só horário que o CLIENTE escolheu (fichas desta LP). O card
  // do formulário do Meta também nasce com horário, mas a pessoa nunca soube
  // dele (as boas-vindas não falam de horário): dizer "você já tem horário" a
  // quem veio pelos dois canais, que é o lead mais quente, seria barrar ele com
  // uma confirmação que ele nunca recebeu. O dono continua valendo pelo `nome`.
  const futuro = meus.find(a => a.status === 'agendado' && a.created_by === 'lp_solar'
    && new Date(String(a.quando)).getTime() > agora);
  return {
    // Dono que não atende solar (nome fora da lista) não amarra o lead: cai na
    // regra normal. É o furo do eletroposto, onde esse cliente via horário livre
    // e levava "não consegui agendar" no clique.
    dono: nome && DONOS_QUIZ.includes(nome) ? nome : null,
    jaMarcado: futuro ? { quando: String(futuro.quando), dono: String(futuro.vendedor_nome || '') } : null,
  };
}

/** Tudo que ocupa a agenda destas pessoas nos próximos dias, já em bloco.
 *  `null` = não deu para ler, e aí a vitrine não abre (melhor que vender por
 *  cima de alguém). */
async function lerOcupacoes(pessoas: string[]): Promise<Ocupacao[] | null> {
  const agora = Date.now();
  const de = new Date(agora).toISOString();
  const ate = new Date(agora + (DIAS_VARRIDOS + 1) * 86_400_000).toISOString();
  const [outrasQ, solar, blqQ] = await Promise.all([
    supabaseGerador.from('agendamentos')
      .select('quando, vendedor_nome, created_by, status')
      .gte('quando', new Date(agora - 2 * 3_600_000).toISOString()).lte('quando', ate)
      .in('vendedor_nome', pessoas)
      .neq('created_by', 'lp_solar')
      .not('status', 'in', FILTRO_NAO_OCUPA)
      .limit(2000),
    ocupacoesSolar(de, ate, pessoas),
    supabaseGerador.from('agenda_bloqueios')
      .select('inicio, fim, vendedor_nome').in('vendedor_nome', pessoas).gte('fim', de).limit(500),
  ]);
  if (outrasQ.error || !outrasQ.data || solar === null) return null;
  const out: Ocupacao[] = [];
  for (const a of outrasQ.data as Array<Record<string, unknown>>) {
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
async function gravarLead(leadId: string, campos: Record<string, unknown>): Promise<void> {
  try {
    const { data } = await supabaseGerador.from('leads_meta').select('lead_id').eq('lead_id', leadId).limit(1);
    const { error } = data?.length
      ? await supabaseGerador.from('leads_meta').update(campos).eq('lead_id', leadId)
      : await supabaseGerador.from('leads_meta').insert({ lead_id: leadId, created_time: new Date().toISOString(), ...campos });
    if (error) throw error;
  } catch (err) {
    logger.error('io-solar-quiz', `rascunho do lead ${leadId} falhou`, err);
  }
}

function lerEntrada(b: Record<string, unknown>): { nome: string; tel: string; alvo: string | null; resp: Respostas; erro?: string } {
  const nome = String(b.nome || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const tel = soDigitosSolar(b.tel);
  const resp = limparRespostas(b.respostas);
  const alvo = telKeySolar(tel);
  if (nome.length < 3) return { nome, tel, alvo, resp, erro: 'nome invalido' };
  if (tel.length < 12 || tel.length > 13 || !tel.startsWith('55') || !alvo) return { nome, tel, alvo, resp, erro: 'telefone invalido' };
  if (!resp.conta) return { nome, tel, alvo, resp, erro: 'conta invalida' };
  return { nome, tel, alvo, resp };
}

const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const utmDe = (b: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const k of UTM) { const v = String(b[k] ?? '').trim().slice(0, 200); if (v) out[k] = v; }
  return out;
};

router.post('/quiz', async (req: Request, res: Response): Promise<void> => {
  const b = (req.body || {}) as Record<string, unknown>;
  const e = lerEntrada(b);
  if (e.erro) { res.status(400).json({ ok: false, error: e.erro }); return; }
  res.set('Cache-Control', 'no-store');
  // Telefone FORA DO PADRÃO não ganha ficha nem vitrine, e não fica sabendo
  // (mesma regra do /agendar). A página mostra o "a gente te chama".
  if (await estaBloqueado(e.tel)) { res.json({ ok: true, caminho: 'ligacao', dias: [], semVitrine: true }); return; }
  try {
    const quem = await donoDoTelefone(e.alvo!);
    const pessoas = [...new Set([...SOCIOS_VISITA, ...DONAS_LIGACAO, ...(quem.dono ? [quem.dono] : [])])];
    const ocupacoes = await lerOcupacoes(pessoas);
    if (!ocupacoes) { res.status(503).json({ ok: false, error: 'agenda indisponivel' }); return; }
    const { dec, dias, semHorario } = decidirEMontar(e.resp, quem.dono, ocupacoes, Date.now());
    const leadId = `quiz_${e.alvo}`;
    // ?dry=1 confere caminho e vitrine no ar sem gravar o rascunho (sonda pós-deploy).
    if (String(req.query.dry || '') !== '1') await gravarLead(leadId, {
      form_id: FORM_QUIZ, form_name: 'Quiz Solar', nome: e.nome, whatsapp: e.tel,
      cidade: dec.cidade ? `${dec.cidade.nome}-${dec.cidade.uf}` : (e.resp.cidade || null),
      field_data: camposDoLead(e.resp, dec, { semHorario }), consultor: dec.candidatos[0] ?? null, fora_area: false,
    });
    res.json({
      ok: true, lead_id: leadId, caminho: dec.caminho, motivo: dec.motivo, qualifica: dec.qualifica, semHorario,
      kwh: dec.kwh, cidade: dec.cidade ? { nome: dec.cidade.nome, uf: dec.cidade.uf } : null,
      dono: quem.dono, jaMarcado: quem.jaMarcado, dias,
    });
  } catch (err) {
    logger.error('io-solar-quiz', 'falha montando o caminho', err);
    res.status(503).json({ ok: false, error: 'agenda indisponivel' });
  }
});

/** O aviso da ficha nova do quiz, para quem atende e cópia para o Thiago.
 *  Emoji só na primeira linha (regra de 24/09). */
function mensagemDoQuiz(a: Record<string, unknown>): string {
  const caminho = caminhoDaFicha(a.observacao) || 'ligacao';
  const linhas = String(a.observacao || '').split('\n');
  const val = (rot: string) => linhas.find(l => l.startsWith(rot))?.slice(rot.length).trim() || '';
  const quando = new Date(String(a.quando)).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const titulo = { vistoria: 'NOVA VISITA', video: 'NOVO ATENDIMENTO ONLINE', ligacao: 'NOVA LIGAÇÃO', curioso: 'NOVO CURIOSO' }[caminho];
  const out = [
    `☀️ *${titulo}, ENERGIA SOLAR*`,
    `Veio do quiz da /io/solar.`,
    ``,
    `*Quando:* ${quando}`,
    `*Com:* ${a.vendedor_nome || ''}`,
    `*Cliente:* ${a.cliente_nome || ''}`,
    `*WhatsApp:* wa.me/${soDigitos(String(a.cliente_telefone || ''))}`,
  ];
  for (const [rot, campo] of [['Cidade', 'Cidade:'], ['Conta', 'Conta de luz:'], ['Endereço', 'Endereço:'], ['Imóvel', 'Imóvel:'],
    ['Quando quer', 'Quando quer:'], ['Já tem orçamento', 'Já tem orçamento:'], ['Pagamento', 'Pagamento:'], ['Decisor', 'Decisor:'],
    ['Demanda contratada', 'Demanda contratada:']] as const) {
    const v = val(campo);
    if (v) out.push(`*${rot}:* ${v}`);
  }
  const marca = linhas.find(l => /^(QUALIFICA PARA|SEM HORÁRIO DE)/.test(l));
  if (marca) out.push('', `*${marca}*`);
  out.push('', '_Veja no CRM: solardoc.app/gerador_');
  return out.join('\n');
}

router.post('/quiz/agendar', async (req: Request, res: Response): Promise<void> => {
  const b = (req.body || {}) as Record<string, unknown>;
  const e = lerEntrada(b);
  if (e.erro) { res.status(400).json({ ok: false, error: e.erro }); return; }
  const ymd = String(b.ymd || '');
  const h = String(b.h || '');
  const dono = String(b.dono || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(h)) { res.status(400).json({ ok: false, error: 'horario invalido' }); return; }
  if (await estaBloqueado(e.tel)) {
    logger.info('io-solar-quiz', `${e.tel} esta FORA DO PADRAO: ficha nao criada`);
    res.json({ ok: true, id: null });
    return;
  }
  try {
    const quem = await donoDoTelefone(e.alvo!);
    // Já tem horário de solar marcado: não nasce a segunda ficha. A página avisa
    // no passo do horário; isto aqui é para a página velha ou o clique duplo.
    if (quem.jaMarcado) { res.status(409).json({ ok: false, error: 'ja marcado', jaMarcado: quem.jaMarcado }); return; }
    const pessoas = [...new Set([...SOCIOS_VISITA, ...DONAS_LIGACAO, ...(quem.dono ? [quem.dono] : [])])];
    const ocupacoes = await lerOcupacoes(pessoas);
    if (!ocupacoes) { res.status(503).json({ ok: false, error: 'agenda indisponivel' }); return; }
    const agora = Date.now();
    const { dec, dias, semHorario } = decidirEMontar(e.resp, quem.dono, ocupacoes, agora);
    // A mesma pergunta da vitrine, com a agenda lida agora: quem escolheu um
    // horário que outra pessoa tomou no meio do caminho recebe a vitrine nova.
    if (!dec.candidatos.includes(dono) || !cabe(dec.caminho, ymd, h, dono, dec, ocupacoes, agora)) {
      res.status(409).json({ ok: false, error: 'horario tomado', caminho: dec.caminho, dias });
      return;
    }
    const endereco = dec.caminho === 'vistoria' ? limparEndereco(b.endereco) : null;
    const quando = new Date(msDe(ymd, h)).toISOString();
    const src = String(b.src || '').trim().toLowerCase();
    const { data, error } = await supabaseGerador.from('agendamentos').insert({
      vendedor_nome: dono,
      quando,
      cliente_nome: e.nome,
      cliente_telefone: e.tel,
      cidade: dec.cidade ? `${dec.cidade.nome}-${dec.cidade.uf}` : (e.resp.cidade || null),
      status: 'agendado',
      observacao: montarObservacao(e.resp, dec, endereco, semHorario).slice(0, 4000),
      created_by: 'lp_solar',
      ...(/^[a-z0-9_-]{1,20}$/.test(src) ? { src } : {}),
      ...utmDe(b),
    }).select('id, vendedor_nome, quando, cliente_nome, cliente_telefone, observacao').single();
    if (error) {
      // 23505 = o índice (vendedor, quando) recusou: alguém marcou no mesmo instante.
      if ((error as { code?: string }).code === '23505') { res.status(409).json({ ok: false, error: 'horario tomado', caminho: dec.caminho, dias }); return; }
      throw error;
    }
    const leadId = `quiz_${e.alvo}`;
    await gravarLead(leadId, { agendado_id: data.id, consultor: dono, field_data: camposDoLead(e.resp, dec, { semHorario }) });

    // Aviso no celular de QUEM ATENDE, com tudo (ordem de 08/10/2026: "cada um,
    // além de receber na agenda, recebe no celular com todos os detalhes").
    // Esperado (a Vercel corta o que roda depois da resposta), teto de 4 s.
    const alvos = [TEL_AVISO[dono.toLowerCase()]].filter(Boolean);
    const msg = mensagemDoQuiz(data as Record<string, unknown>);
    await Promise.race([
      Promise.allSettled(alvos.map(n => sendWhatsApp(n, msg, 'io'))).then(r => r.forEach((x, i) => {
        if (x.status === 'rejected') logger.error('io-solar-quiz', `aviso falhou pra ${alvos[i]}`, x.reason);
      })),
      new Promise(resolve => setTimeout(resolve, 4000)),
    ]);
    res.json({ ok: true, id: data.id, caminho: dec.caminho, dono, quando, rotulo: ROTULO_CAMINHO[dec.caminho] });
  } catch (err) {
    logger.error('io-solar-quiz', `falha gravando ${e.tel}`, err);
    res.status(500).json({ ok: false, error: 'nao consegui gravar' });
  }
});

export default router;
