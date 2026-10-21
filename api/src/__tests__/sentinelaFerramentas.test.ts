import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  avaliar, montarMensagem, diferencaSnapshots, diasAte, sanearCalendario, blocoGiovanna, diaUtilAnterior,
  type Leitura, type ResumoGiovanna, type Vencimento,
} from '../services/agentes5040/sentinela';
import {
  lerMeta, lerZapi, lerAnthropic, lerOpenAI, lerTudo, saldoDoTexto, minimoMetaCentavos, type DepsLeituras,
} from '../services/agentes5040/sentinelaLeituras';
import { rodarGiovanna, depsGiovannaReais, type DepsGiovanna, type Cartao } from '../services/agentes5040/sentinelaGiovanna';
import { sondaSentinela } from '../services/agentes5040/sentinelaSonda';
import { rodarSentinelaFerramentas, type DepsRodada } from '../services/agentes5040/sentinelaRodada';
import { canalDaEnv, enviarAviso } from '../services/io/sentinelaEnvio';

vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn() }));
vi.mock('../utils/mailer', () => ({ sendOpsAlert: vi.fn() }));

// 21/10/2026, quarta, 07:00 em Brasília (10:00 UTC).
const AGORA = new Date('2026-10-21T10:00:00.000Z');
const SABADO = new Date('2026-10-24T10:00:00.000Z');

const venc = (ferramenta: string, vence_em: string, extra: Partial<Vencimento> = {}): Vencimento => ({ ferramenta, vence_em, ...extra });
const OK: Leitura[] = [
  { ferramenta: 'Meta', estado: 'ok', detalhe: 'conta ativa' },
  { ferramenta: 'Cloudinary', estado: 'nao_conferido', detalhe: 'não conferido' },
];
const GIO_EM_DIA: ResumoGiovanna = { semBase: false, desfechos: {}, totalDesfechos: 0, paradosTotal: 24, paradosFaltam: 0, semDesfecho: 0 };
const GIO_COBRAR: ResumoGiovanna = {
  semBase: false, desfechos: { 'sem interesse': 2, vendido: 1 }, totalDesfechos: 3, paradosTotal: 24, paradosFaltam: 17, semDesfecho: 2,
};

describe('limites de 7 e 30 dias', () => {
  it('ferramenta comum avisa com 7 dias e fica calada com 8', () => {
    expect(avaliar([], [venc('Vercel', '2026-10-28')], AGORA)).toHaveLength(1);
    expect(avaliar([], [venc('Vercel', '2026-10-29')], AGORA)).toEqual([]);
  });

  it('domínio avisa com 30 dias e fica calado com 31', () => {
    expect(avaliar([], [venc('Domínio solardoc.app', '2026-11-20')], AGORA)).toHaveLength(1);
    expect(avaliar([], [venc('Domínio solardoc.app', '2026-11-21')], AGORA)).toEqual([]);
    // domínio reconhecido pelo nome mesmo sem a palavra
    expect(avaliar([], [venc('irmaosnaobra.com.br', '2026-11-20')], AGORA)).toHaveLength(1);
  });

  it('vencido avisa sempre, vence hoje e amanhã falam do jeito certo', () => {
    const [a] = avaliar([], [venc('Vercel', '2026-10-20')], AGORA);
    expect(a).toMatchObject({ tipo: 'vencido', dias: -1 });
    expect(a!.texto).toContain('venceu ontem');
    expect(avaliar([], [venc('Vercel', '2026-01-01')], AGORA)[0]!.tipo).toBe('vencido');
    expect(avaliar([], [venc('Vercel', '2026-10-21')], AGORA)[0]!.texto).toContain('vence hoje');
    expect(avaliar([], [venc('Vercel', '2026-10-22')], AGORA)[0]!.texto).toContain('vence amanhã');
  });

  it('conta em dia de Brasília, não em milissegundos (02:00 UTC ainda é o dia anterior)', () => {
    expect(diasAte('2026-10-21', new Date('2026-10-21T02:00:00Z'))).toBe(1);
    expect(diasAte('2026-10-21', new Date('2026-10-21T03:00:00Z'))).toBe(0);
    expect(diasAte('2026-02-30', AGORA)).toBeNull();
  });

  it('data inválida no calendário vira alerta, não passa calada; cartão e observação entram no texto', () => {
    expect(avaliar([], [venc('Meta', 'amanhã')], AGORA)[0]).toMatchObject({ tipo: 'falha' });
    const [a] = avaliar([], [venc('Vercel', '2026-10-25', { cartao_final: '1234', observacao: 'Trocar o cartão' })], AGORA);
    expect(a!.texto).toContain('cartão final 1234');
    expect(a!.texto).toContain('Trocar o cartão');
  });

  it('a lista sai ordenada: vencido, falha, saldo baixo, vencimentos do mais perto ao mais longe', () => {
    const l: Leitura[] = [
      { ferramenta: 'Anthropic', estado: 'baixo', detalhe: 'saldo baixo' },
      { ferramenta: 'Z-API', estado: 'falha', detalhe: 'linha caída' },
    ];
    const c = [venc('B', '2026-10-27'), venc('A', '2026-10-22'), venc('Velha', '2026-10-01')];
    expect(avaliar(l, c, AGORA).map(x => x.ferramenta)).toEqual(['Velha', 'Z-API', 'Anthropic', 'A', 'B']);
  });
});

describe('silêncio', () => {
  it('tudo em dia e não conferido nunca vira alerta nem mensagem', () => {
    const al = avaliar(OK, [venc('Vercel', '2027-01-01')], AGORA);
    expect(al).toEqual([]);
    expect(montarMensagem({ alertas: al, giovanna: null, agora: AGORA })).toBeNull();
  });

  it('Giovanna com a fila em dia não quebra o silêncio', () => {
    expect(montarMensagem({ alertas: [], giovanna: GIO_EM_DIA, agora: AGORA })).toBeNull();
  });

  it('Giovanna com pendência fala em dia útil, e fica calada no fim de semana', () => {
    expect(montarMensagem({ alertas: [], giovanna: GIO_COBRAR, agora: AGORA })).toContain('Giovanna, resumo do dia');
    expect(montarMensagem({ alertas: [], giovanna: GIO_COBRAR, agora: SABADO })).toBeNull();
  });

  it('com alerta num sábado a mensagem sai, mas sem o bloco da Giovanna', () => {
    const al = avaliar([], [venc('Vercel', '2026-10-25')], SABADO);
    const t = montarMensagem({ alertas: al, giovanna: GIO_COBRAR, agora: SABADO })!;
    expect(t).toContain('Pede ação');
    expect(t).not.toContain('Giovanna');
  });
});

describe('texto que o dono recebe', () => {
  it('uma bolha, maiúscula no começo, sem travessão, com alertas e o bloco da Giovanna', () => {
    const al = avaliar(
      [{ ferramenta: 'Anthropic', estado: 'falha', detalhe: 'sem saldo na Anthropic' }],
      [venc('Domínio solardoc.app', '2026-11-05', { cartao_final: '4321', observacao: 'Renovar — no registrador' })],
      AGORA,
    );
    const t = montarMensagem({ alertas: al, giovanna: GIO_COBRAR, agora: AGORA })!;
    expect(t).toBe([
      'Sentinela das ferramentas, 21/10. Pede ação:',
      'Anthropic: sem saldo na Anthropic',
      'Domínio solardoc.app vence em 15 dias (05/11), cartão final 4321. Renovar, no registrador',
      '',
      'Giovanna, resumo do dia:',
      'Desfechos desde a última foto: 3 (2 sem interesse, 1 vendido).',
      'Parados da lista de 24: faltam 17.',
      'Ligação do último dia útil sem desfecho: 2.',
    ].join('\n'));
    expect(/[—–]/.test(t)).toBe(false);
    expect(t[0]).toBe(t[0]!.toUpperCase());
    expect(t.length).toBeLessThan(900);
  });

  it('alerta digitado em minúscula sai com maiúscula', () => {
    const t = montarMensagem({ alertas: avaliar([], [venc('vercel', '2026-10-22')], AGORA), agora: AGORA })!;
    expect(t).toContain('\nVercel vence amanhã');
  });
});

describe('calendário', () => {
  it('limpa: cartão só com 4 dígitos, chave desconhecida cai, texto é cortado', () => {
    const r = sanearCalendario([{ ferramenta: 'X', vence_em: '2026-12-01', cartao_final: '1234', observacao: 'a'.repeat(500), lixo: 1 }]);
    expect(r.ok && r.lista[0]).toEqual({ ferramenta: 'X', vence_em: '2026-12-01', cartao_final: '1234', observacao: 'a'.repeat(120) });
    expect(sanearCalendario([{ ferramenta: 'X', vence_em: '2026-12-01', cartao_final: '4111111111111111' }]).ok).toBe(false);
    expect(sanearCalendario([{ ferramenta: 'X', vence_em: '01/12/2026' }]).ok).toBe(false);
    expect(sanearCalendario({}).ok).toBe(false);
    expect(sanearCalendario(Array.from({ length: 61 }, () => venc('X', '2026-12-01'))).ok).toBe(false);
  });
});

describe('diferença da Giovanna, com e sem base', () => {
  it('sem foto anterior diz que não há base', () => {
    const d = diferencaSnapshots(null, { '1': 'agendado' });
    expect(d).toEqual({ semBase: true, desfechos: {}, total: 0 });
    expect(blocoGiovanna({ ...GIO_COBRAR, semBase: true })).toContain('primeiro dia sem foto anterior');
  });

  it('com foto, conta só quem estava agendado e mudou', () => {
    const d = diferencaSnapshots(
      { '1': 'agendado', '2': 'agendado', '3': 'agendado', '4': 'vendido', '5': 'agendado' },
      { '1': 'sem interesse', '2': 'agendado', '3': 'vendido', '4': 'cancelado', '6': 'agendado' },
    );
    expect(d).toEqual({ semBase: false, desfechos: { 'sem interesse': 1, vendido: 1 }, total: 2 });
  });

  it('o dia útil anterior pula sábado, domingo e feriado', () => {
    expect(diaUtilAnterior('2026-10-26')).toBe('2026-10-23');
    expect(diaUtilAnterior('2026-10-21')).toBe('2026-10-20');
    expect(diaUtilAnterior('2026-10-13')).toBe('2026-10-09'); // 12/10 é feriado
  });
});

function banco(inicial: Record<string, unknown> = {}) {
  const estado = new Map<string, unknown>(Object.entries(inicial));
  const gravacoes: string[] = [];
  return { estado, gravacoes };
}

function depsGio(cartoes: Cartao[], parados: number[], statusAgora: Record<string, string>, b = banco()): DepsGiovanna {
  return {
    agora: AGORA,
    cartoes: async () => cartoes,
    paradosAntesDoCorte: async () => parados,
    statusDe: async () => statusAgora,
    lerEstado: async k => (b.estado.has(k) ? b.estado.get(k) : null),
    gravarEstado: async (k, v) => { b.gravacoes.push(k); b.estado.set(k, v); },
    inserirEstado: async (k, v) => { if (b.estado.has(k)) return false; b.gravacoes.push(k); b.estado.set(k, v); return true; },
    podarFotos: async () => {},
  };
}

describe('rodada da Giovanna', () => {
  const cartoes: Cartao[] = [
    { id: 1, status: 'agendado', quando: '2026-10-20T15:00:00Z' },   // ontem, segue agendado
    { id: 2, status: 'agendado', quando: '2026-10-21T15:00:00Z' },   // hoje: não conta
    { id: 3, status: 'vendido', quando: '2026-10-20T14:00:00Z' },
    { id: 4, status: 'agendado', quando: '2026-10-20T20:00:00Z' },   // ontem, segue agendado
  ];

  it('primeiro dia: sem base, congela os parados uma vez e grava a foto de hoje', async () => {
    const b = banco();
    const r = await rodarGiovanna(depsGio(cartoes, [10, 11, 12], { '10': 'agendado', '11': 'vendido', '12': 'agendado' }, b));
    expect(r).toMatchObject({ semBase: true, paradosTotal: 3, paradosFaltam: 2, semDesfecho: 2, paradosNovos: true });
    expect(b.estado.get('giov_snap:2026-10-21')).toEqual({ '1': 'agendado', '2': 'agendado', '3': 'vendido', '4': 'agendado' });
    expect(b.estado.get('giov_backlog24')).toMatchObject({ ids: [10, 11, 12], total: 3 });
  });

  it('dia seguinte: diferença contra a foto de ontem e a lista congelada não muda', async () => {
    const b = banco({
      'giov_snap:2026-10-20': { '1': 'agendado', '2': 'agendado', '3': 'agendado', '4': 'agendado' },
      giov_backlog24: { ids: [10, 11, 12], total: 3, congelado_em: '2026-10-20' },
    });
    const r = await rodarGiovanna(depsGio(cartoes, [99], { '10': 'agendado', '11': 'agendado', '12': 'vendido' }, b));
    expect(r).toMatchObject({ semBase: false, totalDesfechos: 1, desfechos: { vendido: 1 }, paradosTotal: 3, paradosFaltam: 2 });
    expect(r.paradosNovos).toBeUndefined();
    expect((b.estado.get('giov_backlog24') as any).ids).toEqual([10, 11, 12]);
  });

  it('segunda compara com a foto de SEXTA, ignorando a de fim de semana que esteja no banco', async () => {
    const seg = new Date('2026-10-26T10:00:00Z');
    const b = banco({
      'giov_snap:2026-10-23': { '3': 'agendado', '4': 'agendado' },   // sexta
      'giov_snap:2026-10-25': { '3': 'vendido', '4': 'vendido' },     // domingo (foto indevida no mock)
      giov_backlog24: { ids: [], total: 0 },
    });
    const d = { ...depsGio([{ id: 3, status: 'vendido', quando: null }, { id: 4, status: 'agendado', quando: null }], [], {}, b), agora: seg };
    expect(await rodarGiovanna(d)).toMatchObject({ semBase: false, totalDesfechos: 1, desfechos: { vendido: 1 } });
    expect(b.gravacoes).toContain('giov_snap:2026-10-26');
  });

  it('dia útil depois de feriado compara com o último dia útil antes dele', async () => {
    const b = banco({ 'giov_snap:2026-10-09': { '3': 'agendado' }, giov_backlog24: { ids: [], total: 0 } });
    const d = { ...depsGio([{ id: 3, status: 'vendido', quando: null }], [], {}, b), agora: new Date('2026-10-13T10:00:00Z') };
    expect(await rodarGiovanna(d)).toMatchObject({ semBase: false, totalDesfechos: 1 });
  });

  it('sábado e domingo não gravam foto nenhuma', async () => {
    for (const dia of ['2026-10-24T10:00:00Z', '2026-10-25T10:00:00Z']) {
      const b = banco({ giov_backlog24: { ids: [], total: 0 } });
      await rodarGiovanna({ ...depsGio(cartoes, [], {}, b), agora: new Date(dia) });
      expect(b.gravacoes.filter(k => k.startsWith('giov_snap:'))).toEqual([]);
    }
  });

  it('a conta dos parados só vê cards da Giovanna (statusDe filtra o vendedor)', async () => {
    const eq = vi.fn();
    const q: any = { select: () => q, eq: (...a: unknown[]) => { eq(...a); return q; }, in: async () => ({ data: [{ id: 1, status: 'agendado' }], error: null }) };
    const d = depsGiovannaReais({ from: () => q }, { from: () => q }, AGORA);
    expect(await d.statusDe([1])).toEqual({ '1': 'agendado' });
    expect(eq).toHaveBeenCalledWith('vendedor_nome', 'Giovanna');
  });

  it('modo seco não grava foto nem congela nada', async () => {
    const b = banco();
    const r = await rodarGiovanna(depsGio(cartoes, [10], { '10': 'agendado' }, b), { seco: true });
    expect(r.paradosNovos).toBe(true);
    expect(b.gravacoes).toEqual([]);
  });
});

// ── rodada completa, reserva e envio ─────────────────────────────────────────

function depsRodada(over: Partial<DepsRodada> = {}) {
  const reservas = new Set<string>();
  const enviados: string[] = [];
  const marcas: Array<[string, unknown]> = [];
  const d: DepsRodada = {
    agora: AGORA,
    ligada: async () => true,
    reservar: async k => { if (reservas.has(k)) return 'ja'; reservas.add(k); return 'reservado'; },
    marcar: async (k, v) => { marcas.push([k, v]); },
    lerCalendario: async () => [venc('Vercel', '2026-10-25')],
    leituras: async () => OK,
    giovanna: async () => GIO_COBRAR,
    enviar: async t => { enviados.push(t); return { canal: 'whatsapp' }; },
    ...over,
  };
  return { d, reservas, enviados, marcas };
}

describe('reserva do dia', () => {
  it('a segunda rodada do mesmo dia não envia de novo', async () => {
    const { d, enviados, reservas } = depsRodada();
    const a = await rodarSentinelaFerramentas(d);
    const b = await rodarSentinelaFerramentas(d);
    expect(a.estado).toBe('enviado');
    expect(b.estado).toBe('ja_rodou');
    expect(enviados).toHaveLength(1);
    expect([...reservas]).toEqual(['sentinela_ferr:2026-10-21']);
  });

  it('dia calado também gasta a reserva e não envia', async () => {
    const { d, enviados, marcas } = depsRodada({ lerCalendario: async () => [], giovanna: async () => GIO_EM_DIA });
    expect((await rodarSentinelaFerramentas(d)).estado).toBe('calada');
    expect(enviados).toEqual([]);
    expect(marcas[0]![1]).toMatchObject({ estado: 'calada' });
  });

  it('falha de envio fica registrada e não reenvia no dia', async () => {
    const enviar = vi.fn().mockRejectedValue(new Error('z-api fora'));
    const { d, marcas } = depsRodada({ enviar });
    expect((await rodarSentinelaFerramentas(d)).estado).toBe('falha_envio');
    expect((await rodarSentinelaFerramentas(d)).estado).toBe('ja_rodou');
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(marcas[0]![1]).toMatchObject({ estado: 'falha_envio' });
  });

  it('erro ao reservar não envia', async () => {
    const { d, enviados } = depsRodada({ reservar: async () => 'erro' });
    expect((await rodarSentinelaFerramentas(d)).estado).toBe('sem_reserva');
    expect(enviados).toEqual([]);
  });

  it('desligada pelo interruptor não reserva nem envia; erro ao ler o interruptor também desliga', async () => {
    const reservar = vi.fn();
    const a = depsRodada({ ligada: async () => false, reservar });
    expect((await rodarSentinelaFerramentas(a.d)).estado).toBe('desligado');
    const b = depsRodada({ ligada: async () => { throw new Error('banco'); }, reservar });
    expect((await rodarSentinelaFerramentas(b.d)).estado).toBe('desligado');
    expect(reservar).not.toHaveBeenCalled();
    expect(a.enviados.length + b.enviados.length).toBe(0);
  });

  it('?seco funciona com a sentinela desligada', async () => {
    const { d } = depsRodada({ ligada: async () => false });
    expect(await rodarSentinelaFerramentas(d, { seco: true })).toMatchObject({ estado: 'seco', alertas: 1 });
  });

  it('Z-API em falha manda o aviso direto por e-mail; sem falha da Z-API, pede o canal normal', async () => {
    const zapiFalha: Leitura[] = [{ ferramenta: 'Z-API linha IO', estado: 'falha', detalhe: 'a linha da 5040 está caída' }];
    const a = depsRodada({ leituras: async () => zapiFalha, enviar: vi.fn(async () => ({ canal: 'email' })) });
    await rodarSentinelaFerramentas(a.d);
    expect(a.d.enviar).toHaveBeenCalledWith(expect.stringContaining('Z-API linha IO'), { direto_email: true });
    const enviar = vi.fn(async () => ({ canal: 'whatsapp' }));
    const b = depsRodada({ enviar });
    await rodarSentinelaFerramentas(b.d);
    expect(enviar).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it('?seco devolve o texto e não reserva, não marca nem envia', async () => {
    const reservar = vi.fn();
    const giovanna = vi.fn(async () => GIO_COBRAR);
    const { d, enviados, marcas } = depsRodada({ reservar, giovanna });
    const r = await rodarSentinelaFerramentas(d, { seco: true });
    expect(r).toMatchObject({ estado: 'seco', alertas: 1, giovanna: true });
    expect(r.texto).toContain('Vercel vence em 4 dias');
    expect(giovanna).toHaveBeenCalledWith(true);
    expect(reservar).not.toHaveBeenCalled();
    expect(enviados).toEqual([]);
    expect(marcas).toEqual([]);
  });

  it('leitura ou Giovanna que quebram não derrubam a rodada: o calendário ainda avisa', async () => {
    const { d, enviados } = depsRodada({
      leituras: async () => { throw new Error('rede'); },
      giovanna: async () => { throw new Error('banco'); },
    });
    expect((await rodarSentinelaFerramentas(d)).estado).toBe('enviado');
    expect(enviados[0]).toContain('Vercel');
    expect(enviados[0]).not.toContain('Giovanna');
  });
});

describe('canal e envio em uma bolha', () => {
  it('a env escolhe o canal; sem env ou valor estranho é WhatsApp', () => {
    expect(canalDaEnv({})).toBe('whatsapp');
    expect(canalDaEnv({ SENTINELA_CANAL: 'whatsapp' })).toBe('whatsapp');
    expect(canalDaEnv({ SENTINELA_CANAL: ' Email ' })).toBe('email');
    expect(canalDaEnv({ SENTINELA_CANAL: 'sms' })).toBe('whatsapp');
  });

  it('WhatsApp: UMA chamada com o texto inteiro para o número do dono; e-mail não toca o WhatsApp', async () => {
    const whatsapp = vi.fn(async (_tel: string, _msg: string) => {});
    const email = vi.fn(async (_assunto: string, _html: string) => {});
    const texto = 'Sentinela das ferramentas, 21/10.\nLinha dois.';
    expect(await enviarAviso(texto, '34991360223', { whatsapp, email, env: {} })).toEqual({ canal: 'whatsapp' });
    expect(whatsapp).toHaveBeenCalledTimes(1);
    expect(whatsapp).toHaveBeenCalledWith('34991360223', texto);
    expect(email).not.toHaveBeenCalled();

    expect(await enviarAviso('a < b\nc', '34991360223', { whatsapp, email, env: { SENTINELA_CANAL: 'email' } })).toEqual({ canal: 'email' });
    expect(email).toHaveBeenCalledTimes(1);
    expect(email.mock.calls[0]![1]).toBe('<p>a &lt; b<br>c</p>');
    expect(whatsapp).toHaveBeenCalledTimes(1);
  });

  it('WhatsApp com erro: o MESMO texto sai por e-mail na mesma chamada (um aviso só)', async () => {
    const whatsapp = vi.fn(async (_t: string, _m: string) => { throw new Error('z-api 500'); });
    const email = vi.fn(async (_a: string, _h: string) => {});
    const r = await enviarAviso('Sentinela das ferramentas, 21/10.', '34991360223', { whatsapp, email, env: {} });
    expect(r.canal).toBe('email');
    expect(whatsapp).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledTimes(1);
    expect(email.mock.calls[0]![1]).toContain('Sentinela das ferramentas, 21/10.');
  });

  it('linha caída (direto_email): nem tenta o WhatsApp', async () => {
    const whatsapp = vi.fn(async (_t: string, _m: string) => {});
    const email = vi.fn(async (_a: string, _h: string) => {});
    expect((await enviarAviso('Oi', '34991360223', { whatsapp, email, env: {} }, { direto_email: true })).canal).toBe('email');
    expect(whatsapp).not.toHaveBeenCalled();
    expect(email).toHaveBeenCalledTimes(1);
  });

  it('se o e-mail também falhar, o erro sobe (a rodada registra falha_envio)', async () => {
    const whatsapp = async () => { throw new Error('a'); };
    const email = async () => { throw new Error('b'); };
    await expect(enviarAviso('Oi', '1', { whatsapp, email, env: {} })).rejects.toThrow('b');
  });

  it('o padrão usa a instância io do zapiClient', async () => {
    const z = await import('../services/agents/zapiClient');
    await enviarAviso('Oi', '34991360223', { env: {} });
    expect(z.sendWhatsApp).toHaveBeenCalledWith('34991360223', 'Oi', 'io');
  });
});

describe('nenhuma URL da Z-API nos arquivos novos', () => {
  const ARQUIVOS = [
    'services/agentes5040/sentinela.ts', 'services/agentes5040/sentinelaLeituras.ts', 'services/agentes5040/sentinelaGiovanna.ts',
    'services/agentes5040/sentinelaRodada.ts', 'services/agentes5040/sentinelaSonda.ts', 'services/io/sentinelaEnvio.ts', 'routes/geradorSentinela.ts',
  ];
  it('sem host da Z-API, sem molde /instances/ e sem endpoint send-*', () => {
    for (const rel of ARQUIVOS) {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      expect(/z-api\.io/i.test(src), rel).toBe(false);
      expect(/\/instances\//.test(src), rel).toBe(false);
      expect(/['"`]send-(text|image|audio|video|document|link)/.test(src), rel).toBe(false);
    }
  });

  it('só o sentinelaEnvio importa o cliente de envio e o e-mail; a avaliação e as leituras ficam puras', () => {
    for (const rel of ARQUIVOS.filter(a => a !== 'services/io/sentinelaEnvio.ts')) {
      const src = readFileSync(join(__dirname, '..', rel), 'utf8');
      expect(/zapiClient|mailer|sendWhatsApp|sendOpsAlert/.test(src.replace(/\/\/.*$/gm, '')), rel).toBe(false);
    }
  });
});

// ── leituras com fetch falso ─────────────────────────────────────────────────

const resp = (corpo: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as unknown as Response;

function depsLeit(over: Partial<DepsLeituras> = {}): DepsLeituras {
  return {
    fetch: (async () => resp({ account_status: 1 })) as unknown as typeof fetch,
    env: { META_SYSTEM_USER_TOKEN: 'tok-secreto', OPENAI_API_KEY: 'sk-x' },
    agora: AGORA,
    lerEstado: async () => null,
    listarEstado: async () => [],
    anthropic: () => ({ messages: { create: async () => ({}) } }),
    ...over,
  };
}

describe('leitura do Meta', () => {
  it('as duas contas, token no cabeçalho e nunca na URL', async () => {
    const f = vi.fn(async () => resp({ account_status: 1, spend_cap: '0', funding_source_details: { type: 1, display_string: 'Visa 1234' } }));
    const l = await lerMeta(depsLeit({ fetch: f as unknown as typeof fetch }));
    expect(l.map(x => [x.ferramenta, x.estado])).toEqual([['Meta act_545732112868250', 'ok'], ['Meta act_1411786166570474', 'ok']]);
    const urls = f.mock.calls.map(c => String((c as unknown[])[0]));
    expect(urls[0]).toContain('act_545732112868250?fields=account_status,disable_reason,balance,amount_spent,spend_cap,funding_source_details');
    expect(urls[1]).toContain('act_1411786166570474?');
    expect(urls.some(u => u.includes('tok-secreto'))).toBe(false);
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer tok-secreto');
  });

  it('conta fora do ar e token recusado são falha; erro de rede e 5xx são não conferido', async () => {
    const fora = await lerMeta(depsLeit({ fetch: (async () => resp({ account_status: 2, disable_reason: 1 })) as unknown as typeof fetch }));
    expect(fora[0]).toMatchObject({ estado: 'falha' });
    expect(fora[0]!.detalhe).toContain('status 2');
    const tok = await lerMeta(depsLeit({ fetch: (async () => resp({ error: { code: 190 } }, 400)) as unknown as typeof fetch }));
    expect(tok[0]).toMatchObject({ estado: 'falha' });
    const cinco = await lerMeta(depsLeit({ fetch: (async () => resp({}, 503)) as unknown as typeof fetch }));
    expect(cinco[0]).toMatchObject({ estado: 'nao_conferido' });
    const rede = await lerMeta(depsLeit({ fetch: (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch }));
    expect(rede[0]).toMatchObject({ estado: 'nao_conferido' });
    const limite = await lerMeta(depsLeit({ fetch: (async () => resp({ error: { code: 4 } }, 429)) as unknown as typeof fetch }));
    expect(limite[0]).toMatchObject({ estado: 'nao_conferido' });
  });

  it('folga até o spend_cap e saldo pré-pago abaixo do mínimo (padrão R$ 100, por env)', async () => {
    const cap = (cap: string, gasto: string) => depsLeit({ fetch: (async () => resp({ account_status: 1, spend_cap: cap, amount_spent: gasto })) as unknown as typeof fetch });
    expect((await lerMeta(cap('100000', '95000')))[0]).toMatchObject({ estado: 'baixo' });     // folga R$ 50
    expect((await lerMeta(cap('100000', '80000')))[0]).toMatchObject({ estado: 'ok' });        // folga R$ 200
    const pre = (texto: string) => depsLeit({ fetch: (async () => resp({ account_status: 1, spend_cap: '0', funding_source_details: { type: 20, display_string: texto } })) as unknown as typeof fetch });
    expect((await lerMeta(pre('Saldo disponível (R$ 20,00 BRL)')))[0]).toMatchObject({ estado: 'baixo' });
    expect((await lerMeta(pre('Saldo disponível (R$ 1.250,00 BRL)')))[0]).toMatchObject({ estado: 'ok' });
    expect((await lerMeta(pre('Saldo desconhecido')))[0]).toMatchObject({ estado: 'nao_conferido' });
    const baixoComEnv = depsLeit({ env: { META_SYSTEM_USER_TOKEN: 't', SENTINELA_META_MINIMO: '5000' }, fetch: (async () => resp({ account_status: 1, spend_cap: '0', funding_source_details: { type: 20, display_string: 'R$ 1.250,00' } })) as unknown as typeof fetch });
    expect((await lerMeta(baixoComEnv))[0]).toMatchObject({ estado: 'baixo' });   // mínimo R$ 5.000 por env
    expect(minimoMetaCentavos({})).toBe(10000);
    expect(minimoMetaCentavos({ SENTINELA_META_MINIMO: '250,50' })).toBe(25050);
    expect(saldoDoTexto('R$ 1.250,05')).toBe(125005);
  });

  it('sem token não chama a rede e não alarma', async () => {
    const f = vi.fn();
    const l = await lerMeta(depsLeit({ env: {}, fetch: f as unknown as typeof fetch }));
    expect(l.every(x => x.estado === 'nao_conferido')).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('leitura da Z-API (só a chave do monitor)', () => {
  const com = (value: any, updated_at = '2026-10-21T09:30:00Z') => depsLeit({ lerEstado: async k => (k === 'zapi_io_health' ? { value, updated_at } : null) });
  it('linha caída é falha; conectada é ok; sem registro é não conferido', async () => {
    expect((await lerZapi(com({ downStreak: 3 }))).estado).toBe('falha');
    expect((await lerZapi(com({ downStreak: 1 }))).estado).toBe('ok');
    expect((await lerZapi(com({ downStreak: 0, alertadoEm: '2026-10-20T10:00:00Z', reconectadoEm: '2026-10-20T12:00:00Z' }))).estado).toBe('ok');
    expect((await lerZapi(com({ downStreak: 0, alertadoEm: '2026-10-20T10:00:00Z' }))).estado).toBe('falha');
    expect((await lerZapi(depsLeit())).estado).toBe('nao_conferido');
    expect((await lerZapi(depsLeit({ lerEstado: async () => { throw new Error('x'); } }))).estado).toBe('nao_conferido');
  });
  it('leitura do monitor com mais de 2 h é não conferido, mesmo dizendo linha caída', async () => {
    expect((await lerZapi(com({ downStreak: 5 }, '2026-10-21T07:59:00Z'))).estado).toBe('nao_conferido');
    expect((await lerZapi(com({ downStreak: 5 }, '2026-10-21T08:01:00Z'))).estado).toBe('falha');
    expect((await lerZapi(depsLeit({ lerEstado: async () => ({ value: { downStreak: 5 } }) }))).estado).toBe('nao_conferido');
  });
  it('não faz nenhuma chamada de rede', async () => {
    const f = vi.fn();
    await lerZapi(depsLeit({ fetch: f as unknown as typeof fetch }));
    expect(f).not.toHaveBeenCalled();
  });
});

describe('leitura da Anthropic', () => {
  const falha = (e: any) => depsLeit({ anthropic: () => ({ messages: { create: async () => { throw e; } } }) });
  it('sonda de 1 token no modelo mais barato', async () => {
    const create = vi.fn(async (_a: any, _o?: any) => ({}));
    const l = await lerAnthropic(depsLeit({ anthropic: () => ({ messages: { create } }) }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-5-5', max_tokens: 1 }),
      expect.objectContaining({ maxRetries: 0, timeout: 8000, signal: expect.any(AbortSignal) }),
    );
    expect(l[0]).toMatchObject({ ferramenta: 'Anthropic', estado: 'ok' });
  });
  it('chave recusada e saldo zerado são falha; modelo inexistente, 429 e queda são não conferido', async () => {
    expect((await lerAnthropic(falha({ status: 401 })))[0]!.estado).toBe('falha');
    expect((await lerAnthropic(falha({ status: 400, message: 'Your credit balance is too low to access the API' })))[0]!.estado).toBe('falha');
    expect((await lerAnthropic(falha({ status: 404, message: 'model: claude-haiku-5-5' })))[0]!.estado).toBe('nao_conferido');
    expect((await lerAnthropic(falha({ status: 429 })))[0]!.estado).toBe('nao_conferido');
    expect((await lerAnthropic(falha(new Error('timeout'))))[0]!.estado).toBe('nao_conferido');
  });
  it('aviso de falha de IA nas últimas 24h vira falha, com as causas', async () => {
    const listarEstado = vi.fn(async () => [{ key: 'ia_falha_aviso:saldo', updated_at: '2026-10-21T05:00:00Z' }]);
    const l = await lerAnthropic(depsLeit({ listarEstado }));
    expect(listarEstado).toHaveBeenCalledWith('ia_falha_aviso:', '2026-10-20T10:00:00.000Z');
    expect(l[1]).toMatchObject({ ferramenta: 'IA dos robôs', estado: 'falha' });
    expect(l[1]!.detalhe).toContain('saldo');
  });
});

describe('leitura da OpenAI e do resto', () => {
  it('só prova que a chave vale', async () => {
    const f = vi.fn(async () => resp({ data: [] }));
    expect((await lerOpenAI(depsLeit({ fetch: f as unknown as typeof fetch }))).estado).toBe('ok');
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('https://api.openai.com/v1/models');
    expect((await lerOpenAI(depsLeit({ fetch: (async () => resp({}, 401)) as unknown as typeof fetch }))).estado).toBe('falha');
    expect((await lerOpenAI(depsLeit({ fetch: (async () => resp({}, 500)) as unknown as typeof fetch }))).estado).toBe('nao_conferido');
    expect((await lerOpenAI(depsLeit({ env: {} }))).estado).toBe('nao_conferido');
  });

  it('o conjunto traz o Cloudinary como não conferido, e tudo em ordem não gera alerta', async () => {
    const l = await lerTudo(depsLeit());
    expect(l.find(x => x.ferramenta === 'Cloudinary')).toMatchObject({ estado: 'nao_conferido' });
    expect(avaliar(l, [], AGORA)).toEqual([]);
  });
});

// ── sonda ────────────────────────────────────────────────────────────────────

/** system_state em memória, com o suficiente do PostgREST para a sonda: insert (23505), upsert, select/count, delete. */
function bancoFalso() {
  const linhas = new Map<string, any>();
  const tabela = {
    insert: async (row: any) => {
      if (linhas.has(row.key)) return { error: { code: '23505', message: 'duplicate key' } };
      linhas.set(row.key, row); return { error: null };
    },
    upsert: async (row: any) => { linhas.set(row.key, row); return { error: null }; },
    delete: () => ({ eq: async (_c: string, k: string) => { linhas.delete(k); return { error: null }; } }),
    select: (_c: string, o?: { count?: string }) => ({
      eq: (_c2: string, k: string) => o?.count
        ? Promise.resolve({ count: linhas.has(k) ? 1 : 0, error: null })
        : { maybeSingle: async () => ({ data: linhas.get(k) ?? null, error: null }) },
    }),
  };
  return { from: () => tabela as any, linhas, tabela };
}

describe('sonda da sentinela', () => {
  it('foto escreve, lê e apaga; a 2ª reserva dá 23505, conta 1, apaga e conta 0', async () => {
    const b = bancoFalso();
    const r = await sondaSentinela(b, AGORA);
    expect(r.ok).toBe(true);
    expect(r.passos).toMatchObject({
      foto_leu_igual: true, foto_apagada: true, reserva_1: 'reservado', reserva_2: 'ja', conta_depois_de_duas: 1, conta_depois_de_apagar: 0,
    });
    expect(b.linhas.size).toBe(0);
  });

  it('banco que aceita reserva repetida reprova a sonda', async () => {
    const b = bancoFalso();
    b.tabela.insert = async (row: any) => { b.linhas.set(row.key, row); return { error: null }; };
    expect((await sondaSentinela(b, AGORA)).ok).toBe(false);
  });
});
