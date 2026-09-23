// ─────────────────────────────────────────────────────────────────────────────
// O TICK DA PAUSA HUMANA — lê a linha e marca quem tem gente dentro.
//
// Mora separado do pausaHumana.ts de propósito: o gate é importado por dezenas
// de módulos de envio e precisa ser leve; o tick é importado só pelo cron.
//
// Uma varredura só de `webhook_debug` resolve as três coisas, porque as três
// saem das MESMAS linhas:
//   1. mapa LID→telefone      ← linhas que trazem chatLid E telefone real
//   2. humano digitou         ← fromMe && !fromApi && !isGroup
//   3. lead falou             ← !fromMe  (alimenta a régua de esfriamento)
//
// Por que `webhook_debug` e não `wa_mensagens`. A `wa_mensagens` é normalizada e
// indexada, e seria a fonte mais limpa, mas ela NÃO tem a coluna `chatLid` — e
// sem chatLid não existe mapa. Como o mapa é obrigatório, a varredura vem do
// payload cru, que tem tudo. Uma leitura só, `created_at` é indexado, e a janela
// de 15 min pega ~45 linhas.
//
// Tudo aqui é idempotente: rodar de novo sobre a mesma janela não duplica nem
// encurta pausa (o `pausarContato` só deixa o carimbo andar pra frente).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../../utils/supabase';
import { logger } from '../../../utils/logger';
import { chaveContato } from './silenciar';
import { pausarContato, registrarFalaDoLead, desligado } from './pausaHumana';

const LOG = 'pausa-humana-tick';

// Lidos A CADA CHAMADA, nunca no arranque do módulo. Instância quente na Vercel
// não recarrega módulo, e apertar (ou soltar) esta trava no meio de um dia ruim
// não pode depender de deploy. É a mesma regra dos tetos em lineThrottle e em
// avisosTickService, e ela já custou caro aqui.
const instanciaIO = (): string =>
  (process.env.ZAPI_INSTANCE_ID_IO || '3F26F6ECE67D72BB7FCA6244BF24326C').trim();
const janelaMin = (): number => Number(process.env.PAUSA_HUMANA_VARREDURA_MIN || 15);
const janelaSilencioH = (): number => Number(process.env.PAUSA_HUMANA_JANELA_H || 24);
/** Quantas rodadas insistir num LID que não resolve antes de desistir dele. */
const pendenteMaxTentativas = (): number =>
  Number(process.env.PAUSA_HUMANA_PENDENTE_TENTATIVAS || 240);

interface Payload {
  phone?: string;
  chatLid?: string;
  chatName?: string;
  senderName?: string;
  instanceId?: string;
  fromMe?: boolean | string;
  fromApi?: boolean | string;
  isGroup?: boolean | string;
  momment?: number | string;
}

const ehVerdade = (v: unknown): boolean => v === true || v === 'true';
const ehLid = (s: string): boolean => s.includes('@lid');
const soDigitos = (s: string): string => String(s ?? '').replace(/\D/g, '');

export interface ResultadoTick {
  lidsMapeados: number;
  pausas: number;
  falasDoLead: number;
  pendentes: number;
  resolvidosDaFila: number;
  esfriadas: number;
}

const VAZIO: ResultadoTick = {
  lidsMapeados: 0, pausas: 0, falasDoLead: 0,
  pendentes: 0, resolvidosDaFila: 0, esfriadas: 0,
};

export async function rodarPausaHumanaTick(): Promise<ResultadoTick> {
  if (desligado()) {
    logger.info(LOG, 'PAUSA_HUMANA_OFF=1 — tick não roda');
    return VAZIO;
  }

  const desde = new Date(Date.now() - janelaMin() * 60_000).toISOString();

  let linhas: Array<{ payload: Payload; created_at: string }> = [];
  try {
    const { data, error } = await supabase
      .from('webhook_debug')
      .select('payload, created_at')
      .gte('created_at', desde)
      .order('created_at', { ascending: true })
      .limit(3000);
    if (error) throw error;
    linhas = (data ?? []) as Array<{ payload: Payload; created_at: string }>;
  } catch (err) {
    logger.error(LOG, 'leitura do webhook_debug falhou — nada marcado nesta rodada', err);
    return VAZIO;
  }

  // ── passo 1: mapa LID → telefone ──────────────────────────────────────────
  // Só de quem traz os DOIS. Um LID nunca vira chave de contato sozinho: fazer
  // isso construiria um segundo silêncio calado em cima do primeiro.
  const mapa = new Map<string, { telefone: string; chave: string; visto: string }>();
  for (const l of linhas) {
    const p = l.payload || {};
    const lid = String(p.chatLid ?? '');
    const phone = String(p.phone ?? '');
    if (!ehLid(lid) || ehLid(phone)) continue;
    const telefone = soDigitos(phone);
    const chave = chaveContato(telefone);
    if (!chave) continue;
    mapa.set(lid.replace('@lid', ''), { telefone, chave, visto: l.created_at });
  }

  let lidsMapeados = 0;
  if (mapa.size) {
    try {
      const linhasMapa = Array.from(mapa.entries()).map(([lid, v]) => ({
        lid,
        telefone: v.telefone,
        chave: v.chave,
        visto_em: v.visto,
        atualizado_em: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from('wa_lid_telefone')
        .upsert(linhasMapa, { onConflict: 'lid' });
      if (error) throw error;
      lidsMapeados = linhasMapa.length;
    } catch (err) {
      logger.error(LOG, 'upsert do mapa de LID falhou', err);
    }
  }

  /** Resolve um remetente (LID ou telefone) pro telefone real. */
  async function resolver(bruto: string): Promise<string | null> {
    if (!ehLid(bruto)) {
      const t = soDigitos(bruto);
      return chaveContato(t) ? t : null;
    }
    const lid = bruto.replace('@lid', '');
    const local = mapa.get(lid);
    if (local) return local.telefone;
    try {
      const { data } = await supabase
        .from('wa_lid_telefone')
        .select('telefone')
        .eq('lid', lid)
        .maybeSingle();
      const t = data ? soDigitos((data as any).telefone || '') : '';
      return t && chaveContato(t) ? t : null;
    } catch {
      return null;
    }
  }

  // ── passo 2 e 3: humano digitou / lead falou ──────────────────────────────
  let pausas = 0, falasDoLead = 0, pendentes = 0;

  for (const l of linhas) {
    const p = l.payload || {};
    if (String(p.instanceId ?? '') !== instanciaIO()) continue;
    if (ehVerdade(p.isGroup)) continue;
    const bruto = String(p.phone ?? '');
    if (!bruto) continue;

    const quando = p.momment
      ? new Date(Number(p.momment) || Date.parse(String(p.momment)) || Date.parse(l.created_at)).toISOString()
      : l.created_at;

    const fromMe = ehVerdade(p.fromMe);
    const fromApi = ehVerdade(p.fromApi);

    if (fromMe && !fromApi) {
      // Humano digitou pelo celular. É o sinal que este módulo inteiro existe
      // pra capturar.
      const telefone = await resolver(bruto);
      if (!telefone) {
        // LID sem mapa AINDA. Vai pra fila em vez de sumir calado: medido, 6 de
        // 145 só ficam resolvíveis depois que o robô ou o lead escreve.
        if (ehLid(bruto)) {
          try {
            const lid = bruto.replace('@lid', '');
            await supabase.from('wa_lid_pendente').upsert({
              lid,
              primeira_fala: quando,
              ultima_fala: quando,
              chat_name: p.chatName ?? null,
              atualizado_em: new Date().toISOString(),
            }, { onConflict: 'lid', ignoreDuplicates: false });
            pendentes++;
          } catch (err) {
            logger.error(LOG, `falhou ao enfileirar LID pendente ${bruto}`, err);
          }
        }
        logger.info(LOG, `humano falou num contato que não deu pra resolver: ${bruto}`);
        continue;
      }
      const marcou = await pausarContato(telefone, quando, {
        origem: 'celular',
        quem: p.chatName ?? p.senderName ?? null,
      });
      if (marcou) pausas++;
      continue;
    }

    if (!fromMe) {
      const telefone = await resolver(bruto);
      if (!telefone) continue;
      await registrarFalaDoLead(telefone, quando);
      falasDoLead++;
    }
  }

  // ── passo 4: repescagem da fila de pendentes ──────────────────────────────
  let resolvidosDaFila = 0;
  try {
    const { data: fila } = await supabase
      .from('wa_lid_pendente')
      .select('lid, primeira_fala, chat_name, tentativas')
      .is('resolvido_em', null)
      .lt('tentativas', pendenteMaxTentativas())
      .order('ultima_fala', { ascending: false })
      .limit(200);

    for (const f of (fila ?? []) as Array<Record<string, any>>) {
      const lid = String(f.lid);
      let telefone: string | null = mapa.get(lid)?.telefone ?? null;
      if (!telefone) {
        const { data } = await supabase
          .from('wa_lid_telefone').select('telefone').eq('lid', lid).maybeSingle();
        const t = data ? soDigitos((data as any).telefone || '') : '';
        telefone = t && chaveContato(t) ? t : null;
      }
      if (!telefone) {
        await supabase.from('wa_lid_pendente').update({
          tentativas: Number(f.tentativas || 0) + 1,
          atualizado_em: new Date().toISOString(),
        }).eq('lid', lid);
        continue;
      }
      // Pausa nasce com a data em que o humano REALMENTE falou, não com agora:
      // senão a régua de esfriamento começaria a contar do momento errado.
      await pausarContato(telefone, String(f.primeira_fala), {
        origem: 'celular-repescado',
        quem: f.chat_name ?? null,
      });
      await supabase.from('wa_lid_pendente').update({
        resolvido_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      }).eq('lid', lid);
      resolvidosDaFila++;
    }
  } catch (err) {
    logger.error(LOG, 'repescagem da fila de LIDs falhou', err);
  }

  // ── passo 5: carimbar as que esfriaram ────────────────────────────────────
  // O gate já solta conversa fria sozinho (calcula na hora, sem depender disto).
  // Este passo é só pra auditoria: deixa no banco QUANDO soltou e por quê, pra
  // que "ninguém foi barrado" e "a pausa expirou" não fiquem iguais depois.
  let esfriadas = 0;
  try {
    const corte = new Date(Date.now() - janelaSilencioH() * 3600_000).toISOString();
    const { data } = await supabase
      .from('atendimento_pausa')
      .select('chave, ultima_fala_humano, ultima_fala_lead')
      .is('liberado_em', null)
      .lt('ultima_fala_humano', corte)
      .limit(500);
    const paraSoltar = ((data ?? []) as Array<Record<string, any>>)
      .filter(r => !r.ultima_fala_lead || String(r.ultima_fala_lead) < corte)
      .map(r => String(r.chave));
    if (paraSoltar.length) {
      await supabase.from('atendimento_pausa').update({
        liberado_em: new Date().toISOString(),
        liberado_por: 'sistema',
        motivo_liberacao: `sem fala de ninguém por ${janelaSilencioH()}h`,
        atualizado_em: new Date().toISOString(),
      }).in('chave', paraSoltar).is('liberado_em', null);
      esfriadas = paraSoltar.length;
    }
  } catch (err) {
    logger.error(LOG, 'carimbo das pausas esfriadas falhou', err);
  }

  const r: ResultadoTick = { lidsMapeados, pausas, falasDoLead, pendentes, resolvidosDaFila, esfriadas };
  if (pausas || pendentes || resolvidosDaFila || esfriadas) {
    logger.info(LOG, `pausas=${pausas} pendentes=${pendentes} repescados=${resolvidosDaFila} esfriadas=${esfriadas} lids=${lidsMapeados}`);
  }
  return r;
}
