import api from './api';

/**
 * Download / compartilhamento de PDF que NÃO prende o app no iOS.
 *
 * HISTÓRICO (3 bugs, 3 abordagens):
 *  1. Blob + a.click() sintético → iOS Safari ignora ("nada acontece").
 *  2. window.location.href = url → navega o SHELL do PWA standalone pra fora →
 *     o cliente fica PRESO no PDF inline sem barra de navegador nem voltar.
 *  3. <iframe display:none> src=attachment → não prende (subframe não move o
 *     shell), MAS no iOS standalone é quase sempre um NO-OP: o Download Manager
 *     do iOS vive na chrome do Safari, que o PWA instalado não tem, então o
 *     attachment "carrega pra lugar nenhum". Destravou mas não baixava.
 *     (Confirmado ao vivo: o iOS abriu a folha "Abrir com..." em tela cheia e o
 *     app ficou preso atrás dela.)
 *
 * SOLUÇÃO (esta): navigator.share({files}) — a folha de compartilhamento NATIVA
 * do iOS ("Salvar em Arquivos", WhatsApp, etc). Ela abre POR CIMA do app e, ao
 * fechar/salvar, DEVOLVE o controle pro app — impossível prender. É também o
 * gesto certo pra "salvar PDF" no iPhone (iOS não tem download-pra-pasta).
 *
 * ARMADILHA CRÍTICA (transient activation): navigator.share SÓ pode ser chamado
 * SINCRONAMENTE dentro do gesto do usuário. Qualquer await ANTES dele (ex: o
 * fetch do PDF, que leva segundos por causa do Puppeteer) derruba a ativação →
 * NotAllowedError. Por isso a API é de 2 fases:
 *   - prewarmPdf(docId): dispare quando a TELA ABRE (ou o doc fica pronto).
 *     Busca o PDF e resolve num File. Guarde a Promise/File.
 *   - sharePrewarmedPdf(file): chame no onClick — SEM await antes. Se o File já
 *     estiver pronto, o share dispara na hora, dentro da ativação.
 * Fallback (desktop, Android, iOS<15, share indisponível/recusado): baixa o
 * blob por <a download> — que funciona fora do PWA-iOS-standalone.
 */

const PDF_MIME = 'application/pdf';

export type PdfAsset = { file: File; blob: Blob; filename: string };

/**
 * navigator.share só é o gesto CERTO no iOS, que não tem download-pra-pasta e
 * quebra <a download> no PWA standalone. Em DESKTOP (Windows/Mac) e Android o
 * navigator.canShare({files}) também retorna true, mas aí o share abre a folha
 * "Compartilhar" do SO (inútil pra salvar arquivo — Thiago viu no notebook: o
 * cliente clicou baixar e abriu o "Compartilhar" do Windows, sem baixar nada).
 * Por isso o share fica RESTRITO ao iOS; todo o resto baixa por <a download>.
 * Inclui iPadOS 13+, que se identifica como "MacIntel" + touch.
 */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iP(hone|od|ad)/.test(ua)) return true;
  // iPadOS 13+ mente que é Mac desktop; só o touch o denuncia.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

// Deriva o nome do arquivo do header Content-Disposition (o backend manda
// tipoSlug_clienteSlug.pdf); fallback pro docId.
function filenameFromDisposition(disposition: string | undefined, docId: string): string {
  if (disposition) {
    const m = disposition.match(/filename="?([^"]+)"?/i);
    if (m && m[1]) return m[1];
  }
  return `documento_${docId}.pdf`;
}

/**
 * Busca o PDF do servidor e o materializa como File pronto pra compartilhar.
 * Use Bearer no header (token FORA da URL). Dispare cedo (na abertura da tela)
 * pra o File estar pronto quando o usuário tocar em compartilhar.
 */
export async function prewarmPdf(docId: string): Promise<PdfAsset> {
  const res = await api.get(`/documents/${docId}/pdf`, { responseType: 'blob' });
  const blob: Blob = res.data;
  // Se o backend respondeu JSON de erro com content-type errado, o blob não é
  // PDF — detecta pra não "compartilhar" um erro.
  if (blob.type && blob.type.includes('application/json')) {
    const txt = await blob.text();
    throw new Error(txt || 'Falha ao gerar o PDF');
  }
  const filename = filenameFromDisposition(res.headers?.['content-disposition'], docId);
  const file = new File([blob], filename, { type: PDF_MIME });
  return { file, blob, filename };
}

/**
 * Compartilha/salva o PDF JÁ PRÉ-AQUECIDO. Chamar SÍNCRONO no onClick (sem
 * await antes) pra preservar a transient activation do iOS.
 * @returns 'shared' se abriu a folha nativa; 'downloaded' se caiu no fallback;
 *          'cancelled' se o usuário fechou a folha.
 */
export async function sharePrewarmedPdf(asset: PdfAsset): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const { file, blob, filename } = asset;

  // Caminho iOS: folha de compartilhamento nativa com o arquivo. SÓ no iOS —
  // em desktop/Android o canShare também é true, mas lá o share abre a folha
  // do SO em vez de baixar (bug do notebook Windows). Ver isIOS() acima.
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (isIOS() && nav?.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (err) {
      // Usuário cancelou a folha → NÃO é erro, fica onde estava.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Qualquer outra falha do share → cai no download.
    }
  }

  // Fallback (desktop/Android/iOS<15): baixa o blob por <a download>.
  downloadBlob(blob, filename);
  return 'downloaded';
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoga depois do clique ser processado.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Conveniência: busca + compartilha numa chamada. Aceitável em desktop/Android;
 * no iOS o await do fetch PODE derrubar a ativação e o share falhar → cai no
 * download (ainda funciona, sem prender). Para a MELHOR UX no iOS, prefira
 * prewarmPdf() na abertura da tela + sharePrewarmedPdf() no clique.
 *
 * @returns 'ok' | 'no-token' | 'error'
 */
export async function shareOrDownloadPdf(docId: string): Promise<'ok' | 'no-token' | 'error'> {
  try {
    const asset = await prewarmPdf(docId);
    await sharePrewarmedPdf(asset);
    return 'ok';
  } catch (err) {
    const e = err as { response?: { status?: number } };
    if (e?.response?.status === 401) return 'no-token';
    return 'error';
  }
}
