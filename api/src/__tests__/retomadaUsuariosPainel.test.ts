import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// O painel da retomada dos usuários (Central e rotas do sócio) e a conta de quem recebeu a mensagem (os fatos da Carla). Só leitura, sobre
// o banco em memória; a linha, a janela e as vagas são as de verdade (lineThrottle). O texto do redator e o piso do início são trocados
// para provar cada motivo de parada na ordem da tabela.

const h = vi.hoisted(() => ({ semTexto: false, piso: undefined as number | undefined }));

vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/solardoc/retomadaUsuariosRegras', async (orig) => {
  const real = await orig<typeof import('../services/solardoc/retomadaUsuariosRegras')>();
  return {
    ...real,
    textosVazios: (t?: Parameters<typeof real.textosVazios>[0]) => h.semTexto || real.textosVazios(t),
    pisoDoCodigoMs: (iso?: string) => (h.piso !== undefined ? h.piso : real.pisoDoCodigoMs(iso)),
  };
});

import { banco } from './_bancoFalso';
import { interruptores, semearAlvo } from './_agentes5040Cortes';
import { zerarCacheInterruptores } from '../services/agentes5040/interruptores';
import { lerPainelRetomada, motivoDeParadaAgora } from '../services/solardoc/retomadaUsuariosPainel';
import { lerContaDaRetomada } from '../services/solardoc/retomadaUsuariosConta';
import { hmacDe } from '../services/agentes5040/hmac';
import { chaveContato } from '../services/agents/whatsapp/silenciar';
import type { DadosPosse } from '../services/agentes5040/posse';

// Quinta-feira, 05/11/2026, 14:00 em Brasília. A largada foi na terça, 03/11, ao meio-dia: o início é a quarta, 04/11, às 9h (12:00Z).
const AGORA = new Date('2026-11-05T17:00:00.000Z');
const LARGADA = '2026-11-03T15:00:00.000Z';
const PISO = Date.parse('2026-11-04T12:00:00.000Z');
const HORA = 3_600_000;
const DIA = 24 * HORA;
const ISO = (ms: number): string => new Date(ms).toISOString();
const antes = (ms: number): string => ISO(AGORA.getTime() - ms);

beforeEach(() => {
  process.env.AGENTES5040_HMAC = 'segredo-de-teste';
  delete process.env.EP_CONFIRMA_TETO_HORA;
  h.semTexto = false; h.piso = PISO;
  banco.reset();
  interruptores({ carla: true }); zerarCacheInterruptores();
  semearAlvo([], { carla: 'todos' });
  banco.poe('system_state', { key: 'usu_rec_largada', value: { em: LARGADA }, updated_at: LARGADA });
});
afterEach(() => { interruptores({}); zerarCacheInterruptores(); });

const carimbo = (sufixo: string, valor: Record<string, unknown>, quando: string) =>
  banco.poe('system_state', { key: `usu_rec_sent:${sufixo}`, value: valor, updated_at: quando });
const sentinela = (key: string, quando: string = antes(30 * 60_000)) => banco.poe('system_state', { key, value: {}, updated_at: quando });

describe('lerPainelRetomada: os números', () => {
  it('conta só o que foi (ou pode ter sido) enviado, por dia de Brasília, 24 h, 7 dias e total; a chave da sonda 1 fica de fora', async () => {
    carimbo('a', { estado: 'enviado', user_id: 'u1', em: antes(2 * HORA) }, antes(2 * HORA));          // hoje
    carimbo('b', { estado: 'incerto', user_id: 'u2', em: antes(30 * HORA) }, antes(30 * HORA));         // ontem
    carimbo('c', { estado: 'enviado', user_id: 'u3', em: antes(6 * DIA) }, antes(6 * DIA));             // nos 7 dias
    carimbo('d', { estado: 'nao_saiu', user_id: 'u4', em: antes(HORA) }, antes(HORA));                  // não saiu
    carimbo('e', { estado: 'destino', user_id: 'u5', em: antes(HORA) }, antes(HORA));                   // número ruim
    carimbo('f', { estado: 'reservado', user_id: 'u6', em: antes(HORA) }, antes(HORA));                 // ainda não foi
    carimbo('sonda:2026-11-04T23:00:00.000Z', { sonda: true }, antes(HORA));                            // a sonda 1: sem estado e sem user_id
    carimbo('sem-user', { estado: 'enviado' }, antes(HORA));                                            // sem user_id: ignorado
    const p = await lerPainelRetomada(AGORA);
    expect(p).toMatchObject({ enviadas_hoje: 1, enviadas_24h: 1, enviadas_7d: 3, enviadas_total: 3, ultima: antes(2 * HORA) });
  });

  it('o dia é o de Brasília: um envio às 23h de ontem em Brasília não é de hoje', async () => {
    carimbo('a', { estado: 'enviado', user_id: 'u1', em: '2026-11-05T02:30:00.000Z' }, '2026-11-05T02:30:00.000Z');    // 4/11 às 23h30 BRT
    carimbo('b', { estado: 'enviado', user_id: 'u2', em: '2026-11-05T12:00:00.000Z' }, '2026-11-05T12:00:00.000Z');    // 5/11 às 9h BRT
    const p = await lerPainelRetomada(AGORA);
    expect(p.enviadas_hoje).toBe(1);
    expect(p.enviadas_24h).toBe(2);
  });

  it('voltaram a assinar: os user_id dos carimbos `enviado` cujo plano hoje não é free; a sonda e o `incerto` não entram', async () => {
    banco.poe('users', { id: 'u1', plano: 'ilimitado' }, { id: 'u2', plano: 'free' }, { id: 'u3', plano: 'pro' }, { id: 'u4', plano: 'ilimitado' });
    carimbo('a', { estado: 'enviado', user_id: 'u1' }, antes(HORA));
    carimbo('b', { estado: 'enviado', user_id: 'u2' }, antes(HORA));
    carimbo('c', { estado: 'enviado', user_id: 'u3' }, antes(HORA));
    carimbo('d', { estado: 'incerto', user_id: 'u4' }, antes(HORA));
    carimbo('sonda:x', { sonda: true }, antes(HORA));
    expect((await lerPainelRetomada(AGORA)).voltaram_a_assinar).toBe(2);
  });

  it('responderam e pararam saem das posses da retomada (e só delas)', async () => {
    const posse = (tipo: string, lead: Record<string, unknown>, phone: string) => banco.poe('whatsapp_sessions', { phone, tipo, lead_data: lead });
    const base = { dona: 'carla', desde: antes(DIA), respostas: 0, imagens: [], links: [], origem: 'retomada_usuarios' };
    posse('ag5040', { ...base, estado: 'viva', ate_wa_id: null }, '1111111111');            // só recebeu: não respondeu
    posse('ag5040', { ...base, estado: 'viva', ate_wa_id: 5 }, '2222222222');               // respondeu
    posse('ag5040', { ...base, estado: 'nao_incomodar', ate_wa_id: 7 }, '3333333333');      // respondeu e pediu para parar
    posse('ag5040', { ...base, estado: 'passou_humano', ate_wa_id: null }, '4444444444');   // virou conversa de gente: conta como respondeu
    posse('ag5040', { ...base, origem: 'outra', estado: 'viva', ate_wa_id: 9 }, '5555555555');   // de outra origem
    posse('platform', { ...base, estado: 'viva', ate_wa_id: 9 }, '6666666666');             // de outro tipo
    const p = await lerPainelRetomada(AGORA);
    expect(p.responderam).toBe(3);
    expect(p.pararam).toBe(1);
  });

  it('pararam soma as posses nao_incomodar e quem foi silenciado no corte da Giovanna (opt-out na conta), sem contar a mesma pessoa duas vezes', async () => {
    const base = { dona: 'carla', desde: antes(DIA), respostas: 0, imagens: [], links: [], origem: 'retomada_usuarios' };
    const posse = (lead: Record<string, unknown>, phone: string) => banco.poe('whatsapp_sessions', { phone, tipo: 'ag5040', lead_data: { ...base, ...lead } });
    banco.poe('users',
      { id: 'u1', plano: 'free', whatsapp_opt_out: true },      // pediu para parar na Carla e foi silenciado: uma pessoa só
      { id: 'u2', plano: 'free', whatsapp_opt_out: true },      // silenciado no corte da Giovanna, posse ainda viva
      { id: 'u3', plano: 'free', whatsapp_opt_out: false },     // nao_incomodar sem opt-out gravado
      { id: 'u4', plano: 'free', whatsapp_opt_out: true },      // incerto e silenciado: também conta
      { id: 'u5', plano: 'free', whatsapp_opt_out: false });    // seguiu na conversa
    for (const [suf, est, uid] of [['a', 'enviado', 'u1'], ['b', 'enviado', 'u2'], ['c', 'enviado', 'u3'], ['d', 'incerto', 'u4'], ['e', 'enviado', 'u5']] as const) {
      carimbo(suf, { estado: est, user_id: uid }, antes(HORA));
    }
    posse({ estado: 'nao_incomodar', ate_wa_id: 7, retomada: { user_id: 'u1' } }, '1111111111');
    posse({ estado: 'viva', ate_wa_id: 8, retomada: { user_id: 'u2' } }, '2222222222');
    posse({ estado: 'nao_incomodar', ate_wa_id: 9, retomada: { user_id: 'u3' } }, '3333333333');
    posse({ estado: 'viva', ate_wa_id: 10, retomada: { user_id: 'u5' } }, '5555555555');
    posse({ estado: 'nao_incomodar', ate_wa_id: 11 }, '6666666666');            // posse sem user_id: conta sozinha
    const p = await lerPainelRetomada(AGORA);
    expect(p.pararam).toBe(5);                                                   // u1, u2, u3, u4 e a posse sem user_id
    expect(p.voltaram_a_assinar).toBe(0);
  });

  it('pararam sai null quando a leitura das contas falha (o silenciado não dá para contar), e o voltaram também', async () => {
    banco.poe('users', { id: 'u1', plano: 'free', whatsapp_opt_out: true });
    carimbo('a', { estado: 'enviado', user_id: 'u1' }, antes(HORA));
    banco.poe('whatsapp_sessions', { phone: '1111111111', tipo: 'ag5040', lead_data: { dona: 'carla', estado: 'nao_incomodar', origem: 'retomada_usuarios', retomada: { user_id: 'u1' } } });
    banco.falhas['users.select'] = { erro: { code: '57014', message: 'timeout' } };
    const p = await lerPainelRetomada(AGORA);
    expect(p.pararam).toBeNull();
    expect(p.voltaram_a_assinar).toBeNull();
  });

  it('a fila e a hora em que foi lida vêm do resumo; sem resumo, null', async () => {
    expect((await lerPainelRetomada(AGORA)).fila).toBeNull();
    banco.poe('system_state', { key: 'usu_rec_resumo', value: { em: antes(5 * 60_000), fila: 41, por_motivo: { paga_hoje: 9 } }, updated_at: antes(5 * 60_000) });
    expect(await lerPainelRetomada(AGORA)).toMatchObject({ fila: 41, fila_lida_em: antes(5 * 60_000) });
  });

  it('a linha na hora (0 a 5) e o limite da agenda; o limite aperta com a env do teto da confirmação', async () => {
    sentinela('ep_agenda_sent:1'); sentinela('usu_rec_sent:z'); sentinela('quiz_rec_sent:y');
    const p = await lerPainelRetomada(AGORA);
    expect(p).toMatchObject({ linha_na_hora: 3, linha_limite: 4 });
    process.env.EP_CONFIRMA_TETO_HORA = '5';
    expect((await lerPainelRetomada(AGORA)).linha_limite).toBe(3);
    delete process.env.EP_CONFIRMA_TETO_HORA;
  });

  it('o estado, a pausa (com o motivo e quem pediu) e o início efetivo', async () => {
    let p = await lerPainelRetomada(AGORA);
    expect(p.estado).toEqual({ ligada: true, motivo: 'ligada' });
    expect(p.pausa).toBeNull();
    expect(p.inicio).toBe(ISO(PISO));
    banco.poe('system_state', { key: 'usu_rec_pausa', value: { em: antes(HORA), motivo: 'dois_erros_de_linha', n: 2 }, updated_at: antes(HORA) });
    p = await lerPainelRetomada(AGORA);
    expect(p.estado).toEqual({ ligada: false, motivo: 'pausa_no_banco' });
    expect(p.pausa).toMatchObject({ motivo: 'dois_erros_de_linha', n: 2 });
  });

  it('campo que não deu para ler vai como null, nunca como um zero inventado', async () => {
    banco.falhas['system_state.select'] = { erro: { message: 'caiu' } };
    const p = await lerPainelRetomada(AGORA);
    expect(p.enviadas_hoje).toBeNull();
    expect(p.enviadas_total).toBeNull();
    expect(p.voltaram_a_assinar).toBeNull();
    expect(p.fila).toBeNull();
    expect(p.linha_na_hora).toBeNull();
    expect(p.estado).toEqual({ ligada: false, motivo: 'leitura_falhou' });
    expect(p.parada).toMatchObject({ motivo: 'leitura_falhou', bloqueio: true });
  });

  it('o painel não leva telefone nem e-mail', async () => {
    banco.poe('users', { id: 'u1', plano: 'ilimitado', email: 'ana@exemplo.com', whatsapp: '5534998100001' });
    carimbo('a', { estado: 'enviado', user_id: 'u1', em: antes(HORA) }, antes(HORA));
    const texto = JSON.stringify(await lerPainelRetomada(AGORA));
    expect(texto).not.toMatch(/ana@exemplo/);
    expect(texto).not.toMatch(/\d{10,}/);
  });
});

describe('motivoDeParadaAgora: só leitura, na ordem da tabela', () => {
  const parada = async (quando: Date = AGORA) => (await motivoDeParadaAgora(quando))?.motivo ?? null;
  const cheiaDe = (prefixo: string, n: number, quandoMs: number) => { for (let i = 0; i < n; i++) sentinela(`${prefixo}${i}`, ISO(quandoMs)); };

  it('com tudo certo não há o que dizer', async () => {
    expect(await motivoDeParadaAgora(AGORA)).toBeNull();
  });

  it('cada motivo aparece, e o anterior da lista tem prioridade', async () => {
    // de baixo para cima: monta o cenário que acende o último e vai desfazendo na ordem da tabela
    cheiaDe('ep_agenda_sent:', 4, AGORA.getTime() - 20 * 60_000);
    expect(await parada()).toBe('cede_a_agenda');
    expect((await motivoDeParadaAgora(AGORA))?.bloqueio).toBe(false);

    cheiaDe('quiz_rec_sent:', 6, AGORA.getTime() - 20 * 60_000);
    expect(await parada()).toBe('teto_da_linha');

    banco.linhas('system_state').length = 0;
    banco.poe('system_state', { key: 'usu_rec_largada', value: { em: LARGADA }, updated_at: LARGADA });
    for (let i = 0; i < 25; i++) sentinela(`usu_rec_sent:x${i}`, antes(3 * HORA));
    expect(await parada()).toBe('teto_da_campanha');

    banco.linhas('system_state').length = 0;
    banco.poe('system_state', { key: 'usu_rec_largada', value: { em: LARGADA }, updated_at: LARGADA });
    expect(await parada(new Date('2026-11-08T17:00:00.000Z'))).toBe('fora_da_janela');        // domingo
    expect(await parada(new Date('2026-11-05T23:30:00.000Z'))).toBe('fora_da_janela');        // 20h30

    h.piso = AGORA.getTime() + 2 * DIA + 0;                                                    // piso depois de agora: ainda não começou
    const antesDoInicio = await motivoDeParadaAgora(AGORA);
    expect(antesDoInicio).toMatchObject({ motivo: 'antes_do_inicio', bloqueio: false });
    expect(antesDoInicio?.texto).toMatch(/^Começa em \d\d\/\d\d às \d+h/);

    h.piso = NaN;
    expect(await motivoDeParadaAgora(AGORA)).toMatchObject({ motivo: 'sem_data_de_inicio', bloqueio: true, texto: 'Sem data de início: não envia' });
    h.piso = PISO;

    banco.poe('system_state', { key: 'ag5040_linha_pausa', value: { ate: ISO(AGORA.getTime() + 60_000) }, updated_at: antes(60_000) });
    expect(await motivoDeParadaAgora(AGORA)).toMatchObject({ motivo: 'linha_pausada', bloqueio: true });

    banco.poe('system_state', { key: 'ag5040_disjuntor', value: { ate: ISO(AGORA.getTime() + 60_000) }, updated_at: antes(60_000) });
    expect(await motivoDeParadaAgora(AGORA)).toMatchObject({ motivo: 'ia_parada', bloqueio: true });

    banco.tabelas['system_state'] = banco.linhas('system_state').filter(l => l.key !== 'ag5040_vivo_alvo');
    semearAlvo([], { carla: 'teste' }); zerarCacheInterruptores();
    expect(await motivoDeParadaAgora(AGORA)).toMatchObject({ motivo: 'carla_nao_atende_todos', bloqueio: true });

    h.semTexto = true;
    expect(await motivoDeParadaAgora(AGORA)).toMatchObject({ motivo: 'sem_texto', bloqueio: true, texto: 'Sem o texto do redator: não envia' });
  });

  it('o espaçamento nunca aparece como parada: um envio há 5 minutos não é motivo para dizer que está parado', async () => {
    carimbo('a', { estado: 'enviado', user_id: 'u1', em: antes(5 * 60_000) }, antes(5 * 60_000));
    expect(await motivoDeParadaAgora(AGORA)).toBeNull();
  });

  it('leitura que falha vira leitura_falhou com bloqueio', async () => {
    banco.falhas['system_state.select'] = { erro: { message: 'caiu' } };
    expect(await motivoDeParadaAgora(AGORA)).toMatchObject({ motivo: 'leitura_falhou', bloqueio: true });
  });

  it('a largada ausente vale "agora": o 1º dia de janela depois de hoje', async () => {
    banco.reset(); interruptores({ carla: true }); semearAlvo([], { carla: 'todos' }); zerarCacheInterruptores();
    h.piso = 0;
    const p = await motivoDeParadaAgora(AGORA);
    expect(p).toMatchObject({ motivo: 'antes_do_inicio', texto: 'Começa em 06/11 às 9h' });
  });
});

// ── a conta de quem recebeu a retomada ───────────────────────────────────────

describe('lerContaDaRetomada (os fatos da Carla)', () => {
  const TEL = '5534998100001';
  const CHAVE = chaveContato(TEL)!;
  const ENVIO = '2026-11-04T12:30:00.000Z';

  const posse = (over: Record<string, unknown> = {}): DadosPosse => ({
    dona: 'carla', estado: 'viva', desde: ENVIO, ate_wa_id: null, respostas: 0, imagens: [], links: [], origem: 'retomada_usuarios',
    retomada: { user_id: 'u1', segmento: 'ex_assinante', grupo: 'incerto', variacao: 0, primeiro_nome: 'Ana', texto: 'Oi, Ana. Quer ver?', em: ENVIO, ate: '2026-12-04T12:30:00.000Z' },
    ...over,
  });
  const semear = (user: Record<string, unknown> = {}) => banco.poe('users', {
    id: 'u1', email: 'Ana@Exemplo.com', whatsapp: TEL, plano: 'free', billing_status: null, plano_expira_em: null, created_at: '2026-06-10T12:00:00.000Z',
    last_canceled_at: '2026-09-02T12:00:00.000Z', ...user,
  });

  it('ex-assinante com venda paga: grupo pagou, saiu em, forma do cartão, último documento sem as 3 h de adianto e CNPJ', async () => {
    semear();
    banco.poe('sales', { email: 'ana@exemplo.com', valor: 67, status: 'paid' });
    banco.poe('documents', { user_id: 'u1', created_at: '2026-10-20T18:00:00.000Z' }, { user_id: 'u1', created_at: '2026-10-10T18:00:00.000Z' });
    banco.poe('company', { user_id: 'u1', cnpj: '11.222.333/0001-81' });
    const c = await lerContaDaRetomada(posse(), CHAVE, AGORA);
    expect(c).toEqual({
      user_id: 'u1', plano: 'free', segmento: 'ex_assinante', grupo: 'pagou', criada_em: '2026-06-10T12:00:00.000Z', saiu_em: '2026-09-02T12:00:00.000Z',
      forma_antiga: 'cartao', ultimo_documento_em: '2026-10-20T15:00:00.000Z', tem_cnpj: true, email_mascarado: 'a***@exemplo.com', primeiro_nome: 'Ana', texto_enviado: 'Oi, Ana. Quer ver?', enviado_em: ENVIO,
    });
  });

  it('sem venda paga o grupo é incerto, e a data de saída não vem do updated_at da venda', async () => {
    semear({ last_canceled_at: null, plano_expira_em: '2026-08-01T12:00:00.000Z' });
    banco.poe('sales', { email: 'ana@exemplo.com', valor: 67, status: 'trialing', updated_at: antes(60_000) });
    const c = await lerContaDaRetomada(posse(), CHAVE, AGORA);
    expect(c).toMatchObject({ segmento: 'ex_assinante', grupo: 'incerto', saiu_em: '2026-08-01T12:00:00.000Z', forma_antiga: 'pix' });
  });

  it('a situação é RELIDA a cada turno: a venda que passa a paid muda o grupo, e voltar a assinar muda o plano', async () => {
    semear();
    banco.poe('sales', { email: 'ana@exemplo.com', valor: 67, status: 'trialing' });
    expect((await lerContaDaRetomada(posse(), CHAVE, AGORA)).grupo).toBe('incerto');
    banco.linhas('sales')[0]!.status = 'paid';
    expect((await lerContaDaRetomada(posse(), CHAVE, AGORA)).grupo).toBe('pagou');
    banco.linhas('users')[0]!.plano = 'ilimitado';
    expect((await lerContaDaRetomada(posse(), CHAVE, AGORA)).plano).toBe('ilimitado');
  });

  it('grátis que nunca pagou, com ou sem documento recente', async () => {
    semear({ last_canceled_at: null });
    banco.poe('documents', { user_id: 'u1', created_at: ISO(AGORA.getTime() - 10 * DIA) });
    expect(await lerContaDaRetomada(posse(), CHAVE, AGORA)).toMatchObject({ segmento: 'gratis_ativo', grupo: 'nunca_pagou', saiu_em: null, forma_antiga: null, tem_cnpj: false });
    banco.reset(); semear({ last_canceled_at: null });
    expect(await lerContaDaRetomada(posse(), CHAVE, AGORA)).toMatchObject({ segmento: 'gratis', grupo: 'nunca_pagou', ultimo_documento_em: null });
  });

  it('a conta leva o e-mail com o meio coberto (nunca inteiro), para a Carla dizer qual e-mail usar no Pix automático', async () => {
    semear({ last_canceled_at: null });
    const c = await lerContaDaRetomada(posse(), CHAVE, AGORA);
    expect(typeof c.email_mascarado === 'string' ? c.email_mascarado : '').toMatch(/^[^@*]{1,2}\*\*\*@[^@]+\.[^@]+$/);
    expect(JSON.stringify(c)).not.toMatch(/ana@exemplo\.com/);
  });

  it('erro LANÇA: conta que não existe, telefone que não casa com a conversa, posse sem user_id e leitura que falha', async () => {
    await expect(lerContaDaRetomada(posse(), CHAVE, AGORA)).rejects.toThrow('conta_nao_existe');
    semear({ whatsapp: '5511999990000' });
    await expect(lerContaDaRetomada(posse(), CHAVE, AGORA)).rejects.toThrow('conta_nao_casa');
    banco.reset(); semear();
    await expect(lerContaDaRetomada(posse({ retomada: {} }), CHAVE, AGORA)).rejects.toThrow('conta_sem_user_id');
    banco.falhas['users.select'] = { erro: { message: 'caiu' } };
    await expect(lerContaDaRetomada(posse(), CHAVE, AGORA)).rejects.toThrow('ler_a_conta');
    delete banco.falhas['users.select'];
    banco.falhas['sales.select'] = { erro: { message: 'caiu' } };
    await expect(lerContaDaRetomada(posse(), CHAVE, AGORA)).rejects.toThrow('ler_a_situacao');
  });

  it('não leva telefone nem e-mail', async () => {
    semear();
    const texto = JSON.stringify(await lerContaDaRetomada(posse(), CHAVE, AGORA));
    expect(texto).not.toMatch(/ana@|Ana@/);
    expect(texto).toContain('a***@exemplo.com');
    expect(texto).not.toMatch(/\d{10,}/);
    expect(texto).not.toContain(hmacDe(CHAVE)!);
  });
});
