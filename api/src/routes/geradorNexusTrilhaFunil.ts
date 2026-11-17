// Trilha do Parceiro NEXUS: o FUNIL da equipe (exigeEquipeNexus). Montado por mountNexusTrilhaEquipe.
//
//   GET /nexus/equipe/trilha-funil
//     { ligada, etapas: [{ codigo, titulo, n }], fecharam, recusaram: [{ user_id, nome, email, empresa, em }],
//       em_andamento: [{ user_id, empresa, nome, nivel, respondidas, total_perguntas, ultimo_movimento_em }] }
//
// As etapas são contagens no banco (count head; `comecaram` = enviaram + os em andamento com resposta): nunca carrega a lista de usuários. `fecharam` = usuários que fecharam o convite
// (distintos). `recusaram` = quem disse "não quero" e NÃO enviou o Raio-X depois. `em_andamento` = começou o Raio-X e não enviou,
// o parado há mais tempo primeiro (no máximo 200). Só leitura.

import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { exigeEquipeNexus } from '../services/nexus/equipeAuth';
import { Linha } from '../services/nexus/repositorio';
import { CHAVES_RAIO_X } from '../services/nexus/trilhaRaioX';
import { TIPO_FECHOU, TIPO_RECUSOU } from '../services/nexus/trilhaConvite';
import { trilhaLigada } from '../services/nexus/trilhaRepo';
import { exigePortalLigado, lerTudo, lotes, ok, rota } from './geradorNexusBase';

const LIMITE_LISTAS = 200;

type Contagem = PromiseLike<{ count: number | null; error: unknown }>;
const n = async (q: Contagem, contexto: string): Promise<number> => ok(await q, contexto).count ?? 0;
const cabeca = (tabela: string) => supabase.from(tabela).select('*', { count: 'exact', head: true });

/** Quantas das perguntas do Raio-X têm alguma resposta. */
export function respondidasDe(raioX: unknown): number {
  const r = raioX && typeof raioX === 'object' && !Array.isArray(raioX) ? (raioX as Record<string, unknown>) : {};
  return CHAVES_RAIO_X.filter((k) => {
    const v = r[k];
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;
}

const ms = (v: unknown): number => Date.parse(String(v ?? '')) || 0;

/** nome (users), e-mail (users) e empresa (parceiro, senão a empresa cadastrada) de um grupo de usuários, em lotes. */
async function identidades(ids: string[]): Promise<Map<string, { nome: string | null; email: string | null; empresa: string | null }>> {
  const mapa = new Map<string, { nome: string | null; email: string | null; empresa: string | null }>();
  for (const id of ids) mapa.set(id, { nome: null, email: null, empresa: null });
  for (const lote of lotes(ids, 150)) {
    const [us, ps, cs] = await Promise.all([
      supabase.from('users').select('id, nome, email').in('id', lote),
      supabase.from('nexus_parceiros').select('user_id, empresa').in('user_id', lote),
      supabase.from('company').select('user_id, nome_fantasia, nome').in('user_id', lote),
    ]);
    for (const u of (ok(us, 'usuários do funil').data as Linha[] | null) ?? []) { const m = mapa.get(String(u.id)); if (m) { m.nome = u.nome ?? null; m.email = u.email ?? null; } }
    for (const c of (ok(cs, 'empresas do funil').data as Linha[] | null) ?? []) { const m = mapa.get(String(c.user_id)); if (m) m.empresa = c.nome_fantasia ?? c.nome ?? null; }
    for (const p of (ok(ps, 'parceiros do funil').data as Linha[] | null) ?? []) { const m = mapa.get(String(p.user_id)); if (m && p.empresa) m.empresa = p.empresa; }
  }
  return mapa;
}

export function mountNexusTrilhaFunil(router: Router): void {
  router.get('/nexus/equipe/trilha-funil', exigeEquipeNexus, exigePortalLigado, rota('GET /nexus/equipe/trilha-funil', async (_req, res) => {
    if (!(await trilhaLigada())) { res.json({ ligada: false }); return; }

    const [usuarios, abriram, enviaram, passaram, pediram, diagnosticados, preparados, emCampo, clientes, regionais, trilhas, eventos] = await Promise.all([
      n(cabeca('users'), 'contas do funil'),
      n(cabeca('nexus_trilha'), 'trilhas abertas'),
      n(cabeca('nexus_trilha').not('raio_x_enviado_em', 'is', null), 'Raio-X enviado'),
      n(cabeca('nexus_trilha').not('p1_em', 'is', null), 'nível 1'),
      n(cabeca('nexus_trilha').not('diag_pedido_em', 'is', null), 'reunião pedida'),
      n(cabeca('nexus_trilha').not('p2_em', 'is', null), 'nível 2'),
      n(cabeca('nexus_trilha').not('p3_em', 'is', null), 'nível 3'),
      n(cabeca('nexus_trilha').not('p4_em', 'is', null), 'nível 4'),
      n(cabeca('nexus_parceiros').gte('carregadores_comprados', 1), 'nível 5'),
      n(cabeca('nexus_trilha').not('regional_em', 'is', null), 'nível 6'),
      // Só quem começou o Raio-X e ainda não enviou: poucas linhas.
      lerTudo('trilhas em andamento', (de, ate) =>
        supabase.from('nexus_trilha').select('user_id, raio_x, ultimo_movimento_em, created_at, raio_x_enviado_em').not('raio_x_nota', 'is', null).is('raio_x_enviado_em', null).is('p1_em', null).order('user_id', { ascending: true }).range(de, ate)),
      lerTudo('convites do funil', (de, ate) =>
        supabase.from('nexus_trilha_eventos').select('user_id, tipo, created_at').in('tipo', [TIPO_FECHOU, TIPO_RECUSOU]).order('created_at', { ascending: true }).range(de, ate)),
    ]);

    // Em andamento: começou (alguma resposta) e não enviou; o parado há mais tempo primeiro.
    const comResposta = trilhas
      .map((t) => ({ t, respondidas: respondidasDe(t.raio_x), parado: ms(t.ultimo_movimento_em) || ms(t.created_at) }))
      .filter((x) => x.respondidas > 0);
    const comecaram = enviaram + comResposta.length; // quem enviou começou, e quem começou e não enviou está na lista

    const etapas = [
      { codigo: 'usuarios', titulo: 'Contas no SolarDoc', n: usuarios },
      { codigo: 'abriram', titulo: 'Abriram a trilha', n: abriram },
      { codigo: 'comecaram', titulo: 'Começaram o Raio-X', n: comecaram },
      { codigo: 'enviaram', titulo: 'Enviaram o Raio-X', n: enviaram },
      { codigo: 'passaram', titulo: 'Passaram do Nível 1', n: passaram },
      { codigo: 'pediram_reuniao', titulo: 'Pediram a reunião', n: pediram },
      { codigo: 'diagnosticados', titulo: 'Diagnosticados (Nível 2)', n: diagnosticados },
      { codigo: 'preparados', titulo: 'Preparados (Nível 3)', n: preparados },
      { codigo: 'em_campo', titulo: 'Em campo (Nível 4)', n: emCampo },
      { codigo: 'clientes', titulo: 'Clientes NEXUS (Nível 5)', n: clientes },
      { codigo: 'regionais', titulo: 'Parceiros regionais (Nível 6)', n: regionais },
    ];

    const fecharam = new Set(eventos.filter((e) => e.tipo === TIPO_FECHOU).map((e) => String(e.user_id))).size;

    // Recusaram: a 1ª recusa de cada um; sai da lista quem enviou o Raio-X depois dela.
    const primeiraRecusa = new Map<string, string>();
    for (const e of eventos) if (e.tipo === TIPO_RECUSOU && !primeiraRecusa.has(String(e.user_id))) primeiraRecusa.set(String(e.user_id), String(e.created_at));
    const enviouDepois = new Set<string>();
    for (const lote of lotes([...primeiraRecusa.keys()], 150)) {
      const r = ok(await supabase.from('nexus_trilha').select('user_id, raio_x_enviado_em').in('user_id', lote).not('raio_x_enviado_em', 'is', null), 'Raio-X de quem recusou');
      for (const t of (r.data as Linha[] | null) ?? []) if (ms(t.raio_x_enviado_em) >= ms(primeiraRecusa.get(String(t.user_id)))) enviouDepois.add(String(t.user_id));
    }
    const recusaIds = [...primeiraRecusa.entries()].filter(([id]) => !enviouDepois.has(id)).sort((a, b) => ms(b[1]) - ms(a[1])).slice(0, LIMITE_LISTAS);

    const andamento = [...comResposta].sort((a, b) => a.parado - b.parado).slice(0, LIMITE_LISTAS);

    const quem = await identidades([...new Set([...recusaIds.map(([id]) => id), ...andamento.map((x) => String(x.t.user_id))])]);
    res.json({
      ligada: true,
      etapas,
      fecharam,
      recusaram: recusaIds.map(([id, em]) => ({ user_id: id, nome: quem.get(id)?.nome ?? null, email: quem.get(id)?.email ?? null, empresa: quem.get(id)?.empresa ?? null, em })),
      em_andamento: andamento.map(({ t, respondidas }) => ({
        user_id: t.user_id, empresa: quem.get(String(t.user_id))?.empresa ?? null, nome: quem.get(String(t.user_id))?.nome ?? null, nivel: 1,
        respondidas, total_perguntas: CHAVES_RAIO_X.length, ultimo_movimento_em: t.ultimo_movimento_em ?? t.created_at ?? null,
      })),
    });
  }));
}
