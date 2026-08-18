import { describe, it, expect } from 'vitest';
import { normalizarCidade, chaveMunicipio } from '../services/io/cidadeParse';

// ─────────────────────────────────────────────────────────────────────────────
// As strings deste teste são REAIS: saíram de eletroposto_nota1 e
// eletroposto_parceria em 17/08/2026. Ficam hardcoded de propósito — o teste tem
// que rodar sem banco, e o valor delas é justamente serem sujas.
//
// O placar que este arquivo trava: UF certa em 42, null honesto em 12,
// ERRADA EM ZERO. Errar a UF manda o lead pro outro lado do país e ninguém vê;
// devolver null só deixa de sugerir.
// ─────────────────────────────────────────────────────────────────────────────
const REAIS = [
  'Ananindeua-PA', 'Aparecida de Goiânia', 'Aracaju', 'Araguaína-TO', 'Araguari-MG',
  'Arapongas PR', 'Araxá-MG', 'Barueri  SP', 'Belém-PA', 'Brasilia', 'Brasília-DF',
  'Caruaru- pe', 'Cuiaba/MT', 'Divinopolis Minas gerais', 'Dourados - MS',
  'Feira de Santana Bahia', 'Foz Do IguaÇu', 'Foz do Iguaçu-PR', 'Garanhuns PE',
  'Iniuna', 'Irecê Bahia', 'Itapipoca/ceara', 'João Pessoa-PB', 'Joinvikle',
  'Lauro de freitas', 'Lauro de Freitas-BA', 'Londrina/PR', 'Macarani-BA', 'Maceio',
  'Maceio-AL', 'Manaus - AM', 'Miradouro-MG', 'Montes Claros', 'Murici /AL', 'Osasco',
  'Palmas Tocantins', 'Palmas-TO', 'Petrolina', 'Petrolina PE', 'Porto alegre rs',
  'Porto seguro e Eunapolis/ BA', 'Rio Branco Acre', 'Rio Branco-AC', 'Rio Claro sp',
  'Rio De Janeiro', 'Rio de Janeiro-RJ', 'Rio Verde-GO', 'Santo Antônio de Jesus-BA',
  'São Domingos do Maranhão', 'São Luís-MA', 'SÃo Paulo', 'Sao Paulo - SP',
  'São Paulo-SP', 'Tupã/SP', 'Vitória da Conquista- Bahia',
];

/** A UF que um humano leria em cada string. `null` = a string não a carrega. */
const UF_ESPERADA: Record<string, string | null> = {
  'Ananindeua-PA': 'PA', 'Aparecida de Goiânia': null, 'Aracaju': null,
  'Araguaína-TO': 'TO', 'Araguari-MG': 'MG', 'Arapongas PR': 'PR', 'Araxá-MG': 'MG',
  'Barueri  SP': 'SP', 'Belém-PA': 'PA', 'Brasilia': null, 'Brasília-DF': 'DF',
  'Caruaru- pe': 'PE', 'Cuiaba/MT': 'MT', 'Divinopolis Minas gerais': 'MG',
  'Dourados - MS': 'MS', 'Feira de Santana Bahia': 'BA', 'Foz Do IguaÇu': null,
  'Foz do Iguaçu-PR': 'PR', 'Garanhuns PE': 'PE', 'Iniuna': null, 'Irecê Bahia': 'BA',
  'Itapipoca/ceara': 'CE', 'João Pessoa-PB': 'PB', 'Joinvikle': null,
  'Lauro de freitas': null, 'Lauro de Freitas-BA': 'BA', 'Londrina/PR': 'PR',
  'Macarani-BA': 'BA', 'Maceio': null, 'Maceio-AL': 'AL', 'Manaus - AM': 'AM',
  'Miradouro-MG': 'MG', 'Montes Claros': null, 'Murici /AL': 'AL', 'Osasco': null,
  'Palmas Tocantins': 'TO', 'Palmas-TO': 'TO', 'Petrolina': null, 'Petrolina PE': 'PE',
  'Porto alegre rs': 'RS', 'Porto seguro e Eunapolis/ BA': 'BA', 'Rio Branco Acre': 'AC',
  'Rio Branco-AC': 'AC', 'Rio Claro sp': 'SP', 'Rio De Janeiro': 'RJ',
  'Rio de Janeiro-RJ': 'RJ', 'Rio Verde-GO': 'GO', 'Santo Antônio de Jesus-BA': 'BA',
  'São Domingos do Maranhão': null, 'São Luís-MA': 'MA', 'SÃo Paulo': 'SP',
  'Sao Paulo - SP': 'SP', 'São Paulo-SP': 'SP', 'Tupã/SP': 'SP',
  'Vitória da Conquista- Bahia': 'BA',
};

describe('normalizarCidade — as 54 strings reais da base', () => {
  it('nunca devolve UF ERRADA', () => {
    const erradas: string[] = [];
    for (const s of REAIS) {
      const r = normalizarCidade(s);
      const esperada = UF_ESPERADA[s];
      if (r.uf && esperada && r.uf !== esperada) erradas.push(`${s} -> ${r.uf} (era ${esperada})`);
      if (r.uf && esperada === null) erradas.push(`${s} -> ${r.uf} (a string não carrega UF)`);
    }
    expect(erradas).toEqual([]);
  });

  it('acha a UF em todas as strings que a carregam', () => {
    const perdidas = REAIS.filter(s => UF_ESPERADA[s] && !normalizarCidade(s).uf);
    expect(perdidas).toEqual([]);
  });

  it('devolve cidade não-vazia em tudo que não tem dois topônimos', () => {
    const vazias = REAIS.filter(s => s !== 'Porto seguro e Eunapolis/ BA' && !normalizarCidade(s).cidade);
    expect(vazias).toEqual([]);
  });
});

describe('normalizarCidade — as armadilhas nomeadas', () => {
  it('hífen no MEIO do nome não vira UF: "Ji-Paraná" fica em RO, não em PR', () => {
    // Sem a trava, o "Paraná" do fim seria lido como estado e a cidade viraria "Ji".
    expect(normalizarCidade('Ji-Paraná')).toMatchObject({ cidade: 'Ji-Paraná', uf: null });
    expect(normalizarCidade('Ji-Paraná/RO')).toMatchObject({ cidade: 'Ji-Paraná', uf: 'RO' });
    expect(normalizarCidade('Ji-Paraná-RO')).toMatchObject({ cidade: 'Ji-Paraná', uf: 'RO' });
  });

  it('nome composto por hífen sobrevive', () => {
    expect(normalizarCidade('Xique-Xique-BA')).toMatchObject({ cidade: 'Xique-Xique', uf: 'BA' });
    expect(normalizarCidade('Mogi-Guaçu SP')).toMatchObject({ cidade: 'Mogi-Guaçu', uf: 'SP' });
  });

  it('cidade e estado com o MESMO nome não esvaziam a cidade', () => {
    expect(normalizarCidade('São Paulo')).toMatchObject({ cidade: 'São Paulo', uf: 'SP' });
    expect(normalizarCidade('Rio de Janeiro')).toMatchObject({ cidade: 'Rio de Janeiro', uf: 'RJ' });
  });

  it('estado por extenso em duas palavras', () => {
    expect(normalizarCidade('Divinopolis Minas gerais')).toMatchObject({ cidade: 'Divinopolis', uf: 'MG' });
    expect(normalizarCidade('Dourados Mato Grosso do Sul')).toMatchObject({ cidade: 'Dourados', uf: 'MS' });
  });

  it('dois topônimos: perde a cidade, guarda a UF, e AVISA', () => {
    expect(normalizarCidade('Porto seguro e Eunapolis/ BA'))
      .toEqual({ cidade: null, uf: 'BA', duasCidades: true });
  });

  it('vírgula funciona, mesmo sendo rara no campo', () => {
    expect(normalizarCidade('Barueri,SP')).toMatchObject({ cidade: 'Barueri', uf: 'SP' });
    expect(normalizarCidade('Uberlândia, MG')).toMatchObject({ cidade: 'Uberlândia', uf: 'MG' });
  });

  it('texto vazio não explode', () => {
    expect(normalizarCidade('')).toEqual({ cidade: null, uf: null, duasCidades: false });
    expect(normalizarCidade(null)).toEqual({ cidade: null, uf: null, duasCidades: false });
    expect(normalizarCidade('   ')).toEqual({ cidade: null, uf: null, duasCidades: false });
  });
});

describe('chaveMunicipio — casa grafias diferentes do mesmo lugar', () => {
  it('acento e caixa não separam', () => {
    expect(chaveMunicipio('Maceió')).toBe(chaveMunicipio('Maceio'));
    expect(chaveMunicipio('Foz Do IguaÇu')).toBe(chaveMunicipio('Foz do Iguaçu'));
    expect(chaveMunicipio('SÃo Paulo')).toBe(chaveMunicipio('são paulo'));
    expect(chaveMunicipio('Lauro de freitas')).toBe(chaveMunicipio('Lauro de Freitas'));
  });

  it('pontuação interna não separa', () => {
    expect(chaveMunicipio("Santa Bárbara d'Oeste")).toBe(chaveMunicipio('Santa Barbara dOeste'));
  });

  it('cidades diferentes continuam diferentes', () => {
    expect(chaveMunicipio('Rio Branco')).not.toBe(chaveMunicipio('Rio Verde'));
  });
});

describe('municípios que TÊM " e " no nome', () => {
  it('Abreu e Lima, Pontes e Lacerda e Passa e Fica não são "duas cidades"', () => {
    // São os três municípios do Brasil com " e " no nome. Sem a exceção, a regra
    // de dois topônimos os classificaria como indecidíveis e eles nunca
    // resolveriam — o morador de Abreu e Lima jamais entraria num match.
    for (const [txt, uf] of [['Abreu e Lima-PE', 'PE'], ['Pontes e Lacerda/MT', 'MT'],
                             ['Passa e Fica RN', 'RN'], ['Abreu e Lima', null]] as const) {
      const r = normalizarCidade(txt);
      expect(r.duasCidades, txt).toBe(false);
      expect(r.cidade, txt).toBeTruthy();
      expect(r.uf, txt).toBe(uf);
    }
  });

  it('mas duas cidades DE VERDADE continuam sendo duas', () => {
    expect(normalizarCidade('Porto seguro e Eunapolis/ BA').duasCidades).toBe(true);
  });
});
