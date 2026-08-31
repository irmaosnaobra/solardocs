/**
 * Transforma o produto cru do fornecedor na bike que a loja mostra.
 *
 * Regra que vale para tudo aqui: a ficha técnica é COPIADA, nunca reescrita.
 * O que o fabricante não informou fica de fora. Não se inventa autonomia,
 * peso nem bateria para "completar" o card.
 */

import type { ProdutoBruto } from './soollar.ts';
import { urlsDasImagens } from './soollar.ts';
import type { ItemFicha } from '../types/bike.ts';

const ENTIDADES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/** HTML do editor do fornecedor -> texto com uma informação por linha. */
export function htmlParaLinhas(html: string | null | undefined): string[] {
  if (!html) return [];
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#?\w+;/g, (e) => ENTIDADES[e.toLowerCase()] ?? ' ')
    // O fabricante escreve faixa com travessao ("100-240V" com o traco longo).
    // Ninguem digita isso, entao vira "a". So faixa entre numeros: qualquer
    // outra troca cega estragaria o texto dele.
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 a $2')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Pesca os pares "Rótulo: valor" que o fabricante escreveu. */
export function fichaDoHtml(html: string | null | undefined): ItemFicha[] {
  const itens: ItemFicha[] = [];
  for (const linha of htmlParaLinhas(html)) {
    const m = linha.match(/^([^:]{2,42}):\s*(.+)$/);
    if (!m) continue;
    const rotulo = m[1].trim();
    // Alguns cadastros vêm com dois-pontos sobrando ("Pneus/Rodas: : 3.0*10").
    const valor = m[2].replace(/^[:\s]+/, '').trim();
    if (!valor || valor === '-') continue;
    if (/^cod$/i.test(rotulo)) continue;
    itens.push({ rotulo, valor });
  }
  return itens;
}

function juntarFichas(...listas: ItemFicha[][]): ItemFicha[] {
  const vistos = new Map<string, ItemFicha>();
  const valores = new Set<string>();
  for (const lista of listas) {
    for (const item of lista) {
      const chave = item.rotulo.toLowerCase().replace(/[^a-zà-ÿ]/g, '');
      const valor = item.valor.toLowerCase();
      // "Bateria" e "Bateria/Voltagem" vêm com o mesmo texto: mostra uma vez.
      if (vistos.has(chave) || valores.has(valor)) continue;
      vistos.set(chave, item);
      valores.add(valor);
    }
  }
  return [...vistos.values()];
}

function daFicha(ficha: ItemFicha[], ...rotulos: string[]): string | null {
  for (const alvo of rotulos) {
    const achado = ficha.find((i) => i.rotulo.toLowerCase().startsWith(alvo.toLowerCase()));
    if (achado) return achado.valor;
  }
  return null;
}

const MIUDAS = new Set(['de', 'da', 'do', 'e', 'com', 'sem', 'para', 'em']);

/** Acentos que o cadastro do fornecedor não usa mas o cliente espera ler. */
const ACENTOS: Record<string, string> = {
  eletrica: 'Elétrica',
  eletrico: 'Elétrico',
  litio: 'Lítio',
  bateria: 'Bateria',
  aluminio: 'Alumínio',
  hidraulico: 'Hidráulico',
  ingles: 'Inglês',
  inglesa: 'Inglesa',
};

function titulizarPalavra(p: string, primeira: boolean): string {
  const limpo = p.toLowerCase();
  if (ACENTOS[limpo]) return ACENTOS[limpo];
  // Códigos e medidas ficam como estão: 750W, 48V, PX-FT04, 18,2AH, MG-16.
  if (/\d/.test(p)) return p.toUpperCase();
  if (p.length <= 3 && p === p.toUpperCase() && !MIUDAS.has(limpo)) return p;
  if (!primeira && MIUDAS.has(limpo)) return limpo;
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

export function titulizar(texto: string): string {
  return texto
    .split(/\s+/)
    .filter(Boolean)
    .map((p, i) =>
      // "PRETO/BRANCO" são duas palavras coladas: cada lado ganha maiúscula.
      p.includes('/')
        ? p
            .split('/')
            .map((parte) => titulizarPalavra(parte, true))
            .join('/')
        : titulizarPalavra(p, i === 0),
    )
    .join(' ');
}

export function paraSlug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "PREVISÃO 28/08 - SCOOTER..." -> { previsao: "28/08", resto: "SCOOTER..." } */
function separarPrevisao(nome: string): { previsao: string | null; resto: string } {
  const m = nome.match(/^PREVIS[ÃA]O\s+(\d{2}\/\d{2})\s*-\s*(.+)$/i);
  return m ? { previsao: m[1], resto: m[2] } : { previsao: null, resto: nome };
}

/**
 * O nome do fornecedor é um bloco só: modelo + cor + bateria + marca + código.
 * Para o título a gente corta na parte técnica, que já aparece na ficha.
 */
function tituloComercial(nomeSemPrevisao: string): string {
  const corte = nomeSemPrevisao.split(/\s+BATERIA\s+DE\s+/i)[0].split(/\s+MARCA\s+/i)[0];
  return titulizar(corte.trim().replace(/\s*-\s*$/, ''));
}

function marcaDoNome(nome: string): string | null {
  const m = nome.match(/MARCA\s+([A-Z0-9ÀÁÂÃÉÊÍÓÔÕÚÇ][A-Z0-9ÀÁÂÃÉÊÍÓÔÕÚÇ&.\s-]*?)(?:\s+-\s+\S+)?\s*$/i);
  if (!m) return null;
  return titulizar(m[1].trim());
}

function categoriaDoNome(nome: string): string {
  const n = nome.toUpperCase();
  if (n.includes('SCOOTER')) return 'Scooter elétrica';
  if (n.includes('BICICLETA')) return 'Bicicleta elétrica';
  if (n.includes('PATINETE')) return 'Patinete elétrico';
  return 'Elétrico';
}

/** "101 kg", "66 kg" -> 101, 66. Nulo quando o fabricante nao informou. */
function pesoDaFicha(ficha: ItemFicha[]): number | null {
  const bruto = daFicha(ficha, 'Peso Líquido', 'Peso Liquido', 'Peso');
  if (!bruto) return null;
  const m = bruto.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*kg/i);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * "149x44x83 cm" -> 0.5442 m3. É o número que manda no frete: bike ocupa muito
 * espaço para o que pesa, e transportadora cobra pelo espaço.
 */
function volumeDaFicha(ficha: ItemFicha[]): number | null {
  const bruto = daFicha(ficha, 'Dimensões', 'Dimensoes', 'Medidas');
  if (!bruto) return null;
  const m = bruto
    .replace(',', '.')
    .match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) return null;
  const emMetros = bruto.toLowerCase().includes('mm') ? 1000 : 100;
  const v = (Number(m[1]) / emMetros) * (Number(m[2]) / emMetros) * (Number(m[3]) / emMetros);
  return Number.isFinite(v) && v > 0 && v < 20 ? Math.round(v * 10000) / 10000 : null;
}

export type BikeNormalizada = {
  id: string;
  slug: string;
  codigo: string;
  titulo: string;
  nomeOriginal: string;
  marca: string;
  linha: string | null;
  cor: string | null;
  categoria: string;
  potencia: string | null;
  bateria: string | null;
  autonomia: string | null;
  velocidade: string | null;
  recarga: string | null;
  ficha: ItemFicha[];
  imagens: string[];
  estoque: number | null;
  disponivel: boolean;
  previsao: string | null;
  /** Peso em quilos, como o fabricante publicou. Entra no cálculo do frete. */
  pesoKg: number | null;
  /** Volume em metros cúbicos, da medida do fabricante. Manda na cubagem. */
  volumeM3: number | null;
  /** Slugs das bases do fornecedor que têm este item. */
  bases: string[];
  custoEmReais: number | null;
  origemDoCusto: 'preco-logado' | 'tabela-publica';
};

/** Junta a linha da listagem com a ficha do detalhe (quando houver). */
export function normalizar(
  lista: ProdutoBruto,
  detalhe?: ProdutoBruto | null,
  bases: string[] = [],
): BikeNormalizada {
  const nome = (lista.name ?? '').trim();
  const { previsao, resto } = separarPrevisao(nome);

  const ficha = juntarFichas(
    fichaDoHtml(detalhe?.technicalInformation),
    fichaDoHtml(detalhe?.shortDescription ?? lista.shortDescription),
  );

  const codigo = String(lista.ref ?? lista.referenceCode ?? lista.id);
  const titulo = tituloComercial(resto) || titulizar(resto);

  const marca = daFicha(ficha, 'Marca') ?? marcaDoNome(resto) ?? 'Não informada';

  // `value` é o preço já negociado (só existe logado). `stockValue` é a tabela
  // pública, em centavos. Um dos dois tem que existir: sem custo não há preço.
  const precoLogado = typeof lista.value === 'number' && lista.value > 0 ? lista.value : null;
  const tabela =
    typeof lista.stockValue === 'number' && lista.stockValue > 0 ? lista.stockValue / 100 : null;

  const estoque =
    typeof lista.availableQuantity === 'number' ? lista.availableQuantity : null;

  return {
    id: lista.id,
    slug: `${paraSlug(titulo)}-${codigo}`,
    codigo,
    titulo,
    nomeOriginal: nome,
    marca,
    linha: daFicha(ficha, 'Linha', 'Modelo'),
    cor: daFicha(ficha, 'Cor'),
    categoria: categoriaDoNome(resto),
    potencia: daFicha(ficha, 'Motor', 'Potência'),
    bateria: daFicha(ficha, 'Bateria'),
    autonomia: daFicha(ficha, 'Autonomia'),
    velocidade: daFicha(ficha, 'Velocidade'),
    recarga: daFicha(ficha, 'Tempo de Recarga', 'Recarga'),
    ficha,
    imagens: urlsDasImagens(detalhe?.pathsImages ?? lista.pathsImages),
    estoque,
    // Sem previsão e sem estoque negativo, tratamos como disponível para
    // conversa. Quem confirma unidade é o atendimento.
    disponivel: previsao ? false : estoque === null || estoque > 0,
    previsao,
    pesoKg: pesoDaFicha(ficha),
    volumeM3: volumeDaFicha(ficha),
    bases,
    custoEmReais: precoLogado ?? tabela,
    origemDoCusto: precoLogado ? 'preco-logado' : 'tabela-publica',
  };
}
