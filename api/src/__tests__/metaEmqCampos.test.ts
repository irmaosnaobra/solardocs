import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  userData, enviarEventoMeta, sha256, normCep, normEmail, normCidade, normUf, separarNome,
} from '../utils/metaCapi';
import { montarEventoCardNovo, valorDoCampo, type Envio } from '../services/meta/capiCardNovoPuro';

// EMQ (10/11/2026): CompleteRegistration da SolarDoc e Schedule/LeadQuente do Solar Ékent passam a mandar
// o que o cadastro já tem (em, ph, fn, ln, ct, st, zp, country), já normalizado e com sha256.

const h = (s: string): string => sha256(s);

describe('normalização que a Meta pede, antes do sha256', () => {
  it('ct: minúsculo, sem acento, sem espaço e sem pontuação', () => {
    expect(normCidade('São José dos Campos')).toBe('saojosedoscampos');
    expect(normCidade('São José dos Campos-SP')).toBe('saojosedoscampos');  // formato Município-UF do IBGE
    expect(normCidade('Ji-Paraná-RO')).toBe('jiparana');
    expect(normCidade("Santa Bárbara d'Oeste-SP")).toBe('santabarbaradoeste');
  });
  it('st: UF de 2 letras em minúsculo, de "UF" ou do fim de "Município-UF"', () => {
    expect(normUf('SP')).toBe('sp');
    expect(normUf('São José dos Campos-SP')).toBe('sp');
    expect(normUf('São José dos Campos')).toBe('');
  });
  it('zp: só dígitos; curto demais não entra', () => {
    expect(normCep('12.345-678')).toBe('12345678');
    expect(normCep(' 38400-000 ')).toBe('38400000');
    expect(normCep('')).toBeNull();
    expect(normCep('12')).toBeNull();
  });
  it('em: minúsculo e sem espaço; sem arroba vira null', () => {
    expect(normEmail('  Maria.Silva @Gmail.COM ')).toBe('maria.silva@gmail.com');
    expect(normEmail('sem-arroba')).toBeNull();
    expect(normEmail(undefined)).toBeNull();
  });
  it('ln: última palavra do nome completo; uma palavra só, sem ln', () => {
    expect(separarNome('Maria José da Silva Araújo')).toEqual({ fn: 'maria', ln: 'araujo' });
    expect(separarNome('Maria')).toEqual({ fn: 'maria', ln: '' });
  });
});

describe('userData do Solar Ékent com os campos novos', () => {
  const u = userData({
    telefone: '(34) 99816-5040', nome: 'João Pedro Araújo', email: ' Joao@Gmail.com ',
    cidade: 'São José dos Campos-SP', cep: '12.245-000',
  });
  it('sai em, ph, fn, ln, ct, st, zp e country, tudo hasheado e normalizado', () => {
    expect(u.em).toEqual([h('joao@gmail.com')]);
    expect(u.ph).toEqual([h('5534998165040')]);
    expect(u.external_id).toEqual([h('5534998165040')]);
    expect(u.fn).toEqual([h('joao')]);
    expect(u.ln).toEqual([h('araujo')]);
    expect(u.ct).toEqual([h('saojosedoscampos')]);
    expect(u.st).toEqual([h('sp')]);
    expect(u.zp).toEqual([h('12245000')]);
    expect(u.country).toEqual([h('br')]);
  });
  it('nome de uma palavra só: sem ln. Sem email e sem CEP: sem em e sem zp', () => {
    const v = userData({ telefone: '34998165040', nome: 'Ana', cidade: 'Uberaba-MG' });
    expect(v.ln).toBeUndefined();
    expect(v.em).toBeUndefined();
    expect(v.zp).toBeUndefined();
    expect(v.fn).toEqual([h('ana')]);
    expect(v.ct).toEqual([h('uberaba')]);
    expect(v.st).toEqual([h('mg')]);
  });
  it('o uf explícito vale mais que o do fim da cidade', () => {
    expect(userData({ telefone: '34998165040', cidade: 'Uberaba', uf: 'MG' }).st).toEqual([h('mg')]);
  });
});

describe('enviarEventoMeta: Schedule e LeadQuente levam os campos novos; chamada antiga continua igual', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('META_SYSTEM_USER_TOKEN', 'tk-de-teste');
    vi.stubEnv('META_TEST_EVENT_CODE', '');
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ events_received: 1 }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const corpo = (): { data: Array<{ event_name: string; event_id?: string; user_data: Record<string, unknown> }> } =>
    JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it.each(['Schedule', 'LeadQuente'])('%s sai com ct, st, zp, country, em e ln hasheados', async (nome) => {
    const r = await enviarEventoMeta({
      produto: 'solar', nome, origem: 'website', eventId: 'evt-solar-1',
      pessoa: { telefone: '34998165040', nome: 'Maria da Silva', email: 'Maria@x.com', cidade: 'São José dos Campos-SP', cep: '12245-000' },
    });
    expect(r.ok).toBe(true);
    const ev = corpo().data[0];
    expect(ev.event_name).toBe(nome);
    expect(ev.event_id).toBe('evt-solar-1');
    expect(ev.user_data).toMatchObject({
      em: [h('maria@x.com')], ph: [h('5534998165040')], external_id: [h('5534998165040')],
      fn: [h('maria')], ln: [h('silva')], ct: [h('saojosedoscampos')], st: [h('sp')], zp: [h('12245000')], country: [h('br')],
    });
    // Exemplo para o relatório: hash truncado de cada campo novo.
    const resumo = Object.fromEntries(Object.entries(ev.user_data).map(([k, v]) => [k, String((v as string[])[0]).slice(0, 8)]));
    expect(Object.keys(resumo)).toEqual(expect.arrayContaining(['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'external_id']));
  });

  it('quem chama sem os campos novos (só telefone e nome) continua funcionando e não ganha em nem zp', async () => {
    const r = await enviarEventoMeta({ produto: 'solar', nome: 'Schedule', origem: 'website', pessoa: { telefone: '34998165040', nome: 'Ana' } });
    expect(r.ok).toBe(true);
    const ud = corpo().data[0].user_data;
    expect(ud.ph).toEqual([h('5534998165040')]);
    expect(ud.fn).toEqual([h('ana')]);
    expect(ud.em).toBeUndefined();
    expect(ud.zp).toBeUndefined();
    expect(ud.ln).toBeUndefined();
    expect(ud.ct).toBeUndefined();
  });
});

describe('Schedule de card novo (capiCardNovoPuro) leva email e CEP só quando o lead os tem', () => {
  const envio = (field_data: unknown): Envio => ({
    card: { id: 77, cliente_nome: 'Carlos Alberto Souza', cliente_telefone: '5534998165040', cidade: 'Uberlândia-MG', created_at: '2026-11-10T12:00:00.000Z', created_by: 'lp_solar' },
    lead: { lead_id: 'quiz_x', nome: 'Carlos', whatsapp: '5534998165040', cidade: 'Uberlândia-MG', field_data },
    classe: 'saiu', foneLead: '5534998165040', core8: '98165040',
  } as Envio);

  it('field_data com email e cep: entram na pessoa e saem hasheados', () => {
    const ev = montarEventoCardNovo(envio([
      { name: 'email', values: ['Carlos@Mail.com'] }, { name: 'zip_code', values: ['38400-000'] },
    ]), Date.now());
    expect(ev.pessoa).toMatchObject({ email: 'Carlos@Mail.com', cep: '38400-000', nome: 'Carlos Alberto Souza', cidade: 'Uberlândia-MG' });
    const u = userData(ev.pessoa);
    expect(u.em).toEqual([h('carlos@mail.com')]);
    expect(u.zp).toEqual([h('38400000')]);
    expect(u.ln).toEqual([h('souza')]);
    expect(u.ct).toEqual([h('uberlandia')]);
    expect(u.st).toEqual([h('mg')]);
  });
  it('sem email e sem CEP no lead: nada novo entra, e o campo interno _capi nunca é lido como dado', () => {
    const ev = montarEventoCardNovo(envio([{ name: '_capi', values: ['{"email":"x@y.com"}'] }]), Date.now());
    expect(ev.pessoa.email).toBeUndefined();
    expect(ev.pessoa.cep).toBeUndefined();
    expect(valorDoCampo([{ name: '_email', values: ['x@y.com'] }], /email/i)).toBeUndefined();
  });
});

describe('metaPixel.sendMetaEvent (pixel da SolarDoc): CompleteRegistration', () => {
  const fetchMock = vi.fn();
  type Corpo = { data: Array<{ event_name: string; event_id?: string; user_data: Record<string, unknown> }> };
  async function carregar() {
    vi.resetModules();
    vi.stubEnv('META_PIXEL_TOKEN', 'tk-de-teste');
    return import('../utils/metaPixel');
  }
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const corpo = (i = 0): Corpo => JSON.parse(fetchMock.mock.calls[i][1].body as string);

  it('sai com em, ph, fn, ln, external_id, ct, st e country normalizados e hasheados, e o event_id do navegador', async () => {
    const { sendMetaEvent } = await carregar();
    const { fn, ln } = separarNome('Maria José da Silva Araújo');
    const r = await sendMetaEvent('CompleteRegistration', {
      eventId: 'creg-1762800000000', email: 'Maria@X.com', phone: '34999999999', firstName: fn, lastName: ln,
      externalId: 'maria@x.com', city: 'São José dos Campos - SP', country: 'br', ip: '1.2.3.4', userAgent: 'UA',
    });
    expect(r.ok).toBe(true);
    const ev = corpo().data[0];
    expect(ev.event_name).toBe('CompleteRegistration');
    expect(ev.event_id).toBe('creg-1762800000000');
    expect(ev.user_data).toMatchObject({
      em: [h('maria@x.com')], ph: [h('5534999999999')], fn: [h('maria')], ln: [h('araujo')],
      external_id: [h('maria@x.com')], ct: [h('saojosedoscampos')], st: [h('sp')], country: [h('br')],
      client_ip_address: '1.2.3.4', client_user_agent: 'UA',
    });
  });

  it('o external_id do CompleteRegistration é o mesmo do Lead para a mesma pessoa (os dois pelo email)', async () => {
    const { sendMetaEvent } = await carregar();
    // Lead como o authController já o monta: só email, sem externalId. CR como agora: externalId = email minúsculo.
    await sendMetaEvent('Lead', { eventId: 'e-1', email: 'Maria@X.com' });
    await sendMetaEvent('CompleteRegistration', { eventId: 'e-1', email: 'maria@x.com', externalId: 'maria@x.com', phone: '34999999999', country: 'br' });
    const lead = corpo(0).data[0].user_data;
    const cr = corpo(1).data[0].user_data;
    expect(cr.external_id).toEqual(lead.external_id);
    expect(cr.external_id).toEqual([h('maria@x.com')]);
    expect(cr.em).toEqual(lead.em);
    expect(corpo(1).data[0].event_id).toBe(corpo(0).data[0].event_id);
  });

  it('chamada antiga (só email, ip e navegador) continua igual: sem ph, ct, st, zp nem country', async () => {
    const { sendMetaEvent } = await carregar();
    await sendMetaEvent('Lead', { email: 'a@a.com', ip: '9.9.9.9', userAgent: 'UA' });
    const ud = corpo().data[0].user_data;
    expect(Object.keys(ud).sort()).toEqual(['client_ip_address', 'client_user_agent', 'em', 'external_id']);
    expect(ud.em).toEqual([h('a@a.com')]);
  });

  it('nome com acento e pontuação sai normalizado; telefone já com 55 não duplica o 55', async () => {
    const { sendMetaEvent } = await carregar();
    await sendMetaEvent('Purchase', { firstName: 'José', lastName: "D'Ávila", phone: '+55 (34) 99999-9999', zip: '38.400-000' });
    const ud = corpo().data[0].user_data;
    expect(ud.fn).toEqual([h('jose')]);
    expect(ud.ln).toEqual([h('davila')]);
    expect(ud.ph).toEqual([h('5534999999999')]);
    expect(ud.zp).toEqual([h('38400000')]);
  });
});
