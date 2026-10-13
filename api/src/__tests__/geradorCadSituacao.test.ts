import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// COLUNA ATENDIMENTO e LISTA "NA AGENDA" dos cadastros do eletroposto (/gerador).
// Lê o JavaScript REAL do index.html (como eletropostoDestino.test.ts) e roda
// cadChave, cadSituacao, cadAtendimentoDe, o resumo, o período e o desenho das cinco
// listas (cadRender) contra sessões da Helena e cards de agenda de exemplo.

const GERADOR_DIR = join(__dirname, '../../../dashboard/public/gerador');
const GERADOR = join(GERADOR_DIR, 'index.html');

type Etq = { texto: string; tipo: 'negocio' | 'origem'; cor: string };
type Sit = { cod: string; rotulo: string; detalhe: string; consultor: string; quando: string };
type At = Sit & {
  etiquetas: Etq[]; chaves: string[]; quandoBRT: string;
  card: Record<string, unknown> | null; origem: { texto: string; cor: string } | null;
};
type Resumo = {
  situacoes: { rotulo: string; cod: string; n: number }[];
  etiquetas: { texto: string; n: number }[];
  semEtiqueta: number; consultores: string[];
};
type Tela = {
  cadChave: (t: unknown) => string;
  cadQuandoBRT: (iso: string) => string;
  cadSituacao: (r: Record<string, unknown>, lado?: string) => Sit;
  cadAtendimentoDe: (r: Record<string, unknown>, lado?: string, op?: Record<string, boolean>) => At;
  cadAtendimentoCel: (a: At) => string;
  cadResumoDe: (a: At[]) => Resumo;
  cadLinhasAgenda: () => Record<string, unknown>[];
  cadPeriodoFiltra: (l: Record<string, unknown>[], p: string, agora?: number) => Record<string, unknown>[];
  cadListasPorChave: (d: Record<string, unknown[]>) => Map<string, string[]>;
  cadNorm: (t: unknown) => string;
  __set: (atend: Map<string, unknown>, agendas: Map<string, unknown>, etiquetas?: Record<string, string>, tipos?: Record<string, string>) => void;
};

const lerHtml = () => readFileSync(GERADOR, 'utf8').split('\r\n').join('\n');
const fatia = (html: string, de: string, ate: string) => {
  const i = html.indexOf(de), j = html.indexOf(ate, i);
  // Marcador que sumiu = tela refatorada. Melhor um teste quebrado do que um que
  // passa sem comparar nada.
  if (i < 0 || j < 0 || j <= i) throw new Error(`marcador sumiu do /gerador: "${de}" … "${ate}"`);
  return html.slice(i, j);
};
/** escapeHtml, a etiqueta de origem (etiqueta.js real) e etqDeLead: o que a fatia lê de fora. */
function externos(html: string): string {
  const e0 = html.indexOf('function escapeHtml(s) {');
  const e1 = html.indexOf('\n}\n', e0);
  if (e0 < 0 || e1 < 0) throw new Error('escapeHtml sumiu do /gerador');
  return html.slice(e0, e1 + 2) + '\n'
    + readFileSync(join(GERADOR_DIR, 'etiqueta.js'), 'utf8') + '\n'
    + fatia(html, 'function etqDeLead(createdBy, src) {', '\n}\n') + '\n}\n';
}

function telaReal(): Tela {
  const html = lerHtml();
  return new Function(
    'let cadLado = "capital";\n'
    + externos(html)
    + fatia(html, 'const CAD_AG_STATUS = {', '/** Lê a situação da agente')
    + '\nreturn { cadChave, cadQuandoBRT, cadSituacao, cadAtendimentoDe, cadAtendimentoCel, cadResumoDe,'
    + ' cadLinhasAgenda, cadPeriodoFiltra, cadListasPorChave, cadNorm,'
    + ' __set: (a, g, e, t) => { cadAtend = a; cadAgendasChave = g; cadEtiquetas = e || {}; cadTipos = t || {}; } };',
  )() as Tela;
}

const T = telaReal();
const AGORA = '2026-10-12T15:00:00Z';   // 12:00 em Brasília

const sessao = (estagio: string, extra: Record<string, unknown> = {}) => ({
  chave: '3499111222', estagio, consultor: 'Diego', motivo: null, aberto_em: '2026-10-12T10:00:00Z',
  movimento_em: '2026-10-12T11:15:00Z', agendamento_id: null, resumo: '', erro_envio: false, ...extra,
});
const poe = (s?: Record<string, unknown>, card?: Record<string, unknown>, etiquetas: Record<string, string> = {}, tipos: Record<string, string> = {}) => {
  T.__set(s ? new Map([[String(s.chave), s]]) : new Map(), card ? new Map([['3491112222', card]]) : new Map(), etiquetas, tipos);
};
const pessoa = (extra: Record<string, unknown> = {}) => ({ telefone: '34991112222', status: 'novo', ...extra });
const card = (extra: Record<string, unknown> = {}) => ({
  id: 501, quando: '2026-10-14T13:00:00Z', status: 'agendado', vendedor_nome: 'Diego',
  created_by: 'lp_eletroposto', src: null, cliente_telefone: '34991112222', cliente_nome: 'Ana', cidade: 'Uberlândia', ...extra,
});

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
  it('chamado com retomadas: "Toque N de 5" a partir do 2; 1 ou ausente segue "Primeiro toque"', () => {
    for (const [toques, detalhe] of [[2, 'Toque 2 de 5'], [3, 'Toque 3 de 5'], [5, 'Toque 5 de 5'], [1, 'Primeiro toque'], [null, 'Primeiro toque'], [undefined, 'Primeiro toque']] as const) {
      poe(sessao('chamado', { chave: '3491112222', toques }));
      expect(T.cadSituacao(pessoa()), String(toques)).toMatchObject({ cod: 'chamado', rotulo: 'Chamado', detalhe });
    }
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

describe('cadAtendimentoDe: situação, etiquetas sem repetir, quem atende e a data', () => {
  it('card agendado com etiqueta guardada: situação, etiqueta de negócio e etiqueta de origem', () => {
    poe(undefined, card(), { '501': 'arrendamento' });
    const a = T.cadAtendimentoDe(pessoa(), 'ponto');
    expect(a).toMatchObject({ cod: 'agendado', rotulo: 'Agendado', consultor: 'Diego', quandoBRT: '14/10 10:00' });
    expect(a.etiquetas).toEqual([
      { texto: 'ARRENDAMENTO', tipo: 'negocio', cor: '' },
      { texto: 'EP Tráfego', tipo: 'origem', cor: 'ep-trafego' },
    ]);
    expect(a.chaves).toEqual(['ARRENDAMENTO', 'EP Tráfego']);
    expect(a.card).toMatchObject({ id: 501 });
  });

  it('status de negócio no card vale como a etiqueta, e a etiqueta guardada não passa na frente', () => {
    poe(undefined, card({ status: 'fez_orcamento' }), { '501': 'arrendamento' });
    const a = T.cadAtendimentoDe(pessoa(), 'ponto');
    // situação "Fez orçamento" e etiqueta FEZ ORÇAMENTO são o mesmo texto: uma pílula só
    expect(a.rotulo).toBe('Fez orçamento');
    expect(a.etiquetas.map(e => e.texto)).toEqual(['EP Tráfego']);
    expect(a.chaves).toEqual(['FEZ ORÇAMENTO', 'EP Tráfego']);   // o filtro de etiqueta ainda acha a pessoa
  });

  it('situação "Cotista" e etiqueta COTISTA viram uma pílula só; a origem do card da Helena é EP Helena', () => {
    poe(undefined, card({ status: 'cotista', created_by: 'agente_eletroposto' }));
    const a = T.cadAtendimentoDe(pessoa(), 'capital');
    expect(a.rotulo).toBe('Cotista');
    expect(a.etiquetas).toEqual([{ texto: 'EP Helena', tipo: 'origem', cor: 'ep' }]);
    expect(a.chaves).toEqual(['COTISTA', 'EP Helena']);
    const cel = T.cadAtendimentoCel(a);
    expect((cel.match(/otista/gi) || []).length).toBe(1);
  });

  it('Negociando (em_atendimento) não repete como NEGOCIANDO', () => {
    poe(undefined, card({ status: 'em_atendimento' }));
    const a = T.cadAtendimentoDe(pessoa());
    expect(a.rotulo).toBe('Negociando');
    expect(a.etiquetas.map(e => e.texto)).toEqual(['EP Tráfego']);
  });

  it('card da Helena com etiqueta guardada: a de negócio e a origem EP Helena, cada uma uma vez', () => {
    poe(undefined, card({ created_by: 'agente_eletroposto' }), { '501': 'cotista' });
    const a = T.cadAtendimentoDe(pessoa());
    expect(a.etiquetas).toEqual([
      { texto: 'COTISTA', tipo: 'negocio', cor: '' },
      { texto: 'EP Helena', tipo: 'origem', cor: 'ep' },
    ]);
  });

  // A etiqueta de chegada é só uma PRÉ-SELEÇÃO (13/10/2026): o status de negócio que o
  // consultor escolhe manda; sem ele vale a guardada; sem ela, o tipo com que o card chegou.
  describe('a etiqueta de negócio da pessoa: status do card, depois a guardada, depois o tipo', () => {
    it('card da Helena que chegou COTISTA e virou CHAVE NA MÃO: só a nova, em pílula e em filtro', () => {
      poe(undefined, card({ status: 'chave_na_mao', created_by: 'agente_eletroposto' }), { '501': 'cotista' }, { '501': 'cotista' });
      const a = T.cadAtendimentoDe(pessoa(), 'capital');
      expect(a.chaves).toEqual(['CHAVE NA MÃO', 'EP Helena']);
      expect(JSON.stringify(a.etiquetas)).not.toContain('COTISTA');
    });

    it('sem status de negócio, a etiqueta guardada ganha do tipo', () => {
      poe(undefined, card(), { '501': 'arrendamento' }, { '501': 'cotista' });
      expect(T.cadAtendimentoDe(pessoa()).chaves).toEqual(['ARRENDAMENTO', 'EP Tráfego']);
    });

    it('sem status de negócio nem etiqueta guardada, vale o tipo (o filtro COTISTA acha a pessoa)', () => {
      poe(undefined, card({ created_by: 'agente_eletroposto' }), {}, { '501': 'cotista' });
      const a = T.cadAtendimentoDe(pessoa());
      expect(a.chaves).toEqual(['COTISTA', 'EP Helena']);
      expect(a.etiquetas.map(e => e.texto)).toEqual(['COTISTA', 'EP Helena']);
    });

    it('sem nada disso, sem etiqueta de negócio', () => {
      poe(undefined, card());
      expect(T.cadAtendimentoDe(pessoa()).chaves).toEqual(['EP Tráfego']);
    });
  });

  it('sem card e com sessão da Helena: Conversando, Helena, sem etiqueta', () => {
    poe(sessao('conversando', { chave: '3491112222' }));
    const a = T.cadAtendimentoDe(pessoa(), 'curioso');
    expect(a).toMatchObject({ rotulo: 'Conversando', consultor: 'Helena', quandoBRT: '12/10 08:15', card: null, origem: null });
    expect(a.etiquetas).toEqual([]);
    expect(a.chaves).toEqual([]);
    expect(T.cadAtendimentoCel(a)).not.toContain('/gerador/agenda');   // sem card, sem link
  });

  it('sem nada: Sem atendimento, sem etiqueta e sem segunda linha', () => {
    const a = T.cadAtendimentoDe(pessoa(), 'integrador');
    expect(a).toMatchObject({ rotulo: 'Sem atendimento', consultor: '', quandoBRT: '', card: null });
    expect(a.etiquetas).toEqual([]);
    expect(T.cadAtendimentoCel(a)).not.toContain('cad-sub');
  });

  it('card de outro DDD com o mesmo final não casa (nem etiqueta, nem consultor)', () => {
    T.__set(new Map(), new Map([['3191112222', card({ id: 777, vendedor_nome: 'Giovanna' })]]), { '777': 'arrendamento' });
    const a = T.cadAtendimentoDe(pessoa(), 'ponto');
    expect(a).toMatchObject({ rotulo: 'Sem atendimento', consultor: '', card: null });
    expect(a.etiquetas).toEqual([]);
  });

  it('na lista Na agenda a origem e a data do card saem da célula (têm coluna própria)', () => {
    poe(undefined, card(), { '501': 'arrendamento' });
    const a = T.cadAtendimentoDe(pessoa(), 'agenda', { semOrigem: true, semQuandoDoCard: true });
    expect(a.etiquetas.map(e => e.texto)).toEqual(['ARRENDAMENTO']);
    expect(a.origem).toEqual({ texto: 'EP Tráfego', cor: 'ep-trafego' });
    expect(a.chaves).toContain('EP Tráfego');
    expect(a.quandoBRT).toBe('');
    // sessão mais nova que o card: a data dela não é a da reunião e fica
    poe(sessao('conversando', { chave: '3491112222', movimento_em: '2026-10-12T14:00:00Z' }), card({ quando: '2026-10-01T13:00:00Z' }));
    expect(T.cadAtendimentoDe(pessoa(), 'agenda', { semOrigem: true, semQuandoDoCard: true }).quandoBRT).toBe('12/10 11:00');
  });

  it('a célula: pílulas na linha 1, consultor e data na linha 2, link para o card, HTML escapado', () => {
    poe(undefined, card({ vendedor_nome: '<b>x</b>' }), { '501': 'arrendamento' });
    const cel = T.cadAtendimentoCel(T.cadAtendimentoDe(pessoa(), 'ponto'));
    expect(cel).toContain('<span class="cad-sit agendado">Agendado</span>');
    expect(cel).toContain('<span class="cad-ag-st">ARRENDAMENTO</span>');
    expect(cel).toContain('<span class="crm-card-tag tag-ep-trafego">EP Tráfego</span>');
    expect(cel).toContain('href="/gerador/agenda?ag=501&ver=1"');
    expect(cel).toContain('&lt;b&gt;x&lt;/b&gt; · 14/10 10:00');
    expect(cel).not.toContain('<b>x');
    poe(sessao('adiado', { chave: '3491112222', resumo: '<img src=x onerror=alert(1)>' }));
    const adiado = T.cadAtendimentoCel(T.cadAtendimentoDe(pessoa(), 'capital'));
    expect(adiado).not.toContain('<img');
    expect(adiado).toContain('&lt;img');
    expect(adiado).toContain('12/10 08:15');
  });
});

describe('cadResumoDe: contagens dos filtros', () => {
  it('conta situação, etiqueta, sem etiqueta e consultores (com a Helena)', () => {
    T.__set(new Map([['3499111222', sessao('conversando')]]), new Map([
      ['3491112222', card()],
      ['3433334444', card({ id: 502, status: 'cotista', created_by: 'agente_eletroposto', vendedor_nome: 'Giovanna' })],
    ]), { '501': 'arrendamento' });
    const lista = ['34991112222', '34933334444', '34999111222', '34988887777'].map(telefone => pessoa({ telefone }));
    const r = T.cadResumoDe(lista.map(p => T.cadAtendimentoDe(p, 'capital')));
    expect(r.situacoes.map(c => `${c.rotulo} ${c.n}`)).toEqual(['Agendado 1', 'Conversando 1', 'Cotista 1', 'Na fila 1']);
    expect(r.etiquetas.map(e => `${e.texto} ${e.n}`)).toEqual(['ARRENDAMENTO 1', 'COTISTA 1', 'EP Helena 1', 'EP Tráfego 1']);
    expect(r.semEtiqueta).toBe(2);
    expect(r.consultores).toEqual(['Diego', 'Giovanna', 'Helena']);
  });
});

describe('lista Na agenda: período, uma linha por pessoa e "Também em"', () => {
  const linha = (id: number, quando: string) => ({ id, quando });

  it('cadLinhasAgenda: uma linha por chave, com nome, telefone e cidade do card', () => {
    T.__set(new Map(), new Map([['3491112222', card()], ['3433334444', card({ id: 502, cliente_nome: 'Bia', cliente_telefone: '34933334444' })]]));
    const l = T.cadLinhasAgenda();
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ id: 501, nome: 'Ana', telefone: '34991112222', cidade: 'Uberlândia', deAgenda: true, status: null });
  });

  it('períodos: hoje em diante (próximas primeiro), 7 e 30 dias (mais recentes primeiro), tudo', () => {
    const l = [
      linha(1, '2026-10-11T20:00:00Z'),   // ontem
      linha(2, '2026-10-12T14:00:00Z'),   // hoje 11:00 BRT
      linha(3, '2026-10-14T13:00:00Z'),   // depois de amanhã
      linha(4, '2026-09-01T13:00:00Z'),   // mais de 30 dias
      linha(5, '2026-10-12T02:59:00Z'),   // 23:59 de ontem em Brasília: ainda é ontem
      { id: 6, quando: null },
    ];
    const ids = (p: string) => T.cadPeriodoFiltra(l, p, Date.parse(AGORA)).map(x => x.id);
    expect(ids('hoje')).toEqual([2, 3]);
    expect(ids('7')).toEqual([2, 5, 1]);
    expect(ids('30')).toEqual([2, 5, 1]);
    expect(ids('tudo')).toEqual([3, 2, 5, 1, 4]);
  });

  it('Também em: a pessoa em Investidores e Arrendamento, com o 55 na frente; só na agenda fica vazio', () => {
    const m = T.cadListasPorChave({
      ponto: [{ telefone: '5534991112222' }], capital: [{ telefone: '34991112222' }, { telefone: '34911112222' }],
      curioso: [], integrador: [{ telefone: '(31) 99111-2222' }],
    });
    expect(m.get('3491112222')).toEqual(['Arrendamento', 'Investidores']);
    expect(m.get('3191112222')).toEqual(['Parceiros']);          // outro DDD, outra pessoa
    expect(m.get('3499999999')).toBeUndefined();
  });

  it('cadNorm: sem acento, sem espaço, sem caixa', () => {
    expect(T.cadNorm('Fez orçamento')).toBe(T.cadNorm('FEZ ORÇAMENTO'));
    expect(T.cadNorm(null)).toBe('');
  });
});

// ── O DESENHO DAS CINCO LISTAS ────────────────────────────────────────────────
// Roda cadRender de verdade, com um document de mentira e os desenhos das células que não
// são desta tela (pares, padrão de entrada, valor) trocados por uma célula simples, e
// confere: o número de células de cada linha bate com o número de cabeçalhos.
function telaDeDesenho() {
  const html = lerHtml();
  const els: Record<string, any> = {};
  const el = (id: string) => (els[id] = els[id] || { id, value: '', style: {}, hidden: false, innerHTML: '', textContent: '', dataset: {} });
  const tb = { innerHTML: '' };
  const documento = { getElementById: el, querySelector: () => tb };
  const corpo = externos(html)
    + fatia(html, 'const CAD_AG_STATUS = {', '/** Lê a situação da agente')
    + `
const CAD_STATUS = { novo: 'Novo', falando: 'Falando', conectado: 'Conectado', sem_interesse: 'Sem interesse' };
const CAD_PISO_MIL = 50;
let cadDados = null, cadMatches = [], cadParesAberto = null;
const cadVendedores = () => ['Diego'];
const cadRenderChamadaCurioso = () => {}, cadRenderMatch = () => { document.getElementById('cad-tabela').feito = 'match'; };
const cadPainelPares = () => {};
const cadParesCel = () => '<td>perto</td>', cadPadraoCel = () => '<td>padrao</td>', cadValorSelect = () => '<span>valor</span>';
const cadRelacaoBadge = r => '<span class="cad-rel">' + escapeHtml(r.ponto_relacao || '') + '</span>';
const cadPosseDe = r => /dono|propriet/i.test(r.ponto_relacao || '') ? 'pro' : null;
const cadValorOk = () => false, cadRelacaoDaFicha = () => '', cadParesHTML = () => 'pares';
const cadRef = r => 'x:' + r.id;
` + fatia(html, 'const CAD_COLUNAS = {', '// TERMO A PARTIR DO CADASTRO')
    + `
return { cadRender, CAD_COLUNAS, cadMontaSelect,
  set: (k, v) => { ({ cadLado: x => { cadLado = x; }, cadDados: x => { cadDados = x; }, cadParesAberto: x => { cadParesAberto = x; },
    cadAtendPronto: x => { cadAtendPronto = x; }, cadAgendaCheia: x => { cadAgendaCheia = x; },
    agendas: x => { cadAgendasChave = x; }, atend: x => { cadAtend = x; }, etiquetas: x => { cadEtiquetas = x; } })[k](v); } };`;
  const f = new Function('document', 'let cadLado = "ponto";\n' + corpo) as (d: unknown) => any;
  return { ...f(documento), el, tb };
}

const D = telaDeDesenho();
const LISTAS = ['ponto', 'capital', 'curioso', 'integrador', 'agenda'] as const;
const linhasDe = (html: string) => html.split('<tr').slice(1);
const nCelulas = (tr: string) => (tr.match(/<td\b/g) || []).length;
const nCabecalhos = (tr: string) => (tr.match(/<th\b/g) || []).length;

function dadosDeTeste() {
  const base = (i: number, extra: Record<string, unknown> = {}) => ({
    id: i, tab: 'eletroposto_parceria', nome: 'Pessoa ' + i, cidade: 'Uberlândia', created_at: '2026-10-10T12:00:00Z',
    telefone: '349911122' + String(10 + i), status: 'novo', ...extra,
  });
  return {
    ponto: [base(1, { ponto_tipo: 'Posto', ponto_relacao: 'Sou o proprietário' }),
      base(2, { tab: 'agendamentos', deAgenda: true, ponto_fluxo: 'Marcado ARRENDAMENTO na agenda' }),
      base(3, { tab: 'eletroposto_nota1', deFicha: true, ponto_fluxo: 'Tenho um local definido' })],
    capital: [base(4, { valor_investir: 'R$ 100 mil', ponto_relacao: 'Sou inquilino' }), base(5, { valor_investir: 'R$ 80 mil' })],
    curioso: [base(6, { valor_investir: null }), base(7, { tab: 'eletroposto_nota1', deFicha: true })],
    integrador: [base(8, { integrador_atuacao: 'Instala' }), base(9)],
  };
}

describe('cadRender: as cinco listas desenham tantas células quantos cabeçalhos', () => {
  beforeEach(() => {
    D.set('cadDados', dadosDeTeste());
    D.set('cadAtendPronto', true);
    D.set('cadAgendaCheia', false);
    D.set('cadParesAberto', null);
    D.set('agendas', new Map([
      ['3491112211', card({ id: 601, cliente_telefone: '34991112211', cliente_nome: 'Pessoa 1', quando: '2026-10-14T13:00:00Z' })],
      ['3491112214', card({ id: 604, cliente_telefone: '34991112214', cliente_nome: 'Pessoa 4', quando: '2026-10-13T13:00:00Z', created_by: 'agente_eletroposto', status: 'cotista' })],
    ]));
    D.set('atend', new Map());
    D.set('etiquetas', {});
    for (const id of ['cad-busca', 'cad-filtro', 'cad-sit', 'cad-etq', 'cad-vend']) D.el(id).value = '';
    D.el('cad-per').value = 'tudo';
  });

  for (const lado of LISTAS) {
    it(`${lado}: cabeçalhos e linhas com o mesmo número de colunas`, () => {
      D.set('cadLado', lado);
      D.cadRender();
      const trs = linhasDe(D.tb.innerHTML);
      const cab = trs.find(t => t.includes('<th'))!;
      expect(cab).toBeTruthy();
      const n = nCabecalhos(cab);
      expect(n).toBe(D.CAD_COLUNAS[lado].length);
      const dados = trs.filter(t => !t.includes('<th'));
      expect(dados.length).toBeGreaterThan(0);
      for (const tr of dados) expect(nCelulas(tr), tr.slice(0, 120)).toBe(n);
    });
  }

  it('o Atendimento é a segunda coluna de todas as listas, o Status a última (menos Na agenda)', () => {
    for (const lado of LISTAS) {
      expect(D.CAD_COLUNAS[lado].slice(0, 2)).toEqual(['Quem', 'Atendimento']);
      expect(D.CAD_COLUNAS[lado].includes('Agenda')).toBe(false);
      expect(D.CAD_COLUNAS[lado].includes('Consultor')).toBe(false);
      expect(D.CAD_COLUNAS[lado].includes('Situação')).toBe(false);
      if (lado !== 'agenda') expect(D.CAD_COLUNAS[lado].at(-1)).toBe('Status');
    }
    expect(D.CAD_COLUNAS.agenda).toEqual(['Quem', 'Atendimento', 'Reunião', 'Cidade', 'Origem', 'Também em']);
  });

  for (const lado of LISTAS) {
    it(`${lado}: a mensagem de "nada encontrado" ocupa todas as colunas, vazia ou filtrada`, () => {
      D.set('cadLado', lado);
      // lista vazia
      D.set('cadDados', { ponto: [], capital: [], curioso: [], integrador: [] });
      D.set('agendas', new Map());
      D.cadRender();
      expect(D.tb.innerHTML).toContain(`colspan="${D.CAD_COLUNAS[lado].length}"`);
      // busca que não acha
      D.set('cadDados', dadosDeTeste());
      D.set('agendas', new Map([['3491112211', card({ cliente_telefone: '34991112211' })]]));
      D.el('cad-busca').value = 'zzzz-ninguem';
      D.cadRender();
      expect(D.tb.innerHTML).toContain(`colspan="${D.CAD_COLUNAS[lado].length}"`);
      expect(D.tb.innerHTML).toContain('Nada com esse filtro');
    });
  }

  it('a linha do painel "quem está perto" ocupa todas as colunas de Arrendamento e Investidores', () => {
    for (const [lado, ref] of [['ponto', 'x:1'], ['capital', 'x:4']] as const) {
      D.set('cadLado', lado);
      D.set('cadParesAberto', ref);
      D.cadRender();
      const par = linhasDe(D.tb.innerHTML).find(t => t.includes('cad-par-tr'))!;
      expect(par, lado).toBeTruthy();
      expect(par).toContain(`colspan="${D.CAD_COLUNAS[lado].length}"`);
    }
  });

  it('Arrendamento: a origem aparece uma vez só na coluna Local, e não há coluna Situação', () => {
    D.set('cadLado', 'ponto');
    D.cadRender();
    const trs = linhasDe(D.tb.innerHTML).filter(t => !t.includes('<th'));
    const daAgenda = trs.find(t => t.includes('Pessoa 2'))!;
    expect(daAgenda).toContain('Marcado ARRENDAMENTO na agenda');
    expect(daAgenda).not.toContain('da agenda');
    const daFicha = trs.find(t => t.includes('Pessoa 3'))!;
    expect(daFicha).toContain('da ficha');
    expect(daFicha).toContain('Tenho um local definido');
    expect(D.tb.innerHTML).not.toContain('<th>Situação</th>');
  });

  it('a posse do local aparece uma vez por linha (selo no Arrendamento; selo ou texto nas outras)', () => {
    D.set('cadLado', 'ponto'); D.cadRender();
    const p1 = linhasDe(D.tb.innerHTML).find(t => t.includes('Pessoa 1'))!;
    expect((p1.match(/Sou o propriet/g) || []).length).toBe(1);
    D.set('cadLado', 'capital'); D.cadRender();
    const p4 = linhasDe(D.tb.innerHTML).find(t => t.includes('Pessoa 4'))!;
    expect((p4.match(/Sou inquilino/g) || []).length).toBe(1);
    const p5 = linhasDe(D.tb.innerHTML).find(t => t.includes('Pessoa 5'))!;
    expect(p5).not.toContain('não perguntado');
  });

  it('Investidores: o card vem pela chave inteira, com as pílulas e o select de Status manual', () => {
    D.set('cadLado', 'capital'); D.cadRender();
    const p4 = linhasDe(D.tb.innerHTML).find(t => t.includes('Pessoa 4'))!;
    expect(p4).toContain('<span class="cad-sit card">Cotista</span>');
    expect(p4).toContain('<select class="cad-st"');
    expect(p4).toContain('cadStatus(');
    const p5 = linhasDe(D.tb.innerHTML).find(t => t.includes('Pessoa 5'))!;
    expect(p5).toContain('Na fila');
    expect(D.el('cad-sit').innerHTML).toContain('Na fila (1)');
    expect(D.el('cad-etq').innerHTML).toContain('Sem etiqueta (1)');
    expect(D.el('cad-etq').innerHTML).toContain('COTISTA (1)');
    expect(D.el('cad-sit-resumo').textContent).toContain('Na fila 1');
    expect(D.el('cad-sit-resumo').hidden).toBe(false);
  });

  it('o resumo e os filtros de situação, etiqueta e consultor existem em todas as listas', () => {
    for (const lado of LISTAS) {
      D.set('cadLado', lado); D.cadRender();
      expect(D.el('cad-sit').style.display, lado).toBe('');
      expect(D.el('cad-etq').style.display, lado).toBe('');
      expect(D.el('cad-sit-resumo').hidden, lado).toBe(false);
      expect(D.el('cad-sit-resumo').textContent.length, lado).toBeGreaterThan(0);
      expect(D.el('cad-per').style.display, lado).toBe(lado === 'agenda' ? '' : 'none');
    }
  });

  it('filtra por etiqueta, por "sem etiqueta", por situação e por consultor (Helena incluída)', () => {
    D.set('cadLado', 'capital');
    D.set('atend', new Map([['3491112215', sessao('conversando', { chave: '3491112215' })]]));
    D.cadRender();
    expect(D.el('cad-vend').innerHTML).toContain('Helena');
    expect(D.el('cad-vend').innerHTML).toContain('Diego');
    D.el('cad-etq').value = 'COTISTA'; D.cadRender();
    let trs = linhasDe(D.tb.innerHTML).filter(t => !t.includes('<th'));
    expect(trs).toHaveLength(1); expect(trs[0]).toContain('Pessoa 4');
    D.el('cad-etq').value = '__sem__'; D.cadRender();
    trs = linhasDe(D.tb.innerHTML).filter(t => !t.includes('<th'));
    expect(trs).toHaveLength(1); expect(trs[0]).toContain('Pessoa 5');
    D.el('cad-etq').value = '';
    D.el('cad-vend').value = 'Helena'; D.cadRender();
    trs = linhasDe(D.tb.innerHTML).filter(t => !t.includes('<th'));
    expect(trs).toHaveLength(1); expect(trs[0]).toContain('Pessoa 5');
    D.el('cad-vend').value = '';
    D.el('cad-sit').value = 'Conversando'; D.cadRender();
    trs = linhasDe(D.tb.innerHTML).filter(t => !t.includes('<th'));
    expect(trs).toHaveLength(1);
  });

  it('Na agenda: uma linha por pessoa com Também em, origem e reunião; período e teto', () => {
    D.set('cadLado', 'agenda');
    D.el('cad-per').value = 'tudo';
    D.cadRender();
    const trs = linhasDe(D.tb.innerHTML).filter(t => !t.includes('<th'));
    expect(trs).toHaveLength(2);
    // a pessoa 4 está em Investidores: "Também em" diz; a origem fica na coluna Origem
    const p4 = trs.find(t => t.includes('Pessoa 4'))!;
    expect(p4).toContain('>Investidores<');
    expect(p4).toContain('13/10 10:00');
    expect(p4).toContain('href="/gerador/agenda?ag=604&ver=1"');
    expect(p4).not.toContain('<select');
    D.set('agendas', new Map([['3477778888', card({ id: 700, cliente_telefone: '34977778888', cliente_nome: 'Só na agenda' })]]));
    D.cadRender();
    const solo = linhasDe(D.tb.innerHTML).find(t => t.includes('Só na agenda'))!;
    expect(solo).toContain('EP Tráfego');
    expect(solo.trimEnd().endsWith('<td>—</td></tr>')).toBe(true);   // Também em vazio: só existe na agenda
    // período: hoje em diante (12/10 12:00 em Brasília): a reunião de 14/10 entra
    D.el('cad-per').value = 'hoje'; D.cadRender();
    expect(D.tb.innerHTML).toContain('Só na agenda');
    D.el('cad-per').value = '7'; D.cadRender();
    expect(D.tb.innerHTML).toContain('Nenhuma reunião neste período');
    // teto da leitura
    D.el('cad-per').value = 'tudo'; D.set('cadAgendaCheia', true); D.cadRender();
    expect(D.el('cad-sit-resumo').textContent).toContain('teto de 1.000 reuniões');
  });
});
