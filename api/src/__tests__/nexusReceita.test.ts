import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consultarCnpj } from '../services/nexus/receita';

const CNPJ = '11222333000181';

const resp = (status: number, corpo: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
const brasilAtiva = resp(200, { descricao_situacao_cadastral: 'ATIVA', razao_social: 'SOLAR EXEMPLO LTDA', nome_fantasia: 'Solar Exemplo' });
const wsCorpo = (situacao: string) => resp(200, {
  razao_social: 'SOLAR EXEMPLO LTDA',
  estabelecimento: { nome_fantasia: 'Solar Exemplo', situacao_cadastral: situacao },
});

let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fetchPor(...respostas: Array<unknown | Error>) {
  fetchFalso = vi.fn(async () => {
    const r = respostas.shift();
    if (r instanceof Error) throw r;
    return r;
  });
  vi.stubGlobal('fetch', fetchFalso);
}

describe('consultarCnpj (BrasilAPI e cnpj.ws)', () => {
  it('BrasilAPI ativa: nem chega na segunda fonte', async () => {
    fetchPor(brasilAtiva);
    expect(await consultarCnpj(CNPJ)).toEqual({ ok: true, ativa: true, razao_social: 'SOLAR EXEMPLO LTDA', nome_fantasia: 'Solar Exemplo' });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(String(fetchFalso.mock.calls[0][0])).toBe(`https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`);
    expect(fetchFalso.mock.calls[0][1].headers['User-Agent']).toBe('solardoc-nexus/1.0');
  });

  it('BrasilAPI 403 e cnpj.ws ativa: usa a segunda fonte e avisa no log sem dado pessoal', async () => {
    fetchPor(resp(403), wsCorpo('Ativa'));
    expect(await consultarCnpj(CNPJ)).toEqual({ ok: true, ativa: true, razao_social: 'SOLAR EXEMPLO LTDA', nome_fantasia: 'Solar Exemplo' });
    expect(String(fetchFalso.mock.calls[1][0])).toBe(`https://publica.cnpj.ws/cnpj/${CNPJ}`);
    expect(fetchFalso.mock.calls[1][1].headers['User-Agent']).toBe('solardoc-nexus/1.0');
    expect(console.warn).toHaveBeenCalledWith('[nexus/receita] brasilapi', 403);
    expect(JSON.stringify((console.warn as any).mock.calls)).not.toContain(CNPJ);
  });

  it('BrasilAPI 403 e cnpj.ws Baixada: ok com ativa false', async () => {
    fetchPor(resp(403), wsCorpo('Baixada'));
    const r = await consultarCnpj(CNPJ);
    expect(r).toMatchObject({ ok: true, ativa: false, razao_social: 'SOLAR EXEMPLO LTDA' });
  });

  it('BrasilAPI com erro de rede e cnpj.ws ativa (sem diferenciar maiúscula)', async () => {
    fetchPor(new Error('rede'), wsCorpo('ATIVA'));
    expect(await consultarCnpj(CNPJ)).toMatchObject({ ok: true, ativa: true });
    expect(console.warn).toHaveBeenCalledWith('[nexus/receita] brasilapi', 'Error');
  });

  it('as duas fontes falhando: indisponivel', async () => {
    fetchPor(resp(429), resp(503));
    expect(await consultarCnpj(CNPJ)).toEqual({ ok: false, motivo: 'indisponivel' });
    expect(console.warn).toHaveBeenCalledWith('[nexus/receita] brasilapi', 429);
    expect(console.warn).toHaveBeenCalledWith('[nexus/receita] cnpjws', 503);
  });

  it('as duas fontes com erro de rede: indisponivel', async () => {
    fetchPor(new Error('rede'), new Error('rede'));
    expect(await consultarCnpj(CNPJ)).toEqual({ ok: false, motivo: 'indisponivel' });
  });

  it('BrasilAPI 404 e 400: invalido, sem tentar a segunda fonte', async () => {
    fetchPor(resp(404));
    expect(await consultarCnpj(CNPJ)).toEqual({ ok: false, motivo: 'invalido' });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    fetchPor(resp(400));
    expect(await consultarCnpj(CNPJ)).toEqual({ ok: false, motivo: 'invalido' });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('BrasilAPI 403 e cnpj.ws 404: invalido', async () => {
    fetchPor(resp(403), resp(404));
    expect(await consultarCnpj(CNPJ)).toEqual({ ok: false, motivo: 'invalido' });
  });

  it('entrada que não são 14 dígitos: invalido sem chamar nada', async () => {
    fetchPor();
    expect(await consultarCnpj('123')).toEqual({ ok: false, motivo: 'invalido' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
