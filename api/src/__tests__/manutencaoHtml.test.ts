import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ATIVIDADES, CHECKLIST, dadosPadrao, type Dados } from '../services/manutencao/relatorio';
import {
  VERSAO_PDF, htmlRelatorio, nomeDoPdf, opcoesPdf, type EntradaRelatorio, type ModoRelatorio,
} from '../services/manutencao/htmlRelatorio';
import { hashMarca, paleta, type MarcaEmpresa } from '../services/relatorio/marca';

// Relatório de manutenção preventiva (HTML da tela e do PDF, rodapé do PDF e nome do PDF) chamado direto, sem banco e sem
// rota. Dados inventados. Aqui ficam a ordem das seções, os números da capa, a inspeção compacta, o que ficou por fazer, a
// leitura da geração, a numeração das fotos, a marca, as datas, as assinaturas e a escala de impressão.

const ID = '22222222-2222-4222-8222-222222222222';
const TRAVESSAO = /[\u{2013}\u{2014}]/u;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const MARCA: MarcaEmpresa = { nome: 'Solar Teste Energia', cnpj: '12.345.678/0001-90', logo: LOGO, cor: '#0E6B5C' };

type Status = 'conforme' | 'atencao' | 'nao_conforme' | 'na' | null;
type Estado = 'concluido' | 'parcial' | 'nao_executado';

// O link "Versão online" lê DASHBOARD_URL: nos testes vale o endereço padrão, sem depender do ambiente da máquina.
let dashboardUrl: string | undefined;
beforeAll(() => { dashboardUrl = process.env.DASHBOARD_URL; delete process.env.DASHBOARD_URL; });
afterAll(() => { if (dashboardUrl === undefined) delete process.env.DASHBOARD_URL; else process.env.DASHBOARD_URL = dashboardUrl; });

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Itens do checklist: o que não está no mapa fica conforme. `textos` traz "o que foi visto" e a providência. */
const itensDe = (mapa: Partial<Record<string, Status>>, textos: Record<string, { visto?: string; providencia?: string }> = {}) =>
  CHECKLIST.map((c) => ({
    key: c.key,
    status: (c.key in mapa ? mapa[c.key] : 'conforme') as Status,
    visto: textos[c.key]?.visto ?? '',
    providencia: textos[c.key]?.providencia ?? '',
  }));

/** Marca como feitas só as atividades do mapa, cada uma com o estado e a observação dadas. */
const atividadesDe = (mapa: Partial<Record<string, [Estado, string?]>>) =>
  ATIVIDADES.map((a) => ({ key: a.key, feita: a.key in mapa, status: mapa[a.key]?.[0] ?? ('concluido' as Estado), obs: mapa[a.key]?.[1] ?? '' }));

let contador = 0;
function foto() {
  contador += 1;
  const caminho = `manutencoes/u/${ID}/foto-${contador}.jpg`;
  return { path: caminho, url: `https://storage.test/${caminho}?token=abc` };
}
const fotosDe = (mapa: Record<string, number>) =>
  Object.fromEntries(Object.entries(mapa).map(([g, q]) => [g, Array.from({ length: q }, foto)]));

function dadosBase(extra: Partial<Dados> = {}): Dados {
  return {
    ...dadosPadrao({ nome: 'Bruno Lima', registro: 'CFT 123' }),
    sistema: { tipo: 'residencial', qtd_modulos: 20, potencia_kwp: 8.2, modulo_modelo: 'Mod 550', inversores: [{ marca: 'Alfa', modelo: 'I-5', serie: 'S123' }], telhado: ['ceramico'], endereco: 'Rua das Flores, 100, Belo Horizonte' },
    itens: itensDe({}),
    ...extra,
  };
}

function monta(dados: Dados, extra: Partial<EntradaRelatorio> = {}, linha: Partial<EntradaRelatorio['linha']> = {}): EntradaRelatorio {
  return {
    linha: { id: ID, codigo: 'MP2026001', cliente_nome: 'Maria Souza', data_inspecao: '2026-10-27', proxima_visita: '2027-04-27', dados, ...linha },
    marca: null,
    fotos: {},
    assinaturas: {},
    ...extra,
  };
}

const ASSINATURAS = {
  tecnico: { url: 'https://storage.test/assinatura-tecnico.png?token=abc', nome: 'Bruno Lima', registro: 'CFT 123', ts: '2026-10-27T17:32:00.000Z' },
  cliente: { url: 'https://storage.test/assinatura-cliente.png?token=abc', nome: 'Maria Souza', ts: '2026-10-27T17:40:00.000Z' },
};

/** M1: concluída, 3 pendências (1 alta e 2 médias), 8 atividades marcadas (4 concluídas, 2 parciais, 2 não executadas), geração 1.320 e 1.087, 14 fotos, marca teal. */
function cheia(): EntradaRelatorio {
  const dados = dadosBase({
    itens: itensDe({ estrutura: 'atencao', cabos: 'nao_conforme', dps: 'atencao', aterramento: 'na' }, {
      modulos: { visto: 'Módulos limpos, sem trincas.' },
      estrutura: { visto: 'Parafusos frouxos em dois trilhos.', providencia: 'Reapertar na próxima visita.' },
      cabos: { visto: 'Cabo ressecado perto do inversor.', providencia: 'Trocar o trecho e refazer os conectores.' },
      dps: { visto: 'Indicador de estado em atenção.' },
      monitoramento: { visto: 'O app abre e a geração aparece.' },
    }),
    atividades: atividadesDe({
      limpeza: ['concluido'], inspecao_visual: ['concluido'], medicao_strings: ['concluido'], verificacao_inversor: ['concluido'],
      reaperto: ['parcial', 'Faltou acesso ao quadro CC.'], teste_aterramento: ['parcial', 'Terra sem leitura confiável.'],
      termografia: ['nao_executado', 'Câmera térmica indisponível.'], verificacao_monitoramento: ['nao_executado', 'Sem rede no local.'],
    }),
    geracao: { esperada_kwh: 1320, medida_kwh: 1087 },
    recomendacoes: 'Lavar os módulos a cada seis meses.',
    observacoes_proxima: 'Levar a câmera térmica.',
  });
  return monta(dados, {
    marca: MARCA,
    concluidaEm: '2026-10-27T17:50:00.000Z',
    fotos: fotosDe({ antes: 3, depois: 3, modulos: 1, estrutura: 2, cabos: 3, dps: 1, inversor: 1 }),
    assinaturas: ASSINATURAS,
  });
}
/** M2: 9 itens conformes, sem foto, sem assinatura, sem marca. */
const minima = () => monta(dadosBase());
/** M3: não conforme, sem assinatura do técnico e sem responsável. */
const semTecnico = () => monta(
  { ...dadosPadrao(), itens: itensDe({ cabos: 'nao_conforme' }, { cabos: { visto: 'Cabo roído.', providencia: 'Trocar.' } }) },
  { assinaturas: { cliente: ASSINATURAS.cliente }, fotos: fotosDe({ cabos: 1 }) },
);
/** M4: marca clara (amarelo), logo pequeno e sem CNPJ. */
const clara = () => ({ ...cheia(), marca: { nome: 'Solar Claro', cnpj: '', logo: LOGO, cor: '#F7C531' } as MarcaEmpresa });
/** M5: texto hostil digitado por gente, com emoji e travessão, em todos os campos. */
const SUJO = `<script>alert(1)</script> "aspas" 'simples' & fim \u{2014} \u{2013} \u{1F600} \u{2600}`;
const hostil = () => monta(
  dadosBase({
    sistema: { tipo: 'residencial', qtd_modulos: 2, potencia_kwp: 1, modulo_modelo: SUJO, inversores: [{ marca: SUJO, modelo: SUJO, serie: SUJO }], telhado: [], endereco: SUJO },
    itens: itensDe({ cabos: 'nao_conforme', dps: 'atencao' }, { cabos: { visto: SUJO, providencia: SUJO }, dps: { visto: SUJO }, modulos: { visto: SUJO } }),
    atividades: atividadesDe({ limpeza: ['concluido', SUJO], reaperto: ['parcial', SUJO] }),
    recomendacoes: SUJO,
    observacoes_proxima: SUJO,
    responsavel: { nome: SUJO, registro: SUJO },
  }),
  {
    marca: { nome: SUJO, cnpj: SUJO, logo: LOGO, cor: null },
    fotos: fotosDe({ cabos: 1 }),
    assinaturas: { tecnico: { url: null, nome: SUJO, registro: SUJO, ts: '2026-10-27T17:32:00.000Z' }, cliente: { url: null, nome: SUJO, ts: '2026-10-27T17:40:00.000Z' } },
  },
  { cliente_nome: SUJO },
);

const html = (e: EntradaRelatorio, modo: ModoRelatorio = 'tela') => htmlRelatorio(e, modo);
const css = (h: string) => h.slice(h.indexOf('<style>') + 7, h.indexOf('</style>'));
const corpo = (h: string) => h.slice(h.indexOf('</style>'));
const contar = (h: string, t: string) => h.split(t).length - 1;
/** Posição do título `h2` da seção: ancora no `<h2>`, porque o mesmo texto aparece em outros lugares. */
const pos = (h: string, titulo: string) => h.indexOf(`<h2>${titulo}</h2>`);
/** A seção inteira, de `<section` até o fecho. */
const secao = (h: string, titulo: string): string => {
  const i = pos(h, titulo);
  if (i < 0) return '';
  return h.slice(h.lastIndexOf('<section', i), h.indexOf('</section>', i) + '</section>'.length);
};
/** Os números das legendas "Foto N", na ordem em que aparecem no HTML. */
const legendas = (h: string) => [...h.matchAll(/<figcaption>Foto (\d+), /g)].map((m) => Number(m[1]));

const luminancia = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a: string, b: string): number => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

// ── Ordem das seções e capa (R21) ───────────────────────────────────────────

describe('ordem das seções e capa', () => {
  const ORDEM = [
    'Pendências e prioridades', 'Recomendações', 'Conclusão', 'Identificação do sistema', 'Inspeção', 'Atividades realizadas',
    'Geração esperada e medida', 'Observações para a próxima visita', 'Assinaturas', 'Anexo fotográfico',
  ];

  it('as seções saem na ordem nova, na tela e no PDF', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html(cheia(), modo);
      const posicoes = ORDEM.map((t) => pos(h, t));
      expect(posicoes.every((p) => p >= 0), modo).toBe(true);
      expect([...posicoes].sort((a, b) => a - b), modo).toEqual(posicoes);
    }
  });
  it('pendências antes da identificação, da inspeção, das assinaturas e do anexo', () => {
    const h = html(cheia());
    expect(pos(h, 'Pendências e prioridades')).toBeLessThan(pos(h, 'Identificação do sistema'));
    expect(pos(h, 'Identificação do sistema')).toBeLessThan(pos(h, 'Inspeção'));
    expect(pos(h, 'Inspeção')).toBeLessThan(pos(h, 'Assinaturas'));
    expect(pos(h, 'Assinaturas')).toBeLessThan(pos(h, 'Anexo fotográfico'));
  });
  it('o resumo vem antes da primeira seção e traz o selo e os números', () => {
    const h = html(cheia());
    expect(h.indexOf('class="resumo"')).toBeGreaterThan(h.indexOf('<h1>'));
    expect(h.indexOf('class="resumo"')).toBeLessThan(pos(h, 'Pendências e prioridades'));
    expect(h).toContain('<p class="tt">Com não conformidades</p>');
  });
  it('mostra "4 de 8" atividades concluídas e a linha "Ficou por fazer 4"', () => {
    const h = corpo(html(cheia()));
    expect(h).toContain('<span>Atividades concluídas</span><b>4 de 8</b>');
    expect(h).toContain('<span>Pendências</span><b>3</b>');
    expect(h).toContain('<span>Ficou por fazer</span><b>4</b>');
    expect(h).toContain('<span>Próxima visita</span><b>27/04/2027</b>');
  });
  it('sem atividade incompleta não há a linha "Ficou por fazer" e o total bate com as marcadas', () => {
    const h = corpo(html(minima()));
    expect(h).toContain('<span>Atividades concluídas</span><b>2 de 2</b>');
    expect(h).not.toContain('Ficou por fazer');
  });
  it('nomeia as pendências na capa, com "e" no último nome', () => {
    const h = html(cheia());
    expect(h).toContain('<p class="destaque">Prioridade alta: Cabos e conectores. Prioridade média: Estrutura e fixação e DPS.</p>');
    expect(h.indexOf('class="destaque"')).toBeLessThan(h.indexOf('<h2>'));
  });
  it('a linha de destaque só tem as partes que existem', () => {
    const soAlta = html(monta(dadosBase({ itens: itensDe({ cabos: 'nao_conforme', dps: 'nao_conforme' }) })));
    expect(soAlta).toContain('<p class="destaque">Prioridade alta: Cabos e conectores e DPS.</p>');
    const soMedia = html(monta(dadosBase({ itens: itensDe({ modulos: 'atencao', estrutura: 'atencao', dps: 'atencao' }) })));
    expect(soMedia).toContain('<p class="destaque">Prioridade média: Módulos, Estrutura e fixação e DPS.</p>');
    expect(html(minima())).not.toContain('class="destaque"');
  });
  it('sem pendência a seção diz isso, sem lista de prioridades', () => {
    const s = secao(html(minima()), 'Pendências e prioridades');
    expect(s).toContain('<p class="vazio">Nenhuma pendência registrada nesta visita.</p>');
    expect(s).not.toContain('class="it pen');
  });
  it('a recomendação vem antes da conclusão e a observação para a próxima visita depois da geração', () => {
    const h = html(cheia());
    expect(pos(h, 'Recomendações')).toBeLessThan(pos(h, 'Conclusão'));
    expect(secao(h, 'Recomendações')).toContain('Lavar os módulos a cada seis meses.');
    expect(secao(h, 'Observações para a próxima visita')).toContain('Levar a câmera térmica.');
  });
  it('a conclusão automática cita as atividades incompletas e a próxima visita segue na seção', () => {
    const s = secao(html(cheia()), 'Conclusão');
    expect(s).toContain('Nesta visita foram registradas 4 atividades de manutenção preventiva no sistema residencial, de 20 módulos e 8,2 kWp.');
    expect(s).toContain('Ficaram incompletas 4 atividades. Veja o motivo em Pendências e prioridades.');
    expect(s).toContain('Recomendamos corrigir esse ponto o quanto antes e combinar uma conferência com a empresa.');
    expect(s).toContain('<b>Próxima visita:</b> 27 de abril de 2027');
    expect(s).toContain('<b>Periodicidade:</b> Semestral');
  });
  it('a conclusão manual vence a automática', () => {
    const e = cheia();
    const dados = { ...(e.linha.dados as Dados), conclusao_manual: 'Texto escrito pelo técnico.' };
    const s = secao(html({ ...e, linha: { ...e.linha, dados } }), 'Conclusão');
    expect(s).toContain('Texto escrito pelo técnico.');
    expect(s).not.toContain('Ficaram incompletas');
  });
});

// ── Inspeção compacta e o que ficou por fazer (R22) ─────────────────────────

describe('inspeção compacta e o que ficou por fazer', () => {
  it('o texto de "O que foi visto" do item com pendência aparece uma vez só', () => {
    const h = html(cheia());
    expect(contar(h, 'Cabo ressecado perto do inversor.')).toBe(1);
    expect(contar(h, 'Trocar o trecho e refazer os conectores.')).toBe(1);
    expect(contar(h, 'Parafusos frouxos em dois trilhos.')).toBe(1);
    expect(secao(h, 'Pendências e prioridades')).toContain('Cabo ressecado perto do inversor.');
    expect(secao(h, 'Inspeção')).not.toContain('Cabo ressecado perto do inversor.');
  });
  it('o item com pendência remete às Pendências e o item sem pendência mostra o próprio texto', () => {
    const s = secao(html(cheia()), 'Inspeção');
    expect(contar(s, 'Detalhe em Pendências e prioridades.')).toBe(3);
    expect(s).toContain('<i>O que foi visto</i>Módulos limpos, sem trincas.');
    expect(s).toContain('O app abre e a geração aparece.');
  });
  it('cada item da inspeção é uma linha: nome, referência das fotos e estado', () => {
    const s = secao(html(cheia()), 'Inspeção');
    expect(contar(s, '<div class="it">')).toBe(CHECKLIST.length);
    expect(s).toContain('<div class="hd"><b>Módulos</b><span class="fotos"><a href="#foto-7">Foto 7</a></span><span class="chip s-conforme">Conforme</span></div>');
    expect(s).toContain('<b>Cabos e conectores</b><span class="fotos"><a href="#foto-10">Fotos 10 a 12</a></span><span class="chip s-nao_conforme">Não conforme</span>');
    expect(s).toContain('<b>Aterramento</b><span class="chip s-na">Não se aplica</span>');
  });
  it('item sem status aparece como "Não avaliado" e item sem texto não ganha bloco de texto', () => {
    const dados = dadosBase({ itens: itensDe({ monitoramento: null }) });
    const s = secao(html(monta(dados)), 'Inspeção');
    expect(s).toContain('<b>Monitoramento</b><span class="chip s-vazio">Não avaliado</span>');
    expect(s).not.toContain('class="tx"');
  });
  it('as atividades realizadas listam só as concluídas', () => {
    const s = secao(html(cheia()), 'Atividades realizadas');
    for (const nome of ['Limpeza dos módulos', 'Inspeção visual', 'Medição das strings', 'Verificação do inversor']) expect(s).toContain(`<b>${nome}</b>`);
    for (const nome of ['Reaperto de conexões', 'Teste do aterramento', 'Termografia', 'Verificação do monitoramento']) expect(s).not.toContain(nome);
    expect(contar(s, 'class="chip a-concluido">Concluído</span>')).toBe(4);
  });
  it('as parciais e as não executadas ficam em "O que ficou por fazer nesta visita", dentro das pendências, com o motivo', () => {
    const h = html(cheia());
    const s = secao(h, 'Pendências e prioridades');
    expect(s).toContain('<h3>O que ficou por fazer nesta visita</h3>');
    expect(s.indexOf('<h3>O que ficou por fazer')).toBeGreaterThan(s.indexOf('class="it pen'));
    expect(s).toContain('<b>Reaperto de conexões</b><span class="chip a-parcial">Parcial</span></div><div class="tx"><i>Motivo</i>Faltou acesso ao quadro CC.</div>');
    expect(s).toContain('<b>Termografia</b><span class="chip a-nao_executado">Não executado</span></div><div class="tx"><i>Motivo</i>Câmera térmica indisponível.</div>');
    expect(s).toContain('Terra sem leitura confiável.');
    expect(s).toContain('Sem rede no local.');
    expect(contar(s, 'class="chip a-parcial"')).toBe(2);
    expect(contar(s, 'class="chip a-nao_executado"')).toBe(2);
    expect(contar(h, 'Faltou acesso ao quadro CC.')).toBe(1);
  });
  it('sem atividade incompleta não há a subseção, e sem pendência ela ainda aparece se houver incompleta', () => {
    expect(html(minima())).not.toContain('O que ficou por fazer');
    const dados = dadosBase({ atividades: atividadesDe({ limpeza: ['concluido'], reaperto: ['nao_executado', 'Sem acesso.'] }) });
    const s = secao(html(monta(dados)), 'Pendências e prioridades');
    expect(s).toContain('Nenhuma pendência registrada nesta visita.');
    expect(s).toContain('<h3>O que ficou por fazer nesta visita</h3>');
  });
  it('sem nenhuma atividade concluída a seção de atividades realizadas some', () => {
    const dados = dadosBase({ atividades: atividadesDe({ reaperto: ['parcial'] }) });
    const h = html(monta(dados));
    expect(h).not.toContain('<h2>Atividades realizadas</h2>');
    expect(corpo(h)).toContain('<span>Atividades concluídas</span><b>0 de 1</b>');
  });
  it('o cartão da pendência traz a prioridade, o que foi visto, a providência e a referência das fotos', () => {
    const s = secao(html(cheia()), 'Pendências e prioridades');
    expect(s).toContain('<div class="it pen alta"><div class="hd"><b>Cabos e conectores</b><span class="chip p-alta">Prioridade alta</span></div><p class="pr">Corrigir o quanto antes.</p>');
    expect(s).toContain('<div class="tx"><i>Providência</i>Trocar o trecho e refazer os conectores.</div><p class="pf"><a href="#foto-10">Fotos 10 a 12</a></p>');
    expect(s).toContain('<b>Estrutura e fixação</b><span class="chip p-media">Prioridade média</span>');
    expect(s).toContain('<p class="pf"><a href="#foto-8">Fotos 8 e 9</a></p>');
  });
});

// ── Geração: leitura (R23) ──────────────────────────────────────────────────

describe('geração', () => {
  const geracao = (esperada: number | null, medida: number | null) => html(monta(dadosBase({ geracao: { esperada_kwh: esperada, medida_kwh: medida } })));

  it('1.320 esperada e 1.087 medida: 18% abaixo da esperada', () => {
    const s = secao(html(cheia()), 'Geração esperada e medida');
    expect(s).toContain('<p class="leitura">A geração medida ficou 18% abaixo da esperada.</p>');
    expect(s).toContain('<span>Esperada</span><b>1.320</b>');
    expect(s).toContain('<span>Medida</span><b>1.087</b>');
    expect(s).toContain('<span>Medida / esperada</span><b>82%</b>');
  });
  it('acima da esperada', () => {
    expect(secao(geracao(1000, 1250), 'Geração esperada e medida')).toContain('A geração medida ficou 25% acima da esperada.');
  });
  it('igual à esperada, inclusive quando a diferença arredonda para zero', () => {
    expect(secao(geracao(1000, 1000), 'Geração esperada e medida')).toContain('A geração medida ficou igual à esperada.');
    expect(secao(geracao(1000, 1003), 'Geração esperada e medida')).toContain('A geração medida ficou igual à esperada.');
  });
  it('esperada zero: os dois números aparecem, sem barra nem frase', () => {
    const s = secao(geracao(0, 500), 'Geração esperada e medida');
    expect(s).toContain('<span>Esperada</span><b>0</b>');
    expect(s).not.toContain('class="leitura"');
    expect(s).not.toContain('Medida / esperada');
  });
  it('sem os dois números a seção não existe', () => {
    expect(geracao(1000, null)).not.toContain('Geração esperada e medida');
    expect(geracao(null, null)).not.toContain('class="gera"');
  });
  it('sem corte de alerta e sem cor de alerta: a mesma frase e o mesmo desenho para 5% e para 60% abaixo', () => {
    const a = secao(geracao(1000, 950), 'Geração esperada e medida');
    const b = secao(geracao(1000, 400), 'Geração esperada e medida');
    expect(a).toContain('ficou 5% abaixo da esperada');
    expect(b).toContain('ficou 60% abaixo da esperada');
    expect(a.replace(/\d+/g, '#')).toBe(b.replace(/\d+/g, '#'));
  });
  it('a barra e os cartões ficam juntos, com a frase, num bloco que não parte', () => {
    const s = secao(html(cheia()), 'Geração esperada e medida');
    expect(s).toMatch(/<div class="keep"><div class="gera">[\s\S]*<div class="barra-g">[\s\S]*<\/div><p class="leitura">/);
    expect(css(html(cheia()))).toMatch(/\.gera\{[^}]*break-inside:avoid/);
  });
});

// ── Fotos: numeração, referência, anexo e foto inteira (R24) ────────────────

describe('fotos', () => {
  it('as legendas vão de 1 a 14, em ordem e sem repetir, na tela e no PDF', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html(cheia(), modo);
      expect(legendas(h), modo).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
      for (let n = 1; n <= 14; n++) expect(contar(h, `<figure id="foto-${n}">`), `foto ${n}`).toBe(1);
    }
  });
  it('a legenda diz o grupo, com o texto de sempre', () => {
    const h = html(cheia());
    expect(h).toContain('<figcaption>Foto 1, Antes da limpeza</figcaption>');
    expect(h).toContain('<figcaption>Foto 4, Depois da limpeza</figcaption>');
    expect(h).toContain('<figcaption>Foto 10, Cabos e conectores</figcaption>');
    expect(h).toContain('<figcaption>Foto 14, Inversor</figcaption>');
  });
  it('as referências dos cartões batem com a numeração das legendas', () => {
    const h = html(cheia());
    const anexo = secao(h, 'Anexo fotográfico');
    const numerosDoGrupo = (grupo: string) => {
      const i = anexo.indexOf(`<h3>${grupo}</h3>`);
      const fim = anexo.indexOf('<h3>', i + 1);
      return [...anexo.slice(i, fim < 0 ? undefined : fim).matchAll(/<figcaption>Foto (\d+), /g)].map((m) => Number(m[1]));
    };
    expect(numerosDoGrupo('Cabos e conectores')).toEqual([10, 11, 12]);
    expect(numerosDoGrupo('Estrutura e fixação')).toEqual([8, 9]);
    expect(numerosDoGrupo('DPS')).toEqual([13]);
    expect(secao(h, 'Pendências e prioridades')).toContain('>Fotos 10 a 12<');
    expect(secao(h, 'Pendências e prioridades')).toContain('>Fotos 8 e 9<');
    expect(secao(h, 'Pendências e prioridades')).toContain('>Foto 13<');
  });
  it('toda referência da tela aponta para uma foto que existe', () => {
    const h = html(cheia());
    const alvos = [...h.matchAll(/href="#foto-(\d+)"/g)].map((m) => m[1]);
    expect(alvos.length).toBeGreaterThanOrEqual(6);
    for (const n of alvos) expect(h, `foto-${n}`).toContain(`id="foto-${n}"`);
  });
  it('a limpeza leva a referência de antes e depois, na tela com link e no PDF só o texto', () => {
    const tela = secao(html(cheia()), 'Atividades realizadas');
    expect(tela).toContain('<p class="pf">Antes: <a href="#foto-1">Fotos 1 a 3</a>. Depois: <a href="#foto-4">Fotos 4 a 6</a>.</p>');
    const pdf = secao(html(cheia(), 'pdf'), 'Atividades realizadas');
    expect(pdf).toContain('<p class="pf">Antes: Fotos 1 a 3. Depois: Fotos 4 a 6.</p>');
    expect(pdf).not.toContain('<a ');
  });
  it('limpeza só com o antes, ou com uma foto, usa o singular', () => {
    const dados = dadosBase();
    const so = (fotos: Record<string, number>) => secao(html(monta(dados, { fotos: fotosDe(fotos) })), 'Atividades realizadas');
    expect(so({ antes: 1 })).toContain('<p class="pf">Antes: <a href="#foto-1">Foto 1</a>.</p>');
    expect(so({ depois: 2 })).toContain('<p class="pf">Depois: <a href="#foto-1">Fotos 1 e 2</a>.</p>');
    expect(so({})).not.toContain('class="pf"');
  });
  it('no PDF a foto não tem link (a URL assinada morre no arquivo guardado) e a tela tem', () => {
    const pdf = html(cheia(), 'pdf');
    expect(pdf).not.toContain('<a href="https://storage.test');
    expect(pdf).not.toContain('<a href="#foto');
    expect(pdf).toContain('<figure id="foto-1"><img src="https://storage.test/');
    const tela = html(cheia());
    expect(tela).toContain('<figure id="foto-1"><a href="https://storage.test/manutencoes/u/');
    expect(tela).toContain('target="_blank" rel="noopener"');
  });
  it('nunca usa carregamento preguiçoso', () => {
    for (const modo of ['tela', 'pdf'] as const) expect(html(cheia(), modo)).not.toContain('loading="lazy"');
  });
  it('foto inteira: sem proporção fixa, altura da regra e object-fit contain', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const c = css(html(cheia(), modo));
      expect(c, modo).not.toContain('aspect-ratio');
      expect(c, modo).toContain('figure img{height:var(--hfoto);width:auto;max-width:100%;object-fit:contain;background:#E9EDF2;');
      expect(c, modo).toContain('.grade{display:flex;flex-wrap:wrap;gap:10px');
    }
    const tela = css(html(cheia()));
    expect(tela).toContain('--hfoto:200px');
    expect(tela).toMatch(/@media \(max-width:640px\)\{\s*:root\{--hfoto:170px\}/);
    expect(tela).toMatch(/@media print\{[\s\S]*--hfoto:56mm/);
    expect(css(html(cheia(), 'pdf'))).toContain(':root{--hfoto:56mm;');
  });
  it('o anexo vem depois das assinaturas, tem id e começa em página nova no PDF', () => {
    const h = html(cheia(), 'pdf');
    expect(h).toContain('<section class="sec anexo" id="anexo"><h2>Anexo fotográfico</h2>');
    expect(pos(h, 'Assinaturas')).toBeLessThan(pos(h, 'Anexo fotográfico'));
    expect(css(h)).toContain('.anexo{break-before:page;page-break-before:always}');
    expect(css(html(cheia()))).toMatch(/@media print\{[\s\S]*\.anexo\{break-before:page/);
  });
  it('no papel as assinaturas ficam mais baixas e presas ao bloco anterior, para nunca ocuparem sozinhas a folha antes do anexo', () => {
    const regras = ['#assinaturas{margin-top:12px;break-before:avoid;page-break-before:avoid}', '#assinaturas h2{margin-bottom:6px}', '.ass .area{height:60px}', '.ass .area img{max-height:54px}', '.ass .rg,.ass .dt{min-height:1.3em;line-height:1.3}'];
    const pdf = css(html(cheia(), 'pdf'));
    for (const r of regras) expect(pdf, r).toContain(r);
    // Na tela a folha de assinatura continua com a altura de sempre; as regras novas só valem dentro do @media print.
    const tela = css(html(cheia()));
    expect(tela).toContain('.ass .area{flex:none;height:92px;');
    expect(tela).toContain('.ass .area img{max-height:86px;');
    expect(tela).toMatch(/@media print\{[\s\S]*#assinaturas\{[^}]*break-before:avoid/);
    expect(tela).toMatch(/@media print\{[\s\S]*\.ass \.area\{height:60px\}/);
    expect(pdf).not.toMatch(/@media print/);
  });
  it('a data da assinatura alinha mesmo com nome longo: as duas colunas esticam e o nome ocupa a sobra', () => {
    const c = css(html(cheia()));
    expect(c).toContain('.ass{display:flex;flex-direction:column}');
    expect(c).toMatch(/\.ass \.nm\{[^}]*min-height:1\.4em;flex:1 1 auto/);
  });
  it('o selo do resumo centraliza o texto quando o painel de números é mais alto que ele', () => {
    expect(css(html(cheia()))).toContain('.resumo .selo{display:flex;flex-direction:column;justify-content:center}');
  });
  it('título do grupo e até 4 fotos ficam juntos; só do quinto em diante o resto vai numa grade à parte', () => {
    const h = html(cheia());
    // Grupo de 3 fotos (Antes da limpeza): as três ficam no mesmo bloco do título, sem grade à parte. Foi o que deixou a
    // "Foto 6" sozinha no topo de uma folha, sem o título do grupo.
    const antes = h.slice(h.indexOf('<h3>Antes da limpeza</h3>'), h.indexOf('<h3>Depois da limpeza</h3>'));
    expect(antes).not.toContain('grade resto');
    expect(contar(antes, '<figure')).toBe(3);
    expect(h).toMatch(/<div class="grp"><div class="keep"><h3>Antes da limpeza<\/h3><div class="grade"><figure id="foto-1">[\s\S]*?<\/figure><figure id="foto-2">[\s\S]*?<\/figure><figure id="foto-3">[\s\S]*?<\/figure><\/div><\/div><\/div>/);
    const dois = h.slice(h.indexOf('<h3>Estrutura e fixação</h3>'), h.indexOf('<h3>Cabos e conectores</h3>'));
    expect(dois).not.toContain('grade resto');
    expect(contar(dois, '<figure')).toBe(2);
    expect(h).not.toContain('class="grade resto"');
  });
  it('grupo com 6 fotos: as 4 primeiras ficam com o título e as 2 últimas seguem numa grade à parte', () => {
    const h = html(monta(dadosBase(), { fotos: fotosDe({ antes: 6 }) }));
    expect(h).toMatch(/<div class="grp"><div class="keep"><h3>Antes da limpeza<\/h3><div class="grade">(<figure id="foto-\d">[\s\S]*?<\/figure>){4}<\/div><\/div><div class="grade resto"><figure id="foto-5">[\s\S]*?<\/figure><figure id="foto-6">/);
  });
  it('foto sem URL assinada não aparece e não gera buraco na numeração', () => {
    const fotos = { cabos: [{ path: 'a.jpg', url: null }, foto(), foto()], dps: [foto()] };
    const h = html(monta(dadosBase({ itens: itensDe({ cabos: 'nao_conforme' }) }), { fotos }));
    expect(legendas(h)).toEqual([1, 2, 3]);
    expect(secao(h, 'Pendências e prioridades')).toContain('>Fotos 1 e 2<');
  });
  it('sem foto não há anexo', () => {
    expect(html(minima())).not.toContain('Anexo fotográfico');
    expect(html(monta(dadosBase(), { fotos: { cabos: [{ path: 'a.jpg', url: null }] } }))).not.toContain('id="anexo"');
  });
});

// ── Marca, datas e assinaturas (R25) ────────────────────────────────────────

describe('marca, datas e assinaturas', () => {
  it('cabeçalho com o logo, o nome e o CNPJ formatado da empresa', () => {
    const h = html(cheia());
    expect(h).toContain(`<img src="${LOGO}" alt="Solar Teste Energia"/>`);
    expect(h).toContain('<b>Solar Teste Energia</b>');
    expect(h).toContain('<span>CNPJ 12.345.678/0001-90</span>');
    expect(h).toContain('<p class="eyebrow">Manutenção preventiva</p>');
  });
  it('sem marca o cabeçalho traz só o título do documento e o código', () => {
    const h = html(minima());
    expect(h).toContain('<div class="emp"><b>Manutenção preventiva</b></div>');
    expect(h).toContain('<b>MP-2026-001</b>');
    expect(h).not.toContain('class="eyebrow"');
    expect(h).not.toContain('CNPJ');
    expect(h).not.toContain('<img src="data:');
  });
  it('marca sem nome mostra só o logo e o CNPJ', () => {
    const h = html({ ...cheia(), marca: { nome: '', cnpj: '12.345.678/0001-90', logo: LOGO, cor: null } });
    expect(h).toContain('<div class="emp"><span>CNPJ 12.345.678/0001-90</span></div>');
  });
  it('logo que não é imagem em data URL é ignorado', () => {
    const h = html({ ...cheia(), marca: { nome: 'Solar X', cnpj: '', logo: 'http://exemplo.test/logo.png', cor: null } });
    expect(h).not.toContain('exemplo.test');
    expect(h).toContain('<b>Solar X</b>');
  });
  it('"Emitido em" vem da conclusão, em horário de Brasília', () => {
    expect(html(cheia())).toContain('<span>Emitido em 27/10/2026</span>');
    expect(html({ ...cheia(), concluidaEm: '2026-10-28T01:30:00.000Z' })).toContain('<span>Emitido em 27/10/2026</span>');
    expect(html({ ...cheia(), concluidaEm: null })).not.toContain('Emitido em');
    expect(html({ ...cheia(), concluidaEm: 'lixo' })).not.toContain('Emitido em');
  });
  it('a data da inspeção e o responsável continuam no cabeçalho', () => {
    const h = html(cheia());
    expect(h).toContain('<span>Inspeção em 27/10/2026</span>');
    expect(h).toContain('<span>Responsável: Bruno Lima, CFT 123</span>');
  });
  it('assinatura com registro e com a data e a hora do ato', () => {
    const h = secao(html(cheia()), 'Assinaturas');
    expect(h).toContain('<p class="nm">Bruno Lima</p><p class="rg">Registro: CFT 123</p><p class="dt">Assinado em 27/10/2026 às 14:32</p><p class="cap">Assinatura do técnico</p>');
    expect(h).toContain('<p class="nm">Maria Souza</p><p class="rg"></p><p class="dt">Assinado em 27/10/2026 às 14:40</p><p class="cap">Assinatura do cliente</p>');
    expect(h).toContain('<img src="https://storage.test/assinatura-tecnico.png?token=abc" alt="Assinatura do técnico"/>');
  });
  it('sem assinatura e sem data, os parágrafos de registro e data ficam vazios para alinhar as colunas', () => {
    const h = secao(html(minima()), 'Assinaturas');
    expect(h).toContain('<p class="nm">Bruno Lima</p><p class="rg">Registro: CFT 123</p><p class="dt"></p>');
    expect(h).toContain('<p class="nm">Maria Souza</p><p class="rg"></p><p class="dt"></p>');
    expect(h).not.toContain('Assinado em');
    expect(h).not.toContain('Sem assinatura');
  });
  it('registro e data ocupam sempre a altura de uma linha, para as duas colunas ficarem alinhadas', () => {
    expect(css(html(cheia()))).toMatch(/\.ass \.rg,\.ass \.dt\{[^}]*min-height:1\.5em/);
  });
  it('sem desenho nem nome o bloco diz "Sem assinatura" em cinza no lugar das linhas vazias', () => {
    const h = secao(html(semTecnico()), 'Assinaturas');
    expect(contar(h, 'Sem assinatura')).toBe(1);
    expect(h).toContain('<p class="nm sem">Sem assinatura</p><p class="rg"></p><p class="dt"></p><p class="cap">Assinatura do técnico</p>');
    expect(h).toContain('<p class="nm">Maria Souza</p>');
    expect(css(html(semTecnico()))).toMatch(/\.ass \.nm\.sem\{[^}]*color:var\(--mut\)/);
  });
  it('sem nenhum nome e sem desenho os dois blocos dizem "Sem assinatura"', () => {
    const e = monta({ ...dadosPadrao(), itens: itensDe({}) }, {}, { cliente_nome: null });
    const h = secao(html(e), 'Assinaturas');
    expect(contar(h, '<p class="nm sem">Sem assinatura</p>')).toBe(2);
  });
  it('assinatura registrada sem desenho mostra o nome e a data, não "Sem assinatura"', () => {
    const e = monta(dadosBase(), { assinaturas: { tecnico: { url: null, nome: 'Bruno Lima', registro: 'CFT 123', ts: '2026-10-27T17:32:00.000Z' } } });
    const h = secao(html(e), 'Assinaturas');
    expect(h).toContain('Assinado em 27/10/2026 às 14:32');
    expect(h).not.toContain('Sem assinatura');
  });
  it('o eyebrow e o h3 usam a cor escura da marca, com contraste de 4,5 para 1 mesmo em cores problemáticas', () => {
    for (const cor of ['#0E6B5C', '#F7C531', '#1d6fb8', '#ffffff', '#000000', null]) {
      const h = html({ ...cheia(), marca: { nome: 'X', cnpj: '', logo: null, cor } });
      const c = css(h);
      expect(c, String(cor)).toMatch(/\.eyebrow\{[^}]*color:var\(--c1\)/);
      expect(c, String(cor)).toMatch(/\nh3\{[^}]*color:var\(--c1\)/);
      expect(c, String(cor)).not.toMatch(/color:var\(--c2\)/);
      expect(contraste(paleta(cor).c1, '#ffffff'), String(cor)).toBeGreaterThanOrEqual(4.5);
      expect(c, String(cor)).toContain(`--c1:${paleta(cor).c1}`);
    }
  });
  it('o contato da empresa (WhatsApp, endereço) não sai, mesmo vindo na marca', () => {
    const marca = { ...MARCA, contato: { whatsapp: '31999990000', endereco: 'Rua Secreta, 1', cidade: 'Belo Horizonte' } } as MarcaEmpresa;
    for (const modo of ['tela', 'pdf'] as const) {
      const h = html({ ...cheia(), marca }, modo);
      expect(h, modo).not.toContain('31999990000');
      expect(h, modo).not.toContain('99999-0000');
      expect(h, modo).not.toContain('Rua Secreta');
      expect(h, modo).not.toContain('WhatsApp');
    }
  });
});

// ── PDF, escala, metadados e nome do arquivo (R26, R27) ─────────────────────

describe('PDF e metadados', () => {
  it('a versão do desenho é v3', () => {
    expect(VERSAO_PDF).toBe('v3');
  });
  it('o nome do arquivo leva a versão, o instante e 8 caracteres do hash da marca', () => {
    const n = nomeDoPdf(1793379714119, MARCA);
    expect(n).toMatch(/^relatorio-v3-1793379714119-[0-9a-f]{8}\.pdf$/);
    expect(n).toContain(hashMarca(MARCA).slice(0, 8));
  });
  it('sem marca o hash é 00000000', () => {
    expect(nomeDoPdf(10, null)).toBe('relatorio-v3-10-00000000.pdf');
  });
  it('trocar nome, logo, CNPJ ou cor da empresa, ou o instante, gera outro nome; o mesmo conteúdo, o mesmo nome', () => {
    const base = nomeDoPdf(10, MARCA);
    expect(nomeDoPdf(10, { ...MARCA })).toBe(base);
    expect(nomeDoPdf(10, { ...MARCA, nome: 'Outro Nome' })).not.toBe(base);
    expect(nomeDoPdf(10, { ...MARCA, logo: 'data:image/png;base64,AAAA' })).not.toBe(base);
    expect(nomeDoPdf(10, { ...MARCA, cnpj: '00.000.000/0001-00' })).not.toBe(base);
    expect(nomeDoPdf(10, { ...MARCA, cor: '#112233' })).not.toBe(base);
    expect(nomeDoPdf(11, MARCA)).not.toBe(base);
  });

  it('rodapé: empresa, código do relatório, cliente e "Página X de Y"', () => {
    const o = opcoesPdf('MP2026001', { marcaNome: 'Solar Teste Energia', cliente: 'Maria Souza' });
    expect(o.format).toBe('A4');
    expect(o.printBackground).toBe(true);
    expect(o.preferCSSPageSize).toBe(true);
    expect(o.displayHeaderFooter).toBe(true);
    expect(o.footerTemplate).toContain('Solar Teste Energia · MP-2026-001 · Maria Souza');
    expect(o.footerTemplate).toContain('class="pageNumber"');
    expect(o.footerTemplate).toContain('class="totalPages"');
    expect(o.footerTemplate).toContain('font-size:10.5px');
    expect(o.footerTemplate).toContain('padding:0 16mm');
  });
  it('sem empresa nem cliente só o código; nomes longos são cortados com reticências', () => {
    expect(opcoesPdf('MP2026001').footerTemplate).toContain('>MP-2026-001</span>');
    expect(opcoesPdf(null).footerTemplate).not.toContain('MP-');
    const longo = opcoesPdf('MP2026001', { marcaNome: 'E'.repeat(40), cliente: 'C'.repeat(50) }).footerTemplate;
    expect(longo).toContain(`${'E'.repeat(27)}… · MP-2026-001 · ${'C'.repeat(35)}…`);
  });
  it('os textos do rodapé entram escapados, sem emoji e sem travessão', () => {
    const f = opcoesPdf('MP2026001', { marcaNome: 'A&B <x>', cliente: `Zé "Z" \u{2014} \u{1F600}` }).footerTemplate;
    expect(f).toContain('A&amp;B &lt;x&gt; · MP-2026-001 · Zé &quot;Z&quot; -');
    expect(f).not.toContain('<x>');
    expect(f).not.toMatch(TRAVESSAO);
    expect(f).not.toMatch(EMOJI);
  });

  it('a margem do @page é a mesma do rodapé, na tela e no PDF', () => {
    for (const modo of ['tela', 'pdf'] as const) expect(html(cheia(), modo)).toContain('@page{size:A4;margin:14mm 16mm 18mm}');
  });
  it('escala de impressão: 13,4 px de base, títulos de .98rem e o rodapé da tela escondido', () => {
    const pdf = css(html(cheia(), 'pdf'));
    expect(pdf).toContain('html{font-size:13.4px}');
    expect(pdf).toContain('h2{font-size:.98rem}');
    expect(pdf).toMatch(/\.barra,\.rod\{display:none\}/);
    const tela = css(html(cheia()));
    expect(tela).toContain('html{font-size:15px;');
    expect(tela).toMatch(/@media print\{\s*html\{font-size:13\.4px\}/);
  });
  it('nenhum texto desce de 8 pt na impressão: todo font-size vale pelo menos .8rem ou 10,7 px', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const c = css(html(cheia(), modo));
      const tamanhos = [...c.matchAll(/font-size:([\d.]+)(rem|px)/g)].map((m) => ({ v: Number(m[1]), un: m[2] as 'rem' | 'px' }));
      expect(tamanhos.length).toBeGreaterThan(20);
      for (const t of tamanhos) {
        const px = t.un === 'rem' ? t.v * 13.4 : t.v;
        expect(px, `${t.v}${t.un}`).toBeGreaterThanOrEqual(10.66);
      }
      expect(c, modo).not.toMatch(/font-size:[\d.]+(em|%|pt)\b/);
    }
  });
  it('rótulos em caixa-alta e dt com pelo menos .72rem', () => {
    const c = css(html(cheia()));
    for (const seletor of ['\\.kv dt', '\\.num span', '\\.gera span', '\\.ass \\.cap', '\\.it \\.tx i', '\\.eyebrow']) {
      const m = new RegExp(`${seletor}\\{[^}]*font-size:([\\d.]+)rem`).exec(c);
      expect(m, seletor).not.toBeNull();
      expect(Number(m![1]), seletor).toBeGreaterThanOrEqual(0.72);
    }
  });
  it('quebras de página: cartões, resumo, conclusão, assinaturas, geração e fotos não partem; h2 e h3 não terminam a página', () => {
    for (const modo of ['tela', 'pdf'] as const) {
      const c = css(html(cheia(), modo));
      for (const seletor of ['\\.keep', 'figure', '\\.it', '\\.selo', '\\.resumo', '\\.concl', '\\.assin', '\\.gera']) {
        expect(c, `${modo} ${seletor}`).toMatch(new RegExp(`(^|\\n)${seletor}\\{[^}]*break-inside:avoid`));
      }
      expect(c, modo).toMatch(/\nh2\{[^}]*break-after:avoid/);
      expect(c, modo).toMatch(/\nh3\{[^}]*break-after:avoid/);
    }
  });

  it('o PDF traz a versão online logo abaixo do cliente, na primeira folha, e sem rodapé de tela; a tela tem o rodapé e a barra', () => {
    const pdf = html(cheia(), 'pdf');
    expect(pdf).toContain(`<p class="online">Versão online deste relatório: <a href="https://solardoc.app/m/${ID}">https://solardoc.app/m/${ID}</a></p>`);
    expect(pdf).not.toContain('<footer');
    expect(pdf).not.toContain('Baixar PDF');
    expect(pdf).not.toContain('class="barra"');
    const tela = html(cheia());
    expect(tela).toContain('<footer class="rod">Relatório de manutenção preventiva gerado pela SolarDoc.</footer>');
    expect(tela).toContain(`<a href="/m/${ID}/pdf">Baixar PDF</a>`);
    expect(tela).not.toContain('class="online"');
  });
  it('a versão online fica entre o cliente e o resumo, aparece uma vez só e nunca é o último bloco do corpo (não nasce folha só com o link)', () => {
    for (const e of [cheia(), minima(), semTecnico(), clara(), hostil()]) {
      const pdf = html(e, 'pdf');
      expect(contar(pdf, 'class="online"')).toBe(1);
      const i = pdf.indexOf('class="online"');
      expect(i).toBeGreaterThan(pdf.indexOf('<h1>'));
      expect(i).toBeLessThan(pdf.indexOf('class="resumo"'));
      // Depois dele vêm o resumo, as seções e as assinaturas: nada de bloco só com a linha no fim do documento.
      expect(pdf.indexOf('</main>') - i).toBeGreaterThan(1500);
      expect(pdf.slice(pdf.lastIndexOf('</section>'), pdf.indexOf('</main>'))).not.toContain('online');
    }
    // Sem cliente, a linha vem logo depois do título.
    const semCliente = html(monta(dadosBase(), {}, { cliente_nome: '' }), 'pdf');
    expect(semCliente.indexOf('class="online"')).toBeGreaterThan(semCliente.indexOf('<h1>'));
    expect(semCliente.indexOf('class="online"')).toBeLessThan(semCliente.indexOf('class="resumo"'));
  });
  it('a linha da versão online não leva filete nem margem de rodapé (é uma linha de cabeçalho)', () => {
    const c = css(html(cheia(), 'pdf'));
    expect(c).toContain('.online{margin:6px 0 0;font-size:.8rem;color:var(--mut);overflow-wrap:anywhere}');
    expect(c).not.toMatch(/\.online\{[^}]*border-top/);
  });
  it('a versão online usa o endereço do painel quando ele está configurado', () => {
    process.env.DASHBOARD_URL = 'https://painel.exemplo.test/';
    try {
      expect(html(cheia(), 'pdf')).toContain(`<a href="https://painel.exemplo.test/m/${ID}">`);
    } finally {
      delete process.env.DASHBOARD_URL;
    }
  });
  it('o modo padrão é a tela', () => {
    const e = cheia();
    expect(htmlRelatorio(e)).toBe(html(e, 'tela'));
    expect(htmlRelatorio(e)).toContain('class="barra"');
  });

  it('título e prévia do WhatsApp: og:title igual ao título, descrição com cliente e empresa, tipo artigo', () => {
    const h = html(cheia());
    expect(h).toContain('<title>Manutenção preventiva MP-2026-001 · Maria Souza</title>');
    expect(h).toContain('<meta property="og:title" content="Manutenção preventiva MP-2026-001 · Maria Souza"/>');
    expect(h).toContain('<meta property="og:description" content="Relatório de manutenção preventiva de Maria Souza, por Solar Teste Energia."/>');
    expect(h).toContain('<meta property="og:type" content="article"/>');
    expect(h).toContain('<meta name="robots" content="noindex,nofollow"/>');
  });
  it('sem cliente e sem marca a descrição fica curta', () => {
    const h = html(monta(dadosBase(), {}, { cliente_nome: null, codigo: null }));
    expect(h).toContain('<title>Manutenção preventiva</title>');
    expect(h).toContain('content="Relatório de manutenção preventiva."');
    expect(h).not.toContain('<p class="cli">');
  });
});

// ── Texto digitado por gente e matriz de casos ──────────────────────────────

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

describe('matriz de casos (tela e PDF)', () => {
  const casos: [string, () => EntradaRelatorio][] = [
    ['cheia', cheia], ['mínima', minima], ['sem técnico', semTecnico], ['marca clara', clara], ['texto hostil', hostil],
  ];
  for (const [nome, monta2] of casos) {
    for (const modo of ['tela', 'pdf'] as const) {
      it(`${nome}, ${modo}: sem travessão, sem emoji, sem tema escuro, com @page`, () => {
        const h = html(monta2(), modo);
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
    for (const [nome, monta2] of casos) {
      const h = html(monta2(), 'pdf');
      expect(h, nome).not.toContain('Baixar PDF');
      expect(h, nome).not.toContain('class="barra"');
      expect(h, nome).not.toContain('loading="lazy"');
      expect(h, nome).not.toContain('<a href="https://storage.test');
    }
  });
  it('a entrada com dados vazios ou fora de ordem não derruba o relatório', () => {
    const e = monta({} as Dados);
    const h = html({ ...e, linha: { ...e.linha, dados: null } });
    expect(h).toContain('Relatório de manutenção preventiva');
    expect(h).toContain('<span>Atividades concluídas</span><b>2 de 2</b>');
  });
});
