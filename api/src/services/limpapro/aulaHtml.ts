// Prepara o HTML de uma aula do LimpaPro para sair da api.
//
// A aula guardada em limpapro_aulas vem da área de membros antiga e traz três coisas que não podem ir como estão:
//   1. a prova do módulo, num <script type="application/json" class="quiz-json">. Script nenhum sai daqui: a prova é
//      extraída, validada e devolvida como dado, e a tela a desenha;
//   2. fotos com caminho relativo da área de membros antiga (assets/fotos/x.webp), que no app apontariam para o
//      lugar errado: viram /limpapro/fotos/x.webp (arquivos em dashboard/public/limpapro/fotos);
//   3. qualquer marcação que o HTML antigo tenha, passada por limparHtmlPapel (a mesma limpeza dos papéis do /gerador:
//      sem script, iframe, on*, javascript: etc.).
//
// A api é CommonJS e não usa dependência de HTML: o limpador é o do projeto, sem pacote novo.

import { limparHtmlPapel } from '../gerador/htmlPapelSeguro';

export interface Pergunta { q: string; o: string[]; c: number }

const SCRIPT_PROVA = /<script\b[^>]*\bquiz-json\b[^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Texto puro: a tela renderiza a pergunta como texto, então marcação que tenha vindo junto é descartada. */
const soTexto = (v: unknown): string => String(v ?? '').replace(/<[^>]*>/g, '').trim();

export function lerProva(bruto: string): Pergunta[] {
  const saida: Pergunta[] = [];
  for (const m of bruto.matchAll(SCRIPT_PROVA)) {
    let dados: unknown;
    try { dados = JSON.parse(m[1]); } catch { continue; }
    if (!Array.isArray(dados)) continue;
    for (const p of dados) {
      const o = p && Array.isArray((p as Pergunta).o) ? (p as Pergunta).o.map(soTexto).filter(Boolean) : [];
      const c = Number((p as Pergunta)?.c);
      const q = soTexto((p as Pergunta)?.q);
      if (!q || o.length < 2 || !Number.isInteger(c) || c < 0 || c >= o.length) continue;
      saida.push({ q, o, c });
    }
  }
  return saida;
}

export function prepararAula(bruto: string): { html: string; quiz: Pergunta[] } {
  const quiz = lerProva(bruto);
  const semProva = bruto.replace(SCRIPT_PROVA, '');
  const comFotos = semProva.replace(/(\bsrc\s*=\s*["'])(?:\.\/)?assets\/fotos\//gi, '$1/limpapro/fotos/');
  return { html: limparHtmlPapel(comFotos), quiz };
}
