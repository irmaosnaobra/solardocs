import { NextResponse, type NextRequest } from 'next/server';

import { registrarVisita, type Etapa } from '../../../lib/visita.ts';

/**
 * O beacon do funil. O navegador avisa que chegou; quem grava é o servidor.
 *
 * Responde 204 sempre, inclusive quando não grava: isto é medição, e medição
 * que devolve erro para o navegador só serve para sujar o console de quem veio
 * comprar bike.
 */
export const dynamic = 'force-dynamic';

const ETAPAS: Etapa[] = ['loja', 'local', 'modelo', 'whatsapp'];

export async function POST(req: NextRequest) {
  const vazio = new NextResponse(null, { status: 204 });
  try {
    const d = (await req.json()) as Record<string, unknown>;
    const sessao = String(d.sessao ?? '').slice(0, 40);
    const etapa = String(d.etapa ?? '') as Etapa;
    // "whatsapp" não entra por aqui: quem grava aquela etapa é a rota /falar,
    // no servidor, onde o clique realmente acontece e ninguém pode forjar.
    if (!sessao || !ETAPAS.includes(etapa) || etapa === 'whatsapp') return vazio;

    await registrarVisita({
      sessao,
      etapa,
      modelo: d.modelo ? String(d.modelo).slice(0, 120) : null,
      cidade: d.cidade ? String(d.cidade).slice(0, 80) : null,
      uf: d.uf ? String(d.uf).slice(0, 2) : null,
      campanha: d.campanha ? String(d.campanha).slice(0, 120) : null,
    });
  } catch {
    /* medição não atrapalha ninguém */
  }
  return vazio;
}
