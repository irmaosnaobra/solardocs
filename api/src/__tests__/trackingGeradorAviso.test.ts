import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Aviso ao consultor quando o cliente abre, clica no WhatsApp ou baixa o PDF. A trava mora no BANCO (reservar_aviso_consultor):
// a api só chama a RPC, cai na antiga se a nova não existir, e monta o texto. Banco, Z-API e geolocalização simulados.

const h = vi.hoisted(() => ({
  rpcs: [] as Array<[string, Record<string, unknown>]>,
  reserva: { data: null as unknown, error: null as null | { code?: string; message?: string } },
  antiga: { data: null as unknown, error: null as null | { code?: string; message?: string } },
  registro: { error: null as null | { message: string } },
  enviados: [] as Array<{ tel: string; msg: string; linha: unknown }>,
}));

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    rpc: vi.fn(async (nome: string, args: Record<string, unknown>) => {
      h.rpcs.push([nome, args]);
      if (nome === 'registrar_acesso_ev') return { data: null, error: h.registro.error };
      if (nome === 'reservar_aviso_consultor') return { data: h.reserva.data, error: h.reserva.error };
      if (nome === 'pode_notificar_consultor') return { data: h.antiga.data, error: h.antiga.error };
      throw new Error(`rpc inesperada: ${nome}`);
    }),
  },
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (tel: string, msg: string, linha: unknown) => { h.enviados.push({ tel, msg, linha }); return { ok: true }; }),
}));

import { registrarEventoGerador, trackEvent, aparelhoDoUA, textoDoAviso } from '../controllers/trackingGeradorController';

const CEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const LINHA = { pode: true, consultor_telefone: '5534991516846', consultor_nome: 'Nilce', cliente_nome: 'Fabiano' };

beforeEach(() => {
  h.rpcs.length = 0; h.enviados.length = 0;
  h.reserva = { data: [{ ...LINHA }], error: null };
  h.antiga = { data: [{ ...LINHA }], error: null };
  h.registro = { error: null };
  // Sem IP, a geolocalização não chama a rede (geoFromIp devolve {}). Os testes de cidade trocam o fetch.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ev = (evento: string, extra: Record<string, unknown> = {}) =>
  registrarEventoGerador({ codigo: '202600951', evento, ip: '', userAgent: CEL, ...extra });
const chamou = (nome: string) => h.rpcs.filter(([n]) => n === nome);

describe('a trava no banco: reservar_aviso_consultor', () => {
  it('cada evento que avisa chama a RPC nova com o código e o tipo, e o evento é gravado antes', async () => {
    for (const tipo of ['abertura', 'abertura_expirada', 'click_wpp_cta', 'click_wpp_expirado']) {
      h.rpcs.length = 0; h.enviados.length = 0;
      expect((await ev(tipo)).ok).toBe(true);
      expect(h.rpcs.map(([n]) => n)).toEqual(['registrar_acesso_ev', 'reservar_aviso_consultor']);
      expect(h.rpcs[1][1]).toEqual({ p_codigo: '202600951', p_tipo: tipo });
      expect(h.enviados).toHaveLength(1);
      expect(h.enviados[0].tel).toBe('5534991516846');
      expect(h.enviados[0].linha).toBe('io');
    }
  });

  it('RPC nega (pode=false) ou volta vazia: o evento foi gravado e o WhatsApp NÃO sai', async () => {
    h.reserva.data = [{ ...LINHA, pode: false, consultor_telefone: null }];
    expect((await ev('abertura')).ok).toBe(true);
    h.reserva.data = [];
    await ev('abertura');
    expect(chamou('registrar_acesso_ev')).toHaveLength(2);
    expect(h.enviados).toHaveLength(0);
    expect(chamou('pode_notificar_consultor')).toHaveLength(0);
  });

  it('telefone curto ou ausente: não envia', async () => {
    h.reserva.data = [{ ...LINHA, consultor_telefone: '123' }];
    await ev('abertura');
    expect(h.enviados).toHaveLength(0);
  });

  it('função ausente (PGRST202 / 42883) ou sem permissão (42501): cai na pode_notificar_consultor antiga e avisa no log', async () => {
    for (const erro of [{ code: 'PGRST202', message: 'Could not find the function public.reservar_aviso_consultor' }, { code: '42883', message: 'function public.reservar_aviso_consultor(text, text) does not exist' }, { code: '42501', message: 'permission denied for function reservar_aviso_consultor' }]) {
      h.rpcs.length = 0; h.enviados.length = 0;
      h.reserva = { data: null, error: erro };
      await ev('abertura');
      expect(h.rpcs.map(([n]) => n)).toEqual(['registrar_acesso_ev', 'reservar_aviso_consultor', 'pode_notificar_consultor']);
      expect(h.rpcs[2][1]).toEqual({ p_codigo: '202600951' });
      expect(h.enviados).toHaveLength(1);
      expect(console.warn).toHaveBeenCalled();
    }
  });

  it('erro que NÃO é função ausente (timeout, banco fora, 42883 de outra função, 500): log de erro, nenhum aviso e nada de cair na antiga', async () => {
    for (const erro of [{ code: '57014', message: 'statement timeout' }, { code: '42883', message: 'function foo(text) does not exist' }, { code: 'XX000', message: 'internal error' }, { message: 'fetch failed' }]) {
      h.rpcs.length = 0; h.enviados.length = 0;
      h.reserva = { data: null, error: erro };
      expect((await ev('abertura')).ok).toBe(true);
      expect(chamou('pode_notificar_consultor')).toHaveLength(0);
      expect(h.enviados).toHaveLength(0);
      expect(console.error).toHaveBeenCalledWith('[notif] rpc error:', erro);
    }
  });

  it('o fallback também respeita o pode=false da antiga', async () => {
    h.reserva = { data: null, error: { code: 'PGRST202', message: 'x' } };
    h.antiga.data = [{ ...LINHA, pode: false }];
    await ev('abertura');
    expect(h.enviados).toHaveLength(0);
  });

  it('outro erro do banco (não é função ausente): não manda nada e não cai na antiga', async () => {
    h.reserva = { data: null, error: { code: '57014', message: 'statement timeout' } };
    expect((await ev('abertura')).ok).toBe(true);
    expect(chamou('pode_notificar_consultor')).toHaveLength(0);
    expect(h.enviados).toHaveLength(0);
  });

  it('a gravação do evento falhou: ok:false e nenhum aviso', async () => {
    h.registro.error = { message: 'caiu' };
    expect((await ev('abertura')).ok).toBe(false);
    expect(chamou('reservar_aviso_consultor')).toHaveLength(0);
    expect(h.enviados).toHaveLength(0);
  });

  it('a migration: grupos, tetos, lock, limpeza, RLS sem política e só service_role; a antiga fica intocada', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'MIGRATION_gerador_reserva_aviso.sql'), 'utf8');
    expect(sql).toMatch(/WHEN 'abertura' THEN 'abertura'/);
    expect(sql).toMatch(/WHEN 'abertura_expirada' THEN 'abertura'/);
    expect(sql).toMatch(/WHEN 'click_wpp_cta' THEN 'whatsapp'/);
    expect(sql).toMatch(/WHEN 'click_wpp_expirado' THEN 'whatsapp'/);
    expect(sql).toMatch(/WHEN 'click_pdf' THEN 'pdf'/);
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain("interval '30 minutes'");
    expect(sql).toMatch(/interval '1 hour'\) >= 12/);
    expect(sql).toMatch(/interval '10 minutes'\) >= 6/);
    expect(sql).toContain("interval '2 days'");
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    // Mesmo padrão da antiga (conferida em produção): anon, authenticated e service_role executam; a tabela só a função escreve.
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reservar_aviso_consultor\(text, text\) TO anon, authenticated, service_role/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.aviso_consultor_reserva FROM anon, authenticated/);
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON (TABLE )?public\.aviso_consultor_reserva/);
    // Telefone SÓ de consultores.whatsapp (sem cair em dados.consultorWhats) e buscado ANTES de reservar.
    const corpo = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.reservar_aviso_consultor'));
    expect(corpo).not.toContain("dados->>'consultorWhats'");
    expect(corpo.indexOf('FROM consultores c WHERE c.nome = v_consultor')).toBeGreaterThan(0);
    expect(corpo.indexOf('FROM consultores c WHERE c.nome = v_consultor')).toBeLessThan(corpo.indexOf('INSERT INTO aviso_consultor_reserva'));
    expect(corpo).toMatch(/IF v_tel IS NULL OR v_tel = ''/);
    expect(sql).not.toMatch(/(CREATE OR REPLACE|DROP) FUNCTION public\.pode_notificar_consultor/i);
  });
});

describe('click_pdf: só o GET /pdf de cliente avisa', () => {
  it('registrarEventoGerador com avisarPdf: avisa; sem ele: só registra', async () => {
    await ev('click_pdf');
    expect(chamou('registrar_acesso_ev')).toHaveLength(1);
    expect(chamou('reservar_aviso_consultor')).toHaveLength(0);
    expect(h.enviados).toHaveLength(0);
    await ev('click_pdf', { avisarPdf: true });
    expect(chamou('reservar_aviso_consultor')).toHaveLength(1);
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0].msg).toMatch(/^📄 \*Fabiano\* baixou o PDF da proposta agora/);
  });

  it('avisarPdf não vira aviso para outro evento que não avisa (click_wpp_consultor)', async () => {
    await ev('click_wpp_consultor', { avisarPdf: true });
    expect(h.enviados).toHaveLength(0);
  });

  const res = () => {
    const r: { status: number; body: unknown; status_: (n: number) => unknown } = { status: 200, body: null, status_: () => r };
    const o = { status: (n: number) => { r.status = n; return o; }, json: (b: unknown) => { r.body = b; return o; } };
    return { r, o: o as never };
  };

  it('o POST /track com click_pdf grava o evento e NUNCA avisa, mesmo mandando avisarPdf no corpo', async () => {
    const { r, o } = res();
    await trackEvent({ body: { codigo: '202600951', evento: 'click_pdf', avisarPdf: true }, headers: { 'user-agent': CEL }, socket: {} } as never, o);
    expect(r.status).toBe(200);
    expect(chamou('registrar_acesso_ev')).toHaveLength(1);
    expect(chamou('reservar_aviso_consultor')).toHaveLength(0);
    expect(h.enviados).toHaveLength(0);
  });

  it('o POST /track continua avisando abertura (comportamento de sempre)', async () => {
    const { o } = res();
    await trackEvent({ body: { codigo: '202600951', evento: 'abertura' }, headers: { 'user-agent': CEL }, socket: {} } as never, o);
    expect(h.enviados).toHaveLength(1);
  });
});

describe('texto do aviso', () => {
  it('aparelho pelo User-Agent', () => {
    expect(aparelhoDoUA(CEL)).toBe('pelo celular');
    expect(aparelhoDoUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('pelo celular');
    expect(aparelhoDoUA('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('pelo celular');
    expect(aparelhoDoUA(PC)).toBe('pelo computador');
    expect(aparelhoDoUA('')).toBe('pelo computador');
    expect(aparelhoDoUA(undefined)).toBe('pelo computador');
  });

  it('click_pdf: 1 bolha, emoji só na 1ª linha, com cidade/UF e aparelho', () => {
    const t = textoDoAviso('click_pdf', { cliente: 'Fabiano', codigo: '202600951', cidade: 'Uberlândia', uf: 'MG', userAgent: CEL });
    expect(t).toBe('📄 *Fabiano* baixou o PDF da proposta agora, em Uberlândia/MG, pelo celular.\n\nCódigo: 202600951');
  });

  it('sem cidade, só o trecho da cidade some', () => {
    expect(textoDoAviso('click_pdf', { cliente: 'Fabiano', codigo: '202600951', userAgent: PC }))
      .toBe('📄 *Fabiano* baixou o PDF da proposta agora, pelo computador.\n\nCódigo: 202600951');
    expect(textoDoAviso('abertura', { cliente: 'Fabiano', codigo: '202600951', userAgent: CEL }))
      .toBe('🟢 *Fabiano* abriu sua proposta agora, pelo celular.\n\nCódigo: 202600951');
  });

  it('nenhum texto tem travessão, e o emoji só aparece na 1ª linha', () => {
    for (const e of ['abertura', 'abertura_expirada', 'click_wpp_cta', 'click_wpp_expirado', 'click_pdf', 'outro']) {
      for (const ua of [CEL, PC]) {
        const t = textoDoAviso(e, { cliente: 'Fabiano', codigo: '202600951', cidade: 'Uberlândia', uf: 'MG', userAgent: ua });
        expect(t).not.toMatch(/[—–]/);
        expect(t).toMatch(/pelo (celular|computador)/);
        expect(t).toContain('Uberlândia/MG');
        const [primeira, ...resto] = t.split('\n');
        expect(primeira).toMatch(/\p{Extended_Pictographic}/u);
        expect(resto.join('\n')).not.toMatch(/\p{Extended_Pictographic}/u);
      }
    }
  });

  it('a mensagem sai pela geo: cidade e UF do IP entram no texto enviado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ status: 'success', city: 'Uberlândia', region: 'MG', country: 'Brazil' }) })));
    await registrarEventoGerador({ codigo: '202600951', evento: 'abertura_expirada', ip: '203.0.113.7', userAgent: PC });
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0].msg).toBe('⏰ *Fabiano* abriu a proposta 202600951, em Uberlândia/MG, pelo computador, mas ela já estava vencida e ele viu a tela de expirado. Vale refazer e reenviar.');
    expect(h.enviados[0].msg).not.toMatch(/[—–]/);
  });
});
