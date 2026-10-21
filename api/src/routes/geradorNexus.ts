// Portal do Parceiro NEXUS: rotas de /gerador/nexus/*. Montadas no fim de routes/gerador.ts por mountNexus(router).
//
//   Público        GET  /nexus/status, GET /nexus/cnpj/:cnpj (limitado por IP)
//   Parceiro (JWT do SolarDoc, authMiddleware)
//                  GET /nexus/eu, PUT /nexus/perfil, GET /nexus/procura,
//                  POST/PUT/GET /nexus/propostas[/:id], POST/GET /nexus/pedidos, POST/GET /nexus/solicitacoes
//                  + oportunidades e usinas (geradorNexusRede.ts)
//   Equipe (consultor do Gerador, exigeConsultor): geradorNexusEquipe.ts
//
// O router de /gerador não tem middleware global: cada rota declara o que exige, então nada barra o parceiro nem as
// rotas públicas. Tabela ausente (a MIGRATION_nexus_portal.sql ainda não rodou) = 503 `portal_desligado` em tudo que
// não é público; `/status` responde `{ligado:false}`.

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { nexusCnpjLimiter } from '../middleware/rateLimiter';
import { cnpjValido, formatarCnpj, soDigitos } from '../utils/cnpj';
import { consultarCnpj } from '../services/nexus/receita';
import { avisarComercial } from '../services/nexus/avisoComercial';
import { PRODUTOS } from '../services/nexus/catalogo';
import { procuraDaUf, UFS } from '../services/nexus/procura';
import {
  ErroBanco, Linha, acharLeadGerador, lerCompany, lerParceiro, marcarPerfilCompleto, montarEu, origemValida,
  portalLigado, utmDe,
} from '../services/nexus/repositorio';
import { colunasDe, inserirProposta, validarProposta } from '../services/nexus/propostas';
import { UUID, contexto, exigePortalLigado, ok, rota, textoLivre } from './geradorNexusBase';
import { mountNexusRede } from './geradorNexusRede';
import { mountNexusEquipe } from './geradorNexusEquipe';

// ── Cadastro do parceiro ─────────────────────────────────────────────────────

type FalhaCadastro = { status: number; corpo: Record<string, unknown> };

/**
 * Garante a linha do parceiro. Empresa e CNPJ vêm da company da conta; sem company, o CNPJ vem do PUT /perfil.
 * Receita diz "não ativa" = recusa, sem criar nada. Receita fora = 'nao_verificado'.
 */
async function garantirParceiro(
  userId: string,
  opcoes: { origem: string; utm: Record<string, string> | null; cnpjNovo?: string; empresaNova?: string },
): Promise<{ parceiro: Linha; company: Linha | null; criado: boolean } | FalhaCadastro> {
  let company = await lerCompany(userId);
  const existente = await lerParceiro(userId);
  if (existente) return { parceiro: existente, company, criado: false };

  const cnpjDaConta = soDigitos(company?.cnpj);
  const cnpj = cnpjDaConta.length === 14 ? cnpjDaConta : soDigitos(opcoes.cnpjNovo);
  if (!cnpj) return { status: 409, corpo: { erro: 'sem_cnpj' } };
  if (!cnpjValido(cnpj)) return { status: 400, corpo: { erro: 'cnpj_invalido' } };

  const receita = await consultarCnpj(cnpj);
  if (receita.ok && !receita.ativa) return { status: 403, corpo: { erro: 'cnpj_inativo' } };
  const situacao = receita.ok ? 'ativa' : 'nao_verificado';

  if (!company) {
    // CNPJ é UNIQUE em company: se outra conta já tem, não cria uma segunda empresa com o mesmo.
    const { data: uso, error: usoErr } = await supabase.from('company').select('user_id').in('cnpj', [cnpj, formatarCnpj(cnpj)]).limit(1);
    if (usoErr) throw new ErroBanco(usoErr, 'conferência do CNPJ');
    if (((uso as Linha[] | null) ?? [])[0]) return { status: 409, corpo: { erro: 'cnpj_em_uso' } };
    const { data: u } = await supabase.from('users').select('whatsapp').eq('id', userId).limit(1);
    const nome = String(opcoes.empresaNova || (receita.ok ? receita.razao_social : '') || 'Empresa').slice(0, 255);
    const criada = await supabase
      .from('company')
      .insert({
        user_id: userId,
        nome,
        nome_fantasia: receita.ok && receita.nome_fantasia ? receita.nome_fantasia : null,
        cnpj,
        whatsapp: ((u as Linha[] | null) ?? [])[0]?.whatsapp ?? null,
      })
      .select('id, nome, nome_fantasia, cnpj, cidade, whatsapp, logo_base64')
      .single();
    if (criada.error) {
      if ((criada.error as { code?: string }).code === '23505') return { status: 409, corpo: { erro: 'cnpj_em_uso' } };
      throw new ErroBanco(criada.error, 'criação da empresa');
    }
    company = criada.data as Linha;
  }

  const lead = await acharLeadGerador(company?.whatsapp);
  const agora = new Date().toISOString();
  const nomeEmpresa = String(company?.nome_fantasia || company?.nome || opcoes.empresaNova || '').trim().slice(0, 255) || null;
  const linha = {
    user_id: userId,
    empresa: nomeEmpresa,
    cnpj,
    cnpj_situacao: situacao,
    cidade: (company?.cidade ? String(company.cidade).trim().slice(0, 80) : '') || lead?.cidade || null,
    equipe_tamanho: lead?.equipe ?? null,
    origem: opcoes.origem,
    status: 'novo',
    utm: opcoes.utm,
    lead_gerador_id: lead?.id ?? null,
    created_at: agora,
    updated_at: agora,
  };
  const ins = await supabase.from('nexus_parceiros').insert(linha).select('*').single();
  if (ins.error) {
    // Duas chamadas simultâneas na primeira vez: a perdedora lê a linha da vencedora e não avisa de novo.
    if ((ins.error as { code?: string }).code === '23505') {
      const outra = await lerParceiro(userId);
      if (outra) return { parceiro: outra, company, criado: false };
    }
    throw new ErroBanco(ins.error, 'criação do parceiro');
  }
  return { parceiro: ins.data as Linha, company, criado: true };
}

const ehFalha = (r: unknown): r is FalhaCadastro => !!r && typeof (r as FalhaCadastro).status === 'number';

function avisoDoCadastro(parceiro: Linha, company: Linha | null) {
  return avisarComercial('cadastro', { parceiro: parceiro as never, whatsapp: company?.whatsapp ?? null });
}

// ── Validação do perfil ──────────────────────────────────────────────────────

const booleano = z.boolean().optional();
const perfilSchema = z.object({
  empresa: z.string().trim().max(160).optional(),
  cnpj: z.string().max(30).optional(),
  cidade: z.string().trim().max(80).optional(),
  uf: z.string().trim().length(2).transform((s) => s.toUpperCase()).refine((s) => UFS.includes(s), 'UF inválida').optional(),
  raio_km: z.coerce.number().int().min(1).max(5000).optional(),
  papel_revenda: booleano,
  papel_montagem: booleano,
  cap_eletrica_bt: booleano,
  cap_eletrica_mt: booleano,
  cap_engenharia_art: booleano,
  cap_obra_civil: booleano,
  cap_homologacao: booleano,
  cap_ja_instala: booleano,
  equipe_tamanho: z.coerce.number().int().min(0).max(10000).nullable().optional(),
  // Data URL png/jpeg/webp. 600 KB de imagem viram uns 800 mil caracteres em base64.
  logo_base64: z
    .string()
    .max(820_000)
    .refine((s) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(s), 'logo inválido')
    .optional(),
});

const CAMPOS_DO_PERFIL = [
  'cidade', 'uf', 'raio_km', 'papel_revenda', 'papel_montagem', 'cap_eletrica_bt', 'cap_eletrica_mt', 'cap_engenharia_art',
  'cap_obra_civil', 'cap_homologacao', 'cap_ja_instala', 'equipe_tamanho',
] as const;

// ── Solicitações ─────────────────────────────────────────────────────────────

const TIPOS_SOLICITACAO = ['conversa', 'engenharia', 'negociar_preco'] as const;
type TipoSolicitacao = (typeof TIPOS_SOLICITACAO)[number];
const LIMITE_DADOS_SOLICITACAO = 20 * 1024;

/** Linha de resumo da engenharia para o aviso: serviço e local, sem o resto do que o parceiro escreveu. */
function resumoDaEngenharia(dados: Record<string, unknown>): string {
  // O portal manda servico_nome (texto) e servico (código do select); o nome vence, o código é reserva.
  const servico = textoLivre(dados.servico_nome, 60) ?? textoLivre(dados.servico, 60) ?? '';
  const cidade = textoLivre(dados.cidade, 60) ?? '';
  const uf = textoLivre(dados.uf, 2) ?? '';
  const lugar = cidade ? `${cidade}${uf ? '/' + uf : ''}` : uf;
  return [servico, lugar ? `em ${lugar}` : ''].filter(Boolean).join(' ');
}

// ── Rotas ────────────────────────────────────────────────────────────────────

export function mountNexus(router: Router): void {
  const parceiro = [authMiddleware, exigePortalLigado];

  // ── Públicas ───────────────────────────────────────────────────────────────
  router.get('/nexus/status', async (_req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ligado: await portalLigado() });
  });

  router.get('/nexus/cnpj/:cnpj', nexusCnpjLimiter, async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    const digitos = soDigitos(req.params.cnpj);
    if (!cnpjValido(digitos)) { res.json({ ok: false, motivo: 'invalido' }); return; }
    const r = await consultarCnpj(digitos);
    if (!r.ok) { res.json({ ok: false, motivo: r.motivo }); return; }
    res.json({ ok: true, ativa: r.ativa, razao_social: r.razao_social, nome_fantasia: r.nome_fantasia });
  });

  // ── Parceiro: conta e perfil ───────────────────────────────────────────────
  router.get('/nexus/eu', ...parceiro, rota('GET /nexus/eu', async (req, res) => {
    const q = req.query as Record<string, unknown>;
    const r = await garantirParceiro(req.userId, { origem: origemValida(q.origem), utm: utmDe(q) });
    if (ehFalha(r)) { res.status(r.status).json(r.corpo); return; }
    const p = await marcarPerfilCompleto(r.parceiro, r.company);
    if (r.criado) await avisoDoCadastro(p, r.company);
    res.json(await montarEu(p, r.company));
  }));

  router.put('/nexus/perfil', ...parceiro, rota('PUT /nexus/perfil', async (req, res) => {
    const v = perfilSchema.safeParse(req.body ?? {});
    if (!v.success) {
      res.status(400).json({ erro: 'perfil_invalido', detalhe: v.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`) });
      return;
    }
    const b = v.data;
    const r = await garantirParceiro(req.userId, { origem: 'portal', utm: null, cnpjNovo: b.cnpj, empresaNova: b.empresa });
    if (ehFalha(r)) { res.status(r.status).json(r.corpo); return; }

    let company = r.company;
    if (b.logo_base64 && company) {
      const { error } = await supabase.from('company').update({ logo_base64: b.logo_base64 }).eq('id', company.id);
      if (error) throw new ErroBanco(error, 'gravação do logo');
      company = { ...company, logo_base64: b.logo_base64 };
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const k of CAMPOS_DO_PERFIL) if (b[k] !== undefined) patch[k] = b[k];
    if (b.empresa) patch.empresa = b.empresa;
    const up = await supabase.from('nexus_parceiros').update(patch).eq('id', r.parceiro.id).select('*').single();
    if (up.error) throw new ErroBanco(up.error, 'gravação do perfil');

    const p = await marcarPerfilCompleto(up.data as Linha, company);
    // O aviso (a) sai depois do perfil gravado, para já levar cidade e papéis.
    if (r.criado) await avisoDoCadastro(p, company);
    res.json(await montarEu(p, company));
  }));

  // ── Parceiro: procura (contagens do banco do Gerador, cache de 6 h) ────────
  router.get('/nexus/procura', ...parceiro, rota('GET /nexus/procura', async (req, res) => {
    const bruto = typeof req.query.uf === 'string' ? req.query.uf.trim().toUpperCase() : '';
    if (bruto && !UFS.includes(bruto)) { res.status(400).json({ erro: 'uf_invalida' }); return; }
    try {
      res.json(await procuraDaUf(bruto || null));
    } catch {
      res.status(502).json({ erro: 'procura_indisponivel' });
    }
  }));

  // ── Parceiro: propostas ────────────────────────────────────────────────────
  router.post('/nexus/propostas', ...parceiro, rota('POST /nexus/propostas', async (req, res) => {
    const v = validarProposta(req.body);
    if (!v.ok) { res.status(400).json({ erro: v.erro }); return; }
    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    if (!c.libera[v.p.saida]) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }
    const nova = await inserirProposta(req.userId, v.p);
    if (!c.parceiro.primeira_proposta_em) {
      const agora = new Date().toISOString();
      const { error } = await supabase.from('nexus_parceiros').update({ primeira_proposta_em: agora, updated_at: agora }).eq('id', c.parceiro.id);
      if (error) throw new ErroBanco(error, 'marco da primeira proposta');
    }
    res.status(201).json(nova);
  }));

  router.put('/nexus/propostas/:id', ...parceiro, rota('PUT /nexus/propostas/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    const v = validarProposta(req.body);
    if (!v.ok) { res.status(400).json({ erro: v.erro }); return; }
    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    if (!c.libera[v.p.saida]) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }
    const up = await supabase
      .from('nexus_propostas')
      .update({ saida_ultima: v.p.saida, ...colunasDe(v.p), updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', req.userId)
      .select('id, numero');
    ok(up, 'atualização da proposta');
    const linha = ((up.data as Linha[] | null) ?? [])[0];
    if (!linha) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    res.json({ id: linha.id, numero: linha.numero });
  }));

  router.get('/nexus/propostas', ...parceiro, rota('GET /nexus/propostas', async (req, res) => {
    const r = ok(
      await supabase
        .from('nexus_propostas')
        .select('id, numero, cliente_nome, cliente_cidade, cliente_uf, modelo, quantidade, valor_total, saida_ultima, created_at')
        .eq('user_id', req.userId)
        .order('created_at', { ascending: false })
        .limit(200),
      'lista de propostas',
    );
    res.json({ propostas: (r.data as Linha[] | null) ?? [] });
  }));

  router.get('/nexus/propostas/:id', ...parceiro, rota('GET /nexus/propostas/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    const r = ok(await supabase.from('nexus_propostas').select('*').eq('id', id).eq('user_id', req.userId).limit(1), 'leitura da proposta');
    const linha = ((r.data as Linha[] | null) ?? [])[0];
    if (!linha) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    const { user_id: _u, ...resto } = linha;
    res.json({ proposta: resto });
  }));

  // ── Parceiro: pedidos de equipamento (libera.pedido = Partner em diante) ───
  router.post('/nexus/pedidos', ...parceiro, rota('POST /nexus/pedidos', async (req, res) => {
    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    if (!c.libera.pedido) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }

    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const produto = PRODUTOS.find((p) => p.id === b.modelo);
    if (!produto) { res.status(400).json({ erro: 'modelo_invalido' }); return; }
    const quantidade = Number(b.quantidade);
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) { res.status(400).json({ erro: 'quantidade_invalida' }); return; }

    // A proposta ligada tem que ser do próprio parceiro; é dela que vêm o número e o valor do aviso.
    let proposta: Linha | null = null;
    if (b.proposta_id != null && b.proposta_id !== '') {
      const pid = String(b.proposta_id);
      if (!UUID.test(pid)) { res.status(404).json({ erro: 'proposta_nao_encontrada' }); return; }
      const r = ok(await supabase.from('nexus_propostas').select('id, numero, valor_total').eq('id', pid).eq('user_id', req.userId).limit(1), 'leitura da proposta do pedido');
      proposta = ((r.data as Linha[] | null) ?? [])[0] ?? null;
      if (!proposta) { res.status(404).json({ erro: 'proposta_nao_encontrada' }); return; }
    }

    const obs = textoLivre(b.obs, 300);
    const agora = new Date().toISOString();
    const ins = await supabase
      .from('nexus_pedidos')
      .insert({
        user_id: req.userId, proposta_id: proposta?.id ?? null, modelo: produto.id, quantidade, status: 'solicitado',
        obs, created_at: agora, updated_at: agora,
      })
      .select('id')
      .single();
    if (ins.error) throw new ErroBanco(ins.error, 'gravação do pedido');
    const id = String((ins.data as Linha).id);

    await avisarComercial('pedido', {
      parceiro: c.parceiro as never,
      whatsapp: c.company?.whatsapp ?? null,
      pedido: { id, modelo: produto.nome, quantidade, numero: proposta?.numero ?? null, valor_total: proposta ? Number(proposta.valor_total) : null },
      obs,
    });
    res.status(201).json({ id });
  }));

  router.get('/nexus/pedidos', ...parceiro, rota('GET /nexus/pedidos', async (req, res) => {
    const r = ok(
      await supabase
        .from('nexus_pedidos')
        .select('id, proposta_id, modelo, quantidade, status, valor_negociado, obs, confirmado_em, created_at')
        .eq('user_id', req.userId)
        .order('created_at', { ascending: false })
        .limit(200),
      'lista de pedidos',
    );
    res.json({ pedidos: (r.data as Linha[] | null) ?? [] });
  }));

  // ── Parceiro: solicitações (conversa, engenharia, negociar preço) ──────────
  router.post('/nexus/solicitacoes', ...parceiro, rota('POST /nexus/solicitacoes', async (req, res) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const tipo = b.tipo as TipoSolicitacao;
    if (!TIPOS_SOLICITACAO.includes(tipo)) { res.status(400).json({ erro: 'tipo_invalido' }); return; }
    const dados = b.dados == null ? {} : b.dados;
    if (typeof dados !== 'object' || Array.isArray(dados)) { res.status(400).json({ erro: 'dados_invalidos' }); return; }
    if (Buffer.byteLength(JSON.stringify(dados), 'utf8') > LIMITE_DADOS_SOLICITACAO) { res.status(400).json({ erro: 'dados_grandes_demais' }); return; }

    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    const liberado = tipo === 'conversa' ? c.libera.conversa : tipo === 'engenharia' ? c.libera.engenharia : c.libera.negociar;
    if (!liberado) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }

    const agora = new Date().toISOString();
    const ins = await supabase
      .from('nexus_solicitacoes')
      .insert({ user_id: req.userId, tipo, dados, status: 'aberta', created_at: agora, updated_at: agora })
      .select('id')
      .single();
    if (ins.error) throw new ErroBanco(ins.error, 'gravação da solicitação');

    if (tipo === 'conversa') {
      const { error } = await supabase.from('nexus_parceiros').update({ conversa_pedida_em: agora, updated_at: agora }).eq('id', c.parceiro.id);
      if (error) throw new ErroBanco(error, 'pedido de conversa');
    }
    const d = dados as Record<string, unknown>;
    await avisarComercial('solicitacao', {
      parceiro: c.parceiro as never,
      whatsapp: c.company?.whatsapp ?? null,
      solicitacao: { tipo, resumo: tipo === 'engenharia' ? resumoDaEngenharia(d) : null },
      obs: textoLivre(d.obs, 300),
    });
    res.status(201).json({ id: (ins.data as Linha).id });
  }));

  router.get('/nexus/solicitacoes', ...parceiro, rota('GET /nexus/solicitacoes', async (req, res) => {
    const r = ok(
      await supabase
        .from('nexus_solicitacoes')
        .select('id, tipo, dados, status, created_at, updated_at')
        .eq('user_id', req.userId)
        .order('created_at', { ascending: false })
        .limit(200),
      'lista de solicitações',
    );
    res.json({ solicitacoes: (r.data as Linha[] | null) ?? [] });
  }));

  mountNexusRede(router);
  mountNexusEquipe(router);
}
