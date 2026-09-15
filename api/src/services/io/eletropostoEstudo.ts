// ─────────────────────────────────────────────────────────────────────────────
// ESTUDO DO LOCAL, o tick. Roda a cada 5 min pelo GitHub Actions.
//
// Pedido do Thiago (15/09/2026): "chegar na agenda quem apenas tem um endereço e
// criar um mecanismo que já acha esse terreno e traga um estudo de mercado antes
// do nosso atendimento, com um relatório bem organizado e os links".
//
// ── Caminho de uma reunião ──
//   1. A LP grava a reunião e chama o /alerta. O /alerta cria a linha do estudo e
//      o card NOVA REUNIÃO já sai com o link (garantirEstudo, 2 s no máximo).
//   2. Este tick acha o terreno no Google, o entorno, os carregadores, a rua, o
//      município (IBGE e SENATRAN), calcula as notas e pede o texto à IA.
//   3. Estudo pronto: um aviso só, para o DONO da reunião, e uma linha no
//      histórico da ficha no CRM.
//   4. 30 dias depois, as coordenadas saem do registro.
//
// ── O que ele NUNCA faz ──
//   • Não fala com o lead. Nenhuma mensagem sai para cliente_telefone.
//   • Não muda status, nota, horário nem dono da reunião.
//   • Não corta ninguém da agenda. O estudo informa.
//
// ── Kill-switches (env da Vercel, projeto da api) ──
//   EP_ESTUDO_OFF=1            nada roda e o card sai sem link
//   EP_ESTUDO_AVISO_OFF=1      não avisa o dono
//   EP_ESTUDO_HISTORICO_OFF=1  não escreve no histórico da ficha
//   EP_ESTUDO_IMG_OFF=1        a página não mostra rua nem satélite
//   EP_ESTUDO_MAX_DIA          teto de estudos por dia (padrão 40, uns US$ 5)
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../utils/logger';
import { supabaseGerador, geradorComServiceKey } from '../../utils/supabaseGerador';
import { contaDeReferencia } from '../../utils/computeEletro';
import { sendWhatsApp } from '../agents/zapiClient';
import { EQUIPE } from '../../routes/ioEletroposto';
import { carregarConsultores } from './eletropostoAgenda';
import { resolverCidade } from './geoCidade';
import * as banco from './eletropostoEstudoBanco';
import * as fontes from './eletropostoEstudoFontes';
import { avaliarPortao } from './eletropostoPortao';
import { ESTUDO_NO_AR_EM, estudoDesligado, garantirEstudo } from './eletropostoEstudoGarantir';
import {
  TIPOS_ENTORNO, categoriaDoLugar, confiancaGeo, ehRodovia, extrairEndereco, extrairFicha,
  linkPedirLocalizacao, montarFatosIA, notaDoLocal, preNota, primeiroNome, quandoPorExtenso,
  resumirLugares, rotuloSituacao, rumoGraus, sinaisDeAtencao, situacao, textoDeBusca,
  textoPedirLocalizacao, urlDoEstudo,
  type Confianca, type DadosEstudo, type LugarGoogle, type MunicipioEstudo, type Situacao,
} from './eletropostoEstudoPuro';

export const POR_TICK = 2;
export const TICK_MAX_MS = 90_000;
const MIN_RESTANTE_MS = 50_000;
export const AVISO_POR_TICK = 5;
const LEASE_SEG = 240;
const MAX_TENTATIVAS = 3;
const REDE_JANELA_MS = 72 * 3600_000;
const REDE_MAX = 50;
const AVISO_ANTES_MIN = 15;

const avisoDesligado = () => (process.env.EP_ESTUDO_AVISO_OFF || '').trim() === '1';
const historicoDesligado = () => (process.env.EP_ESTUDO_HISTORICO_OFF || '').trim() === '1';
const maxPorDia = () => {
  const n = Number(process.env.EP_ESTUDO_MAX_DIA);
  return Number.isFinite(n) && n > 0 ? n : 40;
};

export interface Reuniao {
  id: number;
  quando: string | null;
  status: string;
  vendedor_nome: string | null;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  cidade: string | null;
  observacao: string | null;
  created_at: string;
  created_by: string | null;
}

const COLUNAS_REUNIAO = 'id, quando, status, vendedor_nome, cliente_nome, cliente_telefone, cidade, observacao, created_at, created_by';

async function carregarReunioes(ids: number[]): Promise<Map<number, Reuniao>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabaseGerador.from('agendamentos').select(COLUNAS_REUNIAO).in('id', ids);
  if (error) throw new Error(`agendamentos: ${error.message}`);
  return new Map(((data || []) as Reuniao[]).map(r => [Number(r.id), r]));
}

/** Reuniões da LP, de pé, no futuro, com endereço. */
async function candidatas(agoraMs: number, desdeIso: string | null): Promise<Array<{ id: number; observacao: string | null }>> {
  let q = supabaseGerador.from('agendamentos').select('id, observacao, created_at')
    .eq('created_by', 'lp_eletroposto')
    .eq('status', 'agendado')
    .gt('quando', new Date(agoraMs).toISOString())
    .ilike('observacao', '%Endereço:%');
  if (desdeIso) q = q.gte('created_at', desdeIso);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) throw new Error(`candidatas: ${error.message}`);
  return ((data || []) as Array<{ id: number; observacao: string | null }>).map(r => ({ id: Number(r.id), observacao: r.observacao }));
}

// ── o estudo de uma reunião ────────────────────────────────────────────────

export interface EstudoMontado {
  status: 'pronto' | 'parcial' | 'sem_endereco';
  dados: DadosEstudo;
  fontes: Record<string, string>;
  custo_usd: number;
  confianca: Confianca | null;
  pre_nota: number;
  indice: number | null;
  situacao: Situacao;
  municipio_ibge: number | null;
}

/**
 * O Google recusou a chave (sem chave, 401 ou 403). A culpa não é da ficha: a linha
 * volta para a fila sem gastar tentativa, e o estudo sai sozinho no primeiro tick
 * depois que a chave voltar a funcionar. Sem redeploy.
 */
export class GoogleFora extends Error {
  constructor(public status: string, public motivo?: string) {
    super(`google_fora ${status}`);
  }
}

const googleRecusou = (s: string) => s === 'sem_chave' || s === 'erro:401' || s === 'erro:403';

const pulado = <T>(): Promise<fontes.Resultado<T>> =>
  Promise.resolve({ ok: false, dado: null, status: 'pulado', http: null, ms: 0, custo_usd: 0 });

const soNumero = (s: string | undefined | null) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

/** O resultado que tem o número digitado ganha; sem ele, o primeiro do Google. */
function escolherLugar(lugares: LugarGoogle[], numero: string): LugarGoogle | null {
  const n = soNumero(numero);
  const comNumero = n
    ? lugares.find(l => (l.addressComponents || []).some(c => c.types?.includes('street_number') && soNumero(c.longText) === n))
    : undefined;
  return comNumero || lugares[0] || null;
}

/** Fonte que falhou de verdade. Sem resultado, pulada ou reaproveitada não é falha. */
const FALHA_QUE_DEIXA_PARCIAL = ['searchText', 'nearby_entorno', 'nearby_recarga', 'ibgePop', 'ibgePib'];
const falhou = (s: string | undefined) => !!s && !['ok', 'zero_resultados', 'pulado', 'reaproveitado'].includes(s);

export async function montarEstudo(r: Reuniao): Promise<EstudoMontado> {
  const obs = r.observacao || '';
  const ficha = extrairFicha(obs);
  const endereco = extrairEndereco(obs);
  const pre = preNota(ficha);
  const portao = avaliarPortao(ficha);

  if (!endereco) {
    const sinais = sinaisDeAtencao({ ficha, endereco: null, confianca: null });
    const sit = situacao(sinais, null);
    return {
      status: 'sem_endereco',
      dados: { ficha, endereco_digitado: null, pre_nota: pre, sinais, situacao: sit, portao },
      fontes: {}, custo_usd: 0, confianca: null, pre_nota: pre.valor, indice: null, situacao: sit, municipio_ibge: null,
    };
  }

  const st: Record<string, string> = {};

  // Município: a cidade escrita no endereço primeiro, a do cadastro como reserva.
  let cid = resolverCidade(endereco.cidade);
  if (cid.status !== 'ok' && r.cidade) cid = resolverCidade(r.cidade);
  const mun = cid.status === 'ok' && cid.ibge && cid.lat != null && cid.lng != null
    ? { ibge: cid.ibge, nome: cid.municipio as string, uf: cid.uf as string, lat: cid.lat, lng: cid.lng }
    : null;

  const [local, reuso, hist] = await Promise.all([
    fontes.buscarLocal(textoDeBusca(endereco, mun ? { municipio: mun.nome, uf: mun.uf } : null), mun),
    mun ? banco.listar('ibge', { ids: [mun.ibge], limite: 1 }).catch(() => []) : Promise.resolve([]),
    fontes.historicoDoEndereco({ endereco, telefone: r.cliente_telefone, excluirId: r.id }),
  ]);
  if (googleRecusou(local.status)) throw new GoogleFora(local.status, local.motivo);
  st.searchText = local.status;
  st.historico = hist.status;

  const lugar = escolherLugar(local.dado || [], endereco.numero);
  const confianca: Confianca | null = local.ok
    ? confiancaGeo(lugar, endereco.numero, mun ? { nome: mun.nome, lat: mun.lat, lng: mun.lng } : null)
    : null;
  const centro = lugar?.location ? { lat: lugar.location.latitude, lng: lugar.location.longitude } : null;

  // IBGE muda uma vez por ano: estudo do mesmo município com menos de 30 dias serve.
  const anterior = reuso[0]?.dados?.municipio;
  const reaproveita = !!anterior && anterior.pop_2026 != null && anterior.pib_pc_2023 != null;

  const [entorno, recarga, sv, prova, pop, pib] = await Promise.all([
    centro ? fontes.buscarProximos(centro, TIPOS_ENTORNO, 1000) : pulado<LugarGoogle[]>(),
    centro ? fontes.buscarProximos(centro, ['electric_vehicle_charging_station'], 5000) : pulado<LugarGoogle[]>(),
    centro ? fontes.streetViewMeta(centro) : pulado<fontes.PanoramaRua>(),
    centro ? fontes.provarStaticMap(centro) : pulado<boolean>(),
    mun && !reaproveita ? fontes.ibgePopulacao(mun.ibge) : pulado<fontes.ValorAno>(),
    mun && !reaproveita ? fontes.ibgePibPerCapita(mun.ibge) : pulado<fontes.ValorAno>(),
  ]);
  st.nearby_entorno = entorno.status;
  st.nearby_recarga = recarga.status;
  st.svMeta = sv.status;
  st.staticmap = prova.status;
  st.ibgePop = reaproveita ? 'reaproveitado' : pop.status;
  st.ibgePib = reaproveita ? 'reaproveitado' : pib.status;

  const entornoRes = centro && entorno.ok ? resumirLugares(entorno.dado || [], centro, 1000) : null;
  const recargaRes = centro && recarga.ok ? resumirLugares(recarga.dado || [], centro, 5000, 'Carregador') : null;

  // O que o Google mostra no endereço: o próprio resultado, quando é estabelecimento,
  // ou um vizinho do entorno a até 30 m do pino.
  let estabelecimento: { nome: string; tipo: string; status: string } | null = null;
  if (lugar && centro) {
    const ativo = !lugar.businessStatus || lugar.businessStatus === 'OPERATIONAL';
    if ((lugar.types || []).includes('establishment') && ativo && lugar.displayName?.text) {
      estabelecimento = { nome: lugar.displayName.text, tipo: categoriaDoLugar(lugar)?.rotulo || 'Estabelecimento', status: lugar.businessStatus || 'OPERATIONAL' };
    } else {
      const vizinho = entornoRes?.lista.find(i => i.dist_m <= 30);
      if (vizinho) estabelecimento = { nome: vizinho.nome, tipo: vizinho.rotulo, status: 'OPERATIONAL' };
    }
  }

  const frota = mun ? fontes.frotaDoMunicipio(mun.ibge, mun.uf) : null;
  st.frota = frota ? 'ok' : 'pulado';
  const municipio: MunicipioEstudo | null = mun ? {
    ibge: mun.ibge,
    nome: mun.nome,
    uf: mun.uf,
    pop_2026: reaproveita ? (anterior?.pop_2026 ?? null) : (pop.dado?.valor ?? null),
    pib_pc_2023: reaproveita ? (anterior?.pib_pc_2023 ?? null) : (pib.dado?.valor ?? null),
    frota: frota?.frota ?? null,
    plugin: frota?.plugin ?? null,
    por_mil: frota?.por_mil ?? null,
    uf_por_mil: frota?.uf_por_mil ?? null,
    br_por_mil: frota?.br_por_mil ?? null,
    ref: frota?.ref || '',
  } : null;

  const rodovia = ehRodovia(endereco, ficha);
  const indice = notaDoLocal({
    plugin_mun: frota?.plugin ?? null,
    frota_mun: frota?.frota ?? null,
    plugin_br: frota?.plugin_br ?? null,
    frota_br: frota?.frota_br ?? null,
    n_entorno: entornoRes ? entornoRes.n : null,
    carregadores_5km: recargaRes ? recargaRes.n : null,
    confianca,
  });
  const historico = hist.dado || [];
  const sinais = sinaisDeAtencao({ ficha, endereco, confianca, estabelecimento, historico });
  const sit = situacao(sinais, confianca);

  const dados: DadosEstudo = {
    ficha,
    endereco_digitado: endereco,
    local: lugar && centro ? {
      place_id: lugar.id || null, lat: centro.lat, lng: centro.lng,
      formatado: lugar.formattedAddress || null, estabelecimento, rodovia,
    } : null,
    ...(confianca ? { confianca } : {}),
    entorno: entornoRes,
    recarga: recargaRes,
    rua: sv.dado && centro ? {
      pano_id: sv.dado.pano_id,
      data: sv.dado.data,
      heading: sv.dado.lat != null && sv.dado.lng != null ? rumoGraus({ lat: sv.dado.lat, lng: sv.dado.lng }, centro) : 0,
      pano_lat: sv.dado.lat,
      pano_lng: sv.dado.lng,
    } : null,
    imagens: { satelite_ok: prova.ok && prova.dado === true, rua_ok: !!sv.dado },
    municipio,
    conta: contaDeReferencia({ kw: ficha.kw, carros: ficha.carros, rodovia }),
    indice,
    pre_nota: pre,
    sinais,
    situacao: sit,
    historico,
    portao,
  };

  const textos = await fontes.escreverTextos(montarFatosIA(dados));
  dados.ia = textos.ia;
  st.ia = textos.status;

  const custo = [local, entorno, recarga, sv, prova].reduce((s, x) => s + x.custo_usd, 0) + textos.custo_usd;
  return {
    status: FALHA_QUE_DEIXA_PARCIAL.some(k => falhou(st[k])) ? 'parcial' : 'pronto',
    dados,
    fontes: st,
    custo_usd: Math.round(custo * 10000) / 10000,
    confianca,
    pre_nota: pre.valor,
    indice: indice.valor,
    situacao: sit,
    municipio_ibge: mun?.ibge ?? null,
  };
}

// ── mensagens ──────────────────────────────────────────────────────────────

const CONFIANCA_TXT: Record<Confianca, string> = {
  alta: 'conferido no Google',
  media: 'rua encontrada, número não conferido',
  baixa: 'aproximado, conferir com o cliente',
  nao_encontrado: 'não encontrado no Google',
};

const umDecimal = (v: number) => v.toFixed(1).replace('.', ',');

export function montarAvisoPronto(est: banco.LinhaEstudoBanco, reu: Reuniao): string {
  const d = est.dados || {};
  const nome = primeiroNome(reu.cliente_nome);
  const cidade = d.municipio ? `${d.municipio.nome}-${d.municipio.uf}` : (reu.cidade || '');
  const mercado = d.indice?.valor != null ? `Mercado ${umDecimal(d.indice.valor)} de 10 (${d.indice.faixa})` : 'Mercado sem dado suficiente';
  const atencao = (d.sinais || []).find(s => s.lado === 'atencao');

  const linhas = [
    '*ESTUDO DO LOCAL PRONTO*',
    [nome || 'Cliente', cidade, `reunião ${quandoPorExtenso(reu.quando)}`].filter(Boolean).join(' · '),
    [d.pre_nota ? `Pré-nota ${d.pre_nota.valor} de 100` : '', mercado].filter(Boolean).join(' · '),
    `Endereço: ${d.confianca ? CONFIANCA_TXT[d.confianca] : 'não conferido agora'}`,
    `Situação: ${rotuloSituacao(d.situacao || 'confirmar')}`,
    ...(atencao ? [`Atenção: ${atencao.texto}`] : []),
    urlDoEstudo(est.token),
  ];

  const enderecoDuvidoso = d.confianca === 'baixa' || d.confianca === 'nao_encontrado'
    || (d.sinais || []).some(s => s.tipo === 'endereco_suspeito');
  if (d.situacao === 'confirmar' && enderecoDuvidoso && reu.quando) {
    // O link abre a conversa com o lead NO APARELHO DO CONSULTOR. O robô não manda nada.
    const link = linkPedirLocalizacao(reu.cliente_telefone, textoPedirLocalizacao({
      primeiroNome: nome, consultor: reu.vendedor_nome || 'consultor', quando: reu.quando,
    }));
    if (link) linhas.push('', 'Pedir a localização pelo seu WhatsApp:', link);
  }
  return linhas.join('\n');
}

export function linhaDoHistorico(est: banco.LinhaEstudoBanco, agoraMs: number): string {
  const carimbo = new Date(agoraMs).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(',', ' ·');
  const d = est.dados || {};
  const pre = d.pre_nota ? `Pré-nota ${d.pre_nota.valor} de 100` : 'Estudo do local';
  const mercado = d.indice?.valor != null ? `mercado ${umDecimal(d.indice.valor)} de 10` : 'mercado sem dado suficiente';
  return `[${carimbo} · Estudo] ${pre}, ${mercado}: ${urlDoEstudo(est.token)}`;
}

/** Depois de 30 dias o estudo perde as coordenadas. Ficam place_id e os agregados. */
export function semCoordenadas(d: DadosEstudo): DadosEstudo {
  const tira = <T extends { lat: number | null; lng: number | null }>(i: T): T => ({ ...i, lat: null, lng: null });
  return {
    ...d,
    local: d.local ? { ...d.local, lat: null, lng: null } : d.local,
    entorno: d.entorno ? { ...d.entorno, lista: d.entorno.lista.map(tira) } : d.entorno,
    recarga: d.recarga ? { ...d.recarga, lista: d.recarga.lista.map(tira) } : d.recarga,
    rua: null,
    imagens: { satelite_ok: false, rua_ok: false },
  };
}

function telDoDono(nome: string, cadastro: Map<string, string>): string | null {
  const doCadastro = cadastro.get(nome);
  if (doCadastro) return String(doCadastro).replace(/\D/g, '');
  const fixo = EQUIPE[nome.trim().toLowerCase()];
  return fixo ? String(fixo).replace(/\D/g, '') : null;
}

function inicioDoDiaBRT(agoraMs: number): string {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(agoraMs));
  return new Date(`${dia}T00:00:00-03:00`).toISOString();
}

// ── o tick ─────────────────────────────────────────────────────────────────

export interface ResultadoTick {
  processados: number;
  prontos: number;
  parciais: number;
  sem_endereco: number;
  descartados: number;
  erros: number;
  avisos: number;
  historicos: number;
  limpos: number;
  rede: number;
  backfill: number;
  motivo?: string;
  google?: { status: string; motivo?: string };
  falhas?: string[];
  ids?: number[];
  previa?: Record<string, unknown>;
  sonda?: Record<string, unknown>;
}

const zero = (motivo?: string): ResultadoTick => ({
  processados: 0, prontos: 0, parciais: 0, sem_endereco: 0, descartados: 0, erros: 0,
  avisos: 0, historicos: 0, limpos: 0, rede: 0, backfill: 0, ...(motivo ? { motivo } : {}),
});

/**
 * O que o ensaio devolve. Vai para o log do GitHub Actions, que é público neste
 * repo: nada de nome, telefone, rua ou coordenada aqui.
 */
function previaSemDadoPessoal(e: EstudoMontado): Record<string, unknown> {
  return {
    status: e.status,
    confianca: e.confianca,
    pre_nota: e.pre_nota,
    indice: e.indice,
    indice_faixa: e.dados.indice?.faixa ?? null,
    situacao: e.situacao,
    sinais: (e.dados.sinais || []).map(s => s.tipo),
    fontes: e.fontes,
    custo_usd: e.custo_usd,
    ia_origem: e.dados.ia?.origem ?? null,
    ia_reprovados: e.dados.ia?.reprovados ?? [],
    entorno_n: e.dados.entorno?.n ?? null,
    recarga_n: e.dados.recarga?.n ?? null,
    municipio_ibge: e.municipio_ibge,
    rua_ok: e.dados.imagens?.rua_ok ?? false,
    satelite_ok: e.dados.imagens?.satelite_ok ?? false,
  };
}

async function processarLinha(f: banco.LinhaEstudoBanco, reu: Reuniao, r: ResultadoTick): Promise<'ok' | 'erro' | 'google_fora'> {
  try {
    const e = await montarEstudo(reu);
    await banco.salvar(f.id, {
      status: e.status, dados: e.dados, fontes: e.fontes, custo_usd: e.custo_usd,
      confianca: e.confianca, pre_nota: e.pre_nota, indice: e.indice, situacao: e.situacao,
      municipio_ibge: e.municipio_ibge, pronto_em: new Date().toISOString(), locked_until: null, erro: null,
    });
    r.processados++;
    if (e.status === 'pronto') r.prontos++;
    else if (e.status === 'parcial') r.parciais++;
    else r.sem_endereco++;
    return 'ok';
  } catch (err) {
    if (err instanceof GoogleFora) {
      // Devolve a tentativa que o claim gastou: esperar o Google não conta como falha.
      await banco.salvar(f.id, { status: 'pendente', locked_until: null, tentativas: f.tentativas }).catch(() => undefined);
      r.motivo = 'google_fora';
      r.google = { status: err.status, ...(err.motivo ? { motivo: err.motivo } : {}) };
      logger.warn('ep-estudo', 'Google recusou a chave, estudo espera na fila', r.google);
      return 'google_fora';
    }
    const msg = String((err as Error)?.message || err).slice(0, 300);
    logger.error('ep-estudo', 'estudo falhou', { id: f.id, erro: msg });
    const ultima = f.tentativas + 1 >= MAX_TENTATIVAS;
    await banco.salvar(f.id, { status: ultima ? 'erro' : 'pendente', locked_until: null, erro: msg }).catch(() => undefined);
    r.erros++;
    return 'erro';
  }
}

async function fase(nome: string, r: ResultadoTick, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logger.error('ep-estudo', `fase ${nome} falhou`, String((e as Error)?.message || e).slice(0, 200));
    (r.falhas ??= []).push(nome);
  }
}

export async function runEletropostoEstudoTick(opts: {
  dry?: boolean; id?: number; sonda?: boolean; backfill?: boolean; agora?: number;
} = {}): Promise<ResultadoTick> {
  const agora = opts.agora ?? Date.now();

  // A sonda responde mesmo com o estudo desligado: é ela que diz se já dá para ligar.
  if (opts.sonda) {
    let bancoStatus = banco.bancoConfigurado() ? 'ok' : 'sem_segredo';
    if (bancoStatus === 'ok') {
      try { await banco.contarProntosDesde(new Date(agora).toISOString()); }
      catch (e) { bancoStatus = `erro: ${String((e as Error)?.message || e).slice(0, 120)}`; }
    }
    return {
      ...zero('sonda'),
      sonda: {
        banco: bancoStatus,
        geradorComServiceKey,
        chave_google_presente: !!(process.env.GOOGLE_MAPS_API_KEY || '').trim(),
        fontes: await fontes.sondarFontes(),
      },
    };
  }

  if (estudoDesligado()) return zero('desligado');
  if (!banco.bancoConfigurado()) return zero('sem_segredo');

  const inicio = Date.now();

  // Ensaio de uma ficha real: gasta Google e IA, não grava nada.
  if (opts.id && opts.dry) {
    const reu = (await carregarReunioes([opts.id])).get(opts.id);
    if (!reu) return zero('ficha_nao_encontrada');
    try {
      return { ...zero('dry'), previa: previaSemDadoPessoal(await montarEstudo(reu)) };
    } catch (e) {
      if (e instanceof GoogleFora) return { ...zero('google_fora'), google: { status: e.status, motivo: e.motivo } };
      throw e;
    }
  }

  const r = zero();

  // Reuniões que já estavam na agenda: ganham estudo, nunca aviso.
  if (opts.backfill) {
    const cands = await candidatas(agora, null);
    const ja = new Set((await banco.listar('por_agendamentos', { ids: cands.map(c => c.id), limite: 200 })).map(x => Number(x.agendamento_id)));
    const novas = cands.filter(c => !ja.has(c.id));
    if (opts.dry) return { ...r, motivo: 'dry', ids: novas.map(c => c.id) };
    for (const c of novas) {
      if (await garantirEstudo(c, 'backfill', { avisoEnviado: true })) r.backfill++;
    }
    return r;
  }

  // Uma ficha na mão, agora, fora do teto.
  if (opts.id) {
    const reu = (await carregarReunioes([opts.id])).get(opts.id);
    if (!reu) return zero('ficha_nao_encontrada');
    if (!(await garantirEstudo(reu, 'manual'))) return zero('sem_endereco_ou_sem_banco');
    const [linha] = await banco.listar('por_agendamentos', { ids: [opts.id], limite: 1 });
    if (!linha || !['pendente', 'processando'].includes(linha.status)) return { ...r, motivo: 'ja_processado' };
    if (!(await banco.pegar(linha.id, linha.tentativas, LEASE_SEG))) return { ...r, motivo: 'corrida_perdida' };
    await processarLinha(linha, reu, r);
    return r;
  }

  // Rede de segurança: ficha nova cujo /alerta não criou a linha.
  if (!opts.dry) {
    await fase('rede', r, async () => {
      const piso = new Date(Math.max(agora - REDE_JANELA_MS, Date.parse(ESTUDO_NO_AR_EM))).toISOString();
      const cands = await candidatas(agora, piso);
      if (!cands.length) return;
      const ja = new Set((await banco.listar('por_agendamentos', { ids: cands.map(c => c.id), limite: 200 })).map(x => Number(x.agendamento_id)));
      for (const c of cands.filter(x => !ja.has(x.id)).slice(0, REDE_MAX)) {
        if (await garantirEstudo(c, 'rede')) r.rede++;
      }
    });
  }

  await fase('processamento', r, async () => {
    if ((await banco.contarProntosDesde(inicioDoDiaBRT(agora))) >= maxPorDia()) { r.motivo = 'teto_diario'; return; }

    const fila = await banco.listar('fila', { limite: 20 });
    if (!fila.length) return;
    const reunioes = await carregarReunioes(fila.map(f => Number(f.agendamento_id)));
    // A reunião mais próxima primeiro: é a que o consultor abre antes.
    const ordem = fila
      .map(f => ({ f, reu: reunioes.get(Number(f.agendamento_id)) }))
      .sort((a, b) => String(a.reu?.quando || '9').localeCompare(String(b.reu?.quando || '9')));

    let comecados = 0;
    for (const { f, reu } of ordem) {
      const quandoMs = reu?.quando ? Date.parse(reu.quando) : NaN;
      if (!reu || reu.status !== 'agendado' || !(quandoMs > agora)) {
        if (!opts.dry) await banco.salvar(f.id, { status: 'descartado', locked_until: null });
        r.descartados++;
        continue;
      }
      if (f.tentativas >= MAX_TENTATIVAS) {
        if (!opts.dry) await banco.salvar(f.id, { status: 'erro', locked_until: null, erro: f.erro || 'três tentativas sem terminar' });
        r.erros++;
        continue;
      }
      if (comecados >= POR_TICK) continue;
      if (Date.now() - inicio > TICK_MAX_MS - MIN_RESTANTE_MS) { r.motivo = 'sem_tempo'; break; }
      if (opts.dry) { comecados++; r.processados++; continue; }
      if (!(await banco.pegar(f.id, f.tentativas, LEASE_SEG))) continue;   // outro tick pegou
      comecados++;
      // Google fora vale para todas: não adianta tentar a próxima linha agora.
      if ((await processarLinha(f, reu, r)) === 'google_fora') break;
    }
  });

  if (opts.dry) return { ...r, motivo: r.motivo || 'dry' };

  if (!avisoDesligado()) {
    await fase('aviso', r, async () => {
      const lista = await banco.listar('aviso', { limite: 20 });
      if (!lista.length) return;
      const reunioes = await carregarReunioes(lista.map(x => Number(x.agendamento_id)));
      const cadastro = await carregarConsultores();
      for (const est of lista) {
        if (r.avisos >= AVISO_POR_TICK) break;
        const reu = reunioes.get(Number(est.agendamento_id));
        const quandoMs = reu?.quando ? Date.parse(reu.quando) : NaN;
        if (!(await banco.marcar(est.id, 'aviso', true))) continue;
        // Reunião que passou ou saiu da agenda: fica carimbada sem aviso.
        if (!reu || reu.status !== 'agendado' || !(quandoMs > agora + AVISO_ANTES_MIN * 60_000)) continue;
        const dono = String(reu.vendedor_nome || '');
        const tel = telDoDono(dono, cadastro);
        if (!tel) {
          logger.error('ep-estudo', 'dono da reunião sem telefone, aviso do estudo não saiu', { id: est.agendamento_id, dono });
          continue;
        }
        try {
          await sendWhatsApp(tel, montarAvisoPronto(est, reu), 'io');
          r.avisos++;
        } catch (e) {
          await banco.marcar(est.id, 'aviso', false).catch(() => undefined);
          logger.error('ep-estudo', 'aviso do estudo falhou, tenta no próximo tick', { id: est.agendamento_id, erro: String((e as Error)?.message || e).slice(0, 200) });
        }
      }
    });
  }

  if (!historicoDesligado()) {
    await fase('historico', r, async () => {
      for (const est of await banco.listar('historico', { limite: 10 })) {
        if (!(await banco.marcar(est.id, 'historico', true))) continue;
        try {
          await banco.escreverNoHistorico(Number(est.agendamento_id), linhaDoHistorico(est, agora));
          r.historicos++;
        } catch (e) {
          await banco.marcar(est.id, 'historico', false).catch(() => undefined);
          logger.error('ep-estudo', 'linha no histórico falhou', { id: est.agendamento_id, erro: String((e as Error)?.message || e).slice(0, 200) });
        }
      }
    });
  }

  await fase('limpeza', r, async () => {
    for (const est of await banco.listar('limpeza', { limite: 20 })) {
      await banco.salvar(est.id, { dados: semCoordenadas(est.dados || {}), coords_apagadas_em: new Date().toISOString() });
      r.limpos++;
    }
  });

  return r;
}
