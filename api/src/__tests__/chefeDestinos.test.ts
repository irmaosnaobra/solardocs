import { describe, it, expect, vi } from 'vitest';
import { chaveDoContato, ehGrupo, ehDestinoInterno } from '../services/chefe/destinos';

// ─────────────────────────────────────────────────────────────────────────────
// Destino da equipe vira aviso_interno. A comparação tem de ser a MESMA do
// silenciar.ts (DDD + 8 dígitos), senão o nono dígito ou o 55 fazem o celular
// do consultor passar por lead, ou o lead passar por consultor. A função foi
// reescrita no núcleo (o silenciar puxa o supabase), então este teste prova que
// as duas dão a mesma chave. Telefones daqui são fictícios.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) , rpc: () => Promise.resolve({}) } }));

const AMOSTRA = [
  '34900000001', '5534900000001', '+55 (34) 90000-0001', '3400000001', '553400000001',
  '11987650000', '5511987650000', '1187650000', '55 11 8765-0000',
  '120363000000000000-group', '253068247589084@lid', '999', '', '  ', null, undefined,
  '00000000000000', '551', '5534',
];

describe('chave do contato', () => {
  it('dá a mesma chave do silenciar.ts para toda a amostra', async () => {
    const { chaveContato } = await import('../services/agents/whatsapp/silenciar');
    for (const tel of AMOSTRA) expect({ tel, k: chaveDoContato(tel) }).toEqual({ tel, k: chaveContato(tel) });
  });

  it('com e sem 55 e com e sem nono dígito dão a mesma chave', () => {
    const k = chaveDoContato('34900000001');
    expect(k).toBe('3400000001');
    expect(chaveDoContato('5534900000001')).toBe(k);
    expect(chaveDoContato('3400000001')).toBe(k);
    expect(chaveDoContato('+55 (34) 90000-0001')).toBe(k);
  });
});

describe('destino interno', () => {
  const equipe = ['34900000001', '34900000002'];

  it('número da equipe, em qualquer formato, é interno', () => {
    expect(ehDestinoInterno('5534900000001', equipe)).toBe(true);
    expect(ehDestinoInterno('34 90000-0002', equipe)).toBe(true);
    expect(ehDestinoInterno('3400000001', equipe)).toBe(true);
  });

  it('lead é externo, inclusive com a equipe vazia', () => {
    expect(ehDestinoInterno('5534900000099', equipe)).toBe(false);
    expect(ehDestinoInterno('5534900000001', [])).toBe(false);
  });

  it('grupo é interno; LID e lixo não são', () => {
    expect(ehGrupo('120363000000000000-group')).toBe(true);
    expect(ehGrupo('120363000000000000@g.us')).toBe(true);
    expect(ehDestinoInterno('120363000000000000-group', [])).toBe(true);
    expect(ehDestinoInterno('253068247589084@lid', equipe)).toBe(false);
    expect(ehDestinoInterno('', equipe)).toBe(false);
    expect(ehDestinoInterno(null, equipe)).toBe(false);
  });
});
