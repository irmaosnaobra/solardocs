import { describe, it, expect, vi, beforeEach } from 'vitest';

// UM aviso por apagão, não um por cliente.
//
// O que este teste tranca: em 08/08/2026 o crédito da Anthropic zerou, TODAS as
// mensagens da fila falharam pela mesma causa, cruzaram a janela de 45 min no
// mesmo minuto e o Thiago recebeu uma parede de avisos idênticos repetindo
// "credit balance is too low". O aviso que devia gritar virou barulho.
//
// Trava também o oposto: com um aviso só, uma falha de envio ENGOLIDA significa
// que ninguém fica sabendo de nada. Por isso o marcador só some depois do envio
// confirmado.

const db = {
  state: new Map<string, { key: string; value: any; updated_at: string }>(),
  mensagens: [] as Array<{ telefone: string; from_me: boolean; momment: string }>,
};
const enviadas: Array<{ phone: string; message: string }> = [];
let envioFalha = false;

vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      const q: any = {
        _like: null as string | null,
        _eqKey: null as string | null,
        _in: null as string[] | null,
        _gte: null as string | null,
        select() { return q; },
        like(_col: string, padrao: string) { q._like = String(padrao).replace(/%$/, ''); return q; },
        eq(col: string, val: string) { if (col === 'key') q._eqKey = val; return q; },
        in(_col: string, vals: string[]) { q._in = vals; return q; },
        gte(_col: string, val: string) { q._gte = val; return q; },
        insert() { return Promise.resolve({ data: null, error: null }); },
        limit() {
          if (tabela === 'wa_mensagens') {
            const saidas = db.mensagens.filter(m =>
              m.from_me === true
              && (!q._in || q._in.includes(m.telefone))
              && (!q._gte || new Date(m.momment).getTime() >= new Date(q._gte).getTime()));
            return Promise.resolve({ data: saidas, error: null });
          }
          const linhas = [...db.state.values()].filter(r => !q._like || r.key.startsWith(q._like));
          return Promise.resolve({ data: linhas, error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: db.state.get(String(q._eqKey)) ?? null, error: null });
        },
        upsert(row: any) { db.state.set(row.key, row); return Promise.resolve({ data: null, error: null }); },
        delete() {
          return {
            in(_col: string, chaves: string[]) {
              chaves.forEach(k => db.state.delete(k));
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
      return q;
    },
  },
}));

vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: (phone: string, message: string) => {
    if (envioFalha) return Promise.reject(new Error('[zapi:solardoc] HTTP 500'));
    enviadas.push({ phone, message });
    return Promise.resolve();
  },
}));

beforeEach(() => { db.state.clear(); db.mensagens.length = 0; enviadas.length = 0; envioFalha = false; vi.resetModules(); });

/** Uma resposta nossa saindo para o cliente, depois da falha. */
const responder = (telefone: string, atrasoMs = 1000) =>
  db.mensagens.push({ telefone, from_me: true, momment: new Date(Date.now() + atrasoMs).toISOString() });

const carregar = () => import('../services/agents/whatsapp/filaAlerta');
const ERRO_CREDITO = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

describe('classificação da falha', () => {
  it('o texto literal do crédito zerado vira causa global', async () => {
    const { classificarFalha } = await carregar();
    expect(classificarFalha(ERRO_CREDITO)).toBe('ia_sem_credito');
  });

  it('chave revogada é outra doença (não adianta pôr crédito)', async () => {
    const { classificarFalha } = await carregar();
    expect(classificarFalha('401 authentication_error: invalid x-api-key')).toBe('ia_chave');
  });

  it('sobrecarga/limite passa sozinha — carência menor', async () => {
    const { classificarFalha } = await carregar();
    expect(classificarFalha('529 overloaded_error')).toBe('ia_limite');
    expect(classificarFalha('429 rate_limit_error')).toBe('ia_limite');
  });

  it('linha do WhatsApp fora não é problema de IA', async () => {
    const { classificarFalha } = await carregar();
    expect(classificarFalha('[zapi:io] POST send-text HTTP 500')).toBe('zapi');
  });

  it('erro desconhecido continua avisando, como "outro"', async () => {
    const { classificarFalha } = await carregar();
    expect(classificarFalha('fetch failed ETIMEDOUT')).toBe('outro');
  });
});

describe('10 clientes no mesmo apagão = 1 aviso', () => {
  const abandonar = async (n: number, erro = ERRO_CREDITO) => {
    const { registrarAbandono } = await carregar();
    for (let i = 0; i < n; i++) {
      await registrarAbandono({ id: `msg-${i}`, phone: `55349913602${10 + i}`, nome: `Cliente ${i}`, texto: 'Quanto custa?', erro });
    }
  };

  it('manda UMA mensagem só e ninguém fica de fora dela', async () => {
    await abandonar(10);
    const { flushAvisoFila } = await carregar();
    const r = await flushAvisoFila();

    expect(enviadas).toHaveLength(1);
    expect(r).toEqual({ avisos: 1, pessoas: 10 });
    // Os 10 aparecem: 10 links wa.me na mesma mensagem.
    expect(enviadas[0].message.match(/wa\.me\//g)).toHaveLength(10);
    expect(enviadas[0].message).toContain('10 clientes sem resposta');
  });

  it('diz a causa e o que fazer, em vez de repetir o erro cru 10 vezes', async () => {
    await abandonar(3);
    const { flushAvisoFila } = await carregar();
    await flushAvisoFila();
    expect(enviadas[0].message).toContain('crédito da Anthropic zerou');
    expect(enviadas[0].message).toContain('console.anthropic.com/settings/billing');
  });

  it('lista longa é resumida (+N outros), não vira rolagem infinita', async () => {
    await abandonar(20);
    const { flushAvisoFila } = await carregar();
    await flushAvisoFila();
    expect(enviadas[0].message).toContain('+8 outros na fila');
    expect(enviadas[0].message.match(/wa\.me\//g)).toHaveLength(12);
  });

  it('depois do aviso a lista zera — o próximo tick não repete os mesmos', async () => {
    await abandonar(4);
    const { flushAvisoFila } = await carregar();
    await flushAvisoFila();
    await flushAvisoFila();
    expect(enviadas).toHaveLength(1);
  });

  it('carência: apagão continua gerando falha, mas não vira aviso a cada 5 min', async () => {
    await abandonar(2);
    const { flushAvisoFila } = await carregar();
    await flushAvisoFila();

    await abandonar(2);                       // mais gente durante o mesmo apagão
    await flushAvisoFila();
    expect(enviadas).toHaveLength(1);         // segurou

    // 1h depois a carência vence e a leva acumulada é avisada.
    const daquiUmaHora = new Date(Date.now() + 61 * 60 * 1000);
    await flushAvisoFila(daquiUmaHora);
    expect(enviadas).toHaveLength(2);
    expect(enviadas[1].message).toContain('2 clientes sem resposta');
  });

  it('causas diferentes não se misturam num aviso só', async () => {
    await abandonar(2);
    await abandonar(1, '[zapi:io] POST send-text HTTP 500');
    const { flushAvisoFila } = await carregar();
    const r = await flushAvisoFila();
    expect(r.avisos).toBe(2);
    expect(enviadas).toHaveLength(2);
    expect(enviadas.some(e => e.message.includes('crédito da Anthropic zerou'))).toBe(true);
    expect(enviadas.some(e => e.message.includes('Z-API não aceitou'))).toBe(true);
  });
});

describe('aviso não manda responder na mão quem já foi respondido', () => {
  // 10/08/2026: o crédito voltou às 17h59, a fila retomou e respondeu o cliente
  // às 18h00 — mas o marcador de 17h16 ainda cumpria a carência de 60 min e às
  // 18h08 saiu um "responde na mão" para quem já tinha resposta.
  const abandonar = async (n: number) => {
    const { registrarAbandono } = await carregar();
    for (let i = 0; i < n; i++) {
      await registrarAbandono({ id: `msg-${i}`, phone: `55349913602${10 + i}`, nome: `Cliente ${i}`, texto: 'Quanto custa?', erro: ERRO_CREDITO });
    }
  };

  it('quem foi respondido enquanto o marcador esperava sai da lista', async () => {
    await abandonar(3);
    responder('5534991360211');                 // a fila retomou e alcançou o Cliente 1

    const { flushAvisoFila } = await carregar();
    const r = await flushAvisoFila();

    expect(r).toEqual({ avisos: 1, pessoas: 2 });
    expect(enviadas[0].message).toContain('2 clientes sem resposta');
    expect(enviadas[0].message).not.toContain('Cliente 1');
    expect(enviadas[0].message).toContain('Cliente 0');
    expect(enviadas[0].message).toContain('Cliente 2');
  });

  it('apagão que passou sozinho não gasta aviso nenhum', async () => {
    await abandonar(2);
    responder('5534991360210');
    responder('5534991360211');

    const { flushAvisoFila } = await carregar();
    expect(await flushAvisoFila()).toEqual({ avisos: 0, pessoas: 0 });
    expect(enviadas).toHaveLength(0);
    // E os marcadores somem: nada de ressuscitar no tick seguinte.
    expect([...db.state.keys()].filter(k => k.startsWith('ia_falha:'))).toHaveLength(0);
  });

  it('resposta anterior à falha não conta — quem escreveu depois segue na lista', async () => {
    db.mensagens.push({ telefone: '5534991360210', from_me: true, momment: new Date(Date.now() - 60_000).toISOString() });
    await abandonar(1);

    const { flushAvisoFila } = await carregar();
    expect(await flushAvisoFila()).toEqual({ avisos: 1, pessoas: 1 });
    expect(enviadas[0].message).toContain('1 cliente sem resposta');
  });

  it('marcador resolvido some mesmo dentro da carência — não volta no aviso da hora seguinte', async () => {
    await abandonar(1);
    const { flushAvisoFila } = await carregar();
    await flushAvisoFila();                     // 1º aviso sai e carimba a carência
    expect(enviadas).toHaveLength(1);

    await abandonar(2);                         // mais gente durante o mesmo apagão
    responder('5534991360210');
    responder('5534991360211');
    await flushAvisoFila();                     // carência segura o aviso, mas limpa os resolvidos
    expect(enviadas).toHaveLength(1);

    const daquiUmaHora = new Date(Date.now() + 61 * 60 * 1000);
    await flushAvisoFila(daquiUmaHora);
    expect(enviadas).toHaveLength(1);           // não havia mais ninguém sem resposta
  });
});

describe('o aviso não pode sumir em silêncio', () => {
  it('envio falhou: ninguém é apagado da lista e o próximo tick tenta de novo', async () => {
    const { registrarAbandono, flushAvisoFila } = await carregar();
    await registrarAbandono({ id: 'm1', phone: '5534991360223', nome: 'Junior', texto: 'Como é seu nome?', erro: ERRO_CREDITO });

    envioFalha = true;
    expect(await flushAvisoFila()).toEqual({ avisos: 0, pessoas: 0 });
    expect(enviadas).toHaveLength(0);

    envioFalha = false;
    const r = await flushAvisoFila();          // sem carência gravada: tenta de novo já
    expect(r).toEqual({ avisos: 1, pessoas: 1 });
    expect(enviadas[0].message).toContain('Junior');
  });

  it('fila vazia não manda nada', async () => {
    const { flushAvisoFila } = await carregar();
    expect(await flushAvisoFila()).toEqual({ avisos: 0, pessoas: 0 });
    expect(enviadas).toHaveLength(0);
  });
});
