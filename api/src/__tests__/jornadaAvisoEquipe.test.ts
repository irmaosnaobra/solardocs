import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BancoFalso } from './bancoFalsoQuiz';

// Os avisos da Jornada à EQUIPE (fase 3): trava por INSERT, 1 envio por rodada, a vez, 12 por hora, telefone só da equipe, chave desligada que não manda
// nada, o estado deduzido que nunca dispara e a sonda com o transporte falso. Banco em memória; a Z-API é SEMPRE falsa (nada sai de verdade).

const h = vi.hoisted(() => ({
  main: null as any,
  ger: null as any,
  enviados: [] as Array<{ numero: string; texto: string; inst: string }>,
  falhar: false,
  erroMsg: 'z-api fora',
  cooldown: false,
  upserts: [] as string[],
  dinheiro: [] as any[],
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: (t: string) => h.ger.from(t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', async (orig) => ({
  ...(await orig<typeof import('../services/agents/zapiClient')>()),
  sendWhatsApp: vi.fn(async (numero: string, texto: string, inst: string) => { if (h.falhar) throw new Error(h.erroMsg); h.enviados.push({ numero, texto, inst }); }),
  sendDocument: vi.fn(), sendFrio: vi.fn(),
  linhaEmCooldown: vi.fn(() => h.cooldown),
}));
vi.mock('../services/io/jornadaMensagensBase', async (orig) => ({
  ...(await orig<typeof import('../services/io/jornadaMensagensBase')>()),
  dinheiroDasObras: vi.fn(async () => h.dinheiro),
  faltaDaObra: vi.fn(async () => ['Foto do medidor']),
}));

import { sendWhatsApp } from '../services/agents/zapiClient';
import { TEL_AVISO } from '../services/io/solarEquipe';
import { rodarEventos, rodarFila, limparMemoriaDaFila } from '../services/io/jornadaAvisoEquipe';
import { runJornadaMensagensTick, rodarSondaDoCard } from '../services/io/jornadaMensagensTick';
import { tomarVez, type CtxMsg, type Leitura } from '../services/io/jornadaMensagensBase';
import type { GrupoMsg, ObraFila } from '../services/io/jornadaMensagensPuro';
import { assinarJornada, normalizarJornada } from '../services/gerador/jornadaSolarBanco';
import { estadoMaterializado, type EstadoJornada } from '../services/gerador/jornadaSolar';
import { gravarGrupo } from '../services/gerador/jornadaMensagensChave';
import { prefixosTotalDaLinha } from '../services/agents/whatsapp/lineThrottle';

const AG = new Date('2026-11-05T15:00:00.000Z');          // quinta, 12:00 em Brasília
const LIGADO = '2026-11-01T00:00:00.000Z';
const todos = (o: Partial<Record<GrupoMsg, string | null>> = {}): Record<GrupoMsg, string | null> => ({ venda: LIGADO, etapa: LIGADO, fila: LIGADO, liberacao: null, aniversario: null, ...o });
const vezReal = (agora: Date): CtxMsg['vez'] => { let f: Promise<boolean> | null = null; return { tomar: () => (f ??= tomarVez(agora).then((r) => r === 'tomada')) }; };
const ctx = (o: Partial<CtxMsg> = {}, agora = AG): CtxMsg => ({ agora, ligados: todos(), primeiros: {}, vez: vezReal(agora), sonda: false, ...o });

const jsDe = (card: number, etapa: number, vendedor = 'nilce', hist: EstadoJornada['historico'] = [], em = '2026-11-03T12:00:00.000Z'): EstadoJornada => {
  const e = estadoMaterializado(card, vendedor, etapa, em);
  return { ...e, origem: 'vendido', historico: [...e.historico, ...hist] };
};
const concluiu3 = (por = 'thiago', em = '2026-11-05T14:00:00.000Z') => ({ em, por, acao: 'concluir' as const, etapa: 3 });
const obraDe = (card: number, js: EstadoJornada | null, o: Partial<ObraFila> = {}): ObraFila =>
  ({ card, codigo: `#00${card}`, cliente: `Cliente ${card}`, cidade: 'Uberlândia-MG', vendedor: 'nilce', js, jo: null, cancelada: false, ...o });
const leituraDe = (obras: ObraFila[]): Leitura => ({ obras, cards: new Map(), ligs: new Map() });
const travas = (): any[] => h.main.tabela('system_state').filter((l: any) => String(l.key).startsWith('jornada_env:'));

beforeEach(() => {
  h.main = new BancoFalso(); h.ger = new BancoFalso();
  const orig = h.main.from.bind(h.main);
  h.upserts = [];
  h.main.from = (t: string) => { const q = orig(t); const u = q.upsert; q.upsert = (...a: any[]) => { h.upserts.push(`${t}:${a[0]?.key}`); return u(...a); }; return q; };
  h.enviados.length = 0; h.falhar = false; h.erroMsg = 'z-api fora'; h.cooldown = false; h.dinheiro = [];
  vi.mocked(sendWhatsApp).mockClear();
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  delete process.env.JORNADA_MSG_OFF;
  limparMemoriaDaFila();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('os eventos: trava, vez e erro', () => {
  const doisEventos = () => leituraDe([obraDe(1, jsDe(1, 4, 'nilce', [concluiu3()])), obraDe(2, jsDe(2, 4, 'nilce', [concluiu3('thiago', '2026-11-05T14:30:00.000Z')]))]);

  it('a trava é INSERT com chave única: nunca upsert; o carimbo ganha `enviado`; o envio vai pela 5040 ao telefone da equipe', async () => {
    const r = await rodarEventos(ctx(), doisEventos());
    expect(r).toMatchObject({ enviado: true, parar: true });
    expect(h.upserts.filter((u) => u.includes('jornada_env'))).toEqual([]);
    expect(travas()).toHaveLength(1);
    expect(travas()[0].key).toBe('jornada_env:sua:1:4:diego');
    expect(travas()[0].value).toMatchObject({ robo: 'jornada_etapa_aviso', enviado: true });
    expect(h.enviados).toEqual([{ numero: TEL_AVISO.diego, inst: 'io', texto: expect.stringContaining('📌 É sua: Compra da obra #001') }]);
  });

  it('dois ticks ao mesmo tempo com o mesmo evento mandam 1 só', async () => {
    const l = doisEventos();
    const semVez = { tomar: async () => true };
    const [a, b] = await Promise.all([rodarEventos(ctx({ vez: semVez }), l), rodarEventos(ctx({ vez: semVez }), l)]);
    expect(h.enviados.length).toBeGreaterThanOrEqual(1);
    expect(travas().map((t) => t.key)).toEqual([...new Set(travas().map((t) => t.key))]);
    expect(a.enviado || b.enviado).toBe(true);
    expect(vi.mocked(sendWhatsApp).mock.calls.length).toBe(travas().filter((t) => t.value.enviado).length);
  });

  it('a vez: dois eventos pendentes mandam 1 por rodada; a segunda rodada no mesmo minuto par não manda e a do minuto seguinte manda o outro', async () => {
    const l = doisEventos();
    await rodarEventos(ctx(), l);
    expect(h.enviados).toHaveLength(1);
    const mesmoMinuto = await rodarEventos(ctx({}, new Date(AG.getTime() + 30_000)), l);
    expect(mesmoMinuto).toMatchObject({ enviado: false, parar: true, motivo: 'vez_ocupada' });
    expect(h.enviados).toHaveLength(1);
    await rodarEventos(ctx({}, new Date(AG.getTime() + 2 * 60_000)), l);
    expect(h.enviados).toHaveLength(2);
    expect(travas().map((t) => t.key).sort()).toEqual(['jornada_env:sua:1:4:diego', 'jornada_env:sua:2:4:diego']);
  });

  it('erro no envio: a trava fica `falhou`, a rodada para (o 2º evento não é tentado) e a rodada seguinte não reenvia o que falhou', async () => {
    h.falhar = true;
    const l = doisEventos();
    const r = await rodarEventos(ctx(), l);
    expect(r).toMatchObject({ enviado: false, parar: true, motivo: 'envio_falhou' });
    expect(vi.mocked(sendWhatsApp)).toHaveBeenCalledTimes(1);
    expect(travas()).toHaveLength(1);
    expect(travas()[0].value.falhou).toBe(true);
    h.falhar = false;
    await rodarEventos(ctx({}, new Date(AG.getTime() + 2 * 60_000)), l);
    expect(h.enviados).toHaveLength(1);
    expect(travas().find((t) => t.key === 'jornada_env:sua:1:4:diego').value.falhou).toBe(true);
    expect(h.enviados[0].texto).toContain('#002');
  });

  it('12 carimbos da mesma pessoa na última hora: o 13º não sai e o de outra pessoa sai', async () => {
    const evento = { em: '2026-11-05T14:00:00.000Z', por: 'nilce', acao: 'venda_completa' as const, etapa: 1 };
    const l = leituraDe([obraDe(7, jsDe(7, 1, 'nilce', [evento]))]);
    for (let i = 0; i < 12; i++) h.main.tabela('system_state').push({ key: `jornada_env:sua:${100 + i}:4:nilce`, value: { robo: 'x', enviado: true }, updated_at: new Date(AG.getTime() - 5 * 60_000).toISOString() });
    await rodarEventos(ctx(), l);
    expect(h.enviados.map((e) => e.numero)).toEqual([TEL_AVISO.thiago]);
    expect(travas().some((t) => t.key === 'jornada_env:venda:7:nilce')).toBe(false);
  });

  it('3 erros de linha seguidos armam a pausa de 15 min e a rodada seguinte não chama a Z-API; o envio que dá certo zera o contador', async () => {
    h.falhar = true; h.erroMsg = 'HTTP 503 da instancia';
    const l = leituraDe([obraDe(1, jsDe(1, 4, 'nilce', [concluiu3()])), obraDe(2, jsDe(2, 4, 'nilce', [concluiu3('thiago', '2026-11-05T14:30:00.000Z')])), obraDe(3, jsDe(3, 4, 'nilce', [concluiu3('thiago', '2026-11-05T14:40:00.000Z')]))]);
    const em = (min: number) => new Date(AG.getTime() + min * 60_000);
    await rodarEventos(ctx({}, em(0)), l);
    expect(h.main.tabela('system_state').find((x: any) => x.key === 'ag5040_linha_pausa')).toBeUndefined();
    await rodarEventos(ctx({}, em(2)), l);
    const pausa = h.main.tabela('system_state').find((x: any) => x.key === 'ag5040_linha_pausa');
    expect(pausa.value).toMatchObject({ motivo: 'erros_seguidos', n: 2 });
    expect(vi.mocked(sendWhatsApp)).toHaveBeenCalledTimes(2);
    const r3 = await rodarEventos(ctx({}, em(4)), l);
    expect(r3).toMatchObject({ enviado: false, parar: true, motivo: 'linha_ocupada' });
    expect(vi.mocked(sendWhatsApp)).toHaveBeenCalledTimes(2);
  });

  it('um envio que dá certo zera o contador de erros da linha', async () => {
    const l = leituraDe([obraDe(1, jsDe(1, 4, 'nilce', [concluiu3()])), obraDe(2, jsDe(2, 4, 'nilce', [concluiu3('thiago', '2026-11-05T14:30:00.000Z')]))]);
    h.falhar = true; h.erroMsg = 'HTTP 503';
    await rodarEventos(ctx(), l);
    expect(h.main.tabela('system_state').find((x: any) => x.key === 'ag5040_linha_erros').value.n).toBe(1);
    h.falhar = false;
    await rodarEventos(ctx({}, new Date(AG.getTime() + 2 * 60_000)), l);
    expect(h.main.tabela('system_state').find((x: any) => x.key === 'ag5040_linha_erros').value.n).toBe(0);
  });

  it('acima de 12 por hora da pessoa o aviso NÃO é descartado: fica pendente e sai na rodada em que couber (dentro das 24 h)', async () => {
    const evento = { em: '2026-11-05T14:00:00.000Z', por: 'diego', acao: 'venda_completa' as const, etapa: 1 };
    const l = leituraDe([obraDe(7, jsDe(7, 1, 'nilce', [evento]))]);
    for (let i = 0; i < 12; i++) h.main.tabela('system_state').push({ key: `jornada_env:sua:${100 + i}:4:nilce`, value: { robo: 'x', enviado: true }, updated_at: new Date(AG.getTime() - 5 * 60_000).toISOString() });
    await rodarEventos(ctx(), l);
    expect(h.enviados.map((e) => e.numero)).toEqual([TEL_AVISO.thiago]);
    expect(travas().some((t) => t.key === 'jornada_env:venda:7:nilce')).toBe(false);
    for (let m = 2; m <= 6; m += 2) await rodarEventos(ctx({}, new Date(AG.getTime() + (60 + m) * 60_000)), l);
    expect(h.enviados.map((e) => e.numero)).toContain(TEL_AVISO.nilce);
    expect(travas().find((t) => t.key === 'jornada_env:venda:7:nilce').value.enviado).toBe(true);
  });

  it('o teto de 40 por hora da linha: com a linha cheia o aviso espera sem travar', async () => {
    for (let i = 0; i < 40; i++) h.main.tabela('system_state').push({ key: `ag5040_sent:${i}`, value: {}, updated_at: new Date(AG.getTime() - 60_000).toISOString() });
    const r = await rodarEventos(ctx(), doisEventos());
    expect(r).toMatchObject({ enviado: false, parar: true, motivo: 'linha_cheia' });
    expect(travas()).toEqual([]);
    expect(h.enviados).toEqual([]);
    h.main.tabelas.system_state = h.main.tabela('system_state').filter((l: any) => !String(l.key).startsWith('ag5040_sent:'));
    h.main.tabela('system_state').push(...Array.from({ length: 39 }, (_, i) => ({ key: `ag5040_sent:${i}`, value: {}, updated_at: new Date(AG.getTime() - 60_000).toISOString() })));
    expect((await rodarEventos(ctx({}, new Date(AG.getTime() + 2 * 60_000)), doisEventos())).enviado).toBe(true);
  });

  it('telefone fora do TEL_AVISO (dono pablo): não sai e não trava', async () => {
    const base = jsDe(9, 1, 'pablo');
    const js = { ...base, esperando: { motivo: 'cliente' as const, ate: '2026-11-12', etapa: 1 as const, em: '2026-11-05T14:00:00.000Z', por: 'thiago' }, historico: [...base.historico, { em: '2026-11-05T14:00:00.000Z', por: 'thiago', acao: 'esperar' as const, etapa: 1 }] };
    const r = await rodarEventos(ctx(), leituraDe([obraDe(9, js, { vendedor: 'pablo' })]));
    expect(r.enviado).toBe(false);
    expect(h.enviados).toEqual([]);
    expect(travas()).toEqual([]);
  });

  it('linha em cooldown: para sem travar', async () => {
    h.cooldown = true;
    const r = await rodarEventos(ctx(), doisEventos());
    expect(r).toMatchObject({ enviado: false, parar: true, motivo: 'linha_ocupada' });
    expect(travas()).toEqual([]);
    expect(h.enviados).toEqual([]);
  });

  it('linha pausada por erros seguidos (ag5040_linha_pausa no futuro): para sem travar', async () => {
    h.main.tabela('system_state').push({ key: 'ag5040_linha_pausa', value: { ate: new Date(AG.getTime() + 600_000).toISOString() }, updated_at: AG.toISOString() });
    const r = await rodarEventos(ctx(), doisEventos());
    expect(r.motivo).toBe('linha_ocupada');
    expect(travas()).toEqual([]);
  });

  it('estado deduzido (sem js e sem jo) nunca dispara: zero envio e zero trava', async () => {
    const r = await rodarEventos(ctx(), leituraDe([obraDe(5, null)]));
    expect(r.enviado).toBe(false);
    expect(h.enviados).toEqual([]);
    expect(travas()).toEqual([]);
  });

  it('a materialização (materializada / leitura) não manda "É sua"; um concluir de gente depois manda 1', async () => {
    const so = leituraDe([obraDe(3, jsDe(3, 4))]);
    await rodarEventos(ctx({ ligados: todos({ etapa: '2026-11-02T00:00:00.000Z' }) }), so);
    expect(h.enviados).toEqual([]);
    await rodarEventos(ctx({ ligados: todos({ etapa: '2026-11-02T00:00:00.000Z' }) }), leituraDe([obraDe(3, jsDe(3, 4, 'nilce', [concluiu3()]))]));
    expect(h.enviados).toHaveLength(1);
  });

  it('a sonda não chama a Z-API; trava com `sonda: true` e `enviado: false`; o carimbo conta na linha', async () => {
    const r = await rodarEventos(ctx({ sonda: true }), doisEventos());
    expect(r.travadas).toHaveLength(2);
    expect(vi.mocked(sendWhatsApp)).not.toHaveBeenCalled();
    expect(travas().every((t) => t.value.sonda === true && t.value.enviado === false)).toBe(true);
    expect(prefixosTotalDaLinha()).toContain('jornada_env:');
    const de_novo = await rodarEventos(ctx({ sonda: true }), doisEventos());
    expect(de_novo).toMatchObject({ travadas: [], jaTravadas: 2 });
  });
});

describe('a fila das 08:00', () => {
  const OITO = new Date('2026-11-05T11:00:30.000Z');
  const vencida = (card: number, vendedor = 'nilce') => obraDe(card, jsDe(card, 2, vendedor, [], '2026-10-20T12:00:00.000Z'));

  it('fora da janela não manda nada; na janela o Thiago vai primeiro, quem não tem nada não recebe', async () => {
    const l = leituraDe([vencida(1), obraDe(2, jsDe(2, 4, 'nilce'), { jo: null })]);
    expect((await rodarFila(ctx(), l)).motivo).toBe('fora');
    expect(h.enviados).toEqual([]);
    const r = await rodarFila(ctx({}, OITO), l);
    expect(r).toMatchObject({ enviado: true });
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0].numero).toBe(TEL_AVISO.thiago);
    expect(h.enviados[0].texto).toContain('☀️ Sua fila hoje, Thiago');
    expect(h.enviados[0].texto).toContain('*Parado com a equipe:*');
    expect(h.enviados[0].texto).toContain('Falta: Foto do medidor');
    expect(travas().map((t) => t.key)).toEqual(['jornada_env:fila:2026-11-05:thiago']);
    // Uma pessoa por rodada (minuto par novo): Diego (etapa 4), depois a Giovanna (etapa 2); a Nilce não tem nada e não recebe.
    await rodarFila(ctx({}, new Date(OITO.getTime() + 2 * 60_000)), l);
    await rodarFila(ctx({}, new Date(OITO.getTime() + 4 * 60_000)), l);
    expect(h.enviados.map((e) => e.numero)).toEqual([TEL_AVISO.thiago, TEL_AVISO.diego, TEL_AVISO.giovanna]);
    await rodarFila(ctx({}, new Date(OITO.getTime() + 6 * 60_000)), l);
    expect(h.enviados).toHaveLength(3);
  });

  it('o dinheiro pendente vai SÓ para quem resolve: comissão e recebimento para a Giovanna, o não conferido para o Thiago; Diego e Nilce não levam', async () => {
    h.dinheiro = [{ card: 1, rotulo: '#001 Cliente 1', comissoes: [{ valor_centavos: 100_000, papel: 'venda' }], a_receber_centavos: 200_000, nao_conferidas: 1, nao_conferidas_retirada: 0 }];
    const l = leituraDe([]);
    for (let i = 0; i < 6; i++) await rodarFila(ctx({}, new Date(OITO.getTime() + i * 2 * 60_000)), l);
    expect(h.enviados.map((e) => e.numero).sort()).toEqual([TEL_AVISO.giovanna, TEL_AVISO.thiago].sort());
    const giov = h.enviados.find((e) => e.numero === TEL_AVISO.giovanna)!;
    expect(giov.texto).toContain('Comissão a pagar: #001 Cliente 1 · R$ 1.000,00');
    expect(giov.texto).toContain('A receber: #001 Cliente 1 · R$ 2.000,00');
    expect(giov.texto).not.toContain('Para conferir');
    expect(h.enviados.find((e) => e.numero === TEL_AVISO.thiago)!.texto).toContain('Para conferir: #001 Cliente 1 · 1 lançamento');
  });

  it('domingo e feriado não têm fila', async () => {
    const l = leituraDe([vencida(1)]);
    expect((await rodarFila(ctx({}, new Date('2026-11-08T11:00:30.000Z')), l)).motivo).toBe('fora');
    expect((await rodarFila(ctx({}, new Date('2026-11-02T11:00:30.000Z')), l)).motivo).toBe('fora');
  });
});

describe('o tick (o banco inteiro, sem mock da leitura)', () => {
  const semear = (card: number, js: EstadoJornada, assinar = true): void => {
    const n = normalizarJornada(card, js)!;
    h.main.tabela('system_state').push({ key: `jornada_solar:${card}`, value: { ...n, sig: assinar ? assinarJornada(card, n) : 'f'.repeat(64) }, updated_at: '2026-11-05T14:00:00.000Z' });
    h.ger.tabela('agendamentos').push({ id: card, cliente_nome: `Cliente ${card}`, cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia - MG', vendedor_nome: 'Nilce', created_by: 'lp_solar', status: 'fechou', created_at: '2026-10-01T10:00:00.000Z' });
  };

  it('sem a chave (tudo desligado) ou com JORNADA_MSG_OFF=1: zero envio, zero escrita e nem lê os estados', async () => {
    semear(1, jsDe(1, 4, 'nilce', [concluiu3()]));
    const antes = JSON.stringify(h.main.tabelas);
    expect(await runJornadaMensagensTick(AG)).toEqual({ motivo: 'desligado' });
    for (const g of ['venda', 'etapa', 'fila'] as const) await gravarGrupo(g, true, 'thiago', new Date(LIGADO));
    process.env.JORNADA_MSG_OFF = '1';
    expect(await runJornadaMensagensTick(AG)).toEqual({ motivo: 'desligado' });
    expect(h.enviados).toEqual([]);
    expect(JSON.stringify(h.main.tabelas).includes('jornada_vez')).toBe(false);
    void antes;
  });

  it('ligado: manda o "É sua" gravado por gente; um estado com assinatura forjada e a venda deduzida nunca disparam', async () => {
    for (const g of ['venda', 'etapa', 'fila'] as const) await gravarGrupo(g, true, 'thiago', new Date(LIGADO));
    semear(2, jsDe(2, 4, 'nilce', [concluiu3()]), false);        // forjado
    h.ger.tabela('agendamentos').push({ id: 3, cliente_nome: 'Deduzida', cliente_telefone: '(34) 99999-0003', cidade: 'X', vendedor_nome: 'Nilce', created_by: 'lp_solar', status: 'fechou', created_at: '2026-10-01T10:00:00.000Z' });
    expect(await runJornadaMensagensTick(AG)).toMatchObject({ eventos: 'sem_evento' });
    expect(h.enviados).toEqual([]);
    expect(travas()).toEqual([]);
    semear(1, jsDe(1, 4, 'nilce', [concluiu3()]));
    const r = await runJornadaMensagensTick(new Date(AG.getTime() + 2 * 60_000));
    expect(r).toMatchObject({ eventos: 'enviado' });
    expect(h.enviados).toHaveLength(1);
    expect(h.enviados[0].numero).toBe(TEL_AVISO.diego);
  });

  it('o card da sonda fica fora do tick de verdade; a sonda trava e desfaz sem mandar nada', async () => {
    for (const g of ['venda', 'etapa', 'fila'] as const) await gravarGrupo(g, true, 'thiago', new Date(LIGADO));
    semear(4, jsDe(4, 4, 'nilce', [{ ...concluiu3('sonda') }]));
    h.ger.tabela('agendamentos').find((a: any) => a.id === 4).cliente_telefone = '34900000000';
    expect(await runJornadaMensagensTick(AG)).toMatchObject({ eventos: 'sem_evento' });
    const s = await rodarSondaDoCard(4, AG);
    expect(s).toMatchObject({ ja_travadas: 0 });
    expect(s!.travadas.sort()).toEqual(['jornada_env:sua:4:4:diego', 'jornada_env:sua:4:4:thiago']);
    expect(h.enviados).toEqual([]);
    expect(h.main.tabela('system_state').some((l: any) => String(l.key).startsWith('jornada_vez:'))).toBe(false);
    expect(await rodarSondaDoCard(4, AG)).toMatchObject({ travadas: [], ja_travadas: 2 });
  });
});
