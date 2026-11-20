import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { exigeConsultor } from './geradorDossie';
import { semCache, lerDocs } from './geradorClientesDocs';
import { camposDoContratoDaObra, contratoDaObra, etapaDaPlanilha } from './geradorJornadaSolar';
import { corpoDe, falhouJornada, guardaDaObra, logErroJornada, MSG_PEDIDO, type GuardaObra } from './geradorJornadaGuarda';
import { lerDinheiro, ondeEsta, type DadosDinheiro } from './geradorJornadaDinheiro';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { comTrava } from '../services/gerador/cadastroVendaBanco';
import { lerCadastroVisto, tipoDoCadastro } from '../services/gerador/cadastroVenda';
import { lerProposta } from '../services/gerador/dossieVenda';
import { equipamentoDaProposta } from '../services/gerador/trelloVendaSolar';
import { limparHtmlPapel } from '../services/gerador/htmlPapelSeguro';
import { lerCardsSolarVendidos, lerTodasLigacoes } from '../services/gerador/vendaSolarHub';
import {
  MOTIVOS_ESPERA, ROTULO_ESPERA, ddmm, deduzirEtapa, donosDaEtapa, estadoMaterializado, etapaAtualDoEstado, podeConcluir, somarDiasUteis, veObra,
  type EstadoJornada, type MotivoEspera,
} from '../services/gerador/jornadaSolar';
import { ehRecusa, lerPrivadoJornada, mudarJornada, type Recusa } from '../services/gerador/jornadaSolarBanco';
import {
  EQUIPES_LISTA, IDS_EQUIPE, bancoSemValor, LISTA_PRONTA, SECOES_OBRA, etapaAtualCompleta, itensIniciais, obraMaterializada, pagoDaCompra, prazoDaEtapaObra,
  somaItens, MAX_INDICACOES_POSVENDA, MAX_OCORRENCIAS_POSVENDA, normalizarCpf, normalizarPlaca, type EstadoObra, type ObraPrivada, type SecaoObra,
} from '../services/gerador/jornadaObra';
import {
  buscarNotaViva, gravarRegistroNota, liberarRegistroNota, reservarChaveNfe, lerObraComVersao, lerObraPrivada, lerTodasObras, mudarObra, mudarObraPrivada, normalizarObraPrivada, obraVazia,
  obraPrivadaVazia,
} from '../services/gerador/jornadaObraBanco';
import { cifrar, decifrar } from '../services/gerador/cofreObra';
import { chaveNfeValida } from '../services/gerador/jornadaObra';
import { avisosDoBook, camposDoTermo, termoGarantiaHtml, travaDoBook } from '../services/gerador/termoGarantia';
import { aplicarPortoes, ultimoCarimbo } from '../services/gerador/obraPortoes';
import { sincronizarPortoes } from '../services/gerador/obraSincronia';
import { grupoDoItem, orcadoApenas, serieDoInversor, statusDoKit, statusDoMaterial } from '../services/gerador/compraKit';
import { posvendaDaObra } from './geradorJornadaObraPosvenda';
import { equipamentoComContaFechada, etapasEAbas, finalDoComissionamento, forcarAbertura, itensParaQuem, podeForcarAbertura } from './geradorJornadaObraEtapas';
import { equipamentoFinal, itensParaTermo } from '../services/gerador/equipamentoFinal';
import { garantiaInstalacaoExtenso } from '../services/templateService';
import { podeVerValorDaObra, reaisBR } from '../services/gerador/jornadaDinheiro';
import { lerLeituraDoArquivo } from '../services/gerador/financeiroArquivos';
import crypto from 'crypto';
import { renderizarBookPdf } from './geradorJornadaBookPdf';
import { assinarVarios } from '../services/gerador/docsClienteBanco';
import { gravarArquivoBruto, gravarJsonBruto, lerJsonBruto } from '../services/gerador/cadastroVendaBanco';
import {
  TETO_BOOK_BYTES, caminhoBookJson, caminhoBookPdf, urlAssinadaDoBook, type MetaBook,
} from '../services/gerador/bookObra';

// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): AS ETAPAS 4 A 8. Montada dentro de /gerador por `mountJornadaObra`.
//
//   GET   /jornada-solar/obra/:card/fase2              as etapas 4 a 8, os dados, as versões, o que cada pessoa pode e a trava do Book
//   PUT   /jornada-solar/obra/:card/fase2/:secao       grava uma seção (com a versão lida; versão velha dá 409 `mudou`)
//   POST  /jornada-solar/obra/:card/fase2/nota         liga a nota fiscal a uma compra (repetida é recusada)
//   POST  /jornada-solar/obra/:card/etapa-obra         conclui a etapa da vez (4 a 8); a 8 fecha a conta
//   POST  /jornada-solar/obra/:card/esperar-obra       "Esperando" (ou volta a cobrar) nas etapas 4 a 8
//   POST  /jornada-solar/obra/:card/dinheiro/reabrir   (ADM, com motivo)   e   /dinheiro/fechar (ADM)
//   PUT   /jornada-solar/obra/:card/cofre              grava a senha do app de monitoramento (cifrada)
//   POST  /jornada-solar/obra/:card/cofre/revelar      (sócio) mostra a senha e anota quem e quando
//   GET   /jornada-solar/obra/:card/book               o Book do cliente (termo de garantia incluído), com a trava
//   GET   /jornada-solar/agenda-equipes                a semana das equipes e os conflitos
//
// Nenhuma mensagem sai daqui (nada de WhatsApp, Instagram nem e-mail): o aviso na véspera e o envio do Book são da fase 3.
// Nenhum log leva nome, valor, senha, texto livre nem caminho: só o código. O estado mora em `jornada_obra:<card>` (assinado); os dados, no
// JSON privado `<card>.obra.json`; a nota, em `fin_nf:` (assinado); a senha só existe CIFRADA.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_FECHADA = 'A conta desta obra está fechada. Só o Thiago reabre.';
const MSG_CANCELADA = 'Venda cancelada.';
export const hojeBr = (): string => diaDeBrasilia(Date.now());
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const novoId = (p: string): string => `${p}-${randomUUID().slice(0, 12)}`;
const SLOTS_DA_FASE = [
  'cert_modulo', 'cert_inversor', 'log_documento', 'log_conferencia', 'log_avaria', 'log_assinatura', 'obra_foto', 'ent_vista_geral', 'ent_arranjo', 'ent_inversor', 'ent_quadro',
  'ent_aterramento', 'ent_padrao', 'ent_etiquetas', 'ent_local_limpo', 'ent_termo_assinado', 'ent_extra', 'lib_pedido', 'lib_vistoria', 'lib_medidor', 'lib_liberacao', 'lib_exigencia',
  'pos_geracao', 'pos_conta',
];
const DEZ_DEZ = /•••/;
const mascara = (conta: string): string => {
  if (!conta) return '';
  const [a, d] = conta.split('@');
  return d ? `${a.slice(0, 2)}•••@${d}` : `${conta.slice(0, 2)}•••`;
};

// ── O que se lê de uma obra ─────────────────────────────────────────────────────────────────────────────────────────

export interface Fase2 {
  din: DadosDinheiro;
  js: EstadoJornada | null;
  jo: EstadoObra | null;
  /** O estado das etapas 4 a 8 como a tela o vê: o gravado ou, sem gravar nada, o que a Fase 1 e a dedução dizem. */
  joView: EstadoObra | null;
  privada: ObraPrivada;
  etapa: number | null;
  vend: string;
  slotsMap: Map<string, string[]>;
  docsIds: Set<string>;
  arquivos: Array<{ id: string; slot: string; em: string }>;
  /** id do arquivo -> caminho no Storage. INTERNO: nunca vai para uma resposta. */
  caminhos: Map<string, string>;
  slotsSet: Set<string>;
  contratoAnexoYmd: string | null;
  cad: Awaited<ReturnType<typeof lerCadastroVisto>>;
  proposta: Awaited<ReturnType<typeof lerProposta>>;
  vendaPrivada: Awaited<ReturnType<typeof lerPrivadoJornada>>;
}

export async function lerFase2(g: GuardaObra): Promise<Fase2> {
  const din = await lerDinheiro(g);
  const [docs, cad, vendaPrivada] = await Promise.all([
    lerDocs(g.ctx), lerCadastroVisto(g.id, 'vendasolar'), lerPrivadoJornada(g.id).catch((e) => { logErroJornada('privado', e); return null; }),
  ]);
  const proposta = din.lig.proposta ? await lerProposta(din.lig.proposta).catch((e) => { logErroJornada('proposta', e); return null; }) : null;
  const slotsMap = new Map<string, string[]>();
  for (const a of docs.reg.arquivos) slotsMap.set(a.slot, [...(slotsMap.get(a.slot) ?? []), a.id]);
  const slotsSet = new Set(slotsMap.keys());
  let deduzida: number | null = null;
  if (!din.js && !din.jo) {
    let planilha: string | undefined; let fora = false;
    if (din.lig.venda) { const pl = await etapaDaPlanilha(din.lig.venda); planilha = pl.etapaPlanilha; fora = pl.fora; }
    deduzida = deduzirEtapa({ temNumero: !!din.lig.venda, slots: slotsSet, planilha, planilhaFora: fora }).etapa;
  }
  let etapa = etapaAtualCompleta(din.js, din.jo, deduzida);
  const agora = new Date().toISOString();
  let joView = din.jo;
  if (!joView) {
    if (din.js && etapa === 4) joView = obraMaterializada(g.id, 4, din.js.etapas[4].aberta_em, agora);
    else if (!din.js && etapa !== null && etapa >= 4) joView = obraMaterializada(g.id, etapa, null, agora);
  }
  // As etapas 4 a 6 abrem pelo dado (sem botão): a tela vê o estado com os portões aplicados, mesmo antes da próxima gravação o registrar.
  // A data da visão é a ÚLTIMA GRAVADA (não "agora"): o prazo da etapa seguinte não anda a cada GET.
  const privadaLida = din.privada ?? obraPrivadaVazia();
  const docsIds0 = new Set(docs.reg.arquivos.map((a) => a.id));
  if (joView) {
    joView = aplicarPortoes(joView, { privada: privadaLida, docsIds: docsIds0, slots: slotsMap }, ultimoCarimbo(joView) ?? agora, 'leitura');
    if (!din.js || etapaAtualDoEstado(din.js) >= 4) etapa = etapaAtualCompleta(din.js, joView, deduzida);
  }
  const contratoAnexo = docs.reg.arquivos.find((a) => a.slot === 'contrato_assinado');
  return {
    din, js: din.js, jo: din.jo, joView, privada: privadaLida, etapa, vend: din.vendedor, slotsMap, slotsSet,
    docsIds: docsIds0, caminhos: new Map(docs.reg.arquivos.map((a) => [a.id, a.caminho] as [string, string])), arquivos: docs.reg.arquivos.map((a) => ({ id: a.id, slot: a.slot, em: a.em })),
    contratoAnexoYmd: contratoAnexo?.em ? diaDeBrasilia(contratoAnexo.em) : null, cad, proposta, vendaPrivada,
  };
}

export const vCad = (f: Fase2) => (k: string): string => String((f.cad.campos as Record<string, { valor?: string } | undefined>)[k]?.valor ?? '').trim();

/** O contrato com as garantias: o gravado na geração ou, para o gerado antes de 06/11/2026, o recalculado pela proposta (`fonte: 'recalculado'`). */
/** O equipamento da proposta ligada (módulos e inversor), ou null sem proposta. */
export const equipPropostaDe = (f: Fase2) =>
  equipamentoDaProposta(f.proposta ? { qtd_placas: f.proposta.qtd_placas, inversor: f.proposta.inversor, qtd_inversor: f.proposta.qtd_inversor, dados: f.proposta.dados } : null);

export function contratoDe(f: Fase2) {
  if (f.privada.contrato) return f.privada.contrato;
  const v = vCad(f);
  const campos = camposDoContratoDaObra({ proposta: f.proposta }, v, f.vendaPrivada?.venda ?? null);
  return contratoDaObra(campos, {
    cliente: { nome: v('nome'), cpf_cnpj: v('cpf_cnpj'), tipo: tipoDoCadastro(f.cad), cidade: v('cidade'), uf: v('uf'), endereco: v('endereco') },
    empresaNome: 'AIOROS LTDA', empresaCnpj: '63.636.043/0001-88', empresaTelefone: '',
  }, 'leitura', 'recalculado', new Date().toISOString());
}

/** Os itens que alimentam o termo e o Book: os comprados de cada categoria (a cotação só orçada não entra). */
const itensTermo = (f: Fase2) => itensParaTermo(f.privada.compra.itens, f.privada.compra.documentos);

function campos(f: Fase2, telefone = '') {
  const c = contratoDe(f);
  const t = f.privada.entrega.termo;
  return {
    contrato: c,
    campos: camposDoTermo({
      codigo: f.din.lig.venda ?? '*', privadaContrato: c, itensCompra: itensTermo(f), monitoramento: f.privada.entrega.monitoramento,
      termoEntrega: t, contratoData: f.contratoAnexoYmd, entregaYmd: t?.assinado_em ? diaDeBrasilia(t.assinado_em) : null,
      responsavel: f.privada.entrega.responsavel, empresaTelefone: telefone,
    }),
  };
}

function trava(f: Fase2): string[] {
  const { contrato, campos: k } = campos(f);
  return travaDoBook(k, contrato, itensTermo(f), !!f.privada.entrega.termo?.assinado_em);
}

/** O que mudou entre o comprado e a proposta: aviso, nunca trava (o equipamento final é o comprado). */
function avisosDoBookDe(f: Fase2): string[] {
  return avisosDoBook(contratoDe(f), itensTermo(f));
}

// ── O Book (miolo compartilhado pelo GET do Book e pela geração do PDF) ─────────────────────────────────────────────────────

interface DadosBook {
  titulo: string; cliente: string; cidade: string; termo_html: string; fotos: string[]; caminhos: string[];
  testes: ObraPrivada['entrega']['testes'];
  monitoramento: { app: string; conta: string; usina: string; serie: string; comissionamento: string };
  contatos: { whatsapp: string }; aviso_garantias?: string;
}

/** O Book pode sair (a trava limpa)? Para a leitura do pós-venda mostrar o botão de gerar. */
export async function bookPodeSair(g: GuardaObra): Promise<boolean> {
  const f = await lerFase2(g);
  return podeGerarBook(g, f.vend) && trava(f).length === 0;
}

/** Quem gera o Book em PDF: o ADM, o Diego (dono da entrega) e quem vendeu a obra. */
export const podeGerarBook = (g: GuardaObra, vendedor: string): boolean => g.adm || g.nome === 'diego' || (!!vendedor && g.nome === vendedor);

/** O Book só sai com a trava limpa (a mesma do `pode.book` da fase 2). A resposta do GET do Book não leva `cliente`, `cidade` nem `caminhos`. */
async function dadosDoBook(g: GuardaObra, lida?: Fase2): Promise<{ trava: string[] } | DadosBook> {
  const f = lida ?? await lerFase2(g);
  const { contrato, campos: k } = campos(f);
  const falta = travaDoBook(k, contrato, itensTermo(f), !!f.privada.entrega.termo?.assinado_em);
  if (falta.length) return { trava: falta };
  const p = f.privada;
  const fotosEntrega = ['ent_vista_geral', 'ent_arranjo', 'ent_inversor', 'ent_quadro', 'ent_aterramento', 'ent_padrao', 'ent_etiquetas', 'ent_local_limpo']
    .flatMap((s) => (f.slotsMap.get(s) ?? []).slice(0, 1));
  const doAlbum = p.obra.diario.flatMap((d) => d.fotos).filter((id) => f.docsIds.has(id)).slice(0, 12);
  const fotos = [...fotosEntrega, ...doAlbum];
  const m = p.entrega.monitoramento;
  return {
    titulo: `Book da obra · ${f.din.lig.venda ?? '*'} · ${k.cliente_nome}`,
    cliente: String(g.card.cliente_nome ?? k.cliente_nome ?? ''), cidade: String((g.card as { cidade?: unknown }).cidade ?? ''),
    termo_html: limparHtmlPapel(termoGarantiaHtml(k)),
    fotos, caminhos: fotos.map((id) => f.caminhos.get(id)).filter((c): c is string => !!c),
    testes: p.entrega.testes,
    monitoramento: { app: m.app, conta: m.conta, usina: m.usina, serie: m.serie || serieDoInversor(p.compra.itens, p.compra.documentos), comissionamento: m.comissionamento },
    contatos: { whatsapp: k.empresa_whatsapp },
    ...(contrato.fonte === 'recalculado' ? { aviso_garantias: 'Garantias lidas da proposta (contrato gerado antes de 06/11/2026).' } : {}),
  };
}

// ── Quem mexe em quê ──────────────────────────────────────────────────────────────────────────────────────────────────

export function podeSecao(g: GuardaObra, f: Fase2, secao: string): boolean {
  // A conta fechada (a etapa 8 fecha) trava o dinheiro e as etapas 4 a 8; o pós-venda (etapa 9) nasce justamente depois dela.
  if (f.din.cancelada || (f.din.fechada && secao !== 'posvenda' && secao !== 'compra')) return false;   // a Compra segue aberta só para o equipamento
  const eh = !!f.vend && g.nome === f.vend;
  const noPosVenda = f.etapa !== null && f.etapa >= 4;
  switch (secao) {
    case 'vistoria': return eh || g.nome === 'giovanna' || g.adm;   // vale já na etapa 1 (o relatório de vistoria é item da Venda)
    case 'banco': return g.nome === 'giovanna' || eh || g.adm;
    case 'compra': return noPosVenda && (g.nome === 'thiago' || g.nome === 'diego' || g.adm);
    case 'logistica': return noPosVenda && (g.nome === 'diego' || g.adm);
    case 'obra': return noPosVenda && (g.nome === 'diego' || g.nome === 'thiago' || g.adm);
    case 'entrega': return noPosVenda && (g.nome === 'diego' || g.adm);
    case 'liberacao': return noPosVenda && (g.nome === 'thiago' || g.adm);
    // Pós-venda: só com a etapa 9 aberta (a 8 concluída). Giovanna, ADM e o dono da etapa 9 (quem vendeu).
    case 'posvenda': return f.etapa === 9 && (g.nome === 'giovanna' || g.adm || donosDaEtapa(9, f.vend).includes(g.nome));
    default: return false;
  }
}

/** Garante os dois estados gravados (a `jornada_solar` primeiro, depois a `jornada_obra`). A leitura nunca materializa; a primeira ESCRITA, sim. */
export async function prepararEscrita(g: GuardaObra, f: Fase2): Promise<void> {
  const agora = new Date().toISOString();
  let aberta4 = f.js?.etapas[4].aberta_em ?? null;
  if (!f.js) {
    const r = await mudarJornada(g.id, () => estadoMaterializado(g.id, f.vend, 4, agora), (e) => e);
    if (!ehRecusa(r)) aberta4 = r.etapas[4].aberta_em;
  }
  if (!f.jo) {
    const alvo = f.etapa !== null && f.etapa >= 4 ? f.etapa : 4;
    await mudarObra(g.id, () => obraMaterializada(g.id, alvo, aberta4, agora), (e) => e);
  }
}

// ── O corpo do GET (e da resposta de todo PUT) ────────────────────────────────────────────────────────────────────────

export async function corpoFase2(g: GuardaObra, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const f = await lerFase2(g);
  const hoje = hojeBr();
  const p = f.privada;
  const veDin = f.din.veDinheiro;
  const veValorVenda = podeVerValorDaObra(g, f.din.ajustes, !!f.vend && g.nome === f.vend);   // regra (a): o valor da proposta de banco é valor da venda
  const { etapas, abas } = etapasEAbas(g, f, hoje);
  const atual = f.etapa;
  const aberta = !f.din.cancelada && !f.din.fechada && atual !== null && atual >= 4 && atual <= 8;
  const secoes = SECOES_OBRA.filter((s) => s !== 'previsto' && podeSecao(g, f, s));
  const book = trava(f);
  const mat = f.din.livro.fechamento.material;
  const mascarar = (n: number | null): number | null => (veDin ? n : null);
  const compras = p.compra.compras.map((c) => {
    const soma = somaItens(p, c.id);
    const pago = pagoDaCompra(c.id, f.din.lancamentos);
    return { ...c, pago_centavos: veDin ? pago : null, a_pagar_centavos: veDin ? Math.max(0, soma - pago) : null };
  });
  const equipProp = equipPropostaDe(f);
  // Os `sugeridos` são só o kit da proposta (módulos e inversor); a lista pronta de material vai à parte, em `lista_pronta`.
  const sugeridos = atual !== null && atual >= 4 && !f.din.fechada && p.compra.itens.length === 0 ? itensIniciais(equipProp) : [];
  const kit = statusDoKit(p.compra.itens, p.compra.documentos);
  const material = statusDoMaterial(p.compra.itens, p.compra.documentos);
  const docsCompra = p.compra.documentos.map((d) => ({ ...d, total_centavos: mascarar(d.total_centavos) }));
  const final = finalDoComissionamento(g, f);
  const contrato = contratoDe(f);
  const e = p.entrega;
  return {
    ok: true, etapa_atual: atual, fechada: f.jo?.fechada ?? null, esperando: f.jo?.esperando ?? null,
    etapas,
    pode: {
      // Nenhuma etapa tem botão Concluir (a lista segue no contrato, vazia); o `finalizar` é o botão único "Concluir e preencher a planilha" do Comissionamento. As 4 a 7 abrem sozinhas.
      concluir: [] as number[],
      finalizar: final.pode, finalizar_pronto: final.pronto, planilha: !f.din.cancelada && podeConcluir(g.nome, 8, f.vend) && !!f.jo?.etapas[8].concluida_em,
      esperar: aberta && (g.adm || donosDaEtapa(atual as number, f.vend).includes(g.nome)),
      // Só o ADM: abre a próxima etapa da obra que ficou presa (POST etapa-obra com `forcar: true`).
      forcar: podeForcarAbertura(g, f),
      // Editar o equipamento dos itens da Compra (descrição, marca, modelo, potência, quantidade, garantias, série): vale até com a conta fechada.
      equipamento: podeSecao(g, f, 'compra'),
      secoes, nota: !f.din.fechada && (secoes.includes('compra') || secoes.includes('logistica')),
      cofre_gravar: !f.din.cancelada && !f.din.fechada && (g.nome === 'diego' || g.adm) && atual !== null && atual >= 4,
      cofre_revelar: g.socio,
      fechar: g.adm && !!f.jo?.etapas[8].concluida_em && !f.jo?.fechada && !f.din.cancelada,
      reabrir: g.adm && !!f.jo?.fechada,
      book: book.length === 0,
    },
    dados: {
      vistoria: p.vistoria, banco: veValorVenda ? p.banco : bancoSemValor(p.banco),
      compra: {
        // `grupo`: 'kit' (módulos, inversor, estrutura) ou 'material' (o resto). Valor (pago e orçado) só para quem vê o livro.
        itens: p.compra.itens.map((i) => ({ ...i, grupo: grupoDoItem(i), orcado_apenas: orcadoApenas(i, p.compra.documentos), valor_centavos: mascarar(i.valor_centavos), orcado_centavos: mascarar(i.orcado_centavos) })), compras, documentos: docsCompra,
        contador: { com_origem: mat.com_origem, total: mat.total }, sugeridos,
        kit: { completo: kit.completo, faltam: kit.faltam, comprados: kit.comprados, total: kit.total, ids: kit.ativos.map((i) => i.id) },
        material: { comprados: material.comprados, total: material.total, completo: material.completo },
      },
      equipamento_final: equipamentoFinal(p.compra.itens, equipProp, p.compra.documentos, p.entrega.monitoramento.serie),
      logistica: { cargas: p.logistica.cargas.map((c) => ({ ...c, frete: { ...c.frete, valor_centavos: mascarar(c.frete.valor_centavos) } })) }, obra: { ...p.obra, equipe: { ...p.obra.equipe, combinado_centavos: mascarar(p.obra.equipe.combinado_centavos) } },
      entrega: {
        testes: e.testes, monitoramento: { ...e.monitoramento, conta: mascara(e.monitoramento.conta), conta_mascarada: mascara(e.monitoramento.conta) },
        cofre: e.cofre ? { gravado: true, em: e.cofre.em, por: e.cofre.por } : null,
        cofre_revelado: e.cofre_revelado, garantias: e.garantias, termo: e.termo, responsavel: e.responsavel, observacoes: e.observacoes,
      },
      liberacao: p.liberacao,
      posvenda: p.posvenda,
      contrato_garantias: {
        modulos: contrato.garantia_modulos_anos, inversor: contrato.garantia_inversor_anos,
        instalacao: garantiaInstalacaoExtenso({ garantia_instalacao_anos: contrato.garantia_instalacao_anos, garantia_instalacao_unidade: contrato.garantia_instalacao_unidade }),
        fonte: contrato.fonte,
      },
    },
    versoes: p.versoes,
    posvenda_info: posvendaDaObra(f, contratoDe(f), vCad(f)('nome') || String(g.card.cliente_nome ?? '')),
    book: { pode: book.length === 0, trava: book, avisos: avisosDoBookDe(f) },
    abas, finalizar: { falta: final.falta.map((i) => ({ chave: i.chave, texto: i.texto, nivel: i.nivel, grupo: i.grupo })) },
    lista_pronta: LISTA_PRONTA, equipes: EQUIPES_LISTA,
    arquivos: f.arquivos.filter((a) => SLOTS_DA_FASE.includes(a.slot)),
    ...extra,
  };
}

// ── A seção que o PUT grava ───────────────────────────────────────────────────────────────────────────────────────────

/** Monta o `obra.json` novo com a seção do PUT. O servidor protege: id e dono dos que já existem, `criado_*`, cofre, contrato, regra, previsto e reaberturas. */
function aplicarSecao(secao: SecaoObra, p: ObraPrivada, dadosBrutos: Record<string, unknown>, g: GuardaObra, f: Fase2): ObraPrivada | Recusa {
  const agora = new Date().toISOString();
  const d = dadosBrutos;
  if (secao === 'vistoria') return normalizarObraPrivada({ ...p, vistoria: d });
  if (secao === 'banco') {
    const novo = normalizarObraPrivada({ ...p, banco: d });
    // Quem não vê o dinheiro não recebeu os valores da proposta de banco: o servidor mantém os que já existem.
    if (!podeVerValorDaObra(g, f.din.ajustes, !!f.vend && g.nome === f.vend) && novo.banco) { novo.banco.eq_centavos = p.banco?.eq_centavos ?? null; novo.banco.mo_centavos = p.banco?.mo_centavos ?? null; }
    return novo;
  }
  if (secao === 'compra') {
    if (f.din.fechada) return equipamentoComContaFechada(p, dadosBrutos, f.din.veDinheiro);   // conta fechada: só o equipamento dos itens muda; dinheiro e compras ficam
    const etapa6Aberta = !!f.joView?.etapas[6].aberta_em;
    const compras = lista(d.compras).slice(0, 20).map((c) => {
      const o = obj(c) ?? {};
      const ex = p.compra.compras.find((x) => x.id === o.id);
      return { ...o, id: ex ? ex.id : novoId('c'), nota: ex?.nota ?? null };
    });
    const idsCompra = new Set(compras.map((c) => c.id));
    const itens = lista(d.itens).slice(0, 80).map((i) => {
      const o = obj(i) ?? {};
      const ex = p.compra.itens.find((x) => x.id === o.id);
      const pode6 = (g.adm || g.nome === 'diego') && etapa6Aberta;
      return {
        ...o, id: ex ? ex.id : novoId('i'), criado_por: ex?.criado_por ?? g.nome, criado_em: ex?.criado_em ?? agora,
        // 'arquivo' é do servidor (a leitura): quem digita nem cria item com essa origem, nem muda a de um que já existe (o item só orçado não conta).
        origem: ex?.origem === 'arquivo' ? 'arquivo' : (o.origem === 'arquivo' ? (ex?.origem ?? 'manual') : o.origem),
        compra_id: typeof o.compra_id === 'string' && idsCompra.has(o.compra_id) ? o.compra_id : null,
        etapa: o.etapa === 6 && (pode6 || ex?.etapa === 6) ? 6 : 4,
        // O tique "Comprado" é da pessoa (ou da leitura); campo ausente mantém o que já estava. De onde veio o item e o documento ligado são do servidor.
        comprado: typeof o.comprado === 'boolean' ? o.comprado : (ex?.comprado ?? false),
        orcado_centavos: 'orcado_centavos' in o ? o.orcado_centavos : (ex?.orcado_centavos ?? null),
        lido_de: ex?.lido_de ?? '', documento_id: ex?.documento_id ?? '', serie: 'serie' in o ? o.serie : (ex?.serie ?? ''),
      };
    });
    const novo = normalizarObraPrivada({ ...p, compra: { itens, compras, documentos: p.compra.documentos } });
    // Quem não vê o dinheiro (Ajustes com `dinheiro_aberto` desligado) recebeu `null` nos valores: o servidor restaura o do item que já existe.
    if (!f.din.veDinheiro) {
      for (const i of novo.compra.itens) {
        const antes = p.compra.itens.find((x) => x.id === i.id);
        i.valor_centavos = antes?.valor_centavos ?? null;
        i.orcado_centavos = antes?.orcado_centavos ?? null;
      }
    }
    for (const c of p.compra.compras) {
      const pago = pagoDaCompra(c.id, f.din.lancamentos);
      if (pago <= 0) continue;
      if (!novo.compra.compras.some((x) => x.id === c.id)) return { recusa: 'Esta compra já tem pagamento: não sai da lista.', http: 409 };
      const soma = somaItens(novo, c.id);
      if (soma < pago) return { recusa: `Os itens somam ${reaisBR(soma)}. Já foi pago ${reaisBR(pago)} nesta compra.`, http: 409 };
    }
    return novo;
  }
  if (secao === 'logistica') {
    // CPF e placa digitados têm que valer (vazio pode: a obrigação mora no portão da etapa 5).
    const brutas = lista(d.cargas).slice(0, 12);
    for (let i = 0; i < brutas.length; i++) {
      const o = obj(brutas[i]) ?? {};
      const tr = obj(o.transporte) ?? {};
      const rb = obj(o.recebido_por) ?? {};
      const preenchido = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
      if (preenchido(tr.cpf) && !normalizarCpf(tr.cpf)) return { recusa: `Carga ${i + 1}: o CPF de quem buscou não é válido.`, http: 400 };
      if (preenchido(tr.placa) && !normalizarPlaca(tr.placa)) return { recusa: `Carga ${i + 1}: a placa de quem buscou não é válida. Use ABC1D23 ou ABC1234.`, http: 400 };
      if (preenchido(rb.cpf) && !normalizarCpf(rb.cpf)) return { recusa: `Carga ${i + 1}: o CPF de quem recebeu não é válido.`, http: 400 };
    }
    const idsItens = new Set(p.compra.itens.map((i) => i.id));
    const idsCompras = new Set(p.compra.compras.map((c) => c.id));
    const cargas = lista(d.cargas).slice(0, 12).map((c) => {
      const o = obj(c) ?? {};
      const ex = p.logistica.cargas.find((x) => x.id === o.id);
      const conf = obj(o.conferencia) ?? {};
      return {
        ...o, id: ex ? ex.id : novoId('g'),
        itens: lista(o.itens).filter((x): x is string => typeof x === 'string' && idsItens.has(x)),
        compras: lista(o.compras).filter((x): x is string => typeof x === 'string' && idsCompras.has(x)),
        conferencia: { ...conf, itens_ok: lista(conf.itens_ok).filter((x): x is string => typeof x === 'string' && idsItens.has(x)) },
      };
    });
    const novo = normalizarObraPrivada({ ...p, logistica: { cargas } });
    if (!f.din.veDinheiro) {
      for (const c of novo.logistica.cargas) c.frete.valor_centavos = p.logistica.cargas.find((x) => x.id === c.id)?.frete.valor_centavos ?? null;
    }
    return novo;
  }
  if (secao === 'obra') {
    // O Thiago só mexe no plano (os dias e as equipes); o resto da obra é do Diego e do ADM.
    if (g.nome === 'thiago' && !g.adm) return normalizarObraPrivada({ ...p, obra: { ...p.obra, plano: d.plano } });
    const novo = normalizarObraPrivada({ ...p, obra: d });
    if (!f.din.veDinheiro) novo.obra.equipe.combinado_centavos = p.obra.equipe.combinado_centavos;
    return novo;
  }
  if (secao === 'entrega') {
    const mon = obj(d.monitoramento) ?? {};
    const contaIn = typeof mon.conta === 'string' ? mon.conta : '';
    const tm = obj(d.termo);
    const ex = p.entrega.termo;
    const termo = tm ? { ...tm, assinado_em: ex && ex.arquivo_id === tm.arquivo_id && ex.assinado_em ? ex.assinado_em : agora } : null;
    return normalizarObraPrivada({
      ...p,
      entrega: {
        ...d, cofre: p.entrega.cofre, cofre_revelado: p.entrega.cofre_revelado,
        monitoramento: { ...mon, conta: DEZ_DEZ.test(contaIn) ? p.entrega.monitoramento.conta : contaIn },
        termo, responsavel: typeof d.responsavel === 'string' && d.responsavel ? d.responsavel : (p.entrega.responsavel || g.nome),
      },
    });
  }
  if (secao === 'liberacao') {
    const exigencias = lista(d.exigencias).map((x) => {
      const o = obj(x) ?? {};
      return typeof o.em === 'string' && o.em ? o : { ...o, em: agora, por: g.nome };
    });
    return normalizarObraPrivada({ ...p, liberacao: { passos: d.passos, exigencias } });
  }
  if (secao === 'posvenda') {
    const ocIn = lista(d.ocorrencias);
    const inIn = lista(d.indicacoes);
    if (ocIn.length > MAX_OCORRENCIAS_POSVENDA) return { recusa: `No máximo ${MAX_OCORRENCIAS_POSVENDA} ocorrências.`, http: 400 };
    if (inIn.length > MAX_INDICACOES_POSVENDA) return { recusa: `No máximo ${MAX_INDICACOES_POSVENDA} indicações.`, http: 400 };
    const hoje = hojeBr();
    // O arquivo só vale se está mesmo no slot certo desta obra.
    const noSlot = (slot: string, id: unknown): string => (typeof id === 'string' && (f.slotsMap.get(slot) ?? []).includes(id) ? id : '');
    const ge = obj(d.geracao_mes1) ?? {};
    const co = obj(d.conta1) ?? {};
    // O servidor protege id e data de criação das linhas que já existem; linha nova ganha id novo e a data de hoje.
    const ocorrencias = ocIn.map((x) => { const o = obj(x) ?? {}; const ex = p.posvenda.ocorrencias.find((y) => y.id === o.id); return { ...o, id: ex ? ex.id : novoId('o'), em: ex?.em ?? hoje }; });
    const indicacoes = inIn.map((x) => { const o = obj(x) ?? {}; const ex = p.posvenda.indicacoes.find((y) => y.id === o.id); return { ...o, id: ex ? ex.id : novoId('n'), em: ex?.em ?? hoje }; });
    return normalizarObraPrivada({
      ...p,
      posvenda: {
        avaliacao: d.avaliacao, geracao_mes1: { ...ge, print_id: noSlot('pos_geracao', ge.print_id) },
        conta1: { ...co, arquivo_id: noSlot('pos_conta', co.arquivo_id) }, ocorrencias, indicacoes,
      },
    });
  }
  return { recusa: MSG_PEDIDO, http: 400 };
}

export const fraseNotaRepetida = (onde: string): string => (onde === 'esta obra' ? 'Esta nota já foi lançada nesta obra.' : onde === 'outra obra' ? 'Esta nota já foi lançada em outra obra.'
  : onde === 'um card do eletroposto' ? 'Esta nota já foi lançada num card do eletroposto.' : `Esta nota já foi lançada na obra ${onde.replace(/^a obra /, '')}.`);

// ── As rotas ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function mountJornadaObra(router: Router): void {
  const base = [exigeConsultor, semCache];

  // ── Rota 1 · As etapas 4 a 8 ──────────────────────────────────────────────────────────────────────────────────────────
  router.get('/jornada-solar/obra/:card/fase2', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    try { res.json(await corpoFase2(g)); } catch (err) { falhouJornada(res, 'fase2', err, true); }
  });

  // ── Rota 2 · Grava uma seção ──────────────────────────────────────────────────────────────────────────────────────────
  router.put('/jornada-solar/obra/:card/fase2/:secao', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const secao = String(req.params.secao ?? '') as SecaoObra;
    const b = corpoDe(req);
    const dados = b ? obj(b.dados) : null;
    if (!SECOES_OBRA.includes(secao) || secao === 'previsto' || !b || !dados || typeof b.versao !== 'number' || !Number.isInteger(b.versao)) {
      res.status(400).json({ ok: false, error: MSG_PEDIDO }); return;
    }
    const versaoLida: number = b.versao;
    // Compra, logística e obra mexem no que o fechamento confere (material, frete, equipe): rodam DENTRO da trava da conta, junto com o fechamento.
    const corpo = async (): Promise<void> => {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: MSG_CANCELADA }); return; }
      if (f.din.fechada && secao !== 'posvenda' && secao !== 'compra') { res.status(409).json({ ok: false, error: MSG_FECHADA }); return; }
      if (!podeSecao(g, f, secao)) { res.status(403).json({ ok: false, error: 'Você não pode mexer nesta parte agora.' }); return; }
      if (secao !== 'vistoria' && secao !== 'banco') await prepararEscrita(g, f);
      const numeroPedido = secao === 'liberacao'
        ? (typeof dados.pedido_numero === 'string' ? dados.pedido_numero : (typeof obj(obj(dados.passos)?.pedido)?.numero === 'string' ? String(obj(obj(dados.passos)?.pedido)?.numero) : ''))
        : '';
      const r = await mudarObraPrivada(g.id, g.nome, secao, versaoLida, (p) => aplicarSecao(secao, p, dados, g, f));
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa, ...(r.extra ?? {}) }); return; }
      // Compra, Logística e Obra abrem a etapa seguinte pelo dado: o portão é conferido (e a etapa registrada, uma vez só) em toda gravação delas.
      if (secao === 'compra' || secao === 'logistica' || secao === 'obra' || secao === 'entrega') await sincronizarPortoes(g, f, r);
      const extra: Record<string, unknown> = {};
      if (secao === 'obra') {
        const dias = r.obra.plano.filter((x) => IDS_EQUIPE.includes(x.equipe)).map((x) => ({ data: x.data, equipe: x.equipe }));
        await mudarObra(g.id, () => obraVazia(g.id), (e) => ({ ...e, dias_obra: dias }));
        const todas = await lerTodasObras();
        const conflitos: Array<{ equipe: string; data: string; cards: number[] }> = [];
        for (const dia of dias) {
          const outros = [...todas.entries()].filter(([card, o]) => card !== g.id && o.dias_obra.some((x) => x.data === dia.data && x.equipe === dia.equipe)).map(([card]) => card);
          if (outros.length) conflitos.push({ equipe: dia.equipe, data: dia.data, cards: outros });
        }
        extra.conflitos = conflitos;
      }
      if (secao === 'liberacao' && /^[A-Za-z0-9./-]{1,40}$/.test(numeroPedido)) {
        const em = r.liberacao.passos.pedido?.data ?? hojeBr();
        await mudarObra(g.id, () => obraVazia(g.id), (e) => ({
          ...e, pedido: { numero: numeroPedido, em },
          historico: [...e.historico, { em: new Date().toISOString(), por: g.nome, acao: 'pedido' as const, etapa: 8 }].slice(-50),
        }));
      }
      res.json(await corpoFase2(g, extra));
    };
    try { if (secao === 'compra' || secao === 'logistica' || secao === 'obra') await comTrava(`fin_conta:${g.id}`, g.nome, corpo); else await corpo(); }
    catch (err) { if (!res.headersSent) falhouJornada(res, 'fase2-secao', err); }
  });

  // ── Rota 3 · A nota fiscal de uma compra ─────────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/fase2/nota', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    if (!b || typeof b.compra_id !== 'string' || typeof b.arquivo_path !== 'string' || (b.trocar !== undefined && typeof b.trocar !== 'boolean')) {
      res.status(400).json({ ok: false, error: MSG_PEDIDO }); return;
    }
    const compraId = b.compra_id;
    const caminho = b.arquivo_path;
    try {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: MSG_CANCELADA }); return; }
      if (f.din.fechada) { res.status(409).json({ ok: false, error: MSG_FECHADA }); return; }
      if (!podeSecao(g, f, 'compra') && !podeSecao(g, f, 'logistica')) { res.status(403).json({ ok: false, error: 'Você não pode anexar a nota agora.' }); return; }
      const compra = f.privada.compra.compras.find((c) => c.id === compraId);
      if (!compra) { res.status(400).json({ ok: false, error: 'compra_invalida', mensagem: 'Esta compra não existe.' }); return; }
      if (!/^fin\/\d+\/\d{6}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf|xml)$/.test(caminho) || !caminho.startsWith(`fin/${g.id}/`)) {
        res.status(400).json({ ok: false, error: 'comprovante_nao_encontrado', mensagem: 'Anexe a nota de novo.' }); return;
      }
      const reg = await lerLeituraDoArquivo(caminho);
      const sha = reg && typeof reg.sha256 === 'string' && /^[0-9a-f]{64}$/.test(reg.sha256) ? reg.sha256 : '';
      if (!reg || reg.card_id !== g.id || reg.path !== caminho || !sha) { res.status(400).json({ ok: false, error: 'comprovante_nao_encontrado', mensagem: 'Anexe a nota de novo.' }); return; }
      if (reg.doc !== 'nota') { res.status(400).json({ ok: false, error: 'nao_e_nota', mensagem: 'Este arquivo foi anexado como comprovante, não como nota.' }); return; }
      const lida = obj(reg.nota);
      const chave = lida && typeof lida.chave === 'string' && chaveNfeValida(lida.chave) ? lida.chave : null;
      await prepararEscrita(g, f);
      const saida = await comTrava(`fin_nf:${sha.slice(0, 32)}`, g.nome, async (): Promise<{ http: number; json: Record<string, unknown> }> => {
        const achada = await buscarNotaViva(sha, chave);
        if (achada && !(achada.card === g.id && achada.compra_id === compraId)) {
          const onde = await ondeEsta(g, { card: achada.card, id: achada.id });
          return { http: 409, json: { ok: false, error: 'nota_repetida', onde, mensagem: fraseNotaRepetida(onde) } };
        }
        const atual = compra.nota;
        if (atual && !b.trocar && atual.sha256 === sha) return { http: 200, json: { ok: true, repetido_pedido: true } };
        if (atual && !b.trocar) return { http: 409, json: { ok: false, error: 'compra_com_nota', mensagem: 'Esta compra já tem nota. Use Trocar a nota.' } };
        const nfId = novoId('nf');
        if (!(await gravarRegistroNota(g.id, { id: nfId, compra_id: compraId, sha256: sha, chave, livre: false, em: new Date().toISOString(), por: g.nome }))) {
          return { http: 409, json: { ok: false, error: 'mudou', mensagem: 'Outra pessoa anexou agora. Tente de novo.' } };
        }
        // Daqui até a compra ficar com a nota, qualquer saída que não seja o 200 (recusa, 409 ou falha) solta o registro novo: nunca fica órfão.
        let ficou = false;
        try {
          if (chave) {
            const rv = await reservarChaveNfe(chave, { card: g.id, compra_id: compraId, nf_id: nfId });
            if (!rv.ok) {
              if ('dono' in rv) {
                const onde = await ondeEsta(g, { card: rv.dono.card, id: rv.dono.id });
                return { http: 409, json: { ok: false, error: 'nota_repetida', onde, mensagem: fraseNotaRepetida(onde) } };
              }
              if ('reservada' in rv) {
                return { http: 409, json: { ok: false, error: 'nota_reservada', mensagem: 'Esta nota já está reservada. Se for engano, o Thiago libera.' } };
              }
              return { http: 409, json: { ok: false, error: 'mudou', mensagem: 'Outra pessoa anexou agora. Tente de novo.' } };
            }
          }
          const r = await mudarObraPrivada(g.id, g.nome, null, null, (p) => ({
            ...p, compra: { ...p.compra, compras: p.compra.compras.map((c) => (c.id === compraId ? { ...c, nota: { path: caminho, sha256: sha, numero: String(lida?.numero ?? ''), chave: chave ?? '', nf_id: nfId } } : c)) },
          }));
          if (ehRecusa(r)) return { http: r.http, json: { ok: false, error: r.recusa } };
          ficou = true;
        } finally {
          if (!ficou) {
            // Só o código vai ao log. Falha ao soltar não troca a resposta nem esconde o erro original.
            try { if (!(await liberarRegistroNota(g.id, nfId))) logErroJornada('nota_registro_novo_nao_liberado', { codigo: 'nao_liberado' }); }
            catch (e) { logErroJornada('nota_registro_novo_liberar', e); }
          }
        }
        if (atual?.nf_id) await liberarRegistroNota(g.id, atual.nf_id);
        return { http: 200, json: { ok: true } };
      });
      if (saida.http !== 200) { res.status(saida.http).json(saida.json); return; }
      const itens = lida ? lista(lida.itens).map((i) => obj(i) ?? {}) : [];
      const data = lida && typeof lida.data === 'string' ? lida.data : null;
      const total = lida && typeof lida.valor_total_centavos === 'number' ? lida.valor_total_centavos : null;
      const emitente = lida ? String(lida.emitente ?? '') : '';
      const ehXml = lida?.origem === 'xml';
      const nItens = ehXml && Number.isInteger(lida?.itens_na_nota) ? Number(lida?.itens_na_nota) : itens.length;
      const num = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
      const mensagem = lida && (emitente || total !== null)
        ? `${ehXml ? 'O XML foi lido' : 'A nota foi lida'}: ${[emitente, data ? ddmm(data) : '', `${nItens} ${nItens === 1 ? 'item' : 'itens'}`, total !== null ? reaisBR(total) : ''].filter(Boolean).join(' · ')}`
        : 'A nota foi anexada. Não consegui ler os itens: digite à mão.';
      res.json({ ok: true, lida: lida ? {
        emitente, data, n_itens: nItens, valor_total_centavos: total, itens, origem: ehXml ? 'xml' : 'ia',
        soma_itens_centavos: num(lida.soma_itens_centavos), diferenca_centavos: num(lida.diferenca_centavos) ?? 0,
      } : null, mensagem });
    } catch (err) { falhouJornada(res, 'nota', err); }
  });

  // ── Rota 4 · Conclui a etapa da vez (4 a 8) ───────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/etapa-obra', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    const n = b ? b.etapa : undefined;
    if (!b || typeof n !== 'number' || !Number.isInteger(n) || n < 4 || n > 8) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    // Compra, Logística, Obra e Entrega abrem a etapa seguinte sozinhas, pelo dado: não há botão Concluir nelas. A liberação (8) fecha pelo botão final.
    if (n < 8) {
      if (b.forcar !== true) { res.status(409).json({ ok: false, abre_sozinha: true, error: 'Esta etapa abre a próxima sozinha quando o dado que importa existe. Não há botão Concluir.' }); return; }
      // `forcar: true` (só ADM, `motivo` opcional): abre a próxima etapa da obra presa. Vale o histórico com o nome do ADM.
      try {
        const f = await lerFase2(g);
        const s = await forcarAbertura(g, f, n as 4 | 5 | 6 | 7, b.motivo, () => prepararEscrita(g, f));
        res.status(s.http).json(s.json);
      } catch (err) { if (!res.headersSent) falhouJornada(res, 'etapa-obra-forcar', err); }
      return;
    }
    // A etapa 8 só conclui e fecha a conta pelo botão final "Concluir e preencher a planilha" (comissionamento/concluir), nem com `forcar`.
    res.status(409).json({ ok: false, error: 'A obra conclui pelo botão "Concluir e preencher a planilha".', usar: 'comissionamento/concluir' });
  });

  // ── Rota 5 · Esperando (4 a 8) ────────────────────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/esperar-obra', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    if (!b) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    const voltar = b.voltar === true;
    const motivo = b.motivo as MotivoEspera;
    const ate = typeof b.ate === 'string' ? b.ate : '';
    if (!voltar && (!MOTIVOS_ESPERA.includes(motivo) || !/^\d{4}-\d{2}-\d{2}$/.test(ate))) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    try {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: MSG_CANCELADA }); return; }
      if (f.din.fechada) { res.status(409).json({ ok: false, error: MSG_FECHADA }); return; }
      const n = f.etapa;
      if (n === null || n < 4 || n > 8) { res.status(409).json({ ok: false, error: 'Esta etapa não aceita espera.' }); return; }
      if (!(g.adm || donosDaEtapa(n, f.vend).includes(g.nome))) { res.status(403).json({ ok: false, error: 'Você não pode pôr esta obra em espera agora.' }); return; }
      const hoje = hojeBr();
      if (!voltar) {
        let teto = somarDiasUteis(hoje, 5);
        if (motivo === 'cemig' && n === 8 && f.joView?.pedido) {
          const cemig = prazoDaEtapaObra(8, f.js, f.joView).vence;
          if (cemig && cemig > teto) teto = cemig;
        }
        if (ate <= hoje || ate > teto) { res.status(400).json({ ok: false, error: `A espera vai até 5 dias úteis. Escolha até ${ddmm(teto)}.` }); return; }
      }
      await prepararEscrita(g, f);
      const r = await mudarObra(g.id, () => obraVazia(g.id), (e) => {
        const agora = new Date().toISOString();
        const et = etapaAtualCompleta(null, e, null);
        if (et === null || et < 4 || et > 8) return { recusa: 'Esta etapa não aceita espera.', http: 409 } as Recusa;
        return {
          ...e, esperando: voltar ? null : { motivo, ate, etapa: et as 4 | 5 | 6 | 7 | 8, em: agora, por: g.nome },
          historico: [...e.historico, { em: agora, por: g.nome, acao: voltar ? 'voltar' as const : 'esperar' as const, etapa: et }].slice(-50),
        };
      });
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
      res.json({ ok: true, texto: voltar ? null : `Esperando até ${ddmm(ate)} · ${ROTULO_ESPERA[motivo]}` });
    } catch (err) { falhouJornada(res, 'esperar-obra', err); }
  });

  // ── Rota 6 · Reabre a conta (ADM, com motivo) ────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/dinheiro/reabrir', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    if (!g.adm) { res.status(403).json({ ok: false, error: 'Só o administrador reabre a conta.' }); return; }
    const b = corpoDe(req);
    const motivo = b && typeof b.motivo === 'string' ? b.motivo.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
    if (motivo.length < 3 || motivo.length > 300) { res.status(400).json({ ok: false, error: 'motivo_invalido', mensagem: 'Diga o motivo de reabrir a conta.' }); return; }
    try {
      const { estado } = await lerObraComVersao(g.id);
      if (!estado?.fechada) { res.status(409).json({ ok: false, error: 'A conta não está fechada.' }); return; }
      const agora = new Date().toISOString();
      // O motivo mora no `obra.json` (texto livre); o `system_state` guarda só quem e quando.
      const m = await mudarObraPrivada(g.id, g.nome, null, null, (p) => ({ ...p, reaberturas: [...p.reaberturas, { em: agora, por: g.nome, motivo }].slice(-10) }));
      if (ehRecusa(m)) { res.status(m.http).json({ ok: false, error: m.recusa }); return; }
      const r = await mudarObra(g.id, () => obraVazia(g.id), (e) => (e.fechada ? {
        ...e, fechada: null, reaberturas: [...e.reaberturas, { em: agora, por: g.nome }].slice(-10),
        historico: [...e.historico, { em: agora, por: g.nome, acao: 'reabrir' as const, etapa: 8 }].slice(-50),
      } : { recusa: 'A conta não está fechada.', http: 409 } as Recusa));
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
      res.json({ ok: true });
    } catch (err) { falhouJornada(res, 'reabrir', err); }
  });

  // ── Rota 7 · Fecha a conta (ADM, só com a etapa 8 concluída) ─────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/dinheiro/fechar', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    if (!g.adm) { res.status(403).json({ ok: false, error: 'Só o administrador fecha a conta.' }); return; }
    const corpo = async (): Promise<void> => {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: MSG_CANCELADA }); return; }
      if (!f.jo?.etapas[8].concluida_em) { res.status(409).json({ ok: false, error: 'A etapa 8 ainda não foi concluída.' }); return; }
      if (f.jo.fechada) { res.status(409).json({ ok: false, error: 'A conta já está fechada.' }); return; }
      const fe = f.din.livro.fechamento;
      if (!fe.pode_fechar) { res.status(409).json({ ok: false, error: `Falta: ${fe.faltam.join('; ')}.`, faltam: fe.faltam }); return; }
      const agora = new Date().toISOString();
      const r = await mudarObra(g.id, () => obraVazia(g.id), (e) => (e.fechada ? { recusa: 'A conta já está fechada.', http: 409 } as Recusa : {
        ...e, fechada: { em: agora, por: g.nome }, historico: [...e.historico, { em: agora, por: g.nome, acao: 'fechar' as const, etapa: 8 }].slice(-50),
      }));
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
      res.json({ ok: true, fechada: r.fechada });
    };
    try { await comTrava(`fin_conta:${g.id}`, g.nome, corpo); }
    catch (err) { if (!res.headersSent) falhouJornada(res, 'fechar', err); }
  });

  // ── Rota 8 · Grava a senha no cofre ──────────────────────────────────────────────────────────────────────────────────
  router.put('/jornada-solar/obra/:card/cofre', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    const senha = b && typeof b.senha === 'string' ? b.senha : '';
    if (!senha || senha.length > 120 || /[\u0000-\u001f\u007f]/.test(senha)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    try {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: MSG_CANCELADA }); return; }
      if (f.din.fechada) { res.status(409).json({ ok: false, error: MSG_FECHADA }); return; }
      if (!(g.nome === 'diego' || g.adm) || f.etapa === null || f.etapa < 4) { res.status(403).json({ ok: false, error: 'Você não pode guardar a senha agora.' }); return; }
      const c = cifrar(senha);
      await prepararEscrita(g, f);
      const r = await mudarObraPrivada(g.id, g.nome, null, null, (p) => ({ ...p, entrega: { ...p.entrega, cofre: { ...c, em: new Date().toISOString(), por: g.nome } } }));
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
      await sincronizarPortoes(g, f, r);   // a senha no cofre faz parte do portão da Entrega
      res.json({ ok: true, gravado: true });
    } catch (err) { falhouJornada(res, 'cofre', err); }
  });

  // ── Rota 9 · Revela a senha (só sócio) ───────────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/cofre/revelar', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    if (!g.socio) { res.status(403).json({ ok: false, error: 'Só sócio revela.' }); return; }
    try {
      const p = (await lerObraPrivada(g.id)) ?? obraPrivadaVazia();
      if (!p.entrega.cofre) { res.status(404).json({ ok: false, error: 'Não há senha guardada.' }); return; }
      let senha: string;
      try { senha = decifrar(p.entrega.cofre); } catch { res.status(409).json({ ok: false, error: 'O cofre não abriu. Grave a senha de novo.' }); return; }
      const agora = new Date().toISOString();
      await mudarObraPrivada(g.id, g.nome, null, null, (x) => ({ ...x, entrega: { ...x.entrega, cofre_revelado: [...x.entrega.cofre_revelado, { em: agora, por: g.nome }].slice(-20) } }));
      await mudarObra(g.id, () => obraVazia(g.id), (e) => ({ ...e, historico: [...e.historico, { em: agora, por: g.nome, acao: 'cofre_revelado' as const, etapa: 7 }].slice(-50) }));
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, senha, conta: p.entrega.monitoramento.conta });
    } catch (err) { falhouJornada(res, 'cofre-revelar', err); }
  });

  // ── Rota 10 · O Book ─────────────────────────────────────────────────────────────────────────────────────────────────
  router.get('/jornada-solar/obra/:card/book', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    try {
      const d = await dadosDoBook(g);
      if ('trava' in d) { res.status(409).json({ ok: false, error: 'O Book ainda não pode sair.', trava: d.trava }); return; }
      const { cliente: _c, cidade: _ci, caminhos: _ca, ...corpo } = d;
      void _c; void _ci; void _ca;
      res.json({ ok: true, ...corpo });
    } catch (err) { falhouJornada(res, 'book', err, true); }
  });

  // ── Rota 10b · O Book em PDF (gerado no servidor, por ação de gente, nunca no cron) ────────────────────────────────────
  router.post('/jornada-solar/obra/:card/book/pdf', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    try {
      const f = await lerFase2(g);
      if (!podeGerarBook(g, f.vend)) { res.status(403).json({ ok: false, error: 'Você não pode gerar o Book desta obra.' }); return; }
      const d = await dadosDoBook(g, f);
      if ('trava' in d) { res.status(409).json({ ok: false, error: 'O Book ainda não pode sair.', trava: d.trava }); return; }
      const urls = await assinarVarios(d.caminhos, 600);
      const fotos = d.caminhos.map((c) => urls.get(c)).filter((u): u is string => !!u);
      let pdf: Buffer | null = null;
      try { pdf = await renderizarBookPdf(d, fotos); } catch (err) {
        logErroJornada('book_pdf', err);
        res.status(503).json({ ok: false, error: 'Não consegui gerar o PDF agora. Tente de novo em 1 minuto.' });
        return;
      }
      if (!pdf || pdf.length > TETO_BOOK_BYTES) { res.status(413).json({ ok: false, error: 'O Book ficou grande demais. Tire fotos do álbum do diário.' }); return; }
      const agora = new Date().toISOString();
      await gravarArquivoBruto(caminhoBookPdf(g.id), pdf, 'application/pdf');
      const meta: MetaBook = { v: 1, gerado_em: agora, por: g.nome, tamanho: pdf.length, sha256: crypto.createHash('sha256').update(pdf).digest('hex'), fotos: fotos.length };
      await gravarJsonBruto(caminhoBookJson(g.id), meta);
      res.json({ ok: true, gerado_em: agora, url: await urlAssinadaDoBook(g.id, 600) });
    } catch (err) { falhouJornada(res, 'book_pdf', err); }
  });

  router.get('/jornada-solar/obra/:card/book/pdf', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    try {
      const m = await lerJsonBruto(caminhoBookJson(g.id)) as Partial<MetaBook> | null;
      const url = m && m.v === 1 && typeof m.gerado_em === 'string' ? await urlAssinadaDoBook(g.id, 600) : null;
      if (!m || !url) { res.status(404).json({ ok: false, error: 'O Book em PDF ainda não foi gerado.' }); return; }
      res.json({ ok: true, gerado_em: m.gerado_em, por: m.por ?? '', url });
    } catch (err) { falhouJornada(res, 'book_pdf_ler', err, true); }
  });

  // ── Rota 11 · A agenda das equipes ───────────────────────────────────────────────────────────────────────────────────
  router.get('/jornada-solar/agenda-equipes', ...base, async (req: Request, res: Response) => {
    const nome = String((req as any).consultor?.nome || '').trim().toLowerCase();
    const de = typeof req.query.de === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.de) ? req.query.de : hojeBr();
    try {
      const d0 = new Date(`${de}T12:00:00Z`);
      d0.setUTCDate(d0.getUTCDate() - ((d0.getUTCDay() + 6) % 7));
      const dias = Array.from({ length: 7 }, (_, i) => { const x = new Date(d0); x.setUTCDate(x.getUTCDate() + i); return x.toISOString().slice(0, 10); });
      const [obras, cards, ligs] = await Promise.all([lerTodasObras(), lerCardsSolarVendidos(), lerTodasLigacoes()]);
      const porCard = new Map(cards.map((c) => [c.id, c]));
      const linhas = EQUIPES_LISTA.map((eq) => {
        const porDia: Record<string, Array<{ card: number | null; codigo: string | null; cliente: string }>> = {};
        for (const dia of dias) porDia[dia] = [];
        for (const [card, o] of obras) {
          for (const x of o.dias_obra) {
            if (x.equipe !== eq.id || !dias.includes(x.data)) continue;
            const c = porCard.get(card);
            if (!c) continue;
            porDia[x.data].push(veObra(nome, String(c.vendedor_nome ?? ''))
              ? { card, codigo: ligs.get(card)?.venda ?? null, cliente: String(c.cliente_nome ?? '') }
              : { card: null, codigo: null, cliente: 'Ocupada' });
          }
        }
        return { equipe: eq.id, rotulo: eq.rotulo, dias: porDia };
      });
      const conflitos: Array<{ equipe: string; data: string; cards: number[] }> = [];
      for (const l of linhas) for (const dia of dias) {
        if (l.dias[dia].length > 1) conflitos.push({ equipe: l.equipe, data: dia, cards: l.dias[dia].map((x) => x.card).filter((x): x is number => x !== null) });
      }
      res.json({ ok: true, de: dias[0], ate: dias[6], dias, linhas, conflitos });
    } catch (err) { falhouJornada(res, 'agenda-equipes', err, true); }
  });
}

