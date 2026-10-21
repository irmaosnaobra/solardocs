import { describe, it, expect } from 'vitest';
import {
  ACOES, CHAVE_COMANDO, CHAVE_RESULTADO, LIMITE_BYTES, chaveVez, depsDoBanco, executarComandoPendente, validarParams,
  type Acao, type DepsComando, type FuncaoAcao, type ResultadoGravado,
} from '../services/agentes5040/comandos';

const AGORA = new Date('2026-10-20T15:00:00.000Z');
const iso = (minAtras: number): string => new Date(AGORA.getTime() - minAtras * 60_000).toISOString();

/** Banco em memória do system_state: comando, reivindicações (unique) e resultado. */
function montar(comando: unknown, acoes: Partial<Record<Acao, FuncaoAcao>>, extra: Partial<DepsComando> = {}) {
  const e = { comando, vezes: new Set<string>(), resultado: null as ResultadoGravado | null, gravacoes: 0, apagou: 0, erros: [] as string[] };
  const deps: DepsComando = {
    agora: () => AGORA,
    ler: async () => e.comando ?? null,
    reivindicar: async chave => { if (e.vezes.has(chave)) return 'ja'; e.vezes.add(chave); return 'ok'; },
    apagar: async () => { e.comando = null; e.apagou++; },
    gravar: async r => { e.resultado = r; e.gravacoes++; },
    acoes,
    registrar: (n, m) => { if (n === 'erro') e.erros.push(m); },
    ...extra,
  };
  return { e, deps };
}

const cmd = (acao: string, minAtras = 1, params: Record<string, unknown> = {}) => ({ acao, params, pedido_em: iso(minAtras) });

describe('canal de comando das agentes 5040', () => {
  it('sem comando não faz nada', async () => {
    const { e, deps } = montar(null, {});
    expect(await executarComandoPendente(deps)).toEqual({ estado: 'nenhum' });
    expect(e.gravacoes).toBe(0);
  });

  it('ação desconhecida é recusada, o comando some e nada roda', async () => {
    let rodou = 0;
    const { e, deps } = montar(cmd('apagar_tudo'), { sonda_armazem: async () => { rodou++; return {}; } });
    const r = await executarComandoPendente(deps);
    expect(r).toMatchObject({ estado: 'recusado', motivo: 'acao_desconhecida' });
    expect(rodou).toBe(0);
    expect(e.comando).toBeNull();
    expect(e.resultado).toMatchObject({ ok: false, resultado: { motivo: 'acao_desconhecida' } });
    expect(e.vezes.size).toBe(0);
  });

  it('a lista fechada tem as 10 ações e nada de envio livre', () => {
    expect([...ACOES].sort()).toEqual([
      'anuncios', 'ensaio_dry', 'ficha_dry', 'ficha_sonda', 'ficha_teste', 'pix_sonda',
      'replay_dry', 'sentinela_seco', 'sentinela_sonda', 'sonda_armazem',
    ]);
  });

  it('comando com mais de 30 minutos é descartado sem rodar', async () => {
    let rodou = 0;
    const { e, deps } = montar(cmd('sonda_armazem', 31), { sonda_armazem: async () => { rodou++; return { ok: true }; } });
    expect(await executarComandoPendente(deps)).toMatchObject({ estado: 'descartado', motivo: 'comando_velho' });
    expect(rodou).toBe(0);
    expect(e.comando).toBeNull();
    expect(e.vezes.size).toBe(0);
    expect(e.resultado).toMatchObject({ ok: false, resultado: { motivo: 'comando_velho' } });
  });

  it('comando de 29 minutos ainda roda; o do futuro distante e o ilegível não', async () => {
    const a = montar(cmd('sonda_armazem', 29), { sonda_armazem: async () => ({ ok: true, privado: true, passos: { escreve: true } }) });
    expect((await executarComandoPendente(a.deps)).estado).toBe('executado');
    const b = montar(cmd('sonda_armazem', -20), { sonda_armazem: async () => ({ ok: true }) });
    expect(await executarComandoPendente(b.deps)).toMatchObject({ estado: 'descartado', motivo: 'pedido_no_futuro' });
    const c = montar({ acao: 'sonda_armazem' }, { sonda_armazem: async () => ({ ok: true }) });
    expect(await executarComandoPendente(c.deps)).toMatchObject({ estado: 'descartado', motivo: 'comando_ilegivel' });
  });

  it('reivindicação dupla roda uma vez só', async () => {
    let rodou = 0;
    const acoes = { sonda_armazem: async () => { rodou++; return { ok: true, privado: true, passos: {} }; } };
    const c = cmd('sonda_armazem');
    const { e, deps } = montar(c, acoes);
    const [r1, r2] = await Promise.all([executarComandoPendente(deps), executarComandoPendente(deps)]);
    expect([r1.estado, r2.estado].sort()).toEqual(['executado', 'ja_pego']);
    expect(rodou).toBe(1);
    expect(e.vezes.has(chaveVez(c.pedido_em))).toBe(true);
    expect(e.gravacoes).toBe(1);
    // outra rodada com o mesmo pedido_em (comando regravado) também não repete.
    e.comando = c;
    expect((await executarComandoPendente(deps)).estado).toBe('ja_pego');
    expect(rodou).toBe(1);
  });

  it('o resultado do ensaio_dry não leva telefone nem texto, só falou/acao/motivo/persona/passo/uso', async () => {
    const bruto = {
      ok: true, ligado: true, dry: true, candidatas: 1, puladas: { humano: 2 }, decididas: 1, comModelo: 1, chamadasIA: 1, parou: null,
      turnos: [{
        hmac8: 'abcd1234', wa_id: 987654, passo: 6, dona: 'duda', persona: 'duda', falou: true,
        bolhas: ['Oi Maria, aqui é a Duda. Seu número 34991360223 chegou.'], acao: 'responder', motivo: null,
        modelo: 'claude-opus-5-5', uso: { entrada: 10, cache_criado: 20, cache_lido: 30, saida: 40 }, gravado: 'nao_gravou',
      }, {
        hmac8: 'ffff0000', wa_id: 5, passo: 'falha', dona: null, persona: null, falou: false, bolhas: [],
        acao: null, motivo: 'telefone 34 99136-0223 na regra', modelo: null, uso: { entrada: 0, cache_criado: 0, cache_lido: 0, saida: 0 }, gravado: 'nao_gravou',
      }],
    };
    const { e, deps } = montar(cmd('ensaio_dry'), { ensaio_dry: async () => bruto });
    await executarComandoPendente(deps);
    const texto = JSON.stringify(e.resultado);
    expect(texto).not.toMatch(/34991360223|99136|Maria|Duda\. Seu|bolhas|hmac8|abcd1234|wa_id/);
    const t0 = (e.resultado!.resultado as any).turnos[0];
    expect(t0).toEqual({
      dona: 'duda', passo: 6, persona: 'duda', falou: true, acao: 'responder', motivo_silencio: null,
      modelo: 'claude-opus-5-5', uso: { entrada: 10, cache_criado: 20, cache_lido: 30, saida: 40 },
    });
    expect((e.resultado!.resultado as any).turnos[1].motivo_silencio).toBe('telefone # na regra');
    expect(e.resultado!.ok).toBe(true);
  });

  it('replay_dry: parâmetros presos (1 conversa, 2 turnos) e resultado sem bolhas', async () => {
    const recebido: unknown[] = [];
    const { e, deps } = montar(cmd('replay_dry', 1, { maxConversas: 1, maxTurnos: 2, desde: '2026-09-01T00:00:00Z', ate: '2026-09-02T00:00:00Z' }), {
      replay_dry: async p => {
        recebido.push(p);
        return {
          ok: true, ligado: true, dry: true, conversasVistas: 3, conversasProcessadas: 1, chamadasIA: 2, parou: null, puladas: {},
          turnos: [{ hmac8: 'x', wa_id: 1, kind: 'resposta', passo: 4, persona: 'carla', falou: false, bolhas: ['segredo do cliente'], acao: null, motivo: 'sem contexto', modelo: 'm', uso: { entrada: 1, cache_criado: 2, cache_lido: 3, saida: 4 } }],
        };
      },
    });
    await executarComandoPendente(deps);
    expect(recebido[0]).toMatchObject({ maxConversas: 1, maxTurnos: 2 });
    expect((recebido[0] as any).desde).toBeInstanceOf(Date);
    expect(JSON.stringify(e.resultado)).not.toMatch(/segredo do cliente|bolhas/);
    expect((e.resultado!.resultado as any).turnos[0]).toMatchObject({ kind: 'resposta', persona: 'carla', falou: false, motivo_silencio: 'sem contexto' });
    // limites
    expect(validarParams('replay_dry', { maxConversas: 2 }, AGORA).ok).toBe(false);
    expect(validarParams('replay_dry', { maxTurnos: 3 }, AGORA).ok).toBe(false);
    expect(validarParams('replay_dry', { desde: 'lixo' }, AGORA).ok).toBe(false);
    expect(validarParams('anuncios', { dias: 31 }, AGORA).ok).toBe(false);
    expect(validarParams('anuncios', {}, AGORA)).toEqual({ ok: true, params: { dias: 30 } });
    expect(validarParams('ficha_sonda', { card: 'x' }, AGORA).ok).toBe(false);
    expect(validarParams('ficha_sonda', { card: 123 }, AGORA)).toEqual({ ok: true, params: { card: 123 } });
  });

  it('parâmetro inválido é recusado sem reivindicar nem rodar', async () => {
    let rodou = 0;
    const { e, deps } = montar(cmd('ficha_sonda', 1, { card: -1 }), { ficha_sonda: async () => { rodou++; return {}; } });
    expect(await executarComandoPendente(deps)).toMatchObject({ estado: 'recusado', motivo: 'parametro_invalido' });
    expect(rodou).toBe(0);
    expect(e.vezes.size).toBe(0);
  });

  it('ficha_dry, ficha_teste e sentinela_seco guardam só tamanhos, nunca o texto', async () => {
    const f = montar(cmd('ficha_dry'), { ficha_dry: async () => ({ rodou: true, ligada: false, dry: true, candidatos: 1, itens: [{ id: 77, resultado: 'previa', previa: 'Ficha de Maria 34991360223' }] }) });
    await executarComandoPendente(f.deps);
    expect(JSON.stringify(f.e.resultado)).not.toMatch(/Maria|34991360223/);
    expect((f.e.resultado!.resultado as any).itens[0]).toMatchObject({ id: 77, resultado: 'previa', previa_tamanho: 26 });

    const t = montar(cmd('ficha_teste'), { ficha_teste: async () => ({ enviado: true, texto: 'Ficha inventada com nome' }) });
    await executarComandoPendente(t.deps);
    expect(t.e.resultado!.resultado).toEqual({ enviado: true, texto_tamanho: 24 });

    const s = montar(cmd('sentinela_seco'), { sentinela_seco: async () => ({ ok: true, estado: 'seco', dia: '2026-10-20', alertas: 2, giovanna: true, texto: 'Giovanna, resumo do dia: 3 desfechos' }) });
    await executarComandoPendente(s.deps);
    expect(JSON.stringify(s.e.resultado)).not.toMatch(/Giovanna, resumo/);
    expect(s.e.resultado!.resultado).toMatchObject({ estado: 'seco', alertas: 2, giovanna: true, calada: false });
  });

  it('anuncios mantém o id do anúncio (não é telefone) e mascara o resto', async () => {
    const { e, deps } = montar(cmd('anuncios', 1, { dias: 7 }), {
      anuncios: async p => ({ ok: true, dias: p.dias, mensagens_recebidas: 5, truncado: false, com_bloco: 2, com_ad_id: 2,
        ids: [{ id: '120211234567890123', mensagens: 2, campanha: 'Solar Uberlândia', produto: 'solar' }], por_produto: { solar: 2, desconhecido: 0 } }),
    });
    await executarComandoPendente(deps);
    expect((e.resultado!.resultado as any).ids[0]).toMatchObject({ id: '120211234567890123', campanha: 'Solar Uberlândia', produto: 'solar' });
  });

  it('o registro inteiro fica em até 4 KB, mesmo com resultado enorme', async () => {
    const turnos = Array.from({ length: 200 }, (_, i) => ({
      hmac8: 'h', wa_id: i, passo: i, dona: 'duda', persona: 'duda', falou: true, bolhas: ['x'.repeat(300)], acao: 'responder',
      motivo: 'm'.repeat(150), modelo: 'claude-opus-5-5', uso: { entrada: 1, cache_criado: 2, cache_lido: 3, saida: 4 },
    }));
    const { e, deps } = montar(cmd('ensaio_dry'), { ensaio_dry: async () => ({ ok: true, ligado: true, dry: true, turnos }) });
    await executarComandoPendente(deps);
    expect(Buffer.byteLength(JSON.stringify(e.resultado), 'utf8')).toBeLessThanOrEqual(LIMITE_BYTES);
    expect((e.resultado!.resultado as any).truncado).toBe(true);
    expect((e.resultado!.resultado as any).turnos_total).toBe(200);

    const g = montar(cmd('pix_sonda'), { pix_sonda: async () => ({ ok: true, passos: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`passo_${i}`, 'seguir'.repeat(10)])) }) });
    await executarComandoPendente(g.deps);
    expect(Buffer.byteLength(JSON.stringify(g.e.resultado), 'utf8')).toBeLessThanOrEqual(LIMITE_BYTES);
  });

  it('erro na ação grava ok:false, sem repetir, e não lança', async () => {
    const { e, deps } = montar(cmd('sonda_armazem'), { sonda_armazem: async () => { throw new Error('bucket caiu para 34991360223'); } });
    const r = await executarComandoPendente(deps);
    expect(r).toMatchObject({ estado: 'executado', ok: false });
    expect(e.resultado).toMatchObject({ acao: 'sonda_armazem', ok: false, resultado: { erro: 'bucket caiu para #' } });
    expect(e.comando).toBeNull();
    expect(e.erros.length).toBe(1);
  });

  it('ação que devolve ok:false grava ok:false; ação que trava estoura o prazo e grava', async () => {
    const a = montar(cmd('sonda_armazem'), { sonda_armazem: async () => ({ ok: false, privado: false, passos: {}, erro: 'x' }) });
    await executarComandoPendente(a.deps);
    expect(a.e.resultado!.ok).toBe(false);
    const b = montar(cmd('sonda_armazem'), { sonda_armazem: () => new Promise(() => {}) }, { prazoMs: 20 });
    expect(await executarComandoPendente(b.deps)).toMatchObject({ estado: 'executado', ok: false });
    expect((b.e.resultado!.resultado as any).erro).toMatch(/passou de/);
  });

  it('falha ao ler o banco não lança (o ensaio segue)', async () => {
    const { deps } = montar(null, {}, { ler: async () => { throw new Error('banco fora'); } });
    expect(await executarComandoPendente(deps)).toEqual({ estado: 'erro', motivo: 'falha_geral' });
  });

  it('ação sem ligação no cron é recusada', async () => {
    const { e, deps } = montar(cmd('pix_sonda'), {});
    expect(await executarComandoPendente(deps)).toMatchObject({ estado: 'recusado', motivo: 'acao_nao_ligada' });
    expect(e.comando).toBeNull();
  });
});

describe('depsDoBanco (system_state)', () => {
  it('lê, reivindica por insert (23505 = já), apaga e grava o resultado por upsert', async () => {
    const chamadas: Array<{ op: string; arg?: any; chave?: string }> = [];
    let dupla = false;
    const db = {
      from: (t: string) => {
        expect(t).toBe('system_state');
        const q: any = {
          select: () => q, eq: (_c: string, v: string) => { chamadas.push({ op: 'eq', chave: v }); return q; },
          maybeSingle: async () => ({ data: { value: { acao: 'x' } }, error: null }),
          insert: async (v: any) => { chamadas.push({ op: 'insert', arg: v }); return { error: dupla ? { code: '23505' } : null }; },
          delete: () => { chamadas.push({ op: 'delete' }); return { eq: async (_c: string, v: string) => { chamadas.push({ op: 'eq', chave: v }); return { error: null }; } }; },
          upsert: async (v: any, o: any) => { chamadas.push({ op: 'upsert', arg: { v, o } }); return { error: null }; },
        };
        return q;
      },
    };
    const d = depsDoBanco(db);
    expect(await d.ler()).toEqual({ acao: 'x' });
    expect(await d.reivindicar('ag5040_comando_vez:2026')).toBe('ok');
    dupla = true;
    expect(await d.reivindicar('ag5040_comando_vez:2026')).toBe('ja');
    await d.apagar();
    await d.gravar({ acao: 'a', pedido_em: 'p', ok: true, resultado: {}, terminou_em: 't' });
    expect(chamadas.filter(c => c.op === 'eq').map(c => c.chave)).toEqual([CHAVE_COMANDO, CHAVE_COMANDO]);
    expect(chamadas.find(c => c.op === 'insert')!.arg.key).toBe('ag5040_comando_vez:2026');
    expect(chamadas.find(c => c.op === 'upsert')!.arg.v.key).toBe(CHAVE_RESULTADO);
    expect(chamadas.find(c => c.op === 'upsert')!.arg.o).toEqual({ onConflict: 'key' });
  });
});
