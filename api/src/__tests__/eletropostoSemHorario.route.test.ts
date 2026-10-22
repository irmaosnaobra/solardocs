import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// O RECADO DE "SEM HORÁRIO" (22/10/2026) E O DONO DO CLIENTE ANTIGO.
//
// 1. POST /nota1 com `sem_horario: true`: grava a ficha e pede UM recado à equipe, com a trava
//    do chefe anti-ban no SERVIDOR. O que este arquivo prende:
//      · a marca do telefone é gravada ANTES de qualquer envio, e antes da saída de `teste`;
//      · o segundo POST do mesmo telefone não envia;
//      · envio que falha devolve a marca (e a tentativa seguinte envia);
//      · linha em cooldown: não envia, não gasta vaga, devolve a marca;
//      · 1 recado por balde de 10 minutos e 24 por dia; acima disso só grava;
//      · `key` sem unicidade no banco: mais de uma linha com a chave da vaga vale como sem vaga;
//      · system_state fora do ar: não manda (a trava fecha);
//      · `ja_gravado: true` não grava a ficha de novo;
//      · a resposta traz `aviso` (a LP só diz "a equipe vai te chamar" com enviado/ja_avisado);
//      · sem a flag, nada muda (nenhuma mensagem, nenhuma escrita em system_state).
// 2. O texto do recado tem tamanho fechado e nenhum texto livre vindo da internet.
// 3. GET /cliente: dono fora de DONOS_EP (Nilce, Giovanna) volta null.
// Banco e WhatsApp são simulados: nada aqui toca rede.

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  ops: [] as string[],
  insertErro: false,
  insertErroPrefixo: '' as string,
  semUnicidade: false,
  duplicadas: new Set<string>(),
  cooldown: false,
  enviar: vi.fn(),
  agendamentos: [] as Array<Record<string, unknown>>,
  notas: [] as Array<Record<string, unknown>>,
  notaFalha: false,
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (_tabela: string) => ({
      select: () => ({
        eq: (_c: string, key: string) => {
          const linhas = () => {
            const n = h.duplicadas.has(key) ? 2 : h.store.has(key) ? 1 : 0;
            return Array.from({ length: n }, () => ({ key }));
          };
          return {
            maybeSingle: async () => ({ data: h.store.has(key) ? { key } : null, error: null }),
            then: (ok: (v: unknown) => void) => ok({ data: linhas(), error: null }),
          };
        },
        like: (_c: string, padrao: string) => {
          h.ops.push('like:' + padrao);
          const prefixo = padrao.replace(/%$/, '');
          return {
            then: (ok: (v: unknown) => void) =>
              ok({ data: [...h.store.keys()].filter(k => k.startsWith(prefixo)).map(key => ({ key })), error: null }),
          };
        },
      }),
      insert: async (row: { key: string; value: string }) => {
        h.ops.push('insert:' + row.key);
        if (h.insertErro) return { error: { code: 'XX000' } };
        if (h.insertErroPrefixo && row.key.startsWith(h.insertErroPrefixo)) return { error: { code: 'XX000' } };
        if (h.store.has(row.key)) {
          if (h.semUnicidade) { h.duplicadas.add(row.key); return { error: null }; }
          return { error: { code: '23505' } };
        }
        h.store.set(row.key, row.value);
        return { error: null };
      },
      delete: () => ({
        eq: async (_c: string, key: string) => { h.ops.push('delete:' + key); h.store.delete(key); return { error: null }; },
      }),
    }),
  },
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: (...a: unknown[]) => { h.ops.push('envio'); return h.enviar(...a); },
  linhaEmCooldown: () => h.cooldown,
}));
vi.mock('../services/agents/whatsapp/silenciar', () => ({ estaBloqueado: vi.fn(async () => false) }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ extraDoCard: vi.fn(), garantirEstudo: vi.fn() }));
vi.mock('../services/io/eletropostoPares', () => ({
  blocoParesSeguro: vi.fn().mockResolvedValue([]), pool: vi.fn(), montarPares: vi.fn(), MAX_PARES: 3, TETO_KM: 100,
}));
vi.mock('../services/io/eletropostoGeo', () => ({ geocodificarLote: vi.fn() }));
vi.mock('../middleware/rateLimiter', () => ({ geoLimiter: (_q: unknown, _r: unknown, n: () => void) => n(), funilEletropostoLimiter: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => {
  const cadeia = (tabela: string) => {
    const c: any = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'then') return (ok: (v: unknown) => void) => ok({ data: tabela === 'agendamentos' ? h.agendamentos : [], error: null });
        if (k === 'single') return () => Promise.resolve(h.notaFalha
          ? { data: null, error: { message: 'banco fora' } }
          : { data: { id: 9 }, error: null });
        return (...a: unknown[]) => {
          if (k === 'insert' && tabela === 'eletroposto_nota1') h.notas.push(a[0] as Record<string, unknown>);
          return c;
        };
      },
    });
    return c;
  };
  return { supabaseGerador: { from: (t: string) => cadeia(t) } };
});

import router, {
  EQUIPE, TETO_SEM_HORARIO_POR_DIA, TAMANHO_MAX_AVISO_SEM_HORARIO, chaveAvisoSemHorario, chaveVagaSemHorario,
  baldeDeBrasilia, diaDeBrasilia, montarAvisoSemHorario, donoDoCliente,
} from '../routes/ioEletroposto';
import { DONOS_EP } from '../services/io/eletropostoCard';

const app = express();
app.use(express.json());
app.use('/io/eletroposto', router);

const FICHA = ['LP ELETROPOSTO · Compra de carregador', 'VENDA DE EQUIPAMENTO', 'Potência: 120 kW', 'Ponto: Já tenho o ponto definido'].join('\n');
const corpo = (o: Record<string, unknown> = {}) => ({
  nome: 'Carlos Lima', telefone: '5534991113333', cidade: 'Uberlândia-MG', perfil: 'Compra de carregador',
  ficha: FICHA, sem_horario: true, motivo: 'lista_vazia', caminho: 'carregador', ...o,
});
const postar = (o: Record<string, unknown> = {}) => request(app).post('/io/eletroposto/nota1').send(corpo(o));
const envios = () => h.ops.filter(o => o === 'envio').length;
const NUM_EQUIPE = Object.keys(EQUIPE).length;
/** Relógio de Brasília: só o Date é simulado (os timers reais seguem, o supertest precisa deles). */
const AGORA = '2026-10-22T15:03:00Z';                 // 12h03 em Brasília, balde '2026-10-22 12:0'
const relogio = (iso: string) => vi.setSystemTime(new Date(iso));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  relogio(AGORA);
  h.store.clear(); h.ops.length = 0; h.notas.length = 0; h.agendamentos.length = 0; h.duplicadas.clear();
  h.insertErro = false; h.insertErroPrefixo = ''; h.semUnicidade = false; h.cooldown = false; h.notaFalha = false;
  h.enviar.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('POST /nota1 com sem_horario: a ficha é gravada e UM recado sai, com a trava no servidor', () => {
  it('grava a ficha, manda o recado para cada número da equipe e diz aviso: enviado', async () => {
    const r = await postar();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, id: 9, aviso: 'enviado' });
    expect(h.notas).toHaveLength(1);
    expect(h.notas[0]).toMatchObject({ telefone: '5534991113333', ficha: FICHA });
    expect(envios()).toBe(NUM_EQUIPE);
    const msg = String(h.enviar.mock.calls[0][1]);
    expect(msg).toContain('wa.me/5534991113333');
    expect(msg).toContain('Compra de carregador');
    expect(msg).not.toContain('Potência: 120 kW');   // a ficha em texto livre fica no CRM
  });

  it('a marca do telefone é gravada ANTES de qualquer envio, e a vaga do balde também', async () => {
    await postar();
    const marca = h.ops.indexOf('insert:' + chaveAvisoSemHorario('5534991113333'));
    expect(marca).toBeGreaterThanOrEqual(0);
    expect(marca).toBeLessThan(h.ops.indexOf('envio'));
    const vaga = h.ops.indexOf('insert:ep_sem_horario_slot:2026-10-22 12:0');
    expect(vaga).toBeGreaterThan(marca);
    expect(vaga).toBeLessThan(h.ops.indexOf('envio'));
    expect(h.store.has(chaveVagaSemHorario('2026-10-22 12:0'))).toBe(true);
  });

  it('o segundo POST com o mesmo telefone não envia nada, diz ja_avisado (e a ficha entra de novo)', async () => {
    await postar();
    h.ops.length = 0;
    relogio('2026-10-22T16:00:00Z');                 // outro balde: só a marca do telefone segura
    const r = await postar();
    expect(r.body).toMatchObject({ id: 9, aviso: 'ja_avisado' });
    expect(envios()).toBe(0);
    expect(h.ops.some(o => o.startsWith('insert:ep_sem_horario_slot'))).toBe(false);
  });

  it('1 recado por balde de 10 minutos: o 2º telefone no mesmo balde só grava e devolve a marca', async () => {
    await postar();
    const r = await postar({ telefone: '5534992224444' });
    expect(r.body).toMatchObject({ id: 9, aviso: 'teto' });
    expect(envios()).toBe(NUM_EQUIPE);
    expect(h.notas).toHaveLength(2);
    expect(h.store.has(chaveAvisoSemHorario('5534992224444'))).toBe(false);   // marca devolvida
    // no balde seguinte, o mesmo telefone é atendido
    relogio('2026-10-22T15:10:00Z');
    const r2 = await postar({ telefone: '5534992224444' });
    expect(r2.body.aviso).toBe('enviado');
    expect(envios()).toBe(2 * NUM_EQUIPE);
  });

  it('envio que falha nos dois números devolve a marca (aviso: falha), e a tentativa seguinte envia', async () => {
    h.enviar.mockRejectedValue(new Error('zapi caiu'));
    const r = await postar();
    expect(r.status).toBe(200);
    expect(r.body.aviso).toBe('falha');
    expect(envios()).toBe(NUM_EQUIPE);
    expect(h.ops).toContain('delete:' + chaveAvisoSemHorario('5534991113333'));
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(false);
    h.enviar.mockResolvedValue(undefined);
    h.ops.length = 0;
    relogio('2026-10-22T15:20:00Z');                 // a vaga do balde anterior não volta
    const r2 = await postar();
    expect(r2.body.aviso).toBe('enviado');
    expect(envios()).toBe(NUM_EQUIPE);
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(true);
  });

  it('um número falhando e o outro recebendo conta como enviado: a marca fica', async () => {
    h.enviar.mockRejectedValueOnce(new Error('um caiu')).mockResolvedValue(undefined);
    const r = await postar();
    expect(r.body.aviso).toBe('enviado');
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(true);
  });

  it('linha em cooldown: não envia, não gasta vaga, devolve a marca (aviso: falha)', async () => {
    h.cooldown = true;
    const r = await postar();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 9, aviso: 'falha' });
    expect(envios()).toBe(0);
    expect(h.ops.some(o => o.startsWith('insert:ep_sem_horario_slot'))).toBe(false);
    expect(h.ops.some(o => o.startsWith('like:'))).toBe(false);
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(false);
    h.cooldown = false;
    expect((await postar()).body.aviso).toBe('enviado');   // passou o cooldown, o mesmo telefone é avisado
  });

  it('teto do dia: com 24 recados já feitos, o seguinte só grava e devolve a marca', async () => {
    const dia = diaDeBrasilia();
    expect(TETO_SEM_HORARIO_POR_DIA).toBe(24);
    for (let hh = 0; hh < 24; hh++) h.store.set(chaveVagaSemHorario(`${dia} ${String(hh).padStart(2, '0')}:5`), 'x');
    h.store.set('ep_sem_horario_slot:2026-10-21 12:0', 'x');            // outro dia não conta
    const r = await postar();
    expect(r.body).toMatchObject({ id: 9, aviso: 'teto' });
    expect(envios()).toBe(0);
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(false);
    expect(h.ops.some(o => o.startsWith('insert:ep_sem_horario_slot'))).toBe(false);   // nem tenta a vaga
  });

  it('23 recados no dia ainda deixam o 24º sair; e o dia anterior não conta', async () => {
    const dia = diaDeBrasilia();
    for (let hh = 0; hh < 23; hh++) h.store.set(chaveVagaSemHorario(`${dia} ${String(hh).padStart(2, '0')}:5`), 'x');
    for (let hh = 0; hh < 10; hh++) h.store.set(chaveVagaSemHorario(`2026-10-21 ${String(hh).padStart(2, '0')}:5`), 'x');
    expect((await postar()).body.aviso).toBe('enviado');
    relogio('2026-10-22T15:30:00Z');
    expect((await postar({ telefone: '5534992224444' })).body.aviso).toBe('teto');
  });

  it('o balde é de 10 minutos de Brasília e o dia também', () => {
    expect(baldeDeBrasilia(new Date('2026-10-22T14:59:00Z'))).toBe('2026-10-22 11:5');
    expect(baldeDeBrasilia(new Date('2026-10-22T15:00:00Z'))).toBe('2026-10-22 12:0');
    expect(baldeDeBrasilia(new Date('2026-10-22T15:09:59Z'))).toBe('2026-10-22 12:0');
    expect(baldeDeBrasilia(new Date('2026-10-22T15:10:00Z'))).toBe('2026-10-22 12:1');
    expect(diaDeBrasilia(new Date('2026-10-23T02:30:00Z'))).toBe('2026-10-22');   // 23h30 em Brasília
    expect(diaDeBrasilia(new Date('2026-10-23T03:00:00Z'))).toBe('2026-10-23');
    expect(chaveVagaSemHorario('2026-10-22 12:0')).toBe('ep_sem_horario_slot:2026-10-22 12:0');
  });

  it('key sem unicidade: depois do insert, mais de uma linha com a chave da vaga vale como sem vaga', async () => {
    h.semUnicidade = true;
    h.store.set(chaveVagaSemHorario('2026-10-22 12:0'), 'outro');   // alguém pegou o balde um instante antes
    const r = await postar();
    expect(r.body.aviso).toBe('teto');
    expect(envios()).toBe(0);
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(false);
  });

  it('insert da vaga com erro que não é 23505 fecha (aviso: falha) e devolve a marca', async () => {
    h.insertErroPrefixo = 'ep_sem_horario_slot';
    const r = await postar();
    expect(r.body).toMatchObject({ id: 9, aviso: 'falha' });
    expect(envios()).toBe(0);
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(false);
  });

  it('teste: true marca e NÃO envia (aviso: teste), e o segundo POST também não envia', async () => {
    const r = await postar({ teste: true });
    expect(r.status).toBe(200);
    expect(r.body.aviso).toBe('teste');
    expect(envios()).toBe(0);
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(true);   // a marca veio antes da saída de teste
    expect((await postar({ teste: true })).body.aviso).toBe('ja_avisado');
    expect(envios()).toBe(0);
  });

  it('nome começando com "teste" também só marca, sem gastar vaga', async () => {
    await postar({ nome: 'Teste da Silva' });
    expect(envios()).toBe(0);
    expect(h.store.has(chaveAvisoSemHorario('5534991113333'))).toBe(true);
    expect(h.ops.some(o => o.startsWith('insert:ep_sem_horario_slot'))).toBe(false);
  });

  it('system_state fora do ar: não manda (a trava fecha) e NÃO promete que a equipe vai chamar', async () => {
    h.insertErro = true;
    const r = await postar();
    expect(r.body.id).toBe(9);
    expect(envios()).toBe(0);
    expect(['enviado', 'ja_avisado']).not.toContain(r.body.aviso);
  });

  it('o banco da ficha falhando não segura o recado: a equipe sabe, e a resposta não traz id', async () => {
    h.notaFalha = true;
    const r = await postar();
    expect(r.status).toBe(200);
    expect(r.body.id).toBeNull();                    // a LP só diz "recebemos" com id
    expect(envios()).toBe(NUM_EQUIPE);
  });

  it('ja_gravado: true não grava a ficha de novo, só faz o recado', async () => {
    const r = await postar({ ja_gravado: true });
    expect(r.status).toBe(200);
    expect(h.notas).toHaveLength(0);
    expect(r.body).toMatchObject({ ok: true, id: null, aviso: 'enviado' });
    expect(envios()).toBe(NUM_EQUIPE);
  });

  it('ja_gravado sem sem_horario é ignorado: a ficha entra como sempre e nada é enviado', async () => {
    const r = await postar({ ja_gravado: true, sem_horario: undefined });
    expect(h.notas).toHaveLength(1);
    expect(r.body.id).toBe(9);
    expect(r.body.aviso).toBeUndefined();
    expect(envios()).toBe(0);
    expect(h.ops).toEqual([]);
  });

  it('sem a flag nada muda: nenhuma mensagem, nenhuma escrita em system_state, nenhum aviso', async () => {
    const r = await postar({ sem_horario: undefined });
    expect(r.status).toBe(200);
    expect(r.body.aviso).toBeUndefined();
    expect(envios()).toBe(0);
    expect(h.ops).toEqual([]);
    const r2 = await postar({ sem_horario: 'true' });   // só o booleano true vale
    expect(r2.status).toBe(200);
    expect(envios()).toBe(0);
  });

  it('as regras de nome e telefone do /nota1 continuam valendo', async () => {
    expect((await postar({ nome: 'Jo' })).status).toBe(400);
    expect((await postar({ telefone: '34991113333' })).status).toBe(400);
    expect(envios()).toBe(0);
  });

  it('nome de 5.000 caracteres pela rota: o recado sai com até 1400 caracteres', async () => {
    await postar({ nome: 'A'.repeat(5000), cidade: 'C'.repeat(5000), ficha: 'F'.repeat(9000) });
    const msg = String(h.enviar.mock.calls[0][1]);
    expect(msg.length).toBeLessThanOrEqual(TAMANHO_MAX_AVISO_SEM_HORARIO);
    expect(msg).not.toContain('F'.repeat(20));
  });
});

describe('o texto do recado', () => {
  const lead = { nome: 'Carlos Lima', telefone: '5534991113333', cidade: 'Uberlândia-MG' };
  const linhaDoNome = (t: string) => t.split('\n').find(l => l.startsWith('*Nome:*')) || '';

  it('diz quem é, como chamar, o caminho e o motivo; emoji só na primeira linha; sem travessão', () => {
    const t = montarAvisoSemHorario(lead, { caminho: 'carregador', motivo: 'agendar_falhou' });
    expect(t).toContain('*Nome:* Carlos Lima');
    expect(t).toContain('wa.me/5534991113333');
    expect(t).toContain('*Cidade:* Uberlândia-MG');
    expect(t).toContain('*Caminho:* Compra de carregador');
    expect(t).toContain('*Motivo:* O agendamento não gravou');
    const [primeira, ...resto] = t.split('\n');
    expect(primeira).toMatch(/\p{Extended_Pictographic}/u);
    expect(resto.join('\n')).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(t).not.toMatch(/[—–]/);
  });

  it('caminho e motivo fora da lista viram "Outro" em vez de texto livre da internet', () => {
    const t = montarAvisoSemHorario(lead, { caminho: '<script>', motivo: { x: 1 } });
    expect(t).toContain('*Caminho:* Outro');
    expect(t).toContain('*Motivo:* Outro.');
    expect(t).not.toContain('<script>');
    const t2 = montarAvisoSemHorario(lead, { caminho: '__proto__', motivo: 'constructor' });
    expect(t2).toContain('*Caminho:* Outro');
    expect(t2).toContain('*Motivo:* Outro.');
  });

  it('nome de 5.000 caracteres: o nome é cortado em 80 e o recado fica em até 1400', () => {
    const t = montarAvisoSemHorario({ ...lead, nome: 'N'.repeat(5000), cidade: 'C'.repeat(5000) }, { caminho: 'comercio', motivo: 'lista_vazia' });
    expect(t.length).toBeLessThanOrEqual(TAMANHO_MAX_AVISO_SEM_HORARIO);
    expect(linhaDoNome(t)).toBe('*Nome:* ' + 'N'.repeat(80));
    expect(t).toContain('*Cidade:* ' + 'C'.repeat(60) + '\n');
  });

  it('nome com quebra de linha, asterisco e link: nada disso passa para o recado', () => {
    const limpo = montarAvisoSemHorario({ ...lead, nome: 'PIX' }, { caminho: 'comercio', motivo: 'lista_vazia' });
    const t = montarAvisoSemHorario({ ...lead, nome: 'Fulano\n*PIX* http://x' }, { caminho: 'comercio', motivo: 'lista_vazia' });
    expect(t.split('\n').length).toBe(limpo.split('\n').length);          // o nome não abriu linha nova
    expect(linhaDoNome(t)).toBe('*Nome:* Fulano PIX');                   // só os 2 asteriscos do rótulo
    expect(linhaDoNome(t).split('*').length - 1).toBe(2);
    expect(t).not.toMatch(/https?:/);
    const outras = montarAvisoSemHorario({ ...lead, nome: 'a\r\nb\tc_d~e`f' }, { caminho: 'comercio', motivo: 'lista_vazia' });
    expect(linhaDoNome(outras)).toBe('*Nome:* a b c d e f');
  });

  it('travessão no nome ou na cidade não chega ao recado', () => {
    const t = montarAvisoSemHorario({ ...lead, nome: 'João — Silva – Neto', cidade: 'Uberaba — MG' }, { caminho: 'comercio', motivo: 'lista_vazia' });
    expect(t).not.toMatch(/[—–]/);
    expect(t).toContain('*Nome:* João - Silva - Neto');
  });

  it('nome só de asteriscos e cidade vazia viram "não informado" / "não informada"', () => {
    const t = montarAvisoSemHorario({ ...lead, nome: '***', cidade: '' }, { caminho: 'comercio', motivo: 'lista_vazia' });
    expect(t).toContain('*Nome:* não informado');
    expect(t).toContain('*Cidade:* não informada');
  });

  it('telefone só com dígitos: o link é wa.me/<dígitos>', () => {
    const t = montarAvisoSemHorario({ ...lead, telefone: '+55 (34) 99111-3333\n*x*' }, { caminho: 'comercio', motivo: 'lista_vazia' });
    expect(t).toContain('*WhatsApp:* wa.me/5534991113333');
  });
});

describe('GET /cliente: o dono que a LP pode usar', () => {
  it('donoDoCliente: só quem está em DONOS_EP; o resto volta null', () => {
    for (const d of DONOS_EP) expect(donoDoCliente(d)).toBe(d);
    for (const d of ['Nilce', 'Giovanna', 'alguém', '']) expect(donoDoCliente(d), d).toBeNull();
    expect(donoDoCliente(null)).toBeNull();
  });

  it('cliente antigo da Nilce ou da Giovanna: a rota devolve dono null (a LP cai no rodízio)', async () => {
    for (const dono of ['Nilce', 'Giovanna']) {
      h.agendamentos.length = 0;
      h.agendamentos.push({ vendedor_nome: dono, cliente_telefone: '5534991113333', quando: '2026-01-10T13:00:00Z', status: 'fechou', created_by: 'lp_solar' });
      const r = await request(app).get('/io/eletroposto/cliente').query({ tel: '5534991113333' });
      expect(r.status).toBe(200);
      expect(r.body.dono, dono).toBeNull();
    }
  });

  it('cliente do Thiago ou do Diego segue devolvendo o dono', async () => {
    for (const dono of DONOS_EP) {
      h.agendamentos.length = 0;
      h.agendamentos.push({ vendedor_nome: dono, cliente_telefone: '5534991113333', quando: '2026-01-10T13:00:00Z', status: 'fechou', created_by: 'lp_eletroposto' });
      const r = await request(app).get('/io/eletroposto/cliente').query({ tel: '5534991113333' });
      expect(r.body.dono).toBe(dono);
    }
  });
});

describe('a página do quiz: o que ela promete depende do aviso do servidor', () => {
  const html = readFileSync(join(__dirname, '../../../dashboard/public/io/eletroposto/index.html'), 'utf8').split('\r\n').join('\n');
  const corpoDe = (inicio: string): string => {
    const i = html.indexOf(inicio);
    expect(i, inicio).toBeGreaterThan(-1);
    return html.slice(i, i + 4000);
  };

  it('"a equipe vai te chamar" só para enviado e ja_avisado; nos outros casos, o WhatsApp', () => {
    expect(html).toContain("const equipeVaiChamar = () => semHorarioAviso === 'enviado' || semHorarioAviso === 'ja_avisado';");
    const f = corpoDe('function mostrarSemHorarioSalvo(){');
    expect(f).toContain('equipeVaiChamar() ? TEXTO_SEM_HORARIO_SALVO : TEXTO_SEM_HORARIO_ZAP');
    const zap = html.match(/const TEXTO_SEM_HORARIO_ZAP = '([^\n]*)';/)![1];
    expect(zap).toContain('Recebemos os seus dados. Para marcar agora,');
    expect(zap).toContain('https://wa.me/5534998165040');
    expect(zap).not.toMatch(/[—–]|\p{Extended_Pictographic}/u);
    expect(zap).not.toContain('vai te chamar');
  });

  it('o aviso vem da resposta do /nota1 e some quando a resposta não traz', () => {
    const f = corpoDe('async function salvarSemHorario(motivo){');
    expect(f).toContain("semHorarioAviso = typeof j.aviso === 'string' ? j.aviso : '';");
  });

  it('quem já teve a ficha NOTA 1 gravada manda ja_gravado: true, e a resposta sem id vale nesse caso', () => {
    const f = corpoDe('async function salvarSemHorario(motivo){');
    expect(f).toContain('...(nota1GravadoPara === telParaBanco() ? { ja_gravado: true } : {}),');
    expect(f).toContain('!(j.id || (corpo.ja_gravado && j.ok))');
  });

  it('o /agendar só cai no "sem horário" por rede (sem status) ou 5xx: 400 e 409 não', () => {
    expect(html).toContain('if(e && e.daApi && (!e.status || e.status >= 500) && precisaSalvarSemHorario()){');
    expect(html).not.toContain('e.daApi && e.status !== 409');
  });
});
