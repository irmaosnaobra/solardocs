// Marca do integrador nos relatórios (logo, nome, CNPJ e cor). Módulo PURO: sem banco, sem logger,
// sem rede. Os templates importam este arquivo; a leitura da tabela `company` mora em marcaDb.ts.

import { createHash } from 'crypto';
import { formatarCnpj, soDigitos } from '../../utils/cnpj';

/**
 * Contato da empresa (WhatsApp, endereço) nos relatórios. DESLIGADO por decisão do produto: um teste
 * da manutenção proíbe o WhatsApp da empresa no relatório. Para ligar, troque para `true` e ajuste
 * esse teste. Com a constante falsa o contato nem é lido do banco (COLUNAS_MARCA) nem impresso.
 */
export const MOSTRAR_CONTATO_EMPRESA = false;

/** Colunas de `company` que a marca lê. O contato só entra com MOSTRAR_CONTATO_EMPRESA ligada. */
export const COLUNAS_MARCA =
  'nome, nome_fantasia, cnpj, logo_base64, cor_marca' + (MOSTRAR_CONTATO_EMPRESA ? ', whatsapp, endereco, cidade' : '');

export interface MarcaEmpresa {
  nome: string;
  cnpj: string;
  logo: string | null;
  cor: string | null;
  contato?: { whatsapp: string; endereco: string; cidade: string };
}

/** Linha de `company` como o banco devolve. Qualquer campo pode faltar ou vir sujo. */
export interface LinhaEmpresa {
  nome?: unknown;
  nome_fantasia?: unknown;
  cnpj?: unknown;
  logo_base64?: unknown;
  cor_marca?: unknown;
  whatsapp?: unknown;
  endereco?: unknown;
  cidade?: unknown;
}

// ── Cores: a cor da empresa vira destaque; sem cor, a marca padrão da SolarDoc ──
// Cópia fiel de paleta() e dos auxiliares de manutencao/htmlRelatorio.ts (o comportamento não muda).
// A manutenção passa a importar daqui quando o relatório dela for migrado para a base compartilhada.

const hexLimpo = (h: unknown): string | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? '').trim());
  return m ? '#' + m[1]!.toLowerCase() : null;
};
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const lum = (r: number, g: number, b: number) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const mistura = (a: number, b: number, t: number) => a + (b - a) * t;

/** { c1, c2, c3, ac }: `c1` é a cor da marca escurecida até dar contraste de texto branco (luminância até 0,18). */
export function paleta(corMarca: unknown): { c1: string; c2: string; c3: string; ac: string } {
  const bruto = hexLimpo(corMarca);
  if (!bruto) return { c1: '#0B2545', c2: '#2C4A73', c3: '#EEF2F8', ac: '#C9A227' };
  let [r, g, b] = rgb(bruto);
  // Escurece até dar contraste de texto branco (mesma regra dos documentos da proposta).
  for (let i = 0; i < 40 && lum(r, g, b) > 0.18; i++) { r *= 0.9; g *= 0.9; b *= 0.9; }
  const [R, G, B] = [r, g, b];
  return {
    c1: toHex(R, G, B),
    c2: toHex(mistura(R, 255, 0.22), mistura(G, 255, 0.22), mistura(B, 255, 0.22)),
    c3: toHex(mistura(R, 255, 0.93), mistura(G, 255, 0.93), mistura(B, 255, 0.93)),
    ac: bruto,
  };
}

// ── Logo, CNPJ e telefone ───────────────────────────────────────────────────

/** Teto do logo em caracteres (o logo vai em data URL dentro do HTML e do hash do PDF). */
const LOGO_MAX_CHARS = 1500000;

/** Só aceita logo que seja imagem em data URL, de tamanho razoável; qualquer outra coisa cai no nome da empresa. */
export function logoSeguro(l: unknown): string | null {
  const s = String(l ?? '').trim();
  if (s.length > LOGO_MAX_CHARS) return null;
  return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : null;
}

/** 14 dígitos viram "11.222.333/0001-81"; qualquer outro texto fica como foi digitado, aparado. */
export function cnpjParaRelatorio(v: unknown): string {
  return soDigitos(v).length === 14 ? formatarCnpj(v) : String(v ?? '').trim();
}

/** "(31) 99999-0000" (11 dígitos) ou "(31) 3333-4444" (10). Tira o 55 do país. Outro tamanho devolve ''. */
export function telefoneFormatado(v: unknown): string {
  let d = soDigitos(v);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return '';
}

// ── Linha do banco para MarcaEmpresa ────────────────────────────────────────

const texto = (v: unknown): string => String(v ?? '').trim();

/**
 * Converte a linha de `company` na marca do relatório. Devolve null se não sobrar nome, logo nem CNPJ.
 * A cor só passa se for hex de 6 dígitos (vira "#rrggbb" em minúscula). O contato só entra com
 * MOSTRAR_CONTATO_EMPRESA ligada; o segundo parâmetro existe para o teste provar esse caminho.
 */
export function marcaDeLinha(
  linha: LinhaEmpresa | null | undefined,
  mostrarContato: boolean = MOSTRAR_CONTATO_EMPRESA,
): MarcaEmpresa | null {
  if (!linha || typeof linha !== 'object') return null;
  const nome = texto(linha.nome_fantasia) || texto(linha.nome);
  const cnpj = cnpjParaRelatorio(linha.cnpj);
  const logo = logoSeguro(linha.logo_base64);
  if (!nome && !cnpj && !logo) return null;

  const marca: MarcaEmpresa = { nome, cnpj, logo, cor: hexLimpo(linha.cor_marca) };
  if (mostrarContato) {
    const contato = { whatsapp: texto(linha.whatsapp), endereco: texto(linha.endereco), cidade: texto(linha.cidade) };
    if (contato.whatsapp || contato.endereco || contato.cidade) marca.contato = contato;
  }
  return marca;
}

// ── Hash para o nome do PDF guardado ────────────────────────────────────────

const sha1 = (s: string): string => createHash('sha1').update(s).digest('hex');

/**
 * Hash curto (12 hex) do que a marca desenha no relatório. O logo entra por hash, nunca como base64
 * cru. Sem marca devolve ''. A ordem é fixa (montada campo a campo), então a ordem das chaves do
 * objeto de entrada não muda o resultado.
 */
export function hashMarca(m: MarcaEmpresa | null | undefined): string {
  if (!m) return '';
  const partes: string[] = [m.nome, m.cnpj, sha1(m.logo ?? ''), m.cor ?? ''];
  if (m.contato) partes.push(m.contato.whatsapp, m.contato.endereco, m.contato.cidade);
  return sha1(JSON.stringify(partes)).slice(0, 12);
}
