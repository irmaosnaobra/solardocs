// ─────────────────────────────────────────────────────────────────────────────
// VARREDURA DAS 18H — o dia da Nilce fecha e o que ninguém tocou cai no próximo.
//
// Ordem do Thiago (17/08/2026): "os da Nilce, às 18h, os que não tiveram ação
// joga para o próximo dia útil, encaixando nos marcados anterior até lotar; se
// ainda sobrar, jogar para o outro dia ainda".
//
// A diferença pro repasse de 12h (que ela deixou de usar no mesmo dia) é o
// ENCAIXE. O de 12h devolvia a ficha no MESMO horário do dia seguinte — o que
// espalha os parados pelo dia e deixa buraco no meio. Aqui a agenda dela é
// remontada: pega os horários que ainda estão livres no próximo dia útil, do
// primeiro ao último, e vai preenchendo. Encheu o dia, o resto vai pro seguinte.
//
// ── O que conta como "sem ação" ──
// Ficha DELA, com o horário já vencido, ainda em `agendado` e sem temperatura.
// Quem tem temperatura foi qualificado; quem está `nao_atendeu`, `sem_orcamento`
// ou perdido teve ação de gente e não é assunto de robô — continua na lista das
// 17h pra ela resolver na mão. E cliente que já tem outro horário FUTURO marcado
// não ganha um segundo: seria a mesma pessoa em dois lugares da agenda.
//
// ── Travas ──
//   • Piso de "daqui pra frente" (VARREDURA_INICIO): ficha com horário anterior à
//     entrada no ar nunca é movida. Sem isso, a primeira execução despejaria meses
//     de ficha parada nos próximos dias úteis.
//   • No máximo 3 quicadas por ficha. Sem isso, o lead que ninguém nunca atende
//     volta pro 08:00 todo dia e empurra pra tarde quem marcou hoje de manhã —
//     a fila se inverte e o mais frio passa na frente do mais quente.
//   • Horizonte de 10 dias úteis. O que não couber fica onde está e é relatado.
//
// ── O que ele NÃO faz ──
//   • Não troca o consultor: é dela e continua dela.
//   • Não manda mensagem pra ninguém. Os avisos de agenda do /gerador estão
//     desligados por ordem de 25 e 28/07 e isto não é desculpa pra religar um.
//     O rastro fica no histórico da ficha.
//   • Não cria linha nova nem cancela: é UPDATE do `quando`, e o horário velho
//     volta pra agenda no mesmo ato.
//
// Kill-switch: NILCE_18H_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { ehFeriadoBR } from '../../utils/feriadosBR';

/** Contador de quicadas por ficha: `nilce_18h:<id>`. */
export const NILCE_18H_PREFIX = 'nilce_18h:';

const CONSULTOR = 'Nilce';
const TZ = 'America/Sao_Paulo';

/** A grade dela — espelha a `GRADE_NILCE` da LP do solar
 *  (dashboard/public/io/solar/index.html): 08:00–11:00 e 13:00–16:00, de 30 em
 *  30, almoço fechado. Mexeu lá? mexa aqui, senão a varredura marca num horário
 *  que a página nunca venderia. */
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

const MAX_QUICADAS = 3;
const HORIZONTE_DIAS_UTEIS = 10;

/** Ficha com horário anterior a isto nunca é movida. */
export const VARREDURA_INICIO = '2026-08-17T00:00:00.000Z';

const desligado = () => (process.env.NILCE_18H_OFF || '').trim() === '1';

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

async function quicadasDe(ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!ids.length) return out;
  const { data } = await supabase.from('system_state')
    .select('key,value').in('key', ids.map(id => `${NILCE_18H_PREFIX}${id}`));
  for (const r of (data || []) as { key: string; value: any }[]) {
    const id = Number(r.key.slice(NILCE_18H_PREFIX.length));
    if (Number.isFinite(id)) out.set(id, Number(r.value?.vezes) || 0);
  }
  return out;
}

export type ResultadoVarredura = {
  ok: true;
  off?: boolean;
  paradas: number;
  movidas: number;
  puladas_no_teto: number;
  sem_vaga: number;
  dias_usados: string[];
  previa?: Array<{ id: number; cliente: string; de: string; para: string }>;
};

export async function runNilceVarredura18h(opts: { dry?: boolean } = {}): Promise<ResultadoVarredura> {
  const dry = !!opts.dry;
  const vazio: ResultadoVarredura = {
    ok: true, paradas: 0, movidas: 0, puladas_no_teto: 0, sem_vaga: 0, dias_usados: [],
  };
  if (desligado() && !dry) return { ...vazio, off: true };

  const agora = new Date();
  const agoraIso = agora.toISOString();

  // Tudo da agenda dela que importa numa consulta só: o que está parado (passado)
  // e o que já está marcado daqui pra frente (pra saber o que está ocupado).
  const { data, error } = await supabaseGerador.from('agendamentos')
    .select('id,quando,cliente_nome,cliente_telefone,status,temperatura,created_by,historico')
    .eq('vendedor_nome', CONSULTOR)
    .not('status', 'in', '(cancelado,sem_interesse)')
    .gte('quando', VARREDURA_INICIO)
    .order('quando', { ascending: true });
  if (error) { logger.error('nilce-18h', 'falha lendo a agenda dela', error); return vazio; }

  const fichas = (data || []) as Ficha[];
  const futuras = fichas.filter(f => f.quando > agoraIso);

  // Cliente que JÁ tem horário futuro não entra: seria a mesma pessoa duas vezes.
  const telsComFuturo = new Set(futuras.map(f => telKey(f.cliente_telefone)).filter(Boolean) as string[]);

  const paradas = fichas.filter(f =>
    f.quando <= agoraIso && f.status === 'agendado' && !f.temperatura
    && !telsComFuturo.has(telKey(f.cliente_telefone) || '__'));

  if (!paradas.length) return { ...vazio, ...(dry ? { previa: [] } : {}) };

  // Ocupação daqui pra frente, por intervalo. Vai crescendo conforme a varredura
  // marca — senão duas fichas cairiam no mesmo horário.
  const ocupado: Array<{ ini: number; dur: number }> = futuras.map(f => ({
    ini: new Date(f.quando).getTime(), dur: duracaoDe(f.created_by),
  }));
  const cabe = (t: number) =>
    t > agora.getTime() && !ocupado.some(o => o.ini < t + DUR_LIGACAO_MS && t < o.ini + o.dur);

  const quicadas = await quicadasDe(paradas.map(f => f.id));
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

  let movidas = 0, puladas = 0, semVaga = 0;
  const usados = new Set<string>();
  const previa: Array<{ id: number; cliente: string; de: string; para: string }> = [];

  for (const f of paradas) {
    if ((quicadas.get(f.id) || 0) >= MAX_QUICADAS) { puladas++; continue; }

    const novoIso = proximaVaga();
    if (!novoIso) { semVaga++; continue; }

    if (dry) {
      previa.push({ id: f.id, cliente: f.cliente_nome || '(sem nome)', de: horaBonita(f.quando), para: horaBonita(novoIso) });
      ocupado.push({ ini: new Date(novoIso).getTime(), dur: DUR_LIGACAO_MS });
      usados.add(novoIso.slice(0, 10));
      continue;
    }

    const vez = (quicadas.get(f.id) || 0) + 1;
    const linha = `[${horaBonita(agoraIso)} · Sistema] 🕕 Fechamento do dia: sem ação até as 18h, `
      + `remarcado de ${horaBonita(f.quando)} para ${horaBonita(novoIso)} (${vez}ª vez).`;
    const { error: erroUpd } = await supabaseGerador.from('agendamentos')
      .update({
        quando: novoIso,
        historico: f.historico ? `${linha}\n\n${f.historico}` : linha,
      })
      .eq('id', f.id)
      // Corrida com gente: mexeu no status entre a leitura e agora? quem manda é ela.
      .eq('status', 'agendado');
    if (erroUpd) {
      logger.error('nilce-18h', 'mover ficha falhou', { id: f.id, erro: String(erroUpd) });
      continue;
    }

    ocupado.push({ ini: new Date(novoIso).getTime(), dur: DUR_LIGACAO_MS });
    usados.add(novoIso.slice(0, 10));
    await supabase.from('system_state').upsert(
      { key: `${NILCE_18H_PREFIX}${f.id}`, value: { vezes: vez, em: agoraIso, de: f.quando, para: novoIso }, updated_at: agoraIso },
      { onConflict: 'key' },
    ).then(undefined, (e: unknown) =>
      logger.error('nilce-18h', 'carimbo do contador falhou', { id: f.id, erro: String(e) }));
    movidas++;
  }

  if (semVaga) logger.warn('nilce-18h', `${semVaga} ficha(s) sem vaga em ${HORIZONTE_DIAS_UTEIS} dias úteis — ficaram onde estavam`);
  if (movidas) logger.info('nilce-18h', `${movidas} ficha(s) da Nilce empacotadas em ${usados.size} dia(s)`);

  return {
    ok: true,
    paradas: paradas.length,
    movidas,
    puladas_no_teto: puladas,
    sem_vaga: semVaga,
    dias_usados: [...usados].sort(),
    ...(dry ? { previa } : {}),
  };
}
