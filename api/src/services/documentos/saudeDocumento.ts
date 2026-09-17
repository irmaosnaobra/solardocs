// ─────────────────────────────────────────────────────────────────────────────
// SAÚDE DO DOCUMENTO — a trava entre a revisão do cliente e o que fica gravado.
//
// Desde que contrato, procuração e proposta de banco viraram documentos
// DESENHADOS, o que viaja na coluna `content` não é mais texto: é `[[HTML]]` +
// a folha de estilo + a folha. Revisão é ótima e continua livre. O que não pode
// é a revisão DESTRUIR o documento e o servidor gravar por cima do inteiro.
//
// A régua é simples e tem só dois lados:
//
//   REPARO CALADO — tem uma resposta certa só, então não se pergunta nada a
//   ninguém: `contenteditable` que vazou do editor, o base64 da logo no lugar
//   do `{{LOGO}}`, o sentinela `[[HTML]]` perdido na frente de um `<style>`,
//   casca de cláusula vazia. Conserta e salva.
//
//   RECUSA — a folha foi destruída, e aí GRAVAR é que é o estrago: documento
//   sem texto nenhum, sem `<style>`, ou sem a div raiz da folha. O servidor
//   devolve 422, nada é escrito, e o que já estava salvo continua inteiro.
//
// O que NÃO se confere: contagem de tag aberta x fechada. Medido nos contratos
// do assinante que editou à mão: vieram balanceados. E o `contenteditable` do
// navegador reestrutura de propósito (parte um bloco em dois ao apagar seleção
// grande) — checagem que acusa edição legítima é checagem que ensina todo mundo
// a ignorar aviso.
//
// Roda no SERVIDOR, não no front: o dashboard é PWA e pode estar rodando uma
// versão em cache de semanas atrás. Regra que mora só no cliente é regra que o
// cliente desatualizado não tem.
// ─────────────────────────────────────────────────────────────────────────────

export const SENTINELA = '[[HTML]]';

// Raiz de cada família desenhada: contrato (.ct), procuração (.pr), proposta de
// banco (.pb). Documento novo que entre no formato desenhado precisa aparecer
// aqui, senão a revisão dele é recusada como "folha sumiu".
const RAIZES_DESENHADAS = ['ct', 'pr', 'pb'];

// Abaixo disso não é documento, é sobra. O menor de todos (recibo) passa dos 300
// caracteres visíveis; o corte existe pro caso de "selecionou tudo e apagou".
const MINIMO_DE_TEXTO = 80;

export function ehDesenhado(content: string): boolean {
  return content.trimStart().startsWith(SENTINELA);
}

// Texto que sobra quando se tira estilo e marcação. É por ele que se sabe se o
// documento ficou vazio — `length` do HTML mentiria: 18 KB de CSS com zero
// palavra passaria por documento cheio.
export function textoVisivel(html: string): string {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Exame {
  /** O `content` já reparado — é ESTE que deve ser gravado, não o que chegou. */
  content?: string;
  /** O HTML do arquivo já reparado. */
  html?: string;
  /** Consertos silenciosos aplicados (viram log, não viram aviso na tela). */
  reparos: string[];
  /** Motivos, em português de gente, para recusar a gravação inteira. */
  problemas: string[];
}

interface Entrada {
  content?: string;
  html?: string;
  /** O documento que ESTÁ salvo é desenhado? É o que diz o que exigir de volta. */
  eraDesenhado: boolean;
  /** Logo da empresa em base64, pra desfazer a troca do {{LOGO}}. */
  logoBase64?: string | null;
}

// `contenteditable` é do editor, não do documento. Vazou pro arquivo e o cliente
// que recebe o contrato consegue digitar em cima dele no navegador.
function tiraContenteditable(s: string): string {
  return s.replace(/\s+contenteditable\s*=\s*"[^"]*"/gi, '').replace(/\s+contenteditable\s*=\s*'[^']*'/gi, '');
}

export function examinarRevisao(entrada: Entrada): Exame {
  const reparos: string[] = [];
  const problemas: string[] = [];
  const out: Exame = { reparos, problemas };

  // ── content (a coluna do banco) ───────────────────────────────────────────
  if (typeof entrada.content === 'string') {
    let c = entrada.content;

    if (/contenteditable/i.test(c)) {
      c = tiraContenteditable(c);
      reparos.push('contenteditable removido do content');
    }

    // O base64 da logo entra na tela e tem que SAIR na hora de gravar: inchar a
    // linha do banco é o de menos, o caro é congelar a logo de hoje num
    // documento que deveria seguir a marca da empresa.
    const logo = entrada.logoBase64;
    if (logo && logo.length > 40 && c.includes(logo)) {
      c = c.split(logo).join('{{LOGO}}');
      reparos.push('{{LOGO}} devolvido no lugar do base64');
    }

    // Sentinela perdido na frente de um <style>: é documento desenhado que
    // perdeu o prefixo, não documento de texto. Sem ele o leitor cai no parser
    // de TEXTO e imprime a marcação como parágrafo justificado.
    if (entrada.eraDesenhado && !ehDesenhado(c) && c.trimStart().startsWith('<style')) {
      c = SENTINELA + c;
      reparos.push('sentinela [[HTML]] recolocado');
    }

    // Casca de cláusula que ficou pra trás quando alguém apagou o conteúdo dela
    // no teclado. Não muda o texto de nada — só tira o buraco.
    const semCasca = c.replace(/<div class="cl">\s*<\/div>/g, '');
    if (semCasca !== c) {
      c = semCasca;
      reparos.push('casca de cláusula vazia removida');
    }

    if (textoVisivel(c).length < MINIMO_DE_TEXTO) {
      problemas.push('o documento ficaria sem texto nenhum');
    } else if (entrada.eraDesenhado) {
      if (!ehDesenhado(c)) {
        problemas.push('o documento perdeu o formato desenhado');
      }
      if (!/<style[\s>]/i.test(c)) {
        problemas.push('o estilo do documento foi apagado');
      }
      const temRaiz = RAIZES_DESENHADAS.some(r => new RegExp(`<div class="${r}[ "]`).test(c));
      if (!temRaiz) {
        problemas.push('a folha do documento foi apagada');
      }
    }

    out.content = c;
  }

  // ── html (o arquivo que vira PDF e link público) ──────────────────────────
  if (typeof entrada.html === 'string') {
    let h = entrada.html;

    if (/contenteditable/i.test(h)) {
      h = tiraContenteditable(h);
      reparos.push('contenteditable removido do arquivo');
    }

    // ATENÇÃO: aqui NÃO se desfaz o base64 da logo. O arquivo é uma página que
    // roda sozinha, no navegador de quem recebe e no Chromium que faz o PDF —
    // `{{LOGO}}` ali sairia impresso como texto e a logo não apareceria.

    if (!/<html[\s>]/i.test(h)) {
      problemas.push('o arquivo do documento saiu sem a página completa');
    }
    if (textoVisivel(h).length < MINIMO_DE_TEXTO) {
      problemas.push('o arquivo do documento ficaria em branco');
    }

    out.html = h;
  }

  return out;
}
