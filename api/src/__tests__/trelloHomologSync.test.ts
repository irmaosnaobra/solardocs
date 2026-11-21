import { describe, it, expect, vi } from 'vitest';

// Homologação lida do Trello (20/11/2026): a sincronia de UMA obra, com TUDO simulado (cartão, download, IA, bucket, registro). Prova: espelho da
// checklist, classificação por nome e por IA, anexo importado uma vez só, item já preenchido não sobrescrito, protocolo (número e data), falha do Trello e da IA.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {}, geradorComServiceKey: false }));
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { sincronizarHomologacao, ERRO_SEM_LEITURA, type DepsHomolog } from '../services/gerador/trelloHomologSync';
import { autorDaConclusaoAutomatica, registroHomologVazio, type AnexoTrello, type CartaoHomolog, type RegistroHomolog } from '../services/gerador/trelloHomologPuro';
import type { LeituraAnexo } from '../services/gerador/trelloHomologIa';
import type { ResBaixa } from '../services/gerador/trelloHomologTrello';

const AGORA = new Date('2026-11-20T15:00:00.000Z');
const CARTAO = 'c'.repeat(24);
const idn = (n: number): string => n.toString(16).padStart(24, '0');
const anexo = (n: number, nome: string, o: Partial<AnexoTrello> = {}): AnexoTrello => ({
  id: idn(n), nome, arquivo: '', url: `https://trello.com/1/cards/${CARTAO}/attachments/${idn(n)}/download/x.pdf`, mime: 'application/pdf', bytes: 100,
  em: `2026-11-18T1${n}:00:00.000Z`, upload: true, ...o,
});
const checklist = (aprovado: boolean) => [{ nome: 'Art Gerada', feito: true }, { nome: 'Parecer Aprovado', feito: aprovado }];

interface Mundo {
  cartao: CartaoHomolog | { erro: true };
  slots: Set<string>;
  reg: RegistroHomolog;
  protocolo: { numero: string; em: string } | null;
  baixa: ResBaixa;
  ia: LeituraAnexo | null;
  marca: boolean;
  credencial: boolean;
  slotsFalha: boolean;
  enviados: Set<string>;
  gravacoes: Array<{ anexos: string[]; completo: boolean | null }>;
  chamadas: { baixar: string[]; ia: number; registrar: Array<{ slot: string; docId: string }>; marcas: Array<{ docId: string; anexoId: string }>; protocolo: Array<{ numero: string; em: string }> };
}
function mundo(o: Partial<Mundo> = {}): { m: Mundo; deps: DepsHomolog } {
  const m: Mundo = {
    cartao: { url: 'https://trello.com/c/AbCd1234', checklist: checklist(false), anexos: [] }, slots: new Set(), reg: registroHomologVazio(), protocolo: null,
    baixa: { ok: true, bytes: Buffer.from('%PDF-1.4'), mime: 'application/pdf' }, ia: null, marca: true, credencial: true, slotsFalha: false, enviados: new Set(), gravacoes: [],
    chamadas: { baixar: [], ia: 0, registrar: [], marcas: [], protocolo: [] }, ...o,
  };
  const deps: DepsHomolog = {
    agora: () => AGORA,
    credenciais: () => (m.credencial ? { key: 'k', token: 't' } : null),
    lerCartao: async () => ('erro' in m.cartao ? { ok: false, motivo: 'Trello respondeu 500' } : { ok: true, dados: m.cartao }),
    baixar: async (_c, a) => { m.chamadas.baixar.push(a.id); return m.baixa; },
    lerPorIa: async () => { m.chamadas.ia++; return m.ia; },
    anexosEnviados: async () => new Set(m.enviados),
    slotsComArquivo: async () => { if (m.slotsFalha) throw new Error('banco'); return new Set(m.slots); },
    registrar: async (e) => {
      if (m.slots.has(e.slot)) return { ok: false, motivo: 'slot_ocupado' };
      const id = `doc-${m.chamadas.registrar.length + 1}`;
      if (!(await e.antes(id))) return { ok: false, motivo: 'ocupado' };
      m.slots.add(e.slot);
      m.chamadas.registrar.push({ slot: e.slot, docId: id });
      return { ok: true, arquivo: { id, slot: e.slot, caminho: 'x', mime: e.mime, bytes: e.bytes.length, em: AGORA.toISOString(), por: 'trello' } };
    },
    marcarNoTrello: async (_c, docId, anexoId) => { if (m.marca) m.chamadas.marcas.push({ docId, anexoId }); return m.marca; },
    preencherProtocolo: async (p) => { if (m.protocolo) return 'ja_tinha'; m.protocolo = p; m.chamadas.protocolo.push(p); return 'preencheu'; },
    lerRegistro: async () => m.reg,
    gravarRegistro: async (r) => { m.reg = r; m.gravacoes.push({ anexos: Object.keys(r.anexos), completo: r.completo }); },
  };
  return { m, deps };
}
const com = (m: Mundo, anexos: AnexoTrello[], aprovado = false): void => { m.cartao = { url: 'https://trello.com/c/AbCd1234', checklist: checklist(aprovado), anexos }; };

describe('espelho da checklist', () => {
  it('grava a checklist, o link, a hora e o parecer aprovado; sem erro', async () => {
    const { m, deps } = mundo();
    com(m, [], true);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(r).toMatchObject({ acao: 'sincronizou', parecer_aprovado: true, importados: 0 });
    expect(m.reg).toMatchObject({
      card_id: CARTAO, cartao_url: 'https://trello.com/c/AbCd1234', tentado_em: AGORA.toISOString(), sincronizado_em: AGORA.toISOString(), erro: null, parecer_aprovado: true,
      checklist: checklist(true),
    });
  });
  it('o parecer volta a não aprovado se o engenheiro desmarcar', async () => {
    const { m, deps } = mundo({ reg: { ...registroHomologVazio(), parecer_aprovado: true } });
    com(m, [], false);
    expect((await sincronizarHomologacao(CARTAO, deps)).parecer_aprovado).toBe(false);
    expect(m.reg.parecer_aprovado).toBe(false);
  });
});

describe('classificação dos anexos: por nome e por IA', () => {
  it('o nome decide ART e parecer, sem gastar IA; o item é registrado como feito pelo Trello', async () => {
    const { m, deps } = mundo();
    com(m, [anexo(1, 'ART - Joana.pdf'), anexo(2, 'Parecer de acesso aprovado.pdf')]);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(r).toMatchObject({ importados: 2, ignorados: 0 });
    expect(m.chamadas.ia).toBe(0);
    expect(m.chamadas.registrar.map((x) => x.slot).sort()).toEqual(['art', 'parecer_acesso']);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'importado', slot: 'art' });
    expect(m.reg.anexos[idn(2)]).toMatchObject({ resultado: 'importado', slot: 'parecer_acesso' });
  });
  it('na dúvida (nome sem pista) a IA diz o que é; "outro" é ignorado e registrado', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'parecer_acesso', numero: '', data: '' } });
    com(m, [anexo(1, 'IMG_2231.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.ia).toBe(1);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'importado', slot: 'parecer_acesso' });
    const outro = mundo({ ia: { tipo: 'outro', numero: '', data: '' } });
    com(outro.m, [anexo(1, 'IMG_2231.pdf')]);
    await sincronizarHomologacao(CARTAO, outro.deps);
    expect(outro.m.chamadas.registrar).toHaveLength(0);
    expect(outro.m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'ignorado', slot: null });
  });
  it('o nome que diz "não é" (datasheet, kmz) e o link (não é upload) nem são baixados', async () => {
    const { m, deps } = mundo();
    com(m, [anexo(1, 'Datasheet Inversor.pdf'), anexo(2, 'Local.kmz'), anexo(3, 'link', { upload: false }), anexo(4, 'ART', { url: 'https://example.com/a.pdf' })]);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toEqual([]);
    expect(r).toMatchObject({ importados: 0, ignorados: 4 });
  });
});

describe('anexo importado uma vez só', () => {
  it('a segunda sincronia não baixa, não lê e não registra de novo; o que ficou ignorado também não volta', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'outro', numero: '', data: '' } });
    com(m, [anexo(1, 'ART.pdf'), anexo(2, 'IMG_9.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toHaveLength(2);
    expect(m.chamadas.ia).toBe(1);
    await sincronizarHomologacao(CARTAO, deps);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toHaveLength(2);
    expect(m.chamadas.ia).toBe(1);
    expect(m.chamadas.registrar).toHaveLength(1);
  });
  it('o arquivo é marcado no registro do envio ao Trello (id do documento -> id do anexo) ANTES de guardar, para o cartão não receber de volta o que mandou', async () => {
    const { m, deps } = mundo();
    com(m, [anexo(1, 'ART.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.marcas).toEqual([{ docId: 'doc-1', anexoId: idn(1) }]);
  });
  it('se não deu para marcar (trava ocupada), o anexo NÃO é guardado e volta na próxima rodada', async () => {
    const { m, deps } = mundo({ marca: false });
    com(m, [anexo(1, 'ART.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.registrar).toHaveLength(0);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'falhando', tentativas: 1 });
    m.marca = true;
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'importado', slot: 'art' });
  });
});

describe('item já preenchido não é sobrescrito', () => {
  it('o nome aponta um item com arquivo: nem baixa; fica ignorado', async () => {
    const { m, deps } = mundo({ slots: new Set(['art']) });
    com(m, [anexo(1, 'ART nova.pdf')]);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toEqual([]);
    expect(m.chamadas.registrar).toHaveLength(0);
    expect(r.ignorados).toBe(1);
  });
  it('dois anexos do mesmo item: só o primeiro (o mais antigo) entra', async () => {
    const { m, deps } = mundo();
    com(m, [anexo(2, 'Parecer 2.pdf'), anexo(1, 'Parecer 1.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.registrar).toHaveLength(1);
    expect(m.reg.anexos[idn(1)].resultado).toBe('importado');
    expect(m.reg.anexos[idn(2)].resultado).toBe('ignorado');
  });
  it('o item enchido por outra pessoa no meio da rodada (recusa do registro) vira ignorado, sem erro', async () => {
    const { m, deps } = mundo();
    const registrar = deps.registrar;
    deps.registrar = async (e) => { m.slots.add(e.slot); return registrar(e); };   // alguém anexou à mão no mesmo instante
    com(m, [anexo(1, 'ART.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'ignorado' });
    expect(m.chamadas.registrar).toHaveLength(0);
  });
});

describe('protocolo: número e data', () => {
  it('número e data da IA, gravados no estado (só o vazio); o item do protocolo é guardado', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'protocolo', numero: '0923-48117', data: '2026-11-17' } });
    com(m, [anexo(1, 'Protocolo Cemig.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.protocolo).toEqual({ numero: '0923-48117', em: '2026-11-17' });
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'importado', slot: 'protocolo' });
  });
  it('sem data no documento vale a data em que o anexo entrou no Trello (dia de Brasília)', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'protocolo', numero: '0923-48117', data: '' } });
    com(m, [anexo(1, 'Protocolo.pdf', { em: '2026-11-18T01:30:00.000Z' })]);   // 22:30 do dia 17 em Brasília
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.protocolo).toEqual({ numero: '0923-48117', em: '2026-11-17' });
  });
  it('data no futuro cai para a do anexo; sem número da IA nada é gravado no estado (mas o arquivo entra)', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'protocolo', numero: '7788/2026', data: '2026-12-31' } });
    com(m, [anexo(1, 'Protocolo.pdf', { em: '2026-11-19T13:00:00.000Z' })]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.protocolo).toEqual({ numero: '7788/2026', em: '2026-11-19' });
    const sem = mundo({ ia: { tipo: 'protocolo', numero: '', data: '2026-11-17' } });
    com(sem.m, [anexo(1, 'Protocolo.pdf')]);
    await sincronizarHomologacao(CARTAO, sem.deps);
    expect(sem.m.protocolo).toBeNull();
    expect(sem.m.slots.has('protocolo')).toBe(true);
  });
  it('protocolo que já está preenchido não é sobrescrito', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'protocolo', numero: '111', data: '2026-11-17' }, protocolo: { numero: 'MANUAL-1', em: '2026-11-10' } });
    com(m, [anexo(1, 'Protocolo.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.protocolo).toEqual({ numero: 'MANUAL-1', em: '2026-11-10' });
    expect(m.chamadas.protocolo).toHaveLength(0);
  });
});

describe('falhas: nunca lançam, sempre deixam o erro curto', () => {
  it('Trello fora do ar: erro curto no registro (sem URL, sem corpo), checklist antiga preservada', async () => {
    const { m, deps } = mundo({ reg: { ...registroHomologVazio(), checklist: checklist(true), sincronizado_em: '2026-11-20T10:00:00.000Z' } });
    m.cartao = { erro: true };
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(r).toMatchObject({ acao: 'falhou' });
    expect(m.reg.erro).toBe(ERRO_SEM_LEITURA);
    expect(m.reg.tentado_em).toBe(AGORA.toISOString());
    expect(m.reg.checklist).toEqual(checklist(true));
    expect(m.reg.sincronizado_em).toBe('2026-11-20T10:00:00.000Z');
    expect(JSON.stringify(m.reg)).not.toContain('500');
  });
  it('sem credencial: não faz nada e não grava', async () => {
    const { m, deps } = mundo({ credencial: false });
    expect(await sincronizarHomologacao(CARTAO, deps)).toMatchObject({ acao: 'sem_credencial' });
    expect(m.reg).toEqual(registroHomologVazio());
  });
  it('download com erro de rede volta até 3 vezes e depois fica ignorado; erro definitivo ignora na hora', async () => {
    const { m, deps } = mundo({ baixa: { ok: false, motivo: 'rede', definitivo: false } });
    com(m, [anexo(1, 'ART.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'falhando', tentativas: 1 });
    await sincronizarHomologacao(CARTAO, deps);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'ignorado', tentativas: 3 });
    const baixou = m.chamadas.baixar.length;
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toHaveLength(baixou);
    const def = mundo({ baixa: { ok: false, motivo: 'grande', definitivo: true } });
    com(def.m, [anexo(1, 'ART.pdf')]);
    await sincronizarHomologacao(CARTAO, def.deps);
    expect(def.m.reg.anexos[idn(1)].resultado).toBe('ignorado');
  });
  it('IA fora: o anexo sem pista volta nas próximas rodadas, não se perde nem trava as outras', async () => {
    const { m, deps } = mundo({ ia: null });
    com(m, [anexo(1, 'IMG_1.pdf'), anexo(2, 'ART.pdf')]);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'falhando', tentativas: 1 });
    expect(m.reg.anexos[idn(2)]).toMatchObject({ resultado: 'importado', slot: 'art' });
    expect(r.acao).toBe('sincronizou');
    m.ia = { tipo: 'parecer_acesso', numero: '', data: '' };
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.reg.anexos[idn(1)]).toMatchObject({ resultado: 'importado', slot: 'parecer_acesso' });
  });
  it('erro do banco ao ler os itens do card: registra o erro, não importa nada e não decide o obrigatório', async () => {
    const { m, deps } = mundo({ slotsFalha: true, reg: { ...registroHomologVazio(), completo: false } });
    com(m, [anexo(1, 'ART.pdf')], true);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toEqual([]);
    expect(m.reg.erro).toBeTruthy();
    expect(m.reg.completo).toBe(false);
    expect(r.completo_agora).toBe(false);
  });
});

describe('o obrigatório completo (parecer aprovado + arquivo do parecer)', () => {
  it('completo_antes diz como a leitura anterior estava; completo_agora, como está agora', async () => {
    const { m, deps } = mundo();
    com(m, [], true);
    const r1 = await sincronizarHomologacao(CARTAO, deps);
    expect(r1).toMatchObject({ completo_antes: null, completo_agora: false });   // aprovado, mas sem o arquivo do parecer
    com(m, [anexo(1, 'Parecer de acesso.pdf')], true);
    const r2 = await sincronizarHomologacao(CARTAO, deps);
    expect(r2).toMatchObject({ completo_antes: false, completo_agora: true });   // a mudança foi vista
    const r3 = await sincronizarHomologacao(CARTAO, deps);
    expect(r3).toMatchObject({ completo_antes: true, completo_agora: true });
  });
  it('primeira leitura já completa: antes é null (a conclusão sai em silêncio)', async () => {
    const { m, deps } = mundo({ slots: new Set(['parecer_acesso']) });
    com(m, [], true);
    expect(await sincronizarHomologacao(CARTAO, deps)).toMatchObject({ completo_antes: null, completo_agora: true });
  });
  it('só o arquivo do parecer, sem o item marcado no Trello, não completa', async () => {
    const { m, deps } = mundo({ slots: new Set(['parecer_acesso']) });
    com(m, [], false);
    expect((await sincronizarHomologacao(CARTAO, deps)).completo_agora).toBe(false);
  });
});

describe('teto por rodada', () => {
  it('trata no máximo 4 anexos novos por rodada, do mais antigo ao mais novo; o resto fica para a próxima', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'outro', numero: '', data: '' } });
    com(m, [1, 2, 3, 4, 5, 6].map((n) => anexo(n, `IMG_${n}.pdf`)));
    await sincronizarHomologacao(CARTAO, deps);
    expect(Object.keys(m.reg.anexos)).toHaveLength(4);
    await sincronizarHomologacao(CARTAO, deps);
    expect(Object.keys(m.reg.anexos)).toHaveLength(6);
  });
});

describe('acúmulo antigo não vira aviso', () => {
  const autor = (r: { completo_antes: boolean | null }): string => autorDaConclusaoAutomatica({ completoAntes: r.completo_antes, origem: 'tela', filaDosDonosSaiu: false });

  it('o que NÓS mandamos ao cartão (registro do envio) nunca é baixado nem lido de volta, e nem gasta o teto', async () => {
    const { m, deps } = mundo({ enviados: new Set([idn(1), idn(2), idn(3), idn(4), idn(5)]) });
    com(m, [1, 2, 3, 4, 5].map((n) => anexo(n, `IMG_${n}.pdf`)).concat(anexo(6, 'Parecer de acesso.pdf')), true);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toEqual([idn(6)]);
    expect(m.chamadas.ia).toBe(0);
    expect(r).toMatchObject({ importados: 1, completo_agora: true });
    expect(m.reg.completo).toBe(true);   // nada pendente: a leitura é definitiva
  });
  it('a ordem é parecer (e o que não tem pista), depois protocolo, depois ART; o mais antigo primeiro dentro do grupo', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'outro', numero: '', data: '' } });
    com(m, [anexo(1, 'ART.pdf'), anexo(2, 'Protocolo.pdf'), anexo(3, 'IMG_3.pdf'), anexo(4, 'Parecer.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toEqual([idn(4), idn(3), idn(2), idn(1)]);
  });
  it('o que o nome descarta (datasheet, link) não gasta o teto: 6 datasheets antigos não seguram o parecer', async () => {
    const { m, deps } = mundo();
    com(m, [...[1, 2, 3, 4, 5, 6].map((n) => anexo(n, `Datasheet ${n}.pdf`)), anexo(7, 'Parecer.pdf')], true);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(r).toMatchObject({ importados: 1, ignorados: 6, completo_agora: true });
  });
  it('CENÁRIO: obra antiga, muita coisa sem pista no cartão e o parecer entra depois do teto: o "completo" fica desconhecido e o autor NUNCA é `trello`', async () => {
    const { m, deps } = mundo({ ia: { tipo: 'outro', numero: '', data: '' } });
    // 6 anexos sem pista (o /gerador não os mandou), mais velhos; o parecer é o último, mas é do grupo que vai primeiro SE tiver nome. Aqui sem pista, para provar o pior caso.
    com(m, [...[1, 2, 3, 4, 5].map((n) => anexo(n, `IMG_${n}.pdf`)), anexo(6, 'documento 6.pdf')], true);
    const r1 = await sincronizarHomologacao(CARTAO, deps);
    expect(m.chamadas.baixar).toHaveLength(4);
    expect(m.reg.completo).toBeNull();                 // ainda há anexo por ver: desconhecido
    expect(autor(r1)).toBe('leitura');
    m.ia = { tipo: 'parecer_acesso', numero: '', data: '' };
    const r2 = await sincronizarHomologacao(CARTAO, deps);   // sobram 2: o parecer aparece aqui
    expect(r2).toMatchObject({ completo_antes: null, completo_agora: true });
    expect(autor(r2)).toBe('leitura');                  // a leitura anterior era desconhecida: sem aviso
    expect(m.reg.completo).toBe(true);
    const r3 = await sincronizarHomologacao(CARTAO, deps);
    expect(autor(r3)).toBe('leitura');
  });
  it('só uma leitura DEFINITIVA e incompleta seguida de uma completa vira `trello`', async () => {
    const { m, deps } = mundo();
    com(m, [], true);
    const r1 = await sincronizarHomologacao(CARTAO, deps);
    expect(m.reg.completo).toBe(false);                 // nada pendente e faltando o arquivo do parecer
    expect(autor(r1)).toBe('leitura');                  // (não está completa: nem chega a concluir)
    com(m, [anexo(1, 'Parecer de acesso.pdf')], true);
    const r2 = await sincronizarHomologacao(CARTAO, deps);
    expect(r2).toMatchObject({ completo_antes: false, completo_agora: true });
    expect(autor(r2)).toBe('trello');
  });
  it('anexo que falhou (IA fora) conta como pendente: o "completo" volta a desconhecido', async () => {
    const { m, deps } = mundo({ ia: null, reg: { ...registroHomologVazio(), completo: false } });
    com(m, [anexo(1, 'IMG_1.pdf'), anexo(2, 'Parecer.pdf')], true);
    const r = await sincronizarHomologacao(CARTAO, deps);
    expect(r.completo_agora).toBe(true);
    expect(m.reg.completo).toBeNull();
  });
});

describe('o registro é gravado a cada anexo (rodada interrompida não repete o trabalho)', () => {
  it('uma gravação depois de cada anexo e a final; a primeira já traz o primeiro anexo', async () => {
    const { m, deps } = mundo();
    com(m, [anexo(1, 'Parecer.pdf'), anexo(2, 'ART.pdf')]);
    await sincronizarHomologacao(CARTAO, deps);
    expect(m.gravacoes.map((g) => g.anexos.length)).toEqual([1, 2, 2]);
    expect(m.gravacoes[0].anexos).toEqual([idn(1)]);
  });
});
