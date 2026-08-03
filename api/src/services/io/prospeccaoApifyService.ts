// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO — motor de busca de lead na Apify.
//
// Modelo de segurança (mesmo do geradorAutomacaoService): a tela /gerador/prospeccao
// é estática e usa a chave publishable, que é PÚBLICA. Então ela só escreve um
// PEDIDO em prospeccao_buscas. Quem gasta dinheiro na Apify é este arquivo, que só
// roda no servidor. As travas moram aqui, não na tela:
//   1. Kill-switch: PROSPECCAO_APIFY_OFF='true' → nenhum tick roda.
//   2. Fail-closed: sem APIFY_TOKEN, a busca vira 'erro' com recado claro. Nunca
//      tenta chamar a Apify sem credencial.
//   3. Cap de leads por busca (PROSPECCAO_MAX_LEADS, padrão 300).
//   4. Cap de buscas por dia (PROSPECCAO_MAX_BUSCAS_DIA, padrão 5).
// O cap é TETO DE GASTO, não autenticação: a chave anon é pública, então enfileirar
// é aberto — o que ninguém consegue é passar do teto. 5 × 300 × US$0,004 ≈ US$6/dia.
//
// O tick é chamado pelo cron (/cron/prospeccao-tick, CRON_SECRET) e pelo "kick" da
// tela, que só faz o que o cron faria. Uma busca por tick: a run da Apify é
// assíncrona, então o tick inicia, e os ticks seguintes olham o status e importam.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseGerador } from '../../utils/supabaseGerador';
import { logger } from '../../utils/logger';
import { codigoIbge, geocodificar, circuloGeoJson } from './prospeccaoBriefService';

const LOG = 'prospeccao-apify';
const APIFY = 'https://api.apify.com/v2';

// Teto por FONTE, porque o preço por registro é diferente e o teto é de GASTO,
// não de vaidade: Maps custa US$0,004 por lugar, a Receita custa US$0,0009 —
// 4,4× mais barato. 300 lugares no Maps (US$1,20) e 5.000 empresas na Receita
// (US$4,50) são pedidos de tamanho parecido em dinheiro.
const MAX_LEADS       = Number(process.env.PROSPECCAO_MAX_LEADS || 300);        // Maps e actor livre
const MAX_LEADS_CNPJ  = Number(process.env.PROSPECCAO_MAX_LEADS_CNPJ || 5000);  // Receita Federal
export const MAX_BUSCAS_DIA = Number(process.env.PROSPECCAO_MAX_BUSCAS_DIA || 30); // dá pra varrer o Brasil (27 UFs) num dia
export const ACTOR_CNPJ_ID = 'epicscrapers/brazil-cnpj-scraper';
export function tetoDaFonte(actorId: string): number {
  return actorId === ACTOR_CNPJ_ID ? MAX_LEADS_CNPJ : MAX_LEADS;
}
const LOCK_MS         = 4 * 60 * 1000;   // lease do tick
const RUN_TIMEOUT_S   = 900;             // 15 min de teto na run (a Apify mata sozinha)
const DATASET_PAGINA  = 500;
// Orçamento de tempo do tick (Vercel corta em 300s). Import grande não morre no
// meio: guarda o cursor, sai, e o tick seguinte continua de onde parou.
const TICK_MAX_MS     = 240000;

export const ACTOR_GOOGLE_MAPS = 'compass/crawler-google-places';

function desligado(): boolean {
  return (process.env.PROSPECCAO_APIFY_OFF || '').trim() === 'true';
}
function token(): string {
  return (process.env.APIFY_TOKEN || '').trim();
}

interface BuscaRow {
  id: string; criada_em: string; criada_por: string | null;
  fonte: string; actor_id: string; input: Record<string, unknown>;
  limite: number; so_celular: boolean;
  lista_nome: string; lista_origem: string | null; lista_id: string | null; lista_status: string | null;
  status: string; run_id: string | null; dataset_id: string | null;
  encontrados: number; importados: number; dup: number; sem_telefone: number;
  custo_usd: number; erro: string | null; cursor_offset: number | null;
}

// ── telefone ────────────────────────────────────────────────────────────────
// Espelha normalizeTelBR da tela: padroniza celular BR e NÃO inventa dígito em
// fixo. O DDI é garantido aqui porque o link do wa.me precisa dele.
export function normalizarTelefone(raw: unknown): string {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return '55' + d;
  if (d.length === 10 && '6789'.includes(d[2])) return '55' + d.slice(0, 2) + '9' + d.slice(2);
  if (d.length === 10) return '55' + d;                 // fixo: mantém como veio, com DDI
  return d.startsWith('55') && d.length >= 12 ? d : '';
}
export function ehCelular(tel: string): boolean {
  // 55 + DDD(2) + 9 + 8 dígitos = 13; o 9 na terceira casa é o que marca celular
  return tel.length === 13 && tel[4] === '9';
}

// ── UF ──────────────────────────────────────────────────────────────────────
// O Maps devolve "Bahia", não "BA". Sem esta tabela a coluna uf viraria "BA"
// cortando "Bahia" no braço — o que funciona pra Bahia e quebra pra "Minas Gerais".
const UF_POR_NOME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};
export function normalizarUf(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.length === 2) return s.toUpperCase();
  const chave = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return UF_POR_NOME[chave] || s.slice(0, 2).toUpperCase();
}

// ── mapeamento de campos ────────────────────────────────────────────────────
// O preset do Maps sempre cai nos nomes do compass/crawler-google-places. Os
// apelidos existem pro "actor livre": qualquer actor que devolva algo parecido
// com empresa+telefone vira lista sem precisar de código novo.
const CAMPOS = {
  empresa:    ['title', 'name', 'companyName', 'businessName', 'empresa', 'nome',
               'nome_fantasia', 'razao_social', 'fullName', 'username'],
  telefone:   ['phoneUnformatted', 'phone', 'phoneNumber', 'telephone', 'telefone', 'telefone1',
               'celular', 'whatsapp', 'contactPhone', 'public_phone_number', 'mobile', 'ddd_telefone_1'],
  cidade:     ['city', 'cidade', 'municipio', 'locality', 'addressLocality'],
  uf:         ['state', 'uf', 'estado', 'region', 'addressRegion'],
  site:       ['website', 'site', 'websiteUrl', 'domain', 'externalUrl'],
  nota:       ['totalScore', 'rating', 'stars', 'score'],
  avaliacoes: ['reviewsCount', 'userRatingsTotal', 'reviewCount', 'totalReviews', 'ratingCount'],
  endereco:   ['address', 'endereco', 'street', 'logradouro', 'fullAddress', 'streetAddress'],
  bairro:     ['neighborhood', 'bairro', 'district'],
  cep:        ['postalCode', 'cep', 'zip', 'zipCode'],
  categoria:  ['categoryName', 'categoria', 'category', 'cnae_principal_descricao', 'ramo', 'businessType'],
  email:      ['email', 'emails', 'contactEmail', 'publicEmail'],
  cnpj:       ['cnpj', 'taxId', 'documento'],
};

// O QSA da Receita vem como lista ("FULANO DE TAL — Sócio-Administrador" ou
// {nome_socio, qualificacao_socio}, depende do actor). Quem manda no posto é o
// administrador; na falta dele, o primeiro sócio. É esse nome que abre a porta.
export function extrairSocio(item: Record<string, unknown>): string | null {
  const qsa = (item.qsa || item.socios || item.partners) as unknown;
  if (!Array.isArray(qsa) || !qsa.length) return null;
  const nomeDe = (s: unknown): string => {
    if (typeof s === 'string') return s.split(/\s[—–-]\s|\s{2,}/)[0].trim();
    const o = (s || {}) as Record<string, unknown>;
    return String(o.nome_socio || o.nome || o.name || '').trim();
  };
  const ehAdmin = (s: unknown): boolean => {
    const txt = typeof s === 'string' ? s : JSON.stringify(s || {});
    return /administrador/i.test(txt);
  };
  const escolhido = qsa.find(ehAdmin) ?? qsa[0];
  const nome = nomeDe(escolhido);
  return nome ? nome.slice(0, 160) : null;
}
function pegar(item: Record<string, unknown>, chaves: string[]): unknown {
  for (const k of chaves) {
    const v = item[k];
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) { if (v.length && v[0]) return v[0]; continue; }
    if (typeof v === 'object') continue;
    return v;
  }
  // arrays de contato ("phones", "emails") que alguns actors devolvem
  for (const k of chaves) {
    const v = item[k + 's'];
    if (Array.isArray(v) && v.length && v[0]) return v[0];
  }
  return null;
}
function numero(v: unknown): number | null {
  const n = Number(String(v ?? '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Guarda o item CRU pra nada se perder. Reviews e imagens só entram quando o
// consultor pagou por elas; mesmo assim, linha de banco não é lugar de megabyte:
// acima de 60KB o que é volumoso sai e a linha fica marcada como podada, em vez
// de a busca inteira falhar num INSERT gigante.
const LIMITE_DADOS = 60000;
function payload(item: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(item).length <= LIMITE_DADOS) return item;
  const podado: Record<string, unknown> = { ...item, _podado: true };
  for (const k of ['reviews', 'imageUrls', 'questionsAndAnswers', 'popularTimesHistogram', 'peopleAlsoSearch']) {
    delete podado[k];
  }
  return JSON.stringify(podado).length <= LIMITE_DADOS
    ? podado
    : { _podado: true, _motivo: 'item maior que o limite', title: item.title, placeId: item.placeId };
}

export interface ContatoMapeado {
  empresa: string; telefone: string; cidade: string | null; uf: string | null;
  nota: number | null; avaliacoes: number | null; site: string | null;
  endereco: string | null; bairro: string | null; cep: string | null;
  categoria: string | null; email: string | null;
  lat: number | null; lng: number | null;
  maps_url: string | null; place_id: string | null;
  socio: string | null; cnpj: string | null;
  dados: Record<string, unknown>;
}
export function mapearItem(item: Record<string, unknown>): ContatoMapeado | null {
  const empresa = String(pegar(item, CAMPOS.empresa) ?? '').trim();
  if (!empresa) return null;
  const telefone = normalizarTelefone(pegar(item, CAMPOS.telefone));
  if (!telefone) return null;
  const nota = numero(pegar(item, CAMPOS.nota));
  const loc = (item.location || {}) as { lat?: number; lng?: number };
  const txt = (v: unknown, max = 240) => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : null;
  };
  return {
    empresa: empresa.slice(0, 160),
    telefone,
    cidade: txt(pegar(item, CAMPOS.cidade), 120),
    uf: normalizarUf(pegar(item, CAMPOS.uf)),
    nota: nota !== null && nota <= 5 ? Math.round(nota * 10) / 10 : null,
    avaliacoes: numero(pegar(item, CAMPOS.avaliacoes)),
    site: txt(pegar(item, CAMPOS.site)),
    // ── ficha do Google: vem no MESMO preço por lugar, então não guardar era só desperdício
    endereco: txt(pegar(item, CAMPOS.endereco)),
    bairro: txt(pegar(item, CAMPOS.bairro), 120),
    cep: txt(pegar(item, CAMPOS.cep), 20),
    categoria: txt(pegar(item, CAMPOS.categoria), 120),
    email: txt(pegar(item, CAMPOS.email)),           // só existe com o add-on de contatos
    lat: typeof loc.lat === 'number' ? loc.lat : numero(item.lat),
    lng: typeof loc.lng === 'number' ? loc.lng : numero(item.lng),
    maps_url: txt(item.url, 500),
    place_id: txt(item.placeId, 120),
    socio: extrairSocio(item),                                  // o dono, quando a fonte tem QSA
    cnpj: (String(pegar(item, CAMPOS.cnpj) ?? '').replace(/\D/g, '') || null),
    dados: payload(item),
  };
}
// Lugar fechado não recebe prospecção — e filtrar aqui é de graça, enquanto pedir
// o filtro pra Apify custa por lugar.
function fechado(item: Record<string, unknown>): boolean {
  return item.permanentlyClosed === true || item.temporarilyClosed === true;
}

// ── Apify ───────────────────────────────────────────────────────────────────
async function apify(path: string, init?: RequestInit): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${APIFY}${path}${sep}token=${encodeURIComponent(token())}`, init);
  const txt = await r.text();
  if (!r.ok) throw new Error(`Apify ${r.status}: ${txt.slice(0, 300)}`);
  return txt ? JSON.parse(txt) : null;
}

async function marcar(id: string, patch: Record<string, unknown>): Promise<void> {
  await supabaseGerador.from('prospeccao_buscas')
    .update({ ...patch, atualizada_em: new Date().toISOString() })
    .eq('id', id);
}

// Cancelar na tela só muda o status no banco — e run da Apify que continua rodando
// continua CUSTANDO. Então quem cancela de verdade é aqui: aborta a run lá.
async function abortarCanceladas(): Promise<void> {
  if (!token()) return;
  const { data } = await supabaseGerador
    .from('prospeccao_buscas')
    .select('id, run_id')
    .eq('status', 'cancelada')
    .is('erro', null)
    .not('run_id', 'is', null)
    .limit(3);
  for (const c of (data ?? []) as { id: string; run_id: string }[]) {
    let nota = 'Cancelada — run abortada na Apify.';
    try { await apify(`/actor-runs/${c.run_id}/abort`, { method: 'POST' }); }
    catch (err: any) { nota = `Cancelada. A run já não estava mais rodando (${String(err?.message || err).slice(0, 120)}).`; }
    await marcar(c.id, { erro: nota, locked_until: null });
  }
}

// ── tick ────────────────────────────────────────────────────────────────────
export interface TickResult {
  ok: boolean; off?: boolean; ociosa?: boolean; processadas?: number;
  busca?: string; status?: string; detalhe?: string;
}

// Varredura nacional são 27 buscas, e cada uma precisa de pelo menos três passadas
// (começar, acompanhar, importar). Uma busca por tick de 5 min levaria a madrugada
// inteira. Então o tick trabalha até acabar o orçamento de tempo — sem nunca
// tocar duas vezes na mesma busca no mesmo tick, que só queimaria chamada à Apify
// perguntando de novo se a run já acabou.
export async function runProspeccaoApifyTick(): Promise<TickResult> {
  if (desligado()) return { ok: true, off: true };
  await abortarCanceladas();

  const prazo = Date.now() + TICK_MAX_MS;
  const jaVistas = new Set<string>();
  let ultimo: TickResult = { ok: true, ociosa: true };
  let processadas = 0;

  while (Date.now() < prazo - 20000 && processadas < 12) {
    const r = await processarUma(prazo, jaVistas);
    if (r.ociosa) break;
    ultimo = r; processadas++;
  }
  return processadas ? { ...ultimo, processadas } : { ok: true, ociosa: true };
}

async function processarUma(prazo: number, jaVistas: Set<string>): Promise<TickResult> {
  const agora = new Date();
  const { data: pendentes } = await supabaseGerador
    .from('prospeccao_buscas')
    .select('*')
    .in('status', ['pedida', 'rodando', 'importando'])
    .or(`locked_until.is.null,locked_until.lt.${agora.toISOString()}`)
    // janela maior que a fila de uma varredura nacional (27 UFs): com janela
    // curta, as últimas da fila nunca apareciam e ficavam esperando as primeiras
    // saírem — o Roraima da vida só rodava no fim de tudo.
    .order('criada_em', { ascending: true })
    .limit(60);

  const busca = ((pendentes ?? []) as BuscaRow[]).find(b => !jaVistas.has(b.id));
  if (!busca) return { ok: true, ociosa: true };
  jaVistas.add(busca.id);

  // lease: se outro tick pegou nesse meio tempo, o update não acha a linha
  const lease = new Date(Date.now() + LOCK_MS).toISOString();
  const { data: travada } = await supabaseGerador
    .from('prospeccao_buscas')
    .update({ locked_until: lease })
    .eq('id', busca.id)
    .or(`locked_until.is.null,locked_until.lt.${agora.toISOString()}`)
    .select('id');
  if (!travada || !travada.length) return { ok: true, ociosa: true };

  try {
    if (busca.status === 'pedida')    return await iniciar(busca);
    if (busca.status === 'rodando')   return await acompanhar(busca);
    if (busca.status === 'importando')return await importar(busca, prazo);
    return { ok: true, ociosa: true };
  } catch (err: any) {
    const detalhe = String(err?.message || err).slice(0, 500);
    // Tropeço passageiro (limite de runs simultâneas, instabilidade, timeout de
    // rede) NÃO queima a busca: com 27 estados na fila, um 429 no meio apagaria
    // metade da varredura e ninguém ia entender por quê. Só erro de verdade —
    // input inválido, actor inexistente — vira 'erro'.
    const passageiro = /Apify (429|5\d\d)|fetch failed|ETIMEDOUT|ECONNRESET|socket hang up/i.test(detalhe);
    if (passageiro) {
      logger.warn(LOG, `busca ${busca.id} tropeçou, vai tentar de novo`, detalhe);
      await marcar(busca.id, { erro: `Tentando de novo: ${detalhe}`, locked_until: null });
      return { ok: false, busca: busca.id, status: busca.status, detalhe };
    }
    logger.error(LOG, `busca ${busca.id} falhou`, err);
    await marcar(busca.id, { status: 'erro', erro: detalhe, locked_until: null });
    return { ok: false, busca: busca.id, status: 'erro', detalhe };
  }
}

async function iniciar(busca: BuscaRow): Promise<TickResult> {
  if (!token()) {
    // Falta de token é problema de CONFIGURAÇÃO do servidor, não do pedido. Se
    // marcasse 'erro', quem enfileirou 27 estados perderia os 27 e teria que
    // refazer tudo depois de cadastrar a chave. Fica 'pedida' com o recado na
    // tela e sai sozinha assim que o token existir — retentar não custa nada.
    await marcar(busca.id, {
      locked_until: null,
      erro: 'Esperando o APIFY_TOKEN no servidor. Console da Apify → Settings → ' +
            'Integrations → API token, e cadastre como APIFY_TOKEN no projeto solardocs-api. ' +
            'Assim que existir, esta busca sai sozinha.',
    });
    return { ok: false, busca: busca.id, status: 'pedida', detalhe: 'sem APIFY_TOKEN' };
  }

  // cap de buscas por dia: conta as que já GASTARAM (começaram a rodar) hoje
  const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
  const { count } = await supabaseGerador
    .from('prospeccao_buscas')
    .select('id', { count: 'exact', head: true })
    .gte('criada_em', inicioDia.toISOString())
    .in('status', ['rodando', 'importando', 'concluida']);
  if ((count ?? 0) >= MAX_BUSCAS_DIA) {
    await marcar(busca.id, {
      status: 'erro', locked_until: null,
      erro: `Teto de ${MAX_BUSCAS_DIA} buscas por dia atingido. Amanhã libera, ou suba ` +
            `PROSPECCAO_MAX_BUSCAS_DIA no servidor.`,
    });
    return { ok: false, busca: busca.id, status: 'erro', detalhe: 'cap diário' };
  }

  const limite = Math.max(1, Math.min(tetoDaFonte(busca.actor_id), Number(busca.limite) || 50));
  const input: Record<string, unknown> = { ...(busca.input || {}) };
  if (busca.actor_id === ACTOR_GOOGLE_MAPS) {
    input.maxCrawledPlacesPerSearch = limite;
    input.language = input.language || 'pt-BR';
    input.countryCode = input.countryCode || 'br';
    // "300 km de Uberlândia" vira polígono: o Maps não entende raio, entende área.
    const raio = Number(input.raio_km || 0);
    const centro = String(input.centro || '').trim();
    delete input.raio_km; delete input.centro;
    if (raio > 0 && centro) {
      const ponto = await geocodificar(centro);
      if (ponto) {
        input.customGeolocation = circuloGeoJson(ponto.lat, ponto.lng, raio);
        delete input.locationQuery;      // a área manda; texto junto confunde o actor
        logger.info(LOG, `raio de ${raio}km em ${centro}`, { ...ponto, busca: busca.id });
      } else {
        logger.warn(LOG, `não achei "${centro}" no mapa — busca segue pelo texto do local`, { busca: busca.id });
      }
    }
  } else {
    if (input.maxItems === undefined) input.maxItems = limite;
    // A Receita filtra município por CÓDIGO IBGE. A tela manda o NOME (é o que o
    // consultor sabe); a conversão é aqui, contra a API do IBGE — nome que não
    // existe vira busca do estado inteiro, e não busca da cidade errada.
    const nome = String(input.municipio_nome || '').trim();
    if (nome) {
      delete input.municipio_nome;
      if (/^\d+$/.test(nome)) {
        input.municipio = nome;                       // já veio o código, não precisa consultar
      } else {
        const codigo = await codigoIbge(String(input.uf || ''), nome);
        if (codigo) input.municipio = codigo;
        else logger.warn(LOG, `município "${nome}" não achado no IBGE — busca vai pelo estado`, { busca: busca.id });
      }
    }
  }

  const actorPath = busca.actor_id.replace('/', '~');
  const run = await apify(
    `/acts/${actorPath}/runs?timeout=${RUN_TIMEOUT_S}&maxItems=${limite}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
  );
  const d = run?.data || {};
  await marcar(busca.id, {
    status: 'rodando', run_id: d.id, dataset_id: d.defaultDatasetId, erro: null, locked_until: null,
  });
  logger.info(LOG, `busca ${busca.id} iniciada na Apify`, { run: d.id, actor: busca.actor_id, limite });
  return { ok: true, busca: busca.id, status: 'rodando' };
}

async function acompanhar(busca: BuscaRow): Promise<TickResult> {
  if (!busca.run_id) { await marcar(busca.id, { status: 'pedida', locked_until: null }); return { ok: true, busca: busca.id, status: 'pedida' }; }
  const run = await apify(`/actor-runs/${busca.run_id}`);
  const st = String(run?.data?.status || '');
  const custo = Number(run?.data?.usageTotalUsd || 0);

  if (st === 'SUCCEEDED') {
    await marcar(busca.id, {
      status: 'importando', custo_usd: custo,
      dataset_id: busca.dataset_id || run?.data?.defaultDatasetId, locked_until: null,
    });
    return { ok: true, busca: busca.id, status: 'importando' };
  }
  if (['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMING-OUT'].includes(st)) {
    await marcar(busca.id, {
      status: 'erro', custo_usd: custo, locked_until: null,
      erro: `A run terminou como ${st}. Veja em https://console.apify.com/actors/runs/${busca.run_id}`,
    });
    return { ok: false, busca: busca.id, status: 'erro', detalhe: st };
  }
  await marcar(busca.id, { custo_usd: custo, locked_until: null });   // ainda rodando
  return { ok: true, busca: busca.id, status: 'rodando', detalhe: st };
}

// Importa o dataset em páginas, com CURSOR. Se o orçamento do tick acabar no meio,
// sai deixando a busca em 'importando' com o cursor salvo — o tick seguinte continua
// de onde parou, em vez de morrer no timeout do Vercel ou reimportar tudo.
async function importar(busca: BuscaRow, prazo: number): Promise<TickResult> {
  if (!busca.dataset_id) throw new Error('busca sem dataset_id');

  let offset      = Number(busca.cursor_offset || 0);
  let encontrados = Number(busca.encontrados || 0);
  let importados  = Number(busca.importados || 0);
  let dup         = Number(busca.dup || 0);
  let semTelefone = Number(busca.sem_telefone || 0);
  let listaId     = busca.lista_id;
  let fim         = false;
  const teto      = tetoDaFonte(busca.actor_id) * 2;   // dataset pode trazer mais que o pedido

  while (!fim && offset < teto) {
    const pagina = await apify(
      `/datasets/${busca.dataset_id}/items?clean=true&offset=${offset}&limit=${DATASET_PAGINA}`,
    );
    const itens: Record<string, unknown>[] = Array.isArray(pagina) ? pagina : [];
    if (itens.length < DATASET_PAGINA) fim = true;
    if (!itens.length) break;

    // mapeia: fora fechado, sem telefone e fixo (quando a busca é só celular)
    const vistos = new Set<string>();
    const contatos: ContatoMapeado[] = [];
    for (const item of itens) {
      encontrados++;
      if (fechado(item)) { semTelefone++; continue; }
      const c = mapearItem(item);
      if (!c) { semTelefone++; continue; }
      if (busca.so_celular && !ehCelular(c.telefone)) { semTelefone++; continue; }
      if (vistos.has(c.telefone)) { dup++; continue; }
      vistos.add(c.telefone);
      contatos.push(c);
    }
    offset += itens.length;

    if (contatos.length) {
      // a lista só nasce quando existe contato pra colocar dentro dela
      if (!listaId) {
        const { data: lista, error } = await supabaseGerador
          .from('prospeccao_listas')
          .insert({
            nome: busca.lista_nome, origem: busca.lista_origem || 'Apify', custo: 0,
            // varredura grande nasce pausada: guarda o dado sem despejar tudo na fila
            status: busca.lista_status === 'pausada' ? 'pausada' : 'ativa',
          })
          .select('id').single();
        if (error) throw new Error(`erro criando lista: ${error.message}`);
        listaId = lista!.id as string;
      }
      for (let i = 0; i < contatos.length; i += 200) {
        const lote = contatos.slice(i, i + 200).map(c => ({ ...c, lista_id: listaId }));
        // ignora telefone que já existe em QUALQUER lista (índice único)
        const { data, error } = await supabaseGerador
          .from('prospeccao_contatos')
          .upsert(lote, { onConflict: 'telefone', ignoreDuplicates: true })
          .select('id');
        if (error) throw new Error(`erro inserindo contatos: ${error.message}`);
        const novos = (data ?? []).length;
        importados += novos;
        dup += lote.length - novos;
      }
    }

    await marcar(busca.id, {
      lista_id: listaId, cursor_offset: offset,
      encontrados, importados, dup, sem_telefone: semTelefone,
    });

    if (!fim && Date.now() > prazo) {
      await marcar(busca.id, { locked_until: null });   // continua no próximo tick
      logger.info(LOG, `busca ${busca.id} pausada no cursor ${offset}`, { importados });
      return { ok: true, busca: busca.id, status: 'importando', detalhe: `cursor ${offset}` };
    }
  }

  await marcar(busca.id, {
    status: 'concluida', encontrados, importados, dup, sem_telefone: semTelefone,
    cursor_offset: offset, locked_until: null,
    erro: importados ? null : 'A busca rodou, mas nenhum resultado tinha telefone utilizável.',
  });
  logger.info(LOG, `busca ${busca.id} importada`, { importados, dup, semTelefone });
  return { ok: true, busca: busca.id, status: 'concluida', detalhe: `${importados} importados` };
}
