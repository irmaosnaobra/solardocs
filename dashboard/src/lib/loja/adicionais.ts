'use client';

/**
 * AS FERRAMENTAS COMO ADICIONAL MENSAL (13/11/2026).
 *
 * Tudo aqui depende da flag da api (`ADICIONAIS_MENSAIS`). O front descobre pelo `GET /produtos/adicionais/oferta`,
 * que é público. Se a chamada falhar, vale DESLIGADO: a loja e o checkout continuam exatamente como eram.
 *
 * Contrato da api:
 *   GET  /produtos/adicionais/oferta   { ligado, precos: { avulso, pacoteCheckout, pacoteApp }, itens: [{ id, nome }] }
 *   GET  /produtos/adicional           { ativos: [{ id, meio, renovaEm, cancelado }], podeComprar: string[] }
 *   POST /produtos/adicional           { item, meio, cpf? | usarCpfSalvo? }  cartão: { url } ou { ok: true }; Pix: o QR
 *   POST /produtos/adicional/cancelar  { item }
 *
 * O valor cobrado vem SEMPRE da api. Os números daqui só desenham a tela.
 */

import { useEffect, useState } from 'react';
import api from '@/services/api';
import type { IdProdutoLoja } from './catalogo';

export type IdAdicional = IdProdutoLoja;
export type ItemAdicional = IdAdicional | 'pacote';

/** A ordem das caixas no checkout e na loja. */
export const IDS_ADICIONAIS: IdAdicional[] = ['offgrid', 'inventario', 'curso-fechamento', 'curso-limpapro'];

export function ehAdicional(id: string | null | undefined): id is IdAdicional {
  return !!id && (IDS_ADICIONAIS as string[]).includes(id);
}

export interface OfertaAdicionais {
  ligado: boolean;
  precos: { avulso: number; pacoteCheckout: number; pacoteApp: number };
  itens: { id: string; nome: string }[];
}

const DESLIGADA: OfertaAdicionais = {
  ligado: false,
  precos: { avulso: 17, pacoteCheckout: 30, pacoteApp: 40 },
  itens: [],
};

const num = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : padrao);

/** Lê a resposta com desconfiança: qualquer coisa fora do formato vira desligada. */
function normalizarOferta(data: unknown): OfertaAdicionais {
  const d = data as Partial<OfertaAdicionais> | null;
  if (!d || d.ligado !== true) return DESLIGADA;
  return {
    ligado: true,
    precos: {
      avulso: num(d.precos?.avulso, DESLIGADA.precos.avulso),
      pacoteCheckout: num(d.precos?.pacoteCheckout, DESLIGADA.precos.pacoteCheckout),
      pacoteApp: num(d.precos?.pacoteApp, DESLIGADA.precos.pacoteApp),
    },
    itens: Array.isArray(d.itens) ? d.itens.filter((i) => i && typeof i.id === 'string') : [],
  };
}

let ofertaCache: OfertaAdicionais | null = null;
let ofertaVoando: Promise<OfertaAdicionais> | null = null;

function buscarOferta(): Promise<OfertaAdicionais> {
  if (ofertaCache) return Promise.resolve(ofertaCache);
  ofertaVoando = ofertaVoando || api.get('/produtos/adicionais/oferta')
    .then(({ data }) => normalizarOferta(data))
    .catch(() => DESLIGADA)
    .then((o) => { ofertaCache = o; return o; });
  return ofertaVoando;
}

/** A oferta, uma chamada por carga de página. Enquanto não responde, `carregando` fica true e `ligado` false. */
export function useOfertaAdicionais(): OfertaAdicionais & { carregando: boolean } {
  const [oferta, setOferta] = useState<OfertaAdicionais | null>(ofertaCache);
  useEffect(() => {
    if (ofertaCache) return;
    let vivo = true;
    void buscarOferta().then((o) => { if (vivo) setOferta(o); });
    return () => { vivo = false; };
  }, []);
  return { ...(oferta ?? DESLIGADA), carregando: !oferta };
}

/* ── O que a conta já paga ── */

export interface AdicionalAtivo {
  id: ItemAdicional;
  meio: 'cartao' | 'pix';
  /** ISO. Com `cancelado`, é a data até onde o acesso vai. */
  renovaEm: string | null;
  cancelado: boolean;
}

export interface EstadoAdicionais {
  carregando: boolean;
  ativos: AdicionalAtivo[];
  podeComprar: string[];
}

const VAZIO: EstadoAdicionais = { carregando: true, ativos: [], podeComprar: [] };

let estadoCache: EstadoAdicionais | null = null;
let estadoVoando: Promise<EstadoAdicionais> | null = null;
const ouvintes = new Set<(e: EstadoAdicionais) => void>();

function buscarEstado(): Promise<EstadoAdicionais> {
  estadoVoando = estadoVoando || api.get('/produtos/adicional')
    .then(({ data }): EstadoAdicionais => ({
      carregando: false,
      ativos: Array.isArray(data?.ativos) ? data.ativos : [],
      podeComprar: Array.isArray(data?.podeComprar) ? data.podeComprar : [],
    }))
    // Falha não inventa assinatura: sem resposta, nada aparece como ativo e a página de compra segue igual.
    .catch((): EstadoAdicionais => ({ carregando: false, ativos: [], podeComprar: [] }))
    .then((e) => { estadoCache = e; estadoVoando = null; ouvintes.forEach((fn) => fn(e)); return e; });
  return estadoVoando;
}

/** Pergunta de novo à api (depois de comprar ou cancelar). */
export function recarregarAdicionais(): Promise<EstadoAdicionais> {
  estadoVoando = null;
  return buscarEstado();
}

/** As assinaturas de adicional da conta. Só pergunta com a oferta ligada e com sessão. */
export function useAdicionais(ligado: boolean): EstadoAdicionais & { recarregar: () => Promise<EstadoAdicionais> } {
  const [estado, setEstado] = useState<EstadoAdicionais>(estadoCache ?? VAZIO);
  useEffect(() => {
    if (!ligado) return;
    ouvintes.add(setEstado);
    if (!estadoCache) void buscarEstado();
    return () => { ouvintes.delete(setEstado); };
  }, [ligado]);
  const vazio = !ligado ? { carregando: false, ativos: [], podeComprar: [] } : estado;
  return { ...vazio, recarregar: recarregarAdicionais };
}

/**
 * A assinatura que cobre este produto: a dele mesmo ou o pacote. `null` quando não paga adicional por ele
 * (pode ter por compra antiga, plano anual ou assinatura, e aí vale o estado de sempre).
 */
export function ativoQueCobre(id: IdAdicional, ativos: AdicionalAtivo[]): AdicionalAtivo | null {
  return ativos.find((a) => a.id === id) ?? ativos.find((a) => a.id === 'pacote') ?? null;
}

/** Quantas avulsas a conta paga hoje, sem contar as canceladas. */
export function avulsasAtivas(ativos: AdicionalAtivo[]): AdicionalAtivo[] {
  return ativos.filter((a) => a.id !== 'pacote' && !a.cancelado);
}

/** "dd/mm", no fuso de Brasília. */
export function diaMes(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
}

/* ── Comprar e cancelar ── */

export interface QrDoAdicional {
  modo?: 'automatico' | 'assinatura';
  valor?: number;
  qrPayload: string | null;
  qrImagemBase64: string | null;
  status?: string;
  instrucao?: string;
}

export type RespostaCompra =
  | { tipo: 'redirecionar'; url: string }
  | { tipo: 'liberado' }
  | { tipo: 'pix'; qr: QrDoAdicional };

export async function comprarAdicional(
  item: ItemAdicional, meio: 'cartao' | 'pix', cpf?: { digitos: string } | { salvo: true },
): Promise<RespostaCompra> {
  const corpo: Record<string, unknown> = { item, meio };
  if (cpf && 'digitos' in cpf) corpo.cpf = cpf.digitos;
  if (cpf && 'salvo' in cpf) corpo.usarCpfSalvo = true;
  const { data } = await api.post('/produtos/adicional', corpo);
  if (meio === 'cartao') {
    if (typeof data?.url === 'string' && data.url) return { tipo: 'redirecionar', url: data.url };
    if (data?.ok) return { tipo: 'liberado' };
    throw new Error('resposta sem url');
  }
  return { tipo: 'pix', qr: data as QrDoAdicional };
}

export async function cancelarAdicional(item: ItemAdicional): Promise<void> {
  await api.post('/produtos/adicional/cancelar', { item });
}

/** O CPF que a pessoa já usou num Pix da loja, mascarado. `null` quando não há. */
export async function cpfSalvo(): Promise<string | null> {
  try {
    const { data } = await api.get('/produtos/cpf');
    return typeof data?.cpf === 'string' && data.cpf ? data.cpf : null;
  } catch { return null; }
}

/** A frase da api num erro do axios, quando ela mandou uma. */
export function fraseDoErro(err: unknown): string | null {
  const f = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof f === 'string' && f.trim() ? f.trim() : null;
}
