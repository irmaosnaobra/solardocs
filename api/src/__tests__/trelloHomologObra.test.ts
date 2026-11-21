import { describe, it, expect, vi } from 'vitest';

// Homologação lida do Trello (20/11/2026): a ligação da sincronia com a obra (`homologarObra`): elegibilidade, intervalo de 10 min, trava para dois GETs
// juntos, falha do Trello e a CONCLUSÃO AUTOMÁTICA com o autor que o chefe-antiban definiu (`trello` só na mudança vista; `leitura` na primeira leitura e
// na rodada das 08:00 com a fila dos donos por sair). Tudo simulado (cartão, bucket, registro, trava, conclusão). Nada envia mensagem.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {}, geradorComServiceKey: false }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('../services/gerador/vendaSolarHub', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/vendaSolarHub')>()),
  lerCardsPorIds: vi.fn(async () => new Map([[304, { id: 304 }]])),
  lerLigacao: vi.fn(async () => ({ lig: { trello_card: 'c'.repeat(24) } })),
}));

import { homologarObra, homologarDaFila, type IoHomolog } from '../routes/geradorJornadaHomolog';
import { lerLigacao } from '../services/gerador/vendaSolarHub';
import { registroHomologVazio, type RegistroHomolog } from '../services/gerador/trelloHomologPuro';
import type { DepsHomolog } from '../services/gerador/trelloHomologSync';
import { estadoMaterializado, type EstadoJornada } from '../services/gerador/jornadaSolar';
import type { CardVendido } from '../services/gerador/fichaEletroposto';

const AGORA = new Date('2026-11-20T15:00:00.000Z');
const CARTAO = 'c'.repeat(24);
const CARD = { id: 304 } as unknown as CardVendido;
const js3 = (): EstadoJornada => estadoMaterializado(304, 'nilce', 3, '2026-11-19T12:00:00.000Z');

interface Cenario {
  reg: RegistroHomolog;
  parecerAprovado: boolean;
  slots: string[];
  trelloFora: boolean;
  credencial: boolean;
  cardId: string | null;
  conclusao: 'concluiu' | 'nao_pronto' | 'ignorada';
}
function montar(o: Partial<Cenario> = {}) {
  const c: Cenario = { reg: registroHomologVazio(), parecerAprovado: true, slots: ['parecer_acesso'], trelloFora: false, credencial: true, cardId: CARTAO, conclusao: 'concluiu', ...o };
  const log = { sincronias: 0, conclusoes: [] as string[], travas: 0 };
  let ocupada = false;
  const deps: DepsHomolog = {
    agora: () => AGORA,
    credenciais: () => (c.credencial ? { key: 'k', token: 't' } : null),
    lerCartao: async () => {
      log.sincronias++;
      return c.trelloFora ? { ok: false, motivo: 'Trello respondeu 500' } : { ok: true, dados: { url: null, checklist: [{ nome: 'Parecer Aprovado', feito: c.parecerAprovado }], anexos: [] } };
    },
    baixar: async () => ({ ok: false, motivo: 'rede', definitivo: false }),
    lerPorIa: async () => null,
    slotsComArquivo: async () => new Set(c.slots),
    anexosEnviados: async () => new Set(),
    registrar: async () => ({ ok: false, motivo: 'invalido' }),
    marcarNoTrello: async () => true,
    preencherProtocolo: async () => 'ja_tinha',
    lerRegistro: async () => c.reg,
    gravarRegistro: async (r) => { c.reg = r; },
  };
  const io: IoHomolog = {
    agora: () => AGORA,
    deps: () => deps,
    cardId: async () => c.cardId,
    lerRegistro: async () => c.reg,
    trava: async (_card, fn) => {
      if (ocupada) return 'ocupado';
      ocupada = true; log.travas++;
      try { return await fn(); } finally { ocupada = false; }
    },
    concluir: async (_card, autor) => { log.conclusoes.push(autor); return c.conclusao; },
  };
  return { c, io, log };
}
const entrada = (o: Partial<Parameters<typeof homologarObra>[1]> = {}): Parameters<typeof homologarObra>[1] => ({ js: js3(), jo: null, origem: 'tela', ...o });

describe('quando a obra é lida', () => {
  it('só com a etapa 3 aberta, sem cancelar e sem a fase 2 fechada', async () => {
    const { io, log } = montar();
    expect(await homologarObra(CARD, entrada({ js: estadoMaterializado(304, 'nilce', 4, AGORA.toISOString()) }), io)).toBe('inelegivel');
    expect(await homologarObra(CARD, entrada({ js: { ...js3(), cancelada: { em: AGORA.toISOString(), por: 'x', etapa: 3, com_numero: true } } }), io)).toBe('inelegivel');
    expect(await homologarObra(CARD, entrada({ jo: { fechada: { em: AGORA.toISOString(), por: 'thiago' } } }), io)).toBe('inelegivel');
    expect(await homologarObra(CARD, entrada({ js: null }), io)).toBe('inelegivel');
    expect(log.sincronias).toBe(0);
  });
  it('sem cartão não lê nada e não conclui (obra sem cartão continua pelo botão); o id da ligação vale se o registro do Trello não tiver', async () => {
    const sem = montar({ cardId: null });
    expect(await homologarObra(CARD, entrada(), sem.io)).toBe('sem_cartao');
    expect(sem.log.sincronias).toBe(0);
    expect(sem.log.conclusoes).toEqual([]);
    const lig = montar({ cardId: null });
    expect(await homologarObra(CARD, entrada({ cardIdLig: CARTAO }), lig.io)).toBe('concluiu');
    expect(lig.log.sincronias).toBe(1);
  });
});

describe('intervalo de 10 min e trava', () => {
  it('menos de 10 min desde a última tentativa: não lê o cartão; com 10 min: lê', async () => {
    const recente = montar({ reg: { ...registroHomologVazio(), tentado_em: new Date(AGORA.getTime() - 9 * 60_000).toISOString() } });
    expect(await homologarObra(CARD, entrada(), recente.io)).toBe('recente');
    expect(recente.log.sincronias).toBe(0);
    const velho = montar({ reg: { ...registroHomologVazio(), tentado_em: new Date(AGORA.getTime() - 10 * 60_000).toISOString() } });
    expect(await homologarObra(CARD, entrada(), velho.io)).not.toBe('recente');
    expect(velho.log.sincronias).toBe(1);
  });
  it('a falha também conta como tentativa: o GET seguinte, dentro de 10 min, não bate no Trello de novo', async () => {
    const { io, log } = montar({ trelloFora: true });
    expect(await homologarObra(CARD, entrada(), io)).toBe('falhou');
    expect(await homologarObra(CARD, entrada(), io)).toBe('recente');
    expect(log.sincronias).toBe(1);
  });
  it('dois GETs juntos: um sincroniza, o outro vê a trava ocupada (ou o registro já novo dentro da trava) e não lê de novo', async () => {
    const { io, log } = montar({ parecerAprovado: false });
    const [a, b] = await Promise.all([homologarObra(CARD, entrada(), io), homologarObra(CARD, entrada(), io)]);
    expect([a, b].sort()).toEqual(['ocupado', 'sincronizou']);
    expect(log.sincronias).toBe(1);
    // trava liberada, registro novo: o próximo (ainda dentro de 10 min) nem entra na trava
    expect(await homologarObra(CARD, entrada(), io)).toBe('recente');
    expect(log.sincronias).toBe(1);
  });
  it('registro que ficou novo entre a leitura de fora e a trava: relido dentro e devolve recente', async () => {
    const { c, io, log } = montar();
    const travaOriginal = io.trava;
    io.trava = async (card, fn) => { c.reg = { ...c.reg, tentado_em: AGORA.toISOString() }; return travaOriginal(card, fn); };   // o outro GET acabou de gravar
    expect(await homologarObra(CARD, entrada(), io)).toBe('recente');
    expect(log.sincronias).toBe(0);
  });
});

describe('falha do Trello nunca quebra', () => {
  it('Trello fora: resultado falhou, erro curto no registro, nenhuma conclusão e nada lançado', async () => {
    const { c, io, log } = montar({ trelloFora: true });
    await expect(homologarObra(CARD, entrada(), io)).resolves.toBe('falhou');
    expect(c.reg.erro).toBeTruthy();
    expect(log.conclusoes).toEqual([]);
  });
  it('sem credencial do Trello: nada acontece', async () => {
    const { io, log } = montar({ credencial: false });
    expect(await homologarObra(CARD, entrada(), io)).toBe('sem_credencial');
    expect(log.conclusoes).toEqual([]);
  });
});

describe('conclusão automática da etapa 3', () => {
  it('conclui com "parecer aprovado" E o arquivo do parecer', async () => {
    const { io, log } = montar({ parecerAprovado: true, slots: ['parecer_acesso'] });
    expect(await homologarObra(CARD, entrada(), io)).toBe('concluiu');
    expect(log.conclusoes).toHaveLength(1);
  });
  it('não conclui só com um dos dois', async () => {
    const soAprovado = montar({ parecerAprovado: true, slots: [] });
    expect(await homologarObra(CARD, entrada(), soAprovado.io)).toBe('sincronizou');
    const soArquivo = montar({ parecerAprovado: false, slots: ['parecer_acesso'] });
    expect(await homologarObra(CARD, entrada(), soArquivo.io)).toBe('sincronizou');
    expect(soAprovado.log.conclusoes).toEqual([]);
    expect(soArquivo.log.conclusoes).toEqual([]);
  });
  it('a conclusão recusada (falta o equipamento, por exemplo) não vira erro: segue como sincronizou', async () => {
    const { io, log } = montar({ conclusao: 'nao_pronto' });
    expect(await homologarObra(CARD, entrada(), io)).toBe('sincronizou');
    expect(log.conclusoes).toHaveLength(1);
  });

  it('PRIMEIRA leitura (sem registro) já completa: conclui com `leitura`, sem aviso', async () => {
    const { io, log } = montar();
    await homologarObra(CARD, entrada({ origem: 'tela' }), io);
    expect(log.conclusoes).toEqual(['leitura']);
  });
  it('a MUDANÇA vista (leitura anterior incompleta, agora completa) conclui com `trello`', async () => {
    const { io, log } = montar({ reg: { ...registroHomologVazio(), completo: false } });
    await homologarObra(CARD, entrada({ origem: 'tela' }), io);
    expect(log.conclusoes).toEqual(['trello']);
  });
  it('completa que continua completa (a conclusão tinha sido recusada antes) conclui com `leitura`', async () => {
    const { io, log } = montar({ reg: { ...registroHomologVazio(), completo: true } });
    await homologarObra(CARD, entrada({ origem: 'tela' }), io);
    expect(log.conclusoes).toEqual(['leitura']);
  });
  it('às 08:00 com a fila do Thiago e do Diego ainda por sair: `leitura` (a fila logo depois já leva a obra)', async () => {
    const { io, log } = montar({ reg: { ...registroHomologVazio(), completo: false } });
    await homologarObra(CARD, entrada({ origem: 'fila', filaDosDonosSaiu: false }), io);
    expect(log.conclusoes).toEqual(['leitura']);
  });
  it('às 08:00 com a fila de um deles já fora: `trello`', async () => {
    const { io, log } = montar({ reg: { ...registroHomologVazio(), completo: false } });
    await homologarObra(CARD, entrada({ origem: 'fila', filaDosDonosSaiu: true }), io);
    expect(log.conclusoes).toEqual(['trello']);
  });
});

describe('a fila das 08:00 usa o cartão da ligação, como o GET', () => {
  it('registro do Trello sem o id, ligação com o cartão: sincroniza', async () => {
    const { io, log } = montar({ cardId: null });
    await homologarDaFila(304, js3(), null, false, io);
    expect(log.sincronias).toBe(1);
  });
  it('sem cartão em lugar nenhum: nada é lido', async () => {
    vi.mocked(lerLigacao).mockResolvedValueOnce({ lig: { trello_card: null } } as never);
    const { io, log } = montar({ cardId: null });
    await homologarDaFila(304, js3(), null, false, io);
    expect(log.sincronias).toBe(0);
  });
});
