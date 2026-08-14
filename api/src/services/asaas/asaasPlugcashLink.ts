// ─────────────────────────────────────────────────────────────────────────────
// LINK DE PAGAMENTO DO ASAAS PARA OS PRODUTOS DO PLUGCASH — Pix, cartão e boleto
// na mesma página, sem a gente pedir CPF nem e-mail antes.
//
// Por que LINK e não cobrança avulsa: uma cobrança (`POST /payments`) exige um
// `customer` criado ANTES, com nome e CPF — dados que a página de venda não tem e
// não deve pedir. O link (`POST /paymentLinks`, chargeType DETACHED) é uma URL só,
// reaproveitável por todo mundo: quem preenche os dados é o comprador, na página
// do Asaas, e é lá que ele escolhe Pix, cartão ou boleto (billingType UNDEFINED).
//
// Um link POR DEGRAU da escada de preço. O checkout já resolve nessa ordem
// (plugcashCheckout.ts): link do degrau → link do curso → sessão Stripe. Então
// colar o link aqui é o que troca o gateway daquele degrau, sem deploy.
//
// O QUE O WEBHOOK USA PRA RECONHECER A VENDA é o `id` do link, guardado em
// `copy.ofertas[].asaas_link_id`. O `externalReference` viaja junto por garantia,
// mas não dá pra confiar que ele chegue no pagamento: conferido em 14/08/2026 na
// API de sandbox, ele existe no pagamento criado DIRETO — o do link não foi
// exercitado. Id do link é o que o objeto `payment` sempre traz (campo
// `paymentLink`, presente no schema conferido no mesmo dia).
// ─────────────────────────────────────────────────────────────────────────────

import { asaasFetch, asaasApiKey } from './asaasClient';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';

export type LinkCriado = {
  ofertaId: string;
  centavos: number;
  linkId: string;
  url: string;
};

type RespostaLink = { id?: string; url?: string; value?: number; active?: boolean };

/** `pc:<slug>:<oferta>` — o mesmo formato do lado do Stripe (`pc_item_slug`). */
export function refDaOferta(slug: string, ofertaId: string): string {
  return `pc:${slug}:${ofertaId}`;
}

/**
 * Cria (ou recria) o link de UM degrau. Não apaga o anterior: link antigo pode
 * estar aberto no celular de alguém que ainda vai pagar, e um link morto no meio
 * de uma compra é pior que dois links vivos com o mesmo preço.
 */
export async function criarLinkDaOferta(p: {
  slug: string; titulo: string; ofertaId: string; centavos: number; rotulo?: string;
}): Promise<LinkCriado> {
  const r = await asaasFetch<RespostaLink>('/paymentLinks', {
    method: 'POST',
    body: {
      name: p.rotulo || p.titulo,
      description: `${p.titulo} — acesso vitalício, liberado por e-mail assim que o pagamento é confirmado.`,
      billingType: 'UNDEFINED',      // o comprador escolhe Pix, cartão ou boleto
      chargeType: 'DETACHED',        // pagamento único (não é assinatura)
      value: p.centavos / 100,       // o Asaas fala em reais, não em centavos
      dueDateLimitDays: 3,           // prazo do boleto/Pix gerado a partir do link
      maxInstallmentCount: 1,
      notificationEnabled: false,    // quem avisa o comprador somos nós, por e-mail
      externalReference: refDaOferta(p.slug, p.ofertaId),
    },
  });

  if (!r?.id || !r?.url) throw new Error(`Asaas devolveu link sem id/url para ${p.slug}:${p.ofertaId}`);
  return { ofertaId: p.ofertaId, centavos: p.centavos, linkId: r.id, url: r.url };
}

/**
 * Escreve os links criados de volta em `pc_cursos.copy.ofertas`. Mexe SÓ nos
 * campos do gateway (`checkout_url` e `asaas_link_id`) — preço, rótulo e ordem
 * dos degraus continuam sendo assunto do /admin.
 */
export async function gravarLinksNoCurso(slug: string, links: LinkCriado[]): Promise<number> {
  const { data: curso } = await supabase
    .from('pc_cursos').select('copy').eq('slug', slug).maybeSingle();
  const copy = ((curso as { copy?: Record<string, unknown> } | null)?.copy || {}) as Record<string, unknown>;
  const ofertas = Array.isArray(copy.ofertas) ? (copy.ofertas as Array<Record<string, unknown>>) : [];
  if (!ofertas.length) throw new Error(`curso ${slug} não tem copy.ofertas`);

  let tocadas = 0;
  const novas = ofertas.map((o) => {
    const achou = links.find((l) => l.ofertaId === o.id);
    if (!achou) return o;
    tocadas++;
    return { ...o, checkout_url: achou.url, asaas_link_id: achou.linkId };
  });

  const { error } = await supabase
    .from('pc_cursos')
    .update({ copy: { ...copy, ofertas: novas } })
    .eq('slug', slug);
  if (error) throw new Error(`gravar ofertas falhou: ${error.message}`);
  return tocadas;
}

/** Todas as ofertas de todos os cursos que têm link do Asaas, achatadas. */
export type OfertaComLink = { slug: string; ofertaId: string; centavos: number; linkId: string };

export async function ofertasComLinkAsaas(): Promise<OfertaComLink[]> {
  const { data } = await supabase.from('pc_cursos').select('slug,copy');
  const out: OfertaComLink[] = [];
  for (const c of (data || []) as Array<{ slug: string; copy?: { ofertas?: unknown } }>) {
    const ofertas = Array.isArray(c.copy?.ofertas) ? (c.copy!.ofertas as Array<Record<string, unknown>>) : [];
    for (const o of ofertas) {
      if (o && typeof o.asaas_link_id === 'string' && o.asaas_link_id) {
        out.push({
          slug: c.slug,
          ofertaId: String(o.id || ''),
          centavos: Math.round(Number(o.centavos) || 0),
          linkId: o.asaas_link_id,
        });
      }
    }
  }
  return out;
}

/**
 * Dado um pagamento do Asaas, diz QUAL produto foi vendido — ou null se o
 * pagamento não é do PlugCash (é do trilho de assinatura, ou de outra coisa).
 * Ordem de confiança: id do link (sempre presente em pagamento de link) →
 * externalReference (`pc:<slug>:<oferta>`), que é a rede.
 */
export async function acharOfertaDoPagamento(p: {
  paymentLink?: string | null; externalReference?: string | null;
}): Promise<OfertaComLink | null> {
  const ofertas = await ofertasComLinkAsaas();

  if (p.paymentLink) {
    const achou = ofertas.find((o) => o.linkId === p.paymentLink);
    if (achou) return achou;
  }

  const ref = (p.externalReference || '').trim();
  if (ref.startsWith('pc:')) {
    const [, slug, ofertaId] = ref.split(':');
    if (slug) {
      const achou = ofertas.find((o) => o.slug === slug && o.ofertaId === ofertaId);
      if (achou) return achou;
      // Link ainda não gravado no banco (recriado à mão no painel, por exemplo):
      // o `pc:` já identifica o produto, e o preço vem do próprio pagamento.
      return { slug, ofertaId: ofertaId || '', centavos: 0, linkId: p.paymentLink || '' };
    }
  }
  return null;
}

/** Nome e e-mail do comprador — o webhook manda só o id do cliente. */
export async function clienteDoAsaas(id: string): Promise<{ nome: string | null; email: string | null; telefone: string | null }> {
  if (!id || !asaasApiKey()) return { nome: null, email: null, telefone: null };
  const c = await asaasFetch<{ name?: string; email?: string; mobilePhone?: string; phone?: string }>(`/customers/${id}`);
  return {
    nome: c?.name || null,
    email: (c?.email || '').trim().toLowerCase() || null,
    telefone: c?.mobilePhone || c?.phone || null,
  };
}

export function logLink(msg: string, extra?: unknown): void {
  logger.info('asaas-plugcash', msg, extra as Record<string, unknown>);
}
