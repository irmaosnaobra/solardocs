import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstadoJornada, PrivadoJornada } from '../services/gerador/jornadaSolar';

// Trello automático da Jornada (18/11/2026) e as regras puras que o cercam. Tudo simulado: nenhum banco, nenhum Trello. Dados inventados.

const AGORA = '2026-11-18T12:00:00.000Z';

const h = vi.hoisted(() => ({
  lig: { proposta: 'P1', venda: '#0070' as string | null, por: 'nilce', em: '2026-11-18T12:00:00.000Z', trello_card: undefined as string | undefined },
  estado: null as unknown,
  privado: null as unknown,
  slots: [] as string[],
  finalizada: false,
  rotas: 0,
  status: 200,
  travas: new Set<string>(),
  espera: null as null | Promise<void>,
  parecidos: false,
  arquivado: false,
  previas: 0,
}));

vi.mock('../services/gerador/vendaSolarHub', () => ({ lerLigacao: async () => ({ lig: { ...h.lig }, existe: true }) }));
vi.mock('../services/gerador/docsClienteBanco', () => ({
  lerDocsComVersao: async () => ({ reg: { arquivos: h.slots.map((slot) => ({ slot })) }, versao: 'v' }),
}));
vi.mock('../services/gerador/jornadaSolarBanco', () => ({
  lerJornadaComVersao: async () => ({ estado: h.estado, versao: 'v' }),
  lerPrivadoJornada: async () => h.privado,
  mudarJornada: async (_c: number, _base: unknown, fn: (e: unknown) => unknown) => { h.estado = fn(h.estado); return h.estado; },
}));
vi.mock('../routes/geradorJornadaNumero', () => ({ baseDaJornada: () => () => h.estado }));
vi.mock('../services/gerador/cadastroVenda', () => ({ lerCadastroVisto: async () => ({ v: 1, campos: {}, alteracoes: [], em: null }) }));
vi.mock('../services/gerador/jornadaCorte', () => ({ obraFinalizada: async () => h.finalizada }));
vi.mock('../services/gerador/cadastroVendaBanco', () => ({
  // Trava de uma tentativa só, como a chamada do Trello automático pede.
  comTrava: async (id: string, _por: string, fn: () => Promise<unknown>) => {
    if (h.travas.has(String(id))) { const e = new Error('ocupado') as Error & { codigo: string }; e.codigo = 'ocupado'; throw e; }
    h.travas.add(String(id));
    try { return await fn(); } finally { h.travas.delete(String(id)); }
  },
}));
// O fluxo do botão: aqui só conta quantas vezes rodou e "cria" o cartão no estado (como `guardarTrelloNaJornada` faz).
vi.mock('../routes/geradorVendaSolarTrello', () => ({
  rotaTrelloDaVenda: async (req: { body: unknown }, res: { status(c: number): { json(b: unknown): void } }, guarda: (r: unknown, s: unknown) => Promise<{ id: number } | null>) => {
    const g = await guarda(req, res);
    expect(g).toMatchObject({ id: 304 });
    if ((req.body as { previa?: boolean }).previa === true) {
      h.previas++;
      res.status(200).json({ ok: true, previa: true, cartao: h.arquivado ? null : { existente: true, id: 'x' }, ...(h.parecidos ? { parecidos: [{ id: 'x', titulo: 'Cartão parecido' }] } : {}) });
      return;
    }
    expect(req.body).toEqual({});   // o envio é o mesmo pedido do botão: sem `novo`, sem `card_id`
    h.rotas++;
    if (h.espera) await h.espera;
    if (h.status === 200) (h.estado as EstadoJornada).etapas[3].trello = { url: 'https://trello.com/c/abcdef12', criado_em: AGORA, por: 'x' };
    res.status(h.status).json(h.status === 200 || h.status === 207 ? { ok: h.status === 200, cartao: { id: 'a'.repeat(24) } } : { ok: false, error: 'x' });
  },
}));
vi.mock('../utils/waitUntil', () => ({ waitUntil: (p: Promise<unknown>) => { h.espera = null; void p; } }));

import { tentarTrelloAutomatico, dispararTrelloAutomatico } from '../routes/geradorJornadaTrelloAuto';
import { blocoVendaCompleto, estadoMaterializado, estadoTrelloAuto, itensDaEtapa } from '../services/gerador/jornadaSolar';
import { assinaturaBate, assinaturaPedeArquivoInteiro, kmlValido, mimeDoKmz, extDoArquivo, mimeServeAoItem, itemDoCatalogo, lerCaminho, MIMES_ACEITOS } from '../services/gerador/docsCliente';
import { planoDeChecklists } from '../services/gerador/trelloVendaSolar';
import type { CardVendido } from '../services/gerador/fichaEletroposto';

const card = { id: 304, cliente_nome: 'Cliente Inventado' } as unknown as CardVendido;
const quem = { nome: 'giovanna', socio: false };
const TUDO = ['datasheet_modulo', 'datasheet_inversor', 'kmz'];

const privado = (kit: boolean): PrivadoJornada => ({
  v: 1, cancelamento: null, descancelamentos: [], trazidas: [],
  venda: { valor_centavos: 100, pagamento: [{ forma: 'pix', valor_centavos: 100, obs: '' }], desconto_centavos: null, prazo_prometido: 'x', nota: '', kit_confirmado: kit, combinado_por: 'nilce', combinado_em: AGORA, editado: [] },
});
const estadoPronto = (): EstadoJornada => {
  const e = estadoMaterializado(304, 'nilce', 3, AGORA);   // etapas 1 e 2 concluídas, a 3 aberta
  return e;
};

beforeEach(() => {
  h.lig = { proposta: 'P1', venda: '#0070', por: 'nilce', em: AGORA, trello_card: undefined };
  h.estado = estadoPronto(); h.privado = privado(true); h.slots = [...TUDO]; h.finalizada = false; h.rotas = 0; h.previas = 0; h.parecidos = false; h.arquivado = false; h.status = 200; h.travas.clear(); h.espera = null;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('tentarTrelloAutomatico', () => {
  it('com as fases 1 e 2 fechadas e o equipamento todo feito, cria o cartão UMA vez pelo fluxo do botão; a segunda chamada vê o cartão e não faz nada', async () => {
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'criou' });
    expect(h.previas).toBe(1);   // a prévia roda ANTES de criar
    expect(h.rotas).toBe(1);
    expect((h.estado as EstadoJornada).etapas[3].trello).not.toBeNull();
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'ja_tem' });
    expect(h.rotas).toBe(1);
  });
  it('duas chamadas ao mesmo tempo: uma cria, a outra encontra a trava ocupada e não cria um segundo cartão', async () => {
    let solta!: () => void;
    h.espera = new Promise<void>((ok) => { solta = ok; });
    const a = tentarTrelloAutomatico(card, quem);
    await new Promise((r) => setTimeout(r, 5));
    const b = await tentarTrelloAutomatico(card, quem, { esperaMs: 0 });
    expect(b).toEqual({ acao: 'ocupado' });   // trava ocupada: tentou de novo uma vez e desistiu
    solta();
    expect(await a).toEqual({ acao: 'criou' });
    expect(h.rotas).toBe(1);
  });
  it.each([
    ['falta o datasheet da placa', () => { h.slots = ['datasheet_inversor', 'kmz']; }, 'Datasheet da placa'],
    ['falta o datasheet do inversor', () => { h.slots = ['datasheet_modulo', 'kmz']; }, 'Datasheet do inversor'],
    ['falta o KMZ', () => { h.slots = ['datasheet_modulo', 'datasheet_inversor']; }, 'KMZ do local'],
    ['falta o número da venda', () => { h.lig.venda = null; }, 'Número da venda'],
    ['a etapa 2 não concluiu', () => { (h.estado as EstadoJornada).etapas[2].concluida_em = null; }, 'Etapa Anexos concluída'],
    ['a etapa 1 não concluiu', () => { (h.estado as EstadoJornada).etapas[1].concluida_em = null; }, 'Etapa Venda concluída'],
    ['a obra foi cancelada', () => { (h.estado as EstadoJornada).cancelada = { em: AGORA, por: 'thiago', etapa: 3, com_numero: true }; }, 'Obra cancelada'],
  ])('não cria quando %s', async (_n, mexe, texto) => {
    mexe();
    const r = await tentarTrelloAutomatico(card, quem);
    expect(r).toMatchObject({ acao: 'nao_pronto' });
    expect((r as { falta: string[] }).falta).toContain(texto);
    expect(h.rotas).toBe(0);
  });
  it('trava ocupada: espera e tenta de novo UMA vez; se o outro já criou o cartão, a segunda tentativa só vê "ja_tem"', async () => {
    h.travas.add('trello-auto:304');
    const r = tentarTrelloAutomatico(card, quem, { esperaMs: 30 });
    setTimeout(() => { h.travas.delete('trello-auto:304'); (h.estado as EstadoJornada).etapas[3].trello = { url: 'https://trello.com/c/abcdef12', criado_em: AGORA, por: 'x', completado_em: AGORA }; }, 10);
    expect(await r).toEqual({ acao: 'ja_tem' });
    expect(h.rotas).toBe(0);
    h.travas.add('trello-auto:304');   // continua ocupada na segunda tentativa: desiste (sem laço)
    (h.estado as EstadoJornada).etapas[3].trello = null;
    expect(await tentarTrelloAutomatico(card, quem, { esperaMs: 1 })).toEqual({ acao: 'ocupado' });
  });
  it('cartão que já existe e ainda não foi completado: roda o fluxo do botão (completa) UMA vez e grava completado_em; sem sucesso total, não grava', async () => {
    (h.estado as EstadoJornada).etapas[3].trello = { url: 'https://trello.com/c/abcdef12', criado_em: AGORA, por: 'x' };
    h.status = 207;   // algo ficou pendente: não marca, a próxima chamada completa o resto
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'criou' });
    expect((h.estado as EstadoJornada).etapas[3].trello!.completado_em).toBeUndefined();
    h.status = 200;
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'completou' });
    expect((h.estado as EstadoJornada).etapas[3].trello!.completado_em).toEqual(expect.any(String));
    const rotas = h.rotas;
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'ja_tem' });
    expect(h.rotas).toBe(rotas);
    // cartão só na ligação (sem registro na obra): completa também
    (h.estado as EstadoJornada).etapas[3].trello = null; h.lig.trello_card = 'b'.repeat(24);
    expect(await tentarTrelloAutomatico(card, quem)).toMatchObject({ acao: expect.stringMatching(/criou|completou/) });
  });
  it('cartão guardado que sumiu do quadro (prévia com cartao: null): desiste, não cria outro, marca a parada e o GET diz para conferir no botão', async () => {
    (h.estado as EstadoJornada).etapas[3].trello = { url: 'https://trello.com/c/abcdef12', criado_em: AGORA, por: 'x' };
    h.arquivado = true;
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'parecidos' });
    expect(h.rotas).toBe(0);
    expect((h.estado as EstadoJornada).historico.filter((x) => x.acao === 'trello_auto_arquivado')).toHaveLength(1);
    expect((h.estado as EstadoJornada).etapas[3].trello!.completado_em).toBeUndefined();
    const f = { lig: { proposta: 'P1', venda: '#1' }, slots: new Set(TUDO), cad: { v: 1, campos: {}, alteracoes: [], em: null } as never, privado: privado(true), estado: h.estado as EstadoJornada };
    expect(estadoTrelloAuto(f, true)).toEqual({ pronto: false, falta: ['O cartão guardado não está aberto no Trello. Confira no botão do Trello.'] });
    // só pela ligação (sem registro na obra): o mesmo
    (h.estado as EstadoJornada).etapas[3].trello = null; h.lig.trello_card = 'b'.repeat(24);
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'parecidos' });
    expect(h.rotas).toBe(0);
  });
  it('etapa 3 já concluída: não toca na obra (nem cria, nem completa o cartão existente)', async () => {
    (h.estado as EstadoJornada).etapas[3].concluida_em = AGORA;
    const r = await tentarTrelloAutomatico(card, quem);
    expect(r).toMatchObject({ acao: 'nao_pronto' });
    expect((r as { falta: string[] }).falta).toEqual(['Homologação já concluída']);
    (h.estado as EstadoJornada).etapas[3].trello = { url: 'https://trello.com/c/abcdef12', criado_em: AGORA, por: 'x' };   // existente, não completado
    expect(await tentarTrelloAutomatico(card, quem)).toMatchObject({ acao: 'nao_pronto' });
    expect(h.rotas).toBe(0);
    expect(h.previas).toBe(0);
    const f = { lig: { proposta: 'P1', venda: '#1' }, slots: new Set(TUDO), cad: { v: 1, campos: {}, alteracoes: [], em: null } as never, privado: privado(true), estado: h.estado as EstadoJornada };
    expect(estadoTrelloAuto(f, true).pronto).toBe(false);
  });
  it('cartões parecidos ou candidatos na prévia: desiste, não cria, marca a parada no histórico (uma vez só)', async () => {
    h.parecidos = true;
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'parecidos' });
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'parecidos' });
    expect(h.rotas).toBe(0);
    expect(h.previas).toBe(2);
    expect((h.estado as EstadoJornada).historico.filter((x) => x.acao === 'trello_auto_parou')).toHaveLength(1);
    expect((h.estado as EstadoJornada).etapas[3].trello).toBeNull();
  });
  it('cartão já ligado na ligação ou no estado: nada a fazer; venda finalizada: não cria', async () => {
    (h.estado as EstadoJornada).etapas[3].trello = { url: 'https://trello.com/c/abcdef12', criado_em: AGORA, por: 'x', completado_em: AGORA };
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'ja_tem' });   // já completado: nada a fazer
    (h.estado as EstadoJornada).etapas[3].trello = null;
    h.lig.trello_card = undefined;
    h.finalizada = true;
    expect(await tentarTrelloAutomatico(card, quem)).toMatchObject({ acao: 'nao_pronto' });
    expect(h.rotas).toBe(0);
  });
  it('falha do fluxo (Trello fora) só vira resultado "falhou" e log: nada lança, e o cartão não é marcado', async () => {
    h.status = 502;
    expect(await tentarTrelloAutomatico(card, quem)).toEqual({ acao: 'falhou', status: 502 });
    expect(h.rotas).toBe(1);
    expect((h.estado as EstadoJornada).etapas[3].trello).toBeNull();
    expect(() => dispararTrelloAutomatico(card, quem)).not.toThrow();
  });
});

describe('regras puras', () => {
  const lig = { proposta: 'P1' };
  it('blocoVendaCompleto NÃO exige o kit: proposta + valor que fecha + prazo bastam; sem qualquer um deles, não', () => {
    expect(blocoVendaCompleto(lig, privado(false))).toBe(true);
    expect(blocoVendaCompleto(lig, privado(true))).toBe(true);
    expect(blocoVendaCompleto({ proposta: null }, privado(true))).toBe(false);
    expect(blocoVendaCompleto(lig, null)).toBe(false);
    const semPrazo = privado(true); semPrazo.venda!.prazo_prometido = '  ';
    expect(blocoVendaCompleto(lig, semPrazo)).toBe(false);
    const naoFecha = privado(true); naoFecha.venda!.valor_centavos = 200;
    expect(blocoVendaCompleto(lig, naoFecha)).toBe(false);
  });
  it('estadoTrelloAuto: pronto só com tudo; a lista falta vem em texto de tela', () => {
    const cad = { v: 1, campos: {}, alteracoes: [], em: null } as never;
    const f = (estado: EstadoJornada | null, slots: string[], pv: PrivadoJornada | null) => ({ lig: { proposta: 'P1', venda: '#1' }, slots: new Set(slots), cad, privado: pv, estado });
    expect(estadoTrelloAuto(f(estadoPronto(), TUDO, privado(true)), true)).toEqual({ pronto: true, falta: [] });
    expect(estadoTrelloAuto(f(null, [], null), false).falta).toEqual([
      'Etapa Venda concluída', 'Etapa Anexos concluída', 'Datasheet da placa', 'Datasheet do inversor', 'KMZ do local', 'Número da venda',
    ]);
    expect(itensDaEtapa(3, f(estadoPronto(), TUDO, privado(true))).slice(0, 3).every((i) => i.bloco === 'equipamento' && i.feito)).toBe(true);
  });
});

describe('KMZ no catálogo e nas regras de arquivo', () => {
  const kmz = itemDoCatalogo('vendasolar', 'kmz')!;
  it('o item existe só na venda solar, com um arquivo e o rótulo da tela', () => {
    expect(kmz).toMatchObject({ rotulo: 'KMZ do local', aceita: 'kmz', varios: false, obrigatorio: false });
    expect(itemDoCatalogo('eletroposto', 'kmz')).toBeNull();
    expect(itemDoCatalogo('solar', 'kmz')).toBeNull();
  });
  it('mimeServeAoItem: o KMZ aceita só os dois tipos do Google Earth; nenhum outro item os aceita (nem zip nem octet-stream)', () => {
    expect(mimeServeAoItem(kmz, 'application/vnd.google-earth.kmz')).toBe(true);
    expect(mimeServeAoItem(kmz, 'application/vnd.google-earth.kml+xml')).toBe(true);
    for (const m of ['application/pdf', 'image/jpeg', 'application/zip', 'application/octet-stream']) expect(mimeServeAoItem(kmz, m), m).toBe(false);
    for (const chave of ['datasheet_modulo', 'datasheet_inversor', 'fachada', 'documento_titular', 'procuracao', 'outros']) {
      const item = itemDoCatalogo('vendasolar', chave)!;
      for (const m of ['application/vnd.google-earth.kmz', 'application/vnd.google-earth.kml+xml', 'application/zip', 'application/octet-stream']) {
        expect(mimeServeAoItem(item, m), chave + ' ' + m).toBe(false);
      }
    }
    expect(MIMES_ACEITOS).toEqual(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);   // a lista dos outros itens não cresceu
  });
  it('mimeDoKmz e extDoArquivo: zip só com .kmz, octet-stream com .kmz ou .kml, o resto recusado', () => {
    expect(extDoArquivo('Casa do Zé.KMZ')).toBe('kmz');
    expect(extDoArquivo('.kml')).toBe('kml');
    expect(extDoArquivo(undefined)).toBe('');
    expect(mimeDoKmz('application/zip', 'kmz')).toBe('application/vnd.google-earth.kmz');
    expect(mimeDoKmz('application/x-zip-compressed', 'kmz')).toBe('application/vnd.google-earth.kmz');
    expect(mimeDoKmz('application/zip', 'kml')).toBeNull();
    expect(mimeDoKmz('application/octet-stream', 'kml')).toBe('application/vnd.google-earth.kml+xml');
    expect(mimeDoKmz('application/octet-stream', 'zip')).toBeNull();
    expect(mimeDoKmz('image/png', 'kmz')).toBeNull();
    expect(mimeDoKmz('application/vnd.google-earth.kmz', '')).toBe('application/vnd.google-earth.kmz');
  });
  it('assinaturaBate: KMZ é zip (PK 03 04); KML é XML, com BOM e espaços antes; o resto não vale', () => {
    const kmzMime = 'application/vnd.google-earth.kmz'; const kmlMime = 'application/vnd.google-earth.kml+xml';
    expect(assinaturaBate(kmzMime, Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe(true);
    expect(assinaturaBate(kmzMime, Uint8Array.from([0x25, 0x50, 0x44, 0x46]))).toBe(false);
    expect(assinaturaBate(kmlMime, Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>'))).toBe(true);
    expect(assinaturaBate(kmlMime, Buffer.from('<?xml version="1.0"?>'))).toBe(false);   // sem a raiz <kml
    expect(assinaturaBate(kmlMime, Buffer.from(String.fromCharCode(0xfeff) + '  <kml xmlns="x">'))).toBe(true);
    expect(assinaturaBate(kmlMime, Buffer.from('MZ binario'))).toBe(false);
    expect(assinaturaBate('application/pdf', Buffer.from('<?xml version'))).toBe(false);
  });
  it('kmlValido: raiz <kml depois de prólogo e comentários; aceita HTML em description; recusa DOCTYPE, outra raiz, <script (inclusive no fim) e raiz XHTML', () => {
    const kml = (miolo: string, antes = '') => antes + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' + miolo + '</Document></kml>';
    expect(kmlValido(kml('<name>Casa</name>'))).toBe(true);
    expect(kmlValido(kml('', '<?xml version="1.0"?>\n<!-- gerado no Google Earth -->\n'))).toBe(true);
    expect(kmlValido('<kml/>')).toBe(true);
    expect(kmlValido('<svg xmlns="http://www.w3.org/2000/svg"><kml/></svg>')).toBe(false);
    expect(kmlValido('<?xml version="1.0"?><!DOCTYPE kml [<!ENTITY x "y">]><kml/>')).toBe(false);
    expect(kmlValido('<?xml version="1.0"?><!-- sem fim <kml/>')).toBe(false);
    expect(kmlValido('<?xml sem fim <kml/>')).toBe(false);
    expect(kmlValido(kml('<script>alert(1)</script>'))).toBe(false);
    expect(kmlValido(kml('<description><![CDATA[<html><body><b>Casa</b> <a href="x">ver</a></body></html>]]></description>'))).toBe(true);   // balão HTML do Google Earth
    expect(kmlValido(kml('<description><![CDATA[<div onclick="x()">oi</div><SCRIPT>x</SCRIPT>]]></description>'))).toBe(false);
    expect(kmlValido('<kml xmlns="http://www.w3.org/1999/xhtml"><Document/></kml>')).toBe(false);
    expect(kmlValido('<html xmlns="http://www.w3.org/1999/xhtml"><kml/></html>')).toBe(false);
    expect(kmlValido(kml('<a/>'.repeat(5000) + '<SCRIPT >x</SCRIPT>'))).toBe(false);   // o perigo no fim do arquivo também conta
    expect(kmlValido('')).toBe(false);
    expect(assinaturaPedeArquivoInteiro('application/vnd.google-earth.kml+xml')).toBe(true);
    expect(assinaturaPedeArquivoInteiro('application/vnd.google-earth.kmz')).toBe(false);
  });
  it('lerCaminho aceita o caminho .kmz/.kml gerado pelo servidor e devolve o tipo do Google Earth', () => {
    const u = '00000001-0000-4000-8000-000000000000';
    expect(lerCaminho(`vendasolar/304/${u}.kmz`)).toMatchObject({ ext: 'kmz', mime: 'application/vnd.google-earth.kmz' });
    expect(lerCaminho(`vendasolar/304/${u}.kml`)).toMatchObject({ ext: 'kml', mime: 'application/vnd.google-earth.kml+xml' });
    expect(lerCaminho(`vendasolar/304/${u}.exe`)).toBeNull();
  });
});

describe('Trello: checklist BACKOFFICE', () => {
  it('o item KMZ fica marcado quando o slot kmz tem arquivo, e só então', () => {
    const marcado = (slots: string[]) => Object.fromEntries(planoDeChecklists(new Set(slots), true, true).BACKOFFICE.map((i) => [i.nome, i.marcado]));
    expect(marcado([]).KMZ).toBe(false);
    expect(marcado(['kmz']).KMZ).toBe(true);
    expect(marcado(['kmz'])['Datasheet Modulo']).toBe(false);
  });
});
