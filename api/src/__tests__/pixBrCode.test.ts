import { describe, it, expect } from 'vitest';
import { gerarPixCopiaECola } from '../utils/pixBrCode';
import { PIX_DADOS } from '../utils/pixInfo';

// ═══════════════════════════════════════════════════════════════════════════
// BR Code do Pix copia-e-cola.
//
// O arquivo gerado avisa: "testar num app de banco REAL antes de ir pro
// cliente — CRC16/tamanhos de campo precisam estar exatos". Este teste é a
// rede que dá pra ter em CI: faz o parse TLV do payload inteiro e RECALCULA
// o CRC de forma independente. Um erro de tamanho de campo desalinha o parse
// e um erro de CRC o banco recusa — os dois modos de falha aparecem aqui.
//
// Importa porque a entrada de R$19 é vendida DENTRO do WhatsApp: se o código
// sai quebrado, o cliente que topou não consegue pagar e a venda morre no
// ponto mais caro do funil.
// ═══════════════════════════════════════════════════════════════════════════

/** Parser TLV: id(2) + tamanho(2) + valor. Devolve mapa id → valor. */
function parseTLV(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    // Tamanho ilegível = campo desalinhado. Explode em vez de devolver lixo:
    // é exatamente o bug que este teste existe pra pegar.
    if (!Number.isFinite(len)) throw new Error(`tamanho invalido no id ${id} (offset ${i})`);
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

/** CRC16-CCITT (FALSE) — reimplementado aqui de propósito, pra conferir o do código. */
function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

describe('crc16 (vetor de teste do padrão)', () => {
  it('crc16("123456789") === 29B1', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
});

describe('gerarPixCopiaECola — entrada de R$19 (curso + 30 dias)', () => {
  const codigo = gerarPixCopiaECola({ valor: 19, txid: 'SOLARDOCCURSO' });

  it('o CRC do fim confere com o recalculado sobre o resto', () => {
    const corpo = codigo.slice(0, -4);
    const crcNoCodigo = codigo.slice(-4);
    expect(corpo.endsWith('6304')).toBe(true);
    expect(crcNoCodigo).toBe(crc16(corpo));
  });

  it('faz parse TLV limpo — nenhum campo desalinhado', () => {
    const campos = parseTLV(codigo);
    expect(campos['00']).toBe('01');   // payload format indicator
    expect(campos['01']).toBe('11');   // estático / reutilizável
    expect(campos['52']).toBe('0000'); // merchant category code
    expect(campos['53']).toBe('986');  // BRL
    expect(campos['58']).toBe('BR');
    expect(campos['63']).toHaveLength(4);
  });

  it('leva o valor 19.00 embutido — o comprovante é validado pelo valor exato', () => {
    expect(parseTLV(codigo)['54']).toBe('19.00');
  });

  it('aponta pra chave Pix da Aioros', () => {
    const mai = parseTLV(parseTLV(codigo)['26']);
    expect(mai['00']).toBe('br.gov.bcb.pix');
    expect(mai['01']).toBe(PIX_DADOS.chave);
  });

  it('carrega o txid do curso, separando a entrada da reativação', () => {
    const adf = parseTLV(parseTLV(codigo)['62']);
    expect(adf['05']).toBe('SOLARDOCCURSO');
  });
});

describe('gerarPixCopiaECola — reativação de R$67', () => {
  const codigo = gerarPixCopiaECola({ valor: 67, txid: 'SOLARDOCVIP' });

  it('gera código válido com o valor 67.00', () => {
    expect(codigo.slice(-4)).toBe(crc16(codigo.slice(0, -4)));
    expect(parseTLV(codigo)['54']).toBe('67.00');
  });

  it('tem txid DIFERENTE do da entrada — dá pra reconciliar quem pagou o quê', () => {
    const adfVip = parseTLV(parseTLV(codigo)['62'])['05'];
    const adfCurso = parseTLV(parseTLV(gerarPixCopiaECola({ valor: 19, txid: 'SOLARDOCCURSO' }))['62'])['05'];
    expect(adfVip).not.toBe(adfCurso);
  });
});
