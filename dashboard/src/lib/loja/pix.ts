/**
 * Compra por Pix dentro do app. O contrato é da api (rotas `/produtos/pix`):
 *   POST /produtos/pix        { produto, cpf } ou { produto, usarCpfSalvo: true }
 *   GET  /produtos/pix/:id    { status, produto, liberado, proximo? }
 *
 * O valor da cobrança vem SEMPRE do catálogo no servidor. Aqui só vai o id do produto e o CPF.
 */

import api from '@/services/api';
import type { ProximoDaApi } from './catalogo';

export interface CobrancaPix {
  cobrancaId: string;
  produto: string;
  valor: number;
  /** O código copia e cola. */
  qrPayload: string;
  /** PNG em base64, com ou sem o prefixo `data:`. */
  qrImagemBase64: string;
  expiraEm: string | null;
}

export type StatusPix = 'pendente' | 'pago' | 'expirado' | 'cancelado';

export interface ConsultaPix {
  status: StatusPix;
  produto: string;
  liberado: boolean;
  proximo?: ProximoDaApi | null;
}

export const MSG = {
  cpf: 'Confira o CPF e tente de novo.',
  gerar: 'Não foi possível gerar o Pix agora. Tente de novo em instantes.',
  naoVimos: 'Ainda não vimos o pagamento. Se você já pagou, aguarde um instante e atualize esta tela.',
  jaTem: 'Este produto já está liberado na sua conta.',
  naoAchou: 'Não encontramos esta cobrança. Gere outro Pix.',
} as const;

export type ErroDoPix =
  | { tipo: 'cpf' }
  | { tipo: 'jaTem' }
  /**
   * 409 que NÃO é "já tem". Com `pagoAguardando`, a pessoa já pagou e a liberação está em andamento: mostra a frase da
   * api e segue consultando. Sem ele (ex.: outra cobrança em curso), mostra a frase e volta a consultar a pendente.
   */
  | { tipo: 'conflito'; mensagem: string; pagoAguardando: boolean }
  /** Qualquer outra falha. `mensagem` é a frase da api quando ela mandou uma (400 de conta sem e-mail, por exemplo). */
  | { tipo: 'geral'; mensagem?: string };

type RespostaDeErro = { response?: { status?: number; data?: { error?: string; jaTem?: boolean; pagoAguardando?: boolean } } };

/** O status HTTP de um erro do axios, ou null (rede caiu, timeout). */
export function statusHttp(err: unknown): number | null {
  return (err as RespostaDeErro)?.response?.status ?? null;
}

/** O erro que a api devolve, já traduzido para o que a tela faz. */
export function classificarErro(err: unknown): ErroDoPix {
  const r = (err as RespostaDeErro)?.response;
  const frase = typeof r?.data?.error === 'string' && r.data.error.trim() ? r.data.error.trim() : undefined;
  if (r?.data?.jaTem === true) return { tipo: 'jaTem' };
  if (r?.status === 409) return { tipo: 'conflito', mensagem: frase ?? MSG.gerar, pagoAguardando: r.data?.pagoAguardando === true };
  if (r?.status === 400) {
    if (/cpf/i.test(frase ?? '')) return { tipo: 'cpf' };
    if (frase) return { tipo: 'geral', mensagem: frase };
  }
  return { tipo: 'geral' };
}

export async function criarPix(produto: string, cpfDigitos: string | null): Promise<CobrancaPix> {
  const corpo = cpfDigitos ? { produto, cpf: cpfDigitos } : { produto, usarCpfSalvo: true };
  const { data } = await api.post('/produtos/pix', corpo);
  return data as CobrancaPix;
}

export async function consultarPix(cobrancaId: string): Promise<ConsultaPix> {
  const { data } = await api.get(`/produtos/pix/${encodeURIComponent(cobrancaId)}`);
  return data as ConsultaPix;
}

/** O PNG do QR como `src` de imagem. A api manda o base64 puro; se vier com o prefixo, usa como está. */
export function srcDoQr(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
}
