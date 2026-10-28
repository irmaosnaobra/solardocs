// Manutenção preventiva: tipos do contrato com a API, textos da tela e funções puras.
// As regras de negócio (selo, pendências, próxima visita, conclusão) moram no servidor;
// aqui só se desenha o que ele devolve.

import api from '@/services/api';

export type StatusItem = 'conforme' | 'atencao' | 'nao_conforme' | 'na' | null;
export type StatusAtiv = 'concluido' | 'parcial' | 'nao_executado';
export type Selo = 'conforme' | 'atencao' | 'nao_conforme';
export type TipoSistema = 'residencial' | 'comercial' | 'industrial' | 'rural' | 'usina';
export type Telhado = 'ceramico' | 'metalico' | 'fibrocimento' | 'laje' | 'solo' | 'outro';

export interface Inversor { marca: string; modelo: string; serie: string }
export interface Item { key: string; status: StatusItem; visto: string; providencia: string }
export interface Atividade { key: string; feita: boolean; status: StatusAtiv; obs: string }

export interface Dados {
  sistema: {
    tipo: TipoSistema | null;
    qtd_modulos: number | null;
    potencia_kwp: number | null;
    modulo_modelo: string;
    inversores: Inversor[];
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

export interface Pendencia {
  key: string; label: string; status: 'atencao' | 'nao_conforme';
  prioridade: 'alta' | 'media'; visto: string; providencia: string;
}

export interface Resumo {
  selo: Selo | null;
  pendencias: Pendencia[];
  conclusao_sugerida: string;
  faltam_status: number;
  proxima_visita: string | null;
}

export interface Linha {
  id: string;
  codigo: string | null;
  cliente_id: string | null;
  cliente_nome: string | null;
  status: 'em_andamento' | 'concluida';
  selo: Selo | null;
  data_inspecao: string;
  proxima_visita: string | null;
  dados: Partial<Dados>;
  fotos_url?: Record<string, { path: string; url: string | null }[]>;
  assinaturas?: { tecnico?: { nome?: string; registro?: string }; cliente?: { nome?: string } };
  assinaturas_url?: { tecnico?: string; cliente?: string };
  resumo?: Resumo;
}

export interface ItemLista {
  id: string; codigo: string | null; cliente_nome: string | null; status: 'em_andamento' | 'concluida';
  selo: Selo | null; data_inspecao: string; proxima_visita: string | null; created_at: string;
}

export interface Proxima { id: string; cliente_nome: string | null; proxima_visita: string; dias: number }

// ── Textos (arquivo de textos do redator, usados como estão) ─────────────────

export const CHECKLIST = [
  { key: 'modulos', label: 'Módulos', dica: 'Olhe trincas, pontos quentes, sujeira, delaminação e vidro quebrado ou manchado.' },
  { key: 'estrutura', label: 'Estrutura e fixação', dica: 'Veja se a fixação está firme, se há ferrugem e se os parafusos estão apertados.' },
  { key: 'cabos', label: 'Cabos e conectores', dica: 'Procure cabos ressecados ou roídos, conectores MC4 soltos ou derretidos e eletrodutos abertos.' },
  { key: 'stringbox', label: 'Quadro CC (string box)', dica: 'Abra e veja fusíveis, bornes, sinais de aquecimento e umidade.' },
  { key: 'quadro_ca', label: 'Quadro CA', dica: 'Veja os disjuntores, o aperto dos cabos e marcas de aquecimento.' },
  { key: 'dps', label: 'DPS', dica: 'Confira o indicador de estado e se a ligação está firme.' },
  { key: 'aterramento', label: 'Aterramento', dica: 'Veja se cabos e hastes estão firmes, sem corrosão e bem conectados.' },
  { key: 'inversor', label: 'Inversor', dica: 'Veja alarmes, ventilação, display e a fixação do inversor.' },
  { key: 'monitoramento', label: 'Monitoramento', dica: 'Confira se o app abre, se há comunicação e se a geração aparece.' },
] as const;

export const STATUS_ITEM: { valor: Exclude<StatusItem, null>; botao: string; relatorio: string }[] = [
  { valor: 'conforme', botao: 'Conforme', relatorio: 'Conforme' },
  { valor: 'atencao', botao: 'Atenção', relatorio: 'Atenção' },
  { valor: 'nao_conforme', botao: 'Não conforme', relatorio: 'Não conforme' },
  { valor: 'na', botao: 'N/A', relatorio: 'Não se aplica' },
];

export const ATIVIDADES = [
  { key: 'limpeza', label: 'Limpeza dos módulos' },
  { key: 'inspecao_visual', label: 'Inspeção visual' },
  { key: 'reaperto', label: 'Reaperto de conexões' },
  { key: 'termografia', label: 'Termografia' },
  { key: 'medicao_strings', label: 'Medição das strings' },
  { key: 'verificacao_inversor', label: 'Verificação do inversor' },
  { key: 'verificacao_monitoramento', label: 'Verificação do monitoramento' },
  { key: 'teste_aterramento', label: 'Teste do aterramento' },
] as const;

export const STATUS_ATIV: { valor: StatusAtiv; label: string }[] = [
  { valor: 'concluido', label: 'Concluído' },
  { valor: 'parcial', label: 'Parcial' },
  { valor: 'nao_executado', label: 'Não executado' },
];

export const SELOS: Record<Selo, { titulo: string; frase: string }> = {
  conforme: { titulo: 'Tudo conforme', frase: 'Todos os itens inspecionados estavam conformes nesta visita.' },
  atencao: { titulo: 'Com pontos de atenção', frase: 'Há itens que pedem acompanhamento ou ajuste. Veja as pendências abaixo.' },
  nao_conforme: { titulo: 'Com não conformidades', frase: 'Foram encontrados itens fora do esperado que precisam de correção. Veja a prioridade de cada um.' },
};

export const PRIORIDADE = {
  alta: { titulo: 'Prioridade alta', frase: 'Corrigir o quanto antes.' },
  media: { titulo: 'Prioridade média', frase: 'Acompanhar e ajustar.' },
} as const;

export const PERIODICIDADES: { valor: 3 | 6 | 12; label: string }[] = [
  { valor: 3, label: 'Trimestral' },
  { valor: 6, label: 'Semestral' },
  { valor: 12, label: 'Anual' },
];

export const TIPOS_SISTEMA: { valor: TipoSistema; label: string }[] = [
  { valor: 'residencial', label: 'Residencial' },
  { valor: 'comercial', label: 'Comercial' },
  { valor: 'industrial', label: 'Industrial' },
  { valor: 'rural', label: 'Rural' },
  { valor: 'usina', label: 'Usina' },
];

export const TELHADOS: { valor: Telhado; label: string }[] = [
  { valor: 'ceramico', label: 'Cerâmico' },
  { valor: 'metalico', label: 'Metálico' },
  { valor: 'fibrocimento', label: 'Fibrocimento' },
  { valor: 'laje', label: 'Laje' },
  { valor: 'solo', label: 'Solo' },
  { valor: 'outro', label: 'Outro' },
];

// Fotos além dos 9 itens: antes e depois da limpeza.
export const GRUPOS_EXTRA = [
  { key: 'antes', label: 'Antes da limpeza' },
  { key: 'depois', label: 'Depois da limpeza' },
] as const;

export const LIMITE_FOTOS_GRUPO = 12;

// ── Dados ────────────────────────────────────────────────────────────────────

export function dadosVazios(): Dados {
  return {
    sistema: { tipo: null, qtd_modulos: null, potencia_kwp: null, modulo_modelo: '', inversores: [], telhado: [], endereco: '' },
    itens: CHECKLIST.map((c) => ({ key: c.key, status: null, visto: '', providencia: '' })),
    atividades: ATIVIDADES.map((a) => ({
      key: a.key, feita: a.key === 'limpeza' || a.key === 'inspecao_visual',
      status: 'concluido' as StatusAtiv, obs: '',
    })),
    geracao: { esperada_kwh: null, medida_kwh: null },
    recomendacoes: '',
    observacoes_proxima: '',
    conclusao_manual: null,
    periodicidade_meses: 6,
    responsavel: { nome: '', registro: '' },
  };
}

// O servidor devolve o que gravou; aqui garante que a tela sempre tem os 9 itens e as
// 8 atividades na ordem fixa, mesmo que falte alguma chave.
export function normalizarDados(raw: Partial<Dados> | null | undefined): Dados {
  const base = dadosVazios();
  const r = raw || {};
  const sis = (r.sistema || {}) as Partial<Dados['sistema']>;
  return {
    sistema: {
      tipo: sis.tipo ?? null,
      qtd_modulos: sis.qtd_modulos ?? null,
      potencia_kwp: sis.potencia_kwp ?? null,
      modulo_modelo: sis.modulo_modelo || '',
      inversores: Array.isArray(sis.inversores) ? sis.inversores.map((i) => ({ marca: i.marca || '', modelo: i.modelo || '', serie: i.serie || '' })) : [],
      telhado: Array.isArray(sis.telhado) ? sis.telhado : [],
      endereco: sis.endereco || '',
    },
    itens: base.itens.map((b) => {
      const x = (r.itens || []).find((i) => i.key === b.key);
      return x ? { key: b.key, status: x.status ?? null, visto: x.visto || '', providencia: x.providencia || '' } : b;
    }),
    atividades: base.atividades.map((b) => {
      const x = (r.atividades || []).find((a) => a.key === b.key);
      return x ? { key: b.key, feita: !!x.feita, status: x.status || 'concluido', obs: x.obs || '' } : b;
    }),
    geracao: {
      esperada_kwh: r.geracao?.esperada_kwh ?? null,
      medida_kwh: r.geracao?.medida_kwh ?? null,
    },
    recomendacoes: r.recomendacoes || '',
    observacoes_proxima: r.observacoes_proxima || '',
    conclusao_manual: r.conclusao_manual ?? null,
    periodicidade_meses: r.periodicidade_meses === 3 || r.periodicidade_meses === 12 ? r.periodicidade_meses : 6,
    responsavel: { nome: r.responsavel?.nome || '', registro: r.responsavel?.registro || '' },
  };
}

// ── Datas (sempre string YYYY-MM-DD; nunca new Date('YYYY-MM-DD'), que lê como UTC) ──

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function partes(iso: string | null | undefined): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function dataCurta(iso: string | null | undefined): string {
  const p = partes(iso);
  return p ? `${String(p[2]).padStart(2, '0')}/${String(p[1]).padStart(2, '0')}/${p[0]}` : '';
}

export function dataLonga(iso: string | null | undefined): string {
  const p = partes(iso);
  return p ? `${p[2]} de ${MESES[p[1] - 1]} de ${p[0]}` : '';
}

export function soData(iso: string | null | undefined): string {
  const p = partes(iso);
  return p ? iso!.slice(0, 10) : '';
}

export function prazo(dias: number): string {
  if (dias === 0) return 'Vence hoje';
  if (dias === 1) return 'Vence amanhã';
  if (dias > 1) return `Vence em ${dias} dias`;
  if (dias === -1) return 'Vencida há 1 dia';
  return `Vencida há ${Math.abs(dias)} dias`;
}

export function codigoVisivel(codigo: string | null | undefined): string {
  const m = /^MP(\d{4})(\d{3})$/.exec(codigo || '');
  return m ? `MP-${m[1]}-${m[2]}` : codigo || '';
}

export function textoFaltam(qtd: number): string {
  return qtd === 1 ? 'Falta marcar o status de 1 item.' : `Faltam ${qtd} itens sem status.`;
}

export const AVISO_SEM_STATUS = 'Marque o status de todos os itens para continuar.';
export const AVISO_ASSINATURA_CLIENTE = 'A assinatura do cliente é opcional. Você pode concluir o relatório sem ela.';

export function mensagemWhatsApp(nomeCliente: string, empresa: string, proxima: string, link: string): string {
  return [
    `Oi, ${nomeCliente}, aqui é da ${empresa}.`,
    `O relatório da manutenção preventiva do seu sistema solar ficou pronto, e a próxima visita está prevista para ${proxima}.`,
    'Te mando o link agora.',
    link,
  ].join('\n');
}

// ── Erros da API (a rota nova responde com `erro`; as antigas, com `error`) ───

interface ErroAxios { response?: { status?: number; data?: { erro?: string; error?: string; faltam_status?: number } } }

export function msgErro(err: unknown): string {
  const d = (err as ErroAxios)?.response?.data;
  return d?.erro || d?.error || '';
}
export function ehMigracaoPendente(err: unknown): boolean {
  const r = (err as ErroAxios)?.response;
  return r?.status === 503 && r?.data?.erro === 'migracao_pendente';
}
export function faltamDoErro(err: unknown): number | null {
  const r = (err as ErroAxios)?.response;
  const n = r?.data?.faltam_status;
  return r?.status === 422 && typeof n === 'number' ? n : null;
}
export function statusHttp(err: unknown): number {
  return (err as ErroAxios)?.response?.status || 0;
}

// Telemetria de uso (não abate crédito). O endpoint aceita qualquer feature (até 40 caracteres).
export function logUso(event_type: string) {
  api.post('/feature-events', { feature: 'manutencao', event_type }).catch(() => {});
}
