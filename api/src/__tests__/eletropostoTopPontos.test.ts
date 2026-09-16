import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O TOP 20 DO MEIO-DIA, E OS TRÊS JEITOS DE ELE DAR ERRADO.
//
//   · REPETIR. O cron pode rodar de novo no mesmo dia. Carimbo por dia no
//     system_state, e carimbo só depois de alguém receber.
//   · MISTURAR FONTE. Reunião, parceria e NOTA 1 têm formatos diferentes e o
//     mesmo ponto pode estar em duas. Uma régua só, e duplicado some.
//   · VAZAR PARA O LEAD. Nada sai para cliente_telefone. A mensagem vai para a
//     equipe, e a prévia da rota não leva nome, telefone nem endereço.

const h = vi.hoisted(() => ({
  reunioes: [] as Array<Record<string, any>>,
  nota1: [] as Array<Record<string, any>>,
  parceria: [] as Array<Record<string, any>>,
  estudos: [] as Array<Record<string, any>>,
  enviados: [] as Array<{ numero: string; texto: string }>,
  carimbos: new Map<string, unknown>(),
  falharEnvio: false,
}));

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const dados = () => (tabela === 'agendamentos' ? h.reunioes : tabela === 'eletroposto_nota1' ? h.nota1 : h.parceria);
      const api: any = {
        select: () => api, eq: () => api, ilike: () => api, not: () => api, order: () => api,
        limit: () => Promise.resolve({ data: dados(), error: null }),
      };
      return api;
    },
  },
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const api: any = {
        select: () => api,
        eq: (_c: string, chave: string) => ({ maybeSingle: () => Promise.resolve({ data: h.carimbos.has(chave) ? { key: chave } : null, error: null }) }),
        upsert: (linha: any) => { h.carimbos.set(linha.key, linha.value); return Promise.resolve({ data: null, error: null }); },
      };
      return api;
    },
  },
}));

vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: (numero: string, texto: string) => {
    if (h.falharEnvio) return Promise.reject(new Error('linha caiu'));
    h.enviados.push({ numero, texto });
    return Promise.resolve({ ok: true });
  },
}));

vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34900000001', diego: '34900000002' } }));

vi.mock('../services/io/eletropostoEstudoBanco', () => ({
  bancoConfigurado: () => true,
  listar: async () => h.estudos,
}));

vi.mock('../services/io/eletropostoEstudoFontes', () => ({
  // Uberlândia forte, cidade pequena fraca. Vale só a proporção.
  frotaDoMunicipio: (ibge: number) => (ibge === 3170206
    ? { frota: 565639, plugin: 3017, por_mil: 5.3, uf_por_mil: 1.5, br_por_mil: 3.1, plugin_br: 416572, frota_br: 132323803, ref: 'julho/2026' }
    : { frota: 20000, plugin: 12, por_mil: 0.6, uf_por_mil: 1.5, br_por_mil: 3.1, plugin_br: 416572, frota_br: 132323803, ref: 'julho/2026' }),
}));

vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { montarTopPontos, textoTopPontos, runEletropostoTopPontosTick } from '../services/io/eletropostoTopPontos';

const AGORA = Date.parse('2026-09-16T15:00:00Z');   // meio-dia de Brasília

const OBS_POSTO = [
  'LP ELETROPOSTO · Dono de posto de combustível',
  'NOTA 3 · 11/11 pts',
  'Endereço: Avenida Brasil, 3200 · Distrito Industrial · Uberlândia-MG · CEP 38400-000',
  'Ponto: Já tenho o ponto definido',
  'Local é seu: Sou o proprietário',
  'Como pretende investir: Recurso próprio',
].join('\n');

const OBS_NEGOCIANDO = [
  'LP ELETROPOSTO · Academia',
  'NOTA 3 · 9/11 pts',
  'Endereço: Rua das Flores, 10 · Centro · Ituiutaba-MG',
  'Ponto: Tenho um local em negociação com o proprietário',
  'Como pretende investir: Financiamento · ainda não consultei o banco',
].join('\n');

const reuniao = (o: Record<string, any> = {}) => ({
  id: 1, cliente_nome: 'Valter Salvador Silva', cliente_telefone: '5534988887777', cidade: 'Uberlândia-MG',
  observacao: OBS_POSTO, quando: '2026-09-18T17:00:00Z', status: 'agendado',
  created_at: '2026-09-15T12:00:00Z', created_by: 'lp_eletroposto', ...o,
});

const nota1 = (o: Record<string, any> = {}) => ({
  id: 10, nome: 'Carlos Souza', telefone: '5511977776666', cidade: 'Ituiutaba-MG',
  endereco: 'Rua Sem Fim, 5 · Centro · Ituiutaba-MG', perfil_slug: 'outro', tem_ponto: 'sem_ideia',
  capital_faixa: 'naosei', created_at: '2026-09-10T12:00:00Z', ...o,
});

const parceria = (o: Record<string, any> = {}) => ({
  id: 20, nome: 'Ana Paula', telefone: '5541966665555', cidade: 'Uberlândia-MG',
  ponto_endereco: 'Rua Wilson Dacheux, 1400', ponto_relacao: 'Sou o proprietário', ponto_tipo: 'Estacionamento',
  ponto_vagas: '6 a 10 vagas', ponto_fluxo: 'Avenida movimentada', ponto_energia: 'Sim',
  created_at: '2026-09-12T12:00:00Z', lado: 'ponto', ...o,
});

beforeEach(() => {
  Object.assign(h, { reunioes: [], nota1: [], parceria: [], estudos: [], enviados: [], falharEnvio: false });
  h.carimbos.clear();
});
afterEach(() => { delete process.env.EP_TOP_OFF; });

describe('ranking', () => {
  it('ponto com dono em cidade forte ganha de NOTA 1 sem local', async () => {
    h.reunioes = [reuniao()];
    h.nota1 = [nota1()];
    h.parceria = [parceria()];
    const { lista, total, porFonte } = await montarTopPontos();

    expect(total).toBe(3);
    expect(porFonte).toEqual({ reuniao: 1, parceria: 1, nota1: 1 });
    // Dono de posto e dono de estacionamento empatam em 96: os dois têm o local sob
    // controle na mesma cidade. O desempate é ter estudo, depois a fonte.
    expect(lista[0].fonte).toBe('reuniao');
    expect(lista[0].nota).toBeGreaterThanOrEqual(lista[1].nota);
    expect(lista[1].fonte).toBe('parceria');
    // NOTA 1 sem ideia de onde instalar: o endereço é a casa da pessoa, então ela
    // fica por último mesmo com nota razoável, e a linha diz isso.
    const ultimo = lista[lista.length - 1];
    expect(ultimo.fonte).toBe('nota1');
    expect(ultimo.tem_ponto).toBe(false);
    expect(ultimo.detalhe).toContain('sem ponto definido');
    expect(lista[0].tem_ponto).toBe(true);
  });

  it('parceria com proprietário vale 100 de pré-nota, como a reunião de dono', async () => {
    h.parceria = [parceria()];
    const { lista } = await montarTopPontos();
    expect(lista[0].pre_nota).toBe(100);
    expect(lista[0].perfil).toBe('Estacionamento');
    expect(lista[0].detalhe).toContain('6 a 10 vagas');
  });

  it('cidade sem frota elétrica derruba a nota final, com a mesma pré-nota', async () => {
    h.reunioes = [reuniao(), reuniao({ id: 2, cidade: 'Ituiutaba-MG', observacao: OBS_POSTO.replace('Uberlândia-MG', 'Ituiutaba-MG'), cliente_telefone: '5534911112222' })];
    const { lista } = await montarTopPontos();
    expect(lista[0].cidade).toBe('Uberlândia-MG');
    expect(lista[0].pre_nota).toBe(lista[1].pre_nota);
    expect(lista[0].nota).toBeGreaterThan(lista[1].nota);
  });

  it('mesmo endereço em duas fontes conta uma vez, e fica com a reunião', async () => {
    h.reunioes = [reuniao()];
    h.nota1 = [nota1({ id: 11, cidade: 'Uberlândia-MG', endereco: 'Avenida Brasil, 3200 · Distrito Industrial · Uberlândia-MG', telefone: '5534988887777' })];
    const { lista, total } = await montarTopPontos();
    expect(total).toBe(1);
    expect(lista[0].fonte).toBe('reuniao');
  });

  it('estudo pronto entra com o índice dele e com o link', async () => {
    h.reunioes = [reuniao()];
    h.estudos = [{ agendamento_id: 1, indice: 9.2, token: 'a'.repeat(64) }];
    const { lista } = await montarTopPontos();
    expect(lista[0].indice).toBe(9.2);
    expect(lista[0].estudo_url).toBe(`https://solardoc.app/_api/io/eletroposto/estudo/${'a'.repeat(64)}`);
  });
});

describe('mensagem', () => {
  it('traz cabeçalho, a régua, as posições e nenhum telefone', async () => {
    h.reunioes = [reuniao()];
    h.parceria = [parceria()];
    h.estudos = [{ agendamento_id: 1, indice: 8.6, token: 'b'.repeat(64) }];
    const top = await montarTopPontos();
    const texto = textoTopPontos(top, AGORA);

    expect(texto).toContain('*TOP 2 PONTOS · 16/09*');
    expect(texto).toContain('Nota = local (70%) e mercado da cidade (30%).');
    expect(texto).toContain('*1.');
    expect(texto).toContain(`https://solardoc.app/_api/io/eletroposto/estudo/${'b'.repeat(64)}`);
    expect(texto).toContain('Valter');
    expect(texto).not.toContain('988887777');
    expect(texto).not.toContain('Salvador Silva');
    expect(texto).not.toMatch(/[–—]/);
  });

  it('link só nos dez primeiros, para a mensagem não estourar', async () => {
    h.reunioes = Array.from({ length: 14 }, (_, i) => reuniao({
      id: i + 1, cliente_telefone: `55349000000${String(i).padStart(2, '0')}`,
      observacao: OBS_POSTO.replace('Avenida Brasil, 3200', `Avenida Brasil, ${100 + i}`),
    }));
    h.estudos = h.reunioes.map((r, i) => ({ agendamento_id: r.id, indice: 8, token: String(i).padStart(64, '0') }));
    const top = await montarTopPontos();
    const texto = textoTopPontos(top, AGORA);
    expect((texto.match(/eletroposto\/estudo\//g) || []).length).toBe(10);
    expect(texto.length).toBeLessThan(4000);
  });
});

describe('o tick do meio-dia', () => {
  it('manda para o Thiago e para o Diego e carimba o dia', async () => {
    h.reunioes = [reuniao()];
    const r = await runEletropostoTopPontosTick({ agora: AGORA });
    expect(r).toMatchObject({ enviados: 2, erros: 0, total: 1 });
    expect(h.enviados.map(e => e.numero)).toEqual(['34900000001', '34900000002']);
    expect(h.carimbos.has('ep_top_pontos:2026-09-16')).toBe(true);
  });

  it('não repete no mesmo dia', async () => {
    h.reunioes = [reuniao()];
    await runEletropostoTopPontosTick({ agora: AGORA });
    const r2 = await runEletropostoTopPontosTick({ agora: AGORA + 3600_000 });
    expect(r2.motivo).toBe('ja_enviado_hoje');
    expect(h.enviados).toHaveLength(2);
  });

  it('envio falhou: não carimba, e a próxima rodada tenta de novo', async () => {
    h.reunioes = [reuniao()];
    h.falharEnvio = true;
    const r = await runEletropostoTopPontosTick({ agora: AGORA });
    expect(r).toMatchObject({ enviados: 0, erros: 2 });
    expect(h.carimbos.size).toBe(0);

    h.falharEnvio = false;
    expect((await runEletropostoTopPontosTick({ agora: AGORA })).enviados).toBe(2);
  });

  it('dry devolve a prévia e não manda nem carimba', async () => {
    h.reunioes = [reuniao()];
    h.parceria = [parceria()];
    const r = await runEletropostoTopPontosTick({ agora: AGORA, dry: true });
    expect(r.motivo).toBe('dry');
    expect(r.previa).toHaveLength(2);
    expect(r.previa?.[0]).toMatchObject({ pos: 1, fonte: 'reuniao' });
    expect(JSON.stringify(r.previa)).not.toContain('Valter');
    expect(h.enviados).toHaveLength(0);
    expect(h.carimbos.size).toBe(0);
  });

  it('sem ponto com endereço, não manda nada', async () => {
    const r = await runEletropostoTopPontosTick({ agora: AGORA });
    expect(r.motivo).toBe('sem_ponto_com_endereco');
    expect(h.enviados).toHaveLength(0);
  });

  it('kill-switch cala tudo', async () => {
    process.env.EP_TOP_OFF = '1';
    h.reunioes = [reuniao()];
    expect((await runEletropostoTopPontosTick({ agora: AGORA })).motivo).toBe('desligado');
    expect(h.enviados).toHaveLength(0);
  });

  it('nenhuma mensagem vai para o telefone do lead', async () => {
    h.reunioes = [reuniao()];
    h.parceria = [parceria()];
    await runEletropostoTopPontosTick({ agora: AGORA });
    for (const e of h.enviados) {
      expect(e.numero).not.toContain('988887777');
      expect(e.numero).not.toContain('966665555');
    }
  });
});
