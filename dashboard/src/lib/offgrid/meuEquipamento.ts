/**
 * OFF-GRID: modo "Meu equipamento" (o integrador usa o kit dele). Funções puras: a tela só chama.
 *
 * Os preços digitados aqui são do integrador. Nada daqui usa o catálogo ou a tabela de preço da casa.
 * Na proposta as linhas saem SEM preço, só com nome, quantidade e garantia (opcional, só nas 3 técnicas).
 *
 * Sem importar nada com `@/`: o script de prova roda estas funções direto com tsx.
 */
import { lerDinheiro, lerNumero } from './dinheiro';
import type { RequisitosOffGrid } from './engine';
import type { KitProprio } from './kitProprio';

export const MAX_ITENS = 20;
/** Margem sobre o custo com que o preço final começa. */
export const MARGEM_INICIAL_PCT = 30;

export type TipoTecnico = 'inv' | 'pla' | 'bat';

export interface ItemProprio {
  id: string;
  nome: string;
  /** Texto digitado. */
  qtd: string;
  /** Valor unitário em reais, texto digitado. */
  un: string;
  /** Só nas 3 linhas técnicas. */
  tec?: TipoTecnico;
  /** kW do inversor, Wp de cada placa ou kWh de cada bateria. Texto digitado. */
  spec?: string;
  /** Garantia em anos, texto digitado. Fica vazia: quem preenche é o integrador. */
  gar?: string;
  /** `spec` e `qtd` seguem a sugestão enquanto a pessoa não digitar neles. */
  specAuto?: boolean;
  qtdAuto?: boolean;
}

export const ROTULO_SPEC: Record<TipoTecnico, string> = {
  inv: 'Potência do inversor (kW)',
  pla: 'Potência de cada placa (Wp)',
  bat: 'Capacidade de cada bateria (kWh)',
};

const TAMANHOS_INVERSOR_KW = [1, 2, 3, 5, 6, 8, 10];
const SUG_PLACA_WP = 550;
const SUG_BATERIA_KWH = 5.12;

export interface SugestaoKit {
  inversorKw: number;
  moduloWp: number;
  qtdModulos: number;
  bateriaKwh: number;
  qtdBaterias: number;
}

/** Inversor no próximo tamanho comercial acima do exigido, placa de 550 Wp e bateria de 5,12 kWh. */
export function sugestaoKit(req: RequisitosOffGrid | undefined): SugestaoKit {
  if (!req) return { inversorKw: 0, moduloWp: SUG_PLACA_WP, qtdModulos: 0, bateriaKwh: SUG_BATERIA_KWH, qtdBaterias: 0 };
  const inversorKw = TAMANHOS_INVERSOR_KW.find((k) => k * 1000 >= req.inversorRequeridoW) ?? 10;
  return {
    inversorKw,
    moduloWp: SUG_PLACA_WP,
    qtdModulos: Math.max(0, Math.ceil(req.kwpBrutoNecessario / (SUG_PLACA_WP / 1000) - 1e-9)),
    bateriaKwh: SUG_BATERIA_KWH,
    qtdBaterias: Math.max(0, Math.ceil(req.bancoNecessarioKwh / SUG_BATERIA_KWH - 1e-9)),
  };
}

let seq = 0;
const novoId = () => `it-${Date.now().toString(36)}-${seq++}`;

/** As 8 linhas de partida: nome, quantidade e especificação sugeridas; valor unitário e garantia ficam vazios. */
export function itensIniciais(): ItemProprio[] {
  return [
    { id: novoId(), nome: 'Inversor off-grid', qtd: '', un: '', tec: 'inv', spec: '', gar: '', specAuto: true, qtdAuto: true },
    { id: novoId(), nome: 'Placas solares', qtd: '', un: '', tec: 'pla', spec: '', gar: '', specAuto: true, qtdAuto: true },
    { id: novoId(), nome: 'Baterias', qtd: '', un: '', tec: 'bat', spec: '', gar: '', specAuto: true, qtdAuto: true },
    { id: novoId(), nome: 'Cabos e proteções', qtd: '1', un: '' },
    { id: novoId(), nome: 'Estrutura de fixação', qtd: '1', un: '' },
    { id: novoId(), nome: 'Montagem e instalação', qtd: '1', un: '' },
    { id: novoId(), nome: 'Projeto e ART', qtd: '1', un: '' },
    { id: novoId(), nome: 'Frete', qtd: '1', un: '' },
  ];
}

export function itemVazio(): ItemProprio {
  return { id: novoId(), nome: '', qtd: '1', un: '' };
}

/** Devolve cada linha técnica com `spec` e `qtd` efetivos: o digitado, ou a sugestão enquanto não digitou. */
export function itensEfetivos(itens: ItemProprio[], req: RequisitosOffGrid | undefined): ItemProprio[] {
  const sug = sugestaoKit(req);
  const porTipo = (t: TipoTecnico) => itens.find((i) => i.tec === t);
  const placa = porTipo('pla');
  const bat = porTipo('bat');
  const wp = placa && !placa.specAuto ? lerNumero(placa.spec) : sug.moduloWp;
  const kwh = bat && !bat.specAuto ? lerNumero(bat.spec) : sug.bateriaKwh;
  const qtdPlacas = req && wp > 0 ? Math.max(0, Math.ceil(req.kwpBrutoNecessario / (wp / 1000) - 1e-9)) : 0;
  const qtdBat = req && kwh > 0 ? Math.max(0, Math.ceil(req.bancoNecessarioKwh / kwh - 1e-9)) : 0;
  const fmt = (n: number) => (n > 0 ? n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '');
  return itens.map((i) => {
    if (!i.tec) return i;
    const specSug = i.tec === 'inv' ? sug.inversorKw : i.tec === 'pla' ? sug.moduloWp : sug.bateriaKwh;
    const qtdSug = i.tec === 'inv' ? 1 : i.tec === 'pla' ? qtdPlacas : qtdBat;
    return {
      ...i,
      spec: i.specAuto ? fmt(specSug) : (i.spec ?? ''),
      qtd: i.qtdAuto ? (qtdSug > 0 ? String(qtdSug) : '') : i.qtd,
    };
  });
}

export const qtdDoItem = (i: ItemProprio): number => Math.max(0, Math.round(lerNumero(i.qtd)));
export const totalDoItem = (i: ItemProprio): number => qtdDoItem(i) * lerDinheiro(i.un);
export const custoTotal = (itens: ItemProprio[]): number => itens.reduce((s, i) => s + totalDoItem(i), 0);

/** Custo mais 30%, arredondado para a dezena de reais. */
export function precoSugerido(custo: number): number {
  return Math.round((custo * (100 + MARGEM_INICIAL_PCT)) / 100 / 10) * 10;
}

/** O kit que o integrador lançou, pronto para avaliarKitProprio. Recebe os itens JÁ efetivos. */
export function kitDosItens(efetivos: ItemProprio[]): KitProprio {
  const inv = efetivos.find((i) => i.tec === 'inv');
  const pla = efetivos.find((i) => i.tec === 'pla');
  const bat = efetivos.find((i) => i.tec === 'bat');
  return {
    inversorKw: inv ? lerNumero(inv.spec) : 0,
    moduloWp: pla ? lerNumero(pla.spec) : 0,
    qtdModulos: pla ? qtdDoItem(pla) : 0,
    bateriaKwh: bat ? lerNumero(bat.spec) : 0,
    qtdBaterias: bat ? qtdDoItem(bat) : 0,
  };
}

export function kitCompleto(k: KitProprio): boolean {
  return k.inversorKw > 0 && k.moduloWp > 0 && k.qtdModulos > 0 && k.bateriaKwh > 0 && k.qtdBaterias > 0;
}

/** `itens_cliente` da proposta: nome, quantidade e, só quando preenchida, a garantia. Sem preço. */
export function itensParaProposta(efetivos: ItemProprio[]): { nome: string; qtd: number; garantia?: number }[] {
  return efetivos
    .map((i) => ({ i, nome: i.nome.trim().replace(/\s+/g, ' ').slice(0, 120), qtd: qtdDoItem(i) }))
    .filter((x) => x.nome && x.qtd > 0)
    .slice(0, MAX_ITENS)
    .map(({ i, nome, qtd }) => {
      const g = i.tec ? Math.round(lerNumero(i.gar)) : 0;
      return { nome, qtd, ...(g > 0 && g <= 50 ? { garantia: g } : {}) };
    });
}

// ─── Conferência do kit ─────────────────────────────────────────────────────────

export interface LinhaConferencia {
  ok: boolean;
  titulo: string;
  texto: string;
}

export interface Conferencia {
  tudo: boolean;
  linhas: LinhaConferencia[];
  nota: string;
}

const nb = (v: number, casas = 2): string =>
  (isFinite(v) ? v : 0).toLocaleString('pt-BR', { maximumFractionDigits: casas });

interface AvaliacaoMinima {
  kwp: number;
  bancoNominalKwh: number;
  atende: {
    modulos: { atende: boolean; falta: number; faltaUnidades?: number };
    banco: { atende: boolean; falta: number; faltaUnidades?: number };
    inversor: { atende: boolean; falta: number };
    surto: { atende: boolean; falta: number };
    tudo: boolean;
  };
}

/** Texto da conferência. O kit avisa e não bloqueia: a proposta sai mesmo que algo não atenda. */
export function conferenciaDoKit(req: RequisitosOffGrid, kit: KitProprio, av: AvaliacaoMinima): Conferencia {
  const a = av.atende;
  const un = (n: number | undefined, um: string, plural: string) => `${n ?? 0} ${n === 1 ? um : plural}`;
  const surtoExigidoW = req.cargaContinuaW + req.surtoNecessarioW / req.sobrecargaInversor;
  const dobro = req.sobrecargaInversor === 2 ? 'o dobro' : `${nb(req.sobrecargaInversor)} vezes a potência`;
  const linhas: LinhaConferencia[] = [
    {
      ok: a.modulos.atende, titulo: 'Placas',
      texto: `${nb(av.kwp)} kWp para ${nb(req.kwpBrutoNecessario)} necessários. ${a.modulos.atende ? 'Atende.' : `Faltam ${nb(a.modulos.falta)} kWp (${un(a.modulos.faltaUnidades, 'placa', 'placas')}).`}`,
    },
    {
      ok: a.banco.atende, titulo: 'Banco de baterias',
      texto: `${nb(av.bancoNominalKwh)} kWh para ${nb(req.bancoNecessarioKwh)} necessários. ${a.banco.atende ? 'Atende.' : `Faltam ${nb(a.banco.falta)} kWh (${un(a.banco.faltaUnidades, 'bateria', 'baterias')}).`}`,
    },
    {
      ok: a.inversor.atende, titulo: 'Inversor',
      texto: `${nb(kit.inversorKw * 1000, 0)} W para ${nb(req.demandaPicoW, 0)} W de consumo. ${a.inversor.atende ? 'Atende.' : `Faltam ${nb(a.inversor.falta, 0)} W.`}`,
    },
    {
      ok: a.surto.atende, titulo: 'Partida do motor',
      texto: `O pico de partida é de ${nb(req.surtoNecessarioW, 0)} W. Como o inversor aguenta ${dobro} por alguns segundos, com o resto da casa ligado ele precisa ter ${nb(surtoExigidoW, 0)} W ou mais. ${a.surto.atende ? 'Atende.' : `Faltam ${nb(a.surto.falta, 0)} W.`}`,
    },
  ];
  return {
    tudo: a.tudo,
    linhas,
    nota: 'É só um aviso e não trava a proposta. A conta confere a potência e o banco.',
  };
}
