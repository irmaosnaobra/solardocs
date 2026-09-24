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

// ── ROTEAMENTO POR TAMANHO DA CONTA ──────────────────────────────────────────
// Regra do Thiago (23/09/2026): "a Nilce recebe TODOS; o Thiago e o Diego pegam
// 50% dos acima de 1.200 kWh, e esses 50% se dividem em dois".
//
// Traduzido em números, e é só isto que o resto do arquivo faz valer:
//   • abaixo de 1.200 kWh/mês (e sem resposta de consumo) → 100% Nilce
//   • acima de 1.200 kWh/mês → 50% Nilce, 25% Thiago, 25% Diego
//
// A Nilce deixou de ser "a dona do lead pequeno" e virou a dona do funil: ela
// está nos dois lados e leva metade até do que é grande. O que continua valendo
// é o motivo do corte: a tarde dos sócios é do eletroposto (só fazem solar de
// manhã, ver SO_DE_MANHA em leadsMetaService), então cada manhã que sai é
// caríssima e só conta grande justifica uma.
//
// Consumo desconhecido cai pra Nilce de propósito: a regra é exceção ("só vem
// pra nós acima de 1.200"), então quem não PROVA que é grande não gasta manhã de
// dono. Ela qualifica e devolve pra cá se for grande.
//
// ── A UNIDADE DO CORTE JÁ MUDOU DE LADO DUAS VEZES; AGORA É kWh ──
// Em 10/09 o corte virou o VALOR DA CONTA em reais (R$ 800 ≈ 762 kWh) porque era
// assim que a ordem tinha vindo. A de 23/09 veio em kWh, então o primário voltou
// a ser kWh e os reais é que são derivados, a constante fala a mesma língua da
// ordem, e as duas continuam sendo a mesma régua na mesma tarifa.
export const TARIFA_KWH = 1.05;               // R$/kWh cheia — mesma da LP /io/solar
export const KWH_CORTE_TIME = 1200;
export const CONTA_CORTE_REAIS = Math.round(KWH_CORTE_TIME * TARIFA_KWH);   // R$ 1.260

// A NILCE ESTA' NOS DOIS TIMES desde 10/09/2026. Por isso a separacao aqui
// embaixo e' obrigatoria, e nao estilo:
//
//   TIME_*  responde "esse dono pertence a este time?"   → use em if/includes
//   FILA_*  responde "de quem e' a vez?"                 → use no rodizio
//
// Antes TIME_CONTA_ALTA fazia as duas coisas, e dava certo enquanto o time tinha
// exatamente as duas pessoas do rodizio. Com a Nilce nos dois lados, usar a lista
// de membros pra sortear daria 1/3 pra cada um em vez de 50/25/25, e usar a
// fila pra perguntar faria o alerta de "lead grande fora do time"
// (centralAgentes.ts) contar a Nilce duas vezes.
export const TIME_CONTA_ALTA = ['Thiago', 'Diego', 'Nilce'];
// 4 posicoes: 2 Nilce (50%), 1 Thiago (25%), 1 Diego (25%). A Nilce entra
// intercalada, nunca em bloco, dois leads grandes seguidos pra ela deixariam os
// socios sem nenhum numa manha inteira de volume baixo.
export const FILA_CONTA_ALTA = ['Thiago', 'Nilce', 'Diego', 'Nilce'];

// 17/08/2026: a conta baixa deixou de ser de uma pessoa só. A Giovanna entrou pra
// aprender a atender. Quem SORTEIA é o proximoDaContaBaixa() (filaContaBaixa.ts);
// aqui ficam só as listas. Mesma separação do lado alto: TIME_ pergunta, FILA_
// sorteia, e é o TAMANHO da fila que define a proporção.
// 23/09/2026: a Giovanna saiu do RODÍZIO, "a Nilce recebe todos". Ela continua
// no TIME_ de propósito: a carteira dela não circula (dono_fixo no
// processar_repasses) e ainda tem ficha de conta baixa da ação de 11/09. Tirá-la
// daqui faria o centralAgentes acusar cada uma delas como "pequeno gastando
// manhã de dono". TIME_ é quem PODE atender; FILA_ é quem recebe o próximo.
export const TIME_CONTA_BAIXA = ['Nilce', 'Giovanna'];
export const FILA_CONTA_BAIXA = ['Nilce'];
/** "Amanhã que comece": só ficha criada daqui pra frente conta no rodízio. */
export const CONTA_BAIXA_INICIO = '2026-08-18T00:00:00-03:00';

/**
 * Consumo TÍPICO (kWh/mês) do que o lead respondeu. `unidade` é obrigatória e
 * vem de quem chama: a mesma pergunta aparece em kWh no formulário do Meta
 * ("700 a 900") e em REAIS na DM/LP ("R$ 800 a R$ 1.500"), e as duas caem no
 * mesmo campo "Consumo" da ficha — adivinhar aqui leria R$ 800 como 800 kWh.
 *
 * Faixa fechada devolve o MEIO, não o teto: o teto jogaria "R$ 800 a R$ 1.500"
 * (≈1.095 kWh no meio, mas ≈1.428 no teto) pro time da conta alta por causa da
 * borda, e o piso jogaria "1.200 a 1.500" pra Nilce. O meio é o único que acerta
 * as duas unidades.
 * Diferente de faixaConsumo (temperatura), que é otimista de propósito porque
 * ali o consumo é tamanho de ticket; roteamento precisa do valor provável.
 * 0 = não respondeu.
 */
export function consumoTipico(valor: string, unidade: 'kwh' | 'reais'): number {
  const v = (valor || '').trim();
  const t = v.toLowerCase();
  // Centavos fora antes de contar número: tem resposta gravada como "- 300,00" e
  // "R$ 900,00" nos formulários no ar. Sem isto o ",00" vira um SEGUNDO número, a
  // resposta exata é lida como faixa e o meio de "900 e 0" derruba o lead pra 450.
  const semCentavos = v.replace(/,\d{1,2}(?!\d)/g, '');
  const nums = (semCentavos.match(/\d[\d.]*/g) || []).map(n => Number(n.replace(/\./g, '')));
  let base = 0;
  if (nums.length >= 2) base = (nums[0] + nums[nums.length - 1]) / 2;      // "700 a 900" → 800
  else if (nums.length === 1) {
    if (/^\+|mais|acima|partir/.test(t)) base = nums[0] + 1;               // "+ 1200" → 1201
    else if (/^[-–]|at[eé]|abaixo|menos/.test(t)) base = nums[0] / 2;      // "até 500" → 250
    else base = nums[0];                                                   // resposta exata
  }
  return unidade === 'reais' ? base / TARIFA_KWH : base;
}

/** True se o lead entra no rodízio da conta alta. Sem resposta = false. */
export function ehContaAlta(valor: string, unidade: 'kwh' | 'reais'): boolean {
  // A comparacao acontece em kWh, que e' onde a regra de 23/09 foi escrita. O
  // consumoTipico ja' normaliza as duas unidades pra kWh na mesma tarifa, entao
  // "1.200 kWh" quer dizer 1.200 kWh tenha o lead respondido em kWh (formulario
  // do Meta) ou em reais (DM e LP). Comparar em reais daria no mesmo hoje, mas
  // penduraria a regra num arredondamento que a tarifa pode mexer.
  return consumoTipico(valor, unidade) > KWH_CORTE_TIME;
}

/** Resposta de consumo do formulário do Meta (já em kWh). */
export function consumoDaFicha(fields: FieldItem[]): string {
  return valorDe(organizarFicha(fields), 'Consumo');
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
