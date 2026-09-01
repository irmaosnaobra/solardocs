// ─────────────────────────────────────────────────────────────────────────────
// SAÚDE DA LINHA: o aviso que chega ANTES do bloqueio.
//
// A linha caiu três vezes e nas três a descoberta foi pelo pior caminho
// possível: cliente reclamando que ninguém respondeu. Não havia número sendo
// olhado, então o primeiro sinal era sempre o prejuízo. Nas 41 horas fora do ar
// de 04 a 06 de agosto havia 42 reuniões marcadas dentro da janela, todas sem
// lembrete.
//
// Este monitor não impede nada. Ele só faz o problema aparecer enquanto ainda dá
// tempo de agir, que é a única coisa que faltava.
//
// ── OS QUATRO SINAIS ──
//
// razão saída/entrada é o principal, porque é o que o WhatsApp mede pra decidir
// se você é conversa ou é disparo. Conta saudável fica perto de 1:1; a nossa
// estava em 3,28 quando começamos a medir.
//
// pico por hora é o segundo, porque rajada derruba mais rápido que volume: a
// linha bloqueou em agosto com 37 mensagens numa hora, não com o total do dia.
//
// mudos com 3+ toques é o gerador de denúncia, e denúncia é o que a Meta usa
// pra banir. Este número tem que CAIR com o tempo; se subir, alguma trilha
// voltou a insistir com quem nunca respondeu.
//
// envios em 24h é escala, não risco por si. Serve pra ler os outros três.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { sendOpsAlert } from '../../../utils/mailer';

/**
 * Limiares. Nascem da linha de base medida em 01/09/2026 (razão 3,16, pico 57,
 * 224 mudos), e não de número redondo: o alerta tem que disparar antes do
 * próximo bloqueio, não depois, mas também não pode tocar todo dia, porque
 * alarme que sempre toca vira alarme desligado.
 */
const LIMIARES = {
  // Acima de 3 já é padrão de disparo. O alvo depois dos cortes é ficar abaixo de 2.
  razaoAtencao: 3.0,
  razaoCritico: 4.0,
  // A linha bloqueou com 37 numa hora. 40 é atenção; 60 é o que precede queda.
  picoAtencao: 40,
  picoCritico: 60,
  // Hoje são 224 e a tendência tem que ser de queda. Subir 15% é sinal de que
  // alguma trilha voltou a furar o portão proativo.
  mudos: 260,
  // Escala: acima disso o dia foi atípico e vale olhar mesmo com o resto ok.
  envios24h: 450,
};

interface Saude {
  razao: number;
  saidas_cliente: number;
  entradas_cliente: number;
  pico_hora: number;
  hora_do_pico: string;
  mudos: number;
  envios_24h: number;
}

export interface ResultadoMonitor {
  saude: Saude | null;
  alertas: string[];
  enviado: boolean;
  motivo?: string;
}

/** Um alerta por dia, no máximo. Alarme repetido é alarme ignorado. */
const CHAVE_DIA = () => `linha_saude_alerta:${new Date().toISOString().slice(0, 10)}`;

export async function runLinhaSaudeMonitor(
  opts: { dry?: boolean } = {},
): Promise<ResultadoMonitor> {
  const out: ResultadoMonitor = { saude: null, alertas: [], enviado: false };

  const { data, error } = await supabase.rpc('wa_saude_linha');
  if (error || !data?.[0]) {
    logger.error('linha-saude', 'leitura falhou', error);
    out.motivo = 'leitura falhou';
    return out;
  }
  const s = data[0] as Saude;
  out.saude = s;

  const razao = Number(s.razao);
  if (razao >= LIMIARES.razaoCritico) {
    out.alertas.push(`CRÍTICO: razão saída/entrada em ${razao} para 1 (${s.saidas_cliente} saíram, ${s.entradas_cliente} entraram em 7 dias). Conta saudável fica perto de 1:1 e isto é padrão de disparo.`);
  } else if (razao >= LIMIARES.razaoAtencao) {
    out.alertas.push(`Atenção: razão saída/entrada em ${razao} para 1 (${s.saidas_cliente} saíram, ${s.entradas_cliente} entraram em 7 dias).`);
  }

  if (s.pico_hora >= LIMIARES.picoCritico) {
    out.alertas.push(`CRÍTICO: pico de ${s.pico_hora} envios numa hora só (${s.hora_do_pico}). A linha bloqueou em agosto com 37 numa hora.`);
  } else if (s.pico_hora >= LIMIARES.picoAtencao) {
    out.alertas.push(`Atenção: pico de ${s.pico_hora} envios em ${s.hora_do_pico}. Rajada derruba mais rápido que volume.`);
  }

  if (s.mudos >= LIMIARES.mudos) {
    out.alertas.push(`Atenção: ${s.mudos} pessoas levaram 3 toques ou mais sem nunca responder nem ter conta. Este número tem que cair; se subiu, alguma trilha está furando o portão proativo.`);
  }

  if (s.envios_24h >= LIMIARES.envios24h) {
    out.alertas.push(`Atenção: ${s.envios_24h} envios nas últimas 24h. Volume atípico, vale olhar de onde veio.`);
  }

  if (!out.alertas.length) {
    logger.info('linha-saude', `ok: razão ${razao}, pico ${s.pico_hora}, mudos ${s.mudos}, 24h ${s.envios_24h}`);
    return out;
  }

  if (opts.dry) return out;

  // Um por dia. A chave é a data, então o primeiro alerta do dia passa e os
  // seguintes ficam só no log: quem vai agir já foi avisado.
  const chave = CHAVE_DIA();
  const { data: jaAvisou } = await supabase
    .from('system_state').select('key').eq('key', chave).maybeSingle();
  if (jaAvisou) {
    out.motivo = 'já avisado hoje';
    logger.info('linha-saude', `alerta suprimido (já avisado hoje): ${out.alertas.join(' | ')}`);
    return out;
  }

  const critico = out.alertas.some((a) => a.startsWith('CRÍTICO'));
  const html = [
    `<p><b>Saúde da linha do WhatsApp</b></p>`,
    '<ul>',
    ...out.alertas.map((a) => `<li>${a}</li>`),
    '</ul>',
    '<p style="color:#666">Números de agora: ',
    `razão ${razao}:1 · pico ${s.pico_hora}/h em ${s.hora_do_pico} · `,
    `${s.mudos} mudos com 3+ toques · ${s.envios_24h} envios em 24h.</p>`,
    '<p style="color:#666">O que costuma resolver, em ordem: ver qual trilha gerou o pico, ',
    'conferir se o aviso interno voltou pra linha comercial, e checar se alguma rotina ',
    'está insistindo com quem nunca respondeu.</p>',
  ].join('');

  try {
    await sendOpsAlert(
      `${critico ? '🔴' : '🟡'} Linha do WhatsApp: ${out.alertas.length} sinal(is) de risco`,
      html,
    );
    await supabase.from('system_state').upsert(
      { key: chave, value: { alertas: out.alertas.length }, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    out.enviado = true;
    logger.info('linha-saude', `alerta enviado: ${out.alertas.length} sinais`);
  } catch (err) {
    logger.error('linha-saude', 'envio do alerta falhou', err);
    out.motivo = 'envio falhou';
  }

  return out;
}
