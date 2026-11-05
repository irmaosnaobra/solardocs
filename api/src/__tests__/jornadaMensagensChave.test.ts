import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BancoFalso } from './bancoFalsoQuiz';

// A chave de ligar e desligar as mensagens da Jornada (fase 3): assinada, nasce toda desligada, o cliente só liga 24 h depois da equipe.

const h = vi.hoisted(() => ({ main: null as any }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));

import { CHAVE_MSGS, assinarMensagens, chaveVazia, gravarGrupo, lerMensagens, ligadosAgora, normalizarMensagens } from '../services/gerador/jornadaMensagensChave';
import { ErroJornada } from '../services/gerador/jornadaSolarBanco';

const T0 = new Date('2026-11-05T12:00:00.000Z');
const mais = (horas: number): Date => new Date(T0.getTime() + horas * 3600_000);
const linha = (): any => h.main.tabela('system_state').find((l: any) => l.key === CHAVE_MSGS);

beforeEach(() => {
  h.main = new BancoFalso();
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
});

describe('a assinatura', () => {
  it('sem linha, tudo desligado e válido; confere mesmo com as chaves embaralhadas; a forjada vale desligado', async () => {
    const vazio = await lerMensagens();
    expect(vazio).toMatchObject({ valida: true, versao: null });
    expect(Object.values(ligadosAgora(vazio.m)).every((x) => x === null)).toBe(true);

    await gravarGrupo('venda', true, 'Thiago', T0);
    const l = linha();
    // O jsonb do Postgres devolve outra ordem de chaves: a assinatura é sobre o normalizado.
    const embaralhado = (v: any): any => (Array.isArray(v) ? v.map(embaralhado) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, embaralhado(x)])) : v);
    l.value = embaralhado(l.value);
    const lida = await lerMensagens();
    expect(lida.valida).toBe(true);
    expect(ligadosAgora(lida.m).venda).toBe(T0.toISOString());

    l.value = { ...l.value, grupos: { ...l.value.grupos, fila: { ligado: true, ligado_em: '2026-11-01T00:00:00.000Z', primeiro_ligado_em: '2026-11-01T00:00:00.000Z', por: 'x' } } };
    const forjada = await lerMensagens();
    expect(forjada.valida).toBe(false);
    expect(Object.values(ligadosAgora(forjada.m)).every((x) => x === null)).toBe(true);
    await expect(gravarGrupo('etapa', true, 'thiago', mais(1))).rejects.toMatchObject({ codigo: 'assinatura' });
  });
  it('sem segredo a gravação falha e a leitura vale desligado', async () => {
    delete process.env.VINCULO_SOLAR_SECRET; delete process.env.SUPABASE_SERVICE_KEY;
    await expect(gravarGrupo('venda', true, 'thiago', T0)).rejects.toBeInstanceOf(ErroJornada);
    expect(assinarMensagens(chaveVazia())).toBeNull();
  });
  it('JORNADA_MSG_OFF=1 desliga os cinco sem deploy', async () => {
    await gravarGrupo('venda', true, 'thiago', T0);
    const { m } = await lerMensagens();
    expect(ligadosAgora(m, {} as NodeJS.ProcessEnv).venda).not.toBeNull();
    expect(Object.values(ligadosAgora(m, { JORNADA_MSG_OFF: '1' } as unknown as NodeJS.ProcessEnv)).every((x) => x === null)).toBe(true);
  });
  it('ligado sem instante não vale', () => {
    const n = normalizarMensagens({ v: 1, grupos: { venda: { ligado: true, ligado_em: null } }, historico: [] })!;
    expect(n.grupos.venda.ligado).toBe(false);
  });
});

describe('a ordem de ligar (D7)', () => {
  it('o cliente antes da equipe dá erro de ordem; com a equipe ligada há 23 h também; há 24 h passa', async () => {
    await expect(gravarGrupo('liberacao', true, 'thiago', T0)).rejects.toMatchObject({ codigo: 'ordem' });
    for (const g of ['venda', 'etapa', 'fila'] as const) await gravarGrupo(g, true, 'thiago', T0);
    await expect(gravarGrupo('liberacao', true, 'thiago', mais(23))).rejects.toMatchObject({ codigo: 'ordem' });
    await expect(gravarGrupo('aniversario', true, 'thiago', mais(23))).rejects.toMatchObject({ codigo: 'ordem' });
    const ok = await gravarGrupo('liberacao', true, 'thiago', mais(24));
    expect(ok.grupos.liberacao).toMatchObject({ ligado: true, ligado_em: mais(24).toISOString() });
    // Uma da equipe desligada de novo trava o cliente outra vez.
    await gravarGrupo('fila', false, 'thiago', mais(25));
    await expect(gravarGrupo('aniversario', true, 'thiago', mais(26))).rejects.toMatchObject({ codigo: 'ordem' });
  });
  it('desligar o cliente nunca pede ordem', async () => {
    const r = await gravarGrupo('liberacao', false, 'thiago', T0);
    expect(r.grupos.liberacao.ligado).toBe(false);
  });
});

describe('religar', () => {
  it('troca o ligado_em e mantém o primeiro_ligado_em; desligar mantém os dois', async () => {
    await gravarGrupo('fila', true, 'thiago', T0);
    const off = await gravarGrupo('fila', false, 'giovanna', mais(2));
    expect(off.grupos.fila).toMatchObject({ ligado: false, ligado_em: T0.toISOString(), primeiro_ligado_em: T0.toISOString(), por: 'giovanna' });
    const de_novo = await gravarGrupo('fila', true, 'thiago', mais(5));
    expect(de_novo.grupos.fila).toMatchObject({ ligado: true, ligado_em: mais(5).toISOString(), primeiro_ligado_em: T0.toISOString() });
    expect(de_novo.historico.map((x) => [x.grupo, x.ligado])).toEqual([['fila', true], ['fila', false], ['fila', true]]);
    expect(h.main.tabela('system_state').filter((l: any) => l.key === CHAVE_MSGS)).toHaveLength(1);
  });
});
