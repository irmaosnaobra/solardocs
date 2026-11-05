import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { exigeAdm } from './geradorAdm';
import { semCache, lerDocs } from './geradorClientesDocs';
import { etapaDaPlanilha } from './geradorJornadaSolar';
import {
  corpoDe, falhouJornada, guardaDaObra, limiteSeForLer, logErroJornada, MSG_PEDIDO, pulaALeitura, type GuardaObra,
} from './geradorJornadaGuarda';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { comTrava } from '../services/gerador/cadastroVendaBanco';
import { ehCardSolarVendido, lerCardsPorIds, lerLigacao, type Ligacao } from '../services/gerador/vendaSolarHub';
import { deduzirEtapa, veObra, type EstadoJornada } from '../services/gerador/jornadaSolar';
import { lerJornadaComVersao, lerPrivadoJornada, ehRecusa } from '../services/gerador/jornadaSolarBanco';
import { etapaAtualCompleta, materialDaCompra, pendenciasDaObra, type EstadoObra, type ObraPrivada } from '../services/gerador/jornadaObra';
import { lerNota } from '../services/gerador/notaLeitura';
import { lerObraComVersao, lerObraPrivada, mudarObraPrivada } from '../services/gerador/jornadaObraBanco';
import {
  AJUSTES_PADRAO, CATEGORIAS_OBRA, recortarLivro, veRetiradaDosSocios, categoriaObra, idDoEstorno, lancamentoObraParaGravar, livroDaObra, montarLancamentoObra, regraDoVendedor, reaisBR,
  validarAjustes, type AjustesSolar, type Conferencia, type Livro, type LancamentoObra, type LinhaLivro, type LinhaRegra, type Pendencia,
} from '../services/gerador/jornadaDinheiro';
import {
  atualizarLancamentoObra, buscarNoFinanceiro, gravarAjustes, inserirLancamentoObra, lerAjustes, lerLancamentoObra, lerLancamentoObraComVersao, lerLancamentosDaObra,
  type AchadoGlobal,
} from '../services/gerador/jornadaDinheiroBanco';
import { catalogoFinanceiro, ID_LANCAMENTO, VALOR_MAX_CENTAVOS } from '../services/gerador/financeiroCliente';
import {
  assinarComprovante, caminhoEhDoCard, gravarLeituraDoArquivo, lerLeituraDoArquivo, subirComprovante,
} from '../services/gerador/financeiroArquivos';
import { lerComprovante } from '../services/gerador/financeiroLeitura';
import { listaSocios, nomeSimples } from '../services/gerador/solarObras';

// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): O DINHEIRO DA OBRA. Montada dentro de /gerador por `mountJornadaDinheiro`.
//
//   GET   /jornada-solar/obra/:card/dinheiro               o livro, a faixa e o que cada pessoa pode fazer
//   POST  /jornada-solar/obra/:card/dinheiro/comprovante   sobe o comprovante (ou a nota) e grava o que a IA leu, ao lado dele
//   POST  /jornada-solar/obra/:card/dinheiro/lancamento    lança entrada ou gasto (comprovante OBRIGATÓRIO, valor conferido pela IA no servidor)
//   POST  /jornada-solar/obra/:card/dinheiro/comissao      paga a comissão de quem vendeu (custo) ou a retirada de um sócio
//   POST  /jornada-solar/obra/:card/dinheiro/estorno       anula um lançamento (nunca se apaga)
//   PUT   /jornada-solar/obra/:card/dinheiro/previsto      o previsto por grupo (ADM)
//   GET   /jornada-solar/ajustes   e   PUT /jornada-solar/ajustes (ADM)     a regra das comissões e quem vê o dinheiro
//
// Nenhuma mensagem sai daqui (nada de WhatsApp, Instagram nem e-mail). Nenhum log leva nome, valor, texto ou caminho: só o código.
// O lançamento mora em `system_state` (`fin:<card>:<id>`, ASSINADO); o comprovante, no bucket privado `financeiro-clientes`.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_FECHADA = 'A conta desta obra está fechada. Só o Thiago reabre.';
const MSG_CANCELADA = 'Venda cancelada. Só cabe estorno.';
const hojeBr = (): string => diaDeBrasilia(Date.now());
/** Id que o servidor reserva para si (o do estorno é `est-` mais o hash do original): o navegador não escolhe um assim. */
const idReservado = (id: string): boolean => /^est-/i.test(id);
const bonito = (n: string): string => (n ? n.charAt(0).toUpperCase() + n.slice(1) : n);

// ── O que se lê do dinheiro de uma obra ─────────────────────────────────────────────────────────────────────────────────

export interface DadosDinheiro {
  livro: Livro;
  lancamentos: LancamentoObra[];
  ajustes: AjustesSolar;
  ajustesValido: boolean;
  js: EstadoJornada | null;
  jo: EstadoObra | null;
  privada: ObraPrivada | null;
  lig: Ligacao;
  vendedor: string;
  venda: number | null;
  regra: { linhas: LinhaRegra[]; aviso: string | null; congelada: boolean };
  fechada: boolean;
  cancelada: boolean;
  veDinheiro: boolean;
}

/** As pendências da obra (compra, equipe, frete) e o material com origem, do `obra.json` (Jornada, fase 2). */
function pendenciasEMaterial(privada: ObraPrivada | null, lancamentos: readonly LancamentoObra[]): { pendenciasDaObra: Pendencia[]; material: { com_origem: number; total: number } } {
  return { pendenciasDaObra: pendenciasDaObra(privada, lancamentos), material: materialDaCompra(privada, lancamentos) };
}

export async function lerDinheiro(g: GuardaObra): Promise<DadosDinheiro> {
  const [{ lancamentos, ignoradas }, privJ, privada, { estado: jo }, { estado: js }, { ajustes, valido }, { lig }] = await Promise.all([
    lerLancamentosDaObra(g.id),
    lerPrivadoJornada(g.id).catch((e) => { logErroJornada('privado', e); return null; }),
    lerObraPrivada(g.id),
    lerObraComVersao(g.id),
    lerJornadaComVersao(g.id),
    lerAjustes(),
    lerLigacao(g.id),
  ]);
  const vendedor = nomeSimples(g.card.vendedor_nome) || js?.vendedor || '';
  const v = privJ?.venda?.valor_centavos ?? 0;
  const venda = v > 0 ? v : null;
  const congelada = privada?.regra_comissao ?? null;
  const pelaRegra = regraDoVendedor(vendedor, ajustes);
  const regra = congelada
    ? { linhas: congelada.linhas.map((l) => ({ ...l })), aviso: null, congelada: true }
    : { linhas: pelaRegra.linhas, aviso: pelaRegra.aviso, congelada: false };
  const extras = pendenciasEMaterial(privada, lancamentos);
  const livro = livroDaObra({
    lancamentos, ignoradas, vendaCentavos: venda, vendedor, regra: regra.linhas, regraCongelada: regra.congelada, regraAviso: regra.aviso,
    previsto: privada?.previsto ?? null, pendenciasDaObra: extras.pendenciasDaObra, engenheiroAPagar: js?.etapas[3].engenheiro === 'a_pagar',
    material: extras.material, adm: g.adm,
  });
  return {
    livro, lancamentos, ajustes, ajustesValido: valido, js, jo, privada, lig, vendedor, venda, regra,
    fechada: !!jo?.fechada, cancelada: !!js?.cancelada,
    veDinheiro: ajustes.dinheiro_aberto || g.adm || g.nome === 'giovanna',
  };
}

/** O livro com a URL assinada (1 hora) de cada comprovante, numa CÓPIA: o objeto lido nunca leva link que vence. */
export async function livroComUrls(d: DadosDinheiro, g: GuardaObra): Promise<Livro> {
  const caminho = new Map(d.lancamentos.map((l) => [l.id, l.arquivo?.path ?? '']));
  const linhas: LinhaLivro[] = await Promise.all(d.livro.linhas.map(async (l) => {
    const p = caminho.get(l.id);
    return l.comprovante && p ? { ...l, comprovante: { ...l.comprovante, url: await assinarComprovante(p, 3600) } } : l;
  }));
  // A retirada dos sócios só vai para o ADM e para a Giovanna.
  return recortarLivro({ ...d.livro, linhas }, veRetiradaDosSocios(g.nome, g.adm)) as Livro;
}

const ehGiovOuAdm = (g: GuardaObra): boolean => g.adm || g.nome === 'giovanna';
const ehSensivel = (l: Pick<LinhaLivro, 'tipo' | 'comissao' | 'grupo' | 'categoria'>): boolean =>
  l.tipo === 'entrada' || !!l.comissao || l.grupo === 'retirada' || l.categoria === 'comissao_venda';

/** Quem estorna: o gasto, quem criou a linha ou o ADM; entrada, comissão e retirada, só a Giovanna e o ADM (D9). */
const podeEstornar = (g: GuardaObra, l: Pick<LinhaLivro, 'tipo' | 'comissao' | 'grupo' | 'categoria' | 'criado_por'>): boolean =>
  ehSensivel(l) ? ehGiovOuAdm(g) : (g.adm || l.criado_por === g.nome);

function podeDoDinheiro(g: GuardaObra, d: DadosDinheiro) {
  const livre = !d.fechada;
  return {
    lancar_entrada: ehGiovOuAdm(g) && !d.cancelada && livre,
    lancar_saida: !d.cancelada && livre,
    comissao: ehGiovOuAdm(g) && !d.cancelada && livre,
    estornar_ids: livre ? d.livro.linhas.filter((l) => !l.estorno_de && !l.estornada && podeEstornar(g, l)).map((l) => l.id) : [],
    previsto: g.adm && livre,
    fechada: d.fechada,
  };
}

/** A etapa mais alta em que o lançamento cabe: 1 até a etapa atual (no pós-venda, até 8; sem trilho, de 1 a 8). Não materializa nada. */
async function etapaMaxima(g: GuardaObra, js: EstadoJornada | null, jo: EstadoObra | null, lig: Ligacao): Promise<number> {
  let deduzida: number | null = null;
  if (!js && !jo) {
    const { reg } = await lerDocs(g.ctx);
    const slots = new Set(reg.arquivos.map((a) => a.slot));
    let planilha: string | undefined; let fora = false;
    if (lig.venda) { const pl = await etapaDaPlanilha(lig.venda); planilha = pl.etapaPlanilha; fora = pl.fora; }
    deduzida = deduzirEtapa({ temNumero: !!lig.venda, slots, planilha, planilhaFora: fora }).etapa;
  }
  const e = etapaAtualCompleta(js, jo, deduzida);
  return e === null ? 8 : Math.min(e, 8);
}

// ── O comprovante e a leitura gravada ───────────────────────────────────────────────────────────────────────────────────

const ARQUIVO_FIN = /^fin\/\d+\/\d{6}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;
const PIX = /^E[0-9A-Za-z]{31}$/;

type Saida = { http: number; json: Record<string, unknown> };
const erro = (http: number, error: string, mensagem?: string, extra: Record<string, unknown> = {}): Saida =>
  ({ http, json: { ok: false, error, ...(mensagem ? { mensagem } : {}), ...extra } });

/** O registro 2.2 lido do bucket, conferido contra o card e o caminho. */
interface RegistroLido {
  path: string; nome: string; tipo: string; tamanho: number; sha256: string; doc: string; leitura: string;
  sugestao: { valor_centavos: number | null; data: string | null; id_transacao: string | null; forma: string | null; recebedor: string | null; confianca: string } | null;
}

async function carregarRegistro(g: GuardaObra, path: unknown): Promise<{ ok: true; reg: RegistroLido } | { ok: false; saida: Saida }> {
  if (typeof path !== 'string' || !path || !caminhoEhDoCard(path, g.id) || !ARQUIVO_FIN.test(path)) {
    return { ok: false, saida: erro(400, 'comprovante_obrigatorio', 'Sem comprovante, o lançamento não entra.') };
  }
  const r = await lerLeituraDoArquivo(path);
  const sha = r && typeof r.sha256 === 'string' && /^[0-9a-f]{64}$/.test(r.sha256) ? r.sha256 : '';
  if (!r || r.card_id !== g.id || r.path !== path || !sha) {
    return { ok: false, saida: erro(400, 'comprovante_nao_encontrado', 'Anexe o comprovante de novo.') };
  }
  const sg = r.sugestao && typeof r.sugestao === 'object' && !Array.isArray(r.sugestao) ? r.sugestao as Record<string, unknown> : null;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    ok: true,
    reg: {
      path, nome: String(r.nome ?? ''), tipo: String(r.tipo ?? ''), tamanho: Number(r.tamanho) || 0, sha256: sha, doc: String(r.doc ?? ''), leitura: String(r.leitura ?? ''),
      sugestao: sg ? {
        valor_centavos: Number.isInteger(sg.valor_centavos) && (sg.valor_centavos as number) > 0 ? sg.valor_centavos as number : null,
        data: str(sg.data), id_transacao: str(sg.id_transacao), forma: str(sg.forma), recebedor: str(sg.recebedor), confianca: String(sg.confianca ?? ''),
      } : null,
    },
  };
}

/** Onde está o comprovante repetido, sem nunca dizer nome de cliente. Só diz o número quando quem pede VÊ aquela obra (D8). */
export async function ondeEsta(g: GuardaObra, a: AchadoGlobal): Promise<string> {
  if (a.card === g.id) return 'esta obra';
  try {
    const card = (await lerCardsPorIds([a.card])).get(a.card);
    if (!card) return 'outra obra';
    if (!ehCardSolarVendido(card)) return 'um card do eletroposto';
    if (!veObra(g.nome, String(card.vendedor_nome ?? ''))) return 'outra obra';
    const { lig } = await lerLigacao(card.id);
    return lig.venda ? `a obra ${lig.venda}` : 'outra obra';
  } catch (err) { logErroJornada('onde', err); return 'outra obra'; }
}
const fraseOnde = (o: string, oQue: string): string => {
  if (o === 'esta obra') return `Este ${oQue} já foi lançado nesta obra.`;
  if (o === 'um card do eletroposto') return `Este ${oQue} já foi lançado num card do eletroposto.`;
  if (o === 'outra obra') return `Este ${oQue} já foi lançado em outra obra.`;
  return `Este ${oQue} já foi lançado na obra ${o.replace(/^a obra /, '')}.`;
};

// ── A gravação de UM lançamento (lançamento, comissão e estorno com devolução) ─────────────────────────────────────

interface PedidoGravacao {
  g: GuardaObra;
  d: DadosDinheiro;
  corpo: Record<string, unknown>;
  /** O que o navegador (ou a regra) manda; o servidor completa o resto. */
  base: Record<string, unknown>;
  arquivoPath: unknown;
  /** Estorno sem devolução não tem comprovante. */
  semArquivo?: boolean;
  pularAvisos?: boolean;
  /** O valor que o comprovante TEM que mostrar (estorno de devolução: o da original). */
}

async function gravarLancamento(p: PedidoGravacao): Promise<Saida> {
  const { g, d, corpo, base } = p;
  const agoraIso = new Date().toISOString();
  let reg: RegistroLido | null = null;
  if (!p.semArquivo) {
    const r = await carregarRegistro(g, p.arquivoPath);
    if (!r.ok) return r.saida;
    reg = r.reg;
    if (reg.doc === 'nota') return erro(400, 'e_nota', 'Isto é uma nota fiscal. Para pagar, anexe o comprovante do pagamento.');
    if (reg.leitura === 'nao_e_comprovante') return erro(409, 'nao_e_comprovante', 'Este arquivo não parece um comprovante de pagamento.');
  }

  // D6: a IA confere o valor NO SERVIDOR, pela leitura gravada na subida. IA fora: salva "não conferido". Só o ADM passa por cima.
  let conferencia: Conferencia = p.semArquivo ? 'estorno' : 'sem_leitura';
  const valor = base.valor_centavos;
  if (reg && reg.leitura === 'ok' && reg.sugestao && reg.sugestao.valor_centavos !== null) {
    if (reg.sugestao.confianca === 'alta' || reg.sugestao.confianca === 'media') {
      if (reg.sugestao.valor_centavos === valor) conferencia = 'bateu';
      else if (g.adm && corpo.confirmar_valor === true) conferencia = 'divergente_adm';
      else {
        return erro(409, 'valor_diferente', `O comprovante diz ${reaisBR(reg.sugestao.valor_centavos)}.`, { valor_lido_centavos: reg.sugestao.valor_centavos });
      }
    } else conferencia = 'baixa_confianca';
  }
  if (base.conferencia_fixa) conferencia = base.conferencia_fixa as Conferencia;

  const idt = reg?.sugestao?.id_transacao && PIX.test(reg.sugestao.id_transacao.trim()) ? reg.sugestao.id_transacao.trim() : '';
  const lido = reg?.leitura === 'ok' && reg.sugestao
    ? { valor_centavos: reg.sugestao.valor_centavos, data: reg.sugestao.data, id_transacao: reg.sugestao.id_transacao }
    : null;
  const { conferencia_fixa: _cf, ...resto } = base;
  void _cf;
  const m = montarLancamentoObra({
    ...resto, conferencia, id_transacao: idt || (reg?.sugestao?.id_transacao ?? ''), lido_pela_ia: lido, origem: lido ? 'ia' : 'manual',
    arquivo: reg ? { path: reg.path, nome: reg.nome, tipo: reg.tipo, tamanho: reg.tamanho, sha256: reg.sha256 } : null,
  }, { cardId: g.id, autor: g.nome, agoraIso, hojeBr: hojeBr() });
  if (!m.ok) return erro(400, m.erro);
  const assinado = lancamentoObraParaGravar(g.id, m.lancamento);
  if (!assinado) return erro(503, 'sem_segredo', 'Não consegui gravar agora. Tente de novo.');

  const gravar = async (): Promise<Saida> => {
    // O mesmo id de novo (toque duplo, rede que caiu e repetiu): devolve o que existe, sem gravar de novo.
    const existente = await lerLancamentoObra(g.id, assinado.id);
    if (existente) {
      return existente.arquivo?.sha256 === assinado.arquivo?.sha256 && existente.valor_centavos === assinado.valor_centavos && existente.categoria === assinado.categoria
        ? { http: 200, json: { ok: true, repetido_pedido: true } }
        : erro(409, 'mudou', 'Este lançamento já existe com outros dados.');
    }
    if (reg) {
      const achados = await buscarNoFinanceiro(reg.sha256, idt);
      if (achados.comprovante) {
        const onde = await ondeEsta(g, achados.comprovante);
        return erro(409, 'comprovante_repetido', fraseOnde(onde, 'comprovante'), { onde });
      }
      if (!p.pularAvisos && corpo.confirmar_duplicado !== true) {
        const dups: Array<Record<string, unknown>> = [];
        const vistos = new Set<string>();
        const viva = (l: LancamentoObra): boolean => !l.obra.estorno_de && !d.livro.linhas.find((x) => x.id === l.id)?.estornada;
        for (const l of d.lancamentos) {
          if (!viva(l)) continue;
          const mesmaTransacao = !!idt && l.id_transacao.trim() === idt;
          const mesmoValor = l.tipo === assinado.tipo && l.valor_centavos === assinado.valor_centavos && l.data === assinado.data;
          if (!mesmaTransacao && !mesmoValor) continue;
          vistos.add(l.id);
          dups.push({ id: l.id, tipo: l.tipo, valor_centavos: l.valor_centavos, data: l.data, categoria: l.categoria, motivo: mesmaTransacao ? 'mesma_transacao' : 'mesmo_valor_e_data', onde: 'esta obra' });
        }
        for (const a of achados.transacoes) {
          if (a.card === g.id) continue;
          dups.push({ motivo: 'mesma_transacao', onde: await ondeEsta(g, a) });
        }
        if (dups.length) return { http: 409, json: { ok: false, error: 'possivel_duplicado', duplicados: dups } };
      }
    }
    if (!(await inserirLancamentoObra(assinado))) {
      const l = await lerLancamentoObra(g.id, assinado.id);
      return l && l.arquivo?.sha256 === assinado.arquivo?.sha256 && l.valor_centavos === assinado.valor_centavos
        ? { http: 200, json: { ok: true, repetido_pedido: true } }
        : erro(409, 'mudou', 'Outra pessoa lançou agora. Tente de novo.');
    }
    return { http: 200, json: { ok: true } };
  };

  // A trava da CONTA (uma por obra): o fechamento calcula o "tudo em zero" dentro dela, então nenhum lançamento entra no meio. Reconfere a conta fechada aqui dentro.
  const saida = await comTrava(`fin_conta:${g.id}`, g.nome, async (): Promise<Saida> => {
    const { estado } = await lerObraComVersao(g.id);
    if (estado?.fechada) return erro(409, 'conta_fechada', MSG_FECHADA);
    return reg ? await comTrava(`fin_sha:${reg.sha256.slice(0, 32)}`, g.nome, gravar) : await gravar();
  });
  if (saida.http !== 200) return saida;
  return { http: 200, json: { ok: true, id: assinado.id } };
}

/** A resposta de uma gravação que deu certo: o lançamento e, para quem pode ver, o livro novo inteiro. */
async function respostaDaGravacao(g: GuardaObra, id: string): Promise<Saida> {
  const d = await lerDinheiro(g);
  if (!d.veDinheiro) {
    const l = d.livro.linhas.find((x) => x.id === id);
    return { http: 200, json: { ok: true, lancamento: l ? { id: l.id, etapa: l.etapa, categoria: l.categoria, valor_centavos: l.valor_centavos } : { id } } };
  }
  const livro = await livroComUrls(d, g);
  return { http: 200, json: { ok: true, lancamento: livro.linhas.find((x) => x.id === id) ?? { id }, livro } };
}

const enviar = (res: Response, s: Saida): void => { res.status(s.http).json(s.json); };

// ── As rotas ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function mountJornadaDinheiro(router: Router): void {
  const base = [exigeConsultor, semCache];

  // ── Rota 1 · O livro ───────────────────────────────────────────────────────────────────────────────────────────────
  router.get('/jornada-solar/obra/:card/dinheiro', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    try {
      const d = await lerDinheiro(g);
      if (!d.veDinheiro) { res.json({ ok: true, visivel: false }); return; }
      res.json({
        ok: true, visivel: true,
        livro: await livroComUrls(d, g),
        categorias: CATEGORIAS_OBRA.filter((c) => c.grupo !== 'retirada' || veRetiradaDosSocios(g.nome, g.adm)).map((c) => ({ tipo: c.tipo, slug: c.slug, rotulo: c.rotulo, grupo: c.grupo, previsto: c.previsto, quem: c.quem })),
        formas: catalogoFinanceiro().formas,
        pode: podeDoDinheiro(g, d),
        previsto: d.privada?.previsto ? { homologacao: d.privada.previsto.homologacao, material: d.privada.previsto.material, frete: d.privada.previsto.frete, mao_de_obra: d.privada.previsto.mao_de_obra, outros: d.privada.previsto.outros } : null,
        previsto_versao: d.privada?.versoes.previsto ?? 0,
        ajustes_valido: d.ajustesValido,
      });
    } catch (err) { falhouJornada(res, 'dinheiro', err, true); }
  });

  // ── Rota 2 · Sobe o comprovante e grava o que a IA leu ───────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/dinheiro/comprovante', ...base, limiteSeForLer, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    if (!b || typeof b.base64 !== 'string' || !b.base64 || typeof b.media_type !== 'string' || (b.nome !== undefined && typeof b.nome !== 'string')
      || (b.doc !== undefined && b.doc !== 'comprovante' && b.doc !== 'nota') || (b.ler !== undefined && typeof b.ler !== 'boolean')) {
      res.status(400).json({ ok: false, error: MSG_PEDIDO }); return;
    }
    const doc = b.doc === 'nota' ? 'nota' : 'comprovante';
    try {
      const { estado: js } = await lerJornadaComVersao(g.id);
      // Obra cancelada só recebe comprovante (o do estorno com devolução); nota fiscal não.
      if (js?.cancelada && doc === 'nota') { res.status(409).json({ ok: false, error: 'cancelada', mensagem: MSG_CANCELADA }); return; }
      const subida = await subirComprovante(g.id, { base64: b.base64, media_type: b.media_type, nome: b.nome });
      if (!subida.ok) {
        const status = subida.erro === 'bucket_indisponivel' ? 503 : subida.erro === 'armazenamento_falhou' ? 502 : 400;
        res.status(status).json({ ok: false, error: subida.erro }); return;
      }
      const { bytes, ...arquivo } = subida.arquivo;

      let leitura: 'ok' | 'nao_e_comprovante' | 'falhou' | 'pulada' = 'pulada';
      let sugestao: Record<string, unknown> | null = null;
      let nota: Record<string, unknown> | null = null;
      // Falha na leitura NÃO derruba a subida: o arquivo já está guardado e a pessoa preenche à mão.
      // O servidor SEMPRE lê: o `ler` do corpo é ignorado. Só o ADM pula (`ler: false`). IA fora: o lançamento salva como "não conferido".
      const pula = pulaALeitura(req);
      if (!pula && doc === 'nota') {
        try {
          const r = await lerNota({ bytes, media_type: arquivo.tipo, hojeBr: hojeBr() });
          if (!r.ok) leitura = 'falhou';
          else if (!r.eh_documento) leitura = 'nao_e_comprovante';
          else { leitura = 'ok'; nota = { ...r.nota }; }
        } catch { leitura = 'falhou'; }
      }
      if (!pula && doc === 'comprovante') {
        try {
          const r = await lerComprovante({ bytes, media_type: arquivo.tipo, hojeBr: hojeBr() });
          if (!r.ok) leitura = 'falhou';
          else if (!r.eh_comprovante) leitura = 'nao_e_comprovante';
          else { leitura = 'ok'; sugestao = { ...r.sugestao }; }
        } catch { leitura = 'falhou'; }
      }
      const gravado = await gravarLeituraDoArquivo(arquivo.path, {
        v: 1, card_id: g.id, path: arquivo.path, nome: arquivo.nome, tipo: arquivo.tipo, tamanho: arquivo.tamanho, sha256: arquivo.sha256, doc,
        por: g.nome, em: new Date().toISOString(), leitura,
        sugestao: sugestao ? {
          valor_centavos: sugestao.valor_centavos ?? null, data: sugestao.data ?? null, id_transacao: sugestao.id_transacao ?? null,
          forma: sugestao.forma ?? null, recebedor: sugestao.recebedor ?? null, confianca: sugestao.confianca ?? 'baixa',
        } : null,
        nota,
      });
      if (!gravado) { res.status(503).json({ ok: false, error: 'leitura_nao_gravada', mensagem: 'Não consegui guardar o comprovante. Anexe de novo.' }); return; }

      // Já avisa o repetido, sem gravar nada (a recusa de verdade é no lançamento, dentro da trava).
      let repetido: { onde: string } | undefined;
      if (doc === 'comprovante') {
        const achados = await buscarNoFinanceiro(arquivo.sha256, '');
        if (achados.comprovante) repetido = { onde: await ondeEsta(g, achados.comprovante) };
      }
      res.json({
        ok: true,
        arquivo: { path: arquivo.path, nome: arquivo.nome, tipo: arquivo.tipo, tamanho: arquivo.tamanho, url: await assinarComprovante(arquivo.path, 3600) },
        leitura, sugestao, nota, ...(repetido ? { repetido } : {}),
      });
    } catch (err) { falhouJornada(res, 'comprovante', err); }
  });

  // ── Rota 3 · Lança entrada ou gasto ──────────────────────────────────────────────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/dinheiro/lancamento', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    if (!b) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    if (typeof b.id !== 'string' || !ID_LANCAMENTO.test(b.id) || idReservado(b.id)) { res.status(400).json({ ok: false, error: 'id_invalido' }); return; }
    try {
      const d = await lerDinheiro(g);
      if (d.cancelada) { res.status(409).json({ ok: false, error: 'cancelada', mensagem: MSG_CANCELADA }); return; }
      if (d.fechada) { res.status(409).json({ ok: false, error: 'conta_fechada', mensagem: MSG_FECHADA }); return; }
      if (b.categoria === 'comissao_venda' || b.categoria === 'retirada_socio') {
        res.status(400).json({ ok: false, error: 'so_pela_comissao', mensagem: 'Comissão se lança no bloco Comissões da etapa 2.' }); return;
      }
      if (b.tipo === 'entrada' && !ehGiovOuAdm(g)) {
        res.status(403).json({ ok: false, error: 'so_giovanna', mensagem: 'Só a Giovanna e o Thiago lançam recebimento.' }); return;
      }
      if (!d.veDinheiro && b.tipo !== 'saida') { res.status(403).json({ ok: false, error: 'sem_acesso' }); return; }
      const max = await etapaMaxima(g, d.js, d.jo, d.lig);
      if (typeof b.etapa !== 'number' || !Number.isInteger(b.etapa) || b.etapa < 1 || b.etapa > max) {
        res.status(400).json({ ok: false, error: 'etapa_invalida', mensagem: 'Esta etapa ainda não abriu.' }); return;
      }
      for (const k of ['compra_id', 'carga_id'] as const) {
        if (b[k] !== undefined && b[k] !== null && (typeof b[k] !== 'string' || !(await vinculoExiste(g.id, k, b[k] as string)))) {
          res.status(400).json({ ok: false, error: 'vinculo_invalido' }); return;
        }
      }
      const s = await gravarLancamento({
        g, d, corpo: b, arquivoPath: b.arquivo_path,
        base: {
          id: b.id, tipo: b.tipo, categoria: b.categoria, etapa: b.etapa, valor_centavos: b.valor_centavos, data: b.data, forma: b.forma,
          descricao: b.descricao, contraparte: b.contraparte, compra_id: b.compra_id ?? null, carga_id: b.carga_id ?? null,
        },
      });
      if (s.http !== 200) { enviar(res, s); return; }
      enviar(res, await respostaDaGravacao(g, b.id));
    } catch (err) { falhouJornada(res, 'lancamento', err); }
  });

  // ── Rota 4 · Paga a comissão (quem vendeu é custo; os 2% de cada sócio são retirada) ─────────────────────────────────
  router.post('/jornada-solar/obra/:card/dinheiro/comissao', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    if (!b) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    if (!ehGiovOuAdm(g)) { res.status(403).json({ ok: false, error: 'so_giovanna', mensagem: 'Só a Giovanna e o Thiago pagam comissão.' }); return; }
    if (typeof b.id !== 'string' || !ID_LANCAMENTO.test(b.id) || idReservado(b.id)) { res.status(400).json({ ok: false, error: 'id_invalido' }); return; }
    const idNovo = b.id;
    const nome = typeof b.nome === 'string' ? nomeSimples(b.nome) : '';
    if (!nome || (b.papel !== 'venda' && b.papel !== 'socio')) { res.status(400).json({ ok: false, error: 'linha_invalida' }); return; }
    try {
      await comTrava(`fin_comissao:${g.id}`, g.nome, async () => {
        const d = await lerDinheiro(g);
        if (d.cancelada) { res.status(409).json({ ok: false, error: 'cancelada', mensagem: MSG_CANCELADA }); return; }
        if (d.fechada) { res.status(409).json({ ok: false, error: 'conta_fechada', mensagem: MSG_FECHADA }); return; }
        if (!d.livro.comissoes.liberadas) {
          res.status(409).json({ ok: false, error: 'sem_entrada', mensagem: 'A comissão libera depois que a entrada entrar.' }); return;
        }
        const linha = d.livro.comissoes.linhas.find((l) => l.nome === nome && l.papel === b.papel);
        if (!linha) { res.status(400).json({ ok: false, error: 'linha_invalida' }); return; }
        // A venda corrigida muda a devida: a comissão já paga recebe só a DIFERENÇA que falta; paga a mais ou igual, 409.
        if (linha.pago_centavos > 0 && linha.diferenca_centavos <= 0) { res.status(409).json({ ok: false, error: 'ja_paga', mensagem: 'Esta comissão já foi paga.' }); return; }
        const devido = linha.pago_centavos > 0 ? linha.diferenca_centavos : linha.valor_centavos;
        if (!d.venda || linha.valor_centavos <= 0) { res.status(409).json({ ok: false, error: 'sem_valor', mensagem: 'Sem valor de venda: combine na etapa 2.' }); return; }
        const pct = `${String(linha.pb / 100).replace('.', ',')}%`;
        const s = await gravarLancamento({
          g, d, corpo: b, arquivoPath: b.arquivo_path,
          base: {
            id: b.id, tipo: 'saida', categoria: linha.papel === 'venda' ? 'comissao_venda' : 'retirada_socio', etapa: 2, valor_centavos: devido,
            data: b.data, forma: b.forma, descricao: (linha.papel === 'venda' ? `Comissão de venda, ${bonito(nome)} (${pct})` : `${bonito(nome)}, sócio ${pct}`) + (linha.pago_centavos > 0 ? ', diferença' : ''),
            contraparte: bonito(nome), comissao: { nome, papel: linha.papel, pb: linha.pb },
          },
        });
        if (s.http !== 200) { enviar(res, s); return; }
        // D14: a obra congela a regra no primeiro pagamento de comissão.
        if (!d.privada?.regra_comissao) {
          const congelar = await mudarObraPrivada(g.id, g.nome, null, null, (p) => (p.regra_comissao ? p : { ...p, regra_comissao: { linhas: d.regra.linhas.map((l) => ({ ...l })), congelada_em: new Date().toISOString() } }));
          if (ehRecusa(congelar)) logErroJornada('congelar', { codigo: congelar.recusa });
        }
        enviar(res, await respostaDaGravacao(g, idNovo));
      });
    } catch (err) { if (!res.headersSent) falhouJornada(res, 'comissao', err); }
  });

  // ── Rota 5 · Estorno (o erro se corrige com uma linha nova, nunca apagando) ─────────────────────────────────────────
  router.post('/jornada-solar/obra/:card/dinheiro/estorno', ...base, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    if (!b) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    if (typeof b.id_original !== 'string' || !ID_LANCAMENTO.test(b.id_original)) { res.status(404).json({ ok: false, error: 'nao_encontrado' }); return; }
    const motivo = typeof b.motivo === 'string' ? b.motivo.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
    try {
      const d = await lerDinheiro(g);
      const original = d.lancamentos.find((l) => l.id === b.id_original);
      if (!original) { res.status(404).json({ ok: false, error: 'nao_encontrado' }); return; }
      if (original.obra.estorno_de) { res.status(400).json({ ok: false, error: 'ja_e_estorno', mensagem: 'Um estorno não se estorna.' }); return; }
      const linhaOrig = d.livro.linhas.find((l) => l.id === original.id);
      if (!linhaOrig || !podeEstornar(g, linhaOrig)) { res.status(403).json({ ok: false, error: 'sem_permissao', mensagem: 'Você não pode estornar este lançamento.' }); return; }
      if (!d.veDinheiro && (ehSensivel(linhaOrig) || linhaOrig.criado_por !== g.nome)) { res.status(403).json({ ok: false, error: 'sem_acesso' }); return; }
      if (d.fechada) { res.status(409).json({ ok: false, error: 'conta_fechada', mensagem: MSG_FECHADA }); return; }
      if (motivo.length < 3 || motivo.length > 300) { res.status(400).json({ ok: false, error: 'motivo_invalido', mensagem: 'Diga o motivo do estorno.' }); return; }
      const devolucao = b.devolucao === true;
      if (devolucao && original.tipo !== 'entrada') { res.status(400).json({ ok: false, error: 'devolucao_invalida', mensagem: 'Devolução só existe em estorno de entrada.' }); return; }
      if (devolucao && (typeof b.arquivo_path !== 'string' || !b.arquivo_path)) {
        res.status(400).json({ ok: false, error: 'devolucao_sem_comprovante', mensagem: 'A devolução precisa do comprovante.' }); return;
      }
      const idEstorno = idDoEstorno(original.id);
      if (await lerLancamentoObra(g.id, idEstorno)) { res.status(409).json({ ok: false, error: 'ja_estornado', mensagem: 'Este lançamento já foi estornado.' }); return; }
      const s = await gravarLancamento({
        g, d, corpo: b, arquivoPath: b.arquivo_path, semArquivo: !devolucao, pularAvisos: true,
        base: {
          id: idEstorno, tipo: original.tipo, categoria: original.categoria, etapa: original.obra.etapa, valor_centavos: original.valor_centavos,
          data: hojeBr(), forma: original.forma, descricao: `Estorno: ${original.descricao}`.slice(0, 200), contraparte: original.contraparte,
          compra_id: original.obra.compra_id, carga_id: original.obra.carga_id, comissao: original.obra.comissao,
          estorno_de: original.id, motivo_estorno: motivo, devolucao, conferencia_fixa: 'estorno',
        },
      });
      if (s.http !== 200) {
        if (s.json.error === 'mudou') { res.status(409).json({ ok: false, error: 'ja_estornado', mensagem: 'Este lançamento já foi estornado.' }); return; }
        enviar(res, s); return;
      }
      enviar(res, await respostaDaGravacao(g, idEstorno));
    } catch (err) { falhouJornada(res, 'estorno', err); }
  });

  // ── Rota 5b · O ADM confere a linha que a IA não conferiu (não apaga nada: a linha é reassinada com a marca nova) ──────────
  router.post('/jornada-solar/obra/:card/dinheiro/conferir', ...base, exigeAdm, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    if (!b || typeof b.id !== 'string' || !ID_LANCAMENTO.test(b.id)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    try {
      await comTrava(`fin_conta:${g.id}`, g.nome, async () => {
        const d = await lerDinheiro(g);
        if (d.fechada) { res.status(409).json({ ok: false, error: 'conta_fechada', mensagem: MSG_FECHADA }); return; }
        const { l, versao } = await lerLancamentoObraComVersao(g.id, b.id as string);
        if (!l || versao === null) { res.status(404).json({ ok: false, error: 'nao_encontrado' }); return; }
        if (l.obra.estorno_de || (l.obra.conferencia !== 'sem_leitura' && l.obra.conferencia !== 'baixa_confianca')) {
          res.status(409).json({ ok: false, error: 'nada_a_conferir', mensagem: 'Este lançamento não está esperando conferência.' }); return;
        }
        // Registra quem marcou, quando e de quê para quê (a linha é reassinada; nada se apaga).
        const novo = lancamentoObraParaGravar(g.id, {
          ...l, alteracoes: [...l.alteracoes, { em: new Date().toISOString(), por: g.nome, de: l.obra.conferencia, para: 'conferido_adm' }],
          obra: { ...l.obra, conferencia: 'conferido_adm' },
        });
        if (!novo) { res.status(503).json({ ok: false, error: 'sem_segredo' }); return; }
        if (!(await atualizarLancamentoObra(novo, versao))) { res.status(409).json({ ok: false, error: 'mudou', mensagem: 'Outra pessoa mexeu agora. Tente de novo.' }); return; }
        enviar(res, await respostaDaGravacao(g, l.id));
      });
    } catch (err) { if (!res.headersSent) falhouJornada(res, 'conferir', err); }
  });

  // ── Rota 6 · O previsto por grupo (ADM) ───────────────────────────────────────────────────────────────────────────────
  router.put('/jornada-solar/obra/:card/dinheiro/previsto', ...base, exigeAdm, async (req: Request, res: Response) => {
    const g = await guardaDaObra(req, res);
    if (!g) return;
    const b = corpoDe(req);
    const centavos = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= VALOR_MAX_CENTAVOS ? v : null);
    if (!b || typeof b.versao !== 'number' || !Number.isInteger(b.versao)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    const v = { homologacao: centavos(b.homologacao), material: centavos(b.material), frete: centavos(b.frete), mao_de_obra: centavos(b.mao_de_obra), outros: centavos(b.outros) };
    if (Object.values(v).some((x) => x === null)) { res.status(400).json({ ok: false, error: 'valor_invalido', mensagem: 'Valor do previsto inválido.' }); return; }
    try {
      const { estado: jo } = await lerObraComVersao(g.id);
      if (jo?.fechada) { res.status(409).json({ ok: false, error: 'conta_fechada', mensagem: MSG_FECHADA }); return; }
      const r = await mudarObraPrivada(g.id, g.nome, 'previsto', b.versao, (p) => ({
        ...p, previsto: { homologacao: v.homologacao as number, material: v.material as number, frete: v.frete as number, mao_de_obra: v.mao_de_obra as number, outros: v.outros as number, por: g.nome, em: new Date().toISOString() },
      }));
      if (ehRecusa(r)) { res.status(r.http).json({ ok: false, ...(r.extra ?? {}) }); return; }
      const d = await lerDinheiro(g);
      res.json({ ok: true, previsto_versao: r.versoes.previsto, livro: await livroComUrls(d, g) });
    } catch (err) { falhouJornada(res, 'previsto', err); }
  });

  // ── Rota 7 · Os Ajustes do Solar ──────────────────────────────────────────────────────────────────────────────────────
  router.get('/jornada-solar/ajustes', ...base, async (_req: Request, res: Response) => {
    try {
      const { ajustes, valido } = await lerAjustes();
      res.json({ ok: true, ajustes, padrao: AJUSTES_PADRAO, valido, socios: listaSocios() });
    } catch (err) { falhouJornada(res, 'ajustes', err, true); }
  });

  router.put('/jornada-solar/ajustes', ...base, exigeAdm, async (req: Request, res: Response) => {
    const b = corpoDe(req);
    if (!b || typeof b.dinheiro_aberto !== 'boolean') { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    const v = validarAjustes(b.comissoes);
    if (!v.ok) { res.status(400).json({ ok: false, error: v.erro, mensagem: 'Ajustes inválidos. Confira as linhas.' }); return; }
    try {
      const nome = String((req as any).consultor?.nome || '').trim().toLowerCase();
      const ajustes = await gravarAjustes({ comissoes: v.comissoes, dinheiro_aberto: b.dinheiro_aberto }, nome);
      res.json({ ok: true, ajustes, padrao: AJUSTES_PADRAO, valido: true, socios: listaSocios() });
    } catch (err) { falhouJornada(res, 'ajustes', err); }
  });
}

/** Compra ou carga do `obra.json` (a Compra e a Logística chegam na etapa 4 e 5). */
async function vinculoExiste(card: number, tipo: 'compra_id' | 'carga_id', id: string): Promise<boolean> {
  const p = await lerObraPrivada(card);
  if (!p) return false;
  return tipo === 'compra_id' ? p.compra.compras.some((c) => c.id === id) : p.logistica.cargas.some((c) => c.id === id);
}

