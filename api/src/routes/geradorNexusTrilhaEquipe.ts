// Trilha do Parceiro NEXUS, Onda 1: rotas da EQUIPE (exigeEquipeNexus). Montadas por mountNexusTrilhaEquipe(router).
//
//   GET   /nexus/equipe/trilha?patamar=&fila=&q=   lista de parceiros + resumo { total, por_patamar, por_fila }
//   GET   /nexus/equipe/trilha/:userId             ficha completa: a visão do parceiro com e-mails da equipe + dados do parceiro
//   PATCH /nexus/equipe/trilha/:userId             { acao, ... }: agendar_diagnostico, diagnostico_feito, mentoria_paga, mentoria_encontro,
//                                                  agendar_reuniao, reuniao_feita, promover_regional, avancar {motivo}, responsavel, obs
//   GET   /nexus/equipe/trilha-mapa                Mapa de demanda
//   GET   /nexus/equipe/trilha-funil               Funil da trilha (geradorNexusTrilhaFunil.ts)
//
// Trilha desligada: GET devolve { ligada:false } e o PATCH responde 503 `trilha_desligada`. O e-mail de quem agiu vai só
// para o histórico (autor); nada daqui é exposto às rotas do parceiro.

import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { exigeEquipeNexus } from '../services/nexus/equipeAuth';
import { contaPaga } from '../services/solardoc/linkDeSenha';
import { Linha, lerCompany, lerParceiro, termoAceitoNaVersao } from '../services/nexus/repositorio';
import { trilhaVazia } from '../services/nexus/trilha';
import { validarAcaoEquipe } from '../services/nexus/trilhaEntradas';
import { planejarAcao } from '../services/nexus/trilhaAcoes';
import { filtrarLista, linhaDaLista, mapaDeDemanda, parceiroParaFicha, resumoDaLista } from '../services/nexus/trilhaEquipe';
import { type Decisao, assinanteDe, atualizarTrilha, lerTrilha, trilhaLigada } from '../services/nexus/trilhaRepo';
import { montarVisao } from '../services/nexus/trilhaVisao';
import { mountNexusTrilhaFunil } from './geradorNexusTrilhaFunil';
import { UUID, exigePortalLigado, lerTudo, lotes, ok, rota } from './geradorNexusBase';

/** Todos os parceiros, as linhas da trilha de cada um e quem tem plano pago ativo (consultas em lote). */
async function carregarTudo() {
  const parceiros = await lerTudo('parceiros da trilha', (de, ate) =>
    supabase.from('nexus_parceiros').select('user_id, empresa, cidade, uf, carregadores_comprados, created_at').order('created_at', { ascending: false }).range(de, ate));
  const trilhas = new Map<string, Linha>();
  for (const t of await lerTudo('linhas da trilha', (de, ate) => supabase.from('nexus_trilha').select('*').order('user_id', { ascending: true }).range(de, ate))) {
    trilhas.set(String(t.user_id), t);
  }
  const assinantes = new Set<string>();
  for (const lote of lotes(parceiros.map((p) => String(p.user_id)), 150)) {
    const r = ok(await supabase.from('users').select('id, plano, billing_status, plano_expira_em').in('id', lote), 'planos dos parceiros');
    for (const u of (r.data as Linha[] | null) ?? []) if (contaPaga(u)) assinantes.add(String(u.id));
  }
  return { parceiros, trilhas, assinantes };
}

export function mountNexusTrilhaEquipe(router: Router): void {
  const equipe = [exigeEquipeNexus, exigePortalLigado];

  router.get('/nexus/equipe/trilha', ...equipe, rota('GET /nexus/equipe/trilha', async (req, res) => {
    if (!(await trilhaLigada())) { res.json({ ligada: false }); return; }
    const { parceiros, trilhas, assinantes } = await carregarTudo();
    const agora = new Date();
    const todas = parceiros.map((p) => linhaDaLista(p, trilhas.get(String(p.user_id)) ?? null, assinantes.has(String(p.user_id)), agora));
    const q = req.query as Record<string, unknown>;
    const filtro = { patamar: typeof q.patamar === 'string' ? q.patamar : undefined, fila: typeof q.fila === 'string' ? q.fila : undefined, q: typeof q.q === 'string' ? q.q : undefined };
    res.json({ ligada: true, parceiros: filtrarLista(todas, filtro), resumo: resumoDaLista(todas) });
  }));

  mountNexusTrilhaFunil(router);

  router.get('/nexus/equipe/trilha-mapa', ...equipe, rota('GET /nexus/equipe/trilha-mapa', async (_req, res) => {
    if (!(await trilhaLigada())) { res.json({ ligada: false }); return; }
    const { parceiros, trilhas } = await carregarTudo();
    res.json(mapaDeDemanda(parceiros.map((p) => ({ p, t: trilhas.get(String(p.user_id)) ?? null }))));
  }));

  router.get('/nexus/equipe/trilha/:userId', ...equipe, rota('GET /nexus/equipe/trilha/:userId', async (req, res) => {
    const userId = String(req.params.userId);
    if (!UUID.test(userId)) { res.status(400).json({ erro: 'id_invalido' }); return; }
    if (!(await trilhaLigada())) { res.json({ ligada: false }); return; }
    const parceiro = await lerParceiro(userId);
    if (!parceiro) { res.status(404).json({ erro: 'parceiro_nao_encontrado' }); return; }
    const t = (await lerTrilha(userId)) ?? trilhaVazia(userId); // a equipe lê sem criar a linha
    res.json(await ficha(parceiro, t));
  }));

  router.patch('/nexus/equipe/trilha/:userId', ...equipe, rota('PATCH /nexus/equipe/trilha/:userId', async (req, res) => {
    const userId = String(req.params.userId);
    if (!UUID.test(userId)) { res.status(400).json({ erro: 'id_invalido' }); return; }
    const v = validarAcaoEquipe(req.body);
    if (!v.ok) { res.status(400).json({ erro: v.erro, campo: v.campo }); return; }
    if (!(await trilhaLigada())) { res.status(503).json({ erro: 'trilha_desligada' }); return; }
    const parceiro = await lerParceiro(userId);
    if (!parceiro) { res.status(404).json({ erro: 'parceiro_nao_encontrado' }); return; }
    const comprados = Number(parceiro.carregadores_comprados) || 0;
    const termo = termoAceitoNaVersao(parceiro);
    const autor = req.equipe!.email;
    // O plano sai do estado ATUAL da linha (relido se outra gravação passou na frente): ver atualizarTrilha.
    const { t: nova, decisao } = await atualizarTrilha(parceiro, (t): Decisao => {
      const plano = planejarAcao(v.valor, { t, comprados, termo_aceito: termo, agora: new Date().toISOString(), autor });
      return plano.ok ? { tipo: 'gravar', patch: plano.patch, eventos: plano.eventos } : { tipo: 'recusar', status: 409, corpo: { erro: plano.erro } };
    });
    if (decisao.tipo === 'recusar') { res.status(decisao.status).json(decisao.corpo); return; }
    res.json(await ficha(parceiro, nova));
  }));
}

async function ficha(parceiro: Linha, t: Linha): Promise<Record<string, unknown>> {
  const userId = String(parceiro.user_id);
  const company = await lerCompany(userId);
  const assinante = await assinanteDe(userId);
  return { ...(await montarVisao({ parceiro, company, t, assinante, paraEquipe: true })), parceiro: parceiroParaFicha(parceiro) };
}
