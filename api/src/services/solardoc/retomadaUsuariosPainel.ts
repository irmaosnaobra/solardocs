// ─────────────────────────────────────────────────────────────────────────────
// O PAINEL DA RETOMADA DOS USUÁRIOS (03/11/2026). SÓ LEITURA: alimenta a Central das Agentes e as rotas do painel (o dono acompanha).
//
// Campo que não deu para ler vai como `null`: a tela escreve o sinal de "sem número" (o `num()` do index.html), nunca um zero inventado.
// Não importa o vivoEnvio nem o cota.ts (a Central não arrasta o cliente de IA): as leituras da linha e da IA moram em
// retomadaUsuariosEstado.ts. Só contam carimbos `usu_rec_sent:` com `estado` conhecido e `user_id`; a chave da sonda 1 fica de fora.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../../utils/supabase';
import { carimbosDaLinhaNaHora, dentroDaJanelaDaBaseLinha, vagasDoFrioLinha } from '../agents/whatsapp/lineThrottle';
import { diaBRT } from '../agentes5040/relogio';
import { ORIGEM_RETOMADA_USUARIOS } from '../agentes5040/posse';
import {
  CHAVE_RESUMO_RET, PREFIXO_CARIMBO_RET, TETO_CAMPANHA_24H, carimboReconhecido, inicioEfetivoMs, limiteCedeAAgenda, paradaDoMotivo,
  pisoDoCodigoMs, textosVazios, type ParadaRet,
} from './retomadaUsuariosRegras';
import {
  estadoRetomadaUsuarios, lerCarlaAtendeTodosDetalhe, lerIaParada, lerLargadaRet, lerLinhaPausada, lerPausaRetomada,
  type EstadoRetomada, type PausaRetomada,
} from './retomadaUsuariosEstado';

const HORA = 3_600_000;
const DIA = 24 * HORA;
const PAGINA = 1000;
const MAX_PAGINAS = 50;

export interface PainelRetomada {
  estado: EstadoRetomada | null;
  pausa: PausaRetomada | null;
  /** Enviadas no dia de Brasília (estado enviado ou incerto). */
  enviadas_hoje: number | null;
  enviadas_24h: number | null;
  enviadas_7d: number | null;
  enviadas_total: number | null;
  ultima: string | null;
  fila: number | null;
  fila_lida_em: string | null;
  /** Carimbos da linha inteira na última hora, de 0 a 5 (o 5 quer dizer 5 ou mais). null = não deu para ler. */
  linha_na_hora: number | null;
  linha_limite: number;
  responderam: number | null;
  pararam: number | null;
  voltaram_a_assinar: number | null;
  /** O início efetivo (D35) em ISO. null = falta o piso ou a data. */
  inicio: string | null;
  parada: ParadaRet | null;
}

async function lerTudo<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const { data, error } = await pagina(p * PAGINA, p * PAGINA + PAGINA - 1);
    if (error) throw new Error('leitura paginada falhou');
    const lote = (data ?? []) as T[];
    out.push(...lote);
    if (lote.length < PAGINA) return out;
  }
  throw new Error('leitura paginada passou do limite');
}

async function tenta<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f(); } catch { return null; }
}

interface Carimbo { estado: string; user_id: string; emMs: number }

/** Os carimbos da campanha que o painel reconhece, com o instante do envio (`em`, ou o `updated_at` quando falta). */
async function lerCarimbos(): Promise<Carimbo[]> {
  const linhas = await lerTudo<{ key: string; value: unknown; updated_at: string }>((de, ate) =>
    supabase.from('system_state').select('key, value, updated_at').like('key', `${PREFIXO_CARIMBO_RET}%`).order('key', { ascending: true }).range(de, ate));
  const out: Carimbo[] = [];
  for (const l of linhas) {
    if (!carimboReconhecido(l.value)) continue;
    const t = Date.parse(String((l.value as { em?: unknown }).em ?? l.updated_at));
    out.push({ estado: l.value.estado, user_id: l.value.user_id, emMs: Number.isFinite(t) ? t : 0 });
  }
  return out;
}

/** O teto de 25 em 24 h conta TODA chave `usu_rec_sent:` por `updated_at` (a da sonda 1 inclusive), como o robô. */
async function carimbosNas24h(agora: Date): Promise<number> {
  const { data, error } = await supabase.from('system_state').select('key').like('key', `${PREFIXO_CARIMBO_RET}%`)
    .gte('updated_at', new Date(agora.getTime() - DIA).toISOString()).limit(TETO_CAMPANHA_24H + 1);
  if (error) throw new Error('contar o teto da campanha');
  return data?.length ?? 0;
}

/**
 * Por que a campanha NÃO envia agora, só lendo (D26). Confere, nesta ordem: o texto do redator, a Carla atender todos, a IA, a linha
 * pausada, o início (D35), a janela, o teto de 25, o teto do frio da linha e a agenda usando a linha. null = nada a dizer. Leitura que
 * falha devolve `leitura_falhou` com bloqueio. O espaçamento NÃO entra: é a folga de 10 a 15 min entre envios, não é parada.
 * `pre` traz leituras já feitas pelo painel, para não repetir a consulta.
 */
export async function motivoDeParadaAgora(
  agora: Date, pre: { enviadas24h?: number | null; linhaNaHora?: number | null } = {},
): Promise<ParadaRet | null> {
  try {
    const dar = (motivo: string, inicioMs?: number): ParadaRet | null => paradaDoMotivo(motivo, { inicioMs });
    if (textosVazios()) return dar('sem_texto');
    const atende = await lerCarlaAtendeTodosDetalhe();
    if (atende === 'erro') return dar('leitura_falhou');
    if (atende === 'nao') return dar('carla_nao_atende_todos');
    if (await lerIaParada(agora)) return dar('ia_parada');
    const pausa = await lerLinhaPausada(agora);
    if (pausa === 'erro') return dar('leitura_falhou');
    if (pausa === 'sim') return dar('linha_pausada');
    // O início: a largada ausente vale "agora" (o robô ainda não fez a 1ª rodada), então o 1º dia de janela depois de hoje.
    const largada = (await lerLargadaRet()) ?? agora.getTime();
    const inicio = inicioEfetivoMs(largada, pisoDoCodigoMs());
    if (inicio === Infinity) return dar('sem_data_de_inicio');
    if (agora.getTime() < inicio) return dar('antes_do_inicio', inicio);
    if (!dentroDaJanelaDaBaseLinha(agora)) return dar('fora_da_janela');
    const n24 = pre.enviadas24h !== undefined && pre.enviadas24h !== null ? pre.enviadas24h : await carimbosNas24h(agora);
    if (n24 >= TETO_CAMPANHA_24H) return dar('teto_da_campanha');
    const vagas = await vagasDoFrioLinha(agora);
    if (vagas.hora.usadas >= vagas.hora.teto || vagas.dia.usadas >= vagas.dia.teto) return dar('teto_da_linha');
    const naHora = pre.linhaNaHora !== undefined && pre.linhaNaHora !== null ? pre.linhaNaHora : await carimbosDaLinhaNaHora(agora, 5);
    if (naHora >= limiteCedeAAgenda(process.env.EP_CONFIRMA_TETO_HORA)) return dar('cede_a_agenda');
    return null;
  } catch {
    return paradaDoMotivo('leitura_falhou');
  }
}

/** A conta do painel inteiro. Cada leitura falha sozinha: o que não deu para ler vai como null. */
export async function lerPainelRetomada(agora: Date): Promise<PainelRetomada> {
  const agoraMs = agora.getTime();
  const [estado, pausa, carimbos, resumo, naHora, posses] = await Promise.all([
    tenta(() => estadoRetomadaUsuarios({ agora: agoraMs })),
    tenta(() => lerPausaRetomada(agoraMs)),
    tenta(() => lerCarimbos()),
    tenta(async () => {
      const { data, error } = await supabase.from('system_state').select('value').eq('key', CHAVE_RESUMO_RET).maybeSingle();
      if (error) throw new Error('ler o resumo');
      return ((data as { value?: { em?: unknown; fila?: unknown } } | null)?.value ?? null);
    }),
    tenta(() => carimbosDaLinhaNaHora(agora, 5)),
    tenta(() => lerTudo<{ lead_data: { estado?: unknown; ate_wa_id?: unknown } | null }>((de, ate) =>
      supabase.from('whatsapp_sessions').select('lead_data').eq('tipo', 'ag5040').eq('lead_data->>origem', ORIGEM_RETOMADA_USUARIOS).order('phone', { ascending: true }).range(de, ate))),
  ]);

  // Enviadas: só o que foi (ou pode ter sido) enviado.
  const saiu = carimbos ? carimbos.filter(c => c.estado === 'enviado' || c.estado === 'incerto') : null;
  const hoje = diaBRT(agoraMs);
  const contar = (ms: number): number | null => (saiu ? saiu.filter(c => agoraMs - c.emMs <= ms).length : null);
  const ultimaMs = saiu && saiu.length ? Math.max(...saiu.map(c => c.emMs)) : null;

  // Voltaram a assinar: os user_id dos carimbos `enviado` cujo plano hoje não é free.
  let voltaram: number | null = null;
  if (carimbos) {
    voltaram = await tenta(async () => {
      const ids = [...new Set(carimbos.filter(c => c.estado === 'enviado').map(c => c.user_id))];
      let n = 0;
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await supabase.from('users').select('id, plano').in('id', ids.slice(i, i + 100));
        if (error) throw new Error('ler os planos');
        n += ((data ?? []) as Array<{ plano?: string | null }>).filter(u => u.plano !== 'free').length;
      }
      return n;
    });
  }

  const responderam = posses ? posses.filter(p => p.lead_data && (p.lead_data.ate_wa_id !== null && p.lead_data.ate_wa_id !== undefined || p.lead_data.estado !== 'viva')).length : null;
  const pararam = posses ? posses.filter(p => p.lead_data?.estado === 'nao_incomodar').length : null;

  const largada = await tenta(() => lerLargadaRet());
  const inicioMs = inicioEfetivoMs(largada ?? agoraMs, pisoDoCodigoMs());
  const filaEm = typeof resumo?.em === 'string' ? resumo.em : null;
  const n24 = contar(DIA);
  const parada = await motivoDeParadaAgora(agora, { enviadas24h: await tenta(() => carimbosNas24h(agora)), linhaNaHora: naHora });

  return {
    estado, pausa,
    enviadas_hoje: saiu ? saiu.filter(c => diaBRT(c.emMs) === hoje).length : null,
    enviadas_24h: n24,
    enviadas_7d: contar(7 * DIA),
    enviadas_total: saiu ? saiu.length : null,
    ultima: ultimaMs !== null && ultimaMs > 0 ? new Date(ultimaMs).toISOString() : null,
    fila: resumo && Number.isFinite(Number(resumo.fila)) ? Number(resumo.fila) : null,
    fila_lida_em: filaEm,
    linha_na_hora: naHora,
    linha_limite: limiteCedeAAgenda(process.env.EP_CONFIRMA_TETO_HORA),
    responderam, pararam, voltaram_a_assinar: voltaram,
    inicio: Number.isFinite(inicioMs) ? new Date(inicioMs).toISOString() : null,
    parada,
  };
}
