// ─────────────────────────────────────────────────────────────────────────────
// SONDA DE DOCUMENTOS — descobre que o assinante está apanhando, sem depender
// de ele reclamar.
//
// O caso que deu origem a isto (17/09/2026): um assinante gerou o MESMO contrato,
// pro MESMO cliente, TRÊS vezes em 25 minutos, e no meio editou HTML cru na mão.
// Nada disso apareceu em lugar nenhum. A gente só soube porque ele mandou
// mensagem. Quem não manda, cancela.
//
// Três sinais, todos de dado que já existe — nenhuma telemetria nova no cliente:
//
//   1. INSISTÊNCIA: 3+ documentos do mesmo tipo, pro mesmo cliente, em menos de
//      30 minutos. Ninguém gera o mesmo contrato três vezes por gosto.
//   2. PDF FALHOU: o download que morreu no meio (pdfController registra).
//   3. REVISÃO RECUSADA: a trava de saúde barrou uma revisão que quebraria o
//      documento — a pessoa está tentando editar e não está conseguindo.
//
// AVISA, NÃO MEXE. Nenhuma linha daqui reescreve documento de ninguém: um cron
// que corrige contrato assinado sozinho não é proteção, é falha nova. Quem
// conserta antes do estrago é a trava do saudeDocumento.ts, na hora de gravar.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { sendOpsAlert } from '../../utils/mailer';
import { logger } from '../../utils/logger';

const STATE_KEY = 'sonda_documentos';
const JANELA_H = 24;
const INSISTENCIA_MIN = 3;               // 3 documentos iguais…
const INSISTENCIA_JANELA_MS = 30 * 60 * 1000;  // …em menos de 30 minutos
const REALERTA_MS = 12 * 60 * 60 * 1000; // não repete o mesmo aviso antes disso

interface Estado {
  alertadoEm?: string | null;
  assinatura?: string | null;
}

export interface Achado {
  user_id: string;
  email: string;
  motivo: 'insistencia' | 'pdf_falhou' | 'revisao_recusada';
  detalhe: string;
  quando: string;
}

function esc(s: string): string {
  return String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
}

// 3+ documentos do mesmo tipo pro mesmo cliente numa janela curta. O agrupamento
// é em JS de propósito: são poucas centenas de linhas por dia e não vale um RPC
// no banco só pra isso.
async function acharInsistencia(desde: string): Promise<Achado[]> {
  const { data } = await supabase
    .from('documents')
    .select('user_id, tipo, cliente_nome, created_at')
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    // Teto explicito: o cliente do Supabase corta em 1000 calado, e a base faz ~60
    // documentos/dia (pico de 76 em 30 dias). Se um dia passar disso, o que fica
    // de fora e' o mais antigo da janela — a sonda nao emudece.
    .limit(3000);

  const grupos = new Map<string, { user_id: string; tipo: string; cliente: string; datas: number[] }>();
  for (const d of (data ?? []) as Array<Record<string, string>>) {
    const cliente = (d.cliente_nome || '').trim().toLowerCase();
    if (!d.user_id || !cliente) continue;
    const chave = `${d.user_id}|${d.tipo}|${cliente}`;
    const g = grupos.get(chave) ?? { user_id: d.user_id, tipo: d.tipo, cliente, datas: [] };
    g.datas.push(new Date(d.created_at).getTime());
    grupos.set(chave, g);
  }

  const achados: Achado[] = [];
  for (const g of grupos.values()) {
    if (g.datas.length < INSISTENCIA_MIN) continue;
    // Janela deslizante: 3 tentativas em 30 min em QUALQUER ponto do dia — não
    // só entre a primeira e a última (quem gera de manhã e de tarde está bem).
    for (let i = 0; i + INSISTENCIA_MIN - 1 < g.datas.length; i++) {
      const j = i + INSISTENCIA_MIN - 1;
      if (g.datas[j] - g.datas[i] <= INSISTENCIA_JANELA_MS) {
        achados.push({
          user_id: g.user_id,
          email: '',
          motivo: 'insistencia',
          detalhe: `${j - i + 1}× ${g.tipo} pro mesmo cliente em ${Math.round((g.datas[j] - g.datas[i]) / 60000)} min`,
          quando: new Date(g.datas[j]).toISOString(),
        });
        break;
      }
    }
  }
  return achados;
}

async function acharEventos(desde: string): Promise<Achado[]> {
  const { data } = await supabase
    .from('feature_events')
    .select('user_id, event_type, event_data, created_at')
    .eq('feature', 'documento')
    .in('event_type', ['pdf_falhou', 'revisao_recusada'])
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(500);

  return ((data ?? []) as Array<Record<string, any>>)
    .filter(e => !!e.user_id)
    .map(e => ({
      user_id: e.user_id as string,
      email: '',
      motivo: e.event_type as Achado['motivo'],
      detalhe: e.event_type === 'pdf_falhou'
        ? `download travou em "${e.event_data?.stage ?? '?'}"`
        : `revisão barrada: ${(e.event_data?.problemas ?? []).join(' | ') || '?'}`,
      quando: e.created_at as string,
    }));
}

export async function runSondaDocumentos(opts?: { seco?: boolean }): Promise<{
  achados: Achado[];
  alertou: boolean;
  motivoDoSilencio?: string;
}> {
  const desde = new Date(Date.now() - JANELA_H * 3600_000).toISOString();

  const [insistencia, eventos] = await Promise.all([acharInsistencia(desde), acharEventos(desde)]);
  const achados = [...insistencia, ...eventos];

  if (achados.length === 0) return { achados: [], alertou: false, motivoDoSilencio: 'nada encontrado' };

  // E-mail de quem aparece, pra o aviso dizer QUEM ligar — sem isso o alerta
  // vira número e ninguém liga pra ninguém.
  const ids = [...new Set(achados.map(a => a.user_id))];
  const { data: users } = await supabase.from('users').select('id, email').in('id', ids);
  const porId = new Map((users ?? []).map((u: any) => [u.id, u.email as string]));
  for (const a of achados) a.email = porId.get(a.user_id) ?? a.user_id.slice(0, 8);

  // Assinatura do que foi encontrado: aviso igual ao de 2h atrás não vira e-mail
  // novo. O que muda (assinante novo, motivo novo) fura o dedup na hora.
  const assinatura = [...new Set(achados.map(a => `${a.user_id}:${a.motivo}`))].sort().join(',');
  const { data: st } = await supabase.from('system_state').select('value').eq('key', STATE_KEY).maybeSingle();
  const estado = (st?.value as Estado) ?? {};
  const desdeUltimo = estado.alertadoEm ? Date.now() - new Date(estado.alertadoEm).getTime() : Infinity;
  if (estado.assinatura === assinatura && desdeUltimo < REALERTA_MS) {
    return { achados, alertou: false, motivoDoSilencio: 'mesmo aviso nas últimas 12h' };
  }

  if (opts?.seco) return { achados, alertou: false, motivoDoSilencio: 'modo seco' };

  const porPessoa = new Map<string, Achado[]>();
  for (const a of achados) porPessoa.set(a.email, [...(porPessoa.get(a.email) ?? []), a]);

  const linhas = [...porPessoa.entries()].map(([email, lista]) => {
    const itens = lista.slice(0, 6).map(a => `<li>${esc(a.detalhe)} <span style="color:#94a3b8">(${esc(a.quando.slice(0, 16).replace('T', ' '))} UTC)</span></li>`).join('');
    return `<p style="margin:14px 0 4px"><b>${esc(email)}</b></p><ul style="margin:0;padding-left:18px">${itens}</ul>`;
  }).join('');

  try {
    await sendOpsAlert(
      `Documentos: ${porPessoa.size} assinante(s) apanhando`,
      `<p>Nas últimas ${JANELA_H}h, estes assinantes deram sinal de que o documento não está saindo como deveria.</p>
       ${linhas}
       <p style="margin-top:16px;color:#64748b;font-size:13px">Insistência = 3+ documentos do mesmo tipo pro mesmo cliente em menos de 30 min.
       Nenhum documento foi alterado por este aviso.</p>`,
    );
  } catch (err) {
    logger.error('sonda-documentos', 'não consegui enviar o alerta', err);
    return { achados, alertou: false, motivoDoSilencio: 'falha no envio' };
  }

  await supabase.from('system_state').upsert(
    { key: STATE_KEY, value: { alertadoEm: new Date().toISOString(), assinatura }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );

  logger.info('sonda-documentos', `alerta enviado com ${achados.length} achado(s)`);
  return { achados, alertou: true };
}
