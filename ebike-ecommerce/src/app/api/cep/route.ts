import { NextResponse, type NextRequest } from 'next/server';

import { apenasDigitos, formatarCep } from '../../../config/frete.ts';
import { basesConhecidas } from '../../../lib/bases.ts';
import { cotar } from '../../../lib/frete.ts';

/**
 * Cotação de entrega para um CEP.
 *
 * Recebe do formulário quais bases têm o modelo e quanto ele pesa, em vez de ir
 * buscar isso no catálogo. Não é economia de código: buscar no catálogo fazia
 * esta rota, num servidor frio, reler os 29 produtos do fornecedor antes de
 * responder um CEP. O cliente ficava olhando "Calculando..." por meio minuto.
 *
 * Peso e bases vindos do navegador são aceitáveis aqui porque o resultado é uma
 * ESTIMATIVA que um humano confirma no WhatsApp, e porque as bases são
 * conferidas contra a lista real antes de entrar na conta.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const cep = apenasDigitos(p.get('cep') ?? '');
  if (cep.length !== 8) {
    return NextResponse.json({ ok: false, erro: 'CEP precisa ter 8 dígitos.' }, { status: 400 });
  }

  const bases = basesConhecidas();
  const validos = new Set(bases.map((b) => b.slug));
  const basesDoProduto = (p.get('bases') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => validos.has(s));

  const pesoBruto = Number(p.get('peso'));
  const pesoKg = Number.isFinite(pesoBruto) && pesoBruto > 0 && pesoBruto < 1000 ? pesoBruto : null;

  const volumeBruto = Number(p.get('m3'));
  const volumeM3 =
    Number.isFinite(volumeBruto) && volumeBruto > 0 && volumeBruto < 20 ? volumeBruto : null;

  const precoBruto = Number(p.get('preco'));
  const precoDaBike = Number.isFinite(precoBruto) && precoBruto > 0 ? precoBruto : 0;

  const cotacao = await cotar({
    cep,
    bases,
    basesDoProduto,
    pesoKg,
    volumeM3,
    categoria: p.get('categoria') ?? '',
    precoDaBike,
  });
  if (!cotacao) {
    return NextResponse.json({ ok: false, erro: 'CEP não encontrado.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...cotacao, cep: formatarCep(cotacao.cep) });
}
