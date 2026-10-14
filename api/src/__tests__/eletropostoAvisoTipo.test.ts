import { describe, it, expect, vi } from 'vitest';

// O AVISO INTERNO DOS TRÊS TIPOS DO CARD (13/10/2026). Cotista, arrendamento e
// integrador saíam como "SEM NOTA, ficha antiga", todos de traços. Cada um tem agora
// o seu card, com o texto do redator, e a regra de ouro: campo vazio some com a
// LINHA INTEIRA (nunca traço). Sem `tipo`, o aviso de sempre não muda.
vi.mock('../utils/supabase', () => ({ supabase: {} }));
vi.mock('../utils/supabaseGerador', () => ({ supabaseGerador: {} }));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/agents/zapiClient', () => ({ sendWhatsApp: vi.fn() }));
vi.mock('../services/agenda/solarOcupacao', () => ({ ocupacoesSolar: vi.fn() }));
vi.mock('../services/io/eletropostoEstudoGarantir', () => ({ extraDoCard: vi.fn(), garantirEstudo: vi.fn() }));
vi.mock('../services/io/eletropostoPares', () => ({
  blocoParesSeguro: vi.fn(), pool: vi.fn(), montarPares: vi.fn(), MAX_PARES: 3, TETO_KM: 100,
}));
vi.mock('../services/io/eletropostoGeo', () => ({ geocodificarLote: vi.fn() }));
vi.mock('../middleware/rateLimiter', () => ({ geoLimiter: (_q: unknown, _r: unknown, n: () => void) => n(), funilEletropostoLimiter: (_q: unknown, _r: unknown, n: () => void) => n() }));

import { montarAvisoDoTipo, ehTipoDoAviso } from '../services/io/eletropostoAvisoTipo';
import { montarMensagem } from '../routes/ioEletroposto';

const BASE = {
  nome: 'Carlos Lima', telefone: '5534991113333', cidade: 'Uberlândia',
  quando: 'ter., 14/10, 10:00', consultor: 'Thiago',
};
const RODAPE = '_Reunião por vídeo. O lead foi avisado só de que você chama pelo WhatsApp dele. Quem manda o link é você, o robô não manda._\n'
  + '_Veja no CRM: solardoc.app/gerador_';

describe('cotista (INVESTIDOR)', () => {
  const obs = [
    'LP ELETROPOSTO · Investidor', 'INVESTIDOR SEM LOCAL', 'Local: Não tenho local', 'Quanto pretende investir: R$ 140 mil',
  ].join('\n');

  it('a ficha nova (sem pagamento nem decisor): o bloco vazio some com a linha em branco dele', () => {
    expect(montarAvisoDoTipo('cotista', { ...BASE, observacao: obs })).toBe([
      '💰 *NOVA REUNIÃO · INVESTIDOR*',
      '*Investimento: R$ 140 mil*',
      '',
      '*Quando:* ter., 14/10, 10:00',
      '*Com:* Thiago',
      '',
      '*Cliente:* Carlos Lima',
      '*WhatsApp:* wa.me/5534991113333',
      '*Cidade:* Uberlândia',
      '',
      RODAPE,
    ].join('\n'));
  });

  it('a ficha da trilha do ponto traz como paga e o decisor', () => {
    const o = obs + '\nComo pretende investir: Capital próprio\nDecisor: Eu mesmo';
    const m = montarAvisoDoTipo('cotista', { ...BASE, observacao: o });
    expect(m).toContain('*Como pretende pagar:* Capital próprio\n*Decisor:* Eu mesmo\n\n_Reunião por vídeo.');
    expect(m).not.toContain('SEM NOTA');
  });

  it('sem valor, a linha do investimento some (nada de traço)', () => {
    const m = montarAvisoDoTipo('cotista', { ...BASE, observacao: 'LP ELETROPOSTO · Investidor' });
    expect(m.split('\n')[0]).toBe('💰 *NOVA REUNIÃO · INVESTIDOR*');
    expect(m.split('\n')[1]).toBe('');
    expect(m).not.toContain('Investimento');
  });
});

describe('arrendamento', () => {
  const obs = [
    'LP ELETROPOSTO · Posto', 'Ponto: Definido', 'Endereço: Rua A, 10 · Centro · Uberlândia',
    'Local é seu: Sou o dono', 'Como pretende investir: Não sei', 'Decisor: Eu',
  ].join('\n');

  it('o card completo', () => {
    expect(montarAvisoDoTipo('arrendamento', { ...BASE, observacao: obs })).toBe([
      '📍 *NOVA REUNIÃO · ARRENDAMENTO*',
      '*Cede o espaço em vez de investir*',
      '',
      '*Quando:* ter., 14/10, 10:00',
      '*Com:* Thiago',
      '',
      '*Cliente:* Carlos Lima',
      '*WhatsApp:* wa.me/5534991113333',
      '*Cidade:* Uberlândia',
      '*Endereço:* Rua A, 10 · Centro · Uberlândia',
      '',
      '*Relação com o local:* Sou o dono',
      '',
      RODAPE,
    ].join('\n'));
  });

  it('sem endereço nem relação, as linhas e o bloco somem', () => {
    const m = montarAvisoDoTipo('arrendamento', { ...BASE, observacao: 'LP ELETROPOSTO · Posto' });
    expect(m).not.toContain('Endereço');
    expect(m).not.toContain('Relação com o local');
    expect(m).not.toMatch(/\n\n\n/);
  });
});

describe('parceiro integrador', () => {
  const obs = [
    'LP ELETROPOSTO · Integrador', 'Empresa: Voltz Energia', 'CNPJ: 12.345.678/0001-90',
    'O que faz: Instalação de carregadores', 'Já instalou carregador: Sim', 'Como quer trabalhar: Revendendo', 'Equipe: 4',
  ].join('\n');

  it('o card completo', () => {
    expect(montarAvisoDoTipo('integrador', { ...BASE, observacao: obs })).toBe([
      '🤝 *NOVA REUNIÃO · PARCEIRO INTEGRADOR*',
      '*Voltz Energia*',
      '',
      '*Quando:* ter., 14/10, 10:00',
      '*Com:* Thiago',
      '',
      '*Cliente:* Carlos Lima',
      '*WhatsApp:* wa.me/5534991113333',
      '*Cidade:* Uberlândia',
      '',
      '*O que faz:* Instalação de carregadores',
      '*Como quer trabalhar:* Revendendo',
      '',
      RODAPE,
    ].join('\n'));
  });

  it('sem empresa a linha do nome some, e a cidade vazia também', () => {
    const m = montarAvisoDoTipo('integrador', { ...BASE, cidade: '  ', observacao: 'LP ELETROPOSTO · Integrador\nO que faz: Obra' });
    expect(m.split('\n').slice(0, 3)).toEqual(['🤝 *NOVA REUNIÃO · PARCEIRO INTEGRADOR*', '', '*Quando:* ter., 14/10, 10:00']);
    expect(m).not.toContain('Cidade');
    expect(m).not.toContain('Como quer trabalhar');
  });
});

describe('nunca imprime traço', () => {
  it('nenhum dos três tipos, com a ficha vazia, deixa um travessão no aviso', () => {
    for (const tipo of ['cotista', 'arrendamento', 'integrador'] as const) {
      const m = montarAvisoDoTipo(tipo, { ...BASE, cidade: null, consultor: null, observacao: null });
      expect(m, tipo).not.toMatch(/[—–]|:\*\s*-\s*$/m);
      expect(m, tipo).not.toMatch(/\n\n\n/);
    }
  });

  it('valor que veio como "—" na ficha vale como vazio', () => {
    const m = montarAvisoDoTipo('cotista', { ...BASE, observacao: 'Quanto pretende investir: —\nDecisor: —' });
    expect(m).not.toContain('—');
    expect(m).not.toContain('Decisor');
  });
});

describe('montarMensagem: o card do tipo só serve a ficha SEM nota', () => {
  const base = {
    quando: '2026-10-14T13:00:00.000Z', vendedor_nome: 'Thiago', cliente_nome: 'Carlos Lima',
    cliente_telefone: '5534991113333', cidade: 'Uberlândia',
  };
  const semLocal = { ...base, observacao: 'LP ELETROPOSTO · Investidor\nINVESTIDOR SEM LOCAL\nLocal: Não tenho local\nQuanto pretende investir: R$ 140 mil' };
  const integrador = { ...base, observacao: 'LP ELETROPOSTO · Integrador\nEmpresa: Voltz Energia\nO que faz: Instalação\nComo quer trabalhar: Revendendo' };
  // Investidor COM local: a trilha do ponto, com nota, endereço, local, vagas, modelo e simulação.
  const comLocal = {
    ...base,
    observacao: [
      'LP ELETROPOSTO · Posto', 'NOTA 3 · 10/11 pts', 'Ponto: Definido', 'Endereço: Rua A, 10 · Centro · Uberlândia',
      'Local é seu: Sou o dono', 'Vagas disponíveis: 6', 'Modelo de interesse: 100% nosso',
      'Como pretende investir: Capital próprio', 'Quanto pretende investir: R$ 300 mil', 'Decisor: Eu mesmo',
      'Simulou: sim', 'Investimento estimado: R$ 250.000', '→ Resultado bom',
    ].join('\n'),
  };
  const arrendComNota = { ...comLocal, observacao: comLocal.observacao.replace('NOTA 3 · 10/11 pts', 'NOTA 2 · 9/11 pts') };
  const extra = { estudoUrl: 'https://solardoc.app/estudo/abc', preNota: 72 };

  it('investidor sem local: card do tipo (nada de SEM NOTA)', () => {
    const m = montarMensagem(semLocal, { tipo: 'cotista' });
    expect(m.startsWith('💰 *NOVA REUNIÃO · INVESTIDOR*\n*Investimento: R$ 140 mil*')).toBe(true);
    expect(m).toContain('*Com:* Thiago');
    expect(m).not.toContain('SEM NOTA');
  });

  it('integrador: card do tipo', () => {
    const m = montarMensagem(integrador, { tipo: 'integrador' });
    expect(m.startsWith('🤝 *NOVA REUNIÃO · PARCEIRO INTEGRADOR*\n*Voltz Energia*')).toBe(true);
    expect(m).not.toContain('SEM NOTA');
  });

  for (const [nome, ficha, tipo, rotulo] of [
    ['investidor COM local', comLocal, 'cotista', 'Investidor'],
    ['arrendamento da trilha do ponto', arrendComNota, 'arrendamento', 'Arrendamento'],
  ] as const) {
    it(`${nome} (tem nota): aviso completo de hoje, com a linha do tipo e sem perder nada`, () => {
      const m = montarMensagem(ficha, { tipo, ...extra });
      expect(m.split('\n').slice(0, 2)).toEqual(['*NOVA REUNIÃO — ELETROPOSTO*', `*Tipo:* ${rotulo}`]);
      expect(m).toContain('NOTA ');
      expect(m).toContain('*Endereço:* Rua A, 10 · Centro · Uberlândia');
      expect(m).toContain('*Pré-nota do local:* 72 de 100');
      expect(m).toContain('*Estudo do local:* https://solardoc.app/estudo/abc');
      expect(m).toContain('*Vagas:* 6');
      expect(m).toContain('*Modelo:* 100% nosso');
      expect(m).toContain('*Investimento estimado:* R$ 250.000');
      expect(m).not.toContain('💰');
      // tirada a linha do tipo, é, caractere por caractere, o aviso de hoje
      const semTipo = montarMensagem(ficha, { ...extra });
      expect(m.replace(`*Tipo:* ${rotulo}\n`, '')).toBe(semTipo);
    });
  }

  it('ficha sem tipo, ou com tipo que não é dos três: o aviso de hoje, idêntico', () => {
    for (const ficha of [semLocal, integrador, comLocal]) {
      const hoje = montarMensagem(ficha, { ...extra });
      for (const tipo of [undefined, null, '', 'carregador', 'qualquer']) {
        expect(montarMensagem(ficha, { tipo, ...extra }), String(tipo)).toBe(hoje);
      }
      expect(montarMensagem(ficha)).toBe(montarMensagem(ficha, { tipo: null }));
      expect(hoje).not.toContain('*Tipo:*');
    }
    expect(montarMensagem(semLocal)).toContain('SEM NOTA');
  });

  it('ehTipoDoAviso é a lista fechada dos três', () => {
    expect(['cotista', 'arrendamento', 'integrador'].every(ehTipoDoAviso)).toBe(true);
    expect([ehTipoDoAviso('carregador'), ehTipoDoAviso(''), ehTipoDoAviso(null), ehTipoDoAviso(3)]).toEqual([false, false, false, false]);
  });
});
