// ─────────────────────────────────────────────────────────────────────────────
// UM aviso por apagão — não um por cliente.
//
// Quando a fila do WhatsApp desiste de uma mensagem (ver processMessageQueue),
// ela avisava o Thiago NA HORA, uma mensagem por cliente. Parece certo até a
// causa ser GLOBAL: em 08/08/2026 o crédito da Anthropic zerou, toda mensagem
// da fila falhou junto, todas cruzaram a janela de 45 min no mesmo minuto e o
// WhatsApp dele virou uma parede de avisos idênticos — cada um repetindo o
// mesmo "credit balance is too low". O aviso que devia gritar "a IA parou"
// virou barulho que se lê e se ignora.
//
// Aqui a falha vira duas coisas separadas:
//   1. MARCADOR (`ia_falha:<id>`) — quem ficou sem resposta, gravado na hora.
//   2. AVISO — um só, no fim do tick, juntando todo mundo da MESMA causa, com
//      carência por causa (crédito zerado não muda de minuto em minuto).
//
// Como o flush roda uma vez por tick (a cada 5 min), 10 mensagens que falham
// juntas viram UMA mensagem — mesmo sem carência nenhuma.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { sendWhatsApp } from '../zapiClient';
import { logger } from '../../../utils/logger';

const DONO_PHONE = (process.env.FILA_ALERTA_PHONE || '34991360223').trim();

// Quantas pessoas o aviso lista antes de resumir ("+N outros"). Lista longa demais
// não é lida no celular — o que importa é a causa e os primeiros da fila.
const MAX_NA_LISTA = 12;

export type CausaFalha = 'ia_sem_credito' | 'ia_chave' | 'ia_limite' | 'zapi' | 'outro';

// Carência por CAUSA, em minutos. Causa que só um humano resolve (crédito, chave)
// não merece lembrete a cada 5 min; causa que passa sozinha (limite/sobrecarga)
// merece um pouco mais de frequência; erro desconhecido é o mais raro e o mais
// urgente de ver. Env-tunável porque num dia ruim se quer mais ou menos barulho.
const CARENCIA_MIN: Record<CausaFalha, number> = {
  ia_sem_credito: Number(process.env.FILA_ALERTA_CARENCIA_CREDITO_MIN || 60),
  ia_chave:       Number(process.env.FILA_ALERTA_CARENCIA_CREDITO_MIN || 60),
  ia_limite:      Number(process.env.FILA_ALERTA_CARENCIA_LIMITE_MIN  || 30),
  zapi:           Number(process.env.FILA_ALERTA_CARENCIA_OUTRO_MIN   || 15),
  outro:          Number(process.env.FILA_ALERTA_CARENCIA_OUTRO_MIN   || 15),
};

/**
 * De qual doença é esse erro. O texto vem cru do provedor, então casa por trecho
 * estável (a mensagem da Anthropic para crédito é literal e não muda há meses).
 */
export function classificarFalha(errMsg: string): CausaFalha {
  const e = String(errMsg || '').toLowerCase();
  if (e.includes('credit balance is too low') || e.includes('billing')) return 'ia_sem_credito';
  if (e.includes('authentication_error') || e.includes('x-api-key') || e.includes('invalid api key')
      || e.includes('permission_error') || /\b401\b/.test(e) || /\b403\b/.test(e)) return 'ia_chave';
  if (e.includes('rate_limit') || e.includes('overloaded') || e.includes('too many requests')
      || /\b429\b/.test(e) || /\b529\b/.test(e)) return 'ia_limite';
  if (e.includes('[zapi') || e.includes('z-api') || e.includes('credenciais z-api')) return 'zapi';
  return 'outro';
}

const CABECALHO: Record<CausaFalha, { titulo: string; oQueFazer: string }> = {
  ia_sem_credito: {
    titulo: 'IA parada — crédito da Anthropic zerou',
    oQueFazer: 'Nenhum robô responde até recarregar:\nconsole.anthropic.com/settings/billing',
  },
  ia_chave: {
    titulo: 'IA parada — chave da Anthropic recusada',
    oQueFazer: 'A ANTHROPIC_API_KEY foi revogada ou trocada. Gera uma nova e atualiza na Vercel.',
  },
  ia_limite: {
    titulo: 'IA engasgada — limite/sobrecarga da Anthropic',
    oQueFazer: 'Costuma passar sozinha em minutos. Se insistir, é volume — dá pra baixar o modelo.',
  },
  zapi: {
    titulo: 'Linha do WhatsApp fora — Z-API não aceitou o envio',
    oQueFazer: 'Confere a instância no painel da Z-API (pode ter caído ou perdido o QR).',
  },
  outro: {
    titulo: 'Fila do WhatsApp falhando',
    oQueFazer: 'Erro não catalogado — vale olhar o log do /process-messages.',
  },
};

type Ficha = { phone: string; nome?: string | null; texto?: string | null; erro?: string; em: string };

/**
 * Guarda que ESTA mensagem ficou sem resposta. Não envia nada: quem envia é o
 * flush no fim do tick, e é isso que junta a enxurrada num aviso só.
 */
export async function registrarAbandono(args: {
  id: string;
  phone: string;
  nome?: string | null;
  texto?: string | null;
  erro: string;
  causa?: CausaFalha;
}): Promise<CausaFalha> {
  const causa = args.causa || classificarFalha(args.erro);
  const ficha: Ficha = {
    phone: String(args.phone || '').replace(/\D/g, ''),
    nome: args.nome || null,
    texto: String(args.texto || '').slice(0, 140),
    erro: String(args.erro || '').slice(0, 180),
    em: new Date().toISOString(),
  };
  await supabase
    .from('system_state')
    .upsert(
      { key: `ia_falha:${causa}:${args.id}`, value: ficha, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
  return causa;
}

/** Faz quanto tempo, em texto curto de gente ("12min", "2h"). */
function faz(desde: string, agora: Date): string {
  const min = Math.max(0, Math.round((agora.getTime() - new Date(desde).getTime()) / 60000));
  return min < 60 ? `${min}min` : `${Math.round(min / 60)}h`;
}

function montarAviso(causa: CausaFalha, fichas: Ficha[], agora: Date): string {
  const { titulo, oQueFazer } = CABECALHO[causa];
  const ordenadas = [...fichas].sort((a, b) => a.em.localeCompare(b.em)); // quem espera há mais tempo primeiro
  const gente = ordenadas.length === 1 ? '1 cliente sem resposta' : `${ordenadas.length} clientes sem resposta`;

  const linhas = ordenadas.slice(0, MAX_NA_LISTA).map(f => {
    const quem = f.nome || f.phone;
    const disse = f.texto ? ` "${f.texto.replace(/\s+/g, ' ').slice(0, 70)}"` : '';
    return `• ${quem} (há ${faz(f.em, agora)})${disse}\n  wa.me/${f.phone}`;
  });
  const resto = ordenadas.length - linhas.length;
  if (resto > 0) linhas.push(`• +${resto} ${resto === 1 ? 'outro' : 'outros'} na fila`);

  const erroBruto = ordenadas.find(f => f.erro)?.erro;
  const rodape = causa === 'outro' && erroBruto ? `\n\nMotivo: ${erroBruto}` : '';
  const carencia = CARENCIA_MIN[causa];

  return `⚠️ *${titulo}*\n${gente} — responde na mão:\n\n${linhas.join('\n')}\n\n${oQueFazer}${rodape}\n\n_Aviso novo daqui ${carencia}min se continuar._`;
}

async function podeAvisar(causa: CausaFalha, agora: Date): Promise<boolean> {
  const { data } = await supabase
    .from('system_state').select('updated_at').eq('key', `ia_falha_aviso:${causa}`).maybeSingle();
  if (!data?.updated_at) return true;
  const desdeMin = (agora.getTime() - new Date(data.updated_at as string).getTime()) / 60000;
  return desdeMin >= CARENCIA_MIN[causa];
}

/**
 * Fim do tick: junta quem ficou sem resposta e manda UM aviso por causa.
 *
 * Regras que este fluxo protege:
 *  • O marcador só é apagado DEPOIS de o aviso sair de verdade. Se a Z-API
 *    falhar, ninguém some da lista — o próximo tick tenta de novo. (O envio
 *    antigo era `.catch(() => {})`: com um aviso só, engolir a falha significaria
 *    trocar barulho por silêncio, que é o pior dos dois.)
 *  • A carência também só é carimbada após o envio confirmado.
 */
export async function flushAvisoFila(agora: Date = new Date()): Promise<{ avisos: number; pessoas: number }> {
  const { data: marcadores } = await supabase
    .from('system_state').select('key, value').like('key', 'ia_falha:%').limit(300);

  if (!marcadores || marcadores.length === 0) return { avisos: 0, pessoas: 0 };

  const porCausa = new Map<CausaFalha, { chaves: string[]; fichas: Ficha[] }>();
  for (const m of marcadores as Array<{ key: string; value: Ficha }>) {
    const causa = (String(m.key).split(':')[1] || 'outro') as CausaFalha;
    if (!CABECALHO[causa]) continue;
    const grupo = porCausa.get(causa) || { chaves: [], fichas: [] };
    grupo.chaves.push(m.key);
    if (m.value?.phone) grupo.fichas.push(m.value);
    porCausa.set(causa, grupo);
  }

  let avisos = 0;
  let pessoas = 0;
  for (const [causa, grupo] of porCausa) {
    if (grupo.fichas.length === 0) continue;
    if (!(await podeAvisar(causa, agora))) continue;

    try {
      await sendWhatsApp(DONO_PHONE, montarAviso(causa, grupo.fichas, agora), 'solardoc');
    } catch (err) {
      // Nada é apagado: a lista sobrevive e o próximo tick tenta de novo.
      logger.error('whatsapp-fila', `aviso agregado (${causa}) não saiu — ${grupo.fichas.length} clientes seguem na lista`, err);
      continue;
    }

    await supabase.from('system_state').upsert(
      { key: `ia_falha_aviso:${causa}`, value: { pessoas: grupo.fichas.length }, updated_at: agora.toISOString() },
      { onConflict: 'key' },
    );
    await supabase.from('system_state').delete().in('key', grupo.chaves);
    avisos++;
    pessoas += grupo.fichas.length;
  }

  if (avisos > 0) logger.info('whatsapp-fila', `${avisos} aviso(s) agregado(s) — ${pessoas} cliente(s) sem resposta`);
  return { avisos, pessoas };
}
