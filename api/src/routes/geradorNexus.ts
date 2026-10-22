// Portal do Parceiro NEXUS: rotas de /gerador/nexus/*. Montadas no fim de routes/gerador.ts por mountNexus(router).
//
//   Público        GET  /nexus/status, GET /nexus/cnpj/:cnpj (limitado por IP)
//   Parceiro (JWT do SolarDoc, authMiddleware)
//                  GET /nexus/eu, PUT /nexus/perfil, GET /nexus/procura,
//                  POST/PUT/GET /nexus/propostas[/:id], POST /nexus/propostas/:id/link,
//                  POST/GET /nexus/pedidos (tipo equipamento | engenharia | consultoria | manutencao), POST/GET /nexus/solicitacoes,
//                  POST /nexus/termo/aceitar
//                  + oportunidades e usinas (geradorNexusRede.ts)
//   Público        GET  /nexus/p/:token  (proposta pelo link do cliente final, conta abertura)
//   Equipe (exigeEquipeNexus: token do Gerador OU JWT do SolarDoc de admin/equipe): geradorNexusEquipe.ts; convite por e-mail
//   (só sócio): geradorNexusConvite.ts; ADM, membros e funil (v4): geradorNexusAdm.ts
//
// O router de /gerador não tem middleware global: cada rota declara o que exige, então nada barra o parceiro nem as
// rotas públicas. Tabela ausente (a MIGRATION_nexus_portal.sql ainda não rodou) = 503 `portal_desligado` em tudo que
// não é público; `/status` responde `{ligado:false}`.

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { supabase } from '../utils/supabase';
import { authMiddleware } from '../middleware/auth';
import { nexusCnpjLimiter } from '../middleware/rateLimiter';
import { cnpjValido, formatarCnpj, soDigitos } from '../utils/cnpj';
import { consultarCnpj } from '../services/nexus/receita';
import { avisarComercial } from '../services/nexus/avisoComercial';
import {
  ENTREGA, FINANCIAMENTO, MANUTENCAO_MAX, MANUTENCAO_MIN, PACOTES_ENGENHARIA, PRODUTOS, TERMO_VERSAO, catalogoParaFront, liberaEngenharia,
} from '../services/nexus/catalogo';
import { procuraDaUf, UFS } from '../services/nexus/procura';
import {
  ErroBanco, Linha, acharLeadGerador, lerCompany, lerParceiro, marcarPerfilCompleto, montarEu, origemValida,
  cidadeUf, portalLigado, separarCidadeUf, usarPacote, utmDe,
} from '../services/nexus/repositorio';
import { colunasDe, inserirProposta, validarProposta } from '../services/nexus/propostas';
import { UUID, contexto, exigePortalLigado, ok, rota, textoLivre } from './geradorNexusBase';
import { mountNexusRede } from './geradorNexusRede';
import { mountNexusEquipe } from './geradorNexusEquipe';
import { mountNexusConvite } from './geradorNexusConvite';
import { mountNexusAdm } from './geradorNexusAdm';

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
  const local = separarCidadeUf(((company?.cidade ? String(company.cidade).trim().slice(0, 80) : '') || lead?.cidade || null), null);
  const linha = {
    user_id: userId,
    empresa: nomeEmpresa,
    cnpj,
    cnpj_situacao: situacao,
    cidade: local.cidade,
    uf: local.uf,
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

const TIPOS_SOLICITACAO = ['conversa', 'engenharia', 'negociar_preco', 'plataforma'] as const;
type TipoSolicitacao = (typeof TIPOS_SOLICITACAO)[number];
const LIMITE_DADOS_SOLICITACAO = 20 * 1024;
const TIPOS_PEDIDO = ['equipamento', 'engenharia', 'consultoria', 'manutencao'] as const;
type TipoPedido = (typeof TIPOS_PEDIDO)[number];

/** Linha de resumo da engenharia para o aviso: serviço e local, sem o resto do que o parceiro escreveu. */
function resumoDaEngenharia(dados: Record<string, unknown>): string {
  // O portal manda servico_nome (texto) e servico (código do select); o nome vence, o código é reserva.
  const servico = textoLivre(dados.servico_nome, 60) ?? textoLivre(dados.servico, 60) ?? '';
  const lugar = cidadeUf(textoLivre(dados.cidade, 60), textoLivre(dados.uf, 2));
  return [servico, lugar ? `em ${lugar}` : ''].filter(Boolean).join(' ');
}

// ── Link público da proposta ─────────────────────────────────────────────────

export const URL_LINK_PROPOSTA = 'https://solardoc.app/nexus/p/';
/** Duas aberturas dentro desta janela contam como uma: reload da página e o próprio parceiro conferindo não inflam o número. */
export const JANELA_ABERTURA_MS = 10 * 60 * 1000;
const TOKEN_DO_LINK = /^[A-Za-z0-9_-]{32}$/;

const urlDoLink = (token: string) => `${URL_LINK_PROPOSTA}?t=${token}`;
/** 24 bytes aleatórios em base64url = 32 caracteres. */
const novoToken = () => crypto.randomBytes(24).toString('base64url');

const COLUNAS_LISTA_PROPOSTA =
  'id, numero, cliente_nome, cliente_cidade, cliente_uf, modelo, quantidade, valor_total, saida_ultima, created_at, link_token, aberturas, primeira_abertura_em, ultima_abertura_em';

/**
 * Conta uma abertura do link: só se a última foi há mais de 10 min (reload e conferência do próprio parceiro não contam).
 * A escrita leva a guarda `.eq('aberturas', n)`: dois acessos simultâneos não somam em dobro. Nunca lança: o cliente final
 * tem que ver a proposta mesmo que a contagem falhe.
 */
export async function contarAbertura(p: Linha): Promise<void> {
  try {
    const ultima = p.ultima_abertura_em ? Date.parse(String(p.ultima_abertura_em)) : NaN;
    if (Number.isFinite(ultima) && Date.now() - ultima < JANELA_ABERTURA_MS) return;
    const agora = new Date().toISOString();
    const n = Number(p.aberturas) || 0;
    const { error } = await supabase
      .from('nexus_propostas')
      .update({ aberturas: n + 1, ultima_abertura_em: agora, primeira_abertura_em: p.primeira_abertura_em ?? agora })
      .eq('id', p.id)
      .eq('aberturas', n);
    if (error) logger.warn('nexus', 'contagem de abertura do link falhou', error);
  } catch (e) {
    logger.warn('nexus', 'contagem de abertura do link falhou', e);
  }
}

const CHAVE_PESSOAL = /(cpf|cnpj|documento|telefone|celular|phone|whats|mail)|^(doc|rg|fone|zap)$|doc$/;
/** Subárvores que são da EMPRESA do parceiro (não do cliente final): seus dados continuam no documento. */
const CHAVE_DO_PARCEIRO = /^(empresa|parceiro|emitente|distribuidor|distribuidora)$/;

/**
 * Tira de `dados` (em qualquer nível) documento, telefone e e-mail: o link público é aberto pelo cliente final e por
 * quem receber o link. Nome, cidade, UF e tipo de local ficam. Subárvores da empresa do parceiro não são tocadas.
 */
export function semDadoPessoal(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(semDadoPessoal);
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const chave = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (CHAVE_DO_PARCEIRO.test(chave)) { out[k] = val; continue; }
    if (CHAVE_PESSOAL.test(chave)) continue;
    out[k] = semDadoPessoal(val);
  }
  return out;
}

// ── Rotas ────────────────────────────────────────────────────────────────────

export function mountNexus(router: Router): void {
  const parceiro = [authMiddleware, exigePortalLigado];
  // Pedidos e solicitações avisam o comercial (WhatsApp e e-mail): teto por USUÁRIO de 10 por hora, somando as duas rotas.
  // A chave é o usuário já autenticado (o escritório divide o IP). Nasce aqui, por montagem, como o limite do link público.
  const limitePedidos = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => 'nexus-pedido:' + String((req as unknown as { userId?: string }).userId ?? 'sem-usuario'),
    message: { erro: 'muitas_tentativas' },
    standardHeaders: true,
    legacyHeaders: false,
  });

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

  // Proposta pelo link do cliente final. O limite é por IP e nasce AQUI (instância nova por montagem), não em middleware/.
  const limiteLink = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { erro: 'muitas_requisicoes' } });
  router.get('/nexus/p/:token', limiteLink, exigePortalLigado, rota('GET /nexus/p/:token', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const token = String(req.params.token);
    if (!TOKEN_DO_LINK.test(token)) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    const r = ok(
      await supabase
        .from('nexus_propostas')
        .select('id, user_id, numero, cliente_nome, cliente_cidade, cliente_uf, tipo_local, modelo, quantidade, valor_total, dados, created_at, aberturas, primeira_abertura_em, ultima_abertura_em')
        .eq('link_token', token)
        .limit(1),
      'leitura da proposta pelo link',
    );
    const p = ((r.data as Linha[] | null) ?? [])[0];
    if (!p) { res.status(404).json({ erro: 'nao_encontrada' }); return; }

    const [parceiro, company] = await Promise.all([lerParceiro(String(p.user_id)), lerCompany(String(p.user_id))]);
    // Parceiro descartado pela equipe: o link para de abrir (mesma resposta de token inexistente) e a abertura não é contada.
    if (parceiro?.status === 'descartado') { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    await contarAbertura(p);

    // Lista branca: nada de user_id, id, nota da equipe, status de pedido nem contagem de abertura.
    res.json({
      proposta: {
        numero: p.numero, cliente_nome: p.cliente_nome, cliente_cidade: p.cliente_cidade, cliente_uf: p.cliente_uf,
        tipo_local: p.tipo_local, modelo: p.modelo, quantidade: p.quantidade, valor_total: p.valor_total,
        dados: semDadoPessoal(p.dados), created_at: p.created_at,
      },
      parceiro: {
        empresa: parceiro?.empresa || company?.nome_fantasia || company?.nome || null,
        cidade: parceiro?.cidade || company?.cidade || null,
        uf: parceiro?.uf ?? null,
        whatsapp: company?.whatsapp ?? null,
        logo_base64: company?.logo_base64 ?? null,
      },
      catalogo: catalogoParaFront(),
      entrega: ENTREGA,
      financiamento: { ...FINANCIAMENTO },
    });
  }));

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
        .select(COLUNAS_LISTA_PROPOSTA)
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

  // Cria o link UMA vez: chamadas seguintes devolvem o mesmo token.
  router.post('/nexus/propostas/:id/link', ...parceiro, rota('POST /nexus/propostas/:id/link', async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    const ler = async () => {
      const r = ok(await supabase.from('nexus_propostas').select('id, link_token').eq('id', id).eq('user_id', req.userId).limit(1), 'leitura da proposta do link');
      return ((r.data as Linha[] | null) ?? [])[0];
    };
    const linha = await ler();
    if (!linha) { res.status(404).json({ erro: 'nao_encontrada' }); return; }
    // Dono da proposta E etapa liberada: o link é do Orçamento Completo (libera.completo, mesmo gate de criar a proposta).
    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    if (!c.libera.completo) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }
    if (linha.link_token) { res.json({ token: linha.link_token, url: urlDoLink(String(linha.link_token)) }); return; }

    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const token = novoToken();
      const agora = new Date().toISOString();
      const up = await supabase
        .from('nexus_propostas')
        .update({ link_token: token, link_criado_em: agora, updated_at: agora })
        .eq('id', id)
        .eq('user_id', req.userId)
        .is('link_token', null)
        .select('link_token');
      if (up.error) {
        if ((up.error as { code?: string }).code === '23505') continue; // token repetido (praticamente impossível): sorteia outro
        throw new ErroBanco(up.error, 'criação do link da proposta');
      }
      if (((up.data as Linha[] | null) ?? [])[0]) { res.status(201).json({ token, url: urlDoLink(token) }); return; }
      // Nada atualizado: outra chamada criou o link entre a leitura e a escrita. Devolve o que ficou.
      const outra = await ler();
      if (outra?.link_token) { res.json({ token: outra.link_token, url: urlDoLink(String(outra.link_token)) }); return; }
    }
    res.status(500).json({ erro: 'erro_interno' });
  }));

  // ── Parceiro: pedidos por tipo ─────────────────────────────────────────────
  //   equipamento (padrão, o front v2 não manda tipo)  libera.pedido (Partner em diante)
  //   engenharia  {pacote: 1|3|5}                       pacote 1: libera.basico (perfil completo); 3 e 5: libera.pacotes_engenharia (Partner)
  //   consultoria {obs}  (na tela: Apoio de venda)      libera.consultoria (Partner em diante)
  //   manutencao  {quantidade: 1..50, obs}              libera.manutencao (Pro em diante)
  // Insert que bate no CHECK do banco (23514) = a seção v5 da MIGRATION ainda não rodou: 503 servico_em_ativacao.
  router.post('/nexus/pedidos', ...parceiro, limitePedidos, rota('POST /nexus/pedidos', async (req, res) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const tipo = (b.tipo == null || b.tipo === '' ? 'equipamento' : String(b.tipo)) as TipoPedido;
    if (!(TIPOS_PEDIDO as readonly string[]).includes(tipo)) { res.status(400).json({ erro: 'tipo_invalido' }); return; }

    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    // O pacote é validado ANTES do gate: o gate do pacote de 1 projeto (perfil completo) difere do de 3 e 5 (Partner).
    const pacote = tipo === 'engenharia' ? Number(b.pacote) : null;
    if (tipo === 'engenharia' && !(PACOTES_ENGENHARIA as readonly number[]).includes(pacote as number)) { res.status(400).json({ erro: 'pacote_invalido' }); return; }
    const liberado = tipo === 'equipamento' ? c.libera.pedido
      : tipo === 'engenharia' ? liberaEngenharia(pacote as number, c.libera)
      : tipo === 'manutencao' ? c.libera.manutencao
      : c.libera.consultoria;
    if (!liberado) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }

    const obs = textoLivre(b.obs, 300);
    const agora = new Date().toISOString();
    let linha: Record<string, unknown>;
    let aviso: NonNullable<Parameters<typeof avisarComercial>[1]['pedido']>;
    let proposta: Linha | null = null;

    if (tipo === 'equipamento') {
      const produto = PRODUTOS.find((p) => p.id === b.modelo);
      if (!produto) { res.status(400).json({ erro: 'modelo_invalido' }); return; }
      const quantidade = Number(b.quantidade);
      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) { res.status(400).json({ erro: 'quantidade_invalida' }); return; }

      // A proposta ligada tem que ser do próprio parceiro; é dela que vêm o número e o valor do aviso.
      if (b.proposta_id != null && b.proposta_id !== '') {
        const pid = String(b.proposta_id);
        if (!UUID.test(pid)) { res.status(404).json({ erro: 'proposta_nao_encontrada' }); return; }
        const r = ok(await supabase.from('nexus_propostas').select('id, numero, valor_total').eq('id', pid).eq('user_id', req.userId).limit(1), 'leitura da proposta do pedido');
        proposta = ((r.data as Linha[] | null) ?? [])[0] ?? null;
        if (!proposta) { res.status(404).json({ erro: 'proposta_nao_encontrada' }); return; }
      }
      linha = { tipo, proposta_id: proposta?.id ?? null, modelo: produto.id, quantidade, pacote: null };
      aviso = { id: '', tipo, modelo: produto.nome, quantidade, numero: proposta?.numero ?? null, valor_total: proposta ? Number(proposta.valor_total) : null };
    } else if (tipo === 'engenharia') {
      linha = { tipo, proposta_id: null, modelo: null, quantidade: null, pacote };
      aviso = { id: '', tipo, pacote };
    } else if (tipo === 'manutencao') {
      const quantidade = Number(b.quantidade);
      if (!Number.isInteger(quantidade) || quantidade < MANUTENCAO_MIN || quantidade > MANUTENCAO_MAX) { res.status(400).json({ erro: 'quantidade_invalida' }); return; }
      linha = { tipo, proposta_id: null, modelo: null, quantidade, pacote: null };
      aviso = { id: '', tipo, quantidade };
    } else {
      linha = { tipo, proposta_id: null, modelo: null, quantidade: null, pacote: null };
      aviso = { id: '', tipo };
    }

    const ins = await supabase
      .from('nexus_pedidos')
      .insert({ user_id: req.userId, ...linha, status: 'solicitado', obs, created_at: agora, updated_at: agora })
      .select('id')
      .single();
    if (ins.error) {
      // 23514 = check_violation: o CHECK de tipo/pacote do banco ainda é o antigo (seção v5 da MIGRATION por rodar). Sem aviso.
      if ((ins.error as { code?: string }).code === '23514') {
        logger.warn('nexus', 'pedido barrado pelo CHECK do banco: falta rodar a seção v5 da MIGRATION_nexus_portal.sql', ins.error);
        res.status(503).json({ erro: 'servico_em_ativacao' });
        return;
      }
      throw new ErroBanco(ins.error, 'gravação do pedido');
    }
    const id = String((ins.data as Linha).id);

    await avisarComercial('pedido', { parceiro: c.parceiro as never, whatsapp: c.company?.whatsapp ?? null, pedido: { ...aviso, id }, obs });
    res.status(201).json({ id, tipo });
  }));

  router.get('/nexus/pedidos', ...parceiro, rota('GET /nexus/pedidos', async (req, res) => {
    const r = ok(
      await supabase
        .from('nexus_pedidos')
        .select('id, tipo, pacote, proposta_id, modelo, quantidade, status, valor_negociado, obs, confirmado_em, created_at')
        .eq('user_id', req.userId)
        .order('created_at', { ascending: false })
        .limit(200),
      'lista de pedidos',
    );
    res.json({ pedidos: (r.data as Linha[] | null) ?? [] });
  }));

  // ── Parceiro: solicitações (conversa, engenharia, negociar preço) ──────────
  router.post('/nexus/solicitacoes', ...parceiro, limitePedidos, rota('POST /nexus/solicitacoes', async (req, res) => {
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const tipo = b.tipo as TipoSolicitacao;
    if (!TIPOS_SOLICITACAO.includes(tipo)) { res.status(400).json({ erro: 'tipo_invalido' }); return; }
    const dados = b.dados == null ? {} : b.dados;
    if (typeof dados !== 'object' || Array.isArray(dados)) { res.status(400).json({ erro: 'dados_invalidos' }); return; }
    if (Buffer.byteLength(JSON.stringify(dados), 'utf8') > LIMITE_DADOS_SOLICITACAO) { res.status(400).json({ erro: 'dados_grandes_demais' }); return; }

    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    const liberado = tipo === 'conversa' ? c.libera.conversa
      : tipo === 'engenharia' ? c.libera.engenharia
      : tipo === 'plataforma' ? c.libera.plataforma
      : c.libera.negociar;
    if (!liberado) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }

    // Engenharia com usa_pacote consome 1 projeto do saldo. Só o booleano true vale; o que gravamos é sempre booleano.
    const usaPacote = tipo === 'engenharia' && (dados as Record<string, unknown>).usa_pacote === true;
    if (tipo === 'engenharia') (dados as Record<string, unknown>).usa_pacote = usaPacote;
    const agora = new Date().toISOString();
    // Engenharia que usa o pacote: uma função do banco trava por parceiro, confere o saldo e insere na mesma transação.
    // Sem corrida e sem solicitação cancelada de sobra. O aviso e o e-mail só saem depois do ok.
    let idSolicitacao: string;
    if (usaPacote) {
      const uso = await usarPacote(req.userId, dados as Record<string, unknown>);
      if (!uso.ok) { res.status(409).json({ erro: 'sem_saldo' }); return; }
      idSolicitacao = uso.id;
    } else {
      const ins = await supabase
        .from('nexus_solicitacoes')
        .insert({ user_id: req.userId, tipo, dados, status: 'aberta', created_at: agora, updated_at: agora })
        .select('id')
        .single();
      if (ins.error) throw new ErroBanco(ins.error, 'gravação da solicitação');
      idSolicitacao = String((ins.data as Linha).id);
    }

    if (tipo === 'conversa') {
      const { error } = await supabase.from('nexus_parceiros').update({ conversa_pedida_em: agora, updated_at: agora }).eq('id', c.parceiro.id);
      if (error) throw new ErroBanco(error, 'pedido de conversa');
    }
    const d = dados as Record<string, unknown>;
    await avisarComercial('solicitacao', {
      parceiro: c.parceiro as never,
      whatsapp: c.company?.whatsapp ?? null,
      solicitacao: { tipo, resumo: tipo === 'engenharia' ? resumoDaEngenharia(d) : null, usa_pacote: usaPacote },
      obs: textoLivre(d.obs, 300),
    });
    res.status(201).json({ id: idSolicitacao });
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

  // ── Parceiro: Termo de Parceria (libera.termo = Pro em diante) ─────────────
  router.post('/nexus/termo/aceitar', ...parceiro, rota('POST /nexus/termo/aceitar', async (req, res) => {
    const c = await contexto(req.userId);
    if (!c) { res.status(409).json({ erro: 'sem_parceiro' }); return; }
    if (!c.libera.termo) { res.status(403).json({ erro: 'etapa_bloqueada' }); return; }
    const versao = String(req.body?.versao ?? '').trim();
    if (versao !== TERMO_VERSAO) { res.status(400).json({ erro: 'versao_invalida' }); return; }

    // Aceitar de novo não regrava a data nem avisa outra vez.
    if (c.parceiro.termo_versao === versao && c.parceiro.termo_aceito_em) {
      res.json({ ok: true, versao, aceito_em: c.parceiro.termo_aceito_em });
      return;
    }
    const agora = new Date().toISOString();
    const up = await supabase.from('nexus_parceiros').update({ termo_versao: versao, termo_aceito_em: agora, updated_at: agora }).eq('id', c.parceiro.id);
    if (up.error) throw new ErroBanco(up.error, 'aceite do termo');
    await avisarComercial('termo', { parceiro: c.parceiro as never, whatsapp: c.company?.whatsapp ?? null, termo: { versao } });
    res.json({ ok: true, versao, aceito_em: agora });
  }));

  mountNexusRede(router);
  mountNexusEquipe(router);
  mountNexusConvite(router);
  mountNexusAdm(router);
}
