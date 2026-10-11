// ── PÓS-VENDA DO ELETROPOSTO ────────────────────────────────────────────────
//
// O card da agenda vira VENDIDO gravando `status='fechou'`, e depois disso não
// existia nada. O registro de pós-venda mora no `system_state`, uma chave por
// card (`pos_venda:<id>`), igual às outras marcas (etiqueta, motivo, espera).
//
// NÃO existe status novo: `fechou` continua sendo o status, e nove listas do
// servidor dependem dele para calar os robôs.
//
// Módulo PURO: sem banco e sem relógio. Quem chama passa o instante.

export const POS_VENDA_PREFIX = 'pos_venda:';
export const chavePosVenda = (id: number): string => `${POS_VENDA_PREFIX}${id}`;

export const MODELOS_POS_VENDA = [
  'chave_na_mao', 'meio_a_meio', 'arrendamento', 'cotista', 'integrador', 'carregador',
] as const;

export const ROTULO_MODELO: Record<string, string> = {
  chave_na_mao: 'Chave na mão',
  meio_a_meio: '50/50',
  arrendamento: 'Arrendamento',
  cotista: 'Cotas',
  integrador: 'Integrador',
  carregador: 'Carregador avulso',
};

export type DonoEtapa = 'cliente' | 'banco' | 'nos' | 'dist';

/** dono: quem tem que agir na etapa. prazo_dias: prazo interno padrão, só para
 *  acender atraso. Os rótulos de projeto até vistoria são idênticos aos do
 *  cronograma que o cliente recebe no papel (const ETAPAS do gerador). */
export const ETAPAS_POS_VENDA: Record<string, { rotulo: string; dono: DonoEtapa; prazo_dias: number | null }> = {
  papeis:      { rotulo: 'Contrato assinado e sinal pago',    dono: 'cliente', prazo_dias: 7 },
  credito:     { rotulo: 'Crédito liberado no banco',         dono: 'banco',   prazo_dias: 30 },
  par:         { rotulo: 'Investidor casado com o local',     dono: 'nos',     prazo_dias: 30 },
  captacao:    { rotulo: 'Cotas captadas',                    dono: 'nos',     prazo_dias: 90 },
  projeto:     { rotulo: 'Projeto executivo e ART',           dono: 'nos',     prazo_dias: 15 },
  protocolo:   { rotulo: 'Protocolo de homologação',          dono: 'nos',     prazo_dias: 7 },
  parecer:     { rotulo: 'Análise e parecer de acesso',       dono: 'dist',    prazo_dias: 45 },
  obra:        { rotulo: 'Obra civil e elétrica',             dono: 'nos',     prazo_dias: 30 },
  equipamento: { rotulo: 'Equipamento no local e instalação', dono: 'nos',     prazo_dias: 25 },
  vistoria:    { rotulo: 'Vistoria e ligação',                dono: 'dist',    prazo_dias: 15 },
  ativo:       { rotulo: 'Ponto ativo na plataforma',         dono: 'nos',     prazo_dias: 7 },
  pedido:      { rotulo: 'Pedido feito ao fornecedor',        dono: 'nos',     prazo_dias: 5 },
  entrega:     { rotulo: 'Equipamento entregue',              dono: 'nos',     prazo_dias: 25 },
  concluido:   { rotulo: 'Concluído',                         dono: 'nos',     prazo_dias: null },
};

const OBRA = ['projeto', 'protocolo', 'parecer', 'obra', 'equipamento', 'vistoria', 'ativo', 'concluido'];

export const TRILHOS: Record<string, string[]> = {
  '':           ['papeis'], // modelo ainda a confirmar
  chave_na_mao: ['papeis', 'credito', ...OBRA],
  meio_a_meio:  ['papeis', ...OBRA],
  arrendamento: ['papeis', 'par', ...OBRA],
  cotista:      ['papeis', 'captacao', ...OBRA],
  integrador:   ['papeis', ...OBRA],
  carregador:   ['papeis', 'credito', 'pedido', 'entrega', 'concluido'],
};

/** Kit de papéis de cada venda (texto mostrado na etapa 'papeis'). */
export const PAPEIS_DO_MODELO: Record<string, string> = {
  chave_na_mao: 'Orçamento, recibo de sinal, vistoria, contrato, procuração, anuência (cliente inquilino) e proposta de banco (financiado).',
  arrendamento: 'Termo do arrendador, contrato, procuração e anuência (cedente que não é dono sozinho).',
  meio_a_meio:  'Termo do investidor, contrato, arrendamento do local e interveniente ou anuência.',
  cotista:      'Reserva, contrato e adesão.',
  carregador:   'Orçamento do carregador, compra e venda e recibo.',
  integrador:   '',
};

export type PosVenda = {
  modelo: string;           // '' = a confirmar
  valor: number | null;     // em REAIS
  vendido_em: string;       // 'YYYY-MM-DD'
  etapa: string;
  etapa_desde: string;      // ISO
  previsto: string | null;  // 'YYYY-MM-DD', data interna esperada para fechar a etapa atual
  responsavel: string;
  obs: string;
  por: string;
  em: string;               // ISO da última gravação
};

export function trilhoDoModelo(modelo: string): string[] {
  return Object.prototype.hasOwnProperty.call(TRILHOS, modelo) ? TRILHOS[modelo] : TRILHOS[''];
}

export function catalogoPosVenda() {
  return {
    modelos: MODELOS_POS_VENDA.map(slug => ({
      slug, rotulo: ROTULO_MODELO[slug], papeis: PAPEIS_DO_MODELO[slug] ?? '',
    })),
    etapas: ETAPAS_POS_VENDA,
    trilhos: TRILHOS,
  };
}

const DATA_MIN = '2024-01-01';
const VALOR_MAX = 100_000_000;

/** `YYYY-MM-DD` que existe no calendário (recusa 2026-02-30). */
function dataReal(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Soma de dias sobre `YYYY-MM-DD` em UTC puro, sem fuso. */
function somaDias(ymd: string, dias: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const texto = (v: string, max: number): string => v.trim().slice(0, max);
/** Campo de texto que veio na entrada e não é string (objeto, número, null) vira erro, não "[object Object]". */
const textoRuim = (v: unknown): boolean => v !== undefined && typeof v !== 'string';

export function montarPosVenda(
  entrada: unknown,
  atual: PosVenda | null,
  agoraIso: string,
  hojeBr: string,
): { ok: true; registro: PosVenda } | { ok: false; erro: string } {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { ok: false, erro: 'corpo_invalido' };
  }
  const e = entrada as Record<string, unknown>;
  const criacao = !atual;

  // modelo
  let modelo = atual?.modelo ?? '';
  if (e.modelo !== undefined) {
    if (typeof e.modelo !== 'string' || (e.modelo !== '' && !(MODELOS_POS_VENDA as readonly string[]).includes(e.modelo))) {
      return { ok: false, erro: 'modelo_invalido' };
    }
    modelo = e.modelo;
  }

  // valor
  let valor: number | null = atual?.valor ?? null;
  if (e.valor !== undefined) {
    if (e.valor === null) valor = null;
    else if (typeof e.valor === 'number' && Number.isFinite(e.valor) && e.valor >= 0 && e.valor <= VALOR_MAX) {
      valor = Math.round(e.valor * 100) / 100;
    } else return { ok: false, erro: 'valor_invalido' };
  }

  // vendido_em
  let vendido_em = atual?.vendido_em ?? hojeBr;
  if (e.vendido_em !== undefined) {
    if (!dataReal(e.vendido_em) || e.vendido_em < DATA_MIN || e.vendido_em > hojeBr) {
      return { ok: false, erro: 'data_invalida' };
    }
    vendido_em = e.vendido_em;
  }

  // etapa
  const trilho = trilhoDoModelo(modelo);
  let etapa: string;
  if (e.etapa !== undefined) {
    if (typeof e.etapa !== 'string' || !trilho.includes(e.etapa)) {
      return { ok: false, erro: 'etapa_fora_do_trilho' };
    }
    etapa = e.etapa;
  } else if (atual && trilho.includes(atual.etapa)) {
    etapa = atual.etapa;
  } else {
    etapa = trilho[0];
  }

  // previsto (validado só se veio)
  let previstoEntrada: string | null | undefined;
  if (e.previsto !== undefined) {
    if (e.previsto === null) previstoEntrada = null;
    else if (dataReal(e.previsto) && e.previsto >= DATA_MIN && e.previsto <= somaDias(hojeBr, 730)) {
      previstoEntrada = e.previsto;
    } else return { ok: false, erro: 'previsto_invalido' };
  }

  const mudouEtapa = criacao || etapa !== atual!.etapa;
  let etapa_desde: string;
  let previsto: string | null;
  if (mudouEtapa) {
    etapa_desde = agoraIso;
    if (previstoEntrada !== undefined) previsto = previstoEntrada;
    else {
      const prazo = ETAPAS_POS_VENDA[etapa]?.prazo_dias ?? null;
      previsto = prazo === null ? null : somaDias(hojeBr, prazo);
    }
  } else {
    etapa_desde = atual!.etapa_desde;
    previsto = previstoEntrada !== undefined ? previstoEntrada : atual!.previsto;
  }

  if (textoRuim(e.responsavel) || textoRuim(e.obs) || textoRuim(e.por)) return { ok: false, erro: 'texto_invalido' };
  const responsavel = e.responsavel !== undefined ? texto(e.responsavel as string, 40) : (atual?.responsavel ?? '');
  const obs = e.obs !== undefined ? texto(e.obs as string, 500) : (atual?.obs ?? '');
  const por = e.por !== undefined ? texto(e.por as string, 40) : '';

  return {
    ok: true,
    registro: { modelo, valor, vendido_em, etapa, etapa_desde, previsto, responsavel, obs, por, em: agoraIso },
  };
}
