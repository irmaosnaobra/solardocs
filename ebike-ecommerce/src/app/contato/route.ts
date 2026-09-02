import { NextResponse, type NextRequest } from 'next/server';

import { BASE_PATH } from '../../config/basePath.mjs';
import { linkAtendimento } from '../../config/loja.ts';

/**
 * O botão flutuante do WhatsApp passa por aqui antes de ir para a central.
 *
 * Mesmo desvio do `/falar`, por dois motivos. O primeiro é que o formulário é
 * HTML puro: sem uma rota no meio, montar o texto da mensagem exigiria
 * JavaScript no navegador, e este é o caminho por onde o lead vai embora — ele
 * tem que funcionar com o bundle quebrado. O segundo é a limpeza do que a
 * pessoa digitou, que não dá para confiar ao navegador.
 *
 * `force-dynamic` porque a resposta depende do que veio no formulário; rota
 * cacheada aqui mandaria todo mundo com o nome do primeiro que preencheu.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const busca = req.nextUrl.searchParams;
  const nome = (busca.get('nome') ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  // Só dígitos: quem digita "(34) 99816-5040" e quem digita "34998165040"
  // mandam a mesma coisa, e nada além de número atravessa para a mensagem.
  const telefone = (busca.get('telefone') ?? '').replace(/\D/g, '').slice(0, 13);
  const cidade = (busca.get('cidade') ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) || null;
  const campanha = busca.get('campanha')?.slice(0, 120) || null;

  // Sem nome ou sem telefone a mensagem não serve para nada: quem recebe não
  // consegue devolver a ligação. Volta para a loja em vez de abrir um WhatsApp
  // com lacuna. O `required` do formulário já barra gente; isto barra o resto.
  if (!nome || telefone.length < 10) {
    return NextResponse.redirect(new URL(BASE_PATH, req.nextUrl.origin), {
      status: 302,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Atrás do rewrite o host que chega aqui é o da Vercel, não o solardoc.app.
  // O link que vai junto na mensagem tem que ser o que abre no celular de quem
  // atende.
  const base = process.env.SITE_URL ?? req.nextUrl.origin;

  return NextResponse.redirect(
    linkAtendimento({ nome, telefone, cidade, campanha, url: `${base}${BASE_PATH}` }),
    { status: 302, headers: { 'Cache-Control': 'no-store' } },
  );
}
