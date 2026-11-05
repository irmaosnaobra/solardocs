// Base compartilhada da proposta solar: helpers puros (formatação, escape, paleta, validade,
// bateria, QR) que os modelos 1, 2, 3 e o Completo usam. Saíram do templateService.ts sem
// mudar uma linha de lógica, para o modelo 4 poder usá-los sem import circular.
import qrcode from 'qrcode-generator';
import type { InversorProposta } from './inversoresProposta';

// QR (SVG) de um link — usado no rodapé da proposta (WhatsApp do vendedor).
export function qrSvg(text: string): string {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 3, margin: 0 });
  } catch { return ''; }
}


export interface Palette { c1: string; c2: string; c3: string; nome: string; }
export const PALETTES: Record<string, Palette> = {
  // 2026-05-21: solar/oceano/floresta agora usam tons fortes/escuros pra
  // dar mais autoridade visual no PDF. Royal e carbono mantidos.
  solar:    { c1: '#B45309', c2: '#D97706', c3: '#FFFBEB', nome: 'Solar' },
  oceano:   { c1: '#1E3A8A', c2: '#1D4ED8', c3: '#EFF6FF', nome: 'Oceano' },
  floresta: { c1: '#065F46', c2: '#047857', c3: '#ECFDF5', nome: 'Floresta' },
  royal:    { c1: '#8B5CF6', c2: '#A78BFA', c3: '#F5F3FF', nome: 'Royal' },
  carbono:  { c1: '#1F2937', c2: '#F59E0B', c3: '#FAFAF9', nome: 'Carbono' },
};

// Deriva uma paleta {c1,c2,c3} de UMA cor (hex) escolhida — usada tanto pela
// cor personalizada (color picker) quanto pela cor da empresa cadastrada.
// CONTRASTE é a parte crítica: o template põe texto BRANCO sobre c1/c2. Uma cor
// clara (ex: amarelo) deixaria o texto branco ilegível — então escurecemos c1
// até a luminância ser segura pra texto branco (aceita-se aprofundar tons pálidos).
// c2 = tom um pouco mais claro (gradiente); c3 = tint bem claro do hue (fundo).
function _hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function _rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function _relLum(r: number, g: number, b: number): number {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function _mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function derivePalette(hexRaw: string, nome: string): Palette {
  const hex = String(hexRaw || '').trim().toLowerCase();
  // Sanitiza: só #rrggbb entra no CSS/SVG do PDF (campo é POST não confiável).
  if (!/^#[0-9a-f]{6}$/.test(hex)) return { ...PALETTES.solar, nome };
  let [r, g, b] = _hexToRgb(hex);
  // Escurece até luminância <= 0.18 (garante contraste AA com texto branco).
  let guard = 0;
  while (_relLum(r, g, b) > 0.18 && guard < 40) { r *= 0.9; g *= 0.9; b *= 0.9; guard++; }
  const c1 = _rgbToHex(r, g, b);
  const c2 = _rgbToHex(_mix(r, 255, 0.22), _mix(g, 255, 0.22), _mix(b, 255, 0.22)); // +claro (gradiente)
  const c3 = _rgbToHex(_mix(r, 255, 0.93), _mix(g, 255, 0.93), _mix(b, 255, 0.93)); // tint de fundo
  return { c1, c2, c3, nome };
}

export function pBRL(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

export function pNum(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(n));
}

// Formato pra kWp: mostra decimais se não for inteiro (5 → "5", 9,6 → "9,6")
export function pKwp(n: number): string {
  if (Math.abs(n - Math.round(n)) < 0.01) return String(Math.round(n));
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export function pEsc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
}

// Garantia dos inversores da proposta. Vazio quando todos têm o mesmo prazo (aí vale
// o texto de sempre, com um número só). Com prazos diferentes devolve, sem escape:
// "Growatt 10 anos, Deye 5 anos". Quem imprime escapa.
export function pGarantiasInversoresDiferentes(lista: InversorProposta[]): string {
  if (lista.every((i) => i.garantiaAnos === lista[0].garantiaAnos)) return '';
  return lista
    .map((i, n) => `${i.marca || `inversor ${n + 1}`} ${i.garantiaAnos} ${i.garantiaAnos === 1 ? 'ano' : 'anos'}`)
    .join(', ');
}

// Telefone só pra LEITURA: "5517996243536" → "(17) 99624-3536". O link do
// WhatsApp e o QR continuam usando os dígitos crus — formatar a variável em si
// quebraria os dois.
export function pTel(s: string): string {
  const d = String(s || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(s || '');
}

// CNPJ: pontua se vierem os 14 dígitos; qualquer outra coisa sai como foi digitada.
export function pCnpj(s: string): string {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length !== 14) return String(s || '').trim();
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

// Checkbox do form: ausente = LIGADO (é o padrão de todos os campos do rodapé).
// String("false") porque o valor volta do dados_json/kit com o tipo trocado —
// aqui isso importa mais que nos pag_*: um desmarcado que não pega vira PDF
// errado na mão do cliente.
export function pFlagOn(v: unknown): boolean {
  return v !== false && String(v) !== 'false';
}

// PMT Price com carência: juros capitalizam no saldo durante a carência, depois Price padrão
export function pmtPriceCarencia(pv: number, i: number, n: number, carenciaMeses: number): number {
  if (!pv || pv <= 0) return 0;
  const saldo = pv * Math.pow(1 + i, carenciaMeses);
  return saldo * i / (1 - Math.pow(1 + i, -n));
}

// Validade da proposta: dias corridos a partir da emissão (padrão 7, editável no
// form). O HTML é renderizado uma vez na geração e servido salvo em /p/:id, então
// a data de vencimento congela no dia do envio — proposta antiga não "renova".
// Fica num só lugar pros dois modelos não divergirem no texto.
// Dias corridos de validade (padrão 7). Exportado porque o reemissor precisa saber
// se a proposta antiga ainda está no prazo antes de decidir se congela a data.
export function propostaDiasValidade(f: Record<string, unknown>): number {
  const n = parseInt(String(f.validade_dias ?? '').replace(/\D/g, ''), 10);
  return n > 0 ? n : 7;
}

// Data de emissão da proposta. Reeditar um doc antigo (pelo /histórico) manda o
// emitido_em original: cabeçalho e validade continuam os do dia do envio, em vez de
// renovarem sozinhos porque alguém corrigiu um typo. Vazio = agora (emissão normal).
export function propostaEmissao(f: Record<string, unknown>): Date {
  const raw = String(f.emitido_em ?? '').trim();
  if (!raw) return new Date();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export function propostaValidade(f: Record<string, unknown>): { dias: number; curto: string; longo: string } {
  const dias = propostaDiasValidade(f);
  const ate = new Date(propostaEmissao(f).getTime() + dias * 86400000);
  const plural = `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
  // Nº absurdo (14 dígitos) estoura o range do Date — aí sai só "Válido por N dias",
  // sem a data. Nunca um "Invalid Date" no PDF que vai pro cliente.
  const ateOk = !Number.isNaN(ate.getTime());
  const comData = (opts?: Intl.DateTimeFormatOptions) => ateOk
    ? `Válido por ${plural} · até ${ate.toLocaleDateString('pt-BR', { ...opts, timeZone: 'America/Sao_Paulo' })}`
    : `Válido por ${plural}`;
  return {
    dias,
    // dd/mm/aaaa — combina com o cabeçalho do modelo "1 Página"
    curto: comData(),
    // "6 de agosto de 2026" — combina com o dateBR() do modelo Moderno
    longo: comData({ day: '2-digit', month: 'long', year: 'numeric' }),
  };
}

export function str(v: unknown): string {
  return v != null ? String(v) : '___';
}

export function parseBRL(v: unknown): number {
  return parseFloat(String(v ?? '').replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

// Bateria (opcional) — parse único usado pela proposta E pelos contratos.
// Render-if-filled: só existe se a marca vier preenchida. Capacidade/potência
// aceitam vírgula (10,24); ciclos e garantia são inteiros. Propostas/contratos
// antigos (sem esses campos) seguem intactos — tem === false, tudo some.
export interface Bateria {
  tem: boolean;
  marca: string;
  // `titulo` já vem com a quantidade na frente, no mesmo idioma do inversor
  // ("2× BYD"). Quando a quantidade não foi informada — ou é 1 — é só a marca,
  // então proposta antiga sai idêntica ao que já saía.
  titulo: string;
  qtd: number;        // 0 = não informada
  capacidade: number; // kWh
  potencia: number;   // kW
  ciclos: number;
  garantia: number;   // anos
  specParts: string[]; // ['10,24 kWh cada', '5 kW cada', '6.000 ciclos'] — só as preenchidas
}
export function parseBateria(f: Record<string, unknown>): Bateria {
  const marca = String(f.bateria_marca ?? '').trim();
  const capacidade = parseFloat(String(f.bateria_capacidade_kwh ?? '0').replace(',', '.')) || 0;
  const potencia = parseFloat(String(f.bateria_potencia_kw ?? '0').replace(',', '.')) || 0;
  const ciclos = parseInt(String(f.bateria_ciclos ?? '0').replace(/\D/g, ''), 10) || 0;
  const garantia = parseInt(String(f.bateria_garantia_anos ?? '0'), 10) || 0;
  const qtd = parseInt(String(f.bateria_qtd ?? '0').replace(/\D/g, ''), 10) || 0;
  // "cada" só com mais de uma unidade, e só na capacidade e na potência: essas duas
  // SOMAM entre si e um banco lendo a proposta leria "10,24 kWh" como o total do
  // banco de baterias. Ciclo não soma — é característica da célula, então fica sem.
  const cada = qtd > 1 ? ' cada' : '';
  const specParts = [
    capacidade > 0 ? capacidade.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' kWh' + cada : '',
    potencia > 0 ? potencia.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' kW' + cada : '',
    ciclos > 0 ? ciclos.toLocaleString('pt-BR') + ' ciclos' : '',
  ].filter(Boolean);
  // `tem` continua preso SÓ à marca. Quantidade sem marca não pode acender a linha
  // da bateria, senão quem digitar um número por engano ganha uma bateria fantasma
  // na proposta inteira.
  const titulo = qtd > 1 ? `${qtd}× ${marca}` : marca;
  return { tem: marca.length > 0, marca, titulo, qtd, capacidade, potencia, ciclos, garantia, specParts };
}
