// ─────────────────────────────────────────────────────────────────────────────
// A imagem do QR do Pix, gerada aqui a partir do copia e cola (qr_payload).
//
// Por quê: o Asaas só entrega a imagem na criação. Quando a tela reabre um contrato que já existe, ela perdia o QR.
// Formato: PNG em base64 SEM o prefixo `data:`, o mesmo que a criação devolve (`auth.encodedImage`) e que as telas já mostram.
// Sem dependência nova: matriz do `qrcode-generator` (já usado nas propostas) + PNG de 1 bit escrito à mão com o zlib do Node.
// ─────────────────────────────────────────────────────────────────────────────
import { deflateSync } from 'zlib';
import qrcode from 'qrcode-generator';

const CELULA = 6;   // pixels por módulo
const MARGEM = 4;   // módulos de borda branca (o mínimo que o padrão do QR pede)

let tabelaCrc: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!tabelaCrc) {
    tabelaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabelaCrc[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = tabelaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo: string, dados: Buffer): Buffer {
  const comprimento = Buffer.alloc(4); comprimento.writeUInt32BE(dados.length, 0);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo), 0);
  return Buffer.concat([comprimento, corpo, crc]);
}

/** PNG (base64, sem prefixo) do QR do copia e cola. Devolve null se o texto estiver vazio ou não couber num QR. */
export function qrPngBase64(payload: string | null | undefined): string | null {
  const texto = String(payload ?? '').trim();
  if (!texto) return null;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    const modulos = qr.getModuleCount();
    const lado = (modulos + MARGEM * 2) * CELULA;
    const bytesPorLinha = Math.ceil(lado / 8);
    const cru = Buffer.alloc((bytesPorLinha + 1) * lado, 0); // byte 0 de cada linha = filtro "nenhum"; bit 1 = branco
    for (let y = 0; y < lado; y++) {
      const base = y * (bytesPorLinha + 1) + 1;
      const r = Math.floor(y / CELULA) - MARGEM;
      for (let x = 0; x < lado; x++) {
        const c = Math.floor(x / CELULA) - MARGEM;
        const escuro = r >= 0 && c >= 0 && r < modulos && c < modulos && qr.isDark(r, c);
        if (!escuro) cru[base + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    const cabecalho = Buffer.alloc(13);
    cabecalho.writeUInt32BE(lado, 0); cabecalho.writeUInt32BE(lado, 4);
    cabecalho[8] = 1;  // 1 bit por pixel
    cabecalho[9] = 0;  // tons de cinza
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      bloco('IHDR', cabecalho),
      bloco('IDAT', deflateSync(cru)),
      bloco('IEND', Buffer.alloc(0)),
    ]);
    return png.toString('base64');
  } catch { return null; }
}
