// Gera os PDFs baixáveis do Kit de Fechamento a partir do MESMO conteúdo que a
// plataforma mostra (dashboard/.../_conteudo/*.ts) — uma fonte só, sem cópia
// que envelhece. Rodar quando o conteúdo mudar:
//   cd api && npx ts-node --transpile-only scripts/gerar-pdfs-kit.ts
// Saída: dashboard/public/kit/downloads/*.pdf (commitados no repo).
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const puppeteer = require('../../node_modules/puppeteer');

const BASE = path.resolve(__dirname, '../../dashboard/src/app/(dashboard)/materiais/_conteudo');
const OUT = path.resolve(__dirname, '../../dashboard/public/kit/downloads');

/* eslint-disable @typescript-eslint/no-var-requires */
const { OBJECOES, TOTAL_OBJECOES } = require(path.join(BASE, 'objecoes.ts'));
const { ROTEIRO, CINCO_PERGUNTAS } = require(path.join(BASE, 'roteiro.ts'));
const { ESTRUTURA_CUSTO, REGRAS_DE_MARGEM, CHECKLIST_ORCAMENTO } = require(path.join(BASE, 'precificacao.ts'));
const { PROSPECCAO, TOTAL_MENSAGENS } = require(path.join(BASE, 'prospeccao.ts'));
const { POS_VENDA, GARANTIAS } = require(path.join(BASE, 'posvenda.ts'));
/* eslint-enable @typescript-eslint/no-var-requires */

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
  @page { size: A4; margin: 17mm 15mm 20mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, Arial, sans-serif; color: #17212e; font-size: 10.6pt; line-height: 1.6; margin: 0; }
  .capa { height: 258mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .capa .marca { font-size: 9pt; letter-spacing: .28em; text-transform: uppercase; color: #c2760f; font-weight: 800; margin-bottom: 14mm; }
  .capa h1 { font-size: 30pt; line-height: 1.1; letter-spacing: -.02em; margin: 0 0 6mm; font-weight: 800; }
  .capa .sub { font-size: 12pt; color: #55636f; max-width: 105mm; line-height: 1.55; }
  .capa .faixa { width: 34mm; height: 3.2mm; background: #f0a01e; border-radius: 2mm; margin: 9mm 0; }
  .capa .rodape { margin-top: auto; font-size: 8.6pt; color: #8a949e; border-top: 1px solid #e3e7ea; padding-top: 4mm; }
  h2 { font-size: 15pt; margin: 9mm 0 2mm; letter-spacing: -.01em; page-break-after: avoid; }
  h2:first-of-type { margin-top: 0; }
  h3 { font-size: 11.6pt; margin: 6mm 0 1.5mm; page-break-after: avoid; }
  p { margin: 0 0 2.6mm; }
  .desc { color: #55636f; font-size: 10pt; margin-bottom: 5mm; }
  /* O bloco pode quebrar entre páginas: com 26 objeções, forçar 'avoid' deixava
     uma por folha e o PDF virava um catálogo de espaço em branco. O que NÃO pode
     quebrar é a fala pronta — essa o integrador lê de uma vez, na frente do cliente. */
  .bloco { border: 1px solid #e3e7ea; border-radius: 3mm; padding: 4.5mm 5.5mm; margin-bottom: 4mm; page-break-inside: auto; }
  .script, .zap { page-break-inside: avoid; }
  .gatilho { font-size: 12.4pt; font-weight: 700; font-style: italic; margin-bottom: 3mm; }
  .rot { font-size: 7.4pt; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; color: #8a949e; display: block; margin-bottom: .6mm; }
  .rot.erro { color: #b4412f; }
  .rot.script { color: #c2760f; }
  .rot.zap { color: #14804f; }
  .script { background: #fdf6e9; border-left: 2.6mm solid #f0a01e; padding: 3.4mm 4.4mm; border-radius: 0 2mm 2mm 0; margin: 3mm 0 2.6mm; }
  .zap { background: #f0f8f4; border-left: 2.6mm solid #14804f; padding: 3.4mm 4.4mm; border-radius: 0 2mm 2mm 0; }
  ul, ol { margin: 0 0 2.6mm; padding-left: 5.5mm; }
  li { margin-bottom: 1.4mm; }
  table { width: 100%; border-collapse: collapse; font-size: 9.4pt; margin-bottom: 4mm; page-break-inside: avoid; }
  th { text-align: left; font-size: 7.6pt; letter-spacing: .1em; text-transform: uppercase; color: #8a949e; border-bottom: 1px solid #d8dde1; padding: 2mm 2.5mm; }
  td { border-bottom: 1px solid #eef1f3; padding: 2.4mm 2.5mm; vertical-align: top; }
  td.n { text-align: right; white-space: nowrap; font-weight: 700; color: #c2760f; }
  .nota { font-size: 9pt; color: #55636f; }
  .check { list-style: none; padding-left: 0; }
  .check li { padding-left: 6mm; position: relative; }
  .check li::before { content: '☐'; position: absolute; left: 0; color: #c2760f; }
  .passo { display: flex; gap: 4mm; align-items: baseline; }
  .num { font-size: 15pt; font-weight: 800; color: #f0a01e; }
  .fase { font-size: 7.6pt; letter-spacing: .12em; text-transform: uppercase; color: #8a949e; }
`;

function capa(numero: string, titulo: string, sub: string): string {
  return `<div class="capa">
    <div class="marca">Kit de Fechamento do Integrador · ${esc(numero)}</div>
    <h1>${esc(titulo)}</h1>
    <div class="faixa"></div>
    <p class="sub">${esc(sub)}</p>
    <div class="rodape">SolarDoc Pro — documentos e ferramentas para integradores solares · solardoc.app<br>
    Material de uso individual do comprador. A versão sempre atualizada fica na sua conta, em Meus Materiais.</div>
  </div>`;
}

function doc(inner: string): string {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${inner}</body></html>`;
}

// ── Conteúdo de cada PDF ────────────────────────────────────────────────────
type Grupo = { titulo: string; descricao: string; itens: any[] };

const pdfObjecoes = doc(
  capa('Módulo 1', 'As objeções que travam a venda', `${TOTAL_OBJECOES} respostas prontas para o que o cliente fala quando você entrega a proposta — o que ele quer dizer, o erro que quase todo integrador comete e a fala pronta, com a versão curta para o WhatsApp.`) +
  (OBJECOES as Grupo[]).map((g) => `
    <h2>${esc(g.titulo)}</h2>
    <p class="desc">${esc(g.descricao)}</p>
    ${g.itens.map((o: any) => `
      <div class="bloco">
        <div class="gatilho">&ldquo;${esc(o.gatilho)}&rdquo;</div>
        <span class="rot">O que ele quer dizer</span><p>${esc(o.traducao)}</p>
        <span class="rot erro">Erro comum</span><p>${esc(o.erro)}</p>
        <div class="script"><span class="rot script">Fala pronta</span><p style="margin:0">${esc(o.script)}</p></div>
        <div class="zap"><span class="rot zap">No WhatsApp</span><p style="margin:0">${esc(o.whatsapp)}</p></div>
      </div>`).join('')}
  `).join(''),
);

const pdfRoteiro = doc(
  capa('Módulo 2', 'Da primeira ligação à assinatura', 'O caminho inteiro da visita técnica: o que fazer em cada etapa, o que falar e a armadilha que mata a venda naquele ponto — mais as 5 perguntas para o cliente fazer em todos os orçamentos.') +
  (ROTEIRO as any[]).map((p, i) => `
    <div class="bloco">
      <div class="passo"><span class="num">${String(i + 1).padStart(2, '0')}</span>
        <div><span class="fase">${esc(p.fase)}</span><h3 style="margin:0">${esc(p.titulo)}</h3></div></div>
      <p style="margin-top:3mm">${esc(p.objetivo)}</p>
      <ul>${p.acoes.map((a: string) => `<li>${esc(a)}</li>`).join('')}</ul>
      ${p.fala ? `<div class="script"><span class="rot script">Fala pronta</span><p style="margin:0">${esc(p.fala)}</p></div>` : ''}
      <span class="rot erro" style="margin-top:3mm">Armadilha</span><p style="margin:0">${esc(p.armadilha)}</p>
    </div>`).join('') +
  `<h2>${esc(CINCO_PERGUNTAS.titulo)}</h2><p class="desc">${esc(CINCO_PERGUNTAS.intro)}</p>
   <ol>${CINCO_PERGUNTAS.perguntas.map((q: string) => `<li>${esc(q)}</li>`).join('')}</ol>`,
);

const pdfPreco = doc(
  capa('Módulo 3', 'Preço e margem sem chute', 'Para onde vai cada real do orçamento, as quatro regras que protegem a margem e o checklist de 10 itens antes de mandar a proposta. A planilha com as fórmulas vem junto, em arquivo separado.') +
  `<h2>Para onde vai cada real</h2>
   <p class="desc">Faixas de referência sobre o preço final de venda. Se uma linha estiver muito fora, é ali que a margem está sumindo.</p>
   <table><thead><tr><th>Item</th><th>O que é</th><th style="text-align:right">Faixa</th></tr></thead><tbody>
   ${(ESTRUTURA_CUSTO as any[]).map((l) => `<tr>
      <td style="font-weight:700;white-space:nowrap">${esc(l.item)}</td>
      <td>${esc(l.descricao)}${l.atencao ? `<br><span class="nota">${esc(l.atencao)}</span>` : ''}</td>
      <td class="n">${esc(l.faixa)}</td></tr>`).join('')}
   </tbody></table>
   <h2>Quatro regras que protegem a margem</h2>
   ${(REGRAS_DE_MARGEM as any[]).map((r) => `<div class="bloco"><h3 style="margin-top:0">${esc(r.titulo)}</h3><p style="margin:0">${esc(r.texto)}</p></div>`).join('')}
   <h2>Checklist antes de mandar a proposta</h2>
   <ul class="check">${(CHECKLIST_ORCAMENTO as string[]).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`,
);

const pdfProspeccao = doc(
  capa('Módulo 5', 'Prospecção e follow-up', `${TOTAL_MENSAGENS} mensagens prontas para primeiro contato, follow-up depois da proposta, reativação de orçamento antigo e pedido de indicação — cada uma com o momento certo de usar e o motivo de funcionar.`) +
  (PROSPECCAO as any[]).map((b) => `
    <h2>${esc(b.titulo)}</h2>
    <p class="desc">${esc(b.descricao)}</p>
    ${b.mensagens.map((m: any) => `
      <div class="bloco">
        <h3 style="margin-top:0">${esc(m.situacao)}</h3>
        <span class="rot">Quando usar</span><p>${esc(m.quando)}</p>
        <div class="script"><span class="rot script">Mensagem</span><p style="margin:0">${esc(m.texto)}</p></div>
        <span class="rot" style="margin-top:3mm">Por que funciona</span><p style="margin:0">${esc(m.porque)}</p>
      </div>`).join('')}
  `).join(''),
);

const pdfPos = doc(
  capa('Módulo 6', 'Pós-venda, garantia e recorrência', 'O que acontece depois do sim define se você vendeu uma vez ou três. As cinco janelas do pós-venda, o que dizer em cada uma, e como separar as três garantias que todo cliente pergunta.') +
  (POS_VENDA as any[]).map((e) => `
    <div class="bloco">
      <span class="fase">${esc(e.janela)}</span>
      <h3 style="margin-top:0">${esc(e.titulo)}</h3>
      <ul>${e.oQueFazer.map((a: string) => `<li>${esc(a)}</li>`).join('')}</ul>
      ${e.mensagem ? `<div class="script"><span class="rot script">Mensagem pronta</span><p style="margin:0">${esc(e.mensagem)}</p></div>` : ''}
      <span class="rot erro" style="margin-top:3mm">Risco de pular esta etapa</span><p style="margin:0">${esc(e.risco)}</p>
    </div>`).join('') +
  `<h2>${esc(GARANTIAS.titulo)}</h2><p class="desc">${esc(GARANTIAS.intro)}</p>
   ${GARANTIAS.itens.map((g: any) => `<div class="bloco">
      <h3 style="margin-top:0">${esc(g.tipo)} <span class="nota">— responsável: ${esc(g.dono)}</span></h3>
      <p style="margin:0">${esc(g.texto)}</p></div>`).join('')}
   <p><strong>${esc(GARANTIAS.fechamento)}</strong></p>`,
);

const ARQUIVOS: Array<[string, string]> = [
  ['modulo-1-objecoes.pdf', pdfObjecoes],
  ['modulo-2-roteiro-da-visita.pdf', pdfRoteiro],
  ['modulo-3-preco-e-margem.pdf', pdfPreco],
  ['modulo-5-prospeccao.pdf', pdfProspeccao],
  ['modulo-6-pos-venda.pdf', pdfPos],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  for (const [nome, html] of ARQUIVOS) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: path.join(OUT, nome),
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font-size:7.5pt;color:#9aa4ae;padding:0 15mm;display:flex;justify-content:space-between;font-family:Segoe UI,Arial,sans-serif;">' +
        '<span>Kit de Fechamento do Integrador · SolarDoc Pro</span>' +
        '<span class="pageNumber"></span></div>',
      margin: { top: '17mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
    const kb = Math.round(fs.statSync(path.join(OUT, nome)).size / 1024);
    console.log(`  ${nome} — ${kb} KB`);
  }

  await browser.close();
  console.log('\nPDFs gerados em dashboard/public/kit/downloads/');
})();
