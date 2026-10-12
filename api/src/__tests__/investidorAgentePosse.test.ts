import { describe, it, expect, vi, beforeEach } from 'vitest';

// De quem é a conversa: a pergunta que a Duda, o leitor do Curioso e o agente de
// respostas da agenda fazem antes de falar. Dois robôs respondendo a mesma pessoa
// é a pior falha desta agente, então o que se testa aqui é o lado conservador.

type Linha = { key: string; value: unknown };
const banco = { linhas: [] as Linha[], falhas: 0, leituras: 0 };

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const f: { key?: string; like?: string; de?: number; ate?: number } = {};
      const erro = () => {
        banco.leituras++;
        if (banco.falhas > 0) { banco.falhas--; return { message: 'banco fora' }; }
        return null;
      };
      const q: any = {
        select: () => q,
        order: () => q,
        eq: (_c: string, v: string) => { f.key = v; return q; },
        like: (_c: string, v: string) => { f.like = v.replace(/%$/, ''); return q; },
        maybeSingle: async () => {
          const e = erro();
          if (e) return { data: null, error: e };
          return { data: banco.linhas.find(l => l.key === f.key) ?? null, error: null };
        },
        range: async (de: number, ate: number) => {
          const e = erro();
          if (e) return { data: null, error: e };
          return { data: banco.linhas.filter(l => l.key.startsWith(f.like ?? '')).slice(de, ate + 1), error: null };
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import {
  INV_SESSAO_PREFIX, ESTAGIOS_ATIVOS, sessaoAtiva, sessaoSeguraOutrosRobos, sessaoEhDaHelena, investidorAtende, chavesDaHelena,
} from '../services/io/investidorAgentePosse';

const AGORA = Date.parse('2026-10-11T15:00:00Z');
const haHoras = (h: number) => new Date(AGORA - h * 3600_000).toISOString();
const sessao = (chave: string, value: Record<string, unknown>): Linha => ({ key: `${INV_SESSAO_PREFIX}${chave}`, value });

beforeEach(() => {
  banco.linhas = [];
  banco.falhas = 0;
  banco.leituras = 0;
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});

describe('quando a conversa é da Helena', () => {
  it('ativa em chamado, conversando e ofertou', () => {
    expect([...ESTAGIOS_ATIVOS]).toEqual(['chamado', 'conversando', 'ofertou']);
    for (const e of ESTAGIOS_ATIVOS) {
      expect(sessaoAtiva(e)).toBe(true);
      expect(sessaoSeguraOutrosRobos({ estagio: e }, AGORA)).toBe(true);
    }
  });

  it('agendado e sem_interesse devolvem a conversa: a régua da agenda ou a recepção assumem', () => {
    expect(sessaoSeguraOutrosRobos({ estagio: 'agendado', atualizado_em: haHoras(1) }, AGORA)).toBe(false);
    expect(sessaoSeguraOutrosRobos({ estagio: 'sem_interesse', atualizado_em: haHoras(1) }, AGORA)).toBe(false);
    expect(sessaoSeguraOutrosRobos(null, AGORA)).toBe(false);
    expect(sessaoSeguraOutrosRobos({}, AGORA)).toBe(false);
  });

  it('passou para o consultor: os outros robôs ficam fora por 48h, depois a conversa volta', () => {
    expect(sessaoSeguraOutrosRobos({ estagio: 'humano', atualizado_em: haHoras(1) }, AGORA)).toBe(true);
    expect(sessaoSeguraOutrosRobos({ estagio: 'humano', atualizado_em: haHoras(47) }, AGORA)).toBe(true);
    expect(sessaoSeguraOutrosRobos({ estagio: 'humano', atualizado_em: haHoras(49) }, AGORA)).toBe(false);
    // Sem data nenhuma não segura: melhor a recepção atender do que ninguém.
    expect(sessaoSeguraOutrosRobos({ estagio: 'humano' }, AGORA)).toBe(false);
  });
});

describe('posse com prazo (11/10/2026)', () => {
  const haDias = (d: number) => new Date(AGORA - d * 86_400_000).toISOString();

  it('chamado sem resposta há mais de 10 dias deixa de ser dela: a Duda volta a atender', () => {
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: haDias(9) }, AGORA)).toBe(true);
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: haDias(11) }, AGORA)).toBe(false);
    expect(sessaoSeguraOutrosRobos({ estagio: 'chamado', aberto_em: haDias(11) }, AGORA)).toBe(false);
  });

  it('quem já respondeu não vence pelo prazo da abertura', () => {
    expect(sessaoEhDaHelena({ estagio: 'conversando', aberto_em: haDias(30) }, AGORA)).toBe(true);
    expect(sessaoEhDaHelena({ estagio: 'ofertou', aberto_em: haDias(30) }, AGORA)).toBe(true);
  });

  it('abertura cujo envio FALHOU não conta como posse', () => {
    const falhou = { estagio: 'chamado', aberto_em: haDias(0), erro: '[zapi:io] HTTP 500' };
    expect(sessaoEhDaHelena(falhou, AGORA)).toBe(false);
    expect(sessaoSeguraOutrosRobos(falhou, AGORA)).toBe(false);
    expect(sessaoEhDaHelena({ estagio: 'chamado', aberto_em: haDias(0), erro: null }, AGORA)).toBe(true);
  });

  it('estágio encerrado nunca é dela', () => {
    for (const estagio of ['agendado', 'sem_interesse', 'humano']) expect(sessaoEhDaHelena({ estagio, aberto_em: haDias(0) }, AGORA)).toBe(false);
  });

  it('as duas perguntas (uma pessoa e o laço) usam a mesma régua', async () => {
    banco.linhas = [
      sessao('3499990001', { estagio: 'chamado', aberto_em: haDias(1) }),
      sessao('3499990002', { estagio: 'chamado', aberto_em: haDias(11) }),
      sessao('3499990003', { estagio: 'chamado', aberto_em: haDias(1), erro: 'falhou' }),
    ];
    expect(await investidorAtende('5534999990001')).toBe(true);
    expect(await investidorAtende('5534999990002')).toBe(false);
    expect(await investidorAtende('5534999990003')).toBe(false);
    expect([...(await chavesDaHelena())!]).toEqual(['3499990001']);
  });
});

describe('investidorAtende (a pergunta da recepção)', () => {
  it('casa pela chave DDD + 8: com 55, sem 55 e sem o nono dígito', async () => {
    banco.linhas = [sessao('3499990001', { estagio: 'conversando' })];
    expect(await investidorAtende('5534999990001')).toBe(true);
    expect(await investidorAtende('34999990001')).toBe(true);
    expect(await investidorAtende('553499990001')).toBe(true);
    expect(await investidorAtende('5534999990002')).toBe(false);
  });

  it('sessão encerrada não segura ninguém', async () => {
    banco.linhas = [sessao('3499990001', { estagio: 'sem_interesse', atualizado_em: haHoras(1) })];
    expect(await investidorAtende('5534999990001')).toBe(false);
  });

  it('telefone que não dá chave não é de ninguém, e nem consulta o banco', async () => {
    expect(await investidorAtende('123')).toBe(false);
    expect(await investidorAtende(null)).toBe(false);
    expect(banco.leituras).toBe(0);
  });

  it('uma falha de leitura é tentada de novo', async () => {
    banco.linhas = [sessao('3499990001', { estagio: 'chamado' })];
    banco.falhas = 1;
    expect(await investidorAtende('5534999990001')).toBe(true);
    expect(await investidorAtende('5534999990002')).toBe(false);
    expect(banco.leituras).toBe(3);
  });

  it('FALHA FECHADA: duas falhas seguidas respondem "é dela" e o outro robô cala', async () => {
    banco.falhas = 2;
    expect(await investidorAtende('5534999990002')).toBe(true);
  });
});

describe('chavesDaHelena (a pergunta de quem está num laço)', () => {
  it('só as conversas em que ela ainda responde', async () => {
    banco.linhas = [
      sessao('3499990001', { estagio: 'chamado' }),
      sessao('3499990002', { estagio: 'ofertou' }),
      sessao('3499990003', { estagio: 'agendado' }),
      // Passou para o consultor há 1h: a recepção cala, mas a régua da agenda
      // NÃO pode ficar 48h sem ler o "SIM" de quem o consultor remarcou.
      sessao('3499990004', { estagio: 'humano', atualizado_em: haHoras(1) }),
      { key: 'inv_agente_sent:3499990009:t1', value: { em: haHoras(1) } },
    ];
    expect([...(await chavesDaHelena())!].sort()).toEqual(['3499990001', '3499990002']);
  });

  it('pagina além das 1000 linhas do PostgREST', async () => {
    banco.linhas = Array.from({ length: 1200 }, (_, i) => sessao(String(3400000000 + i), { estagio: 'chamado' }));
    expect((await chavesDaHelena())!.size).toBe(1200);
  });

  it('sem conseguir ler devolve null, e quem chama para a rodada', async () => {
    banco.falhas = 1;
    expect(await chavesDaHelena()).toBeNull();
  });
});
