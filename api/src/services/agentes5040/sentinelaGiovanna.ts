// ─────────────────────────────────────────────────────────────────────────────
// RESUMO DIÁRIO DA GIOVANNA (consultora de solar). O dono quer acompanhar todo
// dia útil até ela pôr a fila em dia.
//
// Três contas, todas sobre os cards dela no banco do gerador (agendamentos,
// vendedor_nome = Giovanna):
//   1. Desfechos do dia = diferença entre a foto de hoje e a do último dia com
//      foto: quem estava "agendado" e deixou de estar. Primeiro dia sem foto
//      anterior: o resumo diz que não tem base.
//   2. Os parados: os cards "agendado" com ligação antes de 20/09/2026,
//      congelados UMA vez em giov_backlog24 (só ids). Faltam = quantos deles
//      ainda estão "agendado".
//   3. Sem desfecho no dia = ligação do último dia útil que segue "agendado".
//
// Em system_state vai só id de card e status: nome e telefone de cliente nunca.
// Com `seco`, nada é gravado (nem foto, nem congelamento, nem poda).
// ─────────────────────────────────────────────────────────────────────────────

import { diaBRT } from './relogio';
import { diferencaSnapshots, diaUtilAnterior, hojeEhDiaUtil, somaDias, type ResumoGiovanna } from './sentinela';

export const VENDEDORA = 'Giovanna';
/** Ligação antes deste dia (Brasília) e ainda agendada = parado. */
export const CORTE_PARADOS = '2026-09-20';
export const JANELA_FOTO_DIAS = 120;
const DIAS_GUARDANDO_FOTO = 10;

export interface Cartao { id: number; status: string; quando: string | null }

export interface DepsGiovanna {
  agora: Date;
  /** Cards da Giovanna com ligação desde `desdeIso` (paginado por quem implementa). */
  cartoes: (desdeIso: string) => Promise<Cartao[]>;
  /** Ids dos cards "agendado" da Giovanna com ligação antes do corte, sem limite de idade. */
  paradosAntesDoCorte: () => Promise<number[]>;
  /** Status atual de cada id. */
  statusDe: (ids: number[]) => Promise<Record<string, string>>;
  lerEstado: (chave: string) => Promise<any | null>;
  /** Grava (upsert) em system_state. */
  gravarEstado: (chave: string, valor: unknown) => Promise<void>;
  /** Insert que NÃO sobrescreve: false se a chave já existia. */
  inserirEstado: (chave: string, valor: unknown) => Promise<boolean>;
  /** Apaga as fotos com chave menor que esta (WHERE explícito). */
  podarFotos: (antesDaChave: string) => Promise<void>;
}

const status = (s: unknown): string => String(s ?? '').trim().toLowerCase();

export async function rodarGiovanna(deps: DepsGiovanna, opts: { seco?: boolean } = {}): Promise<ResumoGiovanna> {
  const seco = !!opts.seco;
  const hoje = diaBRT(deps.agora);
  const desde = new Date(deps.agora.getTime() - JANELA_FOTO_DIAS * 86_400_000).toISOString();

  const cartoes = await deps.cartoes(desde);
  const atual: Record<string, string> = {};
  for (const c of cartoes) atual[String(c.id)] = status(c.status);

  // A foto de comparação é a do DIA ÚTIL anterior (pula fim de semana e feriado). Foto de sábado
  // ou domingo nunca é gravada e, se existir, nunca é usada: o que mudou no fim de semana
  // aparece na segunda como desfecho de quem mexeu na fila, não como "ontem".
  const diaAnterior = diaUtilAnterior(hoje);
  const bruta = diaAnterior ? await deps.lerEstado(`giov_snap:${diaAnterior}`) : null;
  const anterior = bruta && typeof bruta === 'object' && !Array.isArray(bruta) ? (bruta as Record<string, string>) : null;
  const dif = diferencaSnapshots(anterior, atual);

  // A foto só é gravada em dia útil (e nunca no modo seco).
  if (!seco && hojeEhDiaUtil(deps.agora)) {
    await deps.gravarEstado(`giov_snap:${hoje}`, atual);
    await deps.podarFotos(`giov_snap:${somaDias(hoje, -DIAS_GUARDANDO_FOTO)}`).catch(() => {});
  }

  // Os parados: congelados uma vez. Insert, nunca upsert: a primeira lista vale para sempre.
  let congelado = await deps.lerEstado('giov_backlog24');
  let paradosNovos = false;
  if (!congelado || !Array.isArray(congelado.ids)) {
    const ids = await deps.paradosAntesDoCorte();
    congelado = { ids, total: ids.length, congelado_em: hoje };
    paradosNovos = true;
    if (!seco) {
      const gravou = await deps.inserirEstado('giov_backlog24', congelado);
      if (!gravou) { // outra rodada congelou antes: vale a dela
        const lida = await deps.lerEstado('giov_backlog24');
        if (lida && Array.isArray(lida.ids)) { congelado = lida; paradosNovos = false; }
      }
    }
  }
  const idsParados: number[] = (congelado.ids as unknown[]).map(Number).filter(Number.isFinite);
  let faltam = 0;
  if (idsParados.length) {
    const agora = await deps.statusDe(idsParados);
    faltam = idsParados.filter(id => status(agora[String(id)]) === 'agendado').length;
  }

  const ontem = diaUtilAnterior(hoje);
  const semDesfecho = cartoes.filter(c => status(c.status) === 'agendado' && !!c.quando && diaBRT(c.quando) === ontem).length;

  return {
    semBase: dif.semBase,
    desfechos: dif.desfechos,
    totalDesfechos: dif.total,
    paradosTotal: idsParados.length,
    paradosFaltam: faltam,
    semDesfecho,
    ...(paradosNovos ? { paradosNovos: true } : {}),
  };
}

// ── dependências reais (banco do gerador + banco principal) ──────────────────

const PAGINA = 1000;

export function depsGiovannaReais(
  gerador: { from: (t: string) => any },
  principal: { from: (t: string) => any },
  agora: Date = new Date(),
): DepsGiovanna {
  return {
    agora,
    cartoes: async desdeIso => {
      const todos: Cartao[] = [];
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await gerador.from('agendamentos').select('id, status, quando')
          .eq('vendedor_nome', VENDEDORA).gte('quando', desdeIso)
          .order('id', { ascending: true }).range(de, de + PAGINA - 1);
        if (error) throw new Error(`agendamentos: ${error.message}`);
        const lote = (data ?? []) as Cartao[];
        todos.push(...lote);
        if (lote.length < PAGINA) break;
      }
      return todos;
    },
    paradosAntesDoCorte: async () => {
      const ids: number[] = [];
      // 20/09 00:00 em Brasília = 03:00 UTC.
      const corte = `${CORTE_PARADOS}T03:00:00.000Z`;
      for (let de = 0; ; de += PAGINA) {
        const { data, error } = await gerador.from('agendamentos').select('id')
          .eq('vendedor_nome', VENDEDORA).eq('status', 'agendado').lt('quando', corte)
          .order('id', { ascending: true }).range(de, de + PAGINA - 1);
        if (error) throw new Error(`agendamentos: ${error.message}`);
        const lote = (data ?? []) as Array<{ id: number }>;
        ids.push(...lote.map(x => x.id));
        if (lote.length < PAGINA) break;
      }
      return ids;
    },
    statusDe: async ids => {
      const saida: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await gerador.from('agendamentos').select('id, status')
          .eq('vendedor_nome', VENDEDORA).in('id', ids.slice(i, i + 200));
        if (error) throw new Error(`agendamentos: ${error.message}`);
        for (const r of (data ?? []) as Array<{ id: number; status: string }>) saida[String(r.id)] = r.status;
      }
      return saida;
    },
    lerEstado: async chave => {
      const { data, error } = await principal.from('system_state').select('value').eq('key', chave).maybeSingle();
      if (error) throw new Error(error.message);
      return data?.value ?? null;
    },
    gravarEstado: async (chave, valor) => {
      const { error } = await principal.from('system_state')
        .upsert({ key: chave, value: valor, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    inserirEstado: async (chave, valor) => {
      const { error } = await principal.from('system_state').insert({ key: chave, value: valor, updated_at: new Date().toISOString() });
      if (!error) return true;
      if ((error as any).code === '23505') return false;
      throw new Error(error.message);
    },
    podarFotos: async antesDaChave => {
      await principal.from('system_state').delete().like('key', 'giov_snap:2%').lt('key', antesDaChave);
    },
  };
}
