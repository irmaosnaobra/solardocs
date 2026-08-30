import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import { TAG_CATALOGO, catalogoInterno } from '../../../lib/catalogo.ts';
import { iguais } from '../../../lib/portaria.ts';

/**
 * Atualização diária do catálogo. O cron da Vercel (ver vercel.json) chama esta
 * rota de manhã; ela joga fora o cache, relê o fornecedor e regenera a loja.
 *
 * Responde com o resultado da leitura. Se der ruim, o erro aparece aqui e nos
 * logs, em vez de a loja envelhecer em silêncio.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function autorizado(req: NextRequest): boolean {
  const segredo = process.env.CRON_SECRET;
  // A Vercel assina a chamada do cron com o CRON_SECRET no Authorization.
  if (segredo) {
    const enviado = req.headers.get('authorization') ?? '';
    const naQuery = req.nextUrl.searchParams.get('chave') ?? '';
    return iguais(enviado, `Bearer ${segredo}`) || iguais(naQuery, segredo);
  }
  // Sem segredo configurado, só a própria Vercel (cabeçalho do cron) entra.
  return req.headers.get('x-vercel-cron') !== null;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, erro: 'não autorizado' }, { status: 401 });
  }

  // expire: 0 derruba o cache na hora, para o relatório abaixo falar da
  // leitura de agora e não da de ontem.
  revalidateTag(TAG_CATALOGO, { expire: 0 });

  const { bikes, meta } = await catalogoInterno();
  revalidatePath('/', 'layout');

  const ok = meta.origem === 'ao-vivo' && bikes.length > 0;
  return NextResponse.json(
    {
      ok,
      lidoEm: meta.atualizadoEm,
      origem: meta.origem,
      logadoNoFornecedor: meta.logado,
      modelos: bikes.length,
      semEstoqueInformado: bikes.filter((b) => b.estoque === null).length,
      ...(meta.erro ? { erro: meta.erro } : {}),
    },
    { status: ok ? 200 : 503 },
  );
}
