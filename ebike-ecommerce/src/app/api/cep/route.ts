import { NextResponse, type NextRequest } from 'next/server';

import { apenasDigitos, formatarCep } from '../../../config/frete.ts';
import { basesDoCatalogo, bikePorSlug } from '../../../lib/catalogo.ts';
import { cotar } from '../../../lib/frete.ts';

/**
 * Cotação de entrega para um CEP.
 *
 * Recebe também qual bike é: a base de onde ela sai muda o frete, e o
 * fornecedor tem 22 bases espalhadas pelo país. Sem o modelo, o cálculo sairia
 * sempre de Uberlândia, o que é errado para quem compra em Recife.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const cep = apenasDigitos(req.nextUrl.searchParams.get('cep') ?? '');
  if (cep.length !== 8) {
    return NextResponse.json({ ok: false, erro: 'CEP precisa ter 8 dígitos.' }, { status: 400 });
  }

  const bike = await bikePorSlug(req.nextUrl.searchParams.get('bike') ?? '');
  if (!bike) {
    return NextResponse.json({ ok: false, erro: 'Modelo não encontrado.' }, { status: 404 });
  }

  const cotacao = await cotar({
    cep,
    bases: await basesDoCatalogo(),
    basesDoProduto: bike.bases,
    pesoKg: bike.pesoKg,
    precoDaBike: bike.preco,
  });

  if (!cotacao) {
    return NextResponse.json({ ok: false, erro: 'CEP não encontrado.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...cotacao, cep: formatarCep(cotacao.cep) });
}
