import crypto from 'crypto';
import { lerDocs, dossieDaVendaSolar, type Ctx } from './geradorClientesDocs';
import { equipamentoDoCardParaRelatorio } from './geradorClientes';
import { abrirNavegador } from '../controllers/pdfController';
import { lerLigacao } from '../services/gerador/vendaSolarHub';
import { lerCadastro } from '../services/gerador/cadastroVenda';
import { lerProposta } from '../services/gerador/dossieVenda';
import { assinarVarios } from '../services/gerador/docsClienteBanco';
import { gravarArquivoBruto, gravarJsonBruto } from '../services/gerador/cadastroVendaBanco';
import { lerJornadaComVersao } from '../services/gerador/jornadaSolarBanco';
import { lerObraPrivada } from '../services/gerador/jornadaObraBanco';
import { rateioDoCadastro } from '../services/gerador/jornadaSolar';
import { equipamentoDaProposta } from '../services/gerador/trelloVendaSolar';
import { CATALOGO, SLOTS_FORA_DO_RELATORIO, dadosVendaSolar, montarRelatorio } from '../services/gerador/docsCliente';
import {
  TETO_RELATORIO_BYTES, caminhoRelatorioJson, caminhoRelatorioPdf, kitVendido, relatorioFinalHtml, resumoDaVistoria,
  type EntradaRelatorio, type MetaRelatorio,
} from '../services/gerador/relatorioFinal';
import type { CardVendido } from '../services/gerador/fichaEletroposto';

// ─────────────────────────────────────────────────────────────────────────────
// RELATÓRIO FINAL (18/11/2026): monta a entrada do PDF a partir do que a venda já tem (cadastro, kit da proposta ligada, excedente e rateio,
// vistoria, arquivos) e o gera como o Book. SEM dinheiro, sem contrato assinado e sem recibo. Quem chama: a rota
// `POST /jornada-solar/obra/:card/relatorio-final` e o Trello automático (que anexa o PDF ao cartão).
// ─────────────────────────────────────────────────────────────────────────────

const logErro = (que: string, err: unknown): void =>
  console.error(`[relatorio-final] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? (err instanceof Error ? err.message.slice(0, 40) : 'interno'));

export interface QuemGera { nome: string; socio: boolean; card: CardVendido }
const ddmmaaaa = (iso: string): string => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const FOTOS_DA_VISTORIA: ReadonlyArray<[string, string]> = [['fachada', 'Fachada'], ['padrao', 'Padrão de entrada'], ['disjuntor', 'Disjuntor'], ['medidor', 'Medidor']];
/** Slots que NUNCA entram no relatório final, mesmo que apareçam no catálogo: o contrato assinado e o recibo; `outros` (conteúdo desconhecido) também fica fora. */
const SLOTS_FORA_DO_FINAL: ReadonlySet<string> = new Set(['contrato_assinado', 'recibo', 'outros']);

/** Monta a entrada do relatório (HTML por `relatorioFinalHtml`). Erros de leitura sobem. */
export async function entradaDoRelatorio(g: QuemGera, larguraFoto: '31%' | '15%' = '31%'): Promise<EntradaRelatorio> {
  const card = g.card;
  const ctx: Ctx = { linha: 'vendasolar', codigo: String(card.id), nome: g.nome, socio: g.socio, cliente: String(card.cliente_nome ?? ''), card };
  const [{ lig }, { reg }, cad, dv, obra, { estado }] = await Promise.all([
    lerLigacao(card.id), lerDocs(ctx), lerCadastro(card.id, 'vendasolar').catch((e) => { logErro('cadastro', e); return null; }),
    dossieDaVendaSolar(ctx, 900, true).catch((e) => { logErro('dossiê', e); return null; }),
    lerObraPrivada(card.id).catch((e) => { logErro('obra', e); return null; }), lerJornadaComVersao(card.id),
  ]);
  const proposta = lig.proposta ? await lerProposta(lig.proposta).catch((e) => { logErro('proposta', e); return null; }) : null;
  const equipProp = proposta ? equipamentoDaProposta({ qtd_placas: proposta.qtd_placas, inversor: proposta.inversor, qtd_inversor: proposta.qtd_inversor, dados: proposta.dados }) : null;
  const planilha = await equipamentoDoCardParaRelatorio(g.nome, g.socio, card, lig).catch((e) => { logErro('equipamento', e); return null; });
  const emitidoEm = new Date().toISOString();
  const rel = montarRelatorio({ linha: 'vendasolar', codigo: lig.venda ?? String(card.id), cliente: ctx.cliente, emitidoEm, dados: dadosVendaSolar(cad, planilha, ctx.cliente), documentos: [] });

  // Arquivos: só os do catálogo das etapas 1 a 3, sem contrato assinado, recibo, `outros` e os documentos de terceiros (KMZ é a exceção: só o nome).
  const arquivos = reg.arquivos.filter((a) => {
    const item = CATALOGO.vendasolar.find((x) => x.chave === a.slot);
    return !!item && item.etapa === undefined && !SLOTS_FORA_DO_FINAL.has(a.slot) && (a.slot === 'kmz' || !SLOTS_FORA_DO_RELATORIO.has(a.slot));
  });
  const documentos = arquivos.map((a) => ({ rotulo: CATALOGO.vendasolar.find((x) => x.chave === a.slot)!.rotulo, data: ddmmaaaa(a.em) }));
  const slotsNoCard = new Set(reg.arquivos.map((a) => a.slot));
  for (const a of dv?.arquivos ?? []) {
    if (slotsNoCard.has(a.slot) || SLOTS_FORA_DO_FINAL.has(a.slot) || SLOTS_FORA_DO_RELATORIO.has(a.slot)) continue;
    const item = CATALOGO.vendasolar.find((x) => x.chave === a.slot);
    if (item) documentos.push({ rotulo: `${item.rotulo} (da proposta)`, data: '' });
  }

  // Miniaturas: as 4 fotos da vistoria (card, ou dossiê da proposta no que falta) e as fotos que a vistoria da obra já guardou.
  const urls = await assinarVarios(reg.arquivos.filter((a) => /^image\//.test(a.mime)).map((a) => a.caminho), 900).catch((e) => { logErro('urls', e); return new Map<string, string>(); });
  const fotos: EntradaRelatorio['fotos'] = [];
  for (const [slot, legenda] of FOTOS_DA_VISTORIA) {
    const a = reg.arquivos.find((x) => x.slot === slot && /^image\//.test(x.mime));
    const url = a ? urls.get(a.caminho) : (dv?.arquivos ?? []).find((x) => x.slot === slot && x.url && /^image\//.test(x.mime))?.url;
    if (url) fotos.push({ legenda, url });
  }
  for (const f of obra?.vistoria?.fotos ?? []) {
    const a = reg.arquivos.find((x) => x.id === f.arquivo_id && /^image\//.test(x.mime));
    const url = a ? urls.get(a.caminho) : null;
    if (url) fotos.push({ legenda: f.leg || 'Foto', url });
  }

  const ex = estado?.etapas[1].excedente ?? null;
  return {
    cliente: ctx.cliente, codigo: lig.venda, emitidoEm, secoes: rel.secoes as EntradaRelatorio['secoes'],
    kit: kitVendido(equipProp, proposta ? (proposta.dados as Record<string, unknown>).kwp : null, estado?.etapas[1].kit_texto),
    excedente: { tem: ex === null ? null : ex === 'sim', linhas: cad && ex === 'sim' ? rateioDoCadastro(cad as never).map((l) => ({ papel: l.papel, uc: l.uc, titular: l.titular, pct: l.pct })) : [] },
    vistoria: resumoDaVistoria(obra?.vistoria ?? null), documentos, fotos, larguraFoto,
  };
}

/**
 * Gera o PDF (duas tentativas de tamanho de foto até caber em 8 MB). Não grava nada. Lança se o Chromium não abre; devolve null se passou do teto.
 */
export async function pdfDoRelatorio(g: QuemGera): Promise<Buffer | null> {
  let browser: Awaited<ReturnType<typeof abrirNavegador>> | undefined;
  try {
    browser = await abrirNavegador();
    let pdf: Buffer | null = null;
    for (const larguraFoto of ['31%', '15%'] as const) {
      const html = relatorioFinalHtml(await entradaDoRelatorio(g, larguraFoto));
      const page = await browser.newPage();
      try {
        await page.setJavaScriptEnabled(false);
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45_000 });
        pdf = Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
      } finally { await page.close().catch(() => {}); }
      if (pdf.length <= TETO_RELATORIO_BYTES) break;
    }
    return pdf && pdf.length <= TETO_RELATORIO_BYTES ? pdf : null;
  } finally { if (browser) await browser.close().catch(() => {}); }
}

/** Gera, guarda no bucket privado e devolve o PDF e o registro. `null` = ficou grande demais. */
export async function gerarRelatorioFinal(g: QuemGera): Promise<{ pdf: Buffer; gerado_em: string } | null> {
  const pdf = await pdfDoRelatorio(g);
  if (!pdf) return null;
  const gerado_em = new Date().toISOString();
  await gravarArquivoBruto(caminhoRelatorioPdf(g.card.id), pdf, 'application/pdf');
  const meta: MetaRelatorio = { v: 1, gerado_em, por: g.nome, tamanho: pdf.length, sha256: crypto.createHash('sha256').update(pdf).digest('hex') };
  await gravarJsonBruto(caminhoRelatorioJson(g.card.id), meta);
  return { pdf, gerado_em };
}
