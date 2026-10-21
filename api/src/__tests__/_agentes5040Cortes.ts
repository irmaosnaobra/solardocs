// Ajuda dos testes dos cortes nos robôs antigos (Fase B1b). Não é arquivo de teste.
// Semeia o que os interruptores e a posse leem, com o banco falso de _bancoFalso.

import { banco } from './_bancoFalso';
import { CHAVE_VIVO_ALVO } from '../services/agentes5040/interruptores';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import { chaveContato } from '../services/agents/whatsapp/silenciar';

export type Dona = 'duda' | 'helena' | 'carla';

/** Liga ou desliga os interruptores por env (nenhuma leitura do banco para isso). */
export function interruptores(v: Partial<Record<Dona, boolean>>): void {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  for (const d of ['duda', 'helena', 'carla'] as const) {
    const nome = `AGENTES5040_${d.toUpperCase()}_VIVO`;
    if (v[d] === undefined) delete process.env[nome]; else process.env[nome] = v[d] ? '1' : '0';
  }
}

/** Grava o alvo da rodada viva: telefones de teste (só o HMAC vai para a chave) e modos. */
export function semearAlvo(telefones: string[], modos: Partial<Record<Dona, 'teste' | 'todos'>> = {}): void {
  banco.poe('system_state', {
    key: CHAVE_VIVO_ALVO,
    value: { kid: idChaveHmac(), hmacs: telefones.map(t => hmacDe(chaveContato(t)!)), modos, atualizado_em: '2026-10-21T10:00:00Z' },
    updated_at: '2026-10-21T10:00:00Z',
  });
}

/** Grava a posse da agente nova sobre a conversa (tipo ag5040, phone = chave de 10 dígitos). */
export function semearPosse(telefone: string, dona: Dona | 'humano' = 'duda', estado = 'viva'): void {
  banco.poe('whatsapp_sessions', {
    phone: chaveContato(telefone), tipo: 'ag5040',
    lead_data: { dona, estado, desde: '2026-10-21T10:00:00Z', ate_wa_id: 1, respostas: 1, imagens: [], links: [] },
  });
}

export { clienteComLte } from './_clienteComLte';
