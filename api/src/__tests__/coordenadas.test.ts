import { describe, it, expect } from 'vitest';
import { lerCoordenadas } from '../services/gerador/coordenadas';
import { validarCampo } from '../services/gerador/cadastroVenda';

describe('coordenadas do projeto', () => {
  it('aceita o formato que o Google Maps copia e as variações comuns', () => {
    for (const t of ['-18.912345, -48.275432', '-18.912345,-48.275432', ' -18.912345 -48.275432 ', '-18,912345; -48,275432', '18.912345 S, 48.275432 W', '-18.912345°, -48.275432°']) {
      const c = lerCoordenadas(t);
      expect(c, t).toMatchObject({ ok: true, lat: -18.912345, lon: -48.275432, texto: '-18.912345, -48.275432' });
    }
  });
  it('recusa lixo e fora do intervalo, sem repetir o que foi digitado', () => {
    for (const t of ['', 'abc', '-17.5', '1, 2, 3', '91, 10', '-91, 10', '10, 181', '10, -181']) {
      const c = lerCoordenadas(t);
      expect(c.ok, t).toBe(false);
      if (!c.ok && t) expect(c.erro).not.toContain(t);
    }
    expect(lerCoordenadas('90, 180').ok).toBe(true);
    // letra trocada: latitude só N/S, longitude só E/W/L/O
    for (const t of ['18.9 W, 48.2 S', '18.9 E, 48.2 N', '18.9S, 48.2S']) expect(lerCoordenadas(t).ok, t).toBe(false);
    expect(lerCoordenadas('18.9 S, 48.2 O')).toMatchObject({ ok: true, lat: -18.9, lon: -48.2 });
  });
  it('o cadastro guarda normalizado: coordenadas, disjuntor em ampères, tipo do disjuntor e UF do ponto', () => {
    expect(validarCampo('coordenadas', '-18,9; -48,2')).toEqual({ ok: true, valor: '-18.9, -48.2' });
    expect(validarCampo('coordenadas', '120, 10').ok).toBe(false);
    expect(validarCampo('disjuntor_a', '63 A')).toEqual({ ok: true, valor: '63' });
    expect(validarCampo('disjuntor_a', '0').ok).toBe(false);
    expect(validarCampo('disjuntor_a', '12,5').ok).toBe(false);
    expect(validarCampo('disjuntor_tipo', 'trifasico')).toEqual({ ok: true, valor: 'Trifásico' });
    expect(validarCampo('disjuntor_tipo', 'Bifásico')).toEqual({ ok: true, valor: 'Bifásico' });
    expect(validarCampo('disjuntor_tipo', 'quadrifásico').ok).toBe(false);
    expect(validarCampo('uf_ponto', 'go')).toEqual({ ok: true, valor: 'GO' });
    expect(validarCampo('uf_ponto', 'XX').ok).toBe(false);
  });
  it('a lista de materiais aceita até 300 caracteres; os outros campos, 200', () => {
    expect(validarCampo('materiais', 'a'.repeat(300)).ok).toBe(true);
    expect(validarCampo('materiais', 'a'.repeat(301)).ok).toBe(false);
    expect(validarCampo('endereco_ponto', 'a'.repeat(201)).ok).toBe(false);
    expect(validarCampo('materiais', 'Cabo 10 mm, R$ 3.000').ok).toBe(false);
    expect(validarCampo('materiais', 'Cabo, 3 mil reais').ok).toBe(false);
    for (const t of ['Cabo 1.500,00', 'sinal de 30%', 'Cabo, valor combinado', 'preço do kit', 'parcelas', 'desconto']) expect(validarCampo('materiais', t).ok, t).toBe(false);
    expect(validarCampo('materiais', 'Cabo 10 mm, haste').ok).toBe(true);
  });
});
