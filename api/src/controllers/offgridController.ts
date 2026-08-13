import { Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../utils/supabase';
import { ApiError } from '../utils/apiError';
import { sendOpsAlert } from '../utils/mailer';
import { logger } from '../utils/logger';
import { orcar, TABELA_VERSAO } from '../services/offgrid/precario';
import { calcularFrete, cidadeDoCep, CIDADE_ORIGEM } from '../services/offgrid/frete';
import {
  acessoOffGrid, consumirCreditoOffGrid, OFFGRID_ADDON_PRECO,
} from '../services/offgrid/acesso';

/**
 * Pedido de kit off-grid: o integrador fecha o orçamento na tela e manda a
 * lista pra nós, que somos o fornecedor. O pedido guarda o SNAPSHOT de preço
 * (itens + frete + versão da tabela) — quando a tabela mudar, o pedido antigo
 * continua provando o que foi cotado no dia.
 */

const itemSchema = z.object({
  nome: z.string().min(1),
  qtd: z.number(),
  unitario: z.number(),
  total: z.number(),
  kg: z.number().optional(),
  garantia: z.number().optional(),
});

const orcarSchema = z.object({
  itens: z.array(z.object({ id: z.string().min(1), nome: z.string().min(1), qtd: z.number() })).max(40),
  /** CEP da OBRA. O frete sai daqui, de Uberlândia até lá. */
  cep: z.string().max(12).optional(),
  uf: z.string().max(2).optional(),
  peso_kg: z.number(),
  margem_pct: z.number(),
  mao_de_obra: z.number(),
  extras: z.number(),
  banco_kwh: z.number(),
});

/**
 * POST /offgrid/orcar — o dinheiro do kit.
 *
 * O dimensionamento roda no navegador e é aberto pra todo mundo; o PREÇO sai
 * daqui e só pra quem comprou o add-on. É o que faz o cadeado ser cadeado: sem
 * acesso, o número não chega ao browser nem escondido no bundle.
 */
export async function orcarOffGrid(req: Request, res: Response): Promise<void> {
  try {
    const body = orcarSchema.parse(req.body);
    const acesso = await acessoOffGrid(req.userId);

    if (!acesso.liberado) {
      res.status(402).json({
        trancado: true,
        preco_addon: OFFGRID_ADDON_PRECO,
        tabela_versao: TABELA_VERSAO,
        motivo: 'O orçamento do kit faz parte do acesso ao Kit Off-Grid.',
      });
      return;
    }

    // Frete pelo CEP da obra. Sem CEP não tem frete — e o orçamento diz isso em
    // vez de inventar um número que vira prejuízo na hora de despachar.
    const temLitio = body.itens.some((i) => i.id.startsWith('bat-'));
    let frete = { valor: 0, regiao: '', prazo: '', detalhe: '' };
    let freteInfo: ReturnType<typeof calcularFrete> | null = null;

    if (body.cep) {
      const local = await cidadeDoCep(body.cep);
      freteInfo = calcularFrete({
        cep: body.cep,
        pesoKg: body.peso_kg,
        temLitio,
        cidade: local?.cidade,
      });
      if (freteInfo.ok) {
        frete = {
          valor: freteInfo.valor,
          regiao: freteInfo.cidade ? `${freteInfo.cidade}/${freteInfo.uf}` : freteInfo.ufNome,
          prazo: freteInfo.prazo,
          detalhe: freteInfo.detalhe,
        };
      }
    }

    const orc = orcar({
      itens: body.itens,
      pesoKg: body.peso_kg,
      margemPct: body.margem_pct,
      maoDeObra: body.mao_de_obra,
      extras: body.extras,
      bancoKwh: body.banco_kwh,
      frete,
    });
    res.json({
      trancado: false,
      credito_pedido: acesso.creditoPedido,
      origem_frete: CIDADE_ORIGEM,
      frete_ok: !!freteInfo?.ok,
      frete_erro: freteInfo && !freteInfo.ok ? freteInfo.erro : null,
      frete_km: freteInfo?.km ?? 0,
      ...orc,
    });
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Dados do kit inválidos' }); return; }
    logger.error('offgrid', 'erro ao orçar', err);
    res.status(500).json({ error: 'Erro ao calcular o orçamento' });
  }
}

const pedidoSchema = z.object({
  cliente_nome: z.string().max(160).nullable().optional(),
  cidade: z.string().max(120).nullable().optional(),
  uf: z.string().max(2),
  observacao: z.string().max(600).nullable().optional(),
  resumo: z.record(z.string(), z.unknown()),
  itens: z.array(itemSchema).min(1),
  peso_kg: z.number(),
  frete: z.number(),
  custo_fornecimento: z.number(),
  tabela_versao: z.string().max(20),
});

export async function criarPedidoOffGrid(req: Request, res: Response): Promise<void> {
  try {
    const body = pedidoSchema.parse(req.body);

    const { data: user } = await supabase
      .from('users').select('email, nome, plano, is_admin').eq('id', req.userId).single();

    // Quem pede kit é quem tem o add-on — não é degrau de assinatura. O gate
    // visual está na tela, mas o endpoint precisa garantir: um POST direto não
    // pode pular o acesso.
    const acesso = await acessoOffGrid(req.userId);
    if (!acesso.liberado) {
      throw new ApiError(402, `O pedido de kit faz parte do acesso ao Kit Off-Grid (R$ ${OFFGRID_ADDON_PRECO}).`);
    }

    const { data: company } = await supabase
      .from('company').select('nome, nome_fantasia, cnpj, whatsapp, cidade, uf')
      .eq('user_id', req.userId).single();

    const { data: pedido, error } = await supabase
      .from('offgrid_pedidos')
      .insert({
        user_id: req.userId,
        cliente_nome: body.cliente_nome || null,
        cidade: body.cidade || null,
        uf: body.uf.toUpperCase(),
        observacao: body.observacao || null,
        resumo: body.resumo,
        itens: body.itens,
        peso_kg: body.peso_kg,
        frete: body.frete,
        custo_fornecimento: body.custo_fornecimento,
        tabela_versao: body.tabela_versao,
        status: 'novo',
      })
      .select('id')
      .single();

    if (error) throw new ApiError(500, 'Não foi possível registrar o pedido');

    // Crédito do add-on: o pedido NÃO é uma transação nossa (a cobrança do kit
    // acontece fora da plataforma), então o crédito vai como recado no aviso e
    // some do usuário — o abatimento é feito na hora de faturar.
    const credito = acesso.creditoPedido;
    if (credito > 0) await consumirCreditoOffGrid(req.userId!);

    // Aviso pra operação. Fail-silent: e-mail que não sai não pode derrubar um
    // pedido que já está gravado no banco.
    const empresa = company?.nome_fantasia || company?.nome || user?.nome || user?.email || 'integrador';
    const r = body.resumo as Record<string, unknown>;
    const brl = (v: number) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
    sendOpsAlert(
      `Pedido de kit off-grid — ${empresa}`,
      `<p><strong>${empresa}</strong>${company?.cnpj ? ` (CNPJ ${company.cnpj})` : ''}${
        company?.whatsapp ? ` · ${company.whatsapp}` : ''
      }${user?.email ? ` · ${user.email}` : ''}</p>
      <p>Obra: <strong>${body.cliente_nome || 'sem nome'}</strong> — ${body.cidade || ''} ${body.uf.toUpperCase()}</p>
      <ul>
        <li>Arranjo: ${r.kwp} kWp (${r.modulos} módulos)</li>
        <li>Banco: ${r.banco_kwh} kWh — ${r.baterias}</li>
        <li>Inversor: ${r.inversor} (${r.tensao}V)</li>
        <li>Autonomia pedida: ${r.autonomia_dias} dia(s) sobre ${r.autonomia_sobre}</li>
        <li>Consumo: ${r.consumo_dia} kWh/dia (essencial ${r.essencial_dia} kWh/dia)</li>
      </ul>
      <p><strong>Fornecimento ${brl(body.custo_fornecimento - body.frete)} + frete ${brl(body.frete)} (${body.peso_kg} kg) = ${brl(body.custo_fornecimento)}</strong> · tabela ${body.tabela_versao}</p>
      ${credito > 0 ? `<p><strong>ABATER R$ ${credito} deste pedido</strong> — crédito do acesso que este integrador comprou. É o primeiro pedido dele.</p>` : ''}
      ${body.observacao ? `<p>Observação: ${body.observacao}</p>` : ''}
      <p>Pedido #${pedido.id}</p>`
    ).catch((e) => logger.error('offgrid', 'falha no aviso de pedido', e));

    res.status(201).json({ ok: true, pedido_id: pedido.id });
  } catch (err) {
    if (err instanceof ApiError) { res.status(err.statusCode).json({ error: err.message }); return; }
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Pedido inválido' }); return; }
    logger.error('offgrid', 'erro ao criar pedido', err);
    res.status(500).json({ error: 'Erro ao registrar o pedido' });
  }
}

/** Pedidos do próprio integrador — histórico na tela dele. */
export async function listarPedidosOffGrid(req: Request, res: Response): Promise<void> {
  const { data } = await supabase
    .from('offgrid_pedidos')
    .select('id, criado_em, status, cliente_nome, cidade, uf, custo_fornecimento, resumo')
    .eq('user_id', req.userId)
    .order('criado_em', { ascending: false })
    .limit(30);
  res.json({ pedidos: data || [] });
}
