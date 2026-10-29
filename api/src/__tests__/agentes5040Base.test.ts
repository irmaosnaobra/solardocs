import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A chave do aviso de IA (avisoIA.ts) vale false em produção; estes testes exercitam o modo LIGADO e desligam a chave onde provam o desligado.
const aviso = vi.hoisted(() => ({ on: true }));
vi.mock('../services/agentes5040/avisoIA', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/avisoIA')>()),
  get AVISO_IA_NA_PRIMEIRA_MSG() { return aviso.on; },
}));

// A Base das agentes da 5040 (B4b): a retomada fria (baseEnvio.ts + baseRegras.ts). Em cima, as regras puras; no meio, a rodada
// inteira com dependências falsas que anotam a ORDEM das chamadas (cada passo do parecer do chefe, cada motivo de pular, as 2
// retomadas, o estacionado, a IA que decide não retomar, o lead que escreve no meio, o claim apagado na falha, o dry); e, no fim, a
// rodada com as dependências de verdade sobre um banco falso e o zapiClient trocado por um mock.
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const z = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  frio: vi.fn(),
  teto: true,
  espaco: true,
  pode: { pode: true } as any,
  motivos: [] as string[],
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => z.principal?.cliente?.[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => z.gerador?.cliente?.[k as string] }) }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); } }));
vi.mock('../services/agents/zapiClient', () => ({
  sendFrio: (...a: unknown[]) => z.frio(...a),
  sendHuman: vi.fn(), sendImage: vi.fn(), linhaEmCooldown: () => false, solardocViaIo: () => false,
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/lineThrottle')>()),
  dentroDoTetoHorarioLinha: async () => z.teto,
  respeitaEspacamentoLinha: async () => z.espaco,
  dentroDaJanelaDiurna: () => true,
}));
vi.mock('../services/agents/whatsapp/pausaHumana', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/pausaHumana')>()),
  podeFalarComLead: async () => z.pode,
}));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  motivosDaSupressao: async () => z.motivos,
}));

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import {
  LIMITES_BASE, PREFIXO_RETOMADA, chaveRetomada, chaveVezBase, decidirBolhaDaRetomada, dentroDaJanelaBase, faixaDaVez, juntarBase,
  leadDisseData, lerBaseDaPosse, patchDepoisDaRetomada, patchDoEstacionar, pareceOptOut, planejarEstacionar, resumirConversa,
  triagemDaConversa, triagemDaPosse, triagemDoContexto, type BaseDaPosse, type FatosDoContexto,
} from '../services/agentes5040/baseRegras';
import { runBaseTick, depsReais, type AlvoBase, type DepsBase, type PosseBase, type ResultadoIA } from '../services/agentes5040/baseEnvio';
import { PREFIXOS_AGENDA, prefixosDaLinha } from '../services/agents/whatsapp/lineThrottle';
import { CLASSE_POR_ROBO } from '../services/chefe/classes';
import { ACOES_DA_RETOMADA, avisoDaRetomada, pensarTurno } from '../services/agentes5040/turno';
import { validarFala, type ParametrosTrava } from '../services/agentes5040/trava';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';
import { CHAVE_VIVO_ALVO, zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { personaDef } from '../services/agentes5040/personas';
import type { ContextoLead, MsgConversa, SaidaAgente } from '../services/agentes5040/tipos';

const ult = <T,>(a: readonly T[]): T => a[a.length - 1]!;
const HORA = 3_600_000;
const MIN = 60_000;
// Quarta 21/10/2026, 14h em Brasília (17h UTC): dentro da janela de 9h às 20h.
const AGORA = new Date('2026-10-21T17:00:00.000Z');
const iso = (msAntes: number, base: Date = AGORA): string => new Date(base.getTime() - msAntes).toISOString();

process.env.AGENTES5040_HMAC = 'segredo-de-teste-da-base';
const CHAVE = '3491101000';                                  // chaveContato(TEL): DDD + 8 últimos
const TEL = '5534991101000';
const HMAC = hmacDe(CHAVE)!;

// ── 1. as regras puras ───────────────────────────────────────────────────────

describe('a janela da Base: 9h às 20h, segunda a sábado, fixa', () => {
  const brt = (dia: string, hora: string): Date => new Date(`${dia}T${hora}:00-03:00`);
  it('segunda a sábado vale de 9h00 até 19h59', () => {
    expect(dentroDaJanelaBase(brt('2026-10-19', '09:00'))).toBe(true);     // segunda
    expect(dentroDaJanelaBase(brt('2026-10-24', '19:59'))).toBe(true);     // sábado
    expect(dentroDaJanelaBase(brt('2026-10-21', '08:59'))).toBe(false);
    expect(dentroDaJanelaBase(brt('2026-10-21', '20:00'))).toBe(false);
    expect(dentroDaJanelaBase(brt('2026-10-21', '03:00'))).toBe(false);
  });
  it('domingo nunca (nem com JANELA_DOMINGO_ON ou JANELA_DIURNA_OFF: a Base não lê essas chaves)', () => {
    process.env.JANELA_DOMINGO_ON = '1'; process.env.JANELA_DIURNA_OFF = '1';
    try { expect(dentroDaJanelaBase(brt('2026-10-25', '12:00'))).toBe(false); }
    finally { delete process.env.JANELA_DOMINGO_ON; delete process.env.JANELA_DIURNA_OFF; }
  });
  it('instante inválido = fora', () => { expect(dentroDaJanelaBase('lixo')).toBe(false); });
  it('feriado nacional não tem frio (segunda a sábado também): o dia seguinte útil vale', () => {
    expect(dentroDaJanelaBase(brt('2026-11-20', '12:00'))).toBe(false);    // sexta, Consciência Negra
    expect(dentroDaJanelaBase(brt('2026-12-25', '12:00'))).toBe(false);    // sexta, Natal
    expect(dentroDaJanelaBase(brt('2026-11-21', '12:00'))).toBe(true);     // sábado
    expect(dentroDaJanelaBase(brt('2026-11-19', '12:00'))).toBe(true);
  });
  it('a vez da rodada é uma faixa de 10 minutos, numa chave que não casa com nenhum prefixo contado', () => {
    expect(faixaDaVez(new Date('2026-10-21T17:09:59.000Z'))).toBe('2026-10-21T17:00');
    expect(faixaDaVez(new Date('2026-10-21T17:10:00.000Z'))).toBe('2026-10-21T17:10');
    expect(chaveVezBase(AGORA)).toBe('ag5040_base_vez:2026-10-21T17:00');
    const todos = [...prefixosDaLinha(), ...PREFIXOS_AGENDA, 'ag5040_sent:', 'ficha_lead:'];
    expect(todos.some(p => chaveVezBase(AGORA).startsWith(p))).toBe(false);
    expect(chaveRetomada('abc', 2)).toBe('ag5040_retomada:abc:2');
  });
});

describe('o carimbo ag5040_retomada: e o robô base_retomada_5040', () => {
  it('conta na linha e no espaçamento (BOT_SENT_PREFIXES) e NÃO é agenda', () => {
    expect(prefixosDaLinha()).toContain(PREFIXO_RETOMADA);
    expect((PREFIXOS_AGENDA as readonly string[])).not.toContain(PREFIXO_RETOMADA);
  });
  it('é frio_p5, 1 bolha, 160 caracteres, respeita a pausa e carimba no balde frio', () => {
    const r = CLASSE_POR_ROBO.base_retomada_5040!;
    expect(r).toMatchObject({ classe: 'frio_p5', maxBolhas: 1, maxCaracteres: 160, respeitaPausa: true, linha: 'io', janela: 'frio', podeTerPrazo: false, agenda: false });
    expect(r.arquivos).toEqual(['services/agentes5040/baseEnvio.ts']);
    expect(r.carimbos).toEqual([{ prefixo: 'ag5040_retomada:', contaHoje: 'frio' }]);
    expect(r.subprioridade).toBeLessThan(CLASSE_POR_ROBO.status_5040!.subprioridade);
  });
});

describe('lead_data.base: leitura defensiva e junção sem perder campos', () => {
  it('lixo vira o valor neutro', () => {
    expect(lerBaseDaPosse({ base: 'x' })).toEqual({ retomadas: 0, ultima_retomada_em: null, estacionado_ate: null, estacionado_motivo: null, ultima: false, tentativa: null });
    expect(lerBaseDaPosse(null).retomadas).toBe(0);
    expect(lerBaseDaPosse({ base: { retomadas: '2', estacionado_ate: 'ontem' } })).toMatchObject({ retomadas: 2, estacionado_ate: null });
  });
  it('juntarBase põe o patch por cima do que já havia (atualizarPosse junta raso: sem isto retomadas some)', () => {
    expect(juntarBase({ base: { retomadas: 1, x: 1 } }, { estacionado_ate: 'a' })).toEqual({ retomadas: 1, x: 1, estacionado_ate: 'a' });
    expect(juntarBase({}, { a: 1 })).toEqual({ a: 1 });
  });
});

describe('estacionar: a data e o prazo fixo', () => {
  const dados = (v?: string): Record<string, string> => (v === undefined ? {} : { volta_em: v });
  it('data dita pelo lead e válida: 9h de Brasília daquele dia', () => {
    expect(planejarEstacionar({ dados: dados('10/11'), textos: ['me chama dia 10 de novembro'], agora: AGORA }))
      .toEqual({ ate: '2026-11-10T12:00:00.000Z', comData: true, ultima: false, motivo: 'data_dita' });
    expect(planejarEstacionar({ dados: dados('2026-12-03'), textos: ['depois do natal'], agora: AGORA }).comData).toBe(true);
    expect(planejarEstacionar({ dados: dados('22/10/2026'), textos: ['amanhã'], agora: AGORA }).ate).toBe('2026-10-22T12:00:00.000Z');
  });
  it('sem data, torta, hoje ou data escrita no passado: 30 dias e a última retomada', () => {
    // 21/10 + 30 dias = 20/11/2026, feriado (Consciência Negra): vai para sábado 21/11
    const fixo = { ate: '2026-11-21T12:00:00.000Z', comData: false, ultima: true, motivo: 'agora_nao' };
    expect(planejarEstacionar({ dados: dados(), textos: ['agora não'], agora: AGORA })).toEqual(fixo);
    expect(planejarEstacionar({ dados: dados('10/11'), textos: ['agora não'], agora: AGORA })).toEqual(fixo);          // o lead não disse data
    for (const v of ['31/02', '21/10', 'novembro', '', '20/10/2026', '2026-10-01', '1/1/2020']) {
      expect(planejarEstacionar({ dados: dados(v), textos: ['me chama dia 10'], agora: AGORA }), v).toEqual(fixo);
    }
  });
  it('DD/MM sem ano que já passou neste ano é do ANO SEGUINTE ("me chama em janeiro" dito em 21/10)', () => {
    const p = planejarEstacionar({ dados: dados('15/1'), textos: ['me chama em janeiro'], agora: AGORA });
    expect(p).toEqual({ ate: '2027-01-15T12:00:00.000Z', comData: true, ultima: false, motivo: 'data_dita' });
    // 1/1 é feriado: anda para o próximo dia útil (sábado 02/01/2027 vale: seg-sáb)
    expect(planejarEstacionar({ dados: dados('1/1'), textos: ['me chama em janeiro'], agora: AGORA }))
      .toEqual({ ate: '2027-01-02T12:00:00.000Z', comData: true, ultima: false, motivo: 'data_dita' });
    // o ano escrito vale como veio
    expect(planejarEstacionar({ dados: dados('15/01/2027'), textos: ['janeiro'], agora: AGORA }).ate).toBe('2027-01-15T12:00:00.000Z');
  });
  it('data acima de 180 dias é LIMITADA a 180 dias (nunca cai no prazo fixo de 30)', () => {
    const limite = { ate: '2027-04-19T12:00:00.000Z', comData: true, ultima: false, motivo: 'data_dita' };    // 21/10/2026 + 180 dias = segunda
    for (const v of ['2027-12-01', '10/10', '10/10/2027']) {
      expect(planejarEstacionar({ dados: dados(v), textos: ['me chama dia 10'], agora: AGORA }), v).toEqual(limite);
    }
    expect(planejarEstacionar({ dados: dados('2027-04-19'), textos: ['abril'], agora: AGORA }).ate).toBe('2027-04-19T12:00:00.000Z');
  });
  it('estacionado que cai em feriado nacional ou domingo vai para o próximo dia útil (seg a sáb, não feriado)', () => {
    // 15/11/2026 é domingo E feriado (Proclamação): segunda 16/11
    expect(planejarEstacionar({ dados: dados('15/11'), textos: ['dia 15'], agora: AGORA }).ate).toBe('2026-11-16T12:00:00.000Z');
    // 25/12/2026 sexta, Natal: sábado 26/12
    expect(planejarEstacionar({ dados: dados('25/12'), textos: ['dia 25'], agora: AGORA }).ate).toBe('2026-12-26T12:00:00.000Z');
    // 20/11/2026 é feriado (Consciência Negra, 2023+): o prazo fixo de 30 dias dado em 21/10 vai para sábado 21/11
    expect(planejarEstacionar({ dados: dados(), textos: ['agora não'], agora: AGORA }).ate).toBe('2026-11-21T12:00:00.000Z');
  });
  it('o patch leva só códigos e datas (nada do que ele escreveu)', () => {
    const p = patchDoEstacionar(planejarEstacionar({ dados: dados('10/11'), textos: ['dia 10'], agora: AGORA }), AGORA);
    expect(p).toEqual({ estacionado_ate: '2026-11-10T12:00:00.000Z', estacionado_motivo: 'data_dita', ultima: false, estacionado_em: AGORA.toISOString(), tentativa: null });
  });
  it('o que conta como data dita pelo lead', () => {
    for (const t of ['me chama dia 10', 'em novembro', 'mês que vem', 'semana que vem', 'daqui a duas semanas', 'depois do natal', 'só segunda', 'amanhã', '10/11', 'fim do mês']) {
      expect(leadDisseData([t]), t).toBe(true);
    }
    for (const t of ['agora não', 'depois eu vejo', 'mais pra frente', 'tô sem tempo']) expect(leadDisseData([t]), t).toBe(false);
  });
  it('pedido de parar: "não quero", "para", "não me chama" (e só eles) NUNCA estacionam', () => {
    for (const t of ['não quero', 'Não quero mais', 'para', 'Para de me mandar mensagem', 'não me chama mais', 'sai da lista', 'nunca mais', 'chega']) {
      expect(pareceOptOut([t]), t).toBe(true);
    }
    for (const t of ['agora não', 'agora não dá', 'me chama em novembro', 'depois a gente conversa', 'para casa nova', 'preciso de um tempo']) {
      expect(pareceOptOut([t]), t).toBe(false);
    }
  });
});

describe('a bolha da retomada', () => {
  const saida = (extra: Partial<SaidaAgente> = {}) => ({ acao: 'continuar', bolhas: ['Voltando ao assunto da sua conta de luz, ainda faz sentido pra você?'], peca: null, ...extra });
  it('1 bolha de até 160, continuar, sem peça, sem link, sem Pix, sem travessão', () => {
    expect(decidirBolhaDaRetomada(saida())).toEqual({ tipo: 'texto', bolha: 'Voltando ao assunto da sua conta de luz, ainda faz sentido pra você?' });
    expect(decidirBolhaDaRetomada(saida({ bolhas: ['a'.repeat(161)] }))).toMatchObject({ tipo: 'barrada', motivo: 'passa_de_160' });
    expect(decidirBolhaDaRetomada(saida({ bolhas: ['Oi', 'https://solardoc.app/pix'] }))).toMatchObject({ tipo: 'barrada' });
    expect(decidirBolhaDaRetomada(saida({ bolhas: ['Veja https://solardoc.app'] }))).toMatchObject({ tipo: 'barrada', motivo: 'link_ou_pix' });
    expect(decidirBolhaDaRetomada(saida({ peca: { tipo: 'link', id: 'x' } as any }))).toMatchObject({ tipo: 'barrada', motivo: 'peca' });
    expect(decidirBolhaDaRetomada(saida({ bolhas: ['Voltei — tudo bem?'] }))).toMatchObject({ tipo: 'barrada', motivo: 'travessao' });
    for (const acao of ['marcar_horario', 'ligar_agora', 'estacionar', 'nao_incomodar', 'passar_duda', 'suporte_giovanna']) {
      expect(decidirBolhaDaRetomada(saida({ acao })), acao).toMatchObject({ tipo: 'barrada' });
    }
  });
  it('calar (bolhas vazias) é a IA decidindo NÃO retomar', () => {
    expect(decidirBolhaDaRetomada({ acao: 'calar', bolhas: [], peca: null })).toEqual({ tipo: 'nao_retomar', motivo: 'ia_disse_nao' });
    expect(decidirBolhaDaRetomada(saida({ bolhas: [' '] }))).toMatchObject({ tipo: 'nao_retomar' });
  });
});

// ── 2. a trava e o turno em modo retomada (a trava de verdade, nada mocado) ──

describe('a trava deixa passar a segunda fala seguida SÓ no modo retomada', () => {
  const msg = (id: number, autor: 'lead' | 'robo', texto = 'oi'): MsgConversa => ({
    id, from_me: autor !== 'lead', from_api: autor === 'robo' ? true : null, autor, texto, tipo: 'texto', media_url: null, momment: iso(10 * HORA - id * MIN),
  });
  const conv = [msg(1, 'lead', 'Quero saber de energia solar'), msg(2, 'robo', 'Oi! Qual cidade você mora?')];
  const fala: SaidaAgente = { bolhas: ['Voltando aqui: você me diz em qual cidade fica a casa?'], acao: 'continuar', peca: null, dados: {}, resumo: 'r', sabe_contexto: true };
  const base = (extra: Partial<ParametrosTrava> = {}): ParametrosTrava => ({ persona: 'duda', completa: true, agora: AGORA, acoesSemFala: ['calar'], ...extra });

  it('sem o modo: "duas falas seguidas" barra (o comportamento de sempre); com o modo: passa', () => {
    expect(validarFala(fala, conv, base())).toContain('duas falas seguidas sem o lead escrever');
    expect(validarFala(fala, conv, base({ permiteIniciativa: 'retomada' }))).toEqual([]);
  });
  it('o modo retomada NÃO libera o resto: lead que nunca escreveu, emoji, mais de uma pergunta, link na bolha 1', () => {
    expect(validarFala(fala, [msg(2, 'robo')], base({ permiteIniciativa: 'retomada' }))).toContain('o lead ainda não escreveu');
    expect(validarFala({ ...fala, bolhas: ['Oi 😀 tudo bem? E a cidade?'] }, conv, base({ permiteIniciativa: 'retomada' })).length).toBeGreaterThan(0);
    expect(validarFala({ ...fala, bolhas: ['Qual a cidade? E a conta?'] }, conv, base({ permiteIniciativa: 'retomada' }))).toContain('mais de uma pergunta');
    expect(validarFala({ ...fala, bolhas: ['Veja solardoc.app'] }, conv, base({ permiteIniciativa: 'retomada' })).length).toBeGreaterThan(0);
  });
  it('calar é válido sem bolhas', () => {
    expect(validarFala({ ...fala, bolhas: [], acao: 'calar' }, conv, base({ permiteIniciativa: 'retomada' }))).toEqual([]);
  });
});

describe('pensarTurno no modo retomada (IA falsa, trava de verdade)', () => {
  const ctxDe = (persona: 'duda' | 'helena'): ContextoLead => ({
    chave: CHAVE, nome: 'Tadeu Souza', completa: true, card: null, cardSolar: null, leadsMeta: null, cadastros: [], ehClienteSolarDoc: false,
    anuncio: null, qualificado: false, agora: AGORA.toISOString(),
    msgs: [
      { id: 1, from_me: false, from_api: null, autor: 'lead', texto: 'Quero saber de energia solar', tipo: 'texto', media_url: null, momment: iso(10 * HORA) },
      { id: 2, from_me: true, from_api: true, autor: 'robo', texto: persona === 'duda' ? 'Oi, Tadeu! Aqui é a Duda. Qual cidade você mora?' : 'Oi! Aqui é a Helena. Qual cidade?', tipo: 'texto', media_url: null, momment: iso(9 * HORA) },
    ],
  });
  const rodarTurno = async (persona: 'duda' | 'helena', resposta: string, retomada: boolean) => {
    const ia = iaFalsa(() => respostaIA(resposta));
    const r = await pensarTurno({ persona, ctx: ctxDe(persona), novas: [], dadosAnteriores: {}, abertura: false, retomada, cliente: ia.cliente, cacheMidia: new Map() });
    return { r, ia };
  };

  it('com retomada: a fala passa pela trava de verdade e o pedido leva o aviso (só continuar e calar; a regra "nunca cobra" desfeita)', async () => {
    const { r, ia } = await rodarTurno('duda', saidaJson(['Voltando aqui: em qual cidade fica a sua casa?']), true);
    expect(r.pensamento.falou).toBe(true);
    const corpo = JSON.stringify(ia.chamadas[0]!.body);
    expect(corpo).toContain('AVISO DO SISTEMA (retomada)');
    expect(corpo).toContain('duas falas seguidas');
    // O schema da saída só aceita continuar e calar.
    const enumAcao = ia.chamadas[0]!.body.output_config.format.schema.properties.acao.enum;
    expect(enumAcao).toEqual([...ACOES_DA_RETOMADA]);
  });
  it('sem retomada: a mesma fala é barrada (duas falas seguidas), então a retomada não vaza para a resposta comum', async () => {
    const { r } = await rodarTurno('duda', saidaJson(['Voltando aqui: em qual cidade fica a sua casa?']), false);
    expect(r.pensamento.falou).toBe(false);
  });
  it('ação fora da lista (marcar_horario) é saída inválida: o modelo nem pode escolhê-la', async () => {
    const { r } = await rodarTurno('duda', saidaJson(['Marcado.'], { acao: 'marcar_horario' }), true);
    expect(r.pensamento.falou).toBe(false);
  });
  it('a IA decide calar: falou=true, ação calar, nenhuma bolha', async () => {
    const { r } = await rodarTurno('helena', saidaJson([], { acao: 'calar' }), true);
    expect(r.pensamento.falou).toBe(true);
    if (r.pensamento.falou) expect(r.pensamento.saida).toMatchObject({ acao: 'calar', bolhas: [] });
  });
  it('o aviso da Helena proíbe pedir SIM, prometer lembrete e escrever "confirmado"; o da Duda não carrega isso', () => {
    expect(avisoDaRetomada('helena')).toContain('Nunca peça SIM');
    expect(avisoDaRetomada('duda')).not.toContain('Nunca peça SIM');
    expect(avisoDaRetomada('duda')).toContain('deixou o projeto da energia solar de lado por enquanto');   // a pergunta que convida o não
    expect(avisoDaRetomada('helena')).toContain('eletroposto');
    expect(avisoDaRetomada('duda')).toContain('retome pela data que ele deu');                            // quem estacionou não leva a pergunta
    expect(personaDef('duda').acoes).toContain('estacionar');                       // e o cache da persona segue a de sempre
  });
});

// ── 3. a rodada com dependências falsas ──────────────────────────────────────

type Over = Partial<DepsBase>;

function posse(extra: Record<string, unknown> = {}, dona: 'duda' | 'helena' = 'duda', chave = CHAVE): PosseBase {
  return {
    chave, dona, updated_at: iso(5 * HORA),
    lead_data: { dona, estado: 'viva', apresentada: true, desde: iso(12 * HORA), ate_wa_id: 10, respostas: 1, imagens: [], links: [], ...extra },
  };
}
const msg = (id: number, autor: 'lead' | 'robo' | 'equipe', atras: number, texto = 'oi'): MsgConversa => ({
  id, from_me: autor !== 'lead', from_api: autor === 'robo' ? true : null, autor, texto, tipo: 'texto', media_url: null, momment: iso(atras),
});
/** Lead falou há 6 h, a agente respondeu há 5 h50: o alvo de livro. */
const CONVERSA = (): MsgConversa[] => [msg(10, 'lead', 6 * HORA, 'Quero saber de energia solar'), msg(11, 'robo', 6 * HORA - 10 * MIN, 'Oi, Tadeu! Qual cidade você mora?')];
const BOLHA = 'Voltando aqui: você chegou a ver a conta de luz que eu pedi?';

interface Mundo {
  calls: string[];
  d: DepsBase;
  posses: PosseBase[];
  gravacoes: Array<{ chave: string; patch: Record<string, unknown> }>;
  claims: string[];
  apagados: string[];
  enviados: Array<{ tel: string; bolha: string }>;
  filas: boolean[];
}

function mundo(o: {
  posses?: PosseBase[];
  conversa?: MsgConversa[]; conversas?: Record<string, MsgConversa[]>;
  over?: Over; cartoes?: any[]; fatos?: Partial<Awaited<ReturnType<DepsBase['fatos']>>>;
  carimbos?: Partial<NonNullable<Awaited<ReturnType<DepsBase['carimbos']>>>>;
  ia?: ResultadoIA; ultimoId?: number | null; claim?: 'ok' | 'ja' | 'erro'; envioFalha?: Error;
  donas?: Array<'duda' | 'helena'>; escopo?: boolean;
} = {}): Mundo {
  const w: Mundo = { calls: [], d: null as any, posses: o.posses ?? [posse()], gravacoes: [], claims: [], apagados: [], enviados: [], filas: [] };
  const c = <K extends keyof DepsBase>(nome: K, fn: DepsBase[K]): DepsBase[K] =>
    (async (...a: any[]) => { w.calls.push(nome as string); return (fn as any)(...a); }) as DepsBase[K];
  const msgsDe = (chave: string): MsgConversa[] => o.conversas?.[chave] ?? o.conversa ?? CONVERSA();
  w.d = {
    donasLigadas: c('donasLigadas', async () => o.donas ?? ['duda', 'helena']),
    segredoOk: () => true,
    janelaDaLinha: () => true,
    linhaPausada: c('linhaPausada', async () => 'nao'),
    tetoHorario: c('tetoHorario', async () => true),
    espacamento: c('espacamento', async () => true),
    ultimaRespostaViva: c('ultimaRespostaViva', async () => null),
    tomarVez: c('tomarVez', async () => 'tomada'),
    listarPosses: c('listarPosses', async () => w.posses),
    escopo: c('escopo', async () => o.escopo ?? true),
    listas: c('listas', async () => ({ silenciado: () => false, bloqueado: () => false, mudo: () => false })),
    conversa: c('conversa', async (chave: string) => ({ msgs: msgsDe(chave), completa: true })),
    cartoes: c('cartoes', async () => o.cartoes ?? []),
    fatos: c('fatos', async () => ({
      leituraOk: true, humanoNaConversa: false, naoIncomodar: false, bloqueado: false, mudo: false, outroRoboAtivo: false, ehClienteSolarDoc: false, ...(o.fatos ?? {}),
    })),
    carimbos: c('carimbos', async () => ({ respostasDaAgenteAposLead: 1, retomadas: [], outroRobo24h: false, ...(o.carimbos ?? {}) })),
    telefone: c('telefone', async () => TEL),
    pensar: c('pensar', async () => ({ ...(o.ia ?? { tipo: 'texto', bolha: BOLHA }), chamadas: 1 }) as any),
    ultimoId: c('ultimoId', async (chave: string) => (o.ultimoId !== undefined ? o.ultimoId : ult(msgsDe(chave)).id)),
    podeFalarAgora: c('podeFalarAgora', async () => true),
    claim: c('claim', async (k: string) => { w.claims.push(k); return o.claim ?? 'ok'; }),
    apagarClaim: c('apagarClaim', async (k: string) => { w.apagados.push(k); }),
    enviar: c('enviar', async (tel: string, bolha: string) => { w.enviados.push({ tel, bolha }); if (o.envioFalha) throw o.envioFalha; }),
    erroDeLinha: c('erroDeLinha', async () => {}),
    envioOk: c('envioOk', async () => {}),
    gravarBase: c('gravarBase', async (p: PosseBase, patch: Record<string, unknown>) => {
      w.gravacoes.push({ chave: p.chave, patch });
      // A posse da rodada seguinte enxerga o que foi gravado (a tentativa e as retomadas).
      const dentro = w.posses.find(x => x.chave === p.chave);
      if (dentro) dentro.lead_data = { ...dentro.lead_data, base: juntarBase(dentro.lead_data, patch) };
      return true;
    }),
    gravarFila: c('gravarFila', async (vazia: boolean) => { w.filas.push(vazia); }),
    limparVezes: c('limparVezes', async () => {}),
    ...(o.over ?? {}),
  } as DepsBase;
  return w;
}

const ESCRITAS: Array<keyof DepsBase> = ['tomarVez', 'pensar', 'claim', 'enviar', 'apagarClaim', 'gravarBase', 'gravarFila', 'limparVezes', 'envioOk', 'erroDeLinha'];
const nadaEscrito = (w: Mundo): void => { for (const k of ESCRITAS) expect(w.calls, String(k)).not.toContain(k); };
const rodar = (w: Mundo, extra: { dry?: boolean; agora?: Date } = {}) => runBaseTick({ agora: AGORA, ...extra }, w.d);

describe('a rodada: a ordem EXATA do parecer', () => {
  it('janela > linha > teto > espaçamento > 2 min > vez > alvo > IA > relê > espaçamento > 2 min > pausa > claim > envio', async () => {
    const w = mundo();
    const r = await rodar(w);
    expect(r).toMatchObject({ ok: true, enviou: true, elegiveis: 1 });
    const so = w.calls.filter(n => ['linhaPausada', 'tetoHorario', 'espacamento', 'ultimaRespostaViva', 'tomarVez', 'listarPosses', 'pensar', 'ultimoId', 'podeFalarAgora', 'claim', 'enviar', 'envioOk', 'gravarBase'].includes(n));
    expect(so).toEqual([
      'linhaPausada', 'tetoHorario', 'espacamento', 'ultimaRespostaViva', 'tomarVez', 'listarPosses',
      'pensar', 'ultimoId', 'espacamento', 'ultimaRespostaViva', 'podeFalarAgora', 'claim', 'enviar', 'envioOk', 'gravarBase',
    ]);
  });

  it('o carimbo é ag5040_retomada:<hmac>:1, o envio é a bolha da IA para o número resolvido, e só depois a posse anota a retomada', async () => {
    const w = mundo();
    await rodar(w);
    expect(w.claims).toEqual([`ag5040_retomada:${HMAC}:1`]);
    expect(w.enviados).toEqual([{ tel: TEL, bolha: BOLHA }]);
    expect(w.calls.indexOf('claim')).toBeLessThan(w.calls.indexOf('enviar'));
    expect(w.calls.indexOf('enviar')).toBeLessThan(w.calls.lastIndexOf('gravarBase'));
    const g = ult(w.gravacoes);
    expect(g.patch).toMatchObject({ retomadas: 1, ultima_retomada_em: AGORA.toISOString(), tentativa: null });
  });

  it('UM envio por rodada: com três alvos, avalia só até o primeiro e nunca chama a IA duas vezes', async () => {
    const posses = [posse({}, 'duda', '3499110001'), posse({}, 'duda', '3499110002'), posse({}, 'helena', '3499110003')];
    const w = mundo({ posses });
    const r = await rodar(w);
    expect(r.enviou).toBe(true);
    expect(w.enviados).toHaveLength(1);
    expect(w.calls.filter(n => n === 'pensar')).toHaveLength(1);
    expect(r.avaliadas).toBe(1);
  });

  it('uma rodada que lê o relógio: o claim e o envio usam o instante injetado (nada de new Date solto nos carimbos)', async () => {
    const w = mundo();
    let agoraDoClaim: Date | null = null;
    w.d.claim = async (k: string, a: Date) => { agoraDoClaim = a; w.claims.push(k); return 'ok'; };
    await rodar(w);
    expect((agoraDoClaim as unknown as Date).toISOString()).toBe(AGORA.toISOString());
  });
});

describe('os portões que encerram antes de qualquer reserva', () => {
  const brt = (dia: string, hora: string): Date => new Date(`${dia}T${hora}:00-03:00`);
  const casos: Array<[string, Over, Date | undefined, string]> = [
    ['domingo', {}, brt('2026-10-25', '12:00'), 'fora_da_janela'],
    ['8h59', {}, brt('2026-10-21', '08:59'), 'fora_da_janela'],
    ['20h00', {}, brt('2026-10-21', '20:00'), 'fora_da_janela'],
    ['a janela diurna da linha', { janelaDaLinha: () => false }, undefined, 'fora_da_janela'],
    ['linha pausada por erros seguidos', { linhaPausada: async () => 'sim' }, undefined, 'linha_pausada'],
    ['leitura da pausa falhou', { linhaPausada: async () => 'erro' }, undefined, 'leitura_da_pausa_falhou'],
    ['teto da linha (6/h, 30/24 h)', { tetoHorario: async () => false }, undefined, 'teto_da_linha'],
    ['espaçamento da linha', { espacamento: async () => false }, undefined, 'espacamento_da_linha'],
    ['resposta ao vivo há 1 min (a Base espera)', { ultimaRespostaViva: async () => AGORA.getTime() - MIN }, undefined, 'resposta_viva_recente'],
    ['leitura do último ag5040_sent falhou', { ultimaRespostaViva: async () => 'erro' }, undefined, 'leitura_da_resposta_viva_falhou'],
  ];
  for (const [nome, over, agora, motivo] of casos) {
    it(`${nome}: motivo ${motivo}, nem a vez nem a leitura das posses`, async () => {
      const w = mundo({ over });
      const r = await rodar(w, agora ? { agora } : {});
      expect(r.motivo).toBe(motivo);
      expect(r.enviou).toBe(false);
      nadaEscrito(w);
      expect(w.calls).not.toContain('listarPosses');
    });
  }

  it('resposta ao vivo há 3 min já não segura (o limite é 2 min)', async () => {
    const w = mundo({ over: { ultimaRespostaViva: async () => AGORA.getTime() - 3 * MIN } });
    expect((await rodar(w)).enviou).toBe(true);
  });

  it('a ordem dos portões: o primeiro que falha encerra e os seguintes nem são consultados', async () => {
    const w = mundo();
    w.d.tetoHorario = async () => { w.calls.push('tetoHorario'); return false; };
    await rodar(w);
    expect(w.calls).toEqual(['donasLigadas', 'linhaPausada', 'tetoHorario']);
  });

  it('a vez ocupada (outra chamada na mesma faixa de 10 min) encerra sem ler as posses', async () => {
    const w = mundo({ over: { tomarVez: async () => 'ocupada' } });
    const r = await rodar(w);
    expect(r.motivo).toBe('vez_ocupada');
    expect(w.calls).not.toContain('listarPosses');
  });

  it('nenhuma dona ligada: sai com a leitura do interruptor e mais nada', async () => {
    const w = mundo({ donas: [] });
    const r = await rodar(w);
    expect(r).toMatchObject({ ok: true, ligado: false });
    expect(w.calls).toEqual(['donasLigadas']);
  });

  it('só a Helena ligada: a posse da Duda é pulada (dona desligada) e a da Helena sai', async () => {
    const w = mundo({ donas: ['helena'], posses: [posse({}, 'duda', '3499110001'), posse({}, 'helena', '3499110002')] });
    const r = await rodar(w);
    expect(r.puladas.dona_desligada).toBe(1);
    expect(w.enviados).toHaveLength(1);
    expect(w.claims[0]).toContain(hmacDe('3499110002')!);
  });
});

describe('cada motivo de pular o alvo (nada é reservado, chamado nem enviado)', () => {
  const lead6h = msg(10, 'lead', 6 * HORA);
  const robo = (atras: number, id = 11) => msg(id, 'robo', atras);
  type Caso = [string, Parameters<typeof mundo>[0], string];
  const casos: Caso[] = [
    ['a agente ainda não se apresentou (aviso de IA, lead_data.apresentada falsa)', { posses: [posse({ apresentada: false })] }, 'nao_apresentada'],
    ['lead_data sem a marca apresentada (posse antiga)', { posses: [{ ...posse(), lead_data: (({ apresentada: _a, ...resto }) => resto)(posse().lead_data) }] }, 'nao_apresentada'],
    ['duas retomadas já feitas (lead_data)', { posses: [posse({ base: { retomadas: 2 } })] }, 'duas_retomadas_feitas'],
    ['duas retomadas já carimbadas (o carimbo manda sobre a posse)', { carimbos: { retomadas: [{ n: 1, em: iso(30 * HORA) }, { n: 2, em: iso(8 * HORA) }] } }, 'duas_retomadas_feitas'],
    ['estacionado até o futuro', { posses: [posse({ base: { estacionado_ate: new Date(AGORA.getTime() + 2 * 86_400_000).toISOString() } })] }, 'estacionado'],
    ['a IA já decidiu não retomar e nada novo chegou', { posses: [posse({ base: { tentativa: { wa_id: 11, em: iso(HORA), motivo: 'ia_ia_disse_nao', permanente: true } } })] }, 'tentativa_sem_mensagem_nova'],
    ['tentativa transitória há 10 min (espera 30)', { posses: [posse({ base: { tentativa: { wa_id: 11, em: iso(10 * MIN), motivo: 'x', permanente: false } } })] }, 'tentativa_sem_mensagem_nova'],
    ['o lead escreveu por último', { conversa: [msg(11, 'robo', 7 * HORA), lead6h] }, 'lead_escreveu_por_ultimo'],
    ['a equipe (humano no celular) falou por último', { conversa: [lead6h, msg(11, 'equipe', 5 * HORA)] }, 'equipe_falou_por_ultimo'],
    ['humano na conversa nas últimas 24 h (pausa humana)', { fatos: { humanoNaConversa: true } }, 'humano_na_conversa'],
    ['calado há menos de 3 h', { conversa: [msg(10, 'lead', 3 * HORA + 30 * MIN), robo(2 * HORA + 59 * MIN)] }, 'calado_ha_menos_de_3h'],
    ['conversa velha (mais de 48 h)', { conversa: [msg(10, 'lead', 60 * HORA), robo(59 * HORA)] }, 'conversa_velha'],
    ['card do produto (Duda: solar, qualquer status)', { cartoes: [{ id: 1, created_by: 'lp_solar', status: 'cancelado' }] }, 'tem_card_do_produto'],
    ['card de eletroposto em qualquer status (Helena)', { posses: [posse({}, 'helena')], cartoes: [{ id: 1, created_by: 'lp_eletroposto', status: 'cancelado' }] }, 'tem_card_do_produto'],
    ['card ativo do OUTRO produto (a régua dele pode estar ativa)', { cartoes: [{ id: 1, created_by: 'lp_eletroposto', status: 'agendado' }] }, 'tem_card_do_outro_produto'],
    ['o lead já tem conta no SolarDoc', { fatos: { ehClienteSolarDoc: true } }, 'lead_ja_e_cliente'],
    ['opt-out', { fatos: { naoIncomodar: true } }, 'opt_out_ou_bloqueio'],
    ['bloqueado', { fatos: { bloqueado: true } }, 'opt_out_ou_bloqueio'],
    ['mudo (3 toques em 60 dias)', { fatos: { mudo: true } }, 'mudo'],
    ['outro robô com a conversa', { fatos: { outroRoboAtivo: true } }, 'outro_robo_ativo'],
    ['leitura dos fatos falhou (não saber é não falar)', { fatos: { leituraOk: false } }, 'leitura_falhou'],
    ['outro robô falou depois do lead (2 mensagens de robô, 1 carimbo nosso)', { conversa: [lead6h, robo(5 * HORA, 11), robo(4 * HORA, 12)], carimbos: { respostasDaAgenteAposLead: 1 } }, 'outro_robo_falou'],
    ['a agente nunca respondeu esta fala (o robô é outro)', { carimbos: { respostasDaAgenteAposLead: 0 } }, 'outro_robo_falou'],
    ['carimbo de outro robô neste telefone nas últimas 24 h', { carimbos: { outroRobo24h: true } }, 'carimbo_de_outro_robo_24h'],
    ['telefone não resolvido (LID sem mapa)', { over: { telefone: async () => null } }, 'sem_telefone'],
    ['fora do escopo (modo teste e o número não está na lista)', { escopo: false }, 'fora_do_escopo'],
    ['a conversa não foi lida inteira', { over: { conversa: async () => ({ msgs: [], completa: false }) } }, 'conversa_incompleta'],
    ['a chave não é de telefone (lid:...)', { posses: [posse({}, 'duda', 'lid:123456789012345')] }, 'conversa_incompleta'],
    ['o lead nunca escreveu', { conversa: [robo(5 * HORA)] }, 'lead_nunca_falou'],
    ['a leitura dos carimbos falhou', { over: { carimbos: async () => null } }, 'leitura_falhou'],
    ['a leitura dos cartões falhou', { over: { cartoes: async () => null } }, 'leitura_falhou'],
  ];
  for (const [nome, cfg, motivo] of casos) {
    it(`${nome}: ${motivo}`, async () => {
      const w = mundo(cfg);
      const r = await rodar(w);
      expect(r.puladas[motivo], JSON.stringify(r.puladas)).toBeGreaterThanOrEqual(1);
      expect(r.enviou).toBe(false);
      expect(r.elegiveis).toBe(0);
      for (const k of ['pensar', 'claim', 'enviar', 'apagarClaim']) expect(w.calls, k).not.toContain(k);
      expect(w.gravacoes).toEqual([]);                                // pular não grava nada na posse
      expect(w.filas).toEqual([true]);                                // e a fila ELEGÍVEL está vazia
    });
  }

  it('card CANCELADO do outro produto não segura a Duda', async () => {
    const w = mundo({ cartoes: [{ id: 1, created_by: 'lp_eletroposto', status: 'cancelado' }] });
    expect((await rodar(w)).enviou).toBe(true);
  });
  it('card só do OUTRO produto e a Helena: card de solar ativo segura, cancelado não', async () => {
    expect((await rodar(mundo({ posses: [posse({}, 'helena')], cartoes: [{ id: 1, created_by: 'lp_solar', status: 'agendado' }] }))).puladas.tem_card_do_outro_produto).toBe(1);
    expect((await rodar(mundo({ posses: [posse({}, 'helena')], cartoes: [{ id: 1, created_by: 'lp_solar', status: 'cancelado' }] }))).enviou).toBe(true);
  });
  it('as mensagens da própria agente depois do lead (resposta :1 e :2) são explicadas pelos carimbos dela', async () => {
    const w = mundo({ conversa: [lead6h, robo(5 * HORA, 11), robo(5 * HORA - MIN, 12)], carimbos: { respostasDaAgenteAposLead: 2 } });
    expect((await rodar(w)).enviou).toBe(true);
  });
});

describe('o limite de 3 h e a janela de 9h às 20h juntos', () => {
  const brt = (dia: string, hora: string): Date => new Date(`${dia}T${hora}:00-03:00`);
  // A agente falou às 18h; o lead calou.
  const conversaDas18 = (): MsgConversa[] => [
    { ...msg(10, 'lead', 0, 'Quero saber'), momment: brt('2026-10-21', '17:50').toISOString() },
    { ...msg(11, 'robo', 0, 'Oi! Qual a cidade?'), momment: brt('2026-10-21', '18:00').toISOString() },
  ];
  it('conversa às 18h: às 19h30 ainda não são 3 h, às 21h é depois da janela, e às 9h do dia seguinte sai', async () => {
    const em = async (agora: Date) => runBaseTick({ agora }, mundo({ conversa: conversaDas18() }).d);
    expect((await em(brt('2026-10-21', '19:30'))).puladas.calado_ha_menos_de_3h).toBe(1);
    expect((await em(brt('2026-10-21', '21:00'))).motivo).toBe('fora_da_janela');
    expect((await em(brt('2026-10-22', '08:59'))).motivo).toBe('fora_da_janela');
    expect((await em(brt('2026-10-22', '09:00'))).enviou).toBe(true);
  });
  it('exatamente 3 h de silêncio já vale; 2 h59 não', async () => {
    const c = (min: number): MsgConversa[] => [msg(10, 'lead', min * MIN + 10 * MIN), msg(11, 'robo', min * MIN)];
    expect((await rodar(mundo({ conversa: c(180) }))).enviou).toBe(true);
    expect((await rodar(mundo({ conversa: c(179) }))).enviou).toBe(false);
  });
});

describe('no máximo 2 retomadas por pessoa, e a 2ª só no dia seguinte', () => {
  const lead = msg(10, 'lead', 30 * HORA);
  it('a 1ª é o carimbo :1 e, depois do envio, a posse passa a dizer retomadas=1', async () => {
    const w = mundo();
    await rodar(w);
    expect(w.claims).toEqual([chaveRetomada(HMAC, 1)]);
    expect(ult(w.gravacoes).patch).toMatchObject({ retomadas: 1 });
  });

  it('a 2ª NO MESMO DIA da 1ª não sai (segunda_ainda_nao), mesmo com mais de 3 h', async () => {
    // 1ª às 8h de hoje (BRT); agora são 14h; a conversa está calada.
    const w = mundo({
      conversa: [msg(10, 'lead', 8 * HORA), msg(11, 'robo', 8 * HORA - MIN), msg(12, 'robo', 6 * HORA)],
      carimbos: { respostasDaAgenteAposLead: 1, retomadas: [{ n: 1, em: iso(6 * HORA) }] },
    });
    const r = await rodar(w);
    expect(r.puladas.segunda_ainda_nao).toBe(1);
    expect(r.enviou).toBe(false);
  });

  it('no dia seguinte, 3 h depois da 1ª não respondida: sai a 2ª, com o carimbo :2', async () => {
    // 1ª ontem às 15h (BRT) = 23 h atrás; o lead não respondeu depois.
    const w = mundo({
      conversa: [msg(10, 'lead', 30 * HORA), msg(11, 'robo', 30 * HORA - MIN), msg(12, 'robo', 23 * HORA)],
      carimbos: { respostasDaAgenteAposLead: 1, retomadas: [{ n: 1, em: iso(23 * HORA) }] },
    });
    const r = await rodar(w);
    expect(r.enviou).toBe(true);
    expect(w.claims).toEqual([chaveRetomada(HMAC, 2)]);
    expect(ult(w.gravacoes).patch).toMatchObject({ retomadas: 2 });
  });

  it('o lead respondeu à 1ª: a 2ª não sai (só vale a 1ª NÃO respondida)', async () => {
    const w = mundo({
      conversa: [lead, msg(11, 'robo', 29 * HORA), msg(12, 'robo', 26 * HORA), msg(13, 'lead', 25 * HORA), msg(14, 'robo', 24 * HORA)],
      carimbos: { respostasDaAgenteAposLead: 1, retomadas: [{ n: 1, em: iso(26 * HORA) }] },
    });
    const r = await rodar(w);
    expect(r.puladas.lead_respondeu_a_primeira).toBe(1);
    expect(r.enviou).toBe(false);
  });

  it('virada do dia à meia-noite: 1ª às 20h de ontem e agora são 9h: é outro dia (Brasília) e passam mais de 3 h', async () => {
    const agora = new Date('2026-10-22T09:00:00-03:00');
    const w = mundo({
      conversa: [
        { ...msg(10, 'lead', 0), momment: '2026-10-21T14:00:00-03:00' }, { ...msg(11, 'robo', 0), momment: '2026-10-21T14:05:00-03:00' },
        { ...msg(12, 'robo', 0), momment: '2026-10-21T19:50:00-03:00' },
      ],
      carimbos: { respostasDaAgenteAposLead: 1, retomadas: [{ n: 1, em: '2026-10-21T19:50:00-03:00' }] },
    });
    expect((await runBaseTick({ agora }, w.d)).enviou).toBe(true);
  });

  it('a 1ª carimbada mas a posse ainda diz retomadas=0 (a gravação falhou): o carimbo manda e a próxima é a 2ª', async () => {
    const w = mundo({
      posses: [posse({ base: { retomadas: 0 } })],
      conversa: [msg(10, 'lead', 30 * HORA), msg(11, 'robo', 30 * HORA - MIN), msg(12, 'robo', 23 * HORA)],
      carimbos: { respostasDaAgenteAposLead: 1, retomadas: [{ n: 1, em: iso(23 * HORA) }] },
    });
    await rodar(w);
    expect(w.claims).toEqual([chaveRetomada(HMAC, 2)]);
  });

  it('depois da 2ª nunca mais: nem a posse nem o carimbo deixam uma 3ª', async () => {
    expect(patchDepoisDaRetomada(lerBaseDaPosse({ base: { retomadas: 1 } }), 2, false, AGORA)).toMatchObject({ retomadas: 2 });
    const w = mundo({ posses: [posse({ base: { retomadas: 2 } })] });
    expect((await rodar(w)).puladas.duas_retomadas_feitas).toBe(1);
  });
});

describe('estacionado: pula até a data e, no dia, sai 1 retomada que conta nas 2', () => {
  const ate = (iso8: string) => ({ estacionado_ate: iso8, estacionado_motivo: 'data_dita' });
  it('antes da data: pula; 1 segundo depois: é elegível', async () => {
    const quando = new Date(AGORA.getTime() + 1000).toISOString();
    expect((await rodar(mundo({ posses: [posse({ base: ate(quando) })] }))).puladas.estacionado).toBe(1);
    expect((await runBaseTick({ agora: new Date(AGORA.getTime() + 2000) }, mundo({ posses: [posse({ base: ate(quando) })] }).d)).enviou).toBe(true);
  });

  it('no dia: sai 1 retomada, conta (retomadas+1), e o estacionado é limpo para não repetir', async () => {
    const w = mundo({ posses: [posse({ base: { ...ate(iso(2 * HORA)), retomadas: 0 } })] });
    const r = await rodar(w);
    expect(r.enviou).toBe(true);
    expect(ult(w.gravacoes).patch).toMatchObject({ retomadas: 1, estacionado_ate: null });
  });

  it('o dia do estacionado vale mesmo com a conversa velha (a idade não vale) e mesmo no dia da 1ª retomada', async () => {
    const velha = [msg(10, 'lead', 20 * 24 * HORA), msg(11, 'robo', 20 * 24 * HORA - MIN)];
    expect((await rodar(mundo({ posses: [posse({ base: ate(iso(HORA)) })], conversa: velha }))).enviou).toBe(true);
    const w = mundo({
      posses: [posse({ base: { ...ate(iso(HORA)), retomadas: 1 } })],
      carimbos: { respostasDaAgenteAposLead: 1, retomadas: [{ n: 1, em: iso(5 * HORA) }] },
      conversa: [msg(10, 'lead', 8 * HORA), msg(11, 'robo', 8 * HORA - MIN), msg(12, 'robo', 5 * HORA)],
    });
    expect((await rodar(w)).enviou).toBe(true);
    expect(w.claims).toEqual([chaveRetomada(HMAC, 2)]);
  });

  it('"agora não" sem data (prazo fixo): a retomada do dia FECHA a conta nas 2', async () => {
    const w = mundo({ posses: [posse({ base: { ...ate(iso(HORA)), ultima: true, retomadas: 0 } })] });
    await rodar(w);
    expect(ult(w.gravacoes).patch).toMatchObject({ retomadas: LIMITES_BASE.maxRetomadas });
  });

  it('domingo vai para segunda: no domingo a janela barra; na segunda sai', async () => {
    const posses = (): PosseBase[] => [posse({ base: ate('2026-10-25T12:00:00.000Z') })];                        // domingo, 9h BRT
    const domingo = new Date('2026-10-25T13:00:00-03:00');
    const segunda = new Date('2026-10-26T10:00:00-03:00');
    const conv = (a: Date): MsgConversa[] => [{ ...msg(10, 'lead', 0), momment: iso(48 * HORA, a) }, { ...msg(11, 'robo', 0), momment: iso(47 * HORA, a) }];
    const wD = mundo({ posses: posses(), conversa: conv(domingo) });
    expect((await runBaseTick({ agora: domingo }, wD.d)).motivo).toBe('fora_da_janela');
    const wS = mundo({ posses: posses(), conversa: conv(segunda) });
    expect((await runBaseTick({ agora: segunda }, wS.d)).enviou).toBe(true);
  });

  it('o estacionado vale também para a Helena', async () => {
    const w = mundo({ posses: [posse({ base: ate(new Date(AGORA.getTime() + 86_400_000).toISOString()) }, 'helena')] });
    expect((await rodar(w)).puladas.estacionado).toBe(1);
  });

  it('as funções puras: triagemDaPosse e o patch', () => {
    const futuro = lerBaseDaPosse({ base: { estacionado_ate: new Date(AGORA.getTime() + HORA).toISOString() } });
    expect(triagemDaPosse(futuro, AGORA.getTime())).toEqual({ ok: false, motivo: 'estacionado' });
    const vencido = lerBaseDaPosse({ base: { estacionado_ate: iso(HORA), ultima: true } });
    expect(triagemDaPosse(vencido, AGORA.getTime())).toEqual({ ok: true, viaEstacionado: true });
    expect(patchDepoisDaRetomada(vencido, 1, true, AGORA)).toMatchObject({ retomadas: 2, estacionado_ate: null });
    expect(patchDepoisDaRetomada(lerBaseDaPosse(null), 1, false, AGORA)).toMatchObject({ retomadas: 1 });
  });
});

describe('a IA, a trava e o que acontece quando não sai nada', () => {
  it('a IA decide NÃO retomar: nada sai, a tentativa fica marcada (permanente) na última mensagem, e a rodada seguinte nem chama a IA', async () => {
    const w = mundo({ ia: { tipo: 'nao_retomar', motivo: 'ia_disse_nao' } });
    const r1 = await rodar(w);
    expect(r1.enviou).toBe(false);
    for (const k of ['claim', 'enviar', 'ultimoId']) expect(w.calls, k).not.toContain(k);
    expect(w.gravacoes).toHaveLength(1);
    expect(w.gravacoes[0]!.patch).toMatchObject({ tentativa: { wa_id: 11, permanente: true } });
    // rodada seguinte, mesma conversa, sem mensagem nova
    w.calls.length = 0;
    const r2 = await rodar(w);
    expect(r2.puladas.tentativa_sem_mensagem_nova).toBe(1);
    expect(w.calls).not.toContain('pensar');
  });

  it('mensagem nova depois da tentativa permanente reabre a conversa', async () => {
    const w = mundo({ ia: { tipo: 'nao_retomar', motivo: 'x' } });
    await rodar(w);
    // chegou uma mensagem nossa nova (id 12) e passaram 3 h
    w.d.conversa = async () => ({ msgs: [...CONVERSA(), msg(12, 'robo', 4 * HORA)], completa: true });
    w.d.carimbos = async () => ({ respostasDaAgenteAposLead: 2, retomadas: [], outroRobo24h: false });
    w.d.pensar = async () => ({ tipo: 'texto', bolha: BOLHA, chamadas: 1 });
    expect((await rodar(w)).puladas.tentativa_sem_mensagem_nova ?? 0).toBe(0);
  });

  it('bolha barrada pela trava (sem fala segura): sem texto de reserva, tentativa permanente, nada sai', async () => {
    const w = mundo({ ia: { tipo: 'barrada', motivo: 'duas falas seguidas' } });
    const r = await rodar(w);
    expect(r.enviou).toBe(false);
    expect(w.enviados).toEqual([]);
    expect(w.gravacoes[0]!.patch).toMatchObject({ tentativa: { permanente: true } });
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'bolha_barrada' });
  });

  it('falha de infraestrutura da IA: nada sai, tentativa transitória (30 min), sem claim', async () => {
    const w = mundo({ ia: { tipo: 'infra', motivo: 'falha_de_infra' } });
    await rodar(w);
    expect(w.gravacoes[0]!.patch).toMatchObject({ tentativa: { permanente: false } });
    expect(w.calls).not.toContain('claim');
  });

  it('IA parada (teto, disjuntor, prazo): nada sai e NADA é marcado (a conversa tenta na próxima)', async () => {
    const w = mundo({ ia: { tipo: 'parou', motivo: 'disjuntor' } });
    const r = await rodar(w);
    expect(r.enviou).toBe(false);
    expect(w.gravacoes).toEqual([]);
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'ia_parou' });
  });

  it('no máximo UMA chamada de IA por rodada, mesmo com a primeira desistindo e outros alvos na fila', async () => {
    const w = mundo({ posses: [posse({}, 'duda', '3499110001'), posse({}, 'duda', '3499110002')], ia: { tipo: 'nao_retomar', motivo: 'x' } });
    await rodar(w);
    expect(w.calls.filter(n => n === 'pensar')).toHaveLength(1);
  });
});

describe('o que muda entre a IA e o envio', () => {
  it('o lead (ou qualquer mensagem) escreve no meio: aborta, sem claim e sem envio', async () => {
    const w = mundo({ ultimoId: 12 });
    const r = await rodar(w);
    expect(r.enviou).toBe(false);
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'abortou', motivo: 'mensagem_nova_depois_da_ia' });
    for (const k of ['claim', 'enviar', 'envioOk']) expect(w.calls, k).not.toContain(k);
  });
  it('a releitura que falha também aborta (não saber é não falar) e marca transitório', async () => {
    const w = mundo({ ultimoId: null });
    await rodar(w);
    expect(w.calls).not.toContain('claim');
    expect(w.gravacoes[0]!.patch).toMatchObject({ tentativa: { permanente: false } });
  });
  it('o espaçamento de novo depois da IA: se a linha ocupou, aborta sem reservar', async () => {
    let n = 0;
    const w = mundo({ over: { espacamento: async () => (++n === 1) } });
    const r = await rodar(w);
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'abortou', motivo: 'espacamento_depois_da_ia' });
    expect(w.calls).not.toContain('claim');
  });
  it('uma resposta ao vivo entrou durante a IA (menos de 2 min): aborta sem reservar', async () => {
    let n = 0;
    const w = mundo({ over: { ultimaRespostaViva: async () => (++n === 1 ? null : AGORA.getTime() - MIN) } });
    const r = await rodar(w);
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'abortou', motivo: 'resposta_viva_depois_da_ia' });
    expect(w.calls).not.toContain('claim');
  });
  it('humano entrou ou o número virou opt-out durante a IA: aborta ANTES do claim (o sendFrio calaria sem lançar e contaria um envio que não houve)', async () => {
    const w = mundo({ over: { podeFalarAgora: async () => false } });
    const r = await rodar(w);
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'abortou', motivo: 'humano_ou_supressao' });
    for (const k of ['claim', 'enviar']) expect(w.calls, k).not.toContain(k);
  });
  it('o claim já existe (23505): ninguém envia', async () => {
    const w = mundo({ claim: 'ja' });
    const r = await rodar(w);
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'abortou', motivo: 'ja_reivindicado' });
    expect(w.calls).not.toContain('enviar');
  });
  it('o claim não gravou (erro de banco): ninguém envia', async () => {
    const w = mundo({ claim: 'erro' });
    await rodar(w);
    expect(w.calls).not.toContain('enviar');
  });
});

describe('o envio que falha: o claim só sai quando a recusa é CERTA antes de sair', () => {
  const tentativa = (w: Mundo): any => (w.gravacoes.find(g => 'tentativa' in g.patch)?.patch as any)?.tentativa;
  it('5xx: pode ter saído, então o carimbo FICA, a tentativa vira permanente, conta o erro da linha e não anota a retomada', async () => {
    const w = mundo({ envioFalha: new Error('Z-API HTTP 500: lixo com 5534991101000') });
    const r = await rodar(w);
    expect(r.enviou).toBe(false);
    expect(w.apagados).toEqual([]);
    expect(w.calls).toContain('erroDeLinha');
    expect(w.calls).not.toContain('envioOk');
    expect(tentativa(w)).toMatchObject({ wa_id: 11, permanente: true, motivo: 'envio_http_500' });
    expect(w.gravacoes.some(g => 'retomadas' in g.patch)).toBe(false);
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'envio_falhou', motivo: 'http_500' });
    expect(JSON.stringify(r)).not.toContain(TEL);                       // o texto do erro do Z-API traz o telefone: só o código sobe
  });
  it('timeout e falha genérica também mantêm o carimbo, marcam permanente e contam a linha', async () => {
    for (const msg of ['request timeout', 'Z-API quebrou de um jeito estranho']) {
      const w = mundo({ envioFalha: new Error(msg) });
      await rodar(w);
      expect(w.apagados, msg).toEqual([]);
      expect(w.calls, msg).toContain('erroDeLinha');
      expect(tentativa(w), msg).toMatchObject({ permanente: true });
    }
  });
  it('a rodada seguinte, com o carimbo mantido, não chama a IA nem reenvia (a mesma mensagem)', async () => {
    const w = mundo({ envioFalha: new Error('Z-API HTTP 503') });
    await rodar(w);
    w.calls.length = 0;
    const r2 = await rodar(w);
    expect(r2.puladas.tentativa_sem_mensagem_nova).toBe(1);
    for (const k of ['pensar', 'claim', 'enviar']) expect(w.calls, k).not.toContain(k);
  });
  it('cooldown da linha e credenciais ausentes provam que nada saiu: apaga o carimbo, conta a linha, tentativa transitória', async () => {
    for (const msg of ['linha io em cooldown', 'credenciais Z-API ausentes']) {
      const w = mundo({ envioFalha: new Error(msg) });
      await rodar(w);
      expect(w.apagados, msg).toEqual([chaveRetomada(HMAC, 1)]);
      expect(w.calls, msg).toContain('erroDeLinha');
      expect(tentativa(w), msg).toMatchObject({ permanente: false });
    }
  });
  it('erro do DESTINO (número inválido): apaga o carimbo, não conta na pausa da linha e a tentativa é PERMANENTE', async () => {
    const w = mundo({ envioFalha: new Error('Z-API HTTP 400: phone not exists') });
    await rodar(w);
    expect(w.apagados).toEqual([chaveRetomada(HMAC, 1)]);
    expect(w.calls).not.toContain('erroDeLinha');
    expect(tentativa(w)).toMatchObject({ permanente: true, motivo: 'envio_http_400' });
    w.calls.length = 0;
    const r2 = await rodar(w);
    expect(r2.puladas.tentativa_sem_mensagem_nova).toBe(1);               // não tenta de novo a cada 30 min
    expect(w.calls).not.toContain('pensar');
  });
  it('a posse não anotou depois do envio: o envio conta (r.enviou) e o carimbo vale', async () => {
    const w = mundo({ over: { gravarBase: async () => false } });
    expect((await rodar(w)).enviou).toBe(true);
  });
});

describe('o claim recusado marca a tentativa (transitória) para não chamar a IA de novo a cada 10 min', () => {
  for (const claim of ['ja', 'erro'] as const) {
    it(`claim "${claim}": nada sai, tentativa transitória na última mensagem, e a rodada seguinte pula sem IA`, async () => {
      const w = mundo({ claim });
      const r = await rodar(w);
      expect(r.enviou).toBe(false);
      expect(w.calls).not.toContain('enviar');
      const t = (w.gravacoes.find(g => 'tentativa' in g.patch)!.patch as any).tentativa;
      expect(t).toMatchObject({ wa_id: 11, permanente: false });
      w.calls.length = 0;
      expect((await rodar(w)).puladas.tentativa_sem_mensagem_nova).toBe(1);
      expect(w.calls).not.toContain('pensar');
    });
  }
});

describe('a fila da Base (ag5040_base_fila), que a B4c vai ler', () => {
  it('com alvo: vazia=false; sem nenhum alvo elegível: vazia=true', async () => {
    const a = mundo(); await rodar(a);
    expect(a.filas).toEqual([false]);
    const b = mundo({ fatos: { mudo: true } }); await rodar(b);
    expect(b.filas).toEqual([true]);
  });
  it('leitura cortada pelo limite de avaliações, sem alvo: não afirma nada', async () => {
    const posses = Array.from({ length: LIMITES_BASE.avaliacoesPorRodada + 5 }, (_, i) => posse({}, 'duda', `34991${String(10000 + i)}`));
    const w = mundo({ posses, fatos: { mudo: true } });
    const r = await rodar(w);
    expect(r.cortou).toBe(true);
    expect(r.avaliadas).toBe(LIMITES_BASE.avaliacoesPorRodada);
    expect(w.filas).toEqual([]);
  });
  it('saída antecipada (janela, teto, vez) não grava a fila: não calculou a lista', async () => {
    const w = mundo({ over: { tetoHorario: async () => false } });
    await rodar(w);
    expect(w.filas).toEqual([]);
  });
});

describe('o dry (?dry=1): lista os alvos e o motivo de cada um, e não grava nada', () => {
  it('não reserva a vez, não chama o modelo, não faz claim, não envia, não grava posse nem fila', async () => {
    const w = mundo({ posses: [posse({}, 'duda', '3499110001'), posse({ base: { retomadas: 2 } }, 'helena', '3499110002'), posse({}, 'duda', '3499110003')] });
    const r = await rodar(w, { dry: true });
    nadaEscrito(w);
    expect(r.dry).toBe(true);
    expect(r.posses).toBe(3);
    expect(r.elegiveis).toBe(2);
    expect(r.decisoes.map(d => d.resultado)).toEqual(['sairia', 'pulou', 'sairia']);
    expect(r.decisoes[1]).toMatchObject({ dona: 'helena', motivo: 'duas_retomadas_feitas' });
    expect(r.enviou).toBe(false);
  });
  it('mesmo com um portão fechado a leitura segue e o motivo do portão aparece', async () => {
    const w = mundo({ over: { tetoHorario: async () => false } });
    const r = await rodar(w, { dry: true });
    expect(r.motivo).toBe('teto_da_linha');
    expect(r.elegiveis).toBe(1);
    nadaEscrito(w);
  });
  it('fora da janela (domingo) o dry ainda lista, e não escreve', async () => {
    const w = mundo();
    const r = await runBaseTick({ dry: true, agora: new Date('2026-10-25T13:00:00-03:00') }, w.d);
    expect(r.motivo).toBe('fora_da_janela');
    expect(r.decisoes.length).toBeGreaterThan(0);
    nadaEscrito(w);
  });
  it('o relatório só leva hmac8: nenhum telefone, nenhuma chave de posse', async () => {
    const w = mundo();
    const r = await rodar(w, { dry: true });
    const s = JSON.stringify(r);
    expect(s).not.toContain(TEL);
    expect(s).not.toContain(CHAVE);
    expect(r.decisoes[0]!.hmac8).toBe(HMAC.slice(0, 8));
  });
});

describe('as triagens puras (a mesma regra que a rodada usa)', () => {
  const base: BaseDaPosse = lerBaseDaPosse(null);
  const resumo = (msgs: Array<[number, 'lead' | 'robo' | 'equipe', number]>) => resumirConversa(msgs.map(([id, autor, atras]) => ({ id, autor, momment: iso(atras) })));
  it('resumirConversa conta só o que veio depois da última fala do lead', () => {
    const r = resumo([[1, 'lead', 9 * HORA], [2, 'robo', 8 * HORA], [3, 'lead', 7 * HORA], [4, 'robo', 6 * HORA], [5, 'robo', 5 * HORA]]);
    expect(r.lastLead!.id).toBe(3);
    expect(r.roboAposLead).toBe(2);
    expect(r.equipeAposLead).toBe(false);
    expect(r.last).toMatchObject({ id: 5, autor: 'robo' });
  });
  it('triagemDaConversa: alvo de livro passa; velha só passa no dia do estacionado', () => {
    const ok = resumo([[1, 'lead', 6 * HORA], [2, 'robo', 5 * HORA]]);
    expect(triagemDaConversa(ok, base, false, AGORA.getTime())).toEqual({ ok: true });
    const velha = resumo([[1, 'lead', 80 * HORA], [2, 'robo', 79 * HORA]]);
    expect(triagemDaConversa(velha, base, false, AGORA.getTime())).toEqual({ ok: false, motivo: 'conversa_velha' });
    expect(triagemDaConversa(velha, base, true, AGORA.getTime())).toEqual({ ok: true });
  });
  it('triagemDoContexto devolve o número da retomada', () => {
    const fatos: FatosDoContexto = {
      cardDoProduto: false, cardAtivoDoOutroProduto: false, leituraOk: true, humanoNaConversa: false, silenciado: false, bloqueado: false, mudo: false,
      outroRoboAtivo: false, ehClienteSolarDoc: false, respostasDaAgenteAposLead: 1, retomadasCarimbadas: [], carimboDeOutroRobo24h: false, telefoneResolvido: true,
    };
    const r = resumo([[1, 'lead', 6 * HORA], [2, 'robo', 5 * HORA]]);
    expect(triagemDoContexto(fatos, r, base, false, AGORA.getTime())).toEqual({ ok: true, n: 1 });
  });
});

// ── 4. a rodada com as dependências de verdade (banco falso, zapiClient mocado) ──

describe('a rodada com depsReais() sobre um banco falso', () => {
  let banco: BancoFalso;
  const brt = (dia: string, hora: string): Date => new Date(`${dia}T${hora}:00-03:00`);

  const semear = (extra: { posse?: Record<string, unknown>; msgs?: Array<Record<string, unknown>> } = {}) => {
    (banco.tabelas.wa_mensagens ??= []).push(
      ...(extra.msgs ?? [
        { id: 10, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Quero saber de energia solar', momment: iso(6 * HORA) },
        { id: 11, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: true, tipo: 'texto', texto: 'Oi, Tadeu! Qual cidade você mora?', momment: iso(6 * HORA - 10 * MIN) },
      ]),
    );
    (banco.tabelas.whatsapp_sessions ??= []).push({
      phone: CHAVE, tipo: 'ag5040', updated_at: iso(6 * HORA - 10 * MIN),
      lead_data: { dona: 'duda', estado: 'viva', apresentada: true, desde: iso(8 * HORA), ate_wa_id: 10, respostas: 1, imagens: [], links: [], ...(extra.posse ?? {}) },
    });
    (banco.tabelas.system_state ??= []).push({ key: 'ag5040_sent:10:1', value: { estado: 'enviado' }, updated_at: iso(6 * HORA - 10 * MIN) });
  };
  const alvo = () => {
    banco.tabelas.system_state = [
      ...(banco.tabelas.system_state ?? []).filter(l => l.key !== CHAVE_VIVO_ALVO),
      { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [HMAC], modos: {}, atualizado_em: iso(HORA) } },
    ];
    zerarCacheInterruptores();
  };
  const posseDe = () => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data as Record<string, any>;
  const chaves = (): string[] => (banco.tabelas.system_state ?? []).map(l => l.key);
  /** O banco falso ignora .or(); aqui ele vale: as cláusulas `key.like.<padrão>` viram um `in` com as chaves que casam AGORA. */
  const comOr = (b: BancoFalso): void => {
    const from0 = b.cliente.from.bind(b.cliente);
    b.cliente.from = (t: string) => {
      const q = from0(t);
      q.or = (expr: string) => {
        const rx = expr.split(',').map(c => c.replace(/^key\.like\./, ''))
          .map(p => new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'));
        return q.in('key', (b.tabelas[t] ?? []).map((l: any) => l.key).filter((k: string) => rx.some(r => r.test(k))));
      };
      return q;
    };
  };
  const ia = (resposta = saidaJson([BOLHA])) => iaFalsa(() => respostaIA(resposta, { cache_creation_input_tokens: 10 }));

  beforeEach(() => {
    banco = novoBanco(); comOr(banco);
    z.principal = banco; z.gerador = novoBanco();
    z.teto = true; z.espaco = true; z.pode = { pode: true }; z.motivos = [];
    z.frio.mockReset().mockResolvedValue(undefined);
    process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
    process.env.AGENTES5040_DUDA_VIVO = '1';
    delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO; delete process.env.AGENTES5040_TETO_RESPOSTA;
    zerarCacheArmazem(); zerarCacheInterruptores();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); delete process.env.AGENTES5040_DUDA_VIVO; delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO; });

  it('uma rodada inteira: lê a posse, resolve o número, chama a IA (trava de verdade), reserva o carimbo, envia por sendFrio e anota a retomada', async () => {
    semear(); alvo();
    const fake = ia();
    const r = await runBaseTick({ agora: AGORA, cliente: fake.cliente });
    expect(r).toMatchObject({ ok: true, enviou: true, elegiveis: 1, chamadasIA: 1 });
    expect(z.frio).toHaveBeenCalledTimes(1);
    expect(z.frio.mock.calls[0]).toEqual([TEL, [BOLHA], 'io']);
    expect(chaves()).toContain(`ag5040_retomada:${HMAC}:1`);
    expect(chaves()).toContain('ag5040_base_fila');
    expect(chaves().some(k => k.startsWith('ag5040_base_vez:'))).toBe(true);
    expect(posseDe().base).toMatchObject({ retomadas: 1, ultima_retomada_em: AGORA.toISOString() });
    // nada de telefone cru nas chaves nem nos valores gravados no system_state
    expect(JSON.stringify(banco.tabelas.system_state)).not.toContain(TEL);
    expect(JSON.stringify(banco.tabelas.system_state)).not.toContain(CHAVE);
    // O pedido ao modelo leva o aviso da retomada e a conversa
    expect(JSON.stringify(fake.chamadas[0]!.body.messages)).toContain('AVISO DO SISTEMA (retomada)');
  });

  it('a mesma faixa de 10 minutos: a segunda chamada perde a vez e nada mais acontece', async () => {
    semear(); alvo();
    await runBaseTick({ agora: AGORA, cliente: ia().cliente });
    z.frio.mockClear();
    const r2 = await runBaseTick({ agora: new Date(AGORA.getTime() + 60_000), cliente: ia().cliente });
    expect(r2.motivo).toBe('vez_ocupada');
    expect(z.frio).not.toHaveBeenCalled();
  });

  it('sendFrio lança 5xx: o carimbo FICA (pode ter saído), a tentativa é permanente, a retomada não é anotada e o erro de linha é contado sem telefone', async () => {
    semear(); alvo();
    z.frio.mockRejectedValue(new Error(`Z-API HTTP 500 ${TEL}`));
    const r = await runBaseTick({ agora: AGORA, cliente: ia().cliente });
    expect(r.enviou).toBe(false);
    expect(chaves()).toContain(`ag5040_retomada:${HMAC}:1`);
    expect(posseDe().base?.retomadas ?? 0).toBe(0);
    expect(posseDe().base?.tentativa).toMatchObject({ permanente: true, motivo: 'envio_http_500' });
    expect(JSON.stringify(banco.tabelas.system_state)).not.toContain(TEL);
    expect((banco.tabelas.system_state ?? []).find(l => l.key === 'ag5040_linha_erros')?.value).toMatchObject({ n: 1 });
  });

  it('sendFrio lança erro de destino (4xx): o carimbo é apagado, a tentativa é permanente e a linha não conta erro', async () => {
    semear(); alvo();
    z.frio.mockRejectedValue(new Error(`Z-API HTTP 400 ${TEL} phone not exists`));
    const r = await runBaseTick({ agora: AGORA, cliente: ia().cliente });
    expect(r.enviou).toBe(false);
    expect(chaves()).not.toContain(`ag5040_retomada:${HMAC}:1`);
    expect(posseDe().base?.tentativa).toMatchObject({ permanente: true });
    expect((banco.tabelas.system_state ?? []).find(l => l.key === 'ag5040_linha_erros')).toBeUndefined();
  });

  it('o dry de verdade não escreve em NENHUMA tabela e não chama o modelo nem o sendFrio', async () => {
    semear(); alvo();
    const fake = ia();
    const antes = banco.escritas.length;
    const r = await runBaseTick({ agora: AGORA, cliente: fake.cliente, dry: true });
    expect(r.elegiveis).toBe(1);
    expect(r.decisoes[0]).toMatchObject({ resultado: 'sairia' });
    expect(banco.escritas.length).toBe(antes);
    expect(fake.chamadas).toHaveLength(0);
    expect(z.frio).not.toHaveBeenCalled();
  });

  it('a IA devolve calar: nada sai e a posse guarda a tentativa permanente', async () => {
    semear(); alvo();
    const r = await runBaseTick({ agora: AGORA, cliente: ia(saidaJson([], { acao: 'calar' })).cliente });
    expect(r.enviou).toBe(false);
    expect(z.frio).not.toHaveBeenCalled();
    expect(posseDe().base.tentativa).toMatchObject({ wa_id: 11, permanente: true });
  });

  it('a IA devolve uma ação de agenda (fora do schema da retomada): nada sai', async () => {
    semear(); alvo();
    const r = await runBaseTick({ agora: AGORA, cliente: ia(saidaJson(['Marcado.'], { acao: 'marcar_horario' })).cliente });
    expect(r.enviou).toBe(false);
    expect(z.frio).not.toHaveBeenCalled();
  });

  it('o lead escreveu enquanto a IA pensava: aborta sem carimbo e sem envio', async () => {
    semear(); alvo();
    const fake = iaFalsa(() => {
      banco.tabelas.wa_mensagens!.push({ id: 12, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Oi, voltei', momment: AGORA.toISOString() });
      return respostaIA(saidaJson([BOLHA]));
    });
    const r = await runBaseTick({ agora: AGORA, cliente: fake.cliente });
    expect(ult(r.decisoes)).toMatchObject({ resultado: 'abortou', motivo: 'mensagem_nova_depois_da_ia' });
    expect(chaves()).not.toContain(`ag5040_retomada:${HMAC}:1`);
    expect(z.frio).not.toHaveBeenCalled();
  });

  it('carimbo de OUTRO robô amarrado a este telefone nas últimas 24 h: pula; de 25 h atrás ou de outro telefone, não', async () => {
    semear(); alvo();
    (banco.tabelas.system_state ??= []).push({ key: `inv_agente_sent:${CHAVE}:t1`, value: {}, updated_at: iso(2 * HORA) });
    const r = await runBaseTick({ agora: AGORA, cliente: ia().cliente });
    expect(r.puladas.carimbo_de_outro_robo_24h).toBe(1);
    expect(z.frio).not.toHaveBeenCalled();
    // velho (25 h) e de outro telefone não seguram
    banco.tabelas.system_state = banco.tabelas.system_state!.filter(l => !l.key.startsWith('ag5040_base_vez:') && !l.key.startsWith('inv_agente_sent:'));
    banco.tabelas.system_state.push({ key: `inv_agente_sent:${CHAVE}:t1`, value: {}, updated_at: iso(25 * HORA) });
    banco.tabelas.system_state.push({ key: 'inv_agente_sent:3411112222:t1', value: {}, updated_at: iso(HORA) });
    const r2 = await runBaseTick({ agora: new Date(AGORA.getTime() + 11 * MIN), cliente: ia().cliente });
    expect(r2.enviou).toBe(true);
  });

  it('sem a Duda nem a Helena ligadas: sem leitura nenhuma do banco além do interruptor', async () => {
    process.env.AGENTES5040_DUDA_VIVO = '0'; process.env.AGENTES5040_HELENA_VIVO = '0'; process.env.AGENTES5040_CARLA_VIVO = '0';
    semear(); alvo();
    banco.leituras.length = 0;
    const r = await runBaseTick({ agora: AGORA, cliente: ia().cliente });
    expect(r).toMatchObject({ ligado: false });
    expect(banco.leituras).toEqual([]);
    expect(banco.escritas).toEqual([]);
  });

  it('o posse viva fora do escopo (lista de teste vazia) não recebe nada', async () => {
    semear();
    banco.tabelas.system_state = [{ key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [], modos: {}, atualizado_em: iso(HORA) }, updated_at: iso(HORA) }];
    zerarCacheInterruptores();
    const r = await runBaseTick({ agora: AGORA, cliente: ia().cliente });
    expect(r.enviou).toBe(false);
    expect(z.frio).not.toHaveBeenCalled();
  });
});

describe('depsReais: formas das chaves', () => {
  it('é uma fábrica sem efeito colateral (nada lido ao criar)', () => {
    const d = depsReais({});
    expect(typeof d.enviar).toBe('function');
    expect(typeof d.carimbos).toBe('function');
  });
  it('AlvoBase e PosseBase são exportados para os testes e para a rota (tipos)', () => {
    const a: Partial<AlvoBase> = {};
    expect(a).toEqual({});
  });
});

describe('chave do aviso de IA DESLIGADA (a de produção): a Base retoma sem a marca apresentada', () => {
  beforeEach(() => { aviso.on = false; });
  afterEach(() => { aviso.on = true; });

  it('posse com apresentada falsa ou sem a marca é retomada normalmente (nada de nao_apresentada)', async () => {
    for (const p of [posse({ apresentada: false }), { ...posse(), lead_data: (({ apresentada: _a, ...resto }) => resto)(posse().lead_data) }]) {
      const w = mundo({ posses: [p] });
      const r = await rodar(w);
      expect(r.puladas.nao_apresentada).toBeUndefined();
      expect(r.enviou).toBe(true);
      expect(w.enviados).toHaveLength(1);
    }
  });
});
