import { getToken } from './auth';

/**
 * Baixa o PDF de um documento SEM prender o app.
 *
 * CONTEXTO DO BUG (jul/2026): o SolarDoc roda como PWA instalado (ícone na tela,
 * sem barra de navegador). O download antigo fazia `window.location.href = url`,
 * que navegava o PRÓPRIO shell do app pra fora da tela. No iOS o endpoint de PDF
 * costuma ser renderizado INLINE em vez de baixar → o cliente ficava preso numa
 * página de PDF sem botão voltar ("não baixa E não volta ao menu").
 *
 * SOLUÇÃO — iframe oculto: a rota `/documents/:id/pdf` responde com
 * `Content-Disposition: attachment`, então carregar a URL num <iframe> invisível
 * DISPARA o download sem navegar o shell. O app fica intacto na tela onde estava.
 * Escolhido no lugar de `window.open(_, '_blank')` porque o iOS em modo
 * standalone (PWA instalado) frequentemente IGNORA o `_blank` — o clique não
 * abre nada ("botão morto"), que seria pior que o bug original. O iframe não
 * depende desse comportamento.
 *
 * Sem blob de propósito: `createObjectURL` + `a.click()` também quebra no iOS.
 *
 * Se o endpoint falhar (JSON de erro, sem attachment), o iframe só carrega o
 * erro invisivelmente — o app NÃO é levado pra lugar nenhum e o usuário
 * continua na tela, podendo tentar de novo.
 *
 * @returns 'ok' se disparou o download; 'no-token' se a sessão expirou.
 */
export function downloadDocumentPdf(docId: string): 'ok' | 'no-token' {
  const token = getToken();
  if (!token) return 'no-token';

  // URL mesma-origem (/_api em produção) evita o cross-origin do
  // solardocs-api.vercel.app. O token vai na query porque navegação/iframe não
  // manda header Authorization (a rota aceita ?token= via downloadAuth).
  const base = (typeof window !== 'undefined' && window.location.hostname !== 'localhost')
    ? '/_api'
    : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');
  const url = `${base}/documents/${docId}/pdf?token=${encodeURIComponent(token)}`;

  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  // Remove depois que o download foi disparado (o attachment já está em voo;
  // remover o iframe não cancela o download). 60s cobre PDFs lentos de gerar.
  window.setTimeout(() => { iframe.remove(); }, 60_000);

  return 'ok';
}
