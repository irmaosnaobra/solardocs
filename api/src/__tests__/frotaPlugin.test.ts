import { describe, it, expect } from 'vitest';
import frota from '../data/frotaPluginMunicipio.json';
import municipios from '../data/municipios.json';

// Números conferidos na planilha do SENATRAN de julho/2026 no dia em que o
// arquivo foi gerado. Se a planilha for trocada, estes números mudam junto.
describe('frotaPluginMunicipio.json', () => {
  it('Brasil com 515.912 plug-ins (planilha inteira)', () => {
    expect(frota.brasil.plugin).toBe(515912);
    expect(frota.ref).toBe('julho/2026');
  });

  it('Uberlândia com 3.017 e Goiânia com 6.132', () => {
    const m = frota.municipios as Record<string, number[]>;
    expect(m['3170206'][1]).toBe(3017);
    expect(m['5208707'][1]).toBe(6132);
  });

  it('5.560 municípios casados ou mais', () => {
    expect(Object.keys(frota.municipios).length).toBeGreaterThanOrEqual(5560);
    expect(Object.keys(frota.municipios).length).toBeLessThanOrEqual((municipios as unknown[]).length);
  });

  it('a soma das UFs é o total com UF, e o total com UF cabe no Brasil', () => {
    const ufs = Object.values(frota.uf as Record<string, { frota: number; plugin: number }>);
    const soma = ufs.reduce((a, u) => ({ frota: a.frota + u.frota, plugin: a.plugin + u.plugin }), { frota: 0, plugin: 0 });
    expect(soma).toEqual(frota.brasil_com_uf);
    expect(ufs.length).toBe(27);
    expect(frota.brasil_com_uf.plugin).toBeLessThanOrEqual(frota.brasil.plugin);
  });

  it('nenhum município com mais plug-in que frota', () => {
    for (const [frotaMun, plugin] of Object.values(frota.municipios as Record<string, number[]>)) {
      expect(plugin).toBeLessThanOrEqual(frotaMun);
    }
  });
});
