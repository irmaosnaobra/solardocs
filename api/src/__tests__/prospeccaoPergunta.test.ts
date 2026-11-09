import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Prospecção: oferta antes do link, link só depois do sim, resposta automática
// sem toque, teto de 2 mensagens, espera de 2 a 6 s, carimbo no livro ig_sent: e
// o placar por versão. Banco, IA e envio são todos de mentira.

const h = vi.hoisted(() => {
  type Linha = Record<string, any>;
  const gerador: Record<string, Linha[]> = {};
  const principal: Record<string, Linha[]> = {};
  const upserts: Linha[] = [];
  // `proximo()`: instantes ANTIGOS (2023, em ISO) e crescentes, para o que o teste semeia.
  // Linhas inseridas pelo código ganham o relógio real: ficam sempre depois das semeadas.
  let relogio = 0;
  const proximo = () => new Date(1_700_000_000_000 + ++relogio * 1000).toISOString();
  let ultimoAgora = 0;
  const agora = () => { ultimoAgora = Math.max(ultimoAgora + 1, Date.now()); return new Date(ultimoAgora).toISOString(); };
  const estado = { falharUpsert: false, falharDelete: false };

  function construtor(banco: Record<string, Linha[]>, tabela: string) {
    const filtros: Array<(l: Linha) => boolean> = [];
    let ordem: { col: string; asc: boolean } | null = null;
    let limite = 1000;
    let inicio = 0;
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => { filtros.push(l => l[c] === v); return b; },
      in: (c: string, vs: any[]) => { filtros.push(l => vs.includes(l[c])); return b; },
      gte: (c: string, v: any) => { filtros.push(l => String(l[c]) >= String(v)); return b; },
      ilike: () => b, or: () => b, lte: () => b, like: () => b,
      order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending !== false }; return b; },
      // Como o PostgREST: nenhuma leitura devolve mais de 1000 linhas, e .limit() não passa disso.
      limit: (n: number) => { limite = Math.min(n, 1000); return b; },
      range: (a: number, z: number) => { inicio = a; limite = Math.min(z - a + 1, 1000); return b; },
      insert: (row: Linha) => {
        const lista = (banco[tabela] ??= []);
        if (tabela === 'prospeccao_conversas' && row.mid && lista.some(l => l.mid === row.mid)) {
          return Promise.resolve({ error: { message: 'duplicate key value' } });
        }
        lista.push({ criado_em: agora(), ...row });
        return Promise.resolve({ error: null });
      },
      delete: () => ({ eq: (c: string, v: any) => {
        if (estado.falharDelete) return Promise.resolve({ error: { message: 'delete recusado' } });
        banco[tabela] = (banco[tabela] ?? []).filter(l => l[c] !== v); return Promise.resolve({ error: null });
      } }),
      update: (patch: Linha) => ({ eq: (c: string, v: any) => { for (const l of banco[tabela] ?? []) if (l[c] === v) Object.assign(l, patch); return Promise.resolve({ error: null }); } }),
      upsert: (row: Linha) => {
        if (estado.falharUpsert) return Promise.resolve({ error: { message: 'upsert recusado' } });
        upserts.push(row); (banco[tabela] ??= []).push(row); return Promise.resolve({ error: null });
      },
      then: (ok: any, ko: any) => {
        let r = (banco[tabela] ?? []).filter(l => filtros.every(f => f(l)));
        if (ordem) {
          const { col, asc } = ordem;
          r = [...r].sort((x, y) => (x[col] > y[col] ? 1 : x[col] < y[col] ? -1 : 0) * (asc ? 1 : -1));
        }
        r = r.slice(inicio, inicio + limite);
        return Promise.resolve({ data: r, count: r.length, error: null }).then(ok, ko);
      },
    };
    return b;
  }
  const fabrica = (banco: Record<string, Linha[]>) => ({ from: (t: string) => construtor(banco, t) });
  return {
    gerador, principal, upserts, proximo, estado,
    reset: () => {
      for (const k of Object.keys(gerador)) delete gerador[k];
      for (const k of Object.keys(principal)) delete principal[k];
      upserts.length = 0; estado.falharUpsert = false; estado.falharDelete = false;
    },
    clienteGerador: fabrica(gerador),
    clientePrincipal: fabrica(principal),
    parse: vi.fn(),
    sendDM: vi.fn(async () => ({})),
  };
});

vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: h.clienteGerador }));
vi.mock('../utils/supabase', () => ({ supabase: h.clientePrincipal }));
vi.mock('../services/instagram/igClient', () => ({ sendDM: h.sendDM }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class { messages = { parse: h.parse }; constructor(_o: unknown) {} },
}));

import { tratarRespostaProspeccao, esperaEntreMensagensMs, reservarEnvioLink } from '../services/io/prospeccaoConversaIg';
import { decidirResposta, bolhasParaEnvio, planoDeEnvio } from '../services/io/prospeccaoResposta';
import {
  OFERTAS_A, OFERTAS_B, DESPEDIDAS, ehOferta, versaoDoObs, ultimaNossaFoiOferta, contarOfertas,
  aplicarRegras, bolhaSegura, prometeGratis,
} from '../services/io/prospeccaoRegras';
import { montarFunil, ehToqueAutomatico } from '../services/io/prospeccaoFunil';

const CONTATO = '11111111-2222-3333-4444-555555555555';
const IGSID = 'IG-1';

const veredito = (o: Record<string, any> = {}) => ({
  intencao: 'respondeu_pergunta', resultado: 'respondeu', bolhas: ['Entendi.'],
  mandar_link: false, disse_sim: false, material: [], escalar: false, motivo: 'teste', ...o,
});
const iaDiz = (o: Record<string, any>) => h.parse.mockResolvedValueOnce({ parsed_output: veredito(o) });

function semear(opts: { obs?: string | null; conversa?: Array<['nos' | 'lead', string]> } = {}) {
  h.gerador.prospeccao_contatos = [{ id: CONTATO, ig_user_id: IGSID, empresa: 'Solar Teste', cidade: 'Uberlândia', instagram: 'solarteste', bloqueado: false, lista_id: 'L1' }];
  if (opts.obs !== null) {
    h.gerador.prospeccao_toques = [{ contato_id: CONTATO, produto_id: 'solardoc', resultado: 'enviei', obs: opts.obs ?? 'worker instagram v=B s=1 a=1 p=1', criado_em: h.proximo() }];
  }
  h.gerador.prospeccao_conversas = (opts.conversa ?? []).map(([de, texto]) => ({ contato_id: CONTATO, canal: 'instagram', de, texto, mid: null, criado_em: h.proximo() }));
}

const enviados: string[] = [];
const enviar = async (_para: string, texto: string) => { enviados.push(texto); };
const responder = (texto: string, mid = 'mid-' + Math.random()) =>
  tratarRespostaProspeccao(IGSID, texto, mid, 'IGUSER', 'TOKEN', enviar);

const ult = <T>(l: T[]): T => l[l.length - 1];
const temLink = (m: string) => m.includes('https://solardoc.app/diagnostico');
let esperas: number[] = [];

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste';
  delete process.env.PROSPECCAO_IA_OFF;
  h.reset(); h.parse.mockReset(); h.sendDM.mockClear();
  enviados.length = 0; esperas = [];
  // Sem espera de verdade: guarda o tempo pedido e solta na hora.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => { esperas.push(Number(ms)); fn(); return 0; }) as any);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('resposta automática de perfil', () => {
  it('Instagram: 0 envios, 0 toques, 1 linha em prospeccao_conversas', async () => {
    semear({ conversa: [['nos', 'Pergunta fria?']] });
    iaDiz({ intencao: 'resposta_automatica', bolhas: ['Olá, tudo bem?'], mandar_link: true });
    const antes = h.gerador.prospeccao_conversas.length;
    const tratou = await responder('Olá! Agradecemos o contato, retornaremos em breve.');
    expect(tratou).toBe(true);
    expect(enviados).toEqual([]);
    expect(h.sendDM).not.toHaveBeenCalled();
    expect(h.gerador.prospeccao_toques.filter(t => t.resultado !== 'enviei')).toEqual([]);
    expect(h.gerador.prospeccao_toques).toHaveLength(1);            // só o toque frio que já existia
    expect(h.gerador.prospeccao_conversas).toHaveLength(antes + 1);
    expect(ult(h.gerador.prospeccao_conversas)).toMatchObject({ de: 'lead' });
    expect(h.upserts).toEqual([]);                                  // nada carimbado no livro
  });

  it('decidirResposta devolve nao_enviar, sem bolha, sem link e sem material, e o envio fica vazio', async () => {
    iaDiz({ intencao: 'resposta_automatica', bolhas: ['Oi'], mandar_link: true, material: ['proposta'], escalar: true });
    const v = await decidirResposta({ empresa: 'X', produto_id: 'solardoc', contato_id: CONTATO, canal: 'whatsapp', historico: [{ de: 'lead', texto: 'Horário de atendimento: 8h às 18h' }] });
    expect(v).toMatchObject({ nao_enviar: true, bolhas: [], mandar_link: false, material: [], escalar: false });
    expect(bolhasParaEnvio(v!, CONTATO, 'whatsapp')).toEqual([]);
    expect(planoDeEnvio(v!, CONTATO, 'whatsapp')).toEqual([]);
  });

  it('vale também em outro produto', async () => {
    iaDiz({ intencao: 'resposta_automatica', bolhas: ['Oi'] });
    h.gerador.prospeccao_alegacoes = [];
    const v = await decidirResposta({ empresa: 'X', produto_id: 'limpapro', historico: [{ de: 'lead', texto: 'Digite 1 para vendas' }] });
    expect(v?.nao_enviar).toBe(true);
  });

  it('"ambiguo" de gente (quem é?) continua respondido: sem oferta, sem link', async () => {
    semear({ conversa: [['nos', 'Pergunta fria?']] });
    iaDiz({ intencao: 'ambiguo', bolhas: ['Somos da equipe do SolarDoc, mandei uma pergunta sobre a proposta de vocês.'] });
    await responder('Quem é?');
    expect(enviados).toHaveLength(1);
    expect(enviados.some(temLink)).toBe(false);
    expect(enviados.some(ehOferta)).toBe(false);
    expect(h.gerador.prospeccao_toques.some(t => t.resultado === 'respondeu')).toBe(true);
  });
});

describe('a oferta vem antes do link', () => {
  it('interesse sem oferta anterior: 2 mensagens (reconhecimento + oferta da versão B), sem link', async () => {
    semear({ obs: 'worker instagram v=B s=2 a=1 p=1', conversa: [['nos', 'A proposta chega antes ou depois da do concorrente?']] });
    iaDiz({ intencao: 'respondeu_pergunta', bolhas: ['Entendi, antes costuma ser o ideal.'] });
    await responder('Normalmente depois, uns 10 dias');
    expect(enviados).toHaveLength(2);
    expect(OFERTAS_B).toContain(enviados[1]);
    expect(enviados[1]).toContain('a velocidade da proposta');
    expect(enviados.some(temLink)).toBe(false);
    // a oferta fica gravada como fala nossa, com o texto exato que o código reconhece depois
    expect(ehOferta(ult(h.gerador.prospeccao_conversas.filter(c => c.de === 'nos')).texto)).toBe(true);
    expect(ult(h.gerador.prospeccao_toques)!.obs).toContain('oferta');
  });

  it('versão A: oferta com as horas por mês; toque sem v=: oferta curta sem versão', async () => {
    semear({ obs: 'worker instagram v=A s=1 a=1 p=1' });
    iaDiz({ intencao: 'interessado', bolhas: ['Que bom.'] });
    await responder('Tenho interesse');
    expect(OFERTAS_A).toContain(enviados[1]);

    enviados.length = 0;
    semear({ obs: 'worker instagram s=1 a=1 p=1' });
    iaDiz({ intencao: 'interessado', bolhas: ['Que bom.'] });
    await responder('Tenho interesse');
    expect(OFERTAS_A).toContain(enviados[1]);          // toque antigo, sem v=: oferta da versão A
  });

  it('a versão lida vale também com a marca incerto', () => {
    expect(versaoDoObs('worker instagram incerto v=A s=1 a=1 p=1')).toBe('A');
    expect(versaoDoObs('worker instagram v=B s=1')).toBe('B');
    expect(versaoDoObs('worker instagram')).toBeNull();
    expect(versaoDoObs('IA(ig): interessado')).toBeNull();
  });

  it('sim depois da oferta: no máximo 2 mensagens, uma delas o link /diagnostico com os utm', async () => {
    semear({ conversa: [['nos', 'Pergunta fria?'], ['lead', 'uns 10 horas'], ['nos', OFERTAS_B[0]]] });
    iaDiz({ intencao: 'quer_link', resultado: 'interessado', bolhas: ['Beleza, segue o link.', 'Qualquer dúvida é só falar.'], disse_sim: true, mandar_link: false });
    await responder('Sim, pode mandar');
    expect(enviados.length).toBeLessThanOrEqual(2);
    const link = enviados.find(temLink)!;
    expect(link).toBe(`https://solardoc.app/diagnostico?utm_source=prospeccao&utm_medium=instagram&utm_campaign=resposta_ia&utm_content=${CONTATO.replace(/-/g, '').slice(0, 8)}`);
    expect(ult(h.gerador.prospeccao_toques)!.obs).toContain('link');
  });

  it('sim sem oferta anterior: sem link (vai a oferta)', async () => {
    semear({ conversa: [['nos', 'Pergunta fria?']] });
    iaDiz({ intencao: 'quer_link', resultado: 'interessado', bolhas: ['Beleza.'], disse_sim: true, mandar_link: true });
    await responder('Sim');
    expect(enviados.some(temLink)).toBe(false);
    expect(ehOferta(enviados[enviados.length - 1])).toBe(true);
  });

  it('oferta feita mas a pessoa NÃO aceitou (disse_sim=false): sem link', async () => {
    semear({ conversa: [['nos', OFERTAS_A[1]]] });
    iaDiz({ intencao: 'pediu_preco', bolhas: ['O diagnóstico é grátis. O SolarDoc é R$ 67 por mês.'], disse_sim: false });
    await responder('E quanto custa?');
    expect(enviados.some(temLink)).toBe(false);
    expect(enviados[0]).toContain('R$ 67');
    expect(enviados).toHaveLength(2);
    expect(enviados[1]).not.toBe(OFERTAS_A[1]);          // não repete a mesma frase seguida
  });

  it('histórico longo: a última fala nossa é lida entre as 20 MAIS RECENTES', async () => {
    const conversa: Array<['nos' | 'lead', string]> = [['nos', OFERTAS_A[0]]];
    for (let i = 0; i < 12; i++) conversa.push(['lead', `fala ${i}`], ['nos', `resposta ${i}`]);
    conversa.push(['nos', OFERTAS_A[2]]);
    semear({ conversa });
    iaDiz({ intencao: 'quer_link', bolhas: ['Beleza.'], disse_sim: true });
    await responder('Pode');
    expect(enviados.some(temLink)).toBe(true);
  });
});

describe('sem link em objeção, sem interesse, parar, não é decisor, ambíguo', () => {
  for (const intencao of ['objecao', 'sem_interesse', 'parar', 'nao_e_decisor', 'ambiguo', 'precisa_humano']) {
    it(`${intencao}: nunca link, mesmo com a IA pedindo e a oferta feita`, async () => {
      semear({ conversa: [['nos', OFERTAS_A[0]]] });
      iaDiz({ intencao, resultado: intencao === 'parar' ? 'nao_perturbar' : 'respondeu', bolhas: ['Certo.', 'Entendi.'], mandar_link: true, disse_sim: true, material: ['proposta'] });
      await responder('não');
      expect(enviados.length).toBeLessThanOrEqual(2);
      expect(enviados.some(temLink)).toBe(false);
      expect(h.sendDM).not.toHaveBeenCalled();
    });
  }

  it('sem_interesse recebe a despedida fixa (até 2 bolhas)', async () => {
    semear({ conversa: [['nos', 'Pergunta fria?']] });
    iaDiz({ intencao: 'sem_interesse', resultado: 'sem_interesse', bolhas: ['Que pena, mas posso te mandar o link?'] });
    await responder('Não tenho interesse');
    expect(DESPEDIDAS.map(d => d.split('||').join('|'))).toContain(enviados.join('|'));
    expect(enviados.length).toBeLessThanOrEqual(2);
  });

  it('nao_perturbar zera tudo: sem link, sem oferta, sem imagem e bloqueia', async () => {
    semear({ conversa: [['nos', OFERTAS_B[0]]] });
    iaDiz({ intencao: 'parar', resultado: 'nao_perturbar', bolhas: ['Desculpa o incômodo.'], mandar_link: true, disse_sim: true });
    await responder('Para de me mandar mensagem');
    expect(enviados).toEqual(['Desculpa o incômodo.']);
  });
});

describe('teto de 2 mensagens, espera e carimbo', () => {
  it('nunca mais de 2 mensagens, no SolarDoc material é sempre vazio', async () => {
    semear({ conversa: [['nos', OFERTAS_A[0]]] });
    iaDiz({ intencao: 'quer_link', bolhas: ['Um.', 'Dois.'], disse_sim: true, mandar_link: true, material: ['proposta', 'banco', 'contrato'] });
    await responder('Sim');
    expect(enviados.length).toBeLessThanOrEqual(2);
    expect(h.sendDM).not.toHaveBeenCalled();
    iaDiz({ intencao: 'quer_link', bolhas: ['Um.', 'Dois.'], disse_sim: true, mandar_link: true, material: ['proposta', 'banco', 'contrato'] });
    const v = (await decidirResposta({ empresa: 'X', produto_id: 'solardoc', contato_id: CONTATO, historico: [{ de: 'nos', texto: OFERTAS_A[0] }, { de: 'lead', texto: 'sim' }] }))!;
    expect(v.material).toEqual([]);
    expect(planoDeEnvio(v, CONTATO, 'instagram')).toHaveLength(2);
  });

  it('outro produto também respeita o teto de 2 (bolhas + imagem + link)', async () => {
    h.gerador.prospeccao_alegacoes = [];
    iaDiz({ intencao: 'quer_link', bolhas: ['Um.', 'Dois.'], mandar_link: true, material: ['proposta', 'banco'] });
    const v = (await decidirResposta({ empresa: 'X', produto_id: 'eletroposto', historico: [{ de: 'lead', texto: 'quero' }] }))!;
    expect(v.bolhas.length + v.material.length + (v.mandar_link ? 1 : 0)).toBeLessThanOrEqual(2);
    expect(planoDeEnvio(v, CONTATO, 'whatsapp').length).toBeLessThanOrEqual(2);
  });

  it('espera sorteada entre 2 e 6 s ENTRE as mensagens (nenhuma depois da última)', async () => {
    semear();
    iaDiz({ intencao: 'interessado', bolhas: ['Que bom.'] });
    await responder('Tenho interesse');
    expect(enviados).toHaveLength(2);
    expect(esperas).toHaveLength(1);
    expect(esperas[0]).toBeGreaterThanOrEqual(2000);
    expect(esperas[0]).toBeLessThanOrEqual(6000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(esperaEntreMensagensMs()).toBe(2000);
    (Math.random as any).mockReturnValue(0.99999);
    expect(esperaEntreMensagensMs()).toBe(6000);
  });

  it('toda mensagem enviada ganha um carimbo ig_sent: único, no banco principal', async () => {
    semear();
    iaDiz({ intencao: 'interessado', bolhas: ['Que bom.'] });
    await responder('Tenho interesse');
    expect(enviados).toHaveLength(2);
    expect(h.upserts).toHaveLength(2);
    for (const u of h.upserts) expect(u.key).toMatch(/^ig_sent:prosp:/);
    expect(new Set(h.upserts.map(u => u.key)).size).toBe(2);
    expect(h.principal.system_state).toHaveLength(2);
    expect(h.gerador.system_state).toBeUndefined();     // nenhum livro paralelo no Gerador
  });
});

describe('só o SolarDoc recebe a persona, a oferta e o link do quiz', () => {
  it('outro produto: persona antiga, sem os fatos do SolarDoc, link sem /diagnostico', async () => {
    h.gerador.prospeccao_alegacoes = [];
    iaDiz({ intencao: 'quer_link', bolhas: ['Segue.'], mandar_link: true });
    const v = (await decidirResposta({ empresa: 'Ponto', produto_id: 'eletroposto', contato_id: CONTATO, canal: 'whatsapp', historico: [{ de: 'nos', texto: OFERTAS_A[0] }, { de: 'lead', texto: 'sim' }] }))!;
    const prompt = h.parse.mock.calls[0][0].messages[0].content as string;
    // persona de sempre (Thiago), sem nada do texto novo do SolarDoc
    expect(prompt).toContain('Você é o Thiago, da SolarDoc, falando por mensagem com um integrador solar.');
    expect(prompt).not.toContain('equipe do SolarDoc');
    expect(prompt).not.toContain('R$ 67');
    expect(prompt).not.toContain('OS ÚNICOS FATOS');
    const envio = bolhasParaEnvio(v, CONTATO, 'whatsapp');
    expect(envio.some(temLink)).toBe(false);
    expect(v.oferta).toBeFalsy();
  });

  it('SolarDoc: prompt com a persona da equipe, os fatos fixos e a proibição do período grátis', async () => {
    iaDiz({});
    await decidirResposta({ empresa: 'Solar X', produto_id: 'solardoc', historico: [{ de: 'lead', texto: 'oi' }] });
    const prompt = h.parse.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('equipe do SolarDoc');
    expect(prompt).not.toContain('Thiago');
    expect(prompt).toContain('R$ 67 por mês, sem fidelidade, e não tem teste nem período grátis');
    expect(prompt).toContain('garantia de 7 dias');
    expect(prompt).toContain('gerador de proposta solar');
    expect(prompt).not.toMatch(/te envio as imagens|"material"\s*\(a prova\)/i);
  });

  it('bolha da IA que promete teste grátis ou cita número fora dos fatos vira "Entendi."', () => {
    expect(bolhaSegura('Você pode testar com 7 dias grátis.')).toBe('Entendi.');
    expect(bolhaSegura('Dá 30% de desconto.')).toBe('Entendi.');
    expect(bolhaSegura('São 10 horas por mês, é bastante.', ['uns 10 horas'])).toBe('São 10 horas por mês, é bastante.');
    // o fato permitido, que nega o período grátis, passa
    const fato = 'O diagnóstico é grátis. O SolarDoc é R$ 67 por mês, sem fidelidade, e não tem teste nem período grátis. Tem garantia de 7 dias: se não servir, o valor volta.';
    expect(bolhaSegura(fato)).toBe(fato);
  });

  it('as regras puras: oferta reconhecida pelo texto, mesmo com espaço e acento diferentes', () => {
    expect(ehOferta('  ' + OFERTAS_A[0].replace(/ /g, '  ') + ' ')).toBe(true);
    expect(ehOferta('Oi, tudo bem?')).toBe(false);
    expect(ultimaNossaFoiOferta([{ de: 'nos', texto: OFERTAS_A[0] }, { de: 'lead', texto: 'sim' }])).toBe(true);
    expect(ultimaNossaFoiOferta([{ de: 'nos', texto: OFERTAS_A[0] }, { de: 'lead', texto: 'sim' }, { de: 'nos', texto: 'Segue' }])).toBe(false);
    const r = aplicarRegras(veredito({ intencao: 'quer_link', disse_sim: true }) as any, { ofertaFeita: true, versao: 'A' }, true);
    expect(r.mandar_link).toBe(true);
    expect(r.bolhas).toHaveLength(1);
  });
});

describe('ajustes da revisão', () => {
  it('promessa de teste ou período grátis é cortada, a negação colada ao termo é mantida', () => {
    const cortadas = [
      'Não tem fidelidade e você usa 7 dias grátis.',
      'Dá pra testar grátis antes de pagar.',
      'Tem teste gratuito por uns dias.',
      'Você ganha 7 dias de teste.',
      'Tem período de teste sim.',
      'Dá pra experimentar de graça.',
      'Não tem teste grátis, mas você tem 7 dias grátis depois.',
      'São 7 dias grátis pra começar.',
    ];
    for (const f of cortadas) expect({ f, r: bolhaSegura(f) }).toEqual({ f, r: 'Entendi.' });
    const mantidas = [
      'Não tem teste grátis.',
      'Não existe período grátis.',
      'Sem teste grátis, mas o diagnóstico é grátis.',
      'O SolarDoc é R$ 67 por mês, sem fidelidade, e não tem teste nem período grátis.',
      'O diagnóstico é grátis. O SolarDoc é R$ 67 por mês, sem fidelidade, e não tem teste nem período grátis. Tem garantia de 7 dias: se não servir, o valor volta.',
    ];
    for (const f of mantidas) expect({ f, r: bolhaSegura(f) }).toEqual({ f, r: f });
    expect(prometeGratis('Não tem fidelidade e você usa 7 dias grátis.')).toBe(true);
  });

  it('toque sem versão recebe a oferta da versão A', async () => {
    semear({ obs: 'worker instagram s=1 a=1 p=1' });
    iaDiz({ intencao: 'interessado', bolhas: ['Que bom.'] });
    await responder('Tenho interesse');
    expect(OFERTAS_A).toContain(enviados[1]);
  });

  it('no máximo 2 ofertas por conversa; depois a IA só responde e o "sim" NÃO leva link', async () => {
    const conv: Array<['nos' | 'lead', string]> = [['nos', 'Pergunta fria?'], ['lead', 'ok'], ['nos', OFERTAS_A[0]], ['lead', 'depois'], ['nos', OFERTAS_A[1]], ['lead', 'e o preço?'], ['nos', 'O diagnóstico é grátis.']];
    expect(contarOfertas(conv.map(([de, texto]) => ({ de, texto })))).toBe(2);
    semear({ conversa: conv });
    iaDiz({ intencao: 'pediu_info', bolhas: ['Ele mostra o Índice de Proposta.'], disse_sim: false });
    await responder('Como funciona?');
    expect(enviados.some(ehOferta)).toBe(false);
    expect(enviados.some(temLink)).toBe(false);
    expect(enviados.length).toBeLessThanOrEqual(2);
  });

  it('esgotadas as 2 ofertas: pergunta nossa qualquer + "sim" = sem link; "manda o link" = link', async () => {
    const conv: Array<['nos' | 'lead', string]> = [['nos', OFERTAS_A[0]], ['lead', 'depois'], ['nos', OFERTAS_A[1]], ['lead', 'e o preço?'], ['nos', 'O diagnóstico é grátis. Quer ver como fica?']];
    semear({ conversa: conv });
    iaDiz({ intencao: 'quer_link', bolhas: ['Beleza.'], disse_sim: true, mandar_link: true });
    await responder('Sim');
    expect(enviados.some(temLink)).toBe(false);
    expect(enviados.some(ehOferta)).toBe(false);

    enviados.length = 0;
    semear({ conversa: conv });
    iaDiz({ intencao: 'quer_link', bolhas: ['Claro.'], disse_sim: false });
    await responder('Manda o link');
    expect(enviados.filter(temLink)).toHaveLength(1);
    expect(enviados.length).toBeLessThanOrEqual(2);
  });

  it('esgotadas as 2 ofertas e a última fala nossa é a 2ª oferta: o "sim" a ela vale', async () => {
    semear({ conversa: [['nos', OFERTAS_A[0]], ['lead', 'depois'], ['nos', OFERTAS_A[1]]] });
    iaDiz({ intencao: 'quer_link', bolhas: ['Beleza.'], disse_sim: true });
    await responder('Sim');
    expect(enviados.filter(temLink)).toHaveLength(1);
  });

  it('reserva do link: se o delete da própria linha falhar, vai para o log; e "[link não enviado]" nunca chega à IA', async () => {
    semear({ conversa: [] });
    const link = 'https://solardoc.app/diagnostico?utm_content=11111111';
    await reservarEnvioLink(CONTATO, link);
    h.estado.falharDelete = true;
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await reservarEnvioLink(CONTATO, link)).toBeNull();                 // perdeu a corrida, delete recusado
    expect(erro.mock.calls.some(c => String(c[0]).includes('apagar a reserva do link'))).toBe(true);
    erro.mockRestore(); out.mockRestore();
    h.estado.falharDelete = false;

    // resto de versão antiga: a linha com a marca não vai para o histórico da IA
    semear({ conversa: [['nos', OFERTAS_A[0]], ['nos', '[link não enviado]']] });
    iaDiz({ intencao: 'quer_link', bolhas: ['Beleza.'], disse_sim: true });
    await responder('Sim');
    const prompt = h.parse.mock.calls[h.parse.mock.calls.length - 1][0].messages[0].content as string;
    expect(prompt).not.toContain('[link não enviado]');
    expect(enviados.filter(temLink)).toHaveLength(1);   // a oferta continua sendo a última fala nossa de verdade
  });

  it('WhatsApp: a oferta é reconhecida pelo trecho, com hora, "Lida" e prévia de link na linha', () => {
    expect(ehOferta(`${OFERTAS_A[1]} 14:32 Lida`)).toBe(true);
    expect(ehOferta(`${OFERTAS_B[2]}\nsolardoc.app\nSolarDoc, proposta solar 14:33`)).toBe(true);
    expect(ehOferta('Posso te mandar o link? 14:32')).toBe(false);
    expect(ehOferta('Existe um diagnóstico grátis e a proposta. Quer um café? 14:32')).toBe(false);
    expect(ultimaNossaFoiOferta([{ de: 'nos', texto: `${OFERTAS_A[0]} 09:10` }, { de: 'lead', texto: 'sim' }])).toBe(true);
  });

  it('corrida do link duplo: só a primeira chamada reserva; link antigo (mais de 2 min) não trava', async () => {
    semear({ conversa: [] });
    const link = `https://solardoc.app/diagnostico?utm_content=11111111`;
    const a = await reservarEnvioLink(CONTATO, link);
    expect(a).toMatch(/^link:/);
    const b = await reservarEnvioLink(CONTATO, link);           // outra chamada, logo em seguida
    expect(b).toBeNull();
    expect(h.gerador.prospeccao_conversas.filter(c => c.texto === link)).toHaveLength(1);   // a perdedora APAGA a própria linha
    expect(h.gerador.prospeccao_conversas.some(c => c.mid === a)).toBe(true);
    expect(h.gerador.prospeccao_conversas).toHaveLength(1);

    semear({ conversa: [] });
    h.gerador.prospeccao_conversas.push({ contato_id: CONTATO, canal: 'instagram', de: 'nos', texto: link, mid: 'velho', criado_em: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    expect(await reservarEnvioLink(CONTATO, link)).toMatch(/^link:/);
  });

  it('fluxo: link gravado há pouco por outra chamada na conversa: este turno não manda outro', async () => {
    semear({ conversa: [['nos', OFERTAS_A[0]]] });
    h.gerador.prospeccao_conversas.push({ contato_id: CONTATO, canal: 'instagram', de: 'nos', texto: 'https://solardoc.app/diagnostico?x=1', mid: 'outra', criado_em: new Date(Date.now() - 20 * 1000).toISOString() });
    iaDiz({ intencao: 'quer_link', bolhas: ['Beleza.'], disse_sim: true });
    await responder('Sim');
    // o link da outra chamada já está na conversa: sem link novo
    expect(enviados.filter(temLink)).toHaveLength(0);
  });

  it('carimbo ig_sent que falha (error no retorno) é registrado com o contato e não derruba o envio', async () => {
    semear();
    h.estado.falharUpsert = true;
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    iaDiz({ intencao: 'interessado', bolhas: ['Que bom.'] });
    await responder('Tenho interesse');
    expect(enviados).toHaveLength(2);
    expect(aviso.mock.calls.some(c => String(c[0]).includes('Solar Teste') && String(c[0]).includes(CONTATO))).toBe(true);
  });

  it('placar: "ambiguo" só sai de Respondeu nos toques anteriores a 10/11/2026 (Brasília)', () => {
    expect(ehToqueAutomatico('IA(ig): ambiguo: x', '2026-11-09T23:59:00-03:00')).toBe(true);
    expect(ehToqueAutomatico('IA(ig): ambiguo: x', '2026-11-10T00:00:00-03:00')).toBe(false);
    expect(ehToqueAutomatico('IA(ig): ambiguo: x', '2026-11-11T15:00:00Z')).toBe(false);
  });

  it('funil: "ambiguo" gravado depois do corte conta como gente', async () => {
    const t = (contato_id: string, resultado: string, obs: string | null, criado_em: string) => ({ contato_id, produto_id: 'solardoc', resultado, obs, criado_em });
    h.gerador.prospeccao_toques = [
      t('n1', 'enviei', 'worker instagram v=A s=1 a=1 p=1', '2026-11-08T10:00:00Z'), t('n1', 'respondeu', 'IA(ig): ambiguo: quem é?', '2026-11-12T10:00:00Z'),
      t('n2', 'enviei', 'worker instagram v=A s=1 a=1 p=1', '2026-11-08T10:00:00Z'), t('n2', 'respondeu', 'IA(ig): ambiguo: perfil', '2026-11-09T10:00:00Z'),
    ];
    h.gerador.prospeccao_contatos = [];
    const solar = (await montarFunil(90)).funis.find(x => x.produto === 'solardoc')!;
    expect(solar.etapas.find(e => e.nome === 'Respondeu')!.valor).toBe(1);   // só n1
    expect(solar.versoes!.find(v => v.versao === 'A')).toEqual({ versao: 'A', recebeu: 2, responderam: 1 });
  });
});


describe('depois do link já enviado (SolarDoc)', () => {
  const LINK = `https://solardoc.app/diagnostico?utm_source=prospeccao&utm_medium=instagram&utm_campaign=resposta_ia&utm_content=${CONTATO.replace(/-/g, '').slice(0, 8)}`;
  const comLink = (): Array<['nos' | 'lead', string]> => [['nos', 'Pergunta fria?'], ['lead', 'uns 10 horas'], ['nos', OFERTAS_A[0]], ['lead', 'sim'], ['nos', 'Segue.'], ['nos', LINK]];

  it('"obrigado" depois do link: sem oferta e sem link', async () => {
    semear({ conversa: comLink() });
    iaDiz({ intencao: 'interessado', bolhas: ['Por nada, qualquer dúvida é só falar.'], disse_sim: false, mandar_link: true });
    await responder('Obrigado!');
    expect(enviados).toEqual(['Por nada, qualquer dúvida é só falar.']);
    expect(enviados.some(ehOferta)).toBe(false);
    expect(enviados.some(temLink)).toBe(false);
  });

  it('"sim" depois do link: sem link, mesmo que a IA diga quer_link', async () => {
    semear({ conversa: comLink() });
    iaDiz({ intencao: 'quer_link', bolhas: ['Beleza.'], disse_sim: true, mandar_link: true });
    await responder('Sim');
    expect(enviados.some(temLink)).toBe(false);
    expect(enviados.some(ehOferta)).toBe(false);
    expect(enviados.length).toBeLessThanOrEqual(2);
  });

  it('o link também é provado pelo obs "· link" do toque, mesmo fora das últimas falas', async () => {
    semear({ conversa: [['nos', 'Pergunta fria?']] });
    h.gerador.prospeccao_toques.push({ contato_id: CONTATO, produto_id: 'solardoc', resultado: 'interessado', obs: 'IA(ig): quer_link · link: x', criado_em: h.proximo() });
    iaDiz({ intencao: 'interessado', bolhas: ['Que bom.'] });
    await responder('Legal');
    expect(enviados.some(ehOferta)).toBe(false);
    expect(enviados.some(temLink)).toBe(false);
  });

  it('"manda o link de novo": reenvia UMA vez; o segundo pedido não recebe link', async () => {
    semear({ conversa: comLink() });
    iaDiz({ intencao: 'quer_link', resultado: 'interessado', bolhas: ['Claro, segue de novo.'], disse_sim: false });
    await responder('Manda o link de novo?');
    expect(enviados).toHaveLength(2);
    expect(enviados.filter(temLink)).toHaveLength(1);
    expect(ehOferta(enviados[0])).toBe(false);

    enviados.length = 0;
    iaDiz({ intencao: 'quer_link', resultado: 'interessado', bolhas: ['Segue.'], disse_sim: false });
    await responder('Manda o link de novo por favor');
    expect(enviados.some(temLink)).toBe(false);
    expect(enviados.some(ehOferta)).toBe(false);
    expect(enviados.length).toBeLessThanOrEqual(2);
  });

  it('outro produto não é afetado pela regra do link já enviado', async () => {
    h.gerador.prospeccao_alegacoes = [];
    iaDiz({ intencao: 'quer_link', bolhas: ['Segue.'], mandar_link: true });
    const v = (await decidirResposta({ empresa: 'P', produto_id: 'eletroposto', historico: [{ de: 'nos', texto: LINK }, { de: 'lead', texto: 'sim' }] }))!;
    expect(v.mandar_link).toBe(true);
  });
});

describe('placar', () => {
  it('mais de 1000 toques: lê em páginas, o A/B não sai truncado', async () => {
    const t = (contato_id: string, resultado: string, obs: string | null) => ({ contato_id, produto_id: 'solardoc', resultado, obs, criado_em: h.proximo() });
    const linhas: Array<Record<string, any>> = [];
    for (let i = 0; i < 1500; i++) {
      linhas.push(t('c' + i, 'enviei', 'worker instagram v=A s=1 a=1 p=1'));
      if (i % 3 === 0) linhas.push(t('c' + i, 'respondeu', 'IA(ig): respondeu_pergunta: x'));
    }
    h.gerador.prospeccao_toques = linhas;
    h.gerador.prospeccao_contatos = [];
    const solar = (await montarFunil(90)).funis.find(x => x.produto === 'solardoc')!;
    expect(solar.versoes).toEqual([{ versao: 'A', recebeu: 1500, responderam: 500 }, { versao: 'B', recebeu: 0, responderam: 0 }]);
    expect(solar.etapas.find(e => e.nome === 'Recebeu mensagem')!.valor).toBe(1500);
    expect(solar.etapas.find(e => e.nome === 'Respondeu')!.valor).toBe(500);
  });

  it('toque de resposta automática é reconhecido pelo formato, não pela palavra solta', () => {
    expect(ehToqueAutomatico('IA(ig): ambiguo: perfil comercial')).toBe(true);
    expect(ehToqueAutomatico('IA(zap): ambiguo')).toBe(true);
    expect(ehToqueAutomatico('IA(ig): interessado: nada ambiguo aqui')).toBe(false);
    expect(ehToqueAutomatico(null)).toBe(false);
  });

  it('funil do SolarDoc filtra o produto, tira "ambiguo" de Respondeu e abre a resposta por versão', async () => {
    const t = (contato_id: string, produto_id: string, resultado: string, obs: string | null) => ({ contato_id, produto_id, resultado, obs, criado_em: h.proximo() });
    h.gerador.prospeccao_toques = [
      // A: a1 respondeu de gente, a2 só recebeu, a3 só respondeu a resposta automática
      t('a1', 'solardoc', 'enviei', 'worker instagram v=A s=1 a=1 p=1'), t('a1', 'solardoc', 'respondeu', 'IA(ig): respondeu_pergunta: x'),
      t('a2', 'solardoc', 'enviei', 'worker instagram v=A s=1 a=1 p=1'),
      t('a3', 'solardoc', 'enviei', 'worker instagram v=A s=1 a=1 p=1'), t('a3', 'solardoc', 'respondeu', 'IA(ig): ambiguo: perfil automático'),
      // B: b1 recebeu (incerto não conta), b2 recebeu e respondeu (obs nula, marcação manual)
      t('b1', 'solardoc', 'enviei', 'worker instagram incerto v=B s=1 a=1 p=1'),
      t('b2', 'solardoc', 'enviei', 'worker instagram v=B s=1 a=1 p=1'), t('b2', 'solardoc', 'interessado', null),
      // de outro produto: fica fora do funil do SolarDoc
      t('e1', 'eletroposto', 'enviei', 'worker instagram v=A s=1 a=1 p=1'), t('e1', 'eletroposto', 'respondeu', 'IA(ig): interessado'),
      t('l1', 'limpapro', 'enviei', 'worker whatsapp'),
    ];
    h.gerador.prospeccao_contatos = [];
    const f = await montarFunil(90);
    const solar = f.funis.find(x => x.produto === 'solardoc')!;
    const valor = (nome: string) => solar.etapas.find(e => e.nome === nome)!.valor;
    expect(valor('Recebeu mensagem')).toBe(5);            // a1, a2, a3, b1, b2: os de outro produto ficam fora
    expect(valor('Respondeu')).toBe(2);                   // a1 e b2; a3 (automática) e os de outro produto não contam
    expect(solar.versoes).toEqual([
      { versao: 'A', recebeu: 3, responderam: 1 },
      { versao: 'B', recebeu: 1, responderam: 1 },
    ]);
  });
});
