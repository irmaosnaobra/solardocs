import { describe, it, expect } from 'vitest';
import { examinarRevisao, ehDesenhado, textoVisivel, SENTINELA } from '../services/documentos/saudeDocumento';
import { generateFromTemplate } from '../services/templateService';

// ═══════════════════════════════════════════════════════════════════════════
// A trava entre a revisão do cliente e o que fica gravado.
//
// Caso real (17/09/2026): o contrato virou documento desenhado e o botão Editar
// entregava `[[HTML]]` + 18 KB de folha de estilo num campo de texto. Um
// assinante apagou uma cláusula e renumerou as outras treze à mão, no HTML cru.
// Deu certo por sorte. O editor já foi consertado; estes testes são a rede de
// baixo: revisão que ESTRAGA o documento não pode ser gravada por cima do
// documento inteiro, e o que tem conserto óbvio se conserta calado.
//
// O contrato aqui é o de verdade, saído do templateService — teste com HTML
// inventado não pega regressão de template.
// ═══════════════════════════════════════════════════════════════════════════

const company = {
  nome: 'MH ENERGIA SOLAR LTDA', cnpj: '12.345.678/0001-90',
  cidade: 'Fortaleza', uf: 'CE',
};
const client = {
  nome: 'VERA APARECIDA PADJARA QUINTEIRO', cpf_cnpj: '123.456.789-00',
  endereco: 'Av. Beira Mar, 2000', cidade: 'Fortaleza', uf: 'CE',
};
const fields = {
  potencia_kwp: '7.2', quantidade_modulos: '12', marca_modulos: '600W Tsun',
  quantidade_inversores: '1', tipo_inversor: 'Bifasico 220V', marca_inversor: 'SAJ 6KW',
  valor_total: '27400,00', condicoes_pagamento: 'Entrada de R$ 7.600,00 e 18 parcelas.',
  prazo_projeto_dias: '5', prazo_aprovacao_dias: '40', prazo_instalacao_dias: '10',
  garantia_modulos_anos: '15', garantia_inversor_anos: '10', garantia_instalacao_anos: '2',
  foro_cidade: 'Fortaleza',
};

const contrato = () => generateFromTemplate('contratoSolar', company as any, client as any, fields, 2);
const arquivo = (corpo: string) =>
  `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/></head><body>${corpo}</body></html>`;

describe('saúde do documento — o que entra é o contrato de verdade', () => {
  it('o contrato sai do template como documento desenhado', () => {
    const c = contrato();
    expect(ehDesenhado(c)).toBe(true);
    expect(c).toContain('<div class="ct"');
    expect(textoVisivel(c).length).toBeGreaterThan(2000);
  });

  it('revisão normal passa sem reparo e sem problema', () => {
    const c = contrato().replace('Objeto</h2>', 'Objeto</h2>').replace(
      'cabos e conectores', 'cabos, conectores e mão de obra',
    );
    const e = examinarRevisao({ content: c, html: arquivo(c), eraDesenhado: true });
    expect(e.problemas).toEqual([]);
    expect(e.reparos).toEqual([]);
    expect(e.content).toContain('mão de obra');
  });
});

describe('reparo calado — tem uma resposta certa só', () => {
  it('tira o contenteditable que vazou do editor, no content e no arquivo', () => {
    const c = contrato().replace('<div class="ct"', '<div contenteditable="true" class="ct"');
    const e = examinarRevisao({ content: c, html: arquivo(c), eraDesenhado: true });
    expect(e.content).not.toContain('contenteditable');
    expect(e.html).not.toContain('contenteditable');
    expect(e.problemas).toEqual([]);
    expect(e.reparos.join(' ')).toContain('contenteditable');
  });

  it('devolve o {{LOGO}} quando o base64 da tela veio junto', () => {
    const logo = 'data:image/png;base64,' + 'A'.repeat(120);
    const c = contrato().split('{{LOGO}}').join(logo);
    const e = examinarRevisao({ content: c, html: arquivo(c), eraDesenhado: true, logoBase64: logo });
    expect(e.content).toContain('{{LOGO}}');
    expect(e.content).not.toContain(logo);
    expect(e.problemas).toEqual([]);
  });

  it('o arquivo MANTÉM o base64: {{LOGO}} ali sairia impresso como texto', () => {
    const logo = 'data:image/png;base64,' + 'A'.repeat(120);
    const html = arquivo(contrato().split('{{LOGO}}').join(logo));
    const e = examinarRevisao({ html, eraDesenhado: true, logoBase64: logo });
    expect(e.html).toContain(logo);
    expect(e.html).not.toContain('{{LOGO}}');
  });

  it('recoloca o sentinela perdido na frente do <style>', () => {
    const c = contrato().slice(SENTINELA.length);
    expect(ehDesenhado(c)).toBe(false);
    const e = examinarRevisao({ content: c, html: arquivo(c), eraDesenhado: true });
    expect(ehDesenhado(e.content!)).toBe(true);
    expect(e.problemas).toEqual([]);
  });

  it('remove casca de cláusula vazia sem tocar no resto', () => {
    const c = contrato().replace('<div class="cl">', '<div class="cl"></div><div class="cl">');
    const e = examinarRevisao({ content: c, html: arquivo(c), eraDesenhado: true });
    expect(e.content).not.toContain('<div class="cl"></div>');
    expect(textoVisivel(e.content!).length).toBe(textoVisivel(contrato()).length);
    expect(e.problemas).toEqual([]);
  });
});

describe('recusa — gravar é que seria o estrago', () => {
  it('folha apagada inteira não é gravada', () => {
    const e = examinarRevisao({ content: SENTINELA + '<style>.ct{}</style>', html: arquivo(''), eraDesenhado: true });
    expect(e.problemas.join(' ')).toContain('sem texto nenhum');
  });

  it('estilo apagado não é gravado', () => {
    const c = contrato().replace(/<style>[\s\S]*?<\/style>/, '');
    const e = examinarRevisao({ content: c, html: arquivo(c), eraDesenhado: true });
    expect(e.problemas.join(' ')).toContain('estilo');
  });

  it('div raiz da folha apagada não é gravada', () => {
    const c = contrato().replace('<div class="ct"', '<div class="qualquer"');
    const e = examinarRevisao({ content: c, html: arquivo(c), eraDesenhado: true });
    expect(e.problemas.join(' ')).toContain('folha');
  });

  it('formato desenhado perdido de vez (sem <style> na frente) não é gravado', () => {
    const e = examinarRevisao({
      content: 'Contrato de instalação de usina fotovoltaica, entre as partes, conforme os termos abaixo assinados pelas duas partes envolvidas neste instrumento particular.',
      html: arquivo('<p>qualquer</p>'),
      eraDesenhado: true,
    });
    expect(e.problemas.join(' ')).toContain('formato desenhado');
  });

  it('arquivo sem página completa não é gravado', () => {
    const c = contrato();
    const e = examinarRevisao({ content: c, html: c, eraDesenhado: true });
    expect(e.problemas.join(' ')).toContain('página completa');
  });
});

describe('documento de texto (recibo, vistoria, contrato PJ) segue livre', () => {
  it('não exige sentinela nem folha de quem nunca foi desenhado', () => {
    const texto = 'RECIBO\n\nRecebi de VERA APARECIDA a quantia de R$ 1.000,00 referente a entrada do sistema fotovoltaico contratado nesta data.\n\n___________\nMH ENERGIA';
    const e = examinarRevisao({ content: texto, html: arquivo('<p>' + texto + '</p>'), eraDesenhado: false });
    expect(e.problemas).toEqual([]);
  });

  it('mas documento de texto vazio também é recusado', () => {
    const e = examinarRevisao({ content: '   \n  ', html: arquivo(''), eraDesenhado: false });
    expect(e.problemas.join(' ')).toContain('sem texto nenhum');
  });
});
