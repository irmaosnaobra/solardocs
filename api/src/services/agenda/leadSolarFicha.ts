// ─────────────────────────────────────────────────────────────────────────────
// Ficha do lead de energia solar: organiza as respostas do formulário do Meta e
// mede a temperatura pelo que o próprio lead respondeu.
//
// POR QUE ISSO EXISTE
// A observação saía numa linha só, na ordem que o Meta devolvia (diferente a cada
// lead):  "[Lead Instagram] Aumentar Consumo: Não · Padrão: Bi · Importante: ..."
//
// E tem MAIS de um formulário no ar, cada um com nome e vocabulário próprios
// (levantado sobre os ~250 leads já gravados):
//   consumo   → "Consumo" | "Consuma" | "qual_seu_consumo_médio_de_energia_(conta_de_luz)?"
//   urgência  → "Urgencia" | "Qual a urgência" | "quando_você_pretende_instalar?"
//   pagamento → "Pagamento" | "Como prefere investir"
//   decisor   → "Quem decide" | "Você é quem decide a implantação..." | "você_é_o_decisor_da_compra?"
//   imóvel    → "Imovel" | "Proprio ou Alugado"
// Por isso o casamento é por REGEX e a ordem de saída é FIXA: primeiro o que
// qualifica (consumo, imóvel, urgência, pagamento, decisor), depois o técnico.
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldItem { name: string; values: string[] }

// A ordem aqui é a ordem que sai na ficha. Regex ancorada onde o nome de um campo
// contém a palavra de outro — ex.: "Você é quem decide ... neste imóvel?" tem
// "imóvel" dentro, e não pode ser capturado pelo slot Imóvel.
const ORDEM: Array<{ rotulo: string; re: RegExp }> = [
  { rotulo: 'Consumo',              re: /^(consumo|consuma)|consumo_m[eé]dio|conta_de_luz/ },
  { rotulo: 'Vai aumentar consumo', re: /aumentar/ },
  { rotulo: 'Imóvel',               re: /^im[oó]vel|proprio ou alugado|pr[oó]prio ou alugado/ },
  { rotulo: 'Urgência',             re: /urg[eê]ncia|pretende_instalar|quando.*instalar/ },
  { rotulo: 'Pagamento',            re: /pagamento|investir/ },
  { rotulo: 'Quem decide',          re: /decide|decisor/ },
  { rotulo: 'Motivo',               re: /motiv/ },
  { rotulo: 'O que importa',        re: /importante/ },
  { rotulo: 'Telhado',              re: /telhado/ },
  { rotulo: 'Padrão de entrada',    re: /padr[aã]o|fase/ },
];

const IGNORAR = /^(first_name|full_name|email|whatsapp_number|phone_number|city|inbox_url)$/;
const HORARIO = /hor[aá]rio|hoario/;
const norm = (s: string) => (s || '').toLowerCase().trim();

export interface LinhaFicha { rotulo: string; valor: string }

/** Campos do questionário em ordem fixa. O que não está no mapa entra no fim (não perde dado). */
export function organizarFicha(fields: FieldItem[]): LinhaFicha[] {
  const usados = new Set<number>();
  const out: LinhaFicha[] = [];
  const elegivel = (f: FieldItem, i: number) =>
    !usados.has(i) && !IGNORAR.test(norm(f.name)) && !HORARIO.test(norm(f.name)) && !!f.values?.[0];

  for (const { rotulo, re } of ORDEM) {
    const i = fields.findIndex((f, idx) => elegivel(f, idx) && re.test(norm(f.name)));
    if (i >= 0) { usados.add(i); out.push({ rotulo, valor: String(fields[i].values[0]).trim() }); }
  }
  fields.forEach((f, i) => {
    if (elegivel(f, i)) { usados.add(i); out.push({ rotulo: f.name, valor: String(f.values[0]).trim() }); }
  });
  return out;
}

export const valorDe = (ficha: LinhaFicha[], rotulo: string) =>
  norm(ficha.find(l => l.rotulo === rotulo)?.valor || '');

/** Observação do card do CRM: uma linha por resposta, ordem sempre igual. */
export function montarObservacaoSolar(fields: FieldItem[]): string {
  const ficha = organizarFicha(fields);
  if (!ficha.length) return '[Lead Instagram]';
  return ['[Lead Instagram]', ...ficha.map(l => `${l.rotulo}: ${l.valor}`)].join('\n');
}

// ── Temperatura pelas RESPOSTAS ──────────────────────────────────────────────
// Peso pelo que trava ou destrava a venda de verdade:
//   • urgência e pagamento definidos separam quem compra de quem está olhando;
//   • imóvel alugado é o único que PUNE forte — não se instala no telhado alheio;
//   • "não decide" também pune: a conversa é com a pessoa errada;
//   • consumo é tamanho de ticket, não intenção — vale pouco.
export interface Temperatura { nivel: 'quente' | 'morno' | 'frio'; pontos: number; porque: string[] }

/** Maior número citado na faixa ("700 a 900" → 900). "- 500" é teto baixo; "+ 1200" é piso alto. */
function faixaConsumo(v: string): number {
  if (!v) return 0;
  const nums = (v.match(/\d[\d.]*/g) || []).map(n => Number(n.replace(/\./g, '')));
  if (!nums.length) return /mais|acima/.test(v) ? 9999 : 0;
  if (/^[-–]|abaixo|menos/.test(v.trim())) return 0;          // "- 500" → baixo
  if (/^\+|mais|acima/.test(v.trim())) return Math.max(...nums) + 1;
  return Math.max(...nums);
}

export function medirTemperatura(fields: FieldItem[]): Temperatura {
  const ficha = organizarFicha(fields);
  const v = (r: string) => valorDe(ficha, r);
  let p = 0;
  const porque: string[] = [];

  const urg = v('Urgência');
  if (/imediat|\b7\b/.test(urg)) { p += 3; porque.push('quer para JÁ (' + urg + ')'); }
  else if (/\b(15|30)\b/.test(urg)) { p += 1; porque.push('urgência: ' + urg); }

  const pag = v('Pagamento');
  if (pag && !/pesquis|n[aã]o sei/.test(pag)) { p += 3; porque.push('pagamento definido: ' + pag); }

  const dec = v('Quem decide');
  if (/n[aã]o (decide|sou)/.test(dec)) { p -= 1; porque.push('NÃO é o decisor'); }
  else if (/decisor/.test(dec)) { p += 1; porque.push('é o decisor'); }

  const imo = v('Imóvel');
  if (/alugad/.test(imo)) { p -= 3; porque.push('imóvel ALUGADO — precisa de autorização do dono'); }
  else if (/construindo/.test(imo)) { porque.push('está construindo — dá pra já deixar previsto'); }

  // Consumo vale POUCO de propósito: é tamanho de ticket, não vontade de comprar.
  // Com peso alto, quem tem conta grande e nenhuma pressa virava "quente".
  const kwh = faixaConsumo(v('Consumo'));
  if (kwh >= 700) { p += 1; if (kwh >= 900) porque.push('conta alta'); }

  if (/^sim/.test(v('Vai aumentar consumo'))) { p += 1; porque.push('vai aumentar o consumo'); }

  const nivel = p >= 5 ? 'quente' : p >= 3 ? 'morno' : 'frio';
  return { nivel, pontos: p, porque };
}
