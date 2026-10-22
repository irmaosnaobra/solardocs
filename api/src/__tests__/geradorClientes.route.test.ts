import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

// Gestão de clientes: rotas com a planilha, o login e o banco simulados (dados inventados).
// O que se prova aqui: o corte por papel na resposta INTEIRA, o que cada um pode gravar,
// conflito 409, a corrida de gravação e que o preenchido na Gestão move a etapa em Obras.

const h = vi.hoisted(() => ({
  usuarios: {} as Record<string, string>,
  linhas: new Map<string, { value: unknown; updated_at: string }>(),
  csv: '',
  planilhaFora: false,
  erroLeitura: false,
  erroGravar: false,
  /** Roda uma vez entre a leitura e a gravação: simula outra pessoa gravando no meio. */
  noMeio: null as null | (() => void),
  tique: 0,
}));

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabaseGerador', () => ({
  geradorComServiceKey: false,
  supabaseGerador: {
    auth: {
      getUser: vi.fn(async (token: string) => {
        const email = h.usuarios[token];
        return email
          ? { data: { user: { email, email_confirmed_at: '2026-01-01T00:00:00Z' } }, error: null }
          : { data: { user: null }, error: { message: 'jwt' } };
      }),
    },
  },
}));
vi.mock('../utils/supabase', () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== 'system_state') throw new Error(`tabela inesperada: ${tabela}`);
      const stamp = () => `2026-10-13T12:00:00.${String(++h.tique).padStart(6, '0')}+00:00`;
      return {
        select: () => ({
          in: async (_c: string, chaves: string[]) => {
            if (h.erroLeitura) return { data: null, error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
            return { data: chaves.filter((k) => h.linhas.has(k)).map((k) => ({ key: k, value: h.linhas.get(k)!.value })), error: null };
          },
          eq: (_c: string, k: string) => ({
            maybeSingle: async () => {
              if (h.erroLeitura) return { data: null, error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
              const l = h.linhas.get(k);
              const r = { data: l ? { key: k, value: l.value, updated_at: l.updated_at } : null, error: null };
              if (h.noMeio) { const f = h.noMeio; h.noMeio = null; f(); }
              return r;
            },
          }),
        }),
        upsert: async (l: { key: string; value: unknown }) => { h.linhas.set(l.key, { value: l.value, updated_at: stamp() }); return { error: null }; },
        insert: async (l: { key: string; value: unknown }) => {
          if (h.erroGravar) return { error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
          if (h.linhas.has(l.key)) return { error: { code: '23505', message: 'dup' } };
          h.linhas.set(l.key, { value: l.value, updated_at: stamp() });
          return { error: null };
        },
        update: (novo: { value: unknown; updated_at: string }) => ({
          eq: (_c: string, k: string) => {
            const faz = (ok: (l: { updated_at: string }) => boolean) => ({
              select: async () => {
                if (h.erroGravar) return { data: null, error: { code: 'XX000', message: 'VALOR-SECRETO-NO-ERRO' } };
                const l = h.linhas.get(k);
                if (!l || !ok(l)) return { data: [], error: null };
                h.linhas.set(k, { value: novo.value, updated_at: stamp() });
                return { data: [{ key: k }], error: null };
              },
            });
            return { eq: (_c2: string, v: string) => faz((l) => l.updated_at === v), is: () => faz(() => false) };
          },
        }),
      };
    },
  },
}));

import { mountClientes, limparCacheClientes, codigosSolar, codigosSolarAtuais } from '../routes/geradorClientes';
import { leituraAtualDaPlanilha } from '../routes/geradorClientes';
import { dependenciasDoAlocador } from '../routes/geradorVendaSolarCliente';
import { mountSolar, limparCachesSolar, limitesSolar } from '../routes/geradorSolar';

const CABECALHO: string[] = [
  'J49', 'NOME CLIENTE', 'NOME HOMOLOGAÇÃO', 'CONSULTOR', 'ORIGEM DO LEAD', 'VALOR DA VENDA', 'FORMA DE PAGTO', 'RECEBIDO REAL',
  'RECEBIMENTO', 'SISTEMA LIBERADO PELA CONCESSIONARIA', 'DEPOIMENTO INSTAGRAM', 'CONTATO', 'ENDEREÇO', 'CIDADE', 'UF',
  'ENTREGA DO MATERIAL', 'PREVISÃO DE MONTAGEM', 'DATA INICIO INSTALAÇÃO', 'DATA FINAL INSTALAÇÃO', 'QTD PLACA', 'MODELO PLACA',
  'POT PLACA', 'STATUS', 'QTD INV', 'MODELO E VOLTAGEM DO INVERSOR', 'MODELO INVERSOR', 'STATUS', 'TIPO ESTRUTURA', 'STATUS',
  'OUTRO EQUIP', 'CONTRATO COOPERATIVA', 'TEMPO DE CONTRATO COOP', 'OBS:', 'CADASTRO TRELLO', 'PAGTO ART', 'VALOR ART',
  'DATA EMISSÃO ULTIMO PARECER DE ACESSO', 'DATA PEDIDO DE VISTORIA', 'LIBERAÇÃO VISTORIA', 'ENGENHEIRO', 'EXCEDENTES',
  'CONCESSIONARIA', 'VALOR PAGO DO PROJETO', 'VALOR KIT', 'TAXAS/DESCONTOS', 'FATOR X', 'FORNECEDOR', 'AC - CC', 'EQUIPE',
  'PREVISÃO DE MONTAGEM', 'INCIO INSTALAÇÃO', 'FIM INSTALAÇÃO', 'KM INICIAL', 'KM FINAL', 'KM TOTAL',
  'M.O / PEÇAS/ ALIM / HOSP/PED', 'NF', 'COMISSÃO VENDA', 'PRÉ VENDA', 'TOTAL CUSTO', 'TOTAL LUCRO', '% DE LUCRO',
];
const SENT: Record<string, string> = {
  'ORIGEM DO LEAD': '#0013 ZZClienteAlheio',
  'VALOR DA VENDA': 'R$ 8.887,77', 'FORMA DE PAGTO': 'ZZFORMA11', 'RECEBIDO REAL': 'R$ 7.776,66', 'PAGTO ART': 'ZZART22',
  'VALOR ART': 'R$ 654,32', 'VALOR PAGO DO PROJETO': 'R$ 987,65', 'VALOR KIT': 'R$ 4.321,09', 'TAXAS/DESCONTOS': 'R$ 111,22',
  'FATOR X': 'ZZFATOR12', FORNECEDOR: 'ZZFORN33', 'AC - CC': 'R$ 4.444,44', 'KM INICIAL': 'ZZKMI101', 'KM FINAL': 'ZZKMF202', 'KM TOTAL': 'ZZKMT303',
  'M.O / PEÇAS/ ALIM / HOSP/PED': 'R$ 555,44', NF: 'ZZNF55', 'COMISSÃO VENDA': 'R$ 333,21', 'PRÉ VENDA': 'R$ 222,10',
  'TOTAL CUSTO': 'R$ 6.543,21', 'TOTAL LUCRO': 'R$ 2.345,67', '% DE LUCRO': 'ZZPCT265',
};
function venda(codigo: string, campos: Record<string, string>): string[] {
  const l = new Array(CABECALHO.length).fill('');
  l[0] = codigo;
  for (const [nome, v] of Object.entries({ ...SENT, ...campos })) l[CABECALHO.indexOf(nome)] = v;
  return l;
}
const paraCsv = (linhas: string[][]) => [CABECALHO, ...linhas]
  .map((l) => l.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
const planilha = () => paraCsv([
  venda('#0057', { 'NOME CLIENTE': 'Ana Souza', CONSULTOR: 'Nilce', CIDADE: 'Uberlandia', UF: 'MG', 'DATA INICIO INSTALAÇÃO': '02/10/2026', 'CADASTRO TRELLO': '03/08/2026', 'QTD PLACA': '10', 'DATA EMISSÃO ULTIMO PARECER DE ACESSO': '05/08/2026', 'ENTREGA DO MATERIAL': '10/08/2026' }),
  venda('#0058', { 'NOME CLIENTE': 'Bruno Lima', CONSULTOR: 'Giovanna', 'CADASTRO TRELLO': '01/09/2026', ENGENHEIRO: 'Marcos', CONCESSIONARIA: 'Energisa', 'TIPO ESTRUTURA': 'Cerâmico' }),
  venda('#0059', { 'NOME CLIENTE': '<script>alert(1)</script>', CONSULTOR: 'Nilce', 'CADASTRO TRELLO': '20/08/2026' }),
]);

const r = Router();
mountSolar(r);
mountClientes(r);
const app = express();
app.use(express.json());
app.use('/gerador', r);

const NILCE = 'Bearer tk-nilce';
const GIOVANNA = 'Bearer tk-giovanna';
const THIAGO = 'Bearer tk-thiago';
const DIEGO = 'Bearer tk-diego';
const VELHO = '2000-01-01T00:00:00.000Z';

beforeEach(() => {
  h.usuarios = {
    'tk-nilce': 'nilce@irmaosnaobra.app', 'tk-thiago': 'thiago@irmaosnaobra.app', 'tk-diego': 'diego@irmaosnaobra.app',
    'tk-giovanna': 'giovanna@irmaosnaobra.app', 'tk-estranho': 'alguem@gmail.com',
  };
  h.linhas = new Map(); h.csv = planilha(); h.planilhaFora = false; h.erroLeitura = false; h.erroGravar = false; h.noMeio = null; h.tique = 0;
  delete process.env.SOLAR_SOCIOS;
  limparCacheClientes(); limparCachesSolar();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('docs.google.com')) return h.planilhaFora ? new Response('erro', { status: 500 }) : new Response(h.csv, { status: 200 });
    throw new Error('rede indisponível no teste');   // Trello: o quadro é opcional
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); limitesSolar.planilhaMs = 15_000; });

const get = (auth = NILCE, q = '') => request(app).get(`/gerador/clientes/solar${q}`).set('Authorization', auth);
const post = (corpo: Record<string, unknown>, auth = NILCE) =>
  request(app).post('/gerador/clientes/solar/campo').set('Authorization', auth).send({ base_em: VELHO, ...corpo });
const chavesDe = (o: unknown, acc = new Set<string>()): Set<string> => {
  if (Array.isArray(o)) o.forEach((x) => chavesDe(x, acc));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.add(k); chavesDe(v, acc); }
  return acc;
};
const SOCIO = ['origem', 'valor_venda', 'recebido_real', 'forma_pagto', 'pagto_art', 'valor_art', 'valor_projeto', 'valor_kit', 'taxas_descontos', 'fator_x',
  'fornecedor', 'ac_cc', 'km_inicial', 'km_final', 'km_total', 'mao_de_obra', 'nf', 'comissao_venda', 'pre_venda', 'total_custo', 'total_lucro', 'pct_lucro'];

describe('login', () => {
  it('401 sem token e com token inválido; 403 para conta de fora; nada é baixado antes', async () => {
    expect((await request(app).get('/gerador/clientes/solar')).status).toBe(401);
    expect((await get('Bearer lixo')).status).toBe(401);
    expect((await get('Bearer tk-estranho')).status).toBe(403);
    expect((await request(app).post('/gerador/clientes/solar/campo').send({})).status).toBe(401);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

describe('GET /clientes/solar', () => {
  it('sócio: 62 colunas, todas as vendas, papel e Cache-Control: no-store', async () => {
    const res = await get(THIAGO);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ ok: true, papel: 'socio', fonte: { planilha: true } });
    expect(res.body.catalogo.colunas).toHaveLength(62);
    expect(res.body.linhas.map((l: { codigo: string }) => l.codigo)).toEqual(['#0057', '#0058', '#0059']);
    expect(res.body.linhas[0].celulas.valor_venda).toEqual({ valor: 8887.77, origem: 'planilha' });
    expect(res.body.totais.clientes).toBe(3);
    expect(typeof res.body.em).toBe('string');
  });
  it('consultor: só as vendas dele, nenhuma chave, rótulo ou valor de coluna de sócio na resposta inteira', async () => {
    h.linhas.set('gestao_cliente:0057', {
      updated_at: 't', value: {
        campos: { valor_venda: { valor: 7777.01, por: 'thiago', em: '2026-10-01T10:00:00.000Z' }, cidade: { valor: 'Catalão', por: 'nilce', em: '2026-10-01T10:00:00.000Z' } },
        alteracoes: [{ em: '2026-10-01T10:00:00.000Z', por: 'thiago', coluna: 'valor_venda', antes: 1234567.89 }], em: '2026-10-01T10:00:00.000Z',
      },
    });
    const res = await get(NILCE);
    expect(res.status).toBe(200);
    expect(res.body.papel).toBe('consultor');
    expect(res.body.linhas.map((l: { codigo: string }) => l.codigo)).toEqual(['#0057', '#0059']);
    // `origem` também é o nome do campo de origem DENTRO de cada célula (planilha ou sistema): a chave de COLUNA é que não pode existir.
    const chaves = new Set<string>([...res.body.catalogo.colunas.map((c: { chave: string }) => c.chave), ...res.body.linhas.flatMap((l: { celulas: object }) => Object.keys(l.celulas))]);
    for (const k of SOCIO) expect(chaves.has(k), `chave ${k}`).toBe(false);
    const rotulos = res.body.catalogo.colunas.map((c: { rotulo: string }) => c.rotulo);
    for (const rot of ['Origem do lead', 'Valor da venda', 'Valor do kit', 'Total de lucro', 'Comissão da venda', 'Fornecedor', 'Nota fiscal', 'KM inicial']) expect(rotulos).not.toContain(rot);
    const texto = JSON.stringify(res.body).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'DATA');
    for (const s of [...Object.values(SENT), '8887', '7777.01', '1234567', '4444']) expect(texto.includes(s), s).toBe(false);
    expect(texto).not.toContain('alteracoes');
    expect(res.body.catalogo.grupos).not.toContain('Custos da obra');
    // a sobrescrita de OUTRA coluna continua aparecendo, com quem preencheu
    expect(res.body.linhas[0].celulas.cidade).toEqual({ valor: 'Catalão', origem: 'sistema', por: 'nilce', em: '2026-10-01T10:00:00.000Z' });
  });
  it('consultor: a resposta não traz a chave origem, o rótulo "Origem do lead" nem o texto da origem', async () => {
    const res = await get(NILCE);
    expect(res.body.catalogo.colunas.some((c: { chave: string }) => c.chave === 'origem')).toBe(false);
    expect(res.body.linhas.every((l: { celulas: Record<string, unknown> }) => !('origem' in l.celulas))).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/ZZClienteAlheio|Origem do lead/);
    const socio = await get(THIAGO);
    expect(socio.body.linhas[0].celulas.origem.valor).toBe('#0013 ZZClienteAlheio');
  });
  it('consultor: engenheiro de venda de outro consultor não aparece nas opções da lista', async () => {
    const res = await get(NILCE);
    const eng = res.body.catalogo.colunas.find((c: { chave: string }) => c.chave === 'engenheiro');
    expect(eng.opcoes).toEqual([]);                    // Marcos é da venda da Giovanna
    expect(JSON.stringify(res.body)).not.toContain('Marcos');
  });
  it('consultor: lista aberta traz as opções escritas e os valores só das vendas dele; o sócio vê todos', async () => {
    const res = await get(NILCE);
    const col = (k: string) => res.body.catalogo.colunas.find((c: { chave: string }) => c.chave === k);
    expect(col('concessionaria')).toMatchObject({ opcoes: ['Cemig', 'Equatorial'], livre: true });   // "Energisa" é só da venda da Giovanna
    expect(col('tipo_estrutura').opcoes).toEqual(['Fibromadeira', 'Fibrometal', 'Solo', 'Mini Trilo']);   // "Cerâmico" também
    expect(JSON.stringify(res.body)).not.toMatch(/Energisa|Cerâmico/);
    expect(col('status_placa')).toMatchObject({ opcoes: ['Instalado', 'No cliente', 'Estoque', 'Comprar'], livre: false });
    expect(col('engenheiro').opcoes).toEqual([]);
    expect(col('forma_pagto')).toBeUndefined();        // lista de sócio nem chega
    const socio = await get(THIAGO);
    expect(socio.body.catalogo.colunas.find((c: { chave: string }) => c.chave === 'forma_pagto').opcoes).toContain('Pix');
    expect(socio.body.catalogo.colunas.find((c: { chave: string }) => c.chave === 'concessionaria').opcoes).toEqual(['Cemig', 'Equatorial', 'Energisa']);
  });
  it('consultor não tem a seção Financeiro: o Recebimento vai para a Venda; o sócio vê a Financeira', async () => {
    const cons = await get(NILCE);
    expect(cons.body.catalogo.grupos).not.toContain('Financeiro');
    expect(cons.body.catalogo.colunas.find((c: { chave: string }) => c.chave === 'recebimento').grupo).toBe('Venda');
    const socio = await get(THIAGO);
    expect(socio.body.catalogo.grupos).toContain('Financeiro');
    expect(socio.body.catalogo.colunas.find((c: { chave: string }) => c.chave === 'recebimento').grupo).toBe('Financeiro');
  });
  it('consultor sem venda: lista vazia (a tela mostra "Você ainda não tem venda cadastrada.")', async () => {
    h.usuarios['tk-sem'] = 'zeca@irmaosnaobra.app';
    const res = await get('Bearer tk-sem');
    expect(res.status).toBe(200);
    expect(res.body.linhas).toEqual([]);
    expect(res.body.catalogo.colunas.length).toBeGreaterThan(0);
  });
  it('planilha fora do ar sem cópia: 502 com mensagem; com cópia recente: serve e marca fonte.planilha=false', async () => {
    h.planilhaFora = true;
    const ruim = await get(THIAGO);
    expect(ruim.status).toBe(502);
    expect(ruim.body).toMatchObject({ ok: false, error: 'Não consegui ler a planilha agora. Tente de novo em instantes.' });
    h.planilhaFora = false;
    expect((await get(THIAGO)).status).toBe(200);
    h.planilhaFora = true;
    const copia = await get(THIAGO, '?fresco=1');
    expect(copia.status).toBe(200);
    expect(copia.body.fonte.planilha).toBe(false);
  });
  it('codigosSolarAtuais lê a planilha agora e recusa a cópia velha; codigosSolar (os outros chamadores) segue servindo o cache', async () => {
    expect(await codigosSolarAtuais()).toEqual(expect.arrayContaining(['#0057', '#0059']));
    h.planilhaFora = true;
    expect(await codigosSolar()).toEqual(expect.arrayContaining(['#0057']));   // cache de até 5 min, como sempre
    await expect(codigosSolarAtuais()).rejects.toMatchObject({ http: 502 });   // planilha não respondeu: a cópia velha NÃO vale
    h.planilhaFora = false;
    expect(await codigosSolarAtuais()).toEqual(expect.arrayContaining(['#0059']));
  });
  it('banco fora do ar: 502, nunca grade vazia fingindo que nada foi preenchido, e sem vazar o erro', async () => {
    h.erroLeitura = true;
    const res = await get(THIAGO);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('VALOR-SECRETO');
  });
});

describe('POST /clientes/solar/campo', () => {
  it('consultor grava na venda dele: devolve a célula (sistema, por, em) e o progresso novo', async () => {
    const antes = (await get(NILCE)).body.linhas[0].progresso;
    const res = await post({ codigo: '#0057', coluna: 'engenheiro', valor: 'guilherme' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.celula).toMatchObject({ valor: 'guilherme', origem: 'sistema', por: 'nilce' });
    expect(res.body.celula.em).toBe(res.body.em);
    expect(res.body.progresso.preenchidas).toBe(antes.preenchidas + 1);
    const salvo = h.linhas.get('gestao_cliente:0057')!.value as { campos: Record<string, unknown>; alteracoes: Array<Record<string, unknown>>; em: string };
    expect(Object.keys(salvo.campos)).toEqual(['engenheiro']);
    expect(salvo.alteracoes).toEqual([{ em: res.body.em, por: 'nilce', coluna: 'engenheiro', antes: null }]);
    expect(salvo.em).toBe(res.body.em);
    expect((await get(NILCE)).body.linhas[0].celulas.engenheiro).toMatchObject({ valor: 'guilherme', origem: 'sistema' });
  });
  it('lista fechada recusa o que não é opção; lista aberta aceita outro e grava a grafia da opção', async () => {
    const ruim = await post({ codigo: '#0057', coluna: 'status_placa', valor: 'Reservado' });
    expect(ruim.status).toBe(400);
    expect(ruim.body.error).toBe('Escolha uma das opções da lista.');
    expect(h.linhas.size).toBe(0);
    const ok1 = await post({ codigo: '#0057', coluna: 'status_placa', valor: 'no CLIENTE' });
    expect(ok1.body.celula).toMatchObject({ valor: 'No cliente', origem: 'sistema' });
    const ok2 = await post({ codigo: '#0057', coluna: 'concessionaria', valor: 'cemig' });
    expect(ok2.body.celula.valor).toBe('Cemig');
    const ok3 = await post({ codigo: '#0057', coluna: 'concessionaria', valor: 'Enel Goiás' }, NILCE);
    expect(ok3.body.celula.valor).toBe('Enel Goiás');
    const longo = await post({ codigo: '#0057', coluna: 'tipo_estrutura', valor: 'x'.repeat(301) });
    expect(longo.status).toBe(400);
    const apaga = await post({ codigo: '#0057', coluna: 'concessionaria', valor: '' });
    expect(apaga.body.celula.origem).toBe('planilha');
  });
  it('consultor: a gravação confere contra as opções que ELE recebe (não vira a grafia de venda alheia); o sócio canoniza pelo catálogo inteiro', async () => {
    const a = await post({ codigo: '#0057', coluna: 'engenheiro', valor: 'marcos' });          // Marcos é engenheiro da venda da Giovanna
    expect(a.status).toBe(200);
    expect(a.body.celula.valor).toBe('marcos');                                                 // gravou como digitou, sem revelar a grafia alheia
    const b = await post({ codigo: '#0057', coluna: 'concessionaria', valor: 'energisa' });    // "Energisa" só existe na venda da Giovanna
    expect(b.body.celula.valor).toBe('energisa');
    const c = await post({ codigo: '#0057', coluna: 'concessionaria', valor: 'CEMIG' });       // escrita no catálogo: canoniza
    expect(c.body.celula.valor).toBe('Cemig');
    const d = await post({ codigo: '#0058', coluna: 'engenheiro', valor: 'marcos' }, THIAGO);
    expect(d.body.celula.valor).toBe('Marcos');
    const e = await post({ codigo: '#0058', coluna: 'concessionaria', valor: 'energisa' }, THIAGO);
    expect(e.body.celula.valor).toBe('Energisa');
  });
  it('consultor não grava lista de sócio (forma de pagamento): mesma resposta de coluna que não existe', async () => {
    const a = await post({ codigo: '#0057', coluna: 'forma_pagto', valor: 'Pix' });
    const b = await post({ codigo: '#0057', coluna: 'coluna_nada', valor: 'Pix' });
    expect(a.status).toBe(400);
    expect(a.body).toEqual(b.body);
    expect((await post({ codigo: '#0057', coluna: 'forma_pagto', valor: 'pix' }, THIAGO)).body.celula.valor).toBe('Pix');
  });
  it('#57 e #0057 gravam no mesmo registro', async () => {
    expect((await post({ codigo: '#57', coluna: 'cidade', valor: 'Catalão' })).status).toBe(200);
    expect([...h.linhas.keys()]).toEqual(['gestao_cliente:0057']);
  });
  it('consultor não grava venda de outro, e é a mesma resposta de venda que não existe', async () => {
    const outro = await post({ codigo: '#0058', coluna: 'cidade', valor: 'X' });
    const nada = await post({ codigo: '#0999', coluna: 'cidade', valor: 'X' });
    expect(outro.status).toBe(404);
    expect(outro.body).toEqual(nada.body);
    expect(h.linhas.size).toBe(0);
  });
  it('a posse vem ANTES das outras recusas: venda de outro ou inexistente dão o mesmo 404 mesmo com coluna de sócio, calculada ou valor inválido', async () => {
    const casos = [['#0058', 'valor_venda', '1'], ['#0999', 'valor_venda', '1'], ['#0058', 'total_lucro', '1'], ['#0999', 'total_lucro', '1'],
      ['#0058', 'cadastro_trello', 'xx'], ['#0999', 'cadastro_trello', 'xx'], ['#0058', 'coluna_nada', '1'], ['#0999', 'coluna_nada', '1']];
    const resp = [];
    for (const [codigo, coluna, valor] of casos) { const r2 = await post({ codigo, coluna, valor }); resp.push([r2.status, JSON.stringify(r2.body)]); }
    for (const x of resp) expect(x).toEqual([404, JSON.stringify({ ok: false, error: 'Venda não encontrada.' })]);
  });
  it('consultor não grava coluna de sócio: mesma resposta de coluna que não existe, sem nada gravado', async () => {
    const socio = await post({ codigo: '#0057', coluna: 'valor_venda', valor: '1' });
    const inexistente = await post({ codigo: '#0057', coluna: 'coluna_que_nao_existe', valor: '1' });
    expect(socio.status).toBe(400);
    expect(socio.body).toEqual(inexistente.body);
    expect(h.linhas.size).toBe(0);
  });
  it('consultor não troca o consultor da venda; sócio troca, e a venda sai da lista do antigo', async () => {
    const res = await post({ codigo: '#0057', coluna: 'consultor', valor: 'Giovanna' });
    expect(res.status).toBe(403);
    expect(h.linhas.size).toBe(0);
    expect((await post({ codigo: '#0057', coluna: 'consultor', valor: 'Giovanna' }, THIAGO)).status).toBe(200);
    expect((await get(NILCE)).body.linhas.map((l: { codigo: string }) => l.codigo)).toEqual(['#0059']);
    expect((await get(GIOVANNA)).body.linhas.map((l: { codigo: string }) => l.codigo)).toEqual(['#0057', '#0058']);
    expect((await post({ codigo: '#0057', coluna: 'cidade', valor: 'X' }, NILCE)).status).toBe(404);
  });
  it('sócio grava dinheiro e a mesma venda aparece com o valor novo só para sócio', async () => {
    const res = await post({ codigo: '#0058', coluna: 'valor_venda', valor: 'R$ 12.345,67' }, THIAGO);
    expect(res.status).toBe(200);
    expect(res.body.celula.valor).toBe(12345.67);
    expect(JSON.stringify((await get(GIOVANNA)).body)).not.toContain('12345');
  });
  it('coluna calculada, código e valor inválido: 400 com motivo, nada gravado', async () => {
    expect((await post({ codigo: '#0057', coluna: 'total_lucro', valor: '1' }, THIAGO)).status).toBe(400);
    expect((await post({ codigo: '#0057', coluna: 'codigo', valor: '#9' }, THIAGO)).status).toBe(400);
    const data = await post({ codigo: '#0057', coluna: 'cadastro_trello', valor: '31/02/2026' });
    expect(data.status).toBe(400);
    expect(data.body.error).toBe('Data inválida. Use dd/mm/aaaa.');
    expect((await post({ codigo: '#0057', coluna: 'qtd_placa', valor: 'dez' })).status).toBe(400);
    expect((await post({ codigo: 'abc', coluna: 'cidade', valor: 'x' })).status).toBe(400);
    expect((await post({ codigo: '#0057', coluna: 'cidade', valor: 'x', base_em: 'ontem' })).status).toBe(400);
    expect((await request(app).post('/gerador/clientes/solar/campo').set('Authorization', NILCE).send({ codigo: '#0057', coluna: 'cidade', valor: 'x' })).status).toBe(400);
    expect(h.linhas.size).toBe(0);
  });
  it('vazio apaga a sobrescrita e a planilha volta a valer', async () => {
    await post({ codigo: '#0057', coluna: 'cidade', valor: 'Catalão' });
    const res = await post({ codigo: '#0057', coluna: 'cidade', valor: '' });
    expect(res.status).toBe(200);
    expect(res.body.celula).toEqual({ valor: 'Uberlandia', origem: 'planilha' });
    expect((h.linhas.get('gestao_cliente:0057')!.value as { campos: object }).campos).toEqual({});
    // apagar o que já não tem sobrescrita é no-op e não cria registro
    const antes = h.linhas.size;
    expect((await post({ codigo: '#0059', coluna: 'cidade', valor: '' })).status).toBe(200);
    expect(h.linhas.size).toBe(antes);
  });
  it('conflito: outra pessoa gravou depois de base_em: 409 com o valor atual, sem gravar; a mesma pessoa não conflita', async () => {
    await post({ codigo: '#0057', coluna: 'cidade', valor: 'Catalão' }, THIAGO);
    const antes = JSON.stringify(h.linhas.get('gestao_cliente:0057'));
    const res = await post({ codigo: '#0057', coluna: 'cidade', valor: 'Araguari' }, NILCE);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, conflito: true, por: 'thiago', celula: { valor: 'Catalão', origem: 'sistema', por: 'thiago' } });
    expect(res.body.error).toBe('thiago alterou esta célula agora. Valor atual: Catalão');
    expect(JSON.stringify(h.linhas.get('gestao_cliente:0057'))).toBe(antes);
    // com a base certa (o `em` que o servidor devolveu) passa
    expect((await post({ codigo: '#0057', coluna: 'cidade', valor: 'Araguari', base_em: res.body.em }, NILCE)).status).toBe(200);
    // a mesma pessoa em outra aba, com base antiga, não conflita consigo mesma
    expect((await post({ codigo: '#0057', coluna: 'uf', valor: 'GO' }, NILCE)).status).toBe(200);
    expect((await post({ codigo: '#0057', coluna: 'uf', valor: 'MG' }, NILCE)).status).toBe(200);
  });
  it('conflito em quem APAGOU a sobrescrita: a trilha pega', async () => {
    await post({ codigo: '#0057', coluna: 'cidade', valor: 'Catalão' }, THIAGO);
    await post({ codigo: '#0057', coluna: 'cidade', valor: '' }, THIAGO);
    const res = await post({ codigo: '#0057', coluna: 'cidade', valor: 'X' }, NILCE);
    expect(res.status).toBe(409);
    expect(res.body.celula).toEqual({ valor: 'Uberlandia', origem: 'planilha' });
  });
  it('corrida: outra pessoa grava OUTRA célula da mesma venda entre a leitura e a gravação: as duas ficam', async () => {
    await post({ codigo: '#0057', coluna: 'uf', valor: 'GO' }, THIAGO);   // cria o registro
    h.noMeio = () => {
      const l = h.linhas.get('gestao_cliente:0057')!;
      const v = l.value as { campos: Record<string, unknown>; alteracoes: unknown[] };
      h.linhas.set('gestao_cliente:0057', {
        updated_at: `2026-10-13T13:00:00.${String(++h.tique).padStart(6, '0')}+00:00`,
        value: { ...v, campos: { ...v.campos, cidade: { valor: 'Catalão', por: 'diego', em: new Date().toISOString() } } },
      });
    };
    const res = await post({ codigo: '#0057', coluna: 'engenheiro', valor: 'Marcos' }, NILCE);
    expect(res.status).toBe(200);
    const campos = (h.linhas.get('gestao_cliente:0057')!.value as { campos: Record<string, unknown> }).campos;
    expect(Object.keys(campos).sort()).toEqual(['cidade', 'engenheiro', 'uf']);
  });
  it('erro do banco: 500 genérico, sem valor de célula na resposta nem no console', async () => {
    const espiao = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.erroGravar = true;
    const res = await post({ codigo: '#0057', coluna: 'cidade', valor: 'SEGREDO-DE-CELULA' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/SEGREDO|VALOR-SECRETO/);
    expect(JSON.stringify(espiao.mock.calls)).not.toMatch(/SEGREDO|VALOR-SECRETO/);
  });
});

describe('Obras enxerga o que a Gestão preencheu', () => {
  const obra = async (auth: string, codigo = '#0057') => {
    const res = await request(app).get('/gerador/solar/obras').set('Authorization', auth);
    expect(res.status).toBe(200);
    return res.body.obras.find((o: { codigo: string }) => o.codigo === codigo);
  };
  it('data do fim da instalação gravada na Gestão fecha a instalação e a obra avança de etapa', async () => {
    expect((await obra(NILCE)).etapaAtual).toBe('instalacao');
    expect((await post({ codigo: '#0057', coluna: 'fim_instalacao', valor: '05/10/2026' })).status).toBe(200);
    const depois = await obra(NILCE);
    expect(depois.etapas.find((e: { chave: string }) => e.chave === 'instalacao')).toMatchObject({ feito: true, em: '2026-10-05' });
    expect(depois.etapaAtual).toBe('vistoria');
    // apagar volta a valer a planilha
    await post({ codigo: '#0057', coluna: 'fim_instalacao', valor: '' });
    expect((await obra(NILCE)).etapaAtual).toBe('instalacao');
  });
  it('a resposta de Obras para consultor continua sem dinheiro mesmo com sobrescrita de valor feita por sócio', async () => {
    await post({ codigo: '#0057', coluna: 'valor_venda', valor: '9.999,99' }, THIAGO);
    const res = await request(app).get('/gerador/solar/obras').set('Authorization', NILCE);
    expect(JSON.stringify(res.body)).not.toMatch(/9999|valores/);
    const socio = await request(app).get('/gerador/solar/obras').set('Authorization', DIEGO);
    expect(socio.body.obras.find((o: { codigo: string }) => o.codigo === '#0057').valores.venda).toBe(9999.99);
  });
  it('trocar o consultor na Gestão vale também para marcar "pedi depoimento": o novo marca, o antigo recebe 404', async () => {
    const marcar = (auth: string) => request(app).post('/gerador/solar/obras/marcar').set('Authorization', auth).send({ codigo: '#0057', tipo: 'depoimento_pedido' });
    expect((await post({ codigo: '#0057', coluna: 'consultor', valor: 'Giovanna' }, THIAGO)).status).toBe(200);
    expect((await marcar(NILCE)).status).toBe(404);
    expect((await marcar(GIOVANNA)).status).toBe(200);
  });
  it('banco das sobrescritas fora do ar: Obras continua servindo a planilha', async () => {
    h.erroLeitura = true;
    const res = await request(app).get('/gerador/solar/obras').set('Authorization', NILCE);
    expect(res.status).toBe(200);
    expect(res.body.obras.map((o: { codigo: string }) => o.codigo).sort()).toEqual(['#0057', '#0059']);
  });
});

describe('planilha do alocador: fresca, cópia do cache e fallback sem overlay', () => {
  it('fresca falhou: a cópia vem só do cache (sem baixar), com o consultor efetivo; overlays fora: consultor vazio em toda linha', async () => {
    h.linhas.set('gestao_cliente:0057', { updated_at: 'g', value: { campos: { consultor: { valor: 'Giovanna', por: 'thiago', em: '2026-10-13T10:00:00.000Z' } }, alteracoes: [], em: null } });
    const fresca = await leituraAtualDaPlanilha();
    expect(fresca.vendas.find((v) => v.codigo === '#0057')?.consultor).toBe('Giovanna');
    const deps = dependenciasDoAlocador();
    h.planilhaFora = true;
    await expect(deps.lerPlanilhaAtual()).rejects.toBeTruthy();
    const baixou = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const copia = await deps.lerPlanilhaCopia!();
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(baixou);   // a cópia não baixa nada
    expect(copia.codigos).toEqual(fresca.codigos);
    expect(copia.vendas.find((v) => v.codigo === '#0057')?.consultor).toBe('Giovanna');
    // overlays fora: o consultor do CSV pode não ser o efetivo, então fica vazio (só sócio vê a linha)
    h.erroLeitura = true;
    const semOverlay = await deps.lerPlanilhaCopia!();
    expect(semOverlay.codigos).toEqual(fresca.codigos);
    expect(semOverlay.vendas.every((v) => v.consultor === '')).toBe(true);
    // sem cache nenhum: a cópia falha (o Excel fica desconhecido)
    limparCacheClientes();
    await expect(deps.lerPlanilhaCopia!()).rejects.toBeTruthy();
  });
});
