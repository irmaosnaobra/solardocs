import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

import {
  TAG_CATALOGO,
  basesDoCatalogo,
  catalogoInterno,
  codigosDaReserva,
} from '../../../lib/catalogo.ts';
import { iguais } from '../../../lib/portaria.ts';

/**
 * A revisão do estoque. Duas vezes por dia, 7h e 13h (ver vercel.json).
 *
 * Joga fora o cache, relê as 22 unidades e regenera a loja. Modelo que saiu do
 * fornecedor sai da vitrine no mesmo movimento: a lista de cada unidade é a
 * dela, de agora — não há nada a "remover", o que não voltar simplesmente não
 * existe mais.
 *
 * Responde com a contagem POR UNIDADE e com o que mudou desde a cópia de
 * reserva. Sem isso, "o site está atualizado" é promessa sem prova: se a
 * leitura parar, a reserva segura a página e tudo PARECE saudável.
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

/**
 * Sem isto a loja envelheceria em silêncio: o portal do fornecedor muda, a
 * leitura ao vivo para, a reserva segura a página e tudo PARECE saudável.
 * O aviso só sai quando cai para a reserva, então não vira ruído diário.
 */
async function avisarQueCaiu(mensagem: string) {
  const destino = process.env.ALERTA_WEBHOOK;
  if (!destino) return;
  try {
    await fetch(destino, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: `Loja de bikes: ${mensagem}` }),
    });
  } catch {
    // Alerta que falha não pode derrubar a atualização.
  }
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

  // Quantos modelos cada unidade tem AGORA. É a revisão de estoque em número:
  // unidade que zerou aparece como zero em vez de sumir sem explicação.
  const bases = await basesDoCatalogo();
  const porUnidade: Record<string, number> = {};
  for (const b of bases) {
    porUnidade[`${b.cidade} - ${b.uf}`] = bikes.filter((k) => k.bases.includes(b.slug)).length;
  }

  const agora = new Set(bikes.map((b) => b.codigo));
  const antes = codigosDaReserva();
  const sairam = [...antes].filter((c) => !agora.has(c));
  const entraram = [...agora].filter((c) => !antes.has(c));

  const ok = meta.origem === 'ao-vivo' && bikes.length > 0;
  if (!ok) {
    await avisarQueCaiu(
      `a leitura do fornecedor falhou e a página está servindo a cópia de reserva de ${meta.atualizadoEm}. Motivo: ${meta.erro ?? 'não informado'}`,
    );
  }

  return NextResponse.json(
    {
      ok,
      lidoEm: meta.atualizadoEm,
      origem: meta.origem,
      logadoNoFornecedor: meta.logado,
      modelos: bikes.length,
      unidades: bases.length,
      porUnidade,
      sairam,
      entraram,
      semEstoqueInformado: bikes.filter((b) => b.estoque === null).length,
      ...(meta.erro ? { erro: meta.erro } : {}),
    },
    { status: ok ? 200 : 503 },
  );
}
