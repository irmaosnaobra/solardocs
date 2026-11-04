import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O religar do quiz solar na ENTRADA do turno da rodada viva (04/11/2026): a fala com o botão e "Código: XXXXX" religa o card a quem escreveu
// ANTES de qualquer leitura do card, para a Duda achar o card deste número e não criar um segundo. Banco falso, IA falsa, religar trocado por mock
// (menos no teste do prazo, que usa o religar de verdade com o banco lento).
const h = vi.hoisted(() => ({
  principal: null as any,
  gerador: null as any,
  enviar: vi.fn(),
  ficha: vi.fn(),
  religar: vi.fn(),
  real: null as any,
  gravar: vi.fn(),
  remarcar: vi.fn(),
  vagas: vi.fn(),
}));
vi.mock('../utils/supabase', () => ({ supabase: new Proxy({}, { get: (_t, k) => h.principal.cliente[k as string] }) }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: new Proxy({}, { get: (_t, k) => h.gerador.cliente[k as string] }) }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({
  novoAnthropic: () => { throw new Error('chamada real à Anthropic em teste'); },
}));
vi.mock('../services/agentes5040/vivoEnvio', () => ({ enviarResposta: (...a: unknown[]) => h.enviar(...a) }));
vi.mock('../services/agentes5040/fichaEnvio', () => ({
  carregarTelefonesConsultores: async () => ({ ok: true, mapa: new Map([['diego', '34991360172'], ['nilce', '34991516846']]) }),
  enviarFichaAoConsultor: (...a: unknown[]) => h.ficha(...a),
  erroProvaQueNaoSaiu: () => false,
  linhaIoEmCooldown: () => false,
  leadEhDeTeste: async () => false,
  telefoneDoConsultor: (m: Map<string, string>, n: string) => m.get(String(n ?? '').trim().toLowerCase().split(' ')[0]!) ?? null,
  telefoneDoDono: () => '34900000000',
  tetoDaLinhaPermiteFicha: async () => 'ok',
}));
vi.mock('../services/agentes5040/agendaEnvio', () => ({
  enfileirarAgenda: async () => ({ ok: true, chave: 'ag5040_agenda_fila:0:confirma' }),
  bolhaDeConfirmacao: () => null,
}));
vi.mock('../services/agentes5040/religarQuiz', async (orig) => {
  const real = await orig<typeof import('../services/agentes5040/religarQuiz')>();
  h.real = real.religarQuizPelaEntrada;
  return { ...real, religarQuizPelaEntrada: (...a: unknown[]) => h.religar(...a) };
});
// O card e a agenda: nada alcança a rede. O gravar "cria" o card 99 na agenda falsa, para o resto do código enxergar.
vi.mock('../services/agentes5040/agendaSolar', () => ({
  gravarCardSolar: (...a: unknown[]) => h.gravar(...a),
  remarcarCardSolar: (...a: unknown[]) => h.remarcar(...a),
  tirarMarcaSaiuDoCard: async () => true,
  marcarBoasVindasEnviada: async () => true,
  silenciarLembretesDoCard: async () => true,
}));
vi.mock('../services/agentes5040/agendaSolarVagas', async (orig) => ({
  ...(await orig<typeof import('../services/agentes5040/agendaSolarVagas')>()),
  vagasSolar: (...a: unknown[]) => h.vagas(...a),
}));

import { iaFalsa, novoBanco, respostaIA, saidaJson, type BancoFalso } from './_agentes5040Fake';
import { runVivoTick } from '../services/agentes5040/vivo';
import { CHAVE_VIVO_ALVO, DONAS_LIBERADAS_PARA_TODOS, zerarCacheInterruptores, type DonaViva } from '../services/agentes5040/interruptores';
import { zerarCacheArmazem } from '../services/agentes5040/armazem';
import { hmacDe, idChaveHmac } from '../services/agentes5040/hmac';

const AGORA = new Date('2026-10-20T15:00:00.000Z');
const iso = (msAntes: number): string => new Date(AGORA.getTime() - msAntes).toISOString();
const MOMENTO_LEAD = iso(2 * 60_000);
const DESDE_POSSE = iso(10 * 60_000);
const FALA_DUDA = 'Aqui é a Duda, da Irmãos na Obra. Qual é o valor da sua conta de luz?';
const V1 = '2026-10-21T12:30:00.000Z';
const V2 = '2026-10-21T17:30:00.000Z';
const TXT1 = 'amanhã, quarta, 21/10, às 9h30';
const BOLHA_MARCADO = 'Marcado: amanhã, quarta, às 9h30. Se precisar mudar, é só me chamar aqui.';
const MARCAR = { acao: 'marcar_horario', dados: [{ chave: 'horario', valor: TXT1 }] };
const TEL = '5534991100000';
const CHAVE = '3491100000';
const TEL_DO_QUIZ = '5511988887777';
const BOTAO = 'Oi! Acabei de preencher a simulação de energia solar. Código: K7M2P';

let banco: BancoFalso;
let gerador: BancoFalso;
let ia = iaFalsa(() => respostaIA(saidaJson([FALA_DUDA]), { cache_creation_input_tokens: 100 }));

function semear(texto: string, momento: string = MOMENTO_LEAD) {
  (banco.tabelas.wa_mensagens ??= []).push(
    { id: 10, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto, momment: momento },
  );
  (banco.tabelas.whatsapp_sessions ??= []).push({
    phone: CHAVE, tipo: 'ag5040',
    lead_data: { dona: 'duda', estado: 'viva', apresentada: true, desde: DESDE_POSSE, ate_wa_id: null, respostas: 0, imagens: [], links: [] },
  });
  banco.tabelas.system_state = [
    ...(banco.tabelas.system_state ?? []).filter(l => l.key !== CHAVE_VIVO_ALVO),
    { key: CHAVE_VIVO_ALVO, value: { kid: idChaveHmac(), hmacs: [hmacDe(CHAVE)!], modos: {}, atualizado_em: iso(3600_000) } },
  ];
  zerarCacheInterruptores();
}

/** O card do quiz, no número que o cliente digitou lá (não no de quem escreveu). */
function semearCard1714(criadoEm: string = iso(30 * 60_000)) {
  gerador.tabelas.agendamentos = [{
    id: 1714, cliente_telefone: TEL_DO_QUIZ, cliente_nome: 'Tadeu Souza', vendedor_nome: 'Nilce', status: 'agendado', created_by: 'lp_solar',
    created_at: criadoEm, quando: '2026-10-23T13:00:00.000Z', cidade: 'Araguari', observacao: null,
  }];
}
/** Quem escreve com o botão e já conta o gasto (sem card, a Duda precisa dele para marcar). */
const semearComGasto = () => {
  semear(BOTAO, iso(3 * 60_000));
  (banco.tabelas.wa_mensagens ??= []).push(
    { id: 11, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Minha conta de luz vem uns R$ 280 por mês', momment: MOMENTO_LEAD },
  );
};
const marcando = () => iaFalsa(() => respostaIA(saidaJson([BOLHA_MARCADO], MARCAR), { cache_creation_input_tokens: 100 }));
const cardsDe = (tel: string) => (gerador.tabelas.agendamentos ?? []).filter(c => c.cliente_telefone === tel);

const posseDe = () => (banco.tabelas.whatsapp_sessions ?? []).find(l => l.phone === CHAVE && l.tipo === 'ag5040')!.lead_data as Record<string, any>;

const rodar = (extra: Record<string, unknown> = {}) => runVivoTick({ agora: AGORA, cliente: ia.cliente, ...extra });

beforeEach(() => {
  banco = novoBanco(); gerador = novoBanco();
  h.principal = banco; h.gerador = gerador;
  h.enviar.mockReset().mockImplementation(async (p: any) => (p.dry ? { ok: false, motivo: 'dry' } : { ok: true, enviadas: 1, carimbos: [`ag5040_sent:${p.waIdAlvo}:1`] }));
  h.ficha.mockReset().mockResolvedValue(undefined);
  h.religar.mockReset().mockResolvedValue({ religou: false, motivo: 'codigo_desconhecido' });
  h.vagas.mockReset().mockResolvedValue([V1, V2]);
  h.remarcar.mockReset().mockResolvedValue('ok');
  h.gravar.mockReset().mockImplementation(async (f: any) => {
    const card = { id: 99, vendedor_nome: f.dono, quando: f.quando, cliente_nome: f.nome, cliente_telefone: f.tel, cidade: f.cidade, observacao: f.observacao, created_by: 'lp_solar', created_at: AGORA.toISOString(), status: 'agendado', historico: null };
    (gerador.tabelas.agendamentos ??= []).push(card);
    return { status: 'ok', card };
  });
  process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  process.env.AGENTES5040_DUDA_VIVO = '1';
  process.env.FICHA_5040_IA_OFF = '1';
  delete process.env.AGENTES5040_HELENA_VIVO; delete process.env.AGENTES5040_CARLA_VIVO;
  delete process.env.AGENTES5040_TETO_VIVO; delete process.env.AGENTES5040_TETO_DRY; delete process.env.AGENTES5040_TETO_RESPOSTA;
  zerarCacheArmazem(); zerarCacheInterruptores();
  ia = iaFalsa(() => respostaIA(saidaJson([FALA_DUDA]), { cache_creation_input_tokens: 100 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AGORA);
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  delete process.env.AGENTES5040_DUDA_VIVO; delete process.env.FICHA_5040_IA_OFF;
  (DONAS_LIBERADAS_PARA_TODOS as DonaViva[]).length = 0;
});

describe('rodada viva: religar do quiz solar na entrada do turno', () => {
  it('fala com o botão e o código chama o religar, antes do modelo e antes de reler o card', async () => {
    semear(BOTAO);
    let iaAntes = -1; let leiturasAntes = -1;
    h.religar.mockImplementation(async () => { iaAntes = ia.chamadas.length; leiturasAntes = gerador.leituras.length; return { religou: false, motivo: 'x' }; });
    const r = await rodar();
    expect(h.religar).toHaveBeenCalledTimes(1);
    expect(h.religar.mock.calls[0]!.slice(0, 3)).toEqual([CHAVE, TEL, BOTAO]);
    expect(iaAntes).toBe(0);
    expect(gerador.leituras.slice(leiturasAntes)).toContain('agendamentos');   // o contexto leu o card DEPOIS do religar
    expect(r.enviadas).toBe(1);
  });

  it('o religar recebe um prazo de escrita (instante absoluto) abaixo do teto de 2,5 s', async () => {
    semear(BOTAO);
    await rodar();
    const [, , , agora, prazo] = h.religar.mock.calls[0]!;
    expect(typeof prazo).toBe('number');
    expect(prazo - agora).toBeGreaterThan(0);
    expect(prazo - agora).toBeLessThan(2_500);
  });

  it('fala sem código não chama o religar', async () => {
    semear('Oi! Acabei de preencher a simulação de energia solar');
    await rodar();
    expect(h.religar).not.toHaveBeenCalled();
  });

  it('código em fala que não é o botão solar não chama o religar', async () => {
    semear('manda o Código: K7M2P pra mim');
    await rodar();
    expect(h.religar).not.toHaveBeenCalled();
  });

  it('fala nossa com o código não chama: o portão passa (há fala nova do lead, sem código) e o religar não é chamado', async () => {
    semear('Oi!', iso(4 * 60_000));
    (banco.tabelas.wa_mensagens ??= []).push(
      { id: 11, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: true, from_api: null, tipo: 'texto', texto: BOTAO, momment: iso(3 * 60_000) },
      { id: 12, instancia: 'inst-io', telefone: TEL, is_group: false, from_me: false, from_api: null, tipo: 'texto', texto: 'Pode ser amanhã', momment: MOMENTO_LEAD },
    );
    const r = await rodar();
    expect(r.enviadas).toBe(1);                                  // o turno rodou até o fim: não caiu em ja_respondida_por_nos
    expect(h.religar).not.toHaveBeenCalled();
  });

  it('o dry não religa (religar escreve no card)', async () => {
    semear(BOTAO);
    await rodar({ dry: true });
    expect(h.religar).not.toHaveBeenCalled();
  });

  it('religar que lança não muda a resposta da Duda', async () => {
    semear(BOTAO);
    h.religar.mockRejectedValue(new Error('boom'));
    const r = await rodar();
    expect(h.religar).toHaveBeenCalledTimes(1);
    expect(r.enviadas).toBe(1);
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(FALA_DUDA);
  });

  it('religar que nunca responde: o race de 2,5 s estoura e a fala fica para a próxima rodada (sem resposta, sem ate_wa_id, sem contador)', async () => {
    semear(BOTAO);
    h.religar.mockImplementation(() => new Promise(() => {}));
    const r = await rodar();
    expect(h.religar).toHaveBeenCalledTimes(1);
    expect(r.enviadas).toBe(0);
    expect(r.puladas.religar_estourou).toBe(1);
    expect(h.enviar).not.toHaveBeenCalled();
    expect(ia.chamadas).toHaveLength(0);
    expect(posseDe()).toMatchObject({ estado: 'viva', ate_wa_id: null, respostas: 0 });
    expect((banco.tabelas.system_state ?? []).some(l => /^ag5040_(vez|sent|tent)/.test(String(l.key)))).toBe(false);
  }, 10_000);

  it('sem estouro (religar lento, mas dentro dos 2,5 s) o turno segue igual a antes', async () => {
    vi.useRealTimers();
    semear(BOTAO);
    h.religar.mockImplementation(() => new Promise(res => setTimeout(() => res({ religou: false, motivo: 'codigo_usado' }), 400)));
    const r = await rodar();
    expect(r.enviadas).toBe(1);
    expect(r.puladas.religar_estourou).toBeUndefined();
    expect(h.enviar.mock.calls[0]![0].bolha).toBe(FALA_DUDA);
    expect(posseDe()).toMatchObject({ ate_wa_id: 10, respostas: 1 });
  }, 10_000);

  it('religou: true e o modelo marca horário = a Duda remarca o card religado e NÃO cria outro', async () => {
    semear(BOTAO); semearCard1714(); ia = marcando();
    h.religar.mockImplementation(async () => {
      gerador.tabelas.agendamentos![0]!.cliente_telefone = TEL;
      return { religou: true, cardId: 1714, motivo: 'religado' };
    });
    const r = await rodar();
    expect(r.enviadas).toBe(1);
    expect(h.gravar).not.toHaveBeenCalled();
    expect(h.remarcar).toHaveBeenCalledTimes(1);
    expect(h.remarcar.mock.calls[0]![0]).toBe(1714);
    expect(gerador.tabelas.agendamentos).toHaveLength(1);
  });

  it('controle: sem religar, o mesmo turno cria o card novo (é o que o religar evita)', async () => {
    semearComGasto(); semearCard1714(); ia = marcando();
    await rodar();
    expect(h.gravar).toHaveBeenCalledTimes(1);
    expect(gerador.tabelas.agendamentos).toHaveLength(2);
  });

  it('banco lento (relógio real): a leitura do card passa do prazo, o religar de verdade NÃO escreve nada e nada muda depois', async () => {
    vi.useRealTimers();
    const t = Date.now();
    semearComGasto();
    (banco.tabelas.system_state ??= []).push({ key: 'quizsolar_codigo:K7M2P', value: { card_id: 1714, criado_em: new Date(t - 5 * 60_000).toISOString() }, updated_at: new Date(t).toISOString() });
    semearCard1714(new Date(t - 5 * 60_000).toISOString());
    ia = marcando();
    // a 1ª leitura de agendamentos DEPOIS de o religar começar (a do card, passo 2) resolve 2,2 s depois: passa do prazo de 2 s
    let armado = false; let atrasada = false;
    h.religar.mockImplementation((...a: unknown[]) => { armado = true; return h.real(...a); });
    const original = gerador.cliente.from;
    gerador.cliente.from = (nome: string) => {
      const q = original(nome);
      if (armado && !atrasada && nome === 'agendamentos') {
        atrasada = true;
        const entregar = q.then;
        q.then = (ok: any, ko: any) => new Promise(res => setTimeout(res, 2_200)).then(() => entregar(ok, ko));
      }
      return q;
    };
    const r = await rodar();
    expect(atrasada).toBe(true);
    expect(r.enviadas).toBe(1);
    const sem = () => {
      expect(gerador.tabelas.agendamentos!.find(c => c.id === 1714)!.cliente_telefone).toBe(TEL_DO_QUIZ);       // o card do quiz não foi tocado
      expect((banco.tabelas.system_state ?? []).some(l => l.key === 'quizsolar_religado:1714')).toBe(false);    // nem o marcador ficou
      expect(banco.escritas.some(e => (e.chaves ?? []).includes('quizsolar_religado:1714'))).toBe(false);       // nem chegou a ser gravado
      expect(cardsDe(TEL)).toHaveLength(1);                                                                     // só o card da Duda aponta para o número
    };
    sem();
    await new Promise(res => setTimeout(res, 400));                                                             // e nada chega depois do turno
    sem();
  }, 15_000);

  it('UPDATE em voo que termina depois do race: nesta rodada a Duda não responde nem cria card; na seguinte lê o card religado e remarca (sem 2º card)', async () => {
    vi.useRealTimers();
    const t = Date.now();
    semear(BOTAO);
    (banco.tabelas.system_state ??= []).push({ key: 'quizsolar_codigo:K7M2P', value: { card_id: 1714, criado_em: new Date(t - 5 * 60_000).toISOString() }, updated_at: new Date(t).toISOString() });
    semearCard1714(new Date(t - 5 * 60_000).toISOString());
    ia = marcando();
    // O UPDATE do card passa na conferência do prazo e o banco o APLICA na hora, mas a resposta só chega 2,8 s depois: depois do race (2,5 s).
    let atrasado = false;
    h.religar.mockImplementation((...a: unknown[]) => h.real(...a));
    const original = gerador.cliente.from;
    gerador.cliente.from = (nome: string) => {
      const q = original(nome);
      if (nome === 'agendamentos' && !atrasado) {
        const atualizar = q.update;
        q.update = (p: unknown) => {
          const b = atualizar(p);
          if (!atrasado) {
            atrasado = true;
            const entregar = b.then;
            b.then = (ok: any, ko: any) => new Promise(res => entregar(res, res))
              .then(v => new Promise(res => setTimeout(() => res(v), 2_800))).then(ok, ko);
          }
          return b;
        };
      }
      return q;
    };

    const r1 = await rodar();
    expect(atrasado).toBe(true);
    expect(r1.enviadas).toBe(0);                                  // a Duda não respondeu
    expect(r1.puladas.religar_estourou).toBe(1);
    expect(h.gravar).not.toHaveBeenCalled();                      // e nenhum card foi criado
    expect(h.remarcar).not.toHaveBeenCalled();
    expect(h.enviar).not.toHaveBeenCalled();
    expect(ia.chamadas).toHaveLength(0);
    expect(posseDe()).toMatchObject({ ate_wa_id: null, respostas: 0 });   // a fala continua por atender

    await new Promise(res => setTimeout(res, 800));               // o religar em voo termina: card no número novo, marcador gravado, código gasto
    expect(gerador.tabelas.agendamentos!.find(c => c.id === 1714)!.cliente_telefone).toBe(TEL);
    expect((banco.tabelas.system_state ?? []).some(l => l.key === 'quizsolar_religado:1714')).toBe(true);

    const r2 = await rodar();                                     // próxima rodada: a mesma fala
    expect(r2.enviadas).toBe(1);
    expect(h.gravar).not.toHaveBeenCalled();                      // a Duda leu o card religado: remarca, não cria
    expect(h.remarcar).toHaveBeenCalledTimes(1);
    expect(h.remarcar.mock.calls[0]![0]).toBe(1714);
    expect(gerador.tabelas.agendamentos).toHaveLength(1);
  }, 20_000);
});
