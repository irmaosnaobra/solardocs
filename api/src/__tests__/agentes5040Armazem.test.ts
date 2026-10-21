import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ principal: null as any }));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));

import { novoBanco, type BancoFalso } from './_agentes5040Fake';
import {
  BUCKET_ENSAIO, ErroArmazem, garantirBucketEnsaio, gravarMidiaCache, gravarTurno, lerMidiaCache, lerTurnos, listarConversas,
  sondarArmazem, zerarCacheArmazem, type TurnoGravado,
} from '../services/agentes5040/armazem';
import { faxinar, reservarChamada, tetoDe } from '../services/agentes5040/cota';

let banco: BancoFalso;
const HMAC = 'a'.repeat(64);

const turno = (waId: number, extra: Partial<TurnoGravado> = {}): TurnoGravado => ({
  v: 1, origem: 'vivo', dia: '2026-10-20', hmac: HMAC, wa_id: waId, momento: `2026-10-20T14:${10 + waId}:00Z`, kind: 'resposta',
  dona: 'helena', passo: 6, motivo_porteiro: 'x', persona: 'helena', falou: true, bolhas: ['Oi.'], acao: 'continuar', peca: null,
  dados: {}, resumo: null, motivo_silencio: null, reescrita: null, modelo: 'm', uso: null, qualificado: false,
  pergunta_porteiro: null, entrada: [], n_historico: 1, real: null, gravado_em: '2026-10-20T15:00:00Z', ...extra,
});

beforeEach(() => {
  banco = novoBanco(); h.principal = banco; zerarCacheArmazem();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('armazém', () => {
  it('cria o bucket PRIVADO quando não existe; getBucket antes de qualquer list', async () => {
    await garantirBucketEnsaio();
    expect(banco.bucket).toEqual({ existe: true, publico: false, criado: true });
    expect(BUCKET_ENSAIO).toBe('ensaio-5040');
  });

  it('bucket público é erro', async () => {
    banco.bucket = { existe: true, publico: true, criado: false };
    await expect(garantirBucketEnsaio()).rejects.toMatchObject({ codigo: 'bucket_publico' });
    await expect(gravarTurno(turno(1))).rejects.toBeInstanceOf(ErroArmazem);
    expect(banco.objetos.size).toBe(0);
  });

  it('um objeto por turno; gravar de novo é "já existia", nunca sobrescreve', async () => {
    expect(await gravarTurno(turno(1, { bolhas: ['Primeira.'] }))).toBe('gravado');
    expect(await gravarTurno(turno(1, { bolhas: ['Segunda.'] }))).toBe('ja_existia');
    expect(JSON.parse(banco.objetos.get(`turnos/2026-10-20/${HMAC}/1.json`)!).bolhas).toEqual(['Primeira.']);
  });

  it('turno com HMAC ou dia inválido não vai para o bucket (nada de telefone no caminho)', async () => {
    await expect(gravarTurno(turno(1, { hmac: '3491112222' }))).rejects.toMatchObject({ codigo: 'turno_invalido' });
    await expect(gravarTurno(turno(1, { dia: '../x' }))).rejects.toMatchObject({ codigo: 'turno_invalido' });
  });

  it('lê os turnos da conversa em ordem e lista as conversas com o filtro de origem', async () => {
    await gravarTurno(turno(2));
    await gravarTurno(turno(1));
    await gravarTurno(turno(1, { hmac: 'b'.repeat(64), origem: 'replay' }));
    expect((await lerTurnos(HMAC)).map(t => t.wa_id)).toEqual([1, 2]);
    const todas = await listarConversas({ dias: 7 });
    expect(todas).toHaveLength(2);
    expect((await listarConversas({ origem: 'replay' })).map(c => c.hmac)).toEqual(['b'.repeat(64)]);
    expect((await listarConversas({ origem: 'vivo' })).map(c => c.turnos)).toEqual([2]);
  });

  it('cache de mídia: guarda a leitura de verdade, ignora marcador', async () => {
    await gravarMidiaCache({ msgId: 7, tipo: 'texto', texto: '(áudio transcrito) quero solar' });
    await gravarMidiaCache({ msgId: 8, tipo: 'texto', texto: '[audio]' });
    const c = await lerMidiaCache([7, 8]);
    expect([...c.keys()]).toEqual([7]);
  });

  it('a sonda escreve, lê, não sobrescreve, lista, apaga e confirma bucket privado', async () => {
    const r = await sondarArmazem(new Date('2026-10-20T15:00:00Z'));
    expect(r).toMatchObject({ ok: true, privado: true });
    expect(r.passos).toMatchObject({ escreveu: true, leu: true, nao_sobrescreve: true, listou: true, apagou: true });
    expect([...banco.objetos.keys()].filter(k => k.startsWith('sonda/'))).toEqual([]);
  });
});

describe('cota', () => {
  const agora = new Date('2026-10-20T15:00:00Z');

  it('teto: padrão 120, env válida troca, inválida volta ao padrão', () => {
    delete process.env.AGENTES5040_TETO_VIVO;
    expect(tetoDe('vivo')).toBe(120);
    process.env.AGENTES5040_TETO_VIVO = '5';
    expect(tetoDe('vivo')).toBe(5);
    process.env.AGENTES5040_TETO_VIVO = '0';
    expect(tetoDe('vivo')).toBe(120);
    delete process.env.AGENTES5040_TETO_VIVO;
  });

  it('reserva por insert, contando do que já existe; passou do teto, recusa', async () => {
    process.env.AGENTES5040_TETO_REPLAY = '3';
    banco.tabelas.system_state = [{ key: 'ag5040_ia:replay:2026-10-20:1', value: {} }];
    expect(await reservarChamada('replay', agora)).toEqual({ ok: true, n: 2 });
    expect(await reservarChamada('replay', agora)).toEqual({ ok: true, n: 3 });
    expect(await reservarChamada('replay', agora)).toEqual({ ok: false, motivo: 'teto' });
    delete process.env.AGENTES5040_TETO_REPLAY;
  });

  it('corrida: se a vaga da contagem já foi tomada (23505), tenta a próxima', async () => {
    // a contagem vê 0, mas a vaga 1 aparece no meio: simulada com uma linha que a contagem não enxerga (outro dia no filtro)
    banco.tabelas.system_state = [];
    const original = banco.cliente.from;
    let primeira = true;
    banco.cliente.from = (nome: string) => {
      const b = original(nome);
      if (nome === 'system_state' && primeira) {
        const ins = b.insert.bind(b);
        b.insert = (p: any) => {
          if (primeira && p.key?.startsWith('ag5040_ia:vivo:')) { primeira = false; banco.tabelas.system_state!.push({ key: p.key, value: {} }); }
          return ins(p);
        };
      }
      return b;
    };
    expect(await reservarChamada('vivo', agora)).toEqual({ ok: true, n: 2 });
  });

  it('a faxina apaga reservas de mais de 7 dias, uma vez por dia, e não mexe nas novas nem em outras chaves', async () => {
    banco.tabelas.system_state = [
      { key: 'ag5040_ia:vivo:2026-10-01:1', value: { em: '2026-10-01T10:00:00Z' } },
      { key: 'ag5040_vez:55', value: { em: '2026-10-02T10:00:00Z' } },
      { key: 'ag5040_lock:123', value: { em: '2026-10-19T10:00:00Z' } },
      { key: 'ag5040_faxina:2026-10-05', value: { em: '2026-10-05T10:00:00Z' } },
      { key: 'ag5040_interruptores', value: { ensaio: true } },
      { key: 'ag5040_disjuntor', value: { ate: '2026-10-01T00:00:00Z' } },
    ];
    expect(await faxinar(agora)).toBe(3);
    expect(banco.tabelas.system_state!.map(l => l.key).sort()).toEqual(['ag5040_disjuntor', 'ag5040_faxina:2026-10-20', 'ag5040_interruptores', 'ag5040_lock:123']);
    expect(await faxinar(agora)).toBe(0);
  });
});
