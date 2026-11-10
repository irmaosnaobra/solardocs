import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { generateFromTemplate } from '../services/templateService';
import { BANCOS_IDS } from '../services/templates/bancosLogos';
import { tempoOffGrid } from '../services/templates/propostaOffGridCompleta';
import { valorParcelaCartao, valorParcelaFin, taxaCartao } from '../services/propostaSolarCalculos';
import { pBRL } from '../services/propostaSolarBase';
import { empresaOffGrid, clienteOffGrid, dadosOffGrid } from './fixtures/offgridDados';

const HTTPS = 'https://projeto.supabase.co/storage/v1/object/sign/documentos/portfolio/u1/obra/1-abc123.jpg?token=xyz';
const fotos = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `${HTTPS}${i}`, legenda: `Obra ${i + 1}` }));

const assinaturaValida = {
  empresa: { razao_social: 'Sol Forte Energia Ltda', cnpj: '11222333000181', representante: 'Carlos Pereira', cargo: 'Sócio administrador' },
  cliente: { tipo: 'PF', nome: 'Maria Aparecida Souza', documento: '52998224725' },
};
const dadosBancarios = { banco: 'Banco Exemplo', agencia: '0001', conta: '12345-6', tipo_conta: 'corrente', titular: 'Sol Forte Energia Ltda', documento: '11.222.333/0001-81', pix: 'chave-pix-exemplo@solforte.example' };

const base: Record<string, unknown> = { ...dadosOffGrid, emitido_em: '2026-11-09T15:00:00.000Z', codigo: '20260031', endereco: 'Estrada do Pequi, km 8, Zona Rural' };
const gerar = (f: Record<string, unknown> = {}, emp: any = empresaOffGrid, modelo: 1 | 2 | 3 | 4 = 2) => {
  const out: { resumo?: string } = {};
  const html = generateFromTemplate('propostaOffGrid', emp, clienteOffGrid, { ...base, ...f }, modelo, out);
  return { html, out };
};
const paginas = (h: string) => (h.match(/<div class="page[ "]/g) || []).length;
const secoes = (h: string) => (h.match(/<div class="tab">[^<]+<\/div>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));
/** Só o que o cliente lê: sem <style>, sem SVG, sem tags, sem entidades. */
function textoVisivel(h: string): string {
  return h
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<title>[\s\S]*?<\/title>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

describe('off-grid modelo 2 (Completa): folhas', () => {
  it('liga como modelo 2 do propostaOffGrid e o modelo 1 segue sendo outro documento', () => {
    const m2 = gerar({}, empresaOffGrid, 2).html;
    const m1 = gerar({}, empresaOffGrid, 1).html;
    expect(m2).toContain('Off-grid Completa');
    expect(m1).not.toContain('Off-grid Completa');
    expect(m2).not.toBe(m1);
  });

  it('o resumo do WhatsApp é o mesmo do modelo 1', () => {
    const a = gerar({}, empresaOffGrid, 1).out.resumo;
    const b = gerar({}, empresaOffGrid, 2).out.resumo;
    expect(b).toBeTruthy();
    expect(b).toBe(a);
  });

  it('mínimo: Projeto, Autonomia, Investimento, cronograma e garantias; sem obras e sem aceite', () => {
    const { html } = gerar({ comp_opcoes: undefined });
    const s = secoes(html);
    expect(s).toContain('Seu sistema off-grid');
    expect(s).toContain('Composição do sistema');
    expect(s).toContain('Autonomia e consumo');
    expect(s).toContain('Investimento e formas de pagamento');
    expect(s).not.toContain('Obras realizadas');
    expect(s).not.toContain('Aceite da proposta');
    expect(html).toContain('Cronograma do projeto');
  });

  it('cabeçalho só na 1ª folha, rodapé grande só na última, numeração fecha', () => {
    for (const f of [{}, { assinatura: assinaturaValida, fotos_obras: fotos(6) }]) {
      const { html } = gerar(f);
      const total = paginas(html);
      expect((html.match(/<div class="head">/g) || []).length).toBe(1);
      expect((html.match(/<div class="foot">/g) || []).length).toBe(1);
      expect(html).toContain(`Proposta Off-grid · Maria Aparecida Souza · ${total}/${total}`);
      expect(html).toContain(`· 2/${total}`);
    }
  });

  it('a altura mínima da folha é 1122px (nunca 1123 na classe .page do Completo)', () => {
    const { html } = gerar({});
    expect(html).toContain('.page{ width:794px; min-height:1122px;');
    // O CSS do modelo 1 (1123) vem antes e é sobrescrito pelo do Completo, que vem depois.
    expect(html.lastIndexOf('min-height:1122px')).toBeGreaterThan(html.lastIndexOf('min-height:1123px'));
  });
});

describe('off-grid modelo 2: fotos das obras (6, 9 ou 12)', () => {
  const nFotos = (n: number) => (gerar({ fotos_obras: fotos(n) }).html.match(/<div class="ob">/g) || []).length;
  it('menos de 6 some a folha; de 6 em diante sai em fileiras de 3, no máximo 12', () => {
    expect(nFotos(0)).toBe(0);
    expect(nFotos(5)).toBe(0);
    expect(secoes(gerar({ fotos_obras: fotos(5) }).html)).not.toContain('Obras realizadas');
    expect(nFotos(6)).toBe(6);
    expect(nFotos(7)).toBe(6);
    expect(nFotos(9)).toBe(9);
    expect(nFotos(11)).toBe(9);
    expect(nFotos(12)).toBe(12);
    expect(nFotos(20)).toBe(12);
    expect(secoes(gerar({ fotos_obras: fotos(6) }).html)).toContain('Obras realizadas');
  });

  it('não repete a mesma foto (própria da proposta e da empresa com a mesma URL)', () => {
    const seis = fotos(6);
    expect((gerar({ fotos_obras: [...seis, ...seis] }).html.match(/<div class="ob">/g) || []).length).toBe(6);
    // 3 repetidas e 3 novas: sobram 6 únicas
    expect((gerar({ fotos_obras: [...fotos(3), ...fotos(3), ...fotos(6).slice(3)] }).html.match(/<div class="ob">/g) || []).length).toBe(6);
  });

  it('só https ou data:image entram', () => {
    const lixo = [{ url: 'javascript:alert(1)', legenda: 'x' }, { url: 'http://x.com/a.jpg', legenda: 'y' }];
    expect((gerar({ fotos_obras: [...lixo, ...fotos(5)] }).html.match(/<div class="ob">/g) || []).length).toBe(0);
  });
});

describe('off-grid modelo 2: aceite', () => {
  it('assinatura válida: última folha com as duas assinaturas, CPF no cabeçalho e rodapé grande só nela', () => {
    const { html } = gerar({ assinatura: assinaturaValida });
    const s = secoes(html);
    expect(s[s.length - 1]).toBe('Aceite da proposta');
    expect(html).toContain('Resumo do que está sendo aceito');
    expect(html).toContain('Pela empresa');
    expect(html).toContain('Pelo cliente');
    expect(html).toContain('529.982.247-25');
    expect((html.match(/<div class="foot">/g) || []).length).toBe(1);
    expect(html.indexOf('<div class="foot">')).toBeGreaterThan(html.indexOf('Aceite da proposta'));
  });

  it('sem assinatura, ou com assinatura inválida: sem aceite, sem CPF, rodapé grande na folha anterior', () => {
    const invalidas: unknown[] = [
      undefined,
      null,
      'texto',
      { ...assinaturaValida, cliente: { ...assinaturaValida.cliente, documento: '11111111111' } },
      { ...assinaturaValida, cliente: { ...assinaturaValida.cliente, documento: '52998224726' } },
      { ...assinaturaValida, empresa: { ...assinaturaValida.empresa, cnpj: '11222333000182' } },
      { ...assinaturaValida, empresa: { ...assinaturaValida.empresa, representante: '' } },
      { ...assinaturaValida, cliente: { ...assinaturaValida.cliente, nome: 'Maria' } },
    ];
    for (const a of invalidas) {
      const { html } = gerar({ assinatura: a });
      expect(secoes(html)).not.toContain('Aceite da proposta');
      expect(html).not.toContain('Pela empresa');
      expect(html).not.toContain('529.982.247');
      expect((html.match(/<div class="foot">/g) || []).length).toBe(1);
    }
  });

  it('cliente PJ: CNPJ inteiro e representante', () => {
    const a = { ...assinaturaValida, cliente: { tipo: 'PJ', nome: 'Fazenda Boa Vista Ltda', documento: '11222333000181', representante: 'Ana Lima' } };
    const { html } = gerar({ assinatura: a });
    expect(html).toContain('CNPJ 11.222.333/0001-81');
    expect(html).toContain('Ana Lima');
  });

  it('texto do usuário no aceite sai escapado', () => {
    const a = { ...assinaturaValida, empresa: { ...assinaturaValida.empresa, representante: '<img src=x onerror=alert(1)>' } };
    const { html } = gerar({ assinatura: a });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('off-grid modelo 2: bancos e dados bancários', () => {
  const nBancos = (h: string) => (h.match(/<div class="bk fx">/g) || []).length;
  it('bancos_logos ausente = os 12; [] = nenhum; subconjunto respeita a escolha', () => {
    expect(BANCOS_IDS.length).toBe(12);
    expect(nBancos(gerar({}).html)).toBe(12);
    expect(nBancos(gerar({ bancos_logos: null }).html)).toBe(12);
    const vazio = gerar({ bancos_logos: [] }).html;
    expect(nBancos(vazio)).toBe(0);
    expect(vazio).not.toContain('Bancos que financiam');
    expect(nBancos(gerar({ bancos_logos: ['bb', 'caixa', 'inexistente'] }).html)).toBe(2);
  });

  it('dados bancários só com mostrar_dados_bancarios === true e dados completos', () => {
    const emp = { ...empresaOffGrid, dados_bancarios: dadosBancarios };
    expect(gerar({}, emp).html).not.toContain('chave-pix-exemplo');
    expect(gerar({ mostrar_dados_bancarios: false }, emp).html).not.toContain('chave-pix-exemplo');
    expect(gerar({ mostrar_dados_bancarios: 'true' }, emp).html).not.toContain('chave-pix-exemplo');
    const ligado = gerar({ mostrar_dados_bancarios: true }, emp).html;
    expect(ligado).toContain('Dados para pagamento');
    expect(ligado).toContain('chave-pix-exemplo@solforte.example');
    // Ligado, mas a empresa não tem dados: nada sai
    expect(gerar({ mostrar_dados_bancarios: true }, empresaOffGrid).html).not.toContain('Dados para pagamento');
  });
});

describe('off-grid modelo 2: comparativo, aparelhos e cronograma', () => {
  it('comparativo só com 2 ou mais opções', () => {
    expect(gerar({}).html).toContain('Rede, diesel ou off-grid');
    const opcs = dadosOffGrid.comp_opcoes as unknown[];
    expect(gerar({ comp_opcoes: opcs.slice(0, 2) }).html).toContain('Rede, diesel ou off-grid');
    expect(gerar({ comp_opcoes: opcs.slice(0, 1) }).html).not.toContain('Rede, diesel ou off-grid');
    expect(gerar({ comp_opcoes: undefined }).html).not.toContain('Rede, diesel ou off-grid');
  });

  it('"O que o sistema liga": a lista de aparelhos, se vier; senão consumo por mês e por dia', () => {
    const com = gerar({ aparelhos: [{ nome: 'Geladeira frost free', qtd: 1, w: 150, horas: 8, essencial: true }, { nome: 'Bomba d\'água 1/2 cv', qtd: 1, w: 550, horas: 1.5, essencial: true }] }).html;
    expect(com).toContain('Geladeira frost free');
    expect(com).toContain('2 aparelhos');
    const sem = gerar({}).html;
    expect(sem).toContain('O que o sistema liga');
    expect(sem).toContain('Consumo por mês');
    expect(sem).toContain('Consumo por dia');
    expect(sem).not.toContain('class="ogApar"');
  });

  it('cronograma: 5 etapas do sistema isolado, com desenho, e sem homologação como etapa', () => {
    const { html } = gerar({});
    for (const t of ['Visita técnica', 'Projeto e dimensionamento', 'Entrega do kit', 'Instalação', 'Ligação e treinamento']) expect(html).toContain(t);
    expect((html.match(/<div class="cr">/g) || []).length).toBe(5);
    expect((html.match(/<div class="ci"><svg/g) || []).length).toBe(5);
    expect(html).not.toContain('Vistoria técnica');
    expect(html).not.toContain('<span class="n">4</span>Homologação');
    expect(html).toContain('não precisa de homologação na concessionária');
  });

  it('garantias saem dos itens do kit', () => {
    const { html } = gerar({});
    expect(html).toContain('Garantias inclusas');
    expect(html).toContain('12 anos');
  });

  it('tempo em linguagem de gente, sem travessão', () => {
    expect(tempoOffGrid(2.125)).toBe('2 dias e 3 horas');
    expect(tempoOffGrid(1)).toBe('1 dia');
    expect(tempoOffGrid(0.5)).toBe('12 horas');
    expect(tempoOffGrid(0)).toBe('menos de 1 hora');
    expect(tempoOffGrid(NaN)).toBe('menos de 1 hora');
    expect(tempoOffGrid(1.999)).toBe('2 dias');
  });
});

describe('off-grid modelo 2: textos', () => {
  const completo = () => gerar({
    assinatura: assinaturaValida, fotos_obras: fotos(9), mostrar_dados_bancarios: true,
    aparelhos: [{ nome: 'Geladeira frost free', qtd: 1, w: 150, horas: 8, essencial: true }],
    itens_cliente: [
      { nome: 'Inversor híbrido 5 kW mono 220V — 2 MPPT', qtd: 1, garantia: 5 },
      { nome: 'String box CC com DPS e fusíveis', qtd: 1 },
      { nome: 'Conectores da string', qtd: 2 },
    ],
    comp_opcoes: [
      { id: 'rede', nome: 'Puxar a rede – 800 m', entrada: 96000, mensal: 310, total: 175200, porKwh: 1.71, linhas: [{ rotulo: 'Obra da rede — poste', valor: 96000 }], observacao: '' },
      { id: 'offgrid', nome: 'Sistema off-grid', entrada: 78900, mensal: 90, total: 89700, porKwh: 0.87, linhas: [], observacao: '' },
    ],
  }, { ...empresaOffGrid, dados_bancarios: dadosBancarios }).html;

  it('sem travessão, sem emoji, sem "string", sem Voc e Vmp no que o cliente lê', () => {
    const t = textoVisivel(completo());
    expect(t).not.toMatch(/[\u2014\u2013]/);
    expect(t).not.toMatch(/\bstrings?\b/i);
    expect(t).not.toMatch(/(?<![\p{L}])(?:Voc|Vmp)(?![\p{L}])/iu);
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(t).toContain('Caixa de proteção CC');
    expect(t).toContain('conjunto de placas');
  });

  it('as folhas e as faixas começam com maiúscula', () => {
    const h = completo();
    for (const s of secoes(h)) expect(s.charAt(0)).toBe(s.charAt(0).toUpperCase());
    for (const m of h.match(/<div class="(?:t|k|nm)">[^<]+<\/div>/g) || []) {
      const txt = m.replace(/<[^>]+>/g, '');
      expect(txt.charAt(0)).toBe(txt.charAt(0).toUpperCase());
    }
  });

  it('nome do cliente com HTML sai escapado', () => {
    const out: { resumo?: string } = {};
    const html = generateFromTemplate('propostaOffGrid', empresaOffGrid, { ...clienteOffGrid, nome: '<script>alert(1)</script>' }, base, 2, out);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('não imprime custo, frete nem margem', () => {
    const t = textoVisivel(completo());
    expect(t).not.toMatch(/margem|custo de fornecimento|frete/i);
  });
});

// ─── Modo "Meu equipamento", formas de pagamento e lista completa de itens ───

const itensProprios = [
  { nome: 'Inversor híbrido 6 kW marca do integrador', qtd: 1, garantia: 7 },
  { nome: 'Módulo fotovoltaico 400 W', qtd: 10 },
  { nome: 'Bateria 48V 100Ah', qtd: 4 },
  { nome: 'Estrutura de fixação em solo', qtd: 1 },
  { nome: 'Cabos, conectores e proteções', qtd: 1 },
  { nome: 'Frete até a propriedade', qtd: 1 },
  { nome: 'Montagem e projeto elétrico', qtd: 1 },
];
// Campos que o catálogo da casa manda e que o modo próprio TEM que ignorar (provam que nada vaza).
const camposDaCasa = { bateria_garantia: 5, garantia_estrutura: 10, bateria_nome: 'Bateria lítio 48V 100Ah SAJ B3-H2', inversor_nome: 'Inversor SAJ H2 5 kW', garantia_paineis: 25 };
const proprio = (f: Record<string, unknown> = {}) => gerar({ modo_equipamento: 'proprio', itens_cliente: itensProprios, ...camposDaCasa, ...f });
const nomesItens = (n: number) => Array.from({ length: n }, (_, i) => ({ nome: `Equipamento exclusivo número ${i + 1} do integrador`, qtd: i + 1 }));

describe('off-grid modelo 2: modo "Meu equipamento"', () => {
  it('kit_atende_placas false corta a promessa de fechar a conta em junho; ausente ou true mantém (modo kit não muda)', () => {
    const frase = 'Ele fecha a conta em junho também';
    expect(textoVisivel(proprio({ kit_atende_placas: false }).html)).not.toContain(frase);
    expect(textoVisivel(proprio({ kit_atende_placas: false }).html)).not.toMatch(/sobra energia de propósito/);
    expect(textoVisivel(proprio({ kit_atende_placas: false }).html)).toContain('a geração fica em torno de');
    expect(textoVisivel(proprio({ kit_atende_placas: true }).html)).toContain(frase);
    expect(textoVisivel(proprio().html)).toContain(frase);
    expect(textoVisivel(gerar({}).html)).toContain(frase);
    expect(gerar({ kit_atende_placas: true }).html).toBe(gerar({}).html);
  });

  it('nenhum texto cita o kit da casa, nem lítio, nem "kit", nem híbrido por suposição', () => {
    const t = textoVisivel(proprio({ assinatura: assinaturaValida, fotos_obras: fotos(6) }).html);
    expect(t).not.toMatch(/SAJ|Irmãos na Obra|\bB3\b|\bH2\b|620\s*Wp|Inmetro/i);
    expect(t).not.toMatch(/lítio|\bkit\b/i);
    expect(t).not.toMatch(/Inversor híbrido(?! 6 kW)/);
    expect(t).not.toMatch(/Projeto, instalação e comissionamento/);
    expect(t).not.toMatch(/mais de 10 anos|terço de uma bateria/);
    expect(t).toContain('Entrega dos equipamentos');
  });

  it('o que o integrador lista aparece, inclusive Frete (só a casa esconde frete)', () => {
    const t = textoVisivel(proprio().html);
    for (const i of itensProprios) expect(t).toContain(i.nome);
    expect(t).toContain('Frete até a propriedade');
  });

  it('garantia: só a do item que veio preenchida; nenhum número padrão, nem os campos da casa', () => {
    const { html } = proprio();
    const t = textoVisivel(html);
    expect(t).toContain('7 anos de garantia');
    expect((t.match(/de garantia/g) || []).length).toBe(1);
    expect(html).toContain('Garantias inclusas');
    expect(html).toMatch(/<div class="k">Inversor<\/div><div class="v">7 anos<\/div>/);
    // bateria_garantia: 5, garantia_estrutura: 10 e garantia_paineis: 25 da casa não entram; instalação sem número padrão
    expect(html).not.toMatch(/<div class="k">(Baterias|Estrutura|Placas|Instalação)<\/div>/);
    expect(t).not.toMatch(/\b(5|10|25) anos de garantia/);
    // Sem nenhuma garantia preenchida: o bloco inteiro some
    const sem = proprio({ itens_cliente: itensProprios.map(({ nome, qtd }) => ({ nome, qtd })) }).html;
    expect(sem).not.toContain('Garantias inclusas');
    expect(sem).not.toContain('class="ogGar"');
  });

  it('garantia da instalação só quando o integrador preenche', () => {
    const { html } = proprio({ garantia_instalacao: 2 });
    expect(html).toMatch(/<div class="k">Instalação<\/div><div class="v">2 anos<\/div>/);
  });

  it('a casa continua como era: kit, garantias padrão e a linha de projeto', () => {
    const { html } = gerar({});
    const t = textoVisivel(html);
    expect(t).toContain('Entrega do kit');
    expect(t).toContain('Projeto, instalação e comissionamento');
    expect(t).toContain('Inversor híbrido');
    expect(html).toMatch(/<div class="k">Instalação<\/div><div class="v">1 ano<\/div>/);
    // modo desconhecido vira casa
    expect(gerar({ modo_equipamento: 'qualquer' }).html).toBe(gerar({ modo_equipamento: 'casa' }).html);
  });

  it('sem número de inversor ou de banco, o tile some em vez de mostrar zero', () => {
    const { html } = proprio({ inversor_kw: 0, banco_kwh: 0, qtd_baterias: 0 });
    expect(html).not.toContain('<div class="tile"><div class="k">Inversor</div>');
    expect(html).not.toContain('<div class="tile"><div class="k">Banco de baterias</div>');
    expect(html).toContain('<div class="tile"><div class="k">Placas solares</div>');
  });
});

describe('off-grid modelo 2: todos os itens aceitos aparecem', () => {
  const contaLinhas = (h: string) => (h.match(/<div class="r"><span class="lab">Equipamento exclusivo/g) || []).length;
  it('20 itens, na casa e no próprio, todos visíveis e em uma única faixa de composição', () => {
    for (const modo of ['casa', 'proprio']) {
      const itens = nomesItens(20);
      const { html } = gerar({ modo_equipamento: modo, itens_cliente: itens });
      expect(contaLinhas(html)).toBe(20);
      for (const i of itens) expect(html).toContain(i.nome);
      expect(secoes(html).filter((s) => s === 'Composição do sistema').length).toBe(1);
    }
  });

  it('nomes longos: a lista inteira sai (folha própria quando não cabe na primeira)', () => {
    const longos = Array.from({ length: 20 }, (_, i) => ({ nome: `${i + 1} ${'Controlador de carga MPPT de alta corrente com display e comunicação remota '.repeat(2)}`.slice(0, 120), qtd: 1, garantia: 5 }));
    const { html } = gerar({ modo_equipamento: 'proprio', itens_cliente: longos });
    expect((html.match(/<span class="inc qt">/g) || []).length).toBe(20);
    expect(secoes(html)[2]).toBe('Composição do sistema');
  });

  it('passou de 20, só os 20 primeiros; item inválido não gasta vaga', () => {
    const itens = [{ nome: 'Lixo sem quantidade', qtd: 0 }, { nome: 'Lixo negativo', qtd: -3 }, ...nomesItens(22)];
    const { html } = gerar({ itens_cliente: itens });
    expect(contaLinhas(html)).toBe(20);
    expect(html).not.toContain('Lixo sem quantidade');
    expect(html).not.toContain('Lixo negativo');
    expect(html).not.toContain('Equipamento exclusivo número 21 ');
  });

  it('quantidade absurda, NaN e negativa são descartadas; garantia absurda perde só a garantia', () => {
    const { html } = gerar({ itens_cliente: [
      { nome: 'Item ok', qtd: 3, garantia: 5 },
      { nome: 'Item 10 mil', qtd: 10000 },
      { nome: 'Item NaN', qtd: 'abc' },
      { nome: 'Item Infinito', qtd: 'Infinity' },
      { nome: 'Item garantia absurda', qtd: 1, garantia: 500 },
    ] });
    expect(html).toContain('Item ok');
    expect(html).toContain('Item garantia absurda');
    expect(html).not.toContain('Item 10 mil');
    expect(html).not.toContain('Item NaN');
    expect(html).not.toContain('Item Infinito');
    expect(html).not.toContain('500 anos');
  });

  it('nome de item com HTML sai escapado', () => {
    const { html } = proprio({ itens_cliente: [{ nome: '<script>alert(1)</script> Inversor', qtd: 1 }] });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('off-grid modelo 2: formas de pagamento da folha 3', () => {
  const pagTudo = {
    investimento: 78900, preco_avista: 70000, pag_vista: true,
    pag_cartao: true, pag_cartao_1: true, pag_cartao_6: true, pag_cartao_12: true,
    pag_fin: true, pag_fin_36: true, pag_fin_60: true, pag_fin_84: true,
    pag_entrada: true, entrada_valor: 20000, entrada_modo: 'montagem',
  };
  const celula = (k: number, v: number) => `<span class="n">${k}× de</span><span class="v num">${pBRL(v)}</span>`;

  it('as parcelas são exatamente as dos helpers da proposta solar', () => {
    const f = { ...pagTudo, taxa_cartao_6: '8,5', taxa_fin_60: '1,9' };
    const { html } = gerar(f);
    for (const k of [1, 6, 12]) expect(html).toContain(celula(k, valorParcelaCartao(f, 78900, k)));
    for (const k of [36, 60, 84]) expect(html).toContain(celula(k, valorParcelaFin(f, 78900, k)));
    expect(taxaCartao(f, 6)).toBe(8.5);
    // só o que foi marcado
    expect(html).not.toContain(celula(2, valorParcelaCartao(f, 78900, 2)));
    expect(html).not.toContain(celula(48, valorParcelaFin(f, 78900, 48)));
    // destaque ao lado do preço: o financiamento mais longo
    expect(html).toContain(`Ou 84× de ${pBRL(valorParcelaFin(f, 78900, 84))}`);
  });

  it('o valor da parcela acompanha o investimento e o resumo antigo não entra junto', () => {
    const f = { ...pagTudo, investimento: 50000, parcela_cartao: '12x de R$ 7.142 no cartão', parcela_financiamento: 'ou 60x de R$ 2.020 no financiamento' };
    const { html } = gerar(f);
    expect(html).toContain(celula(12, valorParcelaCartao(f, 50000, 12)));
    expect(html).not.toContain('7.142');
    expect(html).not.toContain('2.020');
  });

  it('sem nenhum campo de pagamento, mantém o texto pronto de sempre (cartão e financiamento)', () => {
    const { html } = gerar({});
    const t = textoVisivel(html);
    expect(t).toContain('12x de R$ 7.142 no cartão');
    expect(t).toContain('60x de R$ 2.020 no financiamento');
    expect(html).not.toContain('class="pgrid"');
    expect(html).toContain('Sujeito à aprovação do banco');
  });

  it('à vista só aparece quando é menor que o investimento', () => {
    expect(gerar({ ...pagTudo, preco_avista: 70000 }).html).toContain('Desconto à vista');
    expect(textoVisivel(gerar({ ...pagTudo, preco_avista: 70000 }).html)).toContain('Economia de R$ 8.900');
    for (const v of [78900, 80000, 0, -10, 'abc', 1e12]) expect(gerar({ ...pagTudo, preco_avista: v }).html).not.toContain('Desconto à vista');
    expect(gerar({ ...pagTudo, pag_vista: false }).html).not.toContain('Desconto à vista');
    expect(textoVisivel(gerar({ ...pagTudo, preco_avista: '70.000,50' }).html)).toContain('R$ 70.000,50');
  });

  it('entrada: valor, restante e quando; some se for zero, negativa ou maior que o preço', () => {
    const t = textoVisivel(gerar(pagTudo).html);
    expect(t).toContain('Entrada + saldo');
    expect(t).toContain('Entrada de R$ 20.000');
    expect(t).toContain('Restante de R$ 58.900 na montagem do sistema');
    expect(textoVisivel(gerar({ ...pagTudo, entrada_modo: 'dias', entrada_dias: 15 }).html)).toContain('em 15 dias');
    for (const v of [0, -5, 90000, 2e7]) expect(gerar({ ...pagTudo, entrada_valor: v }).html).not.toContain('Entrada + saldo');
    expect(gerar({ ...pagTudo, pag_entrada: false }).html).not.toContain('Entrada + saldo');
  });

  it('cartão e financiamento desligados no topo escondem as parcelas marcadas', () => {
    const { html } = gerar({ ...pagTudo, pag_cartao: false, pag_fin: false });
    expect(html).not.toContain('class="pgrid"');
    expect(html).not.toContain('Cartão de crédito');
  });

  it('texto livre sai escapado, com limite, e <script> nunca vira tag', () => {
    const { html } = gerar({ ...pagTudo, pag_custom: '<script>alert("x")</script> 30% na safra' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; 30% na safra');
    expect(html).toContain('Condição especial');
    const longo = gerar({ ...pagTudo, pag_custom: 'palavra '.repeat(200) }).html;
    expect(textoVisivel(longo)).toMatch(/palavra…/);
    expect((textoVisivel(longo).match(/palavra/g) || []).length).toBeLessThan(80);
  });

  it('número absurdo ou negativo nunca vira parcela, e o preço absurdo some', () => {
    for (const inv of [-1000, 0, 'abc', 5e10, NaN]) {
      const { html } = gerar({ ...pagTudo, investimento: inv, preco_avista: undefined });
      expect(html).not.toContain('class="pgrid"');
      expect(html).not.toContain('Preço do sistema instalado');
    }
    // taxa fora de (0, 100] cai na taxa padrão, igual ao helper sem taxa
    const { html } = gerar({ ...pagTudo, taxa_cartao_12: '999', taxa_fin_60: '-3' });
    expect(html).toContain(celula(12, valorParcelaCartao({}, 78900, 12)));
    expect(html).toContain(celula(60, valorParcelaFin({}, 78900, 60)));
  });

  it('preço em texto brasileiro vale como número', () => {
    const { html } = gerar({ ...pagTudo, investimento: '78.900,00' });
    expect(html).toContain(celula(12, valorParcelaCartao(pagTudo, 78900, 12)));
  });

  it('as parcelas do documento são só as da folha 3 (o comparativo não traz parcela)', () => {
    const { html } = gerar(pagTudo);
    expect(html).toContain('class="ogCmp"');
    const pares = textoVisivel(html).match(/\d+× de R\$ [\d.]+/g) || [];
    // destaque nas folhas 1 e 3 (é o financiamento mais longo, o mesmo da grade) + 3 de cartão + 3 de financiamento:
    // 8 aparições, 6 parcelas distintas, nenhuma de outra origem
    expect(pares.length).toBe(2 + 3 + 3);
    expect(new Set(pares).size).toBe(3 + 3);
  });
});

describe('off-grid modelo 2: folha 3 que estoura leva bancos e dados para uma folha a mais', () => {
  const pagMuito = {
    modo_equipamento: 'proprio', itens_cliente: itensProprios, investimento: 78900, preco_avista: 70000, pag_vista: true,
    pag_cartao: true, pag_cartao_1: true, pag_cartao_6: true, pag_cartao_12: true,
    pag_fin: true, pag_fin_36: true, pag_fin_48: true, pag_fin_60: true, pag_fin_72: true, pag_fin_84: true,
    pag_entrada: true, entrada_valor: 20000, pag_custom: 'Condição especial para pagamento na safra, em duas parcelas na colheita. '.repeat(8),
    mostrar_dados_bancarios: true, prazo_entrega: '20 dias úteis',
  };
  it('com tudo ligado, a folha de bancos e dados vem logo depois da de investimento', () => {
    const { html } = gerar(pagMuito, { ...empresaOffGrid, dados_bancarios: dadosBancarios });
    const s = secoes(html);
    const i = s.indexOf('Investimento e formas de pagamento');
    expect(s[i + 1]).toBe('Bancos e dados para pagamento');
    expect((html.match(/<div class="bgrid">/g) || []).length).toBe(1);
    expect((html.match(/<div class="bk fx">/g) || []).length).toBe(12);
    expect(html).toContain('chave-pix-exemplo@solforte.example');
  });
  it('com pouco conteúdo, tudo fica numa folha só', () => {
    const { html } = gerar({ ...pagMuito, pag_custom: '', pag_fin_48: false, pag_fin_72: false, pag_cartao_6: false, mostrar_dados_bancarios: false });
    expect(secoes(html)).not.toContain('Bancos e dados para pagamento');
    expect((html.match(/<div class="bk fx">/g) || []).length).toBe(12);
  });
  it('o texto novo respeita as regras de escrita (sem travessão, sem emoji)', () => {
    const t = textoVisivel(gerar(pagMuito, { ...empresaOffGrid, dados_bancarios: dadosBancarios }).html);
    expect(t).not.toMatch(/[—–]/);
    expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

// Medida de verdade no navegador: só roda onde há o Edge local (no CI fica pulado).
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
describe.skipIf(!fs.existsSync(EDGE))('off-grid modelo 2: nenhuma folha passa de 1122px (Edge local)', () => {
  it('scrollHeight de cada .page até 1122, nas variações que mudam a folha', async () => {
    const puppeteer = await import('puppeteer-core');
    const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
    try {
      const emp = { ...empresaOffGrid, dados_bancarios: dadosBancarios };
      const itensMuitos = [...(dadosOffGrid.itens_cliente as unknown[]), ...Array.from({ length: 7 }, (_, i) => ({ nome: `Item extra de instalação número ${i + 1}`, qtd: i + 1 }))];
      const aparelhos = Array.from({ length: 20 }, (_, i) => ({ nome: `Aparelho número ${i + 1} da lista`, qtd: 1, w: 100, horas: 2, essencial: i % 2 === 0 }));
      const longos = Array.from({ length: 20 }, (_, i) => ({ nome: `${i + 1} Controlador de carga MPPT de alta corrente com display e comunicação para monitoramento remoto da produção diária`.slice(0, 120), qtd: i + 1, ...(i % 2 ? { garantia: 5 } : {}) }));
      // Pior caso: modo próprio, 20 itens longos, as 5 formas de pagamento, 12 bancos, dados bancários, fotos e aceite.
      const pior = {
        modo_equipamento: 'proprio', itens_cliente: longos, investimento: 78900, preco_avista: 70000, pag_vista: true,
        pag_cartao: true, pag_cartao_1: true, pag_cartao_6: true, pag_cartao_12: true,
        pag_fin: true, pag_fin_36: true, pag_fin_48: true, pag_fin_60: true, pag_fin_72: true, pag_fin_84: true,
        pag_entrada: true, entrada_valor: 20000, entrada_modo: 'contrato',
        pag_custom: 'Condição especial para pagamento em safra: 30% de entrada, e o restante em duas parcelas na colheita de soja e de milho, com correção pela poupança. '.repeat(4),
        mostrar_dados_bancarios: true, prazo_entrega: '20 dias úteis', assinatura: assinaturaValida, fotos_obras: fotos(12), aparelhos,
      };
      const casos: Array<Record<string, unknown>> = [
        pior,
        { ...pior, assinatura: undefined, fotos_obras: undefined },
        { ...pior, itens_cliente: longos.slice(0, 10), pag_custom: '', pag_fin_48: false, pag_fin_72: false },
        { assinatura: assinaturaValida, fotos_obras: fotos(6), mostrar_dados_bancarios: true },
        { assinatura: assinaturaValida, fotos_obras: fotos(12), mostrar_dados_bancarios: true, aparelhos, itens_cliente: itensMuitos },
        { fotos_obras: fotos(9) },
        { comp_opcoes: undefined },
        { comp_opcoes: undefined, assinatura: assinaturaValida },
        {},
      ];
      for (const c of casos) {
        const html = gerar(c, emp).html;
        const page = await browser.newPage();
        await page.setViewport({ width: 794, height: 1200 });
        await page.setRequestInterception(true);
        page.on('request', (rq) => { (rq.url().startsWith('data:') || rq.url().startsWith('about:') ? rq.continue() : rq.abort()).catch(() => undefined); });
        await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
        const alturas: number[] = await page.$$eval('.page', (els) => els.map((e) => e.scrollHeight));
        expect(alturas.length).toBeGreaterThanOrEqual(4);
        expect(Math.max(...alturas)).toBeLessThanOrEqual(1122);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }, 120000);
});
