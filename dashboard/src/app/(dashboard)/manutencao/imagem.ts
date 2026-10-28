// Compressão de foto no navegador: 1568 px no maior lado, JPEG 0,82 (igual à Vistoria).

const MAX_DIM = 1568;

function lerComoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('Não consegui abrir o arquivo.'));
    r.readAsDataURL(file);
  });
}

export async function comprimirFoto(file: File): Promise<{ base64: string; preview: string }> {
  const dataUrl = await lerComoDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new window.Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Imagem inválida.'));
    im.src = dataUrl;
  });
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) > MAX_DIM) {
    const s = MAX_DIM / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Navegador sem suporte a canvas.');
  ctx.drawImage(img, 0, 0, w, h);
  const jpeg = canvas.toDataURL('image/jpeg', 0.82);
  return { base64: jpeg.split(',')[1] || '', preview: jpeg };
}
