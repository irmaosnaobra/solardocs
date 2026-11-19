// ─────────────────────────────────────────────────────────────────────────────
// JORNADA DA OBRA SOLAR, ETAPA 9 (pós-venda), 19/11/2026: o que o GET da obra devolve em `posvenda_info`. REGRAS PURAS: sem banco, sem rota e
// sem relógio. Nenhum envio nasce aqui: os textos são para a pessoa mandar à mão (wa.me ou copiar). A régua automática de 3 toques é outra
// (services/io/jornadaMensagens*) e não muda.
// ─────────────────────────────────────────────────────────────────────────────

export const DIAS_POSVENDA = { avaliacao: 7, geracao_mes1: 30, conta1: 30 } as const;
export type TipoMensagemPosVenda = keyof typeof DIAS_POSVENDA;

const ymdOk = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** `YYYY-MM-DD` mais `n` dias corridos. */
export function somarDiasCorridos(ymd: string, n: number): string {
  const x = new Date(`${ymd}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` mais `n` meses, sem passar do último dia do mês de chegada (31/01 mais 1 mês é 28/02 ou 29/02). */
export function somarMeses(ymd: string, n: number): string {
  const [a, m, d] = ymd.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${String(ano).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

/** Quando pedir cada coisa: a data da liberação mais 7 dias (avaliação) ou 30 (geração do mês 1 e primeira conta). Sem liberação, null. */
export function quandoPosVenda(liberadaEm: string | null): Record<TipoMensagemPosVenda, string | null> {
  const lib = ymdOk(liberadaEm) ? liberadaEm : null;
  return {
    avaliacao: lib ? somarDiasCorridos(lib, DIAS_POSVENDA.avaliacao) : null,
    geracao_mes1: lib ? somarDiasCorridos(lib, DIAS_POSVENDA.geracao_mes1) : null,
    conta1: lib ? somarDiasCorridos(lib, DIAS_POSVENDA.conta1) : null,
  };
}

// ── Os textos (manual, sem robô) ─────────────────────────────────────────────────────────────────────────────────────────

/** A primeira palavra do nome, sem marca de formatação do WhatsApp e com a primeira letra maiúscula; vazio se não houver nome. */
export function primeiroNomeDe(nome: unknown): string {
  const limpo = String(nome ?? '').replace(/[*_~]/g, '').trim();
  const p = limpo.split(/\s+/)[0] ?? '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : '';
}

/**
 * O texto pronto de cada pedido. Sem nome, a primeira linha vira "☀️ Olá, tudo bem?". Sem link, a linha do link da avaliação sai.
 * As linhas são separadas por quebra de linha; o texto não leva mais nada.
 */
export function mensagemPosVenda(tipo: TipoMensagemPosVenda, primeiroNome: string, linkAvaliacao: string): string {
  const abre = primeiroNome ? `☀️ ${primeiroNome}, tudo bem?` : '☀️ Olá, tudo bem?';
  if (tipo === 'avaliacao') {
    return [
      abre,
      'A sua usina já está ligada e liberada.',
      'Se você gostou do atendimento da Irmãos na Obra, pode deixar uma avaliação no Google?',
      'Isso ajuda muito a gente.',
      ...(linkAvaliacao ? [linkAvaliacao] : []),
    ].join('\n');
  }
  if (tipo === 'geracao_mes1') {
    return [
      abre,
      'Já faz um mês que a sua usina foi liberada.',
      'Pode me mandar um print da tela do aplicativo do inversor com a geração do mês?',
      'Assim a gente confere se a usina está gerando o esperado.',
      'Obrigado por confiar na Irmãos na Obra.',
    ].join('\n');
  }
  return [
    abre,
    'Quando chegar a primeira conta de luz depois da liberação da usina, me manda uma foto ou o PDF?',
    'A gente confere a compensação e mostra a economia que a usina trouxe.',
    'Qualquer dúvida na conta, é só falar.',
  ].join('\n');
}

// ── A geração esperada e as garantias ────────────────────────────────────────────────────────────────────────────────────

/** A geração mensal estimada da proposta (`mediaMensalGerada`, número ou texto em formato BR), arredondada; sem valor positivo, null. */
export function geracaoEsperadaKwh(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const t = String(v ?? '').trim();
    n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  }
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export interface EntradaGarantias {
  /** Quando a etapa 8 concluiu (a usina foi liberada). */
  liberadaEm: string | null;
  /** O dia do termo de entrega assinado (etapa 7). */
  entregaEm: string | null;
  registradaEm: string | null;
  treinado: boolean;
  /** Anos de cada garantia, como estão no contrato (texto) ou no item da compra; vazio ou inválido = não existe. */
  modulosAnos: unknown;
  desempenhoModulosAnos: unknown;
  inversorAnos: unknown;
  instalacaoValor: unknown;
  instalacaoUnidade: unknown;
}
export interface GarantiaVencimento { chave: 'modulos' | 'desempenho_modulos' | 'inversor' | 'instalacao'; rotulo: string; meses: number; base: 'liberacao' | 'entrega'; inicio: string; vence_em: string }

const inteiroPositivo = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
};

/**
 * Os vencimentos. Módulos e inversor contam da liberação; a instalação conta do termo de entrega (a mesma conta do Termo de garantia) e,
 * sem termo, da liberação. Garantia que não existe não entra. Sem data de partida, o item sai sem vencimento algum (nem aparece).
 */
export function garantiasDaObra(e: EntradaGarantias): { registrada_em: string | null; treinado: boolean; itens: GarantiaVencimento[] } {
  const itens: GarantiaVencimento[] = [];
  const lib = ymdOk(e.liberadaEm) ? e.liberadaEm : null;
  const ent = ymdOk(e.entregaEm) ? e.entregaEm : null;
  const poe = (chave: GarantiaVencimento['chave'], rotulo: string, meses: number | null, base: 'liberacao' | 'entrega'): void => {
    const inicio = base === 'entrega' ? (ent ?? lib) : lib;
    if (!meses || !inicio) return;
    itens.push({ chave, rotulo, meses, base: base === 'entrega' && !ent ? 'liberacao' : base, inicio, vence_em: somarMeses(inicio, meses) });
  };
  const anos = (v: unknown): number | null => { const n = inteiroPositivo(v); return n ? n * 12 : null; };
  poe('modulos', 'Módulos (fabricação)', anos(e.modulosAnos), 'liberacao');
  poe('desempenho_modulos', 'Módulos (desempenho)', anos(e.desempenhoModulosAnos), 'liberacao');
  poe('inversor', 'Inversor', anos(e.inversorAnos), 'liberacao');
  const emMeses = String(e.instalacaoUnidade ?? 'anos').toLowerCase() === 'meses';
  const inst = inteiroPositivo(e.instalacaoValor);
  poe('instalacao', 'Instalação', inst ? (emMeses ? inst : inst * 12) : null, 'entrega');
  return { registrada_em: ymdOk(e.registradaEm) ? e.registradaEm : null, treinado: e.treinado, itens };
}

// ── O `posvenda_info` do GET ────────────────────────────────────────────────────────────────────────────────────────────────

export interface EntradaPosVendaInfo extends EntradaGarantias {
  esperadoKwhMes: unknown;
  nomeDoCliente: unknown;
  linkAvaliacao: string;
}

export function posvendaInfo(e: EntradaPosVendaInfo) {
  const liberada = ymdOk(e.liberadaEm) ? e.liberadaEm : null;
  const nome = primeiroNomeDe(e.nomeDoCliente);
  const link = e.linkAvaliacao.trim();
  return {
    liberada_em: liberada,
    quando: quandoPosVenda(liberada),
    esperado_kwh_mes: geracaoEsperadaKwh(e.esperadoKwhMes),
    garantias: garantiasDaObra(e),
    mensagens: {
      avaliacao: mensagemPosVenda('avaliacao', nome, link),
      geracao_mes1: mensagemPosVenda('geracao_mes1', nome, link),
      conta1: mensagemPosVenda('conta1', nome, link),
    },
    falta_link_avaliacao: !link,
  };
}
