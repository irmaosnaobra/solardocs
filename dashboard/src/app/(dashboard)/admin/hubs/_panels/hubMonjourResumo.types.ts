// Resposta de GET /admin/monjour/resumo (contrato de 19/11/2026).
// Vendas e leads vêm da Stripe pelo site do Monjour; o app vem do lp_events.
// Site fora ou sem token: 200 com indisponivel e motivo, vendas e leads vazios.

export type VendaMonjour = {
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

export type LeadMonjour = {
  quando: string;
  email: string;
  comprou: boolean;
  consent: boolean;
  utmContent: string;
};

export type ResumoMonjour = {
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
    lista: VendaMonjour[];
  };
  leads: {
    total: number; compraram: number; conversao: number;
    porDia: { dia: string; leads: number }[];
    lista: LeadMonjour[];
  };
  app: { abriram: number; instalaram: number; upgradeClicks: number };
};

// ── leitura defensiva: campo faltando vira zero ou lista vazia, nunca tela quebrada ──
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const txt = (v: unknown): string => (typeof v === 'string' ? v : '');
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

/** Devolve null quando o corpo não parece a resposta da rota (HTML de proxy, por exemplo). */
export function lerResumo(corpo: unknown): ResumoMonjour | null {
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
    app: { abriram: num(a.abriram), instalaram: num(a.instalaram), upgradeClicks: num(a.upgradeClicks) },
  };
}
