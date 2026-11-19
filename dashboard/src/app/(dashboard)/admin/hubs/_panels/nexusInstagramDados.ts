// NEXUS INSTAGRAM (19/11/2026): tipos, rótulos e funções puras do painel.
// Os rótulos são os mesmos da página solardoc.app/nexus/interesse: slug muda só junto com o backend.

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
  mobilidade: string[] | null;
  outro: string | null;
  objetivo: string | null;
  investimento: string | null;
  recurso: string | null;
  origem: string | null;
  utm: Record<string, string> | null;
  teste: boolean;
}

export const FRENTE: Record<string, string> = {
  cotista: 'Cotista', investidor: 'Investidor', arrendamento: 'Arrendamento',
  chave_na_mao: 'Chave na mão', parceiro: 'Parceiro instalador', so_carregador: 'Só o carregador',
};
export const MOB: Record<string, string> = {
  carro_compacto: 'Carro compacto', carro_suv: 'SUV', carro_sedan: 'Sedã', picape: 'Picape',
  van: 'Van e utilitário', caminhao: 'Caminhão leve', moto: 'Moto', scooter: 'Scooter',
  bike: 'Bike elétrica', patinete: 'Patinete', triciclo: 'Triciclo e cargo', quadriciclo: 'Quadriciclo e UTV',
  golfe: 'Carrinho de golfe', wallbox: 'Carregador para casa', carregador_rapido: 'Carregador rápido',
  bateria: 'Baterias', solar: 'Energia solar',
};
export const OBJ: Record<string, string> = {
  proprio: 'Para uso próprio', frota: 'Empresa ou frota', revenda: 'Revenda', investir: 'Investir',
};
export const INV: Record<string, string> = {
  ate_10: 'Até R$ 10 mil', '10_50': 'R$ 10 a 50 mil', '50_100': 'R$ 50 a 100 mil', '100_250': 'R$ 100 a 250 mil',
  '250_500': 'R$ 250 a 500 mil', '500_mais': 'Acima de R$ 500 mil', naosei: 'Não sabe',
};
export const REC: Record<string, string> = {
  proprio: 'Recurso próprio', financiamento: 'Financiamento', os_dois: 'Os dois', naosei: 'Não sabe',
};
export const ACIMA_100 = new Set(['100_250', '250_500', '500_mais']);
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
  const cab = ['Data', 'Nome', 'WhatsApp', 'E-mail', 'CEP', 'Endereço', 'Bairro', 'Cidade', 'UF',
    'Eletroposto', 'Mobilidade', 'Outro', 'Objetivo', 'Faixa', 'Recurso', 'Origem',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'Atualizado em', 'Teste'];
  const linhas = rows.map((r) => [
    fmtData(r.criado_em), r.nome, r.telefone, r.email, fmtCep(r.cep), r.endereco, r.bairro, r.cidade, r.uf,
    lista(r.eletroposto).map((k) => rot(FRENTE, k)).join(', '),
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

export interface Filtros { busca: string; interesse: string; objetivo: string; faixa: string; recurso: string }

export function calcularResumo(rows: Row[], agora: number) {
  const seteDias = agora - 7 * 86400e3;
  const contaEp: Record<string, number> = {};
  const contaMob: Record<string, number> = {};
  let ultimos = 0, comEp = 0, revenda = 0, acima = 0, comOutro = 0;
  for (const r of rows) {
    if (new Date(r.criado_em).getTime() >= seteDias) ultimos++;
    const ep = lista(r.eletroposto);
    if (ep.length) comEp++;
    if (r.objetivo === 'revenda') revenda++;
    if (r.investimento && ACIMA_100.has(r.investimento)) acima++;
    if (r.outro && r.outro.trim()) comOutro++;
    ep.forEach((k) => { contaEp[k] = (contaEp[k] ?? 0) + 1; });
    lista(r.mobilidade).forEach((k) => { contaMob[k] = (contaMob[k] ?? 0) + 1; });
  }
  const rankEp = Object.keys(FRENTE).map((k) => ({ k, n: contaEp[k] ?? 0 })).sort((a, b) => b.n - a.n);
  const rankMob = Object.entries(contaMob).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 8);
  return { ultimos, comEp, revenda, acima, comOutro, rankEp, rankMob };
}

export function filtrarLinhas(rows: Row[], { busca, interesse, objetivo, faixa, recurso }: Filtros): Row[] {
  const q = semAcento(busca.trim());
  return rows.filter((r) => {
    if (q) {
      const alvo = semAcento([r.nome, r.telefone, fmtTel(r.telefone), r.email, r.cidade, r.uf, r.outro].filter(Boolean).join(' '));
      if (!alvo.includes(q)) return false;
    }
    if (interesse) {
      const [tipo, k] = interesse.split(':');
      if (tipo === 'ep' && k === '*' && !lista(r.eletroposto).length) return false;
      if (tipo === 'ep' && k !== '*' && !lista(r.eletroposto).includes(k)) return false;
      if (tipo === 'mob' && !lista(r.mobilidade).includes(k)) return false;
      if (tipo === 'outro' && !(r.outro && r.outro.trim())) return false;
    }
    if (objetivo && r.objetivo !== objetivo) return false;
    if (faixa === 'acima_100' ? !(r.investimento && ACIMA_100.has(r.investimento)) : faixa && r.investimento !== faixa) return false;
    if (recurso && r.recurso !== recurso) return false;
    return true;
  });
}
