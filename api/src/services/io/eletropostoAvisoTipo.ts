// ─────────────────────────────────────────────────────────────────────────────
// O AVISO INTERNO DOS TRÊS TIPOS NOVOS DO CARD (13/10/2026).
//
// Desde 13/10 o card da LP nasce com um tipo (arrendamento, cotista, integrador).
// O aviso que a equipe recebe no WhatsApp, porém, só sabia ler a ficha da trilha
// do ponto: para os três tipos novos saía "SEM NOTA, ficha antiga", com traços,
// sem empresa nem valor. Aqui moram os três cards próprios, com os textos do
// redator.
//
// REGRA DE OURO: campo vazio some com a LINHA INTEIRA. Nunca se imprime traço. E
// quando um bloco inteiro fica vazio, a linha em branco dele some junto, para não
// sobrar espaço duplo no meio da mensagem.
//
// PURO: não fala com banco nem com rede. Quem lê o tipo do banco é a rota.
// ─────────────────────────────────────────────────────────────────────────────

export type TipoDoAviso = 'cotista' | 'arrendamento' | 'integrador';

export const TIPOS_DO_AVISO: readonly TipoDoAviso[] = ['cotista', 'arrendamento', 'integrador'];

export const ehTipoDoAviso = (t: unknown): t is TipoDoAviso =>
  typeof t === 'string' && (TIPOS_DO_AVISO as readonly string[]).includes(t);

/** O tipo por extenso, para a linha `*Tipo:*` do aviso completo (ficha com nota). */
export const ROTULO_DO_TIPO: Record<TipoDoAviso, string> = {
  cotista: 'Investidor', arrendamento: 'Arrendamento', integrador: 'Parceiro integrador',
};

export interface DadosDoAviso {
  nome?: string | null;
  /** Só dígitos ou com máscara: o aviso limpa. */
  telefone?: string | null;
  cidade?: string | null;
  /** O "quando" já formatado pela rota (mesmo formato do aviso de sempre). */
  quando: string;
  consultor?: string | null;
  observacao?: string | null;
}

/** Traço sozinho é "não respondeu": vale como vazio, como o texto em branco. */
const limpo = (v: unknown): string => {
  const t = String(v ?? '').trim();
  return /^[—–-]+$/.test(t) ? '' : t;
};

/** O valor da linha `Rótulo: valor` da observação, ou '' (nunca traço). */
function campo(obs: string[], rot: string): string {
  const l = obs.find(x => x.startsWith(rot));
  return l ? limpo(l.slice(rot.length)) : '';
}

/** `*Rótulo:* valor`, ou nada quando o valor é vazio. */
const rotulada = (rot: string, v: string): string[] => (v ? [`*${rot}:* ${v}`] : []);

const RODAPE = [
  '_Reunião por vídeo. O lead foi avisado só de que você chama pelo WhatsApp dele. Quem manda o link é você, o robô não manda._',
  '_Veja no CRM: solardoc.app/gerador_',
];

/** Junta os blocos com uma linha em branco entre eles, pulando os que ficaram vazios. */
const juntar = (blocos: string[][]): string =>
  blocos.filter(b => b.length > 0).map(b => b.join('\n')).join('\n\n');

/**
 * O card do tipo. Os textos são os do redator (acabamento-landing, seção 6),
 * copiados sem retoque.
 */
export function montarAvisoDoTipo(tipo: TipoDoAviso, d: DadosDoAviso): string {
  const obs = String(d.observacao || '').split('\n').filter(Boolean);
  const quando = [`*Quando:* ${limpo(d.quando)}`, ...rotulada('Com', limpo(d.consultor))];
  const zap = String(d.telefone ?? '').replace(/\D/g, '');
  const pessoa = [
    ...rotulada('Cliente', limpo(d.nome)),
    ...(zap ? [`*WhatsApp:* wa.me/${zap}`] : []),
    ...rotulada('Cidade', limpo(d.cidade)),
  ];

  if (tipo === 'cotista') {
    const valor = campo(obs, 'Quanto pretende investir:');
    return juntar([
      ['💰 *NOVA REUNIÃO · INVESTIDOR*', ...(valor ? [`*Investimento: ${valor}*`] : [])],
      quando,
      pessoa,
      [
        ...rotulada('Como pretende pagar', campo(obs, 'Como pretende investir:')),
        ...rotulada('Decisor', campo(obs, 'Decisor:')),
      ],
      RODAPE,
    ]);
  }

  if (tipo === 'arrendamento') {
    return juntar([
      ['📍 *NOVA REUNIÃO · ARRENDAMENTO*', '*Cede o espaço em vez de investir*'],
      quando,
      [...pessoa, ...rotulada('Endereço', campo(obs, 'Endereço:'))],
      rotulada('Relação com o local', campo(obs, 'Local é seu:')),
      RODAPE,
    ]);
  }

  const empresa = campo(obs, 'Empresa:');
  return juntar([
    ['🤝 *NOVA REUNIÃO · PARCEIRO INTEGRADOR*', ...(empresa ? [`*${empresa}*`] : [])],
    quando,
    pessoa,
    [
      ...rotulada('O que faz', campo(obs, 'O que faz:')),
      ...rotulada('Como quer trabalhar', campo(obs, 'Como quer trabalhar:')),
    ],
    RODAPE,
  ]);
}
