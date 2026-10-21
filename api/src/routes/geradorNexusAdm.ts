// Portal do Parceiro NEXUS, v4: o ADM e a equipe por DOIS logins (token do Gerador ou JWT do SolarDoc). Montado por
// mountNexusAdm(router), chamado no fim do mountNexus. Tudo atrás do exigeEquipeNexus (services/nexus/equipeAuth.ts).
//
//   GET   /nexus/adm/eu                 -> {ok:true, email, nome, socio, gerirEquipe, via}
//                                          401 sem login; 403 {erro:'sem_acesso_adm'}; 503 portal desligado
//   GET   /nexus/equipe/membros         -> {membros:[{id,email,papel,ativo,criado_por,created_at}]}   (qualquer da equipe)
//   POST  /nexus/equipe/membros         {email, papel:'admin'|'socio'}  gerirEquipe; o e-mail PRECISA ter conta em users (senão 409
//                                          {erro:'sem_conta'}); grava o user_id da conta; reativar atualiza o user_id
//                                          -> 201 {membro} (novo) | 200 {membro} (já existia)
//   PATCH /nexus/equipe/membros/:id     {ativo?, papel?}  gerirEquipe; ninguém desativa o próprio acesso (409)
//   GET   /nexus/equipe/funil           ?desde=AAAA-MM-DD  (dia em Brasília; sem o parâmetro = tudo)
//                                       -> {etapas:[{chave,rotulo,total}], por_origem:[{origem,cadastros,propostas,compras}],
//                                           por_uf:[{uf,cadastros,propostas,compras}]}
//
// Funil: a COORTE é nexus_parceiros com created_at >= o início do dia `desde` (BRT). Etapas = parceiros DISTINTOS da
// coorte que chegaram em cada marco (não condicionados à etapa anterior; a taxa sobre a anterior o painel calcula):
// cadastros, perfil_completo (perfil_completo_em), primeira_proposta (primeira_proposta_em), conversa_pedida,
// conversa_feita, partner (partner_em), primeira_compra (carregadores_comprados >= 1), termo_aceito (termo_aceito_em),
// master (carregadores_comprados >= 5). Em por_origem e por_uf, `propostas` e `compras` também são parceiros distintos
// da coorte: com ao menos uma linha em nexus_propostas, e com ao menos um pedido de EQUIPAMENTO confirmado em
// nexus_pedidos. As 8 origens aparecem sempre (mesmo com 0); origem vazia ou fora da lista cai em 'sem_origem' (só
// aparece se tiver cadastro); UF vazia cai em 'sem_uf'. por_uf vem do maior para o menor número de cadastros.
//
// nexus_equipe é opcional: ausente = lista vazia no GET, 503 `equipe_sem_tabela` no POST e no PATCH (nunca
// `portal_desligado`: esta tabela não liga nem desliga o portal).

import { Router } from 'express';
import { supabase } from '../utils/supabase';
import { ORIGENS_VALIDAS, Linha, ehPedidoDeEquipamento } from '../services/nexus/repositorio';
import { exigeEquipeNexus } from '../services/nexus/equipeAuth';
import {
  ErroEquipe, PAPEIS_EQUIPE, equipeSemTabela, listarMembros, contaPorEmail, membroPorEmail, normalizarEmail,
} from '../services/nexus/equipe';
import { inicioDiaBRT } from '../services/nexus/tempo';
import { UUID, exigePortalLigado, lerTudo, rota } from './geradorNexusBase';

const EMAIL_RE = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

export const ETAPAS_DO_FUNIL: ReadonlyArray<{ chave: string; rotulo: string }> = Object.freeze([
  { chave: 'cadastros', rotulo: 'Cadastros' },
  { chave: 'perfil_completo', rotulo: 'Perfil completo' },
  { chave: 'primeira_proposta', rotulo: 'Primeira proposta' },
  { chave: 'conversa_pedida', rotulo: 'Conversa pedida' },
  { chave: 'conversa_feita', rotulo: 'Conversa feita' },
  { chave: 'partner', rotulo: 'Partner' },
  { chave: 'primeira_compra', rotulo: 'Primeira compra (Pro)' },
  { chave: 'termo_aceito', rotulo: 'Termo aceito' },
  { chave: 'master', rotulo: 'Master' },
]);

const COLUNAS_FUNIL = 'id, user_id, origem, uf, created_at, perfil_completo_em, primeira_proposta_em, conversa_pedida_em, conversa_feita_em, partner_em, carregadores_comprados, termo_aceito_em';

const marca = (v: unknown): boolean => v != null && v !== '';

/** Contas do funil. Exportada para o teste conferir as contas sem passar pela rota. */
export function calcularFunil(parceiros: Linha[], comProposta: Set<string>, comCompra: Set<string>) {
  const carregadores = (p: Linha) => Number(p.carregadores_comprados) || 0;
  const regras: Record<string, (p: Linha) => boolean> = {
    cadastros: () => true,
    perfil_completo: (p) => marca(p.perfil_completo_em),
    primeira_proposta: (p) => marca(p.primeira_proposta_em),
    conversa_pedida: (p) => marca(p.conversa_pedida_em),
    conversa_feita: (p) => marca(p.conversa_feita_em),
    partner: (p) => marca(p.partner_em),
    primeira_compra: (p) => carregadores(p) >= 1,
    termo_aceito: (p) => marca(p.termo_aceito_em),
    master: (p) => carregadores(p) >= 5,
  };
  const etapas = ETAPAS_DO_FUNIL.map((e) => ({ chave: e.chave, rotulo: e.rotulo, total: parceiros.filter(regras[e.chave]!).length }));

  type Conta = { cadastros: number; propostas: number; compras: number };
  const somar = (m: Map<string, Conta>, chave: string, p: Linha) => {
    const c = m.get(chave) ?? { cadastros: 0, propostas: 0, compras: 0 };
    c.cadastros++;
    if (comProposta.has(String(p.user_id))) c.propostas++;
    if (comCompra.has(String(p.user_id))) c.compras++;
    m.set(chave, c);
  };
  const origens = new Map<string, Conta>(ORIGENS_VALIDAS.map((o) => [o, { cadastros: 0, propostas: 0, compras: 0 }]));
  const ufs = new Map<string, Conta>();
  for (const p of parceiros) {
    const o = String(p.origem ?? '').trim();
    somar(origens, ORIGENS_VALIDAS.includes(o) ? o : 'sem_origem', p);
    somar(ufs, String(p.uf ?? '').trim().toUpperCase() || 'sem_uf', p);
  }
  const por_origem = [...origens.entries()].map(([origem, c]) => ({ origem, ...c }));
  const por_uf = [...ufs.entries()].map(([uf, c]) => ({ uf, ...c })).sort((a, b) => b.cadastros - a.cadastros || Number(a.uf === 'sem_uf') - Number(b.uf === 'sem_uf') || (a.uf < b.uf ? -1 : a.uf > b.uf ? 1 : 0));
  return { etapas, por_origem, por_uf };
}

export function mountNexusAdm(router: Router): void {
  const equipe = [exigeEquipeNexus, exigePortalLigado];

  router.get('/nexus/adm/eu', ...equipe, rota('GET /nexus/adm/eu', async (req, res) => {
    const e = req.equipe!;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, email: e.email, nome: e.nome, socio: e.socio, gerirEquipe: e.gerirEquipe, via: e.via });
  }));

  // ── Membros da equipe ──────────────────────────────────────────────────────
  router.get('/nexus/equipe/membros', ...equipe, rota('GET /nexus/equipe/membros', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ membros: await listarMembros() });
  }));

  router.post('/nexus/equipe/membros', ...equipe, rota('POST /nexus/equipe/membros', async (req, res) => {
    const e = req.equipe!;
    if (!e.gerirEquipe) { res.status(403).json({ erro: 'sem_permissao' }); return; }
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const email = normalizarEmail(b.email);
    if (email.length > 254 || !EMAIL_RE.test(email)) { res.status(400).json({ erro: 'email_invalido' }); return; }
    const papel = typeof b.papel === 'string' ? b.papel : '';
    if (!(PAPEIS_EQUIPE as readonly string[]).includes(papel)) { res.status(400).json({ erro: 'papel_invalido' }); return; }

    // Só libera quem JÁ tem conta: o acesso fica preso ao users.id (um e-mail sem conta poderia ser tomado por quem se cadastrasse antes).
    const contaId = await contaPorEmail(email);
    if (!contaId) { res.status(409).json({ erro: 'sem_conta' }); return; }

    const agora = new Date().toISOString();
    const existente = await membroPorEmail(email);
    if (existente) {
      const up = await supabase.from('nexus_equipe').update({ ativo: true, papel, user_id: contaId, updated_at: agora }).eq('id', existente.id).select('*').single();
      if (up.error) {
        if (equipeSemTabela(up.error)) { res.status(503).json({ erro: 'equipe_sem_tabela' }); return; }
        throw new ErroEquipe(up.error, 'reativação do membro');
      }
      res.json({ membro: up.data });
      return;
    }
    const ins = await supabase
      .from('nexus_equipe')
      .insert({ email, user_id: contaId, papel, ativo: true, criado_por: e.email, created_at: agora, updated_at: agora })
      .select('*')
      .single();
    if (ins.error) {
      if (equipeSemTabela(ins.error)) { res.status(503).json({ erro: 'equipe_sem_tabela' }); return; }
      if ((ins.error as { code?: string }).code === '23505') { res.status(409).json({ erro: 'email_ja_cadastrado' }); return; } // corrida: outro POST criou antes
      throw new ErroEquipe(ins.error, 'inclusão do membro');
    }
    res.status(201).json({ membro: ins.data });
  }));

  router.patch('/nexus/equipe/membros/:id', ...equipe, rota('PATCH /nexus/equipe/membros/:id', async (req, res) => {
    const e = req.equipe!;
    if (!e.gerirEquipe) { res.status(403).json({ erro: 'sem_permissao' }); return; }
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrado' }); return; }
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (b.ativo !== undefined) {
      if (typeof b.ativo !== 'boolean') { res.status(400).json({ erro: 'ativo_invalido' }); return; }
      patch.ativo = b.ativo;
    }
    if (b.papel !== undefined) {
      if (typeof b.papel !== 'string' || !(PAPEIS_EQUIPE as readonly string[]).includes(b.papel)) { res.status(400).json({ erro: 'papel_invalido' }); return; }
      patch.papel = b.papel;
    }
    if (Object.keys(patch).length === 0) { res.status(400).json({ erro: 'nada_para_alterar' }); return; }

    const lida = await supabase.from('nexus_equipe').select('id, email').eq('id', id).limit(1);
    if (lida.error) {
      if (equipeSemTabela(lida.error)) { res.status(503).json({ erro: 'equipe_sem_tabela' }); return; }
      throw new ErroEquipe(lida.error, 'leitura do membro');
    }
    const atual = ((lida.data as Linha[] | null) ?? [])[0];
    if (!atual) { res.status(404).json({ erro: 'nao_encontrado' }); return; }
    if (patch.ativo === false && normalizarEmail(atual.email) === e.email) {
      res.status(409).json({ erro: 'nao_pode_desativar_a_si_mesmo' });
      return;
    }
    if (patch.papel !== undefined && normalizarEmail(atual.email) === e.email) {
      res.status(409).json({ erro: 'nao_pode_mudar_o_proprio_papel' });
      return;
    }
    if (patch.ativo === true) {
      // Reativar prende o acesso à conta ATUAL do e-mail (mesma regra do POST); sem conta, não reativa.
      const contaId = await contaPorEmail(normalizarEmail(atual.email));
      if (!contaId) { res.status(409).json({ erro: 'sem_conta' }); return; }
      patch.user_id = contaId;
    }
    patch.updated_at = new Date().toISOString();
    const up = await supabase.from('nexus_equipe').update(patch).eq('id', id).select('*').single();
    if (up.error) {
      if (equipeSemTabela(up.error)) { res.status(503).json({ erro: 'equipe_sem_tabela' }); return; }
      throw new ErroEquipe(up.error, 'alteração do membro');
    }
    res.json({ membro: up.data });
  }));

  // ── Funil ──────────────────────────────────────────────────────────────────
  router.get('/nexus/equipe/funil', ...equipe, rota('GET /nexus/equipe/funil', async (req, res) => {
    const bruto = typeof req.query.desde === 'string' ? req.query.desde.trim() : '';
    let desdeIso: string | null = null;
    if (bruto) {
      const d = inicioDiaBRT(bruto);
      if (!d) { res.status(400).json({ erro: 'desde_invalido' }); return; }
      desdeIso = d.toISOString();
    }
    const parceiros = await lerTudo('funil: parceiros', (de, ate) => {
      let q: any = supabase.from('nexus_parceiros').select(COLUNAS_FUNIL);
      if (desdeIso) q = q.gte('created_at', desdeIso);
      return q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(de, ate);
    });
    const propostas = await lerTudo('funil: propostas', (de, ate) =>
      supabase.from('nexus_propostas').select('id, user_id').order('id', { ascending: true }).range(de, ate));
    const pedidos = await lerTudo('funil: pedidos', (de, ate) =>
      supabase.from('nexus_pedidos').select('id, user_id, tipo, status').eq('status', 'confirmado').order('id', { ascending: true }).range(de, ate));

    const comProposta = new Set(propostas.map((p) => String(p.user_id)));
    const comCompra = new Set(pedidos.filter(ehPedidoDeEquipamento).map((p) => String(p.user_id)));
    res.setHeader('Cache-Control', 'no-store');
    res.json(calcularFunil(parceiros, comProposta, comCompra));
  }));
}
