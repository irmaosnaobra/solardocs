import { Router, Request, Response } from 'express';
import { exigeConsultor } from './geradorDossie';
import { semCache, lerDocs, dossieDaVendaSolar, type Ctx } from './geradorClientesDocs';
import { acessoVendaSolar } from './geradorClientes';
import { planilha, comSobrescritas } from './geradorSolar';
import { responderErroDoAlocador } from './geradorVendaSolarCliente';
import { tentarNumeroDaJornada, baseDaJornada, responderNumero409 } from './geradorJornadaNumero';
import { supabaseGerador } from '../utils/supabaseGerador';
import { generateFromTemplate } from '../services/templateService';
import { limparHtmlPapel } from '../services/gerador/htmlPapelSeguro';
import { codigoDeRota, nomesParecidos } from '../services/gerador/docsCliente';
import { lerCadastroVisto, tipoDoCadastro, type Cadastro } from '../services/gerador/cadastroVenda';
import { ErroCadastro, comTrava } from '../services/gerador/cadastroVendaBanco';
import { ErroDocs, lerPropostaResumo, lerSlotsDosCards } from '../services/gerador/docsClienteBanco';
import { lerProposta, normalizarNome } from '../services/gerador/dossieVenda';
import { equipamentoDaProposta } from '../services/gerador/trelloVendaSolar';
import {
  ErroHub, TRAVA_VINCULOS, POR_GERADOR, lerLigacao, lerTodasLigacoes, gravarLigacao, invalidarCachesHub, quemUsa,
  lerCardsPorIds, lerCardsSolarVendidos, compararTelefones, propostaDoPapel, segredoDoVinculo, type Ligacao,
} from '../services/gerador/vendaSolarHub';
import { ehOrigemEletroposto } from '../services/agenda/origemEtiqueta';
import { diaDeBrasilia } from '../services/agenda/viradaDoDia';
import { codigoCanonico, ehAdm, ehSocio, hojeBRT, montarObra, nomeSimples, podeVer, type ObraMontada } from '../services/gerador/solarObras';
import type { CardVendido } from '../services/gerador/fichaEletroposto';
import {
  CURTOS_ETAPA, DONOS_FIXOS, FORMAS_PAGAMENTO, MOTIVOS_ESPERA, NOMES_ETAPA, TIPOS_PAPEL, ROTULO_ESPERA,
  comissoesDaVenda, ddmm, deduzirEtapa, donosDaEtapa, estadoMaterializado, etapaAtualDoEstado, iniciais, itensDaEtapa, marcaDoRateio,
  podeConcluir, prazoDaEtapa, rateioDoCadastro, situacao, somarDiasUteis, totalDoRateio, veObra,
  type EntradaItens, type EstadoJornada, type FormaPagamento, type MotivoEspera, type PrivadoJornada, type Situacao, type TipoPapel,
} from '../services/gerador/jornadaSolar';
import {
  ErroJornada, ehRecusa, lerJornadaComVersao, lerPrivadoJornada, lerTodasJornadas, mudarJornada, mudarPrivadoJornada,
  MAX_NOTA, MAX_PRAZO, type Recusa,
} from '../services/gerador/jornadaSolarBanco';

// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 1 (05/11/2026). Montada dentro de /gerador por `mountJornadaSolar`. Todas as rotas exigem consultor
// logado e respondem `Cache-Control: no-store`. A guarda da obra é a do card vendido (`acessoVendaSolar`): inexistente e alheio dão 404 igual.
//
//   POST  /vendas-solares/:card/vendido        marca o card como VENDIDO (único caminho) e abre a etapa 1. NUNCA dá número.
//   GET   /jornada-solar/lista                 a lista de Clientes
//   GET   /jornada-solar/obra/:card            a obra (etapas 1 a 3)
//   PUT   /jornada-solar/obra/:card/venda      valor, forma de pagamento, prazo e nota (JSON privado)
//   POST  /jornada-solar/obra/:card/proposta   liga a proposta aceita
//   PATCH /jornada-solar/obra/:card            excedente, engenheiro, protocolo e rateio conferido
//   POST  /jornada-solar/obra/:card/etapa      conclui a etapa da vez
//   POST  /jornada-solar/obra/:card/esperar    "Esperando" (ou volta a cobrar)
//   POST  /jornada-solar/obra/:card/cancelar   e /descancelar
//   POST  /jornada-solar/obra/:card/papel      contrato, procuração e recibo da SolarDoc (emitente AIOROS LTDA)
//   POST  /jornada-solar/obra/:card/numero     "Tentar o número de novo"
//
// Nenhuma mensagem sai daqui (nada de WhatsApp, Instagram nem e-mail). Nenhum log leva nome, telefone, valor ou texto: só o código.
// O estado mora em `system_state` (`jornada_solar:<card>`, assinado); dinheiro e texto livre, no JSON privado do bucket.
// ─────────────────────────────────────────────────────────────────────────────

const MSG_PEDIDO = 'Pedido inválido.';
const MSG_LER = 'Não consegui ler os dados agora. Tente de novo em instantes.';
const MSG_GRAVAR = 'Não consegui gravar agora. Tente de novo.';
const MSG_NAO_ACHEI = 'Venda não encontrada.';

const logErro = (que: string, err: unknown): void =>
  console.error(`[jornada-solar] ${que}`, (err as { codigo?: unknown } | null)?.codigo ?? 'interno');

/** Responde o erro de uma rota. Conflito de gravação (`ocupado`) é 409 com `tentarDeNovo`; banco e segredo, 503. */
function falhou(res: Response, que: string, err: unknown, leitura = false): void {
  logErro(que, err);
  if ((err instanceof ErroJornada && err.codigo === 'ocupado') || (err instanceof ErroCadastro && err.codigo === 'ocupado')) {
    res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'Outra pessoa estava gravando agora. Tente de novo.' });
    return;
  }
  if (err instanceof ErroJornada || err instanceof ErroCadastro || err instanceof ErroHub || err instanceof ErroDocs) {
    res.status(503).json({ ok: false, error: leitura ? MSG_LER : MSG_GRAVAR });
    return;
  }
  res.status(500).json({ ok: false, error: leitura ? MSG_LER : MSG_GRAVAR });
}

const corpoDe = (req: Request): Record<string, unknown> | null => {
  const b = req.body === undefined || req.body === null ? {} : req.body;
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};
const quem = (req: Request): { nome: string; socio: boolean; adm: boolean } => {
  const nome = String((req as any).consultor?.nome || '').trim().toLowerCase();
  return { nome, socio: ehSocio(nome), adm: ehAdm(nome) };
};
const hojeDeBrasilia = (): string => diaDeBrasilia(Date.now());
/** Texto livre: sem caractere de controle (a quebra de linha vale só quando `multilinha`). */
const textoLimpo = (v: unknown, max: number, multilinha = false): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length > max) return null;
  return (multilinha ? /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(t) ? null : t;
};
const reaisBR = (centavos: number): string =>
  (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso: string): string => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

// ── A guarda da obra ──────────────────────────────────────────────────────────────────────────────────────────────

interface Guarda { nome: string; socio: boolean; adm: boolean; card: CardVendido; id: number; ctx: Ctx }

async function guardaObra(req: Request, res: Response): Promise<Guarda | null> {
  const { nome, socio, adm } = quem(req);
  const id = codigoDeRota('vendasolar', req.params.card);
  if (!id) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return null; }
  try {
    const card = await acessoVendaSolar(nome, socio, Number(id));
    if (!card) { res.status(404).json({ ok: false, error: MSG_NAO_ACHEI }); return null; }
    const ctx: Ctx = { linha: 'vendasolar', codigo: String(card.id), nome, socio, cliente: String(card.cliente_nome ?? ''), card };
    return { nome, socio, adm, card, id: Number(id), ctx };
  } catch (err) {
    falhou(res, 'posse falhou', err, true);
    return null;
  }
}

// ── O que se lê de uma obra ───────────────────────────────────────────────────────────────────────────────────────────

interface Leitura {
  lig: Ligacao;
  estado: EstadoJornada | null;
  privado: PrivadoJornada | null;
  cad: Cadastro;
  /** Os slots do card MAIS os do dossiê da proposta ligada. */
  slots: Set<string>;
  /** Só os slots do próprio card (o número nasce dos papéis anexados AQUI). */
  slotsDoCard: Set<string>;
  tem_cartao: boolean;
  proposta: Awaited<ReturnType<typeof lerProposta>>;
}

async function ler(g: Guarda, comProposta = true): Promise<Leitura> {
  const [{ lig }, { estado }, privado, cad, docs, dv] = await Promise.all([
    lerLigacao(g.id), lerJornadaComVersao(g.id), lerPrivadoJornada(g.id).catch((e) => { logErro('privado', e); return null; }),
    lerCadastroVisto(g.id, 'vendasolar'), lerDocs(g.ctx), dossieDaVendaSolar(g.ctx, 0, false).catch((e) => { logErro('dossiê', e); return null; }),
  ]);
  const slotsDoCard = new Set(docs.reg.arquivos.map((a) => a.slot));
  const slots = new Set(slotsDoCard);
  for (const a of dv?.arquivos ?? []) slots.add(a.slot);
  const proposta = comProposta && lig.proposta ? await lerProposta(lig.proposta).catch((e) => { logErro('proposta', e); return null; }) : null;
  return { lig, estado, privado, cad, slots, slotsDoCard, tem_cartao: !!lig.trello_card, proposta };
}

const vendedorDe = (card: CardVendido, estado: EstadoJornada | null): string => nomeSimples(card.vendedor_nome) || estado?.vendedor || '';

interface Posicao { trilho: 'jornada' | 'deduzida' | 'sem_trilho'; etapa: number | null; posvenda: boolean }
function posicaoDe(l: Leitura, planilhaEtapa?: string, planilhaFora?: boolean): Posicao {
  if (l.estado) return { trilho: 'jornada', etapa: etapaAtualDoEstado(l.estado), posvenda: false };
  const d = deduzirEtapa({ temNumero: !!l.lig.venda, slots: l.slots, planilha: planilhaEtapa, planilhaFora });
  return { trilho: d.trilho, etapa: d.etapa, posvenda: d.posvenda };
}

type EstadoNumero = 'tem' | 'cancelada' | 'falta_papeis' | 'falhou' | 'confirmar' | 'pronto';
function estadoDoNumero(l: Leitura): EstadoNumero {
  if (l.lig.venda) return 'tem';
  if (l.estado?.cancelada) return 'cancelada';
  const par = l.slotsDoCard.has('contrato_assinado') && l.slotsDoCard.has('procuracao');
  if (par && l.estado?.numero.falha === 'confirmar') return 'confirmar';
  if (par && l.estado?.numero.falha) return 'falhou';
  return par ? 'pronto' : 'falta_papeis';
}

function podeDe(g: Guarda, l: Leitura, pos: Posicao) {
  const vend = vendedorDe(g.card, l.estado);
  const ehVend = !!vend && g.nome === vend;
  const giov = g.nome === 'giovanna';
  const cancelada = !!l.estado?.cancelada;
  const etapa = pos.etapa;
  const e1Aberta = l.estado ? !l.estado.etapas[1].concluida_em : pos.etapa === 1;
  const e1Feita = !!l.estado?.etapas[1].concluida_em || (pos.trilho !== 'jornada' && pos.etapa !== null && pos.etapa > 1);
  const no123 = etapa !== null && etapa >= 1 && etapa <= 3;
  const par = l.slotsDoCard.has('contrato_assinado') && l.slotsDoCard.has('procuracao');
  const nEstado = estadoDoNumero(l);
  return {
    concluir: !cancelada && no123 && podeConcluir(g.nome, etapa as number, vend) ? [etapa as number] : [],
    cancelar: !cancelada && (g.adm || (!l.lig.venda && (ehVend || giov))),
    descancelar: cancelada && g.adm,
    esperar: !cancelada && no123 && (g.adm || donosDaEtapa(etapa as number, vend).includes(g.nome)),
    editar_venda: !cancelada && (e1Aberta ? (ehVend || g.adm) : (e1Feita && (giov || g.adm))),
    gerar_papeis: !cancelada && (giov || ehVend || g.adm) && e1Feita,
    marcar_excedente: !cancelada && (ehVend || g.adm) && e1Aberta,
    etapa3: !cancelada && (g.nome === 'thiago' || g.adm) && etapa === 3,
    numero: !cancelada && (giov || ehVend || g.adm) && par && !l.lig.venda,
    numero_novo: g.adm && nEstado === 'confirmar',
    ligar_proposta: !cancelada && (ehVend || g.adm) && e1Aberta,
  };
}

/** O `base()` da materialização para esta leitura (SPEC 3.6). */
const baseDe = (g: Guarda, l: Leitura) => baseDaJornada(g.card, l.slots, l.lig);

const entradaDe = (l: Leitura, estado: EstadoJornada | null): EntradaItens =>
  ({ lig: l.lig, slots: l.slots, cad: l.cad, privado: l.privado, estado });

// ── Rota 1 · Vendido ──────────────────────────────────────────────────────────────────────────────────────────────────

const linhaDoHistorico = (nome: string, statusAntes: string): string => {
  const f = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const p = (t: string): string => f.find((x) => x.type === t)?.value ?? '00';
  const nomeBonito = nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : 'Equipe';
  return `[${p('day')}/${p('month')} ${p('hour')}h${p('minute')} · ${nomeBonito}] 🏷️ Status: ${String(statusAntes || 'sem status').toUpperCase().replace(/_/g, ' ')} → VENDIDO.`;
};

async function rotaVendido(req: Request, res: Response): Promise<void> {
  const { nome, socio, adm } = quem(req);
  const id = codigoDeRota('vendasolar', req.params.card);
  if (!id) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  const b = corpoDe(req);
  if (!b) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  let linhaPedida: string | null = null;
  if (b.linha !== undefined) {
    const t = typeof b.linha === 'string' ? b.linha.trim() : '';
    if (!t || t.length > 400 || /[\r\n\u0000-\u001f]/.test(t) || !t.startsWith('[')) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    linhaPedida = t;
  }
  try {
    const card = (await lerCardsPorIds([Number(id)])).get(Number(id));
    if (card && ehOrigemEletroposto(card.created_by)) { res.status(409).json({ ok: false, precisa: 'eletroposto', error: 'Card de eletroposto não passa por aqui.' }); return; }
    const vendedor = String(card?.vendedor_nome ?? '');
    const pode = !!card && String(card.status ?? '').toLowerCase() !== 'cancelado'
      && (socio || adm || DONOS_FIXOS.has(nome) || podeVer(nome, vendedor) || !vendedor.trim());
    if (!card || !pode) { res.status(404).json({ ok: false, error: 'Card não encontrado.' }); return; }
    if (String(card.status ?? '').toLowerCase() === 'fechou') { res.json({ ok: true, ja_vendido: true, status: 'fechou' }); return; }

    // O status e o histórico, com a chave de serviço, só se o status continua o lido (zero linhas = mudou no meio: relê uma vez).
    let gravado: string | null = null;
    for (let t = 0; t < 2 && gravado === null; t++) {
      const { data: atual, error: eLer } = await supabaseGerador.from('agendamentos').select('status, historico').eq('id', Number(id)).maybeSingle();
      if (eLer || !atual) throw new ErroHub('card');
      const statusLido = String((atual as { status?: unknown }).status ?? '');
      if (statusLido.toLowerCase() === 'fechou') { res.json({ ok: true, ja_vendido: true, status: 'fechou' }); return; }
      const histAtual = String((atual as { historico?: unknown }).historico ?? '');
      const linha = linhaPedida ?? linhaDoHistorico(nome, statusLido);
      const novoHist = histAtual ? `${linha}\n\n${histAtual}` : linha;
      const { data: tocou, error: eGrava } = await supabaseGerador.from('agendamentos')
        .update({ status: 'fechou', historico: novoHist }).eq('id', Number(id)).eq('status', statusLido).select('id');
      if (eGrava) throw new ErroHub('gravar');
      if (Array.isArray(tocou) && tocou.length > 0) gravado = novoHist;
    }
    if (gravado === null) { res.status(409).json({ ok: false, conflito: true, tentarDeNovo: true, error: 'O card mudou agora. Tente de novo.' }); return; }

    // A etapa 1. Falha aqui não desfaz o status: a venda aparece deduzida.
    let jornada = false;
    try {
      const agora = new Date().toISOString();
      const novo = (): EstadoJornada => ({
        ...estadoMaterializado(Number(id), vendedor, 1, agora), origem: 'vendido', vendido_em: agora, vendido_por: nome,
        historico: [{ em: agora, por: nome, acao: 'vendido', etapa: 1 }],
      });
      const r = await mudarJornada(Number(id), novo, (e) => e);
      jornada = !ehRecusa(r);
    } catch (err) { logErro('abrir a etapa 1', err); }
    res.json({ ok: true, status: 'fechou', historico: gravado, jornada });
  } catch (err) {
    falhou(res, 'vendido', err);
  }
}

// ── Rota 2 · A lista ──────────────────────────────────────────────────────────────────────────────────────────────────

const ETAPA_DA_PLANILHA = (p: ObraMontada): number | null =>
  deduzirEtapa({ temNumero: true, slots: new Set(), planilha: p.etapaAtual }).etapa;

async function rotaLista(req: Request, res: Response): Promise<void> {
  const { nome, socio, adm } = quem(req);
  const hoje = hojeDeBrasilia();
  try {
    const porPlanilha = planilha(false).then(async (p) => (await comSobrescritas(p.dados.obras)).map((o) => montarObra(o, hojeBRT(new Date()))))
      .catch((e) => { logErro('planilha', e); return null; });
    const [obrasPl, cards, ligs, jornadas] = await Promise.all([porPlanilha, lerCardsSolarVendidos(), lerTodasLigacoes(), lerTodasJornadas()]);
    const plPorCodigo = new Map<string, ObraMontada>();
    for (const o of obrasPl ?? []) plPorCodigo.set(codigoCanonico(o.codigo), o);

    // Quem ainda precisa dos slots: sem estado (para deduzir) e com estado mas sem número (para o "Número pendente").
    const precisaSlots = cards.filter((c) => !jornadas.has(c.id) || !ligs.get(c.id)?.venda).map((c) => c.id);
    const slotsPorCard = await lerSlotsDosCards(precisaSlots);

    interface Linha {
      chave: string; card: number | null; codigo: string | null; cliente: string; cidade: string; vendida_em: string; consultor: string;
      grupo: 'ativas' | 'posvenda' | 'canceladas'; trilho: string; etapa: { n: number; nome: string } | null;
      dono: { nome: string; iniciais: string } | null; situacao: Situacao; minha: boolean; numero_pendente: string | null;
      cancelada: { em: string; por: string; motivo: string } | null; dinheiro: string | null;
    }
    const linhas: Linha[] = [];
    const usadas = new Set<string>();
    for (const c of cards) {
      const lig = ligs.get(c.id);
      const codigo = lig?.venda ?? null;
      const pl = codigo ? plPorCodigo.get(codigoCanonico(codigo)) : undefined;
      if (codigo) usadas.add(codigoCanonico(codigo));
      const vendedor = String(c.vendedor_nome ?? '');
      const viaPlanilha = !!pl && lig?.por !== POR_GERADOR && veObra(nome, pl.consultor);
      if (!veObra(nome, vendedor) && !viaPlanilha) continue;
      const estado = jornadas.get(c.id) ?? null;
      const slots = slotsPorCard.get(c.id) ?? new Set<string>();
      let trilho: string; let etapa: number | null; let posvenda = false;
      if (estado) { trilho = 'jornada'; etapa = etapaAtualDoEstado(estado); } else {
        const d = deduzirEtapa({ temNumero: !!codigo, slots, planilha: pl?.etapaAtual, planilhaFora: obrasPl === null });
        trilho = d.trilho; etapa = d.etapa; posvenda = d.posvenda;
      }
      const vend = nomeSimples(vendedor) || estado?.vendedor || '';
      const donos = etapa ? donosDaEtapa(etapa, vend) : [];
      const grupo = estado?.cancelada ? 'canceladas' : (posvenda || etapa === 9 ? 'posvenda' : 'ativas');
      let sit: Situacao;
      if (trilho === 'jornada' && etapa) sit = situacao(etapa, estado, hoje);
      else if (trilho === 'deduzida') sit = { tipo: 'sem_prazo', texto: 'Sem prazo: venda de antes da Jornada' };
      else sit = { tipo: 'sem_prazo', texto: 'Não é cobrada' };
      const minha = grupo === 'ativas' && !!etapa && etapa <= 3 && (trilho === 'jornada' || trilho === 'deduzida') && donos.includes(nome);
      let pendente: string | null = null;
      if (adm && !codigo && !estado?.cancelada) {
        const par = slots.has('contrato_assinado') && slots.has('procuracao');
        if (estado?.numero.falha === 'confirmar') pendente = 'confirmar';
        else if (estado?.numero.falha) pendente = 'falhou';
        else if (par) pendente = 'pronto';
      }
      let dinheiro: string | null = null;
      if (adm) {
        if (pl?.recebimento === 'quitado') dinheiro = 'Quitada';
        else if (pl?.recebimento === 'nao_quitado') dinheiro = `A receber R$ ${reaisBR(Math.round(pl.valores.aReceber * 100))}`;
        else if (estado) dinheiro = estado.etapas[2].concluida_em ? 'Contrato assinado' : 'Antes do contrato';
        else dinheiro = 'Sem registro';
      }
      const vendida = estado?.vendido_em ? diaDeBrasilia(estado.vendido_em)
        : (pl?.vendaEm ?? (c.quando ? diaDeBrasilia(c.quando) : (c.created_at ? diaDeBrasilia(c.created_at) : '')));
      linhas.push({
        chave: `c:${c.id}`, card: c.id, codigo, cliente: String(c.cliente_nome ?? ''), cidade: String(c.cidade ?? ''), vendida_em: vendida,
        consultor: vend, grupo, trilho, etapa: etapa ? { n: etapa, nome: NOMES_ETAPA[etapa] } : null,
        dono: donos[0] ? { nome: donos[0], iniciais: iniciais(donos[0]) } : null, situacao: sit, minha, numero_pendente: pendente,
        cancelada: estado?.cancelada ? { em: estado.cancelada.em, por: estado.cancelada.por, motivo: '' } : null, dinheiro,
      });
    }
    // As linhas da planilha que nenhum card usa.
    for (const [cod, o] of plPorCodigo) {
      if (usadas.has(cod) || !veObra(nome, o.consultor)) continue;
      const et = ETAPA_DA_PLANILHA(o);
      linhas.push({
        chave: `p:${o.codigo}`, card: null, codigo: o.codigo, cliente: o.cliente, cidade: [o.cidade, o.uf].filter(Boolean).join(' - '),
        vendida_em: o.vendaEm ?? '', consultor: nomeSimples(o.consultor), grupo: o.etapaAtual === 'concluida' ? 'posvenda' : 'ativas', trilho: 'planilha',
        etapa: et ? { n: et, nome: NOMES_ETAPA[et] } : null, dono: null, situacao: { tipo: 'sem_prazo', texto: 'Lida da planilha' },
        minha: false, numero_pendente: null, cancelada: null,
        dinheiro: adm ? (o.recebimento === 'quitado' ? 'Quitada' : o.recebimento === 'nao_quitado' ? `A receber R$ ${reaisBR(Math.round(o.valores.aReceber * 100))}` : 'Sem registro') : null,
      });
    }
    // O motivo das canceladas (até 30), do JSON privado.
    const canceladas = linhas.filter((l) => l.grupo === 'canceladas' && l.card !== null).slice(0, 30);
    await Promise.all(canceladas.map(async (l) => {
      try { const p = await lerPrivadoJornada(l.card as number); if (l.cancelada) l.cancelada.motivo = p?.cancelamento?.motivo ?? ''; } catch (err) { logErro('motivo', err); }
    }));
    linhas.sort((a, b) => (b.vendida_em > a.vendida_em ? 1 : b.vendida_em < a.vendida_em ? -1 : 0)
      || ((b.card ?? -1) - (a.card ?? -1)));
    const atrasadas = linhas.filter((l) => l.grupo === 'ativas' && l.trilho === 'jornada' && (l.situacao.tipo === 'atrasada' || l.situacao.tipo === 'travada')).length;
    res.json({
      ok: true, hoje,
      eu: { nome, adm, vePorConsultor: adm || socio || DONOS_FIXOS.has(nome) },
      fonte: { planilha: obrasPl !== null },
      contagem: {
        ativas: linhas.filter((l) => l.grupo === 'ativas').length, posvenda: linhas.filter((l) => l.grupo === 'posvenda').length,
        canceladas: linhas.filter((l) => l.grupo === 'canceladas').length, atrasadas, minha: linhas.filter((l) => l.minha).length,
      },
      linhas,
    });
  } catch (err) {
    falhou(res, 'lista', err, true);
  }
}

// ── Rota 3 · A obra ───────────────────────────────────────────────────────────────────────────────────────────────────

const RE_CODIGO_PROPOSTA = /^[A-Za-z0-9._-]{1,40}$/;

async function candidatasDaObra(g: Guarda, l: Leitura, todas: ReadonlyMap<number, Ligacao>) {
  const desde = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const alvoNome = normalizarNome(String(g.card.cliente_nome ?? ''));
  const saida: Array<{ codigo: string; cliente: string; cidade: string; kwp: number | null; data: string; vendido: boolean }> = [];
  for (let de = 0; de < 5000 && saida.length < 8; de += 1000) {
    const { data, error } = await supabaseGerador.from('propostas')
      .select('codigo, cliente_nome, cliente_cidade, kwp, created_at, consultor_nome, tipo, vendido, tel:dados->>telefoneDigitos, tel2:dados->>telefone')
      .gte('created_at', desde).order('created_at', { ascending: false }).range(de, de + 999);
    if (error) throw new ErroHub('candidatas');
    const lote = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const r of lote) {
      const codigo = String(r.codigo ?? '');
      if (!codigo || String(r.tipo ?? 'solar').toLowerCase() === 'eletroposto') continue;
      if (!propostaDoPapel(g.nome, g.socio, String(r.consultor_nome ?? ''))) continue;
      if (quemUsa(todas, g.id, 'proposta', codigo) !== null || codigo === l.lig.proposta) continue;
      const porTel = [r.tel, r.tel2].some((t) => compararTelefones(g.card.cliente_telefone, t) !== null);
      const porNome = !!alvoNome && nomesParecidos(alvoNome, normalizarNome(String(r.cliente_nome ?? '')));
      if (!porTel && !porNome) continue;
      const kwp = Number(r.kwp);
      saida.push({
        codigo, cliente: String(r.cliente_nome ?? ''), cidade: String(r.cliente_cidade ?? ''), kwp: Number.isFinite(kwp) && kwp > 0 ? kwp : null,
        data: String(r.created_at ?? '').slice(0, 10), vendido: !!r.vendido,
      });
      if (saida.length >= 8) break;
    }
    if (lote.length < 1000) break;
  }
  return saida;
}

/**
 * Fase 2 da Jornada (06/11/2026): a etapa que a PLANILHA diz para uma venda com número e sem estado (SPEC 3.6). Planilha fora: `fora`
 * (sem trilho). Extraída da `rotaObra` para as rotas do dinheiro e das etapas 4 a 8 deduzirem do mesmo jeito.
 */
export async function etapaDaPlanilha(codigo: string): Promise<{ etapaPlanilha?: string; fora: boolean }> {
  try {
    const pl = await planilha(false);
    const o = (await comSobrescritas(pl.dados.obras)).find((x) => codigoCanonico(x.codigo) === codigoCanonico(codigo));
    return { etapaPlanilha: o ? montarObra(o, hojeBRT(new Date())).etapaAtual : undefined, fora: false };
  } catch (err) { logErro('planilha', err); return { fora: true }; }
}

async function rotaObra(req: Request, res: Response): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  try {
    const hoje = hojeDeBrasilia();
    const l = await ler(g);
    // Venda com número e sem estado: a dedução usa a linha da planilha (cache). Planilha fora = sem trilho.
    let planilhaEtapa: string | undefined; let planilhaFora = false;
    if (!l.estado && l.lig.venda) {
      const pl = await etapaDaPlanilha(l.lig.venda);
      planilhaEtapa = pl.etapaPlanilha; planilhaFora = pl.fora;
    }
    const pos = posicaoDe(l, planilhaEtapa, planilhaFora);
    const pode = podeDe(g, l, pos);
    const vend = vendedorDe(g.card, l.estado);
    const todas = pode.ligar_proposta && !l.lig.proposta ? await lerTodasLigacoes() : new Map<number, Ligacao>();
    const candidatas = pode.ligar_proposta && !l.lig.proposta ? await candidatasDaObra(g, l, todas).catch((e) => { logErro('candidatas', e); return []; }) : [];

    const nEstado = estadoDoNumero(l);
    const etapas: Array<Record<string, unknown>> = [];
    for (let n = 1; n <= 9; n++) {
      const donos = donosDaEtapa(n, vend).map((d) => ({ nome: d, iniciais: iniciais(d) }));
      if (n > 3) { etapas.push({ n, nome: NOMES_ETAPA[n], curto: CURTOS_ETAPA[n], dono: donos, fase: 2 }); continue; }
      const itens = itensDaEtapa(n, entradaDe(l, l.estado));
      const e = l.estado?.etapas[n as 1 | 2 | 3];
      const prazo = prazoDaEtapa(n, l.estado);
      const feitaDeduzida = !l.estado && pos.etapa !== null && pos.etapa > n;
      etapas.push({
        n, nome: NOMES_ETAPA[n], curto: CURTOS_ETAPA[n], dono: donos,
        aberta_em: e?.aberta_em ?? null, concluida_em: e?.concluida_em ?? (feitaDeduzida ? 'deduzida' : null),
        prazo, situacao: l.estado ? situacao(n, l.estado, hoje) : { tipo: 'sem_prazo', texto: '' },
        itens, falta: itens.filter((i) => !i.feito).length,
      });
    }
    const rat = rateioDoCadastro(l.cad);
    const bens = rat.filter((r) => r.papel === 'beneficiaria');
    const titularGeradora = rat[0]?.titular ?? '';
    const p = l.proposta;
    const equip = p ? equipamentoDaProposta({ qtd_placas: p.qtd_placas, inversor: p.inversor, qtd_inversor: p.qtd_inversor, dados: p.dados }) : null;
    const kwpDados = p ? Number((p.dados as Record<string, unknown>).kwp) : NaN;
    const kwp = Number.isFinite(kwpDados) && kwpDados > 0 ? kwpDados : (equip?.qtdPlacas && equip.potPlaca ? Math.round(equip.qtdPlacas * equip.potPlaca) / 1000 : null);
    const com = l.privado?.venda ? comissoesDaVenda(vend, l.privado.venda.valor_centavos) : null;
    const cadValor = (k: string): string => String((l.cad.campos as Record<string, { valor?: string } | undefined>)[k]?.valor ?? '').trim();
    const nomeCmp = (s: string): string => normalizarNome(s);
    res.json({
      ok: true,
      card: { id: g.id, cliente: String(g.card.cliente_nome ?? ''), cidade: String(g.card.cidade ?? ''), vendedor: vend, created_by: String(g.card.created_by ?? ''), status: String(g.card.status ?? '') },
      codigo: l.lig.venda, trilho: pos.trilho, etapa_atual: pos.etapa, hoje,
      numero: { estado: nEstado, ...(l.lig.venda ? { codigo: l.lig.venda } : {}),
        ...(nEstado === 'falhou' && pode.numero ? { motivo: l.estado?.numero.falha } : {}),
        ...(nEstado === 'confirmar' && g.adm ? { candidatos: [] } : {}) },
      cancelada: l.estado?.cancelada ? { ...l.estado.cancelada, motivo: l.privado?.cancelamento?.motivo ?? '' } : null,
      esperando: l.estado?.esperando ?? null,
      pode,
      etapas,
      venda: l.privado?.venda ?? null,
      comissoes: com?.linhas ?? [], comissoes_aviso: com?.aviso ?? null,
      proposta: p ? { codigo: p.codigo, cliente: p.cliente_nome ?? '', kwp } : null,
      propostas_candidatas: candidatas,
      documentos: {
        titular_geradora: titularGeradora, email: cadValor('email'),
        beneficiarias: bens.map((b) => ({ uc: b.uc, titular: b.titular, mesmo_titular: !!b.titular && nomeCmp(b.titular) === nomeCmp(titularGeradora) })),
      },
      rateio: { linhas: rat, total: totalDoRateio(rat), marca: marcaDoRateio(l.cad) },
      trello: { url: l.estado?.etapas[3].trello?.url ?? null, criado_em: l.estado?.etapas[3].trello?.criado_em ?? null, por: l.estado?.etapas[3].trello?.por ?? null, tem_cartao: l.tem_cartao },
      protocolo: l.estado?.etapas[3].protocolo ?? null, engenheiro: l.estado?.etapas[3].engenheiro ?? null,
      excedente: l.estado?.etapas[1].excedente ?? null,
      papeis: l.estado?.etapas[2].papeis ?? { contrato: null, procuracao: null, recibo: null },
      rateio_conferido: l.estado?.etapas[3].rateio ?? null,
      slots: Object.fromEntries(['fachada', 'padrao', 'disjuntor', 'medidor', 'conta_luz', 'documento_titular', 'documento_titular_uc', 'contrato_assinado', 'procuracao',
        'art', 'art_comprovante', 'projeto_comprovante', 'protocolo', 'parecer_acesso'].map((s) => [s === 'documento_titular' ? 'documento' : s, l.slots.has(s)])),
      cancelamento: l.privado?.cancelamento ?? null,
      aviso: pos.trilho === 'sem_trilho' ? 'Não deu para saber a etapa desta venda pelo que existe hoje.' : null,
    });
  } catch (err) {
    falhou(res, 'obra', err, true);
  }
}

// ── Rota 4 · O valor da venda ─────────────────────────────────────────────────────────────────────────────────────────

const formaDoEspelho = (formas: FormaPagamento[]): string => {
  if (formas.includes('financiamento')) return 'financiamento';
  if (formas.every((f) => f === 'cartao')) return 'cartao';
  if (formas.every((f) => f === 'boleto')) return 'boleto';
  if (formas.every((f) => f === 'pix' || f === 'ted' || f === 'dinheiro')) return 'vista';
  return 'misto';
};
const inteiroPositivo = (v: unknown, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null);

async function rotaVenda(req: Request, res: Response): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  const b = corpoDe(req);
  if (!b) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  const valor = inteiroPositivo(b.valor_centavos, 10_000_000_000);
  const linhasPg = Array.isArray(b.pagamento) ? b.pagamento : null;
  if (valor === null || !linhasPg || linhasPg.length < 1 || linhasPg.length > 6) { res.status(400).json({ ok: false, error: 'Informe o valor vendido e de 1 a 6 formas de pagamento.' }); return; }
  const pagamento: Array<{ forma: FormaPagamento; valor_centavos: number; obs: string }> = [];
  for (const p of linhasPg) {
    const po = p && typeof p === 'object' ? p as Record<string, unknown> : null;
    const v = po ? inteiroPositivo(po.valor_centavos, 10_000_000_000) : null;
    const obs = po ? (po.obs === undefined || po.obs === null || po.obs === '' ? '' : textoLimpo(po.obs, 60)) : null;
    if (!po || v === null || obs === null || !FORMAS_PAGAMENTO.includes(po.forma as FormaPagamento)) { res.status(400).json({ ok: false, error: 'Confira as formas de pagamento.' }); return; }
    pagamento.push({ forma: po.forma as FormaPagamento, valor_centavos: v, obs });
  }
  const soma = pagamento.reduce((a, p) => a + p.valor_centavos, 0);
  if (soma !== valor) { res.status(400).json({ ok: false, error: `As formas somam R$ ${reaisBR(soma)}. O valor vendido é R$ ${reaisBR(valor)}.` }); return; }
  const desconto = b.desconto_centavos === undefined || b.desconto_centavos === null ? null
    : (typeof b.desconto_centavos === 'number' && Number.isInteger(b.desconto_centavos) && b.desconto_centavos >= 0 && b.desconto_centavos <= 10_000_000_000 ? b.desconto_centavos : undefined);
  const prazo = b.prazo_prometido === undefined || b.prazo_prometido === null ? '' : textoLimpo(b.prazo_prometido, MAX_PRAZO);
  const nota = b.nota === undefined || b.nota === null ? '' : textoLimpo(b.nota, MAX_NOTA, true);
  if (desconto === undefined || prazo === null || nota === null || typeof b.kit_confirmado !== 'boolean') { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  try {
    const l = await ler(g, false);
    const pode = podeDe(g, l, posicaoDe(l));
    if (l.estado?.cancelada) { res.status(409).json({ ok: false, error: 'Venda cancelada.' }); return; }
    if (!pode.editar_venda) { res.status(403).json({ ok: false, error: 'Você não pode editar o valor desta venda agora.' }); return; }
    const agora = new Date().toISOString();
    const novo = await mudarPrivadoJornada(g.id, g.nome, (p) => {
      const ant = p.venda;
      const venda: NonNullable<PrivadoJornada['venda']> = {
        valor_centavos: valor, pagamento, desconto_centavos: desconto, prazo_prometido: prazo, nota, kit_confirmado: b.kit_confirmado as boolean,
        combinado_por: ant?.combinado_por || g.nome, combinado_em: ant?.combinado_em || agora, editado: ant?.editado ?? [],
      };
      if (ant) {
        const campos: string[] = [];
        if (ant.valor_centavos !== valor) campos.push('valor');
        if (JSON.stringify(ant.pagamento) !== JSON.stringify(pagamento)) campos.push('pagamento');
        if (ant.desconto_centavos !== desconto) campos.push('desconto');
        if (ant.prazo_prometido !== prazo) campos.push('prazo');
        if (ant.nota !== nota) campos.push('nota');
        if (ant.kit_confirmado !== b.kit_confirmado) campos.push('kit');
        if (campos.length) venda.editado = [...venda.editado, { em: agora, por: g.nome, campos }].slice(-30);
      }
      return { ...p, venda };
    });
    // O espelho na proposta ligada (Meta, Início e Histórico seguem contando). Falha vira aviso.
    let aviso: string | undefined;
    if (l.lig.proposta) {
      const { error } = await supabaseGerador.from('propostas')
        .update({ vendido: true, valor_vendido: valor / 100, forma_pagamento: formaDoEspelho(pagamento.map((p) => p.forma)) }).eq('codigo', l.lig.proposta);
      if (error) { logErro('espelho na proposta', { codigo: 'espelho' }); aviso = 'Salvei o valor, mas não consegui atualizar a proposta ligada.'; }
    }
    res.json({ ok: true, venda: novo.venda, ...(aviso ? { aviso } : {}) });
  } catch (err) {
    falhou(res, 'venda', err);
  }
}

// ── Rota 5 · Ligar a proposta ─────────────────────────────────────────────────────────────────────────────────────────

async function rotaProposta(req: Request, res: Response): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  const b = corpoDe(req);
  const codigo = b && typeof b.codigo === 'string' ? b.codigo.trim() : '';
  if (!b || !RE_CODIGO_PROPOSTA.test(codigo)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  if (!segredoDoVinculo()) { res.status(503).json({ ok: false, error: MSG_GRAVAR }); return; }
  try {
    const l = await ler(g, false);
    const pode = podeDe(g, l, posicaoDe(l));
    if (!pode.ligar_proposta) { res.status(403).json({ ok: false, error: 'Você não pode ligar a proposta desta venda agora.' }); return; }
    const p = await lerPropostaResumo(codigo);
    if (!p || !propostaDoPapel(g.nome, g.socio, p.consultor_nome)) { res.status(404).json({ ok: false, error: 'Proposta não encontrada.' }); return; }
    const { data: tipoRow } = await supabaseGerador.from('propostas').select('tipo').eq('codigo', codigo).maybeSingle();
    if (String((tipoRow as { tipo?: unknown } | null)?.tipo ?? 'solar').toLowerCase() === 'eletroposto') { res.status(404).json({ ok: false, error: 'Proposta não encontrada.' }); return; }
    const saida = await comTrava(TRAVA_VINCULOS, g.nome, async () => {
      const [{ lig }, todas] = await Promise.all([lerLigacao(g.id), lerTodasLigacoes()]);
      if (lig.proposta && lig.proposta !== codigo) {
        return { status: 409, corpo: { ok: false, error: 'Este card já tem outra proposta ligada. Desligue no quadro Documentos e cadastro.' } };
      }
      if (quemUsa(todas, g.id, 'proposta', codigo) !== null) return { status: 409, corpo: { ok: false, error: 'Esta proposta já está ligada a outra venda.' } };
      const vendidoEm = l.estado?.vendido_em ? diaDeBrasilia(l.estado.vendido_em) : hojeDeBrasilia();
      const { data: antes } = await supabaseGerador.from('propostas').select('vendido_em').eq('codigo', codigo).maybeSingle();
      const jaTem = String((antes as { vendido_em?: unknown } | null)?.vendido_em ?? '');
      const { error } = await supabaseGerador.from('propostas')
        .update({ vendido: true, vendido_por: vendedorDe(g.card, l.estado) || g.nome, ...(jaTem ? {} : { vendido_em: vendidoEm }) }).eq('codigo', codigo);
      if (error) throw new ErroHub('marcar_vendida');
      const novo: Ligacao = {
        proposta: codigo, venda: lig.venda, por: lig.venda && lig.por === POR_GERADOR ? POR_GERADOR : g.nome, em: new Date().toISOString(),
        ...(lig.trello_card ? { trello_card: lig.trello_card } : {}),
      };
      await gravarLigacao(g.id, novo);
      invalidarCachesHub();
      return { status: 200, corpo: { ok: true, proposta: codigo } };
    });
    res.status(saida.status).json(saida.corpo);
  } catch (err) {
    falhou(res, 'proposta', err);
  }
}

// ── Rota 6 · Excedente, engenheiro, protocolo e rateio ───────────────────────────────────────────────────────────────

async function rotaPatch(req: Request, res: Response): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  const b = corpoDe(req);
  const chaves = b ? Object.keys(b) : [];
  const validas = ['excedente', 'engenheiro', 'protocolo', 'rateio_conferido'];
  if (!b || chaves.length === 0 || chaves.some((k) => !validas.includes(k))) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  if ((b.excedente !== undefined && b.excedente !== 'sim' && b.excedente !== 'nao')
    || (b.engenheiro !== undefined && b.engenheiro !== 'pago' && b.engenheiro !== 'a_pagar')
    || (b.rateio_conferido !== undefined && b.rateio_conferido !== true)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  let protocolo: { numero: string; em: string } | null | undefined;
  if (b.protocolo !== undefined) {
    if (b.protocolo === null) protocolo = null;
    else {
      const po = typeof b.protocolo === 'object' && !Array.isArray(b.protocolo) ? b.protocolo as Record<string, unknown> : null;
      const numero = po && typeof po.numero === 'string' ? po.numero.trim() : '';
      const em = po && typeof po.em === 'string' ? po.em : '';
      if (!/^[A-Za-z0-9./-]{1,40}$/.test(numero) || !/^\d{4}-\d{2}-\d{2}$/.test(em) || Number.isNaN(Date.parse(`${em}T12:00:00Z`))) {
        res.status(400).json({ ok: false, error: 'Confira o número e a data do protocolo.' });
        return;
      }
      protocolo = { numero, em };
    }
  }
  try {
    const l = await ler(g, false);
    const pos = posicaoDe(l);
    const pode = podeDe(g, l, pos);
    if (l.estado?.cancelada) { res.status(409).json({ ok: false, error: 'Venda cancelada.' }); return; }
    if ((b.excedente !== undefined && !pode.marcar_excedente)
      || ((b.engenheiro !== undefined || protocolo !== undefined || b.rateio_conferido !== undefined) && !pode.etapa3)) {
      res.status(403).json({ ok: false, error: 'Você não pode mudar isto agora.' });
      return;
    }
    if (b.rateio_conferido !== undefined) {
      const total = totalDoRateio(rateioDoCadastro(l.cad));
      if (total !== 100) { res.status(409).json({ ok: false, error: `O rateio soma ${String(total).replace('.', ',')}%. Ajuste para 100% antes de conferir.` }); return; }
    }
    const hoje = hojeDeBrasilia();
    const marca = marcaDoRateio(l.cad);
    const r = await mudarJornada(g.id, baseDe(g, l), (e) => {
      const agora = new Date().toISOString();
      let n: EstadoJornada = e;
      const nota = (acao: 'excedente' | 'engenheiro' | 'protocolo' | 'rateio', etapa: number): void => {
        n = { ...n, historico: [...n.historico, { em: agora, por: g.nome, acao, etapa }].slice(-50) };
      };
      if (b.excedente !== undefined) { n = { ...n, etapas: { ...n.etapas, 1: { ...n.etapas[1], excedente: b.excedente as 'sim' | 'nao' } } }; nota('excedente', 1); }
      if (b.engenheiro !== undefined) { n = { ...n, etapas: { ...n.etapas, 3: { ...n.etapas[3], engenheiro: b.engenheiro as 'pago' | 'a_pagar' } } }; nota('engenheiro', 3); }
      if (protocolo !== undefined) {
        const abertura = n.etapas[3].aberta_em ? diaDeBrasilia(n.etapas[3].aberta_em) : '';
        if (protocolo && ((abertura && protocolo.em < abertura) || protocolo.em > hoje)) {
          return { recusa: 'A data do protocolo fica entre a abertura da etapa e hoje.', http: 400 } as Recusa;
        }
        n = { ...n, etapas: { ...n.etapas, 3: { ...n.etapas[3], protocolo } } }; nota('protocolo', 3);
      }
      if (b.rateio_conferido !== undefined) {
        n = { ...n, etapas: { ...n.etapas, 3: { ...n.etapas[3], rateio: { conferido_em: agora, por: g.nome, marca } } } }; nota('rateio', 3);
      }
      return n;
    });
    if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
    res.json({ ok: true });
  } catch (err) {
    falhou(res, 'patch', err);
  }
}

// ── Rota 7 · Concluir a etapa ─────────────────────────────────────────────────────────────────────────────────────────

async function rotaEtapa(req: Request, res: Response): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  const b = corpoDe(req);
  const n = b ? b.etapa : undefined;
  if (!b || (n !== 1 && n !== 2 && n !== 3)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  try {
    const l = await ler(g, false);
    const vend = vendedorDe(g.card, l.estado);
    if (l.estado?.cancelada) { res.status(409).json({ ok: false, error: 'Venda cancelada.' }); return; }
    if (!podeConcluir(g.nome, n, vend)) { res.status(403).json({ ok: false, error: 'Só o dono conclui a etapa.' }); return; }
    const r = await mudarJornada(g.id, baseDe(g, l), (e) => {
      if (e.cancelada) return { recusa: 'Venda cancelada.', http: 409 } as Recusa;
      if (etapaAtualDoEstado(e) !== n) return { recusa: 'Esta etapa não é a da vez.', http: 409 } as Recusa;
      const itens = itensDaEtapa(n, entradaDe(l, e));
      const falta = itens.filter((i) => !i.feito);
      if (falta.length) {
        return {
          recusa: `Falta ${falta.length} ${falta.length === 1 ? 'item' : 'itens'}: ${falta.map((i) => i.texto).join(', ')}.`, http: 409,
          extra: { precisa: 'itens', falta: falta.map((i) => ({ chave: i.chave, texto: i.texto })) },
        } as Recusa;
      }
      const agora = new Date().toISOString();
      const fecha = { concluida_em: agora, concluida_por: g.nome };
      const etapas = { ...e.etapas } as EstadoJornada['etapas'];
      if (n === 1) { etapas[1] = { ...e.etapas[1], ...fecha }; etapas[2] = { ...e.etapas[2], aberta_em: e.etapas[2].aberta_em ?? agora }; }
      if (n === 2) { etapas[2] = { ...e.etapas[2], ...fecha }; etapas[3] = { ...e.etapas[3], aberta_em: e.etapas[3].aberta_em ?? agora }; }
      if (n === 3) { etapas[3] = { ...e.etapas[3], ...fecha }; etapas[4] = { aberta_em: e.etapas[4].aberta_em ?? agora }; }
      return {
        ...e, etapas, esperando: e.esperando && e.esperando.etapa === n ? null : e.esperando,
        historico: [...e.historico, { em: agora, por: g.nome, acao: 'concluir' as const, etapa: n }].slice(-50),
      };
    });
    if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa, ...(r.extra ?? {}) }); return; }
    // Etapa 2 concluída sem número: tenta o número depois de gravar (a etapa conclui de qualquer jeito, SPEC 13).
    let numero: Record<string, unknown> | undefined;
    if (n === 2 && !l.lig.venda) {
      try {
        const rn = await tentarNumeroDaJornada(g.card, { nome: g.nome, socio: g.socio }, Date.now(), {});
        numero = rn.ok ? { ok: true, codigo: rn.codigo } : { ok: false, motivo: rn.motivo };
      } catch (err) { logErro('número ao concluir', err); numero = { ok: false, motivo: 'banco' }; }
    }
    res.json({ ok: true, etapa_atual: etapaAtualDoEstado(r), ...(numero ? { numero } : {}) });
  } catch (err) {
    falhou(res, 'etapa', err);
  }
}

// ── Rota 8 · Esperando ──────────────────────────────────────────────────────────────────────────────────────────────────

async function rotaEsperar(req: Request, res: Response): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  const b = corpoDe(req);
  if (!b) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  const voltar = b.voltar === true;
  const motivo = b.motivo as MotivoEspera;
  const ate = typeof b.ate === 'string' ? b.ate : '';
  if (!voltar && (!MOTIVOS_ESPERA.includes(motivo) || !/^\d{4}-\d{2}-\d{2}$/.test(ate))) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  try {
    const l = await ler(g, false);
    const pos = posicaoDe(l);
    const pode = podeDe(g, l, pos);
    if (l.estado?.cancelada) { res.status(409).json({ ok: false, error: 'Venda cancelada.' }); return; }
    if (!pode.esperar) { res.status(403).json({ ok: false, error: 'Você não pode pôr esta obra em espera agora.' }); return; }
    const hoje = hojeDeBrasilia();
    if (!voltar) {
      let teto = somarDiasUteis(hoje, 5);
      const prot = l.estado?.etapas[3].protocolo;
      if (motivo === 'cemig' && pos.etapa === 3 && prot) {
        const cemig = prazoDaEtapa(3, l.estado).vence;
        if (cemig && cemig > teto) teto = cemig;
      }
      if (ate <= hoje || ate > teto) { res.status(400).json({ ok: false, error: `A espera vai até 5 dias úteis. Escolha até ${ddmm(teto)}.` }); return; }
    }
    const r = await mudarJornada(g.id, baseDe(g, l), (e) => {
      const agora = new Date().toISOString();
      const etapa = etapaAtualDoEstado(e);
      if (etapa < 1 || etapa > 3) return { recusa: 'Esta etapa não aceita espera.', http: 409 } as Recusa;
      return {
        ...e, esperando: voltar ? null : { motivo, ate, etapa: etapa as 1 | 2 | 3, em: agora, por: g.nome },
        historico: [...e.historico, { em: agora, por: g.nome, acao: voltar ? 'voltar' as const : 'esperar' as const, etapa }].slice(-50),
      };
    });
    if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
    res.json({ ok: true, texto: voltar ? null : `Esperando até ${ddmm(ate)} · ${ROTULO_ESPERA[motivo]}` });
  } catch (err) {
    falhou(res, 'esperar', err);
  }
}

// ── Rota 9 · Cancelar e desfazer ───────────────────────────────────────────────────────────────────────────────────────

async function rotaCancelar(req: Request, res: Response, desfazer: boolean): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  const b = corpoDe(req);
  const motivo = b ? textoLimpo(b.motivo, 300) : null;
  if (!b || !motivo || motivo.length < 3) { res.status(400).json({ ok: false, error: 'Diga o motivo do cancelamento.' }); return; }
  try {
    const l = await ler(g, false);
    const pode = podeDe(g, l, posicaoDe(l));
    if (desfazer ? !pode.descancelar : !pode.cancelar) { res.status(403).json({ ok: false, error: desfazer ? 'Só o administrador desfaz o cancelamento.' : 'Você não pode cancelar esta venda.' }); return; }
    const agora = new Date().toISOString();
    // 1. O motivo no JSON privado. 2. O estado.
    await mudarPrivadoJornada(g.id, g.nome, (p) => (desfazer
      ? { ...p, descancelamentos: [...p.descancelamentos, { motivo, em: agora, por: g.nome }].slice(-10) }
      : { ...p, cancelamento: { motivo, em: agora, por: g.nome } }));
    const pos = posicaoDe(l);
    const r = await mudarJornada(g.id, baseDe(g, l), (e) => {
      if (desfazer) {
        return { ...e, cancelada: null, historico: [...e.historico, { em: agora, por: g.nome, acao: 'descancelar' as const, etapa: null }].slice(-50) };
      }
      return {
        ...e, cancelada: { em: agora, por: g.nome, etapa: Math.min(Math.max(pos.etapa ?? etapaAtualDoEstado(e), 1), 9), com_numero: !!l.lig.venda },
        historico: [...e.historico, { em: agora, por: g.nome, acao: 'cancelar' as const, etapa: Math.min(Math.max(pos.etapa ?? etapaAtualDoEstado(e), 1), 9) }].slice(-50),
      };
    });
    if (ehRecusa(r)) { res.status(r.http).json({ ok: false, error: r.recusa }); return; }
    res.json({ ok: true });
  } catch (err) {
    falhou(res, desfazer ? 'descancelar' : 'cancelar', err);
  }
}

// ── Rota 10 · Os papéis da SolarDoc ───────────────────────────────────────────────────────────────────────────────────

const CAMPOS_EMPRESA = [
  'endereco', 'cidade', 'uf', 'telefone', 'socio_adm', 'engenheiro_nome', 'engenheiro_cpf', 'engenheiro_crea', 'engenheiro_rg', 'engenheiro_nacionalidade',
  'engenheiro_estado_civil', 'engenheiro_profissao', 'engenheiro_endereco', 'tecnico_nome', 'tecnico_cpf', 'tecnico_rg', 'tecnico_crt_cft',
  'tecnico_nacionalidade', 'tecnico_estado_civil', 'tecnico_endereco', 'pix', 'conta',
] as const;
const ROTULO_FORMA: Record<FormaPagamento, string> = { pix: 'Pix', ted: 'TED', boleto: 'Boleto', cartao: 'Cartão', financiamento: 'Financiamento', dinheiro: 'Dinheiro' };

async function rotaPapel(req: Request, res: Response): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  const b = corpoDe(req);
  const tipo = b ? b.tipo as TipoPapel : undefined;
  if (!b || !TIPOS_PAPEL.includes(tipo as TipoPapel)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  const modelo = b.modelo === undefined ? 1 : b.modelo;
  if (modelo !== 1 && modelo !== 2 && modelo !== 3) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  const empresaIn = b.empresa && typeof b.empresa === 'object' && !Array.isArray(b.empresa) ? b.empresa as Record<string, unknown> : {};
  const empresa: Record<string, string> = {};
  for (const k of CAMPOS_EMPRESA) {
    if (empresaIn[k] === undefined) continue;
    const t = textoLimpo(empresaIn[k], 160);
    if (t === null) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    empresa[k] = t;
  }
  // O recibo: número e de 1 a 6 pagamentos.
  const recibo = b.recibo && typeof b.recibo === 'object' && !Array.isArray(b.recibo) ? b.recibo as Record<string, unknown> : null;
  const pagamentos: Array<{ forma: string; data: string; valor: string }> = [];
  let numeroRecibo = '';
  if (tipo === 'recibo') {
    const pgs = recibo && Array.isArray(recibo.pagamentos) ? recibo.pagamentos : [];
    if (pgs.length < 1 || pgs.length > 6) { res.status(409).json({ ok: false, precisa: 'cadastro', faltam: ['pagamento'], error: 'Falta no cadastro: um pagamento.' }); return; }
    for (const p of pgs) {
      const po = p && typeof p === 'object' ? p as Record<string, unknown> : null;
      const v = po ? inteiroPositivo(po.valor_centavos, 10_000_000_000) : null;
      const data = po && typeof po.data === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(po.data) ? po.data : null;
      if (!po || v === null || !data || !FORMAS_PAGAMENTO.includes(po.forma as FormaPagamento)) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
      pagamentos.push({ forma: ROTULO_FORMA[po.forma as FormaPagamento], data: dataBR(data), valor: reaisBR(v) });
    }
    const nr = recibo && recibo.numero !== undefined ? textoLimpo(recibo.numero, 40) : '';
    if (nr === null) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
    numeroRecibo = nr;
  }
  try {
    const l = await ler(g);
    const pos = posicaoDe(l);
    if (l.estado?.cancelada) { res.status(409).json({ ok: false, error: 'Venda cancelada.' }); return; }
    if (!podeDe(g, l, pos).gerar_papeis) { res.status(403).json({ ok: false, error: 'Você não pode gerar os papéis desta venda agora.' }); return; }
    const v = (k: string): string => String((l.cad.campos as Record<string, { valor?: string } | undefined>)[k]?.valor ?? '').trim();
    const outra = v('homologacao_mesmo') === 'outra_pessoa';
    const cliente = {
      nome: v('nome'), cpf_cnpj: v('cpf_cnpj'), tipo: tipoDoCadastro(l.cad), endereco: v('endereco'), bairro: v('bairro'), cidade: v('cidade'), uf: v('uf'), cep: v('cep'),
      nacionalidade: v('nacionalidade'), representante_nome: v('rep_nome'), representante_cpf: v('rep_cpf'), email: v('email'), telefone: v('telefone'),
    };
    const outorgante = outra
      ? { ...cliente, nome: v('tuc_nome'), cpf_cnpj: v('tuc_cpf_cnpj'), endereco: v('tuc_endereco'), bairro: v('tuc_bairro'), cidade: v('tuc_cidade'), uf: v('tuc_uf'), cep: v('tuc_cep'), nacionalidade: v('tuc_nacionalidade') }
      : cliente;
    const venda = l.privado?.venda ?? null;
    const faltam: string[] = [];
    if (tipo === 'contrato') {
      if (!cliente.nome) faltam.push('nome do contratante');
      if (!cliente.cpf_cnpj) faltam.push('CPF ou CNPJ do contratante');
      if (!cliente.endereco) faltam.push('endereço do contratante');
      if (!venda || !(venda.valor_centavos > 0)) faltam.push('valor vendido');
    } else if (tipo === 'procuracao') {
      if (!outorgante.nome) faltam.push('nome do outorgante');
      if (!outorgante.cpf_cnpj) faltam.push('CPF ou CNPJ do outorgante');
      if (!v('unidade_consumidora')) faltam.push('unidade consumidora');
    } else {
      if (!cliente.nome) faltam.push('nome do contratante');
      if (!cliente.cpf_cnpj) faltam.push('CPF ou CNPJ do contratante');
    }
    if (faltam.length) { res.status(409).json({ ok: false, precisa: 'cadastro', faltam, error: `Falta no cadastro: ${faltam.join(', ')}.` }); return; }

    // O emitente é SEMPRE a AIOROS LTDA: o corpo do pedido só traz engenheiro, técnicos, endereço, telefone, Pix e conta.
    const emitente: Parameters<typeof generateFromTemplate>[1] = {
      ...empresa, nome: 'AIOROS LTDA', cnpj: '63.636.043/0001-88', nome_fantasia: 'AIOROS GROUP LTDA', cidade: empresa.cidade || 'Uberlândia', uf: empresa.uf || 'MG',
    };
    const prop = l.proposta;
    const equip = prop ? equipamentoDaProposta({ qtd_placas: prop.qtd_placas, inversor: prop.inversor, qtd_inversor: prop.qtd_inversor, dados: prop.dados }) : null;
    const dados = (prop?.dados ?? {}) as Record<string, unknown>;
    const ano = new Date().getFullYear();
    let texto: string;
    if (tipo === 'contrato') {
      const kwp = equip?.qtdPlacas && equip.potPlaca ? equip.qtdPlacas * equip.potPlaca / 1000 : null;
      const gen = Number(dados.mediaMensalGerada);
      const cond = (venda?.pagamento ?? []).map((p) => `${ROTULO_FORMA[p.forma]} de R$ ${reaisBR(p.valor_centavos)}${p.obs ? ` (${p.obs})` : ''}`).join('; ');
      texto = generateFromTemplate('contratoSolar', emitente, cliente, {
        potencia_kwp: kwp ? String(Math.round(kwp * 100) / 100).replace('.', ',') : '',
        quantidade_modulos: equip?.qtdPlacas ? String(equip.qtdPlacas) : '', marca_modulos: equip?.modeloPlaca ?? '',
        quantidade_inversores: equip?.qtdInversor ? String(equip.qtdInversor) : '', marca_inversor: equip?.inversor ?? '',
        valor_total: reaisBR(venda?.valor_centavos ?? 0), condicoes_pagamento: cond ? `${cond}.` : '',
        prazo_projeto_dias: '5', prazo_aprovacao_dias: '40', prazo_instalacao_dias: String(dados.prazoInstalacao ?? '10'),
        garantia_modulos_anos: String(dados.garPaineis ?? '25'), garantia_inversor_anos: String(dados.garInv ?? '10'),
        garantia_instalacao_anos: String(dados.garInstalacao ?? '1'), garantia_instalacao_unidade: 'anos',
        geracao_media_kwh: Number.isFinite(gen) && gen > 0 ? String(Math.round(gen)) : '',
        foro_cidade: 'Uberlândia', endereco_instalacao: v('endereco_ponto'), versao_garantia: 2, garantia_resposta_dias: '2',
      }, 2);
    } else if (tipo === 'procuracao') {
      texto = generateFromTemplate('procuracao', emitente, outorgante, {
        uc: v('unidade_consumidora'), concessionaria: v('concessionaria') || 'CEMIG', foro_cidade: 'Uberlândia',
      }, modelo as 1 | 2 | 3);
    } else {
      const dataContrato = l.estado?.etapas[2].papeis.contrato?.gerado_em ? dataBR(l.estado.etapas[2].papeis.contrato.gerado_em) : '';
      const kwp = equip?.qtdPlacas && equip.potPlaca ? equip.qtdPlacas * equip.potPlaca / 1000 : null;
      texto = generateFromTemplate('recibo', emitente, cliente, {
        numero: numeroRecibo || (l.lig.venda ? `${l.lig.venda.replace('#', '')}/${ano}` : `S/N/${ano}`),
        data_contrato: dataContrato, valor_contrato: reaisBR(venda?.valor_centavos ?? 0),
        descricao_servico: `instalação de usina fotovoltaica${kwp ? ` de ${String(Math.round(kwp * 100) / 100).replace('.', ',')} kWp` : ''}`,
        endereco_instalacao: v('endereco_ponto'), foro_cidade: 'Uberlândia', pagamentos, chave_pix: empresa.pix ?? '', conta: empresa.conta ?? '',
      }, 1);
    }
    const html = texto.startsWith('[[HTML]]');
    const conteudo = html ? limparHtmlPapel(texto.slice('[[HTML]]'.length)) : texto;
    const agora = new Date().toISOString();
    let aviso: string | undefined;
    try {
      const r = await mudarJornada(g.id, baseDe(g, l), (e) => {
        if (e.cancelada) return { recusa: 'Venda cancelada.', http: 409 } as Recusa;
        const papeis = { ...e.etapas[2].papeis, [tipo as TipoPapel]: { gerado_em: agora, por: g.nome } };
        return {
          ...e, etapas: { ...e.etapas, 2: { ...e.etapas[2], papeis } },
          historico: [...e.historico, { em: agora, por: g.nome, acao: `papel_${tipo}` as 'papel_contrato', etapa: 2 }].slice(-50),
        };
      });
      if (ehRecusa(r)) aviso = 'Gerei o papel, mas a obra mudou e não anotei a data.';
    } catch (err) { logErro('anotar o papel', err); aviso = 'Gerei o papel, mas não consegui anotar a data.'; }
    const titulos: Record<TipoPapel, string> = { contrato: 'Contrato', procuracao: 'Procuração', recibo: 'Recibo' };
    res.json({
      ok: true, tipo, formato: html ? 'html' : 'texto', conteudo, titulo: `${titulos[tipo as TipoPapel]} · ${cliente.nome}`, gerado_em: agora,
      ...(aviso ? { aviso } : {}),
    });
  } catch (err) {
    falhou(res, 'papel', err);
  }
}

// ── Rota 11 · Tentar o número de novo ─────────────────────────────────────────────────────────────────────────────────

async function rotaNumero(req: Request, res: Response): Promise<void> {
  const g = await guardaObra(req, res);
  if (!g) return;
  const b = corpoDe(req);
  if (!b || (b.novo !== undefined && typeof b.novo !== 'boolean')) { res.status(400).json({ ok: false, error: MSG_PEDIDO }); return; }
  try {
    const l = await ler(g, false);
    const pode = podeDe(g, l, posicaoDe(l));
    if (l.lig.venda) { res.json({ ok: true, codigo: l.lig.venda }); return; }
    if (!pode.numero) { res.status(403).json({ ok: false, error: 'Você não pode pedir o número desta obra agora.' }); return; }
    if (b.novo === true && !g.adm) { res.status(403).json({ ok: false, error: 'Só o administrador cria o número novo.' }); return; }
    const r = await tentarNumeroDaJornada(g.card, { nome: g.nome, socio: g.socio }, Date.now(), { novo: b.novo === true });
    if (r.ok) { res.json({ ok: true, codigo: r.codigo }); return; }
    if (responderNumero409(res, r, g.adm)) return;
    responderErroDoAlocador(res, r.motivo as Parameters<typeof responderErroDoAlocador>[1]);
  } catch (err) {
    falhou(res, 'numero', err);
  }
}

// ── A montagem ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function mountJornadaSolar(router: Router): void {
  // Montado AQUI DENTRO (não no topo do módulo): em CommonJS, uma importação em ciclo ainda é `undefined` no topo e derrubaria o boot.
  const base = [exigeConsultor, semCache];
  router.post('/vendas-solares/:card/vendido', ...base, rotaVendido);
  router.get('/jornada-solar/lista', ...base, rotaLista);
  router.get('/jornada-solar/obra/:card', ...base, rotaObra);
  router.put('/jornada-solar/obra/:card/venda', ...base, rotaVenda);
  router.post('/jornada-solar/obra/:card/proposta', ...base, rotaProposta);
  router.patch('/jornada-solar/obra/:card', ...base, rotaPatch);
  router.post('/jornada-solar/obra/:card/etapa', ...base, rotaEtapa);
  router.post('/jornada-solar/obra/:card/esperar', ...base, rotaEsperar);
  router.post('/jornada-solar/obra/:card/cancelar', ...base, (req, res) => rotaCancelar(req, res, false));
  router.post('/jornada-solar/obra/:card/descancelar', ...base, (req, res) => rotaCancelar(req, res, true));
  router.post('/jornada-solar/obra/:card/papel', ...base, rotaPapel);
  router.post('/jornada-solar/obra/:card/numero', ...base, rotaNumero);
}
