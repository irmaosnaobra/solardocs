import { describe, it, expect } from 'vitest';
import { inflateSync } from 'zlib';
import qrcode from 'qrcode-generator';
import { qrPngBase64 } from '../services/asaas/qrPixImagem';

// A imagem do QR do Pix feita do copia e cola (PNG de 1 bit, base64 sem prefixo). Aqui o PNG é lido de volta byte a byte e
// comparado módulo a módulo com a matriz do qrcode-generator: se o empacotamento dos bits errar, o teste pega.

const PIX = '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5913SOLARDOC TESTE6009SAO PAULO62070503***6304ABCD';

function lerPng(b64: string) {
  const png = Buffer.from(b64, 'base64');
  expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  let pos = 8; const idat: Buffer[] = []; let ihdr: Buffer | null = null; let fim = false;
  while (pos < png.length) {
    const len = png.readUInt32BE(pos); const tipo = png.subarray(pos + 4, pos + 8).toString('ascii');
    const dados = png.subarray(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') ihdr = dados; if (tipo === 'IDAT') idat.push(dados); if (tipo === 'IEND') fim = true;
    pos += 12 + len;
  }
  expect(fim).toBe(true);
  expect(pos).toBe(png.length);
  const largura = ihdr!.readUInt32BE(0); const altura = ihdr!.readUInt32BE(4);
  expect(ihdr![8]).toBe(1); expect(ihdr![9]).toBe(0);
  return { largura, altura, cru: inflateSync(Buffer.concat(idat)) };
}

describe('qrPngBase64', () => {
  it('devolve base64 puro (sem data:) de um PNG quadrado', () => {
    const b = qrPngBase64(PIX)!;
    expect(b).toMatch(/^iVBORw0KGgo[A-Za-z0-9+/=]+$/);
    const { largura, altura } = lerPng(b);
    expect(largura).toBe(altura);
  });

  it('cada módulo do QR aparece no PNG: preto onde é escuro, branco onde não é, com borda branca', () => {
    const { largura, altura, cru } = lerPng(qrPngBase64(PIX)!);
    const qr = qrcode(0, 'M'); qr.addData(PIX); qr.make();
    const m = qr.getModuleCount();
    const CELULA = 6; const MARGEM = 4;
    expect(largura).toBe((m + MARGEM * 2) * CELULA);
    const porLinha = Math.ceil(largura / 8) + 1;
    expect(cru.length).toBe(porLinha * altura);
    const branco = (x: number, y: number) => ((cru[y * porLinha + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 1;
    for (let y = 0; y < altura; y++) expect(cru[y * porLinha]).toBe(0); // filtro "nenhum"
    for (let r = -MARGEM; r < m + MARGEM; r++) {
      for (let c = -MARGEM; c < m + MARGEM; c++) {
        const escuro = r >= 0 && c >= 0 && r < m && c < m && qr.isDark(r, c);
        const x = (c + MARGEM) * CELULA + 2; const y = (r + MARGEM) * CELULA + 3; // um ponto dentro da célula
        expect(branco(x, y)).toBe(!escuro);
      }
    }
  });

  it('o canto do quadrado de localização (módulo 0,0) é preto e a borda é branca', () => {
    const { cru } = lerPng(qrPngBase64(PIX)!);
    const qr = qrcode(0, 'M'); qr.addData(PIX); qr.make();
    const porLinha = Math.ceil(((qr.getModuleCount() + 8) * 6) / 8) + 1;
    const x = 4 * 6 + 1; const y = 4 * 6 + 1;
    expect((cru[y * porLinha + 1 + (x >> 3)] >> (7 - (x & 7))) & 1).toBe(0);
    expect((cru[1] >> 7) & 1).toBe(1);
  });

  it('o mesmo texto dá sempre a mesma imagem', () => {
    expect(qrPngBase64(PIX)).toBe(qrPngBase64(PIX));
  });

  it('texto vazio, em branco ou ausente: null', () => {
    expect(qrPngBase64('')).toBeNull();
    expect(qrPngBase64('   ')).toBeNull();
    expect(qrPngBase64(null)).toBeNull();
    expect(qrPngBase64(undefined)).toBeNull();
  });

  it('texto grande demais para um QR: null, sem estourar', () => {
    expect(qrPngBase64('A'.repeat(20000))).toBeNull();
  });
});
