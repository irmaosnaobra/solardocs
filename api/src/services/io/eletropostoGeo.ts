// ─────────────────────────────────────────────────────────────────────────────
// ONDE FICA O LOCAL — endereço → coordenada, para o mapa do Arrendamento.
//
// Pedido do Thiago (08/10/2026): ver no mapa, dentro do /gerador, todo mundo
// que pode ceder um local, clicar no pino e ler tudo daquele endereço.
//
// ENTRA SÓ O ENDEREÇO, SAI SÓ A COORDENADA. Nome e telefone nunca passam por
// aqui: a aba já tem a lista e junta localmente, do mesmo jeito que faz com os
// pares. Do telefone vem só o DDD, que desempata cidade de nome repetido.
//
// A PRECISÃO VAI JUNTO, SEMPRE. Pino no centro da cidade com cara de pino no
// número é o pior erro possível aqui: a equipe dirige até o lugar errado. Então
// cada ponto diz onde caiu (número, CEP, rua, bairro ou cidade) e a tela mostra.
//
// O QUE FOI APRENDIDO GEOCODIFICANDO A BASE INTEIRA (228 endereços, 08/10):
//   · ficha de antes de 10/09 separa o endereço com travessão, não ponto médio;
//   · CEP terminado em 000 é o CEP da cidade inteira, não aponta rua nenhuma;
//   · o Nominatim devolve rua de mesmo nome em OUTRO estado sem pestanejar, então
//     só vale resultado com UF e cidade batendo;
//   · cidade sem UF e com nome repetido no país: o DDD desempata;
//   · o centro do IBGE é o centro do RETÂNGULO do município, e em município
//     gigante (Porto Velho, Marabá) ele cai a 80-100 km da cidade. Por isso o
//     pino "na cidade" usa a sede achada no Nominatim e só cai no IBGE sem ela;
//   · "Quadra 12 Lote 3" em busca livre acha qualquer quadra 12 da cidade.
//
// O IP É COMPARTILHADO. O Nominatim pede no máximo 1 requisição por segundo, e
// throttle aqui derruba junto o raio da prospecção (ver geoCidade.ts). Por isso
// a fila é uma só no processo, com folga de 1,1 s, e cada chamada geocodifica
// no máximo um punhado de endereços novos: o resto volta como `pendentes` e a
// tela chama de novo. O que já foi achado fica no system_state e não sai mais
// do processo.
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { supabase } from '../../utils/supabase';
import { logger } from '../../utils/logger';
import { resolverCidade } from './geoCidade';
import { normalizarCidade, chaveMunicipio, semAcento } from './cidadeParse';

const LOG = 'eletroposto-geo';

/** Distância em km SEM arredondar: o distanciaKm do geoCidade arredonda pro km
 *  inteiro, e aqui as réguas são de 2 e 15 km. */
export function kmEntre(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (g: number) => (g * Math.PI) / 180;
  const s = Math.sin(rad(b.lat - a.lat) / 2) ** 2
          + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export type Precisao = 'numero' | 'cep' | 'rua' | 'bairro' | 'cidade';
export interface Ponto { lat: number; lng: number; precisao: Precisao; municipio: string; uf: string }
export interface Municipio { municipio: string; uf: string; lat: number; lng: number }

export const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
  SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

const DDD_UF: Record<string, string> = {};
for (const [uf, ds] of Object.entries({
  SP: '11 12 13 14 15 16 17 18 19', RJ: '21 22 24', ES: '27 28', MG: '31 32 33 34 35 37 38',
  PR: '41 42 43 44 45 46', SC: '47 48 49', RS: '51 53 54 55', DF: '61', GO: '62 64', TO: '63',
  MT: '65 66', MS: '67', AC: '68', RO: '69', BA: '71 73 74 75 77', SE: '79', PE: '81 87', AL: '82',
  PB: '83', RN: '84', CE: '85 88', PI: '86 89', PA: '91 93 94', AM: '92 97', RR: '95', AP: '96', MA: '98 99',
})) for (const d of ds.split(' ')) DDD_UF[d] = uf;

/** "34" → "MG". Qualquer outra coisa → null. */
export function ufDoDdd(ddd: unknown): string | null {
  const d = String(ddd ?? '').replace(/\D/g, '');
  return d.length === 2 ? DDD_UF[d] || null : null;
}

// ── O endereço em partes ────────────────────────────────────────────────────

export interface EnderecoPartido {
  texto: string;
  /** "Rua das Flores, 120" */
  rua: string;
  /** "Rua das Flores" */
  ruaSemNum: string;
  numero: string | null;
  bairro: string | null;
  /** A parte que é a cidade ("Araguari-MG"), quando deu pra achar. */
  cidade: string | null;
  cep: string | null;
  /** Achou a cidade no meio das partes: dá pra usar a busca por campos. */
  estruturado: boolean;
}

/**
 * "Rua X, 99 · Bairro · Cidade-UF · CEP 99999-999", que é o formato da LP.
 * Fichas de antes de 10/09 separam com travessão. A cidade às vezes vem sem
 * UF: aí quem a acha no meio das partes é o município já resolvido.
 */
export function partirEndereco(texto: unknown, municipio?: string | null): EnderecoPartido | null {
  const s = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const cepM = s.match(/CEP\s*:?\s*(\d{5})-?(\d{3})\b/i) || s.match(/\b(\d{5})-(\d{3})\b/);
  const partes = s.split(/\s*[·—]\s*/).map(x => x.trim()).filter(x => x && !/^(cep|obs)\b/i.test(x));
  let iCid = partes.findIndex((x, i) => i > 0 && /^[^\d]+?\s*[-/,]\s*[A-Za-z]{2}$/.test(x));
  if (iCid < 0 && municipio) {
    const alvo = chaveMunicipio(municipio);
    iCid = partes.findIndex((x, i) => i > 0 && chaveMunicipio(normalizarCidade(x).cidade || '') === alvo);
  }
  const rua = partes[0] || '';
  const numM = rua.match(/,\s*(\d+[A-Za-z]?)\b/);
  return {
    texto: s,
    rua,
    ruaSemNum: rua.replace(/,\s*(\d+[A-Za-z]?|s\/?n).*$/i, '').trim(),
    numero: numM ? numM[1] : null,
    bairro: iCid > 1 ? partes.slice(1, iCid).join(', ') : null,
    cidade: iCid > 0 ? partes[iCid] : null,
    cep: cepM ? cepM[1] + cepM[2] : null,
    estruturado: iCid > 0,
  };
}

/** CEP terminado em 000 é o da cidade inteira: não aponta rua nenhuma. */
export const ehCepDaCidade = (cep: string) => /000$/.test(cep);

/** Tem um NOME de rua, e não só "Quadra 12 Lote 3"? Busca livre com isso acha
 *  qualquer quadra 12 da cidade e põe o pino com cara de certo no lugar errado. */
export function temNomeDeRua(rua: string): boolean {
  const sem = rua.replace(/\b(rua|r|avenida|av|quadra|qd|q|travessa|tv|rodovia|rod|alameda|estrada|lote|lt|conjunto|cj|setor|ch[aá]cara|km)\b\.?/gi, '');
  return /[A-Za-zÀ-ú]{4,}/.test(sem);
}

/**
 * De qual município é o endereço. Mesma regra do resolvedor offline (sem UF, só
 * nome único no país), com uma porta a mais: o DDD do telefone desempata nome
 * repetido. O DDD só é tentado na parte que É a cidade (a do "-UF" ou a última
 * antes do CEP) e no campo cidade, nunca no bairro, que pode ter nome de
 * município de outro lugar.
 */
export function resolverMunicipio(endereco: unknown, cidade: unknown, ddd: unknown): Municipio | null {
  const e = partirEndereco(endereco);
  const ok = (r: ReturnType<typeof resolverCidade>): Municipio | null =>
    r.status === 'ok' ? { municipio: r.municipio!, uf: r.uf!, lat: r.lat!, lng: r.lng! } : null;
  const direto = (e?.cidade ? ok(resolverCidade(e.cidade)) : null) || ok(resolverCidade(String(cidade ?? '')));
  if (direto) return direto;
  const uf = ufDoDdd(ddd);
  if (!uf) return null;
  const partes = e ? e.texto.split(/\s*[·—]\s*/).filter(x => x && !/^(cep|obs)\b/i.test(x)) : [];
  const candidatas = [e?.cidade, String(cidade ?? ''), partes.length > 1 ? partes[partes.length - 1] : null];
  for (const t of candidatas) {
    const c = normalizarCidade(t).cidade;
    if (!c) continue;
    const r = ok(resolverCidade(`${c}-${uf}`));
    if (r) return r;
  }
  return null;
}

// ── Conferência do que o geocodificador devolveu ────────────────────────────

export interface Achado { lat: string | number; lon: string | number; addresstype?: string;
  address?: Record<string, string | undefined> }

const cidadeDoAchado = (a: Achado['address']) =>
  a?.city || a?.town || a?.village || a?.municipality || a?.city_district || '';
const ufDoAchado = (a: Achado['address']) => String(a?.['ISO3166-2-lvl4'] || '').replace('BR-', '');

/**
 * Só vale achado na MESMA UF e na mesma cidade (ou colado nela: distrito e
 * povoado vêm com outro nome). Rua de mesmo nome em outro estado é o erro que
 * este filtro existe pra barrar.
 */
export function confereAchado(x: Achado, mun: Municipio, centro: { lat: number; lng: number }): boolean {
  const a = x.address || {};
  if (ufDoAchado(a) !== mun.uf) return false;
  const p = { lat: Number(x.lat), lng: Number(x.lon) };
  if (!isFinite(p.lat) || !isFinite(p.lng)) return false;
  const km = kmEntre(p, centro);
  if (chaveMunicipio(cidadeDoAchado(a)) === chaveMunicipio(mun.municipio)) return km < 60;
  return km < 15;
}

/** A chave do cache: o endereço normalizado + o município. Editar o endereço
 *  muda a chave, e o ponto é refeito sozinho. */
export function chaveCache(endereco: unknown, mun: Municipio): string {
  const norm = semAcento(String(endereco ?? '')).toLowerCase().replace(/\s+/g, ' ').trim();
  const h = crypto.createHash('sha256').update(`${norm}|${mun.municipio}|${mun.uf}`).digest('hex').slice(0, 24);
  return 'ep_geo:' + h;
}

// ── A rede ──────────────────────────────────────────────────────────────────

const UA = 'IrmaosNaObra-MapaArrendamento/1.0 (contato@irmaosnaobra.com.br)';
const FOLGA_MS = 1100;
let fila: Promise<unknown> = Promise.resolve();
let ultimaChamada = 0;
const memo = new Map<string, unknown>();
const lembra = <T>(k: string, v: T): T => {
  if (memo.size > 3000) memo.clear();
  memo.set(k, v);
  return v;
};
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Uma fila só no processo: duas chamadas da tela ao mesmo tempo não dobram o
 *  ritmo contra o Nominatim. */
async function nominatim(params: Record<string, string>): Promise<Achado[]> {
  const q = new URLSearchParams({ ...params, format: 'jsonv2', addressdetails: '1', limit: '3',
    countrycodes: 'br', 'accept-language': 'pt-BR' }).toString();
  if (memo.has('N:' + q)) return memo.get('N:' + q) as Achado[];
  const vez = fila.then(async () => {
    const espera = FOLGA_MS - (Date.now() - ultimaChamada);
    if (espera > 0) await dormir(espera);
    ultimaChamada = Date.now();
    const r = await fetch('https://nominatim.openstreetmap.org/search?' + q,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`nominatim ${r.status}`);
    return lembra('N:' + q, (await r.json()) as Achado[]);
  });
  fila = vez.catch(() => undefined);
  return vez;
}

/**
 * O CEP em coordenada, pela AwesomeAPI, que devolve o ponto do TRECHO DA RUA.
 *
 * O BRASILAPI NÃO ENTRA, e isto foi medido (08/10/2026): o `location` do CEP v2
 * dele é o CENTRO DA CIDADE para a maioria dos CEPs da base (-15,78/-47,93 para
 * um CEP de Taguatinga, a Esplanada). Usado de reserva, ele gravou ponto de
 * cidade com precisão "CEP" em 105 de 229 endereços e, pior, ganhou da rua
 * achada no Nominatim sempre que os dois discordavam. Sem CEP bom, o endereço
 * segue pra rua, bairro ou cidade, e a precisão diz a verdade.
 */
interface CepAchado { lat: number; lng: number; cidade: string; uf: string }
/** `recusou` = o serviço não respondeu de verdade (não é "CEP não existe"). O
 *  ponto sai sem o CEP e volta marcado `parcial`, pra ser refeito depois. */
async function cepGeo(cep: string): Promise<{ achado: CepAchado | null; recusou: boolean }> {
  if (memo.has('C:' + cep)) return { achado: memo.get('C:' + cep) as CepAchado | null, recusou: false };
  let out: CepAchado | null = null;
  try {
    const r = await fetch(`https://cep.awesomeapi.com.br/json/${cep}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = await r.json() as { lat?: string; lng?: string; city?: string; state?: string };
      if (j.lat && j.lng) out = { lat: Number(j.lat), lng: Number(j.lng), cidade: j.city || '', uf: j.state || '' };
    } else if (r.status !== 404) {
      // 404 é CEP que não existe. Qualquer outra coisa é o serviço recusando a
      // gente, e isso precisa aparecer: sem CEP o mapa perde precisão calado.
      logger.warn(LOG, `AwesomeAPI recusou o CEP: HTTP ${r.status}`);
      return { achado: null, recusou: true };   // não memoriza: a próxima tenta de novo
    }
  } catch (err) {
    logger.warn(LOG, 'AwesomeAPI fora do ar', err);
    return { achado: null, recusou: true };
  }
  return { achado: lembra('C:' + cep, out), recusou: false };
}

/** A sede do município, achada no Nominatim. O centro do IBGE é o do retângulo
 *  e fica longe da cidade nos municípios grandes: só serve de último recurso. */
async function centroCidade(mun: Municipio): Promise<{ lat: number; lng: number }> {
  try {
    const res = await nominatim({ city: mun.municipio, state: UF_NOME[mun.uf] || mun.uf, country: 'Brasil' });
    const bom = res.find(x => ufDoAchado(x.address) === mun.uf
      && chaveMunicipio(cidadeDoAchado(x.address) || '') === chaveMunicipio(mun.municipio));
    if (bom) return { lat: Number(bom.lat), lng: Number(bom.lon) };
  } catch (err) {
    logger.warn(LOG, `sede de ${mun.municipio}-${mun.uf} não veio`, err);
  }
  return { lat: mun.lat, lng: mun.lng };
}

const TIPOS_DE_AREA = new Set(['city', 'town', 'municipality', 'village', 'suburb', 'neighbourhood',
  'quarter', 'state', 'county', 'region']);

/** O ponto como sai do geocodificador. `parcial` = o CEP não respondeu e o ponto
 *  pode melhorar: fica no cache só por um dia (ver lerCache). */
export interface PontoAchado extends Ponto { parcial?: boolean }

/** O endereço em coordenada, do mais preciso pro menos. Sempre devolve um
 *  ponto: no pior caso, a sede da cidade, e a precisão diz isso. */
export async function localizar(endereco: unknown, mun: Municipio): Promise<PontoAchado> {
  let parcial = false;
  const fim = (p: Ponto): PontoAchado => (parcial ? { ...p, parcial: true } : p);
  const centro = await centroCidade(mun);
  const base = { municipio: mun.municipio, uf: mun.uf };
  const estado = UF_NOME[mun.uf] || mun.uf;
  const e = partirEndereco(endereco, mun.municipio);
  if (e) {
    let rua: Ponto | null = null;
    const ruaNom = e.numero ? `${e.numero} ${e.ruaSemNum}` : e.ruaSemNum;
    if (e.estruturado && ruaNom) {
      const ok = (await nominatim({ street: ruaNom, city: mun.municipio, state: estado, country: 'Brasil' }))
        .filter(x => confereAchado(x, mun, centro));
      const comNumero = ok.find(x => x.address?.house_number);
      if (comNumero) return { lat: Number(comNumero.lat), lng: Number(comNumero.lon), precisao: 'numero', ...base };
      if (ok[0]) rua = { lat: Number(ok[0].lat), lng: Number(ok[0].lon), precisao: 'rua', ...base };
    } else if (!e.estruturado) {
      const ok = (await nominatim({ q: `${e.texto}, ${mun.municipio}, ${mun.uf}, Brasil` }))
        .filter(x => confereAchado(x, mun, centro));
      if (ok[0]) return { lat: Number(ok[0].lat), lng: Number(ok[0].lon),
        precisao: ok[0].address?.house_number ? 'numero' : 'rua', ...base };
    }
    // A busca por campos erra com "Av."/"R." abreviado: tenta o nome da rua solto.
    if (!rua && temNomeDeRua(e.ruaSemNum)) {
      const ok = (await nominatim({ q: `${e.ruaSemNum}, ${e.bairro ? e.bairro + ', ' : ''}${mun.municipio}, ${estado}, Brasil` }))
        .filter(x => confereAchado(x, mun, centro) && !TIPOS_DE_AREA.has(String(x.addresstype)));
      if (ok[0]) rua = { lat: Number(ok[0].lat), lng: Number(ok[0].lon),
        precisao: ok[0].address?.house_number ? 'numero' : 'rua', ...base };
    }
    if (e.cep && !ehCepDaCidade(e.cep)) {
      const { achado: c, recusou } = await cepGeo(e.cep);
      if (recusou) parcial = true;
      const km = c ? kmEntre(c, centro) : Infinity;
      if (c && c.uf === mun.uf && km < 60
          && (chaveMunicipio(c.cidade) === chaveMunicipio(mun.municipio) || km < 15)) {
        // Rua e CEP concordando, fica a rua (mais perto do número). Discordando, o CEP manda.
        if (rua && kmEntre(rua, c) < 2) return rua;
        return { lat: c.lat, lng: c.lng, precisao: 'cep', ...base };
      }
    }
    if (rua) return fim(rua);
    if (e.bairro) {
      const ok = (await nominatim({ q: `${e.bairro}, ${mun.municipio}, ${estado}, Brasil` }))
        .filter(x => confereAchado(x, mun, centro)
          && !['city', 'town', 'municipality', 'state', 'county', 'region'].includes(String(x.addresstype)));
      if (ok[0]) return fim({ lat: Number(ok[0].lat), lng: Number(ok[0].lon), precisao: 'bairro', ...base });
    }
  }
  return fim({ lat: centro.lat, lng: centro.lng, precisao: 'cidade', ...base });
}

// ── O cache ─────────────────────────────────────────────────────────────────

const PRECISOES = new Set<Precisao>(['numero', 'cep', 'rua', 'bairro', 'cidade']);
/** Versão do que vai no cache. A 1 aceitava o BrasilAPI de reserva e gravou
 *  centro de cidade com precisão "CEP": esses são refeitos ao serem lidos. */
const VERSAO_CACHE = 2;
/** Ponto parcial (o CEP não respondeu) é refeito depois de um dia. */
const PARCIAL_VALE_MS = 24 * 60 * 60 * 1000;

interface Guardado extends Partial<PontoAchado> { v?: number; em?: string }

/** O que está no cache ainda serve? Fica fora: o "CEP" da versão 1 e o parcial
 *  com mais de um dia. */
export function guardadoServe(v: Guardado | null, agora = Date.now()): boolean {
  if (!v || typeof v.lat !== 'number' || typeof v.lng !== 'number' || !PRECISOES.has(v.precisao as Precisao)) return false;
  if (v.precisao === 'cep' && (v.v || 1) < VERSAO_CACHE) return false;
  if (v.parcial && !(agora - Date.parse(String(v.em || '')) < PARCIAL_VALE_MS)) return false;
  return true;
}

/** Lê só as chaves pedidas, em blocos: um `like 'ep_geo:%'` corta em 1000 linhas
 *  calado quando o cache crescer. */
async function lerCache(chaves: string[]): Promise<Map<string, Ponto>> {
  const achou = new Map<string, Ponto>();
  for (let i = 0; i < chaves.length; i += 100) {
    const { data, error } = await supabase.from('system_state').select('key, value')
      .in('key', chaves.slice(i, i + 100));
    if (error) throw new Error(`cache do mapa: ${error.message}`);
    for (const row of (data || []) as { key: string; value: Guardado | null }[]) {
      const v = row.value;
      if (v && guardadoServe(v)) {
        achou.set(row.key, { lat: v.lat!, lng: v.lng!, precisao: v.precisao as Precisao,
          municipio: String(v.municipio || ''), uf: String(v.uf || '') });
      }
    }
  }
  return achou;
}

async function gravarCache(chave: string, p: PontoAchado): Promise<void> {
  const agora = new Date().toISOString();
  const { error } = await supabase.from('system_state').upsert(
    { key: chave, value: { ...p, v: VERSAO_CACHE, em: agora }, updated_at: agora }, { onConflict: 'key' });
  if (error) logger.error(LOG, 'não gravou o ponto no cache', error);
}

// ── O lote que a tela pede ──────────────────────────────────────────────────

export interface ItemGeo { k: string; endereco?: string | null; cidade?: string | null; ddd?: string | null }
export interface RespostaGeo {
  /** k → ponto; null quando a cidade não dá pra saber. Quem ficou pra próxima
   *  chamada NÃO aparece aqui (e conta em `pendentes`). */
  pontos: Record<string, Ponto | null>;
  pendentes: number;
}

export async function geocodificarLote(
  itens: ItemGeo[],
  { orcamentoMs = 25000, maxNovos = 15 }: { orcamentoMs?: number; maxNovos?: number } = {},
): Promise<RespostaGeo> {
  const inicio = Date.now();
  const pontos: RespostaGeo['pontos'] = {};
  const porChave = new Map<string, { mun: Municipio; endereco: string; ks: string[] }>();
  for (const it of itens) {
    const mun = resolverMunicipio(it.endereco, it.cidade, it.ddd);
    if (!mun) { pontos[it.k] = null; continue; }
    const chave = chaveCache(it.endereco, mun);
    const g = porChave.get(chave);
    if (g) g.ks.push(it.k);
    else porChave.set(chave, { mun, endereco: String(it.endereco || ''), ks: [it.k] });
  }

  let cache = new Map<string, Ponto>();
  try {
    cache = await lerCache(Array.from(porChave.keys()));
  } catch (err) {
    // Sem cache a tela ainda anda, só que mais devagar: cada chamada acha alguns.
    logger.error(LOG, 'leitura do cache falhou', err);
  }

  let novos = 0, pendentes = 0;
  for (const [chave, g] of porChave) {
    const p = cache.get(chave);
    if (p) { g.ks.forEach(k => { pontos[k] = p; }); continue; }
    if (novos >= maxNovos || Date.now() - inicio > orcamentoMs) { pendentes += g.ks.length; continue; }
    novos++;
    try {
      const achado = await localizar(g.endereco, g.mun);
      await gravarCache(chave, achado);
      // `parcial` é do cache; a tela recebe o ponto e a precisão, que já dizem a verdade.
      const { parcial: _parcial, ...ponto } = achado;
      g.ks.forEach(k => { pontos[k] = ponto; });
    } catch (err) {
      // Nominatim fora: fica pendente, a próxima chamada tenta de novo.
      logger.warn(LOG, 'geocodificação falhou, fica pra próxima', err);
      pendentes += g.ks.length;
    }
  }
  return { pontos, pendentes };
}
