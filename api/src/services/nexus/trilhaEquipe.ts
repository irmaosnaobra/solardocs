// A visão da EQUIPE sobre a trilha: a lista de parceiros com patamar, nota e pendência, os filtros e o Mapa de demanda.
// Tudo função PURA: a rota traz as linhas (parceiros, trilhas, assinantes) e estas funções só montam e contam.

import type { Linha } from './repositorio';
import { LinhaTrilha, PENDENCIAS, contatoDoDiagnostico, paradoHaDias, patamarEmCurso, pendenciaDaEquipe, trilhaVazia } from './trilha';
import { OPCOES } from './trilhaRaioX';

const tamanho = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const respostasDe = (t: LinhaTrilha): Record<string, unknown> => (t.raio_x && typeof t.raio_x === 'object' ? t.raio_x : {});

export function linhaDaLista(p: Linha, t: LinhaTrilha | null, assinante: boolean, agora: Date = new Date()) {
  const tt = t ?? trilhaVazia(String(p.user_id));
  const rx = respostasDe(tt);
  return {
    user_id: p.user_id,
    empresa: p.empresa ?? null,
    cidade: p.cidade ?? null,
    uf: p.uf ?? null,
    patamar: patamarEmCurso(tt, Number(p.carregadores_comprados) || 0),
    nota: tt.raio_x_nota ?? null,
    assinante,
    parado_ha_dias: paradoHaDias(tt, agora),
    pendencia_equipe: pendenciaDaEquipe(tt, agora),
    responsavel_email: tt.responsavel_email ?? null,
    contato: contatoDoDiagnostico(tt),
    pedido_em: tt.diag_pedido_em ?? null,
    demanda_12m: Number(rx.demanda_12m) || 0,
    clientes_em_vista: tamanho(rx.clientes_em_vista),
  };
}

export type LinhaLista = ReturnType<typeof linhaDaLista>;

export function filtrarLista(linhas: LinhaLista[], f: { patamar?: string; fila?: string; q?: string }): LinhaLista[] {
  const patamar = Number(f.patamar);
  const q = String(f.q ?? '').trim().toLowerCase();
  return linhas.filter((l) => {
    if (Number.isInteger(patamar) && patamar >= 1 && patamar <= 7 && l.patamar !== patamar) return false;
    if (f.fila && l.pendencia_equipe !== f.fila) return false;
    if (q && !`${l.empresa ?? ''} ${l.cidade ?? ''} ${l.uf ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Contagem por patamar (1..7) e por fila (as 4 pendências da equipe), sempre sobre a lista inteira. */
export function resumoDaLista(linhas: LinhaLista[]) {
  const por_patamar: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  const por_fila: Record<string, number> = Object.fromEntries(PENDENCIAS.map((k) => [k, 0]));
  for (const l of linhas) {
    por_patamar[l.patamar] = (por_patamar[l.patamar] ?? 0) + 1;
    if (l.pendencia_equipe) por_fila[l.pendencia_equipe] = (por_fila[l.pendencia_equipe] ?? 0) + 1;
  }
  return { total: linhas.length, por_patamar, por_fila };
}

const contagem = (chaves: readonly string[]): Record<string, number> => Object.fromEntries(chaves.map((k) => [k, 0]));

/**
 * Mapa de demanda: onde estão os parceiros e o que eles enxergam de mercado. `por_tipo_local` e `fases` contam os CLIENTES EM VISTA;
 * `quando` e `dificuldades` contam parceiros (dificuldades: cada marca conta uma vez). Parceiro sem Raio-X conta só em patamar e UF.
 */
export function mapaDeDemanda(itens: Array<{ p: Linha; t: LinhaTrilha | null }>) {
  const por_patamar: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  const por_tipo_local = contagem(OPCOES.tipo_local);
  const fases = contagem(OPCOES.fase);
  const quando = contagem(OPCOES.quando);
  const dificuldades = contagem(OPCOES.dificuldades);
  const ufs = new Map<string, { uf: string; parceiros: number; demanda_12m: number; clientes_em_vista: number }>();

  for (const { p, t } of itens) {
    const tt = t ?? trilhaVazia(String(p.user_id));
    const rx = respostasDe(tt);
    const patamar = patamarEmCurso(tt, Number(p.carregadores_comprados) || 0);
    por_patamar[patamar] = (por_patamar[patamar] ?? 0) + 1;

    const uf = String(p.uf ?? '').trim().toUpperCase() || 'SEM_UF';
    const linha = ufs.get(uf) ?? { uf, parceiros: 0, demanda_12m: 0, clientes_em_vista: 0 };
    const clientes = Array.isArray(rx.clientes_em_vista) ? (rx.clientes_em_vista as Array<Record<string, unknown>>) : [];
    linha.parceiros += 1;
    linha.demanda_12m += Number(rx.demanda_12m) || 0;
    linha.clientes_em_vista += clientes.length;
    ufs.set(uf, linha);

    for (const c of clientes) {
      if (String(c.tipo_local) in por_tipo_local) por_tipo_local[String(c.tipo_local)]! += 1;
      if (String(c.fase) in fases) fases[String(c.fase)]! += 1;
    }
    if (typeof rx.quando === 'string' && rx.quando in quando) quando[rx.quando]! += 1;
    if (Array.isArray(rx.dificuldades)) for (const d of rx.dificuldades) if (String(d) in dificuldades) dificuldades[String(d)]! += 1;
  }
  const por_uf = [...ufs.values()].sort((a, b) => b.demanda_12m - a.demanda_12m || b.parceiros - a.parceiros || a.uf.localeCompare(b.uf));
  return { ligada: true, total: itens.length, por_patamar, por_uf, por_tipo_local, quando, dificuldades, fases };
}

/** O que a ficha mostra da linha do parceiro (sem utm e sem o vínculo com o lead do Gerador). */
export function parceiroParaFicha(p: Linha): Linha {
  const campos = [
    'user_id', 'empresa', 'cnpj', 'cnpj_situacao', 'cidade', 'uf', 'raio_km', 'papel_revenda', 'papel_montagem', 'cap_eletrica_bt', 'cap_eletrica_mt',
    'cap_engenharia_art', 'cap_obra_civil', 'cap_homologacao', 'equipe_tamanho', 'origem', 'status', 'carregadores_comprados', 'partner_em',
    'montagem_aprovada_em', 'termo_versao', 'termo_aceito_em', 'notas_equipe', 'created_at',
  ];
  return Object.fromEntries(campos.map((k) => [k, p[k] ?? null]));
}
