import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Agente de agendamento do eletroposto. Os riscos aqui são: mandar duas vezes o
// mesmo aviso, mandar pra quem teve a reunião CANCELADA (os 14 da reclassificação
// de 01/08) e prometer um link que quem manda é gente.

let fichas: any[] = [];
let consultores: any[] = [];
const enviadas: Array<{ phone: string; bolhas: string[] }> = [];
const updates: Array<{ id: number; campo: string }> = [];

vi.mock('../utils/supabaseGerador', () => ({
  supabaseGerador: {
    from: (tabela: string) => {
      const q: any = {
        _filtros: {} as Record<string, any>,
        _update: null as any,
        select() { return q; },
        // Guardado com prefixo pra não colidir com o `.eq` do mesmo campo — desde
        // 14/08 a consulta pede `.in('status', ['agendado','nao_atendeu'])`, porque
        // o toque de 5 min continua saindo pra quem o robô marcou de NÃO ATENDIDO.
        in(col: string, vals: any[]) { q._filtros[`in_${col}`] = vals; return q; },
        eq(col: string, v: any) {
          // Junta as chaves: um envio pode carimbar MAIS DE UMA flag (a confirmação
          // de reunião marcada dentro da janela de 1h mata o toque de 1h junto).
          if (q._update) {
            updates.push({ id: v, campo: Object.keys(q._update).join('+') });
            // O NÃO ATENDIDO automático encadeia um segundo `.eq('status', …)`
            // como guarda de corrida com gente: o update tem que continuar
            // encadeável depois do id.
            return Object.assign(Promise.resolve({ error: null }), {
              eq: () => Promise.resolve({ error: null }),
            });
          }
          q._filtros[col] = v; return q;
        },
        gte(col: string, v: any) { q._filtros[`gte_${col}`] = v; return q; },
        lte(col: string, v: any) { q._filtros[`lte_${col}`] = v; return q; },
        order() { return q; },
        update(patch: any) { q._update = patch; return q; },
        limit() {
          if (tabela === 'consultores') return Promise.resolve({ data: consultores, error: null });
          // A consulta NÃO filtra mais por created_by: o produto é decidido no
          // código, por família (ehOrigemEletroposto). O mock devolve solar junto
          // de propósito — é assim que o teste prova que solar não recebe.
          const aceitos: string[] = q._filtros['in_status'] ?? [q._filtros['status']];
          const piso = new Date(q._filtros['gte_quando']).getTime();
          const teto = new Date(q._filtros['lte_quando']).getTime();
          return Promise.resolve({
            data: fichas.filter(f =>
              aceitos.includes(f.status) &&
              new Date(f.quando).getTime() >= piso && new Date(f.quando).getTime() <= teto),
            error: null,
          });
        },
      };
      return q;
    },
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
// Teto anti-ban da linha IO. Faltava aqui: em 04/08 a fila de atraso soltou 8
// pessoas na mesma hora (37 mensagens, teto 12) e o 5040 bloqueou.
let tetoLivre = true;
const carimbos: string[] = [];
vi.mock('../services/agents/whatsapp/lineThrottle', () => ({
  dentroDoTetoHorarioLinha: vi.fn(async () => tetoLivre),
}));
// O system_state guarda DUAS coisas aqui: o carimbo do teto anti-ban e — pro bom
// dia, que não tem coluna em `agendamentos` — a própria prova de que já saiu. Por
// isso a leitura responde a partir de `carimbos`, o mesmo array que a escrita
// alimenta: um mock com fixture separada deixaria "não manda duas vezes" passar
// sem nunca poder falhar.
let leituraCarimboFalha = false;
/** Quando cada carimbo foi gravado. Desde 19/08 a leitura do bom dia olha a DATA:
 *  ficha que o repasse do banco moveu pra hoje carrega o carimbo do dia da reunião
 *  antiga, e ele não pode valer como "segundo contato de hoje". Sem data explícita,
 *  o carimbo é de agora — que é o caso normal. */
const carimboEm = new Map<string, string>();
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async (r: any) => { carimbos.push(String(r.key)); return { error: null }; },
      select: () => ({
        in: async (_col: string, chaves: string[]) => (leituraCarimboFalha
          ? { data: null, error: new Error('banco fora') }
          : {
            data: chaves.filter(k => carimbos.includes(k))
              .map(key => ({ key, updated_at: carimboEm.get(key) ?? new Date().toISOString() })),
            error: null,
          }),
        // O NÃO ATENDIDO automático varre por PREFIXO (quem respondeu, quem já
        // foi marcado) — mesma lista de carimbos, outra forma de perguntar.
        like: (_col: string, padrao: string) => {
          const p = String(padrao).replace(/%$/, '');
          const resposta = {
            // `updated_at` importa desde 20/08: o marcador `ep_resposta:` só vale
            // a partir da confirmação que está na ficha AGORA (`falouNesteCiclo`).
            data: carimbos.filter(k => k.startsWith(p))
              .map(key => ({ key, updated_at: carimboEm.get(key) ?? new Date().toISOString() })),
            error: null,
          };
          return { limit: async () => resposta };
        },
      }),
    }),
  },
}));
vi.mock('../services/agents/zapiClient', () => ({
  sendHuman: vi.fn(async (phone: string, bolhas: string[]) => { enviadas.push({ phone, bolhas }); }),
}));

// 04/08/2026 (terça), 13h BRT = 16h UTC. Dentro da janela de 08–20h BRT.
const AGORA = new Date('2026-08-04T16:00:00.000Z');
const emMinutos = (m: number) => new Date(AGORA.getTime() + m * 60_000).toISOString();

function ficha(over: Partial<any> = {}) {
  return {
    id: 1, vendedor_nome: 'Diego', cliente_nome: 'Irineu de Almeida', cliente_telefone: '5577991110001',
    quando: emMinutos(60), created_by: 'lp_eletroposto', status: 'agendado',
    created_at: '2026-07-31T12:00:00.000Z',
    confirmacao_at: null, lembrete_1h_at: null, lembrete_5min_at: null, ...over,
  };
}

/** Ficha que JÁ recebeu a confirmação — é o estado normal de quem está na fila de
 *  lembrete. Desde 10/08/2026 a confirmação é o PRIMEIRO toque sempre (ordem do
 *  Thiago), então reunião sem `confirmacao_at` é confirmada antes de qualquer
 *  lembrete e nunca chega nos ramos de 1h/5min. Teste de lembrete que monta ficha
 *  sem confirmação estaria testando um estado que não existe na vida real: reunião
 *  a 1 hora de distância foi marcada — e confirmada — muito antes disso. */
function fichaConfirmada(over: Partial<any> = {}) {
  return ficha({ confirmacao_at: '2026-08-01T12:00:00.000Z', ...over });
}

const envOriginal = { ...process.env };
beforeEach(() => {
  enviadas.length = 0; updates.length = 0;
  carimbos.length = 0; carimboEm.clear(); tetoLivre = true; leituraCarimboFalha = false;
  fichas = [ficha()];
  consultores = [{ nome: 'Diego', whatsapp: '5534991360172' }, { nome: 'Thiago', whatsapp: '5534991360223' }];
  vi.useFakeTimers(); vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); process.env = { ...envOriginal }; vi.resetModules(); });

async function mod() { return import('../services/io/eletropostoAgenda'); }
async function tick(opts: any = {}) { return (await mod()).runEletropostoAgendaTick(opts); }

describe('quem recebe, e quando', () => {
  it('reunião daqui a 1h recebe o aviso de 1h', async () => {
    fichas = [fichaConfirmada()];
    const r = await tick();
    expect(r.lembretes_1h).toBe(1);
    expect(updates).toEqual([{ id: 1, campo: 'lembrete_1h_at' }]);
    expect(enviadas[0].bolhas.join(' ')).toContain('1 hora');
  });

  it('reunião daqui a 5 min recebe o chamado final', async () => {
    fichas = [fichaConfirmada({ quando: emMinutos(5), lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    const r = await tick();
    expect(r.lembretes_5min).toBe(1);
    expect(enviadas[0].bolhas.join(' ')).toContain('te esperando');
  });

  it('80 minutos antes ainda não é hora do aviso de 1h', async () => {
    fichas = [fichaConfirmada({ quando: emMinutos(80) })];
    expect(await tick()).toMatchObject({ lembretes_1h: 0, confirmacoes: 0 });
    expect(enviadas).toHaveLength(0);
  });

  it('20 minutos antes ainda não é o chamado de 5 min', async () => {
    fichas = [fichaConfirmada({ quando: emMinutos(20), lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    expect(await tick()).toMatchObject({ lembretes_5min: 0 });
    expect(enviadas).toHaveLength(0);
  });

  it('cada aviso sai UMA vez — com a flag gravada, o tick seguinte não repete', async () => {
    fichas = [fichaConfirmada({ lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    expect(await tick()).toMatchObject({ lembretes_1h: 0, lembretes_5min: 0 });
    expect(enviadas).toHaveLength(0);
  });

  it('reunião cancelada não recebe nada (os 14 da reclassificação)', async () => {
    fichas = [ficha({ status: 'cancelado' })];
    expect((await tick()).motivo).toBe('nenhuma_reuniao');
    expect(enviadas).toHaveLength(0);
  });

  it('ficha de solar não entra — a copy aqui é de eletroposto', async () => {
    fichas = [ficha({ created_by: 'lead-meta' })];
    expect((await tick()).motivo).toBe('nenhuma_reuniao');
  });

  // Reunião de eletroposto marcada pela PROSPECÇÃO ficou sem confirmação nenhuma
  // até 06/08: o slug existia, a etiqueta aparecia no card, e o agente filtrava
  // por uma lista fixa de duas origens. Quem casa agora é a palavra "eletroposto".
  it('prospecção de eletroposto recebe igual à LP — o filtro é por família', async () => {
    fichas = [fichaConfirmada({ created_by: 'prosp_eletroposto' })];
    const r = await tick();
    expect(r.lembretes_1h).toBe(1);
    expect(enviadas[0].bolhas.join(' ')).toContain('1 hora');
  });

  it('origem de EP que ninguém cadastrou em lugar nenhum também recebe', async () => {
    fichas = [fichaConfirmada({ created_by: 'lp_eletroposto_v2' })];
    expect((await tick()).lembretes_1h).toBe(1);
  });

  it('ficha sem telefone é pulada sem quebrar o tick', async () => {
    fichas = [ficha({ cliente_telefone: null })];
    expect(await tick()).toMatchObject({ erros: 0, lembretes_1h: 0 });
  });
});

describe('confirmação ao marcar', () => {
  it('quem acabou de marcar confirma na hora', async () => {
    fichas = [ficha({ quando: emMinutos(3 * 24 * 60), created_at: new Date(AGORA.getTime() - 60_000).toISOString() })];
    const r = await tick();
    expect(r.confirmacoes).toBe(1);
    expect(updates).toEqual([{ id: 1, campo: 'confirmacao_at' }]);
  });

  // 10/08/2026: a folga mínima da LP caiu de 2h pra 30 min, e aí o lead passou a
  // conseguir marcar o slot mais próximo dentro da janela de 1h do agente. A ordem
  // dos toques (5min → 1h → confirmação, cada um com `continue`) fazia a PRIMEIRA
  // mensagem que ele recebia da empresa ser "Falta 1 hora pra sua reunião" — de uma
  // reunião que ele nunca viu confirmada.
  it('marcou pra daqui a 50 min: recebe a CONFIRMAÇÃO, não o aviso de 1h', async () => {
    fichas = [ficha({ quando: emMinutos(50), created_at: new Date(AGORA.getTime() - 60_000).toISOString() })];
    const r = await tick();
    expect(r).toMatchObject({ confirmacoes: 1, lembretes_1h: 0 });
    expect(enviadas[0].bolhas.join(' ')).toContain('está confirmada');
    expect(enviadas[0].bolhas.join(' ')).not.toContain('Falta *1 hora*');
  });

  it('e essa confirmação mata o aviso de 1h junto — senão ele viria logo atrás', async () => {
    fichas = [ficha({ quando: emMinutos(50), created_at: new Date(AGORA.getTime() - 60_000).toISOString() })];
    await tick();
    expect(updates).toEqual([{ id: 1, campo: 'confirmacao_at+lembrete_1h_at' }]);
  });

  it('reunião longe carimba só a confirmação — o aviso de 1h ainda tem que sair', async () => {
    fichas = [ficha({ quando: emMinutos(200), created_at: new Date(AGORA.getTime() - 60_000).toISOString() })];
    await tick();
    expect(updates).toEqual([{ id: 1, campo: 'confirmacao_at' }]);
  });

  // "Tem que receber confirmação sempre" (Thiago, 10/08). Ficha velha represada
  // (envio falhou, agente desligado, fila de backlog) a 60 min da reunião: até
  // 10/08 ela recebia o aviso de 1h e NUNCA a confirmação, porque o gate de 2h de
  // antecedência barrava o backlog pra sempre. Agora a confirmação vem primeiro.
  it('ficha antiga sem confirmação recebe a CONFIRMAÇÃO, não o aviso de 1h', async () => {
    fichas = [ficha({ quando: emMinutos(60) })];   // created_at padrão = 31/07, backlog
    expect(await tick()).toMatchObject({ confirmacoes: 1, lembretes_1h: 0 });
    expect(enviadas[0].bolhas.join(' ')).toContain('está confirmada');
  });

  // A promessa inteira em uma linha: NENHUM lembrete passa na frente da confirmação.
  // O de 5 min é o mais urgente que existe e mesmo ele espera — quem nunca recebeu
  // "sua reunião está confirmada" não pode ser saudado com "é agora, entra".
  it('nem o chamado de 5 min passa na frente da confirmação', async () => {
    fichas = [ficha({ quando: emMinutos(5) })];
    expect(await tick()).toMatchObject({ confirmacoes: 1, lembretes_5min: 0 });
    expect(enviadas[0].bolhas.join(' ')).toContain('está confirmada');
  });

  it('backlog antigo entra em fila lenta: 1 por rodada', async () => {
    fichas = [1, 2, 3].map(id => ficha({ id, quando: emMinutos(3 * 24 * 60), cliente_telefone: `553499111000${id}` }));
    expect((await tick()).confirmacoes).toBe(1);
  });

  // Foi exatamente isto que bloqueou o 5040 em 04/08: às 08h BRT a janela abriu
  // com a fila acumulada da noite e a drenagem soltou 8 pessoas na mesma hora —
  // 37 mensagens numa linha cujo teto é 12, porque este agente não consultava o teto.
  it('backlog respeita o teto anti-ban da linha', async () => {
    tetoLivre = false;
    fichas = [ficha({ quando: emMinutos(3 * 24 * 60) })];
    expect((await tick()).confirmacoes).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  // A outra metade da regra: reunião acontecendo AGORA fura o teto de propósito.
  // Segurar o "é agora, o consultor está te esperando" por teto é perder a reunião.
  it('mas o chamado de 5 minutos fura o teto', async () => {
    tetoLivre = false;
    fichas = [fichaConfirmada({ quando: emMinutos(5), lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    expect((await tick()).lembretes_5min).toBe(1);
  });

  it('todo envio deixa carimbo pro teto enxergar', async () => {
    fichas = [fichaConfirmada()];
    await tick();
    expect(carimbos).toEqual(['ep_agenda_sent:1:1h']);
  });

  it('backlog não é confirmado de madrugada', async () => {
    vi.setSystemTime(new Date('2026-08-04T06:00:00.000Z'));  // 3h BRT
    fichas = [ficha({ quando: '2026-08-07T16:00:00.000Z' })];
    expect((await tick()).confirmacoes).toBe(0);
  });

  // INVERTIDO em 10/08/2026. Era "backlog com reunião em cima da hora NÃO recebe
  // confirmação atrasada" — e era esse gate (BACKLOG_ANTECEDENCIA_MIN = 120 min) que
  // deixava lead marcado ficar sem confirmação nenhuma pra sempre. Confirmação
  // atrasada ainda diz o horário, o consultor e que o link vem no chat; silêncio não
  // diz nada. As outras travas do backlog (1 por rodada, janela 08–20h, teto da
  // linha) continuam valendo — o que saiu foi só a distância mínima da reunião.
  it('backlog com reunião em cima da hora recebe a confirmação assim mesmo', async () => {
    fichas = [ficha({ quando: emMinutos(90), lembrete_1h_at: '2026-08-04T15:00:00.000Z' })];
    expect((await tick()).confirmacoes).toBe(1);
    expect(enviadas[0].bolhas.join(' ')).toContain('está confirmada');
  });

  it('já confirmado não confirma de novo', async () => {
    fichas = [ficha({ quando: emMinutos(3 * 24 * 60), confirmacao_at: '2026-08-01T12:00:00.000Z' })];
    expect((await tick()).confirmacoes).toBe(0);
  });
});

describe('o que ele fala', () => {
  it('a confirmação leva dia, hora, consultor e o pedido de SIM', async () => {
    const { bolhasConfirmacao } = await mod();
    const txt = bolhasConfirmacao('Irineu de Almeida', '2026-08-05T18:30:00.000Z', 'Diego').join(' ');
    expect(txt).toContain('Irineu');
    expect(txt).toContain('Diego');
    expect(txt).toContain('quarta-feira, 05/08 às 15h30');
    expect(txt).toContain('SIM');
    expect(txt).toContain('remarco');
  });

  // Pedido do dono: horário desmarcado em cima da hora não volta pra agenda, e a
  // procura é alta. O "avisa antes" só cola se vier com o motivo.
  it('a confirmação pede antecedência pra desmarcar, com o motivo junto', async () => {
    const { bolhasConfirmacao } = await mod();
    const txt = bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego').join(' ');
    expect(txt).toContain('desmarcar');
    expect(txt).toContain('avisa antes');
    expect(txt).toContain('procura está alta');
  });

  it('nenhum toque afirma que o link JÁ foi enviado — quem manda é gente', async () => {
    const { bolhasConfirmacao, bolhas1h, bolhas5min } = await mod();
    for (const bolhas of [
      bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego'),
      bolhas1h('Irineu', '2026-08-05T18:30:00.000Z', 'Diego'),
      bolhas5min('Irineu', '2026-08-05T18:30:00.000Z', 'Diego'),
    ]) {
      const txt = bolhas.join(' ');
      expect(txt).toContain('link');
      expect(txt).not.toMatch(/link já (está|foi)|te mandei o link|link enviado/i);
    }
  });

  // O pedido de SIM é a única alavanca real contra o no-show. Ele é a 3ª de 5
  // partes da confirmação, e o sendHuman re-fatia tudo com teto de 5 bolhas — se
  // um dia esse reagrupamento passar a cortar, é ESTA linha que se perde primeiro.
  it('o pedido de SIM sobrevive ao fatiamento em bolhas do envio', async () => {
    const { emBolhas } = await import('../services/agents/bolhas');
    const { bolhasConfirmacao } = await mod();
    // maxBolhas 3 é o que o entregar() passa pra este agente desde 31/08/2026:
    // o padrão da casa caiu pra 2 e afundaria o SIM num parágrafo de 404 chars.
    const saida = emBolhas(bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego', '5534991360172').join('||'), { maxBolhas: 3 });
    expect(saida.join(' ')).toContain('*SIM*');
    expect(saida.join(' ')).toContain('05/08 às 15h30');
    // Não basta sobreviver: tem que dar pra ler. Se o pedido de SIM for engolido
    // por um parágrafo de 400 caracteres, ninguém responde e a alavanca some.
    const bolhaDoSim = saida.find(b => b.includes('*SIM*'))!;
    expect(bolhaDoSim.length).toBeLessThan(260);
  });

  // Desde 31/08/2026 a confirmação SAI reagrupada, de 5 bolhas para 3, e isso é
  // deliberado: ela é o maior emissor da linha (5,22 bolhas por toque medidas em
  // 30 dias) e o WhatsApp conta bolha, não toque. O que este teste guarda mudou
  // de "não reagrupa" para "reagrupa até 3 e nenhuma ideia se perde": as três
  // informações que fazem a pessoa aparecer (dia e hora, que é por vídeo, e o
  // pedido de SIM) continuam todas lá, e o SIM continua legível, o que o teste
  // anterior verifica em separado.
  it('a confirmação reagrupa em 3 bolhas sem perder nenhuma ideia', async () => {
    const { emBolhas } = await import('../services/agents/bolhas');
    const { bolhasConfirmacao } = await mod();
    // O pior caso mora na 1ª bolha e é o mais longo que a régua consegue montar:
    // nome grande + o fallback "nosso consultor" + "segunda-feira" (o dia de nome
    // mais comprido). Ela fecha em 156 de 160 — margem curta de propósito, e é
    // exatamente por isso que este teste existe.
    for (const partes of [
      bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego', '5534991360172'),
      bolhasConfirmacao('Wanderleia', '2026-08-17T20:30:00.000Z', null, '5534991360172'),
      bolhasConfirmacao('Wanderleia', '2026-08-17T20:30:00.000Z', null),
    ]) {
      const saida = emBolhas(partes.join('||'), { maxBolhas: 3 });
      expect(saida.length).toBeLessThanOrEqual(3);
      // Nada some: o texto inteiro sobrevive, só as fronteiras é que cedem.
      const semEsp = (s: string) => s.replace(/\s+/g, '');
      expect(semEsp(saida.join(''))).toBe(semEsp(partes.join('')));
    }
  });

  // Primeira mensagem que o lead recebe da linha IO, de um número que ele nunca
  // viu. Sem remetente é o cenário do "não solicitei nenhum serviço".
  it('a confirmação se apresenta pela marca', async () => {
    const { bolhasConfirmacao } = await mod();
    expect(bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego')[0]).toContain('Irmãos na Obra');
  });

  // Sem número cadastrado não dá pra mandar salvar contato nenhum — a frase
  // inteira some, não vira "salva o contato" sem contato à vista.
  it('sem WhatsApp do consultor, a confirmação não manda salvar contato', async () => {
    const { bolhasConfirmacao } = await mod();
    const txt = bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego').join(' ');
    expect(txt).toContain('link');
    expect(txt).not.toContain('salva o contato');
  });

  // Quem manda o link é o consultor, do WhatsApp dele. A copy antiga mandava o
  // lead esperar "neste chat" e ele ficava olhando a janela errada.
  it('o link vem do número do consultor, não deste chat', async () => {
    const { bolhasConfirmacao, bolhas1h, bolhas5min } = await mod();
    const q = '2026-08-05T18:30:00.000Z';
    for (const b of [
      bolhasConfirmacao('Irineu', q, 'Diego', '5534991360172'),
      bolhas1h('Irineu', q, 'Diego', '5534991360172'),
      bolhas5min('Irineu', q, 'Diego', '5534991360172'),
    ]) {
      const txt = b.join(' ');
      expect(txt).toContain('(34) 99136-0172');
      expect(txt).not.toMatch(/neste chat|aqui neste/i);
    }
  });

  // Pedido do dono: a reunião de antes estica quando vai pra fechamento. Sem o
  // aviso, o lead que espera 10 minutos acha que furaram com ele.
  it('os três toques avisam que pode atrasar um pouco', async () => {
    const { bolhasConfirmacao, bolhas1h, bolhas5min } = await mod();
    const q = '2026-08-05T18:30:00.000Z';
    for (const b of [
      bolhasConfirmacao('Irineu', q, 'Diego'),
      bolhas1h('Irineu', q, 'Diego'),
      bolhas5min('Irineu', q, 'Diego'),
    ]) {
      expect(b.join(' ')).toContain('a reunião de antes costuma esticar quando o cliente fecha');
    }
  });

  // Pedido do dono: a primeira reunião rende muito mais se o lead já mandar o
  // que tem. Sem isso o consultor gasta a hora perguntando onde é o ponto.
  it('a confirmação pede o material do eletroposto', async () => {
    const { bolhasConfirmacao } = await mod();
    const txt = bolhasConfirmacao('Irineu', '2026-08-05T18:30:00.000Z', 'Diego').join(' ');
    for (const pedaco of ['onde é', 'conta de luz', 'pesquisou', 'áudio']) {
      expect(txt).toContain(pedaco);
    }
  });

  // Bug real, visto em produção em 04/08: a reunião das 14:00 virou "14h0" na
  // mensagem do lead. `minute: '2-digit'` sozinho é ignorado pela spec do Intl.
  it('hora e minuto sempre com dois dígitos', async () => {
    const { horaCurta, quandoPorExtenso } = await mod();
    expect(horaCurta('2026-08-04T17:00:00.000Z')).toBe('14h00');   // o caso que quebrou
    expect(horaCurta('2026-08-04T12:05:00.000Z')).toBe('09h05');   // hora e minuto de 1 dígito
    expect(horaCurta('2026-08-04T03:00:00.000Z')).toBe('00h00');   // meia-noite não é "24h"
    expect(quandoPorExtenso('2026-08-04T17:00:00.000Z')).toBe('terça-feira, 04/08 às 14h00');
  });

  it('sem nome utilizável, a mensagem não sai quebrada', async () => {
    const { bolhas5min } = await mod();
    expect(bolhas5min('lead', '2026-08-05T18:30:00.000Z', null)[0]).toMatch(/^É agora!/);
  });
});

// O lead precisa saber de qual número o consultor fala com ele — foi por não
// saber disso que a régua de solar virou "não solicitei nenhum serviço".
describe('telefone do consultor', () => {
  it('os três toques levam o WhatsApp do consultor, formatado', async () => {
    const { bolhasConfirmacao, bolhas1h, bolhas5min } = await mod();
    const q = '2026-08-05T18:30:00.000Z';
    for (const b of [
      bolhasConfirmacao('Irineu', q, 'Diego', '5534991360172'),
      bolhas1h('Irineu', q, 'Diego', '5534991360172'),
      bolhas5min('Irineu', q, 'Diego', '5534991360172'),
    ]) {
      expect(b.join(' ')).toContain('(34) 99136-0172');
    }
  });

  it('o número sai do cadastro `consultores`, casando pelo nome do vendedor', async () => {
    fichas = [fichaConfirmada({ vendedor_nome: 'Thiago' })];
    await tick();
    expect(enviadas[0].bolhas.join(' ')).toContain('(34) 99136-0223');
  });

  it('consultor sem WhatsApp cadastrado: a frase some, não vira número quebrado', async () => {
    consultores = [{ nome: 'Diego', whatsapp: null }];
    fichas = [fichaConfirmada()];
    await tick();
    const txt = enviadas[0].bolhas.join(' ');
    expect(txt).toContain('1 hora');
    expect(txt).not.toContain('()');
    expect(txt).not.toMatch(/WhatsApp dele é \*\*/);
  });

  it('número torto no cadastro não vira mensagem', async () => {
    const { telefoneBonito } = await mod();
    expect(telefoneBonito('5534991360172')).toBe('(34) 99136-0172');
    expect(telefoneBonito('3499136017')).toBe('(34) 9913-6017');
    expect(telefoneBonito('123')).toBe('');
    expect(telefoneBonito(null)).toBe('');
  });
});

// Quem marca hoje pra hoje é resolvido pela confirmação. Quem marcou ONTEM, ou
// semana passada, viu a confirmação rolar pra fora da conversa e chega no dia da
// reunião sem nada — é esse buraco que o bom dia das 8h fecha.
describe('bom dia de quem marcou em outro dia', () => {
  // 04/08/2026, 08h30 BRT (11h30 UTC). Dentro da janela do bom dia (08h–11h).
  const MANHA = new Date('2026-08-04T11:30:00.000Z');
  /** Reunião HOJE às 14h BRT (5h30 de distância), marcada 3 dias atrás. */
  const fichaDeHoje = (over: Partial<any> = {}) => fichaConfirmada({
    quando: '2026-08-04T17:00:00.000Z', created_at: '2026-08-01T12:00:00.000Z', ...over,
  });

  beforeEach(() => { vi.setSystemTime(MANHA); fichas = [fichaDeHoje()]; });

  it('recebe o bom dia, com hora, consultor e o WhatsApp dele', async () => {
    const r = await tick();
    expect(r.lembretes_manha).toBe(1);
    const txt = enviadas[0].bolhas.join(' ');
    expect(txt).toContain('Bom dia');
    expect(txt).toContain('14h00');
    expect(txt).toContain('Diego');
    expect(txt).toContain('(34) 99136-0172');
    expect(txt).toContain('remarco');
  });

  // O bom dia não tem coluna em `agendamentos`: quem segura o envio dobrado é o
  // carimbo do system_state, o mesmo que o teto anti-ban já grava.
  it('não grava flag na ficha — o controle é o carimbo', async () => {
    await tick();
    expect(updates).toEqual([]);
    expect(carimbos).toContain('ep_agenda_sent:1:manha');
  });

  it('não manda duas vezes', async () => {
    expect((await tick()).lembretes_manha).toBe(1);
    enviadas.length = 0;
    expect((await tick()).lembretes_manha).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('ficha que o repasse moveu pra hoje RECEBE o bom dia, mesmo com carimbo de ontem', async () => {
    // `processar_repasses()` muda o dia da reunião e não apaga carimbo nenhum —
    // ela é SQL no banco e não conhece o system_state. Enquanto a leitura só
    // perguntava "existe?", essa ficha nunca mais recebia bom dia nenhum.
    carimbos.push('ep_agenda_sent:1:manha');
    carimboEm.set('ep_agenda_sent:1:manha', '2026-08-03T11:00:00.000Z');
    expect((await tick()).lembretes_manha).toBe(1);
  });

  it('quem marcou HOJE pra hoje não recebe — a confirmação acabou de sair', async () => {
    fichas = [fichaDeHoje({ created_at: '2026-08-04T11:00:00.000Z' })];
    expect((await tick()).lembretes_manha).toBe(0);
  });

  // A janela vai até o meio-dia (não 11h) porque o teto da linha é 6/h e é
  // COMPARTILHADO — numa manhã movimentada a grade cheia não drena em 3 horas.
  it('vale até as 11h59, e nem um minuto depois', async () => {
    vi.setSystemTime(new Date('2026-08-04T14:50:00.000Z')); // 11h50 BRT
    expect((await tick()).lembretes_manha).toBe(1);

    carimbos.length = 0;
    vi.setSystemTime(new Date('2026-08-04T15:10:00.000Z')); // 12h10 BRT
    expect((await tick()).lembretes_manha).toBe(0);
  });

  it('fora da janela da manhã não sai', async () => {
    vi.setSystemTime(new Date('2026-08-04T16:00:00.000Z')); // 13h BRT
    expect((await tick()).lembretes_manha).toBe(0);
  });

  // A folga caiu de 2h pra 1h em 30/08/2026 (ordem do Thiago: "todos têm que
  // receber essa msg na parte da manhã"). Uma reunião a 1h30 daqui, que antes
  // ficava só com o toque de 1h, PASSA a receber o bom dia.
  it('reunião a 1h30 daqui recebe o bom dia', async () => {
    fichas = [fichaDeHoje({ quando: '2026-08-04T13:00:00.000Z' })]; // 1h30 de distância
    expect((await tick()).lembretes_manha).toBe(1);
  });

  // Abaixo da folga quem fala é o toque de 1h: "hoje é o dia" 40 minutos antes é
  // a mesma informação duas vezes.
  it('reunião perto demais fica pro toque de 1h', async () => {
    fichas = [fichaDeHoje({ quando: '2026-08-04T12:10:00.000Z' })]; // 40 min de distância
    expect((await tick()).lembretes_manha).toBe(0);
  });

  it('reunião de amanhã espera a manhã dela', async () => {
    fichas = [fichaDeHoje({ quando: '2026-08-05T17:00:00.000Z' })];
    expect((await tick()).lembretes_manha).toBe(0);
  });

  // Este é o único toque que sai em LOTE — todo mundo do dia na mesma faixa de
  // horário. É o único que consegue fazer rajada sozinho, e rajada bloqueou a
  // linha IO duas vezes.
  // 3 desde 30/08/2026 (era 2): a agenda passou a caber 36 reuniões num dia só e
  // o lote de 2 não drenava dentro da janela da manhã.
  it('no máximo 3 por rodada, e nenhum com o teto da linha estourado', async () => {
    fichas = [1, 2, 3, 4, 5].map(id => fichaDeHoje({ id, cliente_telefone: `553499111000${id}` }));
    expect((await tick()).lembretes_manha).toBe(3);

    carimbos.length = 0; enviadas.length = 0; tetoLivre = false;
    expect((await tick()).lembretes_manha).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  // Sem conseguir ler o carimbo não dá pra saber quem já recebeu. Repetir o bom
  // dia é pior que pular: o toque de 1h ainda pega a pessoa no mesmo dia.
  it('carimbo ilegível segura o toque em vez de arriscar mandar de novo', async () => {
    leituraCarimboFalha = true;
    expect((await tick()).lembretes_manha).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('ficha de solar não recebe bom dia de eletroposto', async () => {
    fichas = [fichaDeHoje({ created_by: 'lead-meta' })];
    expect((await tick()).lembretes_manha).toBe(0);
  });
});

describe('travas', () => {
  it('kill-switch desliga tudo', async () => {
    process.env.EP_LEMBRETES_OFF = '1';
    vi.resetModules();
    expect((await tick()).motivo).toBe('desligado');
    expect(enviadas).toHaveLength(0);
  });

  it('dry mostra o que sairia e não envia nem marca flag', async () => {
    fichas = [fichaConfirmada()];
    const r = await tick({ dry: true });
    expect(r.motivo).toBe('dry');
    expect(r.previa?.[0]).toMatchObject({ id: 1, toque: '1h' });
    expect(enviadas).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('teto de toques por rodada segura a rajada na linha', async () => {
    fichas = Array.from({ length: 10 }, (_, i) => fichaConfirmada({
      id: i + 1, quando: emMinutos(60), cliente_telefone: `55349911100${String(i).padStart(2, '0')}`,
    }));
    expect((await tick()).lembretes_1h).toBe(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NÃO ATENDIDO AUTOMÁTICO (ordem do Thiago, 14/08/2026).
// "Passou por muita mensagem; se nem a de 1 hora antes, quando passar 15 minutos
// e nada, já joga essa condição." O gatilho é o lembrete de 1h + 15 min de
// silêncio — e cai ANTES da reunião, então é previsão, não fato. Todo o desenho
// aqui é sobre essa previsão ser reversível e não atropelar gente.
// ─────────────────────────────────────────────────────────────────────────────
describe('não atendido automático', () => {
  /** Recebeu o lembrete de 1h faz `min` minutos e nunca confirmou. */
  const caladaDesde = (min: number, over: Partial<any> = {}) => fichaConfirmada({
    quando: emMinutos(45),
    lembrete_1h_at: new Date(AGORA.getTime() - min * 60_000).toISOString(),
    presenca_confirmada_at: null,
    ...over,
  });
  const marcados = () => updates.filter(u => String(u.campo).includes('status'));

  it('15 minutos depois do lembrete de 1h sem confirmar, vira NÃO ATENDIDO', async () => {
    fichas = [caladaDesde(15)];
    expect((await tick()).nao_atendeu).toBe(1);
    expect(marcados()).toHaveLength(1);
  });

  it('14 minutos ainda não é: o relógio é o do dono, não "mais ou menos"', async () => {
    fichas = [caladaDesde(14)];
    expect((await tick()).nao_atendeu).toBe(0);
  });

  it('quem confirmou presença nunca é marcado', async () => {
    fichas = [caladaDesde(60, { presenca_confirmada_at: '2026-08-04T15:00:00.000Z' })];
    expect((await tick()).nao_atendeu).toBe(0);
  });

  // "Qual o link?" deixa presenca_confirmada_at nulo e NÃO é ausência: é gente
  // conversando. Marcá-lo de ausente 40 min antes é a marca que alguém teria
  // que desfazer na mão.
  it('quem ESCREVEU alguma coisa não é dado como ausente', async () => {
    fichas = [caladaDesde(60, { id: 7 })];
    carimbos.push('ep_resposta:7');
    expect((await tick()).nao_atendeu).toBe(0);
  });

  // O `ep_resposta:<id>` mora no outro projeto, guarda só o id e nunca é
  // apagado. Desde que o reagendamento automático (20/08) recomeça a régua do
  // zero, um "SIM" de ANTES da confirmação vigente é de outro ciclo — e se ele
  // continuasse valendo, a ficha voltaria pra agenda e nunca mais poderia ficar
  // vermelha: o ciclo travaria na primeira volta.
  it('marcador de resposta ANTERIOR à confirmação vigente é de outro ciclo e não segura mais nada', async () => {
    fichas = [caladaDesde(60, { id: 7, confirmacao_at: '2026-08-03T12:00:00.000Z' })];
    carimbos.push('ep_resposta:7');
    carimboEm.set('ep_resposta:7', '2026-07-30T09:00:00.000Z');
    expect((await tick()).nao_atendeu).toBe(1);
  });

  // A outra metade: ficha ainda sem confirmação (backlog, ou o instante entre
  // remarcar e avisar). Aí não há ciclo pra comparar e o marcador vale cheio —
  // lado conservador, não dar de ausente quem talvez esteja falando.
  it('sem confirmação na ficha, o marcador de resposta vale cheio', async () => {
    fichas = [caladaDesde(60, { id: 7, confirmacao_at: null })];
    carimbos.push('ep_resposta:7');
    carimboEm.set('ep_resposta:7', '2026-07-30T09:00:00.000Z');
    expect((await tick()).nao_atendeu).toBe(0);
  });

  // Sem o lembrete de 1h não existe o relógio que o Thiago descreveu. É o caso
  // de quem marca em cima da hora (a LP vende até 30 min antes).
  it('quem nunca recebeu o lembrete de 1h fica de fora', async () => {
    fichas = [fichaConfirmada({ quando: emMinutos(45), lembrete_1h_at: null })];
    expect((await tick()).nao_atendeu).toBe(0);
  });

  it('não marca duas vezes a mesma ficha', async () => {
    fichas = [caladaDesde(60, { id: 9 })];
    carimbos.push('ep_nao_atendeu_auto:9');
    expect((await tick()).nao_atendeu).toBe(0);
  });

  // A marca é o status; o silêncio não é. O toque de 5 min é a mensagem de maior
  // intenção do fluxo — calá-la transformaria a previsão em profecia.
  it('quem foi marcado CONTINUA recebendo o toque de 5 minutos', async () => {
    fichas = [fichaConfirmada({
      status: 'nao_atendeu', quando: emMinutos(4),
      lembrete_1h_at: '2026-08-04T15:00:00.000Z', lembrete_5min_at: null,
    })];
    expect((await tick()).lembretes_5min).toBe(1);
  });

  it('mas não recebe mais confirmação nem "falta 1 hora"', async () => {
    fichas = [ficha({ status: 'nao_atendeu', quando: emMinutos(60), confirmacao_at: null })];
    const r = await tick();
    expect(r.confirmacoes).toBe(0);
    expect(r.lembretes_1h).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('kill-switch próprio desliga só a marcação', async () => {
    process.env.EP_NAO_ATENDEU_AUTO_OFF = '1';
    vi.resetModules();
    fichas = [caladaDesde(60, { quando: emMinutos(4), lembrete_5min_at: null })];
    const r = await tick();
    expect(r.nao_atendeu).toBe(0);
    expect(r.lembretes_5min).toBe(1);   // o resto do agente continua vivo
  });

  it('dry conta quem seria marcado e não escreve nada', async () => {
    fichas = [caladaDesde(30)];
    const r = await tick({ dry: true });
    expect(r.nao_atendeu).toBe(1);
    expect(updates).toHaveLength(0);
  });

  // Achado nos dados de producao antes da primeira rodada: existe ficha com o
  // lembrete de 1h carimbado ONTEM e a reuniao movida na mao pra HOJE (o CRM nao
  // limpa a flag; so' o robo de remarcacao limpa). Sem guarda, ela seria dada
  // como ausente na hora, horas antes da reuniao de hoje.
  it('lembrete de 1h de OUTRO dia não marca ninguém', async () => {
    fichas = [fichaConfirmada({
      quando: emMinutos(120),
      lembrete_1h_at: new Date(AGORA.getTime() - 26 * 60 * 60_000).toISOString(),
    })];
    expect((await tick()).nao_atendeu).toBe(0);
  });

  it('cancelado não entra na varredura', async () => {
    fichas = [caladaDesde(60, { status: 'cancelado' })];
    expect((await tick()).nao_atendeu).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// O CORTE DAS 13H (ordem do Thiago, 19/08/2026)
//
// "O segundo contato às 8h — ele não atender até as 13h, coloca ele vermelho e
// libera o horário dele na agenda."
//
// O risco aqui não é deixar de marcar: é marcar de ausente, com horas de
// antecedência, quem ia aparecer — e ainda vender o horário dele pra outra
// pessoa. Por isso todo teste abaixo é sobre QUEM FICA DE FORA.
// ─────────────────────────────────────────────────────────────────────────────
describe('corte das 13h', () => {
  /** Reunião hoje às 18h BRT (o relógio dos testes é 13h BRT), confirmada,
   *  marcada num dia anterior — o retrato de quem levou o bom dia de manhã. */
  const daTarde = (over: any = {}) => fichaConfirmada({ id: 7, quando: emMinutos(300), lead_resposta_at: null, ...over });
  const comBomDia = () => { carimbos.push('ep_agenda_sent:7:manha'); };

  beforeEach(() => { fichas = [daTarde()]; });

  it('quem levou o bom dia e não respondeu nada vira vermelho', async () => {
    comBomDia();
    const r = await tick();
    expect(r.vermelho_13h).toBe(1);
    expect(r.nao_atendeu).toBe(1);                       // o total soma as duas réguas
    expect(updates).toContainEqual({ id: 7, campo: 'status+historico' });
    // A prova de que a marca é do ROBÔ — é ela que deixa o agente de respostas
    // desfazer tudo se a pessoa aparecer falando.
    expect(carimbos).toContain('ep_nao_atendeu_auto:7');
  });

  it('antes das 13h ninguém é marcado — a manhã inteira é dele', async () => {
    comBomDia();
    vi.setSystemTime(new Date('2026-08-04T14:00:00.000Z'));   // 11h BRT
    expect((await tick()).vermelho_13h).toBe(0);
  });

  it('sem o segundo contato não há corte (quem marcou hoje pra hoje fica de fora)', async () => {
    const r = await tick();                                   // nenhum carimbo de bom dia
    expect(r.vermelho_13h).toBe(0);
  });

  it('quem escreveu qualquer coisa não é ausente', async () => {
    comBomDia();
    fichas = [daTarde({ lead_resposta_at: '2026-08-04T15:00:00.000Z' })];
    expect((await tick()).vermelho_13h).toBe(0);
  });

  it('quem confirmou presença não é ausente', async () => {
    comBomDia();
    fichas = [daTarde({ presenca_confirmada_at: '2026-08-04T15:00:00.000Z' })];
    expect((await tick()).vermelho_13h).toBe(0);
  });

  it('reunião que JÁ PASSOU não entra: não há horário pra devolver', async () => {
    comBomDia();
    fichas = [daTarde({ quando: emMinutos(-2) })];
    expect((await tick()).vermelho_13h).toBe(0);
  });

  it('reunião de OUTRO DIA não entra: o bom dia dela ainda nem saiu', async () => {
    comBomDia();
    fichas = [daTarde({ quando: emMinutos(60 * 24) })];
    expect((await tick()).vermelho_13h).toBe(0);
  });

  it('não marca duas vezes quem alguém devolveu pra agendado na mão', async () => {
    comBomDia();
    carimbos.push('ep_nao_atendeu_auto:7');
    expect((await tick()).vermelho_13h).toBe(0);
  });

  it('carimbo de bom dia de ONTEM não conta — o repasse move a ficha e não apaga carimbo', async () => {
    // `processar_repasses()` é SQL no banco: ela troca o dia da reunião e não
    // conhece o system_state. Sem olhar a data, esta ficha seria marcada de
    // ausente hoje alegando um segundo contato que foi de outra reunião.
    comBomDia();
    carimboEm.set('ep_agenda_sent:7:manha', '2026-08-03T11:00:00.000Z');
    expect((await tick()).vermelho_13h).toBe(0);
  });

  it('kill-switch próprio, sem derrubar a régua do lembrete de 1h', async () => {
    comBomDia();
    process.env.EP_CORTE_13H_OFF = '1';
    expect((await tick()).vermelho_13h).toBe(0);
  });

  it('dry conta e não escreve nada', async () => {
    comBomDia();
    const r = await tick({ dry: true });
    expect(r.vermelho_13h).toBe(1);
    expect(updates).toHaveLength(0);
    expect(carimbos).not.toContain('ep_nao_atendeu_auto:7');
  });
});
