// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, FASE 2 (06/11/2026): leitura e gravação do estado das etapas 4 a 8, do JSON privado da obra e do registro das notas.
//
//   - Estado das etapas 4 a 8 ... `system_state`, chave `jornada_obra:<card>`, ASSINADO por HMAC, no mesmo molde da `jornada_solar:<card>`
//     da Fase 1 (que NÃO muda de formato, D15). Nada pessoal, nenhum texto livre, nenhum dinheiro.
//   - Dados das etapas 4 a 8, vistoria, banco, previsto, regra congelada, garantias do contrato e cofre ... JSON PRIVADO no bucket
//     `cadastros-venda`, `vendasolar/<card>.obra.json` (trava `obra:<card>`), com número de versão por seção (D17).
//   - Registro global das notas ... `system_state`, `fin_nf:<card>:<id>`, ASSINADO, sem valor nem nome.
//   - Reserva da chave de 44 dígitos ... `system_state`, `nfe_chave:<chave>`, ASSINADA, sem valor nem nome (INSERT; 23505 = já tem dono).
//
// Serviço: NÃO importa rota. Nada aqui põe valor pessoal em log: só o código.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { segredoDoVinculo } from './vendaSolarHub';
import { nomeSimples } from './solarObras';
import { lerJsonBruto, gravarJsonBruto, comTrava } from './cadastroVendaBanco';
import { MOTIVOS_ESPERA, type MotivoEspera } from './jornadaSolar';
import { ErroJornada, ehRecusa, type Recusa } from './jornadaSolarBanco';
import {
  ACOES_HISTORICO_OBRA, CAMPOS_CONTRATO, CHAVES_CHECKLIST, EQUIPES_LISTA, ETAPAS_OBRA, IDS_EQUIPE, ORIGENS_ITEM, SECOES_OBRA, TIPOS_ITEM, UNIDADES_ITEM,
  vazioEtapaObra,
  type AcaoHistoricoObra, type BancoObra, type CargaObra, type CompraObra, type ContratoObra, type EstadoObra, type ItemCompra, type ObraPrivada,
  type PassoLiberacao, type PrevistoObra, type RegraCongelada, type SecaoObra, type VistoriaObra, chaveNfeValida,
} from './jornadaObra';

export const EQUIPES = EQUIPES_LISTA;
export const PREFIXO_OBRA = 'jornada_obra:';
export const chaveObra = (card: number): string => `${PREFIXO_OBRA}${card}`;

const codigoDe = (e: unknown): string => String((e as { code?: unknown } | null)?.code ?? 'desconhecido');

// ── Normalização (chaves escritas à mão, em TODO nível, na ordem do contrato) ────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
const nome = (v: unknown): string => nomeSimples(txt(v, 60)).slice(0, 60);
const dataIso = (v: unknown): string | null => {
  const t = txt(v, 40);
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(t) ? t : null;
};
const ymd = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const inteiro = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
const numero = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const hhmm = (v: unknown): string => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '');
const dhm = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T([01]\d|2[0-3]):[0-5]\d)?$/.test(v) ? v : '');
const idCurto = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9-]{3,40}$/.test(v) ? v : '');
const idArquivo = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : '');
const bool = (v: unknown): boolean => v === true;

export function normalizarObra(card: number, value: unknown): EstadoObra | null {
  const o = obj(value);
  if (!o || o.v !== 1 || !Number.isInteger(card) || card <= 0 || o.card !== card) return null;
  const et = obj(o.etapas) ?? {};
  const base = (n: number) => {
    const e = obj(et[String(n)]) ?? {};
    return { aberta_em: dataIso(e.aberta_em), concluida_em: dataIso(e.concluida_em), concluida_por: nome(e.concluida_por) };
  };
  const dias: EstadoObra['dias_obra'] = [];
  for (const d of lista(o.dias_obra)) {
    const dd = obj(d);
    const data = dd ? ymd(dd.data) : null;
    if (dd && data && IDS_EQUIPE.includes(dd.equipe as string)) dias.push({ data, equipe: dd.equipe as string });
  }
  dias.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.equipe < b.equipe ? -1 : a.equipe > b.equipe ? 1 : 0));
  const ped = obj(o.pedido);
  const pedNum = ped && typeof ped.numero === 'string' && /^[A-Za-z0-9./-]{1,40}$/.test(ped.numero) ? ped.numero : null;
  const pedEm = ped ? ymd(ped.em) : null;
  const esp = obj(o.esperando);
  const espMotivo = esp && MOTIVOS_ESPERA.includes(esp.motivo as MotivoEspera) ? esp.motivo as MotivoEspera : null;
  const espAte = esp ? ymd(esp.ate) : null;
  const espEtapa = esp ? inteiro(esp.etapa, 4, 8) : null;
  const espEm = esp ? dataIso(esp.em) : null;
  const fe = obj(o.fechada);
  const feEm = fe ? dataIso(fe.em) : null;
  const reab: EstadoObra['reaberturas'] = [];
  for (const r of lista(o.reaberturas)) {
    const ro = obj(r);
    const em = ro ? dataIso(ro.em) : null;
    if (ro && em) reab.push({ em, por: nome(ro.por) });
  }
  const hist: EstadoObra['historico'] = [];
  for (const h of lista(o.historico)) {
    const ho = obj(h);
    const em = ho ? dataIso(ho.em) : null;
    if (!ho || !em || !ACOES_HISTORICO_OBRA.includes(ho.acao as AcaoHistoricoObra)) continue;
    hist.push({ em, por: nome(ho.por), acao: ho.acao as AcaoHistoricoObra, etapa: inteiro(ho.etapa, 1, 9) });
  }
  const b4 = base(4); const b5 = base(5); const b6 = base(6); const b7 = base(7); const b8 = base(8);
  return {
    v: 1,
    card,
    etapas: { 4: b4, 5: b5, 6: b6, 7: b7, 8: b8 },
    dias_obra: dias.slice(0, 20),
    pedido: ped && pedNum && pedEm ? { numero: pedNum, em: pedEm } : null,
    esperando: esp && espMotivo && espAte && espEtapa && espEm
      ? { motivo: espMotivo, ate: espAte, etapa: espEtapa as 4 | 5 | 6 | 7 | 8, em: espEm, por: nome(esp.por) } : null,
    fechada: fe && feEm ? { em: feEm, por: nome(fe.por) } : null,
    reaberturas: reab.slice(-10),
    historico: hist.slice(-50),
  };
}

/** O estado vazio de uma obra (nenhuma etapa aberta). */
export const obraVazia = (card: number): EstadoObra => ({
  v: 1, card, etapas: { 4: vazioEtapaObra(), 5: vazioEtapaObra(), 6: vazioEtapaObra(), 7: vazioEtapaObra(), 8: vazioEtapaObra() },
  dias_obra: [], pedido: null, esperando: null, fechada: null, reaberturas: [], historico: [],
});

/** HMAC de `jornada_obra|card|JSON` do objeto normalizado (sem `sig`), ou null sem segredo. */
export function assinarObra(card: number, e: EstadoObra): string | null {
  const segredo = segredoDoVinculo();
  if (!segredo) return null;
  const n = normalizarObra(card, e);
  if (!n) return null;
  return crypto.createHmac('sha256', segredo).update(`jornada_obra|${card}|${JSON.stringify(n)}`).digest('hex');
}

const jaLogadas = new Set<number>();
/** Para os testes. */
export function reiniciarLogsDaObra(): void { jaLogadas.clear(); }

/** O estado do `value` do banco SE a assinatura confere; senão null (e um log único por card, só o código). */
export function obraAssinada(card: number, value: unknown): EstadoObra | null {
  const n = normalizarObra(card, value);
  const sig = obj(value)?.sig;
  const esperada = n ? assinarObra(card, n) : null;
  if (n && esperada && typeof sig === 'string' && sig.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8'))) return n;
  if (!jaLogadas.has(card)) {
    jaLogadas.add(card);
    console.error('[jornada-obra] estado sem assinatura válida, ignorado', 'sig_invalida');
  }
  return null;
}

// ── Leitura e gravação com compare-and-swap ─────────────────────────────────────────────────────────────────────────────

/** `versao`: null = a linha não existe; '' = existe sem `updated_at`; senão o `updated_at`. Linha com assinatura inválida: estado null, mas com a versão dela. */
export async function lerObraComVersao(card: number): Promise<{ estado: EstadoObra | null; versao: string | null }> {
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at').eq('key', chaveObra(card)).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  if (!l) return { estado: null, versao: null };
  return { estado: obraAssinada(card, l.value), versao: l.updated_at ?? '' };
}

/** true = gravou; false = perdeu a corrida (quem chama lê de novo). */
export async function gravarObra(card: number, e: EstadoObra, versaoLida: string | null, agora: string): Promise<boolean> {
  const n = normalizarObra(card, e);
  const sig = n ? assinarObra(card, n) : null;
  if (!n || !sig) throw new ErroJornada('sem_segredo');
  const value = { ...n, sig };
  const chave = chaveObra(card);
  if (versaoLida === null) {
    const { error } = await supabase.from('system_state').insert({ key: chave, value, updated_at: agora });
    if (!error) return true;
    if (codigoDe(error) === '23505') return false;
    throw new ErroJornada(codigoDe(error));
  }
  const alvo = supabase.from('system_state').update({ value, updated_at: agora }).eq('key', chave);
  const { data, error } = await (versaoLida === '' ? alvo.is('updated_at', null) : alvo.eq('updated_at', versaoLida)).select('key');
  if (error) throw new ErroJornada(codigoDe(error));
  return Array.isArray(data) && data.length > 0;
}

/** Todos os estados válidos (card -> estado). Lê em páginas de 1000; no LIKE o `_` é curinga, então o `startsWith` descarta o excesso. */
export async function lerTodasObras(): Promise<Map<number, EstadoObra>> {
  const mapa = new Map<number, EstadoObra>();
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .like('key', `${PREFIXO_OBRA}%`).order('key', { ascending: true }).range(de, de + 999);
    if (error) throw new ErroJornada(codigoDe(error));
    const lote = (data ?? []) as Array<{ key: string; value: unknown }>;
    for (const l of lote) {
      const k = String(l.key);
      if (!k.startsWith(PREFIXO_OBRA)) continue;
      const id = Number(k.slice(PREFIXO_OBRA.length));
      if (!Number.isInteger(id) || id <= 0) continue;
      const e = obraAssinada(id, l.value);
      if (e) mapa.set(id, e);
    }
    if (lote.length < 1000) break;
  }
  return mapa;
}

/**
 * Lê com versão, monta (`base()` quando não há estado), aplica `fn` e grava. Até 4 voltas; perdeu as 4: `ErroJornada('ocupado')`.
 * `fn` devolve o estado novo ou uma recusa (nada grava).
 */
export async function mudarObra(
  card: number, base: () => EstadoObra, fn: (e: EstadoObra) => EstadoObra | Recusa,
): Promise<EstadoObra | Recusa> {
  if (!segredoDoVinculo()) throw new ErroJornada('sem_segredo');
  for (let t = 0; t < 4; t++) {
    const { estado, versao } = await lerObraComVersao(card);
    const atual = estado ?? base();
    const novo = fn(normalizarObra(card, atual) ?? atual);
    if (ehRecusa(novo)) return novo;
    const n = normalizarObra(card, novo);
    if (!n) throw new ErroJornada('formato');
    if (await gravarObra(card, n, versao, new Date().toISOString())) return n;
  }
  throw new ErroJornada('ocupado');
}

// ── O JSON privado da obra (`vendasolar/<card>.obra.json`) ──────────────────────────────────────────────────────────

export const caminhoObraPrivada = (card: number): string => `vendasolar/${card}.obra.json`;

export const obraPrivadaVazia = (): ObraPrivada => ({
  v: 1,
  versoes: { vistoria: 0, banco: 0, compra: 0, logistica: 0, obra: 0, entrega: 0, liberacao: 0, previsto: 0 },
  contrato: null, vistoria: null, banco: null, previsto: null, regra_comissao: null,
  compra: { itens: [], compras: [] },
  logistica: { cargas: [] },
  obra: { plano: [], diario: [], checklist: {}, equipe: { combinado_centavos: null, descricao: '' } },
  entrega: {
    testes: { string1_voc: '', string2_voc: '', isolamento_ok: false, gerando_kw: '', gerando_hora: '', wifi_ok: false, disjuntores_ok: false },
    monitoramento: { app: '', conta: '', usina: '', online: false, serie: '', comissionamento: '' },
    cofre: null, cofre_revelado: [], garantias: { registrada_em: null, treinado: false }, termo: null, responsavel: '',
  },
  liberacao: { passos: { pedido: null, vistoria: null, medidor: null, liberada: null }, exigencias: [] },
  reaberturas: [],
});

const MAX_CENTAVOS = 10_000_000_000;
const centavos = (v: unknown): number | null => inteiro(v, 0, MAX_CENTAVOS);
const textos = (v: unknown, n: number, max: number): string[] => lista(v).filter((x): x is string => typeof x === 'string').map((x) => txt(x, max)).filter(Boolean).slice(0, n);
const idsArquivo = (v: unknown, n: number): string[] => lista(v).map(idArquivo).filter(Boolean).slice(0, n);

function contratoNormal(v: unknown): ContratoObra | null {
  const c = obj(v);
  const gerado = c ? dataIso(c.gerado_em) : null;
  if (!c || !gerado) return null;
  const campos = {} as Record<string, string>;
  for (const k of CAMPOS_CONTRATO) campos[k] = txt(c[k], 160);
  return { gerado_em: gerado, por: nome(c.por), fonte: c.fonte === 'recalculado' ? 'recalculado' : 'gerado', ...campos } as ContratoObra;
}

function vistoriaNormal(v: unknown): VistoriaObra | null {
  const o = obj(v);
  if (!o) return null;
  const t = obj(o.telhado) ?? {}; const en = obj(o.entrada) ?? {}; const iv = obj(o.inversor) ?? {};
  const fotos: VistoriaObra['fotos'] = [];
  for (const f of lista(o.fotos).slice(0, 12)) {
    const fo = obj(f);
    const id = fo ? idArquivo(fo.arquivo_id) : '';
    if (fo && id) fotos.push({ arquivo_id: id, leg: txt(fo.leg, 80), txt: txt(fo.txt, 200) });
  }
  return {
    data: ymd(o.data) ?? '', quem: txt(o.quem, 80), acomp: txt(o.acomp, 80),
    concl: o.concl === 'ok' || o.concl === 'adeq' || o.concl === 'nao' ? o.concl : '',
    adeq: textos(o.adeq, 10, 200), obs: txt(o.obs, 600),
    telhado: { tipo: txt(t.tipo, 80), estado: txt(t.estado, 80), orient: txt(t.orient, 80), incl: txt(t.incl, 40), area: txt(t.area, 40), sombra: txt(t.sombra, 80), estr: txt(t.estr, 80), acesso: txt(t.acesso, 80) },
    entrada: { padrao: txt(en.padrao, 80), tensao: txt(en.tensao, 40), disj: txt(en.disj, 40), apto: txt(en.apto, 40), aterr: txt(en.aterr, 40), quadro: txt(en.quadro, 80) },
    inversor: { local: txt(iv.local, 80), dist: txt(iv.dist, 40), abrig: txt(iv.abrig, 40), wifi: txt(iv.wifi, 40) },
    fotos,
  };
}

function bancoNormal(v: unknown): BancoObra | null {
  const o = obj(v);
  if (!o) return null;
  const f = obj(o.fin);
  return {
    banco: txt(o.banco, 80), agencia: txt(o.agencia, 20), conta: txt(o.conta, 30), validade: txt(o.validade, 40), prazo: txt(o.prazo, 40),
    origem: txt(o.origem, 160), nota: txt(o.nota, 400), desc: txt(o.desc, 400), ger: txt(o.ger, 40),
    eq_centavos: centavos(o.eq_centavos), mo_centavos: centavos(o.mo_centavos),
    fin: f ? { nome: txt(f.nome, 120), doc: txt(f.doc, 30), rg: txt(f.rg, 30), qualif: txt(f.qualif, 160), end: txt(f.end, 200), cep: txt(f.cep, 12), tel: txt(f.tel, 30), email: txt(f.email, 120) } : null,
  };
}

function previstoNormal(v: unknown): PrevistoObra | null {
  const o = obj(v);
  const em = o ? dataIso(o.em) : null;
  if (!o || !em) return null;
  return {
    homologacao: centavos(o.homologacao) ?? 0, material: centavos(o.material) ?? 0, frete: centavos(o.frete) ?? 0,
    mao_de_obra: centavos(o.mao_de_obra) ?? 0, outros: centavos(o.outros) ?? 0, por: nome(o.por), em,
  };
}

function regraNormal(v: unknown): RegraCongelada | null {
  const o = obj(v);
  const em = o ? dataIso(o.congelada_em) : null;
  if (!o || !em) return null;
  const linhas: RegraCongelada['linhas'] = [];
  for (const l of lista(o.linhas).slice(0, 4)) {
    const lo = obj(l);
    const pb = lo ? inteiro(lo.pb, 0, 2000) : null;
    const n = lo ? nome(lo.nome) : '';
    if (lo && pb !== null && n && (lo.papel === 'venda' || lo.papel === 'socio')) linhas.push({ nome: n, papel: lo.papel, pb });
  }
  return linhas.length ? { linhas, congelada_em: em } : null;
}

function itemNormal(v: unknown): ItemCompra | null {
  const o = obj(v);
  const id = o ? idCurto(o.id) : '';
  if (!o || !id) return null;
  return {
    id, origem: ORIGENS_ITEM.find((x) => x === o.origem) ?? 'manual', tipo: TIPOS_ITEM.find((x) => x === o.tipo) ?? 'outro',
    descricao: txt(o.descricao, 120), quantidade: numero(o.quantidade, 0, 1_000_000), unidade: UNIDADES_ITEM.find((x) => x === o.unidade) ?? 'un',
    marca: txt(o.marca, 80), modelo: txt(o.modelo, 80), potencia_w: numero(o.potencia_w, 0, 2000), potencia_kw: numero(o.potencia_kw, 0, 500),
    garantia_fabricacao_anos: inteiro(o.garantia_fabricacao_anos, 0, 50), garantia_desempenho_anos: inteiro(o.garantia_desempenho_anos, 0, 50),
    garantia_anos: inteiro(o.garantia_anos, 0, 50),
    compra_id: idCurto(o.compra_id) || null, fornecedor: txt(o.fornecedor, 80), valor_centavos: centavos(o.valor_centavos), data: ymd(o.data),
    etapa: o.etapa === 6 ? 6 : 4, criado_por: nome(o.criado_por), criado_em: dataIso(o.criado_em) ?? '',
  };
}

function compraNormal(v: unknown): CompraObra | null {
  const o = obj(v);
  const id = o ? idCurto(o.id) : '';
  if (!o || !id) return null;
  const n = obj(o.nota);
  const path = n && typeof n.path === 'string' ? n.path.slice(0, 300) : '';
  return {
    id, fornecedor: txt(o.fornecedor, 80), cidade: txt(o.cidade, 80), data: ymd(o.data), forma: txt(o.forma, 30),
    nota_chega: o.nota_chega === 'na_retirada' || o.nota_chega === 'anexada' ? o.nota_chega : 'com_a_carga',
    nota: n && path ? {
      path, sha256: typeof n.sha256 === 'string' && /^[0-9a-f]{64}$/.test(n.sha256) ? n.sha256 : '', numero: txt(n.numero, 40),
      chave: typeof n.chave === 'string' && /^\d{44}$/.test(n.chave) ? n.chave : '', nf_id: txt(n.nf_id, 60),
    } : null,
  };
}

function cargaNormal(v: unknown): CargaObra | null {
  const o = obj(v);
  const id = o ? idCurto(o.id) : '';
  if (!o || !id) return null;
  const sa = obj(o.saida) ?? {}; const ch = obj(o.chegada) ?? {}; const tr = obj(o.transporte) ?? {};
  const rb = obj(o.recebido_por) ?? {}; const co = obj(o.conferencia) ?? {}; const av = obj(o.avaria) ?? {}; const fr = obj(o.frete) ?? {};
  return {
    id, nome: txt(o.nome, 80), itens: lista(o.itens).map(idCurto).filter(Boolean).slice(0, 80),
    saida: { lugar: txt(sa.lugar, 120), em: dhm(sa.em) },
    chegada: { lugar: txt(ch.lugar, 160), destino: ch.destino === 'obra' ? 'obra' : 'deposito', em: dhm(ch.em) },
    transporte: { empresa: txt(tr.empresa, 80), motorista: txt(tr.motorista, 80) },
    compras: lista(o.compras).map(idCurto).filter(Boolean).slice(0, 20),
    recebido_por: { nome: txt(rb.nome, 80), assinatura_id: idArquivo(rb.assinatura_id) },
    conferencia: { itens_ok: lista(co.itens_ok).map(idCurto).filter(Boolean).slice(0, 80), foto_id: idArquivo(co.foto_id) },
    avaria: { tem: bool(av.tem), descricao: txt(av.descricao, 400), foto_id: idArquivo(av.foto_id), o_que_fazer: txt(av.o_que_fazer, 400), resolvida: bool(av.resolvida) },
    frete: { valor_centavos: centavos(fr.valor_centavos), forma: txt(fr.forma, 30) },
    documentos: idsArquivo(o.documentos, 20),
  };
}

function passoNormal(v: unknown): PassoLiberacao | null {
  const o = obj(v);
  const data = o ? ymd(o.data) : null;
  return o && data ? { data, arquivo_id: idArquivo(o.arquivo_id) } : null;
}

export function normalizarObraPrivada(value: unknown): ObraPrivada {
  const o = obj(value);
  if (!o || o.v !== 1) return obraPrivadaVazia();
  const vs = obj(o.versoes) ?? {};
  const versoes = {} as Record<SecaoObra, number>;
  for (const s of SECOES_OBRA) versoes[s] = inteiro(vs[s], 0, 1_000_000_000) ?? 0;
  const cp = obj(o.compra) ?? {}; const lg = obj(o.logistica) ?? {}; const ob = obj(o.obra) ?? {}; const en = obj(o.entrega) ?? {}; const li = obj(o.liberacao) ?? {};
  const eq = obj(ob.equipe) ?? {};
  const plano: ObraPrivada['obra']['plano'] = [];
  for (const p of lista(ob.plano).slice(0, 10)) {
    const po = obj(p);
    const data = po ? ymd(po.data) : null;
    if (po && data) plano.push({ data, inicio: hhmm(po.inicio), fim: hhmm(po.fim), equipe: IDS_EQUIPE.includes(po.equipe as string) ? po.equipe as string : '', ajudantes: inteiro(po.ajudantes, 0, 9) ?? 0, servico: txt(po.servico, 200) });
  }
  const diario: ObraPrivada['obra']['diario'] = [];
  for (const d of lista(ob.diario).slice(0, 20)) {
    const dd = obj(d);
    const data = dd ? ymd(dd.data) : null;
    if (dd && data) diario.push({ data, chegada: hhmm(dd.chegada), saida: hhmm(dd.saida), fotos: idsArquivo(dd.fotos, 60), ocorrencia: txt(dd.ocorrencia, 400) });
  }
  const ck = obj(ob.checklist) ?? {};
  const checklist: Record<string, boolean> = {};
  for (const k of CHAVES_CHECKLIST) if (k in ck) checklist[k] = bool(ck[k]);
  const te = obj(en.testes) ?? {}; const mo = obj(en.monitoramento) ?? {}; const co = obj(en.cofre); const ga = obj(en.garantias) ?? {}; const tm = obj(en.termo);
  const cofreEm = co ? dataIso(co.em) : null;
  const cofre = co && cofreEm && typeof co.cifra === 'string' && typeof co.iv === 'string' && typeof co.tag === 'string'
    && /^[A-Za-z0-9+/=]{1,400}$/.test(co.cifra) && /^[A-Za-z0-9+/=]{1,40}$/.test(co.iv) && /^[A-Za-z0-9+/=]{1,40}$/.test(co.tag)
    ? { cifra: co.cifra, iv: co.iv, tag: co.tag, em: cofreEm, por: nome(co.por) } : null;
  const termoEm = tm ? dataIso(tm.assinado_em) : null;
  const chk = (x: unknown): string => (x === 'sim' || x === 'na' ? x : 'pend');
  const revelados: Array<{ em: string; por: string }> = [];
  for (const r of lista(en.cofre_revelado)) { const ro = obj(r); const em = ro ? dataIso(ro.em) : null; if (ro && em) revelados.push({ em, por: nome(ro.por) }); }
  const ps = obj(li.passos) ?? {};
  const exig: ObraPrivada['liberacao']['exigencias'] = [];
  for (const x of lista(li.exigencias)) { const xo = obj(x); const em = xo ? dataIso(xo.em) : null; const t = xo ? txt(xo.texto, 400) : ''; if (xo && em && t) exig.push({ em, por: nome(xo.por), texto: t }); }
  const reab: ObraPrivada['reaberturas'] = [];
  for (const r of lista(o.reaberturas)) { const ro = obj(r); const em = ro ? dataIso(ro.em) : null; const m = ro ? txt(ro.motivo, 300) : ''; if (ro && em && m.length >= 3) reab.push({ em, por: nome(ro.por), motivo: m }); }
  return {
    v: 1,
    versoes,
    contrato: contratoNormal(o.contrato),
    vistoria: vistoriaNormal(o.vistoria),
    banco: bancoNormal(o.banco),
    previsto: previstoNormal(o.previsto),
    regra_comissao: regraNormal(o.regra_comissao),
    compra: { itens: lista(cp.itens).map(itemNormal).filter((x): x is ItemCompra => !!x).slice(0, 80), compras: lista(cp.compras).map(compraNormal).filter((x): x is CompraObra => !!x).slice(0, 20) },
    logistica: { cargas: lista(lg.cargas).map(cargaNormal).filter((x): x is CargaObra => !!x).slice(0, 12) },
    obra: { plano, diario, checklist, equipe: { combinado_centavos: centavos(eq.combinado_centavos), descricao: txt(eq.descricao, 160) } },
    entrega: {
      testes: {
        string1_voc: txt(te.string1_voc, 20), string2_voc: txt(te.string2_voc, 20), isolamento_ok: bool(te.isolamento_ok),
        gerando_kw: txt(te.gerando_kw, 20), gerando_hora: txt(te.gerando_hora, 20), wifi_ok: bool(te.wifi_ok), disjuntores_ok: bool(te.disjuntores_ok),
      },
      monitoramento: { app: txt(mo.app, 80), conta: txt(mo.conta, 120), usina: txt(mo.usina, 120), online: bool(mo.online), serie: txt(mo.serie, 60), comissionamento: txt(mo.comissionamento, 200) },
      cofre,
      cofre_revelado: revelados.slice(-20),
      garantias: { registrada_em: ymd(ga.registrada_em), treinado: bool(ga.treinado) },
      termo: tm && termoEm ? {
        assinado_em: termoEm, nome: txt(tm.nome, 120), arquivo_id: idArquivo(tm.arquivo_id),
        chk: Array.from({ length: 6 }, (_, i) => chk(lista(tm.chk)[i])), ressalva: txt(tm.ressalva, 500),
      } : null,
      responsavel: txt(en.responsavel, 80),
    },
    liberacao: { passos: { pedido: passoNormal(ps.pedido), vistoria: passoNormal(ps.vistoria), medidor: passoNormal(ps.medidor), liberada: passoNormal(ps.liberada) }, exigencias: exig.slice(-10) },
    reaberturas: reab.slice(-10),
  };
}

/** O JSON privado da obra, ou null quando o objeto não existe. Qualquer outra falha lança. */
export async function lerObraPrivada(card: number): Promise<ObraPrivada | null> {
  const bruto = await lerJsonBruto(caminhoObraPrivada(card));
  return bruto === null ? null : normalizarObraPrivada(bruto);
}

/**
 * Lê, confere a versão da seção, aplica e grava o JSON privado dentro da trava `obra:<card>`. `secao` + `versaoLida`: versão velha
 * devolve a recusa 409 `mudou` (a tela relê). `secao` null: escrita do servidor, sem conferência. Cada gravação soma 1 na versão da seção.
 * `fn` pode devolver uma recusa (nada grava).
 */
export async function mudarObraPrivada(
  card: number, por: string, secao: SecaoObra | null, versaoLida: number | null,
  fn: (p: ObraPrivada) => ObraPrivada | Recusa,
): Promise<ObraPrivada | Recusa> {
  return comTrava(`obra:${card}`, por, async () => {
    const lido = await lerJsonBruto(caminhoObraPrivada(card));
    const atual = lido === null ? obraPrivadaVazia() : normalizarObraPrivada(lido);
    if (secao && versaoLida !== null && atual.versoes[secao] !== versaoLida) {
      return { recusa: 'mudou', http: 409, extra: { mudou: true, error: 'Outra pessoa mexeu nesta parte agora. A tela vai recarregar.' } } as Recusa;
    }
    const novo = fn(atual);
    if (ehRecusa(novo)) return novo;
    const n = normalizarObraPrivada(novo);
    if (secao) n.versoes[secao] = atual.versoes[secao] + 1;
    await gravarJsonBruto(caminhoObraPrivada(card), n);
    return n;
  });
}

// ── O registro global das notas (`fin_nf:<card>:<id>`) ─────────────────────────────────────────────────────────────────

export const PREFIXO_NF = 'fin_nf:';
export interface RegistroNota { v: 1; card_id: number; id: string; compra_id: string; sha256: string; chave: string | null; livre: boolean; em: string; por: string }

export function normalizarRegistroNota(card: number, value: unknown): RegistroNota | null {
  const o = obj(value);
  if (!o || o.v !== 1 || o.card_id !== card || typeof o.id !== 'string' || !/^nf-[A-Za-z0-9-]{3,40}$/.test(o.id)) return null;
  const sha = typeof o.sha256 === 'string' && /^[0-9a-f]{64}$/.test(o.sha256) ? o.sha256 : '';
  const em = dataIso(o.em);
  const compra = idCurto(o.compra_id);
  if (!sha || !em || !compra) return null;
  return {
    v: 1, card_id: card, id: o.id, compra_id: compra, sha256: sha,
    chave: typeof o.chave === 'string' && /^\d{44}$/.test(o.chave) ? o.chave : null, livre: o.livre === true, em, por: nome(o.por),
  };
}
export function assinarRegistroNota(card: number, r: RegistroNota): string | null {
  const segredo = segredoDoVinculo();
  const n = normalizarRegistroNota(card, r);
  if (!segredo || !n) return null;
  return crypto.createHmac('sha256', segredo).update(`fin_nf|${card}|${n.id}|${JSON.stringify(n)}`).digest('hex');
}
export function registroNotaAssinado(card: number, value: unknown): RegistroNota | null {
  const n = normalizarRegistroNota(card, value);
  const sig = obj(value)?.sig;
  const esperada = n ? assinarRegistroNota(card, n) : null;
  return n && esperada && typeof sig === 'string' && sig.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8')) ? n : null;
}

/** Grava o registro (INSERT). false = a chave já existe. */
export async function gravarRegistroNota(card: number, r: Omit<RegistroNota, 'v' | 'card_id'>): Promise<boolean> {
  const n = normalizarRegistroNota(card, { v: 1, card_id: card, ...r });
  const sig = n ? assinarRegistroNota(card, n) : null;
  if (!n || !sig) throw new ErroJornada('sem_segredo');
  const { error } = await supabase.from('system_state').insert({ key: `${PREFIXO_NF}${card}:${n.id}`, value: { ...n, sig }, updated_at: new Date().toISOString() });
  if (!error) return true;
  if (codigoDe(error) === '23505') return false;
  throw new ErroJornada(codigoDe(error));
}

/** A nota anterior vira `livre` (trocada na mesma compra): relê, reassina e grava com a trava do `updated_at`. */
export async function liberarRegistroNota(card: number, id: string): Promise<boolean> {
  const chave = `${PREFIXO_NF}${card}:${id}`;
  const { data, error } = await supabase.from('system_state').select('key, value, updated_at').eq('key', chave).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  const l = data as { value?: unknown; updated_at?: string | null } | null;
  const atual = l ? registroNotaAssinado(card, l.value) : null;
  if (!l || !atual) return false;
  const novo = { ...atual, livre: true };
  const sig = assinarRegistroNota(card, novo);
  if (!sig) throw new ErroJornada('sem_segredo');
  const alvo = supabase.from('system_state').update({ value: { ...novo, sig }, updated_at: new Date().toISOString() }).eq('key', chave);
  const r = await (l.updated_at ? alvo.eq('updated_at', l.updated_at) : alvo.is('updated_at', null)).select('key');
  if (r.error) throw new ErroJornada(codigoDe(r.error));
  return Array.isArray(r.data) && r.data.length > 0;
}

/**
 * Uma nota VIVA (`livre` não é true) com o mesmo sha256 ou a mesma chave de 44 dígitos (só a que passou no DV). Varredura leve de `fin_nf:%`
 * (só `key`, sha, chave, livre e card); as que batem têm a assinatura conferida lendo a linha inteira. No LIKE o `_` é curinga, então o
 * `startsWith` descarta o excesso.
 */
export async function buscarNotaViva(sha: string, chave: string | null): Promise<{ card: number; id: string; compra_id: string } | null> {
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await supabase.from('system_state')
      .select('key, sha:value->>sha256, chave:value->>chave, livre:value->>livre, card:value->>card_id')
      .like('key', `${PREFIXO_NF}%`).order('key', { ascending: true }).range(de, de + 999);
    if (error) throw new ErroJornada(codigoDe(error));
    const lote = (data ?? []) as unknown as Array<{ key: string; sha: string | null; chave: string | null; livre: string | null; card: string | null }>;
    for (const l of lote) {
      if (!String(l.key).startsWith(PREFIXO_NF) || l.livre === 'true') continue;
      if (!(l.sha === sha || (chave && l.chave === chave))) continue;
      const card = Number(l.card);
      if (!Number.isInteger(card) || card <= 0) continue;
      const cheia = await supabase.from('system_state').select('key, value').eq('key', l.key).maybeSingle();
      if (cheia.error) throw new ErroJornada(codigoDe(cheia.error));
      const linhaCheia = cheia.data as { value?: unknown } | null;
      if (!linhaCheia) continue;   // a linha sumiu entre a varredura e a leitura
      const reg = registroNotaAssinado(card, linhaCheia.value);
      if (reg && !reg.livre) return { card, id: reg.id, compra_id: reg.compra_id };
      // Assinatura que não confere: o registro existe e não se prova livre. Conta como nota viva (nunca como livre).
      if (!reg) return { card, id: String(l.key).split(':').slice(2).join(':'), compra_id: '' };
    }
    if (lote.length < 1000) break;
  }
  return null;
}

// ── A reserva da chave de 44 dígitos (`nfe_chave:<chave>`) ─────────────────────────────────────────────────────────────

export const PREFIXO_RESERVA_NFE = 'nfe_chave:';
export interface ReservaNfe { v: 1; chave: string; card_id: number; compra_id: string; nf_id: string; em: string }

export function normalizarReservaNfe(chave: string, value: unknown): ReservaNfe | null {
  const o = obj(value);
  if (!o || o.v !== 1 || o.chave !== chave || !chaveNfeValida(chave)) return null;
  if (typeof o.card_id !== 'number' || !Number.isInteger(o.card_id) || o.card_id <= 0) return null;
  if (typeof o.nf_id !== 'string' || !/^nf-[A-Za-z0-9-]{3,40}$/.test(o.nf_id)) return null;
  const compra = idCurto(o.compra_id);
  const em = dataIso(o.em);
  if (!compra || !em) return null;
  return { v: 1, chave, card_id: o.card_id, compra_id: compra, nf_id: o.nf_id, em };
}
export function assinarReservaNfe(r: ReservaNfe): string | null {
  const segredo = segredoDoVinculo();
  const n = normalizarReservaNfe(r.chave, r);
  if (!segredo || !n) return null;
  return crypto.createHmac('sha256', segredo).update(`nfe_chave|${n.chave}|${JSON.stringify(n)}`).digest('hex');
}
export function reservaNfeAssinada(chave: string, value: unknown): ReservaNfe | null {
  const n = normalizarReservaNfe(chave, value);
  const sig = obj(value)?.sig;
  const esperada = n ? assinarReservaNfe(n) : null;
  return n && esperada && typeof sig === 'string' && sig.length === esperada.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(esperada, 'utf8')) ? n : null;
}

/** Lê um registro de nota pelo card e pelo id (`null` se sumiu ou se a assinatura não confere). */
export async function lerRegistroNota(card: number, id: string): Promise<RegistroNota | null> {
  const { data, error } = await supabase.from('system_state').select('key, value').eq('key', `${PREFIXO_NF}${card}:${id}`).maybeSingle();
  if (error) throw new ErroJornada(codigoDe(error));
  const l = data as { value?: unknown } | null;
  return l ? registroNotaAssinado(card, l.value) : null;
}

export type ResultadoReserva = { ok: true } | { ok: false; dono: { card: number; id: string; compra_id: string } } | { ok: false; reservada: true } | { ok: false; corrida: true };

/**
 * Reserva a chave por INSERT (o 23505 diz que já tem dono). A reserva existente só é TOMADA (UPDATE com a trava do `updated_at`) se o
 * registro dono está livre, sumiu, a assinatura não confere ou ela é da MESMA obra e da mesma compra.
 */
export async function reservarChaveNfe(chave: string, dono: { card: number; compra_id: string; nf_id: string }): Promise<ResultadoReserva> {
  const k = `${PREFIXO_RESERVA_NFE}${chave}`;
  for (let t = 0; t < 3; t++) {
    const agora = new Date().toISOString();
    const r = normalizarReservaNfe(chave, { v: 1, chave, card_id: dono.card, compra_id: dono.compra_id, nf_id: dono.nf_id, em: agora });
    const sig = r ? assinarReservaNfe(r) : null;
    if (!r || !sig) throw new ErroJornada('sem_segredo');
    const ins = await supabase.from('system_state').insert({ key: k, value: { ...r, sig }, updated_at: agora });
    if (!ins.error) return { ok: true };
    if (codigoDe(ins.error) !== '23505') throw new ErroJornada(codigoDe(ins.error));
    const { data, error } = await supabase.from('system_state').select('key, value, updated_at').eq('key', k).maybeSingle();
    if (error) throw new ErroJornada(codigoDe(error));
    const linha = data as { value?: unknown; updated_at?: string | null } | null;
    if (!linha) continue;
    const atual = reservaNfeAssinada(chave, linha.value);
    // Assinatura que não confere: a reserva NÃO é tomada (só o Thiago libera). Quem forja ou quem perdeu o segredo não abre a porta.
    if (!atual) return { ok: false, reservada: true };
    if (!(atual.card_id === dono.card && atual.compra_id === dono.compra_id)) {
      const reg = await lerRegistroNota(atual.card_id, atual.nf_id);
      if (reg && !reg.livre) return { ok: false, dono: { card: atual.card_id, id: atual.nf_id, compra_id: atual.compra_id } };
    }
    // Dono livre, registro dono sumido ou a mesma compra: toma a reserva, com a trava do updated_at.
    const alvo = supabase.from('system_state').update({ value: { ...r, sig }, updated_at: agora }).eq('key', k);
    const up = await (linha.updated_at ? alvo.eq('updated_at', linha.updated_at) : alvo.is('updated_at', null)).select('key');
    if (up.error) throw new ErroJornada(codigoDe(up.error));
    if (Array.isArray(up.data) && up.data.length > 0) return { ok: true };
  }
  return { ok: false, corrida: true };
}
