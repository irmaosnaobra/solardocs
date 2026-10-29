import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// O ENDPOINT POR ONDE TODA REVISÃO PASSA (PATCH /documents/:id/file).
//
// Dois defeitos reais moram aqui, e estes testes existem pra eles não voltarem:
//
//  1. Revisão que DESTRÓI a folha era gravada por cima do documento bom. Desde
//     que contrato, procuração e proposta de banco viraram desenhados, o que
//     chega não é texto: é a folha inteira. Agora o servidor confere e recusa.
//
//  2. O arquivo antigo era APAGADO ANTES de o novo subir. Upload que falhasse
//     deixava a linha apontando pra um arquivo que não existe mais — o link
//     público e o PDF respondiam "documento não disponível" pra um documento
//     que existe e está pago.
// ═══════════════════════════════════════════════════════════════════════════

const acoes: string[] = [];
let docSalvo: Record<string, unknown> | null = null;
let updateRecebido: Record<string, unknown> | null = null;
let uploadFalha: { message: string } | null = null;
let dono: { plano: string; is_admin: boolean } | null = { plano: 'ilimitado', is_admin: false };
const eventos: Array<Record<string, unknown>> = [];

vi.mock('../utils/supabase', () => {
  const supabase = {
    from: (tabela: string) => {
      if (tabela === 'documents') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ single: async () => ({ data: docSalvo }) }) }),
          }),
          update: (linha: Record<string, unknown>) => {
            updateRecebido = linha;
            acoes.push('update');
            return { eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'doc-1' }], error: null }) }) }) };
          },
        } as never;
      }
      if (tabela === 'company') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { logo_base64: LOGO } }) }) }),
        } as never;
      }
      if (tabela === 'users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: dono }) }) }) } as never;
      }
      return {
        // So o feature_events interessa: o logger tambem grava por aqui.
        insert: async (linha: Record<string, unknown>) => { if (tabela === 'feature_events') eventos.push(linha); return { error: null }; },
      } as never;
    },
    storage: {
      from: () => ({
        upload: async () => { acoes.push('upload'); return { error: uploadFalha }; },
        remove: async () => { acoes.push('remove'); return { error: null }; },
      }),
    },
  };
  return { supabase };
});

vi.mock('../services/aiService', () => ({ generateDocumentWithAI: async () => '' }));
vi.mock('../services/planService', () => ({ checkLimit: async () => ({ ok: true }), incrementUsed: async () => {}, runMonthlyReset: async () => {} }));

const LOGO = 'data:image/png;base64,' + 'A'.repeat(200);

import { updateDocumentFile } from '../controllers/documentsController';

const FOLHA = '[[HTML]]<style>.ct{color:#000}</style><div class="ct" data-run-header="MH"><p>'
  + 'Cláusula primeira, do objeto deste contrato de instalação de usina fotovoltaica. '.repeat(6)
  + '</p></div>';
const arquivo = (corpo: string) =>
  `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head><body>${corpo}</body></html>`;

function chamar(body: Record<string, unknown>) {
  const res: { code: number; corpo: any } = { code: 200, corpo: null };
  const fakeRes = {
    status(c: number) { res.code = c; return this; },
    json(o: unknown) { res.corpo = o; return this; },
  };
  const req = { params: { id: 'doc-1' }, body, userId: 'user-1' };
  return updateDocumentFile(req as never, fakeRes as never).then(() => res);
}

beforeEach(() => {
  acoes.length = 0;
  eventos.length = 0;
  updateRecebido = null;
  uploadFalha = null;
  dono = { plano: 'ilimitado', is_admin: false };
  docSalvo = { id: 'doc-1', user_id: 'user-1', arquivo_url: 'user-1/doc-1-antigo.html', content: FOLHA, tipo: 'contratoSolar' };
});

describe('revisão boa', () => {
  it('grava e sobe o arquivo NOVO antes de apagar o velho', async () => {
    const revisado = FOLHA.replace('do objeto', 'do objeto (revisado)');
    const r = await chamar({ content: revisado, html_content: arquivo(revisado) });

    expect(r.code).toBe(200);
    expect(acoes.indexOf('upload')).toBeLessThan(acoes.indexOf('remove'));
    // O antigo só sai depois do update que aponta para o novo.
    expect(acoes.indexOf('update')).toBeGreaterThanOrEqual(0);
    expect(acoes.indexOf('update')).toBeLessThan(acoes.indexOf('remove'));
    expect(updateRecebido!.content).toContain('(revisado)');
    expect(updateRecebido!.arquivo_url).toMatch(/^user-1\/doc-1-\d+\.html$/);
  });
});

describe('revisão com sujeira do editor — conserta calado e salva', () => {
  it('tira o contenteditable e devolve o {{LOGO}} antes de gravar', async () => {
    const sujo = FOLHA.replace('<div class="ct"', '<div contenteditable="true" class="ct"').replace('{{LOGO}}', LOGO);
    const comLogo = sujo.includes(LOGO) ? sujo : sujo.replace('<p>', `<img src="${LOGO}"><p>`);
    const r = await chamar({ content: comLogo, html_content: arquivo(comLogo) });

    expect(r.code).toBe(200);
    expect(String(updateRecebido!.content)).not.toContain('contenteditable');
    expect(String(updateRecebido!.content)).not.toContain(LOGO);
    expect(String(updateRecebido!.content)).toContain('{{LOGO}}');
    expect(r.corpo.reparos.length).toBeGreaterThan(0);
  });
});

describe('revisão que destrói o documento — recusa e não grava nada', () => {
  it('folha apagada: 422, sem update e sem upload', async () => {
    const r = await chamar({ content: '[[HTML]]<style>.ct{}</style>', html_content: arquivo('') });

    expect(r.code).toBe(422);
    expect(r.corpo.problemas.join(' ')).toContain('sem texto');
    expect(acoes).toEqual([]);          // nada tocado no Storage
    expect(updateRecebido).toBeNull();  // documento salvo continua inteiro
  });

  it('a recusa vira evento, pra sonda saber que alguém está apanhando', async () => {
    await chamar({ content: '[[HTML]]<style>.ct{}</style>', html_content: arquivo('') });

    expect(eventos).toHaveLength(1);
    expect(eventos[0].event_type).toBe('revisao_recusada');
    expect((eventos[0].event_data as Record<string, unknown>).tipo).toBe('contratoSolar');
  });

  it('estilo apagado: 422', async () => {
    const semEstilo = FOLHA.replace(/<style>[\s\S]*?<\/style>/, '');
    const r = await chamar({ content: semEstilo, html_content: arquivo(semEstilo) });
    expect(r.code).toBe(422);
    expect(r.corpo.problemas.join(' ')).toContain('estilo');
  });
});

describe('arquivo não subiu — não grava metade', () => {
  it('upload falhou: 503, nada gravado e o arquivo velho continua de pé', async () => {
    uploadFalha = { message: 'storage fora do ar' };
    const revisado = FOLHA.replace('do objeto', 'do objeto (revisado)');
    const r = await chamar({ content: revisado, html_content: arquivo(revisado) });

    expect(r.code).toBe(503);
    expect(acoes).toContain('upload');
    expect(acoes).not.toContain('remove');  // o velho segue lá, servindo o link
    expect(updateRecebido).toBeNull();      // e a coluna não fica na frente dele
  });
});

// Trava de cota (28/10/2026): revisar não gasta cota, então em plano com limite o nome do
// cliente salvo tem que continuar aparecendo no texto revisado. Comparação exata pela chaveCliente.
describe('trava de cota na revisão', () => {
  const comNome = (nome: string) => FOLHA.replace('<p>', `<p>Contratante: ${nome}. `);

  beforeEach(() => {
    docSalvo = { ...docSalvo, cliente_nome: 'João da Silva', content: comNome('João da Silva') };
    dono = { plano: 'pro', is_admin: false };
  });

  it('plano com limite: trocar o nome por outro cliente é 409 e nada é gravado', async () => {
    const revisado = comNome('Maria Souza');
    const r = await chamar({ content: revisado, html_content: arquivo(revisado) });

    expect(r.code).toBe(409);
    expect(r.corpo).toEqual({ error: 'cliente_diferente', message: 'Para outro cliente, gere um documento novo.' });
    expect(acoes).toEqual([]);
    expect(updateRecebido).toBeNull();
  });

  it('plano com limite: letra trocada no nome também é 409 (regra exata)', async () => {
    const revisado = comNome('João da Silvo');
    const r = await chamar({ content: revisado, html_content: arquivo(revisado) });
    expect(r.code).toBe(409);
  });

  it('plano com limite: nome em outra caixa, sem acento, com tag no meio e entidade passa', async () => {
    const revisado = FOLHA.replace('<p>', '<p>Contratante: <b>JOAO</b>&nbsp;DA   <i>silva</i>. ');
    const r = await chamar({ content: revisado, html_content: arquivo(revisado) });
    expect(r.code).toBe(200);
  });

  it('plano com limite: o nome só dentro de <style> não conta como impresso', async () => {
    const revisado = FOLHA.replace('.ct{color:#000}', '.ct{color:#000} /* joao da silva */');
    const r = await chamar({ content: revisado, html_content: arquivo(revisado) });
    expect(r.code).toBe(409);
  });

  it('o <title> com o nome antigo não salva um corpo com outro nome (o DocumentPreview sempre manda o title)', async () => {
    const revisado = comNome('Maria Souza');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>João da Silva</title></head><body>${revisado}</body></html>`;
    const r = await chamar({ content: revisado, html_content: html });

    expect(r.code).toBe(409);
    expect(r.corpo.error).toBe('cliente_diferente');
    expect(acoes).toEqual([]);
    expect(updateRecebido).toBeNull();
  });

  it('o content também tem que trazer o nome: html com o nome e content com outro é 409', async () => {
    const r = await chamar({ content: comNome('Maria Souza'), html_content: arquivo(comNome('João da Silva')) });
    expect(r.code).toBe(409);
    expect(updateRecebido).toBeNull();
  });

  it('com o nome certo no corpo o <title> não atrapalha', async () => {
    const revisado = comNome('João da Silva');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Outro</title></head><body>${revisado}</body></html>`;
    expect((await chamar({ content: revisado, html_content: html })).code).toBe(200);
  });

  it('ilimitado e admin trocam o nome', async () => {
    const revisado = comNome('Maria Souza');
    dono = { plano: 'ilimitado', is_admin: false };
    expect((await chamar({ content: revisado, html_content: arquivo(revisado) })).code).toBe(200);
    dono = { plano: 'free', is_admin: true };
    expect((await chamar({ content: revisado, html_content: arquivo(revisado) })).code).toBe(200);
  });
});
