import type { MsgConversa, SaidaAgente, AutorMsg, PecaSaida } from '../services/agentes5040/tipos';

let seq = 0;

/** Uma mensagem da conversa. `autor` define from_me e from_api como o webhook grava. */
export function msg(autor: AutorMsg, texto: string | null, extra: Partial<MsgConversa> = {}): MsgConversa {
  seq += 1;
  return {
    id: seq,
    from_me: autor !== 'lead',
    from_api: autor === 'robo' ? true : autor === 'equipe' ? false : null,
    autor, texto, tipo: 'texto', media_url: null,
    momment: new Date(Date.UTC(2026, 9, 20, 15, seq % 60, 0)).toISOString(),
    ...extra,
  };
}

/** Conversa mínima válida: o lead falou por último. */
export const conversaDoLead = (): MsgConversa[] => [msg('lead', 'Oi, quero saber mais')];

export function saida(bolhas: string[], extra: Partial<SaidaAgente> = {}): SaidaAgente {
  return { bolhas, acao: 'continuar', peca: null, dados: {}, resumo: '', sabe_contexto: true, ...extra };
}

export const peca = (tipo: PecaSaida['tipo'], id = 'x'): PecaSaida => ({ tipo, id });
