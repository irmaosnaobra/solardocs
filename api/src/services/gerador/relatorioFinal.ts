// ─────────────────────────────────────────────────────────────────────
// RELATÓRIO FINAL da venda solar (Jornada, 18/11/2026): o PDF que resume a venda para a homologação, gerado no servidor como o Book da obra
// (mesmo Chromium, `abrirNavegador`, JavaScript desligado, teto de 8 MB).
//
// `relatorioFinalHtml` é PURA: monta o HTML de uma entrada já pronta e escapa todo texto. A entrada NUNCA leva dinheiro (valor, pagamento,
// entrada, parcela), contrato assinado nem recibo; quem monta a entrada (`routes/geradorJornadaRelatorioFinal.ts`) escolhe só o que cabe aqui.
// O fim do arquivo lê o registro do PDF e assina a URL (bucket privado `cadastros-venda`), como o Book.
// ─────────────────────────────────────────────────────────────────────
import { assinarArquivoBruto, lerJsonBruto } from './cadastroVendaBanco';
import type { EquipamentoProposta } from './trelloVendaSolar';
import type { VistoriaObra } from './jornadaObra';

export const TETO_RELATORIO_BYTES = 8 * 1024 * 1024;
export const caminhoRelatorioPdf = (card: number): string => `vendasolar/${card}.relatorio.pdf`;
export const caminhoRelatorioJson = (card: number): string => `vendasolar/${card}.relatorio.json`;
/** A chave do anexo do relatório no registro do envio ao Trello (`anexados`): própria, para nunca repetir o anexo. */
export const CHAVE_ANEXO_RELATORIO = 'relatorio_final';

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface KitVendido { placas: string; inversor: string; kwp: number | null; faltando: Array<'placas' | 'inversor'> }

/**
 * O kit vendido: placas e inversor vêm da proposta ligada ou, se ela não traz quantidade e marca, do texto escrito à mão (`kitTexto`).
 * `faltando` lista o que não tem dado completo nem texto. `kwpDados` é o kWp gravado na proposta, se houver. Sem proposta, só o texto.
 */
export function kitVendido(e: EquipamentoProposta | null, kwpDados: unknown, kitTexto?: { placas?: string; inversor?: string } | null): KitVendido {
  const q = (n: number | null): string => (n ? `${n} × ` : '');
  const daProposta = {
    placas: e ? `${q(e.qtdPlacas)}${[e.modeloPlaca, e.potPlaca ? `${e.potPlaca} W` : ''].filter(Boolean).join(' ')}`.trim().replace(/\s*×$/, '') : '',
    inversor: e ? `${q(e.qtdInversor)}${e.inversor}`.trim().replace(/\s*×$/, '') : '',
  };
  const completo = { placas: !!(e?.qtdPlacas && e.modeloPlaca), inversor: !!(e?.qtdInversor && e.inversor) };
  const texto = (k: 'placas' | 'inversor'): string => (kitTexto?.[k] ?? '').trim();
  const faltando: Array<'placas' | 'inversor'> = [];
  const escolhe = (k: 'placas' | 'inversor'): string => {
    if (completo[k]) return daProposta[k];
    if (texto(k)) return texto(k);
    faltando.push(k);
    return daProposta[k];   // o que a proposta tem, mesmo incompleto, só para mostrar
  };
  const placas = escolhe('placas');
  const inversor = escolhe('inversor');
  const dados = Number(kwpDados);
  const kwp = Number.isFinite(dados) && dados > 0 ? dados : (e?.qtdPlacas && e.potPlaca ? Math.round(e.qtdPlacas * e.potPlaca) / 1000 : null);
  return { placas, inversor, kwp, faltando };
}

const CONCLUSAO: Record<string, string> = { ok: 'Apto para instalação', adeq: 'Apto com adequações', nao: 'Não apto no momento' };
const ROTULOS_VISTORIA = {
  raiz: [['data', 'Data'], ['quem', 'Quem fez'], ['acomp', 'Quem acompanhou'], ['obs', 'Observações']],
  telhado: [['tipo', 'Tipo'], ['estado', 'Estado'], ['orient', 'Orientação da água'], ['incl', 'Inclinação'], ['area', 'Área útil livre'], ['sombra', 'Sombreamento'], ['estr', 'Estrutura'], ['acesso', 'Acesso ao telhado']],
  entrada: [['padrao', 'Padrão'], ['tensao', 'Tensão'], ['disj', 'Disjuntor geral'], ['apto', 'Padrão apto a receber'], ['aterr', 'Aterramento'], ['quadro', 'Espaço no quadro']],
  inversor: [['local', 'Local do inversor'], ['dist', 'Distância ao quadro'], ['abrig', 'Abrigado de sol e chuva'], ['wifi', 'Sinal de Wi-Fi']],
} as const;

/** O resumo da vistoria: só os campos PREENCHIDOS, por grupo (fotos ficam de fora; as miniaturas saem em outra seção). */
export function resumoDaVistoria(v: VistoriaObra | null): Array<{ grupo: string; campos: Array<[string, string]> }> {
  if (!v) return [];
  const cheio = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');
  const raiz: Array<[string, string]> = [];
  for (const [k, r] of ROTULOS_VISTORIA.raiz) if (cheio(v[k])) raiz.push([r, cheio(v[k])]);
  if (cheio(v.concl)) raiz.push(['Conclusão', CONCLUSAO[v.concl] ?? v.concl]);
  if (v.adeq?.length) raiz.push(['Adequações', v.adeq.filter(Boolean).join('; ')]);
  const grupos: Array<{ grupo: string; campos: Array<[string, string]> }> = [{ grupo: 'Vistoria', campos: raiz }];
  for (const [g, rotulo] of [['telhado', 'Telhado'], ['entrada', 'Padrão de entrada'], ['inversor', 'Local do inversor']] as const) {
    const campos: Array<[string, string]> = [];
    for (const [k, r] of ROTULOS_VISTORIA[g]) { const x = cheio((v[g] as Record<string, unknown> | undefined)?.[k]); if (x) campos.push([r, x]); }
    grupos.push({ grupo: rotulo, campos });
  }
  return grupos.filter((x) => x.campos.length);
}

export interface EntradaRelatorio {
  cliente: string; codigo: string | null; emitidoEm: string;
  secoes: Array<{ numero: number; titulo: string; campos: Array<{ rotulo: string; valor: string }> }>;
  kit: KitVendido | null;
  excedente: { tem: boolean | null; linhas: Array<{ papel: string; uc: string; titular: string; pct: number | null }> };
  vistoria: Array<{ grupo: string; campos: Array<[string, string]> }>;
  documentos: Array<{ rotulo: string; data: string }>;
  fotos: Array<{ legenda: string; url: string }>;
  larguraFoto: '31%' | '15%';
}

const tabela = (linhas: Array<[string, string]>): string =>
  linhas.length ? `<table>${linhas.map((x) => `<tr><td>${esc(x[0])}</td><td>${esc(x[1])}</td></tr>`).join('')}</table>` : '<p class="v">Nada preenchido.</p>';

export function relatorioFinalHtml(e: EntradaRelatorio): string {
  const estilo = '<style>@page{size:A4;margin:14mm}body{font:12px/1.45 Georgia,serif;color:#111}h1{font-size:21px;margin:0 0 2px}h2{font-size:14px;margin:16px 0 5px;border-bottom:1px solid #111}'
    + 'h3{font-size:12px;margin:8px 0 2px}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:2px 4px;vertical-align:top}td:first-child{width:34%;color:#444}'
    + `.v{color:#666}.g{display:flex;flex-wrap:wrap;gap:6px}.g figure{margin:0;width:${e.larguraFoto}}.g img{width:100%;height:auto;max-height:150px;object-fit:cover}.g figcaption{font-size:10px;color:#444}</style>`;
  const fotos = e.fotos.filter((f) => typeof f.url === 'string' && f.url.startsWith('https://'));
  const data = e.emitidoEm ? `${e.emitidoEm.slice(8, 10)}/${e.emitidoEm.slice(5, 7)}/${e.emitidoEm.slice(0, 4)}` : '';
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' + estilo + '</head><body>'
    + `<h1>Relatório final${e.codigo ? ` · ${esc(e.codigo)}` : ''}</h1><p>${esc(e.cliente)}${data ? ` · emitido em ${esc(data)}` : ''}</p>`
    + e.secoes.filter((s) => s.campos.length).map((s) => `<h2>${esc(s.titulo)}</h2>${tabela(s.campos.map((c) => [c.rotulo, c.valor] as [string, string]))}`).join('')
    + '<h2>Kit vendido</h2>'
    + tabela(e.kit ? ([['Placas', e.kit.placas], ['Inversor', e.kit.inversor], ['Potência', e.kit.kwp ? `${String(e.kit.kwp).replace('.', ',')} kWp` : '']] as Array<[string, string]>).filter((x) => x[1]) : [])
    + '<h2>Excedente e rateio</h2>'
    + (e.excedente.tem === null ? '<p class="v">Não informado.</p>' : e.excedente.tem === false ? '<p>Sem excedente para outras contas.</p>'
      : tabela(e.excedente.linhas.map((l) => [`${l.papel === 'geradora' ? 'Geradora' : 'Beneficiária'} · UC ${l.uc}`, `${l.titular}${l.pct !== null ? ` · ${String(l.pct).replace('.', ',')}%` : ''}`] as [string, string])))
    + '<h2>Vistoria</h2>'
    + (e.vistoria.length ? e.vistoria.map((g) => `<h3>${esc(g.grupo)}</h3>${tabela(g.campos)}`).join('') : '<p class="v">Relatório de vistoria não preenchido.</p>')
    + (fotos.length ? `<h2>Fotos da vistoria</h2><div class="g">${fotos.map((f) => `<figure><img src="${esc(f.url)}" alt=""><figcaption>${esc(f.legenda)}</figcaption></figure>`).join('')}</div>` : '')
    + '<h2>Documentos e arquivos</h2>'
    + (e.documentos.length ? tabela(e.documentos.map((d) => [d.rotulo, d.data] as [string, string])) : '<p class="v">Nenhum arquivo anexado.</p>')
    + '</body></html>';
}

// ── Daqui para baixo NÃO é puro: o registro e a URL do PDF no bucket privado ───────────────────────────────────────────────────────

export interface MetaRelatorio { v: 1; gerado_em: string; por: string; tamanho: number; sha256: string }

/** O PDF e o registro dele, se existirem: `{ url, gerado_em }`. Erro de leitura sobe (quem chama decide). */
export async function lerRelatorioFinal(card: number, segundos = 600): Promise<{ url: string; gerado_em: string } | null> {
  const v = await lerJsonBruto(caminhoRelatorioJson(card));
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : null;
  if (!o || o.v !== 1 || typeof o.gerado_em !== 'string') return null;
  const url = await assinarArquivoBruto(caminhoRelatorioPdf(card), segundos);
  return url ? { url, gerado_em: o.gerado_em } : null;
}
