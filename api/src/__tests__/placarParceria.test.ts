import { describe, it, expect } from 'vitest';
import { contarPlacar, paginado } from '../routes/ioEletroposto';

/**
 * O placar da /nexus aparece como prova social. Errar para mais é promessa
 * falsa; errar para menos joga fora a base que já existe. Os dois erros já
 * aconteceram na versão que somava contagem de tabela.
 */
describe('placar da parceria: conta pessoa, não linha', () => {
  it('investidor é o cadastro de capital MAIS a ficha da LP', () => {
    const p = contarPlacar(
      [{ telefone: '5534999990001' }, { telefone: '5534999990002' }],
      [{ telefone: '5534999990003' }],
      [], [],
    );
    expect(p.capital).toBe(3);
  });

  it('quem preencheu a LP e depois se cadastrou conta UMA vez', () => {
    const p = contarPlacar(
      [{ telefone: '5534999990001' }],
      [{ telefone: '5534999990001' }],
      [], [],
    );
    expect(p.capital).toBe(1);
  });

  it('máscara diferente é a mesma pessoa', () => {
    const p = contarPlacar(
      [{ telefone: '(34) 99999-0001' }],
      [{ telefone: '34999990001' }],
      [], [],
    );
    expect(p.capital).toBe(1);
  });

  it('telefone curto demais não vira investidor', () => {
    const p = contarPlacar(
      [{ telefone: '99999' }, { telefone: '' }, { telefone: null }, { telefone: '5534999990001' }],
      [], [], [],
    );
    expect(p.capital).toBe(1);
  });

  it('local conta as TRÊS fontes de endereço', () => {
    const p = contarPlacar(
      [],
      [{ telefone: '5534999990002', endereco: 'Rua B, 20' }],
      [{ telefone: '5534999990001', ponto_endereco: 'Rua A, 10' }],
      [{ cliente_telefone: '5534999990003', ponto_relacao: 'É meu, tenho a escritura' }],
    );
    expect(p.ponto).toBe(3);
  });

  it('cadastro de ponto SEM endereço não conta como local', () => {
    const p = contarPlacar(
      [], [],
      [{ telefone: '5534999990001', ponto_endereco: '   ' },
       { telefone: '5534999990002', ponto_endereco: null },
       { telefone: '5534999990003', ponto_endereco: 'Avenida Central, 500' }],
      [],
    );
    expect(p.ponto).toBe(1);
  });

  it('o mesmo dono aparecendo em duas fontes conta um local só', () => {
    const p = contarPlacar(
      [],
      [{ telefone: '5534999990001', endereco: 'Rua A, 10' }],
      [{ telefone: '5534999990001', ponto_endereco: 'Rua A, 10' }],
      [{ cliente_telefone: '(34) 99999-0001', ponto_relacao: 'Alugo o imóvel hoje' }],
    );
    expect(p.ponto).toBe(1);
  });

  it('agendamento sem ARRENDAMENTO marcado não é local', () => {
    const p = contarPlacar(
      [], [], [],
      [{ cliente_telefone: '5534999990001', ponto_relacao: null },
       { cliente_telefone: '5534999990002', ponto_relacao: '' }],
    );
    expect(p.ponto).toBe(0);
  });

  it('a ficha da LP entra nos dois lados quando tem capital e endereço', () => {
    const p = contarPlacar(
      [], [{ telefone: '5534999990001', endereco: 'Rua A, 10' }], [], [],
    );
    expect(p).toEqual({ capital: 1, ponto: 1 });
  });

  it('base vazia devolve zero, não quebra', () => {
    expect(contarPlacar([], [], [], [])).toEqual({ capital: 0, ponto: 0 });
  });
});

/**
 * O defeito de 26/09 não foi na contagem, foi na LEITURA: o PostgREST cortou
 * em 1000 linhas e o placar publicou 41 locais em vez de 49, sem erro nenhum.
 * Estes testes existem para esse corte não voltar.
 */
describe('leitura paginada: o teto de 1000 linhas do servidor', () => {
  const tabela = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));
  /** Imita o PostgREST: respeita o range pedido, mas nunca devolve mais de 1000. */
  const servidor = (linhas: { i: number }[]) => {
    const chamadas: Array<[number, number]> = [];
    const pagina = async (de: number, ate: number) => {
      chamadas.push([de, ate]);
      return { data: linhas.slice(de, Math.min(ate + 1, de + 1000)), error: null };
    };
    return { pagina, chamadas };
  };

  it('tabela menor que uma página vem numa chamada só', async () => {
    const { pagina, chamadas } = servidor(tabela(326));
    expect((await paginado(pagina)).length).toBe(326);
    expect(chamadas.length).toBe(1);
  });

  it('tabela de 1170 linhas vem INTEIRA, que é o caso que quebrou', async () => {
    const { pagina, chamadas } = servidor(tabela(1170));
    const tudo = await paginado(pagina);
    expect(tudo.length).toBe(1170);
    expect(chamadas.length).toBe(2);
  });

  it('múltiplo exato de 1000 não perde a última página', async () => {
    const { pagina } = servidor(tabela(2000));
    expect((await paginado(pagina)).length).toBe(2000);
  });

  it('tabela vazia devolve lista vazia', async () => {
    const { pagina } = servidor(tabela(0));
    expect(await paginado(pagina)).toEqual([]);
  });

  it('erro do banco sobe, não vira contagem menor em silêncio', async () => {
    await expect(paginado(async () => ({ data: null, error: new Error('pane') })))
      .rejects.toThrow('pane');
  });
});
