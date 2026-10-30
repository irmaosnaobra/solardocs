import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import {
  htmlVistoria, opcoesPdf, type EntradaVistoria, type FotoAssinada, type ItemAssinado, type ModoRelatorio,
} from '../services/vistoria/htmlRelatorio';
import { hashConteudoPdf, VERSAO_PDF, type ConteudoPdf } from '../services/vistoria/cachePdf';
import { ITENS_COM_STATUS } from '../services/vistoria/avaliacao';
import { comprasVazio, sanitizarCompras, type Compras, type LinhaCompra } from '../services/vistoria/compras';
import { fraseNaLista, paragrafoNaLista } from '../services/vistoria/htmlCompras';
import { paleta, type MarcaEmpresa } from '../services/relatorio/marca';

// Relatório da vistoria (HTML da tela e do PDF, rodapé do PDF e hash do PDF) chamado direto, sem banco e sem rota.
// Dados inventados. Aqui ficam marca, cadastro do cliente, cobertura do selo, fotos inteiras com legenda numerada,
// documentos do titular, rodapé com página e a lista de compras ("Materiais e providências", "Na lista:" e o hash).

const ID = '11111111-1111-4111-8111-111111111111';
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const TRAVESSAO = /[\u{2013}\u{2014}]/u;
const TS = '2026-10-27T15:12:00.000Z'; // 12:12 em Brasília
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const MARCA: MarcaEmpresa = { nome: 'Solar Teste Energia', cnpj: '12.345.678/0001-90', logo: LOGO, cor: '#0E6B5C' };
const CLIENTE = { endereco: 'Rua das Flores, 100', cep: '30000-000', cidade: 'Belo Horizonte', uf: 'MG', concessionaria: 'Distribuidora Regional' };

const CHECKLIST: [string, string][] = [
  ['conta_luz', 'Conta de luz'],
  ['documento_pessoal', 'CNH / Identidade'],
  ['padrao', 'Padrão de entrada'],
  ['medidor', 'Medidor / Relógio'],
  ['disjuntor_padrao', 'Disjuntor do padrão'],
  ['quadro_distribuicao', 'Quadro de distribuição'],
  ['inversores', 'Local dos inversores / Disjuntor C.A'],
  ['telhado', 'Telhado'],
  ['tipo_telha', 'Tipo de telha'],
  ['estrutura', 'Estrutura apropriada'],
  ['cabeamento', 'Caminho do cabeamento'],
  ['sombreamento', 'Sombreamento'],
];

// ── Fixtures ────────────────────────────────────────────────────────────────

let contador = 0;
function foto(opc: { ts?: string; semUrl?: boolean } = {}): FotoAssinada {
  contador += 1;
  const url = `vistorias/u/${ID}/foto-${contador}.jpg`;
  return { url, tipo: 'image', ts: opc.ts ?? TS, signed: opc.semUrl ? null : `https://storage.test/${url}?token=abc` };
}
function anexo(nome = 'laudo.pdf'): FotoAssinada {
  contador += 1;
  const url = `vistorias/u/${ID}/anexo-${contador}.pdf`;
  return { url, tipo: 'file', nome, ts: TS, signed: `https://storage.test/${url}?token=abc` };
}
const DOCUMENTO: FotoAssinada = {
  url: `vistorias/u/${ID}/documento_pessoal-1.jpg`, tipo: 'image', ts: TS,
  signed: `https://storage.test/vistorias/u/${ID}/documento_pessoal-1.jpg?token=secreto`,
};
function itens(fotos: Record<string, FotoAssinada[]> = {}, obs: Record<string, string> = {}): ItemAssinado[] {
  return CHECKLIST.map(([key, label]) => ({ key, label, obs: obs[key] ?? '', fotos: fotos[key] ?? [] }));
}
function entrada(extra: Partial<EntradaVistoria> = {}): EntradaVistoria {
  return { id: ID, cliente_nome: 'Maria Souza', status: 'concluida', created_at: '2026-10-20T12:00:00.000Z', itens: itens(), status_itens: {}, ...extra };
}
const conformes = (n: number) => Object.fromEntries(ITENS_COM_STATUS.slice(0, n).map((k) => [k, 'conforme']));
const html = (e: EntradaVistoria, modo: ModoRelatorio = 'tela') => htmlVistoria(e, modo);
/** Os números das legendas "Foto N", na ordem em que aparecem no HTML. */
const legendas = (h: string) => [...h.matchAll(/<figcaption><b>Foto (\d+)<\/b>/g)].map((m) => Number(m[1]));

// O link "Versão online" lê DASHBOARD_URL: nos testes vale o endereço padrão, sem depender do ambiente da máquina.
let dashboardUrl: string | undefined;
beforeAll(() => { dashboardUrl = process.env.DASHBOARD_URL; delete process.env.DASHBOARD_URL; });
afterAll(() => { if (dashboardUrl === undefined) delete process.env.DASHBOARD_URL; else process.env.DASHBOARD_URL = dashboardUrl; });

const ASSINATURAS = {
  tecnico: { url: 'https://storage.test/assinatura-tecnico.png?token=abc', nome: 'Bruno Lima', registro: 'CFT 123', ts: '2026-10-27T17:32:00.000Z' },
  cliente: { url: 'https://storage.test/assinatura-cliente.png?token=abc', nome: 'Maria Souza', ts: '2026-10-27T17:40:00.000Z' },
};

/** V1: concluída, 4 conformes, 3 com atenção, 2 não conformes e 1 N/A, com marca, cadastro, local, documentos e assinaturas. */
function cheia(): EntradaVistoria {
  return entrada({
    marca: MARCA,
    cliente: CLIENTE,
    localizacao: { lat: -19.9167, lng: -43.9345, link: null, texto: 'Casa de esquina' },
    itens: itens({
      conta_luz: [foto()],
      documento_pessoal: [DOCUMENTO],
      padrao: [foto(), foto(), anexo()],
      medidor: [foto()],
      telhado: [foto(), foto()],
      sombreamento: [foto()],
    }, { padrao: 'Caixa enferrujada e porta sem trinco.', conta_luz: 'Consumo médio de 420 kWh.', documento_pessoal: 'Titular conferido.' }),
    status_itens: {
      padrao: 'nao_conforme', medidor: 'conforme', disjuntor_padrao: 'conforme', quadro_distribuicao: 'conforme', inversores: 'conforme',
      telhado: 'atencao', tipo_telha: 'atencao', estrutura: 'atencao', cabeamento: 'na', sombreamento: 'nao_conforme',
    },
    assinaturas: ASSINATURAS,
  });
}
/** V2: em andamento, uma foto, sem status, sem assinatura, sem marca. */
const minima = () => entrada({ status: 'em_andamento', itens: itens({ padrao: [foto()] }) });
/** V4: em andamento, 6 de 10 itens avaliados, um deles não conforme. */
const andamento = () => entrada({
  status: 'em_andamento',
  itens: itens({ padrao: [foto()] }),
  status_itens: { padrao: 'nao_conforme', medidor: 'conforme', disjuntor_padrao: 'conforme', quadro_distribuicao: 'conforme', inversores: 'conforme', telhado: 'conforme' },
});
/** V5: concluída, 4 conformes e 6 sem status. */
const parcial = () => entrada({ itens: itens({ padrao: [foto()] }), status_itens: conformes(4) });
/** V8: texto hostil digitado por gente, com emoji e travessão. */
const SUJO = `<script>alert(1)</script> "aspas" 'simples' & fim \u{2014} \u{2013} \u{1F600} \u{2600}`;
const hostil = () => entrada({
  cliente_nome: SUJO,
  marca: { nome: SUJO, cnpj: SUJO, logo: LOGO, cor: null },
  cliente: { endereco: SUJO, cep: '', cidade: '', uf: '', concessionaria: SUJO },
  localizacao: { lat: null, lng: null, link: null, texto: SUJO },
  itens: itens({ padrao: [foto(), anexo(SUJO)], conta_luz: [foto()] }, { padrao: SUJO, conta_luz: SUJO, telhado: SUJO }),
  status_itens: { padrao: 'nao_conforme', telhado: 'atencao' },
  assinaturas: { tecnico: { url: null, nome: SUJO, registro: SUJO, ts: TS }, cliente: { url: null, nome: SUJO, ts: TS } },
});

// ── Cabeçalho, marca e identificação (R02, R06, R07) ────────────────────────

describe('cabeçalho e marca', () => {
  it('com marca: logo, nome, CNPJ e código do documento', () => {
    const h = html(entrada({ marca: MARCA }));
    expect(h).toContain(`<img src="${LOGO}" alt="Solar Teste Energia"/>`);
    expect(h).toContain('<b>Solar Teste Energia</b>');
    expect(h).toContain('<span>CNPJ 12.345.678/0001-90</span>');
    expect(h).toContain('<div class="ref"><b>VT-11111111</b>');
    expect(h).toContain('<p class="eyebrow">Vistoria de Energia Solar</p>');
    expect(h).toContain(`--c1:${paleta('#0E6B5C').c1}`);
  });
  it('sem marca: só o título do documento e o código, na paleta padrão', () => {
    const h = html(entrada());
    expect(h).toContain('<div class="marca"><div class="emp"><b>Vistoria de Energia Solar</b></div></div>');
    expect(h).toContain('<b>VT-11111111</b>');
    expect(h).not.toContain('<img src="data:');
    expect(h).not.toContain('CNPJ');
    expect(h).toContain(`--c1:${paleta(null).c1}`);
  });
  it('o contato da empresa não sai (WhatsApp, endereço e cidade ficam atrás de uma constante desligada)', () => {
    const h = html(entrada({ marca: { ...MARCA, contato: { whatsapp: '31999990000', endereco: 'Rua Dos Fundos, 10', cidade: 'Contagem' } } }));
    expect(h).not.toContain('WhatsApp');
    expect(h).not.toContain('99999-0000');
    expect(h).not.toContain('Rua Dos Fundos');
    expect(h).not.toContain('Contagem');
  });
  it('responsável técnico vem da assinatura do técnico; sem assinatura, sem a linha', () => {
    expect(html(entrada({ assinaturas: ASSINATURAS }))).toContain('<span>Responsável técnico: Bruno Lima, <span class="nw">CFT 123</span></span>');
    expect(html(entrada({ assinaturas: { cliente: ASSINATURAS.cliente } }))).not.toContain('Responsável técnico');
    expect(html(entrada())).not.toContain('Responsável técnico');
    expect(html(entrada({ assinaturas: { tecnico: { url: null, nome: 'Bruno Lima', ts: TS } } }))).toContain('Responsável técnico: Bruno Lima</span>');
  });
  it('o registro do responsável não quebra no meio do número: vai num pedaço nowrap, escapado, e registro enorme volta a quebrar', () => {
    const com = (registro: string) => html(entrada({ assinaturas: { tecnico: { url: null, nome: 'Bruno Lima', registro, ts: TS } } }));
    expect(com('CFT 123456789-0')).toContain('<span>Responsável técnico: Bruno Lima, <span class="nw">CFT 123456789-0</span></span>');
    // o texto do técnico continua escapado dentro do pedaço
    expect(com('CFT <b>1</b>')).toContain('<span class="nw">CFT &lt;b&gt;1&lt;/b&gt;</span>');
    // acima de 28 caracteres o pedaço sairia da coluna: o registro segue como texto comum
    const longo = 'CFT 123456789-0 CRT 987654321-0 e mais um registro longo';
    expect(com(longo)).toContain(`Responsável técnico: Bruno Lima, ${longo}</span>`);
    expect(com(longo)).not.toContain('class="nw"');
    // o span interno não herda o `display:block` de `.ref span` (senão o número iria sempre para a linha de baixo)
    const h = com('CFT 1');
    expect(h).toContain('.ref span.nw{display:inline;white-space:nowrap;overflow-wrap:normal}');
    expect(h.indexOf('.ref span.nw{')).toBeGreaterThan(h.indexOf('.ref span{display:block'));
  });
  it('tema claro único: nada do tema escuro antigo nem de prefers-color-scheme', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html(cheia(), modo);
      expect(h).not.toContain('#0F172A');
      expect(h).not.toMatch(/prefers-color-scheme/);
    }
  });
});

describe('identificação do cliente e do local', () => {
  it('mostra o endereço do cadastro e a concessionária', () => {
    const h = html(entrada({ cliente: CLIENTE }));
    expect(h).toContain('<h2 class="sec">Identificação</h2>');
    expect(h).toContain('<dt>Endereço do cadastro</dt><dd>Rua das Flores, 100, Belo Horizonte/MG, CEP 30000-000</dd>');
    expect(h).toContain('<dt>Concessionária</dt><dd>Distribuidora Regional</dd>');
  });
  it('só as partes que existem entram no endereço', () => {
    const h = html(entrada({ cliente: { endereco: 'Rua A, 1', cep: '', cidade: 'Contagem', uf: '', concessionaria: '' } }));
    expect(h).toContain('<dd>Rua A, 1, Contagem</dd>');
    expect(h).not.toContain('CEP');
    expect(h).not.toContain('Concessionária');
  });
  it('sem cadastro e sem local marcado não há a seção', () => {
    expect(html(entrada())).not.toContain('Identificação');
    expect(html(entrada({ cliente: null, localizacao: null }))).not.toContain('Local marcado');
  });
  it('local marcado: texto e coordenadas; a tela tem o link do mapa e o PDF traz o endereço do mapa em texto', () => {
    const e = entrada({ localizacao: { lat: -19.9167, lng: -43.9345, link: null, texto: 'Casa de esquina' } });
    const tela = html(e, 'tela');
    expect(tela).toContain('<dt>Local marcado</dt><dd>Casa de esquina (-19.91670, -43.93450)');
    expect(tela).toContain('<a href="https://maps.google.com/?q=-19.9167,-43.9345" target="_blank" rel="noopener noreferrer">Abrir no mapa</a>');
    const pdf = html(e, 'pdf');
    expect(pdf).toContain('<span class="url">https://maps.google.com/?q=-19.9167,-43.9345</span>');
    expect(pdf).not.toContain('<a href="https://maps.google.com');
  });
  it('link do mapa só aceita http(s)', () => {
    const h = html(entrada({ localizacao: { lat: null, lng: null, link: 'javascript:alert(1)', texto: 'Perto da praça' } }));
    expect(h).toContain('Perto da praça');
    expect(h).not.toContain('javascript:');
  });
});

// ── Data, situação e navegação ──────────────────────────────────────────────

describe('data, situação e navegação', () => {
  it('a data é a do menor ts entre as fotos (imagem) dos itens técnicos', () => {
    const h = html(entrada({
      itens: itens({
        padrao: [foto({ ts: '2026-10-27T15:12:00.000Z' }), foto({ ts: '2026-10-26T13:00:00.000Z' })],
        conta_luz: [foto({ ts: '2026-10-01T12:00:00.000Z' })], // documento: não conta
        medidor: [{ ...anexo(), ts: '2026-09-01T12:00:00.000Z' }], // arquivo: não conta
      }),
    }));
    expect(h).toContain('<span>Data: 26/10/2026</span>');
  });
  it('sem foto com data válida, vale a criação da vistoria', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto({ ts: 't' })] }) }));
    expect(h).toContain('<span>Data: 20/10/2026</span>');
  });
  it('uma data sem hora não vira o dia anterior', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto({ ts: '2026-10-27' })] }) }));
    expect(h).toContain('<span>Data: 20/10/2026</span>');
  });
  it('conta as fotos por item e mostra a situação', () => {
    const concluida = html(entrada({ itens: itens({ padrao: [foto()], telhado: [foto()] }) }));
    expect(concluida).toContain('<span>Fotos em 2 de 12 itens</span><span>Concluída</span>');
    expect(concluida).not.toContain('role="status"');
    const andando = html(minima());
    expect(andando).toContain('<span>Fotos em 1 de 12 itens</span><span>Em andamento</span>');
  });
  it('em andamento: banner explicando que o resultado completo vem na conclusão', () => {
    const h = html(andamento());
    expect(h).toContain('<div class="andamento" role="status">Vistoria em andamento. O resultado completo aparece quando o técnico concluir.</div>');
    expect(h).toContain('Resultado da vistoria');
  });
  it('tela: ações e navegação só com as seções que existem; PDF: nada disto', () => {
    const tela = html(cheia(), 'tela');
    expect(tela).toContain('Baixar fotos e arquivos (8)'); // 7 imagens e 1 anexo; o documento pessoal não entra
    expect(tela).toContain(`href="/v/${ID}/fotos.zip"`);
    expect(tela).toContain('<span>Ir para:</span><a href="#pendencias">Pendências</a><a href="#registro">Fotos</a><a href="#assinaturas">Assinaturas</a>');
    const so = html(entrada({ itens: itens({ padrao: [foto()] }) }), 'tela');
    expect(so).toContain('<span>Ir para:</span><a href="#registro">Fotos</a>');
    expect(so).not.toContain('href="#pendencias"');
    expect(so).not.toContain('href="#assinaturas"');
    expect(html(entrada(), 'tela')).not.toContain('Ir para:');
    const pdf = html(cheia(), 'pdf');
    expect(pdf).not.toContain('Baixar fotos e arquivos');
    expect(pdf).not.toContain('Ir para:');
    expect(pdf).not.toContain('Baixar PDF');
    expect(pdf).not.toContain('fotos.zip');
  });
  it('a tela traz a barra com o link do PDF e o rodapé da SolarDoc; o PDF traz a versão online', () => {
    const tela = html(cheia(), 'tela');
    expect(tela).toContain(`<a href="/v/${ID}/pdf">Baixar PDF</a>`);
    expect(tela).toContain('<footer class="rod">Relatório gerado pela SolarDoc • 27/10/2026</footer>');
    expect(tela).not.toContain('Versão online');
    const pdf = html(cheia(), 'pdf');
    expect(pdf).toContain(`<p class="online">Versão online deste relatório: <a href="https://solardoc.app/v/${ID}">https://solardoc.app/v/${ID}</a></p>`);
    expect(pdf).not.toContain('<footer class="rod">');
  });
  it('o link da versão online segue o DASHBOARD_URL do ambiente', () => {
    process.env.DASHBOARD_URL = ' https://app.exemplo.test// ';
    try {
      expect(html(cheia(), 'pdf')).toContain(`<a href="https://app.exemplo.test/v/${ID}">https://app.exemplo.test/v/${ID}</a>`);
    } finally {
      delete process.env.DASHBOARD_URL;
    }
  });
});

// ── Selo com cobertura, placar e faltam avaliar (R09) ───────────────────────

describe('selo, placar e cobertura', () => {
  it('4 conformes e 6 sem status: nunca "Apto para instalar"', () => {
    const h = html(parcial());
    expect(h).not.toContain('Apto para instalar');
    expect(h).toContain('<p class="tt">Itens avaliados em ordem</p>');
    expect(h).toContain('<p class="fr">Faltam itens a avaliar. O resultado completo depende deles.</p>');
    expect(h).toContain('class="selo sc-parcial"');
    expect(h).toContain('<p class="placar">4 de 10 itens avaliados: 4 conformes.</p>');
    expect(h).toContain('<p class="faltam">Faltam avaliar: Local dos inversores / Disjuntor C.A, Telhado, Tipo de telha, Estrutura apropriada, Caminho do cabeamento e Sombreamento.</p>');
  });
  it('os 10 conformes: "Apto para instalar", placar completo e nada em falta', () => {
    const h = html(entrada({ status_itens: conformes(10) }));
    expect(h).toContain('<p class="tt">Apto para instalar</p>');
    expect(h).toContain('<p class="placar">10 itens avaliados: 10 conformes.</p>');
    expect(h).not.toContain('Faltam avaliar');
    expect(h).not.toContain('class="selo sc-parcial"');
  });
  it('N/A conta como avaliado: 9 conformes e 1 N/A é "Apto para instalar"', () => {
    const h = html(entrada({ status_itens: { ...conformes(10), sombreamento: 'na' } }));
    expect(h).toContain('Apto para instalar');
    expect(h).toContain('<p class="placar">10 itens avaliados: 9 conformes e 1 não se aplica.</p>');
  });
  it('não conforme vale mesmo com 3 de 10 avaliados', () => {
    const h = html(entrada({ status_itens: { padrao: 'nao_conforme', medidor: 'conforme', telhado: 'atencao' } }));
    expect(h).toContain('<p class="tt">Adequar antes de instalar</p>');
    expect(h).toContain('<p class="placar">3 de 10 itens avaliados: 1 conforme, 1 com atenção e 1 não conforme.</p>');
    expect(h).toContain('Faltam avaliar:');
    expect(h).toContain('class="selo sc-nao_conforme"');
  });
  it('atenção vale com cobertura parcial e mantém o texto do selo', () => {
    const h = html(entrada({ status_itens: { padrao: 'atencao' } }));
    expect(h).toContain('<p class="tt">Instalável com ajustes</p>');
    expect(h).toContain('class="selo sc-atencao"');
  });
  it('sem nenhum status não há o bloco de resultado', () => {
    const h = html(entrada());
    expect(h).not.toContain('Resultado da vistoria');
    expect(h).not.toContain('Pendências e prioridades');
    expect(h).not.toContain('class="placar"');
    expect(h).not.toContain('Próximos passos');
  });
  it('a conclusão do redator segue intacta', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto()] }), status_itens: { padrao: 'nao_conforme' } }));
    expect(h).toContain('<p class="concl">O técnico registrou foto em 1 de 12 itens nesta vistoria. Foi encontrada não conformidade em padrão de entrada. Recomendamos adequar esse ponto antes da instalação.</p>');
  });
});

// ── Pendências com observação, fotos e passos seguintes (R10, R11) ──────────

describe('pendências', () => {
  const comPendencias = () => entrada({
    itens: itens({ padrao: [foto(), foto()], telhado: [foto(), foto()] }, { padrao: 'Caixa enferrujada.\nPorta sem trinco.', telhado: 'Telha trincada' }),
    status_itens: { padrao: 'nao_conforme', telhado: 'atencao', medidor: 'conforme' },
  });

  it('a observação do item aparece dentro do cartão da pendência', () => {
    const h = html(comPendencias());
    expect(h).toMatch(/<div class="pen alta"><div class="hd"><b>Padrão de entrada<\/b><span class="chip p-alta">Prioridade alta<\/span><\/div><p>Adequar antes de instalar\.<\/p><p class="pobs">Caixa enferrujada\.\nPorta sem trinco\.<\/p>/);
    expect(h).toMatch(/<div class="pen media">.*<p class="pobs">Telha trincada<\/p>/s);
  });
  it('as fotos do item entram no cartão com a numeração global; na tela o rótulo é link, no PDF é texto', () => {
    const tela = html(comPendencias(), 'tela');
    expect(tela).toContain('<p class="pref"><a href="#i-padrao">Fotos 1 e 2</a></p>');
    expect(tela).toContain('<p class="pref"><a href="#i-telhado">Fotos 3 e 4</a></p>');
    const pdf = html(comPendencias(), 'pdf');
    expect(pdf).toContain('<p class="pref">Fotos 3 e 4</p>');
    expect(pdf).not.toContain('href="#i-');
  });
  it('item com uma foto diz "Foto 1"', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto()] }), status_itens: { padrao: 'nao_conforme' } }));
    expect(h).toContain('<p class="pref"><a href="#i-padrao">Foto 1</a></p>');
  });
  it('sem foto e sem observação não há referência nem texto do técnico no cartão', () => {
    const h = html(entrada({ status_itens: { padrao: 'nao_conforme' } }));
    expect(h).toContain('<div class="pen alta">');
    expect(h).not.toContain('class="pref"');
    expect(h).not.toContain('class="pobs"');
  });
  it('a observação do cartão é limitada a 3 linhas por CSS e não corta o texto no HTML', () => {
    const longa = 'Observação longa. '.repeat(40).trim();
    const h = html(entrada({ itens: itens({}, { padrao: longa }), status_itens: { padrao: 'nao_conforme' } }));
    expect(h).toContain(`<p class="pobs">${longa}</p>`);
    expect(h).toMatch(/\.pen \.pobs\{[^}]*-webkit-line-clamp:3/);
  });
});

describe('próximos passos', () => {
  const passos = (h: string) => [...(/<ol class="passos">(.*?)<\/ol>/s.exec(h)?.[1] ?? '').matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);

  it('não conforme: três passos', () => {
    expect(passos(html(cheia()))).toEqual([
      'Resolver os itens de prioridade alta antes da instalação.',
      'Combinar com a empresa quem faz cada ajuste.',
      'Avisar a empresa quando terminar, para conferir e marcar a instalação.',
    ]);
  });
  it('atenção: dois passos', () => {
    expect(passos(html(entrada({ status_itens: { padrao: 'atencao' } })))).toEqual([
      'Resolver os itens de prioridade média antes ou durante a instalação.',
      'Combinar com a empresa quem faz cada ajuste.',
    ]);
  });
  it('conforme completo: nenhum ajuste; conforme parcial: concluir a avaliação', () => {
    expect(passos(html(entrada({ status_itens: conformes(10) })))).toEqual(['Nenhum ajuste é necessário. A instalação pode ser marcada.']);
    expect(passos(html(parcial()))).toEqual(['Concluir a avaliação dos itens que faltam antes de marcar a instalação.']);
  });
  it('vistoria em andamento não mostra "Próximos passos"; concluída sem status também não', () => {
    expect(html(andamento())).not.toContain('Próximos passos');
    expect(html(entrada())).not.toContain('Próximos passos');
  });
  it('a ordem no documento: versão online (no cabeçalho do PDF), resultado, pendências, conclusão, próximos passos, registro, documentos e assinaturas', () => {
    const h = html(cheia(), 'pdf');
    const ordem = ['Versão online', 'Resultado da vistoria', 'Pendências e prioridades', '>Conclusão<', 'Próximos passos', 'Registro por item', 'Documentos do titular', '>Assinaturas<'].map((t) => h.indexOf(t));
    expect(ordem.every((p) => p > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
  });
  it('a linha da versão online fica logo abaixo da data e das contagens, uma vez só, e nunca é o último bloco do PDF (não nasce folha só com o link)', () => {
    for (const e of [cheia(), andamento(), entrada(), parcial()]) {
      const pdf = html(e, 'pdf');
      expect(pdf.split('class="online"').length - 1).toBe(1);
      expect(pdf).toMatch(/<div class="meta">[^]*?<\/div>\s*<p class="online">Versão online deste relatório: <a href="/);
      // depois da linha vêm todas as seções; o fim do corpo (assinaturas, sem registro ou aviso) não traz o link
      expect(pdf.indexOf('</main>') - pdf.indexOf('class="online"')).toBeGreaterThan(300);
      expect(pdf.slice(pdf.indexOf('</div>', pdf.indexOf('class="online"')), pdf.indexOf('</main>'))).not.toContain('Versão online');
    }
    // a tela não tem a linha (tem o rodapé) e o filete que a separava do resto sumiu do CSS
    expect(html(cheia(), 'tela')).not.toContain('class="online"');
    expect(html(cheia(), 'pdf')).toContain('.online{margin:8px 0 0;font-size:12px;color:var(--mut);overflow-wrap:anywhere}');
    expect(html(cheia(), 'pdf')).not.toMatch(/\.online\{[^}]*border-top/);
  });
  it('"Próximos passos" não parte entre duas páginas', () => {
    expect(html(cheia(), 'pdf')).toMatch(/\.passos\{[^}]*break-inside:avoid;page-break-inside:avoid/);
  });
});

// ── Registro por item: fotos inteiras, legenda numerada, quebras (R08, R12) ──

describe('registro por item', () => {
  const fotosDoPadrao = () => entrada({
    itens: itens({ padrao: [foto(), foto(), anexo()], telhado: [foto()], medidor: [foto(), foto()] }, { padrao: 'Caixa antiga.' }),
    status_itens: { padrao: 'conforme', sombreamento: 'atencao' },
  });

  it('cada item traz título, chip, contagem, explicação, observação e fotos, tudo no mesmo bloco que não parte', () => {
    const h = html(fotosDoPadrao());
    expect(h).toContain('<section class="item" id="i-padrao"><div class="keep"><div class="itemHead"><strong>Padrão de entrada</strong> <span class="chip s-conforme">Conforme</span> <span class="cnt">2 fotos, 1 arquivo</span></div>');
    expect(h).toContain('<p class="expl">A caixa e o poste por onde a energia da rua chega à casa.</p><p class="obs">Caixa antiga.</p><div class="mid">');
    expect(h).toContain('<strong>Sombreamento</strong>');
    expect(h).toContain('class="chip s-conforme"');
    expect(h).toContain('<span class="chip s-atencao">Atenção</span>');
    expect(h).toContain('<h2 class="sec">Registro por item</h2>');
  });
  it('contagem no singular e no plural, imagens e arquivos separados', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto()], medidor: [anexo(), anexo('a.pdf'), anexo('b.pdf')], telhado: [foto(), foto(), anexo()] }) }));
    expect(h).toContain('<span class="cnt">1 foto</span>');
    expect(h).toContain('<span class="cnt">3 arquivos</span>');
    expect(h).toContain('<span class="cnt">2 fotos, 1 arquivo</span>');
  });
  it('legenda "Foto N · item · data e hora do envio em Brasília", numeração global na ordem do checklist', () => {
    const h = html(fotosDoPadrao());
    expect(legendas(h)).toEqual([1, 2, 3, 4, 5]);
    expect(h).toContain('<figcaption><b>Foto 1</b> · Padrão de entrada · 27/10/2026 12:12</figcaption>');
    expect(h).toContain('<figcaption><b>Foto 3</b> · Medidor / Relógio · 27/10/2026 12:12</figcaption>');
    expect(h).toContain('<figcaption><b>Foto 5</b> · Telhado · 27/10/2026 12:12</figcaption>');
  });
  it('legenda sem hora válida não tem o trecho da data', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto({ ts: 'sem data' })] }) }));
    expect(h).toContain('<figcaption><b>Foto 1</b> · Padrão de entrada</figcaption>');
  });
  it('foto sem URL assinada não aparece, mas continua contando: a numeração não escorrega', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto({ semUrl: true }), foto()], telhado: [foto()] }) }));
    expect(legendas(h)).toEqual([2, 3]);
    expect(h).toContain('<span class="cnt">2 fotos</span>');
  });
  it('tela: foto abre em outra aba e carrega sob demanda; o anexo é um link', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto(), anexo()] }) }), 'tela');
    expect(h).toMatch(/<figure class="ph"><a href="https:\/\/storage\.test\/[^"]+" target="_blank" rel="noopener"><img src="https:\/\/storage\.test\/[^"]+" alt="Padrão de entrada" loading="lazy"\/><\/a><figcaption>/);
    expect(h).toContain('<a class="file" href="https://storage.test/');
  });
  it('PDF: foto sem link e sem lazy-load; o anexo vira texto', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto(), anexo()] }) }), 'pdf');
    expect(h).toMatch(/<figure class="ph"><img src="https:\/\/storage\.test\/[^"]+" alt="Padrão de entrada"\/><figcaption>/);
    expect(h).not.toContain('<a href="https://storage.test');
    expect(h).not.toContain('<a class="file"');
    expect(h).not.toContain('loading="lazy"');
    expect(h).toContain('<div class="file">Arquivo anexado: laudo.pdf</div>');
  });
  it('até 3 mídias ficam no bloco do título; as demais vão para a fileira de baixo', () => {
    const tres = html(entrada({ itens: itens({ padrao: [foto(), foto(), foto()] }) }));
    expect(tres).not.toContain('<div class="mid resto">');
    const cinco = html(entrada({ itens: itens({ padrao: [foto(), foto(), foto(), foto(), foto()] }) }));
    expect(cinco.match(/<div class="mid resto">/g)).toHaveLength(1);
    const [antes, resto] = cinco.split('<div class="mid resto">') as [string, string];
    expect(legendas(antes)).toEqual([1, 2, 3]);
    expect(legendas(resto)).toEqual([4, 5]);
  });
  it('a foto é mostrada inteira: altura fixa, largura natural, contain', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto()] }) }));
    expect(h).toContain('.ph img{display:block;height:var(--hfoto);width:auto;max-width:100%;object-fit:contain;');
    expect(h).toMatch(/\.ph figcaption\{width:0;min-width:100%;/);
    expect(h).toMatch(/:root\{--hfoto:60mm;/); // PDF
    expect(h).not.toMatch(/aspect-ratio|object-fit:cover/);
  });
  it('regras de quebra de página: bloco do item, foto, cartões, selo, conclusão, assinaturas e títulos', () => {
    const h = html(cheia(), 'pdf');
    for (const seletor of ['.keep', '.ph', '.pen', '.selo', '.concl', '.assin', '.andamento', '.faltando']) {
      expect(h, seletor).toMatch(new RegExp(`${seletor.replace('.', '\\.')}[^{}]*\\{[^}]*break-inside:avoid`));
    }
    expect(h).toMatch(/h2\.sec\{[^}]*break-after:avoid/);
    expect(h).toMatch(/h3\{break-after:avoid/);
    expect(h).toMatch(/\.item \.itemHead:not\(:last-child\)[^{]*\{break-after:avoid/);
    expect(h).toContain('@page{size:A4;margin:14mm 16mm 18mm}');
  });
  it('item só com observação, sem foto e sem status, aparece no registro', () => {
    const h = html(entrada({ itens: itens({}, { cabeamento: 'Eletroduto aparente no beiral.' }) }));
    expect(h).toContain('<strong>Caminho do cabeamento</strong>');
    expect(h).toContain('<p class="obs">Eletroduto aparente no beiral.</p>');
    expect(h).toMatch(/Sem registro:<\/strong>[^<]*Medidor/);
    expect(h).not.toMatch(/Sem registro:<\/strong>[^<]*Caminho do cabeamento/);
  });
  it('item só com status, sem foto, aparece; "Sem registro" lista só o que não tem foto, status nem observação', () => {
    const h = html(entrada({ status_itens: { sombreamento: 'atencao' } }));
    expect(h).toContain('<strong>Sombreamento</strong>');
    expect(h).toMatch(/Sem registro:.*Medidor/);
    expect(h).not.toMatch(/Sem registro:<\/strong>[^<]*Sombreamento/);
  });
  it('vistoria mínima: 11 itens sem registro, em cinza neutro, sem o vermelho nem o laranja de alerta', () => {
    const h = html(minima());
    const bloco = /<div class="faltando"><strong>Sem registro:<\/strong> ([^<]*)<\/div>/.exec(h);
    expect(bloco).not.toBeNull();
    expect(bloco![1]!.split(' · ')).toHaveLength(11);
    const regra = /\.faltando\{([^}]*)\}/.exec(h)![1]!;
    expect(regra).toContain('--na-');
    expect(regra).not.toMatch(/--nc-|--at-|#[0-9a-f]{6}/i);
  });
  it('sem nenhum registro: aviso no lugar do registro, e todos os itens em "Sem registro"', () => {
    const h = html(entrada());
    expect(h).toContain('<div class="empty">Nenhum registro ainda.</div>');
    expect(h).not.toContain('Registro por item');
    expect(h.match(/Sem registro:<\/strong> ([^<]*)/)![1]!.split(' · ')).toHaveLength(12);
  });
  it('o primeiro item não tem linha fina logo abaixo do título da seção', () => {
    const h = html(fotosDoPadrao());
    expect(h).toContain('h2.sec+.item,.apoio+.item{margin-top:0;padding-top:0;border-top:0}');
  });
});

// ── Documentos do titular e o documento pessoal (R13, D11) ──────────────────

describe('documentos do titular', () => {
  const dentroDe = (h: string, de: string, ate: string) => {
    const i = h.indexOf(de);
    const f = h.indexOf(ate, i + de.length);
    return h.slice(i, f < 0 ? undefined : f);
  };

  it('a conta de luz vai depois do registro e antes das assinaturas, e aparece uma vez só', () => {
    const h = html(cheia());
    const registro = h.indexOf('Registro por item');
    const documentos = h.indexOf('id="documentos"');
    const assinaturas = h.indexOf('id="assinaturas"');
    expect(registro).toBeGreaterThan(0);
    expect(documentos).toBeGreaterThan(registro);
    expect(assinaturas).toBeGreaterThan(documentos);
    expect(h.match(/id="i-conta_luz"/g)).toHaveLength(1);
    expect(dentroDe(h, '<h2 class="sec">Registro por item</h2>', 'id="documentos"')).not.toContain('Conta de luz');
  });
  it('seção com frase de apoio, explicação, observação e legenda "Documento N" (numeração própria)', () => {
    const h = html(cheia());
    expect(h).toContain('<h2 class="sec">Documentos do titular</h2><p class="apoio">Documentos recebidos do titular da conta, para uso da engenharia.</p>');
    const docs = dentroDe(h, 'id="documentos"', 'id="assinaturas"');
    expect(docs).toContain('<strong>Conta de luz</strong>');
    expect(docs).toContain('<p class="expl">Mostra o consumo e o titular da conta.</p><p class="obs">Consumo médio de 420 kWh.</p>');
    expect(docs).toContain('<figcaption><b>Documento 1</b> · Conta de luz · 27/10/2026 12:12</figcaption>');
    expect(legendas(h)).toEqual([1, 2, 3, 4, 5, 6]); // as 6 fotos do registro; "Documento 1" não entra na conta
    expect(h).toContain('.docs{--hfoto:150px}');
    expect(h).toContain('.docs{--hfoto:42mm}');
  });
  it('o documento pessoal nunca tem imagem, link nem caminho de arquivo, na tela e no PDF', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html(cheia(), modo);
      expect(h, modo).not.toContain('documento_pessoal-1.jpg');
      expect(h, modo).not.toContain('token=secreto');
      const doc = dentroDe(h, 'id="i-documento_pessoal"', '</section>');
      expect(doc, modo).not.toContain('<img');
      expect(doc, modo).not.toContain('<a ');
      expect(doc, modo).not.toContain('<figure');
      expect(doc, modo).toContain('<strong>CNH / Identidade</strong>');
      expect(doc, modo).toContain('<p class="expl">Confirma quem é o titular da conta.</p>');
      expect(doc, modo).toContain('<p class="obs">Titular conferido.</p>');
      expect(doc, modo).toContain('<p class="docaviso">Documento recebido. A imagem fica só com a empresa.</p>');
    }
  });
  it('a frase do documento só aparece quando há mídia; com observação e sem mídia, só o texto', () => {
    const semMidia = html(entrada({ itens: itens({}, { documento_pessoal: 'Documento conferido na visita.' }) }));
    expect(semMidia).toContain('<p class="obs">Documento conferido na visita.</p>');
    expect(semMidia).not.toContain('Documento recebido.');
    const comMidia = html(entrada({ itens: itens({ documento_pessoal: [DOCUMENTO] }) }));
    expect(comMidia).toContain('Documento recebido. A imagem fica só com a empresa.');
    expect(comMidia).not.toContain('documento_pessoal-1.jpg');
  });
  it('o documento pessoal não entra na contagem do botão de baixar nem na legenda das fotos', () => {
    const h = html(entrada({ itens: itens({ documento_pessoal: [DOCUMENTO, DOCUMENTO], padrao: [foto()] }) }));
    expect(h).toContain('Baixar fotos e arquivos (1)');
    expect(legendas(h)).toEqual([1]);
    const so = html(entrada({ itens: itens({ documento_pessoal: [DOCUMENTO] }) }));
    expect(so).not.toContain('Baixar fotos e arquivos');
  });
  it('sem documentos nem observação a seção não aparece', () => {
    const h = html(entrada({ itens: itens({ padrao: [foto()] }) }));
    expect(h).not.toContain('Documentos do titular');
    expect(h).not.toContain('id="documentos"');
  });
  it('só o documento pessoal, sem outro registro: não é "Nenhum registro ainda"', () => {
    const h = html(entrada({ itens: itens({ documento_pessoal: [DOCUMENTO] }) }));
    expect(h).not.toContain('Nenhum registro ainda.');
    expect(h).toContain('Documentos do titular');
  });
});

// ── Assinaturas com data (R14) ──────────────────────────────────────────────

describe('assinaturas', () => {
  it('cada assinatura mostra "Assinado em" com a data e a hora de Brasília', () => {
    const h = html(entrada({ assinaturas: ASSINATURAS }));
    expect(h).toContain('<p class="nm">Bruno Lima</p><p class="rg">Registro: CFT 123</p><p class="dt">Assinado em 27/10/2026 às 14:32</p><p class="cap">Assinatura do técnico</p>');
    expect(h).toContain('<p class="nm">Maria Souza</p><p class="rg"></p><p class="dt">Assinado em 27/10/2026 às 14:40</p><p class="cap">Assinatura do cliente</p>');
  });
  it('sem ts válido, sem a data; os parágrafos continuam, vazios, para alinhar as duas colunas', () => {
    const h = html(entrada({ assinaturas: { tecnico: { url: null, nome: 'Bruno Lima', registro: 'CFT 123', ts: 'x' }, cliente: { url: null, nome: 'Maria Souza' } } }));
    expect(h).not.toContain('Assinado em');
    expect(h).toContain('<p class="dt"></p>');
    expect(h).toContain('Registro: CFT 123');
  });
  it('a imagem da assinatura aparece quando há URL; a ciência do cliente não é impressa', () => {
    const h = html(entrada({ assinaturas: ASSINATURAS }));
    expect(h).toContain('<img src="https://storage.test/assinatura-tecnico.png?token=abc" alt="Assinatura do técnico"/>');
    expect(h).not.toMatch(/declaro/i);
  });
  it('só uma das duas assinaturas também aparece; nenhuma, sem a seção', () => {
    expect(html(entrada({ assinaturas: { cliente: ASSINATURAS.cliente } }))).toContain('Assinatura do cliente');
    expect(html(entrada())).not.toContain('Assinaturas');
  });
  it('alturas iguais nas duas colunas (nome, registro e data com altura mínima)', () => {
    const h = html(entrada({ assinaturas: ASSINATURAS }));
    expect(h).toContain('.ass .nm{');
    expect(h).toMatch(/\.ass \.nm\{[^}]*min-height:1\.4em/);
    expect(h).toMatch(/\.ass \.rg,\.ass \.dt\{[^}]*min-height:1\.2em/);
  });
  it('nome longo em uma coluna não desalinha a data da outra: as colunas esticam e o nome ocupa a sobra', () => {
    const h = html(entrada({ assinaturas: ASSINATURAS }));
    expect(h).toContain('.ass{display:flex;flex-direction:column}');
    expect(h).toMatch(/\.ass \.area\{flex:none;height:96px;/);
    expect(h).toMatch(/\.ass \.nm\{[^}]*min-height:1\.4em;flex:1 1 auto/);
  });
});

// ── Metadados e rodapé do PDF (R15, R16) ────────────────────────────────────

describe('metadados da página', () => {
  it('título igual ao de antes, fora dos buscadores e com prévia de compartilhamento', () => {
    const h = html(entrada({ marca: MARCA }));
    expect(h).toContain('<title>Vistoria: Maria Souza</title>');
    expect(h).toContain('<meta name="robots" content="noindex,nofollow"/>');
    expect(h).toContain('<meta property="og:title" content="Vistoria: Maria Souza"/>');
    expect(h).toContain('<meta property="og:description" content="Relatório de vistoria de energia solar de Maria Souza, por Solar Teste Energia."/>');
    expect(h).toContain('<meta property="og:type" content="article"/>');
  });
  it('sem cliente e sem marca a descrição fica curta; o título é só "Vistoria"', () => {
    const h = html(entrada({ cliente_nome: null }));
    expect(h).toContain('<title>Vistoria</title>');
    expect(h).toContain('content="Relatório de vistoria de energia solar."');
    expect(h).toContain('<h1>Vistoria técnica</h1>');
  });
});

describe('opcoesPdf (rodapé de página)', () => {
  it('A4, fundo impresso e rodapé com empresa, código, cliente e "Página X de Y"', () => {
    const o = opcoesPdf({ marcaNome: 'Solar Teste Energia', codigo: 'VT-11111111', cliente: 'Maria Souza' });
    expect(o.format).toBe('A4');
    expect(o.printBackground).toBe(true);
    expect(o.preferCSSPageSize).toBe(true);
    expect(o.displayHeaderFooter).toBe(true);
    expect(o.footerTemplate).toContain('Solar Teste Energia · VT-11111111 · Maria Souza');
    expect(o.footerTemplate).toContain('class="pageNumber"');
    expect(o.footerTemplate).toContain('class="totalPages"');
    expect(o.footerTemplate).toContain('font-size:10.5px');
    expect(o.footerTemplate).toContain('padding:0 16mm');
  });
  it('sem empresa nem cliente, só o código; nome da empresa e do cliente são cortados com reticências', () => {
    expect(opcoesPdf({ codigo: 'VT-11111111' }).footerTemplate).toContain('>VT-11111111</span>');
    const longo = opcoesPdf({ marcaNome: 'E'.repeat(40), codigo: 'VT-11111111', cliente: 'C'.repeat(50) }).footerTemplate;
    expect(longo).toContain(`${'E'.repeat(27)}… · VT-11111111 · ${'C'.repeat(35)}…`);
  });
  it('os textos entram escapados', () => {
    const f = opcoesPdf({ marcaNome: 'A&B <x>', codigo: 'VT-1', cliente: 'Zé "Z"' }).footerTemplate;
    expect(f).toContain('A&amp;B &lt;x&gt; · VT-1 · Zé &quot;Z&quot;');
    expect(f).not.toContain('<x>');
  });
  it('emoji sai e travessão vira hífen também no rodapé, que vai em toda página', () => {
    const f = opcoesPdf({ marcaNome: `Sol \u{2014} Cia \u{1F600}`, codigo: 'VT-1', cliente: `Zé \u{2013} Z \u{2600}` }).footerTemplate;
    expect(f).not.toMatch(TRAVESSAO);
    expect(f).not.toMatch(EMOJI);
    expect(f).toContain('Sol - Cia · VT-1 · Zé - Z');
  });
  it('a margem do @page é a mesma do rodapé', () => {
    for (const modo of ['tela', 'pdf'] as const) expect(html(entrada(), modo)).toContain('@page{size:A4;margin:14mm 16mm 18mm}');
  });
});

// ── Texto digitado por gente: escape, emoji e travessão ─────────────────────

describe('texto hostil', () => {
  it('<script>, aspas e & saem escapados em todos os campos digitados, sem quebrar atributo', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html(hostil(), modo);
      expect(h, modo).not.toContain('<script>');
      expect(h, modo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(h, modo).toContain('&quot;aspas&quot;');
      expect(h, modo).toContain('&#39;simples&#39;');
      expect(h, modo).toContain('&amp; fim');
      expect(h, modo).not.toMatch(/alt="[^"]*<|content="[^"]*<|href="[^"]*<|src="[^"]*<|title>[^<]*<script/);
      expect(h, modo).not.toMatch(/<[a-z][^>]*='/i); // nenhum atributo com aspas simples
    }
  });
  it('emoji sai e travessão vira hífen no que gente digitou', () => {
    const h = html(hostil());
    expect(h).not.toMatch(TRAVESSAO);
    expect(h).not.toMatch(EMOJI);
    expect(h).toContain('&amp; fim - - ');
  });
});

// ── Lista de compras: "Materiais e providências" ────────────────────────────

const lc = (n: number, extra: Partial<LinhaCompra> = {}): LinhaCompra => ({
  id: 'linha' + String(n).padStart(3, '0'), tipo: 'material', nome: `Material ${n}`, qtd: 1, un: 'un', quem: 'cliente', obs: '', ...extra,
});
const anotacao = (n: number, extra: Partial<LinhaCompra> = {}): LinhaCompra => ({
  id: 'nota' + String(n).padStart(4, '0'), tipo: 'obs', obs: `Anotação ${n}.`, ...extra,
});
const lista = (linhas: LinhaCompra[], publica = true): Compras => ({ v: 1, publica, linhas });

/**
 * 7 materiais (1 serviço) e 2 anotações para a vistoria cheia: padrão e sombreamento não conformes; telhado, tipo de
 * telha e estrutura em atenção; medidor conforme; cabeamento não se aplica.
 */
const LINHAS_CHEIA: LinhaCompra[] = [
  lc(1, { nome: 'Caixa de medição', esp: 'Modelo aprovado pela distribuidora, com espaço para o medidor bidirecional.', item: 'padrao', obs: 'Caixa atual é antiga.' }),
  lc(2, { nome: 'Cabo solar CC', esp: '1,5 kV CC, cobre estanhado, dupla isolação.', qtd: 120, un: 'm', quem: 'integrador', item: 'cabeamento', obs: 'Do telhado até o inversor.' }),
  lc(3, { nome: 'Poda ou remoção de árvore', qtd: null, un: 'servico', quem: 'cliente', item: 'sombreamento' }),
  lc(4, { nome: 'Selante e fita', qtd: null, un: 'pc', quem: 'a_definir', item: 'telhado' }),
  lc(5, { nome: 'Telha de reposição', qtd: 12, quem: 'cliente', item: 'telhado' }),
  lc(6, { nome: 'Haste de aterramento', quem: 'integrador', item: 'medidor' }),
  lc(7, { nome: 'Eletroduto', qtd: 3, un: 'barra', quem: 'integrador' }),
  anotacao(1, { obs: 'Telha de fibrocimento antiga, pode ter amianto. Não furar nem cortar.', item: 'tipo_telha' }),
  anotacao(2, { obs: 'Cliente prefere instalar pela manhã.' }),
];
/** V1 com a lista visível. */
const comLista = (): EntradaVistoria => ({ ...cheia(), compras: lista(LINHAS_CHEIA) });
/** V6: 40 linhas (37 de material, 3 serviços entre elas, e 3 anotações) em dois grupos grandes. */
const quarenta = (): EntradaVistoria => entrada({
  status_itens: { padrao: 'nao_conforme', telhado: 'atencao' },
  compras: lista([
    ...Array.from({ length: 37 }, (_, i) => lc(i + 1, {
      nome: `Material de teste número ${i + 1}`,
      qtd: i % 13 === 0 ? null : (i % 5) + 1,
      un: i % 13 === 0 ? 'servico' : 'un',
      quem: i < 19 ? 'cliente' : 'integrador',
      ...(i % 3 === 0 ? { item: i % 2 === 0 ? 'padrao' : 'telhado' } : {}),
      ...(i % 4 === 0 ? { esp: 'Especificação de referência para a compra deste material.' } : {}),
    })),
    anotacao(1), anotacao(2, { item: 'tipo_telha' }), anotacao(3),
  ]),
});
/** V8 com lista: o texto hostil passa pelo saneamento, como na rota. */
const hostilComLista = (): EntradaVistoria => ({
  ...hostil(),
  compras: sanitizarCompras({
    v: 1,
    publica: true,
    linhas: [
      { id: 'xss00001', tipo: 'material', nome: SUJO, esp: SUJO, qtd: 2, un: 'un', quem: 'cliente', item: 'padrao', obs: SUJO },
      { id: 'xss00002', tipo: 'obs', obs: SUJO, item: 'telhado' },
    ],
  }),
});

/** A seção da lista, de `<section ... id="compras">` até o fecho. */
const secaoCompras = (h: string): string => {
  const i = h.indexOf('<section class="sec" id="compras"');
  return i < 0 ? '' : h.slice(i, h.indexOf('</section>', i) + '</section>'.length);
};
/** A linha da tabela de um material, de `<tr` até `</tr>`. */
const linhaDe = (h: string, nome: string): string => {
  const i = h.indexOf(`<b>${nome}</b>`);
  return i < 0 ? '' : h.slice(h.lastIndexOf('<tr', i), h.indexOf('</tr>', i) + '</tr>'.length);
};
/** O cartão de pendência de um item, de `<div class="pen` até o cartão seguinte (ou o próximo título). */
const cartao = (h: string, rotulo: string): string => {
  const i = h.indexOf(`<b>${rotulo}</b><span class="chip p-`);
  if (i < 0) return '';
  const ini = h.lastIndexOf('<div class="pen ', i);
  const proximo = h.indexOf('<div class="pen ', ini + 1);
  return h.slice(ini, proximo < 0 ? h.indexOf('<h2', ini) : proximo).trim();
};
/** Os nomes da primeira coluna, na ordem em que aparecem. */
const nomesNaTabela = (h: string): string[] => [...h.matchAll(/<td data-r="Item"><b>([^<]*)<\/b>/g)].map((m) => m[1]!);

describe('lista de compras no relatório', () => {
  it('a seção traz título, abertura, resumo, cabeçalho da tabela e o aviso de referência, na tela e no PDF', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const s = secaoCompras(html(comLista(), modo));
      expect(s, modo).toContain('<section class="sec" id="compras" aria-labelledby="h-compras">');
      expect(s, modo).toContain('<h2 class="sec" id="h-compras">Materiais e providências</h2>');
      expect(s, modo).toContain('<p class="intro">Esta lista reúne o que precisa ser comprado ou resolvido para a instalação.</p>');
      expect(s, modo).toContain('<p class="resumo-compras">6 materiais, 1 serviço e 2 observações.</p>');
      expect(s, modo).toContain('<thead><tr><th>Item</th><th>Quantidade</th><th>Motivo</th></tr></thead>');
      expect(s, modo).toContain('<p class="aviso-ref">As quantidades e as especificações são de referência. Confirme com o projeto e com a norma da distribuidora de energia antes de comprar.</p>');
    }
  });
  it('a estrutura da seção é a mesma na tela e no PDF', () => {
    const e = comLista();
    expect(secaoCompras(html(e, 'tela'))).toBe(secaoCompras(html(e, 'pdf')));
    expect(secaoCompras(html(e, 'tela'))).not.toBe('');
  });
  it('os grupos vêm na ordem cliente, empresa instaladora e a combinar, com a frase de apoio e a contagem', () => {
    const s = secaoCompras(html(comLista()));
    const ordem = [
      '<h3>Por conta do cliente <span class="n">3 itens</span></h3><p class="apoio">O cliente providencia estes itens e serviços.</p>',
      '<h3>Por conta da empresa instaladora <span class="n">3 itens</span></h3><p class="apoio">Estes itens e serviços ficam com a empresa instaladora.</p>',
      '<h3>A combinar <span class="n">1 item</span></h3><p class="apoio">Ainda não foi definido quem providencia. Combinar antes do orçamento.</p>',
    ].map((trecho) => s.indexOf(trecho));
    expect(ordem.every((p) => p > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(s.match(/<table class="cmp">/g)).toHaveLength(3);
  });
  it('só aparecem os grupos que têm linha', () => {
    const s = secaoCompras(html(entrada({ compras: lista([lc(1, { quem: 'integrador' }), anotacao(1)]) })));
    expect(s).toContain('Por conta da empresa instaladora');
    expect(s).not.toContain('Por conta do cliente');
    expect(s).not.toContain('A combinar');
  });
  it('dentro do grupo: prazo alto, prazo médio e sem prazo; e a ordem gravada desempata', () => {
    const e = entrada({
      status_itens: { padrao: 'nao_conforme', telhado: 'atencao' },
      compras: lista([
        lc(1, { nome: 'Sem prazo um' }), lc(2, { nome: 'Média um', item: 'telhado' }), lc(3, { nome: 'Alta um', item: 'padrao' }),
        lc(4, { nome: 'Sem prazo dois' }), lc(5, { nome: 'Alta dois', item: 'padrao' }), lc(6, { nome: 'Média dois', item: 'telhado' }),
      ]),
    });
    expect(nomesNaTabela(html(e))).toEqual(['Alta um', 'Alta dois', 'Média um', 'Média dois', 'Sem prazo um', 'Sem prazo dois']);
    expect(nomesNaTabela(html(comLista()))).toEqual([
      'Caixa de medição', 'Poda ou remoção de árvore', 'Telha de reposição', 'Cabo solar CC', 'Haste de aterramento', 'Eletroduto', 'Selante e fita',
    ]);
  });
  it('quantidade por extenso com espaço sem quebra, "A definir" e o chip de serviço', () => {
    const h = html(comLista());
    expect(h).toContain('<td class="q" data-r="Quantidade">1\u00A0unidade</td>');
    expect(h).toContain('<td class="q" data-r="Quantidade">12\u00A0unidades</td>');
    expect(h).toContain('<td class="q" data-r="Quantidade">120\u00A0metros</td>');
    expect(h).toContain('<td class="q" data-r="Quantidade">3\u00A0barras</td>');
    expect(h).toContain('<td class="q" data-r="Quantidade">A definir</td>');
    expect(h).toContain('<td class="q" data-r="Quantidade"><span class="chip s-na">Serviço</span></td>');
    expect(h).not.toContain('&nbsp;unidade');
  });
  it('quantidade com milhar e decimais usa o formato brasileiro', () => {
    const h = html(entrada({ compras: lista([lc(1, { nome: 'Cabo', qtd: 1200.5, un: 'm' }), lc(2, { nome: 'Fita', qtd: 0.5, un: 'cj' })]) }));
    expect(h).toContain('1.200,5\u00A0metros');
    expect(h).toContain('0,5\u00A0conjuntos');
  });
  it('o prazo vem do status do item ligado: Antes de instalar só em Não conforme, Antes ou durante a instalação só em Atenção', () => {
    const h = html(comLista());
    const caixa = linhaDe(h, 'Caixa de medição');
    expect(caixa).toMatch(/^<tr class="alta">/);
    expect(caixa).toContain('<span class="chip p-alta">Antes de instalar</span>');
    expect(caixa).not.toContain('chip p-media');
    const telha = linhaDe(h, 'Telha de reposição');
    expect(telha).toMatch(/^<tr class="media">/);
    expect(telha).toContain('<span class="chip p-media">Antes ou durante a instalação</span>');
    expect(telha).not.toContain('chip p-alta');
    // item Conforme, Não se aplica e linha sem item: sem classe de cor e sem chip de prazo
    for (const nome of ['Haste de aterramento', 'Cabo solar CC', 'Eletroduto']) {
      const l = linhaDe(h, nome);
      expect(l, nome).toMatch(/^<tr>/);
      expect(l, nome).not.toMatch(/chip p-(alta|media)/);
    }
  });
  it('sem item em Atenção nem Não conforme não há chip de prazo nem legenda', () => {
    const h = html(entrada({ status_itens: conformes(10), compras: lista(LINHAS_CHEIA) }));
    const s = secaoCompras(h);
    expect(s).not.toMatch(/chip p-(alta|media)/);
    expect(s).not.toContain('<p class="legenda-prazo">');
    expect(s).not.toMatch(/<tr class="(alta|media)">/);
    expect(s).toContain('Item da vistoria: Padrão de entrada');
  });
  it('a legenda dos prazos conta os itens e usa o singular', () => {
    expect(secaoCompras(html(comLista()))).toContain(
      '<p class="legenda-prazo"><span class="chip p-alta">Antes de instalar</span> 2 itens <span class="chip p-media">Antes ou durante a instalação</span> 2 itens</p>',
    );
    const soAlta = secaoCompras(html(entrada({ status_itens: { padrao: 'nao_conforme' }, compras: lista([lc(1, { item: 'padrao' }), lc(2)]) })));
    expect(soAlta).toContain('<p class="legenda-prazo"><span class="chip p-alta">Antes de instalar</span> 1 item</p>');
    expect(soAlta).not.toContain('class="chip p-media"');
    const soMedia = secaoCompras(html(entrada({ status_itens: { telhado: 'atencao' }, compras: lista([lc(1, { item: 'telhado' }), lc(2, { item: 'telhado' })]) })));
    expect(soMedia).toContain('<p class="legenda-prazo"><span class="chip p-media">Antes ou durante a instalação</span> 2 itens</p>');
    expect(soMedia).not.toContain('class="chip p-alta"');
  });
  it('a célula do motivo traz o item da vistoria; sem item e sem prazo fica vazia', () => {
    const h = html(comLista());
    expect(linhaDe(h, 'Caixa de medição')).toContain('<span class="orig">Item da vistoria: Padrão de entrada</span>');
    expect(linhaDe(h, 'Haste de aterramento')).toContain('<td data-r="Motivo"><span class="orig">Item da vistoria: Medidor / Relógio</span></td>');
    expect(linhaDe(h, 'Eletroduto')).toContain('<td data-r="Motivo">&nbsp;</td>');
  });
  it('o rótulo do item vem do label da vistoria, com o rótulo padrão quando o item não está na vistoria', () => {
    const h = html(entrada({
      itens: [],
      compras: lista([lc(1, { nome: 'Caixa', item: 'padrao' }), lc(2, { nome: 'Cópia da conta', item: 'conta_luz' }), anotacao(1, { item: 'documento_pessoal' })]),
    }));
    expect(h).toContain('Item da vistoria: Padrão de entrada');
    expect(h).toContain('Item da vistoria: Conta de luz');
    expect(h).toContain('<li><b>CNH / Identidade:</b> Anotação 1.</li>');
    const rotulado = html(entrada({ itens: itens(), compras: lista([lc(1, { item: 'sombreamento' })]) }));
    expect(rotulado).toContain('Item da vistoria: Sombreamento');
  });
  it('a especificação e a nota da linha ficam na célula do item, com o prefixo "Nota:"', () => {
    const h = html(comLista());
    const caixa = linhaDe(h, 'Caixa de medição');
    expect(caixa).toContain('<span class="esp">Modelo aprovado pela distribuidora, com espaço para o medidor bidirecional.</span>');
    expect(caixa).toContain('<span class="nota">Nota: Caixa atual é antiga.</span>');
    const eletroduto = linhaDe(h, 'Eletroduto');
    expect(eletroduto).not.toContain('class="esp"');
    expect(eletroduto).not.toContain('class="nota"');
  });
  it('as anotações vêm depois das tabelas, com o rótulo do item em negrito quando há item', () => {
    const s = secaoCompras(html(comLista()));
    expect(s).toContain('<div class="notas-compras"><h3>Anotações</h3><ul>');
    expect(s).toContain('<li><b>Tipo de telha:</b> Telha de fibrocimento antiga, pode ter amianto. Não furar nem cortar.</li>');
    expect(s).toContain('<li>Cliente prefere instalar pela manhã.</li>');
    expect(s.indexOf('class="notas-compras"')).toBeGreaterThan(s.lastIndexOf('</table>'));
    expect(secaoCompras(html(entrada({ compras: lista([lc(1)]) })))).not.toContain('Anotações');
  });
  it('só anotações: sem tabela, sem grupos e sem legenda de prazo', () => {
    const s = secaoCompras(html(entrada({ status_itens: { padrao: 'nao_conforme' }, compras: lista([anotacao(1, { item: 'padrao' }), anotacao(2)]) })));
    expect(s).toContain('<p class="intro">Esta lista traz apenas anotações.</p>');
    expect(s).not.toContain('Esta lista reúne');
    expect(s).toContain('<p class="resumo-compras">2 observações.</p>');
    expect(s).not.toContain('<table');
    expect(s).not.toContain('grupo-compras');
    expect(s).not.toContain('<p class="legenda-prazo">');
    expect(s).toContain('<li><b>Padrão de entrada:</b> Anotação 1.</li>');
  });
  it('"Na lista:" aparece no cartão da pendência do item ligado, só com material', () => {
    const h = html(comLista());
    expect(cartao(h, 'Padrão de entrada')).toContain('<p class="nalista">Na lista: Caixa de medição.</p>');
    expect(cartao(h, 'Sombreamento')).toContain('<p class="nalista">Na lista: Poda ou remoção de árvore.</p>');
    expect(cartao(h, 'Telhado')).toContain('<p class="nalista">Na lista: Selante e fita e Telha de reposição.</p>');
    // Tipo de telha só tem uma anotação ligada; Estrutura não tem nada: sem a linha
    expect(cartao(h, 'Tipo de telha')).not.toContain('nalista');
    expect(cartao(h, 'Estrutura apropriada')).not.toContain('nalista');
    // item Conforme não tem cartão, então a Haste (ligada ao medidor) não vira "Na lista:"
    expect(h).not.toContain('Na lista: Haste');
    expect(h.match(/class="nalista"/g)).toHaveLength(3);
  });
  it('"Na lista:" vem depois da observação e das fotos do cartão', () => {
    const e = entrada({
      itens: itens({ padrao: [foto(), foto()] }, { padrao: 'Caixa enferrujada.' }),
      status_itens: { padrao: 'nao_conforme' },
      compras: lista([lc(1, { nome: 'Caixa de medição', item: 'padrao' })]),
    });
    expect(cartao(html(e), 'Padrão de entrada')).toMatch(/<p class="pobs">Caixa enferrujada\.<\/p><p class="pref"><a href="#i-padrao">Fotos 1 e 2<\/a><\/p><p class="nalista">Na lista: Caixa de medição\.<\/p><\/div>$/);
  });
  it('"Na lista:" mostra até 3 nomes; com mais de 3 mostra 2 e "mais N"', () => {
    const nomes = (n: number) => Array.from({ length: n }, (_, i) => lc(i + 1, { nome: `Peça ${'ABCDEF'[i]}`, item: 'padrao' }));
    const frase = (n: number) => /<p class="nalista">([^<]*)<\/p>/.exec(html(entrada({ status_itens: { padrao: 'nao_conforme' }, compras: lista(nomes(n)) })))?.[1];
    expect(frase(1)).toBe('Na lista: Peça A.');
    expect(frase(2)).toBe('Na lista: Peça A e Peça B.');
    expect(frase(3)).toBe('Na lista: Peça A, Peça B e Peça C.');
    expect(frase(4)).toBe('Na lista: Peça A, Peça B e mais 2.');
    expect(frase(6)).toBe('Na lista: Peça A, Peça B e mais 4.');
  });
  it('fraseNaLista e paragrafoNaLista: sem nomes não há frase; o ponto final não se repete', () => {
    expect(fraseNaLista([])).toBe('');
    expect(fraseNaLista(['A'])).toBe('A');
    expect(fraseNaLista(['A', 'B', 'C', 'D', 'E'])).toBe('A, B e mais 3');
    expect(paragrafoNaLista(undefined)).toBe('');
    expect(paragrafoNaLista([])).toBe('');
    expect(paragrafoNaLista(['Fita.'])).toBe('<p class="nalista">Na lista: Fita.</p>');
  });
  it('o serviço também entra no "Na lista:" (a poda resolve o sombreamento)', () => {
    const h = html(entrada({ status_itens: { sombreamento: 'nao_conforme' }, compras: lista([lc(1, { nome: 'Poda', qtd: null, un: 'servico', item: 'sombreamento' })]) }));
    expect(cartao(h, 'Sombreamento')).toContain('Na lista: Poda.');
  });
  it('a lista nunca muda o selo, a conclusão nem cria pendência', () => {
    const base = cheia();
    const sem = html(base);
    const com = html({ ...base, compras: lista(LINHAS_CHEIA) });
    const trecho = (h: string, de: string, ate: string) => {
      const i = h.indexOf(de);
      return h.slice(i, h.indexOf(ate, i + de.length));
    };
    expect(trecho(com, '<div class="selo', '<p class="placar">')).toBe(trecho(sem, '<div class="selo', '<p class="placar">'));
    expect(trecho(com, '<div class="selo', '<p class="placar">')).toContain('Adequar antes de instalar');
    expect(com.match(/<div class="pen /g)).toHaveLength(sem.match(/<div class="pen /g)!.length);
    const conclusao = trecho(com, '<p class="concl">', '</p>');
    expect(conclusao).toBe(trecho(sem, '<p class="concl">', '</p>'));
    expect(conclusao).toContain('Foram encontradas não conformidades');
    expect(conclusao).not.toMatch(/lista|compra|material/i);
  });
  it('a ordem no documento: conclusão, próximos passos, lista, registro por item, documentos e assinaturas', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html(comLista(), modo);
      // Os títulos (h2), não as palavras soltas: na tela a navegação do topo também diz "Assinaturas".
      const ordem = ['Conclusão', 'Próximos passos', 'Materiais e providências', 'Registro por item', 'Documentos do titular', 'Assinaturas']
        .map((titulo) => h.indexOf(`<h2 class="sec"${titulo === 'Materiais e providências' ? ' id="h-compras"' : ''}>${titulo}</h2>`));
      expect(ordem.every((p) => p > 0), modo).toBe(true);
      expect([...ordem].sort((a, b) => a - b), modo).toEqual(ordem);
    }
  });
  it('em andamento a lista aparece sem "Próximos passos"; sem nenhum status ela aparece antes do registro', () => {
    const h = html({ ...andamento(), compras: lista(LINHAS_CHEIA) });
    expect(h).toContain('id="compras"');
    expect(h).not.toContain('Próximos passos');
    expect(h.indexOf('<h2 class="sec">Conclusão</h2>')).toBeGreaterThan(0);
    expect(h.indexOf('<h2 class="sec">Conclusão</h2>')).toBeLessThan(h.indexOf('id="compras"'));
    expect(h.indexOf('id="compras"')).toBeLessThan(h.indexOf('Registro por item'));
    const semStatus = html(entrada({ itens: itens({ padrao: [foto()] }), compras: lista([lc(1)]) }));
    expect(semStatus).not.toContain('Resultado da vistoria');
    expect(semStatus.indexOf('id="compras"')).toBeGreaterThan(0);
    expect(semStatus.indexOf('id="compras"')).toBeLessThan(semStatus.indexOf('Registro por item'));
  });
  it('a navegação da tela ganha "Compras" entre Pendências e Fotos; o PDF não tem navegação', () => {
    expect(html(comLista(), 'tela')).toContain('<span>Ir para:</span><a href="#pendencias">Pendências</a><a href="#compras">Compras</a><a href="#registro">Fotos</a><a href="#assinaturas">Assinaturas</a>');
    expect(html(comLista(), 'pdf')).not.toContain('href="#compras"');
    expect(html(entrada({ compras: lista([lc(1)]) }), 'tela')).toContain('<span>Ir para:</span><a href="#compras">Compras</a>');
  });
  it('o CSS da lista só vem com a lista: tabela com cabeçalho repetido, linhas inteiras e cartões no celular', () => {
    const h = html(comLista());
    expect(h).toContain('.cmp thead{display:table-header-group}');
    expect(h).toContain('.cmp tr{break-inside:avoid;page-break-inside:avoid}');
    // colunas Quantidade e Motivo com a mesma largura preferida em todos os grupos (e sem `table-layout:fixed`, que não cresce
    // com fonte larga); a faixa de prazo é sombra interna, não borda, para a linha divisória começar no mesmo ponto
    expect(h).toContain('.cmp{width:100%;border-collapse:collapse;font-size:13px}');
    expect(h).not.toContain('table-layout:fixed');
    expect(h).toContain('.cmp th:nth-child(2){text-align:right;width:128px}');
    expect(h).toContain('.cmp th:nth-child(3){width:250px}');
    expect(h).toContain('.cmp tr.alta td:first-child{box-shadow:inset 4px 0 0 var(--sc-nao_conforme)}');
    expect(h).toContain('.cmp tr.media td:first-child{box-shadow:inset 4px 0 0 var(--sc-atencao)}');
    expect(h).not.toContain('border-left:4px solid transparent');
    expect(h).toContain('.cmp tr.alta td:first-child,.cmp tr.media td:first-child{box-shadow:none}'); // celular: a faixa vai para o cartão
    expect(h).toContain('.notas-compras{margin-top:14px;break-inside:avoid;page-break-inside:avoid}');
    expect(h).toContain('.grupo-compras h3{margin:0 0 4px;font-size:15px;break-after:avoid;page-break-after:avoid}');
    expect(h).toContain('.pen .nalista{');
    expect(h).toMatch(/@media \(max-width:640px\)\{[^}]*\.cmp thead\{display:none\}/);
    expect(h).toContain('.cmp td::before{content:attr(data-r)');
    expect(h).toContain('.cmp td[data-r="Motivo"]:not(:has(*)){display:none}'); // celular: motivo vazio some
    // a abertura, o resumo e a legenda seguem junto do primeiro grupo, e a legenda não deixa uma contagem sozinha na linha
    for (const classe of ['intro', 'resumo-compras', 'legenda-prazo']) {
      expect(h, classe).toMatch(new RegExp(`\\.${classe}\\{[^}]*break-after:avoid;page-break-after:avoid`));
    }
    expect(h).toMatch(/\.legenda-prazo\{[^}]*text-wrap:balance/);
    expect(h).not.toMatch(/#0F172A/);
    // cada célula traz o rótulo que a tela estreita mostra
    const celulas = secaoCompras(h).match(/<td[^>]*>/g) ?? [];
    expect(celulas.length).toBeGreaterThan(0);
    for (const c of celulas) expect(c).toContain('data-r="');
    const sem = html(cheia());
    expect(sem).not.toContain('.cmp');
    expect(sem).not.toContain('.nalista');
    expect(sem).not.toContain('.notas-compras');
  });
  it('sem lista visível a seção, a âncora, o "Na lista:" e o CSS da lista não existem, e o HTML é o mesmo de antes', () => {
    const base = cheia();
    const ocultas: [string, Compras | null | undefined][] = [
      ['oculta', lista([lc(1, { item: 'padrao' }), anotacao(1)], false)],
      ['vazia', lista([])],
      ['padrão', comprasVazio()],
      ['nula', null],
      ['ausente', undefined],
    ];
    for (const modo of ['tela', 'pdf'] as const) {
      const sem = html(base, modo);
      expect(sem, modo).not.toContain('id="compras"');
      expect(sem, modo).not.toContain('Materiais e providências');
      expect(sem, modo).not.toContain('Na lista:');
      expect(sem, modo).not.toContain('class="cmp"');
      expect(sem, modo).not.toContain('.nalista');
      expect(sem, modo).not.toContain('href="#compras"');
      for (const [nome, compras] of ocultas) expect(html({ ...base, compras }, modo), `${nome}, ${modo}`).toBe(sem);
    }
  });
  it('uma lista com linhas que não são linhas válidas não vira seção vazia', () => {
    const quebrada = { v: 1, publica: true, linhas: [null, 7, 'x'] } as unknown as Compras;
    const h = html({ ...cheia(), compras: quebrada });
    expect(h).not.toContain('id="compras"');
    expect(h).not.toContain('Materiais e providências');
  });
  it('texto hostil na lista sai escapado e limpo, na tela e no PDF', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html(hostilComLista(), modo);
      const s = secaoCompras(h);
      expect(s, modo).not.toContain('<script>');
      expect(s, modo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(s, modo).toContain('&quot;aspas&quot;');
      expect(s, modo).toContain('&#39;simples&#39;');
      expect(s, modo).toContain('&amp; fim - -');
      expect(h, modo).not.toContain('<script>');
      expect(h, modo).not.toMatch(/<[a-z][^>]*='/i); // nenhum atributo com aspas simples
      expect(h, modo).not.toMatch(TRAVESSAO);
      expect(h, modo).not.toMatch(EMOJI);
      expect(cartao(h, 'Padrão de entrada'), modo).toContain('Na lista: &lt;script&gt;alert(1)&lt;/script&gt;');
    }
  });
  it('mesmo sem passar pelo saneamento, o modelo limpa emoji e travessão antes de escrever', () => {
    const sujo = `Caixa \u{2014} grande \u{1F600} \u{2600} <b>forte</b>`;
    const h = html(entrada({
      status_itens: { padrao: 'nao_conforme' },
      compras: lista([lc(1, { nome: sujo, esp: sujo, obs: sujo, item: 'padrao' }), anotacao(1, { obs: sujo })]),
    }), 'pdf');
    expect(h).not.toMatch(TRAVESSAO);
    expect(h).not.toMatch(EMOJI);
    expect(h).toMatch(/Caixa - grande\s+&lt;b&gt;forte&lt;\/b&gt;/);
    expect(h).not.toContain('<b>forte</b>');
  });
  it('lista de 40 linhas: duas tabelas, três anotações, linhas inteiras e o cabeçalho em cada tabela', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html(quarenta(), modo);
      const s = secaoCompras(h);
      expect(s.match(/<table class="cmp">/g), modo).toHaveLength(2);
      expect(s.match(/<thead>/g), modo).toHaveLength(2);
      expect(nomesNaTabela(s), modo).toHaveLength(37);
      expect(s, modo).toContain('<p class="resumo-compras">34 materiais, 3 serviços e 3 observações.</p>');
      expect(s, modo).toContain('Por conta do cliente <span class="n">19 itens</span>');
      expect(s, modo).toContain('Por conta da empresa instaladora <span class="n">18 itens</span>');
      expect(s.match(/<li>/g), modo).toHaveLength(3);
      expect(h, modo).toContain('.cmp tr{break-inside:avoid;page-break-inside:avoid}');
    }
  });
});

describe('matriz de casos (tela e PDF)', () => {
  const casos: [string, () => EntradaVistoria][] = [
    ['cheia', cheia], ['mínima', minima], ['em andamento', andamento], ['conforme parcial', parcial], ['texto hostil', hostil],
    ['cheia com lista', comLista], ['lista de 40 linhas', quarenta], ['texto hostil com lista', hostilComLista],
  ];
  for (const [nome, monta] of casos) {
    for (const modo of ['tela', 'pdf'] as const) {
      it(`${nome}, ${modo}: sem travessão, sem emoji, sem tema escuro, com @page`, () => {
        const h = html(monta(), modo);
        expect(h).not.toMatch(TRAVESSAO);
        expect(h).not.toMatch(EMOJI);
        expect(h).not.toContain('#0F172A');
        expect(h).toContain('@page');
        expect(h).toContain('<html lang="pt-BR">');
        expect(h.startsWith('<!DOCTYPE html>')).toBe(true);
      });
    }
  }
  it('o PDF nunca tem botão, barra, lazy-load nem link para o arquivo de foto', () => {
    for (const [nome, monta] of casos) {
      const h = html(monta(), 'pdf');
      expect(h, nome).not.toContain('Baixar PDF');
      expect(h, nome).not.toContain('class="barra"');
      expect(h, nome).not.toContain('loading="lazy"');
      expect(h, nome).not.toContain('<a href="https://storage.test');
      expect(h, nome).not.toContain('<a class="file"');
    }
  });
});

// ── Hash do PDF ─────────────────────────────────────────────────────────────

describe('hashConteudoPdf', () => {
  const base = (extra: Partial<ConteudoPdf> = {}): ConteudoPdf => ({
    itens: [{ key: 'padrao', obs: 'ok', fotos: [{ url: 'vistorias/u/a/padrao-1.jpg', tipo: 'image', ts: 't1' }] }],
    status_itens: { padrao: 'conforme' },
    assinaturas: {},
    cliente_nome: 'Maria Souza',
    status: 'concluida',
    localizacao: null,
    ...extra,
  });
  const h = (extra: Partial<ConteudoPdf> = {}) => hashConteudoPdf(base(extra));

  it('é estável e tem 16 caracteres hexadecimais', () => {
    expect(h()).toMatch(/^[0-9a-f]{16}$/);
    expect(h()).toBe(h());
  });
  it('marca ausente, nula ou indefinida dá o mesmo hash de antes de existir marca', () => {
    expect(h({ marca: null })).toBe(h());
    expect(h({ marca: undefined })).toBe(h());
  });
  it('mudar o logo, o nome, o CNPJ ou a cor da empresa muda o hash; o mesmo logo, não', () => {
    const m: MarcaEmpresa = { nome: 'Solar Teste', cnpj: '12.345.678/0001-90', logo: LOGO, cor: '#0E6B5C' };
    expect(h({ marca: { ...m } })).toBe(h({ marca: { ...m } }));
    expect(h({ marca: m })).not.toBe(h());
    expect(h({ marca: { ...m, logo: 'data:image/png;base64,AAAA' } })).not.toBe(h({ marca: m }));
    expect(h({ marca: { ...m, logo: null } })).not.toBe(h({ marca: m }));
    expect(h({ marca: { ...m, nome: 'Outra Empresa' } })).not.toBe(h({ marca: m }));
    expect(h({ marca: { ...m, cnpj: '98.765.432/0001-10' } })).not.toBe(h({ marca: m }));
    expect(h({ marca: { ...m, cor: '#F7C531' } })).not.toBe(h({ marca: m }));
  });
  it('o cadastro do cliente que o relatório mostra entra no hash, campo a campo', () => {
    expect(h({ cliente: null })).toBe(h());
    expect(h({ cliente: undefined })).toBe(h());
    expect(h({ cliente: { ...CLIENTE } })).toBe(h({ cliente: { ...CLIENTE } }));
    expect(h({ cliente: CLIENTE })).not.toBe(h());
    for (const campo of ['endereco', 'cep', 'cidade', 'uf', 'concessionaria'] as const) {
      expect(h({ cliente: { ...CLIENTE, [campo]: 'Mudou' } }), campo).not.toBe(h({ cliente: CLIENTE }));
    }
  });
  it('mudar só o ts de uma foto não muda o hash; mudar o caminho, a observação, o status ou o nome muda', () => {
    const foto = (extra: Record<string, unknown>) => [{ key: 'padrao', obs: 'ok', fotos: [{ url: 'vistorias/u/a/padrao-1.jpg', tipo: 'image', ts: 't1', ...extra }] }];
    expect(h({ itens: foto({ ts: 'outro instante' }) })).toBe(h());
    expect(h({ itens: foto({ url: 'vistorias/u/a/padrao-2.jpg' }) })).not.toBe(h());
    expect(h({ itens: [{ key: 'padrao', obs: 'outra', fotos: [] }] })).not.toBe(h());
    expect(h({ status_itens: { padrao: 'atencao' } })).not.toBe(h());
    expect(h({ cliente_nome: 'Outra Pessoa' })).not.toBe(h());
    expect(h({ status: 'em_andamento' })).not.toBe(h());
    expect(h({ localizacao: { lat: 1, lng: 2, link: null, texto: 'x' } })).not.toBe(h());
    expect(h({ assinaturas: { tecnico: { path: 'a/b.png', nome: 'Bruno', registro: 'CFT 1', ts: 'x' } } })).not.toBe(h());
  });
  it('a assinatura só muda o hash pelo caminho, nome e registro (o instante não conta)', () => {
    const t = (ts: string) => ({ tecnico: { path: 'a/b.png', nome: 'Bruno', registro: 'CFT 1', ts } });
    expect(h({ assinaturas: t('x') })).toBe(h({ assinaturas: t('y') }));
  });
  it('lista de compras ausente, nula, oculta ou vazia dá o mesmo hash de "sem lista"', () => {
    const linhas = [lc(1, { item: 'padrao' }), anotacao(1)];
    expect(h({ compras: null })).toBe(h());
    expect(h({ compras: undefined })).toBe(h());
    expect(h({ compras: lista(linhas, false) })).toBe(h());
    expect(h({ compras: lista([]) })).toBe(h());
    expect(h({ compras: comprasVazio() })).toBe(h());
    expect(h({ compras: lista(linhas) })).not.toBe(h());
  });
  it('lista de compras: a mesma lista dá o mesmo hash; id, ts e cid não entram', () => {
    const base = [lc(1, { item: 'padrao', ts: '2026-10-29T14:03:11.000Z', cid: 'caixa-medicao' }), anotacao(1)];
    const referencia = h({ compras: lista(base) });
    const mudar = (extra: Partial<LinhaCompra>) => base.map((l, i) => (i === 0 ? { ...l, ...extra } : l));
    expect(h({ compras: lista(base.map((l) => ({ ...l }))) })).toBe(referencia);
    expect(h({ compras: lista(mudar({ ts: '2026-10-30T09:00:00.000Z' })) })).toBe(referencia);
    expect(h({ compras: lista(mudar({ cid: 'outro-cid' })) })).toBe(referencia);
    expect(h({ compras: lista(mudar({ id: 'outroid99' })) })).toBe(referencia);
    expect(h({ compras: lista(mudar({ ts: undefined, cid: undefined })) })).toBe(referencia);
  });
  it('lista de compras: nome, especificação, quantidade, unidade, quem, item, nota, as linhas e a ordem mudam o hash', () => {
    const base = [lc(1, { item: 'padrao', esp: 'Especificação' }), lc(2)];
    const referencia = h({ compras: lista(base) });
    const mudar = (extra: Partial<LinhaCompra>) => base.map((l, i) => (i === 0 ? { ...l, ...extra } : l));
    const casos: [string, LinhaCompra[]][] = [
      ['nome', mudar({ nome: 'Outro nome' })],
      ['especificação', mudar({ esp: 'Outra' })],
      ['sem especificação', mudar({ esp: undefined })],
      ['quantidade', mudar({ qtd: 2 })],
      ['quantidade a definir', mudar({ qtd: null })],
      ['unidade', mudar({ un: 'm' })],
      ['quem', mudar({ quem: 'integrador' })],
      ['item', mudar({ item: 'telhado' })],
      ['sem item', mudar({ item: undefined })],
      ['nota', mudar({ obs: 'Nota nova.' })],
      ['ordem', [base[1]!, base[0]!]],
      ['linha a mais', [...base, anotacao(1)]],
      ['linha a menos', [base[0]!]],
    ];
    const hashes = new Set<string>([referencia]);
    for (const [campo, linhas] of casos) {
      const outro = h({ compras: lista(linhas) });
      expect(outro, campo).not.toBe(referencia);
      hashes.add(outro);
    }
    expect(hashes.size).toBe(casos.length + 1);
  });
  it('o hash leva da lista só o que o relatório mostra, na ordem gravada', () => {
    const vazio: ConteudoPdf = { itens: [], status_itens: {}, assinaturas: {}, cliente_nome: 'X', status: 'em_andamento', localizacao: null };
    const compras = lista([lc(1, { esp: 'Esp', item: 'padrao', obs: 'N', ts: '2026-10-29T14:03:11.000Z', cid: 'caixa-medicao' }), anotacao(1)]);
    const esperado = createHash('sha1')
      .update(JSON.stringify([
        [], [], [['tecnico', '', '', ''], ['cliente', '', '', '']], 'X', 'em_andamento', null, null, null,
        [['material', 'Material 1', 'Esp', 1, 'un', 'cliente', 'padrao', 'N'], ['obs', '', '', null, '', '', '', 'Anotação 1.']],
        VERSAO_PDF,
      ]))
      .digest('hex').slice(0, 16);
    expect(hashConteudoPdf({ ...vazio, compras })).toBe(esperado);
  });
  it('a versão do desenho do relatório entra no hash', () => {
    const vazio: ConteudoPdf = { itens: [], status_itens: {}, assinaturas: {}, cliente_nome: 'X', status: 'em_andamento', localizacao: null };
    const esperado = (versao: string) => createHash('sha1')
      .update(JSON.stringify([[], [], [['tecnico', '', '', ''], ['cliente', '', '', '']], 'X', 'em_andamento', null, null, null, null, versao]))
      .digest('hex').slice(0, 16);
    expect(hashConteudoPdf(vazio)).toBe(esperado(VERSAO_PDF));
    expect(hashConteudoPdf(vazio)).not.toBe(esperado('v0'));
    expect(VERSAO_PDF).toMatch(/^v\d+$/);
    // v4 é a versão da lista de compras; uma mudança futura do desenho só sobe o número
    expect(Number(VERSAO_PDF.slice(1))).toBeGreaterThanOrEqual(4);
  });
});
