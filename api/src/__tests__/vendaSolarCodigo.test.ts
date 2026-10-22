import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O alocador único do #NNNN da venda solar (fase 2). Banco principal (`system_state`), banco do Gerador (`agendamentos`) e o quadro do
// Trello simulados em memória; nada sai para a rede. Dados inventados. `comTrava` é a de verdade (as travas moram no mesmo
// `system_state` de mentira).

const h = vi.hoisted(() => ({
  linhas: new Map<string, { value: any; updated_at: string }>(),
  cards: [] as Array<Record<string, any>>,
  cartoes: [] as Array<{ id: string; name: string }>,
  trello: 'ok' as 'ok' | 'cai' | 'grande',
  atrasoTrelloMs: 0,
  cardsCaem: false,
  escritas: [] as Array<{ op: string; key: string }>,
  travas: [] as string[],
  aoInserir: null as null | ((key: string) => 'dup' | void),
  tique: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    from: (tabela: string) => {
      if (tabela !== 'agendamentos') throw new Error(`tabela inesperada: ${tabela}`);
      return {
        select: () => ({
          in: async (_c: string, ids: number[]) => (h.cardsCaem
            ? { data: null, error: { code: 'XX000' } }
            : { data: h.cards.filter((c) => ids.includes(c.id)).map((c) => ({ ...c })), error: null }),
          eq: (_c: string, id: number) => ({ maybeSingle: async () => ({ data: h.cards.find((c) => c.id === id) ?? null, error: null }) }),
        }),
      };
    },
  },
}));
vi.mock('../utils/supabase', () => {
  const stamp = () => `2026-10-22T15:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
  const escreve = (op: string, key: string) => { if (!key.startsWith('cadastro_trava:')) h.escritas.push({ op, key }); };
  return {
    supabase: {
      from: (tabela: string) => {
        if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
        return {
          select: () => ({
            eq: (_c: string, k: string) => ({
              maybeSingle: async () => {
                const l = h.linhas.get(k);
                return { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null };
              },
            }),
            like: (_c: string, p: string) => {
              const prefixo = p.replace(/%$/, '');
              const chain: any = {
                order: () => chain,
                range: async (de: number, ate: number) => ({
                  data: [...h.linhas.entries()].filter(([k]) => k.startsWith(prefixo)).sort(([a], [b]) => (a < b ? -1 : 1))
                    .slice(de, ate + 1).map(([k, l]) => ({ key: k, value: l.value })),
                  error: null,
                }),
              };
              return chain;
            },
          }),
          insert: async (l: { key: string; value: unknown; updated_at?: string }) => {
            if (l.key.startsWith('cadastro_trava:')) h.travas.push(l.key);
            const hook = h.aoInserir?.(l.key);
            if (hook === 'dup' || h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
            h.linhas.set(l.key, { value: l.value, updated_at: l.key.startsWith('cadastro_trava:') ? String(l.updated_at) : stamp() });
            escreve('insert', l.key);
            return { error: null };
          },
          upsert: async (l: { key: string; value: unknown }) => { h.linhas.set(l.key, { value: l.value, updated_at: stamp() }); escreve('upsert', l.key); return { error: null }; },
          delete: () => ({
            eq: (_c: string, k: string) => ({
              eq: (_c2: string, v: string) => ({
                select: async () => {
                  const l = h.linhas.get(k);
                  if (!l || l.updated_at !== v) return { data: [], error: null };
                  h.linhas.delete(k); escreve('delete', k);
                  return { data: [{ key: k }], error: null };
                },
              }),
              then: (ok: (x: unknown) => unknown, falha?: (e: unknown) => unknown) => {
                h.linhas.delete(k); escreve('delete', k);
                return Promise.resolve({ error: null }).then(ok, falha);
              },
            }),
          }),
        };
      },
    },
  };
});
vi.mock('../services/gerador/trelloVendaSolar', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/trelloVendaSolar')>()),
  lerTodosOsCartoes: vi.fn(async () => {
    if (h.atrasoTrelloMs) await new Promise((ok) => setTimeout(ok, h.atrasoTrelloMs));
    if (h.trello === 'cai') return { ok: false, motivo: 'boom', causa: 'quadro' };
    if (h.trello === 'grande') return { ok: false, motivo: 'grande', causa: 'quadro_grande' };
    return { ok: true, dados: h.cartoes.map((c) => ({ ...c })) };
  }),
}));

import {
  alocarCodigoSolar, previaDoCodigoSolar, alocarCodigoDaSerie, CARTAO_CONFIAVEL_DESDE_MS, cartaoConfiavel, type DepsAlocador, type PedidoAlocador,
} from '../services/gerador/vendaSolarCodigo';
import { assinarLigacao, reiniciarLogsDoHub, invalidarCachesHub, type Ligacao } from '../services/gerador/vendaSolarHub';
import { assinarRegistro, reiniciarLogsDoRegistro, SERIE_SOLAR, type RegistroCodigo } from '../services/gerador/vendaSolarRegistro';
import type { VendaCsvParaVinculo } from '../services/gerador/vendaSolarHub';

const card = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: `Cliente ${id}`, cliente_telefone: '', cidade: 'Uberlândia mg', vendedor_nome: 'Nilce', created_by: 'lp_solar',
  status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', ...o,
});
const ligar = (id: number, lig: Partial<Ligacao>) => {
  const l: Ligacao = { proposta: null, venda: null, por: 'nilce', em: '2026-10-20T10:00:00.000Z', ...lig };
  h.linhas.set(`venda_solar:${id}`, { updated_at: 'x', value: { ...l, sig: assinarLigacao(id, l) } });
};
const ligacao = (id: number) => h.linhas.get(`venda_solar:${id}`)?.value as (Ligacao & { sig: string }) | undefined;
const registro = (r: RegistroCodigo) => h.linhas.set(`codigo_solar:${r.codigo.slice(1)}`, { updated_at: 'r', value: { ...r, sig: assinarRegistro(r) } });
const reg = (codigo: string, cardId: number, o: Partial<RegistroCodigo> = {}): RegistroCodigo =>
  ({ codigo, card: cardId, por: 'nilce', em: '2026-10-21T10:00:00.000Z', origem: 'novo', ...o });
const idDaData = (ms: number, n: number): string => `${Math.floor(ms / 1000).toString(16).padStart(8, '0')}${n.toString(16).padStart(16, '0')}`;
const DEPOIS = (n: number) => idDaData(CARTAO_CONFIAVEL_DESDE_MS, n);
const ANTES = (n: number) => idDaData(CARTAO_CONFIAVEL_DESDE_MS - 1000, n);
const venda = (codigo: string, o: Partial<VendaCsvParaVinculo> = {}): VendaCsvParaVinculo =>
  ({ codigo, cliente: 'Cliente Inventado', homologacao: '', telefone: '', data: '2026-09-01', consultor: 'Nilce', ...o });

let planilha: { codigos: string[]; vendas: VendaCsvParaVinculo[] } | null;
const deps = (): DepsAlocador => ({
  credenciais: { key: 'k-falsa', token: 't-falso' }, board: 'QUADRO',
  lerPlanilhaAtual: async () => { if (!planilha) throw new Error('planilha fora'); return planilha; },
});
const pedido = (id: number, o: Partial<PedidoAlocador> = {}): PedidoAlocador => ({
  card: h.cards.find((c) => c.id === id) as any, quem: { nome: 'nilce', socio: false }, ...o,
});
const escritasDeVerdade = () => h.escritas.filter((e) => !e.key.startsWith('cadastro_trava:'));

beforeEach(() => {
  h.linhas = new Map(); h.escritas = []; h.travas = []; h.aoInserir = null; h.tique = 0;
  h.cards = [card(301, { cliente_telefone: '(34) 99999-0001' }), card(302), card(303), card(304, { status: 'agendado' })];
  h.cartoes = [{ id: idFixo(1), name: '#0062 - Bruno Lima - Araguari MG' }];
  h.trello = 'ok'; h.atrasoTrelloMs = 0; h.cardsCaem = false;
  planilha = { codigos: ['#0061'], vendas: [venda('#0061')] };
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste-inventado';
  reiniciarLogsDoHub(); reiniciarLogsDoRegistro(); invalidarCachesHub();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.VINCULO_SOLAR_SECRET; });
function idFixo(n: number): string { return `f${String(n).padStart(23, '0')}`; }

describe('o número', () => {
  it('é o maior entre planilha (4 dígitos), Trello (abertos e arquivados), registros vivos e ligações de cards fechados, mais 1', async () => {
    planilha = { codigos: ['#0061', '#20251', '#12'], vendas: [] };
    h.cartoes.push({ id: idFixo(2), name: '#0064 - Arquivado - Catalão GO' }, { id: idFixo(3), name: 'Cliente #0099 sem número no começo' },
      { id: idFixo(4), name: '#00610 - Fora do padrão' });
    registro(reg('#0066', 302));                         // vivo
    registro(reg('#0090', 304));                         // morto (card saiu de fechou): não entra no máximo
    ligar(303, { venda: '#0067', proposta: 'P3' });      // ligação de card fechou sem registro: entra
    ligar(304, { venda: '#0091' });                      // ligação de card que não está fechou: não entra
    ligar(301, { proposta: 'P9', trello_card: idFixo(77) });   // cartão fora do quadro: o A7 não age
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toEqual({ ok: true, acao: 'criou', codigo: '#0068' });
    expect(Object.keys(h.linhas.get('codigo_solar:0068')!.value).sort()).toEqual(['card', 'codigo', 'em', 'origem', 'por', 'sig']);
    expect(h.linhas.get('codigo_solar:0068')!.value).toMatchObject({ codigo: '#0068', card: 301, por: 'nilce', origem: 'novo' });
    // a ligação leva o código, por = gerador, mantém a proposta e o cartão, e o mesmo instante do registro
    expect(ligacao(301)).toMatchObject({ venda: '#0068', por: 'gerador', proposta: 'P9', trello_card: idFixo(77) });
    expect(ligacao(301)!.em).toBe(h.linhas.get('codigo_solar:0068')!.value.em);
    expect(ligacao(301)!.sig).toBe(assinarLigacao(301, ligacao(301)!));
  });

  it('repetir dá ja_ligada sem nenhuma escrita; venda ligada por gente também', async () => {
    expect((await alocarCodigoSolar(pedido(301), deps())).ok).toBe(true);
    h.escritas = [];
    expect(await alocarCodigoSolar(pedido(301), deps())).toEqual({ ok: true, acao: 'ja_ligada', codigo: '#0063' });
    ligar(302, { venda: '#0061', por: 'giovanna' });
    expect(await alocarCodigoSolar(pedido(302), deps())).toEqual({ ok: true, acao: 'ja_ligada', codigo: '#0061' });
    expect(escritasDeVerdade()).toEqual([]);
  });

  it('dois cards juntos (seção crítica lenta, trava de verdade): números diferentes e os dois ok; o mesmo card duas vezes: criou e ja_ligada', async () => {
    h.atrasoTrelloMs = 300;
    const [a, b] = await Promise.all([alocarCodigoSolar(pedido(301), deps()), alocarCodigoSolar(pedido(302), deps())]);
    expect(a.ok && b.ok).toBe(true);
    const cods = [a, b].map((x) => (x as { codigo: string }).codigo).sort();
    expect(cods).toEqual(['#0063', '#0064']);
    const [c, d] = await Promise.all([alocarCodigoSolar(pedido(303), deps()), alocarCodigoSolar(pedido(303), deps())]);
    expect([c, d].map((x) => (x as { acao: string }).acao).sort()).toEqual(['criou', 'ja_ligada']);
  }, 20_000);

  it('trava do número ocupada além da espera (~10 s): ocupado, nada escrito', async () => {
    h.linhas.set('cadastro_trava:trello_numero_solar', { value: { por: 'outro', ate: new Date(Date.now() + 60_000).toISOString() }, updated_at: 'outro' });
    expect(await alocarCodigoSolar(pedido(301), deps())).toEqual({ ok: false, motivo: 'ocupado' });
    expect(escritasDeVerdade()).toEqual([]);
  }, 20_000);

  it('trava forjada (ate no ano 2100) não trava ninguém', async () => {
    h.linhas.set('cadastro_trava:trello_numero_solar', { value: { por: 'x', ate: '2100-01-01T00:00:00.000Z' }, updated_at: 'forjada' });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ ok: true, codigo: '#0063' });
  });

  it('ordem das travas: número antes dos vínculos, nunca o contrário', async () => {
    await alocarCodigoSolar(pedido(301), deps());
    expect(h.travas).toEqual(['cadastro_trava:trello_numero_solar', 'cadastro_trava:vendasolar_vinculos']);
  });

  it('INSERT em 23505 recalcula e nunca sobrescreve; linha não assinada é pulada sem entrar no máximo; 5 corridas = ocupado', async () => {
    h.linhas.set('codigo_solar:0063', { updated_at: 'x', value: { codigo: '#0063', card: 999, por: 'x', em: 'x', origem: 'novo', sig: 'forjada' } });
    h.linhas.set('codigo_solar:9999', { updated_at: 'x', value: { codigo: '#9999', card: 999 } });
    let uma = true;
    h.aoInserir = (k) => { if (k === 'codigo_solar:0064' && uma) { uma = false; return 'dup'; } };
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toMatchObject({ ok: true, codigo: '#0065' });
    expect(h.linhas.get('codigo_solar:0063')!.value.sig).toBe('forjada');   // nunca sobrescreve
    h.aoInserir = (k) => (k.startsWith('codigo_solar:') ? 'dup' : undefined);
    expect(await alocarCodigoSolar(pedido(302), deps())).toEqual({ ok: false, motivo: 'ocupado' });
  });

  it('assinatura adulterada não vale como registro: o número dela é pulado', async () => {
    const r = reg('#0063', 302);
    h.linhas.set('codigo_solar:0063', { updated_at: 'x', value: { ...r, sig: assinarRegistro({ ...r, card: 303 }) } });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ codigo: '#0064' });
  });

  it('prazo estourado antes do INSERT: lento e nada escrito', async () => {
    expect(await alocarCodigoSolar(pedido(301, { inicio: Date.now() - 151_000 }), deps())).toEqual({ ok: false, motivo: 'lento' });
    expect(escritasDeVerdade()).toEqual([]);
  });
});

describe('venda desfeita (vivo x morto)', () => {
  it('morto que é o próximo, sem cartão e sem overlay: reaproveita (desliga o card velho mantendo proposta e cartão)', async () => {
    registro(reg('#0063', 304));
    ligar(304, { venda: '#0063', proposta: 'P4', trello_card: idFixo(9) });
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toMatchObject({ ok: true, codigo: '#0063' });
    expect(h.linhas.get('codigo_solar:0063')!.value.card).toBe(301);
    expect(ligacao(304)).toMatchObject({ venda: null, por: 'gerador', proposta: 'P4', trello_card: idFixo(9) });
  });
  it('morto com overlay gestao_cliente: pula, nada é apagado', async () => {
    registro(reg('#0063', 304));
    h.linhas.set('gestao_cliente:0063', { updated_at: 'g', value: { campos: { engenheiro: { valor: 'Fulano', por: 'x', em: 'x' } }, alteracoes: [] } });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ codigo: '#0064' });
    expect(h.linhas.get('codigo_solar:0063')!.value.card).toBe(304);
    expect(h.linhas.has('gestao_cliente:0063')).toBe(true);
  });
  it('morto com cartão no Trello, ou que não é o próximo: fica a lacuna', async () => {
    registro(reg('#0063', 304));
    h.cartoes.push({ id: idFixo(5), name: '#0063 - Card Desfeito - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ codigo: '#0064' });
    expect(h.linhas.get('codigo_solar:0063')!.value.card).toBe(304);
  });
  it('card velho voltou a fechou na releitura: não reaproveita', async () => {
    registro(reg('#0063', 304));
    let n = 0;
    const orig = h.cards[3];
    h.aoInserir = (k) => { if (k === 'cadastro_trava:vendasolar_vinculos' && n++ === 0) orig.status = 'fechou'; };
    // a decisão inicial viu o card como morto; dentro da trava dos vínculos ele voltou
    h.cards[3] = orig;
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect((r as { codigo: string }).codigo).not.toBe('#0063');
    expect(h.linhas.get('codigo_solar:0063')!.value.card).toBe(304);
  });
  it('erro ao ler os cards: banco, nunca "morto"', async () => {
    registro(reg('#0063', 304));
    h.cardsCaem = true;
    expect(await alocarCodigoSolar(pedido(301), deps())).toEqual({ ok: false, motivo: 'banco' });
    expect(escritasDeVerdade()).toEqual([]);
  });
});

describe('ligação final e reparo', () => {
  it('outra ligação já usa o número: apaga o registro recém-criado e tenta o próximo', async () => {
    h.aoInserir = (k) => { if (k === 'codigo_solar:0063') ligar(302, { venda: '#0063', por: 'giovanna' }); };
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ ok: true, codigo: '#0064' });
    expect(h.linhas.get('codigo_solar:0063')).toBeUndefined();
  });
  it('venda que aparece no meio: ja_ligada e o registro criado é apagado', async () => {
    h.aoInserir = (k) => { if (k === 'codigo_solar:0063') ligar(301, { venda: '#0061', por: 'giovanna' }); };
    expect(await alocarCodigoSolar(pedido(301), deps())).toEqual({ ok: true, acao: 'ja_ligada', codigo: '#0061' });
    expect(h.linhas.get('codigo_solar:0063')).toBeUndefined();
  });
  it('reparo: registro deste card e ligação ausente, só do Trello ou mais velha: religa o mesmo número', async () => {
    registro(reg('#0070', 301, { em: '2026-10-22T12:00:00.000Z' }));
    expect(await alocarCodigoSolar(pedido(301), deps())).toEqual({ ok: true, acao: 'criou', codigo: '#0070' });
    registro(reg('#0071', 302, { em: '2026-10-22T12:00:00.000Z' }));
    ligar(302, { proposta: 'P2', em: '2026-10-22T11:00:00.000Z' });
    expect(await alocarCodigoSolar(pedido(302), deps())).toEqual({ ok: true, acao: 'criou', codigo: '#0071' });
    expect(ligacao(302)).toMatchObject({ venda: '#0071', proposta: 'P2' });
  });
  it('ligação de gente MAIS NOVA que o registro (desligou de propósito) não é reparada', async () => {
    registro(reg('#0070', 301, { em: '2026-10-22T12:00:00.000Z' }));
    ligar(301, { venda: null, por: 'nilce', em: '2026-10-22T13:00:00.000Z' });
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toMatchObject({ ok: true, acao: 'criou', codigo: '#0071' });
  });
  it('proposta: preserva a que a ligação já tem (inclusive a que entra no meio); sem proposta continua sem', async () => {
    h.aoInserir = (k) => { if (k === 'codigo_solar:0063') ligar(301, { proposta: 'P-meio', por: 'nilce' }); };
    await alocarCodigoSolar(pedido(301), deps());
    expect(ligacao(301)).toMatchObject({ venda: '#0063', proposta: 'P-meio' });
    h.aoInserir = null;
    await alocarCodigoSolar(pedido(302), deps());
    expect(ligacao(302)).toMatchObject({ venda: '#0064', proposta: null });
  });
});

describe('telefone nunca liga (portão e aviso)', () => {
  const familia = () => {
    planilha = {
      codigos: ['#0061', '#0062', '#0064'],
      vendas: [venda('#0064', { telefone: '34999990001', cliente: 'Parente Homologado' }), venda('#0061'), venda('#0062', { telefone: '99990001', consultor: 'Giovanna' })],
    };
  };
  it('sem novo: confirmar (sem telefone, com motivo e ocultas) e nada escrito', async () => {
    familia();
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toEqual({ ok: false, motivo: 'confirmar', candidatos: [{ codigo: '#0064', cliente: 'Parente Homologado', data: '2026-09-01', motivo: 'telefone' }], ocultas: 1 });
    expect(JSON.stringify(r)).not.toMatch(/9999/);
    expect(escritasDeVerdade()).toEqual([]);
  });
  it('com novo: número novo, aviso com os códigos visíveis e a contagem dos outros; nada aponta para a linha do Excel', async () => {
    familia();
    const r = await alocarCodigoSolar(pedido(301, { novo: true }), deps());
    expect(r).toMatchObject({ ok: true, acao: 'criou', codigo: '#0065', mesmoTelefone: { codigos: ['#0064'], ocultas: 1 } });
    expect((r as { aviso: string }).aviso).toBe('Mesmo telefone da linha #0064 do Excel. Se for a mesma venda, use no Excel o número #0065. Há também venda com este telefone na planilha de outra pessoa. Se for o mesmo cliente, avise um sócio.');
    const tudo = JSON.stringify([...h.linhas.values()]);
    expect(tudo).not.toMatch(/"auto"/);
    expect([...h.linhas.values()].some((l) => l.value?.venda === '#0064')).toBe(false);
  });
  it('linha que OUTRO card usa não dispara o portão, mas entra no aviso; sócio vê tudo', async () => {
    planilha = { codigos: ['#0064'], vendas: [venda('#0064', { telefone: '34999990001' })] };
    ligar(302, { venda: '#0064', por: 'giovanna' });
    const r = await alocarCodigoSolar(pedido(301, { quem: { nome: 'thiago', socio: true } }), deps());
    expect(r).toMatchObject({ ok: true, acao: 'criou', mesmoTelefone: { codigos: ['#0064'], ocultas: 0 } });
  });
  it('linha invisível e livre dispara o portão só como contagem; novo passa', async () => {
    planilha = { codigos: ['#0064'], vendas: [venda('#0064', { telefone: '34999990001', consultor: 'Giovanna' })] };
    expect(await alocarCodigoSolar(pedido(301), deps())).toEqual({ ok: false, motivo: 'confirmar', candidatos: [], ocultas: 1 });
    expect(await alocarCodigoSolar(pedido(301, { novo: true }), deps())).toMatchObject({ ok: true, acao: 'criou' });
  });
  it('nome parecido nunca gera candidata nem portão', async () => {
    planilha = { codigos: ['#0064'], vendas: [venda('#0064', { cliente: 'Cliente 301' })] };
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ ok: true, acao: 'criou' });
  });
});

describe('número do cartão do Trello (adoção e pergunta)', () => {
  it('cartaoConfiavel: um segundo antes do corte não, exatamente no corte sim; escolhido sempre', () => {
    expect(cartaoConfiavel(ANTES(1))).toBe(false);
    expect(cartaoConfiavel(DEPOIS(1))).toBe(true);
    expect(cartaoConfiavel(ANTES(1), true)).toBe(true);
    expect(cartaoConfiavel('curto')).toBe(false);
  });
  it('cartão da ligação confiável, #0065, uma ocorrência, sem linha: adota antes do portão (mesmo com telefone de linha livre)', async () => {
    planilha = { codigos: ['#0064'], vendas: [venda('#0064', { telefone: '34999990001' })] };
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - (Cristiano) Hermantino - Uberlândia MG' });
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toMatchObject({ ok: true, acao: 'adotou_trello', codigo: '#0065', mesmoTelefone: { codigos: ['#0064'] } });
    expect(h.linhas.get('codigo_solar:0065')!.value.origem).toBe('trello');
    expect(ligacao(301)).toMatchObject({ venda: '#0065', por: 'gerador' });
  });
  it('cartão anterior ao corte não adota (aviso ii); escolhido adota', async () => {
    ligar(301, { trello_card: ANTES(1), por: 'trello' });
    h.cartoes.push({ id: ANTES(1), name: '#0065 - Alguém - Uberaba MG' });
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toMatchObject({ ok: true, acao: 'criou', codigo: '#0066' });
    expect((r as { aviso: string }).aviso).toMatch(/guardado antes do número automático/);
    expect((r as { aviso: string }).aviso).not.toMatch(/outra venda/);
    ligar(302, { trello_card: ANTES(2), por: 'trello' });
    h.cartoes.push({ id: ANTES(2), name: '#0070 - Alguém - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(302, { cartaoTrello: ANTES(2), cartaoEscolhido: true }), deps())).toMatchObject({ acao: 'adotou_trello', codigo: '#0070' });
  });
  it('S5: cartão só no registro do envio (sem assinatura) nunca adota', async () => {
    h.linhas.set('trello_venda_solar:301', { updated_at: 'r', value: { card_id: DEPOIS(1), comentario_id: null, anexados: {} } });
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - Alguém - Uberaba MG' });
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toMatchObject({ ok: true, acao: 'criou', codigo: '#0066' });
  });
  it('cartaoTrello: string usa o dele, null não usa nenhum, undefined usa o guardado', async () => {
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - A - Uberaba MG' }, { id: DEPOIS(2), name: '#0070 - B - Uberaba MG' });
    expect(await previaDoCodigoSolar(pedido(301), deps())).toMatchObject({ acao: 'adotaria_trello', codigo: '#0065' });
    expect(await previaDoCodigoSolar(pedido(301, { cartaoTrello: DEPOIS(2) }), deps())).toMatchObject({ acao: 'adotaria_trello', codigo: '#0070' });
    expect(await previaDoCodigoSolar(pedido(301, { cartaoTrello: null }), deps())).toMatchObject({ acao: 'criaria', codigo: '#0071' });
  });
  it('número de outra venda (ligação de outro card, registro, título repetido): não adota, não liga, aviso (i)', async () => {
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - A - Uberaba MG' }, { id: DEPOIS(2), name: '#0065 - Repetido - Uberaba MG' });
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toMatchObject({ acao: 'criou', codigo: '#0066' });
    expect((r as { aviso: string }).aviso).toMatch(/usa o número #0065, que já é de outra venda/);
  });
  it('título sem #NNNN: número novo com aviso; id fora do quadro: sem aviso', async () => {
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: 'Sem Numero - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ codigo: '#0063', aviso: 'O cartão do Trello não tem o número no título. Ajuste para começar com #0063.' });
    ligar(302, { trello_card: DEPOIS(9), por: 'trello' });
    const r = await alocarCodigoSolar(pedido(302), deps());
    expect((r as { aviso?: string }).aviso).toBeUndefined();
  });
  it('INSERT da adoção em 23505: não adotou, aloca o próximo com aviso (i)', async () => {
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - A - Uberaba MG' });
    h.aoInserir = (k) => (k === 'codigo_solar:0065' ? 'dup' : undefined);
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toMatchObject({ acao: 'criou', codigo: '#0066' });
    expect((r as { aviso: string }).aviso).toMatch(/outra venda/);
  });
  it('pergunta do cartão: #0040 é linha LIVRE do Excel: sem novo confirmar (motivo cartao), com novo número novo e a linha sem ligação', async () => {
    planilha = { codigos: ['#0040'], vendas: [venda('#0040', { telefone: '34911112222' })] };
    ligar(301, { trello_card: ANTES(1), por: 'trello' });
    h.cartoes.push({ id: ANTES(1), name: '#0040 - Cliente Inventado - Uberaba MG' });
    const r = await alocarCodigoSolar(pedido(301), deps());
    expect(r).toEqual({ ok: false, motivo: 'confirmar', candidatos: [{ codigo: '#0040', cliente: 'Cliente Inventado', data: '2026-09-01', motivo: 'cartao' }], ocultas: 0 });
    expect(escritasDeVerdade()).toEqual([]);
    const n = await alocarCodigoSolar(pedido(301, { novo: true }), deps());
    expect(n).toMatchObject({ acao: 'criou', codigo: '#0063' });
    expect((n as { aviso: string }).aviso).toMatch(/#0040, que já é de outra venda/);
    expect(ligacao(301)!.venda).toBe('#0063');
  });
  it('a mesma linha casando também por telefone entra uma vez: cartao se confiável, telefone se não', async () => {
    planilha = { codigos: ['#0040'], vendas: [venda('#0040', { telefone: '34999990001' })] };
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: '#0040 - X - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ candidatos: [{ codigo: '#0040', motivo: 'cartao' }] });
    ligar(301, { trello_card: ANTES(1), por: 'trello' });
    h.cartoes.push({ id: ANTES(1), name: '#0040 - X - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ candidatos: [{ codigo: '#0040', motivo: 'telefone' }] });
  });
});

describe('planilha fora: cópia em cache, ou Excel desconhecido', () => {
  const comCopia = (copia: typeof planilha): DepsAlocador => ({ ...deps(), lerPlanilhaAtual: async () => { throw new Error('fresca fora'); }, lerPlanilhaCopia: async () => { if (!copia) throw new Error('sem cópia'); return copia; } });
  it('leitura fresca falhou: a cópia vale para os ocupados e o portão, com planilhaFora e o aviso', async () => {
    const copia = { codigos: ['#0070'], vendas: [venda('#0070', { telefone: '34999990001' })] };
    expect(await alocarCodigoSolar(pedido(301), comCopia(copia))).toMatchObject({ ok: false, motivo: 'confirmar', candidatos: [{ codigo: '#0070' }] });
    const r = await alocarCodigoSolar(pedido(301, { novo: true }), comCopia(copia));
    expect(r).toMatchObject({ ok: true, acao: 'criou', codigo: '#0071', planilhaFora: true, mesmoTelefone: { codigos: ['#0070'] } });
    expect((r as { aviso: string }).aviso).toMatch(/^Número conferido sem a planilha do Excel\. Mesmo telefone da linha #0070/);
  });
  it('sem cópia: NUNCA reaproveita número morto (o Excel pode tê-lo)', async () => {
    registro(reg('#0063', 304));
    ligar(304, { venda: '#0063' });
    const r = await alocarCodigoSolar(pedido(301, { novo: true }), comCopia(null));
    expect(r).toMatchObject({ ok: true, codigo: '#0064', planilhaFora: true });
    expect(h.linhas.get('codigo_solar:0063')!.value.card).toBe(304);
    expect(ligacao(304)!.venda).toBe('#0063');
  });
  it('sem cópia e sem novo: confirmar com 0 candidatos (semPlanilha) e nada escrito', async () => {
    expect(await alocarCodigoSolar(pedido(301), comCopia(null))).toEqual({ ok: false, motivo: 'confirmar', candidatos: [], ocultas: 0, semPlanilha: true });
    expect(escritasDeVerdade()).toEqual([]);
  });
  it('sem cópia: só adota cartão CRIADO PELO /gerador; cartão antigo escolhido não', async () => {
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - A - Uberaba MG' }, { id: ANTES(2), name: '#0070 - B - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(301), comCopia(null))).toMatchObject({ acao: 'adotou_trello', codigo: '#0065', planilhaFora: true });
    expect(await alocarCodigoSolar(pedido(302, { cartaoTrello: ANTES(2), cartaoEscolhido: true }), comCopia(null)))
      .toEqual({ ok: false, motivo: 'confirmar', candidatos: [], ocultas: 0, semPlanilha: true });
  });
});

describe('consertos da revisão (N2, N4, N5, R4, P2)', () => {
  it('N2: morto cujo card velho ainda tem cartão no Trello (sem número no título) não é reaproveitado', async () => {
    registro(reg('#0063', 304));
    ligar(304, { venda: '#0063', trello_card: idFixo(50) });
    h.cartoes.push({ id: idFixo(50), name: 'Sem Numero - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ codigo: '#0064' });
    expect(h.linhas.get('codigo_solar:0063')!.value.card).toBe(304);
    // pelo registro do envio também
    registro(reg('#0065', 303, { em: '2026-10-21T11:00:00.000Z' }));
    h.cards[2].status = 'agendado';
    h.linhas.set('trello_venda_solar:303', { updated_at: 'r', value: { card_id: idFixo(51), comentario_id: null, anexados: {} } });
    h.cartoes.push({ id: idFixo(51), name: 'Outro Sem Numero' });
    expect(await alocarCodigoSolar(pedido(302), deps())).toMatchObject({ codigo: '#0066' });
  });
  it('N4: venda que aparece no meio com o MESMO número não apaga o registro', async () => {
    h.aoInserir = (k) => { if (k === 'codigo_solar:0063') ligar(301, { venda: '#0063', por: 'gerador' }); };
    expect(await alocarCodigoSolar(pedido(301), deps())).toEqual({ ok: true, acao: 'ja_ligada', codigo: '#0063' });
    expect(h.linhas.get('codigo_solar:0063')).toBeDefined();
  });
  it('N5: adoção que falha revê o portão (sem novo, linha livre de mesmo telefone: confirmar)', async () => {
    planilha = { codigos: ['#0061'], vendas: [venda('#0061', { telefone: '34999990001' })] };
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - A - Uberaba MG' });
    h.aoInserir = (k) => (k === 'codigo_solar:0065' ? 'dup' : undefined);
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ ok: false, motivo: 'confirmar', candidatos: [{ codigo: '#0061' }] });
  });
  it('R4: registro DESTE card com o número do título não impede a adoção (reaproveita, sem INSERT)', async () => {
    registro(reg('#0065', 301, { em: '2026-10-22T10:00:00.000Z' }));
    ligar(301, { venda: null, trello_card: DEPOIS(1), por: 'nilce', em: '2026-10-22T12:00:00.000Z' });   // desligou depois do registro
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - A - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ ok: true, acao: 'adotou_trello', codigo: '#0065' });
  });
  it('P2: login com mais de 60 letras grava um registro que valida', async () => {
    const r = await alocarCodigoSolar(pedido(301, { quem: { nome: 'x'.repeat(80), socio: true } }), deps());
    expect(r).toMatchObject({ ok: true, codigo: '#0063' });
    expect(await alocarCodigoSolar(pedido(302), deps())).toMatchObject({ codigo: '#0064' });   // o #0063 vale como registro vivo
    expect(h.linhas.get('codigo_solar:0063')!.value.por).toHaveLength(60);
  });
});

describe('segunda revisão (itens 2, 5, 6 e 8)', () => {
  const comCopia = (copia: typeof planilha): DepsAlocador => ({ ...deps(), lerPlanilhaAtual: async () => { throw new Error('fresca fora'); }, lerPlanilhaCopia: async () => { if (!copia) throw new Error('sem cópia'); return copia; } });
  it('2: com a cópia (planilha não fresca) o número morto não é reaproveitado, nem na prévia', async () => {
    registro(reg('#0063', 304));
    const copia = { codigos: ['#0061'], vendas: [] };
    expect(await previaDoCodigoSolar(pedido(301, { novo: true }), comCopia(copia))).toMatchObject({ acao: 'criaria', codigo: '#0064' });
    expect(await alocarCodigoSolar(pedido(301, { novo: true }), comCopia(copia))).toMatchObject({ ok: true, codigo: '#0064' });
    expect(h.linhas.get('codigo_solar:0063')!.value.card).toBe(304);
  });
  it('5: 81 chaves forjadas no caminho não travam a numeração', async () => {
    for (let n = 63; n < 63 + 81; n++) h.linhas.set(`codigo_solar:${String(n).padStart(4, '0')}`, { updated_at: 'x', value: { forjada: true } });
    expect(await alocarCodigoSolar(pedido(301), deps())).toMatchObject({ ok: true, codigo: '#0144' });
  });
  it('6: série cujo formato casa com o da solar é recusada; a assinatura de uma série não vale em outra', async () => {
    const PARECIDA = { prefixoChave: 'codigo_outra:', trava: 'numero_outra', reCodigo: /^#(\d{4})$/, formatar: (n: number) => `#${String(n).padStart(4, '0')}`, maximo: 9999 };
    await expect(alocarCodigoDaSerie(PARECIDA, { card: 301, por: 'nilce' })).rejects.toBeTruthy();
    const SERIE_X = { prefixoChave: 'codigo_teste:', trava: 'numero_teste', reCodigo: /^#X(\d{3})$/, formatar: (n: number) => `#X${String(n).padStart(3, '0')}`, maximo: 999 };
    const r = reg('#X001', 301);
    expect(assinarRegistro(r, SERIE_X)).not.toBe(assinarRegistro(r));
  });
  it('8: adotaria_trello sai com provisorio false (também com a planilha fora)', async () => {
    ligar(301, { trello_card: DEPOIS(1), por: 'trello' });
    h.cartoes.push({ id: DEPOIS(1), name: '#0065 - A - Uberaba MG' });
    expect(await previaDoCodigoSolar(pedido(301), comCopia({ codigos: [], vendas: [] }))).toMatchObject({ acao: 'adotaria_trello', codigo: '#0065', provisorio: false, planilhaFora: true });
  });
});

describe('outra série (só registro, trava e máximo)', () => {
  it('alocarCodigoDaSerie: própria chave, formato e trava; não lê planilha nem Trello, não toca venda_solar; recusa a série solar', async () => {
    const SERIE_X = { prefixoChave: 'codigo_teste:', trava: 'numero_teste', reCodigo: /^#X(\d{3})$/, formatar: (n: number) => `#X${String(n).padStart(3, '0')}`, maximo: 999 };
    h.trello = 'cai'; planilha = null;
    expect(await alocarCodigoDaSerie(SERIE_X, { card: 301, por: 'nilce' })).toEqual({ ok: true, acao: 'criou', codigo: '#X001' });
    expect(await alocarCodigoDaSerie(SERIE_X, { card: 302, por: 'nilce' })).toEqual({ ok: true, acao: 'criou', codigo: '#X002' });
    expect(await alocarCodigoDaSerie(SERIE_X, { card: 301, por: 'nilce' })).toEqual({ ok: true, acao: 'ja_tinha', codigo: '#X001' });
    expect(h.travas.every((t) => t === 'cadastro_trava:numero_teste')).toBe(true);
    expect([...h.linhas.keys()].some((k) => k.startsWith('venda_solar:') || k.startsWith('codigo_solar:'))).toBe(false);
    await expect(alocarCodigoDaSerie(SERIE_SOLAR, { card: 301, por: 'nilce' })).rejects.toBeTruthy();
  });
});

describe('falhas, privacidade e prévia', () => {
  it('planilha fora, Trello fora, quadro grande, sem segredo, sem credencial, acima de #9999', async () => {
    // sem cópia da planilha: o gancho (novo) numera direto, com planilhaFora e aviso curto
    planilha = null;
    expect(await alocarCodigoSolar(pedido(301, { novo: true }), deps())).toEqual({
      ok: true, acao: 'criou', codigo: '#0063', planilhaFora: true, aviso: 'Número conferido sem a planilha do Excel.',
    });
    planilha = { codigos: [], vendas: [] };
    h.trello = 'cai';
    expect(await alocarCodigoSolar(pedido(302), deps())).toEqual({ ok: false, motivo: 'trello' });
    h.trello = 'grande';
    expect(await alocarCodigoSolar(pedido(302), deps())).toEqual({ ok: false, motivo: 'trello_grande' });
    h.trello = 'ok';
    h.escritas = [];
    expect(await alocarCodigoSolar(pedido(302), { ...deps(), credenciais: null })).toEqual({ ok: false, motivo: 'sem_credencial' });
    h.cartoes.push({ id: idFixo(8), name: '#9999 - Último - Uberaba MG' });
    expect(await alocarCodigoSolar(pedido(302), deps())).toEqual({ ok: false, motivo: 'sequencia' });
    delete process.env.VINCULO_SOLAR_SECRET; delete process.env.SUPABASE_SERVICE_KEY;
    expect(await alocarCodigoSolar(pedido(302), deps())).toEqual({ ok: false, motivo: 'sem_segredo' });
    expect(escritasDeVerdade()).toEqual([]);
  });
  it('nada pessoal em system_state nem em log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.cards[0].cliente_nome = 'ZZNOME Sigiloso';
    planilha = { codigos: ['#0064'], vendas: [venda('#0064', { telefone: '34999990001', cliente: 'ZZOUTRO Cliente' })] };
    await alocarCodigoSolar(pedido(301, { novo: true }), deps());
    h.trello = 'cai';
    await alocarCodigoSolar(pedido(302), deps());
    const tudo = JSON.stringify([...h.linhas.entries()]) + JSON.stringify(log.mock.calls);
    expect(tudo).not.toMatch(/ZZNOME|ZZOUTRO|99990001|Bruno Lima/);
  });
  it('prévia: mesma decisão, nada escrito, sem trava; planilha fora vira provisório com planilhaFora', async () => {
    expect(await previaDoCodigoSolar(pedido(301), deps())).toEqual({ ok: true, acao: 'criaria', codigo: '#0063', provisorio: true });
    planilha = { codigos: ['#0064'], vendas: [venda('#0064', { telefone: '34999990001' })] };
    expect(await previaDoCodigoSolar(pedido(301), deps())).toMatchObject({ ok: true, acao: 'confirmar', candidatos: [{ codigo: '#0064' }] });
    expect(await previaDoCodigoSolar(pedido(301, { novo: true }), deps())).toMatchObject({ acao: 'criaria', codigo: '#0065', mesmoTelefone: { codigos: ['#0064'] } });
    planilha = null;
    expect(await previaDoCodigoSolar(pedido(301), deps())).toEqual({ ok: true, acao: 'confirmar', candidatos: [], ocultas: 0, semPlanilha: true });
    expect(await previaDoCodigoSolar(pedido(301, { novo: true }), deps())).toEqual({
      ok: true, acao: 'criaria', codigo: '#0063', provisorio: true, planilhaFora: true, aviso: 'Número conferido sem a planilha do Excel.',
    });
    expect(h.escritas).toEqual([]);
    expect(h.travas).toEqual([]);
  });
});
