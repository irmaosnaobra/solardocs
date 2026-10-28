import { describe, it, expect } from 'vitest';
import {
  ITENS_COM_STATUS, calcularSelo, montarConclusao, pendencias, resumo, sanitizarStatus,
} from '../services/vistoria/avaliacao';

// Regras puras da avaliação da vistoria: selo, pendências e conclusão calculados pelo servidor.

const rotulos: Record<string, string> = {
  padrao: 'Padrão de entrada', telhado: 'Telhado', inversores: 'Local dos inversores / Disjuntor C.A',
};
const itens = (comFoto: string[] = []) =>
  ['conta_luz', 'documento_pessoal', ...ITENS_COM_STATUS].map((key) => ({
    key, label: rotulos[key] ?? key, fotos: comFoto.includes(key) ? [{ url: 'x' }] : [],
  }));

describe('selo', () => {
  it('sem nenhum status não há selo', () => {
    expect(calcularSelo({})).toBeNull();
    expect(calcularSelo(undefined)).toBeNull();
    expect(calcularSelo(null)).toBeNull();
  });
  it('só N/A não gera selo', () => {
    expect(calcularSelo({ padrao: 'na', telhado: 'na' })).toBeNull();
  });
  it('chave fora dos 10 itens técnicos é ignorada', () => {
    expect(calcularSelo({ conta_luz: 'nao_conforme', inventada: 'atencao' })).toBeNull();
  });
  it('valor inválido é ignorado', () => {
    expect(calcularSelo({ padrao: 'otimo' })).toBeNull();
  });
  it('tudo conforme (com N/A no meio) é conforme', () => {
    expect(calcularSelo({ padrao: 'conforme', medidor: 'na', telhado: 'conforme' })).toBe('conforme');
  });
  it('um atenção vence o conforme', () => {
    expect(calcularSelo({ padrao: 'conforme', telhado: 'atencao' })).toBe('atencao');
  });
  it('um não conforme vence tudo', () => {
    expect(calcularSelo({ padrao: 'atencao', telhado: 'nao_conforme', medidor: 'conforme' })).toBe('nao_conforme');
  });
});

describe('sanitizarStatus', () => {
  it('deixa só chave técnica com valor válido', () => {
    expect(sanitizarStatus({ padrao: 'conforme', conta_luz: 'conforme', telhado: 'x', medidor: 'na', quadro_distribuicao: 3 }))
      .toEqual({ padrao: 'conforme', medidor: 'na' });
  });
  it('não aceita lista nem texto', () => {
    expect(sanitizarStatus([])).toEqual({});
    expect(sanitizarStatus('conforme')).toEqual({});
  });
});

describe('pendências', () => {
  it('alta antes de média, e cada grupo na ordem do checklist', () => {
    const p = pendencias(
      { telhado: 'atencao', padrao: 'atencao', sombreamento: 'nao_conforme', medidor: 'nao_conforme', estrutura: 'conforme' },
      itens(),
    );
    expect(p.map((x) => x.key)).toEqual(['medidor', 'sombreamento', 'padrao', 'telhado']);
    expect(p.map((x) => x.prioridade)).toEqual(['alta', 'alta', 'media', 'media']);
  });
  it('usa o label do item e o rótulo curto separado', () => {
    const [p] = pendencias({ inversores: 'atencao' }, itens());
    expect(p!.label).toBe('Local dos inversores / Disjuntor C.A');
    expect(p!.rotulo).toBe('inversores e disjuntor C.A');
  });
  it('conforme e N/A não viram pendência', () => {
    expect(pendencias({ padrao: 'conforme', telhado: 'na' }, itens())).toEqual([]);
  });
});

describe('conclusão', () => {
  it('sem selo é nula', () => {
    expect(montarConclusao(itens(), {})).toBeNull();
  });
  it('conforme', () => {
    expect(montarConclusao(itens(['padrao', 'telhado']), { padrao: 'conforme' })).toBe(
      'O técnico registrou fotos em 2 de 12 itens nesta vistoria. Todos os itens avaliados estão conformes para a instalação.',
    );
  });
  it('foto no singular quando só 1 item tem foto', () => {
    expect(montarConclusao(itens(['padrao']), { padrao: 'conforme' })).toContain('registrou foto em 1 de 12 itens');
  });
  it('atenção no plural, com "e" na lista', () => {
    expect(montarConclusao(itens(['padrao']), { padrao: 'atencao', telhado: 'atencao' })).toBe(
      'O técnico registrou foto em 1 de 12 itens nesta vistoria. Não há não conformidade registrada, mas há pontos de atenção em padrão de entrada e telhado. Recomendamos tratar esses pontos antes ou durante a instalação.',
    );
  });
  it('atenção no singular', () => {
    expect(montarConclusao(itens(['padrao', 'telhado']), { inversores: 'atencao' })).toBe(
      'O técnico registrou fotos em 2 de 12 itens nesta vistoria. Não há não conformidade registrada, mas há ponto de atenção em inversores e disjuntor C.A. Recomendamos tratar esse ponto antes ou durante a instalação.',
    );
  });
  it('não conforme lista só os não conformes, no plural', () => {
    const t = montarConclusao(itens(['padrao', 'telhado']), { padrao: 'nao_conforme', telhado: 'nao_conforme', medidor: 'atencao' })!;
    expect(t).toBe(
      'O técnico registrou fotos em 2 de 12 itens nesta vistoria. Foram encontradas não conformidades em padrão de entrada e telhado. Recomendamos adequar esses pontos antes da instalação.',
    );
    expect(t).not.toContain('medidor');
  });
  it('não conforme no singular, com três itens separados por vírgula e "e"', () => {
    expect(montarConclusao(itens(['padrao', 'telhado']), { telhado: 'nao_conforme' })).toBe(
      'O técnico registrou fotos em 2 de 12 itens nesta vistoria. Foi encontrada não conformidade em telhado. Recomendamos adequar esse ponto antes da instalação.',
    );
    expect(montarConclusao(itens(), { padrao: 'nao_conforme', medidor: 'nao_conforme', telhado: 'nao_conforme' })).toContain('em padrão de entrada, medidor e telhado');
  });
  it('nenhum texto tem travessão', () => {
    const t = [
      montarConclusao(itens(['padrao']), { padrao: 'conforme' }),
      montarConclusao(itens(['padrao']), { padrao: 'atencao' }),
      montarConclusao(itens(['padrao']), { padrao: 'nao_conforme' }),
    ].join(' ');
    expect(t).not.toMatch(/[—–]/);
  });
});

describe('resumo', () => {
  it('junta tudo', () => {
    const r = resumo(itens(['padrao', 'telhado']), { padrao: 'nao_conforme', telhado: 'atencao' });
    expect(r.selo).toBe('nao_conforme');
    expect(r.pendencias).toHaveLength(2);
    expect(r.itensComFoto).toBe(2);
    expect(r.totalItens).toBe(12);
    expect(r.conclusao).toContain('Foi encontrada não conformidade em padrão de entrada.');
  });
  it('sem status: sem selo, sem pendências, sem conclusão', () => {
    expect(resumo(itens(['padrao']), {})).toEqual({ selo: null, pendencias: [], conclusao: null, itensComFoto: 1, totalItens: 12 });
  });
});
