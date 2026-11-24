import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Resumo semanal do solar por vendedor (23/11/2026): sexta das 16h às 17h59 de Brasília, 1 envio por rodada, chave por pessoa por INSERT
// antes do envio, para no 1º erro. Nenhum telefone real aqui: os números são de mentira.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  envios: [] as Array<{ tel: string; instancia: string; texto: string }>,
  erro: null as string | null,
  cooldown: false,
  tel: {} as Record<string, string | null>,
  telefonesOk: true,
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/supabaseGerador', async () => ({ supabaseGerador: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendWhatsApp: vi.fn(async (tel: string, texto: string, instancia: string) => {
    h.envios.push({ tel, instancia, texto });
    if (h.erro) throw new Error(h.erro);
  }),
  linhaEmCooldown: vi.fn(() => h.cooldown),
}));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: vi.fn(async () => (h.telefonesOk ? { ok: true, mapa: new Map() } : { ok: false, codigo: 'x' })),
  telefoneDoConsultor: (_m: Map<string, string>, nome: string) => h.tel[nome.toLowerCase()] ?? null,
  erroProvaQueNaoSaiu: (e: unknown) => /em cooldown|credenciais Z-API ausentes/i.test(String((e as { message?: string } | null)?.message ?? e)),
}));

import { banco } from './_bancoFalso';
import { MARCA_ORIGEM_DUDA } from '../services/agenda/solarRota';
import {
  runSolarRelatorioSemanalTick, sondarTravaDoRelatorio, naJanelaDaSexta, sextaDeReferencia, periodoDaSemana,
  contarPorVendedor, montarTextoRelatorio, cardContaNoRelatorio, PESSOAS_RELATORIO, type CardRelatorio, type ContagemPessoa, type PessoaRelatorio,
} from '../services/io/solarRelatorioSemanal';

// Sexta, 27/11/2026 (Brasília = UTC-3). A semana é de 20/11 (sexta) a 26/11 (quinta).
const BRT = (dia: string, hhmm: string): number => new Date(`2026-11-${dia}T${hhmm}:00.000-03:00`).getTime();
const SEXTA = (hhmm: string): number => BRT('27', hhmm);
const TELS: Record<string, string> = { diego: '34900000001', thiago: '34900000002', nilce: '34900000003', giovanna: '34900000004' };

let seq = 0;
const iso = (dia: string, hhmm: string): string => new Date(BRT(dia, hhmm)).toISOString();
const card = (o: Partial<Record<string, unknown>> = {}) => ({
  id: ++seq, vendedor_nome: 'Diego', status: 'agendado', created_by: 'lp_solar',
  observacao: 'LP SOLAR QUIZ · Casa · LIGAÇÃO', created_at: iso('22', '12:00'), ...o,
});
const chaves = (): string[] => banco.linhas('system_state').filter(r => String(r.key).startsWith('solar_relatorio_semanal:')).map(r => String(r.key)).sort();

/** Cards de exemplo: o que conta e o que não conta, por vendedor. */
function poeCards(): void {
  banco.poe('agendamentos',
    // Diego: 3 leads (1 só agendado, 1 orçamento, 1 contrato) => 2 orçamentos no total, 1 contrato.
    card({ vendedor_nome: 'Diego' }),
    card({ vendedor_nome: 'Diego', status: 'fez_orcamento', created_by: 'leads-meta' }),
    card({ vendedor_nome: 'Diego', status: 'fechou', created_by: 'manychat' }),
    // Duda: created_by qualquer, mas a observação leva a origem dela.
    card({ vendedor_nome: 'Diego', status: 'proposta_apresentada', created_by: 'duda', observacao: `LP SOLAR QUIZ · Casa · LIGAÇÃO\n${MARCA_ORIGEM_DUDA}` }),
    // Fora: cancelado, SAIU SEM MARCAR, teste, indicação, eletroposto, antes e depois do período.
    card({ vendedor_nome: 'Diego', status: 'cancelado' }),
    card({ vendedor_nome: 'Diego', observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO' }),
    card({ vendedor_nome: 'Diego', status: 'fechou', created_by: 'lp_solar_teste' }),
    card({ vendedor_nome: 'Diego', status: 'fechou', created_by: 'indicacao' }),
    card({ vendedor_nome: 'Diego', status: 'fechou', created_by: 'lp_eletroposto' }),
    card({ vendedor_nome: 'Diego', status: 'fechou', created_at: iso('19', '23:59') }),   // quinta anterior, 23:59: semana passada
    card({ vendedor_nome: 'Diego', status: 'fechou', created_at: iso('27', '00:00') }),   // a própria sexta: semana que vem
    // Thiago: 2 leads; o que fechou com o concorrente conta como orçamento, mas não como contrato.
    card({ vendedor_nome: 'Thiago', created_by: 'lead-meta', created_at: iso('20', '00:00') }),   // 1º minuto do período
    card({ vendedor_nome: 'Thiago', status: 'fechou_concorrente' }),
    // Nilce: 1 lead, 1 orçamento, 1 contrato (tudo no singular).
    card({ vendedor_nome: 'Nilce', status: 'fechou', created_at: iso('26', '23:59') }),          // último minuto do período
    // Giovanna: nada. Vendedor de fora não entra.
    card({ vendedor_nome: 'Outro', status: 'fechou' }),
    card({ vendedor_nome: null, status: 'fechou' }),
  );
}

beforeEach(() => {
  banco.reset();
  h.envios.length = 0; h.erro = null; h.cooldown = false; h.telefonesOk = true;
  h.tel = { ...TELS };
  delete process.env.SOLAR_RELATORIO_OFF;
  seq = 0;
});
afterEach(() => { delete process.env.SOLAR_RELATORIO_OFF; });

const TEXTO_ESPERADO = [
  '📊 *BOLETIM SOLAR DA SEMANA* ☀️',
  '📅 De 20/11 a 26/11',
  '',
  '🏆 *Destaque: Diego*, 1 contrato fechado',
  '',
  '━━━━━━━━━━━━━━',
  '🔹 *DIEGO*\n📥 4 leads agendados\n📝 3 orçamentos\n✅ 1 contrato fechado',
  '',
  '🔹 *THIAGO*\n📥 2 leads agendados\n📝 1 orçamento\n✅ 0 contratos fechados',
  '',
  '🔹 *NILCE*\n📥 1 lead agendado\n📝 1 orçamento\n✅ 1 contrato fechado',
  '',
  '🔹 *GIOVANNA*\n📥 0 leads agendados\n📝 0 orçamentos\n✅ 0 contratos fechados',
  '━━━━━━━━━━━━━━',
  '📈 *Time:* 7 leads · 5 orçamentos · 2 contratos',
  'Bora pra cima! 💪',
].join('\n');

const PER = { rotuloDe: '14/11', rotuloAte: '20/11' };
const zero = { leads: 0, orcamentos: 0, contratos: 0 };
const cont = (o: Partial<Record<PessoaRelatorio, Partial<ContagemPessoa>>>): Record<PessoaRelatorio, ContagemPessoa> => ({
  Diego: { ...zero, ...o.Diego }, Thiago: { ...zero, ...o.Thiago }, Nilce: { ...zero, ...o.Nilce }, Giovanna: { ...zero, ...o.Giovanna },
});

describe('o conteúdo', () => {
  it('conta por vendedor: período, exclusões, orçamento, contrato e singular', async () => {
    poeCards();
    const r = await runSolarRelatorioSemanalTick({ dry: true, agora: SEXTA('16:00') });
    expect(r.motivo).toBe('dry');
    expect(r.contagem).toEqual({
      Diego: { leads: 4, orcamentos: 3, contratos: 1 },
      Thiago: { leads: 2, orcamentos: 1, contratos: 0 },
      Nilce: { leads: 1, orcamentos: 1, contratos: 1 },
      Giovanna: { leads: 0, orcamentos: 0, contratos: 0 },
    });
    expect(r.texto).toBe(TEXTO_ESPERADO);
  });

  it('o período é de sexta a quinta: na sexta 27/11 vai de 20/11 00:00 a 26/11 23:59 (Brasília)', () => {
    const p = periodoDaSemana('2026-11-27');
    expect([p.de, p.ate, p.rotuloDe, p.rotuloAte]).toEqual(['2026-11-20', '2026-11-26', '20/11', '26/11']);
    expect(p.iniIso).toBe('2026-11-20T03:00:00.000Z');
    expect(p.fimIso).toBe('2026-11-27T03:00:00.000Z');
  });

  it('a sexta de referência: de qualquer dia da semana volta à sexta mais recente', () => {
    expect(sextaDeReferencia(SEXTA('16:00'))).toBe('2026-11-27');
    expect(sextaDeReferencia(BRT('28', '10:00'))).toBe('2026-11-27');   // sábado
    expect(sextaDeReferencia(BRT('29', '10:00'))).toBe('2026-11-27');   // domingo
    expect(sextaDeReferencia(BRT('30', '10:00'))).toBe('2026-11-27');   // segunda
    expect(sextaDeReferencia(BRT('26', '23:30'))).toBe('2026-11-20');   // quinta
  });

  it('o boletim não tem travessão, tem negrito do WhatsApp e cada linha começa com emoji, maiúscula ou o separador', () => {
    expect(TEXTO_ESPERADO).not.toMatch(/[—–]/);
    for (const l of TEXTO_ESPERADO.split('\n').filter(Boolean)) {
      expect(l).toMatch(/^(\p{Extended_Pictographic}|━|[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/u);
    }
    expect(TEXTO_ESPERADO.split('\n').filter(l => l.includes('*')).every(l => (l.match(/\*/g) ?? []).length % 2 === 0)).toBe(true);
    expect(TEXTO_ESPERADO).not.toContain('\n\n\n');
  });

  it('a ordem é Diego, Thiago, Nilce e Giovanna, mesmo com os cards chegando em outra ordem', () => {
    expect([...PESSOAS_RELATORIO]).toEqual(['Diego', 'Thiago', 'Nilce', 'Giovanna']);
    const cards: CardRelatorio[] = [
      { vendedor_nome: 'Giovanna', status: 'agendado', created_by: 'lp_solar', observacao: '' },
      { vendedor_nome: 'Nilce', status: 'agendado', created_by: 'lp_solar', observacao: '' },
    ];
    const t = montarTextoRelatorio({ rotuloDe: '20/11', rotuloAte: '26/11' }, contarPorVendedor(cards));
    expect(t.indexOf('*DIEGO*')).toBeLessThan(t.indexOf('*THIAGO*'));
    expect(t.indexOf('*THIAGO*')).toBeLessThan(t.indexOf('*NILCE*'));
    expect(t.indexOf('*NILCE*')).toBeLessThan(t.indexOf('*GIOVANNA*'));
  });

  describe('o destaque', () => {
    it('quem tem mais contratos', () => {
      const t = montarTextoRelatorio(PER, cont({ Diego: { contratos: 1, orcamentos: 9 }, Nilce: { contratos: 3, orcamentos: 1 } }));
      expect(t).toContain('🏆 *Destaque: Nilce*, 3 contratos fechados\n\n━━');
    });
    it('no empate de contratos, quem tem mais orçamentos', () => {
      const t = montarTextoRelatorio(PER, cont({ Diego: { contratos: 1, orcamentos: 2 }, Giovanna: { contratos: 1, orcamentos: 5 } }));
      expect(t).toContain('🏆 *Destaque: Giovanna*, 1 contrato fechado');
    });
    it('se ainda empatar, entra o primeiro da ordem', () => {
      const t = montarTextoRelatorio(PER, cont({ Nilce: { contratos: 2, orcamentos: 4 }, Thiago: { contratos: 2, orcamentos: 4 }, Giovanna: { contratos: 2, orcamentos: 4 } }));
      expect(t).toContain('🏆 *Destaque: Thiago*, 2 contratos fechados');
    });
    it('sem contrato, mas com orçamento: destaca os orçamentos (singular e plural)', () => {
      expect(montarTextoRelatorio(PER, cont({ Thiago: { orcamentos: 1 } }))).toContain('🏆 *Destaque: Thiago*, 1 orçamento\n');
      expect(montarTextoRelatorio(PER, cont({ Thiago: { orcamentos: 4 }, Nilce: { orcamentos: 3 } }))).toContain('🏆 *Destaque: Thiago*, 4 orçamentos\n');
    });
    it('todo mundo com zero: a linha do destaque e a linha em branco depois dela saem', () => {
      const t = montarTextoRelatorio(PER, cont({ Diego: { leads: 5 } }));
      expect(t).not.toContain('🏆');
      expect(t.split('\n').slice(0, 4)).toEqual(['📊 *BOLETIM SOLAR DA SEMANA* ☀️', '📅 De 14/11 a 20/11', '', '━━━━━━━━━━━━━━']);
    });
  });

  it('singular e plural: 1 lead agendado, 1 orçamento, 1 contrato fechado; 0 no plural', () => {
    const um = montarTextoRelatorio(PER, cont({ Diego: { leads: 1, orcamentos: 1, contratos: 1 } }));
    expect(um).toContain('🔹 *DIEGO*\n📥 1 lead agendado\n📝 1 orçamento\n✅ 1 contrato fechado');
    expect(um).toContain('🔹 *THIAGO*\n📥 0 leads agendados\n📝 0 orçamentos\n✅ 0 contratos fechados');
  });

  it('a linha do Time soma os quatro, com singular e plural', () => {
    const t = montarTextoRelatorio(PER, cont({ Diego: { leads: 20, orcamentos: 10, contratos: 1 }, Thiago: { leads: 15, orcamentos: 5 }, Nilce: { leads: 10, orcamentos: 3, contratos: 1 } }));
    expect(t).toContain('📈 *Time:* 45 leads · 18 orçamentos · 2 contratos\nBora pra cima! 💪');
    expect(montarTextoRelatorio(PER, cont({ Giovanna: { leads: 1, orcamentos: 1, contratos: 1 } }))).toContain('📈 *Time:* 1 lead · 1 orçamento · 1 contrato\n');
    expect(montarTextoRelatorio(PER, cont({}))).toContain('📈 *Time:* 0 leads · 0 orçamentos · 0 contratos\n');
  });

  it('o nome do vendedor casa sem olhar caixa nem espaço', () => {
    const c = contarPorVendedor([{ vendedor_nome: ' nilce ', status: 'fechou', created_by: 'lp_solar', observacao: '' }]);
    expect(c.Nilce).toEqual({ leads: 1, orcamentos: 1, contratos: 1 });
  });

  it('cardContaNoRelatorio: origem solar, Duda sim; teste, cancelado, SAIU, eletroposto e indicação não', () => {
    const base = { vendedor_nome: 'Diego', status: 'agendado', created_by: 'lp_solar', observacao: '' };
    expect(cardContaNoRelatorio(base)).toBe(true);
    expect(cardContaNoRelatorio({ ...base, created_by: 'outra', observacao: MARCA_ORIGEM_DUDA })).toBe(true);
    expect(cardContaNoRelatorio({ ...base, created_by: 'outra' })).toBe(false);
    expect(cardContaNoRelatorio({ ...base, created_by: 'lp_solar_teste' })).toBe(false);
    expect(cardContaNoRelatorio({ ...base, created_by: 'x_teste', observacao: MARCA_ORIGEM_DUDA })).toBe(false);
    expect(cardContaNoRelatorio({ ...base, status: 'cancelado' })).toBe(false);
    expect(cardContaNoRelatorio({ ...base, observacao: 'LP SOLAR QUIZ · SAIU SEM MARCAR · Casa · LIGAÇÃO' })).toBe(false);
    expect(cardContaNoRelatorio({ ...base, created_by: 'lp_eletroposto' })).toBe(false);
    expect(cardContaNoRelatorio({ ...base, created_by: 'indicacao' })).toBe(false);
  });
});

describe('a janela da sexta (16:00 a 17:59 de Brasília)', () => {
  it('15:59 fica fora, 16:00 entra, 17:59 entra, 18:00 fica fora', () => {
    expect(naJanelaDaSexta(SEXTA('15:59'))).toBe(false);
    expect(naJanelaDaSexta(SEXTA('16:00'))).toBe(true);
    expect(naJanelaDaSexta(SEXTA('17:59'))).toBe(true);
    expect(naJanelaDaSexta(SEXTA('18:00'))).toBe(false);
  });

  it('quinta e sábado no mesmo horário ficam fora', () => {
    expect(naJanelaDaSexta(BRT('26', '16:30'))).toBe(false);
    expect(naJanelaDaSexta(BRT('28', '16:30'))).toBe(false);
  });

  it('o fuso é o de Brasília, não o do servidor: 19:00 UTC é 16:00 da sexta; 16:00 UTC é 13:00 e fica fora', () => {
    expect(naJanelaDaSexta(Date.parse('2026-11-27T19:00:00Z'))).toBe(true);
    expect(naJanelaDaSexta(Date.parse('2026-11-27T16:00:00Z'))).toBe(false);
  });

  it('fora da janela o tick não lê, não reserva e não envia', async () => {
    poeCards();
    for (const agora of [SEXTA('15:59'), SEXTA('18:00'), BRT('26', '16:30')]) {
      const r = await runSolarRelatorioSemanalTick({ agora });
      expect(r).toMatchObject({ motivo: 'fora_da_janela', enviados: 0 });
    }
    expect(h.envios).toHaveLength(0);
    expect(chaves()).toEqual([]);
  });
});

describe('a chave por pessoa', () => {
  it('a 2ª rodada não reenvia a mesma pessoa: Diego, depois Thiago', async () => {
    poeCards();
    const a = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    const b = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:02') });
    expect([a.pessoa, b.pessoa]).toEqual(['Diego', 'Thiago']);
    expect(h.envios.map(e => e.tel)).toEqual([TELS.diego, TELS.thiago]);
    expect(chaves()).toEqual(['solar_relatorio_semanal:2026-11-27:diego', 'solar_relatorio_semanal:2026-11-27:thiago']);
  });

  it('duas rodadas juntas (pg_cron e Actions) mandam UMA mensagem só', async () => {
    poeCards();
    const [a, b] = await Promise.all([
      runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') }),
      runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') }),
    ]);
    expect(h.envios).toHaveLength(1);
    expect([a.enviados, b.enviados].sort()).toEqual([0, 1]);
    expect(chaves()).toHaveLength(1);
  });

  it('a mensagem sai pela linha io, em 1 bolha, com o texto do resumo', async () => {
    poeCards();
    await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(h.envios).toEqual([{ tel: TELS.diego, instancia: 'io', texto: TEXTO_ESPERADO }]);
  });

  it('na sexta seguinte as chaves são outras: quem recebeu hoje recebe de novo na próxima semana', async () => {
    poeCards();
    for (const m of ['16:00', '16:02', '16:04', '16:06']) await runSolarRelatorioSemanalTick({ agora: SEXTA(m) });
    expect(h.envios).toHaveLength(4);
    const prox = await runSolarRelatorioSemanalTick({ agora: new Date('2026-12-04T16:00:00-03:00').getTime() });
    expect(prox).toMatchObject({ motivo: 'enviado', pessoa: 'Diego' });
    expect(h.envios).toHaveLength(5);
  });
});

describe('o ritmo: no máximo 1 envio por rodada', () => {
  it('quatro rodadas de 2 em 2 minutos entregam os quatro, na ordem, e a quinta não manda nada', async () => {
    poeCards();
    const vistos: string[] = [];
    for (const m of ['16:00', '16:02', '16:04', '16:06']) {
      const antes = h.envios.length;
      const r = await runSolarRelatorioSemanalTick({ agora: SEXTA(m) });
      expect(h.envios.length - antes).toBe(1);
      vistos.push(String(r.pessoa));
    }
    expect(vistos).toEqual(['Diego', 'Thiago', 'Nilce', 'Giovanna']);
    expect(h.envios.map(e => e.tel)).toEqual([TELS.diego, TELS.thiago, TELS.nilce, TELS.giovanna]);
    const quinta = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:08') });
    expect(quinta).toMatchObject({ motivo: 'todos_enviados', enviados: 0 });
    expect(h.envios).toHaveLength(4);
    expect(chaves()).toHaveLength(4);
  });

  it('uma rodada que chega menos de 90 s depois do envio anterior espera (não sai colada)', async () => {
    poeCards();
    await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    const cola = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') + 30_000 });
    expect(cola).toMatchObject({ motivo: 'espacando', enviados: 0 });
    expect(h.envios).toHaveLength(1);
    const ok = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') + 91_000 });
    expect(ok).toMatchObject({ motivo: 'enviado', pessoa: 'Thiago' });
  });

  it('o atraso do cron dentro da janela não perde ninguém: o que faltou sai até 17:59', async () => {
    poeCards();
    const r = await runSolarRelatorioSemanalTick({ agora: SEXTA('17:59') });
    expect(r).toMatchObject({ motivo: 'enviado', pessoa: 'Diego' });
  });
});

describe('o erro para a rodada', () => {
  it('5xx: a chave FICA (a mensagem pode ter chegado), nada mais sai na rodada e a próxima segue com a pessoa seguinte', async () => {
    poeCards();
    h.erro = 'Z-API 500';
    const a = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(a).toMatchObject({ motivo: 'erro_envio', enviados: 0, pessoa: 'Diego' });
    expect(h.envios).toHaveLength(1);                                                   // parou no 1º erro
    expect(chaves()).toEqual(['solar_relatorio_semanal:2026-11-27:diego']);             // mantida
    h.erro = null;
    const b = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:02') });
    expect(b).toMatchObject({ motivo: 'enviado', pessoa: 'Thiago' });                   // Diego não é reenviado
    expect(h.envios.map(e => e.tel)).toEqual([TELS.diego, TELS.thiago]);
  });

  it('timeout: também mantém a chave', async () => {
    poeCards();
    h.erro = 'timeout of 15000ms exceeded';
    await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(chaves()).toHaveLength(1);
  });

  it('cooldown no envio: a chave é apagada e a próxima rodada tenta a MESMA pessoa', async () => {
    poeCards();
    h.erro = 'Z-API io em cooldown';
    const a = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(a).toMatchObject({ motivo: 'cooldown', enviados: 0, pessoa: 'Diego' });
    expect(chaves()).toEqual([]);
    h.erro = null;
    const b = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:02') });
    expect(b).toMatchObject({ motivo: 'enviado', pessoa: 'Diego' });
  });

  it('credencial ausente: também solta a chave', async () => {
    poeCards();
    h.erro = 'credenciais Z-API ausentes';
    await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(chaves()).toEqual([]);
  });

  it('linha em cooldown antes do envio: não reserva e não chama a Z-API', async () => {
    poeCards();
    h.cooldown = true;
    const r = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(r).toMatchObject({ motivo: 'cooldown', enviados: 0 });
    expect(h.envios).toHaveLength(0);
    expect(chaves()).toEqual([]);
  });

  it('sem telefone a pessoa é pulada, sem reservar chave; as outras seguem', async () => {
    poeCards();
    h.tel.diego = null;
    const a = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(a).toMatchObject({ motivo: 'enviado', pessoa: 'Thiago' });
    expect(chaves()).toEqual(['solar_relatorio_semanal:2026-11-27:thiago']);
    expect(h.envios.map(e => e.tel)).toEqual([TELS.thiago]);
  });

  it('ninguém com telefone, ou tabela de telefones fora do ar: nada reservado nem enviado', async () => {
    poeCards();
    h.tel = {};
    expect(await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') })).toMatchObject({ motivo: 'sem_telefone', enviados: 0 });
    h.tel = { ...TELS }; h.telefonesOk = false;
    expect(await runSolarRelatorioSemanalTick({ agora: SEXTA('16:02') })).toMatchObject({ motivo: 'erro_telefones', enviados: 0 });
    expect(h.envios).toHaveLength(0);
    expect(chaves()).toEqual([]);
  });

  it('erro ao ler os cards: nada reservado nem enviado', async () => {
    poeCards();
    banco.falhas['agendamentos.select'] = { erro: { code: 'XX000', message: 'boom' } };
    const r = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(r).toMatchObject({ motivo: 'erro_leitura', enviados: 0 });
    expect(h.envios).toHaveLength(0);
    expect(chaves()).toEqual([]);
  });

  it('erro ao gravar a chave: não envia (falha fechada)', async () => {
    poeCards();
    banco.falhas['system_state.insert'] = { erro: { code: 'XX000', message: 'boom' } };
    const r = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(r).toMatchObject({ motivo: 'erro_reserva', enviados: 0 });
    expect(h.envios).toHaveLength(0);
  });
});

describe('kill-switch, prévia e sonda', () => {
  it('SOLAR_RELATORIO_OFF=1 desliga: nada lido, reservado nem enviado', async () => {
    process.env.SOLAR_RELATORIO_OFF = '1';
    poeCards();
    expect(await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') })).toMatchObject({ motivo: 'desligado', enviados: 0 });
    expect(await runSolarRelatorioSemanalTick({ dry: true, agora: SEXTA('16:00') })).toMatchObject({ motivo: 'desligado' });
    expect(h.envios).toHaveLength(0);
    expect(chaves()).toEqual([]);
    process.env.SOLAR_RELATORIO_OFF = ' 1 ';
    expect((await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') })).motivo).toBe('desligado');
    process.env.SOLAR_RELATORIO_OFF = '0';
    expect((await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') })).motivo).toBe('enviado');
  });

  it('dry devolve o texto em qualquer dia e hora, sem reservar chave e sem enviar', async () => {
    poeCards();
    for (const agora of [SEXTA('16:00'), BRT('30', '09:00'), BRT('26', '23:00')]) {
      const r = await runSolarRelatorioSemanalTick({ dry: true, agora });
      expect(r.motivo).toBe('dry');
      expect(r.texto).toMatch(/^📊 \*BOLETIM SOLAR DA SEMANA\* ☀️\n📅 De \d\d\/\d\d a \d\d\/\d\d\n/u);
    }
    expect(h.envios).toHaveLength(0);
    expect(banco.escritas).toEqual([]);
  });

  it('dry numa segunda-feira mostra a semana de sexta a quinta que acabou', async () => {
    poeCards();
    const r = await runSolarRelatorioSemanalTick({ dry: true, agora: BRT('30', '09:00') });
    expect(r.periodo).toEqual({ de: '2026-11-20', ate: '2026-11-26' });
  });

  it('a prévia e as respostas não levam telefone', async () => {
    poeCards();
    const r = await runSolarRelatorioSemanalTick({ dry: true, agora: SEXTA('16:00') });
    const s = JSON.stringify(r);
    for (const t of Object.values(TELS)) expect(s).not.toContain(t);
  });

  it('a resposta de um envio de verdade não devolve o texto', async () => {
    poeCards();
    const r = await runSolarRelatorioSemanalTick({ agora: SEXTA('16:00') });
    expect(r.texto).toBeUndefined();
  });

  it('sonda: grava, a 2ª gravação volta "já existe", lê, apaga e não envia nada', async () => {
    const r = await sondarTravaDoRelatorio(SEXTA('16:00'));
    expect(r).toMatchObject({ ok: true, enviou: false, gravou: 'reservada', segunda: 'ja_existe', leu: true, apagou: true });
    expect(chaves()).toEqual([]);
    expect(h.envios).toHaveLength(0);
    const gravadas = banco.escritas.filter(e => e.tabela === 'system_state' && e.op === 'insert');
    expect(gravadas.map(g => g.payload.key)).toEqual([
      `solar_relatorio_semanal:sonda:${SEXTA('16:00')}:x`, `solar_relatorio_semanal:sonda:${SEXTA('16:00')}:x`,
    ]);
  });
});
