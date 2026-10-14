import { describe, it, expect } from 'vitest';
import {
  classificarTelefone, chaveDaLinha, lidsDasLinhas, variantesDaChave, chaveValida, formatarTelefone, numeroParaWa,
  autorDe, contaComoConversa, trecho, urlSegura, mensagemParaTela, escolherNome, atendimentoDe, montarConversas,
  contatosDasLinhas, lerPaginado, ErroBanco, estadoDaLinha, equipeAutorizada, lerDias, lerLimite, lerCursor,
  lerHorario, idInicial, SOBREPOSICAO_IDS, TRECHO_MAX,
  type LinhaWa, type MapaLid, type PausaLinha,
} from '../services/gerador/caixaWhatsapp';

// Dados inventados: telefones de teste (DDD 11, sequência óbvia) e nomes de ficção.
// Nada aqui é de cliente.

const T0 = Date.parse('2026-10-13T15:00:00.000Z');
const min = (n: number): string => new Date(T0 + n * 60_000).toISOString();

let seq = 0;
function msg(o: Partial<LinhaWa> & { m: number }): LinhaWa {
  const { m, ...resto } = o;
  return {
    id: ++seq, telefone: '5511988880001', is_group: false, from_me: false, from_api: null,
    chat_name: null, sender_name: null, tipo: 'texto', texto: 'oi', media_url: null, momment: min(m), ...resto,
  };
}
const lead = (m: number, o: Partial<LinhaWa> = {}) => msg({ m, ...o });
const robo = (m: number, o: Partial<LinhaWa> = {}) => msg({ m, from_me: true, from_api: true, ...o });
const celular = (m: number, o: Partial<LinhaWa> = {}) => msg({ m, from_me: true, from_api: false, ...o });

const SEM_MAPA: MapaLid = new Map();
const SEM_PAUSA = new Map<string, PausaLinha>();
const CHAVE_A = '1188880001'; // 5511988880001

describe('classificarTelefone e chaveDaLinha', () => {
  const casos: Array<[string, string, boolean, string]> = [
    ['telefone com 55 e nono dígito', '5511988880001', false, 'telefone'],
    ['telefone sem 55', '11988880001', false, 'telefone'],
    ['telefone sem o nono dígito', '551188880001', false, 'telefone'],
    ['telefone com sinais', '+55 (11) 98888-0001', false, 'telefone'],
    ['LID de 15 dígitos', '253068247589084', false, 'lid'],
    ['LID de 14 dígitos', '25306824758908', false, 'lid'],
    ['grupo marcado como grupo', '5511988880001', true, 'ignorar'],
    ['id de grupo de 18 dígitos', '120363410228854732', false, 'ignorar'],
    ['vazio', '', false, 'ignorar'],
    ['curto demais', '12345', false, 'ignorar'],
  ];
  it.each(casos)('%s', (_n, tel, grupo, tipo) => {
    expect(classificarTelefone(tel, grupo).tipo).toBe(tipo);
  });

  it('as três formas do mesmo telefone dão a mesma chave', () => {
    const chaves = ['5511988880001', '11988880001', '551188880001'].map((t) => chaveDaLinha({ telefone: t, is_group: false }, SEM_MAPA));
    expect(new Set(chaves)).toEqual(new Set([CHAVE_A]));
  });

  it('LID com mapa vira a chave do telefone; sem mapa vira conversa própria', () => {
    const mapa: MapaLid = new Map([['253068247589084', { chave: CHAVE_A, telefone: '5511988880001' }]]);
    expect(chaveDaLinha({ telefone: '253068247589084', is_group: false }, mapa)).toBe(CHAVE_A);
    expect(chaveDaLinha({ telefone: '253068247589084', is_group: false }, SEM_MAPA)).toBe('lid:253068247589084');
    expect(chaveDaLinha({ telefone: '', is_group: false }, mapa)).toBeNull();
  });

  it('lidsDasLinhas junta os LIDs sem repetir e ignora grupo', () => {
    const l = [
      { telefone: '253068247589084', is_group: false }, { telefone: '253068247589084', is_group: false },
      { telefone: '5511988880001', is_group: false }, { telefone: '253068247589099', is_group: true },
    ];
    expect(lidsDasLinhas(l)).toEqual(['253068247589084']);
  });

  it('variantesDaChave e chaveValida', () => {
    expect(variantesDaChave(CHAVE_A)).toEqual(['5511988880001', '551188880001', '11988880001', '1188880001']);
    expect(variantesDaChave('lid:1')).toEqual([]);
    expect(chaveValida(CHAVE_A)).toBe(true);
    expect(chaveValida('lid:253068247589084')).toBe(true);
    expect(chaveValida('lid:123')).toBe(false);
    expect(chaveValida('1188880001; drop')).toBe(false);
    expect(chaveValida('')).toBe(false);
  });

  it('formata telefone e monta o número do wa.me', () => {
    expect(formatarTelefone('5511988880001')).toBe('(11) 98888-0001');
    expect(formatarTelefone('551188880001')).toBe('(11) 8888-0001');
    expect(formatarTelefone('')).toBeNull();
    expect(numeroParaWa('11988880001')).toBe('5511988880001');
    expect(numeroParaWa('5511988880001')).toBe('5511988880001');
    expect(numeroParaWa('253068247589084')).toBeNull();
  });
});

describe('autor', () => {
  it('lead, robô e equipe no celular são distinguidos', () => {
    expect(autorDe({ from_me: false, from_api: null })).toBe('lead');
    expect(autorDe({ from_me: true, from_api: true })).toBe('robo');
    expect(autorDe({ from_me: true, from_api: false })).toBe('equipe');
  });
  it('from_api nulo em mensagem nossa conta como equipe (igual ao pausaHumanaTick)', () => {
    expect(autorDe({ from_me: true, from_api: null })).toBe('equipe');
  });
  it('reação e aviso de sistema não contam como conversa', () => {
    expect(contaComoConversa('texto')).toBe(true);
    expect(contaComoConversa('audio')).toBe(true);
    expect(contaComoConversa('chamada')).toBe(true);
    expect(contaComoConversa('reacao')).toBe(false);
    expect(contaComoConversa('notificacao')).toBe(false);
  });
});

describe('trecho, url e mensagem', () => {
  it('corta em 80 caracteres e junta espaços', () => {
    const t = trecho('a'.repeat(200));
    expect(t.length).toBe(TRECHO_MAX);
    expect(t.endsWith('…')).toBe(true);
    expect(trecho('  oi \n\n  tudo   bem  ')).toBe('oi tudo bem');
    expect(trecho(null)).toBe('');
  });
  it('só aceita http e https em mídia', () => {
    expect(urlSegura('https://exemplo.test/a.jpg')).toBe('https://exemplo.test/a.jpg');
    expect(urlSegura('http://exemplo.test/a.jpg')).toBe('http://exemplo.test/a.jpg');
    expect(urlSegura('javascript:alert(1)')).toBeNull();
    expect(urlSegura('data:text/html,<b>x</b>')).toBeNull();
    expect(urlSegura('')).toBeNull();
  });
  it('mensagemParaTela traz autor, horário em ISO e mídia filtrada', () => {
    const m = mensagemParaTela(robo(5, { tipo: 'imagem', texto: '', media_url: 'javascript:x' }));
    expect(m.autor).toBe('robo');
    expect(m.texto).toBeNull();
    expect(m.media_url).toBeNull();
    expect(m.momento).toBe(min(5));
  });
});

describe('nome do contato', () => {
  it('nunca usa o nome da própria linha', () => {
    const l = [
      robo(1, { sender_name: 'Linha IO', chat_name: 'Linha IO' }),
      lead(2, { sender_name: 'Maria Teste', chat_name: null }),
    ];
    expect(escolherNome(l)).toBe('Maria Teste');
  });
  it('chat_name vem antes do sender_name', () => {
    const l = [lead(1, { chat_name: 'Maria (obra)', sender_name: 'Mari' }), robo(2, { sender_name: 'Linha IO' })];
    expect(escolherNome(l)).toBe('Maria (obra)');
  });
  it('sender_name de mensagem nossa não vira nome', () => {
    expect(escolherNome([robo(1, { sender_name: 'Atendimento IO' })])).toBe('');
  });
  it('nome que parece telefone fica por último', () => {
    const l = [lead(1, { chat_name: '+55 11 98888-0001', sender_name: 'João Teste' })];
    expect(escolherNome(l)).toBe('João Teste');
    expect(escolherNome([lead(1, { chat_name: '+55 11 98888-0001' })])).toBe('+55 11 98888-0001');
  });
  it('pega o mais recente', () => {
    const l = [lead(1, { chat_name: 'Nome Velho' }), lead(9, { chat_name: 'Nome Novo' })];
    expect(escolherNome(l)).toBe('Nome Novo');
  });
});

describe('atendimento (pausa humana)', () => {
  const pausa = (o: Partial<PausaLinha> = {}): PausaLinha => ({
    chave: CHAVE_A, pausado_em: min(-60), ultima_fala_humano: min(-30), ultima_fala_lead: null, ...o,
  });
  it('sem pausa não há atendimento', () => {
    expect(atendimentoDe(undefined, T0, 24)).toBeNull();
  });
  it('pausa recente mostra desde quando', () => {
    expect(atendimentoDe(pausa(), T0, 24)).toEqual({ desde: min(-60) });
  });
  it('pausa que esfriou (24 h sem ninguém falar) não conta', () => {
    const velha = pausa({ pausado_em: min(-3000), ultima_fala_humano: min(-2000), ultima_fala_lead: min(-1600) });
    expect(atendimentoDe(velha, T0, 24)).toBeNull();
  });
  it('lead falando mantém a pausa viva', () => {
    const viva = pausa({ ultima_fala_humano: min(-2000), ultima_fala_lead: min(-10) });
    expect(atendimentoDe(viva, T0, 24)).not.toBeNull();
  });
});

describe('montarConversas', () => {
  it('telefone e LID do mesmo contato viram UMA conversa', () => {
    const mapa: MapaLid = new Map([['253068247589084', { chave: CHAVE_A, telefone: '5511988880001' }]]);
    const linhas = [
      lead(1, { telefone: '5511988880001' }),
      celular(5, { telefone: '253068247589084', texto: 'respondi pelo celular' }),
      lead(8, { telefone: '5511988880001' }),
    ];
    const r = montarConversas(linhas, mapa, SEM_PAUSA, T0);
    expect(r).toHaveLength(1);
    expect(r[0].chave).toBe(CHAVE_A);
    expect(r[0].telefone).toBe('(11) 98888-0001');
    expect(r[0].wa).toBe('5511988880001');
    expect(r[0].sem_telefone).toBe(false);
    // O LID entrou na conta: depois da resposta do celular veio só 1 mensagem do lead.
    expect(r[0].nao_respondidas).toBe(1);
  });

  it('LID sem mapa fica como conversa própria e sem telefone', () => {
    const r = montarConversas([lead(1, { telefone: '253068247589084', sender_name: 'Alguém' })], SEM_MAPA, SEM_PAUSA, T0);
    expect(r).toHaveLength(1);
    expect(r[0].chave).toBe('lid:253068247589084');
    expect(r[0].sem_telefone).toBe(true);
    expect(r[0].telefone).toBeNull();
    expect(r[0].wa).toBeNull();
    expect(r[0].nome).toBe('Alguém');
  });

  it('grupo e id inválido ficam de fora', () => {
    const linhas = [
      lead(1, { telefone: '120363410228854732', is_group: true }),
      lead(2, { telefone: '120363410228854732' }),
      lead(3, { telefone: '' }),
      lead(4, { telefone: '5511988880002' }),
    ];
    const r = montarConversas(linhas, SEM_MAPA, SEM_PAUSA, T0);
    expect(r.map((c) => c.chave)).toEqual(['1188880002']);
  });

  it('a contagem de não respondidas zera quando há resposta nossa depois', () => {
    const base = [lead(1), lead(2), lead(3)];
    expect(montarConversas(base, SEM_MAPA, SEM_PAUSA, T0)[0].nao_respondidas).toBe(3);
    expect(montarConversas([...base, robo(4)], SEM_MAPA, SEM_PAUSA, T0)[0].nao_respondidas).toBe(0);
    expect(montarConversas([...base, celular(4)], SEM_MAPA, SEM_PAUSA, T0)[0].nao_respondidas).toBe(0);
    expect(montarConversas([...base, celular(4), lead(5)], SEM_MAPA, SEM_PAUSA, T0)[0].nao_respondidas).toBe(1);
  });

  it('reação do lead e aviso do sistema não contam; reação nossa não é resposta', () => {
    const linhas = [lead(1), lead(2, { tipo: 'reacao', texto: 'ok' }), robo(3, { tipo: 'notificacao', texto: 'aviso' })];
    // Só o "oi" do minuto 1 conta, porque a reação e o aviso estão fora e não há resposta nossa de verdade.
    expect(montarConversas(linhas, SEM_MAPA, SEM_PAUSA, T0)[0].nao_respondidas).toBe(1);
  });

  it('ordem de chegada das linhas não muda o resultado', () => {
    const l = [lead(1), robo(2), lead(3), lead(4)];
    const a = montarConversas(l, SEM_MAPA, SEM_PAUSA, T0)[0];
    const b = montarConversas([...l].reverse(), SEM_MAPA, SEM_PAUSA, T0)[0];
    expect(a).toEqual(b);
    expect(a.nao_respondidas).toBe(2);
    expect(a.ultimo_lead).toBe(min(4));
  });

  it('ordena da conversa mais recente para a mais antiga e desempata pela chave', () => {
    const linhas = [
      lead(10, { telefone: '5511988880002' }),
      lead(30, { telefone: '5511988880003' }),
      lead(20, { telefone: '5511988880001' }),
      lead(20, { telefone: '5511988880004' }),
    ];
    const r = montarConversas(linhas, SEM_MAPA, SEM_PAUSA, T0);
    expect(r.map((c) => c.chave)).toEqual(['1188880003', '1188880001', '1188880004', '1188880002']);
  });

  it('a última mensagem traz trecho de até 80, tipo e autor', () => {
    const r = montarConversas([lead(1), robo(2, { texto: 'x'.repeat(300) })], SEM_MAPA, SEM_PAUSA, T0)[0];
    expect(r.ultima.autor).toBe('robo');
    expect(r.ultima.trecho.length).toBe(80);
    expect(r.ultima.tipo).toBe('texto');
  });

  it('conversa só nossa não tem último horário do lead', () => {
    const r = montarConversas([robo(1)], SEM_MAPA, SEM_PAUSA, T0)[0];
    expect(r.ultimo_lead).toBeNull();
    expect(r.nao_respondidas).toBe(0);
  });

  it('o estado de atendimento vem da pausa daquela chave', () => {
    const p: PausaLinha = { chave: CHAVE_A, pausado_em: min(-20), ultima_fala_humano: min(-5), ultima_fala_lead: null };
    const r = montarConversas([lead(1), lead(2, { telefone: '5511988880002' })], SEM_MAPA, new Map([[CHAVE_A, p]]), T0);
    expect(r.find((c) => c.chave === CHAVE_A)!.atendimento).toEqual({ desde: min(-20) });
    expect(r.find((c) => c.chave === '1188880002')!.atendimento).toBeNull();
  });

  it('contatosDasLinhas devolve nome e telefone por chave', () => {
    const c = contatosDasLinhas([lead(1, { chat_name: 'Maria Teste' })], SEM_MAPA);
    expect(c.get(CHAVE_A)).toEqual({ nome: 'Maria Teste', telefone: '(11) 98888-0001', wa: '5511988880001', sem_telefone: false });
  });
});

describe('lerPaginado (truncamento)', () => {
  const fonte = (total: number, falhaNaPagina = -1) => (de: number, ate: number) => {
    if (de / 10 === falhaNaPagina) return Promise.resolve({ data: null, error: { code: '57014' } });
    const data = [];
    for (let i = de; i <= Math.min(ate, total - 1); i++) data.push({ id: i + 1 });
    return Promise.resolve({ data, error: null });
  };

  it('lê até acabar e não marca truncado', async () => {
    const r = await lerPaginado(fonte(25), 10, 10);
    expect(r.linhas).toHaveLength(25);
    expect(r.truncado).toBe(false);
  });
  it('para no teto de páginas e marca truncado', async () => {
    const r = await lerPaginado(fonte(100), 3, 10);
    expect(r.linhas).toHaveLength(30);
    expect(r.truncado).toBe(true);
  });
  it('total exatamente igual ao teto sem mais nada: a próxima página não veio, então marca truncado por cautela', async () => {
    const r = await lerPaginado(fonte(30), 3, 10);
    expect(r.truncado).toBe(true);
  });
  it('tira linha repetida entre páginas', async () => {
    let chamada = 0;
    const r = await lerPaginado((_de, _ate) => {
      chamada++;
      return Promise.resolve({ data: chamada === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 2 }], error: null });
    }, 5, 2);
    expect(r.linhas.map((x) => x.id)).toEqual([1, 2]);
  });
  it('erro do banco vira ErroBanco só com o código (nunca lista vazia)', async () => {
    await expect(lerPaginado(fonte(100, 1), 5, 10)).rejects.toMatchObject({ name: 'ErroBanco', codigo: '57014' });
    await expect(lerPaginado(fonte(100, 1), 5, 10)).rejects.toBeInstanceOf(ErroBanco);
  });
});

describe('estado da linha', () => {
  const lido = new Date(T0 - 10 * 60_000).toISOString();
  it('conectada: sem queda e leitura recente', () => {
    const r = estadoDaLinha({ downStreak: 0, ultimaConexao: lido }, lido, T0);
    expect(r.estado).toBe('conectada');
    expect(r.leitura_em).toBe(lido);
  });
  it('caída: duas checagens seguidas fora', () => {
    expect(estadoDaLinha({ downStreak: 2 }, lido, T0).estado).toBe('caida');
    expect(estadoDaLinha({ downStreak: 5 }, lido, T0).estado).toBe('caida');
  });
  it('uma checagem fora ainda é dúvida', () => {
    expect(estadoDaLinha({ downStreak: 1 }, lido, T0).estado).toBe('desconhecida');
  });
  it('leitura velha demais, sem registro ou sem hora: desconhecida', () => {
    const velho = new Date(T0 - 5 * 3600_000).toISOString();
    expect(estadoDaLinha({ downStreak: 0 }, velho, T0).estado).toBe('desconhecida');
    expect(estadoDaLinha(null, lido, T0).estado).toBe('desconhecida');
    expect(estadoDaLinha({ downStreak: 0 }, null, T0).estado).toBe('desconhecida');
  });
});

describe('pedido', () => {
  it('lista da equipe: padrão, variável, caixa e espaços', () => {
    expect(equipeAutorizada('thiago', undefined)).toBe(true);
    expect(equipeAutorizada('Giovanna', undefined)).toBe(true);
    expect(equipeAutorizada('nilce', '')).toBe(true);
    expect(equipeAutorizada('fulano', undefined)).toBe(false);
    expect(equipeAutorizada('', undefined)).toBe(false);
    expect(equipeAutorizada('fulano', ' Fulano , beltrano ')).toBe(true);
    expect(equipeAutorizada('thiago', 'fulano')).toBe(false);
  });
  it('dias: padrão 3, mínimo 1, máximo 30', () => {
    expect(lerDias(undefined)).toBe(3);
    expect(lerDias('abc')).toBe(3);
    expect(lerDias('0')).toBe(3);
    expect(lerDias('7')).toBe(7);
    expect(lerDias('90')).toBe(30);
    expect(lerDias('2.9')).toBe(2);
  });
  it('limite: padrão 50, máximo 200', () => {
    expect(lerLimite(undefined)).toBe(50);
    expect(lerLimite('500')).toBe(200);
    expect(lerLimite('10')).toBe(10);
    expect(lerLimite('-4')).toBe(50);
  });
  it('cursor: só inteiro não negativo; recua a sobreposição sem passar de zero', () => {
    expect(lerCursor('1234')).toBe(1234);
    expect(lerCursor('0')).toBe(0);
    expect(lerCursor('-1')).toBeNull();
    expect(lerCursor('1; drop')).toBeNull();
    expect(lerCursor(undefined)).toBeNull();
    expect(idInicial(1000)).toBe(1000 - SOBREPOSICAO_IDS);
    expect(idInicial(3)).toBe(0);
  });
  it('horário: ISO válido ou nulo', () => {
    expect(lerHorario('2026-10-13T15:00:00Z')).toBe('2026-10-13T15:00:00.000Z');
    expect(lerHorario('lixo')).toBeNull();
    expect(lerHorario('')).toBeNull();
  });
});
