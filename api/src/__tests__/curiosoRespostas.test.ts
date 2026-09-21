import { describe, it, expect, vi, beforeEach } from 'vitest';

// A resposta do Curioso muda a pessoa de aba SEM ninguém olhar. O que este arquivo
// trava é o lado do freio: só sobe com valor claro do piso (R$ 50 mil) pra cima, nunca rebaixa,
// nunca sobrescreve quem já saiu do Curioso, e a nossa própria pergunta colada de
// volta (com os exemplos "50 mil, 100 mil ou 200 mil") não vira promoção.

// ── bancos falsos ───────────────────────────────────────────────────────────
const ger: Record<string, any[]> = {};
const main: Record<string, any[]> = {};
function consulta(db: Record<string, any[]>, tabela: string) {
  const filtros: Array<(r: any) => boolean> = [];
  const q: any = {
    select: () => q,
    eq: (c: string, v: any) => { filtros.push(r => r[c] === v); return q; },
    in: (c: string, vs: any[]) => { filtros.push(r => vs.includes(r[c])); return q; },
    contains: (c: string, vs: any[]) => { filtros.push(r => vs.every(v => (r[c] || []).includes(v))); return q; },
    gte: (c: string, v: any) => { filtros.push(r => String(r[c]) >= String(v)); return q; },
    is: (c: string, v: any) => { filtros.push(r => (r[c] ?? null) === v); return q; },
    order: () => q,
    limit: () => q,
    _de: 0, _ate: Infinity,
    range: (de: number, ate: number) => { q._de = de; q._ate = ate; return q; },
    update: (patch: any) => {
      const aplica = (f: (r: any) => boolean) => {
        (db[tabela] || []).filter(f).forEach(r => Object.assign(r, patch));
        return Promise.resolve({ data: null, error: null });
      };
      return { eq: (c: string, v: any) => aplica(r => r[c] === v), in: (c: string, vs: any[]) => aplica(r => vs.includes(r[c])) };
    },
    then: (ok: any, ko: any) =>
      Promise.resolve({ data: (db[tabela] || []).filter(r => filtros.every(f => f(r))).slice(q._de, q._ate + 1), error: null }).then(ok, ko),
  };
  return q;
}
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => consulta(ger, t) } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => consulta(main, t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { lerValorDaResposta, valorNormalizado, ehEcoDaPauta, lerRespostasCurioso, decidirPessoa, type Fala } from '../services/io/curiosoRespostas';
import { valorEmMil } from '../services/io/eletropostoPares';

const PERGUNTA = 'Oi {nome}, tudo bem?\nAqui é da Irmãos na Obra.\n'
  + 'Você pediu informações sobre investir em eletroposto com a gente.\n'
  + 'Quanto você pensa em investir?\nPode responder só com o valor. Por exemplo: 50 mil, 100 mil ou 200 mil.';

describe('lerValorDaResposta: só decide o que é claro', () => {
  it.each([
    ['140 mil', 140], ['R$ 70 mil', 70], ['uns 100 mil', 100], ['R$ 100.000,00', 100], ['R$ 70.000', 70],
    ['70 mil reais', 70], ['200.000 reais', 200], ['1,5 milhão', 1500], ['2 milhões', 2000],
    ['Tenho 150 mil pra investir', 150], ['Bom dia! Posso colocar R$ 280 mil', 280],
    // o piso desceu pra 50 em 21/09
    ['uns 50 mil', 50], ['R$ 50.000,00', 50], ['tenho 60 mil guardado', 60],
  ])('"%s" sobe com %s mil', (texto, mil) => {
    expect(lerValorDaResposta(texto)).toEqual({ tipo: 'valor', mil });
  });

  it.each([
    'Bom dia', 'Tenho 2 carregadores', '2025', 'não tenho 70 mil', 'Não sei ainda', 'depende do ponto',
    'até 100 mil', 'menos de 200 mil', 'no máximo 150 mil', 'precisa de 70 mil?', 'uns 40 mil', 'R$ 49.000',
    'entre 50 e 100 mil', 'entre 80 e 120 mil', '5', 'meu cep é 38400-000', 'dia 25 eu vejo', 'R$ 30.000,00',
  ])('"%s" não decide nada: fica pro consultor', texto => {
    expect(lerValorDaResposta(texto)).toBeNull();
  });

  // Tiradas das mensagens REAIS da linha (21/09/2026), onde a primeira versão errava:
  // conta de luz, kWh, BTU, carregador de 80 kW, CEP e aluguel viravam investimento.
  it.each([
    '140', 'uns 200', 'Umas 100', '300', '70000', '70.000', '38401188',
    'uns 100k', '80k', 'Preciso de 500 k', 'Estou precisando de uma estação de recarga de 80k',
    '900 reais em média', 'A última conta é de R$680,00', 'R$330,00', 'Tarde 250 reais',
    'Atualmente 600 a 700 reais de consumo', 'Última conta, R$432,66 348KWh',
    'temos 150 mil habitantes', 'dois aparelhos de 120 mil btus',
    // mensagem real de 21/09: com o piso em 50, ela passaria a promover
    'Cidade tá crescendo muito, temos 50 mil.abitabtes será o primeiro aqui',
    'tenho 50 mil seguidores', 'carro com 80 mil km rodados',
    'Valor de Locação: R$ 140.000,00 mensais',
  ])('"%s" (mensagem real ou do mesmo tipo) não promove ninguém', texto => {
    expect(lerValorDaResposta(texto)).toBeNull();
  });

  it.each(['Sair', 'pare', 'Parar', 'Não quero.', 'Não tenho interesse', 'não tenho mais interesse',
    'Me tira dessa lista', 'parem de me mandar isso', 'Não quero receber mensagem', 'não, obrigado',
    'Não, obrigado!', 'pensando bem, não tenho interesse'])('"%s" é pedido pra sair', texto => {
    expect(lerValorDaResposta(texto)).toEqual({ tipo: 'sair' });
  });

  it('condição não é pedido pra sair, e o nosso rodapé colado de volta também não', () => {
    expect(lerValorDaResposta('Se o modelo de negócio de vocês for franquia eu não tenho interesse.')).toBeNull();
    expect(lerValorDaResposta('Temos um ponto em Goiás. Você recebe isso porque se cadastrou como parceiro '
      + 'do eletroposto na Irmãos na Obra. Se não quiser mais, é só responder aqui que a gente tira da lista.')).toBeNull();
  });

  it('"não quero perder essa" NÃO é pedido pra sair', () => {
    expect(lerValorDaResposta('não quero perder essa oportunidade')).toBeNull();
  });
});

// ── A REVISÃO ADVERSARIAL DE 21/09 (piso em 50) ─────────────────────────────
// A primeira versão barrava por exceção, e um revisor escreveu 65 mensagens com
// dinheiro de OUTRA coisa: as 65 promoveram. Estas são elas (e as holdouts, escritas
// depois do rascunho de correção). A lista branca fecha todas; nenhuma pode voltar.
describe('dinheiro que não é resposta de investimento não promove ninguém', () => {
  it.each([
    // compra, custo, bem, financiamento, dívida, faturamento, o orçamento da própria linha
    'paguei 60 mil no carro', 'faturo 80 mil ao mês', 'financiei 150 mil pela caixa', 'devo 50 mil no cartão',
    'o terreno vale 200 mil', 'o orçamento de vocês deu 55 mil', 'meu faturamento é 80 mil',
    'a casa saiu por 200 mil', 'tenho um carro de 80 mil', 'Meu Corolla é 150 mil', 'o lote é 60 mil',
    'a entrada do apê foi 70 mil', 'o prêmio da mega tá 60 milhões',
    // dinheiro de outra pessoa, que já foi, ou que falta
    'Meu primo investiu 100 mil com vocês', 'Um amigo meu tem 200 mil pra investir',
    'Tinha 100 mil mas gastei tudo', 'Perdi 60 mil na pandemia', 'Faltam 50 mil pra eu completar o valor',
    // negação de WhatsApp, desejo, recusa, piada
    'Quem me dera ter 100 mil kkkkk', 'Queria ter 50 mil kkk', 'Ñ tenho 50 mil', 'n tenho 60 mil',
    'Tenho nem 50 mil kkk', 'nem 50 mil eu tenho', 'Nossa, 50 mil é muito pra mim', '50 mil tá fora da minha realidade',
    // teto em outra grafia
    'Menos que 50 mil', 'abaixo dos 60 mil', 'no max 80 mil', 'Máximo 60 mil',
    // contáveis que não são dinheiro
    'Aqui em Patos são uns 150 mil moradores', 'município de 60 mil habitante',
    'a BR aqui tem fluxo de 60 mil veiculos/dia', 'Meu insta tem 55 mil', 'Já rodei 120 mil com meu elétrico',
    'terreno de 60 mil m²',
  ])('"%s"', texto => {
    expect(lerValorDaResposta(texto)).toBeNull();
  });
});

describe('resposta de valor limpa continua subindo', () => {
  it.each([
    ['uns 80 mil', 80], ['tenho 150 mil pra investir', 150], ['R$ 60.000,00', 60], ['posso colocar 1 milhão', 1000],
    ['Uns 80 mil.obrigado', 80], ['60.000,00 reais', 60], ['cinquenta mil', 50], ['Oitenta mil', 80],
    ['meio milhão', 500], ['Tenho uns 150 mil pra investir, tá?', 150], ['Bom dia tudo bem? Tenho 100 mil', 100],
    ['Sim, 80 mil à vista', 80], ['Temos 200 mil disponível', 200], ['50mil', 50], ['R$ 60 mil', 60],
  ])('"%s" sobe com %s mil', (texto, mil) => {
    expect(lerValorDaResposta(texto)).toEqual({ tipo: 'valor', mil });
  });
  it('fora da forma fechada vai pro consultor, mesmo sendo resposta boa (é o preço de não errar sozinho)', () => {
    for (const t of ['Oi Thiago, tenho 100 mil', 'Tenho 150 mil pra investir em 1 ponto', '150.000 mil', 'uns 100k'])
      expect(lerValorDaResposta(t), t).toBeNull();
  });
});

describe('a segunda rodada adversarial (21/09): nada disso decide sozinho', () => {
  it.each([
    // faixa com separador novo, teto dito ao contrário, preço do produto
    '30 pra 60 mil', 'de 20 à 60 mil', '30/60 mil', '30~60 mil', '30 – 60 mil', '50 pra 100 mil',
    '60 mil ou menos', 'uns 80 mil pra menos', 'o valor do eletroposto é 150 mil', 'o eletroposto é 150 mil',
    'um ponto é 80 mil', 'então o investimento é 150 mil', 'meu caixa é 80 mil', 'consigo 80 mil na caixa',
    // emoji que muda o sentido, formato que engana o parser, zero e ano
    'Tenho 1 milhão 😂😂', '100 mil 🤔', '80 mil❓', '2000 mil', 'tenho 5000 mil',
    'agora 0, 100 mil só em 2028', 'em 2027 uns 100 mil', '5 milhões', 'R$ 5.000.000',
  ])('"%s" não promove', texto => {
    expect(lerValorDaResposta(texto)).toBeNull();
  });
  it('"1.5 milhão" (ponto decimal) é 1,5 milhão, e não 5 milhões como a versão anterior lia', () => {
    expect(lerValorDaResposta('1.5 milhão')).toEqual({ tipo: 'valor', mil: 1500 });
  });
  it.each([
    'Não me tira da lista', 'Por favor não me tirem dessa lista', 'Não precisa me tirar da lista', 'Não parem de mandar',
    'Ninguém me tira daqui', 'Não estou sem interesse', 'Quem disse que não tenho interesse', 'Franquia não tenho interesse',
    'Solar não tenho interesse', 'Financiamento não quero', 'Áudio não me mande mais', 'O dono do terreno não tem interesse',
    'Meu sócio não tem interesse', 'Agora não tenho interesse', 'Claro, não tenho interesse nenhum',
  ])('"%s" NÃO é pedido pra sair', texto => {
    expect(lerValorDaResposta(texto)).not.toEqual({ tipo: 'sair' });
  });
  it.each(['Me tira da lista por favor', 'Não tenho interesse, muito obrigado', 'Obrigado, mas não tenho interesse',
    'Não, não tenho interesse', 'Quero sair da lista', 'Não estou interessado', 'Não me interessa'])('"%s" é pedido pra sair', texto => {
    expect(lerValorDaResposta(texto)).toEqual({ tipo: 'sair' });
  });
});

describe('a terceira rodada adversarial (21/09)', () => {
  it.each([
    // espanto com o exemplo da pergunta, objeção, pedido de confirmação, hesitação
    'Oi?? 50 mil', 'Desculpa? 50 mil', 'Opa?! 100 mil', 'Obrigado, mas 50 mil...', 'Obrigada mas 100 mil',
    '50 mil né?', '1 milhão né?', 'Olha, 50 mil...', 'Tenho 50 mil...',
    // sorriso e aplauso ao lado de milhão costumam ser ironia; "quero" sem investir é desejo
    'Tenho 1 milhão 😀', 'Tenho 1 milhão 👏👏', '2 milhões 😃😃', 'Quero 1 milhão', 'Quero 100 mil livre', 'Quero 80 mil à vista',
  ])('"%s" não promove', texto => {
    expect(lerValorDaResposta(texto)).toBeNull();
  });
  it.each(['Quero investir 1 milhão', 'Quero colocar 100 mil', 'Uns 80 mil 👍'])('"%s" continua subindo', texto => {
    expect(lerValorDaResposta(texto)).toMatchObject({ tipo: 'valor' });
  });
  it.each(['Cancelar', 'Sim, cancelar', 'Remover', 'Me tira do grupo', 'Sair do grupo', 'Não, pare', 'Não, me tira'])(
    '"%s" NÃO tira da lista (responde a outra coisa: reunião, grupo)', texto => {
      expect(lerValorDaResposta(texto)).not.toEqual({ tipo: 'sair' });
    });
  it.each(['Não, muito obrigado', 'Não obg', 'Não, valeu', 'Ñ obrigado', 'Não, obrigado 🙏'])('"%s" é pedido pra sair', texto => {
    expect(lerValorDaResposta(texto)).toEqual({ tipo: 'sair' });
  });
});

describe('pedido pra sair: só o pedido, no fim, sem pergunta nem condição', () => {
  it.each([
    'me tira uma dúvida?', 'Me tira uma dúvida: é franquia?', 'Quem disse que não tenho interesse?',
    'Se for franquia não tenho interesse', 'Se for caro, sem interesse', 'me tira uma duvida, vcs financiam',
    'Não tenho interesse em solar, só no eletroposto', 'sem interesse em solar, só eletroposto',
    'Não me mande áudio, só texto pfv', 'Pare de mandar audio, prefiro ler', 'Não quero receber ligação, só mensagem',
  ])('"%s" NÃO é pedido pra sair', texto => {
    expect(lerValorDaResposta(texto)).not.toEqual({ tipo: 'sair' });
  });
  it.each(['pode me tirar da lista', 'me exclui dessa lista', 'Não quero mais', 'não mande mais nada', 'Sair 🙏'])(
    '"%s" é pedido pra sair', texto => {
      expect(lerValorDaResposta(texto)).toEqual({ tipo: 'sair' });
    });
});

describe('valorNormalizado volta igual pelo classificador', () => {
  it.each([50, 70, 99.5, 140, 280, 500, 1000, 1500, 2000])('%s mil', mil => {
    expect(valorEmMil(valorNormalizado(mil))).toBe(mil);
  });
  it('arredonda antes de escolher a palavra', () => {
    expect(valorNormalizado(999.96)).toBe('R$ 1 milhão');
    expect(valorNormalizado(1999)).toBe('R$ 2 milhões');
  });
});

describe('ehEcoDaPauta', () => {
  it('a pergunta colada de volta é eco, mesmo com o nome já trocado', () => {
    const colada = 'Oi Maria, tudo bem? Aqui é da Irmãos na Obra. Pode responder só com o valor. Por exemplo: 50 mil, 100 mil ou 200 mil.';
    expect(ehEcoDaPauta(colada, PERGUNTA)).toBe(true);
  });
  it('resposta de verdade não é eco', () => {
    expect(ehEcoDaPauta('uns 140 mil', PERGUNTA)).toBe(false);
  });
});

// ── a varredura ─────────────────────────────────────────────────────────────
const ENVIO = new Date(Date.now() - 3 * 3600_000).toISOString();   // 3 h atrás: a janela é de 14 dias
const INST = '3F26F6ECE67D72BB7FCA6244BF24326C';
const naLinha = (m: any) => ({ instancia: INST, tipo: 'texto', ...m });
const depois = (min: number) => new Date(Date.parse(ENVIO) + min * 60_000).toISOString();

beforeEach(() => {
  ger.avisos = [
    { id: 'p1', corpo: PERGUNTA, publicos: ['curioso'] },
    // pauta combinada: o curioso que tambem e cadastro sai carimbado 'capital'
    { id: 'p2', corpo: PERGUNTA, publicos: ['capital', 'curioso'] },
    // pauta de oportunidade: NAO pergunta valor, a resposta dela nao e lida
    { id: 'p0', corpo: 'Ponto novo em Goias, quer ver?', publicos: ['capital'] },
  ];
  ger.eletroposto_parceria = [
    { id: 45, lado: 'capital', nome: 'Cadastrado', telefone: '5534999990045', capital_faixa: 'Depende do ponto', status: 'novo', created_at: '2026-09-10' },
    { id: 46, lado: 'capital', nome: 'Combinada', telefone: '5534999990046', capital_faixa: 'Depende do ponto', status: 'novo', created_at: '2026-09-10' },
    { id: 47, lado: 'capital', nome: 'Oportunidade', telefone: '5534999990047', capital_faixa: 'Depende do ponto', status: 'novo', created_at: '2026-09-10' },
  ];
  ger.eletroposto_nota1 = [
    { id: 7, nome: 'Da ficha', telefone: '5534999990007', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' },
    { id: 8, nome: 'Eco', telefone: '5534999990008', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' },
    { id: 9, nome: 'Sai', telefone: '5534999990009', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' },
    // o consultor ja registrou 140: nao e mais curioso
    { id: 10, nome: 'Ja subiu', telefone: '5534999990010', ficha: '', valor_investir: 'R$ 140 mil', status: 'novo', created_at: '2026-09-12' },
  ];
  ger.agendamentos = [];
  const envio = (id: number, phone: string, ref: string, aviso_id = 'p1', lado = 'curioso') => ({
    id, aviso_id, phone, lado, status: 'ok', enviado_em: ENVIO, origem_ref: ref, resposta_valor: null,
  });
  ger.aviso_envios = [
    envio(1, '5534999990007', 'nota1:7'), envio(2, '5534999990045', 'parceria:45'),
    envio(3, '5534999990008', 'nota1:8'), envio(4, '5534999990009', 'nota1:9'),
    envio(5, '5534999990010', 'nota1:10'),
    envio(6, '5534999990046', 'parceria:46', 'p2', 'capital'),
    envio(7, '5534999990047', 'parceria:47', 'p0', 'capital'),
  ];
  // a Z-API entrega o 0045 sem o nono digito: a varredura tem que achar do mesmo jeito
  main.wa_mensagens = [
    { telefone: '5534999990007', from_me: false, is_group: false, momment: depois(-25 * 60), texto: 'uns 300 mil' },  // um dia ANTES do envio
    { telefone: '5534999990007', from_me: false, is_group: false, momment: depois(5), texto: 'Bom dia' },
    { telefone: '5534999990007', from_me: false, is_group: false, momment: depois(6), texto: 'uns 140 mil' },
    { telefone: '553499990045', from_me: false, is_group: false, momment: depois(9), texto: 'R$ 100 mil' },
    { telefone: '5534999990008', from_me: false, is_group: false, momment: depois(3),
      texto: 'Oi Eco, tudo bem? Pode responder só com o valor. Por exemplo: 50 mil, 100 mil ou 200 mil.' },
    { telefone: '5534999990009', from_me: false, is_group: false, momment: depois(2), texto: '100 mil' },
    { telefone: '5534999990009', from_me: false, is_group: false, momment: depois(4), texto: 'pensando bem, não tenho interesse' },
    { telefone: '5534999990010', from_me: false, is_group: false, momment: depois(7), texto: '80 mil' },
    { telefone: '5534999990046', from_me: false, is_group: false, momment: depois(8), texto: '140 mil' },
    { telefone: '5534999990047', from_me: false, is_group: false, momment: depois(8), texto: 'tenho 200 mil' },
  ].map(naLinha);
});

describe('lerRespostasCurioso', () => {
  it('sobe quem respondeu do piso pra cima, na linha de onde veio', async () => {
    const r = await lerRespostasCurioso();
    expect(ger.eletroposto_nota1.find(x => x.id === 7).valor_investir).toBe('R$ 140 mil');
    expect(ger.eletroposto_parceria.find(x => x.id === 45).capital_faixa).toBe('R$ 100 mil');
    expect(r.subiram).toBe(3);
  });

  it('na pauta combinada (Investidores + Curioso), o curioso carimbado capital também sobe', async () => {
    await lerRespostasCurioso();
    expect(ger.eletroposto_parceria.find(x => x.id === 46).capital_faixa).toBe('R$ 140 mil');
  });

  it('resposta a pauta que NAO pergunta o valor não é lida', async () => {
    await lerRespostasCurioso();
    expect(ger.eletroposto_parceria.find(x => x.id === 47).capital_faixa).toBe('Depende do ponto');
    expect(ger.aviso_envios.find(x => x.id === 7).resposta_valor).toBeNull();
  });

  it('depois que a linha fala de OUTRO assunto com a pessoa, a resposta não é mais à nossa pergunta', async () => {
    ger.eletroposto_nota1.push(
      { id: 11, nome: 'Solar também', telefone: '5534999990011', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' },
      { id: 12, nome: 'Respondeu antes', telefone: '5534999990012', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' },
    );
    ger.aviso_envios.push(
      { id: 20, aviso_id: 'p1', phone: '5534999990011', lado: 'curioso', status: 'ok', enviado_em: ENVIO, origem_ref: 'nota1:11', resposta_valor: null },
      { id: 21, aviso_id: 'p1', phone: '5534999990012', lado: 'curioso', status: 'ok', enviado_em: ENVIO, origem_ref: 'nota1:12', resposta_valor: null },
    );
    main.wa_mensagens.push(...[
      // o eco do NOSSO envio chegando pelo webhook: não conta como outra conversa
      { telefone: '5534999990011', from_me: true, is_group: false, momment: depois(0.5), texto: 'Quanto você pensa em investir?' },
      // a Giovanna pergunta do financiamento do solar, e a pessoa responde a ELA
      { telefone: '5534999990011', from_me: true, is_group: false, momment: depois(10), texto: 'Quanto você quer financiar?' },
      { telefone: '5534999990011', from_me: false, is_group: false, momment: depois(12), texto: 'uns 80 mil' },
      // aqui a resposta veio ANTES da linha falar de outra coisa: vale
      { telefone: '5534999990012', from_me: true, is_group: false, momment: depois(1), texto: 'Quanto você pensa em investir?' },
      { telefone: '5534999990012', from_me: false, is_group: false, momment: depois(5), texto: 'uns 90 mil' },
      { telefone: '5534999990012', from_me: true, is_group: false, momment: depois(20), texto: 'Perfeito, vou te mandar as opções' },
    ].map(naLinha));
    await lerRespostasCurioso();
    expect(ger.eletroposto_nota1.find(x => x.id === 11).valor_investir).toBeNull();
    expect(ger.eletroposto_nota1.find(x => x.id === 12).valor_investir).toBe('R$ 90 mil');
  });

  it('a mensagem de ANTES do envio não conta', async () => {
    await lerRespostasCurioso();
    expect(ger.eletroposto_nota1.find(x => x.id === 7).valor_investir).not.toBe('R$ 300 mil');
  });

  it('a nossa pergunta colada de volta não promove ninguém', async () => {
    await lerRespostasCurioso();
    expect(ger.eletroposto_nota1.find(x => x.id === 8).valor_investir).toBeNull();
    expect(ger.aviso_envios.find(x => x.id === 3).resposta_valor).toBeNull();
  });

  it('balões que se contradizem ("100 mil" e depois "não tenho interesse") ficam com o consultor', async () => {
    const r = await lerRespostasCurioso();
    const linha = ger.eletroposto_nota1.find(x => x.id === 9);
    expect(linha.status).toBe('novo');
    expect(linha.valor_investir).toBeNull();
    expect(r.sairam).toBe(0);
  });

  it('pauta do grupo Curioso que NÃO pergunta o valor não é lida', async () => {
    ger.avisos.push({ id: 'p9', corpo: 'Temos um ponto pronto em Goiás. Quer conhecer?', publicos: ['curioso'] });
    ger.eletroposto_nota1.push({ id: 13, nome: 'Oferta', telefone: '5534999990013', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' });
    ger.aviso_envios.push({ id: 30, aviso_id: 'p9', phone: '5534999990013', lado: 'curioso', status: 'ok', enviado_em: ENVIO, origem_ref: 'nota1:13', resposta_valor: null });
    main.wa_mensagens.push(naLinha({ telefone: '5534999990013', from_me: false, is_group: false, momment: depois(5), texto: 'Não, obrigado' }));
    await lerRespostasCurioso();
    expect(ger.eletroposto_nota1.find(x => x.id === 13).status).toBe('novo');
  });

  it('quem já saiu do Curioso não é sobrescrito', async () => {
    await lerRespostasCurioso();
    expect(ger.eletroposto_nota1.find(x => x.id === 10).valor_investir).toBe('R$ 140 mil');
    // mas o envio fica decidido, pra não ser relido a cada tick
    expect(ger.aviso_envios.find(x => x.id === 5).resposta_valor).toBe('lido sem mudança: R$ 80 mil');
  });

  it('é idempotente: a segunda passada não mexe em nada', async () => {
    await lerRespostasCurioso();
    const r2 = await lerRespostasCurioso();
    expect(r2.subiram).toBe(0);
    expect(r2.sairam).toBe(0);
  });

  it('CURIOSO_RESPOSTAS_OFF=1 desliga sem ler nada', async () => {
    process.env.CURIOSO_RESPOSTAS_OFF = '1';
    try {
      const r = await lerRespostasCurioso();
      expect(r.olhados).toBe(0);
      expect(ger.eletroposto_nota1.find(x => x.id === 7).valor_investir).toBeNull();
    } finally {
      delete process.env.CURIOSO_RESPOSTAS_OFF;
    }
  });
});

describe('decidirPessoa: a conversa inteira, depois do silêncio', () => {
  const T0 = Date.parse('2026-09-21T12:00:00Z');
  const em = (min: number) => new Date(T0 + min * 60_000).toISOString();
  const dela = (min: number, texto: string, tipo = 'texto'): Fala => ({ momment: em(min), texto, from_me: false, tipo });
  const linha = (min: number, texto: string): Fala => ({ momment: em(min), texto, from_me: true, tipo: 'texto' });
  const decide = (falas: Fala[], agoraMin = 120) => decidirPessoa(falas, T0, PERGUNTA, T0 + agoraMin * 60_000);

  it('junta os balões: "Quem me dera ter" + "100 mil" não promove', () => {
    expect(decide([dela(3, 'Quem me dera ter'), dela(4, '100 mil')]).decide).toBeNull();
  });
  it('junta os balões: "100 mil" + "*10 mil" não promove', () => {
    expect(decide([dela(3, '100 mil'), dela(4, '*10 mil')]).decide).toBeNull();
  });
  it('junta os balões: "Não quero" + "perder essa oportunidade" não tira da lista', () => {
    expect(decide([dela(3, 'Não quero'), dela(4, 'perder essa oportunidade')]).decide).toBeNull();
  });
  it('cumprimento num balão e valor no outro promove', () => {
    expect(decide([dela(3, 'Bom dia'), dela(4, 'uns 80 mil')]).decide).toEqual({ tipo: 'valor', mil: 80 });
  });
  it('espera 10 minutos de silêncio antes de decidir', () => {
    expect(decide([dela(3, 'uns 80 mil')], 8)).toMatchObject({ decide: null, motivo: 'esperando_silencio' });
    expect(decide([dela(3, 'uns 80 mil')], 14).decide).toEqual({ tipo: 'valor', mil: 80 });
  });
  it('conversa da linha com a pessoa nas 24 h ANTES da pergunta: fica com o consultor', () => {
    expect(decide([linha(-60, 'Quanto você quer financiar?'), dela(5, 'uns 80 mil')]))
      .toMatchObject({ decide: null, motivo: 'conversa_antes' });
  });
  it('a PRÓPRIA pessoa falando de outra coisa nas 24 h antes (o consultor responde pelo celular, sob o LID): fica com o consultor', () => {
    expect(decide([dela(-120, 'Preciso cancelar a reunião de amanhã, consegue?'), dela(5, 'Não, obrigado')]))
      .toMatchObject({ decide: null, motivo: 'conversa_antes' });
  });
  it('outra pauta com a mesma saudação não é tomada pelo eco da nossa pergunta', () => {
    expect(decide([linha(50 * 60, 'Oi Maria, tudo bem? Aqui é da Irmãos na Obra. Temos um ponto em Goiás. Quer conhecer?'), dela(50 * 60 + 5, 'Não tenho interesse')], 60 * 60).decide).toBeNull();
  });
  it('pedido pra sair espera 3 horas de silêncio (a pessoa pode completar a frase)', () => {
    expect(decide([dela(3, 'Não tenho interesse')], 30)).toMatchObject({ decide: null, motivo: 'esperando_silencio' });
    expect(decide([dela(3, 'Não tenho interesse')], 200).decide).toEqual({ tipo: 'sair' });
  });
  it('áudio ou foto na resposta: fica com o consultor', () => {
    expect(decide([dela(3, 'uns 80 mil'), dela(4, '', 'audio')])).toMatchObject({ decide: null, motivo: 'nao_e_texto' });
  });
  it('o eco da nossa pergunta, mesmo 3 minutos depois, não fecha a janela', () => {
    expect(decide([linha(3, 'Quanto você pensa em investir?'), dela(5, 'uns 80 mil')]).decide).toEqual({ tipo: 'valor', mil: 80 });
  });
  it('resposta 3 dias depois já é outra conversa', () => {
    expect(decide([dela(73 * 60, 'uns 80 mil')], 74 * 60)).toMatchObject({ decide: null, motivo: 'sem_resposta' });
  });
});
