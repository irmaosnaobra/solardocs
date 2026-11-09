// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO, os três estados que o robô local grava no campo `fazendo` do
// prospeccao_pulso e que o dono precisa saber:
//   "VOLTOU SOZINHO:"            o Instagram destravou e a agente voltou sozinha
//   "TRAVOU DE NOVO:"            travou outra vez depois de voltar
//   "PARADO ATÉ VOCÊ LIBERAR:"   ela parou e só volta quando o dono liberar
//
// O `bater` do robô reaplica o estado em TODA batida, então o mesmo prefixo fica
// no pulso por horas. O aviso é só na TROCA de estado: o último estado avisado
// fica no system_state (sem DDL nova) e o mesmo estado nunca avisa duas vezes
// seguidas. Voltar ao normal zera o último estado, para um novo incidente do
// mesmo tipo avisar de novo.
//
// O WhatsApp vai pelo MESMO caminho do aviso de "A agente parou" do cron
// (sendWhatsApp, linha 'io'). O PARADO também vai por e-mail de sistema para o
// dono (sendOpsAlert). Falha em um canal não derruba o outro.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../utils/logger';

export type IdEstadoRobo = 'voltou' | 'travou' | 'parado';

export const ESTADOS_ROBO: ReadonlyArray<{ id: IdEstadoRobo; prefixo: string }> = [
  { id: 'voltou', prefixo: 'VOLTOU SOZINHO:' },
  { id: 'travou', prefixo: 'TRAVOU DE NOVO:' },
  { id: 'parado', prefixo: 'PARADO ATÉ VOCÊ LIBERAR:' },
];

export interface EstadoRobo { id: IdEstadoRobo; prefixo: string; detalhe: string }

/** Lê o estado do campo `fazendo`: só vale o prefixo exato, no começo. */
export function estadoDoRobo(fazendo: unknown): EstadoRobo | null {
  const f = String(fazendo ?? '').normalize('NFC').trim();
  for (const e of ESTADOS_ROBO) {
    if (f.startsWith(e.prefixo)) return { ...e, detalhe: f.slice(e.prefixo.length).trim() };
  }
  return null;
}

// Texto que o dono lê: sem travessão (o do robô, se vier no detalhe, vira vírgula).
const semTravessao = (t: string) => t.replace(/\s*[—–]\s*/g, ', ');

export function textoDoAviso(e: EstadoRobo, nome: string): { linhas: string[]; assunto: string } {
  const detalhe = semTravessao(e.detalhe).slice(0, 200);
  const extra = detalhe ? [`Detalhe: ${detalhe}`] : [];
  if (e.id === 'voltou') {
    return {
      assunto: `A agente de prospecção do ${nome} voltou sozinha`,
      linhas: [`A agente de prospecção do ${nome} voltou sozinha a abordar.`, ...extra, 'Você não precisa fazer nada.'],
    };
  }
  if (e.id === 'travou') {
    return {
      assunto: `A agente de prospecção do ${nome} travou de novo`,
      linhas: [`A agente de prospecção do ${nome} travou de novo depois de voltar sozinha.`, ...extra],
    };
  }
  return {
    assunto: `A agente de prospecção do ${nome} parou e espera você liberar`,
    linhas: [
      `A agente de prospecção do ${nome} parou e só volta quando você liberar.`,
      ...extra,
      'O que fazer: crie um arquivo vazio LIBERAR-INSTAGRAM.txt na pasta worker-prospeccao.',
    ],
  };
}

const escapaHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface DepsAvisoEstado {
  /** O system_state do banco principal. */
  supabase: any;
  /** O mesmo caminho do aviso "A agente parou" do cron. */
  enviarWhatsApp: (texto: string) => Promise<unknown>;
  /** sendOpsAlert (e-mail de sistema para o dono). */
  enviarEmail: (assunto: string, html: string) => Promise<unknown>;
}

export interface ResultadoAvisoEstado {
  /** nada = mesmo estado de antes; zerou = voltou ao normal (sem aviso); avisou = trocou para um dos três. */
  acao: 'nada' | 'zerou' | 'avisou' | 'sem_registro';
  estado: IdEstadoRobo | null;
  whatsapp?: boolean;
  email?: boolean;
}

/**
 * Chamar a cada batida lida pelo cron, por canal. Só o Instagram tem esses estados.
 * Avisa na TROCA de estado, uma vez. Se não conseguir gravar o último estado avisado,
 * NÃO avisa (sem registro, o aviso repetiria a cada rodada).
 */
export async function avisarTrocaDeEstado(
  canal: string, nome: string, fazendo: unknown, deps: DepsAvisoEstado,
): Promise<ResultadoAvisoEstado> {
  const atual = estadoDoRobo(fazendo);
  const chave = `prospeccao_estado_avisado:${canal}`;

  const { data, error: erroLeitura } = await deps.supabase.from('system_state').select('value').eq('key', chave).maybeSingle();
  if (erroLeitura) { logger.error('cron', 'prospeccao: ler o último estado avisado falhou', erroLeitura); return { acao: 'sem_registro', estado: atual?.id ?? null }; }
  const ultimo: IdEstadoRobo | null = (data?.value?.estado as IdEstadoRobo | undefined) ?? null;
  if ((atual?.id ?? null) === ultimo) return { acao: 'nada', estado: atual?.id ?? null };

  // Registra ANTES de avisar: se duas rodadas se cruzarem, só uma avisa de novo no pior caso, e falha de envio não repete a cada 15 min.
  const { error: erroGravar } = await deps.supabase.from('system_state').upsert(
    { key: chave, value: { estado: atual?.id ?? null, em: new Date().toISOString() }, updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  );
  if (erroGravar) { logger.error('cron', 'prospeccao: gravar o último estado avisado falhou', erroGravar); return { acao: 'sem_registro', estado: atual?.id ?? null }; }
  if (!atual) return { acao: 'zerou', estado: null };

  const { linhas, assunto } = textoDoAviso(atual, nome);
  const r: ResultadoAvisoEstado = { acao: 'avisou', estado: atual.id, whatsapp: false };
  try {
    await deps.enviarWhatsApp(linhas.join('\n'));
    r.whatsapp = true;
    logger.warn('cron', 'avisei no WhatsApp a troca de estado da agente', { canal, estado: atual.id });
  } catch (err) {
    logger.error('cron', 'NAO consegui avisar no WhatsApp a troca de estado da agente', err);
  }
  if (atual.id === 'parado') {
    r.email = false;
    try {
      await deps.enviarEmail(assunto, linhas.map(l => `<p>${escapaHtml(l)}</p>`).join(''));
      r.email = true;
    } catch (err) {
      logger.error('cron', 'NAO consegui avisar por e-mail que a agente esta parada', err);
    }
  }
  return r;
}
