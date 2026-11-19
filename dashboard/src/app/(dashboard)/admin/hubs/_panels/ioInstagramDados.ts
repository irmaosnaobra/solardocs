// IRMÃOS NA OBRA INSTAGRAM (19/11/2026): tipos e funções puras do painel.
// Os rótulos ficam em ioInstagramRotulos.ts (os mesmos da página solardoc.app/io/interesse).
import {
  CAMINHO, MOB, PORTA, WHATS, cardsDe, portasDe, textoBlocos, whatsDe, type Porta,
} from './ioInstagramRotulos';

/** Colunas da tabela io_instagram_interesse. */
export interface Row {
  id: string;
  criado_em: string;
  atualizado_em: string | null;
  nome: string;
  telefone: string;
  email: string | null;
  cep: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  portas: string[] | null;
  solar: Record<string, string> | null;
  eletroposto: string[] | null;
  eletroposto_respostas: Record<string, Record<string, string>> | null;
  integrador: Record<string, string> | null;
  mobilidade: string[] | null;
  outro: string | null;
  objetivo: string | null;
  investimento: string | null;
  recurso: string | null;
  origem: string | null;
  utm: Record<string, string> | null;
  teste: boolean;
  /** true confirmado, false sem WhatsApp, null não verificado */
  whatsapp_ok: boolean | null;
  card_solar_id: string | number | null;
  card_eletroposto_id: string | number | null;
}

export const UTM_CHAVES = ['source', 'medium', 'campaign', 'content', 'term'] as const;
export const lista = (v: string[] | null | undefined) => (Array.isArray(v) ? v : []);

export function fmtData(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
}
export function fmtTel(t: string): string {
  const d = (t || '').replace(/\D/g, '');
  const n = d.startsWith('55') ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return t;
}
export function fmtCep(c: string | null): string {
  const d = (c || '').replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
export function waLink(phone: string): string {
  return `https://wa.me/${(phone || '').replace(/\D/g, '')}`;
}
const ACENTO = new RegExp('[\\u0300-\\u036f]', 'g');
const BOM = String.fromCharCode(0xfeff);
const FIM_LINHA = String.fromCharCode(13, 10);
function semAcento(s: string): string {
  return s.normalize('NFD').replace(ACENTO, '').toLowerCase();
}

// CSV para o Excel brasileiro: ; como separador, BOM para o UTF-8 abrir certo.
// Célula que começa com = + - @ ganha ' na frente (não vira fórmula no Excel).
function celula(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function baixarCsv(rows: Row[]) {
  const cab = ['Data', 'Nome', 'WhatsApp', 'Situação do WhatsApp', 'E-mail', 'CEP', 'Endereço', 'Bairro', 'Cidade', 'UF',
    'Portas', 'Respostas', 'Outro (mobilidade)', 'Card solar', 'Card eletroposto', 'Origem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'Atualizado em', 'Teste'];
  const linhas = rows.map((r) => [
    fmtData(r.criado_em), r.nome, r.telefone, WHATS[whatsDe(r)], r.email, fmtCep(r.cep), r.endereco, r.bairro, r.cidade, r.uf,
    portasDe(r).map((p) => PORTA[p]).join(', '), textoBlocos(r), r.outro,
    r.card_solar_id ?? '', r.card_eletroposto_id ?? '', r.origem,
    ...UTM_CHAVES.map((k) => r.utm?.[k] ?? ''),
    fmtData(r.atualizado_em), r.teste ? 'sim' : '',
  ].map(celula).join(';'));
  const csv = BOM + [cab.join(';'), ...linhas].join(FIM_LINHA);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `irmaos-na-obra-instagram-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * porta: '' | Porta. caminho: '' | slug do caminho do eletroposto.
 * conta: '' | faixa da conta de luz (solar). item: '' | slug de mobilidade | 'outro'.
 * whats: '' | 'ok' | 'sem' | 'nv'. agenda: '' | 'com' | 'sem'.
 */
export interface Filtros {
  busca: string; porta: string; caminho: string; conta: string; item: string; whats: string; agenda: string;
}
export const FILTROS_VAZIOS: Filtros = { busca: '', porta: '', caminho: '', conta: '', item: '', whats: '', agenda: '' };

export interface Contagem { k: string; n: number }
function ranking(conta: Record<string, number>, chaves: string[]): Contagem[] {
  return chaves.map((k) => ({ k, n: conta[k] ?? 0 })).sort((a, b) => b.n - a.n);
}

export function calcularResumo(rows: Row[], agora: number) {
  const seteDias = agora - 7 * 86400e3;
  const porPorta: Record<Porta, number> = { solar: 0, eletroposto: 0, integrador: 0, mobilidade: 0 };
  const contaWhats = { ok: 0, sem: 0, nv: 0 };
  const contaEp: Record<string, number> = {};
  const contaLuz: Record<string, number> = {};
  const contaMob: Record<string, number> = {};
  let ultimos = 0, comCard = 0, comOutro = 0;
  for (const r of rows) {
    if (new Date(r.criado_em).getTime() >= seteDias) ultimos++;
    portasDe(r).forEach((p) => { porPorta[p]++; });
    contaWhats[whatsDe(r)]++;
    if (cardsDe(r).length) comCard++;
    if ((r.outro ?? '').trim()) comOutro++;
    const caminhos = new Set([...lista(r.eletroposto), ...Object.keys(r.eletroposto_respostas ?? {})]);
    caminhos.forEach((k) => { contaEp[k] = (contaEp[k] ?? 0) + 1; });
    const luz = r.solar?.conta;
    if (luz) contaLuz[luz] = (contaLuz[luz] ?? 0) + 1;
    lista(r.mobilidade).forEach((k) => { contaMob[k] = (contaMob[k] ?? 0) + 1; });
  }
  return {
    ultimos, comCard, comOutro, porPorta, contaWhats,
    rankEp: ranking(contaEp, Object.keys(CAMINHO)),
    rankLuz: ranking(contaLuz, ['ate300', '300_600', '600_1050', '1050_2000', '2000_5000', '5000_mais']),
    rankMob: ranking(contaMob, Object.keys(MOB)).filter((x) => x.n > 0).slice(0, 6),
  };
}

export function filtrarLinhas(rows: Row[], f: Filtros): Row[] {
  const q = semAcento(f.busca.trim());
  return rows.filter((r) => {
    if (q) {
      const alvo = semAcento([r.nome, r.telefone, fmtTel(r.telefone), r.email, r.cidade, r.uf, r.outro,
        r.eletroposto_respostas?.parceiro?.empresa].filter(Boolean).join(' '));
      if (!alvo.includes(q)) return false;
    }
    const ps = portasDe(r);
    if (f.porta && !ps.includes(f.porta as Porta)) return false;
    if (f.caminho && !lista(r.eletroposto).includes(f.caminho) && !r.eletroposto_respostas?.[f.caminho]) return false;
    if (f.conta && r.solar?.conta !== f.conta) return false;
    if (f.item === 'outro' ? !(r.outro ?? '').trim() : f.item && !lista(r.mobilidade).includes(f.item)) return false;
    if (f.whats && whatsDe(r) !== f.whats) return false;
    if (f.agenda === 'com' && !cardsDe(r).length) return false;
    if (f.agenda === 'sem' && (cardsDe(r).length || !(ps.includes('solar') || ps.includes('eletroposto')))) return false;
    return true;
  });
}

