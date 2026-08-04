// ─────────────────────────────────────────────────────────────────────────────
// QUANDO O CLIENTE DE SOLAR RESPONDE — o recado vai pro consultor dono da ficha.
//
// Este módulo é a outra metade do solarBoasVindas.ts, e sem ele o primeiro toque
// vira mentira: a mensagem pergunta o consumo e diz "estamos prontos, te
// aguardando". Se a resposta cair no 5040 e ficar lá — que é o que acontece hoje
// nessa linha, onde ninguém responde por robô e o recibo de entrada só sai 12h e
// 18h — a pessoa manda o consumo (ou a foto da conta de luz) e descobre no dia
// seguinte que falou sozinha. Pedir resposta e não ler a resposta é pior que não
// pedir (é a mesma lição do eletropostoRespostas.ts, escrita depois do mesmo erro).
//
// ── Pra quem vai o recado ──
// Pro CONSULTOR DONO da ficha, não pra uma lista fixa. Toda ficha de solar já
// nasce com `vendedor_nome` (rodízio Thiago→Diego→Nilce, ou o dono do telefone),
// e o WhatsApp sai da tabela `consultores`. O Thiago recebe cópia porque o pedido
// dele é "sempre nos mantém informado" — e porque, se a ficha estiver sem
// consultor com número cadastrado, alguém precisa ficar com a bola.
//
// ── O que ele lê ──
// `wa_mensagens` (Supabase solardoc-pro): a fila normalizada do webhook da linha,
// com trigger ao vivo. Mesma fonte do conversa_wa().
//
// ── Casamento de telefone ──
// A Z-API entrega o inbound às vezes SEM o 9º dígito e a ficha tem ele. A chave é
// DDD + últimos 8, a mesma do blastRespostas e do CRM. Casar telefone cru aqui
// faria o agente nunca disparar, em silêncio.
//
// ── Travas ──
//   • Só ficha que as boas-vindas TOCARAM (boas_vindas_at) e só mensagem
//     posterior ao toque: conversa que o consultor já estava tendo não vira alerta.
//   • Marcador por ficha guarda até onde já foi avisado → nem repete, nem pula
//     mensagem nova. Cliente falante gera 2 ou 3 recados, e tudo bem.
//   • Espera curta antes de avisar, pra não cortar "meu consumo é 400" seguido de
//     "e é casa" em dois recados separados.
//   • Teto de avisos por rodada.
//
// Morre junto com o primeiro toque (SOLAR_BOASVINDAS_OFF=1): boca ligada com
// ouvido desligado não é uma configuração que faça sentido existir.
// Kill-switch só desta metade: SOLAR_RESPOSTAS_OFF=1.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE } from '../../routes/ioSolar';
import { SOLAR_ORIGENS, desligado as boasVindasDesligado } from './solarBoasVindas';

const INSTANCE_ID_IO = (process.env.ZAPI_INSTANCE_ID_IO || '3F26F6ECE67D72BB7FCA6244BF24326C').trim();

export const SOLAR_RESPOSTA_PREFIX = 'solar_resposta:';

const ESPERA_MS = 30 * 1000;
/** Teto de leitura: não acorda conversa velha ao subir o módulo pela 1ª vez. */
const LOOKBACK_MAX_MS = 3 * 24 * 3600_000;
/** Ficha de mais de 7 dias já é caso do consultor, não da automação. */
const FICHA_MAX_MS = 7 * 24 * 3600_000;
const MAX_AVISOS_POR_TICK = 5;

const desligado = () => (process.env.SOLAR_RESPOSTAS_OFF || '').trim() === '1';

/** Mesma chave do CRM e do blastRespostas: DDD + últimos 8 (ignora 9º dígito e DDI). */
function telKey(raw: string | null | undefined): string | null {
  const d = String(raw || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

interface Msg { texto: string; tipo: string; momment: string }

/** O recado que cai no WhatsApp do consultor. O texto do cliente vai INTEIRO —
 *  robô nenhum resume aqui: o consumo é a matéria-prima do estudo. */
export function montarRecado(
  ficha: { cliente_nome: string | null; cliente_telefone: string | null; vendedor_nome: string | null; cidade?: string | null },
  msgs: Msg[],
): string {
  const textos = msgs.map(m => m.texto).filter(Boolean);
  const tel = String(ficha.cliente_telefone || '').replace(/\D/g, '');

  // Mídia conta separado: a foto da conta de luz é o recado mais rico que chega,
  // e quem só lê texto passa direto por ela.
  const midias = new Map<string, number>();
  for (const m of msgs) {
    if (m.tipo && m.tipo !== 'texto') midias.set(m.tipo, (midias.get(m.tipo) ?? 0) + 1);
  }
  const rotuloMidia: Record<string, [string, string]> = {
    imagem: ['imagem', 'imagens'],
    audio: ['áudio', 'áudios'],
    video: ['vídeo', 'vídeos'],
    documento: ['documento', 'documentos'],
    localizacao: ['localização', 'localizações'],
  };
  const linhaMidia = [...midias.entries()]
    .map(([tipo, n]) => `${n} ${(rotuloMidia[tipo] ?? [tipo, tipo])[n > 1 ? 1 : 0]}`).join(' · ');

  return [
    '💬 *CLIENTE DE SOLAR RESPONDEU* — ☀️',
    '',
    `*${ficha.cliente_nome || 'Sem nome'}*`,
    ...(ficha.cidade ? [`Cidade: ${ficha.cidade}`] : []),
    `É seu: *${ficha.vendedor_nome || '—'}*`,
    `WhatsApp: wa.me/${tel}`,
    '',
    '_Escreveu:_',
    ...(textos.length ? textos.slice(0, 8).map(t => `• ${t.slice(0, 400)}`) : ['• (só mídia, sem texto)']),
    ...(linhaMidia ? ['', `📎 ${linhaMidia}`] : []),
    '',
    '_Respondeu às boas-vindas do cadastro. Nessa linha ninguém responde por robô — a bola está com você._',
  ].join('\n');
}

interface Ficha {
  id: number;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  vendedor_nome: string | null;
  cidade: string | null;
  boas_vindas_at: string | null;
}

export type ResultadoSolarRespostas = {
  avisados: number;
  erros: number;
  motivo?: string;
  previa?: Array<{ id: number; cliente: string; para: string[]; mensagens: number; recado: string }>;
};

const zero = (motivo?: string): ResultadoSolarRespostas => ({ avisados: 0, erros: 0, ...(motivo ? { motivo } : {}) });

/** nome do consultor → WhatsApp dele. */
async function carregarConsultores(): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const { data, error } = await supabaseGerador.from('consultores').select('nome, whatsapp').limit(100);
    if (error) throw error;
    for (const c of data ?? []) {
      if (c?.nome && c?.whatsapp) mapa.set(String(c.nome), String(c.whatsapp));
    }
  } catch (err) {
    logger.error('solar-respostas', 'ler consultores falhou — recado vai só pro dono', err);
  }
  return mapa;
}

/** Consultor dono + o dono da operação, sem repetir número. Nunca devolve vazio:
 *  recado que não tem pra quem ir é resposta perdida. */
export function destinatarios(consultorTel: string | null | undefined): string[] {
  const chave = (t: string) => t.replace(/\D/g, '').replace(/^55/, '').slice(-8);
  const dono = EQUIPE.thiago;
  const lista = [String(consultorTel || '').trim(), dono].filter(Boolean);
  const vistos = new Set<string>();
  return lista.filter(t => {
    const k = chave(t);
    if (!k || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

export async function runSolarRespostasTick(opts: { dry?: boolean } = {}): Promise<ResultadoSolarRespostas> {
  if (!opts.dry && (boasVindasDesligado() || desligado())) return zero('desligado');

  const agora = Date.now();

  // 1) Fichas de solar que as boas-vindas tocaram.
  const { data: fichas, error: eFichas } = await supabaseGerador
    .from('agendamentos')
    .select('id, cliente_nome, cliente_telefone, vendedor_nome, cidade, boas_vindas_at')
    .in('created_by', SOLAR_ORIGENS)
    .eq('status', 'agendado')
    .not('boas_vindas_at', 'is', null)
    .gte('boas_vindas_at', new Date(agora - FICHA_MAX_MS).toISOString())
    .limit(300);
  if (eFichas) { logger.error('solar-respostas', 'ler fichas falhou', eFichas); return { ...zero('erro_fichas'), erros: 1 }; }
  if (!fichas?.length) return zero('ninguem_tocado');

  // Filtro refeito em JS: se o `.not()` da consulta mudar, ficha sem toque cairia
  // no piso de 3 dias e viraria alerta em cima de conversa que o humano já tinha.
  const porChave = new Map<string, Ficha>();
  for (const f of fichas as Ficha[]) {
    if (!f.boas_vindas_at) continue;
    const k = telKey(f.cliente_telefone);
    if (k) porChave.set(k, f);
  }
  if (porChave.size === 0) return zero('ninguem_tocado');

  // 2) Marcadores: até onde cada ficha já foi avisada.
  const { data: marcadores } = await supabase
    .from('system_state').select('key, value')
    .like('key', `${SOLAR_RESPOSTA_PREFIX}%`)
    .limit(1000);
  const jaAvisadoAte = new Map<number, string>();
  for (const m of marcadores ?? []) {
    const id = Number(String(m.key).slice(SOLAR_RESPOSTA_PREFIX.length));
    const ate = ((m.value ?? {}) as { ate?: string }).ate;
    if (Number.isInteger(id) && ate) jaAvisadoAte.set(id, ate);
  }

  // Corte por ficha: o mais recente entre o toque das boas-vindas e o último
  // aviso já dado. Mensagem anterior a isso não é resposta à automação.
  const pisoGlobal = new Date(agora - LOOKBACK_MAX_MS).toISOString();
  const corteDaFicha = new Map<number, string>();
  for (const f of porChave.values()) {
    const corte = [String(f.boas_vindas_at), jaAvisadoAte.get(f.id) ?? '', pisoGlobal].filter(Boolean).sort().pop()!;
    corteDaFicha.set(f.id, corte);
  }
  const menorCorte = [...corteDaFicha.values()].sort()[0] ?? pisoGlobal;

  // 3) Inbound da linha desde o menor corte. Uma consulta só; recorte fino em JS.
  const teto = new Date(agora - ESPERA_MS).toISOString();
  const { data: msgs, error: eMsgs } = await supabase
    .from('wa_mensagens')
    .select('telefone, texto, tipo, momment')
    .eq('from_me', false)
    .eq('is_group', false)
    .eq('instancia', INSTANCE_ID_IO)
    .gte('momment', menorCorte)
    .lte('momment', teto)
    .order('momment', { ascending: true })
    .limit(1000);
  if (eMsgs) { logger.error('solar-respostas', 'ler wa_mensagens falhou', eMsgs); return { ...zero('erro_inbound'), erros: 1 }; }
  if (!msgs?.length) return zero('sem_inbound');

  const porFicha = new Map<number, Msg[]>();
  for (const m of msgs) {
    const k = telKey(m.telefone);
    if (!k) continue;
    const f = porChave.get(k);
    if (!f) continue;
    const momment = String(m.momment);
    if (momment <= (corteDaFicha.get(f.id) ?? pisoGlobal)) continue;
    const lista = porFicha.get(f.id) ?? [];
    lista.push({ texto: String(m.texto || '').trim(), tipo: String(m.tipo || 'texto'), momment });
    porFicha.set(f.id, lista);
  }
  if (porFicha.size === 0) return zero('ninguem_respondeu');

  const telPorConsultor = await carregarConsultores();

  // 4) Avisa.
  let avisados = 0, erros = 0;
  const previa: NonNullable<ResultadoSolarRespostas['previa']> = [];

  for (const [id, lista] of porFicha) {
    if (avisados >= MAX_AVISOS_POR_TICK) break;
    const ficha = [...porChave.values()].find(f => f.id === id)!;
    const recado = montarRecado(ficha, lista);
    const para = destinatarios(telPorConsultor.get(String(ficha.vendedor_nome || '')));

    if (opts.dry) {
      previa.push({ id, cliente: String(ficha.cliente_nome || '—'), para, mensagens: lista.length, recado });
      avisados++;
      continue;
    }

    // Marca ANTES de enviar: falha de envio não pode virar recado repetido a cada
    // 5 min. Perder um aviso é melhor que virar spam interno.
    const ate = lista.map(m => m.momment).sort().pop()!;
    const nowIso = new Date().toISOString();
    await supabase.from('system_state').upsert(
      { key: `${SOLAR_RESPOSTA_PREFIX}${id}`, value: { ate, avisado_em: nowIso }, updated_at: nowIso },
      { onConflict: 'key' },
    );

    try {
      const envios = await Promise.allSettled(para.map(num => sendWhatsApp(num, recado, 'io')));
      const ok = envios.filter(e => e.status === 'fulfilled').length;
      if (ok === 0) throw new Error('nenhum destinatário recebeu');
      avisados++;
      logger.info('solar-respostas', `resposta da ficha #${id} avisada a ${ok}/${envios.length}`);
    } catch (e) {
      logger.error('solar-respostas', 'falha ao avisar', { id, erro: String(e) });
      erros++;
    }
  }

  return { avisados, erros, ...(opts.dry ? { motivo: 'dry', previa } : {}) };
}
