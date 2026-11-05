import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { BancoFalso } from './bancoFalsoQuiz';

// Ligar e desligar as mensagens da Jornada e a SONDA (fase 3), só o ADM; o link público de indicação (não manda mensagem, com teto contado no banco);
// e o `venda_completa` gravado uma vez só. Login e bancos FALSOS; a Z-API reprova qualquer chamada.

const h = vi.hoisted(() => ({ main: null as any, ger: null as any, privado: null as any, usuarios: {} as Record<string, string>, zapi: vi.fn(), slot: 0 }));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: { getUser: vi.fn(async (token: string) => {
      const email = h.usuarios[token];
      return email ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null } : { data: { user: null }, error: { message: 'jwt' } };
    }) },
    from: (t: string) => h.ger.from(t),
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../middleware/indicacaoRateLimit', () => ({ indicacaoRateLimit: (_q: unknown, _r: unknown, n: () => void) => n() }));
vi.mock('../services/agents/zapiClient', async (orig) => ({
  ...(await orig<typeof import('../services/agents/zapiClient')>()),
  sendWhatsApp: h.zapi, sendDocument: h.zapi, sendFrio: h.zapi, sendImage: h.zapi, zapiPost: h.zapi,
}));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  estaBloqueado: vi.fn(async (tel: string) => String(tel).endsWith('999990000')),
}));
vi.mock('../services/agenda/leadsMetaService', async (orig) => ({
  ...(await orig<typeof import('../services/agenda/leadsMetaService')>()),
  slotLivreConsultor: vi.fn(async () => new Date(Date.parse('2026-11-06T14:00:00.000Z') + (++h.slot) * 60_000)),
}));
vi.mock('../services/gerador/jornadaSolarBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/jornadaSolarBanco')>()),
  lerPrivadoJornada: vi.fn(async () => h.privado),
}));

import indicacaoLinkRoutes, { normalizarTelefoneBR } from '../routes/indicacaoLink';
import { normalizePhone } from '../routes/ioIndicacoes';
import { mountJornadaMensagens } from '../routes/geradorJornadaMensagens';
import { gravarGrupo } from '../services/gerador/jornadaMensagensChave';
import { assinarJornada, normalizarJornada } from '../services/gerador/jornadaSolarBanco';
import { estadoMaterializado } from '../services/gerador/jornadaSolar';
import { marcarVendaCompleta } from '../services/gerador/jornadaVendaCompleta';
import { tokenIndicacao, lerIndicacaoDoCard } from '../services/gerador/indicacaoJornada';
import { assinarLigacao, invalidarCachesHub } from '../services/gerador/vendaSolarHub';

const r = Router();
mountJornadaMensagens(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);
app.use('/indicacao-link', indicacaoLinkRoutes);

const THIAGO = 'Bearer tk-thiago';
const NILCE = 'Bearer tk-nilce';
const AG = new Date('2026-11-05T15:00:00.000Z');
const SONDA = 700;
const VENDIDO = 701;
const sistema = (): any[] => h.main.tabela('system_state');
const semearJs = (id: number, mut: (e: any) => void = () => undefined): void => {
  const e = { ...estadoMaterializado(id, 'nilce', 1, '2026-11-05T12:00:00.000Z'), origem: 'vendido' as const };
  mut(e);
  const n = normalizarJornada(id, e)!;
  sistema().push({ key: `jornada_solar:${id}`, value: { ...n, sig: assinarJornada(id, n) }, updated_at: 'j0' });
};
const card = (id: number, o: Record<string, unknown> = {}) => ({ id, cliente_nome: `Cliente ${id}`, cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia - MG', vendedor_nome: 'Nilce', created_by: 'lp_solar', status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', ...o });

beforeEach(() => {
  h.main = new BancoFalso(); h.ger = new BancoFalso(); h.zapi.mockReset();
  h.usuarios = { 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-nilce': 'nilce@irmaosnaobra.app' };
  h.privado = null;
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  delete process.env.SOLAR_ADM; delete process.env.JORNADA_MSG_OFF;
  invalidarCachesHub();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET e PUT das mensagens', () => {
  it('quem não é ADM leva 403; sem login 401', async () => {
    expect((await request(app).get('/gerador/jornada-solar/mensagens').set('Authorization', NILCE)).status).toBe(403);
    expect((await request(app).put('/gerador/jornada-solar/mensagens').set('Authorization', NILCE).send({ grupo: 'venda', ligado: true })).status).toBe(403);
    expect((await request(app).get('/gerador/jornada-solar/mensagens')).status).toBe(401);
  });
  it('nasce tudo desligado; liga um grupo; o cliente antes da equipe dá 409; corpo torto dá 400', async () => {
    const g = await request(app).get('/gerador/jornada-solar/mensagens').set('Authorization', THIAGO);
    expect(g.body).toMatchObject({ ok: true, valida: true, desligado_na_vercel: false });
    expect(Object.values(g.body.grupos).every((x: any) => x.ligado === false && x.enviadas_24h === 0)).toBe(true);
    const on = await request(app).put('/gerador/jornada-solar/mensagens').set('Authorization', THIAGO).send({ grupo: 'venda', ligado: true });
    expect(on.status).toBe(200);
    expect(on.body.grupos.venda).toMatchObject({ ligado: true, por: 'thiago' });
    const cliente = await request(app).put('/gerador/jornada-solar/mensagens').set('Authorization', THIAGO).send({ grupo: 'liberacao', ligado: true });
    expect(cliente.status).toBe(409);
    expect(cliente.body.error).toBe('As mensagens do cliente ligam um dia depois das da equipe.');
    expect((await request(app).put('/gerador/jornada-solar/mensagens').set('Authorization', THIAGO).send({ grupo: 'x', ligado: true })).status).toBe(400);
    expect((await request(app).put('/gerador/jornada-solar/mensagens').set('Authorization', THIAGO).send({ grupo: 'venda' })).status).toBe(400);
  });
  it('enviadas_24h conta só as travas com enviado:true e nunca as da sonda', async () => {
    await gravarGrupo('etapa', true, 'thiago', new Date('2026-11-01T00:00:00.000Z'));
    const agora = new Date().toISOString();
    sistema().push({ key: 'jornada_env:sua:1:4:diego', value: { enviado: true }, updated_at: agora });
    sistema().push({ key: 'jornada_env:espera:1:4:2026-11-12:thiago', value: { enviado: true }, updated_at: agora });
    sistema().push({ key: 'jornada_env:sua:2:4:diego', value: { enviado: true, sonda: true }, updated_at: agora });
    sistema().push({ key: 'jornada_env:sua:3:4:diego', value: { falhou: true }, updated_at: agora });
    const g = await request(app).get('/gerador/jornada-solar/mensagens').set('Authorization', THIAGO);
    expect(g.body.grupos.etapa.enviadas_24h).toBe(2);
  });
});

describe('a sonda', () => {
  const post = (corpo: unknown, auth = THIAGO) => request(app).post('/gerador/jornada-solar/mensagens/sonda').set('Authorization', auth).send(corpo as object);
  beforeEach(() => {
    h.ger.tabela('agendamentos').push(
      card(SONDA, { cliente_nome: 'TESTE sonda', cliente_telefone: '34900000000', created_by: 'sonda_jornada' }),
      card(VENDIDO),
    );
    semearJs(SONDA);
    semearJs(VENDIDO, (e) => { e.historico.push({ em: '2026-11-05T14:00:00.000Z', por: 'thiago', acao: 'concluir', etapa: 3 }); });
  });
  it('só o ADM; simular não escreve e vale para qualquer card; as outras dão 403 fora do card da sonda', async () => {
    expect((await post({ card: SONDA, acao: 'rodar' }, NILCE)).status).toBe(403);
    await gravarGrupo('venda', true, 'thiago', AG);
    const antes = JSON.stringify(h.main.tabelas);
    const s = await post({ card: VENDIDO, acao: 'simular' });
    expect(s.status).toBe(200);
    expect(s.body.estado).toBe('gravado');
    expect(JSON.stringify(h.main.tabelas)).toBe(antes);
    for (const acao of ['abrir', 'rodar', 'ler', 'desfazer']) {
      const x = await post({ card: VENDIDO, acao });
      expect(x.status, acao).toBe(403);
      expect(x.body.error).toBe('Só o card da sonda.');
    }
    expect((await post({ card: 9999, acao: 'simular' })).status).toBe(404);
    expect((await post({ card: SONDA, acao: 'nada' })).status).toBe(400);
  });
  it('o ciclo: abrir, rodar (travas), rodar (já travadas), ler (conta na linha), desfazer, ler (zero)', async () => {
    const ab = await post({ card: SONDA, acao: 'abrir' });
    expect(ab.body).toMatchObject({ ok: true, etapa_atual: 2 });
    expect((await post({ card: SONDA, acao: 'abrir' })).status).toBe(409);
    const r1 = await post({ card: SONDA, acao: 'rodar' });
    expect(r1.body).toMatchObject({ ok: true, enviados: 0, transporte: 'falso' });
    expect(r1.body.travadas).toEqual(['jornada_env:sua:700:2:giovanna']);
    expect((await post({ card: SONDA, acao: 'rodar' })).body).toMatchObject({ travadas: [], ja_travadas: 1 });
    const l1 = await post({ card: SONDA, acao: 'ler' });
    expect(l1.body.chaves).toHaveLength(1);
    expect(l1.body.chaves[0]).toMatchObject({ key: 'jornada_env:sua:700:2:giovanna', sonda: true, enviado: false, conta_na_linha: true });
    expect((await post({ card: SONDA, acao: 'desfazer' })).body).toEqual({ ok: true, apagadas: 1 });
    expect((await post({ card: SONDA, acao: 'ler' })).body.chaves).toEqual([]);
    expect(h.zapi).not.toHaveBeenCalled();
    expect(sistema().some((l) => String(l.key).startsWith('jornada_vez:'))).toBe(false);
  });
});

describe('o link público de indicação', () => {
  const INDICADOR = 800;
  const token = (): string => tokenIndicacao(INDICADOR)!;
  const linhas = (): any[] => h.main.tabela('io_indicacoes');
  const agendados = (): any[] => h.ger.tabela('agendamentos').filter((a: any) => a.created_by === 'indicacao');
  const envia = (extra: Record<string, unknown> = {}) => request(app).post('/indicacao-link').send({ i: token(), indicado_nome: 'Carla Andrade', indicado_telefone: '(34) 98888-0001', ...extra });
  beforeEach(() => {
    h.ger.tabela('agendamentos').push(card(INDICADOR, { cliente_nome: 'Marcos Vinícius Andrade' }));
    semearJs(INDICADOR);
    sistema().push({ key: `venda_solar:${INDICADOR}`, value: (() => { const l = { proposta: null, venda: '#0065', por: 'gerador', em: AG.toISOString() }; return { ...l, sig: assinarLigacao(INDICADOR, l) }; })(), updated_at: 'v' });
  });

  it('token inválido: 404 no GET e 400 no POST; válido devolve só o primeiro nome', async () => {
    expect((await request(app).get('/indicacao-link/800-AAAAAAAAAA')).status).toBe(404);
    expect((await request(app).get('/indicacao-link/lixo')).status).toBe(404);
    expect((await request(app).post('/indicacao-link').send({ i: '800-AAAAAAAAAA', indicado_nome: 'Ana', indicado_telefone: '34988880001' })).status).toBe(400);
    const ok = await request(app).get(`/indicacao-link/${token()}`);
    expect(ok.body).toEqual({ ok: true, nome: 'Marcos' });
  });
  it('válido: a linha em io_indicacoes com origem jornada:<card>, o card na carteira da Nilce com a tarja, a ligação assinada por INSERT e ZERO Z-API', async () => {
    const res = await envia();
    expect(res.body).toEqual({ ok: true });
    expect(linhas()).toHaveLength(1);
    expect(linhas()[0]).toMatchObject({ origem: 'jornada:800', indicado_telefone: '5534988880001', status: 'novo' });
    const [ag] = agendados();
    expect(ag).toMatchObject({ vendedor_nome: 'Nilce', cliente_nome: 'Carla Andrade', status: 'agendado', temperatura: 'quente' });
    expect(ag.observacao.split('\n')).toEqual(['🎁 INDICADO', 'Indicação de Marcos Vinícius Andrade (#0065)', '→ Atendimento personalizado']);
    expect(await lerIndicacaoDoCard(ag.id)).toMatchObject({ indicador: INDICADOR });
    expect(h.zapi).not.toHaveBeenCalled();
  });
  it('quem vendeu o Diego ou o Thiago também cai na Nilce (é quem atende o solar)', async () => {
    h.ger.tabela('agendamentos').find((a: any) => a.id === INDICADOR).vendedor_nome = 'Diego';
    await envia();
    expect(agendados()[0].vendedor_nome).toBe('Nilce');
  });
  it('honeypot não grava nada; bloqueado grava só a linha; telefone repetido (pela cauda) não cria card novo', async () => {
    expect((await envia({ website: 'http://spam' })).body).toEqual({ ok: true });
    expect(linhas()).toHaveLength(0);
    await envia({ indicado_telefone: '(34) 9 9999-0000' });
    expect(linhas()).toHaveLength(1);
    expect(agendados()).toHaveLength(0);
  });
  it('o telefone de um lead que já existe não muda o card, não liga o dono do link e não gera prêmio (só a linha); tolera o 9º dígito', async () => {
    h.ger.tabela('agendamentos').push(card(900, { cliente_telefone: '5534988880007', created_by: 'lp_solar', status: 'agendado', created_at: new Date().toISOString() }));
    h.ger.tabela('agendamentos').push(card(901, { cliente_telefone: '(34) 3333-4444', created_by: 'lp_solar', status: 'agendado', created_at: new Date().toISOString() }));
    const antes = JSON.stringify(h.ger.tabela('agendamentos'));
    await envia({ indicado_telefone: '34 98888-0007' });
    await envia({ indicado_telefone: '34 8888-0007' });                 // sem o 9º dígito: é o mesmo número
    await envia({ indicado_telefone: '(34) 9 3333-4444' });             // o antigo não tinha o 9
    expect(linhas()).toHaveLength(3);
    expect(JSON.stringify(h.ger.tabela('agendamentos'))).toBe(antes);
    expect(agendados()).toHaveLength(0);
    expect(await lerIndicacaoDoCard(900)).toBeNull();
    expect(await lerIndicacaoDoCard(901)).toBeNull();
    expect(sistema().some((l) => String(l.key).startsWith('jornada_indicacao:'))).toBe(false);
    expect(sistema().some((l) => String(l.key).startsWith('indic_vaga'))).toBe(false);      // nem gasta vaga
  });
  it('o mesmo final com OUTRO DDD não casa: nasce o card', async () => {
    h.ger.tabela('agendamentos').push(card(902, { cliente_telefone: '5511988880007', created_by: 'lp_solar', status: 'agendado', created_at: new Date().toISOString() }));
    await envia({ indicado_telefone: '34 98888-0007' });
    expect(agendados()).toHaveLength(1);
    expect(agendados()[0].cliente_telefone).toBe('5534988880007');
  });
  it('o teto é uma vaga reservada por INSERT: o 3º do link no dia cria card, o 4º grava só a linha', async () => {
    for (let i = 1; i <= 4; i++) await envia({ indicado_nome: `Amigo ${i}`, indicado_telefone: `3498888000${i}` });
    expect(linhas()).toHaveLength(4);
    expect(agendados().map((a) => a.cliente_nome)).toEqual(['Amigo 1', 'Amigo 2', 'Amigo 3']);
    expect(sistema().filter((l) => String(l.key).startsWith(`indic_vaga:${INDICADOR}:`)).map((l) => l.key.split(':').pop()).sort()).toEqual(['1', '2', '3']);
  });
  it('20 POST em paralelo no mesmo link criam no máximo 3 cards (e as 17 linhas sem vaga ficam só como linha)', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => envia({ indicado_nome: `Par ${i}`, indicado_telefone: `349${77000000 + i}` })));
    expect(linhas()).toHaveLength(20);
    expect(agendados().length).toBeLessThanOrEqual(3);
    expect(agendados().length).toBeGreaterThanOrEqual(1);
    expect(sistema().filter((l) => String(l.key).startsWith(`indic_vaga:${INDICADOR}:`)).length).toBeLessThanOrEqual(3);
  });
  it('o teto global do dia segura no 20º: com 19 vagas tomadas só o próximo cria card', async () => {
    const dia = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    for (let n = 1; n <= 19; n++) sistema().push({ key: `indic_vaga_dia:${dia}:${n}`, value: {}, updated_at: new Date().toISOString() });
    await envia({ indicado_nome: 'Vigésimo', indicado_telefone: '34966660001' });
    await envia({ indicado_nome: 'Vinte e um', indicado_telefone: '34966660002' });
    expect(agendados().map((a) => a.cliente_nome)).toEqual(['Vigésimo']);
    expect(linhas()).toHaveLength(2);
    expect(sistema().filter((l) => String(l.key).startsWith(`indic_vaga:${INDICADOR}:`))).toHaveLength(1);      // a vaga do link do 21º foi solta
  });
  it('10 em 30 dias por link: com as 10 vagas da janela tomadas a próxima grava só a linha e não gasta vaga do dia', async () => {
    const janela = Math.floor(Date.now() / (30 * 86_400_000));
    for (let n = 1; n <= 10; n++) sistema().push({ key: `indic_vaga_30:${INDICADOR}:${janela}:${n}`, value: {}, updated_at: new Date().toISOString() });
    await envia();
    expect(agendados()).toHaveLength(0);
    expect(linhas()).toHaveLength(1);
    expect(sistema().some((l) => String(l.key).startsWith(`indic_vaga:${INDICADOR}:`))).toBe(false);
  });
  it('normalizarTelefoneBR dá a mesma saída do normalizePhone do formulário em 8 casos; a rota não importa o zapiClient', () => {
    for (const t of ['(34) 99999-0001', '34999990001', '5534999990001', '0 34 9999-0001', '3433334444', '12345', '', '+55 (34) 3333-4444']) expect(normalizarTelefoneBR(t)).toBe(normalizePhone(t));
    const src = fs.readFileSync(path.resolve(__dirname, '../routes/indicacaoLink.ts'), 'utf8');
    expect(src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')).not.toMatch(/zapiClient|sendWhatsApp|sendDocument|sendFrio/);
  });
});

describe('o venda_completa', () => {
  const cheio = () => ({ v: 1, venda: { valor_centavos: 100, pagamento: [{ forma: 'pix', valor_centavos: 100, obs: '' }], desconto_centavos: null, prazo_prometido: '30 dias', nota: '', kit_confirmado: true, combinado_por: 'x', combinado_em: AG.toISOString(), editado: [] }, cancelamento: null, descancelamentos: [] });
  const ligar = (id: number): void => { const l = { proposta: 'P1', venda: null, por: 'nilce', em: AG.toISOString() }; sistema().push({ key: `venda_solar:${id}`, value: { ...l, sig: assinarLigacao(id, l) }, updated_at: 'v' }); };
  const marcas = (id: number): number => sistema().find((l) => l.key === `jornada_solar:${id}`).value.historico.filter((x: any) => x.acao === 'venda_completa').length;

  it('grava UMA vez só, mesmo chamado de novo; só com o bloco completo', async () => {
    semearJs(11); h.privado = cheio();
    await marcarVendaCompleta(11, 'nilce', false);
    expect(marcas(11)).toBe(0);                    // sem proposta ligada
    ligar(11); invalidarCachesHub();
    await marcarVendaCompleta(11, 'nilce', false);
    await marcarVendaCompleta(11, 'diego', false);
    expect(marcas(11)).toBe(1);
  });
  it('nunca em origem leitura, nunca com a etapa 1 concluída, nunca em venda sem estado', async () => {
    h.privado = cheio();
    semearJs(12, (e) => { e.origem = 'leitura'; }); ligar(12);
    semearJs(13, (e) => { e.etapas[1].concluida_em = AG.toISOString(); }); ligar(13);
    ligar(14);
    for (const id of [12, 13, 14]) await marcarVendaCompleta(id, 'nilce', false);
    expect(marcas(12)).toBe(0); expect(marcas(13)).toBe(0);
    expect(sistema().some((l) => l.key === 'jornada_solar:14')).toBe(false);
  });
  it('venda que já estava completa ANTES da gravação (as antigas) editada depois de ligado não gera aviso', async () => {
    semearJs(16); h.privado = cheio(); ligar(16); invalidarCachesHub();
    await marcarVendaCompleta(16, 'nilce', true);
    expect(marcas(16)).toBe(0);
    await marcarVendaCompleta(16, 'nilce', false);       // a transição de verdade (incompleto -> completo) segue gravando
    expect(marcas(16)).toBe(1);
  });
  it('a ordem inversa funciona igual: o valor entra primeiro e a proposta é ligada depois', async () => {
    semearJs(15); h.privado = cheio();
    await marcarVendaCompleta(15, 'nilce', false);
    expect(marcas(15)).toBe(0);
    ligar(15); invalidarCachesHub();
    await marcarVendaCompleta(15, 'nilce', false);
    expect(marcas(15)).toBe(1);
  });
});
