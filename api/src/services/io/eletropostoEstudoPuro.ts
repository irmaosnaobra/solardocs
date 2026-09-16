// ─────────────────────────────────────────────────────────────────────────────
// ESTUDO DO LOCAL, a parte que não fala com ninguém.
//
// Pedido do Thiago (15/09/2026): quem chega na agenda só com um endereço deve
// chegar com o terreno achado e um estudo de mercado pronto antes do atendimento.
// Este arquivo é o miolo sem rede: lê a ficha que a LP grava, dá as notas, acende
// os sinais e escreve o texto de reserva quando a IA falha. Fontes (Google, IBGE),
// página e tick importam daqui, e nada aqui importa de lá.
//
// ── O que o estudo NUNCA faz ──
// Não corta, não desmarca e não muda nota. A régua da LP continua sendo a única
// que decide quem tem reunião. O estudo informa o consultor, e é só isso.
//
// ── De onde vêm os pesos ──
// Base de 29/08 a 15/09/2026 (fichas lp_eletroposto com status final): definido
// 33% chega a orçamento, negociando 19% com 43% de no-show; comércio nomeado 39%,
// Outro 38%, Investidor 15%; Investidor sem forma de pagamento 63% de no-show.
// Versão dos pesos: VERSAO_PESOS. Mudou peso, muda a versão.
//
// ── A barra ──
// A pré-nota sai sempre como "N de 100", nunca "N/100". O card e o gatilho do CRM
// procuram `(\d+)/11` na ficha para achar a NOTA da LP; uma barra aqui seria lida
// como outra nota.
// ─────────────────────────────────────────────────────────────────────────────

import { chaveMunicipio } from './cidadeParse';
import type { ContaReferencia } from '../../utils/computeEletro';

export const TOKEN_RE = /^[a-f0-9]{64}$/;
export const BASE_ESTUDO_URL = 'https://solardoc.app/_api/io/eletroposto/estudo/';
export const VERSAO_PESOS = '2026-09-15';

export const urlDoEstudo = (token: string): string => `${BASE_ESTUDO_URL}${token}`;

// ── texto ──────────────────────────────────────────────────────────────────

/** Minúsculas, sem acento, ponto médio e travessão viram espaço. */
export function semAcentoMin(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[—–·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const limpaEspacos = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function primeiroNome(nome: string | null | undefined): string {
  const p = limpaEspacos(String(nome ?? '')).split(' ')[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}

// ── a ficha da LP ──────────────────────────────────────────────────────────

export type Perfil =
  | 'posto' | 'mercado' | 'restaurante' | 'academia' | 'farmacia' | 'hotel'
  | 'estacionamento' | 'condominio' | 'investidor' | 'outro';

export interface Ficha {
  perfil: Perfil | null;
  perfil_texto: string;
  nota: 1 | 2 | 3 | null;
  pts: number | null;
  ponto: 'definido' | 'negociando' | 'em_vista' | 'sem_ideia' | null;
  relacao: 'proprietario' | 'administro' | 'represento' | 'inquilino' | 'nao_e_meu' | null;
  vagas: '1_2' | '3_5' | '6_10' | '10_mais' | null;
  modelo: 'cedo_espaco' | 'meio_a_meio' | 'chave_na_mao' | 'equipamento' | 'consultoria' | 'nao_sei' | null;
  rota: 'rodovia' | 'comercial' | 'naosei' | null;
  invest: 'proprio' | 'proprio_credito' | 'fin_aprovado' | 'fin_cnpj' | 'fin_banco' | 'naosei' | null;
  valor: '70' | '140' | '280' | '500' | '500_mais' | null;
  decisor: 'eu' | 'socio' | 'terceiros' | null;
  trifasica: 'sim' | 'nao' | 'naosei' | 'sem_local' | null;
  kw: number | null;
  carros: number | null;
  para_investidor: boolean;
  /** Os textos como a pessoa escolheu, por rótulo da ficha. A página mostra estes. */
  respostas: Array<{ rotulo: string; texto: string }>;
}

type Regra<T> = Array<[RegExp, T]>;

// Casam contra o texto já sem acento e sem ponto médio. Os dois formatos da LP
// (travessão até 13/09, ponto médio depois) caem no mesmo texto.
const PERFIL: Regra<Perfil> = [
  [/^dono de posto/, 'posto'], [/^mercado/, 'mercado'], [/^restaurante/, 'restaurante'],
  [/^academia/, 'academia'], [/^farmacia/, 'farmacia'], [/^hotel/, 'hotel'],
  [/^estacionamento/, 'estacionamento'], [/^condominio/, 'condominio'],
  [/^investidor/, 'investidor'], [/^outro/, 'outro'],
];
const PONTO: Regra<NonNullable<Ficha['ponto']>> = [
  [/ja tenho o ponto definido/, 'definido'], [/negociacao/, 'negociando'],
  [/em vista/, 'em_vista'], [/nao tenho ideia/, 'sem_ideia'],
];
const RELACAO: Regra<NonNullable<Ficha['relacao']>> = [
  [/^sou o proprietario/, 'proprietario'], [/^administro/, 'administro'],
  [/^represento/, 'represento'], [/^sou inquilino/, 'inquilino'], [/^ainda nao e meu/, 'nao_e_meu'],
];
const VAGAS: Regra<NonNullable<Ficha['vagas']>> = [
  [/^1 a 2/, '1_2'], [/^3 a 5/, '3_5'], [/^6 a 10/, '6_10'], [/^mais de 10/, '10_mais'],
];
const MODELO: Regra<NonNullable<Ficha['modelo']>> = [
  [/^01\b/, 'cedo_espaco'], [/^02\b/, 'meio_a_meio'], [/^03\b/, 'chave_na_mao'],
  [/^04\b/, 'equipamento'], [/^05\b/, 'consultoria'], [/^ainda nao sei/, 'nao_sei'],
];
const ROTA: Regra<NonNullable<Ficha['rota']>> = [
  [/rodovia/, 'rodovia'], [/comercial/, 'comercial'], [/nao sei/, 'naosei'],
];
const INVEST: Regra<Ficha['invest']> = [
  [/^nao se aplica/, null], [/^recurso proprio \+/, 'proprio_credito'], [/^recurso proprio/, 'proprio'],
  [/pre-?aprovado/, 'fin_aprovado'], [/cnpj/, 'fin_cnpj'], [/nao consultei/, 'fin_banco'],
  [/^ainda nao sei/, 'naosei'],
];
const VALOR: Regra<NonNullable<Ficha['valor']>> = [
  [/^mais de r\$ ?500/, '500_mais'], [/^r\$ ?500/, '500'], [/^r\$ ?280/, '280'],
  [/^r\$ ?140/, '140'], [/^r\$ ?70/, '70'],
];
const DECISOR: Regra<NonNullable<Ficha['decisor']>> = [
  [/^eu decido/, 'eu'], [/socio/, 'socio'], [/terceiros/, 'terceiros'],
];
const TRIFASICA: Regra<NonNullable<Ficha['trifasica']>> = [
  [/^sim/, 'sim'], [/^nao sei/, 'naosei'], [/^ainda nao tenho/, 'sem_local'], [/^nao/, 'nao'],
];

function casar<T>(regras: Regra<T>, texto: string | null): T | null {
  if (texto == null) return null;
  const t = semAcentoMin(texto);
  for (const [re, v] of regras) if (re.test(t)) return v;
  return null;
}

/** Rótulos da ficha, na ordem do card. A página repete as respostas nesta ordem. */
const ROTULOS: Array<[string, string]> = [
  ['Endereço:', 'Endereço'],
  ['Ponto:', 'Ponto'],
  ['Local é seu:', 'Local é seu'],
  ['Vagas disponíveis:', 'Vagas'],
  ['Modelo de interesse:', 'Modelo'],
  ['Rota de passagem:', 'Rota de passagem'],
  ['Como pretende investir:', 'Como pretende investir'],
  ['Quanto pretende investir:', 'Quanto pretende investir'],
  ['Decisor:', 'Decisor'],
  ['Entrada trifásica:', 'Entrada trifásica'],
  ['Simulou', 'Simulou'],
  ['Investimento estimado:', 'Investimento estimado no simulador'],
];

export function extrairFicha(observacao: string | null | undefined): Ficha {
  const linhas = String(observacao ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const valor = (rotulo: string): string | null => {
    const l = linhas.find(x => x.startsWith(rotulo));
    return l == null ? null : l.slice(rotulo.length).trim();
  };

  const perfilTexto = (linhas[0] || '').startsWith('LP ELETROPOSTO')
    ? linhas[0].replace(/^LP ELETROPOSTO\s*[—·]\s*/, '').trim()
    : '';
  const nota = String(observacao ?? '').match(/^NOTA ([123])\s*·\s*(\d+)\/11/m);
  const sim = (valor('Simulou') || '').match(/^(\d+)\s*kW com (\d+) carros/);
  const relacaoTexto = valor('Local é seu:');

  return {
    perfil: casar(PERFIL, perfilTexto),
    perfil_texto: perfilTexto,
    nota: nota ? (Number(nota[1]) as 1 | 2 | 3) : null,
    pts: nota ? Number(nota[2]) : null,
    ponto: casar(PONTO, valor('Ponto:')),
    // "Estou negociando com o proprietário" não é relação com o local: é o ponto.
    relacao: casar(RELACAO, relacaoTexto),
    vagas: casar(VAGAS, valor('Vagas disponíveis:')),
    modelo: casar(MODELO, valor('Modelo de interesse:')),
    rota: casar(ROTA, valor('Rota de passagem:')),
    invest: casar(INVEST, valor('Como pretende investir:')),
    valor: casar(VALOR, valor('Quanto pretende investir:')),
    decisor: casar(DECISOR, valor('Decisor:')),
    trifasica: casar(TRIFASICA, valor('Entrada trifásica:')),
    kw: sim ? Number(sim[1]) : null,
    carros: sim ? Number(sim[2]) : null,
    para_investidor: linhas.includes('PONTO DISPONIVEL PARA INVESTIDOR'),
    respostas: ROTULOS
      .map(([rot, nome]) => ({ rotulo: nome, texto: valor(rot) }))
      .filter((r): r is { rotulo: string; texto: string } => !!r.texto)
      .map(r => (r.rotulo === 'Simulou' ? { rotulo: 'Simulou', texto: `Simulou ${r.texto}` } : r)),
  };
}

// ── o endereço digitado ────────────────────────────────────────────────────

export interface EnderecoDigitado {
  rua: string;
  numero: string;
  bairro: string;
  cidade: string;
  cep: string;
  compl: string;
}

/**
 * A LP escreve `Endereço: <rua>, <número> · <bairro> · <cidade> · CEP x · ref.: y`
 * (travessão no lugar do ponto médio até 13/09). O número é o ÚLTIMO pedaço depois
 * de vírgula: rua com vírgula ("Rua A, Quadra 5, 120") existe, número com vírgula não.
 */
export function extrairEndereco(observacao: string | null | undefined): EnderecoDigitado | null {
  const linha = String(observacao ?? '').split('\n').map(l => l.trim()).find(l => l.startsWith('Endereço:'));
  if (!linha) return null;

  const partes = linha.slice('Endereço:'.length).trim().split(/\s+[·—]\s+/);
  const primeira = partes.shift() || '';
  const virgula = primeira.lastIndexOf(',');
  const rua = limpaEspacos(virgula >= 0 ? primeira.slice(0, virgula) : primeira);
  const numero = virgula >= 0 ? primeira.slice(virgula + 1).trim() : '';
  if (!rua) return null;

  let cep = '';
  let compl = '';
  const resto: string[] = [];
  for (let i = 0; i < partes.length; i++) {
    const p = partes[i].trim();
    if (/^ref\.:/i.test(p)) {
      // O que a pessoa escreveu na referência pode ter ponto médio: é tudo dela.
      compl = [p.replace(/^ref\.:\s*/i, ''), ...partes.slice(i + 1)].join(' · ').trim();
      break;
    }
    if (/^CEP\b/i.test(p)) { cep = p.replace(/^CEP\s*/i, '').trim(); continue; }
    resto.push(p);
  }

  return {
    rua,
    numero,
    bairro: limpaEspacos(resto[0] || ''),
    cidade: limpaEspacos(resto.slice(1).join(' · ')),
    cep,
    compl,
  };
}

/** Chave de comparação de endereço: rua e número, sem acento nem pontuação. */
export function normalizarEndereco(e: Pick<EnderecoDigitado, 'rua' | 'numero'>): string {
  const rua = semAcentoMin(e.rua).replace(/[^a-z0-9]+/g, ' ').trim();
  const num = String(e.numero || '').replace(/\D/g, '').replace(/^0+/, '');
  return `${rua}|${num}`;
}

const VOGAL = /[aeiouáàâãéêíóôõúü]/i;

/**
 * Endereço de teclado batido ("Bbbb", "Nnnn"). Rua e bairro, um de cada vez, sem
 * espaço nem pontuação. Sigla em caixa alta de até 6 letras passa: Brasília tem
 * bairro "SMPW" e setor "SHCGN", que não têm vogal e são endereço de verdade.
 * Serve só de SINAL no estudo. Nunca bloqueia ninguém.
 */
export function enderecoPareceFalso(rua: string, bairro: string): boolean {
  const ruim = (s: string): boolean => {
    const t = String(s || '').replace(/[\s.,;:'"()/-]+/g, '');
    if (!t) return false;
    if (/^(\p{L})\1{3,}$/iu.test(t)) return true;
    if (t.length < 4 || /\d/.test(t) || VOGAL.test(t)) return false;
    if (/^\p{Lu}{4,6}$/u.test(t)) return false;
    return true;
  };
  return ruim(rua) || ruim(bairro);
}

export function textoDeBusca(
  e: EnderecoDigitado,
  municipio?: { municipio?: string; uf?: string } | null,
): string {
  const num = /^0*$/.test(e.numero.replace(/\D/g, '')) ? '' : e.numero;
  const cidade = municipio?.municipio && municipio?.uf ? `${municipio.municipio} - ${municipio.uf}` : e.cidade;
  return [e.rua, num, e.bairro, cidade, 'Brasil'].filter(Boolean).join(', ');
}

// ── geografia ──────────────────────────────────────────────────────────────

export interface Coord { lat: number; lng: number }

export function distanciaM(a: Coord, b: Coord): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

/** Rumo de `de` para `para`, em graus de 0 a 359. É o heading da foto da rua. */
export function rumoGraus(de: Coord, para: Coord): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const y = Math.sin(rad(para.lng - de.lng)) * Math.cos(rad(para.lat));
  const x = Math.cos(rad(de.lat)) * Math.sin(rad(para.lat))
          - Math.sin(rad(de.lat)) * Math.cos(rad(para.lat)) * Math.cos(rad(para.lng - de.lng));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/** O pedaço de resposta da Places API (New) que o estudo usa. */
export interface LugarGoogle {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  types?: string[];
  primaryType?: string;
  businessStatus?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
}

export type Confianca = 'alta' | 'media' | 'baixa' | 'nao_encontrado';

const TIPOS_PRECISOS = ['street_address', 'premise', 'subpremise', 'establishment'];
const TIPOS_DE_RUA = [...TIPOS_PRECISOS, 'route', 'point_of_interest', 'plus_code'];

const componente = (r: LugarGoogle, tipo: string): string =>
  r.addressComponents?.find(c => c.types?.includes(tipo))?.longText || '';

/**
 * alta: o Google achou o imóvel com o mesmo número digitado.
 * media: achou a rua, ou o número não bate.
 * baixa: devolveu bairro ou cidade, município diferente, ou pino a mais de 40 km.
 */
export function confiancaGeo(
  r: LugarGoogle | null | undefined,
  numeroDigitado: string,
  municipio?: { nome?: string; lat?: number; lng?: number } | null,
): Confianca {
  if (!r || !r.location) return 'nao_encontrado';
  const pino = { lat: r.location.latitude, lng: r.location.longitude };

  if (municipio?.lat != null && municipio?.lng != null
      && distanciaM(pino, { lat: municipio.lat, lng: municipio.lng }) > 40_000) return 'baixa';

  const cidadeGoogle = componente(r, 'administrative_area_level_2');
  if (municipio?.nome && cidadeGoogle && chaveMunicipio(cidadeGoogle) !== chaveMunicipio(municipio.nome)) return 'baixa';

  const tipos = r.types || [];
  if (!tipos.some(t => TIPOS_DE_RUA.includes(t))) return 'baixa';

  const numG = componente(r, 'street_number').replace(/\D/g, '').replace(/^0+/, '');
  const numD = String(numeroDigitado || '').replace(/\D/g, '').replace(/^0+/, '');
  if (tipos.some(t => TIPOS_PRECISOS.includes(t)) && numD && numG === numD) return 'alta';
  return 'media';
}

// ── entorno e recarga ──────────────────────────────────────────────────────

export const CATEGORIAS_ENTORNO: Array<{ chave: string; rotulo: string; tipos: string[] }> = [
  { chave: 'supermercado', rotulo: 'Supermercado', tipos: ['supermarket', 'grocery_store', 'hypermarket'] },
  { chave: 'shopping', rotulo: 'Shopping', tipos: ['shopping_mall'] },
  { chave: 'restaurante', rotulo: 'Restaurante', tipos: ['restaurant'] },
  { chave: 'hotel', rotulo: 'Hotel', tipos: ['hotel', 'lodging', 'motel'] },
  { chave: 'farmacia', rotulo: 'Farmácia', tipos: ['pharmacy', 'drugstore'] },
  { chave: 'academia', rotulo: 'Academia', tipos: ['gym', 'fitness_center'] },
  { chave: 'estacionamento', rotulo: 'Estacionamento', tipos: ['parking', 'parking_lot', 'parking_garage'] },
  { chave: 'posto', rotulo: 'Posto de combustível', tipos: ['gas_station'] },
  { chave: 'lava_jato', rotulo: 'Lava-jato', tipos: ['car_wash'] },
  { chave: 'hospital', rotulo: 'Hospital', tipos: ['hospital'] },
  { chave: 'universidade', rotulo: 'Universidade', tipos: ['university'] },
];

/** O que o searchNearby do entorno pede. Tudo tipo da Tabela A da Places API (New). */
export const TIPOS_ENTORNO = [
  'supermarket', 'grocery_store', 'shopping_mall', 'restaurant', 'hotel', 'pharmacy',
  'gym', 'parking', 'gas_station', 'car_wash', 'hospital', 'university',
];

export function categoriaDoLugar(l: Pick<LugarGoogle, 'primaryType' | 'types'>): { chave: string; rotulo: string } | null {
  const tipos = [l.primaryType, ...(l.types || [])].filter((t): t is string => !!t);
  for (const t of tipos) {
    if (t.endsWith('_restaurant')) return { chave: 'restaurante', rotulo: 'Restaurante' };
    const c = CATEGORIAS_ENTORNO.find(x => x.tipos.includes(t));
    if (c) return { chave: c.chave, rotulo: c.rotulo };
  }
  return null;
}

export interface ItemLugar {
  place_id: string;
  nome: string;
  tipo: string;
  rotulo: string;
  dist_m: number;
  lat: number | null;
  lng: number | null;
}

export interface ResumoLugares {
  raio_m: number;
  n: number;
  /** A API devolve no máximo 20. Com 20, o texto diz "20 ou mais". */
  cheio: boolean;
  ate_m: number | null;
  mais_perto_m: number | null;
  por_tipo: Record<string, number>;
  lista: ItemLugar[];
}

export function resumirLugares(lugares: LugarGoogle[], centro: Coord, raio_m: number, rotuloPadrao = 'Local'): ResumoLugares {
  const lista: ItemLugar[] = (lugares || [])
    .filter(l => l.location && l.businessStatus !== 'CLOSED_PERMANENTLY')
    .map(l => {
      const cat = categoriaDoLugar(l);
      const lat = (l.location as { latitude: number }).latitude;
      const lng = (l.location as { longitude: number }).longitude;
      return {
        place_id: l.id || '',
        nome: l.displayName?.text || 'Sem nome no Google',
        tipo: cat?.chave || 'outro',
        rotulo: cat?.rotulo || rotuloPadrao,
        dist_m: distanciaM(centro, { lat, lng }),
        lat,
        lng,
      };
    })
    .sort((a, b) => a.dist_m - b.dist_m);

  const por_tipo: Record<string, number> = {};
  for (const i of lista) por_tipo[i.tipo] = (por_tipo[i.tipo] || 0) + 1;

  return {
    raio_m,
    n: lista.length,
    cheio: (lugares || []).length >= 20,
    ate_m: lista.length ? lista[lista.length - 1].dist_m : null,
    mais_perto_m: lista.length ? lista[0].dist_m : null,
    por_tipo,
    lista,
  };
}

// ── notas ──────────────────────────────────────────────────────────────────

export interface PreNota { valor: number; p: number; q: number; c: number; faixa: string }

const COMERCIO_NOMEADO = new Set<Perfil>(['posto', 'mercado', 'restaurante', 'academia', 'farmacia', 'hotel', 'estacionamento', 'condominio', 'outro']);
const CONTROLE = new Set(['proprietario', 'administro', 'represento', 'inquilino']);

export function faixaPreNota(v: number): string {
  if (v >= 80) return 'prioridade alta';
  if (v >= 60) return 'atenção';
  return 'confirmar antes';
}

/**
 * P (ponto e controle, até 35) + Q (perfil, até 25) + C (capital, até 15), levado
 * a 100. Inquilino pesa o mesmo que dono: 45% dos inquilinos chegaram a orçamento,
 * contra 36% dos proprietários.
 */
export function preNota(f: Pick<Ficha, 'ponto' | 'relacao' | 'perfil' | 'invest'>): PreNota {
  const p = f.ponto === 'definido' && f.relacao && CONTROLE.has(f.relacao) ? 35
          : f.ponto === 'negociando' ? 20 : 0;
  const q = f.perfil === 'investidor' ? 10 : f.perfil && COMERCIO_NOMEADO.has(f.perfil) ? 25 : 0;
  let c = 15;
  if (f.perfil === 'investidor') {
    c = f.invest === 'proprio' || f.invest === 'proprio_credito' ? 15
      : f.invest === 'fin_aprovado' ? 12
      : f.invest === 'fin_cnpj' || f.invest === 'fin_banco' ? 6
      : f.invest === 'naosei' ? 0
      : 5;   // modelo 01: a LP não pergunta como pagaria
  }
  const valor = Math.round((100 * (p + q + c)) / 75);
  return { valor, p, q, c, faixa: faixaPreNota(valor) };
}

export interface MedidasMercado {
  plugin_mun?: number | null;
  frota_mun?: number | null;
  plugin_br?: number | null;
  frota_br?: number | null;
  n_entorno?: number | null;
  carregadores_5km?: number | null;
  confianca?: Confianca | null;
}

export interface NotaDoLocal {
  valor: number | null;
  faixa: string;
  a_confirmar: boolean;
  componentes: { a: number | null; b: number | null; c: number | null; d: number | null };
}

const um = (x: number) => Math.round(x * 10) / 10;

/**
 * A adoção, o tamanho do mercado de plug-in, os polos a 1 km e o espaço para mais
 * um carregador, de 0 a 10 cada, com peso igual. Componente sem dado sai da média;
 * com menos de 2, não há índice.
 */
export function notaDoLocal(m: MedidasMercado): NotaDoLocal {
  const a = m.plugin_mun != null && m.frota_mun && m.plugin_br && m.frota_br
    ? um(Math.min(10, 5 * ((m.plugin_mun / m.frota_mun) / (m.plugin_br / m.frota_br))))
    : null;
  const b = m.plugin_mun != null ? um(Math.min(10, 2.5 * Math.log10(Math.max(m.plugin_mun, 1)))) : null;
  const c = m.n_entorno != null ? um(Math.min(10, m.n_entorno / 2)) : null;
  let d: number | null = null;
  if (m.plugin_mun != null && m.plugin_mun >= 50 && m.carregadores_5km != null) {
    const q = m.plugin_mun / (m.carregadores_5km + 1);
    d = q >= 300 ? 10 : q >= 150 ? 8 : q >= 60 ? 6 : q >= 20 ? 4 : 2;
  }

  const a_confirmar = m.confianca === 'baixa' || m.confianca === 'nao_encontrado';
  const vals = [a, b, c, d].filter((x): x is number => x != null);
  if (vals.length < 2) return { valor: null, faixa: 'sem dado suficiente', a_confirmar, componentes: { a, b, c, d } };

  const valor = um(vals.reduce((s, x) => s + x, 0) / vals.length);
  const faixa = a_confirmar ? 'a confirmar'
    : valor >= 7 ? 'mercado forte' : valor >= 4 ? 'mercado em formação' : 'mercado pequeno hoje';
  return { valor, faixa, a_confirmar, componentes: { a, b, c, d } };
}

// ── sinais e situação ──────────────────────────────────────────────────────

export interface Sinal {
  tipo: string;
  texto: string;
  lado: 'atencao' | 'favor' | 'fato';
}

export interface ItemHistorico { id: number; quando: string | null; status: string; consultor: string }

const TZ = 'America/Sao_Paulo';

export function dataCurtaBRT(iso: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', timeZone: TZ }).formatToParts(new Date(iso));
  const v = (t: string) => (p.find(x => x.type === t)?.value || '').padStart(2, '0');
  return `${v('day')}/${v('month')}`;
}

export function horaBRT(iso: string, sep = 'h'): string {
  const p = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).formatToParts(new Date(iso));
  const v = (t: string) => (p.find(x => x.type === t)?.value || '').padStart(2, '0');
  return `${v('hour')}${sep}${v('minute')}`;
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "qua 17/09 às 14h00", no horário de Brasília. */
export function quandoPorExtenso(iso: string | null | undefined): string {
  if (!iso) return 'sem horário';
  const dia = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ }).format(new Date(iso));
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dia);
  return `${DIAS[idx] ?? ''} ${dataCurtaBRT(iso)} às ${horaBRT(iso)}`.trim();
}

const STATUS_LEGIVEL: Record<string, string> = {
  agendado: 'agendado', nao_atendeu: 'não atendeu', sem_interesse: 'sem interesse',
  fez_orcamento: 'fez orçamento', proposta_apresentada: 'proposta apresentada',
  perdido: 'perdido', cancelado: 'cancelado', em_atendimento: 'em atendimento',
  fechou_concorrente: 'fechou com concorrente', fechado: 'fechado',
};

export const statusLegivel = (s: string): string => STATUS_LEGIVEL[s] || String(s || '').replace(/_/g, ' ');

const RODOVIA = /\b(rodovia|estrada|br\s?-?\s?\d{2,3}|km\s?\d+|rod\.)/i;

export function ehRodovia(e: EnderecoDigitado | null | undefined, f?: Pick<Ficha, 'rota'> | null): boolean {
  return f?.rota === 'rodovia' || (!!e && RODOVIA.test(`${e.rua} ${e.bairro}`));
}

export function sinaisDeAtencao(ctx: {
  ficha: Ficha;
  endereco: EnderecoDigitado | null;
  confianca: Confianca | null;
  estabelecimento?: { nome: string; tipo: string } | null;
  historico?: ItemHistorico[];
}): Sinal[] {
  const { ficha: f, endereco: e, confianca } = ctx;
  const s: Sinal[] = [];

  if (f.perfil === 'investidor' && f.invest === 'naosei') {
    s.push({ tipo: 'sem_capital', lado: 'atencao', texto: 'Investidor sem forma de pagamento definida (5 de 8 faltaram).' });
  }
  if (f.ponto === 'negociando') {
    s.push({ tipo: 'negociando', lado: 'atencao', texto: 'Local em negociação (43% de no-show, n=21). Confirme por ligação na véspera.' });
  }
  const numeroVazio = !e || !e.numero.replace(/\D/g, '') || /^0+$/.test(e.numero.replace(/\D/g, ''));
  if ((e && enderecoPareceFalso(e.rua, e.bairro)) || (e && numeroVazio) || confianca === 'nao_encontrado') {
    s.push({ tipo: 'endereco_suspeito', lado: 'atencao', texto: 'Endereço não conferiu. Confirme no começo da chamada.' });
  }
  if (e && semAcentoMin(e.compl).includes('ponto ainda nao definido')) {
    s.push({ tipo: 'endereco_do_lead', lado: 'atencao', texto: 'O endereço parece ser do cliente, não do ponto.' });
  }
  if (f.decisor === 'socio') {
    s.push({ tipo: 'decisor', lado: 'atencao', texto: 'Sócio ou cônjuge decide junto (4 no-show em 8 desde 29/08). Peça que ele entre na chamada.' });
  }
  if (f.perfil === 'investidor') {
    s.push({ tipo: 'investidor', lado: 'atencao', texto: 'Investidor (15% chegam a orçamento, contra 38% a 39% dos outros perfis). Confirme capital e prazo nos primeiros minutos.' });
  }
  // A mais recente primeiro: é a que o consultor vai tratar como "o último contato".
  const anteriores = (ctx.historico || [])
    .filter((h): h is ItemHistorico & { quando: string } => !!h.quando)
    .sort((a, b) => b.quando.localeCompare(a.quando));
  if (anteriores.length) {
    const u = anteriores[0];
    const mais = anteriores.length > 1 ? ` Ao todo, ${anteriores.length} vezes.` : '';
    s.push({
      tipo: 'duplicado', lado: 'atencao',
      texto: `Já esteve na agenda: ${dataCurtaBRT(u.quando)}, ${statusLegivel(u.status)}, ${u.consultor || 'sem consultor'}.${mais}`,
    });
  }
  if (ehRodovia(e, f)) {
    s.push({ tipo: 'rodovia', lado: 'favor', texto: 'Beira de rodovia (5 de 11 chegaram a orçamento, 1 no-show).' });
  }
  if (f.relacao === 'inquilino') {
    s.push({ tipo: 'inquilino', lado: 'favor', texto: 'Quem opera o local (inquilino): 5 de 11 chegaram a orçamento.' });
  }
  if (confianca && confianca !== 'nao_encontrado') {
    s.push(ctx.estabelecimento
      ? { tipo: 'estabelecimento', lado: 'fato', texto: `No endereço o Google mostra: ${ctx.estabelecimento.nome}, ${ctx.estabelecimento.tipo}.` }
      : { tipo: 'estabelecimento', lado: 'fato', texto: 'Nenhum estabelecimento cadastrado no endereço.' });
  }
  return s;
}

const SINAIS_QUE_PEDEM_CONFIRMACAO = new Set(['sem_capital', 'negociando', 'endereco_suspeito', 'endereco_do_lead']);

export type Situacao = 'pronto' | 'confirmar';

export function situacao(sinais: Sinal[], confianca: Confianca | null): Situacao {
  if (confianca === 'baixa' || confianca === 'nao_encontrado') return 'confirmar';
  return sinais.some(x => SINAIS_QUE_PEDEM_CONFIRMACAO.has(x.tipo)) ? 'confirmar' : 'pronto';
}

export const rotuloSituacao = (s: Situacao): string =>
  s === 'confirmar' ? 'CONFIRMAR ANTES' : 'PRONTO PARA A REUNIÃO';

// ── o formato gravado em eletroposto_estudos.dados ─────────────────────────

export interface MunicipioEstudo {
  ibge: number;
  nome: string;
  uf: string;
  /** Centro do município. Serve para abrir mapa de carregador quando o Google recusa. */
  lat?: number | null;
  lng?: number | null;
  pop_2026: number | null;
  pib_pc_2023: number | null;
  frota: number | null;
  plugin: number | null;
  por_mil: number | null;
  uf_por_mil: number | null;
  br_por_mil: number | null;
  ref: string;
}

export interface TextosIA {
  resumo: string;
  leitura_do_entorno: string;
  perguntas: string[];
  cuidados: string[];
  modelo_sugerido: '01' | '02' | '03' | '04' | '05';
  porque_modelo: string;
}

export interface DadosEstudo {
  ficha?: Ficha;
  endereco_digitado?: EnderecoDigitado | null;
  local?: {
    place_id: string | null;
    lat: number | null;
    lng: number | null;
    formatado: string | null;
    estabelecimento: { nome: string; tipo: string; status: string } | null;
    rodovia: boolean;
  } | null;
  confianca?: Confianca;
  entorno?: ResumoLugares | null;
  recarga?: ResumoLugares | null;
  rua?: { pano_id: string; data: string | null; heading: number; pano_lat: number | null; pano_lng: number | null } | null;
  imagens?: { satelite_ok: boolean; rua_ok: boolean };
  municipio?: MunicipioEstudo | null;
  conta?: ContaReferencia | null;
  indice?: NotaDoLocal;
  pre_nota?: PreNota;
  sinais?: Sinal[];
  situacao?: Situacao;
  historico?: ItemHistorico[];
  portao?: { cortaria: boolean; regra: string | null };
  /** O Google recusou a chave: o estudo saiu sem mapa, entorno e carregadores. */
  google_negado?: boolean;
  ia?: TextosIA & { origem: 'ia' | 'modelo'; reprovados?: string[] };
}

// ── a IA e o texto de reserva ──────────────────────────────────────────────

const ROTULO_PERFIL: Record<Perfil, string> = {
  posto: 'Dono de posto de combustível', mercado: 'Mercado', restaurante: 'Restaurante',
  academia: 'Academia', farmacia: 'Farmácia', hotel: 'Hotel ou pousada',
  estacionamento: 'Estacionamento', condominio: 'Condomínio', investidor: 'Investidor', outro: 'Outro perfil',
};
const ROTULO_RELACAO: Record<string, string> = {
  proprietario: 'proprietário', administro: 'administra o local', represento: 'representa o proprietário',
  inquilino: 'inquilino', nao_e_meu: 'ainda não é dele',
};
const ROTULO_MODELO: Record<string, string> = {
  cedo_espaco: '01', meio_a_meio: '02', chave_na_mao: '03', equipamento: '04', consultoria: '05', nao_sei: 'quer comparar',
};
const ROTULO_VAGAS: Record<string, string> = { '1_2': '1 a 2', '3_5': '3 a 5', '6_10': '6 a 10', '10_mais': 'mais de 10' };

export interface FatosIA {
  perfil: string;
  relacao_com_o_local: string | null;
  vagas_declaradas: string | null;
  modelo_de_interesse: string | null;
  bairro: string;
  cidade: string;
  entorno: { raio_m: number; raio_km: number; total: number; vinte_ou_mais: boolean; por_tipo: Record<string, number>; mais_proximos: Array<{ tipo: string; dist_m: number }> } | null;
  recarga_5km: { raio_km: number; total: number; vinte_ou_mais: boolean; mais_perto_m: number | null; mais_perto_km: number | null } | null;
  municipio: { populacao_2026: number | null; pib_per_capita_2023: number | null; frota: number | null; plugin: number | null; plugin_por_mil: number | null; uf_por_mil: number | null; brasil_por_mil: number | null } | null;
  pre_nota: number | null;
  indice: number | null;
  indice_faixa: string;
  componentes: NotaDoLocal['componentes'] | null;
  sinais: string[];
  situacao: string;
}

export function montarFatosIA(d: DadosEstudo): FatosIA {
  const f = d.ficha;
  const rotuloTipo = (chave: string) => CATEGORIAS_ENTORNO.find(c => c.chave === chave)?.rotulo || chave;
  return {
    perfil: f?.perfil ? ROTULO_PERFIL[f.perfil] : (f?.perfil_texto || 'não informado'),
    relacao_com_o_local: f?.relacao ? ROTULO_RELACAO[f.relacao] : (f?.ponto === 'negociando' ? 'negociando com o proprietário' : null),
    vagas_declaradas: f?.vagas ? ROTULO_VAGAS[f.vagas] : null,
    modelo_de_interesse: f?.modelo ? ROTULO_MODELO[f.modelo] : null,
    bairro: d.endereco_digitado?.bairro || '',
    cidade: d.municipio ? `${d.municipio.nome}-${d.municipio.uf}` : (d.endereco_digitado?.cidade || ''),
    entorno: d.entorno ? {
      raio_m: d.entorno.raio_m,
      // A mesma distância em km: a IA escreve "1 km", e sem este campo o número 1
      // não existiria nos fatos e o texto inteiro seria reprovado.
      raio_km: Math.round(d.entorno.raio_m / 100) / 10,
      total: d.entorno.n,
      vinte_ou_mais: d.entorno.cheio,
      por_tipo: Object.fromEntries(Object.entries(d.entorno.por_tipo).map(([k, v]) => [rotuloTipo(k), v])),
      mais_proximos: d.entorno.lista.slice(0, 5).map(i => ({ tipo: i.rotulo, dist_m: i.dist_m })),
    } : null,
    recarga_5km: d.recarga ? {
      raio_km: Math.round(d.recarga.raio_m / 100) / 10,
      total: d.recarga.n,
      vinte_ou_mais: d.recarga.cheio,
      mais_perto_m: d.recarga.mais_perto_m,
      mais_perto_km: d.recarga.mais_perto_m != null ? Math.round(d.recarga.mais_perto_m / 100) / 10 : null,
    } : null,
    municipio: d.municipio ? {
      populacao_2026: d.municipio.pop_2026, pib_per_capita_2023: d.municipio.pib_pc_2023,
      frota: d.municipio.frota, plugin: d.municipio.plugin, plugin_por_mil: d.municipio.por_mil,
      uf_por_mil: d.municipio.uf_por_mil, brasil_por_mil: d.municipio.br_por_mil,
    } : null,
    pre_nota: d.pre_nota?.valor ?? null,
    indice: d.indice?.valor ?? null,
    indice_faixa: d.indice?.faixa || 'sem dado suficiente',
    componentes: d.indice?.componentes ?? null,
    sinais: (d.sinais || []).map(s => s.texto),
    situacao: rotuloSituacao(d.situacao || 'confirmar'),
  };
}

export const PROIBIDO_IA = /R\$|%|\breais\b|payback|\bTIR\b|\bVPL\b|\bROI\b|lucro|faturamento|garantid|curioso|sem perfil|cancel|desmarc/i;
const TRAVESSAO = /[–—]/;
// Tetos de tamanho. Medido em 15/09 com o modelo de verdade: ele escreve 640 a 660
// na leitura do entorno e 500 a 580 no porquê do modelo. Reprovar por isso jogava
// fora texto bom e devolvia o texto padrão, então o teto acompanha o que ele escreve.
const MAX = { resumo: 700, leitura_do_entorno: 800, pergunta: 200, cuidado: 240, porque_modelo: 600 };

/** Todo número que aparece nos fatos, normalizado ("3.017" e "7,4" viram 3017 e 7.4). */
function numerosDe(texto: string): Set<string> {
  const out = new Set<string>();
  for (const m of texto.match(/\d+(?:[.,]\d+)*/g) || []) out.add(normalizarNumero(m));
  return out;
}

function normalizarNumero(t: string): string {
  let s = t;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  s = s.replace(/,/g, '.');
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

/**
 * Todo número do texto tem que existir nos fatos. A exceção é o arredondamento com
 * palavra: "250 mil veículos" quando o JSON traz 250000. Sem isso, a frase mais
 * natural do texto era reprovada e o consultor recebia o texto padrão (medido em
 * 15/09: 1 em cada 3 estudos perdia o resumo por causa disso).
 */
const NUMERO_COM_ESCALA = /(\d+(?:[.,]\d+)*)\s*(mil|milh(?:ão|ões|oes))?/gi;

function numeroConhecido(bruto: string, escala: string | undefined, numeros: Set<string>): boolean {
  const base = Number(normalizarNumero(bruto));
  const candidatos = [normalizarNumero(bruto)];
  if (Number.isFinite(base) && escala) {
    const fator = /^mil$/i.test(escala) ? 1000 : 1e6;
    candidatos.push(String(base * fator));
  }
  return candidatos.some(c => numeros.has(c));
}

function textoPassa(t: unknown, max: number, numeros: Set<string>): t is string {
  if (typeof t !== 'string' || !t.trim() || t.length > max) return false;
  if (PROIBIDO_IA.test(t) || TRAVESSAO.test(t)) return false;
  for (const m of t.matchAll(NUMERO_COM_ESCALA)) {
    if (!numeroConhecido(m[1], m[2], numeros)) return false;
  }
  return true;
}

/**
 * Campo reprovado vira o texto de reserva, campo por campo. A IA pode acertar o
 * resumo e errar uma pergunta: joga fora só a pergunta.
 */
export function validarTextoIA(bruto: unknown, fatos: FatosIA): TextosIA & { origem: 'ia' | 'modelo'; reprovados: string[] } {
  const modelo = textosDeModelo(fatos);
  const numeros = numerosDe(JSON.stringify(fatos));
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const reprovados: string[] = [];
  let aproveitados = 0;

  const campo = (nome: 'resumo' | 'leitura_do_entorno' | 'porque_modelo'): string => {
    if (textoPassa(b[nome], MAX[nome], numeros)) { aproveitados++; return (b[nome] as string).trim(); }
    reprovados.push(nome);
    return modelo[nome];
  };

  const lista = (nome: 'perguntas' | 'cuidados', max: number, min: number, teto: number): string[] => {
    const arr = Array.isArray(b[nome]) ? (b[nome] as unknown[]) : null;
    const bons = (arr || []).filter((x): x is string => textoPassa(x, max, numeros)).map(x => x.trim()).slice(0, teto);
    if (!arr || bons.length !== arr.length) reprovados.push(nome);
    if (arr && bons.length >= Math.max(min, 1)) { aproveitados++; return bons; }
    return arr && arr.length === 0 && min === 0 ? [] : modelo[nome];
  };

  let sugerido = modelo.modelo_sugerido;
  if (['01', '02', '03', '04', '05'].includes(String(b.modelo_sugerido))) {
    sugerido = String(b.modelo_sugerido) as TextosIA['modelo_sugerido'];
    aproveitados++;
  } else {
    reprovados.push('modelo_sugerido');
  }

  const out = {
    resumo: campo('resumo'),
    leitura_do_entorno: campo('leitura_do_entorno'),
    perguntas: lista('perguntas', MAX.pergunta, 3, 5),
    cuidados: lista('cuidados', MAX.cuidado, 0, 3),
    modelo_sugerido: sugerido,
    porque_modelo: campo('porque_modelo'),
  };
  return { ...out, origem: aproveitados === 0 ? 'modelo' : 'ia', reprovados };
}

/** O texto que sai quando a IA não responde. Escrito só com o que está nos fatos. */
export function textosDeModelo(fatos: FatosIA): TextosIA {
  const onde = [fatos.bairro, fatos.cidade].filter(Boolean).join(', ') || 'endereço informado';
  const resumo = `${fatos.perfil} em ${onde}. Situação: ${fatos.situacao}.`
    + (fatos.sinais.length ? ` Primeiro ponto de atenção: ${fatos.sinais[0]}` : '');

  let leitura = 'O entorno não foi consultado agora.';
  if (fatos.entorno) {
    const tipos = Object.entries(fatos.entorno.por_tipo).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t.toLowerCase());
    leitura = fatos.entorno.total
      ? `Em volta do endereço o Google lista ${fatos.entorno.vinte_ou_mais ? 'muitos' : 'alguns'} estabelecimentos dos tipos que atraem recarga, principalmente ${tipos.join(', ')}.`
      : 'O Google não lista estabelecimentos dos tipos que atraem recarga perto do endereço.';
  }
  if (fatos.recarga_5km) {
    leitura += fatos.recarga_5km.total
      ? ' Já existem carregadores cadastrados na região.'
      : ' Não há carregador cadastrado na região.';
  }

  const perguntas: string[] = [];
  const temSinal = (trecho: string) => fatos.sinais.some(s => s.includes(trecho));
  if (temSinal('Endereço não conferiu') || temSinal('parece ser do cliente')) perguntas.push('Você pode confirmar o endereço exato do local e mandar a localização?');
  if (temSinal('negociação')) perguntas.push('Em que pé está a conversa com o proprietário do local?');
  if (temSinal('Sócio ou cônjuge')) perguntas.push('Quem mais participa da decisão e pode entrar nesta conversa?');
  if (temSinal('Investidor')) perguntas.push('Qual forma de pagamento e qual prazo você tem em mente?');
  if (!fatos.vagas_declaradas) perguntas.push('Quantas vagas dá para reservar só para a recarga?');
  perguntas.push('Como é o movimento de carros no local ao longo do dia?');
  perguntas.push('Em que horário o local fica aberto ao público?');
  perguntas.push('A entrada de energia do local já foi avaliada por um eletricista?');

  const cuidados: string[] = [];
  if (fatos.situacao === 'CONFIRMAR ANTES') cuidados.push('Confirmar os pontos de atenção antes de apresentar a proposta.');
  if (temSinal('Sócio ou cônjuge')) cuidados.push('Não fechar condição sem quem decide junto na conversa.');
  if (temSinal('negociação')) cuidados.push('O local ainda não é dele: tratar a proposta como condicionada ao acordo com o proprietário.');

  const m = fatos.modelo_de_interesse;
  const sugerido: TextosIA['modelo_sugerido'] = m && /^0[1-5]$/.test(m) ? (m as TextosIA['modelo_sugerido'])
    : fatos.perfil === 'Investidor' ? '03' : '02';
  const porque = m && /^0[1-5]$/.test(m)
    ? `É o modelo que o cliente marcou no formulário. Confirmar se continua sendo o que ele quer.`
    : sugerido === '03'
      ? 'Investidor costuma querer o eletroposto próprio. Confirmar a forma de pagamento antes.'
      : 'Sem modelo marcado no formulário, a sociedade é o ponto de partida mais fácil de comparar.';

  return {
    resumo: resumo.slice(0, MAX.resumo),
    leitura_do_entorno: leitura.slice(0, MAX.leitura_do_entorno),
    perguntas: perguntas.slice(0, 5),
    cuidados: cuidados.slice(0, 3),
    modelo_sugerido: sugerido,
    porque_modelo: porque,
  };
}

// ── links ──────────────────────────────────────────────────────────────────

const coord = (x: number) => x.toFixed(6);

/** Maps URLs oficiais, sem chave. Abrem no app do Google Maps no celular. */
export function mapsUrls(lat: number, lng: number, placeId?: string | null, heading?: number | null) {
  const ll = `${coord(lat)}%2C${coord(lng)}`;
  return {
    abrir: `https://www.google.com/maps/search/?api=1&query=${ll}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ''}`,
    satelite: `https://www.google.com/maps/@?api=1&map_action=map&center=${ll}&zoom=19&basemap=satellite`,
    rua: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll}${heading != null ? `&heading=${Math.round(heading)}` : ''}`,
    rota: `https://www.google.com/maps/dir/?api=1&destination=${ll}`,
  };
}

export const mapsBuscaTexto = (texto: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}`;

export const mapsDoLugar = (placeId: string, nome: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nome)}&query_place_id=${encodeURIComponent(placeId)}`;

/** O texto que o CONSULTOR manda do próprio WhatsApp. O robô nunca manda isto. */
export function textoPedirLocalizacao(o: { primeiroNome: string; consultor: string; quando: string }): string {
  const oi = o.primeiroNome ? `Oi, ${o.primeiroNome}.` : 'Oi.';
  return `${oi} Aqui é o ${o.consultor}, da NEXUS Eletropostos, sobre a nossa conversa de ${dataCurtaBRT(o.quando)} às ${horaBRT(o.quando, ':')}. `
    + 'Para eu chegar com o estudo do seu ponto pronto, você consegue me mandar a localização do local por aqui? '
    + 'É só tocar no clipe e escolher Localização.';
}

export function linkPedirLocalizacao(telefone: string | null | undefined, texto: string): string | null {
  let d = String(telefone || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12) return null;
  return `wa.me/${d}?text=${encodeURIComponent(texto)}`;
}
