import { describe, it, expect } from 'vitest';
import { hostDoSupabase, redePermitida } from '../utils/redePdf';

describe('rede permitida ao Chromium do PDF público', () => {
  const host = 'projeto.supabase.co';

  it('deixa passar data:, blob:, o Supabase do projeto e as fontes do template', () => {
    for (const u of [
      'data:image/png;base64,iVBORw0KGgo=', 'blob:https://x/abc', 'about:blank',
      'https://projeto.supabase.co/storage/v1/object/sign/documentos/portfolio/u/obra/1-abcdef.jpg?token=x',
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;800&display=swap',
      'https://fonts.gstatic.com/s/inter/v13/abc.woff2',
    ]) expect(redePermitida(u, host)).toBe(true);
  });

  it('aborta o resto: outros hosts, http, rede interna, metadados de nuvem, file:, host parecido', () => {
    for (const u of [
      'https://exemplo.com/x.png', 'http://projeto.supabase.co/x', 'http://169.254.169.254/latest/meta-data/',
      'http://localhost:3000/admin', 'https://127.0.0.1/x', 'file:///etc/passwd', 'ftp://projeto.supabase.co/x',
      'https://projeto.supabase.co.atacante.com/x', 'https://outro.supabase.co/x', 'https://fonts.googleapis.com.atacante.com/x',
      'texto qualquer', '',
    ]) expect(redePermitida(u, host)).toBe(false);
  });

  it('sem SUPABASE_URL válida, nenhuma imagem de Supabase passa (só data:, blob: e fontes)', () => {
    expect(hostDoSupabase({ SUPABASE_URL: '' } as NodeJS.ProcessEnv)).toBeNull();
    expect(hostDoSupabase({ SUPABASE_URL: 'lixo' } as NodeJS.ProcessEnv)).toBeNull();
    expect(hostDoSupabase({ SUPABASE_URL: 'https://projeto.supabase.co' } as NodeJS.ProcessEnv)).toBe('projeto.supabase.co');
    expect(redePermitida('https://projeto.supabase.co/x', null)).toBe(false);
    expect(redePermitida('data:image/png;base64,AA==', null)).toBe(true);
  });
});
