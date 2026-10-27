// ─────────────────────────────────────────────────────────────────────────────
// RECUPERAÇÃO DO QUIZ DO SOLARDOC PELA CARLA (24/10/2026, plano B2): as regras PURAS.
//
// Nada aqui lê banco, relógio ou env: tudo recebe o que precisa. O robô (recuperacaoCarla.ts),
// o tick de desistência do B1 e a sonda de admin usam as MESMAS funções, para o robô e o aviso
// nunca discordarem sobre quem a Carla vai chamar.
// ─────────────────────────────────────────────────────────────────────────────

export const ROBO_QUIZ_REC = 'quiz_recuperacao_5040';
/** Carimbo frio: `quiz_rec_sent:<hmac do telefone>`. Um por pessoa, para sempre (claim por insert). */
export const PREFIXO_CARIMBO_REC = 'quiz_rec_sent:';
/**
 * Marca do tick de desistência (B2.1): "avisei o time, mas a Carla ainda PODE chamar este lead" (linha fechada ou 1 h sem vaga).
 * Só o lead com esta marca volta à fila do robô depois do claim `quiz_aviso:<hmac>`; sem ela (a Carla não vai chamar, comprou) ele fica fora
 * e não gasta as avaliações da rodada. A marca é gravada ANTES do aviso, nunca depois.
 */
export const PREFIXO_AINDA_REC = 'quiz_rec_ainda:';
/** A vez de 10 min do robô: fora de BOT_SENT_PREFIXES (não é envio). */
export const PREFIXO_VEZ_REC = 'quiz_rec_vez:';
/** Pausa pelo banco (mesma tabela e mesmo mecanismo de ag5040_linha_pausa). */
export const CHAVE_PAUSA_QUIZ_REC = 'quiz_rec_pausa';
/** Hora da largada: o robô só considera lead gravado depois dela. */
export const CHAVE_LARGADA_REC = 'quiz_rec_largada';

export const ESPERA_MIN_MS = 15 * 60_000;
export const JANELA_MAX_MS = 48 * 3600_000;
/** O tick do B1 lê até aqui quando o robô está ligado, para dar o aviso de "venceu" ao lead que acabou de vencer. */
export const JANELA_LEITURA_COM_ROBO_MS = 50 * 3600_000;
/** O tick só segura o lead para o robô enquanto ele tem menos que isto desde o `created_time` (e a janela da linha está aberta). */
export const SEGURA_PARA_O_ROBO_MS = 60 * 60_000;

export interface LeadRec {
  lead_id?: string | null;
  nome?: string | null;
  whatsapp?: string | null;
  cidade?: string | null;
  field_data?: unknown;
  created_time?: string | null;
}

type Campo = { name?: string; values?: unknown[] };

/** Primeiro valor do campo `nome` do field_data, ou ''. */
export function campoFd(fieldData: unknown, nome: string): string {
  const lista = Array.isArray(fieldData) ? (fieldData as Campo[]) : [];
  const c = lista.find(x => x?.name === nome);
  const v = Array.isArray(c?.values) ? c?.values?.[0] : '';
  return String(v ?? '').trim();
}

/** Todos os valores do campo (a lista `Faltam`). */
export function valoresFd(fieldData: unknown, nome: string): string[] {
  const lista = Array.isArray(fieldData) ? (fieldData as Campo[]) : [];
  const c = lista.find(x => x?.name === nome);
  return Array.isArray(c?.values) ? c!.values!.map(v => String(v ?? '').trim()).filter(Boolean) : [];
}

// ── motivos ──────────────────────────────────────────────────────────────────

/** Por que a Carla NÃO chama o lead. A frase de cada um é a linha do aviso de desistência ao grupo. */
export type MotivoNaoChama =
  | 'desligada' | 'sem_cnpj' | 'antes_da_largada' | 'ja_falou' | 'suprimido' | 'humano_na_conversa'
  | 'posse' | 'sem_whatsapp' | 'vencido' | 'sem_diagnostico' | 'leitura_falhou' | 'mudo' | 'nao_saiu';

export const FRASE_DO_MOTIVO: Record<MotivoNaoChama, string> = {
  desligada: 'A Carla está desligada agora.',
  sem_cnpj: 'A Carla não vai chamar: ainda sem CNPJ.',
  antes_da_largada: 'A Carla não vai chamar: o lead é de antes de ela começar.',
  ja_falou: 'A Carla não vai chamar: ele já falou com a linha.',
  suprimido: 'A Carla não vai chamar: ele pediu para não receber mensagem.',
  humano_na_conversa: 'A Carla não vai chamar: já tem gente da equipe na conversa.',
  posse: 'A Carla não vai chamar: outra agente já está com a conversa.',
  sem_whatsapp: 'A Carla não vai chamar: o número não tem WhatsApp.',
  vencido: 'A Carla não chamou: passou de 48 horas sem vaga.',
  sem_diagnostico: 'A Carla não vai chamar: faltam dados do diagnóstico.',
  leitura_falhou: 'A Carla não vai chamar: não consegui conferir a conversa.',
  mudo: 'A Carla não vai chamar: ele não respondeu aos últimos toques da linha.',
  nao_saiu: 'A Carla não chamou: a mensagem não chegou a sair.',
};

/** Status do lead que a Carla ainda PODE chamar mas o tick já avisa (B2.1): fora da janela da linha e 60 min sem vaga. */
export const FRASE_FORA_DA_JANELA = 'A Carla chama no próximo horário da linha, de segunda a sábado, das 9h às 20h.';
export const FRASE_SEM_VAGA_AINDA = 'A Carla ainda não teve vaga para chamar.';
/** Teto universal (B2.2): leitura que não volta. Depois dos 60 min (ou fora da janela) o time é avisado mesmo sem a Carla ter conferido. */
/** Carimbo da Carla sem estado (ou com estado desconhecido) depois de 5 min: não dá para afirmar nem "falou às" nem "não saiu". */
export const FRASE_NAO_CONFIRMOU_ENVIO = 'A Carla tentou chamar, mas não deu para confirmar se a mensagem saiu.';
export const FRASE_NAO_CONFERIU = 'A Carla não conseguiu conferir este contato agora.';

// ── tempo ────────────────────────────────────────────────────────────────────

export function idadeMs(l: Pick<LeadRec, 'created_time'>, agoraMs: number): number | null {
  const t = Date.parse(String(l.created_time ?? ''));
  return Number.isFinite(t) ? agoraMs - t : null;
}

/** 'cedo' = menos de 15 min; 'vencido' = mais de 48 h; null = dentro da janela. Hora ilegível vale 'cedo' (nunca envia). */
export function foraDoTempo(l: Pick<LeadRec, 'created_time'>, agoraMs: number): 'cedo' | 'vencido' | null {
  const idade = idadeMs(l, agoraMs);
  if (idade === null || idade < ESPERA_MIN_MS) return 'cedo';
  if (idade > JANELA_MAX_MS) return 'vencido';
  return null;
}

/** "HH:MM" de Brasília. */
export const horaBRT = (ms: number): string =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

/** Dia (AAAA-MM-DD) de Brasília. */
export const diaBRT = (ms: number): string => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10);

/** Faixa de 10 minutos do relógio: a vez do robô é uma chave por faixa. */
export function chaveVezRec(agora: Date): string {
  return `${PREFIXO_VEZ_REC}${Math.floor(agora.getTime() / 600_000)}`;
}

// ── a fila ───────────────────────────────────────────────────────────────────

/** Respostas de `quando_comecar` na ordem de intenção. Resposta ausente ou desconhecida vai por último. */
export const ORDEM_INTENCAO: Record<string, number> = { hoje: 0, semana: 1, mes: 2, pesquisando: 3 };

/** Sem CNPJ: a resposta é `abrindo` ou `nao`. Sem resposta nenhuma também não entra (na dúvida, a Carla não chama). */
export function semCnpj(fieldData: unknown): boolean {
  const c = campoFd(fieldData, 'cnpj');
  return c === '' || c === 'abrindo' || c === 'nao';
}

/**
 * As conferências que NÃO leem banco: sem CNPJ e lead de antes da largada (o lead de teste e o telefone ilegível ficam com quem chama).
 * O robô, o tick de desistência e a sonda usam a mesma, na mesma ordem.
 */
export function motivoSemBanco(
  l: Pick<LeadRec, 'field_data' | 'created_time'>, largadaMs: number | null,
): 'sem_cnpj' | 'antes_da_largada' | null {
  if (semCnpj(l.field_data)) return 'sem_cnpj';
  const criado = Date.parse(String(l.created_time ?? ''));
  if (largadaMs === null || !Number.isFinite(criado) || criado < largadaMs) return 'antes_da_largada';
  return null;
}

/** Intenção primeiro, e dentro dela o mais antigo para o mais novo. Não altera a lista de entrada. */
export function ordenarFila<T extends LeadRec>(leads: readonly T[]): T[] {
  const rank = (l: T): number => ORDEM_INTENCAO[campoFd(l.field_data, 'quando_comecar')] ?? 9;
  const hora = (l: T): number => Date.parse(String(l.created_time ?? '')) || 0;
  return [...leads].sort((a, b) => rank(a) - rank(b) || hora(a) - hora(b));
}

// ── o texto da Carla (POS.carla do protótipo) ────────────────────────────────

/** Item que falta → trecho da frase. Os mesmos textos do `FX` do protótipo. */
export const FALTA_TEXTO: Record<string, string> = {
  tem_marca: 'a sua logo e a sua cor',
  mostra_economia: 'a economia mês a mês e o tempo de retorno',
  economia_25: 'a economia em 25 anos',
  financiamento: 'as parcelas do financiamento',
  usa_conta: 'a conta de luz lida por foto',
  contrato_pronto: 'o contrato pronto na reunião',
  modelos: 'um modelo para cada tipo de cliente',
};
const FALTA_RESERVA = 'o acompanhamento depois da proposta';

export const MODELO_CARLA =
  'Oi, [nome], aqui é a Carla, do SolarDoc. Olhei o diagnóstico da [empresa] e deu [indice] de 100, com [pilar] pesando mais. O que mais falta na sua proposta é [falta]. Quer ver como fica a proposta da [empresa] no SolarDoc?';

/** A frase que entra no texto de quem prefere pagar no Pix. Fixa: sem link, sem código, sem valor. */
export const FRASE_PIX_POR_AQUI = 'Dá para assinar no Pix por aqui mesmo.';

/** Texto digitado pela pessoa que vai para dentro da mensagem: uma linha, sem emoji, sem travessão, sem link. null = não serve. */
function textoDePessoa(bruto: string, max: number): string | null {
  const t = bruto
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[–—]/g, '-')
    .replace(/[\u0000-\u001f\u007f\[\]]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max).trim();
  if (!t) return null;
  if (/https?:|www\.|\.(com|net|org|app|br)\b|@/i.test(t)) return null;
  return t;
}

/** Primeiro nome com a inicial maiúscula (só mexe na caixa quando veio toda em minúscula ou toda em maiúscula). */
export function primeiroNome(nome: string | null | undefined): string | null {
  const t = textoDePessoa(String(nome ?? ''), 60);
  const p = t?.split(' ')[0] ?? '';
  if (p.length < 2 || !/\p{L}/u.test(p)) return null;
  return p === p.toLowerCase() || p === p.toUpperCase() ? p.charAt(0).toLocaleUpperCase('pt-BR') + p.slice(1).toLocaleLowerCase('pt-BR') : p;
}

export type TextoCarla = { ok: true; texto: string } | { ok: false; motivo: MotivoNaoChama };

/**
 * A mensagem da Carla preenchida com o que a pessoa VIU na tela (índice, pilar e itens que faltam gravados no field_data,
 * nunca recalculados). Sem nome, sem índice ou sem pilar não há mensagem (nada de campo inventado). Sem empresa vale "sua empresa".
 * `opcoes.pixPorAqui` (a pessoa marcou no quiz que prefere o Pix e há Pix disponível): entra uma frase fixa, sem link e sem valor,
 * logo antes da pergunta final. Sem a opção o texto é o de sempre, byte a byte.
 */
export function textoDaCarla(l: LeadRec, opcoes?: { pixPorAqui?: boolean }): TextoCarla {
  const nome = primeiroNome(l.nome);
  const indice = campoFd(l.field_data, 'Índice');
  const pilar = textoDePessoa(campoFd(l.field_data, 'Pilar mais fraco'), 30)?.toLocaleLowerCase('pt-BR') ?? null;
  if (!nome || !/^\d{1,3}$/.test(indice) || !pilar) return { ok: false, motivo: 'sem_diagnostico' };
  const empresa = textoDePessoa(campoFd(l.field_data, 'Empresa'), 60) ?? 'sua empresa';
  const falta = valoresFd(l.field_data, 'Faltam').map(q => FALTA_TEXTO[q]).find(Boolean) ?? FALTA_RESERVA;
  const campos: Record<string, string> = { nome, empresa, indice, pilar, falta };
  const modelo = opcoes?.pixPorAqui ? MODELO_CARLA.replace(' Quer ver como fica', ` ${FRASE_PIX_POR_AQUI} Quer ver como fica`) : MODELO_CARLA;
  const texto = modelo.replace(/\[([a-z_]+)\]/g, (m, k: string) => campos[k] ?? m);
  if (/\[|\]|https?:|www\./i.test(texto) || /[–—]/.test(texto)) return { ok: false, motivo: 'sem_diagnostico' };
  return { ok: true, texto };
}
