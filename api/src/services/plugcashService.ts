import crypto from 'crypto';
import { supabase } from '../utils/supabase';
import { supabaseGerador } from '../utils/supabaseGerador';
import { sendOpsAlert, sendPlugcashAcessoEmail } from '../utils/mailer';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// PLUGCASH — provisionamento a partir da venda.
//
// O caminho inteiro: lead NOTA 1 é recusado na agenda → compra o produto de
// entrada → este arquivo cria a conta, libera o curso, copia a qualificação que
// veio da régua do eletroposto e manda o e-mail de acesso. É a única porta entre
// "pagou" e "está dentro".
//
// Três coisas que este arquivo se recusa a fazer, e o motivo:
//
// 1. NÃO decide por nome de produto escrito no código. O mapeamento
//    produto-do-gateway → item do PlugCash mora em `pc_gateway_produtos`,
//    editável pelo /admin. Renomear o produto na Kiwify não pode arrancar o
//    acesso de quem paga.
// 2. NÃO libera acesso em pedido que não está pago. Pix aguardando é registro.
// 3. NÃO manda o e-mail de acesso duas vezes. O gate é o carimbo
//    `acesso_email_em`, não "o pedido é novo" — no Pix a Kiwify entrega dois
//    webhooks e, quando o pago chega, o pedido já existe.
// ─────────────────────────────────────────────────────────────────────────────

const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

export type EventoPlugcash = {
  orderId: string | null;
  email: string;
  nome: string | null;
  telefone: string | null;
  // 'paid' | 'refunded' | 'chargeback' | 'waiting_payment' | ... e null quando a
  // Kiwify manda um evento sem status reconhecível — que NÃO pode virar 'paid'.
  status: string | null;
  produtoId: string | null;
  produtoNome: string | null;
  valorCentavos: number | null;
  checkoutLink: string | null;
  utm: Record<string, string | null>;
  payload: unknown;
  /**
   * Atalho do Stripe: lá o item vendido vai no metadata da sessão, então não há
   * nome de produto pra casar. Quando vem preenchido, pula
   * `classificarProdutoPlugcash` — que só conhece a Kiwify.
   */
  itemDireto?: { item_tipo: string; item_slug: string; concede_nivel?: string | null; gera_credito?: boolean };
  /**
   * Quem cobrou. Só precisa vir quando NÃO é Kiwify nem Stripe — hoje, o Asaas
   * (link de pagamento com Pix). Entra no `gateway_ref`, então errar aqui é
   * abrir a porta pra mesma venda ser gravada duas vezes por gateways diferentes.
   */
  gateway?: string;
};

export type ResultadoPlugcash = {
  ok: boolean;
  acao: 'liberado' | 'registrado' | 'revogado' | 'ignorado';
  detalhe: string;
};

// ── Telefone na forma canônica ──────────────────────────────────────────────
// DDD (2) + os 8 últimos dígitos. Espelha public.ep_tel_norm() no banco do
// gerador. Ver comentário em routes/plugcash.ts: casar pelos últimos 10 comeria
// o primeiro dígito do DDD.
export function telNorm(t?: string | null): string | null {
  const d = String(t || '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) {
    const local = d.slice(2);
    return local.slice(0, 2) + local.slice(-8);
  }
  if (d.length === 10 || d.length === 11) return d.slice(0, 2) + d.slice(-8);
  return null;
}

// ── A oferta de entrada já está vendável? ───────────────────────────────────
// FONTE ÚNICA da decisão "grupo de WhatsApp ou página de venda". Três caminhos
// perguntam isso e precisam responder igual:
//   · POST /io/eletroposto/nota1        — o envio imediato do convite
//   · runConviteNota1Garantido()        — o tick que varre quem ficou sem convite
//   · /io/eletroposto/material          — a própria página, via /plugcash/curso
//
// Se divergirem, o pior caso é silencioso e caro: a página cobra R$ 197 e o tick
// entrega o mesmo conteúdo de graça no WhatsApp dez minutos depois.
//
// Vendável = curso publicado E com link de checkout. Publicar sem link é meio
// caminho, e meio caminho aqui é um botão que não compra nada.
export async function ofertaDeEntradaVendavel(): Promise<boolean> {
  // Sobrescrita manual, se um dia for preciso passar por cima do catálogo:
  //   EP_NOTA1_CONVITE_GRUPO=1 → grupo LIGADO  (finge que não há oferta)
  //   EP_NOTA1_CONVITE_GRUPO=0 → grupo DESLIGADO (finge que há)
  const forcado = (process.env.EP_NOTA1_CONVITE_GRUPO || '').trim();
  if (forcado === '1') return false;
  if (forcado === '0') return true;
  try {
    const { data } = await supabase
      .from('pc_cursos').select('status,checkout_url').eq('slug', 'fundamentos').maybeSingle();
    return (data as any)?.status === 'publicado' && !!(data as any)?.checkout_url;
  } catch (err) {
    // Banco fora do ar: responde "não vendável" → o grupo continua. O erro caro é
    // mandar o lead pra uma página muda, não é mandar um convite a mais.
    logger.error('plugcash', 'nao consegui checar a oferta de entrada', err);
    return false;
  }
}

// ── De que item do PlugCash é este pedido? ──────────────────────────────────
// Casa primeiro por ID (estável) e só depois por nome (que o operador pode
// renomear). Produto que não está cadastrado devolve null — e null aqui
// significa "não é nosso", não "erro": o mesmo webhook da Kiwify recebe venda
// do LimpaPro e do Kit, e cada um só trata o que é seu.
export async function classificarProdutoPlugcash(
  produtoNome: string | null,
  produtoId: string | null,
) {
  const { data } = await supabase
    .from('pc_gateway_produtos')
    .select('*')
    .eq('gateway', 'kiwify')
    .eq('ativo', true);

  const lista = (data || []) as any[];
  if (produtoId) {
    const porId = lista.find((p) => p.produto_id && p.produto_id === produtoId);
    if (porId) return porId;
  }
  if (produtoNome) {
    const alvo = produtoNome.trim().toLowerCase();
    const porNome = lista.find((p) => (p.produto_nome || '').trim().toLowerCase() === alvo);
    if (porNome) return porNome;
  }
  return null;
}

// ── Isto parece ser nosso, mas não está mapeado? ────────────────────────────
// A rede de segurança do webhook. Se um pedido PAGO tem nome de produto igual ao
// de um curso ou serviço do catálogo e mesmo assim `classificarProdutoPlugcash`
// devolveu null, o mapeamento está quebrado: o dinheiro entrou e o comprador vai
// ficar sem acesso.
//
// Antes isso era uma regex de palavras (eletroposto|plugcash|ponto zero|…) e ela
// pegava 3 dos 20 títulos. "Capital", "Equipamento", "Dossiê do Sócio" e
// "Operação e precificação" passavam batido — justamente os nomes genéricos, que
// são os mais fáceis de alguém digitar diferente na Kiwify. Comparar com o
// catálogo cobre renomeação e produto novo sem ninguém manter lista de palavras.
export async function pareceProdutoDoPlugcash(produtoNome: string | null): Promise<boolean> {
  const alvo = (produtoNome || '').trim().toLowerCase();
  if (!alvo) return false;
  try {
    const [{ data: cursos }, { data: servicos }] = await Promise.all([
      supabase.from('pc_cursos').select('titulo'),
      supabase.from('pc_servicos').select('titulo'),
    ]);
    return [...(cursos || []), ...(servicos || [])]
      .some((r: any) => (r.titulo || '').trim().toLowerCase() === alvo);
  } catch {
    // Na dúvida não grita: alerta falso toda hora ensina a ignorar alerta.
    return false;
  }
}

// ── Conta ───────────────────────────────────────────────────────────────────
// Mesmo padrão do Kit de Fechamento: conta PENDENTE (sem senha) com token de
// definição, ou vínculo com a conta que já existe. Nunca mexe em plano nem em
// senha de quem já é usuário do SolarDoc — é a mesma tabela `users`.
async function garantirConta(opts: {
  email: string;
  nome: string | null;
  telefone: string | null;
  utm: Record<string, string | null>;
}): Promise<{ userId: string | null; contaCriada: boolean; acessoUrl: string }> {
  const email = opts.email.toLowerCase().trim();

  const { data: existente } = await supabase
    .from('users').select('id').eq('email', email).maybeSingle();

  if ((existente as any)?.id) {
    return { userId: (existente as any).id, contaCriada: false, acessoUrl: `${DASHBOARD_URL}/plugcash/entrar` };
  }

  const token = crypto.randomBytes(32).toString('hex');
  // 90 dias, nao 7. O comprador que abre o e-mail duas semanas depois — e ele
  // existe — ficaria com link morto e sem caminho de entrada nenhum. O token so
  // define senha de conta que nasceu SEM senha, entao esticar o prazo nao abre
  // porta em conta existente.
  const expira = new Date(Date.now() + 90 * 86400_000).toISOString();
  const attr: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = opts.utm[k];
    if (typeof v === 'string' && v.trim()) attr[k] = v.trim();
  }

  const { data: criado, error } = await supabase
    .from('users')
    .insert({
      email,
      password_hash: null,          // conta PENDENTE — ativa quando definir a senha
      nome: opts.nome,
      plano: 'free',
      limite_documentos: 10,
      documentos_usados: 0,
      whatsapp: (opts.telefone || '').replace(/\D/g, '') || null,
      billing_status: 'active',
      reset_token: token,
      reset_token_expires: expira,
      utm_source: attr.utm_source || 'kiwify',
      utm_medium: attr.utm_medium || 'plugcash',
      ...attr,
      // Marcador durável: utm_source acima é sobrescrito quando a pessoa vem de
      // anúncio, e aí sumiria justo o rastro de quem entrou pelo PlugCash.
      origem_aquisicao: 'plugcash',
    })
    .select('id')
    .single();

  if (error || !criado) {
    // Corrida com outro webhook do mesmo comprador (bump e produto principal
    // chegam quase juntos): a conta pode ter nascido no meio do caminho.
    const { data: agora } = await supabase
      .from('users').select('id').eq('email', email).maybeSingle();
    if (!(agora as any)?.id) {
      logger.error('plugcash', `nao consegui criar conta de ${email}`, error);
      return { userId: null, contaCriada: false, acessoUrl: `${DASHBOARD_URL}/plugcash/entrar` };
    }
    return { userId: (agora as any).id, contaCriada: false, acessoUrl: `${DASHBOARD_URL}/plugcash/entrar` };
  }

  return {
    userId: (criado as any).id,
    contaCriada: true,
    acessoUrl: `${DASHBOARD_URL}/auth?mode=redefinir&token=${token}`,
  };
}

// ── Snapshot da qualificação ────────────────────────────────────────────────
// Copia a régua do eletroposto pro membro. É a única travessia entre os dois
// projetos Supabase, e ela acontece uma vez — sem isto o bloco "seu próximo
// passo" nunca sai do texto genérico, porque é `motivo_descarte` que o decide.
export async function snapshotQualificacao(telefone: string | null) {
  const norm = telNorm(telefone);
  if (!norm) return null;
  const campos = 'nota,motivo_descarte,tem_ponto,capital_faixa,e_decisor,perfil_slug,cidade,utm_source,utm_medium,utm_campaign,utm_content,utm_term';
  try {
    // NOTA 1 primeiro: é o público do PlugCash. Quem agendou só cai no
    // `agendamentos` como plano B.
    const { data: n1 } = await supabaseGerador
      .from('eletroposto_nota1').select(`id,pontuacao_total:pts,${campos}`)
      .eq('telefone_norm', norm).order('id', { ascending: false }).limit(1).maybeSingle();
    if (n1) return { ...(n1 as any), origem_tabela: 'eletroposto_nota1', origem_id: (n1 as any).id };

    const { data: ag } = await supabaseGerador
      .from('agendamentos').select(`id,pontuacao_total,${campos}`)
      .eq('telefone_norm', norm).order('id', { ascending: false }).limit(1).maybeSingle();
    if (ag) return { ...(ag as any), origem_tabela: 'agendamentos', origem_id: (ag as any).id };
  } catch (err) {
    logger.error('plugcash', `falha buscando qualificacao de ${norm}`, err);
  }
  return null;
}

// ── Processamento da venda ──────────────────────────────────────────────────
export async function processarEventoPlugcash(evt: EventoPlugcash): Promise<ResultadoPlugcash> {
  const email = (evt.email || '').toLowerCase().trim();
  if (!email) return { ok: false, acao: 'ignorado', detalhe: 'sem email' };

  const item = evt.itemDireto
    ? { concede_nivel: null, gera_credito: true, ...evt.itemDireto }
    : await classificarProdutoPlugcash(evt.produtoNome, evt.produtoId);
  if (!item) return { ok: true, acao: 'ignorado', detalhe: 'produto nao e do plugcash' };

  // Abandono de carrinho não é pedido. Gravá-lo cria venda fantasma: a Kiwify
  // manda esse evento com `id` sendo a SESSÃO de checkout, não o pedido.
  if (/abandon/i.test(String(evt.status || ''))) {
    return { ok: true, acao: 'ignorado', detalhe: 'abandono de carrinho' };
  }

  const pago = evt.status === 'paid';
  const gateway = evt.gateway || (evt.itemDireto ? 'stripe' : 'kiwify');
  const gatewayRef = evt.orderId ? `${gateway}:${evt.orderId}:${item.item_slug}` : null;

  // Idempotência por pedido+item: o bump vem no MESMO order_id do produto
  // principal, então a chave não pode ser só o pedido.
  let existente: any = null;
  if (gatewayRef) {
    const { data } = await supabase
      .from('pc_compras')
      .select('id,status,acesso_email_em,user_id')
      .eq('gateway_ref', gatewayRef).maybeSingle();
    existente = data;
  }

  // Nunca REBAIXA compra já aprovada: a Kiwify pode reentregar o
  // 'waiting_payment' do Pix depois do 'paid'. Reembolso e chargeback passam —
  // são estados finais de verdade e precisam revogar o acesso.
  const statusMap: Record<string, string> = {
    paid: 'aprovada', refunded: 'reembolsada', chargeback: 'estornada',
    waiting_payment: 'pendente',
  };
  const statusEntrada = statusMap[evt.status || ''] || 'pendente';
  const status =
    existente?.status === 'aprovada' && !['aprovada', 'reembolsada', 'estornada'].includes(statusEntrada)
      ? 'aprovada'
      : statusEntrada;

  const utmCols = evt.utm.utm_campaign ? {
    utm_source: evt.utm.utm_source || null,
    utm_medium: evt.utm.utm_medium || null,
    utm_campaign: evt.utm.utm_campaign,
    utm_content: evt.utm.utm_content || null,
    utm_term: evt.utm.utm_term || null,
  } : {};

  const { data: compra, error: upErr } = await supabase
    .from('pc_compras')
    .upsert({
      gateway,
      gateway_ref: gatewayRef || `sem-order-${crypto.randomUUID()}`,
      email,
      nome: evt.nome,
      telefone: (evt.telefone || '').replace(/\D/g, '') || null,
      item_tipo: item.item_tipo,
      item_slug: item.item_slug,
      valor_centavos: evt.valorCentavos ?? 0,
      status,
      // Dedup do pixel/CAPI: derivado do pedido, então reentrega do webhook não
      // conta a mesma conversão duas vezes lá na Meta.
      event_id: gatewayRef ? `pc_${gatewayRef}` : null,
      checkout_link: evt.checkoutLink,
      payload: evt.payload as any,
      ...utmCols,
    }, { onConflict: 'gateway_ref' })
    .select('id,user_id,acesso_email_em')
    .single();

  if (upErr) {
    logger.error('plugcash', 'upsert pc_compras falhou', upErr);
    return { ok: false, acao: 'ignorado', detalhe: 'falha ao gravar compra' };
  }

  if (!pago) {
    if (status === 'reembolsada' || status === 'estornada') {
      await revogarAcesso((compra as any).id, item);
      return { ok: true, acao: 'revogado', detalhe: `status ${evt.status}` };
    }
    return { ok: true, acao: 'registrado', detalhe: `status ${evt.status}` };
  }

  // ── Pagou: conta, acesso, snapshot, crédito, e-mail ──
  const { userId, contaCriada, acessoUrl } = await garantirConta({
    email, nome: evt.nome, telefone: evt.telefone, utm: evt.utm,
  });
  if (!userId) return { ok: false, acao: 'registrado', detalhe: 'nao consegui criar a conta' };

  await supabase.from('pc_compras').update({ user_id: userId }).eq('id', (compra as any).id);

  // Membro + snapshot. O telefone da compra é melhor que o do cadastro: é o que
  // a pessoa acabou de digitar no checkout.
  const telefone = (evt.telefone || '').replace(/\D/g, '') || null;
  const { data: membroExistente } = await supabase
    .from('pc_membros').select('user_id,motivo_descarte').eq('user_id', userId).maybeSingle();

  if (!membroExistente) {
    const qualificacao = await snapshotQualificacao(telefone);
    const { id: _ignora, ...snap } = (qualificacao || {}) as Record<string, unknown>;
    await supabase.from('pc_membros').upsert(
      { user_id: userId, telefone, ...snap },
      { onConflict: 'user_id' },
    );
  } else if (!(membroExistente as any).motivo_descarte && telefone) {
    // Membro criado antes da compra (entrou pelo SolarDoc) e ainda sem
    // qualificação: agora temos o telefone do checkout, que pode casar.
    const qualificacao = await snapshotQualificacao(telefone);
    if (qualificacao) {
      const { id: _i, ...snap } = qualificacao as Record<string, unknown>;
      await supabase.from('pc_membros').update({ telefone, ...snap }).eq('user_id', userId);
    }
  }

  // Nível (Integrador, Investidor) sobe o membro; curso vira linha de acesso.
  if (item.concede_nivel) {
    await supabase.from('pc_membros').update({ nivel: item.concede_nivel }).eq('user_id', userId);
  }

  if (item.item_tipo === 'curso') {
    const { data: curso } = await supabase
      .from('pc_cursos').select('id').eq('slug', item.item_slug).maybeSingle();
    if (curso) {
      await supabase.from('pc_acessos').upsert(
        { user_id: userId, curso_id: (curso as any).id, origem: 'compra', compra_id: (compra as any).id },
        { onConflict: 'user_id,curso_id', ignoreDuplicates: true },
      );
    } else {
      // Produto vendido sem curso correspondente no catálogo: o cliente pagou e
      // não tem o que abrir. Silêncio aqui vira reclamação amanhã.
      sendOpsAlert(
        'PlugCash: venda sem curso no catalogo',
        `A venda de "${item.item_slug}" (${email}) foi aprovada, mas nao existe curso com esse slug em pc_cursos.\n` +
        `O comprador esta sem acesso. Cadastre o curso ou corrija o mapeamento em pc_gateway_produtos.`,
      ).catch(() => {});
    }
  }

  if (item.item_tipo === 'servico') {
    const { data: servico } = await supabase
      .from('pc_servicos').select('id').eq('slug', item.item_slug).maybeSingle();
    if (servico) {
      await supabase.from('pc_servico_pedidos').insert({
        servico_id: (servico as any).id,
        user_id: userId,
        compra_id: (compra as any).id,
        competencia: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          .toISOString().slice(0, 10),
        status: 'fila',
      });
    }
  }

  // Crédito de abatimento: o que ele pagou em curso abate no upgrade pra
  // Integrador ou Mentoria. Só uma vez por compra.
  if (item.gera_credito && item.item_tipo === 'curso' && (evt.valorCentavos || 0) > 0) {
    const { data: jaTem } = await supabase
      .from('pc_creditos').select('id').eq('origem_compra', (compra as any).id).maybeSingle();
    if (!jaTem) {
      await supabase.from('pc_creditos').insert({
        user_id: userId,
        valor_centavos: evt.valorCentavos,
        origem_compra: (compra as any).id,
        validade: new Date(Date.now() + 365 * 86400_000).toISOString(),
      });
    }
  }

  // E-mail: o gate é o CARIMBO. Bump não manda e-mail próprio — o produto
  // principal já mandou, e dois e-mails por uma compra parece cobrança dupla.
  const jaMandou = !!(compra as any).acesso_email_em || !!existente?.acesso_email_em;
  if (!jaMandou && item.item_tipo !== 'bump') {
    try {
      const { data: curso } = await supabase
        .from('pc_cursos').select('titulo').eq('slug', item.item_slug).maybeSingle();
      await sendPlugcashAcessoEmail({
        to: email,
        nome: evt.nome,
        acessoUrl,
        contaCriada,
        curso: (curso as any)?.titulo || item.item_slug,
      });
      await supabase.from('pc_compras')
        .update({ acesso_email_em: new Date().toISOString() })
        .eq('id', (compra as any).id);
    } catch (err) {
      // Não carimba: a próxima reentrega da Kiwify tenta de novo. O acesso já
      // está liberado — o e-mail é o aviso, não a chave.
      logger.error('plugcash', `e-mail de acesso falhou para ${email}`, err);
    }
  }

  // `motivo` vai junto porque o painel do funil quebra as etapas por bloqueio
  // (material_view e checkout_start já mandam). Sem ele aqui, a linha "comprou"
  // some da quebra — e é justamente ela que responde qual bloqueio converte.
  const { data: membroAgora } = await supabase
    .from('pc_membros').select('motivo_descarte').eq('user_id', userId).maybeSingle();
  await supabase.from('pc_eventos').insert({
    user_id: userId,
    tipo: 'purchase',
    payload: {
      slug: item.item_slug,
      valor: evt.valorCentavos,
      motivo: (membroAgora as any)?.motivo_descarte?.[0] ?? null,
    },
  });

  await avisarVendaPlugcash({
    email,
    nome: evt.nome ?? null,
    slug: item.item_slug,
    tipo: item.item_tipo,
    valorCentavos: evt.valorCentavos ?? null,
    motivo: (membroAgora as any)?.motivo_descarte?.[0] ?? null,
  }).catch(() => {});

  return { ok: true, acao: 'liberado', detalhe: `${item.item_tipo}:${item.item_slug}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// AVISO DE VENDA — e o gatilho da PRIMEIRA
//
// Até aqui uma venda do PlugCash não avisava ninguém: o cliente recebia e-mail,
// o acesso era liberado, e a equipe só ficava sabendo abrindo o painel. Os
// únicos `sendOpsAlert` do arquivo são de FALHA — o sucesso era silencioso.
//
// Isso deixou de ser um detalhe em 08/08: o Thiago decidiu que as 8 aulas que
// faltam só entram na fila quando o primeiro cliente pagante aparecer. Gatilho
// que ninguém observa é gatilho que não dispara.
//
// A PRIMEIRA VENDA TEM TEXTO PRÓPRIO. Ela não é só mais uma: é a que prova que
// o webhook funciona contra cobrança real (nunca tinha rodado) e é a que
// autoriza escrever o resto do curso. Da segunda em diante, aviso normal.
//
// Vai por e-mail e não por WhatsApp: o `avisarVendaAoDono` existe e é bom, mas
// depende de `sales` (tabela do SolarDoc) pra travar duplicata, e a compra do
// PlugCash vive em `pc_compras`. Reaproveitar ali exigiria afrouxar a trava —
// e trava de aviso duplicado é o que impede o dono de receber a mesma venda
// cinco vezes numa reentrega da Kiwify.
async function avisarVendaPlugcash(v: {
  email: string; nome: string | null; slug: string; tipo: string;
  valorCentavos: number | null; motivo: string | null;
}): Promise<void> {
  // Conta ANTES de decidir o texto. `pc_compras` só tem linha de compra paga,
  // então 1 aqui é literalmente a primeira.
  const { count } = await supabase
    .from('pc_compras').select('id', { count: 'exact', head: true });
  const primeira = (count ?? 0) <= 1;

  const valor = v.valorCentavos != null
    ? `R$ ${(v.valorCentavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : 'valor não informado';
  const quem = [v.nome, v.email].filter(Boolean).join(' · ');

  if (primeira) {
    await sendOpsAlert(
      'PlugCash: PRIMEIRA VENDA — o funil fechou o ciclo',
      `${quem}\n${v.tipo}: ${v.slug} — ${valor}\n` +
      `${v.motivo ? `bloqueio na régua: ${v.motivo}\n` : ''}` +
      `\nO que isto prova: o webhook criou a conta e liberou o acesso contra uma\n` +
      `cobrança real. Até agora isso só tinha 16 testes automatizados.\n` +
      `\nCONFIRA ANTES DE COMEMORAR: entre em /plugcash/admin e veja se o acesso\n` +
      `apareceu para este e-mail. Se não apareceu, o cliente pagou e está trancado.\n` +
      `\nE é o gatilho combinado: com o primeiro pagante, as 8 aulas que faltam\n` +
      `entram na fila de produção (hoje o curso abre 6 de 14).`,
    );
    return;
  }

  await sendOpsAlert(
    `PlugCash: venda — ${v.slug}`,
    `${quem}\n${v.tipo}: ${v.slug} — ${valor}\n` +
    `${v.motivo ? `bloqueio na régua: ${v.motivo}\n` : ''}` +
    `\nCompras registradas até agora: ${count ?? '?'}.`,
  );
}

// Reembolso e chargeback trancam o que a compra tinha aberto. Nível não é
// rebaixado automaticamente: quem tem Integrador pode ter subido por outra via,
// e derrubar sozinho arriscaria tirar acesso de quem paga. Vira aviso.
async function revogarAcesso(compraId: string, item: any) {
  await supabase.from('pc_acessos').delete().eq('compra_id', compraId);
  await supabase.from('pc_creditos').delete().eq('origem_compra', compraId).is('usado_em', null);
  await supabase.from('pc_servico_pedidos')
    .update({ status: 'cancelado' }).eq('compra_id', compraId);

  if (item?.concede_nivel) {
    sendOpsAlert(
      'PlugCash: reembolso de item que concede nivel',
      `Uma compra de "${item.item_slug}" (nivel ${item.concede_nivel}) foi reembolsada/estornada.\n` +
      `O acesso por curso foi revogado, mas o NIVEL do membro nao foi rebaixado automaticamente —\n` +
      `ele pode ter subido por outra via. Confira em pc_membros antes de mexer.`,
    ).catch(() => {});
  }
}
