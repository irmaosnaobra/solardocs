import { describe, it, expect, vi, beforeEach } from 'vitest';

// Banco falso mínimo e CHEIO DE ARMADILHA: qualquer escrita lança. Os filtros são ignorados de
// propósito (cada tabela devolve o que o teste põe); o que se confere é o que o código pediu.
const h = vi.hoisted(() => {
  type Resp = { data: any; error: any };
  const estado = {
    tabelas: {} as Record<string, Resp | ((de: number, ate: number) => Resp)>,
    chamadas: [] as Array<{ tabela: string; metodo: string; args: any[] }>,
    escritas: [] as string[],
    rpc: { data: [] as any[], error: null as any },
  };
  const consulta = (tabela: string) => {
    let faixa: [number, number] = [0, 0];
    const c: any = {};
    for (const m of ['select', 'eq', 'is', 'ilike', 'order', 'limit', 'lte', 'or', 'neq', 'not', 'gte', 'lt']) {
      c[m] = (...args: any[]) => { estado.chamadas.push({ tabela, metodo: m, args }); return c; };
    }
    c.in = (...args: any[]) => { estado.chamadas.push({ tabela, metodo: 'in', args }); return c; };
    c.range = (de: number, ate: number) => { faixa = [de, ate]; return c; };
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      c[m] = () => { estado.escritas.push(`${tabela}.${m}`); throw new Error('escrita proibida no pacote A1'); };
    }
    const resolver = (): Resp => {
      const t = estado.tabelas[tabela];
      if (!t) return { data: [], error: null };
      return typeof t === 'function' ? t(faixa[0], faixa[1]) : t;
    };
    c.maybeSingle = () => {
      const r = resolver();
      return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
    };
    c.then = (ok: any, no: any) => Promise.resolve(resolver()).then(ok, no);
    return c;
  };
  const cliente = {
    from: (t: string) => consulta(t),
    rpc: (nome: string) => {
      estado.chamadas.push({ tabela: 'rpc', metodo: nome, args: [] });
      const p: any = Promise.resolve(estado.rpc);
      p.range = () => Promise.resolve(estado.rpc);
      return p;
    },
  };
  return { estado, cliente };
});

vi.mock('../utils/supabase', () => ({ supabase: h.cliente }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: h.cliente }));

import { decidirDona, produtoDoBotao, produtoDaOrigem, chaveResolvida, PERGUNTA_DO_PORTEIRO } from '../services/agentes5040/porteiro';
import { lerFatosPorteiro, lerConversa, type ListasDeBarragem } from '../services/agentes5040/contexto';
import type { FatosPorteiro } from '../services/agentes5040/tipos';
import { chaveContato } from '../services/agents/whatsapp/silenciar';
import { msg } from './_agentes5040Util';

const base: FatosPorteiro = {
  leituraOk: true, humanoNaConversa: false, naoIncomodar: false, bloqueado: false, mudo: false,
  donaAtual: null, ehClienteSolarDoc: false, anuncio: null, primeiroTextoDoLead: null, origemCadastro: null,
  outroRoboAtivo: false,
};
const f = (x: Partial<FatosPorteiro>): FatosPorteiro => ({ ...base, ...x });

describe('porteiro: os sete passos, nesta ordem', () => {
  it('falha de leitura: ninguém responde', () => {
    const d = decidirDona(f({ leituraOk: false, donaAtual: 'duda' }));
    expect(d).toMatchObject({ dona: null, passo: 'falha' });
  });

  it('o porteiro nunca lança: entrada torta vira falha', () => {
    expect(decidirDona(undefined as any)).toMatchObject({ dona: null, passo: 'falha' });
  });

  it('passo 1: humano, não incomodar, bloqueado e mudo calam, mesmo com dona e anúncio', () => {
    for (const k of ['humanoNaConversa', 'naoIncomodar', 'bloqueado', 'mudo'] as const) {
      const d = decidirDona(f({ [k]: true, donaAtual: 'carla', anuncio: { adId: '1', produto: 'solar' } }));
      expect(d, k).toMatchObject({ dona: null, passo: 1 });
    }
  });

  it('outro robô antigo na conversa SEM dona = ninguém, com o motivo certo, mesmo com anúncio e cadastro', () => {
    const d = decidirDona(f({ outroRoboAtivo: true, donaAtual: null, anuncio: { adId: '1', produto: 'solar' }, origemCadastro: 'lp_solar' }));
    expect(d).toMatchObject({ dona: null, passo: 1, motivo: 'outro robô na conversa' });
  });

  it('a dona atual vale mais que o robô antigo: posse da Duda viva + sessão solar_quiz ativa = a Duda responde', () => {
    expect(decidirDona(f({ outroRoboAtivo: true, donaAtual: 'duda' }))).toMatchObject({ dona: 'duda', passo: 2 });
    expect(decidirDona(f({ outroRoboAtivo: false, donaAtual: 'duda' }))).toMatchObject({ dona: 'duda', passo: 2 });
  });

  it('pausa humana vale mais que a dona atual, com ou sem robô antigo', () => {
    for (const k of ['humanoNaConversa', 'naoIncomodar', 'bloqueado', 'mudo'] as const) {
      expect(decidirDona(f({ [k]: true, donaAtual: 'duda', outroRoboAtivo: true })), k).toMatchObject({ dona: null, passo: 1 });
    }
  });

  it('passo 2: a conversa já tem dona', () => {
    const d = decidirDona(f({ donaAtual: 'helena', ehClienteSolarDoc: true, anuncio: { adId: '1', produto: 'solar' } }));
    expect(d).toMatchObject({ dona: 'helena', passo: 2 });
  });

  it('passo 3: cliente do SolarDoc vai para o suporte, fora das três', () => {
    const d = decidirDona(f({ ehClienteSolarDoc: true, anuncio: { adId: '1', produto: 'solar' } }));
    expect(d).toMatchObject({ dona: 'giovanna_suporte', passo: 3 });
  });

  it('passo 4: o anúncio vale mais que o botão e o cadastro', () => {
    const d = decidirDona(f({
      anuncio: { adId: '9', produto: 'eletroposto' },
      primeiroTextoDoLead: 'Olá! Quero simular meu projeto de energia solar.',
      origemCadastro: 'lead-meta',
    }));
    expect(d).toMatchObject({ dona: 'helena', passo: 4 });
  });

  it('passo 4: anúncio sem produto conhecido não decide e cai para o próximo', () => {
    const d = decidirDona(f({ anuncio: { adId: '9', produto: null }, origemCadastro: 'lead-meta' }));
    expect(d).toMatchObject({ dona: 'duda', passo: 6 });
  });

  it('passo 5: texto pronto de botão vale mais que o cadastro', () => {
    const d = decidirDona(f({ primeiroTextoDoLead: 'Olá! Quero simular meu projeto de energia solar.', origemCadastro: 'lp_eletroposto' }));
    expect(d).toMatchObject({ dona: 'duda', passo: 5 });
  });

  it('passo 6: card ou cadastro recente', () => {
    expect(decidirDona(f({ origemCadastro: 'lp_eletroposto' }))).toMatchObject({ dona: 'helena', passo: 6 });
    expect(decidirDona(f({ origemCadastro: 'quiz' }))).toMatchObject({ dona: 'duda', passo: 6 });
  });

  it('passo 7: sem sinal nenhum, uma pergunta só e ninguém chuta', () => {
    const d = decidirDona(f({ primeiroTextoDoLead: 'Oi', origemCadastro: 'manychat' }));
    expect(d).toMatchObject({ dona: null, passo: 7, pergunta: PERGUNTA_DO_PORTEIRO });
    expect(PERGUNTA_DO_PORTEIRO).toBe('Você quer saber de energia solar, de eletroposto ou do SolarDoc?');
  });
});

describe('porteiro: botões e origens', () => {
  it('textos prontos das páginas', () => {
    expect(produtoDoBotao('Olá! Quero simular meu projeto de energia solar.')).toBe('solar');
    expect(produtoDoBotao('  OLÁ!  quero simular meu projeto de energia solar ')).toBe('solar');
    expect(produtoDoBotao('Oi! Acabei de preencher a simulação de energia solar')).toBe('solar');
    expect(produtoDoBotao('Quero entrar no grupo do eletroposto')).toBe('eletroposto');
    expect(produtoDoBotao('Olá, Nilce. Sou Ana, de Uberaba.\n\nVim pelo site da NEXUS ELETROPOSTOS e respondi o formulário:')).toBe('eletroposto');
    expect(produtoDoBotao('Quero o Kit de Fechamento do Integrador (R$ 27)')).toBe('solardoc');
  });

  it('o pedido de informação sobre o SolarDoc (a frase do anúncio) é o MESMO gatilho da Carla antiga', async () => {
    const { ehGatilhoSolarDoc } = await import('../services/agents/whatsapp/whatsappAgentService');
    const { ehGatilhoSolarDoc: doModulo } = await import('../services/agents/whatsapp/gatilhoSolarDoc');
    expect(ehGatilhoSolarDoc).toBe(doModulo);      // uma definição só, nos dois caminhos
    for (const t of ['Quero saber sobre a SolarDoc', 'Quero saber MAIS sobre o SolarDoc.App', 'gostaria de mais informações sobre o app solardoc', 'Sobre o Solardoc']) {
      expect(ehGatilhoSolarDoc(t), t).toBe(true);
      expect(produtoDoBotao(t), t).toBe('solardoc');
    }
    // Quem já é cliente e pede ajuda não casa (vai para o suporte), e texto de solar segue solar.
    expect(produtoDoBotao('estou usando o SolarDoc Pro e preciso de ajuda')).toBeNull();
    expect(produtoDoBotao('Olá! Quero simular meu projeto de energia solar')).toBe('solar');
  });

  it('a frase do anúncio de Solar vai para a Duda pelo texto, com ou sem anúncio sem produto', () => {
    const frase = 'Olá! Tenho interesse em energia solar.';
    expect(produtoDoBotao(frase)).toBe('solar');
    for (const v of ['Ola, tenho interesse em energia solar', 'Olá tenho interesse em energia solar', 'Olá!Tenho interesse em energia solar',
      'Tenho interesse em energia solar', 'Olá! Tenho interesse em energia solar!!', 'Olá! Tenho interesse em energia solar e no eletroposto']) {
      expect(produtoDoBotao(v), v).toBe('solar');
      expect(decidirDona(f({ primeiroTextoDoLead: v })), v).toMatchObject({ dona: 'duda', passo: 5 });
    }
    // Campanha "Venda" não tem palavra de produto, então o anúncio chega com produto null: o passo 4 não decide e o passo 5 (texto) resolve.
    expect(decidirDona(f({ anuncio: { adId: '9', produto: null }, primeiroTextoDoLead: frase })))
      .toMatchObject({ dona: 'duda', passo: 5 });
    expect(decidirDona(f({ anuncio: null, primeiroTextoDoLead: frase }))).toMatchObject({ dona: 'duda', passo: 5 });
    // Campanha "Solar - X1" (produto solar) continua decidindo no passo do anúncio.
    expect(decidirDona(f({ anuncio: { adId: '9', produto: 'solar' }, primeiroTextoDoLead: frase })))
      .toMatchObject({ dona: 'duda', passo: 4 });
  });

  it('a frase do anúncio não pega o que não é ela: negação e a frase padrão da Meta', () => {
    expect(produtoDoBotao('Não tenho interesse em energia solar')).toBeNull();
    expect(decidirDona(f({ primeiroTextoDoLead: 'Não tenho interesse em energia solar' }))).toMatchObject({ dona: null, passo: 7 });
    // Frase padrão da Meta (B2C_TRIGGERS em whatsappAgentService.ts): serve a qualquer anúncio, não indica produto.
    const padraoMeta = 'Olá! Tenho interesse e queria mais informações, por favor.';
    expect(produtoDoBotao(padraoMeta)).toBeNull();
    expect(decidirDona(f({ primeiroTextoDoLead: padraoMeta }))).toMatchObject({ dona: null, passo: 7 });
  });

  it('a frase do anúncio de Solar não passa na frente da pausa humana, da dona atual nem de outro robô', () => {
    const frase = 'Olá! Tenho interesse em energia solar.';
    for (const k of ['humanoNaConversa', 'naoIncomodar', 'bloqueado', 'mudo'] as const) {
      expect(decidirDona(f({ [k]: true, primeiroTextoDoLead: frase })), k).toMatchObject({ dona: null, passo: 1 });
    }
    expect(decidirDona(f({ donaAtual: 'helena', primeiroTextoDoLead: frase }))).toMatchObject({ dona: 'helena', passo: 2 });
    expect(decidirDona(f({ outroRoboAtivo: true, primeiroTextoDoLead: frase }))).toMatchObject({ dona: null, passo: 1, motivo: 'outro robô na conversa' });
  });

  it('o que é ambíguo ou de quem já comprou não adivinha', () => {
    expect(produtoDoBotao('Comprei o Kit de Fechamento e preciso do acesso')).toBeNull();
    expect(produtoDoBotao('Oi, minha proposta expirou e eu gostaria de receber uma nova.')).toBeNull();
    expect(produtoDoBotao('Olá! Vim do site institucional. Sou Ana, projeto residencial em Uberaba.')).toBeNull();
    expect(produtoDoBotao('Oi')).toBeNull();
    expect(produtoDoBotao(null)).toBeNull();
  });

  it('origens de card e cadastro', () => {
    for (const o of ['lp_eletroposto', 'cadastro_eletroposto', 'manychat_eletroposto', 'agente_eletroposto']) expect(produtoDaOrigem(o)).toBe('eletroposto');
    for (const o of ['lead-meta', 'lp_solar', 'quiz']) expect(produtoDaOrigem(o)).toBe('solar');
    expect(produtoDaOrigem('manychat')).toBeNull();
    expect(produtoDaOrigem('manual')).toBeNull();
    expect(produtoDaOrigem(null)).toBeNull();
  });
});

describe('porteiro: LID resolvido antes de comparar', () => {
  it('o LID de um telefone dá a MESMA chave que o telefone', () => {
    const lid = '123456789012345';
    const mapa = new Map([[lid, { chave: '0000000001', telefone: '5500900000001' }]]);
    const dele = chaveResolvida({ telefone: lid, is_group: false }, mapa);
    const doTelefone = chaveResolvida({ telefone: '5500900000001', is_group: false }, mapa);
    expect(dele).toBe('0000000001');
    expect(dele).toBe(doTelefone);
    expect(doTelefone).toBe(chaveContato('550000000001'));   // sem o nono dígito também
  });

  it('LID sem mapa vira conversa própria e nunca casa com telefone', () => {
    expect(chaveResolvida({ telefone: '123456789012345', is_group: false }, new Map())).toBe('lid:123456789012345');
  });

  it('grupo fica fora', () => {
    expect(chaveResolvida({ telefone: '120363000000000000', is_group: true }, new Map())).toBeNull();
  });
});

describe('contexto: fatos do porteiro em modo estrito', () => {
  const listas: ListasDeBarragem = { silenciado: () => false, bloqueado: () => false, mudo: () => false };
  const agora = Date.parse('2026-10-20T15:00:00Z');
  const lead = [msg('lead', 'Oi, quero saber de energia solar', { momment: '2026-10-20T14:59:00Z' })];

  beforeEach(() => {
    h.estado.tabelas = {};
    h.estado.chamadas = [];
    h.estado.escritas = [];
    h.estado.rpc = { data: [], error: null };
    delete process.env.PAUSA_HUMANA_OFF;
  });

  it('tudo certo: leituraOk e o primeiro texto do lead', async () => {
    const r = await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true });
    expect(r).toMatchObject({ leituraOk: true, humanoNaConversa: false, ehClienteSolarDoc: false, primeiroTextoDoLead: 'Oi, quero saber de energia solar' });
    expect(h.estado.escritas).toEqual([]);
  });

  it('erro de leitura de qualquer tabela: leituraOk=false e o porteiro cala', async () => {
    for (const tabela of ['users', 'atendimento_pausa', 'agendamentos', 'leads_meta', 'eletroposto_nota1', 'eletroposto_parceria']) {
      h.estado.tabelas = { [tabela]: { data: null, error: { code: '57014' } } };
      const r = await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true });
      expect(r.leituraOk, tabela).toBe(false);
      expect(decidirDona(r), tabela).toMatchObject({ dona: null, passo: 'falha' });
    }
  });

  it('listas de barragem que falham (modo estrito) derrubam a leitura', async () => {
    h.estado.tabelas = { whatsapp_suppression: { data: null, error: { code: '57014' } } };
    const r = await lerFatosPorteiro('0000000001', lead, null, { agora, completa: true });
    expect(r.leituraOk).toBe(false);
  });

  it('opt-out lido pela chave: o mesmo contato com e sem nono dígito', async () => {
    h.estado.tabelas = { whatsapp_suppression: { data: [{ phone: '550000000001' }], error: null } };
    const r = await lerFatosPorteiro('0000000001', lead, null, { agora, completa: true });
    expect(r).toMatchObject({ leituraOk: true, naoIncomodar: true });
  });

  it('chave de LID sem telefone resolvido: ninguém responde', async () => {
    const r = await lerFatosPorteiro('lid:123456789012345', lead, null, { listas, agora, completa: true });
    expect(r.leituraOk).toBe(false);
  });

  it('conversa incompleta, ou sem dizer se está completa: ninguém responde', async () => {
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: false })).leituraOk).toBe(false);
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora })).leituraOk).toBe(false);
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: undefined })).leituraOk).toBe(false);
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: 1 as unknown as boolean })).leituraOk).toBe(false);
  });

  it('pausa humana recente bloqueia; pausa esfriada (mais de 24 h) não', async () => {
    h.estado.tabelas = { atendimento_pausa: { data: [{ ultima_fala_humano: '2026-10-20T10:00:00Z', ultima_fala_lead: null }], error: null } };
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true })).humanoNaConversa).toBe(true);
    h.estado.tabelas = { atendimento_pausa: { data: [{ ultima_fala_humano: '2026-10-18T10:00:00Z', ultima_fala_lead: null }], error: null } };
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true })).humanoNaConversa).toBe(false);
  });

  it('gente da equipe falando no celular nas últimas 24 h conta como humano', async () => {
    const conv = [...lead, msg('equipe', 'Já te chamo', { momment: '2026-10-20T14:00:00Z' })];
    expect((await lerFatosPorteiro('0000000001', conv, null, { listas, agora, completa: true })).humanoNaConversa).toBe(true);
  });

  it('fala recente da equipe conta como humano mesmo com PAUSA_HUMANA_OFF=1', async () => {
    process.env.PAUSA_HUMANA_OFF = '1';
    try {
      const conv = [...lead, msg('equipe', 'Já te chamo', { momment: '2026-10-20T14:00:00Z' })];
      expect((await lerFatosPorteiro('0000000001', conv, null, { listas, agora, completa: true })).humanoNaConversa).toBe(true);
      // a tabela de pausas, essa sim, obedece ao desligador
      h.estado.tabelas = { atendimento_pausa: { data: [{ ultima_fala_humano: '2026-10-20T10:00:00Z', ultima_fala_lead: null }], error: null } };
      expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true })).humanoNaConversa).toBe(false);
    } finally {
      delete process.env.PAUSA_HUMANA_OFF;
    }
  });

  it('cliente do SolarDoc pelo users.whatsapp', async () => {
    h.estado.tabelas = { users: { data: [{ id: 'u1' }], error: null } };
    const r = await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true });
    expect(r.ehClienteSolarDoc).toBe(true);
    expect(decidirDona(r)).toMatchObject({ dona: 'giovanna_suporte', passo: 3 });
  });

  it('origem pelo card recente e confere o DDD (mesmos 8 dígitos em outro DDD não casa)', async () => {
    const card = (tel: string) => ({ id: 7, status: 'agendado', quando: null, vendedor_nome: 'Nilce', cliente_nome: 'Ana', cliente_telefone: tel, cidade: 'Uberaba', observacao: null, created_by: 'lp_eletroposto', created_at: '2026-10-19T12:00:00Z' });
    h.estado.tabelas = { agendamentos: { data: [card('5500900000001')], error: null } };
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true })).origemCadastro).toBe('lp_eletroposto');
    h.estado.tabelas = { agendamentos: { data: [card('5511900000001')], error: null } };
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true })).origemCadastro).toBeNull();
  });

  it('card com mais de 60 dias não conta como recente', async () => {
    h.estado.tabelas = { agendamentos: { data: [{ id: 7, status: 'agendado', cliente_telefone: '5500900000001', created_by: 'lp_eletroposto', created_at: '2026-06-01T12:00:00Z' }], error: null } };
    expect((await lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true })).origemCadastro).toBeNull();
  });
});

describe('contexto: leitura da conversa', () => {
  beforeEach(() => {
    h.estado.tabelas = {};
    h.estado.chamadas = [];
    h.estado.escritas = [];
    process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
  });

  const linha = (id: number, telefone: string, momment: string, extra: Record<string, unknown> = {}) => ({
    id, telefone, is_group: false, from_me: false, from_api: null, chat_name: null, sender_name: null,
    tipo: 'texto', texto: `m${id}`, media_url: null, momment, ...extra,
  });

  it('junta telefone e LID: o LID entra no filtro e as mensagens vêm em ordem', async () => {
    const lid = '123456789012345';
    h.estado.tabelas = {
      wa_lid_telefone: { data: [{ lid }], error: null },
      wa_mensagens: { data: [
        linha(3, '5500900000001', '2026-10-20T12:03:00Z'),
        linha(2, lid, '2026-10-20T12:02:00Z', { from_me: true, from_api: false }),
        linha(1, '5500900000001', '2026-10-20T12:01:00Z'),
      ], error: null },
    };
    const r = await lerConversa('0000000001');
    expect(r.completa).toBe(true);
    expect(r.msgs.map(m => m.id)).toEqual([1, 2, 3]);
    expect(r.msgs[1]!.autor).toBe('equipe');
    const filtro = h.estado.chamadas.find(c => c.tabela === 'wa_mensagens' && c.metodo === 'in')!;
    expect(filtro.args[1]).toContain(lid);
    expect(filtro.args[1]).toContain('5500900000001');
    expect(h.estado.escritas).toEqual([]);
  });

  it('sem ZAPI_INSTANCE_ID_IO a conversa vem incompleta', async () => {
    delete process.env.ZAPI_INSTANCE_ID_IO;
    expect(await lerConversa('0000000001')).toEqual({ msgs: [], completa: false });
  });

  it('erro de banco: incompleta', async () => {
    h.estado.tabelas = { wa_mensagens: { data: null, error: { code: '57014' } } };
    expect((await lerConversa('0000000001')).completa).toBe(false);
  });

  it('leitura cortada no teto de páginas: incompleta', async () => {
    h.estado.tabelas = { wa_mensagens: (de) => ({ data: Array.from({ length: 1000 }, (_, i) => linha(de + i + 1, '5500900000001', '2026-10-20T12:00:00Z')), error: null }) };
    expect((await lerConversa('0000000001')).completa).toBe(false);
  });

  it('chave inválida: incompleta', async () => {
    expect((await lerConversa('abc')).completa).toBe(false);
  });
});

describe('contexto: outroRoboAtivo (virada da Fase B)', () => {
  const listas: ListasDeBarragem = { silenciado: () => false, bloqueado: () => false, mudo: () => false };
  const agora = Date.parse('2026-10-20T15:00:00Z');
  const lead = [msg('lead', 'Oi, quero saber de energia solar', { momment: '2026-10-20T14:59:00Z' })];
  const ler = () => lerFatosPorteiro('0000000001', lead, null, { listas, agora, completa: true });
  const sessao = (tipo: string, extra: Record<string, unknown> = {}, phone = '550000000001') => ({ phone, tipo, lead_data: extra });

  beforeEach(() => {
    h.estado.tabelas = {};
    h.estado.chamadas = [];
    h.estado.escritas = [];
    delete process.env.RECUP_ENABLED;
  });

  it('sem sessão nenhuma: false', async () => {
    expect((await ler()).outroRoboAtivo).toBe(false);
  });

  it('sdr_b2b e solar_quiz bastam existir, em qualquer formato de telefone', async () => {
    for (const tipo of ['sdr_b2b', 'solar_quiz']) {
      for (const phone of ['550000000001', '5500900000001', '0000000001', '00900000001']) {
        h.estado.tabelas = { whatsapp_sessions: { data: [sessao(tipo, {}, phone)], error: null } };
        expect((await ler()).outroRoboAtivo, `${tipo} ${phone}`).toBe(true);
      }
    }
  });

  it('sdr_b2b e solar_quiz só contam se a sessão foi atualizada nos últimos 7 dias', async () => {
    const diasAtras = (n: number) => new Date(agora - n * 86_400_000).toISOString();
    for (const tipo of ['sdr_b2b', 'solar_quiz']) {
      h.estado.tabelas = { whatsapp_sessions: { data: [{ ...sessao(tipo), updated_at: diasAtras(2) }], error: null } };
      expect((await ler()).outroRoboAtivo, `${tipo} 2 dias`).toBe(true);
      h.estado.tabelas = { whatsapp_sessions: { data: [{ ...sessao(tipo), updated_at: diasAtras(8) }], error: null } };
      expect((await ler()).outroRoboAtivo, `${tipo} 8 dias`).toBe(false);
    }
    // a janela não vale para a triagem: recepcao_io triando conta mesmo com sessão velha
    h.estado.tabelas = { whatsapp_sessions: { data: [{ ...sessao('recepcao_io', { estado: 'triando' }), updated_at: diasAtras(30) }], error: null } };
    expect((await ler()).outroRoboAtivo).toBe(true);
  });

  it('sessão de OUTRO contato (mesmos 8 dígitos, outro DDD) não conta', async () => {
    h.estado.tabelas = { whatsapp_sessions: { data: [sessao('sdr_b2b', {}, '5511900000001')], error: null } };
    expect((await ler()).outroRoboAtivo).toBe(false);
  });

  it('recepcao_io só em triando; entregue não conta', async () => {
    h.estado.tabelas = { whatsapp_sessions: { data: [sessao('recepcao_io', { estado: 'triando' })], error: null } };
    expect((await ler()).outroRoboAtivo).toBe(true);
    h.estado.tabelas = { whatsapp_sessions: { data: [sessao('recepcao_io', { estado: 'entregue' })], error: null } };
    expect((await ler()).outroRoboAtivo).toBe(false);
  });

  it('recuperacao (Bia) só conta com a recuperação habilitada, como ehLeadRecuperacao', async () => {
    h.estado.tabelas = { whatsapp_sessions: { data: [sessao('recuperacao')], error: null } };
    expect((await ler()).outroRoboAtivo).toBe(false);
    process.env.RECUP_ENABLED = 'true';
    const inst = process.env.ZAPI_INSTANCE_ID_IO;
    process.env.ZAPI_INSTANCE_ID_IO = 'inst-io';
    try {
      expect((await ler()).outroRoboAtivo).toBe(true);
    } finally {
      delete process.env.RECUP_ENABLED;
      if (inst === undefined) delete process.env.ZAPI_INSTANCE_ID_IO; else process.env.ZAPI_INSTANCE_ID_IO = inst;
    }
  });

  it('a posse da própria agente nova (ag5040) não conta como outro robô', async () => {
    h.estado.tabelas = { whatsapp_sessions: { data: [sessao('ag5040', { dona: 'duda', estado: 'viva' }, '0000000001')], error: null } };
    expect((await ler()).outroRoboAtivo).toBe(false);
  });

  it('inv_agente ativa segura os outros robôs; sem_interesse não', async () => {
    h.estado.tabelas = { system_state: { data: [{ value: { estagio: 'conversando', aberto_em: '2026-10-19T10:00:00Z' } }], error: null } };
    expect((await ler()).outroRoboAtivo).toBe(true);
    h.estado.tabelas = { system_state: { data: [{ value: { estagio: 'sem_interesse' } }], error: null } };
    expect((await ler()).outroRoboAtivo).toBe(false);
  });

  it('erro ao ler as sessões ou o inv_agente: leituraOk=false e o porteiro cala (modo estrito)', async () => {
    for (const tabela of ['whatsapp_sessions', 'system_state']) {
      h.estado.tabelas = { [tabela]: { data: null, error: { code: '57014' } } };
      const r = await ler();
      expect(r.leituraOk, tabela).toBe(false);
      expect(decidirDona(r), tabela).toMatchObject({ dona: null, passo: 'falha' });
    }
  });

  it('com outro robô ativo, o porteiro cala mesmo com anúncio e cadastro que apontariam para uma agente', async () => {
    h.estado.tabelas = {
      whatsapp_sessions: { data: [sessao('sdr_b2b')], error: null },
      agendamentos: { data: [{ id: 7, status: 'agendado', cliente_telefone: '5500900000001', created_by: 'lp_solar', created_at: '2026-10-19T12:00:00Z' }], error: null },
    };
    const r = await ler();
    expect(r).toMatchObject({ leituraOk: true, outroRoboAtivo: true, origemCadastro: 'lp_solar' });
    expect(decidirDona(r)).toMatchObject({ dona: null, passo: 1, motivo: 'outro robô na conversa' });
    expect(h.estado.escritas).toEqual([]);
  });
});
