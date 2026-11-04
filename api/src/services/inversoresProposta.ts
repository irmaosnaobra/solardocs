// Inversores da proposta solar. A proposta aceita mais de um inversor (marcas e
// potências diferentes). Proposta antiga guarda um só, em campos soltos do
// dados_json (qtd_inversores, marca_inversor, potencia_inversor, garantia_inversor).
// Este módulo é puro: sem dependência, sem banco.
//
// Regra de ouro: com uma linha só, os parses e os padrões são EXATAMENTE os que o
// templateService usava antes (qtd padrão 1, potência com vírgula pt-BR, garantia
// padrão 10). Assim a proposta antiga regenera byte a byte igual.

export interface InversorProposta {
  qtd: number;
  /** Marca aparada. */
  marca: string;
  /** Marca como veio, sem aparar. O modelo Moderno e o resumo sempre a usaram assim. */
  marcaCrua: string;
  potenciaKw: number;
  /** Texto da potência: aparado e com vírgula no lugar do primeiro ponto ("1,875"). */
  potenciaTxt: string;
  garantiaAnos: number;
}

const MAX_MARCAS = 30;

// Valor de linha da lista: só texto ou número. Qualquer outra coisa vira vazio.
function txt(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Garantia dos campos soltos: mesmo parse e mesmo padrão (10) de sempre. */
function garantiaSolta(f: Record<string, unknown>): number {
  return parseInt(String(f.garantia_inversor || '10'), 10) || 10;
}

export function inversoresDaProposta(f: Record<string, unknown>): InversorProposta[] {
  const solta = garantiaSolta(f || {});
  const lista = (f || {}).inversores;
  if (Array.isArray(lista)) {
    const linhas: InversorProposta[] = [];
    for (const item of lista) {
      if (!ehObjeto(item)) continue;
      const marcaCrua = txt(item.marca);
      const marca = marcaCrua.trim();
      const potenciaTxt = txt(item.potencia).trim().replace('.', ',');
      if (!marca && !potenciaTxt) continue;
      linhas.push({
        qtd: parseInt(String(txt(item.qtd) || '1'), 10) || 1,
        marca,
        marcaCrua,
        potenciaKw: parseFloat(String(txt(item.potencia) || '0').replace(',', '.')) || 0,
        potenciaTxt,
        // Garantia vazia (ou 0, ou texto sem número) cai na dos campos soltos e depois no padrão.
        garantiaAnos: parseInt(String(txt(item.garantia) || ''), 10) || solta,
      });
    }
    if (linhas.length > 0) return linhas;
  }
  const g = f || {};
  return [{
    qtd: parseInt(String(g.qtd_inversores || '1'), 10) || 1,
    marca: String(g.marca_inversor || '').trim(),
    marcaCrua: String(g.marca_inversor || ''),
    potenciaKw: parseFloat(String(g.potencia_inversor || '0').replace(',', '.')) || 0,
    potenciaTxt: String(g.potencia_inversor ?? '').trim().replace('.', ','),
    garantiaAnos: solta,
  }];
}

/** Soma de quantidade × potência (kW). */
export function totalKwInversores(lista: InversorProposta[]): number {
  return lista.reduce((s, i) => s + i.qtd * i.potenciaKw, 0);
}

/** Marcas distintas (sem diferenciar maiúscula) das propostas, na ordem dos docs.
 *  Guarda a primeira grafia vista. Lê a lista `inversores` e depois `marca_inversor`.
 *  Máximo 30. Nunca lança. */
export function marcasInversorDasPropostas(docs: Array<{ dados_json?: unknown }>): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  const add = (v: unknown): void => {
    if (out.length >= MAX_MARCAS) return;
    const m = txt(v).trim();
    if (!m) return;
    const chave = m.toLowerCase();
    if (vistos.has(chave)) return;
    vistos.add(chave);
    out.push(m);
  };
  try {
    for (const d of Array.isArray(docs) ? docs : []) {
      if (out.length >= MAX_MARCAS) break;
      const dj = ehObjeto(d) ? d.dados_json : undefined;
      if (!ehObjeto(dj)) continue;
      if (Array.isArray(dj.inversores)) {
        for (const it of dj.inversores) if (ehObjeto(it)) add(it.marca);
      }
      add(dj.marca_inversor);
    }
  } catch {
    // dados_json torto: devolve o que já juntou.
  }
  return out;
}
