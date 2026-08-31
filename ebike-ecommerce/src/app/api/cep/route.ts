import { NextResponse, type NextRequest } from 'next/server';

import { FRETE, apenasDigitos, formatarCep, zonaDe } from '../../../config/frete.ts';

/**
 * Resolve o CEP em cidade de verdade (ViaCEP) e devolve a regra de entrega.
 *
 * A consulta passa pelo nosso servidor, não pelo navegador: assim a resposta
 * fica em cache aqui (CEP não muda de cidade) e o cliente não depende de o
 * ViaCEP liberar CORS para o nosso domínio.
 */
export const revalidate = 604800;

type ViaCep = {
  localidade?: string;
  uf?: string;
  bairro?: string;
  logradouro?: string;
  erro?: boolean | string;
};

export async function GET(req: NextRequest) {
  const cep = apenasDigitos(req.nextUrl.searchParams.get('cep') ?? '');
  if (cep.length !== 8) {
    return NextResponse.json({ ok: false, erro: 'CEP precisa ter 8 dígitos.' }, { status: 400 });
  }

  let dados: ViaCep;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      next: { revalidate: 604800 },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new Error(String(r.status));
    dados = (await r.json()) as ViaCep;
  } catch {
    return NextResponse.json(
      { ok: false, erro: 'Não consegui consultar o CEP agora. Fale com a gente no WhatsApp.' },
      { status: 502 },
    );
  }

  if (dados.erro || !dados.localidade || !dados.uf) {
    return NextResponse.json({ ok: false, erro: 'CEP não encontrado.' }, { status: 404 });
  }

  const zona = zonaDe(dados.localidade, dados.uf);
  const regra = FRETE[zona];

  return NextResponse.json({
    ok: true,
    cep: formatarCep(cep),
    cidade: dados.localidade,
    uf: dados.uf,
    bairro: dados.bairro || null,
    zona,
    rotulo: regra.rotulo,
    valor: regra.valor,
    prazo: regra.prazo,
  });
}
