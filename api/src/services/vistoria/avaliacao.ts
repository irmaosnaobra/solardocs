// ─────────────────────────────────────────────────────────────────────────────
// Vistoria solar: avaliação dos itens técnicos. Tudo aqui é função pura (sem banco):
// o selo, as pendências e a conclusão são calculados pelo servidor, nunca escritos à
// mão. Os textos vêm do arquivo do redator, sem mudança. Vistoria antiga, sem nenhum
// status, não tem selo, conclusão nem seção de pendências.
// ─────────────────────────────────────────────────────────────────────────────

export type StatusVistoria = 'conforme' | 'atencao' | 'nao_conforme' | 'na';
export type SeloVistoria = 'conforme' | 'atencao' | 'nao_conforme';
export type Prioridade = 'alta' | 'media';
export type MapaStatus = Partial<Record<string, StatusVistoria>>;

/** Os 10 itens técnicos, na ordem do checklist. conta_luz e documento_pessoal não têm status. */
export const ITENS_COM_STATUS: string[] = [
  'padrao', 'medidor', 'disjuntor_padrao', 'quadro_distribuicao', 'inversores',
  'telhado', 'tipo_telha', 'estrutura', 'cabeamento', 'sombreamento',
];

export const STATUS_VALIDOS: StatusVistoria[] = ['conforme', 'atencao', 'nao_conforme', 'na'];

export const STATUS_BOTAO: Record<StatusVistoria, string> = {
  conforme: 'Conforme', atencao: 'Atenção', nao_conforme: 'Não conforme', na: 'N/A',
};
export const STATUS_RELATORIO: Record<StatusVistoria, string> = {
  conforme: 'Conforme', atencao: 'Atenção', nao_conforme: 'Não conforme', na: 'Não se aplica',
};

/** Rótulo curto, só para a lista de pendências da conclusão. Siglas em maiúscula. */
export const ROTULO_CURTO: Record<string, string> = {
  padrao: 'padrão de entrada',
  medidor: 'medidor',
  disjuntor_padrao: 'disjuntor do padrão',
  quadro_distribuicao: 'quadro de distribuição',
  inversores: 'inversores e disjuntor C.A',
  telhado: 'telhado',
  tipo_telha: 'tipo de telha',
  estrutura: 'estrutura',
  cabeamento: 'caminho do cabeamento',
  sombreamento: 'sombreamento',
};

/** Rótulo cheio, usado quando a vistoria não traz o label do item. */
export const ROTULO_CHEIO: Record<string, string> = {
  padrao: 'Padrão de entrada',
  medidor: 'Medidor / Relógio',
  disjuntor_padrao: 'Disjuntor do padrão',
  quadro_distribuicao: 'Quadro de distribuição',
  inversores: 'Local dos inversores / Disjuntor C.A',
  telhado: 'Telhado',
  tipo_telha: 'Tipo de telha',
  estrutura: 'Estrutura apropriada',
  cabeamento: 'Caminho do cabeamento',
  sombreamento: 'Sombreamento',
};

export const SELOS: Record<SeloVistoria, { titulo: string; frase: string }> = {
  conforme: { titulo: 'Apto para instalar', frase: 'Todos os itens avaliados estão conformes para a instalação.' },
  atencao: { titulo: 'Instalável com ajustes', frase: 'Dá para instalar, mas alguns itens pedem ajuste. Veja as pendências abaixo.' },
  nao_conforme: { titulo: 'Adequar antes de instalar', frase: 'Há itens fora do esperado que precisam ser adequados antes da instalação. Veja a prioridade de cada um.' },
};

export const PRIORIDADE_LABEL: Record<Prioridade, { titulo: string; frase: string }> = {
  alta: { titulo: 'Prioridade alta', frase: 'Adequar antes de instalar.' },
  media: { titulo: 'Prioridade média', frase: 'Ajustar antes ou durante a instalação.' },
};

export const SECOES = {
  selo: 'Resultado da vistoria',
  pendencias: 'Pendências e prioridades',
  pendencias_vazio: 'Nenhuma pendência registrada nesta vistoria.',
  conclusao: 'Conclusão',
  assinaturas: 'Assinaturas',
  assinatura_tecnico: 'Assinatura do técnico',
  assinatura_cliente: 'Assinatura do cliente',
  baixar_pdf: 'Baixar PDF',
  erro_pdf: 'Não consegui gerar o PDF. Tente de novo.',
  // Textos novos do relatório (29/10/2026). As chaves de cima não mudam de valor.
  titulo: 'Vistoria de Energia Solar',
  identificacao: 'Identificação',
  andamento: 'Vistoria em andamento. O resultado completo aparece quando o técnico concluir.',
  faltam_avaliar: 'Faltam avaliar:',
  proximos_passos: 'Próximos passos',
  registro: 'Registro por item',
  sem_registro: 'Sem registro:',
  sem_nada: 'Nenhum registro ainda.',
  documentos: 'Documentos do titular',
  documentos_apoio: 'Documentos recebidos do titular da conta, para uso da engenharia.',
  documento_sem_imagem: 'Documento recebido. A imagem fica só com a empresa.',
  responsavel: 'Responsável técnico:',
  versao_online: 'Versão online deste relatório:',
  baixar_arquivos: 'Baixar fotos e arquivos',
  ir_para: 'Ir para:',
};

/** Aceita qualquer coisa vinda da tela e devolve só chaves técnicas com valor válido. */
export function sanitizarStatus(bruto: unknown): MapaStatus {
  const out: MapaStatus = {};
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return out;
  const src = bruto as Record<string, unknown>;
  for (const k of ITENS_COM_STATUS) {
    const v = src[k];
    if (typeof v === 'string' && (STATUS_VALIDOS as string[]).includes(v)) out[k] = v as StatusVistoria;
  }
  return out;
}

/** Algum não conforme vence; senão algum atenção; senão conforme. N/A, chave fora da lista e item sem status não pesam. Sem status útil: null. */
export function calcularSelo(statusItens: unknown): SeloVistoria | null {
  const m = sanitizarStatus(statusItens);
  const valores = ITENS_COM_STATUS.map((k) => m[k]).filter((v): v is StatusVistoria => !!v && v !== 'na');
  if (valores.length === 0) return null;
  if (valores.includes('nao_conforme')) return 'nao_conforme';
  if (valores.includes('atencao')) return 'atencao';
  return 'conforme';
}

export interface PendenciaVistoria {
  key: string;
  label: string;
  rotulo: string;
  status: 'atencao' | 'nao_conforme';
  prioridade: Prioridade;
}

type ItemMin = { key: string; label?: string; fotos?: unknown };

/** Prioridade alta (não conforme) primeiro, depois média (atenção); cada grupo na ordem do checklist. */
export function pendencias(statusItens: unknown, itens: ItemMin[] = []): PendenciaVistoria[] {
  const m = sanitizarStatus(statusItens);
  const lista = Array.isArray(itens) ? itens : [];
  const out: PendenciaVistoria[] = [];
  for (const k of ITENS_COM_STATUS) {
    const s = m[k];
    if (s !== 'atencao' && s !== 'nao_conforme') continue;
    const item = lista.find((i) => i?.key === k);
    out.push({
      key: k,
      label: item?.label || ROTULO_CHEIO[k] || k,
      rotulo: ROTULO_CURTO[k] || k,
      status: s,
      prioridade: s === 'nao_conforme' ? 'alta' : 'media',
    });
  }
  return [...out.filter((p) => p.prioridade === 'alta'), ...out.filter((p) => p.prioridade === 'media')];
}

/** "A", "A e B", "A, B e C". Lista vazia devolve ''. */
export function juntarLista(partes: string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return partes.slice(0, -1).join(', ') + ' e ' + partes[partes.length - 1];
}

export function contarItensComFoto(itens: ItemMin[]): number {
  return (Array.isArray(itens) ? itens : []).filter((i) => Array.isArray(i?.fotos) && (i.fotos as unknown[]).length > 0).length;
}

/** Texto da conclusão a partir do modelo do selo. Nulo quando não há selo. No selo "não conforme" a lista traz só os não conformes. */
export function montarConclusao(itens: ItemMin[], statusItens: unknown): string | null {
  const selo = calcularSelo(statusItens);
  if (!selo) return null;
  const qtd = contarItensComFoto(itens);
  const total = Array.isArray(itens) ? itens.length : 0;
  const abertura = `O técnico registrou ${qtd === 1 ? 'foto' : 'fotos'} em ${qtd} de ${total} itens nesta vistoria.`;

  if (selo === 'conforme') {
    return `${abertura} Todos os itens avaliados estão conformes para a instalação.`;
  }
  const todas = pendencias(statusItens, itens);
  if (selo === 'atencao') {
    const lista = todas.filter((p) => p.status === 'atencao').map((p) => p.rotulo);
    const um = lista.length === 1;
    return `${abertura} Não há não conformidade registrada, mas há ${um ? 'ponto' : 'pontos'} de atenção em ${juntarLista(lista)}. Recomendamos tratar ${um ? 'esse ponto' : 'esses pontos'} antes ou durante a instalação.`;
  }
  const lista = todas.filter((p) => p.status === 'nao_conforme').map((p) => p.rotulo);
  const um = lista.length === 1;
  return `${abertura} ${um ? 'Foi encontrada não conformidade' : 'Foram encontradas não conformidades'} em ${juntarLista(lista)}. Recomendamos adequar ${um ? 'esse ponto' : 'esses pontos'} antes da instalação.`;
}

export interface ResumoVistoria {
  selo: SeloVistoria | null;
  pendencias: PendenciaVistoria[];
  conclusao: string | null;
  itensComFoto: number;
  totalItens: number;
}

export function resumo(itens: ItemMin[], statusItens: unknown): ResumoVistoria {
  const selo = calcularSelo(statusItens);
  return {
    selo,
    pendencias: selo ? pendencias(statusItens, itens) : [],
    conclusao: montarConclusao(itens, statusItens),
    itensComFoto: contarItensComFoto(itens),
    totalItens: Array.isArray(itens) ? itens.length : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cobertura da avaliação, placar, frase explicativa por item e próximos passos.
// Funções novas e puras: calcularSelo, pendencias, montarConclusao e resumo não mudam.
// ─────────────────────────────────────────────────────────────────────────────

export interface Cobertura {
  /** Itens técnicos com qualquer status válido, inclusive 'na'. */
  avaliados: number;
  /** Sempre 10: os itens técnicos. */
  total: number;
  /** Chaves sem status, na ordem do checklist. */
  faltam: string[];
}

export function cobertura(statusItens: unknown): Cobertura {
  const m = sanitizarStatus(statusItens);
  const faltam = ITENS_COM_STATUS.filter((k) => !m[k]);
  return { avaliados: ITENS_COM_STATUS.length - faltam.length, total: ITENS_COM_STATUS.length, faltam };
}

/**
 * "10 itens avaliados: 4 conformes, 3 com atenção, 2 não conformes e 1 não se aplica." Com menos de 10:
 * "4 de 10 itens avaliados: 4 conformes." Só entram as partes com contagem maior que zero. Sem status: ''.
 */
export function frasePlacar(statusItens: unknown): string {
  const m = sanitizarStatus(statusItens);
  const valores = ITENS_COM_STATUS.map((k) => m[k]).filter((v): v is StatusVistoria => !!v);
  const n = valores.length;
  if (n === 0) return '';
  const quantos = (s: StatusVistoria): number => valores.filter((v) => v === s).length;
  const partes: string[] = [];
  const conformes = quantos('conforme');
  if (conformes) partes.push(`${conformes} ${conformes === 1 ? 'conforme' : 'conformes'}`);
  const atencao = quantos('atencao');
  if (atencao) partes.push(`${atencao} com atenção`);
  const naoConformes = quantos('nao_conforme');
  if (naoConformes) partes.push(`${naoConformes} ${naoConformes === 1 ? 'não conforme' : 'não conformes'}`);
  const naoSeAplica = quantos('na');
  if (naoSeAplica) partes.push(`${naoSeAplica} ${naoSeAplica === 1 ? 'não se aplica' : 'não se aplicam'}`);
  const abertura = n === ITENS_COM_STATUS.length ? `${n} itens avaliados` : `${n} de ${ITENS_COM_STATUS.length} itens avaliados`;
  return `${abertura}: ${juntarLista(partes)}.`;
}

/** Selo que substitui o "conforme" quando faltam itens a avaliar: nunca se imprime "Apto para instalar" sem os 10. */
export const SELO_PARCIAL = {
  titulo: 'Itens avaliados em ordem',
  frase: 'Faltam itens a avaliar. O resultado completo depende deles.',
};

/** Uma frase por item, para quem lê o relatório sem conhecer a vistoria. */
export const EXPLICA: Record<string, string> = {
  conta_luz: 'Mostra o consumo e o titular da conta.',
  documento_pessoal: 'Confirma quem é o titular da conta.',
  padrao: 'A caixa e o poste por onde a energia da rua chega à casa.',
  medidor: 'O relógio de luz, que mede o consumo e a energia injetada.',
  disjuntor_padrao: 'A chave geral da casa.',
  quadro_distribuicao: 'O quadro com as chaves de cada circuito da casa.',
  inversores: 'Onde ficam o inversor e a chave de proteção do lado da rede.',
  telhado: 'A cobertura onde os módulos serão instalados.',
  tipo_telha: 'O tipo de telha define como os módulos serão presos.',
  estrutura: 'Onde os módulos serão presos no telhado.',
  cabeamento: 'Por onde os fios vão do telhado ao quadro.',
  sombreamento: 'Árvores, prédios e caixas d’água que fazem sombra nos módulos.',
};

/** Próximos passos por selo. Só aparecem quando a vistoria está concluída. */
export const PROXIMOS_PASSOS = {
  nao_conforme: [
    'Resolver os itens de prioridade alta antes da instalação.',
    'Combinar com a empresa quem faz cada ajuste.',
    'Avisar a empresa quando terminar, para conferir e marcar a instalação.',
  ],
  atencao: [
    'Resolver os itens de prioridade média antes ou durante a instalação.',
    'Combinar com a empresa quem faz cada ajuste.',
  ],
  conforme: ['Nenhum ajuste é necessário. A instalação pode ser marcada.'],
  conforme_parcial: ['Concluir a avaliação dos itens que faltam antes de marcar a instalação.'],
} as const;

/** Lista de próximos passos do selo; 'conforme' com itens por avaliar usa a lista própria. Sem selo: lista vazia. */
export function proximosPassos(selo: SeloVistoria | null, cob: Cobertura): readonly string[] {
  if (!selo) return [];
  if (selo === 'conforme') return cob.avaliados < cob.total ? PROXIMOS_PASSOS.conforme_parcial : PROXIMOS_PASSOS.conforme;
  return PROXIMOS_PASSOS[selo];
}
