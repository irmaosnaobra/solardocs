// ─────────────────────────────────────────────────────────────────────────────
// A FEIRA CAIU EM CIMA DA AGENDA — avisar quem já estava marcado, e remarcar.
//
// Ordem do Thiago (25/08/2026): "hoje, amanhã e quinta estaremos na Intersolar.
// Os novos entram apenas sexta e segunda, e os que já estão agendados serão
// avisados e orientados a remarcar e seguir nosso Instagram pra acompanhar a
// gente na feira, que vamos trazer muita novidade de lá."
//
// Quem fecha a agenda pra NOVO é o `agendaFechada` (as cinco portas estão
// documentadas lá). Este módulo cuida da outra metade: as reuniões que JÁ
// estavam marcadas nos três dias e que ninguém vai atender.
//
// ── O desenho: oferece, não decide ──
// Cada pessoa recebe UMA mensagem com o motivo, três horários do MESMO consultor
// e o convite do Instagram. Quem responde "2" é atendido pelo robô de remarcação
// que já existe — a oferta é gravada no MESMO estado dele (`ep_remarcar:<id>`),
// então não há uma linha de código novo pra entender a escolha e mover a ficha.
//
// Por que não remarcar de ofício, como faz o `eletropostoReagendaAuto`: lá o
// alvo é quem já ignorou quatro mensagens (menu não funciona pra quem está em
// silêncio). Aqui é o contrário — são reuniões confirmadas, e quem está desmarcando
// somos nós. E tem a conta da agenda: sexta tem 5 horários e segunda 8, os DOIS
// dias que o Thiago reservou pros novos. Um robô empurrando 20 remarcações pra lá
// enche exatamente o que ele mandou deixar livre.
//
// ── A ficha NÃO é mexida até a pessoa escolher ──
// Status continua `agendado`, no horário velho, e é o `agendaFechada` que impede
// os avisos, o vermelho automático e a reagenda de dispararem em cima dela. Nada
// de carimbo mentiroso (pré-preencher `lembrete_1h_at` pra calar o robô é o que
// FAZ o não-atendido-automático marcar a pessoa de ausente 15 min depois).
//
// ── Ordem da fila: quem já foi furado primeiro ──
// Por `quando` crescente. A reunião de hoje 13h, que passou sem ninguém entrar,
// é mais urgente que a de quinta — e o teto anti-ban da linha é de 6/h, então a
// fila leva horas: a ordem decide quem fica sabendo hoje.
//
// ── Solar dos sócios ──
// Ficha de solar deles nesses dias recebe a mesma mensagem SEM lista de horários:
// a grade de vistoria é outra (1 hora, meias-horas encaixadas) e o robô de
// remarcação só sabe a do eletroposto. Oferecer horário de apresentação pra uma
// visita seria marcar errado — melhor o consultor combinar.
//
// Idempotente por `intersolar_feira:<id>` no system_state. Kill-switch:
// INTERSOLAR_FEIRA_OFF=1. Prévia sem enviar: GET /cron/intersolar-feira?dry=1
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendHuman } from '../agents/zapiClient';
import { dentroDoTetoHorarioLinha, dentroDaJanelaDiurna } from '../agents/whatsapp/lineThrottle';
import { ehOrigemEletroposto } from '../agenda/origemEtiqueta';
import {
  agendaFechadaNoIso, diasFechados, ehSocio, temAgendaFechada,
} from '../agenda/agendaFechada';
import { quandoPorExtenso } from './eletropostoAgenda';
import { ofertarPorConta, type Ficha } from './eletropostoRemarcar';

/** Já avisei esta ficha? (marcador, não coluna) */
const FEIRA_PREFIX = 'intersolar_feira:';
/** Carimbo de envio EFETIVADO no caminho do solar — entra no teto da linha. O
 *  caminho do eletroposto carimba `ep_remarcar_sent:` sozinho, lá dentro. */
const FEIRA_SENT = 'intersolar_feira_sent:';

/** Uma pessoa por tick. O tick é de 5 min e o teto da linha é de 6/h: quem
 *  segura o ritmo é o teto, este número só impede rajada dentro da rodada. */
const POR_TICK = 1;

/** O Instagram da empresa. Mesmo handle das outras automações. */
const INSTAGRAM = '@irmaosnaobra__';

const desligado = () => (process.env.INTERSOLAR_FEIRA_OFF || '').trim() === '1';
/** O caminho do eletroposto (que é quase toda a fila) passa por dentro do robô de
 *  remarcação. Se ELE estiver desligado, `ofertarPorConta` devolve 'nada' e a fila
 *  fica parada em silêncio — indistinguível de "o teto da linha segurou". Isto não
 *  desliga nada, só faz o motivo aparecer no log em vez de ser adivinhado. */
const remarcarDesligado = () => (process.env.EP_REMARCAR_OFF || '').trim() === '1';

type FichaFeira = {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  quando: string | null;
  vendedor_nome: string | null;
  created_by: string | null;
};

export type ResultadoFeira = {
  avisados: number;
  erros: number;
  motivo?: string;
  pendentes?: number;
  previa?: Array<{ id: number; cliente: string; quando: string; dono: string; produto: string }>;
};

const zero = (motivo?: string): ResultadoFeira => ({ avisados: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/** DDD + 8 últimos — a mesma chave do CRM. Duas fichas do mesmo número recebem
 *  UMA mensagem: a pessoa não precisa saber que tem duas linhas no nosso banco. */
function telKey(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

/** Primeiro nome só quando é nome de gente ("Lead Instagram" não é). */
function primeiroNome(bruto: string | null): string {
  const n = String(bruto || '').trim().split(/\s+/)[0] || '';
  return n.length >= 2 && n.length <= 20 && n.toLowerCase() !== 'lead' ? n : '';
}

const comNome = (n: string) => (n ? `, ${n}` : '');

// ── COPY ────────────────────────────────────────────────────────────────────
// O motivo vem na PRIMEIRA bolha, antes de qualquer horário: quem recebe uma
// lista sem saber por quê acha que é outra abordagem de vendas. E o motivo é
// nosso, não dele — a frase assume que quem desmarcou fomos nós.
//
// A data é CRAVADA ("25 a 27 de agosto"), nunca "hoje": a fila escoa a 6/h e leva
// horas, então "hoje" estaria errado pra metade de quem lê.
//
// Nada além do que dá pra conferir: a Intersolar South America 2026 é 25–27/08 no
// Expo Center Norte (fonte oficial, lida em 25/08/2026). NÃO temos número de
// stand e nenhuma mensagem promete um.

/** A frase que explica o furo, diferente pra quem já perdeu a hora. */
function bolhaDoMotivo(nome: string, quandoIso: string, passou: boolean): string {
  const q = quandoPorExtenso(quandoIso).replace('-feira', '');
  return passou
    ? `Oi${comNome(nome)}! Aqui é da *Irmãos na Obra*. Sua reunião era ${q}, e a gente não conseguiu te atender — estamos na *Intersolar South America*, em São Paulo, de 25 a 27 de agosto. Me desculpa pelo transtorno.`
    : `Oi${comNome(nome)}! Aqui é da *Irmãos na Obra*. Estamos na *Intersolar South America*, em São Paulo, de 25 a 27 de agosto, e por isso preciso mudar a sua reunião de ${q}.`;
}

/** O convite do Instagram — última bolha nos dois caminhos. */
const bolhaDoInstagram = `Aproveita e me segue no Instagram: *${INSTAGRAM}*. Estamos postando de dentro da feira as novidades que vamos trazer de lá.`;

/**
 * Eletroposto: motivo + os três horários + o número + Instagram.
 *
 * O formato da lista é o mesmo do robô de remarcação de propósito ("1) sexta,
 * 28/08 às 14h00"), porque é ELE que vai ler a resposta: a pessoa responde "2" e
 * quem entende é o `passoDeRemarcacao`, sem nada novo no meio.
 */
export function bolhasFeiraEletroposto(
  nome: string, ofertas: string[], quem: string, quandoIso: string, passou: boolean,
): string[] {
  const linhas = ofertas.map((iso, i) => `${i + 1}) ${quandoPorExtenso(iso).replace('-feira', '')}`).join('\n');
  return [
    bolhaDoMotivo(nome, quandoIso, passou),
    `Já separei os próximos horários do *${quem}* pra você escolher:\n\n${linhas}`,
    'Me responde só o número que eu já remarco. Se nenhum servir, me fala o dia que fica melhor.',
    bolhaDoInstagram,
  ];
}

/** Solar dos sócios: sem lista (a grade de vistoria é outra) — quem combina o
 *  novo dia é o consultor. */
export function bolhasFeiraSolar(nome: string, quem: string, quandoIso: string, passou: boolean): string[] {
  return [
    bolhaDoMotivo(nome, quandoIso, passou),
    `Assim que a gente voltar, na sexta, o *${quem}* te chama pra remarcar. Se preferir, já me fala o dia e o período que ficam melhores pra você que eu deixo anotado.`,
    bolhaDoInstagram,
  ];
}

// ── ESTADO ──────────────────────────────────────────────────────────────────
async function jaAvisados(ids: number[]): Promise<Set<number> | null> {
  if (!ids.length) return new Set();
  try {
    const { data, error } = await supabase
      .from('system_state').select('key').in('key', ids.map(id => `${FEIRA_PREFIX}${id}`));
    if (error) throw error;
    if (!data) throw new Error('resposta sem corpo');
    return new Set(data.map(r => Number(String(r.key).slice(FEIRA_PREFIX.length))));
  } catch (err) {
    // Fail-closed: sem saber quem já recebeu, mandar de novo é dobrar a mensagem
    // na conversa de quem já foi avisado.
    logger.error('intersolar-feira', 'ler marcadores falhou — ninguém é tocado nesta rodada', err);
    return null;
  }
}

async function marcar(id: number, extra: Record<string, unknown> = {}): Promise<void> {
  const agoraIso = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: `${FEIRA_PREFIX}${id}`, value: { em: agoraIso, ...extra }, updated_at: agoraIso },
    { onConflict: 'key' },
  ).then(undefined, (e: unknown) => logger.error('intersolar-feira', 'marcar falhou', { id, erro: String(e) }));
}

async function carimbarEnvio(id: number): Promise<void> {
  const agoraIso = new Date().toISOString();
  await supabase.from('system_state').upsert(
    { key: `${FEIRA_SENT}${id}`, value: { em: agoraIso }, updated_at: agoraIso },
    { onConflict: 'key' },
  ).then(undefined, (e: unknown) => logger.error('intersolar-feira', 'carimbo do teto falhou', { id, erro: String(e) }));
}

// ── O TICK ──────────────────────────────────────────────────────────────────
export async function runIntersolarFeiraTick(opts: { dry?: boolean } = {}): Promise<ResultadoFeira> {
  if (desligado()) return zero('desligado');
  if (!temAgendaFechada()) return zero('sem_agenda_fechada');
  if (remarcarDesligado()) {
    logger.error('intersolar-feira', 'EP_REMARCAR_OFF=1 — o aviso do eletroposto não sai enquanto isso estiver ligado');
    return zero('remarcar_desligado');
  }
  // Fora da janela civil ninguém é tocado — mas nada se perde: o marcador só é
  // gravado depois do envio, então a fila drena no próximo tick de manhã.
  if (!opts.dry && !dentroDaJanelaDiurna()) return zero('fora_da_janela');

  const dias = diasFechados();
  const de = `${dias[0]}T00:00:00-03:00`;
  const ate = `${dias[dias.length - 1]}T23:59:59-03:00`;

  const { data, error } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, quando, vendedor_nome, created_by')
    .eq('status', 'agendado')
    .gte('quando', new Date(de).toISOString())
    .lte('quando', new Date(ate).toISOString())
    .order('quando', { ascending: true })
    .limit(500);
  if (error) {
    logger.error('intersolar-feira', 'ler agendamentos falhou', error);
    return { ...zero('erro_leitura'), erros: 1 };
  }

  // O corte é por NOME (`ehSocio`): a Nilce e a Giovanna não vão à feira e
  // continuam ligando normalmente nesses três dias. `agendaFechadaNoIso` de novo
  // aqui porque a janela `de/ate` é contígua e a lista de dias pode não ser.
  const fichas = ((data ?? []) as FichaFeira[]).filter(f =>
    !!f.quando && !!f.cliente_telefone && !!f.vendedor_nome
    && ehSocio(f.vendedor_nome)
    && agendaFechadaNoIso(f.quando));
  if (!fichas.length) return zero('nenhuma_reuniao');

  const avisados = await jaAvisados(fichas.map(f => f.id));
  if (!avisados) return { ...zero('erro_marcadores'), erros: 1 };

  // Dedupe por telefone: a ficha mais antiga (a lista já vem ordenada) é a que
  // recebe; as outras do mesmo número são marcadas junto, sem segunda mensagem.
  const vistos = new Set<string>();
  const fila: Array<{ f: FichaFeira; irmas: number[] }> = [];
  for (const f of fichas) {
    if (avisados.has(f.id)) continue;
    const chave = telKey(f.cliente_telefone) || `id:${f.id}`;
    const anterior = fila.find(x => (telKey(x.f.cliente_telefone) || `id:${x.f.id}`) === chave);
    if (anterior) { anterior.irmas.push(f.id); continue; }
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    fila.push({ f, irmas: [] });
  }
  if (!fila.length) return zero('todos_avisados');

  if (opts.dry) {
    return {
      avisados: 0, erros: 0, pendentes: fila.length,
      previa: fila.map(({ f }) => ({
        id: f.id,
        cliente: String(f.cliente_nome || '—'),
        quando: quandoPorExtenso(String(f.quando)),
        dono: String(f.vendedor_nome),
        produto: ehOrigemEletroposto(f.created_by) ? 'eletroposto' : 'solar',
      })),
    };
  }

  const agora = Date.now();
  let n = 0, erros = 0;
  for (const { f, irmas } of fila.slice(0, POR_TICK)) {
    const nome = primeiroNome(f.cliente_nome);
    const quem = String(f.vendedor_nome);
    const quandoIso = String(f.quando);
    const passou = new Date(quandoIso).getTime() < agora;

    try {
      if (ehOrigemEletroposto(f.created_by)) {
        // `rodada: 0` de propósito: esta oferta é NOSSA, não é o lead pedindo
        // pra remarcar. Com 1 aqui, a pessoa que depois pedisse outro dia teria
        // uma só das duas rodadas que o robô dá a ela.
        const ficha: Ficha = {
          id: f.id, cliente_nome: f.cliente_nome, cliente_telefone: f.cliente_telefone,
          quando: f.quando, vendedor_nome: f.vendedor_nome,
        };
        const r = await ofertarPorConta(
          ficha,
          (nomeC, ofertas, quemC) => bolhasFeiraEletroposto(nomeC, ofertas, quemC, quandoIso, passou),
          // TRANSACIONAL: esta mensagem é sobre a reunião que a PRÓPRIA PESSOA
          // marcou e que não vai acontecer — a mesma natureza da confirmação de
          // agenda, que já viaja assim. Não afrouxa nada (o teto por hora vale
          // igual): decide quem gasta a vaga quando a linha está disputada, e
          // avisar de um cancelamento vale mais que qualquer campanha.
          { rodada: 0, silencioSemVaga: true, transacional: true },
        );
        if (r.acao === 'ofertou') { await marcar(f.id, { via: 'oferta' }); n++; }
        else if (r.acao === 'sem_vaga') {
          // Não trava a fila: marca e avisa no log. Agenda sem uma vaga em 21
          // dias é sinal de gente, não de robô.
          await marcar(f.id, { via: 'sem_vaga' });
          logger.error('intersolar-feira', 'sem vaga na agenda do consultor — precisa de encaixe manual',
            { id: f.id, dono: quem });
          n++;
        } else {
          // Teto da linha ou leitura falhou: NÃO marca, tenta no próximo tick.
          logger.info('intersolar-feira', 'segurou o aviso desta rodada', { id: f.id, acao: r.acao });
          break;
        }
      } else {
        if (!(await dentroDoTetoHorarioLinha({ transacional: true }))) {
          logger.info('intersolar-feira', 'teto da linha estourado — espera o próximo tick', { id: f.id });
          break;
        }
        await sendHuman(String(f.cliente_telefone).replace(/\D/g, ''),
          bolhasFeiraSolar(nome, quem, quandoIso, passou), 'io');
        await carimbarEnvio(f.id);
        await marcar(f.id, { via: 'solar' });
        n++;
      }
      // As fichas irmãs (mesmo telefone) saem da fila sem mensagem própria.
      for (const id of irmas) await marcar(id, { via: 'mesmo_telefone', junto_de: f.id });
    } catch (err) {
      erros++;
      logger.error('intersolar-feira', 'falha avisando', { id: f.id, erro: String(err) });
    }
  }

  if (n) logger.info('intersolar-feira', `${n} cliente(s) avisados da feira`, { restam: fila.length - n });
  return { avisados: n, erros, pendentes: Math.max(0, fila.length - n) };
}
