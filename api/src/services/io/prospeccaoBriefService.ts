// ─────────────────────────────────────────────────────────────────────────────
// PROSPECÇÃO — "descreve a lista que você quer" vira busca pronta.
//
// O consultor escreve em português ("postos de combustível em Uberlândia, quero
// falar com o dono") e a IA escolhe a FONTE e monta o input do actor. Ela NÃO
// dispara nada: devolve um plano que aparece preenchido no formulário, pro humano
// conferir e mandar. Quem gasta continua sendo o motor, com os mesmos tetos.
//
// Regra de ouro deste arquivo: a IA escolhe, o CÓDIGO valida. Tudo que é
// verificável — teto de leads, código IBGE do município, add-on caro, custo — é
// resolvido aqui depois, não confiado ao modelo. Modelo erra em silêncio; teto não.
// ─────────────────────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../utils/logger';

const LOG = 'prospeccao-brief';
const MODELO = 'claude-sonnet-4-6';           // mesmo modelo do resto da casa
const MAX_LEADS = Number(process.env.PROSPECCAO_MAX_LEADS || 300);

export const ACTOR_MAPS = 'compass/crawler-google-places';
export const ACTOR_CNPJ = 'epicscrapers/brazil-cnpj-scraper';

// Add-ons que NUNCA saem daqui automaticamente: custam 25× o resto e devolvem
// dado pessoal de indivíduo (nome, celular e e-mail de funcionário). Se um dia
// for usar, é decisão consciente na tela, não sugestão de modelo.
const PROIBIDOS = ['maximumLeadsEnrichmentRecords', 'verifyLeadsEnrichmentEmails',
                   'leadsEnrichmentDepartments', 'scrapeSocialMediaProfiles'];

export interface PlanoBusca {
  fonte: 'google_maps' | 'receita_cnpj' | 'actor';
  actor_id: string;
  input: Record<string, unknown>;
  limite: number;
  so_celular: boolean;
  lista_nome: string;
  lista_origem: string;
  explicacao: string;
  avisos: string[];
  custo_estimado_usd: number;
  municipio_label?: string;   // nome da cidade pra MOSTRAR (o input leva o código IBGE)
}

const SISTEMA = `Você monta buscas de lead para uma equipe de vendas brasileira que vende
para empresas (integradores solares, postos de combustível, comércio em geral) e fala com
elas por WhatsApp.

Você tem DUAS fontes. Escolha a que responde ao pedido; se as duas servirem, escolha a que
entrega o que o pedido enfatiza.

FONTE 1 — "google_maps" (actor compass/crawler-google-places)
Entrega: nome, telefone (geralmente CELULAR, que é o que serve pra WhatsApp), endereço,
bairro, cidade, estado, coordenada, categoria, nota e nº de avaliações, site, horário.
NÃO entrega: CNPJ, nome do dono/sócio.
Campos de input que você pode usar:
- searchStringsArray: array de termos de busca, como se digitasse no Google Maps. Prefira 1 a 3 termos.
- locationQuery: texto livre do lugar ("Uberlândia, MG" ou "Bahia, Brasil"). Pode ser um estado inteiro.
- maxCrawledPlacesPerSearch: número de lugares por termo.
- categoryFilterWords: array de categorias do Google (custa mais). Use só se o pedido exigir precisão de ramo.
- searchMatching: "all" | "only_includes" | "only_exact" (custa mais quando não é "all").
- placeMinimumStars: "" | "two" | "twoAndHalf" | "three" | "threeAndHalf" | "four" | "fourAndHalf" (custa mais).
- website: "allPlaces" | "withWebsite" | "withoutWebsite" (custa mais). "withoutWebsite" é ótimo pra vender site.
- skipClosedPlaces: booleano (custa mais; nós já descartamos fechados de graça, então deixe false).
- scrapePlaceDetailPage: booleano (+US$0,002/lugar) — horário, distribuição das notas.
- scrapeContacts: booleano (+US$0,002/lugar) — e-mail e redes sociais tirados do site da empresa.

FONTE 2 — "receita_cnpj" (actor epicscrapers/brazil-cnpj-scraper)
Entrega: razão social, nome fantasia, CNPJ, endereço completo, e-mail e telefone do cadastro,
porte, capital social, situação cadastral e **QSA — o nome dos sócios**. É a única fonte que
diz QUEM É O DONO.
NÃO entrega: nota do Google, e o telefone costuma ser FIXO (escritório/contador), não WhatsApp.
Campos de input:
- cnae: código CNAE só dígitos. Exemplos: 4731800 = postos de combustível (varejo);
  4322301 = instalação hidráulica; 4321500 = instalação elétrica; 4741500 = material de construção;
  4711302 = supermercado; 5611201 = restaurante; 4520001 = oficina mecânica.
- uf: sigla de 2 letras.
- municipio_nome: NOME da cidade (nós convertemos pro código IBGE; nunca invente código).
- naturezaJuridica: código, opcional.
- partnerCpf: CPF mascarado do sócio, pra achar todas as empresas da mesma pessoa. Só se o pedido pedir.
- maxItems: quantos registros.

REGRAS
- Quando o pedido fala em "falar com o dono", "sócio", "proprietário", "CNPJ": use receita_cnpj.
- Quando fala em WhatsApp, avaliação, nota, endereço no mapa, ou não menciona dono: use google_maps.
- so_celular: true para google_maps; false para receita_cnpj (senão a lista volta vazia, porque
  telefone de cadastro é fixo).
- lista_nome: curto e reconhecível, com o que e onde. Ex: "Postos — Uberlândia (Receita)".
- avisos: diga em português o que essa fonte NÃO vai entregar e o que o consultor deve esperar.
  Seja concreto (ex: "telefone é fixo, não WhatsApp"). Um a três avisos.
- explicacao: uma frase dizendo por que escolheu essa fonte e esses filtros.
- Nunca use campos que não estão listados acima.

Responda SOMENTE com um objeto JSON, sem texto em volta, neste formato:
{"fonte":"google_maps|receita_cnpj","input":{...},"limite":número,"so_celular":booleano,
 "lista_nome":"...","explicacao":"...","avisos":["..."]}`;

function extrairJson(texto: string): Record<string, unknown> {
  const t = texto.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* segue */ }
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i >= 0 && f > i) return JSON.parse(t.slice(i, f + 1));
  throw new Error('a IA não devolveu JSON');
}

// Código IBGE do município — resolvido AQUI, contra a API do IBGE, porque código
// inventado pelo modelo devolveria a lista da cidade errada sem ninguém perceber.
export async function codigoIbge(uf: string, nome: string): Promise<string | null> {
  if (!uf || !nome) return null;
  const norm = (s: string) => s.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  try {
    const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${encodeURIComponent(uf)}/municipios`);
    if (!r.ok) return null;
    const lista = await r.json() as { id: number; nome: string }[];
    const achado = lista.find(m => norm(m.nome) === norm(nome));
    return achado ? String(achado.id) : null;
  } catch (err) {
    logger.warn(LOG, 'IBGE indisponível', err);
    return null;
  }
}

export function custoEstimado(fonte: string, limite: number, input: Record<string, unknown>): number {
  if (fonte === 'receita_cnpj') return limite * 0.0009 + 0.00005;
  const filtros = ['categoryFilterWords', 'placeMinimumStars', 'skipClosedPlaces']
    .filter(k => input[k] && (!Array.isArray(input[k]) || (input[k] as unknown[]).length)).length
    + (input.website && input.website !== 'allPlaces' ? 1 : 0)
    + (input.searchMatching && input.searchMatching !== 'all' ? 1 : 0);
  const addons = (input.scrapePlaceDetailPage ? 1 : 0) + (input.scrapeContacts ? 1 : 0);
  return limite * (0.004 + filtros * 0.001 + addons * 0.002) + 0.00005;
}

export async function montarBusca(brief: string): Promise<PlanoBusca> {
  const texto = String(brief || '').trim();
  if (texto.length < 8) throw new Error('descreva a lista com um pouco mais de detalhe');
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada no servidor — monte a busca pelos filtros');
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await anthropic.messages.create({
    model: MODELO,
    max_tokens: 1200,
    system: SISTEMA,
    messages: [{ role: 'user', content: texto.slice(0, 2000) }],
  });
  const bloco = resp.content[0];
  const bruto = extrairJson(bloco && bloco.type === 'text' ? bloco.text : '');

  // ── daqui pra baixo é o código que manda, não o modelo ──────────────────────
  const fonte: PlanoBusca['fonte'] = bruto.fonte === 'receita_cnpj' ? 'receita_cnpj' : 'google_maps';
  const input: Record<string, unknown> = { ...(bruto.input as Record<string, unknown> || {}) };
  PROIBIDOS.forEach(k => delete input[k]);

  const limite = Math.max(1, Math.min(MAX_LEADS, Number(bruto.limite) || 50));
  const avisos: string[] = Array.isArray(bruto.avisos)
    ? (bruto.avisos as unknown[]).map(a => String(a)).slice(0, 3) : [];

  if (fonte === 'google_maps') {
    input.language = 'pt-BR';
    input.countryCode = 'br';
    input.maxCrawledPlacesPerSearch = limite;
    input.skipClosedPlaces = false;            // fechado a gente descarta de graça no import
    if (!Array.isArray(input.searchStringsArray) || !input.searchStringsArray.length) {
      throw new Error('a IA não definiu o que buscar — descreva o ramo e a região');
    }
  } else {
    input.maxItems = limite;
    if (input.cnae) input.cnae = String(input.cnae).replace(/\D/g, '');
    if (input.uf) input.uf = String(input.uf).toUpperCase().slice(0, 2);
    const nomeMunicipio = String(input.municipio_nome || input.municipio || '').trim();
    delete input.municipio_nome;
    if (nomeMunicipio && /\D/.test(nomeMunicipio)) {
      const codigo = await codigoIbge(String(input.uf || ''), nomeMunicipio);
      if (codigo) input.municipio = codigo;
      else {
        delete input.municipio;
        avisos.push(`Não achei o código IBGE de "${nomeMunicipio}" — a busca vai pegar o estado inteiro.`);
      }
    }
    if (!input.cnae && !input.partnerCpf && !input.cnpj) {
      throw new Error('a IA não definiu o CNAE — diga o ramo (ex: postos de combustível)');
    }
  }

  const municipioLabel = fonte === 'receita_cnpj'
    ? String((bruto.input as Record<string, unknown> || {}).municipio_nome || '').trim() || undefined
    : undefined;
  const soCelular = fonte === 'receita_cnpj' ? false : bruto.so_celular !== false;
  // o aviso do telefone fixo é obrigatório — mas o modelo quase sempre já dá o
  // recado. Repetir com outras palavras faz a lista de avisos parecer descuidada.
  if (fonte === 'receita_cnpj' && !avisos.some(a => /fixo/i.test(a))) {
    avisos.push('Telefone da Receita costuma ser fixo (escritório ou contador) — serve pra ligar, não pra WhatsApp.');
  }

  const plano: PlanoBusca = {
    fonte,
    actor_id: fonte === 'receita_cnpj' ? ACTOR_CNPJ : ACTOR_MAPS,
    input,
    limite,
    so_celular: soCelular,
    lista_nome: String(bruto.lista_nome || texto.slice(0, 60)).slice(0, 90),
    lista_origem: fonte === 'receita_cnpj' ? 'Apify · Receita Federal' : 'Apify · Google Maps',
    explicacao: String(bruto.explicacao || '').slice(0, 400),
    avisos: [...new Set(avisos)].slice(0, 4),
    custo_estimado_usd: Number(custoEstimado(fonte, limite, input).toFixed(4)),
    municipio_label: municipioLabel,
  };
  logger.info(LOG, 'plano montado', { fonte: plano.fonte, limite: plano.limite });
  return plano;
}
