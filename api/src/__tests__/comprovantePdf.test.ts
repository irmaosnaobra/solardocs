import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadPdfAsAnthropicSource } from '../utils/mediaProcessor';

// ═══════════════════════════════════════════════════════════════════════════
// Comprovante de Pix em PDF.
//
// Banco não exporta print: o Sicoob (e Itaú, Nubank…) manda o comprovante como
// PDF, e é isso que o cliente encaminha no WhatsApp. Enquanto só imagem era
// aceita, esse cliente ouvia "não analiso esse formato" e ficava sem acesso
// mesmo tendo pago — foi o que segurou o Junior Moraes 2 dias em 11/08/2026.
//
// Aqui se testa o portão de entrada: o que vira anexo pra IA e o que é barrado
// antes de custar uma chamada de visão.
// ═══════════════════════════════════════════════════════════════════════════

const pdfBytes = (extra = 0) => {
  const head = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1');
  return Buffer.concat([head, Buffer.alloc(extra)]);
};

function mockFetch(body: Buffer | null, ok = true, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    arrayBuffer: async () => (body ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0)),
  })) as any;
}

const fetchOriginal = globalThis.fetch;
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { globalThis.fetch = fetchOriginal; vi.restoreAllMocks(); });

describe('downloadPdfAsAnthropicSource', () => {
  it('entrega o PDF no formato de bloco document da Anthropic', async () => {
    globalThis.fetch = mockFetch(pdfBytes());
    const src = await downloadPdfAsAnthropicSource('https://banco/comprovante.pdf');
    expect(src).not.toBeNull();
    expect(src!.type).toBe('base64');
    // media_type é o que decide, lá no leitor, se o anexo vai como `document`
    // em vez de `image`. Errar isto devolve 400 da API e o cliente fica no vácuo.
    expect(src!.media_type).toBe('application/pdf');
    expect(Buffer.from(src!.data, 'base64').toString('latin1')).toContain('%PDF-');
  });

  it('recusa arquivo que não é PDF de verdade (Z-API rotula qualquer anexo como pdf)', async () => {
    globalThis.fetch = mockFetch(Buffer.from('<html>404 not found</html>'));
    expect(await downloadPdfAsAnthropicSource('https://banco/nao-e.pdf')).toBeNull();
  });

  it('recusa PDF acima de 5MB — comprovante é 1 página, o resto é catálogo', async () => {
    globalThis.fetch = mockFetch(pdfBytes(5 * 1024 * 1024 + 1));
    expect(await downloadPdfAsAnthropicSource('https://banco/gigante.pdf')).toBeNull();
  });

  it('devolve null quando o download falha (o atendimento segue o fluxo normal)', async () => {
    globalThis.fetch = mockFetch(null, false, 404);
    expect(await downloadPdfAsAnthropicSource('https://banco/sumiu.pdf')).toBeNull();
  });
});
