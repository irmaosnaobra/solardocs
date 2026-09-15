import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Estado em memória: agenda, estudos, WhatsApp e histórico ────────────────
// O banco do estudo imita as funções SQL (claim com tentativas, carimbo só se
// vazio, listas por modo). Sem isso, "dois ticks não processam a mesma linha" e
// "o aviso sai uma vez" seriam fé.
const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const s = {
    agora: 0,
    configurado: true,
    reunioes: [] as Row[],
    estudos: [] as Row[],
    enviados: [] as Array<{ tel: string; texto: string }>,
    historicos: [] as Array<{ id: number; linha: string }>,
    falharEnvio: false,
    seq: 0,
    f: {} as Record<string, any>,
  };

  const query = () => {
    const filtros: Array<(r: Row) => boolean> = [];
    const api: any = {
      select: () => api,
      in: (c: string, v: unknown[]) => { filtros.push(r => v.map(Number).includes(Number(r[c]))); return api; },
      eq: (c: string, v: unknown) => { filtros.push(r => r[c] === v); return api; },
      gt: (c: string, v: string) => { filtros.push(r => String(r[c]) > v); return api; },
      gte: (c: string, v: string) => { filtros.push(r => String(r[c]) >= v); return api; },
      ilike: (c: string, p: string) => { const t = p.replace(/%/g, ''); filtros.push(r => String(r[c] || '').includes(t)); return api; },
      order: () => api,
      limit: () => api,
      then: (ok: (v: unknown) => unknown) => ok({ data: s.reunioes.filter(r => filtros.every(f => f(r))), error: null }),
    };
    return api;
  };

  const iso = (ms: number) => new Date(ms).toISOString();
  const banco = {
    bancoConfigurado: () => s.configurado,
    garantirLinha: async (o: any) => {
      const ja = s.estudos.find(e => e.agendamento_id === o.agendamentoId);
      if (ja) return ja.token;
      s.estudos.push({
        id: ++s.seq, agendamento_id: o.agendamentoId, token: o.token, origem: o.origem, status: 'pendente',
        tentativas: 0, locked_until: null, municipio_ibge: null, confianca: null, pre_nota: null, indice: null,
        situacao: null, dados: o.dados || {}, fontes: {}, custo_usd: 0, erro: null,
        aviso_enviado_em: o.avisoEnviado ? iso(s.agora) : null, historico_em: null, coords_apagadas_em: null,
        created_at: iso(s.agora), pronto_em: null,
      });
      return o.token;
    },
    listar: async (modo: string, o: any = {}) => {
      const lim = o.limite ?? 20;
      const livre = (e: Row) => !e.locked_until || e.locked_until < iso(s.agora);
      const regra: Record<string, (e: Row) => boolean> = {
        fila: e => ['pendente', 'processando'].includes(e.status) && livre(e),
        aviso: e => ['pronto', 'parcial'].includes(e.status) && !e.aviso_enviado_em,
        historico: e => ['pronto', 'parcial'].includes(e.status) && !e.historico_em,
        limpeza: e => !!e.pronto_em && e.pronto_em < iso(s.agora - 30 * 86400_000) && !e.coords_apagadas_em,
        por_agendamentos: e => (o.ids || []).includes(e.agendamento_id),
        ibge: () => false,
      };
      return JSON.parse(JSON.stringify(s.estudos.filter(regra[modo]).slice(0, lim)));
    },
    contarProntosDesde: async (desde: string) => s.estudos.filter(e => e.pronto_em && e.pronto_em >= desde).length,
    pegar: async (id: number, t: number) => {
      const e = s.estudos.find(x => x.id === id);
      if (!e || e.tentativas !== t || t >= 3 || !['pendente', 'processando'].includes(e.status)) return false;
      Object.assign(e, { status: 'processando', tentativas: t + 1, locked_until: iso(s.agora + 240_000) });
      return true;
    },
    salvar: vi.fn(async (id: number, patch: Row) => { Object.assign(s.estudos.find(x => x.id === id) || {}, patch); }),
    marcar: async (id: number, campo: string, ligar: boolean) => {
      const e = s.estudos.find(x => x.id === id);
      const col = campo === 'aviso' ? 'aviso_enviado_em' : 'historico_em';
      if (!e) return false;
      if (ligar) { if (e[col]) return false; e[col] = iso(s.agora); return true; }
      e[col] = null; return true;
    },
    escreverNoHistorico: async (id: number, linha: string) => { s.historicos.push({ id, linha }); },
    lerPorToken: async () => null,
  };
  return { s, query, banco };
});

vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: () => h.query() } }));
vi.mock('../services/io/eletropostoEstudoBanco', () => h.banco);
vi.mock('../services/io/eletropostoEstudoFontes', () => ({
  buscarLocal: (...a: unknown[]) => h.s.f.buscarLocal(...a),
  buscarProximos: (...a: unknown[]) => h.s.f.buscarProximos(...a),
  streetViewMeta: (...a: unknown[]) => h.s.f.streetViewMeta(...a),
  provarStaticMap: (...a: unknown[]) => h.s.f.provarStaticMap(...a),
  ibgePopulacao: (...a: unknown[]) => h.s.f.ibgePopulacao(...a),
  ibgePibPerCapita: (...a: unknown[]) => h.s.f.ibgePibPerCapita(...a),
  historicoDoEndereco: (...a: unknown[]) => h.s.f.historicoDoEndereco(...a),
  escreverTextos: (...a: unknown[]) => h.s.f.escreverTextos(...a),
  frotaDoMunicipio: (...a: unknown[]) => h.s.f.frotaDoMunicipio(...a),
  sondarFontes: async () => ({}),
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (tel: string, texto: string) => {
    if (h.s.falharEnvio) throw new Error('zapi fora');
    h.s.enviados.push({ tel, texto });
  }),
}));
vi.mock('../routes/ioEletroposto', () => ({ EQUIPE: { thiago: '34900000001', diego: '34900000002' } }));
vi.mock('../services/io/eletropostoAgenda', () => ({ carregarConsultores: async () => new Map([['Diego', '5534900000002']]) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import fixtures from './fixtures/estudoFichas.json';
import { resolverCidade } from '../services/io/geoCidade';
import { textosDeModelo, urlDoEstudo } from '../services/io/eletropostoEstudoPuro';
import { sendWhatsApp } from '../services/agents/zapiClient';
import {
  runEletropostoEstudoTick, montarAvisoPronto, linhaDoHistorico, semCoordenadas, montarEstudo,
} from '../services/io/eletropostoEstudo';

const AGORA = Date.parse('2026-09-20T12:00:00Z');
const OBS_POSTO = fixtures.fichas.find(f => f.caso.includes('dono de posto'))!.observacao;   // Uberaba-MG
const UBERABA = resolverCidade('Uberaba-MG');
const CENTRO = { latitude: UBERABA.lat as number, longitude: UBERABA.lng as number };
const TEL_LEAD = '5534988887777';

const ok = <T>(dado: T, custo = 0) => ({ ok: true, dado, status: 'ok', http: 200, ms: 1, custo_usd: custo });
const falha = (status: string) => ({ ok: false, dado: null, status, http: null, ms: 1, custo_usd: 0 });

function reuniao(id: number, o: Record<string, unknown> = {}) {
  return {
    id, quando: new Date(AGORA + 2 * 86400_000).toISOString(), status: 'agendado', vendedor_nome: 'Diego',
    cliente_nome: 'Maria Clara Souza', cliente_telefone: TEL_LEAD, cidade: 'Uberaba-MG', observacao: OBS_POSTO,
    created_at: new Date(AGORA - 3600_000).toISOString(), created_by: 'lp_eletroposto', ...o,
  };
}

const lugares = (n: number, tipo: string) => Array.from({ length: n }, (_, i) => ({
  id: `${tipo}${i}`, displayName: { text: `${tipo} ${i}` }, primaryType: tipo, types: [tipo],
  location: { latitude: CENTRO.latitude + (i + 1) / 2000, longitude: CENTRO.longitude },
}));

beforeEach(() => {
  Object.assign(h.s, { agora: AGORA, configurado: true, reunioes: [], estudos: [], enviados: [], historicos: [], falharEnvio: false, seq: 0 });
  h.banco.salvar.mockClear();
  vi.mocked(sendWhatsApp).mockClear();
  h.s.f = {
    buscarLocal: vi.fn(async () => ok([{
      id: 'ChIJposto', formattedAddress: 'Av. Brasil, 3200, Uberaba - MG', location: CENTRO, types: ['street_address'],
      addressComponents: [{ longText: '3200', types: ['street_number'] }, { longText: 'Uberaba', types: ['administrative_area_level_2'] }],
    }], 0.032)),
    buscarProximos: vi.fn(async (_c: unknown, tipos: string[]) => ok(
      tipos.includes('electric_vehicle_charging_station') ? lugares(2, 'electric_vehicle_charging_station') : lugares(6, 'restaurant'), 0.032)),
    streetViewMeta: vi.fn(async () => ok({ pano_id: 'pano1', data: '2024-03', lat: CENTRO.latitude + 0.0002, lng: CENTRO.longitude })),
    provarStaticMap: vi.fn(async () => ok(true, 0.002)),
    ibgePopulacao: vi.fn(async () => ok({ valor: 359275, ano: '2026' })),
    ibgePibPerCapita: vi.fn(async () => ok({ valor: 70120.94, ano: '2023' })),
    historicoDoEndereco: vi.fn(async () => ({ ...ok([]), status: 'zero_resultados' })),
    escreverTextos: vi.fn(async (fatos: any) => ({ ia: { ...textosDeModelo(fatos), origem: 'ia', reprovados: [] }, status: 'ok', custo_usd: 0.02, ms: 1 })),
    frotaDoMunicipio: vi.fn(() => ({ frota: 250000, plugin: 900, por_mil: 3.6, uf_por_mil: 2.9, br_por_mil: 3.1, plugin_br: 416572, frota_br: 132323803, ref: 'julho/2026' })),
  };
});

afterEach(() => {
  for (const k of ['EP_ESTUDO_OFF', 'EP_ESTUDO_AVISO_OFF', 'EP_ESTUDO_HISTORICO_OFF', 'EP_ESTUDO_MAX_DIA']) delete process.env[k];
});

const tick = (o: Record<string, unknown> = {}) => runEletropostoEstudoTick({ agora: AGORA, ...o });

describe('caminho feliz', () => {
  it('ficha nova vira estudo pronto, o dono recebe um aviso e a ficha ganha a linha no CRM', async () => {
    h.s.reunioes = [reuniao(501)];
    const r = await tick();

    expect(r).toMatchObject({ rede: 1, processados: 1, prontos: 1, avisos: 1, historicos: 1 });
    const est = h.s.estudos[0];
    expect(est).toMatchObject({ agendamento_id: 501, origem: 'rede', status: 'pronto', confianca: 'alta', pre_nota: 100, situacao: 'pronto' });
    expect(est.dados.local.lat).toBeCloseTo(CENTRO.latitude, 5);
    expect(est.dados.municipio).toMatchObject({ nome: 'Uberaba', uf: 'MG', pop_2026: 359275, plugin: 900 });
    expect(est.dados.entorno.n).toBe(6);
    expect(est.dados.recarga.n).toBe(2);
    expect(est.dados.rua.pano_id).toBe('pano1');
    expect(est.custo_usd).toBeCloseTo(0.118, 3);

    expect(h.s.enviados).toHaveLength(1);
    expect(h.s.enviados[0].tel).toBe('5534900000002');
    expect(h.s.enviados[0].texto).toContain('*ESTUDO DO LOCAL PRONTO*');
    expect(h.s.enviados[0].texto).toContain(urlDoEstudo(est.token));
    expect(h.s.historicos[0].linha).toMatch(/^\[\d\d\/\d\d · \d\d:\d\d · Estudo\] Pré-nota 100 de 100, mercado \d+,\d de 10: https:\/\/solardoc\.app\/_api\/io\/eletroposto\/estudo\/[a-f0-9]{64}$/);
  });

  it('nenhuma mensagem vai para o telefone do lead', async () => {
    h.s.reunioes = [reuniao(501), reuniao(502, { cliente_telefone: '5534977776666' })];
    await tick();
    await tick();
    for (const c of vi.mocked(sendWhatsApp).mock.calls) {
      expect(String(c[0])).not.toContain('988887777');
      expect(String(c[0])).not.toContain('977776666');
    }
  });
});

describe('fontes que falham', () => {
  it('Nearby 403 deixa o estudo parcial', async () => {
    h.s.f.buscarProximos = vi.fn(async () => falha('erro:403'));
    h.s.reunioes = [reuniao(501)];
    await tick();
    expect(h.s.estudos[0].status).toBe('parcial');
    expect(h.s.estudos[0].fontes.nearby_entorno).toBe('erro:403');
    expect(h.s.estudos[0].dados.entorno).toBeNull();
  });

  it('searchText sem resultado: confiança nao_encontrado, CONFIRMAR ANTES, sem gastar com o entorno', async () => {
    h.s.f.buscarLocal = vi.fn(async () => ({ ...ok([]), status: 'zero_resultados' }));
    h.s.reunioes = [reuniao(501)];
    await tick();
    const est = h.s.estudos[0];
    expect(est.confianca).toBe('nao_encontrado');
    expect(est.situacao).toBe('confirmar');
    expect(h.s.f.buscarProximos).not.toHaveBeenCalled();
    expect(h.s.enviados[0].texto).toContain('Pedir a localização pelo seu WhatsApp:');
    expect(h.s.enviados[0].texto).toContain(`wa.me/${TEL_LEAD}?text=`);
  });

  it('sem chave do Google: parcial, e o motivo fica na fonte', async () => {
    h.s.f.buscarLocal = vi.fn(async () => falha('sem_chave'));
    h.s.reunioes = [reuniao(501)];
    await tick();
    expect(h.s.estudos[0].status).toBe('parcial');
    expect(h.s.estudos[0].fontes.searchText).toBe('sem_chave');
  });

  it('IA fora: o texto padrão entra e o estudo continua pronto', async () => {
    h.s.f.escreverTextos = vi.fn(async (fatos: any) => ({ ia: { ...textosDeModelo(fatos), origem: 'modelo', reprovados: [] }, status: 'erro:ia', custo_usd: 0, ms: 1 }));
    h.s.reunioes = [reuniao(501)];
    await tick();
    expect(h.s.estudos[0].status).toBe('pronto');
    expect(h.s.estudos[0].dados.ia.origem).toBe('modelo');
  });

  it('exceção no meio do estudo volta a linha para pendente e conta erro', async () => {
    h.s.f.historicoDoEndereco = vi.fn(async () => { throw new Error('boom'); });
    h.s.reunioes = [reuniao(501)];
    const r = await tick();
    expect(r.erros).toBe(1);
    expect(h.s.estudos[0]).toMatchObject({ status: 'pendente', tentativas: 1, locked_until: null });
  });
});

describe('fila e travas', () => {
  it('dois ticks ao mesmo tempo: só um processa a linha', async () => {
    h.s.reunioes = [reuniao(501)];
    await h.banco.garantirLinha({ agendamentoId: 501, token: 'a'.repeat(64), origem: 'alerta' });
    const [a, b] = await Promise.all([tick(), tick()]);
    expect(a.processados + b.processados).toBe(1);
    expect(h.s.f.buscarLocal).toHaveBeenCalledTimes(1);
  });

  it('reunião cancelada vira descartado sem chamar o Google', async () => {
    h.s.reunioes = [reuniao(501, { status: 'cancelado' })];
    await h.banco.garantirLinha({ agendamentoId: 501, token: 'a'.repeat(64), origem: 'alerta' });
    const r = await tick();
    expect(r.descartados).toBe(1);
    expect(h.s.estudos[0].status).toBe('descartado');
    expect(h.s.f.buscarLocal).not.toHaveBeenCalled();
  });

  it('teto diário: com o teto batido, ninguém é processado', async () => {
    process.env.EP_ESTUDO_MAX_DIA = '1';
    h.s.reunioes = [reuniao(501), reuniao(502)];
    await h.banco.garantirLinha({ agendamentoId: 501, token: 'a'.repeat(64), origem: 'alerta' });
    Object.assign(h.s.estudos[0], { status: 'pronto', pronto_em: new Date(AGORA - 60_000).toISOString(), aviso_enviado_em: 'x', historico_em: 'x' });
    await h.banco.garantirLinha({ agendamentoId: 502, token: 'b'.repeat(64), origem: 'alerta' });
    const r = await tick();
    expect(r.motivo).toBe('teto_diario');
    expect(h.s.estudos[1].status).toBe('pendente');
  });

  it('no máximo 2 estudos por rodada', async () => {
    h.s.reunioes = [reuniao(501), reuniao(502), reuniao(503)];
    const r = await tick();
    expect(r.rede).toBe(3);
    expect(r.processados).toBe(2);
  });
});

describe('interruptores', () => {
  it('EP_ESTUDO_OFF não faz nada', async () => {
    process.env.EP_ESTUDO_OFF = '1';
    h.s.reunioes = [reuniao(501)];
    expect((await tick()).motivo).toBe('desligado');
    expect(h.s.estudos).toHaveLength(0);
  });

  it('sem o segredo do banco não faz nada', async () => {
    h.s.configurado = false;
    h.s.reunioes = [reuniao(501)];
    expect((await tick()).motivo).toBe('sem_segredo');
    expect(h.s.estudos).toHaveLength(0);
  });

  it('EP_ESTUDO_AVISO_OFF e EP_ESTUDO_HISTORICO_OFF: estudo pronto, sem aviso e sem linha no CRM', async () => {
    process.env.EP_ESTUDO_AVISO_OFF = '1';
    process.env.EP_ESTUDO_HISTORICO_OFF = '1';
    h.s.reunioes = [reuniao(501)];
    await tick();
    expect(h.s.estudos[0].status).toBe('pronto');
    expect(h.s.enviados).toHaveLength(0);
    expect(h.s.historicos).toHaveLength(0);
  });
});

describe('ensaio e backfill', () => {
  it('dry não grava, não cria linha e não avisa', async () => {
    h.s.reunioes = [reuniao(501)];
    await h.banco.garantirLinha({ agendamentoId: 501, token: 'a'.repeat(64), origem: 'alerta' });
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('dry');
    expect(h.banco.salvar).not.toHaveBeenCalled();
    expect(h.s.estudos[0].status).toBe('pendente');
    expect(h.s.f.buscarLocal).not.toHaveBeenCalled();
    expect(h.s.enviados).toHaveLength(0);
  });

  it('dry com id devolve a prévia sem nome, telefone, rua ou coordenada', async () => {
    h.s.reunioes = [reuniao(501)];
    const r = await tick({ dry: true, id: 501 });
    expect(r.previa).toMatchObject({ status: 'pronto', confianca: 'alta', pre_nota: 100 });
    const txt = JSON.stringify(r);
    for (const proibido of ['Maria', 'Souza', 'Avenida Brasil', '988887777', String(CENTRO.latitude).slice(0, 6)]) {
      expect(txt).not.toContain(proibido);
    }
    expect(h.s.estudos).toHaveLength(0);
  });

  it('backfill cria as linhas com o aviso já carimbado e nunca manda WhatsApp', async () => {
    h.s.reunioes = [
      reuniao(501, { created_at: '2026-09-01T12:00:00Z' }),
      reuniao(502, { created_at: '2026-09-10T12:00:00Z' }),
      reuniao(503, { observacao: 'LP ELETROPOSTO · Academia\nPonto: Tenho um local em vista, mas ainda não conversei' }),
    ];
    expect((await tick({ backfill: true, dry: true })).ids).toEqual([501, 502]);
    const r = await tick({ backfill: true });
    expect(r.backfill).toBe(2);
    expect(h.s.estudos.every(e => e.origem === 'backfill' && e.aviso_enviado_em)).toBe(true);

    // A rede de segurança não pega fichas antigas: nascem antes do estudo entrar no ar.
    const t = await tick();
    expect(t.rede).toBe(0);
    expect(t.processados).toBe(2);
    expect(t.historicos).toBe(2);
    expect(sendWhatsApp).not.toHaveBeenCalled();
  });
});

describe('aviso de estudo pronto', () => {
  it('sai uma vez só, e só depois de um envio que deu certo', async () => {
    h.s.reunioes = [reuniao(501)];
    h.s.falharEnvio = true;
    const a = await tick();
    expect(a.avisos).toBe(0);
    expect(h.s.estudos[0].aviso_enviado_em).toBeNull();

    h.s.falharEnvio = false;
    expect((await tick()).avisos).toBe(1);
    expect((await tick()).avisos).toBe(0);
    expect(h.s.enviados).toHaveLength(1);
  });

  it('reunião a menos de 15 minutos: carimba sem avisar', async () => {
    h.s.reunioes = [reuniao(501, { quando: new Date(AGORA + 10 * 60_000).toISOString() })];
    await tick();
    expect(h.s.estudos[0].aviso_enviado_em).not.toBeNull();
    expect(h.s.enviados).toHaveLength(0);
  });

  it('texto do aviso e da linha do histórico', async () => {
    const reu = reuniao(501);
    const e = await montarEstudo(reu as any);
    const est = { id: 1, agendamento_id: 501, token: 'c'.repeat(64), dados: e.dados } as any;
    const aviso = montarAvisoPronto(est, reu as any);
    expect(aviso.split('\n').slice(0, 5)).toEqual([
      '*ESTUDO DO LOCAL PRONTO*',
      'Maria · Uberaba-MG · reunião ter 22/09 às 09h00',
      expect.stringMatching(/^Pré-nota 100 de 100 · Mercado \d,\d de 10 \(.+\)$/),
      'Endereço: conferido no Google',
      'Situação: PRONTO PARA A REUNIÃO',
    ]);
    expect(aviso).not.toContain('Souza');
    expect(aviso).not.toMatch(/[–—]/);
    expect(linhaDoHistorico(est, AGORA)).toMatch(/^\[20\/09 · 09:00 · Estudo\] Pré-nota 100 de 100, mercado/);
  });
});

describe('limpeza de 30 dias', () => {
  it('tira as coordenadas e a rua, e fica com place_id e agregados', async () => {
    h.s.reunioes = [reuniao(501)];
    await tick();
    Object.assign(h.s.estudos[0], { pronto_em: new Date(AGORA - 31 * 86400_000).toISOString() });
    const r = await tick();
    expect(r.limpos).toBe(1);
    const d = h.s.estudos[0].dados;
    expect(d.local).toMatchObject({ place_id: 'ChIJposto', lat: null, lng: null });
    expect(d.entorno.lista.every((i: any) => i.lat === null && i.lng === null)).toBe(true);
    expect(d.entorno.n).toBe(6);
    expect(d.rua).toBeNull();
    expect(h.s.estudos[0].coords_apagadas_em).not.toBeNull();
    expect(semCoordenadas({}).imagens).toEqual({ satelite_ok: false, rua_ok: false });
  });
});
