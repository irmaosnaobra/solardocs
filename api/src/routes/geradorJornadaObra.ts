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
  CURTOS_ETAPA, MOTIVOS_ESPERA, NOMES_ETAPA, ROTULO_ESPERA, ddmm, deduzirEtapa, donosDaEtapa, estadoMaterializado, iniciais, podeConcluir, somarDiasUteis, veObra,
  type EstadoJornada, type MotivoEspera,
} from '../services/gerador/jornadaSolar';
import { ehRecusa, lerPrivadoJornada, mudarJornada, type Recusa } from '../services/gerador/jornadaSolarBanco';
import {
  EQUIPES_LISTA, IDS_EQUIPE, LISTA_PRONTA, SECOES_OBRA, etapaAtualCompleta, itensDaEtapaObra, itensIniciais, obraMaterializada, pagoDaCompra, prazoDaEtapaObra,
  situacaoObra, somaItens, type EstadoObra, type ObraPrivada, type SecaoObra,
} from '../services/gerador/jornadaObra';
import {
  buscarNotaViva, gravarRegistroNota, liberarRegistroNota, lerObraComVersao, lerObraPrivada, lerTodasObras, mudarObra, mudarObraPrivada, normalizarObraPrivada, obraVazia,
  obraPrivadaVazia,
} from '../services/gerador/jornadaObraBanco';
import { cifrar, decifrar } from '../services/gerador/cofreObra';
import { chaveNfeValida } from '../services/gerador/jornadaObra';
import { camposDoTermo, termoGarantiaHtml, travaDoBook } from '../services/gerador/termoGarantia';
import { garantiaInstalacaoExtenso } from '../services/templateService';
import { reaisBR, recortarLivro, veRetiradaDosSocios } from '../services/gerador/jornadaDinheiro';
import { lerLeituraDoArquivo } from '../services/gerador/financeiroArquivos';

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
const hojeBr = (): string => diaDeBrasilia(Date.now());
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const novoId = (p: string): string => `${p}-${randomUUID().slice(0, 12)}`;
const SLOTS_DA_FASE = [
  'cert_modulo', 'cert_inversor', 'log_documento', 'log_conferencia', 'log_avaria', 'log_assinatura', 'obra_foto', 'ent_vista_geral', 'ent_arranjo', 'ent_inversor', 'ent_quadro',
  'ent_aterramento', 'ent_padrao', 'ent_etiquetas', 'ent_local_limpo', 'ent_termo_assinado', 'lib_pedido', 'lib_vistoria', 'lib_medidor', 'lib_liberacao', 'lib_exigencia',
];
const DEZ_DEZ = /•••/;
const mascara = (conta: string): string => {
  if (!conta) return '';
  const [a, d] = conta.split('@');
  return d ? `${a.slice(0, 2)}•••@${d}` : `${conta.slice(0, 2)}•••`;
};

// ── O que se lê de uma obra ─────────────────────────────────────────────────────────────────────────────────────────

interface Fase2 {
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
  slotsSet: Set<string>;
  contratoAnexoYmd: string | null;
  cad: Awaited<ReturnType<typeof lerCadastroVisto>>;
  proposta: Awaited<ReturnType<typeof lerProposta>>;
  vendaPrivada: Awaited<ReturnType<typeof lerPrivadoJornada>>;
}

async function lerFase2(g: GuardaObra): Promise<Fase2> {
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
  const etapa = etapaAtualCompleta(din.js, din.jo, deduzida);
  const agora = new Date().toISOString();
  let joView = din.jo;
  if (!joView) {
    if (din.js && etapa === 4) joView = obraMaterializada(g.id, 4, din.js.etapas[4].aberta_em, agora);
    else if (!din.js && etapa !== null && etapa >= 4) joView = obraMaterializada(g.id, etapa, null, agora);
  }
  const contratoAnexo = docs.reg.arquivos.find((a) => a.slot === 'contrato_assinado');
  return {
    din, js: din.js, jo: din.jo, joView, privada: din.privada ?? obraPrivadaVazia(), etapa, vend: din.vendedor, slotsMap, slotsSet,
    docsIds: new Set(docs.reg.arquivos.map((a) => a.id)), arquivos: docs.reg.arquivos.map((a) => ({ id: a.id, slot: a.slot, em: a.em })),
    contratoAnexoYmd: contratoAnexo?.em ? diaDeBrasilia(contratoAnexo.em) : null, cad, proposta, vendaPrivada,
  };
}

const vCad = (f: Fase2) => (k: string): string => String((f.cad.campos as Record<string, { valor?: string } | undefined>)[k]?.valor ?? '').trim();

/** O contrato com as garantias: o gravado na geração ou, para o gerado antes de 06/11/2026, o recalculado pela proposta (`fonte: 'recalculado'`). */
function contratoDe(f: Fase2) {
  if (f.privada.contrato) return f.privada.contrato;
  const v = vCad(f);
  const campos = camposDoContratoDaObra({ proposta: f.proposta }, v, f.vendaPrivada?.venda ?? null);
  return contratoDaObra(campos, {
    cliente: { nome: v('nome'), cpf_cnpj: v('cpf_cnpj'), tipo: tipoDoCadastro(f.cad), cidade: v('cidade'), uf: v('uf'), endereco: v('endereco') },
    empresaNome: 'AIOROS LTDA', empresaCnpj: '63.636.043/0001-88', empresaTelefone: '',
  }, 'leitura', 'recalculado', new Date().toISOString());
}

function campos(f: Fase2, telefone = '') {
  const c = contratoDe(f);
  const t = f.privada.entrega.termo;
  return {
    contrato: c,
    campos: camposDoTermo({
      codigo: f.din.lig.venda ?? '*', privadaContrato: c, itensCompra: f.privada.compra.itens, monitoramento: f.privada.entrega.monitoramento,
      termoEntrega: t, contratoData: f.contratoAnexoYmd, entregaYmd: t?.assinado_em ? diaDeBrasilia(t.assinado_em) : null,
      responsavel: f.privada.entrega.responsavel, empresaTelefone: telefone,
    }),
  };
}

function trava(f: Fase2): string[] {
  const { contrato, campos: k } = campos(f);
  return travaDoBook(k, contrato, f.privada.compra.itens, !!f.privada.entrega.termo?.assinado_em);
}

// ── Quem mexe em quê ──────────────────────────────────────────────────────────────────────────────────────────────────

function podeSecao(g: GuardaObra, f: Fase2, secao: string): boolean {
  if (f.din.cancelada || f.din.fechada) return false;
  const eh = !!f.vend && g.nome === f.vend;
  const noPosVenda = f.etapa !== null && f.etapa >= 4;
  switch (secao) {
    case 'vistoria': return eh || g.adm;
    case 'banco': return g.nome === 'giovanna' || eh || g.adm;
    case 'compra': return noPosVenda && (g.nome === 'thiago' || g.nome === 'diego' || g.adm);
    case 'logistica': return noPosVenda && (g.nome === 'diego' || g.adm);
    case 'obra': return noPosVenda && (g.nome === 'diego' || g.nome === 'thiago' || g.adm);
    case 'entrega': return noPosVenda && (g.nome === 'diego' || g.adm);
    case 'liberacao': return noPosVenda && (g.nome === 'thiago' || g.adm);
    default: return false;
  }
}

/** Garante os dois estados gravados (a `jornada_solar` primeiro, depois a `jornada_obra`). A leitura nunca materializa; a primeira ESCRITA, sim. */
async function prepararEscrita(g: GuardaObra, f: Fase2): Promise<void> {
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

/**
 * Os itens do portão como a pessoa pode ver. O item "A receber e a pagar zerados" da etapa 8 usa o livro inteiro; para quem não vê a retirada dos
 * sócios, quando o que falta é só o que ela não vê, o texto vira genérico (nem valor, nem qual é a pendência).
 */
function itensParaQuem(n: number, f: Fase2, g: GuardaObra) {
  const itens = itensDaEtapaObra(n, fonteItens(f));
  if (n !== 8 || veRetiradaDosSocios(g.nome, g.adm)) return itens;
  const visivelFecha = recortarLivro(f.din.livro, false).fechamento.pode_fechar_sem_material;
  return itens.map((i) => (i.chave === 'dinheiro' && !i.feito && visivelFecha ? { ...i, texto: 'Falta uma pendência que o Thiago resolve' } : i));
}

const fonteItens = (f: Fase2) => ({ jo: f.joView, privada: f.privada, livro: f.din.livro, slots: f.slotsMap, docsIds: f.docsIds });

// ── O corpo do GET (e da resposta de todo PUT) ────────────────────────────────────────────────────────────────────────

async function corpoFase2(g: GuardaObra, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const f = await lerFase2(g);
  const hoje = hojeBr();
  const p = f.privada;
  const veDin = f.din.veDinheiro;
  const etapas = [4, 5, 6, 7, 8].map((n) => {
    const e = f.joView?.etapas[n as 4 | 5 | 6 | 7 | 8];
    const itens = f.joView && e?.aberta_em ? itensParaQuem(n, f, g) : [];
    return {
      n, nome: NOMES_ETAPA[n], curto: CURTOS_ETAPA[n], dono: donosDaEtapa(n, f.vend).map((d) => ({ nome: d, iniciais: iniciais(d) })),
      aberta_em: e?.aberta_em ?? null, concluida_em: e?.concluida_em ?? null,
      prazo: prazoDaEtapaObra(n, f.js, f.joView), situacao: situacaoObra(n, f.js, f.joView, hoje),
      itens, falta: itens.filter((i) => !i.feito).length,
    };
  });
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
  const sugeridos = atual === 4 && p.compra.itens.length === 0
    ? itensIniciais(equipamentoDaProposta(f.proposta ? { qtd_placas: f.proposta.qtd_placas, inversor: f.proposta.inversor, qtd_inversor: f.proposta.qtd_inversor, dados: f.proposta.dados } : null), p.vistoria?.telhado.tipo ?? '')
    : [];
  const contrato = contratoDe(f);
  const e = p.entrega;
  return {
    ok: true, etapa_atual: atual, fechada: f.jo?.fechada ?? null, esperando: f.jo?.esperando ?? null,
    etapas,
    pode: {
      concluir: aberta && podeConcluir(g.nome, atual as number, f.vend) ? [atual] : [],
      esperar: aberta && (g.adm || donosDaEtapa(atual as number, f.vend).includes(g.nome)),
      secoes, nota: secoes.includes('compra') || secoes.includes('logistica'),
      cofre_gravar: !f.din.cancelada && !f.din.fechada && (g.nome === 'diego' || g.adm) && atual !== null && atual >= 4,
      cofre_revelar: g.socio,
      fechar: g.adm && !!f.jo?.etapas[8].concluida_em && !f.jo?.fechada && !f.din.cancelada,
      reabrir: g.adm && !!f.jo?.fechada,
      book: book.length === 0,
    },
    dados: {
      vistoria: p.vistoria, banco: p.banco,
      compra: {
        itens: p.compra.itens.map((i) => ({ ...i, valor_centavos: mascarar(i.valor_centavos) })), compras,
        contador: { com_origem: mat.com_origem, total: mat.total }, sugeridos,
      },
      logistica: { cargas: p.logistica.cargas.map((c) => ({ ...c, frete: { ...c.frete, valor_centavos: mascarar(c.frete.valor_centavos) } })) }, obra: { ...p.obra, equipe: { ...p.obra.equipe, combinado_centavos: mascarar(p.obra.equipe.combinado_centavos) } },
      entrega: {
        testes: e.testes, monitoramento: { ...e.monitoramento, conta: mascara(e.monitoramento.conta), conta_mascarada: mascara(e.monitoramento.conta) },
        cofre: e.cofre ? { gravado: true, em: e.cofre.em, por: e.cofre.por } : null,
        cofre_revelado: e.cofre_revelado, garantias: e.garantias, termo: e.termo, responsavel: e.responsavel,
      },
      liberacao: p.liberacao,
      contrato_garantias: {
        modulos: contrato.garantia_modulos_anos, inversor: contrato.garantia_inversor_anos,
        instalacao: garantiaInstalacaoExtenso({ garantia_instalacao_anos: contrato.garantia_instalacao_anos, garantia_instalacao_unidade: contrato.garantia_instalacao_unidade }),
        fonte: contrato.fonte,
      },
    },
    versoes: p.versoes,
    book: { pode: book.length === 0, trava: book },
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
  if (secao === 'banco') return normalizarObraPrivada({ ...p, banco: d });
  if (secao === 'compra') {
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
        compra_id: typeof o.compra_id === 'string' && idsCompra.has(o.compra_id) ? o.compra_id : null,
        etapa: o.etapa === 6 && (pode6 || ex?.etapa === 6) ? 6 : 4,
      };
    });
    const novo = normalizarObraPrivada({ ...p, compra: { itens, compras } });
    // Quem não vê o dinheiro (Ajustes com `dinheiro_aberto` desligado) recebeu `null` nos valores: o servidor restaura o do item que já existe.
    if (!f.din.veDinheiro) {
      for (const i of novo.compra.itens) i.valor_centavos = p.compra.itens.find((x) => x.id === i.id)?.valor_centavos ?? null;
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
  return { recusa: MSG_PEDIDO, http: 400 };
}

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
      if (f.din.fechada) { res.status(409).json({ ok: false, error: MSG_FECHADA }); return; }
      if (!podeSecao(g, f, secao)) { res.status(403).json({ ok: false, error: 'Você não pode mexer nesta parte agora.' }); return; }
      if (secao !== 'vistoria' && secao !== 'banco') await prepararEscrita(g, f);
      const numeroPedido = secao === 'liberacao'
        ? (typeof dados.pedido_numero === 'string' ? dados.pedido_numero : (typeof obj(obj(dados.passos)?.pedido)?.numero === 'string' ? String(obj(obj(dados.passos)?.pedido)?.numero) : ''))
        : '';
      const r = await mudarObraPrivada(g.id, g.nome, secao, versaoLida, (p) => aplicarSecao(secao, p, dados, g, f));
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa, ...(r.extra ?? {}) }); return; }
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
      if (!/^fin\/\d+\/\d{6}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/.test(caminho) || !caminho.startsWith(`fin/${g.id}/`)) {
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
          const frase = onde === 'esta obra' ? 'Esta nota já foi lançada nesta obra.' : onde === 'outra obra' ? 'Esta nota já foi lançada em outra obra.'
            : onde === 'um card do eletroposto' ? 'Esta nota já foi lançada num card do eletroposto.' : `Esta nota já foi lançada na obra ${onde.replace(/^a obra /, '')}.`;
          return { http: 409, json: { ok: false, error: 'nota_repetida', onde, mensagem: frase } };
        }
        const atual = compra.nota;
        if (atual && !b.trocar && atual.sha256 === sha) return { http: 200, json: { ok: true, repetido_pedido: true } };
        if (atual && !b.trocar) return { http: 409, json: { ok: false, error: 'compra_com_nota', mensagem: 'Esta compra já tem nota. Use Trocar a nota.' } };
        if (atual?.nf_id) await liberarRegistroNota(g.id, atual.nf_id);
        const nfId = novoId('nf');
        if (!(await gravarRegistroNota(g.id, { id: nfId, compra_id: compraId, sha256: sha, chave, livre: false, em: new Date().toISOString(), por: g.nome }))) {
          return { http: 409, json: { ok: false, error: 'mudou', mensagem: 'Outra pessoa anexou agora. Tente de novo.' } };
        }
        const r = await mudarObraPrivada(g.id, g.nome, null, null, (p) => ({
          ...p, compra: { ...p.compra, compras: p.compra.compras.map((c) => (c.id === compraId ? { ...c, nota: { path: caminho, sha256: sha, numero: String(lida?.numero ?? ''), chave: chave ?? '', nf_id: nfId } } : c)) },
        }));
        if (ehRecusa(r)) return { http: r.http, json: { ok: false, error: r.recusa } };
        return { http: 200, json: { ok: true } };
      });
      if (saida.http !== 200) { res.status(saida.http).json(saida.json); return; }
      const itens = lida ? lista(lida.itens).map((i) => obj(i) ?? {}) : [];
      const data = lida && typeof lida.data === 'string' ? lida.data : null;
      const total = lida && typeof lida.valor_total_centavos === 'number' ? lida.valor_total_centavos : null;
      const emitente = lida ? String(lida.emitente ?? '') : '';
      const mensagem = lida && (emitente || total !== null)
        ? `A nota foi lida: ${[emitente, data ? ddmm(data) : '', `${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`, total !== null ? reaisBR(total) : ''].filter(Boolean).join(' · ')}`
        : 'A nota foi anexada. Não consegui ler os itens: digite à mão.';
      res.json({ ok: true, lida: lida ? { emitente, data, n_itens: itens.length, valor_total_centavos: total, itens } : null, mensagem });
    } catch (err) { falhouJornada(res, 'nota', err); }
  });

  // ── Rota 4 · Conclui a etapa da vez (4 a 8) ───────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/etapa-obra', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    const n = b ? b.etapa : undefined;
    if (!b || typeof n !== 'number' || !Number.isInteger(n) || n < 4 || n > 8) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    // O "tudo em zero" da etapa 8 é calculado DENTRO da trava da conta: nenhum lançamento entra entre a conferência e o fechamento.
    const corpo = async (): Promise<void> => {
      const f = await lerFase2(g);
      if (f.din.cancelada) { res.status(409).json({ ok: false, error: MSG_CANCELADA }); return; }
      if (f.din.fechada) { res.status(409).json({ ok: false, error: MSG_FECHADA }); return; }
      if (f.etapa !== n) { res.status(409).json({ ok: false, error: 'Esta etapa não é a da vez.' }); return; }
      if (!podeConcluir(g.nome, n, f.vend)) { res.status(403).json({ ok: false, error: 'Só o dono conclui a etapa.' }); return; }
      const falta = itensParaQuem(n, f, g).filter((i) => !i.feito);
      if (falta.length) {
        res.status(409).json({
          ok: false, precisa: 'itens', falta: falta.map((i) => ({ chave: i.chave, texto: i.texto })),
          error: `Falta ${falta.length} ${falta.length === 1 ? 'item' : 'itens'}: ${falta.map((i) => i.texto).join(', ')}.`,
        }); return;
      }
      await prepararEscrita(g, f);
      const r = await mudarObra(g.id, () => obraVazia(g.id), (e) => {
        if (e.fechada) return { recusa: MSG_FECHADA, http: 409 } as Recusa;
        if (etapaAtualCompleta(null, e, null) !== n) return { recusa: 'Esta etapa não é a da vez.', http: 409 } as Recusa;
        const agora = new Date().toISOString();
        const etapas = { ...e.etapas };
        etapas[n as 4 | 5 | 6 | 7 | 8] = { aberta_em: e.etapas[n as 4 | 5 | 6 | 7 | 8].aberta_em ?? agora, concluida_em: agora, concluida_por: g.nome };
        const hist: EstadoObra['historico'] = [{ em: agora, por: g.nome, acao: 'concluir', etapa: n }];
        if (n < 8) {
          const prox = (n + 1) as 5 | 6 | 7 | 8;
          etapas[prox] = { ...e.etapas[prox], aberta_em: e.etapas[prox].aberta_em ?? agora };
          hist.push({ em: agora, por: g.nome, acao: 'abrir', etapa: prox });
        } else hist.push({ em: agora, por: g.nome, acao: 'fechar', etapa: 8 });
        return {
          ...e, etapas, esperando: e.esperando && e.esperando.etapa === n ? null : e.esperando,
          fechada: n === 8 ? { em: agora, por: g.nome } : e.fechada, historico: [...e.historico, ...hist].slice(-50),
        };
      });
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa, ...(r.extra ?? {}) }); return; }
      res.json({ ok: true, etapa_atual: n === 8 ? 9 : n + 1, ...(r.fechada ? { fechada: r.fechada } : {}) });
    };
    try { if (n === 8) await comTrava(`fin_conta:${g.id}`, g.nome, corpo); else await corpo(); }
    catch (err) { if (!res.headersSent) falhouJornada(res, 'etapa-obra', err); }
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
      const f = await lerFase2(g);
      const { contrato, campos: k } = campos(f);
      const falta = travaDoBook(k, contrato, f.privada.compra.itens, !!f.privada.entrega.termo?.assinado_em);
      if (falta.length) { res.status(409).json({ ok: false, error: 'O Book ainda não pode sair.', trava: falta }); return; }
      const p = f.privada;
      const fotosEntrega = ['ent_vista_geral', 'ent_arranjo', 'ent_inversor', 'ent_quadro', 'ent_aterramento', 'ent_padrao', 'ent_etiquetas', 'ent_local_limpo']
        .flatMap((s) => (f.slotsMap.get(s) ?? []).slice(0, 1));
      const doAlbum = p.obra.diario.flatMap((d) => d.fotos).filter((id) => f.docsIds.has(id)).slice(0, 12);
      const m = p.entrega.monitoramento;
      res.json({
        ok: true,
        titulo: `Book da obra · ${f.din.lig.venda ?? '*'} · ${k.cliente_nome}`,
        termo_html: limparHtmlPapel(termoGarantiaHtml(k)),
        fotos: [...fotosEntrega, ...doAlbum],
        testes: p.entrega.testes,
        monitoramento: { app: m.app, conta: m.conta, usina: m.usina, serie: m.serie, comissionamento: m.comissionamento },
        contatos: { whatsapp: k.empresa_whatsapp },
        ...(contrato.fonte === 'recalculado' ? { aviso_garantias: 'Garantias lidas da proposta (contrato gerado antes de 06/11/2026).' } : {}),
      });
    } catch (err) { falhouJornada(res, 'book', err, true); }
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

