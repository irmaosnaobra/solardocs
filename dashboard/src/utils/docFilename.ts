export function slugifyDocName(tipo: string, clienteNome: string): string {
  const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const t = strip(tipo || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const c = strip(clienteNome || 'documento').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `${t}_${c}`;
}
