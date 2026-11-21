import { describe, it, expect, vi } from 'vitest';

// Homologação lida do Trello (20/11/2026): a parte PURA. Espelho da checklist, classificação do anexo pelo nome, URL do Trello, registro, intervalo de
// 10 min, os itens da etapa 3 (ART e protocolo opcionais, parecer obrigatório), o autor da conclusão automática e o aviso "É sua" que ele decide.
// Dados inventados. Nada de rede, banco ou IA.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {}, geradorComServiceKey: false }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import {
  AUTOR_SILENCIOSO, AUTOR_TRELLO, INTERVALO_SINCRONIA_MS, anexoResolvido, autorDaConclusaoAutomatica, classificarPorNome, elegivelParaHomolog, espelharChecklist,
  homologDaTela, lerCartaoDoTrello, lerRegistroHomologBruto, mimePelaAssinatura, parecerAprovadoNoCartao, registroHomologVazio, sincroniaDevida, urlDoTrello,
} from '../services/gerador/trelloHomologPuro';
import { estadoMaterializado, itensDaEtapa, type EntradaItens } from '../services/gerador/jornadaSolar';
import { normalizarCadastro } from '../services/gerador/cadastroVenda';
import { eventosDoCard, type GrupoMsg } from '../services/io/jornadaMensagensPuro';

const ID1 = 'a'.repeat(24);
const ID2 = 'b'.repeat(24);
const AGORA = '2026-11-20T15:00:00.000Z';

const cartaoBruto = {
  shortUrl: 'https://trello.com/c/AbCd1234',
  checklists: [
    { name: 'BACKOFFICE', checkItems: [{ name: 'Foto Fachada', state: 'complete', pos: 1 }] },
    { name: 'Engenharia', checkItems: [
      { name: 'Parecer Aprovado', state: 'complete', pos: 40000 }, { name: 'Art Gerada', state: 'complete', pos: 10000 },
      { name: 'Projeto Feito', state: 'incomplete', pos: 30000 }, { name: 'Art Paga', state: 'incomplete', pos: 20000 },
    ] },
  ],
  attachments: [
    { id: ID1, name: 'ART - Cliente.pdf', fileName: 'art.pdf', url: 'https://trello.com/1/cards/x/attachments/y/download/art.pdf', mimeType: 'application/pdf', bytes: 1200, date: '2026-11-18T10:00:00.000Z', isUpload: true },
    { id: ID2, name: 'link do projeto', url: 'https://example.com/x', mimeType: '', bytes: 0, date: '2026-11-18T11:00:00.000Z', isUpload: false },
    { id: 'curto', name: 'sem id valido', url: 'https://trello.com/x' },
  ],
};

describe('espelho da checklist ENGENHARIA', () => {
  it('só a checklist ENGENHARIA, na ordem do Trello (pos), com feito pelo estado', () => {
    const c = lerCartaoDoTrello(cartaoBruto)!;
    expect(c.url).toBe('https://trello.com/c/AbCd1234');
    expect(c.checklist).toEqual([
      { nome: 'Art Gerada', feito: true }, { nome: 'Art Paga', feito: false }, { nome: 'Projeto Feito', feito: false }, { nome: 'Parecer Aprovado', feito: true },
    ]);
  });
  it('sem a checklist ENGENHARIA, lista vazia; corpo fora do formato dá null', () => {
    expect(espelharChecklist([{ name: 'BACKOFFICE', checkItems: [] }])).toEqual([]);
    expect(espelharChecklist(undefined)).toEqual([]);
    expect(lerCartaoDoTrello('texto')).toBeNull();
    expect(lerCartaoDoTrello(null)).toBeNull();
  });
  it('anexo com id fora do formato é descartado; os outros trazem upload e data', () => {
    const c = lerCartaoDoTrello(cartaoBruto)!;
    expect(c.anexos.map((a) => a.id)).toEqual([ID1, ID2]);
    expect(c.anexos[0]).toMatchObject({ upload: true, bytes: 1200, em: '2026-11-18T10:00:00.000Z', mime: 'application/pdf' });
    expect(c.anexos[1].upload).toBe(false);
  });
  it('"parecer aprovado" casa por nome sem acento e só vale marcado; item que não existe vale não', () => {
    const item = (nome: string, feito: boolean) => [{ nome, feito }];
    expect(parecerAprovadoNoCartao(item('Parecer Aprovado', true))).toBe(true);
    expect(parecerAprovadoNoCartao(item('parecer de acesso APROVADO!', true))).toBe(true);
    expect(parecerAprovadoNoCartao(item('Parecer Aprovado', false))).toBe(false);
    expect(parecerAprovadoNoCartao(item('Parecer solicitado', true))).toBe(false);
    expect(parecerAprovadoNoCartao([])).toBe(false);
  });
});

describe('classificar o anexo pelo nome', () => {
  it.each([
    ['ART - Joana Lima.pdf', '', 'art'],
    ['Anotação de Responsabilidade Técnica', '', 'art'],
    ['Protocolo Cemig 0923-48117', '', 'protocolo'],
    ['Solicitação de acesso', '', 'protocolo'],
    ['Parecer de acesso aprovado', '', 'parecer_acesso'],
    ['parecer.pdf', '', 'parecer_acesso'],
    ['Datasheet Inversor Growatt', '', 'outro'],
    ['Local.kmz', '', 'outro'],
    ['Comprovante pagamento ART', '', null],
    ['Boleto ART', '', null],
    ['IMG_2231.jpg', '', null],
    ['Parecer e protocolo juntos', '', null],
    ['', 'ART_0042.pdf', 'art'],
  ])('%s (%s) -> %s', (nome, arquivo, esperado) => {
    expect(classificarPorNome(nome, arquivo)).toBe(esperado);
  });
});

describe('a URL do anexo é do Trello?', () => {
  it.each([
    ['https://trello.com/1/cards/x/attachments/y/download/a.pdf', true],
    ['https://api.trello.com/1/cards/x', true],
    ['https://trello-attachments.trello.com/a/b', true],
    ['http://trello.com/x', false],
    ['https://trello.com.evil.com/x', false],
    ['https://eviltrello.com/x', false],
    ['https://example.com/trello.com', false],
    ['https://user:senha@trello.com/x', false],
    ['https://trello-attachments.s3.amazonaws.com/a', false],
    ['isto nao e url', false],
    ['', false],
  ])('%s -> %s', (url, esperado) => {
    expect(urlDoTrello(url)).toBe(esperado);
  });
  it('o tipo real vem da assinatura (jpeg, png, webp, pdf)', () => {
    expect(mimePelaAssinatura(Buffer.from('%PDF-1.4'))).toBe('application/pdf');
    expect(mimePelaAssinatura(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(mimePelaAssinatura(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe('image/png');
    expect(mimePelaAssinatura(Buffer.from('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(mimePelaAssinatura(Buffer.from('<html>'))).toBeNull();
  });
});

describe('registro por obra e intervalo de 10 min', () => {
  it('lê o registro bruto sem confiar: id ruim sai, parecer_aprovado precisa da checklist, erro é cortado', () => {
    const r = lerRegistroHomologBruto({
      card_id: ID1, cartao_url: 'https://trello.com/c/AbCd1234', tentado_em: AGORA, sincronizado_em: AGORA, erro: 'x'.repeat(500),
      checklist: [{ nome: 'Parecer Aprovado', feito: true }], parecer_aprovado: true, completo: false,
      anexos: { [ID1]: { resultado: 'importado', slot: 'art', em: AGORA, tentativas: 1 }, ruim: { resultado: 'importado', slot: 'art' } },
    });
    expect(r).toMatchObject({ card_id: ID1, parecer_aprovado: true, completo: false });
    expect(r.erro).toHaveLength(120);
    expect(Object.keys(r.anexos)).toEqual([ID1]);
    expect(lerRegistroHomologBruto({ parecer_aprovado: true, checklist: [] }).parecer_aprovado).toBe(false);
    expect(lerRegistroHomologBruto(null)).toEqual(registroHomologVazio());
    expect(lerRegistroHomologBruto({}).completo).toBeNull();
  });
  it('só tenta de novo depois de 10 min (conta a tentativa, não o sucesso)', () => {
    const t0 = Date.parse(AGORA);
    const r = { ...registroHomologVazio(), tentado_em: AGORA };
    expect(sincroniaDevida(registroHomologVazio(), t0)).toBe(true);
    expect(sincroniaDevida(r, t0 + 60_000)).toBe(false);
    expect(sincroniaDevida(r, t0 + INTERVALO_SINCRONIA_MS - 1)).toBe(false);
    expect(sincroniaDevida(r, t0 + INTERVALO_SINCRONIA_MS)).toBe(true);
    expect(INTERVALO_SINCRONIA_MS).toBe(600_000);
  });
  it('anexo importado ou ignorado nunca volta; o que falhou volta até 3 vezes', () => {
    const r = { ...registroHomologVazio(), anexos: {
      [ID1]: { resultado: 'importado' as const, slot: 'art' as const, em: AGORA, tentativas: 1 },
      [ID2]: { resultado: 'falhando' as const, slot: null, em: AGORA, tentativas: 2 },
      ['c'.repeat(24)]: { resultado: 'falhando' as const, slot: null, em: AGORA, tentativas: 3 },
    } };
    expect(anexoResolvido(r, ID1)).toBe(true);
    expect(anexoResolvido(r, ID2)).toBe(false);
    expect(anexoResolvido(r, 'c'.repeat(24))).toBe(true);
    expect(anexoResolvido(r, 'd'.repeat(24))).toBe(false);
  });
  it('só obra com a etapa 3 aberta, sem cancelar e sem a fase 2 fechada é lida', () => {
    const base = estadoMaterializado(1, 'nilce', 3, AGORA);
    expect(elegivelParaHomolog(base, null)).toBe(true);
    expect(elegivelParaHomolog({ ...base, cancelada: { em: AGORA, por: 'x', etapa: 3, com_numero: true } }, null)).toBe(false);
    expect(elegivelParaHomolog(base, { fechada: true })).toBe(false);
    expect(elegivelParaHomolog(estadoMaterializado(1, 'nilce', 4, AGORA), null)).toBe(false);
    expect(elegivelParaHomolog(estadoMaterializado(1, 'nilce', 2, AGORA), null)).toBe(false);
    expect(elegivelParaHomolog(null, null)).toBe(false);
  });
});

describe('contrato para a tela (etapas[2].trello_homolog)', () => {
  it('sem cartão é null; com cartão traz checklist e importados com o rótulo do item (nunca o nome do arquivo)', () => {
    expect(homologDaTela(null, false, null)).toBeNull();
    const r = {
      ...registroHomologVazio(), cartao_url: 'https://trello.com/c/AbCd1234', sincronizado_em: AGORA, erro: null, checklist: [{ nome: 'Parecer Aprovado', feito: true }],
      anexos: {
        [ID1]: { resultado: 'importado' as const, slot: 'parecer_acesso' as const, em: '2026-11-20T14:00:00.000Z', tentativas: 1 },
        [ID2]: { resultado: 'ignorado' as const, slot: null, em: AGORA, tentativas: 1 },
      },
    };
    expect(homologDaTela(r, true, null)).toEqual({
      cartao_url: 'https://trello.com/c/AbCd1234', sincronizado_em: AGORA, erro: null, checklist: [{ nome: 'Parecer Aprovado', feito: true }],
      importados: [{ slot: 'parecer_acesso', nome: 'Parecer de acesso aprovado', em: '2026-11-20T14:00:00.000Z' }],
    });
    expect(homologDaTela(null, true, 'https://trello.com/c/Zz9y8x7w')).toEqual({ cartao_url: 'https://trello.com/c/Zz9y8x7w', sincronizado_em: null, erro: null, checklist: [], importados: [] });
  });
});

const entrada = (o: { slots?: string[]; cartao?: boolean; aprovado?: boolean | null; protocolo?: boolean } = {}): EntradaItens => {
  const estado = estadoMaterializado(7, 'nilce', 3, AGORA);
  if (o.protocolo) estado.etapas[3].protocolo = { numero: '0923-48117', em: '2026-11-18' };
  return {
    lig: { proposta: null, venda: '#0070', trello_card: o.cartao === false ? null : ID1 }, slots: new Set(o.slots ?? []), cad: normalizarCadastro({ campos: {} }, 'vendasolar'), privado: null, estado,
    homolog: o.aprovado === null || o.aprovado === undefined ? null : { parecer_aprovado: o.aprovado },
  };
};
const itens3 = (f: EntradaItens) => itensDaEtapa(3, f);
const faltaObrigatoria = (f: EntradaItens): string[] => itens3(f).filter((i) => !i.feito && !i.opcional).map((i) => i.chave);

describe('os itens da etapa 3 (passo 5)', () => {
  const EQUIP = ['datasheet_modulo', 'datasheet_inversor', 'kmz'];
  it('ART e protocolo agora são opcionais (amarelo); o cartão também não trava', () => {
    const it3 = itens3(entrada({ slots: EQUIP }));
    for (const k of ['art', 'protocolo', 'trello']) expect(it3.find((i) => i.chave === k)).toMatchObject({ opcional: true, feito: k === 'trello' });
    expect(it3.find((i) => i.chave === 'parecer')!.opcional).toBeUndefined();
    expect(it3.find((i) => i.chave === 'parecer_aprovado')!.opcional).toBeUndefined();
  });
  it('com cartão, o vermelho é só "parecer aprovado" e o arquivo do parecer', () => {
    expect(faltaObrigatoria(entrada({ slots: EQUIP }))).toEqual(['parecer_aprovado', 'parecer']);
    expect(faltaObrigatoria(entrada({ slots: [...EQUIP, 'parecer_acesso'] }))).toEqual(['parecer_aprovado']);
    expect(faltaObrigatoria(entrada({ slots: EQUIP, aprovado: true }))).toEqual(['parecer']);
    expect(faltaObrigatoria(entrada({ slots: [...EQUIP, 'parecer_acesso'], aprovado: true }))).toEqual([]);
  });
  it('ART e protocolo feitos ou não, a etapa fecha igual', () => {
    const f = entrada({ slots: [...EQUIP, 'parecer_acesso', 'art', 'art_comprovante', 'protocolo'], aprovado: true, protocolo: true });
    expect(itens3(f).filter((i) => i.opcional).map((i) => `${i.chave}:${i.feito}`)).toEqual(['trello:true', 'art:true', 'protocolo:true']);
    expect(faltaObrigatoria(f)).toEqual([]);
  });
  it('sem cartão: o item do Trello nem aparece e só o parecer anexado à mão conta', () => {
    const sem = entrada({ slots: [...EQUIP, 'parecer_acesso'], cartao: false });
    expect(itens3(sem).some((i) => i.chave === 'parecer_aprovado')).toBe(false);
    expect(faltaObrigatoria(sem)).toEqual([]);
    expect(faltaObrigatoria(entrada({ slots: EQUIP, cartao: false }))).toEqual(['parecer']);
  });
});

describe('o autor da conclusão automática e o aviso "É sua"', () => {
  const dec = (completoAntes: boolean | null, origem: 'tela' | 'fila', filaDosDonosSaiu = false) => autorDaConclusaoAutomatica({ completoAntes, origem, filaDosDonosSaiu });
  it('constantes ASCII', () => {
    expect(AUTOR_TRELLO).toBe('trello');
    expect(AUTOR_SILENCIOSO).toBe('leitura');
  });
  it('primeira leitura (sem registro) já completa, ou completa que segue completa: leitura, em silêncio', () => {
    expect(dec(null, 'tela')).toBe('leitura');
    expect(dec(true, 'tela')).toBe('leitura');
    expect(dec(null, 'fila', true)).toBe('leitura');
  });
  it('a mudança vista (antes incompleto, agora completo) na tela leva trello', () => {
    expect(dec(false, 'tela')).toBe('trello');
  });
  it('às 08:00: fila dos donos ainda por sair = leitura; se a de um deles já saiu = trello', () => {
    expect(dec(false, 'fila', false)).toBe('leitura');
    expect(dec(false, 'fila', true)).toBe('trello');
  });

  // O robô "É sua" lê o `por` da linha `concluir`: aqui se prova o efeito do autor escolhido.
  const LIG = '2026-11-01T00:00:00.000Z';
  const ligados: Record<GrupoMsg, string | null> = { venda: LIG, etapa: LIG, fila: LIG, liberacao: null, aniversario: null };
  const comAutor = (por: string) => {
    const e = estadoMaterializado(65, 'nilce', 4, '2026-11-20T12:00:00.000Z');
    return { ...e, origem: 'vendido' as const, historico: [...e.historico, { em: '2026-11-20T14:50:00.000Z', por, acao: 'concluir' as const, etapa: 3 }] };
  };
  it('com `trello` o evento "É sua" sai para Thiago e Diego; com `leitura`, nenhum', () => {
    const agora = new Date(AGORA);
    const [ev] = eventosDoCard({ card: 65, js: comAutor('trello'), jo: null, vendedor: 'nilce' }, agora, ligados);
    expect(ev).toMatchObject({ tipo: 'sua', etapa: 4, para: ['thiago', 'diego'] });
    expect(ev.chaves).toEqual(['jornada_env:sua:65:4:thiago', 'jornada_env:sua:65:4:diego']);
    expect(eventosDoCard({ card: 65, js: comAutor('leitura'), jo: null, vendedor: 'nilce' }, agora, ligados)).toEqual([]);
  });
});
