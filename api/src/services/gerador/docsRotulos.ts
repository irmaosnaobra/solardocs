// ─────────────────────────────────────────────────────────────────────────────
// RÓTULO DO DOCUMENTO (o nome que a pessoa, ou a IA, dá a cada arquivo anexado à venda).
//
// Por que NÃO mora no `system_state` (`docs_cliente:`): a chave pública do banco principal LÊ essa tabela, e o rótulo é
// texto livre (pode ter nome de pessoa). Mora no bucket PRIVADO `cadastros-venda`, objeto `<linha>/<codigo>.docs.json`:
//   { v: 1, rotulos: { [docId]: { rotulo, fonte: 'ia' | 'manual', por, em } }, em }
//
// Rótulo manual sempre vence o da IA. Nada daqui põe rótulo em log: só o código do erro sobe.
// Escrita: sempre dentro da trava da venda (`comTrava`, em cadastroVendaBanco).
// ─────────────────────────────────────────────────────────────────────────────
import { lerJsonBruto, gravarJsonBruto, caminhoRotulos } from './cadastroVendaBanco';
import type { Linha } from './docsCliente';

export const ROTULO_MAX = 60;
export type FonteRotulo = 'ia' | 'manual';
export interface RotuloDoc { rotulo: string; fonte: FonteRotulo; por: string; em: string }
export interface Rotulos { v: 1; rotulos: Record<string, RotuloDoc>; em: string }

export const rotulosVazios = (): Rotulos => ({ v: 1, rotulos: {}, em: '' });

const RE_ID = /^[0-9a-f-]{36}$/;
// eslint-disable-next-line no-control-regex
const RE_CONTROLE = /[\u0000-\u001f\u007f]/g;

/** Limpa o texto: controle vira espaço, espaços se juntam, trim. */
const aparar = (x: string): string => x.replace(RE_CONTROLE, ' ').replace(/\s+/g, ' ').trim();

/**
 * Rótulo digitado pela pessoa. string vazia = limpar. Mais de 60 caracteres NÃO é cortado: é recusado (quem digitou vê o
 * erro e decide). Não-string é recusado.
 */
export function rotuloManual(x: unknown): { ok: true; valor: string } | { ok: false; erro: string } {
  if (typeof x !== 'string') return { ok: false, erro: 'O nome do documento precisa ser um texto.' };
  const v = aparar(x);
  if (v.length > ROTULO_MAX) return { ok: false, erro: `O nome passa de ${ROTULO_MAX} caracteres.` };
  return { ok: true, valor: v };
}

/**
 * Rótulo vindo da IA. Defesa no servidor (o prompt já pede sem nome de pessoa nem número): descarta o que traz 3 dígitos
 * seguidos ou arroba (número de documento, e-mail), troca travessão por hífen, corta em 60 e começa com maiúscula.
 * '' = sem rótulo aproveitável.
 */
export function rotuloDaIa(x: unknown): string {
  if (typeof x !== 'string') return '';
  let v = aparar(x).replace(/[—–]/g, '-').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
  // Dígitos separados por ponto, hífen, barra ou espaço contam como seguidos ("123.456", "12 34 56").
  if (!v || /\d{3}/.test(v.replace(/(?<=\d)[.\-/\s](?=\d)/g, '')) || v.includes('@')) return '';
  if (v.length > ROTULO_MAX) v = v.slice(0, ROTULO_MAX).replace(/\s+\S*$/, '').trim() || v.slice(0, ROTULO_MAX);
  return v.charAt(0).toUpperCase() + v.slice(1);
}

/** Normaliza o JSON do bucket (pode vir torto). Só entram ids de formato válido e rótulos dentro do limite. */
export function lerRotulosBruto(bruto: unknown): Rotulos {
  const saida = rotulosVazios();
  const o = (bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  if (typeof o.em === 'string') saida.em = o.em;
  const r = o.rotulos && typeof o.rotulos === 'object' && !Array.isArray(o.rotulos) ? (o.rotulos as Record<string, unknown>) : {};
  for (const [id, x] of Object.entries(r)) {
    if (!RE_ID.test(id) || !x || typeof x !== 'object') continue;
    const e = x as Record<string, unknown>;
    const rotulo = typeof e.rotulo === 'string' ? aparar(e.rotulo) : '';
    if (!rotulo || rotulo.length > ROTULO_MAX) continue;
    if (e.fonte !== 'ia' && e.fonte !== 'manual') continue;
    saida.rotulos[id] = { rotulo, fonte: e.fonte, por: typeof e.por === 'string' ? e.por : '', em: typeof e.em === 'string' ? e.em : '' };
  }
  return saida;
}

/** Os rótulos da venda. Objeto que não existe = nenhum rótulo. Bucket fora do ar ou JSON torto lança `ErroCadastro`. */
export async function lerRotulos(linha: Linha, codigo: string): Promise<Rotulos> {
  return lerRotulosBruto(await lerJsonBruto(caminhoRotulos(linha, codigo)));
}

/** Grava o objeto inteiro. Quem chama está dentro da trava da venda. */
export async function gravarRotulos(linha: Linha, codigo: string, rot: Rotulos, agora: string): Promise<void> {
  await gravarJsonBruto(caminhoRotulos(linha, codigo), { v: 1, rotulos: rot.rotulos, em: agora });
}

/** Trava da venda: o id do card no eletroposto (a mesma do cadastro), `<linha>:<código>` nas outras. */
export const travaDaVenda = (linha: Linha, codigo: string): number | string => (linha === 'eletroposto' ? Number(codigo) : `${linha}:${codigo}`);
