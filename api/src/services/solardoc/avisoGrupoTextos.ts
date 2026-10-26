// ─────────────────────────────────────────────────────────────────────────────
// TEXTOS DOS AVISOS DO GRUPO DO SOLARDOC (24/10/2026). PURO: nada aqui lê banco,
// relógio ou env (o estado do robô da Carla chega pronto, na frase do motivo).
//
// Os cinco modelos são os de `POS` em prototipo/index.html (redator, 24/10). Os
// campos entram entre colchetes e NENHUM pode sobrar vazio nem com o colchete
// escrito na mensagem: campo sem dado cai num texto de reserva.
// ─────────────────────────────────────────────────────────────────────────────

export const MODELOS = {
  desistencia: '🔔 Desistência no quiz\nQuem: [nome_completo], [empresa], [cidade]\nTelefone: [telefone]\nÍndice: [indice] de 100, perfil [perfil]\nPropostas por mês: [propostas_mes]\nQuer começar: [quando]\nNão concluiu a compra em 15 minutos.\n[linha_carla]\nA responsável é a Giovanna.',
  semVaga: '📌 Sem vaga hoje para a Carla\nQuem: [nome_completo], [empresa]\nTelefone: [telefone]\nEla tenta de novo amanhã, a partir das 9h.\nHoje ninguém escreve para ele à mão.\nSe passar de 48 horas, fica com a Giovanna.',
  compraCartao: '✅ Compra no cartão (Stripe)\nQuem: [nome_completo], [empresa]\nValor: [valor]\nOrigem: [origem]\nPagamento confirmado.',
  compraCartaoTeste: '🆕 Assinatura em teste (Stripe)\nQuem: [nome_completo], [empresa]\nValor: [valor] depois do teste\nOrigem: [origem]\nTeste grátis ativo. Ainda não houve cobrança.',
  compraAsaas: '✅ Compra no Pix (Asaas)\nQuem: [nome_completo], [empresa]\nValor: [valor]\nOrigem: [origem]\nPagamento confirmado.',
  compraComprovante: '🧾 Compra no Pix por comprovante\nQuem: [nome_completo], [empresa]\nValor: [valor]\nOrigem: [origem]\nAinda não foi confirmado pelo banco. Só vale depois da conferência.',
} as const;

export type ModeloAviso = keyof typeof MODELOS;

/** Rótulos das faixas que o quiz grava como id (field_data guarda `6a15`, nunca o texto). */
export const ROTULO_PROPOSTAS: Record<string, string> = { ate5: 'até 5', '6a15': 'de 6 a 15', '16a30': 'de 16 a 30', mais30: 'mais de 30' };
export const ROTULO_QUANDO: Record<string, string> = { hoje: 'hoje', semana: 'esta semana', mes: 'este mês', pesquisando: 'só estou pesquisando' };

export interface CamposAviso {
  nome_completo?: string | null;
  empresa?: string | null;
  cidade?: string | null;
  /** Qualquer formato; sai como +55 (DD) NNNNN-NNNN. */
  telefone?: string | null;
  indice?: number | string | null;
  perfil?: string | null;
  propostas_mes?: string | null;
  quando?: string | null;
  /** "HH:MM" de Brasília, quando a Carla já falou. */
  hora_carla?: string | null;
  /** A frase inteira de por que a Carla não vai chamar (ver FRASE_DO_MOTIVO). Vale por cima da hora. */
  motivo_carla?: string | null;
  valor?: number | string | null;
  /** Código SD-XXXX do quiz, ou vazio para "outra". */
  codigo?: string | null;
  /** Veio do quiz mas o código não se apurou: sai só "quiz". */
  doQuizSemCodigo?: boolean;
}

/** "+55 (34) 99999-0000". O +55 faz o WhatsApp deixar o número tocável. Telefone ilegível sai como "não informado". */
export function telefoneComDdi(bruto: string | null | undefined): string {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return 'não informado';
  return `+55 (${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
}

/** "R$ 67" ou "R$ 67,90". */
export function valorEmReais(v: number | string | null | undefined): string {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 'não informado';
  const t = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return `R$ ${t}`;
}

const preenchido = (v: unknown, reserva: string): string => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t || reserva;
};

/**
 * A linha da Carla do aviso de desistência. Quem decide é o chamador (nada aqui lê banco nem env):
 *  - `motivo` (a frase inteira, de FRASE_DO_MOTIVO): a Carla NÃO vai chamar ou não chamou ("A Carla está desligada agora.");
 *  - `horaCarla`: ela já falou ("A Carla falou às 10:15.");
 *  - nenhum dos dois: não afirma que ela falou.
 */
export function linhaDaCarla(horaCarla: string | null | undefined, motivo?: string | null): string {
  const m = String(motivo ?? '').replace(/\s+/g, ' ').trim();
  if (m) return m;
  const h = String(horaCarla ?? '').trim();
  return h ? `A Carla falou às ${h}.` : 'A Carla não chamou este lead.';
}

/** Preenche um modelo. Nunca devolve colchete de campo nem campo vazio. */
export function montarAviso(modelo: ModeloAviso, c: CamposAviso): string {
  const campos: Record<string, string> = {
    nome_completo: preenchido(c.nome_completo, 'nome não informado'),
    empresa: preenchido(c.empresa, 'sem empresa'),
    cidade: preenchido(c.cidade, 'cidade não informada'),
    telefone: telefoneComDdi(c.telefone),
    indice: preenchido(c.indice, 'sem índice'),
    perfil: preenchido(c.perfil, 'sem perfil'),
    propostas_mes: preenchido(c.propostas_mes, 'não informado'),
    quando: preenchido(c.quando, 'não informado'),
    linha_carla: linhaDaCarla(c.hora_carla, c.motivo_carla),
    valor: valorEmReais(c.valor),
    origem: c.codigo && String(c.codigo).trim() ? `quiz, código ${String(c.codigo).trim()}` : c.doQuizSemCodigo ? 'quiz' : 'outra',
  };
  return MODELOS[modelo].replace(/\[([a-z_]+)\]/g, (m, k: string) => (campos[k] !== undefined ? campos[k] : m));
}
