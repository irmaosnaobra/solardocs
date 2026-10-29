import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A nota diária de cada conversa (qualidade.ts), com banco falso e IA falsa. Nada de rede, nada de modelo de verdade.

const h = vi.hoisted(() => ({ principal: null as any, gerador: null as any }));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));

import { iaFalsa, novoBanco, respostaIA, type BancoFalso } from './_agentes5040Fake';
import {
  SISTEMA_AVALIADOR, lerNotaIA, montarTranscricao, resumirNotas, rotularConversa, runQualidadeTick,
  type NotaGravadaQualidade,
} from '../services/agentes5040/qualidade';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { zerarCacheRespostasDono, chaveDaPergunta } from '../services/agentes5040/perguntas';
import { CHAVE_DISJUNTOR, tetoDe } from '../services/agentes5040/cota';
import { hmacDe } from '../services/agentes5040/hmac';
import { janelaDoDiaBRT, ontemBRT } from '../services/agentes5040/relogio';
import { chaveContato } from '../services/agents/whatsapp/silenciar';
import { msg } from './_agentes5040Util';

const AGORA = new Date('2026-10-21T10:00:00.000Z');          // 07:00 em Brasília
const DIA = '2026-10-20';
const inicioAvaliacao = '2026-10-20T14:00:00.000Z';

let banco: BancoFalso;

const telDe = (i: number): string => `55349911100${String(i).padStart(2, '0')}`;
const chaveDe = (i: number): string => chaveContato(telDe(i))!;
const hmacDaConversa = (i: number): string => hmacDe(chaveDe(i))!;

const linha = (id: number, i: number, extra: Record<string, unknown>) => ({
  id, instancia: 'inst-io', telefone: telDe(i), is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Oi', momment: inicioAvaliacao,
  chat_name: null, sender_name: null, media_url: null, ...extra,
});

/**
 * A conversa i: o lead fala (id base), a agente responde (id base+1, com o carimbo enviado) e um lembrete de agenda
 * (id base+2, outro robô, sem carimbo) chega depois. Posse da Duda por padrão.
 */
function conversa(i: number, op: { posse?: string | null; carimbo?: boolean; bolhaDaAgente?: boolean; textoLead?: string; hora?: string } = {}): void {
  const base = i * 100;
  const hora = op.hora ?? '14:00';
  const wa = (banco.tabelas.wa_mensagens ??= []);
  wa.push(linha(base, i, { texto: op.textoLead ?? 'Quanto custa a instalação de 5 kWp?', momment: `2026-10-20T${hora}:00.000Z` }));
  if (op.bolhaDaAgente !== false) {
    wa.push(linha(base + 1, i, { from_me: true, from_api: true, texto: 'Anotei. Quanto vem a sua conta de luz?', momment: `2026-10-20T${hora}:20.000Z` }));
  }
  wa.push(linha(base + 2, i, { from_me: true, from_api: true, texto: 'Lembrete: sua reunião é amanhã às 9h.', momment: '2026-10-20T20:00:00.000Z' }));
  if (op.carimbo !== false) {
    (banco.tabelas.system_state ??= []).push({ key: `ag5040_sent:${base}:1`, value: { estado: 'enviado' }, updated_at: `2026-10-20T${hora}:15.000Z` });
  }
  if (op.posse !== null) {
    (banco.tabelas.whatsapp_sessions ??= []).push({ phone: chaveDe(i), tipo: 'ag5040', lead_data: { dona: op.posse ?? 'duda', estado: 'viva', desde: inicioAvaliacao, ate_wa_id: base, respostas: 1 } });
  }
}

const notaIA = (extra: Record<string, unknown> = {}) => JSON.stringify({
  resumo: 'O cliente pediu preço de 5 kWp e a agente pediu a conta de luz.', desfecho: 'em_andamento', qualidade: 'boa', problemas: [],
  valor: 'medio', intencao: 'Saber o preço', sentimento: 'neutro', parou_depois_de: 'Quanto vem a sua conta de luz?', perguntas_em_aberto: [], ...extra,
});
const iaOk = (extra: Record<string, unknown> = {}) => iaFalsa(() => respostaIA(notaIA(extra)));

const notasGravadas = (): string[] => [...banco.objetos.keys()].filter(k => k.startsWith(`qualidade/${DIA}/`) && !k.endsWith('_resumo.json')).sort();
const lerNota = (i: number): NotaGravadaQualidade => JSON.parse(banco.objetos.get(`qualidade/${DIA}/${hmacDaConversa(i)}.json`)!);

beforeEach(() => {
  banco = novoBanco(); h.principal = banco; h.gerador = novoBanco();
  banco.bucket = { existe: true, publico: false, criado: false };
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  for (const k of ['AGENTES5040_QUALIDADE', 'AGENTES5040_TETO_QUALIDADE', 'AGENTES5040_MODELO_QUALIDADE']) delete process.env[k];
  zerarCacheArmazem(); zerarCacheInterruptores(); zerarCacheRespostasDono();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('relogio: o dia de ontem em Brasília', () => {
  it('ontem e a janela do dia, sem conta de UTC à mão', () => {
    expect(ontemBRT(AGORA)).toBe(DIA);
    // 01:00 UTC de 21/10 ainda é noite de 20/10 em Brasília: ontem é 19/10
    expect(ontemBRT(new Date('2026-10-21T01:00:00.000Z'))).toBe('2026-10-19');
    expect(janelaDoDiaBRT(DIA)).toEqual({ desde: '2026-10-20T03:00:00.000Z', ate: '2026-10-21T02:59:59.999Z' });
    expect(janelaDoDiaBRT('2026-02-30')).toBeNull();
    expect(janelaDoDiaBRT('ontem')).toBeNull();
  });
});

describe('quem é a agente na conversa (rotularConversa)', () => {
  const m = (id: number, autor: 'lead' | 'robo' | 'equipe', momment: string, texto = 'x') => msg(autor, texto, { id, momment });

  it('só vira Agente a bolha amarrada a um carimbo enviado; o resto de from_api é Outro robô', () => {
    const msgs = [m(1, 'lead', '2026-10-20T14:00:00Z'), m(2, 'robo', '2026-10-20T14:00:20Z', 'Fala da agente'), m(3, 'robo', '2026-10-20T20:00:00Z', 'Lembrete'), m(4, 'equipe', '2026-10-20T21:00:00Z')];
    const r = rotularConversa(msgs, [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 1 }]);
    expect([r.get(1), r.get(2), r.get(3), r.get(4)]).toEqual(['lead', 'agente', 'outro_robo', 'equipe']);
  });

  it('com o texto do turno conhecido, o lembrete que chega a +2 s não vira Agente e a bolha real a +40 s sim', () => {
    const msgs = [
      m(1, 'lead', '2026-10-20T14:00:00Z'),
      m(2, 'robo', '2026-10-20T14:00:17Z', 'Lembrete: sua reunião é amanhã.'),   // carimbo às 14:00:15 + 2 s
      m(3, 'robo', '2026-10-20T14:00:55Z', 'Qual é a sua cidade?'),                // + 40 s
    ];
    const r = rotularConversa(msgs, [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 1, n: 1 }], new Map([[1, ['Qual é a sua cidade?']]]));
    expect(r.get(3)).toBe('agente');
    expect(r.get(2)).toBe('outro_robo');
  });

  it('com o texto conhecido e nenhuma bolha casando, ninguém é Agente', () => {
    const msgs = [m(1, 'lead', '2026-10-20T14:00:00Z'), m(2, 'robo', '2026-10-20T14:00:17Z', 'Lembrete: sua reunião é amanhã.')];
    const r = rotularConversa(msgs, [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 1, n: 1 }], new Map([[1, ['Qual é a sua cidade?']]]));
    expect(r.get(2)).toBe('outro_robo');
  });

  it('sem o texto do turno, vale a bolha mais perto da hora do carimbo (e não a primeira da janela)', () => {
    const msgs = [
      m(1, 'lead', '2026-10-20T14:00:00Z'),
      m(2, 'robo', '2026-10-20T14:00:05Z', 'Mais longe'),
      m(3, 'robo', '2026-10-20T14:00:16Z', 'Mais perto'),
    ];
    const r = rotularConversa(msgs, [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 1, n: 1 }]);
    expect(r.get(3)).toBe('agente');
    expect(r.get(2)).toBe('outro_robo');
  });

  it('a peça (carimbo :2) vai pela hora, mesmo com o texto da bolha conhecido', () => {
    const msgs = [
      m(1, 'lead', '2026-10-20T14:00:00Z'),
      m(2, 'robo', '2026-10-20T14:00:16Z', 'Qual é a sua cidade?'),
      m(3, 'robo', '2026-10-20T14:00:22Z', 'https://exemplo.com/proposta'),
    ];
    const r = rotularConversa(msgs, [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 1, n: 1 }, { em: '2026-10-20T14:00:21Z', waIdAlvo: 1, n: 2 }], new Map([[1, ['Qual é a sua cidade?']]]));
    expect([r.get(2), r.get(3)]).toEqual(['agente', 'agente']);
  });

  it('o texto do turno gravado desempata, e cada bolha vale para um carimbo só', () => {
    const msgs = [
      m(1, 'lead', '2026-10-20T14:00:00Z'),
      m(2, 'robo', '2026-10-20T14:00:12Z', 'Lembrete de outro robô'),
      m(3, 'robo', '2026-10-20T14:00:18Z', 'Qual é a sua cidade?'),
    ];
    const r = rotularConversa(msgs, [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 1 }], new Map([[1, ['Qual é a sua cidade?']]]));
    expect(r.get(3)).toBe('agente');
    expect(r.get(2)).toBe('outro_robo');
    // dois carimbos, uma bolha só: o segundo não leva a mesma
    const r2 = rotularConversa([m(1, 'lead', '2026-10-20T14:00:00Z'), m(2, 'robo', '2026-10-20T14:00:20Z')], [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 1 }, { em: '2026-10-20T14:00:16Z', waIdAlvo: null }]);
    expect([...r2.values()].filter(x => x === 'agente')).toHaveLength(1);
  });

  it('bolha fora da janela do carimbo não é da agente', () => {
    const msgs = [m(1, 'lead', '2026-10-20T14:00:00Z'), m(2, 'robo', '2026-10-20T16:00:00Z')];
    expect(rotularConversa(msgs, [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 1 }]).get(2)).toBe('outro_robo');
  });

  it('a transcrição leva os quatro autores e o asterisco nas linhas do dia avaliado', () => {
    const msgs = [
      m(1, 'lead', '2026-10-19T14:00:00Z', 'Oi de ontem'), m(2, 'lead', '2026-10-20T14:00:00Z', 'Quanto custa?'),
      m(3, 'robo', '2026-10-20T14:00:20Z', 'Depende da conta.'), m(4, 'robo', '2026-10-20T20:00:00Z', 'Lembrete.'), m(5, 'equipe', '2026-10-20T21:00:00Z', 'Oi, sou da equipe.'),
    ];
    const r = rotularConversa(msgs, [{ em: '2026-10-20T14:00:15Z', waIdAlvo: 2 }]);
    const t = montarTranscricao(msgs, r, DIA, 'duda').split('\n');
    expect(t[0]).toMatch(/^ {2}\[19\/10 11:00\] Lead: Oi de ontem$/);
    expect(t[1]).toMatch(/^\* \[20\/10 11:00\] Lead: Quanto custa\?$/);
    expect(t[2]).toMatch(/^\* \[20\/10 11:00\] Agente \(Duda\): Depende da conta\.$/);
    expect(t[3]).toMatch(/Outro robô \(não é a agente\): Lembrete\./);
    expect(t[4]).toMatch(/Equipe \(humano\): Oi, sou da equipe\./);
  });
});

describe('a nota da IA', () => {
  it('lê, corta nos tamanhos do contrato e recusa fora do enum', () => {
    const n = lerNotaIA(notaIA({
      resumo: 'r'.repeat(500), problemas: [{ tipo: 'alucinacao', trecho: 't'.repeat(400), explicacao: 'e'.repeat(400) }, { tipo: 'inventado', trecho: 'x', explicacao: 'y' }],
      perguntas_em_aberto: [{ pergunta_curta: 'p'.repeat(300), trecho: 'a'.repeat(300), como_respondeu: 'b'.repeat(300) }, { pergunta_curta: '  ', trecho: 'x', como_respondeu: 'y' }],
    }))!;
    expect(n.resumo).toHaveLength(300);
    expect(n.problemas[0]!.trecho).toHaveLength(200);
    expect(n.problemas[0]!.explicacao).toHaveLength(200);
    expect(n.problemas[1]!.tipo).toBe('outro');
    expect(n.perguntas_em_aberto).toHaveLength(1);
    expect(n.perguntas_em_aberto[0]!.pergunta_curta).toHaveLength(120);
    expect(n.perguntas_em_aberto[0]!.como_respondeu).toHaveLength(160);
    expect(lerNotaIA(notaIA({ desfecho: 'nada' }))).toBeNull();
    expect(lerNotaIA('isto não é json')).toBeNull();
  });

  it('o prompt diz o que a agente pode, os tipos de problema e que só se julga o dia marcado', () => {
    for (const t of ['passagem_incompleta', 'fora_do_assunto', 'repetiu_pergunta', 'loop_nao_entendeu', 'alucinacao', 'quebrou_regra', 'ficou_calada', 'ignorou_pergunta', 'tom_errado', 'outro']) {
      expect(SISTEMA_AVALIADOR).toContain(t);
    }
    expect(SISTEMA_AVALIADOR).toContain('R$ 67 por mês');
    expect(SISTEMA_AVALIADOR).toMatch(/trecho LITERAL/);
    expect(SISTEMA_AVALIADOR).toMatch(/APENAS os turnos da Agente nas linhas com asterisco/);
    expect(SISTEMA_AVALIADOR).not.toMatch(/[—–]/);
  });
});

describe('o relógio da qualidade', () => {
  it('entra só conversa com turno da agente no dia e posse; a IA vê a conversa marcada', async () => {
    conversa(1);                                         // entra
    conversa(2, { posse: null });                        // sem posse
    conversa(3, { carimbo: false });                     // só lembrete: nenhum carimbo, não é candidata
    conversa(4, { bolhaDaAgente: false });               // carimbo sem bolha: sem turno da agente no dia
    const ia = iaOk();
    const r = await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any });
    expect(r.ok).toBe(true);
    expect(r.dia).toBe(DIA);
    expect(r.candidatas).toBe(2);                        // 1 e 4 têm posse e carimbo; a 2 cai em sem_posse
    expect(r.puladas.sem_posse).toBe(1);
    expect(r.puladas.sem_turno_da_agente_no_dia).toBe(1);
    expect(r.avaliadas).toBe(1);
    expect(ia.chamadas).toHaveLength(1);
    expect(notasGravadas()).toEqual([`qualidade/${DIA}/${hmacDaConversa(1)}.json`]);

    const body = ia.chamadas[0]!.body;
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.max_tokens).toBe(2000);
    expect(body.output_config.format.type).toBe('json_schema');
    const pedido = body.messages[0].content[0].text as string;
    expect(pedido).toContain('* ');
    expect(pedido).toContain('Agente (Duda): Anotei. Quanto vem a sua conta de luz?');
    expect(pedido).toContain('Outro robô (não é a agente): Lembrete: sua reunião é amanhã às 9h.');
    expect(pedido).toContain('Lead: Quanto custa a instalação de 5 kWp?');
    // nada de telefone na chamada nem no arquivo gravado
    expect(JSON.stringify(body)).not.toContain(telDe(1));
    expect(banco.objetos.get(`qualidade/${DIA}/${hmacDaConversa(1)}.json`)).not.toContain(telDe(1));

    const nota = lerNota(1);
    expect(nota).toMatchObject({ dia: DIA, hmac: hmacDaConversa(1), agente: 'duda', produto: 'solar', modelo: 'claude-sonnet-5-5', turnos_da_agente_no_dia: 1, qualidade: 'boa', desfecho: 'em_andamento' });
    expect(typeof nota.gerado_em).toBe('string');
  });

  it('o modelo pode ser trocado por env', async () => {
    process.env.AGENTES5040_MODELO_QUALIDADE = 'modelo-de-teste';
    conversa(1);
    const ia = iaOk();
    await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any });
    expect(ia.chamadas[0]!.body.model).toBe('modelo-de-teste');
    expect(lerNota(1).modelo).toBe('modelo-de-teste');
  });

  it('?dia= reprocessa um dia específico', async () => {
    conversa(1);
    const ia = iaOk();
    const r = await runQualidadeTick({ agora: new Date('2026-10-30T10:00:00Z'), dia: DIA, cliente: ia.cliente as any });
    expect(r.dia).toBe(DIA);
    expect(r.avaliadas).toBe(1);
  });

  it('pula a conversa que já tem nota (idempotente) e o resumo continua certo', async () => {
    conversa(1); conversa(2);
    const a = iaOk();
    const r1 = await runQualidadeTick({ agora: AGORA, cliente: a.cliente as any });
    expect(r1.avaliadas).toBe(2);
    const b = iaOk();
    const r2 = await runQualidadeTick({ agora: AGORA, cliente: b.cliente as any });
    expect(b.chamadas).toHaveLength(0);
    expect(r2.avaliadas).toBe(0);
    expect(r2.jaTinhamNota).toBe(2);
    expect(r2.resumo?.total).toBe(2);
    // a nota existente não foi tocada
    conversa(3);
    const c = iaOk({ qualidade: 'critica' });
    const r3 = await runQualidadeTick({ agora: AGORA, cliente: c.cliente as any });
    expect(c.chamadas).toHaveLength(1);
    expect(r3.resumo?.total).toBe(3);
    expect(r3.resumo?.por_qualidade).toEqual({ boa: 2, critica: 1 });
    expect(lerNota(1).qualidade).toBe('boa');
  });

  it('o teto de chamadas por dia vale: a rodada para e a próxima pega o resto', async () => {
    process.env.AGENTES5040_TETO_QUALIDADE = '2';
    expect(tetoDe('qualidade')).toBe(2);
    conversa(1); conversa(2); conversa(3);
    const a = iaOk();
    const r1 = await runQualidadeTick({ agora: AGORA, cliente: a.cliente as any, concorrencia: 1 });
    expect(r1.avaliadas).toBe(2);
    expect(r1.parou).toBe('teto');
    expect(a.chamadas).toHaveLength(2);
    expect(notasGravadas()).toHaveLength(2);
    // sem env o padrão é 30
    delete process.env.AGENTES5040_TETO_QUALIDADE;
    expect(tetoDe('qualidade')).toBe(30);
  });

  it('o disjuntor aberto para a rodada sem chamar a IA', async () => {
    conversa(1);
    banco.tabelas.system_state ??= [];
    banco.tabelas.system_state.push({ key: CHAVE_DISJUNTOR, value: { causa: 'ia_sem_credito', ate: '2026-10-21T11:00:00.000Z' }, updated_at: AGORA.toISOString() });
    const ia = iaOk();
    const r = await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any });
    expect(r.parou).toBe('disjuntor');
    expect(ia.chamadas).toHaveLength(0);
  });

  it('o orçamento de tempo para a rodada e deixa o resto para a segunda', async () => {
    conversa(1); conversa(2); conversa(3);
    const ia = iaFalsa(() => { vi.setSystemTime(new Date(Date.now() + 150_000)); return respostaIA(notaIA()); });
    const r = await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any, concorrencia: 1, orcamentoMs: 200_000 });
    expect(r.parou).toBe('prazo');
    expect(r.avaliadas).toBe(2);
    expect(notasGravadas()).toHaveLength(2);
  });

  it('?limite= limita as conversas da rodada', async () => {
    conversa(1); conversa(2); conversa(3);
    const ia = iaOk();
    const r = await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any, limite: 1 });
    expect(r.avaliadas).toBe(1);
    expect(r.parou).toBe('limite');
    expect(ia.chamadas).toHaveLength(1);
  });

  it('dry só lista as candidatas e quantas já têm nota: não chama a IA e não grava', async () => {
    conversa(1); conversa(2);
    banco.objetos.set(`qualidade/${DIA}/${hmacDaConversa(1)}.json`, JSON.stringify({ ja: true }));
    const escritasAntes = banco.escritas.length;
    const ia = iaOk();
    const r = await runQualidadeTick({ agora: AGORA, dry: true, cliente: ia.cliente as any });
    expect(r.dry).toBe(true);
    expect(r.candidatas).toBe(2);
    expect(r.jaTinhamNota).toBe(1);
    expect(r.avaliadas).toBe(0);
    expect(ia.chamadas).toHaveLength(0);
    expect(banco.escritas.length).toBe(escritasAntes);
    expect([...banco.objetos.keys()].filter(k => k.includes('_resumo'))).toEqual([]);
    expect(notasGravadas()).toHaveLength(1);
  });

  it('desligado responde ok sem ler nada; ligado por padrão quando nada foi configurado', async () => {
    conversa(1);
    process.env.AGENTES5040_QUALIDADE = '0';
    const ia = iaOk();
    const r = await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any });
    expect(r).toMatchObject({ ok: true, ligado: false, avaliadas: 0 });
    expect(banco.leituras).toEqual([]);
    expect(ia.chamadas).toHaveLength(0);
    delete process.env.AGENTES5040_QUALIDADE;
    zerarCacheInterruptores();
    const r2 = await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any });
    expect(r2.ligado).toBe(true);
    expect(r2.avaliadas).toBe(1);
  });

  it('o resumo conta por desfecho, qualidade, problema e agente, e é regravado a cada rodada', async () => {
    conversa(1); conversa(2, { posse: 'carla' });
    const respostas = [
      notaIA({ desfecho: 'marcou_reuniao', qualidade: 'boa' }),
      notaIA({ desfecho: 'sumiu', qualidade: 'critica', problemas: [{ tipo: 'alucinacao', trecho: 'sai por R$ 10', explicacao: 'inventou' }, { tipo: 'ficou_calada', trecho: 'x', explicacao: 'y' }] }),
    ];
    const ia = iaFalsa((_b, n) => respostaIA(respostas[n - 1]!));
    const r = await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any, concorrencia: 1 });
    const resumo = JSON.parse(banco.objetos.get(`qualidade/${DIA}/_resumo.json`)!);
    expect(resumo.total).toBe(2);
    expect(r.resumo?.total).toBe(2);
    expect(resumo.por_desfecho).toEqual({ marcou_reuniao: 1, sumiu: 1 });
    expect(resumo.por_qualidade).toEqual({ boa: 1, critica: 1 });
    expect(resumo.por_problema).toEqual({ alucinacao: 1, ficou_calada: 1 });
    expect(Object.keys(resumo.por_agente).sort()).toEqual(['carla', 'duda']);
    expect(resumo.por_agente.carla.total).toBe(1);
    // o _resumo não conta como nota na rodada seguinte
    const r2 = await runQualidadeTick({ agora: AGORA, cliente: iaOk().cliente as any });
    expect(r2.resumo?.total).toBe(2);
  });

  it('resumirNotas é puro e conta por agente', () => {
    const r = resumirNotas(DIA, [
      { agente: 'duda', desfecho: 'pagou', qualidade: 'boa', problemas: [] },
      { agente: 'duda', desfecho: 'sumiu', qualidade: 'com_problema', problemas: [{ tipo: 'tom_errado', trecho: '', explicacao: '' }] },
    ], AGORA);
    expect(r.por_agente.duda).toMatchObject({ total: 2, por_problema: { tom_errado: 1 } });
  });

  it('a pergunta em aberto da nota vira registro próprio por produto e soma vezes na repetição', async () => {
    conversa(1); conversa(2);
    const p = { pergunta_curta: 'Tem garantia da instalação?', trecho: 'Tem garantia?', como_respondeu: 'Disse que depende' };
    const ia = iaOk({ perguntas_em_aberto: [p, { ...p, pergunta_curta: 'tem garantia da instalacao' }] });   // duplicada na mesma nota conta uma vez
    const r = await runQualidadeTick({ agora: AGORA, cliente: ia.cliente as any, concorrencia: 1 });
    expect(r.perguntas).toMatchObject({ criadas: 1, somadas: 1 });
    const chave = chaveDaPergunta('solar', p.pergunta_curta);
    const linha = banco.tabelas.system_state!.find(l => l.key === chave)!;
    expect(linha.value).toMatchObject({ produto: 'solar', status: 'aberta', vezes: 2 });
    expect(linha.value.exemplos).toHaveLength(2);
    expect(linha.value.exemplos[0]).toEqual({ dia: DIA, hmac: hmacDaConversa(1), como_respondeu: 'Disse que depende' });
    // a fala do lead fica só na nota do bucket, não no system_state
    expect(JSON.stringify(banco.tabelas.system_state)).not.toContain('Tem garantia?');
    expect(banco.objetos.get(`qualidade/${DIA}/${hmacDaConversa(1)}.json`)).toContain('Tem garantia?');
  });
});
