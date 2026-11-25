// Resposta de GET /admin/dominaia/resumo (contrato de 19/11/2026).
// Vendas e leads vêm da Stripe pelo site da Domina IA; o app vem do lp_events.
// Site fora ou sem token: 200 com indisponivel e motivo, vendas e leads vazios.

export type VendaDominaia = {
  quando: string;
  email: string;
  plano: 'basico' | 'plus' | string;
  tipo: 'compra' | 'upgrade' | string;
  valorCentavos: number;
  pais: string;            // ISO de 2 letras, ou 'desconhecido'
  reembolsada: boolean;
  contestada: boolean;
  utmContent: string;
};

export type LeadDominaia = {
  quando: string;
  email: string;
  comprou: boolean;
  consent: boolean;
  utmContent: string;
};

/** Checkout aberto que não virou pagamento. `valor` em centavos. */
export type CheckoutDominaia = {
  criado: string;
  status: 'open' | 'expired' | string;
  plano: string;           // '' quando o site não informa
  valor: number;
  pais: string;            // '' quando o site não informa
  email: string;
  sid: string;             // '' quando não há
  motivo: string;          // decline_code, code ou 'sem_tentativa'
  mensagem: string;
  metodo: string;
};

/** Vem do site; ausente se o site ainda não tem o bloco. `indisponivel`: a Stripe falhou ou a chave não tem permissão. */
export type CheckoutsDominaia =
  | { indisponivel: true; motivo: string }
  | { indisponivel: false; abertos: number; expirados: number; comFalha: number; pagaramDepois: number; porMotivo: Record<string, number>; truncado: boolean; lista: CheckoutDominaia[] };

export type ResumoDominaia = {
  periodo: { desde: string; ate: string };
  atualizadoEm: string;
  truncado: boolean;
  indisponivel?: boolean;
  motivo?: string;
  vendas: {
    compras: number; comprasBasico: number; comprasPlus: number; upgrades: number;
    receitaCentavos: number; reembolsos: number; reembolsadoCentavos: number; contestacoes: number;
    ticketMedioCentavos: number;
    porDia: { dia: string; compras: number; receitaCentavos: number }[];
    porPais: { pais: string; compras: number; receitaCentavos: number }[];
    lista: VendaDominaia[];
  };
  leads: {
    total: number; compraram: number; conversao: number;
    porDia: { dia: string; leads: number }[];
    lista: LeadDominaia[];
  };
  checkouts: CheckoutsDominaia | null;
  app: { abriram: number; instalaram: number; upgradeClicks: number };
};

// ── leitura defensiva: campo faltando vira zero ou lista vazia, nunca tela quebrada ──
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

function lerCheckouts(v: unknown): CheckoutsDominaia | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const c = obj(v);
  if (c.indisponivel === true) return { indisponivel: true, motivo: txt(c.motivo) };
  const porMotivo: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(c.porMotivo))) porMotivo[k] = num(n);
  return {
    indisponivel: false,
    abertos: num(c.abertos), expirados: num(c.expirados), comFalha: num(c.comFalha), pagaramDepois: num(c.pagaramDepois), porMotivo, truncado: c.truncado === true,
    lista: lista(c.lista).map((d) => ({
      criado: txt(d.criado), status: txt(d.status), plano: txt(d.plano), valor: num(d.valor), pais: txt(d.pais), email: txt(d.email),
      sid: txt(d.sid), motivo: txt(d.motivo), mensagem: txt(d.mensagem), metodo: txt(d.metodo),
    })),
  };
}

/** Devolve null quando o corpo não parece a resposta da rota (HTML de proxy, por exemplo). */
export function lerResumo(corpo: unknown): ResumoDominaia | null {
  const r = obj(corpo);
  if (!('vendas' in r) && !('leads' in r) && !('indisponivel' in r)) return null;
  const v = obj(r.vendas), l = obj(r.leads), a = obj(r.app), p = obj(r.periodo);
  return {
    periodo: { desde: txt(p.desde), ate: txt(p.ate) },
    atualizadoEm: txt(r.atualizadoEm),
    truncado: r.truncado === true,
    indisponivel: r.indisponivel === true,
    motivo: txt(r.motivo),
    vendas: {
      compras: num(v.compras), comprasBasico: num(v.comprasBasico), comprasPlus: num(v.comprasPlus),
      upgrades: num(v.upgrades), receitaCentavos: num(v.receitaCentavos), reembolsos: num(v.reembolsos),
      reembolsadoCentavos: num(v.reembolsadoCentavos), contestacoes: num(v.contestacoes),
      ticketMedioCentavos: num(v.ticketMedioCentavos),
      porDia: lista(v.porDia).map((d) => ({ dia: txt(d.dia), compras: num(d.compras), receitaCentavos: num(d.receitaCentavos) })),
      porPais: lista(v.porPais).map((d) => ({ pais: txt(d.pais), compras: num(d.compras), receitaCentavos: num(d.receitaCentavos) })),
      lista: lista(v.lista).map((d) => ({
        quando: txt(d.quando), email: txt(d.email), plano: txt(d.plano), tipo: txt(d.tipo),
        valorCentavos: num(d.valorCentavos), pais: txt(d.pais), reembolsada: d.reembolsada === true,
        contestada: d.contestada === true, utmContent: txt(d.utmContent),
      })),
    },
    leads: {
      total: num(l.total), compraram: num(l.compraram), conversao: num(l.conversao),
      porDia: lista(l.porDia).map((d) => ({ dia: txt(d.dia), leads: num(d.leads) })),
      lista: lista(l.lista).map((d) => ({
        quando: txt(d.quando), email: txt(d.email), comprou: d.comprou === true,
        consent: d.consent === true, utmContent: txt(d.utmContent),
      })),
    },
    checkouts: lerCheckouts(r.checkouts),
    app: { abriram: num(a.abriram), instalaram: num(a.instalaram), upgradeClicks: num(a.upgradeClicks) },
  };
}
