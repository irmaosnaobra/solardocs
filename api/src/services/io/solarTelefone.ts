// ─────────────────────────────────────────────────────────────────────────────
// De quem é este telefone no solar, e se ele já tem horário marcado (27/10/2026).
// Morava dentro de routes/ioSolar.ts; saiu para cá porque o tick `solar_quiz_avisos` (solarQuizAviso.ts) também precisa da
// pergunta (um service não importa a rota). A rota continua usando as mesmas funções, com o mesmo comportamento.
//
// Novidade: o card `SAIU SEM MARCAR` (criado pelo tick para quem saiu sem marcar) NÃO é "horário que o cliente escolheu".
// Ele não conta como `jaMarcado`: sai separado em `saiuSemMarcar`, para o /quiz/agendar e o /quiz/agora MOVEREM esse card
// em vez de devolver 409.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { SOCIOS_VISITA, DONAS_LIGACAO, ehCardSaiu } from '../agenda/solarRota';

export const soDigitosSolar = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

/** DDD + 8 últimos. A MESMA chave do CRM, tolera o 9 e o 55. */
export function telKeySolar(raw: unknown): string | null {
  const d = soDigitosSolar(raw).replace(/^55/, '');
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}

const DONOS_QUIZ = [...SOCIOS_VISITA, ...DONAS_LIGACAO] as string[];

export interface DonoDoTelefone {
  dono: string | null;
  jaMarcado: { quando: string; dono: string } | null;
  /** O id do card do `jaMarcado` (não vai para a resposta da rota: o tick usa para ligar o lead ao card que já existe). */
  jaMarcadoId: number | null;
  agoraRecente: { id: number; quando: string } | null;
  /** O card de quem saiu sem marcar, ainda no futuro e 'agendado': o cliente voltou e o card dele é movido. */
  saiuSemMarcar: { id: number; quando: string; observacao: string } | null;
}

/** De quem é este telefone, e se ele já tem horário de solar marcado. */
export async function donoDoTelefone(alvo: string): Promise<DonoDoTelefone> {
  const { data, error } = await supabaseGerador.from('agendamentos')
    .select('id, vendedor_nome, cliente_telefone, quando, status, created_by, created_at, observacao')
    .neq('status', 'cancelado')
    .ilike('cliente_telefone', `%${alvo.slice(-8)}`)
    .order('quando', { ascending: false }).limit(20);
  if (error) throw error;
  const meus = ((data || []) as Array<Record<string, unknown>>).filter(a => telKeySolar(a.cliente_telefone) === alvo);
  const nome = meus.map(a => String(a.vendedor_nome || '')).find(Boolean) || null;
  const agora = Date.now();
  // "Já marcado" é só horário que o CLIENTE escolheu (fichas desta LP). O card do formulário do Meta também nasce com
  // horário, mas a pessoa nunca soube dele (as boas-vindas não falam de horário): dizer "você já tem horário" a quem veio
  // pelos dois canais, que é o lead mais quente, seria barrar ele com uma confirmação que ele nunca recebeu. O dono continua
  // valendo pelo `nome`. O card SAIU SEM MARCAR também não é horário escolhido pelo cliente: vai em `saiuSemMarcar`.
  const futuros = meus.filter(a => a.status === 'agendado' && a.created_by === 'lp_solar'
    && new Date(String(a.quando)).getTime() > agora);
  const futuro = futuros.find(a => !ehCardSaiu(a.observacao));
  const saiu = futuros.find(a => ehCardSaiu(a.observacao));
  return {
    // Dono que não atende solar (nome fora da lista) não amarra o lead: cai na regra normal. É o furo do eletroposto, onde
    // esse cliente via horário livre e levava "não consegui agendar" no clique.
    dono: nome && DONOS_QUIZ.includes(nome) ? nome : null,
    jaMarcado: futuro ? { quando: String(futuro.quando), dono: String(futuro.vendedor_nome || '') } : null,
    jaMarcadoId: futuro ? Number(futuro.id) : null,
    // O clique "agora" repetido (duplo toque, página reaberta): o card de poucos minutos atrás vale, não nasce outro.
    agoraRecente: futuro && /^LP SOLAR QUIZ · AGORA/i.test(String(futuro.observacao || ''))
      && Date.now() - new Date(String(futuro.created_at)).getTime() < 30 * 60_000
      ? { id: Number(futuro.id), quando: String(futuro.quando) } : null,
    saiuSemMarcar: saiu ? { id: Number(saiu.id), quando: String(saiu.quando), observacao: String(saiu.observacao ?? '') } : null,
  };
}
