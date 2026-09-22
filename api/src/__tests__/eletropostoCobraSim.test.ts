import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A RÉGUA DO SIM. Os riscos aqui, em ordem de estrago:
//   1. liberar o horário de quem CONFIRMOU ou de quem está conversando;
//   2. cobrar duas vezes o mesmo degrau, ou mandar a cobrança de 1h três dias
//      depois (ficha represada);
//   3. liberar sem ninguém saber, ou avisar antes de o horário estar liberado;
//   4. rajada: as 18 fichas paradas virando 18 mensagens no mesmo minuto.

let fichas: any[] = [];
let estado: Array<{ key: string; value?: any; updated_at?: string }> = [];
let nota1: any[] = [];
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
const updates: Array<{ id: number; patch: any }> = [];
const inseridas: any[] = [];
const carimbos: string[] = [];
let tetoLivre = true;
let falharEnvio = false;

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        _update: null as any,
        _like: null as string | null,
        select() { return q; },
        insert(linha: any) {
          inseridas.push(linha);
          return Promise.resolve({ data: { id: 999 }, error: null });
        },
        update(patch: any) { q._update = patch; return q; },
        eq(_col: string, v: any) {
          if (q._update) {
            const id = Number(v);
            // O update encadeia `.eq('id').eq('status')` como guarda de corrida.
            return Object.assign(Promise.resolve({ error: null }), {
              eq: () => { updates.push({ id, patch: q._update }); return Promise.resolve({ error: null }); },
            });
          }
          return q;
        },
        not() { return q; },
        is() { return q; },
        gte() { return q; },
        lte() { return q; },
        like(_col: string, v: string) { q._like = v; return q; },
        order() { return q; },
        limit() {
          if (tabela === 'consultores') return Promise.resolve({ data: [], error: null });
          if (tabela === 'eletroposto_nota1') {
            const chave = String(q._like || '').replace(/%/g, '');
            return Promise.resolve({
              data: nota1.filter(n => String(n.telefone).endsWith(chave)), error: null,
            });
          }
          return Promise.resolve({ data: fichas, error: null });
        },
      };
      return q;
    },
  },
}));

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => {
      const q: any = {
        _like: null as string | null,
        select() { return q; },
        like(_col: string, v: string) { q._like = String(v).replace(/%$/, ''); return q; },
        limit() {
          return Promise.resolve({ data: estado.filter(e => e.key.startsWith(q._like || '')), error: null });
        },
        insert(linha: any) {
          // A chave é primary key de verdade: o claim de quem chega depois falha.
          if (estado.some(e => e.key === linha.key)) return Promise.resolve({ error: { code: '23505' } });
          estado.push(linha);
          return Promise.resolve({ error: null });
        },
        delete() { return { eq: (_c: string, v: string) => { estado = estado.filter(e => e.key !== v); return Promise.resolve({ error: null }); } }; },
      };
      // `upsert(...).then(undefined, cb)` é o padrão da casa: devolve promise de verdade.
      q.upsert = (linha: any) => {
        carimbos.push(linha.key);
        const i = estado.findIndex(e => e.key === linha.key);
        if (i >= 0) estado[i] = linha; else estado.push(linha);
        return Promise.resolve({ error: null });
      };
      return q;
    },
  },
}));

vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: async (phone: string, bolhas: string[]) => {
    if (falharEnvio) throw new Error('z-api fora');
    enviadas.push({ phone, bolhas });
  },
}));

vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: async () => tetoLivre,
}));

vi.mock('../utils/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

import {
  runEletropostoCobraSimTick, passoDevido, bolhaCobranca1, bolhaCobranca2, bolhaLiberou,
  fichaDoCurioso, EP_COBRA_PREFIX, EP_LIBERADO_PREFIX,
} from '../services/io/eletropostoCobraSim';

/** 22/09/2026, 14h de Brasília: dentro da janela de envio e num dia útil. */
const AGORA = new Date('2026-09-22T17:00:00.000Z');
const minAtras = (m: number) => new Date(AGORA.getTime() - m * 60_000).toISOString();
const horasAFrente = (h: number) => new Date(AGORA.getTime() + h * 3600_000).toISOString();

function ficha(over: Partial<Record<string, any>> = {}) {
  return {
    id: 1, cliente_nome: 'Marcos Silva', cliente_telefone: '5534999887766', vendedor_nome: 'Diego',
    quando: horasAFrente(48), created_by: 'lp_eletroposto', status: 'agendado',
    confirmacao_at: minAtras(200), historico: null, cidade: 'Uberlândia', observacao: null,
    ponto_relacao: null, capital_faixa: 'naosei', tem_ponto: 'definido', perfil_slug: 'posto',
    decisor_tipo: 'eu', rota_tipo: 'br', utm_source: 'meta', utm_medium: null,
    utm_campaign: null, utm_content: null, utm_term: '1234',
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
  fichas = []; estado = []; nota1 = [];
  enviadas.length = 0; updates.length = 0; inseridas.length = 0; carimbos.length = 0;
  tetoLivre = true; falharEnvio = false;
  delete process.env.EP_COBRA_SIM_OFF;
});
afterEach(() => { vi.useRealTimers(); });

describe('passoDevido — a escada', () => {
  const base = { minAteReuniao: 3000, c1Enviada: false, c2Enviada: false };

  it('antes de 1h não cobra nada', () => {
    expect(passoDevido({ ...base, minDesdeConfirmacao: 45 })).toBe('esperar');
  });

  it('1h depois da confirmação, cobra a primeira vez', () => {
    expect(passoDevido({ ...base, minDesdeConfirmacao: 61 })).toBe('c1');
  });

  it('2h depois, manda o ultimato', () => {
    expect(passoDevido({ ...base, minDesdeConfirmacao: 121, c1Enviada: true })).toBe('c2');
  });

  it('3h depois do ultimato, libera o horário', () => {
    expect(passoDevido({ ...base, minDesdeConfirmacao: 181, c1Enviada: true, c2Enviada: true })).toBe('liberar');
  });

  it('não libera sem o ultimato antes das 6h de silêncio', () => {
    expect(passoDevido({ ...base, minDesdeConfirmacao: 200, c1Enviada: true })).toBe('c2');
  });

  it('passadas 6h de silêncio, libera mesmo sem o ultimato (o caso do represado)', () => {
    expect(passoDevido({ ...base, minDesdeConfirmacao: 4000 })).toBe('liberar');
  });

  it('ficha represada NÃO recebe a cobrança de 1h atrasada', () => {
    // 5h de silêncio: o degrau de 1h e o de 2h já venceram. Como ainda não deu 6h
    // e o ultimato não saiu, o que vale é o ultimato, nunca o "conseguiu ver?".
    expect(passoDevido({ ...base, minDesdeConfirmacao: 300 })).toBe('esperar');
  });

  it('perto da reunião a régua sai de cena (quem fala é o toque de 1h)', () => {
    expect(passoDevido({ ...base, minDesdeConfirmacao: 500, minAteReuniao: 40 })).toBe('esperar');
  });
});

describe('as mensagens', () => {
  const quando = '2026-09-24T17:00:00.000Z';

  it('a cobrança 1 pede o SIM e diz quando é a reunião', () => {
    const m = bolhaCobranca1('Marcos Silva', quando, 'Diego');
    expect(m).toContain('Marcos');
    expect(m).toContain('*SIM*');
    expect(m).toContain('Diego');
    expect(m).toContain('14h00');
  });

  it('o ultimato diz a HORA do corte', () => {
    const m = bolhaCobranca2('Marcos', quando, new Date('2026-09-22T18:30:00.000Z'));
    expect(m).toContain('15h30');
    expect(m).toContain('libero');
  });

  it('o aviso de liberação deixa a porta aberta', () => {
    const m = bolhaLiberou('Marcos', quando);
    expect(m).toContain('liberei');
    expect(m).toMatch(/me responde|responder/i);
  });

  it('nenhuma das três usa travessão', () => {
    const todas = [
      bolhaCobranca1('Marcos', quando, 'Diego'),
      bolhaCobranca2('Marcos', quando, AGORA),
      bolhaLiberou('Marcos', quando),
    ];
    for (const m of todas) expect(m).not.toMatch(/[—–]/);
  });

  it('sem nome na ficha, a frase continua de pé', () => {
    expect(bolhaLiberou(null, quando).startsWith('Como não tive retorno')).toBe(true);
    expect(bolhaCobranca2('', quando, AGORA).startsWith('Ainda estou segurando')).toBe(true);
  });
});

describe('a ficha que nasce no Curioso', () => {
  it('não escreve valor de investimento (a agenda só sabe COMO ele pagaria)', () => {
    const t = fichaDoCurioso(ficha() as any);
    expect(t).not.toMatch(/Quanto pretende investir/i);
    expect(t).toContain('Como pretende pagar: ainda não sabe como pagaria');
  });

  it('quem não disse de quem é o local cai no Curioso pela regra de destino', () => {
    const t = fichaDoCurioso(ficha() as any);
    expect(t).toContain('Local é seu: não respondeu');
  });

  it('quem disse que é dono entra com a resposta que manda ele pro Arrendamento', () => {
    const t = fichaDoCurioso(ficha({ ponto_relacao: 'Proprietário' }) as any);
    expect(t).toContain('Local é seu: Proprietário');
  });
});

describe('o tick', () => {
  it('libera a ficha muda de 3h, cria a ficha no Curioso e só então avisa', async () => {
    fichas = [ficha({ confirmacao_at: minAtras(200) })];
    estado = [{ key: `${EP_COBRA_PREFIX}1:c1` }, { key: `${EP_COBRA_PREFIX}1:c2` }];

    const r = await runEletropostoCobraSimTick();

    expect(r.liberados).toBe(1);
    expect(updates[0].patch.status).toBe('cancelado');
    expect(updates[0].patch.historico).toContain('Horário liberado');
    expect(carimbos).toContain(`${EP_LIBERADO_PREFIX}1`);
    expect(inseridas).toHaveLength(1);
    expect(inseridas[0].origem).toBe('agenda_sem_resposta');
    // capital_faixa vazio de propósito: é o filtro do convite ao investidor, que
    // oferece reunião pra quem acabou de perder a dele.
    expect(inseridas[0].capital_faixa).toBeUndefined();
    // O aviso sai DEPOIS do estado, e sai na mesma rodada porque a fila tinha vaga.
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0].bolhas[0]).toContain('liberei');
    expect(carimbos).toContain(`${EP_COBRA_PREFIX}1:liberou`);
  });

  it('quem já está no Curioso não vira ficha duplicada', async () => {
    fichas = [ficha({ confirmacao_at: minAtras(400) })];
    nota1 = [{ id: 7, telefone: '5534999887766' }];
    await runEletropostoCobraSimTick();
    expect(inseridas).toHaveLength(0);
    expect(updates[0].patch.status).toBe('cancelado');
  });

  it('não encosta em quem confirmou nem em quem escreveu', async () => {
    // A consulta já filtra presença e lead_resposta_at; o que este teste guarda é
    // o marcador do OUTRO projeto, que é a terceira prova de que a pessoa falou.
    fichas = [ficha({ confirmacao_at: minAtras(400) })];
    estado = [{ key: 'ep_resposta:1', updated_at: minAtras(100) }];
    const r = await runEletropostoCobraSimTick();
    expect(r.liberados).toBe(0);
    expect(updates).toHaveLength(0);
    expect(enviadas).toHaveLength(0);
  });

  it('resposta de um ciclo ANTERIOR não protege a ficha', async () => {
    fichas = [ficha({ confirmacao_at: minAtras(400) })];
    estado = [{ key: 'ep_resposta:1', updated_at: minAtras(5000) }];
    const r = await runEletropostoCobraSimTick();
    expect(r.liberados).toBe(1);
  });

  it('cobra 1 e 2, e NUNCA as duas na mesma ficha no mesmo tick', async () => {
    fichas = [ficha({ id: 1, confirmacao_at: minAtras(70) }), ficha({ id: 2, confirmacao_at: minAtras(130) })];
    const r = await runEletropostoCobraSimTick();
    expect(r.cobranca1 + r.cobranca2).toBe(2);
    expect(enviadas).toHaveLength(2);
    // O ultimato vai na frente: é ele que evita a liberação.
    expect(enviadas[0].bolhas[0]).toContain('libero pra próxima');
  });

  it('a fila segura o excesso: 18 fichas paradas não viram 18 mensagens', async () => {
    fichas = Array.from({ length: 18 }, (_, i) => ficha({ id: i + 1, confirmacao_at: minAtras(4000) }));
    const r = await runEletropostoCobraSimTick();
    // Liberar é escrita no banco: sai tudo de uma vez, que é o que devolve a agenda.
    expect(r.liberados).toBe(18);
    // Avisar é mensagem: 2 por rodada.
    expect(enviadas).toHaveLength(2);
    expect(r.segurados).toBeGreaterThan(0);
  });

  it('teto da linha estourado segura a mensagem e não perde o aviso', async () => {
    fichas = [ficha({ confirmacao_at: minAtras(4000) })];
    tetoLivre = false;
    const r1 = await runEletropostoCobraSimTick();
    expect(r1.liberados).toBe(1);
    expect(enviadas).toHaveLength(0);
    expect(r1.segurados).toBe(1);

    // Rodada seguinte com a linha livre: a ficha já está cancelada e fora da
    // consulta, e mesmo assim o aviso sai, porque a fila é o carimbo.
    fichas = [];
    tetoLivre = true;
    const r2 = await runEletropostoCobraSimTick();
    expect(r2.avisos).toBe(1);
    expect(enviadas[0].bolhas[0]).toContain('liberei');
  });

  it('mensagem ja reivindicada por outro tick nao sai de novo', async () => {
    // Dois ticks simultaneos (cron do GitHub e da Vercel) leem a mesma fila. O
    // claim e' `insert` numa primary key: o segundo leva 23505 e desiste. Sem
    // isso o Andre recebeu o aviso duas vezes em 22/09/2026.
    fichas = [ficha({ confirmacao_at: minAtras(4000) })];
    estado = [{ key: `${EP_COBRA_PREFIX}1:liberou`, value: { claim: 'agora' } }];
    const r = await runEletropostoCobraSimTick();
    expect(r.liberados).toBe(1);
    expect(enviadas).toHaveLength(0);
  });

  it('envio que falha devolve a mensagem pra fila', async () => {
    fichas = [ficha({ confirmacao_at: minAtras(4000) })];
    falharEnvio = true;
    const r1 = await runEletropostoCobraSimTick();
    expect(r1.erros).toBe(1);
    expect(estado.some(e => e.key === `${EP_COBRA_PREFIX}1:liberou`)).toBe(false);

    fichas = [];
    falharEnvio = false;
    const r2 = await runEletropostoCobraSimTick();
    expect(r2.avisos).toBe(1);
  });

  it('kill-switch para tudo', async () => {
    process.env.EP_COBRA_SIM_OFF = '1';
    fichas = [ficha({ confirmacao_at: minAtras(4000) })];
    const r = await runEletropostoCobraSimTick();
    expect(r.motivo).toBe('desligado');
    expect(updates).toHaveLength(0);
    expect(enviadas).toHaveLength(0);
  });

  it('fora da janela de 8h às 20h não faz nada', async () => {
    vi.setSystemTime(new Date('2026-09-23T04:00:00.000Z')); // 01h BRT
    fichas = [ficha({ confirmacao_at: minAtras(4000) })];
    const r = await runEletropostoCobraSimTick();
    expect(r.motivo).toBe('fora_da_janela');
  });

  it('dry roda a decisão inteira e não toca em nada', async () => {
    fichas = [ficha({ confirmacao_at: minAtras(4000) })];
    const r = await runEletropostoCobraSimTick({ dry: true });
    expect(r.liberados).toBe(1);
    expect(updates).toHaveLength(0);
    expect(inseridas).toHaveLength(0);
    expect(enviadas).toHaveLength(0);
    expect(carimbos).toHaveLength(0);
    expect(r.previa?.length).toBeGreaterThan(0);
  });

  it('ficha de solar não entra nesta régua', async () => {
    fichas = [ficha({ created_by: 'lp_solar', confirmacao_at: minAtras(4000) })];
    const r = await runEletropostoCobraSimTick();
    expect(r.liberados).toBe(0);
    expect(enviadas).toHaveLength(0);
  });
});
