import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Marca do integrador nos relatórios: paleta, logo, CNPJ, telefone, hash do PDF e leitura da
// tabela `company` contra o banco falso. Dados inventados, nada sai para a rede.

vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('../utils/supabase', async () => ({ supabase: (await import('./_bancoFalso')).supabase }));

import { banco } from './_bancoFalso';
import { supabase } from '../utils/supabase';
import { logger } from '../utils/logger';
import {
  COLUNAS_MARCA, MOSTRAR_CONTATO_EMPRESA, cnpjParaRelatorio, hashMarca, logoSeguro, marcaDeLinha, paleta,
  telefoneFormatado, type MarcaEmpresa,
} from '../services/relatorio/marca';
import { lerMarca } from '../services/relatorio/marcaDb';

const LOGO = 'data:image/png;base64,iVBORw0KGgo=';
const CNPJ_CRU = '11222333000181';
const CNPJ_BONITO = '11.222.333/0001-81';
const PADRAO = { c1: '#0B2545', c2: '#2C4A73', c3: '#EEF2F8', ac: '#C9A227' };

// Contraste do texto branco sobre a cor (WCAG): 1,05 / (luminância + 0,05).
const canal = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
const luminancia = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
};
const contrasteComBranco = (hex: string) => 1.05 / (luminancia(hex) + 0.05);

// Sorteio com semente fixa: o teste não pode mudar de resultado de uma rodada para outra.
function sorteio(semente: number) {
  let s = semente >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const linhaOk = (extra: Record<string, unknown> = {}) => ({
  user_id: 'u1', nome: 'Solar Teste Ltda', nome_fantasia: 'Solar Teste', cnpj: CNPJ_CRU, logo_base64: LOGO, cor_marca: '#0E6B5C',
  whatsapp: '31999990000', endereco: 'Rua das Palmeiras, 100', cidade: 'Belo Horizonte', ...extra,
});

describe('paleta', () => {
  it('cor inválida ou ausente devolve a paleta padrão', () => {
    for (const ruim of ['', '   ', null, undefined, 'xyz', '#12345', '#1234567', '#GGGGGG', 123, {}]) {
      expect(paleta(ruim), String(ruim)).toEqual(PADRAO);
    }
  });
  it('o texto branco sobre c1 tem contraste de 4,5 ou mais para 200 cores sorteadas', () => {
    const sorteia = sorteio(20261029);
    for (let i = 0; i < 200; i++) {
      const cor = '#' + Math.floor(sorteia() * 0x1000000).toString(16).padStart(6, '0');
      const { c1 } = paleta(cor);
      expect(contrasteComBranco(c1), `${cor} -> ${c1}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('o texto branco sobre c1 tem contraste de 4,5 ou mais nas cores de borda e nas cores de teste do relatório', () => {
    for (const cor of ['#ffffff', '#000000', '#F7C531', '#0E6B5C', '#1d6fb8', '#ffff00', '#00ff00']) {
      expect(contrasteComBranco(paleta(cor).c1), cor).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('o destaque é a cor da marca como veio, em minúscula, com ou sem #', () => {
    expect(paleta('#0E6B5C').ac).toBe('#0e6b5c');
    expect(paleta('0E6B5C').ac).toBe('#0e6b5c');
    expect(paleta(' #F7C531 ').ac).toBe('#f7c531');
  });
  it('cor que já é escura não muda; cor clara escurece', () => {
    expect(paleta('#000000').c1).toBe('#000000');
    expect(paleta('#0E6B5C').c1).toBe('#0e6b5c');
    expect(paleta('#F7C531').c1).not.toBe('#f7c531');
    expect(luminancia(paleta('#F7C531').c1)).toBeLessThan(luminancia('#f7c531'));
  });
  it('mantém os valores que a manutenção já entregava (a função foi copiada sem mudar)', () => {
    expect(paleta('#0E6B5C')).toEqual({ c1: '#0e6b5c', c2: '#438c80', c3: '#eef5f4', ac: '#0e6b5c' });
    expect(paleta('#F7C531')).toEqual({ c1: '#83691a', c2: '#9e8a4c', c3: '#f6f4ef', ac: '#f7c531' });
    expect(paleta('#1d6fb8')).toEqual({ c1: '#1d6fb8', c2: '#4f8fc8', c3: '#eff5fa', ac: '#1d6fb8' });
  });
});

describe('logoSeguro', () => {
  it('aceita imagem em data URL base64 (png, jpg, jpeg, webp e gif)', () => {
    for (const tipo of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
      const l = `data:image/${tipo};base64,iVBORw0KGgo=`;
      expect(logoSeguro(l), tipo).toBe(l);
    }
  });
  it('devolve o logo sem o espaço das pontas', () => {
    expect(logoSeguro(`  ${LOGO}\n`)).toBe(LOGO);
  });
  it('rejeita endereço http, SVG, outros tipos e texto solto', () => {
    expect(logoSeguro('http://exemplo.test/logo.png')).toBeNull();
    expect(logoSeguro('https://exemplo.test/logo.png')).toBeNull();
    expect(logoSeguro('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBeNull();
    expect(logoSeguro('data:text/html;base64,PGh0bWw+')).toBeNull();
    expect(logoSeguro('data:image/png;base64,')).toBeNull();
    expect(logoSeguro('logo.png')).toBeNull();
  });
  it('rejeita caractere fora do base64, que poderia fechar o atributo src', () => {
    expect(logoSeguro('data:image/png;base64,AAAA" onerror="x')).toBeNull();
    expect(logoSeguro('data:image/png;base64,AAAA<script>')).toBeNull();
  });
  it('vazio e nulo viram null', () => {
    expect(logoSeguro('')).toBeNull();
    expect(logoSeguro(null)).toBeNull();
    expect(logoSeguro(undefined)).toBeNull();
  });
  it('aceita até 1.500.000 caracteres e rejeita acima', () => {
    const prefixo = 'data:image/png;base64,';
    const noTeto = prefixo + 'A'.repeat(1500000 - prefixo.length);
    expect(noTeto).toHaveLength(1500000);
    expect(logoSeguro(noTeto)).toBe(noTeto);
    expect(logoSeguro(noTeto + 'A')).toBeNull();
  });
});

describe('cnpjParaRelatorio', () => {
  it('14 dígitos viram CNPJ formatado, com ou sem máscara', () => {
    expect(cnpjParaRelatorio(CNPJ_CRU)).toBe(CNPJ_BONITO);
    expect(cnpjParaRelatorio(CNPJ_BONITO)).toBe(CNPJ_BONITO);
    expect(cnpjParaRelatorio(` ${CNPJ_CRU} `)).toBe(CNPJ_BONITO);
  });
  it('fora de 14 dígitos fica como foi digitado, aparado', () => {
    expect(cnpjParaRelatorio('  12.345  ')).toBe('12.345');
    expect(cnpjParaRelatorio('em abertura')).toBe('em abertura');
  });
  it('vazio e nulo viram vazio', () => {
    expect(cnpjParaRelatorio('')).toBe('');
    expect(cnpjParaRelatorio(null)).toBe('');
    expect(cnpjParaRelatorio(undefined)).toBe('');
  });
});

describe('telefoneFormatado', () => {
  it('11 dígitos: celular com DDD', () => {
    expect(telefoneFormatado('31999990000')).toBe('(31) 99999-0000');
    expect(telefoneFormatado('(31) 99999-0000')).toBe('(31) 99999-0000');
  });
  it('10 dígitos: fixo com DDD', () => {
    expect(telefoneFormatado('3133334444')).toBe('(31) 3333-4444');
  });
  it('tira o 55 do país quando sobram 12 ou 13 dígitos', () => {
    expect(telefoneFormatado('5531999990000')).toBe('(31) 99999-0000');
    expect(telefoneFormatado('+55 31 3333-4444')).toBe('(31) 3333-4444');
  });
  it('não tira o 55 de um celular com DDD 55 (11 dígitos)', () => {
    expect(telefoneFormatado('55999990000')).toBe('(55) 99999-0000');
  });
  it('tamanho que não é de telefone devolve vazio', () => {
    for (const ruim of ['12345', '', null, undefined, '1231999990000', '312']) {
      expect(telefoneFormatado(ruim), String(ruim)).toBe('');
    }
  });
});

describe('marcaDeLinha', () => {
  it('sem linha, ou sem nome, logo e CNPJ, não há marca', () => {
    expect(marcaDeLinha(null)).toBeNull();
    expect(marcaDeLinha(undefined)).toBeNull();
    expect(marcaDeLinha({})).toBeNull();
    expect(marcaDeLinha({ nome: '   ', nome_fantasia: '', cnpj: ' ', logo_base64: 'http://x.test/a.png' })).toBeNull();
  });
  it('monta nome, CNPJ formatado, logo e cor', () => {
    expect(marcaDeLinha(linhaOk())).toEqual({ nome: 'Solar Teste', cnpj: CNPJ_BONITO, logo: LOGO, cor: '#0e6b5c' });
  });
  it('usa o nome fantasia; sem ele, a razão social', () => {
    expect(marcaDeLinha(linhaOk({ nome_fantasia: '  Fantasia  ' }))?.nome).toBe('Fantasia');
    expect(marcaDeLinha(linhaOk({ nome_fantasia: null }))?.nome).toBe('Solar Teste Ltda');
    expect(marcaDeLinha(linhaOk({ nome_fantasia: '   ' }))?.nome).toBe('Solar Teste Ltda');
  });
  it('CNPJ fora de 14 dígitos fica como digitado', () => {
    expect(marcaDeLinha(linhaOk({ cnpj: ' 123 ' }))?.cnpj).toBe('123');
  });
  it('só o logo já basta para ter marca', () => {
    expect(marcaDeLinha({ logo_base64: LOGO })).toEqual({ nome: '', cnpj: '', logo: LOGO, cor: null });
  });
  it('logo ruim é descartado e o resto da marca fica', () => {
    expect(marcaDeLinha(linhaOk({ logo_base64: 'data:image/svg+xml;base64,PHN2Zz4=' }))).toMatchObject({ nome: 'Solar Teste', logo: null });
  });
  it('a cor só passa se for hex de 6 dígitos', () => {
    expect(marcaDeLinha(linhaOk({ cor_marca: '#0E6B5C' }))?.cor).toBe('#0e6b5c');
    expect(marcaDeLinha(linhaOk({ cor_marca: '0E6B5C' }))?.cor).toBe('#0e6b5c');
    for (const ruim of ['red', '#fff', '#12345g', '', null, undefined, 'url(x)']) {
      expect(marcaDeLinha(linhaOk({ cor_marca: ruim }))?.cor, String(ruim)).toBeNull();
    }
  });
  it('com a constante falsa NÃO devolve o contato, mesmo com WhatsApp e endereço na linha', () => {
    expect(MOSTRAR_CONTATO_EMPRESA).toBe(false);
    const m = marcaDeLinha(linhaOk());
    expect(m).not.toHaveProperty('contato');
    expect(JSON.stringify(m)).not.toContain('31999990000');
    expect(JSON.stringify(m)).not.toContain('Palmeiras');
  });
  it('o caminho do contato fica pronto: ligado só no teste, devolve os três campos aparados', () => {
    const m = marcaDeLinha(linhaOk({ whatsapp: ' 31999990000 ', endereco: ' Rua A, 1 ', cidade: ' BH ' }), true);
    expect(m?.contato).toEqual({ whatsapp: '31999990000', endereco: 'Rua A, 1', cidade: 'BH' });
    expect(marcaDeLinha(linhaOk({ whatsapp: '', endereco: null, cidade: ' ' }), true)).not.toHaveProperty('contato');
  });
});

describe('COLUNAS_MARCA', () => {
  it('pede só as colunas da marca; o contato só entra com a constante ligada', () => {
    expect(COLUNAS_MARCA.startsWith('nome, nome_fantasia, cnpj, logo_base64, cor_marca')).toBe(true);
    expect(COLUNAS_MARCA.includes('whatsapp')).toBe(MOSTRAR_CONTATO_EMPRESA);
    expect(COLUNAS_MARCA.includes('endereco')).toBe(MOSTRAR_CONTATO_EMPRESA);
    expect(COLUNAS_MARCA.includes('cidade')).toBe(MOSTRAR_CONTATO_EMPRESA);
    if (!MOSTRAR_CONTATO_EMPRESA) expect(COLUNAS_MARCA).toBe('nome, nome_fantasia, cnpj, logo_base64, cor_marca');
  });
});

describe('hashMarca', () => {
  const M: MarcaEmpresa = { nome: 'Solar Teste', cnpj: CNPJ_BONITO, logo: LOGO, cor: '#0e6b5c' };

  it('sem marca devolve vazio', () => {
    expect(hashMarca(null)).toBe('');
    expect(hashMarca(undefined)).toBe('');
  });
  it('tem 12 caracteres hexadecimais e não muda de uma chamada para outra', () => {
    expect(hashMarca(M)).toMatch(/^[0-9a-f]{12}$/);
    expect(hashMarca(M)).toBe(hashMarca({ ...M }));
  });
  it('muda quando muda o logo, o nome, o CNPJ ou a cor', () => {
    const base = hashMarca(M);
    expect(hashMarca({ ...M, logo: 'data:image/png;base64,QUJD' })).not.toBe(base);
    expect(hashMarca({ ...M, logo: null })).not.toBe(base);
    expect(hashMarca({ ...M, nome: 'Solar Teste 2' })).not.toBe(base);
    expect(hashMarca({ ...M, cnpj: '' })).not.toBe(base);
    expect(hashMarca({ ...M, cor: '#f7c531' })).not.toBe(base);
    expect(hashMarca({ ...M, cor: null })).not.toBe(base);
  });
  it('muda quando o contato aparece ou muda', () => {
    const contato = { whatsapp: '31999990000', endereco: 'Rua A, 1', cidade: 'BH' };
    const base = hashMarca(M);
    expect(hashMarca({ ...M, contato })).not.toBe(base);
    expect(hashMarca({ ...M, contato: { ...contato, cidade: 'SP' } })).not.toBe(hashMarca({ ...M, contato }));
  });
  it('não muda com a ordem das chaves do objeto', () => {
    const embaralhado = { cor: M.cor, logo: M.logo, cnpj: M.cnpj, nome: M.nome } as MarcaEmpresa;
    expect(hashMarca(embaralhado)).toBe(hashMarca(M));
    const contato = { whatsapp: '31999990000', endereco: 'Rua A, 1', cidade: 'BH' };
    const c1: MarcaEmpresa = { ...M, contato };
    const c2 = { cor: M.cor, contato: { cidade: 'BH', endereco: 'Rua A, 1', whatsapp: '31999990000' }, logo: M.logo, cnpj: M.cnpj, nome: M.nome } as MarcaEmpresa;
    expect(hashMarca(c2)).toBe(hashMarca(c1));
  });
});

describe('lerMarca', () => {
  beforeEach(() => {
    banco.reset();
    vi.mocked(logger.error).mockClear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('lê a empresa do usuário e monta a marca', async () => {
    banco.poe('company', linhaOk(), linhaOk({ user_id: 'u2', nome_fantasia: 'Outra Empresa' }));
    expect(await lerMarca('u1')).toEqual({ nome: 'Solar Teste', cnpj: CNPJ_BONITO, logo: LOGO, cor: '#0e6b5c' });
    expect((await lerMarca('u2'))?.nome).toBe('Outra Empresa');
  });
  it('só lê: não escreve nada no banco', async () => {
    banco.poe('company', linhaOk());
    await lerMarca('u1');
    expect(banco.escritas).toEqual([]);
  });
  it('o select traz tudo o que a marca usa (com a projeção de colunas ligada) e nada do contato', async () => {
    banco.projeta = true;
    banco.poe('company', linhaOk({ plano: 'pro', segredo_qualquer: 'x' }));
    const m = await lerMarca('u1');
    expect(m).toEqual({ nome: 'Solar Teste', cnpj: CNPJ_BONITO, logo: LOGO, cor: '#0e6b5c' });
    expect(m).not.toHaveProperty('contato');
  });
  it('empresa sem nada para mostrar devolve null, sem registrar erro', async () => {
    banco.poe('company', { user_id: 'u1', nome: '', nome_fantasia: null, cnpj: null, logo_base64: null, cor_marca: '#0E6B5C' });
    expect(await lerMarca('u1')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });
  it('usuário sem empresa devolve null, sem registrar erro', async () => {
    expect(await lerMarca('u9')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });
  it('sem id de usuário nem consulta o banco', async () => {
    const de = vi.spyOn(supabase, 'from');
    expect(await lerMarca(undefined)).toBeNull();
    expect(await lerMarca(null)).toBeNull();
    expect(await lerMarca('')).toBeNull();
    expect(de).not.toHaveBeenCalled();
  });
  it('erro do banco: devolve null sem lançar e registra a falha', async () => {
    banco.poe('company', linhaOk());
    banco.falhas['company.select'] = { erro: { code: '57P01', message: 'banco fora do ar' } };
    await expect(lerMarca('u1')).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('relatorio', 'falha lendo a marca da empresa', expect.objectContaining({ code: '57P01' }));
  });
  it('cliente que lança: devolve null sem lançar e registra a falha', async () => {
    banco.poe('company', linhaOk());
    vi.spyOn(supabase, 'from').mockImplementationOnce(() => { throw new Error('rede caiu'); });
    await expect(lerMarca('u1')).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith('relatorio', 'falha lendo a marca da empresa', expect.any(Error));
  });
});
