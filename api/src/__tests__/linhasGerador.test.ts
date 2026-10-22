import { describe, it, expect, vi, beforeEach } from 'vitest';

// A linha que o /gerador monta (fase 2): formatos das regras do dono, classificação junta/conflito/só-Gerador e a ordem
// "visibilidade antes de ler dado pessoal". Bancos e bucket simulados; nada sai para a rede. Dados inventados.

const h = vi.hoisted(() => ({
  linhas: new Map<string, { value: any }>(),
  cards: [] as Array<Record<string, any>>,
  propostas: [] as Array<Record<string, any>>,
  cads: new Map<number, any>(),
  cadsCaem: false,
  falhaCad: 0,
  lidosCad: [] as number[][],
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    from: (t: string) => ({
      select: () => ({
        in: async (c: string, vs: unknown[]) => ({
          data: (t === 'agendamentos' ? h.cards : h.propostas).filter((r) => vs.includes(r[c === 'id' ? 'id' : 'codigo'])), error: null,
        }),
      }),
    }),
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        like: (_c: string, p: string) => {
          const prefixo = p.replace(/%$/, '');
          const chain: any = {
            order: () => chain,
            range: async () => ({ data: [...h.linhas.entries()].filter(([k]) => k.startsWith(prefixo)).map(([k, l]) => ({ key: k, value: l.value })), error: null }),
          };
          return chain;
        },
      }),
    }),
  },
}));
vi.mock('../services/gerador/cadastroVenda', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/cadastroVenda')>()),
  lerCadastros: vi.fn(async (ids: number[]) => {
    h.lidosCad.push(ids);
    if (h.cadsCaem) return { mapa: new Map(), falhas: new Set(), indisponivel: true };
    const falhas = new Set(ids.filter((i) => i === h.falhaCad));
    return { mapa: new Map(ids.filter((i) => h.cads.has(i) && !falhas.has(i)).map((i) => [i, h.cads.get(i)])), falhas, indisponivel: false };
  }),
}));

import {
  montarDerivada, cidadeUfDoCard, nomeCurto, modeloDoInversor, modeloDaPlaca, voltagemDoInversor, concessionariaDaVenda,
  derivarPares, paresDoGerador, type ResumoCsv,
} from '../services/gerador/linhasGerador';
import { assinarLigacao, invalidarCachesHub, type Ligacao } from '../services/gerador/vendaSolarHub';
import { assinarRegistro } from '../services/gerador/vendaSolarRegistro';

const cad = (campos: Record<string, string>) => ({ v: 1, alteracoes: [], em: null, campos: Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor, por: 'x', em: 'x', fonte: 'manual' }])) }) as any;
const card = (id: number, o: Record<string, unknown> = {}) => ({
  id, cliente_nome: 'Cristiano Inventado', cliente_telefone: '(34) 99999-0001', cidade: 'Uberlândia mg', vendedor_nome: 'Nilce',
  created_by: 'lp_solar', status: 'fechou', created_at: '2026-10-01T10:00:00.000Z', ...o,
}) as any;
const prop = (o: Record<string, unknown> = {}) => ({
  codigo: 'P1', vendido: true, valor_vendido: 145000, forma_pagamento: 'Pix', cliente_cidade: 'Uberlandia', cliente_uf: 'MG',
  qtd_placas: 18, inversor: 'SAJ R5 6K', qtd_inversor: 1, consultor_nome: 'Nilce', fase: null as string | null,
  tab: { mod: 'Tsun TSHM600', pot: 600 }, item: { n: 18 }, qtdInvDados: '1', ...o,
});
const idDaData = (ms: number): string => `${Math.floor(ms / 1000).toString(16)}${'0'.repeat(15)}1`;

describe('formatos das regras do dono', () => {
  it('cidadeUfDoCard e nomeCurto', () => {
    expect(cidadeUfDoCard('Uberlândia mg')).toEqual({ cidade: 'Uberlândia', uf: 'MG' });
    expect(cidadeUfDoCard('Araguari')).toEqual({ cidade: 'Araguari', uf: '' });
    expect(nomeCurto('Cristiano Inventado Silva')).toBe('Cristiano');
    expect(nomeCurto('(Odécio) Ferreira')).toBe('Odécio');
  });
  it('placa, inversor, voltagem e concessionária', () => {
    expect(modeloDaPlaca('Tsun TSHM600', 600)).toBe('Tsun 600W');
    expect(modeloDoInversor('SAJ R5 6K')).toBe('SAJ 6K');
    expect(modeloDoInversor('SAJ 7.3K')).toBe('SAJ 7,3K');
    expect(modeloDoInversor('Micro inversor Deye 2250W')).toBe('MI - Deye 2,25K');
    expect(voltagemDoInversor('bifasico')).toBe('Bi - 220');
    expect(voltagemDoInversor('monofasico')).toBe('Mono - 220');
    expect(voltagemDoInversor('trifasico')).toBe('');
    expect(concessionariaDaVenda('CEMIG Distribuição S.A.', '')).toBe('Cemig');
    expect(concessionariaDaVenda('', 'GO')).toBe('Equatorial');
    expect(concessionariaDaVenda('', 'MG')).toBe('Cemig');
  });
  it('card 1143 inventado: negociador Cristiano, titular Hermantino, endereço da instalação, equipamento, nc, Guilherme, data do cartão', () => {
    const corte = Date.UTC(2026, 9, 22, 18, 30);   // 15:30 em Brasília
    const v = montarDerivada({
      card: card(1143),
      cad: cad({
        nome: 'Cristiano Inventado', homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Hermantino Inventado', telefone: '34988887777',
        endereco: 'Rua Pessoal, 1, Centro, Outra Cidade - SP', endereco_ponto: 'Rua da Usina, 10, Zona Rural, Uberlândia - MG',
        uc_fornecimento: 'bifasico', concessionaria: 'CEMIG', benef_1_uc: '0099887766',
      }),
      proposta: prop(), trelloCard: idDaData(corte), socio: true,
    });
    expect(v).toEqual({
      cliente: 'Cristiano', homologacao: 'Hermantino Inventado', consultor: 'Nilce', cadastro_trello: '2026-10-22', contato: '34988887777',
      endereco: 'Rua da Usina, 10, Zona Rural, Uberlândia - MG', cidade: 'Uberlândia', uf: 'MG', concessionaria: 'Cemig',
      qtd_placa: '18', modelo_placa: 'Tsun 600W', pot_placa: '600', qtd_inversor: '1', modelo_inversor: 'SAJ 6K',
      modelo_voltagem_inversor: 'Bi - 220', excedentes: 'Tem Excedente', engenheiro: 'Guilherme', contrato_coop: 'nc',
      tempo_contrato_coop: 'nc', valor_venda: '145000.00', forma_pagto: 'Pix',
    });
    expect(JSON.stringify(v)).not.toMatch(/Pessoal|Outra Cidade/);   // nunca o endereço pessoal do comprador
  });
  it('fallbacks: homologação pelo contratante, telefone do card, cidade da proposta; dinheiro só para sócio; sem cartão sem data', () => {
    const v = montarDerivada({ card: card(1), cad: cad({ nome: 'Ana Inventada' }), proposta: prop({ cliente_cidade: 'Araguari', cliente_uf: 'MG' }), trelloCard: null, socio: false });
    expect(v).toMatchObject({ homologacao: 'Ana Inventada', contato: '34999990001', cidade: 'Araguari', uf: 'MG', concessionaria: 'Cemig' });
    expect(v.cadastro_trello).toBeUndefined();
    expect(v.valor_venda).toBeUndefined();
    expect(v.forma_pagto).toBeUndefined();
    // dossiê antes da proposta no equipamento
    const d = montarDerivada({ card: card(1), cad: null, proposta: prop({ dQtdPlaca: '20', dMarcaPlaca: 'TCL', dMarcaInversor: 'SAJ 8K' }), trelloCard: null, socio: true });
    // item 10: o dossiê fala de OUTRA marca (TCL) que a proposta (Tsun): a potência da proposta não vale
    expect(d).toMatchObject({ qtd_placa: '20', modelo_placa: 'TCL', modelo_inversor: 'SAJ 8K' });
    expect(d.pot_placa).toBeUndefined();
    const mesma = montarDerivada({ card: card(1), cad: null, proposta: prop({ dMarcaPlaca: 'TSUN' }), trelloCard: null, socio: false });
    expect(mesma).toMatchObject({ modelo_placa: 'TSUN 600W', pot_placa: '600' });
    // itens 9 e 11: "Wp" aceito; quantidade que não é inteiro puro cai na proposta
    const wp = montarDerivada({ card: card(1), cad: null, proposta: prop({ dMarcaPlaca: 'Dmegc 625 Wp', dQtdPlaca: '18 placas' }), trelloCard: null, socio: false });
    expect(wp).toMatchObject({ pot_placa: '625', modelo_placa: 'Dmegc 625W' });
    expect(wp.qtd_placa).toBeUndefined();   // item 6: dossiê preenchido e ilegível deixa vazio (vale o contrato)
    expect(montarDerivada({ card: card(1), cad: null, proposta: prop({ dQtdPlaca: '2x7', dQtdInversor: '14,0' }), trelloCard: null, socio: false }))
      .not.toHaveProperty('qtd_placa');
    expect(montarDerivada({ card: card(1), cad: null, proposta: prop({ dQtdPlaca: '' }), trelloCard: null, socio: false }).qtd_placa).toBe('18');
  });
  it('itens 5 e 7: SAJ 2.25K e 2,25 K são micro; prefixos fora; número sem unidade é W', () => {
    expect(modeloDoInversor('SAJ 2.25K')).toBe('MI - SAJ 2,25K');
    expect(modeloDoInversor('SAJ 2,25 K')).toBe('MI - SAJ 2,25K');
    expect(modeloDoInversor('2 x Deye 2,25K')).toBe('MI - Deye 2,25K');
    expect(modeloDoInversor('Solax 2000')).toBe('MI - Solax 2K');
    expect(modeloDaPlaca('Módulo Tsun 610W', 610)).toBe('Tsun 610W');
    const v = montarDerivada({ card: card(1), cad: null, proposta: prop({ dMarcaPlaca: 'Módulo Tsun 610W' }), trelloCard: null, socio: false });
    expect(v).toMatchObject({ modelo_placa: 'Tsun 610W', pot_placa: '610' });
  });
  it('itens 7 e 8: micro em maiúsculas e só até 3K pela exclusão', () => {
    expect(modeloDoInversor('Saj 6K')).toBe('Saj 6K');
    expect(modeloDoInversor('SAJ 2,25k')).toBe('MI - SAJ 2,25K');
    expect(modeloDoInversor('Auxsol 6K')).toBe('Auxsol 6K');
    expect(modeloDoInversor('Solis 75K')).toBe('Solis 75K');
    expect(modeloDoInversor('Deye 2,25K')).toBe('MI - Deye 2,25K');
  });
  it('item 12: cidade e UF da mesma fonte; uf_ponto que discorda da proposta deixa a cidade vazia', () => {
    const v = montarDerivada({ card: card(1), cad: cad({ uf_ponto: 'GO' }), proposta: prop({ cliente_cidade: 'Uberlandia', cliente_uf: 'MG' }), trelloCard: null, socio: false });
    expect(v.uf).toBe('GO');
    expect(v.cidade).toBeUndefined();
    const ok = montarDerivada({ card: card(1), cad: cad({ uf_ponto: 'MG' }), proposta: prop({ cliente_cidade: 'Uberlandia', cliente_uf: 'MG' }), trelloCard: null, socio: false });
    expect(ok).toMatchObject({ cidade: 'Uberlandia', uf: 'MG' });
    // item 4: proposta com cidade e SEM UF, uf_ponto GO: a cidade da proposta não vale
    const semUf = montarDerivada({ card: card(1), cad: cad({ uf_ponto: 'GO' }), proposta: prop({ cliente_cidade: 'Uberlandia', cliente_uf: null }), trelloCard: null, socio: false });
    expect(semUf.uf).toBe('GO');
    expect(semUf.cidade).toBeUndefined();
  });
  it('C-1: micro inversor pela regra do /gerador (sem a palavra micro), vírgula com 3 casas', () => {
    expect(modeloDoInversor('Deye 2,25K')).toBe('MI - Deye 2,25K');
    expect(modeloDoInversor('SOLAX 1,875K')).toBe('MI - SOLAX 1,875K');
    expect(modeloDoInversor('SAJ 2,25K')).toBe('MI - SAJ 2,25K');
    expect(modeloDoInversor('SAJ 6K')).toBe('SAJ 6K');
    expect(modeloDoInversor('Microinversor Deye 2,25K')).toBe('MI - Deye 2,25K');
  });
  it('C-3 a C-7: fase da proposta, forma de pagamento, 55 fora do telefone, W do dossiê, cidade nunca do card', () => {
    const v = montarDerivada({
      card: card(1, { cliente_telefone: '+55 (34) 99999-0001', cidade: 'Cidade Do Lead mg' }), cad: null,
      proposta: prop({ fase: 'Bifásica', forma_pagamento: 'financiamento', dMarcaPlaca: 'Tsun 610W', cliente_cidade: null, cliente_uf: null }),
      trelloCard: null, socio: true,
    });
    expect(v).toMatchObject({ modelo_voltagem_inversor: 'Bi - 220', forma_pagto: 'Financiamento', contato: '34999990001', pot_placa: '610', modelo_placa: 'Tsun 610W' });
    expect(v.cidade).toBeUndefined();
    expect(v.uf).toBeUndefined();
    expect(montarDerivada({ card: card(1), cad: null, proposta: prop({ fase: 'Monofásica' }), trelloCard: null, socio: false }).modelo_voltagem_inversor).toBe('Mono - 220');
    expect(montarDerivada({ card: card(1), cad: null, proposta: prop({ fase: 'Trifásica' }), trelloCard: null, socio: false }).modelo_voltagem_inversor).toBeUndefined();
  });
});

describe('classificação e visibilidade', () => {
  const ligar = (id: number, lig: Partial<Ligacao>) => {
    const l: Ligacao = { proposta: null, venda: null, por: 'nilce', em: '2026-10-20T10:00:00.000Z', ...lig };
    h.linhas.set(`venda_solar:${id}`, { value: { ...l, sig: assinarLigacao(id, l) } });
  };
  const registro = (codigo: string, cardId: number) => {
    const r = { codigo, card: cardId, por: 'nilce', em: '2026-10-22T10:00:00.000Z', origem: 'novo' as const };
    h.linhas.set(`codigo_solar:${codigo.slice(1)}`, { value: { ...r, sig: assinarRegistro(r) } });
  };
  const csv = (o: Record<string, Partial<ResumoCsv>>) =>
    new Map(Object.entries(o).map(([k, r]) => [k, { visivel: true, cliente: '', homologacao: '', telefone: '', consultor: 'Nilce', ...r }]));

  beforeEach(() => {
    h.linhas = new Map(); h.cads = new Map(); h.cadsCaem = false; h.lidosCad = []; h.falhaCad = 0;
    h.cards = [card(1143), card(1144, { cliente_nome: 'Bia Inventada', cliente_telefone: '34911112222' }), card(1145, { vendedor_nome: 'Giovanna' }),
      card(1146, { created_by: 'lp_eletroposto' })];
    h.propostas = [prop()];
    process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste-inventado';
    invalidarCachesHub();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('só-Gerador, junta (nome confere com telefone forte), conflito (telefone igual com nome diferente) e eletroposto fora', async () => {
    ligar(1143, { venda: '#0065', proposta: 'P1', por: 'gerador' }); registro('#0065', 1143);
    ligar(1144, { venda: '#0066', por: 'gerador' }); registro('#0066', 1144);
    ligar(1145, { venda: '#0067', por: 'gerador' }); registro('#0067', 1145);
    ligar(1146, { venda: '#0068', por: 'gerador' });
    h.cads.set(1144, cad({ nome: 'Bia Inventada' }));
    const c = csv({
      '#0066': { cliente: 'Bia Inventada', telefone: '34911112222' },
      '#0067': { cliente: 'Outro Cliente', telefone: '34999990001', consultor: 'Giovanna' },
      '#0064': { cliente: 'Parente Homologado', telefone: '34999990001' },
    });
    const { derivadas } = await derivarPares(await paresDoGerador(), { nome: 'thiago', socio: true, csv: c });
    expect(derivadas.get('#0065')).toMatchObject({ modo: 'so_gerador', doAlocador: true, card: 1143, avisoTelefone: expect.stringMatching(/#0064/) });
    expect(derivadas.get('#0066')).toMatchObject({ modo: 'junta' });
    expect(derivadas.get('#0067')).toMatchObject({ modo: 'conflito' });
    expect(derivadas.has('#0068')).toBe(false);
    expect(JSON.stringify([...derivadas.values()].map((d) => d.avisoTelefone ?? ''))).not.toMatch(/34999990001|34911112222/);
  });

  it('P2-2: linha vazia do Excel com consultor de OUTRA pessoa é conflito; vazia ou do mesmo consultor junta', async () => {
    ligar(1143, { venda: '#0065', por: 'gerador' }); registro('#0065', 1143);
    ligar(1144, { venda: '#0066', por: 'gerador' }); registro('#0066', 1144);
    const c = csv({ '#0065': { consultor: 'Giovanna', vazia: true }, '#0066': { consultor: 'nilce', vazia: true } });
    const { derivadas } = await derivarPares(await paresDoGerador(), { nome: 'thiago', socio: true, csv: c });
    expect(derivadas.get('#0065')).toMatchObject({ modo: 'conflito' });
    expect(derivadas.get('#0066')).toMatchObject({ modo: 'junta' });
    // quem só vê pelo CSV (Giovanna) não recebe nada do card de outra vendedora
    invalidarCachesHub();
    const g = await derivarPares(await paresDoGerador(), { nome: 'giovanna', socio: false, csv: csv({ '#0065': { consultor: 'Giovanna', vazia: true } }) });
    expect(g.derivadas.get('#0065')?.valores).toEqual({});
  });

  it('item 2: linha sem nome nem telefone, mas com endereço ou equipamento de outro cliente, NÃO é vazia: confere o nome e vira conflito', async () => {
    ligar(1143, { venda: '#0065', por: 'gerador' }); registro('#0065', 1143);
    const c = csv({ '#0065': { consultor: 'Nilce', vazia: false } });
    const { derivadas } = await derivarPares(await paresDoGerador(), { nome: 'thiago', socio: true, csv: c });
    expect(derivadas.get('#0065')).toMatchObject({ modo: 'conflito' });
  });

  it('item 4: o cache guarda o cadastro reduzido (nada de CPF, RG nem e-mail)', async () => {
    ligar(1143, { venda: '#0065', por: 'gerador' }); registro('#0065', 1143);
    h.cads.set(1143, cad({ nome: 'Cristiano Inventado', cpf_cnpj: '529.982.247-25', rg_ie: 'ZZRG123', email: 'zz@exemplo.com', benef_1_titular: 'ZZBENEF' }));
    const r = await derivarPares(await paresDoGerador(), { nome: 'thiago', socio: true, csv: new Map() });
    expect(r.derivadas.get('#0065')?.valores.excedentes).toBe('Tem Excedente');
    const { comCacheHub } = await import('../services/gerador/vendaSolarHub');
    const emCache = await comCacheHub('gerador_cads:1143', async () => new Map());
    expect(JSON.stringify([...emCache])).not.toMatch(/529|ZZRG|zz@|ZZBENEF/);
  });

  it('P2-3: registro apagado e ligação por gerador continua sendo do alocador (nunca o ramo "gente, confia")', async () => {
    ligar(1143, { venda: '#0065', por: 'gerador' });   // sem codigo_solar:0065
    const c = csv({ '#0065': { cliente: 'Outro Cliente Inventado', telefone: '34999990001' } });
    const { derivadas } = await derivarPares(await paresDoGerador(), { nome: 'thiago', socio: true, csv: c });
    expect(derivadas.get('#0065')).toMatchObject({ modo: 'conflito', doAlocador: true });
  });

  it('G-2: cadastro de UM card falhou: os outros seguem; o par que precisa conferir nome sai do lado /gerador (sem conflito falso)', async () => {
    ligar(1143, { venda: '#0065', por: 'gerador' }); registro('#0065', 1143);
    ligar(1144, { venda: '#0066', por: 'gerador' }); registro('#0066', 1144);
    h.cads.set(1143, cad({ nome: 'Cristiano Inventado', endereco_ponto: 'Rua X, 1, Centro, Uberlândia - MG' }));
    h.falhaCad = 1144;
    const c = csv({ '#0066': { cliente: 'Bia Inventada', telefone: '34911112222' } });
    const r = await derivarPares(await paresDoGerador(), { nome: 'thiago', socio: true, csv: c });
    expect(r.cadastroOk).toBe(false);
    expect(r.derivadas.get('#0065')?.valores.endereco).toBe('Rua X, 1, Centro, Uberlândia - MG');
    expect(r.derivadas.has('#0066')).toBe(false);
  });

  it('C-2: CADASTRO TRELLO só do cartão confiável (depois do corte) ou do número adotado do Trello', async () => {
    const antes = idDaData(Date.UTC(2026, 9, 22, 14, 54));
    const depois = idDaData(Date.UTC(2026, 9, 22, 18, 30));
    ligar(1143, { venda: '#0065', por: 'gerador', trello_card: antes }); registro('#0065', 1143);
    ligar(1144, { venda: '#0066', por: 'gerador', trello_card: depois }); registro('#0066', 1144);
    const { derivadas } = await derivarPares(await paresDoGerador(), { nome: 'thiago', socio: true, csv: new Map() });
    expect(derivadas.get('#0065')?.valores.cadastro_trello).toBeUndefined();
    expect(derivadas.get('#0066')?.valores.cadastro_trello).toBe('2026-10-22');
  });

  it('ligação de gente sem registro sempre junta; a antiga por auto passa pela conferência de nome', async () => {
    ligar(1143, { venda: '#0057', por: 'nilce' });
    ligar(1144, { venda: '#0058', por: 'auto' });
    const c = csv({ '#0057': { cliente: 'Outro Nome', telefone: '1' }, '#0058': { cliente: 'Outro Nome', telefone: '34911112222' } });
    const { derivadas } = await derivarPares(await paresDoGerador(), { nome: 'thiago', socio: true, csv: c });
    expect(derivadas.get('#0057')).toMatchObject({ modo: 'junta', doAlocador: false });
    expect(derivadas.get('#0058')).toMatchObject({ modo: 'conflito', doAlocador: false });
  });

  it('visibilidade ANTES de ler pessoal: o cadastro de card alheio nem é lido; cadastro fora: cadastroOk false', async () => {
    ligar(1143, { venda: '#0065', por: 'gerador' }); registro('#0065', 1143);
    ligar(1145, { venda: '#0067', por: 'gerador' }); registro('#0067', 1145);
    await derivarPares(await paresDoGerador(), { nome: 'nilce', socio: false, csv: new Map() });
    expect(h.lidosCad.flat()).toEqual([1143]);
    invalidarCachesHub();
    h.cadsCaem = true;
    const r = await derivarPares(await paresDoGerador(), { nome: 'nilce', socio: false, csv: new Map() });
    expect(r.cadastroOk).toBe(false);
    expect(r.derivadas.get('#0065')?.valores.cliente).toBe('Cristiano');   // segue com card e proposta
  });

  it('aviso de mesmo telefone: só linhas que quem pede vê, no máximo 5, nunca o telefone', async () => {
    ligar(1143, { venda: '#0065', por: 'gerador' }); registro('#0065', 1143);
    const c = csv({ '#0060': { telefone: '34999990001', visivel: false }, '#0061': { telefone: '34999990001' } });
    const { derivadas } = await derivarPares(await paresDoGerador(), { nome: 'nilce', socio: false, csv: c });
    expect(derivadas.get('#0065')?.avisoTelefone).toBe('Mesmo telefone da linha #0061 do Excel. Se for a mesma venda, use no Excel o número #0065.');
  });

  it('proposta de outro consultor não entra para consultor; em conflito, quem só vê pelo CSV não recebe nada do lado /gerador', async () => {
    h.propostas = [prop({ consultor_nome: 'Giovanna' })];
    ligar(1143, { venda: '#0065', proposta: 'P1', por: 'gerador' }); registro('#0065', 1143);
    const { derivadas } = await derivarPares(await paresDoGerador(), { nome: 'nilce', socio: false, csv: new Map() });
    expect(derivadas.get('#0065')?.valores.qtd_placa).toBeUndefined();
    invalidarCachesHub();
    ligar(1145, { venda: '#0067', por: 'gerador' }); registro('#0067', 1145);
    const c = csv({ '#0067': { cliente: 'Outro Cliente', telefone: '34999990001', consultor: 'nilce' } });
    const r = await derivarPares(await paresDoGerador(), { nome: 'nilce', socio: false, csv: c });
    expect(r.derivadas.get('#0067')).toMatchObject({ modo: 'conflito', valores: {} });
  });
});
