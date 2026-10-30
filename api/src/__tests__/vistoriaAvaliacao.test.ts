import { describe, it, expect } from 'vitest';
import {
  EXPLICA, ITENS_COM_STATUS, PROXIMOS_PASSOS, SELO_PARCIAL, calcularSelo, cobertura, frasePlacar, juntarLista, montarConclusao,
  pendencias, proximosPassos, resumo, sanitizarStatus,
} from '../services/vistoria/avaliacao';

// Regras puras da avaliação da vistoria: selo, pendências e conclusão calculados pelo servidor, mais a cobertura
// (quantos dos 10 itens foram avaliados), o placar, a frase de cada item e os próximos passos do relatório.

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

// ── Cobertura, placar, explicação por item e próximos passos (relatório de 29/10/2026) ─────────────

const todos = (status: string) => Object.fromEntries(ITENS_COM_STATUS.map((k) => [k, status]));
const SEM_TRAVESSAO_NEM_EMOJI = /[\u{2013}\u{2014}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

describe('cobertura', () => {
  it('sem status: nenhum avaliado e todos os 10 itens faltam, na ordem do checklist', () => {
    expect(cobertura({})).toEqual({ avaliados: 0, total: 10, faltam: ITENS_COM_STATUS });
    expect(cobertura(undefined).avaliados).toBe(0);
    expect(cobertura(null).faltam).toEqual(ITENS_COM_STATUS);
    expect(cobertura([]).avaliados).toBe(0);
  });
  it('qualquer status válido conta, inclusive N/A', () => {
    const c = cobertura({ padrao: 'conforme', medidor: 'na', telhado: 'nao_conforme', sombreamento: 'atencao' });
    expect(c.avaliados).toBe(4);
    expect(c.total).toBe(10);
    expect(c.faltam).toEqual(['disjuntor_padrao', 'quadro_distribuicao', 'inversores', 'tipo_telha', 'estrutura', 'cabeamento']);
  });
  it('chave fora dos 10 itens técnicos e valor inválido não contam', () => {
    const c = cobertura({ conta_luz: 'conforme', documento_pessoal: 'conforme', inventada: 'atencao', padrao: 'otimo' });
    expect(c.avaliados).toBe(0);
    expect(c.faltam).toEqual(ITENS_COM_STATUS);
  });
  it('os 10 avaliados: nada falta', () => {
    expect(cobertura(todos('conforme'))).toEqual({ avaliados: 10, total: 10, faltam: [] });
  });
});

describe('frasePlacar', () => {
  it('sem status devolve texto vazio', () => {
    expect(frasePlacar({})).toBe('');
    expect(frasePlacar(undefined)).toBe('');
    expect(frasePlacar({ conta_luz: 'conforme', padrao: 'otimo' })).toBe('');
  });
  it('com os 10 itens: "10 itens avaliados" e as quatro partes, com vírgula e "e" no último', () => {
    const s = { ...todos('conforme'), telhado: 'atencao', tipo_telha: 'atencao', estrutura: 'atencao', cabeamento: 'nao_conforme', sombreamento: 'nao_conforme', medidor: 'na' };
    // padrao, disjuntor_padrao, quadro_distribuicao, inversores = 4 conformes
    expect(frasePlacar(s)).toBe('10 itens avaliados: 4 conformes, 3 com atenção, 2 não conformes e 1 não se aplica.');
  });
  it('com menos de 10 itens: "n de 10 itens avaliados"', () => {
    expect(frasePlacar({ padrao: 'conforme', medidor: 'conforme', telhado: 'conforme', sombreamento: 'conforme' })).toBe('4 de 10 itens avaliados: 4 conformes.');
    expect(frasePlacar({ padrao: 'nao_conforme' })).toBe('1 de 10 itens avaliados: 1 não conforme.');
  });
  it('singular e plural de cada parte', () => {
    expect(frasePlacar({ padrao: 'conforme', medidor: 'atencao', telhado: 'nao_conforme', inversores: 'na' }))
      .toBe('4 de 10 itens avaliados: 1 conforme, 1 com atenção, 1 não conforme e 1 não se aplica.');
    expect(frasePlacar({ padrao: 'na', medidor: 'na' })).toBe('2 de 10 itens avaliados: 2 não se aplicam.');
    expect(frasePlacar({ padrao: 'nao_conforme', medidor: 'nao_conforme' })).toBe('2 de 10 itens avaliados: 2 não conformes.');
  });
  it('só as partes com contagem maior que zero; duas partes ligam com "e"', () => {
    expect(frasePlacar({ padrao: 'conforme', medidor: 'atencao' })).toBe('2 de 10 itens avaliados: 1 conforme e 1 com atenção.');
    expect(frasePlacar(todos('na'))).toBe('10 itens avaliados: 10 não se aplicam.');
  });
  it('nenhum texto tem travessão nem emoji', () => {
    const t = [frasePlacar(todos('conforme')), frasePlacar({ padrao: 'na', medidor: 'atencao', telhado: 'nao_conforme' }), SELO_PARCIAL.titulo, SELO_PARCIAL.frase].join(' ');
    expect(t).not.toMatch(SEM_TRAVESSAO_NEM_EMOJI);
  });
});

describe('SELO_PARCIAL', () => {
  it('traz o texto combinado, sem a palavra "Apto"', () => {
    expect(SELO_PARCIAL).toEqual({ titulo: 'Itens avaliados em ordem', frase: 'Faltam itens a avaliar. O resultado completo depende deles.' });
    expect(`${SELO_PARCIAL.titulo} ${SELO_PARCIAL.frase}`).not.toContain('Apto');
  });
});

describe('EXPLICA', () => {
  it('tem uma frase para cada um dos 12 itens do checklist', () => {
    expect(Object.keys(EXPLICA).sort()).toEqual(['conta_luz', 'documento_pessoal', ...ITENS_COM_STATUS].sort());
    expect(EXPLICA.sombreamento).toBe('Árvores, prédios e caixas d’água que fazem sombra nos módulos.');
    expect(EXPLICA.padrao).toBe('A caixa e o poste por onde a energia da rua chega à casa.');
  });
  it('cada frase começa com maiúscula, termina com ponto e não tem travessão nem emoji', () => {
    for (const [chave, frase] of Object.entries(EXPLICA)) {
      expect(frase, chave).toMatch(/^\p{Lu}/u);
      expect(frase, chave).toMatch(/\.$/);
      expect(frase, chave).not.toMatch(SEM_TRAVESSAO_NEM_EMOJI);
    }
  });
});

describe('proximosPassos', () => {
  it('não conforme: três passos', () => {
    expect(proximosPassos('nao_conforme', cobertura(todos('conforme')))).toEqual([
      'Resolver os itens de prioridade alta antes da instalação.',
      'Combinar com a empresa quem faz cada ajuste.',
      'Avisar a empresa quando terminar, para conferir e marcar a instalação.',
    ]);
  });
  it('atenção: dois passos', () => {
    expect(proximosPassos('atencao', cobertura({ padrao: 'atencao' }))).toEqual([
      'Resolver os itens de prioridade média antes ou durante a instalação.',
      'Combinar com a empresa quem faz cada ajuste.',
    ]);
  });
  it('conforme com os 10 avaliados: nenhum ajuste; com itens por avaliar: concluir a avaliação', () => {
    expect(proximosPassos('conforme', cobertura(todos('conforme')))).toEqual(['Nenhum ajuste é necessário. A instalação pode ser marcada.']);
    expect(proximosPassos('conforme', cobertura({ padrao: 'conforme' }))).toEqual(['Concluir a avaliação dos itens que faltam antes de marcar a instalação.']);
  });
  it('conforme com N/A nos 10 itens conta como avaliado', () => {
    expect(proximosPassos('conforme', cobertura({ ...todos('conforme'), medidor: 'na' }))).toEqual(PROXIMOS_PASSOS.conforme);
  });
  it('sem selo, sem passos; nenhum texto tem travessão nem emoji', () => {
    expect(proximosPassos(null, cobertura({}))).toEqual([]);
    const tudo = [...PROXIMOS_PASSOS.nao_conforme, ...PROXIMOS_PASSOS.atencao, ...PROXIMOS_PASSOS.conforme, ...PROXIMOS_PASSOS.conforme_parcial].join(' ');
    expect(tudo).not.toMatch(SEM_TRAVESSAO_NEM_EMOJI);
  });
});

describe('juntarLista', () => {
  it('uma, duas e três partes', () => {
    expect(juntarLista([])).toBe('');
    expect(juntarLista(['A'])).toBe('A');
    expect(juntarLista(['A', 'B'])).toBe('A e B');
    expect(juntarLista(['A', 'B', 'C'])).toBe('A, B e C');
  });
});
