import { describe, it, expect, vi, beforeEach } from 'vitest';
import { novoBanco } from './_agentes5040Fake';

// O WhatsApp do depoimento (04/11/2026, robô depoimento_pedido): a janela, os dois relógios, o formulário já respondido, o e-mail do dia, a
// ordem claim -> envio, o telefone só de users.whatsapp e o texto em 1 bolha. Banco em memória; o envio, a linha e as listas são falsos.

const h = vi.hoisted(() => ({ banco: null as any }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.banco.cliente.from(t) } }));

import { AVALIACOES_POR_TICK, depsReaisDepo, runDepoimentoPedidoTick, type CandidatoDepo, type DepsDepo } from '../services/pesquisa/depoimentoWhatsApp';
import { PREFIXO_EMAIL_DEPO, PREFIXO_WA_DEPO, PREFIXO_WA_DEPO_FORA, ROBO_DEPOIMENTO_PEDIDO, textoDepoimentoWhatsApp, type UsuarioPesq } from '../services/pesquisa/regras';
import { dentroDaJanelaDaBaseLinha } from '../services/agents/whatsapp/lineThrottle';
import { reservarChave } from '../services/agentes5040/cota';
import { emBolhas } from '../services/agents/bolhas';

// Quinta-feira, 05/11/2026, 12:00 em Brasília.
const AGORA = new Date('2026-11-05T15:00:00.000Z');

let seq = 0;
const cand = (over: Partial<UsuarioPesq> = {}): CandidatoDepo => {
  seq++;
  const u: UsuarioPesq = { id: `u${seq}`, email: `p${seq}@exemplo.com`, nome: 'ana paula souza', whatsapp: `5534998${100000 + seq}`, plano: 'pro', billing_status: 'active', ...over };
  return { u, tel: String(u.whatsapp), chave: `34998${100000 + seq}`, propostas: 25 };
};

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  delete process.env.DEPOIMENTO_PEDIDO_OFF;
  h.banco = novoBanco();
  seq = 0;
});

interface Cena { lista: CandidatoDepo[]; claimados?: string[]; responderam?: string[]; emailHoje?: string[] }
const montar = (c: Cena, over: Partial<DepsDepo> = {}) => {
  const enviados: Array<{ tel: string; texto: string; claimAntes: boolean }> = [];
  const claims = new Map<string, Record<string, unknown>>();
  const fora = new Map<string, Record<string, unknown>>();
  const posses: Array<{ tel: string; em: string; extra: Record<string, any>; antesDoEnvio: boolean }> = [];
  const desfeitas: string[] = [];
  const d: DepsDepo = {
    desligado: () => false,
    segredoOk: () => true,
    janela: (agora) => dentroDaJanelaDaBaseLinha(agora),
    linhaPausada: async () => 'nao',
    carlaAtendeTodos: async () => true,
    iaParada: async () => false,
    carlaAtende: async () => true,
    registrarLink: async (userId) => `https://solardoc.app/pesquisa/depoimento?t=tok-${userId}`,
    assumirPosse: async (tel, em, extra) => { posses.push({ tel, em, extra, antesDoEnvio: enviados.length === 0 }); return 'assumida'; },
    desfazerPosse: async (tel) => { desfeitas.push(tel); return true; },
    tetoHorario: async () => true,
    espacamento: async () => true,
    candidatos: async () => c.lista,
    filtros: async () => ({ claimados: new Set(c.claimados ?? []), responderam: new Set(c.responderam ?? []), emailHoje: new Set(c.emailHoje ?? []) }),
    listas: async () => ({ silenciado: () => false, bloqueado: () => false, mudo: () => false }),
    supressao: async () => [],
    podeFalarAgora: async () => 'sim',
    telefoneExiste: async () => 'sim',
    contaAgora: async () => ({ plano: 'pro', billing_status: 'active', plano_expira_em: null, whatsapp_opt_out: false }),
    claim: async (chave, valor) => { if (claims.has(chave)) return 'ja'; claims.set(chave, valor); return 'ok'; },
    marcar: async (chave, valor) => { claims.set(chave, valor); },
    descartar: async (id, estado) => { claims.delete(`${PREFIXO_WA_DEPO}${id}`); fora.set(`${PREFIXO_WA_DEPO_FORA}${id}`, { user_id: id, estado }); },
    enviar: async (tel, texto) => { enviados.push({ tel, texto, claimAntes: [...claims.keys()].length > 0 }); return true; },
    ...over,
  };
  return { d, enviados, claims, fora, posses, desfeitas };
};

describe('a janela', () => {
  it('às 21h e no domingo: 0 envios (e nem lê a fila)', async () => {
    for (const quando of ['2026-11-06T00:00:00.000Z', '2026-11-08T15:00:00.000Z', '2026-11-05T11:59:00.000Z', '2026-11-15T15:00:00.000Z' /* feriado da República, domingo */]) {
      const { d, enviados } = montar({ lista: [cand()] });
      const candidatos = vi.spyOn(d, 'candidatos');
      const r = await runDepoimentoPedidoTick({ agora: new Date(quando) }, d);
      expect(r.enviou, quando).toBe(false);
      expect(r.motivo, quando).toBe('fora_da_janela');
      expect(enviados, quando).toHaveLength(0);
      expect(candidatos).not.toHaveBeenCalled();
    }
  });

  it('feriado nacional em dia de semana também não sai (07/09 é segunda)', async () => {
    const { d, enviados } = montar({ lista: [cand()] });
    await runDepoimentoPedidoTick({ agora: new Date('2026-09-07T15:00:00.000Z') }, d);
    expect(enviados).toHaveLength(0);
  });

  it('quinta às 12h e sábado às 10h: sai', async () => {
    for (const quando of ['2026-11-05T15:00:00.000Z', '2026-11-07T13:00:00.000Z']) {
      const { d, enviados } = montar({ lista: [cand()] });
      const r = await runDepoimentoPedidoTick({ agora: new Date(quando) }, d);
      expect(r.enviou, quando).toBe(true);
      expect(enviados, quando).toHaveLength(1);
    }
  });
});

describe('um envio por pessoa', () => {
  it('dois relógios ao mesmo tempo, uma pessoa: 1 envio (o claim é por INSERT)', async () => {
    const c = cand();
    const { d, enviados } = montar({ lista: [c] });
    const [a, b] = await Promise.all([runDepoimentoPedidoTick({ agora: AGORA }, d), runDepoimentoPedidoTick({ agora: AGORA }, d)]);
    expect(enviados).toHaveLength(1);
    expect([a.enviou, b.enviou].filter(Boolean)).toHaveLength(1);
  });

  it('com o banco de verdade (falso): o claim depo_sent:<userId> existe no momento do envio', async () => {
    const c = cand();
    let viuClaim = false;
    const { d } = montar({ lista: [c] }, {
      claim: async (chave, valor, agora) => { const v = await reservarChave(chave, valor, agora); return v === 'reservada' ? 'ok' : v === 'ja_existe' ? 'ja' : 'erro'; },
      enviar: async () => { viuClaim = h.banco.tabelas.system_state.some((l: any) => l.key === `${PREFIXO_WA_DEPO}${c.u.id}`); return true; },
    });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(r.enviou).toBe(true);
    expect(viuClaim).toBe(true);
  });

  it('é 1 por tick, mesmo com fila grande', async () => {
    const { d, enviados } = montar({ lista: [cand(), cand(), cand()] });
    await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(enviados).toHaveLength(1);
  });

  it('quem já respondeu o formulário: 0 envios', async () => {
    const c = cand();
    const { d, enviados } = montar({ lista: [c], responderam: [c.u.id] });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(enviados).toHaveLength(0);
    expect(r.motivo).toBe('ninguem_na_fila');
  });

  it('quem já tem claim, ou recebeu o e-mail de depoimento hoje: 0 envios; o seguinte da fila sai', async () => {
    const [a, b, c] = [cand(), cand(), cand()];
    const { d, enviados } = montar({ lista: [a, b, c], claimados: [a.u.id], emailHoje: [b.u.id] });
    await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(enviados.map(e => e.tel)).toEqual([c.tel]);
  });
});

describe('as travas', () => {
  it('desligado, linha pausada, teto da linha e espaçamento: 0 envios', async () => {
    const casos: Array<[string, Partial<DepsDepo>]> = [
      ['desligado', { desligado: () => true }],
      ['linha_pausada', { linhaPausada: async () => 'sim' }],
      ['leitura_da_pausa_falhou', { linhaPausada: async () => 'erro' }],
      ['teto_da_linha', { tetoHorario: async () => false }],
      ['espacamento_da_linha', { espacamento: async () => false }],
      ['sem_segredo_de_hmac', { segredoOk: () => false }],
    ];
    for (const [motivo, over] of casos) {
      const { d, enviados } = montar({ lista: [cand()] }, over);
      const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
      expect(r.motivo, motivo).toBe(motivo);
      expect(enviados, motivo).toHaveLength(0);
    }
  });

  it('suprimido, bloqueado, mudo e pausa humana: pula a pessoa e vai para a próxima', async () => {
    const [a, b, c, e, f] = [cand(), cand(), cand(), cand(), cand()];
    const { d, enviados } = montar({ lista: [a, b, c, e, f] }, {
      listas: async () => ({ silenciado: (t) => t === a.tel, bloqueado: (t) => t === b.tel, mudo: (t) => t === c.tel }),
      podeFalarAgora: async (t) => (t === e.tel ? 'nao' : 'sim'),
    });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(enviados.map(x => x.tel)).toEqual([f.tel]);
    expect(r.puladas).toMatchObject({ suprimido: 1, bloqueado: 1, mudo: 1, humano_na_conversa: 1 });
  });

  it('a supressão do cadastro (opt-out por mensagem) também barra', async () => {
    const [a, b] = [cand(), cand()];
    const { d, enviados } = montar({ lista: [a, b] }, { supressao: async (t) => (t === a.tel ? ['optout'] : []) });
    await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(enviados.map(x => x.tel)).toEqual([b.tel]);
  });

  it('a conta mudou entre a leitura e o envio (pediu para parar, ou deixou de pagar): não envia, o claim fica', async () => {
    const a = cand();
    const { d, enviados, claims, fora } = montar({ lista: [a] }, { contaAgora: async () => ({ plano: 'pro', billing_status: 'active', plano_expira_em: null, whatsapp_opt_out: true }) });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(enviados).toHaveLength(0);
    expect(r.puladas.conta_mudou).toBe(1);
    expect(fora.get(`${PREFIXO_WA_DEPO_FORA}${a.u.id}`)).toMatchObject({ estado: 'abortou' });
    expect(claims.has(`${PREFIXO_WA_DEPO}${a.u.id}`)).toBe(false);
    const b = cand();
    const m = montar({ lista: [b] }, { contaAgora: async () => ({ plano: 'free', billing_status: 'canceled', plano_expira_em: null, whatsapp_opt_out: false }) });
    await runDepoimentoPedidoTick({ agora: AGORA }, m.d);
    expect(m.enviados).toHaveLength(0);
  });

  it('sem WhatsApp no número: o claim fica (não tenta de novo) e a próxima pessoa sai', async () => {
    const [a, b] = [cand(), cand()];
    const { d, enviados, fora, claims } = montar({ lista: [a, b] }, { telefoneExiste: async (t) => (t === a.tel ? 'nao' : 'sim') });
    await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(fora.get(`${PREFIXO_WA_DEPO_FORA}${a.u.id}`)).toMatchObject({ estado: 'sem_whatsapp' });
    expect(claims.has(`${PREFIXO_WA_DEPO}${a.u.id}`)).toBe(false);
    expect(enviados.map(x => x.tel)).toEqual([b.tel]);
  });

  it('o envio que lança PARA o tick: a pessoa fica como incerta e a seguinte não é tentada', async () => {
    const [a, b] = [cand(), cand()];
    const { d, enviados, claims } = montar({ lista: [a, b] }, { enviar: async () => { throw new Error('z-api caiu'); } });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(r.motivo).toBe('envio_falhou');
    expect(r.enviou).toBe(false);
    expect(claims.get(`${PREFIXO_WA_DEPO}${a.u.id}`)).toMatchObject({ estado: 'incerto' });
    expect(claims.has(`${PREFIXO_WA_DEPO}${b.u.id}`)).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  it('a pausa humana calou o sendFrio (false): para, e o claim fica como nao_saiu', async () => {
    const a = cand();
    const { d, claims, fora } = montar({ lista: [a, cand()] }, { enviar: async () => false });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(r.motivo).toBe('envio_nao_saiu');
    expect(fora.get(`${PREFIXO_WA_DEPO_FORA}${a.u.id}`)).toMatchObject({ estado: 'nao_saiu' });
    expect(claims.has(`${PREFIXO_WA_DEPO}${a.u.id}`)).toBe(false);
  });

  it('avalia no máximo AVALIACOES_POR_TICK pessoas por tick', async () => {
    const lista = Array.from({ length: AVALIACOES_POR_TICK + 3 }, () => cand());
    const { d, enviados } = montar({ lista }, { listas: async () => ({ silenciado: () => true, bloqueado: () => false, mudo: () => false }) });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(r.avaliados).toBe(AVALIACOES_POR_TICK);
    expect(enviados).toHaveLength(0);
  });

  it('o texto vai em 1 bolha, o robô é depoimento_pedido e o prefixo do claim é depo_sent:', async () => {
    const a = cand();
    const { d, enviados } = montar({ lista: [a] });
    await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(emBolhas(enviados[0]!.texto, { maxBolhas: 1, max: 900 })).toHaveLength(1);
    expect(enviados[0]!.texto).toBe(textoDepoimentoWhatsApp('Ana'));
    expect(ROBO_DEPOIMENTO_PEDIDO).toBe('depoimento_pedido');
    expect(PREFIXO_WA_DEPO).toBe('depo_sent:');
    expect(PREFIXO_EMAIL_DEPO).toBe('pesquisa_depo_email:');
  });
});

describe('a resposta tem dona: a posse da Carla com o link do formulário', () => {
  it('abre a posse com origem pedido_depoimento, o link e 7 dias, ANTES do envio', async () => {
    const a = cand();
    const { d, enviados, posses } = montar({ lista: [a] });
    await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(enviados).toHaveLength(1);
    expect(posses).toHaveLength(1);
    expect(posses[0]!.antesDoEnvio).toBe(true);
    expect(posses[0]!.extra.origem).toBe('pedido_depoimento');
    expect(posses[0]!.extra.pedido_depoimento).toMatchObject({ user_id: a.u.id, link: `https://solardoc.app/pesquisa/depoimento?t=tok-${a.u.id}` });
    expect(Date.parse(posses[0]!.extra.pedido_depoimento.ate) - Date.parse(posses[0]!.em)).toBe(7 * 24 * 3_600_000);
  });

  it('sem a Carla atendendo todos, com a IA parada ou sem atender este número: 0 envios e nenhuma posse', async () => {
    const casos: Array<[string, Partial<DepsDepo>]> = [
      ['carla_nao_atende_todos', { carlaAtendeTodos: async () => false }],
      ['ia_parada', { iaParada: async () => true }],
    ];
    for (const [motivo, over] of casos) {
      const m = montar({ lista: [cand()] }, over);
      expect((await runDepoimentoPedidoTick({ agora: AGORA }, m.d)).motivo, motivo).toBe(motivo);
      expect(m.enviados).toHaveLength(0);
      expect(m.posses).toHaveLength(0);
    }
    const n = montar({ lista: [cand()] }, { carlaAtende: async () => false });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, n.d);
    expect(r.puladas.carla_nao_atende).toBe(1);
    expect(n.enviados).toHaveLength(0);
    expect(n.posses).toHaveLength(0);
  });

  it('número que já tem dona: não envia por cima e vai para a próxima pessoa', async () => {
    const [a, b] = [cand(), cand()];
    const { d, enviados } = montar({ lista: [a, b] }, { assumirPosse: async (tel) => (tel === a.tel ? 'ja_tinha_dona' : 'assumida') });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, d);
    expect(r.puladas.posse_ocupada).toBe(1);
    expect(enviados.map(e => e.tel)).toEqual([b.tel]);
  });

  it('posse que não grava, ou token que não grava: para sem enviar', async () => {
    const a = montar({ lista: [cand()] }, { assumirPosse: async () => 'erro' });
    expect((await runDepoimentoPedidoTick({ agora: AGORA }, a.d)).motivo).toBe('posse_falhou');
    expect(a.enviados).toHaveLength(0);
    const b = montar({ lista: [cand()] }, { registrarLink: async () => { throw new Error('x'); } });
    expect((await runDepoimentoPedidoTick({ agora: AGORA }, b.d)).motivo).toBe('token_falhou');
    expect(b.enviados).toHaveLength(0);
  });

  it('a pausa humana calou (nada saiu): a posse volta; o envio que lança deixa a posse (a resposta tem dona)', async () => {
    const a = montar({ lista: [cand()] }, { enviar: async () => false });
    await runDepoimentoPedidoTick({ agora: AGORA }, a.d);
    expect(a.desfeitas).toHaveLength(1);
    const b = montar({ lista: [cand()] }, { enviar: async () => { throw new Error('z-api'); } });
    await runDepoimentoPedidoTick({ agora: AGORA }, b.d);
    expect(b.desfeitas).toHaveLength(0);
  });
});

describe('desfecho sem mensagem: depo_fora:, nunca depo_sent:', () => {
  /** Os deps de verdade para claim, descartar e filtros (banco em memória); o resto é falso. */
  const reais = (c: Cena, over: Partial<DepsDepo> = {}) => {
    const real = depsReaisDepo();
    const m = montar(c, { claim: real.claim, marcar: real.marcar, descartar: real.descartar, filtros: real.filtros, ...over });
    return m;
  };
  const chaves = (prefixo: string): string[] => (h.banco.tabelas.system_state ?? []).filter((l: any) => String(l.key).startsWith(prefixo)).map((l: any) => l.key);

  it('sem WhatsApp, conta que mudou e pausa humana: nada de depo_sent: (não conta como frio), só depo_fora:, e a pessoa não é pedida de novo', async () => {
    const casos: Array<[string, Partial<DepsDepo>]> = [
      ['sem_whatsapp', { telefoneExiste: async () => 'nao' }],
      ['abortou', { contaAgora: async () => 'sumiu' }],
      ['nao_saiu', { enviar: async () => false }],
    ];
    for (const [estado, over] of casos) {
      h.banco = novoBanco();
      const a = cand();
      const m = reais({ lista: [a] }, over);
      await runDepoimentoPedidoTick({ agora: AGORA }, m.d);
      expect(chaves(PREFIXO_WA_DEPO), estado).toEqual([]);
      expect(chaves(PREFIXO_WA_DEPO_FORA), estado).toEqual([`${PREFIXO_WA_DEPO_FORA}${a.u.id}`]);
      expect(h.banco.tabelas.system_state.find((l: any) => l.key === `${PREFIXO_WA_DEPO_FORA}${a.u.id}`).value.estado).toBe(estado);
      // o 2º tick não pede de novo: o filtro lê o depo_fora:
      const m2 = reais({ lista: [a] });
      const r2 = await runDepoimentoPedidoTick({ agora: new Date(AGORA.getTime() + 3_600_000) }, m2.d);
      expect(m2.enviados, estado).toHaveLength(0);
      expect(r2.motivo, estado).toBe('ninguem_na_fila');
    }
  });

  it('o que de fato saiu fica em depo_sent: (e só ele)', async () => {
    const a = cand();
    const m = reais({ lista: [a] });
    const r = await runDepoimentoPedidoTick({ agora: AGORA }, m.d);
    expect(r.enviou).toBe(true);
    expect(chaves(PREFIXO_WA_DEPO)).toEqual([`${PREFIXO_WA_DEPO}${a.u.id}`]);
    expect(h.banco.tabelas.system_state.find((l: any) => l.key === `${PREFIXO_WA_DEPO}${a.u.id}`).value.estado).toBe('enviado');
    expect(chaves(PREFIXO_WA_DEPO_FORA)).toEqual([]);
  });

  it('depo_fora: está FORA das listas de carimbos da linha (não entra na contagem fria)', async () => {
    const { prefixosDaLinha } = await import('../services/agents/whatsapp/lineThrottle');
    const todos = prefixosDaLinha();
    expect(todos.some(p => p.startsWith('depo_fora') || 'depo_fora:x'.startsWith(p))).toBe(false);
  });
});

describe('o telefone vem só de users.whatsapp', () => {
  it('pagante com 20+ propostas e users.whatsapp entra; sem o campo (mesmo com sales.phone e company.whatsapp) fica fora; 19 propostas fica fora', async () => {
    const desde = new Date(AGORA.getTime() - 5 * 24 * 3_600_000).toISOString();
    const base = { plano: 'pro', billing_status: 'active', email: 'x@exemplo.com', nome: 'Fulano' };
    h.banco.tabelas.users = [
      { id: 'A', ...base, whatsapp: '5534998100001' },
      { id: 'B', ...base, whatsapp: null },
      { id: 'C', ...base, whatsapp: '5534998100003' },
    ];
    h.banco.tabelas.sales = [{ email: 'x@exemplo.com', phone: '5534998100009', status: 'paid', valor: 67 }];
    h.banco.tabelas.company = [{ user_id: 'B', whatsapp: '5534998100008' }];
    const doc = (user_id: string, n: number) => Array.from({ length: n }, () => ({ user_id, tipo: 'propostaSolar', created_at: desde }));
    h.banco.tabelas.documents = [...doc('A', 20), ...doc('B', 30), ...doc('C', 19)];
    const lista = await depsReaisDepo().candidatos(AGORA);
    expect(lista.map(c => c.u.id)).toEqual(['A']);
    expect(lista[0]!.tel).toBe('5534998100001');
  });
});
