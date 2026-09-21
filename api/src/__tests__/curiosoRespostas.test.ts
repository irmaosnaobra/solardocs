import { describe, it, expect, vi, beforeEach } from 'vitest';

// A resposta do Curioso muda a pessoa de aba SEM ninguém olhar. O que este arquivo
// trava é o lado do freio: só sobe com valor claro de 70 ou mais, nunca rebaixa,
// nunca sobrescreve quem já saiu do Curioso, e a nossa própria pergunta colada de
// volta (com os exemplos "70 mil, 140 mil ou 280 mil") não vira promoção.

// ── bancos falsos ───────────────────────────────────────────────────────────
const ger: Record<string, any[]> = {};
const main: Record<string, any[]> = {};
function consulta(db: Record<string, any[]>, tabela: string) {
  const filtros: Array<(r: any) => boolean> = [];
  const q: any = {
    select: () => q,
    eq: (c: string, v: any) => { filtros.push(r => r[c] === v); return q; },
    in: (c: string, vs: any[]) => { filtros.push(r => vs.includes(r[c])); return q; },
    gte: (c: string, v: any) => { filtros.push(r => String(r[c]) >= String(v)); return q; },
    order: () => q,
    limit: () => q,
    update: (patch: any) => ({
      eq: (c: string, v: any) => {
        (db[tabela] || []).filter(r => r[c] === v).forEach(r => Object.assign(r, patch));
        return Promise.resolve({ data: null, error: null });
      },
    }),
    then: (ok: any, ko: any) =>
      Promise.resolve({ data: (db[tabela] || []).filter(r => filtros.every(f => f(r))), error: null }).then(ok, ko),
  };
  return q;
}
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: { from: (t: string) => consulta(ger, t) } }));
vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => consulta(main, t) } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { lerValorDaResposta, valorNormalizado, ehEcoDaPauta, lerRespostasCurioso } from '../services/io/curiosoRespostas';
import { valorEmMil } from '../services/io/eletropostoPares';

const PERGUNTA = 'Oi {nome}, tudo bem?\nAqui é da Irmãos na Obra.\n'
  + 'Você pediu informações sobre investir em eletroposto com a gente.\n'
  + 'Quanto você pensa em investir?\nPode responder só com o valor. Por exemplo: 70 mil, 140 mil ou 280 mil.';

describe('lerValorDaResposta: só decide o que é claro', () => {
  it.each([
    ['140 mil', 140], ['R$ 70 mil', 70], ['uns 100k', 100], ['R$ 100.000,00', 100], ['70.000', 70],
    ['140', 140], ['uns 200', 200], ['70000', 70], ['1,5 milhão', 1500], ['2 milhões', 2000],
    ['Tenho 150 mil pra investir em 1 ponto', 150], ['entre 80 e 120 mil', 80],
    ['Bom dia! Posso colocar R$ 280 mil', 280],
  ])('"%s" sobe com %s mil', (texto, mil) => {
    expect(lerValorDaResposta(texto)).toEqual({ tipo: 'valor', mil });
  });

  it.each([
    'Bom dia', 'Tenho 2 carregadores', '2025', 'não tenho 70 mil', 'Não sei ainda', 'depende do ponto',
    'até 100 mil', 'menos de 200 mil', 'no máximo 150 mil', 'precisa de 70 mil?', 'uns 50 mil',
    'entre 50 e 100 mil', '5', 'meu cep é 38400-000', 'dia 25 eu vejo', 'R$ 30.000,00',
  ])('"%s" não decide nada: fica pro consultor', texto => {
    expect(lerValorDaResposta(texto)).toBeNull();
  });

  it.each(['Sair', 'pare', 'Não tenho interesse', 'não tenho mais interesse', 'Me tira dessa lista',
    'parem de me mandar isso', 'Não quero receber mensagem', 'não, obrigado'])('"%s" é pedido pra sair', texto => {
    expect(lerValorDaResposta(texto)).toEqual({ tipo: 'sair' });
  });

  it('"não quero perder essa" NÃO é pedido pra sair', () => {
    expect(lerValorDaResposta('não quero perder essa oportunidade')).toBeNull();
  });
});

describe('valorNormalizado volta igual pelo classificador', () => {
  it.each([70, 99.5, 140, 280, 500, 1000, 1500, 2000])('%s mil', mil => {
    expect(valorEmMil(valorNormalizado(mil))).toBe(mil);
  });
});

describe('ehEcoDaPauta', () => {
  it('a pergunta colada de volta é eco, mesmo com o nome já trocado', () => {
    const colada = 'Oi Maria, tudo bem? Aqui é da Irmãos na Obra. Pode responder só com o valor. Por exemplo: 70 mil, 140 mil ou 280 mil.';
    expect(ehEcoDaPauta(colada, PERGUNTA)).toBe(true);
  });
  it('resposta de verdade não é eco', () => {
    expect(ehEcoDaPauta('uns 140 mil', PERGUNTA)).toBe(false);
  });
});

// ── a varredura ─────────────────────────────────────────────────────────────
const ENVIO = '2026-09-21T12:00:00.000Z';
const depois = (min: number) => new Date(Date.parse(ENVIO) + min * 60_000).toISOString();

beforeEach(() => {
  ger.avisos = [{ id: 'p1', corpo: PERGUNTA }];
  ger.eletroposto_parceria = [
    { id: 45, lado: 'capital', nome: 'Cadastrado', telefone: '5534999990045', capital_faixa: 'Até R$ 50 mil', status: 'novo', created_at: '2026-09-10' },
  ];
  ger.eletroposto_nota1 = [
    { id: 7, nome: 'Da ficha', telefone: '5534999990007', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' },
    { id: 8, nome: 'Eco', telefone: '5534999990008', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' },
    { id: 9, nome: 'Sai', telefone: '5534999990009', ficha: '', valor_investir: null, status: 'novo', created_at: '2026-09-12' },
    // o consultor ja registrou 140: nao e mais curioso
    { id: 10, nome: 'Ja subiu', telefone: '5534999990010', ficha: '', valor_investir: 'R$ 140 mil', status: 'novo', created_at: '2026-09-12' },
  ];
  ger.agendamentos = [];
  const envio = (id: number, phone: string, ref: string) => ({
    id, aviso_id: 'p1', phone, lado: 'curioso', status: 'ok', enviado_em: ENVIO, origem_ref: ref, resposta_valor: null,
  });
  ger.aviso_envios = [
    envio(1, '5534999990007', 'nota1:7'), envio(2, '5534999990045', 'parceria:45'),
    envio(3, '5534999990008', 'nota1:8'), envio(4, '5534999990009', 'nota1:9'),
    envio(5, '5534999990010', 'nota1:10'),
  ];
  // a Z-API entrega o 0045 sem o nono digito: a varredura tem que achar do mesmo jeito
  main.wa_mensagens = [
    { telefone: '5534999990007', from_me: false, is_group: false, momment: depois(-30), texto: 'uns 300 mil' },  // ANTES do envio
    { telefone: '5534999990007', from_me: false, is_group: false, momment: depois(5), texto: 'Bom dia' },
    { telefone: '5534999990007', from_me: false, is_group: false, momment: depois(6), texto: 'uns 140 mil' },
    { telefone: '553499990045', from_me: false, is_group: false, momment: depois(9), texto: 'R$ 100 mil' },
    { telefone: '5534999990008', from_me: false, is_group: false, momment: depois(3),
      texto: 'Oi Eco, tudo bem? Pode responder só com o valor. Por exemplo: 70 mil, 140 mil ou 280 mil.' },
    { telefone: '5534999990009', from_me: false, is_group: false, momment: depois(2), texto: '100 mil' },
    { telefone: '5534999990009', from_me: false, is_group: false, momment: depois(4), texto: 'pensando bem, não tenho interesse' },
    { telefone: '5534999990010', from_me: false, is_group: false, momment: depois(7), texto: '80 mil' },
  ];
});

describe('lerRespostasCurioso', () => {
  it('sobe quem respondeu 70 ou mais, na linha de onde veio', async () => {
    const r = await lerRespostasCurioso();
    expect(ger.eletroposto_nota1.find(x => x.id === 7).valor_investir).toBe('R$ 140 mil');
    expect(ger.eletroposto_parceria.find(x => x.id === 45).capital_faixa).toBe('R$ 100 mil');
    expect(r.subiram).toBe(2);
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

  it('a última fala decisiva manda: disse 100 mil e depois pediu pra sair, saiu', async () => {
    const r = await lerRespostasCurioso();
    const linha = ger.eletroposto_nota1.find(x => x.id === 9);
    expect(linha.status).toBe('sem_interesse');
    expect(linha.valor_investir).toBeNull();
    expect(r.sairam).toBe(1);
  });

  it('quem já saiu do Curioso não é sobrescrito', async () => {
    await lerRespostasCurioso();
    expect(ger.eletroposto_nota1.find(x => x.id === 10).valor_investir).toBe('R$ 140 mil');
    // mas o envio fica decidido, pra não ser relido a cada tick
    expect(ger.aviso_envios.find(x => x.id === 5).resposta_valor).toBe('R$ 80 mil');
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
