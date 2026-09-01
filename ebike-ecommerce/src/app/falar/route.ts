import { NextResponse, type NextRequest } from 'next/server';

import { BASE_PATH } from '../../config/basePath.mjs';
import { bikePorSlug } from '../../lib/catalogo.ts';
import { PARCELAS_MAXIMAS, formaPorId, linkWhatsApp } from '../../config/loja.ts';
import { proximoConsultor } from '../../lib/rodizio.ts';
import { enviarLeadParaMeta } from '../../lib/meta.ts';
import { registrarVisita } from '../../lib/visita.ts';

/**
 * O botão da bike passa por aqui antes de ir para o WhatsApp.
 *
 * É este desvio que permite alternar os consultores de verdade: a escolha
 * acontece no servidor, com um contador compartilhado, e não no navegador de
 * cada visitante. De quebra, o lead fica registrado antes de sair.
 *
 * `force-dynamic` não é enfeite: se esta rota fosse cacheada, todo lead cairia
 * no mesmo consultor, que é exatamente o defeito que ela existe para evitar.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('bike') ?? '';
  const pagamento = formaPorId(req.nextUrl.searchParams.get('pagamento'));
  const cidade = req.nextUrl.searchParams.get('cidade')?.slice(0, 80) ?? null;
  const cep = req.nextUrl.searchParams.get('cep')?.slice(0, 9) ?? null;
  const entrega = cidade ? `${cidade}${cep ? ` (${cep})` : ''}` : null;
  const saiDe = req.nextUrl.searchParams.get('origem')?.slice(0, 80) || null;
  // Só aceita o que a loja realmente oferece: número inteiro dentro do teto.
  const pedidas = Number(req.nextUrl.searchParams.get('parcelas'));
  const parcelas =
    Number.isInteger(pedidas) && pedidas >= 1 && pedidas <= PARCELAS_MAXIMAS ? pedidas : null;
  const freteBruto = Number(req.nextUrl.searchParams.get('frete'));
  const frete =
    Number.isFinite(freteBruto) && freteBruto > 0
      ? freteBruto.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })
      : null;

  const bike = await bikePorSlug(slug);
  if (!bike) return NextResponse.redirect(new URL(BASE_PATH, req.nextUrl.origin));

  // De qual anúncio veio, e qual visita fechou. O clique é gravado AQUI, no
  // servidor: é o único ponto por onde todo lead passa de verdade.
  const campanha = req.nextUrl.searchParams.get('campanha')?.slice(0, 120) || null;
  const sessao = req.cookies.get('corrente-sessao')?.value?.slice(0, 40) || null;
  if (sessao) {
    await registrarVisita({
      sessao,
      etapa: 'whatsapp',
      modelo: bike.codigo,
      cidade,
      campanha,
    });
  }

  const { consultor } = await proximoConsultor({
    codigo: bike.codigo,
    titulo: bike.titulo,
    preco: bike.preco,
    pagamento: pagamento?.rotulo
      ? `${pagamento.rotulo}${parcelas && parcelas > 1 ? ` ${parcelas}x` : ''}`
      : null,
    origem: entrega ? `loja · ${entrega}` : 'loja',
    campanha,
  });

  // O MESMO evento pelo servidor, com o id que o navegador usou. Daqui não tem
  // bloqueador: o lead chega na Meta mesmo quando o pixel do navegador não
  // chegou, e o id em comum impede que os dois virem dois leads.
  const eventoId = req.nextUrl.searchParams.get('evento_id')?.slice(0, 60) || null;
  if (eventoId) {
    await enviarLeadParaMeta({
      eventoId,
      url: `${process.env.SITE_URL ?? req.nextUrl.origin}${BASE_PATH}/modelo/${bike.slug}`,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip'),
      navegador: req.headers.get('user-agent'),
      // Cookies que o proprio pixel grava. Sao o que mais aumenta o casamento
      // do lead com a conta da pessoa na Meta.
      fbp: req.cookies.get('_fbp')?.value ?? null,
      fbc: req.cookies.get('_fbc')?.value ?? null,
      codigo: bike.codigo,
      preco: bike.preco,
      cep,
      cidade: cidade?.split(' - ')[0] ?? null,
      uf: cidade?.split(' - ')[1] ?? null,
    });
  }

  // Atrás do rewrite o host que chega aqui é o da Vercel, não o solardoc.app.
  // O link que vai no WhatsApp tem que ser o que o cliente consegue abrir.
  const base = process.env.SITE_URL ?? req.nextUrl.origin;
  const pagina = `${base}${BASE_PATH}/modelo/${bike.slug}`;

  return NextResponse.redirect(
    linkWhatsApp({
      consultor,
      titulo: bike.titulo,
      codigo: bike.codigo,
      preco: bike.preco,
      pagamento,
      parcelas,
      entrega,
      saiDe,
      frete,
      url: pagina,
    }),
    { status: 302, headers: { 'Cache-Control': 'no-store' } },
  );
}
