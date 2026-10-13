import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// AGENDA EM LOTE: 231 cards reais hoje. O erro que não pode acontecer é um card
// nascer e o robô mandar confirmação para quem nunca marcou reunião. Aqui: a
// ordem das escritas, o que cada trava barra e quando o lote PARA.

/** O que aconteceu, na ordem. É a prova da sequência do plano. */
let ordem: string[] = [];
let existentes: Array<{ id?: number; cliente_telefone: string | null; created_by?: string | null }> = [];
let bloqueadosSet = new Set<string>();
let silenciadosSet = new Set<string>();
let leituraPreviaFalha = false;
let ocupados = new Set<string>();
let marcaFalha = false;
let repassarFicaPreenchido = false;
let semCarimbos = false;
const fichasGravadas: Array<Record<string, any>> = [];
let proximoId = 100;
let quandoPorId = new Map<number, string>();

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
/** As chaves de system_state que já existem (etiqueta_card:, tipo_card:). */
let marcasExistentes = new Set<string>();
/** O card do lote que já existe, como o conserto o lê. */
let cardExistente: Record<string, any> | null = null;
let ultimaMarca: { id: number; quando: string } | null = null;
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error('rede proibida no teste');
      return {
        select: () => ({
          in: async (_c: string, chaves: string[]) => ({
            data: chaves.filter(k => marcasExistentes.has(k)).map(key => ({ key })), error: null,
          }),
        }),
      };
    },
  },
}));
vi.mock('../services/io/eletropostoReagendaAuto', () => ({ EP_MUDO_PREFIX: 'ep_mudo:' }));

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      if (tabela !== 'agendamentos') throw new Error(`tabela inesperada ${tabela}`);
      const q: any = {
        _cols: '', _id: null as number | null, _update: null as any,
        select(cols: string) { q._cols = cols; return q; },
        not() { return q; },
        order() { return q; },
        range() { return Promise.resolve({ data: existentes, error: null }); },
        update(p: any) { q._update = p; return q; },
        eq(_c: string, v: number) {
          if (q._update) { ordem.push('update_repassar_em_nulo'); return Promise.resolve({ error: null }); }
          q._id = v; return q;
        },
        maybeSingle() {
          if (q._cols === 'quando') {
            ordem.push('ler_quando');
            return Promise.resolve({ data: { quando: quandoPorId.get(q._id!) ?? null }, error: null });
          }
          if (q._cols.startsWith('id, quando, status')) {
            ordem.push('ler_card_existente');
            return Promise.resolve({ data: cardExistente, error: null });
          }
          ordem.push('ler_de_volta');
          const agora = new Date().toISOString();
          return Promise.resolve({
            data: {
              id: q._id,
              repassar_em: repassarFicaPreenchido ? agora : null,
              confirmacao_at: semCarimbos ? null : agora,
              lembrete_1h_at: semCarimbos ? null : agora,
              lembrete_5min_at: semCarimbos ? null : agora,
            },
            error: null,
          });
        },
      };
      return q;
    },
  },
}));

vi.mock('../services/io/eletropostoCard', () => ({
  DONOS_EP: ['Thiago', 'Diego'],
  gravarCardEletroposto: vi.fn(async (ficha: Record<string, any>) => {
    ordem.push('insert');
    if (ocupados.has(`${ficha.vendedor_nome}|${ficha.quando}`)) throw Object.assign(new Error('dup'), { code: '23505' });
    const id = proximoId++;
    fichasGravadas.push({ id, ...ficha });
    quandoPorId.set(id, ficha.quando);
    return { id, bloqueado: false };
  }),
}));
vi.mock('../services/io/epMudo', () => ({
  gravarMarcaMuda: vi.fn(async (id: number, quando: string) => {
    ordem.push('marca_ep_mudo');
    ultimaMarca = { id, quando };
    if (marcaFalha) throw new Error('banco fora');
    return quando;
  }),
}));
vi.mock('../services/agenda/etiquetaCard', () => ({
  guardarEtiquetaDoCard: vi.fn(async () => { ordem.push('etiqueta'); }),
  guardarTipoDoCard: vi.fn(async () => { ordem.push('tipo'); return true; }),
}));
vi.mock('../services/agents/whatsapp/silenciar', () => {
  const chaveContato = (phone: string | null | undefined) => {
    const d = String(phone ?? '').replace(/\D/g, '');
    if (d.length < 10 || d.length > 13) return null;
    const semDdi = d.startsWith('55') && d.length >= 12 ? d.slice(2) : d;
    return semDdi.slice(0, 2) + semDdi.slice(-8);
  };
  return {
    chaveContato,
    carregarBloqueados: async () => {
      if (leituraPreviaFalha) throw new Error('leitura dos bloqueados falhou');
      return (p: string) => bloqueadosSet.has(chaveContato(p) ?? '');
    },
    carregarSilenciados: async () => (p: string) => silenciadosSet.has(chaveContato(p) ?? ''),
  };
});

// terça 13/10/2026, 12h de Brasília
const AGORA = new Date('2026-10-13T15:00:00.000Z');
async function lote(itens: any[], opts: { dry?: boolean; tipo?: any } = { dry: false, tipo: 'cotista' }) {
  const { agendarEmLote } = await import('../services/io/agendaEmLote');
  return agendarEmLote(itens, opts);
}
function item(over: Partial<any> = {}) {
  return {
    chave: 'a1', nome: 'Marcos Silva', telefone: '5534991110001', cidade: 'Uberlândia',
    valor: 'R$ 200 mil', consultor: 'Thiago', quando: '2026-10-14T08:00:00-03:00',
    origem: 'parceria', id_cadastro: 12, helena: null, ...over,
  };
}

beforeEach(() => {
  ordem = []; existentes = []; bloqueadosSet = new Set(); silenciadosSet = new Set();
  leituraPreviaFalha = false; ocupados = new Set(); marcaFalha = false; repassarFicaPreenchido = false;
  semCarimbos = false; fichasGravadas.length = 0; proximoId = 100; quandoPorId = new Map();
  marcasExistentes = new Set(); cardExistente = null; ultimaMarca = null;
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

describe('a sequência de escritas', () => {
  it('insert, marca de silêncio, etiqueta e tipo, repasse nulo e leitura de volta, nesta ordem', async () => {
    const r = await lote([item()]);
    expect(r.itens[0]).toMatchObject({ resultado: 'criado', id: 100 });
    expect(ordem).toEqual(['insert', 'ler_quando', 'marca_ep_mudo', 'etiqueta', 'tipo', 'update_repassar_em_nulo', 'ler_de_volta']);
  });

  it('o card nasce agendado, morno, da origem muda e com os carimbos do tick preenchidos', async () => {
    await lote([item()]);
    const f = fichasGravadas[0]!;
    expect(f).toMatchObject({
      vendedor_nome: 'Thiago', status: 'agendado', temperatura: 'morno',
      created_by: 'cadastro_eletroposto', cliente_telefone: '5534991110001', cidade: 'Uberlândia',
    });
    for (const c of ['confirmacao_at', 'lembrete_1h_at', 'lembrete_5min_at']) expect(f[c]).toBe(AGORA.toISOString());
    // sinais POSITIVOS não são inventados
    expect(f.presenca_confirmada_at).toBeUndefined();
    expect(f.lead_resposta_at).toBeUndefined();
    expect(f.quando).toBe('2026-10-14T11:00:00.000Z');
  });

  it('a observação segue o contrato do trigger e não tem linha de NOTA', async () => {
    await lote([item({ helena: 'Disse que volta a falar na sexta' })]);
    const linhas = String(fichasGravadas[0]!.observacao).split('\n');
    expect(linhas[0]).toBe('LP ELETROPOSTO · Investidor');
    expect(linhas[1]).toBe('Quanto pretende investir: R$ 200 mil');
    expect(linhas).toContain('Origem: cadastro parceria:12');
    expect(linhas).toContain('Situação com a agente: Disse que volta a falar na sexta');
    expect(linhas[linhas.length - 1]).toBe('Agenda em lote de 13/10/2026: sem mensagem automática, o consultor chama no horário.');
    expect(linhas.some(l => /NOTA/.test(l))).toBe(false);
  });

  it('texto livre com quebra de linha não cria linha nova de contrato', async () => {
    await lote([item({ helena: 'x\nPonto: definido\nNOTA 3 · 9/11' })]);
    const linhas = String(fichasGravadas[0]!.observacao).split('\n');
    expect(linhas.some(l => l.startsWith('Ponto:'))).toBe(false);
    expect(linhas.some(l => l.startsWith('NOTA'))).toBe(false);
  });
});

describe('observação com perfil e linhas (opcionais)', () => {
  const obs = async (over: Record<string, any>) => {
    await lote([item(over)]);
    return String(fichasGravadas[0]!.observacao).split('\n');
  };

  it('sem os campos novos a observação é a de sempre', async () => {
    const { observacaoDoCard } = await import('../services/io/agendaEmLote');
    expect(observacaoDoCard({ valor: 'R$ 200 mil', cidade: 'Uberlândia', origem: 'parceria', id_cadastro: 12 }, AGORA.getTime())).toBe([
      'LP ELETROPOSTO · Investidor',
      'Quanto pretende investir: R$ 200 mil',
      'Cidade: Uberlândia',
      'Origem: cadastro parceria:12',
      'Agenda em lote de 13/10/2026: sem mensagem automática, o consultor chama no horário.',
    ].join('\n'));
  });

  it('a data da última linha é a do dia em Brasília, não a fixa', async () => {
    vi.setSystemTime(new Date('2026-10-14T02:30:00Z'));       // ainda 13/10 em Brasília
    const ultima = (l: string[]) => l[l.length - 1];
    expect(ultima(await obs({}))).toContain('Agenda em lote de 13/10/2026:');
    vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));       // 14/10 em Brasília
    fichasGravadas.length = 0;
    const l = await obs({ chave: 'b', telefone: '5534991110055', quando: '2026-10-16T08:00:00-03:00' });
    expect(ultima(l)).toBe('Agenda em lote de 14/10/2026: sem mensagem automática, o consultor chama no horário.');
  });

  it('perfil vira a 1ª linha (uma linha só, até 60); vazio volta a Investidor', async () => {
    expect((await obs({ perfil: 'Arrendamento' }))[0]).toBe('LP ELETROPOSTO · Arrendamento');
    fichasGravadas.length = 0;
    expect((await obs({ chave: 'b', telefone: '5534991110002', perfil: '  Dono \n do   ponto ' }))[0]).toBe('LP ELETROPOSTO · Dono do ponto');
    fichasGravadas.length = 0;
    expect((await obs({ chave: 'c', telefone: '5534991110003', perfil: 'x'.repeat(100) }))[0]).toBe(`LP ELETROPOSTO · ${'x'.repeat(60)}`);
    fichasGravadas.length = 0;
    expect((await obs({ chave: 'd', telefone: '5534991110004', perfil: '   ' }))[0]).toBe('LP ELETROPOSTO · Investidor');
  });

  it('item sem valor e com linhas: as linhas entram na ordem recebida e não imprime "Quanto pretende investir"', async () => {
    const l = await obs({ valor: undefined, perfil: 'Arrendamento', cidade: 'Uberaba', linhas: ['Terreno: 300 m²', 'Fluxo: alto', 'Dono: Sr. João'] });
    expect(l).toEqual([
      'LP ELETROPOSTO · Arrendamento',
      'Terreno: 300 m²', 'Fluxo: alto', 'Dono: Sr. João',
      'Cidade: Uberaba',
      'Origem: cadastro parceria:12',
      'Agenda em lote de 13/10/2026: sem mensagem automática, o consultor chama no horário.',
    ]);
    expect(l.some(x => x.startsWith('Quanto pretende investir'))).toBe(false);
  });

  it('com valor e linhas: as linhas vêm antes e a linha do valor continua', async () => {
    const l = await obs({ linhas: ['A: 1', 'B: 2'] });
    expect(l.slice(0, 4)).toEqual(['LP ELETROPOSTO · Investidor', 'A: 1', 'B: 2', 'Quanto pretende investir: R$ 200 mil']);
  });

  it('limpa quebra de linha e espaço duplo, descarta vazia e corta em 200 caracteres', async () => {
    const l = await obs({ valor: null, linhas: ['  a\n\n b   c ', '', '   ', 42, null, { x: 1 }, 'y'.repeat(300)] });
    expect(l.slice(1, 4)).toEqual(['a b c', '42', 'y'.repeat(200)]);
    expect(l[4]).toBe('Cidade: Uberlândia');
  });

  it('descarta linha com a marca de NOTA do trigger em QUALQUER ponto, em qualquer caixa, mesmo vindo com quebra de linha', async () => {
    const l = await obs({ valor: undefined, linhas: ['NOTA 3 · 11/11 pts', 'nota 2 · x', 'x\nNOTA 3 · 11/11 pts', 'Fez NOTA 1 - boa', 'NOTA fiscal emitida', 'Anotação 5', 'NOTA 4 · y'] });
    expect(l.slice(1, 5)).toEqual(['NOTA fiscal emitida', 'Anotação 5', 'NOTA 4 · y', 'Cidade: Uberlândia']);
    expect(l.join('\n')).not.toMatch(/NOTA\s*[123]\s*[·—-]/i);
  });

  it('perfil com NOTA, ou que não é texto, cai em Investidor', async () => {
    expect((await obs({ perfil: 'Outro NOTA 2 · 7/11' }))[0]).toBe('LP ELETROPOSTO · Investidor');
    for (const [i, perfil] of [{}, 7, ['Arrendamento'], null].entries()) {
      fichasGravadas.length = 0;
      expect((await obs({ chave: `p${i}`, telefone: `553499111010${i}`, perfil }))[0]).toBe('LP ELETROPOSTO · Investidor');
    }
  });

  it('cidade, valor, origem e helena com NOTA são tratados como vazios', async () => {
    const l = await obs({ cidade: 'Uberaba NOTA 3 · 9/11 pts', valor: 'NOTA 2 · 5/11', origem: 'x NOTA 1 — y', helena: 'disse NOTA 3 · 9/11' });
    expect(l).toEqual([
      'LP ELETROPOSTO · Investidor',
      'Quanto pretende investir: não informado',
      'Origem: cadastro lote:12',
      'Agenda em lote de 13/10/2026: sem mensagem automática, o consultor chama no horário.',
    ]);
    expect(fichasGravadas[0]!.cidade).toBeNull();
  });

  it('valor com NOTA conta como ausente: com linhas, a pergunta do valor não sai', async () => {
    const l = await obs({ valor: 'NOTA 3 · 9/11', linhas: ['a'] });
    expect(l.slice(0, 2)).toEqual(['LP ELETROPOSTO · Investidor', 'a']);
    expect(l.some(x => x.startsWith('Quanto pretende'))).toBe(false);
  });

  it('no máximo 14 linhas', async () => {
    const l = await obs({ valor: undefined, linhas: Array.from({ length: 20 }, (_, i) => `L${i + 1}`) });
    expect(l.filter(x => /^L\d+$/.test(x))).toEqual(Array.from({ length: 14 }, (_, i) => `L${i + 1}`));
  });

  it('linhas que não é lista, ou sem nenhuma linha válida, não muda nada', async () => {
    expect((await obs({ linhas: 'solta' }))[1]).toBe('Quanto pretende investir: R$ 200 mil');
    fichasGravadas.length = 0;
    expect((await obs({ chave: 'b', telefone: '5534991110002', valor: undefined, linhas: ['NOTA 1 · x', ''] }))[1]).toBe('Quanto pretende investir: não informado');
  });

  it('o card criado pela rota leva perfil e linhas na observação gravada', async () => {
    const r = await lote([item({ valor: undefined, perfil: 'Arrendamento', linhas: ['Terreno: 300 m²'] })]);
    expect(r.itens[0]!.resultado).toBe('criado');
    expect(String(fichasGravadas[0]!.observacao).split('\n').slice(0, 2)).toEqual(['LP ELETROPOSTO · Arrendamento', 'Terreno: 300 m²']);
  });

  it('dry com perfil e linhas devolve previa e não escreve', async () => {
    const r = await lote([item({ perfil: 'Arrendamento', linhas: ['a'] })], { dry: true, tipo: 'arrendamento' });
    expect(r.itens[0]!.resultado).toBe('previa');
    expect(ordem).toEqual([]);
    expect(fichasGravadas).toHaveLength(0);
  });
});

describe('dry', () => {
  it('valida e checa duplicado, mas não escreve nada', async () => {
    const r = await lote([item(), item({ chave: 'a2', telefone: '5534991110002', quando: '2026-10-14T08:30:00-03:00' })],
      { dry: true, tipo: 'cotista' });
    expect(r.itens.map(i => i.resultado)).toEqual(['previa', 'previa']);
    expect(ordem).toEqual([]);
    expect(fichasGravadas).toHaveLength(0);
  });

  it('dois itens com o mesmo telefone no mesmo lote: o segundo já é duplicado', async () => {
    const r = await lote([item(), item({ chave: 'a2', quando: '2026-10-14T09:00:00-03:00' })], { dry: true, tipo: 'cotista' });
    expect(r.itens.map(i => i.resultado)).toEqual(['previa', 'ja_tem_card']);
  });
});

describe('não duplicar e não chamar quem pediu para parar', () => {
  it('chave DDD+8 que já tem card, em QUALQUER status, não grava (mesmo com o nono dígito diferente)', async () => {
    existentes = [{ cliente_telefone: '553491110001' }];
    const r = await lote([item()]);
    expect(r.itens[0]).toMatchObject({ resultado: 'ja_tem_card', id: null });
    expect(ordem).toEqual([]);
  });

  it('o card criado entra no conjunto: o mesmo telefone de novo no lote não cria o segundo', async () => {
    const r = await lote([item(), item({ chave: 'a2', quando: '2026-10-14T09:00:00-03:00' })]);
    expect(r.itens.map(i => i.resultado)).toEqual(['criado', 'ja_tem_card']);
    expect(fichasGravadas).toHaveLength(1);
  });

  it('bloqueado à mão ou com pedido de parada: não grava', async () => {
    bloqueadosSet.add('3491110001');
    silenciadosSet.add('3491110002');
    const r = await lote([item(), item({ chave: 'a2', telefone: '5534991110002', quando: '2026-10-14T09:00:00-03:00' })]);
    expect(r.itens.map(i => i.resultado)).toEqual(['bloqueado', 'bloqueado']);
    expect(ordem).toEqual([]);
  });

  it('leitura prévia falhando derruba o lote inteiro SEM gravar (modo estrito)', async () => {
    leituraPreviaFalha = true;
    const r = await lote([item()]);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('leitura_previa_falhou');
    expect(ordem).toEqual([]);
  });
});

describe('validações do item', () => {
  const motivo = async (quando: unknown) => (await lote([item({ quando })], { dry: true, tipo: 'cotista' })).itens[0]!;

  it('08:00 e 19:30 de Brasília entram', async () => {
    expect((await motivo('2026-10-14T08:00:00-03:00')).resultado).toBe('previa');
    expect((await motivo('2026-10-14T19:30:00-03:00')).resultado).toBe('previa');
  });

  it('o fuso é o de Brasília, não o do servidor: 11:00Z é 08:00 BRT, 10:30Z é 07:30 BRT', async () => {
    expect((await motivo('2026-10-14T11:00:00Z')).resultado).toBe('previa');
    expect((await motivo('2026-10-14T10:30:00Z')).resultado).toBe('invalido');
  });

  it('o almoço (12:00 às 13:30) é recusado na criação; 11:30, 13:30 e 19:30 entram', async () => {
    for (const h of ['12:00', '12:30', '13:00']) {
      expect(await motivo(`2026-10-14T${h}:00-03:00`)).toMatchObject({ resultado: 'invalido', motivo: 'horario_de_almoco' });
    }
    for (const h of ['11:30', '13:30', '19:30']) {
      expect((await motivo(`2026-10-14T${h}:00-03:00`)).resultado).toBe('previa');
    }
  });

  it('o almoço é o de Brasília: 15:30Z é 12:30 BRT (recusa), 12:30Z é 09:30 BRT (entra)', async () => {
    expect((await motivo('2026-10-14T15:30:00Z')).motivo).toBe('horario_de_almoco');
    expect((await motivo('2026-10-14T12:30:00Z')).resultado).toBe('previa');
  });

  it('o almoço recusado não grava nada, nem no lote de verdade', async () => {
    const r = await lote([item({ quando: '2026-10-14T12:30:00-03:00' })]);
    expect(r.itens[0]).toMatchObject({ resultado: 'invalido', motivo: 'horario_de_almoco' });
    expect(ordem).toEqual([]);
  });

  it('07:30 e 20:00 ficam fora', async () => {
    expect((await motivo('2026-10-14T07:30:00-03:00')).motivo).toBe('fora_das_8_as_19_30');
    expect((await motivo('2026-10-14T20:00:00-03:00')).motivo).toBe('fora_das_8_as_19_30');
  });

  it('minuto 15 e 45 ficam fora da grade', async () => {
    expect((await motivo('2026-10-14T08:15:00-03:00')).motivo).toBe('minuto_fora_da_grade');
    expect((await motivo('2026-10-14T08:45:00-03:00')).motivo).toBe('minuto_fora_da_grade');
  });

  it('sábado e domingo ficam fora', async () => {
    expect((await motivo('2026-10-17T09:00:00-03:00')).motivo).toBe('fim_de_semana');
    expect((await motivo('2026-10-18T09:00:00-03:00')).motivo).toBe('fim_de_semana');
  });

  it('passado fica fora, e hora sem fuso também', async () => {
    expect((await motivo('2026-10-13T09:00:00-03:00')).motivo).toBe('quando_no_passado');
    expect((await motivo('2026-10-14T09:00:00')).motivo).toBe('quando_nao_e_iso_com_fuso');
    expect((await motivo(undefined)).resultado).toBe('invalido');
  });

  it('consultor fora de Thiago e Diego não grava', async () => {
    const r = await lote([item({ consultor: 'Giovanna' })]);
    expect(r.itens[0]).toMatchObject({ resultado: 'invalido' });
    expect(ordem).toEqual([]);
  });

  it('telefone: sem o 55 ganha o 55; curto ou torto é inválido', async () => {
    const { normalizarTelefone } = await import('../services/io/agendaEmLote');
    expect(normalizarTelefone('34991110001')).toBe('5534991110001');
    expect(normalizarTelefone('(34) 99111-0001')).toBe('5534991110001');
    expect(normalizarTelefone('553491110001')).toBe('553491110001');
    expect(normalizarTelefone('9111')).toBeNull();
    expect(normalizarTelefone('abc')).toBeNull();
    expect(normalizarTelefone('55349911100019999')).toBeNull();
  });

  it('nome com menos de 3 letras vira "Investidor"', async () => {
    const { nomeDoCard } = await import('../services/io/agendaEmLote');
    expect(nomeDoCard('Jo')).toBe('Investidor');
    expect(nomeDoCard('  ')).toBe('Investidor');
    expect(nomeDoCard('12 3')).toBe('Investidor');
    expect(nomeDoCard('Ana Paula')).toBe('Ana Paula');
  });

  it('tipo fora de cotista, arrendamento e integrador; mais de 60 itens; lista vazia', async () => {
    expect((await lote([item()], { dry: false, tipo: 'vendido' })).erro).toBe('tipo_invalido');
    expect((await lote(Array.from({ length: 61 }, (_, i) => item({ chave: `x${i}` })))).erro).toContain('maximo_60');
    expect((await lote([])).erro).toBe('sem_itens');
    expect(ordem).toEqual([]);
  });
});

describe('quando algo dá errado no meio', () => {
  it('horário ocupado (23505) segue para o próximo, sem procurar outro horário', async () => {
    ocupados.add('Thiago|2026-10-14T11:00:00.000Z');
    const r = await lote([item(), item({ chave: 'a2', telefone: '5534991110002', quando: '2026-10-14T09:00:00-03:00' })]);
    expect(r.itens.map(i => i.resultado)).toEqual(['horario_ocupado', 'criado']);
    expect(r.parou).toBe(false);
    expect(fichasGravadas).toHaveLength(1);
    expect(fichasGravadas[0]!.quando).toBe('2026-10-14T12:00:00.000Z');
  });

  it('a marca ep_mudo falhando 3 vezes PARA o lote: o item volta com aviso e os seguintes não são gravados', async () => {
    marcaFalha = true;
    const r = await lote([item(), item({ chave: 'a2', telefone: '5534991110002', quando: '2026-10-14T09:00:00-03:00' })]);
    expect(r.itens[0]).toMatchObject({ resultado: 'parou_o_lote', id: 100 });
    expect(r.itens[0]!.aviso).toContain('#100');
    expect(r.itens[1]).toMatchObject({ resultado: 'nao_processado' });
    expect(r.parou).toBe(true);
    expect(ordem.filter(o => o === 'marca_ep_mudo')).toHaveLength(3);
    expect(ordem.filter(o => o === 'insert')).toHaveLength(1);
    expect(ordem).not.toContain('etiqueta');
  });

  it('repassar_em preenchido na leitura de volta PARA o lote', async () => {
    repassarFicaPreenchido = true;
    const r = await lote([item(), item({ chave: 'a2', telefone: '5534991110002', quando: '2026-10-14T09:00:00-03:00' })]);
    expect(r.itens[0]).toMatchObject({ resultado: 'parou_o_lote', motivo: 'repassar_em_ficou_preenchido' });
    expect(r.itens[1]!.resultado).toBe('nao_processado');
    expect(r.motivo_da_parada).toBe('repassar_em_ficou_preenchido');
  });

  it('carimbo do tick faltando na leitura de volta também PARA', async () => {
    semCarimbos = true;
    const r = await lote([item()]);
    expect(r.itens[0]).toMatchObject({ resultado: 'parou_o_lote', motivo: 'carimbos_do_tick_nao_gravaram' });
  });

  it('os totais contam cada resultado', async () => {
    existentes = [{ cliente_telefone: '5534991110009' }];
    const r = await lote([item(), item({ chave: 'a2', telefone: '5534991110009', quando: '2026-10-14T09:00:00-03:00' })]);
    expect(r.totais).toMatchObject({ itens: 2, criado: 1, ja_tem_card: 1 });
  });
});

describe('segunda rodada: conserta o card do lote que nasceu e falhou no meio', () => {
  const doLote = { id: 500, cliente_telefone: '5534991110001', created_by: 'cadastro_eletroposto' };
  const cardAgendado = (over: Record<string, any> = {}) =>
    ({ id: 500, quando: '2026-10-14T13:00:00+00:00', status: 'agendado', repassar_em: '2026-10-14T01:00:00Z', ...over });

  it('chave que já tem card DESTA origem: refaz marca, etiqueta, tipo e repasse, e devolve "conferido"', async () => {
    existentes = [doLote]; cardExistente = cardAgendado();
    const r = await lote([item()]);
    expect(r.itens[0]).toMatchObject({ resultado: 'conferido', id: 500 });
    expect(r.parou).toBe(false);
    expect(ordem).toEqual(['ler_card_existente', 'marca_ep_mudo', 'etiqueta', 'tipo', 'update_repassar_em_nulo', 'ler_de_volta']);
    // a marca usa o `quando` ATUAL do card, não o do item
    expect(ultimaMarca).toEqual({ id: 500, quando: '2026-10-14T13:00:00+00:00' });
    expect(ordem).not.toContain('insert');
  });

  it('etiqueta e tipo que já existem não são regravados', async () => {
    existentes = [doLote]; cardExistente = cardAgendado();
    marcasExistentes = new Set(['etiqueta_card:500', 'tipo_card:500']);
    await lote([item()]);
    expect(ordem).not.toContain('etiqueta');
    expect(ordem).not.toContain('tipo');
    expect(ordem).toContain('marca_ep_mudo');
  });

  it('card que o consultor já moveu de status: a marca se refaz, mas etiqueta e repasse ficam quietos', async () => {
    existentes = [doLote]; cardExistente = cardAgendado({ status: 'cotista' });
    const r = await lote([item()]);
    expect(r.itens[0]).toMatchObject({ resultado: 'conferido', id: 500 });
    expect(ordem).not.toContain('etiqueta');
    expect(ordem).not.toContain('update_repassar_em_nulo');
  });

  it('não muda quando, consultor nem status do card existente: nenhum insert e nenhum update além do repasse', async () => {
    existentes = [doLote]; cardExistente = cardAgendado();
    await lote([item({ consultor: 'Diego', quando: '2026-10-16T10:00:00-03:00' })]);
    expect(ordem.filter(o => o.startsWith('update'))).toEqual(['update_repassar_em_nulo']);
    expect(fichasGravadas).toHaveLength(0);
  });

  it('a conferência vale mesmo com o horário do item já vencido', async () => {
    existentes = [doLote]; cardExistente = cardAgendado();
    const r = await lote([item({ quando: '2026-10-12T09:00:00-03:00' })]);
    expect(r.itens[0]!.resultado).toBe('conferido');
  });

  it('dry: devolve "conferido" sem escrever nem ler o card', async () => {
    existentes = [doLote]; cardExistente = cardAgendado();
    const r = await lote([item()], { dry: true, tipo: 'cotista' });
    expect(r.itens[0]).toMatchObject({ resultado: 'conferido', id: 500 });
    expect(ordem).toEqual([]);
  });

  it('repassar_em que não zera PARA o lote, com o id no item', async () => {
    existentes = [doLote]; cardExistente = cardAgendado(); repassarFicaPreenchido = true;
    const r = await lote([item(), item({ chave: 'a2', telefone: '5534991110002', quando: '2026-10-14T09:00:00-03:00' })]);
    expect(r.itens[0]).toMatchObject({ resultado: 'parou_o_lote', id: 500, motivo: 'repassar_em_ficou_preenchido' });
    expect(r.itens[1]!.resultado).toBe('nao_processado');
  });

  it('card de QUALQUER OUTRA origem continua "ja_tem_card", sem tocar em nada', async () => {
    existentes = [{ id: 501, cliente_telefone: '5534991110001', created_by: 'lp_eletroposto' }]; cardExistente = cardAgendado({ id: 501 });
    const r = await lote([item()]);
    expect(r.itens[0]).toMatchObject({ resultado: 'ja_tem_card', id: null });
    expect(ordem).toEqual([]);
  });

  it('duas vezes a mesma chave na MESMA chamada, criada agora: o segundo segue duplicado, não "conferido"', async () => {
    const r = await lote([item(), item({ chave: 'a2', quando: '2026-10-14T09:00:00-03:00' })]);
    expect(r.itens.map(i => i.resultado)).toEqual(['criado', 'ja_tem_card']);
  });
});

describe('a rota de escrita fecha sozinha', () => {
  it('LOTE_ABERTO_ATE é o fim do dia 14/10 em Brasília', async () => {
    const { LOTE_ABERTO_ATE } = await import('../services/io/agendaEmLote');
    expect(new Date(LOTE_ABERTO_ATE).toISOString()).toBe('2026-10-15T03:00:00.000Z');
  });

  it('aberta até 23:59 de 14/10 em Brasília, encerrada a partir de 00:00 de 15/10', async () => {
    const { loteEncerrado } = await import('../services/io/agendaEmLote');
    expect(loteEncerrado(new Date('2026-10-13T15:00:00Z').getTime())).toBe(false);
    expect(loteEncerrado(new Date('2026-10-15T02:59:59Z').getTime())).toBe(false);
    expect(loteEncerrado(new Date('2026-10-15T03:00:00Z').getTime())).toBe(true);
    expect(loteEncerrado(new Date('2026-11-01T12:00:00Z').getTime())).toBe(true);
  });

  it('usa o relógio da hora quando não recebe nenhum', async () => {
    const { loteEncerrado } = await import('../services/io/agendaEmLote');
    expect(loteEncerrado()).toBe(false);                       // AGORA falso = 13/10
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
    expect(loteEncerrado()).toBe(true);
  });
});
