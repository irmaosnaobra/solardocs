import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  sendHuman: vi.fn(),
  sendWhatsApp: vi.fn(),
  linhaEmCooldown: vi.fn(() => false),
}));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/anthropicClient', () => ({ novoAnthropic: () => ({ messages: { create: h.create } }) }));
vi.mock('../services/agents/zapiClient', () => ({
  fmtPhone: (p: string) => p,
  sendHuman: h.sendHuman,
  sendImage: vi.fn(),
  sendWhatsApp: h.sendWhatsApp,
  linhaEmCooldown: h.linhaEmCooldown,
}));
vi.mock('../utils/ofertaCupom', () => ({ ofertaCupomAtiva: async () => null, bolhasOferta: () => [] }));
vi.mock('../utils/pixInfo', () => ({ pixBlocoWhatsApp: () => '' }));
vi.mock('../utils/pixBrCode', () => ({ gerarPixCopiaECola: () => '00020126PIXFALSO' }));
vi.mock('../services/agents/whatsapp/promoGeradorActivation', () => ({
  detectAndActivatePromoCredits: async () => ({ ativado: false, ja_ativado_antes: false }),
}));
vi.mock('../services/io/encaminharMidiaConsultor', () => ({ encaminharMidiaAoConsultor: vi.fn() }));

import { banco } from './_bancoFalso';
import { handleIncomingWhatsApp, processMessageQueue } from '../services/agents/whatsapp/whatsappAgentService';
import { GIOVANNA_TOOLS } from '../services/agents/whatsapp/giovannaFerramentas';

// ═══════════════════════════════════════════════════════════════════════════
// A Giovanna com ferramentas: o laço de tool_use, a pausa humana e a resposta
// fixa quando a IA cai. Anthropic, Z-API e banco são todos falsos.
// ═══════════════════════════════════════════════════════════════════════════

const texto = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const usa = (id: string, name: string, input: unknown) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'text', text: 'vou conferir' }, { type: 'tool_use', id, name, input }],
});

const PHONE = '5534998364589';
const CREDITO = 'Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';

function semearUsuario(whatsapp = PHONE, id = 'user-1', email = 'joao@x.com') {
  banco.poe('users', { id, email, plano: 'ilimitado', billing_status: null, whatsapp });
  banco.poe('company', { user_id: id, nome: 'ACME LTDA', nome_fantasia: 'Acme', cnpj: '11.222.333/0001-81', endereco: 'Rua A', cidade: 'Uberlândia' });
}

const fila = (id = 'fila-77', criadaEm: string | null = new Date().toISOString()) => ({ id, criadaEm });
const enviosDoDono = () => h.sendWhatsApp.mock.calls.filter(c => c[0] === '34991360223').map(c => String(c[1]));

beforeEach(() => {
  banco.reset();
  h.create.mockReset();
  h.sendHuman.mockReset().mockResolvedValue(undefined);
  h.sendWhatsApp.mockReset().mockResolvedValue(undefined);
  h.linhaEmCooldown.mockReset().mockReturnValue(false);
});

describe('laço de ferramentas', () => {
  it('tool_use, depois tool_result, depois o texto final: só o texto final vai para a cliente e para a sessão', async () => {
    semearUsuario();
    h.create
      .mockResolvedValueOnce(usa('t1', 'ver_minha_conta', {}))
      .mockResolvedValueOnce(texto('Sua empresa é a ACME.||Mais alguma coisa?'));

    await handleIncomingWhatsApp(PHONE, 'qual é a minha empresa?', 'Joao', undefined, undefined, 'solardoc', fila());

    expect(h.create).toHaveBeenCalledTimes(2);
    const primeira = h.create.mock.calls[0]![0];
    expect(primeira).toMatchObject({ model: 'claude-sonnet-4-6', max_tokens: 1024, tools: GIOVANNA_TOOLS });
    expect(primeira.tool_choice).toBeUndefined();

    // 2ª chamada: o assistant com o tool_use e o user com o tool_result do que a ferramenta devolveu.
    const msgs = h.create.mock.calls[1]![0].messages;
    const penultima = msgs[msgs.length - 2];
    const ultima = msgs[msgs.length - 1];
    expect(penultima.role).toBe('assistant');
    expect(penultima.content.some((b: any) => b.type === 'tool_use' && b.id === 't1')).toBe(true);
    expect(ultima.role).toBe('user');
    expect(ultima.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(JSON.parse(ultima.content[0].content)).toMatchObject({ ok: true, empresa: { razao_social: 'ACME LTDA' } });

    // Para a cliente: só o texto final, em até 2 bolhas, uma resposta por mensagem.
    expect(h.sendHuman).toHaveBeenCalledTimes(1);
    expect(h.sendHuman.mock.calls[0]![1]).toEqual(['Sua empresa é a ACME.', 'Mais alguma coisa?']);

    // A sessão guarda a pergunta e o texto final, e mais nada (nada de bloco de ferramenta).
    const sessao = banco.linhas('whatsapp_sessions')[0]!;
    expect(sessao.messages).toEqual([
      { role: 'user', content: 'qual é a minha empresa?' },
      { role: 'assistant', content: 'Sua empresa é a ACME.||Mais alguma coisa?' },
    ]);
    expect(JSON.stringify(sessao.messages)).not.toContain('tool_use');
  });

  it('[HUMANO] no texto final continua abrindo o chamado e avisando o Thiago, e a tag não vaza', async () => {
    semearUsuario();
    h.create
      .mockResolvedValueOnce(usa('t1', 'ver_erros_recentes', {}))
      .mockResolvedValueOnce(texto('Vou acionar o time para você. [HUMANO]'));

    await handleIncomingWhatsApp(PHONE, 'não consigo gerar proposta', 'Joao', undefined, undefined, 'solardoc', fila());

    expect(h.sendHuman.mock.calls[0]![1].join(' ')).not.toContain('[HUMANO]');
    const chamados = banco.linhas('tech_issues');
    expect(chamados).toHaveLength(1);
    expect(chamados[0]).toMatchObject({ phone: PHONE, area: 'atendimento_giovanna', status: 'aberto' });
    const avisos = enviosDoDono();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('Suporte SolarDoc');
    expect(avisos[0]).toContain('não consigo gerar proposta');
  });

  it('abrir_chamado pela ferramenta usa a mesma escalada, com diagnóstico, e [HUMANO] logo depois não abre um segundo', async () => {
    semearUsuario();
    h.create
      .mockResolvedValueOnce(usa('t1', 'abrir_chamado', { area: 'leitura_conta', descricao: 'não lê a conta de luz', diagnostico: 'ia_fora=true, 3 erros em 1h' }))
      .mockResolvedValueOnce(texto('Abri um chamado. [HUMANO]'));

    await handleIncomingWhatsApp(PHONE, 'Falha ao ler a conta', 'Joao', undefined, undefined, 'solardoc', fila());

    const chamados = banco.linhas('tech_issues');
    expect(chamados).toHaveLength(1);
    expect(chamados[0]).toMatchObject({ area: 'leitura_conta', diagnostico_automatico: 'ia_fora=true, 3 erros em 1h', status: 'aberto' });
    expect(enviosDoDono()).toHaveLength(1);
    expect(enviosDoDono()[0]).toContain('Diagnóstico: ia_fora=true, 3 erros em 1h');
  });

  it('o Pix continua saindo pela tag do texto final', async () => {
    semearUsuario();
    h.create.mockResolvedValueOnce(texto('Claro, segue o Pix. [[ENVIAR_PIX]]'));
    await handleIncomingWhatsApp(PHONE, 'manda o pix', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(h.sendHuman).toHaveBeenCalledTimes(2); // as bolhas e depois o bloco do Pix
    expect(h.sendHuman.mock.calls[0]![1].join(' ')).not.toContain('ENVIAR_PIX');
  });

  it('alteração: o aviso ao dono sai uma vez, mesmo se o modelo cai depois, e o retry não avisa de novo', async () => {
    semearUsuario();
    const corpo = { campos: { cidade: 'Araguari' }, confirmado: true };

    // Turno anterior: a prévia (a confirmação só vale com uma prévia do mesmo pedido).
    h.create
      .mockResolvedValueOnce(usa('p1', 'alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }))
      .mockResolvedValueOnce(texto('Posso fazer a alteração?'));
    await handleIncomingWhatsApp(PHONE, 'muda minha cidade para Araguari', 'Joao', undefined, undefined, 'solardoc', fila('fila-76'));
    expect(enviosDoDono()).toHaveLength(0);

    // 1ª rodada: a ferramenta grava e o modelo cai na volta seguinte.
    h.create
      .mockResolvedValueOnce(usa('t1', 'alterar_dados_empresa', corpo))
      .mockRejectedValueOnce(new Error('overloaded_error 529'));
    await expect(handleIncomingWhatsApp(PHONE, 'sim, pode fazer', 'Joao', undefined, undefined, 'solardoc', fila()))
      .rejects.toThrow('overloaded');
    expect(banco.linhas('company')[0]!.cidade).toBe('Araguari');
    expect(enviosDoDono()).toHaveLength(1);
    expect(enviosDoDono()[0]).toBe([
      'Cadastro alterado pelo agente',
      'Cliente: joao@x.com',
      `Telefone: ${PHONE}`,
      'Mudou cidade: de Uberlândia para Araguari',
      'Já foi feito, não precisa aprovar.',
      'O valor antigo ficou guardado no chamado para desfazer.',
    ].join('\n'));

    // 2ª rodada (retry da fila, mesma mensagem): tudo roda de novo, nada muda nem avisa.
    h.create
      .mockResolvedValueOnce(usa('t2', 'alterar_dados_empresa', corpo))
      .mockResolvedValueOnce(texto('Pronto, alterei a cidade.'));
    await handleIncomingWhatsApp(PHONE, 'sim, pode fazer', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(enviosDoDono()).toHaveLength(1);
    expect(banco.linhas('tech_issues').filter(t => t.area === 'alteracao_cadastro')).toHaveLength(1);
    expect(h.sendHuman).toHaveBeenCalledTimes(2); // a pergunta da prévia e a resposta final do retry
  });

  it('teto de 4 voltas: a 5ª chamada vai sem ferramentas; sem texto, responde curto e chama o time', async () => {
    semearUsuario();
    h.create.mockImplementation(async () => usa('tx', 'ver_minha_conta', {}));
    await handleIncomingWhatsApp(PHONE, 'oi', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(h.create).toHaveBeenCalledTimes(5);
    expect(h.create.mock.calls[4]![0].tool_choice).toEqual({ type: 'none' });
    expect(h.create.mock.calls[3]![0].tool_choice).toBeUndefined();
    expect(h.sendHuman).toHaveBeenCalledTimes(1);
    expect(banco.linhas('tech_issues')).toHaveLength(1);
  });

  it('o texto final vem do bloco de texto, e não do content[0]', async () => {
    semearUsuario();
    h.create.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'Resposta.' }] });
    await handleIncomingWhatsApp(PHONE, 'oi', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(h.sendHuman.mock.calls[0]![1]).toEqual(['Resposta.']);
  });
});

describe('variantes do telefone na guarda de duas contas (item 2)', () => {
  const resultadoDaFerramenta = () => {
    const msgs = h.create.mock.calls[1]![0].messages;
    return JSON.parse(msgs[msgs.length - 1].content[0].content);
  };

  it('mensagem COM o 9 e a outra conta cadastrada SEM o 9: a escrita recusa (antes só o 9 era acrescentado, nunca tirado)', async () => {
    semearUsuario('5534998364589', 'u-com9', 'com9@x.com');
    semearUsuario('553498364589', 'u-sem9', 'sem9@x.com');
    h.create
      .mockResolvedValueOnce(usa('t1', 'alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }))
      .mockResolvedValueOnce(texto('Não consigo alterar por aqui.'));
    await handleIncomingWhatsApp('5534998364589', 'muda minha cidade', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(resultadoDaFerramenta()).toMatchObject({ ok: false, motivo: 'telefone_em_mais_de_uma_conta' });
  });

  it('mensagem SEM o 9 e a outra conta cadastrada COM o 9: também recusa', async () => {
    semearUsuario('5534998364589', 'u-com9', 'com9@x.com');
    semearUsuario('553498364589', 'u-sem9', 'sem9@x.com');
    h.create
      .mockResolvedValueOnce(usa('t1', 'alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }))
      .mockResolvedValueOnce(texto('Não consigo alterar por aqui.'));
    await handleIncomingWhatsApp('553498364589', 'muda minha cidade', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(resultadoDaFerramenta()).toMatchObject({ ok: false, motivo: 'telefone_em_mais_de_uma_conta' });
  });

  it('uma conta só continua podendo alterar', async () => {
    semearUsuario('553498364589', 'u-sem9', 'sem9@x.com');
    h.create
      .mockResolvedValueOnce(usa('t1', 'alterar_dados_empresa', { campos: { cidade: 'Araguari' }, confirmado: false }))
      .mockResolvedValueOnce(texto('Posso fazer a alteração?'));
    await handleIncomingWhatsApp('553498364589', 'muda minha cidade', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(resultadoDaFerramenta()).toMatchObject({ ok: true, previa: true });
  });
});

describe('pausa humana', () => {
  it('conversa com humano dentro: a Giovanna não chama o modelo, não responde e não lança', async () => {
    semearUsuario();
    banco.poe('atendimento_pausa', {
      chave: '3498364589', telefone: PHONE, quem: 'Diego', liberado_em: null,
      ultima_fala_humano: new Date(Date.now() - 3_600_000).toISOString(), ultima_fala_lead: null,
    });
    await expect(handleIncomingWhatsApp(PHONE, 'oi, alguém aí?', 'Joao', undefined, undefined, 'solardoc', fila())).resolves.toBeUndefined();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.sendHuman).not.toHaveBeenCalled();
    expect(banco.linhas('tech_issues')).toHaveLength(0);
  });

  it('pausa que esfriou (mais de 24 h) não segura', async () => {
    semearUsuario();
    banco.poe('atendimento_pausa', {
      chave: '3498364589', telefone: PHONE, quem: 'Diego', liberado_em: null,
      ultima_fala_humano: new Date(Date.now() - 30 * 3_600_000).toISOString(), ultima_fala_lead: null,
    });
    h.create.mockResolvedValueOnce(texto('Oi!'));
    await handleIncomingWhatsApp(PHONE, 'oi', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(h.create).toHaveBeenCalledTimes(1);
  });

  it('o opt-out vale mesmo com a pausa: ele sai da lista antes de a pausa ser conferida', async () => {
    semearUsuario();
    banco.poe('atendimento_pausa', {
      chave: '3498364589', telefone: PHONE, quem: 'Diego', liberado_em: null,
      ultima_fala_humano: new Date(Date.now() - 3_600_000).toISOString(), ultima_fala_lead: null,
    });
    await handleIncomingWhatsApp(PHONE, 'me descadastra por favor', 'Joao', undefined, undefined, 'solardoc', fila());
    expect(h.sendHuman).toHaveBeenCalledTimes(1);
    expect(h.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SONDA DO ANTI-BAN: a IA sem crédito, 10 mensagens de 8 telefones, 2 deles na
// variante do 9º dígito. Tudo passa pela fila de verdade (message_queue), com
// retry e 2º tick, e o relógio é falso.
// ═══════════════════════════════════════════════════════════════════════════

const T0 = new Date('2026-10-19T17:00:00Z'); // 14h em Brasília
const MIN = 60_000;

describe('resposta fixa quando a IA cai (sonda do anti-ban)', () => {
  const PLANOS = [
    '5534991000001', '5534991000002', '5534991000003', '5534991000004', '5534991000005', '5534991000006',
    '5534998360007', '5534998360008', // G e H: o cadastro tem o 9
  ];
  // A fila entrega G e H às vezes SEM o 9º dígito; 10 mensagens, 8 telefones.
  const FILA_TELEFONES = [
    PLANOS[0]!, PLANOS[1]!, PLANOS[2]!, PLANOS[3]!, PLANOS[4]!, PLANOS[5]!,
    '5534998360007', '553498360008', '553498360007', '5534998360008',
  ];
  const chave = (tel: string) => { const d = tel.replace(/\D/g, ''); const s = d.startsWith('55') ? d.slice(2) : d; return s.slice(0, 2) + s.slice(-8); };

  let envios: Array<{ chave: string; em: number; textoEnviado: string }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    envios = [];
    h.sendHuman.mockImplementation(async (phone: string, parts: string[]) => {
      envios.push({ chave: chave(phone), em: Date.now(), textoEnviado: parts.join('\n') });
    });
    h.create.mockRejectedValue(new Error(CREDITO));
    PLANOS.forEach((tel, i) => semearUsuario(tel, `u-${i}`, `u${i}@x.com`));
    FILA_TELEFONES.forEach((tel, i) => {
      banco.poe('message_queue', {
        id: i + 1, phone: tel, text: 'oi, preciso de ajuda', sender_name: 'Fulano', processed: false, instance_id: null,
        created_at: new Date(Date.now() - (FILA_TELEFONES.length - i) * 1000).toISOString(),
      });
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  /** Roda um tick até acabar, avançando o relógio falso aos poucos. */
  async function tick() {
    let acabou = false;
    const p = processMessageQueue().finally(() => { acabou = true; });
    for (let i = 0; i < 400 && !acabou; i++) await vi.advanceTimersByTimeAsync(1000);
    await p;
  }

  it('1º tick: no máximo 3 envios, 10 s ou mais entre eles, cada telefone uma vez, e o erro volta para a fila', async () => {
    await tick();
    expect(envios).toHaveLength(3);
    expect(new Set(envios.map(e => e.chave)).size).toBe(3);
    for (let i = 1; i < envios.length; i++) {
      const dt = envios[i]!.em - envios[i - 1]!.em;
      expect(dt).toBeGreaterThanOrEqual(10_000);
      expect(dt).toBeLessThanOrEqual(21_000);
    }
    expect(envios[0]!.textoEnviado).toBe([
      'Recebemos a sua mensagem.',
      'O atendimento automático está fora do ar neste momento.',
      'Vou avisar o Thiago, e ele responde por aqui assim que puder.',
    ].join('\n'));
    // Uma bolha só (maxBolhas: 1) e pela linha de origem.
    expect(h.sendHuman.mock.calls[0]![3]).toEqual({ maxBolhas: 1 });
    expect(h.sendHuman.mock.calls[0]![2]).toBe('solardoc');
    // O erro original foi relançado: nenhuma mensagem foi dada como processada, todas voltam para a fila.
    expect(banco.linhas('message_queue').every(m => m.processed === false)).toBe(true);
    expect(h.create).toHaveBeenCalledTimes(10);
  });

  it('2º tick: nenhum reenvio; só os telefones que ainda não receberam, até 3; e as variantes do 9º dígito contam como um telefone', async () => {
    await tick();
    const primeiro = envios.length;
    await vi.advanceTimersByTimeAsync(5 * MIN);
    await tick();

    expect(envios.length - primeiro).toBe(3);
    const chaves = envios.map(e => e.chave);
    expect(new Set(chaves).size).toBe(chaves.length); // ninguém recebeu duas vezes
    expect(chaves).toHaveLength(6);
  });

  it('teto de 6 em 10 min: com 6 envios dentro da janela o tick não envia nada; passada a janela, o resto sai', async () => {
    // Ticks de 1 em 1 min só para ficar tudo dentro dos 10 min (em produção são de 5 em 5).
    await tick();
    await vi.advanceTimersByTimeAsync(MIN);
    await tick();
    expect(envios).toHaveLength(6);

    await vi.advanceTimersByTimeAsync(MIN);
    const antes = envios.length;
    await tick();
    expect(envios.length - antes).toBe(0); // 6 reservas nos últimos 10 min

    // G e H (as variantes do 9º dígito) saem quando o 1º tick sai da janela.
    await vi.advanceTimersByTimeAsync(9 * MIN);
    await tick();
    const chaves = envios.map(e => e.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    expect(chaves).toEqual(expect.arrayContaining([chave('5534998360007'), chave('5534998360008')]));
    expect(chaves).toHaveLength(8);
  });

  it('contagem positiva: um telefone novo, depois, recebe exatamente 1', async () => {
    await tick();
    await vi.advanceTimersByTimeAsync(11 * MIN);
    banco.linhas('message_queue').forEach(m => { m.processed = true; }); // as 10 antigas já foram dadas por feitas
    const NOVO = '5534991000099';
    semearUsuario(NOVO, 'u-novo', 'novo@x.com');
    banco.poe('message_queue', { id: 99, phone: NOVO, text: 'oi', sender_name: 'Novo', processed: false, instance_id: null, created_at: new Date().toISOString() });
    await tick();
    expect(envios.filter(e => e.chave === chave(NOVO))).toHaveLength(1);
    const chaves = envios.map(e => e.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('IA fora por causa que não é crédito nem chave (Z-API, limite, desconhecida) não envia nada', async () => {
    for (const erro of ['[zapi:solardoc] HTTP 500 - falha da linha', 'rate_limit_error: 429 too many requests', 'ECONNRESET socket hang up']) {
      envios.length = 0;
      h.create.mockReset().mockRejectedValue(new Error(erro));
      banco.linhas('system_state').length = 0;
      await tick();
      expect(envios).toHaveLength(0);
    }
  });

  it('mensagem com mais de 15 min não recebe resposta fixa; com 14 min, recebe', async () => {
    banco.linhas('message_queue').forEach(m => { m.created_at = new Date(Date.now() - 20 * MIN).toISOString(); });
    await tick();
    expect(envios).toHaveLength(0);

    banco.linhas('message_queue').forEach(m => { m.created_at = new Date(Date.now() - 14 * MIN).toISOString(); m.processed = false; });
    await tick();
    expect(envios).toHaveLength(3);
  });

  it('linha em cooldown não recebe a resposta fixa', async () => {
    h.linhaEmCooldown.mockReturnValue(true);
    await tick();
    expect(envios).toHaveLength(0);
  });

  it('conversa com humano dentro: nada de modelo e nada de resposta fixa', async () => {
    PLANOS.forEach(tel => banco.poe('atendimento_pausa', {
      chave: chave(tel), telefone: tel, quem: 'Diego', liberado_em: null,
      ultima_fala_humano: new Date(Date.now() - 600_000).toISOString(), ultima_fala_lead: null,
    }));
    await tick();
    expect(h.create).not.toHaveBeenCalled();
    expect(envios).toHaveLength(0);
  });

  it('teto da emergência: 60 saídas na última hora travam a resposta fixa; 450 em 24 h também', async () => {
    const saida = (min: number) => ({ telefone: '5511900000000', from_me: true, momment: new Date(Date.now() - min * MIN).toISOString() });
    for (let i = 0; i < 60; i++) banco.poe('wa_mensagens', saida(10));
    await tick();
    expect(envios).toHaveLength(0);

    banco.linhas('wa_mensagens').length = 0;
    for (let i = 0; i < 450; i++) banco.poe('wa_mensagens', saida(180));
    await tick();
    expect(envios).toHaveLength(0);

    banco.linhas('wa_mensagens').length = 0;
    for (let i = 0; i < 59; i++) banco.poe('wa_mensagens', saida(10));
    await tick();
    expect(envios.length).toBeGreaterThan(0);
  });

  it('não lê o contador da emergência: não envia (a resposta fixa é cortesia)', async () => {
    banco.falhas['wa_mensagens.select'] = { erro: { message: 'timeout' } };
    await tick();
    expect(envios).toHaveLength(0);
  });

  it('erro ao enviar a resposta fixa não troca o erro original: a fila segue com o retry', async () => {
    h.sendHuman.mockReset().mockRejectedValue(new Error('[zapi:solardoc] HTTP 401 - sessão caída'));
    await tick();
    expect(banco.linhas('message_queue').every(m => m.processed === false)).toBe(true);
    expect(h.create).toHaveBeenCalledTimes(10);
  });

  it('chave inválida (12 h): a reserva antiga reabre, a recente não', async () => {
    const k = `giovanna_fallback:${chave(PLANOS[0]!)}`;
    banco.poe('system_state', { key: k, value: {}, updated_at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
    banco.poe('system_state', { key: `giovanna_fallback:${chave(PLANOS[1]!)}`, value: {}, updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString() });
    await tick();
    const chaves = envios.map(e => e.chave);
    expect(chaves).toContain(chave(PLANOS[0]!));
    expect(chaves).not.toContain(chave(PLANOS[1]!));
  });
});
