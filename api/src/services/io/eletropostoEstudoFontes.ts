// ─────────────────────────────────────────────────────────────────────────────
// ESTUDO DO LOCAL, as fontes de fora.
//
// Google Maps (achar o local, entorno, carregadores, rua e satélite), IBGE
// (população e PIB per capita), a frota do SENATRAN, o histórico da agenda e a IA.
// Cada função devolve { ok, dado, status, http, ms, custo_usd } e NUNCA lança:
// fonte fora do ar vira bloco "não consultado agora" no estudo, não estudo perdido.
//
// ── A chave do Google ──
// GOOGLE_MAPS_API_KEY é lida dentro de cada chamada e só existe no header ou na
// query da requisição. Não entra em log, em status, no objeto devolvido nem no
// HTML. O corpo de erro do Google também não é repassado.
//
// ── Custo (tabela da Places API New, set/2026) ──
// Text Search Pro e Nearby Search Pro US$ 0,032 cada, 5.000 grátis por mês;
// Static Maps US$ 0,002 e Street View US$ 0,007, 10.000 grátis; metadata grátis.
// Um estudo gasta cerca de US$ 0,10 de Google e US$ 0,02 de IA.
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '../../utils/logger';
import { supabaseGerador } from '../../utils/supabaseGerador';
import { novoAnthropic } from '../../utils/anthropicClient';
import frotaJson from '../../data/frotaPluginMunicipio.json';
import { chaveMunicipio, normalizarCidade } from './cidadeParse';
import {
  extrairEndereco, normalizarEndereco, textosDeModelo, validarTextoIA,
  type Coord, type EnderecoDigitado, type FatosIA, type ItemHistorico, type LugarGoogle, type TextosIA,
} from './eletropostoEstudoPuro';

export type StatusFonte = 'ok' | 'zero_resultados' | 'timeout' | 'sem_chave' | 'pulado' | 'rede' | `erro:${string}`;

export interface Resultado<T> {
  ok: boolean;
  dado: T | null;
  status: StatusFonte;
  http: number | null;
  ms: number;
  custo_usd: number;
  /** O motivo que o Google deu para recusar (ex.: BILLING_DISABLED), já sem chave nem URL. */
  motivo?: string;
}

export const CUSTO_USD = {
  searchText: 0.032,
  nearby: 0.032,
  staticmap: 0.002,
  streetview: 0.007,
} as const;

const chaveGoogle = (): string => (process.env.GOOGLE_MAPS_API_KEY || '').trim();

function resultado<T>(dado: T | null, status: StatusFonte, http: number | null, t0: number, custo = 0): Resultado<T> {
  return { ok: status === 'ok' || status === 'zero_resultados', dado, status, http, ms: Date.now() - t0, custo_usd: custo };
}

/**
 * fetch com prazo. Um retry só, e só em 429 ou 5xx: rede caída e 4xx não melhoram
 * na segunda tentativa, e o tick tem orçamento de tempo.
 */
async function pedir(
  url: string, init: RequestInit, prazoMs: number, retry: boolean,
): Promise<{ res: Response | null; http: number | null; status: StatusFonte }> {
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), prazoMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (retry && tentativa === 0 && (res.status === 429 || res.status >= 500)) {
        await res.arrayBuffer().catch(() => undefined);
        continue;
      }
      return { res, http: res.status, status: res.ok ? 'ok' : `erro:${res.status}` };
    } catch (e) {
      const abortou = ctrl.signal.aborted || (e as { name?: string })?.name === 'AbortError';
      return { res: null, http: null, status: abortou ? 'timeout' : 'rede' };
    } finally {
      clearTimeout(timer);
    }
  }
  return { res: null, http: null, status: 'rede' };
}

async function lerJson<T>(res: Response): Promise<T | null> {
  try { return (await res.json()) as T; } catch { return null; }
}

const descartar = async (res: Response | null) => { await res?.arrayBuffer().catch(() => undefined); };

/** Tira do texto qualquer coisa que pareça chave ou URL. O motivo vai para log público. */
export function limparMotivo(texto: string): string {
  let t = String(texto || '');
  const chave = chaveGoogle();
  if (chave) t = t.split(chave).join('[chave]');
  return t
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[chave]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Por que o Google recusou. Places (New) responde { error: { status, details: [{ reason }] } };
 * os serviços web antigos respondem { status, error_message } ou texto puro.
 */
async function motivoDoErro(res: Response | null): Promise<string | undefined> {
  if (!res) return undefined;
  try {
    const bruto = (await res.text()).slice(0, 4000);
    try {
      const j = JSON.parse(bruto) as {
        error?: { status?: string; message?: string; details?: Array<{ reason?: string }> };
        status?: string; error_message?: string;
      };
      const razao = j.error?.details?.find(d => d.reason)?.reason;
      const partes = [j.error?.status, razao, j.error?.message, j.status, j.error_message].filter(Boolean);
      if (partes.length) return limparMotivo(partes.join(' · '));
    } catch { /* não é JSON */ }
    return limparMotivo(bruto) || undefined;
  } catch {
    return undefined;
  }
}

// ── Google Maps ────────────────────────────────────────────────────────────

// Sem rating, telefone ou site: são SKUs mais caros e o estudo não usa.
export const MASCARA_LOCAL = 'places.id,places.location,places.formattedAddress,places.addressComponents,places.types,places.primaryType,places.displayName,places.businessStatus';
export const MASCARA_PROXIMOS = 'places.id,places.displayName,places.location,places.primaryType,places.types,places.businessStatus';

const headersPlaces = (chave: string, mascara: string) => ({
  'Content-Type': 'application/json',
  'X-Goog-Api-Key': chave,
  'X-Goog-FieldMask': mascara,
});

export async function buscarLocal(texto: string, vies?: Coord | null): Promise<Resultado<LugarGoogle[]>> {
  const t0 = Date.now();
  const chave = chaveGoogle();
  if (!chave) return resultado<LugarGoogle[]>(null, 'sem_chave', null, t0);

  const corpo: Record<string, unknown> = { textQuery: texto, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 3 };
  if (vies) corpo.locationBias = { circle: { center: { latitude: vies.lat, longitude: vies.lng }, radius: 30000 } };

  const r = await pedir('https://places.googleapis.com/v1/places:searchText',
    { method: 'POST', headers: headersPlaces(chave, MASCARA_LOCAL), body: JSON.stringify(corpo) }, 8000, true);
  const custo = r.http === 200 ? CUSTO_USD.searchText : 0;
  if (!r.res || !r.res.ok) {
    return { ...resultado<LugarGoogle[]>(null, r.status, r.http, t0, custo), motivo: await motivoDoErro(r.res) };
  }

  const lugares = (await lerJson<{ places?: LugarGoogle[] }>(r.res))?.places ?? [];
  return resultado(lugares, lugares.length ? 'ok' : 'zero_resultados', r.http, t0, custo);
}

export async function buscarProximos(centro: Coord, tipos: string[], raioM: number): Promise<Resultado<LugarGoogle[]>> {
  const t0 = Date.now();
  const chave = chaveGoogle();
  if (!chave) return resultado<LugarGoogle[]>(null, 'sem_chave', null, t0);

  const corpo = {
    includedTypes: tipos,
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
    locationRestriction: { circle: { center: { latitude: centro.lat, longitude: centro.lng }, radius: raioM } },
    languageCode: 'pt-BR',
    regionCode: 'BR',
  };
  const r = await pedir('https://places.googleapis.com/v1/places:searchNearby',
    { method: 'POST', headers: headersPlaces(chave, MASCARA_PROXIMOS), body: JSON.stringify(corpo) }, 8000, true);
  const custo = r.http === 200 ? CUSTO_USD.nearby : 0;
  if (!r.res || !r.res.ok) {
    return { ...resultado<LugarGoogle[]>(null, r.status, r.http, t0, custo), motivo: await motivoDoErro(r.res) };
  }

  const lugares = (await lerJson<{ places?: LugarGoogle[] }>(r.res))?.places ?? [];
  return resultado(lugares, lugares.length ? 'ok' : 'zero_resultados', r.http, t0, custo);
}

export interface PanoramaRua { pano_id: string; data: string | null; lat: number | null; lng: number | null }

/** Metadata do Street View: grátis, e diz se existe foto antes de gastar com ela. */
export async function streetViewMeta(centro: Coord): Promise<Resultado<PanoramaRua>> {
  const t0 = Date.now();
  const chave = chaveGoogle();
  if (!chave) return resultado<PanoramaRua>(null, 'sem_chave', null, t0);

  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${centro.lat},${centro.lng}`
    + `&radius=60&source=outdoor&key=${encodeURIComponent(chave)}`;
  const r = await pedir(url, { method: 'GET' }, 5000, false);
  if (!r.res || !r.res.ok) { await descartar(r.res); return resultado<PanoramaRua>(null, r.status, r.http, t0); }

  const j = await lerJson<{ status?: string; pano_id?: string; date?: string; location?: { lat: number; lng: number } }>(r.res);
  if (j?.status === 'OK' && j.pano_id) {
    return resultado({ pano_id: j.pano_id, data: j.date ?? null, lat: j.location?.lat ?? null, lng: j.location?.lng ?? null }, 'ok', r.http, t0);
  }
  if (j?.status === 'ZERO_RESULTS' || j?.status === 'NOT_FOUND') return resultado<PanoramaRua>(null, 'zero_resultados', r.http, t0);
  const falhou = resultado<PanoramaRua>(null, `erro:${j?.status || 'metadata'}`, r.http, t0);
  const motivo = limparMotivo([j?.status, (j as { error_message?: string } | null)?.error_message].filter(Boolean).join(' · '));
  return motivo ? { ...falhou, motivo } : falhou;
}

/** Uma imagem de 64 px prova que o Static Maps responde para esta chave. */
export async function provarStaticMap(centro: Coord): Promise<Resultado<boolean>> {
  const t0 = Date.now();
  const chave = chaveGoogle();
  if (!chave) return resultado<boolean>(null, 'sem_chave', null, t0);

  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${centro.lat},${centro.lng}`
    + `&zoom=19&size=64x64&maptype=satellite&key=${encodeURIComponent(chave)}`;
  const r = await pedir(url, { method: 'GET' }, 5000, false);
  const tipo = r.res?.headers.get('content-type') || '';
  if (!r.res || !r.res.ok) {
    return { ...resultado<boolean>(null, r.status, r.http, t0), motivo: await motivoDoErro(r.res) };
  }
  await descartar(r.res);
  if (!tipo.startsWith('image/')) return resultado<boolean>(null, 'erro:nao_imagem', r.http, t0, CUSTO_USD.staticmap);
  return resultado(true, 'ok', r.http, t0, CUSTO_USD.staticmap);
}

export interface Imagem { corpo: Buffer; tipo: string }

async function baixarImagem(url: string, custo: number): Promise<Resultado<Imagem>> {
  const t0 = Date.now();
  const r = await pedir(url, { method: 'GET' }, 8000, false);
  const tipo = r.res?.headers.get('content-type') || '';
  if (!r.res || !r.res.ok || !tipo.startsWith('image/')) {
    await descartar(r.res);
    return resultado<Imagem>(null, r.res && r.res.ok ? 'erro:nao_imagem' : r.status, r.http, t0);
  }
  const corpo = Buffer.from(await r.res.arrayBuffer());
  return resultado({ corpo, tipo }, 'ok', r.http, t0, custo);
}

/** Foto da rua para o proxy da página. Nunca guardada: sai do Google e vai para o navegador. */
export async function imagemRua(panoId: string, heading: number): Promise<Resultado<Imagem>> {
  const chave = chaveGoogle();
  if (!chave) return resultado<Imagem>(null, 'sem_chave', null, Date.now());
  return baixarImagem(
    `https://maps.googleapis.com/maps/api/streetview?size=640x400&pano=${encodeURIComponent(panoId)}`
    + `&heading=${Math.round(heading)}&fov=80&pitch=0&return_error_code=true&key=${encodeURIComponent(chave)}`,
    CUSTO_USD.streetview,
  );
}

export async function imagemSatelite(centro: Coord): Promise<Resultado<Imagem>> {
  const chave = chaveGoogle();
  if (!chave) return resultado<Imagem>(null, 'sem_chave', null, Date.now());
  return baixarImagem(
    `https://maps.googleapis.com/maps/api/staticmap?center=${centro.lat},${centro.lng}&zoom=19&size=640x400&scale=2`
    + `&maptype=satellite&markers=color:red%7C${centro.lat},${centro.lng}&key=${encodeURIComponent(chave)}`,
    CUSTO_USD.staticmap,
  );
}

// ── IBGE ───────────────────────────────────────────────────────────────────

export interface ValorAno { valor: number; ano: string }

function ultimoAno(serie: Record<string, string | null> | undefined): ValorAno | null {
  const anos = Object.entries(serie || {})
    .filter(([, v]) => v != null && v !== '' && Number.isFinite(Number(v)))
    .sort(([a], [b]) => a.localeCompare(b));
  const u = anos[anos.length - 1];
  return u ? { valor: Number(u[1]), ano: u[0] } : null;
}

/** Estimativa de população (agregado 6579). Período -1 = o mais recente publicado. */
export async function ibgePopulacao(ibge: number): Promise<Resultado<ValorAno>> {
  const t0 = Date.now();
  const r = await pedir(
    `https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6%5B${ibge}%5D`,
    { method: 'GET' }, 5000, false);
  if (!r.res || !r.res.ok) { await descartar(r.res); return resultado<ValorAno>(null, r.status, r.http, t0); }
  type Resp = Array<{ resultados?: Array<{ series?: Array<{ serie?: Record<string, string | null> }> }> }>;
  const v = ultimoAno((await lerJson<Resp>(r.res))?.[0]?.resultados?.[0]?.series?.[0]?.serie);
  return v ? resultado(v, 'ok', r.http, t0) : resultado<ValorAno>(null, 'zero_resultados', r.http, t0);
}

/** PIB per capita (indicador 47001). A resposta traz a localidade com 6 dígitos. */
export async function ibgePibPerCapita(ibge: number): Promise<Resultado<ValorAno>> {
  const t0 = Date.now();
  const r = await pedir(
    `https://servicodados.ibge.gov.br/api/v1/pesquisas/indicadores/47001/resultados/${ibge}`,
    { method: 'GET' }, 5000, false);
  if (!r.res || !r.res.ok) { await descartar(r.res); return resultado<ValorAno>(null, r.status, r.http, t0); }
  type Resp = Array<{ res?: Array<{ res?: Record<string, string | null> }> }>;
  const v = ultimoAno((await lerJson<Resp>(r.res))?.[0]?.res?.[0]?.res);
  return v ? resultado(v, 'ok', r.http, t0) : resultado<ValorAno>(null, 'zero_resultados', r.http, t0);
}

// ── Frota (SENATRAN, arquivo local) ────────────────────────────────────────

interface FrotaArquivo {
  ref: string;
  brasil_com_uf: { frota: number; plugin: number };
  uf: Record<string, { frota: number; plugin: number }>;
  municipios: Record<string, number[]>;
}
const FROTA = frotaJson as unknown as FrotaArquivo;

export interface FrotaMunicipio {
  frota: number; plugin: number; por_mil: number;
  uf_por_mil: number | null; br_por_mil: number;
  plugin_br: number; frota_br: number; ref: string;
}

const porMil = (plugin: number, frota: number) => (frota > 0 ? Math.round((plugin / frota) * 10000) / 10 : 0);

export function frotaDoMunicipio(ibge: number, uf: string): FrotaMunicipio | null {
  const m = FROTA.municipios[String(ibge)];
  if (!m || m.length < 2) return null;
  const u = FROTA.uf[uf];
  return {
    frota: m[0],
    plugin: m[1],
    por_mil: porMil(m[1], m[0]),
    uf_por_mil: u ? porMil(u.plugin, u.frota) : null,
    br_por_mil: porMil(FROTA.brasil_com_uf.plugin, FROTA.brasil_com_uf.frota),
    // A adoção compara com o Brasil que tem UF: é a mesma base dos municípios.
    plugin_br: FROTA.brasil_com_uf.plugin,
    frota_br: FROTA.brasil_com_uf.frota,
    ref: FROTA.ref,
  };
}

// ── Histórico da agenda ────────────────────────────────────────────────────

const ultimos8 = (t: string | null | undefined) => String(t || '').replace(/\D/g, '').slice(-8);

/**
 * Outras fichas de eletroposto com a mesma rua e número na mesma cidade, ou o mesmo
 * telefone. O banco filtra largo (rua como a pessoa digitou, final do telefone) e o
 * código confere endereço normalizado, então acento diferente não vira duplicado falso.
 */
export async function historicoDoEndereco(o: {
  endereco: EnderecoDigitado; telefone: string | null; excluirId: number;
}): Promise<Resultado<ItemHistorico[]>> {
  const t0 = Date.now();
  const alvo = normalizarEndereco(o.endereco);
  const cidadeAlvo = chaveMunicipio(normalizarCidade(o.endereco.cidade).cidade || '');
  const tel = ultimos8(o.telefone);
  const rua = o.endereco.rua.replace(/[%_\\]/g, ' ').replace(/\s+/g, ' ').trim();

  const colunas = 'id, quando, status, vendedor_nome, observacao, cliente_telefone';
  const vazio = Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null });
  try {
    const [porRua, porTel] = await Promise.all([
      rua.length >= 4
        ? supabaseGerador.from('agendamentos').select(colunas)
            .ilike('created_by', '%eletroposto%').neq('id', o.excluirId).ilike('observacao', `%${rua}%`)
            .order('quando', { ascending: false }).limit(20)
        : vazio,
      tel.length === 8
        ? supabaseGerador.from('agendamentos').select(colunas)
            .ilike('created_by', '%eletroposto%').neq('id', o.excluirId).ilike('cliente_telefone', `%${tel}`)
            .order('quando', { ascending: false }).limit(20)
        : vazio,
    ]);
    if (porRua.error || porTel.error) return resultado<ItemHistorico[]>(null, 'erro:db', null, t0);

    const vistos = new Set<number>();
    const itens: ItemHistorico[] = [];
    for (const row of [...(porRua.data || []), ...(porTel.data || [])] as Array<Record<string, unknown>>) {
      const id = Number(row.id);
      if (vistos.has(id) || id === o.excluirId) continue;
      const e = extrairEndereco(String(row.observacao || ''));
      const mesmoEndereco = !!e && normalizarEndereco(e) === alvo
        && (!cidadeAlvo || chaveMunicipio(normalizarCidade(e.cidade).cidade || '') === cidadeAlvo);
      const mesmoTelefone = tel.length === 8 && ultimos8(String(row.cliente_telefone || '')) === tel;
      if (!mesmoEndereco && !mesmoTelefone) continue;
      vistos.add(id);
      itens.push({ id, quando: (row.quando as string) || null, status: String(row.status || ''), consultor: String(row.vendedor_nome || '') });
    }
    itens.sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || '')));
    return resultado(itens, itens.length ? 'ok' : 'zero_resultados', null, t0);
  } catch (e) {
    logger.warn('ep-estudo', 'histórico do endereço falhou', String((e as Error)?.message || e).slice(0, 200));
    return resultado<ItemHistorico[]>(null, 'erro:db', null, t0);
  }
}

// ── IA ─────────────────────────────────────────────────────────────────────

export const MODELO_IA = 'claude-sonnet-4-6';

const FERRAMENTA = {
  name: 'escrever_estudo',
  description: 'Escreve o texto do estudo do local a partir dos fatos medidos.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    required: ['resumo', 'leitura_do_entorno', 'perguntas', 'cuidados', 'modelo_sugerido', 'porque_modelo'],
    properties: {
      resumo: { type: 'string', maxLength: 600 },
      leitura_do_entorno: { type: 'string', maxLength: 600 },
      perguntas: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string', maxLength: 200 } },
      cuidados: { type: 'array', maxItems: 3, items: { type: 'string', maxLength: 240 } },
      modelo_sugerido: { type: 'string', enum: ['01', '02', '03', '04', '05'] },
      porque_modelo: { type: 'string', maxLength: 400 },
    },
  },
};

const SISTEMA = [
  'Você escreve o texto de um estudo interno para o consultor da NEXUS Eletropostos, que vai conversar com o dono de um possível ponto de recarga de carro elétrico.',
  'Use só os fatos do JSON. Escreva em português do Brasil, frases curtas, cada frase começando com letra maiúscula.',
  'Proibido escrever: valor em reais, porcentagem, payback, TIR, VPL, ROI, lucro, faturamento ou quantidade de recargas por dia; qualquer número que não esteja no JSON; nome de lugar ou carregador que não esteja no JSON; fluxo ou volume de carros; promessa de aprovação, financiamento ou prazo; juízo sobre a pessoa; recomendação de cancelar, desmarcar ou priorizar outra reunião; travessão.',
  'A pré-nota, o índice e a situação já vêm prontos e não podem ser contraditos.',
  'As perguntas servem para abrir a reunião e se ligam aos sinais. Os cuidados são o que o consultor precisa confirmar.',
  'Modelos NEXUS: 01 o dono cede o espaço e a NEXUS investe 100%; 02 sociedade meio a meio; 03 chave na mão, o eletroposto é do cliente; 04 só o equipamento; 05 consultoria completa.',
].join('\n');

/** Sonnet 4.6: US$ 3 por milhão de tokens de entrada e US$ 15 de saída. */
const custoIA = (u?: { input_tokens?: number; output_tokens?: number } | null) =>
  Math.round((((u?.input_tokens || 0) * 3 + (u?.output_tokens || 0) * 15) / 1e6) * 10000) / 10000;

export async function escreverTextos(fatos: FatosIA): Promise<{
  ia: TextosIA & { origem: 'ia' | 'modelo'; reprovados: string[] }; status: StatusFonte; custo_usd: number; ms: number;
}> {
  const t0 = Date.now();
  try {
    const r = await novoAnthropic().messages.create({
      model: MODELO_IA,
      max_tokens: 1500,
      system: SISTEMA,
      messages: [{ role: 'user', content: `Fatos do local, em JSON:\n${JSON.stringify(fatos)}` }],
      tools: [FERRAMENTA],
      tool_choice: { type: 'tool', name: 'escrever_estudo' },
    }, { timeout: 30000 });
    const uso = r.content.find(c => c.type === 'tool_use');
    const entrada = uso && uso.type === 'tool_use' ? uso.input : null;
    return {
      ia: validarTextoIA(entrada, fatos),
      status: entrada ? 'ok' : 'zero_resultados',
      custo_usd: custoIA(r.usage),
      ms: Date.now() - t0,
    };
  } catch (e) {
    logger.warn('ep-estudo', 'IA não escreveu o estudo, vai o texto padrão', String((e as Error)?.message || e).slice(0, 200));
    return { ia: { ...textosDeModelo(fatos), origem: 'modelo', reprovados: [] }, status: 'erro:ia', custo_usd: 0, ms: Date.now() - t0 };
  }
}

// ── Sonda ──────────────────────────────────────────────────────────────────

export interface LinhaSonda { api: string; http: number | null; status: StatusFonte; ms: number; motivo?: string }

/**
 * Uma chamada de cada fonte num endereço público (Praça Tubal Vilela, Uberlândia),
 * para ver de fora se a chave tem as APIs habilitadas. Custa uns US$ 0,07.
 */
export async function sondarFontes(): Promise<Record<string, LinhaSonda>> {
  const centro = { lat: -18.9186, lng: -48.2772 };
  const [texto, nearby, sv, estatico, pop, pib] = await Promise.all([
    buscarLocal('Praça Tubal Vilela, Centro, Uberlândia - MG, Brasil', centro),
    buscarProximos(centro, ['electric_vehicle_charging_station'], 2000),
    streetViewMeta(centro),
    provarStaticMap(centro),
    ibgePopulacao(3170206),
    ibgePibPerCapita(3170206),
  ]);
  const linha = (api: string, r: Resultado<unknown>): LinhaSonda =>
    ({ api, http: r.http, status: r.status, ms: r.ms, ...(r.motivo ? { motivo: r.motivo } : {}) });
  return {
    searchText: linha('places:searchText', texto),
    nearby: linha('places:searchNearby', nearby),
    svMeta: linha('streetview/metadata', sv),
    staticmap: linha('staticmap', estatico),
    ibgePop: linha('ibge agregado 6579', pop),
    ibgePib: linha('ibge indicador 47001', pib),
  };
}
