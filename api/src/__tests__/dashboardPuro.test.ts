import { describe, it, expect } from 'vitest';
import {
  AGUARDANDO, RESOLVIDOS, NEGOCIACAO, grupoDaAgenda, familiaDe, chaveDoPeriodo, periodoDe, mesesRecentes,
  listaDeDias, nomeAbreviado, montarAgendaHoje, montarVencidos, montarQuizSemHorario, montarFunil,
  montarPorDia, montarTime, montarDashboard, vendasEletroposto, montarNegocio, resumirTrafego,
  cardsCriadosNoPeriodo, type CardBruto, type PropostaBruta, type LeadQuizBruto,
} from '../services/gerador/dashboardPuro';
import { planilhaPadrao } from './solarPlanilhaFixture';
import { lerPlanilha } from '../services/gerador/solarObras';

// "Agora" de referência: 12/10/2026 às 12h de Brasília (15h UTC).
const AGORA = new Date('2026-10-12T15:00:00Z');
const HOJE = '2026-10-12';

let seq = 0;
const card = (o: Partial<CardBruto> = {}): CardBruto => ({
  id: ++seq, quando: '2026-10-12T17:30:00Z', status: 'agendado', vendedor_nome: 'Nilce',
  cliente_nome: 'Ana Souza Lima', cidade: 'Uberlândia', created_at: '2026-10-05T12:00:00Z',
  created_by: 'lp_solar', ...o,
});
const Q_SOCIO = { nome: 'thiago', socio: true };
const Q_NILCE = { nome: 'nilce', socio: false };

describe('constantes de status', () => {
  it('as três listas são as combinadas e não se cruzam', () => {
    expect(AGUARDANDO).toEqual(['agendado', 'reagendar']);
    expect(RESOLVIDOS).toEqual(['sem_interesse', 'fechou', 'fechou_concorrente', 'perdido']);
    expect(NEGOCIACAO).toHaveLength(11);
    expect(NEGOCIACAO).toContain('apalavrado');
    for (const s of NEGOCIACAO) { expect(AGUARDANDO).not.toContain(s); expect(RESOLVIDOS).not.toContain(s); }
  });
  it('grupo da agenda: cancelado fora, desconhecido é retorno', () => {
    expect(grupoDaAgenda('cancelado')).toBeNull();
    expect(grupoDaAgenda('agendado')).toBe('aguardando');
    expect(grupoDaAgenda('REAGENDAR ')).toBe('aguardando');
    expect(grupoDaAgenda('fechou')).toBe('resolvidos');
    expect(grupoDaAgenda('nao_atendeu')).toBe('retornos');
    expect(grupoDaAgenda('status_novo_qualquer')).toBe('retornos');
    expect(grupoDaAgenda(null)).toBe('retornos');
  });
  it('família: eletroposto pela palavra, o resto (inclusive nulo) é solar', () => {
    expect(familiaDe('prosp_eletroposto')).toBe('eletroposto');
    expect(familiaDe('agente_eletroposto')).toBe('eletroposto');
    expect(familiaDe('lp_solar')).toBe('solar');
    expect(familiaDe(null)).toBe('solar');
  });
});

describe('dia e mês de Brasília', () => {
  it('card às 23:30 de Brasília é de hoje; à 00:30 é de amanhã', () => {
    const tarde = card({ quando: '2026-10-13T02:30:00Z' });     // 23:30 BRT de 12/10
    const madrugada = card({ quando: '2026-10-13T03:30:00Z' }); // 00:30 BRT de 13/10
    const a = montarAgendaHoje([tarde, madrugada], HOJE, new Date('2026-10-12T20:00:00Z'));
    expect(a.total).toBe(1);
    expect(a.proximos.map((p) => p.hora)).toEqual(['23:30']);
    expect(a.amanha.total).toBe(1);
  });
  it('agora às 22h de Brasília (01h UTC do dia seguinte) ainda é o mesmo dia', () => {
    const d = montarDashboard({ cards: [card({ quando: '2026-10-13T02:30:00Z' })], propostas: [], leads: [] }, Q_SOCIO, 'mes', new Date('2026-10-13T01:00:00Z'));
    expect(d.hoje).toBe('2026-10-12');
    expect(d.periodo.ate).toBe('2026-10-12');
    expect(d.agendaHoje.total).toBe(1);
    expect(d.agendaHoje.proximos[0].hora).toBe('23:30');
  });
  it('virada de mês: 23h de 31/10 em Brasília ainda é outubro', () => {
    const agora = new Date('2026-11-01T02:00:00Z');
    const p = periodoDe('mes', '2026-10-31');
    expect(p).toMatchObject({ de: '2026-10-01', ate: '2026-10-31', rotulo: 'Este mês' });
    const noMes = card({ created_at: '2026-11-01T02:30:00Z' });   // 31/10 23:30 BRT
    const depois = card({ created_at: '2026-11-01T03:30:00Z' });  // 01/11 00:30 BRT
    expect(cardsCriadosNoPeriodo([noMes, depois], p)).toEqual([noMes]);
    const d = montarDashboard({ cards: [noMes, depois], propostas: [], leads: [] }, Q_SOCIO, 'mes', agora);
    expect(d.periodo.de).toBe('2026-10-01');
    expect(d.funil.solar.agendaram).toBe(1);
    expect(d.porDia).toHaveLength(31);
  });
  it('períodos: mes, 30 e 90 dias corridos inclusive; inválido cai em mes', () => {
    expect(periodoDe('30dias', HOJE)).toMatchObject({ de: '2026-09-13', ate: HOJE, rotulo: 'Últimos 30 dias' });
    expect(periodoDe('90dias', HOJE)).toMatchObject({ de: '2026-07-15', ate: HOJE });
    expect(listaDeDias('2026-07-15', HOJE)).toHaveLength(90);
    expect(chaveDoPeriodo('lixo')).toBe('mes');
    expect(chaveDoPeriodo(undefined)).toBe('mes');
    expect(chaveDoPeriodo('90dias')).toBe('90dias');
  });
  it('seis meses de calendário, o corrente por último', () => {
    expect(mesesRecentes('2026-02-10')).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('agenda de hoje', () => {
  const cards = [
    card({ id: 1, quando: '2026-10-12T13:00:00Z', vendedor_nome: 'Giovanna', cliente_nome: 'Passou Faz Tempo' }),        // 10:00, antes de agora-15min
    card({ id: 2, quando: '2026-10-12T14:50:00Z', vendedor_nome: 'Giovanna', cliente_nome: 'Quase Agora' }),            // 11:50, dentro dos 15 min
    card({ id: 3, quando: '2026-10-12T17:30:00Z', vendedor_nome: 'Nilce', cliente_nome: 'Ana Souza Lima' }),            // 14:30
    card({ id: 4, quando: '2026-10-12T18:00:00Z', vendedor_nome: 'Nilce', status: 'nao_atendeu', created_by: 'lp_eletroposto' }),
    card({ id: 5, quando: '2026-10-12T19:00:00Z', vendedor_nome: 'Nilce', status: 'cancelado' }),
    card({ id: 6, quando: '2026-10-12T20:00:00Z', vendedor_nome: 'Nilce', status: 'fechou' }),
    card({ id: 7, quando: '2026-10-12T21:00:00Z', vendedor_nome: 'diego', status: 'status_novo' }),
    card({ id: 8, quando: '2026-10-13T13:00:00Z', vendedor_nome: 'Nilce' }),
    card({ id: 9, quando: '2026-10-13T14:00:00Z', vendedor_nome: 'Nilce', status: 'nao_atendeu' }),
    card({ id: 10, quando: '2026-10-13T14:00:00Z', vendedor_nome: 'Nilce', status: 'cancelado' }),
    card({ id: 11, quando: null }),
  ];
  const a = montarAgendaHoje(cards, HOJE, AGORA);

  it('cancelado fora e total = soma dos três grupos', () => {
    expect(a).toMatchObject({ total: 6, aguardando: 3, retornos: 2, resolvidos: 1 });
    expect(a.total).toBe(a.aguardando + a.retornos + a.resolvidos);
  });
  it('por consultor: alfabético, com o próximo horário de quem ainda tem o que fazer', () => {
    expect(a.porConsultor.map((l) => l.consultor)).toEqual(['diego', 'Giovanna', 'Nilce']);
    const nilce = a.porConsultor.find((l) => l.consultor === 'Nilce')!;
    expect(nilce).toMatchObject({ aguardando: 1, retornos: 1, resolvidos: 1, proximo: '14:30' });
    // Giovanna: o das 10h passou; o próximo a partir de agora não existe, o das 11:50 também já passou de 12:00? (11:50 < 12:00)
    expect(a.porConsultor.find((l) => l.consultor === 'Giovanna')!.proximo).toBeNull();
  });
  it('próximos: a partir de agora menos 15 min, em ordem, sem resolvido, nome abreviado', () => {
    expect(a.proximos.map((p) => p.id)).toEqual([2, 3, 4, 7]);
    expect(a.proximos[1]).toMatchObject({ hora: '14:30', cliente: 'Ana L.', produto: 'solar', grupo: 'aguardando', status: 'agendado', cidade: 'Uberlândia' });
    expect(a.proximos[2]).toMatchObject({ grupo: 'retorno', produto: 'eletroposto' });
    expect(JSON.stringify(a)).not.toMatch(/telefone|fone/i);
  });
  it('amanhã: sem resolvidos e sem cancelado', () => {
    expect(a.amanha).toEqual({ total: 2, aguardando: 1, retornos: 1 });
  });
  it('limita a 8 próximos', () => {
    const muitos = Array.from({ length: 12 }, (_, i) => card({ quando: `2026-10-12T${String(16 + (i % 6)).padStart(2, '0')}:00:00Z` }));
    expect(montarAgendaHoje(muitos, HOJE, AGORA).proximos).toHaveLength(8);
  });
  it('nome abreviado', () => {
    expect(nomeAbreviado('Ana Souza Lima')).toBe('Ana L.');
    expect(nomeAbreviado('  joão  silva ')).toBe('joão S.');
    expect(nomeAbreviado('Maria')).toBe('Maria');
    expect(nomeAbreviado('34999990000')).toBe('Cliente');
    // Telefone formatado no lugar do nome nunca sai, nem em pedaço.
    expect(nomeAbreviado('99999-1234')).toBe('Cliente');
    expect(nomeAbreviado('(34) 99999-1234')).toBe('Cliente');
    expect(nomeAbreviado('+55 (34) 99999-1234')).toBe('Cliente');
    expect(nomeAbreviado('Ana 34 99999-1234')).toBe('Cliente');
    expect(nomeAbreviado('Ana (mãe)')).toBe('Ana');
    expect(nomeAbreviado('x123456')).toBe('Cliente');
    expect(nomeAbreviado('Ana-12345')).toBe('Cliente');
    expect(nomeAbreviado('Tel:99991 Maria')).toBe('Maria');
    expect(nomeAbreviado('Ana99812 Souza')).toBe('Souza');
    expect(nomeAbreviado('ana@x.com')).toBe('Cliente');
    expect(nomeAbreviado("Maria D'Ávila Sá-Lima")).toBe('Maria S.');
    expect(nomeAbreviado('')).toBe('Cliente');
    expect(nomeAbreviado(null)).toBe('Cliente');
  });
});

describe('agendados vencidos', () => {
  it('só aguardando com quando antes de hoje; dias do mais antigo; por família', () => {
    const v = montarVencidos([
      card({ quando: '2026-10-11T20:00:00Z' }),                                         // ontem
      card({ quando: '2026-06-17T15:00:00Z', status: 'reagendar', created_by: 'prosp_eletroposto' }),
      card({ quando: '2026-10-12T04:00:00Z' }),                                         // 01:00 BRT de hoje: não é vencido
      card({ quando: '2026-10-13T03:00:00Z' }),                                         // 00:00 BRT de amanhã
      card({ quando: '2026-09-01T15:00:00Z', status: 'nao_atendeu' }),                  // não é aguardando
      card({ quando: '2026-09-01T15:00:00Z', status: 'cancelado' }),
      card({ quando: null }),
    ], HOJE);
    expect(v).toEqual({ total: 2, maisAntigoDias: 117, solar: 1, eletroposto: 1 });
  });
  it('sem nenhum, tudo zero', () => {
    expect(montarVencidos([], HOJE)).toEqual({ total: 0, maisAntigoDias: 0, solar: 0, eletroposto: 0 });
  });
});

describe('quiz sem horário', () => {
  const fd = (caminho: string) => [{ name: 'Caminho', values: [caminho] }];
  const lead = (o: Partial<LeadQuizBruto>): LeadQuizBruto => ({
    lead_id: 'quiz_5534991110001', created_time: '2026-10-10T12:00:00Z', field_data: fd('vistoria'), agendado_id: null, consultor: 'Nilce', ...o,
  });
  const leads = [
    lead({}),
    lead({ lead_id: 'quizX5534991110002' }),                                       // "_" é curinga no LIKE
    lead({ lead_id: 'quiz_2', agendado_id: 77 }),                                  // já tem horário
    lead({ lead_id: 'quiz_3', field_data: fd('Curioso') }),
    lead({ lead_id: 'quiz_4', created_time: '2026-10-04T12:00:00Z' }),            // mais de 7 dias
    lead({ lead_id: 'quiz_5', consultor: 'Diego' }),
    lead({ lead_id: 'quiz_6', field_data: [] }),
  ];
  it('sócio vê todos que sobram; consultor comum só os dele', () => {
    expect(montarQuizSemHorario(leads, Q_SOCIO, AGORA)).toEqual({ total: 3 });
    expect(montarQuizSemHorario(leads, Q_NILCE, AGORA)).toEqual({ total: 2 });
  });
});

describe('funil (coorte por criação)', () => {
  const coorte = [
    card({ status: 'agendado' }), card({ status: 'reagendar' }),
    card({ status: 'sem_interesse' }), card({ status: 'nao_atendeu' }), card({ status: 'cancelado' }),
    card({ status: 'fez_orcamento' }), card({ status: 'fechou' }), card({ status: 'status_novo' }),
    card({ status: 'agendado', created_by: 'lp_eletroposto' }), card({ status: 'cotista', created_by: 'lp_eletroposto' }),
    card({ status: 'agendado', created_by: null }),
  ];
  const f = montarFunil(coorte);
  it('contas do solar, com status desconhecido contando como conversa', () => {
    expect(f.solar).toEqual({ agendaram: 9, conversaram: 4, avancaram: 2, semInteresse: 1, naoAtendeu: 1, cancelados: 1, aguardando: 3 });
  });
  it('eletroposto separado', () => {
    expect(f.eletroposto).toEqual({ agendaram: 2, conversaram: 1, avancaram: 1, semInteresse: 0, naoAtendeu: 0, cancelados: 0, aguardando: 1 });
  });
  it('agendaram = conversaram + naoAtendeu + cancelados + aguardando', () => {
    for (const l of [f.solar, f.eletroposto]) expect(l.agendaram).toBe(l.conversaram + l.naoAtendeu + l.cancelados + l.aguardando);
  });
  it('só entra quem foi CRIADO no período, e semOrigem conta o created_by vazio', () => {
    const dentro = card({ created_at: '2026-10-03T12:00:00Z', created_by: null });
    const antes = card({ created_at: '2026-09-30T12:00:00Z' });          // criado em setembro, agendado para hoje
    const d = montarDashboard({ cards: [dentro, antes], propostas: [], leads: [] }, Q_SOCIO, 'mes', AGORA);
    expect(d.funil.solar.agendaram).toBe(1);
    expect(d.notas.semOrigem).toBe(1);
    expect(d.agendaHoje.total).toBe(2);   // a agenda de hoje olha o `quando`, não a criação
  });
});

describe('por dia e time', () => {
  it('um item por dia do período, com zeros', () => {
    const p = periodoDe('mes', HOJE);
    const dias = montarPorDia([card({ created_at: '2026-10-03T12:00:00Z' }), card({ created_at: '2026-10-03T13:00:00Z', created_by: 'lp_eletroposto' })], p);
    expect(dias).toHaveLength(12);
    expect(dias[0]).toEqual({ dia: '2026-10-01', solar: 0, eletroposto: 0 });
    expect(dias[2]).toEqual({ dia: '2026-10-03', solar: 1, eletroposto: 1 });
    expect(montarPorDia([], periodoDe('90dias', HOJE))).toHaveLength(90);
  });
  it('time em ordem alfabética, juntando Nilce e nilce e contando propostas do período', () => {
    const p = periodoDe('mes', HOJE);
    const props: PropostaBruta[] = [
      { consultor_nome: 'Nilce', created_at: '2026-10-02T12:00:00Z' },
      { consultor_nome: 'nilce', created_at: '2026-10-03T12:00:00Z' },
      { consultor_nome: 'Nilce', created_at: '2026-08-03T12:00:00Z' },          // fora do período
      { consultor_nome: 'Bruno', created_at: '2026-10-04T12:00:00Z' },          // só proposta
    ];
    const t = montarTime(cardsCriadosNoPeriodo([
      card({ vendedor_nome: 'Nilce', status: 'fechou' }), card({ vendedor_nome: 'nilce' }),
      card({ vendedor_nome: 'Giovanna', status: 'sem_interesse' }), card({ vendedor_nome: null }),
    ], p), props, p);
    expect(t.map((x) => x.consultor)).toEqual(['Bruno', 'Giovanna', 'Nilce']);
    expect(t.find((x) => x.consultor === 'Nilce')).toEqual({ consultor: 'Nilce', agendaram: 2, conversaram: 1, avancaram: 1, propostas: 2 });
    expect(t.find((x) => x.consultor === 'Bruno')).toMatchObject({ agendaram: 0, propostas: 1 });
  });
});

describe('corte do consultor comum', () => {
  const cards = [
    card({ vendedor_nome: 'Nilce', created_by: 'lp_solar' }),
    card({ vendedor_nome: 'NILCE ', status: 'fechou' }),
    card({ vendedor_nome: 'Giovanna' }),
    card({ vendedor_nome: 'Giovanna', quando: '2026-06-01T12:00:00Z' }),
  ];
  const bruto = { cards, propostas: [{ consultor_nome: 'Giovanna', created_at: '2026-10-05T12:00:00Z' }], leads: [] };
  it('agenda, pendências, funil, porDia e time só com o que é dele', () => {
    const socio = montarDashboard(bruto, Q_SOCIO, 'mes', AGORA);
    const nilce = montarDashboard(bruto, Q_NILCE, 'mes', AGORA);
    expect(socio.agendaHoje.total).toBe(3);
    expect(nilce.agendaHoje.total).toBe(2);
    expect(nilce.agendaHoje.porConsultor.map((l) => l.consultor)).toEqual(['Nilce']);
    expect(nilce.pendencias.agendadosVencidos.total).toBe(0);
    expect(socio.pendencias.agendadosVencidos.total).toBe(1);
    expect(nilce.funil.solar.agendaram).toBe(2);
    expect(socio.funil.solar.agendaram).toBe(4);
    expect(socio.time.map((t) => t.consultor)).toEqual(['Giovanna', 'Nilce']);
    expect(socio.time.find((t) => t.consultor === 'Giovanna')?.propostas).toBe(1);
    // Desempenho de colega não vai para consultor comum: nem a linha, nem a proposta dela.
    expect(nilce.time.map((t) => t.consultor)).toEqual(['Nilce']);
    expect(nilce.time[0].propostas).toBe(0);
    expect(JSON.stringify(nilce.time)).not.toContain('Giovanna');
    expect(nilce).toMatchObject({ consultor: 'nilce', verTudo: false, verDinheiro: false });
  });
  it('não muta o dado bruto', () => {
    const antes = JSON.stringify(bruto);
    montarDashboard(bruto, Q_NILCE, '90dias', AGORA);
    expect(JSON.stringify(bruto)).toBe(antes);
  });
});

describe('vendas do eletroposto', () => {
  const fechados = [
    card({ id: 101, status: 'fechou', created_by: 'lp_eletroposto', created_at: '2026-09-02T12:00:00Z', vendedor_nome: 'Nilce' }),
    card({ id: 102, status: 'fechou', created_by: 'lp_eletroposto', created_at: '2026-10-02T12:00:00Z', vendedor_nome: 'Giovanna' }),
    card({ id: 103, status: 'fechou', created_by: 'lp_solar' }),                       // solar: venda é da planilha
    card({ id: 104, status: 'agendado', created_by: 'lp_eletroposto' }),
  ];
  const registros = new Map<number, unknown>([
    [101, { valor: 154000, vendido_em: '2026-10-05', modelo: 'meio_a_meio' }],
    [999, { valor: 1, vendido_em: '2026-10-05' }],
  ]);
  it('com registro vale valor e data do registro; sem registro, conta sem valor e com a data do card', () => {
    const v = vendasEletroposto(fechados, registros);
    expect(v).toEqual([
      { id: 101, consultor: 'Nilce', dia: '2026-10-05', valor: 154000, semRegistro: false },
      { id: 102, consultor: 'Giovanna', dia: '2026-10-02', valor: null, semRegistro: true },
    ]);
  });
});

describe('negócio', () => {
  const obras = lerPlanilha(planilhaPadrao());
  const registros = new Map<number, unknown>([[101, { valor: 154000, vendido_em: '2026-10-05' }]]);
  const cards = [
    card({ id: 101, status: 'fechou', created_by: 'lp_eletroposto', vendedor_nome: 'Nilce' }),
    card({ id: 102, status: 'fechou', created_by: 'lp_eletroposto', created_at: '2026-08-10T12:00:00Z', vendedor_nome: 'Giovanna' }),
  ];
  const base = { planilha: obras, cards, registros, posVendaOk: true, trafego: { rotulo: 'Últimos 30 dias', meta_ok: false }, chave: 'mes' as const, agora: AGORA };

  it('sócio: meses de calendário com o corrente parcial, valor, a receber e obras', () => {
    const n = montarNegocio({ ...base, quem: Q_SOCIO }) as any;
    expect(n.vendas.porMes.map((m: any) => m.mes)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(n.vendas.porMes.map((m: any) => m.parcial)).toEqual([false, false, false, false, false, true]);
    const mes = (m: string) => n.vendas.porMes.find((x: any) => x.mes === m);
    expect(mes('2026-10').eletroposto).toEqual({ qtd: 1, valor: 154000 });
    expect(mes('2026-08')).toMatchObject({ solar: { qtd: 2, valor: 6990 + 8500 } });
    // Venda sem valor registrado não vira R$ 0: a chave `valor` nem sai.
    expect(mes('2026-08').eletroposto).toEqual({ qtd: 1, semValor: 1 });
    expect(mes('2026-06').solar.qtd).toBe(1);   // #0061, "1/06/2026"
    expect(n.vendas.periodo).toEqual({ solar: { qtd: 0, valor: 0 }, eletroposto: { qtd: 1, valor: 154000 } });
    expect(n.aReceber).toEqual({ valor: 6000, vendas: 1 });
    expect(n.obras).toMatchObject({ emAndamento: 3, concluidas: 2 });
    expect(n.obras.paradas15).toBeGreaterThanOrEqual(1);
    expect(n.fontes).toEqual({ planilha: true, posVenda: true });
    expect(n.trafego).toEqual({ rotulo: 'Últimos 30 dias', meta_ok: false });
    expect(n.notas.eletropostoSemRegistro).toBe(1);
  });
  it('consultor comum: só as vendas dele e nenhuma chave de dinheiro', () => {
    const n = montarNegocio({ ...base, quem: { nome: 'giovanna', socio: false }, trafego: null }) as any;
    expect(n.vendas.porMes.find((m: any) => m.mes === '2026-07').solar).toEqual({ qtd: 1 });
    expect(n.vendas.porMes.find((m: any) => m.mes === '2026-08').eletroposto).toEqual({ qtd: 1 });
    expect(n.vendas.porMes.find((m: any) => m.mes === '2026-10').eletroposto).toEqual({ qtd: 0 });
    expect(n).not.toHaveProperty('aReceber');
    expect(n).not.toHaveProperty('trafego');
    expect(JSON.stringify(n)).not.toMatch(/valor|gasto|custo|receber|trafego/i);
  });
  it('planilha fora: solar e obras zerados e marcados', () => {
    const n = montarNegocio({ ...base, quem: Q_SOCIO, planilha: null }) as any;
    expect(n.fontes.planilha).toBe(false);
    expect(n.obras).toEqual({ indisponivel: true });
    // Planilha fora não vira R$ 0: as chaves de valor nem saem.
    expect(n.vendas.periodo.solar).toEqual({ indisponivel: true });
    expect(n.notas.vendasSemData).toBeUndefined();
    expect(n.aReceber).toEqual({ indisponivel: true });
    expect(n.vendas.periodo.eletroposto.qtd).toBe(1);
  });
  it('venda sem data fica fora dos meses e entra em notas', () => {
    const sem = lerPlanilha(planilhaPadrao().replace('03/08/2026', 'nc'));
    const n = montarNegocio({ ...base, quem: Q_SOCIO, planilha: sem }) as any;
    expect(n.notas.vendasSemData).toBe(1);
    expect(n.vendas.porMes.find((m: any) => m.mes === '2026-08').solar.qtd).toBe(1);
  });
});

describe('tráfego', () => {
  const painel = (meta_ok: boolean) => ({
    resultado: { agendados: 15 },
    porAnuncio: [{ gasto: 900 }, { gasto: 60 }, { gasto: null }],
    meta_ok,
  }) as any;
  it('gasto é a soma dos anúncios e o custo é gasto por agendado', () => {
    expect(resumirTrafego(painel(true))).toEqual({ rotulo: 'Últimos 30 dias', gasto: 960, agendados: 15, custoPorAgendado: 64, meta_ok: true });
  });
  it('Meta fora: sem gasto e sem custo', () => {
    const t = resumirTrafego(painel(false));
    expect(t).toEqual({ rotulo: 'Últimos 30 dias', agendados: 15, meta_ok: false });
    expect(resumirTrafego(null)).toEqual({ rotulo: 'Últimos 30 dias', meta_ok: false });
  });
});
