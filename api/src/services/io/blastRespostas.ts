// ─────────────────────────────────────────────────────────────────────────────
// O que acontece quando alguém RESPONDE a um disparo.
//
// Hoje: nada. O agente de SDR tem early-return para a linha 'io', o próprio
// blast marca human_takeover pra calar os bots, e a Bia só fala com quem já
// tinha conversa. Ou seja, a pessoa responde ao anúncio que a gente mandou e
// cai no vazio até alguém abrir o WhatsApp na mão.
//
// Este serviço faz o mínimo honesto, sem colocar robô pra conversar com lead
// frio (que é como se queima número e reputação):
//
//  1. Quem pede pra parar sai da lista NA HORA, sozinho — vai pra
//     whatsapp_suppression, a mesma lista que o motor de disparo já respeita.
//     É a diferença entre "insistente" e "denunciado".
//  2. Quem responde qualquer outra coisa vira FILA visível no /admin, com o
//     texto do que escreveu, pra atendimento humano. Uma vez por pessoa.
//
// Roda junto do stop-on-reply das sequências, no /process-messages.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

const INSTANCE_ID_IO = (process.env.ZAPI_INSTANCE_ID_IO || '3F26F6ECE67D72BB7FCA6244BF24326C').trim();

/** Janela pra considerar que a resposta é DO disparo, não de outra conversa. */
const HORAS_APOS_ENVIO = 72;

/** Mesma chave do CRM: DDD + últimos 8 (ignora 9º dígito e DDI). */
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

// Pedido de parada.
//
// As fronteiras \b no FIM são o detalhe que importa. A primeira versão tinha \b
// só na abertura, e aí "pare" casava dentro de "parece" e "parede": "esse preço
// me parece alto" — um lead interessado, discutindo preço — era bloqueado
// global e permanentemente. Testado contra 20 respostas plausíveis, metade das
// quais NÃO pode suprimir ("quanto custa?", "me manda o link", "parabéns").
const RE_PARE = new RegExp(
  [
    '\\b(pare|parar|para)\\b\\s*(de|com)?\\s*(me\\s*)?(mandar|enviar|manda|envia|receber)?',
    '\\bn[ãa]o\\s+(quero|tenho\\s+interesse|me\\s+mand|me\\s+envi|perturbe)',
    '\\bsem\\s+interesse\\b',
    '\\b(remove|remover|remova)\\b',
    'descadastr',
    '\\bsair\\s+da\\s+lista\\b',
    '\\bme\\s+(tira|exclu|remov)',
    '\\bspam\\b',
    'denunc',
    '\\bbloquear\\b',
  ].join('|'),
  'i',
);

/** Normaliza pro MESMO formato da lista de disparo (55 + DDD + 9 + 8 dígitos).
 *
 *  carregarSupressao (ioSend.ts) casa por sufixo de 10 dígitos, e o 9º dígito
 *  desloca esse sufixo: gravar o telefone cru do inbound — que a Z-API às vezes
 *  entrega sem o 9 — produzia uma chave que nunca casava com o contato da lista.
 *  Resultado: a pessoa pedia "pare", entrava na supressão, e continuava
 *  recebendo. É exatamente o caminho da denúncia que a supressão existe pra
 *  evitar. */
function normalizarParaSupressao(raw: string): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return '55' + d.slice(0, 2) + '9' + d.slice(-8);
}

/** Exposto só pra teste: o regex é a peça que decide silenciar alguém pra sempre. */
export const RE_PARE_TESTE = RE_PARE;

export type ResultadoRespostas = {
  inbound: number;
  suprimidos: number;
  paraAtender: number;
};

export async function runBlastRespostas(): Promise<ResultadoRespostas> {
  const vazio: ResultadoRespostas = { inbound: 0, suprimidos: 0, paraAtender: 0 };

  // 1) Quem recebeu disparo recentemente. Sem ninguém na janela, não há o que
  //    cruzar — sai barato (é o caso de todo dia em que não há campanha).
  const desdeEnvio = new Date(Date.now() - HORAS_APOS_ENVIO * 3600_000).toISOString();
  const { data: envios, error: eEnvios } = await supabase
    .from('io_broadcast_envios')
    .select('phone, broadcast_id, enviado_em')
    .gte('enviado_em', desdeEnvio)
    .limit(5000);
  if (eEnvios) { logger.error('blast-resp', 'ler envios falhou', eEnvios); return vazio; }

  const porChave = new Map<string, string>();  // telKey → broadcast_id
  for (const e of (envios ?? []) as Array<{ phone: string; broadcast_id: string }>) {
    const k = telKey(e.phone);
    if (k && !porChave.has(k)) porChave.set(k, e.broadcast_id);
  }

  // A nutrição da SEMENTE também promete "responde PARAR que eu paro" — e promessa
  // de saída que não funciona é pior que não prometer. Ela não passa por
  // io_broadcast_envios (não é disparo de lista), então entra aqui pela chave de
  // estado dela: quem foi tocado nas últimas horas conta como destinatário.
  for (const [prefixo, rotulo] of [['semente:', 'semente'], ['ep_grupo_frio:', 'grupo-eletroposto']] as const) {
    const { data: tocados } = await supabase
      .from('system_state').select('key')
      .like('key', `${prefixo}%`)
      .gte('updated_at', desdeEnvio)
      .limit(2000);
    for (const s of tocados ?? []) {
      const k = String(s.key).slice(prefixo.length);
      if (k && !porChave.has(k)) porChave.set(k, rotulo);
    }
  }

  // Ninguém recebeu nada na janela: não há o que cruzar e o tick sai barato
  // (é o caso de todo dia sem campanha).
  if (porChave.size === 0) return vazio;

  // 2) Inbound real da linha nos últimos ~6 min (janela maior que o tick de 5).
  const desdeInbound = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { data: rows, error: eRows } = await supabase
    .from('webhook_debug')
    .select('payload, created_at')
    .gte('created_at', desdeInbound)
    .order('created_at', { ascending: false })
    .limit(300);
  if (eRows) { logger.error('blast-resp', 'ler webhook_debug falhou', eRows); return vazio; }

  type Resposta = { phone: string; chave: string; texto: string; broadcastId: string };
  const respostas = new Map<string, Resposta>();

  for (const r of rows ?? []) {
    const p = ((r as { payload: unknown }).payload ?? {}) as Record<string, any>;
    if (p.type !== 'ReceivedCallback') continue;
    if (p.instanceId !== INSTANCE_ID_IO) continue;
    if (p.isGroup === true || p.isGroup === 'true') continue;
    if (p.fromMe === true || p.fromMe === 'true') continue;   // é o nosso envio

    const phone = String(p.phone || p.senderPhone || '').replace(/\D/g, '');
    const k = telKey(phone);
    if (!k || !porChave.has(k)) continue;                      // não recebeu disparo: outra conversa

    // Legenda de imagem/vídeo/documento conta: "me tira da lista" escrito em
    // cima de uma foto é o mesmo pedido, e passava batido.
    const texto = String(
      p.text?.message
        ?? p.message?.text
        ?? p.image?.caption
        ?? p.video?.caption
        ?? p.document?.caption
        ?? p.audio?.caption
        ?? p.body
        ?? p.caption
        ?? '',
    ).slice(0, 900);

    if (!respostas.has(k)) {
      respostas.set(k, { phone, chave: k, texto, broadcastId: porChave.get(k)! });
    }
  }

  if (respostas.size === 0) return vazio;

  // A janela de leitura do inbound (6 min) é maior que o tick (5 min), então a
  // MESMA resposta aparece em dois ticks seguidos. O índice único não segura
  // isso — respondido_em tem default now(), então cada tick gera uma chave nova.
  // A checagem é aqui: uma linha por pessoa por dia.
  const desde24h = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: jaRegistradas } = await supabase
    .from('io_blast_respostas')
    .select('tel_key')
    .gte('respondido_em', desde24h);
  const jaTem = new Set((jaRegistradas ?? []).map((x: { tel_key: string }) => x.tel_key));

  let suprimidos = 0;
  let paraAtender = 0;

  for (const r of respostas.values()) {
    if (jaTem.has(r.chave)) continue;
    const querParar = RE_PARE.test(r.texto);

    if (querParar) {
      // Entra na MESMA lista que o motor de disparo já consulta antes de mandar.
      const { error } = await supabase.from('whatsapp_suppression').upsert(
        {
          phone: normalizarParaSupressao(r.phone) ?? r.phone,
          motivo: 'pediu para parar (resposta a disparo)',
          origem: 'blast-io',
        },
        { onConflict: 'phone' },
      );
      if (error) logger.error('blast-resp', `supressão falhou pra ${r.phone}`, error);
      else suprimidos++;
    } else {
      paraAtender++;
    }

    // Registra a resposta nos dois casos: a negativa também é informação (diz se
    // a copy está irritando as pessoas).
    const { error: eIns } = await supabase.from('io_blast_respostas').insert({
      phone: r.phone,
      tel_key: r.chave,
      texto: r.texto || null,
      broadcast_id: r.broadcastId,
      classificacao: querParar ? 'negativa' : 'atender',
    });
    // 23505 = a mesma resposta já foi registrada num tick anterior.
    if (eIns && (eIns as { code?: string }).code !== '23505') {
      logger.error('blast-resp', 'registrar resposta falhou', eIns);
    }
  }

  if (suprimidos || paraAtender) {
    logger.info('blast-resp', `respostas ao disparo: ${paraAtender} pra atender, ${suprimidos} pediram parada`);
  }
  return { inbound: respostas.size, suprimidos, paraAtender };
}
