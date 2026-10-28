import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Manutenção preventiva (SolarDoc): regras do relatório numa fonte só.
// Tudo aqui é função pura (sem banco, sem relógio escondido): o selo, as
// pendências, a próxima visita e a conclusão são calculados pelo servidor, nunca
// escritos à mão. Datas são sempre string YYYY-MM-DD (nunca Date com hora, que
// escorrega de dia com o fuso). Textos vêm do arquivo do redator, sem mudança.
// ─────────────────────────────────────────────────────────────────────────────

export type StatusItem = 'conforme' | 'atencao' | 'nao_conforme' | 'na' | null;
export type StatusAtiv = 'concluido' | 'parcial' | 'nao_executado';
export type Selo = 'conforme' | 'atencao' | 'nao_conforme';
export type Prioridade = 'alta' | 'media';
export type TipoSistema = 'residencial' | 'comercial' | 'industrial' | 'rural' | 'usina';
export type Telhado = 'ceramico' | 'metalico' | 'fibrocimento' | 'laje' | 'solo' | 'outro';

export const CHECKLIST: { key: string; label: string; dica: string }[] = [
  { key: 'modulos',        label: 'Módulos',                dica: 'Olhe trincas, pontos quentes, sujeira, delaminação e vidro quebrado ou manchado.' },
  { key: 'estrutura',      label: 'Estrutura e fixação',    dica: 'Veja se a fixação está firme, se há ferrugem e se os parafusos estão apertados.' },
  { key: 'cabos',          label: 'Cabos e conectores',     dica: 'Procure cabos ressecados ou roídos, conectores MC4 soltos ou derretidos e eletrodutos abertos.' },
  { key: 'stringbox',      label: 'Quadro CC (string box)', dica: 'Abra e veja fusíveis, bornes, sinais de aquecimento e umidade.' },
  { key: 'quadro_ca',      label: 'Quadro CA',              dica: 'Veja os disjuntores, o aperto dos cabos e marcas de aquecimento.' },
  { key: 'dps',            label: 'DPS',                    dica: 'Confira o indicador de estado e se a ligação está firme.' },
  { key: 'aterramento',    label: 'Aterramento',            dica: 'Veja se cabos e hastes estão firmes, sem corrosão e bem conectados.' },
  { key: 'inversor',       label: 'Inversor',               dica: 'Veja alarmes, ventilação, display e a fixação do inversor.' },
  { key: 'monitoramento',  label: 'Monitoramento',          dica: 'Confira se o app abre, se há comunicação e se a geração aparece.' },
];

export const ATIVIDADES: { key: string; label: string }[] = [
  { key: 'limpeza',                   label: 'Limpeza dos módulos' },
  { key: 'inspecao_visual',           label: 'Inspeção visual' },
  { key: 'reaperto',                  label: 'Reaperto de conexões' },
  { key: 'termografia',               label: 'Termografia' },
  { key: 'medicao_strings',           label: 'Medição das strings' },
  { key: 'verificacao_inversor',      label: 'Verificação do inversor' },
  { key: 'verificacao_monitoramento', label: 'Verificação do monitoramento' },
  { key: 'teste_aterramento',         label: 'Teste do aterramento' },
];

/** Atividades que já nascem marcadas como feitas e concluídas. */
export const ATIVIDADES_PADRAO_FEITAS = ['limpeza', 'inspecao_visual'];

export const STATUS_ITEM_BOTAO: Record<Exclude<StatusItem, null>, string> = {
  conforme: 'Conforme', atencao: 'Atenção', nao_conforme: 'Não conforme', na: 'N/A',
};
export const STATUS_ITEM_RELATORIO: Record<Exclude<StatusItem, null>, string> = {
  conforme: 'Conforme', atencao: 'Atenção', nao_conforme: 'Não conforme', na: 'Não se aplica',
};
export const STATUS_ATIV_LABEL: Record<StatusAtiv, string> = {
  concluido: 'Concluído', parcial: 'Parcial', nao_executado: 'Não executado',
};

export const SELOS: Record<Selo, { titulo: string; frase: string }> = {
  conforme: { titulo: 'Tudo conforme', frase: 'Todos os itens inspecionados estavam conformes nesta visita.' },
  atencao: { titulo: 'Com pontos de atenção', frase: 'Há itens que pedem acompanhamento ou ajuste. Veja as pendências abaixo.' },
  nao_conforme: { titulo: 'Com não conformidades', frase: 'Foram encontrados itens fora do esperado que precisam de correção. Veja a prioridade de cada um.' },
};

export const PRIORIDADE_LABEL: Record<Prioridade, { titulo: string; frase: string }> = {
  alta: { titulo: 'Prioridade alta', frase: 'Corrigir o quanto antes.' },
  media: { titulo: 'Prioridade média', frase: 'Acompanhar e ajustar.' },
};

export const PERIODICIDADE_LABEL: Record<3 | 6 | 12, string> = { 3: 'Trimestral', 6: 'Semestral', 12: 'Anual' };

export const SECOES = {
  identificacao: 'Identificação do sistema',
  inspecao: 'Inspeção',
  atividades: 'Atividades realizadas',
  pendencias: 'Pendências e prioridades',
  pendencias_vazio: 'Nenhuma pendência registrada nesta visita.',
  geracao: 'Geração esperada e medida',
  fotos: 'Fotos',
  recomendacoes: 'Recomendações',
  observacoes_proxima: 'Observações para a próxima visita',
  conclusao: 'Conclusão',
  assinaturas: 'Assinaturas',
  assinatura_tecnico: 'Assinatura do técnico',
  assinatura_cliente: 'Assinatura do cliente',
  proxima_visita: 'Próxima visita',
  periodicidade: 'Periodicidade',
  rodape: 'Relatório de manutenção preventiva gerado pela SolarDoc.',
  titulo: 'Manutenção preventiva',
  nao_concluido: 'Este relatório ainda não foi concluído.',
  aviso_sem_status: 'Marque o status de todos os itens para continuar.',
};

export const TIPO_SISTEMA_LABEL: Record<TipoSistema, string> = {
  residencial: 'Residencial', comercial: 'Comercial', industrial: 'Industrial', rural: 'Rural', usina: 'Usina',
};
export const TELHADO_LABEL: Record<Telhado, string> = {
  ceramico: 'Cerâmico', metalico: 'Metálico', fibrocimento: 'Fibrocimento', laje: 'Laje', solo: 'Solo', outro: 'Outro',
};

/** Grupos de foto aceitos: os 9 itens do checklist mais antes e depois da limpeza. */
export const GRUPOS_FOTO: string[] = [...CHECKLIST.map((c) => c.key), 'antes', 'depois'];
export const GRUPO_FOTO_LABEL: Record<string, string> = {
  antes: 'Antes da limpeza',
  depois: 'Depois da limpeza',
  ...Object.fromEntries(CHECKLIST.map((c) => [c.key, c.label])),
};

export const MAX_FOTOS_GRUPO = 12;
export const MAX_FOTOS_RELATORIO = 60;

// ── Formato de `dados` ──────────────────────────────────────────────────────

export interface Item { key: string; status: StatusItem; visto: string; providencia: string }
export interface Atividade { key: string; feita: boolean; status: StatusAtiv; obs: string }
export interface Dados {
  sistema: {
    tipo: TipoSistema | null;
    qtd_modulos: number | null;
    potencia_kwp: number | null;
    modulo_modelo: string;
    inversores: { marca: string; modelo: string; serie: string }[];
    telhado: Telhado[];
    endereco: string;
  };
  itens: Item[];
  atividades: Atividade[];
  geracao: { esperada_kwh: number | null; medida_kwh: number | null };
  recomendacoes: string;
  observacoes_proxima: string;
  conclusao_manual: string | null;
  periodicidade_meses: 3 | 6 | 12;
  responsavel: { nome: string; registro: string };
}

const txt = z.string().max(2000).default('');
const curto = z.string().max(200).default('');
const numero = z.number().finite().min(0).max(1e9).nullable().default(null);

export const dadosSchema = z.object({
  sistema: z.object({
    tipo: z.enum(['residencial', 'comercial', 'industrial', 'rural', 'usina']).nullable().default(null),
    qtd_modulos: z.number().finite().int().min(0).max(1e6).nullable().default(null),
    potencia_kwp: numero,
    modulo_modelo: curto,
    inversores: z.array(z.object({ marca: curto, modelo: curto, serie: curto })).max(10).default([]),
    telhado: z.array(z.enum(['ceramico', 'metalico', 'fibrocimento', 'laje', 'solo', 'outro'])).max(6).default([]),
    endereco: txt,
  }).default({ tipo: null, qtd_modulos: null, potencia_kwp: null, modulo_modelo: '', inversores: [], telhado: [], endereco: '' }),
  itens: z.array(z.object({
    key: z.string().max(40),
    status: z.enum(['conforme', 'atencao', 'nao_conforme', 'na']).nullable().default(null),
    visto: txt,
    providencia: txt,
  })).max(30).default([]),
  atividades: z.array(z.object({
    key: z.string().max(40),
    feita: z.boolean().default(false),
    status: z.enum(['concluido', 'parcial', 'nao_executado']).default('concluido'),
    obs: txt,
  })).max(30).default([]),
  geracao: z.object({ esperada_kwh: numero, medida_kwh: numero }).default({ esperada_kwh: null, medida_kwh: null }),
  recomendacoes: txt,
  observacoes_proxima: txt,
  conclusao_manual: z.string().max(2000).nullable().default(null),
  periodicidade_meses: z.union([z.literal(3), z.literal(6), z.literal(12)]).default(6),
  responsavel: z.object({ nome: curto, registro: curto }).default({ nome: '', registro: '' }),
});

/** Remonta itens e atividades na ordem fixa, descartando chave desconhecida e completando as que faltam. */
export function normalizarDados(d: z.infer<typeof dadosSchema> | Partial<Dados>): Dados {
  const x = d as Partial<Dados>;
  const itensIn = Array.isArray(x.itens) ? x.itens : [];
  const ativIn = Array.isArray(x.atividades) ? x.atividades : [];
  const sis = (x.sistema ?? {}) as Partial<Dados['sistema']>;
  const telhado = Array.isArray(sis.telhado) ? [...new Set(sis.telhado)] : [];
  return {
    sistema: {
      tipo: sis.tipo ?? null,
      qtd_modulos: sis.qtd_modulos ?? null,
      potencia_kwp: sis.potencia_kwp ?? null,
      modulo_modelo: sis.modulo_modelo ?? '',
      inversores: Array.isArray(sis.inversores) ? sis.inversores.slice(0, 10) : [],
      telhado,
      endereco: sis.endereco ?? '',
    },
    itens: CHECKLIST.map((c) => {
      const i = itensIn.find((y) => y && y.key === c.key);
      return { key: c.key, status: i?.status ?? null, visto: i?.visto ?? '', providencia: i?.providencia ?? '' };
    }),
    atividades: ATIVIDADES.map((a) => {
      const i = ativIn.find((y) => y && y.key === a.key);
      return {
        key: a.key,
        feita: i ? i.feita === true : ATIVIDADES_PADRAO_FEITAS.includes(a.key),
        status: i?.status ?? 'concluido',
        obs: i?.obs ?? '',
      };
    }),
    geracao: { esperada_kwh: x.geracao?.esperada_kwh ?? null, medida_kwh: x.geracao?.medida_kwh ?? null },
    recomendacoes: x.recomendacoes ?? '',
    observacoes_proxima: x.observacoes_proxima ?? '',
    conclusao_manual: x.conclusao_manual ?? null,
    periodicidade_meses: x.periodicidade_meses === 3 || x.periodicidade_meses === 12 ? x.periodicidade_meses : 6,
    responsavel: { nome: x.responsavel?.nome ?? '', registro: x.responsavel?.registro ?? '' },
  };
}

/** `dados` de um relatório novo: 9 itens sem status, limpeza e inspeção visual feitas, semestral. */
export function dadosPadrao(responsavel: { nome: string; registro: string } = { nome: '', registro: '' }): Dados {
  return normalizarDados({
    sistema: { tipo: null, qtd_modulos: null, potencia_kwp: null, modulo_modelo: '', inversores: [], telhado: [], endereco: '' },
    periodicidade_meses: 6,
    responsavel,
  });
}

// ── Selo, pendências, faltam ────────────────────────────────────────────────

type ItemMin = { key: string; status?: StatusItem | undefined; visto?: string | undefined; providencia?: string | undefined };

/** Algum não conforme vence; senão algum atenção; senão conforme. "Não se aplica" e item sem status não pesam. */
export function calcularSelo(itens: ItemMin[]): Selo {
  const lista = Array.isArray(itens) ? itens : [];
  if (lista.some((i) => i?.status === 'nao_conforme')) return 'nao_conforme';
  if (lista.some((i) => i?.status === 'atencao')) return 'atencao';
  return 'conforme';
}

export interface Pendencia {
  key: string; label: string; status: 'atencao' | 'nao_conforme'; prioridade: Prioridade; visto: string; providencia: string;
}

/** Itens em atenção ou não conforme. Prioridade alta primeiro; dentro de cada prioridade, a ordem do checklist. */
export function pendencias(itens: ItemMin[]): Pendencia[] {
  const lista = Array.isArray(itens) ? itens : [];
  const out: Pendencia[] = [];
  CHECKLIST.forEach((c) => {
    const i = lista.find((y) => y?.key === c.key);
    if (!i || (i.status !== 'atencao' && i.status !== 'nao_conforme')) return;
    out.push({
      key: c.key,
      label: c.label,
      status: i.status,
      prioridade: i.status === 'nao_conforme' ? 'alta' : 'media',
      visto: i.visto ?? '',
      providencia: i.providencia ?? '',
    });
  });
  return [...out.filter((p) => p.prioridade === 'alta'), ...out.filter((p) => p.prioridade === 'media')];
}

/** Quantos dos 9 itens do checklist estão sem status. */
export function faltamStatus(itens: ItemMin[]): number {
  const lista = Array.isArray(itens) ? itens : [];
  return CHECKLIST.filter((c) => {
    const i = lista.find((y) => y?.key === c.key);
    return !i || i.status == null;
  }).length;
}

// ── Datas (string YYYY-MM-DD) ───────────────────────────────────────────────

const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function dataValida(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DATA_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Hoje em America/Sao_Paulo, como YYYY-MM-DD. O fuso da máquina não entra. */
export function hojeBRT(agora: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
  return p;
}

/** Soma meses de calendário e corta o dia no fim do mês: 2026-08-31 + 6 = 2027-02-28. */
export function somarMeses(data: string, meses: number): string {
  const m = DATA_RE.exec(data);
  if (!m) throw new Error('data inválida: ' + data);
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const total = y * 12 + (mo - 1) + meses;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  const ultimo = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, ultimo);
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** Dias de `de` até `ate` (negativo se `ate` é anterior). */
export function diasEntre(de: string, ate: string): number {
  const a = DATA_RE.exec(de)!, b = DATA_RE.exec(ate)!;
  const ta = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const tb = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((tb - ta) / 86_400_000);
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2027-04-27" vira "27 de abril de 2027". */
export function dataPorExtenso(data: string): string {
  const m = DATA_RE.exec(data);
  if (!m) return '';
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** "2026-10-27" vira "27/10/2026". */
export function dataCurta(data: string): string {
  const m = DATA_RE.exec(data);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// ── Conclusão automática ────────────────────────────────────────────────────

export function formatarNumero(n: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n);
}

/** Minúscula, exceto sigla em maiúscula (DPS, CC, CA). Tira o complemento entre parênteses. */
function rotuloEmLista(label: string): string {
  return label
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (/^[A-ZÀ-Ý]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join(' ');
}

function juntarLista(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
}

/**
 * Texto da conclusão a partir do modelo do selo (arquivo de textos do redator).
 * Sem módulos a frase vira "no sistema {tipo} de {kWp}"; sem potência, some o "e {kWp}".
 * No selo "não conforme" a lista traz só os itens não conformes (os em atenção ficam fora).
 */
export function montarConclusao(dados: Partial<Dados>, selo: Selo, proximaVisita: string): string {
  const sis = dados.sistema;
  const qtdAtiv = (dados.atividades ?? []).filter((a) => a?.feita === true).length;
  const atividades = qtdAtiv === 1 ? 'atividade' : 'atividades';
  const tipo = sis?.tipo ?? '';
  const qtdMod = sis?.qtd_modulos ?? null;
  const pot = sis?.potencia_kwp ?? null;
  const potTxt = pot != null && pot > 0 ? `${formatarNumero(pot)} kWp` : '';

  let sistema = 'no sistema';
  if (tipo) sistema += ` ${tipo}`;
  if (qtdMod != null && qtdMod > 0) {
    sistema += `${tipo ? ',' : ''} de ${qtdMod} ${qtdMod === 1 ? 'módulo' : 'módulos'}`;
    if (potTxt) sistema += ` e ${potTxt}`;
  } else if (potTxt) {
    sistema += ` de ${potTxt}`;
  }

  const abertura = `Nesta visita ${qtdAtiv === 1 ? 'foi registrada' : 'foram registradas'} ${qtdAtiv} ${atividades} de manutenção preventiva ${sistema}.`;
  const proxima = dataPorExtenso(proximaVisita);
  const itens = dados.itens ?? [];
  const periodicidade = (PERIODICIDADE_LABEL[dados.periodicidade_meses ?? 6] ?? 'semestral').toLowerCase();

  if (selo === 'conforme') {
    return `${abertura} Todos os itens inspecionados estavam conformes no momento da visita. A próxima visita está prevista para ${proxima}, com periodicidade ${periodicidade}.`;
  }
  if (selo === 'atencao') {
    const pend = pendencias(itens).filter((p) => p.status === 'atencao');
    const lista = juntarLista(pend.map((p) => rotuloEmLista(p.label)));
    const um = pend.length === 1;
    return `${abertura} Não há não conformidade registrada, mas ${lista} ${um ? 'pede' : 'pedem'} acompanhamento e ajuste. Recomendamos tratar ${um ? 'esse ponto antes que evolua, e reavaliá-lo' : 'esses pontos antes que evoluam, e reavaliá-los'} na próxima visita, prevista para ${proxima}.`;
  }
  const nc = pendencias(itens).filter((p) => p.status === 'nao_conforme');
  const lista = juntarLista(nc.map((p) => rotuloEmLista(p.label)));
  if (nc.length === 1) {
    return `${abertura} Foi encontrada não conformidade em ${lista}, que precisa de correção. Enquanto não for corrigida, pode comprometer a geração e a segurança do sistema. Recomendamos tratar a prioridade antes da próxima visita, prevista para ${proxima}.`;
  }
  return `${abertura} Foram encontradas não conformidades em ${lista}, que precisam de correção. Enquanto não forem corrigidas, podem comprometer a geração e a segurança do sistema. Recomendamos tratar as prioridades antes da próxima visita, prevista para ${proxima}.`;
}

export interface Resumo {
  selo: Selo;
  pendencias: Pendencia[];
  conclusao_sugerida: string;
  faltam_status: number;
  proxima_visita: string;
}

/** Tudo que a tela mostra do cálculo do servidor. */
export function montarResumo(dados: Dados, dataInspecao: string): Resumo {
  const proxima = somarMeses(dataInspecao, dados.periodicidade_meses);
  const selo = calcularSelo(dados.itens);
  return {
    selo,
    pendencias: pendencias(dados.itens),
    conclusao_sugerida: montarConclusao(dados, selo, proxima),
    faltam_status: faltamStatus(dados.itens),
    proxima_visita: proxima,
  };
}

// ── Código MP + ano + 3 dígitos, por usuário e ano ──────────────────────────

/** Próximo código do usuário no ano: maior número já usado + 1 (ex.: MP2026001). */
export function proximoCodigo(codigosDoUsuario: (string | null | undefined)[], ano: number): string {
  const re = new RegExp(`^MP${ano}(\\d{3,})$`);
  let maior = 0;
  for (const c of codigosDoUsuario) {
    const m = c ? re.exec(c) : null;
    if (m) maior = Math.max(maior, Number(m[1]));
  }
  return `MP${ano}${String(maior + 1).padStart(3, '0')}`;
}

/** "MP2026001" vira "MP-2026-001" (formato da tela e do relatório). */
export function codigoLegivel(codigo: string | null | undefined): string {
  const m = /^MP(\d{4})(\d{3,})$/.exec(codigo ?? '');
  return m ? `MP-${m[1]}-${m[2]}` : (codigo ?? '');
}
