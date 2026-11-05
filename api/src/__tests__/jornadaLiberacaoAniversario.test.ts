import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BancoFalso } from './bancoFalsoQuiz';

// A liberação com o Book (7.7) e os aniversários (7.8 e 7.9) da Jornada, fase 3. Banco em memória; a Z-API, o Storage e as travas da linha são
// FALSOS (nada sai de verdade). Estado deduzido nunca dispara; a trava é INSERT; o nascimento nunca vai ao banco.

const h = vi.hoisted(() => ({
  main: null as any,
  doc: [] as any[],
  frio: [] as any[],
  frioRetorno: true as boolean,
  book: true,
  url: 'https://assinado.test/vendasolar/10.book.pdf?exp=3600' as string | null,
  supressao: [] as string[],
  mudo: false,
  mudosErro: false,
  humano: true,
  teto: true,
  espacamento: true,
  tetoOpts: [] as any[],
  libPriv: { liberacao: { passos: { liberada: { data: '2026-11-04' } } } } as any,
  portao: { avaliar: null as any, travarRodada: vi.fn() },
  datas: { aniv: '11-05', liberada: null } as { aniv: string | null; liberada: string | null },
}));

vi.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => h.main.from(t) } }));
vi.mock('../utils/supabaseGerador', () => ({ geradorComServiceKey: false, supabaseGerador: { from: () => { throw new Error('sem banco do gerador'); } } }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', async (orig) => ({
  ...(await orig<typeof import('../services/agents/zapiClient')>()),
  sendDocument: vi.fn(async (...a: any[]) => { h.doc.push(a); }),
  sendFrio: vi.fn(async (...a: any[]) => { h.frio.push(a); return h.frioRetorno; }),
  linhaEmCooldown: vi.fn(() => false),
}));
vi.mock('../services/agents/whatsapp/lineThrottle', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/lineThrottle')>()),
  dentroDoTetoHorarioLinha: vi.fn(async (o: any) => { h.tetoOpts.push(o); return h.teto; }),
  respeitaEspacamentoLinha: vi.fn(async () => h.espacamento),
}));
vi.mock('../services/agents/whatsapp/silenciar', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/silenciar')>()),
  motivosDaSupressao: vi.fn(async () => h.supressao),
  carregarMudos: vi.fn(async () => { if (h.mudosErro) throw new Error('lista fora'); return () => h.mudo; }),
}));
vi.mock('../services/agents/whatsapp/pausaHumana', async (orig) => ({
  ...(await orig<typeof import('../services/agents/whatsapp/pausaHumana')>()),
  podeFalarComLead: vi.fn(async () => ({ pode: h.humano, motivo: 'x' })),
}));
vi.mock('../services/gerador/bookObra', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/bookObra')>()),
  lerMetaBook: vi.fn(async () => (h.book ? { v: 1, gerado_em: '2026-11-05T10:00:00.000Z', por: 'diego', tamanho: 10, sha256: 'a'.repeat(64), fotos: 0 } : null)),
  urlAssinadaDoBook: vi.fn(async () => h.url),
}));
vi.mock('../services/gerador/jornadaObraBanco', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/jornadaObraBanco')>()),
  lerObraPrivada: vi.fn(async () => h.libPriv),
}));
vi.mock('../services/gerador/jornadaPosVendaDados', async (orig) => ({
  ...(await orig<typeof import('../services/gerador/jornadaPosVendaDados')>()),
  primeiroNomeDaObra: vi.fn(async () => 'Marcos'),
  lerDatasDoPosVenda: vi.fn(async () => h.datas),
}));
vi.mock('../services/recuperacaoCheckoutPortao', async (orig) => ({
  ...(await orig<typeof import('../services/recuperacaoCheckoutPortao')>()),
  novaRodadaPortao: vi.fn(() => h.portao),
}));

import { sendDocument, sendFrio } from '../services/agents/zapiClient';
import { PREFIXOS_AGENDA, prefixosDaLinha } from '../services/agents/whatsapp/lineThrottle';
import { rodarLiberacao } from '../services/io/jornadaLiberacao';
import { rodarAniversarios } from '../services/io/jornadaAniversario';
import { tomarVez, type CtxMsg, type Leitura } from '../services/io/jornadaMensagensBase';
import type { GrupoMsg, ObraFila } from '../services/io/jornadaMensagensPuro';
import { obraMaterializada, type EstadoObra } from '../services/gerador/jornadaObra';
import { estadoMaterializado } from '../services/gerador/jornadaSolar';

const CARD = 10;
const AG = new Date('2026-11-05T15:00:00.000Z');                  // quinta, 12:00 em Brasília
const LIGADO = '2026-11-01T00:00:00.000Z';
const CONCLUIDA = '2026-11-04T18:00:00.000Z';
const todos = (o: Partial<Record<GrupoMsg, string | null>> = {}): Record<GrupoMsg, string | null> => ({ venda: null, etapa: null, fila: null, liberacao: LIGADO, aniversario: LIGADO, ...o });
const vezReal = (agora: Date): CtxMsg['vez'] => { let f: Promise<boolean> | null = null; return { tomar: () => (f ??= tomarVez(agora).then((r) => r === 'tomada')) }; };
const ctx = (o: Partial<CtxMsg> = {}, agora = AG): CtxMsg => ({ agora, ligados: todos(), primeiros: {}, vez: vezReal(agora), sonda: false, ...o });
const obra9 = (por = 'diego', em = CONCLUIDA, extra: Partial<EstadoObra> = {}): ObraFila => {
  const jo: EstadoObra = { ...obraMaterializada(CARD, 9, em, em), historico: [{ em, por, acao: 'concluir', etapa: 8 }], ...extra };
  return { card: CARD, codigo: '#0065', cliente: 'Marcos Andrade', cidade: 'Uberlândia-MG', vendedor: 'nilce', js: { ...estadoMaterializado(CARD, 'nilce', 4, em), origem: 'vendido' }, jo, cancelada: false };
};
const leituraDe = (obras: ObraFila[], tel = '(34) 99999-0010'): Leitura => ({
  obras, cards: new Map(obras.map((o) => [o.card, { id: o.card, cliente_nome: o.cliente, cliente_telefone: tel } as any])), ligs: new Map(),
});
const trava = (prefixo: string): any[] => h.main.tabela('system_state').filter((l: any) => String(l.key).startsWith(prefixo));

beforeEach(() => {
  h.main = new BancoFalso();
  h.doc.length = 0; h.frio.length = 0; h.frioRetorno = true; h.book = true; h.url = 'https://assinado.test/vendasolar/10.book.pdf?exp=3600';
  h.supressao = []; h.mudo = false; h.mudosErro = false; h.humano = true; h.teto = true; h.espacamento = true; h.tetoOpts.length = 0;
  h.libPriv = { liberacao: { passos: { liberada: { data: '2026-11-04' } } } };
  h.portao.avaliar = vi.fn(async () => ({ ok: true })); h.portao.travarRodada = vi.fn();
  h.datas = { aniv: '11-05', liberada: null };
  vi.mocked(sendDocument).mockClear(); vi.mocked(sendFrio).mockClear();
  process.env.VINCULO_SOLAR_SECRET = 'segredo-de-teste';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('7.7 a liberação com o Book', () => {
  it('com o Book salvo manda UM documento com a legenda exata e o nome do arquivo; o teto é o transacional; a trava é INSERT e vira o carimbo', async () => {
    const r = await rodarLiberacao(ctx(), leituraDe([obra9()]));
    expect(r).toMatchObject({ enviado: true, parar: true });
    expect(h.doc).toHaveLength(1);
    const [tel, url, nome, legenda, inst] = h.doc[0];
    expect(tel).toBe('34999990010');
    expect(url).toBe('https://assinado.test/vendasolar/10.book.pdf?exp=3600');
    expect(nome).toBe('Book da obra #0065.pdf');
    expect(inst).toBe('io');
    expect((legenda as string).split('\n').slice(0, 3)).toEqual([
      '☀️ Marcos, a sua usina foi liberada pela Cemig.', 'Obrigado por confiar na Irmãos na Obra.', 'O Book da obra vai em PDF, com o termo de garantia.',
    ]);
    expect(legenda).toContain('Conhece alguém que quer pagar menos na conta de luz? Mande este link para ele: https://solardoc.app/io/indicacao?i=10-');
    expect(h.tetoOpts).toEqual([{ transacional: true }]);
    expect(trava('jornada_lib_sent:')).toHaveLength(1);
    expect(trava('jornada_lib_sent:')[0].value).toMatchObject({ robo: 'jornada_liberacao', enviado: true });
  });

  it('dois ticks ao mesmo tempo mandam 1 só', async () => {
    const semVez = { tomar: async () => true };
    const l = leituraDe([obra9()]);
    await Promise.all([rodarLiberacao(ctx({ vez: semVez }), l), rodarLiberacao(ctx({ vez: semVez }), l)]);
    expect(h.doc).toHaveLength(1);
    expect(trava('jornada_lib_sent:')).toHaveLength(1);
  });

  it('sem o book.json não sai e não trava; o teto falso para sem travar; a pausa humana não trava e volta depois', async () => {
    h.book = false;
    expect(await rodarLiberacao(ctx(), leituraDe([obra9()]))).toMatchObject({ enviado: false });
    expect(h.doc).toEqual([]); expect(trava('jornada_lib_sent:')).toEqual([]);
    h.book = true; h.teto = false;
    expect(await rodarLiberacao(ctx(), leituraDe([obra9()]))).toMatchObject({ parar: true, motivo: 'linha_ocupada' });
    expect(trava('jornada_lib_sent:')).toEqual([]);
    h.teto = true; h.humano = false;
    await rodarLiberacao(ctx(), leituraDe([obra9()]));
    expect(h.doc).toEqual([]); expect(trava('jornada_lib_sent:')).toEqual([]);
    h.humano = true;
    await rodarLiberacao(ctx({}, new Date(AG.getTime() + 2 * 60_000)), leituraDe([obra9()]));
    expect(h.doc).toHaveLength(1);
  });

  it('supressão e mudo cortam; erro de leitura da lista de mudos para a rodada', async () => {
    h.supressao = ['opt_out'];
    await rodarLiberacao(ctx(), leituraDe([obra9()]));
    h.supressao = []; h.mudo = true;
    await rodarLiberacao(ctx(), leituraDe([obra9()]));
    expect(h.doc).toEqual([]);
    h.mudo = false; h.mudosErro = true;
    expect(await rodarLiberacao(ctx(), leituraDe([obra9()]))).toMatchObject({ parar: true, motivo: 'leitura_falhou' });
    expect(trava('jornada_lib_sent:')).toEqual([]);
  });

  it('fora das 9h às 20h ou no domingo para sem travar; 18:00 em Brasília ainda sai', async () => {
    const l = leituraDe([obra9()]);
    expect((await rodarLiberacao(ctx({}, new Date('2026-11-05T22:30:00.000Z')), l)).motivo).toBe('enviado');     // 19:30 em Brasília ainda está dentro
    expect(h.doc.length).toBe(1);
    h.doc.length = 0; h.main.zerar();
    expect(await rodarLiberacao(ctx({}, new Date('2026-11-05T23:30:00.000Z')), l)).toMatchObject({ parar: true, motivo: 'fora_da_janela' });   // 20:30 BRT
    expect(await rodarLiberacao(ctx({}, new Date('2026-11-05T11:30:00.000Z')), l)).toMatchObject({ parar: true, motivo: 'fora_da_janela' });   // 08:30 BRT
    expect(await rodarLiberacao(ctx({ ligados: todos() }, new Date('2026-11-08T15:00:00.000Z')), leituraDe([obra9('diego', '2026-11-07T18:00:00.000Z')]))).toMatchObject({ motivo: 'fora_da_janela' });
    expect(h.doc).toEqual([]); expect(trava('jornada_lib_sent:')).toEqual([]);
  });

  it('conclusão com mais de 7 dias, liberação 10 dias antes da conclusão e por "leitura": nada', async () => {
    await rodarLiberacao(ctx(), leituraDe([obra9('diego', '2026-10-25T18:00:00.000Z')]));
    expect(h.doc).toEqual([]);
    h.libPriv = { liberacao: { passos: { liberada: { data: '2026-10-20' } } } };
    await rodarLiberacao(ctx(), leituraDe([obra9()]));
    expect(h.doc).toEqual([]);
    h.libPriv = { liberacao: { passos: { liberada: { data: '2026-11-04' } } } };
    await rodarLiberacao(ctx(), leituraDe([obra9('leitura')]));
    expect(h.doc).toEqual([]);
    await rodarLiberacao(ctx({ ligados: todos({ liberacao: '2026-11-04T19:00:00.000Z' }) }), leituraDe([obra9()]));
    expect(h.doc).toEqual([]);
    expect(trava('jornada_lib_sent:')).toEqual([]);
  });

  it('estado deduzido nunca dispara: obra sem jornada_obra, com Book, telefone e liberação de ontem', async () => {
    const sem = { ...obra9(), jo: null };
    await rodarLiberacao(ctx(), leituraDe([sem]));
    const soLeitura = { ...obra9(), jo: obraMaterializada(CARD, 9, CONCLUIDA, CONCLUIDA) };
    await rodarLiberacao(ctx(), leituraDe([soLeitura]));
    expect(h.doc).toEqual([]);
    expect(trava('jornada_lib_sent:')).toEqual([]);
  });

  it('grupo desligado e sonda: nada', async () => {
    expect((await rodarLiberacao(ctx({ ligados: todos({ liberacao: null }) }), leituraDe([obra9()]))).motivo).toBe('desligado');
    expect((await rodarLiberacao(ctx({ sonda: true }), leituraDe([obra9()]))).motivo).toBe('desligado');
    expect(h.doc).toEqual([]);
  });

  it('o carimbo está em prefixosDaLinha() e em PREFIXOS_AGENDA; o do aniversário está na linha e FORA da agenda', () => {
    expect(prefixosDaLinha()).toContain('jornada_lib_sent:');
    expect([...PREFIXOS_AGENDA]).toContain('jornada_lib_sent:');
    expect(prefixosDaLinha()).toContain('jornada_pos_sent:');
    expect([...PREFIXOS_AGENDA]).not.toContain('jornada_pos_sent:');
  });
});

describe('7.8 e 7.9 os aniversários', () => {
  const HOJE = new Date('2026-11-05T15:00:00.000Z');

  it('manda o parabéns pelo sendFrio (nunca o sendWhatsApp), trava por INSERT com o ano e usa o portão com o robô', async () => {
    const r = await rodarAniversarios(ctx(), leituraDe([obra9()]));
    expect(r).toMatchObject({ enviado: true });
    expect(h.frio).toHaveLength(1);
    expect(h.frio[0][1][0].split('\n')[0]).toBe('🎂 Feliz aniversário, Marcos.');
    expect(h.frio[0][2]).toBe('io');
    expect(trava('jornada_pos_sent:')[0]).toMatchObject({ key: 'jornada_pos_sent:10:aniv:2026' });
    expect(trava('jornada_pos_sent:')[0].value).toMatchObject({ robo: 'jornada_aniversario', atrasado: false, enviado: true });
    expect(h.portao.travarRodada).toHaveBeenCalledWith('ja_enviou_na_rodada');
    // No dia seguinte (minuto par novo) o mesmo toque não repete.
    await rodarAniversarios(ctx({}, new Date(HOJE.getTime() + 2 * 60_000)), leituraDe([obra9()]));
    expect(h.frio).toHaveLength(1);
  });

  it('o portão segura: para sem travar; o portão corta: pula para o seguinte', async () => {
    h.portao.avaliar = vi.fn(async () => ({ ok: false, acao: 'segura', motivo: 'teto' }));
    expect(await rodarAniversarios(ctx(), leituraDe([obra9()]))).toMatchObject({ parar: true, motivo: 'teto' });
    expect(trava('jornada_pos_sent:')).toEqual([]);
    h.datas = { aniv: '11-05', liberada: '2025-11-05' };
    h.portao.avaliar = vi.fn()
      .mockResolvedValueOnce({ ok: false, acao: 'corta', motivo: 'mudo' }).mockResolvedValueOnce({ ok: true });
    const r = await rodarAniversarios(ctx(), leituraDe([obra9()]));
    expect(r).toMatchObject({ enviado: true });
    expect(h.frio[0][1][0]).toContain('hoje a sua usina faz 1 ano.');
    expect(trava('jornada_pos_sent:').map((t) => t.key)).toEqual(['jornada_pos_sent:10:usina:2026']);
  });

  it('sendFrio devolve false (pausa humana): a trava some e a rodada para', async () => {
    h.frioRetorno = false;
    const r = await rodarAniversarios(ctx(), leituraDe([obra9()]));
    expect(r).toMatchObject({ enviado: false, parar: true, motivo: 'calado' });
    expect(trava('jornada_pos_sent:')).toEqual([]);
  });

  it('o texto atrasado (D-1), e depois de D+2 desiste; empresa (sem nascimento) não recebe o toque 2', async () => {
    h.datas = { aniv: '11-04', liberada: null };
    await rodarAniversarios(ctx(), leituraDe([obra9('diego', '2026-11-03T18:00:00.000Z')]));
    expect(h.frio[0][1][0].split('\n')[0]).toBe('🎂 Feliz aniversário atrasado, Marcos.');
    expect(trava('jornada_pos_sent:')[0].value.atrasado).toBe(true);
    h.main.zerar(); h.frio.length = 0;
    h.datas = { aniv: '11-02', liberada: null };
    await rodarAniversarios(ctx(), leituraDe([obra9('diego', '2026-11-01T18:00:00.000Z')]));
    expect(h.frio).toEqual([]);
    h.datas = { aniv: null, liberada: null };
    await rodarAniversarios(ctx(), leituraDe([obra9()]));
    expect(h.frio).toEqual([]);
  });

  it('o nascimento nunca é escrito no system_state', async () => {
    h.datas = { aniv: '11-05', liberada: '2024-11-05' };
    await rodarAniversarios(ctx(), leituraDe([obra9()]));
    expect(h.main.tabela('system_state').length).toBeGreaterThan(0);
    expect(JSON.stringify(h.main.tabela('system_state').map((l: any) => l.value))).not.toMatch(/"aniv"|1985|nasc|"11-05"/);
  });

  it('estado deduzido nunca dispara (sem jornada_obra, ou etapa 8 concluída por leitura, ou antes do primeiro ligado em): zero envio e zero trava', async () => {
    await rodarAniversarios(ctx(), leituraDe([{ ...obra9(), jo: null }]));
    await rodarAniversarios(ctx(), leituraDe([obra9('leitura')]));
    await rodarAniversarios(ctx({ primeiros: { aniversario: '2026-11-04T19:00:00.000Z' } }), leituraDe([obra9()]));
    expect(h.frio).toEqual([]);
    expect(trava('jornada_pos_sent:')).toEqual([]);
  });

  it('nunca retroativo: ligado hoje, o toque de D antes do "ligado em" não sai; desligado e sonda não fazem nada', async () => {
    await rodarAniversarios(ctx({ ligados: todos({ aniversario: '2026-11-05T20:00:00.000Z' }) }), leituraDe([obra9()]));
    expect(h.frio).toEqual([]);
    expect((await rodarAniversarios(ctx({ ligados: todos({ aniversario: null }) }), leituraDe([obra9()]))).motivo).toBe('desligado');
    expect((await rodarAniversarios(ctx({ sonda: true }), leituraDe([obra9()]))).motivo).toBe('desligado');
  });
});
