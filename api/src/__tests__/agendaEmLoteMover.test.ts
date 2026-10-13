import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// MOVER CARD DO LOTE (13/10/2026). O almoço (12:00 às 13:30) foi travado e 35 cards
// criados pelo lote caíram nele. Mover = trocar o `quando` e mais nada, sem
// mensagem, e sem deixar o repasse de 12h nem a marca de silêncio para trás.
// Aqui: a ordem das escritas, o escopo, as recusas e quando o lote PARA.

type Card = {
  id: number; quando: string; status: string; created_by: string; vendedor_nome: string;
  repassar_em: string | null; confirmacao_at: string | null; lembrete_1h_at: string | null; lembrete_5min_at: string | null;
};

/** O que aconteceu, na ordem. */
let ordem: string[] = [];
/** Cada patch enviado num UPDATE, com os filtros. */
let patches: Array<{ patch: Record<string, unknown>; filtros: Array<[string, unknown]> }> = [];
let cards = new Map<number, Card>();
let ocupados = new Set<string>();
let marcaFalha = false;
let marcas: Array<{ id: number; quando: string }> = [];
let repasseNaoGruda = false;       // o UPDATE do repassar_em não zera (banco ruim)
let triggerNulaConfirmacao = false; // o trigger leva a confirmacao_at junto
let erroNoUpdateDoQuando = false;
let erroNaLeitura = false;
let cardMudaNoMeio = false;        // outra sessão tira o card de 'agendado' entre a leitura e a escrita

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: () => { throw new Error('rede proibida no teste'); } } }));
vi.mock('../services/io/eletropostoReagendaAuto', () => ({ EP_MUDO_PREFIX: 'ep_mudo:' }));
vi.mock('../services/io/eletropostoCard', () => ({
  DONOS_EP: ['Thiago', 'Diego'],
  gravarCardEletroposto: vi.fn(async () => { throw new Error('mover não cria card'); }),
}));
vi.mock('../services/io/epMudo', () => ({
  gravarMarcaMuda: vi.fn(async (id: number, quando: string) => {
    ordem.push('marca_ep_mudo');
    marcas.push({ id, quando });
    if (marcaFalha) throw new Error('banco fora');
    return quando;
  }),
}));
vi.mock('../services/agenda/etiquetaCard', () => ({
  guardarEtiquetaDoCard: vi.fn(async () => { ordem.push('etiqueta'); }),
  guardarTipoDoCard: vi.fn(async () => { ordem.push('tipo'); return true; }),
}));
vi.mock('../services/agents/whatsapp/silenciar', () => ({
  chaveContato: () => null, carregarBloqueados: async () => () => false, carregarSilenciados: async () => () => false,
}));

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      if (tabela !== 'agendamentos') throw new Error(`tabela inesperada ${tabela}`);
      const q: any = { _op: 'select', _cols: '', _patch: null as any, _filtros: [] as Array<[string, unknown]> };

      const acha = (): Card | null => {
        const idF = q._filtros.find((f: [string, unknown]) => f[0] === 'id');
        const c = idF ? cards.get(Number(idF[1])) ?? null : null;
        if (!c) return null;
        for (const [col, val] of q._filtros) if ((c as any)[col] !== val) return null;
        return c;
      };
      /** O UPDATE, com o trigger do banco simulado: mexer no `quando` rearma o repassar_em. */
      const executaUpdate = (): { data: any[] | null; error: any } => {
        const patch = q._patch as Record<string, unknown>;
        patches.push({ patch: { ...patch }, filtros: [...q._filtros] });
        if ('quando' in patch) {
          ordem.push('update_quando');
          if (erroNoUpdateDoQuando) return { data: null, error: { code: '57014', message: 'timeout' } };
          const idF = q._filtros.find((f: [string, unknown]) => f[0] === 'id');
          const alvo = idF ? cards.get(Number(idF[1])) : undefined;
          if (alvo && cardMudaNoMeio) alvo.status = 'cancelado';
          const c = acha();
          if (!c) return { data: [], error: null };
          if (ocupados.has(`${c.vendedor_nome}|${patch.quando}`)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          c.quando = String(patch.quando);
          c.repassar_em = new Date(new Date(c.quando).getTime() + 12 * 3600_000).toISOString();   // o trigger rearma
          if (triggerNulaConfirmacao) c.confirmacao_at = null;
          return { data: [{ id: c.id, quando: c.quando }], error: null };
        }
        ordem.push('update_repassar_em_nulo');
        const c = acha();
        if (c && !repasseNaoGruda) c.repassar_em = null;
        return { data: null, error: null };
      };

      q.select = (cols: string) => {
        q._cols = cols;
        if (q._op === 'update') return Promise.resolve(executaUpdate());
        return q;
      };
      q.update = (p: any) => { q._op = 'update'; q._patch = p; return q; };
      q.eq = (col: string, val: unknown) => { q._filtros.push([col, val]); return q; };
      q.maybeSingle = () => {
        ordem.push(q._cols.includes('created_by') ? 'ler_card' : 'ler_de_volta');
        if (erroNaLeitura) return Promise.resolve({ data: null, error: { message: 'leitura falhou' } });
        const c = acha();
        return Promise.resolve({ data: c ? { ...c } : null, error: null });
      };
      // `await` de um UPDATE sem .select() (o do repassar_em)
      q.then = (res: any, rej: any) => Promise.resolve(executaUpdate()).then(res, rej);
      return q;
    },
  },
}));

// terça 13/10/2026, 12h de Brasília
const AGORA = new Date('2026-10-13T15:00:00.000Z');
const brt = (dia: string, hhmm: string) => `2026-10-${dia}T${hhmm}:00-03:00`;
const utc = (dia: string, hhmm: string) => new Date(brt(dia, hhmm)).toISOString();

function card(id: number, quandoBrt: string, over: Partial<Card> = {}): Card {
  const c: Card = {
    id, quando: utc('14', quandoBrt), status: 'agendado', created_by: 'cadastro_eletroposto', vendedor_nome: 'Thiago',
    repassar_em: null, confirmacao_at: '2026-10-13T14:00:00+00:00', lembrete_1h_at: '2026-10-13T14:00:00+00:00', lembrete_5min_at: '2026-10-13T14:00:00+00:00',
    ...over,
  };
  cards.set(id, c);
  return c;
}

async function mover(itens: any[], dry = false) {
  const { moverEmLote } = await import('../services/io/agendaEmLote');
  return moverEmLote(itens, { dry });
}

beforeEach(() => {
  ordem = []; patches = []; cards = new Map(); ocupados = new Set(); marcaFalha = false; marcas = [];
  repasseNaoGruda = false; triggerNulaConfirmacao = false; erroNoUpdateDoQuando = false; erroNaLeitura = false; cardMudaNoMeio = false;
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

describe('a sequência de escritas', () => {
  it('lê o card, UPDATE do quando, marca, repassar_em nulo SEPARADO e leitura de volta, nesta ordem', async () => {
    card(1, '12:00');
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }]);
    expect(r.itens[0]).toMatchObject({ id: 1, resultado: 'movido', de: utc('14', '12:00'), para: utc('14', '11:30') });
    expect(ordem).toEqual(['ler_card', 'update_quando', 'marca_ep_mudo', 'update_repassar_em_nulo', 'ler_de_volta']);
  });

  it('o primeiro UPDATE leva SÓ o quando e o segundo SÓ o repassar_em nulo', async () => {
    card(1, '12:00');
    await mover([{ id: 1, quando: brt('14', '11:30') }]);
    expect(patches).toHaveLength(2);
    expect(patches[0]!.patch).toEqual({ quando: utc('14', '11:30') });
    expect(patches[1]!.patch).toEqual({ repassar_em: null });
    expect(patches[1]!.filtros).toEqual([['id', 1], ['created_by', 'cadastro_eletroposto']]);
  });

  it('o UPDATE do quando leva as três travas no WHERE: id, origem e status agendado', async () => {
    card(1, '12:00');
    await mover([{ id: 1, quando: brt('14', '11:30') }]);
    expect(patches[0]!.filtros).toEqual([['id', 1], ['created_by', 'cadastro_eletroposto'], ['status', 'agendado']]);
  });

  it('a marca ep_mudo casa com o horário NOVO, e o card termina com repassar_em nulo e carimbos intactos', async () => {
    const c = card(1, '12:00');
    await mover([{ id: 1, quando: brt('14', '11:30') }]);
    expect(marcas).toEqual([{ id: 1, quando: utc('14', '11:30') }]);
    expect(c.quando).toBe(utc('14', '11:30'));
    expect(c.repassar_em).toBeNull();            // o trigger rearmou e o UPDATE separado zerou
    expect(c.confirmacao_at).not.toBeNull();
    expect(c.status).toBe('agendado');
    expect(c.vendedor_nome).toBe('Thiago');
  });

  it('nunca manda mensagem nem mexe em etiqueta, tipo ou card novo', async () => {
    card(1, '12:00');
    await mover([{ id: 1, quando: brt('14', '11:30') }]);
    expect(ordem).not.toContain('etiqueta');
    expect(ordem).not.toContain('tipo');
    expect(ordem).not.toContain('insert');
  });
});

describe('o escopo: só card do lote, ainda agendado', () => {
  it('card de OUTRA origem não é tocado', async () => {
    const c = card(2, '12:00', { created_by: 'lp_eletroposto' });
    const r = await mover([{ id: 2, quando: brt('14', '11:30') }]);
    expect(r.itens[0]).toMatchObject({ id: 2, resultado: 'fora_do_escopo', motivo: 'origem_diferente_do_lote' });
    expect(ordem).toEqual(['ler_card']);
    expect(patches).toHaveLength(0);
    expect(c.quando).toBe(utc('14', '12:00'));
  });

  it.each(['cotista', 'cancelado', 'nao_atendeu', 'vendido'])('card em "%s" não é tocado', async (status) => {
    const c = card(3, '12:00', { status });
    const r = await mover([{ id: 3, quando: brt('14', '11:30') }]);
    expect(r.itens[0]).toMatchObject({ resultado: 'fora_do_escopo', motivo: 'status_diferente_de_agendado' });
    expect(patches).toHaveLength(0);
    expect(c.quando).toBe(utc('14', '12:00'));
  });

  it('card que não existe é fora_do_escopo, sem escrever', async () => {
    const r = await mover([{ id: 999, quando: brt('14', '11:30') }]);
    expect(r.itens[0]).toMatchObject({ id: 999, resultado: 'fora_do_escopo', motivo: 'card_nao_encontrado' });
    expect(patches).toHaveLength(0);
  });

  it('card que saiu de agendado ENTRE a leitura e a escrita: zero linhas, fora_do_escopo, nada mais é escrito', async () => {
    card(4, '12:00'); cardMudaNoMeio = true;
    const r = await mover([{ id: 4, quando: brt('14', '11:30') }]);
    expect(r.itens[0]).toMatchObject({ resultado: 'fora_do_escopo', motivo: 'card_mudou_antes_da_gravacao' });
    expect(ordem).toEqual(['ler_card', 'update_quando']);
    expect(r.parou).toBe(false);
  });
});

describe('o horário novo passa pelas MESMAS regras da criação', () => {
  const recusa = async (quando: unknown) => {
    const c = card(5, '12:00');
    const r = await mover([{ id: 5, quando }]);
    expect(patches).toHaveLength(0);
    expect(c.quando).toBe(utc('14', '12:00'));
    return r.itens[0]!;
  };

  it('almoço: 12:00, 12:30 e 13:00 recusados', async () => {
    for (const h of ['12:00', '12:30', '13:00']) {
      expect(await recusa(brt('15', h))).toMatchObject({ resultado: 'invalido', motivo: 'horario_de_almoco' });
    }
  });

  it('minuto 15 recusado', async () => {
    expect(await recusa(brt('15', '10:15'))).toMatchObject({ resultado: 'invalido', motivo: 'minuto_fora_da_grade' });
  });

  it('20:00 e 07:30 recusados', async () => {
    expect(await recusa(brt('15', '20:00'))).toMatchObject({ resultado: 'invalido', motivo: 'fora_das_8_as_19_30' });
    expect(await recusa(brt('15', '07:30'))).toMatchObject({ resultado: 'invalido', motivo: 'fora_das_8_as_19_30' });
  });

  it('sábado recusado', async () => {
    expect(await recusa(brt('17', '10:00'))).toMatchObject({ resultado: 'invalido', motivo: 'fim_de_semana' });
  });

  it('passado recusado', async () => {
    expect(await recusa(brt('13', '09:00'))).toMatchObject({ resultado: 'invalido', motivo: 'quando_no_passado' });
  });

  it('hora sem fuso e valor que não é texto recusados', async () => {
    expect(await recusa('2026-10-15T10:00:00')).toMatchObject({ resultado: 'invalido', motivo: 'quando_nao_e_iso_com_fuso' });
    expect(await recusa(undefined)).toMatchObject({ resultado: 'invalido' });
  });

  it('11:30, 13:30 e 19:30 entram (a janela da criação não mudou)', async () => {
    card(6, '12:00'); card(7, '12:30', { vendedor_nome: 'Diego' }); card(8, '13:00', { vendedor_nome: 'Diego' });
    const r = await mover([
      { id: 6, quando: brt('14', '11:30') }, { id: 7, quando: brt('14', '13:30') }, { id: 8, quando: brt('14', '19:30') },
    ], true);
    expect(r.itens.map(i => i.resultado)).toEqual(['previa', 'previa', 'previa']);
  });

  it('o fuso é o de Brasília: 14:30Z é 11:30 BRT e entra; 15:30Z é 12:30 BRT e é almoço', async () => {
    card(9, '12:00');
    const ok = await mover([{ id: 9, quando: '2026-10-14T14:30:00Z' }], true);
    expect(ok.itens[0]!.resultado).toBe('previa');
    const almoco = await mover([{ id: 9, quando: '2026-10-14T15:30:00Z' }], true);
    expect(almoco.itens[0]).toMatchObject({ resultado: 'invalido', motivo: 'horario_de_almoco' });
  });

  it('igual ao quando atual volta sem_mudanca (o banco devolve +00:00, o pedido vem em -03:00)', async () => {
    card(10, '14:00', { quando: '2026-10-14T17:00:00+00:00' });
    const r = await mover([{ id: 10, quando: brt('14', '14:00') }]);
    expect(r.itens[0]).toMatchObject({ id: 10, resultado: 'sem_mudanca' });
    expect(patches).toHaveLength(0);
  });
});

describe('quando algo dá errado no meio', () => {
  it('horário ocupado (23505) segue para o próximo, sem procurar outro horário', async () => {
    card(1, '12:00'); card(2, '12:30');
    ocupados.add(`Thiago|${utc('14', '11:30')}`);
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }, { id: 2, quando: brt('14', '11:00') }]);
    expect(r.itens.map(i => i.resultado)).toEqual(['horario_ocupado', 'movido']);
    expect(r.parou).toBe(false);
    expect(cards.get(1)!.quando).toBe(utc('14', '12:00'));     // o card ocupado não andou
    expect(ordem.filter(o => o === 'marca_ep_mudo')).toHaveLength(1);   // e não ganhou marca
  });

  it('a marca ep_mudo falhando 3 vezes PARA o lote: aviso no item e os seguintes não são tocados', async () => {
    card(1, '12:00'); card(2, '12:30'); marcaFalha = true;
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }, { id: 2, quando: brt('14', '11:00') }]);
    expect(r.itens[0]).toMatchObject({ id: 1, resultado: 'parou_o_lote', motivo: 'marca_ep_mudo_nao_gravou_em_3_tentativas' });
    expect(r.itens[0]!.aviso).toContain('#1');
    expect(r.itens[1]).toMatchObject({ id: 2, resultado: 'nao_processado' });
    expect(r.parou).toBe(true);
    expect(r.motivo_da_parada).toBe('marca_ep_mudo_nao_gravou');
    expect(ordem.filter(o => o === 'marca_ep_mudo')).toHaveLength(3);
    expect(ordem.filter(o => o === 'update_quando')).toHaveLength(1);
    expect(cards.get(2)!.quando).toBe(utc('14', '12:30'));
  });

  it('marca falhando: o UPDATE do repasse roda mesmo assim (com a trava de origem) e o aviso diz a verdade', async () => {
    const c = card(1, '12:00'); card(2, '12:30'); marcaFalha = true;
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }, { id: 2, quando: brt('14', '11:00') }]);
    expect(ordem).toEqual([
      'ler_card', 'update_quando', 'marca_ep_mudo', 'marca_ep_mudo', 'marca_ep_mudo', 'update_repassar_em_nulo',
    ]);
    const rep = patches[1]!;
    expect(rep.patch).toEqual({ repassar_em: null });
    expect(rep.filtros).toEqual([['id', 1], ['created_by', 'cadastro_eletroposto']]);
    expect(c.repassar_em).toBeNull();
    expect(r.itens[0]).toMatchObject({ resultado: 'parou_o_lote' });
    expect(r.itens[0]!.aviso).toContain('movido');
    expect(r.itens[0]!.aviso).toContain('repasse de 12h foi zerado');
    expect(r.itens[1]!.resultado).toBe('nao_processado');
  });


  it('repassar_em que não zera PARA o lote', async () => {
    card(1, '12:00'); card(2, '12:30'); repasseNaoGruda = true;
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }, { id: 2, quando: brt('14', '11:00') }]);
    expect(r.itens[0]).toMatchObject({ resultado: 'parou_o_lote', motivo: 'repassar_em_ficou_preenchido' });
    expect(r.itens[1]!.resultado).toBe('nao_processado');
    expect(r.motivo_da_parada).toBe('repassar_em_ficou_preenchido');
  });

  it('confirmacao_at que some depois do UPDATE PARA o lote', async () => {
    card(1, '12:00'); triggerNulaConfirmacao = true;
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }]);
    expect(r.itens[0]).toMatchObject({ resultado: 'parou_o_lote', motivo: 'confirmacao_at_vazio' });
    expect(r.parou).toBe(true);
  });

  it('erro de gravação: o item volta como erro e 3 seguidos param o lote', async () => {
    card(1, '12:00'); card(2, '12:30'); card(3, '13:00'); card(4, '09:00');
    erroNoUpdateDoQuando = true;
    const r = await mover([
      { id: 1, quando: brt('14', '11:30') }, { id: 2, quando: brt('14', '11:00') },
      { id: 3, quando: brt('14', '10:30') }, { id: 4, quando: brt('14', '10:00') },
    ]);
    expect(r.itens.map(i => i.resultado)).toEqual(['erro', 'erro', 'erro', 'nao_processado']);
    expect(r.parou).toBe(true);
    expect(r.motivo_da_parada).toBe('3_erros_de_gravacao_seguidos');
  });

  it('leitura do card falhando devolve erro e não escreve', async () => {
    card(1, '12:00'); erroNaLeitura = true;
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }]);
    expect(r.itens[0]).toMatchObject({ resultado: 'erro', motivo: 'leitura_do_card_falhou' });
    expect(patches).toHaveLength(0);
  });
});

describe('dry', () => {
  it('lê e confere o escopo, devolve previa com de e para, e NÃO escreve', async () => {
    const c = card(1, '12:00'); card(2, '12:00', { created_by: 'lp_eletroposto' });
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }, { id: 2, quando: brt('14', '11:30') }], true);
    expect(r.dry).toBe(true);
    expect(r.itens[0]).toMatchObject({ id: 1, resultado: 'previa', de: utc('14', '12:00'), para: utc('14', '11:30') });
    expect(r.itens[1]).toMatchObject({ id: 2, resultado: 'fora_do_escopo' });
    expect(ordem).toEqual(['ler_card', 'ler_card']);
    expect(patches).toHaveLength(0);
    expect(marcas).toHaveLength(0);
    expect(c.quando).toBe(utc('14', '12:00'));
  });
});

describe('o lote', () => {
  it('o mesmo id duas vezes na chamada: o segundo é recusado sem tocar', async () => {
    card(1, '12:00');
    const r = await mover([{ id: 1, quando: brt('14', '11:30') }, { id: 1, quando: brt('14', '11:00') }]);
    expect(r.itens.map(i => i.resultado)).toEqual(['movido', 'invalido']);
    expect(r.itens[1]!.motivo).toBe('id_repetido_no_lote');
    expect(cards.get(1)!.quando).toBe(utc('14', '11:30'));
  });

  it('id que não é número inteiro positivo é inválido', async () => {
    const r = await mover([{ id: 'abc', quando: brt('14', '11:30') }, { id: -3, quando: brt('14', '11:30') }, { quando: brt('14', '11:30') }]);
    expect(r.itens.map(i => i.motivo)).toEqual(['id_invalido', 'id_invalido', 'id_invalido']);
    expect(ordem).toEqual([]);
  });

  it('mais de 60 itens e lista vazia são recusados antes de qualquer leitura', async () => {
    const muitos = Array.from({ length: 61 }, (_, i) => ({ id: i + 1, quando: brt('14', '11:30') }));
    expect((await mover(muitos)).erro).toContain('maximo_60');
    expect((await mover([])).erro).toBe('sem_itens');
    expect(ordem).toEqual([]);
  });

  it('o resultado vem no formato da criação, com os totais (4 itens misturados)', async () => {
    for (let i = 1; i <= 3; i++) card(i, '12:00', { vendedor_nome: i === 3 ? 'Diego' : 'Thiago' });
    card(4, '12:00', { created_by: 'outro' });
    const r = await mover([
      { id: 1, quando: brt('14', '11:30') }, { id: 2, quando: brt('14', '12:30') },
      { id: 3, quando: brt('14', '11:30') }, { id: 4, quando: brt('14', '11:00') },
    ]);
    expect(r).toMatchObject({ ok: true, dry: false, parou: false, motivo_da_parada: null });
    expect(r.totais).toMatchObject({ itens: 4, movido: 2, invalido: 1, fora_do_escopo: 1 });
    for (const it of r.itens) expect(Object.keys(it)).toEqual(expect.arrayContaining(['id', 'resultado', 'de', 'para']));
  });
});
