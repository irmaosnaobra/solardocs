import Stripe from 'stripe';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// CHECKOUT DO PLUGCASH — Stripe como caminho que não depende de ninguém
//
// O plano do projeto manda usar o gateway dos outros produtos, e o da casa para
// infoproduto avulso é a Kiwify. Só que criar o produto lá é tarefa manual do
// dono, e enquanto ela não acontece o funil inteiro fica parado: o lead é
// desqualificado, chega na página de venda e não tem o que comprar.
//
// Então isto é uma SEGUNDA opção, não uma troca:
//   · `pc_cursos.checkout_url` preenchido → é ele que manda, sempre.
//   · vazio → esta rota cria uma sessão do Stripe na hora.
//
// No dia em que o produto existir na Kiwify, o dono cola o link no /admin e o
// Stripe para de ser usado — sem tocar em uma linha de código.
//
// O bump de R$ 47 vira uma linha a mais na mesma sessão. Na Kiwify ele é
// order bump nativo; aqui é `line_items`, e por isso o preço dele também mora
// no banco, nunca aqui.
// ─────────────────────────────────────────────────────────────────────────────

const stripe = new Stripe((process.env.STRIPE_SECRET_KEY || '').trim());
const DASHBOARD = (process.env.DASHBOARD_URL || 'https://solardoc.app').trim();

export type PedidoCheckout = {
  slug: string;
  /** leva o bump junto (planilha de viabilidade) */
  bump?: boolean;
  email?: string | null;
  /** de onde veio o clique — vira metadata e depois utm na compra */
  origem?: string | null;
  utm?: Record<string, string | null>;
};

export async function criarSessaoPlugcash(p: PedidoCheckout): Promise<
  { ok: true; url: string } | { ok: false; erro: string }
> {
  if (!process.env.STRIPE_SECRET_KEY) {
    return { ok: false, erro: 'gateway nao configurado' };
  }

  const { data: curso } = await supabase
    .from('pc_cursos')
    .select('slug,titulo,subtitulo,preco_centavos,checkout_url,status')
    .eq('slug', p.slug)
    .maybeSingle();

  if (!curso) return { ok: false, erro: 'curso nao encontrado' };
  const c = curso as any;

  // Curso em rascunho não vende — a mesma regra de todo o resto. Se caísse aqui
  // seria o único caminho pelo qual um curso sem aula gravada seria cobrado.
  if (c.status !== 'publicado') return { ok: false, erro: 'curso nao esta publicado' };

  // Link próprio cadastrado manda. Esta rota nem deveria ter sido chamada, mas
  // se foi, devolve o link em vez de criar cobrança paralela no Stripe.
  if (c.checkout_url) return { ok: true, url: c.checkout_url };

  if (!c.preco_centavos || c.preco_centavos < 100) {
    return { ok: false, erro: 'preco invalido' };
  }

  const itens: any[] = [{
    quantity: 1,
    price_data: {
      currency: 'brl',
      unit_amount: c.preco_centavos,
      product_data: {
        name: c.titulo,
        ...(c.subtitulo ? { description: c.subtitulo } : {}),
      },
    },
  }];

  // O bump é um serviço do catálogo, então preço e nome vêm de lá também.
  let bumpSlug: string | null = null;
  if (p.bump) {
    const { data: bump } = await supabase
      .from('pc_servicos')
      .select('slug,titulo,descricao,preco_centavos,status')
      .eq('slug', 'planilha-viabilidade')
      .maybeSingle();
    const b = bump as any;
    if (b?.status === 'publicado' && b.preco_centavos >= 100) {
      bumpSlug = b.slug;
      itens.push({
        quantity: 1,
        price_data: {
          currency: 'brl',
          unit_amount: b.preco_centavos,
          product_data: { name: b.titulo, ...(b.descricao ? { description: b.descricao.slice(0, 300) } : {}) },
        },
      });
    }
    // Bump pedido e indisponível não derruba a compra: o principal segue.
  }

  try {
    const sessao = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: itens,
      ...(p.email ? { customer_email: p.email } : {}),
      // O webhook precisa saber O QUE foi vendido. Sem estes carimbos ele
      // receberia uma cobrança de R$ 197 sem nome de produto e não saberia que
      // curso liberar — que é exatamente o buraco que a rede de segurança pega.
      metadata: {
        pc_item_tipo: 'curso',
        pc_item_slug: c.slug,
        ...(bumpSlug ? { pc_bump_slug: bumpSlug } : {}),
        ...(p.origem ? { pc_origem: p.origem } : {}),
        ...Object.fromEntries(
          Object.entries(p.utm || {}).filter(([, v]) => v).map(([k, v]) => [k, String(v).slice(0, 120)]),
        ),
      },
      // Volta pro app, não pra uma tela genérica de obrigado do gateway.
      success_url: `${DASHBOARD}/plugcash/obrigado/${c.slug}?ok=1`,
      cancel_url: `${DASHBOARD}/plugcash/curso/${c.slug}?cancelado=1`,
      // CPF na nota: é infoproduto vendido no Brasil.
      billing_address_collection: 'auto',
    });

    if (!sessao.url) return { ok: false, erro: 'stripe nao devolveu url' };
    return { ok: true, url: sessao.url };
  } catch (err) {
    logger.error('plugcash-checkout', `falha criando sessao de ${p.slug}`, err);
    return { ok: false, erro: 'falha ao abrir o checkout' };
  }
}
