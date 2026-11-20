import { describe, it, expect } from 'vitest';
import { descricaoDoKit } from '../services/gerador/jornadaObra';

describe('descricaoDoKit', () => {
  it('monta tipo, modelo e potência quando o modelo não traz nada disso', () => {
    expect(descricaoDoKit('Módulo', 'Canadian CS7N', 590)).toBe('Módulo Canadian CS7N 590 W');
    expect(descricaoDoKit('Inversor', 'Growatt 10K')).toBe('Inversor Growatt 10K');
  });

  it('não repete a potência que já vem no nome do modelo', () => {
    expect(descricaoDoKit('Módulo', 'Canadian CS7N 590W', 590)).toBe('Módulo Canadian CS7N 590W');
  });

  it('não repete o tipo que já vem no começo do modelo, com ou sem acento', () => {
    expect(descricaoDoKit('Módulo', 'Modulo fotovoltaico 550 W', 550)).toBe('Modulo fotovoltaico 550 W');
    expect(descricaoDoKit('Inversor', 'inversor on-grid 5 kW')).toBe('inversor on-grid 5 kW');
  });

  it('sem modelo fica só o tipo', () => {
    expect(descricaoDoKit('Módulo', '', null)).toBe('Módulo');
  });
});
