import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Os três estados que o robô grava no `fazendo`: o aviso sai só na TROCA de estado, o PARADO
// vai também por e-mail, e a falha de um canal não derruba o outro. Tudo de mentira.

const h = vi.hoisted(() => ({
  estado: new Map<string, any>(),
  pulso: [] as any[],
  zap: vi.fn(),
  email: vi.fn(),
  falharGravar: false,
}));

function tabelaSystemState() {
  const q: any = { _chave: '' };
  q.select = () => q;
  q.eq = (_c: string, v: string) => { q._chave = v; return q; };
  q.maybeSingle = async () => ({ data: h.estado.has(q._chave) ? { value: h.estado.get(q._chave) } : null, error: null });
  q.upsert = async (row: any) => {
    if (h.falharGravar) return { error: { message: 'sem gravar' } };
    h.estado.set(row.key, row.value); return { error: null };
  };
  q.insert = async (row: any) => { h.estado.set(row.key, row.value); return { error: null }; };
  return q;
}

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => (t === 'system_state' ? tabelaSystemState() : { select: () => ({ order: async () => ({ data: [] }) }) }) } }));
vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: { from: () => ({ select: () => ({ order: async () => ({ data: h.pulso, error: null }) }) }) },
}));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/agents/zapiClient', async (orig) => ({ ...(await orig<any>()), sendWhatsApp: (...a: unknown[]) => h.zap(...a) }));
vi.mock('../utils/mailer', async (orig) => ({ ...(await orig<any>()), sendOpsAlert: (...a: unknown[]) => h.email(...a) }));

import cronRouter from '../routes/cron';
import { estadoDoRobo, avisarTrocaDeEstado, textoDoAviso } from '../services/io/prospeccaoEstadoAviso';

const app = express();
app.use('/cron', cronRouter);

const chamar = () => request(app).get('/cron/prospeccao-pulso').set('Authorization', `Bearer ${process.env.CRON_SECRET}`);
const pulso = (fazendo: string) => {
  h.pulso = [{ id: 1, canal: 'instagram', ativo: true, batido_em: new Date().toISOString(), logado: true, fazendo, enviados_hoje: 3, ciclo: 1 }];
};

beforeEach(() => {
  process.env.CRON_SECRET = 'segredo-de-teste-cron';
  h.estado.clear(); h.pulso = []; h.falharGravar = false;
  h.zap.mockReset().mockResolvedValue(undefined);
  h.email.mockReset().mockResolvedValue(undefined);
});

describe('os três estados do robô', () => {
  it('só os prefixos exatos, no começo, são reconhecidos', () => {
    expect(estadoDoRobo('VOLTOU SOZINHO: o Instagram abriu')?.id).toBe('voltou');
    expect(estadoDoRobo('TRAVOU DE NOVO: de novo')?.id).toBe('travou');
    expect(estadoDoRobo('PARADO ATÉ VOCÊ LIBERAR: três travas')?.id).toBe('parado');
    expect(estadoDoRobo('DESTRAVOU')).toBeNull();
    expect(estadoDoRobo('parado até você liberar: x')).toBeNull();
    expect(estadoDoRobo('Olhando a caixa. PARADO ATÉ VOCÊ LIBERAR:')).toBeNull();
    expect(estadoDoRobo(null)).toBeNull();
  });

  it('o texto: uma linha clara, no PARADO diz o que fazer, sem travessão e sem emoji', () => {
    for (const f of ['VOLTOU SOZINHO: ok — voltou', 'TRAVOU DE NOVO: x', 'PARADO ATÉ VOCÊ LIBERAR: y']) {
      const { linhas, assunto } = textoDoAviso(estadoDoRobo(f)!, 'Instagram');
      const todo = [assunto, ...linhas].join('\n');
      expect(todo).not.toMatch(/[—–]/);
      expect(todo).not.toMatch(/\p{Extended_Pictographic}/u);
      for (const l of linhas) expect(l[0]).toBe(l[0].toUpperCase());
    }
    const parado = textoDoAviso(estadoDoRobo('PARADO ATÉ VOCÊ LIBERAR: y')!, 'Instagram').linhas.join('\n');
    expect(parado).toContain('crie um arquivo vazio LIBERAR-INSTAGRAM.txt na pasta worker-prospeccao');
  });

  it('troca de estado avisa UMA vez; o mesmo estado nas batidas seguintes não repete', async () => {
    pulso('VOLTOU SOZINHO: o Instagram abriu');
    await chamar(); await chamar(); await chamar();
    expect(h.zap).toHaveBeenCalledTimes(1);
    expect(h.zap.mock.calls[0][1]).toContain('voltou sozinha');
    expect(h.zap.mock.calls[0][2]).toBe('io');            // o mesmo caminho do aviso "A agente parou"
    expect(h.email).not.toHaveBeenCalled();               // só o PARADO vai por e-mail

    pulso('TRAVOU DE NOVO: travou');                      // trocou de estado: avisa de novo
    await chamar(); await chamar();
    expect(h.zap).toHaveBeenCalledTimes(2);
    expect(h.zap.mock.calls[1][1]).toContain('travou de novo');
  });

  it('voltar ao normal zera o último estado: um novo incidente do mesmo tipo avisa de novo', async () => {
    pulso('PARADO ATÉ VOCÊ LIBERAR: x');
    await chamar();
    pulso('Olhando a caixa de entrada');
    await chamar();
    expect(h.zap).toHaveBeenCalledTimes(1);               // normal não avisa nada
    pulso('PARADO ATÉ VOCÊ LIBERAR: x');
    await chamar();
    expect(h.zap).toHaveBeenCalledTimes(2);
  });

  it('PARADO manda WhatsApp e e-mail de sistema (uma vez cada)', async () => {
    pulso('PARADO ATÉ VOCÊ LIBERAR: três travas seguidas');
    await chamar(); await chamar();
    expect(h.zap).toHaveBeenCalledTimes(1);
    expect(h.email).toHaveBeenCalledTimes(1);
    expect(h.email.mock.calls[0][0]).toContain('parou');
    expect(h.email.mock.calls[0][1]).toContain('LIBERAR-INSTAGRAM.txt');
    expect(h.zap.mock.calls[0][1]).toContain('LIBERAR-INSTAGRAM.txt');
  });

  it('falha do e-mail não derruba o WhatsApp, e a rota segue devolvendo 200', async () => {
    h.email.mockRejectedValue(new Error('Resend fora'));
    pulso('PARADO ATÉ VOCÊ LIBERAR: x');
    const res = await chamar();
    expect(res.status).toBe(200);
    expect(h.zap).toHaveBeenCalledTimes(1);
    expect(h.email).toHaveBeenCalledTimes(1);
  });

  it('falha do WhatsApp não impede o e-mail do PARADO', async () => {
    h.zap.mockRejectedValue(new Error('Z-API fora'));
    pulso('PARADO ATÉ VOCÊ LIBERAR: x');
    const res = await chamar();
    expect(res.status).toBe(200);
    expect(h.email).toHaveBeenCalledTimes(1);
  });

  it('sem conseguir gravar o último estado avisado, não avisa (senão repetiria a cada rodada)', async () => {
    h.falharGravar = true;
    pulso('VOLTOU SOZINHO: x');
    await chamar(); await chamar();
    expect(h.zap).not.toHaveBeenCalled();
  });

  it('o serviço sozinho: mesmo estado = nada; só o Instagram entra pela rota', async () => {
    const deps = { supabase: { from: () => tabelaSystemState() }, enviarWhatsApp: vi.fn(async () => {}), enviarEmail: vi.fn(async () => {}) };
    expect((await avisarTrocaDeEstado('instagram', 'Instagram', 'VOLTOU SOZINHO: x', deps)).acao).toBe('avisou');
    expect((await avisarTrocaDeEstado('instagram', 'Instagram', 'VOLTOU SOZINHO: x', deps)).acao).toBe('nada');
    expect(deps.enviarWhatsApp).toHaveBeenCalledTimes(1);

    h.pulso = [{ id: 2, canal: 'whatsapp', ativo: true, batido_em: new Date().toISOString(), logado: true, fazendo: 'PARADO ATÉ VOCÊ LIBERAR: x' }];
    h.estado.clear(); h.zap.mockClear();
    await chamar();
    expect(h.zap).not.toHaveBeenCalled();
  });

  it('nenhum aviso novo fora dos três estados: batida comum não manda nada', async () => {
    pulso('Olhando a caixa de entrada');
    await chamar();
    expect(h.zap).not.toHaveBeenCalled();
    expect(h.email).not.toHaveBeenCalled();
  });
});
