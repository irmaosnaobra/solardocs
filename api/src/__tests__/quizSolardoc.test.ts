import { describe, it, expect } from 'vitest';
import {
  limparRespostas, calcular, indice, perfil, pilares, pilarFraco, itensQueFaltam, normalizarTelefoneSd,
  leadIdDoQuiz, codigoDoQuiz, PERFIS, IDS_PERGUNTAS_SD, type RespostasSd,
} from '../services/solardoc/quizSolardoc';

// O exemplo do protótipo (prototipo/index.html, EXEMPLO): 37 de 100, perfil `braco`.
const EXEMPLO: RespostasSd = {
  papel: 'dono', cnpj: 'sim', clientes: ['casas'], propostas_mes: '6a15', vendas_mes: 'v1a2', ticket: '15a30',
  como_faz_hoje: 'word', gasto_ferramenta: 'nada', tempo_por_proposta: 't120', quando_monta: 'noite', demora_envio: 'd1a2',
  perdeu_venda: 'algumas', cliente_entende: 'explico', erro_proposta: 'atempo', papelada: 'viro', meta_vendas: 'dobro',
  tempo_livre: 'visitas', imagem: 'profissional', fechar_primeira: ['nahora', 'retorno'], prioridade: 'rapidez', frase: 'muito',
  tem_marca: 'asvezes', mostra_economia: 'so_total', economia_25: 'nao', financiamento: 'aparte', usa_conta: 'digito',
  contrato_pronto: 'depois', modelos: 'mesmo', followup: 'lembro',
};
const com = (extra: RespostasSd): RespostasSd => ({ ...EXEMPLO, ...extra });

describe('o cálculo do diagnóstico', () => {
  it('o exemplo do protótipo dá 37 de 100 e o perfil braco', () => {
    expect(indice(EXEMPLO)).toBe(37);
    expect(perfil(EXEMPLO).id).toBe('braco');
    expect(pilares(EXEMPLO)).toEqual({ Velocidade: 7, Clareza: 10, Imagem: 10, Papelada: 10 });
    expect(pilarFraco(EXEMPLO).nome).toBe('Velocidade');
    expect(calcular(EXEMPLO)).toMatchObject({ indice: 37, perfil: 'braco', perfil_nome: 'Proposta no braço', pilar_fraco: 'Velocidade' });
  });

  it('a mesma conta sai das respostas depois de limpas', () => {
    expect(indice(limparRespostas(EXEMPLO))).toBe(37);
    expect(perfil(limparRespostas(EXEMPLO)).id).toBe('braco');
  });

  const MELHOR: RespostasSd = {
    tempo_por_proposta: 't15', quando_monta: 'expediente', demora_envio: 'nahora', usa_conta: 'foto',
    cliente_entende: 'sozinho', mostra_economia: 'sim', economia_25: 'sim', financiamento: 'sim',
    tem_marca: 'sim', erro_proposta: 'nunca', modelos: 'sim', papelada: 'modelo', contrato_pronto: 'sim',
  };

  it('o teto é 100 (25 por pilar)', () => {
    expect(pilares(MELHOR)).toEqual({ Velocidade: 25, Clareza: 25, Imagem: 25, Papelada: 25 });
    expect(indice(MELHOR)).toBe(100);
  });

  it('um caso de cada perfil, na ordem em que a regra decide', () => {
    expect(PERFIS.map((p) => p.id)).toEqual(['cedo', 'grande', 'caro', 'comecando', 'braco', 'crescer', 'informa']);
    expect(perfil(com({ cnpj: 'nao' })).id).toBe('cedo');
    expect(perfil(com({ cnpj: 'abrindo' })).id).toBe('cedo');
    expect(perfil(com({ propostas_mes: 'mais30' })).id).toBe('grande');
    expect(perfil(com({ gasto_ferramenta: 'g151a300' })).id).toBe('caro');
    expect(perfil(com({ gasto_ferramenta: 'g68a150', como_faz_hoje: 'plataforma' })).id).toBe('caro');
    expect(perfil(com({ gasto_ferramenta: 'g68a150' })).id).toBe('braco'); // 68 sem plataforma não é "caro"
    expect(perfil(com({ papel: 'comecando' })).id).toBe('comecando');
    expect(perfil(com({ vendas_mes: 'v0' })).id).toBe('comecando');
    expect(perfil(EXEMPLO).id).toBe('braco');
    expect(perfil(com({ ...MELHOR, vendas_mes: 'v3a5' })).id).toBe('crescer');
    expect(perfil(com({ como_faz_hoje: 'plataforma' })).id).toBe('informa');
  });

  it('a ordem manda: CNPJ por abrir ganha de grande e de caro', () => {
    expect(perfil(com({ cnpj: 'nao', propostas_mes: 'mais30', gasto_ferramenta: 'mais300' })).id).toBe('cedo');
    expect(perfil(com({ propostas_mes: 'mais30', gasto_ferramenta: 'mais300' })).id).toBe('grande');
  });

  it('com tempo abaixo de 30 minutos, quem monta no braço não é braco', () => {
    expect(perfil(com({ tempo_por_proposta: 't15' })).id).toBe('informa');
    // A faixa "De 15 a 30 minutos" vale 22 minutos (como no protótipo): o braco começa em "De 30 minutos a 1 hora".
    expect(perfil(com({ tempo_por_proposta: 't30' })).id).toBe('informa');
    expect(perfil(com({ tempo_por_proposta: 't60' })).id).toBe('braco');
  });

  it('os itens que faltam: resposta ausente também conta como falta', () => {
    expect(itensQueFaltam({})).toHaveLength(8);
    expect(itensQueFaltam(MELHOR)).toEqual(['followup']);
    expect(itensQueFaltam({ ...MELHOR, followup: 'rotina' })).toEqual([]);
    expect(itensQueFaltam(EXEMPLO)).toEqual(['tem_marca', 'mostra_economia', 'economia_25', 'financiamento', 'usa_conta', 'contrato_pronto', 'modelos', 'followup']);
  });

  it('sem nenhuma resposta o servidor não quebra: índice 0', () => {
    expect(calcular({})).toMatchObject({ indice: 0, perfil: 'informa' });
  });
});

describe('limparRespostas', () => {
  it('descarta pergunta fora da lista e opção fora da lista', () => {
    const r = limparRespostas({ papel: 'dono', xablau: 'sim', cnpj: 'talvez', tem_marca: 'sim', indice: 99 });
    expect(r).toEqual({ papel: 'dono', tem_marca: 'sim' });
  });

  it('não aceita texto livre nem tipo errado', () => {
    expect(limparRespostas({ papel: ['dono'], tem_marca: 5, empresa: 'Sol do Cerrado', cidade: 'Uberlândia-MG', uf: 'MG' })).toEqual({});
    expect(limparRespostas({ clientes: 'casas' })).toEqual({});
    expect(limparRespostas(null)).toEqual({});
    expect(limparRespostas('x')).toEqual({});
    expect(limparRespostas([1, 2])).toEqual({});
  });

  it('as de várias escolhas filtram ids, tiram repetição e o "marque até 3" corta', () => {
    expect(limparRespostas({ clientes: ['casas', 'casas', 'lua', 'rural'] })).toEqual({ clientes: ['casas', 'rural'] });
    expect(limparRespostas({ fechar_primeira: ['nahora', 'retorno', 'parcelas', 'bateria'] })).toEqual({ fechar_primeira: ['nahora', 'retorno', 'parcelas'] });
    expect(limparRespostas({ clientes: ['lua'] })).toEqual({});
  });

  it('pagamento só vale com CNPJ sim ou empregador', () => {
    expect(limparRespostas({ cnpj: 'sim', pagamento: 'pix' })).toEqual({ cnpj: 'sim', pagamento: 'pix' });
    expect(limparRespostas({ cnpj: 'empregador', pagamento: 'cartao' })).toEqual({ cnpj: 'empregador', pagamento: 'cartao' });
    expect(limparRespostas({ cnpj: 'nao', pagamento: 'pix' })).toEqual({ cnpj: 'nao' });
    expect(limparRespostas({ pagamento: 'pix' })).toEqual({});
  });

  it('id herdado do objeto (__proto__, constructor) não passa', () => {
    expect(limparRespostas(JSON.parse('{"__proto__":"x","constructor":"y","papel":"dono"}'))).toEqual({ papel: 'dono' });
  });

  it('são 36 perguntas em respostas (39 menos empresa, uf e cidade)', () => {
    expect(IDS_PERGUNTAS_SD).toHaveLength(36);
    expect(new Set(IDS_PERGUNTAS_SD).size).toBe(36);
  });
});

describe('telefone, código e id do lead', () => {
  it('tira o 55 e o 0 do começo só quando sobram 10 ou 11 dígitos', () => {
    expect(normalizarTelefoneSd('(34) 99816-5040')).toBe('5534998165040');
    expect(normalizarTelefoneSd('+55 34 99816-5040')).toBe('5534998165040'); // com 55
    expect(normalizarTelefoneSd('5534998165040')).toBe('5534998165040');
    expect(normalizarTelefoneSd('034998165040')).toBe('5534998165040');      // com 0
    expect(normalizarTelefoneSd('34998165040')).toBe('5534998165040');       // 11 dígitos
    expect(normalizarTelefoneSd('3432221111')).toBe('553432221111');         // fixo, 10 dígitos
    expect(normalizarTelefoneSd('553432221111')).toBe('553432221111');
  });

  it('DDD 55 (RS) não perde o começo', () => {
    expect(normalizarTelefoneSd('55999998888')).toBe('5555999998888');   // 11 dígitos: o 55 é o DDD
    expect(normalizarTelefoneSd('555532221111')).toBe('555532221111');  // 55 do país + DDD 55 + 8 dígitos
  });

  it('número curto, longo ou sem DDD válido é recusado', () => {
    expect(normalizarTelefoneSd('')).toBeNull();
    expect(normalizarTelefoneSd('99816504')).toBeNull();
    expect(normalizarTelefoneSd('5534998165040999')).toBeNull();
    expect(normalizarTelefoneSd('0000000000')).toBeNull();
    expect(normalizarTelefoneSd('1011112222')).toBeNull();
    expect(normalizarTelefoneSd(undefined)).toBeNull();
  });

  it('lead_id é sdquiz_ + DDD e 8 últimos (não usa o prefixo quiz_)', () => {
    expect(leadIdDoQuiz('5534998165040')).toBe('sdquiz_3498165040');
    expect(leadIdDoQuiz('553498165040')).toBe('sdquiz_3498165040'); // com ou sem o 9: a mesma pessoa
    expect(leadIdDoQuiz('5534998165040').startsWith('quiz_')).toBe(false);
  });

  it('o código é SD- mais 4 de A-Z e 2-9 (sem 0, O, 1, I) e fica igual para o mesmo telefone', () => {
    const re = /^SD-[A-HJ-NP-Z2-9]{4}$/;
    for (const n of ['5534998165040', '5511987654321', '553432221111', '5555999998888', '5521999990000']) expect(codigoDoQuiz(n)).toMatch(re);
    expect(codigoDoQuiz('5534998165040')).toBe(codigoDoQuiz('5534998165040'));
    expect(codigoDoQuiz('5534998165040')).toBe(codigoDoQuiz('553498165040'));
    expect(codigoDoQuiz('5534998165040')).not.toBe(codigoDoQuiz('5511987654321'));
  });

  it('o código nunca sai com símbolo confuso (varredura de 2.000 telefones)', () => {
    for (let i = 0; i < 2000; i++) expect(codigoDoQuiz(`55349${String(10000000 + i * 37)}`)).toMatch(/^SD-[A-HJ-NP-Z2-9]{4}$/);
  });
});
