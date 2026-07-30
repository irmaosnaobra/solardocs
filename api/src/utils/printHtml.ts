// Script de impressão direta: abre a caixa de impressão do browser e fecha a aba
// quando termina. Serve pro fluxo "abrir pra imprimir" (/documents/:id/html) — e
// SÓ pra ele.
//
// Ele já morou dentro do HTML salvo no Storage, e como o /p/:id e o PDF servem
// esse mesmo arquivo, o cliente que abria o link da proposta levava uma caixa de
// impressão na cara (e o gerador de PDF precisou desligar o JavaScript pra o
// window.close() não matar a página antes do page.pdf()). Por isso agora o
// arquivo é guardado limpo e o script entra só na hora de servir pra impressão.
const PRINT_SCRIPT = `<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>`;

export function injectPrint(html: string): string {
  return html.includes('window.print') ? html : html.replace('</body>', PRINT_SCRIPT + '</body>');
}

// Tira o script de qualquer HTML — inclusive dos arquivos antigos, que subiram pro
// Storage já com ele dentro. É o que mantém as propostas velhas abrindo em paz.
export function stripPrint(html: string): string {
  return html.replace(/<script>window\.onload=function\(\)\{window\.print\(\);window\.onafterprint=function\(\)\{window\.close\(\);\};\};<\/script>/g, '');
}
