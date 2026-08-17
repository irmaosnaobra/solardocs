// ─────────────────────────────────────────────────────────────────────────────
// 19H — O QUE A NILCE NÃO ATENDEU PASSA PRA GIOVANNA.
//
// Ordem do Thiago (17/08/2026): "quando a Nilce deixar algum sem ação vai direto
// pra Giovanna às 19h e cai pra ela no outro dia". O objetivo é declarado: a
// Nilce fica com o que é novo e quente, e a Giovanna aprende a atender no que
// esfriou. Anda junto com o rodízio 3:1 dos leads novos (filaContaBaixa.ts).
//
// Às 19h o dia da Nilce fecha. O que ninguém tocou muda de dona E de horário:
// vai pro próximo dia útil, encaixado na agenda da GIOVANNA — varre a grade dela
// do primeiro horário ao último, pula o que já está marcado, preenche os buracos.
// Lotou o dia, o resto vai pro seguinte, e assim por diante.
//
// ── A sutileza que faz a diferença ──
// A ficha parada é lida da agenda da NILCE, mas a vaga é procurada na agenda da
// GIOVANNA. São duas leituras, e trocar uma pela outra grava em cima do que a
// Giovanna já tem marcado — o índice único (vendedor_nome, quando) só pegaria a
// colisão exata, não a sobreposição.
//
// ── O que conta como "sem ação" ──
// Ficha da Nilce, horário já vencido, ainda em `agendado` e sem temperatura. Quem
// tem temperatura foi qualificado; quem está `nao_atendeu`, `sem_orcamento` ou
// perdido teve ação de gente e não é assunto de robô. E cliente que já tem outro
// horário FUTURO não é movido: seria a mesma pessoa em dois lugares da agenda.
//
// ── Travas ──
//   • Piso de "daqui pra frente" (VARREDURA_INICIO): ficha com horário anterior à
//     entrada no ar nunca é movida — a 1ª execução não despeja backlog antigo.
//   • Horizonte de 10 dias úteis. O que não couber fica onde está, e é relatado.
//   • Não há teto de repetição, e não precisa haver: a passagem é de mão única.
//     Depois que a ficha vira da Giovanna, ela sai do público desta varredura
//     (que só lê a agenda da Nilce) e não volta mais.
//
// ── O que ele NÃO faz ──
//   • Não mexe em ficha da Giovanna. O que ELA deixar parado não tem robô: cai na
//     lista das 17h, que ela recebe normalmente.
//   • Não manda mensagem pra ninguém. Os avisos de agenda do /gerador estão
//     desligados por ordem de 25 e 28/07. O rastro fica no histórico da ficha.
//   • Não cria linha nova nem cancela: é UPDATE, e o horário velho volta pra
//     agenda da Nilce no mesmo ato.
//
// Kill-switch: NILCE_19H_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ehFeriadoBR } from '../../utils/feriadosBR';

/** Carimbo da passagem, por ficha: `nilce_giovanna:<id>`. */
export const PASSAGEM_PREFIX = 'nilce_giovanna:';

const DE = 'Nilce';
const PARA = 'Giovanna';
const TZ = 'America/Sao_Paulo';

/** A grade do perfil de conta baixa — espelha a `GRADE_NILCE` da LP do solar
 *  (dashboard/public/io/solar/index.html): 08:00–11:00 e 13:00–16:00, de 30 em
 *  30, almoço fechado. Vale pras duas: a Giovanna atende o mesmo perfil, então
 *  herda a mesma grade. Mexeu na LP? mexa aqui, senão a varredura marca num
 *  horário que a página nunca venderia. */
export const GRADE_NILCE: string[] = (() => {
  const out: string[] = [];
  for (let t = 8 * 60; t <= 16 * 60; t += 30) {
    if (t > 11 * 60 && t < 13 * 60) continue;
    out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return out;
})();

/** O primeiro contato dela é ligação. Vale pros dois lados da sobreposição. */
const DUR_LIGACAO_MS = 15 * 60 * 1000;
const DUR_APRESENTACAO_MS = 30 * 60 * 1000;
const duracaoDe = (createdBy: string | null): number =>
  String(createdBy || '').includes('eletroposto') ? DUR_APRESENTACAO_MS : DUR_LIGACAO_MS;

const HORIZONTE_DIAS_UTEIS = 10;

/** Ficha com horário anterior a isto nunca é movida. */
export const VARREDURA_INICIO = '2026-08-17T00:00:00.000Z';

const desligado = () => (process.env.NILCE_19H_OFF || '').trim() === '1';

// ── datas em Brasília ────────────────────────────────────────────────────────
const fmtYmd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const ymdSP = (d: Date): string => fmtYmd.format(d);

/** ISO real de um horário de Brasília. -03:00 fixo: o Brasil não tem horário de verão. */
const isoDe = (ymd: string, hhmm: string): string => new Date(`${ymd}T${hhmm}:00-03:00`).toISOString();

const diaDaSemana = (ymd: string): number => new Date(`${ymd}T12:00:00-03:00`).getUTCDay();

function ehDiaUtil(ymd: string): boolean {
  const dow = diaDaSemana(ymd);
  return dow !== 0 && dow !== 6 && !ehFeriadoBR(ymd);
}

/** Os próximos N dias úteis a partir do dia SEGUINTE a `base`. */
function proximosDiasUteis(base: string, quantos: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${base}T12:00:00-03:00`);
  for (let i = 0; i < 40 && out.length < quantos; i++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const ymd = ymdSP(cursor);
    if (ehDiaUtil(ymd)) out.push(ymd);
  }
  return out;
}

const horaBonita = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Chave de telefone igual à do CRM: DDD + últimos 8 (tolera o 9 e o 55). */
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

type Ficha = {
  id: number; quando: string; cliente_nome: string | null; cliente_telefone: string | null;
  status: string; temperatura: string | null; created_by: string | null; historico: string | null;
};

export type ResultadoVarredura = {
  ok: true;
  off?: boolean;
  paradas: number;
  movidas: number;
  sem_vaga: number;
  dias_usados: string[];
  previa?: Array<{ id: number; cliente: string; de: string; para: string }>;
};

export async function runNilceParaGiovanna(opts: { dry?: boolean } = {}): Promise<ResultadoVarredura> {
  const dry = !!opts.dry;
  const vazio: ResultadoVarredura = {
    ok: true, paradas: 0, movidas: 0, sem_vaga: 0, dias_usados: [],
  };
  if (desligado() && !dry) return { ...vazio, off: true };

  const agora = new Date();
  const agoraIso = agora.toISOString();

  // DUAS leituras, e a distinção é o coração deste módulo: o que está parado sai
  // da agenda da NILCE; a vaga é procurada na agenda da GIOVANNA.
  const [daNilce, daGiovanna] = await Promise.all([
    supabaseGerador.from('agendamentos')
      .select('id,quando,cliente_nome,cliente_telefone,status,temperatura,created_by,historico')
      .eq('vendedor_nome', DE)
      .not('status', 'in', '(cancelado,sem_interesse)')
      .gte('quando', VARREDURA_INICIO)
      .order('quando', { ascending: true }),
    supabaseGerador.from('agendamentos')
      .select('id,quando,cliente_nome,cliente_telefone,status,temperatura,created_by,historico')
      .eq('vendedor_nome', PARA)
      .not('status', 'in', '(cancelado,sem_interesse)')
      .gte('quando', agoraIso),
  ]);
  if (daNilce.error) { logger.error('nilce-19h', 'falha lendo a agenda da Nilce', daNilce.error); return vazio; }
  if (daGiovanna.error) { logger.error('nilce-19h', 'falha lendo a agenda da Giovanna', daGiovanna.error); return vazio; }

  const fichas = (daNilce.data || []) as Ficha[];
  const agendaDela = (daGiovanna.data || []) as Ficha[];

  // Cliente que JÁ tem horário futuro (com qualquer uma das duas) não entra:
  // seria a mesma pessoa em dois lugares da agenda.
  const telsComFuturo = new Set(
    [...fichas.filter(f => f.quando > agoraIso), ...agendaDela]
      .map(f => telKey(f.cliente_telefone)).filter(Boolean) as string[]);

  const paradas = fichas.filter(f =>
    f.quando <= agoraIso && f.status === 'agendado' && !f.temperatura
    && !telsComFuturo.has(telKey(f.cliente_telefone) || '__'));

  if (!paradas.length) return { ...vazio, ...(dry ? { previa: [] } : {}) };

  // Ocupação da GIOVANNA daqui pra frente. Vai crescendo conforme a varredura
  // marca — senão duas fichas cairiam no mesmo horário dela.
  const ocupado: Array<{ ini: number; dur: number }> = agendaDela.map(f => ({
    ini: new Date(f.quando).getTime(), dur: duracaoDe(f.created_by),
  }));
  const cabe = (t: number) =>
    t > agora.getTime() && !ocupado.some(o => o.ini < t + DUR_LIGACAO_MS && t < o.ini + o.dur);

  const dias = proximosDiasUteis(ymdSP(agora), HORIZONTE_DIAS_UTEIS);

  // Encaixe: dia a dia, horário a horário, do primeiro livre em diante.
  let diaIdx = 0, slotIdx = 0;
  function proximaVaga(): string | null {
    while (diaIdx < dias.length) {
      while (slotIdx < GRADE_NILCE.length) {
        const iso = isoDe(dias[diaIdx], GRADE_NILCE[slotIdx]);
        slotIdx++;
        if (cabe(new Date(iso).getTime())) return iso;
      }
      diaIdx++; slotIdx = 0;
    }
    return null;
  }

  let movidas = 0, semVaga = 0;
  const usados = new Set<string>();
  const previa: Array<{ id: number; cliente: string; de: string; para: string }> = [];

  for (const f of paradas) {
    const novoIso = proximaVaga();
    if (!novoIso) { semVaga++; continue; }

    if (dry) {
      previa.push({ id: f.id, cliente: f.cliente_nome || '(sem nome)', de: horaBonita(f.quando), para: horaBonita(novoIso) });
      ocupado.push({ ini: new Date(novoIso).getTime(), dur: DUR_LIGACAO_MS });
      usados.add(novoIso.slice(0, 10));
      continue;
    }

    const linha = `[${horaBonita(agoraIso)} · Sistema] 🕖 Sem ação até as 19h: passou de ${DE} para ${PARA}, `
      + `de ${horaBonita(f.quando)} para ${horaBonita(novoIso)}.`;
    const { error: erroUpd } = await supabaseGerador.from('agendamentos')
      .update({
        vendedor_nome: PARA,
        quando: novoIso,
        historico: f.historico ? `${linha}\n\n${f.historico}` : linha,
      })
      .eq('id', f.id)
      // Corrida com gente: mexeu no status entre a leitura e agora? quem manda é ela.
      .eq('status', 'agendado');
    if (erroUpd) {
      logger.error('nilce-19h', 'passar ficha falhou', { id: f.id, erro: String(erroUpd) });
      continue;
    }

    ocupado.push({ ini: new Date(novoIso).getTime(), dur: DUR_LIGACAO_MS });
    usados.add(novoIso.slice(0, 10));
    await supabase.from('system_state').upsert(
      { key: `${PASSAGEM_PREFIX}${f.id}`, value: { em: agoraIso, de: f.quando, para: novoIso, dono: PARA }, updated_at: agoraIso },
      { onConflict: 'key' },
    ).then(undefined, (e: unknown) =>
      logger.error('nilce-19h', 'carimbo da passagem falhou', { id: f.id, erro: String(e) }));
    movidas++;
  }

  if (semVaga) logger.warn('nilce-19h', `${semVaga} ficha(s) sem vaga na agenda da ${PARA} em ${HORIZONTE_DIAS_UTEIS} dias úteis — ficaram com a ${DE}`);
  if (movidas) logger.info('nilce-19h', `${movidas} ficha(s) passaram de ${DE} pra ${PARA}, em ${usados.size} dia(s)`);

  return {
    ok: true,
    paradas: paradas.length,
    movidas,
    sem_vaga: semVaga,
    dias_usados: [...usados].sort(),
    ...(dry ? { previa } : {}),
  };
}
