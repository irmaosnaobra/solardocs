import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// COLUNAS SITUAÇÃO E CONSULTOR da aba Investidores (cadastros do eletroposto, /gerador).
// Lê o JavaScript REAL do index.html (como eletropostoDestino.test.ts) e roda
// cadChave e cadSituacao contra sessões da Helena e cards de agenda de exemplo.

const GERADOR = join(__dirname, '../../../dashboard/public/gerador/index.html');

type Sit = { cod: string; rotulo: string; detalhe: string; consultor: string; quando: string };
type Tela = {
  cadChave: (t: unknown) => string;
  cadQuandoBRT: (iso: string) => string;
  cadSituacao: (r: Record<string, unknown>, lado?: string) => Sit;
  cadSituacaoCel: (r: Record<string, unknown>, lado?: string) => string;
  cadConsultorCel: (r: Record<string, unknown>, lado?: string) => string;
  cadSituacaoContagem: (l: Record<string, unknown>[], lado?: string) => { rotulo: string; cod: string; n: number }[];
  __set: (atend: Map<string, unknown>, agendas: Map<string, unknown>) => void;
};

function telaReal(): Tela {
  const html = readFileSync(GERADOR, 'utf8').split('\r\n').join('\n');
  const de = 'const CAD_AG_STATUS = {', ate = '/** Lê a situação da agente';
  const i = html.indexOf(de), j = html.indexOf(ate);
  // Marcador que sumiu = tela refatorada. Melhor um teste quebrado do que um que
  // passa sem comparar nada.
  if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu do /gerador: "${de}" … "${ate}"`);
  const e0 = html.indexOf('function escapeHtml(s) {');
  const e1 = html.indexOf('\n}\n', e0);
  if (e0 < 0 || e1 < 0) throw new Error('escapeHtml sumiu do /gerador');
  return new Function(
    'let cadLado = "capital";\n'
    + html.slice(e0, e1 + 2) + '\n'
    + html.slice(i, j)
    + '\nreturn { cadChave, cadQuandoBRT, cadSituacao, cadSituacaoCel, cadConsultorCel, cadSituacaoContagem,'
    + ' __set: (a, g) => { cadAtend = a; cadAgendasChave = g; } };',
  )() as Tela;
}

const T = telaReal();
const AGORA = '2026-10-12T15:00:00Z';   // 12:00 em Brasília

const sessao = (estagio: string, extra: Record<string, unknown> = {}) => ({
  chave: '3499111222', estagio, consultor: 'Diego', motivo: null, aberto_em: '2026-10-12T10:00:00Z',
  movimento_em: '2026-10-12T11:15:00Z', agendamento_id: null, resumo: '', erro_envio: false, ...extra,
});
const poe = (s?: Record<string, unknown>, card?: Record<string, unknown>) => {
  T.__set(s ? new Map([[String(s.chave), s]]) : new Map(), card ? new Map([['3491112222', card]]) : new Map());
};
const pessoa = (extra: Record<string, unknown> = {}) => ({ telefone: '34991112222', status: 'novo', ...extra });

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(AGORA)); poe(); });
afterEach(() => { vi.useRealTimers(); });

describe('cadChave: a mesma chave que a api grava (DDD + 8 últimos)', () => {
  it('telefone com 55, com nono dígito e mascarado dão a mesma chave', () => {
    expect(T.cadChave('34991112222')).toBe('3491112222');
    expect(T.cadChave('5534991112222')).toBe('3491112222');
    expect(T.cadChave('+55 (34) 99111-2222')).toBe('3491112222');
    expect(T.cadChave('553491112222')).toBe('3491112222');      // sem o nono dígito
    expect(T.cadChave('3491112222')).toBe('3491112222');
  });
  it('curto, vazio, nulo e número de grupo não têm chave', () => {
    for (const t of ['', null, undefined, '991112222', 'abc', '120363025246125000']) expect(T.cadChave(t), String(t)).toBe('');
  });
  it('o 55 só sai quando sobram 10 dígitos ou mais', () => {
    // DDD 55 (Rio Grande do Sul) com 11 dígitos: o 55 é DDD, não país
    expect(T.cadChave('55991112222')).toBe('5591112222');
  });
});

describe('cadSituacao: a sessão da Helena é a mais nova', () => {
  it('chamado', () => {
    poe(sessao('chamado', { chave: '3491112222' }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ cod: 'chamado', rotulo: 'Chamado', detalhe: 'Primeiro toque', consultor: 'Helena' });
  });
  it('conversando e horários enviados', () => {
    poe(sessao('conversando', { chave: '3491112222' }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ cod: 'conversando', rotulo: 'Conversando', consultor: 'Helena' });
    poe(sessao('ofertou', { chave: '3491112222' }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ cod: 'ofertou', rotulo: 'Horários enviados', consultor: 'Helena' });
  });
  it('adiado leva o resumo cortado em 80', () => {
    poe(sessao('adiado', { chave: '3491112222', resumo: 'a'.repeat(200) }));
    const x = T.cadSituacao(pessoa());
    expect(x).toMatchObject({ cod: 'adiado', rotulo: 'Adiado', consultor: 'Helena' });
    expect(x.detalhe).toHaveLength(80);
  });
  it('humano vira Com consultor, com o nome do consultor', () => {
    poe(sessao('humano', { chave: '3491112222', consultor: 'Thiago' }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ cod: 'consultor', rotulo: 'Com consultor', consultor: 'Thiago' });
  });
  it('sem interesse: "Disse não" ou "Sem resposta"', () => {
    poe(sessao('sem_interesse', { chave: '3491112222', motivo: 'disse_nao' }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ rotulo: 'Sem interesse', detalhe: 'Disse não', consultor: 'Helena' });
    poe(sessao('sem_interesse', { chave: '3491112222', motivo: 'sem_resposta' }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ rotulo: 'Sem interesse', detalhe: 'Sem resposta' });
  });
  it('pediu para parar: os três motivos de "não procure" viram alerta, com a Helena', () => {
    // Os motivos que a agente grava em sem_interesse (investidorAgente.ts): disse_nao,
    // pediu_parar, opt_out_por_outra_trilha e fora_do_padrao.
    for (const motivo of ['pediu_parar', 'opt_out_por_outra_trilha', 'fora_do_padrao']) {
      poe(sessao('sem_interesse', { chave: '3491112222', motivo }));
      expect(T.cadSituacao(pessoa()), motivo).toMatchObject({ cod: 'parou', rotulo: 'Pediu para parar', consultor: 'Helena' });
    }
    poe(sessao('sem_interesse', { chave: '3491112222', motivo: null }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ rotulo: 'Sem interesse', detalhe: 'Sem resposta' });
  });
  it('agendado sem card mostra o consultor da sessão', () => {
    poe(sessao('agendado', { chave: '3491112222', consultor: 'Diego' }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ cod: 'agendado', rotulo: 'Agendado', consultor: 'Diego' });
  });
  it('erro de envio da abertura vira Envio falhou', () => {
    poe(sessao('chamado', { chave: '3491112222', erro_envio: true }));
    expect(T.cadSituacao(pessoa())).toMatchObject({ cod: 'erro', rotulo: 'Envio falhou', consultor: 'Helena' });
  });
  it('o telefone com 55 casa com a sessão pela chave', () => {
    poe(sessao('conversando', { chave: '3491112222' }));
    expect(T.cadSituacao(pessoa({ telefone: '+55 34 99111-2222' })).rotulo).toBe('Conversando');
  });
  it('a data do movimento é a da sessão, em Brasília', () => {
    poe(sessao('conversando', { chave: '3491112222' }));
    expect(T.cadSituacao(pessoa()).quando).toBe('2026-10-12T11:15:00Z');
    expect(T.cadQuandoBRT('2026-10-12T11:15:00Z')).toBe('12/10 08:15');
    expect(T.cadQuandoBRT('2026-10-13T02:30:00Z')).toBe('12/10 23:30');
    expect(T.cadQuandoBRT('lixo')).toBe('');
  });
});

describe('cadSituacao: o card da agenda', () => {
  it('card mais novo que a sessão manda, com o vendedor do card', () => {
    poe(sessao('conversando', { chave: '3491112222', movimento_em: '2026-10-10T10:00:00Z' }),
      { quando: '2026-10-11T12:00:00Z', status: 'fez_orcamento', vendedor_nome: 'Giovanna' });
    expect(T.cadSituacao(pessoa())).toMatchObject({ cod: 'card', rotulo: 'Fez orçamento', consultor: 'Giovanna', quando: '2026-10-11T12:00:00Z' });
  });
  it('sessão mais nova que o card manda', () => {
    poe(sessao('chamado', { chave: '3491112222', movimento_em: '2026-10-12T11:00:00Z' }),
      { quando: '2026-09-01T12:00:00Z', status: 'nao_atendeu', vendedor_nome: 'Diego' });
    expect(T.cadSituacao(pessoa())).toMatchObject({ rotulo: 'Chamado', consultor: 'Helena' });
  });
  it('card agendado no futuro vira Agendado com a data do card', () => {
    poe(sessao('ofertou', { chave: '3491112222', movimento_em: '2026-10-12T11:00:00Z' }),
      { quando: '2026-10-14T13:00:00Z', status: 'agendado', vendedor_nome: 'Diego' });
    expect(T.cadSituacao(pessoa())).toMatchObject({ cod: 'agendado', rotulo: 'Agendado', consultor: 'Diego', quando: '2026-10-14T13:00:00Z' });
  });
  it('card de outro DDD com o mesmo final não é da pessoa', () => {
    T.__set(new Map(), new Map([['3191112222', { quando: '2026-10-01T12:00:00Z', status: 'fechou', vendedor_nome: 'Diego' }]]));
    expect(T.cadSituacao(pessoa())).toMatchObject({ rotulo: 'Na fila', consultor: '' });
  });
  it('sem sessão, o status do card usa o rótulo da agenda', () => {
    poe(undefined, { quando: '2026-10-01T12:00:00Z', status: 'em_atendimento', vendedor_nome: 'Diego' });
    expect(T.cadSituacao(pessoa())).toMatchObject({ rotulo: 'Negociando', consultor: 'Diego' });
    poe(undefined, { quando: '2026-10-01T12:00:00Z', status: 'fechou', vendedor_nome: 'Diego' });
    expect(T.cadSituacao(pessoa()).rotulo).toBe('Vendido');
  });
});

describe('cadSituacao: sem sessão e sem card', () => {
  it('novo é Na fila em Investidores e Sem atendimento nas outras abas', () => {
    expect(T.cadSituacao(pessoa(), 'capital')).toMatchObject({ cod: 'fila', rotulo: 'Na fila', consultor: '' });
    expect(T.cadSituacao(pessoa(), 'ponto')).toMatchObject({ cod: 'sem_atend', rotulo: 'Sem atendimento', consultor: '' });
    expect(T.cadSituacao(pessoa(), 'curioso').rotulo).toBe('Sem atendimento');
  });
  it('o status do cadastro vale: sem interesse, falando, conectado', () => {
    expect(T.cadSituacao(pessoa({ status: 'sem_interesse' }))).toMatchObject({ rotulo: 'Sem interesse', detalhe: 'Marcado no cadastro' });
    expect(T.cadSituacao(pessoa({ status: 'falando' })).rotulo).toBe('Falando');
    expect(T.cadSituacao(pessoa({ status: 'conectado' })).rotulo).toBe('Conectado');
  });
  it('sem telefone não casa com ninguém e não quebra', () => {
    poe(sessao('conversando', { chave: '' }));
    expect(T.cadSituacao({ telefone: null, status: null }).rotulo).toBe('Na fila');
  });
});

describe('as células e a contagem', () => {
  it('escapam HTML vindo do dado e mostram traço sem consultor', () => {
    poe(sessao('adiado', { chave: '3491112222', resumo: '<img src=x onerror=alert(1)>' }));
    const cel = T.cadSituacaoCel(pessoa());
    expect(cel).not.toContain('<img');
    expect(cel).toContain('&lt;img');
    expect(cel).toContain('12/10 08:15');
    poe();
    expect(T.cadConsultorCel(pessoa())).toContain('—');
    poe(sessao('humano', { chave: '3491112222', consultor: '<b>x</b>' }));
    expect(T.cadConsultorCel(pessoa())).toContain('&lt;b&gt;');
  });
  it('a contagem soma por rótulo, da maior para a menor', () => {
    poe(sessao('conversando', { chave: '3491112222' }));
    const lista = [pessoa(), pessoa({ telefone: '34988887777' }), pessoa({ telefone: '34977776666' })];
    expect(T.cadSituacaoContagem(lista, 'capital').map(c => `${c.rotulo} ${c.n}`)).toEqual(['Na fila 2', 'Conversando 1']);
  });
});
