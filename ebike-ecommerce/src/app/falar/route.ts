import { NextResponse, type NextRequest } from "next/server";

import { BASE_PATH } from "../../config/basePath.mjs";
import { bikePorSlug } from "../../lib/catalogo.ts";
import { formaPorId, linkWhatsApp } from "../../config/loja.ts";
import { proximoConsultor } from "../../lib/rodizio.ts";

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
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("bike") ?? "";
  const pagamento = formaPorId(req.nextUrl.searchParams.get("pagamento"));
  const cidade = req.nextUrl.searchParams.get("cidade")?.slice(0, 80) ?? null;
  const cep = req.nextUrl.searchParams.get("cep")?.slice(0, 9) ?? null;
  const entrega = cidade ? `${cidade}${cep ? ` (${cep})` : ""}` : null;
  const saiDe = req.nextUrl.searchParams.get("origem")?.slice(0, 80) || null;
  const freteBruto = Number(req.nextUrl.searchParams.get("frete"));
  const frete =
    Number.isFinite(freteBruto) && freteBruto > 0
      ? freteBruto.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })
      : null;

  const bike = await bikePorSlug(slug);
  if (!bike)
    return NextResponse.redirect(new URL(BASE_PATH, req.nextUrl.origin));

  const { consultor } = await proximoConsultor({
    codigo: bike.codigo,
    titulo: bike.titulo,
    preco: bike.preco,
    pagamento: pagamento?.rotulo ?? null,
    origem: entrega ? `loja · ${entrega}` : "loja",
  });

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
      entrega,
      saiDe,
      frete,
      url: pagina,
    }),
    { status: 302, headers: { "Cache-Control": "no-store" } },
  );
}
