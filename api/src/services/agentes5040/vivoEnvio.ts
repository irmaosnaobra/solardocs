// ─────────────────────────────────────────────────────────────────────────────
// O ENVIO DA RESPOSTA AO VIVO DAS AGENTES DA 5040 (B1c-2). Segundo e ÚLTIMO arquivo da pasta
// agentes5040/ que importa o zapiClient (o outro é fichaEnvio.ts). vivo.ts, entrada.ts, posse.ts e o
// ensaio só chegam ao envio por aqui, e o teste de isolamento depende disso.
//
// Robôs `duda_vivo_5040`, `helena_vivo_5040` e `carla_vivo_5040` (reativo_p1, respeitaPausa, 1 bolha,
// até 160 caracteres, pela instância 'io'). Condições do chefe-antiban, NESTA ordem. A primeira que
// barrar encerra; nada é reservado, enviado nem carimbado antes de todas passarem:
//
//   1. bolha: uma só, até 160, sem travessão (a peça link/Pix tem validação própria, não tem teto de 160);
//   2. prazo: a fala do lead tem até 15 min NA HORA DO ENVIO;
//   3. linha pausada (ag5040_linha_pausa) ou em cooldown na memória: não reserva, para não queimar o carimbo;
//   4. pausa humana (podeFalarComLead; telefone sem chave, como um LID cru, também barra);
//   5. bloqueado (fora do padrão);
//   6. supressão do telefone, por MOTIVO (leitura ESTRITA: erro de leitura barra, nunca passa). É resposta a quem
//      acabou de escrever: barram só opt_out e denuncia ('mudo') e fora_do_padrao ('bloqueado'); 'pediu_humano'
//      = não fala e a rodada passa ao humano ('pediu_humano'). 'nunca_respondeu' e os mudos de wa_mudos valem só
//      para toque proativo (frio e abertura) e NÃO barram resposta;
//   7. robô do outro lado (temRoboAtendendo e pareceRoboDeles sobre a fala do lead);
//   8. teto das agentes: ag5040_sent:% com updated_at na última 1 h < 20 e em 24 h < 120;
//   9. teto de emergência da linha: tudo que a linha conta + ag5040_sent: + ficha_lead: (as fichas ao consultor
//      saem pela mesma linha) < 60 na hora e < 450 em 24 h;
//  10. espaçamento: 10 s contra o último ag5040_sent no BANCO (nunca sleep);
//  11. dry encerra aqui, sem reservar;
//  12. reserva por INSERT ag5040_sent:<waIdAlvo>:1 (23505 = ja_respondido, nada sai);
//  13. sendHuman(tel, [bolha], 'io', { maxBolhas: 1, max: 160 });
//  14. peça link/Pix em 2ª chamada, carimbo :2, SÓ se a bolha saiu;
//  15. erro de linha conta em ag5040_linha_erros; 2 seguidos gravam ag5040_linha_pausa (15 min); envio ok zera.
//
// O carimbo de um envio que falhou FICA (conta no teto e a mesma fala não é reenviada). O prefixo
// `ag5040_sent:` fica FORA de BOT_SENT_PREFIXES de propósito e nunca é `aviso_sent:`. Nenhum valor
// gravado aqui leva telefone: só dona, waId e hora. Todas as janelas saem do `agora` injetado.
// Imagem fica para a B3.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { sendHuman, linhaEmCooldown } from '../agents/zapiClient';
import { podeFalarComLead } from '../agents/whatsapp/pausaHumana';
import { chaveContato, estaBloqueado, motivosDaSupressao } from '../agents/whatsapp/silenciar';
import { pareceRoboDeles, temRoboAtendendo, marcarRoboDoOutroLado } from '../agents/whatsapp/roboDoOutroLado';
import { prefixosDaLinha, PREFIXOS_AGENDA } from '../agents/whatsapp/lineThrottle';
import { classificarErroEnvio } from '../chefe/decidir';

const LOG = 'vivo-envio-5040';

export interface PedidoEnvio {
  dona: 'duda' | 'helena' | 'carla';
  telefone: string;
  waIdAlvo: number;
  momentoFalaLead: string;
  bolha: string;
  peca?: { tipo: 'link' | 'pix'; texto: string };
  dry?: boolean;
}

export type MotivoRecusa =
  | 'prazo' | 'linha_pausada' | 'pausa_humana' | 'bloqueado' | 'mudo' | 'robo_do_outro_lado'
  | 'teto_agentes' | 'teto_linha' | 'espacamento' | 'ja_respondido' | 'erro_linha' | 'dry' | 'bolha_invalida'
  | 'pediu_humano';

export type ResultadoEnvio =
  | { ok: true; enviadas: number; carimbos: string[] }
  | { ok: false; motivo: MotivoRecusa; detalhe?: string };

export const PREFIXO_CARIMBO = 'ag5040_sent:';
/** A ficha ao consultor sai pela mesma linha (reserva `ficha_lead:<hmac>`): entra na conta do teto de emergência. */
export const PREFIXO_FICHA = 'ficha_lead:';
export const CHAVE_LINHA_PAUSA = 'ag5040_linha_pausa';
export const CHAVE_LINHA_ERROS = 'ag5040_linha_erros';

/** Os números do parecer do chefe-antiban. Nenhum afrouxa. */
export const LIMITES = Object.freeze({
  prazoMs: 15 * 60_000,
  maxCaracteresBolha: 160,
  maxCaracteresPeca: 900,
  tetoAgentesHora: 20,
  tetoAgentesDia: 120,
  tetoLinhaHora: 60,
  tetoLinhaDia: 450,
  espacamentoMs: 10_000,
  errosParaPausar: 2,
  pausaMs: 15 * 60_000,
});

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
const PAGINA = 1000;

/** Espera entre a bolha e a peça (2 a 5 s, como o intervalo entre bolhas do sendHuman). Os testes zeram. */
export const TEMPOS = { entreBolhaEPecaMs: (): number => 2000 + Math.floor(Math.random() * 3000) };
const dormir = (ms: number): Promise<void> => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

const recusa = (motivo: MotivoRecusa, detalhe?: string): ResultadoEnvio => (detalhe ? { ok: false, motivo, detalhe } : { ok: false, motivo });
const codigoDe = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'desconhecido').slice(0, 20);

/**
 * Um código CURTO para o erro de envio: o texto do erro do Z-API traz o corpo da resposta e pode repetir o
 * telefone, então ele nunca vai para o carimbo, o relatório nem o log. Só o status HTTP ou uma palavra.
 */
export function codigoDoErroDeEnvio(e: unknown): string {
  const m = String((e as { message?: string } | null)?.message ?? e);
  const http = /HTTP\s+(\d{3})/.exec(m);
  if (http) return `http_${http[1]}`;
  if (/cooldown/i.test(m)) return 'cooldown';
  if (/credenciais/i.test(m)) return 'credenciais';
  if (/timeout|timed out|abort/i.test(m)) return 'timeout';
  return 'falha';
}

/**
 * O erro é do DESTINO (número inválido ou inexistente: 4xx comum do Z-API que não é instância fora)? É a mesma régua
 * do chefe (classificarErroEnvio === 'destino'). Esse erro NÃO conta nos 2 seguidos que pausam a linha por 15 min:
 * dois leads com telefone ruim não podem calar a linha inteira (correção 13 do B1d-2).
 */
export const erroEhDoDestino = (err: unknown): boolean => classificarErroEnvio(err) === 'destino';
const TRAVESSAO = /[—–]/;

// ── 1. validação das falas ───────────────────────────────────────────────────

function bolhaInvalida(p: PedidoEnvio): string | null {
  const b = String(p.bolha ?? '');
  if (!b.trim()) return 'vazia';
  if (b.trim().length > LIMITES.maxCaracteresBolha) return 'passa_de_160';
  if (TRAVESSAO.test(b)) return 'travessao';
  if (b.includes('||')) return 'mais_de_uma_bolha';
  if (!Number.isInteger(p.waIdAlvo) || p.waIdAlvo <= 0) return 'wa_id';
  if (!['duda', 'helena', 'carla'].includes(p.dona)) return 'dona';
  if (p.peca) {
    const t = String(p.peca.texto ?? '');
    if (p.peca.tipo !== 'link' && p.peca.tipo !== 'pix') return 'peca_tipo';
    if (!t.trim()) return 'peca_vazia';
    if (t.length > LIMITES.maxCaracteresPeca) return 'peca_longa';
    if (TRAVESSAO.test(t)) return 'peca_travessao';
    if (t.includes('||')) return 'peca_com_separador';
  }
  return null;
}

// ── contagens e estado (system_state, sem dado pessoal) ──────────────────────

/**
 * Quantos carimbos com estes prefixos têm updated_at desde `desde`. Paginado (o PostgREST corta em 1000)
 * e para ao chegar em `parar`. null = a leitura falhou (quem chama barra: contagem que não se fez não passa).
 */
async function contarCarimbos(prefixos: string[], desde: Date, parar: number): Promise<number | null> {
  const filtro = prefixos.map(p => `key.like.${p}%`).join(',');
  let total = 0;
  for (let de = 0; de < 100_000; de += PAGINA) {
    const { data, error } = await supabase
      .from('system_state').select('key')
      .or(filtro)
      .gte('updated_at', desde.toISOString())
      .order('key', { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) { logger.error(LOG, `contagem de carimbos falhou (${codigoDe(error)})`); return null; }
    const lote = (data ?? []) as unknown[];
    total += lote.length;
    if (total >= parar || lote.length < PAGINA) return total;
  }
  return total;
}

/** A linha está pausada por erros seguidos? 'erro' = não deu para ler (barra). */
async function linhaPausada(agora: Date): Promise<'sim' | 'nao' | 'erro'> {
  const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_PAUSA).maybeSingle();
  if (error) { logger.error(LOG, `leitura da pausa da linha falhou (${codigoDe(error)})`); return 'erro'; }
  const ate = Date.parse(String((data as { value?: { ate?: string } } | null)?.value?.ate ?? ''));
  return Number.isFinite(ate) && ate > agora.getTime() ? 'sim' : 'nao';
}

async function lerErrosSeguidos(): Promise<number> {
  const { data } = await supabase.from('system_state').select('value').eq('key', CHAVE_LINHA_ERROS).maybeSingle();
  const n = Number((data as { value?: { n?: number } } | null)?.value?.n ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function gravarErros(n: number, agora: Date): Promise<void> {
  const { error } = await supabase.from('system_state').upsert(
    { key: CHAVE_LINHA_ERROS, value: { n, em: agora.toISOString() }, updated_at: agora.toISOString() }, { onConflict: 'key' });
  if (error) logger.error(LOG, `não gravei o contador de erros da linha (${codigoDe(error)})`);
}

/** Envio ok: o contador de erros seguidos volta a zero (só escreve se havia algo a zerar). */
async function zerarErros(agora: Date): Promise<void> {
  try { if ((await lerErrosSeguidos()) > 0) await gravarErros(0, agora); } catch (err) { logger.error(LOG, 'não zerei o contador de erros da linha', err); }
}

/** Erro de linha: soma ao contador; no 2º seguido grava a pausa de 15 min (e o contador segue alto: a 1ª falha depois da pausa repausa). */
async function contarErroDeLinha(agora: Date): Promise<void> {
  try {
    const n = (await lerErrosSeguidos()) + 1;
    await gravarErros(n, agora);
    if (n >= LIMITES.errosParaPausar) {
      const ate = new Date(agora.getTime() + LIMITES.pausaMs).toISOString();
      const { error } = await supabase.from('system_state').upsert(
        { key: CHAVE_LINHA_PAUSA, value: { ate, motivo: 'erros_seguidos', n }, updated_at: agora.toISOString() }, { onConflict: 'key' });
      if (error) logger.error(LOG, `não gravei a pausa da linha (${codigoDe(error)})`);
      else logger.error(LOG, `linha pausada ate ${ate} (${n} erros seguidos)`);
    }
  } catch (err) { logger.error(LOG, 'contagem de erro da linha falhou', err); }
}

// ── reserva ──────────────────────────────────────────────────────────────────

const chaveCarimbo = (waId: number, n: number): string => `${PREFIXO_CARIMBO}${waId}:${n}`;

async function reservar(chave: string, p: PedidoEnvio, agora: Date): Promise<'ok' | 'ja' | 'erro'> {
  const { error } = await supabase.from('system_state').insert({
    key: chave,
    value: { dona: p.dona, wa_id: p.waIdAlvo, em: agora.toISOString(), estado: 'reservado' },
    updated_at: agora.toISOString(),
  });
  if (!error) return 'ok';
  if (codigoDe(error) === '23505') return 'ja';
  logger.error(LOG, `reserva de ${chave} falhou (${codigoDe(error)})`);
  return 'erro';
}

/** Marca no valor do carimbo como terminou. Só o valor: updated_at fica, senão o teto andaria sozinho. */
async function marcarCarimbo(chave: string, estado: 'enviado' | 'falhou', erro?: string): Promise<void> {
  try {
    await supabase.from('system_state').update({ value: { estado, ...(erro ? { erro } : {}) } }).eq('key', chave);
  } catch { /* o carimbo já está lá; o estado é só para quem conferir */ }
}

// ── 7. robô do outro lado ────────────────────────────────────────────────────

/** O SILENCIO de 12 h é por `robo_outro_lado:<dígitos>`: confere a forma com e sem o 55, que os chamadores antigos misturam. */
function formasDoTelefone(tel: string): string[] {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (!d) return [];
  const alt = d.startsWith('55') && d.length >= 12 ? d.slice(2) : `55${d}`;
  return [d, alt];
}

async function roboDoOutroLado(p: PedidoEnvio): Promise<ResultadoEnvio | null> {
  for (const f of formasDoTelefone(p.telefone)) {
    if (await temRoboAtendendo(f)) return recusa('robo_do_outro_lado', 'silencio_12h');
  }
  // O texto da fala do lead: lido da própria linha de wa_mensagens (o contrato do pedido não o carrega).
  const { data, error } = await supabase.from('wa_mensagens').select('texto').eq('id', p.waIdAlvo).maybeSingle();
  if (error) { logger.error(LOG, `leitura da fala ${p.waIdAlvo} falhou (${codigoDe(error)})`); return recusa('robo_do_outro_lado', 'leitura_falhou'); }
  if (!data) return recusa('robo_do_outro_lado', 'fala_nao_achada');
  const v = pareceRoboDeles(String((data as { texto?: string | null }).texto ?? ''));
  if (v.nivel === 'certeza') {
    // Mesmo gesto da Giovanna e da recepção: certeza cala o número por 12 h. Rodada seca (dry) não cala número real.
    try { if (!p.dry) await marcarRoboDoOutroLado(p.telefone, v.sinal); } catch (err) { logger.error(LOG, 'não marquei o robô do outro lado', codigoDe(err)); }
    return recusa('robo_do_outro_lado', `certeza:${v.sinal}`);
  }
  // Suspeita não cala o número: só não responde ESTA fala.
  if (v.nivel === 'suspeita') return recusa('robo_do_outro_lado', `suspeita:${v.sinal}`);
  return null;
}

// ── a função ─────────────────────────────────────────────────────────────────

export async function enviarResposta(p: PedidoEnvio, agora: Date = new Date()): Promise<ResultadoEnvio> {
  const t0 = agora.getTime();

  // 1. bolha
  const invalida = bolhaInvalida(p);
  if (invalida) return recusa('bolha_invalida', invalida);

  // 2. prazo: a fala do lead tem até 15 min na hora do envio
  const fala = Date.parse(String(p.momentoFalaLead ?? ''));
  if (!Number.isFinite(fala)) return recusa('prazo', 'momento_invalido');
  if (t0 - fala > LIMITES.prazoMs) return recusa('prazo', 'passou_de_15min');

  // 3. linha pausada pelos erros seguidos, ou em cooldown (falhou há menos de 60 s). Antes da reserva.
  const pausa = await linhaPausada(agora);
  if (pausa === 'sim') return recusa('linha_pausada', 'erros_seguidos');
  if (pausa === 'erro') return recusa('linha_pausada', 'leitura_falhou');
  if (linhaEmCooldown('io')) return recusa('linha_pausada', 'cooldown');

  // 4. pausa humana. O gate falha aberto (erro de banco = pode) e não entende LID cru: sem chave não se fala.
  if (!chaveContato(p.telefone)) return recusa('pausa_humana', 'telefone_sem_chave');
  const gate = await podeFalarComLead(p.telefone);
  if (!gate.pode) return recusa('pausa_humana', gate.motivo);

  // 5. bloqueado (fora do padrão)
  if (await estaBloqueado(p.telefone)) return recusa('bloqueado');

  // 6. supressão por MOTIVO, leitura estrita: erro barra. Resposta a quem acabou de escrever: 'nunca_respondeu' e os
  // mudos (wa_mudos) são regra de toque proativo e não entram aqui.
  let motivos: string[];
  try {
    motivos = await motivosDaSupressao(p.telefone);
  } catch (err) {
    logger.error(LOG, `leitura da supressão falhou: ${codigoDe(err)}`);
    return recusa('mudo', 'leitura_falhou');
  }
  if (motivos.includes('opt_out')) return recusa('mudo', 'opt_out');
  if (motivos.includes('denuncia')) return recusa('mudo', 'denuncia');
  if (motivos.includes('fora_do_padrao')) return recusa('bloqueado');
  if (motivos.includes('pediu_humano')) return recusa('pediu_humano');

  // 7. robô do outro lado
  const robo = await roboDoOutroLado(p);
  if (robo) return robo;

  // 8. teto das agentes
  const agHora = await contarCarimbos([PREFIXO_CARIMBO], new Date(t0 - HORA_MS), LIMITES.tetoAgentesHora);
  if (agHora === null) return recusa('teto_agentes', 'leitura_falhou');
  if (agHora >= LIMITES.tetoAgentesHora) return recusa('teto_agentes', `hora:${agHora}`);
  const agDia = await contarCarimbos([PREFIXO_CARIMBO], new Date(t0 - DIA_MS), LIMITES.tetoAgentesDia);
  if (agDia === null) return recusa('teto_agentes', 'leitura_falhou');
  if (agDia >= LIMITES.tetoAgentesDia) return recusa('teto_agentes', `dia:${agDia}`);

  // 9. teto de emergência da linha: o que a linha conta (frio e agenda) + os carimbos das agentes
  const prefixosLinha = [...new Set([...prefixosDaLinha(), ...PREFIXOS_AGENDA, PREFIXO_CARIMBO, PREFIXO_FICHA])];
  const lnHora = await contarCarimbos(prefixosLinha, new Date(t0 - HORA_MS), LIMITES.tetoLinhaHora);
  if (lnHora === null) return recusa('teto_linha', 'leitura_falhou');
  if (lnHora >= LIMITES.tetoLinhaHora) return recusa('teto_linha', `hora:${lnHora}`);
  const lnDia = await contarCarimbos(prefixosLinha, new Date(t0 - DIA_MS), LIMITES.tetoLinhaDia);
  if (lnDia === null) return recusa('teto_linha', 'leitura_falhou');
  if (lnDia >= LIMITES.tetoLinhaDia) return recusa('teto_linha', `dia:${lnDia}`);

  // 10. espaçamento: 10 s contra o último ag5040_sent no banco
  const { data: ultimo, error: erroUltimo } = await supabase
    .from('system_state').select('updated_at').like('key', `${PREFIXO_CARIMBO}%`)
    .order('updated_at', { ascending: false }).limit(1);
  if (erroUltimo) { logger.error(LOG, `leitura do último envio falhou (${codigoDe(erroUltimo)})`); return recusa('espacamento', 'leitura_falhou'); }
  const ultimoEm = Date.parse(String(((ultimo ?? []) as Array<{ updated_at?: string }>)[0]?.updated_at ?? ''));
  if (Number.isFinite(ultimoEm) && t0 - ultimoEm < LIMITES.espacamentoMs) return recusa('espacamento', `${t0 - ultimoEm}ms`);

  // 11. dry para aqui: nada reservado
  if (p.dry) return recusa('dry');

  // 12. reserva por insert
  const chave1 = chaveCarimbo(p.waIdAlvo, 1);
  const reserva = await reservar(chave1, p, agora);
  if (reserva === 'ja') return recusa('ja_respondido');
  if (reserva === 'erro') return recusa('erro_linha', 'reserva_falhou');

  // 13. a bolha
  const carimbos = [chave1];
  try {
    await sendHuman(p.telefone, [p.bolha.trim()], 'io', { maxBolhas: 1, max: LIMITES.maxCaracteresBolha });
  } catch (err) {
    // O carimbo fica: pode ter saído (5xx e timeout), e a mesma fala não é reenviada.
    // Só o código (status HTTP ou palavra): o texto do erro do Z-API traz o corpo da resposta e pode repetir o telefone.
    const cod = codigoDoErroDeEnvio(err);
    logger.error(LOG, `envio da fala ${p.waIdAlvo} falhou: ${cod}`);
    await marcarCarimbo(chave1, 'falhou', cod);
    if (!erroEhDoDestino(err)) await contarErroDeLinha(agora);
    return recusa('erro_linha', cod);
  }
  await marcarCarimbo(chave1, 'enviado');
  await zerarErros(agora);
  let enviadas = 1;

  // 14. a peça (link ou Pix), em 2ª chamada, só porque a bolha saiu
  if (p.peca) {
    const chave2 = chaveCarimbo(p.waIdAlvo, 2);
    const r2 = await reservar(chave2, p, agora);
    if (r2 === 'ok') {
      carimbos.push(chave2);
      try {
        await dormir(TEMPOS.entreBolhaEPecaMs());
        await sendHuman(p.telefone, [p.peca.texto.trim()], 'io', { maxBolhas: 1, max: LIMITES.maxCaracteresPeca });
        await marcarCarimbo(chave2, 'enviado');
        enviadas = 2;
      } catch (err) {
        // A bolha já saiu: o resultado segue ok com enviadas = 1, e o erro conta para a linha.
        const cod2 = codigoDoErroDeEnvio(err);
        logger.error(LOG, `envio da peça ${p.waIdAlvo} falhou: ${cod2}`);
        await marcarCarimbo(chave2, 'falhou', cod2);
        if (!erroEhDoDestino(err)) await contarErroDeLinha(agora);
      }
    } else if (r2 === 'erro') {
      logger.error(LOG, `peça ${p.waIdAlvo}: reserva não gravou, a peça não sai`);
    }
  }

  return { ok: true, enviadas, carimbos };
}
