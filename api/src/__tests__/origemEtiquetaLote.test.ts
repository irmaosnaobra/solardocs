import { describe, it, expect } from 'vitest';
import {
  ehCardSemAvisoAutomatico, ehOrigemEletroposto, etiquetaDeLead, ORIGEM_CADASTRO_EP,
} from '../services/agenda/origemEtiqueta';

// A origem da agenda em lote (13/10/2026). Uma função só decide quem os robôs
// calam; ela não pode pegar nenhuma das origens que falam.
describe('ehCardSemAvisoAutomatico', () => {
  it('é verdadeira só para cadastro_eletroposto', () => {
    expect(ehCardSemAvisoAutomatico('cadastro_eletroposto')).toBe(true);
    expect(ehCardSemAvisoAutomatico(' Cadastro_Eletroposto ')).toBe(true);
    expect(ORIGEM_CADASTRO_EP).toBe('cadastro_eletroposto');
  });

  it('é falsa para toda origem que fala hoje', () => {
    for (const o of ['lp_eletroposto', 'manychat_eletroposto', 'prosp_eletroposto', 'agente_eletroposto',
      'convite_investidor_eletroposto', 'ep-trafego', 'lp_solar', 'manychat', '', null, undefined]) {
      expect(ehCardSemAvisoAutomatico(o)).toBe(false);
    }
  });

  it('não é pela palavra eletroposto: um "cadastro_eletroposto_2" não herda o silêncio', () => {
    expect(ehCardSemAvisoAutomatico('cadastro_eletroposto_2')).toBe(false);
  });

  it('o card continua sendo da família eletroposto (quadro, CRM e repasse)', () => {
    expect(ehOrigemEletroposto('cadastro_eletroposto')).toBe(true);
  });

  it('a etiqueta de origem é "EP Cadastro"', () => {
    expect(etiquetaDeLead('cadastro_eletroposto', null, new Set())).toBe('EP Cadastro');
  });
});
