import { PIX_DADOS } from './pixInfo';

// ─────────────────────────────────────────────────────────────────────────────
// Gerador de Pix "copia e cola" (BR Code EMV estático) — sem gateway, sem API.
// Monta o payload do padrão EMVCo/BCB pra chave da Aioros com o VALOR embutido,
// pra o cliente colar no banco e o valor já vir certo (ajuda a validação por IA
// do comprovante, que confere o valor exato do plano).
//
// Estático (sem campo 01 "point of initiation") = reutilizável; cada oferta
// mensal gera um novo com o mesmo valor. O txid ajuda a reconciliar/dedup.
// ⚠️ Testar o código gerado num app de banco REAL antes de ir pro cliente —
// CRC16/tamanhos de campo precisam estar exatos.
// ─────────────────────────────────────────────────────────────────────────────

// Normaliza pro charset do BR Code (ASCII maiúsculo, sem acento) e corta no máx.
function emvText(s: string, max: number): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos combinantes
    .replace(/[^A-Za-z0-9 ]/g, '')                    // só ASCII básico + espaço
    .toUpperCase()
    .trim()
    .slice(0, max);
}

// Campo TLV: id(2) + tamanho(2, zero-pad) + valor.
function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, '0')}${value}`;
}

// CRC16-CCITT (FALSE): poly 0x1021, init 0xFFFF, sem xor final — o exigido pelo
// BR Code. Vetor de teste padrão: crc16('123456789') === '29B1'.
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface PixBrCodeParams {
  valor: number;            // reais (ex.: 67 → "67.00")
  txid?: string;            // ≤25 alfanumérico; default "***" (sem txid)
  chave?: string;
  nome?: string;            // recebedor (campo 59, ≤25)
  cidade?: string;          // recebedor (campo 60, ≤15)
}

// Retorna o texto do Pix copia-e-cola pronto pra enviar.
export function gerarPixCopiaECola(params: PixBrCodeParams): string {
  const chave  = (params.chave ?? PIX_DADOS.chave).replace(/\s/g, '');
  const nome   = emvText(params.nome ?? PIX_DADOS.titular, 25);
  const cidade = emvText(params.cidade ?? PIX_DADOS.cidade, 15);
  const valor  = params.valor.toFixed(2); // "67.00"
  const txid   = params.txid && params.txid !== '***'
    ? emvText(params.txid, 25).replace(/ /g, '')
    : '***';

  const mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', chave); // 26 - conta Pix
  const adf = tlv('05', txid);                                // 62 - dados adicionais (txid)

  const semCrc =
    tlv('00', '01') +      // Payload Format Indicator
    tlv('01', '11') +      // Point of Initiation Method: 11 = estático (reutilizável)
    tlv('26', mai) +       // Merchant Account Information (Pix)
    tlv('52', '0000') +    // Merchant Category Code
    tlv('53', '986') +     // Moeda: BRL
    tlv('54', valor) +     // Valor da transação
    tlv('58', 'BR') +      // País
    tlv('59', nome) +      // Nome do recebedor
    tlv('60', cidade) +    // Cidade do recebedor
    tlv('62', adf) +       // Additional Data (txid)
    '6304';                // CRC (id 63 + tamanho 04); valor calculado a seguir

  return semCrc + crc16(semCrc);
}
