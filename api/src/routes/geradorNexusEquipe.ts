// Portal do Parceiro NEXUS: rotas da EQUIPE (exigeEquipeNexus: token do Gerador OU JWT do SolarDoc de admin/equipe). Montadas por mountNexusEquipe(router),
// chamado no fim do mountNexus. Alimentam o painel /gerador/parceiros.
//
//   GET   /nexus/equipe/parceiros              lista com nível, contagens e os totais do painel
//   PATCH /nexus/equipe/parceiros/:id          {partner?, montagem_aprovada?, status?, conversa_feita?, notas_equipe?}
//   GET   /nexus/equipe/propostas              ?desde=AAAA-MM-DD
//   GET   /nexus/equipe/pedidos                PATCH /nexus/equipe/pedidos/:id {status, valor_negociado?, obs_equipe?}
//   GET   /nexus/equipe/oportunidades          POST, PATCH /:id e GET /:id/sugestoes
//   GET   /nexus/equipe/usinas                 PATCH /nexus/equipe/usinas/:id {status, obs_equipe}
//   GET   /nexus/equipe/solicitacoes           PATCH /nexus/equipe/solicitacoes/:id {status, obs_equipe}
//
// v3: os pedidos têm tipo (equipamento, engenharia com pacote, consultoria); a lista de parceiros traz o saldo de
// engenharia, o aceite do Termo e o selo de montagem; as propostas trazem as aberturas do link; oferecer uma oportunidade
// manda e-mail ao parceiro e recusa 'obra' para quem não tem montagem aprovada (409 `sem_montagem_aprovada`).
// O convite por e-mail (só sócio) mora em geradorNexusConvite.ts.
//
// "Mês" = mês corrente em Brasília. Listas paginam de 1000 em 1000 (o PostgREST corta ali).

import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { exigeEquipeNexus } from '../services/nexus/equipeAuth';
import { calcularNivel } from '../services/nexus/niveis';
import { emailOportunidadeOferecida } from '../services/nexus/email';
import { inicioDiaBRT, inicioMesBRT } from '../services/nexus/tempo';
import { UFS } from '../services/nexus/procura';
import { ErroBanco, Linha, calcularSaldoEngenharia, ehPedidoDeEquipamento, entradaDoNivel, recalcularCarregadores, saldoEngenharia } from '../services/nexus/repositorio';
import { DIA_MS, UUID, exigePortalLigado, lerTudo, lotes, ok, rota, textoLivre } from './geradorNexusBase';
import { STATUS_APOS_ACEITE, tempoDeRespostaMs } from './geradorNexusRede';
import { chaveMunicipio, normalizarCidade } from '../services/io/cidadeParse';

const STATUS_PARCEIRO = ['novo', 'em_contato', 'parceiro_ativo', 'descartado'] as const;
const STATUS_PEDIDO = ['solicitado', 'negociando', 'confirmado', 'cancelado'] as const;
const STATUS_OPORTUNIDADE = ['rascunho', 'oferecida', 'aceita', 'recusada', 'expirada', 'contato', 'visita', 'orcamento', 'fechou', 'perdeu'] as const;
/** Status em que a equipe pode trocar o parceiro da oportunidade. */
const PODE_TROCAR_PARCEIRO: readonly string[] = ['rascunho', 'recusada', 'expirada'];
const ABERTAS_OPORTUNIDADE = ['oferecida', 'aceita', 'contato', 'visita', 'orcamento'];
const STATUS_USINA = ['recebida', 'em_analise', 'contrato', 'descartada'] as const;
const STATUS_SOLICITACAO = ['aberta', 'em_andamento', 'concluida', 'cancelada'] as const;

const noConjunto = (xs: readonly string[], v: unknown): v is string => typeof v === 'string' && xs.includes(v);

/** user_id -> {empresa, cidade, uf} dos parceiros, para ligar pedidos, usinas e solicitações à empresa. */
async function mapaDeParceiros(): Promise<Map<string, Linha>> {
  const ps = await lerTudo('parceiros da equipe', (de, ate) =>
    supabase.from('nexus_parceiros').select('user_id, empresa, cidade, uf').order('created_at', { ascending: false }).range(de, ate));
  return new Map(ps.map((p) => [String(p.user_id), p]));
}

/** user_id -> whatsapp da empresa (company), só dos usuários pedidos. O logo (pesado) nunca vem junto. */
async function whatsappsDe(userIds: string[]): Promise<Map<string, string | null>> {
  const m = new Map<string, string | null>();
  for (const lote of lotes([...new Set(userIds)], 150)) {
    const r = ok(await supabase.from('company').select('user_id, whatsapp').in('user_id', lote), 'whatsapp das empresas');
    for (const c of (r.data as Linha[] | null) ?? []) if (!m.has(String(c.user_id))) m.set(String(c.user_id), c.whatsapp ?? null);
  }
  return m;
}

function comEmpresa(l: Linha, parceiros: Map<string, Linha>, zaps?: Map<string, string | null>): Linha {
  const p = parceiros.get(String(l.user_id));
  return {
    ...l,
    empresa: p?.empresa ?? null,
    cidade_parceiro: p?.cidade ?? null,
    uf_parceiro: p?.uf ?? null,
    ...(zaps ? { whatsapp_parceiro: zaps.get(String(l.user_id)) ?? null } : {}),
  };
}

function contatoValido(v: unknown): { nome: string | null; telefone: string | null } | null | 'invalido' {
  if (v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return 'invalido';
  const c = v as Record<string, unknown>;
  const nome = textoLivre(c.nome, 120);
  const telefone = String(c.telefone ?? '').replace(/\D/g, '').slice(0, 15) || null;
  return nome || telefone ? { nome, telefone } : null;
}

export function mountNexusEquipe(router: Router): void {
  const equipe = [exigeEquipeNexus, exigePortalLigado];

  // ── Parceiros ──────────────────────────────────────────────────────────────
  router.get('/nexus/equipe/parceiros', ...equipe, rota('GET /nexus/equipe/parceiros', async (_req, res) => {
    const parceiros = await lerTudo('lista de parceiros', (de, ate) =>
      supabase.from('nexus_parceiros').select('*').order('created_at', { ascending: false }).range(de, ate));
    const ids = parceiros.map((p) => String(p.user_id));

    // Whatsapp e "tem logo" em consultas separadas: o logo pesa até 600 KB por empresa e não pode vir na lista.
    const whatsapp = new Map<string, string | null>();
    const temLogo = new Set<string>();
    for (const lote of lotes(ids, 150)) {
      const a = ok(await supabase.from('company').select('user_id, whatsapp').in('user_id', lote), 'whatsapp das empresas');
      for (const c of (a.data as Linha[] | null) ?? []) if (!whatsapp.has(String(c.user_id))) whatsapp.set(String(c.user_id), c.whatsapp ?? null);
      const b = ok(await supabase.from('company').select('user_id').in('user_id', lote).not('logo_base64', 'is', null), 'logos das empresas');
      for (const c of (b.data as Linha[] | null) ?? []) temLogo.add(String(c.user_id));
    }

    const propostas = await lerTudo('propostas dos parceiros', (de, ate) =>
      supabase.from('nexus_propostas').select('user_id, quantidade, valor_total, created_at').order('created_at', { ascending: false }).range(de, ate));
    const pedidos = await lerTudo('pedidos dos parceiros', (de, ate) =>
      supabase.from('nexus_pedidos').select('user_id, tipo, pacote, quantidade, status, confirmado_em, created_at').order('created_at', { ascending: false }).range(de, ate));
    const engenharias = await lerTudo('solicitações de engenharia', (de, ate) =>
      supabase.from('nexus_solicitacoes').select('user_id, tipo, status, dados').eq('tipo', 'engenharia').neq('status', 'cancelada').order('created_at', { ascending: false }).range(de, ate));
    const propostasDe = new Map<string, Linha[]>();
    for (const pr of propostas) {
      const k = String(pr.user_id);
      const l = propostasDe.get(k);
      if (l) l.push(pr); else propostasDe.set(k, [pr]);
    }
    const pedidosDe = new Map<string, number>();
    const pedidosEngDe = new Map<string, Linha[]>();
    for (const pd of pedidos) {
      pedidosDe.set(String(pd.user_id), (pedidosDe.get(String(pd.user_id)) ?? 0) + 1);
      if (pd.tipo === 'engenharia') pedidosEngDe.set(String(pd.user_id), [...(pedidosEngDe.get(String(pd.user_id)) ?? []), pd]);
    }
    const solsEngDe = new Map<string, Linha[]>();
    for (const sl of engenharias) solsEngDe.set(String(sl.user_id), [...(solsEngDe.get(String(sl.user_id)) ?? []), sl]);

    const contar = async (tabela: string, filtro: (q: any) => any): Promise<number> => {
      const r = await filtro(supabase.from(tabela).select('id', { count: 'exact', head: true }));
      if (r.error) throw new ErroBanco(r.error, `contagem de ${tabela}`);
      return r.count ?? 0;
    };
    const [oportunidades_abertas, usinas_novas, solicitacoes_abertas] = await Promise.all([
      contar('nexus_oportunidades', (q) => q.in('status', ABERTAS_OPORTUNIDADE)),
      contar('nexus_usinas', (q) => q.eq('status', 'recebida')),
      contar('nexus_solicitacoes', (q) => q.eq('status', 'aberta')),
    ]);

    const agora = Date.now();
    const desde30 = new Date(agora - 30 * DIA_MS).toISOString();
    const mesIso = inicioMesBRT().toISOString();

    const lista = parceiros.map((p) => {
      const minhas = propostasDe.get(String(p.user_id)) ?? [];
      const { nivel, progresso } = calcularNivel(entradaDoNivel(p, { logo_base64: temLogo.has(String(p.user_id)) ? 'sim' : null }));
      return {
        ...p,
        empresa: p.empresa ?? null,
        cnpj: p.cnpj ?? null,
        whatsapp: whatsapp.get(String(p.user_id)) ?? null,
        tem_logo: temLogo.has(String(p.user_id)),
        nivel,
        progresso,
        propostas_total: minhas.length,
        propostas_30d: minhas.filter((x) => String(x.created_at) >= desde30).length,
        ultima_proposta_em: minhas[0]?.created_at ?? null,
        pedidos_total: pedidosDe.get(String(p.user_id)) ?? 0,
        saldo_engenharia: calcularSaldoEngenharia(pedidosEngDe.get(String(p.user_id)) ?? [], solsEngDe.get(String(p.user_id)) ?? []),
        termo_versao: p.termo_versao ?? null,
        termo_aceito_em: p.termo_aceito_em ?? null,
        montagem_aprovada_em: p.montagem_aprovada_em ?? null,
      };
    });

    const doMes = propostas.filter((x) => String(x.created_at) >= mesIso);
    const partners = parceiros.filter((p) => p.partner_em).length;
    const totais = {
      parceiros: parceiros.length,
      novos_30d: parceiros.filter((p) => String(p.created_at) >= desde30).length,
      partners,
      credenciados: partners, // nome da v1, mantido para o painel
      propostas_mes: doMes.length,
      carregadores_mes: doMes.reduce((s, x) => s + (Number(x.quantidade) || 0), 0),
      valor_mes: Math.round(doMes.reduce((s, x) => s + (Number(x.valor_total) || 0), 0) * 100) / 100,
      empresas_ativas_mes: new Set(doMes.map((x) => String(x.user_id))).size,
      pedidos_abertos: pedidos.filter((x) => x.status === 'solicitado' || x.status === 'negociando').length,
      carregadores_confirmados_mes: pedidos
        .filter((x) => ehPedidoDeEquipamento(x) && x.status === 'confirmado' && x.confirmado_em && String(x.confirmado_em) >= mesIso)
        .reduce((s, x) => s + (Number(x.quantidade) || 0), 0),
      oportunidades_abertas,
      usinas_novas,
      solicitacoes_abertas,
    };
    res.json({ parceiros: lista, totais });
  }));

  router.patch('/nexus/equipe/parceiros/:id', ...equipe, rota('PATCH /nexus/equipe/parceiros/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrado' }); return; }
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    if (b.status !== undefined) {
      if (!noConjunto(STATUS_PARCEIRO, b.status)) { res.status(400).json({ erro: 'status_invalido' }); return; }
      patch.status = b.status;
    }
    for (const [campo, coluna] of [
      ['conversa_feita', 'conversa_feita_em'],
      ['partner', 'partner_em'],
      ['montagem_aprovada', 'montagem_aprovada_em'],
    ] as const) {
      if (b[campo] === undefined) continue;
      if (typeof b[campo] !== 'boolean') { res.status(400).json({ erro: `${campo}_invalido` }); return; }
      patch[coluna] = b[campo] ? agora : null;
    }
    if (b.notas_equipe !== undefined) {
      if (b.notas_equipe !== null && typeof b.notas_equipe !== 'string') { res.status(400).json({ erro: 'notas_invalidas' }); return; }
      patch.notas_equipe = b.notas_equipe === null ? null : String(b.notas_equipe).slice(0, 2000);
    }
    if (!Object.keys(patch).length) { res.status(400).json({ erro: 'nada_para_mudar' }); return; }
    patch.updated_at = agora;

    const up = ok(await supabase.from('nexus_parceiros').update(patch).eq('id', id).select('*'), 'atualização do parceiro');
    const linha = ((up.data as Linha[] | null) ?? [])[0];
    if (!linha) { res.status(404).json({ erro: 'nao_encontrado' }); return; }
    res.json({ parceiro: linha });
  }));

  // ── Propostas de todos ─────────────────────────────────────────────────────
  router.get('/nexus/equipe/propostas', ...equipe, rota('GET /nexus/equipe/propostas', async (req, res) => {
    const bruto = typeof req.query.desde === 'string' ? req.query.desde.trim() : '';
    const desde = bruto ? inicioDiaBRT(bruto) : new Date(Date.now() - 90 * DIA_MS);
    if (!desde) { res.status(400).json({ erro: 'desde_invalido' }); return; }
    const desdeIso = desde.toISOString();

    const propostas = await lerTudo('propostas da equipe', (de, ate) =>
      supabase
        .from('nexus_propostas')
        .select('id, user_id, numero, saida_ultima, cliente_nome, cliente_cidade, cliente_uf, modelo, quantidade, valor_total, created_at, link_criado_em, aberturas, primeira_abertura_em, ultima_abertura_em')
        .gte('created_at', desdeIso)
        .order('created_at', { ascending: false })
        .range(de, ate));
    const parceiros = await mapaDeParceiros();
    res.json({
      propostas: propostas.map((pr) => {
        const p = parceiros.get(String(pr.user_id));
        return { ...pr, empresa: p?.empresa ?? null, cidade_parceiro: p?.cidade ?? null, uf_parceiro: p?.uf ?? null };
      }),
    });
  }));

  // ── Pedidos ────────────────────────────────────────────────────────────────
  router.get('/nexus/equipe/pedidos', ...equipe, rota('GET /nexus/equipe/pedidos', async (req, res) => {
    const st = typeof req.query.status === 'string' ? req.query.status : '';
    if (st && !noConjunto(STATUS_PEDIDO, st)) { res.status(400).json({ erro: 'status_invalido' }); return; }
    const pedidos = await lerTudo('pedidos da equipe', (de, ate) => {
      let q = supabase.from('nexus_pedidos').select('*').order('created_at', { ascending: false });
      if (st) q = q.eq('status', st);
      return q.range(de, ate);
    });
    const [parceiros, zaps] = await Promise.all([mapaDeParceiros(), whatsappsDe(pedidos.map((p) => String(p.user_id)))]);
    // Número da proposta ligada ao pedido, quando há.
    const numeros = new Map<string, string>();
    for (const lote of lotes([...new Set(pedidos.map((p) => p.proposta_id).filter(Boolean).map(String))], 100)) {
      const r = ok(await supabase.from('nexus_propostas').select('id, numero').in('id', lote), 'números das propostas dos pedidos');
      for (const pr of (r.data as Linha[] | null) ?? []) numeros.set(String(pr.id), String(pr.numero));
    }
    res.json({ pedidos: pedidos.map((p) => ({ ...comEmpresa(p, parceiros, zaps), proposta_numero: p.proposta_id ? numeros.get(String(p.proposta_id)) ?? null : null })) });
  }));

  router.patch('/nexus/equipe/pedidos/:id', ...equipe, rota('PATCH /nexus/equipe/pedidos/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrado' }); return; }
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = {};

    if (b.status !== undefined) {
      if (!noConjunto(STATUS_PEDIDO, b.status)) { res.status(400).json({ erro: 'status_invalido' }); return; }
      patch.status = b.status;
      patch.confirmado_em = b.status === 'confirmado' ? agora : null;
    }
    if (b.valor_negociado !== undefined) {
      if (b.valor_negociado === null) patch.valor_negociado = null;
      else {
        const n = typeof b.valor_negociado === 'string' ? Number(b.valor_negociado.replace(',', '.')) : Number(b.valor_negociado);
        if (!Number.isFinite(n) || n < 0 || n >= 100_000_000) { res.status(400).json({ erro: 'valor_invalido' }); return; }
        patch.valor_negociado = Math.round(n * 100) / 100;
      }
    }
    if (b.obs_equipe !== undefined) {
      if (b.obs_equipe !== null && typeof b.obs_equipe !== 'string') { res.status(400).json({ erro: 'obs_invalida' }); return; }
      patch.obs_equipe = b.obs_equipe === null ? null : String(b.obs_equipe).slice(0, 1000);
    }
    if (!Object.keys(patch).length) { res.status(400).json({ erro: 'nada_para_mudar' }); return; }

    // Confirmar mais de uma vez mantém a data da primeira confirmação.
    if (patch.status === 'confirmado') {
      const antes = ok(await supabase.from('nexus_pedidos').select('status, confirmado_em').eq('id', id).limit(1), 'leitura do pedido');
      const a = ((antes.data as Linha[] | null) ?? [])[0];
      if (a?.status === 'confirmado' && a.confirmado_em) patch.confirmado_em = a.confirmado_em;
    }
    patch.updated_at = agora;

    const up = ok(await supabase.from('nexus_pedidos').update(patch).eq('id', id).select('*'), 'atualização do pedido');
    const pedido = ((up.data as Linha[] | null) ?? [])[0];
    if (!pedido) { res.status(404).json({ erro: 'nao_encontrado' }); return; }
    // Qualquer mudança de status refaz a soma dos confirmados: é ela que sobe o parceiro para Pro e Master.
    const carregadores_comprados = await recalcularCarregadores(String(pedido.user_id));
    res.json({ pedido, carregadores_comprados, saldo_engenharia: await saldoEngenharia(String(pedido.user_id)) });
  }));

  // ── Oportunidades ──────────────────────────────────────────────────────────
  router.get('/nexus/equipe/oportunidades', ...equipe, rota('GET /nexus/equipe/oportunidades', async (req, res) => {
    const st = typeof req.query.status === 'string' ? req.query.status : '';
    if (st && !noConjunto(STATUS_OPORTUNIDADE, st)) { res.status(400).json({ erro: 'status_invalido' }); return; }
    const ops = await lerTudo('oportunidades da equipe', (de, ate) => {
      let q = supabase.from('nexus_oportunidades').select('*').order('created_at', { ascending: false });
      if (st) q = q.eq('status', st);
      return q.range(de, ate);
    });
    const parceiros = await mapaDeParceiros();
    res.json({
      oportunidades: ops.map((o) => {
        const p = o.parceiro_user_id ? parceiros.get(String(o.parceiro_user_id)) : null;
        return { ...o, empresa: p?.empresa ?? null, parceiro_empresa: p?.empresa ?? null };
      }),
    });
  }));

  router.post('/nexus/equipe/oportunidades', ...equipe, rota('POST /nexus/equipe/oportunidades', async (req, res) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    if (b.tipo !== 'cliente' && b.tipo !== 'obra') { res.status(400).json({ erro: 'tipo_invalido' }); return; }
    const cidade = textoLivre(b.cidade, 80);
    if (!cidade) { res.status(400).json({ erro: 'cidade_obrigatoria' }); return; }
    const uf = textoLivre(b.uf, 2)?.toUpperCase() ?? '';
    if (!UFS.includes(uf)) { res.status(400).json({ erro: 'uf_invalida' }); return; }
    const descricao = textoLivre(b.descricao, 2000);
    if (!descricao) { res.status(400).json({ erro: 'descricao_obrigatoria' }); return; }
    const prazo = new Date(String(b.prazo_aceite ?? ''));
    if (Number.isNaN(prazo.getTime())) { res.status(400).json({ erro: 'prazo_invalido' }); return; }
    const contato = contatoValido(b.contato);
    if (contato === 'invalido') { res.status(400).json({ erro: 'contato_invalido' }); return; }

    const agora = new Date().toISOString();
    const consultor = (req as unknown as { consultor?: { email?: string } }).consultor;
    const ins = await supabase
      .from('nexus_oportunidades')
      .insert({
        tipo: b.tipo,
        cidade,
        uf,
        descricao,
        valor_servico: textoLivre(b.valor_servico, 200),
        prazo_aceite: prazo.toISOString(),
        parceiro_user_id: null,
        status: 'rascunho',
        etapas: [{ status: 'rascunho', em: agora, obs: null }],
        contato,
        origem_ref: textoLivre(b.origem_ref, 80),
        criado_por: consultor?.email ?? null,
        created_at: agora,
        updated_at: agora,
      })
      .select('*')
      .single();
    if (ins.error) throw new ErroBanco(ins.error, 'criação da oportunidade');
    res.status(201).json({ oportunidade: ins.data });
  }));

  router.patch('/nexus/equipe/oportunidades/:id', ...equipe, rota('PATCH /nexus/equipe/oportunidades/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const lida = ok(await supabase.from('nexus_oportunidades').select('*').eq('id', id).limit(1), 'leitura da oportunidade');
    const atual = ((lida.data as Linha[] | null) ?? [])[0];
    if (!atual) { res.status(404).json({ erro: 'nao_encontrada' }); return; }

    const agora = new Date().toISOString();
    const patch: Record<string, unknown> = {};
    if (b.descricao !== undefined) {
      const d = textoLivre(b.descricao, 2000);
      if (!d) { res.status(400).json({ erro: 'descricao_obrigatoria' }); return; }
      patch.descricao = d;
    }
    if (b.valor_servico !== undefined) patch.valor_servico = textoLivre(b.valor_servico, 200);
    if (b.prazo_aceite !== undefined) {
      const p = new Date(String(b.prazo_aceite));
      if (Number.isNaN(p.getTime())) { res.status(400).json({ erro: 'prazo_invalido' }); return; }
      patch.prazo_aceite = p.toISOString();
    }
    if (b.contato !== undefined) {
      const c = contatoValido(b.contato);
      if (c === 'invalido') { res.status(400).json({ erro: 'contato_invalido' }); return; }
      patch.contato = c;
    }
    if (b.parceiro_user_id !== undefined) {
      if (b.parceiro_user_id !== null && !UUID.test(String(b.parceiro_user_id))) { res.status(400).json({ erro: 'parceiro_invalido' }); return; }
      // Trocar o parceiro de uma oportunidade em andamento tiraria o trabalho de quem já respondeu: só em rascunho, recusada ou expirada.
      if (String(b.parceiro_user_id ?? '') !== String(atual.parceiro_user_id ?? '') && !PODE_TROCAR_PARCEIRO.includes(String(atual.status))) {
        res.status(409).json({ erro: 'oportunidade_em_andamento' });
        return;
      }
      patch.parceiro_user_id = b.parceiro_user_id;
    }
    let status = atual.status as string;
    if (b.status !== undefined) {
      if (!noConjunto(STATUS_OPORTUNIDADE, b.status)) { res.status(400).json({ erro: 'status_invalido' }); return; }
      status = b.status;
    }

    // Oferecer = parceiro definido + status oferecida. O parceiro precisa poder VER a oportunidade (nível Pro) e o prazo
    // tem que estar no futuro; senão ela nasceria expirada ou invisível. Nada é enviado ao parceiro: ele vê no portal.
    if (status === 'oferecida') {
      const alvo = (patch.parceiro_user_id ?? atual.parceiro_user_id) as string | null;
      if (!alvo) { res.status(400).json({ erro: 'parceiro_obrigatorio' }); return; }
      const prazo = String(patch.prazo_aceite ?? atual.prazo_aceite ?? '');
      if (!prazo || Date.parse(prazo) <= Date.now()) { res.status(400).json({ erro: 'prazo_invalido' }); return; }
      const pr = ok(await supabase.from('nexus_parceiros').select('*').eq('user_id', alvo).limit(1), 'leitura do parceiro da oportunidade');
      const parceiro = ((pr.data as Linha[] | null) ?? [])[0];
      if (!parceiro) { res.status(400).json({ erro: 'parceiro_invalido' }); return; }
      const nivelDele = calcularNivel(entradaDoNivel(parceiro, null));
      if (!nivelDele.libera.termo) { res.status(409).json({ erro: 'parceiro_sem_nivel' }); return; }
      // Pro (1ª compra) sem o Termo aceito na versão vigente ainda não recebe oportunidade.
      if (!nivelDele.libera.oportunidades) { res.status(409).json({ erro: 'sem_termo_aceito' }); return; }
      // Obra só vai para quem tem o selo de montagem aprovada. Oportunidade do tipo 'cliente' vai para qualquer Pro.
      if (atual.tipo === 'obra' && !parceiro.montagem_aprovada_em) { res.status(409).json({ erro: 'sem_montagem_aprovada' }); return; }
      patch.parceiro_user_id = alvo;
    }

    const mudouStatus = status !== atual.status;
    const reoferta = status === 'oferecida' && !mudouStatus && patch.parceiro_user_id !== undefined && patch.parceiro_user_id !== atual.parceiro_user_id;
    if (mudouStatus || reoferta) {
      patch.status = status;
      patch.etapas = [...(Array.isArray(atual.etapas) ? atual.etapas : []), { status, em: agora, obs: 'equipe' }];
    }
    if (!Object.keys(patch).length) { res.status(400).json({ erro: 'nada_para_mudar' }); return; }
    patch.updated_at = agora;

    const up = ok(await supabase.from('nexus_oportunidades').update(patch).eq('id', id).select('*'), 'atualização da oportunidade');
    const nova = ((up.data as Linha[] | null) ?? [])[0];
    if (!nova) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    // Oferecida agora (ou reoferecida a outro parceiro): o parceiro recebe o e-mail. Nunca derruba o PATCH.
    let email_parceiro: string | null = null;
    if (status === 'oferecida' && (mudouStatus || reoferta) && nova.parceiro_user_id) {
      email_parceiro = await emailOportunidadeOferecida(nova, String(nova.parceiro_user_id));
    }
    res.json({ oportunidade: nova, email_parceiro });
  }));

  router.get('/nexus/equipe/oportunidades/:id/sugestoes', ...equipe, rota('GET /nexus/equipe/oportunidades/:id/sugestoes', async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    const lida = ok(await supabase.from('nexus_oportunidades').select('id, tipo, cidade, uf').eq('id', id).limit(1), 'leitura da oportunidade');
    const op = ((lida.data as Linha[] | null) ?? [])[0];
    if (!op) { res.status(404).json({ erro: 'nao_encontrada' }); return; }

    // Só quem pode receber: Pro ou Master (compra confirmada) com o Termo aceito, da mesma UF; obra exige também a montagem aprovada.
    const daUf = await lerTudo('parceiros da UF', (de, ate) =>
      supabase.from('nexus_parceiros').select('*').eq('uf', op.uf).order('created_at', { ascending: false }).range(de, ate));
    const aptos = daUf.filter((p) => calcularNivel(entradaDoNivel(p, null)).libera.oportunidades && (op.tipo !== 'obra' || !!p.montagem_aprovada_em));
    const ids = aptos.map((p) => String(p.user_id));
    const zaps = await whatsappsDe(ids);

    const historico: Linha[] = [];
    for (const lote of lotes(ids, 150)) {
      const r = ok(await supabase.from('nexus_oportunidades').select('parceiro_user_id, status, etapas').in('parceiro_user_id', lote), 'histórico de oportunidades');
      historico.push(...((r.data as Linha[] | null) ?? []));
    }

    const placar = (userId: string) => {
      const minhas = historico.filter((h) => String(h.parceiro_user_id) === userId);
      const aceitas = minhas.filter((h) => STATUS_APOS_ACEITE.includes(String(h.status))).length;
      const recusadas = minhas.filter((h) => h.status === 'recusada').length;
      const horas: number[] = [];
      for (const h of minhas) {
        const dt = tempoDeRespostaMs(h.etapas);
        if (dt !== null) horas.push(dt / 3_600_000);
      }
      const media = horas.length ? Math.round((horas.reduce((s, x) => s + x, 0) / horas.length) * 10) / 10 : null;
      return { aceitas, recusadas, tempo_medio_resposta_h: media };
    };

    // Compara o município, não o texto: a oportunidade pode vir "Fortaleza-CE" (formato
    // único dos leads desde 22/10/2026) e o parceiro ter digitado "fortaleza". UF só
    // desempata quando os dois lados têm.
    const cidadeDe = (texto: unknown, ufCol?: unknown) => {
      const s = normalizarCidade(String(texto ?? ''));
      return { chave: chaveMunicipio(s.cidade ?? String(texto ?? '')), uf: s.uf || (ufCol ? String(ufCol).trim().toUpperCase() : null) };
    };
    const cidadeOp = cidadeDe(op.cidade, op.uf);
    const mesmaCidade = (p: Linha) => {
      if (!cidadeOp.chave) return false;
      const c = cidadeDe(p.cidade, p.uf);
      return c.chave === cidadeOp.chave && (!c.uf || !cidadeOp.uf || c.uf === cidadeOp.uf);
    };
    const sugestoes = aptos
      .map((p) => ({
        user_id: p.user_id,
        parceiro_id: p.id,
        empresa: p.empresa ?? null,
        cidade: p.cidade ?? null,
        uf: p.uf ?? null,
        raio_km: p.raio_km ?? null,
        nivel: calcularNivel(entradaDoNivel(p, null)).nivel,
        montagem_aprovada: !!p.montagem_aprovada_em,
        whatsapp: zaps.get(String(p.user_id)) ?? null,
        mesma_cidade: mesmaCidade(p),
        placar: placar(String(p.user_id)),
      }))
      .sort((a, b) => Number(b.mesma_cidade) - Number(a.mesma_cidade) || b.placar.aceitas - a.placar.aceitas || a.placar.recusadas - b.placar.recusadas);
    res.json({ sugestoes });
  }));

  // ── Usinas ─────────────────────────────────────────────────────────────────
  router.get('/nexus/equipe/usinas', ...equipe, rota('GET /nexus/equipe/usinas', async (req, res) => {
    const st = typeof req.query.status === 'string' ? req.query.status : '';
    if (st && !noConjunto(STATUS_USINA, st)) { res.status(400).json({ erro: 'status_invalido' }); return; }
    const usinas = await lerTudo('usinas da equipe', (de, ate) => {
      let q = supabase.from('nexus_usinas').select('*').order('created_at', { ascending: false });
      if (st) q = q.eq('status', st);
      return q.range(de, ate);
    });
    const parceiros = await mapaDeParceiros();
    res.json({ usinas: usinas.map((u) => comEmpresa(u, parceiros)) });
  }));

  router.patch('/nexus/equipe/usinas/:id', ...equipe, rota('PATCH /nexus/equipe/usinas/:id', async (req, res) => {
    await atualizarComNota(req, res, 'nexus_usinas', STATUS_USINA, 'usina');
  }));

  // ── Solicitações ───────────────────────────────────────────────────────────
  router.get('/nexus/equipe/solicitacoes', ...equipe, rota('GET /nexus/equipe/solicitacoes', async (req, res) => {
    const st = typeof req.query.status === 'string' ? req.query.status : '';
    if (st && !noConjunto(STATUS_SOLICITACAO, st)) { res.status(400).json({ erro: 'status_invalido' }); return; }
    const sols = await lerTudo('solicitações da equipe', (de, ate) => {
      let q = supabase.from('nexus_solicitacoes').select('*').order('created_at', { ascending: false });
      if (st) q = q.eq('status', st);
      return q.range(de, ate);
    });
    const [parceiros, zaps] = await Promise.all([mapaDeParceiros(), whatsappsDe(sols.map((s) => String(s.user_id)))]);
    res.json({ solicitacoes: sols.map((s) => comEmpresa(s, parceiros, zaps)) });
  }));

  router.patch('/nexus/equipe/solicitacoes/:id', ...equipe, rota('PATCH /nexus/equipe/solicitacoes/:id', async (req, res) => {
    await atualizarComNota(req, res, 'nexus_solicitacoes', STATUS_SOLICITACAO, 'solicitacao');
  }));
}

/** PATCH {status, obs_equipe} das usinas e das solicitações: mesma forma, tabelas e status diferentes. */
async function atualizarComNota(
  req: Parameters<Parameters<typeof rota>[1]>[0],
  res: Parameters<Parameters<typeof rota>[1]>[1],
  tabela: string,
  statusValidos: readonly string[],
  nome: string,
): Promise<void> {
  const id = String(req.params.id);
  if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (b.status !== undefined) {
    if (!noConjunto(statusValidos, b.status)) { res.status(400).json({ erro: 'status_invalido' }); return; }
    patch.status = b.status;
  }
  if (b.obs_equipe !== undefined) {
    if (b.obs_equipe !== null && typeof b.obs_equipe !== 'string') { res.status(400).json({ erro: 'obs_invalida' }); return; }
    patch.obs_equipe = b.obs_equipe === null ? null : String(b.obs_equipe).slice(0, 1000);
  }
  if (!Object.keys(patch).length) { res.status(400).json({ erro: 'nada_para_mudar' }); return; }
  // Reabrir uma solicitação que usa o pacote (sai de 'cancelada') volta a gastar 1 projeto: só com saldo disponível.
  if (tabela === 'nexus_solicitacoes' && typeof patch.status === 'string' && patch.status !== 'cancelada') {
    const atual = ok(await supabase.from(tabela).select('id, user_id, tipo, status, dados').eq('id', id).limit(1), 'leitura da solicitação');
    const antes = ((atual.data as Linha[] | null) ?? [])[0];
    if (antes && antes.status === 'cancelada' && antes.tipo === 'engenharia' && antes.dados?.usa_pacote === true
      && (await saldoEngenharia(String(antes.user_id))).disponiveis <= 0) {
      res.status(409).json({ erro: 'sem_saldo' });
      return;
    }
  }
  patch.updated_at = new Date().toISOString();
  const up = ok(await supabase.from(tabela).update(patch).eq('id', id).select('*'), `atualização de ${nome}`);
  const linha = ((up.data as Linha[] | null) ?? [])[0];
  if (!linha) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
  res.json({ [nome]: linha });
}
