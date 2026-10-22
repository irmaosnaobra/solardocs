import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// Cartão do Trello da venda solar: a parte pura (título, casamento do cartão, etiquetas, checklists, descrição), a sonda do quadro
// público e a ligação assinada com o campo novo. Dados inventados. Nada de rede (fetch simulado), banco ou Anthropic.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {}, geradorComServiceKey: false }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import {
  cidadeUfDoEndereco, localDoCartao, tituloDoCartao, mesmaPessoa, titularDaVenda, numeroDoTitulo, acharCartao, cartoesParecidos, proximoCodigoDaSequencia, etiquetasAutomaticas, validarEtiquetasExtra,
  planoDeEtiquetas, planoDeChecklists, passosDeChecklist, descricaoDoCartao, equipamentoDaProposta, nomearAnexos, lerRegistroBruto,
  ITENS_BACKOFFICE, ITENS_ENGENHARIA, lerNomesDeTodosOsCartoes, proximoNumeroDaSequencia, acharCartaoCriado, type CartaoDoQuadro,
  codigoDoTitulo, criadoEmDoCartao, lerTodosOsCartoes,
} from '../services/gerador/trelloVendaSolar';
import { trelloQuadroPublico, limparCacheQuadroPublico } from '../services/gerador/dossieVenda';
import { normalizarCadastro, validarCampo, ehCampo, type Cadastro } from '../services/gerador/cadastroVenda';
import { papelDoCampo, donoDoArquivo, motivoDeDescarte } from '../services/gerador/cadastroVendaPapeis';
import { assinarLigacao, assinaturaConfere, ligacaoAssinada, lerLigacaoBruta, ligacaoSoDoTrello, type Ligacao } from '../services/gerador/vendaSolarHub';

const ID_A = 'a'.repeat(24);
const cartao = (id: string, name: string, labels: string[] = []): CartaoDoQuadro =>
  ({ id, name, idList: 'l1', labels: labels.map((n) => ({ id: `lab-${n}`, name: n })) });

const cadastro = (campos: Record<string, string>): Cadastro =>
  normalizarCadastro({ campos: Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor, por: 'x', em: 'y', fonte: 'manual' }])) }, 'vendasolar');

describe('título do cartão', () => {
  it('com a venda ligada leva #NNNN; sem ela não leva', () => {
    expect(tituloDoCartao({ codigoVenda: '#0061', nome: 'Ana Souza', local: 'Uberlândia MG' })).toBe('#0061 - Ana Souza - Uberlândia MG');
    expect(tituloDoCartao({ codigoVenda: null, nome: 'Ana Souza', local: 'Uberlândia MG' })).toBe('Ana Souza - Uberlândia MG');
    expect(tituloDoCartao({ codigoVenda: '#0061', nome: '  Ana   Souza ', local: '' })).toBe('#0061 - Ana Souza');
  });
  it('sem titular: igual ao de sempre (nome do card, com ou sem #NNNN e local)', () => {
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: 'Odécio', titular: null, local: 'Uberaba MG' })).toBe('#0062 - Odécio - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: 'Odécio', titular: '  ', local: 'Uberaba MG' })).toBe('#0062 - Odécio - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: null, nome: '', local: '' })).toBe('Cliente');
  });
  it('titular que é a mesma pessoa do card: sai o nome do titular, sem parênteses', () => {
    expect(tituloDoCartao({ codigoVenda: '#0063', nome: 'Eloisa', titular: 'Eloisa Elena Souza', local: 'Uberaba MG' })).toBe('#0063 - Eloisa Elena Souza - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: '#0063', nome: 'Maria da Silva', titular: 'MARIA APARECIDA SILVA', local: 'Uberaba MG' })).toBe('#0063 - MARIA APARECIDA SILVA - Uberaba MG');
    expect(mesmaPessoa('José Antônio', 'Jose Antonio Pereira')).toBe(true);
    expect(mesmaPessoa('Odécio Ferreira', 'Eloisa Elena')).toBe(false);
  });
  it('titular que é outra pessoa: (PrimeiroNome do card) Titular, com e sem #NNNN e sem local', () => {
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: 'Odécio Ferreira', titular: 'Eloisa Elena', local: 'Uberaba MG' })).toBe('#0062 - (Odécio) Eloisa Elena - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: null, nome: 'Odécio Ferreira', titular: 'Eloisa Elena', local: 'Uberaba MG' })).toBe('(Odécio) Eloisa Elena - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: 'Odécio', titular: 'Eloisa Elena', local: '' })).toBe('#0062 - (Odécio) Eloisa Elena');
  });
  it('titularDaVenda: igual a nomeDaHomologacao (outra_pessoa ou vazio com tuc_nome = tuc_nome); contratante ou sem tuc_nome = contratante', () => {
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza', homologacao_mesmo: 'outra_pessoa', tuc_nome: 'Eloisa Elena' }))).toBe('Eloisa Elena');
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza', homologacao_mesmo: 'outra_pessoa' }))).toBe('Ana Souza');
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza', homologacao_mesmo: 'contratante', tuc_nome: 'Eloisa Elena' }))).toBe('Ana Souza');
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza', tuc_nome: 'Eloisa Elena' }))).toBe('Eloisa Elena');
    expect(titularDaVenda(cadastro({ nome: 'Ana Souza' }))).toBe('Ana Souza');
    expect(titularDaVenda(cadastro({}))).toBe('');
  });
  it('primeiro nome do card sem parênteses; só parênteses = sai só o titular', () => {
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: '(Odécio) Ferreira', titular: 'Eloisa Elena', local: 'Uberaba MG' })).toBe('#0062 - (Odécio) Eloisa Elena - Uberaba MG');
    expect(tituloDoCartao({ codigoVenda: '#0062', nome: '() Ferreira', titular: 'Eloisa Elena', local: 'Uberaba MG' })).toBe('#0062 - Eloisa Elena - Uberaba MG');
  });
  it('a cidade vem do fim do endereço da instalação, depois do contratante, depois do card', () => {
    expect(cidadeUfDoEndereco('Rua A, 10, Centro, Uberlândia - MG')).toEqual({ cidade: 'Uberlândia', uf: 'MG' });
    expect(cidadeUfDoEndereco('Rua A, 10, Centro, Catalão/GO 75700-000')).toEqual({ cidade: 'Catalão', uf: 'GO' });
    expect(cidadeUfDoEndereco('Rua A 10 Centro')).toBeNull();
    expect(cidadeUfDoEndereco('Rua A, 10, Centro, Cidade - XX')).toBeNull();
    expect(localDoCartao(cadastro({ endereco_ponto: 'Rua A, 10, Centro, Araguari - MG', cidade: 'Uberlândia', uf: 'MG' }), 'Outra')).toBe('Araguari MG');
    expect(localDoCartao(cadastro({ endereco_ponto: 'Rua A 10', cidade: 'Uberlândia', uf: 'mg' }), 'Outra')).toBe('Uberlândia MG');
    expect(localDoCartao(cadastro({}), 'Patos de Minas')).toBe('Patos de Minas');
  });
  it('numeroDoTitulo lê só o #NNNN do começo', () => {
    expect(numeroDoTitulo('#0064 - (Igor) Laurentino Neto- Catalão GO')).toBe('0064');
    expect(numeroDoTitulo('ELETROPOSTO #0001 - Bruno')).toBeNull();
    expect(numeroDoTitulo('Ana #0061')).toBeNull();
  });
});

describe('achar o cartão que já existe', () => {
  const quadro = [
    cartao('c1', '#0061 - Ana Souza Oliveira - Uberlândia MG'),
    cartao('c2', '#00610 - Outro Cliente - Catalão GO'),
    cartao('c3', '#0062 - Bruno Lima - Araguari MG'),
  ];
  const base = { cartoes: quadro, codigoVenda: '#0061', nome: 'Ana Souza' };
  it('acha por #NNNN exato: #0061 não casa com #00610', () => {
    const r = acharCartao(base);
    expect(r).toMatchObject({ tipo: 'achou', por: 'numero', cartao: { id: 'c1' } });
  });
  it('o guardado na ligação vem antes do número, e só vale se o cartão está aberto no quadro', () => {
    expect(acharCartao({ ...base, guardado: 'c3' })).toMatchObject({ tipo: 'achou', por: 'guardado', cartao: { id: 'c3' } });
    expect(acharCartao({ ...base, guardado: 'arquivado' })).toMatchObject({ tipo: 'achou', por: 'numero', cartao: { id: 'c1' } });
  });
  it('card_id escolhido vale só entre os cartões abertos; fora do quadro é ignorado aqui (a rota recusa antes)', () => {
    expect(acharCartao({ ...base, escolhido: 'c3' })).toMatchObject({ tipo: 'achou', por: 'escolhido', cartao: { id: 'c3' } });
    expect(acharCartao({ ...base, escolhido: 'de-outro-quadro' })).toMatchObject({ por: 'numero' });
  });
  it('dois cartões com o mesmo número = empate, nunca escolhe', () => {
    const r = acharCartao({ ...base, cartoes: [...quadro, cartao('c9', '#0061 - Ana Souza - Uberlândia MG')] });
    expect(r.tipo).toBe('empate');
    expect(r.tipo === 'empate' && r.candidatos.map((c) => c.id).sort()).toEqual(['c1', 'c9']);
  });
  it('nome parecido NUNCA escolhe cartão: sem número, sem guardado e sem escolhido o resultado é `nenhum`', () => {
    expect(acharCartao({ cartoes: quadro, codigoVenda: null })).toEqual({ tipo: 'nenhum' });
    // cartão de OUTRO número com nome parecido também não vira empate: venda vendida é cartão novo
    expect(acharCartao({ cartoes: [cartao('c5', '#0050 - Ana Souza Oliveira - Uberlândia MG')], codigoVenda: '#0061' })).toEqual({ tipo: 'nenhum' });
  });
  it('cartoesParecidos: só avisa. Nome do card (2+ palavras de 3+ letras) e nome do titular (palavra inteira, 2+ palavras)', () => {
    const ids = (r: CartaoDoQuadro[]) => r.map((c) => c.id).sort();
    expect(ids(cartoesParecidos({ cartoes: quadro, nome: 'Bruno Lima' }))).toEqual(['c3']);
    expect(cartoesParecidos({ cartoes: quadro, nome: 'Zeca Pagodinho' })).toEqual([]);
    expect(ids(cartoesParecidos({ cartoes: [cartao('x1', 'Maria Souza Lima - Uberlândia MG'), cartao('x2', 'Maria Souza Lima - Araguari MG')], nome: 'Maria Souza Lima' }))).toEqual(['x1', 'x2']);
    const q = [cartao('t1', '#0062 - (Odécio) Eloisa Elena - Uberaba MG'), cartao('t2', '#0064 - (Igor) Laurentino Neto - Catalão GO')];
    expect(cartoesParecidos({ cartoes: q, nome: 'Odécio Ferreira' })).toEqual([]);
    expect(ids(cartoesParecidos({ cartoes: q, nome: 'Odécio Ferreira', titular: 'Eloisa Elena' }))).toEqual(['t1']);
    const m = [cartao('m1', '#0051 - Mariana Lima Souza - Uberaba MG')];
    expect(cartoesParecidos({ cartoes: m, nome: 'Odécio', titular: 'Ana Lima' })).toEqual([]);
    expect(cartoesParecidos({ cartoes: m, nome: 'Odécio', titular: 'Lima' })).toEqual([]);
  });
  it('com o #NNNN da venda igual, quem decide é o número, mesmo com titular de outro nome', () => {
    const q = [cartao('t1', '#0062 - (Odécio) Eloisa Elena - Uberaba MG'), cartao('t2', '#0064 - (Igor) Laurentino Neto - Catalão GO')];
    expect(acharCartao({ cartoes: q, codigoVenda: '#0062' })).toMatchObject({ tipo: 'achou', por: 'numero', cartao: { id: 't1' } });
    expect(acharCartao({ cartoes: q, codigoVenda: '#0099' })).toEqual({ tipo: 'nenhum' });
  });
});

describe('número e idade do cartão (fase 2)', () => {
  it('codigoDoTitulo: só #NNNN de EXATAMENTE 4 dígitos no começo', () => {
    expect(codigoDoTitulo('#0065 - (Cristiano) Titular - Uberlândia MG')).toBe('#0065');
    expect(codigoDoTitulo('  #0064 - X')).toBe('#0064');
    expect(codigoDoTitulo('#20251 - Fora')).toBeNull();
    expect(codigoDoTitulo('#00610 - Outro')).toBeNull();
    expect(codigoDoTitulo('Cliente #0070')).toBeNull();
  });
  it('criadoEmDoCartao: a data dos 8 primeiros hexadecimais do id; id curto, sem hex ou nulo dá null', () => {
    const ms = Date.UTC(2026, 9, 22, 14, 55, 0);
    const id = `${(ms / 1000).toString(16)}${'0'.repeat(15)}1`;
    expect(id).toHaveLength(24);
    expect(criadoEmDoCartao(id)).toBe(ms);
    expect(criadoEmDoCartao('abc')).toBeNull();
    expect(criadoEmDoCartao('z'.repeat(24))).toBeNull();
    expect(criadoEmDoCartao(null)).toBeNull();
    expect(criadoEmDoCartao(undefined)).toBeNull();
  });
});

describe('leitura paginada dos cartões do quadro', () => {
  const cred = { key: 'k', token: 't' };
  const idsDe = (n: number): string[] => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(24, '0')}`);
  /** Um quadro de mentira com `ids` e `/cards/all` que respeita `limit` e `before` (do mais novo para o mais antigo). */
  const quadroDe = (ids: string[], nome: (id: string) => string) => {
    const paginas: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(url);
      const params = Object.fromEntries(u.searchParams);
      paginas.push(params);
      const todos = [...ids].sort().reverse().filter((id) => !params.before || id < params.before).slice(0, Number(params.limit));
      return new Response(JSON.stringify(todos.map((id) => ({ id, name: nome(id) }))), { status: 200 });
    }));
    return paginas;
  };
  afterEach(() => { vi.unstubAllGlobals(); });

  it('pagina com `before` (menor id lido) até vir página menor que o limite, e acha o maior número de qualquer página', async () => {
    const ids = idsDe(7);
    const paginas = quadroDe(ids, (id) => (id === ids[1] ? '#0090 - Antigo arquivado' : `Card ${id.slice(-2)}`));
    const r = await lerNomesDeTodosOsCartoes(cred, 'quadro', { pagina: 3, maxPaginas: 5 });
    expect(r.ok && r.dados).toHaveLength(7);
    expect(paginas.map((p) => p.before ?? null)).toEqual([null, ids[4], ids[1]]);
    const n = await proximoNumeroDaSequencia(cred, 'quadro', undefined, { pagina: 3, maxPaginas: 5 });
    expect(n).toEqual({ ok: true, dados: '#0091' });
  });
  it('lerTodosOsCartoes: ids e nomes de todas as páginas, com fields=name; lerNomesDeTodosOsCartoes devolve os mesmos nomes', async () => {
    const ids = idsDe(7);
    const paginas = quadroDe(ids, (id) => `Card ${id.slice(-2)}`);
    const r = await lerTodosOsCartoes(cred, 'quadro', { pagina: 3, maxPaginas: 5 });
    expect(r.ok && r.dados.map((c) => c.id).sort()).toEqual([...ids].sort());
    expect(paginas[0]).toMatchObject({ fields: 'name' });
    const nomes = await lerNomesDeTodosOsCartoes(cred, 'quadro', { pagina: 3, maxPaginas: 5 });
    expect(nomes.ok && nomes.dados).toEqual(r.ok && r.dados.map((c) => c.name));
    quadroDe(idsDe(7), () => 'Card');
    expect(await lerTodosOsCartoes(cred, 'quadro', { pagina: 3, maxPaginas: 2 })).toMatchObject({ ok: false, causa: 'quadro_grande' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    expect(await lerTodosOsCartoes(cred, 'quadro')).toMatchObject({ ok: false, causa: 'quadro' });
  });
  it('página cheia no último limite de páginas: erro próprio (quadro_grande), nunca número em cima de lista cortada', async () => {
    quadroDe(idsDe(7), () => 'Card');
    const r = await lerNomesDeTodosOsCartoes(cred, 'quadro', { pagina: 3, maxPaginas: 2 });
    expect(r).toMatchObject({ ok: false, causa: 'quadro_grande' });
    expect(await proximoNumeroDaSequencia(cred, 'quadro', undefined, { pagina: 3, maxPaginas: 2 })).toMatchObject({ ok: false, causa: 'quadro_grande' });
  });
  it('acharCartaoCriado: só adota cartão que NÃO estava na lista lida antes do POST, e só se for um único com o número', async () => {
    const velho = 'a'.repeat(24), novo = 'b'.repeat(24);
    const stub = (cartoes: Array<{ id: string; name: string }>) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(
      { name: 'Q', lists: [{ id: 'l1', name: 'L' }], labels: [], cards: cartoes.map((c) => ({ ...c, idList: 'l1' })) }), { status: 200 })));
    stub([{ id: velho, name: '#0063 - Velho' }]);
    expect(await acharCartaoCriado(cred, 'quadro', '#0063', new Set([velho]))).toBeNull();
    expect((await acharCartaoCriado(cred, 'quadro', '#0063'))?.id).toBe(velho);
    stub([{ id: velho, name: '#0063 - Velho' }, { id: novo, name: '#0063 - Nosso' }]);
    expect(await acharCartaoCriado(cred, 'quadro', '#0063', new Set([velho])).then((c) => c?.id)).toBe(novo);
    expect(await acharCartaoCriado(cred, 'quadro', '#0063')).toBeNull();   // dois com o mesmo número: não adota
  });
  it('planilha obrigatória na criação: falha vira causa `planilha`; sem a exigência (prévia) segue só com o quadro', async () => {
    quadroDe(idsDe(2), (id) => `#0010 - ${id.slice(-2)}`);
    const cai = async (): Promise<string[]> => { throw new Error('fora do ar'); };
    expect(await proximoNumeroDaSequencia(cred, 'quadro', cai, { planilhaObrigatoria: true })).toMatchObject({ ok: false, causa: 'planilha' });
    expect(await proximoNumeroDaSequencia(cred, 'quadro', cai)).toEqual({ ok: true, dados: '#0011' });
  });
});

describe('próximo número da sequência', () => {
  it('maior #NNNN do começo do nome (abertos e arquivados) + 1, com 4 dígitos; nome sem número no começo não conta', () => {
    expect(proximoCodigoDaSequencia(['#0062 - Bruno', '#0064 - (Igor) Laurentino', 'Ana Souza', 'ELETROPOSTO #0099 - X', 'Ana #0070'])).toBe('#0065');
    expect(proximoCodigoDaSequencia([])).toBe('#0001');
    expect(proximoCodigoDaSequencia(['#0999 - A'])).toBe('#1000');
    // só 4 dígitos exatos: #00610 e #20251 no começo do nome não entram na conta
    expect(proximoCodigoDaSequencia(['#00610 - Outro', '#20251 - Fora'], ['#20251'])).toBe('#0001');
  });
  it('o maior código da planilha também conta, nunca se reusa', () => {
    expect(proximoCodigoDaSequencia(['#0062 - Bruno'], ['#0061', '#0066', '#0065'])).toBe('#0067');
    expect(proximoCodigoDaSequencia(['#0070 - Bruno'], ['#0066'])).toBe('#0071');
    expect(proximoCodigoDaSequencia(['#0070 - Bruno'], ['lixo', '', '#12'])).toBe('#0071');
  });
});

describe('etiquetas', () => {
  it('automáticas: ligação do cadastro, Urbana/Rural, concessionária e EXDEDENTES', () => {
    expect(etiquetasAutomaticas(cadastro({ uc_fornecimento: 'trifasico', uc_classe: 'rural', concessionaria: 'CEMIG Distribuição S.A.', benef_1_uc: '123' })))
      .toEqual(['Trifásico', 'Rural', 'Cemig', 'EXDEDENTES']);
    expect(etiquetasAutomaticas(cadastro({ uc_fornecimento: 'monofasico', uc_classe: 'residencial', concessionaria: 'Equatorial Goiás' })))
      .toEqual(['Monofásico 220V', 'Urbana', 'Equatorial']);
    // sem ligação no cadastro, nada de ligação; classe vazia é Urbana; concessionária desconhecida não vira etiqueta
    expect(etiquetasAutomaticas(cadastro({ concessionaria: 'Energisa' }))).toEqual(['Urbana']);
  });
  it('extras: só equipes e FASTRACK; o resto é inválido', () => {
    expect(validarEtiquetasExtra(['equipe pablo', 'FASTRACK', 'Equipe Pablo'])).toEqual({ validas: ['Equipe Pablo', 'FASTRACK'], invalidas: [] });
    expect(validarEtiquetasExtra(['Cemig', 'Urbana', 'Equipe Branco'])).toEqual({ validas: ['Equipe Branco'], invalidas: ['Cemig', 'Urbana'] });
    expect(validarEtiquetasExtra(undefined)).toEqual({ validas: [], invalidas: [] });
  });
  const doQuadro = ['Monofásico 220V', 'Bifásico', 'Trifásico', 'Urbana', 'Rural', 'Cemig', 'Equatorial', 'EXDEDENTES', 'Equipe Pablo']
    .map((name) => ({ id: `lab-${name}`, name }));
  it('plano: só aplica o que existe no quadro e o cartão ainda não tem; nunca cria', () => {
    const p = planoDeEtiquetas(['Trifásico', 'Rural', 'Cemig', 'EXDEDENTES', 'Equipe Branco'], doQuadro, ['Rural']);
    expect(p.aplicar.map((e) => e.name)).toEqual(['Trifásico', 'Cemig', 'EXDEDENTES']);
    expect(p.ja_tem).toEqual(['Rural']);
    expect(p.ausentes).toEqual(['Equipe Branco']);
    expect(p.conflitos).toEqual([]);
  });
  it('plano: grupo exclusivo já ocupado não ganha a segunda etiqueta (conflito)', () => {
    const p = planoDeEtiquetas(['Trifásico', 'Urbana'], doQuadro, ['Bifásico', 'Rural']);
    expect(p.aplicar).toEqual([]);
    expect(p.conflitos).toEqual([{ desejada: 'Trifásico', existente: 'Bifásico' }, { desejada: 'Urbana', existente: 'Rural' }]);
  });
});

describe('checklists', () => {
  const slots = new Set(['disjuntor', 'medidor', 'padrao', 'fachada', 'documento_titular_uc', 'conta_luz', 'procuracao']);
  it('BACKOFFICE marca pelos documentos, telefone e e-mail; ENGENHARIA vem toda desmarcada', () => {
    const p = planoDeChecklists(slots, true, true);
    expect(p.BACKOFFICE.map((i) => i.nome)).toEqual([...ITENS_BACKOFFICE]);
    expect(p.ENGENHARIA.map((i) => i.nome)).toEqual([...ITENS_ENGENHARIA]);
    const marcados = p.BACKOFFICE.filter((i) => i.marcado).map((i) => i.nome);
    expect(marcados).toEqual(['Foto Disjuntor', 'Foto n° do Medidor', 'Foto Padrão', 'Doc - CNH ou Identidade (Se for CNPJ - contrato social)',
      'Conta de Energia', 'Procuração assinada', 'Telefone', 'Email', 'Foto Fachada']);
    expect(p.ENGENHARIA.some((i) => i.marcado)).toBe(false);
    const vazio = planoDeChecklists(new Set(), false, false);
    expect(vazio.BACKOFFICE.some((i) => i.marcado)).toBe(false);
    // CNH do contratante também marca o item do documento
    expect(planoDeChecklists(new Set(['documento_titular']), false, false).BACKOFFICE.find((i) => i.nome.startsWith('Doc'))?.marcado).toBe(true);
  });
  it('os dois datasheets marcam pelos itens datasheet_inversor e datasheet_modulo (texto exato do quadro)', () => {
    const marcado = (set: string[], nome: string) => planoDeChecklists(new Set(set), false, false).BACKOFFICE.find((i) => i.nome === nome)?.marcado;
    expect(marcado(['datasheet_inversor'], 'DataSheet Inversor')).toBe(true);
    expect(marcado(['datasheet_inversor'], 'Datasheet Modulo')).toBe(false);
    expect(marcado(['datasheet_modulo'], 'Datasheet Modulo')).toBe(true);
    expect(marcado(['datasheet_modulo'], 'DataSheet Inversor')).toBe(false);
    expect(marcado([], 'Datasheet Modulo')).toBe(false);
  });
  it('card existente: não recria a checklist que já tem e só marca o que ficou completo (nunca desmarca)', () => {
    const plano = planoDeChecklists(slots, true, false);
    const existentes = [
      { id: 'k1', name: 'Backoffice', checkItems: [
        { id: 'i1', name: 'Foto Disjuntor', state: 'incomplete' },
        { id: 'i2', name: 'Foto N° do Medidor', state: 'complete' },
        { id: 'i3', name: 'Foto Padrão', state: 'incomplete' },
        { id: 'i4', name: 'Telefone', state: 'complete' },
        { id: 'i5', name: 'Email', state: 'complete' },       // o plano diz desmarcado: fica como está
      ] },
    ];
    const passos = passosDeChecklist(plano, existentes);
    const back = passos.find((p) => p.nome === 'BACKOFFICE')!;
    expect(back.criar).toBeNull();
    expect(back.marcar.map((m) => m.idItem)).toEqual(['i1', 'i3']);
    // ENGENHARIA não existia: cria inteira
    expect(passos.find((p) => p.nome === 'ENGENHARIA')!.criar).toHaveLength(ITENS_ENGENHARIA.length);
  });
});

describe('descrição e comentário', () => {
  const equip = equipamentoDaProposta({
    qtd_placas: 18, inversor: 'Growatt 10K', qtd_inversor: 1,
    dados: { tab: { mod: 'Canadian CS7N', pot: 600, inv: 'x' }, qtdInv: 2 },
  });
  it('padrão do quadro: telefone, e-mail, ligação e as linhas em negrito', () => {
    const d = descricaoDoCartao({ telefone: '34988880001', email: 'ana@exemplo.com', ligacao: 'trifasico', equip });
    expect(d).toBe(['(34) 98888-0001', 'ana@exemplo.com', 'Trifásico', '**18 - Canadian CS7N 600W**', '**1 - Growatt 10K**'].join('\n\n'));
  });
  it('não repete a potência quando o modelo já a traz, e linha sem dado não sai', () => {
    const e = equipamentoDaProposta({ qtd_placas: 10, inversor: null, qtd_inversor: null, dados: { tab: { mod: 'Jinko 550W', pot: 550 } } });
    expect(descricaoDoCartao({ telefone: '', email: '', ligacao: '', equip: e })).toBe('**10 - Jinko 550W**');
    expect(descricaoDoCartao({ telefone: '', email: '', ligacao: 'xyz', equip: null })).toBe('');
  });
});

describe('anexos e registro', () => {
  it('nome do anexo = rótulo do item; do segundo em diante leva número', () => {
    const r = nomearAnexos([{ slot: 'fachada' }, { slot: 'conta_luz' }, { slot: 'fachada' }], (s) => (s === 'fachada' ? 'Foto da fachada' : 'Conta de luz'));
    expect(r.map((x) => x.nome)).toEqual(['Foto da fachada', 'Conta de luz', 'Foto da fachada 2']);
  });
  it('registro torto vira registro vazio; só ids de 24 hex entram', () => {
    expect(lerRegistroBruto('lixo')).toEqual({ card_id: null, comentario_id: null, anexados: {} });
    expect(lerRegistroBruto({ card_id: ID_A, comentario_id: 'x', anexados: { k: ID_A, j: 'curto' } }))
      .toEqual({ card_id: ID_A, comentario_id: null, anexados: { k: ID_A } });
  });
});

describe('uc_fornecimento no cadastro da venda solar', () => {
  it('é campo da venda solar (não do eletroposto) e valida monofásico, bifásico e trifásico', () => {
    expect(ehCampo('uc_fornecimento', 'vendasolar')).toBe(true);
    expect(ehCampo('uc_fornecimento', 'eletroposto')).toBe(false);
    expect(validarCampo('uc_fornecimento', 'Monofásico')).toEqual({ ok: true, valor: 'monofasico' });
    expect(validarCampo('uc_fornecimento', 'BIFÁSICO')).toEqual({ ok: true, valor: 'bifasico' });
    expect(validarCampo('uc_fornecimento', 'trifásico 380V')).toEqual({ ok: true, valor: 'trifasico' });
    expect(validarCampo('uc_fornecimento', '')).toEqual({ ok: true, valor: '' });
    expect(validarCampo('uc_fornecimento', 'hexafásico').ok).toBe(false);
  });
  it('a conta de luz da geradora pode preencher o campo (a guarda de papéis não o descarta)', () => {
    expect(papelDoCampo('uc_fornecimento')).toBe('ponto');
    const dono = donoDoArquivo('conta_luz', undefined, 'vendasolar');
    expect(motivoDeDescarte('uc_fornecimento', dono)).toBeNull();
    // a conta de uma beneficiária, não
    expect(motivoDeDescarte('uc_fornecimento', donoDoArquivo('conta_luz_beneficiaria', undefined, 'vendasolar'))).not.toBeNull();
  });
});

describe('ligação assinada com o campo novo', () => {
  beforeEach(() => { process.env.VINCULO_SOLAR_SECRET = 'segredo-so-do-teste'; });
  afterEach(() => { delete process.env.VINCULO_SOLAR_SECRET; });

  const assinaturaDeAntes = (card: number, l: { proposta: string | null; venda: string | null; por: string; em: string }): string =>
    crypto.createHmac('sha256', Buffer.from('segredo-so-do-teste', 'utf8')).update(`${card}|${l.proposta ?? ''}|${l.venda ?? ''}|${l.por}|${l.em}`).digest('hex');

  it('ligação gravada ANTES do campo (sem trello_card) segue válida com a fórmula antiga', () => {
    const l = { proposta: 'P1', venda: '#0061', por: 'nilce', em: '2026-10-20T10:00:00.000Z' };
    const sig = assinaturaDeAntes(201, l);
    expect(assinarLigacao(201, l)).toBe(sig);
    expect(assinaturaConfere(201, l, sig)).toBe(true);
    expect(ligacaoAssinada(201, { ...l, sig })).toEqual(l);
  });
  it('com trello_card a assinatura muda, e adulterar o cartão invalida a ligação', () => {
    const l: Ligacao = { proposta: 'P1', venda: null, por: 'nilce', em: '2026-10-20T10:00:00.000Z', trello_card: ID_A };
    const sig = assinarLigacao(201, l)!;
    expect(sig).not.toBe(assinaturaDeAntes(201, l));
    expect(ligacaoAssinada(201, { ...l, sig })).toEqual(l);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(ligacaoAssinada(201, { ...l, trello_card: 'b'.repeat(24), sig })).toBeNull();
    // tirar o cartão de uma ligação assinada com ele também a invalida
    expect(ligacaoAssinada(201, { proposta: 'P1', venda: null, por: 'nilce', em: l.em, sig })).toBeNull();
    vi.restoreAllMocks();
  });
  it('trello_card só entra com o formato de um id do Trello (24 hex)', () => {
    expect(lerLigacaoBruta({ trello_card: ID_A }).trello_card).toBe(ID_A);
    for (const ruim of ['curto', 'G'.repeat(24), `${ID_A}x`, 123, null, ['a']]) expect(lerLigacaoBruta({ trello_card: ruim })).not.toHaveProperty('trello_card');
  });
  it('ligação só do Trello: nada ligado e por = trello', () => {
    expect(ligacaoSoDoTrello({ proposta: null, venda: null, por: 'trello', em: 'x', trello_card: ID_A })).toBe(true);
    expect(ligacaoSoDoTrello({ proposta: 'P1', venda: null, por: 'trello', em: 'x' })).toBe(false);
    expect(ligacaoSoDoTrello({ proposta: null, venda: null, por: 'nilce', em: 'x' })).toBe(false);
  });
});

describe('sonda do quadro público', () => {
  beforeEach(() => { limparCacheQuadroPublico(); });
  afterEach(() => { vi.unstubAllGlobals(); });
  const stub = (resposta: () => Promise<Response>) => { const f = vi.fn(async (_url: string) => resposta()); vi.stubGlobal('fetch', f); return f; };

  it('200 com dados é público e a pergunta vai SEM key nem token; resposta definitiva é guardada', async () => {
    process.env.TRELLO_KEY = 'k'; process.env.TRELLO_TOKEN = 't';
    const f = stub(async () => new Response(JSON.stringify({ id: 'q1', name: 'Quadro' }), { status: 200 }));
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(String(f.mock.calls[0][0])).not.toMatch(/key=|token=/);
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    delete process.env.TRELLO_KEY; delete process.env.TRELLO_TOKEN;
  });
  it('401, 403 e 404 são privado, e "privado" NUNCA fica em cache: cada pergunta confere na hora', async () => {
    for (const status of [401, 403, 404]) {
      limparCacheQuadroPublico();
      const f = stub(async () => new Response('unauthorized', { status }));
      expect(await trelloQuadroPublico('Q')).toBe(false);
      expect(await trelloQuadroPublico('Q')).toBe(false);
      expect(f).toHaveBeenCalledTimes(2);
    }
  });
  it('privado e logo depois público: a segunda pergunta já vê o quadro aberto; "público" fica em cache só por 60 s', async () => {
    let status = 401;
    const f = stub(async () => (status === 200 ? new Response(JSON.stringify({ id: 'q' }), { status: 200 }) : new Response('x', { status })));
    expect(await trelloQuadroPublico('Q')).toBe(false);
    status = 200;
    expect(await trelloQuadroPublico('Q')).toBe(true);
    status = 401;
    expect(await trelloQuadroPublico('Q')).toBe(true);   // ainda no cache curto
    expect(f).toHaveBeenCalledTimes(2);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    expect(await trelloQuadroPublico('Q')).toBe(false);
    vi.useRealTimers();
  });
  it('rede caída, 5xx, 429 e corpo estranho contam como PÚBLICO e não entram no cache', async () => {
    let f = stub(async () => { throw new Error('rede caiu'); });
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    for (const status of [500, 502, 429]) {
      limparCacheQuadroPublico();
      f = stub(async () => new Response('x', { status }));
      expect(await trelloQuadroPublico('Q')).toBe(true);
    }
    limparCacheQuadroPublico();
    f = stub(async () => new Response('não é json', { status: 200 }));
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(await trelloQuadroPublico('Q')).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    // quando o quadro fecha, a próxima pergunta enxerga (resposta de erro não ficou guardada)
    limparCacheQuadroPublico();
    f = stub(async () => new Response('x', { status: 401 }));
    expect(await trelloQuadroPublico('Q')).toBe(false);
  });
});
