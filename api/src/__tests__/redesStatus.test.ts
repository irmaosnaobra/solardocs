import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Status em vídeo da 5040 (redes, fase 1): a ordem das conferências, o claim, os tetos, a janela, a primeira
// semana e o vídeo grande recusado sem chamar a Z-API. Banco, Z-API e rede são dublês.

const h = vi.hoisted(() => ({
  ordem: [] as string[],
  janelaDiurna: true,
  tetoHora: true,
  espaco: true,
  cooldown: false,
  diaRampa: null as null | 1 | 2 | 3,
  envio: null as null | ((video: string, legenda: string) => Promise<any>),
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./redesBancoFalso')).supabaseFalso }));
vi.mock('../services/agents/zapiClient', () => ({
  linhaEmCooldown: vi.fn(() => { h.ordem.push('cooldown'); return h.cooldown; }),
  sendVideoStatus: vi.fn(async (v: string, l: string) => { h.ordem.push('envio'); return h.envio ? h.envio(v, l) : { zaapId: 'Z1', messageId: 'M1' }; }),
  solardocViaIo: () => false,
}));
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDaJanelaDiurna: vi.fn(() => { h.ordem.push('janela'); return h.janelaDiurna; }),
  dentroDoTetoHorarioLinha: vi.fn(async () => { h.ordem.push('tetoHora'); return h.tetoHora; }),
  respeitaEspacamentoLinha: vi.fn(async () => { h.ordem.push('espaco'); return h.espaco; }),
  diaDaRampaReconexao: vi.fn(async () => { h.ordem.push('rampa'); return h.diaRampa; }),
}));

import { banco, chaves, valorDe } from './redesBancoFalso';
import { sendVideoStatus } from '../services/agents/zapiClient';
import { publicarStatus, situacaoStatus, erroDefinitivoZapi, tetoDoDia } from '../services/gerador/redes/statusIo';

const BASE = 'https://x.supabase.co/storage/v1/object/public/redes-videos/2026/10/';
const video = (nome: string) => `${BASE}${nome}.mp4`;
const QUINTA = new Date('2026-10-15T15:00:00Z');    // 12h em Brasília, primeira semana
const SEGUNDA = new Date('2026-10-26T15:00:00Z');   // 12h em Brasília, depois da primeira semana
const mais = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000);

let tamanho = 5_000_000;
let headFalha = false;
const fetchMock = vi.fn(async (url: string) => {
  h.ordem.push('video');
  if (headFalha) throw new Error('rede');
  return {
    ok: true, status: 200,
    headers: new Headers({ 'content-length': String(tamanho), 'content-type': 'video/mp4', etag: `"${String(url).split('/').pop()}"` }),
  } as unknown as Response;
});

function linhaDePe(agora: Date): void {
  banco.tabelas.system_state = (banco.tabelas.system_state ?? []).filter(r => r.key !== 'zapi_io_health');
  banco.tabelas.system_state.push({ key: 'zapi_io_health', value: { downStreak: 0, ultimaConexao: agora.toISOString() }, updated_at: agora.toISOString() });
}

/** Um status que de fato saiu há 8 dias: é ele que acaba com a primeira semana (168 h) e libera os 3 por dia. */
function semearAntigo(agora: Date, estado = 'enviado', dias = 8): void {
  const em = new Date(agora.getTime() - dias * 24 * 3600_000);
  (banco.tabelas.system_state ??= []).push({
    key: `status_io_sent:${em.toISOString().slice(0, 10)}:1`, value: { estado, em: em.toISOString(), video_hash: 'antigo' }, updated_at: em.toISOString(),
  });
}

const pedir = (nome: string, agora: Date, extra: Record<string, unknown> = {}) =>
  publicarStatus({ video_url: video(nome), legenda: 'Oi', por: 'thiago', agora, ...extra });

beforeEach(() => {
  banco.reiniciar();
  Object.assign(h, { ordem: [], janelaDiurna: true, tetoHora: true, espaco: true, cooldown: false, diaRampa: null, envio: null });
  tamanho = 5_000_000; headFalha = false;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.REDES_STATUS_5040_LIGADO = '1';
  delete process.env.REDES_STATUS_TETO_DIA;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  vi.mocked(sendVideoStatus).mockClear();
  linhaDePe(QUINTA);
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.REDES_STATUS_5040_LIGADO; });

describe('status da 5040: chave, entrada e ordem das conferências', () => {
  it('sem a env nada sai: 403, nenhuma leitura de vídeo e nenhuma chamada à Z-API', async () => {
    delete process.env.REDES_STATUS_5040_LIGADO;
    const r = await pedir('a', QUINTA);
    expect(r).toMatchObject({ ok: false, http: 403, motivo: 'chave_desligada' });
    expect(sendVideoStatus).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chaves(banco, 'status_io')).toEqual([]);
  });

  it('legenda que não é texto ou passa de 900 caracteres: 400 antes de tudo', async () => {
    expect((await pedir('a', QUINTA, { legenda: ['oi'] })).http).toBe(400);
    expect((await pedir('a', QUINTA, { legenda: 'x'.repeat(901) })).http).toBe(400);
    expect(h.ordem).toEqual([]);
  });

  it('a ordem: linha de pé, vídeo, janela, teto, teto horário, espaçamento, claim, envio (o claim já existe quando o envio roda)', async () => {
    let carimboNoEnvio: string[] = [];
    h.envio = async () => { carimboNoEnvio = chaves(banco, 'status_io_sent:'); return { zaapId: 'Z9', messageId: 'M9' }; };
    const r = await pedir('a', QUINTA);
    expect(r).toMatchObject({ ok: true, http: 200, motivo: 'pedido_aceito' });
    // A linha: monitor lido do banco (não aparece na ordem), cooldown e rampa; depois o vídeo, e só então as regras da linha.
    expect(h.ordem).toEqual(['cooldown', 'rampa', 'video', 'janela', 'rampa', 'tetoHora', 'espaco', 'rampa', 'envio']);
    expect(carimboNoEnvio).toEqual(['status_io_sent:2026-10-15:1']);
    expect(sendVideoStatus).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendVideoStatus).mock.calls[0]).toEqual([video('a'), 'Oi']);
    expect(valorDe(banco, 'status_io_sent:2026-10-15:1')).toMatchObject({ estado: 'enviado', messageId: 'M9', zaapId: 'Z9', por: 'thiago' });
  });

  it('linha caída, sem leitura nova do monitor ou em cooldown: recusa e NÃO abre o vídeo nem chama a Z-API', async () => {
    banco.tabelas.system_state = banco.tabelas.system_state!.filter(r => r.key !== 'zapi_io_health');
    banco.tabelas.system_state.push({ key: 'zapi_io_health', value: { downStreak: 2 }, updated_at: QUINTA.toISOString() });
    expect(await pedir('a', QUINTA)).toMatchObject({ ok: false, motivo: 'linha_fora' });
    banco.tabelas.system_state = banco.tabelas.system_state.filter(r => r.key !== 'zapi_io_health');
    expect(await pedir('a', QUINTA)).toMatchObject({ ok: false, motivo: 'linha_fora' });     // desconhecida também recusa
    linhaDePe(QUINTA); h.cooldown = true;
    expect(await pedir('a', QUINTA)).toMatchObject({ ok: false, motivo: 'linha_cooldown' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendVideoStatus).not.toHaveBeenCalled();
    expect(chaves(banco, 'status_io')).toEqual([]);
  });

  it('nunca no 1º dia depois de reconectar', async () => {
    h.diaRampa = 1;
    expect(await pedir('a', QUINTA)).toMatchObject({ ok: false, motivo: 'linha_reconectou_hoje' });
    expect(sendVideoStatus).not.toHaveBeenCalled();
  });

  it('vídeo de 12 MB é recusado na validação, SEM chamar a Z-API e sem claim; a linha segue fora de cooldown', async () => {
    tamanho = 12 * 1024 * 1024;
    const r = await pedir('grande', QUINTA);
    expect(r).toMatchObject({ ok: false, http: 400, motivo: 'video_grande' });
    expect(sendVideoStatus).not.toHaveBeenCalled();
    expect(chaves(banco, 'status_io')).toEqual([]);
    const { linhaEmCooldown } = await import('../services/agents/zapiClient');
    expect(linhaEmCooldown('io')).toBe(false);
  });

  it('vídeo que não é nosso, que não é mp4 ou que não responde também é recusado antes da Z-API', async () => {
    expect((await publicarStatus({ video_url: 'https://outro.com/v.mp4', legenda: '', por: 'thiago', agora: QUINTA })).motivo).toBe('video_de_fora');
    expect((await publicarStatus({ video_url: `${BASE}a.mov`, legenda: '', por: 'thiago', agora: QUINTA })).motivo).toBe('formato');
    headFalha = true;
    expect((await pedir('b', QUINTA)).motivo).toBe('video_nao_responde');
    expect(sendVideoStatus).not.toHaveBeenCalled();
  });
});

describe('status da 5040: janela, tetos e claim', () => {
  it('fora da janela (domingo, ou a janela diurna da linha fechada): recusa antes do claim, com a hora em que abre', async () => {
    const domingo = new Date('2026-10-18T15:00:00Z');
    linhaDePe(domingo);
    const r = await pedir('a', domingo);
    expect(r).toMatchObject({ ok: false, motivo: 'fora_da_janela' });
    expect(r.abre_em).toBe('2026-10-19T12:00:00.000Z');
    linhaDePe(QUINTA); h.janelaDiurna = false;
    expect((await pedir('a', QUINTA)).motivo).toBe('fora_da_janela');
    expect(chaves(banco, 'status_io')).toEqual([]);
  });

  it('teto horário e espaçamento da linha recusam sem claim', async () => {
    h.tetoHora = false;
    expect((await pedir('a', QUINTA)).motivo).toBe('teto_da_linha');
    h.tetoHora = true; h.espaco = false;
    expect((await pedir('a', QUINTA)).motivo).toBe('espacamento_da_linha');
    expect(chaves(banco, 'status_io')).toEqual([]);
    expect(sendVideoStatus).not.toHaveBeenCalled();
  });

  it('primeira semana: 1 por dia (o 2º, mesmo 3 h depois, bate no teto); a env só baixa', async () => {
    expect((await pedir('a', QUINTA)).ok).toBe(true);
    linhaDePe(mais(QUINTA, 3));
    const r = await pedir('b', mais(QUINTA, 3));
    expect(r).toMatchObject({ ok: false, motivo: 'teto_do_dia' });
    expect(chaves(banco, 'status_io_sent:')).toEqual(['status_io_sent:2026-10-15:1']);
  });

  it('depois da primeira semana: 3 por dia, 2 h entre status; o 4º recusa', async () => {
    linhaDePe(SEGUNDA); semearAntigo(SEGUNDA);
    expect((await pedir('a', SEGUNDA)).ok).toBe(true);
    // 1 h depois: ainda não passaram 2 h. A recusa vem ANTES do claim: nem por um instante grava carimbo, vídeo ou faixa.
    linhaDePe(mais(SEGUNDA, 1));
    let inserts = 0;
    banco.falha = (_t, op) => { if (op === 'insert' || op === 'upsert') inserts++; return null; };
    expect(await pedir('b', mais(SEGUNDA, 1))).toMatchObject({ ok: false, motivo: 'espacamento_entre_status' });
    expect(inserts).toBe(0);
    banco.falha = null;
    expect(chaves(banco, 'status_io_sent:2026-10-26')).toEqual(['status_io_sent:2026-10-26:1']);
    expect(chaves(banco, 'status_io_video:')).toHaveLength(1);
    linhaDePe(mais(SEGUNDA, 2.5));
    expect((await pedir('b', mais(SEGUNDA, 2.5))).ok).toBe(true);
    linhaDePe(mais(SEGUNDA, 5));
    expect((await pedir('c', mais(SEGUNDA, 5))).ok).toBe(true);
    linhaDePe(mais(SEGUNDA, 7.5));
    const quarto = await pedir('d', mais(SEGUNDA, 7.5));
    expect(quarto).toMatchObject({ ok: false, motivo: 'teto_do_dia' });
    expect(chaves(banco, 'status_io_sent:2026-10-26')).toHaveLength(3);
    expect(sendVideoStatus).toHaveBeenCalledTimes(3);
  });

  it('dias 2 e 3 da rampa de reconexão: 1 por dia', async () => {
    h.diaRampa = 2;
    linhaDePe(SEGUNDA);
    expect((await pedir('a', SEGUNDA)).ok).toBe(true);
    linhaDePe(mais(SEGUNDA, 3));
    expect((await pedir('b', mais(SEGUNDA, 3))).motivo).toBe('teto_do_dia');
  });

  it('a env REDES_STATUS_TETO_DIA só baixa o teto', async () => {
    linhaDePe(SEGUNDA); semearAntigo(SEGUNDA);
    process.env.REDES_STATUS_TETO_DIA = '0';
    expect((await pedir('a', SEGUNDA)).motivo).toBe('teto_do_dia');
    process.env.REDES_STATUS_TETO_DIA = '9';
    expect((await pedir('a', SEGUNDA)).ok).toBe(true);
  });

  it('dois vídeos DIFERENTES clicados juntos: só um sai (o insert e a troca com versão seguram)', async () => {
    linhaDePe(SEGUNDA); semearAntigo(SEGUNDA);
    const [x, y] = await Promise.all([pedir('x', SEGUNDA), pedir('y', SEGUNDA)]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(sendVideoStatus).toHaveBeenCalledTimes(1);
    expect(chaves(banco, 'status_io_sent:2026-10-26')).toHaveLength(1);
  });

  it('o mesmo vídeo duas vezes: o 2º recusa e a contagem fica igual', async () => {
    linhaDePe(SEGUNDA); semearAntigo(SEGUNDA);
    expect((await pedir('a', SEGUNDA)).ok).toBe(true);
    const antes = chaves(banco, 'status_io_').length;
    linhaDePe(mais(SEGUNDA, 3));
    expect(await pedir('a', mais(SEGUNDA, 3))).toMatchObject({ ok: false, http: 409, motivo: 'mesmo_video' });
    expect(chaves(banco, 'status_io_').length).toBe(antes);
    expect(sendVideoStatus).toHaveBeenCalledTimes(1);
  });

  it('falha de leitura do banco fecha: nada é enviado', async () => {
    banco.falha = (t, op) => (t === 'system_state' && op === 'insert' ? 'XX000' : null);
    const r = await pedir('a', QUINTA);
    expect(r).toMatchObject({ ok: false, motivo: 'erro_livro' });
    expect(sendVideoStatus).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain('SECRETO');
  });
});

describe('status da 5040: a primeira semana são 168 h contadas do primeiro status que saiu', () => {
  it('sem nenhum carimbo enviado vale 1 por dia; reservado (que não saiu) não conta; com leitura falha vale 1', async () => {
    expect(await tetoDoDia(SEGUNDA.getTime())).toBe(1);
    semearAntigo(SEGUNDA, 'reservado', 20);
    expect(await tetoDoDia(SEGUNDA.getTime())).toBe(1);
    banco.reiniciar(); semearAntigo(SEGUNDA, 'enviado', 8);
    banco.falha = (t, op) => (t === 'system_state' && op === 'select' ? 'XX000' : null);
    expect(await tetoDoDia(SEGUNDA.getTime())).toBe(1);
  });

  it('com carimbo enviado (ou incerto) de 8 dias vale 3; de 6 dias, 1; conta o MAIS ANTIGO', async () => {
    semearAntigo(SEGUNDA, 'enviado', 8);
    expect(await tetoDoDia(SEGUNDA.getTime())).toBe(3);
    banco.reiniciar(); semearAntigo(SEGUNDA, 'incerto', 8);
    expect(await tetoDoDia(SEGUNDA.getTime())).toBe(3);
    banco.reiniciar(); semearAntigo(SEGUNDA, 'enviado', 6);
    expect(await tetoDoDia(SEGUNDA.getTime())).toBe(1);
    semearAntigo(SEGUNDA, 'enviado', 10);                  // o mais antigo manda, mesmo com outro mais novo
    expect(await tetoDoDia(SEGUNDA.getTime())).toBe(3);
  });

  it('a data não está escrita no código: não existe mais primeiraSemanaDesde', async () => {
    const { REGRAS_REDES } = await import('../services/chefe/regulamento');
    expect(Object.keys(REGRAS_REDES.status)).not.toContain('primeiraSemanaDesde');
    expect(REGRAS_REDES.status.primeiraSemanaHoras).toBe(168);
  });
});

describe('status da 5040: o que a Z-API responde', () => {
  it('classifica: 4xx, cooldown e credencial ausente são definitivos; 5xx, 408 e rede são incertos', () => {
    expect(erroDefinitivoZapi('[zapi:io] HTTP 400 - bad')).toBe(true);
    expect(erroDefinitivoZapi('[zapi:io] HTTP 429 - slow')).toBe(true);
    expect(erroDefinitivoZapi('[zapi:io] em cooldown (instância indisponível há <60s) - pulando envio')).toBe(true);
    expect(erroDefinitivoZapi('[zapi:io] credenciais Z-API ausentes (verifique)')).toBe(true);
    expect(erroDefinitivoZapi('[zapi:io] HTTP 502 - x')).toBe(false);
    expect(erroDefinitivoZapi('[zapi:io] HTTP 408 - x')).toBe(false);
    expect(erroDefinitivoZapi('fetch failed')).toBe(false);
  });

  it('erro definitivo apaga o claim (carimbo, vídeo e as 2 h); o status pode ser pedido de novo', async () => {
    h.envio = async () => { throw new Error('[zapi:io] HTTP 400 - video invalido'); };
    const r = await pedir('a', QUINTA);
    expect(r).toMatchObject({ ok: false, motivo: 'zapi_recusou' });
    expect(chaves(banco, 'status_io')).toEqual([]);
    expect(chaves(banco, 'redes_status_ultimo')).toEqual([]);
    h.envio = null;
    expect((await pedir('a', QUINTA)).ok).toBe(true);
  });

  it('429 da Z-API apaga o carimbo e o vídeo, mas MANTÉM as 2 h: o clique não volta já', async () => {
    h.envio = async () => { throw new Error('[zapi:io] HTTP 429 - devagar'); };
    expect(await pedir('a', QUINTA)).toMatchObject({ ok: false, motivo: 'zapi_recusou' });
    expect(chaves(banco, 'status_io_sent:')).toEqual([]);
    expect(chaves(banco, 'status_io_video:')).toEqual([]);
    expect(chaves(banco, 'redes_status_ultimo')).toEqual(['redes_status_ultimo']);
    h.envio = null;
    expect(await pedir('b', mais(QUINTA, 0.1))).toMatchObject({ ok: false, motivo: 'espacamento_entre_status' });
  });

  it('erro incerto (5xx) MANTÉM o claim e não tenta de novo: 202 com incerto', async () => {
    h.envio = async () => { throw new Error('[zapi:io] HTTP 502 - bad gateway'); };
    const r = await pedir('a', QUINTA);
    expect(r).toMatchObject({ ok: false, http: 202, motivo: 'zapi_incerto', incerto: true });
    expect(chaves(banco, 'status_io_sent:')).toEqual(['status_io_sent:2026-10-15:1']);
    expect(valorDe(banco, 'status_io_sent:2026-10-15:1').estado).toBe('incerto');
    expect(sendVideoStatus).toHaveBeenCalledTimes(1);
  });
});

describe('status da 5040: a tela de limites', () => {
  it('desligado, aberto, no teto do dia e dentro das 2 h dizem o que e quando', async () => {
    delete process.env.REDES_STATUS_5040_LIGADO;
    expect(await situacaoStatus(QUINTA.getTime())).toMatchObject({ ligado: false, pode: false, motivo: 'chave_desligada' });
    process.env.REDES_STATUS_5040_LIGADO = '1';
    expect(await situacaoStatus(QUINTA.getTime())).toMatchObject({ ligado: true, pode: true, hoje: { usados: 0, teto: 1 } });
    expect((await pedir('a', QUINTA)).ok).toBe(true);
    const depois = await situacaoStatus(QUINTA.getTime() + 60_000);
    expect(depois).toMatchObject({ pode: false, motivo: 'teto_do_dia', hoje: { usados: 1, teto: 1 } });
    expect(depois.abre_em).toBe('2026-10-16T03:00:00.000Z');
    linhaDePe(SEGUNDA); semearAntigo(SEGUNDA);
    const noDia3 = await situacaoStatus(SEGUNDA.getTime());
    expect(noDia3.hoje.teto).toBe(3);
  });
});
