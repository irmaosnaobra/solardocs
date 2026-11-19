// NEXUS INSTAGRAM (19/11/2026): tipos e funções puras do painel.
// Os rótulos ficam em nexusInstagramRotulos.ts (os mesmos da página solardoc.app/nexus/interesse).
import {
  CAMINHO, MOB, OBJ, INV, REC, WHATS, acima100, respostasDe, textoRespostas, whatsDe,
} from './nexusInstagramRotulos';

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
  eletroposto: string[] | null;
  /** v2: { <caminho>: { <chave>: <valor>, empresa? } } */
  eletroposto_respostas?: Record<string, Record<string, string>> | null;
  mobilidade: string[] | null;
  outro: string | null;
  objetivo: string | null;
  investimento: string | null;
  recurso: string | null;
  origem: string | null;
  utm: Record<string, string> | null;
  teste: boolean;
  /** v2: true confirmado, false sem WhatsApp, null não verificado */
  whatsapp_ok?: boolean | null;
}

export const UTM_CHAVES = ['source', 'medium', 'campaign', 'content', 'term'] as const;

export const rot = (mapa: Record<string, string>, k: string | null | undefined) => (k ? mapa[k] ?? k : '');
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
export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
    'Eletroposto', 'Caminho', 'Respostas do eletroposto', 'Mobilidade', 'Outro', 'Objetivo', 'Faixa', 'Recurso', 'Origem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'Atualizado em', 'Teste'];
  const linhas = rows.map((r) => [
    fmtData(r.criado_em), r.nome, r.telefone, WHATS[whatsDe(r)], r.email, fmtCep(r.cep), r.endereco, r.bairro, r.cidade, r.uf,
    lista(r.eletroposto).map((k) => rot(CAMINHO, k)).join(', '),
    respostasDe(r).map((x) => rot(CAMINHO, x.caminho)).join(', '),
    textoRespostas(r),
    lista(r.mobilidade).map((k) => rot(MOB, k)).join(', '),
    r.outro, rot(OBJ, r.objetivo), rot(INV, r.investimento), rot(REC, r.recurso), r.origem,
    ...UTM_CHAVES.map((k) => r.utm?.[k] ?? ''),
    fmtData(r.atualizado_em), r.teste ? 'sim' : '',
  ].map(celula).join(';'));
  const csv = '\uFEFF' + [cab.join(';'), ...linhas].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `nexus-instagram-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * caminho: '' | '*' (qualquer caminho do eletroposto) | slug do caminho.
 * item: '' | 'mob:*' | 'mob:<slug>' | 'outro:*'.
 * whats: '' | 'ok' | 'sem' | 'nv'.
 */
export interface Filtros {
  busca: string; caminho: string; item: string; objetivo: string; faixa: string; recurso: string; whats: string;
}
export const FILTROS_VAZIOS: Filtros = { busca: '', caminho: '', item: '', objetivo: '', faixa: '', recurso: '', whats: '' };

export function calcularResumo(rows: Row[], agora: number) {
  const seteDias = agora - 7 * 86400e3;
  const contaEp: Record<string, number> = {};
  const contaMob: Record<string, number> = {};
  const contaWhats = { ok: 0, sem: 0, nv: 0 };
  let ultimos = 0, comEp = 0, revenda = 0, acima = 0, comOutro = 0;
  for (const r of rows) {
    if (new Date(r.criado_em).getTime() >= seteDias) ultimos++;
    const ep = lista(r.eletroposto);
    if (ep.length) comEp++;
    if (r.objetivo === 'revenda') revenda++;
    if (acima100(r)) acima++;
    if (r.outro && r.outro.trim()) comOutro++;
    contaWhats[whatsDe(r)]++;
    ep.forEach((k) => { contaEp[k] = (contaEp[k] ?? 0) + 1; });
    lista(r.mobilidade).forEach((k) => { contaMob[k] = (contaMob[k] ?? 0) + 1; });
  }
  const rankEp = Object.keys(CAMINHO).map((k) => ({ k, n: contaEp[k] ?? 0 })).sort((a, b) => b.n - a.n);
  const rankMob = Object.entries(contaMob).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 8);
  return { ultimos, comEp, revenda, acima, comOutro, contaWhats, rankEp, rankMob };
}

export function filtrarLinhas(rows: Row[], f: Filtros): Row[] {
  const q = semAcento(f.busca.trim());
  return rows.filter((r) => {
    if (q) {
      const alvo = semAcento([r.nome, r.telefone, fmtTel(r.telefone), r.email, r.cidade, r.uf, r.outro,
        r.eletroposto_respostas?.parceiro?.empresa].filter(Boolean).join(' '));
      if (!alvo.includes(q)) return false;
    }
    const ep = lista(r.eletroposto);
    if (f.caminho === '*' ? !ep.length : f.caminho && !ep.includes(f.caminho)) return false;
    if (f.item) {
      const [tipo, k] = f.item.split(':');
      const mob = lista(r.mobilidade);
      if (tipo === 'mob' && (k === '*' ? !mob.length : !mob.includes(k))) return false;
      if (tipo === 'outro' && !(r.outro && r.outro.trim())) return false;
    }
    if (f.objetivo && r.objetivo !== f.objetivo) return false;
    if (f.faixa === 'acima_100' ? !acima100(r) : f.faixa && r.investimento !== f.faixa) return false;
    if (f.recurso && r.recurso !== f.recurso) return false;
    if (f.whats && whatsDe(r) !== f.whats) return false;
    return true;
  });
}
