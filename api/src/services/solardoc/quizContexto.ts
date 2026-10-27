// ─────────────────────────────────────────────────────────────────────────────
// O QUE O QUIZ DO SOLARDOC CONTA PARA A CARLA (24/10/2026, plano B2). PURO: recebe a linha do `leads_meta` e devolve só
// os campos combinados. As respostas são IDS de opção (o texto livre nunca passa por aqui, só a cidade, que a persona limpa).
// ─────────────────────────────────────────────────────────────────────────────

import { campoFd } from './recuperacaoCarlaRegras';
import { ROTULO_PROPOSTAS, ROTULO_QUANDO } from './avisoGrupoTextos';

export const FORM_ID_QUIZ_SOLARDOC = 'quiz_solardoc';

export interface QuizContexto {
  codigo: string;
  indice: string;
  perfil: string;
  propostas_mes: string;
  como_faz_hoje: string;
  tempo_por_proposta: string;
  cidade: string;
  objecao: string;
  quando_comecar: string;
  /** Como a pessoa disse que prefere pagar: 'Pix' ou 'cartão de crédito'. Vazio quando não respondeu. */
  pagamento?: string;
}

const COMO_FAZ: Record<string, string> = {
  word: 'no Word ou no PowerPoint', planilha: 'numa planilha', canva: 'no Canva', plataforma: 'numa plataforma ou CRM pago',
  distribuidor: 'na ferramenta do distribuidor', whatsapp: 'mandando os valores direto no WhatsApp',
};
const TEMPO: Record<string, string> = {
  t15: 'até 15 minutos', t30: 'de 15 a 30 minutos', t60: 'de 30 minutos a 1 hora', t120: 'de 1 a 2 horas', tmais: 'mais de 2 horas',
};
const OBJECAO: Record<string, string> = {
  preco: 'o preço', ja_uso: 'já usa outra ferramenta', aprender: 'medo de perder tempo aprendendo',
  validade: 'dúvida se os documentos têm validade', online: 'receio de pagar pela internet', nada: 'nenhuma, quer começar',
};

const PAGAMENTO: Record<string, string> = { pix: 'Pix', cartao: 'cartão de crédito' };

export interface LinhaQuiz { form_id?: string | null; cidade?: string | null; field_data?: unknown }

/** Os campos do quiz, ou null se a linha não é do quiz do SolarDoc. Campo que o quiz não gravou fica vazio (a persona o omite). */
export function contextoDoQuiz(l: LinhaQuiz | null | undefined): QuizContexto | null {
  if (!l || l.form_id !== FORM_ID_QUIZ_SOLARDOC) return null;
  const fd = l.field_data;
  const q: QuizContexto = {
    codigo: campoFd(fd, 'Código'),
    indice: campoFd(fd, 'Índice'),
    perfil: campoFd(fd, 'Perfil nome'),
    propostas_mes: ROTULO_PROPOSTAS[campoFd(fd, 'propostas_mes')] ?? '',
    como_faz_hoje: COMO_FAZ[campoFd(fd, 'como_faz_hoje')] ?? '',
    tempo_por_proposta: TEMPO[campoFd(fd, 'tempo_por_proposta')] ?? '',
    cidade: String(l.cidade ?? '').trim(),
    objecao: OBJECAO[campoFd(fd, 'objecao')] ?? '',
    quando_comecar: ROTULO_QUANDO[campoFd(fd, 'quando_comecar')] ?? '',
    pagamento: PAGAMENTO[campoFd(fd, 'pagamento')] || undefined,
  };
  return Object.values(q).some(Boolean) ? q : null;
}
