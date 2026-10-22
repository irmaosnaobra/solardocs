import { describe, it, expect } from 'vitest';
import { cidadeCanonica, cidadeParaTexto, aceitariaSemDdd, dddDoTelefone } from '../services/io/cidadeCanonica';

describe('cidadeCanonica: com a UF digitada (vale sem telefone)', () => {
  it.each([
    ['Uberlândia / mg', 'Uberlândia-MG'],
    ['Uberlândia-MG', 'Uberlândia-MG'],
    ['  uberlandia   minas gerais ', 'Uberlândia-MG'],
    ['uberlandia minas gerais', 'Uberlândia-MG'],
    ['Goiania go', 'Goiânia-GO'],
    ['Brasilia DF', 'Brasília-DF'],
    ['Salvador bahia', 'Salvador-BA'],
    ['Ji-Paraná-RO', 'Ji-Paraná-RO'],
    ['SÃo Paulo', 'São Paulo-SP'],
  ])('%s → %s', (entrada, saida) => {
    expect(cidadeCanonica(entrada)).toEqual({ valor: saida, status: 'ok' });
  });
});

describe('cidadeCanonica: sem UF, o DDD confirma (ou é capital)', () => {
  it.each([
    ['uberlandia', '5534999990000', 'Uberlândia-MG'],
    ['UberlÂndia', '34999990000', 'Uberlândia-MG'],
    ['Uberlândia', '(34) 99999-0000', 'Uberlândia-MG'],
    ['Ji-Paraná', '5569999990000', 'Ji-Paraná-RO'],
    ['Campinas', '5519999990000', 'Campinas-SP'],
    ['Juazeiro', '5574999990000', 'Juazeiro-BA'],
  ])('%s / %s → %s', (entrada, tel, saida) => {
    expect(cidadeCanonica(entrada, tel)).toEqual({ valor: saida, status: 'ddd' });
  });
  it('capital passa sem telefone e com qualquer DDD', () => {
    expect(cidadeCanonica('Brasília', '5534999990000')).toEqual({ valor: 'Brasília-DF', status: 'ok' });
    expect(cidadeCanonica('Brasilia')).toEqual({ valor: 'Brasília-DF', status: 'ok' });
  });
  it('UF digitada vale mesmo com DDD de outro estado', () => {
    expect(cidadeCanonica('Uberlândia-MG', '5511999990000')).toEqual({ valor: 'Uberlândia-MG', status: 'ok' });
    expect(cidadeCanonica('Goiania go', '5511999990000')).toEqual({ valor: 'Goiânia-GO', status: 'ok' });
  });
  it.each([
    ['Uberlândia', '5511999990000'],
    ['Uberlândia', undefined],
    ['Uberlândia', '5555319981650'],
    ['Taguatinga', '5561999990000'],
    ['Guará', '5561999990000'],
    ['Valparaiso', '5561999990000'],
    ['Itapoã', '5561999990000'],
    ['Santa Mônica', '5534999990000'],
    ['Moema', '5511999990000'],
    ['Campinas', '5562999990000'],
    ['Juazeiro', '5588999990000'],
    ['Goiás', '5562999990000'],
    ['Goiás', undefined],
    ['Amapá', '5596999990000'],
    ['Distrito Federal', '5561999990000'],
  ])('%s / %s fica como está (o DDD não confirma)', (entrada, tel) => {
    expect(cidadeCanonica(entrada, tel)).toEqual({ valor: entrada, status: 'mantida' });
  });
});

describe('cidadeCanonica: nome repetido no país', () => {
  it('sem telefone fica como está', () => {
    expect(cidadeCanonica('Santa Luzia')).toEqual({ valor: 'Santa Luzia', status: 'mantida' });
  });
  it('o DDD desempata', () => {
    expect(cidadeCanonica('Santa Luzia', '5531999990000')).toEqual({ valor: 'Santa Luzia-MG', status: 'ddd' });
    expect(cidadeCanonica('santa luzia', '(71) 99999-0000')).toEqual({ valor: 'Santa Luzia-BA', status: 'ddd' });
  });
  it('DDD de outra UF que não está entre os candidatos não decide', () => {
    expect(cidadeCanonica('Santa Luzia', '5511999990000').status).toBe('mantida');
  });
  it('telefone quebrado 5555319981650 não decide', () => {
    expect(dddDoTelefone('5555319981650')).toBe('');
    expect(cidadeCanonica('Santa Luzia', '5555319981650')).toEqual({ valor: 'Santa Luzia', status: 'mantida' });
  });
  it('celular legítimo do RS (5555 9...) conta', () => {
    expect(dddDoTelefone('5555991234567')).toBe('55');
  });
});

describe('cidadeCanonica: DDD do telefone', () => {
  it.each([
    ['5534999990000', '34'], ['34999990000', '34'], ['553432221000', '34'],
    ['123', ''], ['', ''], [null, ''],
  ])('%s → %s', (tel, ddd) => {
    expect(dddDoTelefone(tel)).toBe(ddd);
  });
});

describe('cidadeCanonica: nunca inventa', () => {
  it('nome que é o fim de outro município, sem UF e sem DDD, fica como está', () => {
    expect(cidadeCanonica('Conquista')).toEqual({ valor: 'Conquista', status: 'mantida' });
    expect(cidadeCanonica('Conquista', '5577999990000').status).toBe('mantida');
  });
  it('...mas com o DDD da mesma UF, aceita', () => {
    expect(cidadeCanonica('Conquista', '5531999990000')).toEqual({ valor: 'Conquista-MG', status: 'ddd' });
  });
  it('com UF digitada, o nome curto vale', () => {
    expect(cidadeCanonica('Conquista MG')).toEqual({ valor: 'Conquista-MG', status: 'ok' });
  });
  it('número, lixo e duas cidades voltam do jeito que vieram', () => {
    expect(cidadeCanonica('37')).toEqual({ valor: '37', status: 'mantida' });
    expect(cidadeCanonica('  Xyzzy   Plugh ')).toEqual({ valor: 'Xyzzy Plugh', status: 'mantida' });
    expect(cidadeCanonica('Porto seguro e Eunapolis/ BA')).toEqual({ valor: 'Porto seguro e Eunapolis/ BA', status: 'mantida' });
  });
  it('vazio e nulo', () => {
    expect(cidadeCanonica('')).toEqual({ valor: '', status: 'vazia' });
    expect(cidadeCanonica('   ')).toEqual({ valor: '', status: 'vazia' });
    expect(cidadeCanonica(null)).toEqual({ valor: '', status: 'vazia' });
    expect(cidadeCanonica(undefined)).toEqual({ valor: '', status: 'vazia' });
  });
});

describe('cidadeParaTexto: só o município, para falar com o lead', () => {
  it.each([
    ['Uberlândia-MG', 'Uberlândia'],
    ['Ji-Paraná-RO', 'Ji-Paraná'],
    ['Xique-Xique', 'Xique-Xique'],
    ['Santa  Luzia ', 'Santa Luzia'],
    ['Belo Horizonte, MG', 'Belo Horizonte'],
    ['São Paulo-SP', 'São Paulo'],
    ['', ''],
    [null, ''],
  ])('%s → %s', (entrada, saida) => {
    expect(cidadeParaTexto(entrada)).toBe(saida);
  });
});

describe('aceitariaSemDdd: o que a regra antiga aceitava e a nova não', () => {
  it('nome único sem UF aceitava; capital e UF digitada também; "Conquista" já era segurada', () => {
    expect(aceitariaSemDdd('Taguatinga')).toBe(true);
    expect(aceitariaSemDdd('Goiás')).toBe(true);
    expect(aceitariaSemDdd('Conquista')).toBe(false);
    expect(aceitariaSemDdd('Xyzzy')).toBe(false);
    expect(aceitariaSemDdd('Porto seguro e Eunapolis/ BA')).toBe(false);
  });
});

describe('cidadeCanonica: capitais não passam pela guarda do nome curto', () => {
  it('João Pessoa (existe "Coronel João Pessoa") e Natal resolvem sem UF', () => {
    expect(cidadeCanonica('João Pessoa')).toEqual({ valor: 'João Pessoa-PB', status: 'ok' });
    expect(cidadeCanonica('natal')).toEqual({ valor: 'Natal-RN', status: 'ok' });
  });
});

describe('cidadeCanonica: o DDD não desempata contra o município maior da mesma UF', () => {
  it('Camboriú no DDD 47 fica como está (Balneário Camboriú também é SC)', () => {
    expect(cidadeCanonica('Camboriú', '5547999990000')).toEqual({ valor: 'Camboriú', status: 'mantida' });
  });
  it('Conquista no DDD 34 não é Vitória da Conquista (BA): vale MG', () => {
    expect(cidadeCanonica('Conquista', '5534999990000')).toEqual({ valor: 'Conquista-MG', status: 'ddd' });
  });
});

describe('cidadeCanonica: região administrativa do DF no DDD 61', () => {
  it.each(['Planaltina', 'Varjão', 'Santa Maria', 'Ceilândia', 'planaltina', 'Sobradinho II', 'Águas Claras'])(
    '%s / DDD 61 sem UF fica como digitado (o homônimo de Goiás seria chute)', entrada => {
      expect(cidadeCanonica(entrada, '5561999990000')).toEqual({ valor: entrada, status: 'mantida' });
    });
  it('UF digitada vale: Planaltina-GO no DDD 61 continua Planaltina-GO', () => {
    expect(cidadeCanonica('Planaltina-GO', '5561999990000')).toEqual({ valor: 'Planaltina-GO', status: 'ok' });
  });
  it('município de Goiás de verdade no DDD 61 segue resolvendo: Formosa vira Formosa-GO', () => {
    expect(cidadeCanonica('Formosa', '5561999990000')).toEqual({ valor: 'Formosa-GO', status: 'ddd' });
  });
});
